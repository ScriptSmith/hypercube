/**
 * Chapter 10, what makes an X. The pattern is computed, never the photograph.
 *
 * - Watch view: the helix's fibre pattern from the diffraction engine (a flat model), centred,
 *   an X of spots on rows 1/P apart with the rows marked at the side and the X drawn faintly
 *   along its bright inner spots; with two strands offset as in DNA the fourth row is gone, and
 *   the caption says so.
 * - Figure: the helix side on, turning slowly in the beam, with its pitch P, its radius r and the
 *   steepness α marked on the strand where it crosses the helix's middle in front, near the beam;
 *   two strands are joined by rungs, like DNA's base pairs.
 *
 * The X is drawn where it shows, not at α: the inner spots sit 5 to 9° wider than α, so lines at
 * α would miss every row in view. Both open and close together as the helix is twisted, which is
 * the chapter's point; α's own lines show while α is touched.
 * - Children: the twist wheel (pitch) and one or two strands. Adults: the widen slider (radius).
 * - Linked formula: P on the helix's turn and the rows' spacing, α on the strand and the X's
 *   arms, r across the helix.
 * - Key move: making the X change angle, or switching to two strands.
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
  choice,
  type Choice,
  type Control,
  font,
  rotary,
  type Rotary,
  slider,
  type Slider,
} from "../../controls";
import { beam, bracket, clipTo, cornerTag, disc, label, line, TAU, well } from "../../draw";
import type { PatternView } from "../../engine/client";
import { presence } from "../../formula";
import { type CardLayout, centre, type Rect } from "../../layout";
import {
  A_PER_PX,
  armAngle,
  decode,
  DNA,
  encode,
  type HelixState,
  keyMove,
  keyOf,
  layerLine,
  patternJob,
  RANGE,
  S_VIEW,
  START,
  STATE_RANGES,
  visibleArm,
} from "./physics";

const T = TEXT.helix;
const L = T.labels;
const DEG = Math.PI / 180;

export const PARTS = { P: COLOR.real, alpha: COLOR.angle, r: COLOR.accent } as const;

type Spot = { part: string; x: number; y: number };

/** Wrap a sentence into lines no wider than `width` at the current font. */
const wrap = (g: CanvasRenderingContext2D, text: string, width: number): string[] => {
  const out: string[] = [];
  let line0 = "";
  for (const w of text.split(" ")) {
    const next = line0 ? `${line0} ${w}` : w;
    if (g.measureText(next).width > width && line0) {
      out.push(line0);
      line0 = w;
    } else line0 = next;
  }
  if (line0) out.push(line0);
  return out;
};

/**
 * The watch view: the pattern, centred and as tall as the view, with its rows marked and the X it
 * makes drawn faintly over it. `notes` puts the two-strand line beside the pattern (the screen's
 * big picture); a card shows that line in its caption slot instead.
 */
