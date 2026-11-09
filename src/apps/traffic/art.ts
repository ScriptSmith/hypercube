/**
 * Drawing helpers, all in venue px: cars seen from above, the road, roadside speed signs, the
 * ghost hand, and the adults' controls.
 */
import { FONT, iconSvg, withAlpha } from "../../core/ui";
import type { Rect } from "../../core/types";
import { type CircleShape, type ControlGroup, LANE_KERB, type LoopShape } from "./layout";
import { LIMIT_SIGNS } from "./model";

type Ctx = CanvasRenderingContext2D;

export const ASPHALT = "#1a1e27";
export const VERGE = "#0c1f19";
export const LINE = "rgba(232,236,244,0.8)";
export const SMART_GLOW = "#5cf2ff";
export const BRAKE_ON = "#ff3b4f";
const BRAKE_OFF = "#5e1621";

/** Body colours for people-driven cars (smart cars are white). Never red with yellow. */
export const BODY_COLORS = ["#6fa4fc", "#89da9b", "#ad83d1", "#f29b1d", "#fb5c99", "#57c7d4"];
export const SMART_BODY = "#eef2f8";

export const bodyColor = (id: number, smart: boolean): string =>
  smart ? SMART_BODY : BODY_COLORS[(id * 7 + 3) % BODY_COLORS.length]!;

/** A darker (`k` < 0) or lighter (`k` > 0) version of a #rrggbb colour. */
export const tint = (hex: string, k: number): string => {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k);
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
};

/**
 * One car facing right, centred on (0, 0): body, glass, roof, lights. Brake lights glow when
 * `braking`; a smart car has a light bar on its roof and a soft glow.
 */
export const drawCar = (
  g: Ctx,
  len: number,
  wid: number,
  color: string,
  smart: boolean,
  braking: boolean,
  alpha = 1,
): void => {
  const L = len;
  const Wd = wid;
  const x0 = -L / 2;
  const y0 = -Wd / 2;
  g.save();
  g.globalAlpha = alpha;
  if (smart) {
    g.shadowColor = withAlpha(SMART_GLOW, 0.75);
    g.shadowBlur = Wd * 0.55;
  }
  g.beginPath();
  g.roundRect(x0, y0, L, Wd, Wd * 0.28);
  g.fillStyle = color;
  g.fill();
  g.shadowBlur = 0;
  g.lineWidth = Math.max(2, Wd * 0.06);
  g.strokeStyle = "rgba(0,0,0,0.45)";
  g.stroke();
  // Windscreen, rear window and roof.
  g.fillStyle = "rgba(14,22,36,0.88)";
  g.beginPath();
  g.roundRect(x0 + L * 0.58, y0 + Wd * 0.14, L * 0.16, Wd * 0.72, Wd * 0.1);
  g.fill();
  g.beginPath();
  g.roundRect(x0 + L * 0.14, y0 + Wd * 0.18, L * 0.11, Wd * 0.64, Wd * 0.08);
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.16)";
  g.beginPath();
  g.roundRect(x0 + L * 0.27, y0 + Wd * 0.2, L * 0.29, Wd * 0.6, Wd * 0.1);
  g.fill();
  if (smart) {
    g.fillStyle = SMART_GLOW;
    g.beginPath();
    g.roundRect(x0 + L * 0.36, y0 + Wd * 0.3, L * 0.12, Wd * 0.4, Wd * 0.08);
    g.fill();
  }
  // Headlights.
  g.fillStyle = "rgba(240,246,255,0.9)";
  g.fillRect(x0 + L - L * 0.045, y0 + Wd * 0.1, L * 0.035, Wd * 0.2);
  g.fillRect(x0 + L - L * 0.045, y0 + Wd * 0.7, L * 0.035, Wd * 0.2);
  // Brake lights.
  if (braking) {
    g.shadowColor = BRAKE_ON;
    g.shadowBlur = Wd * 0.6;
  }
  g.fillStyle = braking ? BRAKE_ON : BRAKE_OFF;
  g.fillRect(x0 + L * 0.005, y0 + Wd * 0.08, L * 0.05, Wd * 0.24);
  g.fillRect(x0 + L * 0.005, y0 + Wd * 0.68, L * 0.05, Wd * 0.24);
  g.restore();
};

