/**
 * What each tile shows, worked out once a frame on the CPU and handed to the shader as one
 * texel per tile. A tile is a flat mirror, so the whole tile is one colour:
 *
 * - The room: a dark room with dim glows on the walls, a faintly lit floor and small lamps here
 *   and there, seen in the direction the mirror faces (for someone straight in front of it).
 * - A flash: a spotlight's beam bounced off the tile towards someone's eyes. Each beam is
 *   followed from the tile to the eye height of each of a few people standing round and under
 *   the ball; the tile lights while its beam's spot passes over one of them. That is what
 *   makes a mirror ball sparkle, and since the beams follow the turning tiles, sparkles come
 *   and go as the ball turns and drift as the lights and people move. A short afterglow and a
 *   gate that spaces out sparkles starting close together keep every part of the ball within
 *   the flash rule (see `safety.ts`).
 *
 * The same numbers drive the picture and the flash-rate tests.
 */
import { createRng } from "../../core/rng";
import type { SphereInfo } from "../../core/types";
import type { LightsNow } from "./show";
import { type Layout, PITCH, ROWS, TEX_WIDTH, TILE } from "./tiles";

/** Someone looking at the ball: where they stand (metres from the spot under it) and their eye height. */
export interface Viewer {
  x: number;
  z: number;
  eye: number;
}

interface ViewerPlan {
  az: number;
  /** Distance from the axis, in radii. */
  r: number;
  eye: number;
  wander: number;
  period: number;
  phase: number;
}

export interface Crowd {
  readonly size: number;
  /** Where everyone is at `t` round a ball of `radius` metres. The result is reused. */
  at(t: number, radius: number): readonly Viewer[];
}

/**
 * A few people: some right underneath, more round about, children among them. They drift
 * slowly about, so the places where sparkles gather drift too.
 */
export const createCrowd = (seed: string | number): Crowd => {
  const rng = createRng(`${seed}:discoball:crowd`);
  const plans: ViewerPlan[] = [];
  const rings: [number, number, number][] = [
    [4, 0.15, 0.6],
    [7, 1.0, 2.0],
    [9, 2.0, 3.4],
  ];
  let k = 0;
  for (const [n, lo, hi] of rings) {
    for (let i = 0; i < n; i++, k++) {
      plans.push({
        // Golden-angle spacing keeps the rings from lining up.
        az: k * 2.39996 + rng.range(-0.2, 0.2),
        r: rng.range(lo, hi),
        eye: rng.next() < 0.3 ? rng.range(1.0, 1.25) : rng.range(1.5, 1.75),
        wander: rng.range(0.15, 0.4),
        period: rng.range(70, 180),
        phase: rng.range(0, Math.PI * 2),
      });
    }
  }
  const out: Viewer[] = plans.map(() => ({ x: 0, z: 0, eye: 1.6 }));
  return {
    size: plans.length,
    at(t, radius) {
      plans.forEach((p, i) => {
        const s = Math.sin((2 * Math.PI * t) / p.period + p.phase);
        const c = Math.cos((2 * Math.PI * t) / (p.period * 1.31) + p.phase);
        const az = p.az + p.wander * s;
        const r = Math.max(0, p.r + 0.12 * c) * radius;
        const v = out[i]!;
        v.x = r * Math.sin(az);
        v.z = r * Math.cos(az);
        v.eye = p.eye;
      });
      return out;
    },
  };
};

/**
 * Radius round each viewer that a beam's spot must cover to be seen, metres: a few people's
 * eyes, which keeps each sparkle long enough to glow rather than blink.
 */
export const EYE_REACH = 0.2;
/**
 * Seconds a flash takes to fade after its beam has passed. The eye keeps a bright point a
 * moment longer too; here it merges flashes that follow each other through the same place.
 */
export const AFTERGLOW = 0.1;

/**
 * A sparkle may start only if no other has started within `GATE_REACH` tiles of the same place
 * on the ball in the last `GATE_GAP` seconds; one held back stays dark until its beam has
 * passed. So any three by three tiles start at most three sparkles a second, whatever the
 * lights and the spin do.
 */
