/**
 * Chapter 8, why some spots go missing. Where the atoms sit inside each repeat decides how each
 * spot's arrows add: drag one or two more atoms into the cell and the spots dim and brighten; put
 * a heavy one in the middle and every spot with h + k odd cancels. Two real cases: potassium
 * chloride, whose two ions have 18 electrons each, so it looks like a cell half as wide; and
 * aluminium, whose face-centred atoms take whole rings out of its powder pattern.
 *
 * - Watch view: the engine's pattern of the flat cell, missing spots ringed (aluminium: its rings
 *   beside the ones a simple cell would add).
 * - Figure: the cell and a tray of two atoms (drag them in, tap one to make it heavy or light),
 *   and beside it the arrow sum of the chosen spot. The heavy atom waits in the lower slot, in a
 *   child's reach. When it lands in the middle the arrow sum moves to a spot that just vanished.
 * - Children: your atoms, aluminium, potassium chloride. Adults: the Spot button and Empty.
 * - A real case's sentence takes the caption's place (`env.say`), not a column of the watch view.
 * - Linked formula F = Σ f exp(2πi(hx + ky)): F the orange sum, f each atom's arrow, x and y the
 *   atoms' places and the turns they give the arrows. A note adds lz for aluminium's 3D cell (the
 *   longer formula wraps in the fold).
 */
import { withAlpha } from "../../../../core/ui/palette";
import { COMMON, TEXT } from "../../captions";
import type { Chapter, ChapterDef, ChapterEnv, DemoStep, MachineDrive } from "../../chapter";
import { COLOR } from "../../config";
import {
  button,
  type Button,
  type Control,
  font,
  type Gesture,
  pad,
  type Pad,
  type Touch,
} from "../../controls";
import { arrow, beam, clipTo, cornerTag, disc, label, line, well, wrapLines } from "../../draw";
import type { PatternView } from "../../engine/client";
import { emphasis, presence } from "../../formula";
import { type CardLayout, centre, inset, type Rect, splitRow, square } from "../../layout";
import {
  A_PER_PX,
  AL_A,
  type AbsencesState,
  alRings,
  CASES,
  centred,
  CENTRE,
  checkered,
  chosenSum,
  decode,
  encode,
  flatCell,
  type FlatAtom,
  GONE,
  GRID,
  jobKey,
  missingSpots,
  patternJob,
  openingSpot,
  type Placed,
  playAt,
  siteUV,
  snap,
  SPOTS_2D,
  SPOTS_AL,
  spotName,
  START,
  STATE_RANGES,
  type Sum,
  vanishedSpot,
} from "./model";

const T = TEXT.absences;
const L = T.labels;

export const PARTS = { F: COLOR.recip, f: COLOR.real, pos: COLOR.angle } as const;

const LIGHT_GREEN = "#c9f0d2";
const DARK_GREEN = "#4fb36a";
const TAP_PX = 22;
const TAP_MS = 500;

const kindColour = (k: string): string =>
  k === "light" ? LIGHT_GREEN : k === "K" ? DARK_GREEN : COLOR.real;

interface Fig {
  cell: Rect;
  tray: [Rect, Rect];
  arrows: Rect;
  /** Where a finger can move atoms: the cell and the tray. */
  touch: Rect;
}

const figLayout = (l: CardLayout): Fig => {
  const f = l.figure;
  const inner = inset(f, 16, 12);
  const gap = 22;
  const trayW = Math.max(140, Math.min(200, l.target * 1.25));
  if (l.outer) {
    const sf = l.safe;
    const x0 = Math.max(inner.x, sf.x + 8);
    const x1 = Math.min(inner.x + inner.width, sf.x + sf.width - 8);
    const lane = { x: x0, y: inner.y, width: x1 - x0, height: inner.height };
    const cs = Math.min(lane.height, lane.width - trayW - gap);
    const cy = lane.y + (lane.height - cs) / 2;
    // The cell at the outer edge, the tray inside it, the arrows toward the seam.
    const right = l.outer === "right";
    const cellX = right ? lane.x + lane.width - cs : lane.x;
    const trayX = right ? cellX - gap - trayW : cellX + cs + gap;
    const arrows = right
      ? { x: inner.x, y: inner.y, width: trayX - gap - inner.x, height: inner.height }
      : {
          x: trayX + trayW + gap,
          y: inner.y,
          width: inner.x + inner.width - (trayX + trayW + gap),
          height: inner.height,
        };
    return build({ x: cellX, y: cy, width: cs, height: cs }, trayX, trayW, gap, square(arrows));
  }
  const aw = Math.min(inner.width * 0.34, inner.height * 1.1);
  const cs = Math.min(inner.height, inner.width - aw - trayW - 2 * gap);
  const total = cs + gap + trayW + gap + aw;
  const x0 = inner.x + (inner.width - total) / 2;
  const cy = inner.y + (inner.height - cs) / 2;
  const arrows = {
    x: x0 + cs + gap + trayW + gap,
    y: inner.y + (inner.height - Math.min(aw, inner.height)) / 2,
    width: aw,
    height: Math.min(aw, inner.height),
  };
  return build({ x: x0, y: cy, width: cs, height: cs }, x0 + cs + gap, trayW, gap, arrows);
};

