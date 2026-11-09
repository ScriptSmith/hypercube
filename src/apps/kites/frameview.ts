/**
 * Drawing a touch frame: the park with its spools and stunt bars, and either the frame's own sky
 * (kites, rings, clouds, trees) or, under a screen, just the lines rising to the top edge. Two
 * canvases: a static background redrawn on resize or a change of sky, and the moving picture.
 * Everything is drawn in venue px.
 *
 * The spool is a big round button with a kite and up arrows on it, and its rim is the reel.
 * Held, it sinks in inside a bright ring, the reel spins, marks on the line run down into it,
 * the arrows climb and the kite climbs. In attract a ghost hand holds it while the autopilot
 * reels in.
 */
import type { FrameInfo } from "../../core/types";
import { withAlpha } from "../../core/ui";
import { drawHand, drawLine, linePoint, type Sparkles, tint } from "./art";
import { drawKiteViews, type KiteView } from "./draw";
import type { Layout } from "./layout";
import type { Grip, Patch, SpoolButton } from "./patch";
import type { Ring } from "./rings";
import {
  drawAttribution,
  drawRings,
  drawTally,
  paintFoliage,
  paintPark,
  paintSky,
  type SkyRect,
  type SkyScene,
} from "./scene";

type Ctx = CanvasRenderingContext2D;

/** Depth of the foliage strip at the top of a frame under a screen, venue px. */
export const FOLIAGE = 170;

export interface FrameScene {
  mode: "bank" | "local";
  layout: Layout;
  patches: readonly Patch[];
  colors: readonly string[];
  /** Kites in the frame's own sky (local mode). */
  views: readonly KiteView[];
  /** Per patch: where the spool line and the stunt kite's left and right lines cross the sky's bottom edge. */
  exits: readonly number[];
  /** The sky's bottom edge, venue px: the horizon, or 0 under a screen. */
  baseY: number;
  rings: readonly Ring[];
  ringRadius: number;
  hideRing(id: number): boolean;
  tally: ReadonlyMap<number, number>;
  sky: SkyRect;
  t: number;
  now: number;
  /** Local ms when each kite was last touched, for the invite pulse. */
  attribution: string | null;
  sparkles: Sparkles;
  scenery: SkyScene;
}

export interface FrameView {
  setup(frame: FrameInfo, layout: Layout, mode: "bank" | "local"): void;
  draw(s: FrameScene): void;
  dispose(): void;
}

/** A grip untouched this long pulses to invite a touch. */
const INVITE_MS = 6000;

const roundRect = (g: Ctx, x: number, y: number, w: number, h: number, r: number) => {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
};

const chevron = (g: Ctx, x: number, y: number, s: number, color: string) => {
  g.strokeStyle = color;
  g.lineWidth = s * 0.22;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(x - s * 0.5, y - s * 0.22);
  g.lineTo(x, y + s * 0.28);
  g.lineTo(x + s * 0.5, y - s * 0.22);
  g.stroke();
};

const drawGrip = (g: Ctx, grip: Grip, color: string, invite: number, t: number) => {
  const s = grip.spec;
  const held = grip.pointer !== null;
  // Track.
  roundRect(g, s.x - s.w * 0.18, s.restY - s.h / 2, s.w * 0.36, s.travel + s.h, s.w * 0.18);
  g.fillStyle = "rgba(5,12,10,0.45)";
  g.fill();
  if (invite > 0) {
    const p = 0.5 + 0.5 * Math.sin(t * 4);
    g.save();
    g.globalAlpha = invite * (0.25 + 0.35 * p);
    roundRect(g, s.x - s.w / 2 - 22, grip.y - s.h / 2 - 22, s.w + 44, s.h + 44, s.h / 2 + 22);
    g.fillStyle = withAlpha(color, 0.6);
    g.fill();
    g.restore();
  }
  roundRect(g, s.x - s.w / 2, grip.y - s.h / 2, s.w, s.h, s.h * 0.32);
  g.fillStyle = held ? tint(color, 0.35) : color;
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = tint(color, -0.4);
  g.stroke();
  // A sheen along the top, so it reads as something to hold rather than a flat button.
  roundRect(g, s.x - s.w / 2 + 14, grip.y - s.h / 2 + 10, s.w - 28, s.h * 0.22, s.h * 0.11);
  g.fillStyle = "rgba(255,255,255,0.22)";
  g.fill();
  chevron(g, s.x, grip.y, Math.min(s.h, s.w) * 0.5, "rgba(5,7,13,0.78)");
};

