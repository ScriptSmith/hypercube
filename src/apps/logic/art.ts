/**
 * Our own drawings of the pieces, centred on the origin in venue px. The renderer caches the
 * still parts as sprites and draws the moving parts (a lamp's glow, a fan's blades, a bell's
 * swing) every frame.
 */
import { PALETTE, withAlpha } from "../../core/ui/palette";
import type { PieceKind } from "./circuit";

type G = CanvasRenderingContext2D;
const TAU = Math.PI * 2;

/** Switch and button caps: the palette's player colours, so a card's inputs match. */
export const SOURCE_COLORS = PALETTE.players;
export const LAMP_COLORS = [
  "#ffd84a",
  "#6cf7f8",
  "#fb5c99",
  "#89da9b",
  "#f29b1d",
  "#ad83d1",
  "#6fa4fc",
  "#ff7a6d",
];
/** Posts and the machine inputs they feed. */
export const POST_COLORS = ["#f29b1d", "#89da9b", "#ad83d1"];
export const LIVE = "#ffd84a";
export const DEAD = "#46506a";
export const BOARD = "#0d1424";
export const BODY = "#1c2840";
export const EDGE = "#5a6a8c";

export const colorOf = (list: readonly string[], i: number) => list[i % list.length] ?? list[0]!;

export const roundRect = (g: G, x: number, y: number, w: number, h: number, r: number) => {
  g.beginPath();
  g.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
};

/** The base plate every child piece sits on. */
const plate = (g: G, w: number, color: string) => {
  const s = w * 0.92;
  roundRect(g, -s / 2, -s / 2, s, s, w * 0.16);
  g.fillStyle = BODY;
  g.fill();
  g.lineWidth = w * 0.035;
  g.strokeStyle = withAlpha(color, 0.75);
  g.stroke();
};

export const drawSwitch = (g: G, w: number, on: boolean, color: string) => {
  plate(g, w, color);
  // The slot the lever moves in.
  roundRect(g, -w * 0.09, -w * 0.32, w * 0.18, w * 0.64, w * 0.09);
  g.fillStyle = "#070b14";
  g.fill();
  // Lever from the pivot to a big knob, up for on.
  const dir = on ? -1 : 1;
  g.strokeStyle = "#c6cedd";
  g.lineCap = "round";
  g.lineWidth = w * 0.09;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(0, dir * w * 0.26);
  g.stroke();
  g.beginPath();
  g.arc(0, dir * w * 0.27, w * 0.15, 0, TAU);
  g.fillStyle = color;
  g.fill();
  g.lineWidth = w * 0.025;
  g.strokeStyle = "rgba(0,0,0,0.45)";
  g.stroke();
  g.beginPath();
  g.arc(0, 0, w * 0.07, 0, TAU);
  g.fillStyle = "#8a94a8";
  g.fill();
  // Small marks: a bar for on at the top, a ring for off at the bottom.
  g.fillStyle = on ? color : "#3a4560";
  roundRect(g, -w * 0.32, -w * 0.36, w * 0.12, w * 0.04, w * 0.02);
  g.fill();
  g.strokeStyle = on ? "#3a4560" : "#8a94a8";
  g.lineWidth = w * 0.02;
  g.beginPath();
  g.arc(-w * 0.26, w * 0.34, w * 0.035, 0, TAU);
  g.stroke();
};

export const drawButton = (g: G, w: number, down: boolean, color: string) => {
  plate(g, w, color);
  g.beginPath();
  g.arc(0, 0, w * 0.33, 0, TAU);
  g.fillStyle = "#070b14";
  g.fill();
  const r = down ? w * 0.24 : w * 0.28;
  const dy = down ? w * 0.02 : -w * 0.03;
  g.beginPath();
  g.arc(0, dy, r, 0, TAU);
  g.fillStyle = down ? color : withAlpha(color, 0.8);
  g.fill();
  g.beginPath();
  g.arc(-r * 0.3, dy - r * 0.3, r * 0.35, 0, TAU);
  g.fillStyle = "rgba(255,255,255,0.28)";
  g.fill();
};

