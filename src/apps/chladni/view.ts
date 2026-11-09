import { FONT, PALETTE, withAlpha } from "../../core/ui";
import type { Ui } from "../../core/types";
import { figureCopy, noteColor } from "./figure";
import {
  type Box,
  fromPlate,
  type GlideSpec,
  glidePoint,
  type Layout,
  mapRect,
  type Rect,
  type SliderSpec,
  stripPoint,
} from "./layout";
import {
  aspectOf,
  glidePosOf,
  glideScale,
  type GlideScale,
  type Mode,
  type PlateShape,
  type Point,
} from "./modes";

/**
 * The controls as plain DOM over the plate: keys with their figures, glide strips, the stretch
 * and damping sliders, the drive point's puck on each plate and on each map, rims that glow in
 * the ringing note's colour, and soft rings under damping fingers. None of it takes touches (the
 * app hit-tests its own input), except the hold-to-reset buttons from the UI kit. Brightness only
 * ever changes through transitions or smoothed values, never in flashes.
 */
export interface PuckState {
  /** A finger is moving it. */
  held: boolean;
  /** The plate is ringing from it (its ripples show). */
  drive: boolean;
  /** 0 to 1: how surely it sits on the ringing figure's still line (nothing can ring). */
  dead: number;
}

export interface MapState {
  stretch: number;
  wide: boolean;
  /** The drive point, or null when the map has none to show. */
  at: Point | null;
  puck: PuckState;
}

export interface View {
  /** How brightly key `index` glows, 0 to 1 (ringing on the plate). */
  lit(index: number, value: number): void;
  /** A finger is on the key (it sinks a little). */
  pressed(index: number, down: boolean): void;
  /** How well key `index`'s figure can ring from the drive point now, 0 to 1; low dims it. */
  live(index: number, value: number): void;
  /** Where a glide's needle is (0 to 1), and whether someone holds it. Null hides it. */
  needle(index: number, t: number | null, held: boolean): void;
  /** How well each of a glide's notes can ring from the drive point (dims its marks). */
  marksLive(index: number, values: readonly number[]): void;
  /** Where a slider's thumb is (0 to 1) and whether someone holds it. */
  slider(index: number, value: number, held: boolean): void;
  /** Plate `index` is drawn at `rect` (it stretches). */
  plate(index: number, rect: Rect): void;
  /** The drive point on plate `index`, or null to hide its puck. */
  puck(index: number, at: Point | null, state: PuckState): void;
  /** A faint picture of the figure whose still line holds the drive point, or null. */
  ghost(index: number, mode: Mode | null, strength: number): void;
  /** Plate `index`'s rim: colour and glow, 0 to 1. */
  rim(index: number, color: string, glow: number): void;
  /** Damping rings at frame venue points. */
  rings(points: readonly { x: number; y: number }[]): void;
  /** A map's plate shape and drive point. */
  map(index: number, state: MapState): void;
  /** Redraw a map's picture of where the plate is still; `draw` fills an image of the plate. */
  mapPicture(index: number, draw: ((img: ImageData) => void) | null, glow: number): void;
  /** A faint picture on a map of the figure whose still line holds the drive point, or null. */
  mapGhost(index: number, mode: Mode | null, strength: number): void;
  /** Plate `plate`'s key figures, glide marks and stretch icons follow its modes now. */
  restyle(plate: number, modes: readonly Mode[], stretch: number): void;
  glideScale(index: number): GlideScale | null;
  dispose(): void;
}

export interface ViewOptions {
  root: HTMLElement;
  layout: Layout;
  unit: number;
  pixelRatio: number;
  shape: PlateShape;
  /** The plate's modes on the square or unturned plate (keys' colours and glide axes). */
  modes: readonly Mode[];
  /** Puck size on the plates, venue px. */
  puckSize: number;
  /** Which way a plate without a box here (a bank's screen) stretches. */
  wide: boolean;
  ui: Ui;
  onReset(plate: number): void;
}

