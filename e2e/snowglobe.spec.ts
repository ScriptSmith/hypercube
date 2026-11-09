import { expect, type Page, test } from "@playwright/test";
import { playPath, viewportFor, waitForRunning, watchPage } from "../scripts/lib/play.mjs";
import { BLANK_STDDEV, decodePng, pixelStats } from "../scripts/lib/png.mjs";

const FEED = { width: 4096, height: 2048 };
const SCENES = ["cabin", "lighthouse", "square", "carousel", "snowman", "hut"];
/** Where the pile's top sits with no snow in it: the mound's foot, design metres. */
const EMPTY_PILE = -2.165;

interface GlobeState {
  t: number;
  ready: boolean;
  drawn: number;
  scene: string;
  mood: string;
  shakes: number;
  swaps: number;
  next: number;
  last: number | null;
  murk: number;
  flakes: number;
  floating: number;
  resting: number;
  piled: number;
  pileTop: number;
}

declare global {
  interface Window {
    __snowglobe?: {
      state(): GlobeState;
      shake(scene?: string): void;
      advance(seconds: number): void;
      scenes(): string[];
    };
  }
}

const open = async (page: Page, params: Record<string, string | number> = {}) => {
  const problems = watchPage(page);
  await page.setViewportSize(viewportFor(FEED));
  await page.goto(
    playPath({
      app: "snowglobe",
      kind: "sphere",
      size: FEED,
      bots: 0,
      params: { debug: 1, res: 0.5, ...params },
    }),
  );
  const started = await waitForRunning(page);
  expect(started.phase, started.errors.join("; ")).toBe("running");
  await page.waitForFunction(() => (window.__snowglobe?.state().drawn ?? 0) > 3, undefined, {
    timeout: 60_000,
  });
  return problems;
};

const state = (page: Page) => page.evaluate(() => window.__snowglobe!.state());
const advance = (page: Page, seconds: number) =>
  page.evaluate((s) => window.__snowglobe!.advance(s), seconds);
const spread = async (page: Page, clip?: { x: number; y: number; width: number; height: number }) =>
  pixelStats(
    decodePng(
      clip ? await page.screenshot({ clip }) : await page.locator(".hc-stage").screenshot(),
    ),
  ).stddev;

