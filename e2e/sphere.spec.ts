import { expect, type Page, test } from "@playwright/test";
import { playPath, viewportFor, waitForRunning, watchPage } from "../scripts/lib/play.mjs";
import { BLANK_STDDEV, decodePng, pixelStats } from "../scripts/lib/png.mjs";

const FEED = { width: 4096, height: 2048 };

const open = async (page: Page, app: string, params: Record<string, string> = {}) => {
  const problems = watchPage(page);
  await page.setViewportSize(viewportFor(FEED));
  await page.goto(playPath({ app, kind: "sphere", size: FEED, bots: 0, params }));
  const state = await waitForRunning(page);
  expect(state.phase, state.errors.join("; ")).toBe("running");
  return problems;
};

/** Spread of luminance in a box of the page, so a blank area reads near 0. */
const spread = async (page: Page, clip: { x: number; y: number; width: number; height: number }) =>
  pixelStats(decodePng(await page.screenshot({ clip }))).stddev;

test.describe("sphere frames", () => {
  test("know their ball and the band people see", async ({ page }) => {
    const problems = await open(page, "diag", { sphere: "8,3", view: "30,-80" });
    const s = await page.evaluate(() => window.__hypercube?.frame?.sphere ?? null);
    expect(s).not.toBeNull();
    expect(s?.radius).toBe(4);
    expect(s?.centreY).toBe(7);
    expect(((s?.view.top ?? 0) * 180) / Math.PI).toBeCloseTo(30);
    expect(((s?.view.bottom ?? 0) * 180) / Math.PI).toBeCloseTo(-80);
    const touch = await page.evaluate(() => window.__hypercube?.frame?.touch);
    expect(touch).toBe(false);
    expect(problems).toEqual([]);
  });

  test("show the ball in a room with look=globe, and flip to the flat feed", async ({ page }) => {
    const problems = await open(page, "spheretest", { variant: "inside", look: "globe" });
    const globe = page.locator(".hc-globe");
    await expect(globe).toBeVisible();
    await page.waitForTimeout(2500);
    const size = page.viewportSize() ?? { width: 1280, height: 640 };
    // The ball hangs in the middle of the view; the copied WebGL feed makes it more than flat.
    const ball = { x: size.width / 2 - 60, y: size.height / 2 - 140, width: 120, height: 120 };
    expect(await spread(page, ball)).toBeGreaterThan(BLANK_STDDEV);

    await page.click("button[data-globe=under]");
    await expect(page.locator("button[data-globe=under]")).toHaveAttribute("aria-pressed", "true");
    await page.click("button[data-globe=flat]");
    await expect(globe).toBeHidden();
    await expect(page.locator(".hc-globe-back")).toBeVisible();
    await page.click(".hc-globe-back");
    await expect(globe).toBeVisible();
    expect(problems).toEqual([]);
  });

  test("draw the painted ball and the scene inside the glass", async ({ page }) => {
    for (const variant of ["ball", "inside"]) {
      await open(page, "spheretest", { variant });
      await page.waitForTimeout(1500);
      const status = await page.evaluate(() => window.__hypercube?.appStatus() ?? {});
      expect(status.mode).toBe(variant);
      const shot = await page.locator(".hc-stage").screenshot();
      expect(pixelStats(decodePng(shot)).stddev).toBeGreaterThan(BLANK_STDDEV);
    }
  });
});
