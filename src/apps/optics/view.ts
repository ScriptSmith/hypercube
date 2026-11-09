/**
 * A touch frame's drawing, in three canvas layers: the bench (sockets, trays, lamps and fixed
 * parts, redrawn when the puzzle changes), the beams (redrawn after a retrace, never per frame),
 * and the pieces, rings, crystals and effects on top, redrawn each frame.
 */
import type { FrameInfo } from "../../core/types";
import type { Bench } from "./bench";
import {
  INK,
  drawBeams,
  drawCrystal,
  drawDisc,
  drawHand,
  drawLamp,
  drawPiece,
  drawProgress,
  drawRing,
} from "./draw";
import type { FrameLayout } from "./layout";
import { maskColour } from "./spectrum";
import type { Box } from "./trace";

type G = CanvasRenderingContext2D;

export interface BenchLook {
  bench: Bench;
  /** Local ms the current puzzle arrived, for its fade in. */
  arrived: number;
  /** Local ms the celebration began, or -Infinity. */
  cheer: number;
  /** Progress lamps: how many, how lit each is, and which one pulses. */
  progress: { n: number; on: (i: number) => number; current: number };
  /** Where the light is expected in but isn't arriving: a marker at the edge. */
  guideAt: { x: number; y: number }[];
}

export interface TouchView {
  resize(frame: FrameInfo): void;
  draw(now: number, looks: readonly BenchLook[], hands: readonly { x: number; y: number }[]): void;
  dispose(): void;
}

const SLIDE_MS = 900;
const CHEER_MS = 2600;
const MAX_SPARKS = 160;

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  colour: string;
}

