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

## Features

| Feature | Default | What it adds |
| --- | --- | --- |
| `decode` | on | Reading a symbol from a frame. Turn it off (`default-features = false`) for a build that only draws codes |

## Checking it

```sh
cargo test                          # round trips, every version and mask, perspective, damage, fuzzing
cargo test --no-default-features    # the encoder alone
cargo test --release -- --ignored   # the long fuzz run
```

CI runs formatting, clippy, both test configurations and both WebAssembly builds.

## Not here yet

- WebAssembly exports and a small JavaScript loader. Kin's are tied to its own ABI.
- An SVG renderer, and a `qr-code` custom element for Zubra UI.
- Other modes, levels and versions above 10.

## Licence

MIT, as in Kin.
