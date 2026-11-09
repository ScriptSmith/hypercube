import { expect, type Page, test } from "@playwright/test";
import { playPath, viewportFor, waitForRunning, watchPage } from "../scripts/lib/play.mjs";
import { BLANK_STDDEV, decodePng, pixelStats } from "../scripts/lib/png.mjs";

const FEED = { width: 4096, height: 2048 };

interface HatchState {
  egg: number;
  stage: string;
  at: number;
  kind: string;
  variant: string;
  day: number;
  crack: number;
  dry: number;
  holds: number;
  ready: boolean;
  stages: { id: string; start: number; end: number }[];
}

declare global {
  interface Window {
    __hatch?: {
      state(): HatchState;
      jump(stage: string, into?: number): void;
      nextEgg(): void;
    };
  }
}

const open = async (page: Page, params: Record<string, string> = {}) => {
  const problems = watchPage(page);
  await page.setViewportSize(viewportFor(FEED));
  await page.goto(
    playPath({
      app: "hatch",
      kind: "sphere",
      size: FEED,
      bots: 0,
      params: { res: "0.3", ...params },
    }),
  );
  const state = await waitForRunning(page);
  expect(state.phase, state.errors.join("; ")).toBe("running");
  await page.waitForFunction(() => window.__hatch?.state().ready === true, undefined, {
    timeout: 30_000,
  });
  return problems;
};

const hatch = (page: Page) => page.evaluate(() => window.__hatch!.state());
const jump = (page: Page, stage: string, into = 0) =>
  page.evaluate(([s, n]) => window.__hatch!.jump(s as string, n as number), [stage, into] as const);
const stage = async (page: Page) => (await page.locator(".hc-stage").screenshot()).valueOf();
const stats = async (page: Page) => pixelStats(decodePng(await stage(page)));

test.describe("hatch", () => {
  test("plays the egg through every stage to a chick and on to the next egg", async ({ page }) => {
    // Six full-stage screenshots on software WebGL take a while on a busy machine.
    test.setTimeout(150_000);
    const problems = await open(page);
    const first = await hatch(page);
    expect(first.variant).toBe("hatch");
    expect(first.stages.map((s) => s.id)).toEqual([
      "egg",
      "stir",
      "pip",
      "rest",
      "zip",
      "hatch",
      "dry",
      "chick",
      "fade",
    ]);
    // Each moment looks different from the last: cracks arrive, pieces fall, the chick dries.
    const seen: { stage: string; mean: number; stddev: number }[] = [];
    for (const [id, into] of [
      ["stir", 1],
      ["pip", 10],
      ["zip", 40],
      ["hatch", 6],
      ["dry", 2],
      ["chick", 10],
    ] as const) {
      await jump(page, id, into);
      await page.waitForTimeout(400);
      const s = await hatch(page);
      expect(s.stage).toBe(id);
      const p = await stats(page);
      expect(p.stddev, id).toBeGreaterThan(BLANK_STDDEV);
      seen.push({ stage: id, mean: p.mean, stddev: p.stddev });
    }
    expect(new Set(seen.map((s) => s.mean.toFixed(1))).size).toBe(seen.length);
    const zip = await (async () => {
      await jump(page, "zip", 40);
      return hatch(page);
    })();
    expect(zip.crack).toBeGreaterThan(0.14);
    await jump(page, "chick", 10);
    expect((await hatch(page)).dry).toBeCloseTo(1, 3);

    // The fade hands over to a new egg, with a shell of its own made in good time.
    await page.evaluate(() => window.__hatch!.nextEgg());
    await page.waitForTimeout(500);
    const next = await hatch(page);
    expect(next.egg).toBe(first.egg + 1);
    expect(next.holds).toBe(next.egg);
    expect(next.kind).not.toBe(first.kind);
    expect(problems).toEqual([]);
  });

  test("shows the ball in the globe preview", async ({ page }) => {
    const problems = await open(page, { look: "globe" });
    await expect(page.locator(".hc-globe")).toBeVisible();
    await jump(page, "zip", 30);
    await page.waitForTimeout(1500);
    const size = page.viewportSize() ?? { width: 1280, height: 640 };
    const ball = { x: size.width / 2 - 60, y: size.height / 2 - 140, width: 120, height: 120 };
    const shot = await page.screenshot({ clip: ball });
    expect(pixelStats(decodePng(shot)).stddev).toBeGreaterThan(BLANK_STDDEV);
    await page.click("button[data-globe=under]");
    await jump(page, "chick", 5);
    await page.waitForTimeout(800);
    expect(problems).toEqual([]);
  });

  test("candles the egg through 21 days, then hatches it", async ({ page }) => {
    test.setTimeout(120_000);
    const problems = await open(page, { variant: "candling" });
    const s0 = await hatch(page);
    expect(s0.variant).toBe("candling");
    expect(s0.stages[0]!.id).toBe("candle");
    expect(s0.day).toBeLessThan(2);
    const days: number[] = [];
    for (const into of [2, 30, 80, 130, 165]) {
      await jump(page, "candle", into);
      await page.waitForTimeout(300);
      const s = await hatch(page);
      expect(s.stage).toBe("candle");
      days.push(Math.floor(s.day));
      expect((await stats(page)).stddev).toBeGreaterThan(BLANK_STDDEV);
    }
    expect(days).toEqual([...days].sort((a, b) => a - b));
    expect(days[days.length - 1]).toBe(21);
    await jump(page, "pip", 20);
    await page.waitForTimeout(300);
    expect((await hatch(page)).stage).toBe("pip");
    expect(problems).toEqual([]);
  });

  test("follows its options: a shell group and the quick pace", async ({ page }) => {
    const problems = await open(page, { "o.shell": "blue", "o.pace": "quick" });
    const s = await hatch(page);
    expect(["blue", "olive"]).toContain(s.kind);
    await page.evaluate(() => window.__hatch!.nextEgg());
    await page.waitForTimeout(300);
    const next = await hatch(page);
    expect(["blue", "olive"]).toContain(next.kind);
    const length = next.stages[next.stages.length - 1]!.end;
    expect(length / 60).toBeGreaterThan(2.5);
    expect(length / 60).toBeLessThan(3.5);
    expect(problems).toEqual([]);
  });

  test("keeps the show running through the runtime's idle reset and attract", async ({ page }) => {
    // The runtime calls reset() and attract() once the frame has gone untouched for `idle` s.
    const problems = await open(page, { idle: "5" });
    await jump(page, "zip", 10);
    const before = await hatch(page);
    await page.waitForTimeout(6500);
    const after = await hatch(page);
    expect(after.egg).toBe(before.egg);
    expect(after.stage).toBe("zip");
    expect(after.at - before.at).toBeGreaterThan(5);
    expect(after.at - before.at).toBeLessThan(9);
    expect(problems).toEqual([]);
  });
});
