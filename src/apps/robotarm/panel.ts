/**
 * The controls' DOM: a dark console behind each group, a canvas per dial and per grip button,
 * and ghost hands for the demonstration. None of it takes pointer events: index.ts hit-tests
 * touches itself (layout.ts, controls.ts), so fingers and bots go through the same path.
 *
 * A dial shows its joint's range as a coloured track with a stop at each end, a knob where the
 * dial is set and a white pointer where the joint really is (it lags while the joint catches
 * up), and in the middle a small drawing of the arm with that joint's part in its colour. A
 * canvas is redrawn only when what it shows changes.
 */
import { ensureStyles, iconSvg } from "../../core/ui";
import { JOINTS } from "./kinematics";
import type { Circle, Layout } from "./layout";
import { GRIP_COLOR, JOINT_COLORS, PIECE_COLORS } from "./palette";

export interface DialLook {
  target: number;
  actual: number;
  held: boolean;
  /** Seconds since the clamp stopped it, and since it hit a limit. */
  blocked: number;
  limited: number;
}

export interface GripLook {
  closed: boolean;
  /** Half the finger gap, 0 to 1 of fully open. */
  open: number;
  /** Colour index and kind of the held piece. */
  holding: { color: number; kind: "block" | "ball" } | null;
  /** Colour index of a piece the jaws would grab now. */
  ready: number | null;
}

export interface CellLook {
  dials: DialLook[];
  grip: GripLook;
  /** Ghost fingers, venue px. */
  ghosts: readonly { x: number; y: number }[];
  /** Seconds since someone touched the view instead of a control: the dials ripple. */
  hint: number;
}

export interface Panel {
  update(looks: readonly CellLook[], time: number): void;
  dispose(): void;
}

const TAU = Math.PI * 2;
const MAX_GHOSTS = 4;
const MAX_BACKING = 640;
/** How long the dials ripple after a touch on the view. */
const HINT_S = 2.4;

const angleOf = (a: number) => -Math.PI / 2 + a;

/** The side-view pictogram, in a 100 x 100 box, with joint `j`'s part in `color`. */
const drawIcon = (g: CanvasRenderingContext2D, j: number, color: string) => {
  const dim = "rgba(225,232,245,0.5)";
  const line = (x0: number, y0: number, x1: number, y1: number, w: number, c: string) => {
    g.strokeStyle = c;
    g.lineWidth = w;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  };
  const dot = (x: number, y: number, r: number, c: string) => {
    g.fillStyle = c;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
  };
  const hi = (k: number) => (j === k ? color : dim);
  // Base and turret.
  g.fillStyle = dim;
  g.fillRect(18, 80, 38, 9);
  g.fillStyle = hi(0);
  g.fillRect(28, 64, 18, 16);
  // Upper arm, forearm (two halves), hand and jaws.
  line(37, 62, 43, 31, 9, hi(1));
  dot(37, 62, 6.5, hi(1));
  line(43, 31, 60, 35, 7, hi(2));
  line(60, 35, 77, 39, 6, j === 3 ? color : hi(2));
  dot(43, 31, 5.5, hi(2));
  line(77, 39, 77, 52, 5, hi(4));
  dot(77, 39, 4.5, hi(4));
  const jaw = j === 5 || j === 4 ? color : dim;
  line(70, 53, 84, 53, 4, jaw);
  line(71, 53, 71, 63, 3.5, jaw);
  line(83, 53, 83, 63, 3.5, jaw);

  // A two-headed arrow showing the way the joint turns.
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = 3.5;
  g.lineCap = "round";
  const head = (x: number, y: number, dir: number) => {
    const s = 6;
    g.beginPath();
    g.moveTo(x + Math.cos(dir) * s, y + Math.sin(dir) * s);
    g.lineTo(x + Math.cos(dir + 2.4) * s, y + Math.sin(dir + 2.4) * s);
    g.lineTo(x + Math.cos(dir - 2.4) * s, y + Math.sin(dir - 2.4) * s);
    g.closePath();
    g.fill();
  };
  const arc = (cx: number, cy: number, r: number, a0: number, a1: number) => {
    g.beginPath();
    g.arc(cx, cy, r, a0, a1);
    g.stroke();
    head(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, a1 + Math.PI / 2);
    head(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, a0 - Math.PI / 2);
  };
  const ellipse = (cx: number, cy: number, rx: number, ry: number, rot: number) => {
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, rot, 0.25 * Math.PI, 1.85 * Math.PI);
    g.stroke();
    const a = 1.85 * Math.PI;
    const px = cx + Math.cos(rot) * Math.cos(a) * rx - Math.sin(rot) * Math.sin(a) * ry;
    const py = cy + Math.sin(rot) * Math.cos(a) * rx + Math.cos(rot) * Math.sin(a) * ry;
    head(px, py, rot + a + Math.PI / 2);
  };
  switch (j) {
    case 0:
      ellipse(37, 72, 25, 7, 0);
      break;
    case 1:
      arc(37, 62, 17, Math.PI * 1.05, Math.PI * 1.45);
      break;
    case 2:
      arc(43, 31, 15, Math.PI * 1.2, Math.PI * 1.75);
      break;
    case 3:
      ellipse(64, 36, 5, 13, 0.23);
      break;
    case 4:
      arc(77, 39, 14, -Math.PI * 0.2, Math.PI * 0.2);
      break;
    default:
      ellipse(77, 66, 14, 4.5, 0);
      break;
  }
};

