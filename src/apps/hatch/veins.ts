/**
 * The blood vessels a candling lamp shows: a few main vessels leave the embryo and branch as
 * they spread over the yolk and then round the inside of the shell. Each segment carries the
 * day it shows (`dayAt` of its distance from the embryo), so the network grows outwards day by
 * day. Our own branching walk; nothing here draws.
 */
import type { Vec3 } from "../../core/sphere";
import type { Rng } from "../../core/types";
import type { Segment } from "./cracks";

export interface VeinOptions {
  /** Main vessels leaving the embryo. */
  trunks: number;
  /** Half width of a main vessel near the embryo, radians. */
  width: number;
  /** Thinnest vessel drawn, radians. */
  thinnest: number;
  /** Most segments, so the work and the texture stay bounded. */
  limit: number;
}

export const VEIN_DEFAULTS: VeinOptions = {
  trunks: 5,
  width: 0.011,
  thinnest: 0.0028,
  limit: 2600,
};

interface Tip {
  rho: number;
  theta: number;
  heading: number;
  r: number;
}

const STEP = 0.028;
const FAR = Math.PI - 0.3;

/** A point at angle `rho` from `a` in the direction `theta` round it (east, then north). */
export const around = (a: Vec3, e: Vec3, n: Vec3, rho: number, theta: number): Vec3 => {
  const c = Math.cos(rho);
  const s = Math.sin(rho);
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  return [
    a[0] * c + (e[0] * ct + n[0] * st) * s,
    a[1] * c + (e[1] * ct + n[1] * st) * s,
    a[2] * c + (e[2] * ct + n[2] * st) * s,
  ];
};

/** East and north at a point (any direction that isn't a pole). */
export const tangents = (a: Vec3): { e: Vec3; n: Vec3 } => {
  const h = Math.hypot(a[0], a[2]) || 1e-9;
  const e: Vec3 = [a[2] / h, 0, -a[0] / h];
  const n: Vec3 = [a[1] * e[2] - a[2] * e[1], a[2] * e[0] - a[0] * e[2], a[0] * e[1] - a[1] * e[0]];
  return { e, n };
};

export const makeVeins = (
  rng: Rng,
  anchor: Vec3,
  dayAt: (rho: number) => number,
  opts: VeinOptions = VEIN_DEFAULTS,
): Segment[] => {
  const { e, n } = tangents(anchor);
  const out: Segment[] = [];
  const tips: Tip[] = [];
  const t0 = rng.range(0, Math.PI * 2);
  for (let i = 0; i < opts.trunks; i++) {
    tips.push({
      rho: 0.03,
      theta: t0 + (i / opts.trunks) * Math.PI * 2 + rng.range(-0.3, 0.3),
      heading: 0,
      r: opts.width * rng.range(0.8, 1.1),
    });
  }
  while (tips.length > 0 && out.length < opts.limit) {
    // Grow the tips breadth first, so a busy network stops evenly when the limit comes.
    const tip = tips.shift()!;
    const from = around(anchor, e, n, tip.rho, tip.theta);
    tip.heading = tip.heading * 0.82 + rng.range(-0.32, 0.32);
    const rho = tip.rho + STEP * Math.cos(tip.heading);
    const theta = tip.theta + (STEP * Math.sin(tip.heading)) / Math.max(0.05, Math.sin(rho));
    if (rho > FAR || rho < 0.02) continue;
    const to = around(anchor, e, n, rho, theta);
    const r = Math.max(opts.thinnest, tip.r);
    out.push({ a: from, b: to, ta: dayAt(tip.rho), tb: dayAt(rho), r });
    const next: Tip = { rho, theta, heading: tip.heading, r: tip.r * 0.993 };
    if (next.r < opts.thinnest) continue;
    if (rng.next() < 0.11) {
      const side = rng.next() < 0.5 ? -1 : 1;
      tips.push({
        rho,
        theta,
        heading: tip.heading + side * rng.range(0.5, 1.05),
        r: tip.r * rng.range(0.5, 0.72),
      });
      next.r *= 0.9;
    }
    tips.push(next);
  }
  return out;
};
