import { expect, type Page, test } from "@playwright/test";
import { watchPage } from "../scripts/lib/play.mjs";

/**
 * Network Graphs: the embedded viewer in kiosk mode. A touch on a node inside the iframe picks
 * it and fills the card, the attract walk picks nodes by itself and stops once someone touches,
 * and a screen (which cannot be touched) still walks. They frame the published viewer, so they
 * need the network.
 */

const selected = (page: Page) =>
  page.evaluate(
    () => (window.__hypercube?.appStatus() as { selected?: string } | undefined)?.selected ?? null,
  );

/**
 * Where a node is on the page. The viewer is a cross-origin frame scaled with a CSS transform,
 * and Playwright's own boxes and clicks inside such a frame leave the scale out.
 */
const nodeAt = async (page: Page, id: string) => {
  const frame = page.locator("iframe");
  const outer = (await frame.boundingBox())!;
  const k = outer.width / (await frame.evaluate((e) => e.clientWidth));
  const c = await frame
    .contentFrame()
    .locator(`circle[data-id="${id}"]`)
    .evaluate((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
  return { x: outer.x + c.x * k, y: outer.y + c.y * k };
};

const tap = async (page: Page, id: string) => {
  const { x, y } = await nodeAt(page, id);
  await page.mouse.click(x, y);
};

const open = async (page: Page, kind: string, size: string, extra = "") => {
  const problems = watchPage(page);
  await page.setViewportSize({
    width: Number(size.split("x")[0]),
    height: Number(size.split("x")[1]),
  });
  await page.goto(`play/?app=graphs&kind=${kind}&fit=${size}&seed=test${extra}`);
  const viewer = page.frameLocator("iframe");
  await expect(viewer.locator("circle[data-id]").first()).toBeVisible({ timeout: 20_000 });
  // The layout eases in for a moment after the graph loads; taps wait until it has.
  let last = "";
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await nodeAt(page, "seagrass"));
        const still = now === last;
        last = now;
        return still;
      },
      { intervals: [400] },
    )
    .toBe(true);
  return { viewer, problems };
};

test("a tap on a node picks it and shows its card", async ({ page }) => {
  const { problems } = await open(page, "kiosk", "1920x1080", "&o.tour=false");
  await tap(page, "seagrass");
  await expect.poll(() => selected(page)).toBe("seagrass");
  await expect(page.getByText("Seagrass meadows grow on sandy sea floors.")).toBeVisible();
  await expect(page.getByText("Eaten by: Dugong, Green turtle")).toBeVisible();
  expect(problems).toEqual([]);
});

test("the attract walk picks nodes alone, and a touch ends it", async ({ page }) => {
  await open(page, "kiosk", "1920x1080", "&o.tourSeconds=3");
  await expect.poll(() => selected(page), { timeout: 12_000 }).not.toBe("");
  await tap(page, "seagrass");
  await expect.poll(() => selected(page)).toBe("seagrass");
  await page.waitForTimeout(7000);
  expect(await selected(page)).toBe("seagrass");
});

test("a wall has the card in a side column and the viewer the full height", async ({ page }) => {
  await open(page, "wall", "5760x2160", "&o.tourSeconds=3");
  const box = (await page.locator("iframe").boundingBox())!;
  const stage = (await page.locator(".hc-stage").boundingBox())!;
  expect(box.y - stage.y).toBeLessThan(2);
  expect(box.height).toBeGreaterThan(stage.height * 0.99);
  expect(box.x - stage.x).toBeGreaterThan(stage.width * 0.15);
  const button = (await page.locator(".hc-button").first().boundingBox())!;
  // Both buttons are in the lower, reachable part.
  expect(button.y - stage.y).toBeGreaterThan(stage.height * 0.55);
});

test("a screen is not touchable and walks by itself", async ({ page }) => {
  await open(page, "screen", "4000x3600", "&o.tourSeconds=3");
  await expect.poll(() => selected(page), { timeout: 12_000 }).not.toBe("");
  const kiosk = await page.evaluate(() => document.querySelector("iframe")?.getAttribute("src"));
  expect(kiosk).toContain("kiosk=display");
});

test("a double tap leaves the graph whole unless the operator asks for it", async ({ page }) => {
  const { viewer } = await open(page, "kiosk", "1920x1080", "&o.tour=false");
  const count = () => viewer.locator("circle[data-id]").count();
  const total = await count();
  expect(total).toBeGreaterThan(10);
  const turtle = await nodeAt(page, "turtle");
  await page.mouse.dblclick(turtle.x, turtle.y);
  await page.waitForTimeout(800);
  expect(await count()).toBe(total);

  const second = await page.context().newPage();
  const narrowed = await open(second, "kiosk", "1920x1080", "&o.tour=false&o.doubleTap=true");
  const again = await nodeAt(second, "turtle");
  await second.mouse.dblclick(again.x, again.y);
  await expect.poll(() => narrowed.viewer.locator("circle[data-id]").count()).toBeLessThan(total);
});

