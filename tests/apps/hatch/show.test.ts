import { describe, expect, it } from "vitest";
import { createRng } from "../../../src/core/rng";
import { DEG } from "../../../src/core/sphere";
import {
  BASE_SECONDS,
  CANDLING_STAGES,
  createShow,
  DAYS,
  HATCH_STAGES,
  JITTER,
  pipLatitude,
  planEgg,
  SECONDS_PER_DAY,
  type ShowOptions,
  stageAt,
  stageSeconds,
} from "../../../src/apps/hatch/show";

const OPTS: ShowOptions = { variant: "hatch", pace: "normal", shell: "mixed", viewTop: 40 * DEG };

const eggs = (opts: ShowOptions, n: number, seed = "t") => {
  const show = createShow(createRng(seed), opts);
  const out = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    const e = show.egg(t);
    out.push(e);
    t = e.start + e.duration;
  }
  return out;
};

describe("the show's stages", () => {
  it("runs the hatch stages in order, back to back, for every egg", () => {
    for (const e of eggs(OPTS, 6)) {
      expect(e.stages.map((s) => s.id)).toEqual(HATCH_STAGES);
      for (let i = 1; i < e.stages.length; i++) {
        expect(e.stages[i]!.start).toBeCloseTo(e.stages[i - 1]!.end, 9);
        expect(e.stages[i]!.end).toBeGreaterThan(e.stages[i]!.start);
      }
      expect(e.duration).toBeCloseTo(e.stages[e.stages.length - 1]!.end, 9);
    }
  });

  it("starts the candling variant with 21 days of candling", () => {
    for (const pace of ["normal", "quick"] as const) {
      for (const e of eggs({ ...OPTS, variant: "candling", pace }, 3)) {
        expect(e.stages.map((s) => s.id)).toEqual(CANDLING_STAGES);
        const candle = e.stages[0]!;
        expect(candle.end - candle.start).toBeCloseTo(DAYS * SECONDS_PER_DAY[pace], 9);
      }
    }
  });

  it("keeps eggs about 6 minutes, or about 3 at the quick pace", () => {
    const normal = eggs(OPTS, 8).slice(1);
    const quick = eggs({ ...OPTS, pace: "quick" }, 8).slice(1);
    for (const e of normal) expect(e.duration / 60).toBeGreaterThan(5.2);
    for (const e of normal) expect(e.duration / 60).toBeLessThan(6.8);
    for (const e of quick) expect(e.duration / 60).toBeGreaterThan(2.6);
    for (const e of quick) expect(e.duration / 60).toBeLessThan(3.4);
  });

  it("varies each stage within the jitter, after a short opening on the first egg", () => {
    const list = eggs(OPTS, 10);
    for (const e of list.slice(1)) {
      for (const s of e.stages) {
        const base = stageSeconds(s.id, "normal");
        expect((s.end - s.start) / base).toBeGreaterThanOrEqual(1 - JITTER - 1e-9);
        expect((s.end - s.start) / base).toBeLessThanOrEqual(1 + JITTER + 1e-9);
      }
    }
    const first = list[0]!;
    const pip = first.stages.find((s) => s.id === "pip")!;
    expect(pip.start).toBeLessThan(8);
    expect(BASE_SECONDS.egg + BASE_SECONDS.stir).toBeGreaterThan(pip.start);
  });

  it("gives the dry stage about a minute", () => {
    for (const e of eggs(OPTS, 5)) {
      const dry = e.stages.find((s) => s.id === "dry")!;
      expect(dry.end - dry.start).toBeGreaterThan(50);
      expect(dry.end - dry.start).toBeLessThan(70);
    }
  });

  it("finds the stage at any moment", () => {
    const e = eggs(OPTS, 2)[1]!;
    for (const s of e.stages) {
      expect(stageAt(e, (s.start + s.end) / 2).id).toBe(s.id);
    }
    expect(stageAt(e, e.duration + 5).id).toBe("fade");
  });
});

