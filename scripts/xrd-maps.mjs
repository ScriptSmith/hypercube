#!/usr/bin/env node
// Simulated reciprocal space maps for the X-ray diffraction app (src/apps/xrd).
//
//   node scripts/xrd-maps.mjs [--only=<name>,<name>] [--out=<dir>]
//
// Writes an 8-bit PNG and a JSON sidecar for each map below into src/apps/xrd/data/ (or
// --out). Nothing is measured: every map is worked out from its crystal's cell and atoms
// (src/apps/xrd/crystals.ts) for the flat plate preset in
// data/presets.json, and the same seeds give the same files on every run.
//
// The virtual experiment: copper Kα through a nickel filter (Kα1, Kα2 at half strength, a
// trace of Kβ and, for single crystals, the tube's continuous spectrum), a symmetric scan with
// the arm from 5° (10° for single crystals) to 140°, repeated with the sample tilted sideways in
// steps, so the map is a slice through reciprocal space in the plane of the surface normal (Sz)
// and the tilt (Sx).
// A pixel has data where both beams stay at least 1° above the surface.
//
// Intensities: |F|² from the atoms' form factors with each atom's Debye-Waller fall-off, the
// powder Lorentz-polarisation factor (1 + cos² 2θ) / (sin² θ cos θ) for rings, 1 / sin 2θ and
// the polarisation for single-crystal spots, pseudo-Voigt peaks whose width grows with angle,
// texture as pole densities, air scatter near the beam and a smooth sample background, then
// Poisson counting noise. Values are square-root scaled into the PNG, 0 meaning no data.
import { deflateSync } from "node:zlib";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CRYSTALS, gVector, structureFactor } from "../src/apps/xrd/crystals.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DATA = join(ROOT, "src/apps/xrd/data");
const DEG = Math.PI / 180;

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "1"];
  }),
);

// ---- The experiment -------------------------------------------------------------------------

const PRESETS = JSON.parse(readFileSync(join(DATA, "presets.json"), "utf8")).presets;
const PLATE = PRESETS.find((p) => p.label === "Flat plate");
if (!PLATE) throw new Error("presets.json has no flat plate");

/** The map's wavelength: copper Kα1, the flat plate's. */
const LAMBDA = PLATE.wavelengthA;
const TWO_THETA_MAX = PLATE.twoThetaEndDeg;
const S_MAX = (2 * Math.sin((TWO_THETA_MAX / 2) * DEG)) / LAMBDA;
const STEP = 0.0025;
/** Both beams at least this far above the surface, degrees. */
const HORIZON = 1;
const SZ_MIN = (2 * Math.sin(HORIZON * DEG)) / LAMBDA;

const sOf = (twoTheta) => (2 * Math.sin((twoTheta / 2) * DEG)) / LAMBDA;
/** 2θ (degrees) at which wavelength λ reflects from spacing 1/S, or NaN. */
const twoThetaOf = (S, lambda = LAMBDA) => {
  const s = (S * lambda) / 2;
  return s > 1 ? Number.NaN : (2 * Math.asin(s)) / DEG;
};

// Copper tube at 40 kV with a 20 µm nickel filter and about 30 cm of air. Mass attenuation of
// nickel scales roughly as λ^2.8 on each side of its K edge.
const TUBE_KV = 40;
const LAMBDA_MIN = 12.398 / TUBE_KV;
const NI_EDGE = 1.4881;
const NI_THICK = 0.0178;
const niMu = (l) => (l > NI_EDGE ? 48.5 * (l / 1.5406) ** 2.8 : 335 * (l / NI_EDGE) ** 2.8);
const transmit = (l) => Math.exp(-niMu(l) * NI_THICK - 0.36 * (l / 1.5406) ** 3);
const LINES = [
  { lambda: 1.5406, emitted: 1 },
  { lambda: 1.5444, emitted: 0.5 },
  { lambda: 1.3922, emitted: 0.2 },
].map((l) => ({ lambda: l.lambda, w: (l.emitted * transmit(l.lambda)) / transmit(1.5406) }));
/** Continuum per Å beside Kα1, as a fraction of Kα1's whole line, before the filter. */
const CONTINUUM = 0.4;
const kramers = (l) => Math.max(0, l / LAMBDA_MIN - 1) / (l * l);

const polarisation = (tt) => (1 + Math.cos(tt * DEG) ** 2) / 2;
const powderLP = (tt) => {
  const t = (tt / 2) * DEG;
  return (2 * polarisation(tt)) / (Math.sin(t) ** 2 * Math.cos(t));
};

