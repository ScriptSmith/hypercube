/**
 * Drawing one ring: a dark band on a `Strip` with lit dots for letters, a soft glow, chaser
 * lamps along its edges and a sparkle where new words appear, copied onto the feed each frame.
 *
 * The tape is drawn in tiles, each rendered once when it first comes into view and dropped when
 * it leaves, so memory stays at about one ring's worth whatever the messages say. A tile's
 * letters are drawn small, one canvas pixel per dot, then blown up and cut into round dots, so
 * each dot is lit by how much of a letter covers it, as on a real sign. Dots sit on a grid fixed
 * to the tape, and the unlit dots behind them crawl with it.
 */
import { createStrip, type SphereMap, type Strip, wrapOffsets } from "../../core/sphere";
import type { Rng, SphereInfo } from "../../core/types";
import { createRingModel, type Piece, type RingModel } from "./ring";
import type { RingSpec } from "./rings";
import type { Line, Schedule } from "./schedule";
import type { Style } from "./styles";

const FONT = "system-ui, sans-serif";
/** Dot rows in a capital letter. */
const DOTS_PER_LETTER = 11;
/** Below this many px a dot can't be seen as one, so letters are drawn smooth. */
const MIN_DOT_PX = 3;
const TILE_TARGET_PX = 480;
const SMOOTH_TILE_PX = 256;
/** Spare tile canvases kept for reuse; the rest go to the garbage collector. */
const POOL_MAX = 8;
const SPARKLES_MAX = 32;
const SPARKLES_PER_S = 14;
/** Lamp spacing along the edges, in letter heights, and how much faster the chase runs. */
const LAMP_SPACING = 0.45;
const CHASE_RATE = 1.6;

export interface RingViewOptions {
  spec: RingSpec;
  sphere: SphereInfo;
  /** The feed canvas's width in px. */
  feedWidth: number;
  style: Style;
  schedule: Schedule;
  now(): number;
  rng: Rng;
  /** Show time when the ring is built, s. */
  startS: number;
}

export interface RingView {
  readonly spec: RingSpec;
  readonly model: RingModel;
  readonly strip: Strip;
  readonly canvas: HTMLCanvasElement;
  /** Letter height and dot spacing in band px, and whether letters are drawn as dots. */
  readonly letterPx: number;
  readonly pitch: number;
  readonly dots: boolean;
  /** Seconds for the words to go once round. */
  readonly loopS: number;
  /** Tiles held now. */
  tiles(): number;
  update(t: number, dt: number): void;
  draw(): void;
  /** Copy the band onto the feed picture behind `g`. */
  paint(g: CanvasRenderingContext2D, map: SphereMap): void;
  dispose(): void;
}

const canvas2d = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D | null] => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return [c, c.getContext("2d")];
};

const setSpacing = (g: CanvasRenderingContext2D, px: number) => {
  // Not in every browser; plain spacing is fine where it isn't.
  if ("letterSpacing" in g) (g as { letterSpacing: string }).letterSpacing = `${px}px`;
};

/** Cap height of the font per px of font size, measured once. */
let capRatio = 0;
const capPerPx = (): number => {
  if (capRatio > 0) return capRatio;
  const [, g] = canvas2d(4, 4);
  if (g) {
    g.font = `700 100px ${FONT}`;
    const m = g.measureText("H");
    if (m.actualBoundingBoxAscent > 10) capRatio = m.actualBoundingBoxAscent / 100;
  }
  return capRatio || 0.71;
};

const starPath = (g: CanvasRenderingContext2D, cx: number, cy: number, r: number) => {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    const x = cx + rr * Math.cos(a);
    const y = cy + rr * Math.sin(a);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
};

const dotPattern = (pitch: number, color: string): HTMLCanvasElement => {
  const [c, g] = canvas2d(pitch, pitch);
  if (g) {
    g.fillStyle = color;
    g.beginPath();
    g.arc(pitch / 2, pitch / 2, pitch * 0.4, 0, Math.PI * 2);
    g.fill();
  }
  return c;
};

