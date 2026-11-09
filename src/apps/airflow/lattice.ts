/**
 * The D2Q9 lattice Boltzmann scheme the GPU runs, as a CPU reference for tests (see
 * Krüger et al., "The Lattice Boltzmann Method", chapters 3 to 5; Chen and Doolen 1998).
 *
 * Grid frame: x runs downstream from the inlet (x = 0) to the outlet (x = width - 1); y runs
 * across, and with x it makes a right-handed frame as drawn, so vorticity keeps its sign.
 *
 * One step, at every cell, pulls the post-collision populations of the last step (fused
 * streaming and collision):
 * - across the side walls (y outside the grid), and from wall cells (SOLID.wall, which run
 *   along the stream, such as a pair's seam), by specular reflection: free-slip walls;
 * - past the outlet by Zou and He's pressure condition, holding the density at 1 so the
 *   mass in the tunnel never drifts;
 * - from the inlet by Zou and He's velocity condition (Zou and He 1997), with the velocity
 *   the inlet profile gives for that row;
 * - from a solid cell by half-way bounce-back, with Ladd's moving-wall term for shapes and
 *   fingers that move.
 * Then it collides with BGK, with a relaxation time raised by Smagorinsky's eddy viscosity
 * where the strain is large, where the air is fast (see LIMIT_FROM), and in a sponge before the
 * outlet, so vortices fade before they reach it. Populations are stored as deviations from their rest weights,
 * which keeps precision in 32-bit floats.
 */

/** Lattice velocities. 1 to 4 are the axes, 5 to 8 the diagonals. */
export const CX = [0, 1, 0, -1, 0, 1, -1, -1, 1] as const;
export const CY = [0, 0, 1, 0, -1, 1, 1, -1, -1] as const;
export const WEIGHTS = [4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36] as const;
/** The opposite direction of each. */
export const OPP = [0, 3, 4, 1, 2, 7, 8, 5, 6] as const;
/** Each direction reflected in a side wall (cy negated). */
export const MIRROR = [0, 1, 4, 3, 2, 8, 7, 6, 5] as const;

/** Solid ids in the mask. Shapes are 1 to MAX_SHAPES; their forces are summed. */
/**
 * `block` is any other solid that bounces air back (no-slip); `wall` cells reflect it
 * (free-slip) and must run along the stream, as a pair's seam does.
 */
export const SOLID = { fluid: 0, block: 7, finger: 8, wall: 9 } as const;
export const MAX_SHAPES = 4;

/** Speed above which the collision clamps the velocity (it never should at our winds). */
export const MAX_SPEED = 0.3;
/**
 * Above LIMIT_FROM the relaxation time rises (by up to LIMIT_TAU at LIMIT_FROM + LIMIT_SPAN):
 * a little viscosity where air is fast, round sharp edges and in tight gaps, keeps the lattice
 * from turning high Mach numbers into grid-scale combs (checked against the CPU reference).
 */
export const LIMIT_FROM = 0.16;
export const LIMIT_SPAN = 0.1;
export const LIMIT_TAU = 0.4;

/** Relaxation time added for a cell moving at `speed`. */
export const limitTau = (speed: number, most = LIMIT_TAU): number => {
  const q = Math.min(1, Math.max(0, (speed - LIMIT_FROM) / LIMIT_SPAN));
  return most * q * q;
};

/** Fastest wall speed a moving shape or finger imposes, in lattice units. */
export const MAX_WALL_SPEED = 0.1;
/** Densities outside this range mark a broken cell, which restarts at rest. */
export const RHO_MIN = 0.2;
export const RHO_MAX = 5;

export interface LatticeParams {
  /** Base relaxation time, viscosity (tau - 1/2) / 3, for rows `inletTau` doesn't set. */
  tau: number;
  /** Smagorinsky constant (0 turns the eddy viscosity off). */
  smagorinsky: number;
  /** First column of the sponge; `width` for none. */
  spongeFrom: number;
  /** Relaxation time at the outlet end of the sponge. */
  spongeTau: number;
  /** Most relaxation time added where air is fast (LIMIT_TAU; 0 turns the limiter off). */
  limit: number;
  /**
   * Relaxation time of the stress's trace, which sets the bulk viscosity: how fast sound dies
   * away. 0 relaxes it with the shear (plain BGK). Eddies don't feel it.
   */
  bulk: number;
  /**
   * A non-reflecting inlet: rather than holding the velocity exactly, it holds the acoustic
   * wave entering the tunnel at zero and lets waves arriving from downstream leave. With a
   * hard inlet the tunnel rings like a pipe closed at one end (see `inletState`).
   */
  soft: boolean;
  /** Weight of each step in the per-cell force average (1 keeps only the last step). */
  forceEma: number;
}

