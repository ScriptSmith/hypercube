/**
 * Plate modes: shapes, frequencies, the driven response, the drive point and damping by a finger.
 * Everything here is pure so the unit tests can check it; `gpu/shaders.ts` evaluates the same
 * shapes per grain.
 *
 * Plate coordinates are (u, v) in [-1, 1], v pointing down, across the plate whatever its shape:
 * a square or stretched plate fills the square, a round plate is the unit disc inside it.
 *
 * Square plate: Chladni's approximation for a free square plate, a pair of cosine products with x
 * and y swapped, added or subtracted:
 *   a cos(n pi x) cos(m pi y) + b cos(m pi x) cos(n pi y), with x = (u + 1) / 2, y = (v + 1) / 2,
 * and a = 1, b = +1 or -1 on the square. Frequency grows with n^2 + m^2; the minus and plus pairs
 * are split a little (they differ on a real plate too), so every key has its own note.
 *
 * Stretched plate: the same metal (the same area) drawn out into a rectangle up to 2:1. Each
 * product's frequency follows its wavenumber along each side, (n / Lx)^2 + (m / Ly)^2, so the two
 * products of a pair part as the plate stretches. The coupling that split the pair on the square
 * stays, so each figure turns smoothly from the square's sum or difference into one product: the
 * plus figure follows the upper branch and the minus figure the lower one.
 *
 * Round plate: J_n(k r) cos(n (theta - turn)), where k is a zero of J_n' so the rim moves freely:
 * n nodal diameters and `m` nodal circles. Frequency grows with k^2, as a plate's does with
 * wavenumber. theta is measured from straight up. A disc has no preferred direction, so a mode
 * with diameters turns to put the drive point on its axis (`turn`), where it moves most.
 */

export type PlateShape = "square" | "round";

export interface Mode {
  /** Index in its plate's list, which is in frequency order on the square or unturned plate. */
  index: number;
  shape: PlateShape;
  /** Square: the first cosine number. Round: nodal diameters. */
  n: number;
  /** Square: the second cosine number. Round: nodal circles. */
  m: number;
  /** Square: +1 or -1 between the two products on the square plate. Round: 1. */
  sign: 1 | -1;
  /** Round: the radial wavenumber. Square: pi * sqrt(n^2 + m^2) / 2 in plate units. */
  k: number;
  /** Frequency relative to the square or round plate's lowest mode. */
  freq: number;
  /** Typical gradient of the unit-peak shape, plate units (true lengths), for grain motion. */
  wave: number;
  /** 1 / max |raw shape| over the plate, so every mode peaks at 1. */
  scale: number;
  /** Square: weights of cos(n pi x) cos(m pi y) and cos(m pi x) cos(n pi y). Round: 1 and 0. */
  a: number;
  b: number;
  /** Round: the angle of the figure's axis from straight up. Square: 0. */
  turn: number;
}

/**
 * The plate's shape now. `stretch` 0 is the square and 1 a 2:1 rectangle, of the same area;
 * `wide` lays the long side across. `turn` points a round plate's figures (see Mode.turn).
 */
export interface Form {
  stretch: number;
  wide: boolean;
  turn: number;
}

export const SQUARE_FORM: Form = { stretch: 0, wide: true, turn: 0 };

/** Longest side over shortest at full stretch. */
export const MAX_ASPECT = 2;

/** Long side over short side for a stretch of 0 to 1. */
export const aspectOf = (stretch: number): number =>
  1 + (MAX_ASPECT - 1) * Math.min(1, Math.max(0, stretch));

/**
 * Half the plate's sides in true lengths, for a plate whose area is the square's: (1, 1) on the
 * square. A step of du across the plate is hx * du long.
 */
export const halfSides = (form: Pick<Form, "stretch" | "wide">): { hx: number; hy: number } => {
  const r = Math.sqrt(aspectOf(form.stretch));
  return form.wide ? { hx: r, hy: 1 / r } : { hx: 1 / r, hy: r };
};

/** Bessel J_n(x) and J_n'(x) from Bessel's integral, trapezoid rule with this many intervals. */
export const BESSEL_STEPS = 16;