export const drawLampBase = (g: G, w: number, color: string) => {
  plate(g, w, color);
  // Screw base and the glass.
  g.fillStyle = "#8a94a8";
  roundRect(g, -w * 0.13, w * 0.12, w * 0.26, w * 0.2, w * 0.04);
  g.fill();
  g.fillStyle = "#5a647a";
  for (let k = 0; k < 3; k++) g.fillRect(-w * 0.13, w * (0.15 + k * 0.055), w * 0.26, w * 0.02);
  g.beginPath();
  g.arc(0, -w * 0.06, w * 0.24, 0, TAU);
  g.fillStyle = withAlpha(color, 0.18);
  g.fill();
  g.lineWidth = w * 0.025;
  g.strokeStyle = withAlpha(color, 0.6);
  g.stroke();
};

/** The lit part of a lamp, drawn every frame with `glow` from 0 to 1. */
export const drawLampGlow = (g: G, w: number, color: string, glow: number) => {
  if (glow > 0.01) {
    const halo = g.createRadialGradient(0, -w * 0.06, w * 0.05, 0, -w * 0.06, w * 0.62);
    halo.addColorStop(0, withAlpha(color, 0.75 * glow));
    halo.addColorStop(1, withAlpha(color, 0));
    g.fillStyle = halo;
    g.beginPath();
    g.arc(0, -w * 0.06, w * 0.62, 0, TAU);
    g.fill();
    g.beginPath();
    g.arc(0, -w * 0.06, w * 0.22, 0, TAU);
    g.fillStyle = withAlpha(color, 0.25 + 0.75 * glow);
    g.fill();
  }
  // Filament.
  g.strokeStyle = glow > 0.5 ? "#fffbe0" : "#6a7288";
  g.lineWidth = w * 0.02;
  g.beginPath();
  g.moveTo(-w * 0.07, w * 0.1);
  g.lineTo(-w * 0.05, -w * 0.08);
  g.lineTo(0, -w * 0.02);
  g.lineTo(w * 0.05, -w * 0.08);
  g.lineTo(w * 0.07, w * 0.1);
  g.stroke();
};

export const drawFanBase = (g: G, w: number, color: string) => {
  plate(g, w, color);
  g.beginPath();
  g.arc(0, 0, w * 0.36, 0, TAU);
  g.fillStyle = "#070b14";
  g.fill();
  g.lineWidth = w * 0.03;
  g.strokeStyle = "#5a647a";
  g.stroke();
};

export const drawFanBlades = (g: G, w: number, color: string, angle: number) => {
  g.save();
  g.rotate(angle);
  g.fillStyle = color;
  for (let k = 0; k < 3; k++) {
    g.rotate(TAU / 3);
    g.beginPath();
    g.ellipse(0, -w * 0.17, w * 0.085, w * 0.17, 0.35, 0, TAU);
    g.fill();
  }
  g.restore();
  g.beginPath();
  g.arc(0, 0, w * 0.06, 0, TAU);
  g.fillStyle = "#c6cedd";
  g.fill();
  // Guard.
  g.strokeStyle = "rgba(160,170,190,0.55)";
  g.lineWidth = w * 0.012;
  for (const r of [0.2, 0.33]) {
    g.beginPath();
    g.arc(0, 0, w * r, 0, TAU);
    g.stroke();
  }
};

export const drawBellBase = (g: G, w: number, color: string) => {
  plate(g, w, color);
  g.fillStyle = "#5a647a";
  g.fillRect(-w * 0.04, -w * 0.38, w * 0.08, w * 0.08);
};