export const GATE_REACH = 2;
export const GATE_GAP = 0.34;
const GATE_ON = 0.2;
const GATE_OFF = 0.05;
/** Viewers' eyes are between `EYE_MID - EYE_SPAN` and `EYE_MID + EYE_SPAN` above the floor. */
const EYE_MID = 1.375;
const EYE_SPAN = 0.4;
/** How far a beam spreads on top of the lamp's own size, radians (tiles aren't quite flat). */
const SPREAD = 0.004;
/** A flash at or above this lights a cross-shaped glint over the grout. */
export const GLINT_FROM = 0.7;

/** Frames between refreshes of the room a tile shows: its reflection moves a fifth of a degree a frame. */
const ROOM_EVERY = 3;
const HAZE_WIDTH = 0.24;
const HAZE_LEVEL = 0.018;
const CEILING = 0.004;
const AMBIENT = 0.004;
/** Dim walls, people and furniture, lit by the show's spill. */
const WALL = 0.022;
/** Silvered glass is a touch blue. */
const SILVER = [0.93, 0.96, 1] as const;

const hash = (a: number, b: number, salt: number): number => {
  let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(salt + 1, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

const TAU = 2 * Math.PI;
/** The room's unevenness: smooth noise over directions, in cells about 8 degrees across. */
const NOISE_COLS = 45;
const NOISE_CELL = TAU / NOISE_COLS;

// Noise values at the cell corners, worked out once: rows from the bottom pole to the top.
const NOISE_BASE = 64 - Math.ceil(Math.PI / 2 / NOISE_CELL) - 1;
const NOISE_ROWS = 2 * (64 - NOISE_BASE) + 2;
const noiseTable = (salt: number): Float32Array => {
  const out = new Float32Array(NOISE_COLS * NOISE_ROWS);
  for (let j = 0; j < NOISE_ROWS; j++) {
    for (let i = 0; i < NOISE_COLS; i++) out[j * NOISE_COLS + i] = hash(i, NOISE_BASE + j, salt);
  }
  return out;
};
const WALL_NOISE = noiseTable(1);
const FLOOR_NOISE = noiseTable(2);

const roomNoise = (az: number, el: number, table: Float32Array): number => {
  const x = (az / TAU + 0.5) * NOISE_COLS;
  const y = el / NOISE_CELL + 64 - NOISE_BASE;
  const ix = Math.floor(x);
  const iy = Math.max(0, Math.min(NOISE_ROWS - 2, Math.floor(y)));
  let fx = x - ix;
  let fy = Math.max(0, Math.min(1, y - iy));
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const x0 = ((ix % NOISE_COLS) + NOISE_COLS) % NOISE_COLS;
  const x1 = (x0 + 1) % NOISE_COLS;
  const a = table[iy * NOISE_COLS + x0]!;
  const b = table[iy * NOISE_COLS + x1]!;
  const c = table[(iy + 1) * NOISE_COLS + x0]!;
  const d = table[(iy + 1) * NOISE_COLS + x1]!;
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
};

/**
 * Small lamps scattered over the walls (wall lights, a bar, a glowing sign), one at most in
 * each cell of a grid over directions. A tile catches one for a moment as it turns.
 */
const LAMP_COLS = 30;
const LAMP_AZ = TAU / LAMP_COLS;
const LAMP_EL = 0.17;
const LAMP_LOW = -0.35;
const LAMP_ROWS = 6;
const LAMP_COLORS: readonly (readonly [number, number, number])[] = [
  [1, 0.72, 0.42],
  [1, 0.55, 0.2],
  [0.6, 0.75, 1],
  [0.35, 1, 0.5],
  [1, 0.95, 0.9],
];

interface Lamp {
  az: number;
  el: number;
  /** One over the square of its angular radius. */
  sharp: number;
  level: number;
  color: readonly [number, number, number];
}

/** Each cell's lamp, or null, row by row. */
const LAMP_TABLE: (Lamp | null)[] = Array.from({ length: LAMP_COLS * LAMP_ROWS }, (_, n) => {
  const i = n % LAMP_COLS;
  const j = Math.floor(n / LAMP_COLS);
  if (hash(i, j, 7) > 0.5) return null;
  const size = 0.018 + 0.02 * hash(i, j, 10);
  const bright = hash(i, j, 11);
  return {
    az: -Math.PI + (i + 0.15 + 0.7 * hash(i, j, 8)) * LAMP_AZ,
    el: LAMP_LOW + (j + 0.15 + 0.7 * hash(i, j, 9)) * LAMP_EL,
    sharp: 1 / (size * size),
    level: 0.04 + 0.32 * bright * bright,
    color: LAMP_COLORS[Math.floor(hash(i, j, 12) * LAMP_COLORS.length)]!,
  };
});

const addLamps = (az: number, el: number, level: number, rgb: number[]): void => {
  // A lamp reaches less than half a cell (two of its radii), so the 2 x 2 nearest cells hold
  // every lamp that can show here.
  const x = (az + Math.PI) / LAMP_AZ - 0.5;
  const y = (el - LAMP_LOW) / LAMP_EL - 0.5;
  const ci = Math.floor(x);
  const cj = Math.floor(y);
  const cosEl = Math.cos(el);
  for (let dj = 0; dj <= 1; dj++) {
    const j = cj + dj;
    if (j < 0 || j >= LAMP_ROWS) continue;
    for (let di = 0; di <= 1; di++) {
      const lamp = LAMP_TABLE[j * LAMP_COLS + ((((ci + di) % LAMP_COLS) + LAMP_COLS) % LAMP_COLS)];
      if (!lamp) continue;
      let dAz = az - lamp.az;
      if (dAz > Math.PI) dAz -= TAU;
      else if (dAz < -Math.PI) dAz += TAU;
      dAz *= cosEl;
      const dEl = el - lamp.el;
      const d2 = (dAz * dAz + dEl * dEl) * lamp.sharp;
      if (d2 > 4) continue;
      const w = level * lamp.level * Math.exp(-d2);
      rgb[0]! += lamp.color[0] * w;
      rgb[1]! += lamp.color[1] * w;
      rgb[2]! += lamp.color[2] * w;
    }
  }
};

const hash3 = (a: number, b: number, c: number, salt: number): number =>
  hash(a, b ^ Math.imul(c, 668265263), salt);

/**
 * Dots of light the ball throws over the walls and floor, which its tiles show in turn. Beams
 * off a mirror turning about an axis in its plane sweep round twice as fast as it turns, so the
 * dots do too, and pass across the tiles. A grid of cells over directions, a dot in some.
 */
const DOT_CELLS = 18;
const DOT_CHANCE = 0.25;
const DOT_SIZE = 0.016;
const DOT_LEVEL = 0.035;

const addDots = (
  mx: number,
  my: number,
  mz: number,
  /** Cosine and sine of how far the dots have swept round. */
  c: number,
  s: number,
  lights: LightsNow,
  rgb: number[],
): void => {
  if (my > 0.45) return;
  const x = mx * c - mz * s;
  const z = mz * c + mx * s;
  const ix = Math.floor(x * DOT_CELLS);
  const iy = Math.floor(my * DOT_CELLS);
  const iz = Math.floor(z * DOT_CELLS);
  if (hash3(ix, iy, iz, 30) > DOT_CHANCE) return;
  let cx = (ix + 0.3 + 0.4 * hash3(ix, iy, iz, 31)) / DOT_CELLS;
  let cy = (iy + 0.3 + 0.4 * hash3(ix, iy, iz, 32)) / DOT_CELLS;
  let cz = (iz + 0.3 + 0.4 * hash3(ix, iy, iz, 33)) / DOT_CELLS;
  const len = Math.sqrt(cx * cx + cy * cy + cz * cz) || 1;
  cx = x - cx / len;
  cy = my - cy / len;
  cz = z - cz / len;
  const d2 = (cx * cx + cy * cy + cz * cz) / (DOT_SIZE * DOT_SIZE);
  if (d2 > 9) return;
  const w = DOT_LEVEL * (0.5 + hash3(ix, iy, iz, 34)) * Math.exp(-d2);
  const col = lights.dots[Math.floor(hash3(ix, iy, iz, 35) * lights.dots.length)]!;
  rgb[0]! += col[0] * w;
  rgb[1]! += col[1] * w;
  rgb[2]! += col[2] * w;
};

/**
 * The room seen in direction (mx, my, mz), azimuth `az` and elevation `el`, without the
 * spotlights' haze, added to `rgb`. `dc` and `ds` are the cosine and sine of how far the dots
 * of light have swept round.
 */
const addRoom = (
  mx: number,
  my: number,
  mz: number,
  az: number,
  el: number,
  dc: number,
  ds: number,
  lights: LightsNow,
  rgb: number[],
): void => {
  const { glows, floor, lamps } = lights;
  const toFloor = smoothstep(0, -0.3, my);
  const toCeiling = smoothstep(0.25, 0.75, my);
  const open = 1 - Math.max(toFloor, toCeiling * 0.7);
  const walls = open > 0 ? open * (0.35 + 1.3 * roomNoise(az, el, WALL_NOISE)) : 0;
  rgb[0]! += WALL * 0.9 * walls;
  rgb[1]! += WALL * 0.95 * walls;
  rgb[2]! += WALL * walls;
  for (const gl of glows) {
    const d = 1 - (mx * gl.dir[0] + my * gl.dir[1] + mz * gl.dir[2]);
    const w = walls * Math.exp((-2 * d) / (gl.width * gl.width));
    rgb[0]! += gl.color[0] * w;
    rgb[1]! += gl.color[1] * w;
    rgb[2]! += gl.color[2] * w;
  }
  const f = toFloor > 0 ? toFloor * (0.25 + 1.5 * roomNoise(az, el, FLOOR_NOISE)) : 0;
  rgb[0]! += AMBIENT + floor[0] * f + CEILING * toCeiling;
  rgb[1]! += AMBIENT + floor[1] * f + CEILING * toCeiling;
  rgb[2]! += AMBIENT + floor[2] * f + CEILING * toCeiling;
  if (lamps > 0 && el > LAMP_LOW - LAMP_EL && el < LAMP_LOW + (LAMP_ROWS + 1) * LAMP_EL) {
    addLamps(az, el, lamps, rgb);
  }
  addDots(mx, my, mz, dc, ds, lights, rgb);
};

export interface Shading {
  /** RGBA per texel of the tile texture: linear colour, then glint strength. */
  readonly data: Float32Array;
  /** Flash brightness of each tile (before colour), in layout order. */
  readonly flash: Float32Array;
  /** The flash colour each tile shows, fading after its beam has passed: r g b, in layout order. */
  readonly glow: Float32Array;
  /** Tiles flashing brighter than 0.3 in the last `shade`. */
  lit: number;
  /** Each tile's sparkle: 0 none, 1 under way, 2 held back. */
  readonly gate: Uint8Array;
  /**
   * When a sparkle last started in each place on the ball: one place per tile slot, fixed in
   * the room, row by row from the bottom pole.
   */
  readonly started: Float64Array;
  readonly rowStart: Int32Array;
  /** Seconds shaded so far. */
  time: number;
  /** The room each tile shows, r g b, in layout order, refreshed a share at a time. */
  readonly room: Float32Array;
  /** Frames shaded so far. */
  frames: number;
}

export const createShading = (layout: Layout): Shading => {
  const rowStart = new Int32Array(ROWS);
  let n = 0;
  layout.rows.forEach((r, i) => {
    rowStart[i] = n;
    n += r.count;
  });
  return {
    data: new Float32Array(TEX_WIDTH * ROWS * 4),
    flash: new Float32Array(layout.count),
    glow: new Float32Array(layout.count * 3),
    lit: 0,
    gate: new Uint8Array(layout.count),
    started: new Float64Array(n).fill(-Infinity),
    rowStart,
    time: 0,
    room: new Float32Array(layout.count * 3),
    frames: 0,
  };
};

const wrapIndex = (c: number, n: number): number => ((c % n) + n) % n;

/** Start a sparkle at room longitude `lon` in `row` if nothing has started near it lately. */
const claim = (layout: Layout, out: Shading, row: number, lon: number): boolean => {
  const now = out.time;
  const reach = (GATE_REACH + 0.5) * PITCH;
  const lo = Math.max(0, row - GATE_REACH);
  const hi = Math.min(ROWS - 1, row + GATE_REACH);
  const own = Math.cos(layout.rows[row]!.lat);
  for (let r = lo; r <= hi; r++) {
    const { count, lat } = layout.rows[r]!;
    if (count === 0) continue;
    const start = out.rowStart[r]!;
    const slot = TAU / count;
    // Longitude spans more surface on the wider of the two rows; measure on the narrower.
    const span = reach / Math.max(0.02, Math.min(own, Math.cos(lat)));
    const first = span >= Math.PI ? 0 : Math.floor((lon - span) / slot);
    const last = span >= Math.PI ? count - 1 : Math.floor((lon + span) / slot);
    for (let c = first; c <= last; c++) {
      if (now - out.started[start + wrapIndex(c, count)]! < GATE_GAP) return false;
    }
  }
  const { count } = layout.rows[row]!;
  out.started[out.rowStart[row]! + wrapIndex(Math.floor(lon / (TAU / count)), count)] = now;
  return true;
};

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The colour the shader shows for a linear colour: bright light saturates without changing hue,
 * and only the very brightest goes white-hot. Returns relative luminance; fills `out` if given.
 */
export const shown = (r: number, g: number, b: number, out?: number[]): number => {
  const m = Math.max(r, g, b);
  const k = m > 1e-5 ? (1 - Math.exp(-m)) / m : 1;
  const white = 0.5 * smoothstep(2, 6, m) * (1 - Math.exp(-m));
  const keep = 1 - 0.5 * smoothstep(2, 6, m);
  const sr = r * k * keep + white;
  const sg = g * k * keep + white;
  const sb = b * k * keep + white;
  if (out) {
    out[0] = sr;
    out[1] = sg;
    out[2] = sb;
  }
  return 0.2126 * sr + 0.7152 * sg + 0.0722 * sb;
};

/**
 * Shade every tile for a ball turned `theta` about its vertical axis, into `out`. A ball-frame
 * direction (x, y, z) faces (x cos θ + z sin θ, y, z cos θ - x sin θ) in the room.
 */
export const shade = (
  layout: Layout,
  sphere: SphereInfo,
  theta: number,
  lights: LightsNow,
  viewers: readonly Viewer[],
  out: Shading,
  /** Seconds since the last `shade`, for the afterglow. */
  dt = 1 / 60,
): void => {
  const fade = Math.exp(-Math.max(0, dt) / AFTERGLOW);
  out.time += Math.max(0, dt);
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  const dc = Math.cos(2 * theta);
  const ds = Math.sin(2 * theta);
  const room = out.room;
  const fresh = out.frames === 0;
  const turnOf = out.frames % ROOM_EVERY;
  out.frames++;
  const R = sphere.radius;
  const cy = sphere.centreY;
  const half = (TILE * R) / 2;
  // Farther than any viewer is from any tile: the crowd stands within 3.6 radii of the axis.
  const farBeam = Math.hypot(4.6 * R, cy + R);
  const { spots } = lights;
  const nv = viewers.length;
  const rgb = [0, 0, 0];
  const hazeK = 2 / (HAZE_WIDTH * HAZE_WIDTH);
  const data = out.data;
  let lit = 0;

  for (let i = 0; i < layout.count; i++) {
    const j = i * 3;
    const cx0 = layout.centre[j]!;
    const cz0 = layout.centre[j + 2]!;
    const px = R * (cx0 * ct + cz0 * st);
    const py = cy + R * layout.centre[j + 1]!;
    const pz = R * (cz0 * ct - cx0 * st);
    const nx0 = layout.normal[j]!;
    const nz0 = layout.normal[j + 2]!;
    const nx = nx0 * ct + nz0 * st;
    const ny = layout.normal[j + 1]!;
    const nz = nz0 * ct - nx0 * st;
    const mx0 = layout.mirror[j]!;
    const mz0 = layout.mirror[j + 2]!;
    const mx = mx0 * ct + mz0 * st;
    const my = layout.mirror[j + 1]!;
    const mz = mz0 * ct - mx0 * st;

    // The room in the mirror, with haze round each spotlight. It changes slowly, so each tile
    // refreshes it every `ROOM_EVERY` frames, a share of the tiles at a time.
    if (fresh || i % ROOM_EVERY === turnOf) {
      rgb[0] = 0;
      rgb[1] = 0;
      rgb[2] = 0;
      let az = layout.mirrorAz[i]! + theta;
      if (az > Math.PI) az -= TAU;
      addRoom(mx, my, mz, az, layout.mirrorEl[i]!, dc, ds, lights, rgb);
      for (let k = 0; k < spots.length; k++) {
        const s = spots[k]!;
        const hz = 1 - (mx * s.dir[0] + my * s.dir[1] + mz * s.dir[2]);
        if (hz < 0.3 && s.power > 0) {
          const w = HAZE_LEVEL * s.power * Math.exp(-hz * hazeK);
          rgb[0] += s.color[0] * w;
          rgb[1] += s.color[1] * w;
          rgb[2] += s.color[2] * w;
        }
      }
      room[j] = rgb[0];
      room[j + 1] = rgb[1];
      room[j + 2] = rgb[2];
    }
    const r = room[j]!;
    const g = room[j + 1]!;
    const b = room[j + 2]!;

    // Spotlights' beams bounced to people's eyes.
    let fr = 0;
    let fg = 0;
    let fb = 0;
    let flash = 0;
    for (let k = 0; k < spots.length; k++) {
      const s = spots[k]!;
      if (s.power <= 0) continue;
      let lx = s.dir[0] * s.dist * R - px;
      let ly = cy + s.dir[1] * s.dist * R - py;
      let lz = s.dir[2] * s.dist * R - pz;
      if (nx * lx + ny * ly + nz * lz <= 0) continue;
      const ll = Math.sqrt(lx * lx + ly * ly + lz * lz);
      lx /= ll;
      ly /= ll;
      lz /= ll;
      const ndl = nx * lx + ny * ly + nz * lz;
      const by = 2 * ndl * ny - ly;
      if (by > -0.02) continue;
      const bx = 2 * ndl * nx - lx;
      const bz = 2 * ndl * nz - lz;
      const spread = s.size + SPREAD;
      // Where the beam crosses the middle of eye height. Someone whose eyes are farther from
      // there across the floor than this bound can't be in it, at any eye height.
      const tm = (EYE_MID - py) / by;
      const qx = px + tm * bx;
      const qz = pz + tm * bz;
      const bound = half + farBeam * spread + EYE_REACH + EYE_SPAN * Math.sqrt(1 - by * by);
      const bound2 = (bound * bound) / (by * by);
      let f = 0;
      for (let v = 0; v < nv; v++) {
        const viewer = viewers[v]!;
        const hx = viewer.x - qx;
        const hz = viewer.z - qz;
        if (hx * hx + hz * hz > bound2) continue;
        const wx = viewer.x - px;
        const wy = viewer.eye - py;
        const wz = viewer.z - pz;
        const t = wx * bx + wy * by + wz * bz;
        if (t <= 0) continue;
        // Distance from the eye to the beam's middle, square.
        const cx = wy * bz - wz * by;
        const cyy = wz * bx - wx * bz;
        const cz = wx * by - wy * bx;
        const d2 = cx * cx + cyy * cyy + cz * cz;
        const reach = half + t * spread + EYE_REACH;
        const r2 = reach * reach;
        if (d2 < r2) {
          const q = 1 - d2 / r2;
          f += q * q;
        }
      }
      if (f > 0) {
        f = Math.min(f, 1) * s.power;
        fr += s.color[0] * f;
        fg += s.color[1] * f;
        fb += s.color[2] * f;
        flash += f;
      }
    }

    let gate = out.gate[i]!;
    if (gate === 0 && flash > GATE_ON) {
      gate = claim(layout, out, layout.row[i]!, Math.atan2(cx0, cz0) + theta) ? 1 : 2;
    } else if (gate !== 0 && flash < GATE_OFF) {
      gate = 0;
    }
    out.gate[i] = gate;
    if (gate === 2) {
      flash = 0;
      fr = 0;
      fg = 0;
      fb = 0;
    }

    const glow = out.glow;
    fr = glow[j] = Math.max(fr, glow[j]! * fade);
    fg = glow[j + 1] = Math.max(fg, glow[j + 1]! * fade);
    fb = glow[j + 2] = Math.max(fb, glow[j + 2]! * fade);
    flash = Math.max(flash, out.flash[i]! * fade);
    const shine = layout.shine[i]!;
    const o = layout.texel[i]! * 4;
    data[o] = r * shine * SILVER[0] + fr;
    data[o + 1] = g * shine * SILVER[1] + fg;
    data[o + 2] = b * shine * SILVER[2] + fb;
    data[o + 3] = flash > GLINT_FROM ? flash - GLINT_FROM : 0;
    out.flash[i] = flash;
    if (flash > 0.3) lit++;
  }
  out.lit = lit;
};