/**
 * J_n(x) = (1/pi) int_0^pi cos(n t - x sin t) dt, and its derivative with the integrand's x
 * derivative. The integrand is smooth and periodic, so the trapezoid rule converges fast: with 16
 * intervals the error is about J_(32 - n)(x), far below what a figure can show for x < 12.
 */
export const bessel = (n: number, x: number): { j: number; dj: number } => {
  let j = 0;
  let dj = 0;
  for (let i = 0; i <= BESSEL_STEPS; i++) {
    const t = (Math.PI * i) / BESSEL_STEPS;
    const w = i === 0 || i === BESSEL_STEPS ? 0.5 : 1;
    const st = Math.sin(t);
    const a = n * t - x * st;
    j += w * Math.cos(a);
    dj += w * Math.sin(a) * st;
  }
  return { j: j / BESSEL_STEPS, dj: dj / BESSEL_STEPS };
};

/** Zeros of J_n' (k > 0), by bisection on the integral form. Used to build the round modes. */
export const besselPrimeZero = (n: number, s: number): number => {
  // Scan for sign changes of J_n', then bisect the (s + 1)th one. Every zero lies above n, and
  // below that the integral is all rounding noise for large n, so the scan starts there.
  let found = 0;
  const start = Math.max(0.5, n);
  let prev = bessel(n, start).dj;
  const step = 0.02;
  for (let x = start + step; x < 40; x += step) {
    const cur = bessel(n, x).dj;
    if (prev === 0 || prev * cur < 0) {
      if (found === s) {
        let lo = x - step;
        let hi = x;
        for (let i = 0; i < 50; i++) {
          const mid = (lo + hi) / 2;
          if (bessel(n, lo).dj * bessel(n, mid).dj <= 0) hi = mid;
          else lo = mid;
        }
        return (lo + hi) / 2;
      }
      found++;
    }
    prev = cur;
  }
  return Number.NaN;
};

export interface ShapeSample {
  /** Displacement, unit peak. */
  w: number;
  /** Gradient in plate units. */
  du: number;
  dv: number;
}

const PI = Math.PI;

/** The raw square shape (before `scale`) and its gradient at (u, v). */
const squareRaw = (
  n: number,
  m: number,
  a: number,
  b: number,
  u: number,
  v: number,
): ShapeSample => {
  const x = (u + 1) / 2;
  const y = (v + 1) / 2;
  const cnx = Math.cos(n * PI * x);
  const cmx = Math.cos(m * PI * x);
  const cny = Math.cos(n * PI * y);
  const cmy = Math.cos(m * PI * y);
  const snx = Math.sin(n * PI * x);
  const smx = Math.sin(m * PI * x);
  const sny = Math.sin(n * PI * y);
  const smy = Math.sin(m * PI * y);
  return {
    w: a * cnx * cmy + b * cmx * cny,
    du: 0.5 * PI * (-a * n * snx * cmy - b * m * smx * cny),
    dv: 0.5 * PI * (-a * m * cnx * smy - b * n * cmx * sny),
  };
};

/** The raw round shape (before `scale`) and its gradient at (u, v). */
const roundRaw = (n: number, k: number, turn: number, u: number, v: number): ShapeSample => {
  const r = Math.max(1e-4, Math.hypot(u, v));
  const th = Math.atan2(u, -v) - turn;
  const { j, dj } = bessel(n, k * r);
  const c = Math.cos(n * th);
  const s = Math.sin(n * th);
  // d/dr and (1/r) d/dtheta, turned into u and v.
  const dr = k * dj * c;
  const dt = (-n * j * s) / r;
  const ur = u / r;
  const vr = v / r;
  return { w: j * c, du: dr * ur - dt * vr, dv: dr * vr + dt * ur };
};

type Shape = Pick<Mode, "shape" | "n" | "m" | "a" | "b" | "k" | "turn">;

const raw = (mode: Shape, u: number, v: number) =>
  mode.shape === "square"
    ? squareRaw(mode.n, mode.m, mode.a, mode.b, u, v)
    : roundRaw(mode.n, mode.k, mode.turn, u, v);