const build = (cell: Rect, trayX: number, trayW: number, gap: number, arrows: Rect): Fig => {
  const slotH = (cell.height - gap) / 2;
  // The heavy atom (the first) waits in the lower slot, where a child can reach it.
  const tray: [Rect, Rect] = [
    { x: trayX, y: cell.y + slotH + gap, width: trayW, height: slotH },
    { x: trayX, y: cell.y, width: trayW, height: slotH },
  ];
  const x0 = Math.min(cell.x, trayX);
  const x1 = Math.max(cell.x + cell.width, trayX + trayW);
  return {
    cell,
    tray,
    arrows,
    touch: { x: x0, y: cell.y, width: x1 - x0, height: cell.height },
  };
};

/** Screen point of a cell position (u along, v up). */
const inCell = (c: Rect, u: number, v: number) => ({
  x: c.x + u * c.width,
  y: c.y + c.height - v * c.height,
});

const atomRadius = (c: Rect, kind: string): number =>
  c.width *
  (kind === "heavy"
    ? 0.085
    : kind === "light"
      ? 0.058
      : kind === "K"
        ? 0.062
        : kind === "Cl"
          ? 0.08
          : 0.07);

/** Every image of a cell position inside the cell's square, edges included. */
const images = (u: number, v: number): [number, number][] => {
  const out: [number, number][] = [];
  for (const du of [-1, 0, 1])
    for (const dv of [-1, 0, 1]) {
      const x = u + du;
      const y = v + dv;
      if (x >= -1e-6 && x <= 1 + 1e-6 && y >= -1e-6 && y <= 1 + 1e-6) out.push([x, y]);
    }
  return out;
};

const drawAtom = (
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  kind: string,
  alpha = 1,
  ring = false,
) => {
  g.save();
  g.globalAlpha = alpha;
  const grad = g.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  const c = kindColour(kind);
  grad.addColorStop(0, withAlpha("#ffffff", 0.9));
  grad.addColorStop(0.35, c);
  grad.addColorStop(1, withAlpha(c, 0.75));
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  if (ring) {
    g.strokeStyle = COLOR.accent;
    g.lineWidth = 4;
    g.stroke();
  }
  g.restore();
};

/**
 * The chosen spot's name, with "One set of layers" under it: beside the pattern with a leader line
 * where there is room, else on a dark pill just off the ring, so it never sits on another spot.
 */
const spotTag = (
  g: CanvasRenderingContext2D,
  r: Rect,
  sq: Rect,
  at: { x: number; y: number; rad: number },
  name: string,
  o: { size: number; u: number; level: number },
) => {
  const { size, u } = o;
  const nameSize = size * 0.9;
  const subSize = size * 0.66;
  const sub = L.layers!;
  g.save();
  g.font = font(800, nameSize);
  const nw = g.measureText(name).width;
  g.font = font(700, subSize);
  const sw = g.measureText(sub).width;
  g.restore();
  const gap = 24 * u;
  const room = r.x + r.width - (sq.x + sq.width) - gap - 16 * u;
  // Beside the pattern with "One set of layers" under it; or the name alone where that's too wide.
  const withSub = room >= Math.max(nw, sw) + 20 * u;
  if (withSub || room >= nw + 20 * u) {
    const lx = sq.x + sq.width + gap;
    const ly = Math.max(
      sq.y + nameSize,
      Math.min(sq.y + sq.height - nameSize * 1.8, at.y - nameSize * 0.45),
    );
    const a = Math.atan2(ly - at.y, lx - 10 * u - at.x);
    line(
      g,
      at.x + Math.cos(a) * at.rad,
      at.y + Math.sin(a) * at.rad,
      lx - 10 * u,
      ly,
      withAlpha(COLOR.accent, 0.8),
      3 * u * (1 + o.level),
    );
    label(g, name, lx, ly, { size: nameSize, color: COLOR.accent, align: "left", weight: 800 });
    if (withSub)
      label(g, sub, lx, ly + nameSize * 0.95, {
        size: subSize,
        color: COLOR.muted,
        align: "left",
        weight: 700,
      });
    return;
  }
  const pad = 12 * u;
  const bw = nw + 2 * pad;
  const bh = nameSize * 1.4;
  const bx = Math.max(sq.x + 6 * u, Math.min(sq.x + sq.width - bw - 6 * u, at.x - bw / 2));
  let by = at.y - at.rad - 8 * u - bh;
  if (by < sq.y + 6 * u) by = at.y + at.rad + 8 * u;
  g.save();
  g.fillStyle = withAlpha(COLOR.background, 0.86);
  g.beginPath();
  g.roundRect(bx, by, bw, bh, bh / 2);
  g.fill();
  g.restore();
  label(g, name, bx + bw / 2, by + bh / 2, { size: nameSize, color: COLOR.accent, weight: 800 });
};

/**
 * A pill naming what the picture is ("A flat model"), in a margin beside the pattern where it
 * fits, else wrapped small at the foot of the right margin, else over the pattern's corner.
 */
const caseTag = (g: CanvasRenderingContext2D, r: Rect, sq: Rect, text: string, size: number) => {
  g.save();
  g.font = font(700, size);
  const w = g.measureText(text).width + size * 1.2 + 32;
  g.restore();
  const left = sq.x - r.x;
  const right = r.x + r.width - (sq.x + sq.width);
  if (w <= left || left >= right) {
    cornerTag(g, r, text, { size, corner: "bl" });
    return;
  }
  if (w <= right) {
    cornerTag(g, r, text, { size, corner: "br" });
    return;
  }
  g.save();
  g.font = font(700, size);
  const all = wrapLines(g, text, right - 40);
  g.restore();
  if (right >= size * 7 && all.length <= 2) {
    g.save();
    g.font = font(700, size);
    g.fillStyle = COLOR.muted;
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    all.forEach((l, i) =>
      g.fillText(l, sq.x + sq.width + 24, r.y + r.height - 26 - (all.length - 1 - i) * size * 1.2),
    );
    g.restore();
    return;
  }
  cornerTag(g, r, text, { size, corner: "bl" });
};

