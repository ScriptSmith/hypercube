import { describe, expect, it } from "vitest";
import {
  CAP,
  CLOCK,
  firstStrip,
  makeCracks,
  pieceOf,
  RING_SAMPLES,
  sampleRound,
  type Segment,
} from "../../../src/apps/hatch/cracks";
import {
  createEggData,
  decodeDistance,
  CRACK_RANGE,
  eggDataJob,
} from "../../../src/apps/hatch/raster";
import { createShow, type EggPlan, findStage } from "../../../src/apps/hatch/show";
import { createRng } from "../../../src/core/rng";
import { angleBetween, DEG, latLonOf, wrapLon } from "../../../src/core/sphere";

const plans = (n: number, seed = "c"): EggPlan[] => {
  const show = createShow(createRng(seed), {
    variant: "hatch",
    pace: "normal",
    shell: "mixed",
    viewTop: 40 * DEG,
  });
  const out: EggPlan[] = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    const e = show.egg(t);
    out.push(e);
    t = e.start + e.duration;
  }
  return out;
};

const ll = (v: Segment["a"]) => latLonOf(v);

describe("the crack network", () => {
  it("starts the star at the pip and keeps it near", () => {
    for (const plan of plans(5)) {
      const net = makeCracks(createRng(`n${plan.index}`), plan);
      const star = net.segments.filter(
        (s) => s.ta >= CLOCK.star[0] && s.tb <= CLOCK.star[1] + 1e-9,
      );
      expect(star.length).toBeGreaterThan(8);
      for (const s of star) {
        const p = ll(s.b);
        expect(angleBetween(p.lat, p.lon, plan.pip.lat, plan.pip.lon)).toBeLessThan(20 * DEG);
      }
    }
  });

  it("joins the pecks into a connected ring that closes round the egg at the pip's latitude", () => {
    for (const plan of plans(6)) {
      const net = makeCracks(createRng(`n${plan.index}`), plan);
      // Ring segments, zip then the final push, joined end to end once sorted by time.
      const ring = net.segments.filter(
        (s) => s.r < 0.01 && s.ta >= CLOCK.zip[0] && s.tb <= CLOCK.final[1] + 1e-9,
      );
      const ends = (s: Segment) => [s.a, s.b];
      // Every peck sits on a crack; each segment end meets another segment (or a peck).
      for (const p of net.pecks) {
        const near = net.segments.some((s) =>
          ends(s).some((v) => {
            const q = ll(v);
            return angleBetween(q.lat, q.lon, p.lat, p.lon) < 1e-6;
          }),
        );
        expect(near).toBe(true);
      }
      // The ring table goes all the way round, near the pip's latitude.
      expect(net.ring.length).toBe(RING_SAMPLES);
      for (const lat of net.ring) {
        expect(Math.abs(lat - plan.pip.lat)).toBeLessThan(9 * DEG);
      }
      // And the table passes through the pip and each peck.
      for (const p of net.pecks) {
        expect(Math.abs(sampleRound(net.ring, p.lon) - p.lat)).toBeLessThan(0.6 * DEG);
      }
      expect(ring.length).toBeGreaterThan(net.pecks.length * 4);
    }
  });

  it("chips round in the planned direction, then breaks the rest at the push", () => {
    for (const plan of plans(4)) {
      const net = makeCracks(createRng(`n${plan.index}`), plan);
      const steps = net.pecks
        .slice(1)
        .map((p, i) => wrapLon(p.lon - net.pecks[i]!.lon) * plan.zipDir);
      for (const d of steps) expect(d).toBeGreaterThan(0);
      const final = net.segments.filter(
        (s) => s.ta >= CLOCK.final[0] && s.tb <= CLOCK.final[1] + 1e-9,
      );
      expect(final.length).toBeGreaterThan(4);
      for (const s of final) {
        const p = ll(s.b);
        // The push breaks only the stretch the chick didn't chip.
        const rel = (wrapLon(p.lon - plan.pip.lon) * plan.zipDir + 2 * Math.PI) % (2 * Math.PI);
        expect(rel === 0 || rel > plan.zipSpan - 3 * DEG).toBe(true);
      }
    }
  });

  it("splits the shell into a cap above the ring, strips below and a cup at the bottom", () => {
    for (const plan of plans(4)) {
      const net = makeCracks(createRng(`n${plan.index}`), plan);
      const strips = net.pieces - 1;
      expect(strips).toBeGreaterThanOrEqual(4);
      expect(pieceOf(net, 89 * DEG, 0)).toBe(CAP);
      expect(pieceOf(net, -89 * DEG, 1)).toBe(firstStrip + strips);
      const seen = new Set<number>();
      for (let lon = -180; lon < 180; lon += 2) seen.add(pieceOf(net, -20 * DEG, lon * DEG));
      expect(seen.size).toBe(strips);
      for (let lon = -180; lon < 180; lon += 3) {
        const ring = sampleRound(net.ring, lon * DEG);
        expect(pieceOf(net, ring + 1 * DEG, lon * DEG)).toBe(CAP);
        expect(pieceOf(net, ring - 1 * DEG, lon * DEG)).not.toBe(CAP);
      }
    }
  });

  it("draws every crack in the texture data, appearing at its own time", () => {
    const plan = plans(2)[1]!;
    const net = makeCracks(createRng("draw"), plan);
    const data = createEggData(512, 256);
    const job = eggDataJob(data, net, []);
    let steps = 0;
    while (!job.step(5)) steps++;
    expect(steps).toBeLessThan(500);
    // The texel under each peck is inside a crack, and its time is the peck's.
    const zip = findStage(plan, "zip")!;
    expect(zip).toBeTruthy();
    for (const p of net.pecks.slice(1)) {
      const i = Math.floor(((p.lon + Math.PI) / (2 * Math.PI)) * data.w);
      const j = Math.floor(((p.lat + Math.PI / 2) / Math.PI) * data.h);
      const k = (j * data.w + i) * 4;
      expect(decodeDistance(data.data[k]!, CRACK_RANGE)).toBeLessThan(0);
      const t = data.data[k + 1]! / 255;
      expect(t).toBeGreaterThanOrEqual(CLOCK.zip[0] - 0.01);
      expect(t).toBeLessThanOrEqual(CLOCK.zip[1] + 0.01);
    }
    // Piece ids cover the sphere with the cap at the top and the cup at the bottom.
    expect(data.pieces[(data.h - 1) * data.w]).toBe(CAP);
    expect(data.pieces[0]).toBe(firstStrip + net.pieces - 1);
  });
});
