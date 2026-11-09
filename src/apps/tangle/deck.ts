/**
 * The touch side of a frame: each station's turn or direction pads, its heading arrow and short status,
 * and on a bank frame (while the screen holds the arena) a large status above each station.
 * Drawn on one 2D canvas covering just the stations and their status areas.
 */
import type { Palette, Rect } from "../../core/types";
import { FONT, withAlpha } from "../../core/ui";
import type { FrameLayout, StationLayout } from "./layout";
import type { Phase } from "./match";

export interface StationStatus {
  state: "idle" | "calibrating" | "ready" | "playing";
  bot: boolean;
  /** Pads held now, a bit per pad, for lighting them. */
  held: number;
  /** Direction pads: the way the line is going (0 to 3), or -1. */
  facing: number;
  phase: Phase;
  attract: boolean;
  /** In the round being played, as themselves. */
  inRound: boolean;
  alive: boolean;
  /** The line's heading in radians, while it runs. */
  heading: number | null;
  /** Placing after a round. */
  place: number | null;
  /** Seconds to the start of the next round, while waiting for it. */
  nextIn: number | null;
  /** Seconds left of the countdown before play. */
  countdown: number | null;
}

export interface Deck {
  /** `linked`: a screen holds the arena, so show each station's status above it. */
  draw(status: readonly StationStatus[], linked: boolean, dt: number): void;
  dispose(): void;
}

