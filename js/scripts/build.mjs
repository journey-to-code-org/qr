import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileFile } from '@zubra/compiler';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(packageRoot, '..');
const wasmPath = resolve(repositoryRoot, 'target/wasm32-unknown-unknown/release/symbology.wasm');
const componentPath = resolve(packageRoot, 'components/symbology-code.zb');
const outputDirectory = resolve(packageRoot, 'dist');

const cargo = spawnSync(process.env.CARGO ?? 'cargo', [
  'build',
  '--release',
  '--target',
  'wasm32-unknown-unknown',
], { cwd: repositoryRoot, stdio: 'inherit' });

if (cargo.error) throw cargo.error;
if (cargo.status !== 0) throw new Error(`cargo build failed with exit code ${cargo.status}`);

mkdirSync(outputDirectory, { recursive: true });
copyFileSync(wasmPath, resolve(packageRoot, 'symbology.wasm'));

for (const [emit, filename] of [
  ['element', 'symbology-code.js'],
  ['dts', 'symbology-code.d.ts'],
]) {
  const result = compileFile(componentPath, { command: 'compile', emit });
  if (!result.ok || result.output === null) {
    throw new Error(result.error ?? `Zubra failed to compile ${componentPath} as ${emit}`);
  }
  writeFileSync(resolve(outputDirectory, filename), result.output);
}
