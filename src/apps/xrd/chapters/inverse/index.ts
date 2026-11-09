/**
 * Chapter 7, why small things make big patterns. A flat crystal's spots sit 1/a apart, so
 * squashing the crystal one way spreads its pattern the other way, and the pattern turns with the
 * crystal; a crystal with fewer repeats makes fatter spots, about 1/L wide for a crystal L across.
 *
 * - Watch view: the engine's pattern of the crystal, the middle of it enlarged, with the 1/a step
 *   marked and one spot labelled as one set of layers.
 * - Figure: the crystal itself, N by N atoms, with three grips a finger can hold: one stretches it
 *   sideways, one up and down, one turns it (dragging the crystal anywhere else turns it too). It
 *   is drawn as big as the starting crystal fits, and shrinks only when stretching it further
 *   would take it past the figure's edge. The beam crosses it.
 * - Children: tall, square and wide tiles. Adults: the repeats slider, and the grips.
 * - Linked formula spacing = 1/a: the step between spots on the pattern, a cell's edge a.
 */
import { withAlpha } from "../../../../core/ui/palette";
import { COMMON, TEXT } from "../../captions";
import type {
  Chapter,
  ChapterDef,
  ChapterEnv,
  ChapterState,
  DemoStep,
  MachineDrive,
} from "../../chapter";
import { COLOR } from "../../config";
import {
  type Choice,
  choice,
  type Control,
  type Gesture,
  type IconDraw,
  pad,
  type Pad,
  type Slider,
  slider,
  type Touch,
} from "../../controls";
import { beam, bracket, clipTo, cornerTag, DEG, disc, drawWrapped, label, well } from "../../draw";
import type { PatternView } from "../../engine/client";
import { emphasis, presence } from "../../formula";
import { type CardLayout, centre, inset, type Rect, splitRow, square } from "../../layout";
import { spotLabel } from "../patterns/spotlabel";
import {
  A_MAX,
  A_MIN,
  A_PER_PX,
  clean,
  decode,
  encode,
  type InverseState,
  jobKey,
  N_MAX,
  N_MIN,
  patternJob,
  playAt,
  SHAPES,
  shapeOf,
  sizeOf,
  squashed,
  START,
  STATE_RANGES,
  steps,
  taper,
} from "./model";

const T = TEXT.inverse;
const L = T.labels;

export const PARTS = { S: COLOR.recip, a: COLOR.real } as const;

/** Grips: their radius (a 120 px target), and how far their centres sit past the crystal's edge. */
export const GRIP_R = 60;
export const GRIP_OFF = 32;
/** Least distance between two grips' centres, so neither covers the other. */
export const GRIP_APART = 2 * GRIP_R + 8;
const K_MAX = 46;
/** A grip's face lets the atoms under it show through a little. */
const GRIP_FILL = withAlpha(COLOR.background, 0.7);
/** The watch view shows the pattern out to this |S| either way, Å⁻¹: the middle of the grid. */
export const ZOOM_S = 0.75;
/** The spot the "One set of layers" label points at: (0 1), the rows across b. */
const LABEL_SPOT: readonly [number, number] = [0, 1];
/** How long the repeats line stays after the slider moves, ms. */
const NOTE_MS = 9000;

type Grip = "a" | "b" | "turn";

interface Geo {
  cx: number;
  cy: number;
  /** px per Å. */
  k: number;
  /** All three grips in a row beside the crystal, for a figure too short to hold one above it. */
  beside: boolean;
}

/** A figure shorter than this, venue px, puts the grips beside the crystal (the kiosk's). */
const BESIDE_BELOW = 320;

/** Screen unit vectors of the crystal's a and b edges (screen y runs down). */
const axes = (turn: number) => {
  const th = turn * DEG;
  return {
    ax: { x: Math.cos(th), y: -Math.sin(th) },
    ay: { x: -Math.sin(th), y: -Math.cos(th) },
  };
};

/**
 * Where the grips sit along the crystal's own axes (u along a, v along b), px from its middle:
 * just past the edges, and on a small crystal pushed out sideways, where every figure has room,
 * so that none covers another.
 */