/** A mode's unit-peak displacement and gradient at plate point (u, v). */
export const sample = (mode: Mode, u: number, v: number): ShapeSample => {
  const s = raw(mode, u, v);
  return { w: s.w * mode.scale, du: s.du * mode.scale, dv: s.dv * mode.scale };
};

/** A mode's unit-peak displacement at (u, v). */
export const shapeAt = (mode: Mode, u: number, v: number): number => raw(mode, u, v).w * mode.scale;

/** True when (u, v) is on the plate. */
export const onPlate = (shape: PlateShape, u: number, v: number): boolean =>
  shape === "square" ? Math.abs(u) <= 1 && Math.abs(v) <= 1 : u * u + v * v <= 1;

/** Grid points over the plate, for norms and tests. */
export const plateGrid = (shape: PlateShape, size: number): [number, number][] => {
  const out: [number, number][] = [];
  for (let iy = 0; iy < size; iy++) {
    for (let ix = 0; ix < size; ix++) {
      const u = -1 + (2 * (ix + 0.5)) / size;
      const v = -1 + (2 * (iy + 0.5)) / size;
      if (onPlate(shape, u, v)) out.push([u, v]);
    }
  }
  return out;
};

interface ModeSpec {
  n: number;
  m: number;
  sign?: 1 | -1;
}

/**
 * The figures each plate offers, chosen by drawing every candidate's nodal lines and keeping
 * the ones that look clearly different from each other. Order here doesn't matter: `buildModes`
 * sorts by frequency.
 */
export const SQUARE_SPECS: readonly ModeSpec[] = [
  { n: 1, m: 1, sign: 1 },
  { n: 2, m: 0, sign: -1 },
  { n: 2, m: 0, sign: 1 },
  { n: 2, m: 1, sign: 1 },
  { n: 3, m: 0, sign: -1 },
  { n: 3, m: 1, sign: -1 },
  { n: 3, m: 1, sign: 1 },
  { n: 3, m: 2, sign: 1 },
  { n: 4, m: 0, sign: 1 },
  { n: 3, m: 3, sign: 1 },
  { n: 4, m: 2, sign: 1 },
  { n: 5, m: 1, sign: -1 },
  { n: 5, m: 1, sign: 1 },
  { n: 5, m: 3, sign: 1 },
  { n: 6, m: 3, sign: -1 },
  { n: 6, m: 4, sign: 1 },
];

export const ROUND_SPECS: readonly ModeSpec[] = [
  { n: 1, m: 0 },
  { n: 2, m: 0 },
  { n: 0, m: 1 },
  { n: 3, m: 0 },
  { n: 1, m: 1 },
  { n: 5, m: 0 },
  { n: 2, m: 1 },
  { n: 0, m: 2 },
  { n: 6, m: 0 },
  { n: 3, m: 1 },
  { n: 1, m: 2 },
  { n: 4, m: 1 },
  { n: 0, m: 3 },
  { n: 3, m: 2 },
];

/** Grid used to find each mode's peak for `scale`. */
const NORM_GRID = 96;

/** The square's frequency split between a pair's sum and difference, as a share of its mean. */
export const SPLIT = 0.06;

const buildOne = (
  shape: PlateShape,
  spec: ModeSpec,
): Omit<Mode, "index" | "freq"> & {
  raw: number;
} => {
  const sign = spec.sign ?? 1;
  // Round modes with m circles use the (m + 1)th zero of J_n' (n = 0 skips the zero at k = 0).
  const k =
    shape === "square"
      ? (PI * Math.hypot(spec.n, spec.m)) / 2
      : besselPrimeZero(spec.n, spec.n === 0 ? spec.m - 1 : spec.m);
  const base = {
    shape,
    n: spec.n,
    m: spec.m,
    sign,
    k,
    a: 1,
    b: shape === "square" ? sign : 0,
    turn: 0,
  };
  let peak = 0;
  let grad = 0;
  let count = 0;
  for (const [u, v] of plateGrid(shape, NORM_GRID)) {
    const s = raw(base, u, v);
    peak = Math.max(peak, Math.abs(s.w));
    grad += s.du * s.du + s.dv * s.dv;
    count++;
  }
  const scale = peak > 0 ? 1 / peak : 1;
  const wave = Math.sqrt(grad / Math.max(1, count)) * scale;
  // Frequency before normalising: n^2 + m^2 split by sign for the square, k^2 for the disc.
  const rawFreq = shape === "square" ? (spec.n ** 2 + spec.m ** 2) * (1 + SPLIT * sign) : k * k;
  return { ...base, scale, wave, raw: rawFreq };
};