export const createRingView = (o: RingViewOptions): RingView => {
  const { spec, style } = o;
  const cos = Math.cos(spec.centre);
  // Letters a dot grid apart; the strip's width a whole number of dots, so the grid closes.
  const letterAt = (w: number) => (spec.letterM * w) / (2 * Math.PI * o.sphere.radius * cos);
  const wantWidth = Math.max(256, o.feedWidth * cos);
  const roughPitch = Math.round(letterAt(wantWidth) / DOTS_PER_LETTER);
  const dots = roughPitch >= MIN_DOT_PX;
  const pitch = dots ? roughPitch : 1;
  const W = pitch * Math.max(1, Math.round(wantWidth / pitch));
  const strip = createStrip(o.sphere, W, spec.top, spec.bottom);
  const H = Math.max(8, Math.ceil(strip.height));
  const L = letterAt(W);
  const fontPx = L / capPerPx();
  const font = `700 ${fontPx}px ${FONT}`;
  const capTop = (H - 1.3 * L) / 2;
  const baseline = capTop + L;
  const pad = 0.45 * L;
  const glowR = Math.max(1, 0.18 * L);
  const tileW = dots ? pitch * Math.max(8, Math.round(TILE_TARGET_PX / pitch)) : SMOOTH_TILE_PX;
  const speed = (spec.speedM * strip.perMetre) / cos;

  const [canvas, g] = canvas2d(W, H);
  const [measureCanvas, mg] = canvas2d(4, 4);
  if (mg) {
    mg.font = font;
    setSpacing(mg, 0.04 * fontPx);
  }
  const measure = (line: Line) =>
    (mg ? mg.measureText(line.text).width : line.text.length * 0.6 * fontPx) + 2 * pad;

  const model = createRingModel({
    crawl: { width: W, speed, drift: W / spec.printerTurnS, x0: strip.x(spec.printerLon) },
    pitch,
    lookahead: tileW + pitch,
    schedule: o.schedule,
    measure,
    starWidth: 1.6 * L,
    now: o.now,
    startS: o.startS,
  });

  // Letters drawn one px per dot, with spare columns either side so the glow and the edge dots
  // of a tile see their neighbours.
  const margin = dots ? Math.ceil((2 * glowR) / pitch) + 2 : 0;
  const rows = Math.ceil(H / pitch);
  const [small, sg] = dots ? canvas2d(tileW / pitch + 2 * margin, rows) : ([null, null] as const);
  const [scratch, xg] = dots ? canvas2d(tileW, H) : ([null, null] as const);
  const mask = dots ? dotPattern(pitch, "#fff") : null;
  const maskFill = mask && xg ? xg.createPattern(mask, "repeat") : null;
  const unlitTile = dots ? dotPattern(pitch, style.unlit) : null;
  const unlitFill = unlitTile && g ? g.createPattern(unlitTile, "repeat") : null;

  const cache = new Map<string, HTMLCanvasElement>();
  const pool: HTMLCanvasElement[] = [];
  const used = new Set<string>();

  const colourOf = (p: Piece) =>
    p.kind === "star" ? style.star : (style.letters[p.line.n % style.letters.length] ?? "#fff");

  /** Draw a piece in item px, the item's left edge at x = 0. */
  const drawPiece = (c: CanvasRenderingContext2D, p: Piece, width: number) => {
    c.fillStyle = colourOf(p);
    if (p.kind === "line") {
      c.font = font;
      setSpacing(c, 0.04 * fontPx);
      c.textBaseline = "alphabetic";
      c.textAlign = "left";
      c.fillText(p.line.text, pad, baseline);
    } else {
      starPath(c, width / 2, capTop + L / 2, 0.42 * L);
      c.fill();
    }
  };

  const renderTile = (item: { start: number; width: number; data: Piece }, k: number) => {
    const tile = pool.pop() ?? canvas2d(tileW, H)[0];
    const tg = tile.getContext("2d");
    if (!tg) return tile;
    tg.setTransform(1, 0, 0, 1, 0, 0);
    tg.clearRect(0, 0, tileW, H);
    const offset = k * tileW;
    if (!dots || !sg || !xg || !small || !scratch) {
      tg.save();
      tg.translate(-offset, 0);
      tg.shadowColor = colourOf(item.data);
      tg.shadowBlur = glowR;
      drawPiece(tg, item.data, item.width);
      tg.restore();
      return tile;
    }
    sg.setTransform(1, 0, 0, 1, 0, 0);
    sg.clearRect(0, 0, small.width, small.height);
    sg.setTransform(1 / pitch, 0, 0, 1 / pitch, margin - offset / pitch, 0);
    drawPiece(sg, item.data, item.width);
    const sx = -margin * pitch;
    const sw = small.width * pitch;
    const sh = rows * pitch;
    if (style.glow > 0) {
      tg.filter = `blur(${glowR}px)`;
      tg.globalAlpha = style.glow;
      tg.imageSmoothingEnabled = true;
      tg.drawImage(small, sx, 0, sw, sh);
      tg.filter = "none";
      tg.globalAlpha = 1;
    }
    xg.globalCompositeOperation = "source-over";
    xg.clearRect(0, 0, tileW, H);
    xg.imageSmoothingEnabled = false;
    xg.drawImage(small, sx, 0, sw, sh);
    if (maskFill) {
      xg.globalCompositeOperation = "destination-in";
      xg.fillStyle = maskFill;
      xg.fillRect(0, 0, tileW, H);
      xg.globalCompositeOperation = "source-over";
    }
    tg.drawImage(scratch, 0, 0);
    return tile;
  };

  const sparkles: { dx: number; row: number; born: number; life: number }[] = [];
  let t = 0;
  let spawn = 0;

  const lampCount = Math.max(12, Math.round(W / (LAMP_SPACING * L)));
  const lampR = Math.max(0.75, 0.06 * L);

  const drawLamps = (c: CanvasRenderingContext2D) => {
    const step = W / lampCount;
    const shift = (CHASE_RATE * speed * t) / step;
    for (const y of [capTop * 0.5, H - capTop * 0.5]) {
      c.globalAlpha = 1;
      c.fillStyle = style.lampOff;
      c.beginPath();
      for (let i = 0; i < lampCount; i++) {
        const x = (i + 0.5) * step;
        c.moveTo(x + lampR, y);
        c.arc(x, y, lampR, 0, Math.PI * 2);
      }
      c.fill();
      c.fillStyle = style.lampOn;
      for (let i = 0; i < lampCount; i++) {
        const wave = 0.5 + 0.5 * Math.cos(((i + shift) * 2 * Math.PI) / 3);
        const b = wave * wave;
        if (b < 0.06) continue;
        c.globalAlpha = b;
        c.beginPath();
        c.arc((i + 0.5) * step, y, lampR, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.globalAlpha = 1;
  };

  const drawPrinter = (c: CanvasRenderingContext2D) => {
    const px = model.printer();
    const a = 1.3 * L;
    for (const dx of wrapOffsets(px - a, px + a, W)) {
      const x = px + dx;
      const fade = c.createLinearGradient(x - a, 0, x + a, 0);
      fade.addColorStop(0, "rgba(0,0,0,0)");
      fade.addColorStop(0.3, style.band);
      fade.addColorStop(0.7, style.band);
      fade.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = fade;
      c.fillRect(x - a, capTop * 0.9, 2 * a, H - 1.8 * capTop);
      // A thin slit of light that the words come out of.
      const w = 0.3 * L;
      const glow = c.createLinearGradient(x - w, 0, x + w, 0);
      glow.addColorStop(0, "rgba(0,0,0,0)");
      glow.addColorStop(0.5, style.printer);
      glow.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = glow;
      c.globalAlpha = 0.35;
      c.fillRect(x - w, capTop, 2 * w, L * 1.3);
      c.globalAlpha = 0.8;
      c.fillRect(x - w * 0.12, capTop, w * 0.24, L * 1.3);
      c.globalAlpha = 1;
    }
    c.fillStyle = style.printer;
    const r = dots ? pitch * 0.4 : Math.max(1, 0.05 * L);
    for (const s of sparkles) {
      const age = (t - s.born) / s.life;
      if (age < 0 || age > 1) continue;
      c.globalAlpha = Math.sin(Math.PI * age);
      const x = px + s.dx;
      const y = s.row;
      for (const dx of wrapOffsets(x - r, x + r, W)) {
        c.beginPath();
        c.arc(x + dx, y, r, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.globalAlpha = 1;
  };

  const loopS = W / speed;

  return {
    spec,
    model,
    strip,
    canvas,
    letterPx: L,
    pitch,
    dots,
    loopS,
    tiles: () => cache.size,
    update(next, dt) {
      t = next;
      model.advance(t);
      spawn += dt * SPARKLES_PER_S;
      while (spawn >= 1) {
        spawn -= 1;
        if (sparkles.length >= SPARKLES_MAX) sparkles.shift();
        const row = dots
          ? (Math.floor((capTop + o.rng.next() * L * 1.2) / pitch) + 0.5) * pitch
          : capTop + o.rng.next() * L * 1.2;
        sparkles.push({
          dx: (o.rng.next() - 0.5) * 1.1 * L,
          row,
          born: t,
          life: o.rng.range(0.45, 0.9),
        });
      }
    },
    draw() {
      if (!g) return;
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
      g.fillStyle = style.band;
      g.fillRect(0, 0, W, H);
      const head = model.head();
      const px = model.printer();
      if (unlitFill) {
        const phase = (((px - head) % pitch) + pitch) % pitch;
        unlitFill.setTransform(new DOMMatrix([1, 0, 0, 1, phase, 0]));
        g.fillStyle = unlitFill;
        g.fillRect(0, capTop * 0.9, W, H - 1.8 * capTop);
      }
      used.clear();
      const lo = head - W;
      for (const { item } of model.shown()) {
        const a = Math.max(item.start, lo);
        const b = Math.min(item.start + item.width, head);
        const k0 = Math.floor((a - item.start) / tileW);
        const k1 = Math.floor((b - item.start - 1e-6) / tileW);
        for (let k = k0; k <= k1; k++) {
          const ts = item.start + k * tileW;
          const va = Math.max(ts, a);
          const vb = Math.min(ts + tileW, b);
          if (vb <= va) continue;
          const key = `${item.id}:${k}`;
          let tile = cache.get(key);
          if (!tile) {
            tile = renderTile(item, k);
            cache.set(key, tile);
          }
          used.add(key);
          const x = px - (head - va);
          const w = vb - va;
          for (const dx of wrapOffsets(x, x + w, W)) {
            g.drawImage(tile, va - ts, 0, w, H, x + dx, 0, w, H);
          }
        }
      }
      for (const [key, tile] of cache) {
        if (used.has(key)) continue;
        cache.delete(key);
        if (pool.length < POOL_MAX) pool.push(tile);
      }
      drawPrinter(g);
      drawLamps(g);
      g.fillStyle = style.rim;
      const rim = Math.max(1, 0.025 * L);
      g.fillRect(0, 0, W, rim);
      g.fillRect(0, H - rim, W, rim);
    },
    paint(fg, map) {
      const y0 = Math.max(0, Math.floor(map.y(strip.top)));
      const y1 = Math.min(map.height, Math.ceil(map.y(strip.bottom)));
      if (y1 <= y0) return;
      fg.clearRect(0, y0, map.width, y1 - y0);
      strip.draw(fg, canvas, map);
    },
    dispose() {
      cache.clear();
      pool.length = 0;
      for (const c of [canvas, measureCanvas, small, scratch, mask, unlitTile]) {
        if (c) c.width = c.height = 0;
      }
    },
  };
};