export const gripPlaces = (W: number, H: number, beside: boolean) => {
  if (beside) {
    const ua = Math.max(W + GRIP_OFF, GRIP_APART / 2);
    return {
      a: { u: ua, v: 0 },
      b: { u: -ua, v: 0 },
      turn: { u: ua + GRIP_APART, v: 0 },
    };
  }
  const v = H + GRIP_OFF;
  const ua = Math.max(W + GRIP_OFF, Math.sqrt(Math.max(0, GRIP_APART ** 2 - v * v)));
  const ut = Math.max(
    W + GRIP_OFF,
    ua + Math.sqrt(Math.max(0, GRIP_APART ** 2 - v * v)),
    GRIP_APART,
  );
  return { a: { u: ua, v: 0 }, b: { u: 0, v }, turn: { u: ut, v } };
};

/** Points round the centre (px) that must stay inside the figure: corners, grips, the bracket. */
const extentPoints = (s: InverseState, k: number, beside: boolean) => {
  const { ax, ay } = axes(s.turn);
  const W = (s.repeats * s.a * k) / 2;
  const H = (s.repeats * s.b * k) / 2;
  const at = (u: number, v: number, r: number) => ({
    x: ax.x * u + ay.x * v,
    y: ax.y * u + ay.y * v,
    r,
  });
  const gp = gripPlaces(W, H, beside);
  return [
    at(W, H, 14),
    at(-W, H, 14),
    at(W, -H, 14),
    at(-W, -H, 14),
    at(gp.a.u, gp.a.v, GRIP_R),
    at(gp.b.u, gp.b.v, GRIP_R),
    at(gp.turn.u, gp.turn.v, GRIP_R),
    beside ? at(-W + s.a * k * 0.5, -H - 46, 26) : at(-W, -H - 6, 20),
  ];
};

const bounds = (s: InverseState, k: number, beside: boolean) => {
  let l = 0;
  let r = 0;
  let t = 0;
  let b = 0;
  for (const p of extentPoints(s, k, beside)) {
    l = Math.max(l, -(p.x - p.r));
    r = Math.max(r, p.x + p.r);
    t = Math.max(t, -(p.y - p.r));
    b = Math.max(b, p.y + p.r);
  }
  return { l, r, t, b };
};

/**
 * The largest scale, up to `kMax`, that keeps the crystal and its grips inside `hot`, centred on
 * the beam.
 */
const fit = (s: InverseState, hot: Rect, beamY: number, kMax = K_MAX): Geo => {
  let lo = 0.5;
  let hi = Math.max(lo, kMax);
  const beside = hot.height < BESIDE_BELOW;
  const ok = (k: number) => {
    const e = bounds(s, k, beside);
    return e.l + e.r <= hot.width && e.t + e.b <= hot.height;
  };
  if (ok(hi)) lo = hi;
  else
    for (let i = 0; i < 22; i++) {
      const m = (lo + hi) / 2;
      if (ok(m)) lo = m;
      else hi = m;
    }
  const k = lo;
  const e = bounds(s, k, beside);
  const place = (want: number, min: number, max: number) =>
    min <= max ? Math.max(min, Math.min(max, want)) : (min + max) / 2;
  return {
    k,
    cx: place(hot.x + hot.width / 2, hot.x + e.l, hot.x + hot.width - e.r),
    cy: place(beamY, hot.y + e.t, hot.y + hot.height - e.b),
    beside,
  };
};

const gripsOf = (s: InverseState, g: Geo) => {
  const { ax, ay } = axes(s.turn);
  const W = (s.repeats * s.a * g.k) / 2;
  const H = (s.repeats * s.b * g.k) / 2;
  const at = (p: { u: number; v: number }) => ({
    x: g.cx + ax.x * p.u + ay.x * p.v,
    y: g.cy + ax.y * p.u + ay.y * p.v,
  });
  const gp = gripPlaces(W, H, g.beside);
  return { a: at(gp.a), b: at(gp.b), turn: at(gp.turn) };
};

/** The cell-shape icons: a little block of dots, tall, square or wide. */
const shapeIcon =
  (i: number): IconDraw =>
  (g, b, color) => {
    const sh = SHAPES[i]!;
    const k = (b.width * 0.36) / Math.max(sh.a, sh.b);
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    for (let u = -1; u <= 1; u++)
      for (let v = -1; v <= 1; v++)
        disc(g, cx + u * sh.a * k, cy + v * sh.b * k, b.width * 0.07, color);
  };

