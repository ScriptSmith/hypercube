import { createRng } from "../../core/rng";
import { displayFor } from "../../core/venue";
import type { AppManifest, FrameKind, Rng } from "../../core/types";

type Category = AppManifest["category"];

export const ART_WIDTH = 320;
export const ART_HEIGHT = 200;
const W = ART_WIDTH;
const H = ART_HEIGHT;

/** Taken from the runtime's player colours, split warm for games and cool for visuals. */
const TONES: Record<Category, readonly string[]> = {
  game: ["#ffcc33", "#ff8c1a", "#ff5a7a", "#3fa9f5"],
  visual: ["#5ce0e0", "#3fa9f5", "#9b8cff", "#e05ce0"],
  tool: ["#38d39f", "#f5e663", "#5ce0e0", "#8a94a8"],
};

const BACKGROUND: Record<Category, string> = {
  game: "#15120f",
  visual: "#0c1120",
  tool: "#0d1513",
};

const r1 = (n: number): string => String(Math.round(n * 10) / 10);

type Motif = (rng: Rng, tones: readonly string[]) => string;

const orbits: Motif = (rng, t) => {
  const cx = rng.range(0.3, 0.7) * W;
  const cy = rng.range(0.35, 0.65) * H;
  const rings = 4 + rng.int(3);
  let out = "";
  let radius = rng.range(14, 22);
  for (let i = 0; i < rings; i++) {
    out += `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(radius)}" fill="none" stroke="${t[i % 2]}" stroke-width="${r1(rng.range(1.5, 3))}" opacity="${r1(rng.range(0.45, 0.9))}"/>`;
    if (i > 0 && rng.next() < 0.6) {
      const a = rng.range(0, Math.PI * 2);
      out += `<circle cx="${r1(cx + Math.cos(a) * radius)}" cy="${r1(cy + Math.sin(a) * radius)}" r="${r1(rng.range(4, 9))}" fill="${t[2 + rng.int(2)]}"/>`;
    }
    radius += rng.range(14, 24);
  }
  return out;
};

const bars: Motif = (rng, t) => {
  const n = 10 + rng.int(7);
  const bw = W / n;
  let h = rng.range(0.3, 0.7);
  let out = "";
  for (let i = 0; i < n; i++) {
    h = Math.min(0.88, Math.max(0.12, h + rng.range(-0.18, 0.18)));
    const color = h > 0.55 ? t[0] : t[1];
    out += `<rect x="${r1(i * bw + 3)}" y="${r1(H - h * H)}" width="${r1(bw - 6)}" height="${r1(h * H + 4)}" rx="3" fill="${color}" opacity="${r1(0.55 + h * 0.45)}"/>`;
  }
  const y = rng.range(0.2, 0.4) * H;
  out += `<line x1="0" y1="${r1(y)}" x2="${W}" y2="${r1(y)}" stroke="${t[2]}" stroke-width="2" stroke-dasharray="6 6"/>`;
  return out;
};

const dots: Motif = (rng, t) => {
  const cols = 14;
  const rows = 9;
  const fx = rng.range(0.3, 0.8);
  const fy = rng.range(0.3, 0.8);
  const phase = rng.range(0, Math.PI * 2);
  let out = "";
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const v = 0.5 + 0.5 * Math.sin(x * fx + y * fy + phase + Math.sin(y * 0.7) * 1.5);
      const color = v > 0.66 ? t[0] : v > 0.33 ? t[1] : t[3];
      const cx = (x + 0.5) * (W / cols);
      const cy = (y + 0.5) * (H / rows);
      out += `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(1.5 + v * 6.5)}" fill="${color}" opacity="${r1(0.35 + v * 0.65)}"/>`;
    }
  }
  return out;
};

const waves: Motif = (rng, t) => {
  const lines = 5 + rng.int(3);
  const freq = rng.range(0.018, 0.04);
  const shift = rng.range(0.3, 0.9);
  const amp = rng.range(12, 26);
  let out = "";
  for (let i = 0; i < lines; i++) {
    const base = ((i + 1) / (lines + 1)) * H;
    let d = "";
    for (let x = -8; x <= W + 8; x += 8) {
      const y = base + amp * Math.sin(x * freq + i * shift);
      d += `${d ? "L" : "M"}${r1(x)} ${r1(y)}`;
    }
    out += `<path d="${d}" fill="none" stroke="${t[i % 3]}" stroke-width="3.5" stroke-linecap="round" opacity="${r1(0.5 + (i / lines) * 0.5)}"/>`;
  }
  return out;
};

const truchet: Motif = (rng, t) => {
  const c = 40;
  let out = "";
  for (let y = 0; y < H; y += c) {
    for (let x = 0; x < W; x += c) {
      const h = c / 2;
      const d =
        rng.next() < 0.5
          ? `M${x + h} ${y}A${h} ${h} 0 0 1 ${x} ${y + h}M${x + c} ${y + h}A${h} ${h} 0 0 0 ${x + h} ${y + c}`
          : `M${x + h} ${y}A${h} ${h} 0 0 0 ${x + c} ${y + h}M${x} ${y + h}A${h} ${h} 0 0 1 ${x + h} ${y + c}`;
      const color = rng.next() < 0.18 ? t[1] : t[0];
      out += `<path d="${d}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" opacity="0.85"/>`;
    }
  }
  return out;
};

