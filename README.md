# symbology

Dependency-free Rust encoders and decoders for QR codes and linear barcodes:
Code 128, Code 39, and EAN-13.

## Where it came from

The QR code was written for [Kin](https://github.com/mnichols08/ZTM-Build-Fest/tree/main/projects/kin) (`rust/src/qr/`, copied at commit 272b8fc), which uses it for invitation and sign-in links and allows itself no crates. `encode.rs`, `decode.rs`, `layout.rs`, `rs.rs`, `tables.rs`, `tests.rs` and `coverage.rs` are unchanged from Kin, so the two can be compared file by file. `lib.rs` and `wire.rs` adapt the QR code here; `barcode.rs` adds the linear barcode formats.

## What it supports

| | |
| --- | --- |
| Mode | Byte mode only (any bytes; UTF-8 text in practice) |
| Error correction | Level M only |
| Versions | 1 to 10, so up to 213 bytes |
| Decode input | An 8-bit grayscale frame up to 1280 × 720 pixels; dark-on-light, then inverted |
| Allocation | Encoding works in fixed-size storage; the decoder reuses a scratch buffer between frames |

Known limit: a version 1 symbol (14 bytes or fewer) is not read from a frame taken at an angle, because version 1 has no alignment pattern.

## Use

```rust
use symbology::{decode, encode, Frame};

let code = encode(b"https://example.org/t/8F3K")?;   // Code { size, dark }
for row in code.modules().chunks(code.size) { /* 1 is dark, 0 is light; add a quiet zone of 4 */ }

let bytes = decode(&Frame { width, height, luma })?;  // luma: one byte per pixel, row-major
```

`symbology::wire` has the same two operations as flat byte buffers, for a WebAssembly or C caller: `matrix(data)` returns a `KQRM` header and one byte per module, and `read_frame(bytes)` takes `width`, `height` and the luma.

### From JavaScript (a server or a browser)

Install the JavaScript package with `npm install @journey-to-code/symbology`.
Its build includes the WebAssembly module, so `loadQr()` works without a
separately supplied WASM URL:

```js
import { loadQr } from '@journey-to-code/symbology';

const qr = await loadQr(); // Or pass WASM bytes, a Response, Module, or URL.
const code = qr.encode('https://potomac.solutions/t/8F3K'); // { size, modules }
const markup = qr.svg(code, { title: 'Your ticket' });     // one <path>, a 4-module quiet zone
const text = qr.decodeText({ width, height, luma });        // from a camera frame

const bars = qr.encodeCode128('Ticket-42');                 // { type, width, modules }
const barsSvg = qr.barcodeSvg(bars, { title: 'Ticket' });
const decoded = qr.decodeBarcodeScanline(lumaRow);          // { type, data }
const detected = qr.scanFrame({ width, height, luma });     // QR or linear code
```

The package also ships a Zubra-built custom element. Import it once, then use
`<symbology-code>` in HTML:

```js
import '@journey-to-code/symbology/symbology-code';
```

```html
<symbology-code format="qr" value="https://example.com"></symbology-code>
```

The widget lets a visitor generate QR, Code 128, Code 39, and EAN-13 symbols
and download them as SVG. Zubra is only a development dependency; consuming
the compiled element does not install Zubra or its runtime. Build or pack the
JavaScript package with `npm --prefix js run build` (Rust and the
`wasm32-unknown-unknown` target are required).

Errors are `QrError`, with `code` one of `empty`, `too-long`, `not-found`, `unsupported`, `uncorrectable`, `malformed`, `bad-frame`, `frame-too-large`. Underneath is `src/exports.rs`, a small C ABI (`qr_alloc`, `qr_encode`, `qr_decode`, `qr_barcode_encode`, `qr_barcode_scanline`, `qr_scan`, `qr_result_ptr`/`qr_result_len`, `qr_free`) any WebAssembly host can call.
Linear-code input errors are `BarcodeError` values: `empty`, `invalid-input`,
`invalid-length`, `invalid-checksum`, `bad-scanline`, or `not-found`. Barcode
encoding and decoding are implemented by the Rust crate and exposed to
JavaScript through its WebAssembly exports.

### Linear barcodes (Rust)

```rust
use symbology::barcode::{decode_scanline, encode_code128, encode_code39, encode_ean13};

let code128 = encode_code128(b"Ticket-42")?; // printable ASCII, Code Set B
let code39 = encode_code39(b"TICKET-42")?;   // Code 39's uppercase alphabet
let ean13 = encode_ean13(b"400638133393")?;  // 12 digits; adds the check digit
let modules = code128.modules();             // one row: 1 dark, 0 light, quiet zones included

// `scanline` is an 8-bit grayscale row through one barcode, dark bars on light.
let decoded = decode_scanline(scanline)?;
```

Code 128 accepts printable ASCII in Code Set B. Code 39 accepts `0-9`, `A-Z`,
and `-. $/+%`; it does not add the optional Mod-43 check character. EAN-13
accepts 12 digits (computes the check digit) or 13 digits (validates it). The
scanline decoder reads either direction and is enabled by the default `decode`
feature.

### Scan a whole frame

When the code type is not known in advance, `scan_frame` tries QR decoding on
the full image, then probes up to 17 evenly spaced rows for Code 128, Code 39,
or EAN-13. It returns the first readable result; it does not enumerate every
symbol in a frame.

```rust
use symbology::{scan_frame, DetectedCode, Frame};

let result = scan_frame(&Frame { width, height, luma })?;
match result {
    DetectedCode::Qr(bytes) => { /* QR payload bytes */ }
    DetectedCode::Linear(barcode) => { /* symbology and text */ }
}
```

## Features

| Feature | Default | What it adds |
| --- | --- | --- |
| `decode` | on | Reading QR symbols from frames, linear barcodes from scanlines, and unified scanning with `scan_frame`. Turn it off (`default-features = false`) for encoder-only builds |

## Checking it

```sh
cargo test                          # round trips, every version and mask, perspective, damage, fuzzing
cargo test --no-default-features    # the encoder alone
cargo test --release -- --ignored   # the long fuzz run
cd js && npm run build && npm test  # builds WASM and the Zubra element, then tests Node and Chrome
```

`js/test/fixtures.txt` holds 24 codes drawn by the native encoder, every version 1 to 10. The JavaScript tests require the WebAssembly build to draw them exactly, in Node and in Chrome, read back an SVG painted on a canvas, and exercise the Zubra custom element. `cargo test` fails if the native encoder ever draws differently; `UPDATE_FIXTURES=1 cargo test` rewrites the file.

CI runs formatting, clippy, both test configurations, both WebAssembly builds, and the JavaScript tests between them; it keeps `symbology.wasm` as an artifact.

## Try the browser demo

The static demo in [`site/`](./site/) generates QR and linear codes, exports SVG,
and scans uploaded images or camera frames entirely in the browser. The image
data stays on your device.

To preview it locally, build the WebAssembly module, copy it into the ignored
site asset path, then serve the repository root over HTTP:

```sh
cargo build --release --target wasm32-unknown-unknown
mkdir -p site/assets
cp target/wasm32-unknown-unknown/release/symbology.wasm site/assets/
cp js/qr.js site/assets/
python -m http.server 8000
```

Open `http://localhost:8000/site/`. GitHub Pages deployment is handled by
`.github/workflows/pages.yml` on pushes to `main`.

## Not here yet

- Other modes, levels and versions above 10.

## Licence

MIT, as in Kin.
