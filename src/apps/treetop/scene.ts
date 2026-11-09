/**
 * Draws a view of the course: the sky and parallax scenery, the obstacles, the start and finish
 * lines, flyers and particles. A panel lane and the screen's pack view are both viewports onto
 * the same course; only the camera and scale differ.
 */
import { type Atlas, FLYER, PIECE, type SpriteName, TILE } from "./art";
import { FLOOR_Y } from "./config";
import type { Course, Gate } from "./course";
import { type Gfx, type Rgb, WHITE } from "./gl";

export interface Viewport {
  /** Device px rect of the view. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Device px per course px. */
  s: number;
  /** Course x at the left edge. */
  camX: number;
  /** Device px y of the course's top (course y = 0). The floor is at top + FLOOR_Y * s. */
  top: number;
}

const PARALLAX = { stars: 0.03, far: 0.12, mid: 0.35 } as const;
/** Half a texel in from tile edges, so neighbouring tiles don't show a seam. */
const EDGE = 0.002;
const TILE_SUB = [EDGE, EDGE, 1 - EDGE, 1 - EDGE] as const;

export const SKY_DARK: Rgb = [0.02, 0.031, 0.09];

/** Course x to device x. */
export const sx = (vp: Viewport, x: number): number => vp.x + (x - vp.camX) * vp.s;
/** Course y to device y. */
export const sy = (vp: Viewport, y: number): number => vp.top + y * vp.s;

const tileRow = (
  gfx: Gfx,
  atlas: Atlas,
  name: SpriteName,
  vp: Viewport,
  tileW: number,
  tileH: number,
  y: number,
  offset: number,
  alpha = 1,
) => {
  const reg = atlas.regions[name];
  const w = tileW * vp.s;
  const h = tileH * vp.s;
  if (w < 1) return;
  let x = vp.x - ((((offset * vp.s) % w) + w) % w);
  for (; x < vp.x + vp.w; x += w) {
    gfx.sprite(reg, x, y, w + 1, h, WHITE, alpha, 0, 0, 0, false, TILE_SUB);
  }
};

/** A repeating body from device y0 to y1 (y0 < y1), tiles anchored at `anchor`. */
const body = (
  gfx: Gfx,
  reg: Atlas["regions"][SpriteName],
  cx: number,
  w: number,
  tileH: number,
  y0: number,
  y1: number,
  fromBottom: boolean,
) => {
  if (y1 <= y0 || tileH < 0.5) return;
  if (fromBottom) {
    for (let y = y1; y > y0; y -= tileH) {
      const h = Math.min(tileH, y - y0);
      const cut = h / tileH;
      gfx.sprite(reg, cx, y + 0.5, w, h + 1, WHITE, 1, 0, 0.5, 1, false, [
        0,
        1 - cut + EDGE,
        1,
        1 - EDGE,
      ]);
    }
  } else {
    for (let y = y0; y < y1; y += tileH) {
      const h = Math.min(tileH, y1 - y);
      const cut = h / tileH;
      gfx.sprite(reg, cx, y - 0.5, w, h + 1, WHITE, 1, 0, 0.5, 0, false, [0, EDGE, 1, cut - EDGE]);
    }
  }
};

