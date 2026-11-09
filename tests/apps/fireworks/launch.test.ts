import { describe, expect, it } from "vitest";
import { VENUE_SIZE } from "../../../src/core/frame";
import { readConfig } from "../../../src/apps/fireworks/config";
import { createDirector } from "../../../src/apps/fireworks/director";
import { createEngine } from "../../../src/apps/fireworks/engine";
import { exitOf, launchMessage, pathOf } from "../../../src/apps/fireworks/launch";
import { layoutPads, mouthOf } from "../../../src/apps/fireworks/pads";
import { positionAt } from "../../../src/apps/fireworks/path";
import { SHAPE } from "../../../src/apps/fireworks/recipe";
import {
  bankSky,
  burstHeight,
  EXIT_S,
  frameRegion,
  screenRegion,
} from "../../../src/apps/fireworks/sky";
import { decodeLaunch, encodeLaunch, type LaunchMsg } from "../../../src/apps/fireworks/wire";
import { bankFraction } from "../../../src/core/layout";
import { screenDirector } from "./helpers";

const cfg = readConfig("build", {});
const panel = layoutPads({ kind: "panel", width: 1080, height: 1920, span: 1 }, cfg)[0]!;
const W = 6 * 1080;
const sky = bankSky(W, 0);

const msgFor = (pos: number, angle = 0, t = 100_000, size = 1): LaunchMsg =>
  decodeLaunch(
    encodeLaunch(
      launchMessage({
        pad: 0,
        pads: 1,
        pos,
        fw: 1080,
        fh: 1920,
        mouth: mouthOf(panel, angle),
        angle,
        sky,
        recipe: { color: 2, shape: SHAPE.peony, size },
        seed: 1234,
        t,
      }),
    ),
  )!;

const launchInto = (d: ReturnType<typeof screenDirector>["director"], m: LaunchMsg, xo = 0) => {
  const p = pathOf(m, xo);
  return d.launch({
    x: p.x,
    y: p.y,
    angle: m.a,
    v: m.v,
    g: m.g,
    t0: m.t,
    color: m.c,
    shape: m.s as typeof SHAPE.peony,
    size: m.z,
    seed: m.k,
    frame: "panel-4",
    pad: m.p,
    exitU: exitOf(m, xo).u,
    key: `panel-4:${m.p}`,
  });
};

describe("fireworks launch from a panel to the screen above", () => {
  it("puts a point u across frame pos at (pos + u) / count across the screen", () => {
    const region = screenRegion(W, 0, VENUE_SIZE.screen.height / VENUE_SIZE.screen.width);
    for (const [pos, u] of [
      [0, 0.5],
      [3, 0.25],
      [5, 0.9],
    ] as const) {
      const m = msgFor(pos);
      const x = (m.pos + u) * m.fw;
      expect((x - region.x0) / (region.x1 - region.x0)).toBeCloseTo(bankFraction(pos, u, 6), 9);
    }
    // The frame's own region sits directly under its slice of the screen.
    const f = frameRegion(0, 3, 1080, 1920);
    expect(f.x0).toBe(3 * 1080);
    expect(f.y1).toBe(0);
  });

  it("flies the same path on the panel and on the screen, through the network round trip", () => {
    const m = msgFor(4, 0.2);
    const onPanel = pathOf(
      launchMessage({
        pad: 0,
        pads: 1,
        pos: 4,
        fw: 1080,
        fh: 1920,
        mouth: mouthOf(panel, 0.2),
        angle: 0.2,
        sky,
        recipe: { color: 2, shape: SHAPE.peony, size: 1 },
        seed: 1234,
        t: 100_000,
      }),
      0,
    );
    const onScreen = pathOf(m, 0);
    for (const t of [0, 0.3, 0.6, 1.5]) {
      const a = positionAt(onPanel, t);
      const b = positionAt(onScreen, t);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(2);
    }
  });

  it("leaves the top of the panel about half a second after launch", () => {
    const e = exitOf(msgFor(0), 0);
    expect(e.t).not.toBeNull();
    expect(e.t!).toBeGreaterThan(EXIT_S * 0.85);
    expect(e.t!).toBeLessThan(EXIT_S * 1.25);
    expect(e.u).toBeCloseTo(0.5, 6);
  });

  it("fast-forwards a late launch along its path and bursts it at its own time", () => {
    const { engine, director } = screenDirector();
    const m = msgFor(5, 0.1, 100_000, 0.5);
    // Arrives 400 ms after launch: the shell is already part way up.
    const now = 100_400;
    const s = launchInto(director, m);
    expect(s.t0).toBe(100_000);
    const at = positionAt(s.path, (now - s.t0) / 1000);
    const want = positionAt(pathOf(m, 0), 0.4);
    expect(at.x).toBeCloseTo(want.x, 6);
    expect(at.y).toBeCloseTo(want.y, 6);
    // It bursts at its burst height, whatever time the frame gets round to it.
    expect(positionAt(s.path, (s.tb - s.t0) / 1000).y).toBeCloseTo(burstHeight(sky, 0.5), 0);
    director.update(s.tb + 250);
    const b = engine.bursts.slots.find((x) => x.live && x.seed === m.k)!;
    expect(b.t0).toBe(s.tb);
  });

  it("drops a launch that arrives long after it would have burst", () => {
    const { engine, director } = screenDirector();
    const s = launchInto(director, msgFor(2));
    director.update(s.tb + 5000);
    expect(engine.bursts.slots.some((x) => x.live)).toBe(false);
  });

  it("echoes the burst to the frame that launched it", () => {
    const echoes: string[] = [];
    const engine = createEngine({
      shells: 8,
      bursts: 8,
      budget: 8,
      onBurst: (s) => {
        if (s.frame) echoes.push(`${s.frame}:${s.pad}:${s.exitU.toFixed(2)}`);
      },
    });
    const director = createDirector({
      engine,
      config: cfg,
      seed: "x",
      sky: () => sky,
      fit: () => ({ x0: 0, x1: W, launchY: -1500, density: 1, maxRank: 99, rx0: 0, rx1: W }),
      corner: null,
      pads: () => 6,
      showAllowed: () => false,
    });
    const s = launchInto(director, msgFor(1));
    director.update(s.tb + 10);
    expect(echoes).toEqual(["panel-4:0:0.50"]);
  });
});