/** Marks on the spool's line, per turn of the reel, so they move with the rim. */
const MARKS_PER_TURN = 14;

/** The spool's line from the top of the reel to the sky's edge, with marks that move with it. */
const drawSpoolLine = (
  g: Ctx,
  b: SpoolButton,
  ex: number,
  ey: number,
  tension: number,
  width: number,
) => {
  const s = b.spec;
  const x0 = s.x;
  const y0 = s.y - s.r;
  drawLine(g, x0, y0, ex, ey, tension, width);
  const gap = (Math.PI * 2 * s.r) / MARKS_PER_TURN;
  const len = Math.hypot(ex - x0, ey - y0);
  if (len < gap) return;
  // Line reeled in moves towards the reel, so the marks run down it.
  const shift = gap - ((((b.turn * s.r) % gap) + gap) % gap);
  g.fillStyle = "rgba(20,30,48,0.55)";
  for (let d = shift; d < len; d += gap) {
    const p = linePoint(x0, y0, ex, ey, tension, d / len);
    g.beginPath();
    g.arc(p.x, p.y, width * 1.1, 0, Math.PI * 2);
    g.fill();
  }
};

const upArrow = (g: Ctx, x: number, y: number, w: number, lw: number) => {
  g.beginPath();
  g.moveTo(x - w / 2, y + w * 0.3);
  g.lineTo(x, y - w * 0.2);
  g.lineTo(x + w / 2, y + w * 0.3);
  g.lineWidth = lw;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.stroke();
};

/** A white diamond kite with its spars and a tail with bows, `h` tall, centred on (x, y). */
const kiteIcon = (g: Ctx, x: number, y: number, h: number, spar: string) => {
  const w = h * 0.7;
  const top = y - h * 0.42;
  const mid = y - h * 0.1;
  const bottom = y + h * 0.5;
  g.lineCap = "round";
  g.lineJoin = "round";
  // The tail, waving down and to one side, with two bows.
  g.strokeStyle = "#f4f7fb";
  g.lineWidth = h * 0.045;
  g.beginPath();
  g.moveTo(x, bottom);
  g.bezierCurveTo(
    x - h * 0.2,
    bottom + h * 0.12,
    x + h * 0.08,
    bottom + h * 0.26,
    x - h * 0.16,
    bottom + h * 0.4,
  );
  g.stroke();
  g.fillStyle = "#f4f7fb";
  for (const [bx, by] of [
    [x - h * 0.06, bottom + h * 0.13],
    [x - h * 0.06, bottom + h * 0.3],
  ] as const) {
    const bw = h * 0.09;
    g.beginPath();
    g.moveTo(bx - bw, by - bw * 0.6);
    g.lineTo(bx + bw, by + bw * 0.6);
    g.lineTo(bx + bw, by - bw * 0.6);
    g.lineTo(bx - bw, by + bw * 0.6);
    g.closePath();
    g.fill();
  }
  // The sail and its spars, outlined so it shows on a light colour too.
  g.beginPath();
  g.moveTo(x, top);
  g.lineTo(x + w / 2, mid);
  g.lineTo(x, bottom);
  g.lineTo(x - w / 2, mid);
  g.closePath();
  g.lineWidth = h * 0.06;
  g.strokeStyle = spar;
  g.stroke();
  g.fill();
  g.lineWidth = h * 0.04;
  g.beginPath();
  g.moveTo(x, top + h * 0.05);
  g.lineTo(x, bottom - h * 0.05);
  g.moveTo(x - w / 2 + h * 0.05, mid);
  g.lineTo(x + w / 2 - h * 0.05, mid);
  g.stroke();
};

/**
 * The spool button: a reel rim that turns, and a face that sinks in inside a bright ring while
 * held, showing a kite with up arrows that climb while it reels in.
 */
