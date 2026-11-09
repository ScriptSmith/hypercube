import { describe, expect, it } from "vitest";
import { createGhosts, ghostAt, MAX_SAMPLES } from "../../../src/apps/treetop/ghost";

const record = (
  g: ReturnType<typeof createGhosts>,
  label: string,
  ms: number,
  speed: number,
  fin: number | null,
) => {
  g.start(label, 90_000);
  for (let t = 0; t <= ms; t += 10) g.sample(t, (t / 1000) * speed, 900 + Math.sin(t / 300) * 100);
  g.finish(fin, (ms / 1000) * speed);
};

describe("ghost runs", () => {
  it("keeps at most 900 samples however long the run", () => {
    const g = createGhosts();
    record(g, "solo-1", 200_000, 360, null);
    const run = g.best("solo-1")!;
    expect(run.n).toBeLessThanOrEqual(MAX_SAMPLES);
    expect(run.xs.length).toBe(MAX_SAMPLES);
  });

  it("keeps the fastest finish, else the furthest run, on the current course only", () => {
    const g = createGhosts();
    record(g, "solo-1", 20_000, 300, null);
    expect(g.best("solo-1")!.d).toBe(6000);
    record(g, "solo-1", 30_000, 300, null);
    expect(g.best("solo-1")!.d).toBe(9000);
    record(g, "solo-1", 40_000, 400, 40_000);
    expect(g.best("solo-1")!.fin).toBe(40_000);
    record(g, "solo-1", 41_000, 420, 38_000);
    expect(g.best("solo-1")!.fin).toBe(38_000);
    record(g, "solo-1", 45_000, 400, 39_000);
    expect(g.best("solo-1")!.fin).toBe(38_000);
    // The best run's samples survive recordings that don't beat it.
    expect(ghostAt(g.best("solo-1")!, 1000).x).toBeCloseTo(420, 0);
    g.start("solo-2", 45_000);
    expect(g.best("solo-1")).toBe(null);
    expect(g.best("solo-2")).toBe(null);
  });

  it("drops a recording the station gave up", () => {
    const g = createGhosts();
    g.start("solo-1", 45_000);
    g.sample(0, 0, 900);
    g.sample(100, 36, 900);
    g.abandon();
    g.finish(1000, 50);
    expect(g.best("solo-1")).toBe(null);
  });

  it("replays by interpolating and then holds the last position", () => {
    const g = createGhosts();
    record(g, "solo-1", 10_000, 360, 10_000);
    const run = g.best("solo-1")!;
    const a = ghostAt(run, 5000);
    expect(a.x).toBeCloseTo(1800, -1);
    expect(a.done).toBe(false);
    const end = ghostAt(run, 60_000);
    expect(end.done).toBe(true);
    expect(end.x).toBeCloseTo(3600, -1);
  });
});