const union = (rects: readonly Rect[]): Rect => {
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.width));
  const y1 = Math.max(...rects.map((r) => r.y + r.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
};

export const createDeck = (
  host: HTMLElement,
  layout: FrameLayout,
  colors: readonly string[],
  palette: Palette,
  unit: number,
  pixelRatio: number,
): Deck => {
  const area = union([
    ...layout.stations.map((s) => s.rect),
    ...layout.status.filter((r): r is Rect => r !== null),
  ]);
  const canvas = document.createElement("canvas");
  const k = unit * pixelRatio;
  canvas.width = Math.max(1, Math.round(area.width * k));
  canvas.height = Math.max(1, Math.round(area.height * k));
  canvas.style.cssText =
    `position:absolute;left:${area.x * unit}px;top:${area.y * unit}px;` +
    `width:${area.width * unit}px;height:${area.height * unit}px;pointer-events:none;z-index:1;`;
  host.append(canvas);
  const g = canvas.getContext("2d");
  let clock = 0;

  const rounded = (r: Rect, radius: number) => {
    if (!g) return;
    g.beginPath();
    g.roundRect(r.x, r.y, r.width, r.height, radius);
  };

  /** A bold arrow curving from straight ahead towards `dir`. */
  const turnArrow = (cx: number, cy: number, s: number, dir: -1 | 1, color: string) => {
    if (!g) return;
    const x0 = cx - dir * s * 0.12;
    g.strokeStyle = color;
    g.fillStyle = color;
    g.lineWidth = s * 0.13;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.beginPath();
    g.moveTo(x0, cy + s * 0.36);
    g.lineTo(x0, cy + s * 0.02);
    g.quadraticCurveTo(x0, cy - s * 0.26, x0 + dir * s * 0.26, cy - s * 0.26);
    g.stroke();
    const tip = x0 + dir * s * 0.46;
    g.beginPath();
    g.moveTo(tip, cy - s * 0.26);
    g.lineTo(tip - dir * s * 0.22, cy - s * 0.44);
    g.lineTo(tip - dir * s * 0.22, cy - s * 0.08);
    g.closePath();
    g.fill();
  };

  /** A straight arrow pointing `d` quarter turns round from the right. */
  const dirArrow = (cx: number, cy: number, s: number, d: number, color: string) => {
    if (!g) return;
    g.save();
    g.translate(cx, cy);
    g.rotate((d * Math.PI) / 2);
    g.fillStyle = color;
    g.strokeStyle = color;
    g.lineJoin = "round";
    g.lineWidth = s * 0.06;
    g.beginPath();
    g.moveTo(s * 0.44, 0);
    g.lineTo(s * 0.02, -s * 0.4);
    g.lineTo(s * 0.02, -s * 0.15);
    g.lineTo(-s * 0.4, -s * 0.15);
    g.lineTo(-s * 0.4, s * 0.15);
    g.lineTo(s * 0.02, s * 0.15);
    g.lineTo(s * 0.02, s * 0.4);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  };

  /** An arrow pointing along `heading` (0 is right, y down). */
  const headingArrow = (cx: number, cy: number, s: number, heading: number, color: string) => {
    if (!g) return;
    g.save();
    g.translate(cx, cy);
    g.rotate(heading);
    g.fillStyle = color;
    g.shadowColor = color;
    g.shadowBlur = s * 0.3;
    g.beginPath();
    g.moveTo(s * 0.5, 0);
    g.lineTo(-s * 0.05, -s * 0.36);
    g.lineTo(-s * 0.05, -s * 0.13);
    g.lineTo(-s * 0.45, -s * 0.13);
    g.lineTo(-s * 0.45, s * 0.13);
    g.lineTo(-s * 0.05, s * 0.13);
    g.lineTo(-s * 0.05, s * 0.36);
    g.closePath();
    g.fill();
    g.restore();
  };

  const text = (t: string, x: number, y: number, size: number, color: string, weight = 800) => {
    if (!g) return;
    g.font = `${weight} ${size}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = color;
    g.fillText(t, x, y);
  };

  /** A ring that empties as `left` runs down to zero, with the seconds in it. */
  const timer = (cx: number, cy: number, r: number, left: number, of: number, color: string) => {
    if (!g) return;
    g.lineWidth = r * 0.16;
    g.strokeStyle = withAlpha(color, 0.25);
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = color;
    g.beginPath();
    g.arc(
      cx,
      cy,
      r,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(1, left / of)),
    );
    g.stroke();
    text(String(Math.max(0, Math.ceil(left))), cx, cy + r * 0.04, r * 1.05, color, 900);
  };

  const chevrons = (cx: number, cy: number, s: number, color: string) => {
    if (!g) return;
    g.lineWidth = s * 0.28;
    g.lineCap = "round";
    g.lineJoin = "round";
    for (let i = 0; i < 3; i++) {
      const phase = (clock * 0.9 + i * 0.22) % 1;
      g.strokeStyle = withAlpha(color, Math.max(0, Math.sin(phase * Math.PI)));
      const y = cy - (i - 1) * s * 1.1;
      g.beginPath();
      g.moveTo(cx - s, y + s * 0.5);
      g.lineTo(cx, y - s * 0.5);
      g.lineTo(cx + s, y + s * 0.5);
      g.stroke();
    }
  };

  const drawPads = (s: StationLayout, st: StationStatus, color: string) => {
    if (!g) return;
    const playing = st.state === "playing";
    const inviting = st.state === "idle";
    const pulse = 0.5 + 0.5 * Math.sin(clock * 3 + s.index);
    const aim = s.kind === "aim";
    s.pads.forEach((pad, i) => {
      const held = (st.held & (1 << i)) !== 0;
      // Direction pads: the way the line goes now is marked, and straight back does nothing.
      const facing = aim && playing && st.facing === i;
      const back = aim && playing && st.facing >= 0 && (st.facing + 2) % 4 === i;
      const radius = Math.min(pad.width, pad.height) * 0.16;
      rounded(pad, radius);
      g.fillStyle = withAlpha(
        color,
        held
          ? 0.5
          : facing
            ? 0.26
            : back
              ? 0.05
              : playing
                ? 0.14
                : 0.06 + (inviting ? 0.06 * pulse : 0),
      );
      g.fill();
      g.lineWidth = Math.max(3, Math.min(pad.width, pad.height) * (facing ? 0.04 : 0.025));
      g.strokeStyle = withAlpha(
        color,
        held || facing ? 1 : back ? 0.3 : playing ? 0.75 : 0.3 + (inviting ? 0.3 * pulse : 0),
      );
      if (held) {
        g.shadowColor = color;
        g.shadowBlur = pad.width * 0.12;
      }
      g.stroke();
      g.shadowBlur = 0;
      const size = Math.min(pad.width, pad.height) * 0.62;
      const tint = held ? palette.foreground : withAlpha(color, back ? 0.3 : playing ? 0.95 : 0.45);
      const cx = pad.x + pad.width / 2;
      const cy = pad.y + pad.height / 2;
      if (aim) dirArrow(cx, cy, size, i, tint);
      else turnArrow(cx, cy, size, i === 0 ? -1 : 1, tint);
    });
  };

  /** The small area at the top of a station. */
  const drawInfo = (s: StationLayout, st: StationStatus, color: string) => {
    const r = s.info;
    if (r.width < 40 || r.height < 40) return;
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const size = Math.min(r.width, r.height);
    if (st.nextIn !== null) timer(cx, cy, size * 0.36, st.nextIn, 90, color);
    else if (st.countdown !== null)
      text(String(Math.ceil(st.countdown)), cx, cy, size * 0.8, color, 900);
    // Direction pads already mark the way the line goes; an arrow beside them looks like a pad.
    else if (st.inRound && st.alive && st.heading !== null && s.kind !== "aim")
      headingArrow(cx, cy, size * 0.85, st.heading, color);
    else if (st.place !== null)
      text(String(st.place), cx, cy, size * 0.8, st.place === 1 ? palette.accent : color, 900);
  };

  /** The big status above a bank station while the screen holds the arena. */
  const drawStatus = (r: Rect, st: StationStatus, color: string) => {
    const cx = r.x + r.width / 2;
    const size = Math.min(r.width * 0.8, r.height * 0.45);
    const label = (t: string, y: number, c = palette.foreground) =>
      text(t, cx, y, Math.min(r.width * 0.12, 110), c);
    if (st.state === "idle" || st.state === "calibrating") {
      chevrons(cx, r.y + r.height * 0.4, size * 0.16, withAlpha(color, 0.7));
      label("Look up", r.y + r.height * 0.72, withAlpha(palette.foreground, 0.6));
      return;
    }
    if (st.nextIn !== null) {
      timer(cx, r.y + r.height * 0.42, size * 0.3, st.nextIn, 90, color);
      label("Next round", r.y + r.height * 0.75);
      return;
    }
    if (st.countdown !== null) {
      text(String(Math.ceil(st.countdown)), cx, r.y + r.height * 0.42, size * 0.7, color, 900);
      label("Look up", r.y + r.height * 0.78);
      return;
    }
    if (st.phase === "play" && st.inRound) {
      if (st.alive && st.heading !== null) {
        headingArrow(cx, r.y + r.height * 0.42, size * 0.75, st.heading, color);
        label("Look up", r.y + r.height * 0.8, withAlpha(palette.foreground, 0.7));
      } else {
        text("Out", cx, r.y + r.height * 0.42, size * 0.3, withAlpha(color, 0.8), 900);
      }
      return;
    }
    if (st.phase === "over" && st.place !== null) {
      text(
        String(st.place),
        cx,
        r.y + r.height * 0.42,
        size * 0.6,
        st.place === 1 ? palette.accent : color,
        900,
      );
      return;
    }
    chevrons(cx, r.y + r.height * 0.4, size * 0.16, color);
    label("Look up", r.y + r.height * 0.72);
  };

  return {
    draw(status, linked, dt) {
      if (!g) return;
      clock += dt;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.setTransform(k, 0, 0, k, -area.x * k, -area.y * k);
      layout.stations.forEach((s, j) => {
        const st = status[j];
        if (!st) return;
        const color = colors[j] ?? palette.accent;
        drawPads(s, st, color);
        const r = layout.status[j];
        if (linked && r) drawStatus(r, st, color);
        else if (st.state === "playing") drawInfo(s, st, color);
        // Stacked stations have no room above them; the gap between them says where to look.
        if (linked && s.tier === "high") {
          const below = layout.stations.find((o) => o.tier === "low" && o.rect.x === s.rect.x);
          const gap = below ? below.rect.y - (s.rect.y + s.rect.height) : 0;
          if (gap > 60) {
            const y = s.rect.y + s.rect.height + gap / 2;
            text(
              "Look up",
              s.rect.x + s.rect.width / 2,
              y,
              Math.min(gap * 0.5, 90),
              withAlpha(palette.foreground, 0.7),
            );
          }
        }
      });
    },
    dispose() {
      canvas.remove();
    },
  };
};