/** Every mode of a plate, in frequency order, with frequencies relative to the lowest. */
export const buildModes = (shape: PlateShape): Mode[] => {
  const specs = shape === "square" ? SQUARE_SPECS : ROUND_SPECS;
  const built = specs.map((s) => buildOne(shape, s)).sort((a, b) => a.raw - b.raw);
  const low = built[0]?.raw ?? 1;
  return built.map(({ raw: r, ...rest }, index) => ({ ...rest, index, freq: r / low }));
};

const cache = new Map<PlateShape, Mode[]>();

/** The plate's modes on the square or unturned plate, built once. */
export const modesFor = (shape: PlateShape): readonly Mode[] => {
  let list = cache.get(shape);
  if (!list) {
    list = buildModes(shape);
    cache.set(shape, list);
  }
  return list;
};

/** The square plate's lowest raw frequency, which every square frequency is relative to. */
const squareLow = (): number => {
  const m = modesFor("square")[0]!;
  return (m.n ** 2 + m.m ** 2) * (1 + SPLIT * m.sign);
};

/**
 * Frequency (before normalising) and weights of a square mode's pair on a stretched plate. The
 * two products' frequencies are fA and fB; the square's split couples them by `c`, so the pair
 * has frequencies mean +- sqrt(d^2 + c^2) and its shapes turn from (1, +-1) towards (1, 0) or
 * (0, 1) as the sides part.
 */
export const stretchedPair = (
  n: number,
  m: number,
  sign: 1 | -1,
  hx: number,
  hy: number,
): { raw: number; a: number; b: number } => {
  const fA = (n * n) / (hx * hx) + (m * m) / (hy * hy);
  const fB = (m * m) / (hx * hx) + (n * n) / (hy * hy);
  if (n === m) return { raw: fA * (1 + SPLIT), a: 1, b: 1 };
  const mean = (fA + fB) / 2;
  const d = (fA - fB) / 2;
  const c = SPLIT * mean;
  const r = Math.hypot(d, c);
  const a = c;
  const b = sign > 0 ? r - d : -r - d;
  const len = Math.hypot(a, b) || 1;
  return { raw: mean + sign * r, a: a / len, b: b / len };
};

/** Grid for a stretched plate's peaks and gradients: coarser, since it runs while a slider moves. */
const FORM_GRID = 64;
/** Stretch is resolved to this many steps for the modes (the drawing follows it exactly). */
export const STRETCH_STEPS = 100;
const FORM_CACHE = 24;
const formCache = new Map<string, Mode[]>();

const buildStretched = (stretch: number, wide: boolean): Mode[] => {
  const base = modesFor("square");
  const { hx, hy } = halfSides({ stretch, wide });
  const low = squareLow();
  const N = FORM_GRID;
  const top = Math.max(...base.map((m) => Math.max(m.n, m.m)));
  const cos: Float64Array[] = [];
  const sin: Float64Array[] = [];
  for (let k = 0; k <= top; k++) {
    const c = new Float64Array(N);
    const s = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const x = (i + 0.5) / N;
      c[i] = Math.cos(k * PI * x);
      s[i] = Math.sin(k * PI * x);
    }
    cos.push(c);
    sin.push(s);
  }
  return base.map((mode) => {
    const { n, m } = mode;
    const pair = stretchedPair(n, m, mode.sign, hx, hy);
    const { a, b } = pair;
    const cn = cos[n]!;
    const cm = cos[m]!;
    const sn = sin[n]!;
    const sm = sin[m]!;
    let peak = 0;
    let grad = 0;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const w = a * cn[i]! * cm[j]! + b * cm[i]! * cn[j]!;
        const du = 0.5 * PI * (-a * n * sn[i]! * cm[j]! - b * m * sm[i]! * cn[j]!);
        const dv = 0.5 * PI * (-a * m * cn[i]! * sm[j]! - b * n * cm[i]! * sn[j]!);
        peak = Math.max(peak, Math.abs(w));
        grad += (du / hx) ** 2 + (dv / hy) ** 2;
      }
    }
    const scale = peak > 0 ? 1 / peak : 1;
    return {
      ...mode,
      a,
      b,
      scale,
      wave: Math.sqrt(grad / (N * N)) * scale,
      freq: pair.raw / low,
    };
  });
};

