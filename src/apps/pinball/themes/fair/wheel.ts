/**
 * The Ferris wheel as a table device. A ball that rolls into the station at the wheel's foot rises
 * on a lift to the platform, waits there for the next gondola, rides up and over the top and is
 * thrown off it to land in a top lane. The wheel always turns, faster while anyone rides. It can
 * also carry guests: new balls in the gondolas after a rider's, which land as a multiball.
 *
 * The wheel leans back, so its top comes towards the viewer: a ball in the bottom gondola is
 * `low` over the playfield and one at the top `2 R sin(tilt)` higher. Everything is in table px
 * (mirrored) and world seconds; the toolkit's carrier can't add new balls, hence a device here.
 */
import { BALL_R } from "../../config";
import { type Device, HOLD_LIMIT_S, type Out, type P3 } from "../../devices";
import type { Point } from "../../layout";
import type { Ball } from "../../physics";

export interface WheelSpec {
  name: string;
  /** The hub, in table px (mirrored). */
  hub: Point;
  /** 1 as built, -1 mirrored: a gondola's x is hub.x + side * R cos(angle). */
  side: 1 | -1;
  /** Radius of the circle the gondolas hang from. */
  R: number;
  /** How far the wheel leans back from the playfield's plane, radians. */
  tilt: number;
  /** How far a gondola's cup hangs below its pivot, down the table. */
  hang: number;
  /** Height of a ball's centre in the bottom gondola. */
  low: number;
  gondolas: number;
  /** Where balls are caught: the station at the wheel's foot. */
  station: { x: number; y: number; r: number };
  maxSpeed: number;
  /** Seconds the lift takes from the station up to the platform. */
  lift: number;
  /** Seconds a ball flies from the top gondola to where it lands. */
  hop: number;
  /** Where it lands, and how it moves on from there. */
  landing: { x: number; y: number; vx: number; vy: number };
  /** Turning speed in radians a second: idle and with riders, and how fast it changes. */
  idle: number;
  run: number;
  accel: number;
}

export type RiderPhase = "lift" | "wait" | "ride" | "hop" | "pending";

/** A ball on the wheel, or a guest (no ball yet), for the look. */
export interface Rider {
  readonly ball: Ball | null;
  readonly phase: RiderPhase;
  /** The gondola it rides in (or will), once it is on the platform. */
  readonly gondola: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly scale: number;
}

export interface Wheel extends Device {
  readonly spec: WheelSpec;
  /** The wheel's turn, radians, 0 to 2 pi: gondola k hangs at `gondolaAngle(k)`. */
  readonly angle: number;
  /** Radians a second. */
  readonly speed: number;
  readonly riders: readonly Rider[];
  /** Built angle of gondola k (pi/2 at the bottom, -pi/2 at the top). */
  gondolaAngle(k: number): number;
  /** Where a cup at built angle `a` holds a ball. */
  cup(a: number): P3;
  /** The next rider brings `n` guests in the gondolas after its own. */
  invite(n: number): void;
  /** Guests waiting for the next rider. */
  readonly invited: number;
}

/** The size a ball on the wheel is reported at (see `held`). */
export const ABOARD = 0.6;

/** What a guest's landing is called, so the rules can tell it from a rider's. */
export const GUEST = "guest";

const ease = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const TAU = Math.PI * 2;
/** Turns kept before the angle is wrapped, so it stays small over days. */
const WRAP = TAU * 64;

interface State {
  ball: Ball | null;
  since: number;
  from: P3;
  phase: RiderPhase;
  board: number;
  show: number;
  gondola: number;
  hopAt: number;
  x: number;
  y: number;
  z: number;
  scale: number;
}