/** The pattern's square in the watch: spots and rings in Å⁻¹ at a fixed scale. */
const watchSquare = (r: Rect, k = 1): Rect => square(inset(r, 12 * k));

/** The watch view: the pattern or aluminium's rings, missing spots marked, the chosen spot ringed. */
const drawWatch = (
  g: CanvasRenderingContext2D,
  r: Rect,
  s: AbsencesState,
  view: PatternView,
  n: number,
  o: { size: number; FLevel?: number },
) => {
  well(g, r);
  // Strokes follow the type size, so the screen's big copy reads like a panel's.
  const u = o.size / 38;
  const sq = watchSquare(r, u);
  const c = centre(sq);
  const pxPerS = sq.width * A_PER_PX;
  const lvl = o.FLevel ?? 0;
  if (s.kase === "aluminium") {
    clipTo(g, sq, 20);
    g.fillStyle = "#06080f";
    g.fillRect(sq.x, sq.y, sq.width, sq.height);
    const chosen = SPOTS_AL[s.spot] ?? SPOTS_AL[0]!;
    const chosenN = chosen[0] ** 2 + chosen[1] ** 2 + chosen[2] ** 2;
    for (const ring of alRings()) {
      const rr = ring.S * pxPerS;
      g.save();
      if (ring.height > 0) {
        g.strokeStyle = withAlpha(COLOR.recip, 0.3 + 0.7 * Math.sqrt(ring.height / 100));
        g.lineWidth = u * (3 + 6 * Math.sqrt(ring.height / 100));
        g.shadowColor = withAlpha(COLOR.recip, 0.6);
        g.shadowBlur = 12;
      } else {
        g.strokeStyle = withAlpha(COLOR.ink, 0.28);
        g.lineWidth = 2.5 * u;
        g.setLineDash([10 * u, 12 * u]);
      }
      g.beginPath();
      g.arc(c.x, c.y, rr, 0, Math.PI * 2);
      g.stroke();
      g.restore();
      if (ring.N === chosenN) {
        // On the ring itself, so the marker shows which ring it names.
        g.save();
        g.strokeStyle = COLOR.accent;
        g.lineWidth = 3.5 * u * (1 + lvl);
        g.setLineDash([6 * u, 7 * u]);
        g.beginPath();
        g.arc(c.x, c.y, rr, 0, Math.PI * 2);
        g.stroke();
        g.restore();
      }
    }
    disc(g, c.x, c.y, sq.width * 0.025, "#141a28");
    g.restore();
    const ring = alRings().find((x) => x.N === chosenN);
    if (ring) {
      const rr = ring.S * pxPerS;
      const at = { x: c.x + rr * Math.SQRT1_2, y: c.y - rr * Math.SQRT1_2, rad: 0 };
      disc(g, at.x, at.y, 7 * u, COLOR.accent);
      spotTag(g, r, sq, { ...at, rad: 10 * u }, spotName(s), { size: o.size, u, level: lvl });
    }
    // Rings worked out from aluminium's atoms, not measured.
    caseTag(g, r, sq, L.computed!, o.size * 0.8);
  } else {
    const job = patternJob(s, n);
    if (job) view.want(jobKey(s, n), () => job);
    clipTo(g, sq, 20);
    view.draw(g, sq);
    g.restore();
    const cell = flatCell(s)!;
    // Spots that cancelled, ringed faintly so their absence shows.
    g.save();
    g.strokeStyle = withAlpha(COLOR.ink, 0.38);
    g.lineWidth = 2.5 * u;
    g.setLineDash([5 * u, 6 * u]);
    const ghost = Math.max(7, (pxPerS / cell.a) * 0.2);
    for (const [h, k] of missingSpots(cell.atoms, cell.a, 0.5 / A_PER_PX)) {
      const x = c.x + (h / cell.a) * pxPerS;
      const y = c.y - (k / cell.a) * pxPerS;
      if (Math.abs(x - c.x) > sq.width / 2 - ghost || Math.abs(y - c.y) > sq.height / 2 - ghost)
        continue;
      g.beginPath();
      g.arc(x, y, ghost, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
    const [h, k] = SPOTS_2D[s.spot] ?? SPOTS_2D[0]!;
    const x = c.x + (h / cell.a) * pxPerS;
    const y = c.y - (k / cell.a) * pxPerS;
    g.save();
    g.strokeStyle = COLOR.accent;
    g.lineWidth = 4 * u * (1 + lvl);
    g.beginPath();
    g.arc(x, y, ghost * 2.1, 0, Math.PI * 2);
    g.stroke();
    g.restore();
    spotTag(g, r, sq, { x, y, rad: ghost * 2.1 }, spotName(s), { size: o.size, u, level: lvl });
    caseTag(g, r, sq, COMMON.flat, o.size * 0.8);
  }
};

/** The chain of arrows for one spot, fitted into `r`; returns where the parts sit. */
const drawSum = (
  g: CanvasRenderingContext2D,
  r: Rect,
  sum: Sum,
  name: string,
  o: { size: number; link: ChapterEnv["link"]; now: number },
) => {
  well(g, r, { fill: withAlpha(COLOR.well, 0.85) });
  const { link, now } = o;
  label(g, name, r.x + 20, r.y + o.size * 0.85, {
    size: o.size,
    color: COLOR.accent,
    align: "left",
  });
  const barH = Math.max(18, r.height * 0.07);
  const plot = inset(
    { ...r, y: r.y + o.size * 1.6, height: r.height - o.size * 1.6 - barH - 34 },
    18,
    6,
  );
  // The chain's own extent, then fitted and centred.
  const pts: { x: number; y: number }[] = [{ x: 0, y: 0 }];
  let x = 0;
  let y = 0;
  for (const a of sum.arrows) {
    x += a.f * Math.cos(a.phase);
    y += a.f * Math.sin(a.phase);
    pts.push({ x, y });
  }
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  const k =
    Math.min(
      plot.width / Math.max(w, sum.inStep * 0.35),
      plot.height / Math.max(h, sum.inStep * 0.35),
    ) * 0.9;
  const ox = plot.x + plot.width / 2 - ((Math.max(...xs) + Math.min(...xs)) / 2) * k;
  const oy = plot.y + plot.height / 2 + ((Math.max(...ys) + Math.min(...ys)) / 2) * k;
  const P = (p: { x: number; y: number }) => ({ x: ox + p.x * k, y: oy - p.y * k });
  const out: { part: string; x: number; y: number }[] = [];
  const fA = presence(link, "f", now);
  const pA = presence(link, "pos", now);
  // The sum first, wide and soft, so the atoms' arrows show on top of it.
  const s0 = P(pts[0]!);
  const s1 = P(pts[pts.length - 1]!);
  const Fw = 14 * emphasis(link, "F", now);
  g.save();
  g.globalAlpha = 0.8 * presence(link, "F", now);
  if (Math.hypot(s1.x - s0.x, s1.y - s0.y) > 16)
    arrow(g, s0.x, s0.y, s1.x, s1.y, withAlpha(COLOR.recip, 0.75), Fw, 34);
  else {
    g.strokeStyle = COLOR.recip;
    g.lineWidth = Fw * 0.4;
    g.beginPath();
    g.arc(s0.x, s0.y, 16, 0, Math.PI * 2);
    g.stroke();
  }
  g.restore();
  out.push({ part: "F", x: (s0.x + s1.x) / 2, y: (s0.y + s1.y) / 2 });
  // Arrows along one line (every arrow in step, or exactly against another) would lie on top of
  // each other: draw them in lanes side by side, so arrows pointing opposite ways both show.
  const first = sum.arrows[0]?.phase ?? 0;
  const inLine =
    sum.arrows.length > 1 && sum.arrows.every((a) => Math.abs(Math.sin(a.phase - first)) < 0.05);
  const lane = inLine ? Math.max(18, Math.min(30, plot.height * 0.12)) : 0;
  const nx = Math.sin(first);
  const ny = Math.cos(first);
  sum.arrows.forEach((a, i) => {
    const off = (i - (sum.arrows.length - 1) / 2) * lane;
    const q0 = P(pts[i]!);
    const q1 = P(pts[i + 1]!);
    const p0 = { x: q0.x + nx * off, y: q0.y + ny * off };
    const p1 = { x: q1.x + nx * off, y: q1.y + ny * off };
    // The turn each position gives its arrow, from the flat.
    g.save();
    g.globalAlpha = 0.75 * pA;
    g.strokeStyle = COLOR.angle;
    g.lineWidth = 3 * emphasis(link, "pos", now);
    const ar = Math.min(26, a.f * k * 0.4);
    const ph = ((a.phase % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    if (ph > 0.05 && ar > 6) {
      g.beginPath();
      g.arc(p0.x, p0.y, ar, 0, -ph, true);
      g.stroke();
    }
    g.restore();
    g.save();
    g.globalAlpha = fA;
    arrow(g, p0.x, p0.y, p1.x, p1.y, kindColour(a.kind), 5 * emphasis(link, "f", now), 18);
    g.restore();
    out.push({ part: "f", x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 });
  });
  disc(g, s0.x, s0.y, 7, COLOR.ink);
  // |F|², as a share of what it would be with every arrow in step.
  const bar = {
    x: r.x + 20 + o.size * 2.2,
    y: r.y + r.height - barH - 22,
    width: r.width - 40 - o.size * 2.2,
    height: barH,
  };
  label(g, "|F|²", r.x + 20, bar.y + barH / 2, {
    size: o.size * 0.8,
    color: COLOR.recip,
    align: "left",
  });
  g.save();
  g.fillStyle = withAlpha(COLOR.ink, 0.12);
  g.fillRect(bar.x, bar.y, bar.width, bar.height);
  g.fillStyle = COLOR.recip;
  g.fillRect(
    bar.x,
    bar.y,
    bar.width * Math.min(1, sum.F2 / Math.max(1e-9, sum.inStep ** 2)),
    bar.height,
  );
  g.restore();
  return out;
};

const def: ChapterDef = {
  id: "absences",
  split: 0.44,
  state: STATE_RANGES,
  start: encode(START),
  play: (t) => encode(playAt(t)),
  parts: PARTS,
  watch(g, rect, state, look) {
    drawWatch(g, rect, decode(state), look.view("pattern"), look.size, {
      size: Math.max(24, Math.min(rect.height * 0.045, rect.width * 0.03, 90)),
    });
  },
  drive(state): MachineDrive {
    const s = decode(state);
    if (s.kase === "aluminium") return { sample: { crystal: "aluminium", form: "powder" } };
    if (s.kase === "kcl") return { sample: { crystal: "kcl", form: "powder" } };
    // Your own flat cell has no crystal to load.
    return {};
  },
  create(env: ChapterEnv): Chapter {
    let s: AbsencesState = {
      ...START,
      atoms: [...START.atoms] as unknown as AbsencesState["atoms"],
    };
    let card: CardLayout | null = null;
    let fig: Fig | null = null;
    let controls: Control[] = [];
    let cases: Button[] = [];
    let spotBtn: Button | null = null;
    let emptyBtn: Button | null = null;
    let cellPad: Pad | null = null;
    let patternPad: Pad | null = null;
    let view: PatternView | null = null;
    let parts: { part: string; x: number; y: number }[] = [];
    /** What the card was last told: the caption shown for a real case, and whether it is away. */
    let said: AbsencesState["kase"] = "mine";
    let away: boolean | null = null;
    let wasCentred = false;
    let drag: {
      i: 0 | 1;
      id: number;
      x0: number;
      y0: number;
      t0: number;
      x: number;
      y: number;
      moved: boolean;
    } | null = null;

    const setAtom = (i: 0 | 1, p: Placed) => {
      const atoms: [Placed, Placed] = [s.atoms[0], s.atoms[1]];
      atoms[i] = p;
      s = { ...s, atoms };
    };

    /** Where each movable atom is drawn: its images in the cell, or its tray slot. */
    const atomSpots = (i: 0 | 1): { x: number; y: number }[] => {
      if (!fig) return [];
      const p = s.atoms[i];
      if (p.site === 0) return [centre(fig.tray[i])];
      const [u, v] = siteUV(p.site);
      return images(u, v).map(([x, y]) => inCell(fig!.cell, x, y));
    };

    const grabAt = (x: number, y: number): 0 | 1 | null => {
      if (s.kase !== "mine" || !fig) return null;
      const reach = Math.max(70, (card?.target ?? 120) * 0.62);
      let best: 0 | 1 | null = null;
      let bestD = reach;
      for (const i of [0, 1] as const)
        for (const p of atomSpots(i)) {
          const d = Math.hypot(x - p.x, y - p.y);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      return best;
    };

    const drop = (i: 0 | 1, x: number, y: number) => {
      if (!fig) return;
      const c = fig.cell;
      const u = (x - c.x) / c.width;
      const v = (c.y + c.height - y) / c.height;
      const m = 0.16;
      const inside = u >= -m && u <= 1 + m && v >= -m && v <= 1 + m;
      const other = s.atoms[i === 0 ? 1 : 0].site;
      const site = inside ? snap(u, v, other ? [other] : []) : 0;
      setAtom(i, { ...s.atoms[i], site: Math.max(0, site) });
    };

    /** A bot's or demo's move on the cell: `to` 0 heavy atom to the middle, 1 tap the middle, 2 an atom to an edge. */
    const cellGesture = (rand: () => number, to?: number): Gesture | null => {
      if (!fig || s.kase !== "mine") return null;
      const path = (from: { x: number; y: number }, end: { x: number; y: number }) => ({
        path: Array.from({ length: 13 }, (_, k) => ({
          x: from.x + ((end.x - from.x) * k) / 12,
          y: from.y + ((end.y - from.y) * k) / 12,
        })),
        ms: 1200,
      });
      const mid = inCell(fig.cell, 0.5, 0.5);
      if (to === 0) {
        const i = s.atoms[0].heavy ? 0 : 1;
        return path(atomSpots(i)[0]!, mid);
      }
      if (to === 1) {
        const i = s.atoms.findIndex((p) => p.site === CENTRE);
        if (i < 0) return null;
        return { path: [mid], ms: 120 };
      }
      if (to === 2) return path(atomSpots(1)[0]!, inCell(fig.cell, 0.5, 0));
      const i = (rand() < 0.5 ? 0 : 1) as 0 | 1;
      const from = atomSpots(i)[0]!;
      if (rand() < 0.25) return { path: [from], ms: 120 };
      if (rand() < 0.15) return path(from, centre(fig.tray[i]));
      const u = Math.floor(rand() * (GRID + 1)) / GRID;
      const v = Math.floor(rand() * (GRID + 1)) / GRID;
      return path(from, inCell(fig.cell, u, v));
    };

    const make = (l: CardLayout) => {
      fig = figLayout(l);
      const c = l.child;
      const h = Math.min(c.height, l.target * 1.35);
      const narrow = c.width < 760;
      const cells = splitRow(
        { x: c.x, y: c.y + (c.height - h) / 2, width: c.width, height: h },
        narrow ? [0.8, 1.25, 0.8] : [1, 1, 1.45],
        18,
      );
      const names = narrow
        ? [L.mineShort!, L.aluminium!, L.kclShort!]
        : [L.mine!, L.aluminium!, L.kcl!];
      cases = cells.map((rect, i) =>
        button({
          id: `case${i}`,
          rect,
          band: "child",
          label: names[i]!,
          color: COLOR.real,
          on: CASES[i] === s.kase,
          size: l.type.label,
          onPress: () => {
            const next = CASES[i] ?? "mine";
            if (next !== s.kase) s = { ...s, kase: next, spot: openingSpot(next) };
            drag = null;
            sync();
          },
        }),
      );
      const a = l.adult;
      const bh = Math.min(a.height, l.target * 1.1);
      const [sr, er] = splitRow({ ...a, y: a.y + a.height - bh, height: bh }, [1.5, 1], 20);
      spotBtn = button({
        id: "spot",
        rect: sr!,
        band: "adult",
        label: `${L.spot} ${spotName(s)}`,
        color: COLOR.recip,
        size: l.type.label,
        onPress: () => {
          s = { ...s, spot: (s.spot + 1) % SPOTS_2D.length };
        },
      });
      emptyBtn = button({
        id: "empty",
        rect: er!,
        band: "adult",
        label: L.empty!,
        color: COLOR.real,
        size: l.type.label,
        onPress: () => {
          s = {
            ...s,
            atoms: [
              { ...s.atoms[0], site: 0 },
              { ...s.atoms[1], site: 0 },
            ],
          };
        },
      });
      cellPad = pad({
        id: "cell",
        rect: fig.touch,
        band: "adult",
        onDown: (t: Touch) => {
          const i = grabAt(t.x, t.y);
          drag =
            i === null
              ? null
              : { i, id: t.id, x0: t.x, y0: t.y, t0: t.time, x: t.x, y: t.y, moved: false };
        },
        onMove: (t) => {
          if (!drag || drag.id !== t.id) return;
          drag.x = t.x;
          drag.y = t.y;
          if (Math.hypot(t.x - drag.x0, t.y - drag.y0) > TAP_PX) drag.moved = true;
        },
        onUp: (t, cancelled) => {
          if (!drag || drag.id !== t.id) return;
          const d = drag;
          drag = null;
          if (cancelled) return;
          if (!d.moved && t.time - d.t0 < TAP_MS) {
            const p = s.atoms[d.i];
            setAtom(d.i, { ...p, heavy: !p.heavy });
          } else drop(d.i, t.x, t.y);
        },
        botGesture: cellGesture,
      });
      // Choosing a spot on the pattern itself, where a finger can reach it.
      const sq = watchSquare(l.watch);
      patternPad =
        sq.y + sq.height > l.reach.adult + l.target && sq.width >= l.target
          ? pad({
              id: "pattern",
              rect: sq,
              band: "adult",
              onDown: (t) => {
                const c0 = centre(sq);
                const k = sq.width * A_PER_PX;
                if (s.kase === "aluminium") {
                  const r = Math.hypot(t.x - c0.x, t.y - c0.y) / k;
                  let best = 0;
                  let bestD = Number.POSITIVE_INFINITY;
                  SPOTS_AL.forEach((hkl, i) => {
                    const d = Math.abs(Math.hypot(...hkl) / AL_A - r);
                    if (d < bestD) {
                      bestD = d;
                      best = i;
                    }
                  });
                  s = { ...s, spot: best };
                  return;
                }
                const a0 = flatCell(s)!.a;
                let best = s.spot;
                let bestD = Number.POSITIVE_INFINITY;
                SPOTS_2D.forEach(([h, kk], i) => {
                  for (const sg of [1, -1]) {
                    const x = c0.x + ((sg * h) / a0) * k;
                    const y = c0.y - ((sg * kk) / a0) * k;
                    const d = Math.hypot(t.x - x, t.y - y);
                    if (d < bestD) {
                      bestD = d;
                      best = i;
                    }
                  }
                });
                s = { ...s, spot: best };
              },
              botGesture: (rand) => {
                const c0 = centre(sq);
                const a0 = flatCell(s)?.a ?? 5;
                const [h, kk] = SPOTS_2D[Math.floor(rand() * SPOTS_2D.length)]!;
                const k = sq.width * A_PER_PX;
                return { path: [{ x: c0.x + (h / a0) * k, y: c0.y - (kk / a0) * k }], ms: 120 };
              },
            })
          : null;
      controls = [...(patternPad ? [patternPad] : []), cellPad, spotBtn, emptyBtn, ...cases];
    };

    const sync = () => {
      cases.forEach((b, i) => {
        b.on = CASES[i] === s.kase;
      });
    };

    const drawFigure = (g: CanvasRenderingContext2D, l: CardLayout, now: number) => {
      if (!fig) return;
      const f = l.figure;
      well(g, f, { fill: withAlpha(COLOR.well, 0.6) });
      clipTo(g, f, 28);
      beam(g, f.x, l.beamY, f.x + f.width, l.beamY, { alpha: 0.4 });
      g.restore();
      const c = fig.cell;
      const link = env.link;
      if (s.kase !== "aluminium") {
        g.save();
        g.fillStyle = withAlpha(COLOR.background, 0.7);
        g.strokeStyle = withAlpha(COLOR.real, 0.7);
        g.lineWidth = 4;
        g.beginPath();
        g.rect(c.x, c.y, c.width, c.height);
        g.fill();
        g.stroke();
        g.restore();
      }
      const posA = presence(link, "pos", now);
      if (s.kase === "aluminium") {
        drawFcc(g, c, now);
      } else {
        // The snapping grid.
        if (s.kase === "mine")
          for (let i = 0; i <= GRID; i++)
            for (let j = 0; j <= GRID; j++) {
              const p = inCell(c, i / GRID, j / GRID);
              disc(g, p.x, p.y, 4, withAlpha(COLOR.ink, 0.3));
            }
        const cell = flatCell(s)!;
        const placedIdx: (0 | 1 | null)[] = [null];
        if (s.kase === "mine")
          for (const i of [0, 1] as const) if (s.atoms[i].site) placedIdx.push(i);
        cell.atoms.forEach((at: FlatAtom, k) => {
          const mine = s.kase === "mine" ? placedIdx[k] : null;
          if (mine !== null && mine !== undefined && drag?.i === mine && drag.moved) return;
          for (const [u, v] of images(at.u, at.v)) {
            const p = inCell(c, u, v);
            drawAtom(g, p.x, p.y, atomRadius(c, at.kind), at.kind, 1, false);
            if (at.kind === "K" || at.kind === "Cl")
              label(g, at.kind === "K" ? L.potassium! : L.chlorine!, p.x, p.y + 1, {
                size: Math.max(20, atomRadius(c, at.kind) * 0.9),
                color: COLOR.background,
                weight: 800,
              });
          }
          // Each placed atom's place in the cell, as fractions x and y.
          if (k > 0 && s.kase === "mine") {
            const p = inCell(c, at.u, at.v);
            g.save();
            g.globalAlpha = 0.7 * posA;
            g.strokeStyle = COLOR.angle;
            g.lineWidth = 3 * emphasis(link, "pos", now);
            g.setLineDash([6, 7]);
            g.beginPath();
            g.moveTo(c.x, p.y);
            g.lineTo(p.x, p.y);
            g.lineTo(p.x, c.y + c.height);
            g.stroke();
            g.restore();
            parts.push({ part: "pos", x: p.x, y: p.y });
          }
        });
      }
      // The tray, with the atoms that aren't in the cell.
      if (s.kase === "mine") {
        for (const i of [0, 1] as const) {
          const t = fig.tray[i];
          g.save();
          g.setLineDash([10, 9]);
          g.strokeStyle = withAlpha(COLOR.real, 0.5);
          g.lineWidth = 3;
          g.beginPath();
          g.roundRect(t.x, t.y, t.width, t.height, 22);
          g.stroke();
          g.restore();
          const p = s.atoms[i];
          if (p.site === 0 && !(drag?.i === i && drag.moved)) {
            const cc = centre(t);
            drawAtom(
              g,
              cc.x,
              cc.y,
              atomRadius(c, p.heavy ? "heavy" : "light"),
              p.heavy ? "heavy" : "light",
            );
          }
          if (p.site === 0)
            label(
              g,
              p.heavy ? L.heavy! : L.light!,
              t.x + t.width / 2,
              t.y + t.height - l.type.small * 0.7,
              {
                size: l.type.small * 0.85,
                color: COLOR.muted,
              },
            );
        }
        if (drag?.moved) {
          const p = s.atoms[drag.i];
          const kind = p.heavy ? "heavy" : "light";
          const u = (drag.x - c.x) / c.width;
          const v = (c.y + c.height - drag.y) / c.height;
          const m = 0.16;
          if (u >= -m && u <= 1 + m && v >= -m && v <= 1 + m) {
            const other = s.atoms[drag.i === 0 ? 1 : 0].site;
            const site = snap(u, v, other ? [other] : []);
            if (site > 0) {
              const [su, sv] = siteUV(site);
              const q = inCell(c, su, sv);
              g.save();
              g.strokeStyle = COLOR.accent;
              g.lineWidth = 4;
              g.setLineDash([6, 6]);
              g.beginPath();
              g.arc(q.x, q.y, atomRadius(c, kind) + 10, 0, Math.PI * 2);
              g.stroke();
              g.restore();
            }
          }
          g.save();
          g.shadowColor = withAlpha(COLOR.real, 0.7);
          g.shadowBlur = 24;
          drawAtom(g, drag.x, drag.y, atomRadius(c, kind) * 1.12, kind);
          g.restore();
        }
      }
      parts.push(
        ...drawSum(g, fig.arrows, chosenSum(s), spotName(s), {
          size: l.type.label,
          link,
          now,
        }),
      );
    };

    const drawFcc = (g: CanvasRenderingContext2D, c: Rect, now: number) => {
      // Aluminium's cell drawn in perspective: corners, and an atom in the middle of each face.
      const t = now / 1000;
      // Seen a little from above and to one side, so no atom hides behind another.
      const yaw = 0.42 + 0.18 * Math.sin(t * 0.4);
      const pitch = 0.3;
      const k = c.width * 0.36;
      const cx = c.x + c.width / 2;
      const cy = c.y + c.height / 2;
      const P = (x: number, y: number, z: number) => {
        const X = x - 0.5;
        const Y = y - 0.5;
        const Z = z - 0.5;
        const x1 = X * Math.cos(yaw) - Z * Math.sin(yaw);
        const z1 = X * Math.sin(yaw) + Z * Math.cos(yaw);
        const y1 = Y * Math.cos(pitch) - z1 * Math.sin(pitch);
        const z2 = Y * Math.sin(pitch) + z1 * Math.cos(pitch);
        return { x: cx + x1 * k * 1.25, y: cy - y1 * k * 1.25, z: z2 };
      };
      g.save();
      g.strokeStyle = withAlpha(COLOR.real, 0.55);
      g.lineWidth = 3;
      for (const [a, b] of [
        [0, 1],
        [1, 3],
        [3, 2],
        [2, 0],
        [4, 5],
        [5, 7],
        [7, 6],
        [6, 4],
        [0, 4],
        [1, 5],
        [2, 6],
        [3, 7],
      ] as const) {
        const ca = [a & 1, (a >> 1) & 1, (a >> 2) & 1] as const;
        const cb = [b & 1, (b >> 1) & 1, (b >> 2) & 1] as const;
        const p = P(ca[0], ca[1], ca[2]);
        const q = P(cb[0], cb[1], cb[2]);
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(q.x, q.y);
        g.stroke();
      }
      g.restore();
      const atoms: { x: number; y: number; z: number; face: boolean }[] = [];
      for (let i = 0; i < 8; i++)
        atoms.push({ ...P(i & 1, (i >> 1) & 1, (i >> 2) & 1), face: false });
      for (const [x, y, z] of [
        [0.5, 0.5, 0],
        [0.5, 0.5, 1],
        [0.5, 0, 0.5],
        [0.5, 1, 0.5],
        [0, 0.5, 0.5],
        [1, 0.5, 0.5],
      ] as const)
        atoms.push({ ...P(x, y, z), face: true });
      atoms.sort((p, q) => p.z - q.z);
      for (const a of atoms)
        drawAtom(
          g,
          a.x,
          a.y,
          c.width * 0.06 * (1 + 0.15 * a.z),
          "heavy",
          0.75 + 0.25 * (a.z + 0.5),
          a.face,
        );
    };

    return {
      layout(l) {
        card = l;
        make(l);
      },
      get controls() {
        return controls;
      },
      update() {
        // The key move: a heavy atom lands in the middle. Show a spot it just made vanish, so the
        // arrows point opposite ways and the bar empties.
        const isCentred = centred(s);
        if (isCentred && !wasCentred) {
          const cs = chosenSum(s);
          if (Math.sqrt(cs.F2) >= GONE * cs.inStep) {
            const v = vanishedSpot(s);
            if (v >= 0) s = { ...s, spot: v };
          }
        }
        wasCentred = isCentred;
        if (s.kase !== said) {
          said = s.kase;
          const more = T.more!;
          env.say?.({
            caption: s.kase === "kcl" ? more.kcl! : s.kase === "aluminium" ? more.aluminium! : null,
          });
        }
        // The "So" line speaks of your cell: dim it while your cell no longer shows it.
        const off = s.kase === "mine" && !checkered(s);
        if (off !== away) {
          away = off;
          env.away?.(off);
        }
        if (spotBtn) spotBtn.label = `${L.spot} ${spotName(s)}`;
        if (emptyBtn) {
          emptyBtn.visible = s.kase === "mine";
          emptyBtn.enabled = s.atoms.some((p) => p.site !== 0);
        }
        sync();
        if (centred(s)) env.earn();
      },
      draw(g, now) {
        if (!card) return;
        view ??= env.engine().view({ tint: "recip" });
        parts = [];
        drawWatch(g, card.watch, s, view, 256, {
          size: card.type.label,
          FLevel: env.link.level("F", now),
        });
        drawFigure(g, card, now);
      },
      partAt(x, y) {
        let best: string | null = null;
        let bestD = 70;
        for (const p of parts) {
          const d = Math.hypot(x - p.x, y - p.y);
          if (d < bestD) {
            bestD = d;
            best = p.part;
          }
        }
        return best;
      },
      numbers() {
        const sum = chosenSum(s);
        const num = (v: number) => (Math.abs(v) < 0.05 ? "0.0" : v.toFixed(1).replace("-", "−"));
        const sign = sum.im < -0.05 ? "−" : "+";
        const share = 100 * (sum.F2 / Math.max(1e-9, sum.inStep ** 2));
        return [
          `${spotName(s)}   |S| = ${sum.S.toFixed(3)} Å⁻¹`,
          `F = ${num(sum.re)} ${sign} ${num(Math.abs(sum.im))}i`,
          `|F|² = ${sum.F2.toFixed(0)}  (${share.toFixed(0)} %)`,
        ];
      },
      state: () => encode(s),
      demo(): DemoStep[] {
        // The heavy atom to the middle lands on a spot that vanished, (1 0); then (1 1), which
        // stays bright; then the atom made light, and potassium chloride on its own (1 1).
        return [
          { control: "cell", to: 0 },
          { wait: 4200 },
          { control: "spot" },
          { wait: 2000 },
          { control: "cell", to: 1 },
          { wait: 1800 },
          { control: "case2" },
          { wait: 2600 },
        ];
      },
      botMove(rand) {
        // Now and then leave it to the shell, which also tries the tabs and the Maths.
        if (rand() < 0.2) return null;
        const r = rand();
        if (s.kase !== "mine" && r < 0.5) return { control: "case0" };
        if (r < 0.45) {
          const gst = cellGesture(rand);
          return gst ? { gesture: gst } : null;
        }
        if (r < 0.65) return { control: "spot" };
        if (r < 0.8) return { control: `case${Math.floor(rand() * 3)}` };
        if (r < 0.9) return { control: "empty" };
        return patternPad ? { control: "pattern" } : { control: "spot" };
      },
      hint() {
        if (!fig) return null;
        const p = s.atoms[0].site === 0 ? centre(fig.tray[0]) : centre(fig.cell);
        return p;
      },
      status() {
        return {
          case: s.kase,
          atoms: s.atoms.filter((p) => p.site !== 0).length,
          centred: centred(s),
          spot: spotName(s),
        };
      },
      reset() {
        s = { ...START, atoms: [{ ...START.atoms[0] }, { ...START.atoms[1] }] };
        // A demo resets the chapter alone, so put the usual caption back here too.
        said = "mine";
        env.say?.({ caption: null });
        away = null;
        wasCentred = false;
        drag = null;
        cellPad?.release();
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