export interface Lattice {
  readonly width: number;
  readonly height: number;
  /**
   * Post-collision populations minus their weights: direction i of cell c (c = y * width + x)
   * is at i * width * height + c.
   */
  g: Float64Array;
  /** Momentum exchanged with solid neighbours, averaged over steps (see forceEma). */
  fx: Float64Array;
  fy: Float64Array;
  /** The shape id each cell touched in the last step, or 0. */
  fid: Uint8Array;
  /** Solid id per cell (0 is fluid). */
  mask: Uint8Array;
  /** Velocity of the solid in each solid cell, lattice units. */
  wallU: Float64Array;
  wallV: Float64Array;
  /** Inlet velocity per row. */
  inletU: Float64Array;
  inletV: Float64Array;
  /** Base relaxation time per row (one bank frame's wind can differ from its neighbour's). */
  inletTau: Float64Array;
  params: LatticeParams;
  steps: number;
  /** Cells reset because they broke. */
  repairs: number;
  /** Buffers the next step writes into. */
  next: { g: Float64Array; fx: Float64Array; fy: Float64Array; fid: Uint8Array };
}

export const defaultParams = (width: number): LatticeParams => ({
  tau: 0.6,
  smagorinsky: 0,
  spongeFrom: width,
  spongeTau: 1,
  limit: LIMIT_TAU,
  bulk: 0,
  soft: false,
  forceEma: 1,
});

export const equilibrium = (i: number, rho: number, u: number, v: number): number => {
  const cu = CX[i]! * u + CY[i]! * v;
  return WEIGHTS[i]! * rho * (1 + 3 * cu + 4.5 * cu * cu - 1.5 * (u * u + v * v));
};

/** Relaxation time at column x for a row whose base is `base`, rising through the sponge. */
export const tauAt = (p: LatticeParams, width: number, x: number, base: number): number => {
  if (x < p.spongeFrom || p.spongeFrom >= width - 1) return base;
  const s = Math.min(1, (x - p.spongeFrom) / (width - 1 - p.spongeFrom));
  return base + (p.spongeTau - base) * s * s;
};

/** Smagorinsky's relaxation time for base `tau0` and non-equilibrium momentum flux norm `pi`. */
export const smagorinskyTau = (tau0: number, c: number, pi: number, rho: number): number =>
  0.5 * (tau0 + Math.sqrt(tau0 * tau0 + (18 * Math.SQRT2 * c * c * pi) / rho));

export const createLattice = (
  width: number,
  height: number,
  params: Partial<LatticeParams> = {},
): Lattice => {
  const n = width * height;
  const full = { ...defaultParams(width), ...params };
  return {
    width,
    height,
    g: new Float64Array(9 * n),
    fx: new Float64Array(n),
    fy: new Float64Array(n),
    fid: new Uint8Array(n),
    mask: new Uint8Array(n),
    wallU: new Float64Array(n),
    wallV: new Float64Array(n),
    inletU: new Float64Array(height),
    inletV: new Float64Array(height),
    inletTau: new Float64Array(height).fill(full.tau),
    params: full,
    steps: 0,
    repairs: 0,
    next: {
      g: new Float64Array(9 * n),
      fx: new Float64Array(n),
      fy: new Float64Array(n),
      fid: new Uint8Array(n),
    },
  };
};

/** Population i of cell (x, y), as stored (minus its weight). */
export const pop = (lat: Lattice, i: number, x: number, y: number): number =>
  lat.g[i * lat.width * lat.height + y * lat.width + x]!;

