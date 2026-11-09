import { expect, type Page, test } from "@playwright/test";
import { playPath, viewportFor, waitForRunning, watchPage } from "../scripts/lib/play.mjs";
import { BLANK_STDDEV, decodePng, pixelStats } from "../scripts/lib/png.mjs";

const FEED = { width: 4096, height: 2048 };

interface OrbState {
  t: number;
  ready: boolean;
  drawn: number;
  software: boolean;
  scene: string | null;
  index: number;
  open: number;
  reveal: number;
  stage: "smoke" | "opening" | "clear" | "closing";
  next: { scene: string; start: number };
  kept: number;
  windows: number;
  smoke: number[];
  vision: number;
  glow: string;
  pace: string;
}

declare global {
  interface Window {
    __orb?: {
      state(): OrbState;
      skip(seconds: number): void;
      open(scene?: string): string | null;
      clear(scene?: string): void;
      scenes(): string[];
      seen(): { vision: number; smoke: number };
    };
  }
}

const open = async (page: Page, params: Record<string, string | number> = {}) => {
  const problems = watchPage(page);
  await page.setViewportSize(viewportFor(FEED));
  await page.goto(
    playPath({
      app: "orb",
      kind: "sphere",
      size: FEED,
      bots: 0,
      params: { debug: 1, res: 0.5, ...params },
    }),
  );
  const started = await waitForRunning(page);
  expect(started.phase, started.errors.join("; ")).toBe("running");
  // Nine shader programs compile in the background first.
  await page.waitForFunction(() => (window.__orb?.state().drawn ?? 0) > 3, undefined, {
    timeout: 60_000,
  });
  return problems;
};

const state = (page: Page) => page.evaluate(() => window.__orb!.state());
const seen = (page: Page) => page.evaluate(() => window.__orb!.seen());

/** Wait until a few more frames have been drawn, so the picture shows what was just set. */
const settle = async (page: Page) => {
  const drawn = (await state(page)).drawn;
  await page.waitForFunction((n) => window.__orb!.state().drawn > n + 2, drawn, {
    timeout: 30_000,
  });
};

/** Move on to a time with smoke alone and the next vision a while off. */
const toSmoke = (page: Page) =>
  page.evaluate(() => {
    const orb = window.__orb!;
    for (let i = 0; i < 600; i++) {
      const s = orb.state();
      if (!s.scene && s.next.start - s.t > 10) return;
      orb.skip(1);
    }
  });

/** The luminance spread of the flat feed's middle, clear of any label in the corners. */
const middleSpread = async (page: Page) => {
  const box = (await page.locator(".hc-stage").boundingBox())!;
  const clip = {
    x: box.x + box.width * 0.1,
    y: box.y + box.height * 0.2,
    width: box.width * 0.8,
    height: box.height * 0.6,
  };
  return pixelStats(decodePng(await page.screenshot({ clip }))).stddev;
};

