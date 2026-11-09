import { describe, expect, it } from "vitest";
import { venueFrame } from "./helpers";
import { stuntAutopilot, stuntPilot } from "../../../src/apps/kites/autopilot";
import { WIND_SPEED } from "../../../src/apps/kites/kite";
import { type Layout, layoutFor, type LayoutInput } from "../../../src/apps/kites/layout";
import { createPatch, drag, grab, type Patch, stepPatch } from "../../../src/apps/kites/patch";
import { bankSky, localSky, type SkyFrame } from "../../../src/apps/kites/sky";
import { createWindField, WIND_PRESETS, windAt } from "../../../src/apps/kites/wind";

const DT = 1 / 120;
const T0 = 1_760_000_000;

const PANEL: LayoutInput = {
  kind: "panel",
  width: 1080,
  height: 1920,
  reachTop: venueFrame("panel").reachTop,
  seams: [],
  variant: "duo",
  flyers: 6,
};
const WALL: LayoutInput = {
  kind: "wall",
  ...venueFrame("wall"),
  seams: [],
  variant: "duo",
  flyers: 6,
};

const SKIES: [string, LayoutInput, (l: Layout) => SkyFrame][] = [
  ["panel", PANEL, (l) => localSky(l, null)],
  ["wall", WALL, (l) => localSky(l, null)],
  ["bank of 4", PANEL, (l) => bankSky(l, { pos: 1, count: 4 })],
  ["bank of 6", PANEL, (l) => bankSky(l, { pos: 4, count: 6 })],
];

/** Times a series turns back by more than `eps` (a zigzag counter with a dead band). */
const zigzags = (xs: readonly number[], eps: number): number => {
  let n = 0;
  let dir = 0;
  let hi = xs[0] ?? 0;
  let lo = hi;
  for (const x of xs) {
    if (dir === 0) {
      hi = Math.max(hi, x);
      lo = Math.min(lo, x);
      if (x < hi - eps) [dir, lo] = [-1, x];
      else if (x > lo + eps) [dir, hi] = [1, x];
    } else if (dir > 0) {
      if (x > hi) hi = x;
      else if (x < hi - eps) [n, dir, lo] = [n + 1, -1, x];
    } else if (x < lo) lo = x;
    else if (x > lo + eps) [n, dir, hi] = [n + 1, 1, x];
  }
  return n;
};

/**
 * Fly a patch's stunt kite for `secs` with the autopilot, either itself (attract) or as a bot
 * does, moving the handles every 40 ms. Returns turn-backs a second of the left handle, the
 * kite's heading and its height, sampled at 60 Hz.
 */
const fly = (
  sky: SkyFrame,
  p: Patch,
  bot: boolean,
  preset: keyof typeof WIND_PRESETS,
  secs = 60,
) => {
  const field = createWindField(7, WIND_PRESETS[preset]);
  let t = T0;
  const wind = (x: number, y: number) => windAt(field, t, sky.fOf(x), y) * WIND_SPEED;
  const k = p.stunt!;
  const gl = p.grips.left!;
  const gr = p.grips.right!;
  const pilot = stuntPilot();
  if (bot) {
    grab(p, "left", 1, gl.y, false, 0);
    grab(p, "right", 2, gr.y, false, 0);
  }
  const handle: number[] = [];
  const heading: number[] = [];
  const height: number[] = [];
  let turned = k.heading;
  let last = k.heading;
  let botAt = 0;
  let crashes = 0;
  for (let i = 0; i < secs / DT; i++) {
    const now = i * DT * 1000;
    if (bot && now >= botAt) {
      botAt = now + 40;
      stuntAutopilot(k, sky.window, t, p.phase, pilot, 0.04);
      drag(p, "left", 1, gl.spec.restY + pilot.left * gl.spec.travel, now);
      drag(p, "right", 2, gr.spec.restY + pilot.right * gr.spec.travel, now);
    }
    const was = k.phase;
    stepPatch(p, DT, t, now, wind, sky);
    if (was === "fly" && k.phase === "down") crashes++;
    t += DT;
    let d = k.heading - last;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    turned += d;
    last = k.heading;
    if (i % 2 === 0) {
      handle.push((gl.y - gl.spec.restY) / gl.spec.travel);
      heading.push(turned);
      height.push(k.y);
    }
  }
  return {
    handle: zigzags(handle, 0.03) / secs,
    heading: zigzags(heading, 0.05) / secs,
    height: zigzags(height, 0.002) / secs,
    crashes,
  };
};

describe("stunt autopilot", () => {
  // Before the fix its guards switched on and off from one step to the next: the handles turned
  // back 4 to 8 times a second and, under bots, the kite's heading 3 to 6 times. A figure eight
  // turns each handle back about once a second.
  for (const [name, input, skyOf] of SKIES) {
    it(`flies smoothly on a ${name}, itself and as a bot`, () => {
      for (const preset of ["gentle", "breezy", "gusty"] as const) {
        for (const bot of [false, true]) {
          const l = layoutFor(input);
          const sky = skyOf(l);
          const p = createPatch(l.patches[0]!, 0, sky, 1, 1.3);
          const r = fly(sky, p, bot, preset);
          const what = `${preset}, ${bot ? "bot" : "attract"}`;
          expect(r.handle, `${what}: handle`).toBeLessThan(1.5);
          expect(r.heading, `${what}: heading`).toBeLessThan(1);
          expect(r.height, `${what}: height`).toBeLessThan(1.2);
          expect(r.crashes, `${what}: crashes`).toBeLessThanOrEqual(1);
        }
      }
    });
  }

  it("still loops and figure-eights, using the whole window", () => {
    const l = layoutFor(PANEL);
    const sky = bankSky(l, { pos: 1, count: 4 });
    const p = createPatch(l.patches[0]!, 0, sky, 1, 1.3);
    const k = p.stunt!;
    const field = createWindField(7, WIND_PRESETS.breezy);
    let t = T0;
    const wind = (x: number, y: number) => windAt(field, t, sky.fOf(x), y) * WIND_SPEED;
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    let turned = 0;
    let last = k.heading;
    for (let i = 0; i < 60 / DT; i++) {
      stepPatch(p, DT, t, i * DT * 1000, wind, sky);
      t += DT;
      let d = k.heading - last;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      turned += Math.abs(d);
      last = k.heading;
      lo = Math.min(lo, k.y);
      hi = Math.max(hi, k.y);
    }
    expect(turned).toBeGreaterThan(Math.PI * 2 * 8);
    expect(hi - lo).toBeGreaterThan(0.5);
  });

  it("eases the handles rather than jumping them", () => {
    const l = layoutFor(PANEL);
    const sky = localSky(l, null);
    const p = createPatch(l.patches[0]!, 0, sky, 1, 1.3);
    const field = createWindField(7, WIND_PRESETS.gusty);
    let t = T0;
    const wind = (x: number, y: number) => windAt(field, t, sky.fOf(x), y) * WIND_SPEED;
    const gl = p.grips.left!;
    let prev = gl.y;
    let worst = 0;
    for (let i = 0; i < 60 / DT; i++) {
      stepPatch(p, DT, t, i * DT * 1000, wind, sky);
      t += DT;
      worst = Math.max(worst, Math.abs(gl.y - prev) / gl.spec.travel);
      prev = gl.y;
    }
    // At most about a travel in a seventh of a second: a hand, not a switch.
    expect(worst).toBeLessThan(0.07);
  });
});
