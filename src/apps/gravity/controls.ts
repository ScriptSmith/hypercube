/**
 * The controls round the slingshots, in the frame's venue px: a body picker beside each slingshot
 * (rock, planet, gas giant, star), the time control (slower and faster), the sizes button
 * (drawn sizes or true ones) and the scene button, which changes everyone's sky, so it must be
 * held for a second. Drawing for all of them, the
 * slingshots and the black-hole launchers is here too. Icons, not words; only the time factor is
 * written.
 */
import { heldAt } from "./aim";
import { MASS, type Pick, shownTemp, tempIndex, tempRgb } from "./bodies";
import { FACTORS } from "./cosmos";
import type { Scene } from "./draw";
import type { Btn, Layout, PickBtn } from "./layout";
import type { Launcher, Pad } from "./pads";
import { RELOAD_MS } from "./pads";
import type { SceneId } from "./scenes";
import { css, rgbOf, shade } from "./sprites";
import { type Climber, TRUE_STRIP_R } from "./strip";

/** Holding the scene button this long changes the scene. */
export const SCENE_HOLD_MS = 1000;
export const DEFAULT_PICK: Pick = "planet";

export interface ControlEvents {
  pick(pad: number, pick: Pick, human: boolean): void;
  time(delta: -1 | 1, human: boolean): void;
  sizes(human: boolean): void;
  scene(human: boolean): void;
}

export interface Controls {
  readonly picks: readonly Pick[];
  /** Venue px. True when the touch landed on a control. */
  down(id: number, x: number, y: number, synthetic: boolean, now: number): boolean;
  up(id: number): void;
  cancel(id: number): void;
  update(now: number): void;
  setPick(pad: number, pick: Pick): void;
  /** 0 to 1 while the scene button is held. */
  hold(now: number): number;
  /** When slower, faster, sizes and scene were last pressed, for a brief light. */
  readonly pressed: { slower: number; faster: number; sizes: number; scene: number };
  reset(): void;
}

const hit = (b: Btn, x: number, y: number) => Math.hypot(x - b.x, y - b.y) <= b.r * 1.1;

export const createControls = (layout: Layout, on: ControlEvents): Controls => {
  const picks: Pick[] = layout.pads.map(() => DEFAULT_PICK);
  const pressed = { slower: -Infinity, faster: -Infinity, sizes: -Infinity, scene: -Infinity };
  let holding: { id: number; at: number; human: boolean; fired: boolean } | null = null;
  return {
    picks,
    pressed,
    down(id, x, y, synthetic, now) {
      for (let i = 0; i < layout.pickers.length; i++) {
        for (const b of layout.pickers[i]!) {
          if (!hit(b, x, y)) continue;
          picks[i] = b.pick;
          on.pick(i, b.pick, !synthetic);
          return true;
        }
      }
      if (hit(layout.slower, x, y)) {
        pressed.slower = now;
        on.time(-1, !synthetic);
        return true;
      }
      if (hit(layout.faster, x, y)) {
        pressed.faster = now;
        on.time(1, !synthetic);
        return true;
      }
      if (hit(layout.sizes, x, y)) {
        pressed.sizes = now;
        on.sizes(!synthetic);
        return true;
      }
      if (hit(layout.scene, x, y)) {
        holding = { id, at: now, human: !synthetic, fired: false };
        return true;
      }
      return false;
    },
    up(id) {
      if (holding?.id === id) holding = null;
    },
    cancel(id) {
      if (holding?.id === id) holding = null;
    },
    update(now) {
      if (!holding || holding.fired || now - holding.at < SCENE_HOLD_MS) return;
      holding.fired = true;
      pressed.scene = now;
      on.scene(holding.human);
    },
    setPick(pad, pick) {
      if (pad >= 0 && pad < picks.length) picks[pad] = pick;
    },
    hold(now) {
      if (!holding || holding.fired) return 0;
      return Math.min(1, (now - holding.at) / SCENE_HOLD_MS);
    },
    reset() {
      picks.fill(DEFAULT_PICK);
      holding = null;
    },
  };
};

// ---- Drawing ------------------------------------------------------------------------------

const TAU = Math.PI * 2;

