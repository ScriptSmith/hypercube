/**
 * The controls' DOM: a dark console behind each group, a canvas per lever, dial, shape button and
 * gauge, a label per orientation button, captions, legends and a ghost hand per stage. None of it
 * takes pointer events: index code hit-tests touches itself (layout.ts, controls.ts), so fingers
 * and bots go through one path. A canvas is redrawn only when what it shows changes.
 */
import { ensureStyles, FONT, iconSvg } from "../../core/ui";
import { AXIS_COLORS, AXIS_NAMES, FAR_COLOR, NEAR_COLOR, SHEET_COLOR } from "./config";
import type { Circle, Layout, StageLayout } from "./layout";
import type { Dim } from "./shapes";
import { REACH } from "./slice";

export interface StageLook {
  dim: Dim;
  lever: number;
  /** The shape's span along the lever's travel, in lever units, or null. */
  extent: { lo: number; hi: number } | null;
  leverHeld: boolean;
  dials: readonly number[];
  dialHeld: readonly boolean[];
  /** The "first" button last pressed, while it still holds. */
  active: number | null;
  family: number;
  caption: string | null;
  /** A ghost fingertip, venue px. */
  ghost: { x: number; y: number } | null;
  /** The shape's extent along the hidden axis and the cut, in cut units. */
  gauge: { lo: number; hi: number; cut: number } | null;
  color: string;
}

export interface Panel {
  update(looks: readonly StageLook[]): void;
  dispose(): void;
}

const TAU = Math.PI * 2;
const MAX_BACKING = 720;

const roundRect = (
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) => {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
};

/** A family's pictogram in a 100 x 100 box: cube, pyramid, diamond, ball. */
const drawFamily = (g: CanvasRenderingContext2D, family: number, color: string) => {
  g.strokeStyle = color;
  g.lineWidth = 5;
  g.lineJoin = "round";
  g.lineCap = "round";
  const line = (pts: [number, number][], close = false) => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
    if (close) g.closePath();
    g.stroke();
  };
  if (family === 0) {
    line(
      [
        [28, 38],
        [62, 38],
        [62, 72],
        [28, 72],
      ],
      true,
    );
    line([
      [28, 38],
      [42, 24],
      [76, 24],
      [62, 38],
    ]);
    line([
      [76, 24],
      [76, 58],
      [62, 72],
    ]);
    g.globalAlpha = 0.45;
    line([
      [28, 72],
      [42, 58],
      [76, 58],
    ]);
    line([
      [42, 24],
      [42, 58],
    ]);
    g.globalAlpha = 1;
  } else if (family === 1) {
    line(
      [
        [50, 18],
        [20, 74],
        [64, 82],
      ],
      true,
    );
    line([
      [50, 18],
      [82, 64],
      [64, 82],
    ]);
    g.globalAlpha = 0.45;
    line([
      [20, 74],
      [82, 64],
    ]);
    g.globalAlpha = 1;
  } else if (family === 2) {
    line(
      [
        [50, 14],
        [20, 50],
        [50, 86],
        [80, 50],
      ],
      true,
    );
    line([
      [50, 14],
      [58, 56],
      [50, 86],
    ]);
    line([
      [20, 50],
      [58, 56],
      [80, 50],
    ]);
    g.globalAlpha = 0.45;
    line([
      [20, 50],
      [42, 44],
      [80, 50],
    ]);
    line([
      [50, 14],
      [42, 44],
      [50, 86],
    ]);
    g.globalAlpha = 1;
  } else {
    g.beginPath();
    g.arc(50, 50, 33, 0, TAU);
    g.stroke();
    g.beginPath();
    g.ellipse(50, 50, 33, 11, 0, 0, TAU);
    g.stroke();
    g.globalAlpha = 0.45;
    g.beginPath();
    g.ellipse(50, 50, 11, 33, 0, 0, TAU);
    g.stroke();
    g.globalAlpha = 1;
  }
};

interface Canvas {
  el: HTMLCanvasElement;
  g: CanvasRenderingContext2D | null;
  key: string;
}

