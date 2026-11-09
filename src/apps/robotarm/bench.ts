/**
 * The workbench, in world units: a D-shaped top (a half disc in front of the arm and a strip
 * behind its base), the bins or the stacking pad, and the slots new pieces arrive in. Pure.
 *
 * The bench top is y = 0 and the arm's base is at the origin. Every slot, bin and the pad is
 * reachable with the tool pointing straight down, which the autopilot relies on.
 */
import type { Variant } from "./config";
import { clamp } from "./math";

/** A block's edge, and a ball's radius. */
export const BLOCK = 0.36;
export const BALL = 0.2;

export const BENCH_R = 3.2;
export const BENCH_BACK = 1.0;
/** The bench slab's thickness below its top. */
export const BENCH_DEPTH = 0.32;

export interface Bin {
  index: number;
  /** Piece colour index this bin takes. */
  color: number;
  x: number;
  z: number;
  /** Rotation about the vertical, facing the base. */
  yaw: number;
  /** Half the outer width. */
  half: number;
  wall: number;
  /** Height of the rim and of the floor inside. */
  rim: number;
  floor: number;
}

export interface Pad {
  x: number;
  z: number;
  r: number;
  top: number;
}

export interface Hoop {
  x: number;
  z: number;
  /** A tower whose top reaches this height scores. */
  y: number;
  r: number;
}

/** A bank's lift: a flush platform that sends what is put on it up to the screen. */
export interface Lift {
  x: number;
  z: number;
  r: number;
  top: number;
}

export interface Slot {
  x: number;
  z: number;
}

export interface Bench {
  variant: Variant;
  bins: Bin[];
  pad: Pad | null;
  hoop: Hoop | null;
  /** Only on a bank's frames, which have a screen above. */
  lift: Lift | null;
  slots: Slot[];
  /** How many pieces the bench keeps. */
  pieces: number;
  /** Blocks in a tower that reaches the hoop. */
  tower: number;
}

export const BIN = { half: 0.5, wall: 0.06, rim: 0.3, floor: 0.03 } as const;
export const PAD = { r: 0.42, top: 0.06 } as const;
/**
 * At the back right of the bench, which is the part nearest the screen in the usual view, clear
 * of the base and the right bin.
 */
export const LIFT = { x: 1.35, z: -0.55, r: 0.4, top: 0.03 } as const;
/** Pieces on a bench. The rules keep it at most six (rule 4: few, large pieces). */
export const PIECES = 5;
export const TOWER = 3;

const bin = (index: number, color: number, x: number, z: number): Bin => ({
  index,
  color,
  x,
  z,
  yaw: Math.atan2(x, z),
  ...BIN,
});

/** A point in a bin's own frame (x across its front, z away from the base). */
export const binLocal = (b: Bin, x: number, z: number): { u: number; v: number } => {
  const dx = x - b.x;
  const dz = z - b.z;
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  return { u: dx * c - dz * s, v: dx * s + dz * c };
};

/** Back from a bin's frame to the world. */
export const binWorld = (b: Bin, u: number, v: number): { x: number; z: number } => {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  return { x: b.x + u * c + v * s, z: b.z - u * s + v * c };
};

/** Whether a disc overlaps a bin's outer square. */
export const discOverBin = (b: Bin, x: number, z: number, r: number): boolean => {
  const { u, v } = binLocal(b, x, z);
  const du = Math.max(0, Math.abs(u) - b.half);
  const dv = Math.max(0, Math.abs(v) - b.half);
  return du * du + dv * dv < r * r;
};

/** Inside the bench top, keeping `margin` from its edge. */
export const onBench = (x: number, z: number, margin = 0): boolean => {
  if (z < -BENCH_BACK + margin) return false;
  if (z <= 0) return Math.abs(x) <= BENCH_R - margin;
  return Math.hypot(x, z) <= BENCH_R - margin;
};

export const clampToBench = (x: number, z: number, margin = 0): { x: number; z: number } => {
  let cz = Math.max(z, -BENCH_BACK + margin);
  let cx = x;
  const r = BENCH_R - margin;
  if (cz <= 0) cx = clamp(cx, -r, r);
  else {
    const d = Math.hypot(cx, cz);
    if (d > r) {
      cx = (cx / d) * r;
      cz = (cz / d) * r;
    }
  }
  return { x: cx, z: cz };
};

const SLOT_RINGS = [1.35, 1.95, 2.55];
const SLOT_ANGLES = [-64, -44, -24, -8, 8, 24, 44, 64];

export const benchFor = (variant: Variant, withLift = false): Bench => {
  const bins =
    variant === "tidy" ? [bin(0, 0, -2.3, 0.3), bin(1, 1, 0, 2.5), bin(2, 2, 2.3, 0.3)] : [];
  const pad = variant === "stack" ? { x: 0, z: 2.05, ...PAD } : null;
  const hoop = pad ? { x: pad.x, z: pad.z, y: pad.top + TOWER * BLOCK, r: 0.46 } : null;
  const slots: Slot[] = [];
  for (const r of SLOT_RINGS) {
    for (const deg of SLOT_ANGLES) {
      const a = (deg * Math.PI) / 180;
      const x = r * Math.sin(a);
      const z = r * Math.cos(a);
      if (bins.some((b) => discOverBin(b, x, z, 0.32))) continue;
      if (pad && Math.hypot(x - pad.x, z - pad.z) < pad.r + 0.4) continue;
      // Slots must sit apart so pieces never arrive touching.
      if (slots.some((s) => Math.hypot(s.x - x, s.z - z) < 0.5)) continue;
      slots.push({ x, z });
    }
  }
  const lift = withLift ? { ...LIFT } : null;
  return { variant, bins, pad, hoop, lift, slots, pieces: PIECES, tower: TOWER };
};
