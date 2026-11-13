//! Dependency-free linear barcode encoders and scanline decoder.
//!
//! Encoders return a single row of modules (`1` = dark, `0` = light), including
//! the symbology's quiet zone. The decoder reads a horizontal 8-bit grayscale
//! scanline containing one barcode, dark bars on a lighter background, in
//! either direction.

/// Barcode formats supported by this module.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Symbology {
    Code128,
    Code39,
    Ean13,
}

/// A barcode row, one byte per module (`1` = dark, `0` = light).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinearCode {
    modules: Vec<u8>,
}

impl LinearCode {
    /// The row of modules, including quiet zones.
    pub fn modules(&self) -> &[u8] {
        &self.modules
    }

    /// The width of the row in modules.
    pub fn width(&self) -> usize {
        self.modules.len()
    }
}

/// The decoded symbology and text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedBarcode {
    pub symbology: Symbology,
    pub data: String,
}

/// Errors returned by the linear barcode operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BarcodeError {
    EmptyInput,
    InvalidInput,
    InvalidLength,
    InvalidChecksum,
    BadScanline,
    NotFound,
}

/// Encodes printable ASCII bytes using Code 128 Code Set B.
pub fn encode_code128(data: &[u8]) -> Result<LinearCode, BarcodeError> {
    if data.is_empty() {
        return Err(BarcodeError::EmptyInput);
    }
    if data.iter().any(|&byte| !(32..=126).contains(&byte)) {
        return Err(BarcodeError::InvalidInput);
    }

    let codes: Vec<u8> = data.iter().map(|&byte| byte - 32).collect();
    let mut checksum = 104usize;
    for (index, &code) in codes.iter().enumerate() {
        checksum += usize::from(code) * (index + 1);
    }
    checksum %= 103;

    let mut modules = vec![0; 10];
    append_code128(&mut modules, 104);
    for code in codes {
        append_code128(&mut modules, code);
    }
    append_code128(&mut modules, checksum as u8);
    append_pattern(&mut modules, &CODE128_STOP);
    modules.extend([0; 10]);
    Ok(LinearCode { modules })
}

/// Encodes Code 39's 43-character alphabet (uppercase letters, digits and
/// `-. $/+%`). The start/stop `*` characters are added automatically; no
/// optional Mod-43 check character is added.
pub fn encode_code39(data: &[u8]) -> Result<LinearCode, BarcodeError> {
    if data.is_empty() {
        return Err(BarcodeError::EmptyInput);
    }
    if data.iter().any(|&byte| !CODE39_ALPHABET.contains(&byte)) {
        return Err(BarcodeError::InvalidInput);
    }

    let mut modules = vec![0; 10];
    append_code39_char(&mut modules, b'*');
    for &byte in data {
        modules.push(0);
        append_code39_char(&mut modules, byte);
    }
    modules.push(0);
    append_code39_char(&mut modules, b'*');
    modules.extend([0; 10]);
    Ok(LinearCode { modules })
}

/// Encodes 12 EAN-13 data digits, adding the check digit, or validates and
/// encodes all 13 digits when the check digit is supplied.
pub fn encode_ean13(data: &[u8]) -> Result<LinearCode, BarcodeError> {
    if data.len() != 12 && data.len() != 13 {
        return Err(BarcodeError::InvalidLength);
    }
    if data.iter().any(|&byte| !byte.is_ascii_digit()) {
        return Err(BarcodeError::InvalidInput);
    }

    let check = ean13_check_digit(&data[..12]);
    if data.len() == 13 && data[12] != b'0' + check {
        return Err(BarcodeError::InvalidChecksum);
    }
    let mut digits = [0u8; 13];
    digits[..12].copy_from_slice(&data[..12]);
    digits[12] = b'0' + check;

    let mut modules = vec![0; 11];
    append_bits(&mut modules, 0b101, 3);
    let parity = EAN13_PARITY[(digits[0] - b'0') as usize];
    for index in 0..6 {
        let digit = (digits[index + 1] - b'0') as usize;
        let pattern = if (parity >> (5 - index)) & 1 == 0 {
            EAN13_L[digit]
        } else {
            EAN13_G[digit]
        };
        append_bits(&mut modules, pattern, 7);
    }
    append_bits(&mut modules, 0b01010, 5);
    for &byte in &digits[7..] {
        append_bits(&mut modules, EAN13_R[(byte - b'0') as usize], 7);
    }
    append_bits(&mut modules, 0b101, 3);
    modules.extend([0; 11]);
    Ok(LinearCode { modules })
}