/**
 * The plate's modes in a given form: stretched (square plate) or turned (round plate). Mode
 * `index` keeps naming the same figure as it changes, so keys keep their modes; the list stays in
 * that order, not re-sorted by frequency.
 */
export const formModes = (shape: PlateShape, form: Form): readonly Mode[] => {
  if (shape === "round") {
    const turn = form.turn;
    if (!Number.isFinite(turn) || turn === 0) return modesFor("round");
    const id = `r${turn}`;
    let list = formCache.get(id);
    if (!list) {
      list = modesFor("round").map((m) => (m.n === 0 ? m : { ...m, turn }));
      remember(id, list);
    }
    return list;
  }
  const steps = Math.round(Math.min(1, Math.max(0, form.stretch)) * STRETCH_STEPS);
  if (steps === 0) return modesFor("square");
  const id = `${steps}:${form.wide ? "w" : "t"}`;
  let list = formCache.get(id);
  if (!list) {
    list = buildStretched(steps / STRETCH_STEPS, form.wide);
    remember(id, list);
  }
  return list;
};

/** Keep a form's modes, forgetting the oldest beyond FORM_CACHE. */
const remember = (id: string, list: Mode[]) => {
  formCache.delete(id);
  formCache.set(id, list);
  while (formCache.size > FORM_CACHE) {
    const first = formCache.keys().next().value;
    if (first === undefined) break;
    formCache.delete(first);
  }
};

/** Short id for logs and status, such as "s3-1+" or "r2.1". */
export const modeId = (m: Mode): string =>
  m.shape === "square" ? `s${m.n}-${m.m}${m.sign > 0 ? "+" : "-"}` : `r${m.n}.${m.m}`;

// ---- Driven response ------------------------------------------------------------------------

/**
 * Quality factor of every mode at the damping slider's default: the resonance is about 1/Q wide.
 * Midway between any two neighbouring figures (at least 9 % apart) the plate's motion stays too
 * small to lift the sand, even where the drive point suits both of them.
 */
export const Q = 140;

/**
 * Steady amplitude of a mode of frequency `f0` driven at `f`, relative to its amplitude at
 * resonance: 1 / sqrt(Q^2 (1 - r^2)^2 + r^2) with r = f / f0. It peaks (very nearly) at r = 1.
 */
export const response = (f: number, f0: number, q = Q): number => {
  const r = f / f0;
  const d = 1 - r * r;
  return 1 / Math.sqrt(q * q * d * d + r * r);
};

/**
 * The same response with its phase, as (re, im): 1 at resonance, a quarter cycle ahead well below
 * it and behind well above it. A heavily damped plate rings neighbouring modes strongly and out
 * of step with the resonant one, so their still lines never line up and the sand only blurs.
 */
export const responseC = (
  f: number,
  f0: number,
  q = Q,
  out: [number, number] = [0, 0],
): [number, number] => {
  const r = f / f0;
  const d = q * (1 - r * r);
  const den = d * d + r * r;
  out[0] = r / den;
  out[1] = d / den;
  return out;
};

/** A point on the plate, in plate coordinates. */
export interface Point {
  u: number;
  v: number;
}