const drawWatch = (
  g: CanvasRenderingContext2D,
  r: Rect,
  s: HelixState,
  view: PatternView,
  n: number,
  o: {
    size: number;
    notes?: boolean;
    level?: (p: string) => number;
    alpha?: (p: string) => number;
  },
): Spot[] => {
  const level = o.level ?? (() => 0);
  // Strokes grow with the text, so the screen's big copy reads as well as a panel's.
  const u = Math.max(1, o.size / 38);
  const alpha = o.alpha ?? (() => 1);
  well(g, r);
  const inner = { x: r.x + 12, y: r.y + 12, width: r.width - 24, height: r.height - 24 };
  const sideRoom = Math.max(0, inner.width - inner.height);
  const noteSize = o.size * 0.82;
  const besideNote = !!o.notes && s.strands === 2 && sideRoom - 24 * u >= noteSize * 7;
  const sq = {
    x: besideNote ? inner.x : inner.x + sideRoom / 2,
    y: inner.y,
    width: inner.height,
    height: inner.height,
  };
  view.want(keyOf(s, n), () => patternJob(s, n));
  // The picture reaches ±1/(2 × A_PER_PX) Å⁻¹; show ±S_VIEW of it.
  const zoom = 0.5 / A_PER_PX / S_VIEW;
  const c = centre(sq);
  const big = sq.width * zoom;
  clipTo(g, sq, 20);
  view.draw(g, { x: c.x - big / 2, y: c.y - big / 2, width: big, height: big });
  const perS = sq.width / (2 * S_VIEW);
  const R = sq.width;
  // The X as it looks: lines through the middle along the rows' bright inner spots.
  {
    const a = visibleArm(s) * DEG;
    for (const k of [-1, 1])
      line(
        g,
        c.x - k * R * Math.sin(a),
        c.y - R * Math.cos(a),
        c.x + k * R * Math.sin(a),
        c.y + R * Math.cos(a),
        withAlpha(COLOR.angle, 0.55),
        3 * u,
        [16 * u, 12 * u],
      );
  }
  // α itself, which the arms reach only far out, while α pulses.
  const la = level("alpha");
  if (la > 0.01) {
    const a = armAngle(s.pitch, s.radius) * DEG;
    g.save();
    g.globalAlpha = Math.min(1, la);
    for (const k of [-1, 1]) {
      line(
        g,
        c.x - k * R * Math.sin(a),
        c.y - R * Math.cos(a),
        c.x + k * R * Math.sin(a),
        c.y + R * Math.cos(a),
        COLOR.angle,
        4 * (1 + la),
        [14, 10],
      );
    }
    g.restore();
  }
  g.restore();
  // Rows marked at the pattern's edge, 1/P apart; with two strands the fourth is crossed out.
  const spots: Spot[] = [];
  const edge = sq.x + sq.width - 6;
  const lp = level("P");
  // Close rows are numbered every second or third, so the numbers never overlap.
  const every = Math.max(1, Math.ceil((o.size * 0.62) / (layerLine(1, s.pitch) * perS)));
  for (let l = 1; l <= 12; l++) {
    const dy = layerLine(l, s.pitch) * perS;
    if (dy > sq.height / 2 - 10) break;
    for (const k of [-1, 1]) {
      const y = c.y + k * dy;
      line(g, edge - 26 * u, y, edge, y, withAlpha(COLOR.recip, 0.7 + 0.3 * lp), 4 * u * (1 + lp));
      if (k === -1 && l % every === 0)
        label(g, String(l), edge - 40 * u, y, {
          size: o.size * 0.6,
          align: "right",
          color: withAlpha(COLOR.recip, 0.85),
          weight: 700,
        });
    }
    if (s.strands === 2 && l === 4) {
      for (const k of [-1, 1]) {
        g.save();
        g.strokeStyle = COLOR.accent;
        g.lineWidth = 3 * u;
        g.setLineDash([8 * u, 6 * u]);
        g.beginPath();
        g.moveTo(sq.x + 14, c.y + k * dy);
        g.lineTo(edge - 30 * u, c.y + k * dy);
        g.stroke();
        g.restore();
      }
    }
  }
  // The rows' spacing, 1/P, between the middle and the first row.
  {
    const d1 = layerLine(1, s.pitch) * perS;
    const bx = sq.x + 24 * u;
    g.save();
    g.globalAlpha = alpha("P");
    bracket(g, bx, c.y, bx, c.y - d1, {
      color: COLOR.recip,
      width: 4 * u * (1 + 1.4 * lp),
      side: -1,
    });
    label(g, "1/P", bx + 22 * u, c.y - d1 / 2, {
      size: o.size * 0.75,
      align: "left",
      color: COLOR.recip,
      italic: true,
    });
    g.restore();
    spots.push({ part: "P", x: bx, y: c.y - d1 / 2 });
  }
  cornerTag(g, sq, COMMON.flat, { size: Math.max(22, o.size * 0.62), corner: "bl" });
  // The two-strand line on the screen: beside the pattern where there is room, else across its top.
  if (o.notes && s.strands === 2) {
    const text = T.more?.twoStrands?.text ?? "";
    g.save();
    g.font = font(700, noteSize);
    const lh = noteSize * 1.2;
    if (besideNote) {
      const noteX = sq.x + sq.width + 24 * u;
      const lines = wrap(g, text, sideRoom - 24 * u);
      const y0 = c.y - ((lines.length - 1) * lh) / 2;
      lines.forEach((t, i) =>
        label(g, t, noteX, y0 + i * lh, {
          size: noteSize,
          align: "left",
          color: COLOR.accent,
          weight: 700,
        }),
      );
    } else {
      const lines = wrap(g, text, sq.width - 48);
      const h = lines.length * lh + 24;
      const y = sq.y + 8 * u;
      g.fillStyle = withAlpha(COLOR.background, 0.78);
      g.beginPath();
      g.roundRect(sq.x + 12, y, sq.width - 24, h, 16);
      g.fill();
      lines.forEach((t, i) =>
        label(g, t, c.x, y + 12 + lh * (i + 0.5), {
          size: noteSize,
          color: COLOR.accent,
          weight: 700,
        }),
      );
    }
    g.restore();
  }
  return spots;
};