const drawSpool = (
  g: Ctx,
  b: SpoolButton,
  color: string,
  invite: number,
  ghost: boolean,
  t: number,
) => {
  const s = b.spec;
  const { x, y, r } = s;
  const press = b.press;
  if (invite > 0) {
    // A ring that swells out from the rim, inviting a touch.
    const f = (t * 0.8) % 1;
    g.beginPath();
    g.arc(x, y, r * (1.02 + 0.3 * f), 0, Math.PI * 2);
    g.lineWidth = r * 0.07;
    g.strokeStyle = withAlpha(color, invite * 0.55 * (1 - f));
    g.stroke();
  }
  if (press > 0.02) {
    g.beginPath();
    g.arc(x, y, r * 1.12, 0, Math.PI * 2);
    g.fillStyle = withAlpha(color, 0.3 * press);
    g.fill();
    g.lineWidth = r * 0.05;
    g.strokeStyle = withAlpha(tint(color, 0.45), 0.9 * press);
    g.stroke();
  }
  // The reel: a dark rim with string wound on it and knobs that turn with it.
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = tint(color, -0.55);
  g.fill();
  g.beginPath();
  g.arc(x, y, r * 0.88, 0, Math.PI * 2);
  g.fillStyle = "rgba(236,242,250,0.9)";
  g.fill();
  g.strokeStyle = "rgba(60,72,92,0.35)";
  g.lineWidth = r * 0.012;
  for (const f of [0.83, 0.79]) {
    g.beginPath();
    g.arc(x, y, r * f, 0, Math.PI * 2);
    g.stroke();
  }
  g.fillStyle = tint(color, -0.2);
  for (let i = 0; i < 8; i++) {
    const a = b.turn + (i * Math.PI) / 4;
    g.beginPath();
    g.arc(x + Math.cos(a) * r * 0.94, y + Math.sin(a) * r * 0.94, r * 0.055, 0, Math.PI * 2);
    g.fill();
  }
  // The face: raised when free, pressed in and darker while held.
  const fr = r * (0.74 - 0.05 * press);
  g.beginPath();
  g.arc(x, y, fr, 0, Math.PI * 2);
  g.fillStyle = press > 0.5 ? tint(color, -0.18) : color;
  g.fill();
  g.lineWidth = r * 0.04;
  g.strokeStyle = tint(color, -0.35);
  g.stroke();
  if (press < 0.5) {
    g.beginPath();
    g.ellipse(x, y - fr * 0.5, fr * 0.62, fr * 0.26, 0, 0, Math.PI * 2);
    g.fillStyle = "rgba(255,255,255,0.2)";
    g.fill();
  } else {
    g.beginPath();
    g.arc(x, y, fr, 0, Math.PI * 2);
    g.lineWidth = r * 0.06;
    g.strokeStyle = "rgba(5,10,20,0.18)";
    g.stroke();
  }
  // A kite with arrows above it; the arrows climb and the kite lifts while it reels in.
  kiteIcon(g, x, y + r * 0.1 - r * 0.07 * press, r * 0.6, tint(color, -0.45));
  g.save();
  g.beginPath();
  g.arc(x, y, fr * 0.97, 0, Math.PI * 2);
  g.clip();
  const step = r * 0.19;
  const run = b.reeling ? ((t * 1.8) % 1) * step : 0;
  for (let i = 0; i < 3; i++) {
    const ay = y - r * 0.33 - i * step - run;
    const fade = Math.max(0, Math.min(1, (ay - (y - fr * 0.95)) / (step * 0.9)));
    g.globalAlpha = fade;
    g.strokeStyle = tint(color, -0.45);
    upArrow(g, x, ay, r * 0.34, r * 0.115);
    g.strokeStyle = "#f4f7fb";
    upArrow(g, x, ay, r * 0.34, r * 0.075);
  }
  g.restore();
  if (ghost) {
    // A ghost hand holds the button while the autopilot reels in and lifts away between holds.
    const away = 1 - press;
    drawHand(
      g,
      x + r * 0.3 + away * r * 0.18,
      y + r * 0.42 + away * r * 0.3,
      r * 1.15,
      0.62 + 0.3 * press,
    );
  }
};

