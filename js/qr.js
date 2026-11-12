// QR codes from the crate's WebAssembly build, the same on a server and in a browser.
//
//   const qr = await loadQr(wasm);   // bytes, a Response, a WebAssembly.Module, or a URL
//   const code = qr.encode('https://potomac.solutions/t/8F3K');   // { size, modules }
//   qr.svg(code);                     // an <svg> string, for a page or an email
//   qr.decode({ width, height, luma });   // Uint8Array; qr.decodeText(...) for a string
//
// No dependencies. Errors are QrError, with `code` one of: empty, too-long, not-found,
// unsupported, uncorrectable, malformed, bad-frame, frame-too-large.

const CODES = [null, 'empty', 'too-long', 'not-found', 'unsupported', 'uncorrectable', 'malformed', 'bad-frame', 'frame-too-large'];
const MATRIX_HEADER = 12;

export class QrError extends Error {
  constructor(code) {
    super(`qr: ${code}`);
    this.name = 'QrError';
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
  const { exports: wasm } = await instantiate(source);
  for (const name of ['memory', 'qr_alloc', 'qr_free', 'qr_encode', 'qr_result_ptr', 'qr_result_len']) {
    if (!(name in wasm)) throw new TypeError(`loadQr: this isn't the qr build (no ${name})`);
  }

  const call = (fn, input) => {
    const pointer = wasm.qr_alloc(input.length);
    try {
      new Uint8Array(wasm.memory.buffer, pointer, input.length).set(input);
      const status = fn(pointer, input.length);
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

  return {
    encode,
    decode,
    decodeText: (frame) => new TextDecoder().decode(decode(frame)),
    svg: (code, options) => svg(typeof code === 'string' || code instanceof Uint8Array ? encode(code) : code, options),
  };
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
