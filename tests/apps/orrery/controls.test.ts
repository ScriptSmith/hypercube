import { describe, expect, it } from "vitest";
import { EARTH_TILT, SYNODIC, YEAR } from "../../../src/apps/orrery/astro";
import { BRISBANE, TIMING, type Variant } from "../../../src/apps/orrery/config";
import {
  createControls,
  dialAngle,
  dialHour,
  latOf,
  latU,
  tiltOf,
  tiltU,
} from "../../../src/apps/orrery/controls";
import { sliderX } from "../../../src/apps/orrery/layout";
import type { LocalClaim } from "../../../src/apps/orrery/link";
import type { Sky } from "../../../src/apps/orrery/sky";
import { layoutOf } from "./helpers";

/** Controls over a state that takes every claim at once, as a solo frame's keeper does. */
const rig = (variant: Variant = "seasons") => {
  const layout = layoutOf("panel", { variant });
  let sky: Sky = { day: 10_000, hour: 12, tilt: EARTH_TILT, flat: false, speed: 1 };
  const claims: LocalClaim[] = [];
  const places = [BRISBANE.lat];
  let clock = 1_000_000;
  const c = createControls({
    layout: () => layout,
    variant,
    sky: () => sky,
    clock: () => clock,
    baseTilt: EARTH_TILT,
    emit: (cl) => {
      claims.push(cl);
      if (cl.knob === "time") sky = { ...sky, day: cl.a, hour: cl.b };
      else if (cl.knob === "tilt") sky = { ...sky, tilt: cl.a };
    },
    onPlace: (i, lat) => {
      places[i] = lat;
    },
    placeMarks: () => [BRISBANE.lat],
  });
  let t = 0;
  const drag = (id: number, pts: { x: number; y: number }[], ms = 16) => {
    c.down(id, pts[0]!.x, pts[0]!.y, t, true);
    for (const p of pts.slice(1)) {
      t += ms;
      clock += ms;
      c.move(id, p.x, p.y, t);
    }
  };
  const lift = (id: number, wait = 0) => {
    t += wait;
    c.up(id, t);
  };
  const step = (ms: number) => {
    const end = t + ms;
    while (t < end) {
      t += 1000 / 60;
      c.step(t, 1 / 60);
    }
  };
  return { layout, c, claims, places, sky: () => sky, drag, lift, step };
};

const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n = 24) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) };
  });

