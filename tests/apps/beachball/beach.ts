import { wallLayout } from "../../../src/apps/beachball/walllayout";
import { createWorld, type Prop, type World } from "../../../src/apps/beachball/wallphysics";
import {
  extentAt,
  PROP_KINDS,
  PROP_SPECS,
  type PropKind,
} from "../../../src/apps/beachball/wallprops";
import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";
import { createRng } from "../../../src/core/rng";

export const DT = 1 / 120;
export const WALL = VENUE_SIZE.wall;
export const REACH = DEFAULT_REACH.wall;
export const FITS = PROP_KINDS.map((k) => {
  const e = extentAt(PROP_SPECS[k], PROP_SPECS[k].rest);
  return { left: e.left, right: e.right };
});

export interface BeachOptions {
  balls?: number;
  net?: boolean;
  toys?: boolean;
  umbrella?: boolean;
  seed?: string;
}

/** A wall's world as the app makes it, with the umbrella and crab start by default. */
export const beach = (o: BeachOptions = {}) => {
  const balls = o.balls ?? 2;
  const toys = o.toys ?? true;
  const l = wallLayout(WALL.width, WALL.height, REACH, balls, {
    net: o.net ?? true,
    props: toys ? FITS : [],
    umbrella: o.umbrella ?? true,
    crab: true,
  });
  const w = createWorld(
    createRng(o.seed ?? "beach"),
    balls,
    l.radius,
    { width: l.width, height: l.height, floor: l.floor },
    l.rest,
    {
      props: toys ? PROP_KINDS.map((kind, i) => ({ kind, x: l.props[i]! })) : [],
      net: l.net,
      umbrella: l.umbrella,
    },
  );
  return { l, w };
};

export const run = (w: World, seconds: number, each?: () => void) => {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    each?.();
    w.step(DT);
  }
};

export const prop = (w: World, kind: PropKind) => w.props.find((p) => p.kind === kind)!;

export const discs = (p: Prop) =>
  p.spec.discs.map((d) => ({
    x: p.x + p.cs * d.x - p.sn * d.y,
    y: p.y + p.sn * d.x + p.cs * d.y,
    r: d.r,
  }));

export const lowest = (p: Prop) => Math.min(...discs(p).map((d) => d.y - d.r));

/** A point a distance `along` from a toy's model base, up its own length. */
export const pointOf = (p: Prop, along: number) => {
  const bx = p.spec.origin.x;
  const by = p.spec.origin.y + along;
  return { x: p.x + p.cs * bx - p.sn * by, y: p.y + p.sn * bx + p.cs * by };
};

/** A finger pressed at (x, y), moved along `path` a step at a time, then lifted. */
export const drag = (
  w: World,
  id: number,
  path: readonly (readonly [number, number])[],
  each?: () => void,
) => {
  const [x0, y0] = path[0]!;
  w.down(id, x0, y0);
  let [px, py] = [x0, y0];
  for (const [x, y] of path.slice(1)) {
    w.move(id, x, y, (x - px) / DT, (y - py) / DT);
    w.step(DT);
    each?.();
    px = x;
    py = y;
  }
};