/** A body as an icon of radius r at (x, y), device px. */
export const drawIcon = (
  sc: Scene,
  pick: Pick | "hole",
  x: number,
  y: number,
  r: number,
  seed = 1,
) => {
  const { g, sprites } = sc;
  if (r < 1) return;
  if (pick === "star") {
    const t = shownTemp(MASS.star);
    const rgb = tempRgb(t);
    g.globalCompositeOperation = "lighter";
    g.drawImage(sprites.glow(rgb, r * 2.6), x - r * 2.6, y - r * 2.6, r * 5.2, r * 5.2);
    g.globalCompositeOperation = "source-over";
    g.drawImage(sprites.star(tempIndex(t), r), x - r, y - r, r * 2, r * 2);
    return;
  }
  if (pick === "hole") {
    g.drawImage(sprites.hole(r), x - r * 4, y - r * 4, r * 8, r * 8);
    return;
  }
  const img =
    pick === "giant"
      ? sprites.giant(0, r, seed)
      : pick === "planet"
        ? sprites.planet(0, r, seed)
        : sprites.rock(1, r, seed);
  g.drawImage(img, x - r, y - r, r * 2, r * 2);
  // Lit from the upper left.
  g.save();
  g.translate(x, y);
  g.rotate(Math.PI * 0.25);
  g.drawImage(sprites.shadow(r), -r, -r, r * 2, r * 2);
  g.restore();
};

/** Icon size within a picker button of radius r, so the four read smallest to largest. */
const ICON = { rock: 0.32, planet: 0.44, giant: 0.6, star: 0.5 } as const;
/** The body resting on a slingshot, as a share of its grab radius. */
const REST = { rock: 0.13, planet: 0.18, giant: 0.25, star: 0.24 } as const;

const disc = (sc: Scene, b: Btn, fill: string, ring: string, width: number) => {
  const { g, tr } = sc;
  g.fillStyle = fill;
  g.beginPath();
  g.arc(b.x * tr.s + tr.ox, b.y * tr.s + tr.oy, b.r * tr.s, 0, TAU);
  g.fill();
  g.strokeStyle = ring;
  g.lineWidth = Math.max(1, width * tr.s);
  g.stroke();
};

export const drawPicker = (sc: Scene, btns: readonly PickBtn[], chosen: Pick, color: number) => {
  const { g, tr } = sc;
  const rgb = rgbOf(color);
  for (const b of btns) {
    const on = b.pick === chosen;
    if (on) {
      g.globalCompositeOperation = "lighter";
      const R = b.r * 1.5 * tr.s;
      g.drawImage(
        sc.sprites.glow(rgb, R),
        b.x * tr.s + tr.ox - R,
        b.y * tr.s + tr.oy - R,
        R * 2,
        R * 2,
      );
      g.globalCompositeOperation = "source-over";
    }
    disc(
      sc,
      b,
      on ? "rgba(26,30,52,0.92)" : "rgba(12,14,28,0.78)",
      on ? css(shade(rgb, 0.25), 0.95) : "rgba(150,160,200,0.3)",
      on ? 7 : 3,
    );
    drawIcon(sc, b.pick, b.x * tr.s + tr.ox, b.y * tr.s + tr.oy, b.r * ICON[b.pick] * tr.s, 3);
  }
};

