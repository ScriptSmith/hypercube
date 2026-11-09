/**
 * The screen above a bank: light leaving each touch frame's top edge enters along the screen's
 * bottom edge (the screen spans the bank exactly, at the same scale across and up, so angles carry
 * over). Each frame's solved puzzle sends one beam up; the screen hangs one big crystal on it,
 * either straight up or after a fixed mirror turns it aside, and makes sure no frame's beam
 * lights another frame's crystal.
 */
import { VENUE_SIZE } from "../../core/frame";
import { createRng } from "../../core/rng";
import { bankFraction } from "../../core/layout";
import { STEP, normDetent } from "./pieces";
import { NEED, type Crystal, type Puzzle } from "./puzzle";
import { type Scene, type Source, type Surface, MAT_MIRROR, segment, trace } from "./trace";

export interface SkyMirror {
  x: number;
  y: number;
  turn: number;
  half: number;
}

export interface SkyScene {
  W: number;
  H: number;
  crystals: Crystal[];
  /** The frame each crystal belongs to. */
  owners: number[];
  mirrors: SkyMirror[];
  /** Each frame's intended light into the screen, in screen px. */
  intended: Source[][];
}

/** Screen px, at the venue's default screen size. */
export const SKY_CRYSTAL = 110;
export const SKY_MIRROR = 170;

export const mirrorSurfaces = (mirrors: readonly SkyMirror[], body0 = 0): Surface[] =>
  mirrors.map((m, i) => {
    const a = m.turn * STEP;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return segment(
      m.x - c * m.half,
      m.y - s * m.half,
      m.x + c * m.half,
      m.y + s * m.half,
      MAT_MIRROR,
      {
        body: body0 + i,
      },
    );
  });

export const skySceneOf = (sky: SkyScene): Scene => ({
  surfaces: mirrorSurfaces(sky.mirrors),
  crystals: sky.crystals,
  box: { x: 0, y: 0, width: sky.W, height: sky.H },
  bodies: sky.mirrors.length,
});

/** A frame's light leaving its top edge, as it enters the screen. */
export const toScreen = (
  b: { x: number; dx: number; dy: number; bits: number; level: number },
  pos: number,
  frameW: number,
  count: number,
  W: number,
  H: number,
  guide: boolean,
): Source => ({
  x: bankFraction(pos, b.x / frameW, count) * W,
  y: H - 0.5,
  dx: b.dx,
  dy: b.dy,
  bits: b.bits,
  level: b.level,
  guide,
  hops: 0,
});

/** A screen's size against the default screen's, which the sky's sizes are drawn for. */
export const screenScale = (W: number, H: number): number =>
  Math.min(W / VENUE_SIZE.screen.width, H / VENUE_SIZE.screen.height);

