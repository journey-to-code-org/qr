//! Byte layouts for callers on the other side of a WebAssembly or C boundary.
//!
//! [`matrix`] takes the bytes to encode. Its result is `KQRM`, version
//! u16 = 1, reserved u16 = 0, the side length u32, then one byte per module
//! in row-major order (1 dark, 0 light), with no quiet zone: whoever draws it
//! adds the margin. Integers are little-endian.
//!
//! `read_frame` (with the `decode` feature) takes `width:u32`, `height:u32`,
//! then `width * height` bytes of 8-bit luma, row-major. Its result is the
//! decoded payload bytes.
//!
//! The layouts are the ones Kin's `kin_qr_encode` and `kin_qr_decode` exports
//! use, so a matrix from here draws with Kin's `<kin-qr>` unchanged.

use super::{encode, QrError};

const MATRIX_MAGIC: &[u8; 4] = b"KQRM";
const MATRIX_VERSION: u16 = 1;
/// Bytes before the modules in a matrix: magic, version, reserved, side.
pub const MATRIX_HEADER_BYTES: usize = 12;

/// Encodes `data` as a KQRM matrix.
pub fn matrix(data: &[u8]) -> Result<Vec<u8>, QrError> {
    let code = encode(data)?;
    // A version 10 symbol is 57 modules a side, so the side always fits.
    let side = code.size as u32;
    let mut bytes = Vec::with_capacity(MATRIX_HEADER_BYTES + code.modules().len());
    bytes.extend_from_slice(MATRIX_MAGIC);
    bytes.extend_from_slice(&MATRIX_VERSION.to_le_bytes());
    bytes.extend_from_slice(&0u16.to_le_bytes());
    bytes.extend_from_slice(&side.to_le_bytes());
    bytes.extend_from_slice(code.modules());
    Ok(bytes)
}

#[cfg(feature = "decode")]
pub use frames::{read_frame, release_scratch};

#[cfg(feature = "decode")]
mod frames {
    use std::sync::{Mutex, MutexGuard};

    use crate::decode::{self, Scratch};
    use crate::{Frame, QrError};

    const FRAME_HEADER_BYTES: usize = 8;

    /// Reads the payload out of a grayscale frame.
    pub fn read_frame(input: &[u8]) -> Result<Vec<u8>, QrError> {
        if input.len() < FRAME_HEADER_BYTES {
            return Err(QrError::BadFrame);
        }
        let width = u32::from_le_bytes([input[0], input[1], input[2], input[3]]) as usize;
        let height = u32::from_le_bytes([input[4], input[5], input[6], input[7]]) as usize;
        let luma = &input[FRAME_HEADER_BYTES..];
        let pixels = width.checked_mul(height).ok_or(QrError::BadFrame)?;
        if width == 0 || height == 0 || pixels != luma.len() {
            return Err(QrError::BadFrame);
        }
        let mut scratch = lock_scratch();
        decode::decode_in(
            &Frame {
                width,
                height,
                luma,
            },
            &mut scratch,
        )
    }

    /// The decoder's working memory, kept between frames so the camera path
    /// does not allocate per frame. One WASM instance is single-threaded; the
    /// lock is for native builds, which run threads.
    static SCRATCH: Mutex<Scratch> = Mutex::new(Scratch::new());