/**
 * The pattern with the 1/a step, the note beside it when there is room; returns its square and
 * how many px one Å⁻¹ takes there. The middle of the engine's picture is enlarged to fill the
 * square, so the spots read from across the room.
 */
const drawWatch = (
  g: CanvasRenderingContext2D,
  r: Rect,
  s: InverseState,
  view: PatternView,
  n: number,
  o: {
    size: number;
    sLevel?: number;
    dim?: number;
    note?: string | null;
    layers?: string | null;
  },
): { sq: Rect; pxPerS: number } => {
  well(g, r);
  // Strokes follow the type size, so the screen's big copy reads like a panel's.
  const k = o.size / 38;
  const sq = square(inset(r, 12 * k));
  view.want(jobKey(s, n), () => patternJob(s, n));
  // The whole picture spans ±1/(2 A_PER_PX) Å⁻¹; draw it bigger, cut to the square.
  const grow = 1 / (2 * A_PER_PX * ZOOM_S);
  const c = centre(sq);
  const pic = {
    x: c.x - (sq.width * grow) / 2,
    y: c.y - (sq.height * grow) / 2,
    width: sq.width * grow,
    height: sq.height * grow,
  };
  clipTo(g, sq, 20);
  view.draw(g, pic);
  g.restore();
  // The step to the (1 0) spot: 1/a along the crystal's a edge.
  const pxPerS = pic.width * A_PER_PX;
  const { as, bs } = steps(s);
  const ex = c.x + as[0] * pxPerS;
  const ey = c.y - as[1] * pxPerS;
  const lvl = o.sLevel ?? 0;
  g.save();
  g.globalAlpha = o.dim ?? 1;
  bracket(g, c.x, c.y, ex, ey, {
    label: "1/a",
    color: COLOR.recip,
    width: 4 * k * (1 + lvl),
    size: o.size,
    // Its letter goes under the step, clear of the (0 1) spot the layers label marks.
    side: -1,
  });
  g.restore();
  cornerTag(g, r, COMMON.flat, { size: o.size * 0.8, corner: "bl" });
  if (o.layers && !o.note && view.shown !== null) {
    const [h, kk] = LABEL_SPOT;
    const spot = {
      x: c.x + (h * as[0] + kk * bs[0]) * pxPerS,
      y: c.y - (h * as[1] + kk * bs[1]) * pxPerS,
    };
    spotLabel(g, r, sq, spot, o.layers, { size: o.size * 0.84, ring: o.size * 0.75 });
  }
  if (o.note) {
    const side = sq.x - r.x - 24 * k;
    if (side >= 240 * k)
      drawWrapped(g, o.note, sq.x + sq.width + 24 * k, r.y + r.height * 0.3, side - 12 * k, {
        size: o.size,
        color: COLOR.accent,
        weight: 700,
        maxHeight: r.height * 0.6,
      });
    else {
      g.save();
      g.fillStyle = withAlpha(COLOR.background, 0.8);
      g.fillRect(sq.x, sq.y, sq.width, o.size * 3.2);
      g.restore();
      drawWrapped(g, o.note, sq.x + 16, sq.y + o.size * 0.3, sq.width - 32, {
        size: o.size * 0.9,
        color: COLOR.accent,
        weight: 700,
        maxLines: 2,
      });
    }
  }
  return { sq, pxPerS };
};

