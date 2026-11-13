import { loadQr } from './assets/qr.js';

const $ = (selector) => document.querySelector(selector);
const elements = {
  format: $('#format'),
  payload: $('#payload'),
  hint: $('#format-hint'),
  error: $('#generate-error'),
  generate: $('#generate'),
  preview: $('#preview'),
  previewType: $('#preview-type'),
  previewSize: $('#preview-size'),
  download: $('#download'),
  imageFile: $('#image-file'),
  camera: $('#camera'),
  cameraStart: $('#camera-start'),
  scanNow: $('#scan-now'),
  cameraStop: $('#camera-stop'),
  canvas: $('#image-canvas'),
  scanEmpty: $('#scan-empty'),
  scanStatus: $('#scan-status'),
  scanResult: $('#scan-result'),
  resultType: $('#result-type'),
  resultData: $('#result-data'),
  copyResult: $('#copy-result'),
};

let api;
let currentCode;
let currentSvg = '';
let cameraStream;
let currentResult = '';

const hints = {
  qr: 'QR supports up to 213 bytes. Text is encoded as UTF-8.',
  code128: 'Code 128 supports printable ASCII characters.',
  code39: 'Use uppercase letters, digits, spaces, and - . $ / + %.',
  ean13: 'Enter 12 digits to add a check digit, or 13 digits to validate it.',
};

function setFormatHint() {
  const format = elements.format.value;
  elements.hint.textContent = hints[format];
  elements.payload.maxLength = format === 'qr' ? '213' : format === 'ean13' ? '13' : '512';
  elements.payload.placeholder = format === 'ean13' ? '400638133393' : 'Type something to encode…';
  elements.error.hidden = true;
}

function makeCode() {
  if (!api) return;
  const format = elements.format.value;
  const value = elements.payload.value;
  try {
    if (format === 'qr') {
      currentCode = api.encode(value);
      currentSvg = api.svg(currentCode, { margin: 4, title: 'Generated QR code' });
      elements.previewSize.textContent = `${currentCode.size} × ${currentCode.size} MODULES`;
      elements.previewType.textContent = 'QR CODE';
    } else {
      currentCode = api.encodeBarcode(format, value);
      currentSvg = api.barcodeSvg(currentCode, { height: 72, title: `Generated ${format} barcode` });
      elements.previewSize.textContent = `${currentCode.width} MODULES · QUIET ZONE INCLUDED`;
      elements.previewType.textContent = format.toUpperCase();
    }
    elements.preview.innerHTML = currentSvg;
    elements.error.hidden = true;
    elements.download.disabled = false;
  } catch (error) {
    elements.preview.replaceChildren();
    elements.previewSize.textContent = 'Check your input and try again';
    elements.error.textContent = error.message.replace(/^(qr|barcode): /, '');
    elements.error.hidden = false;
    elements.download.disabled = true;
    currentCode = undefined;
    currentSvg = '';
  }
}

