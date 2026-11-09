import { expect, type Page, test } from "@playwright/test";
import {
  playPath,
  shootStage,
  viewportFor,
  waitForRunning,
  watchPage,
} from "../scripts/lib/play.mjs";
import { BLANK_STDDEV, decodePng, pixelStats } from "../scripts/lib/png.mjs";

const FEED = { width: 4096, height: 2048 };

interface DripState {
  id: number;
  lon: number;
  tip: number;
  v: number;
  phase: string;
  bead: number;
  drops: number;
  neck: number;
}

interface CakeState {
  cake: string;
  mode: string;
  moving: boolean;
  ready: boolean;
  drawn: number;
  fieldUpdates: number;
  resets: number;
  time: number;
  yaw: number;
  pours: number;
  nextPour: number;
  released: number;
  falls: number;
  bottom: number;
  edge: [number, number];
  drops: number;
  drips: DripState[];
}

declare global {
  interface Window {
    __cake?: { state(): CakeState; skip(seconds: number): void; pour(): boolean };
  }
}

const open = async (page: Page, params: Record<string, string> = {}) => {
  const problems = watchPage(page);
  await page.setViewportSize(viewportFor(FEED));
  await page.goto(
    playPath({
      app: "cake",
      kind: "sphere",
      size: FEED,
      bots: 0,
      params: { debug: "1", ...params },
    }),
  );
  const started = await waitForRunning(page);
  expect(started.phase, started.errors.join("; ")).toBe("running");
  // The skin is baked a strip at a time and the shaders compile in the background.
  await page.waitForFunction(() => (window.__cake?.state().drawn ?? 0) > 1, undefined, {
    timeout: 60_000,
  });
  return problems;
};

const state = (page: Page) => page.evaluate(() => window.__cake!.state());
const skip = (page: Page, seconds: number) => page.evaluate((s) => window.__cake!.skip(s), seconds);

type Png = ReturnType<typeof decodePng>;

/** Mean absolute difference, per channel, between two columns of a picture. */
const columnDiff = (img: Png, a: number, b: number) => {
  let sum = 0;
  for (let y = 0; y < img.height; y++) {
    for (let c = 0; c < 3; c++) {
      sum += Math.abs(
        img.data[(y * img.width + a) * 4 + c]! - img.data[(y * img.width + b) * 4 + c]!,
      );
    }
  }
  return sum / (img.height * 3);
};

/** Luminance spread along one row. */
const rowSpread = (img: Png, y: number) => {
  const row = img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4);
  return pixelStats({ width: img.width, height: 1, data: row }).stddev;
};

