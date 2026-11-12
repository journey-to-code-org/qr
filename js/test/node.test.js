// The WebAssembly build in Node, as a server would use it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadQr, QrError, svg } from '../qr.js';
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

test('loads from a file URL, a Module, and refuses something else', async () => {
  const fromUrl = await loadQr(pathToFileURL(wasmPath));
  assert.deepEqual(fromUrl.encode('a'), qr.encode('a'));
  const fromModule = await loadQr(await WebAssembly.compile(readFileSync(wasmPath)));
  assert.deepEqual(fromModule.encode('a'), qr.encode('a'));
  const empty = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
  await assert.rejects(loadQr(empty), /isn't the qr build/);
});
