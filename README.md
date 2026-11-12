# qr

QR codes written from scratch against ISO/IEC 18004, in Rust, with no dependencies. It encodes bytes into a symbol, and decodes a symbol out of a camera frame.

The name is a placeholder.

## Where it came from

The code was written for [Kin](https://github.com/mnichols08/ZTM-Build-Fest/tree/main/projects/kin) (`rust/src/qr/`, copied at commit 272b8fc), which uses it for invitation and sign-in links and allows itself no crates. `encode.rs`, `decode.rs`, `layout.rs`, `rs.rs`, `tables.rs`, `tests.rs` and `coverage.rs` are unchanged from Kin, so the two can be compared file by file. `lib.rs` and `wire.rs` are new here: Kin's error type is gone, and decoding sits behind a feature.

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
use qr::{encode, decode, Frame};

let code = encode(b"https://example.org/t/8F3K")?;   // Code { size, dark }
for row in code.modules().chunks(code.size) { /* 1 is dark, 0 is light; add a quiet zone of 4 */ }

let bytes = decode(&Frame { width, height, luma })?;  // luma: one byte per pixel, row-major
```

`qr::wire` has the same two operations as flat byte buffers, for a WebAssembly or C caller: `matrix(data)` returns a `KQRM` header and one byte per module, and `read_frame(bytes)` takes `width`, `height` and the luma.

### From JavaScript (a server or a browser)

`js/qr.js` loads the WebAssembly build (`cargo build --release --target wasm32-unknown-unknown`, then `target/wasm32-unknown-unknown/release/qr.wasm`), the same on Node and in a browser:

```js
import { loadQr } from './qr.js';

const qr = await loadQr(await fetch('/qr.wasm'));        // or the bytes, a WebAssembly.Module, or a URL
const code = qr.encode('https://potomac.solutions/t/8F3K'); // { size, modules }
const markup = qr.svg(code, { title: 'Your ticket' });     // one <path>, a 4-module quiet zone
const text = qr.decodeText({ width, height, luma });        // from a camera frame
```

Errors are `QrError`, with `code` one of `empty`, `too-long`, `not-found`, `unsupported`, `uncorrectable`, `malformed`, `bad-frame`, `frame-too-large`. Underneath is `src/exports.rs`, a small C ABI (`qr_alloc`, `qr_encode`, `qr_decode`, `qr_result_ptr`/`qr_result_len`, `qr_free`) any WebAssembly host can call.

## Features

| Feature | Default | What it adds |
| --- | --- | --- |
| `decode` | on | Reading a symbol from a frame. Turn it off (`default-features = false`) for a build that only draws codes |

## Checking it

```sh
cargo test                          # round trips, every version and mask, perspective, damage, fuzzing
cargo test --no-default-features    # the encoder alone
cargo test --release -- --ignored   # the long fuzz run
cd js && npm test                   # the WebAssembly build in Node and in Chrome (needs the release .wasm)
```

`js/test/fixtures.txt` holds 24 codes drawn by the native encoder, every version 1 to 10. The JavaScript tests require the WebAssembly build to draw them exactly, in Node and in Chrome, and read back an SVG painted on a canvas. `cargo test` fails if the native encoder ever draws differently; `UPDATE_FIXTURES=1 cargo test` rewrites the file.

CI runs formatting, clippy, both test configurations, both WebAssembly builds, and the JavaScript tests between them; it keeps `qr.wasm` as an artifact.

## Not here yet

- A `qr-code` custom element for Zubra UI.
- A package on npm for the loader and the build.
- Other modes, levels and versions above 10.

## Licence

MIT, as in Kin.
