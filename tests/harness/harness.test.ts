import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { ROOT } from "../../scripts/lib/apps.mjs";
import { appKinds, caseName, playCases, playPath, viewportFor } from "../../scripts/lib/play.mjs";
import { assessSoak, type SoakSample } from "../../scripts/lib/soak.mjs";
import type { AppManifest } from "../../src/core/types";

const MB = 1024 * 1024;

const app = (over: Partial<AppManifest>): AppManifest => ({
  id: "demo",
  title: "Demo",
  category: "game",
  blurb: "",
  setups: [],
  network: "none",
  ...over,
});

describe("playCases", () => {
  it("covers every declared kind once per variant", () => {
    const demo = app({
      setups: [
        { setup: "solo", kinds: ["wall", "panel"] },
        { setup: "bank", kinds: ["panel", "screen"] },
      ],
      variants: [
        { id: "a", title: "A" },
        { id: "b", title: "B" },
      ],
    });
    expect(appKinds(demo)).toEqual(["panel", "wall", "screen"]);
    const cases = playCases([demo]);
    expect(cases).toHaveLength(6);
    expect(cases.map(caseName)).toContain("demo screen b");
  });

  it("uses a null variant for apps without variants", () => {
    const cases = playCases([app({ setups: [{ setup: "solo", kinds: ["kiosk"] }] })]);
    expect(cases).toEqual([{ app: "demo", kind: "kiosk", variant: null }]);
  });
});

describe("play URLs", () => {
  it("keeps the venue aspect inside the bounds", () => {
    expect(viewportFor({ width: 1080, height: 1920 })).toEqual({ width: 540, height: 960 });
    expect(viewportFor({ width: 5760, height: 2160 })).toEqual({ width: 1280, height: 480 });
  });

  it("letterboxes to the venue size with bots and a seed", () => {
    const path = playPath({
      app: "demo",
      kind: "wall",
      variant: "b",
      size: { width: 5760, height: 2160 },
    });
    const q = new URL(path, "http://x/").searchParams;
    expect(path.startsWith("play/?")).toBe(true);
    expect(Object.fromEntries(q)).toEqual({
      app: "demo",
      kind: "wall",
      variant: "b",
      fit: "5760x2160",
      bots: "2",
      seed: "test",
    });
  });
});

const series = (minutes: number, heapAt: (t: number) => number, domAt = (_t: number) => 100) =>
  Array.from({ length: minutes * 2 + 1 }, (_, i): SoakSample => {
    const t = i * 30_000;
    return { t, heap: heapAt(t), dom: domAt(t) };
  });

describe("assessSoak", () => {
  const hour = 60 * 60_000;

  it("passes a flat run and ignores growth during warm-up", () => {
    const v = assessSoak(
      series(60, (t) => (t < 4 * 60_000 ? 5 * MB + t * 10 : 8 * MB)),
      hour,
    );
    expect(v.ok).toBe(true);
    expect(v.heap?.growth).toBe(0);
  });

  it("fails a steady heap leak", () => {
    const v = assessSoak(
      series(60, (t) => 10 * MB + (t / hour) * 4 * MB),
      hour,
    );
    expect(v.ok).toBe(false);
    expect(v.reasons[0]).toMatch(/heap grew/);
    expect(v.heap?.perHour).toBeCloseTo(4 * MB, -3);
  });

  it("scales the heap limit with a large heap", () => {
    const v = assessSoak(
      series(60, (t) => 100 * MB + (t / hour) * 8 * MB),
      hour,
    );
    expect(v.heap?.limit).toBeGreaterThan(10 * MB);
    expect(v.ok).toBe(true);
  });

  it("fails DOM growth", () => {
    const v = assessSoak(
      series(
        60,
        () => 5 * MB,
        (t) => 100 + Math.floor(t / 10_000),
      ),
      hour,
    );
    expect(v.reasons.some((r) => r.startsWith("DOM grew"))).toBe(true);
  });

  it("needs samples after warm-up", () => {
    expect(assessSoak([{ t: 0, heap: MB, dom: 10 }], hour).ok).toBe(false);
  });
});

describe("discoverApps", () => {
  // Node's own type stripping and the Vite fallback must find the same apps.
  const list = (loader: string) =>
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        'const { discoverApps } = await import("./scripts/lib/apps.mjs");' +
          "console.log(JSON.stringify((await discoverApps()).map((a) => a.id)));",
      ],
      { cwd: ROOT, env: { ...process.env, HC_LOADER: loader }, encoding: "utf8" },
    );

  it("loads every manifest with either loader", () => {
    const native = JSON.parse(list("node")) as string[];
    expect(native).toContain("idle");
    expect(JSON.parse(list("vite"))).toEqual(native);
  }, 30_000);
});