/// Decodes one dark-on-light grayscale scanline containing a Code 128,
/// Code 39, or EAN-13 barcode.
#[cfg(feature = "decode")]
pub fn decode_scanline(luma: &[u8]) -> Result<DecodedBarcode, BarcodeError> {
    let (binary, runs) = scanline_runs(luma)?;
    if let Some(decoded) = decode_from_runs(&binary, &runs) {
        return Ok(decoded);
    }

    let reversed: Vec<bool> = binary.iter().rev().copied().collect();
    let reversed_runs = runs_from_binary(&reversed);
    decode_from_runs(&reversed, &reversed_runs).ok_or(BarcodeError::NotFound)
}

const CODE39_ALPHABET: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%";

// Each 9-bit value marks the wide elements of a Code 39 character.
const CODE39_PATTERNS: [u16; 43] = [
    0x034, 0x121, 0x061, 0x160, 0x031, 0x130, 0x070, 0x025, 0x124, 0x064, 0x109, 0x049, 0x148,
    0x019, 0x118, 0x058, 0x00D, 0x10C, 0x04C, 0x01C, 0x103, 0x043, 0x142, 0x013, 0x112, 0x052,
    0x007, 0x106, 0x046, 0x016, 0x181, 0x0C1, 0x1C0, 0x091, 0x190, 0x0D0, 0x085, 0x184, 0x0C4,
    0x0A8, 0x0A2, 0x08A, 0x02A,
];
const CODE39_START_STOP: u16 = 0x094;

const EAN13_PARITY: [u8; 10] = [0x00, 0x0B, 0x0D, 0x0E, 0x13, 0x19, 0x1C, 0x15, 0x16, 0x1A];
const EAN13_L: [u8; 10] = [
    0b0001101, 0b0011001, 0b0010011, 0b0111101, 0b0100011, 0b0110001, 0b0101111, 0b0111011,
    0b0110111, 0b0001011,
];
const EAN13_G: [u8; 10] = [
    0b0100111, 0b0110011, 0b0011011, 0b0100001, 0b0011101, 0b0111001, 0b0000101, 0b0010001,
    0b0001001, 0b0010111,
];
const EAN13_R: [u8; 10] = [
    0b1110010, 0b1100110, 0b1101100, 0b1000010, 0b1011100, 0b1001110, 0b1010000, 0b1000100,
    0b1001000, 0b1110100,
];