const roundRect = (
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) => {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
};

interface DialEl {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D | null;
  joint: number;
  icon: HTMLCanvasElement;
  key: string;
}

interface GripEl {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D | null;
  key: string;
}

const drawDial = (d: DialEl, look: DialLook, time: number) => {
  const g = d.g;
  if (!g) return;
  const size = d.canvas.width;
  const s = size / 2;
  const j = JOINTS[d.joint]!;
  const color = JOINT_COLORS[d.joint] ?? "#ffffff";
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, size, size);
  g.setTransform(s, 0, 0, s, s, s);
  // Disc.
  const bg = g.createRadialGradient(0, -0.3, 0.1, 0, 0, 1);
  bg.addColorStop(0, look.held ? "#222c47" : "#1a2135");
  bg.addColorStop(1, "#0a0e1a");
  g.fillStyle = bg;
  g.beginPath();
  g.arc(0, 0, 0.98, 0, TAU);
  g.fill();
  g.lineWidth = look.held ? 0.05 : 0.03;
  g.strokeStyle = look.held ? color : "rgba(255,255,255,0.16)";
  g.beginPath();
  g.arc(0, 0, look.held ? 0.95 : 0.965, 0, TAU);
  g.stroke();
  // Track over the joint's range, with ticks and stops.
  const a0 = angleOf(j.min);
  const a1 = angleOf(j.max);
  g.lineCap = "butt";
  g.lineWidth = 0.13;
  g.strokeStyle = color;
  g.globalAlpha = 0.38;
  g.beginPath();
  g.arc(0, 0, 0.8, a0, a1);
  g.stroke();
  g.globalAlpha = 1;
  g.lineWidth = 0.025;
  g.strokeStyle = "rgba(255,255,255,0.3)";
  const step = Math.PI / 6;
  for (let a = Math.ceil(j.min / step) * step; a <= j.max + 1e-9; a += step) {
    const t = angleOf(a);
    g.beginPath();
    g.moveTo(Math.cos(t) * 0.72, Math.sin(t) * 0.72);
    g.lineTo(Math.cos(t) * 0.88, Math.sin(t) * 0.88);
    g.stroke();
  }
  const flashLimit = look.limited < 0.5;
  g.lineWidth = 0.07;
  g.lineCap = "round";
  g.strokeStyle = flashLimit ? "#ffffff" : color;
  for (const t of [a0, a1]) {
    g.beginPath();
    g.moveTo(Math.cos(t) * 0.68, Math.sin(t) * 0.68);
    g.lineTo(Math.cos(t) * 0.93, Math.sin(t) * 0.93);
    g.stroke();
  }
  // How far the joint still has to go.
  const ta = angleOf(look.target);
  const aa = angleOf(look.actual);
  if (Math.abs(ta - aa) > 0.01) {
    g.lineCap = "butt";
    g.lineWidth = 0.13;
    g.strokeStyle = color;
    g.globalAlpha = 0.75;
    g.beginPath();
    g.arc(0, 0, 0.8, Math.min(ta, aa), Math.max(ta, aa));
    g.stroke();
    g.globalAlpha = 1;
  }
  // The icon.
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  const iw = d.icon.width;
  g.drawImage(d.icon, s - iw / 2, s - iw / 2);
  g.restore();
  // Pointer: where the joint is.
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.moveTo(Math.cos(aa) * 0.9, Math.sin(aa) * 0.9);
  g.lineTo(Math.cos(aa + 0.11) * 0.66, Math.sin(aa + 0.11) * 0.66);
  g.lineTo(Math.cos(aa - 0.11) * 0.66, Math.sin(aa - 0.11) * 0.66);
  g.closePath();
  g.fill();
  // Knob: where the dial is set. It flashes red when the arm can't go further.
  const blockedFlash = look.blocked < 0.6 && Math.floor(time * 8) % 2 === 0;
  const kx = Math.cos(ta) * 0.8;
  const ky = Math.sin(ta) * 0.8;
  g.fillStyle = blockedFlash ? "#ff5a4f" : color;
  g.strokeStyle = "#0a0e1a";
  g.lineWidth = 0.035;
  g.beginPath();
  g.arc(kx, ky, look.held ? 0.15 : 0.13, 0, TAU);
  g.fill();
  g.stroke();
};