/** Set every cell to equilibrium: fluid at density 1 moving with `u(x, y)`, solids with their wall. */
export const fill = (lat: Lattice, u: (x: number, y: number) => [number, number]): void => {
  const { width: W, height: H } = lat;
  const n = W * H;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = y * W + x;
      const [ux, uy] = lat.mask[c] ? [lat.wallU[c]!, lat.wallV[c]!] : u(x, y);
      for (let i = 0; i < 9; i++) lat.g[i * n + c] = equilibrium(i, 1, ux, uy) - WEIGHTS[i]!;
      lat.fx[c] = 0;
      lat.fy[c] = 0;
      lat.fid[c] = 0;
    }
  }
};

/** Speed of sound on the lattice. */
export const CS = Math.sqrt(1 / 3);

/**
 * Density and normal velocity at an inlet cell whose known populations sum to `known`
 * (f0 + f2 + f4 + 2 (f3 + f6 + f7) = rho (1 - u)). A hard inlet takes u = `target`. A soft one
 * keeps the incoming characteristic du + cs drho at zero, u = target - cs (rho - 1), so sound
 * arriving from downstream passes out through it.
 */
export const inletState = (known: number, target: number, soft: boolean): [number, number] => {
  if (!soft) return [known / (1 - target), target];
  const b = 1 - target - CS;
  const rho = (-b + Math.sqrt(b * b + 4 * CS * known)) / (2 * CS);
  return [rho, target - CS * (rho - 1)];
};

/**
 * A wall velocity as the mask stores it: its length clamped to MAX_WALL_SPEED, then each part
 * as a byte around 128 (`wallByte`), which `fromWallByte` turns back.
 */
export const wallBytes = (u: number, v: number): [number, number] => {
  let a = u / MAX_WALL_SPEED;
  let b = v / MAX_WALL_SPEED;
  const len = Math.hypot(a, b);
  if (len > 1) {
    a /= len;
    b /= len;
  }
  const byte = (k: number) => Math.min(255, Math.max(0, Math.round(128 + k * 127)));
  return [byte(a), byte(b)];
};

export const fromWallByte = (b: number): number => ((b - 128) / 127) * MAX_WALL_SPEED;

/** Mark a solid cell with its id and wall velocity, quantised as the GPU's mask holds it. */
export const setSolid = (lat: Lattice, x: number, y: number, id: number, u = 0, v = 0): void => {
  if (x < 0 || y < 0 || x >= lat.width || y >= lat.height) return;
  const c = y * lat.width + x;
  const [bu, bv] = wallBytes(u, v);
  lat.mask[c] = id;
  lat.wallU[c] = id ? fromWallByte(bu) : 0;
  lat.wallV[c] = id ? fromWallByte(bv) : 0;
};

/** The mask as RGBA bytes, as the GPU reads it. */
export const maskBytes = (lat: Lattice): Uint8Array => {
  const n = lat.width * lat.height;
  const out = new Uint8Array(n * 4);
  for (let c = 0; c < n; c++) {
    const [bu, bv] = wallBytes(lat.wallU[c]!, lat.wallV[c]!);
    out[c * 4] = lat.mask[c]!;
    out[c * 4 + 1] = lat.mask[c] ? bu : 128;
    out[c * 4 + 2] = lat.mask[c] ? bv : 128;
    out[c * 4 + 3] = 255;
  }
  return out;
};

