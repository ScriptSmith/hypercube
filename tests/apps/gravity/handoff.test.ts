import { describe, expect, it } from "vitest";
import { VENUE_SIZE } from "../../../src/core/frame";
import { createCosmos, type Cosmos } from "../../../src/apps/gravity/cosmos";
import {
  screenScale,
  screenSize,
  screenSky,
  stationLayout,
} from "../../../src/apps/gravity/layout";
import { type Body, STEP_MS } from "../../../src/apps/gravity/physics";
import { createPrediction } from "../../../src/apps/gravity/predict";
import { launchOf, predictClimb } from "../../../src/apps/gravity/screen";
import {
  type ClimbStart,
  createClimber,
  type Snapshot,
  stepClimber,
  takeOver,
} from "../../../src/apps/gravity/strip";
import { decodeSky, encodeSky, q16, snapshotOf } from "../../../src/apps/gravity/wire";

const { W, H } = screenSize(6 * 1080, VENUE_SIZE.screen.width, VENUE_SIZE.screen.height);
const sky = screenSky(W, H);

const screenCosmos = (scene = 0, seconds = 2): Cosmos => {
  const s = screenScale(W);
  const c = createCosmos({
    sky,
    maxBodies: s.maxBodies,
    dustCap: s.dustCap,
    seed: 9,
    scene,
    clockMs: 0,
    dot: s.dot,
  });
  for (let t = 50; t <= seconds * 1000; t += 50) c.advance(t, t);
  return c;
};

/** What the screen sends: its bodies, quantised, through JSON as on the wire. */
const snapshotFrom = (c: Cosmos): Snapshot => {
  const m = encodeSky({
    w: W,
    h: H,
    k: c.clockK,
    b: c.u.bodies
      .slice(0, 16)
      .map((b) => [b.x, b.y, b.gm, b.r] as [number, number, number, number]),
    f: c.timeIndex,
    sc: c.sceneIndex,
    vs: 100,
    z: c.trueSizes ? 1 : 0,
  });
  return snapshotOf(decodeSky(JSON.parse(JSON.stringify(m)))!);
};

const pos = 4;
const strip = { x0: pos * 1080, x1: (pos + 1) * 1080 };
const pad = stationLayout("panel", 1080, 1920, pos, sky, pos * 1080).pads[0]!;

const start = (k: number, angle = 0.25, share = 0.8): ClimbStart => {
  const v = pad.vmin + (pad.vmax - pad.vmin) * share;
  return {
    kind: "planet",
    x: q16(pad.x + strip.x0),
    y: q16(pad.y),
    vx: q16(Math.sin(angle) * v),
    vy: q16(-Math.cos(angle) * v),
    k,
    owner: "p4",
    pad: 0,
    color: 4,
    human: true,
  };
};

describe("crossing the bezel", () => {
  it("brings a body over at the same step and place as the frame, with 0 to 300 ms of delay", () => {
    const c = screenCosmos();
    const snap = snapshotFrom(c);
    for (const angle of [-0.6, 0, 0.4, 0.9]) {
      const s = start(1000, angle);
      const frame = createClimber(s, snap, strip);
      while (frame.crossed < 0 && !frame.lost) stepClimber(frame);
      expect(frame.crossed).toBeGreaterThan(1000);
      for (const ms of [0, 100, 300]) {
        const now = 1000 + Math.round(ms / STEP_MS);
        const t = takeOver(s, snap, strip, now);
        expect(t.late).toBe(false);
        const cl = t.climber;
        while (cl.crossed < 0 && !cl.lost) stepClimber(cl);
        expect([cl.crossed, cl.ex, cl.ey, cl.evx, cl.evy]).toEqual([
          frame.crossed,
          frame.ex,
          frame.ey,
          frame.evx,
          frame.evy,
        ]);
      }
    }
  });

  it("brings a body in late from the bottom edge, never part way up, when the message is late", () => {
    const c = screenCosmos();
    const snap = snapshotFrom(c);
    const s = start(2000);
    const frame = createClimber(s, snap, strip);
    while (frame.crossed < 0) stepClimber(frame);
    const t = takeOver(s, snap, strip, frame.crossed + 240);
    expect(t.late).toBe(true);
    expect([t.climber.ex, t.climber.ey]).toEqual([frame.ex, frame.ey]);
    expect(t.climber.ey).toBeLessThan(0);
    expect(t.climber.ey).toBeGreaterThan(-200);
  });

  it("treats a sender whose clock runs ahead as now", () => {
    const c = screenCosmos();
    const snap = snapshotFrom(c);
    const t = takeOver(start(5000), snap, strip, 4000);
    expect(t.climber.k).toBe(4000);
    expect(t.late).toBe(false);
  });

  it("keeps the snapshot's numbers exact through the wire", () => {
    const c = screenCosmos();
    const a = snapshotFrom(c);
    const b = snapshotOf(
      decodeSky(
        JSON.parse(
          JSON.stringify({
            ...encodeSky({
              w: W,
              h: H,
              k: a.k,
              b: a.b.map((x) => [...x] as [number, number, number, number]),
              f: 2,
              sc: 0,
              vs: 100,
              z: 0,
            }),
          }),
        ),
      )!,
    );
    expect(b.b).toEqual(a.b);
  });
});

describe("the ribbon above the bezel", () => {
  for (const timeIndex of [2, 1]) {
    it(`matches the body's real climb and flight on the screen (time index ${timeIndex})`, () => {
      const c = screenCosmos(0, 3);
      c.setTime(timeIndex);
      const snap = snapshotFrom(c);
      const s = start(c.clockK, 0.35, 0.75);
      const pred = predictClimb(c, s, snap, strip, 400, 3, createPrediction(800, 3), c.holeMass());
      expect(pred.n).toBeGreaterThan(40);
      // The real thing, as the screen does it.
      const cl = createClimber({ ...s, k: c.clockK }, snap, strip);
      let body: Body | null = null;
      let ticks = 0;
      let checked = 0;
      for (let i = 0; i < 1200 && ticks < pred.steps; i++) {
        let tickedBody = 0;
        const had = body as Body | null;
        const k0 = c.u.k;
        c.advance((c.clockK + 1) * STEP_MS + 0.01, 0, () => {
          if (body) return;
          stepClimber(cl);
          ticks++;
          if (ticks % 3 === 0 && ticks / 3 < pred.n) {
            expect(Math.fround(cl.x)).toBe(pred.pts[(ticks / 3) * 2]);
            checked++;
          }
          if (cl.crossed >= 0) body = c.launch(launchOf(cl, c.holeMass()));
        });
        if (had) {
          tickedBody = c.u.k - k0;
          if (tickedBody === 1) {
            ticks++;
            if (ticks % 3 === 0 && ticks / 3 < pred.n && c.u.bodies.includes(had)) {
              expect(Math.fround(had.x)).toBe(pred.pts[(ticks / 3) * 2]);
              expect(Math.fround(had.y)).toBe(pred.pts[(ticks / 3) * 2 + 1]);
              checked++;
            }
          } else {
            ticks += tickedBody;
          }
        }
      }
      expect(body).not.toBeNull();
      expect(checked).toBeGreaterThan(20);
    });
  }
});