test.describe("cake", () => {
  test("opens on a smooth, still cap that only turns", async ({ page }) => {
    const problems = await open(page);
    const first = await state(page);
    expect(first.mode).toBe("none");
    expect(first.moving).toBe(false);
    expect(first.drips.length).toBe(0);
    expect(await page.evaluate(() => window.__cake!.pour())).toBe(false);
    await page.waitForTimeout(1000);
    const later = await state(page);
    // A still glaze is drawn once; only the turn goes on.
    expect(later.fieldUpdates).toBeLessThanOrEqual(2);
    expect(later.drawn).toBeGreaterThan(first.drawn);
    await skip(page, 3600);
    const hour = await state(page);
    expect(hour.pours).toBe(0);
    expect(hour.drips.length).toBe(0);
    expect(hour.drops).toBe(0);
    expect(hour.edge).toEqual(first.edge);
    expect(hour.yaw).not.toBe(first.yaw);
    const shot = decodePng(await shootStage(page));
    expect(pixelStats(shot).stddev).toBeGreaterThan(BLANK_STDDEV);
    const status = await page.evaluate(() => window.__hypercube?.appStatus() ?? {});
    expect(status.mode).toBe("none");
    expect(status.cake).toBe("pudding");
    expect(problems).toEqual([]);
  });

  test("keeps set drips just as they are for hours", async ({ page }) => {
    const problems = await open(page, { "o.drips": "set" });
    const first = await state(page);
    expect(first.drips.length).toBeGreaterThanOrEqual(18);
    expect(first.drips.every((d) => d.phase === "set" && d.tip > 0)).toBe(true);
    for (let i = 0; i < 3; i++) await skip(page, 3600);
    const later = await state(page);
    expect(later.drips.map((d) => d.tip)).toEqual(first.drips.map((d) => d.tip));
    expect(later.pours).toBe(0);
    const shot = decodePng(await shootStage(page));
    expect(pixelStats(shot).stddev).toBeGreaterThan(BLANK_STDDEV);
    expect(problems).toEqual([]);
  });

  test("lets drips run and stop with nothing letting go", async ({ page }) => {
    const problems = await open(page, { "o.drips": "runs" });
    const start = await state(page);
    expect(start.drips.some((d) => d.phase === "run")).toBe(true);
    let lowest = 1;
    for (let i = 0; i < 6; i++) {
      await skip(page, 600);
      const s = await state(page);
      for (const d of s.drips) lowest = Math.min(lowest, d.tip);
      expect(s.drops).toBe(0);
    }
    const end = await state(page);
    expect(end.released).toBe(0);
    expect(end.falls).toBe(0);
    expect(end.pours - start.pours).toBeGreaterThan(5);
    expect(lowest).toBeGreaterThan((-8 * Math.PI) / 180);
    expect(problems).toEqual([]);
  });

  test("with drops, opens with drips under way and pours more on demand", async ({ page }) => {
    const problems = await open(page, { "o.drips": "drops" });
    const shot = decodePng(await shootStage(page));
    expect(pixelStats(shot).stddev).toBeGreaterThan(BLANK_STDDEV);

    const first = await state(page);
    expect(first.ready).toBe(true);
    expect(first.drips.length).toBeGreaterThan(10);
    expect(first.drips.some((d) => d.phase === "run" && d.v > 0)).toBe(true);
    await page.waitForTimeout(1000);
    const later = await state(page);
    expect(later.time).toBeGreaterThan(first.time);
    expect(later.fieldUpdates).toBeGreaterThan(first.fieldUpdates);

    // A pour sends a wave down the cap, and new drips break out of its edge.
    await skip(page, 60);
    const before = await state(page);
    expect(await page.evaluate(() => window.__cake!.pour())).toBe(true);
    await skip(page, 75);
    const after = await state(page);
    expect(after.pours).toBe(before.pours + 1);
    const ids = new Set(before.drips.map((d) => d.id));
    expect(after.drips.filter((d) => !ids.has(d.id)).length).toBeGreaterThan(3);
    expect(problems).toEqual([]);
  });

  test("with drops, lets them go, keeps its pools bounded and keeps going for hours", async ({
    page,
  }) => {
    const problems = await open(page, { "o.drips": "drops" });
    const start = await state(page);
    for (let i = 0; i < 12; i++) {
      await skip(page, 600);
      const s = await state(page);
      expect(s.drips.length).toBeLessThanOrEqual(64);
      expect(s.drops).toBeLessThanOrEqual(6);
      expect(s.edge[0]).toBeGreaterThanOrEqual((10 * Math.PI) / 180 - 1e-6);
      expect(s.edge[1]).toBeLessThanOrEqual((30 * Math.PI) / 180 + 1e-6);
    }
    const end = await state(page);
    expect(end.pours - start.pours).toBeGreaterThan(15);
    expect(end.falls - start.falls).toBeGreaterThan(5);
    expect(end.released - start.released).toBeGreaterThan(end.falls - start.falls + 5);
    const drawn = end.drawn;
    await page.waitForFunction((n) => window.__cake!.state().drawn > n + 2, drawn);
    const shot = decodePng(await shootStage(page));
    expect(pixelStats(shot).stddev).toBeGreaterThan(BLANK_STDDEV);
    const status = await page.evaluate(() => window.__hypercube?.appStatus() ?? {});
    expect(status.glaze).toBe("icing");
    expect(Number(status.drips)).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  test("joins round the back and closes at the poles", async ({ page }) => {
    const cases: Record<string, string>[] = [
      { "o.turn": "false" },
      { "o.turn": "false", variant: "galaxy", "o.drips": "set" },
      { "o.turn": "false", variant: "rocky", "o.drips": "set" },
    ];
    for (const params of cases) {
      await open(page, params);
      const img = decodePng(await shootStage(page));
      const w = img.width;
      // Across the seam at the back is no more different than any two neighbouring columns.
      const neighbours = Math.max(columnDiff(img, 0, 1), columnDiff(img, w - 2, w - 1), 1);
      expect(columnDiff(img, w - 1, 0)).toBeLessThan(4 * neighbours + 3);
      // The top and bottom rows each sit round a single point.
      expect(rowSpread(img, 0)).toBeLessThan(12);
      expect(rowSpread(img, img.height - 1)).toBeLessThan(12);
    }
  });

  test("hangs as a ball in the globe preview, from beside and below", async ({ page }) => {
    const problems = await open(page, { look: "globe" });
    await expect(page.locator(".hc-globe")).toBeVisible();
    await page.waitForTimeout(2000);
    const size = page.viewportSize() ?? { width: 1280, height: 640 };
    const clip = { x: size.width / 2 - 60, y: size.height / 2 - 140, width: 120, height: 120 };
    const box = decodePng(await page.screenshot({ clip }));
    expect(pixelStats(box).stddev).toBeGreaterThan(BLANK_STDDEV);
    expect(pixelStats(box).mean).toBeGreaterThan(15);
    await page.click("button[data-globe=under]");
    await page.waitForTimeout(1500);
    const centre = { x: size.width / 2 - 100, y: size.height / 2 - 100, width: 200, height: 200 };
    expect(pixelStats(decodePng(await page.screenshot({ clip: centre }))).stddev).toBeGreaterThan(
      BLANK_STDDEV,
    );
    expect(problems).toEqual([]);
  });

  test("bakes every cake, and runs custard, lively and still", async ({ page }) => {
    test.setTimeout(150_000);
    for (const cake of ["chocolate", "strawberry", "galaxy", "rocky"]) {
      const problems = await open(page, { variant: cake, "o.drips": "set" });
      const status = await page.evaluate(() => window.__hypercube?.appStatus() ?? {});
      expect(status.cake).toBe(cake);
      const shot = decodePng(await shootStage(page));
      expect(pixelStats(shot).stddev).toBeGreaterThan(BLANK_STDDEV);
      expect(problems).toEqual([]);
    }
    const problems = await open(page, {
      "o.glaze": "custard",
      "o.drips": "drops",
      "o.pace": "lively",
      "o.turn": "false",
    });
    const status = await page.evaluate(() => window.__hypercube?.appStatus() ?? {});
    expect(status.glaze).toBe("custard");
    expect(status.pace).toBe("lively");
    expect(status.turn).toBe(false);
    const before = await state(page);
    await skip(page, 400);
    const after = await state(page);
    expect(after.yaw).toBe(0);
    expect(after.pours - before.pours).toBeGreaterThanOrEqual(3);
    expect(problems).toEqual([]);
  });

  test("shows the pudding's fruit and the rocky road's pieces where people see them", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    // The band people see well from beside and below: the lower 55 % of the feed.
    const band = (img: Png) => {
      const from = Math.floor(img.height * 0.45);
      let r = 0;
      let g = 0;
      let pink = 0;
      let pale = 0;
      let red = 0;
      const n = (img.height - from) * img.width;
      for (let y = from; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const i = (y * img.width + x) * 4;
          const [R, G, B] = [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!];
          r += R;
          g += G;
          if (R > 140 && B > 90 && R - G > 45 && B > G) pink++;
          if (R > 150 && G > 145 && B > 135) pale++;
          if (R > 110 && G < 45 && B < 50) red++;
        }
      }
      return { warm: r / Math.max(1, g), pink: pink / n, pale: pale / n, red: red / n };
    };
    let problems = await open(page, { "o.turn": "false" });
    const pudding = band(decodePng(await shootStage(page)));
    // A reddish crumb with glints of cherry, not grey-brown earth.
    expect(pudding.warm).toBeGreaterThan(1.75);
    expect(pudding.red).toBeGreaterThan(0.002);
    expect(problems).toEqual([]);

    problems = await open(page, { variant: "rocky", "o.turn": "false" });
    const status = await page.evaluate(() => window.__hypercube?.appStatus() ?? {});
    expect(status.cake).toBe("rocky");
    expect(status.glaze).toBe("chocolate");
    expect(status.mode).toBe("none");
    const rocky = band(decodePng(await shootStage(page)));
    // Pink and white marshmallows all round the sides and underneath.
    expect(rocky.pink).toBeGreaterThan(0.01);
    expect(rocky.pale).toBeGreaterThan(0.01);
    // Still lots of chocolate between them.
    expect(rocky.pink + rocky.pale).toBeLessThan(0.5);
    expect(problems).toEqual([]);
  });

  test("keeps the show running through the idle reset", async ({ page }) => {
    const problems = await open(page, { idle: "5", "o.drips": "set" });
    const before = await state(page);
    await page.waitForFunction(() => (window.__cake?.state().resets ?? 0) > 0, undefined, {
      timeout: 20_000,
    });
    const after = await state(page);
    expect(after.time).toBeGreaterThan(before.time);
    expect(after.drips.map((d) => d.tip)).toEqual(before.drips.map((d) => d.tip));
    expect(problems).toEqual([]);
  });
});