/** Peak width (FWHM, degrees of 2θ) from the Caglioti form. */
const fwhm = (tt, { U, V, W }) => {
  const t = Math.tan((tt / 2) * DEG);
  return Math.sqrt(Math.max(1e-4, U * t * t + V * t + W));
};
const LN2 = Math.log(2);
/** Pseudo-Voigt, area 1 in degrees. */
const pseudoVoigt = (x, f, eta) => {
  const q = (4 * x * x) / (f * f);
  const gauss = (2 / f) * Math.sqrt(LN2 / Math.PI) * Math.exp(-LN2 * q);
  const lorentz = 2 / (Math.PI * f) / (1 + q);
  return eta * lorentz + (1 - eta) * gauss;
};

// ---- Random numbers -------------------------------------------------------------------------

const hash = (...ns) => {
  let h = 0x811c9dc5;
  for (const n of ns) {
    h = Math.imul(h ^ (n | 0), 0x01000193) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
    h = (h ^ (h >>> 12)) >>> 0;
  }
  return h;
};

/** sfc32: a small, fast, seeded generator. */
const rng = (seed) => {
  let a = seed >>> 0;
  let b = hash(seed, 1);
  let c = hash(seed, 2);
  let d = 1;
  const next = () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  return next;
};

const normal = (rand) => {
  const u = Math.max(1e-12, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
};

const poisson = (mean, rand) => {
  if (mean <= 0) return 0;
  if (mean > 40) return Math.max(0, Math.round(mean + Math.sqrt(mean) * normal(rand)));
  const limit = Math.exp(-mean);
  let k = 0;
  let p = rand();
  while (p > limit) {
    k++;
    p *= rand();
  }
  return k;
};

/** Gamma(shape k, scale 1/k): mean 1, the spread of k grains' worth of reflections. */
const gamma1 = (k, rand) => {
  if (k < 1) return gamma1(k + 1, rand) * rand() ** (1 / k);
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const x = normal(rand);
    const v = (1 + c * x) ** 3;
    if (v <= 0) continue;
    const u = rand();
    if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return (d * v) / k;
  }
};

/**
 * Grain statistics along a ring: how bright each 0.5° of azimuth is, as a factor with mean 1,
 * from `grains` crystallites' worth of reflections there.
 */
const speckle = (seed, id, grains) => {
  const bins = new Float32Array(361);
  const rand = rng(hash(seed, id, 7));
  for (let i = 0; i < bins.length; i++) bins[i] = gamma1(Math.max(0.3, grains), rand);
  return (psi) => {
    const f = (psi + 90) / 0.5;
    const i = Math.max(0, Math.min(359, Math.floor(f)));
    const t = Math.max(0, Math.min(1, f - i));
    return bins[i] * (1 - t) + bins[i + 1] * t;
  };
};

// ---- Vectors and texture --------------------------------------------------------------------

const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const norm = (u) => {
  const l = Math.hypot(u[0], u[1], u[2]);
  return [u[0] / l, u[1] / l, u[2] / l];
};
const cross = (u, v) => [
  u[1] * v[2] - u[2] * v[1],
  u[2] * v[0] - u[0] * v[2],
  u[0] * v[1] - u[1] * v[0],
];
const angle = (u, v) => Math.acos(Math.max(-1, Math.min(1, dot(u, v))));

/** ∫ exp(−(α − β)² / 2σ²) dΩ over the sphere, for a ring of poles β from an axis. */
const ringNorm = (beta, sigma) => {
  let s = 0;
  const n = 2000;
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * Math.PI;
    s += Math.exp(-((a - beta) ** 2) / (2 * sigma * sigma)) * Math.sin(a);
  }
  return 2 * Math.PI * s * (Math.PI / n);
};

/** Every member of a cubic family {h k l}, both signs, as unit vectors. */
const cubicFamily = ([h, k, l]) => {
  const out = new Map();
  const perms = [
    [h, k, l],
    [h, l, k],
    [k, h, l],
    [k, l, h],
    [l, h, k],
    [l, k, h],
  ];
  for (const p of perms)
    for (const sx of [1, -1])
      for (const sy of [1, -1])
        for (const sz of [1, -1]) {
          const v = [p[0] * sx, p[1] * sy, p[2] * sz];
          out.set(v.join(","), norm(v));
        }
  return [...out.values()];
};

/** A texture component {hkl}<uvw>: rows are RD, TD and ND in crystal axes. */
const component = (plane, dir) => {
  const nd = norm(plane);
  const rd = norm(dir);
  return [rd, cross(nd, rd), nd];
};

/**
 * Pole density of a cubic family along the slice (RD and the normal) at tilt ψ, for a texture
 * of Gaussian components plus a random share; 1 everywhere for a random powder. Rolled sheet
 * has orthorhombic symmetry, so each component is mirrored across RD and TD.
 */