const drawGrip = (el: GripEl, look: GripLook, time: number) => {
  const g = el.g;
  if (!g) return;
  const size = el.canvas.width;
  const s = size / 2;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, size, size);
  g.setTransform(s, 0, 0, s, s, s);
  const ready = look.ready !== null ? (PIECE_COLORS[look.ready] ?? GRIP_COLOR) : null;
  const holding = look.holding ? (PIECE_COLORS[look.holding.color] ?? GRIP_COLOR) : null;
  const accent = holding ?? ready ?? GRIP_COLOR;
  const pulse = ready ? 0.5 + 0.5 * Math.sin(time * 7) : 0;
  const bg = g.createRadialGradient(0, -0.3, 0.1, 0, 0, 1);
  bg.addColorStop(0, "#232b44");
  bg.addColorStop(1, "#0b0f1c");
  g.fillStyle = bg;
  g.beginPath();
  g.arc(0, 0, 0.97, 0, TAU);
  g.fill();
  g.strokeStyle = accent;
  g.lineWidth = 0.07 + 0.05 * pulse;
  g.globalAlpha = ready || holding ? 1 : 0.8;
  g.beginPath();
  g.arc(0, 0, 0.9, 0, TAU);
  g.stroke();
  if (ready) {
    g.globalAlpha = 0.35 * pulse;
    g.lineWidth = 0.12;
    g.beginPath();
    g.arc(0, 0, 0.78, 0, TAU);
    g.stroke();
  }
  g.globalAlpha = 1;
  // Jaws: a palm bar and two fingers, apart by how open they are.
  const open = Math.max(0, Math.min(1, look.open));
  const fx = 0.1 + 0.3 * open;
  g.fillStyle = "#e9edf5";
  roundRect(g, -0.5, -0.5, 1, 0.16, 0.06);
  g.fill();
  g.fillStyle = "#c3cad8";
  roundRect(g, -0.1, -0.68, 0.2, 0.2, 0.04);
  g.fill();
  g.fillStyle = "#e9edf5";
  for (const sx of [-1, 1]) {
    roundRect(g, sx * fx - (sx > 0 ? 0 : 0.12), -0.36, 0.12, 0.62, 0.05);
    g.fill();
  }
  if (holding && look.holding) {
    g.fillStyle = holding;
    if (look.holding.kind === "ball") {
      g.beginPath();
      g.arc(0, 0.02, 0.17, 0, TAU);
      g.fill();
    } else {
      roundRect(g, -0.16, -0.14, 0.32, 0.32, 0.05);
      g.fill();
    }
  } else if (ready) {
    // Little arrows: close now.
    g.fillStyle = ready;
    g.globalAlpha = 0.6 + 0.4 * pulse;
    for (const sx of [-1, 1]) {
      const x = sx * (fx + 0.32);
      g.beginPath();
      g.moveTo(x - sx * 0.12, 0);
      g.lineTo(x + sx * 0.06, -0.12);
      g.lineTo(x + sx * 0.06, 0.12);
      g.closePath();
      g.fill();
    }
    g.globalAlpha = 1;
  }
};

