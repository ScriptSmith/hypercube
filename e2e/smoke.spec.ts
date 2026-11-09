import { expect, test } from "@playwright/test";
import { discoverApps, loadVenueSizes } from "../scripts/lib/apps.mjs";
import {
  caseName,
  playCases,
  playPath,
  readState,
  shootStage,
  viewportFor,
  waitForRunning,
  watchPage,
} from "../scripts/lib/play.mjs";
import { BLANK_STDDEV, decodePng, pixelStats } from "../scripts/lib/png.mjs";

/** Apps that can't run headless, with the reason. Hidden tool apps only. */
const SKIP: Record<string, string> = {};
const RUN_MS = 3000;
/**
 * Cases that hand the frame straight to another app (a picker on a sphere is never seen), with
 * the params that choose it and the app that should then be running.
 */
const HANDOFF: Record<string, { params: Record<string, string>; app: string }> = {
  "menu sphere": { params: { "o.apps": "beachball" }, app: "beachball" },
};

const apps = await discoverApps();
const venue = await loadVenueSizes();

for (const c of playCases(apps)) {
  test(`plays ${caseName(c)}`, async ({ page }) => {
    test.skip(c.app in SKIP, SKIP[c.app]);
    const problems = watchPage(page);
    const size = venue[c.kind];
    await page.setViewportSize(viewportFor(size));
    const handoff = HANDOFF[caseName(c)];
    await page.goto(playPath({ ...c, size, params: handoff?.params }));

    const started = await waitForRunning(page);
    expect(started.phase, `phase after load; errors: ${started.errors.join("; ")}`).toBe("running");
    if (!handoff) expect(started.app, "mounted app").toBe(c.app);
    if (c.variant) expect(started.variant, "mounted variant").toBe(c.variant);
    expect(started.kind, "frame kind").toBe(c.kind);

    await page.waitForTimeout(RUN_MS);
    const state = await readState(page);
    const shot = await shootStage(page);
    await test.info().attach("stage.png", { body: shot, contentType: "image/png" });
    const { stddev } = pixelStats(decodePng(shot));

    expect.soft(problems, "page and console errors").toEqual([]);
    expect.soft(state.errors, "__hypercube.errors").toEqual([]);
    expect.soft(state.phase, "phase after running").toBe("running");
    expect.soft(state.app, "app after running").toBe(handoff?.app ?? c.app);
    expect
      .soft(stddev, "stage luminance spread (0 is a blank stage)")
      .toBeGreaterThan(BLANK_STDDEV);
  });
}