const poleTable = (hkl, texture) => {
  const members = cubicFamily(hkl);
  const mirrors = [
    [1, 1, 1],
    [-1, 1, 1],
    [1, -1, 1],
    [-1, -1, 1],
  ];
  const poles = texture.components.map((c) => {
    const m = component(c.plane, c.dir);
    const z = ringNorm(0, c.spread * DEG);
    const list = [];
    for (const g of members) {
      const v = [dot(m[0], g), dot(m[1], g), dot(m[2], g)];
      for (const f of mirrors) list.push([v[0] * f[0], v[1] * f[1], v[2] * f[2]]);
    }
    return { w: c.weight, sigma: c.spread * DEG, z, list };
  });
  const table = new Float32Array(721);
  for (let i = 0; i < table.length; i++) {
    const psi = (i * 0.25 - 90) * DEG;
    const s = [Math.sin(psi), 0, Math.cos(psi)];
    let p = texture.random;
    for (const c of poles) {
      let sum = 0;
      for (const u of c.list) {
        const a = angle(s, u);
        if (a < 5 * c.sigma) sum += Math.exp(-(a * a) / (2 * c.sigma * c.sigma));
      }
      p += (c.w * 4 * Math.PI * sum) / (c.z * c.list.length);
    }
    table[i] = p;
  }
  return (psiDeg) => {
    const f = (psiDeg + 90) / 0.25;
    const i = Math.max(0, Math.min(719, Math.floor(f)));
    const t = Math.max(0, Math.min(1, f - i));
    return table[i] * (1 - t) + table[i + 1] * t;
  };
};

// ---- Reflections ----------------------------------------------------------------------------

const f2 = (crystal, h, k, l) => {
  const F = structureFactor(crystal, h, k, l);
  return F.re * F.re + F.im * F.im;
};

/** Every reflection out to the map's edge (and a little past, for Kα2), with |F|². */
const reflections = (crystal) => {
  const sMax = S_MAX * 1.01;
  const { a, b, c } = crystal.cell;
  const hMax = Math.ceil(sMax * a) + 1;
  const kMax = Math.ceil(sMax * b) + 1;
  const lMax = Math.ceil(sMax * c) + 1;
  const out = [];
  let top = 0;
  for (let h = -hMax; h <= hMax; h++)
    for (let k = -kMax; k <= kMax; k++)
      for (let l = -lMax; l <= lMax; l++) {
        if (h === 0 && k === 0 && l === 0) continue;
        const g = gVector(crystal.cell, h, k, l);
        const S = Math.hypot(g[0], g[1], g[2]);
        if (S > sMax) continue;
        const F2 = f2(crystal, h, k, l);
        top = Math.max(top, F2);
        out.push({ hkl: [h, k, l], g, S, F2 });
      }
  return out.filter((r) => r.F2 > top * 1e-4);
};

/** Reflections grouped by spacing: a powder's rings, with multiplicity folded into weight. */
const rings = (crystal) => {
  const groups = new Map();
  for (const r of reflections(crystal)) {
    const key = r.S.toFixed(5);
    const g = groups.get(key);
    if (g) g.weight += r.F2;
    else groups.set(key, { S: r.S, weight: r.F2, hkl: r.hkl });
  }
  return [...groups.values()];
};

// ---- The map --------------------------------------------------------------------------------

/**
 * A blank map: its extent in S, the pixel centres, and which pixels the scan reached. `psiMax`
 * is the largest sideways tilt toward +Sx the scan made, degrees.
 */
const blankMap = ({ xMin, xMax, twoThetaMin, psiMax = 90 }) => {
  const yMin = -STEP / 2;
  const yMax = 1.22125;
  const width = Math.round((xMax - xMin) / STEP);
  const height = Math.round((yMax - yMin) / STEP);
  const sMin = sOf(twoThetaMin);
  const measured = new Uint8Array(width * height);
  for (let j = 0; j < height; j++) {
    const sz = yMax - (j + 0.5) * STEP;
    for (let i = 0; i < width; i++) {
      const sx = xMin + (i + 0.5) * STEP;
      const S = Math.hypot(sx, sz);
      const psi = Math.atan2(sx, sz) / DEG;
      measured[j * width + i] = S >= sMin && S <= S_MAX && sz >= SZ_MIN && psi <= psiMax ? 1 : 0;
    }
  }
  return {
    xMin,
    xMax,
    yMin,
    yMax,
    width,
    height,
    twoThetaMin,
    measured,
    mu: new Float64Array(width * height),
  };
};