// Codeword patterns as specified by ISO/IEC 15417, represented as six run widths.
const CODE128_PATTERNS: [[u8; 6]; 106] = [
    [2, 1, 2, 2, 2, 2],
    [2, 2, 2, 1, 2, 2],
    [2, 2, 2, 2, 2, 1],
    [1, 2, 1, 2, 2, 3],
    [1, 2, 1, 3, 2, 2],
    [1, 3, 1, 2, 2, 2],
    [1, 2, 2, 2, 1, 3],
    [1, 2, 2, 3, 1, 2],
    [1, 3, 2, 2, 1, 2],
    [2, 2, 1, 2, 1, 3],
    [2, 2, 1, 3, 1, 2],
    [2, 3, 1, 2, 1, 2],
    [1, 1, 2, 2, 3, 2],
    [1, 2, 2, 1, 3, 2],
    [1, 2, 2, 2, 3, 1],
    [1, 1, 3, 2, 2, 2],
    [1, 2, 3, 1, 2, 2],
    [1, 2, 3, 2, 2, 1],
    [2, 2, 3, 2, 1, 1],
    [2, 2, 1, 1, 3, 2],
    [2, 2, 1, 2, 3, 1],
    [2, 1, 3, 2, 1, 2],
    [2, 2, 3, 1, 1, 2],
    [3, 1, 2, 1, 3, 1],
    [3, 1, 1, 2, 2, 2],
    [3, 2, 1, 1, 2, 2],
    [3, 2, 1, 2, 2, 1],
    [3, 1, 2, 2, 1, 2],
    [3, 2, 2, 1, 1, 2],
    [3, 2, 2, 2, 1, 1],
    [2, 1, 2, 1, 2, 3],
    [2, 1, 2, 3, 2, 1],
    [2, 3, 2, 1, 2, 1],
    [1, 1, 1, 3, 2, 3],
    [1, 3, 1, 1, 2, 3],
    [1, 3, 1, 3, 2, 1],
    [1, 1, 2, 3, 1, 3],
    [1, 3, 2, 1, 1, 3],
    [1, 3, 2, 3, 1, 1],
    [2, 1, 1, 3, 1, 3],
    [2, 3, 1, 1, 1, 3],
    [2, 3, 1, 3, 1, 1],
    [1, 1, 2, 1, 3, 3],
    [1, 1, 2, 3, 3, 1],
    [1, 3, 2, 1, 3, 1],
    [1, 1, 3, 1, 2, 3],
    [1, 1, 3, 3, 2, 1],
    [1, 3, 3, 1, 2, 1],
    [3, 1, 3, 1, 2, 1],
    [2, 1, 1, 3, 3, 1],
    [2, 3, 1, 1, 3, 1],
    [2, 1, 3, 1, 1, 3],
    [2, 1, 3, 3, 1, 1],
    [2, 1, 3, 1, 3, 1],
    [3, 1, 1, 1, 2, 3],
    [3, 1, 1, 3, 2, 1],
    [3, 3, 1, 1, 2, 1],
    [3, 1, 2, 1, 1, 3],
    [3, 1, 2, 3, 1, 1],
    [3, 3, 2, 1, 1, 1],
    [3, 1, 4, 1, 1, 1],
    [2, 2, 1, 4, 1, 1],
    [4, 3, 1, 1, 1, 1],
    [1, 1, 1, 2, 2, 4],
    [1, 1, 1, 4, 2, 2],
    [1, 2, 1, 1, 2, 4],
    [1, 2, 1, 4, 2, 1],
    [1, 4, 1, 1, 2, 2],
    [1, 4, 1, 2, 2, 1],
    [1, 1, 2, 2, 1, 4],
    [1, 1, 2, 4, 1, 2],
    [1, 2, 2, 1, 1, 4],
    [1, 2, 2, 4, 1, 1],
    [1, 4, 2, 1, 1, 2],
    [1, 4, 2, 2, 1, 1],
    [2, 4, 1, 2, 1, 1],
    [2, 2, 1, 1, 1, 4],
    [4, 1, 3, 1, 1, 1],
    [2, 4, 1, 1, 1, 2],
    [1, 3, 4, 1, 1, 1],
    [1, 1, 1, 2, 4, 2],
    [1, 2, 1, 1, 4, 2],
    [1, 2, 1, 2, 4, 1],
    [1, 1, 4, 2, 1, 2],
    [1, 2, 4, 1, 1, 2],
    [1, 2, 4, 2, 1, 1],
    [4, 1, 1, 2, 1, 2],
    [4, 2, 1, 1, 1, 2],
    [4, 2, 1, 2, 1, 1],
    [2, 1, 2, 1, 4, 1],
    [2, 1, 4, 1, 2, 1],
    [4, 1, 2, 1, 2, 1],
    [1, 1, 1, 1, 4, 3],
    [1, 1, 1, 3, 4, 1],
    [1, 3, 1, 1, 4, 1],
    [1, 1, 4, 1, 1, 3],
    [1, 1, 4, 3, 1, 1],
    [4, 1, 1, 1, 1, 3],
    [4, 1, 1, 3, 1, 1],
    [1, 1, 3, 1, 4, 1],
    [1, 1, 4, 1, 3, 1],
    [3, 1, 1, 1, 4, 1],
    [4, 1, 1, 1, 3, 1],
    [2, 1, 1, 4, 1, 2],
    [2, 1, 1, 2, 1, 4],
    [2, 1, 1, 2, 3, 2],
];
const CODE128_STOP: [u8; 7] = [2, 3, 3, 1, 1, 1, 2];

