/**
 * Chapter 2, can light cancel light.
 *
 * - Watch view: two waves and their sum, the second pushed along by the dial; the sum grows to
 *   twice the height in step and flattens half a wave apart, and a band beside it glows as bright
 *   as the sum's height squared.
 * - Figure: the beam through two slits in a wall; their waves spread and cross, cancelling along
 *   calm lines and adding between them, and a screen at the far side shows bright and dark
 *   fringes. Adults drag the lower slit along the wall (it stays where it is let go); the dial
 *   pushes that slit's wave too, sliding the fringes.
 * - Children: the dial. Adults: the slit, and the wavelength.
 * - Linked formula y = A sin(360° · x/λ + φ), φ in degrees: y, A, x and λ on the first wave, φ as
 *   the second wave's push. The rows read "Wave 1", "Wave 2" and "Together" with the brackets
 *   hidden; with the Maths open (its fold then covers the caption and figure, not the waves) they
 *   read y₁, y₂ and y₁ + y₂ and the λ, A and φ brackets show.
 * - Key move: a full add then a full cancel, or the other way round.
 */
import { withAlpha } from "../../../../core/ui/palette";
import { TEXT } from "../../captions";
import type { Chapter, ChapterDef, ChapterEnv, DemoStep } from "../../chapter";
import { COLOR } from "../../config";
import {
  type Control,
  font,
  pad,
  type Pad,
  rotary,
  type Rotary,
  slider,
  type Slider,
} from "../../controls";
import { bracket, clipTo, disc, glow, label, line, TAU, well } from "../../draw";
import { presence } from "../../formula";
import { type CardLayout, centre, type Rect } from "../../layout";
import {
  apart,
  brightness,
  decode,
  DETENT,
  encode,
  type Extreme,
  extremeAt,
  fringe,
  type InterferenceState,
  pushInWaves,
  START,
  STATE_RANGES,
  sumHeight,
} from "./physics";

const T = TEXT.interference;
const L = T.labels;

export const PARTS = {
  y: COLOR.ink,
  A: COLOR.accent,
  x: COLOR.real,
  lam: COLOR.beam,
  phi: COLOR.scattered,
} as const;

const DEG = Math.PI / 180;
/** Wavelengths across the watch view's waves at the usual wavelength. */
const WAVES_ACROSS = 3.2;
/** The figure's wavelength at the usual wavelength, venue px. */
const FIGURE_LAMBDA = 30;
/** Field cells, venue px. */
const CELL = 4;
/** Slit separation range, in wavelengths of the usual wavelength. */
const GAP_MIN = 2;

type Spot = { part: string; x: number; y: number };