describe("controls", () => {
  it("turn the year wheel anticlockwise to move the date on, a year a turn", () => {
    const r = rig();
    const w = r.layout.wheel!;
    const before = r.sky().day;
    r.drag(1, arc(w.x, w.y, w.r * 0.7, 0, Math.PI / 2));
    r.lift(1, 200);
    expect(r.sky().day - before).toBeCloseTo(YEAR / 4, 6);
    expect(r.sky().hour).toBe(12);
    expect(r.claims.at(-1)).toMatchObject({ knob: "time", held: false, bot: false });
    // Clockwise goes back.
    r.drag(2, arc(w.x, w.y, w.r * 0.7, 0, -Math.PI));
    r.lift(2, 200);
    expect(r.sky().day - before).toBeCloseTo(-YEAR / 4, 6);
  });

  it("turn the moon wheel a month a turn, and coast after a flick", () => {
    const r = rig("moon");
    const w = r.layout.wheel!;
    const before = r.sky().day;
    r.drag(1, arc(w.x, w.y, w.r * 0.7, 0, Math.PI * 2, 48));
    r.lift(1, 100);
    expect(r.sky().day - before).toBeCloseTo(SYNODIC, 6);
    // A quick turn let go at once keeps going, then stops.
    const at = r.sky().day;
    r.drag(2, arc(w.x, w.y, w.r * 0.7, 0, 1.4, 6), 16);
    r.lift(2);
    expect(r.c.coasting).toBe(true);
    expect(r.c.holding("time")).toBe(true);
    const flicked = r.sky().day;
    r.step(400);
    expect(r.sky().day).toBeGreaterThan(flicked);
    r.step(15_000);
    expect(r.c.coasting).toBe(false);
    expect(r.c.holding("time")).toBe(false);
    expect(r.sky().day - at).toBeGreaterThan((SYNODIC * 1.4) / (Math.PI * 2));
  });

  it("turn the dial clockwise to move the clock on, carrying the date past midnight", () => {
    const r = rig();
    const d = r.layout.dial!;
    expect(dialHour(d.x, d.y, d.x, d.y - 50)).toBeCloseTo(12, 9);
    expect(dialHour(d.x, d.y, d.x + 50, d.y)).toBeCloseTo(18, 9);
    expect(dialHour(d.x, d.y, d.x, d.y + 50)).toBeCloseTo(0, 9);
    expect(dialAngle(18)).toBeCloseTo(Math.PI / 2, 9);
    const day = r.sky().day;
    // From the top round the right to the bottom and on to the left: noon to 6 the next morning.
    r.drag(1, arc(d.x, d.y, d.r * 0.6, Math.PI / 2, -Math.PI, 36));
    r.lift(1, 200);
    expect(r.sky().hour).toBeCloseTo(6, 6);
    expect(r.sky().day).toBe(day + 1);
    // A tap sets the hour tapped, the short way round: back from 6 in the morning to 9 at night.
    const k = d.r * 0.6 * Math.SQRT1_2;
    r.drag(2, [{ x: d.x + k, y: d.y + k }]);
    r.lift(2, 60);
    expect(r.sky().hour).toBeCloseTo(21, 6);
    expect(r.sky().day).toBe(day);
  });

  it("move the tilt to the finger, sticking at the Earth's tilt, 0 and 90", () => {
    const r = rig();
    const s = r.layout.tilt!;
    expect(tiltOf(tiltU(EARTH_TILT) + 0.01)).toBe(EARTH_TILT);
    expect(tiltOf(0.005)).toBe(0);
    expect(tiltOf(0.5)).toBe(45);
    r.drag(1, [
      { x: sliderX(s, 0.3), y: s.y },
      { x: sliderX(s, 0.6), y: s.y },
      { x: sliderX(s, 0.995), y: s.y + 10 },
    ]);
    expect(r.sky().tilt).toBe(90);
    r.lift(1);
    expect(r.claims.at(-1)).toMatchObject({ knob: "tilt", a: 90, held: false });
    // Reset eases it back to the Earth's.
    r.c.resetTilt(0, true);
    r.step(TIMING.resetTilt / 2);
    expect(r.sky().tilt).toBeGreaterThan(EARTH_TILT);
    expect(r.sky().tilt).toBeLessThan(90);
    r.step(TIMING.resetTilt);
    expect(r.sky().tilt).toBe(EARTH_TILT);
  });

  it("move the place from pole to pole, sticking at Brisbane and the equator", () => {
    const r = rig();
    const s = r.layout.places[0]!;
    expect(latOf(latU(BRISBANE.lat) + 0.005)).toBe(BRISBANE.lat);
    expect(latOf(0.5)).toBe(0);
    expect(latOf(0)).toBe(90);
    r.drag(1, [{ x: sliderX(s, 0.1), y: s.y }]);
    expect(r.places[0]).toBe(72);
    r.drag(1, [
      { x: sliderX(s, 0.1), y: s.y },
      { x: sliderX(s, latU(-28)), y: s.y },
    ]);
    expect(r.places[0]).toBe(BRISBANE.lat);
    r.lift(1);
  });

  it("spin the Earth through a day, unless a finger holds the time", () => {
    const r = rig();
    const day = r.sky().day;
    r.c.spin(0, true);
    expect(r.c.spinning).toBe(true);
    r.step(TIMING.spin / 2);
    expect(r.sky().hour).toBeLessThan(2);
    r.step(TIMING.spin / 2 + 100);
    expect(r.c.spinning).toBe(false);
    expect(r.sky()).toMatchObject({ day: day + 1, hour: 12 });
    expect(r.claims.at(-1)).toMatchObject({ knob: "time", held: false });
    const w = r.layout.wheel!;
    r.c.down(9, w.x + w.r * 0.5, w.y, 0, true);
    r.c.spin(0, true);
    expect(r.c.spinning).toBe(false);
  });

  it("let the latest finger on a control lead, and an earlier one take over when it lifts", () => {
    const r = rig();
    const w = r.layout.wheel!;
    const before = r.sky().day;
    r.c.down(1, w.x + w.r * 0.6, w.y, 0, true);
    r.c.down(2, w.x, w.y - w.r * 0.6, 10, false);
    // The first finger is ignored while the second leads.
    r.c.move(1, w.x, w.y - w.r * 0.6, 20);
    expect(r.sky().day).toBe(before);
    r.c.move(2, w.x - w.r * 0.6, w.y, 30);
    expect(r.sky().day - before).toBeCloseTo(YEAR / 4, 6);
    expect(r.claims.at(-1)?.bot).toBe(true);
    expect(r.c.personDown).toBe(true);
    r.c.up(2, 40);
    expect(r.c.count).toBe(1);
    expect(r.c.holding("time")).toBe(true);
    r.c.clear(50);
    expect(r.c.count).toBe(0);
    expect(r.c.holding("time")).toBe(false);
  });
});
