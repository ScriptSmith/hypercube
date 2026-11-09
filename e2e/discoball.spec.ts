import { expect, type Page, test } from "@playwright/test";
import { playPath, viewportFor, waitForRunning, watchPage } from "../scripts/lib/play.mjs";
import { BLANK_STDDEV, decodePng, pixelStats } from "../scripts/lib/png.mjs";

const FEED = { width: 4096, height: 2048 };

interface BallState {
  t: number;
  ready: boolean;
  drawn: number;
  scene: string;
  next: string | null;
  index: number;
  lights: string;
  spin: string;
  turn: number;
  theta: number;
  spots: { color: number[]; power: number }[];
  lit: number;
}

interface FlashReport {
  frames: number;
  areas: number;
  worst: number;
  whole: number;
  meanLit: number;
}

declare global {
  interface Window {
    __discoball?: {
      state(): BallState;
      skip(seconds: number): void;
      measure(opts: { seconds: number; hz: number; width: number }): FlashReport;
    };
  }
}

const open = async (page: Page, params: Record<string, string | number> = {}) => {
  const problems = watchPage(page);
  await page.setViewportSize(viewportFor(FEED));
  await page.goto(
    playPath({
      app: "discoball",
      kind: "sphere",
      size: FEED,
      bots: 0,
      params: { debug: 1, res: 0.5, ...params },
    }),
  );
  const started = await waitForRunning(page);
  expect(started.phase, started.errors.join("; ")).toBe("running");
  await page.waitForFunction(() => (window.__discoball?.state().drawn ?? 0) > 20, undefined, {
    timeout: 30_000,
  });
  return problems;
};

const state = (page: Page) => page.evaluate(() => window.__discoball!.state());

const spread = async (page: Page, clip: { x: number; y: number; width: number; height: number }) =>
  pixelStats(decodePng(await page.screenshot({ clip }))).stddev;

test.describe("discoball", () => {
  test("turns and sparkles on the flat feed", async ({ page }) => {
    const problems = await open(page);
    const a = await state(page);
    expect(a.ready).toBe(true);
    expect(a.lights).toBe("party");
    expect(a.spin).toBe("slow");
    expect(a.lit).toBeGreaterThan(0);
    const shot = await page.locator(".hc-stage").screenshot();
    expect(pixelStats(decodePng(shot)).stddev).toBeGreaterThan(BLANK_STDDEV);

    await page.waitForTimeout(1000);
    const b = await state(page);
    expect(b.t).toBeGreaterThan(a.t);
    expect(b.theta).not.toBe(a.theta);
    const status = await page.evaluate(() => window.__hypercube?.appStatus() ?? {});
    expect(status.scene).toBe(b.scene);
    expect(problems).toEqual([]);
  });

  test("looks like a ball in the globe preview, from beside, below and far", async ({ page }) => {
    const problems = await open(page, { look: "globe" });
    await expect(page.locator(".hc-globe")).toBeVisible();
    await page.waitForTimeout(1500);
    const size = page.viewportSize() ?? { width: 1280, height: 640 };
    const ball = { x: size.width / 2 - 60, y: size.height / 2 - 140, width: 120, height: 120 };
    expect(await spread(page, ball)).toBeGreaterThan(BLANK_STDDEV);
    for (const view of ["under", "far"]) {
      await page.click(`button[data-globe=${view}]`);
      await page.waitForTimeout(500);
      const shot = await page.screenshot();
      expect(pixelStats(decodePng(shot)).stddev).toBeGreaterThan(BLANK_STDDEV);
    }
    expect(problems).toEqual([]);
  });

  test("the show moves on through its scenes without stopping", async ({ page }) => {
    const problems = await open(page);
    const seen = new Set<string>();
    let last = (await state(page)).index;
    for (let i = 0; i < 12; i++) {
      await page.evaluate(() => window.__discoball!.skip(45));
      await page.waitForTimeout(150);
      const s = await state(page);
      seen.add(s.scene);
      expect(s.index).toBeGreaterThanOrEqual(last);
      last = s.index;
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
    expect(last).toBeGreaterThanOrEqual(5);
    expect((await state(page)).drawn).toBeGreaterThan(20);
    expect(problems).toEqual([]);
  });

  test("silver and white lights stay white, and medium spin turns faster", async ({ page }) => {
    const problems = await open(page, { "o.lights": "white", "o.spin": "medium" });
    for (let i = 0; i < 8; i++) {
      const s = await state(page);
      expect(s.lights).toBe("white");
      expect(s.turn).toBeLessThan(30);
      for (const spot of s.spots) expect(Math.min(...spot.color)).toBeGreaterThan(0.6);
      await page.evaluate(() => window.__discoball!.skip(50));
      await page.waitForTimeout(100);
    }
    expect(problems).toEqual([]);
  });

  test("going idle keeps the show running without a jump", async ({ page }) => {
    const problems = await open(page, { idle: 5 });
    const before = await state(page);
    await page.waitForTimeout(6500);
    const after = await state(page);
    expect(after.index).toBe(before.index);
    expect(after.t - before.t).toBeGreaterThan(5);
    expect(after.drawn).toBeGreaterThan(before.drawn);
    expect(problems).toEqual([]);
  });

  test("the picture itself stays within the flashing limits", async ({ page }) => {
    const problems = await open(page);
    // Twenty seconds of the show drawn at a quarter of a row of tiles per pixel, measured in
    // places about four tiles square, and over the whole ball.
    const report = await page.evaluate(() =>
      window.__discoball!.measure({ seconds: 20, hz: 30, width: 512 }),
    );
    expect(report.frames).toBe(600);
    expect(report.areas).toBeGreaterThan(100);
    expect(report.meanLit).toBeGreaterThan(5);
    expect(report.worst).toBeLessThanOrEqual(3);
    expect(report.whole).toBe(0);
    expect(problems).toEqual([]);
  });
});
