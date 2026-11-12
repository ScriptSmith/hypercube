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

interface SaluteState {
  ready: boolean;
  frames: number;
  time: number;
  stage: string;
  kind: string;
  bearing: number;
  pitch: number;
  raise: number;
  brow: number;
  smile: number;
  blink: [number, number];
  glisten: number;
  stats: { stops: number; salutes: number; bows: number; sweeps: number; winks: number };
  longestWait: number;
  colour: string;
  held: boolean;
  resets: number;
  paused: boolean;
}

declare global {
  interface Window {
    __salute?: {
      state(): SaluteState;
      skip(seconds: number): SaluteState;
      seek(stage: string, kind?: string, into?: number, limit?: number): boolean;
      cue(kind: string, bearing?: number): void;
      hold(on: boolean): void;
      pause(on: boolean): void;
    };
  }
}

const open = async (page: Page, params: Record<string, string | number> = {}) => {
  const problems = watchPage(page);
  await page.setViewportSize(viewportFor(FEED));
  await page.goto(
    playPath({
      app: "salute",
      kind: "sphere",
      size: FEED,
      bots: 0,
      params: { debug: 1, res: 0.5, ...params },
    }),
  );
  const started = await waitForRunning(page);
  expect(started.phase, started.errors.join("; ")).toBe("running");
  await page.waitForFunction(() => (window.__salute?.state().frames ?? 0) > 2, undefined, {
    timeout: 30_000,
  });
  return problems;
};

const state = (page: Page) => page.evaluate(() => window.__salute!.state());

type Png = ReturnType<typeof decodePng>;

const shoot = async (page: Page): Promise<Png> => {
  // Two frames, so the picture is of the pose just set.
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  return decodePng(await shootStage(page));
};

/** Share of pixels that differ clearly between two pictures of the same size. */
const changed = (a: Png, b: Png) => {
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const d =
      Math.abs(a.data[i]! - b.data[i]!) +
      Math.abs(a.data[i + 1]! - b.data[i + 1]!) +
      Math.abs(a.data[i + 2]! - b.data[i + 2]!);
    if (d > 60) n++;
  }
  return n / (a.width * a.height);
};

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

/** Mean red, green and blue of a picture. */
const meanColour = (img: Png) => {
  const sum = [0, 0, 0];
  for (let i = 0; i < img.data.length; i += 4) {
    for (let c = 0; c < 3; c++) sum[c] = sum[c]! + img.data[i + c]!;
  }
  return sum.map((v) => v / (img.width * img.height));
};

