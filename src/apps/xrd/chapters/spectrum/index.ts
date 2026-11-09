/**
 * Chapter 1, how long an X-ray is.
 *
 * - Watch view: one wave over things for scale (a house, a person, a bee, a cell, a virus, an
 *   atom). The view rests on each thing while the wave stretches and shrinks over it, then moves
 *   on to the next, so an X-ray ends up about as long as an atom is wide.
 * - Figure: the spectrum from radio waves to gamma rays on a log scale, the bands named, the
 *   things for scale at their own sizes (tap one to jump there), one wave along the beam that
 *   shortens from left to right, and a marker over the slider's knob.
 * - Children: the long slider. Adults: the three tubes' lines (copper, cobalt, molybdenum).
 * - Linked formula E = 12.398 keV·Å / λ: λ on the watch's wave and the figure's readout, E on the
 *   figure's readout.
 * - Key move: reaching X-rays.
 */
import { withAlpha } from "../../../../core/ui/palette";
import { TEXT } from "../../captions";
import type { Chapter, ChapterDef, ChapterEnv, DemoStep, MachineDrive } from "../../chapter";
import { COLOR, TUBE_IDS, TUBES } from "../../config";
import {
  button,
  type Button,
  choice,
  type Choice,
  type Control,
  font,
  pad,
  type Pad,
  slider,
  type Slider,
} from "../../controls";
import { beam, bracket, clipTo, label, line, TAU, well } from "../../draw";
import { presence } from "../../formula";
import type { CardLayout, Rect } from "../../layout";
import {
  angstromsAt,
  type Band,
  BANDS,
  bandAt,
  decode,
  encode,
  energyKeV,
  formatEnergy,
  formatLength,
  isXray,
  LONG,
  metersAt,
  posOf,
  SHORT,
  SPAN,
  START,
  STATE_RANGES,
  THINGS,
  thingAt,
  tubeAt,
  tubePos,
  viewAt,
  WORLD,
} from "./physics";
import { drawThing, lightColour } from "./things";

const T = TEXT.spectrum;
const L = T.labels;

export const PARTS = { E: COLOR.accent, lam: COLOR.beam } as const;

/** The wave's colour at a position: the beam's blue for X-rays, the light's own colour when visible. */
const waveColour = (p: number): string => {
  const b = bandAt(p);
  if (b.id === "xray") return COLOR.beam;
  if (b.id === "visible") return lightColour(metersAt(p) * 1e9);
  return withAlpha(COLOR.ink, 0.85);
};

/**
 * A band's name that fits `room`: the full name, a middle one ("Gamma"), the short one, then the
 * short one down to 72 % of the size, so a narrow strip still names every band it can.
 */
const bandName = (
  b: Band,
  room: number,
  g: CanvasRenderingContext2D,
  size: number,
): { text: string; size: number } | null => {
  const names = [L[b.id] ?? b.id, L[`${b.id}Mid`], L[`${b.id}Short`]].filter(
    (t): t is string => !!t,
  );
  g.font = font(700, size);
  for (const [i, t] of names.entries()) {
    const w = g.measureText(t).width;
    if (w <= room) return { text: t, size };
    // The full name may not shrink; the others may, a little, and the shortest a little more.
    const k = w > 0 ? room / w : 0;
    if (i > 0 && k >= (i === names.length - 1 ? 0.72 : 0.86)) return { text: t, size: size * k };
  }
  return null;
};

/** Longer than visible light: the "So" line, about visible light and X-rays, dims out here. */
const LONGER_THAN_LIGHT = Math.log10(700e-9);