const drawGate = (gfx: Gfx, atlas: Atlas, vp: Viewport, g: Gate, pass: "back" | "front") => {
  const r = atlas.regions;
  const cx = sx(vp, g.x + g.w / 2);
  const s = vp.s;
  const tileH = PIECE.bodyH * s;
  const top = sy(vp, g.c - g.h / 2);
  const bottom = sy(vp, g.c + g.h / 2);
  const floor = sy(vp, FLOOR_Y);
  const style = g.style;
  if (pass === "back") {
    // Hanging piece: body from above the view down to its cap at the top of the gap.
    const cap = r[`${style}-top-cap`];
    const capW = (cap.w / atlas.scale) * s;
    const capHh = (cap.h / atlas.scale) * s;
    body(
      gfx,
      r[`${style}-top-body`],
      cx,
      PIECE.width * s,
      tileH,
      Math.min(vp.y, vp.top) - 4,
      top - capHh + 2,
      true,
    );
    gfx.sprite(cap, cx, top, capW, capHh, WHITE, 1, 0, 0.5, 1);
    // Standing piece: body from its cap at the bottom of the gap down into the ground.
    const bcap = r[`${style}-bot-cap`];
    const bcapW = (bcap.w / atlas.scale) * s;
    const bcapH = (bcap.h / atlas.scale) * s;
    body(
      gfx,
      r[`${style}-bot-body`],
      cx,
      PIECE.width * s,
      tileH,
      bottom + bcapH - 2,
      floor + 40 * s,
      false,
    );
    gfx.sprite(bcap, cx, bottom, bcapW, bcapH, WHITE, 1, 0, 0.5, 0);
  } else {
    gfx.sprite(
      r[`${style}-base`],
      cx,
      floor + 30 * s,
      PIECE.baseW * s,
      PIECE.baseH * s,
      WHITE,
      1,
      0,
      0.5,
      1,
    );
  }
};

export interface WorldOptions {
  /** Seconds, for twinkling. */
  time: number;
  /** Show the dashed start line. */
  start: number;
}

/** Everything behind the flyers. */
export const drawWorld = (
  gfx: Gfx,
  atlas: Atlas,
  vp: Viewport,
  course: Course | null,
  opts: WorldOptions,
) => {
  const r = atlas.regions;
  const s = vp.s;
  gfx.sprite(r.sky, vp.x, vp.y, vp.w, vp.h, WHITE, 1, 0, 0, 0);
  // Stars over the upper sky, gently twinkling as two offset layers.
  const starTop = Math.min(vp.y, vp.top);
  const starRows = Math.ceil((sy(vp, 1300) - starTop) / (TILE.stars.h * s));
  for (let i = 0; i < starRows; i++) {
    tileRow(
      gfx,
      atlas,
      "stars",
      vp,
      TILE.stars.w,
      TILE.stars.h,
      starTop + i * TILE.stars.h * s,
      vp.camX * PARALLAX.stars,
      0.75 + 0.25 * Math.sin(opts.time * 1.3 + i),
    );
  }
  const moon = 260 * s;
  gfx.sprite(
    r.moon,
    vp.x + vp.w * 0.8,
    Math.max(vp.y + moon * 0.6, sy(vp, 330)),
    moon,
    moon,
    WHITE,
    0.9,
  );
  tileRow(
    gfx,
    atlas,
    "far",
    vp,
    TILE.far.w,
    TILE.far.h,
    sy(vp, 1720 - TILE.far.h),
    vp.camX * PARALLAX.far,
  );
  tileRow(
    gfx,
    atlas,
    "mid",
    vp,
    TILE.mid.w,
    TILE.mid.h,
    sy(vp, 1856 - TILE.mid.h),
    vp.camX * PARALLAX.mid,
  );
  if (opts.start > 0) {
    const x = sx(vp, 0);
    if (x > vp.x - 40 && x < vp.x + vp.w + 40) {
      gfx.sprite(
        r.start,
        x,
        sy(vp, 60),
        24 * s,
        (FLOOR_Y - 60) * s,
        WHITE,
        0.45 * opts.start,
        0,
        0.5,
        0,
      );
    }
  }
  const visible: Gate[] = [];
  if (course) {
    const left = vp.camX - 400;
    const right = vp.camX + vp.w / s + 400;
    for (const g of course.gates) {
      if (g.x + g.w < left) continue;
      if (g.x > right) break;
      visible.push(g);
    }
    for (const g of visible) drawGate(gfx, atlas, vp, g, "back");
  }
  tileRow(gfx, atlas, "ground", vp, TILE.ground.w, TILE.ground.h, sy(vp, FLOOR_Y - 34), vp.camX);
  const below = sy(vp, FLOOR_Y - 34 + TILE.ground.h);
  if (below < vp.y + vp.h)
    gfx.sprite(
      r.white,
      vp.x,
      below - 1,
      vp.w,
      vp.y + vp.h - below + 1,
      [0.1, 0.07, 0.047],
      1,
      0,
      0,
      0,
    );
  for (const g of visible) drawGate(gfx, atlas, vp, g, "front");
  tileRow(gfx, atlas, "canopy", vp, TILE.canopy.w, TILE.canopy.h, Math.min(vp.y, vp.top), vp.camX);
  if (course) {
    const fx = sx(vp, course.length);
    if (fx > vp.x - 200 * s && fx < vp.x + vp.w + 200 * s) {
      const y0 = Math.min(vp.y, vp.top) + 40 * s;
      const y1 = sy(vp, FLOOR_Y);
      gfx.sprite(
        r.glow,
        fx,
        (y0 + y1) / 2,
        420 * s,
        y1 - y0,
        [1, 0.8, 0.2],
        0.35,
        0,
        0.5,
        0.5,
        true,
      );
      gfx.sprite(r.finish, fx, y0, 120 * s, y1 - y0, WHITE, 1, 0, 0.5, 0);
      for (const y of [y0, y1]) {
        gfx.sprite(r.star, fx, y, 110 * s, 110 * s, [1, 0.82, 0.25], 1, opts.time * 0.6);
      }
    }
  }
};