/** A round speed limit sign with `n` on it, centred at (x, y). */
export const drawSign = (g: Ctx, x: number, y: number, r: number, n: number, alpha = 1): void => {
  g.save();
  g.globalAlpha = alpha;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = "#f4f6fa";
  g.fill();
  g.lineWidth = r * 0.2;
  g.strokeStyle = "#d8283c";
  g.beginPath();
  g.arc(x, y, r * 0.88, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = "#11141b";
  g.font = `800 ${Math.round(r * 0.86)}px ${FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(String(n), x, y + r * 0.04);
  g.restore();
};

/** The road band: asphalt between two edge lines, verges above and below. */
export const paintStraightRoad = (g: Ctx, road: Rect, width: number, height: number): void => {
  g.fillStyle = VERGE;
  g.fillRect(0, road.y + road.height, width, height - road.y - road.height);
  g.fillStyle = ASPHALT;
  g.fillRect(road.x, road.y, road.width, road.height);
  const edge = Math.max(4, road.height * 0.035);
  g.fillStyle = LINE;
  g.fillRect(road.x, road.y + road.height * 0.12, road.width, edge);
  g.fillRect(road.x, road.y + road.height * 0.88 - edge, road.width, edge);
  // Kerb.
  g.fillStyle = "#2b3140";
  g.fillRect(road.x, road.y + road.height, road.width, Math.max(6, road.height * 0.06));
};

/** The loop road for a lone panel or pair. */
export const paintLoopRoad = (g: Ctx, s: LoopShape, lane: number): void => {
  const path = () => {
    g.beginPath();
    g.moveTo(s.xl, s.yc + s.r);
    g.lineTo(s.xr, s.yc + s.r);
    g.arc(s.xr, s.yc, s.r, Math.PI / 2, -Math.PI / 2, true);
    g.lineTo(s.xl, s.yc - s.r);
    g.arc(s.xl, s.yc, s.r, -Math.PI / 2, Math.PI / 2, true);
    g.closePath();
  };
  g.lineJoin = "round";
  path();
  g.strokeStyle = "#2b3140";
  g.lineWidth = lane * 1.62;
  g.stroke();
  path();
  g.strokeStyle = ASPHALT;
  g.lineWidth = lane * 1.5;
  g.stroke();
  for (const side of [-1, 1]) {
    g.beginPath();
    const d = side * lane * 0.62;
    g.moveTo(s.xl, s.yc + s.r + d);
    g.lineTo(s.xr, s.yc + s.r + d);
    g.arc(s.xr, s.yc, s.r + d, Math.PI / 2, -Math.PI / 2, true);
    g.lineTo(s.xl, s.yc - s.r - d);
    g.arc(s.xl, s.yc, s.r + d, -Math.PI / 2, Math.PI / 2, true);
    g.closePath();
    g.strokeStyle = LINE;
    g.lineWidth = Math.max(4, lane * 0.05);
    g.stroke();
  }
};

/** A circular road, drawn as the loop road is: asphalt between two edge lines, kerbs outside. */
export const paintCircleRoad = (g: Ctx, s: CircleShape): void => {
  const ring = (r: number, width: number, color: string) => {
    g.beginPath();
    g.arc(s.cx, s.cy, r, 0, Math.PI * 2);
    g.strokeStyle = color;
    g.lineWidth = width;
    g.stroke();
  };
  ring(s.r, s.lane * LANE_KERB * 2, "#2b3140");
  ring(s.r, s.lane * 1.5, ASPHALT);
  for (const side of [-1, 1]) ring(s.r + side * s.lane * 0.62, Math.max(4, s.lane * 0.05), LINE);
};

let handImage: HTMLImageElement | null = null;
const hand = (): HTMLImageElement | null => {
  if (typeof Image === "undefined") return null;
  if (!handImage) {
    // As an image file the SVG needs its namespace, which inline markup can do without.
    const svg = iconSvg("hand", 200)
      .replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ')
      .replace(
        '<g fill="currentColor">',
        '<g fill="#f4f7fb" stroke="rgba(8,14,26,0.85)" stroke-width="3">',
      )
      .replaceAll("currentColor", "#f4f7fb");
    handImage = new Image();
    handImage.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }
  return handImage.complete && handImage.naturalWidth > 0 ? handImage : null;
};

/** A hand with its fingertip at (x, y), for the attract mode's touches. */
export const drawHand = (g: Ctx, x: number, y: number, size: number, alpha: number): void => {
  const img = hand();
  if (!img || alpha <= 0.01) return;
  g.save();
  g.globalAlpha = alpha;
  // The icon's fingertip is near (41, 4) on its 100-unit grid.
  g.drawImage(img, x - size * 0.415, y - size * 0.04, size, size);
  g.restore();
};

/** A ring that grows and fades over `age` (0 to 1). */
export const drawRipple = (g: Ctx, x: number, y: number, r: number, age: number, color: string) => {
  if (age >= 1) return;
  g.save();
  g.globalAlpha = (1 - age) * 0.8;
  g.strokeStyle = color;
  g.lineWidth = r * 0.12 * (1 - age) + 2;
  g.beginPath();
  g.arc(x, y, r * (0.5 + age * 0.9), 0, Math.PI * 2);
  g.stroke();
  g.restore();
};

export interface ControlState {
  count: number;
  limit: number;
  smart: number;
  /** Can the cars buttons go further down or up? */
  fewer: boolean;
  more: boolean;
  /** Local ms each cell was last pressed, by `${key}:${cell}`. */
  pressed: ReadonlyMap<string, number>;
  now: number;
}

const SMART_LABELS = ["none", "1 in 10", "1 in 4", "half"];

export const CONTROL_TITLES: Record<ControlGroup["key"], string> = {
  cars: "Cars",
  limit: "Speed limit",
  smart: "Smart cars",
};

const plate = (g: Ctx, r: Rect) => {
  g.beginPath();
  g.roundRect(r.x, r.y, r.width, r.height, Math.min(r.width, r.height) * 0.12);
  g.fillStyle = "rgba(9,13,24,0.9)";
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = "rgba(150,170,210,0.22)";
  g.stroke();
};

const cellFrame = (g: Ctx, c: Rect, on: boolean, flash: number, enabled = true) => {
  g.beginPath();
  g.roundRect(c.x, c.y, c.width, c.height, c.width * 0.18);
  g.fillStyle = on ? "rgba(255,204,51,0.18)" : "rgba(255,255,255,0.05)";
  g.fill();
  if (flash > 0) {
    g.fillStyle = `rgba(255,255,255,${0.25 * flash})`;
    g.fill();
  }
  g.lineWidth = on ? 7 : 3;
  g.strokeStyle = on ? "#ffcc33" : enabled ? "rgba(170,186,220,0.4)" : "rgba(170,186,220,0.15)";
  g.stroke();
};

const flashOf = (s: ControlState, key: string) => {
  const at = s.pressed.get(key);
  return at === undefined ? 0 : Math.max(0, 1 - (s.now - at) / 300);
};

/** One mini car for the controls' pictures. */
const miniCar = (g: Ctx, x: number, y: number, len: number, color: string, glow: boolean) => {
  g.save();
  g.translate(x, y);
  drawCar(g, len, len * 0.5, color, glow, false);
  g.restore();
};

/** Draw the adults' controls with their current values. */
export const drawControls = (g: Ctx, groups: readonly ControlGroup[], s: ControlState): void => {
  for (const grp of groups) {
    plate(g, grp.plate);
    g.fillStyle = "rgba(214,222,238,0.85)";
    g.font = `700 ${Math.round(grp.title.size)}px ${FONT}`;
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    g.fillText(CONTROL_TITLES[grp.key], grp.title.x, grp.title.y);
    if (grp.key === "cars") {
      const [minus, mid, plus] = grp.cells as [Rect, Rect, Rect];
      for (const [c, sign, ok, id] of [
        [minus, -1, s.fewer, "cars:0"],
        [plus, 1, s.more, "cars:2"],
      ] as const) {
        cellFrame(g, c, false, flashOf(s, id), ok);
        g.save();
        g.globalAlpha = ok ? 1 : 0.35;
        miniCar(
          g,
          c.x + c.width * 0.42,
          c.y + c.height * 0.64,
          c.width * 0.5,
          BODY_COLORS[0]!,
          false,
        );
        g.strokeStyle = "#f2f5fa";
        g.lineWidth = c.width * 0.08;
        g.lineCap = "round";
        const cx = c.x + c.width * 0.72;
        const cy = c.y + c.height * 0.3;
        const r = c.width * 0.13;
        g.beginPath();
        g.moveTo(cx - r, cy);
        g.lineTo(cx + r, cy);
        if (sign > 0) {
          g.moveTo(cx, cy - r);
          g.lineTo(cx, cy + r);
        }
        g.stroke();
        g.restore();
      }
      g.fillStyle = "#f2f5fa";
      g.font = `800 ${Math.round(mid.height * 0.42)}px ${FONT}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(String(s.count), mid.x + mid.width / 2, mid.y + mid.height / 2);
      continue;
    }
    if (grp.key === "limit") {
      grp.cells.forEach((c, i) => {
        const on = s.limit === i;
        cellFrame(g, c, on, flashOf(s, `limit:${i}`));
        drawSign(
          g,
          c.x + c.width / 2,
          c.y + c.height / 2,
          c.width * 0.36,
          LIMIT_SIGNS[i]!,
          on ? 1 : 0.5,
        );
      });
      continue;
    }
    grp.cells.forEach((c, i) => {
      const on = s.smart === i;
      cellFrame(g, c, on, flashOf(s, `smart:${i}`));
      // A smart car (a plain one for none), and how many of the cars are smart.
      g.save();
      g.globalAlpha = on ? 1 : 0.7;
      miniCar(
        g,
        c.x + c.width / 2,
        c.y + c.height * 0.36,
        c.width * 0.5,
        i === 0 ? "#6e7890" : SMART_BODY,
        i > 0,
      );
      g.fillStyle = on ? "#f2f5fa" : "rgba(214,222,238,0.8)";
      g.font = `700 ${Math.round(c.height * 0.2)}px ${FONT}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(SMART_LABELS[i] ?? "", c.x + c.width / 2, c.y + c.height * 0.76);
      g.restore();
    });
  }
};

/** Which control cell is at (x, y), if any. */
export const controlAt = (
  groups: readonly ControlGroup[],
  x: number,
  y: number,
  slop = 10,
): { key: ControlGroup["key"]; cell: number } | null => {
  for (const grp of groups) {
    const p = grp.plate;
    if (x < p.x - slop || x > p.x + p.width + slop || y < p.y - slop || y > p.y + p.height + slop) {
      continue;
    }
    let best = -1;
    let dist = Infinity;
    grp.cells.forEach((c, i) => {
      const dx = Math.max(c.x - x, 0, x - c.x - c.width);
      const dy = Math.max(c.y - y, 0, y - c.y - c.height);
      const d = Math.hypot(dx, dy);
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    if (best >= 0 && dist <= slop + 12) return { key: grp.key, cell: best };
    // A touch on the plate (title or padding) belongs to nothing, but is swallowed.
    return { key: grp.key, cell: -1 };
  }
  return null;
};

/** A traffic cone standing on (x, y), `h` tall. */
export const drawCone = (g: Ctx, x: number, y: number, h: number, alpha = 1): void => {
  g.save();
  g.globalAlpha = alpha;
  const w = h * 0.62;
  g.fillStyle = "#20242e";
  g.beginPath();
  g.roundRect(x - w / 2, y - h * 0.1, w, h * 0.1, h * 0.03);
  g.fill();
  g.fillStyle = "#f28a1d";
  g.beginPath();
  g.moveTo(x - w * 0.36, y - h * 0.1);
  g.lineTo(x - w * 0.08, y - h);
  g.lineTo(x + w * 0.08, y - h);
  g.lineTo(x + w * 0.36, y - h * 0.1);
  g.closePath();
  g.fill();
  g.fillStyle = "#f4f6fa";
  for (const [a, b] of [
    [0.32, 0.44],
    [0.6, 0.7],
  ] as const) {
    const wa = w * (0.36 - 0.28 * a);
    const wb = w * (0.36 - 0.28 * b);
    g.beginPath();
    g.moveTo(x - wa, y - h * (0.1 + 0.9 * a) + h * 0.09 * a);
    g.lineTo(x - wb, y - h * (0.1 + 0.9 * b) + h * 0.09 * b);
    g.lineTo(x + wb, y - h * (0.1 + 0.9 * b) + h * 0.09 * b);
    g.lineTo(x + wa, y - h * (0.1 + 0.9 * a) + h * 0.09 * a);
    g.closePath();
    g.fill();
  }
  g.restore();
};

/**
 * A slowdown button: a dark disc with a cone on it in the side's colour ring, `ready` (0 to 1)
 * filling the ring while it recharges, `pulse` (0 to 1) inviting a press.
 */
export const drawSlowButton = (
  g: Ctx,
  r: Rect,
  color: string,
  ready: number,
  pulse: number,
  flash: number,
): void => {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const rad = Math.min(r.width, r.height) / 2;
  g.save();
  if (pulse > 0 && ready >= 1) {
    g.globalAlpha = 0.35 * pulse;
    g.beginPath();
    g.arc(cx, cy, rad * (1.04 + 0.1 * pulse), 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
    g.globalAlpha = 1;
  }
  g.beginPath();
  g.arc(cx, cy, rad * 0.94, 0, Math.PI * 2);
  g.fillStyle = flash > 0 ? `rgba(255,255,255,${0.2 + 0.3 * flash})` : "rgba(9,13,24,0.92)";
  g.fill();
  g.lineWidth = rad * 0.1;
  g.strokeStyle = withAlpha(color, 0.25);
  g.stroke();
  g.beginPath();
  g.arc(cx, cy, rad * 0.94, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, ready));
  g.strokeStyle = color;
  g.stroke();
  drawCone(g, cx, cy + rad * 0.5, rad * 1.05, ready >= 1 ? 1 : 0.45);
  g.restore();
};

export interface Sparkle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  at: number;
  life: number;
  color: string;
}

export const drawSparkles = (g: Ctx, list: Sparkle[], now: number, size: number): void => {
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i]!;
    const age = (now - s.at) / s.life;
    if (age >= 1) {
      list.splice(i, 1);
      continue;
    }
    const t = (now - s.at) / 1000;
    const x = s.x + s.vx * t;
    const y = s.y + s.vy * t + 300 * t * t;
    const r = size * (1 - age) * (0.6 + 0.4 * Math.sin(now / 60 + i));
    g.save();
    g.globalAlpha = 1 - age;
    g.fillStyle = s.color;
    g.beginPath();
    g.moveTo(x, y - r);
    g.lineTo(x + r * 0.3, y - r * 0.3);
    g.lineTo(x + r, y);
    g.lineTo(x + r * 0.3, y + r * 0.3);
    g.lineTo(x, y + r);
    g.lineTo(x - r * 0.3, y + r * 0.3);
    g.lineTo(x - r, y);
    g.lineTo(x - r * 0.3, y - r * 0.3);
    g.closePath();
    g.fill();
    g.restore();
  }
};
