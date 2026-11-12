//! The C ABI a WebAssembly host calls (`js/qr.js` is one). Built on every
//! target, so native tests drive it the way a browser does.
//!
//! The host asks for memory with [`qr_alloc`], copies its input in, calls
//! [`qr_encode`] or `qr_decode`, and reads the answer from
//! [`qr_result_ptr`] / [`qr_result_len`] before the next call. Each call
//! returns 0, or a [`QrError`] as [`error_code`] numbers it. The input
//! layouts and the answer's layout are [`crate::wire`]'s.

use std::sync::Mutex;

use crate::{wire, QrError};

/// The last answer, kept until the next call. One instance is single-threaded;
/// the lock is for native builds.
static RESULT: Mutex<Vec<u8>> = Mutex::new(Vec::new());

/// A stable number for each error, for the host to name it.
pub fn error_code(error: QrError) -> i32 {
    match error {
        QrError::Empty => 1,
        QrError::TooLong => 2,
        QrError::NotFound => 3,
        QrError::Unsupported => 4,
        QrError::Uncorrectable => 5,
        QrError::Malformed => 6,
        QrError::BadFrame => 7,
        QrError::FrameTooLarge => 8,
    }
}

fn answer(result: Result<Vec<u8>, QrError>) -> i32 {
    let mut kept = RESULT
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    match result {
        Ok(bytes) => {
            *kept = bytes;
            0
        }
        Err(error) => {
            kept.clear();
            error_code(error)
        }
    }
}

/// Memory for `len` bytes of input, owned by the host until [`qr_free`].
#[no_mangle]
pub extern "C" fn qr_alloc(len: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(len.max(1));
    let pointer = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    pointer
}

/// Gives back memory from [`qr_alloc`].
///
/// # Safety
/// `pointer` and `len` must be exactly what one `qr_alloc(len)` returned and
/// was given, and it must not be freed twice.
#[no_mangle]
pub unsafe extern "C" fn qr_free(pointer: *mut u8, len: usize) {
    drop(Vec::from_raw_parts(pointer, 0, len.max(1)));
}

/// Encodes `len` bytes at `pointer`; the answer is a `KQRM` matrix.
///
/// # Safety
/// `pointer` must point at `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn qr_encode(pointer: *const u8, len: usize) -> i32 {
    let data = if len == 0 {
        &[][..]
    } else {
        std::slice::from_raw_parts(pointer, len)
    };
    answer(wire::matrix(data))
}

/// Reads a frame (`wire::read_frame`'s layout) of `len` bytes at `pointer`;
/// the answer is the payload.
///
/// # Safety
/// `pointer` must point at `len` readable bytes.
#[cfg(feature = "decode")]
#[no_mangle]
pub unsafe extern "C" fn qr_decode(pointer: *const u8, len: usize) -> i32 {
    let input = if len == 0 {
        &[][..]
    } else {
        std::slice::from_raw_parts(pointer, len)
    };
    answer(wire::read_frame(input))
}

/// Where the last answer starts. Valid until the next call.
#[no_mangle]
pub extern "C" fn qr_result_ptr() -> *const u8 {
    RESULT
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .as_ptr()
}

