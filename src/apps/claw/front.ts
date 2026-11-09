/**
 * The lower part of a wall cabinet: the control panel with its left and right arrows, drop
 * button and timer, the base, and the prize hatch with what was won lying in it. Cabinet px, with
 * the body's left edge at x = 0 and the sign's top at y = 0, as in cabinet.ts.
 *
 * The buttons say what they do by how they light: they blink in turn while the machine plays
 * itself, light up for whoever has the controls, dim while the claw is busy, and flash when
 * someone touches the cabinet elsewhere.
 */
import type { Rect } from "../../core/types";
import {
  type CabinetFront,
  canvas2d,
  clawIcon,
  FONT,
  horizontal,
  sparkleSprite,
  vertical,
} from "./cabinet";
import { DESIGNS } from "./designs";
import type { CabinetBox } from "./layout";
import type { Machine } from "./machine";
import { blitSprite, type SpriteSet } from "./plush";
import type { Theme } from "./themes";
import { TRAY_FALL_S, type Tray } from "./tray";
import type { Seat } from "./wallarcade";
import type { Button, Circle } from "./walllayout";

type G = CanvasRenderingContext2D;

export interface FrontPlace {
  buttons: Record<Button, Circle>;
  timer: Rect;
  hatch: Rect;
  /** The arrows' diameter. */
  s: number;
}

export interface WallFrontOptions {
  theme: Theme;
  box: CabinetBox;
  place: FrontPlace;
  seat: Seat;
  /** Whether a finger is on a button now. */
  pressed(b: Button): boolean;
  sprites: SpriteSet;
  playLimit: number;
}

const HINT_S = 1.5;
const SPARKLE_S = 1.4;
const SPARKLES = 9;
const AMBER = "#ffb44a";
const INK = "#fff3c4";

