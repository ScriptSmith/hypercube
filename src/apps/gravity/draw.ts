/**
 * Canvas2D drawing of a universe: trails, particles, bodies lit by their stars, black holes with
 * their discs, flashes, arrows to bodies out of view, and ribbons. Everything is in world units
 * mapped to device px by a Transform. Nothing flashes fast: flares and collapses swell and fade.
 */
import { shownTemp, starLum, tempIndex, tempRgb } from "./bodies";
import { type Cosmos, TRAIL_FADE_MS, bodyRgb } from "./cosmos";
import { DUST_RGB, GAS, hotRgb, HOT_STEPS, KEEP, RING } from "./dust";
import type { Body, Box } from "./physics";
import type { Prediction } from "./predict";
import { css, hash, rgbOf, shade, type Sprites } from "./sprites";

/** device = world * s + o */
export interface Transform {
  s: number;
  ox: number;
  oy: number;
}

export interface Scene {
  g: CanvasRenderingContext2D;
  tr: Transform;
  sprites: Sprites;
  /** Animation time, ms. */
  now: number;
  /** Interpolation between the last two steps, and the last two particle steps. */
  alpha: number;
  dustAlpha: number;
}

const TAU = Math.PI * 2;
const X = (sc: Scene, x: number) => x * sc.tr.s + sc.tr.ox;
const Y = (sc: Scene, y: number) => y * sc.tr.s + sc.tr.oy;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Draw a sprite centred at world (x, y) with world half-size r. */
export const stamp = (
  sc: Scene,
  img: CanvasImageSource,
  x: number,
  y: number,
  r: number,
  rot = 0,
) => {
  const d = r * sc.tr.s;
  if (d < 0.4) return;
  if (rot === 0) {
    sc.g.drawImage(img, X(sc, x) - d, Y(sc, y) - d, d * 2, d * 2);
    return;
  }
  sc.g.save();
  sc.g.translate(X(sc, x), Y(sc, y));
  sc.g.rotate(rot);
  sc.g.drawImage(img, -d, -d, d * 2, d * 2);
  sc.g.restore();
};

export interface BodyLook {
  /** Radius to draw instead of the body's own (true sizes easing in, crossing onto a screen). */
  radius?(b: Body): number;
  /** Radius a star's light follows: light isn't size, so it keeps the drawn size by default. */
  light?(b: Body): number;
  /** How much the size markers show, 0 to 1, and their size in world units. */
  mark?: number;
  markR?: number;
}

/** Everything in the universe, in order: trails, particles, bodies, markers, flashes. */
export const drawCosmos = (sc: Scene, c: Cosmos, look: BodyLook = {}) => {
  drawTrails(sc, c);
  drawDust(sc, c);
  drawBodies(sc, c.u.bodies, look);
  drawMarkers(sc, c.u.bodies, look);
  drawFlashes(sc, c);
};

// ---- Trails --------------------------------------------------------------------------------

const CHUNK = 10;

