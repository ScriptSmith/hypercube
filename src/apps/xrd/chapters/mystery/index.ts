/**
 * Chapter 11, which crystal is it. A mystery sample's pattern appears; its curve sits above three
 * fingerprint cards on one |S| ruler, and the visitor taps the sample that made it. A right pick
 * brings up the crystal; a wrong one lines the mystery's strongest rings up against the card, so
 * the difference shows. Tiles say what diffraction is used for.
 *
 * - Watch view: the mystery's map, simulated where there is one, else drawn from its crystal,
 *   with an |S| ruler running up from the beam's centre like the chart's, so the curve's peaks
 *   can be matched to the rings; when solved, the card's rings lit on the map and the crystal
 *   turning; a use tile's sentence over its foot.
 * - Figure: the mystery's curve and the three cards' rings, one ruler.
 * - Children: the three picks. Adults: the use tiles.
 * - Linked formula |S|² ∝ h² + k² + l²: the ruler in |S|, the families' names on the cubic cards.
 */
import { withAlpha } from "../../../../core/ui/palette";
import { COMMON, TEXT } from "../../captions";
import type { Chapter, ChapterDef, ChapterEnv, DemoStep, MachineDrive } from "../../chapter";
import { COLOR } from "../../config";
import { button, type Button, type Control, fitText, font } from "../../controls";
import { clipTo, cornerTag, disc, drawWrapped, label, line, well } from "../../draw";
import { emphasis, presence } from "../../formula";
import { type CardLayout, centre, inset, type Rect, splitRow } from "../../layout";
import type { MapStore } from "../../maps";
import { drawCrystal } from "./crystal";
import {
  alIndexing,
  BINS,
  binS,
  curve,
  decode,
  encode,
  fingerprint,
  mapRings,
  type MysteryState,
  nextRound,
  peaks,
  pick,
  playAt,
  roundOf,
  S0,
  S1,
  SAMPLE,
  type SampleId,
  START,
  STATE_RANGES,
  USE_COUNT,
} from "./model";

const T = TEXT.mystery;
const L = T.labels;
const USES = T.uses ?? [];

export const PARTS = { S: COLOR.recip, hkl: COLOR.accent } as const;

/** A solved round stays this long before the next mystery, ms. */
const SOLVED_MS = 9000;
/** A use tile's sentence stays this long, ms. */
const USE_MS = 11_000;
const SPARKS = 48;

const nameOf = (id: SampleId, short = false): string =>
  (short ? L[`${id}Short`] : undefined) ?? L[id] ?? id;

const cubic = (id: SampleId) => {
  const c = SAMPLE[id].crystal;
  return c === "aluminium" || c === "salt" || c === "silicon" || c === "diamond";
};

/** The map box for worked-out rings: the simulated maps' shape, Sx ±1.22, Sz 0 to 1.22 Å⁻¹. */
const MAP_W = 2.44;
const MAP_H = 1.22;

/** Where a map's beam centre (S = 0) lands and how many px one Å⁻¹ spans. */
interface Origin {
  x: number;
  y: number;
  k: number;
  /** The map's own rect, for clipping. */
  rect: Rect;
}

const drawComputed = (g: CanvasRenderingContext2D, box: Rect, id: SampleId): Origin => {
  const k = Math.min(box.width / MAP_W, box.height / MAP_H);
  const w = MAP_W * k;
  const h = MAP_H * k;
  const x0 = box.x + (box.width - w) / 2;
  const y0 = box.y + (box.height - h) / 2;
  const ox = x0 + w / 2;
  const oy = y0 + h;
  g.save();
  g.beginPath();
  g.rect(x0, y0, w, h);
  g.clip();
  g.fillStyle = "#070a12";
  g.fillRect(x0, y0, w, h);
  for (const r of mapRings(id)) {
    const a = Math.sqrt(r.height / 100);
    g.strokeStyle = withAlpha(COLOR.recip, 0.25 + 0.75 * a);
    g.lineWidth = Math.max(2, 0.007 * k) * (0.8 + a);
    g.shadowColor = withAlpha(COLOR.recip, 0.5);
    g.shadowBlur = 8;
    g.beginPath();
    g.arc(ox, oy, r.S * k, Math.PI, 2 * Math.PI);
    g.stroke();
  }
  g.restore();
  disc(g, ox, oy, 0.05 * k, "#141a28");
  return { x: ox, y: oy, k, rect: { x: x0, y: y0, width: w, height: h } };
};