/** One fused stream-and-collide step. */
export const step = (lat: Lattice): void => {
  const { width: W, height: H, g, mask, params: p, wallU, wallV } = lat;
  const n = W * H;
  const { g: out, fx: fxOut, fy: fyOut, fid: fidOut } = lat.next;
  const f = new Float64Array(9);
  const eq = new Float64Array(9);
  const cx = Float64Array.from(CX);
  const cy = Float64Array.from(CY);
  const w = Float64Array.from(WEIGHTS);
  const opp = Int32Array.from(OPP);
  const mirror = Int32Array.from(MIRROR);
  const off = Int32Array.from(CX, (v, i) => v + CY[i]! * W);
  const c2 = p.smagorinsky * p.smagorinsky;
  const a = p.forceEma;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = y * W + x;
      const id = mask[c]!;
      if (id !== 0) {
        // A solid cell holds the air it would release if uncovered: at its wall's velocity
        // and its fluid neighbours' density, so a shape moving off it sends out no pulse.
        const uw = wallU[c]!;
        const vw = wallV[c]!;
        let sum = 0;
        let count = 0;
        for (let i = 1; i <= 4; i++) {
          const sx = x + cx[i]!;
          const sy = y + cy[i]!;
          if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
          const s = sy * W + sx;
          if (mask[s] !== 0) continue;
          let r = 1;
          for (let k = 0; k < 9; k++) r += g[k * n + s]!;
          sum += r;
          count++;
        }
        const rw = count > 0 ? Math.min(RHO_MAX, Math.max(RHO_MIN, sum / count)) : 1;
        for (let i = 0; i < 9; i++) out[i * n + c] = equilibrium(i, rw, uw, vw) - WEIGHTS[i]!;
        fxOut[c] = 0;
        fyOut[c] = 0;
        fidOut[c] = 0;
        continue;
      }
      let fx = 0;
      let fy = 0;
      let touched = 0;
      const interior = x > 0 && y > 0 && x < W - 1 && y < H - 1;
      for (let i = 0; i < 9; i++) {
        let s: number;
        let j = i;
        if (interior && mask[c - off[i]!] !== SOLID.wall) {
          s = c - off[i]!;
        } else {
          const sx = x - cx[i]!;
          let sy = y - cy[i]!;
          // Side walls and wall cells (which run along the stream) are free-slip: the
          // population comes from beside this cell, reflected.
          if (sy < 0 || sy >= H || mask[sy * W + Math.min(W - 1, Math.max(0, sx))] === SOLID.wall) {
            sy = y;
            j = mirror[i]!;
          }
          if (sx < 0 || sx >= W) continue;
          s = sy * W + sx;
        }
        const sid = mask[s]!;
        if (sid !== 0) {
          const o = opp[i]!;
          const back = g[o * n + c]! + w[o]!;
          const fi = back + 6 * w[i]! * (cx[i]! * wallU[s]! + cy[i]! * wallV[s]!);
          f[i] = fi;
          fx -= cx[i]! * (back + fi);
          fy -= cy[i]! * (back + fi);
          if (sid <= MAX_SHAPES) touched = sid;
        } else {
          f[i] = g[j * n + s]! + w[j]!;
        }
      }
      if (x === 0) {
        // Zou and He: the three populations entering from the inlet, from the velocity there.
        const uy = lat.inletV[y]!;
        const known = f[0]! + f[2]! + f[4]! + 2 * (f[3]! + f[6]! + f[7]!);
        const [rho, ux] = inletState(known, lat.inletU[y]!, p.soft);
        const half = 0.5 * (f[2]! - f[4]!);
        f[1] = f[3]! + (2 / 3) * rho * ux;
        f[5] = f[7]! - half + (1 / 6) * rho * ux + 0.5 * rho * uy;
        f[8] = f[6]! + half + (1 / 6) * rho * ux - 0.5 * rho * uy;
      } else if (x === W - 1) {
        // Zou and He at the outlet, holding the density at 1 (so the tunnel's mass can't
        // drift over days) and the air leaving straight out.
        const ux = -1 + f[0]! + f[2]! + f[4]! + 2 * (f[1]! + f[5]! + f[8]!);
        const half = 0.5 * (f[2]! - f[4]!);
        f[3] = f[1]! - (2 / 3) * ux;
        f[6] = f[8]! - half - (1 / 6) * ux;
        f[7] = f[5]! + half - (1 / 6) * ux;
      }
      let rho = 0;
      let mx = 0;
      let my = 0;
      for (let i = 0; i < 9; i++) {
        const fi = f[i]!;
        rho += fi;
        mx += cx[i]! * fi;
        my += cy[i]! * fi;
      }
      // NaN fails both comparisons, so a broken cell restarts at rest.
      if (!(rho > RHO_MIN && rho < RHO_MAX)) {
        lat.repairs++;
        for (let i = 0; i < 9; i++) out[i * n + c] = 0;
        fxOut[c] = 0;
        fyOut[c] = 0;
        fidOut[c] = 0;
        continue;
      }
      let ux = mx / rho;
      let uy = my / rho;
      const speed = Math.sqrt(ux * ux + uy * uy);
      if (speed > MAX_SPEED) {
        ux *= MAX_SPEED / speed;
        uy *= MAX_SPEED / speed;
      }
      let pxx = 0;
      let pyy = 0;
      let pxy = 0;
      const uu = 1.5 * (ux * ux + uy * uy);
      for (let i = 0; i < 9; i++) {
        const ci = cx[i]!;
        const cj = cy[i]!;
        const cu = ci * ux + cj * uy;
        const e = w[i]! * rho * (1 + 3 * cu + 4.5 * cu * cu - uu);
        eq[i] = e;
        const d = f[i]! - e;
        pxx += ci * ci * d;
        pyy += cj * cj * d;
        pxy += ci * cj * d;
      }
      const tau0 = tauAt(p, W, x, lat.inletTau[y]!) + limitTau(speed, p.limit);
      // The stress splits into its trace (compression: sound) and the rest (shear).
      const tr = 0.5 * (pxx + pyy);
      const dxx = pxx - tr;
      const tau =
        c2 > 0
          ? smagorinskyTau(tau0, p.smagorinsky, Math.sqrt(2 * dxx * dxx + 2 * pxy * pxy), rho)
          : tau0;
      // Regularised: keep only the part of the non-equilibrium populations that carries
      // stress (its projection on the second-order Hermite polynomials), which removes the
      // ghost modes that otherwise grow into grid-scale noise at low viscosity.
      const ks = 1 - 1 / tau;
      const kb = p.bulk > 0 ? 1 - 1 / p.bulk : ks;
      const qxx = ks * dxx + kb * tr;
      const qyy = -ks * dxx + kb * tr;
      const qxy = ks * pxy;
      for (let i = 0; i < 9; i++) {
        const ci = cx[i]!;
        const cj = cy[i]!;
        const q = (ci * ci - 1 / 3) * qxx + (cj * cj - 1 / 3) * qyy + 2 * ci * cj * qxy;
        out[i * n + c] = eq[i]! + 4.5 * w[i]! * q - w[i]!;
      }
      fxOut[c] = lat.fx[c]! * (1 - a) + fx * a;
      fyOut[c] = lat.fy[c]! * (1 - a) + fy * a;
      fidOut[c] = touched;
    }
  }
  lat.next = { g: lat.g, fx: lat.fx, fy: lat.fy, fid: lat.fid };
  lat.g = out;
  lat.fx = fxOut;
  lat.fy = fyOut;
  lat.fid = fidOut;
  lat.steps++;
};

