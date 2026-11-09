/**
 * Chapter 4, why crystals flash (Bragg's law). The beam meets stacked layers, and the wave that
 * goes in to the next layer down and back out travels an extra distance, the detour P to B to Q,
 * d sin θ each way. The figure draws the wave along that detour and writes the extra distance in
 * waves; when it holds a whole number the two waves leave in step, crest beside crest, and the
 * detector flashes. Away from those angles the detector stays dark, so nothing here behaves like a
 * mirror, which would reflect at every angle.
 *
 * - Watch view: the detector's record as the crystal turns, brightness against the detector's
 *   angle (2θ), each peak marked with the whole number of waves that makes it.
 * - Figure: the layers turned by the wheel, the beam fixed; the upper ray hits layer 0 at A, the
 *   lower one layer 1 at B; the dashed lines through A square to the rays mark P and Q, where the
 *   two rays are in step; the detour P to B to Q is highlighted and counted in waves.
 * - Children: the big wheel turns the crystal, settling on each whole number of waves; the X-ray
 *   tubes. Adults: the layer gap (moving it shows the line about the gap), the layers.
 * - Linked formula nλ = 2d sin θ: λ the ruler's tick gap, d the segment A to B, θ at A, 2d sin θ
 *   the detour and its straightened bar, n the whole numbers on the detector's record.
 */
import { withAlpha } from "../../../../core/ui/palette";
import { TEXT } from "../../captions";
import type { Chapter, ChapterDef, ChapterEnv, DemoStep, MachineDrive } from "../../chapter";
import { COLOR, TUBE_IDS, TUBES, type TubeId } from "../../config";
import {
  button,
  choice,
  type Control,
  font,
  rotary,
  roundRect,
  slider,
  type Choice,
  type Button,
  type Rotary,
  type Slider,
} from "../../controls";
import { clipTo, DEG, disc, glow, label, line, TAU, wave, well } from "../../draw";
import { emphasis, presence } from "../../formula";
import { type CardLayout, centre, inset, type Rect } from "../../layout";
import {
  braggAngle,
  type BraggState,
  decode,
  encode,
  flashing,
  intensity,
  lambdaOf,
  LAYER_CHOICES,
  pathInWaves,
  RANGE,
  snapTheta,
  START,
  STATE_RANGES,
  wholeWaves,
} from "./physics";

const T = TEXT.bragg;
const L = T.labels;
const layersText = (n: number) => `${L.layers} ${n}`;
const waveWord = (n: number) => (n === 1 ? L.wave! : L.waves!);
/** The extra distance in waves, as the figure writes it: "1.41 waves", or "1 wave" when whole. */
export const wavesText = (m: number, whole: number | null): string =>
  whole !== null ? `${whole} ${waveWord(whole)}` : `${m.toFixed(2)} ${L.waves}`;

export const PARTS = {
  n: COLOR.ink,
  lam: COLOR.beam,
  d: COLOR.real,
  theta: COLOR.angle,
  path: COLOR.accent,
} as const;

/** 2θ shown on the detector's record, degrees. */
const MAX_2T = 160;
const BINS = 320;
/** The line about the gap stays up this long after the gap last moved, ms. */
const GAP_SAY_MS = 12_000;
/** One throb of the two gold bars at a flash, ms. */
const THROB_MS = 900;

interface Spot {
  part: string;
  x: number;
  y: number;
  r: number;
}