/**
 * How hard the shaker under the drive point pushes. A mode rings in proportion to its motion at
 * the drive point; with this gain the default point (see HOME) rings every figure well.
 */
export const DRIVE_GAIN = 3;

/** The plate's response after the shaker runs out of strength: x for small x, never above 1. */
export const saturate = (x: number): number => x / Math.sqrt(Math.sqrt(1 + x ** 4));

/** How a drive at `at` couples to a mode: the mode's motion there, signed. */
export const coupling = (mode: Mode, at: Point): number => shapeAt(mode, at.u, at.v);

/** The level a drive at `at` rings `mode` to on its own resonance, 0 to 1. */
export const ringsAt = (mode: Mode, at: Point): number =>
  saturate(DRIVE_GAIN * Math.abs(coupling(mode, at)));

/**
 * The drive point's place at rest, chosen numerically (see the unit tests) to ring every figure
 * of the square plate well. On the round plate only the distance from the middle matters, and
 * the rim suits every figure best; its left side has room for the puck on every frame, and the
 * round keys draw their figures turned to face it.
 */
export const HOME: Record<PlateShape, Point> = {
  square: { u: -0.2, v: 0.6 },
  round: { u: -0.97, v: 0 },
};

/** Which way a round plate's figures face for a drive point, or `prev` near the middle. */
export const turnToward = (at: Point, prev = 0): number =>
  Math.hypot(at.u, at.v) > 0.04 ? Math.atan2(at.u, -at.v) : prev;

/** How much a finger damps: a mode moving at full amplitude under it keeps 1 / (1 + DAMP). */
export const DAMP = 40;

/**
 * The share of a mode's amplitude that survives a finger at (u, v): near 1 where the mode has a
 * still line, small where it moves a lot. Several fingers multiply.
 */
export const spared = (mode: Mode, points: readonly Point[]): number => {
  let s = 1;
  for (const p of points) {
    const w = shapeAt(mode, p.u, p.v);
    s /= 1 + DAMP * w * w;
  }
  return s;
};

/** Breadth of the neighbourhood that takes over a damped drive, as a quality factor. */
const SPILL_Q = 3;
/** Share of the lost amplitude that reappears in modes still under the finger. */
const SPILL = 0.85;

export interface Drive {
  /** A key drives the plate at its mode's frequency; a glide at any frequency. */
  kind: "key" | "glide";
  /** Mode index for a key; ignored for a glide. */
  mode: number;
  /** Relative frequency for a glide; ignored for a key. */
  freq: number;
  /** Envelope, 0 to 1. */
  level: number;
}

/** Mode amplitudes with their phase. */
export interface Amps {
  re: Float64Array;
  im: Float64Array;
}

export const amps = (n: number): Amps => ({ re: new Float64Array(n), im: new Float64Array(n) });

/**
 * Target amplitude of every mode for a set of drives through the drive point `at`, with fingers
 * on the plate at `points`. Every drive shakes the plate at one frequency (a key at its mode's):
 * each mode answers by its resonance there times its motion at the drive point, so a mode with a
 * still line under the drive point stays silent. Fingers damp each mode by `spared`, and the
 * amplitude a drive loses that way moves into the modes nearest its frequency that are still
 * under the fingers and that the drive point can reach, so the figure changes to one with a still
 * line through the finger. Drives add in phase.
 */