const SUB = 3;

/** Run `fn(S, psi)` at sub × sub points in each pixel with data; add the mean to `mu`. */
const fillPixels = (map, fn, sub = SUB) => {
  const { width, height, xMin, yMax, measured, mu } = map;
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const p = j * width + i;
      if (!measured[p]) continue;
      let sum = 0;
      for (let v = 0; v < sub; v++) {
        const sz = yMax - (j + (v + 0.5) / sub) * STEP;
        for (let u = 0; u < sub; u++) {
          const sx = xMin + (i + (u + 0.5) / sub) * STEP;
          sum += fn(Math.hypot(sx, sz), Math.atan2(sx, sz) / DEG);
        }
      }
      mu[p] += sum / (sub * sub);
    }
  }
};

/**
 * Powder-style rings: each ring at each tube line, as a pseudo-Voigt in 2θ times the powder
 * Lorentz-polarisation factor, its pole density along the slice and its grain statistics.
 */
const paintRings = (map, list, profile) => {
  const peaks = [];
  for (const r of list) {
    for (const line of LINES) {
      const tt = twoThetaOf(r.S, line.lambda);
      if (Number.isNaN(tt) || tt > TWO_THETA_MAX + 3) continue;
      const f = fwhm(tt, profile);
      peaks.push({
        tt,
        f,
        amp: line.w * r.weight * powderLP(tt),
        pole: r.pole,
        grain: r.grain,
        alpha: r.alpha,
      });
    }
  }
  peaks.sort((a, b) => a.tt - b.tt);
  const TAIL = 6;
  const reach = Math.max(...peaks.map((p) => p.f)) * TAIL;
  const ttList = Float64Array.from(peaks, (p) => p.tt);
  const first = (t) => {
    let lo = 0;
    let hi = ttList.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (ttList[m] < t) lo = m + 1;
      else hi = m;
    }
    return lo;
  };
  // The peaks near each pixel are found once, then summed at SUB × SUB points inside it.
  const { width, height, xMin, yMax, measured, mu } = map;
  const half = STEP * Math.SQRT1_2;
  const near = [];
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const p = j * width + i;
      if (!measured[p]) continue;
      const cx = xMin + (i + 0.5) * STEP;
      const cz = yMax - (j + 0.5) * STEP;
      const S = Math.hypot(cx, cz);
      const tt = twoThetaOf(S);
      const psi = Math.abs(Math.atan2(cx, cz) / DEG);
      const dtt = (half * LAMBDA) / Math.cos((tt / 2) * DEG) / DEG;
      const dpsi = half / S / DEG;
      near.length = 0;
      for (
        let k = first(tt - reach - dtt);
        k < peaks.length && ttList[k] <= tt + reach + dtt;
        k++
      ) {
        const q = peaks[k];
        if (Math.abs(tt - q.tt) > q.f * TAIL + dtt) continue;
        if (q.alpha && Math.abs(psi - q.alpha.at) > q.alpha.reach + dpsi) continue;
        near.push(q);
      }
      if (near.length === 0) continue;
      let sum = 0;
      for (let v = 0; v < SUB; v++) {
        const sz = yMax - (j + (v + 0.5) / SUB) * STEP;
        for (let u = 0; u < SUB; u++) {
          const sx = xMin + (i + (u + 0.5) / SUB) * STEP;
          const t = twoThetaOf(Math.hypot(sx, sz));
          const a = Math.atan2(sx, sz) / DEG;
          for (const q of near) {
            let w = q.amp * pseudoVoigt(t - q.tt, q.f, profile.eta);
            if (q.pole) w *= q.pole(a);
            if (q.grain) w *= q.grain(a);
            sum += w;
          }
        }
      }
      mu[p] += sum / (SUB * SUB);
    }
  }
};

/** A smooth background: air scatter round the beam, and the sample's own diffuse scatter. */
const paintBackground = (map, { air, flat, rise }) => {
  fillPixels(
    map,
    (S) => {
      const tt = twoThetaOf(S);
      return (
        air * (Math.exp(-tt / 6) + 0.12 * Math.exp(-tt / 30)) +
        flat +
        rise * (1 - Math.exp(-(S * S) / 0.3))
      );
    },
    1,
  );
};