/** The ruler's ticks, Å⁻¹, as on the chart. */
const TICKS = [0.2, 0.4, 0.6, 0.8, 1.0];

/**
 * An |S| ruler up the map from the beam's centre, ticked as the chart's ruler is, so a peak on
 * the curve can be found on the map at the same |S|; and the rings the chart's guides mark,
 * faint once a card has been tried and lit once solved.
 */
const drawRuler = (
  g: CanvasRenderingContext2D,
  o: Origin,
  s: MysteryState,
  size: number,
  lit: number,
  ceiling: number,
) => {
  const u = Math.max(1, size / 38);
  const top = Math.min(S1, (o.y - Math.max(o.rect.y, ceiling)) / o.k - 0.02);
  g.save();
  g.beginPath();
  g.rect(o.rect.x, o.rect.y, o.rect.width, o.rect.height);
  g.clip();
  // The rings the chart's guides mark: faint once a card is tried, lit when solved.
  const tried = s.solved || s.wrong !== 0;
  if (tried) {
    const strength = s.solved ? 0.35 + 0.6 * lit : 0.35;
    g.strokeStyle = withAlpha(s.solved ? COLOR.accent : COLOR.angle, strength);
    g.lineWidth = (s.solved ? 4 : 3) * u;
    g.setLineDash([12 * u, 8 * u]);
    for (const S of peaks(roundOf(s.round).mystery)) {
      g.beginPath();
      g.arc(o.x, o.y, S * o.k, Math.PI, 2 * Math.PI);
      g.stroke();
    }
    g.setLineDash([]);
  }
  line(g, o.x, o.y, o.x, o.y - top * o.k, withAlpha(COLOR.ink, 0.7), 2.5 * u);
  for (const S of TICKS) {
    if (S > top) break;
    const y = o.y - S * o.k;
    line(g, o.x - 12 * u, y, o.x + 12 * u, y, withAlpha(COLOR.ink, 0.85), 2.5 * u);
    g.save();
    g.font = font(700, size * 0.62);
    g.textAlign = "right";
    g.textBaseline = "middle";
    g.lineWidth = 6 * u;
    g.strokeStyle = withAlpha(COLOR.background, 0.85);
    g.strokeText(S.toFixed(1), o.x - 18 * u, y);
    g.fillStyle = COLOR.recip;
    g.fillText(S.toFixed(1), o.x - 18 * u, y);
    g.restore();
  }
  g.restore();
};