fn append_code128(modules: &mut Vec<u8>, code: u8) {
    append_pattern(modules, &CODE128_PATTERNS[code as usize]);
}

fn append_code39_char(modules: &mut Vec<u8>, byte: u8) {
    let pattern = if byte == b'*' {
        CODE39_START_STOP
    } else {
        let index = CODE39_ALPHABET
            .iter()
            .position(|&candidate| candidate == byte)
            .expect("validated Code 39 input");
        CODE39_PATTERNS[index]
    };
    let mut dark = true;
    for shift in (0..9).rev() {
        let width = if (pattern >> shift) & 1 == 1 { 2 } else { 1 };
        modules.extend(std::iter::repeat_n(u8::from(dark), width));
        dark = !dark;
    }
}

fn append_pattern(modules: &mut Vec<u8>, widths: &[u8]) {
    let mut dark = true;
    for &width in widths {
        modules.extend(std::iter::repeat_n(u8::from(dark), usize::from(width)));
        dark = !dark;
    }
}

fn append_bits(modules: &mut Vec<u8>, bits: u8, width: usize) {
    for shift in (0..width).rev() {
        modules.push((bits >> shift) & 1);
    }
}

fn ean13_check_digit(digits: &[u8]) -> u8 {
    let sum: usize = digits
        .iter()
        .enumerate()
        .map(|(index, byte)| usize::from(byte - b'0') * if index.is_multiple_of(2) { 1 } else { 3 })
        .sum();
    ((10 - sum % 10) % 10) as u8
}

#[cfg(feature = "decode")]
#[derive(Clone, Copy)]
struct Run {
    dark: bool,
    start: usize,
    width: usize,
}

#[cfg(feature = "decode")]
fn scanline_runs(luma: &[u8]) -> Result<(Vec<bool>, Vec<Run>), BarcodeError> {
    if luma.is_empty() {
        return Err(BarcodeError::BadScanline);
    }
    let min = *luma.iter().min().ok_or(BarcodeError::BadScanline)?;
    let max = *luma.iter().max().ok_or(BarcodeError::BadScanline)?;
    if max.saturating_sub(min) < 32 {
        return Err(BarcodeError::BadScanline);
    }
    let threshold = (u16::from(min) + u16::from(max)) / 2;
    let binary: Vec<bool> = luma
        .iter()
        .map(|&pixel| u16::from(pixel) < threshold)
        .collect();
    let runs = runs_from_binary(&binary);
    Ok((binary, runs))
}

#[cfg(feature = "decode")]
fn runs_from_binary(binary: &[bool]) -> Vec<Run> {
    let mut runs = Vec::new();
    let mut start = 0;
    while start < binary.len() {
        let dark = binary[start];
        let mut end = start + 1;
        while end < binary.len() && binary[end] == dark {
            end += 1;
        }
        runs.push(Run {
            dark,
            start,
            width: end - start,
        });
        start = end;
    }
    runs
}

#[cfg(feature = "decode")]
fn decode_from_runs(binary: &[bool], runs: &[Run]) -> Option<DecodedBarcode> {
    decode_code128_runs(runs)
        .or_else(|| decode_code39_runs(runs))
        .or_else(|| decode_ean13(binary, runs))
}