/** Add a 2D Gaussian blob of `amount` counts, radial and tangential widths in Å⁻¹. */
const blob = (map, cx, cz, sr, st, amount, dir) => {
  const { width, height, xMin, yMax, mu, measured } = map;
  const [rx, rz] = dir;
  const reach = 4 * Math.max(sr, st);
  const i0 = Math.max(0, Math.floor((cx - reach - xMin) / STEP));
  const i1 = Math.min(width - 1, Math.ceil((cx + reach - xMin) / STEP));
  const j0 = Math.max(0, Math.floor((yMax - cz - reach) / STEP));
  const j1 = Math.min(height - 1, Math.ceil((yMax - cz + reach) / STEP));
  const k = (amount * STEP * STEP) / (2 * Math.PI * sr * st * SUB * SUB);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const p = j * width + i;
      if (!measured[p]) continue;
      let sum = 0;
      for (let v = 0; v < SUB; v++) {
        const dz = yMax - (j + (v + 0.5) / SUB) * STEP - cz;
        for (let u = 0; u < SUB; u++) {
          const dx = xMin + (i + (u + 0.5) / SUB) * STEP - cx;
          const r = dx * rx + dz * rz;
          const t = -dx * rz + dz * rx;
          sum += Math.exp(-(r * r) / (2 * sr * sr) - (t * t) / (2 * st * st));
        }
      }
      mu[p] += k * sum;
    }
  }
};

/** Add `fn(dx, dz)` counts per pixel over a box round (cx, cz). */
const field = (map, cx, cz, rx, rz, fn) => {
  const { width, height, xMin, yMax, mu, measured } = map;
  const i0 = Math.max(0, Math.floor((cx - rx - xMin) / STEP));
  const i1 = Math.min(width - 1, Math.ceil((cx + rx - xMin) / STEP));
  const j0 = Math.max(0, Math.floor((yMax - cz - rz) / STEP));
  const j1 = Math.min(height - 1, Math.ceil((yMax - cz + rz) / STEP));
  for (let j = j0; j <= j1; j++) {
    const dz = yMax - (j + 0.5) * STEP - cz;
    for (let i = i0; i <= i1; i++) {
      const p = j * width + i;
      if (measured[p]) mu[p] += fn(xMin + (i + 0.5) * STEP - cx, dz);
    }
  }
};

/**
 * One crystal's spots: every reflection lying in the slice. Each spot is its Kα1, Kα2 and Kβ
 * images along the line to the beam's centre, the tube's continuous spectrum smeared along the
 * same line (filtered by the nickel's K edge), a soft thermal diffuse halo and, for a polished
 * wafer, a truncation rod along the surface normal.
 */
const paintSpots = (map, crystal, frame, o) => {
  const spots = [];
  for (const r of reflections(crystal)) {
    const sx = dot(r.g, frame.x);
    const sz = dot(r.g, frame.z);
    const off = dot(r.g, frame.y);
    if (Math.abs(off) > 1e-6 || sz < SZ_MIN * 0.5) continue;
    const tt = twoThetaOf(r.S);
    if (Number.isNaN(tt)) continue;
    const amount = (r.F2 * polarisation(tt)) / Math.sin(tt * DEG);
    spots.push({ hkl: r.hkl, sx, sz, S: r.S, tt, amount });
  }
  const top = Math.max(...spots.map((s) => s.amount));
  for (const s of spots) {
    const a = (o.peak * s.amount) / top;
    const dir = [s.sx / s.S, s.sz / s.S];
    const theta = (s.tt / 2) * DEG;
    const st = Math.max(STEP * 0.5, s.S * o.mosaic * DEG);
    for (const line of LINES) {
      const S = (s.S * line.lambda) / LAMBDA;
      const tt = twoThetaOf(s.S, line.lambda);
      if (Number.isNaN(tt)) continue;
      const sr = (Math.cos((tt / 2) * DEG) * o.width * DEG) / LAMBDA;
      blob(map, dir[0] * S, dir[1] * S, sr, st, a * line.w, dir);
    }
    // The continuum: wavelength λ reflects where |S| reads S λ / λ₁ on the map.
    const ref = kramers(LAMBDA) * transmit(LAMBDA) * LAMBDA ** 3;
    const dS = STEP * 0.4;
    for (let S = s.S * (LAMBDA_MIN / LAMBDA); S <= S_MAX; S += dS) {
      const l = (S / s.S) * LAMBDA;
      const tt = twoThetaOf(s.S, l);
      if (Number.isNaN(tt)) break;
      const w =
        ((CONTINUUM * kramers(l) * transmit(l) * l ** 3) / ref) *
        (polarisation(tt) / Math.sin(tt * DEG) / (polarisation(s.tt) / Math.sin(s.tt * DEG)));
      const dl = (dS / s.S) * LAMBDA;
      const sr = (Math.cos((tt / 2) * DEG) * o.width * DEG) / LAMBDA;
      blob(map, dir[0] * S, dir[1] * S, sr, st, a * w * dl, dir);
    }
    const peak =
      (a * STEP * STEP) / (2 * Math.PI * ((Math.cos(theta) * o.width * DEG) / LAMBDA) * st);
    if (o.halo) {
      const k2 = (o.halo.width * o.halo.width) / 4;
      field(map, s.sx, s.sz, o.halo.reach, o.halo.reach, (dx, dz) => {
        const d2 = dx * dx + dz * dz;
        return d2 > o.halo.reach * o.halo.reach ? 0 : (peak * o.halo.level * k2) / (d2 + k2);
      });
    }
    if (o.rod) {
      const w2 = o.rod.core * o.rod.core;
      field(map, s.sx, s.sz, 4 * st, o.rod.reach, (dx, dz) => {
        if (Math.abs(dz) < o.rod.core) return 0;
        return (peak * o.rod.level * w2 * Math.exp(-(dx * dx) / (2 * st * st))) / (dz * dz);
      });
    }
  }
  return spots;
};