const def: ChapterDef = {
  id: "inverse",
  state: STATE_RANGES,
  start: encode(START),
  play: (t) => encode(playAt(t)),
  parts: PARTS,
  // The crystal to stretch needs room: the figure takes more of the card than most.
  split: 0.54,
  watch(g, rect, state, look) {
    drawWatch(g, rect, decode(state), look.view("pattern"), look.size, {
      size: Math.max(24, Math.min(rect.height * 0.045, rect.width * 0.03, 90)),
      layers: L.layers,
    });
  },
  // The machine shows a single crystal; the flat model's own cell has no 3D twin to show.
  drive: (): MachineDrive => ({ sample: { crystal: "aluminium", form: "single" } }),
  create(env: ChapterEnv): Chapter {
    let s: InverseState = { ...START };
    let goal: { a: number; b: number } | null = null;
    let goalIndex = -1;
    let card: CardLayout | null = null;
    let hot: Rect = { x: 0, y: 0, width: 1, height: 1 };
    let geo: Geo = { cx: 0, cy: 0, k: 10, beside: false };
    /** The scale the starting crystal fills the figure at: nothing is drawn bigger. */
    let kRef = K_MAX;
    let controls: Control[] = [];
    let shape: Choice | null = null;
    let repeats: Slider | null = null;
    let crystal: Pad | null = null;
    let view: PatternView | null = null;
    let noteAt = Number.NEGATIVE_INFINITY;
    let watchSq: Rect | null = null;
    let watchPx = 1;
    let away: boolean | null = null;
    let aSpot: { x: number; y: number } | null = null;
    let drag: {
      grip: Grip;
      id: number;
      a0: number;
      b0: number;
      turn0: number;
      p0: number;
      ang0: number;
      geo: Geo;
    } | null = null;

    const refit = () => {
      if (!card) return;
      kRef = fit(START, hot, card.beamY).k;
      geo = fit(s, hot, card.beamY, kRef);
    };

    const angleAt = (x: number, y: number, g: Geo) => Math.atan2(g.cy - y, x - g.cx) / DEG;

    const begin = (t: Touch) => {
      const gr = gripsOf(s, geo);
      const reach = Math.max(GRIP_R * 1.15, (card?.target ?? 120) * 0.6);
      let grip: Grip = "turn";
      let best = reach;
      for (const id of ["a", "b", "turn"] as const) {
        const d = Math.hypot(t.x - gr[id].x, t.y - gr[id].y);
        if (d < best) {
          best = d;
          grip = id;
        }
      }
      const { ax, ay } = axes(s.turn);
      const along = grip === "a" ? ax : ay;
      goal = null;
      drag = {
        grip,
        id: t.id,
        a0: s.a,
        b0: s.b,
        turn0: s.turn,
        p0: (t.x - geo.cx) * along.x + (t.y - geo.cy) * along.y,
        ang0: angleAt(t.x, t.y, geo),
        geo: { ...geo },
      };
    };

    const moveTo = (t: Touch) => {
      if (!drag || drag.id !== t.id) return;
      const g = drag.geo;
      if (drag.grip === "turn") {
        if (Math.hypot(t.x - g.cx, t.y - g.cy) < GRIP_R) return;
        let d = angleAt(t.x, t.y, g) - drag.ang0;
        if (d > 180) d -= 360;
        if (d < -180) d += 360;
        s = clean({ ...s, turn: drag.turn0 + d });
        // Measure from here next time, so a turn of more than half a circle keeps going.
        drag.turn0 = s.turn;
        drag.ang0 = angleAt(t.x, t.y, g);
        return;
      }
      const { ax, ay } = axes(drag.turn0);
      const along = drag.grip === "a" ? ax : ay;
      const p = (t.x - g.cx) * along.x + (t.y - g.cy) * along.y;
      // The edge follows the finger: it moves half of N times the change in the cell.
      const d = (2 * (p - drag.p0)) / (s.repeats * g.k);
      s = drag.grip === "a" ? clean({ ...s, a: drag.a0 + d }) : clean({ ...s, b: drag.b0 + d });
    };

    /** A finger's path for a grip: `to` picks a move (0 to 4), or a random one. */
    const gripGesture = (rand: () => number, to?: number): Gesture | null => {
      if (!card) return null;
      const move = to ?? Math.floor(rand() * 5);
      const gr = gripsOf(s, geo);
      const { ax, ay } = axes(s.turn);
      const f = card.figure;
      const keep = (x: number, y: number) => ({
        x: Math.max(f.x + 10, Math.min(f.x + f.width - 10, x)),
        y: Math.max(f.y + 10, Math.min(f.y + f.height - 10, y)),
      });
      const line = (from: { x: number; y: number }, to2: { x: number; y: number }) => {
        const end = keep(to2.x, to2.y);
        return Array.from({ length: 13 }, (_, i) => ({
          x: from.x + ((end.x - from.x) * i) / 12,
          y: from.y + ((end.y - from.y) * i) / 12,
        }));
      };
      if (move === 2) {
        const turnBy = (to === undefined ? (rand() < 0.5 ? -1 : 1) * (20 + rand() * 25) : 35) * DEG;
        const p = gr.turn;
        const r0 = Math.hypot(p.x - geo.cx, p.y - geo.cy);
        const a0 = Math.atan2(geo.cy - p.y, p.x - geo.cx);
        return {
          path: Array.from({ length: 13 }, (_, i) => {
            const a = a0 + (turnBy * i) / 12;
            return keep(geo.cx + r0 * Math.cos(a), geo.cy - r0 * Math.sin(a));
          }),
          ms: 1300,
        };
      }
      const isA = move === 0 || move === 3;
      const from = isA ? gr.a : gr.b;
      const now = isA ? s.a : s.b;
      const target =
        to === undefined ? A_MIN + rand() * (A_MAX - A_MIN) : move === 0 || move === 1 ? 7 : 3;
      const dir = isA ? ax : ay;
      const dist = ((target - now) * s.repeats * geo.k) / 2;
      return {
        path: line(from, { x: from.x + dir.x * dist, y: from.y + dir.y * dist }),
        ms: 1100,
      };
    };

    const make = (l: CardLayout) => {
      const f = l.figure;
      const sf = l.safe;
      const x0 = Math.max(f.x, sf.x);
      const x1 = Math.min(f.x + f.width, sf.x + sf.width);
      hot = inset({ x: x0, y: f.y, width: x1 - x0, height: f.height }, 12, 8);
      const c = l.child;
      const h = Math.min(c.height, l.target * 1.35);
      shape = choice({
        id: "shape",
        rect: { x: c.x, y: c.y + (c.height - h) / 2, width: c.width, height: h },
        band: "child",
        // Narrow tiles show only their pictures.
        options: [L.tall!, L.square!, L.wide!].map((t, i) => ({
          label: c.width / 3 < 280 ? "" : t,
          icon: shapeIcon(i),
        })),
        value: shapeOf(s),
        color: COLOR.real,
        size: l.type.label,
        onChange: (i) => {
          const p = SHAPES[i];
          if (p) {
            goal = { ...p };
            goalIndex = i;
          }
        },
      });
      repeats = slider({
        id: "repeats",
        rect: l.adult,
        band: "adult",
        label: L.repeats!,
        min: N_MIN,
        max: N_MAX,
        step: 1,
        value: s.repeats,
        color: COLOR.real,
        size: l.type.label,
        format: (v) => `${Math.round(v)}`,
        onChange: (v) => {
          s = clean({ ...s, repeats: v });
          noteAt = performance.now();
        },
      });
      crystal = pad({
        id: "crystal",
        rect: hot,
        band: "adult",
        onDown: begin,
        onMove: moveTo,
        onUp: (t) => {
          if (drag?.id === t.id) drag = null;
        },
        botGesture: gripGesture,
      });
      controls = [crystal, repeats, shape];
      refit();
    };

    const sync = () => {
      if (shape) shape.value = shapeOf(s);
      if (repeats) repeats.value = s.repeats;
    };

    const drawFigure = (g: CanvasRenderingContext2D, l: CardLayout, now: number) => {
      const f = l.figure;
      well(g, f, { fill: withAlpha(COLOR.well, 0.6) });
      clipTo(g, f, 28);
      const link = env.link;
      const { ax, ay } = axes(s.turn);
      const k = geo.k;
      const n = s.repeats;
      const W = (n * s.a * k) / 2;
      const H = (n * s.b * k) / 2;
      // The beam crosses the figure behind the crystal and lights it where it passes.
      beam(g, f.x, l.beamY, f.x + f.width, l.beamY, { alpha: 0.55 });
      // The crystal's outline.
      g.save();
      g.translate(geo.cx, geo.cy);
      g.rotate(-s.turn * DEG);
      g.fillStyle = withAlpha(COLOR.real, 0.07);
      g.strokeStyle = withAlpha(COLOR.real, 0.35);
      g.lineWidth = 3;
      g.beginPath();
      g.roundRect(-W, -H, 2 * W, 2 * H, 10);
      g.fill();
      g.stroke();
      g.restore();
      const rad = Math.max(2.5, Math.min(18, Math.min(s.a, s.b) * k * 0.28));
      const at = (i: number, j: number) => {
        const u = (i - (n - 1) / 2) * s.a * k;
        const v = (j - (n - 1) / 2) * s.b * k;
        return { x: geo.cx + ax.x * u + ay.x * v, y: geo.cy + ax.y * u + ay.y * v };
      };
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          const p = at(i, j);
          disc(g, p.x, p.y, rad, COLOR.real, 0.35 + 0.65 * taper(i, n) * taper(j, n));
        }
      // a: one cell's edge just under the bottom row, its letter beside it, so it takes little
      // of the figure's height.
      const p0 = at(0, 0);
      const p1 = at(1, 0);
      const off = rad + 12;
      const b0 = { x: p0.x - ay.x * off, y: p0.y - ay.y * off };
      const b1 = { x: p1.x - ay.x * off, y: p1.y - ay.y * off };
      g.save();
      g.globalAlpha = presence(link, "a", now);
      bracket(g, b0.x, b0.y, b1.x, b1.y, {
        color: COLOR.real,
        width: 4 * emphasis(link, "a", now),
        side: -1,
      });
      // Beside the crystal sits the up-and-down grip, so there the letter goes under the bracket.
      const sideways = geo.beside ? 0 : 0.75;
      const down = geo.beside ? 0.9 : 0;
      const lx =
        (geo.beside ? (b0.x + b1.x) / 2 : b0.x) -
        ax.x * l.type.label * sideways -
        ay.x * l.type.label * down;
      const ly =
        (geo.beside ? (b0.y + b1.y) / 2 : b0.y) -
        ax.y * l.type.label * sideways -
        ay.y * l.type.label * down;
      label(g, "a", lx, ly, { size: l.type.label, color: COLOR.real, italic: true });
      g.restore();
      aSpot = { x: (lx + b1.x) / 2, y: (ly + b1.y) / 2 };
      g.restore();
      // Grips, drawn unclipped so they never hide under the figure's edge.
      const gr = gripsOf(s, geo);
      const held = drag?.grip ?? null;
      const knob = (p: { x: number; y: number }, id: Grip) => {
        g.save();
        g.fillStyle = GRIP_FILL;
        g.strokeStyle = COLOR.real;
        g.lineWidth = held === id ? 8 : 6;
        g.shadowColor = withAlpha(COLOR.real, 0.6);
        g.shadowBlur = held === id ? 26 : 10;
        g.beginPath();
        g.arc(p.x, p.y, GRIP_R * (held === id ? 1.1 : 1), 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.shadowBlur = 0;
        g.strokeStyle = COLOR.ink;
        g.fillStyle = COLOR.ink;
        g.lineWidth = 7;
        g.lineCap = "round";
        const r = GRIP_R * 0.55;
        const head = GRIP_R * 0.26;
        if (id === "turn") {
          const a0 = -s.turn * DEG;
          g.beginPath();
          g.arc(p.x, p.y, r, a0 - 2.2, a0 + 0.6);
          g.stroke();
          const ex = p.x + r * Math.cos(a0 + 0.6);
          const ey = p.y + r * Math.sin(a0 + 0.6);
          g.beginPath();
          g.arc(ex, ey, 9, 0, Math.PI * 2);
          g.fill();
        } else {
          const d = id === "a" ? ax : ay;
          for (const sgn of [-1, 1]) {
            const tx = p.x + d.x * r * sgn;
            const ty = p.y + d.y * r * sgn;
            g.beginPath();
            g.moveTo(p.x, p.y);
            g.lineTo(tx, ty);
            g.stroke();
            const nx = -d.y;
            const ny = d.x;
            g.beginPath();
            g.moveTo(tx, ty);
            g.lineTo(tx - d.x * sgn * head + nx * head, ty - d.y * sgn * head + ny * head);
            g.moveTo(tx, ty);
            g.lineTo(tx - d.x * sgn * head - nx * head, ty - d.y * sgn * head - ny * head);
            g.stroke();
          }
        }
        g.restore();
      };
      knob(gr.a, "a");
      knob(gr.b, "b");
      knob(gr.turn, "turn");
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
        if (goal) {
          const k = Math.min(1, dt * 6);
          s = clean({ ...s, a: s.a + (goal.a - s.a) * k, b: s.b + (goal.b - s.b) * k });
          if (Math.abs(goal.a - s.a) < 0.02 && Math.abs(goal.b - s.b) < 0.02) {
            s = clean({ ...s, a: goal.a, b: goal.b });
            goal = null;
          }
        }
        // Rescale to fit only while no finger holds a grip, so a grip stays under its finger.
        if (!drag && card) {
          const want = fit(s, hot, card.beamY, kRef);
          const k = Math.min(1, dt * 7);
          geo = {
            cx: geo.cx + (want.cx - geo.cx) * k,
            cy: geo.cy + (want.cy - geo.cy) * k,
            k: geo.k + (want.k - geo.k) * k,
            beside: want.beside,
          };
        }
        if (shape) shape.value = goal ? goalIndex : shapeOf(s);
        if (repeats && !repeats.held) repeats.value = s.repeats;
        const sq = squashed(s);
        if (sq) env.earn();
        // The So line is about a squashed crystal; it dims while the crystal is square again.
        if (away !== !sq) {
          away = !sq;
          env.away?.(!sq);
        }
      },
      draw(g, now) {
        if (!card) return;
        view ??= env.engine().view({ tint: "recip" });
        const note = now - noteAt < NOTE_MS ? T.more!.repeats!.text : null;
        const w = drawWatch(g, card.watch, s, view, 256, {
          size: card.type.label,
          sLevel: env.link.level("S", now),
          dim: presence(env.link, "S", now),
          note,
          layers: L.layers,
        });
        watchSq = w.sq;
        watchPx = w.pxPerS;
        drawFigure(g, card, now);
      },
      partAt(x, y) {
        if (aSpot && Math.hypot(x - aSpot.x, y - aSpot.y) < 70) return "a";
        if (watchSq) {
          const c = centre(watchSq);
          const { as } = steps(s);
          const mx = c.x + (as[0] * watchPx) / 2;
          const my = c.y - (as[1] * watchPx) / 2;
          if (Math.hypot(x - mx, y - my) < 70) return "S";
        }
        return null;
      },
      numbers() {
        const Lc = sizeOf(s);
        return [
          `a = ${s.a.toFixed(1)} Å   1/a = ${(1 / s.a).toFixed(3)} Å⁻¹`,
          `b = ${s.b.toFixed(1)} Å   1/b = ${(1 / s.b).toFixed(3)} Å⁻¹`,
          `L = ${s.repeats} × ${Math.min(s.a, s.b).toFixed(1)} = ${Lc.toFixed(1)} Å   1/L = ${(1 / Lc).toFixed(3)} Å⁻¹`,
        ];
      },
      state: (): ChapterState => encode(s),
      demo(): DemoStep[] {
        // One thing at a time: squash it, put it back, then fewer and more repeats, then tall.
        return [
          { control: "shape", to: 2 },
          { wait: 2800 },
          { control: "shape", to: 1 },
          { wait: 1400 },
          { control: "repeats", to: 2, ms: 1400 },
          { wait: 2000 },
          { control: "repeats", to: START.repeats, ms: 1200 },
          { wait: 1000 },
          { control: "shape", to: 0 },
          { wait: 1800 },
        ];
      },
      botMove(rand) {
        // Now and then leave it to the shell, which also tries the tabs and the Maths.
        if (rand() < 0.2) return null;
        const r = rand();
        if (r < 0.3) return { control: "shape", to: Math.floor(rand() * 3) };
        if (r < 0.55)
          return { control: "repeats", to: N_MIN + Math.floor(rand() * (N_MAX - N_MIN + 1)) };
        const gst = gripGesture(rand);
        return gst ? { gesture: gst } : null;
      },
      hint() {
        return shape ? centre(splitRow(shape.rect, [1, 1, 1], 14)[2]!) : null;
      },
      status() {
        return {
          a: Math.round(s.a * 10) / 10,
          b: Math.round(s.b * 10) / 10,
          turn: Math.round(s.turn),
          repeats: s.repeats,
          squashed: squashed(s),
        };
      },
      reset() {
        s = { ...START };
        goal = null;
        drag = null;
        noteAt = Number.NEGATIVE_INFINITY;
        away = null;
        crystal?.release();
        sync();
        refit();
      },
      show() {},
      dispose() {
        view?.release();
        view = null;
        controls = [];
      },
    };
  },
};

export default def;