/** The mystery's picture into `r`; returns the rect it filled. */
const drawMystery = (
  g: CanvasRenderingContext2D,
  r: Rect,
  s: MysteryState,
  maps: MapStore,
  showMaps: boolean,
  o: { size: number; t: number; lit: number },
) => {
  well(g, r);
  const round = roundOf(s.round);
  const sample = SAMPLE[round.mystery];
  const box = inset(r, 16);
  // The tag goes top left, since the ruler starts at the bottom middle; the ruler stops below the
  // tag where the tag reaches the middle.
  const isMap = !!sample.map && showMaps;
  const tagSize = o.size * 0.8;
  g.save();
  g.font = font(700, tagSize);
  const tagRight =
    r.x + 16 + g.measureText(isMap ? COMMON.simulated : L.computed!).width + tagSize * 1.2;
  g.restore();
  const tagBottom = r.y + 16 + tagSize * 1.6;
  const ceiling = (x: number) => (tagRight > x - 70 * (o.size / 38) ? tagBottom + 8 : r.y);
  if (sample.map && showMaps) {
    const p = maps.draw(g, sample.map, box);
    if (!p)
      label(g, "…", box.x + box.width / 2, box.y + box.height / 2, {
        size: o.size * 2,
        color: COLOR.muted,
      });
    else
      drawRuler(
        g,
        { x: p.originX, y: p.originY, k: p.pxPerS, rect: p.rect },
        s,
        o.size,
        o.lit,
        ceiling(p.originX),
      );
    cornerTag(g, r, COMMON.simulated, { size: o.size * 0.8, corner: "tl" });
  } else {
    const origin = drawComputed(g, box, round.mystery);
    drawRuler(g, origin, s, o.size, o.lit, ceiling(origin.x));
    cornerTag(g, r, L.computed!, { size: o.size * 0.8, corner: "tl" });
  }
  if (s.solved) {
    // Top right, dropped below the corner tag when the two would meet.
    let side = Math.min(r.height * 0.78, r.width * 0.42);
    let top = r.y + 18;
    if (r.x + r.width - side - 18 < tagRight + 12) {
      top += tagSize * 1.6 + 16;
      side = Math.min(side, r.y + r.height - 18 - top);
    }
    const cb: Rect = { x: r.x + r.width - side - 18, y: top, width: side, height: side };
    g.save();
    g.fillStyle = withAlpha(COLOR.background, 0.86);
    g.strokeStyle = withAlpha(COLOR.accent, 0.8);
    g.lineWidth = 4 * (o.size / 38);
    g.beginPath();
    g.roundRect(cb.x, cb.y, cb.width, cb.height, 24);
    g.fill();
    g.stroke();
    g.restore();
    drawCrystal(g, inset(cb, 16, 16 + o.size * 0.6), sample.crystal, o.t);
    // The reveal names the sample as it was shown: the foil's grains make arcs.
    g.save();
    g.fillStyle = COLOR.accent;
    g.textAlign = "center";
    g.textBaseline = "middle";
    fitText(
      g,
      L[`${round.mystery}Reveal`] ?? nameOf(round.mystery),
      cb.x + cb.width / 2,
      cb.y + cb.height - o.size * 0.75,
      cb.width - 28,
      o.size,
      800,
      0.5,
    );
    g.restore();
  }
  if (s.use >= 0) {
    const u = USES[s.use];
    if (u) {
      const h = Math.min(r.height * 0.42, o.size * 4.4);
      // Above the corner tag, which says how the map was made.
      const y = Math.max(r.y + 10, r.y + r.height - h - o.size * 1.9);
      g.save();
      g.fillStyle = withAlpha(COLOR.background, 0.9);
      g.strokeStyle = withAlpha(COLOR.ink, 0.25);
      g.lineWidth = 3 * (o.size / 38);
      g.beginPath();
      g.roundRect(r.x + 10, y, r.width - 20, h, 22);
      g.fill();
      g.stroke();
      g.restore();
      label(g, u.title, r.x + 34, y + o.size * 0.75, {
        size: o.size * 0.9,
        color: COLOR.accent,
        align: "left",
        weight: 800,
      });
      drawWrapped(g, u.line.text, r.x + 34, y + o.size * 1.45, r.width - 68, {
        size: o.size * 0.85,
        color: COLOR.ink,
        weight: 600,
        maxHeight: h - o.size * 1.6,
      });
    }
  }
};

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  color: string;
}

