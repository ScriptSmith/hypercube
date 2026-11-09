/**
 * Flash measurement for the mirror ball, after the general flash rule for public displays: a
 * flash is a pair of opposing changes in relative luminance of 0.1 or more (where the darker
 * side is below 0.8), and no area larger than a small patch may flash more than three times in
 * any second.
 *
 * Areas are fixed places on the ball, as someone looking at it sees them, while the tiles turn
 * through them. Each tile's slot (mirror and grout) counts at the tile's colour, plus its glint
 * spread over the slot, which overstates the light a little.
 */
import { createRng } from "../../../src/core/rng";
import { sphereInfo } from "../../../src/core/sphere";
import type { SphereInfo } from "../../../src/core/types";
import { createCrowd, createShading, shade, shown } from "../../../src/apps/discoball/light";
import {
  createShow,
  type LightsMode,
  spinAngle,
  type SpinSetting,
  TURN_SECONDS,
} from "../../../src/apps/discoball/show";
import { buildLayout, type Layout, PITCH } from "../../../src/apps/discoball/tiles";

export { maxFlashesPerSecond, transitions } from "../../../src/apps/discoball/safety";

/** A grid of areas over the ball: bands `rows` tile rows tall, cut into pieces about `cols` tiles wide. */
export interface Grid {
  rows: number;
  cols: number;
  /** Shift of the grid, in tiles, so areas straddle the first grid's edges. */
  shift: number;
}

interface Area {
  band: number;
  /** Longitude where it starts, and its width, radians. */
  lon: number;
  width: number;
}

const TAU = 2 * Math.PI;

const areasOf = (grid: Grid): Area[][] => {
  const bands: Area[][] = [];
  const bandRows = grid.rows * PITCH;
  for (let b = 0; b * bandRows < Math.PI; b++) {
    const lo = -Math.PI / 2 + b * bandRows;
    const mid = Math.min(Math.PI / 2, lo + bandRows / 2);
    const n = Math.max(1, Math.floor((TAU * Math.cos(mid)) / (grid.cols * PITCH)));
    const width = TAU / n;
    const shift = (grid.shift / grid.cols) * width;
    bands.push(Array.from({ length: n }, (_, i) => ({ band: b, lon: shift + i * width, width })));
  }
  return bands;
};

export interface Run {
  layout: Layout;
  sphere: SphereInfo;
  /** Seconds simulated. */
  seconds: number;
  /** Frames a second. */
  hz: number;
  /** Luminance of each area of each grid, frame by frame: grid, area, frame. */
  series: Float32Array[][];
  /** Mean luminance of the whole ball, frame by frame. */
  whole: Float32Array;
  /** Most tiles lit at once. */
  maxLit: number;
  /** Reddest flash seen: red's share of the shown colour (after sRGB encoding). */
  reddest: number;
  /** Scene kinds seen. */
  scenes: Set<string>;
}

const encode = (c: number): number =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(0, c), 1 / 2.4) - 0.055;

/** Run the ball for `seconds` from `from`, recording each grid's areas. */
export const simulate = (opts: {
  seed: string;
  lights: LightsMode;
  spin: SpinSetting;
  from: number;
  seconds: number;
  grids: Grid[];
  hz?: number;
}): Run => {
  const hz = opts.hz ?? 60;
  const layout = buildLayout(createRng("discoball:tiles"));
  const sphere = sphereInfo();
  const show = createShow(opts.seed, opts.lights);
  const crowd = createCrowd(opts.seed);
  const shading = createShading(layout);
  const turn = TURN_SECONDS[opts.spin];
  const frames = Math.round(opts.seconds * hz);
  const grids = opts.grids.map(areasOf);
  const series = grids.map((bands) => bands.flat().map(() => new Float32Array(frames)));
  const offsets = grids.map((bands) => {
    const out: number[] = [];
    let k = 0;
    for (const b of bands) {
      out.push(k);
      k += b.length;
    }
    return out;
  });
  const whole = new Float32Array(frames);
  const lum = new Float32Array(layout.count);
  const rgb = [0, 0, 0];
  let maxLit = 0;
  let reddest = 0;
  const scenes = new Set<string>();
  const area = new Float64Array(layout.count);
  for (let i = 0; i < layout.count; i++) {
    const row = layout.rows[layout.row[i]!]!;
    // Share of the sphere's surface in this tile's slot.
    const lo = -Math.PI / 2 + layout.row[i]! * PITCH;
    area[i] = (Math.sin(lo + PITCH) - Math.sin(lo)) / (2 * row.count);
  }

  for (let f = 0; f < frames; f++) {
    const t = opts.from + f / hz;
    const lights = show.at(t);
    scenes.add(lights.scene);
    const theta = spinAngle(t, turn);
    shade(layout, sphere, theta, lights, crowd.at(t, sphere.radius), shading);
    maxLit = Math.max(maxLit, shading.lit);
    let total = 0;
    for (let i = 0; i < layout.count; i++) {
      const o = layout.texel[i]! * 4;
      const g = 0.4 * shading.data[o + 3]!;
      const y = shown(
        shading.data[o]! + g,
        shading.data[o + 1]! + g,
        shading.data[o + 2]! + g,
        rgb,
      );
      lum[i] = y;
      total += y * area[i]!;
      if (shading.flash[i]! > 0.5) {
        const r = encode(rgb[0]!);
        const share = r / (r + encode(rgb[1]!) + encode(rgb[2]!) + 1e-9);
        reddest = Math.max(reddest, share);
      }
    }
    whole[f] = total;

    grids.forEach((bands, gi) => {
      const grid = opts.grids[gi]!;
      const sums = series[gi]!;
      for (const s of sums) s[f] = 0;
      for (let i = 0; i < layout.count; i++) {
        const ri = layout.row[i]!;
        const b = Math.floor(ri / grid.rows);
        const band = bands[b];
        if (!band) continue;
        const row = layout.rows[ri]!;
        const slot = TAU / row.count;
        const n = band.length;
        const width = band[0]!.width;
        const shift = band[0]!.lon;
        // The tile's slot in the room's longitudes, spread over the areas it overlaps.
        let a = (row.offset + layout.index[i]! * slot + theta - shift) % TAU;
        if (a < 0) a += TAU;
        const first = Math.floor(a / width);
        const last = Math.floor((a + slot) / width);
        for (let c = first; c <= last; c++) {
          const take = Math.min(a + slot, (c + 1) * width) - Math.max(a, c * width);
          if (take <= 0) continue;
          sums[offsets[gi]![b]! + (c % n)]![f]! += (lum[i]! * take) / width / grid.rows;
        }
      }
    });
  }
  return { layout, sphere, seconds: opts.seconds, hz, series, whole, maxLit, reddest, scenes };
};