/** The watch view: two waves, their sum and how bright it is. */
const drawRows = (
  g: CanvasRenderingContext2D,
  r: Rect,
  s: InterferenceState,
  o: {
    now: number;
    size: number;
    /** Symbols and their brackets, for the open Maths; plain words otherwise. */
    maths?: boolean;
    level?: (part: string) => number;
    alpha?: (part: string) => number;
  },
): Spot[] => {
  const level = o.level ?? (() => 0);
  const alpha = o.alpha ?? (() => 1);
  const maths = o.maths ?? false;
  well(g, r);
  const pad = Math.max(16, r.height * 0.05);
  const names = maths ? [L.y1!, L.y2!, L.sum!] : [L.wave1!, L.wave2!, L.together!];
  const nameSize = o.size * (maths ? 0.9 : 0.8);
  g.font = maths
    ? `italic 700 ${Math.round(nameSize)}px Georgia, "Times New Roman", serif`
    : font(700, nameSize);
  const nameW = Math.min(
    r.width * 0.3,
    Math.max(o.size * 2.9, ...names.map((n) => g.measureText(n).width + o.size * 0.7)),
  );
  // Strokes grow with the text, so the screen's big copy reads as well as a panel's.
  const u = Math.max(1, o.size / 38);
  const lampW = Math.min(190 * u, r.width * 0.17);
  const x0 = r.x + pad + nameW;
  const x1 = r.x + r.width - pad - lampW - pad;
  // With the Maths open the first row's λ sits above it, so the rows start a little lower.
  const top = pad + (maths ? o.size * 0.55 : 0);
  const rowH = (r.height - top - pad) / 3;
  const ys = [0, 1, 2].map((i) => r.y + top + rowH * (i + 0.5));
  const amp = rowH * 0.2;
  const lam = ((x1 - x0) / WAVES_ACROSS) * (s.lam / 100);
  const wt = (o.now / 1000) * TAU * 0.35;
  const phi = s.phi * DEG;
  const colours = [COLOR.beam, COLOR.scattered, COLOR.ink];
  ys.forEach((y, i) => {
    line(g, x0, y, x1, y, withAlpha(COLOR.ink, 0.14), 2 * u);
    label(g, names[i]!, x0 - 16 * u, y, {
      size: nameSize,
      align: "right",
      color: colours[i]!,
      italic: maths,
      weight: 800,
    });
  });
  const plot = (
    y: number,
    a: number,
    ph: number,
    colour: string,
    width: number,
    dash?: number[],
    al = 1,
  ) => {
    g.save();
    g.globalAlpha = al;
    g.strokeStyle = colour;
    g.lineWidth = width;
    g.lineJoin = "round";
    if (dash) g.setLineDash(dash);
    g.beginPath();
    for (let x = x0; x <= x1 + 0.5; x += 3) {
      const v = y - a * Math.sin(((x - x0) / lam) * TAU - wt + ph);
      if (x === x0) g.moveTo(x, v);
      else g.lineTo(x, v);
    }
    g.stroke();
    g.restore();
  };
  // The first wave, the second (with the first faintly behind it to measure the push), the sum.
  const yA = alpha("y");
  plot(ys[0]!, amp, 0, COLOR.beam, 5 * u * (1 + 0.6 * level("y")), undefined, Math.max(yA, 0.5));
  plot(ys[1]!, amp, 0, COLOR.beam, 2 * u, [6 * u, 8 * u], 0.35);
  plot(
    ys[1]!,
    amp,
    phi,
    COLOR.scattered,
    5 * u * (1 + 0.6 * level("phi")),
    undefined,
    alpha("phi"),
  );
  const h = sumHeight(s.phi);
  plot(ys[2]!, amp * Math.cos(phi / 2) * 2, phi / 2, COLOR.ink, 6 * u);
  for (const k of [-1, 1])
    line(
      g,
      x0,
      ys[2]! + k * amp * h,
      x1,
      ys[2]! + k * amp * h,
      withAlpha(COLOR.ink, 0.3),
      2,
      [10, 10],
    );
  // Crests of the first wave sit where (x - x0)/λ - ωt/2π = 1/4 + n.
  const crestAt = (ph: number, from: number) => {
    const f = (((0.25 + (wt - ph) / TAU) % 1) + 1) % 1;
    let x = x0 + f * lam;
    while (x < from) x += lam;
    return x;
  };
  const spots: Spot[] = [];
  const c1 = crestAt(0, x0 + lam * 0.15);
  if (maths && c1 + lam < x1) {
    const by = ys[0]! - amp - 18;
    g.save();
    g.globalAlpha = alpha("lam");
    bracket(g, c1, by, c1 + lam, by, {
      label: "λ",
      color: COLOR.beam,
      width: 4 * u * (1 + 1.4 * level("lam")),
      size: o.size,
    });
    g.restore();
    spots.push({ part: "lam", x: c1 + lam / 2, y: by - o.size * 0.6 });
  }
  if (maths) {
    const ax = c1 + lam;
    const xA = ax < x1 ? ax : c1;
    g.save();
    g.globalAlpha = alpha("A");
    bracket(g, xA + 14, ys[0]!, xA + 14, ys[0]! - amp, {
      label: "A",
      color: COLOR.accent,
      width: 4 * u * (1 + 1.4 * level("A")),
      size: o.size * 0.85,
      side: -1,
    });
    g.restore();
    spots.push({ part: "A", x: xA + 14, y: ys[0]! - amp / 2 });
  }
  // The push: from a crest of the first wave to the same crest of the second.
  const shift = pushInWaves(s.phi) * lam;
  if (maths && shift > 6 && shift < lam - 6) {
    const from = crestAt(0, x0 + lam * 0.6);
    const to = from - shift;
    const by = ys[1]! - amp - 16;
    g.save();
    g.globalAlpha = alpha("phi");
    bracket(g, from, by, to, by, {
      label: "φ",
      color: COLOR.scattered,
      width: 4 * u * (1 + 1.4 * level("phi")),
      size: o.size,
    });
    g.restore();
    spots.push({ part: "phi", x: (from + to) / 2, y: by - o.size * 0.6 });
  }
  // x and y at one point on the first wave, while either pulses.
  const lx = level("x");
  const ly = level("y");
  if (lx > 0 || ly > 0) {
    const px = x0 + (x1 - x0) * 0.42;
    const py = ys[0]! - amp * Math.sin(((px - x0) / lam) * TAU - wt);
    line(g, x0, ys[0]! + amp + 12, px, ys[0]! + amp + 12, COLOR.real, 5 * (1 + lx));
    label(g, "x", (x0 + px) / 2, ys[0]! + amp + 12 + o.size * 0.6, {
      size: o.size,
      color: COLOR.real,
      italic: true,
    });
    line(g, px, ys[0]!, px, py, COLOR.ink, 5 * (1 + ly));
    disc(g, px, py, 9, COLOR.ink);
  }
  // How bright the sum is: a band that glows as the height squared.
  const I = brightness(s.phi);
  const lamp: Rect = {
    x: x1 + pad,
    y: ys[1]! - rowH * 0.3,
    width: lampW,
    height: ys[2]! - ys[1]! + rowH * 0.75,
  };
  const lc = centre(lamp);
  g.save();
  g.fillStyle = withAlpha(COLOR.recip, 0.06 + 0.9 * I);
  g.shadowColor = withAlpha(COLOR.recip, 0.8 * I);
  g.shadowBlur = 50 * I;
  g.beginPath();
  g.roundRect(lc.x - lampW * 0.18, lamp.y, lampW * 0.36, lamp.height, 14);
  g.fill();
  g.restore();
  glow(g, lc.x, lc.y, lampW * 0.55, COLOR.recip, I * 0.8);
  const word = I > 0.92 ? L.bright : I < 0.04 ? L.dark : null;
  if (word)
    label(g, word, lc.x, lamp.y - o.size * 0.55, {
      size: o.size * 0.85,
      color: I > 0.5 ? COLOR.recip : COLOR.muted,
      weight: 800,
    });
  return spots;
};

