/**
 * Pre-drawn images for Canvas2D, drawn once per look and size and then stamped with drawImage:
 * soft glows, stars by temperature, banded gas giants, rocky planets with ground and cloud, lumpy
 * rocks, the shadow that turns a body's dark side away from its star, black holes and accretion
 * discs. Sizes are bucketed and the cache is bounded.
 */
import { PALETTE } from "../../core/ui";
import { GIANT_LOOKS, PLANET_LOOKS, ROCK_LOOKS, tableRgb } from "./bodies";

export const hexToRgb = (hex: string): number => Number.parseInt(hex.slice(1), 16) & 0xffffff;

/** Player colours (pads and their throws' trails): the shared palette. */
export const PLAYER_RGB: readonly number[] = PALETTE.players.map(hexToRgb);

export const rgbOf = (index: number): number => PLAYER_RGB[((index % 8) + 8) % 8] ?? 0xffffff;

const ch = (c: number, s: number) => (c >> s) & 255;
export const css = (c: number, a = 1): string => `rgba(${ch(c, 16)},${ch(c, 8)},${ch(c, 0)},${a})`;

/** Towards white by k (0 to 1), or towards black for negative k. */
export const shade = (c: number, k: number): number => {
  const f = (v: number) =>
    Math.max(0, Math.min(255, Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k))));
  return (f(ch(c, 16)) << 16) | (f(ch(c, 8)) << 8) | f(ch(c, 0));
};

export const mix = (a: number, b: number, t: number): number => {
  const f = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t) & 255;
  return (f(16) << 16) | (f(8) << 8) | f(0);
};

type Canvas = HTMLCanvasElement | OffscreenCanvas;
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const MAX_SPRITES = 220;
const MAX_GLOW_R = 256;
const MAX_SOLID_R = 220;

const makeCanvas = (w: number, h: number): Canvas => {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};