#[cfg(feature = "decode")]
fn decode_code128_runs(runs: &[Run]) -> Option<DecodedBarcode> {
    for (start, _) in runs.iter().enumerate().filter(|(_, run)| run.dark) {
        let mut at = start;
        if match_code128(runs, at, &CODE128_PATTERNS[104]).is_none() {
            continue;
        }
        at += 6;
        let mut codes = Vec::new();
        let mut found_stop = false;
        loop {
            if match_runs(runs, at, &CODE128_STOP).is_some() {
                found_stop = true;
                break;
            }
            let Some((code, _)) = match_code128_any(runs, at) else {
                break;
            };
            if code > 102 {
                break;
            }
            codes.push(code);
            at += 6;
        }
        if !found_stop || codes.is_empty() {
            continue;
        }
        let check = codes.pop()?;
        let expected = codes
            .iter()
            .enumerate()
            .fold(104usize, |sum, (index, code)| {
                sum + usize::from(*code) * (index + 1)
            })
            % 103;
        if usize::from(check) != expected || codes.iter().any(|&code| code > 95) {
            continue;
        }
        let data: String = codes
            .into_iter()
            .map(|code| char::from(code + 32))
            .collect();
        return Some(DecodedBarcode {
            symbology: Symbology::Code128,
            data,
        });
    }
    None
}

#[cfg(feature = "decode")]
fn match_code128_any(runs: &[Run], at: usize) -> Option<(u8, f64)> {
    let mut best = None;
    for (code, pattern) in CODE128_PATTERNS.iter().enumerate() {
        if let Some(error) = match_code128(runs, at, pattern) {
            if best.is_none_or(|(_, best_error)| error < best_error) {
                best = Some((code as u8, error));
            }
        }
    }
    best
}

#[cfg(feature = "decode")]
fn match_code128(runs: &[Run], at: usize, pattern: &[u8; 6]) -> Option<f64> {
    let widths = runs.get(at..at + 6)?;
    if widths
        .iter()
        .enumerate()
        .any(|(index, run)| run.dark != index.is_multiple_of(2))
    {
        return None;
    }
    match_runs(runs, at, pattern)
}

#[cfg(feature = "decode")]
fn decode_code39_runs(runs: &[Run]) -> Option<DecodedBarcode> {
    for (start, _) in runs.iter().enumerate().filter(|(_, run)| run.dark) {
        if match_code39_char(runs, start, CODE39_START_STOP).is_none() {
            continue;
        }
        let mut at = start + 9;
        let mut data = String::new();
        loop {
            if runs.get(at).is_none_or(|gap| gap.dark) {
                break;
            }
            at += 1;
            let Some(code) = match_code39_any(runs, at) else {
                break;
            };
            at += 9;
            if code == b'*' {
                if data.is_empty() {
                    break;
                }
                return Some(DecodedBarcode {
                    symbology: Symbology::Code39,
                    data,
                });
            }
            data.push(char::from(code));
        }
    }
    None
}

#[cfg(feature = "decode")]
fn match_code39_any(runs: &[Run], at: usize) -> Option<u8> {
    if match_code39_char(runs, at, CODE39_START_STOP).is_some() {
        return Some(b'*');
    }
    for (index, &pattern) in CODE39_PATTERNS.iter().enumerate() {
        if match_code39_char(runs, at, pattern).is_some() {
            return Some(CODE39_ALPHABET[index]);
        }
    }
    None
}

#[cfg(feature = "decode")]
fn match_code39_char(runs: &[Run], at: usize, pattern: u16) -> Option<f64> {
    let widths = runs.get(at..at + 9)?;
    if !widths[0].dark
        || widths
            .iter()
            .enumerate()
            .any(|(i, run)| run.dark != i.is_multiple_of(2))
    {
        return None;
    }
    let expected: [u8; 9] =
        std::array::from_fn(|i| if (pattern >> (8 - i)) & 1 == 1 { 2 } else { 1 });
    let actual: [usize; 9] = std::array::from_fn(|i| widths[i].width);
    match_widths(&actual, &expected)
}