test("holding the reset button clears the pick", async ({ page }) => {
  await open(page, "kiosk", "1920x1080", "&o.tour=false");
  await tap(page, "seagrass");
  await expect.poll(() => selected(page)).toBe("seagrass");
  const reset = page.locator(".hc-button").first();
  const box = (await reset.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1300);
  await page.mouse.up();
  await expect.poll(() => selected(page)).toBe("");
});

test("the panels step shows the viewer's controls and the layout button on the left", async ({
  page,
}) => {
  const { viewer } = await open(page, "kiosk", "1920x1080", "&o.level=panels&o.tour=false");
  await expect(viewer.getByRole("button", { name: "Fit" })).toBeVisible();
  await expect(page.getByText("Arrows point towards the eater")).toHaveCount(0);
  const buttons = page.locator(".hc-button");
  await expect(buttons).toHaveCount(2);
  const first = (await buttons.first().boundingBox())!;
  expect(first.x).toBeLessThan(200);
});

test("a viewer that is not there yet is asked for again until it answers", async ({ page }) => {
  test.setTimeout(90_000);
  const viewerSite = "https://adamsm.com/**";
  await page.route(viewerSite, (route) => route.abort());
  const problems = watchPage(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("play/?app=graphs&kind=kiosk&fit=1920x1920&seed=test&o.tour=false");
  await expect.poll(() => page.evaluate(() => window.__hypercube?.phase)).toBe("running");
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__hypercube?.appStatus().ready)).toBe(false);
  await page.unroute(viewerSite);
  await expect(page.frameLocator("iframe").locator("circle[data-id]").first()).toBeVisible({
    timeout: 40_000,
  });
  await expect.poll(() => page.evaluate(() => window.__hypercube?.appStatus().ready)).toBe(true);
  expect(problems.filter((p) => !/ERR_|Failed to load resource/.test(p))).toEqual([]);
});

test("going idle resets the pick and moves to the next graph when asked", async ({ page }) => {
  test.setTimeout(60_000);
  await open(page, "kiosk", "1920x1080", "&o.tour=false&o.rotate=true&idle=5");
  await tap(page, "seagrass");
  await expect.poll(() => selected(page)).toBe("seagrass");
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window.__hypercube?.appStatus() as { graph: string } | undefined)?.graph,
        ),
      { timeout: 25_000 },
    )
    .not.toBe("foodweb");
  expect(await selected(page)).toBe("");
});

test.describe("a real touch screen", () => {
  test.use({ hasTouch: true });

  test("a finger tap picks a node", async ({ page }) => {
    await open(page, "kiosk", "1920x1080", "&o.tour=false");
    // The layout eases in for a moment after the graph loads, so measure again on each try.
    await expect
      .poll(async () => {
        const { x, y } = await nodeAt(page, "turtle");
        await page.touchscreen.tap(x, y);
        return selected(page);
      })
      .toBe("turtle");
  });
});

test("the layout button hands the nodes to the viewer's algorithms and back", async ({ page }) => {
  const { viewer } = await open(page, "kiosk", "1920x1080", "&o.tour=false");
  const centres = () =>
    viewer.locator("circle[data-id]").evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return [r.x + r.width / 2, r.y + r.height / 2] as [number, number];
      }),
    );
  const spread = (pts: [number, number][]) => {
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const radii = pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy));
    const mean = radii.reduce((s, v) => s + v, 0) / radii.length;
    return Math.sqrt(radii.reduce((s, v) => s + (v - mean) ** 2, 0) / radii.length) / mean;
  };
  const original = await centres();
  const button = page.locator(".hc-button").nth(1);
  const layout = () =>
    page.evaluate(() => (window.__hypercube!.appStatus() as { layout?: string }).layout);
  for (const name of ["force", "spread", "circle"]) {
    await button.click();
    await page.waitForTimeout(3500);
    expect(await layout(), name).toBe(name);
  }
  const ring = await centres();
  expect(ring).toHaveLength(original.length);
  // On a circle every node is about the same distance from the middle.
  expect(spread(ring)).toBeLessThan(0.2);
  expect(spread(original)).toBeGreaterThan(0.2);
  for (let i = 0; i < 4; i++) await button.click();
  await expect.poll(layout).toBe("original");
  await page.waitForTimeout(3500);
  // Back in the original picture the food chain runs bottom to top again.
  const y = (id: string) =>
    viewer.locator(`circle[data-id="${id}"]`).evaluate((e) => e.getBoundingClientRect().y);
  expect((await y("seagrass")) - (await y("tigershark"))).toBeGreaterThan(150);
});
