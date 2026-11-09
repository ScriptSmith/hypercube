/**
 * Drawing a touch frame with Canvas2D, in two layers: the machinery that never moves (redrawn on
 * resize and when the top strip changes between the frame's own plant and a bank's open sky)
 * and everything that does, every frame. Items, bins and park things are cached as sprites at
 * the current scale, so a frame's draw is mostly drawImage.
 */
import { withAlpha } from "../../core/ui";
import { MAX_PARTICLES } from "./config";
import { BIN_LOOK, type BinKind, ITEMS } from "./items";
import type { Belt, BinSlot, Layout, Line } from "./layout";
import { LEAVE_S, type Park, type ThingKind } from "./park";
import { tracePath } from "./paths";
import { drawBinPicture, drawHand, drawItem, drawThing } from "./pictures";
import type { BinState, Item, RisingBin, WorldEvent } from "./world";

type G = CanvasRenderingContext2D;

const TAU = Math.PI * 2;
const METAL = "#56617a";
const METAL_DARK = "#2b3346";
const RUBBER = "#262c3a";
const GLASS = "rgba(150,195,255,0.13)";
/** A right sort always ticks in green, whatever the bin's colour. */
const TICK = "#7dfc9a";

interface Particle {
  kind: "tick" | "spark" | "puff" | "smoke";
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
}

export interface Ghost {
  x: number;
  y: number;
  alpha: number;
}

export interface FrameView {
  /** Rebuild for a new size or layout. `k` is canvas px per venue px. */
  setup(layout: Layout, cssWidth: number, cssHeight: number, k: number): void;
  /** The top strip: the frame's own plant and park, or a bank's open sky. */
  setTop(own: boolean): void;
  event(e: WorldEvent): void;
  draw(o: {
    items: readonly Item[];
    bins: readonly BinState[];
    rising: readonly RisingBin[];
    park: Park | null;
    clock: number;
    alpha: number;
    dt: number;
    speeds: readonly number[];
    ghosts: readonly Ghost[];
    fallAt(it: Item): { x: number; y: number };
  }): void;
  readonly particles: number;
  dispose(): void;
}

const rr = (g: G, x: number, y: number, w: number, h: number, r: number) => {
  g.beginPath();
  g.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
};

const sprite = (w: number, h: number, draw: (g: G) => void): HTMLCanvasElement => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  const g = c.getContext("2d");
  if (g) draw(g);
  return c;
};

const shade = (hex: string, k: number): string => {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = (v: number) =>
    Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k))));
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
};