test.describe("orb", () => {
  test("draws smoke in dark glass on the flat feed, and opens a vision a second in", async ({
    page,
  }) => {
    const problems = await open(page);
    const a = await state(page);
    expect(a.ready).toBe(true);
    expect(a.glow).toBe("cool");
    expect(a.pace).toBe("often");
    expect(a.windows).toBe(4);
    expect(await middleSpread(page)).toBeGreaterThan(BLANK_STDDEV);
    // The first vision starts a second after load, so previews and thumbnails show one.
    await page.waitForFunction(() => window.__orb!.state().stage === "clear", undefined, {
      timeout: 30_000,
    });
    await settle(page);
    const b = await state(page);
    expect(b.index).toBe(0);
    expect(b.reveal).toBe(1);
    expect((await seen(page)).vision).toBeGreaterThan(0.5);
    const status = await page.evaluate(() => window.__hypercube?.appStatus() ?? {});
    expect(status.stage).toBe("clear");
    expect(status.scene).toBe(b.scene);
    expect(problems).toEqual([]);
  });

  test("shows every scene through the parted smoke, and none with the smoke closed", async ({
    page,
  }) => {
    const problems = await open(page);
    const scenes = await page.evaluate(() => window.__orb!.scenes());
    expect(scenes).toHaveLength(7);
    await toSmoke(page);
    await settle(page);
    const closed = await seen(page);
    expect(closed.vision).toBeLessThan(0.01);
    expect(closed.smoke).toBeGreaterThan(0.001);
    for (const scene of scenes) {
      await page.evaluate((s) => window.__orb!.clear(s), scene);
      await settle(page);
      const s = await state(page);
      expect(s.scene).toBe(scene);
      expect(s.stage).toBe("clear");
      expect((await seen(page)).vision, scene).toBeGreaterThan(0.5);
      expect(await middleSpread(page)).toBeGreaterThan(BLANK_STDDEV);
    }
    expect(problems).toEqual([]);
  });

  test("looks like a ball in the globe preview, from beside, below and far", async ({ page }) => {
    const problems = await open(page, { look: "globe" });
    await expect(page.locator(".hc-globe")).toBeVisible();
    for (const scene of [null, "ship"]) {
      if (scene) await page.evaluate((s) => window.__orb!.clear(s), scene);
      else await toSmoke(page);
      await settle(page);
      for (const view of ["side", "under", "far"]) {
        await page.click(`button[data-globe=${view}]`);
        await page.waitForTimeout(400);
        const shot = await page.screenshot();
        expect(pixelStats(decodePng(shot)).stddev).toBeGreaterThan(BLANK_STDDEV);
      }
    }
    expect(problems).toEqual([]);
  });

  test("moves on through visions for hours, opening, clearing and closing each", async ({
    page,
  }) => {
    const problems = await open(page);
    // Three quarters of an hour in steps of 9 s, walked inside the page.
    const walk = await page.evaluate(() => {
      const orb = window.__orb!;
      const out: { stage: string; scene: string | null; index: number; kept: number }[] = [];
      for (let i = 0; i < 300; i++) {
        orb.skip(9);
        const s = orb.state();
        out.push({ stage: s.stage, scene: s.scene, index: s.index, kept: s.kept });
      }
      return out;
    });
    const stages = new Set<string>();
    const scenes: string[] = [];
    let last = -1;
    for (const s of walk) {
      stages.add(s.stage);
      expect(s.kept).toBeLessThanOrEqual(2);
      if (s.scene && s.index !== last) {
        expect(s.index).toBeGreaterThan(last);
        last = s.index;
        scenes.push(s.scene);
      }
    }
    expect([...stages].sort()).toEqual(["clear", "closing", "opening", "smoke"]);
    expect(scenes.length).toBeGreaterThan(20);
    expect(new Set(scenes).size).toBe(7);
    for (let i = 1; i < scenes.length; i++) expect(scenes[i]).not.toBe(scenes[i - 1]);
    await settle(page);
    expect(await middleSpread(page)).toBeGreaterThan(BLANK_STDDEV);
    expect(problems).toEqual([]);
  });

  test("opens a vision when admin asks, and rarely otherwise with that option", async ({
    page,
  }) => {
    const problems = await open(page, { "o.visions": "rarely", "o.glow": "warm" });
    const s = await state(page);
    expect(s.pace).toBe("rarely");
    expect(s.glow).toBe("warm");
    await toSmoke(page);
    const due = (await state(page)).next;
    const t = (await state(page)).t;
    expect(due.start - t).toBeGreaterThan(0);
    // Asked for by name, as an admin app command would.
    const scene = await page.evaluate(() => window.__orb!.open("whale"));
    expect(scene).toBe("whale");
    expect((await state(page)).stage).toBe("opening");
    // While one plays, another can't be opened over it.
    expect(await page.evaluate(() => window.__orb!.open("city"))).toBeNull();
    // Rarely: two to four minutes from one vision to the next.
    const v = await state(page);
    expect(v.next.start - t).toBeGreaterThanOrEqual(120 - 1);
    expect(problems).toEqual([]);
  });

  test("going idle keeps the show running without a jump", async ({ page }) => {
    const problems = await open(page, { idle: 5 });
    const before = await state(page);
    await page.waitForTimeout(6500);
    const after = await state(page);
    expect(after.t - before.t).toBeGreaterThan(5);
    expect(after.drawn).toBeGreaterThan(before.drawn);
    // Still the first vision, or the smoke after it: never back to the start.
    expect(after.index).toBeGreaterThanOrEqual(before.index);
    expect(after.t).toBeGreaterThan(before.t);
    expect(problems).toEqual([]);
  });
});
