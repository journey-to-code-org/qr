# Changelog

Notable changes to Symbology are documented here.

## Unreleased

## 0.2.0 - 2026-11-13

### Added

- Dependency-free Rust encoders and decoders for Code 128, Code 39, and
  EAN-13, with unified frame scanning for QR and linear codes.
- JavaScript and WebAssembly APIs for barcode encoding, decoding, SVG output,
  and unified scanning.
- A static browser demo and GitHub Pages deployment workflow.
- A public npm package build that includes the WebAssembly binary and a
  Zubra-compiled `<symbology-code>` generator widget.

### Changed

- Renamed the Rust crate and JavaScript package from `qr` to `symbology`.
- `loadQr()` can now load the WebAssembly binary included with the npm package
  without requiring callers to provide a separate URL.