// ---- The maps -------------------------------------------------------------------------------

const POWDER = { U: 0.05, V: -0.02, W: 0.2, eta: 0.4 };

const MAPS = {
  "corundum-rings": {
    seed: 11,
    material: "corundum",
    form: "powder",
    pattern: "rings",
    about:
      "corundum (α-Al₂O₃) ground to a fine powder: crystallites face every way in equal numbers, so every ring is smooth and even",
    extent: { xMin: -1.22125, xMax: 1.22125, twoThetaMin: 5 },
    clip: 99.95,
    level: 7,
    cells: 16,
    build(map) {
      paintRings(
        map,
        rings(CRYSTALS.corundum).map((r, i) => ({ ...r, grain: speckle(this.seed, i, 1500) })),
        POWDER,
      );
      return { background: { air: 0.5, flat: 0.006, rise: 0.01 } };
    },
  },
  "foil-arcs": {
    seed: 23,
    material: "aluminium",
    form: "rolled foil",
    pattern: "arcs",
    about:
      "annealed aluminium foil, whose grains keep the textures of rolling and recrystallising: cube {0 0 1}<1 0 0>, copper {1 1 2}<1 1 −1>, S {1 2 3}<6 3 −4>, brass {0 1 1}<2 1 −1> and Goss {0 1 1}<1 0 0>, each spread by 6° to 7°, plus 4 % random grains; the slice runs along the rolling direction, so each ring breaks into arcs where its poles crowd",
    extent: { xMin: -1.22125, xMax: 1.22125, twoThetaMin: 5 },
    clip: 99.95,
    level: 9,
    cells: 10,
    build(map) {
      const texture = {
        random: 0.04,
        components: [
          { plane: [0, 0, 1], dir: [1, 0, 0], weight: 0.42, spread: 6 },
          { plane: [1, 1, 2], dir: [1, 1, -1], weight: 0.16, spread: 7 },
          { plane: [1, 2, 3], dir: [6, 3, -4], weight: 0.22, spread: 7 },
          { plane: [0, 1, 1], dir: [2, 1, -1], weight: 0.11, spread: 7 },
          { plane: [0, 1, 1], dir: [1, 0, 0], weight: 0.05, spread: 7 },
        ],
      };
      // Each family on its own (3 3 3 and 5 1 1 share a ring but not their poles).
      const families = new Map();
      for (const r of reflections(CRYSTALS.aluminium)) {
        const key = r.hkl
          .map(Math.abs)
          .sort((x, y) => y - x)
          .join(",");
        const f = families.get(key);
        if (f) f.weight += r.F2;
        else families.set(key, { S: r.S, weight: r.F2, hkl: key.split(",").map(Number) });
      }
      const list = [...families.values()].map((f, i) => {
        const pole = poleTable(f.hkl, texture);
        // Grains of tens of µm: the arcs are grainy, smoother where many grains crowd.
        const grain = speckle(this.seed, i, 1);
        const grains = (psi) => {
          const n = 20 * pole(psi);
          return 1 + (grain(psi) - 1) / Math.sqrt(Math.max(1, n));
        };
        return { ...f, pole, grain: grains };
      });
      paintRings(map, list, { ...POWDER, W: 0.17 });
      return { background: { air: 0.5, flat: 0.004, rise: 0.008 } };
    },
  },
  "zircon-spots": {
    seed: 53,
    material: "zircon",
    form: "single crystal",
    pattern: "spots",
    about:
      "a zircon (ZrSiO₄) prism lying on a (1 0 0) face with its c axis along the tilt, so the slice holds the (h 0 l) spots; a natural crystal's mosaic spreads each spot a little round its circle",
    extent: { xMin: -1.22125, xMax: 0.22125, twoThetaMin: 10, psiMax: 25 },
    clip: 99.9,
    level: 40,
    cells: 5,
    build(map) {
      const frame = { x: [0, 0, 1], y: [0, -1, 0], z: [1, 0, 0] };
      const spots = paintSpots(map, CRYSTALS.zircon, frame, {
        peak: 9000,
        width: 0.45,
        mosaic: 0.7,
        halo: { level: 0.003, width: 0.012, reach: 0.06 },
        rod: null,
      });
      return { background: { air: 0.15, flat: 0.004, rise: 0.006 }, spots };
    },
  },
};

