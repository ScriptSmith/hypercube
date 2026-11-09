/**
 * Readback checks for tests and tuning (debug builds only call these). Each runs its own small
 * fluid on the app's context, steps it at a fixed rate and reports, per sample: total ink, the
 * height of its centre (fraction of the frame from the bottom), the highest row holding a visible
 * amount of ink, and the fastest velocity.
 */
import type { Rgb } from "../palette";
import { type Pour, type PourLook, splatOf } from "../pours";
import { createFluid, type Physics, type Splat } from "./fluid";

export interface CheckPour {
  /** Venue px, y down. */
  x: number;
  y: number;
  hot: boolean;
  /** Steps during which it pours. */
  from: number;
  to: number;
  /** Venue px a second, for a moving finger. */
  vx?: number;
  vy?: number;
}

export interface CheckScenario {
  width: number;
  height: number;
  cell: number;
  steps: number;
  every: number;
  pours: CheckPour[];
  physics: Physics;
  look: PourLook;
  iterations?: number;
  correction?: number;
  open?: boolean;
  /** A row counts as reached when any of its texels holds more ink than this. */
  visible?: number;
}

export interface CheckResult {
  step: number[];
  total: number[];
  centroid: number[];
  reach: number[];
  speed: number[];
  heat: number[];
  heatCentre: number[];
  nx: number;
  ny: number;
}

const GREY: Rgb = [0.6, 0.6, 0.6];

export const runCheck = (gl: WebGL2RenderingContext, s: CheckScenario): CheckResult => {
  const fluid = createFluid(gl, {
    width: s.width,
    height: s.height,
    cell: s.cell,
    dyeScale: 2,
    iterations: s.iterations ?? 28,
    correction: s.correction,
  });
  const out: CheckResult = {
    step: [],
    total: [],
    centroid: [],
    reach: [],
    speed: [],
    heat: [],
    heatCentre: [],
    nx: fluid.nx,
    ny: fluid.ny,
  };
  const pours: Pour[] = s.pours.map((p, i) => ({
    wire: i,
    x: p.x,
    y: p.y,
    px: p.x,
    py: p.y,
    vx: p.vx ?? 0,
    vy: p.vy ?? 0,
    rgb: GREY,
    hot: p.hot,
    human: true,
    since: 0,
    phase: i * 1.7,
  }));
  const dt = 1 / 60;
  const visible = s.visible ?? 0.08;
  try {
    for (let i = 0; i < s.steps; i++) {
      const splats: Splat[] = [];
      s.pours.forEach((p, k) => {
        if (i >= p.from && i < p.to) splats.push(splatOf(pours[k]!, s.look, dt, i * dt));
      });
      fluid.step(splats, {
        dt,
        time: i * dt,
        open: s.open ?? false,
        sink: { lo: 0, hi: 0, rate: 0 },
        physics: s.physics,
      });
      if (i % s.every !== s.every - 1) continue;
      const d = fluid.readDye();
      const { mx, my } = fluid;
      let total = 0;
      let cy = 0;
      let reach = 0;
      let heat = 0;
      let hy = 0;
      for (let y = 0; y < my; y++) {
        let row = 0;
        let peak = 0;
        for (let x = 0; x < mx; x++) {
          const k = (y * mx + x) * 4;
          const v = d[k]! + d[k + 1]! + d[k + 2]!;
          row += v;
          if (v > peak) peak = v;
          heat += d[k + 3]!;
          hy += d[k + 3]! * ((y + 0.5) / my);
        }
        total += row;
        cy += row * ((y + 0.5) / my);
        if (peak > visible) reach = (y + 1) / my;
      }
      const v = fluid.readVelocity();
      let vmax = 0;
      for (let k = 0; k < v.length; k += 4) vmax = Math.max(vmax, Math.hypot(v[k]!, v[k + 1]!));
      out.step.push(i + 1);
      out.total.push(total / (mx * my));
      out.centroid.push(total > 0 ? cy / total : 0);
      out.reach.push(reach);
      out.heat.push(heat / (mx * my));
      out.heatCentre.push(heat > 0 ? hy / heat : 0);
      // Cells a second to venue px a second.
      out.speed.push(vmax * (s.width / fluid.nx));
    }
  } finally {
    fluid.dispose();
  }
  return out;
};
