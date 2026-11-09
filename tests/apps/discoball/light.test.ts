import { describe, expect, it } from "vitest";
import { createRng } from "../../../src/core/rng";
import { sphereInfo, wrapLon } from "../../../src/core/sphere";
import {
  createCrowd,
  createShading,
  GATE_GAP,
  GATE_REACH,
  shade,
  shown,
} from "../../../src/apps/discoball/light";
import { createShow, spinAngle, TURN_SECONDS } from "../../../src/apps/discoball/show";
import { buildLayout, PITCH } from "../../../src/apps/discoball/tiles";

const layout = buildLayout(createRng("discoball:tiles"));
const sphere = sphereInfo();

/** Runs the ball, calling `each` after every frame with the time and the shading. */
const run = (
  seed: string,
  seconds: number,
  each: (t: number, theta: number, s: ReturnType<typeof createShading>) => void,
  from = 0,
) => {
  const show = createShow(seed, "party");
  const crowd = createCrowd(seed);
  const s = createShading(layout);
  for (let f = 0; f < seconds * 60; f++) {
    const t = from + f / 60;
    const theta = spinAngle(t, TURN_SECONDS.slow);
    shade(layout, sphere, theta, show.at(t), crowd.at(t, sphere.radius), s);
    each(t, theta, s);
  }
  return s;
};

/** Room latitude and longitude of tile `i` with the ball turned `theta`. */
const placeOf = (i: number, theta: number) => {
  const j = i * 3;
  return {
    lat: Math.asin(layout.centre[j + 1]!),
    lon: wrapLon(Math.atan2(layout.centre[j]!, layout.centre[j + 2]!) + theta),
  };
};

describe("discoball light", { timeout: 60_000 }, () => {
  it("shows dim colours as they are and saturates bright ones without changing hue", () => {
    const out = [0, 0, 0];
    expect(shown(0.02, 0.02, 0.02, out)).toBeCloseTo(0.0198, 3);
    shown(3, 0.3, 1.2, out);
    expect(Math.max(...out)).toBeLessThanOrEqual(1);
    expect(out[0]!).toBeGreaterThan(0.85);
    expect(out[1]! / out[0]!).toBeLessThan(0.25);
    // Only the brightest goes white-hot.
    shown(8, 0.8, 3, out);
    expect(out[1]! / out[0]!).toBeGreaterThan(0.4);
  });

  it("sparkles all round the ball, low down for people underneath, rarely in the cap", () => {
    const thirds = [0, 0, 0];
    let low = 0;
    let cap = 0;
    let total = 0;
    run("round", 30, (_t, theta, s) => {
      for (let i = 0; i < layout.count; i++) {
        if (s.flash[i]! < 0.5) continue;
        const p = placeOf(i, theta);
        thirds[Math.min(2, Math.floor(((p.lon + Math.PI) / (2 * Math.PI)) * 3))]!++;
        if (p.lat < (-45 * Math.PI) / 180) low++;
        if (p.lat > sphere.view.top) cap++;
        total++;
      }
    });
    for (const n of thirds) expect(n).toBeGreaterThan(total / 6);
    expect(low).toBeGreaterThan(total / 20);
    expect(cap).toBeLessThan(total / 10);
  });

  it("never starts two sparkles close together in quick succession", () => {
    const starts: { t: number; lat: number; lon: number }[] = [];
    let before = new Uint8Array(layout.count);
    run("gate", 20, (t, theta, s) => {
      for (let i = 0; i < layout.count; i++) {
        if (s.gate[i] === 1 && before[i] !== 1) starts.push({ t, ...placeOf(i, theta) });
      }
      before = s.gate.slice();
    });
    expect(starts.length).toBeGreaterThan(200);
    starts.sort((a, b) => a.t - b.t);
    // Two tiles' widths apart, a little less than the gate's reach, measured along the surface.
    const near = GATE_REACH * PITCH * 0.95;
    for (let a = 0; a < starts.length; a++) {
      for (let b = a + 1; b < starts.length && starts[b]!.t - starts[a]!.t < GATE_GAP - 0.02; b++) {
        const p = starts[a]!;
        const q = starts[b]!;
        const dLat = q.lat - p.lat;
        const dLon = wrapLon(q.lon - p.lon) * Math.cos((p.lat + q.lat) / 2);
        expect(Math.hypot(dLat, dLon), `${p.t} and ${q.t}`).toBeGreaterThan(near);
      }
    }
  });

  it("keeps the ball dim between sparkles and fills the texture with finite colours", () => {
    const s = run("dim", 5, () => undefined);
    let sum = 0;
    let n = 0;
    for (let i = 0; i < layout.count; i++) {
      const o = layout.texel[i]! * 4;
      for (let c = 0; c < 4; c++) expect(Number.isFinite(s.data[o + c]!)).toBe(true);
      if (s.flash[i]! > 0.05) continue;
      sum += shown(s.data[o]!, s.data[o + 1]!, s.data[o + 2]!);
      n++;
    }
    const mean = sum / n;
    expect(mean).toBeGreaterThan(0.01);
    expect(mean).toBeLessThan(0.06);
  });

  it("gives the same picture for the same moment", () => {
    const a = run("same", 2, () => undefined);
    const b = run("same", 2, () => undefined);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });

  it("puts its viewers on the floor round and under the ball", () => {
    const crowd = createCrowd("people");
    for (let t = 0; t < 3600; t += 37) {
      for (const v of crowd.at(t, sphere.radius)) {
        expect(Math.hypot(v.x, v.z)).toBeLessThan(3.6 * sphere.radius);
        expect(v.eye).toBeGreaterThanOrEqual(1);
        expect(v.eye).toBeLessThanOrEqual(1.75);
      }
    }
    const under = crowd.at(0, sphere.radius).filter((v) => Math.hypot(v.x, v.z) < sphere.radius);
    expect(under.length).toBeGreaterThanOrEqual(3);
  });

  it("copes with a long gap between frames", () => {
    const show = createShow("gap", "party");
    const crowd = createCrowd("gap");
    const s = createShading(layout);
    shade(layout, sphere, 0, show.at(0), crowd.at(0, sphere.radius), s, 1 / 60);
    shade(layout, sphere, 1, show.at(500), crowd.at(500, sphere.radius), s, 500);
    for (const v of s.data) expect(Number.isFinite(v)).toBe(true);
    expect(s.time).toBeCloseTo(500 + 1 / 60, 6);
  });
});
