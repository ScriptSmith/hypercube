/**
 * Measures flashing in the drawn picture, for tests (the debug hook's `measure`): the ball is
 * drawn small, frame by frame, and the mean luminance of places about four tiles square in the
 * band people see, and of the whole ball, is checked against the flash rule.
 */
import { type WebGLRenderer, WebGLRenderTarget } from "three";
import type { SphereInfo } from "../../core/types";
import { maxFlashesPerSecond } from "./safety";
import { PITCH } from "./tiles";

export interface FlashReport {
  frames: number;
  /** Places measured. */
  areas: number;
  /** Most flashes in any second at any place. */
  worst: number;
  /** Most flashes in any second over the whole ball. */
  whole: number;
  /** Tiles lit at once, on average. */
  meanLit: number;
}

/** Rows of tiles (and roughly tiles across) in each place measured. */
const PLACE = 4;
const LIMIT = (75 * Math.PI) / 180;

export const measureFlashes = (opts: {
  renderer: WebGLRenderer;
  sphere: SphereInfo;
  width: number;
  seconds: number;
  hz: number;
  /** Draw the ball at show time `now` into `target`, and return the tiles lit. */
  draw(now: number, target: WebGLRenderTarget): number;
  start: number;
}): FlashReport => {
  const w = Math.max(64, Math.round(opts.width));
  const h = Math.round(w / 2);
  const target = new WebGLRenderTarget(w, h, { depthBuffer: false });
  const pixels = new Uint8Array(w * h * 4);
  const { cover, view } = opts.sphere;
  const latOf = (y: number) => cover.bottom + ((y + 0.5) / h) * (cover.top - cover.bottom);

  // Each pixel row's band of places and each pixel's place within it.
  const bandRows = PLACE * PITCH;
  const rowPlace = new Int32Array(h).fill(-1);
  const bandStart: number[] = [];
  const bandCount: number[] = [];
  let places = 0;
  for (let y = 0; y < h; y++) {
    const lat = latOf(y);
    if (lat < Math.max(view.bottom, -LIMIT) || lat > Math.min(view.top, LIMIT)) continue;
    const band = Math.floor((lat + Math.PI / 2) / bandRows);
    if (bandStart[band] === undefined) {
      const mid = -Math.PI / 2 + (band + 0.5) * bandRows;
      bandCount[band] = Math.max(1, Math.floor((2 * Math.PI * Math.cos(mid)) / bandRows));
      bandStart[band] = places;
      places += bandCount[band]!;
    }
    rowPlace[y] = band;
  }
  const frames = Math.round(opts.seconds * opts.hz);
  const series = Array.from({ length: places }, () => new Float32Array(frames));
  const counts = new Float32Array(places);
  const whole = new Float32Array(frames);
  let litSum = 0;

  for (let f = 0; f < frames; f++) {
    litSum += opts.draw(opts.start + f / opts.hz, target);
    opts.renderer.readRenderTargetPixels(target, 0, 0, w, h, pixels);
    counts.fill(0);
    let sum = 0;
    let weight = 0;
    for (let y = 0; y < h; y++) {
      const c = Math.cos(latOf(y));
      const band = rowPlace[y]!;
      const n = band >= 0 ? bandCount[band]! : 0;
      const first = band >= 0 ? bandStart[band]! : 0;
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        // Render targets hold linear colour.
        const lum = (0.2126 * pixels[o]! + 0.7152 * pixels[o + 1]! + 0.0722 * pixels[o + 2]!) / 255;
        sum += lum * c;
        weight += c;
        if (band < 0) continue;
        const p = first + Math.min(n - 1, Math.floor((x * n) / w));
        series[p]![f]! += lum;
        counts[p]! += 1;
      }
    }
    for (let p = 0; p < places; p++) series[p]![f]! /= Math.max(1, counts[p]!);
    whole[f] = sum / weight;
  }
  target.dispose();
  let worst = 0;
  for (const s of series) worst = Math.max(worst, maxFlashesPerSecond(s, opts.hz));
  return {
    frames,
    areas: places,
    worst,
    whole: maxFlashesPerSecond(whole, opts.hz),
    meanLit: litSum / Math.max(1, frames),
  };
};
