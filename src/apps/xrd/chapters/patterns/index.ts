/**
 * Chapter 6, spots or rings. One crystal's pattern is spots; ground into a powder of tiny grains
 * facing every way, each grain's spots land at the same distance from the middle but at its own
 * angle, so together they draw rings (spotty with few grains, smooth with many); grains that
 * mostly face one way, as in rolled foil, draw arcs as long as their spread. The Lifelike
 * button swaps in a simulated map of each kind, tagged as simulated.
 *
 * The pattern comes from the engine: the flat model of the grains, each a little square crystal
 * with aluminium's 4.05 Å edge, scattering independently. A single crystal's spots are a pixel
 * or two across in the engine's grid, so they are drawn
 * again as glows, as bright as the brightest ring, with the flat model's own relative
 * brightness. Faint dashed circles through the spots show where the rings will be.
 *
 * - Watch view: the pattern, labelled as a flat model, or the simulated map; one spot labelled as
 *   one set of layers.
 * - Figure: the sample, one crystal or its grains, in the beam; a hammer breaks it into smaller
 *   and smaller grains, blow by blow.
 * - Children: one big button, "Grind to powder", which becomes "New crystal" once the crystal is
 *   powder. Adults: Line them up, and Lifelike.
 * - Linked formula |S| = 1/d: the first ring's radius on the pattern, the gap between atoms.
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
  WatchLook,
} from "../../chapter";
import { COLOR } from "../../config";
import {
  button,
  type Button,
  type Control,
  type IconDraw,
  slider,
  type Slider,
} from "../../controls";
import { arrow, bracket, clipTo, cornerTag, disc, ICON, label, TAU, well } from "../../draw";
import type { PatternJob } from "../../engine/pattern";
import { type Grain, latticeAtoms, scatterGrains, squareCell } from "../../engine/model";
import type { PatternView } from "../../engine/client";
import { emphasis, presence } from "../../formula";
import { type CardLayout, centre, type Rect, splitRow, square } from "../../layout";
import type { MapId } from "../../maps";
import { spotLabel } from "./spotlabel";

const T = TEXT.patterns;
const L = T.labels;

/** The toy lattice's edge: aluminium's, Å. */
export const A = 4.05;
/** Grains after each blow of the hammer, and their radius (Å). */
export const GRAINS = [1, 6, 24, 80, 240] as const;
export const SIZES = [46, 22, 14, 10, 7] as const;
/** Radius of the sample, Å. */
const FIELD = 62;
/** Real-space Å per engine pixel, at any grid size, so every size shows the same pattern. */
const A_PER_PX = 0.5;
const SEED = 17;
const STOP = 0.06;
/** The toy's soft-disc width, Å, which sets how fast its spots fade outward. */
const SIGMA = 0.5;
/** One blow of the hammer every this long while grinding, ms, and how long its pieces fly. */
export const GRIND_STEP_MS = 800;
const BURST_MS = 480;
/** The rings to come: h² + k² of the circles drawn through the spots. */
export const RING_ORDERS = [1, 2, 4, 5, 8] as const;
/** The spot the "One set of layers" label points at: up and to the left. */
const LABEL_SPOT: readonly [number, number] = [-1, 1];

export const PARTS = { S: COLOR.recip, d: COLOR.real } as const;

export interface PatternsState {
  /** Blows of the hammer, 0 to 4. */
  crush: number;
  /** How well the grains line up, 0 (any way) to 1 (all one way). */
  lineUp: number;
  /** Showing the simulated map instead of the flat model. */
  map: boolean;
}

export const START: PatternsState = { crush: 0, lineUp: 0, map: false };

export type Look = "spots" | "rings" | "arcs";

/** How far the grains' turns stray, degrees. */
export const spreadOf = (s: PatternsState): number => (1 - s.lineUp) * 180;

/**
 * The square toy's spots come back every 90°, so grains strayed by ±45° or more already fill
 * whole rings; arcs need a narrower spread than that, with gaps between them.
 */
export const lookOf = (s: PatternsState): Look => {
  if (s.crush === 0) return "spots";
  const spread = spreadOf(s);
  return spread < 6 ? "spots" : spread < 40 ? "arcs" : "rings";
};

export const MAP_FOR: Record<Look, MapId> = { spots: "zircon", rings: "corundum", arcs: "foil" };