/** The detector's record: brightness against 2θ, the live marker and its flash. */
const drawDetector = (
  g: CanvasRenderingContext2D,
  r: Rect,
  s: BraggState,
  o: {
    record?: Float32Array | null;
    now: number;
    size?: number;
    nLevel?: number;
    maths?: boolean;
    spots?: Spot[];
    /** Drawn inside a well the caller has drawn already, clipped to it. */
    within?: Rect;
  },
) => {
  if (!o.within) well(g, r);
  clipTo(g, o.within ?? r, 28);
  // Text and ticks follow the rect, so the screen's big copy reads as well as a panel's.
  const size = o.size ?? Math.max(22, Math.min(r.height * 0.07, r.width * 0.032, 90));
  const pad = { l: r.width * 0.05, r: r.width * 0.04, t: size * 2.6, b: size * 1.5 };
  const plot = {
    x: r.x + pad.l,
    y: r.y + pad.t,
    width: r.width - pad.l - pad.r,
    height: Math.max(10, r.height - pad.t - pad.b),
  };
  const X = (tt: number) => plot.x + (tt / MAX_2T) * plot.width;
  const Y = (v: number) => plot.y + plot.height * (1 - v);
  const lambda = lambdaOf(s.tube);
  // What the axis is: words for everyone, its symbol with the Maths open.
  label(g, o.maths ? `${L.axis} 2θ` : L.axis!, r.x + pad.l, r.y + size * 0.95, {
    size,
    align: "left",
    color: COLOR.muted,
  });
  line(
    g,
    plot.x,
    plot.y + plot.height,
    plot.x + plot.width,
    plot.y + plot.height,
    withAlpha(COLOR.ink, 0.3),
    3,
  );
  // Labels at least three and a half of their own sizes apart; ticks every 20° regardless.
  const every = [20, 40, 80].find((step) => (plot.width * step) / MAX_2T >= size * 3.5) ?? 80;
  for (let tt = 0; tt <= MAX_2T; tt += 20) {
    const x = X(tt);
    line(
      g,
      x,
      plot.y + plot.height,
      x,
      plot.y + plot.height + size * 0.3,
      withAlpha(COLOR.ink, 0.3),
      3,
    );
    if (tt % every !== 0) continue;
    label(g, `${tt}°`, x, plot.y + plot.height + size * 0.95, {
      size: size * 0.75,
      color: COLOR.muted,
      weight: 600,
    });
  }
  // The full curve, faint, and what this visitor's turning has recorded, bright.
  g.save();
  g.beginPath();
  for (let i = 0; i <= BINS; i++) {
    const tt = (i / BINS) * MAX_2T;
    const v = intensity(tt / 2, s.d, lambda, s.layers);
    if (i === 0) g.moveTo(X(tt), Y(v));
    else g.lineTo(X(tt), Y(v));
  }
  g.strokeStyle = withAlpha(COLOR.recip, o.record ? 0.18 : 0.55);
  g.lineWidth = 3;
  g.stroke();
  if (o.record) {
    g.beginPath();
    g.moveTo(X(0), Y(0));
    for (let i = 0; i < BINS; i++) g.lineTo(X(((i + 0.5) / BINS) * MAX_2T), Y(o.record[i]!));
    g.lineTo(X(MAX_2T), Y(0));
    g.closePath();
    g.fillStyle = withAlpha(COLOR.recip, 0.35);
    g.fill();
    g.strokeStyle = COLOR.recip;
    g.lineWidth = 4;
    g.stroke();
  }
  g.restore();
  // The detector sits at 2θ; it flashes as bright as the reflection.
  const tt = 2 * s.theta;
  const I = intensity(s.theta, s.d, lambda, s.layers);
  const lit = pathInWaves(s.theta, s.d, lambda) > 0.5 ? I : 0;
  const x = X(tt);
  line(g, x, plot.y, x, plot.y + plot.height, withAlpha(COLOR.angle, 0.8), 4);
  glow(g, x, Y(lit), Math.min(plot.height * (0.15 + 0.5 * lit), size * 6), COLOR.recip, 0.2 + lit);
  disc(g, x, Y(lit), 12, COLOR.angle);
  // Where whole numbers of waves fit the extra distance: "1 wave", "2 waves" (n with the Maths).
  const nl = o.nLevel ?? 0;
  let lastX = Number.NEGATIVE_INFINITY;
  for (let n = 1; n <= 12; n++) {
    const th = braggAngle(n, s.d, lambda);
    if (th === null || 2 * th > MAX_2T) continue;
    const x = X(2 * th);
    line(
      g,
      x,
      plot.y,
      x,
      plot.y + plot.height,
      withAlpha(COLOR.ink, 0.14 + 0.5 * nl),
      2 + 3 * nl,
      [8, 10],
    );
    const text = o.maths ? `n = ${n}` : `${n} ${waveWord(n)}`;
    const ts = size * 0.72;
    g.font = font(700, ts);
    const w = g.measureText(text).width;
    // Peaks too close to label each (short waves) keep their dashed line only.
    if (x - w / 2 < lastX + 10) continue;
    lastX = x + w / 2;
    const y = plot.y - size * 0.55;
    label(g, text, x, y, { size: ts, color: withAlpha(COLOR.ink, 0.6 + 0.4 * nl) });
    o.spots?.push({ part: "n", x, y, r: Math.max(50, w / 2) });
  }
  if (lit > 0.6) {
    const right = x > plot.x + plot.width * 0.75;
    label(g, L.flash!, x + (right ? -1 : 1) * size * 0.6, plot.y + plot.height * 0.32, {
      size: size * 1.3,
      color: COLOR.recip,
      weight: 900,
      align: right ? "right" : "left",
    });
  }
  g.restore();
};

/** "Extra distance" over the count of waves, in a box, scaled to fit. */
const drawCountIn = (
  g: CanvasRenderingContext2D,
  box: Rect,
  m: number,
  whole: number | null,
  type: { label: number; maths: number },
  o: { alpha?: number; grow?: number } = {},
) => {
  if (box.width < 120 || box.height < 30) return;
  const text = wavesText(m, whole);
  const color = whole !== null ? COLOR.real : COLOR.accent;
  const small = Math.min(type.label * 0.82, Math.max(20, box.height * 0.26));
  const two = box.height >= small * 1.2 + type.label * 1.3;
  let big = Math.min(type.maths * 1.05, (box.height - (two ? small * 1.25 : 0)) / 1.12);
  g.font = font(900, big);
  const w = g.measureText(text).width;
  g.font = font(700, small);
  const sw = g.measureText(`${L.extra}  `).width;
  const room = two ? box.width : box.width - sw;
  if (w > room) big *= room / w;
  g.save();
  g.globalAlpha = o.alpha ?? 1;
  const soft = withAlpha(COLOR.accent, 0.85);
  if (two) {
    label(g, L.extra!, box.x, box.y + small * 0.6, { size: small, align: "left", color: soft });
    label(g, text, box.x, box.y + small * 1.25 + big * 0.56, {
      size: big * Math.min(1.1, o.grow ?? 1),
      align: "left",
      color,
      weight: 900,
    });
  } else {
    const y = box.y + box.height / 2;
    label(g, L.extra!, box.x, y, { size: small, align: "left", color: soft });
    label(g, text, box.x + sw, y, { size: big, align: "left", color, weight: 900 });
  }
  g.restore();
};

