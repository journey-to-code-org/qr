// The WebAssembly build in Node, as a server would use it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadQr, BarcodeError, QrError, svg } from '../qr.js';
import { wasmPath, fixtures, frameOf } from './load.js';

const qr = await loadQr(readFileSync(wasmPath));

test('every fixture encodes to exactly the matrix the native encoder drew', () => {
  for (const { bytes, size, modules } of fixtures) {
    const code = qr.encode(bytes);
    assert.equal(code.size, size);
    assert.equal(Array.from(code.modules).join(''), modules);
  }
});

test('text is encoded as UTF-8', () => {
  const text = 'Café ☕ 🛶 Garrett County';
  assert.deepEqual(qr.encode(text), qr.encode(new TextEncoder().encode(text)));
});

test('decode reads back every fixture drawn as a frame', () => {
  for (const fixture of fixtures) {
    assert.deepEqual(qr.decode(frameOf(qr.encode(fixture.bytes))), fixture.bytes);
  }
  assert.equal(qr.decodeText(frameOf(qr.encode('potomac://ticket/0042'))), 'potomac://ticket/0042');
});

test('errors are QrError with a code', () => {
  assert.throws(() => qr.encode(''), (error) => error instanceof QrError && error.code === 'empty');
  assert.throws(() => qr.encode('a'.repeat(214)), { code: 'too-long' });
  assert.throws(() => qr.decode({ width: 64, height: 64, luma: new Uint8Array(64 * 64).fill(255) }), { code: 'not-found' });
  assert.throws(() => qr.decode({ width: 4, height: 4, luma: new Uint8Array(3) }), { code: 'bad-frame' });
});

test('many calls in a row: memory is given back and answers stay right', () => {
  const before = qr.encode('https://potomac.solutions/t/8F3K');
  for (let i = 0; i < 2000; i++) qr.encode(`https://potomac.solutions/t/${i}`);
  assert.deepEqual(qr.encode('https://potomac.solutions/t/8F3K'), before);
});

test('svg: one path, the quiet zone, a title when given, escaped', () => {
  const code = qr.encode('https://potomac.solutions/t/8F3K');
  const out = svg(code);
  assert.match(out, new RegExp(`viewBox="0 0 ${code.size + 8} ${code.size + 8}"`));
  assert.equal((out.match(/<path /g) ?? []).length, 1);
  assert.match(out, /aria-hidden="true"/);
  const dark = Array.from(code.modules).filter(Boolean).length;
  const drawn = [...out.matchAll(/h(\d+)v1/g)].reduce((sum, m) => sum + Number(m[1]), 0);
  assert.equal(drawn, dark, 'every dark module drawn once');
  const named = qr.svg('x', { title: 'Ticket "42" & more', light: 'transparent' });
  assert.match(named, /role="img" aria-label="Ticket &quot;42&quot; &amp; more"/);
  assert.doesNotMatch(named, /<rect/);
});

test('linear encoders match expected shapes and validate input', () => {
  for (const [type, input] of [
    ['code128', 'ABC-123'],
    ['code39', 'ABC-123'],
    ['ean13', '400638133393'],
  ]) {
    const code = qr.encodeBarcode(type, input);
    assert.equal(code.type, type);
    assert.equal(code.modules.length, code.width);
    assert.ok(code.width > 0);
    assert.ok(code.modules.every((module) => module === 0 || module === 1));
    assert.ok(code.modules.slice(0, 10).every((module) => module === 0));
  }
  assert.deepEqual(qr.encodeCode128('ABC'), qr.encodeBarcode('code128', 'ABC'));
  assert.deepEqual(qr.encodeCode39('ABC'), qr.encodeBarcode('code39', 'ABC'));
});

test('linear scanline and whole-frame APIs decode all supported formats', () => {
  for (const [type, text, expected] of [
    ['code128', 'TICKET-42', 'TICKET-42'],
    ['code39', 'TICKET-42', 'TICKET-42'],
    ['ean13', '400638133393', '4006381333931'],
  ]) {
    const code = qr.encodeBarcode(type, text);
    const scale = 3;
    const width = code.width * scale;
    const height = 68;
    const luma = new Uint8Array(width * height).fill(255);
    for (let x = 0; x < code.width; x++) {
      if (!code.modules[x]) continue;
      for (let y = 0; y < height; y++) luma.fill(0, y * width + x * scale, y * width + (x + 1) * scale);
    }

    assert.deepEqual(qr.decodeBarcodeScanline(luma.subarray(34 * width, 35 * width)), { type, data: expected });
    assert.deepEqual(qr.scanFrame({ width, height, luma }), { type, data: expected });
  }
});

test('linear SVG uses its row width and reports typed validation errors', () => {
  const code = qr.encodeEan13('400638133393');
  const output = qr.barcodeSvg(code, { height: 48, title: 'Product barcode' });
  assert.match(output, new RegExp(`viewBox="0 0 ${code.width} 48"`));
  assert.match(output, /aria-label="Product barcode"/);
  assert.equal((output.match(/<path /g) ?? []).length, 1);
  assert.throws(() => qr.encodeCode39('lower'), (error) => error instanceof BarcodeError && error.code === 'invalid-input');
  assert.throws(() => qr.encodeEan13('4006381333932'), { code: 'invalid-checksum' });
  assert.throws(() => qr.decodeBarcodeScanline(new Uint8Array(32).fill(255)), { code: 'bad-scanline' });
});

test('unified scanning distinguishes QR and linear payloads', () => {
  const qrText = 'wasm unified scan';
  assert.deepEqual(qr.scanFrame(frameOf(qr.encode(qrText))), {
    type: 'qr',
    data: new TextEncoder().encode(qrText),
  });

  const code = qr.encodeCode128('FRAME-42');
  const scale = 3;
  const width = code.width * scale;
  const height = 68;
  const luma = new Uint8Array(width * height).fill(255);
  for (let x = 0; x < code.width; x++) {
    if (code.modules[x]) {
      for (let y = 0; y < height; y++) luma.fill(0, y * width + x * scale, y * width + (x + 1) * scale);
    }
  }
  assert.deepEqual(qr.scanFrame({ width, height, luma }), { type: 'code128', data: 'FRAME-42' });
});

test('loads from a file URL, a Module, and refuses something else', async () => {
  const fromUrl = await loadQr(pathToFileURL(wasmPath));
  assert.deepEqual(fromUrl.encode('a'), qr.encode('a'));
  const fromModule = await loadQr(await WebAssembly.compile(readFileSync(wasmPath)));
  assert.deepEqual(fromModule.encode('a'), qr.encode('a'));
  const empty = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
  await assert.rejects(loadQr(empty), /isn't the qr build/);
});