export const encode = (s: PatternsState): number[] => [
  s.crush,
  Math.round(s.lineUp * 100),
  s.map ? 1 : 0,
];
export const decode = (v: readonly number[]): PatternsState => ({
  crush: Math.max(0, Math.min(GRAINS.length - 1, v[0] ?? 0)),
  lineUp: Math.max(0, Math.min(1, (v[1] ?? 0) / 100)),
  map: v[2] === 1,
});

/** A circle's radius, Å⁻¹: |S| of the spots on it. */
export const ringRadius = (order: number): number => Math.sqrt(order) / A;

/**
 * A single crystal's spot (h k) as the square-root scale shows it, relative to (1 0): each atom
 * is a soft disc, so a spot's height falls off as exp(−2π²σ²|S|²).
 */
export const spotBrightness = (h: number, k: number): number =>
  Math.exp(-2 * Math.PI ** 2 * SIGMA ** 2 * ((h * h + k * k - 1) / (A * A)));

/** The state after one more blow of the hammer, and whether there was one. */
export const blow = (s: PatternsState): PatternsState =>
  s.crush >= GRAINS.length - 1 ? s : { ...s, crush: s.crush + 1 };

export const grainsOf = (s: PatternsState): Grain[] =>
  scatterGrains({
    count: GRAINS[s.crush]!,
    field: s.crush === 0 ? 0 : FIELD,
    size: SIZES[s.crush]!,
    seed: SEED + s.crush,
    spread: (spreadOf(s) * Math.PI) / 180,
  });

const cell = squareCell(A, 13, SIGMA);

/** A soft spot, white in the middle, drawn once and stamped wherever a spot glows. */
let sprite: HTMLCanvasElement | null = null;
const spotSprite = (): HTMLCanvasElement => {
  if (sprite) return sprite;
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const x = c.getContext("2d")!;
  const grad = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "#fffaee");
  grad.addColorStop(0.2, "#fff3d0");
  grad.addColorStop(0.36, withAlpha(COLOR.recip, 0.95));
  grad.addColorStop(0.7, withAlpha(COLOR.recip, 0.25));
  grad.addColorStop(1, withAlpha(COLOR.recip, 0));
  x.fillStyle = grad;
  x.fillRect(0, 0, 64, 64);
  sprite = c;
  return c;
};

/** A small crystal for the "New crystal" face: a block of atoms in rows. */
const crystalIcon: IconDraw = (g, b, color) => {
  const s = b.width;
  g.save();
  g.strokeStyle = color;
  g.lineWidth = s * 0.06;
  g.beginPath();
  g.roundRect(b.x + s * 0.12, b.y + s * 0.12, s * 0.76, s * 0.76, s * 0.08);
  g.stroke();
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      disc(g, b.x + s * (0.3 + i * 0.2), b.y + s * (0.3 + j * 0.2), s * 0.065, color);
  g.restore();
};

const CHIP_FILL = withAlpha(COLOR.real, 0.13);
const CHIP_EDGE = withAlpha(COLOR.real, 0.55);
const CHIP_GAP = withAlpha(COLOR.background, 0.85);
const CHIP_ROW = withAlpha(COLOR.background, 0.6);

/** A repeatable number in [0, 1) for a grain and a slot, so outlines and dust never shuffle. */
const hash = (a: number, b: number): number => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** The engine job for a state at grid size n. */
export const patternJob = (s: PatternsState, n: number): PatternJob => {
  const span = n * A_PER_PX;
  if (s.crush === 0) {
    return {
      op: "pattern",
      n,
      span,
      source: { atoms: latticeAtoms({ ...cell, extent: { radius: SIZES[0], taper: 14 } }) },
      scale: "sqrt",
      stop: STOP,
    };
  }
  const grains = grainsOf(s);
  const base = latticeAtoms({
    ...cell,
    extent: { radius: SIZES[s.crush]!, taper: SIZES[s.crush]! * 0.35 },
  });
  return {
    op: "pattern",
    n,
    span,
    source: { atoms: base, angles: new Float32Array(grains.map((g) => g.angle)) },
    scale: "sqrt",
    stop: STOP,
    gain: 1.1,
  };
};