export interface FlyerLook {
  color: Rgb;
  alpha: number;
  /** Wing pose 0 to 3. */
  pose: number;
  angle: number;
  /** Size multiplier. */
  size?: number;
  /** Rings around the flyer, for lanes beyond the eighth colour. */
  rings?: number;
  glow?: number;
  /** Draw as a pale outline-less ghost. */
  ghost?: boolean;
  /** Mirror for a flyer tumbling backwards. */
  flip?: boolean;
}

export const drawFlyer = (
  gfx: Gfx,
  atlas: Atlas,
  vp: Viewport,
  x: number,
  y: number,
  look: FlyerLook,
) => {
  const r = atlas.regions;
  const k = vp.s * (look.size ?? 1);
  const px = sx(vp, x);
  const py = sy(vp, y);
  const w = FLYER.w * k;
  const h = FLYER.h * k;
  if (px < vp.x - w || px > vp.x + vp.w + w) return;
  if (look.glow && !look.ghost) {
    gfx.sprite(
      r.glow,
      px,
      py,
      380 * k,
      300 * k,
      look.color,
      look.glow * look.alpha,
      0,
      0.5,
      0.5,
      true,
    );
  }
  const pose = Math.max(0, Math.min(3, Math.round(look.pose))) as 0 | 1 | 2 | 3;
  const width = look.flip ? -w : w;
  if (look.ghost) {
    gfx.sprite(
      r[`fly-${pose}`],
      px,
      py,
      width,
      h,
      [0.85, 0.9, 1],
      look.alpha,
      look.angle,
      FLYER.ax,
      FLYER.ay,
    );
    return;
  }
  gfx.sprite(
    r[`fly-${pose}`],
    px,
    py,
    width,
    h,
    look.color,
    look.alpha,
    look.angle,
    FLYER.ax,
    FLYER.ay,
  );
  gfx.sprite(
    r[`mark-${pose}`],
    px,
    py,
    width,
    h,
    WHITE,
    look.alpha,
    look.angle,
    FLYER.ax,
    FLYER.ay,
  );
  for (let i = 0; i < (look.rings ?? 0); i++) {
    const d = (250 + i * 70) * k;
    gfx.sprite(r.ring, px, py, d, d, WHITE, 0.85 * look.alpha);
  }
};

/** The wing pose for a flyer `age` seconds after its last flap. */
export const poseFor = (age: number, vy: number): number => {
  if (age < 0.05) return 0;
  if (age < 0.13) return 3;
  if (age < 0.2) return 1;
  return vy > 900 ? 1 : 2;
};