describe("every egg differs", () => {
  it("never repeats a shell twice running with mixed shells, and uses many kinds", () => {
    const list = eggs(OPTS, 30);
    for (let i = 1; i < list.length; i++) expect(list[i]!.kind).not.toBe(list[i - 1]!.kind);
    expect(new Set(list.map((e) => e.kind)).size).toBeGreaterThanOrEqual(6);
  });

  it("keeps to the chosen shell group", () => {
    for (const e of eggs({ ...OPTS, shell: "blue" }, 8))
      expect(["blue", "olive"]).toContain(e.kind);
    for (const e of eggs({ ...OPTS, shell: "white" }, 8))
      expect(["white", "cream"]).toContain(e.kind);
  });

  it("moves the pip, the timings and the chick from egg to egg", () => {
    const list = eggs(OPTS, 12);
    const keys = list.map((e) =>
      [
        e.seed.toFixed(4),
        e.pip.lon.toFixed(4),
        e.duration.toFixed(3),
        e.chick.glances.length,
      ].join(),
    );
    expect(new Set(keys).size).toBe(list.length);
  });

  it("plans the same eggs for the same seed, and others for another", () => {
    const a = eggs(OPTS, 4, "same");
    const b = eggs(OPTS, 4, "same");
    const c = eggs(OPTS, 4, "other");
    expect(a.map((e) => e.kind)).toEqual(b.map((e) => e.kind));
    expect(a.map((e) => e.duration)).toEqual(b.map((e) => e.duration));
    expect(a.map((e) => e.duration)).not.toEqual(c.map((e) => e.duration));
  });
});

describe("the pip and the events inside a stage", () => {
  it("keeps the pip high on the side and below the band people see well", () => {
    for (let r = 0; r <= 1; r += 0.1) {
      const lat = pipLatitude(45 * DEG, r);
      expect(lat).toBeGreaterThanOrEqual(22 * DEG - 1e-9);
      expect(lat).toBeLessThanOrEqual(30 * DEG + 1e-9);
      expect(pipLatitude(36 * DEG, r)).toBeLessThanOrEqual(28 * DEG + 1e-9);
    }
    expect(pipLatitude(20 * DEG, 1)).toBeLessThanOrEqual(12 * DEG);
  });

  it("zips anticlockwise seen from above the blunt end, which is eastwards", () => {
    for (const e of eggs(OPTS, 5)) {
      expect(e.zipDir).toBe(1);
      expect(e.spin).toBeGreaterThan(0);
    }
  });

  it("faces the first egg's pip towards longitude 0 when its hole opens", () => {
    const e = eggs(OPTS, 1)[0]!;
    const opened = e.taps[e.holeTap]!;
    const facing = e.pip.lon + e.yaw0 + e.spin * opened;
    expect(Math.abs(Math.atan2(Math.sin(facing), Math.cos(facing)))).toBeLessThan(1e-9);
  });

  it("taps inside the pip stage and pecks inside the zip stage, in order", () => {
    for (const e of eggs(OPTS, 6)) {
      const pip = e.stages.find((s) => s.id === "pip")!;
      const zip = e.stages.find((s) => s.id === "zip")!;
      expect(e.taps.length).toBeGreaterThanOrEqual(8);
      expect(e.holeTap).toBeLessThan(e.taps.length);
      for (const t of e.taps) expect(t).toBeGreaterThanOrEqual(pip.start);
      for (const t of e.taps) expect(t).toBeLessThan(pip.end);
      for (const t of e.pecks) expect(t).toBeGreaterThanOrEqual(zip.start);
      for (const t of e.pecks) expect(t).toBeLessThan(zip.end);
      for (let i = 1; i < e.pecks.length; i++)
        expect(e.pecks[i]).toBeGreaterThanOrEqual(e.pecks[i - 1]!);
      expect(e.zipSpan).toBeGreaterThan(0.6 * 2 * Math.PI);
      expect(e.zipSpan).toBeLessThan(0.85 * 2 * Math.PI);
    }
  });

  it("plans the chick's glances, blinks and cheeps within its time", () => {
    for (const e of eggs(OPTS, 4)) {
      const dry = e.stages.find((s) => s.id === "dry")!;
      const chick = e.stages.find((s) => s.id === "chick")!;
      const c = e.chick;
      expect(c.glances[0]!.at).toBeCloseTo(dry.start, 9);
      for (let i = 1; i < c.glances.length; i++)
        expect(c.glances[i]!.at).toBeGreaterThan(c.glances[i - 1]!.at);
      for (const b of c.blinks) expect(b).toBeLessThan(chick.end);
      expect(c.cheeps.length).toBeGreaterThan(2);
      expect(c.doze).not.toBeNull();
      expect(c.doze!.at + c.doze!.length).toBeLessThan(chick.end);
    }
  });

  it("plans eggs on demand with the next one ready ahead", () => {
    const show = createShow(createRng("n"), OPTS);
    const first = show.egg(0);
    const next = show.next();
    expect(next.index).toBe(1);
    expect(next.start).toBeCloseTo(first.start + first.duration, 9);
    expect(show.egg(next.start + 1)).toBe(next);
    expect(planEgg(createRng("x"), OPTS, 3, 100, first).start).toBe(100);
  });
});