export const targets = (
  modes: readonly Mode[],
  drives: readonly Drive[],
  at: Point,
  points: readonly Point[],
  q = Q,
  out: Amps = amps(modes.length),
): Amps => {
  out.re.fill(0);
  out.im.fill(0);
  if (drives.length === 0) return out;
  const n = modes.length;
  const couple = modes.map((m) => coupling(m, at));
  const keep = modes.map((m) => (points.length ? spared(m, points) : 1));
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const share = new Float64Array(n);
  const h: [number, number] = [0, 0];
  for (const d of drives) {
    if (d.level <= 0) continue;
    const key = d.kind === "key";
    if (key && !(d.mode >= 0 && d.mode < n)) continue;
    const f = key ? modes[d.mode]!.freq : d.freq;
    if (!(f > 0)) continue;
    let size = 0;
    for (let i = 0; i < n; i++) {
      responseC(f, modes[i]!.freq, q, h);
      const g = DRIVE_GAIN * couple[i]!;
      re[i] = g * h[0];
      im[i] = g * h[1];
      size += re[i]! * re[i]! + im[i]! * im[i]!;
    }
    size = Math.sqrt(size);
    const s = size > 1e-9 ? saturate(size) / size : 0;
    let before = 0;
    let after = 0;
    for (let i = 0; i < n; i++) {
      re[i]! *= s;
      im[i]! *= s;
      const a2 = re[i]! * re[i]! + im[i]! * im[i]!;
      before += a2;
      after += a2 * keep[i]! * keep[i]!;
    }
    const lost = Math.max(0, before - after);
    let spill = 0;
    share.fill(0);
    if (lost > 1e-6) {
      for (let i = 0; i < n; i++) {
        if (key && i === d.mode) continue;
        const c = couple[i]!;
        share[i] =
          response(f, modes[i]!.freq, SPILL_Q) *
          keep[i]! ** 4 *
          Math.min(1, DRIVE_GAIN * Math.abs(c)) *
          Math.sign(c);
        spill += share[i]! * share[i]!;
      }
    }
    const gain = spill > 1e-9 ? (SPILL * Math.sqrt(lost)) / Math.sqrt(spill) : 0;
    for (let i = 0; i < n; i++) {
      out.re[i]! += d.level * (re[i]! * keep[i]! + gain * share[i]!);
      out.im[i]! += d.level * im[i]! * keep[i]!;
    }
  }
  return out;
};

// ---- Keys -----------------------------------------------------------------------------------

/**
 * Which mode each of `keys` solo keys plays: spread evenly through the plate's list, lowest
 * first, so a few keys still reach both simple and busy figures.
 */
export const soloKeyModes = (keys: number, modeCount: number): number[] => {
  const n = Math.max(1, Math.min(keys, modeCount));
  if (n === 1) return [0];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Math.round((i * (modeCount - 1)) / (n - 1)));
  return out;
};

/** Keys on each touch frame of a bank (each panel of a merged pair counts as a frame). */
export const BANK_KEYS_PER_PANEL = 2;

/**
 * The mode a bank key plays. Keys run left to right in frequency order, two per panel; if the
 * bank has more keys than the plate has modes, the highest keys repeat the top modes.
 */
export const bankKeyMode = (key: number, totalKeys: number, modeCount: number): number => {
  const k = Math.max(0, Math.min(totalKeys - 1, key));
  const idx = k < modeCount ? k : modeCount - totalKeys + k;
  return Math.max(0, Math.min(modeCount - 1, idx));
};

/** The global key indices on the touch frame at `pos`, for a bank of `count` frames of `span`. */
export const bankKeysOf = (pos: number, span: number): number[] => {
  const out: number[] = [];
  for (let p = 0; p < span; p++) {
    for (let j = 0; j < BANK_KEYS_PER_PANEL; j++) {
      out.push((pos * span + p) * BANK_KEYS_PER_PANEL + j);
    }
  }
  return out;
};

/**
 * A glide strip's frequency scale. On the square or unturned plate its own notes sit at evenly
 * spaced marks, and the strip runs on past the end marks by `GLIDE_OVERHANG` of a gap towards the
 * neighbouring notes (another frame's, on a bank), so neighbouring strips overlap a little.
 * Between two knots the frequency moves on a log scale, held on each note near its mark and eased
 * away from it: a finger near a mark finds the resonance, and the sweep between marks passes
 * through every mode in the gap (marked or not), with only a shiver between them.
 *
 * When the plate stretches its notes move. The strip keeps the square's axis (the same place
 * means the same frequency, between the holds), and each note's mark slides to its new frequency's
 * place there, holding as before; a note that leaves the strip loses its mark.
 */