test.describe("salute", () => {
  test("opens on a salute held towards bearing 0, well short of white", async ({ page }) => {
    const problems = await open(page);
    await page.waitForFunction(() => window.__salute!.state().stage === "hold", undefined, {
      timeout: 15_000,
    });
    const s = await state(page);
    expect(s.ready).toBe(true);
    expect(s.kind).toBe("floor");
    expect(s.raise).toBe(1);
    expect(s.bearing).toBe(0);
    expect(s.pitch).toBeLessThan(-5);
    const shot = await shoot(page);
    const stats = pixelStats(shot);
    expect(stats.stddev).toBeGreaterThan(BLANK_STDDEV);
    // A warm skin over the whole ball: clearly lit, and nowhere near a white screen.
    expect(stats.mean).toBeGreaterThan(90);
    expect(stats.mean).toBeLessThan(200);
    const [r, g, b] = meanColour(shot) as [number, number, number];
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b + 60);

    await page.waitForTimeout(800);
    expect((await state(page)).time).toBeGreaterThan(s.time);
    const status = await page.evaluate(() => window.__hypercube?.appStatus() ?? {});
    expect(status.stage).toBe("hold");
    expect(status.colour).toBe("yellow");
    expect(problems).toEqual([]);
  });

  test("raises a hand to its brow for the salute and takes it away after", async ({ page }) => {
    const problems = await open(page);
    await page.evaluate(() => {
      window.__salute!.pause(true);
      window.__salute!.seek("hold", "floor", 1);
    });
    const held = await state(page);
    expect(held.raise).toBe(1);
    expect(held.brow).toBeGreaterThan(0.9);
    expect(held.smile).toBeLessThan(0.1);
    const up = await shoot(page);
    await page.evaluate(() => window.__salute!.seek("relax", undefined, 0.9));
    const eased = await state(page);
    expect(eased.raise).toBe(0);
    expect(eased.smile).toBeGreaterThan(0.9);
    expect(eased.bearing).toBeCloseTo(held.bearing, 6);
    const down = await shoot(page);
    // The hand, the brows and the mouth changed; the rest of the ball did not.
    const share = changed(up, down);
    expect(share).toBeGreaterThan(0.002);
    expect(share).toBeLessThan(0.08);
    expect(problems).toEqual([]);
  });

  test("turns on from stop to stop, bowing and turning right round now and then", async ({
    page,
  }) => {
    const problems = await open(page);
    const stages = new Set<string>();
    const bearings = new Set<number>();
    for (const stage of ["turn", "settle", "raise", "hold", "lower", "relax"]) {
      expect(await page.evaluate((st) => window.__salute!.seek(st), stage)).toBe(true);
      stages.add((await state(page)).stage);
    }
    expect(stages.size).toBe(6);
    let last = 0;
    for (let i = 0; i < 10; i++) {
      const s = await page.evaluate(() => window.__salute!.skip(360));
      expect(s.stats.salutes).toBeGreaterThan(last + 25);
      last = s.stats.salutes;
      bearings.add(Math.round(s.bearing / 30));
      // Every side of the room has been saluted within about a minute.
      expect(s.longestWait).toBeLessThan(90);
    }
    const s = await state(page);
    expect(s.stats.bows).toBeGreaterThan(30);
    expect(s.stats.sweeps).toBeGreaterThan(10);
    expect(s.stats.winks).toBeGreaterThan(5);
    expect(bearings.size).toBeGreaterThanOrEqual(4);
    expect(pixelStats(await shoot(page)).stddev).toBeGreaterThan(BLANK_STDDEV);
    expect(problems).toEqual([]);
  });

  test("bows to face straight down, and joins round the back and at the poles", async ({
    page,
  }) => {
    const problems = await open(page);
    await page.evaluate(() => {
      window.__salute!.pause(true);
      window.__salute!.seek("hold", "floor", 1);
    });
    const upright = await shoot(page);
    const w = upright.width;
    // Across the seam at the back is no more different than any two neighbouring columns.
    const seam = (img: Png) =>
      Math.max(columnDiff(img, 0, 1), columnDiff(img, w - 2, w - 1), 1) * 4 + 3;
    expect(columnDiff(upright, w - 1, 0)).toBeLessThan(seam(upright));
    // The top and bottom rows each sit round a single point.
    expect(rowSpread(upright, 0)).toBeLessThan(12);
    expect(rowSpread(upright, upright.height - 1)).toBeLessThan(12);

    await page.evaluate(() => {
      window.__salute!.cue("under");
      window.__salute!.seek("relax");
      window.__salute!.seek("hold", "under", 1);
    });
    const s = await state(page);
    expect(s.kind).toBe("under");
    expect(s.pitch).toBeLessThan(-88);
    expect(s.raise).toBe(1);
    const bowed = await shoot(page);
    expect(columnDiff(bowed, w - 1, 0)).toBeLessThan(seam(bowed));
    expect(rowSpread(bowed, 0)).toBeLessThan(12);
    expect(rowSpread(bowed, bowed.height - 1)).toBeLessThan(12);
    // The face is on the bottom of the ball now: the lower half of the feed holds the detail.
    const half = (img: Png, from: number, to: number) =>
      pixelStats({
        width: img.width,
        height: to - from,
        data: img.data.subarray(from * img.width * 4, to * img.width * 4),
      }).stddev;
    const mid = Math.floor(bowed.height / 2);
    expect(half(bowed, mid, bowed.height)).toBeGreaterThan(half(bowed, 0, mid));
    expect(problems).toEqual([]);
  });

  test("hangs as a ball in the globe preview, from beside, below and far", async ({ page }) => {
    const problems = await open(page, { look: "globe" });
    await expect(page.locator(".hc-globe")).toBeVisible();
    await page.waitForTimeout(1500);
    const size = page.viewportSize() ?? { width: 1280, height: 640 };
    const clip = { x: size.width / 2 - 60, y: size.height / 2 - 140, width: 120, height: 120 };
    const box = decodePng(await page.screenshot({ clip }));
    expect(pixelStats(box).stddev).toBeGreaterThan(BLANK_STDDEV);
    expect(pixelStats(box).mean).toBeGreaterThan(40);
    for (const view of ["under", "far"]) {
      await page.click(`button[data-globe=${view}]`);
      await page.waitForTimeout(500);
      const shot = decodePng(await page.screenshot());
      expect(pixelStats(shot).stddev).toBeGreaterThan(BLANK_STDDEV);
    }
    expect(problems).toEqual([]);
  });

  test("runs in every colour and at the relaxed pace", async ({ page }) => {
    for (const colour of ["yellow", "blue", "green"]) {
      const problems = await open(page, { "o.colour": colour, "o.pace": "relaxed" });
      const status = await page.evaluate(() => window.__hypercube?.appStatus() ?? {});
      expect(status.colour).toBe(colour);
      const [r, g, b] = meanColour(await shoot(page)) as [number, number, number];
      if (colour === "yellow") expect(r).toBeGreaterThan(b + 80);
      if (colour === "blue") expect(b).toBeGreaterThan(r + 40);
      if (colour === "green") expect(g).toBeGreaterThan(Math.max(r, b) + 30);
      const s = await page.evaluate(() => window.__salute!.skip(600));
      // Slower than the formal pace's seven or so salutes a minute.
      expect(s.stats.salutes).toBeGreaterThan(30);
      expect(s.stats.salutes).toBeLessThan(60);
      expect(problems).toEqual([]);
    }
  });

  test("holds the salute for good when asked, turning slowly", async ({ page }) => {
    const problems = await open(page, { "o.hold": "true" });
    await page.waitForFunction(() => window.__salute!.state().stage === "hold", undefined, {
      timeout: 15_000,
    });
    const first = await state(page);
    expect(first.kind).toBe("parade");
    const bearings = new Set<number>();
    for (let i = 0; i < 8; i++) {
      const s = await page.evaluate(() => window.__salute!.skip(7));
      expect(s.stage).toBe("hold");
      expect(s.raise).toBe(1);
      bearings.add(Math.round(s.bearing / 45));
    }
    expect(bearings.size).toBeGreaterThanOrEqual(5);
    const s = await state(page);
    expect(s.stats.salutes).toBe(1);
    expect(s.glisten).toBeGreaterThan(0.9);
    expect(pixelStats(await shoot(page)).stddev).toBeGreaterThan(BLANK_STDDEV);
    expect(problems).toEqual([]);
  });

  test("takes up the held salute mid-show without starting again, and keeps it through a reset", async ({
    page,
  }) => {
    const problems = await open(page, { idle: 5 });
    const before = await page.evaluate(() => {
      window.__salute!.seek("turn");
      window.__salute!.hold(true);
      return window.__salute!.skip(20);
    });
    expect(before.held).toBe(true);
    expect(before.stage).toBe("hold");
    expect(before.kind).toBe("parade");
    await page.waitForFunction(() => (window.__salute?.state().resets ?? 0) > 0, undefined, {
      timeout: 20_000,
    });
    const after = await page.evaluate(() => window.__salute!.skip(60));
    expect(after.held).toBe(true);
    expect(after.stage).toBe("hold");
    expect(after.raise).toBe(1);
    expect(after.stats.salutes).toBe(before.stats.salutes);
    expect(after.time).toBeGreaterThan(before.time + 60);
    const status = await page.evaluate(() => window.__hypercube?.appStatus() ?? {});
    expect(status.held).toBe(true);
    // Released, it goes back to the show.
    const released = await page.evaluate(() => {
      window.__salute!.hold(false);
      return window.__salute!.skip(60);
    });
    expect(released.held).toBe(false);
    expect(released.stats.salutes).toBeGreaterThan(after.stats.salutes + 3);
    expect(problems).toEqual([]);
  });

  test("keeps the show running through the idle reset", async ({ page }) => {
    const problems = await open(page, { idle: 5 });
    const before = await state(page);
    await page.waitForFunction(() => (window.__salute?.state().resets ?? 0) > 0, undefined, {
      timeout: 20_000,
    });
    const after = await state(page);
    expect(after.time).toBeGreaterThan(before.time + 3);
    expect(after.stats.salutes).toBeGreaterThanOrEqual(before.stats.salutes);
    // The opening salute is still held or just over: nothing started again.
    expect(after.time).toBeGreaterThan(4);
    expect(after.frames).toBeGreaterThan(before.frames);
    expect(problems).toEqual([]);
  });
});