export const drawTrails = (sc: Scene, c: Cosmos) => {
  const { g } = sc;
  g.globalCompositeOperation = "lighter";
  g.lineCap = "butt";
  g.lineJoin = "round";
  const cap = 110;
  for (const t of c.trails.values()) {
    if (t.count < 2) continue;
    const fade = t.goneAt ? Math.max(0, 1 - (sc.now - t.goneAt) / TRAIL_FADE_MS) : 1;
    if (fade <= 0) continue;
    const n = t.count;
    for (let c0 = 0; c0 < n - 1; c0 += CHUNK) {
      const c1 = Math.min(n - 1, c0 + CHUNK);
      const age = 1 - (c0 + c1) / 2 / (n - 1);
      g.strokeStyle = css(t.rgb, t.alpha * (1 - age) * fade);
      g.lineWidth = Math.max(1, t.width * sc.tr.s * (0.35 + 0.65 * (1 - age)));
      g.beginPath();
      for (let i = c0; i <= c1; i++) {
        const j = (t.start + i) % cap;
        const x = X(sc, t.pts[j * 2]!);
        const y = Y(sc, t.pts[j * 2 + 1]!);
        if (i === c0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
  }
  g.globalCompositeOperation = "source-over";
};

// ---- Particles -----------------------------------------------------------------------------

const KEYS = DUST_RGB.length + HOT_STEPS;
const LEVELS = 4;
let order = new Int32Array(0);
const counts = new Int32Array(KEYS * LEVELS + 1);
const starts = new Int32Array(KEYS * LEVELS + 1);
const fillAt = new Int32Array(KEYS * LEVELS + 1);
let keys = new Int16Array(0);
const colourCss: string[][] = [];

const fillFor = (key: number, level: number) => {
  let row = colourCss[key];
  if (!row) {
    const rgb = key < DUST_RGB.length ? DUST_RGB[key]! : hotRgb(key - DUST_RGB.length);
    row = Array.from({ length: LEVELS }, (_, l) => css(rgb, (l + 1) / LEVELS));
    colourCss[key] = row;
  }
  return row[level]!;
};

/**
 * Particles in two passes: cold debris, rings and belts drawn plainly; hot gas, glowing debris
 * and the stars of galaxies added as light. Each pass is bucketed by colour and brightness so
 * the colour changes only a few dozen times a frame.
 */
export const drawDust = (sc: Scene, c: Cosmos) => {
  const d = c.dust;
  if (d.live === 0) return;
  if (order.length < d.cap) {
    order = new Int32Array(d.cap);
    keys = new Int16Array(d.cap);
  }
  const a = sc.dustAlpha;
  const s = sc.tr.s;
  for (const glowing of [false, true]) {
    counts.fill(0);
    for (let i = 0; i < d.cap; i++) {
      const k = d.kind[i]!;
      keys[i] = -1;
      if (k === 0) continue;
      const hot = d.hot[i]!;
      const light = k === GAS || (k === KEEP && d.col[i]! >= 12 && d.col[i]! <= 15) || hot > 0.12;
      if (light !== glowing) continue;
      const t = d.life[i]! === Infinity ? 0 : d.age[i]! / d.life[i]!;
      // Fade in quickly, out over the last fifth of life; gas fades as it cools.
      let alpha = Math.min(1, d.age[i]! * 4, (1 - t) * 5);
      if (k === GAS) alpha *= Math.min(1, hot * 1.6);
      if (k === RING) alpha *= 0.85;
      const level = Math.min(LEVELS - 1, Math.floor(alpha * LEVELS));
      if (alpha < 0.06) continue;
      const key =
        hot > 0.12
          ? DUST_RGB.length + Math.min(HOT_STEPS - 1, Math.floor(hot * HOT_STEPS))
          : d.col[i]!;
      const bk = key * LEVELS + level;
      keys[i] = bk;
      counts[bk]!++;
    }
    let acc = 0;
    for (let b = 0; b < counts.length; b++) {
      starts[b] = acc;
      acc += counts[b]!;
    }
    if (acc === 0) continue;
    fillAt.set(starts);
    for (let i = 0; i < d.cap; i++) {
      const bk = keys[i]!;
      if (bk < 0) continue;
      order[fillAt[bk]!++] = i;
    }
    const { g } = sc;
    g.globalCompositeOperation = glowing ? "lighter" : "source-over";
    for (let b = 0; b < counts.length - 1; b++) {
      const n = counts[b]!;
      if (n === 0) continue;
      const key = Math.floor(b / LEVELS);
      const level = b % LEVELS;
      g.fillStyle = fillFor(key, level);
      // Light is drawn as soft points; plain dust as specks.
      const rgb = key < DUST_RGB.length ? DUST_RGB[key]! : hotRgb(key - DUST_RGB.length);
      const soft = glowing ? sc.sprites.glow(rgb, 6 * s) : null;
      if (soft) g.globalAlpha = (level + 1) / LEVELS;
      const end = starts[b]! + n;
      for (let o = starts[b]!; o < end; o++) {
        const i = order[o]!;
        const x = X(sc, lerp(d.px[i]!, d.x[i]!, a));
        const y = Y(sc, lerp(d.py[i]!, d.y[i]!, a));
        let z = Math.max(1, d.size[i]! * s);
        if (d.kind[i] === GAS) z *= 1 + d.age[i]! * 0.25;
        if (soft) {
          const zz = z * 1.7;
          g.drawImage(soft, x - zz, y - zz, zz * 2, zz * 2);
        } else {
          g.fillRect(x - z / 2, y - z / 2, z, z);
        }
      }
      g.globalAlpha = 1;
    }
    g.globalCompositeOperation = "source-over";
  }
};

// ---- Bodies --------------------------------------------------------------------------------

interface Light {
  x: number;
  y: number;
  lum: number;
}
const lights: Light[] = [];

const lightAngle = (x: number, y: number): number => {
  let best = -1;
  let ang = Math.PI * 1.25;
  for (const l of lights) {
    const d2 = (l.x - x) ** 2 + (l.y - y) ** 2;
    if (d2 < 1) continue;
    const s = l.lum / d2;
    if (s > best) {
      best = s;
      ang = Math.atan2(l.y - y, l.x - x);
    }
  }
  return ang;
};

export const drawBodies = (sc: Scene, bodies: readonly Body[], look: BodyLook = {}) => {
  const { g } = sc;
  lights.length = 0;
  for (const b of bodies) {
    if (b.kind === "star") lights.push({ x: b.x, y: b.y, lum: Math.max(0.05, starLum(b.m)) });
  }
  const pos = (b: Body) => ({ x: lerp(b.px, b.x, sc.alpha), y: lerp(b.py, b.y, sc.alpha) });
  // Black holes and their discs first, so bodies falling in show against them.
  for (const b of bodies) {
    if (b.kind !== "hole") continue;
    const p = pos(b);
    const r = look.radius ? look.radius(b) : b.r;
    g.globalCompositeOperation = "lighter";
    if (b.core) {
      const bulge = b.soft * 1.6;
      stamp(sc, sc.sprites.glow(0xffe2b8, bulge * sc.tr.s), p.x, p.y, bulge);
      g.globalAlpha = 0.8;
      stamp(sc, sc.sprites.glow(0xfff4e0, bulge * 0.35 * sc.tr.s), p.x, p.y, bulge * 0.35);
      g.globalAlpha = 1;
    }
    const feed = Math.min(1, b.feed);
    if (feed > 0.02 || !b.core) {
      const dr = r * (5 + 3 * feed);
      g.globalAlpha = Math.min(1, 0.18 + feed * 0.9);
      stamp(sc, sc.sprites.disc(dr * sc.tr.s), p.x, p.y, dr, -sc.now / 700 + b.id);
      g.globalAlpha = 1;
    }
    g.globalCompositeOperation = "source-over";
    stamp(sc, sc.sprites.hole(r * sc.tr.s), p.x, p.y, r * 4);
  }
  for (const b of bodies) {
    if (b.kind === "hole" || b.kind === "star") continue;
    drawSolid(sc, b, pos(b), look.radius ? look.radius(b) : b.r, bodies);
  }
  for (const b of bodies) {
    if (b.kind !== "star") continue;
    drawStar(sc, b, pos(b), look.radius ? look.radius(b) : b.r, look.light ? look.light(b) : b.re);
  }
};

const drawSolid = (
  sc: Scene,
  b: Body,
  p: { x: number; y: number },
  r: number,
  bodies: readonly Body[],
) => {
  const { g } = sc;
  const px = r * sc.tr.s;
  if (px < 0.6) return;
  const img =
    b.kind === "giant"
      ? sc.sprites.giant(b.look, px, b.id)
      : b.kind === "planet"
        ? sc.sprites.planet(b.look, px, b.id)
        : sc.sprites.rock(b.look, px, b.id);
  // Stretched towards whatever is pulling it apart.
  let stretch = 0;
  let towards = 0;
  if (b.strain > 0.02 && b.tide >= 0) {
    const t = bodies.find((q) => q.id === b.tide);
    if (t) {
      stretch = Math.min(1, b.strain);
      towards = Math.atan2(t.y - p.y, t.x - p.x);
    }
  }
  const light = lightAngle(p.x, p.y);
  // A faint halo so small bodies read from across the room.
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = b.kind === "rock" ? 0.25 : 0.32;
  stamp(sc, sc.sprites.glow(shade(bodyRgb(b), 0.2), px * 2.2), p.x, p.y, r * 2.2);
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  g.save();
  g.translate(X(sc, p.x), Y(sc, p.y));
  if (stretch > 0) {
    g.rotate(towards);
    g.scale(1 + stretch * 0.45, 1 - stretch * 0.2);
    g.rotate(-towards);
  }
  const spin = b.kind === "rock" ? (sc.now / 2400 + hash(b.id)) * TAU * 0.15 : 0;
  if (spin) g.rotate(spin);
  g.drawImage(img, -px, -px, px * 2, px * 2);
  if (spin) g.rotate(-spin);
  // Night side away from the brightest star.
  g.rotate(light + Math.PI);
  const sh = sc.sprites.shadow(px);
  g.drawImage(sh, -px, -px, px * 2, px * 2);
  g.restore();
  if (b.heat > 0.03) {
    const h = Math.min(1, b.heat);
    const hot = tempRgb(800 + 1900 * h);
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = Math.min(1, h * 1.3);
    stamp(sc, sc.sprites.glow(hot, px * 1.25), p.x, p.y, r * 1.25);
    g.globalAlpha = Math.min(1, h * 0.7);
    stamp(sc, sc.sprites.glow(hot, px * 2.6), p.x, p.y, r * 2.6);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
  if (b.color >= 0) {
    // A thin ring in the thrower's colour, so a child can follow their own.
    g.strokeStyle = css(rgbOf(b.color), 0.55);
    g.lineWidth = Math.max(1, px * 0.12);
    g.beginPath();
    g.arc(X(sc, p.x), Y(sc, p.y), px * 1.35 + 2, 0, TAU);
    g.stroke();
  }
};

const drawStar = (sc: Scene, b: Body, p: { x: number; y: number }, r: number, lightR: number) => {
  const { g } = sc;
  const t = shownTemp(b.m);
  const rgb = tempRgb(t);
  const lum = starLum(b.m);
  const px = r * sc.tr.s;
  const breathe = 1 + 0.025 * Math.sin(sc.now / 900 + b.id);
  const flare = Math.min(1, b.flare);
  // Brighter stars shine further: the light's reach grows with the log of luminosity. It follows
  // the drawn size even with true sizes on, when the disc itself may be under a pixel.
  const reach = lightR * (5 + 1.6 * Math.log10(1 + lum)) * breathe * (1 + flare * 0.7);
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = Math.min(1, 0.72 + 0.15 * Math.log10(0.3 + lum) + flare * 0.4);
  stamp(sc, sc.sprites.corona(rgb, reach * sc.tr.s), p.x, p.y, reach);
  g.globalAlpha = Math.min(1, 0.7 + flare * 0.3);
  const inner = Math.max(r, lightR * 0.35);
  stamp(sc, sc.sprites.glow(shade(rgb, 0.5), inner * 1.45 * sc.tr.s), p.x, p.y, inner * 1.45);
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  stamp(sc, sc.sprites.star(tempIndex(t), px), p.x, p.y, r);
  if (b.color >= 0) {
    g.strokeStyle = css(rgbOf(b.color), 0.5);
    g.lineWidth = Math.max(1, px * 0.06);
    g.beginPath();
    g.arc(X(sc, p.x), Y(sc, p.y), px * 1.3 + 3, 0, TAU);
    g.stroke();
  }
};

// ---- Markers -------------------------------------------------------------------------------

const MARK_SIZE: Record<Body["kind"], number> = {
  rock: 0.85,
  planet: 1,
  giant: 1.1,
  star: 1.3,
  hole: 1.3,
};

/**
 * With true sizes on, most bodies are far below a pixel, so each gets a marker: the four corners
 * of a square round an empty middle, like a camera's focus frame, in its colour, with the body
 * itself as the point in the middle. Corners read as "something small is here", never as the
 * body's size. A body large enough to see (the ringed giant) gets none.
 */
export const drawMarkers = (sc: Scene, bodies: readonly Body[], look: BodyLook) => {
  const m = look.mark ?? 0;
  if (m <= 0.01) return;
  const { g } = sc;
  const R0 = look.markR ?? 12;
  g.lineCap = "round";
  g.lineJoin = "round";
  for (const b of bodies) {
    if (b.core) continue;
    const r = look.radius ? look.radius(b) : b.r;
    const R = R0 * MARK_SIZE[b.kind];
    const show = Math.min(1, Math.max(0, (R * 0.4 - r) / (R * 0.25)));
    const a = m * show;
    if (a < 0.02) continue;
    const x = X(sc, lerp(b.px, b.x, sc.alpha));
    const y = Y(sc, lerp(b.py, b.y, sc.alpha));
    const rgb = b.color >= 0 ? rgbOf(b.color) : b.kind === "hole" ? 0xcbb8ff : bodyRgb(b);
    const Rd = R * sc.tr.s;
    const arm = Rd * 0.42;
    g.strokeStyle = css(shade(rgb, 0.45), a);
    g.lineWidth = Math.max(1.5, Rd * 0.14);
    g.beginPath();
    for (const [sx, sy] of CORNERS) {
      const cx = x + sx * Rd;
      const cy = y + sy * Rd;
      g.moveTo(cx - sx * arm, cy);
      g.lineTo(cx, cy);
      g.lineTo(cx, cy - sy * arm);
    }
    g.stroke();
    // The body itself: its true size, but never less than a point.
    g.fillStyle = css(shade(rgb, 0.5), a);
    g.beginPath();
    g.arc(x, y, Math.max(1.1, r * sc.tr.s), 0, TAU);
    g.fill();
  }
};

const CORNERS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

// ---- Flashes -------------------------------------------------------------------------------

export const drawFlashes = (sc: Scene, c: Cosmos) => {
  const { g } = sc;
  g.globalCompositeOperation = "lighter";
  for (const f of c.flashes) {
    const t = (sc.now - f.at) / f.ms;
    if (t < 0 || t >= 1) continue;
    // Swells fast, fades slowly.
    const a = t < 0.12 ? t / 0.12 : (1 - t) ** 1.6;
    const r = f.r * (0.5 + 0.7 * Math.sqrt(t));
    g.globalAlpha = Math.min(1, a);
    stamp(sc, sc.sprites.glow(f.rgb, r * sc.tr.s), f.x, f.y, r);
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
};

// ---- Bodies out of view --------------------------------------------------------------------

const MAX_ARROWS = 12;

/**
 * A small arrow at the edge of `view` for each body outside it, pointing towards it, in the
 * thrower's colour or the body's own. `size` is in world units.
 */
export const drawArrows = (sc: Scene, bodies: readonly Body[], view: Box, size: number) => {
  const { g } = sc;
  const cx = (view.x0 + view.x1) / 2;
  const cy = (view.y0 + view.y1) / 2;
  const m = size * 1.2;
  const out = bodies
    .filter((b) => !b.core && (b.x < view.x0 || b.x > view.x1 || b.y < view.y0 || b.y > view.y1))
    .map((b) => ({ b, d: Math.hypot(b.x - cx, b.y - cy) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, MAX_ARROWS);
  for (const { b } of out) {
    const dx = b.x - cx;
    const dy = b.y - cy;
    // Where the line from the centre leaves the view, inset a little.
    const hx = (view.x1 - view.x0) / 2 - m;
    const hy = (view.y1 - view.y0) / 2 - m;
    const k = Math.min(hx / Math.max(1e-6, Math.abs(dx)), hy / Math.max(1e-6, Math.abs(dy)));
    const ax = cx + dx * k;
    const ay = cy + dy * k;
    const ang = Math.atan2(dy, dx);
    const big = b.kind === "star" || b.kind === "hole" ? 1.3 : b.kind === "giant" ? 1.1 : 0.85;
    const s = size * big * sc.tr.s;
    const rgb = b.color >= 0 ? rgbOf(b.color) : bodyRgb(b);
    g.save();
    g.translate(X(sc, ax), Y(sc, ay));
    g.rotate(ang);
    g.fillStyle = css(shade(rgb, 0.2), 0.85);
    g.beginPath();
    g.moveTo(s * 0.6, 0);
    g.lineTo(-s * 0.4, -s * 0.45);
    g.lineTo(-s * 0.2, 0);
    g.lineTo(-s * 0.4, s * 0.45);
    g.closePath();
    g.fill();
    g.restore();
  }
};

// ---- Ribbons -------------------------------------------------------------------------------

export interface RibbonStyle {
  rgb: number;
  /** Dot radius in world units. */
  dot: number;
  /** Only the part above (y < clip) or below (y >= clip) this line is drawn. */
  clip?: { y: number; keep: "above" | "below" };
  /** Fade over this many points (default: the ribbon's own), so two halves of one ribbon match. */
  fadeOver?: number;
  /** Dot radius by place, instead of `dot`. */
  dotAt?(x: number, y: number): number;
}

/** The predicted path: dots fading along their length, and a mark for how it ends. */
export const drawRibbon = (sc: Scene, pred: Prediction, style: RibbonStyle) => {
  const { g } = sc;
  const n = pred.n;
  if (n < 2) return;
  const inside = (y: number) =>
    !style.clip || (style.clip.keep === "above" ? y < style.clip.y : y >= style.clip.y);
  g.globalCompositeOperation = "lighter";
  const glow = sc.sprites.glow(style.rgb, style.dot * 2.6 * sc.tr.s);
  const over = Math.max(2, style.fadeOver ?? n);
  // Dots spaced along the path rather than in time, so a slow stretch doesn't smear into a line.
  let lx = pred.pts[0]!;
  let ly = pred.pts[1]!;
  let walked = 0;
  for (let i = 1; i < n; i++) {
    const x = pred.pts[i * 2]!;
    const y = pred.pts[i * 2 + 1]!;
    walked += Math.hypot(x - lx, y - ly);
    lx = x;
    ly = y;
    const dot = style.dotAt ? style.dotAt(x, y) : style.dot;
    if (walked < dot * 3.2) continue;
    walked = 0;
    if (!inside(y)) continue;
    const t = Math.min(1, i / (over - 1));
    g.globalAlpha = Math.max(0.12, 0.95 * (1 - t * 0.8));
    stamp(sc, glow, x, y, dot * 2.6 * (1 - t * 0.35));
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  if (!inside(pred.y) || pred.stop === "end") return;
  const x = X(sc, pred.x);
  const y = Y(sc, pred.y);
  const d = Math.max(4, style.dot * 3 * sc.tr.s);
  g.lineWidth = Math.max(1.5, style.dot * 0.6 * sc.tr.s);
  if (pred.stop === "star" || pred.stop === "hole") {
    // It falls in: a cross.
    g.strokeStyle = pred.stop === "star" ? "rgba(255,200,130,0.9)" : "rgba(200,180,255,0.9)";
    g.beginPath();
    g.moveTo(x - d, y - d);
    g.lineTo(x + d, y + d);
    g.moveTo(x + d, y - d);
    g.lineTo(x - d, y + d);
    g.stroke();
  } else if (pred.stop === "merge") {
    // It joins a body: a ring.
    g.strokeStyle = css(style.rgb, 0.9);
    g.beginPath();
    g.arc(x, y, d * 1.2, 0, TAU);
    g.stroke();
  } else if (pred.stop === "shatter" || pred.stop === "shred") {
    // It breaks: a burst of short strokes.
    g.strokeStyle = "rgba(255,210,170,0.85)";
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      g.moveTo(x + Math.cos(a) * d * 0.6, y + Math.sin(a) * d * 0.6);
      g.lineTo(x + Math.cos(a) * d * 1.4, y + Math.sin(a) * d * 1.4);
    }
    g.stroke();
  }
};

/** Deep space: a faint band of the galaxy, and stars of real colours, drawn once per size. */
export const drawBackdrop = (
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  seed: number,
  density = 1,
) => {
  g.fillStyle = "#020309";
  g.fillRect(0, 0, w, h);
  let s = seed >>> 0 || 7;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  // The band: a soft diagonal haze of many faint blobs.
  const ang = -0.35 + rand() * 0.7;
  const bx = w * (0.3 + rand() * 0.4);
  const by = h * (0.3 + rand() * 0.4);
  const span = Math.hypot(w, h);
  const unit = Math.max(w, h) / 1000;
  for (let i = 0; i < 70; i++) {
    const t = (rand() - 0.5) * span;
    const off = (rand() - 0.5) * span * 0.08;
    const x = bx + Math.cos(ang) * t - Math.sin(ang) * off;
    const y = by + Math.sin(ang) * t + Math.cos(ang) * off;
    const r = span * (0.03 + rand() * 0.06);
    const tint = rand() < 0.25 ? "120,100,150" : rand() < 0.5 ? "150,140,130" : "90,110,150";
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${tint},0.045)`);
    grad.addColorStop(1, `rgba(${tint},0)`);
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const n = Math.min(2400, Math.round(((w * h) / 6000) * density));
  for (let i = 0; i < n; i++) {
    // More stars near the band.
    let x = rand() * w;
    let y = rand() * h;
    if (rand() < 0.45) {
      const t = (rand() - 0.5) * span;
      const off = (rand() + rand() + rand() - 1.5) * span * 0.05;
      x = bx + Math.cos(ang) * t - Math.sin(ang) * off;
      y = by + Math.sin(ang) * t + Math.cos(ang) * off;
    }
    const bright = rand() ** 3;
    const temp = 3200 + rand() ** 1.5 * 12_000;
    const rgb = tempRgb(temp);
    const a = 0.15 + bright * 0.75;
    const size = Math.max(1, (0.8 + bright * 1.8) * Math.max(1, unit * 0.9));
    g.fillStyle = css(shade(rgb, 0.45), a);
    g.fillRect(x, y, size, size);
  }
};
