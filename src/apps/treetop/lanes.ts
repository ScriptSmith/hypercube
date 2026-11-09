/**
 * Drawing one game's lanes (game.ts): each lane's view of the course following its glider, the
 * gliders it races, effects, the timer, the pack strip and the numerals over it. A panel draws
 * its lanes with one drawer; a wall draws each column of lanes with its own.
 */
import type { FrameInfo, Palette } from "../../core/types";
import type { Atlas } from "./art";
import { type FlapConfig, START_Y } from "./config";
import { distanceOf, type Flight, type FlightEvent } from "./flight";
import { type Game, type GameLane, LOOP_R } from "./game";
import { ghostAt } from "./ghost";
import { type Gfx, rgb, type Rgb, WHITE } from "./gl";
import type { LaneSpec } from "./layout";
import { createLabel, createNumeral, type Label, type Numeral, placeColor } from "./numerals";
import {
  angleFor,
  drawFlyer,
  drawWorld,
  type Particles,
  poseFor,
  SKY_DARK,
  sx,
  sy,
  type Viewport,
} from "./scene";

/** Where a lane's glider sits across its view, as a fraction of the lane width. */
const CAM_LEAD = 0.3;
/** Results loop speed in radians per second. */
export const LOOP_W = 1.6;
/** An idle lane's view drifts along the course at this fraction of the base speed. */
const DRIFT = 0.25;
/** Lanes shorter than this have no room for a label under the timer. */
const LABEL_MIN_H = 1200;

export interface LaneView {
  spec: LaneSpec;
  /** Colour order across the bank. */
  index: number;
  color: string;
  rgb: Rgb;
  rings: number;
  test: boolean;
  idleSince: number;
  cam: number;
  shake: number;
  /** The next-race timer's centre and ring radius, venue px. */
  timerAt: TimerSpot;
  count: Numeral;
  place: Numeral;
  timer: Numeral;
  label: Label;
}

/** The camera that puts a glider on the start line at its usual place across the lane. */
export const startCam = (spec: LaneSpec): number => -CAM_LEAD * (spec.rect.width / spec.scale);

export interface TimerSpot {
  x: number;
  y: number;
  r: number;
  /** Centre of the label under the ring. */
  labelY: number;
}

/** Where a lane's next-race timer goes, venue px: centre, ring radius and label. */
export const timerSpot = (spec: LaneSpec): TimerSpot => {
  const y = spec.rect.y + spec.rect.height * 0.24;
  const r = Math.min(spec.rect.width, spec.rect.height) * 0.11;
  return { x: spec.rect.x + spec.rect.width / 2, y, r, labelY: y + r + 70 };
};

/** A lane's view and its numerals in `hud`. `u` is stage px per venue px. */
export const createLaneView = (
  hud: HTMLElement,
  spec: LaneSpec,
  index: number,
  color: string,
  rings: number,
  u: number,
  cam = startCam(spec),
  t = timerSpot(spec),
): LaneView => {
  const centre = {
    x: (spec.rect.x + spec.rect.width / 2) * u,
    y: (spec.rect.y + spec.rect.height / 2) * u,
  };
  const big = Math.min(spec.rect.width, spec.rect.height) * u;
  return {
    spec,
    index,
    color,
    rgb: rgb(color),
    rings,
    test: false,
    idleSince: -Infinity,
    cam,
    shake: 0,
    timerAt: t,
    count: createNumeral(hud, { ...centre, size: big * 0.5 }, "count"),
    place: createNumeral(hud, { ...centre, size: big * 0.5 }, "place"),
    timer: createNumeral(hud, { x: t.x * u, y: t.y * u, size: t.r * 0.95 * u }, "plain"),
    label: createLabel(hud, { x: t.x * u, y: t.labelY * u, size: 62 * u }),
  };
};

export const disposeLaneView = (v: LaneView): void => {
  v.count.dispose();
  v.place.dispose();
  v.timer.dispose();
  v.label.dispose();
};

/** Feathers and sparks for a crash, sparks for a gate, confetti at the finish. */
export const burstFor = (
  particles: Particles,
  e: FlightEvent,
  f: Flight,
  color: Rgb,
  owner: number,
  lane: boolean,
): void => {
  if (e.type === "crash") {
    particles.burst("feather", f.x, f.y, 14, color, 520, 46, owner);
    particles.burst("spark", f.x, f.y, 6, [1, 0.6, 0.4], 420, 70, owner);
  } else if (e.type === "gate" && lane) {
    particles.burst("spark", f.x - 30, f.y, 5, color, 300, 44, owner);
  } else if (e.type === "finish") {
    particles.burst("confetti", f.x, f.y, 40, color, 900, 26, owner);
  }
};