/** The bell itself, swinging by `swing` radians about its hanger. */
export const drawBell = (g: G, w: number, color: string, swing: number, live: number) => {
  g.save();
  g.translate(0, -w * 0.3);
  g.rotate(swing);
  g.beginPath();
  g.moveTo(-w * 0.08, 0);
  g.quadraticCurveTo(-w * 0.12, w * 0.04, -w * 0.15, w * 0.3);
  g.quadraticCurveTo(-w * 0.2, w * 0.48, -w * 0.3, w * 0.52);
  g.lineTo(w * 0.3, w * 0.52);
  g.quadraticCurveTo(w * 0.2, w * 0.48, w * 0.15, w * 0.3);
  g.quadraticCurveTo(w * 0.12, w * 0.04, w * 0.08, 0);
  g.closePath();
  const fill = g.createLinearGradient(-w * 0.3, 0, w * 0.3, 0);
  fill.addColorStop(0, "#b8862a");
  fill.addColorStop(0.45, live > 0.5 ? "#ffe08a" : "#e0b24a");
  fill.addColorStop(1, "#9a6e1e");
  g.fillStyle = fill;
  g.fill();
  g.beginPath();
  g.arc(Math.sin(-swing * 2) * w * 0.06, w * 0.56, w * 0.06, 0, TAU);
  g.fillStyle = "#6a4a14";
  g.fill();
  g.restore();
  if (live > 0.3) {
    // Motion marks either side instead of sound.
    g.strokeStyle = withAlpha(color, 0.8 * live);
    g.lineWidth = w * 0.025;
    g.lineCap = "round";
    for (const side of [-1, 1]) {
      for (const r of [0.36, 0.44]) {
        g.beginPath();
        g.arc(
          0,
          w * 0.02,
          w * r,
          side < 0 ? Math.PI * 0.85 : -Math.PI * 0.15,
          side < 0 ? Math.PI * 1.15 : Math.PI * 0.15,
        );
        g.stroke();
      }
    }
  }
};

const GATE_NAMES: Partial<Record<PieceKind, string>> = {
  not: "NOT",
  and: "AND",
  or: "OR",
  xor: "XOR",
};