// ---- Counting, scaling and files ------------------------------------------------------------

const percentile = (values, q) => {
  const sorted = Float64Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor((q / 100) * sorted.length))];
};

/**
 * Scale the model so its `clip` percentile reads `level` counts, add the background, then
 * count: each pixel averages about `cells` detector cells' worth of photons, more near the
 * middle where the slice crowds more of the detector into each pixel.
 */
const count = (map, spec, background) => {
  const { width, height, xMin, yMax, measured, mu } = map;
  const inside = [];
  for (let p = 0; p < mu.length; p++) if (measured[p]) inside.push(mu[p]);
  const scale = spec.level / Math.max(1e-12, percentile(inside, spec.clip));
  for (let p = 0; p < mu.length; p++) mu[p] *= scale;
  paintBackground(map, {
    air: background.air * spec.level,
    flat: background.flat * spec.level,
    rise: background.rise * spec.level,
  });
  const rand = rng(hash(spec.seed, 99));
  const counts = new Float64Array(mu.length);
  for (let j = 0; j < height; j++) {
    const sz = yMax - (j + 0.5) * STEP;
    for (let i = 0; i < width; i++) {
      const p = j * width + i;
      if (!measured[p]) continue;
      const S = Math.hypot(xMin + (i + 0.5) * STEP, sz);
      const theta = (twoThetaOf(S) / 2) * DEG;
      const n = (spec.cells * Math.min(3, Math.max(0.5, 0.5 / S))) / Math.cos(theta);
      counts[p] = poisson(mu[p] * n, rand) / n;
    }
  }
  return counts;
};

const encode = (map, counts, clipPercentile) => {
  const values = [];
  for (let p = 0; p < counts.length; p++) if (map.measured[p]) values.push(counts[p]);
  const clip = percentile(values, clipPercentile);
  const px = new Uint8Array(counts.length);
  const top = Math.sqrt(clip);
  for (let p = 0; p < counts.length; p++) {
    if (!map.measured[p]) continue;
    px[p] = Math.min(255, 1 + Math.round((Math.sqrt(counts[p]) / top) * 254));
  }
  return { px, clip };
};

const radialProfile = (map, counts) => {
  const bins = 400;
  const binWidth = S_MAX / bins;
  const sum = new Float64Array(bins);
  const n = new Uint32Array(bins);
  for (let j = 0; j < map.height; j++) {
    const sz = map.yMax - (j + 0.5) * STEP;
    for (let i = 0; i < map.width; i++) {
      const p = j * map.width + i;
      if (!map.measured[p]) continue;
      const b = Math.floor(Math.hypot(map.xMin + (i + 0.5) * STEP, sz) / binWidth);
      if (b < 0 || b >= bins) continue;
      sum[b] += counts[p];
      n[b]++;
    }
  }
  let top = 0;
  let at = 0;
  for (let b = 0; b < bins; b++)
    if (n[b] && sum[b] / n[b] > top) {
      top = sum[b] / n[b];
      at = b;
    }
  return {
    x: "bin i covers |S| from i * binWidth to (i + 1) * binWidth, 1/angstrom",
    sMin: 0,
    sMax: round(S_MAX, 4),
    bins,
    binWidth: round(binWidth, 7),
    peakAt: round((at + 0.5) * binWidth, 4),
    method:
      "mean simulated counts of the pixels with data in each |S| bin, normalised to 1 at the peak; null where no pixel has data",
    values: Array.from(sum, (s, b) => (n[b] ? round(s / n[b] / top, 4) : null)),
  };
};

const round = (v, d) => Number(v.toFixed(d));

