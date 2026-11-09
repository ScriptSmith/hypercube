/**
 * An arena played on the touch frame itself: a wall, a panel or pair on its own, or a bank
 * frame whose screen has gone. Its stations are the frame's own.
 */
import type { AppContext } from "../../core/types";
import { arenaParams, createArena } from "./arena";
import type { Config } from "./config";
import type { FrameLayout } from "./layout";
import { createMatch, type Match } from "./match";
import type { Seating } from "./seating";
import { insetFor, localSlots } from "./slots";
import { type ArenaView, createArenaView } from "./view";

export interface LocalGame {
  readonly match: Match;
  readonly view: ArenaView;
  tick(now: number): void;
  draw(now: number, dt: number): void;
  /** Skip the lobby wait for people already seated (after the screen went). */
  hurry(now: number): void;
  dispose(): void;
}

export const createLocalGame = (
  ctx: AppContext,
  cfg: Config,
  layout: FrameLayout,
  seating: Seating,
  firstDelay?: number,
): LocalGame => {
  const rect = layout.arena;
  const inset = insetFor(rect.width, rect.height);
  const view = createArenaView(ctx.root, ctx.ui.palette, "Touch below to play");
  view.place({ rect, inset, unit: ctx.frame.unit, pixelRatio: ctx.frame.pixelRatio });
  const { width, height } = view.units;
  const params = arenaParams(width, height, cfg.variant);
  const arena = createArena({
    width,
    height,
    params,
    variant: cfg.variant,
    gaps: cfg.gaps,
    trail: cfg.trail,
    edges: cfg.edges,
    rng: ctx.rng("tangle:arena"),
  });
  const slots = localSlots(
    layout.stations.map((s) => s.u),
    layout.width,
    rect.x + inset.left,
    width,
    height,
    params,
  );
  const match = createMatch({
    cfg,
    arena,
    slots,
    rng: ctx.rng("tangle:bots"),
    now: ctx.clock.now(),
    ...(firstDelay === undefined ? {} : { firstDelay }),
    host: {
      seat: (key) => seating.seat(key),
      dir: (key) => seating.dir(key),
      press: (key) => seating.press(key),
      drive: (key, dir) => seating.drive(key, dir),
      changed() {
        if (match.phase === "play") seating.startReady();
      },
    },
  });

  return {
    match,
    view,
    tick: (now) => match.tick(now),
    draw(now, dt) {
      view.draw({
        match,
        cfg,
        now,
        dt,
        seat: (key) => (key < layout.stations.length ? seating.seat(key) : null),
      });
    },
    hurry(now) {
      match.hurry(now);
    },
    dispose() {
      view.dispose();
    },
  };
};