const def: ChapterDef = {
  id: "helix",
  state: STATE_RANGES,
  start: encode(START),
  play(t) {
    // Stretch and squash the helix slowly; every other pass with two strands.
    const pitch = 34 + 14 * Math.sin((t / 20) * TAU);
    return encode({ pitch, radius: 10, strands: Math.floor(t / 20) % 2 === 1 ? 2 : 1 });
  },
  parts: PARTS,
  split: 0.4,
  watch(g, rect, state, look) {
    drawWatch(g, rect, decode(state), look.view("helix"), look.size, {
      size: Math.max(22, Math.min(rect.height * 0.06, rect.width * 0.032, 90)),
      notes: true,
    });
  },
  drive(): MachineDrive {
    return { sample: { form: "fibre" } };
  },
  create(env: ChapterEnv): Chapter {
    let s: HelixState = { ...START };
    let card: CardLayout | null = null;
    let controls: Control[] = [];
    let twist: Rotary | null = null;
    let widen: Slider | null = null;
    let strands: Choice | null = null;
    let view: PatternView | null = null;
    let spin = 0;
    let spots: Spot[] = [];

    const make = (l: CardLayout) => {
      const c = l.child;
      const a = l.adult;
      const atRight = l.outer === "right";
      const size = Math.min(c.height - 8, l.target * 2.3, c.width * 0.4);
      twist = rotary({
        id: "twist",
        rect: {
          x: atRight ? c.x + c.width - size : c.x,
          y: c.y + (c.height - size) / 2,
          width: size,
          height: size,
        },
        band: "child",
        min: RANGE.pitch[0],
        max: RANGE.pitch[1],
        value: s.pitch,
        perTurn: 40,
        style: "wheel",
        color: COLOR.real,
        hub: (g, b) => {
          // A little spring in the hub, stretching with the wheel.
          const turns = 3;
          const h =
            b.height *
            (0.5 + (0.5 * (s.pitch - RANGE.pitch[0])) / (RANGE.pitch[1] - RANGE.pitch[0]));
          g.save();
          g.strokeStyle = COLOR.real;
          g.lineWidth = Math.max(3, b.width * 0.06);
          g.beginPath();
          for (let i = 0; i <= 48; i++) {
            const t = i / 48;
            const x = b.x + b.width / 2 + b.width * 0.32 * Math.cos(t * turns * TAU);
            const y = b.y + b.height / 2 - h / 2 + t * h;
            if (i === 0) g.moveTo(x, y);
            else g.lineTo(x, y);
          }
          g.stroke();
          g.restore();
        },
        onChange: (v) => {
          s = { ...s, pitch: v };
        },
      });
      const rest: Rect = {
        x: atRight ? c.x : c.x + size + 28,
        y: c.y,
        width: c.width - size - 28,
        height: c.height,
      };
      const ch = Math.min(rest.height, l.target * 1.15);
      strands = choice({
        id: "strands",
        rect: { x: rest.x, y: rest.y + (rest.height - ch) / 2, width: rest.width, height: ch },
        band: "child",
        options: [
          { label: L.one!, color: COLOR.real },
          { label: L.two!, color: COLOR.real },
        ],
        value: s.strands - 1,
        color: COLOR.real,
        size: l.type.label * 0.9,
        onChange: (i) => {
          s = { ...s, strands: i === 1 ? 2 : 1 };
        },
      });
      const wh = Math.min(a.height, l.target * 1.25);
      widen = slider({
        id: "widen",
        rect: { x: a.x, y: a.y + a.height - wh, width: a.width, height: wh },
        band: "adult",
        label: L.widen!,
        min: RANGE.radius[0],
        max: RANGE.radius[1],
        step: 0.1,
        value: s.radius,
        color: COLOR.accent,
        size: l.type.label,
        format: (v) => `${v.toFixed(1)} Å`,
        onChange: (v) => {
          s = { ...s, radius: v };
        },
      });
      controls = [twist, strands, widen];
    };

    const sync = () => {
      if (twist && !twist.held) twist.value = s.pitch;
      if (widen && !widen.held) widen.value = s.radius;
      if (strands) strands.value = s.strands - 1;
    };

    /** The helix side on, turning in the beam. */
    const drawHelix = (g: CanvasRenderingContext2D, l: CardLayout, now: number) => {
      const f = l.figure;
      const link = env.link;
      well(g, f, { fill: withAlpha(COLOR.well, 0.6) });
      clipTo(g, f, 28);
      const k = f.height / 60;
      const atRight = l.outer === "right";
      // The helix stands on the card's outer side of the middle, its labels beside it.
      const ax = f.x + f.width * (atRight ? 0.6 : 0.4);
      const cy = l.beamY;
      const R = s.radius * k;
      const Pp = s.pitch * k;
      beam(g, f.x, cy, f.x + f.width, cy, { alpha: 0.85 });
      const top = f.y - 10;
      const bottom = f.y + f.height + 10;
      // Strands: each point at height y has phase 2πy/P + spin, the second shifted by 3/8 P.
      const strandAt = (y: number, which: 0 | 1) => {
        const th = ((y - cy) / Pp) * TAU + spin - (which === 1 ? DNA.offset * TAU : 0);
        return { x: ax + R * Math.cos(th), z: Math.sin(th) };
      };
      const n = s.strands;
      // Rungs first (behind), at each step of the first strand.
      const rise = Pp / DNA.perTurn;
      const y0 = cy - Math.ceil((cy - top) / rise) * rise;
      if (n === 2) {
        for (let y = y0; y <= bottom; y += rise) {
          const a = strandAt(y, 0);
          const b = strandAt(y, 1);
          line(g, a.x, y, b.x, y, withAlpha(COLOR.real, 0.25), 4);
        }
      }
      // Each strand in short pieces, brighter and thicker in front.
      const step = 4;
      for (const pass of [0, 1] as const) {
        for (let w = 0; w < n; w++) {
          for (let y = top; y < bottom; y += step) {
            const a = strandAt(y, w as 0 | 1);
            const b = strandAt(y + step, w as 0 | 1);
            const front = (a.z + b.z) / 2 < 0;
            if (front !== (pass === 1)) continue;
            g.strokeStyle = withAlpha(COLOR.real, front ? 0.95 : 0.35);
            g.lineWidth = front ? 9 : 5;
            g.lineCap = "round";
            g.beginPath();
            g.moveTo(a.x, y);
            g.lineTo(b.x, y + step);
            g.stroke();
          }
          // Its atoms, ten a turn.
          for (let y = y0; y <= bottom; y += rise) {
            const p = strandAt(y, w as 0 | 1);
            if (p.z < 0 !== (pass === 1)) continue;
            disc(g, p.x, y, p.z < 0 ? 9 : 6, p.z < 0 ? "#e8fff0" : COLOR.real, p.z < 0 ? 1 : 0.5);
          }
        }
      }
      // P: one turn, beside the helix on the open side.
      const sideX = atRight ? ax - R - 46 : ax + R + 46;
      const pTop = cy - Pp / 2;
      g.save();
      g.globalAlpha = presence(link, "P", now);
      bracket(g, sideX, pTop + Pp, sideX, pTop, {
        label: "P",
        color: COLOR.real,
        width: 5 * (1 + 1.4 * link.level("P", now)),
        size: l.type.label * 1.1,
        side: atRight ? 1 : -1,
      });
      g.restore();
      // r: from the axis out to the strand, near the top.
      const ry = f.y + 30;
      g.save();
      g.globalAlpha = presence(link, "r", now);
      line(g, ax, f.y + 8, ax, f.y + f.height - 8, withAlpha(COLOR.ink, 0.25), 2, [6, 8]);
      bracket(g, ax, ry, ax + (atRight ? -R : R), ry, {
        label: "r",
        color: COLOR.accent,
        width: 4 * (1 + 1.4 * link.level("r", now)),
        size: l.type.label,
        side: atRight ? 1 : -1,
      });
      g.restore();
      // α on the strand itself: where the front strand crosses the helix's middle, nearest the
      // beam, it climbs at α from the level. The helix turns, so that point rises a turn at a time;
      // the wedge fades at the ends of its run rather than jumping.
      const alpha = armAngle(s.pitch, s.radius) * DEG;
      const turn = (-Math.PI / 2 - spin) / TAU;
      const yA = cy + Pp * (turn - Math.round(turn));
      const run = Math.abs(yA - cy) / (Pp / 2);
      const show = presence(link, "alpha", now) * Math.max(0, Math.min(1, (1 - run) * 4));
      const ar = Math.min(100, Math.max(56, f.height * 0.26));
      // Toward the side away from P's bracket. Going right the strand drops at α, going left it
      // rises at α.
      const wd = atRight ? 1 : -1;
      const ex = wd * Math.cos(alpha);
      const ey = wd * Math.sin(alpha);
      g.save();
      g.globalAlpha = show;
      const lw = 5 * (1 + 1.4 * link.level("alpha", now));
      line(g, ax, yA, ax + wd * ar * 1.6, yA, withAlpha(COLOR.ink, 0.75), 3);
      line(g, ax, yA, ax + ex * ar * 1.6, yA + ey * ar * 1.6, "#e8fff0", 4);
      g.strokeStyle = COLOR.angle;
      g.lineWidth = lw;
      g.beginPath();
      if (wd === 1) g.arc(ax, yA, ar, 0, alpha);
      else g.arc(ax, yA, ar, Math.PI, Math.PI + alpha);
      g.stroke();
      disc(g, ax, yA, 7, COLOR.angle);
      g.restore();
      const lx = ax + wd * (ar + 26) * Math.cos(alpha / 2);
      const ly = yA + wd * (ar + 26) * Math.sin(alpha / 2);
      label(g, `α ${Math.round(alpha / DEG)}°`, lx, ly, {
        size: l.type.label,
        color: COLOR.angle,
        align: wd === 1 ? "left" : "right",
        alpha: show,
      });
      g.restore();
      spots = [
        ...spots.filter((x) => x.y < f.y),
        { part: "P", x: sideX, y: cy },
        { part: "r", x: ax + (atRight ? -R : R) / 2, y: ry },
        { part: "alpha", x: ax + wd * ar * 0.7, y: yA + wd * ar * 0.2 },
      ];
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
        spin += dt * 0.6;
        if (spin > 1e6) spin -= 1e6;
        sync();
        if (keyMove(s)) env.earn();
        // The two-strand line takes the caption slot, so the watch view stays a picture.
        env.say?.({ caption: s.strands === 2 ? (T.more?.twoStrands ?? null) : null });
      },
      draw(g, now) {
        if (!card) return;
        view ??= env.engine().view({ tint: "recip" });
        const link = env.link;
        const watchSpots = drawWatch(g, card.watch, s, view, 256, {
          size: card.type.label,
          level: (p) => link.level(p, now),
          alpha: (p) => presence(link, p, now),
        });
        spots = watchSpots;
        drawHelix(g, card, now);
      },
      partAt(x, y) {
        let best: string | null = null;
        let bestD = 75;
        for (const sp of spots) {
          const d = Math.hypot(x - sp.x, y - sp.y);
          if (d < bestD) {
            bestD = d;
            best = sp.part;
          }
        }
        return best;
      },
      numbers() {
        const a = armAngle(s.pitch, s.radius);
        const lines = [
          `P = ${s.pitch.toFixed(1)} Å, so the rows are ${(1 / s.pitch).toFixed(4)} Å⁻¹ apart`,
          `tan α = ${s.pitch.toFixed(1)} / (2π × ${s.radius.toFixed(1)}), α = ${a.toFixed(1)}°`,
          `the X's inner spots lean ${visibleArm(s).toFixed(1)}° from upright`,
        ];
        if (s.strands === 2)
          lines.push(
            `strands ${(DNA.offset * s.pitch).toFixed(2)} Å apart (3/8 of P): row 4 cancels`,
          );
        return lines;
      },
      state: (): ChapterState => encode(s),
      demo(): DemoStep[] {
        return [
          { control: "twist", to: 48, ms: 2600 },
          { wait: 1600 },
          { control: "strands", to: 1 },
          { wait: 2200 },
          { control: "twist", to: 34, ms: 2000 },
          { wait: 1500 },
        ];
      },
      hint() {
        return twist ? centre(twist.rect) : null;
      },
      status() {
        return {
          pitch: Math.round(s.pitch * 10) / 10,
          radius: Math.round(s.radius * 10) / 10,
          strands: s.strands,
          angle: Math.round(armAngle(s.pitch, s.radius) * 10) / 10,
        };
      },
      reset() {
        s = { ...START };
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