export const createFrameView = (root: HTMLElement): FrameView => {
  const make = (z: number) => {
    const c = document.createElement("canvas");
    c.style.cssText = `position:absolute;inset:0;width:100%;height:100%;z-index:${z};`;
    root.append(c);
    return c;
  };
  const backCanvas = make(0);
  const frontCanvas = make(1);
  const back = backCanvas.getContext("2d");
  const g = frontCanvas.getContext("2d");
  let layout: Layout | null = null;
  let k = 1;
  let own = true;
  let itemSprites: HTMLCanvasElement[] = [];
  const binSprites = new Map<string, HTMLCanvasElement>();
  const thingSprites = new Map<ThingKind, HTMLCanvasElement>();
  const particles: Particle[] = [];
  const beltPhase: number[] = [];
  let liftPhase = 0;
  let gear = 0;
  let smokeAt = 0;
  let time = 0;

  const addParticle = (p: Particle) => {
    if (particles.length >= MAX_PARTICLES) particles.shift();
    particles.push(p);
  };

  const buildSprites = () => {
    if (!layout) return;
    const d = layout.d;
    const px = d * 1.2 * k;
    itemSprites = ITEMS.map((it) =>
      sprite(px, px, (s) => {
        s.translate(px / 2, px / 2);
        drawItem(s, it.id, 0, 0, d * k);
      }),
    );
    binSprites.clear();
    for (const slot of layout.bins) {
      const key = `${slot.kind}:${Math.round(slot.w)}:${Math.round(slot.bottom - slot.top)}`;
      if (binSprites.has(key)) continue;
      const h = slot.bottom - slot.top;
      binSprites.set(
        key,
        sprite(slot.w * k, h * k, (s) => {
          s.scale(k, k);
          drawBinBody(s, slot.kind, slot.w, h, slot.wheels);
        }),
      );
    }
    thingSprites.clear();
  };

  const thingSprite = (kind: ThingKind, size: number): HTMLCanvasElement => {
    let s = thingSprites.get(kind);
    if (!s) {
      const px = size * k * 1.15;
      s = sprite(px, px, (c) => {
        c.translate(px / 2, px / 2);
        drawThing(c, kind, 0, (size * k) / 2, size * k);
      });
      thingSprites.set(kind, s);
    }
    return s;
  };

  // ---- Static layer -------------------------------------------------------------------------

  const drawTube = (c: G, pts: { x: number; y: number }[], d: number) => {
    c.beginPath();
    tracePath(c, pts, d * 0.6);
    c.lineCap = "round";
    c.lineJoin = "round";
    c.lineWidth = d * 1.24;
    c.strokeStyle = "rgba(120,160,215,0.45)";
    c.stroke();
    c.lineWidth = d * 1.1;
    c.strokeStyle = "rgba(8,13,26,0.92)";
    c.stroke();
  };

  const drawFunnel = (c: G, line: Line, d: number) => {
    const f = line.inlet;
    c.beginPath();
    c.moveTo(f.x - f.w / 2 - d * 0.08, f.y - d * 0.05);
    c.lineTo(f.x + f.w / 2 + d * 0.08, f.y - d * 0.05);
    c.lineTo(f.x + d * 0.62, f.bottom);
    c.lineTo(f.x - d * 0.62, f.bottom);
    c.closePath();
    const gr = c.createLinearGradient(f.x - f.w / 2, 0, f.x + f.w / 2, 0);
    gr.addColorStop(0, "#3c4760");
    gr.addColorStop(0.5, "#6f7d98");
    gr.addColorStop(1, "#3a445b");
    c.fillStyle = gr;
    c.fill();
    c.lineWidth = d * 0.05;
    c.strokeStyle = "#151b29";
    c.stroke();
  };

  const drawLiftRail = (c: G, line: Line, d: number) => {
    const side = line.liftX >= line.inlet.x ? 1 : -1;
    c.lineCap = "round";
    c.lineJoin = "round";
    c.lineWidth = d * 0.92;
    c.strokeStyle = "rgba(24,31,48,0.9)";
    c.beginPath();
    c.moveTo(line.liftX, line.liftBottom);
    c.lineTo(line.liftX, line.liftTop);
    c.lineTo(line.inlet.x, line.liftTop);
    c.stroke();
    c.lineWidth = d * 0.07;
    c.strokeStyle = METAL;
    for (const off of [-0.44, 0.44]) {
      // Each rail keeps its side round the corner.
      const y = line.liftTop - off * side * d;
      c.beginPath();
      c.moveTo(line.liftX + off * d, line.liftBottom);
      c.lineTo(line.liftX + off * d, y);
      c.lineTo(line.inlet.x, y);
      c.stroke();
    }
  };

  /** A chute from the belt's end down into the foot of the bucket lift. */
  const drawHopper = (c: G, b: Belt, line: Line, d: number) => {
    const x0 = b.end + b.dir * d * 0.15;
    const y0 = b.y - d * 0.05;
    const x1 = line.liftX;
    const y1 = b.y + d * 0.55;
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(x0, y0);
    c.quadraticCurveTo(x1, y0, x1, y1);
    c.lineWidth = d * 0.95;
    c.strokeStyle = "#151b29";
    c.stroke();
    c.lineWidth = d * 0.8;
    c.strokeStyle = METAL_DARK;
    c.stroke();
    c.lineWidth = d * 0.06;
    c.strokeStyle = METAL;
    c.beginPath();
    c.moveTo(x0, y0 + d * 0.4);
    c.quadraticCurveTo(x1 - b.dir * d * 0.4, y0 + d * 0.4, x1 - b.dir * d * 0.4, y1);
    c.stroke();
  };

  const drawBeltFrame = (c: G, b: Belt, d: number) => {
    const t = d * 0.24;
    const x0 = Math.min(b.start, b.end) - (b.dir > 0 ? d * 0.55 : d * 0.2);
    const x1 = Math.max(b.start, b.end) + (b.dir > 0 ? d * 0.2 : d * 0.55);
    rr(c, x0, b.y, x1 - x0, t, t / 2);
    c.fillStyle = RUBBER;
    c.fill();
    c.lineWidth = d * 0.04;
    c.strokeStyle = "#0d111b";
    c.stroke();
    for (const x of [x0 + t / 2, x1 - t / 2]) {
      c.beginPath();
      c.arc(x, b.y + t / 2, t * 0.38, 0, TAU);
      c.fillStyle = METAL;
      c.fill();
    }
    // Brackets into the wall behind.
    c.fillStyle = METAL_DARK;
    for (const f of [0.18, 0.5, 0.82]) {
      const x = x0 + (x1 - x0) * f;
      c.beginPath();
      c.moveTo(x - d * 0.12, b.y + t);
      c.lineTo(x + d * 0.12, b.y + t);
      c.lineTo(x, b.y + t + d * 0.28);
      c.closePath();
      c.fill();
    }
  };

  const drawSky = (c: G, x: number, y: number, w: number, h: number) => {
    const sky = c.createLinearGradient(0, y, 0, y + h);
    sky.addColorStop(0, "#1b3a66");
    sky.addColorStop(1, "#3e6aa0");
    c.fillStyle = sky;
    c.fillRect(x, y, w, h);
  };

  const drawGrass = (c: G, x0: number, x1: number, ground: number, depth: number) => {
    c.fillStyle = "#3f9a46";
    c.fillRect(x0, ground - depth * 0.12, x1 - x0, depth);
    c.fillStyle = "#57b85a";
    c.fillRect(x0, ground - depth * 0.12, x1 - x0, depth * 0.18);
  };

  const drawPlantBuilding = (
    c: G,
    r: { x: number; y: number; width: number; height: number },
    d: number,
  ) => {
    const roofH = Math.min(r.height * 0.22, d * 0.9);
    const teeth = Math.max(2, Math.round(r.width / (roofH * 2.2)));
    const tw = r.width / teeth;
    c.beginPath();
    c.moveTo(r.x, r.y + r.height);
    c.lineTo(r.x, r.y + roofH);
    for (let i = 0; i < teeth; i++) {
      c.lineTo(r.x + tw * i + tw * 0.7, r.y);
      c.lineTo(r.x + tw * (i + 1), r.y + roofH);
    }
    c.lineTo(r.x + r.width, r.y + r.height);
    c.closePath();
    c.fillStyle = "#4a5a78";
    c.fill();
    c.lineWidth = d * 0.05;
    c.strokeStyle = "#1a2133";
    c.stroke();
    // A row of lit windows.
    const ww = Math.min(d * 0.55, r.width / 8);
    const wy = r.y + roofH + (r.height - roofH) * 0.22;
    const wh = (r.height - roofH) * 0.3;
    for (let x = r.x + ww * 0.6; x + ww <= r.x + r.width - ww * 0.4; x += ww * 1.6) {
      rr(c, x, wy, ww, wh, ww * 0.15);
      c.fillStyle = "#ffd977";
      c.fill();
    }
    // Chimneys.
    const cw = Math.min(d * 0.5, r.width * 0.1);
    for (const f of r.width > d * 12 ? [0.12, 0.47, 0.83] : [0.8]) {
      const x = r.x + r.width * f;
      rr(c, x, r.y - roofH * 1.6, cw, roofH * 2, cw * 0.1);
      c.fillStyle = "#6b7896";
      c.fill();
      c.stroke();
      c.fillStyle = "#e2382f";
      c.fillRect(x, r.y - roofH * 1.6 + cw * 0.3, cw, cw * 0.25);
    }
  };

  const chimneys = (): { x: number; y: number }[] => {
    if (!layout) return [];
    const r = layout.plant;
    const roofH = Math.min(r.height * 0.22, layout.d * 0.9);
    const cw = Math.min(layout.d * 0.5, r.width * 0.1);
    const fs = r.width > layout.d * 12 ? [0.12, 0.47, 0.83] : [0.8];
    return fs.map((f) => ({ x: r.x + r.width * f + cw / 2, y: r.y - roofH * 1.6 }));
  };

  const gears = (): { x: number; y: number; r: number }[] => {
    if (!layout) return [];
    const p = layout.plant;
    const rad = Math.min(p.height * 0.22, layout.d * 0.55);
    const y = p.y + p.height - rad * 1.2;
    if (p.width > layout.d * 12) {
      return [0.3, 0.64].map((f) => ({ x: p.x + p.width * f, y, r: rad }));
    }
    return [{ x: p.x + p.width * 0.28, y, r: rad }];
  };

  const drawStatic = () => {
    if (!back || !layout) return;
    const L = layout;
    const d = L.d;
    back.setTransform(1, 0, 0, 1, 0, 0);
    back.clearRect(0, 0, backCanvas.width, backCanvas.height);
    back.setTransform(k, 0, 0, k, 0, 0);
    const bg = back.createLinearGradient(0, 0, 0, L.height);
    bg.addColorStop(0, "#0d1426");
    bg.addColorStop(0.6, "#111a30");
    bg.addColorStop(1, "#0a0f1c");
    back.fillStyle = bg;
    back.fillRect(0, 0, L.width, L.height);
    // A faint tiled wall behind the machinery.
    back.strokeStyle = "rgba(255,255,255,0.025)";
    back.lineWidth = 2;
    for (let y = L.kind === "wall" ? L.plant.y + L.plant.height : 0; y < L.height; y += d * 1.2) {
      back.beginPath();
      back.moveTo(0, y);
      back.lineTo(L.width, y);
      back.stroke();
    }

    if (L.kind === "wall") {
      drawSky(back, 0, 0, L.width, L.plant.y + L.plant.height * 0.6);
      drawGrass(back, 0, L.width, L.ground, d * 0.6);
      drawPlantBuilding(back, L.plant, d);
      for (const line of L.lines) {
        if (!line.cascade) continue;
        back.beginPath();
        tracePath(back, [...line.cascade.pts], d * 0.4);
        back.lineCap = "round";
        back.lineJoin = "round";
        back.lineWidth = d * 1.05;
        back.strokeStyle = "#151b29";
        back.stroke();
        back.lineWidth = d * 0.9;
        back.strokeStyle = "#3b465e";
        back.stroke();
      }
    } else if (own) {
      const top = L.ground + d * 0.12;
      drawSky(back, 0, 0, L.width, top);
      drawGrass(back, 0, L.width, L.ground, d * 0.22);
      drawPlantBuilding(back, L.plant, d);
      for (const line of L.lines) {
        back.fillStyle = "#3b465e";
        back.fillRect(
          line.spout.x - d * 0.4,
          L.plant.y + L.plant.height - 2,
          d * 0.8,
          line.spout.y - L.plant.y - L.plant.height + 4,
        );
        back.strokeStyle = "#151b29";
        back.lineWidth = d * 0.04;
        back.strokeRect(
          line.spout.x - d * 0.4,
          L.plant.y + L.plant.height - 2,
          d * 0.8,
          line.spout.y - L.plant.y - L.plant.height + 4,
        );
      }
    } else {
      // A bank's screen drops items in from above: show the open sky at each inlet.
      for (const line of L.lines) {
        const gr = back.createLinearGradient(0, 0, 0, line.inlet.y);
        gr.addColorStop(0, "rgba(120,170,255,0.18)");
        gr.addColorStop(1, "rgba(120,170,255,0)");
        back.fillStyle = gr;
        back.fillRect(line.inlet.x - line.inlet.w / 2, 0, line.inlet.w, line.inlet.y);
      }
    }

    for (const line of L.lines) {
      drawLiftRail(back, line, d);
      for (const id of line.belts) {
        const b = L.belts[id]!;
        drawTube(back, [...b.tube.pts], d);
      }
      drawFunnel(back, line, d);
      for (const id of line.belts) {
        const b = L.belts[id]!;
        drawHopper(back, b, line, d);
        drawBeltFrame(back, b, d);
      }
    }
    for (const slot of L.bins) {
      // The floor or wall shelf the bin stands on.
      back.fillStyle = "rgba(0,0,0,0.35)";
      back.beginPath();
      back.ellipse(slot.x, slot.bottom, slot.w * 0.5, d * 0.08, 0, 0, TAU);
      back.fill();
      if (!slot.wheels) {
        back.fillStyle = METAL_DARK;
        back.fillRect(slot.x - slot.w * 0.55, slot.bottom, slot.w * 1.1, d * 0.1);
      }
    }
    back.fillStyle = "#070a12";
    back.fillRect(0, L.floor, L.width, L.height - L.floor);
  };

  // ---- Dynamic layer -------------------------------------------------------------------------

  const binKey = (slot: BinSlot) =>
    `${slot.kind}:${Math.round(slot.w)}:${Math.round(slot.bottom - slot.top)}`;

  /** The open lid stands up behind the bin, short enough to stay under the belt above. */
  const lidHeight = (slot: BinSlot) =>
    Math.min(slot.w * (slot.wheels ? 0.4 : 0.28), (slot.bottom - slot.top) * 0.3);

  const drawLid = (bin: BinState, x: number, top: number) => {
    if (!g) return;
    const slot = bin.slot;
    const look = BIN_LOOK[slot.kind];
    const h = Math.max(slot.w * 0.06, lidHeight(slot) * bin.lid);
    const w = slot.w * 0.98;
    if (bin.glow > 0) {
      const a = Math.min(1, bin.glow / 0.4) * (0.55 + 0.45 * Math.sin(time * 10));
      g.save();
      g.shadowColor = look.glow;
      g.shadowBlur = slot.w * 0.18 * k;
      rr(g, x - w / 2, top - h, w, h, slot.w * 0.05);
      g.fillStyle = withAlpha(look.glow, a);
      g.fill();
      g.restore();
    }
    rr(g, x - w / 2, top - h, w, h + slot.w * 0.02, slot.w * 0.05);
    g.fillStyle = look.lid;
    g.fill();
    g.lineWidth = slot.w * 0.012;
    g.strokeStyle = "#141a28";
    g.stroke();
    // The lid's handle edge.
    g.fillStyle = shade(look.lid, -0.25);
    g.fillRect(x - w * 0.3, top - h, w * 0.6, Math.min(h, slot.w * 0.04));
  };

  const drawBin = (bin: BinState, items: readonly Item[]) => {
    if (!g || !layout) return;
    const slot = bin.slot;
    const h = slot.bottom - slot.top;
    let y = 0;
    if (bin.phase === "lifting") y = h * 2;
    else if (bin.phase === "arriving") {
      const f = Math.min(1, bin.phaseT / 0.7);
      y = (1 - f * f * (3 - 2 * f)) * (h + layout.d * 0.2);
    }
    const shake = bin.shake > 0 ? Math.sin(bin.shake * 60) * bin.shake * layout.d * 0.12 : 0;
    const x = slot.x + shake;
    const top = slot.top + y;
    if (y >= h) return;
    g.save();
    if (y > 0) {
      g.beginPath();
      g.rect(slot.x - slot.w, 0, slot.w * 2, slot.bottom);
      g.clip();
    }
    if (y === 0) drawLid(bin, x, top);
    // The opening, then anything sinking into it, then the front.
    g.fillStyle = "#06080f";
    g.beginPath();
    g.ellipse(x, top + slot.w * 0.02, slot.w * 0.46, slot.w * 0.05, 0, 0, TAU);
    g.fill();
    if (y === 0) {
      for (const it of items) {
        if (it.state === "sink" && layout.bins[it.bin] === slot) drawOneItem(it, 1, 1);
      }
    }
    const s = binSprites.get(binKey(slot));
    if (s) g.drawImage(s, x - slot.w / 2, top, slot.w, h);
    drawGauge(bin, x, top, h);
    // The tick of colour after a right item.
    if (bin.since < 0.6 && y === 0) {
      const f = bin.since / 0.6;
      g.save();
      g.globalAlpha = 1 - f;
      g.strokeStyle = BIN_LOOK[slot.kind].glow;
      g.lineWidth = slot.w * 0.035;
      g.beginPath();
      g.ellipse(x, top, slot.w * (0.4 + f * 0.25), slot.w * (0.08 + f * 0.06), 0, 0, TAU);
      g.stroke();
      g.restore();
    }
    g.restore();
  };

  const drawGauge = (bin: BinState, x: number, top: number, h: number) => {
    if (!g) return;
    const slot = bin.slot;
    const cap = slot.cap;
    const span = slot.w * 0.66;
    const step = span / cap;
    const rad = Math.min(step * 0.36, slot.w * 0.035);
    const gy = top + h * (slot.wheels ? 0.8 : 0.84);
    const look = BIN_LOOK[slot.kind];
    for (let i = 0; i < cap; i++) {
      const gx = x - span / 2 + step * (i + 0.5);
      g.beginPath();
      g.arc(gx, gy, rad, 0, TAU);
      g.fillStyle = i < bin.fill ? look.lid : "rgba(255,255,255,0.14)";
      g.fill();
    }
  };

  const drawOneItem = (it: Item, alpha: number, scale: number, pos?: { x: number; y: number }) => {
    if (!g || !layout) return;
    const s = itemSprites[it.kind];
    if (!s) return;
    const d = layout.d * scale;
    const x = pos ? pos.x : it.px + (it.x - it.px) * alpha;
    const y = pos ? pos.y : it.py + (it.y - it.py) * alpha;
    const a = it.pa + (it.a - it.pa) * alpha;
    g.save();
    g.translate(x, y);
    g.rotate(a);
    g.drawImage(s, -d * 0.6, -d * 0.6, d * 1.2, d * 1.2);
    g.restore();
  };

  const drawBelt = (b: Belt, phase: number) => {
    if (!g || !layout) return;
    const d = layout.d;
    const t = d * 0.24;
    const x0 = Math.min(b.start, b.end) - (b.dir > 0 ? d * 0.55 : d * 0.2);
    const x1 = Math.max(b.start, b.end) + (b.dir > 0 ? d * 0.2 : d * 0.55);
    const gap = d * 0.42;
    const off = (((phase * b.dir) % gap) + gap) % gap;
    g.save();
    g.beginPath();
    g.rect(x0 + t * 0.5, b.y, x1 - x0 - t, t * 0.5);
    g.clip();
    g.fillStyle = "rgba(200,215,240,0.32)";
    for (let x = x0 + off - gap; x < x1; x += gap) g.fillRect(x, b.y + t * 0.08, d * 0.08, t * 0.3);
    g.restore();
  };

  const drawLift = (line: Line) => {
    if (!g || !layout) return;
    const d = layout.d;
    const step = d * 0.9;
    const off = liftPhase % step;
    g.strokeStyle = "#8b97b3";
    g.lineWidth = d * 0.05;
    for (let y = line.liftBottom - off; y > line.liftTop + d * 0.3; y -= step) {
      g.beginPath();
      g.moveTo(line.liftX - d * 0.36, y - d * 0.2);
      g.lineTo(line.liftX - d * 0.3, y + d * 0.12);
      g.lineTo(line.liftX + d * 0.3, y + d * 0.12);
      g.lineTo(line.liftX + d * 0.36, y - d * 0.2);
      g.stroke();
    }
  };

  const drawGlass = () => {
    if (!g || !layout) return;
    const d = layout.d;
    g.save();
    g.lineCap = "round";
    g.lineJoin = "round";
    // One path for every tube, so where tubes share their start the glass isn't doubled.
    g.beginPath();
    for (const b of layout.belts) tracePath(g, [...b.tube.pts], d * 0.6);
    g.lineWidth = d * 1.06;
    g.strokeStyle = GLASS;
    g.stroke();
    g.restore();
  };

  const drawFunnelLip = (line: Line) => {
    if (!g || !layout) return;
    const d = layout.d;
    const f = line.inlet;
    rr(g, f.x - f.w / 2 - d * 0.12, f.y - d * 0.12, f.w + d * 0.24, d * 0.16, d * 0.08);
    g.fillStyle = "#7d8aa6";
    g.fill();
    g.lineWidth = d * 0.04;
    g.strokeStyle = "#151b29";
    g.stroke();
  };

  const drawPlantMotion = (dt: number) => {
    if (!g || !layout) return;
    const L = layout;
    if (L.kind !== "wall" && !own) return;
    gear += dt * 1.4;
    for (const c of gears()) {
      g.save();
      g.translate(c.x, c.y);
      g.rotate(gear);
      g.fillStyle = "#c9a33a";
      g.strokeStyle = "#1a2133";
      g.lineWidth = c.r * 0.08;
      g.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU;
        const rr2 = i % 2 === 0 ? c.r : c.r * 0.78;
        g.lineTo(Math.cos(a) * rr2, Math.sin(a) * rr2);
      }
      g.closePath();
      g.fill();
      g.stroke();
      g.beginPath();
      g.arc(0, 0, c.r * 0.3, 0, TAU);
      g.fillStyle = "#4a5a78";
      g.fill();
      g.restore();
    }
    smokeAt -= dt;
    if (smokeAt <= 0) {
      smokeAt = 0.5;
      for (const c of chimneys()) {
        addParticle({
          kind: "smoke",
          x: c.x,
          y: c.y,
          vx: L.d * 0.15,
          vy: -L.d * 0.35,
          life: 0,
          max: 3.2,
          size: L.d * 0.25,
          color: "#cfd6e4",
        });
      }
    }
  };

  const drawPark = (park: Park) => {
    if (!g || !layout) return;
    const L = layout;
    const size = L.kind === "wall" ? L.park.height * 0.75 : L.park.height * 0.62;
    const slots = L.parkSlots;
    const xAt = (slot: number) => {
      if (L.kind === "pair") {
        // Both sides of the plant, filling outward from it.
        const half = Math.ceil(slots / 2);
        const left = slot % 2 === 0;
        const i = Math.floor(slot / 2);
        const span = (L.plant.x - L.park.x) / half;
        return left ? L.plant.x - span * (i + 0.5) : L.plant.x + L.plant.width + span * (i + 0.5);
      }
      if (L.kind === "wall") return L.park.x + (L.park.width / slots) * (slot + 0.5);
      return L.park.x + L.park.width - (L.park.width / slots) * (slots - slot - 0.5);
    };
    for (const t of park.things) {
      const s = thingSprite(t.kind, size);
      const pop = Math.min(1, t.age / 0.5);
      const sc = pop < 1 ? 0.4 + 0.6 * (1 - (1 - pop) * (1 - pop)) * 1.08 : 1;
      const x = xAt(t.shown);
      const px = size * 1.15 * sc;
      g.drawImage(s, x - px / 2, L.ground - size / 2 - px / 2 + size * 0.04, px, px);
    }
    for (const t of park.leavers) {
      const s = thingSprite(t.kind, size);
      const f = Math.min(1, (t.leaving ?? 0) / LEAVE_S);
      g.save();
      g.globalAlpha = 1 - f;
      const x = xAt(0) + (L.kind === "wall" ? -1 : -1) * f * size * 1.4;
      const px = size * 1.15;
      g.drawImage(s, x - px / 2, L.ground - size / 2 - px / 2, px, px);
      g.restore();
    }
  };

  const drawRising = (rb: RisingBin) => {
    if (!g || !layout) return;
    const L = layout;
    const slot = L.bins.find((b) => b.kind === rb.kind && Math.abs(b.x - rb.x) < 1);
    if (!slot) return;
    const s = binSprites.get(binKey(slot));
    // On the frame's own plant, bins shrink into it as they arrive.
    const plantY = L.kind === "wall" ? L.plant.y + L.plant.height : L.ground;
    const shrink =
      own || L.kind === "wall"
        ? Math.max(0.15, Math.min(1, (rb.y - plantY) / (L.height * 0.35)))
        : 1;
    const w = rb.w * shrink;
    const h = rb.h * shrink;
    g.strokeStyle = "rgba(200,210,230,0.6)";
    g.lineWidth = L.d * 0.04;
    g.beginPath();
    g.moveTo(rb.x, rb.y - h / 2);
    g.lineTo(rb.x, Math.max(0, rb.y - L.height));
    g.stroke();
    // A full bin: its lid shut over a heap.
    const look = BIN_LOOK[rb.kind];
    rr(g, rb.x - w * 0.49, rb.y - h / 2 - w * 0.06, w * 0.98, w * 0.07, w * 0.03);
    g.fillStyle = look.lid;
    g.fill();
    if (s) g.drawImage(s, rb.x - w / 2, rb.y - h / 2, w, h);
  };

  const spawnBurst = (x: number, y: number, color: string, n: number, speed: number) => {
    if (!layout) return;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + Math.random() * 0.4;
      const v = speed * (0.5 + Math.random() * 0.6);
      addParticle({
        kind: "spark",
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - speed * 0.4,
        life: 0,
        max: 0.7 + Math.random() * 0.3,
        size: layout.d * (0.05 + Math.random() * 0.04),
        color,
      });
    }
  };

  const stepParticles = (dt: number) => {
    if (!g || !layout) return;
    const d = layout.d;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]!;
      p.life += dt;
      if (p.life >= p.max) {
        particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === "spark") p.vy += d * 9 * dt;
      const f = p.life / p.max;
      g.globalAlpha = 1 - f;
      if (p.kind === "tick") {
        g.strokeStyle = p.color;
        g.lineWidth = p.size * 0.22;
        g.lineCap = "round";
        g.lineJoin = "round";
        g.beginPath();
        g.moveTo(p.x - p.size * 0.5, p.y);
        g.lineTo(p.x - p.size * 0.12, p.y + p.size * 0.38);
        g.lineTo(p.x + p.size * 0.55, p.y - p.size * 0.42);
        g.stroke();
      } else if (p.kind === "puff" || p.kind === "smoke") {
        g.fillStyle = p.color;
        g.beginPath();
        g.arc(p.x, p.y, p.size * (0.6 + f * 1.4), 0, TAU);
        g.fill();
      } else {
        g.fillStyle = p.color;
        g.beginPath();
        g.arc(p.x, p.y, p.size, 0, TAU);
        g.fill();
      }
    }
    g.globalAlpha = 1;
  };

  return {
    setup(l, cssWidth, cssHeight, scale) {
      layout = l;
      k = scale;
      for (const c of [backCanvas, frontCanvas]) {
        c.width = Math.max(1, Math.round(cssWidth));
        c.height = Math.max(1, Math.round(cssHeight));
      }
      beltPhase.length = l.belts.length;
      beltPhase.fill(0);
      particles.length = 0;
      buildSprites();
      drawStatic();
    },
    setTop(value) {
      if (own === value) return;
      own = value;
      drawStatic();
    },
    event(e) {
      if (!layout) return;
      const d = layout.d;
      if (e.type === "sorted") {
        const look = BIN_LOOK[e.bin];
        if (e.right) {
          addParticle({
            kind: "tick",
            x: e.x,
            y: e.y - d * 0.4,
            vx: 0,
            vy: -d * 0.9,
            life: 0,
            max: 0.9,
            size: d * 0.55,
            color: TICK,
          });
          spawnBurst(e.x, e.y, look.glow, 10, d * 3);
        }
      } else if (e.type === "floor") {
        addParticle({
          kind: "puff",
          x: e.x,
          y: e.y - d * 0.2,
          vx: 0,
          vy: -d * 0.3,
          life: 0,
          max: 0.6,
          size: d * 0.3,
          color: "rgba(200,210,230,0.5)",
        });
      } else if (e.type === "delivered") {
        const kind: BinKind = e.rise.kind;
        spawnBurst(e.rise.x, Math.max(d, e.rise.y - e.rise.h / 2), BIN_LOOK[kind].glow, 16, d * 4);
      }
    },
    draw(o) {
      if (!g || !layout) return;
      const L = layout;
      const dt = o.dt;
      time += dt;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, frontCanvas.width, frontCanvas.height);
      g.setTransform(k, 0, 0, k, 0, 0);
      L.belts.forEach((b, i) => {
        beltPhase[i] = (beltPhase[i] ?? 0) + (o.speeds[i] ?? 0) * dt;
      });
      liftPhase += L.d * 3.2 * dt;

      drawPlantMotion(dt);
      if (o.park && (own || L.kind === "wall")) drawPark(o.park);
      for (const line of L.lines) drawLift(line);
      // Items in tubes, lifts and the funnel, behind the glass.
      for (const it of o.items) {
        if (it.state === "tube") drawOneItem(it, o.alpha, 1);
        else if (it.state === "lift") drawOneItem(it, o.alpha, 0.8);
        else if (it.state === "chute") drawOneItem(it, o.alpha, 1);
      }
      for (const line of L.lines) {
        const q = o.items.find((it) => it.state === "queue" && it.line === line.index);
        if (q) drawOneItem(q, o.alpha, 0.95);
      }
      drawGlass();
      for (const line of L.lines) drawFunnelLip(line);
      L.belts.forEach((b, i) => drawBelt(b, beltPhase[i] ?? 0));
      for (const bin of o.bins) drawBin(bin, o.items);
      for (const it of o.items) {
        if (it.state === "belt" || it.state === "eject" || it.state === "fly") {
          drawOneItem(it, o.alpha, 1);
        } else if (it.state === "fall") {
          drawOneItem(it, o.alpha, 1, o.fallAt(it));
        } else if (it.state === "poof" && it.t < 0.3) {
          g.globalAlpha = 1 - it.t / 0.3;
          drawOneItem(it, 1, 1 - it.t);
          g.globalAlpha = 1;
        }
      }
      for (const rb of o.rising) drawRising(rb);
      for (const it of o.items) {
        if (it.state !== "held") continue;
        const x = it.px + (it.x - it.px) * o.alpha;
        const y = it.py + (it.y - it.py) * o.alpha;
        g.fillStyle = "rgba(255,255,255,0.12)";
        g.beginPath();
        g.arc(x, y, L.d * 0.66, 0, TAU);
        g.fill();
        drawOneItem(it, o.alpha, 1.12);
      }
      stepParticles(dt);
      for (const gh of o.ghosts) drawHand(g, gh.x, gh.y, L.d * 0.95, gh.alpha);
    },
    get particles() {
      return particles.length;
    },
    dispose() {
      backCanvas.remove();
      frontCanvas.remove();
      itemSprites = [];
      binSprites.clear();
      thingSprites.clear();
      particles.length = 0;
    },
  };
};