const keyOf = (s: PatternsState, n: number) =>
  `${n}:${s.crush}:${s.crush === 0 ? 0 : Math.round(s.lineUp * 100)}`;

/** The pattern, or the simulated map, into a square in `r`; returns the pattern's square. */
const drawWatch = (
  g: CanvasRenderingContext2D,
  r: Rect,
  s: PatternsState,
  view: PatternView,
  look: Pick<WatchLook, "maps" | "config">,
  n: number,
  o: { size: number; ringLevel?: number; ringAlpha?: number; layers?: string },
): Rect => {
  well(g, r);
  const sq = square({ x: r.x + 12, y: r.y + 12, width: r.width - 24, height: r.height - 24 });
  if (s.map && look.config.maps) {
    const id = MAP_FOR[lookOf(s)];
    const p = look.maps.draw(g, id, {
      x: r.x + 16,
      y: r.y + 16,
      width: r.width - 32,
      height: r.height - 32,
    });
    // Top left, where every map is empty: outside its rings, or above it in the square.
    cornerTag(g, r, COMMON.simulated, { size: o.size, corner: "tl" });
    if (!p)
      label(g, "…", r.x + r.width / 2, r.y + r.height / 2, {
        size: o.size * 2,
        color: COLOR.muted,
      });
    return sq;
  }
  const key = keyOf(s, n);
  view.want(key, () => patternJob(s, n));
  clipTo(g, sq, 20);
  view.draw(g, sq);
  const c = centre(sq);
  const pxPerS = sq.width * A_PER_PX;
  const u = o.size / 32;
  // The rings to come: where every spot sits, and where the powder's rings will be.
  g.save();
  g.strokeStyle = withAlpha(COLOR.recip, 0.3);
  g.lineWidth = 2.5 * u;
  g.setLineDash([9 * u, 11 * u]);
  for (const m of RING_ORDERS) {
    g.beginPath();
    g.arc(c.x, c.y, ringRadius(m) * pxPerS, 0, TAU);
    g.stroke();
  }
  g.restore();
  // One crystal's spots, as bright as the brightest ring and big enough to see from afar.
  const single = s.crush === 0 && view.shown === key;
  const spotR = Math.max(7, sq.width * 0.034);
  if (single) {
    const img = spotSprite();
    const reach = 1 / (2 * A_PER_PX);
    const m = Math.floor(reach * A);
    g.save();
    for (let h = -m; h <= m; h++) {
      for (let kk = -m; kk <= m; kk++) {
        // The centre is the beam stop's, and spots straight down sit under its arm.
        if (h === 0 && kk <= 0) continue;
        if (Math.hypot(h, kk) / A > reach) continue;
        const b = spotBrightness(h, kk);
        if (b < 0.05) continue;
        g.globalAlpha = Math.min(1, b);
        const rad = spotR * (0.7 + 0.3 * b);
        const x = c.x + (h / A) * pxPerS;
        const y = c.y - (kk / A) * pxPerS;
        g.drawImage(img, x - rad, y - rad, 2 * rad, 2 * rad);
      }
    }
    g.restore();
  }
  g.restore();
  if (single && o.layers) {
    const [h, kk] = LABEL_SPOT;
    spotLabel(g, r, sq, { x: c.x + (h / A) * pxPerS, y: c.y - (kk / A) * pxPerS }, o.layers, {
      size: o.size,
      ring: spotR * 1.25,
    });
  }
  // The first ring's radius, |S| = 1/d for d = a: span/a pixels of the pattern.
  const k = (o.ringLevel ?? 0) + (o.ringAlpha ?? 0);
  if (k > 0.01) {
    const rr = pxPerS / A;
    g.save();
    g.globalAlpha = Math.min(1, k);
    g.strokeStyle = COLOR.recip;
    g.lineWidth = 4 * (1 + (o.ringLevel ?? 0));
    g.setLineDash([12, 10]);
    g.beginPath();
    g.arc(c.x, c.y, rr, 0, Math.PI * 2);
    g.stroke();
    g.restore();
    g.save();
    g.globalAlpha = Math.min(1, k);
    arrow(g, c.x, c.y, c.x + rr * Math.cos(-0.5), c.y + rr * Math.sin(-0.5), COLOR.recip, 5, 20);
    g.restore();
    label(g, "|S|", c.x + rr * 0.55, c.y - rr * 0.42, {
      size: o.size,
      color: COLOR.recip,
      italic: true,
      alpha: Math.min(1, k),
    });
  }
  cornerTag(g, r, COMMON.flat, { size: o.size, corner: "bl" });
  return sq;
};