export const createFrameView = (root: HTMLElement): FrameView => {
  const bg = document.createElement("canvas");
  const fg = document.createElement("canvas");
  bg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
  fg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
  root.append(bg, fg);
  const gb = bg.getContext("2d");
  const gf = fg.getContext("2d");
  let k = 1;
  let layout: Layout | null = null;

  return {
    setup(frame, l, mode) {
      layout = l;
      const pr = frame.pixelRatio;
      for (const c of [bg, fg]) {
        c.width = Math.max(1, Math.round(frame.width * pr));
        c.height = Math.max(1, Math.round(frame.height * pr));
      }
      k = frame.unit * pr;
      if (!gb) return;
      gb.setTransform(k, 0, 0, k, 0, 0);
      const W = l.width;
      const H = l.height;
      if (mode === "local") {
        paintSky(gb, { x: 0, y: 0, w: W, h: l.horizon }, l.horizon);
        paintPark(gb, 0, l.horizon, W, H, 90);
      } else {
        paintPark(gb, 0, 0, W, H, 90);
        paintFoliage(gb, W, FOLIAGE, 11);
      }
      // A soft shadow between patches on a wall.
      if (l.kind === "wall") {
        gb.fillStyle = "rgba(0,0,0,0.12)";
        for (const p of l.patches.slice(1)) gb.fillRect(p.x0 - 2, l.horizon, 4, H - l.horizon);
      }
    },
    draw(s) {
      if (!gf || !layout) return;
      gf.setTransform(1, 0, 0, 1, 0, 0);
      gf.clearRect(0, 0, fg.width, fg.height);
      gf.setTransform(k, 0, 0, k, 0, 0);
      const local = s.mode === "local";
      if (local) {
        s.scenery.drawBack(gf, s.sky);
        drawRings(gf, s.sky, s.rings, s.ringRadius, s.t, s.hideRing);
        s.scenery.drawFront(gf, s.sky, s.t, layout.kind === "wall" ? 0.975 : 0.92);
      }
      const lineW = layout.kind === "wall" ? 5 : local ? 4 : 6;
      // Lines on the park: from each control up to where it crosses the sky's bottom edge.
      s.patches.forEach((p, i) => {
        const sx = s.exits[i * 3] ?? p.spec.cx;
        drawSpoolLine(gf, p.button, sx, s.baseY, p.button.reeling ? 1 : p.spool.tension, lineW);
        if (p.stunt && p.grips.left && p.grips.right && p.spec.stunt) {
          const l = p.grips.left;
          const r = p.grips.right;
          const el = s.exits[i * 3 + 1] ?? l.spec.x;
          const er = s.exits[i * 3 + 2] ?? r.spec.x;
          drawLine(gf, l.spec.x, l.y - l.spec.h / 2, el, s.baseY, 1, lineW);
          drawLine(gf, r.spec.x, r.y - r.spec.h / 2, er, s.baseY, 1, lineW);
        }
      });
      if (local) {
        drawKiteViews(gf, s.views, lineW, s.t);
        s.sparkles.draw(gf, layout.kind === "wall" ? 16 : 12);
        drawTally(gf, s.sky, s.tally, s.colors, layout.kind === "wall" ? 22 : 16);
      }
      // Controls.
      for (const p of s.patches) {
        const color = s.colors[p.color % s.colors.length] ?? "#6fa4fc";
        const auto = p.modes.spool === "auto";
        const inviteSpool = !auto && s.now - p.touched.spool > INVITE_MS ? 1 : 0;
        drawSpool(gf, p.button, color, inviteSpool, auto, s.t);
        if (p.grips.left && p.grips.right) {
          const invite = p.modes.stunt === "auto" || s.now - p.touched.stunt > INVITE_MS ? 1 : 0;
          const handleColor = tint(color, 0.15);
          drawGrip(gf, p.grips.left, handleColor, invite, s.t + 0.4);
          drawGrip(gf, p.grips.right, handleColor, invite, s.t + 0.4);
        }
      }
      // Under a screen the screen shows the attribution.
      if (s.attribution && local) {
        drawAttribution(
          gf,
          s.attribution,
          layout.width - 24,
          18,
          layout.kind === "wall" ? 30 : 24,
          "right",
        );
      }
    },
    dispose() {
      bg.remove();
      fg.remove();
    },
  };
};
