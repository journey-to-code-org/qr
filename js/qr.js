// QR codes from the crate's WebAssembly build, the same on a server and in a browser.
//
//   const qr = await loadQr(wasm);   // bytes, a Response, a WebAssembly.Module, or a URL
//   const code = qr.encode('https://potomac.solutions/t/8F3K');   // { size, modules }
//   qr.svg(code);                     // an <svg> string, for a page or an email
//   qr.decode({ width, height, luma });   // Uint8Array; qr.decodeText(...) for a string
//   const bars = qr.encodeCode128('Ticket-42'); // { type, width, modules }
//   qr.scanFrame({ width, height, luma });      // first QR or linear code found
//
// No dependencies. Errors are QrError, with `code` one of: empty, too-long, not-found,
// unsupported, uncorrectable, malformed, bad-frame, frame-too-large.

const CODES = [null, 'empty', 'too-long', 'not-found', 'unsupported', 'uncorrectable', 'malformed', 'bad-frame', 'frame-too-large'];
const MATRIX_HEADER = 12;
const BARCODE_FORMATS = { code128: 1, code39: 2, ean13: 3 };
const BARCODE_CODES = ['empty', 'invalid-input', 'invalid-length', 'invalid-checksum', 'bad-scanline', 'not-found'];

export class QrError extends Error {
  constructor(code) {
    super(`qr: ${code}`);
    this.name = 'QrError';
    this.code = code;
  }
}

export class BarcodeError extends Error {
  constructor(code) {
    super(`barcode: ${code}`);
    this.name = 'BarcodeError';
    this.code = code;
  }
}

async function instantiate(source) {
  if (source instanceof WebAssembly.Module) return WebAssembly.instantiate(source, {});
  if (typeof Response !== 'undefined' && source instanceof Response) {
    if (WebAssembly.instantiateStreaming && source.headers.get('content-type')?.startsWith('application/wasm')) {
      return (await WebAssembly.instantiateStreaming(source, {})).instance;
    }
    source = await source.arrayBuffer();
  } else if (typeof source === 'string' || source instanceof URL) {
    const url = new URL(source, globalThis.location?.href);
    if (url.protocol === 'file:') {
      const { readFile } = await import('node:fs/promises');
      source = await readFile(url);
    } else {
      return instantiate(await fetch(url));
    }
  }
  return (await WebAssembly.instantiate(source, {})).instance;
}