function downloadSvg() {
  if (!currentSvg) return;
  const blob = new Blob([currentSvg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `symbology-${elements.format.value}.svg`;
  link.click();
  URL.revokeObjectURL(url);
}

function toLuma(imageData) {
  const rgba = imageData.data;
  const luma = new Uint8Array(imageData.width * imageData.height);
  for (let pixel = 0, channel = 0; pixel < luma.length; pixel++, channel += 4) {
    luma[pixel] = Math.round((rgba[channel] * 299 + rgba[channel + 1] * 587 + rgba[channel + 2] * 114) / 1000);
  }
  return luma;
}

function showResult(result) {
  currentResult = result.type === 'qr' ? new TextDecoder().decode(result.data) : result.data;
  elements.resultType.textContent = result.type.toUpperCase();
  elements.resultData.textContent = currentResult;
  elements.scanResult.hidden = false;
  elements.scanEmpty.hidden = true;
  elements.scanStatus.textContent = 'Code found';
}

function scanCanvas() {
  const context = elements.canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('This browser could not read image pixels.');
  const frame = {
    width: elements.canvas.width,
    height: elements.canvas.height,
    luma: toLuma(context.getImageData(0, 0, elements.canvas.width, elements.canvas.height)),
  };
  const result = api.scanFrame(frame);
  showResult(result);
}

function drawImage(image) {
  const scale = Math.min(1, 1280 / image.width, 720 / image.height);
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  elements.canvas.width = width;
  elements.canvas.height = height;
  elements.canvas.getContext('2d', { willReadFrequently: true }).drawImage(image, 0, 0, width, height);
}

async function loadImageFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    elements.scanStatus.textContent = 'Choose a supported image file.';
    return;
  }
  stopCamera();
  elements.scanStatus.textContent = 'Reading image…';
  elements.scanResult.hidden = true;
  elements.scanEmpty.hidden = true;
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    drawImage(image);
    elements.canvas.hidden = false;
    scanCanvas();
  } catch (error) {
    elements.scanStatus.textContent = error.name === 'QrError' ? 'No supported code found. Try a sharper or better-lit image.' : error.message;
    elements.scanEmpty.hidden = false;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    elements.scanStatus.textContent = 'Camera access is not available in this browser. Try an image instead.';
    return;
  }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    elements.camera.srcObject = cameraStream;
    await elements.camera.play();
    elements.camera.hidden = false;
    elements.canvas.hidden = true;
    elements.scanEmpty.hidden = true;
    elements.scanResult.hidden = true;
    elements.cameraStart.hidden = true;
    elements.scanNow.hidden = false;
    elements.cameraStop.hidden = false;
    elements.scanStatus.textContent = 'Camera on — hold a code in view, then scan.';
  } catch (error) {
    elements.scanStatus.textContent = error.name === 'NotAllowedError'
      ? 'Camera permission was denied. You can scan an image instead.'
      : `Could not start camera: ${error.message}`;
  }
}

function stopCamera() {
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = undefined;
  elements.camera.srcObject = null;
  elements.camera.hidden = true;
  elements.cameraStart.hidden = false;
  elements.scanNow.hidden = true;
  elements.cameraStop.hidden = true;
}

function scanCamera() {
  if (!cameraStream || !elements.camera.videoWidth) return;
  drawImage(elements.camera);
  try {
    scanCanvas();
  } catch (error) {
    elements.scanResult.hidden = true;
    elements.scanEmpty.hidden = true;
    elements.scanStatus.textContent = error.name === 'QrError'
      ? 'No code yet — keep it steady and try Scan now.'
      : error.message;
  }
}

async function initialize() {
  try {
    const wasmUrl = new URL('./assets/symbology.wasm', import.meta.url);
    api = await loadQr(wasmUrl);
    elements.preview.replaceChildren();
    elements.previewSize.textContent = 'Ready when you are';
    elements.generate.disabled = false;
    makeCode();
  } catch (error) {
    elements.preview.textContent = 'The demo engine could not load. Refresh the page or check the project build.';
    elements.previewSize.textContent = 'Engine unavailable';
    elements.generate.disabled = true;
    elements.scanStatus.textContent = `Could not load WebAssembly: ${error.message}`;
  }
}

elements.format.addEventListener('change', () => {
  setFormatHint();
  makeCode();
});
elements.generate.addEventListener('click', makeCode);
elements.download.addEventListener('click', downloadSvg);
elements.imageFile.addEventListener('change', (event) => loadImageFile(event.target.files[0]));
elements.cameraStart.addEventListener('click', startCamera);
elements.cameraStop.addEventListener('click', stopCamera);
elements.copyResult.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(currentResult);
    elements.copyResult.textContent = 'Copied!';
    setTimeout(() => { elements.copyResult.textContent = 'Copy result □'; }, 1400);
  } catch {
    elements.scanStatus.textContent = 'Could not copy automatically. Select and copy the result text.';
  }
});
elements.scanNow.addEventListener('click', scanCamera);
window.addEventListener('pagehide', stopCamera);
setFormatHint();
elements.generate.disabled = true;
initialize();
