/**
 * Canvas2D drawing in venue px through one transform. Two stacked canvases: `back` holds the
 * boards, sockets, trays, posts, power lines, the machines' still parts and the goal cards'
 * rows, and is redrawn only when one of those changes; `front` is cleared and drawn every frame
 * (pieces, wires with their moving dots, ports, drags, effects, the machines' moving parts and
 * the ghost hands). Piece bodies are cached as sprites per kind, state and colour.
 */
import type { FrameInfo } from "../../core/types";
import { withAlpha } from "../../core/ui";
import {
  BOARD,
  colorOf,
  DEAD,
  drawBell,
  drawBellBase,
  drawButton,
  drawFanBase,
  drawFanBlades,
  drawGate,
  drawHand,
  drawLampBase,
  drawLampGlow,
  drawPost,
  drawSwitch,
  LIVE,
  pieceColor,
  POST_COLORS,
  roundRect,
  SOURCE_COLORS,
} from "./art";
import type { Bench, Gesture } from "./bench";
import { addError, KINDS, type Piece, type PieceKind, pieceById, powered } from "./circuit";
import {
  arcTable,
  type Curve,
  freeEnd,
  paramAt,
  pieceSize,
  pointOn,
  type Port,
  portOf,
  route,
  socketPoint,
} from "./geometry";
import { rowsOf } from "./goals";
import type { BenchLayout, Box, Layout, Point } from "./layout";
import type { Machine } from "./machines";

type G = CanvasRenderingContext2D;
const TAU = Math.PI * 2;

export interface BenchView {
  bench: Bench;
  machine: Machine;
}

export interface Renderer {
  setup(frame: FrameInfo, layout: Layout): void;
  draw(views: readonly BenchView[], now: number, dt: number, hands: readonly Point[]): void;
  dispose(): void;
}

interface Vis {
  glow: number;
  angle: number;
  speed: number;
  swing: number;
}

const MAX_SPRITES = 160;
const FX_MS = { shake: 450, plug: 380, spring: 260, poof: 420, place: 320, flip: 260 } as const;