export interface LaneDrawerDeps {
  gfx: Gfx;
  atlas(): Atlas | null;
  frame(): FrameInfo;
  game: Game;
  cfg: FlapConfig;
  palette: Palette;
  particles: Particles;
  /** Clock ms. */
  now(): number;
  /** A screen above shows the race, so lanes have no pack strip. */
  hasScreen(): boolean;
  colorAt(index: number): string;
  rivalRgb(f: Flight): Rgb;
  viewOf(l: GameLane): LaneView | undefined;
  /** Lanes at least this tall, venue px, label their timer. */
  labelMinH?: number;
}

export interface LaneDrawer {
  /** Draw one lane. `alpha` interpolates between steps; `time` is seconds; `dt` since last. */
  draw(l: GameLane, v: LaneView, alpha: number, time: number, dt: number): void;
  /** Update every lane's numerals. */
  numerals(now: number): void;
}

export const createLaneDrawer = (deps: LaneDrawerDeps): LaneDrawer => {
  const { gfx, game, cfg, palette, particles } = deps;

  const laneWidth = (v: LaneView) => v.spec.rect.width / v.spec.scale;

  const bank = () => game.plan.play === "bank";
  const over = () => game.phase === "results" || game.phase === "lobby";

  const viewportOf = (v: LaneView): Viewport => {
    const frame = deps.frame();
    const k = frame.unit * frame.pixelRatio;
    const r = v.spec.rect;
    const shake = v.shake > 0 ? Math.sin(performance.now() * 0.09) * v.shake * 14 * k : 0;
    return {
      x: r.x * k,
      y: r.y * k,
      w: r.width * k,
      h: r.height * k,
      s: v.spec.scale * k,
      camX: v.cam + shake / (v.spec.scale * k),
      top: r.y * k,
    };
  };

  /** Where a glider is drawn: interpolated, or on its results loop. */
  const placeFlyer = (
    f: Flight,
    loop: { x: number; y: number } | null,
    alpha: number,
    time: number,
  ) => {
    if (over() && loop) {
      const a = time * LOOP_W;
      return {
        x: loop.x + Math.cos(a - Math.PI / 2) * LOOP_R,
        y: loop.y + Math.sin(a - Math.PI / 2) * LOOP_R,
        angle: a,
        pose: Math.floor(time * 6) % 2 === 0 ? 1 : 3,
      };
    }
    const x = f.px + (f.x - f.px) * alpha;
    const y = f.py + (f.y - f.py) * alpha;
    const tumbling = f.mode === "tumbling" || f.mode === "out";
    return {
      x,
      y,
      angle: tumbling ? f.spin : angleFor(f.vy),
      pose: tumbling ? 1 : poseFor(f.flapAge, f.vy),
    };
  };

  /** The lane shows the seconds to the next race. */
  const timed = (l: GameLane) =>
    bank() && (!l.joined || game.phase === "lobby" || (l.practice && game.phase === "racing"));

  /** In the race everyone sees: not idle in a bank race, not practising. */
  const inRace = (l: GameLane) => game.shows(l) && !l.practice;

  const drawPack = (l: GameLane, v: LaneView) => {
    const course = game.course;
    const atlas = deps.atlas();
    if (!atlas || !course) return;
    if (game.plan.play !== "lone" && deps.hasScreen()) return;
    if (bank() && !l.joined) return;
    const frame = deps.frame();
    const r = atlas.regions;
    const k = frame.unit * frame.pixelRatio;
    const touch = v.spec.touch;
    const x0 = (touch.x + touch.width * 0.12) * k;
    const x1 = (touch.x + touch.width * 0.88) * k;
    const y = (v.spec.rect.y + Math.min(230, v.spec.rect.height * 0.12)) * k;
    const th = 16 * k;
    gfx.sprite(r.white, x0, y, x1 - x0, th, WHITE, 0.16, 0, 0, 0.5);
    gfx.sprite(r.white, x0, y, 6 * k, th * 3, WHITE, 0.5, 0, 0.5, 0.5);
    gfx.sprite(r.star, x1, y, 56 * k, 56 * k, [1, 0.8, 0.2], 0.95);
    const at = (d: number) => x0 + (x1 - x0) * Math.min(1, Math.max(0, d / course.length));
    const dot = (d: number, color: Rgb, size: number, a: number) =>
      gfx.sprite(r.dot, at(d), y, size * k, size * k, color, a);
    const ghost = game.ghost;
    if (ghost) dot(ghostAt(ghost, game.raceT()).x, [0.85, 0.9, 1], 30, 0.5);
    for (const rv of game.rivals) dot(distanceOf(rv.flight), deps.rivalRgb(rv.flight), 34, 0.9);
    const own = new Set(game.lanes.map((x) => x.id));
    for (const other of game.board.live()) {
      if (own.has(other.id)) continue;
      const c = rgb(deps.colorAt(other.pos * Math.max(1, other.n) + other.slot));
      dot(other.d, c, 30, other.ctrl === "attract" ? 0.45 : 0.9);
    }
    for (const x of game.lanes) {
      if (x === l || !inRace(x)) continue;
      const xv = deps.viewOf(x);
      if (xv) dot(distanceOf(x.flight), xv.rgb, 34, 0.7);
    }
    if (!inRace(l)) return;
    const me = distanceOf(l.flight);
    gfx.sprite(r.glow, at(me), y, 110 * k, 110 * k, v.rgb, 0.6, 0, 0.5, 0.5, true);
    dot(me, v.rgb, 46, 1);
    gfx.sprite(r.ring, at(me), y, 66 * k, 66 * k, WHITE, 0.9);
  };

  /** A ring of dots that empties as the next race comes closer. */
  const drawTimer = (cx: number, cy: number, radius: number, color: Rgb, alpha: number) => {
    const atlas = deps.atlas();
    if (!atlas) return;
    const frame = deps.frame();
    const r = atlas.regions;
    const k = frame.unit * frame.pixelRatio;
    const p = game.plan;
    const total = Math.max(1, p.next - p.from);
    const left = Math.max(0, Math.min(1, (p.next - deps.now()) / total));
    const dots = 12;
    const lit = Math.ceil(left * dots);
    for (let i = 0; i < dots; i++) {
      const a = -Math.PI / 2 + (i / dots) * Math.PI * 2;
      const on = i < lit;
      const size = (on ? 34 : 24) * k;
      gfx.sprite(
        r.dot,
        cx + Math.cos(a) * radius,
        cy + Math.sin(a) * radius,
        size,
        size,
        on ? color : WHITE,
        (on ? 0.9 : 0.22) * alpha,
      );
    }
  };

  /**
   * Out until the next race: the lane dims and a ring of dots counts down to the next start. With
   * a screen above, an arrow points up at the race still going on there.
   */
  const drawWaiting = (vp: Viewport, v: LaneView, time: number) => {
    const atlas = deps.atlas();
    if (!atlas) return;
    const frame = deps.frame();
    const r = atlas.regions;
    const k = frame.unit * frame.pixelRatio;
    gfx.sprite(r.white, vp.x, vp.y, vp.w, vp.h, SKY_DARK, 0.5, 0, 0, 0);
    const cx = vp.x + vp.w / 2;
    const cy = vp.y + vp.h / 2;
    const radius = Math.min(vp.w, vp.h) * 0.2;
    const p = game.plan;
    const total = Math.max(1, p.next - p.start);
    const left = Math.max(0, Math.min(1, (p.next - deps.now()) / total));
    const dots = 12;
    const lit = Math.ceil(left * dots);
    for (let i = 0; i < dots; i++) {
      const a = -Math.PI / 2 + (i / dots) * Math.PI * 2;
      const on = i < lit;
      const size = (on ? 44 : 30) * k;
      gfx.sprite(
        r.dot,
        cx + Math.cos(a) * radius,
        cy + Math.sin(a) * radius,
        size,
        size,
        on ? v.rgb : WHITE,
        on ? 0.95 : 0.25,
      );
    }
    if (deps.hasScreen()) {
      const bob = Math.sin(time * 3) * 20 * k;
      gfx.sprite(r.arrow, cx, cy - radius * 0.1 + bob, 150 * k, 150 * k, WHITE, 0.85, -Math.PI / 2);
    }
  };

  const draw = (l: GameLane, v: LaneView, alpha: number, time: number, dt: number) => {
    const atlas = deps.atlas();
    if (!atlas) return;
    const frame = deps.frame();
    const r = atlas.regions;
    const course = game.course;
    const f = l.flight;
    const shows = game.shows(l);
    const me = shows ? placeFlyer(f, l.loop, alpha, time) : null;
    if (me) {
      const target = me.x - CAM_LEAD * laneWidth(v);
      v.cam += (target - v.cam) * Math.min(1, dt * (game.phase === "racing" ? 9 : 3));
      if (Math.abs(target - v.cam) > laneWidth(v) * 2) v.cam = target;
    } else if (game.phase === "racing") {
      v.cam += cfg.base * DRIFT * dt;
    }
    v.shake = Math.max(0, v.shake - dt * 2.5);
    const vp = viewportOf(v);
    const k = frame.unit * frame.pixelRatio;
    gfx.clip(vp.x, vp.y, vp.w, vp.h);
    const looping = over() && me !== null && f.mode !== "waiting";
    drawWorld(gfx, atlas, vp, course, { time, start: looping ? 0 : 1 });
    const ghost = game.ghost;
    if (ghost && !over()) {
      const g = game.phase === "racing" ? ghostAt(ghost, game.raceT()) : { x: 0, y: START_Y };
      drawFlyer(gfx, atlas, vp, g.x, g.y, {
        color: WHITE,
        alpha: 0.42,
        pose: 2,
        angle: 0,
        ghost: true,
      });
    }
    for (const rv of game.rivals) {
      const p = placeFlyer(rv.flight, rv.loop, alpha, time + rv.id);
      drawFlyer(gfx, atlas, vp, p.x, p.y, {
        color: deps.rivalRgb(rv.flight),
        alpha: l.ctrl === "attract" ? 0.5 : 0.8,
        pose: p.pose,
        angle: p.angle,
        size: 0.8,
      });
    }
    if (me && inRace(l)) {
      for (const other of game.lanes) {
        if (other === l || !inRace(other)) continue;
        const p = placeFlyer(other.flight, other.loop, alpha, time);
        // Another lane on this frame races the same course: shown as a pale shadow.
        drawFlyer(gfx, atlas, vp, p.x, p.y, {
          color: WHITE,
          alpha: 0.22,
          pose: p.pose,
          angle: p.angle,
          size: 0.85,
          ghost: true,
        });
      }
    }
    particles.draw(gfx, atlas, vp, l.slot);
    const faded = l.ctrl === "attract";
    if (me) {
      // Speed boost: chevrons streaming behind the glider.
      if (cfg.crash === "tumble" && f.mode === "flying" && f.clean > 0) {
        const n = Math.min(5, Math.ceil(f.clean / 2));
        for (let i = 0; i < n; i++) {
          gfx.sprite(
            r.chevron,
            sx(vp, me.x - 150 - i * 46),
            sy(vp, me.y),
            40 * vp.s,
            54 * vp.s,
            v.rgb,
            (0.7 - i * 0.12) * (faded ? 0.5 : 1),
          );
        }
      }
      drawFlyer(gfx, atlas, vp, me.x, me.y, {
        color: v.rgb,
        alpha: faded ? 0.5 : 1,
        pose: me.pose,
        angle: me.angle,
        rings: v.rings,
        glow: faded ? 0.25 : 0.55,
      });
    }
    const outWaiting =
      f.mode === "out" && game.phase === "racing" && l.ctrl !== "attract" && !l.practice;
    if (shows && outWaiting) drawWaiting(vp, v, time);
    else if (timed(l)) {
      const t = v.timerAt;
      drawTimer(t.x * k, t.y * k, t.r * k, v.rgb, l.joined ? 1 : 0.8);
    }
    for (const d of v.spec.dim) {
      gfx.sprite(r.white, d.x * k, d.y * k, d.width * k, d.height * k, SKY_DARK, 0.55, 0, 0, 0);
    }
    drawPack(l, v);
    gfx.unclip();
  };

  const numerals = (now: number) => {
    const p = game.plan;
    const left = game.phase === "countdown" ? Math.max(1, Math.ceil((p.start - now) / 1000)) : 0;
    const seconds = String(Math.max(0, Math.ceil((p.next - now) / 1000)));
    game.lanes.forEach((l) => {
      const v = deps.viewOf(l);
      if (!v) return;
      const counting = left > 0 && game.shows(l);
      v.count.set(counting ? String(left) : null, v.color, l.ctrl === "attract" ? 0.6 : 1);
      const f = l.flight;
      const ranked = bank() ? l.racer : true;
      const show = ranked && (over() || f.fin !== null) && f.mode !== "waiting";
      const place = show && game.shows(l) ? game.placeOf(l) : null;
      // An attract lane's place is ambient: only the podium shows, faded.
      if (place !== null && (l.ctrl !== "attract" || place <= 3))
        v.place.set(
          String(place),
          placeColor(place, palette.foreground),
          l.ctrl === "attract" ? 0.55 : 1,
        );
      else v.place.set(null, v.color);
      const timer = timed(l) && !counting;
      v.timer.set(timer ? seconds : null, l.joined ? v.color : palette.foreground, 0.95);
      const word = l.practice ? "Practice" : "Next race";
      const label = timer && v.spec.rect.height >= (deps.labelMinH ?? LABEL_MIN_H);
      v.label.set(label ? word : null, palette.foreground, 0.85);
    });
  };

  return { draw, numerals };
};
