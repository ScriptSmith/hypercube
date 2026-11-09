import { describe, expect, it } from "vitest";
import { venueFrame } from "./helpers";
import { KITE_IDLE_MS } from "../../../src/apps/kites/config";
import { WIND_SPEED, type WindFn } from "../../../src/apps/kites/kite";
import { layoutFor, type LayoutInput } from "../../../src/apps/kites/layout";
import {
  createPatch,
  drag,
  grab,
  HOP_S,
  type Patch,
  rebase,
  relaunch,
  release,
  resetPatch,
  stepPatch,
} from "../../../src/apps/kites/patch";
import {
  bankSky,
  exitX,
  frameX,
  frameY,
  localSky,
  screenAspect,
  worldX,
} from "../../../src/apps/kites/sky";
import { bankFraction } from "../../../src/core/layout";

const DT = 1 / 120;
const wind: WindFn = () => 0.6 * WIND_SPEED * 1.6;

const input = (kind: "panel" | "pair" = "panel"): LayoutInput => ({
  kind,
  width: kind === "pair" ? 2160 : 1080,
  height: 1920,
  reachTop: venueFrame("panel").reachTop,
  seams: kind === "pair" ? [1080] : [],
  variant: "duo",
  flyers: 6,
});

describe("skies", () => {
  it("a bank's sky comes from the count and the venue profile alone", () => {
    const l = layoutFor(input());
    const sky = bankSky(l, { pos: 3, count: 6 });
    expect(sky.scale).toBeCloseTo(6 * 1080 * screenAspect());
    expect(sky.width).toBeCloseTo(1 / screenAspect());
    // A point at u across panel 3 is at bankFraction(3, u, 6) of the screen.
    for (const u of [0, 0.25, 0.5, 1]) {
      expect(sky.fOf(worldX(sky, u * 1080))).toBeCloseTo(bankFraction(3, u, 6));
    }
    expect(frameX(sky, worldX(sky, 321))).toBeCloseTo(321);
    expect(frameY(sky, 0)).toBe(0);
    expect(frameY(sky, 0.5)).toBeLessThan(0);
    // Pairs give the same screen.
    const pair = bankSky(layoutFor(input("pair")), { pos: 1, count: 3 });
    expect(pair.scale).toBeCloseTo(sky.scale);
  });

  it("a frame's own sky sits above its horizon, keeping the bank's wind in a bank", () => {
    const l = layoutFor(input());
    const own = localSky(l, null);
    expect(own.baseY).toBe(l.horizon);
    expect(frameY(own, 1)).toBeCloseTo(0);
    const inBank = localSky(l, { pos: 2, count: 4 });
    expect(inBank.fOf(inBank.width / 2)).toBeCloseTo(bankFraction(2, 0.5, 4));
  });

  it("lines leave the top edge leaning towards their kite, but not far", () => {
    expect(exitX(500, 600, 500, -3000, 0, 400)).toBe(500);
    const lean = exitX(500, 600, 2500, -3000, 0, 400);
    expect(lean).toBeGreaterThan(500);
    expect(lean).toBeLessThanOrEqual(900);
    expect(exitX(500, 600, -20_000, -1000, 0, 400)).toBe(100);
  });
});