const mosaic: Motif = (rng, t) => {
  const c = 40;
  const fill = rng.range(0.35, 0.6);
  let out = "";
  for (let y = 0; y < H; y += c) {
    for (let x = 0; x < W; x += c) {
      // Each cell splits on one diagonal; each half is coloured or left dark.
      const flip = rng.next() < 0.5;
      const halves = flip
        ? [`${x},${y} ${x + c},${y} ${x},${y + c}`, `${x + c},${y} ${x + c},${y + c} ${x},${y + c}`]
        : [
            `${x},${y} ${x + c},${y} ${x + c},${y + c}`,
            `${x},${y} ${x + c},${y + c} ${x},${y + c}`,
          ];
      for (const points of halves) {
        if (rng.next() > fill) continue;
        const color = t[rng.int(3)];
        out += `<polygon points="${points}" fill="${color}" opacity="${r1(rng.range(0.3, 0.9))}"/>`;
      }
    }
  }
  return out;
};

const rays: Motif = (rng, t) => {
  const ox = rng.pick([0.15, 0.5, 0.85]) * W;
  const oy = H + 10;
  const n = 14 + rng.int(9);
  let out = "";
  for (let i = 0; i < n; i++) {
    if (i % 2) continue;
    const a0 = Math.PI + (i / n) * Math.PI;
    const a1 = Math.PI + ((i + 1) / n) * Math.PI;
    const len = 420;
    out += `<polygon points="${r1(ox)},${r1(oy)} ${r1(ox + Math.cos(a0) * len)},${r1(oy + Math.sin(a0) * len)} ${r1(ox + Math.cos(a1) * len)},${r1(oy + Math.sin(a1) * len)}" fill="${t[0]}" opacity="${r1(rng.range(0.25, 0.6))}"/>`;
  }
  out += `<circle cx="${r1(ox)}" cy="${r1(oy)}" r="${r1(rng.range(40, 60))}" fill="${t[1]}"/>`;
  return out;
};

const frames: Motif = (rng, t) => {
  const n = 4 + rng.int(3);
  let out = "";
  const fw = 52;
  const fh = 92;
  for (let i = 0; i < n; i++) {
    const x = ((i + 0.5) / n) * W - fw / 2 + rng.range(-10, 10);
    const y = H / 2 - fh / 2 + rng.range(-24, 24);
    const rot = rng.range(-12, 12);
    const color = t[i % 3];
    out += `<rect x="${r1(x)}" y="${r1(y)}" width="${fw}" height="${fh}" rx="5" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-width="2.5" transform="rotate(${r1(rot)} ${r1(x + fw / 2)} ${r1(y + fh / 2)})"/>`;
  }
  return out;
};

const MOTIFS: readonly Motif[] = [orbits, bars, dots, waves, truchet, mosaic, rays, frames];

/** A distinctive abstract picture for an app, the same every time for the same id. */
export const appArt = (id: string, category: Category): string => {
  const rng = createRng(`art:${id}`);
  const tones = TONES[category];
  // Rotate the tones per app so two apps with the same motif still differ.
  const offset = rng.int(tones.length);
  const t = tones.map((_, i) => tones[(i + offset) % tones.length] as string);
  const motif = MOTIFS[rng.int(MOTIFS.length)] as Motif;
  const glowX = rng.range(0.2, 0.8) * W;
  const glowY = rng.range(0.2, 0.8) * H;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">` +
    `<rect width="${W}" height="${H}" fill="${BACKGROUND[category]}"/>` +
    `<circle cx="${r1(glowX)}" cy="${r1(glowY)}" r="150" fill="${t[0]}" opacity="0.07"/>` +
    motif(rng, t) +
    `</svg>`
  );
};

/** A ball with its equator and one meridian, `size` px across. */
const sphereGlyph = (size: number): string => {
  const c = size / 2;
  const r = c - 0.6;
  return (
    `<svg class="glyph" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true" focusable="false">` +
    `<circle cx="${r1(c)}" cy="${r1(c)}" r="${r1(r)}" fill="none" stroke="currentColor" stroke-width="1.2"/>` +
    `<ellipse cx="${r1(c)}" cy="${r1(c)}" rx="${r1(r)}" ry="${r1(r * 0.3)}" fill="none" stroke="currentColor" stroke-width="0.8"/>` +
    `<ellipse cx="${r1(c)}" cy="${r1(c)}" rx="${r1(r * 0.4)}" ry="${r1(r)}" fill="none" stroke="currentColor" stroke-width="0.8"/>` +
    `</svg>`
  );
};

/**
 * A small outline of a frame kind at its true aspect, with a seam between merged panels.
 * Screens are dashed: they take no touch. A sphere is a ball, whatever its feed's aspect.
 */
export const kindGlyph = (kind: FrameKind, height = 11, span = kind === "pair" ? 2 : 1): string => {
  if (kind === "sphere") return sphereGlyph(height);
  const { width: vw, height: vh } = displayFor(kind, span);
  const w = Math.round((vw / vh) * height);
  let seams = "";
  for (let i = 1; i < span; i++) {
    const x = Math.round(((w * i) / span) * 10) / 10;
    seams += `<line x1="${x}" y1="1" x2="${x}" y2="${height - 1}" stroke="currentColor" stroke-width="1"/>`;
  }
  const dash = kind === "screen" ? ` stroke-dasharray="2 1.5"` : "";
  return (
    `<svg class="glyph" xmlns="http://www.w3.org/2000/svg" width="${w}" height="${height}" viewBox="0 0 ${w} ${height}" aria-hidden="true" focusable="false">` +
    `<rect x="0.6" y="0.6" width="${w - 1.2}" height="${height - 1.2}" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.2"${dash}/>` +
    seams +
    `</svg>`
  );
};
