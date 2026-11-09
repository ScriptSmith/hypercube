import { describe, expect, it } from "vitest";
import { IRIS_ANGLE } from "../../../src/apps/gaze/physiology";
import { growVessels, MAX_SEGMENTS, type VesselSegment } from "../../../src/apps/gaze/vessels";
import { createRng } from "../../../src/core/rng";

const length = (s: VesselSegment) => Math.hypot(s.th1 - s.th0, (s.phi1 - s.phi0) * Math.sin(s.th0));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Path length over the straight distance, for runs of 12 joined segments of fine vessels. */
const tortuosity = (segs: readonly VesselSegment[]) => {
  const out: number[] = [];
  for (let i = 0; i + 12 <= segs.length; i += 12) {
    const run = segs.slice(i, i + 12);
    if (run.some((s) => s.deep || s.mesh || s.width > 0.003)) continue;
    if (run.some((s, k) => k > 0 && Math.abs(s.th0 - run[k - 1]!.th1) > 1e-9)) continue;
    const a = run[0]!;
    const b = run[run.length - 1]!;
    const chord = Math.hypot(b.th1 - a.th0, wrap(b.phi1 - a.phi0) * Math.sin(a.th0));
    out.push(run.reduce((sum, s) => sum + length(s), 0) / chord);
  }
  return out.sort((x, y) => x - y);
};

describe("vessels", () => {
  const segs = growVessels(createRng("v"), { iris: IRIS_ANGLE });

  it("are bounded and stay off the iris", () => {
    expect(segs.length).toBeGreaterThan(500);
    expect(segs.length).toBeLessThanOrEqual(MAX_SEGMENTS);
    for (const s of segs) {
      expect(s.th0).toBeGreaterThan(IRIS_ANGLE);
      expect(s.th1).toBeGreaterThan(IRIS_ANGLE);
      expect(s.width).toBeGreaterThan(0);
      expect(s.width).toBeLessThan(0.02);
    }
    expect(growVessels(createRng("v"), { iris: IRIS_ANGLE, max: 100 }).length).toBe(100);
  });

  it("are sparse and fine near the iris, as in a healthy eye", () => {
    // Little of the band next to the limbus is covered: under a tenth.
    const band = segs.filter((s) => !s.deep && s.th0 < IRIS_ANGLE + 0.25);
    let covered = 0;
    for (const s of band)
      covered += s.width * Math.hypot(s.th1 - s.th0, (s.phi1 - s.phi0) * Math.sin(s.th0));
    const area = 2 * Math.PI * Math.sin(IRIS_ANGLE + 0.12) * 0.25;
    expect(covered / area).toBeLessThan(0.1);
    const near = band.reduce((m, s) => Math.max(m, s.width), 0);
    const all = segs.filter((s) => !s.deep).reduce((m, s) => Math.max(m, s.width), 0);
    expect(near).toBeLessThan(all);
  });

  it("meander and kink rather than curving smoothly", () => {
    // Smooth curves alone came to 1.001.
    const t = tortuosity(segs);
    expect(t.length).toBeGreaterThan(50);
    expect(t[Math.floor(t.length / 2)]!).toBeGreaterThan(1.01);
  });

  it("join up into loops in the fine mesh", () => {
    // Each run of mesh segments is a link between two points; a graph with more links than its
    // points and parts has loops.
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      while (parent.get(x) !== x) x = parent.get(x)!;
      return x;
    };
    const key = (phi: number, th: number) =>
      `${Math.round(wrap(phi) * 1e6)},${Math.round(th * 1e6)}`;
    let links = 0;
    let start = "";
    segs.forEach((s, i) => {
      if (!s.mesh) return;
      const prev = segs[i - 1];
      if (!prev?.mesh || Math.abs(prev.th1 - s.th0) > 1e-12) start = key(s.phi0, s.th0);
      const next = segs[i + 1];
      if (next?.mesh && Math.abs(next.th0 - s.th1) <= 1e-12) return;
      const end = key(s.phi1, s.th1);
      for (const k of [start, end]) if (!parent.has(k)) parent.set(k, k);
      parent.set(find(start), find(end));
      links++;
    });
    const parts = new Set([...parent.keys()].map(find)).size;
    expect(links - parent.size + parts).toBeGreaterThan(20);
  });

  it("are commoner along the eye's horizontal meridian", () => {
    for (const seed of ["v", "a", "b"]) {
      let across = 0;
      let upright = 0;
      for (const s of growVessels(createRng(seed), { iris: IRIS_ANGLE })) {
        if (s.deep) continue;
        if (Math.abs(Math.sin(s.phi0)) < 0.5) across += length(s);
        if (Math.abs(Math.cos(s.phi0)) < 0.5) upright += length(s);
      }
      expect(across / upright).toBeGreaterThan(1.15);
    }
  });

  it("are the same for the same seed", () => {
    const again = growVessels(createRng("v"), { iris: IRIS_ANGLE });
    expect(again.length).toBe(segs.length);
    expect(again[17]).toEqual(segs[17]);
  });
});