export const createRenderer = (root: HTMLElement): Renderer => {
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
  /** Device px per venue px. */
  let k = 1;
  let backKey = "";
  const sprites = new Map<string, HTMLCanvasElement>();
  const vis = new Map<string, Vis>();
  const versions: number[] = [];
  const table = new Float32Array(17);
  const handles: { x: number; y: number; live: boolean }[] = [];

  // ---- Sprites -------------------------------------------------------------------------------

  const sprite = (key: string, w: number, h: number, paint: (s: G) => void) => {
    let c = sprites.get(key);
    if (c) return c;
    if (sprites.size >= MAX_SPRITES) sprites.clear();
    c = document.createElement("canvas");
    const pad = Math.max(w, h) * 0.15;
    c.width = Math.max(1, Math.ceil((w + 2 * pad) * k));
    c.height = Math.max(1, Math.ceil((h + 2 * pad) * k));
    const s = c.getContext("2d");
    if (s) {
      s.setTransform(k, 0, 0, k, c.width / 2, c.height / 2);
      paint(s);
    }
    sprites.set(key, c);
    return c;
  };

  const blit = (c: HTMLCanvasElement, x: number, y: number) => {
    if (!g) return;
    const w = c.width / k;
    const h = c.height / k;
    g.drawImage(c, x - w / 2, y - h / 2, w, h);
  };

  /** A piece's still body, at (x, y). */
  const body = (
    l: BenchLayout,
    kind: PieceKind,
    on: boolean,
    hue: number,
    x: number,
    y: number,
  ) => {
    const s = pieceSize(l, kind);
    const color = pieceColor(kind, hue);
    const key = `${kind}:${on ? 1 : 0}:${color}:${s.w}x${s.h}`;
    const c = sprite(key, s.w, s.h, (sg) => {
      if (kind === "switch") drawSwitch(sg, s.w, on, color);
      else if (kind === "button") drawButton(sg, s.w, on, color);
      else if (kind === "lamp") drawLampBase(sg, s.w, color);
      else if (kind === "fan") drawFanBase(sg, s.w, color);
      else if (kind === "bell") drawBellBase(sg, s.w, color);
      else drawGate(sg, kind, s.w, s.h);
    });
    blit(c, x, y);
  };

  // ---- Back layer ----------------------------------------------------------------------------

  /** What the back layer shows for each bench, recomputed only when its circuit changes. */
  const keys: { circuit: object | null; version: number; key: string }[] = [];
  const keyOf = (views: readonly BenchView[]) => {
    let all = "";
    views.forEach((v, i) => {
      const b = v.bench;
      let k = keys[i];
      if (!k || k.circuit !== b.circuit || k.version !== b.circuit.version) {
        const dim = b.layout.trays
          .flatMap((t) => t.items.map((it) => (addError(b.circuit, it.kind) ? 1 : 0)))
          .join("");
        k = { circuit: b.circuit, version: b.circuit.version, key: dim };
        keys[i] = k;
      }
      all += `${v.machine.kind}:${k.key}:${b.card ? b.cardIndex : -1}|`;
    });
    return all;
  };

  const miniSwitch = (
    sg: G,
    x: number,
    y: number,
    w: number,
    on: boolean,
    color: string,
    button: boolean,
  ) => {
    sg.save();
    sg.translate(x, y);
    if (button) drawButton(sg, w, on, color);
    else drawSwitch(sg, w, on, color);
    sg.restore();
  };

  const drawCardBack = (sg: G, b: Bench, box: Box) => {
    const card = b.card;
    if (!card) return;
    roundRect(sg, box.x, box.y, box.width, box.height, 28);
    sg.fillStyle = "#f2efe6";
    sg.fill();
    sg.lineWidth = 8;
    sg.strokeStyle = "#c9c2ae";
    sg.stroke();
    const rows = rowsOf(card);
    const n = rows.length;
    const head = box.height * 0.08;
    const foot = box.height * 0.08;
    const rowH = (box.height - head - foot) / n;
    const icon = Math.min(rowH * 0.78, box.width / (card.inputs.length + card.outputs + 2.6));
    rows.forEach((row, r) => {
      const cy = box.y + head + rowH * (r + 0.5);
      let x = box.x + box.width * 0.06 + icon / 2;
      row.ins.forEach((on, i) => {
        miniSwitch(
          sg,
          x,
          cy,
          icon * 0.9,
          on,
          colorOf(SOURCE_COLORS, i),
          card.inputs[i] === "button",
        );
        x += icon;
      });
      // Arrow.
      sg.strokeStyle = "#7a7464";
      sg.lineWidth = Math.max(3, icon * 0.06);
      sg.lineCap = "round";
      sg.beginPath();
      sg.moveTo(x - icon * 0.25, cy);
      sg.lineTo(x + icon * 0.2, cy);
      sg.moveTo(x + icon * 0.05, cy - icon * 0.14);
      sg.lineTo(x + icon * 0.2, cy);
      sg.lineTo(x + icon * 0.05, cy + icon * 0.14);
      sg.stroke();
      x += icon * 0.75;
      row.outs.forEach((on, i) => {
        const color = colorOf(POST_COLORS, i);
        sg.beginPath();
        sg.arc(x, cy, icon * 0.32, 0, TAU);
        sg.fillStyle = on ? color : "#3a3f4c";
        sg.fill();
        sg.lineWidth = Math.max(3, icon * 0.07);
        sg.strokeStyle = on ? withAlpha(color, 0.6) : "#8a8576";
        sg.stroke();
        if (on) {
          sg.fillStyle = "rgba(255,255,255,0.5)";
          sg.beginPath();
          sg.arc(x - icon * 0.1, cy - icon * 0.1, icon * 0.09, 0, TAU);
          sg.fill();
        }
        x += icon * 0.8;
      });
    });
  };

  const drawBack = (views: readonly BenchView[]) => {
    const l = layout;
    if (!back || !l) return;
    back.setTransform(1, 0, 0, 1, 0, 0);
    back.clearRect(0, 0, backCanvas.width, backCanvas.height);
    back.setTransform(k, 0, 0, k, 0, 0);
    const bg = back.createLinearGradient(0, 0, 0, l.H);
    bg.addColorStop(0, "#03050b");
    bg.addColorStop(1, "#070b16");
    back.fillStyle = bg;
    back.fillRect(0, 0, l.W, l.H);
    for (const v of views) {
      const b = v.bench;
      const bl = b.layout;
      // Machine area, clipped to its box.
      back.save();
      roundRect(back, bl.machine.x, bl.machine.y, bl.machine.width, bl.machine.height, 24);
      back.clip();
      v.machine.drawBack(back, bl.machine);
      back.restore();
      for (const board of bl.boards) {
        roundRect(back, board.x, board.y, board.width, board.height, 30);
        back.fillStyle = BOARD;
        back.fill();
        back.lineWidth = 4;
        back.strokeStyle = "#1a2440";
        back.stroke();
      }
      // Power lines, dim until their post is on.
      bl.posts.forEach((p, i) => {
        back.lineJoin = "round";
        back.lineCap = "round";
        back.beginPath();
        p.line.forEach((pt, j) => (j === 0 ? back.moveTo(pt.x, pt.y) : back.lineTo(pt.x, pt.y)));
        back.strokeStyle = "#05070d";
        back.lineWidth = bl.wire * 2.4;
        back.stroke();
        back.strokeStyle = withAlpha(colorOf(POST_COLORS, i), 0.3);
        back.lineWidth = bl.wire * 1.4;
        back.stroke();
      });
      // Sockets: dashed outlines where pieces can go.
      back.setLineDash([18, 14]);
      back.lineWidth = 4;
      bl.sockets.forEach((s) => {
        if (s.band === "post") return;
        const size =
          s.band === "child" ? { w: bl.child, h: bl.child } : { w: bl.gateW, h: bl.gateH };
        roundRect(back, s.x - size.w * 0.44, s.y - size.h * 0.42, size.w * 0.88, size.h * 0.84, 22);
        back.strokeStyle = s.band === "child" ? "#2c3d5e" : "#2a3352";
        back.stroke();
      });
      back.setLineDash([]);
      // Trays.
      for (const t of bl.trays) {
        roundRect(back, t.box.x, t.box.y, t.box.width, t.box.height, 24);
        back.fillStyle = "#141d33";
        back.fill();
        back.lineWidth = 4;
        back.strokeStyle = t.band === "child" ? "#3a4e7a" : "#33406a";
        back.stroke();
        for (const it of t.items) {
          const off = addError(b.circuit, it.kind) !== null;
          const s = pieceSize(bl, it.kind);
          const scale = it.size / Math.max(s.w, s.h * 1.15);
          back.save();
          back.globalAlpha = off ? 0.3 : 1;
          back.translate(it.x, it.y);
          back.scale(scale, scale);
          const color = pieceColor(it.kind, 0);
          if (it.kind === "switch") drawSwitch(back, s.w, true, color);
          else if (it.kind === "button") drawButton(back, s.w, false, color);
          else if (it.kind === "lamp") {
            drawLampBase(back, s.w, color);
            drawLampGlow(back, s.w, color, 1);
          } else if (it.kind === "fan") {
            drawFanBase(back, s.w, color);
            drawFanBlades(back, s.w, color, 0.3);
          } else if (it.kind === "bell") {
            drawBellBase(back, s.w, color);
            drawBell(back, s.w, color, 0, 0);
          } else drawGate(back, it.kind, s.w, s.h);
          back.restore();
        }
      }
      if (bl.card) drawCardBack(back, b, bl.card);
    }
  };

  // ---- Front layer ---------------------------------------------------------------------------

  const visOf = (bench: number, id: number): Vis => {
    const key = `${bench}:${id}`;
    let v = vis.get(key);
    if (!v) {
      v = { glow: 0, angle: 0, speed: 0, swing: 0 };
      vis.set(key, v);
    }
    return v;
  };

  const prune = (views: readonly BenchView[]) => {
    views.forEach((v, i) => {
      const ver = v.bench.circuit.version;
      if (versions[i] === ver) return;
      versions[i] = ver;
      for (const key of vis.keys()) {
        const [bi, id] = key.split(":").map(Number);
        if (bi === i && !pieceById(v.bench.circuit, id ?? -1)) vis.delete(key);
      }
    });
  };

  const strokeCurve = (c: Curve, width: number, color: string) => {
    if (!g) return;
    g.beginPath();
    g.moveTo(c.x0, c.y0);
    g.bezierCurveTo(c.x1, c.y1, c.x2, c.y2, c.x3, c.y3);
    g.lineWidth = width;
    g.strokeStyle = color;
    g.stroke();
  };

  const wire = (c: Curve, width: number, live: boolean, t: number, spacing: number) => {
    if (!g) return;
    g.lineCap = "round";
    strokeCurve(c, width * 1.8, "rgba(3,5,11,0.85)");
    if (live) strokeCurve(c, width * 2.6, withAlpha(LIVE, 0.18));
    strokeCurve(c, width, live ? LIVE : DEAD);
    if (!live) return;
    const len = arcTable(c, table);
    const speed = spacing * 2.2;
    g.fillStyle = "#fffdf0";
    for (let s = (t * speed) % spacing; s < len; s += spacing) {
      const p = pointOn(c, paramAt(table, s));
      g.beginPath();
      g.arc(p.x, p.y, width * 0.5, 0, TAU);
      g.fill();
    }
  };

  const polyline = (pts: readonly Point[], width: number, color: string) => {
    if (!g) return;
    g.beginPath();
    pts.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
    g.lineWidth = width;
    g.strokeStyle = color;
    g.lineJoin = "round";
    g.stroke();
  };

  /** Dots running along a power line towards the machine. */
  const lineDots = (pts: readonly Point[], r: number, t: number, spacing: number) => {
    if (!g) return;
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
    }
    g.fillStyle = "#fffdf0";
    for (let s = (t * spacing * 2.2) % spacing; s < total; s += spacing) {
      let d = s;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        const seg = Math.hypot(b.x - a.x, b.y - a.y);
        if (d <= seg) {
          const f = seg > 0 ? d / seg : 0;
          g.beginPath();
          g.arc(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, r, 0, TAU);
          g.fill();
          break;
        }
        d -= seg;
      }
    }
  };

  const portDot = (p: Port, r: number, live: boolean, wired: boolean) => {
    if (!g) return;
    g.beginPath();
    g.arc(p.x, p.y, r, 0, TAU);
    g.fillStyle =
      p.pin < 0 ? (live ? LIVE : "#8a94a8") : wired ? (live ? LIVE : "#6a7490") : "#070b14";
    g.fill();
    g.lineWidth = r * 0.35;
    g.strokeStyle = p.pin < 0 ? "#05070d" : live ? LIVE : "#9aa6c4";
    g.stroke();
  };

  const ring = (x: number, y: number, r: number, color: string, width: number) => {
    if (!g) return;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.lineWidth = width;
    g.strokeStyle = color;
    g.stroke();
  };

  const drawPiece = (
    bi: number,
    l: BenchLayout,
    b: Bench,
    p: Piece,
    at: Point,
    dt: number,
    t: number,
  ) => {
    if (!g) return;
    const v = visOf(bi, p.id);
    const kind = p.kind;
    const color = pieceColor(kind, p.hue);
    const group = KINDS[kind].group;
    if (group === "source") {
      body(l, kind, p.on, p.hue, at.x, at.y);
      return;
    }
    if (group === "gate") {
      body(l, kind, false, 0, at.x, at.y);
      // Output light at the tip, fading over about 100 ms.
      v.glow = approach(v.glow, p.out, dt);
      const port = portOf(l, p, -1, at);
      if (port && v.glow > 0.01) {
        const halo = g.createRadialGradient(port.x, port.y, 2, port.x, port.y, l.gateH * 0.4);
        halo.addColorStop(0, withAlpha(LIVE, 0.6 * v.glow));
        halo.addColorStop(1, withAlpha(LIVE, 0));
        g.fillStyle = halo;
        g.beginPath();
        g.arc(port.x, port.y, l.gateH * 0.4, 0, TAU);
        g.fill();
      }
      return;
    }
    if (group !== "sink") return;
    const live = powered(b.circuit, p);
    v.glow = approach(v.glow, live, dt);
    body(l, kind, false, p.hue, at.x, at.y);
    const w = l.child;
    g.save();
    g.translate(at.x, at.y);
    if (kind === "lamp") drawLampGlow(g, w, color, v.glow);
    else if (kind === "fan") {
      v.speed += ((live ? 1 : 0) * 2.2 * TAU - v.speed) * Math.min(1, dt * 1.5);
      v.angle = (v.angle + v.speed * dt) % TAU;
      drawFanBlades(g, w, color, v.angle);
    } else {
      // Swings about twice a second while powered: motion, not flashing.
      v.swing = live ? Math.sin(t * 2.2 * TAU) * 0.32 * v.glow : v.swing * Math.max(0, 1 - dt * 6);
      drawBell(g, w, color, v.swing, v.glow);
    }
    g.restore();
  };

  const drawCardFront = (b: Bench, box: Box, now: number) => {
    const card = b.card;
    if (!g || !card) return;
    const rows = rowsOf(card);
    const n = rows.length;
    const head = box.height * 0.08;
    const foot = box.height * 0.08;
    const rowH = (box.height - head - foot) / n;
    const ins = b.inputs.map((id) => pieceById(b.circuit, id)?.on ?? false);
    rows.forEach((row, r) => {
      const y = box.y + head + rowH * r;
      const current = row.ins.every((v, i) => v === ins[i]);
      if (current) {
        roundRect(g, box.x + 10, y + 4, box.width - 20, rowH - 8, 20);
        g.lineWidth = 8;
        g.strokeStyle = "#4a7bd9";
        g.stroke();
      }
      const ok = b.rows[r] ?? false;
      const cx = box.x + box.width - box.width * 0.1;
      const cy = y + rowH / 2;
      const r0 = Math.min(rowH * 0.3, box.width * 0.07);
      g.beginPath();
      g.arc(cx, cy, r0, 0, TAU);
      g.fillStyle = ok ? "#3c9c6a" : "#ddd8ca";
      g.fill();
      if (ok) {
        g.strokeStyle = "#ffffff";
        g.lineWidth = r0 * 0.28;
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(cx - r0 * 0.45, cy);
        g.lineTo(cx - r0 * 0.1, cy + r0 * 0.38);
        g.lineTo(cx + r0 * 0.5, cy - r0 * 0.36);
        g.stroke();
      }
    });
    // Progress through the cards.
    const dots = 8;
    const dr = Math.min(foot * 0.22, box.width / (dots * 5));
    for (let i = 0; i < dots; i++) {
      g.beginPath();
      g.arc(
        box.x + box.width / 2 + (i - (dots - 1) / 2) * dr * 3.2,
        box.y + box.height - foot / 2,
        dr,
        0,
        TAU,
      );
      g.fillStyle = i < b.cardIndex ? "#3c9c6a" : i === b.cardIndex ? "#4a7bd9" : "#c9c2ae";
      g.fill();
    }
    if (b.doneAt > Number.NEGATIVE_INFINITY) {
      const age = (now - b.doneAt) / 1000;
      const a = Math.min(1, age * 3);
      roundRect(g, box.x, box.y, box.width, box.height, 28);
      g.fillStyle = withAlpha("#3c9c6a", 0.55 * a);
      g.fill();
      const r0 = Math.min(box.width, box.height) * 0.28 * (0.8 + 0.2 * a);
      g.strokeStyle = withAlpha("#ffffff", a);
      g.lineWidth = r0 * 0.22;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(box.x + box.width / 2 - r0 * 0.6, box.y + box.height / 2);
      g.lineTo(box.x + box.width / 2 - r0 * 0.15, box.y + box.height / 2 + r0 * 0.45);
      g.lineTo(box.x + box.width / 2 + r0 * 0.65, box.y + box.height / 2 - r0 * 0.45);
      g.stroke();
    }
  };

  const drawFx = (b: Bench, now: number) => {
    if (!g) return;
    const l = b.layout;
    for (const f of b.fx) {
      const age = now - f.at;
      const dur = FX_MS[f.kind];
      if (age < 0 || age > dur) continue;
      const u = age / dur;
      if (f.kind === "shake") {
        const dx = Math.sin(u * 30) * l.hit * 0.15 * (1 - u);
        ring(f.x + dx, f.y, l.hit * 0.7, withAlpha("#ff5a4f", 0.9 * (1 - u)), l.wire * 0.6);
      } else if (f.kind === "plug" || f.kind === "place") {
        ring(f.x, f.y, l.hit * (0.4 + 0.9 * u), withAlpha(LIVE, 0.9 * (1 - u)), l.wire * 0.6);
      } else if (f.kind === "spring") {
        const e = 1 - (1 - u) * (1 - u);
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(f.x2, f.y2);
        g.lineTo(f.x + (f.x2 - f.x) * e, f.y + (f.y2 - f.y) * e);
        g.lineWidth = l.wire;
        g.strokeStyle = withAlpha("#8a94a8", 1 - u);
        g.stroke();
      } else if (f.kind === "poof") {
        g.fillStyle = withAlpha("#c6cedd", 0.5 * (1 - u));
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU;
          g.beginPath();
          g.arc(
            f.x + Math.cos(a) * l.hit * u,
            f.y + Math.sin(a) * l.hit * u,
            l.hit * 0.25 * (1 - u * 0.5),
            0,
            TAU,
          );
          g.fill();
        }
      }
    }
  };

  const drawGesture = (b: Bench, gs: Gesture, t: number) => {
    if (!g) return;
    const l = b.layout;
    const c = b.circuit;
    const lead = l.child * 0.35;
    if (gs.t === "wire") {
      const from = pieceById(c, gs.from.piece);
      if (!from) return;
      const port = portOf(l, from, gs.from.pin, b.placement(from));
      if (!port) return;
      let end: Port | null = null;
      if (gs.target) {
        const tp = pieceById(c, gs.target.piece);
        end = tp ? (portOf(l, tp, gs.target.pin, b.placement(tp)) ?? null) : null;
      }
      const live = gs.from.pin < 0 ? from.out : false;
      const curve = end ? route(port, end, lead) : route(port, freeEnd(port, gs.x, gs.y), lead);
      wire(curve, l.wire, live, t, l.child * 0.3);
      if (end) ring(end.x, end.y, l.hit * 0.62, LIVE, l.wire * 0.7);
      else ring(gs.x, gs.y, l.hit * 0.3, withAlpha("#c6cedd", 0.6), l.wire * 0.4);
      return;
    }
    if (gs.t === "replug") {
      const w = c.wires.find((x) => x.id === gs.wire);
      if (!w) return;
      const from = pieceById(c, w.from);
      if (!from) return;
      const port = portOf(l, from, -1, b.placement(from));
      if (!port) return;
      let end: Port | null = null;
      if (gs.target) {
        const tp = pieceById(c, gs.target.piece);
        end = tp ? (portOf(l, tp, gs.target.pin, b.placement(tp)) ?? null) : null;
      }
      const curve = end ? route(port, end, lead) : route(port, freeEnd(port, gs.x, gs.y), lead);
      wire(curve, l.wire, from.out, t, l.child * 0.3);
      if (end) ring(end.x, end.y, l.hit * 0.62, LIVE, l.wire * 0.7);
      return;
    }
    if (gs.t === "move" || gs.t === "new") {
      const kind = gs.t === "new" ? gs.kind : pieceById(c, gs.piece)?.kind;
      if (!kind) return;
      if (gs.target !== null) {
        const s = socketPoint(l, gs.target);
        const size = pieceSize(l, kind);
        roundRect(g, s.x - size.w / 2, s.y - size.h / 2, size.w, size.h, 26);
        g.lineWidth = l.wire * 0.7;
        g.strokeStyle = LIVE;
        g.stroke();
      }
      if (gs.t === "new") {
        g.save();
        g.globalAlpha = 0.85;
        body(l, kind, kind === "switch", 0, gs.x, gs.y);
        g.restore();
      }
      if (gs.t === "move" && gs.toTray) {
        ring(gs.x, gs.y, l.hit * 0.8, withAlpha("#ff5a4f", 0.8), l.wire * 0.6);
      }
    }
  };

  const approach = (v: number, on: boolean, dt: number) =>
    on ? Math.min(1, v + dt * 10) : Math.max(0, v - dt * 10);

  const draw = (views: readonly BenchView[], now: number, dt: number, hands: readonly Point[]) => {
    const l = layout;
    if (!g || !l) return;
    const key = keyOf(views);
    if (key !== backKey) {
      backKey = key;
      drawBack(views);
    }
    prune(views);
    const t = now / 1000;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, frontCanvas.width, frontCanvas.height);
    g.setTransform(k, 0, 0, k, 0, 0);
    views.forEach((v, bi) => {
      const b = v.bench;
      const bl = b.layout;
      const c = b.circuit;
      const posts = b.posts();
      const trick = b.doneAt > Number.NEGATIVE_INFINITY ? (now - b.doneAt) / 1000 : -1;
      g.save();
      roundRect(g, bl.machine.x, bl.machine.y, bl.machine.width, bl.machine.height, 24);
      g.clip();
      v.machine.draw(g, bl.machine, t, trick);
      g.restore();
      // Power lines and the posts.
      bl.posts.forEach((p, i) => {
        const live = posts[i] ?? false;
        const color = colorOf(POST_COLORS, i);
        if (live) {
          polyline(p.line, bl.wire * 1.6, withAlpha(color, 0.9));
          lineDots(p.line, bl.wire * 0.45, t, bl.child * 0.3);
        }
        const end = p.line[p.line.length - 1]!;
        g.beginPath();
        g.arc(end.x, end.y, bl.wire * 1.6, 0, TAU);
        g.fillStyle = live ? color : withAlpha(color, 0.35);
        g.fill();
        g.save();
        g.translate(p.body.x + p.body.width / 2, p.body.y + p.body.height / 2);
        drawPost(g, p.body.width, p.body.height, color, live ? 1 : 0);
        g.restore();
      });
      if (bl.card) drawCardFront(b, bl.card, now);
      const carried = new Set<number>();
      for (const gs of b.gestures.values()) if (gs.t === "move") carried.add(gs.piece);
      // Wires go under the pieces, so a switch or a gate always reads clearly.
      const lead = bl.child * 0.35;
      handles.length = 0;
      for (const w of c.wires) {
        let skip = false;
        for (const gs of b.gestures.values()) {
          if (gs.t === "replug" && gs.wire === w.id) skip = true;
        }
        if (skip) continue;
        const a = pieceById(c, w.from);
        const z = pieceById(c, w.to);
        if (!a || !z) continue;
        const pa = portOf(bl, a, -1, b.placement(a));
        const pz = portOf(bl, z, w.pin, b.placement(z));
        if (!pa || !pz) continue;
        const curve = route(pa, pz, lead);
        wire(curve, bl.wire, a.out, t, bl.child * 0.3);
        if (handles.length < 32) {
          const m = pointOn(curve, 0.5);
          handles.push({ x: m.x, y: m.y, live: a.out });
        }
      }
      // Pieces in their sockets (carried ones follow below).
      for (const p of c.pieces) {
        if (p.kind === "post" || carried.has(p.id)) continue;
        drawPiece(bi, bl, b, p, socketPoint(bl, p.socket), dt, t);
      }
      // Cut handles in the middle of each wire, where no piece covers them.
      for (const h of handles) {
        const covered = c.pieces.some((p) => {
          if (p.kind === "post") return false;
          const at = socketPoint(bl, p.socket);
          const size = pieceSize(bl, p.kind);
          return Math.abs(h.x - at.x) < size.w / 2 && Math.abs(h.y - at.y) < size.h / 2;
        });
        if (covered) continue;
        g.beginPath();
        g.arc(h.x, h.y, bl.wire * 0.95, 0, TAU);
        g.fillStyle = "#070b14";
        g.fill();
        g.lineWidth = bl.wire * 0.3;
        g.strokeStyle = h.live ? LIVE : "#6a7490";
        g.stroke();
      }
      // Ports on top.
      const pr = Math.max(bl.wire * 1.15, bl.hit * 0.24);
      for (const port of b.ports()) {
        const p = pieceById(c, port.piece);
        if (!p) continue;
        if (port.pin < 0) {
          portDot(port, pr, p.out, true);
          continue;
        }
        const w = c.wires.find((x) => x.to === p.id && x.pin === port.pin);
        portDot(port, pr, w ? (pieceById(c, w.from)?.out ?? false) : false, !!w);
      }
      // Carried pieces and drags.
      for (const gs of b.gestures.values()) {
        if (gs.t === "move") {
          const p = pieceById(c, gs.piece);
          if (!p) continue;
          g.save();
          g.globalAlpha = 0.9;
          drawPiece(bi, bl, b, p, { x: gs.x + gs.gx, y: gs.y + gs.gy }, dt, t);
          g.restore();
        }
        drawGesture(b, gs, t);
      }
      drawFx(b, now);
    });
    // Ghost hands over everything.
    const unit = views[0]?.bench.layout.child ?? 200;
    for (const h of hands) {
      g.save();
      g.translate(h.x, h.y);
      drawHand(g, unit * 0.55, 0.75);
      g.restore();
    }
  };

  return {
    setup(frame, l) {
      layout = l;
      k = frame.unit * frame.pixelRatio;
      const w = Math.max(1, Math.round(frame.width * frame.pixelRatio));
      const h = Math.max(1, Math.round(frame.height * frame.pixelRatio));
      for (const c of [backCanvas, frontCanvas]) {
        if (c.width !== w) c.width = w;
        if (c.height !== h) c.height = h;
      }
      sprites.clear();
      keys.length = 0;
      backKey = "";
    },
    draw,
    dispose() {
      sprites.clear();
      vis.clear();
      backCanvas.width = 0;
      backCanvas.height = 0;
      frontCanvas.width = 0;
      frontCanvas.height = 0;
      backCanvas.remove();
      frontCanvas.remove();
    },
  };
};
