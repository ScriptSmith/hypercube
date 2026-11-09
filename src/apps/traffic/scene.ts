/**
 * Drawing a touch frame: three canvases, all in venue px. The background (verges, the road and
 * a roadside speed sign) is redrawn on resize or when the limit changes; the moving picture
 * (diagram, cars, hands and ripples) every frame; the controls when they change.
 */
import type { FrameInfo } from "../../core/types";
import {
  bodyColor,
  drawCar,
  drawControls,
  drawHand,
  drawRipple,
  drawSign,
  paintCircleRoad,
  paintLoopRoad,
  paintStraightRoad,
  VERGE,
  type ControlState,
} from "./art";
import { BACKDROP, type Diagram } from "./diagram";
import type { FrameLayout, Placement } from "./layout";
import { LIMIT_SIGNS } from "./model";
import { FLAG, type WireCar } from "./wire";

type Ctx = CanvasRenderingContext2D;

export interface Ripple {
  x: number;
  y: number;
  at: number;
  hit: boolean;
}

export interface DrawnCar {
  id: number;
  x: number;
  y: number;
  angle: number;
}

export interface SceneState {
  cars: readonly WireCar[];
  length: number;
  /** Local ms. */
  now: number;
  /** Cars a finger on this frame is braking, until local ms (brake lights at once). */
  pressed: ReadonlyMap<number, number>;
  ripples: readonly Ripple[];
  diagram: Diagram | null;
  /** Fraction of a row since the diagram's newest row. */
  frac: number;
  /** The diagram shows these fractions of the ring. */
  f0: number;
  f1: number;
  /** Dims the road (versus between rounds), 0 to 1. */
  fade?: number;
  /** Extra drawing on top (versus). */
  extra?(g: Ctx): void;
}

export interface Scene {
  setup(frame: FrameInfo, layout: FrameLayout): void;
  /** Repaint the background with this speed limit on the roadside sign. */
  background(limit: number): void;
  draw(s: SceneState): void;
  controls(s: ControlState): void;
  /** Cars drawn last frame and where, venue px, for touches. */
  readonly drawn: readonly DrawnCar[];
  dispose(): void;
}

const FADE_IN_MS = 500;
const HAND_MS = 900;