export const buildSky = (
  chain: readonly Puzzle[],
  frameW: number,
  count: number,
  size: { width: number; height: number },
  seed: string,
): SkyScene => {
  const W = size.width;
  const H = size.height;
  const k = screenScale(W, H);
  // Smaller crystals over a long bank of narrow frames, so neighbours' crystals fit.
  const r = Math.min(SKY_CRYSTAL * k, (W / Math.max(1, count)) * 0.22);
  const half = SKY_MIRROR * k;
  const rng = createRng(seed);
  const intended = chain.map((p, pos) =>
    p.sky.slice(0, 1).map((b) => toScreen(b, pos, frameW, count, W, H, true)),
  );
  const sky: SkyScene = { W, H, crystals: [], owners: [], mirrors: [], intended };

  let spacing = 3.2;
  const clear = (x: number, y: number, rad: number) =>
    x > rad * 1.05 &&
    x < W - rad * 1.05 &&
    y > rad * 1.2 &&
    y < H - rad * 2 &&
    sky.crystals.every((c) => Math.hypot(c.x - x, c.y - y) > spacing * r) &&
    sky.mirrors.every((m) => Math.hypot(m.x - x, m.y - y) > half + rad * 1.5);

  /** Crystal i is lit by its own frame's beam and by no other frame's. */
  const fair = () => {
    const scene = skySceneOf(sky);
    for (let pos = 0; pos < intended.length; pos++) {
      const src = intended[pos]!;
      if (src.length === 0) continue;
      const t = trace(
        scene,
        src.map((s) => ({ ...s, guide: false })),
      );
      for (let i = 0; i < sky.crystals.length; i++) {
        const lit = (t.real[i] ?? 0) >= sky.crystals[i]!.need;
        if (lit !== (sky.owners[i] === pos)) return false;
      }
    }
    return true;
  };

  /** How far a ray from (x, y) runs before it leaves the screen. */
  const reach = (x: number, y: number, dx: number, dy: number) => {
    let t = Infinity;
    if (dx > 1e-9) t = Math.min(t, (W - x) / dx);
    if (dx < -1e-9) t = Math.min(t, -x / dx);
    if (dy < -1e-9) t = Math.min(t, -y / dy);
    if (dy > 1e-9) t = Math.min(t, (H - y) / dy);
    return t;
  };

  /**
   * A clear spot for a crystal on the ray at distance t, nudged sideways towards the middle of
   * the screen by up to two thirds of its radius if it would sit too near an edge.
   */
  const spotAt = (x0: number, y0: number, dx: number, dy: number, t: number) => {
    const x = x0 + dx * t;
    const y = y0 + dy * t;
    let nx = -dy;
    let ny = dx;
    if (nx * (W / 2 - x) + ny * (H / 2 - y) < 0) {
      nx = -nx;
      ny = -ny;
    }
    for (const o of [0, 0.35, 0.65]) {
      const cx = x + nx * o * r;
      const cy = y + ny * o * r;
      if (clear(cx, cy, r)) return { x: cx, y: cy };
    }
    return null;
  };

  const tryCrystal = (pos: number, at: { x: number; y: number } | null, mirror: boolean) => {
    if (!at) return false;
    sky.crystals.push({ x: at.x, y: at.y, r, band: "w", need: NEED });
    sky.owners.push(pos);
    if (fair()) return true;
    sky.crystals.pop();
    sky.owners.pop();
    if (mirror) sky.mirrors.pop();
    return false;
  };

  for (let pos = 0; pos < intended.length; pos++) {
    const b = intended[pos]![0];
    if (!b || b.dy > -0.2) continue;
    const tOut = reach(b.x, b.y, b.dx, b.dy);
    // From just above the bottom edge to two thirds of the way up, or where the beam leaves.
    const t0 = (2.2 * r) / -b.dy;
    const t1 = Math.min(tOut - r, (H * 0.65) / -b.dy);
    let placed = false;
    for (let tries = 0; tries < 60 && !placed && t1 > t0; tries++) {
      const t = rng.range(t0, t1);
      if (rng.next() < 0.45) {
        placed = tryCrystal(pos, spotAt(b.x, b.y, b.dx, b.dy, t), false);
        continue;
      }
      const x = b.x + b.dx * t;
      const y = b.y + b.dy * t;
      if (!clear(x, y, half)) continue;
      const turn = rng.int(12);
      const a = turn * STEP;
      const nx = Math.sin(a);
      const ny = -Math.cos(a);
      // The mirror's face must meet the light, and send it aside and on up.
      const dot = b.dx * nx + b.dy * ny;
      if (dot >= 0) continue;
      const rx = b.dx - 2 * dot * nx;
      const ry = b.dy - 2 * dot * ny;
      // Turned aside a little, so its crystal stays clear of the neighbours' beams.
      if (ry > -0.6 || Math.abs(rx) < 0.25) continue;
      const d = Math.min(rng.range(480, 900) * k, reach(x, y, rx, ry) - r);
      if (d < 400 * k) continue;
      sky.mirrors.push({ x, y, turn: normDetent(turn), half });
      const at = spotAt(x, y, rx, ry, d);
      if (!at) {
        sky.mirrors.pop();
        continue;
      }
      placed = tryCrystal(pos, at, true);
    }
    if (placed) continue;
    // Beams that run close together can't each have a crystal of their own: hang this one on its
    // beam anyway, at the first clear spot, even if a neighbour's beam passes through it too.
    spacing = 2.3;
    for (let t = t0; t < tOut; t += r * 0.5) {
      const at = spotAt(b.x, b.y, b.dx, b.dy, t);
      if (!at) continue;
      sky.crystals.push({ x: at.x, y: at.y, r, band: "w", need: NEED });
      sky.owners.push(pos);
      break;
    }
    spacing = 3.2;
  }
  return sky;
};
