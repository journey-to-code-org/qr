// The WebAssembly build the tests use, and the fixtures the native encoder made.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

/** `$QR_WASM`, or the release build `cargo build --release --target wasm32-unknown-unknown` makes. */
export const wasmPath = process.env.QR_WASM ?? here('../../target/wasm32-unknown-unknown/release/qr.wasm');
if (!existsSync(wasmPath)) throw new Error(`No WebAssembly build at ${wasmPath}. Run cargo build --release --target wasm32-unknown-unknown, or set QR_WASM.`);

const fromHex = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16));

/** [{ bytes, size, modules: '0101…' }] from js/test/fixtures.txt. */
export const fixtures = readFileSync(here('./fixtures.txt'), 'utf8')
  .split('\n')
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => {
    const [hex, size, modules] = line.split('\t');
    return { bytes: fromHex(hex), size: Number(size), modules };
  });

/** Draw a code as a grayscale frame: `scale` pixels a module, a 4-module quiet zone. */
export function frameOf({ size, modules }, scale = 4, margin = 4) {
  const side = (size + 2 * margin) * scale;
  const luma = new Uint8Array(side * side).fill(255);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (!modules[y * size + x]) continue;
    for (let dy = 0; dy < scale; dy++) luma.fill(0, ((y + margin) * scale + dy) * side + (x + margin) * scale, ((y + margin) * scale + dy) * side + (x + margin + 1) * scale);
  }
  return { width: side, height: side, luma };
}
