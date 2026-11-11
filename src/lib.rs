//! QR codes written from scratch (ISO/IEC 18004), with no crates.
//!
//! Two halves: [`encode`] turns bytes into a symbol to draw, and `decode`
//! (behind the `decode` feature, on by default) reads a camera frame back
//! into the bytes. Both support byte mode, level M and versions 1–10, which
//! holds 213 bytes. That covers a link or a signed ticket with room to spare.
//!
//! [`wire`] holds the byte layouts for callers on the other side of a
//! WebAssembly or C boundary.

// Without the decoder, the tables and layout helpers only it uses are unused.
#![cfg_attr(not(feature = "decode"), allow(dead_code))]

#[cfg(feature = "decode")]
pub mod decode;
pub mod encode;
pub mod layout;
pub mod rs;
pub mod tables;
pub mod wire;

#[cfg(feature = "decode")]
pub use decode::{decode, Frame};
pub use encode::{encode, Code, MAX_BYTES};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QrError {
    /// Nothing to encode.
    Empty,
    /// More bytes than version 10 at level M holds.
    TooLong,
    /// The frame doesn't contain a symbol this crate can read.
    NotFound,
    /// A symbol was found but its format is outside byte mode, level M, or
    /// versions 1–10.
    Unsupported,
    /// Too damaged to correct.
    Uncorrectable,
    /// The corrected data isn't a byte-mode payload of the stated length.
    Malformed,
    /// The frame's size is zero, or its pixel count doesn't match its width
    /// and height.
    BadFrame,
    /// The frame exceeds the largest size decode accepts (decode.rs).
    FrameTooLarge,
}

#[cfg(all(test, feature = "decode"))]
mod tests;

#[cfg(all(test, feature = "decode"))]
mod coverage;