/** Small deterministic noise. */
export const hash = (n: number): number => {
  let t = (n * 0x9e3779b1) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Solid sprites in steps of 4 px, so a slowly growing body doesn't fill the cache. */
const bucket = (px: number) => Math.min(MAX_SOLID_R, Math.max(4, Math.round(px / 4) * 4));
/** Glows are soft: powers of two are plenty. */
const glowBucket = (px: number) =>
  Math.min(MAX_GLOW_R, Math.max(8, 2 ** Math.round(Math.log2(Math.max(1, px)))));

export interface Sprites {
  glow(rgb: number, radius: number): Canvas;
  /** A star's light: bright near the middle and falling off slowly, for drawing additively. */
  corona(rgb: number, radius: number): Canvas;
  /** A star's disc (limb darkened) for a colour-table index. */
  star(t: number, radius: number): Canvas;
  giant(look: number, radius: number, seed: number): Canvas;
  planet(look: number, radius: number, seed: number): Canvas;
  rock(look: number, radius: number, seed: number): Canvas;
  /** Night side, lit from the left; rotate towards the light. */
  shadow(radius: number): Canvas;
  hole(radius: number): Canvas;
  /** Accretion disc out to `radius`, its inner edge at a fifth. */
  disc(radius: number): Canvas;
  clear(): void;
}

export const createSprites = (): Sprites => {
  const cache = new Map<string, Canvas>();
  const get = (key: string, draw: () => Canvas): Canvas => {
    let c = cache.get(key);
    if (c) {
      cache.delete(key);
      cache.set(key, c);
      return c;
    }
    if (cache.size >= MAX_SPRITES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    c = draw();
    cache.set(key, c);
    return c;
  };
  const ctxOf = (c: Canvas) => c.getContext("2d") as Ctx2D;
  const square = (r: number) => {
    const c = makeCanvas(r * 2, r * 2);
    return { c, g: ctxOf(c) };
  };

  const glow = (rgb: number, radius: number) => {
    const r = glowBucket(radius);
    return get(`g${rgb}:${r}`, () => {
      const { c, g } = square(r);
      const grad = g.createRadialGradient(r, r, 0, r, r, r);
      grad.addColorStop(0, css(rgb, 1));
      grad.addColorStop(0.15, css(rgb, 0.5));
      grad.addColorStop(0.4, css(rgb, 0.14));
      grad.addColorStop(0.7, css(rgb, 0.04));
      grad.addColorStop(1, css(rgb, 0));
      g.fillStyle = grad;
      g.fillRect(0, 0, r * 2, r * 2);
      return c;
    });
  };

  const corona = (rgb: number, radius: number) => {
    const r = glowBucket(radius);
    return get(`c${rgb}:${r}`, () => {
      const { c, g } = square(r);
      const grad = g.createRadialGradient(r, r, 0, r, r, r);
      grad.addColorStop(0, css(shade(rgb, 0.5), 1));
      grad.addColorStop(0.12, css(rgb, 0.85));
      grad.addColorStop(0.24, css(rgb, 0.5));
      grad.addColorStop(0.45, css(rgb, 0.18));
      grad.addColorStop(0.72, css(rgb, 0.05));
      grad.addColorStop(1, css(rgb, 0));
      g.fillStyle = grad;
      g.fillRect(0, 0, r * 2, r * 2);
      return c;
    });
  };

  const star = (t: number, radius: number) => {
    const r = bucket(radius);
    const ti = Math.round(t / 2) * 2;
    return get(`s${ti}:${r}`, () => {
      const rgb = tableRgb(ti);
      const { c, g } = square(r);
      // Limb darkening: hot white in the middle, the star's colour and dimmer at the edge.
      const grad = g.createRadialGradient(r, r, 0, r, r, r);
      grad.addColorStop(0, css(shade(rgb, 0.5)));
      grad.addColorStop(0.45, css(shade(rgb, 0.25)));
      grad.addColorStop(0.8, css(rgb));
      grad.addColorStop(0.95, css(shade(rgb, -0.2)));
      grad.addColorStop(1, css(shade(rgb, -0.3), 0.7));
      g.fillStyle = grad;
      g.beginPath();
      g.arc(r, r, r, 0, Math.PI * 2);
      g.fill();
      // A faint mottle of granules.
      g.globalCompositeOperation = "source-atop";
      for (let i = 0; i < 60; i++) {
        const a = hash(ti * 97 + i) * Math.PI * 2;
        const d = Math.sqrt(hash(ti * 31 + i)) * r * 0.9;
        const br = r * (0.08 + hash(i + ti) * 0.12);
        const blob = g.createRadialGradient(
          r + Math.cos(a) * d,
          r + Math.sin(a) * d,
          0,
          r + Math.cos(a) * d,
          r + Math.sin(a) * d,
          br,
        );
        const col = shade(rgb, hash(i * 7 + ti) < 0.5 ? 0.35 : -0.12);
        blob.addColorStop(0, css(col, 0.09));
        blob.addColorStop(1, css(col, 0));
        g.fillStyle = blob;
        g.fillRect(0, 0, r * 2, r * 2);
      }
      return c;
    });
  };

  const limb = (g: Ctx2D, r: number, k = 0.5) => {
    const dark = g.createRadialGradient(r * 0.9, r * 0.9, r * 0.35, r, r, r);
    dark.addColorStop(0, "rgba(0,0,0,0)");
    dark.addColorStop(0.75, `rgba(0,0,8,${k * 0.25})`);
    dark.addColorStop(1, `rgba(0,0,8,${k})`);
    g.fillStyle = dark;
    g.fillRect(0, 0, r * 2, r * 2);
  };

  const giant = (look: number, radius: number, seed: number) => {
    const r = bucket(radius);
    const set = GIANT_LOOKS[look % GIANT_LOOKS.length]!;
    return get(`j${look % GIANT_LOOKS.length}:${r}:${seed % 3}`, () => {
      const { c, g } = square(r);
      g.save();
      g.beginPath();
      g.arc(r, r, r * 0.985, 0, Math.PI * 2);
      g.clip();
      g.fillStyle = css(set[0]!);
      g.fillRect(0, 0, r * 2, r * 2);
      // Bands across, of uneven width, some with a wavy edge.
      const bands = 9 + (seed % 4);
      let y = 0;
      for (let i = 0; i < bands; i++) {
        const hgt = ((0.6 + hash(seed * 13 + i) * 0.9) * 2 * r) / bands;
        const col = set[1 + (i % (set.length - 1))]!;
        g.fillStyle = css(col, 0.55 + hash(seed + i * 3) * 0.35);
        g.beginPath();
        const wav = hash(seed * 5 + i) * r * 0.03;
        g.moveTo(0, y);
        for (let x = 0; x <= 2 * r; x += Math.max(2, r / 10)) {
          g.lineTo(x, y + Math.sin(x / (r * 0.18) + i) * wav);
        }
        g.lineTo(2 * r, y + hgt);
        for (let x = 2 * r; x >= 0; x -= Math.max(2, r / 10)) {
          g.lineTo(x, y + hgt + Math.sin(x / (r * 0.21) + i * 2) * wav);
        }
        g.closePath();
        g.fill();
        y += hgt * (0.9 + hash(seed * 3 + i) * 0.3);
        if (y > 2 * r) break;
      }
      // A storm or two.
      if (seed % 2 === 0) {
        const sx = r * (0.6 + hash(seed) * 0.8);
        const sy = r * (1.15 + hash(seed + 1) * 0.3);
        g.fillStyle = css(shade(set[2]!, -0.1), 0.8);
        g.beginPath();
        g.ellipse(sx, sy, r * 0.16, r * 0.08, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
      g.save();
      g.beginPath();
      g.arc(r, r, r * 0.985, 0, Math.PI * 2);
      g.clip();
      limb(g, r, 0.55);
      g.restore();
      return c;
    });
  };

  const planet = (look: number, radius: number, seed: number) => {
    const r = bucket(radius);
    const set = PLANET_LOOKS[look % PLANET_LOOKS.length]!;
    return get(`p${look % PLANET_LOOKS.length}:${r}:${seed % 3}`, () => {
      const { c, g } = square(r);
      g.save();
      g.beginPath();
      g.arc(r, r, r * 0.97, 0, Math.PI * 2);
      g.clip();
      g.fillStyle = css(set[0]!);
      g.fillRect(0, 0, r * 2, r * 2);
      // Land or darker ground in blobs.
      for (let i = 0; i < 14; i++) {
        const a = hash(seed * 41 + i) * Math.PI * 2;
        const d = Math.sqrt(hash(seed * 17 + i)) * r * 0.95;
        const br = r * (0.12 + hash(seed * 5 + i) * 0.3);
        g.fillStyle = css(set[1]!, 0.7 + hash(i + seed) * 0.3);
        g.beginPath();
        g.ellipse(r + Math.cos(a) * d, r + Math.sin(a) * d, br, br * 0.7, a, 0, Math.PI * 2);
        g.fill();
      }
      // Wisps of cloud or frost.
      g.strokeStyle = css(set[2]!, 0.5);
      g.lineCap = "round";
      for (let i = 0; i < 6; i++) {
        const y = r * (0.3 + hash(seed * 9 + i) * 1.4);
        g.lineWidth = Math.max(1, r * (0.05 + hash(seed + i * 2) * 0.07));
        g.beginPath();
        const x0 = r * hash(seed * 3 + i) * 1.2;
        g.moveTo(x0, y);
        g.quadraticCurveTo(
          x0 + r * 0.4,
          y - r * 0.12,
          x0 + r * (0.6 + hash(i) * 0.6),
          y + r * 0.05,
        );
        g.stroke();
      }
      // Polar caps.
      g.fillStyle = css(set[2]!, 0.55);
      g.beginPath();
      g.ellipse(r, 0, r * 0.7, r * 0.2, 0, 0, Math.PI * 2);
      g.ellipse(r, 2 * r, r * 0.6, r * 0.16, 0, 0, Math.PI * 2);
      g.fill();
      limb(g, r, 0.5);
      g.restore();
      // A thin atmosphere at the rim.
      g.strokeStyle = css(shade(set[0]!, 0.6), 0.35);
      g.lineWidth = Math.max(1, r * 0.05);
      g.beginPath();
      g.arc(r, r, r * 0.96, 0, Math.PI * 2);
      g.stroke();
      return c;
    });
  };

  const rock = (look: number, radius: number, seed: number) => {
    const r = bucket(radius);
    const set = ROCK_LOOKS[look % ROCK_LOOKS.length]!;
    return get(`r${look % ROCK_LOOKS.length}:${r}:${seed % 4}`, () => {
      const { c, g } = square(r);
      // Lumpy outline.
      g.beginPath();
      const n = 14;
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        const k = 0.8 + hash(seed * 23 + (i % n)) * 0.18;
        const x = r + Math.cos(a) * r * k;
        const y = r + Math.sin(a) * r * k;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
      g.save();
      g.clip();
      const base = g.createRadialGradient(r * 0.75, r * 0.7, r * 0.1, r, r, r);
      base.addColorStop(0, css(shade(set[0]!, 0.25)));
      base.addColorStop(1, css(set[1]!));
      g.fillStyle = base;
      g.fillRect(0, 0, r * 2, r * 2);
      for (let i = 0; i < 6; i++) {
        const a = hash(seed * 31 + i) * Math.PI * 2;
        const d = Math.sqrt(hash(seed * 11 + i)) * r * 0.6;
        const cr = r * (0.1 + hash(seed * 7 + i) * 0.14);
        g.fillStyle = css(shade(set[1]!, -0.3), 0.7);
        g.beginPath();
        g.arc(r + Math.cos(a) * d, r + Math.sin(a) * d, cr, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
      return c;
    });
  };

  const shadow = (radius: number) => {
    const r = bucket(radius);
    return get(`d${r}`, () => {
      const { c, g } = square(r);
      g.save();
      g.beginPath();
      g.arc(r, r, r, 0, Math.PI * 2);
      g.clip();
      const grad = g.createLinearGradient(0, 0, 2 * r, 0);
      grad.addColorStop(0, "rgba(255,248,235,0.12)");
      grad.addColorStop(0.42, "rgba(0,0,6,0)");
      grad.addColorStop(0.62, "rgba(0,0,6,0.55)");
      grad.addColorStop(0.8, "rgba(0,0,6,0.86)");
      grad.addColorStop(1, "rgba(0,0,6,0.93)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 2 * r, 2 * r);
      g.restore();
      return c;
    });
  };

  const hole = (radius: number) => {
    const r = bucket(radius);
    return get(`h${r}`, () => {
      // Drawn at four times the horizon: a lensed glow, the photon ring, the black horizon.
      const R = r * 4;
      const { c, g } = square(R);
      const halo = g.createRadialGradient(R, R, r * 0.9, R, R, R);
      halo.addColorStop(0, "rgba(255,226,190,0.0)");
      halo.addColorStop(0.18, "rgba(255,214,170,0.55)");
      halo.addColorStop(0.3, "rgba(200,170,255,0.16)");
      halo.addColorStop(0.6, "rgba(120,110,200,0.05)");
      halo.addColorStop(1, "rgba(80,80,160,0)");
      g.fillStyle = halo;
      g.fillRect(0, 0, 2 * R, 2 * R);
      g.strokeStyle = "rgba(255,236,210,0.9)";
      g.lineWidth = Math.max(1, r * 0.12);
      g.beginPath();
      g.arc(R, R, r * 1.12, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = "#000";
      g.beginPath();
      g.arc(R, R, r, 0, Math.PI * 2);
      g.fill();
      return c;
    });
  };

  const disc = (radius: number) => {
    const r = glowBucket(radius);
    return get(`a${r}`, () => {
      const { c, g } = square(r);
      // Hot inside, cooling outwards, with streaks so its turning shows.
      const grad = g.createRadialGradient(r, r, r * 0.2, r, r, r);
      grad.addColorStop(0, "rgba(255,255,255,0)");
      grad.addColorStop(0.22, "rgba(235,240,255,0.95)");
      grad.addColorStop(0.35, "rgba(255,214,150,0.7)");
      grad.addColorStop(0.6, "rgba(255,130,60,0.3)");
      grad.addColorStop(1, "rgba(160,40,20,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 2 * r, 2 * r);
      g.lineCap = "round";
      for (let i = 0; i < 26; i++) {
        const rad = r * (0.25 + hash(i * 3) * 0.6);
        const a = hash(i * 7) * Math.PI * 2;
        g.strokeStyle = `rgba(255,${200 + Math.round(hash(i) * 55)},${150 + Math.round(hash(i + 9) * 80)},${0.25 + hash(i * 5) * 0.3})`;
        g.lineWidth = Math.max(1, r * (0.012 + hash(i * 11) * 0.02));
        g.beginPath();
        g.arc(r, r, rad, a, a + 0.6 + hash(i * 13) * 1.4);
        g.stroke();
      }
      return c;
    });
  };

  return {
    glow,
    corona,
    star,
    giant,
    planet,
    rock,
    shadow,
    hole,
    disc,
    clear: () => cache.clear(),
  };
};