const def: ChapterDef = {
  id: "patterns",
  state: [
    [0, GRAINS.length - 1],
    [0, 100],
    [0, 1],
  ],
  start: encode(START),
  play(t) {
    // Crush a crystal a blow at a time, then line the grains up into arcs and spots again.
    const k = Math.floor(t / 3) % 9;
    return k < 5
      ? encode({ crush: k, lineUp: 0, map: false })
      : encode({ crush: 4, lineUp: [0.8, 0.9, 0.98, 0][k - 5]!, map: false });
  },
  parts: PARTS,
  split: 0.34,
  watch(g, rect, state, look) {
    drawWatch(g, rect, decode(state), look.view("pattern"), look, look.size, {
      size: Math.max(28, rect.height * 0.035),
      layers: L.layers,
    });
  },
  drive(state): MachineDrive {
    const s = decode(state);
    const l = lookOf(s);
    return {
      sample: {
        crystal: "aluminium",
        form: l === "spots" ? "single" : l === "arcs" ? "foil" : "powder",
        spread: spreadOf(s),
      },
    };
  },
  create(env: ChapterEnv): Chapter {
    let s: PatternsState = { ...START };
    let card: CardLayout | null = null;
    let controls: Control[] = [];
    let view: PatternView | null = null;
    let grindBtn: Button | null = null;
    let mapBtn: Button | null = null;
    let lineUp: Slider | null = null;
    let narrow = false;
    let grains: Grain[] = grainsOf(s);
    let grainsKey = "";
    /** The grains before the latest blow, which the new, smaller ones break away from. */
    let parents: Grain[] = grains;
    let blowAt = Number.NEGATIVE_INFINITY;
    let grinding = false;
    let nextBlowAt = 0;
    let sayingArcs = false;
    let away: boolean | null = null;
    let dSpot: { x: number; y: number } | null = null;
    let ringSpot: { x: number; y: number } | null = null;

    const refreshGrains = () => {
      const key = `${s.crush}:${Math.round(s.lineUp * 100)}`;
      if (key === grainsKey) return;
      grainsKey = key;
      grains = grainsOf(s);
    };

    const strike = (now: number) => {
      const next = blow(s);
      if (next === s) return;
      parents = s.crush === 0 ? [{ x: 0, y: 0, angle: 0 }] : grains;
      s = next;
      refreshGrains();
      blowAt = now;
    };

    /** The one big button: grind the crystal to powder, then start again with a new one. */
    const press = () => {
      if (grinding) return;
      const now = performance.now();
      if (s.crush >= GRAINS.length - 1) {
        s = { ...s, crush: 0 };
        parents = [{ x: 0, y: 0, angle: 0 }];
        blowAt = Number.NEGATIVE_INFINITY;
        refreshGrains();
        return;
      }
      grinding = true;
      strike(now);
      nextBlowAt = now + GRIND_STEP_MS;
    };

    const faceButton = () => {
      const b = grindBtn;
      if (!b) return;
      const powder = s.crush >= GRAINS.length - 1 && !grinding;
      b.label = powder ? L.mend! : narrow ? L.crushShort! : L.crush!;
      b.icon = powder ? crystalIcon : ICON.hammer;
      b.color = powder ? COLOR.real : COLOR.accent;
      b.look = powder ? "ghost" : "solid";
    };

    const make = (l: CardLayout) => {
      const c = l.child;
      const a = l.adult;
      const wide = a.width >= 600;
      const showMap = env.config.maps;
      const h = Math.min(c.height, l.target * 1.35);
      const mid = (r: Rect): Rect => ({
        x: r.x,
        y: r.y + (r.height - h) / 2,
        width: r.width,
        height: h,
      });
      const mapInRow = showMap && !wide;
      let grindCell: Rect;
      let mapCell: Rect | null = null;
      if (mapInRow) {
        const [gc, rc] = splitRow(c, [1.6, 1], 24) as [Rect, Rect];
        grindCell = gc;
        mapCell = rc;
      } else {
        const w = Math.min(c.width, 720);
        grindCell = { ...c, x: c.x + (c.width - w) / 2, width: w };
      }
      narrow = grindCell.width < 440;
      grindBtn = button({
        id: "crush",
        rect: mid(grindCell),
        band: "child",
        label: L.crush!,
        icon: ICON.hammer,
        look: "solid",
        color: COLOR.accent,
        size: l.type.label * 1.1,
        onPress: press,
      });
      faceButton();
      const [sr, rr] = wide && showMap ? splitRow(a, [0.66, 0.34], 28) : [a, null];
      lineUp = slider({
        id: "line",
        rect: sr!,
        band: "adult",
        label: L.line!,
        min: 0,
        max: 1,
        step: 0.01,
        value: s.lineUp,
        color: COLOR.real,
        size: l.type.label,
        format: (v) =>
          v < 0.03 ? L.random! : v > 0.97 ? L.aligned! : `± ${Math.round((1 - v) * 180)}°`,
        onChange: (v) => {
          s = { ...s, lineUp: v };
        },
      });
      mapBtn = null;
      if (showMap) {
        const r = rr ?? mapCell!;
        const bh = Math.min(r.height, l.target * 1.1);
        mapBtn = button({
          id: "map",
          rect: rr
            ? { x: r.x, y: r.y + r.height - bh, width: r.width, height: bh }
            : { ...mid(r), y: mid(r).y + (h - bh) / 2, height: bh },
          band: rr ? "adult" : "child",
          label: L.map!,
          color: COLOR.recip,
          on: s.map,
          size: l.type.label,
          onPress: () => {
            s = { ...s, map: !s.map };
            if (mapBtn) mapBtn.on = s.map;
          },
        });
      }
      controls = [grindBtn, lineUp, ...(mapBtn ? [mapBtn] : [])];
    };

    const sync = () => {
      if (lineUp) lineUp.value = s.lineUp;
      if (mapBtn) mapBtn.on = s.map;
      faceButton();
    };

    /** A grain as a chip of crystal: an uneven outline round its rows of atoms. */
    const chip = (
      g: CanvasRenderingContext2D,
      x: number,
      y: number,
      angle: number,
      radius: number,
      k: number,
      seed: number,
      atomR: number,
    ) => {
      const c = Math.cos(angle);
      const sn = Math.sin(angle);
      // A powder's grains are too small for their atoms: they show their rows instead, and a
      // dark rim keeps neighbours apart.
      const fine = radius * k < 16;
      const size = radius * k * (fine ? 0.82 : 1);
      const sides = 7;
      g.beginPath();
      for (let i = 0; i < sides; i++) {
        const t = angle + (i / sides) * TAU + hash(seed, i) * 0.5;
        const rr = size * (0.92 + 0.22 * hash(seed, i + 9));
        const px = x + Math.cos(t) * rr;
        const py = y - Math.sin(t) * rr;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      g.globalAlpha = fine ? 0.55 + 0.35 * hash(seed, 31) : 1;
      g.fillStyle = fine ? COLOR.real : CHIP_FILL;
      g.fill();
      g.globalAlpha = 1;
      g.strokeStyle = fine ? CHIP_GAP : CHIP_EDGE;
      g.lineWidth = 2;
      g.stroke();
      if (fine) {
        // Two rows of atoms, along the grain's own turn.
        g.strokeStyle = CHIP_ROW;
        g.lineWidth = Math.max(1.5, atomR * 0.7);
        for (const off of [-0.5, 0.5]) {
          const ox = -sn * off * A * k;
          const oy = -c * off * A * k;
          g.beginPath();
          g.moveTo(x + ox - c * size * 0.7, y + oy + sn * size * 0.7);
          g.lineTo(x + ox + c * size * 0.7, y + oy - sn * size * 0.7);
          g.stroke();
        }
        return;
      }
      const inner = radius * 0.84;
      const m = Math.ceil(inner / A);
      g.fillStyle = COLOR.real;
      for (let i = -m; i <= m; i++) {
        for (let j = -m; j <= m; j++) {
          const ax = i * A;
          const ay = j * A;
          if (ax * ax + ay * ay > inner * inner) continue;
          g.beginPath();
          g.arc(x + (ax * c - ay * sn) * k, y - (ax * sn + ay * c) * k, atomR, 0, TAU);
          g.fill();
        }
      }
    };

    const drawSample = (g: CanvasRenderingContext2D, l: CardLayout, now: number) => {
      const f = l.figure;
      const link = env.link;
      const cy = l.beamY;
      const cx = f.x + f.width / 2;
      const R = Math.min(f.height * 0.46, f.width * 0.3, cy - f.y - 10, f.y + f.height - cy - 10);
      const k = R / FIELD;
      const atomR = Math.max(2.5, Math.min(5, k * 0.75));
      // Pieces fly from where they broke off for a moment after each blow.
      const tb = Math.min(1, Math.max(0, (now - blowAt) / BURST_MS));
      const e = 1 - (1 - tb) ** 3;
      const jolt = tb < 1 ? Math.sin(tb * 26) * 9 * (1 - tb) : 0;
      g.save();
      g.translate(jolt, 0);
      g.beginPath();
      g.arc(cx, cy, R + 14, 0, TAU);
      g.fillStyle = withAlpha(COLOR.real, 0.06);
      g.fill();
      const size = SIZES[s.crush]!;
      const placeOf = (gr: Grain, i: number) => {
        if (tb >= 1 || parents.length === 0) return gr;
        const p = parents[i % parents.length]!;
        return {
          x: p.x + (gr.x - p.x) * e,
          y: p.y + (gr.y - p.y) * e,
          angle: p.angle + (gr.angle - p.angle) * e,
        };
      };
      if (s.crush === 0) chip(g, cx, cy, 0, SIZES[0], k, 1, atomR);
      else
        grains.forEach((gr, i) => {
          const p = placeOf(gr, i);
          chip(g, cx + p.x * k, cy - p.y * k, p.angle, size, k, i + 7 * s.crush, atomR);
        });
      // Dust off each blow.
      if (tb < 1) {
        for (let i = 0; i < 28; i++) {
          const a = hash(i, s.crush) * TAU;
          const d = R * (0.35 + 0.8 * hash(i + 40, s.crush)) * (0.5 + e * 0.8);
          disc(
            g,
            cx + Math.cos(a) * d,
            cy - Math.sin(a) * d,
            2 + 3 * hash(i, 3),
            COLOR.ink,
            0.7 * (1 - tb),
          );
        }
      }
      g.restore();
      drawHammer(g, cx, cy, R, now);
      // d: the gap between two atoms along the top row of the crystal (or the first grain).
      // On a powder it rides on the top-most grain, and only while the Maths is open.
      let top: Grain | null = null;
      if (s.crush > 0 && env.mathsOpen?.()) {
        let best = -1;
        grains.forEach((gr, i) => {
          if (gr.y > (top?.y ?? Number.NEGATIVE_INFINITY)) {
            top = gr;
            best = i;
          }
        });
        if (top) top = placeOf(top, best);
      }
      const gr0: Grain | null = s.crush === 0 ? { x: 0, y: 0, angle: 0 } : top;
      if (gr0) {
        const c = Math.cos(gr0.angle);
        const sn = Math.sin(gr0.angle);
        const p = (x: number, y: number) => ({
          x: cx + (gr0.x + x * c - y * sn) * k,
          y: cy - (gr0.y + x * sn + y * c) * k,
        });
        const inner = size * 0.84;
        const row = Math.floor(Math.sqrt(Math.max(0, inner * inner - A * A)) / A) * A;
        const lift = (atomR + 16) / k;
        const p0 = p(0, row + lift);
        const p1 = p(A, row + lift);
        g.save();
        g.globalAlpha = presence(link, "d", now);
        bracket(g, p0.x, p0.y, p1.x, p1.y, {
          label: "d",
          color: COLOR.accent,
          width: 4 * emphasis(link, "d", now),
          size: l.type.label,
        });
        g.restore();
        dSpot = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      }
    };

    /** The hammer beside the sample while it grinds: raised, then down at each blow. */
    const drawHammer = (
      g: CanvasRenderingContext2D,
      cx: number,
      cy: number,
      R: number,
      now: number,
    ) => {
      const since = now - blowAt;
      const fade = grinding ? 1 : Math.max(0, 1 - (since - 500) / 400);
      if (fade <= 0) return;
      const toNext = grinding ? nextBlowAt - now : Number.POSITIVE_INFINITY;
      // Down at a blow, up over 0.35 s, and swinging down again in the last 0.15 s before the next.
      const up =
        toNext < 150 ? Math.max(0, toNext / 150) : Math.min(1, Math.max(0, (since - 60) / 350));
      const lift = up * 0.95;
      const len = R * 1.25;
      const px = cx + R * 0.55 + len * 0.95;
      const py = cy + R * 0.25;
      g.save();
      g.globalAlpha = fade;
      g.translate(px, py);
      g.rotate(lift);
      // Handle from the pivot to the head, which lands on the sample's right shoulder.
      g.strokeStyle = COLOR.accent;
      g.lineCap = "round";
      g.lineWidth = Math.max(10, R * 0.09);
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(-len, -R * 0.42);
      g.stroke();
      g.translate(-len, -R * 0.42);
      g.rotate(Math.atan2(-R * 0.42, -len) + Math.PI / 2);
      g.fillStyle = COLOR.accent;
      g.beginPath();
      g.roundRect(-R * 0.34, -R * 0.15, R * 0.68, R * 0.3, R * 0.06);
      g.fill();
      g.restore();
    };

    return {
      layout(l) {
        card = l;
        make(l);
      },
      get controls() {
        return controls;
      },
      update(_dt, now) {
        if (grinding && now >= nextBlowAt) {
          strike(now);
          if (s.crush >= GRAINS.length - 1) grinding = false;
          else nextBlowAt = now + GRIND_STEP_MS;
        }
        refreshGrains();
        faceButton();
        // Grains that mostly face one way: the caption says what arcs mean.
        const look = lookOf(s);
        const arcs = look === "arcs" && !s.map;
        if (arcs !== sayingArcs) {
          sayingArcs = arcs;
          env.say?.({ caption: arcs ? T.more!.arcs! : null });
        }
        if (lineUp && !lineUp.held) lineUp.value = s.lineUp;
        if (s.crush >= 2 && look === "rings") env.earn();
        // The So line is about rings; it dims while the picture shows spots or arcs.
        const off = look !== "rings";
        if (off !== away) {
          away = off;
          env.away?.(off);
        }
      },
      draw(g, now) {
        if (!card) return;
        view ??= env.engine().view({ tint: "recip" });
        const sq = drawWatch(g, card.watch, s, view, env, 256, {
          size: card.type.small,
          ringLevel: env.link.level("S", now),
          layers: L.layers,
        });
        const c = centre(sq);
        ringSpot = { x: c.x + (sq.width * A_PER_PX) / A, y: c.y };
        well(g, card.figure, { fill: withAlpha(COLOR.well, 0.6) });
        clipTo(g, card.figure, 28);
        drawSample(g, card, now);
        g.restore();
      },
      partAt(x, y) {
        if (dSpot && Math.hypot(x - dSpot.x, y - dSpot.y) < 70) return "d";
        if (ringSpot && Math.hypot(x - ringSpot.x, y - ringSpot.y) < 70) return "S";
        return null;
      },
      numbers() {
        const ring = (h: number, k: number) => {
          const d = A / Math.hypot(h, k);
          return `(${h} ${k})  d = ${d.toFixed(2)} Å  |S| = ${(1 / d).toFixed(3)} Å⁻¹`;
        };
        return [ring(1, 0), ring(1, 1), ring(2, 0)];
      },
      state: (): ChapterState => encode(s),
      demo(): DemoStep[] {
        return [
          { control: "crush" },
          { wait: GRIND_STEP_MS * GRAINS.length + 600 },
          { control: "line", to: 0.9, ms: 1800 },
          { wait: 1500 },
          { control: "line", to: 0, ms: 1400 },
        ];
      },
      hint() {
        // Once it is powder the button says "New crystal"; the hand rests only on "Grind".
        if (s.crush >= GRAINS.length - 1 && !grinding) return null;
        return grindBtn ? centre(grindBtn.rect) : null;
      },
      status() {
        return { grains: GRAINS[s.crush]!, look: lookOf(s), map: s.map, grinding };
      },
      reset() {
        s = { ...START };
        grinding = false;
        blowAt = Number.NEGATIVE_INFINITY;
        parents = [{ x: 0, y: 0, angle: 0 }];
        sayingArcs = false;
        away = null;
        refreshGrains();
        sync();
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