    fn lock_scratch() -> MutexGuard<'static, Scratch> {
        SCRATCH
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Drops the decoder's retained working memory.
    pub fn release_scratch() {
        *lock_scratch() = Scratch::new();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::encode::MAX_BYTES;

    #[test]
    fn matrix_has_header_and_one_byte_per_module() {
        let bytes = matrix(b"kin://invite/abc").unwrap();
        assert_eq!(&bytes[0..4], MATRIX_MAGIC);
        let side = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
        // 16 bytes need version 2 at level M (version 1 holds 14): side 25.
        assert_eq!(side, 25);
        assert_eq!(bytes.len(), MATRIX_HEADER_BYTES + side * side);
        assert!(bytes[MATRIX_HEADER_BYTES..]
            .iter()
            .all(|&module| module <= 1));
    }

    #[test]
    fn rejects_empty_and_oversized_data() {
        assert_eq!(matrix(b""), Err(QrError::Empty));
        let long = vec![b'a'; MAX_BYTES + 1];
        assert_eq!(matrix(&long), Err(QrError::TooLong));
    }

    #[cfg(feature = "decode")]
    mod frames {
        use super::super::*;

        /// What a frame with nothing readable in it comes back as.
        fn nothing_readable(result: Result<Vec<u8>, QrError>) -> bool {
            matches!(
                result,
                Err(QrError::NotFound
                    | QrError::Unsupported
                    | QrError::Uncorrectable
                    | QrError::Malformed)
            )
        }

        fn frame_bytes(width: u32, height: u32, luma: &[u8]) -> Vec<u8> {
            let mut bytes = Vec::new();
            bytes.extend_from_slice(&width.to_le_bytes());
            bytes.extend_from_slice(&height.to_le_bytes());
            bytes.extend_from_slice(luma);
            bytes
        }

        #[test]
        fn round_trips_through_the_frame_layout() {
            let text = b"kin://sign-in/0123456789abcdef#secret";
            let matrix = matrix(text).unwrap();
            let side = u32::from_le_bytes(matrix[8..12].try_into().unwrap());
            // Draw 4 px per module with a 4-module quiet zone, as a browser does.
            let scale = 4usize;
            let margin = 4usize;
            let pixels = (side as usize + 2 * margin) * scale;
            let mut luma = vec![255u8; pixels * pixels];
            for row in 0..side as usize {
                for column in 0..side as usize {
                    if matrix[MATRIX_HEADER_BYTES + row * side as usize + column] == 1 {
                        for dy in 0..scale {
                            for dx in 0..scale {
                                let y = (row + margin) * scale + dy;
                                let x = (column + margin) * scale + dx;
                                luma[y * pixels + x] = 0;
                            }
                        }
                    }
                }
            }
            let frame = frame_bytes(pixels as u32, pixels as u32, &luma);
            assert_eq!(read_frame(&frame).unwrap(), text);
        }

        #[test]
        fn rejects_frames_whose_size_disagrees_with_their_pixels() {
            assert_eq!(read_frame(&[0; 4]), Err(QrError::BadFrame));
            let short = frame_bytes(4, 4, &[0; 15]);
            assert_eq!(read_frame(&short), Err(QrError::BadFrame));
            let empty = frame_bytes(0, 4, &[]);
            assert_eq!(read_frame(&empty), Err(QrError::BadFrame));
        }

        #[test]
        fn oversized_frames_report_the_size_limit() {
            // One pixel past the 720p pixel budget, and a width past 1280.
            let wide = frame_bytes(1281, 1, &[255; 1281]);
            assert_eq!(read_frame(&wide), Err(QrError::FrameTooLarge));
            let large = frame_bytes(1280, 721, &vec![255; 1280 * 721]);
            assert_eq!(read_frame(&large), Err(QrError::FrameTooLarge));
        }

        #[test]
        fn a_frame_at_the_720p_limit_is_read_not_refused() {
            let blank = frame_bytes(1280, 720, &vec![255; 1280 * 720]);
            assert!(nothing_readable(read_frame(&blank)));
        }

        #[test]
        fn reports_a_frame_without_a_symbol_as_not_found() {
            let blank = frame_bytes(64, 64, &[255; 64 * 64]);
            assert!(nothing_readable(read_frame(&blank)));
        }

        #[test]
        fn scratch_can_be_released_between_frames() {
            let blank = frame_bytes(64, 64, &[255; 64 * 64]);
            assert!(nothing_readable(read_frame(&blank)));
            release_scratch();
            assert!(nothing_readable(read_frame(&blank)));
        }
    }
}