export const drawPad = (sc: Scene, pad: Pad, pick: Pick, now: number) => {
  const { g, tr } = sc;
  const s = pad.spot;
  const X = (x: number) => x * tr.s + tr.ox;
  const Y = (y: number) => y * tr.s + tr.oy;
  const G = s.grab;
  const rgb = rgbOf(s.color);
  const held = pad.holder !== null ? heldAt(s, pad.dx, pad.dy) : null;
  const ready = Math.min(1, Math.max(0, 1 - (pad.readyAt - now) / RELOAD_MS));

  // Base glow so the pad reads as a place to touch, and a ring after a body from it went round.
  g.globalCompositeOperation = "lighter";
  const gr = G * 1.15 * tr.s;
  g.globalAlpha = 0.55;
  g.drawImage(sc.sprites.glow(rgb, gr), X(s.x) - gr, Y(s.y) - gr, gr * 2, gr * 2);
  g.globalAlpha = 1;
  const glowT = (now - pad.glowAt) / 1600;
  if (glowT >= 0 && glowT < 1) {
    g.strokeStyle = css(shade(rgb, 0.4), 0.7 * (1 - glowT));
    g.lineWidth = Math.max(1, 14 * tr.s * (1 - glowT));
    g.beginPath();
    g.arc(X(s.x), Y(s.y), G * (1 + glowT * 1.2) * tr.s, 0, TAU);
    g.stroke();
  }
  g.globalCompositeOperation = "source-over";
  g.strokeStyle = css(rgb, 0.3);
  g.lineWidth = Math.max(1, 4 * tr.s);
  g.beginPath();
  g.arc(X(s.x), Y(s.y), G * 0.92 * tr.s, 0, TAU);
  g.stroke();

  // The fork.
  const tipL = { x: s.x - G * 0.62, y: s.y - G * 0.08 };
  const tipR = { x: s.x + G * 0.62, y: s.y - G * 0.08 };
  const joint = { x: s.x, y: s.y + G * 0.48 };
  const foot = { x: s.x, y: s.y + G * 0.95 };
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = "#7d86ad";
  g.lineWidth = Math.max(2, G * 0.13 * tr.s);
  g.beginPath();
  g.moveTo(X(tipL.x), Y(tipL.y));
  g.quadraticCurveTo(X(s.x - G * 0.5), Y(joint.y), X(joint.x), Y(joint.y));
  g.quadraticCurveTo(X(s.x + G * 0.5), Y(joint.y), X(tipR.x), Y(tipR.y));
  g.moveTo(X(joint.x), Y(joint.y));
  g.lineTo(X(foot.x), Y(foot.y));
  g.stroke();

  const at = held ?? { x: s.x, y: s.y };
  g.strokeStyle = css(shade(rgb, -0.1), 0.95);
  g.lineWidth = Math.max(1.5, G * 0.06 * tr.s);
  g.beginPath();
  g.moveTo(X(tipL.x), Y(tipL.y));
  g.lineTo(X(at.x), Y(at.y));
  g.lineTo(X(tipR.x), Y(tipR.y));
  g.stroke();

  if (ready > 0) {
    const r = G * REST[pick] * (0.3 + 0.7 * ready) * tr.s;
    g.globalAlpha = ready;
    // A ring in the pad's colour, so the body reads as this player's.
    g.strokeStyle = css(shade(rgb, 0.2), 0.8);
    g.lineWidth = Math.max(1, 4 * tr.s);
    g.beginPath();
    g.arc(X(at.x), Y(at.y), r + 8 * tr.s, 0, TAU);
    g.stroke();
    drawIcon(sc, pick, X(at.x), Y(at.y), r, s.index + 7);
    g.globalAlpha = 1;
  }

  // Pull-down hint while nobody is using it.
  const quiet = now - pad.lastUse;
  if (pad.holder === null && quiet > 5000 && ready >= 1) {
    const k = Math.min(1, (quiet - 5000) / 1000);
    const bob = Math.sin(now / 520) * 0.5 + 0.5;
    for (let i = 0; i < 2; i++) {
      const y = s.y + G * (0.55 + i * 0.32 + bob * 0.14);
      g.strokeStyle = css(shade(rgb, 0.3), (0.55 - i * 0.2) * k);
      g.lineWidth = Math.max(1.5, G * 0.07 * tr.s);
      g.beginPath();
      g.moveTo(X(s.x - G * 0.22), Y(y - G * 0.12));
      g.lineTo(X(s.x), Y(y));
      g.lineTo(X(s.x + G * 0.22), Y(y - G * 0.12));
      g.stroke();
    }
  }
};

export const drawLauncher = (sc: Scene, l: Launcher, charge: number, now: number) => {
  const { g, tr } = sc;
  const s = l.spot;
  const x = s.x * tr.s + tr.ox;
  const y = s.y * tr.s + tr.oy;
  const r = s.r * tr.s;
  const full = charge >= 1;
  g.fillStyle = "rgba(14,10,30,0.82)";
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
  if (full) {
    const b = 0.5 + 0.5 * Math.sin(now / 760);
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 0.5 + 0.3 * b;
    g.drawImage(sc.sprites.glow(0xffc890, r * 1.5), x - r * 1.5, y - r * 1.5, r * 3, r * 3);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
  g.strokeStyle = "rgba(255,200,150,0.22)";
  g.lineWidth = Math.max(2, r * 0.11);
  g.beginPath();
  g.arc(x, y, r * 0.86, 0, TAU);
  g.stroke();
  g.strokeStyle = full ? "rgba(255,226,190,0.95)" : "rgba(255,170,110,0.75)";
  g.lineCap = "round";
  g.beginPath();
  g.arc(x, y, r * 0.86, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0.001, charge));
  g.stroke();
  g.globalAlpha = full ? 1 : 0.4;
  g.save();
  g.translate(x, y);
  g.rotate(-now / 900);
  g.globalCompositeOperation = "lighter";
  const dr = r * 0.62;
  g.drawImage(sc.sprites.disc(dr), -dr, -dr, dr * 2, dr * 2);
  g.globalCompositeOperation = "source-over";
  g.restore();
  drawIcon(sc, "hole", x, y, r * 0.15);
  g.globalAlpha = 1;
};