export const createScene = (root: HTMLElement): Scene => {
  const make = (z: number) => {
    const c = document.createElement("canvas");
    c.style.cssText = `position:absolute;left:0;top:0;pointer-events:none;z-index:${z};`;
    root.append(c);
    return c;
  };
  const bg = make(0);
  const fg = make(1);
  const ui = make(2);
  const gb = bg.getContext("2d");
  const gf = fg.getContext("2d");
  const gu = ui.getContext("2d");
  let layout: FrameLayout | null = null;
  let scale = 1;
  let unit = 1;
  let limitShown = -1;
  const drawn: DrawnCar[] = [];
  const seen = new Map<number, number>();
  const ghostSince = new Map<number, number>();
  const places: Placement[] = [];

  const size = (c: HTMLCanvasElement, f: FrameInfo) => {
    c.width = Math.max(1, Math.round(f.width * f.pixelRatio));
    c.height = Math.max(1, Math.round(f.height * f.pixelRatio));
    c.style.width = `${f.width}px`;
    c.style.height = `${f.height}px`;
  };

  const paintBg = (limit: number) => {
    const l = layout;
    if (!gb || !l) return;
    limitShown = limit;
    gb.setTransform(scale, 0, 0, scale, 0, 0);
    gb.fillStyle = BACKDROP;
    gb.fillRect(0, 0, l.width, l.height);
    if (l.circle) {
      const c = l.circle;
      if (l.ground) {
        gb.fillStyle = VERGE;
        gb.fillRect(l.ground.x, l.ground.y, l.ground.width, l.ground.height);
      }
      paintCircleRoad(gb, c);
      // The sign in the middle of the circle.
      const r = Math.max(62, Math.min(150, c.r * 0.16));
      drawSign(gb, c.cx, c.cy, r, LIMIT_SIGNS[limit] ?? 50);
    } else if (l.loop) {
      gb.fillStyle = VERGE;
      gb.fillRect(0, l.diagram.y + l.diagram.height, l.width, l.height);
      paintLoopRoad(gb, l.loop, l.carW * 1.5);
      // Signs inside the loop.
      const r = 62;
      drawSign(gb, (l.loop.xl + l.loop.xr) / 2, l.loop.yc, r, LIMIT_SIGNS[limit] ?? 50);
    } else {
      paintStraightRoad(gb, l.road, l.width, l.height);
      const r = l.kind === "wall" ? 64 : 52;
      const below = l.road.y + l.road.height + r + 26;
      // Signs on the verge, two per frame (one on a panel), never on a pair's seam.
      const xs = l.kind === "wall" ? [l.width * 0.33, l.width * 0.83] : [l.width * 0.25];
      if (below + r < l.height) {
        for (const x of xs) {
          gb.fillStyle = "#3a4152";
          gb.fillRect(x - 5, below, 10, Math.min(l.height - below, r * 1.3));
          drawSign(gb, x, below, r, LIMIT_SIGNS[limit] ?? 50);
        }
      }
    }
  };

  return {
    get drawn() {
      return drawn;
    },
    setup(frame, l) {
      layout = l;
      unit = frame.unit;
      scale = frame.unit * frame.pixelRatio;
      for (const c of [bg, fg, ui]) size(c, frame);
      paintBg(limitShown < 0 ? 1 : limitShown);
    },
    background(limit) {
      if (limit !== limitShown) paintBg(limit);
    },
    controls(s) {
      const l = layout;
      if (!gu || !l) return;
      gu.setTransform(1, 0, 0, 1, 0, 0);
      gu.clearRect(0, 0, ui.width, ui.height);
      gu.setTransform(scale, 0, 0, scale, 0, 0);
      drawControls(gu, l.controls, s);
    },
    draw(s) {
      const l = layout;
      if (!gf || !l) return;
      gf.setTransform(1, 0, 0, 1, 0, 0);
      gf.clearRect(0, 0, fg.width, fg.height);
      gf.setTransform(scale, 0, 0, scale, 0, 0);
      if (s.diagram) s.diagram.draw(gf, l.diagram, s.frac);
      drawn.length = 0;
      const path = l.path;
      if (!path) return;
      const fade = s.fade ?? 0;
      for (const c of s.cars) {
        let first = seen.get(c.id);
        if (first === undefined) {
          if (seen.size > 512) seen.clear();
          first = s.now;
          seen.set(c.id, first);
        }
        const n = path.place(c.x, s.length, places);
        if (n === 0) continue;
        const held = (s.pressed.get(c.id) ?? -1) > s.now;
        const braking = held || (c.flags & FLAG.brake) !== 0;
        const smart = (c.flags & FLAG.smart) !== 0;
        const alpha = Math.min(1, (s.now - first) / FADE_IN_MS) * (1 - fade * 0.7);
        for (const p of places) {
          drawn.push({ id: c.id, x: p.x, y: p.y, angle: p.angle });
          gf.save();
          gf.translate(p.x, p.y);
          gf.rotate(p.angle);
          if (held || c.flags & FLAG.touched) {
            gf.beginPath();
            gf.roundRect(
              -l.carPx / 2 - 14,
              -l.carW / 2 - 14,
              l.carPx + 28,
              l.carW + 28,
              l.carW * 0.5,
            );
            gf.strokeStyle = "rgba(255,255,255,0.85)";
            gf.lineWidth = 6;
            gf.stroke();
          }
          drawCar(gf, l.carPx, l.carW, bodyColor(c.id, smart), smart, braking, alpha);
          gf.restore();
        }
      }
      // The attract mode's hand, over the car it brakes.
      for (const c of s.cars) {
        if (!(c.flags & FLAG.ghost)) {
          ghostSince.delete(c.id);
          continue;
        }
        let since = ghostSince.get(c.id);
        if (since === undefined) {
          if (ghostSince.size > 32) ghostSince.clear();
          since = s.now;
          ghostSince.set(c.id, since);
        }
        const k = Math.min(1, (s.now - since) / HAND_MS);
        const at = drawn.find((d) => d.id === c.id);
        if (at) {
          const size = l.carPx * 1.5;
          drawHand(gf, at.x, at.y - l.carW * 0.1 - (1 - k) * 60, size, 0.85 * Math.min(1, k * 2));
        }
      }
      for (const r of s.ripples) {
        drawRipple(
          gf,
          r.x,
          r.y,
          r.hit ? 110 : 80,
          (s.now - r.at) / 600,
          r.hit ? "#ffffff" : "#8a94a8",
        );
      }
      s.extra?.(gf);
      void unit;
    },
    dispose() {
      for (const c of [bg, fg, ui]) {
        c.width = 1;
        c.height = 1;
        c.remove();
      }
      seen.clear();
      ghostSince.clear();
      drawn.length = 0;
    },
  };
};
