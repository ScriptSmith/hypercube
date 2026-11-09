export interface Image {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel. */
  data: Uint8Array;
}

export function decodePng(buf: Buffer | Uint8Array): Image;
export function pixelStats(img: Image): { mean: number; stddev: number };
export const BLANK_STDDEV: number;
