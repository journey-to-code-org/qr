export type QrErrorCode = 'empty' | 'too-long' | 'not-found' | 'unsupported' | 'uncorrectable' | 'malformed' | 'bad-frame' | 'frame-too-large';
export type BarcodeErrorCode = 'empty' | 'invalid-input' | 'invalid-length' | 'invalid-checksum' | 'bad-scanline' | 'not-found';
export type BarcodeType = 'code128' | 'code39' | 'ean13';

export class QrError extends Error {
  readonly code: QrErrorCode;
}

export class BarcodeError extends Error {
  readonly code: BarcodeErrorCode;
}

/** `modules` is `size * size` bytes, row-major, 1 dark, without the quiet zone. */
export interface Code {
  size: number;
  modules: Uint8Array;
}

/** An 8-bit grayscale frame, one byte per pixel, row-major. */
export interface Frame {
  width: number;
  height: number;
  luma: Uint8Array;
}

/** A linear barcode row, including its quiet zones. */
export interface LinearCode {
  type: BarcodeType;
  width: number;
  modules: Uint8Array;
}

export interface DecodedBarcode {
  type: BarcodeType;
  data: string;
}

export type DetectedCode =
  | { type: 'qr'; data: Uint8Array }
  | DecodedBarcode;

export interface SvgOptions {
  /** Quiet zone in modules. Default 4. */
  margin?: number;
  dark?: string;
  /** `'transparent'` or `''` for no background. Default `'#fff'`. */
  light?: string;
  /** Gives the image a name for screen readers; without it the SVG is hidden from them. */
  title?: string;
}

export interface BarcodeSvgOptions {
  /** Bar height in module units. Default 60. */
  height?: number;
  /** Extra white margin outside the encoded quiet zones. Default 0. */
  margin?: number;
  dark?: string;
  light?: string;
  title?: string;
}

export interface Qr {
  encode(input: string | Uint8Array | ArrayBuffer): Code;
  decode(frame: Frame): Uint8Array;
  decodeText(frame: Frame): string;
  svg(code: Code | string | Uint8Array, options?: SvgOptions): string;
  encodeBarcode(format: BarcodeType, input: string | Uint8Array | ArrayBuffer): LinearCode;
  encodeCode128(input: string | Uint8Array | ArrayBuffer): LinearCode;
  encodeCode39(input: string | Uint8Array | ArrayBuffer): LinearCode;
  encodeEan13(input: string | Uint8Array | ArrayBuffer): LinearCode;
  decodeBarcodeScanline(luma: Uint8Array): DecodedBarcode;
  scanFrame(frame: Frame): DetectedCode;
  barcodeSvg(code: LinearCode, options?: BarcodeSvgOptions): string;
}

export function loadQr(source?: BufferSource | Response | WebAssembly.Module | string | URL): Promise<Qr>;
export function svg(code: Code, options?: SvgOptions): string;
export function barcodeSvg(code: LinearCode, options?: BarcodeSvgOptions): string;