const chevrons = (sc: Scene, b: Btn, dir: -1 | 1, lit: number) => {
  const { g, tr } = sc;
  disc(sc, b, `rgba(14,16,32,${0.8 + lit * 0.15})`, `rgba(190,200,240,${0.35 + lit * 0.5})`, 3);
  const x = b.x * tr.s + tr.ox;
  const y = b.y * tr.s + tr.oy;
  const s = b.r * tr.s * 0.32;
  g.fillStyle = `rgba(225,232,255,${0.85 + lit * 0.15})`;
  for (const k of [-0.55, 0.55]) {
    const cx = x + k * s * dir * 1.1;
    g.beginPath();
    g.moveTo(cx + s * 0.7 * dir, y);
    g.lineTo(cx - s * 0.55 * dir, y - s * 0.85);
    g.lineTo(cx - s * 0.55 * dir, y + s * 0.85);
    g.closePath();
    g.fill();
  }
};

const FACTOR_TEXT = ["¼×", "½×", "1×", "2×", "4×"];

export const drawTime = (
  sc: Scene,
  l: Layout,
  timeIndex: number,
  pressed: Controls["pressed"],
  now: number,
) => {
  const lit = (at: number) => Math.max(0, 1 - (now - at) / 400);
  chevrons(sc, l.slower, -1, lit(pressed.slower));
  chevrons(sc, l.faster, 1, lit(pressed.faster));
  const { g, tr } = sc;
  const size = l.readout.size * tr.s;
  g.font = `600 ${Math.round(size)}px system-ui, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const text = FACTOR_TEXT[timeIndex] ?? `${FACTORS[timeIndex]}×`;
  g.fillStyle = timeIndex === 2 ? "rgba(220,228,255,0.8)" : "rgba(255,226,170,0.95)";
  g.fillText(text, l.readout.x * tr.s + tr.ox, l.readout.y * tr.s + tr.oy);
};

/**
 * The sizes button: a big disc beside a tiny point marked with ticks. Drawn sizes light the
 * disc; true sizes light the point and ring the button, so the button shows which is on.
 */
export const drawSizesButton = (sc: Scene, b: Btn, on: number, lastAt: number, now: number) => {
  const { g, tr } = sc;
  const flash = Math.max(0, 1 - (now - lastAt) / 500);
  disc(
    sc,
    b,
    `rgba(14,16,32,${0.82 + flash * 0.15})`,
    on > 0.5 ? `rgba(255,222,160,${0.75 + flash * 0.25})` : "rgba(190,200,240,0.35)",
    on > 0.5 ? 6 : 3,
  );
  const x = b.x * tr.s + tr.ox;
  const y = b.y * tr.s + tr.oy;
  const r = b.r * tr.s;
  // The big disc: a gas giant as drawn.
  const big = r * 0.36;
  g.globalAlpha = 1 - on * 0.72;
  drawIcon(sc, "giant", x - r * 0.3, y, big, 2);
  g.globalAlpha = 1;
  // The point in its focus frame: the same giant at its true size.
  const px = x + r * 0.42;
  const box = r * 0.2;
  const a = 0.35 + on * 0.65;
  g.strokeStyle = `rgba(255,226,170,${a})`;
  g.lineWidth = Math.max(1.5, r * 0.055);
  g.lineCap = "round";
  g.lineJoin = "round";
  focusFrame(g, px, y, box);
  g.fillStyle = `rgba(255,236,200,${a})`;
  g.beginPath();
  g.arc(px, y, Math.max(1.2, r * 0.035), 0, TAU);
  g.fill();
};

/** Four corners of a square round (x, y): the marker for a body too small to see. */
export const focusFrame = (g: CanvasRenderingContext2D, x: number, y: number, half: number) => {
  const arm = half * 0.42;
  g.beginPath();
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    const cx = x + sx * half;
    const cy = y + sy * half;
    g.moveTo(cx - sx * arm, cy);
    g.lineTo(cx, cy);
    g.lineTo(cx, cy - sy * arm);
  }
  g.stroke();
};

/** A small picture of a scene inside a circle of radius r, device px. */
const pictogram = (sc: Scene, id: SceneId, x: number, y: number, r: number) => {
  const { g } = sc;
  const dot = (dx: number, dy: number, rr: number, rgb: number, glow = false) => {
    if (glow) {
      g.globalCompositeOperation = "lighter";
      g.drawImage(sc.sprites.glow(rgb, rr * 3), x + dx - rr * 3, y + dy - rr * 3, rr * 6, rr * 6);
      g.globalCompositeOperation = "source-over";
    }
    g.fillStyle = css(rgb);
    g.beginPath();
    g.arc(x + dx, y + dy, rr, 0, TAU);
    g.fill();
  };
  g.strokeStyle = "rgba(200,210,240,0.45)";
  g.lineWidth = Math.max(1, r * 0.04);
  switch (id) {
    case "solar":
      for (const k of [0.45, 0.75]) {
        g.beginPath();
        g.arc(x, y, r * k, 0, TAU);
        g.stroke();
      }
      dot(0, 0, r * 0.16, tempRgb(5800), true);
      dot(r * 0.45 * 0.7, -r * 0.45 * 0.7, r * 0.07, 0x6f9ad0);
      dot(-r * 0.75, r * 0.08, r * 0.1, 0xd8b88a);
      break;
    case "binary":
      g.beginPath();
      g.ellipse(x, y, r * 0.42, r * 0.42, 0, 0, TAU);
      g.stroke();
      dot(-r * 0.24, 0.06 * r, r * 0.15, tempRgb(5800), true);
      dot(r * 0.26, -0.06 * r, r * 0.11, tempRgb(4300), true);
      dot(0, -r * 0.72, r * 0.07, 0x8aa0c0);
      break;
    case "rings":
      dot(0, 0, r * 0.3, 0xd6bf8a);
      g.strokeStyle = "rgba(230,220,200,0.8)";
      g.lineWidth = Math.max(1, r * 0.06);
      g.beginPath();
      g.ellipse(x, y, r * 0.62, r * 0.18, -0.35, 0, TAU);
      g.stroke();
      break;
    case "cluster":
      dot(-r * 0.3, -r * 0.2, r * 0.13, tempRgb(9000), true);
      dot(r * 0.28, -r * 0.3, r * 0.09, tempRgb(4000), true);
      dot(r * 0.1, r * 0.3, r * 0.11, tempRgb(6000), true);
      dot(-r * 0.4, r * 0.35, r * 0.07, tempRgb(3400), true);
      dot(r * 0.5, r * 0.15, r * 0.06, tempRgb(12_000), true);
      break;
    case "galaxies":
      for (const [cx, cy, s, turn] of [
        [-0.3, -0.12, 0.34, 1],
        [0.34, 0.2, 0.26, -1],
      ] as const) {
        dot(cx * r, cy * r, r * 0.07, 0xffe6c0, true);
        g.strokeStyle = "rgba(190,205,255,0.7)";
        g.lineWidth = Math.max(1, r * 0.045);
        for (let arm = 0; arm < 2; arm++) {
          g.beginPath();
          for (let i = 0; i <= 12; i++) {
            const t = i / 12;
            const a = arm * Math.PI + t * 3.2 * turn;
            const rr = r * s * (0.15 + t * 0.85);
            const px = x + cx * r + Math.cos(a) * rr;
            const py = y + cy * r + Math.sin(a) * rr * 0.8;
            if (i === 0) g.moveTo(px, py);
            else g.lineTo(px, py);
          }
          g.stroke();
        }
      }
      break;
  }
};

/** The scene button: a picture of the next scene, and a ring that fills while it is held. */
export const drawSceneButton = (
  sc: Scene,
  b: Btn,
  next: SceneId,
  hold: number,
  now: number,
  lastAt: number,
) => {
  const { g, tr } = sc;
  const flash = Math.max(0, 1 - (now - lastAt) / 700);
  disc(sc, b, `rgba(14,16,32,${0.82 + flash * 0.15})`, "rgba(190,200,240,0.35)", 3);
  const x = b.x * tr.s + tr.ox;
  const y = b.y * tr.s + tr.oy;
  const r = b.r * tr.s;
  pictogram(sc, next, x, y, r * 0.78);
  // A small arrow round the edge: "next".
  g.strokeStyle = `rgba(210,220,255,${0.5 + flash * 0.5})`;
  g.lineWidth = Math.max(1.5, r * 0.07);
  g.lineCap = "round";
  g.beginPath();
  g.arc(x, y, r * 0.93, -Math.PI * 0.85, -Math.PI * 0.35);
  g.stroke();
  const ea = -Math.PI * 0.35;
  const ex = x + Math.cos(ea) * r * 0.93;
  const ey = y + Math.sin(ea) * r * 0.93;
  g.beginPath();
  g.moveTo(ex - r * 0.16, ey - r * 0.1);
  g.lineTo(ex, ey);
  g.lineTo(ex - r * 0.04, ey + r * 0.17);
  g.stroke();
  if (hold > 0) {
    g.strokeStyle = "rgba(255,226,170,0.95)";
    g.lineWidth = Math.max(2, r * 0.14);
    g.beginPath();
    g.arc(x, y, r * 1.08, -Math.PI / 2, -Math.PI / 2 + TAU * hold);
    g.stroke();
  }
};

/** The attract ghost's hand: a soft fingertip with a palm below it. */
export const drawHand = (sc: Scene, x: number, y: number, size: number, alpha: number) => {
  const { g, tr } = sc;
  const X = x * tr.s + tr.ox;
  const Y = y * tr.s + tr.oy;
  const s = size * tr.s;
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = "rgba(235,240,255,0.55)";
  g.strokeStyle = "rgba(255,255,255,0.8)";
  g.lineWidth = Math.max(1, s * 0.05);
  g.beginPath();
  g.roundRect(X - s * 0.13, Y - s * 0.12, s * 0.26, s * 0.62, s * 0.13);
  g.fill();
  g.stroke();
  g.beginPath();
  g.roundRect(X - s * 0.2, Y + s * 0.32, s * 0.62, s * 0.55, s * 0.2);
  g.fill();
  g.stroke();
  g.beginPath();
  g.arc(X, Y, s * 0.2, 0, TAU);
  g.strokeStyle = "rgba(255,255,255,0.6)";
  g.stroke();
  g.restore();
};

/** A body climbing a bank strip: its icon at its strip size, with a short glowing tail. */
export const drawClimber = (sc: Scene, c: Climber) => {
  const { g, tr } = sc;
  const x = c.px + (c.x - c.px) * sc.alpha;
  const y = c.py + (c.y - c.py) * sc.alpha;
  const rgb = c.color >= 0 ? rgbOf(c.color) : 0xffc890;
  const tiny = c.r <= TRUE_STRIP_R;
  const tail = Math.max(c.r, 10);
  g.globalCompositeOperation = "lighter";
  for (let i = 1; i <= 6; i++) {
    const t = i * 0.025;
    const r = tail * (0.7 - i * 0.07) * tr.s;
    g.globalAlpha = 0.35 * (1 - i / 7);
    const glow = sc.sprites.glow(rgb, r * 2);
    g.drawImage(
      glow,
      (x - c.vx * t) * tr.s + tr.ox - r * 2,
      (y - c.vy * t) * tr.s + tr.oy - r * 2,
      r * 4,
      r * 4,
    );
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  if (!tiny) {
    drawIcon(sc, c.kind, x * tr.s + tr.ox, y * tr.s + tr.oy, c.r * tr.s, c.id);
    return;
  }
  // True sizes: a point in the same frame the universe uses for bodies too small to see.
  const R = 26 * tr.s;
  const cx = x * tr.s + tr.ox;
  const cy = y * tr.s + tr.oy;
  g.strokeStyle = css(shade(rgb, 0.3), 0.95);
  g.lineWidth = Math.max(1.5, R * 0.12);
  g.lineCap = "round";
  g.lineJoin = "round";
  focusFrame(g, cx, cy, R);
  g.fillStyle = css(shade(rgb, 0.4));
  g.beginPath();
  g.arc(cx, cy, Math.max(1, c.r * tr.s * 0.4), 0, TAU);
  g.fill();
};
