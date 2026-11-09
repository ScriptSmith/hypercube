import { describe, expect, it } from "vitest";

/** These run the CPU reference for thousands of steps; a busy machine needs time. */
const SLOW = 180_000;
import {
  DISC_UNITS,
  KINDS,
  SMAGORINSKY,
  speedOf,
  TAU_MIN,
  tauOf,
  WINDS,
} from "../../../src/apps/airflow/config";
import { coefficient } from "../../../src/apps/airflow/forces";
import { apply, computeLayout, shapeAt, travelAt } from "../../../src/apps/airflow/layout";
import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";
import {
  createLattice,
  fill,
  type Lattice,
  LIMIT_TAU,
  mass,
  maxSpeed,
  moments,
  setSolid,
  shapeForce,
  SOLID,
  step,
} from "../../../src/apps/airflow/lattice";
import { inside, REACH, SHAPES, type ShapeId } from "../../../src/apps/airflow/shapes";

/** Mark the cells of a disc solid. */
const disc = (lat: Lattice, cx: number, cy: number, d: number, id: number, u = 0, v = 0) => {
  for (let y = 0; y < lat.height; y++) {
    for (let x = 0; x < lat.width; x++) {
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 < (d / 2) ** 2) setSolid(lat, x, y, id, u, v);
    }
  }
};

/**
 * Mark a shape's cells solid as the app places it on the wall (y up in the lattice): centre
 * (cx, cy) in cells, `size` cells per 100 outline units, `angle` anticlockwise as drawn. A shape
 * growing at `rate` (its size's change per step over its size) moves each cell out from the
 * centre, as the app's mask does with each vertex.
 */
const shape = (
  lat: Lattice,
  id: ShapeId,
  cx: number,
  cy: number,
  size: number,
  angle: number,
  rate = 0,
) => {
  const a = (angle * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const k = size / 100;
  const r = REACH * size + 1;
  for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(lat.height, cy + r); y++) {
    for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(lat.width, cx + r); x++) {
      // Lattice y runs up; the outline's y runs down.
      const dx = x + 0.5 - cx;
      const dy = -(y + 0.5 - cy);
      const px = (dx * c - dy * s) / k;
      const py = (dx * s + dy * c) / k;
      if (inside(SHAPES[id].outline, px, py)) setSolid(lat, x, y, 1, rate * dx, -rate * dy);
    }
  }
};

/** Uncover every cell of shape 1. */
const unmark = (lat: Lattice) => {
  for (let c = 0; c < lat.width * lat.height; c++) if (lat.mask[c] === 1) lat.mask[c] = 0;
};

/** Grid-scale noise: the RMS of v's second difference along the stream, in inlet speeds. */
const comb = (lat: Lattice, u: number) => {
  const { width: W, height: H } = lat;
  let s = 0;
  let n = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const c = y * W + x;
      if (lat.mask[c] || lat.mask[c - 1] || lat.mask[c + 1]) continue;
      const v = (xx: number) => moments(lat, xx, y).v;
      s += (v(x) - (v(x - 1) + v(x + 1)) / 2) ** 2;
      n++;
    }
  }
  return Math.sqrt(s / Math.max(1, n)) / u;
};

/** Spin the inlet up from still air over `ramp` steps, as the app does, while stepping. */
const run = (lat: Lattice, u: number, steps: number, ramp = 600, each?: (i: number) => void) => {
  for (let i = 0; i < steps; i++) {
    const q = Math.min(1, i / ramp);
    lat.inletU.fill(u * q * q * (3 - 2 * q));
    each?.(i);
    step(lat);
  }
};

/** Shedding frequency from the lift's upward zero crossings, as a Strouhal number. */
const strouhal = (lift: number[], d: number, u: number) => {
  const mean = lift.reduce((a, b) => a + b, 0) / lift.length;
  const ups: number[] = [];
  for (let i = 1; i < lift.length; i++) {
    if (lift[i - 1]! - mean < 0 && lift[i]! - mean >= 0) ups.push(i);
  }
  const amp = Math.max(...lift.map((v) => Math.abs(v - mean)));
  if (ups.length < 3) return { st: 0, amp };
  const period = (ups[ups.length - 1]! - ups[0]!) / (ups.length - 1);
  return { st: d / (period * u), amp };
};