const STYLE_ID = "chladni-style";
const CSS = `
.ch-key { position:absolute; box-sizing:border-box; pointer-events:none; border-radius:16%;
  transition:transform 0.12s ease-out, opacity 0.35s linear; }
.ch-key.ch-down { transform:scale(0.93); }
.ch-glow { position:absolute; inset:0; border-radius:inherit; opacity:0; transition:opacity 0.35s linear; }
.ch-pic { position:absolute; display:block; }
.ch-track, .ch-mark, .ch-needle, .ch-ring, .ch-rim, .ch-fig, .ch-puck, .ch-map, .ch-ghost, .ch-icon {
  position:absolute; pointer-events:none; box-sizing:border-box; }
.ch-mark { transition:opacity 0.35s linear; }
.ch-needle { transition:opacity 0.3s linear; }
.ch-rim { transition:opacity 0.4s linear, border-color 0.6s linear, box-shadow 0.6s linear; }
.ch-ring { border-radius:50%; transition:opacity 0.25s linear; }
.ch-fig, .ch-ghost { transition:opacity 0.6s linear; }
.ch-puck { border-radius:50%; transition:border-color 0.4s linear, background-color 0.4s linear; }
.ch-puck .ch-wave, .ch-puck .ch-flat { position:absolute; inset:18%; transition:opacity 0.4s linear; }
.ch-puck .ch-move { position:absolute; inset:-32%; transition:opacity 0.3s linear; }
.ch-puck.ch-held .ch-move { opacity:0; }
.ch-puck .ch-wave svg, .ch-puck .ch-flat svg { display:block; width:100%; height:100%; }
.ch-ripple { position:absolute; inset:-2px; border-radius:50%; border-style:solid; opacity:0; }
.ch-driving .ch-ripple { animation:ch-ripple 2.6s ease-out infinite; }
.ch-driving .ch-ripple.ch-late { animation-delay:1.3s; }
@keyframes ch-ripple { 0% { transform:scale(1); opacity:0.5; } 100% { transform:scale(1.9); opacity:0; } }
.ch-hint { animation:ch-breathe 3.2s ease-in-out infinite; }
@keyframes ch-breathe { 0%,100% { opacity:0.55; } 50% { opacity:1; } }
@media (prefers-reduced-motion: reduce) { .ch-hint, .ch-driving .ch-ripple { animation:none; } }
`;

const ensureCss = () => {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
};

const svg = (body: string, view = "0 0 100 100") =>
  `<svg viewBox="${view}" width="100%" height="100%" aria-hidden="true" style="display:block">${body}</svg>`;

const WAVE_PATH = "M14 50 C24 22 34 22 42 50 S60 78 68 50 S80 26 86 50";
const waveIcon = (stroke: number) =>
  svg(
    `<path d="${WAVE_PATH}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round"/>`,
  );
const flatIcon = (stroke: number) =>
  svg(
    `<path d="M14 50 L86 50" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round"/>`,
  );

/** Four small arrows pointing out from a puck. */
const MOVE_ARROWS = svg(
  [0, 90, 180, 270]
    .map(
      (a) =>
        `<path d="M44 9 L50 2 L56 9" transform="rotate(${a} 50 50)" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.7"/>`,
    )
    .join(""),
);

/** A plate outline of the same area as a square, its long side over short side `aspect`. */
const shapeIcon = (aspect: number, wide: boolean) => {
  const long = 56 * Math.sqrt(aspect);
  const short = 56 / Math.sqrt(aspect);
  const w = wide ? long : short;
  const h = wide ? short : long;
  return svg(
    `<rect x="${(50 - w / 2).toFixed(1)}" y="${(50 - h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="none" stroke="currentColor" stroke-width="8"/>`,
  );
};