#[cfg(feature = "decode")]
fn decode_ean13(binary: &[bool], runs: &[Run]) -> Option<DecodedBarcode> {
    for (index, run) in runs.iter().enumerate().filter(|(_, run)| run.dark) {
        let Some(guard) = runs.get(index..index + 3) else {
            continue;
        };
        if !guard[1].dark && guard[2].dark {
            let unit = (guard[0].width + guard[1].width + guard[2].width) as f64 / 3.0;
            if unit < 1.0
                || guard
                    .iter()
                    .any(|part| (part.width as f64 - unit).abs() > unit * 0.4)
            {
                continue;
            }
            let mut modules = [0u8; 95];
            let start = run.start;
            if start as f64 + unit * 95.0 > binary.len() as f64 {
                continue;
            }
            for (module, bit) in modules.iter_mut().enumerate() {
                let pixel = (start as f64 + (module as f64 + 0.5) * unit) as usize;
                *bit = u8::from(binary[pixel]);
            }
            if modules[0..3] != [1, 0, 1]
                || modules[45..50] != [0, 1, 0, 1, 0]
                || modules[92..95] != [1, 0, 1]
            {
                continue;
            }

            let mut digits = [0u8; 13];
            let mut parity = 0u8;
            let mut valid = true;
            for digit_index in 0..6 {
                let bits = read_bits(&modules[3 + digit_index * 7..10 + digit_index * 7]);
                if let Some(digit) = EAN13_L.iter().position(|&pattern| pattern == bits) {
                    digits[digit_index + 1] = b'0' + digit as u8;
                } else if let Some(digit) = EAN13_G.iter().position(|&pattern| pattern == bits) {
                    digits[digit_index + 1] = b'0' + digit as u8;
                    parity |= 1 << (5 - digit_index);
                } else {
                    valid = false;
                    break;
                }
            }
            if !valid {
                continue;
            }
            let Some(first) = EAN13_PARITY.iter().position(|&value| value == parity) else {
                continue;
            };
            digits[0] = b'0' + first as u8;
            for digit_index in 0..6 {
                let bits = read_bits(&modules[50 + digit_index * 7..57 + digit_index * 7]);
                let Some(digit) = EAN13_R.iter().position(|&pattern| pattern == bits) else {
                    valid = false;
                    break;
                };
                digits[digit_index + 7] = b'0' + digit as u8;
            }
            if !valid || ean13_check_digit(&digits[..12]) != digits[12] - b'0' {
                continue;
            }
            return Some(DecodedBarcode {
                symbology: Symbology::Ean13,
                data: String::from_utf8_lossy(&digits).into_owned(),
            });
        }
    }
    None
}

#[cfg(feature = "decode")]
fn read_bits(bits: &[u8]) -> u8 {
    bits.iter().fold(0, |value, &bit| (value << 1) | bit)
}

#[cfg(feature = "decode")]
fn match_runs(runs: &[Run], at: usize, expected: &[u8]) -> Option<f64> {
    let widths = runs.get(at..at + expected.len())?;
    if !widths[0].dark
        || widths
            .iter()
            .enumerate()
            .any(|(index, run)| run.dark != index.is_multiple_of(2))
    {
        return None;
    }
    let actual: [usize; 7] =
        std::array::from_fn(|index| widths.get(index).map_or(0, |run| run.width));
    match_widths(&actual[..expected.len()], expected)
}

