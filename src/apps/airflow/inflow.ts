/**
 * What enters each tunnel: per lattice row, a velocity, a relaxation time and the smoke the
 * rakes release. The solver takes it as one texture (see `Solver.setInlet`): H texels of
 * (u, v, tau, 0) then H of (r, g, b, 0).
 *
 * A touch frame's inlet is its fan: each zone (a pair has two) blows at its own wind. The
 * screen's inlet is the row of frames below it: above each frame it takes that frame's plume,
 * and where none arrives it blows a gentle updraft of its own that meanders, so a screen alone
 * still shows rising plumes.
 */
import { fromBankFraction } from "../../core/layout";
import { PLUME_TIMEOUT_MS, SCREEN_UREF } from "./config";
import { apply, type Tunnel } from "./layout";
import type { Plume } from "./wire";

/** Smoke of the rake at row `r`: thin streaks `spacing` rows apart, colours taking turns. */
export const rakeAt = (r: number, spacing: number, out: Float32Array, o: number): void => {
  spacing = Math.max(5, spacing);
  const k = Math.floor(r / spacing);
  const phase = (r + 0.5 - (k + 0.5) * spacing) / spacing;
  const width = Math.max(0.16, 1.6 / spacing);
  const v = Math.max(0, 1 - (Math.abs(phase) / width) ** 2);
  out[o] = k % 3 === 0 ? v : 0;
  out[o + 1] = k % 3 === 1 ? v : 0;
  out[o + 2] = k % 3 === 2 ? v : 0;
  out[o + 3] = 0;
};

export interface ZoneFlow {
  rows: [number, number];
  /** Inlet speed, lattice units, downstream. */
  speed: number;
  tau: number;
}

/** A touch frame's inlet: each zone's wind over its rows; rows in no zone are still. */
export const buildInlet = (
  height: number,
  zones: readonly ZoneFlow[],
  spacing: number,
  out = new Float32Array(height * 8),
): Float32Array => {
  const fallbackTau = zones[0]?.tau ?? 0.6;
  for (let r = 0; r < height; r++) {
    const z = zones.find((q) => r >= q.rows[0] && r < q.rows[1]);
    out[r * 4] = z ? z.speed : 0;
    out[r * 4 + 1] = 0;
    out[r * 4 + 2] = z ? z.tau : fallbackTau;
    out[r * 4 + 3] = 0;
    rakeAt(r, spacing, out, (height + r) * 4);
  }
  return out;
};

// ---- The screen ---------------------------------------------------------------------------

export interface Slot {
  /** Last two plumes and when they arrived (local ms), for easing between them. */
  prev: Plume | null;
  last: Plume | null;
  at: number;
  /** How much of the plume shows, easing to 1 while it arrives and to 0 after it stops. */
  weight: number;
}

/** Plume smoke arrives mixed and thinned; the screen brightens it this much. */
export const PLUME_SMOKE_GAIN = 1.4;
/** Time between plumes the screen eases over. */
const EASE_MS = 90;
/** How fast a slot's weight follows its plume arriving or stopping, per second. */
const WEIGHT_RATE = 2.5;

export interface Slots {
  hear(p: Plume, now: number): void;
  /** Advance weights; returns the positions with a live plume. */
  update(now: number, dt: number): number[];
  get(pos: number): Slot | undefined;
  clear(): void;
}

export const createSlots = (count: number): Slots => {
  const slots = new Map<number, Slot>();
  return {
    hear(p, now) {
      if (p.pos >= count) return;
      let s = slots.get(p.pos);
      if (!s) {
        s = { prev: null, last: null, at: now, weight: 0 };
        slots.set(p.pos, s);
      }
      // A different sample count (a frame that changed kind) starts afresh.
      s.prev = s.last && s.last.n === p.n ? s.last : p;
      s.last = p;
      s.at = now;
    },
    update(now, dt) {
      const live: number[] = [];
      for (const [pos, s] of slots) {
        const on = now - s.at < PLUME_TIMEOUT_MS;
        const k = Math.min(1, WEIGHT_RATE * dt);
        s.weight += ((on ? 1 : 0) - s.weight) * k;
        if (on) live.push(pos);
        if (!on && s.weight < 0.01) slots.delete(pos);
      }
      return live.sort((a, b) => a - b);
    },
    get(pos) {
      return slots.get(pos);
    },
    clear() {
      slots.clear();
    },
  };
};

/** The default updraft above frame slot `pos`: a jet in its middle that sways. */
export const defaultPlume = (pos: number, u: number, t: number): { up: number; right: number } => {
  const bump = Math.exp(-(((u - 0.55) / 0.24) ** 2));
  const sway = Math.sin(Math.PI * 2 * (t * 0.23 + pos * 0.37)) * Math.sin(Math.PI * 2 * u);
  return { up: 0.55 + 0.5 * bump, right: 0.22 * sway * bump };
};

/**
 * The screen's inlet now. Rows map to bank fractions along the screen's bottom edge; each
 * frame's plume (eased between its last two messages and weighted while it arrives or fades)
 * is blended with the default updraft.
 */
export const screenInlet = (
  tunnel: Tunnel,
  count: number,
  slots: Slots,
  now: number,
  t: number,
  tau: number,
  spacing: number,
  out = new Float32Array(tunnel.height * 8),
): Float32Array => {
  const H = tunnel.height;
  const n = Math.max(1, count);
  for (let r = 0; r < H; r++) {
    const [vx] = apply(tunnel.toVenue, 0, r + 0.5);
    const f = (vx - tunnel.rect.x) / tunnel.rect.width;
    const { pos, u } = fromBankFraction(f, n);
    const d = defaultPlume(pos, u, t);
    let up = d.up;
    let right = d.right;
    const o = (H + r) * 4;
    rakeAt(r, spacing, out, o);
    const s = slots.get(pos);
    if (s?.last && s.weight > 0.001) {
      const last = s.last;
      const prev = s.prev ?? last;
      const k = Math.min(last.n - 1, Math.max(0, Math.floor(u * last.n)));
      const a = Math.min(1, Math.max(0, (now - s.at) / EASE_MS));
      const mix = (p: Float32Array, q: Float32Array, i: number) => p[i]! + (q[i]! - p[i]!) * a;
      const w = s.weight;
      up += (mix(prev.up, last.up, k) - up) * w;
      right += (mix(prev.right, last.right, k) - right) * w;
      for (let c = 0; c < 3; c++) {
        const v = Math.min(1, PLUME_SMOKE_GAIN * mix(prev.smoke, last.smoke, k * 3 + c));
        out[o + c] = out[o + c]! + (v - out[o + c]!) * w;
      }
    }
    // Up is downstream; right is against the lattice's y, which runs to the left.
    out[r * 4] = Math.min(2, Math.max(0, up)) * SCREEN_UREF;
    out[r * 4 + 1] = -Math.min(1.5, Math.max(-1.5, right)) * SCREEN_UREF;
    out[r * 4 + 2] = tau;
    out[r * 4 + 3] = 0;
  }
  return out;
};
