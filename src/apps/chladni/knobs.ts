import { HOME, type PlateShape, type Point, Q } from "./modes";

/**
 * The plate's three settings besides the notes: the drive point (a puck on the plate), the
 * stretch (square to 2:1, square plate only) and the damping. Each is a plain value; a frame
 * eases the plate towards its targets, and on a bank the screen takes each setting from the
 * touch frame that touched it last.
 */
export interface Knobs {
  /** 0 is the square, 1 the 2:1 rectangle. */
  stretch: number;
  /** 0 is a lightly damped plate (sharp resonances, long ring), 1 a heavily damped one. */
  damping: number;
  /** Where the plate is driven, in plate coordinates. */
  at: Point;
}

/** Quality factors at the damping slider's ends. */
export const Q_LIGHT = 250;
export const Q_HEAVY = 6;

/** Damping (0 to 1) for a quality factor: the slider is even in log Q. */
export const dampingOf = (q: number): number => Math.log(q / Q_LIGHT) / Math.log(Q_HEAVY / Q_LIGHT);

/** Quality factor for a damping of 0 to 1. */
export const qOf = (damping: number): number =>
  Q_LIGHT * (Q_HEAVY / Q_LIGHT) ** Math.min(1, Math.max(0, damping));

/** The damping slider at rest: the plate's default Q. */
export const DAMPING_HOME = dampingOf(Q);

export const knobHome = (shape: PlateShape): Knobs => ({
  stretch: 0,
  damping: DAMPING_HOME,
  at: { ...HOME[shape] },
});

/** Keep a drive point on the plate, a little in from the edge. */
export const clampPoint = (shape: PlateShape, p: Point): Point => {
  const u = Number.isFinite(p.u) ? p.u : 0;
  const v = Number.isFinite(p.v) ? p.v : 0;
  if (shape === "square") {
    return { u: Math.min(0.98, Math.max(-0.98, u)), v: Math.min(0.98, Math.max(-0.98, v)) };
  }
  const r = Math.hypot(u, v);
  return r <= 0.97 ? { u, v } : { u: (u / r) * 0.97, v: (v / r) * 0.97 };
};

/** Clean a knob's value: stretch and damping into 0 to 1, a point onto the plate. */
export const clean = (shape: PlateShape, k: Knobs): Knobs => ({
  stretch: shape === "square" ? Math.min(1, Math.max(0, k.stretch || 0)) : 0,
  damping: Number.isFinite(k.damping) ? Math.min(1, Math.max(0, k.damping)) : DAMPING_HOME,
  at: clampPoint(shape, k.at),
});

/** Time constant (s) of the plate following its stretch target, so the sand is carried smoothly. */
export const STRETCH_EASE_S = 0.18;
/** Time a released drive point takes to glide home at idle. */
export const HOME_GLIDE_S = 0.6;

/** Move `value` towards `target` with time constant `tau`. */
export const approach = (value: number, target: number, dt: number, tau: number): number => {
  if (tau <= 0) return target;
  const next = value + (target - value) * (1 - Math.exp(-dt / tau));
  return Math.abs(next - target) < 1e-4 ? target : next;
};

// ---- A bank's shared knobs ----------------------------------------------------------------

export type KnobId = "stretch" | "damping" | "at";
export const KNOB_IDS: readonly KnobId[] = ["stretch", "damping", "at"];

/** A held knob that sends nothing for this long counts as let go (the heartbeat is 0.5 s). */
export const KNOB_TTL_MS = 1500;
/** A knob let go keeps its say this long, so a neighbour's older hold doesn't snap it back. */
export const KNOB_GRACE_MS = 3000;
/** Most claims the screen keeps per knob. */
export const MAX_CLAIMS = 32;

export interface Claim {
  from: string;
  /** Stretch or damping in x; a point in x and y. */
  x: number;
  y: number;
  held: boolean;
  /** When the touch began, on the shared clock: the latest touch wins. */
  since: number;
  /** Local time the last word arrived. */
  at: number;
  /** A person rather than a bot. */
  human: boolean;
}

export interface Arbiter {
  hear(knob: KnobId, claim: Claim): void;
  /** The claim in charge of a knob now, or null when none is held or recently let go. */
  winner(knob: KnobId, now: number): Claim | null;
  /** True while any knob has a winner. */
  busy(now: number): boolean;
  /** Drop a frame's claims at once (it left the roster). */
  forget(from: string): void;
  clear(): void;
}

/**
 * Last touch wins: among the claims still held (heard within `ttl`) or let go within `grace`,
 * a person beats a bot and then the touch that began latest wins. A hold whose heartbeats stop
 * counts as let go when it expires, so a vanished frame's grip runs out.
 */
export const createArbiter = (
  ttl = KNOB_TTL_MS,
  grace = KNOB_GRACE_MS,
  max = MAX_CLAIMS,
): Arbiter => {
  const claims = new Map<KnobId, Map<string, Claim>>(KNOB_IDS.map((k) => [k, new Map()]));
  const releasedAt = (c: Claim) => (c.held ? c.at + ttl : c.at);
  const live = (c: Claim, now: number) => now - releasedAt(c) <= grace;
  const better = (a: Claim, b: Claim) => {
    if (a.human !== b.human) return a.human;
    if (a.since !== b.since) return a.since > b.since;
    return a.at > b.at;
  };
  const winner = (knob: KnobId, now: number): Claim | null => {
    const map = claims.get(knob);
    if (!map) return null;
    let best: Claim | null = null;
    for (const [from, c] of map) {
      if (!live(c, now)) {
        map.delete(from);
        continue;
      }
      if (!best || better(c, best)) best = c;
    }
    return best;
  };
  return {
    hear(knob, claim) {
      const map = claims.get(knob);
      if (!map) return;
      map.delete(claim.from);
      map.set(claim.from, { ...claim });
      while (map.size > max) {
        const first = map.keys().next().value;
        if (first === undefined) break;
        map.delete(first);
      }
    },
    winner,
    busy(now) {
      return KNOB_IDS.some((k) => winner(k, now) !== null);
    },
    forget(from) {
      for (const map of claims.values()) map.delete(from);
    },
    clear() {
      for (const map of claims.values()) map.clear();
    },
  };
};
