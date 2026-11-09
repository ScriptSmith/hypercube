/**
 * The ring road, in metres and seconds. One lane, so cars keep their order: `cars` is in ring
 * order and each car's leader is the next one (the last car follows the first, round the ring).
 *
 * Human drivers follow the Intelligent Driver Model (Treiber, Hennecke and Helbing 2000) with a
 * reaction lag (their acceleration follows the model's with a first-order lag) and a little
 * smoothed noise, which is enough for a dense ring to jam on its own, as in Sugiyama et al.
 * (2008). Smart cars drive like adaptive cruise control tuned to damp waves: they aim for the
 * slowly averaged speed of the car ahead rather than its every change, keep a longer time gap
 * and never lag. A hard backstop keeps every car at least MIN_GAP behind its leader, so nothing
 * ever touches.
 *
 * Everything here is pure and deterministic: the same seed, steps and brakes give the same ring
 * on any machine (the noise is a hash of seed, car and step, not a stream).
 */

export const CAR_LENGTH = 4.5;
/** Bumper to bumper, metres. The backstop never lets a gap close further. */
export const MIN_GAP = 0.6;
export const STEP_HZ = 50;
export const DT = 1 / STEP_HZ;

/** Speed limits for `limit` 0, 1 and 2: 30, 50 and 70 km/h. */
export const LIMITS = [30 / 3.6, 50 / 3.6, 70 / 3.6] as const;
export const LIMIT_SIGNS = [30, 50, 70] as const;
/** Every nth car is smart, for `smart` 0 to 3: none, 1 in 10, 1 in 4, half. */
export const SMART_EVERY = [0, 10, 4, 2] as const;

/** Hard braking while a finger holds a car, m/s². */
export const BRAKE = 7;
/** The most any car brakes, m/s². */
const MAX_DECEL = 9;

export interface Human {
  /** Time gap, s. */
  T: number;
  /** Jam distance, m. */
  s0: number;
  /** Most comfortable acceleration and braking, m/s². */
  a: number;
  b: number;
  /** Reaction lag, s. */
  lag: number;
  /** Noise in acceleration, m/s², and how long it takes to wander, s. */
  sigma: number;
  tau: number;
}

export const HUMAN: Human = { T: 1.1, s0: 2, a: 0.9, b: 1.6, lag: 0.45, sigma: 0.35, tau: 1.5 };

export interface Smart {
  /** Below this time gap the car matches the car ahead; above `far` it holds its averaged speed. */
  near: number;
  far: number;
  s0: number;
  a: number;
  b: number;
  /** How slowly the averaged speed follows the car ahead, s. */
  average: number;
  /** Gain on speed error, 1/s. */
  kv: number;
}

export const SMART: Smart = { near: 0.9, far: 2.6, s0: 3, a: 1.0, b: 2, average: 10, kv: 0.6 };

export interface Car {
  id: number;
  /** Rear bumper position along the ring, m, in [0, length). */
  x: number;
  v: number;
  /** Acceleration in use, m/s². */
  a: number;
  smart: boolean;
  /** The human's wandering noise, in units of sigma. */
  noise: number;
  /** The smart car's averaged target speed. */
  u: number;
  /** Ring time until which the car brakes hard. */
  brakeUntil: number;
  /** Why it brakes: 0 not braking, 1 a touch, 2 the attract mode's ghost hand. */
  mark: 0 | 1 | 2;
  /** How hard it brakes until `brakeUntil`, m/s² (BRAKE when absent). */
  decel?: number;
}

export interface Ring {
  length: number;
  cars: Car[];
  /** Ring seconds since it was made, and steps taken. */
  t: number;
  step: number;
  seed: number;
  noise: boolean;
  /** Speed limit, m/s. */
  limit: number;
  /** Every nth car is smart (0 none). */
  smartEvery: number;
  nextId: number;
  /** Cars that have passed the counting line at `line` metres. */
  line: number;
  passed: number;
}

export const MAX_CARS = 160;
export const MAX_ID = 255;

/** Cars a ring of `length` metres holds at `spacing` metres each, at least 3. */
export const carsFor = (length: number, spacing: number): number =>
  Math.max(3, Math.min(MAX_CARS, Math.round(length / spacing)));