interface StageEls {
  lever: Canvas | null;
  dials: Canvas[];
  orients: { el: HTMLElement; k: number; key: string }[];
  shapes: Canvas[];
  gauge: Canvas | null;
  caption: HTMLElement;
  captionText: string | null;
  hand: HTMLElement;
  handSize: number;
}

export interface PanelOpts {
  axes: boolean;
  /** Legend chips per stage view: label and colour. */
  legends: readonly (readonly {
    x: number;
    y: number;
    items: readonly { label: string; color: string }[];
  }[])[];
}

export const createPanel = (
  root: HTMLElement,
  layout: Layout,
  unit: number,
  ratio: number,
  opts: PanelOpts,
): Panel => {
  ensureStyles();
  const layer = document.createElement("div");
  layer.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:2;overflow:hidden;";
  root.append(layer);
  const px = (v: number) => `${v * unit}px`;
  const backing = (w: number) => Math.max(16, Math.min(MAX_BACKING, Math.round(w * unit * ratio)));
  const canvasAt = (x: number, y: number, w: number, h: number): Canvas => {
    const el = document.createElement("canvas");
    const bw = backing(w);
    el.width = bw;
    el.height = Math.max(8, Math.round((bw * h) / Math.max(1, w)));
    el.style.cssText = `position:absolute;left:${px(x)};top:${px(y)};width:${px(w)};height:${px(h)};`;
    layer.append(el);
    return { el, g: el.getContext("2d"), key: "" };
  };
  const circleCanvas = (c: Circle) => canvasAt(c.x - c.r, c.y - c.r, 2 * c.r, 2 * c.r);

  const stages: StageEls[] = layout.stages.map((st: StageLayout, si) => {
    for (const r of st.consoles) {
      const el = document.createElement("div");
      el.style.cssText =
        `position:absolute;left:${px(r.x)};top:${px(r.y)};width:${px(r.width)};height:${px(r.height)};` +
        `border-radius:${px(40)};background:rgba(8,11,24,0.8);box-sizing:border-box;` +
        `border:${Math.max(1, 3 * unit)}px solid rgba(120,150,215,0.18);box-shadow:0 0 ${px(40)} rgba(0,0,0,0.5);`;
      layer.append(el);
    }
    const lever = st.lever
      ? canvasAt(
          st.lever.x0 - st.lever.h / 2,
          st.lever.y - st.lever.h / 2,
          st.lever.x1 - st.lever.x0 + st.lever.h,
          st.lever.h,
        )
      : null;
    const dials = st.dials.map(circleCanvas);
    const orients = st.orients.map((o) => {
      const el = document.createElement("div");
      el.textContent = o.label;
      const fs = Math.min(
        o.rect.height * 0.36,
        (o.rect.width / Math.max(8, o.label.length)) * 1.55,
      );
      el.style.cssText =
        `position:absolute;left:${px(o.rect.x)};top:${px(o.rect.y)};width:${px(o.rect.width)};height:${px(o.rect.height)};` +
        `display:flex;align-items:center;justify-content:center;box-sizing:border-box;border-radius:${px(o.rect.height / 2)};` +
        `font:700 ${px(fs)} ${FONT};white-space:nowrap;transition:background 0.2s,color 0.2s;`;
      layer.append(el);
      return { el, k: o.k, key: "" };
    });
    const shapes = st.shapes.map((s) => canvasAt(s.rect.x, s.rect.y, s.rect.width, s.rect.height));
    const gauge = st.gauge
      ? canvasAt(st.gauge.x - 40, st.gauge.y - 70, st.gauge.width + 80, st.gauge.height + 110)
      : null;
    const caption = document.createElement("div");
    const cap = st.caption;
    caption.style.cssText =
      `position:absolute;left:${px(cap.x - cap.width / 2)};top:${px(cap.y - cap.size * 0.7)};width:${px(cap.width)};` +
      `text-align:center;font:700 ${px(cap.size)} ${FONT};color:#eef3ff;opacity:0;transition:opacity 0.5s;` +
      `text-shadow:0 0 ${px(18)} rgba(0,0,0,0.9);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
    layer.append(caption);
    for (const lg of opts.legends[si] ?? []) {
      const el = document.createElement("div");
      const size = st.legend.size;
      el.style.cssText =
        `position:absolute;left:${px(lg.x)};top:${px(lg.y)};display:flex;gap:${px(size * 0.9)};` +
        `font:600 ${px(size)} ${FONT};color:#d7e0f5;`;
      for (const item of lg.items) {
        const chip = document.createElement("span");
        chip.style.cssText = `display:inline-flex;align-items:center;gap:${px(size * 0.35)};`;
        const sw = document.createElement("span");
        sw.style.cssText = `display:inline-block;width:${px(size * 0.9)};height:${px(size * 0.32)};border-radius:${px(size)};background:${item.color};box-shadow:0 0 ${px(10)} ${item.color};`;
        const tx = document.createElement("span");
        tx.textContent = item.label;
        chip.append(sw, tx);
        el.append(chip);
      }
      layer.append(el);
    }
    const handSize = (st.dials[0]?.r ?? 110) * 1.1;
    const hand = document.createElement("div");
    hand.innerHTML = iconSvg("hand");
    hand.style.cssText =
      `position:absolute;left:0;top:0;width:${px(handSize)};height:${px(handSize)};color:#ffffff;opacity:0;` +
      `transition:opacity 0.3s;z-index:3;filter:drop-shadow(0 0 ${px(8)} rgba(0,0,0,0.9));will-change:transform;`;
    layer.append(hand);
    return { lever, dials, orients, shapes, gauge, caption, captionText: null, hand, handSize };
  });

  const drawLever = (c: Canvas, look: StageLook) => {
    const g = c.g;
    if (!g) return;
    const W = c.el.width;
    const H = c.el.height;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    const r = H / 2;
    const x0 = r;
    const x1 = W - r;
    const th = H * 0.34;
    g.fillStyle = "rgba(20,28,52,0.95)";
    roundRect(g, x0 - th / 2, r - th / 2, x1 - x0 + th, th, th / 2);
    g.fill();
    g.strokeStyle = "rgba(150,175,230,0.35)";
    g.lineWidth = Math.max(1, H * 0.02);
    g.stroke();
    const at = (t: number) => x0 + ((Math.max(-1, Math.min(1, t)) + 1) / 2) * (x1 - x0);
    if (look.extent) {
      const a = at(look.extent.lo);
      const b = at(look.extent.hi);
      g.fillStyle = look.color;
      g.globalAlpha = 0.35;
      roundRect(g, Math.min(a, b) - th / 2, r - th / 2, Math.abs(b - a) + th, th, th / 2);
      g.fill();
      g.globalAlpha = 1;
    }
    g.fillStyle = "rgba(220,230,255,0.55)";
    g.font = `600 ${Math.round(H * 0.2)}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("Push it through", (x0 + x1) / 2, r + H * 0.33);
    if (look.dim === 4 && opts.axes) {
      g.fillStyle = AXIS_COLORS[3];
      g.font = `700 ${Math.round(H * 0.26)}px ${FONT}`;
      g.fillText("w", x1 + r * 0.05, r - H * 0.33);
    }
    const kx = at(look.lever);
    g.shadowColor = look.color;
    g.shadowBlur = H * 0.25;
    g.fillStyle = look.color;
    g.beginPath();
    g.arc(kx, r, H * (look.leverHeld ? 0.4 : 0.36), 0, TAU);
    g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = "#ffffff";
    g.lineWidth = H * 0.05;
    g.stroke();
  };

  const drawDial = (c: Canvas, st: StageLayout, i: number, look: StageLook) => {
    const g = c.g;
    if (!g) return;
    const S = c.el.width;
    const s = S / 2;
    const spec = st.dials[i];
    if (!spec) return;
    const [pa, pb] = spec.plane;
    const ca = AXIS_COLORS[pa] ?? "#fff";
    const cb = AXIS_COLORS[pb] ?? "#fff";
    const held = look.dialHeld[i] ?? false;
    const angle = look.dials[i] ?? 0;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, S, S);
    g.setTransform(s, 0, 0, s, s, s);
    const bg = g.createRadialGradient(0, -0.3, 0.1, 0, 0, 1);
    bg.addColorStop(0, held ? "#242e4c" : "#1a2137");
    bg.addColorStop(1, "#0a0e1a");
    g.fillStyle = bg;
    g.beginPath();
    g.arc(0, 0, 0.98, 0, TAU);
    g.fill();
    g.lineWidth = held ? 0.05 : 0.03;
    g.strokeStyle = held ? cb : "rgba(255,255,255,0.18)";
    g.beginPath();
    g.arc(0, 0, 0.95, 0, TAU);
    g.stroke();
    // Ticks round the rim, so a turn shows.
    g.strokeStyle = "rgba(255,255,255,0.28)";
    g.lineWidth = 0.025;
    for (let k = 0; k < 12; k++) {
      const a = angle + (k / 12) * TAU;
      g.beginPath();
      g.moveTo(Math.cos(a) * 0.74, Math.sin(a) * 0.74);
      g.lineTo(Math.cos(a) * 0.86, Math.sin(a) * 0.86);
      g.stroke();
    }
    // The two axes it turns between, and the turn between them.
    const arrow = (dx: number, dy: number, color: string, label: string) => {
      g.strokeStyle = color;
      g.fillStyle = color;
      g.lineWidth = 0.075;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(dx * 0.42, dy * 0.42);
      g.stroke();
      const hx = dx * 0.52;
      const hy = dy * 0.52;
      g.beginPath();
      g.moveTo(hx, hy);
      g.lineTo(hx - dx * 0.13 - dy * 0.08, hy - dy * 0.13 + dx * 0.08);
      g.lineTo(hx - dx * 0.13 + dy * 0.08, hy - dy * 0.13 - dx * 0.08);
      g.closePath();
      g.fill();
      if (opts.axes) {
        g.font = `700 0.26px ${FONT}`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(label, dx * 0.5 + dy * 0.2 + (dx ? 0 : 0.02), dy * 0.5 - dx * 0.2);
      }
    };
    arrow(1, 0, ca, AXIS_NAMES[pa] ?? "");
    arrow(0, -1, cb, AXIS_NAMES[pb] ?? "");
    g.strokeStyle = "rgba(255,255,255,0.7)";
    g.lineWidth = 0.05;
    g.beginPath();
    g.arc(0, 0, 0.32, -Math.PI * 0.42, -Math.PI * 0.08);
    g.stroke();
    // The knob: where the dial has been turned to.
    const kx = Math.cos(angle - Math.PI / 2) * 0.8;
    const ky = Math.sin(angle - Math.PI / 2) * 0.8;
    g.fillStyle = cb;
    g.strokeStyle = "#0a0e1a";
    g.lineWidth = 0.035;
    g.beginPath();
    g.arc(kx, ky, held ? 0.16 : 0.14, 0, TAU);
    g.fill();
    g.stroke();
  };

  const drawShape = (c: Canvas, family: number, on: boolean, color: string) => {
    const g = c.g;
    if (!g) return;
    const W = c.el.width;
    const H = c.el.height;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    const r = Math.min(W, H) * 0.24;
    roundRect(g, W * 0.03, H * 0.03, W * 0.94, H * 0.94, r);
    g.fillStyle = on ? color : "rgba(14,19,36,0.95)";
    g.fill();
    g.strokeStyle = on ? "#ffffff" : "rgba(150,175,230,0.4)";
    g.lineWidth = Math.max(1, W * 0.03);
    g.stroke();
    const s = Math.min(W, H) / 100;
    g.setTransform(s * 0.85, 0, 0, s * 0.85, (W - 85 * s) / 2, (H - 85 * s) / 2);
    drawFamily(g, family, on ? "#05070d" : "#dfe7ff");
  };

  const drawGauge = (c: Canvas, st: StageLayout, look: StageLook) => {
    const g = c.g;
    const gr = st.gauge;
    if (!g || !gr || !look.gauge) return;
    const W = c.el.width;
    const H = c.el.height;
    const k = W / (gr.width + 80);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    g.setTransform(k, 0, 0, k, 40 * k, 70 * k);
    const w = gr.width;
    const h = gr.height;
    const yOf = (v: number) => h * (1 - (v + REACH) / (2 * REACH));
    g.fillStyle = "rgba(20,28,52,0.9)";
    roundRect(g, 0, 0, w, h, w / 2);
    g.fill();
    const { lo, hi, cut } = look.gauge;
    const grad = g.createLinearGradient(0, yOf(-1), 0, yOf(1));
    grad.addColorStop(0, look.dim === 4 ? FAR_COLOR : SHEET_COLOR);
    grad.addColorStop(1, look.dim === 4 ? NEAR_COLOR : SHEET_COLOR);
    g.fillStyle = grad;
    g.globalAlpha = 0.75;
    roundRect(g, w * 0.15, yOf(hi), w * 0.7, Math.max(2, yOf(lo) - yOf(hi)), w * 0.35);
    g.fill();
    g.globalAlpha = 1;
    const y = yOf(cut);
    g.shadowColor = look.color;
    g.shadowBlur = 16;
    g.fillStyle = look.color;
    roundRect(g, -14, y - 7, w + 28, 14, 7);
    g.fill();
    g.shadowBlur = 0;
    if (opts.axes) {
      g.fillStyle = AXIS_COLORS[look.dim === 4 ? 3 : 1];
      g.font = `700 ${Math.round(w * 1.4)}px ${FONT}`;
      g.textAlign = "center";
      g.textBaseline = "bottom";
      g.fillText(look.dim === 4 ? "w" : "y", w / 2, -10);
    }
  };

  return {
    update(looks) {
      looks.forEach((look, si) => {
        const els = stages[si];
        const st = layout.stages[si];
        if (!els || !st) return;
        if (els.lever) {
          const ex = look.extent;
          const key = `${look.lever.toFixed(3)}|${look.leverHeld}|${ex ? `${ex.lo.toFixed(3)},${ex.hi.toFixed(3)}` : "-"}|${look.color}`;
          if (key !== els.lever.key) {
            els.lever.key = key;
            drawLever(els.lever, look);
          }
        }
        els.dials.forEach((c, i) => {
          const key = `${(look.dials[i] ?? 0).toFixed(3)}|${look.dialHeld[i] ?? false}`;
          if (key === c.key) return;
          c.key = key;
          drawDial(c, st, i, look);
        });
        for (const o of els.orients) {
          const on = look.active === o.k;
          // A ball looks the same whichever way it goes first.
          const round = look.family === 3;
          const key = `${on}|${round}|${look.color}`;
          if (key === o.key) continue;
          o.key = key;
          o.el.style.opacity = round ? "0.35" : "1";
          o.el.style.background = on ? look.color : "rgba(14,19,36,0.95)";
          o.el.style.color = on ? "#05070d" : "#dfe7ff";
          o.el.style.border = `${Math.max(1, 3 * unit)}px solid ${on ? "#ffffff" : "rgba(150,175,230,0.4)"}`;
        }
        els.shapes.forEach((c, i) => {
          const fam = st.shapes[i]?.family ?? i;
          const on = fam === look.family;
          const key = `${on}|${look.color}`;
          if (key === c.key) return;
          c.key = key;
          drawShape(c, fam, on, look.color);
        });
        if (els.gauge && look.gauge) {
          const gg = look.gauge;
          const key = `${gg.lo.toFixed(3)}|${gg.hi.toFixed(3)}|${gg.cut.toFixed(3)}|${look.color}`;
          if (key !== els.gauge.key) {
            els.gauge.key = key;
            drawGauge(els.gauge, st, look);
          }
        }
        if (look.caption !== els.captionText) {
          els.captionText = look.caption;
          if (look.caption) els.caption.textContent = look.caption;
          els.caption.style.opacity = look.caption ? "1" : "0";
        }
        const gh = look.ghost;
        if (gh) {
          const hs = els.handSize;
          // The hand icon's fingertip is at (41 %, 3 %) of its box.
          els.hand.style.transform = `translate(${px(gh.x - hs * 0.41)},${px(gh.y - hs * 0.03)})`;
          if (els.hand.style.opacity !== "0.65") els.hand.style.opacity = "0.65";
        } else if (els.hand.style.opacity !== "0") els.hand.style.opacity = "0";
      });
    },
    dispose() {
      layer.remove();
    },
  };
};