export const createTouchView = (
  root: HTMLElement,
  layout: FrameLayout,
  f0: FrameInfo,
): TouchView => {
  const make = (z: number) => {
    const c = document.createElement("canvas");
    c.style.cssText = `position:absolute;left:0;top:0;pointer-events:none;z-index:${z};`;
    root.append(c);
    return c;
  };
  const bgC = make(0);
  const beamC = make(1);
  const fgC = make(2);
  const bg = bgC.getContext("2d")!;
  const beams = beamC.getContext("2d")!;
  const fg = fgC.getContext("2d")!;
  let scale = 1;
  const seen = new Map<Bench, { fixed: number; trace: number }>();
  const sparks: Spark[] = [];
  const cheered = new Map<Bench, number>();

  const resize = (f: FrameInfo) => {
    scale = f.unit * f.pixelRatio;
    for (const c of [bgC, beamC, fgC]) {
      c.style.width = `${f.width}px`;
      c.style.height = `${f.height}px`;
      c.width = Math.max(1, Math.round(f.width * f.pixelRatio));
      c.height = Math.max(1, Math.round(f.height * f.pixelRatio));
    }
    seen.clear();
  };
  resize(f0);

  const clip = (g: G, b: Box) => {
    g.beginPath();
    g.rect(b.x, b.y, b.width, b.height);
    g.clip();
  };

  const drawBench = (look: BenchLook) => {
    const b = look.bench;
    const L = b.layout;
    const g = bg;
    g.save();
    g.setTransform(scale, 0, 0, scale, 0, 0);
    clip(g, L.box);
    const grad = g.createLinearGradient(0, L.box.y, 0, L.box.y + L.box.height);
    grad.addColorStop(0, "#03050b");
    grad.addColorStop(L.reachTop / (L.box.height || 1), "#060a14");
    grad.addColorStop(1, "#0b1222");
    g.fillStyle = grad;
    g.fillRect(L.box.x, L.box.y, L.box.width, L.box.height);
    // A faint optical-table grid in the reachable band.
    g.strokeStyle = "rgba(90,120,180,0.06)";
    g.lineWidth = 2;
    const step = L.sizes.piece * 0.75;
    g.beginPath();
    for (let x = L.box.x + step / 2; x < L.box.x + L.box.width; x += step) {
      g.moveTo(x, L.reachTop);
      g.lineTo(x, L.box.y + L.box.height);
    }
    for (let y = L.box.y + L.box.height - step / 2; y > L.reachTop; y -= step) {
      g.moveTo(L.box.x, y);
      g.lineTo(L.box.x + L.box.width, y);
    }
    g.stroke();
    if (L.box.x > 0) {
      g.fillStyle = INK.benchEdge;
      g.fillRect(L.box.x, 0, 6, L.box.height);
    }
    for (const t of L.trays) {
      g.beginPath();
      g.roundRect(t.box.x, t.box.y, t.box.width, t.box.height, L.sizes.piece * 0.3);
      g.fillStyle = INK.tray;
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = INK.trayEdge;
      g.stroke();
      for (const s of t.slots) {
        g.beginPath();
        g.arc(s.x, s.y, L.sizes.piece * 0.82, 0, Math.PI * 2);
        g.strokeStyle = "rgba(150,180,230,0.08)";
        g.stroke();
      }
    }
    for (const s of L.sockets) {
      g.beginPath();
      g.arc(s.x, s.y, L.sizes.piece * 0.9, 0, Math.PI * 2);
      g.setLineDash([L.sizes.piece * 0.16, L.sizes.piece * 0.12]);
      g.lineWidth = Math.max(3, L.sizes.piece * 0.04);
      g.strokeStyle = s.child ? INK.socketChild : INK.socket;
      g.stroke();
      g.setLineDash([]);
      g.beginPath();
      g.arc(s.x, s.y, L.sizes.piece * 0.06, 0, Math.PI * 2);
      g.fillStyle = s.child ? INK.socketChild : INK.socket;
      g.fill();
    }
    if (b.dispensers.length > 0) {
      // Free play: lamp spots are places a lamp can be dragged to.
      for (const s of L.lampSpots) {
        g.beginPath();
        g.arc(s.x, s.y, L.sizes.lamp * 0.3, 0, Math.PI * 2);
        g.strokeStyle = "rgba(255,230,170,0.18)";
        g.lineWidth = 3;
        g.stroke();
      }
    }
    for (const f of b.puzzle.fixed) drawPiece(g, f.kind, f.x, f.y, f.turn, L.sizes.piece);
    // Chevrons up the lane above the fixed splitter: its light goes on up to the screen.
    for (const f of b.puzzle.fixed) {
      if (f.kind !== "sky") continue;
      g.strokeStyle = "rgba(160,200,255,0.14)";
      g.lineWidth = 8;
      g.lineCap = "round";
      for (let y = f.y - L.sizes.piece * 1.4; y > 60; y -= L.sizes.piece * 1.6) {
        if (L.trays.some((t) => y > t.box.y - 40 && y < t.box.y + t.box.height + 40)) continue;
        g.beginPath();
        g.moveTo(f.x - 30, y + 30);
        g.lineTo(f.x, y);
        g.lineTo(f.x + 30, y + 30);
        g.stroke();
      }
    }
    for (const l of b.puzzle.lamps) drawLamp(g, l, L.sizes.lamp, L.sizes.bundle);
    g.restore();
  };

  const drawLight = (look: BenchLook) => {
    const b = look.bench;
    const L = b.layout;
    const g = beams;
    g.save();
    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.clearRect(L.box.x - 2, L.box.y, L.box.width + 4, L.box.height);
    clip(g, L.box);
    drawBeams(g, b.result.segs, L.kind === "wall" ? 7 : 6);
    g.restore();
  };

  const spark = (x: number, y: number, colour: string, now: number, n: number, speed: number) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.8);
      sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, born: now, colour });
    }
    while (sparks.length > MAX_SPARKS) sparks.shift();
  };

  const draw = (
    now: number,
    looks: readonly BenchLook[],
    hands: readonly { x: number; y: number }[],
  ) => {
    for (const look of looks) {
      const b = look.bench;
      const s = seen.get(b);
      if (!s || s.fixed !== b.fixedVersion) {
        drawBench(look);
        drawLight(look);
        seen.set(b, { fixed: b.fixedVersion, trace: b.traceVersion });
      } else if (s.trace !== b.traceVersion) {
        drawLight(look);
        s.trace = b.traceVersion;
      }
    }
    const g = fg;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, fgC.width, fgC.height);
    g.setTransform(scale, 0, 0, scale, 0, 0);
    for (const look of looks) {
      const b = look.bench;
      const L = b.layout;
      const R = L.sizes.piece;
      g.save();
      clip(g, L.box);
      const slide = Math.min(1, Math.max(0, (now - look.arrived) / SLIDE_MS));
      const ease = 1 - (1 - slide) ** 3;
      const dx = (1 - ease) * R * 1.4;
      const cheerT = now - look.cheer;
      const cheering = cheerT >= 0 && cheerT < CHEER_MS;
      if (cheering && cheered.get(b) !== look.cheer) {
        cheered.set(b, look.cheer);
        for (const c of b.puzzle.crystals) spark(c.x, c.y, maskColour(0b1111111), now, 18, R * 3);
      }
      // Beams brighten while the bench celebrates.
      if (cheering) {
        const k = Math.sin((Math.PI * cheerT) / CHEER_MS);
        g.save();
        g.globalCompositeOperation = "lighter";
        g.globalAlpha = 0.6 * k;
        g.lineCap = "round";
        g.lineWidth = L.kind === "wall" ? 14 : 12;
        for (const sg of b.result.segs) {
          if (sg.guide) continue;
          g.strokeStyle = maskColour(sg.bits);
          g.beginPath();
          g.moveTo(sg.x0, sg.y0);
          g.lineTo(sg.x1, sg.y1);
          g.stroke();
        }
        g.restore();
      }
      g.translate(dx, 0);
      g.globalAlpha = ease;
      const act = b.active(now);
      // Rings first, so pieces sit on top of their neighbours' rings.
      b.items.forEach((it, i) => {
        if (it.place.socket === null) return;
        const w = b.where(i);
        if (!w || w.carried) return;
        const bright = i === act ? 1 : 0;
        drawRing(g, w.x, w.y, L.sizes.ring, L.sizes.knob, it.place.turn, bright);
      });
      b.puzzle.crystals.forEach((c, i) => {
        const bloom = cheering ? 1 + 0.35 * Math.sin((Math.PI * cheerT) / CHEER_MS) : 1;
        drawCrystal(g, c, b.shown[i] ?? 0, now, bloom);
      });
      const carriedItems: number[] = [];
      b.items.forEach((it, i) => {
        const w = b.where(i);
        if (!w) return;
        if (w.carried) {
          carriedItems.push(i);
          return;
        }
        const inTray = it.place.socket === null;
        drawDisc(g, w.x, w.y, inTray ? R * 0.82 : R * 0.96, inTray ? 0.75 : 1);
        drawPiece(g, it.kind, w.x, w.y, it.place.turn, inTray ? R * 0.8 : R, { band: it.band });
      });
      for (const d of b.dispensers) {
        const slot = L.trays[d.tray]?.slots[d.slot];
        if (!slot) continue;
        drawDisc(g, slot.x, slot.y, R * 0.82, 0.75);
        drawPiece(
          g,
          d.kind,
          slot.x,
          slot.y,
          d.kind === "mirror" ? 0 : d.kind === "filter" ? 3 : 0,
          R * 0.8,
          {
            band: d.band,
          },
        );
      }
      // Hover targets and carried pieces on top.
      for (const gr of b.grabs.values()) {
        if (gr.kind === "drag" && gr.hover !== null) {
          const s = L.sockets[gr.hover]!;
          g.beginPath();
          g.arc(s.x, s.y, R * 1.02, 0, Math.PI * 2);
          g.lineWidth = R * 0.06;
          g.strokeStyle = "rgba(255,230,150,0.75)";
          g.stroke();
        }
        if (gr.kind === "lamp") {
          const l = b.puzzle.lamps[gr.lamp];
          if (l) drawLamp(g, { ...l, x: gr.x, y: gr.y }, L.sizes.lamp, L.sizes.bundle);
        }
      }
      for (const i of carriedItems) {
        const it = b.items[i]!;
        const w = b.where(i)!;
        g.save();
        g.shadowColor = "transparent";
        drawDisc(g, w.x, w.y, R * 1.05, 0.9);
        drawPiece(g, it.kind, w.x, w.y, it.place.turn, R * 1.05, { band: it.band });
        g.restore();
      }
      for (const m of look.guideAt) {
        // A small chevron where the light should come in from the neighbour.
        g.save();
        g.globalAlpha = 0.35 + 0.2 * Math.sin(now / 500);
        g.strokeStyle = "#cfe0ff";
        g.lineWidth = R * 0.06;
        g.lineCap = "round";
        const x = m.x + (m.x < L.box.x + L.box.width / 2 ? R * 0.25 : -R * 0.25);
        g.beginPath();
        g.moveTo(x - R * 0.12, m.y - R * 0.2);
        g.lineTo(x + R * 0.08, m.y);
        g.lineTo(x - R * 0.12, m.y + R * 0.2);
        g.stroke();
        g.restore();
      }
      g.globalAlpha = 1;
      g.translate(-dx, 0);
      drawProgress(g, L.progress, look.progress.n, look.progress.on, look.progress.current, now);
      g.restore();
    }
    // Sparks from a celebration.
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i]!;
      const age = (now - s.born) / 1000;
      if (age > 1.4) {
        sparks.splice(i, 1);
        continue;
      }
      g.globalAlpha = Math.max(0, 1 - age / 1.4);
      g.fillStyle = s.colour;
      g.beginPath();
      g.arc(s.x + s.vx * age, s.y + s.vy * age + 200 * age * age, 7, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    const handR = layout.kind === "wall" ? 70 : 80;
    for (const h of hands) drawHand(g, h.x, h.y, handR);
  };

  return {
    resize,
    draw,
    dispose() {
      for (const c of [bgC, beamC, fgC]) {
        c.width = 1;
        c.height = 1;
        c.remove();
      }
      seen.clear();
      sparks.length = 0;
      cheered.clear();
    },
  };
};