/** The equilibrium speed of human drivers at `spacing` metres per car. */
export const equilibriumSpeed = (spacing: number, limit: number, h: Human = HUMAN): number => {
  const s = spacing - CAR_LENGTH;
  if (s <= h.s0) return 0;
  let lo = 0;
  let hi = limit;
  for (let i = 0; i < 40; i++) {
    const v = (lo + hi) / 2;
    const free = 1 - (v / limit) ** 4;
    const need = (h.s0 + v * h.T) / Math.sqrt(Math.max(1e-9, free));
    if (need < s) lo = v;
    else hi = v;
  }
  return (lo + hi) / 2;
};

const mix = (h: number): number => {
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
};

/** Uniform in (0, 1) from three integers. */
export const hash3 = (a: number, b: number, c: number): number =>
  (mix(mix(mix(a | 0) ^ (b | 0)) ^ (c | 0)) + 0.5) / 4294967296;

/** A standard normal from three integers (Box-Muller). */
const gauss = (seed: number, id: number, step: number): number => {
  const u1 = hash3(seed, id * 2 + 1, step);
  const u2 = hash3(seed ^ 0x5bd1e995, id * 2 + 2, step);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
};

/** Bumper-to-bumper gap from car `i` to the car ahead. */
export const gapAhead = (ring: Ring, i: number): number => {
  const n = ring.cars.length;
  const me = ring.cars[i]!;
  if (n === 1) return ring.length - CAR_LENGTH;
  const ahead = ring.cars[(i + 1) % n]!;
  let d = ahead.x - me.x;
  if (d <= 0) d += ring.length;
  return d - CAR_LENGTH;
};

export const idm = (
  s: number,
  v: number,
  dv: number,
  v0: number,
  T: number,
  s0: number,
  a: number,
  b: number,
): number => {
  const free = v <= v0 ? a * (1 - (v / v0) ** 4) : -b * (1 - (v0 / v) ** 2);
  const want = s0 + Math.max(0, v * T + (v * dv) / (2 * Math.sqrt(a * b)));
  const r = want / Math.max(s, 0.05);
  return free - a * r * r;
};

const smartAcc = (car: Car, s: number, vl: number, v0: number, p: Smart): number => {
  const near = p.s0 + car.v * p.near;
  const far = p.s0 + car.v * p.far + 4;
  const w = Math.max(0, Math.min(1, (s - near) / (far - near)));
  const target = Math.min(v0, (1 - w) * Math.min(vl, car.u) + w * car.u);
  const cmd = p.kv * (target - car.v);
  // The IDM with a short gap as a safety net: it only bites when a gap closes fast.
  const safe = idm(s, car.v, car.v - vl, v0, 0.6, 2, p.a, p.b);
  return Math.min(p.a, cmd, safe);
};

/** Assign smart cars evenly round the ring: every nth in ring order. */
export const assignSmart = (ring: Ring): void => {
  const every = ring.smartEvery;
  ring.cars.forEach((c, i) => {
    const smart = every > 0 && i % every === 0;
    if (smart && !c.smart) c.u = c.v;
    c.smart = smart;
  });
};

export interface RingSpec {
  length: number;
  count: number;
  seed: number;
  noise?: boolean;
  limit?: number;
  smartEvery?: number;
  line?: number;
}

/**
 * Cars spread evenly at the speed that spacing allows, each nudged a little (seeded), so a dense
 * ring starts smooth and jams later rather than at once.
 */
export const createRing = (spec: RingSpec): Ring => {
  const n = Math.max(1, Math.min(MAX_CARS, Math.round(spec.count)));
  const limit = spec.limit ?? LIMITS[1];
  const spacing = spec.length / n;
  const v = equilibriumSpeed(spacing, limit);
  const cars: Car[] = [];
  for (let i = 0; i < n; i++) {
    const jitter = (hash3(spec.seed, i, 7) - 0.5) * Math.min(1, spacing - CAR_LENGTH - MIN_GAP);
    cars.push({
      id: i,
      x: (i * spacing + jitter + spec.length) % spec.length,
      v,
      a: 0,
      smart: false,
      noise: 0,
      u: v,
      brakeUntil: -1,
      mark: 0,
    });
  }
  cars.sort((p, q) => p.x - q.x);
  const ring: Ring = {
    length: spec.length,
    cars,
    t: 0,
    step: 0,
    seed: spec.seed | 0,
    noise: spec.noise ?? true,
    limit,
    smartEvery: spec.smartEvery ?? 0,
    nextId: n,
    line: spec.line ?? 0,
    passed: 0,
  };
  assignSmart(ring);
  return ring;
};