/** A wave dying away: slowly for a light plate (0), at once for a heavy one (1). */
const ringIcon = (damping: number) => {
  const k = 0.012 + damping * 0.13;
  const pts: string[] = [];
  for (let i = 0; i <= 48; i++) {
    const x = 10 + (80 * i) / 48;
    const s = x - 10;
    const y = 50 - 32 * Math.exp(-k * s) * Math.sin((2 * Math.PI * s) / 20);
    pts.push(`${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return svg(
    `<path d="${pts.join(" ")}" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`,
  );
};

export const MAX_RINGS = 10;
/** Longest side of a key's picture, device px. */
const KEY_PIC_MAX = 180;

export const createView = (opts: ViewOptions): View => {
  ensureCss();
  const { layout, unit, modes } = opts;
  const round = opts.shape === "round";
  const u = (v: number) => `${v * unit}px`;
  const place = (el: HTMLElement, b: Box) => {
    el.style.left = u(b.x);
    el.style.top = u(b.y);
    el.style.width = u(b.width);
    el.style.height = u(b.height);
  };
  const placeRect = (el: HTMLElement, r: Rect, pad = 0) =>
    place(el, {
      x: r.cx - r.width / 2 - pad,
      y: r.cy - r.height / 2 - pad,
      width: r.width + 2 * pad,
      height: r.height + 2 * pad,
    });

  const under = document.createElement("div");
  under.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:1;";
  const layer = document.createElement("div");
  layer.style.cssText = `position:absolute;inset:0;pointer-events:none;z-index:2;font-family:${FONT};`;
  opts.root.append(under, layer);

  const colorOf = (mode: number) => noteColor(mode, modes.length);
  const wideOf = (plate: number) => layout.plates[plate]?.wide ?? opts.wide;
  const stretchOf: number[] = [];

  // ---- Plates: rims, ghosts and pucks --------------------------------------------------------
  interface PlateDom {
    rim: HTMLElement;
    ghost: HTMLElement;
    ghostMode: string;
    puck: HTMLElement;
    rect: Rect;
    rimColor: string;
    rimGlow: number;
    puckKey: string;
  }

  const makePuck = (size: number): HTMLElement => {
    const el = document.createElement("div");
    el.className = "ch-puck";
    el.style.width = u(size);
    el.style.height = u(size);
    const ring = Math.max(2, size * 0.075 * unit);
    el.style.border = `${ring}px solid ${PALETTE.foreground}`;
    el.style.background = withAlpha("#1a2130", 0.92);
    el.style.boxShadow = `0 ${size * 0.05 * unit}px ${size * 0.25 * unit}px rgba(0,0,0,0.6)`;
    el.style.color = PALETTE.foreground;
    for (const late of [false, true]) {
      const r = document.createElement("div");
      r.className = late ? "ch-ripple ch-late" : "ch-ripple";
      r.style.borderWidth = `${Math.max(1.5, ring * 0.6)}px`;
      r.style.borderColor = withAlpha(PALETTE.foreground, 0.7);
      el.append(r);
    }
    const wave = document.createElement("div");
    wave.className = "ch-wave";
    wave.innerHTML = waveIcon(10);
    const flat = document.createElement("div");
    flat.className = "ch-flat";
    flat.innerHTML = flatIcon(10);
    flat.style.opacity = "0";
    // Four small arrows: it can be pushed around.
    const move = document.createElement("div");
    move.className = "ch-move";
    move.innerHTML = MOVE_ARROWS;
    el.append(wave, flat, move);
    el.style.visibility = "hidden";
    return el;
  };

  const setPuck = (
    el: HTMLElement,
    x: number,
    y: number,
    size: number,
    s: PuckState,
    last: string,
  ): string => {
    const dead = Math.round(Math.min(1, Math.max(0, s.dead)) * 10) / 10;
    const key = `${Math.round(x * 2)}:${Math.round(y * 2)}:${s.held ? 1 : 0}:${s.drive ? 1 : 0}:${dead}`;
    if (key === last) return last;
    el.style.visibility = "visible";
    el.style.left = u(x - size / 2);
    el.style.top = u(y - size / 2);
    el.style.transform = s.held ? "scale(1.12)" : "";
    el.classList.toggle("ch-held", s.held);
    const color = dead > 0.5 ? PALETTE.muted : PALETTE.foreground;
    el.style.borderColor = color;
    el.style.color = color;
    el.classList.toggle("ch-driving", s.drive && dead < 0.5);
    const [wave, flat] = [
      el.querySelector<HTMLElement>(".ch-wave"),
      el.querySelector<HTMLElement>(".ch-flat"),
    ];
    if (wave) wave.style.opacity = String(1 - dead);
    if (flat) flat.style.opacity = String(dead);
    return key;
  };

  const plates: PlateDom[] = layout.plates.map((p) => {
    const rect = { cx: p.cx, cy: p.cy, width: p.size, height: p.size };
    const rim = document.createElement("div");
    rim.className = "ch-rim";
    placeRect(rim, rect, 10);
    rim.style.borderRadius = round ? "50%" : u(26);
    rim.style.border = `${Math.max(2, 6 * unit)}px solid ${withAlpha(PALETTE.foreground, 0.2)}`;
    rim.style.opacity = "0";
    const ghost = document.createElement("div");
    ghost.className = "ch-ghost";
    ghost.style.opacity = "0";
    placeRect(ghost, rect);
    const puck = makePuck(opts.puckSize);
    layer.append(rim, ghost, puck);
    return {
      rim,
      ghost,
      ghostMode: "",
      puck,
      rect,
      rimColor: "",
      rimGlow: -1,
      puckKey: "",
    };
  });

  // ---- Keys ---------------------------------------------------------------------------------
  interface KeyDom {
    el: HTMLElement;
    glow: HTMLElement;
    lit: number;
    live: number;
    pic: HTMLCanvasElement | null;
  }
  const keyPicture = (index: number, list: readonly Mode[]): HTMLCanvasElement | null => {
    const k = layout.keys[index]!;
    const mode = list[k.mode];
    if (!mode) return null;
    const color = colorOf(k.mode);
    const inner = k.box.width * 0.74;
    const a = aspectOf(stretchOf[k.plate] ?? 0);
    const w = wideOf(k.plate) ? inner : inner / a;
    const h = wideOf(k.plate) ? inner / a : inner;
    // Key pictures redraw as the plate stretches, so they stay small; they are soft lines anyway.
    const scale = Math.min(unit * opts.pixelRatio, KEY_PIC_MAX / Math.max(w, h));
    const pic = figureCopy(mode, Math.round(w * scale), Math.round(h * scale), {
      line: color,
      plate: "#2a313c",
      weight: 0.045,
    });
    pic.className = "ch-pic";
    pic.style.width = u(w);
    pic.style.height = u(h);
    pic.style.left = u((k.box.width - w) / 2 - 7);
    pic.style.top = u((k.box.height - h) / 2 - 7);
    pic.style.borderRadius = round ? "50%" : u(10);
    return pic;
  };
  const keys: KeyDom[] = layout.keys.map((k, i) => {
    const color = colorOf(k.mode);
    const el = document.createElement("div");
    el.className = "ch-key";
    place(el, k.box);
    el.style.background = withAlpha("#11161f", 0.92);
    el.style.border = `${Math.max(2, 7 * unit)}px solid ${withAlpha(color, 0.75)}`;
    el.style.boxShadow = `0 0 ${18 * unit}px ${withAlpha(color, 0.18)}`;
    const glow = document.createElement("div");
    glow.className = "ch-glow";
    glow.style.background = withAlpha(color, 0.32);
    glow.style.boxShadow = `0 0 ${60 * unit}px ${withAlpha(color, 0.7)}, inset 0 0 ${40 * unit}px ${withAlpha(color, 0.6)}`;
    el.append(glow);
    const pic = keyPicture(i, modes);
    if (pic) el.append(pic);
    layer.append(el);
    return { el, glow, lit: 0, live: 1, pic };
  });

  // ---- Strips: glides and sliders -----------------------------------------------------------
  const track = (b: Box, vertical: boolean, lo: string, hi: string): HTMLElement => {
    const el = document.createElement("div");
    el.className = "ch-track";
    place(el, b);
    const thick = Math.min(b.width, b.height);
    el.style.borderRadius = u(thick / 2);
    el.style.background = `linear-gradient(${vertical ? "0deg" : "90deg"}, ${withAlpha(lo, 0.16)}, ${withAlpha(hi, 0.16)})`;
    el.style.border = `${Math.max(2, 4 * unit)}px solid ${withAlpha(PALETTE.foreground, 0.22)}`;
    layer.append(el);
    return el;
  };
  const groove = (g: { box: Box; vertical: boolean }) => {
    const el = document.createElement("div");
    el.className = "ch-mark";
    const a = stripPoint(g, 0);
    const b = stripPoint(g, 1);
    const gw = 6;
    place(el, {
      x: Math.min(a.x, b.x) - gw / 2,
      y: Math.min(a.y, b.y) - gw / 2,
      width: Math.abs(b.x - a.x) + gw,
      height: Math.abs(b.y - a.y) + gw,
    });
    el.style.borderRadius = u(gw);
    el.style.background = withAlpha(PALETTE.foreground, 0.25);
    layer.append(el);
  };
  const knob = (thick: number, icon: string): HTMLElement => {
    const el = document.createElement("div");
    el.className = "ch-needle";
    const nr = thick * 0.42;
    el.style.width = u(2 * nr);
    el.style.height = u(2 * nr);
    el.style.borderRadius = "50%";
    el.style.background = withAlpha(PALETTE.background, 0.75);
    el.style.border = `${Math.max(2, 6 * unit)}px solid ${PALETTE.foreground}`;
    el.style.color = PALETTE.foreground;
    el.style.padding = u(nr * 0.22);
    el.innerHTML = icon;
    layer.append(el);
    return el;
  };
  const moveKnob = (el: HTMLElement, g: { box: Box; vertical: boolean }, t: number) => {
    const nr = Math.min(g.box.width, g.box.height) * 0.42;
    const p = stripPoint(g, t);
    el.style.left = u(p.x - nr);
    el.style.top = u(p.y - nr);
  };

  interface GlideDom {
    spec: GlideSpec;
    axis: GlideScale;
    scale: GlideScale;
    marks: HTMLElement[];
    live: number[];
    needle: HTMLElement;
    t: number | null;
    held: boolean;
  }
  const glides: GlideDom[] = layout.glides.map((g) => {
    const notes = g.notes.map((i) => modes[i]?.freq ?? 1);
    const freq = (i: number | null) => (i === null ? null : (modes[i]?.freq ?? null));
    const axis = glideScale(notes, freq(g.below), freq(g.above));
    const lo = colorOf(g.notes[0] ?? 0);
    const hi = colorOf(g.notes[g.notes.length - 1] ?? 0);
    track(g.box, g.vertical, lo, hi);
    groove(g);
    const thick = Math.min(g.box.width, g.box.height);
    const marks = g.notes.map((note) => {
      const m = document.createElement("div");
      m.className = "ch-mark";
      const r = thick * 0.17;
      m.style.width = u(2 * r);
      m.style.height = u(2 * r);
      m.style.borderRadius = "50%";
      const c = colorOf(note);
      m.style.background = c;
      m.style.boxShadow = `0 0 ${16 * unit}px ${withAlpha(c, 0.6)}`;
      layer.append(m);
      return m;
    });
    const needle = knob(thick, waveIcon(9));
    needle.style.opacity = "0";
    return {
      spec: g,
      axis,
      scale: axis,
      marks,
      live: g.notes.map(() => 1),
      needle,
      t: null,
      held: false,
    };
  });
  const placeMarks = (d: GlideDom) => {
    const r = Math.min(d.spec.box.width, d.spec.box.height) * 0.17;
    d.scale.marks.forEach((t, i) => {
      const m = d.marks[i];
      if (!m) return;
      if (t === null) {
        m.style.visibility = "hidden";
        return;
      }
      const p = glidePoint(d.spec, t);
      m.style.visibility = "visible";
      m.style.left = u(p.x - r);
      m.style.top = u(p.y - r);
    });
  };
  glides.forEach(placeMarks);

  const moveNeedle = (d: GlideDom) => {
    if (d.t === null) {
      d.needle.style.opacity = "0";
      return;
    }
    moveKnob(d.needle, d.spec, d.t);
    d.needle.style.opacity = d.held ? "1" : "0.55";
  };

  interface SliderDom {
    spec: SliderSpec;
    thumb: HTMLElement;
    icon: HTMLElement;
    value: number;
    held: boolean;
    iconKey: string;
  }
  const sliderIcon = (s: SliderSpec, value: number) =>
    s.knob === "stretch" ? shapeIcon(aspectOf(value), wideOf(s.plate)) : ringIcon(value);
  const sliders: SliderDom[] = layout.sliders.map((s) => {
    track(s.box, s.vertical, PALETTE.muted, PALETTE.foreground);
    groove(s);
    // The ends say what the slider does: square to long plate, long ring to short.
    const thick = Math.min(s.box.width, s.box.height);
    for (const t of [0, 1]) {
      const el = document.createElement("div");
      el.className = "ch-icon";
      const size = thick * 0.6;
      const p = stripPoint(s, t);
      place(el, { x: p.x - size / 2, y: p.y - size / 2, width: size, height: size });
      el.style.color = withAlpha(PALETTE.foreground, 0.55);
      el.innerHTML =
        s.knob === "stretch" ? shapeIcon(t === 0 ? 1 : 2, wideOf(s.plate)) : ringIcon(t);
      layer.append(el);
    }
    const thumb = knob(thick, "");
    const icon = document.createElement("div");
    icon.style.cssText = "width:100%;height:100%;";
    thumb.append(icon);
    return { spec: s, thumb, icon, value: -1, held: false, iconKey: "" };
  });

  // ---- Maps ---------------------------------------------------------------------------------
  interface MapDom {
    box: Box;
    plate: HTMLElement;
    canvas: HTMLCanvasElement;
    img: ImageData | null;
    ghost: HTMLElement;
    ghostMode: string;
    puck: HTMLElement;
    puckSize: number;
    rect: Rect;
    key: string;
    puckKey: string;
    glow: number;
  }
  const maps: MapDom[] = layout.maps.map((m) => {
    const plate = document.createElement("div");
    plate.className = "ch-map";
    plate.style.background = withAlpha("#1c222c", 0.95);
    plate.style.border = `${Math.max(2, 5 * unit)}px solid ${withAlpha(PALETTE.foreground, 0.25)}`;
    plate.style.borderRadius = round ? "50%" : u(16);
    plate.style.boxShadow = `0 ${8 * unit}px ${30 * unit}px rgba(0,0,0,0.6)`;
    plate.style.overflow = "hidden";
    const canvas = document.createElement("canvas");
    canvas.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;display:block;opacity:0;transition:opacity 0.6s linear;";
    plate.append(canvas);
    const ghost = document.createElement("div");
    ghost.className = "ch-ghost";
    ghost.style.cssText += "inset:0;opacity:0;";
    plate.append(ghost);
    under.append(plate);
    const puckSize = Math.max(56, Math.min(m.box.width, m.box.height) * 0.14);
    const puck = makePuck(puckSize);
    layer.append(puck);
    return {
      box: m.box,
      plate,
      canvas,
      img: null,
      ghost,
      ghostMode: "",
      puck,
      puckSize,
      rect: mapRect(m.box, 0, true),
      key: "",
      puckKey: "",
      glow: -1,
    };
  });
  // A bank frame's maps point up to the screen whose plate they show.
  const hints: HTMLElement[] = [];
  if (layout.mode === "keyboard") {
    for (const m of layout.maps) {
      const hint = document.createElement("div");
      hint.className = "ch-fig ch-hint";
      const hs = 120;
      place(hint, {
        x: m.box.x + m.box.width / 2 - hs / 2,
        y: Math.max(0, m.box.y - hs * 0.5 - 14),
        width: hs,
        height: hs * 0.5,
      });
      hint.innerHTML = svg(
        `<path d="M12 44 L50 8 L88 44" fill="none" stroke="${withAlpha(PALETTE.foreground, 0.5)}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`,
        "0 0 100 50",
      );
      layer.append(hint);
      hints.push(hint);
    }
  }

  // ---- Resets -------------------------------------------------------------------------------
  const resets = layout.resets.map((r) =>
    opts.ui.button({
      icon: "reset",
      rect: {
        x: r.box.x * unit,
        y: r.box.y * unit,
        width: r.box.width * unit,
        height: r.box.height * unit,
      },
      hold: 1500,
      look: "ghost",
      color: PALETTE.muted,
      onPress: () => opts.onReset(r.plate),
    }),
  );

  // ---- Damping rings ------------------------------------------------------------------------
  const rings: HTMLElement[] = [];
  const ringSize = 150;
  for (let i = 0; i < MAX_RINGS; i++) {
    const el = document.createElement("div");
    el.className = "ch-ring";
    el.style.width = u(ringSize);
    el.style.height = u(ringSize);
    el.style.border = `${Math.max(2, 5 * unit)}px solid ${withAlpha(PALETTE.foreground, 0.55)}`;
    el.style.boxShadow = `0 0 ${30 * unit}px ${withAlpha(PALETTE.foreground, 0.3)}, inset 0 0 ${24 * unit}px ${withAlpha(PALETTE.foreground, 0.25)}`;
    el.style.opacity = "0";
    layer.append(el);
    rings.push(el);
  }

  const ghostInto = (
    el: HTMLElement,
    mode: Mode | null,
    strength: number,
    width: number,
    height: number,
    last: string,
  ): string => {
    const id = mode
      ? `${mode.index}:${mode.a.toFixed(3)}:${mode.b.toFixed(3)}:${mode.turn.toFixed(2)}`
      : "";
    if (id !== last) {
      el.replaceChildren();
      if (mode) {
        const scale = 192 / Math.max(width, height);
        const pic = figureCopy(mode, Math.round(width * scale), Math.round(height * scale), {
          line: PALETTE.foreground,
          plate: null,
          weight: 0.014,
        });
        pic.style.cssText = "width:100%;height:100%;display:block;";
        el.append(pic);
      }
    }
    const o = mode ? String(Math.round(Math.min(1, strength) * 20) / 20) : "0";
    if (el.style.opacity !== o) el.style.opacity = o;
    return id;
  };

  return {
    lit(index, value) {
      const k = keys[index];
      if (!k) return;
      const v = Math.round(Math.min(1, Math.max(0, value)) * 20) / 20;
      if (v === k.lit) return;
      k.lit = v;
      k.glow.style.opacity = String(v);
    },
    pressed(index, down) {
      keys[index]?.el.classList.toggle("ch-down", down);
    },
    live(index, value) {
      const k = keys[index];
      if (!k) return;
      const v = Math.round(Math.min(1, Math.max(0, value)) * 10) / 10;
      if (v === k.live) return;
      k.live = v;
      k.el.style.opacity = String(0.38 + 0.62 * v);
    },
    needle(index, t, held) {
      const d = glides[index];
      if (!d) return;
      const tt = t === null ? null : Math.round(t * 1000) / 1000;
      if (tt === d.t && held === d.held) return;
      d.t = tt;
      d.held = held;
      moveNeedle(d);
    },
    marksLive(index, values) {
      const d = glides[index];
      if (!d) return;
      values.forEach((v, i) => {
        const q = Math.round(Math.min(1, Math.max(0, v)) * 10) / 10;
        if (q === d.live[i]) return;
        d.live[i] = q;
        const m = d.marks[i];
        if (m) m.style.opacity = String(0.3 + 0.7 * q);
      });
    },
    slider(index, value, held) {
      const d = sliders[index];
      if (!d) return;
      const v = Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
      if (v !== d.value) {
        d.value = v;
        moveKnob(d.thumb, d.spec, v);
        const iconKey = String(Math.round(v * 40));
        if (iconKey !== d.iconKey) {
          d.iconKey = iconKey;
          d.icon.innerHTML = sliderIcon(d.spec, v);
        }
      }
      if (held !== d.held) {
        d.held = held;
        d.thumb.style.transform = held ? "scale(1.1)" : "";
      }
    },
    plate(index, rect) {
      const d = plates[index];
      if (!d) return;
      const r = d.rect;
      if (
        Math.abs(r.width - rect.width) < 0.5 &&
        Math.abs(r.height - rect.height) < 0.5 &&
        Math.abs(r.cx - rect.cx) < 0.5 &&
        Math.abs(r.cy - rect.cy) < 0.5
      ) {
        return;
      }
      d.rect = { ...rect };
      placeRect(d.rim, rect, 10);
      placeRect(d.ghost, rect);
      d.puckKey = "";
    },
    puck(index, at, state) {
      const d = plates[index];
      if (!d) return;
      if (!at) {
        d.puck.style.visibility = "hidden";
        d.puckKey = "";
        return;
      }
      const p = fromPlate(d.rect, at);
      d.puckKey = setPuck(d.puck, p.x, p.y, opts.puckSize, state, d.puckKey);
    },
    ghost(index, mode, strength) {
      const d = plates[index];
      if (!d) return;
      d.ghostMode = ghostInto(
        d.ghost,
        mode,
        strength * 0.45,
        d.rect.width,
        d.rect.height,
        d.ghostMode,
      );
    },
    rim(index, color, glow) {
      const d = plates[index];
      if (!d) return;
      const g = Math.round(Math.min(1, Math.max(0, glow)) * 20) / 20;
      if (color !== d.rimColor) {
        d.rimColor = color;
        d.rim.style.borderColor = withAlpha(color, 0.85);
        d.rim.style.boxShadow = `0 0 ${50 * unit}px ${withAlpha(color, 0.55)}, inset 0 0 ${30 * unit}px ${withAlpha(color, 0.3)}`;
      }
      if (g !== d.rimGlow) {
        d.rimGlow = g;
        d.rim.style.opacity = String(0.25 + 0.75 * g);
      }
    },
    rings(points) {
      rings.forEach((el, i) => {
        const p = points[i];
        if (!p) {
          if (el.style.opacity !== "0") el.style.opacity = "0";
          return;
        }
        el.style.left = u(p.x - ringSize / 2);
        el.style.top = u(p.y - ringSize / 2);
        el.style.opacity = "1";
      });
    },
    map(index, state) {
      const d = maps[index];
      if (!d) return;
      const key = `${Math.round(state.stretch * 200)}:${state.wide}`;
      if (key !== d.key) {
        d.key = key;
        d.rect = mapRect(d.box, state.stretch, state.wide);
        placeRect(d.plate, d.rect);
      }
      if (!state.at) {
        d.puck.style.visibility = "hidden";
        d.puckKey = "";
        return;
      }
      const p = fromPlate(d.rect, state.at);
      d.puckKey = setPuck(d.puck, p.x, p.y, d.puckSize, state.puck, d.puckKey);
    },
    mapPicture(index, draw, glow) {
      const d = maps[index];
      if (!d) return;
      if (draw) {
        const scale = 128 / Math.max(d.rect.width, d.rect.height);
        const w = Math.max(8, Math.round(d.rect.width * scale));
        const h = Math.max(8, Math.round(d.rect.height * scale));
        if (d.canvas.width !== w || d.canvas.height !== h || !d.img) {
          d.canvas.width = w;
          d.canvas.height = h;
          d.img = new ImageData(w, h);
        }
        draw(d.img);
        d.canvas.getContext("2d")?.putImageData(d.img, 0, 0);
      }
      const g = Math.round(Math.min(1, Math.max(0, glow)) * 20) / 20;
      if (g !== d.glow) {
        d.glow = g;
        d.canvas.style.opacity = String(g);
      }
      for (const h of hints) h.style.visibility = g > 0.5 ? "hidden" : "visible";
    },
    mapGhost(index, mode, strength) {
      const d = maps[index];
      if (!d) return;
      d.ghostMode = ghostInto(
        d.ghost,
        mode,
        strength * 0.6,
        d.rect.width,
        d.rect.height,
        d.ghostMode,
      );
    },
    restyle(plate, list, stretch) {
      stretchOf[plate] = stretch;
      keys.forEach((k, i) => {
        if (layout.keys[i]!.plate !== plate) return;
        const pic = keyPicture(i, list);
        k.pic?.remove();
        k.pic = pic;
        if (pic) k.el.append(pic);
      });
      for (const d of glides) {
        const g = d.spec;
        if (g.plate !== plate) continue;
        const freq = (i: number | null) => (i === null ? null : (list[i]?.freq ?? null));
        d.scale = glideScale(
          g.notes.map((i) => list[i]?.freq ?? 1),
          freq(g.below),
          freq(g.above),
          d.axis,
        );
        placeMarks(d);
      }
      for (const s of sliders) {
        if (s.spec.plate !== plate) continue;
        s.iconKey = "";
        s.value = -1;
      }
    },
    glideScale(index) {
      return glides[index]?.scale ?? null;
    },
    dispose() {
      layer.remove();
      under.remove();
      for (const r of resets) r.remove();
    },
  };
};

/** Where a frequency sits along a glide, for a needle that follows someone else's drive. */
export const needleFor = (scale: GlideScale, f: number | null): number | null =>
  f === null ? null : glidePosOf(scale, f);