const smooth = (a: number, b: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The watch view: one wave over things for scale. */
const drawScene = (
  g: CanvasRenderingContext2D,
  r: Rect,
  p: number,
  o: { now: number; size: number; lamLevel?: number; lamAlpha?: number },
): { lam: { x: number; y: number } | null } => {
  well(g, r);
  clipTo(g, r, 28);
  // Strokes grow with the text, so the screen's big copy reads as well as a panel's.
  const u = Math.max(1, o.size / 38);
  const view = viewAt(p);
  const H = r.height;
  const scale = H / 10 ** view.h;
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height * 0.54;
  // Things for scale, at their own sizes, fading in when big enough to see and out when too big.
  for (const t of THINGS) {
    const s = t.size * scale;
    if (s < 3 || s > H * 4) continue;
    const at = WORLD[t.id];
    const x = cx + (at[0] - view.cx) * scale;
    const y = cy - (at[1] - view.cy) * scale;
    if (x < r.x - s || x > r.x + r.width + s || y < r.y - s || y > r.y + r.height + s) continue;
    const alpha = smooth(3, 16, s) * (1 - smooth(H * 1.3, H * 3, s));
    drawThing(g, t.id, x, y, s, alpha);
  }
  // Where an atom sits, though far too small to see: at visible light and ultraviolet, a ring and
  // a word say so, at the true place on the scene.
  const band0 = bandAt(p);
  const atomPx = THINGS[THINGS.length - 1]!.size * scale;
  let atomMark: { x: number; y: number } | null = null;
  if ((band0.id === "visible" || band0.id === "ultraviolet") && atomPx < 3) {
    const at = WORLD.atom;
    const x = cx + (at[0] - view.cx) * scale;
    const y = cy - (at[1] - view.cy) * scale;
    if (x > r.x + 30 && x < r.x + r.width - 30 && y > r.y + 30 && y < r.y + r.height - 30)
      atomMark = { x, y };
  }
  // The wave, its true length against the things, moving along.
  const lamPx = metersAt(p) * scale;
  const amp = H * 0.15;
  const colour = waveColour(p);
  const wy = cy;
  let lamAt: { x: number; y: number } | null = null;
  if (lamPx >= 7) {
    const phase = (o.now / 1000) * TAU * 0.5;
    g.save();
    g.strokeStyle = colour;
    g.lineWidth = Math.max(4, o.size * 0.16);
    g.lineJoin = "round";
    g.shadowColor = withAlpha(colour, 0.5);
    g.shadowBlur = 12;
    g.beginPath();
    const step = Math.max(1.5, Math.min(6, lamPx / 16));
    for (let x = r.x; x <= r.x + r.width + step; x += step) {
      const y = wy - amp * Math.sin(((x - r.x) / lamPx) * TAU - phase);
      if (x === r.x) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.restore();
    // One wavelength marked between two crests, where a whole one fits.
    // Crests sit where (x - r.x) / λ - phase / 2π = 1/4 + n.
    // Its λ stays clear of the band's name and length (top left) and the thing's (top right).
    const hp = Math.max(18, r.height * 0.05);
    g.font = font(800, o.size * 1.15);
    let headL = g.measureText(L[bandAt(p).id] ?? "").width;
    g.font = font(700, o.size);
    headL = r.x + hp + Math.max(headL, g.measureText(formatLength(metersAt(p))).width) + o.size;
    g.font = font(700, o.size * 0.9);
    const headR = r.x + r.width - hp - g.measureText(L[thingAt(p).id] ?? "").width - o.size;
    const f = (((0.25 + phase / TAU) % 1) + 1) % 1;
    let x0 = r.x + f * lamPx;
    while (x0 < r.x + r.width * 0.12 || x0 + lamPx / 2 < headL) x0 += lamPx;
    if (lamPx > 40 && x0 + lamPx < r.x + r.width - 24 && x0 + lamPx / 2 < headR) {
      const by = wy - amp - 26 * u;
      g.save();
      g.globalAlpha = o.lamAlpha ?? 1;
      bracket(g, x0, by, x0 + lamPx, by, {
        label: "λ",
        color: COLOR.beam,
        width: 4 * u * (1 + 1.4 * (o.lamLevel ?? 0)),
        size: o.size * 1.1,
      });
      g.restore();
      lamAt = { x: x0 + lamPx / 2, y: by };
    }
  } else {
    // Far too short to draw at this scale: a shimmering band where the wave is.
    g.fillStyle = withAlpha(colour, 0.32 + 0.08 * Math.sin(o.now / 180));
    g.fillRect(r.x, wy - amp, r.width, amp * 2);
  }
  if (atomMark) {
    // The ring and its words sit over the wave, which passes through the atom's place.
    const ar = Math.max(12, o.size * 0.38);
    const ty = r.y + r.height - Math.max(18, r.height * 0.05) - o.size * 0.55;
    g.save();
    g.strokeStyle = COLOR.real;
    g.lineWidth = Math.max(3, 3 * u);
    g.beginPath();
    g.arc(atomMark.x, atomMark.y, ar, 0, TAU);
    g.stroke();
    g.fillStyle = COLOR.real;
    g.beginPath();
    g.arc(atomMark.x, atomMark.y, Math.max(2, 2 * u), 0, TAU);
    g.fill();
    g.restore();
    const size = o.size * 0.8;
    g.font = font(700, size);
    const text = L.atomHere ?? "";
    const tw = g.measureText(text).width;
    const tx = Math.max(r.x + 20 + tw / 2, Math.min(r.x + r.width - 20 - tw / 2, atomMark.x));
    line(g, atomMark.x, atomMark.y + ar, tx, ty - size * 0.6, withAlpha(COLOR.real, 0.8), 3 * u);
    g.save();
    g.fillStyle = withAlpha(COLOR.well, 0.82);
    g.beginPath();
    g.roundRect(tx - tw / 2 - size * 0.4, ty - size * 0.7, tw + size * 0.8, size * 1.4, size * 0.7);
    g.fill();
    g.restore();
    label(g, text, tx, ty, { size, color: COLOR.real, weight: 700 });
  }
  g.restore();
  // What it is and how long, top left; the thing's name under it.
  const band = bandAt(p);
  const pad = Math.max(18, r.height * 0.05);
  label(g, L[band.id] ?? band.id, r.x + pad, r.y + pad + o.size * 0.6, {
    size: o.size * 1.15,
    align: "left",
    color: band.id === "xray" ? COLOR.beam : COLOR.ink,
    weight: 800,
  });
  label(g, formatLength(metersAt(p)), r.x + pad, r.y + pad + o.size * 1.85, {
    size: o.size,
    align: "left",
    color: COLOR.muted,
  });
  const near = thingAt(p);
  label(g, L[near.id] ?? near.id, r.x + r.width - pad, r.y + pad + o.size * 0.6, {
    size: o.size * 0.9,
    align: "right",
    color: COLOR.muted,
  });
  return { lam: lamAt };
};

interface ChartGeo {
  x0: number;
  x1: number;
  iconY: number;
  iconS: number;
  waveY: number;
  amp: number;
  strip: Rect;
  /** How far the first and last bands (open-ended) reach past the scale, toward the figure's edges. */
  ends: { left: number; right: number };
  /** Where each thing's icon sits, nudged apart where they would overlap. */
  icons: number[];
  /** The tubes' row label, when it fits: above the buttons or to their left. */
  tubesLabel: { x: number; y: number; size: number; align: CanvasTextAlign } | null;
}

/** Icon centres near their true positions `xs` (ascending), at least `gap` apart, within [lo, hi]. */
export const spread = (xs: readonly number[], gap: number, lo: number, hi: number): number[] => {
  const out = [...xs];
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i]!, out[i - 1]! + gap);
  for (let i = out.length - 1; i >= 0; i--) {
    out[i] = Math.min(out[i]!, i + 1 < out.length ? out[i + 1]! - gap : hi);
  }
  for (let i = 0; i < out.length; i++) out[i] = Math.max(out[i]!, i > 0 ? out[i - 1]! + gap : lo);
  return out;
};

