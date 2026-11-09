/**
 * Beetles: little walkers that live on the ground. They aren't cells; they walk the surface of a
 * heightmap read back from the GPU twice a second, climb small steps, turn at walls and edges,
 * paddle across water, hop away from lava and acid, and fly off after a couple of minutes. Venue
 * px throughout (y down).
 */
export interface GroundSample {
  /** Venue y of the top of the ground. */
  y: number;
  /** Depth of liquid lying on it, venue px. */
  depth: number;
  /** 0 none, 1 water or oil, 2 lava, 3 acid. */
  liquid: number;
}

export interface Ground {
  sample(x: number): GroundSample;
}

/** A Ground from the heightmap bytes (see HEIGHT_FS): one RGBA per two cells across. */
export const groundFromHeights = (
  bytes: Uint8Array,
  columns: number,
  cell: number,
  worldHeight: number,
): Ground => {
  const ys = new Float32Array(columns);
  const depths = new Float32Array(columns);
  const kinds = new Uint8Array(columns);
  for (let i = 0; i < columns; i++) {
    const rows = (bytes[i * 4] ?? 0) + (bytes[i * 4 + 1] ?? 0) * 256;
    ys[i] = worldHeight - rows * cell;
    depths[i] = (bytes[i * 4 + 2] ?? 0) * cell;
    kinds[i] = bytes[i * 4 + 3] ?? 0;
  }
  return {
    sample(x) {
      const i = Math.min(columns - 1, Math.max(0, Math.floor(x / (2 * cell))));
      return { y: ys[i] ?? worldHeight, depth: depths[i] ?? 0, liquid: kinds[i] ?? 0 };
    },
  };
};

export interface Beetle {
  id: number;
  x: number;
  y: number;
  dir: 1 | -1;
  vy: number;
  state: "walk" | "fall" | "swim" | "leave";
  born: number;
  /** Seconds, for the leg animation. */
  phase: number;
  /** Seconds left standing still. */
  pause: number;
  /** Fades out while leaving: 1 to 0. */
  alpha: number;
}

export interface CritterRules {
  cap: number;
  /** Beetles fly away after this long (ms). */
  lifeMs: number;
  /** Walking speed, venue px per second. */
  speed: number;
  /** Highest step a beetle climbs, and the drop it falls off rather than walks down. */
  step: number;
  drop: number;
  width: number;
}

export interface Critters {
  readonly list: readonly Beetle[];
  spawn(x: number, y: number, now: number): void;
  update(dt: number, now: number, ground: Ground | null, rnd: () => number): void;
  /** Beetles within `radius` of (x, y) fly away. */
  shoo(x: number, y: number, radius: number): void;
  /** All fly away. */
  leave(): void;
  clear(): void;
}

const GRAVITY = 2200;

export const createCritters = (rules: CritterRules): Critters => {
  let list: Beetle[] = [];
  let nextId = 1;

  const turn = (b: Beetle) => {
    b.dir = b.dir === 1 ? -1 : 1;
  };

  const walk = (b: Beetle, dt: number, ground: Ground, rnd: () => number) => {
    if (b.pause > 0) {
      b.pause -= dt;
      return;
    }
    if (rnd() < dt * 0.15) b.pause = 0.4 + rnd();
    if (rnd() < dt * 0.08) turn(b);
    const swim = b.state === "swim";
    const nx = b.x + b.dir * rules.speed * (swim ? 0.55 : 1) * dt;
    if (nx < 40 || nx > rules.width - 40) {
      turn(b);
      return;
    }
    const ahead = ground.sample(nx + b.dir * 20);
    if (ahead.liquid >= 2 && ahead.depth > 0) {
      // Too hot or too sharp: hop back.
      turn(b);
      b.state = "fall";
      b.vy = -520;
      return;
    }
    const here = ground.sample(nx);
    const surface = here.y - (here.liquid === 1 ? here.depth : 0);
    if (surface < b.y - rules.step) {
      turn(b);
      return;
    }
    b.x = nx;
    b.phase += dt * (swim ? 4 : 9);
    if (surface > b.y + rules.drop) {
      b.state = "fall";
      b.vy = 0;
      return;
    }
    b.y += (surface - b.y) * Math.min(1, dt * 12);
    b.state = here.liquid === 1 && here.depth > 6 ? "swim" : "walk";
  };

  return {
    get list() {
      return list;
    },

    spawn(x, y, now) {
      const live = list.filter((b) => b.state !== "leave");
      if (live.length >= rules.cap) {
        const oldest = live[0];
        if (oldest) oldest.state = "leave";
      }
      list.push({
        id: nextId++,
        x: Math.min(rules.width - 40, Math.max(40, x)),
        y,
        dir: nextId % 2 === 0 ? 1 : -1,
        vy: 0,
        state: "fall",
        born: now,
        phase: 0,
        pause: 0,
        alpha: 1,
      });
      // Bounded even if many leave at once.
      while (list.length > rules.cap * 2) list.shift();
    },

    update(dt, now, ground, rnd) {
      for (const b of list) {
        if (b.state !== "leave" && now - b.born > rules.lifeMs) b.state = "leave";
        if (b.state === "leave") {
          b.y -= 260 * dt;
          b.x += Math.sin(b.phase * 3) * 40 * dt;
          b.phase += dt * 20;
          b.alpha = Math.max(0, b.alpha - dt * 0.6);
          continue;
        }
        if (!ground) continue;
        if (b.state === "fall") {
          b.vy += GRAVITY * dt;
          b.y += b.vy * dt;
          const here = ground.sample(b.x);
          const surface = here.y - (here.liquid === 1 ? here.depth : 0);
          if (b.vy > 0 && b.y >= surface) {
            b.y = surface;
            b.vy = 0;
            b.state = here.liquid === 1 && here.depth > 6 ? "swim" : "walk";
          }
          continue;
        }
        walk(b, dt, ground, rnd);
      }
      list = list.filter((b) => b.alpha > 0.02 && b.y > -200);
    },

    shoo(x, y, radius) {
      for (const b of list) if (Math.hypot(b.x - x, b.y - y) < radius) b.state = "leave";
    },

    leave() {
      for (const b of list) b.state = "leave";
    },

    clear() {
      list = [];
    },
  };
};
