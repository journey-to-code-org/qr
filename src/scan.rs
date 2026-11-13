//! Unified scanning for QR codes and supported linear barcodes.

use crate::{
    barcode::{self, DecodedBarcode},
    decode::{self, Frame},
};

/// A code detected in a grayscale image frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DetectedCode {
    /// QR payload bytes.
    Qr(Vec<u8>),
    /// A decoded linear barcode.
    Linear(DecodedBarcode),
}

/// Errors returned by [`scan_frame`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScanError {
    /// Frame dimensions are zero or do not match the pixel buffer.
    BadFrame,
    /// The frame exceeds the QR decoder's supported dimensions or pixel count.
    FrameTooLarge,
    /// No supported code was readable in the frame.
    NotFound,
}

/// Tries to read a QR code or a supported linear barcode from a grayscale
/// frame. QR decoding uses the full frame. Linear decoding tries up to 17
/// evenly spaced horizontal scanlines and returns the first readable result.
///
/// The returned code is the first readable code, not an exhaustive list of
/// every code in the image.
pub fn scan_frame(frame: &Frame<'_>) -> Result<DetectedCode, ScanError> {
    let (width, height) = (frame.width, frame.height);
    if width == 0 || height == 0 {
        return Err(ScanError::BadFrame);
    }
    if width > decode::MAX_WIDTH
        || height > decode::MAX_HEIGHT
        || width
            .checked_mul(height)
            .is_none_or(|pixels| pixels > decode::MAX_PIXELS)
    {
        return Err(ScanError::FrameTooLarge);
    }
    if frame.luma.len() != width * height {
        return Err(ScanError::BadFrame);
    }

    if let Ok(payload) = decode::decode(frame) {
        return Ok(DetectedCode::Qr(payload));
    }

    for sample in 1..=SCANLINE_SAMPLES {
        let y = sample * height / (SCANLINE_SAMPLES + 1);
        let scanline = &frame.luma[y * width..(y + 1) * width];
        if let Ok(decoded) = barcode::decode_scanline(scanline) {
            return Ok(DetectedCode::Linear(decoded));
        }
        let inverted: Vec<u8> = scanline.iter().map(|&pixel| 255 - pixel).collect();
        if let Ok(decoded) = barcode::decode_scanline(&inverted) {
            return Ok(DetectedCode::Linear(decoded));
        }
    }

    Err(ScanError::NotFound)
}

const SCANLINE_SAMPLES: usize = 17;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{barcode, encode};

    const SCALE: usize = 3;

    fn render_linear(code: &barcode::LinearCode, height: usize, invert: bool) -> Vec<u8> {
        let width = code.width() * SCALE;
        let mut pixels = vec![if invert { 0 } else { 255 }; width * height];
        for y in 0..height {
            for (index, &module) in code.modules().iter().enumerate() {
                if module == 1 {
                    pixels[y * width + index * SCALE..y * width + (index + 1) * SCALE]
                        .fill(if invert { 255 } else { 0 });
                }
            }
        }
        pixels
    }

    fn render_qr(data: &[u8], scale: usize, quiet_zone: usize) -> (usize, usize, Vec<u8>) {
        let code = encode(data).unwrap();
        let modules = code.size + quiet_zone * 2;
        let side = modules * scale;
        let mut pixels = vec![255; side * side];
        for row in 0..code.size {
            for column in 0..code.size {
                if code.modules()[row * code.size + column] == 1 {
                    for dy in 0..scale {
                        for dx in 0..scale {
                            let y = (row + quiet_zone) * scale + dy;
                            let x = (column + quiet_zone) * scale + dx;
                            pixels[y * side + x] = 0;
                        }
                    }
                }
            }
        }
        (side, side, pixels)
    }

    #[test]
    fn finds_qr_payloads_from_frames() {
        let text = b"unified scanner";
        let (width, height, luma) = render_qr(text, 4, 4);
        assert_eq!(
            scan_frame(&Frame {
                width,
                height,
                luma: &luma,
            }),
            Ok(DetectedCode::Qr(text.to_vec()))
        );
    }

    #[test]
    fn finds_linear_codes_in_a_frame() {
        for (code, expected) in [
            (
                barcode::encode_code128(b"TICKET-42").unwrap(),
                DecodedBarcode {
                    symbology: barcode::Symbology::Code128,
                    data: "TICKET-42".into(),
                },
            ),
            (
                barcode::encode_code39(b"TICKET-42").unwrap(),
                DecodedBarcode {
                    symbology: barcode::Symbology::Code39,
                    data: "TICKET-42".into(),
                },
            ),
            (
                barcode::encode_ean13(b"400638133393").unwrap(),
                DecodedBarcode {
                    symbology: barcode::Symbology::Ean13,
                    data: "4006381333931".into(),
                },
            ),
        ] {
            let height = 68;
            let luma = render_linear(&code, height, false);
            assert_eq!(
                scan_frame(&Frame {
                    width: code.width() * SCALE,
                    height,
                    luma: &luma,
                }),
                Ok(DetectedCode::Linear(expected))
            );
        }
    }

    #[test]
    fn finds_inverted_linear_barcodes() {
        let code = barcode::encode_code128(b"INVERTED").unwrap();
        let height = 68;
        let luma = render_linear(&code, height, true);
        assert_eq!(
            scan_frame(&Frame {
                width: code.width() * SCALE,
                height,
                luma: &luma,
            }),
            Ok(DetectedCode::Linear(DecodedBarcode {
                symbology: barcode::Symbology::Code128,
                data: "INVERTED".into(),
            }))
        );
    }

    #[test]
    fn validates_frames_and_reports_when_nothing_is_readable() {
        assert_eq!(
            scan_frame(&Frame {
                width: 0,
                height: 1,
                luma: &[],
            }),
            Err(ScanError::BadFrame)
        );
        assert_eq!(
            scan_frame(&Frame {
                width: 2,
                height: 2,
                luma: &[255; 3],
            }),
            Err(ScanError::BadFrame)
        );
        assert_eq!(
            scan_frame(&Frame {
                width: 4,
                height: 4,
                luma: &[255; 16],
            }),
            Err(ScanError::NotFound)
        );
    }
}