/** Density and velocity of a cell, from its stored populations. */
export const moments = (
  lat: Lattice,
  x: number,
  y: number,
): { rho: number; u: number; v: number } => {
  const n = lat.width * lat.height;
  const c = y * lat.width + x;
  let rho = 1;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < 9; i++) {
    const gi = lat.g[i * n + c]!;
    rho += gi;
    mx += CX[i]! * gi;
    my += CY[i]! * gi;
  }
  return { rho, u: mx / rho, v: my / rho };
};

/** Total mass of the fluid cells. */
export const mass = (lat: Lattice): number => {
  const n = lat.width * lat.height;
  let m = 0;
  for (let c = 0; c < n; c++) {
    if (lat.mask[c]) continue;
    let rho = 1;
    for (let i = 0; i < 9; i++) rho += lat.g[i * n + c]!;
    m += rho;
  }
  return m;
};

/** The averaged force on shape `id`, summed over the cells that touched it. */
export const shapeForce = (lat: Lattice, id: number): { x: number; y: number } => {
  let x = 0;
  let y = 0;
  for (let c = 0; c < lat.width * lat.height; c++) {
    if (lat.fid[c] !== id) continue;
    x += lat.fx[c]!;
    y += lat.fy[c]!;
  }
  return { x, y };
};

/** Largest speed over the fluid cells, or Infinity if any is not finite. */
export const maxSpeed = (lat: Lattice): number => {
  let m = 0;
  for (let y = 0; y < lat.height; y++) {
    for (let x = 0; x < lat.width; x++) {
      if (lat.mask[y * lat.width + x]) continue;
      const { u, v } = moments(lat, x, y);
      const s = Math.hypot(u, v);
      if (!Number.isFinite(s)) return Number.POSITIVE_INFINITY;
      if (s > m) m = s;
    }
  }
  return m;
};