#[cfg(feature = "decode")]
fn match_widths(actual: &[usize], expected: &[u8]) -> Option<f64> {
    if actual.len() != expected.len() {
        return None;
    }
    let actual_sum: usize = actual.iter().sum();
    let expected_sum: usize = expected.iter().map(|&width| usize::from(width)).sum();
    let unit = actual_sum as f64 / expected_sum as f64;
    let error = actual
        .iter()
        .zip(expected)
        .map(|(&observed, &wanted)| (observed as f64 - f64::from(wanted) * unit).abs())
        .sum::<f64>()
        / actual_sum as f64;
    if error <= 0.25
        && actual.iter().zip(expected).all(|(&observed, &wanted)| {
            (observed as f64 - f64::from(wanted) * unit).abs() <= unit * 0.7
        })
    {
        Some(error)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scanline(code: &LinearCode, scale: usize) -> Vec<u8> {
        let mut pixels = vec![255; code.width() * scale];
        for (index, &module) in code.modules().iter().enumerate() {
            if module == 1 {
                pixels[index * scale..(index + 1) * scale].fill(0);
            }
        }
        pixels
    }

    #[cfg(feature = "decode")]
    #[test]
    fn code128_encodes_and_decodes_printable_ascii() {
        let code = encode_code128(b"AB-123").unwrap();
        let expected = DecodedBarcode {
            symbology: Symbology::Code128,
            data: "AB-123".into(),
        };
        let pixels = scanline(&code, 3);
        assert_eq!(decode_scanline(&pixels).unwrap(), expected);
        assert_eq!(
            decode_scanline(&pixels.into_iter().rev().collect::<Vec<_>>()).unwrap(),
            expected
        );
        assert_eq!(encode_code128(b"\n"), Err(BarcodeError::InvalidInput));
    }

    #[cfg(feature = "decode")]
    #[test]
    fn code39_encodes_and_decodes_its_alphabet() {
        let code = encode_code39(b"QR-42 $").unwrap();
        assert_eq!(
            decode_scanline(&scanline(&code, 2)).unwrap(),
            DecodedBarcode {
                symbology: Symbology::Code39,
                data: "QR-42 $".into(),
            }
        );
        assert_eq!(encode_code39(b"lower"), Err(BarcodeError::InvalidInput));
    }

    #[cfg(feature = "decode")]
    #[test]
    fn ean13_adds_and_checks_the_check_digit() {
        let code = encode_ean13(b"400638133393").unwrap();
        assert_eq!(code.width(), 117);
        assert_eq!(
            decode_scanline(&scanline(&code, 4)).unwrap(),
            DecodedBarcode {
                symbology: Symbology::Ean13,
                data: "4006381333931".into(),
            }
        );
        assert_eq!(
            encode_ean13(b"4006381333932"),
            Err(BarcodeError::InvalidChecksum)
        );
    }

    #[cfg(feature = "decode")]
    #[test]
    fn rejects_empty_or_low_contrast_scanlines() {
        assert_eq!(decode_scanline(&[]), Err(BarcodeError::BadScanline));
        assert_eq!(decode_scanline(&[100; 20]), Err(BarcodeError::BadScanline));
    }

    #[test]
    fn all_encoders_add_light_quiet_zones() {
        for (code, quiet_zone) in [
            (encode_code128(b"A").unwrap(), 10),
            (encode_code39(b"A").unwrap(), 10),
            (encode_ean13(b"400638133393").unwrap(), 11),
        ] {
            assert!(code.modules()[..quiet_zone]
                .iter()
                .all(|&module| module == 0));
            assert!(code.modules()[code.width() - quiet_zone..]
                .iter()
                .all(|&module| module == 0));
        }
    }

    #[test]
    fn encoders_reject_empty_and_invalid_data() {
        assert_eq!(encode_code128(b""), Err(BarcodeError::EmptyInput));
        assert_eq!(encode_code39(b""), Err(BarcodeError::EmptyInput));
        assert_eq!(encode_ean13(b""), Err(BarcodeError::InvalidLength));
        assert_eq!(encode_code39(b"lower"), Err(BarcodeError::InvalidInput));
        assert_eq!(
            encode_ean13(b"40063813339x"),
            Err(BarcodeError::InvalidInput)
        );
    }
}
