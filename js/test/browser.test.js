// The same build in Chrome: the same matrices as the server, and a code drawn as an SVG,
// painted on a canvas, and read back from the canvas's pixels.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { loadQr } from '../qr.js';
import { wasmPath, fixtures } from './load.js';

const chrome = [process.env.CHROME, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((path) => path && existsSync(path));
const loader = readFileSync(fileURLToPath(new URL('../qr.js', import.meta.url)));
const wasm = readFileSync(wasmPath);
let browser, server, base;

before(async () => {
  server = createServer((req, res) => {
    if (req.url === '/qr.js') return res.writeHead(200, { 'content-type': 'text/javascript' }).end(loader);
    if (req.url === '/qr.wasm') return res.writeHead(200, { 'content-type': 'application/wasm' }).end(wasm);
    res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>qr</title>');
  });
  await new Promise((done) => server.listen(0, done));
  base = `http://localhost:${server.address().port}`;
  browser = await chromium.launch({ executablePath: chrome });
});
after(async () => {
  await browser?.close();
  server?.close();
});

test('the browser draws exactly what the server draws', { skip: !chrome && 'no Chrome' }, async () => {
  const page = await browser.newPage();
  await page.goto(base);
  const inBrowser = await page.evaluate(async (hexes) => {
    const { loadQr } = await import('/qr.js');
    const qr = await loadQr(await fetch('/qr.wasm'));
    const bytes = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16));
    return hexes.map((hex) => Array.from(qr.encode(bytes(hex)).modules).join(''));
  }, fixtures.map(({ bytes }) => Buffer.from(bytes).toString('hex')));
  const onServer = await loadQr(wasm);
  fixtures.forEach((fixture, i) => {
    assert.equal(inBrowser[i], fixture.modules, `fixture ${i} matches the native encoder`);
    assert.equal(inBrowser[i], Array.from(onServer.encode(fixture.bytes).modules).join(''), `fixture ${i} matches the server`);
  });
});

test('an SVG made on the server, painted in the browser, reads back', { skip: !chrome && 'no Chrome' }, async () => {
  const server = await loadQr(wasm);
  const text = 'https://potomac.solutions/t/8F3K?seat=A12';
  const markup = server.svg(text, { title: 'Your ticket' });
  const page = await browser.newPage();
  await page.goto(base);
  const read = await page.evaluate(async (markup) => {
    const { loadQr } = await import('/qr.js');
    const qr = await loadQr(await fetch('/qr.wasm'));
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    await image.decode();
    const canvas = Object.assign(document.createElement('canvas'), { width: 360, height: 360 });
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, 360, 360);
    const { data } = context.getImageData(0, 0, 360, 360);
    const luma = new Uint8Array(360 * 360);
    for (let i = 0; i < luma.length; i++) luma[i] = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000;
    return qr.decodeText({ width: 360, height: 360, luma });
  }, markup);
  assert.equal(read, text);
});