/** A bin's body as it stands, `w` by `h` venue px, drawn from its top-left. */
const drawBinBody = (g: G, kind: BinKind, w: number, h: number, wheels: boolean) => {
  const look = BIN_LOOK[kind];
  const wheelR = wheels ? Math.min(w * 0.09, h * 0.1) : 0;
  const bottom = h - wheelR * 0.9;
  const inset = wheels ? w * 0.05 : w * 0.01;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(w, 0);
  g.lineTo(w - inset, bottom);
  g.lineTo(inset, bottom);
  g.closePath();
  const gr = g.createLinearGradient(0, 0, w, 0);
  gr.addColorStop(0, shade(look.body, -0.25));
  gr.addColorStop(0.45, shade(look.body, 0.12));
  gr.addColorStop(1, shade(look.body, -0.3));
  g.fillStyle = gr;
  g.fill();
  g.lineWidth = Math.max(2, w * 0.012);
  g.strokeStyle = "#0b0f18";
  g.stroke();
  // The rim.
  g.fillStyle = shade(look.body, -0.4);
  g.fillRect(0, 0, w, Math.max(4, h * 0.05));
  // A coloured band in the lid's colour, so colour and picture both say which bin.
  g.fillStyle = look.lid;
  g.fillRect(inset * 0.4, h * 0.07, w - inset * 0.8, Math.max(4, h * 0.05));
  // The picture on a light panel.
  const ps = Math.min(w * 0.7, h * 0.55);
  const py = h * (wheels ? 0.42 : 0.45);
  g.beginPath();
  g.roundRect(w / 2 - ps / 2, py - ps / 2, ps, ps * 0.92, ps * 0.12);
  g.fillStyle = "#eef2f7";
  g.fill();
  g.lineWidth = Math.max(2, w * 0.01);
  g.strokeStyle = look.lid;
  g.stroke();
  drawBinPicture(g, kind, w / 2, py - ps * 0.04, ps * 0.9);
  if (wheels) {
    for (const x of [w * 0.2, w * 0.8]) {
      g.beginPath();
      g.arc(x, h - wheelR, wheelR, 0, TAU);
      g.fillStyle = "#11151f";
      g.fill();
      g.beginPath();
      g.arc(x, h - wheelR, wheelR * 0.4, 0, TAU);
      g.fillStyle = "#59617a";
      g.fill();
    }
  }
};