export interface GlideScale {
  /** Knot frequencies, ascending: the note below, the strip's notes, the note above. */
  knots: number[];
  /** Each knot's place on the axis: the note below at 0, the first own note at 1 on the square. */
  at: number[];
  /** Positions (0 to 1) of the strip's own notes, in the order given, or null off the strip. */
  marks: (number | null)[];
  /** The strip's ends on the axis: from `start` to `start + span`. */
  start: number;
  span: number;
}

export const GLIDE_OVERHANG = 0.6;
/** Step past an end note when there is no neighbour. */
const GLIDE_END_STEP = 1.15;
/**
 * Share of each gap, either side of a note, where the frequency holds on the note: a soft detent
 * a finger can find. Beyond it the frequency eases away and sweeps through the gap.
 */
export const GLIDE_HOLD = 0.2;

const ease = (s: number) => {
  const k = Math.min(1, Math.max(0, (s - GLIDE_HOLD) / (1 - 2 * GLIDE_HOLD)));
  return k * k * (3 - 2 * k);
};

/** Place on a square scale's axis of frequency `f`, log-linear between knots, without holds. */
const axisOf = (axis: GlideScale, f: number): number => {
  const k = axis.knots;
  const last = k.length - 1;
  const lf = Math.log(f);
  let j = 0;
  while (j < last - 1 && f > k[j + 1]!) j++;
  const a = Math.log(k[j]!);
  const b = Math.log(k[j + 1]!);
  const t = b > a ? (lf - a) / (b - a) : 0;
  return axis.at[j]! + t * (axis.at[j + 1]! - axis.at[j]!);
};

/**
 * The scale of a strip with `notes` (frequencies, in the strip's own order), between the
 * neighbouring notes `below` and `above`. Without `axis` it lays the notes out evenly, as on the
 * square plate; with the square's scale as `axis` it places them on that scale's axis instead.
 */
export const glideScale = (
  notes: readonly number[],
  below: number | null = null,
  above: number | null = null,
  axis: GlideScale | null = null,
): GlideScale => {
  const sorted = [...notes].sort((a, b) => a - b);
  const lo = sorted[0] ?? 1;
  const hi = sorted[sorted.length - 1] ?? 1;
  const knots = [
    below !== null && below < lo ? below : lo / GLIDE_END_STEP,
    ...sorted,
    above !== null && above > hi ? above : hi * GLIDE_END_STEP,
  ];
  const inner = sorted.length;
  const start = 1 - GLIDE_OVERHANG;
  const span = inner - 1 + 2 * GLIDE_OVERHANG;
  if (!axis) {
    const at = knots.map((_, i) => i);
    // Equal notes share a place; the first of them stands for both.
    const marks = notes.map((f) => (sorted.indexOf(f) + 1 - start) / span);
    return { knots, at, marks, start, span };
  }
  const at = knots.map((f) => axisOf(axis, f));
  for (let i = 1; i < at.length; i++) at[i] = Math.max(at[i]!, at[i - 1]!);
  const marks = notes.map((f) => {
    const t = (axisOf(axis, f) - axis.start) / axis.span;
    return t >= -1e-6 && t <= 1 + 1e-6 ? Math.min(1, Math.max(0, t)) : null;
  });
  return { knots, at, marks, start: axis.start, span: axis.span };
};

/** Frequency at position `t` (0 to 1) along a glide strip. */
export const glideAt = (scale: GlideScale, t: number): number => {
  const x = scale.start + Math.min(1, Math.max(0, t)) * scale.span;
  const last = scale.knots.length - 1;
  let j = 0;
  while (j < last - 1 && x >= scale.at[j + 1]!) j++;
  const gap = scale.at[j + 1]! - scale.at[j]!;
  const s = gap > 1e-9 ? ease((x - scale.at[j]!) / gap) : 1;
  const a = scale.knots[j]!;
  const b = scale.knots[j + 1]!;
  return a * (b / a) ** s;
};

/** The position along a strip of frequency `f`, or null when it is off the strip. */
export const glidePosOf = (scale: GlideScale, f: number): number | null => {
  const f0 = glideAt(scale, 0);
  const f1 = glideAt(scale, 1);
  if (!(f >= f0 && f <= f1)) return null;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (glideAt(scale, mid) < f) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
};
