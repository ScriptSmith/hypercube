/**
 * How a theme's toys plug into a table (table.ts). A theme builds the middle of the playfield
 * (layout.ts, `Middle`) and, for each table, a `Toys` object that moves its bumpers, pushes balls,
 * catches and holds balls in its devices, lets them go, and scores through the `ToyHost` the table
 * gives it. The devices themselves are in devices.ts; `createToyBox` there composes them into a
 * `Toys`.
 *
 * Balls a toy holds are out of the solver (so nothing can push them through a wall) but still in
 * play: the table counts them, so a drain while others are held never ends a game, and the view
 * draws them where `held()` says, with a height for rides and lifts.
 */
import type { TableLayout } from "./layout";
import type { Ball, PhysEvent, World } from "./physics";

/** A ball a toy holds: where it is, how high its centre is, and how big it looks. */
export interface HeldBall {
  ball: Ball;
  x: number;
  y: number;
  /** Height of its centre above the playfield, table px: BALL_R when it rests on it. */
  z: number;
  /** Drawn size as a share of its radius: 1 as usual, 0 hidden (inside something). */
  scale: number;
  /** The device holding it. */
  by: string;
}

/** What a table offers its toys. */
export interface ToyHost {
  readonly world: World;
  readonly layout: TableLayout;
  /** Simulated seconds (the world's clock). */
  now(): number;
  /** Deterministic noise, 0 to 1. */
  random(): number;
  /** A game is on (`play`): toys score and take balls only then. */
  playing(): boolean;
  /** Score points, with the table's multiplier and gifts applied. */
  add(points: number): void;
  /** Mark a part as just hit, for the view (`Table.flashAge`). */
  flash(tag: string, index: number): void;
  /** One step up the table's multiplier, to its cap. */
  raiseMultiplier(): void;
  /** Take a free ball out of the solver. False if it isn't one (held by a finger, gone). */
  take(b: Ball): boolean;
  /** Put a held ball back at (x, y) moving (vx, vy). */
  free(b: Ball, x: number, y: number, vx: number, vy: number): void;
  /** Serve a ball to the plunger if the table has no free ball left. */
  serveIfEmpty(): void;
  /** A new ball at (x, y) moving (vx, vy), if the table has room (MAX_IN_PLAY); else null. */
  addBall(x: number, y: number, vx: number, vy: number): Ball | null;
  /** Shake the view a little (0 to 1), for a stomp or a launch. */
  shake(amount: number): void;
}

export interface Toys {
  /** Every physics sub-step, before the balls move: move bumpers, push balls. */
  tick(h: number): void;
  /** Each solver event, after the table's own rules have scored it. */
  event(e: PhysEvent): void;
  /** Each update, after the events: catch balls, run devices, let balls go. */
  update(dt: number): void;
  /** Balls the toys hold, counted as in play and drawn where they say. */
  held(): readonly HeldBall[];
  /** No free ball is left on the table: let go of balls kept waiting for others (locks). */
  flush(): void;
  /** A new game, or back to attract: let everything go and start again. */
  reset(): void;
}

export const NO_TOYS: Toys = {
  tick() {},
  event() {},
  update() {},
  held: () => [],
  flush() {},
  reset() {},
};