export const createWheel = (spec: WheelSpec): Wheel => {
  const n = spec.gondolas;
  const s = TAU / n;
  const ct = Math.cos(spec.tilt);
  const st = Math.sin(spec.tilt);
  const riders: State[] = [];
  let theta = 0;
  let omega = spec.idle;
  let last = Number.NaN;
  let lastBoard = -Infinity;
  let invited = 0;

  const cup = (a: number): P3 => ({
    x: spec.hub.x + spec.side * spec.R * Math.cos(a),
    y: spec.hub.y + spec.R * Math.sin(a) * ct + spec.hang,
    z: spec.low + spec.R * st * (1 - Math.sin(a)),
  });
  const platform = cup(Math.PI / 2);
  const top = cup(-Math.PI / 2);
  const st0 = spec.station;
  const put = (r: State, p: P3, scale = 1) => {
    r.x = p.x;
    r.y = p.y;
    r.z = p.z;
    r.scale = scale;
  };
  const busy = () =>
    riders.some((r) => r.phase === "lift" || r.phase === "wait" || r.phase === "pending");
  const real = () => riders.reduce((k, r) => k + (r.ball ? 1 : 0), 0);

  return {
    name: spec.name,
    spec,
    get angle() {
      return ((theta % TAU) + TAU) % TAU;
    },
    get speed() {
      return omega;
    },
    get riders() {
      return riders;
    },
    get invited() {
      return invited;
    },
    gondolaAngle: (k) => Math.PI / 2 + k * s - theta,
    cup,
    invite(k) {
      invited = Math.max(0, Math.min(2, k));
    },
    wants: (b) =>
      real() < 3 &&
      !busy() &&
      Math.hypot(b.x - st0.x, b.y - st0.y) < st0.r &&
      Math.hypot(b.vx, b.vy) < spec.maxSpeed,
    take(b, now) {
      const from = { x: b.x, y: b.y, z: BALL_R };
      riders.push({
        ball: b,
        since: now,
        from,
        phase: "lift",
        board: Infinity,
        show: Infinity,
        gondola: -1,
        hopAt: 0,
        ...from,
        scale: 1,
      });
    },
    update(now, out: Out[]) {
      const dt = Number.isNaN(last) ? 0 : Math.max(0, Math.min(0.1, now - last));
      last = now;
      const want = riders.length > 0 ? spec.run : spec.idle;
      const step = spec.accel * dt;
      omega += Math.max(-step, Math.min(step, want - omega));
      theta += omega * dt;
      if (theta > WRAP) {
        theta -= WRAP;
        lastBoard -= WRAP;
        for (const r of riders) {
          r.board -= WRAP;
          r.show -= WRAP;
        }
      }
      for (let i = riders.length - 1; i >= 0; i--) {
        const r = riders[i]!;
        let done = r.ball !== null && now - r.since >= HOLD_LIMIT_S - 0.05;
        if (r.phase === "lift") {
          const k = (now - r.since) / spec.lift;
          if (k < 1) {
            // Into the station, then straight up the lift to the platform.
            const a = ease(k / 0.35);
            const u = ease((k - 0.35) / 0.65);
            put(r, {
              x: r.from.x + (st0.x - r.from.x) * a + (platform.x - st0.x) * u,
              y: r.from.y + (st0.y - r.from.y) * a + (platform.y - st0.y) * u,
              z: BALL_R + (spec.low - BALL_R) * u,
            });
          } else {
            r.phase = "wait";
            r.board = Math.max(Math.ceil((theta + 1e-6) / s) * s, lastBoard + s);
            lastBoard = r.board;
            r.gondola = (((Math.round(r.board / s) % n) + n) % n) | 0;
            put(r, platform);
            for (let j = 1; j <= invited; j++) {
              const board = r.board + j * s;
              riders.push({
                ball: null,
                since: now,
                from: platform,
                phase: "pending",
                board,
                show: board - s,
                gondola: (((Math.round(board / s) % n) + n) % n) | 0,
                hopAt: 0,
                ...platform,
                scale: 0,
              });
              lastBoard = board;
            }
            invited = 0;
          }
        }
        if (r.phase === "pending" && theta >= r.show) r.phase = "wait";
        if (r.phase === "wait") {
          // A guest pops up onto the platform as the gondola before it leaves.
          const grow = r.ball ? 1 : ease((theta - r.show) / (s * 0.4));
          put(r, platform, grow);
          if (theta >= r.board) r.phase = "ride";
        }
        if (r.phase === "ride") {
          const p = theta - r.board;
          if (p < Math.PI) {
            put(r, cup(Math.PI / 2 - p));
          } else {
            r.phase = "hop";
            r.hopAt = now;
          }
        }
        if (r.phase === "hop") {
          const k = (now - r.hopAt) / spec.hop;
          if (k >= 1) {
            done = true;
          } else {
            // Thrown off the top gondola in an arc, down into the lane.
            const L = spec.landing;
            put(r, {
              x: top.x + (L.x - top.x) * k,
              y: top.y + (L.y - top.y) * k,
              z: top.z + (BALL_R - top.z) * k + 70 * Math.sin(Math.PI * k),
            });
          }
        }
        if (r.ball) {
          r.ball.px = r.ball.x;
          r.ball.py = r.ball.y;
          r.ball.x = r.x;
          r.ball.y = r.y;
        }
        if (!done) continue;
        riders.splice(i, 1);
        const L = spec.landing;
        const why = r.ball ? spec.name : GUEST;
        out.push({ ball: r.ball, x: L.x, y: L.y, vx: L.vx, vy: L.vy, why });
      }
    },
    held(out) {
      for (const r of riders) {
        if (!r.ball) continue;
        // Up on the wheel a ball is reported a little small, which the view draws without a
        // halo on the playfield far below it; the look draws it full size in its gondola.
        const up = r.phase !== "lift";
        out.push({
          ball: r.ball,
          x: r.x,
          y: r.y,
          z: r.z,
          scale: up ? ABOARD : r.scale,
          by: spec.name,
        });
      }
    },
    flush() {},
    reset() {
      riders.length = 0;
      invited = 0;
      lastBoard = -Infinity;
      omega = spec.idle;
    },
  };
};
