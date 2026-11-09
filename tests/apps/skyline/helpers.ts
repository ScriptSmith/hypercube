import { expect } from "vitest";
import { BH } from "../../../src/apps/skyline/config";
import { createCrane, type Crane, type World } from "../../../src/apps/skyline/crane";
import { createPilot, type Pilot } from "../../../src/apps/skyline/pilot";
import type { Variant } from "../../../src/apps/skyline/config";
import { createRng } from "../../../src/core/rng";

export const DT = 1 / 60;

/** A wall-lane-like world: mast on the left, two lots, the yard and lift on the right. */
export const testWorld = (over: Partial<World> = {}): World => ({
  left: 0,
  right: 12.5,
  height: 8.2,
  mastX: 0.7,
  jibY: 7.7,
  jibFrom: -0.8,
  jibTo: 11.9,
  tMin: 1.5,
  tMax: 11.6,
  lots: [
    { x: 3.6, cols: 3 },
    { x: 7.1, cols: 3 },
  ],
  maxRows: 6,
  yard: [9.4, 10.5, 11.6],
  liftX: 12.1,
  storeX: 12.4,
  ...over,
});

export const rig = (
  seed: string,
  o: {
    variant?: Variant;
    assist?: boolean;
    wind?: boolean;
    world?: World;
    prebuilt?: boolean;
  } = {},
) => {
  const crane = createCrane({
    world: o.world ?? testWorld(),
    variant: o.variant ?? "build",
    assist: o.assist ?? true,
    wind: o.wind ?? false,
    rng: createRng(seed),
    prebuilt: o.prebuilt ?? false,
  });
  const pilot: Pilot = createPilot({
    rng: createRng(`${seed}:pilot`),
    hand: {
      aim: (x, y) => crane.setTargetNorm(x, y),
      release: () => crane.release(),
      rest: () => {},
    },
  });
  return { crane, pilot };
};

/** Step the crane with its autopilot, feeding a floor whenever the yard has room. */
export const runAuto = (
  c: Crane,
  p: Pilot,
  seconds: number,
  o: { feed?: (t: number) => number | null; until?: () => boolean } = {},
) => {
  const feedRng = createRng("feed");
  let t = 0;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    t += DT;
    const kind = o.feed ? o.feed(t) : feedRng.int(3);
    if (kind !== null && c.canRequest()) c.request(kind);
    p.update(DT, c.readout());
    c.step(DT);
    c.events.length = 0;
    if (o.until?.()) return true;
  }
  return false;
};

/** Aim the hook at a world point and step until it hangs still there (or time runs out). */
export const settleAt = (c: Crane, x: number, y: number, seconds = 20) => {
  c.setTarget(x, y);
  for (let i = 0; i < seconds / DT; i++) {
    c.step(DT);
    const h = c.hook();
    const r = c.readout();
    if (Math.abs(h.x - c.target.x) < 0.02 && Math.abs(h.y - c.target.y) < 0.02 && r.sway < 0.004) {
      return true;
    }
  }
  return false;
};

export const stepFor = (c: Crane, seconds: number, each?: () => void) => {
  for (let i = 0; i < seconds / DT; i++) {
    c.step(DT);
    each?.();
  }
};

/** Put a block of `kind` in the yard and catch it on the hook. */
export const fetch = (c: Crane, kind: number) => {
  expect(c.request(kind)).toBe(true);
  stepFor(c, 4);
  const i = c.yard.findIndex((b) => b?.kind === kind);
  expect(i).toBeGreaterThanOrEqual(0);
  const x = c.world.yard[i]!;
  settleAt(c, x, BH + 1.2);
  c.setTarget(x, BH);
  for (let k = 0; k < 6 / DT && !c.carrying; k++) c.step(DT);
  expect(c.carrying?.kind).toBe(kind);
  settleAt(c, x, BH * 6);
};
