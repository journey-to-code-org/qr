export type QrErrorCode = 'empty' | 'too-long' | 'not-found' | 'unsupported' | 'uncorrectable' | 'malformed' | 'bad-frame' | 'frame-too-large';

export class QrError extends Error {
  readonly code: QrErrorCode;
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

export interface SvgOptions {
  /** Quiet zone in modules. Default 4. */
  margin?: number;
  dark?: string;
  /** `'transparent'` or `''` for no background. Default `'#fff'`. */
  light?: string;
  /** Gives the image a name for screen readers; without it the SVG is hidden from them. */
  title?: string;
}

export interface Qr {
  encode(input: string | Uint8Array | ArrayBuffer): Code;
  decode(frame: Frame): Uint8Array;
  decodeText(frame: Frame): string;
  svg(code: Code | string | Uint8Array, options?: SvgOptions): string;
}

export function loadQr(source: BufferSource | Response | WebAssembly.Module | string | URL): Promise<Qr>;
export function svg(code: Code, options?: SvgOptions): string;
