/**
 * Drawing a touch frame. Two canvases: the back one holds the frame's static look (background,
 * slot panels, rails, and the scenery of its own build when it has one) and is redrawn only on
 * layout, mode or theme changes; the front one is drawn every frame (tasks, ghost hands, parts
 * popping out and leaving, the top strip's order cards or the frame's own build).
 */
import type { FrameInfo } from "../../core/types";
import { withAlpha } from "../../core/ui";
import { drawIcon } from "./art";
import type { Build } from "./build";
import { MADE_MS, SLIDE_MS, type ThemeId } from "./config";
import { type Box, type Layout, slotsOf } from "./layout";
import {
  type Colors,
  type Confetti,
  createConfetti,
  drawBuild,
  drawIdleHelpers,
  drawIncoming,
  drawScene,
  drawSun,
  drawTrophies,
  type Fit,
  fitBuild,
} from "./scene";
import type { Slot } from "./slot";
import { circle, roundRect, TAU } from "./tasks/common";

/** A finished part showing in its slot before it leaves. */
export interface Pop {
  slot: number;
  kind: number;
  theme: ThemeId;
  color: string;
  at: number;
  /** The ghost's practice part: it fades instead of leaving. */
  practice: boolean;
}

/** A part rising off the top edge towards the screen. */
export interface Exit {
  kind: number;
  theme: ThemeId;
  color: string;
  x: number;
  y0: number;
  departAt: number;
  exitAt: number;
}

export interface StationLook {
  color: string;
  /** Order kind, -1 when there is none. */
  order: number;
}

export interface FrameState {
  layout: Layout;
  slots: readonly Slot[];
  /** Which station each slot belongs to. */
  slotStation: readonly number[];
  stations: readonly StationLook[];
  pops: readonly Pop[];
  exits: readonly Exit[];
  /** The frame's own build (solo, or a bank panel without its screen), else null. */
  local: { build: Build; trophies: number } | null;
  /** The screen's build as last heard, in bank mode. */
  remote: {
    theme: ThemeId;
    made: number;
    total: number;
    start: number;
    end: number;
    phase: string;
  } | null;
  /** Shared clock ms, for builds; local ms for everything else. */
  clock: number;
  now: number;
  /** Seconds, for idle motion. */
  time: number;
  /** Ghost hands are drawn on slots the ghost plays. */
  ghosts: boolean;
}

export const EXIT_SIZE = 190;

export interface FrameView {
  setup(frame: FrameInfo, layout: Layout, stationColors: readonly string[]): void;
  /** Redraw the back layer (call when the theme or mode changes). */
  back(theme: ThemeId | null): void;
  draw(s: FrameState): void;
  /** Where the frame's own build sits. */
  fit(theme: ThemeId): Fit;
  celebrate(early: boolean, now: number, seed: number): void;
  dispose(): void;
}

const BG = "#070b16";
const PANEL = "#0d1426";
const RAIL = "#111a30";