test.describe("snowglobe", () => {
  test("shows a scene in the globe, snow falling and some already settled", async ({ page }) => {
    const problems = await open(page);
    const s = await state(page);
    expect(s.ready).toBe(true);
    expect(SCENES).toContain(s.scene);
    expect(s.floating + s.resting + s.piled).toBe(s.flakes);
    expect(s.floating).toBeGreaterThan(s.flakes * 0.2);
    expect(s.resting + s.piled).toBeGreaterThan(s.flakes * 0.2);
    expect(await spread(page)).toBeGreaterThan(BLANK_STDDEV);
    await page.waitForTimeout(800);
    const later = await state(page);
    expect(later.t).toBeGreaterThan(s.t);
    expect(later.drawn).toBeGreaterThan(s.drawn);
    const status = await page.evaluate(() => window.__hypercube?.appStatus() ?? {});
    expect(status.scene).toBe(later.scene);
    expect(problems).toEqual([]);
  });

  test("looks like a globe from beside, below and far", async ({ page }) => {
    const problems = await open(page, { look: "globe" });
    await expect(page.locator(".hc-globe")).toBeVisible();
    await page.waitForTimeout(1500);
    const size = page.viewportSize() ?? { width: 1280, height: 640 };
    const ball = { x: size.width / 2 - 60, y: size.height / 2 - 140, width: 120, height: 120 };
    expect(await spread(page, ball)).toBeGreaterThan(BLANK_STDDEV);
    for (const view of ["under", "far"]) {
      await page.click(`button[data-globe=${view}]`);
      await page.waitForTimeout(600);
      expect(pixelStats(decodePng(await page.screenshot())).stddev).toBeGreaterThan(BLANK_STDDEV);
    }
    expect(problems).toEqual([]);
  });

  test("a shake lifts all the snow into a blizzard, which settles again", async ({ page }) => {
    test.setTimeout(120_000);
    const problems = await open(page);
    // Some snow has piled up already, and more comes down before the first shake.
    await advance(page, 10);
    const calm = await state(page);
    expect(calm.piled).toBeGreaterThan(0);
    expect(calm.pileTop).toBeGreaterThan(EMPTY_PILE + 0.05);
    await page.evaluate(() => window.__snowglobe!.shake());
    await advance(page, 1.2);
    const storm = await state(page);
    expect(storm.shakes).toBe(calm.shakes + 1);
    expect(storm.murk).toBeGreaterThan(0.5);
    expect(storm.piled).toBe(0);
    expect(storm.floating).toBeGreaterThan(storm.flakes * 0.95);
    expect(storm.pileTop).toBeCloseTo(EMPTY_PILE, 2);
    const shot = await spread(page);
    expect(shot).toBeGreaterThan(BLANK_STDDEV);
    // Most of it is down within a minute, piling up again.
    await advance(page, 60);
    const settled = await state(page);
    expect(settled.murk).toBe(0);
    expect(settled.floating).toBeLessThan(settled.flakes * 0.45);
    expect(settled.piled).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  test("the scene changes while the snow is thickest, and only then", async ({ page }) => {
    const problems = await open(page);
    const before = await state(page);
    const target = SCENES.find((s) => s !== before.scene)!;
    await page.evaluate((s) => window.__snowglobe!.shake(s), target);
    // The page keeps time by itself between these calls, so read how far into the shake it is.
    const during = await state(page);
    const into = during.t - (during.last ?? during.t);
    expect(during.scene).toBe(into < 1.5 ? before.scene : target);
    if (into < 1.2) expect(during.murk).toBeLessThan(0.999);
    await advance(page, 2);
    const after = await state(page);
    expect(after.scene).toBe(target);
    expect(after.swaps).toBe(before.swaps + 1);
    await page.waitForTimeout(500);
    expect(await spread(page)).toBeGreaterThan(BLANK_STDDEV);
    expect(problems).toEqual([]);
  });

  test("shakes by itself, and visits several scenes", async ({ page }) => {
    test.setTimeout(150_000);
    const problems = await open(page);
    const first = await state(page);
    expect(first.next).toBeGreaterThan(first.t);
    await advance(page, first.next - first.t + 2);
    const shaken = await state(page);
    expect(shaken.shakes).toBe(first.shakes + 1);
    expect(shaken.last).toBeCloseTo(first.next, 1);
    // Jump between scenes the way admin can, each one drawing something.
    const seen = new Set([shaken.scene]);
    for (const scene of SCENES.filter((s) => s !== shaken.scene).slice(0, 3)) {
      await page.evaluate((s) => window.__snowglobe!.shake(s), scene);
      await advance(page, 2);
      seen.add((await state(page)).scene);
    }
    expect(seen.size).toBeGreaterThanOrEqual(4);
    expect(problems).toEqual([]);
  });

  test("going idle keeps the show running without a jump", async ({ page }) => {
    const problems = await open(page, { idle: 5 });
    const before = await state(page);
    await page.waitForTimeout(6500);
    const after = await state(page);
    expect(after.scene).toBe(before.scene);
    // Software rendering can't keep up with real time; the show still moves on.
    expect(after.t - before.t).toBeGreaterThan(2);
    expect(after.drawn).toBeGreaterThan(before.drawn);
    expect(problems).toEqual([]);
  });

  test("a chosen scene stays, and shakes come rarely when asked", async ({ page }) => {
    const problems = await open(page, { "o.scene": "snowman", "o.shake": "rarely" });
    const s = await state(page);
    expect(s.scene).toBe("snowman");
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.__snowglobe!.shake());
      await advance(page, 2);
      expect((await state(page)).scene).toBe("snowman");
    }
    const t = (await state(page)).t;
    expect((await state(page)).next - t).toBeGreaterThanOrEqual(170);
    expect(problems).toEqual([]);
  });
});