describe("the lattice Boltzmann reference", () => {
  it("conserves mass in a closed box", { timeout: SLOW }, () => {
    const lat = createLattice(40, 30, { tau: 0.6, smagorinsky: SMAGORINSKY });
    for (let x = 0; x < 40; x++) {
      setSolid(lat, x, 0, SOLID.block);
      setSolid(lat, x, 29, SOLID.block);
    }
    for (let y = 0; y < 30; y++) {
      setSolid(lat, 0, y, SOLID.block);
      setSolid(lat, 39, y, SOLID.block);
    }
    fill(lat, (x, y) => [
      0.05 * Math.sin((2 * Math.PI * y) / 30),
      0.05 * Math.sin((2 * Math.PI * x) / 40),
    ]);
    const before = mass(lat);
    for (let i = 0; i < 2000; i++) step(lat);
    expect(Math.abs(mass(lat) - before) / before).toBeLessThan(1e-10);
    expect(lat.repairs).toBe(0);
  });

  it(
    "develops the parabolic profile of a channel flow, with the mass flux the same all along",
    { timeout: SLOW },
    () => {
      const W = 100;
      const H = 34;
      const U = 0.05;
      const lat = createLattice(W, H, { tau: 1, smagorinsky: 0 });
      for (let x = 0; x < W; x++) {
        setSolid(lat, x, 0, SOLID.block);
        setSolid(lat, x, H - 1, SOLID.block);
      }
      lat.inletU.fill(U);
      fill(lat, () => [U, 0]);
      for (let i = 0; i < 8000; i++) step(lat);
      const flux = (x: number) => {
        let q = 0;
        for (let j = 1; j < H - 1; j++) {
          const m = moments(lat, x, j);
          q += m.rho * m.u;
        }
        return q / (H - 2);
      };
      // The outlet holds the density, so nothing piles up: the flux is the same everywhere.
      for (const x of [1, 40, 70, 99]) expect(Math.abs(flux(x) / flux(1) - 1)).toBeLessThan(0.002);
      expect(moments(lat, W - 1, H / 2).rho).toBeCloseTo(1, 3);
      // Half-way bounce-back puts the walls half a cell into the solid rows: 32 rows of fluid.
      const rows = Array.from({ length: H - 2 }, (_, j) => moments(lat, 70, j + 1).u);
      const mean = rows.reduce((a, b) => a + b, 0) / rows.length;
      expect(mean).toBeGreaterThan(U * 0.95);
      expect(mean).toBeLessThan(U * 1.05);
      const top = 1.5 * mean;
      let worst = 0;
      rows.forEach((u, j) => {
        const s = (j + 1 - (H - 1) / 2) / ((H - 2) / 2);
        worst = Math.max(worst, Math.abs(u - top * (1 - s * s)) / top);
      });
      expect(worst).toBeLessThan(0.02);
    },
  );

  it(
    "lets air slip along a wall cell (a pair's seam) as it does along the side walls",
    { timeout: SLOW },
    () => {
      // A channel with a wall band in the middle: both halves keep a flat profile, with no
      // boundary layer along the band, just as along the outer edges.
      const W = 100;
      const H = 41;
      const U = 0.05;
      const lat = createLattice(W, H, { tau: 0.8, smagorinsky: 0, soft: true });
      for (let x = 0; x < W; x++) setSolid(lat, x, 20, SOLID.wall);
      lat.inletU.fill(U);
      lat.inletU[20] = 0;
      fill(lat, (_, y) => [y === 20 ? 0 : U, 0]);
      for (let i = 0; i < 3000; i++) step(lat);
      for (const y of [0, 5, 10, 19, 21, 30, 40]) {
        const u = moments(lat, 70, y).u;
        expect(Math.abs(u - U) / U, `row ${y}`).toBeLessThan(0.05);
      }
      expect(lat.repairs).toBe(0);
    },
  );

  it(
    "sheds vortices behind a disc at Re 100 with a Strouhal number near 0.2",
    { timeout: SLOW },
    () => {
      const W = 150;
      const H = 48;
      const D = 8;
      const U = 0.1;
      const lat = createLattice(W, H, {
        tau: 0.5 + (3 * U * D) / 100,
        smagorinsky: SMAGORINSKY,
        spongeFrom: 128,
        spongeTau: 1,
      });
      lat.inletU.fill(U);
      disc(lat, 32, H / 2 + 0.3, D, 1);
      fill(lat, () => [U, 0]);
      const lift: number[] = [];
      for (let i = 0; i < 5000; i++) {
        step(lat);
        if (i >= 2500) lift.push(shapeForce(lat, 1).y);
      }
      const { st, amp } = strouhal(lift, D, U);
      expect(amp).toBeGreaterThan(0.005);
      expect(st).toBeGreaterThan(0.15);
      expect(st).toBeLessThan(0.27);
    },
  );

  it(
    "keeps a steady wake (no shedding) at the gentle wind's Reynolds number",
    { timeout: SLOW },
    () => {
      const W = 150;
      const H = 48;
      const D = 8;
      const U = 0.1;
      const lat = createLattice(W, H, {
        tau: 0.5 + (3 * U * D) / 30,
        smagorinsky: SMAGORINSKY,
        spongeFrom: 128,
        spongeTau: 1,
      });
      lat.inletU.fill(U);
      disc(lat, 32, H / 2 + 0.3, D, 1);
      fill(lat, () => [U, 0]);
      const lift: number[] = [];
      for (let i = 0; i < 4000; i++) {
        step(lat);
        if (i >= 2500) lift.push(shapeForce(lat, 1).y);
      }
      expect(strouhal(lift, D, U).amp).toBeLessThan(0.001);
    },
  );

  it("lifts a cambered wing tilted nose up, and pushes it downstream", { timeout: SLOW }, () => {
    const W = 160;
    const H = 64;
    const U = 0.08;
    const chord = 30;
    const lat = createLattice(W, H, {
      tau: 0.5 + (3 * U * chord) / 160,
      smagorinsky: SMAGORINSKY,
      spongeFrom: 140,
      spongeTau: 1,
    });
    lat.inletU.fill(U);
    // On the wall a clockwise turn (negative) lifts the nose: 6 degrees of attack.
    shape(lat, "wing", 50, H / 2, chord, SHAPES.wing.rest);
    fill(lat, () => [U, 0]);
    let fx = 0;
    let fy = 0;
    for (let i = 0; i < 2500; i++) {
      step(lat);
      if (i >= 1500) {
        const f = shapeForce(lat, 1);
        fx += f.x;
        fy += f.y;
      }
    }
    expect(fy).toBeGreaterThan(0);
    expect(fx).toBeGreaterThan(0);
  });

  it(
    "never blows up at any wind, with a plate across the stream and a finger swept through it",
    { timeout: SLOW },
    () => {
      // The coarsest grid the app uses (the wall at res 0.25): 18% of the height blocked.
      const W = 150;
      const H = 87;
      const D = ((DISC_UNITS / 100) * 440) / 28;
      for (const wind of [0, WINDS.steady, 1]) {
        const U = speedOf(wind);
        const tau = tauOf(wind, D);
        expect(tau).toBeGreaterThanOrEqual(TAU_MIN);
        const lat = createLattice(W, H, {
          tau,
          smagorinsky: SMAGORINSKY,
          spongeFrom: 130,
          spongeTau: 1,
        });
        shape(lat, "plate", 30, H / 2, 16, 70);
        fill(lat, () => [0, 0]);
        const sweep = (i: number) => {
          if (i % 10 !== 0) return;
          for (let c = 0; c < W * H; c++) if (lat.mask[c] === SOLID.finger) lat.mask[c] = 0;
          if (i >= 1800) return;
          // A finger swept up and down through the wake at the fastest wall speed allowed.
          disc(
            lat,
            60,
            H / 2 + Math.sin(i / 120) * H * 0.35,
            6,
            SOLID.finger,
            0,
            Math.cos(i / 120) * 0.1,
          );
        };
        run(lat, U, 2400, 300, sweep);
        const top = maxSpeed(lat);
        expect(Number.isFinite(top)).toBe(true);
        expect(top).toBeLessThan(0.25);
        expect(lat.repairs).toBe(0);
        expect(comb(lat, U)).toBeLessThan(0.03);
      }
    },
  );

  it(
    "lets sound out through a soft inlet, where a hard one makes the tunnel ring",
    { timeout: SLOW },
    () => {
      // The fan spins up and a disc sheds eddies: both make sound. Between a hard inlet and
      // the outlet it rings like a pipe; a soft inlet lets it out.
      const swing = (soft: boolean) => {
        const W = 200;
        const H = 40;
        const lat = createLattice(W, H, {
          tau: 0.52,
          smagorinsky: SMAGORINSKY,
          spongeFrom: 175,
          spongeTau: 1,
          soft,
          bulk: 1,
        });
        disc(lat, 60, H / 2 + 0.3, 8, 1);
        fill(lat, () => [0, 0]);
        let lo = Number.POSITIVE_INFINITY;
        let hi = Number.NEGATIVE_INFINITY;
        run(lat, 0.055, 4000, 300, (i) => {
          if (i < 2000 || i % 25 !== 0) return;
          let m = 0;
          for (let x = 5; x < 170; x += 15) m += moments(lat, x, 10).rho + moments(lat, x, 30).rho;
          lo = Math.min(lo, m);
          hi = Math.max(hi, m);
        });
        return (hi - lo) / 24;
      };
      const soft = swing(true);
      const hard = swing(false);
      expect(soft).toBeLessThan(0.003);
      expect(hard).toBeGreaterThan(soft * 5);
    },
  );

  it(
    "raises the viscosity where air is fast, so a tight gap stays free of grid-scale combs",
    { timeout: SLOW },
    () => {
      // A plate across 40% of a narrow channel at the strong wind: the gaps run near Mach 0.4.
      const make = (limit: number) => {
        const lat = createLattice(140, 56, {
          tau: TAU_MIN,
          smagorinsky: SMAGORINSKY,
          spongeFrom: 122,
          spongeTau: 1,
          limit,
        });
        for (let y = 0; y < 56; y++) {
          for (let x = 0; x < 140; x++) {
            if (Math.abs(x + 0.5 - 32) < 2 && Math.abs(y + 0.5 - 28) < 11) setSolid(lat, x, y, 1);
          }
        }
        fill(lat, () => [0, 0]);
        run(lat, speedOf(1), 2200, 400);
        return { comb: comb(lat, speedOf(1)), repairs: lat.repairs };
      };
      const off = make(0);
      const on = make(LIMIT_TAU);
      expect(on.repairs).toBe(0);
      expect(on.comb).toBeLessThan(0.03);
      expect(off.comb).toBeGreaterThan(on.comb * 3);
    },
  );

  it.each(["wall", "kiosk", "panel"] as const)(
    "takes the largest shape a %s allows at the strong wind on its coarsest grid, near an edge and in the open",
    { timeout: SLOW },
    (kind) => {
      // The kind at res 0.25 with a plate broadside at its largest size, where its handle lets
      // it come closest to the tunnel's edge and in the middle of its range, plus a finger swept
      // through the air beside it. A shorter tunnel than the app's keeps the test quick.
      const l = computeLayout({
        kind,
        venue: VENUE_SIZE[kind],
        reach: DEFAULT_REACH[kind],
        shapes: 3,
        coarse: 4,
        span: 1,
        hands: false,
      });
      const sting = l.stings[0]!;
      const k = Math.max(...sting.scales);
      const t = travelAt(sting, k);
      const across = (hx: number, hy: number) => {
        const p = shapeAt(sting, hx, hy);
        return apply(l.tunnel.toGrid, p.x, p.y)[1];
      };
      const spec = KINDS[kind];
      const cell = l.tunnel.cell;
      const H = l.tunnel.height;
      const W = Math.min(l.tunnel.width, kind === "wall" ? 150 : 140);
      const U = speedOf(1, spec.speed);
      const places = [
        across((t.x0 + t.x1) / 2, (t.y0 + t.y1) / 2),
        across(t.x0, t.y0),
        across(t.x1, t.y0),
      ];
      // Of the two corners, the one closer to an edge.
      const edge = places.slice(1).sort((a, b) => Math.min(a, H - a) - Math.min(b, H - b))[0]!;
      for (const cy of [places[0]!, edge]) {
        const lat = createLattice(W, H, {
          tau: tauOf(1, ((DISC_UNITS / 100) * spec.shape) / cell, spec.speed),
          smagorinsky: SMAGORINSKY,
          spongeFrom: Math.round(W / 1.14),
          spongeTau: 1,
          bulk: 1,
          soft: true,
        });
        shape(lat, "plate", W * 0.25, cy, (spec.shape * k) / cell, 90);
        fill(lat, () => [0, 0]);
        const fy = cy > H / 2 ? H * 0.2 : H * 0.8;
        const sweep = (i: number) => {
          if (i % 10 !== 0) return;
          for (let c = 0; c < W * H; c++) if (lat.mask[c] === SOLID.finger) lat.mask[c] = 0;
          if (i >= 1800) return;
          const d = (2 * spec.finger) / cell;
          disc(lat, W * 0.55, fy + Math.sin(i / 120) * H * 0.1, d, SOLID.finger, 0, 0.05);
        };
        run(lat, U, 2400, 300, sweep);
        const where = `${kind} at ${k} times, ${cy.toFixed(1)} of ${H} rows across`;
        // Air squeezes hard past it, but stays below the speed clamp (MAX_SPEED, 0.3).
        expect(maxSpeed(lat), where).toBeLessThan(0.28);
        expect(lat.repairs, where).toBe(0);
        expect(comb(lat, U), where).toBeLessThan(0.03);
      }
    },
  );

  it(
    "lets a shape grow and shrink while the air moves, with no restarts and no grid-scale noise",
    { timeout: SLOW },
    () => {
      // The wall at res 0.25 and the strong wind: the size steps up through every step to the
      // largest and back down to the smallest, each change eased over 0.4 s of the wall's
      // lattice steps, the mask redrawn every few steps with the rim's velocity.
      const W = 150;
      const H = 87;
      const cell = 28;
      const U = speedOf(1);
      const base = KINDS.wall.shape / cell;
      const stepsPerS =
        Math.round(VENUE_SIZE.wall.width / cell) / (speedOf(WINDS.steady) * KINDS.wall.crossing);
      const change = Math.round(0.4 * stepsPerS);
      const hold = 60;
      const every = 4;
      const steps = KINDS.wall.sizes;
      const up = steps.slice(steps.indexOf(1));
      const sizes = [
        ...up,
        ...[...steps].reverse().slice(1),
        ...steps.slice(1, steps.indexOf(1) + 1),
      ];
      for (const id of ["disc", "plate"] as const) {
        const lat = createLattice(W, H, {
          tau: tauOf(1, (DISC_UNITS / 100) * base),
          smagorinsky: SMAGORINSKY,
          spongeFrom: 130,
          spongeTau: 1,
          bulk: 1,
          soft: true,
        });
        const at = (k: number, rate = 0) => {
          unmark(lat);
          shape(lat, id, 35, H * 0.55, base * k, 70, rate);
        };
        at(1);
        fill(lat, () => [0, 0]);
        run(lat, U, 900, 300);
        let worst = 0;
        for (let n = 1; n < sizes.length; n++) {
          const from = sizes[n - 1]!;
          const to = sizes[n]!;
          const ease = (i: number) => {
            const q = Math.min(1, i / change);
            return from + (to - from) * q * q * (3 - 2 * q);
          };
          for (let i = 0; i < change + hold; i += every) {
            const k0 = ease(i);
            const k1 = ease(i + every);
            at(k1, (k1 - k0) / every / k1);
            for (let j = 0; j < every; j++) step(lat);
          }
          worst = Math.max(worst, comb(lat, U));
        }
        expect(lat.repairs, id).toBe(0);
        expect(maxSpeed(lat), id).toBeLessThan(0.25);
        expect(worst, id).toBeLessThan(0.03);
      }
    },
  );

  it(
    "reads about the same drag coefficient on a disc at every size, so its arrow grows with it",
    { timeout: SLOW },
    () => {
      // A disc at 0.6, 1 and 1.5 times its size at the steady wind, normalised as the app
      // does by its length now. Air at a fixed viscosity drags a little harder on a small disc
      // (a lower Reynolds number) and the tunnel's sides crowd a large one, so they differ a
      // little; normalising by the usual size instead would make them differ 2.5 times.
      const W = 140;
      const H = 60;
      const U = speedOf(WINDS.steady);
      const base = 8;
      const tau = tauOf(WINDS.steady, base);
      const cds = [0.6, 1, 1.5].map((k) => {
        const lat = createLattice(W, H, {
          tau,
          smagorinsky: SMAGORINSKY,
          spongeFrom: 120,
          spongeTau: 1,
          bulk: 1,
          soft: true,
        });
        const d = base * k;
        disc(lat, 35, H / 2 + 0.3, d, 1);
        fill(lat, () => [0, 0]);
        let sum = 0;
        let n = 0;
        run(lat, U, 3600, 300, (i) => {
          if (i < 2000) return;
          sum += shapeForce(lat, 1).x;
          n++;
        });
        expect(lat.repairs).toBe(0);
        return coefficient(sum / n, U, d);
      });
      for (const cd of cds) {
        expect(cd).toBeGreaterThan(0.8);
        expect(cd).toBeLessThan(3);
      }
      expect(Math.max(...cds) / Math.min(...cds)).toBeLessThan(1.35);
    },
  );
});