const hex = (c: string): [number, number, number] => {
  const v = c.replace("#", "");
  const full =
    v.length === 3
      ? v
          .split("")
          .map((x) => x + x)
          .join("")
      : v;
  const n = Number.parseInt(full.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const mix = (a: string, b: string, t: number): string => {
  const x = hex(a);
  const y = hex(b);
  const c = x.map((v, i) => Math.round(v + (y[i]! - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
};

/** A domed arcade button with its icon, made once. */
const domeSprite = (r: number, colour: string, icon: Button): HTMLCanvasElement => {
  const [c, g] = canvas2d(r * 2 + 4, r * 2 + 4);
  if (!g) return c;
  const m = r + 2;
  const grad = g.createRadialGradient(m - 0.35 * r, m - 0.4 * r, 0.05 * r, m, m, r);
  grad.addColorStop(0, mix(colour, "#ffffff", 0.75));
  grad.addColorStop(0.45, colour);
  grad.addColorStop(1, mix(colour, "#000000", 0.55));
  g.fillStyle = grad;
  g.beginPath();
  g.arc(m, m, r, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = Math.max(1, 0.05 * r);
  g.strokeStyle = mix(colour, "#000000", 0.65);
  g.stroke();
  // The icon, white with a dark edge so it reads on any colour.
  g.lineJoin = "round";
  g.lineCap = "round";
  g.fillStyle = "#ffffff";
  g.strokeStyle = "rgba(20,8,30,0.7)";
  g.lineWidth = 0.07 * r;
  if (icon === "drop") {
    g.save();
    g.strokeStyle = "#ffffff";
    clawIcon(g, m, m - 0.1 * r, 0.42 * r);
    g.restore();
    g.beginPath();
    g.moveTo(m - 0.24 * r, m + 0.42 * r);
    g.lineTo(m + 0.24 * r, m + 0.42 * r);
    g.lineTo(m, m + 0.7 * r);
    g.closePath();
    g.stroke();
    g.fill();
  } else {
    const d = icon === "left" ? -1 : 1;
    g.beginPath();
    g.moveTo(m + d * 0.5 * r, m);
    g.lineTo(m - d * 0.32 * r, m - 0.48 * r);
    g.lineTo(m - d * 0.32 * r, m + 0.48 * r);
    g.closePath();
    g.stroke();
    g.fill();
  }
  // A glint on the dome.
  g.fillStyle = "rgba(255,255,255,0.45)";
  g.beginPath();
  g.ellipse(m - 0.38 * r, m - 0.5 * r, 0.26 * r, 0.12 * r, -0.5, 0, Math.PI * 2);
  g.fill();
  return c;
};

const glowSprite = (r: number, colour: string): HTMLCanvasElement => {
  const R = r * 1.6;
  const [c, g] = canvas2d(R * 2, R * 2);
  if (!g) return c;
  const [cr, cg, cb] = hex(colour);
  const grad = g.createRadialGradient(R, R, r * 0.8, R, R, R);
  grad.addColorStop(0, `rgba(${cr},${cg},${cb},0.55)`);
  grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  return c;
};

export const createWallFront = (o: WallFrontOptions): CabinetFront & { dispose(): void } => {
  const { theme, box, place, seat, sprites } = o;
  const H = box.scale ?? box.height;
  const B = box.bodyW;
  const s = place.s;
  const hatch = place.hatch;
  const machine: Machine = seat.machine;
  const tray: Tray = seat.tray;
  const ledge = box.rows.ledge;
  const base = box.rows.base;
  const plinth = box.rows.plinth;
  const colour: Record<Button, string> = { left: theme.knob, right: theme.knob, drop: theme.led };
  const domes = {} as Record<Button, HTMLCanvasElement>;
  const glows = {} as Record<Button, HTMLCanvasElement>;
  for (const b of ["left", "right", "drop"] as const) {
    domes[b] = domeSprite(place.buttons[b].r, colour[b], b);
    glows[b] = glowSprite(place.buttons[b].r, colour[b]);
  }
  const rims: Record<Button, string> = {
    left: mix(colour.left, "#ffffff", 0.7),
    right: mix(colour.right, "#ffffff", 0.7),
    drop: mix(colour.drop, "#ffffff", 0.7),
  };
  const sparkle = sparkleSprite(Math.max(2, 0.12 * s));
  const sparkles = Array.from({ length: SPARKLES }, (_, i) => ({
    x: (i + 0.5) / SPARKLES,
    y: ((i * 7) % SPARKLES) / SPARKLES,
    delay: ((i * 5) % SPARKLES) / SPARKLES,
  }));
  // Prizes in the hatch: as large as fits.
  const size = Math.min(0.95, (0.62 * hatch.height) / (0.8 * box.k));
  const floorY = hatch.y + hatch.height - 0.06 * hatch.height;
  const arrowsMid = (place.buttons.left.x + place.buttons.right.x) / 2;
  const labelY = place.buttons.left.y - place.buttons.left.r - 0.3 * s;

  const drawStatic = (g: G) => {
    // The base, with LED strips at its sides.
    g.fillStyle = horizontal(g, 0, B, [
      [0, theme.dark],
      [0.12, theme.body],
      [0.5, theme.light],
      [0.88, theme.body],
      [1, theme.dark],
    ]);
    g.fillRect(0, base[0], B, base[1] - base[0]);
    g.fillStyle = theme.led;
    g.globalAlpha = 0.7;
    const strip = Math.max(1, 0.008 * H);
    g.fillRect(0.02 * H, base[0] + 0.015 * H, strip, Math.max(0, base[1] - base[0] - 0.03 * H));
    g.fillRect(
      B - 0.02 * H - strip,
      base[0] + 0.015 * H,
      strip,
      Math.max(0, base[1] - base[0] - 0.03 * H),
    );
    g.globalAlpha = 1;

    // The control panel, sticking out a little, its lip catching the light.
    const lo = 0.02 * H;
    const lip = Math.min(0.016 * H, (ledge[1] - ledge[0]) * 0.15);
    g.fillStyle = vertical(g, ledge[0], ledge[0] + lip, [
      [0, theme.light],
      [1, theme.body],
    ]);
    g.fillRect(-lo, ledge[0], B + 2 * lo, lip);
    g.fillStyle = vertical(g, ledge[0] + lip, ledge[1], [
      [0, theme.body],
      [1, theme.dark],
    ]);
    g.fillRect(-lo, ledge[0] + lip, B + 2 * lo, ledge[1] - ledge[0] - lip);
    g.fillStyle = theme.trim;
    g.fillRect(-lo, ledge[0] + lip, B + 2 * lo, Math.max(1, 0.004 * H));
    g.fillRect(-lo, ledge[1] - Math.max(1, 0.004 * H), B + 2 * lo, Math.max(1, 0.004 * H));
    g.fillStyle = vertical(g, ledge[1], ledge[1] + 0.02 * H, [
      [0, "rgba(0,0,0,0.35)"],
      [1, "rgba(0,0,0,0)"],
    ]);
    g.fillRect(0, ledge[1], B, 0.02 * H);

    // Wells for the buttons, with chrome rims.
    for (const b of ["left", "right", "drop"] as const) {
      const p = place.buttons[b];
      g.fillStyle = "#120c1a";
      g.beginPath();
      g.arc(p.x, p.y, p.r * 1.14, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = Math.max(1, 0.05 * p.r);
      g.strokeStyle = "rgba(235,240,250,0.75)";
      g.beginPath();
      g.arc(p.x, p.y, p.r * 1.17, 0, Math.PI * 2);
      g.stroke();
    }
    const tm = place.timer;
    g.fillStyle = "#08060c";
    g.beginPath();
    g.roundRect(tm.x, tm.y, tm.width, tm.height, 0.12 * tm.height);
    g.fill();
    g.lineWidth = Math.max(1, 0.03 * tm.height);
    g.strokeStyle = "rgba(235,240,250,0.5)";
    g.stroke();

    // The prize hatch: a lit recess with a frame.
    const f = 0.05 * s;
    g.fillStyle = theme.trim;
    g.beginPath();
    g.roundRect(hatch.x - f, hatch.y - f, hatch.width + 2 * f, hatch.height + 2 * f, 2 * f);
    g.fill();
    g.fillStyle = vertical(g, hatch.y, hatch.y + hatch.height, [
      [0, "#2c2238"],
      [0.6, "#140e1e"],
      [1, "#0a0710"],
    ]);
    g.fillRect(hatch.x, hatch.y, hatch.width, hatch.height);
    g.fillStyle = vertical(g, hatch.y, hatch.y + 0.35 * hatch.height, [
      [0, "rgba(255,250,235,0.22)"],
      [1, "rgba(255,250,235,0)"],
    ]);
    g.fillRect(hatch.x, hatch.y, hatch.width, 0.35 * hatch.height);
    g.fillStyle = theme.led;
    g.globalAlpha = 0.8;
    g.fillRect(hatch.x, hatch.y, hatch.width, Math.max(1, 0.012 * hatch.height));
    g.globalAlpha = 1;
    g.fillStyle = "rgba(255,255,255,0.08)";
    g.fillRect(hatch.x, floorY, hatch.width, hatch.y + hatch.height - floorY);

    // The kick plate.
    g.fillStyle = vertical(g, plinth[0], plinth[1], [
      [0, "#2a2436"],
      [1, "#08060c"],
    ]);
    g.fillRect(-0.01 * H, plinth[0], B + 0.02 * H, plinth[1] - plinth[0]);
  };

  /** How lit each button is now, 0 to 1. */
  const lights = (now: number): Record<Button, number> => {
    const phase = machine.phase;
    let l: Record<Button, number>;
    if (seat.player === "auto") {
      // Inviting: the arrows blink in turn and the drop button breathes.
      const turn = Math.floor(now * 1.6) % 2 === 0;
      const breath = 0.45 + 0.3 * Math.sin(now * Math.PI);
      l = { left: turn ? 0.95 : 0.35, right: turn ? 0.35 : 0.95, drop: breath };
      if (seat.queued) l = { left: 0.45, right: 0.45, drop: 0.45 };
    } else if (phase === "play") {
      l = { left: 1, right: 1, drop: 0.8 + 0.2 * Math.sin(now * Math.PI * 2.4) };
    } else if (phase === "idle") {
      const p = 0.6 + 0.4 * Math.sin(now * Math.PI * 2);
      l = { left: p, right: p, drop: p };
    } else {
      l = { left: 0.3, right: 0.3, drop: 0.3 };
    }
    const since = now - seat.hintAt;
    if (since >= 0 && since < HINT_S) {
      // Two flashes a second, small areas only.
      const on = Math.floor(since * 4) % 2 === 0 ? 1 : 0.3;
      l = { left: Math.max(l.left, on), right: Math.max(l.right, on), drop: Math.max(l.drop, on) };
    }
    return l;
  };

  const drawButtons = (g: G, now: number) => {
    const l = lights(now);
    for (const b of ["left", "right", "drop"] as const) {
      const p = place.buttons[b];
      const down = o.pressed(b);
      const light = down ? 1 : l[b];
      const glow = glows[b];
      g.globalAlpha = Math.max(0, (light - 0.3) / 0.7);
      g.drawImage(glow, p.x - glow.width / 2, p.y - glow.height / 2);
      g.globalAlpha = 1;
      if (down) g.drawImage(glow, p.x - glow.width / 2, p.y - glow.height / 2);
      const dome = domes[b];
      // Pushed in: a little smaller and lower, ringed with light.
      const k = down ? 0.9 : 1;
      const dy = down ? 0.06 * p.r : 0;
      const w = dome.width * k;
      g.drawImage(dome, p.x - w / 2, p.y - w / 2 + dy, w, w);
      if (light < 0.999) {
        g.fillStyle = `rgba(12,6,22,${0.62 * (1 - light)})`;
        g.beginPath();
        g.arc(p.x, p.y + dy, p.r * k, 0, Math.PI * 2);
        g.fill();
      }
      if (down) {
        g.strokeStyle = rims[b];
        g.lineWidth = 0.09 * p.r;
        g.beginPath();
        g.arc(p.x, p.y + dy, p.r * k * 1.04, 0, Math.PI * 2);
        g.stroke();
      }
    }
  };

  const drawTimer = (g: G) => {
    const tm = place.timer;
    if (machine.phase !== "play") return;
    const left = machine.timeLeft;
    g.fillStyle = AMBER;
    g.font = `700 ${0.72 * tm.height}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(
      String(Math.ceil(left)).padStart(2, "0"),
      tm.x + tm.width / 2,
      tm.y + tm.height * 0.54,
    );
    // A ring round the drop button that runs down with the time.
    const p = place.buttons.drop;
    const k = Math.max(0, Math.min(1, left / o.playLimit));
    g.strokeStyle = AMBER;
    g.lineWidth = 0.05 * s;
    g.lineCap = "round";
    g.beginPath();
    g.arc(p.x, p.y, p.r * 1.17 + 0.05 * s, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
    g.stroke();
  };

  const label = (g: G, text: string, now: number) => {
    const size = 0.27 * s * (1 + 0.05 * Math.sin(now * Math.PI * 2));
    g.font = `800 ${size}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineJoin = "round";
    g.lineWidth = size * 0.2;
    g.strokeStyle = "rgba(20,8,30,0.95)";
    g.strokeText(text, arrowsMid, labelY);
    g.fillStyle = INK;
    g.fillText(text, arrowsMid, labelY);
  };

  const drawHatch = (g: G, now: number) => {
    g.save();
    g.beginPath();
    g.rect(hatch.x, hatch.y, hatch.width, hatch.height);
    g.clip();
    for (const it of tray.items) {
      const pose = tray.pose(it, now);
      if (now < it.arrives || pose.alpha <= 0) continue;
      const sp = sprites.get(it.design, it.colour);
      const d = DESIGNS[it.design].box;
      const rest = floorY + d.y0 * box.k * size;
      const top = hatch.y - d.y1 * box.k * size;
      const y = top + (rest - top) * pose.fall * pose.fall - pose.lift * 0.5 * hatch.height;
      g.globalAlpha = pose.alpha;
      blitSprite(g, sp, hatch.x + it.x * hatch.width, y, pose.angle, size);
    }
    g.globalAlpha = 1;
    // The clear flap in front.
    g.fillStyle = "rgba(200,235,255,0.07)";
    g.fillRect(hatch.x, hatch.y, hatch.width, hatch.height);
    g.save();
    g.translate(hatch.x + 0.15 * hatch.width, hatch.y);
    g.transform(1, 0, -0.4, 1, 0, 0);
    g.fillStyle = horizontal(g, 0, 0.18 * hatch.width, [
      [0, "rgba(255,255,255,0)"],
      [0.5, "rgba(255,255,255,0.1)"],
      [1, "rgba(255,255,255,0)"],
    ]);
    g.fillRect(0, 0, 0.18 * hatch.width, hatch.height * 1.2);
    g.restore();
    g.restore();
    g.fillStyle = "rgba(235,240,250,0.85)";
    g.fillRect(hatch.x, hatch.y, hatch.width, Math.max(1, 0.025 * s));

    const since = now - tray.lastLanding + TRAY_FALL_S * 0.5;
    if (since >= 0 && since < SPARKLE_S) {
      const w = sparkle.width;
      for (const sp of sparkles) {
        const t = (since - sp.delay * 0.5) / 0.9;
        if (t < 0 || t > 1) continue;
        const a = Math.sin(Math.PI * t);
        const cx = hatch.x + sp.x * hatch.width;
        const cy = hatch.y + (0.15 + 0.6 * sp.y) * hatch.height;
        const sz = w * (0.6 + 0.4 * a);
        g.globalAlpha = a;
        g.save();
        g.translate(cx, cy);
        g.rotate(now * 1.5 + sp.delay * 3);
        g.drawImage(sparkle, -sz / 2, -sz / 2, sz, sz);
        g.restore();
      }
      g.globalAlpha = 1;
    }
  };

  return {
    drawStatic,
    drawLive(g, now) {
      drawHatch(g, now);
      drawButtons(g, now);
      drawTimer(g);
      if (seat.queued && seat.player !== seat.queued) label(g, "You're next", now);
      else if (seat.player !== "auto" && seat.waiting) label(g, "Play again", now);
    },
    dispose() {
      for (const c of [...Object.values(domes), ...Object.values(glows), sparkle]) {
        c.width = c.height = 0;
      }
    },
  };
};
