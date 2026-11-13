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
const siteFile = (name) => readFileSync(fileURLToPath(new URL(`../../site/${name}`, import.meta.url)));
let browser, server, base;

before(async () => {
  if (!chrome) return;
  server = createServer((req, res) => {
    const path = req.url.replace(/^\/symbology(?:\/|$)/, '/');
    if (path === '/') return res.writeHead(200, { 'content-type': 'text/html' }).end(siteFile('index.html'));
    if (path === '/app.js') return res.writeHead(200, { 'content-type': 'text/javascript' }).end(siteFile('app.js'));
    if (path === '/styles.css') return res.writeHead(200, { 'content-type': 'text/css' }).end(siteFile('styles.css'));
    if (path === '/assets/qr.js' || path === '/qr.js') return res.writeHead(200, { 'content-type': 'text/javascript' }).end(loader);
    if (path === '/assets/symbology.wasm' || path === '/symbology.wasm') return res.writeHead(200, { 'content-type': 'application/wasm' }).end(wasm);
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
    const qr = await loadQr(await fetch('/symbology.wasm'));
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
    const qr = await loadQr(await fetch('/symbology.wasm'));
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

test('linear barcodes encode, scan, and render in the browser', { skip: !chrome && 'no Chrome' }, async () => {
  const page = await browser.newPage();
  await page.goto(base);
  const result = await page.evaluate(async () => {
    const { loadQr } = await import('/qr.js');
    const qr = await loadQr(await fetch('/symbology.wasm'));
    const code = qr.encodeEan13('400638133393');
    const scale = 3;
    const width = code.width * scale;
    const height = 68;
    const luma = new Uint8Array(width * height).fill(255);
    for (let x = 0; x < code.width; x++) {
      if (code.modules[x]) {
        for (let y = 0; y < height; y++) luma.fill(0, y * width + x * scale, y * width + (x + 1) * scale);
      }
    }
    return {
      type: code.type,
      width: code.width,
      decoded: qr.decodeBarcodeScanline(luma.subarray(34 * width, 35 * width)),
      scanned: qr.scanFrame({ width, height, luma }),
      svg: qr.barcodeSvg(code, { title: 'EAN-13' }),
    };
  });
  assert.equal(result.type, 'ean13');
  assert.equal(result.width, 117);
  assert.deepEqual(result.decoded, { type: 'ean13', data: '4006381333931' });
  assert.deepEqual(result.scanned, { type: 'ean13', data: '4006381333931' });
  assert.match(result.svg, /aria-label="EAN-13"/);
  assert.match(result.svg, /viewBox="0 0 117 60"/);
});

test('static demo generates codes and scans an uploaded image', { skip: !chrome && 'no Chrome' }, async () => {
  const page = await browser.newPage();
  await page.goto(`${base}/symbology/`);
  await page.waitForSelector('#preview svg');
  await page.locator('#format').selectOption('ean13');
  await page.locator('#payload').fill('400638133393');
  await page.locator('#generate').click();
  await page.waitForFunction(() => document.querySelector('#preview-type')?.textContent === 'EAN13');
  assert.match(await page.locator('#preview').innerHTML(), /<svg/);

  await page.locator('#format').selectOption('qr');
  await page.locator('#payload').fill('symbology demo scan');
  await page.locator('#generate').click();
  const svgMarkup = await page.locator('#preview').innerHTML();
  const imageSvg = svgMarkup.replace('<svg ', '<svg width="420" height="420" ');
  await page.locator('#image-file').setInputFiles({
    name: 'demo.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(imageSvg),
  });
  await page.waitForFunction(() => !document.querySelector('#scan-result')?.hidden);
  assert.equal(await page.locator('#result-type').textContent(), 'QR');
  assert.equal(await page.locator('#result-data').textContent(), 'symbology demo scan');
});