/** Nose-up when climbing, nose-down when falling. */
export const angleFor = (vy: number): number => Math.max(-0.45, Math.min(0.9, vy / 1700));

// ---- Particles -----------------------------------------------------------------------------

type Kind = "feather" | "spark" | "confetti";

interface Particle {
  live: boolean;
  kind: Kind;
  /** The lane that sees it, or -1 for every lane. */
  owner: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  rot: number;
  vr: number;
  color: Rgb;
}

export interface Particles {
  /** `owner` is the lane that sees the burst, or -1 (the default) for every lane. */
  burst(
    kind: Kind,
    x: number,
    y: number,
    n: number,
    color: Rgb,
    speed: number,
    size: number,
    owner?: number,
  ): void;
  step(dt: number): void;
  /** Draw the particles `owner` sees (every particle when it is omitted). */
  draw(gfx: Gfx, atlas: Atlas, vp: Viewport, owner?: number): void;
  clear(): void;
}

const CONFETTI: readonly Rgb[] = [
  [1, 0.8, 0.2],
  [0.44, 0.64, 0.99],
  [0.98, 0.36, 0.6],
  [0.42, 0.97, 0.97],
  [0.54, 0.85, 0.61],
];

/** A fixed pool: a burst that finds it full overwrites the oldest particles. */
export const createParticles = (size: number, rand: () => number): Particles => {
  const pool: Particle[] = Array.from({ length: size }, () => ({
    live: false,
    kind: "spark",
    owner: -1,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0,
    max: 1,
    size: 1,
    rot: 0,
    vr: 0,
    color: WHITE,
  }));
  let cursor = 0;
  return {
    burst(kind, x, y, n, color, speed, sz, owner = -1) {
      for (let i = 0; i < n; i++) {
        const p = pool[cursor]!;
        cursor = (cursor + 1) % pool.length;
        const a = rand() * Math.PI * 2;
        const v = speed * (0.35 + rand() * 0.65);
        p.live = true;
        p.kind = kind;
        p.owner = owner;
        p.x = x;
        p.y = y;
        p.vx = Math.cos(a) * v;
        p.vy = Math.sin(a) * v - (kind === "confetti" ? speed * 0.6 : 0);
        p.max = kind === "spark" ? 0.5 + rand() * 0.3 : 1.1 + rand() * 0.8;
        p.life = p.max;
        p.size = sz * (0.6 + rand() * 0.6);
        p.rot = rand() * Math.PI * 2;
        p.vr = (rand() - 0.5) * 8;
        p.color = kind === "confetti" ? CONFETTI[Math.floor(rand() * CONFETTI.length)]! : color;
      }
    },
    step(dt) {
      for (const p of pool) {
        if (!p.live) continue;
        p.life -= dt;
        if (p.life <= 0) {
          p.live = false;
          continue;
        }
        const drag = p.kind === "spark" ? 3 : 1.6;
        p.vx *= Math.exp(-drag * dt);
        p.vy = p.vy * Math.exp(-drag * dt) + (p.kind === "spark" ? 0 : 520) * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
      }
    },
    draw(gfx, atlas, vp, owner) {
      const r = atlas.regions;
      for (const p of pool) {
        if (!p.live || (owner !== undefined && p.owner !== -1 && p.owner !== owner)) continue;
        const a = Math.min(1, p.life / (p.max * 0.4));
        const x = sx(vp, p.x);
        const y = sy(vp, p.y);
        const s = p.size * vp.s;
        if (p.kind === "spark") gfx.sprite(r.spark, x, y, s, s, p.color, a, p.rot, 0.5, 0.5, true);
        else if (p.kind === "feather") gfx.sprite(r.feather, x, y, s, s * 0.36, p.color, a, p.rot);
        else gfx.sprite(r.white, x, y, s, s * 0.6, p.color, a, p.rot);
      }
    },
    clear() {
      for (const p of pool) p.live = false;
    },
  };
};