export const createPanel = (
  root: HTMLElement,
  layout: Layout,
  unit: number,
  ratio: number,
): Panel => {
  // The ripple uses the shared ui styles.
  ensureStyles();
  const layer = document.createElement("div");
  layer.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:2;overflow:hidden;";
  root.append(layer);
  const px = (v: number) => `${v * unit}px`;
  const canvasFor = (c: Circle) => {
    const el = document.createElement("canvas");
    const d = 2 * c.r * unit;
    const backing = Math.max(16, Math.min(MAX_BACKING, Math.round(d * ratio)));
    el.width = backing;
    el.height = backing;
    el.style.cssText =
      `position:absolute;left:${px(c.x - c.r)};top:${px(c.y - c.r)};` +
      `width:${px(2 * c.r)};height:${px(2 * c.r)};pointer-events:none;`;
    layer.append(el);
    return el;
  };
  const dials: DialEl[][] = [];
  const grips: GripEl[] = [];
  const ghosts: HTMLElement[][] = [];
  const ripples: HTMLElement[][] = [];
  const rippling: boolean[] = [];
  for (const cl of layout.cells) {
    for (const r of cl.consoles) {
      const el = document.createElement("div");
      el.style.cssText =
        `position:absolute;left:${px(r.x)};top:${px(r.y)};width:${px(r.width)};height:${px(r.height)};` +
        `border-radius:${px(44)};background:rgba(9,13,26,0.78);` +
        `border:${Math.max(1, 3 * unit)}px solid rgba(120,150,215,0.2);box-sizing:border-box;` +
        `box-shadow:0 0 ${px(40)} rgba(0,0,0,0.5);pointer-events:none;`;
      layer.append(el);
    }
    dials.push(
      cl.dials.map((d) => {
        const canvas = canvasFor(d);
        const iconSize = Math.round(canvas.width * 0.66);
        const icon = document.createElement("canvas");
        icon.width = iconSize;
        icon.height = iconSize;
        const ig = icon.getContext("2d");
        if (ig) {
          ig.scale(iconSize / 100, iconSize / 100);
          drawIcon(ig, d.joint, JOINT_COLORS[d.joint] ?? "#ffffff");
        }
        return { canvas, g: canvas.getContext("2d"), joint: d.joint, icon, key: "" };
      }),
    );
    const gc = canvasFor(cl.grip);
    grips.push({ canvas: gc, g: gc.getContext("2d"), key: "" });
    const hands: HTMLElement[] = [];
    const hs = (cl.dials[0]?.r ?? 120) * 1.15;
    for (let i = 0; i < MAX_GHOSTS; i++) {
      const el = document.createElement("div");
      el.innerHTML = iconSvg("hand");
      el.style.cssText =
        `position:absolute;left:0;top:0;width:${px(hs)};height:${px(hs)};color:#ffffff;opacity:0;` +
        "transition:opacity 0.3s;pointer-events:none;z-index:3;" +
        `filter:drop-shadow(0 0 ${px(8)} rgba(0,0,0,0.9));will-change:transform;`;
      el.dataset.size = String(hs);
      layer.append(el);
      hands.push(el);
    }
    ghosts.push(hands);
    ripples.push(
      cl.dials.map((d) => {
        const el = document.createElement("div");
        el.style.cssText =
          `position:absolute;left:${px(d.x - d.r)};top:${px(d.y - d.r)};width:${px(2 * d.r)};` +
          `height:${px(2 * d.r)};border-radius:50%;box-sizing:border-box;pointer-events:none;` +
          `border:${px(10)} solid ${JOINT_COLORS[d.joint] ?? "#ffffff"};opacity:0;`;
        layer.append(el);
        return el;
      }),
    );
  }

  return {
    update(looks, time) {
      looks.forEach((look, i) => {
        const ds = dials[i];
        if (ds) {
          for (const d of ds) {
            const l = look.dials[d.joint];
            if (!l) continue;
            const flash =
              (l.blocked < 0.6 ? Math.floor(time * 8) % 2 : 2) + (l.limited < 0.5 ? 10 : 0);
            const key = `${Math.round(l.target * 400)}|${Math.round(l.actual * 400)}|${l.held ? 1 : 0}|${flash}`;
            if (key === d.key) continue;
            d.key = key;
            drawDial(d, l, time);
          }
        }
        const gr = grips[i];
        if (gr) {
          const gl = look.grip;
          const key =
            `${gl.closed ? 1 : 0}|${Math.round(gl.open * 40)}|${gl.holding?.color ?? -1}|` +
            `${gl.holding?.kind ?? ""}|${gl.ready ?? -1}|${gl.ready !== null ? Math.round(time * 30) : 0}`;
          if (key !== gr.key) {
            gr.key = key;
            drawGrip(gr, gl, time);
          }
        }
        const on = look.hint < HINT_S;
        if (on !== (rippling[i] ?? false)) {
          rippling[i] = on;
          for (const el of ripples[i] ?? []) {
            el.classList.toggle("hc-anim-ripple", on);
            if (!on) el.style.opacity = "0";
            else el.style.removeProperty("opacity");
          }
        }
        const hands = ghosts[i] ?? [];
        hands.forEach((el, k) => {
          const at = look.ghosts[k];
          if (!at) {
            if (el.style.opacity !== "0") el.style.opacity = "0";
            return;
          }
          const hs = Number(el.dataset.size ?? 120);
          // The hand icon's fingertip is at (41 %, 3 %) of its box.
          el.style.transform = `translate(${px(at.x - hs * 0.41)},${px(at.y - hs * 0.03)})`;
          if (el.style.opacity !== "0.6") el.style.opacity = "0.6";
        });
      });
    },
    dispose() {
      layer.remove();
    },
  };
};