/// How long the last answer is.
#[no_mangle]
pub extern "C" fn qr_result_len() -> usize {
    RESULT
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .len()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// As a host does: copy in, call, copy the answer out, free.
    fn call(
        f: unsafe extern "C" fn(*const u8, usize) -> i32,
        input: &[u8],
    ) -> Result<Vec<u8>, i32> {
        let pointer = qr_alloc(input.len());
        unsafe {
            std::ptr::copy_nonoverlapping(input.as_ptr(), pointer, input.len());
            let code = f(pointer, input.len());
            let out = std::slice::from_raw_parts(qr_result_ptr(), qr_result_len()).to_vec();
            qr_free(pointer, input.len());
            if code == 0 {
                Ok(out)
            } else {
                assert!(out.is_empty(), "an error leaves no answer");
                Err(code)
            }
        }
    }

    #[test]
    fn encode_answers_the_same_matrix_as_wire() {
        let text = b"https://potomac.solutions/t/8F3K";
        assert_eq!(call(qr_encode, text).unwrap(), wire::matrix(text).unwrap());
    }

    #[test]
    fn errors_come_back_as_their_numbers() {
        assert_eq!(call(qr_encode, b""), Err(1));
        assert_eq!(call(qr_encode, &[b'a'; crate::MAX_BYTES + 1]), Err(2));
    }

    #[test]
    fn every_error_has_its_own_number() {
        use QrError::*;
        let all = [
            Empty,
            TooLong,
            NotFound,
            Unsupported,
            Uncorrectable,
            Malformed,
            BadFrame,
            FrameTooLarge,
        ];
        let mut codes: Vec<i32> = all.iter().map(|&e| error_code(e)).collect();
        codes.sort();
        codes.dedup();
        assert_eq!(codes, (1..=8).collect::<Vec<_>>());
    }

    #[cfg(feature = "decode")]
    #[test]
    fn decode_reads_back_what_encode_drew() {
        let text = b"potomac://ticket/0042";
        let matrix = call(qr_encode, text).unwrap();
        let side = u32::from_le_bytes(matrix[8..12].try_into().unwrap()) as usize;
        let (scale, margin) = (4, 4);
        let pixels = (side + 2 * margin) * scale;
        let mut frame = Vec::new();
        frame.extend_from_slice(&(pixels as u32).to_le_bytes());
        frame.extend_from_slice(&(pixels as u32).to_le_bytes());
        let mut luma = vec![255u8; pixels * pixels];
        for row in 0..side {
            for column in 0..side {
                if matrix[wire::MATRIX_HEADER_BYTES + row * side + column] == 1 {
                    for dy in 0..scale {
                        for dx in 0..scale {
                            luma[((row + margin) * scale + dy) * pixels
                                + (column + margin) * scale
                                + dx] = 0;
                        }
                    }
                }
            }
        }
        frame.extend_from_slice(&luma);
        assert_eq!(call(qr_decode, &frame).unwrap(), text);
        assert_eq!(call(qr_decode, &[0; 3]), Err(7));
    }
}

/// The codes the JavaScript tests (`js/test/`) expect from the WebAssembly
/// build, made by this native build. `UPDATE_FIXTURES=1 cargo test` rewrites
/// them; otherwise a native encoder that drew differently fails here first.
#[cfg(test)]
mod fixtures {
    const PATH: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/js/test/fixtures.txt");

    fn texts() -> Vec<Vec<u8>> {
        let mut texts: Vec<Vec<u8>> = vec![
            b"https://potomac.solutions/t/8F3K".to_vec(),
            b"kin://invite/abc".to_vec(),
            "Caf\u{e9} \u{2615} \u{1f6f6} Garrett County"
                .as_bytes()
                .to_vec(),
            (0u8..=255).take(200).collect(),
        ];
        // Each version's last byte count and the next, so every version 1-10 appears.
        for n in [
            1, 14, 15, 26, 27, 42, 43, 62, 63, 84, 85, 106, 107, 122, 123, 152, 153, 180, 181, 213,
        ] {
            texts.push((0..n).map(|i| b'a' + (i % 26) as u8).collect());
        }
        texts
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    fn render() -> String {
        let mut out = String::from("# hex payload, side, modules (row-major, 1 dark). Made by `UPDATE_FIXTURES=1 cargo test`.\n");
        for text in texts() {
            let code = crate::encode(&text).unwrap();
            let modules: String = code
                .modules()
                .iter()
                .map(|&m| if m == 1 { '1' } else { '0' })
                .collect();
            out.push_str(&format!("{}\t{}\t{}\n", hex(&text), code.size, modules));
        }
        out
    }

    #[test]
    fn javascript_fixtures_match_the_native_encoder() {
        let made = render();
        if std::env::var_os("UPDATE_FIXTURES").is_some() {
            std::fs::write(PATH, &made).unwrap();
        }
        let kept = std::fs::read_to_string(PATH)
            .expect("js/test/fixtures.txt (UPDATE_FIXTURES=1 cargo test makes it)");
        assert!(kept == made, "js/test/fixtures.txt differs from the native encoder; run UPDATE_FIXTURES=1 cargo test");
        let sides: std::collections::BTreeSet<usize> = made
            .lines()
            .skip(1)
            .map(|l| l.split('\t').nth(1).unwrap().parse().unwrap())
            .collect();
        assert_eq!(
            sides.into_iter().collect::<Vec<_>>(),
            (1..=10).map(|v| 17 + 4 * v).collect::<Vec<_>>(),
            "every version 1-10 is covered"
        );
    }
}