const def: ChapterDef = {
  id: "interference",
  state: STATE_RANGES,
  start: encode(START),
  play(t) {
    // The second wave pushed slowly along, through in step and half a wave apart.
    return encode({ phi: (t * 24) % 360, lam: 100 });
  },
  parts: PARTS,
  // The fold covers the caption and figure, so the waves stay in view with their symbols.
  foldOver: "figure",
  watch(g, rect, state, look) {
    drawRows(g, rect, decode(state), {
      now: look.now,
      size: Math.max(22, Math.min(rect.height * 0.06, rect.width * 0.032, 90)),
    });
  },
  create(env: ChapterEnv): Chapter {
    let s: InterferenceState = { phi: START.phi, lam: START.lam };
    let card: CardLayout | null = null;
    let controls: Control[] = [];
    let dial: Rotary | null = null;
    let lamSlider: Slider | null = null;
    let slit: Pad | null = null;
    let last: Extreme | null = null;
    let watchSpots: Spot[] = [];
    /** The lower slit's height, venue px; null until laid out or after a reset. */
    let slitY: number | null = null;
    let grab: { id: number; dy: number } | null = null;
    // The figure's geometry and its field image.
    let geo: {
      dir: 1 | -1;
      wall: number;
      screen: number;
      s1: number;
      lo: number;
      hi: number;
      home: number;
    } | null = null;
    let img: { canvas: HTMLCanvasElement; data: ImageData; w: number; h: number } | null = null;
    let kr1: Float32Array | null = null;
    let kr2: Float32Array | null = null;
    let near: Float32Array | null = null;
    let fieldKey = "";

    const lamF = () => FIGURE_LAMBDA * (s.lam / 100);

    const make = (l: CardLayout) => {
      const c = l.child;
      const a = l.adult;
      const f = l.figure;
      const atRight = l.outer === "right";
      const size = Math.min(c.height - 8, l.target * 2.3, c.width * 0.42);
      dial = rotary({
        id: "dial",
        rect: {
          x: atRight ? c.x + c.width - size : c.x,
          y: c.y + (c.height - size) / 2,
          width: size,
          height: size,
        },
        band: "child",
        min: 0,
        max: 360,
        value: s.phi,
        perTurn: 360,
        wrap: true,
        style: "wheel",
        color: COLOR.scattered,
        hub: (g, b) => {
          // Two little waves in the hub, the second pushed along with the dial.
          const w = b.width;
          for (const [k, colour, ph] of [
            [-0.18, COLOR.beam, 0],
            [0.18, COLOR.scattered, s.phi * DEG],
          ] as const) {
            g.save();
            g.strokeStyle = colour;
            g.lineWidth = Math.max(3, w * 0.06);
            g.beginPath();
            for (let i = 0; i <= 24; i++) {
              const x = b.x + (i / 24) * w;
              const y = b.y + w / 2 + k * w - w * 0.12 * Math.sin((i / 24) * TAU * 1.5 + ph);
              if (i === 0) g.moveTo(x, y);
              else g.lineTo(x, y);
            }
            g.stroke();
            g.restore();
          }
        },
        onChange: (v) => {
          s = { ...s, phi: v };
        },
      });
      lamSlider = slider({
        id: "lam",
        rect: {
          ...a,
          y: a.y + a.height - Math.min(a.height, l.target * 1.25),
          height: Math.min(a.height, l.target * 1.25),
        },
        band: "adult",
        label: L.lam!,
        min: 60,
        max: 160,
        step: 1,
        value: s.lam,
        color: COLOR.beam,
        size: l.type.label,
        onChange: (v) => {
          s = { ...s, lam: v };
        },
      });
      // The wall with two slits, on the card's outer side; the screen on the far side.
      const dir: 1 | -1 = atRight ? -1 : 1;
      const wall = atRight ? f.x + f.width * 0.74 : f.x + f.width * 0.26;
      const screen = atRight ? f.x + 46 : f.x + f.width - 46;
      const margin = Math.max(44, l.target * 0.45);
      const s1 = f.y + margin;
      const lo = s1 + GAP_MIN * FIGURE_LAMBDA * 1.6;
      const hi = f.y + f.height - margin;
      const home = Math.min(hi, s1 + 5 * FIGURE_LAMBDA);
      geo = { dir, wall, screen, s1, lo, hi, home };
      slitY = slitY === null ? home : Math.max(lo, Math.min(hi, slitY));
      const g0 = geo;
      const knob = Math.max(l.target, 130);
      slit = pad({
        id: "slit",
        rect: { x: wall - knob / 2, y: (slitY ?? home) - knob / 2, width: knob, height: knob },
        band: "adult",
        onDown: (t) => {
          grab = { id: t.id, dy: (slitY ?? g0.home) - t.y };
        },
        onMove: (t) => {
          if (!grab || grab.id !== t.id) return;
          slitY = Math.max(g0.lo, Math.min(g0.hi, t.y + grab.dy));
        },
        onUp: () => {
          grab = null;
        },
        botGesture: (rand, to) => {
          const from = slitY ?? g0.home;
          const target = g0.lo + (to ?? rand()) * (g0.hi - g0.lo);
          return {
            path: Array.from({ length: 9 }, (_, i) => ({
              x: g0.wall,
              y: from + ((target - from) * i) / 8,
            })),
            ms: 900,
          };
        },
      });
      controls = [dial, lamSlider, slit];
    };

    const sync = () => {
      if (dial && !dial.held) dial.value = s.phi;
      if (lamSlider && !lamSlider.held) lamSlider.value = s.lam;
      if (slit && geo && slitY !== null) {
        const k = slit.rect.width;
        slit.rect = { x: geo.wall - k / 2, y: slitY - k / 2, width: k, height: k };
      }
    };

    /** Distances from each field cell to the two slits, in radians of the wave, when they change. */
    const ensureField = (f: Rect) => {
      if (!geo || slitY === null) return;
      const x0 = geo.dir === 1 ? geo.wall : geo.screen;
      const x1 = geo.dir === 1 ? geo.screen : geo.wall;
      const w = Math.max(1, Math.round((x1 - x0) / CELL));
      const h = Math.max(1, Math.round(f.height / CELL));
      const key = `${w}x${h}:${geo.wall}:${f.y}:${slitY.toFixed(1)}:${s.lam}`;
      if (key === fieldKey && img) return;
      fieldKey = key;
      if (!img || img.w !== w || img.h !== h) {
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d")!;
        img = { canvas, data: ctx.createImageData(w, h), w, h };
        kr1 = new Float32Array(w * h);
        kr2 = new Float32Array(w * h);
        near = new Float32Array(w * h);
      }
      const k = TAU / lamF();
      for (let j = 0; j < h; j++) {
        const y = f.y + (j + 0.5) * CELL;
        for (let i = 0; i < w; i++) {
          const x = x0 + (i + 0.5) * CELL;
          const dx = x - geo.wall;
          const r1 = Math.hypot(dx, y - geo.s1);
          const r2 = Math.hypot(dx, y - slitY);
          const n = j * w + i;
          kr1![n] = k * r1;
          kr2![n] = k * r2;
          // Waves weaken as they spread; close to a slit they fade in from nothing.
          near![n] =
            Math.min(1, Math.sqrt(60 / Math.max(20, Math.min(r1, r2)))) *
            Math.min(1, Math.abs(dx) / 30);
        }
      }
    };

    const drawField = (g: CanvasRenderingContext2D, l: CardLayout, now: number) => {
      const f = l.figure;
      if (!geo || slitY === null) return;
      well(g, f, { fill: withAlpha(COLOR.well, 0.85) });
      clipTo(g, f, 28);
      ensureField(f);
      const wt = (now / 1000) * TAU * 0.9;
      const phi = s.phi * DEG;
      if (img && kr1 && kr2 && near) {
        const d = img.data.data;
        const n = img.w * img.h;
        for (let i = 0; i < n; i++) {
          const v = (Math.cos(kr1[i]! - wt) + Math.cos(kr2[i]! - wt + phi)) * 0.5 * near[i]!;
          const t = 0.5 + 0.5 * Math.max(-1, Math.min(1, v * 1.3));
          const o = i * 4;
          d[o] = 8 + t * 140;
          d[o + 1] = 12 + t * 170;
          d[o + 2] = 26 + t * 225;
          d[o + 3] = 255;
        }
        img.canvas.getContext("2d")!.putImageData(img.data, 0, 0);
        const x0 = geo.dir === 1 ? geo.wall : geo.screen;
        const x1 = geo.dir === 1 ? geo.screen : geo.wall;
        g.save();
        g.imageSmoothingEnabled = true;
        g.globalAlpha = 0.9;
        g.drawImage(img.canvas, x0, f.y, x1 - x0, img.h * CELL);
        g.restore();
      }
      // The beam arrives as flat wavefronts on the near side of the wall.
      const lf = lamF();
      const near0 = geo.dir === 1 ? f.x : geo.wall;
      const near1 = geo.dir === 1 ? geo.wall : f.x + f.width;
      const off = ((((now / 1000) * 0.9 * lf) % lf) + lf) % lf;
      const la = presence(env.link, "lam", now);
      for (
        let x = geo.wall - geo.dir * (lf - off);
        geo.dir === 1 ? x > near0 : x < near1;
        x -= geo.dir * lf
      ) {
        line(g, x, f.y + 10, x, f.y + f.height - 10, withAlpha(COLOR.beam, 0.35 * la), 3);
      }
      line(g, near0, l.beamY, near1, l.beamY, withAlpha(COLOR.beam, 0.8), 6);
      // The wall and its slits (hardware, green), the lower slit a handle.
      const gap = Math.max(10, lf * 0.55);
      const segs: [number, number][] = [];
      const holes = [geo.s1, slitY].sort((p, q) => p - q);
      let y = f.y;
      for (const hy of holes) {
        segs.push([y, hy - gap / 2]);
        y = hy + gap / 2;
      }
      segs.push([y, f.y + f.height]);
      for (const [a, b] of segs) if (b > a) line(g, geo.wall, a, geo.wall, b, COLOR.real, 12);
      glow(g, geo.wall, geo.s1, 28, COLOR.beam, 0.6);
      const held = slit?.held ?? false;
      glow(g, geo.wall, slitY, held ? 70 : 46, COLOR.scattered, held ? 0.9 : 0.55);
      g.save();
      g.strokeStyle = COLOR.scattered;
      g.lineWidth = 6;
      g.beginPath();
      g.arc(geo.wall, slitY, 34, 0, TAU);
      g.stroke();
      // Up and down arrows: it slides along the wall.
      g.fillStyle = COLOR.scattered;
      for (const k of [-1, 1]) {
        g.beginPath();
        g.moveTo(geo.wall - 12, slitY + k * 44);
        g.lineTo(geo.wall + 12, slitY + k * 44);
        g.lineTo(geo.wall, slitY + k * 60);
        g.closePath();
        g.fill();
      }
      g.restore();
      // The screen: bright where the waves arrive in step, dark where they cancel.
      const sw = 22;
      const sx = geo.screen - sw / 2;
      const bandH = 3;
      for (let yy = f.y; yy < f.y + f.height; yy += bandH) {
        const yc = yy + bandH / 2;
        const dx = geo.screen - geo.wall;
        const I = fringe(Math.hypot(dx, yc - geo.s1), Math.hypot(dx, yc - slitY), lf, s.phi);
        g.fillStyle = withAlpha(COLOR.recip, 0.08 + 0.92 * I);
        g.fillRect(sx, yy, sw, bandH + 0.5);
      }
      g.restore();
      // What the figure shows: the wall's two slits, near its top, and the screen, near its foot.
      const ls = l.type.label * 0.8;
      const tag = (text: string, x: number, y: number, align: "left" | "right") => {
        g.save();
        g.font = font(800, ls);
        const w = g.measureText(text).width;
        const bx = align === "right" ? x - w - ls * 0.4 : x - ls * 0.4;
        g.fillStyle = withAlpha(COLOR.well, 0.85);
        g.beginPath();
        g.roundRect(bx, y - ls * 0.72, w + ls * 0.8, ls * 1.44, ls * 0.72);
        g.fill();
        g.restore();
        label(g, text, x, y, { size: ls, align, color: COLOR.ink, weight: 800 });
      };
      const side = geo.dir === 1 ? "right" : "left";
      tag(L.slits!, geo.wall - geo.dir * 48, f.y + ls * 1.1, side);
      tag(L.screen!, geo.screen - geo.dir * 30, f.y + f.height - ls * 1.1, side);
    };

    return {
      layout(l) {
        card = l;
        make(l);
      },
      get controls() {
        return controls;
      },
      update(dt) {
        // Let go near in step or half a wave apart, and the dial settles there.
        if (dial && !dial.held) {
          for (const target of [0, 180, 360]) {
            const d = apart(s.phi, target);
            if (d > 0.05 && d < DETENT) {
              const delta = ((((target - s.phi) % 360) + 540) % 360) - 180;
              const step = delta * Math.min(1, dt * 7);
              s = { ...s, phi: (((s.phi + step) % 360) + 360) % 360 };
              break;
            }
          }
        }
        sync();
        const e = extremeAt(s.phi);
        if (e && e !== last) {
          if (last !== null) env.earn();
          last = e;
        }
      },
      draw(g, now) {
        if (!card) return;
        const link = env.link;
        watchSpots = drawRows(g, card.watch, s, {
          now,
          size: card.type.label,
          maths: env.mathsOpen?.() ?? false,
          level: (p) => link.level(p, now),
          alpha: (p) => presence(link, p, now),
        });
        drawField(g, card, now);
        if (dial) {
          // What the dial does, and in step or half a wave apart when it is.
          const c = card.child;
          const atRight = card.outer === "right";
          const room = c.width - dial.rect.width - 40;
          const x = atRight ? dial.rect.x - 28 : dial.rect.x + dial.rect.width + 28;
          const align = atRight ? "right" : "left";
          const size = card.type.label;
          label(g, L.dial!, x, c.y + c.height * 0.36, {
            size,
            align,
            color: COLOR.ink,
            weight: 800,
          });
          const e = extremeAt(s.phi, 3);
          const word = e === "add" ? L.inStep : e === "cancel" ? L.halfApart : null;
          if (word && room > 0)
            label(g, word, x, c.y + c.height * 0.66, {
              size: size * 0.9,
              align,
              color: e === "add" ? COLOR.recip : COLOR.muted,
              weight: 700,
            });
        }
      },
      partAt(x, y) {
        for (const sp of watchSpots) if (Math.hypot(x - sp.x, y - sp.y) < 72) return sp.part;
        return null;
      },
      numbers() {
        const push = pushInWaves(s.phi);
        const gapW = geo && slitY !== null ? (slitY - geo.s1) / lamF() : 0;
        return [
          `φ = ${Math.round(s.phi)}°, a push of ${push.toFixed(2)} λ`,
          `height of the sum 2A cos(φ/2) = ${sumHeight(s.phi).toFixed(2)} A`,
          `brightness ${Math.round(brightness(s.phi) * 100)} % of the most`,
          `slits ${gapW.toFixed(1)} λ apart`,
        ];
      },
      state: () => encode(s),
      demo(): DemoStep[] {
        return [
          { control: "dial", to: 0, ms: 1800 },
          { wait: 1400 },
          { control: "dial", to: 180, ms: 2600 },
          { wait: 1600 },
          { control: "slit", to: 0.85, ms: 1400 },
          { wait: 1200 },
        ];
      },
      hint() {
        return dial ? centre(dial.rect) : null;
      },
      status() {
        return {
          phi: Math.round(s.phi),
          bright: Math.round(brightness(s.phi) * 100) / 100,
          lam: s.lam,
          slit: geo && slitY !== null ? Math.round(((slitY - geo.s1) / lamF()) * 10) / 10 : 0,
        };
      },
      reset() {
        s = { phi: START.phi, lam: START.lam };
        last = null;
        grab = null;
        slitY = geo ? geo.home : null;
        sync();
      },
      show() {},
      dispose() {
        controls = [];
        img = null;
        kr1 = null;
        kr2 = null;
        near = null;
      },
    };
  },
};

export default def;
