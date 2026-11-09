import { expect, type Page, test } from "@playwright/test";
import { playPath, viewportFor, waitForRunning, watchPage } from "../scripts/lib/play.mjs";
import { BLANK_STDDEV, decodePng, pixelStats } from "../scripts/lib/png.mjs";

const FEED = { width: 4096, height: 2048 };

interface Counts {
  breaths: number;
  ripples: number;
  sniffs: number;
  claws: number;
  stretches: number;
  lids: number;
  stirs: number;
}

interface EchidnaState {
  drawn: number;
  counts: Counts;
  bristle: number;
  built: { spines: number; mean: number; max: number } | null;
}

declare global {
  interface Window {
    __echidna?: {
      state(): EchidnaState;
      advance(seconds: number): void;
      trigger(kind: string): boolean;
    };
  }
}

const open = async (page: Page, params: Record<string, string> = {}) => {
  const problems = watchPage(page);
  await page.setViewportSize(viewportFor(FEED));
  await page.goto(
    playPath({
      app: "echidna",
      kind: "sphere",
      size: FEED,
      bots: 0,
      params: { debug: "1", ...params },
    }),
  );
  const state = await waitForRunning(page);
  expect(state.phase, state.errors.join("; ")).toBe("running");
  // The spines are built in a worker and the shader compiles in the background.
  await page.waitForFunction(() => (window.__echidna?.state().drawn ?? 0) > 1, undefined, {
    timeout: 60_000,
  });
  return problems;
};

const state = (page: Page) => page.evaluate(() => window.__echidna!.state());

const stageSpread = async (page: Page) =>
  pixelStats(decodePng(await page.locator(".hc-stage").screenshot())).stddev;

test.describe("echidna", () => {
  test("builds its spines and draws the curled body on the flat feed", async ({ page }) => {
    const problems = await open(page);
    const s = await state(page);
    expect(s.built?.spines).toBeGreaterThan(2000);
    expect(s.built?.max).toBeLessThanOrEqual(16);
    expect(await stageSpread(page)).toBeGreaterThan(BLANK_STDDEV);
    expect(problems).toEqual([]);
  });

  test("shows the ball in the globe preview", async ({ page }) => {
    const problems = await open(page, { look: "globe" });
    await expect(page.locator(".hc-globe")).toBeVisible();
    await page.waitForTimeout(1500);
    const size = page.viewportSize() ?? { width: 1280, height: 640 };
    const ball = { x: size.width / 2 - 60, y: size.height / 2 - 140, width: 120, height: 120 };
    const shot = await page.screenshot({ clip: ball });
    expect(pixelStats(decodePng(shot)).stddev).toBeGreaterThan(BLANK_STDDEV);
    await page.click("button[data-globe=under]");
    await page.waitForTimeout(800);
    expect(problems).toEqual([]);
  });

  test("breathes, twitches, snuffles, stretches and stirs as time goes on", async ({ page }) => {
    const problems = await open(page);
    const before = (await state(page)).counts;
    await page.evaluate(() => window.__echidna!.advance(600));
    const after = (await state(page)).counts;
    expect(after.breaths - before.breaths).toBeGreaterThan(50);
    expect(after.ripples - before.ripples).toBeGreaterThan(15);
    expect(after.sniffs - before.sniffs).toBeGreaterThan(10);
    expect(after.stretches - before.stretches).toBeGreaterThan(2);
    expect(after.stirs - before.stirs).toBeGreaterThanOrEqual(1);
    // A stir asked for bristles the spines (once a minute has passed since the last one), and
    // the page keeps drawing through it.
    const started = await page.evaluate(() => {
      for (let i = 0; i < 20; i++) {
        if (window.__echidna!.trigger("stir")) return true;
        window.__echidna!.advance(20);
      }
      return false;
    });
    expect(started).toBe(true);
    await page.evaluate(() => window.__echidna!.advance(1.5));
    expect((await state(page)).bristle).toBeGreaterThan(0.5);
    const drawn = (await state(page)).drawn;
    await page.waitForFunction((n) => window.__echidna!.state().drawn > n + 2, drawn);
    expect(await stageSpread(page)).toBeGreaterThan(BLANK_STDDEV);
    const status = await page.evaluate(() => window.__hypercube?.appStatus() ?? {});
    expect(status.pace).toBe("sleepy");
    expect(Number(status.stirs)).toBeGreaterThanOrEqual(2);
    expect(problems).toEqual([]);
  });

  test("only breathes and turns with twitches and stirs turned off", async ({ page }) => {
    const problems = await open(page, { "o.stirs": "false", "o.pace": "restless" });
    await page.evaluate(() => window.__echidna!.advance(600));
    const c = (await state(page)).counts;
    expect(c.breaths).toBeGreaterThan(80);
    expect(c.ripples + c.sniffs + c.claws + c.stretches + c.lids + c.stirs).toBe(0);
    const status = await page.evaluate(() => window.__hypercube?.appStatus() ?? {});
    expect(status.pace).toBe("restless");
    expect(problems).toEqual([]);
  });
});