const def: ChapterDef = {
  id: "mystery",
  state: STATE_RANGES,
  start: encode(START),
  play: (t) => encode(playAt(t)),
  parts: PARTS,
  split: 0.5,
  // The map is wide and short; on the kiosk the fingerprint chart, where the reasoning happens,
  // gets the room.
  kioskWatch: 0.4,
  watch(g, rect, state, look) {
    const s = decode(state);
    drawMystery(g, rect, s, look.maps, look.config.maps, {
      size: Math.max(24, Math.min(rect.height * 0.045, rect.width * 0.03, 90)),
      t: look.now / 1000,
      lit: s.solved ? 1 : 0,
    });
  },
  drive(state): MachineDrive {
    const s = decode(state);
    const sample = SAMPLE[roundOf(s.round).mystery];
    return { sample: { crystal: sample.crystal, form: sample.form } };
  },
  create(env: ChapterEnv): Chapter {
    let s: MysteryState = { ...START };
    let card: CardLayout | null = null;
    let controls: Control[] = [];
    let picks: Button[] = [];
    let uses: Button[] = [];
    let solvedAt = Number.NEGATIVE_INFINITY;
    let useAt = Number.NEGATIVE_INFINITY;
    let lastPick = -1;
    let sparks: Spark[] = [];
    let rulerSpot: { x: number; y: number } | null = null;
    let hklSpots: { x: number; y: number }[] = [];

    /** The tiles show uses in turn, a new set each round. */
    const useFor = (j: number) => (j + s.round * Math.max(1, uses.length)) % USE_COUNT;

    const burst = (at: { x: number; y: number }, now: number) => {
      const colours = [COLOR.accent, COLOR.recip, COLOR.real, COLOR.ink];
      sparks = [];
      for (let i = 0; i < SPARKS; i++) {
        const a = env.rng.next() * Math.PI * 2;
        const v = 260 + env.rng.next() * 520;
        sparks.push({
          x: at.x,
          y: at.y,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v - 200,
          born: now,
          color: colours[i % colours.length]!,
        });
      }
    };

    const labelPicks = () => {
      const r = roundOf(s.round);
      picks.forEach((b, i) => {
        const id = r.choices[i]!;
        b.label = nameOf(id, b.rect.width < 260);
        b.enabled = s.solved ? i === r.answer : !(s.wrong & (1 << i));
        b.on = s.solved && i === r.answer;
      });
      uses.forEach((b, j) => {
        b.label = USES[useFor(j)]?.title ?? "";
      });
    };

    const make = (l: CardLayout) => {
      const c = l.child;
      const h = Math.min(c.height, l.target * 1.35);
      const cells = splitRow(
        { x: c.x, y: c.y + (c.height - h) / 2, width: c.width, height: h },
        [1, 1, 1],
        18,
      );
      picks = cells.map((rect, i) =>
        button({
          id: `pick${i}`,
          rect,
          band: "child",
          label: "",
          color: COLOR.real,
          size: l.type.label,
          onPress: () => {
            const before = s;
            s = pick(s, i);
            lastPick = i;
            if (s.solved && !before.solved) {
              solvedAt = performance.now();
              env.earn();
              burst(centre(card?.watch ?? rect), solvedAt);
            }
            labelPicks();
          },
        }),
      );
      const a = l.adult;
      const minW = Math.max(l.target * 1.25, 215);
      const n = Math.max(1, Math.min(4, Math.floor((a.width + 16) / (minW + 16))));
      const bh = Math.min(a.height, l.target * 1.1);
      uses = splitRow({ ...a, y: a.y + a.height - bh, height: bh }, Array(n).fill(1), 16).map(
        (rect, j) =>
          button({
            id: `use${j}`,
            rect,
            band: "adult",
            label: "",
            color: COLOR.accent,
            size: l.type.label * 0.85,
            onPress: () => {
              const u = useFor(j);
              s = { ...s, use: s.use === u ? -1 : u };
              useAt = performance.now();
            },
          }),
      );
      controls = [...uses, ...picks];
      labelPicks();
    };

    const drawChart = (g: CanvasRenderingContext2D, l: CardLayout, now: number) => {
      const f = l.figure;
      well(g, f, { fill: withAlpha(COLOR.well, 0.6) });
      const link = env.link;
      const round = roundOf(s.round);
      const inner = inset(f, 22, 14);
      const nameW = Math.max(150, Math.min(260, inner.width * 0.23));
      const rulerH = l.type.small * 1.7;
      const px0 = inner.x + nameW;
      const pw = inner.width - nameW - 12;
      const X = (S: number) => px0 + ((S - S0) / (S1 - S0)) * pw;
      const mysteryH = (inner.height - rulerH) * 0.31;
      const rowH = (inner.height - rulerH - mysteryH) / 3;
      const solved = s.solved;
      // The mystery's curve.
      const c = curve(round.mystery);
      const top = inner.y + 4;
      const base = inner.y + mysteryH - 6;
      label(g, "?", inner.x + nameW * 0.45, (top + base) / 2, {
        size: Math.min(mysteryH * 0.8, l.type.headline),
        color: COLOR.accent,
        weight: 900,
      });
      g.save();
      g.beginPath();
      let open = false;
      for (let i = 0; i < BINS; i++) {
        const v = c[i]!;
        const x = X(binS(i));
        if (!Number.isFinite(v)) {
          open = false;
          continue;
        }
        const y = base - Math.sqrt(Math.max(0, v)) * (base - top);
        if (!open) {
          g.moveTo(x, y);
          open = true;
        } else g.lineTo(x, y);
      }
      g.strokeStyle = COLOR.recip;
      g.lineWidth = 3.5;
      g.shadowColor = withAlpha(COLOR.recip, 0.6);
      g.shadowBlur = 10;
      g.stroke();
      g.restore();
      line(g, px0, base, px0 + pw, base, withAlpha(COLOR.ink, 0.25), 2);
      // Guides at the mystery's strongest rings, once a card has been tried.
      const tried = solved || s.wrong !== 0;
      const guides = tried ? peaks(round.mystery) : [];
      const gy0 = top;
      const gy1 = inner.y + inner.height - rulerH;
      for (const S of guides)
        line(
          g,
          X(S),
          gy0,
          X(S),
          gy1,
          withAlpha(solved ? COLOR.accent : COLOR.angle, 0.55),
          2.5,
          [8, 8],
        );
      // The cards.
      hklSpots = [];
      const hklLevel = link.level("hkl", now);
      round.choices.forEach((id, i) => {
        const y0 = inner.y + mysteryH + i * rowH;
        const yb = y0 + rowH - 6;
        const isAnswer = i === round.answer;
        const wrong = (s.wrong & (1 << i)) !== 0;
        const lit = solved && isAnswer;
        g.save();
        g.fillStyle = lit
          ? withAlpha(COLOR.accent, 0.12)
          : withAlpha(COLOR.ink, i % 2 === 0 ? 0.04 : 0.02);
        g.fillRect(inner.x, y0 + 3, inner.width, rowH - 6);
        if (lit) {
          g.strokeStyle = withAlpha(COLOR.accent, 0.8);
          g.lineWidth = 3;
          g.strokeRect(inner.x, y0 + 3, inner.width, rowH - 6);
        }
        g.restore();
        const fade = wrong ? 0.45 : solved && !isAnswer ? 0.4 : 1;
        // Names at the card's label size where the row allows, on one line.
        g.save();
        g.globalAlpha = fade;
        g.fillStyle = lit ? COLOR.accent : COLOR.ink;
        g.textAlign = "left";
        g.textBaseline = "middle";
        fitText(
          g,
          nameOf(id),
          inner.x + 10,
          y0 + rowH / 2,
          nameW - 20,
          Math.min(l.type.label, rowH * 0.6),
          700,
          0.55,
        );
        g.restore();
        line(g, px0, yb, px0 + pw, yb, withAlpha(COLOR.ink, 0.2 * fade), 2);
        const rings = fingerprint(id);
        const strongest = [...rings].sort((a, b) => b.height - a.height).slice(0, 4);
        for (const r of rings) {
          const x = X(r.S);
          const hh = Math.sqrt(r.height / 100) * (rowH - 16);
          // After a wrong pick, rings that miss the mystery's strong ones show it.
          const off =
            wrong && strongest.includes(r) && !guides.some((S) => Math.abs(S - r.S) < 0.008);
          g.save();
          g.globalAlpha = fade;
          g.strokeStyle = off ? COLOR.angle : COLOR.recip;
          g.lineWidth = off ? 6 : 4;
          g.lineCap = "round";
          g.beginPath();
          g.moveTo(x, yb);
          g.lineTo(x, yb - hh);
          g.stroke();
          g.restore();
        }
        // The families' names, for the cubic cards, when the Maths asks.
        if (cubic(id)) {
          const show = hklLevel > 0 || mathsOpen();
          for (const r of strongest.slice(0, 3)) {
            const x = X(r.S);
            const hh = Math.sqrt(r.height / 100) * (rowH - 16);
            const name = [...r.hkl]
              .map(Math.abs)
              .sort((p, q) => q - p)
              .join("");
            hklSpots.push({ x, y: yb - hh - 14 });
            if (show)
              label(g, name, x, Math.max(y0 + 14, yb - hh - l.type.small * 0.5), {
                size: l.type.small * 0.75 * (1 + 0.3 * hklLevel),
                color: COLOR.accent,
                alpha: presence(link, "hkl", now) * fade,
              });
          }
        }
      });
      if (s.wrong !== 0 && !solved)
        label(g, L.hint!, px0 + pw, inner.y + l.type.small * 0.5, {
          size: l.type.small * 0.85,
          color: COLOR.angle,
          align: "right",
        });
      // The ruler, in |S|.
      const ry = inner.y + inner.height - rulerH;
      const sw = 3 * emphasis(link, "S", now);
      g.save();
      g.globalAlpha = presence(link, "S", now);
      line(g, px0, ry + 4, px0 + pw, ry + 4, COLOR.recip, sw);
      for (let S = 0.2; S <= S1 + 1e-9; S += 0.2) {
        const x = X(S);
        line(g, x, ry + 4, x, ry + 16, COLOR.recip, sw);
        label(g, S.toFixed(1), x, ry + 16 + l.type.small * 0.5, {
          size: l.type.small * 0.8,
          color: COLOR.recip,
        });
      }
      label(g, "|S|  Å⁻¹", inner.x + nameW * 0.5, ry + 16 + l.type.small * 0.4, {
        size: l.type.small * 0.8,
        color: COLOR.recip,
        italic: true,
      });
      g.restore();
      rulerSpot = { x: px0 + pw / 2, y: ry + 12 };
    };

    const mathsOpen = () => env.mathsOpen?.() ?? false;

    const drawSparks = (g: CanvasRenderingContext2D, now: number) => {
      for (const p of sparks) {
        const t = (now - p.born) / 1000;
        if (t > 1.6) continue;
        const x = p.x + p.vx * t;
        const y = p.y + p.vy * t + 520 * t * t;
        disc(g, x, y, 9 * (1 - t / 1.6) + 2, p.color, 1 - t / 1.6);
      }
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
        if (s.solved && now - solvedAt > SOLVED_MS) {
          s = nextRound(s);
          lastPick = -1;
          labelPicks();
        }
        if (s.use >= 0 && now - useAt > USE_MS) s = { ...s, use: -1 };
        if (sparks.length > 0 && now - sparks[0]!.born > 1700) sparks = [];
        labelPicks();
      },
      draw(g, now) {
        if (!card) return;
        drawMystery(g, card.watch, s, env.maps, env.config.maps, {
          size: card.type.label,
          t: now / 1000,
          lit: s.solved ? Math.min(1, (now - solvedAt) / 600) : 0,
        });
        clipTo(g, card.figure, 28);
        drawChart(g, card, now);
        g.restore();
        drawSparks(g, now);
      },
      partAt(x, y) {
        if (rulerSpot && Math.abs(y - rulerSpot.y) < 60 && card) {
          const f = card.figure;
          if (x > f.x + f.width * 0.2 && x < f.x + f.width) return "S";
        }
        for (const p of hklSpots) if (Math.hypot(x - p.x, y - p.y) < 60) return "hkl";
        return null;
      },
      numbers() {
        const ix = alIndexing();
        return [
          `${nameOf("foil")}: |S|² = ${ix.rings.map((r) => r.S2.toFixed(3)).join(", ")} Å⁻²`,
          `÷ ${ix.unit.toFixed(4)} = ${ix.rings.map((r) => Math.round(r.ratio)).join(" : ")}`,
          ix.rings.map((r) => `(${r.hkl.join(" ")})`).join(" "),
          `a = √3 ÷ ${ix.rings[0]!.S.toFixed(3)} Å⁻¹ = ${ix.a.toFixed(2)} Å`,
        ];
      },
      state: () => encode(s),
      demo(): DemoStep[] {
        const r = roundOf(s.round);
        const wrong = (r.answer + 1) % 3;
        return [
          { wait: 1400 },
          { control: `pick${wrong}` },
          { wait: 2600 },
          { control: `pick${r.answer}` },
          { wait: 2600 },
          { control: "use0" },
          { wait: 3200 },
        ];
      },
      botMove(rand) {
        // Now and then leave it to the shell, which also tries the tabs and the Maths.
        if (rand() < 0.2) return null;
        if (rand() < 0.65) {
          const open = picks.filter((b) => b.enabled);
          const b = open[Math.floor(rand() * open.length)];
          if (b) return { control: b.id };
        }
        const u = uses[Math.floor(rand() * uses.length)];
        return u ? { control: u.id } : null;
      },
      hint() {
        const b = picks[1] ?? picks[0];
        return b ? centre(b.rect) : null;
      },
      status() {
        const r = roundOf(s.round);
        return {
          round: s.round,
          mystery: r.mystery,
          choices: r.choices.join(","),
          solved: s.solved,
          tried: lastPick,
        };
      },
      reset() {
        s = { ...START };
        solvedAt = Number.NEGATIVE_INFINITY;
        useAt = Number.NEGATIVE_INFINITY;
        lastPick = -1;
        sparks = [];
        labelPicks();
      },
      show() {},
      dispose() {
        sparks = [];
        controls = [];
      },
    };
  },
};

export default def;