/**
 * Brake car `id` until ring time `until` (`mark` says why, for drawing), hard unless `decel`
 * (m/s²) says otherwise.
 */
export const brakeCar = (
  ring: Ring,
  id: number,
  until: number,
  mark: 1 | 2 = 1,
  decel = BRAKE,
): boolean => {
  const car = ring.cars.find((c) => c.id === id);
  if (!car) return false;
  car.brakeUntil = until;
  car.mark = until > ring.t ? mark : 0;
  car.decel = decel;
  return true;
};

const nextA = new Float64Array(MAX_CARS);
const nextV = new Float64Array(MAX_CARS);
const nextX = new Float64Array(MAX_CARS);

/** Advance the ring one fixed step. */
export const stepRing = (ring: Ring, h: Human = HUMAN, p: Smart = SMART): void => {
  const cars = ring.cars;
  const n = cars.length;
  const L = ring.length;
  const dt = DT;
  const v0 = ring.limit;
  const keep = Math.exp(-dt / h.tau);
  const kick = Math.sqrt(1 - keep * keep);
  const follow = 1 - Math.exp(-dt / h.lag);
  const average = 1 - Math.exp(-dt / p.average);
  for (let i = 0; i < n; i++) {
    const car = cars[i]!;
    const ahead = cars[(i + 1) % n]!;
    const s = gapAhead(ring, i);
    const vl = n === 1 ? car.v : ahead.v;
    let a: number;
    if (car.brakeUntil > ring.t) {
      a = -(car.decel ?? BRAKE);
    } else {
      if (car.mark !== 0) car.mark = 0;
      if (car.smart) {
        car.u += (vl - car.u) * average;
        a = smartAcc(car, s, vl, v0, p);
      } else {
        let target = idm(s, car.v, car.v - vl, v0, h.T, h.s0, h.a, h.b);
        if (ring.noise) {
          car.noise = car.noise * keep + kick * gauss(ring.seed, car.id, ring.step);
          // No noise once stopped in a queue, so a standing car never creeps into the one ahead.
          target += h.sigma * car.noise * Math.min(1, car.v / 2);
        }
        // Braking for a closing gap is quicker than the general lag (a startled driver).
        const lag = target < car.a && target < -h.b ? Math.min(1, follow * 3) : follow;
        a = car.a + (target - car.a) * lag;
      }
    }
    a = Math.max(-MAX_DECEL, Math.min(car.smart ? p.a : h.a, a));
    let v = car.v + a * dt;
    let dx: number;
    if (v < 0) {
      // Stopped within the step.
      dx = a < 0 ? (car.v * car.v) / (-2 * a) : 0;
      v = 0;
      if (a < 0) a = 0;
    } else {
      dx = ((car.v + v) / 2) * dt;
    }
    nextA[i] = a;
    nextV[i] = v;
    nextX[i] = car.x + dx;
  }
  if (n > 1) {
    // The backstop, from the car with the most room ahead backwards round the ring, so each
    // car is checked against its leader's final place.
    let start = 0;
    let most = -Infinity;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      let d = nextX[j]! - nextX[i]!;
      if (j === 0) d += L;
      if (d > most) {
        most = d;
        start = i;
      }
    }
    for (let k = 1; k < n; k++) {
      const i = (start - k + n) % n;
      const j = (i + 1) % n;
      const leadX = nextX[j]! + (j < i || (j === 0 && i === n - 1) ? L : 0);
      const limitX = leadX - CAR_LENGTH - MIN_GAP;
      if (nextX[i]! > limitX) {
        nextX[i] = Math.max(cars[i]!.x, limitX);
        nextV[i] = Math.min(nextV[i]!, nextV[j]!);
        nextA[i] = Math.min(nextA[i]!, 0);
      }
    }
  }
  let wrapped = false;
  const line = ring.line;
  for (let i = 0; i < n; i++) {
    const car = cars[i]!;
    let x = nextX[i]!;
    if ((car.x < line && x >= line) || (car.x < line + L && x >= line + L)) ring.passed++;
    if (x >= L) {
      x -= L;
      wrapped = true;
    }
    car.x = x;
    car.v = nextV[i]!;
    car.a = nextA[i]!;
  }
  if (wrapped) cars.sort((p, q) => p.x - q.x);
  ring.t = (ring.step + 1) * dt;
  ring.step++;
};

