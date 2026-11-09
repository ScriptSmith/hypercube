/**
 * The mound's mesh for one scene: the snowy top with the scene's hills, the rocky flank, and the
 * base against the glass at the bottom. Coloured per vertex: snow on the top and on ledges,
 * stone on the flank.
 */
import { BufferGeometry, Color, Float32BufferAttribute } from "three";
import { DEN_ANGLE } from "./den";
import { fbm3, noise3 } from "./noise";
import {
  FOOT_Y,
  flankRho,
  glassRho,
  groundY,
  type Hills,
  R,
  RIM_RHO,
  RIM_Y,
  smoothstep,
} from "./mound";

const AROUND = 160;
const TOP_RINGS = 26;
const FLANK_RINGS = 16;
const BASE_RINGS = 8;

export interface GroundLook {
  snow: string;
  /** Snow in hollows and on the shadowed flank. */
  shade: string;
  rock: string;
  /** Optional colour for part of the top, such as ice, by position. */
  paint?: (x: number, z: number) => string | null;
  /** Ground steeper than this (rise over run) shows rock through the snow. */
  rocky?: number;
}

const DEFAULT_LOOK: GroundLook = { snow: "#f2f5fa", shade: "#d3dcea", rock: "#6d6762" };

export const moundGeometry = (hills: Hills, look: Partial<GroundLook> = {}): BufferGeometry => {
  const l = { ...DEFAULT_LOOK, ...look };
  const snow = new Color(l.snow);
  const shade = new Color(l.shade);
  const rock = new Color(l.rock);
  const dark = rock.clone().multiplyScalar(0.62);
  const rings: { x: number; y: number; z: number; c: Color }[][] = [];
  const tmp = new Color();

  for (let k = 0; k <= TOP_RINGS; k++) {
    const rho = RIM_RHO * Math.pow(k / TOP_RINGS, 0.85);
    const row: (typeof rings)[number] = [];
    for (let a = 0; a < AROUND; a++) {
      const th = (a / AROUND) * Math.PI * 2;
      const x = rho * Math.sin(th);
      const z = rho * Math.cos(th);
      // Soft drifts in the snow, fading out at the rim so it meets the flank.
      const drift = 0.025 * fbm3(x * 2.2, 0.5, z * 2.2) * smoothstep(RIM_RHO, RIM_RHO - 0.2, rho);
      const y = groundY(hills, x, z) + drift;
      const painted = l.paint?.(x, z);
      const c = painted
        ? new Color(painted)
        : tmp
            .copy(snow)
            .lerp(shade, 0.25 + 0.25 * noise3(x * 3, 1.3, z * 3))
            .clone();
      const e = 0.02;
      const steep =
        Math.hypot(
          groundY(hills, x + e, z) - groundY(hills, x - e, z),
          groundY(hills, x, z + e) - groundY(hills, x, z - e),
        ) /
        (2 * e);
      const bare = smoothstep(l.rocky ?? 0.85, (l.rocky ?? 0.85) + 0.5, steep);
      if (bare > 0) {
        const patch = smoothstep(-0.2, 0.3, noise3(x * 9, y * 9, z * 9));
        c.lerp(tmp.copy(rock).lerp(dark, 0.4 * patch), bare * (0.45 + 0.55 * patch));
      }
      row.push({ x, y, z, c });
    }
    rings.push(row);
  }
  for (let j = 1; j <= FLANK_RINGS; j++) {
    const s = j / FLANK_RINGS;
    const y = RIM_Y + (FOOT_Y - RIM_Y) * s;
    const row: (typeof rings)[number] = [];
    for (let a = 0; a < AROUND; a++) {
      const th = (a / AROUND) * Math.PI * 2;
      // Craggy, but meeting the glass cleanly at the foot.
      const crag = Math.sin(Math.PI * Math.min(1, s * 1.15)) * 0.13;
      const n = fbm3(Math.sin(th) * 3, y * 4, Math.cos(th) * 3);
      const rho = Math.min(flankRho(y) + crag * n, glassRho(y) - 0.008);
      const x = rho * Math.sin(th);
      const z = rho * Math.cos(th);
      const ledge = smoothstep(0.1, 0.45, noise3(Math.sin(th) * 5, y * 7, Math.cos(th) * 5));
      const c = tmp
        .copy(rock)
        .lerp(dark, 0.5 + 0.5 * n)
        .lerp(shade, ledge * (1 - s) * 0.8)
        .clone();
      row.push({ x, y, z, c });
    }
    rings.push(row);
  }
  // The base lies against the glass below the foot, round the mouth of the den.
  const footLat = Math.asin(FOOT_Y / R);
  const mouthLat = -Math.PI / 2 + DEN_ANGLE;
  for (let j = 1; j <= BASE_RINGS; j++) {
    const lat = footLat + ((mouthLat - footLat) * j) / BASE_RINGS;
    const rr = (R - 0.004) * Math.cos(lat);
    const y = (R - 0.004) * Math.sin(lat);
    const row: (typeof rings)[number] = [];
    for (let a = 0; a < AROUND; a++) {
      const th = (a / AROUND) * Math.PI * 2;
      row.push({ x: rr * Math.sin(th), y, z: rr * Math.cos(th), c: dark.clone() });
    }
    rings.push(row);
  }

  const positions: number[] = [];
  const colors: number[] = [];
  for (const row of rings) {
    for (const p of row) {
      positions.push(p.x, p.y, p.z);
      colors.push(p.c.r, p.c.g, p.c.b);
    }
  }
  const index: number[] = [];
  for (let k = 0; k < rings.length - 1; k++) {
    for (let a = 0; a < AROUND; a++) {
      const a1 = (a + 1) % AROUND;
      const p00 = k * AROUND + a;
      const p01 = k * AROUND + a1;
      const p10 = (k + 1) * AROUND + a;
      const p11 = (k + 1) * AROUND + a1;
      // Outward-facing: going round with increasing angle, then outward.
      index.push(p00, p10, p01, p01, p10, p11);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(positions, 3));
  g.setAttribute("color", new Float32BufferAttribute(colors, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
};