/** The layer gap in px at a scale. */
const dpOf = (d: number, scale: number) => d * scale;

/** A label with a dark halo, so it reads over waves and layers. */
const haloLabel = (
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  o: { size: number; color: string; italic?: boolean; align?: CanvasTextAlign; weight?: number },
) => {
  g.save();
  g.font = o.italic
    ? `italic 700 ${Math.round(o.size)}px Georgia, "Times New Roman", serif`
    : font(o.weight ?? 800, o.size);
  g.textAlign = o.align ?? "center";
  g.textBaseline = "middle";
  g.lineJoin = "round";
  g.lineWidth = o.size * 0.28;
  g.strokeStyle = withAlpha(COLOR.well, 0.92);
  g.strokeText(text, x, y);
  g.fillStyle = o.color;
  g.fillText(text, x, y);
  g.restore();
};

const def: ChapterDef = {
  id: "bragg",
  state: STATE_RANGES,
  start: encode(START),
  // The figure needs height for the layers, the detour and the waves leaving.
  split: 0.6,
  play(t) {
    // A slow sweep that rests on the first two flashes, for a screen with nobody turning.
    const lam = lambdaOf(START.tube);
    const t1 = braggAngle(1, START.d, lam) ?? 20;
    const t2 = braggAngle(2, START.d, lam) ?? 40;
    const keys: [number, number][] = [
      [0, 10],
      [6, t1],
      [10, t1],
      [16, t2],
      [20, t2],
      [28, 10],
    ];
    const u = ((t % 28) + 28) % 28;
    let k = 0;
    while (k < keys.length - 2 && u > keys[k + 1]![0]) k++;
    const [ta, a] = keys[k]!;
    const [tb, b] = keys[k + 1]!;
    const f = Math.min(1, Math.max(0, (u - ta) / (tb - ta)));
    return encode({ ...START, theta: a + (b - a) * f * f * (3 - 2 * f) });
  },
  parts: PARTS,
  watch(g, rect, state, look) {
    const s = decode(state);
    // On a tall picture (the screen's) the count of waves heads the record, as on the kiosk.
    if (rect.height < rect.width * 0.55) {
      drawDetector(g, rect, s, { now: look.now });
      return;
    }
    well(g, rect);
    const size = Math.max(22, Math.min(rect.width * 0.032, 90));
    const head = size * 4.2;
    const lam = lambdaOf(s.tube);
    drawCountIn(
      g,
      {
        x: rect.x + size * 1.6,
        y: rect.y + size * 0.9,
        width: rect.width - size * 3.2,
        height: head - size * 0.9,
      },
      pathInWaves(s.theta, s.d, lam),
      wholeWaves(s.theta, s.d, lam),
      { label: size, maths: size * 2.2 },
    );
    drawDetector(
      g,
      { x: rect.x, y: rect.y + head, width: rect.width, height: rect.height - head },
      s,
      { now: look.now, size, within: rect },
    );
  },
  drive(state): MachineDrive {
    const s = decode(state);
    const lambda = lambdaOf(s.tube);
    return {
      lambda,
      stage: { omega: s.theta, chi: 0, phi: 0 },
      arm: 2 * s.theta,
      flash: flashing(s.theta, s.d, lambda, s.layers)
        ? intensity(s.theta, s.d, lambda, s.layers)
        : 0,
    };
  },
  create(env: ChapterEnv): Chapter {
    let s: BraggState = { ...START, tube: env.config.tube };
    const record = new Float32Array(BINS);
    let card: CardLayout | null = null;
    let controls: Control[] = [];
    let wheel: Rotary | null = null;
    let gap: Slider | null = null;
    let tube: Choice | Button | null = null;
    let layers: Button | null = null;
    /** The phase of the waves where the upper ray meets layer 0, radians; it falls as they travel. */
    let phase = 0;
    let spots: Spot[] = [];
    /** When the gap last moved (ms), and whether its line is up as the caption. */
    let gapAt = Number.NEGATIVE_INFINITY;
    let gapSaid = false;
    /** When the extra distance became a whole number of waves (ms), or null away from a flash. */
    let wholeAt: number | null = null;
    /**
     * At a flash the detour and its straightened bar throb together, 0 to 1, from the moment it
     * starts, so the eye matches the two gold lengths.
     */
    const throb = (now: number) =>
      wholeAt === null ? 0 : 0.5 - 0.5 * Math.cos((TAU * (now - wholeAt)) / THROB_MS);

    const lambda = () => lambdaOf(s.tube);
    const setTube = (id: TubeId) => {
      if (s.tube === id) return;
      s = { ...s, tube: id };
      record.fill(0);
    };
    const inStep = () => wholeWaves(s.theta, s.d, lambda()) !== null;
    const unsayGap = () => {
      if (!gapSaid) return;
      gapSaid = false;
      env.say?.({ caption: null });
    };

    const make = (l: CardLayout) => {
      const c = l.child;
      const a = l.adult;
      const wheelSize = Math.min(c.height - 8, l.target * 2.4, c.width * 0.45);
      const atRight = l.outer === "right";
      const wheelRect: Rect = {
        x: atRight ? c.x + c.width - wheelSize : c.x,
        y: c.y + (c.height - wheelSize) / 2,
        width: wheelSize,
        height: wheelSize,
      };
      const rest: Rect = {
        x: atRight ? c.x : c.x + wheelSize + 28,
        y: c.y,
        width: c.width - wheelSize - 28,
        height: c.height,
      };
      wheel = rotary({
        id: "wheel",
        rect: wheelRect,
        band: "child",
        min: RANGE.theta[0],
        max: RANGE.theta[1],
        value: s.theta,
        perTurn: 60,
        style: "wheel",
        color: COLOR.angle,
        hub: (g, b) => {
          // A little crystal in the hub: it turns with the wheel's value.
          g.save();
          g.translate(b.x + b.width / 2, b.y + b.height / 2);
          g.rotate(-s.theta * DEG);
          for (let i = -1; i <= 1; i++)
            for (let j = -1; j <= 1; j++)
              disc(g, i * b.width * 0.3, j * b.width * 0.3, b.width * 0.1, COLOR.real);
          g.restore();
        },
        onChange: (v) => {
          // The wheel settles on each whole number of waves, as a dial settles in a notch.
          s = { ...s, theta: snapTheta(v, s.d, lambda()) };
          if (inStep()) env.earn();
        },
      });
      const tileH = Math.min(rest.height, l.target * 1.1);
      const tiles: Rect = {
        x: rest.x,
        y: rest.y + (rest.height - tileH) / 2,
        width: rest.width,
        height: tileH,
      };
      const fits = rest.width >= 3 * l.target + 28;
      tube = fits
        ? choice({
            id: "tube",
            rect: tiles,
            band: "child",
            options: TUBE_IDS.map((id) => ({ label: L[id] ?? id, color: COLOR.beam })),
            value: TUBE_IDS.indexOf(s.tube),
            color: COLOR.beam,
            size: l.type.label * 0.9,
            onChange: (i) => setTube(TUBE_IDS[i] ?? "copper"),
          })
        : button({
            id: "tube",
            rect: tiles,
            band: "child",
            label: L[s.tube] ?? s.tube,
            color: COLOR.beam,
            size: l.type.label * 0.9,
            onPress: () => {
              setTube(TUBE_IDS[(TUBE_IDS.indexOf(s.tube) + 1) % TUBE_IDS.length]!);
              if (tube && "on" in tube) tube.label = L[s.tube] ?? s.tube;
            },
          });
      // The layers button cycles 2, 4, 8, beside the gap slider where there is room.
      const layersW = Math.max(l.target * 1.7, 250);
      const wide = a.width >= layersW + 360;
      const gr: Rect = wide ? { ...a, width: a.width - layersW - 28 } : a;
      gap = slider({
        id: "gap",
        rect: gr,
        band: "adult",
        label: L.gap!,
        min: RANGE.d[0],
        max: RANGE.d[1],
        step: 0.01,
        value: s.d,
        color: COLOR.real,
        size: l.type.label,
        format: (v) => `${v.toFixed(2)} Å`,
        onChange: (v) => {
          s = { ...s, d: v };
          record.fill(0);
          // The flashes move with the gap: say so while it is being moved.
          gapAt = env.now();
          if (!gapSaid && T.more?.gap) {
            gapSaid = true;
            env.say?.({ caption: T.more.gap });
          }
        },
      });
      layers = null;
      if (wide) {
        const lh = Math.min(a.height, l.target * 1.05);
        layers = button({
          id: "layers",
          rect: { x: a.x + a.width - layersW, y: a.y + a.height - lh, width: layersW, height: lh },
          band: "adult",
          label: layersText(s.layers),
          color: COLOR.real,
          size: l.type.label,
          onPress: () => {
            const i = LAYER_CHOICES.indexOf(s.layers as 2 | 4 | 8);
            s = { ...s, layers: LAYER_CHOICES[(i + 1) % LAYER_CHOICES.length] ?? 4 };
            if (layers) layers.label = layersText(s.layers);
            record.fill(0);
          },
        });
      }
      controls = [wheel, tube, gap, ...(layers ? [layers] : [])];
    };

    const sync = () => {
      if (wheel) wheel.value = s.theta;
      if (gap) gap.value = s.d;
      if (layers) layers.label = layersText(s.layers);
      if (tube) {
        if ("options" in tube) tube.value = TUBE_IDS.indexOf(s.tube);
        else tube.label = L[s.tube] ?? s.tube;
      }
    };

    const drawCount = (
      g: CanvasRenderingContext2D,
      box: Rect,
      m: number,
      whole: number | null,
      l: CardLayout,
      now: number,
    ) =>
      drawCountIn(g, box, m, whole, l.type, {
        alpha: presence(env.link, "path", now),
        grow: emphasis(env.link, "path", now),
      });

    /**
     * The detour straightened out into a ruler: a wave with a tick at every wavelength (so a tick
     * gap is λ), and under it a bar as long as the extra distance, which ends exactly on a tick at
     * a flash.
     */
    const drawRuler = (
      g: CanvasRenderingContext2D,
      x0: number,
      y: number,
      width: number,
      edge: number,
      m: number,
      whole: number | null,
      lp: number,
      ls: number,
      now: number,
    ) => {
      const h = Math.max(18, Math.min(26, lp * 0.3));
      const lamA = presence(env.link, "lam", now);
      // The ruler runs at least as far as the bar, up to a hard edge.
      const len = Math.min(m * lp, edge - x0);
      const p = throb(now);
      g.save();
      g.globalAlpha = (0.6 + 0.4 * p) * presence(env.link, "path", now);
      line(
        g,
        x0,
        y,
        x0 + len,
        y,
        COLOR.accent,
        h * 0.75 * (1 + 0.7 * p) * emphasis(env.link, "path", now),
      );
      g.restore();
      const ticks = Math.min(
        Math.floor((edge - x0) / lp + 1e-6),
        Math.max(Math.floor(width / lp + 1e-6), Math.ceil(m - 1e-6)),
      );
      wave(g, x0, y, x0 + ticks * lp, y, {
        lambda: lp,
        amp: h * 0.36,
        phase: 0,
        color: COLOR.beam,
        width: 3 * emphasis(env.link, "lam", now),
        alpha: 0.8 * lamA,
      });
      for (let k = 0; k <= ticks; k++)
        line(
          g,
          x0 + k * lp,
          y - h * 0.75,
          x0 + k * lp,
          y + h * 0.75,
          withAlpha(COLOR.beam, lamA),
          3.5 * emphasis(env.link, "lam", now),
        );
      disc(g, x0 + len, y, h * 0.36, whole !== null ? COLOR.real : COLOR.accent);
      g.save();
      g.globalAlpha = lamA;
      haloLabel(g, "λ", x0 - ls * 0.62, y, { size: ls, color: COLOR.beam, italic: true });
      g.restore();
    };

    const drawFigure = (g: CanvasRenderingContext2D, l: CardLayout, now: number) => {
      const f = l.figure;
      const link = env.link;
      clipTo(g, f, 28);
      const lam = lambda();
      const th = s.theta * DEG;
      const sin = Math.sin(th);
      const cos = Math.cos(th);
      // Ångströms to px: as big as the room above the beam allows, shrinking only for wide gaps.
      // On the kiosk the count sits in the watch view, so the drawing takes the whole height.
      const countHere = l.shape === "column";
      const above = l.beamY - f.y - 24;
      const scale = Math.max(14, Math.min(56, (above * (countHere ? 0.56 : 0.72)) / s.d));
      // Letters scale with the drawing where it is small.
      const ls = Math.min(l.type.label * 1.08, Math.max(24, dpOf(s.d, scale) * 0.42));
      const dp = dpOf(s.d, scale);
      const lp = lam * scale;
      const amp = Math.max(6, Math.min(18, lp * 0.2));
      // B, where the lower ray meets layer 1, sits on the card's beam; A on layer 0 above it.
      const B = { x: f.x + f.width * 0.56, y: l.beamY };
      const across = { x: sin, y: cos };
      const along = { x: cos, y: -sin };
      const A = { x: B.x - dp * across.x, y: B.y - dp * across.y };
      const out = { x: Math.cos(2 * th), y: -Math.sin(2 * th) };
      const leg = dp * sin;
      const P = { x: A.x, y: B.y };
      const Q = { x: B.x + out.x * leg, y: B.y + out.y * leg };
      const m = pathInWaves(s.theta, s.d, lam);
      const whole = wholeWaves(s.theta, s.d, lam);
      const bright = m > 0.5 ? intensity(s.theta, s.d, lam, s.layers) : 0;
      const reach = 2 * (f.width + f.height);

      // The crystal: a slab of layers d apart, faintly tinted, each layer a row of atoms.
      const deep = {
        x: A.x + across.x * dp * (s.layers - 1),
        y: A.y + across.y * dp * (s.layers - 1),
      };
      g.save();
      g.beginPath();
      g.moveTo(A.x - along.x * reach, A.y - along.y * reach);
      g.lineTo(A.x + along.x * reach, A.y + along.y * reach);
      g.lineTo(deep.x + along.x * reach, deep.y + along.y * reach);
      g.lineTo(deep.x - along.x * reach, deep.y - along.y * reach);
      g.closePath();
      g.fillStyle = withAlpha(COLOR.real, 0.09);
      g.fill();
      g.restore();
      const atomGap = Math.max(54, dp * 0.9);
      const atomR = Math.max(5, Math.min(11, scale * 0.17));
      for (let k = 0; k < s.layers; k++) {
        const o = { x: A.x + across.x * dp * k, y: A.y + across.y * dp * k };
        if (o.y - f.y > f.height + reach) break;
        line(
          g,
          o.x - along.x * reach,
          o.y - along.y * reach,
          o.x + along.x * reach,
          o.y + along.y * reach,
          withAlpha(COLOR.real, 0.24),
          3,
        );
        const J = Math.ceil(reach / atomGap);
        for (let j = -J; j <= J; j++) {
          const x = o.x + along.x * j * atomGap;
          const y = o.y + along.y * j * atomGap;
          if (x < f.x - 20 || x > f.x + f.width + 20 || y < f.y - 20 || y > f.y + f.height + 20)
            continue;
          disc(g, x, y, atomR, COLOR.real, 0.55);
        }
      }

      // Outgoing: the two rays run on side by side to the detector, their crests side by side at a
      // flash. Their sum shows only as light: a glow behind both and the detector's flash, dark
      // unless they are in step. A third wave for the sum read as a third ray.
      // The glow goes down first, so the gold detour over it stays the ruler bar's colour.
      const margin = 30;
      let tMax = Number.POSITIVE_INFINITY;
      for (const p of [A, Q]) {
        if (out.y < -1e-3) tMax = Math.min(tMax, (p.y - f.y - margin) / -out.y);
        if (out.x > 1e-3) tMax = Math.min(tMax, (f.x + f.width - margin - p.x) / out.x);
        if (out.x < -1e-3) tMax = Math.min(tMax, (p.x - f.x - margin) / -out.x);
      }
      const detW = 24;
      tMax = Math.max(lp * 0.8, tMax - detW);
      const M = { x: (A.x + Q.x) / 2, y: (A.y + Q.y) / 2 };
      const E = { x: M.x + out.x * tMax, y: M.y + out.y * tMax };
      if (bright > 0.05) {
        g.save();
        g.globalAlpha = bright * 0.5;
        g.lineCap = "round";
        line(g, M.x, M.y, E.x, E.y, withAlpha(COLOR.scattered, 0.55), dp * cos + 2 * amp + 30);
        g.restore();
      }

      // The detour P to B to Q, highlighted under its wave: the extra distance, d sin θ each way.
      const pw = emphasis(link, "path", now) * (1 + 0.7 * throb(now));
      g.save();
      g.globalAlpha = (0.5 + 0.45 * throb(now)) * presence(link, "path", now);
      g.lineCap = "round";
      line(g, P.x, P.y, B.x, B.y, COLOR.accent, 16 * pw);
      line(g, B.x, B.y, Q.x, Q.y, COLOR.accent, 16 * pw);
      g.restore();
      // The two lines square to the rays through A: on each, both rays are in step.
      line(g, A.x, A.y, P.x, P.y, withAlpha(COLOR.ink, 0.55), 2.5, [7, 8]);
      line(g, A.x, A.y, Q.x, Q.y, withAlpha(COLOR.ink, 0.55), 2.5, [7, 8]);

      const lamA = presence(link, "lam", now);
      // Incoming: both rays start from the figure's edge in step, and meet A and P together.
      const x0 = f.x;
      const start = phase - (TAU * (A.x - x0)) / lp;
      wave(g, x0, A.y, A.x, A.y, {
        lambda: lp,
        amp,
        phase: start,
        color: COLOR.beam,
        width: 5,
        alpha: lamA,
      });
      wave(g, x0, B.y, P.x, P.y, {
        lambda: lp,
        amp,
        phase: start,
        color: COLOR.beam,
        width: 5,
        alpha: lamA,
      });
      // The beam the lower layers leave carries on to the card's right edge.
      line(g, B.x, B.y, f.x + f.width, B.y, withAlpha(COLOR.beam, 0.3), 4);
      // The detour's own wave: in to layer 1 and back out, so its crests can be counted.
      const atB = wave(g, P.x, P.y, B.x, B.y, {
        lambda: lp,
        amp,
        phase,
        color: COLOR.beam,
        width: 5,
        alpha: lamA,
      });
      const atQ = wave(g, B.x, B.y, Q.x, Q.y, {
        lambda: lp,
        amp,
        phase: atB,
        color: COLOR.scattered,
        width: 5,
      });

      // Outgoing, over their glow.
      for (const [p, ph] of [
        [A, phase],
        [Q, atQ],
      ] as const)
        wave(g, p.x, p.y, p.x + out.x * tMax, p.y + out.y * tMax, {
          lambda: lp,
          amp,
          phase: ph,
          color: COLOR.scattered,
          width: 5,
        });
      // The detector, a plate square to the rays it catches, flashing as bright as their sum.
      const half = (dp * cos) / 2 + 26;
      const D = { x: E.x + out.x * detW * 0.5, y: E.y + out.y * detW * 0.5 };
      glow(g, D.x, D.y, 70 + 120 * bright, COLOR.recip, 0.1 + bright);
      g.save();
      g.translate(D.x, D.y);
      g.rotate(-2 * th);
      g.fillStyle = withAlpha(COLOR.real, 0.25 + 0.55 * bright);
      g.strokeStyle = COLOR.real;
      g.lineWidth = 4;
      g.beginPath();
      g.roundRect(-detW / 2, -half, detW, 2 * half, 8);
      g.fill();
      g.stroke();
      g.restore();

      // d: the segment A to B, square to the layers, a ruler for the gap.
      const dw = emphasis(link, "d", now);
      g.save();
      g.globalAlpha = presence(link, "d", now);
      line(g, A.x, A.y, B.x, B.y, COLOR.real, 4 * dw);
      for (const p of [A, B])
        line(
          g,
          p.x - along.x * 12,
          p.y - along.y * 12,
          p.x + along.x * 12,
          p.y + along.y * 12,
          COLOR.real,
          4 * dw,
        );
      g.restore();
      disc(g, A.x, A.y, atomR * 1.25, COLOR.real);
      disc(g, B.x, B.y, atomR * 1.25, COLOR.real);
      const side = s.theta < 45 ? -1 : 1;
      const dOff = ls * 0.5 + 16;
      const dl = {
        x: (A.x + B.x) / 2 + along.x * side * dOff,
        y: (A.y + B.y) / 2 + along.y * side * dOff,
      };
      g.save();
      g.globalAlpha = presence(link, "d", now);
      haloLabel(g, "d", dl.x, dl.y, { size: ls, color: COLOR.real, italic: true });
      g.restore();

      // θ at A: between the beam and layer 0, and again between layer 0 and the wave leaving.
      const ar = Math.max(40, Math.min(78, dp * 0.5));
      g.save();
      g.globalAlpha = presence(link, "theta", now);
      g.strokeStyle = COLOR.angle;
      g.lineWidth = 5 * emphasis(link, "theta", now);
      g.beginPath();
      g.arc(A.x, A.y, ar, Math.PI - th, Math.PI);
      g.stroke();
      g.beginPath();
      g.arc(A.x, A.y, ar, -2 * th, -th);
      g.stroke();
      g.restore();
      // A narrow wedge has no room inside it for the letter: put it just below the layer then.
      // Further out along its ray while it would touch the d.
      const ta = s.theta > 25 ? Math.PI - th / 2 : Math.PI - th - 0.3;
      let tr = ar + ls * 0.7;
      const at = (r: number) => ({ x: A.x + Math.cos(ta) * r, y: A.y + Math.sin(ta) * r });
      while (Math.hypot(at(tr).x - dl.x, at(tr).y - dl.y) < ls * 1.2 && tr < ar + 160) tr += 8;
      const tl = at(tr);
      g.save();
      g.globalAlpha = presence(link, "theta", now);
      haloLabel(g, "θ", tl.x, tl.y, {
        size: ls,
        color: COLOR.angle,
        italic: true,
      });
      g.restore();

      // With the Maths open, each leg of the detour is named: d sin θ in, d sin θ out.
      if (env.mathsOpen?.()) {
        const ls = l.type.label * 0.82;
        g.save();
        g.globalAlpha = presence(link, "path", now);
        // Each leg named at its own end: the way in under it, left of B; the way out right of Q.
        haloLabel(g, "d sin θ", B.x - 10, B.y + ls * 1.05, {
          size: ls,
          color: COLOR.accent,
          italic: true,
          align: "right",
        });
        haloLabel(g, "d sin θ", Q.x + 16, Q.y + ls * 0.15, {
          size: ls,
          color: COLOR.accent,
          italic: true,
          align: "left",
        });
        g.restore();
      }

      // The detour as a ruler marked in wavelengths, beside the upper incoming wave near the
      // figure's edge: under it while the count sits above it, over it once the count has moved.
      const countLeft = out.x > -0.25;
      const lx = f.x + 30 + ls * 1.2;
      const ly = countLeft ? A.y + amp + ls * 0.75 : A.y - amp - ls * 0.75;
      // It stops short of the θ at A.
      const rulerW = Math.max(lp, A.x - lx - Math.max(40, Math.min(78, dp * 0.5)) - ls * 1.6);
      drawRuler(g, lx, ly, rulerW, f.x + f.width - 40, m, whole, lp, ls, now);

      // The extra distance, counted in waves, large, where the waves leaving leave room.
      const zoneTop = f.y + 18;
      const zoneBottom = A.y - amp - 14;
      const leftZone: Rect = {
        x: f.x + 30,
        y: zoneTop,
        width: Math.max(0, A.x - amp - 24 - f.x - 30),
        height: zoneBottom - zoneTop,
      };
      const box: Rect = countLeft
        ? leftZone
        : {
            x: A.x + 60,
            y: zoneTop,
            width: f.x + f.width - 30 - A.x - 60,
            height: zoneBottom - zoneTop,
          };
      if (!countLeft) {
        // Over the crystal: a dark plate behind the words.
        g.save();
        roundRect(g, inset(box, -12), 18);
        g.fillStyle = withAlpha(COLOR.well, 0.82);
        g.fill();
        g.restore();
      }
      if (countHere) drawCount(g, box, m, whole, l, now);
      g.restore();

      spots.push(
        { part: "path", x: B.x, y: B.y, r: 70 },
        { part: "path", x: box.x + box.width * 0.3, y: box.y + box.height * 0.6, r: 90 },
        { part: "d", x: (A.x + B.x) / 2, y: (A.y + B.y) / 2, r: 60 },
        { part: "theta", x: tl.x, y: tl.y, r: 60 },
        { part: "lam", x: lx + lp / 2, y: ly, r: 60 },
        { part: "path", x: lx + Math.min(m * lp, rulerW), y: ly, r: 50 },
      );
    };

    const nowFlashing = () => flashing(s.theta, s.d, lambda(), s.layers);

    return {
      layout(l) {
        card = l;
        make(l);
      },
      get controls() {
        return controls;
      },
      update(dt, now) {
        phase -= dt * TAU * 0.6;
        if (phase < -1e6) phase += 1e6 - (1e6 % TAU);
        const lam = lambda();
        // Record what the detector saw at this 2θ.
        const bin = Math.min(BINS - 1, Math.max(0, Math.floor(((2 * s.theta) / MAX_2T) * BINS)));
        const v = pathInWaves(s.theta, s.d, lam) > 0.5 ? intensity(s.theta, s.d, lam, s.layers) : 0;
        if (v > record[bin]!) record[bin] = v;
        if (inStep()) env.earn();
        if (wholeWaves(s.theta, s.d, lam) === null) wholeAt = null;
        else wholeAt ??= now;
        if (gapSaid && now - gapAt > GAP_SAY_MS) unsayGap();
      },
      draw(g, now) {
        if (!card) return;
        const maths = env.mathsOpen?.() ?? false;
        spots = [];
        let rec = inset(card.watch, 2);
        if (card.shape === "landscape") {
          // The kiosk's figure is short, so the count of waves heads its tall watch view.
          well(g, rec);
          const head = Math.round(card.type.maths * 2.4);
          const lam = lambda();
          const box: Rect = {
            x: rec.x + 40,
            y: rec.y + 26,
            width: rec.width - 80,
            height: head - 26,
          };
          const m = pathInWaves(s.theta, s.d, lam);
          const whole = wholeWaves(s.theta, s.d, lam);
          drawCount(g, box, m, whole, card, now);
          spots.push({
            part: "path",
            x: box.x + box.width * 0.3,
            y: box.y + box.height / 2,
            r: 90,
          });
          rec = { ...rec, y: rec.y + head, height: rec.height - head };
        }
        drawDetector(g, rec, s, {
          record,
          now,
          size: card.type.label,
          nLevel: env.link.level("n", now) + env.link.level("path", now) * 0.4,
          maths,
          spots,
          within: card.shape === "landscape" ? inset(card.watch, 2) : undefined,
        });
        well(g, card.figure, { fill: withAlpha(COLOR.well, 0.6) });
        drawFigure(g, card, now);
      },
      partAt(x, y) {
        let best: string | null = null;
        let bestD = Number.POSITIVE_INFINITY;
        for (const p of spots) {
          const d = Math.hypot(x - p.x, y - p.y);
          if (d < p.r && d < bestD) {
            best = p.part;
            bestD = d;
          }
        }
        return best;
      },
      numbers() {
        const lam = lambda();
        const path = 2 * s.d * Math.sin(s.theta * DEG);
        return [
          `θ = ${s.theta.toFixed(1)}°   2θ = ${(2 * s.theta).toFixed(1)}°`,
          `d = ${s.d.toFixed(2)} Å   λ = ${lam.toFixed(4)} Å (${TUBES[s.tube].symbol})`,
          `2d sin θ = ${path.toFixed(3)} Å = ${(path / lam).toFixed(2)} λ`,
        ];
      },
      state: () => encode(s),
      demo(): DemoStep[] {
        const lam = lambda();
        const first = braggAngle(1, s.d, lam) ?? 20;
        const second = braggAngle(2, s.d, lam);
        return [
          { control: "wheel", to: first, ms: 3200 },
          { wait: 1600 },
          ...(second && second < RANGE.theta[1]
            ? [{ control: "wheel", to: second, ms: 3200 }, { wait: 1400 }]
            : []),
        ];
      },
      hint() {
        return wheel ? centre(wheel.rect) : null;
      },
      status() {
        return {
          theta: Math.round(s.theta * 10) / 10,
          d: s.d,
          flash: nowFlashing(),
          waves: Math.round(pathInWaves(s.theta, s.d, lambda()) * 100) / 100,
          inStep: inStep(),
        };
      },
      reset() {
        s = { ...START, tube: env.config.tube };
        record.fill(0);
        gapAt = Number.NEGATIVE_INFINITY;
        unsayGap();
        sync();
      },
      show(shown) {
        if (!shown) unsayGap();
      },
      dispose() {
        controls = [];
      },
    };
  },
};

export default def;