/** Free car ids, lowest first, skipping those in use. */
const freeId = (ring: Ring): number => {
  const used = new Set(ring.cars.map((c) => c.id));
  for (let k = 0; k <= MAX_ID; k++) {
    const id = (ring.nextId + k) % (MAX_ID + 1);
    if (!used.has(id)) {
      ring.nextId = (id + 1) % (MAX_ID + 1);
      return id;
    }
  }
  return -1;
};

/**
 * Add or remove cars until there are `count`. A new car goes into the middle of the biggest
 * gap at its leader's speed (only where it fits safely); a removed car is the one with the
 * least room ahead that isn't braking for a touch.
 */
export const setCount = (ring: Ring, count: number): void => {
  const want = Math.max(1, Math.min(MAX_CARS, Math.round(count)));
  const cars = ring.cars;
  while (cars.length > want) {
    let pick = -1;
    let least = Infinity;
    for (let i = 0; i < cars.length; i++) {
      if (cars[i]!.mark !== 0) continue;
      const s = gapAhead(ring, i);
      if (s < least) {
        least = s;
        pick = i;
      }
    }
    if (pick < 0) pick = 0;
    cars.splice(pick, 1);
  }
  while (cars.length < want) {
    let pick = -1;
    let most = -Infinity;
    for (let i = 0; i < cars.length; i++) {
      const s = gapAhead(ring, i);
      if (s > most) {
        most = s;
        pick = i;
      }
    }
    const need = 2 * MIN_GAP + CAR_LENGTH + 2;
    if (pick < 0 || most < need) break;
    const id = freeId(ring);
    if (id < 0) break;
    const behind = cars[pick]!;
    const ahead = cars[(pick + 1) % cars.length]!;
    const x = (behind.x + CAR_LENGTH + most / 2 - CAR_LENGTH / 2 + ring.length) % ring.length;
    // Slow enough to stop in the room it has.
    const room = most / 2 - CAR_LENGTH / 2 - MIN_GAP;
    const v = Math.min(ahead.v, Math.sqrt(2 * HUMAN.b * Math.max(0, room)));
    cars.push({
      id,
      x,
      v,
      a: 0,
      smart: false,
      noise: 0,
      u: v,
      brakeUntil: -1,
      mark: 0,
    });
    cars.sort((p, q) => p.x - q.x);
  }
  assignSmart(ring);
};

export const setSmartEvery = (ring: Ring, every: number): void => {
  ring.smartEvery = every;
  assignSmart(ring);
};

/** Mean speed, m/s. */
export const meanSpeed = (ring: Ring): number => {
  if (ring.cars.length === 0) return 0;
  let sum = 0;
  for (const c of ring.cars) sum += c.v;
  return sum / ring.cars.length;
};

/** Standard deviation of speeds, m/s. */
export const speedSpread = (ring: Ring): number => {
  const n = ring.cars.length;
  if (n === 0) return 0;
  const m = meanSpeed(ring);
  let sum = 0;
  for (const c of ring.cars) sum += (c.v - m) ** 2;
  return Math.sqrt(sum / n);
};

/** Groups of neighbouring cars all crawling (under `slow` m/s): jams now. */
export const jams = (ring: Ring, slow = 1.5, least = 3): number => {
  const cars = ring.cars;
  const n = cars.length;
  if (n === 0) return 0;
  let first = cars.findIndex((c) => c.v >= slow);
  if (first < 0) return n >= least ? 1 : 0;
  let count = 0;
  let run = 0;
  for (let k = 1; k <= n; k++) {
    const c = cars[(first + k) % n]!;
    if (c.v < slow) run++;
    else {
      if (run >= least) count++;
      run = 0;
    }
  }
  return count;
};