/** Load the WebAssembly build. Pass its bytes, a fetch Response, a compiled Module, or a URL. */
export async function loadQr(source) {
  source ??= new URL('./symbology.wasm', import.meta.url);
  const { exports: wasm } = await instantiate(source);
  for (const name of ['memory', 'qr_alloc', 'qr_free', 'qr_encode', 'qr_result_ptr', 'qr_result_len']) {
    if (!(name in wasm)) throw new TypeError(`loadQr: this isn't the qr build (no ${name})`);
  }

  const call = (fn, input, ...args) => {
    if (!fn) throw new TypeError('This WebAssembly build does not provide that operation');
    const pointer = wasm.qr_alloc(input.length);
    try {
      new Uint8Array(wasm.memory.buffer, pointer, input.length).set(input);
      const status = fn(pointer, input.length, ...args);
      if (status >= 20 && status <= 25) throw new BarcodeError(BARCODE_CODES[status - 20]);
      if (status !== 0) throw new QrError(CODES[status] ?? `error-${status}`);
      // Copy out: the next call (or a memory.grow) invalidates the view.
      return new Uint8Array(wasm.memory.buffer, wasm.qr_result_ptr(), wasm.qr_result_len()).slice();
    } finally {
      wasm.qr_free(pointer, input.length);
    }
  };
  const bytesOf = (input) => (typeof input === 'string' ? new TextEncoder().encode(input) : input instanceof Uint8Array ? input : new Uint8Array(input));

  /** Encode text (as UTF-8) or bytes. `modules` is `size * size` bytes, row-major, 1 dark; no quiet zone. */
  function encode(input) {
    const matrix = call(wasm.qr_encode, bytesOf(input));
    const size = new DataView(matrix.buffer).getUint32(8, true);
    return { size, modules: matrix.subarray(MATRIX_HEADER) };
  }

  /** Read the payload out of an 8-bit grayscale frame: `{ width, height, luma }`, one byte per pixel. */
  function decode({ width, height, luma }) {
    if (!wasm.qr_decode) throw new TypeError('decode: this build has no decoder (built without the decode feature)');
    const input = new Uint8Array(8 + luma.length);
    const view = new DataView(input.buffer);
    view.setUint32(0, width, true);
    view.setUint32(4, height, true);
    input.set(luma, 8);
    return call(wasm.qr_decode, input);
  }

  /** Encode a linear barcode; format is `code128`, `code39`, or `ean13`. */
  function encodeBarcode(format, input) {
    const id = BARCODE_FORMATS[format];
    if (!id) throw new TypeError(`encodeBarcode: unsupported format ${format}`);
    if (!wasm.qr_barcode_encode) throw new TypeError('encodeBarcode: unsupported by this WebAssembly build');
    const bytes = call(wasm.qr_barcode_encode, bytesOf(input), id);
    if (new TextDecoder().decode(bytes.subarray(0, 4)) !== 'KBC1' || bytes.length < 9) {
      throw new TypeError('encodeBarcode: invalid response from WebAssembly');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(5, true);
    if (bytes[4] !== id || bytes.length !== 9 + width) {
      throw new TypeError('encodeBarcode: invalid response from WebAssembly');
    }
    return { type: format, width, modules: bytes.slice(9) };
  }

  /** Decode an 8-bit grayscale scanline into `{ type, data }`. */
  function decodeBarcodeScanline(luma) {
    if (!wasm.qr_barcode_scanline) throw new TypeError('decodeBarcodeScanline: this build has no decoder (built without the decode feature)');
    const result = call(wasm.qr_barcode_scanline, bytesOf(luma));
    return decodedBarcode(result);
  }

  /** Scan a grayscale frame and return the first detected QR or linear code. */
  function scanFrame({ width, height, luma }) {
    if (!wasm.qr_scan) throw new TypeError('scanFrame: this build has no decoder (built without the decode feature)');
    const input = new Uint8Array(8 + luma.length);
    const view = new DataView(input.buffer);
    view.setUint32(0, width, true);
    view.setUint32(4, height, true);
    input.set(luma, 8);
    const result = call(wasm.qr_scan, input);
    if (result.length === 0) throw new TypeError('scanFrame: empty response from WebAssembly');
    if (result[0] === 0) return { type: 'qr', data: result.slice(1) };
    return decodedBarcode(result);
  }

  return {
    encode,
    decode,
    decodeText: (frame) => new TextDecoder().decode(decode(frame)),
    svg: (code, options) => svg(typeof code === 'string' || code instanceof Uint8Array ? encode(code) : code, options),
    encodeBarcode,
    encodeCode128: (input) => encodeBarcode('code128', input),
    encodeCode39: (input) => encodeBarcode('code39', input),
    encodeEan13: (input) => encodeBarcode('ean13', input),
    decodeBarcodeScanline,
    scanFrame,
    barcodeSvg,
  };
}

function decodedBarcode(result) {
  const type = Object.keys(BARCODE_FORMATS).find((format) => BARCODE_FORMATS[format] === result[0]);
  if (!type) throw new TypeError(`Unknown barcode type from WebAssembly: ${result[0]}`);
  return { type, data: new TextDecoder().decode(result.subarray(1)) };
}

/**
 * An SVG of a code, with a quiet zone of `margin` modules (4 is the standard). One path, a run
 * of dark modules per segment, so it stays small and crisp at any size.
 */
export function svg({ size, modules }, { margin = 4, dark = '#000', light = '#fff', title = '' } = {}) {
  const side = size + 2 * margin;
  let path = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!modules[y * size + x]) continue;
      let run = 1;
      while (x + run < size && modules[y * size + x + run]) run++;
      path += `M${x + margin} ${y + margin}h${run}v1h-${run}z`;
      x += run - 1;
    }
  }
  const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" shape-rendering="crispEdges"${title ? ` role="img" aria-label="${escape(title)}"` : ' aria-hidden="true"'}>` +
    (title ? `<title>${escape(title)}</title>` : '') +
    (light && light !== 'transparent' ? `<rect width="${side}" height="${side}" fill="${escape(light)}"/>` : '') +
    `<path fill="${escape(dark)}" d="${path}"/></svg>`
  );
}

/** Render a linear barcode row as SVG. Encoded rows already include quiet zones. */
export function barcodeSvg({ width, modules }, { height = 60, margin = 0, dark = '#000', light = '#fff', title = '' } = {}) {
  const side = width + 2 * margin;
  let path = '';
  for (let x = 0; x < width; x++) {
    if (!modules[x]) continue;
    let run = 1;
    while (x + run < width && modules[x + run]) run++;
    path += `M${x + margin} ${margin}v${height}h${run}v-${height}z`;
    x += run - 1;
  }
  const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${height + 2 * margin}" shape-rendering="crispEdges"${title ? ` role="img" aria-label="${escape(title)}"` : ' aria-hidden="true"'}>` +
    (title ? `<title>${escape(title)}</title>` : '') +
    (light && light !== 'transparent' ? `<rect width="${side}" height="${height + 2 * margin}" fill="${escape(light)}"/>` : '') +
    `<path fill="${escape(dark)}" d="${path}"/></svg>`
  );
}