export const createFrameView = (root: HTMLElement, colors: Colors, seed: string): FrameView => {
  const make = (z: number) => {
    const c = document.createElement("canvas");
    c.style.cssText = `position:absolute;inset:0;width:100%;height:100%;z-index:${z};pointer-events:none;`;
    root.append(c);
    return c;
  };
  const backCanvas = make(0);
  const frontCanvas = make(1);
  const back = backCanvas.getContext("2d");
  const g = frontCanvas.getContext("2d");
  let layout: Layout | null = null;
  let k = 1;
  let theme: ThemeId | null = null;
  let slotColors: string[] = [];
  let stationColors: readonly string[] = [];
  const confetti: Confetti = createConfetti();

  const fitFor = (th: ThemeId): Fit => {
    const l = layout!;
    const wall = l.kind === "wall";
    return fitBuild(
      l.top,
      th,
      wall ? { height: 0.86, bottom: 0.97 } : { height: 0.82, bottom: 0.965 },
    );
  };

  const drawBack = () => {
    const l = layout;
    if (!back || !l) return;
    back.setTransform(1, 0, 0, 1, 0, 0);
    back.clearRect(0, 0, backCanvas.width, backCanvas.height);
    back.setTransform(k, 0, 0, k, 0, 0);
    back.fillStyle = BG;
    back.fillRect(0, 0, l.width, l.height);
    // A faint pegboard, so the frame reads as a workshop.
    back.fillStyle = "rgba(255,255,255,0.035)";
    const step = l.kind === "wall" ? 60 : 48;
    for (let y = step / 2; y < l.height; y += step) {
      for (let x = step / 2; x < l.width; x += step) {
        circle(back, x, y, 4);
        back.fill();
      }
    }
    if (theme) drawScene(back, theme, l.top, fitFor(theme), seed);
    else {
      back.fillStyle = "#0a1020";
      back.fillRect(l.top.x, l.top.y, l.top.w, l.top.h);
    }
    if (l.scene) {
      // Without adult slots, the space between is a conveyor the parts ride up.
      const sc = l.scene;
      for (const st of l.stations) {
        const cx = (st.x0 + st.x1) / 2;
        const w = Math.min(160, (st.x1 - st.x0) * 0.18);
        back.fillStyle = "rgba(120,140,180,0.12)";
        roundRect(back, cx - w / 2, sc.y, w, sc.h, w * 0.3);
        back.fill();
        back.strokeStyle = "rgba(120,140,180,0.25)";
        back.lineWidth = 4;
        for (let y = sc.y + 30; y < sc.y + sc.h; y += 60) {
          back.beginPath();
          back.moveTo(cx - w * 0.3, y + 15);
          back.lineTo(cx, y);
          back.lineTo(cx + w * 0.3, y + 15);
          back.stroke();
        }
      }
    }
    for (const { station, spec } of slotsOf(l)) {
      const r = spec.rect;
      const color = stationColors[station] ?? "#6fa4fc";
      back.fillStyle = PANEL;
      roundRect(back, r.x, r.y, r.w, r.h, 28);
      back.fill();
      back.strokeStyle = withAlpha(color, 0.4);
      back.lineWidth = 5;
      back.stroke();
      back.fillStyle = RAIL;
      roundRect(back, spec.rail.x + 6, spec.rail.y + 6, spec.rail.w - 12, spec.rail.h - 12, 22);
      back.fill();
    }
  };

  const drawGhostHand = (x: number, y: number, s: number, t: number) => {
    if (!g) return;
    const pulse = (Math.sin(t * 6) + 1) / 2;
    g.strokeStyle = `rgba(255,255,255,${0.25 + pulse * 0.25})`;
    g.lineWidth = s * 0.03;
    circle(g, x, y, s * (0.16 + pulse * 0.05));
    g.stroke();
    g.fillStyle = "rgba(235,242,255,0.5)";
    g.strokeStyle = "rgba(10,16,30,0.45)";
    g.lineWidth = s * 0.025;
    roundRect(g, x - s * 0.075, y - s * 0.02, s * 0.15, s * 0.52, s * 0.075);
    g.fill();
    g.stroke();
    roundRect(g, x - s * 0.1, y + s * 0.34, s * 0.42, s * 0.36, s * 0.1);
    g.fill();
    g.stroke();
    for (let i = 0; i < 3; i++) {
      roundRect(g, x + s * (0.06 + i * 0.085), y + s * 0.28, s * 0.09, s * 0.16, s * 0.045);
      g.fill();
    }
    roundRect(g, x - s * 0.2, y + s * 0.42, s * 0.13, s * 0.09, s * 0.045);
    g.fill();
  };

  const drawSlot = (s: FrameState, slot: Slot, i: number) => {
    if (!g) return;
    const spec = slot.spec;
    const t = spec.task;
    const color = slotColors[i] ?? "#6fa4fc";
    const since = s.now - slot.phaseAt;
    let dx = 0;
    let alpha = 1;
    if (slot.phase === "slide") {
      const p = Math.min(1, since / SLIDE_MS);
      dx = (1 - p) * (1 - p) * t.w * 0.6;
      alpha = p;
    } else if (slot.phase === "made") {
      alpha = Math.max(0, 1 - since / (MADE_MS * 0.6));
    }
    if (alpha > 0) {
      g.save();
      g.beginPath();
      g.rect(t.x, t.y, t.w, t.h);
      g.clip();
      g.globalAlpha = alpha;
      g.translate(t.x + dx, t.y);
      slot.task.draw(g, s.time);
      g.restore();
      g.globalAlpha = 1;
    }
    // Progress up the rail.
    const rail = spec.rail;
    const home = layout?.home;
    const homeHere =
      home &&
      home.x >= rail.x - 1 &&
      home.x + home.w <= rail.x + rail.w + 1 &&
      home.y >= rail.y &&
      home.y < rail.y + rail.h;
    const top = homeHere ? home.y + home.h + 20 : spec.reset.y + spec.reset.r + 24;
    const bottom = rail.y + rail.h - 24;
    if (bottom - top > 40) {
      const w = Math.min(44, rail.w * 0.32);
      const x = rail.x + rail.w / 2 - w / 2;
      g.fillStyle = "rgba(220,230,250,0.1)";
      roundRect(g, x, top, w, bottom - top, w / 2);
      g.fill();
      const p = slot.phase === "play" ? slot.task.progress : slot.phase === "made" ? 1 : 0;
      if (p > 0) {
        const h = Math.max(w, (bottom - top) * p);
        g.fillStyle = color;
        roundRect(g, x, bottom - h, w, h, w / 2);
        g.fill();
      }
    }
    if (s.ghosts && slot.who === "ghost") {
      const size = spec.coarse ? 230 : 190;
      for (const f of slot.player.fingers) {
        if (f) drawGhostHand(t.x + f.x, t.y + f.y, size, s.time);
      }
    } else if (slot.who === "bot") {
      g.strokeStyle = "rgba(255,255,255,0.45)";
      g.lineWidth = 4;
      for (const f of slot.player.fingers) {
        if (!f) continue;
        circle(g, t.x + f.x, t.y + f.y, 26);
        g.stroke();
      }
    }
  };

  const drawPop = (s: FrameState, p: Pop) => {
    if (!g) return;
    const slot = s.slots[p.slot];
    if (!slot) return;
    const t = slot.spec.task;
    const age = s.now - p.at;
    if (age < 0 || age > MADE_MS + (p.practice ? 700 : 0)) return;
    const k = Math.min(1, age / (MADE_MS * 0.45));
    const scale = k < 1 ? 1.18 * Math.sin((k * Math.PI) / 2) : 1;
    const cx = t.x + t.w / 2;
    const cy = t.y + t.h / 2;
    const size = Math.min(EXIT_SIZE * 1.15, t.h * 0.7, t.w * 0.5);
    const fade = p.practice ? Math.max(0, 1 - Math.max(0, age - MADE_MS) / 700) : 1;
    g.globalAlpha = fade;
    g.strokeStyle = withAlpha(p.color, Math.max(0, 1 - age / MADE_MS) * 0.9);
    g.lineWidth = 10;
    circle(g, cx, cy, size * (0.5 + age / MADE_MS));
    g.stroke();
    g.fillStyle = withAlpha(p.color, 0.3);
    circle(g, cx, cy, size * 0.62 * scale);
    g.fill();
    drawIcon(g, p.theme, p.kind, cx, cy, size * 0.8 * scale, s.time);
    if (p.practice) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + age / 400;
        const r = size * (0.6 + age / 1500);
        g.fillStyle = "rgba(255,255,255,0.8)";
        circle(g, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 6);
        g.fill();
      }
    }
    g.globalAlpha = 1;
  };

  const drawExit = (s: FrameState, e: Exit) => {
    if (!g || s.now < e.departAt) return;
    const span = Math.max(1, e.exitAt - e.departAt);
    const p = (s.now - e.departAt) / span;
    const y = e.y0 * (1 - p * p);
    if (y < -EXIT_SIZE) return;
    g.strokeStyle = withAlpha(e.color, 0.35);
    g.lineWidth = EXIT_SIZE * 0.3;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(e.x, y + Math.min(EXIT_SIZE * 1.4, e.y0 * p * 0.5));
    g.lineTo(e.x, y);
    g.stroke();
    g.fillStyle = withAlpha(e.color, 0.3);
    circle(g, e.x, y, EXIT_SIZE * 0.6);
    g.fill();
    drawIcon(g, e.theme, e.kind, e.x, y, EXIT_SIZE * 0.8, s.time);
  };

  const drawOrderCard = (s: FrameState, box: Box, look: StationLook) => {
    if (!g) return;
    const r = s.remote;
    const x = box.x + 8;
    const y = box.y + 6;
    const w = box.w - 16;
    const h = box.h - 12;
    g.fillStyle = "#111a30";
    roundRect(g, x, y, w, h, 34);
    g.fill();
    g.strokeStyle = withAlpha(look.color, 0.8);
    g.lineWidth = 8;
    g.stroke();
    if (!r || look.order < 0) {
      for (let i = 0; i < 3; i++) {
        g.fillStyle = `rgba(220,230,250,${0.2 + 0.3 * ((Math.sin(s.time * 4 - i) + 1) / 2)})`;
        circle(g, x + w / 2 + (i - 1) * 50, y + h / 2, 14);
        g.fill();
      }
      return;
    }
    const icon = Math.min(h * 0.66, w * 0.34);
    const ix = x + w * 0.33;
    const iy = y + h * 0.5;
    g.fillStyle = withAlpha(look.color, 0.22);
    circle(g, ix, iy, icon * 0.66);
    g.fill();
    drawIcon(g, r.theme, look.order, ix, iy, icon, s.time);
    // Chevrons climbing beside it: parts go up to the screen.
    const cx = x + w * 0.58;
    const step = Math.min(h * 0.22, 70);
    g.lineWidth = Math.max(6, step * 0.16);
    g.lineCap = "round";
    g.lineJoin = "round";
    for (let i = 0; i < 3; i++) {
      const k = (s.time * 0.8 + i / 3) % 1;
      const cy = y + h * 0.82 - k * h * 0.62;
      g.strokeStyle = withAlpha(look.color, Math.sin(k * Math.PI) * 0.9);
      g.beginPath();
      g.moveTo(cx - step * 0.55, cy + step * 0.3);
      g.lineTo(cx, cy - step * 0.25);
      g.lineTo(cx + step * 0.55, cy + step * 0.3);
      g.stroke();
    }
    // The build's progress, and the time left as a dot running round the ring.
    const rr = Math.min(h * 0.3, w * 0.13);
    const rx = x + w * 0.79;
    const ry = y + h / 2;
    g.strokeStyle = "rgba(220,230,250,0.16)";
    g.lineWidth = rr * 0.3;
    circle(g, rx, ry, rr);
    g.stroke();
    const p = r.total > 0 ? r.made / r.total : 0;
    g.strokeStyle = r.phase === "alive" ? look.color : "#e9eef8";
    g.beginPath();
    g.arc(rx, ry, rr, -Math.PI / 2, -Math.PI / 2 + TAU * p);
    g.stroke();
    const left =
      r.phase === "alive"
        ? 0
        : Math.max(0, Math.min(1, (r.end - s.clock) / Math.max(1, r.end - r.start)));
    const a = -Math.PI / 2 + TAU * (1 - left);
    g.fillStyle = left < 0.1 ? "#ff9d4a" : "#ffd84a";
    circle(g, rx + Math.cos(a) * rr * 1.55, ry + Math.sin(a) * rr * 1.55, rr * 0.2);
    g.fill();
  };

  const drawChip = (s: FrameState, box: Box, look: StationLook, th: ThemeId) => {
    if (!g || look.order < 0) return;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    g.fillStyle = "rgba(10,16,30,0.75)";
    circle(g, cx, cy, box.w / 2);
    g.fill();
    g.strokeStyle = look.color;
    g.lineWidth = 7;
    g.stroke();
    drawIcon(g, th, look.order, cx, cy, box.w * 0.62, s.time);
  };

  return {
    setup(frame, l, colorsOf) {
      layout = l;
      stationColors = colorsOf;
      k = frame.unit * frame.pixelRatio;
      const w = Math.max(1, Math.round(frame.width * frame.pixelRatio));
      const h = Math.max(1, Math.round(frame.height * frame.pixelRatio));
      for (const c of [backCanvas, frontCanvas]) {
        if (c.width !== w) c.width = w;
        if (c.height !== h) c.height = h;
      }
      drawBack();
    },
    back(th) {
      theme = th;
      drawBack();
    },
    fit: fitFor,
    draw(s) {
      const l = layout;
      if (!g || !l) return;
      slotColors = s.slots.map((_, i) => s.stations[s.slotStation[i] ?? 0]?.color ?? "#6fa4fc");
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, frontCanvas.width, frontCanvas.height);
      g.setTransform(k, 0, 0, k, 0, 0);
      s.slots.forEach((slot, i) => drawSlot(s, slot, i));
      for (const p of s.pops) drawPop(s, p);
      if (s.local) {
        const b = s.local.build;
        const f = fitFor(b.theme);
        g.save();
        g.beginPath();
        g.rect(l.top.x, l.top.y, l.top.w, l.top.h);
        g.clip();
        drawBuild(g, b, f, s.clock, { colors, time: s.time });
        const sun = Math.min(l.top.h * 0.055, 70);
        drawSun(g, b, { ...l.top, h: l.top.h * 0.5 }, s.clock, sun);
        drawTrophies(g, s.local.trophies, l.top, Math.min(l.top.h * 0.13, 110), "right");
        drawIdleHelpers(g, b, f, s.time, l.kind === "wall" ? 3 : 2, Math.max(36, f.s * 0.07));
        confetti.draw(g, s.now);
        g.restore();
        drawIncoming(g, b, f, l.top, s.clock, {
          colors,
          time: s.time,
          startSize: EXIT_SIZE * 0.8,
          rise: 0,
          helper: Math.max(40, f.s * 0.09),
        });
        if (l.kind === "wall") {
          l.stations.forEach((st, i) => {
            const look = s.stations[i];
            if (look) drawChip(s, st.badge, look, b.theme);
          });
        }
      } else {
        l.stations.forEach((st, i) => {
          const look = s.stations[i];
          if (look) drawOrderCard(s, st.badge, look);
        });
      }
      for (const e of s.exits) drawExit(s, e);
    },
    celebrate(early, now, seedN) {
      if (!layout) return;
      confetti.start(layout.top, early ? 140 : 60, seedN, now);
    },
    dispose() {
      backCanvas.remove();
      frontCanvas.remove();
    },
  };
};