describe("a patch", () => {
  const make = () => {
    const l = layoutFor(input());
    const sky = localSky(l, null);
    const p = createPatch(l.patches[0]!, 0, sky, 1, 0.5);
    return { l, sky, p };
  };

  it("hands a kite to people on the first touch and back to the autopilot later", () => {
    const { sky, p } = make();
    expect(p.modes.spool).toBe("auto");
    grab(p, "spool", 1, p.button.spec.y, true, 1000);
    expect(p.modes.spool).toBe("people");
    expect(p.modes.stunt).toBe("auto");
    expect(p.counts.flown).toBe(1);
    release(p, "spool", 1);
    stepPatch(p, DT, 0, 1000 + KITE_IDLE_MS - 1, wind, sky);
    expect(p.modes.spool).toBe("people");
    stepPatch(p, DT, 0, 1000 + KITE_IDLE_MS + 1, wind, sky);
    expect(p.modes.spool).toBe("auto");
  });

  it("bots take kites without counting as people", () => {
    const { p } = make();
    grab(p, "left", 7, p.grips.left!.y, false, 0);
    expect(p.modes.stunt).toBe("people");
    expect(p.counts.flown).toBe(0);
    expect(p.human.stunt).toBe(Number.NEGATIVE_INFINITY);
  });

  /** Step `p` for `s` seconds from local ms `from`, returning the spool kite's heights. */
  const steps = (p: Patch, sky: ReturnType<typeof localSky>, from: number, s: number) => {
    const ys: number[] = [];
    for (let i = 0; i < s / DT; i++) {
      const now = from + i * DT * 1000;
      stepPatch(p, DT, now / 1000, now, wind, sky);
      ys.push(p.spool.y);
    }
    return ys;
  };

  it("holding the spool reels in and the kite climbs; let go, it drifts down and hovers", () => {
    const { sky, p } = make();
    grab(p, "spool", 1, p.button.spec.y, true, 0);
    release(p, "spool", 1);
    steps(p, sky, 0, 8);
    const rest = p.spool.y;
    grab(p, "spool", 2, p.button.spec.y, true, 8000);
    const up = steps(p, sky, 8000, 3);
    expect(p.button.reeling).toBe(true);
    expect(p.haul).toBeGreaterThan(0);
    expect(p.button.press).toBeGreaterThan(0.9);
    expect(up[Math.round(0.3 / DT)]!).toBeGreaterThan(rest + 0.03);
    expect(p.spool.y).toBeGreaterThan(rest + 0.4);
    const high = p.spool.y;
    release(p, "spool", 2);
    const down = steps(p, sky, 11_000, 15);
    expect(p.button.reeling).toBe(false);
    expect(down[Math.round(1 / DT)]!).toBeGreaterThan(high - 0.2);
    expect(p.spool.y).toBeLessThan(rest + 0.05);
    expect(Math.min(...down)).toBeGreaterThan(sky.bounds.floor);
    expect(p.modes.spool).toBe("people");
  });

  it("a tap gives a short hop", () => {
    const { sky, p } = make();
    grab(p, "spool", 1, p.button.spec.y, true, 0);
    release(p, "spool", 1);
    steps(p, sky, 0, 8);
    const rest = p.spool.y;
    grab(p, "spool", 2, p.button.spec.y, true, 8000);
    release(p, "spool", 2);
    const hop = steps(p, sky, 8000, 2);
    expect(p.button.reeling).toBe(false);
    expect(HOP_S).toBeLessThan(0.5);
    expect(Math.max(...hop)).toBeGreaterThan(rest + 0.05);
    expect(Math.max(...hop)).toBeLessThan(rest + 0.3);
    steps(p, sky, 10_000, 8);
    expect(p.spool.y).toBeLessThan(rest + 0.03);
  });

  it("the spool's kite stays in its patch's column, on a bank or a wall", () => {
    const skies = [
      {
        l: layoutFor(input()),
        sky: (l: ReturnType<typeof layoutFor>) => bankSky(l, { pos: 3, count: 6 }),
      },
      {
        l: layoutFor({
          ...input(),
          kind: "wall",
          ...venueFrame("wall"),
        }),
        sky: (l: ReturnType<typeof layoutFor>) => localSky(l, null),
      },
    ];
    for (const { l, sky: skyOf } of skies) {
      const sky = skyOf(l);
      for (const spec of l.patches.slice(0, 2)) {
        const p = createPatch(spec, spec.index, sky, 1, 0.5);
        const x0 = worldX(sky, spec.x0);
        const x1 = worldX(sky, spec.x1);
        let now = 0;
        for (let cycle = 0; cycle < 4; cycle++) {
          grab(p, "spool", 1, spec.spool.y, true, now);
          for (let i = 0; i < 4 / DT; i++, now += DT * 1000) {
            stepPatch(p, DT, now / 1000, now, wind, sky);
            expect(p.spool.x).toBeGreaterThan(x0);
            expect(p.spool.x).toBeLessThan(x1);
          }
          release(p, "spool", 1);
          for (let i = 0; i < 8 / DT; i++, now += DT * 1000) {
            stepPatch(p, DT, now / 1000, now, wind, sky);
            expect(p.spool.x).toBeGreaterThan(x0);
            expect(p.spool.x).toBeLessThan(x1);
          }
        }
      }
    }
  });

  it("in attract the autopilot holds the spool, then lets go", () => {
    const { sky, p } = make();
    let holds = 0;
    let was = false;
    for (let i = 0; i < 40 / DT; i++) {
      stepPatch(p, DT, i * DT, i * DT * 1000, wind, sky);
      if (p.button.reeling && !was) holds++;
      was = p.button.reeling;
    }
    expect(p.modes.spool).toBe("auto");
    expect(holds).toBeGreaterThanOrEqual(3);
  });

  it("a stunt kite follows its handles and parks when they are let go", () => {
    const { sky, p } = make();
    const l = p.grips.left!;
    grab(p, "left", 1, l.y, true, 0);
    grab(p, "right", 2, p.grips.right!.y, true, 0);
    drag(p, "left", 1, l.y + l.spec.travel, 0);
    drag(p, "right", 2, p.grips.right!.spec.restY - 50, 0);
    const h0 = p.stunt!.heading;
    stepPatch(p, 0.2, 0, 0, wind, sky);
    expect(p.handles.left).toBeCloseTo(1);
    expect(p.handles.right).toBe(0);
    expect(p.stunt!.heading).not.toBeCloseTo(h0);
    release(p, "left", 1);
    release(p, "right", 2);
    for (let i = 0; i < 12 / DT; i++) stepPatch(p, DT, i * DT, 1000, wind, sky);
    expect(p.stunt!.parked).toBeGreaterThan(0.8);
  });

  it("hold-to-reset reels both kites in and keeps them the visitors'", () => {
    const { sky, p } = make();
    p.spool.length = 0.8;
    relaunch(p, sky, 500);
    expect(p.spool.length).toBeLessThan(0.3);
    expect(p.modes.spool).toBe("people");
    resetPatch(p, sky, 1);
    expect(p.modes.spool).toBe("auto");
    expect(p.modes.stunt).toBe("auto");
  });

  it("keeps its kites in place when the sky changes", () => {
    const { l, p } = make();
    const bank = bankSky(l, { pos: 0, count: 4 });
    const off = p.stunt!.x - p.stunt!.ax;
    const len = p.spool.length;
    rebase(p, bank);
    expect(p.spool.ax).toBeCloseTo(worldX(bank, l.patches[0]!.cx));
    expect(p.spool.length).toBe(len);
    expect(p.stunt!.x - p.stunt!.ax).toBeCloseTo(off, 9);
  });
});
