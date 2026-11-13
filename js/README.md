# @journey-to-code/symbology

Dependency-free QR and linear barcode encoding and decoding, with a Rust
WebAssembly implementation and an optional Zubra-built custom element.

## Install

```sh
npm install @journey-to-code/symbology
```

The package includes the WebAssembly binary. Load it with no URL or pass an
alternate source:

```js
import { loadQr } from '@journey-to-code/symbology';

const symbology = await loadQr();
const code = symbology.encode('https://example.com');
const svg = symbology.svg(code);
```

`loadQr` also accepts WASM bytes, a `Response`, a `WebAssembly.Module`, or a
URL. Encoding supports QR, Code 128, Code 39, and EAN-13. The decoder reads
QR frames and linear-barcode scanlines or frames.

## Custom element

Import the widget once from a JavaScript entry point that resolves npm
package imports (for example, your bundler entry point):

```js
import '@journey-to-code/symbology/symbology-code';
```

Then use it in HTML:

```html
<symbology-code format="qr" value="https://example.com"></symbology-code>
```

The element offers a format picker, editable content, SVG preview, and
download. `format` accepts `qr`, `code128`, `code39`, or `ean13`; `value`
sets the initial content. It is authored in Zubra and distributed as a
standalone custom element, so applications do not need Zubra or its runtime.

## Build from source

Packing the package runs its build automatically. Building requires Rust with
the `wasm32-unknown-unknown` target and Node.js 20 or newer:

```sh
npm run build
npm test
```

Zubra is a development dependency used to compile
[`components/symbology-code.zb`](./components/symbology-code.zb); it is not a
runtime dependency of the published package.