const xOfP = (geo: Pick<ChartGeo, "x0" | "x1">, p: number) =>
  geo.x0 + ((LONG - p) / SPAN) * (geo.x1 - geo.x0);
const pOfX = (geo: Pick<ChartGeo, "x0" | "x1">, x: number) =>
  LONG - Math.max(0, Math.min(1, (x - geo.x0) / Math.max(1, geo.x1 - geo.x0))) * SPAN;

const def: ChapterDef = {
  id: "spectrum",
  state: STATE_RANGES,
  start: encode(START),
  play(t) {
    // A slow sweep from radio waves to gamma rays and back.
    const k = 0.5 - 0.5 * Math.cos((t / 40) * TAU);
    return encode(LONG - 0.02 - k * (SPAN - 0.04));
  },
  parts: PARTS,
  watch(g, rect, state, look) {
    drawScene(g, rect, decode(state), {
      now: look.now,
      size: Math.max(22, Math.min(rect.height * 0.06, rect.width * 0.032, 90)),
    });
  },
  drive(state): MachineDrive {
    const p = decode(state);
    // Only X-rays reach the crystal's atoms; anything longer leaves the detector dark.
    if (!isXray(p)) return { lambda: null };
    // On a tube's line, exactly that line; elsewhere the wavelength to four places.
    const tube = tubeAt(p);
    return { lambda: tube ? TUBES[tube].lambda : Math.round(angstromsAt(p) * 1e4) / 1e4 };
  },
  create(env: ChapterEnv): Chapter {
    let p = START;
    /** Where a tap on a tube or a thing is taking the wave, eased. */
    let goal: number | null = null;
    let card: CardLayout | null = null;
    let controls: Control[] = [];
    let wave: Slider | null = null;
    let tubes: Choice | Button | null = null;
    let chart: Pad | null = null;
    let geo: ChartGeo | null = null;
    let lamSpot: { x: number; y: number } | null = null;
    let readSpots: { part: string; x: number; y: number }[] = [];
    let phase = 0;
    /** What env.away was last told, so it is told only on a change. */
    let awayNow: boolean | null = null;

    const sliderValue = (pp: number) => LONG - pp;
    const setP = (pp: number) => {
      p = Math.max(SHORT, Math.min(LONG, pp));
    };
    const jump = (pp: number) => {
      goal = Math.max(SHORT, Math.min(LONG, pp));
    };

    const make = (l: CardLayout) => {
      const c = l.child;
      const a = l.adult;
      const f = l.figure;
      wave = slider({
        id: "wave",
        rect: { ...c },
        band: "child",
        label: L.slider!,
        min: 0,
        max: SPAN,
        value: sliderValue(p),
        color: COLOR.beam,
        size: l.type.label,
        format: (v) => formatLength(metersAt(LONG - v)),
        onChange: (v) => {
          goal = null;
          setP(LONG - v);
        },
      });
      const tr = wave.track();
      // The chart's scale is the slider's track, so the marker stands over the knob.
      const amp = Math.min(24, f.height * 0.08);
      const waveY = l.beamY;
      const iconS = Math.min(84, (waveY - f.y) * 0.38);
      // The icons sit in the middle of the room above the wave (the wavelength's readout is on
      // the wave itself, beside the marker).
      const iconY = Math.max(
        f.y + 8 + iconS * 0.6,
        Math.min(waveY - amp - 14 - iconS * 0.6, (f.y + 8 + waveY - amp - 10) / 2),
      );
      const stripTop = waveY + amp + 14;
      const stripH = Math.min(70, f.y + f.height - 12 - stripTop);
      geo = {
        x0: tr.x0,
        x1: tr.x1,
        iconY,
        iconS,
        waveY,
        amp,
        strip: { x: tr.x0, y: stripTop, width: tr.x1 - tr.x0, height: Math.max(30, stripH) },
        ends: {
          left: Math.max(0, Math.min(110, tr.x0 - (f.x + 12))),
          right: Math.max(0, Math.min(110, f.x + f.width - 12 - tr.x1)),
        },
        icons: [],
        tubesLabel: null,
      };
      geo.icons = spread(
        THINGS.map((th) => xOfP(geo!, posOf(th.size))),
        iconS * 1.25,
        Math.max(f.x + iconS * 0.65, tr.x0 - 30),
        Math.min(f.x + f.width - iconS * 0.65, tr.x1 + 30),
      );
      const g0 = geo;
      const top = iconY - iconS / 2 - 10;
      const bottom = g0.strip.y + g0.strip.height + 6;
      const left = Math.max(f.x, tr.x0 - 40);
      const right = Math.min(f.x + f.width, tr.x1 + 40);
      chart = pad({
        id: "chart",
        rect: { x: left, y: top, width: right - left, height: Math.max(l.target, bottom - top) },
        band: "adult",
        onDown: (t) => {
          // A tap near a thing jumps to its size; anywhere else on the chart, to that wavelength.
          let best: number | null = null;
          let bestD = Math.max(60, g0.iconS * 0.75);
          for (const [i, th] of THINGS.entries()) {
            const x = g0.icons[i]!;
            const d = Math.hypot(t.x - x, t.y - g0.iconY);
            if (d < bestD) {
              bestD = d;
              best = posOf(th.size);
            }
          }
          if (best !== null) jump(best);
          else jump(pOfX(g0, t.x));
        },
        onMove: (t) => {
          if (t.y > g0.iconY + g0.iconS / 2) {
            goal = null;
            setP(pOfX(g0, t.x));
          }
        },
        botGesture: (rand, to) => {
          const i = to ?? Math.floor(rand() * THINGS.length);
          return { path: [{ x: g0.icons[i] ?? g0.x0, y: g0.iconY }], ms: 120 };
        },
      });
      const fits = a.width >= 3 * l.target + 28;
      const tubeIndex = () => {
        const id = tubeAt(p);
        return id ? TUBE_IDS.indexOf(id) : -1;
      };
      // "X-ray tubes" over the buttons where the row has room above them, else to their left.
      const ls = l.type.small * 0.9;
      const rowH = ls * 1.3;
      let th = Math.min(a.height, l.target * 1.05);
      let tr2: Rect = { x: a.x, y: a.y + a.height - th, width: a.width, height: th };
      const atRight = l.outer === "right";
      if (a.height - Math.max(l.target, Math.min(th, a.height - rowH)) >= rowH - 0.5) {
        th = Math.max(l.target, Math.min(th, a.height - rowH));
        tr2 = { x: a.x, y: a.y + a.height - th, width: a.width, height: th };
        g0.tubesLabel = {
          x: atRight ? a.x + a.width - 6 : a.x + 6,
          y: tr2.y - rowH * 0.5,
          size: ls,
          align: atRight ? "right" : "left",
        };
      } else {
        g0.tubesLabel = null;
        // Layout runs without a canvas in tests, so the label's width is estimated.
        const lw = ls * 0.6 * (L.tubes ?? "").length + 24;
        if (a.width - lw >= 3 * l.target + 28) {
          tr2 = { x: atRight ? a.x : a.x + lw, y: tr2.y, width: a.width - lw, height: th };
          g0.tubesLabel = {
            x: atRight ? a.x + a.width - 6 : a.x + 6,
            y: tr2.y + th / 2,
            size: ls,
            align: atRight ? "right" : "left",
          };
        }
      }
      tubes = fits
        ? choice({
            id: "tube",
            rect: tr2,
            band: "adult",
            options: TUBE_IDS.map((id) => ({ label: L[id] ?? id, color: COLOR.beam })),
            value: tubeIndex(),
            color: COLOR.beam,
            size: l.type.label * 0.9,
            onChange: (i) => jump(tubePos(TUBE_IDS[i] ?? "copper")),
          })
        : button({
            id: "tube",
            rect: tr2,
            band: "adult",
            label: L.copper!,
            color: COLOR.beam,
            size: l.type.label * 0.9,
            onPress: () => {
              const now = tubeAt(goal ?? p);
              jump(
                tubePos(now ? TUBE_IDS[(TUBE_IDS.indexOf(now) + 1) % TUBE_IDS.length]! : "copper"),
              );
            },
          });
      controls = [chart, tubes, wave];
    };

    const sync = () => {
      if (wave && !wave.held) wave.value = sliderValue(p);
      const id = tubeAt(p);
      if (tubes && "options" in tubes) tubes.value = id ? TUBE_IDS.indexOf(id) : -1;
      else if (tubes) {
        tubes.label = L[id ?? "copper"] ?? "";
        tubes.on = id !== null;
      }
    };

    const drawChart = (g: CanvasRenderingContext2D, l: CardLayout, now: number) => {
      const f = l.figure;
      const gg = geo;
      if (!gg) return;
      const link = env.link;
      well(g, f, { fill: withAlpha(COLOR.well, 0.6) });
      // The beam comes in and leaves straight; across the chart it is one wave whose length
      // shrinks from left to right, the current band picked out.
      beam(g, f.x, gg.waveY, gg.x0, gg.waveY, { alpha: 0.9 });
      beam(g, gg.x1, gg.waveY, f.x + f.width, gg.waveY, { alpha: 0.9 });
      const band = bandAt(p);
      const bx0 = xOfP(gg, band.from);
      const bx1 = xOfP(gg, band.to);
      const pts: { x: number; y: number }[] = [];
      let ph = phase;
      const long = Math.min(150, (gg.x1 - gg.x0) / 5);
      const short = 4;
      for (let x = gg.x0; x <= gg.x1; x += 1) {
        pts.push({ x, y: gg.waveY - gg.amp * Math.sin(ph) });
        const lam = long * (short / long) ** ((x - gg.x0) / (gg.x1 - gg.x0));
        ph += TAU / lam;
      }
      const stroke = (from: number, to: number, colour: string, width: number) => {
        g.save();
        g.beginPath();
        let first = true;
        for (const q of pts) {
          if (q.x < from || q.x > to) continue;
          if (first) g.moveTo(q.x, q.y);
          else g.lineTo(q.x, q.y);
          first = false;
        }
        g.strokeStyle = colour;
        g.lineWidth = width;
        g.lineJoin = "round";
        g.stroke();
        g.restore();
      };
      stroke(gg.x0, gg.x1, withAlpha(COLOR.ink, 0.28), 2.5);
      stroke(bx0, bx1, waveColour((band.from + band.to) / 2), 4.5);
      // The bands, named where there is room.
      const s = gg.strip;
      const size = Math.min(l.type.small, s.height * 0.42);
      for (const [k, b] of BANDS.entries()) {
        // Radio and gamma rays have no end: their bands run on toward the figure's edges.
        const x0 = xOfP(gg, b.from) - (k === 0 ? gg.ends.left : 0);
        const x1 = xOfP(gg, b.to) + (k === BANDS.length - 1 ? gg.ends.right : 0);
        const on = b === band;
        if (b.id === "visible") {
          const grad = g.createLinearGradient(x0, 0, x1, 0);
          for (let nm = 700; nm >= 400; nm -= 50) {
            const x = xOfP(gg, Math.log10(nm * 1e-9));
            grad.addColorStop(Math.max(0, Math.min(1, (x - x0) / (x1 - x0 || 1))), lightColour(nm));
          }
          g.fillStyle = grad;
          g.globalAlpha = on ? 1 : 0.8;
        } else {
          g.fillStyle = b.id === "xray" ? COLOR.beam : COLOR.ink;
          g.globalAlpha =
            (b.id === "xray" ? 0.3 : BANDS.indexOf(b) % 2 ? 0.06 : 0.12) * (on ? 2 : 1);
        }
        g.fillRect(x0, s.y, x1 - x0, s.height);
        g.globalAlpha = 1;
        const name = bandName(b, x1 - x0 - 10, g, size);
        if (name)
          label(g, name.text, (x0 + x1) / 2, s.y + s.height / 2, {
            size: name.size,
            color: on ? COLOR.ink : COLOR.muted,
            weight: on ? 800 : 600,
          });
      }
      // The visible band is too narrow for its name; it goes just below the strip, if not named.
      {
        const b = BANDS.find((x) => x.id === "visible")!;
        const x0 = xOfP(gg, b.from);
        const x1 = xOfP(gg, b.to);
        if (!bandName(b, x1 - x0 - 10, g, size)) {
          const vy = s.y + s.height + size * 0.75;
          if (vy + size * 0.5 <= f.y + f.height)
            label(g, L.visibleShort ?? "", (x0 + x1) / 2, vy, {
              size: size * 0.85,
              color: band.id === "visible" ? COLOR.ink : COLOR.muted,
              weight: 700,
            });
        }
      }
      // Things for scale, each at its own size on the scale. Icons sit apart for room, so a dashed
      // leader runs from each to its true place on the strip; the thing the watch view shows has
      // its leader drawn bright, ending where the marker stands.
      const nearId = thingAt(p).id;
      for (const [i, th] of THINGS.entries()) {
        const x = gg.icons[i]!;
        const trueX = xOfP(gg, posOf(th.size));
        const near = nearId === th.id;
        g.save();
        g.beginPath();
        g.arc(x, gg.iconY, gg.iconS * 0.6, 0, TAU);
        g.fillStyle = withAlpha(COLOR.background, 0.7);
        g.fill();
        g.lineWidth = 3;
        g.strokeStyle = withAlpha(COLOR.ink, near ? 0.6 : 0.18);
        g.stroke();
        g.restore();
        drawThing(
          g,
          th.id,
          x,
          gg.iconY,
          gg.iconS * (th.id === "atom" ? 0.7 : 0.82),
          near ? 1 : 0.7,
        );
        if (near) line(g, x, gg.iconY + gg.iconS * 0.6, trueX, s.y, withAlpha(COLOR.ink, 0.75), 4);
        else
          line(g, x, gg.iconY + gg.iconS * 0.6, trueX, s.y, withAlpha(COLOR.ink, 0.18), 2, [4, 6]);
      }
      // The marker over the slider's knob runs from the wave to the strip, never through the icons,
      // whose places are nudged apart. The wavelength rides on the wave beside it; its energy
      // joins it only while the Maths is open, where E = 12.398 keV·Å / λ explains it.
      const mx = xOfP(gg, p);
      line(g, mx, gg.waveY - gg.amp - 12, mx, s.y + s.height, withAlpha(COLOR.beam, 0.9), 4);
      const lamText = formatLength(metersAt(p));
      const withE = env.mathsOpen?.() ?? false;
      const eText = withE ? formatEnergy(energyKeV(angstromsAt(p))) : "";
      const ts = l.type.small;
      g.font = font(800, ts);
      const lw = g.measureText(lamText).width;
      const ew = eText ? g.measureText(eText).width : 0;
      const gap = ts * 0.7;
      const total = lw + (eText ? gap + ew : 0);
      const padX = ts * 0.45;
      // On the side away from the bright leader, where there is room.
      const nearX = xOfP(gg, posOf(THINGS.find((t) => t.id === nearId)!.size));
      const fitsRight = mx + 14 + total + 2 * padX <= f.x + f.width - 12;
      const fitsLeft = mx - 14 - total - 2 * padX >= f.x + 12;
      const right = fitsRight && (nearX < mx - 4 || !fitsLeft);
      const bx = right ? mx + 14 : Math.max(f.x + 12, mx - 14 - total - 2 * padX);
      const by = gg.waveY;
      g.save();
      g.fillStyle = withAlpha(COLOR.well, 0.9);
      g.strokeStyle = withAlpha(COLOR.beam, 0.6);
      g.lineWidth = 3;
      g.beginPath();
      g.roundRect(bx, by - ts * 0.72, total + 2 * padX, ts * 1.44, ts * 0.72);
      g.fill();
      g.stroke();
      g.restore();
      const tx = bx + padX;
      label(g, lamText, tx, by, {
        size: ts * (1 + 0.15 * link.level("lam", now)),
        align: "left",
        color: COLOR.beam,
        weight: 800,
        alpha: presence(link, "lam", now),
      });
      readSpots = [{ part: "lam", x: tx + lw / 2, y: by }];
      if (eText) {
        label(g, eText, tx + lw + gap, by, {
          size: ts * (1 + 0.15 * link.level("E", now)),
          align: "left",
          color: COLOR.accent,
          weight: 800,
          alpha: presence(link, "E", now),
        });
        readSpots.push({ part: "E", x: tx + lw + gap + ew / 2, y: by });
      }
      // The tubes' row label.
      const tl = gg.tubesLabel;
      if (tl)
        label(g, L.tubes ?? "", tl.x, tl.y, {
          size: tl.size,
          align: tl.align,
          color: withAlpha(COLOR.beam, 0.9),
          weight: 800,
        });
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
        phase -= dt * TAU * 0.8;
        if (phase < -1e6) phase += 1e6;
        if (goal !== null) {
          const d = goal - p;
          if (Math.abs(d) < 1e-4) {
            setP(goal);
            goal = null;
          } else
            setP(p + d * Math.min(1, dt * 4.5) + Math.sign(d) * Math.min(Math.abs(d), dt * 0.3));
        }
        sync();
        if (isXray(p)) env.earn();
        const away = p > LONGER_THAN_LIGHT;
        if (away !== awayNow) {
          awayNow = away;
          env.away?.(away);
        }
      },
      draw(g, now) {
        if (!card) return;
        const r = card.watch;
        const res = drawScene(g, r, p, {
          now,
          size: card.type.label,
          lamLevel: env.link.level("lam", now),
          lamAlpha: presence(env.link, "lam", now),
        });
        lamSpot = res.lam;
        drawChart(g, card, now);
      },
      partAt(x, y) {
        for (const s of readSpots) if (Math.hypot(x - s.x, y - s.y) < 70) return s.part;
        if (lamSpot && Math.hypot(x - lamSpot.x, y - lamSpot.y) < 80) return "lam";
        return null;
      },
      numbers() {
        const lam = angstromsAt(p);
        const lines = TUBE_IDS.map(
          (id) =>
            `${L[id] ?? id} ${TUBES[id].lambda.toFixed(4)} Å = ${energyKeV(TUBES[id].lambda).toFixed(3)} keV`,
        );
        return [`λ = ${formatLength(metersAt(p))}   E = ${formatEnergy(energyKeV(lam))}`, ...lines];
      },
      state: () => encode(p),
      demo(): DemoStep[] {
        return [
          { control: "wave", to: sliderValue(tubePos("copper")), ms: 4200 },
          { wait: 2200 },
          // Then back to green light, which the So line compares with X-rays.
          { control: "wave", to: sliderValue(START), ms: 2600 },
          { wait: 1400 },
        ];
      },
      hint() {
        if (!wave) return null;
        return { x: wave.xOf(wave.value), y: wave.track().y };
      },
      status() {
        return {
          lambda: formatLength(metersAt(p)),
          band: bandAt(p).id,
          xray: isXray(p),
          thing: thingAt(p).id,
        };
      },
      reset() {
        p = START;
        goal = null;
        awayNow = null;
        sync();
      },
      show() {},
      dispose() {
        controls = [];
      },
    };
  },
};

export default def;