// PNG: 8-bit grey, IHDR, IDAT and IEND only, each row with whichever filter packs smallest.
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};
const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};
const pngGrey = (width, height, px) => {
  const raw = Buffer.alloc(height * (width + 1));
  const row = new Uint8Array(width);
  for (let y = 0; y < height; y++) {
    let best = null;
    let bestScore = Infinity;
    for (let f = 0; f <= 4; f++) {
      let score = 0;
      for (let x = 0; x < width; x++) {
        const v = px[y * width + x];
        const a = x > 0 ? px[y * width + x - 1] : 0;
        const b = y > 0 ? px[(y - 1) * width + x] : 0;
        const c = x > 0 && y > 0 ? px[(y - 1) * width + x - 1] : 0;
        const pred =
          f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
        row[x] = (v - pred) & 255;
        score += row[x] < 128 ? row[x] : 256 - row[x];
      }
      if (score < bestScore) {
        bestScore = score;
        best = { f, bytes: Uint8Array.from(row) };
      }
    }
    raw[y * (width + 1)] = best.f;
    raw.set(best.bytes, y * (width + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

/** JSON laid out as the formatter lays it out: objects open, short arrays on one line. */
const toJson = (value, indent = "", key = "") => {
  const pad = `${indent}  `;
  if (Array.isArray(value)) {
    const items = value.map((v) => JSON.stringify(v));
    const line = `[${items.join(", ")}]`;
    if (
      indent.length + key.length + line.length + 1 <= 100 &&
      value.every((v) => typeof v !== "object" || v === null)
    )
      return line;
    return `[\n${value.map((v) => pad + toJson(v, pad)).join(",\n")}\n${indent}]`;
  }
  if (value && typeof value === "object") {
    const rows = Object.entries(value).map(([k, v]) => {
      const head = `${JSON.stringify(k)}: `;
      return pad + head + toJson(v, pad, head);
    });
    return `{\n${rows.join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
};

// ---- Run ------------------------------------------------------------------------------------

const out = args.out ?? DATA;
mkdirSync(out, { recursive: true });
const only = args.only ? new Set(args.only.split(",")) : null;

for (const [name, spec] of Object.entries(MAPS)) {
  if (only && !only.has(name)) continue;
  const started = Date.now();
  const map = blankMap(spec.extent);
  const { background } = spec.build(map);
  const counts = count(map, spec, background);
  const { px, clip } = encode(map, counts, spec.clip);
  const png = pngGrey(map.width, map.height, px);
  let empty = 0;
  for (const m of map.measured) if (!m) empty++;
  const meta = {
    image: `${name}.png`,
    width: map.width,
    height: map.height,
    material: spec.material,
    form: spec.form,
    pattern: spec.pattern,
    simulated: true,
    source:
      "simulated by scripts/xrd-maps.mjs from the crystal's cell and atoms; no part of it was measured",
    model: spec.about,
    wavelengthA: LAMBDA,
    radiation:
      "copper K-alpha1, with K-alpha2 at half strength and a trace of K-beta through a nickel filter",
    units: "1/angstrom in S: |S| = 1/d = 2 sin(theta) / wavelength; Q = 2 pi S",
    scanTwoThetaDeg: [spec.extent.twoThetaMin, TWO_THETA_MAX],
    pixelStep: STEP,
    axes: {
      x: {
        name: "Sx",
        meaning: "in-plane, along the tilt",
        min: map.xMin,
        max: map.xMax,
        direction: "increases to the right",
      },
      y: {
        name: "Sz",
        meaning: "out-of-plane, along the surface normal",
        min: map.yMin,
        max: map.yMax,
        direction: "increases upwards; row 0 is the top at max",
      },
      extents:
        "outer edges of the edge pixels; column i is centred at x.min + (i + 0.5) * pixelStep, row j at y.max - (j + 0.5) * pixelStep",
    },
    scale: {
      type: "sqrt",
      clipPercentile: spec.clip,
      clipCounts: round(clip, 3),
      encoding:
        "0 means no data; v from 1 to 255 means sqrt(counts) = (v - 1) / 254 * sqrt(clipCounts), clipped at 255",
      counts: "mean simulated counts per detector cell, averaged into each pixel",
    },
    empty: {
      value: 0,
      fraction: round(empty / map.measured.length, 3),
      rule: `a pixel has data when its centre is inside the scan's reach: 2θ from ${spec.extent.twoThetaMin}° to ${TWO_THETA_MAX}° and both beams at least ${HORIZON}° above the surface`,
    },
    profile: radialProfile(map, counts),
  };
  writeFileSync(join(out, `${name}.png`), png);
  writeFileSync(join(out, `${name}.json`), `${toJson(meta)}\n`);
  const kb = (statSync(join(out, `${name}.png`)).size / 1024).toFixed(0);
  console.log(
    `${name}: ${map.width} x ${map.height}, ${kb} KB, clip ${clip.toFixed(2)}, empty ${meta.empty.fraction}, peak at ${meta.profile.peakAt}, ${((Date.now() - started) / 1000).toFixed(1)} s`,
  );
}