/** Gate bodies in their usual shapes, pointing right, with the name written small. */
export const drawGate = (g: G, kind: PieceKind, w: number, h: number) => {
  const bw = w * 0.78;
  const bh = h * 0.8;
  const x0 = -bw / 2;
  const x1 = bw / 2;
  const y0 = -bh / 2;
  const y1 = bh / 2;
  // Leads from the body to the ports.
  g.strokeStyle = EDGE;
  g.lineWidth = Math.max(4, h * 0.035);
  g.lineCap = "round";
  g.beginPath();
  if (kind === "not") {
    g.moveTo(-w * 0.45, 0);
    g.lineTo(x0 + 6, 0);
  } else if (kind !== "blinker") {
    for (const y of [-h * 0.25, h * 0.25]) {
      g.moveTo(-w * 0.45, y);
      g.lineTo(x0 + (kind === "and" ? 6 : bw * 0.14), y);
    }
  }
  g.moveTo(x1 - 6, 0);
  g.lineTo(w * 0.45, 0);
  g.stroke();

  g.beginPath();
  if (kind === "and") {
    g.moveTo(x0, y0);
    g.lineTo(0, y0);
    g.arc(0, 0, bh / 2, -Math.PI / 2, Math.PI / 2);
    g.lineTo(x0, y1);
    g.closePath();
  } else if (kind === "or" || kind === "xor") {
    const back = kind === "xor" ? bw * 0.08 : 0;
    g.moveTo(x0 + back, y0);
    g.quadraticCurveTo(x1 * 0.35, y0, x1, 0);
    g.quadraticCurveTo(x1 * 0.35, y1, x0 + back, y1);
    g.quadraticCurveTo(x0 + back + bw * 0.22, 0, x0 + back, y0);
    g.closePath();
  } else if (kind === "not") {
    g.moveTo(x0, y0);
    g.lineTo(x1 - bh * 0.22, 0);
    g.lineTo(x0, y1);
    g.closePath();
  } else {
    g.roundRect(x0, y0, bw, bh, bh * 0.18);
  }
  g.fillStyle = BODY;
  g.fill();
  g.lineWidth = Math.max(4, h * 0.04);
  g.strokeStyle = "#8fb0ff";
  g.lineJoin = "round";
  g.stroke();
  if (kind === "xor") {
    g.beginPath();
    g.moveTo(x0 - bw * 0.02, y0);
    g.quadraticCurveTo(x0 - bw * 0.02 + bw * 0.22, 0, x0 - bw * 0.02, y1);
    g.stroke();
  }
  if (kind === "not") {
    g.beginPath();
    g.arc(x1 - bh * 0.11, 0, bh * 0.11, 0, TAU);
    g.fillStyle = BODY;
    g.fill();
    g.stroke();
  }
  if (kind === "blinker") {
    // A square wave across the body.
    g.strokeStyle = "#ffd84a";
    g.lineWidth = Math.max(4, h * 0.05);
    g.beginPath();
    const u = bw * 0.14;
    g.moveTo(x0 + bw * 0.12, h * 0.12);
    g.lineTo(x0 + bw * 0.12 + u, h * 0.12);
    g.lineTo(x0 + bw * 0.12 + u, -h * 0.12);
    g.lineTo(x0 + bw * 0.12 + 2 * u, -h * 0.12);
    g.lineTo(x0 + bw * 0.12 + 2 * u, h * 0.12);
    g.lineTo(x0 + bw * 0.12 + 3 * u, h * 0.12);
    g.lineTo(x0 + bw * 0.12 + 3 * u, -h * 0.12);
    g.lineTo(x0 + bw * 0.12 + 4 * u, -h * 0.12);
    g.stroke();
    return;
  }
  const name = GATE_NAMES[kind];
  if (name) {
    g.fillStyle = "#c6d4f5";
    g.font = `800 ${Math.round(h * 0.2)}px system-ui, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const cx = kind === "and" ? -bw * 0.08 : kind === "not" ? -bw * 0.16 : -bw * 0.02;
    g.fillText(name, cx, 0);
  }
};

/** A post: a terminal block in its colour with a lightning mark. */
export const drawPost = (g: G, w: number, h: number, color: string, live: number) => {
  roundRect(g, -w / 2, -h / 2, w, h, w * 0.2);
  g.fillStyle = BODY;
  g.fill();
  g.lineWidth = Math.max(4, w * 0.07);
  g.strokeStyle = withAlpha(color, 0.5 + 0.5 * live);
  g.stroke();
  g.fillStyle = live > 0.5 ? color : withAlpha(color, 0.45);
  g.beginPath();
  g.moveTo(w * 0.06, -h * 0.32);
  g.lineTo(-w * 0.16, h * 0.04);
  g.lineTo(0, h * 0.04);
  g.lineTo(-w * 0.06, h * 0.32);
  g.lineTo(w * 0.16, -h * 0.04);
  g.lineTo(0, -h * 0.04);
  g.closePath();
  g.fill();
};

/** A ghost hand pointing up, its fingertip at the origin, `s` tall. */
export const drawHand = (g: G, s: number, alpha: number) => {
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = "rgba(255,255,255,0.18)";
  g.beginPath();
  g.arc(0, 0, s * 0.16, 0, TAU);
  g.fill();
  g.fillStyle = "#eef2fa";
  g.strokeStyle = "#1a2238";
  g.lineWidth = s * 0.035;
  g.lineJoin = "round";
  // Thumb, then the palm with three folded fingers, then the pointing finger on top.
  g.beginPath();
  g.ellipse(-s * 0.17, s * 0.6, s * 0.075, s * 0.17, -0.55, 0, TAU);
  g.fill();
  g.stroke();
  g.beginPath();
  g.roundRect(-s * 0.13, s * 0.4, s * 0.48, s * 0.46, s * 0.14);
  g.fill();
  g.stroke();
  for (const [x, y] of [
    [0.14, 0.45],
    [0.23, 0.47],
    [0.31, 0.5],
  ] as const) {
    g.beginPath();
    g.ellipse(x * s, y * s, s * 0.055, s * 0.08, 0, 0, TAU);
    g.fill();
    g.stroke();
  }
  g.beginPath();
  g.roundRect(-s * 0.075, 0, s * 0.15, s * 0.58, s * 0.075);
  g.fill();
  g.stroke();
  g.restore();
};

/** Hue for a piece: switches and buttons by slot, lamps and the rest by their own list. */
export const pieceColor = (kind: PieceKind, hue: number) =>
  kind === "switch" || kind === "button"
    ? colorOf(SOURCE_COLORS, hue)
    : kind === "lamp" || kind === "fan" || kind === "bell"
      ? colorOf(LAMP_COLORS, hue)
      : "#8fb0ff";
