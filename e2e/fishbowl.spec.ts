import { expect, type Page, test } from "@playwright/test";
import { playPath, viewportFor, waitForRunning, watchPage } from "../scripts/lib/play.mjs";
import { BLANK_STDDEV, decodePng, pixelStats } from "../scripts/lib/png.mjs";

const FEED = { width: 4096, height: 2048 };
const HABITS = ["kiss", "puff", "chase", "loop", "dart", "nap", "feed"] as const;

interface FishState {
  species: string;
  r: number;
  lat: number;
  task: string | null;
  phase: string | null;
  nose: number;
  puff: number;
}

interface BowlState {
  t: number;
  drawn: number;
  ready: boolean;
  water: number;
  feeding: boolean;
  flakes: number;
  habits: { kind: string; side: number; start: number }[];
  counts: Record<string, number>;
  sides: number[];
  fish: FishState[];
  snails: number;
  triangles: number;
  drawCalls: number;
}

declare global {
  interface Window {
    __fishbowl?: {
      state(): BowlState;
      advance(seconds: number): void;
      trigger(kind: string, side?: number): boolean;
    };
  }
}

/** The bowl, with the goldfish bowl's cast unless `variant` says otherwise. */
const open = async (page: Page, params: Record<string, string | number> = {}, variant = "bowl") => {
  const problems = watchPage(page);
  await page.setViewportSize(viewportFor(FEED));
  await page.goto(
    playPath({
      app: "fishbowl",
      kind: "sphere",
      variant,
      size: FEED,
      bots: 0,
      params: { debug: 1, res: 0.5, ...params },
    }),
  );
  const started = await waitForRunning(page);
  expect(started.phase, started.errors.join("; ")).toBe("running");
  await page.waitForFunction(() => (window.__fishbowl?.state().drawn ?? 0) > 2, undefined, {
    timeout: 60_000,
  });
  return problems;
};

const state = (page: Page) => page.evaluate(() => window.__fishbowl!.state());
const advance = (page: Page, seconds: number) =>
  page.evaluate((s) => window.__fishbowl!.advance(s), seconds);
const trigger = (page: Page, kind: string, side?: number) =>
  page.evaluate(([k, s]) => window.__fishbowl!.trigger(k as string, s as number | undefined), [
    kind,
    side,
  ] as const);

const stageSpread = async (page: Page) =>
  pixelStats(decodePng(await page.locator(".hc-stage").screenshot())).stddev;

test.describe("fishbowl", () => {
  test("draws the bowl with its fish on the flat feed", async ({ page }) => {
    const problems = await open(page);
    const s = await state(page);
    expect(s.ready).toBe(true);
    expect(s.fish).toHaveLength(11);
    expect(s.snails).toBe(1);
    // The surface sits a little above the band people see well, in the cap.
    expect(Math.asin(s.water)).toBeGreaterThan(0.6);
    for (const f of s.fish) expect(f.r).toBeLessThan(0.97);
    expect(await stageSpread(page)).toBeGreaterThan(BLANK_STDDEV);
    await page.waitForTimeout(1000);
    const later = await state(page);
    expect(later.t).toBeGreaterThan(s.t);
    expect(later.drawn).toBeGreaterThan(s.drawn);
    expect(problems).toEqual([]);
  });

  test("shows the bowl in the globe preview", async ({ page }) => {
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

  test("does each habit on demand, then lets the fish go", async ({ page }) => {
    test.setTimeout(240_000);
    const problems = await open(page);
    for (const kind of HABITS) {
      // Feeding time comes round by itself every few minutes of show time, and no other habit
      // starts while it lasts, so let it finish first.
      for (let i = 0; i < 90 && kind !== "feed" && (await state(page)).feeding; i++) {
        await advance(page, 2);
      }
      expect(await trigger(page, kind, 1), kind).toBe(true);
      expect(
        (await state(page)).habits.map((h) => h.kind),
        kind,
      ).toContain(kind);
      if (kind === "kiss") {
        // A goldfish's nose reaches the glass and stays there a while.
        let held = false;
        for (let i = 0; i < 30 && !held; i++) {
          await advance(page, 1);
          held = (await state(page)).fish.some((f) => f.phase === "hold" && f.nose > 0.95);
        }
        expect(held).toBe(true);
      }
      if (kind === "puff") {
        let puffed = 0;
        for (let i = 0; i < 20; i++) {
          await advance(page, 0.5);
          puffed = Math.max(puffed, ...(await state(page)).fish.map((f) => f.puff));
        }
        expect(puffed).toBeGreaterThan(0.99);
      }
      if (kind === "feed") {
        // Flakes drift down from the surface for a few seconds, and the fish start on them.
        await advance(page, 2);
        const fed = await state(page);
        expect(fed.feeding).toBe(true);
        expect(fed.flakes).toBeGreaterThanOrEqual(5);
      }
      await advance(page, 90);
      const after = await state(page);
      // It has run its course (feeding time may have come round by itself meanwhile).
      expect(after.habits.filter((h) => h.kind === kind && h.start < after.t - 80)).toEqual([]);
      expect(after.counts[kind]).toBeGreaterThan(0);
    }
    expect(await stageSpread(page)).toBeGreaterThan(BLANK_STDDEV);
    const status = await page.evaluate(() => window.__hypercube?.appStatus() ?? {});
    expect(Number(status.fish)).toBe(11);
    expect(problems).toEqual([]);
  });

  test("keeps something going round every side for half an hour", async ({ page }) => {
    const problems = await open(page);
    await advance(page, 1800);
    const s = await state(page);
    expect(s.counts.feed).toBeGreaterThanOrEqual(5);
    for (const kind of HABITS) expect(s.counts[kind], kind).toBeGreaterThan(0);
    const total = s.sides.reduce((a, b) => a + b, 0);
    for (const n of s.sides) expect(n / total).toBeGreaterThan(0.2);
    for (const f of s.fish) expect(f.r).toBeLessThan(0.97);
    await page.waitForFunction((n) => window.__fishbowl!.state().drawn > n + 2, s.drawn);
    expect(await stageSpread(page)).toBeGreaterThan(BLANK_STDDEV);
    expect(problems).toEqual([]);
  });

  test("follows its options: many fish, and no feeding", async ({ page }) => {
    const problems = await open(page, { "o.fish": "many", "o.feeding": "false" });
    const s = await state(page);
    expect(s.fish).toHaveLength(16);
    expect(s.snails).toBe(2);
    await advance(page, 900);
    const later = await state(page);
    expect(later.counts.feed).toBe(0);
    expect(later.counts.kiss).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  test("fills the bowl with a community of tropical fish by default", async ({ page }) => {
    const problems = await open(page, {}, "community");
    const s = await state(page);
    expect(s.ready).toBe(true);
    expect(s.fish).toHaveLength(19);
    const kinds = new Set(s.fish.map((f) => f.species));
    for (const k of ["angel", "gourami", "cory", "harlequin", "tetra"])
      expect(kinds.has(k), k).toBe(true);
    await advance(page, 900);
    const later = await state(page);
    for (const kind of ["kiss", "chase", "dart", "nap", "feed"]) {
      expect(later.counts[kind], kind).toBeGreaterThan(0);
    }
    for (const f of later.fish) expect(f.r).toBeLessThan(0.97);
    await page.waitForFunction((n) => window.__fishbowl!.state().drawn > n + 2, later.drawn);
    expect(await stageSpread(page)).toBeGreaterThan(BLANK_STDDEV);
    expect(problems).toEqual([]);
  });

  test("keeps the show running through the runtime's idle reset", async ({ page }) => {
    const problems = await open(page, { idle: 5 });
    const before = await state(page);
    await page.waitForTimeout(6500);
    const after = await state(page);
    // The show runs on at its own pace: no restart, no jump. (A slow software renderer can fall
    // behind real time, as the loop catches up at most a quarter second a frame.)
    expect(after.t - before.t).toBeGreaterThan(2);
    expect(after.t - before.t).toBeLessThan(9);
    expect(after.fish).toHaveLength(before.fish.length);
    expect(problems).toEqual([]);
  });
});

// ---- The wall ---------------------------------------------------------------------------------

const WALL = { width: 5760, height: 2160 };
const TANK_HABITS = ["kiss", "chase", "dart", "nap", "air", "feed"] as const;

interface TankFishState {
  species: string;
  x: number;
  y: number;
  z: number;
  task: string | null;
  phase: string | null;
  nose: number;
  fear: number;
}

interface TankState {
  t: number;
  drawn: number;
  ready: boolean;
  kind: string;
  water: number;
  feeding: boolean;
  food: number;
  fingers: number;
  attract: boolean;
  habits: { kind: string; side: number; start: number }[];
  counts: Record<string, number>;
  sides: number[];
  taps: number;
  fish: TankFishState[];
  shrimp: { x: number; y: number; z: number; state: string }[];
  snails: number;
  box: { left: number; right: number; back: number; floor: number; water: number };
}

interface TankHook {
  state(): TankState;
  advance(seconds: number): void;
  trigger(kind: string, side?: number): boolean;
  toStage(x: number, y: number): { x: number; y: number };
}

const openWall = async (page: Page, params: Record<string, string | number> = {}, bots = 0) => {
  const problems = watchPage(page);
  await page.setViewportSize(viewportFor(WALL));
  await page.goto(
    playPath({
      app: "fishbowl",
      kind: "wall",
      size: WALL,
      bots,
      params: { debug: 1, res: 0.5, ...params },
    }),
  );
  const started = await waitForRunning(page);
  expect(started.phase, started.errors.join("; ")).toBe("running");
  await page.waitForFunction(
    () => ((window.__fishbowl as unknown as TankHook | undefined)?.state().drawn ?? 0) > 2,
    undefined,
    { timeout: 60_000 },
  );
  return problems;
};

const tank = (page: Page) =>
  page.evaluate(() => (window.__fishbowl as unknown as TankHook).state());
const tankAdvance = (page: Page, seconds: number) =>
  page.evaluate((s) => (window.__fishbowl as unknown as TankHook).advance(s), seconds);

/**
 * Fingers on the glass at points given in metres, as real pointer events at the element under
 * them, held for `ms` and lifted together.
 */
const touchGlass = (page: Page, points: { x: number; y: number }[], ms: number) =>
  page.evaluate(
    async ({ pts, hold }) => {
      const hook = window.__fishbowl as unknown as TankHook;
      const stage = document.querySelector<HTMLElement>(".hc-stage")!;
      const r = stage.getBoundingClientRect();
      const k = r.width / stage.offsetWidth;
      const fingers = pts.map((p, i) => {
        const s = hook.toStage(p.x, p.y);
        return { c: { clientX: r.left + s.x * k, clientY: r.top + s.y * k }, pointerId: 9100 + i };
      });
      const fire = (type: string) => {
        for (const f of fingers)
          (document.elementFromPoint(f.c.clientX, f.c.clientY) ?? stage).dispatchEvent(
            new PointerEvent(type, {
              ...f.c,
              pointerId: f.pointerId,
              pointerType: "touch",
              bubbles: true,
              isPrimary: f.pointerId === 9100,
            }),
          );
      };
      fire("pointerdown");
      await new Promise((res) => setTimeout(res, 120));
      const during = hook.state();
      await new Promise((res) => setTimeout(res, Math.max(0, hold - 120)));
      const held = hook.state();
      fire("pointerup");
      return { during, held };
    },
    { pts: points, hold: ms },
  );

test.describe("fishbowl wall", () => {
  test("draws the tank behind the wall's glass with its fish, shrimp and snails", async ({
    page,
  }) => {
    const problems = await openWall(page);
    const s = await tank(page);
    expect(s.ready).toBe(true);
    expect(s.kind).toBe("wall");
    expect(s.fish.length).toBe(38);
    expect(s.shrimp.length).toBe(4);
    expect(s.snails).toBe(2);
    for (const f of s.fish) {
      expect(f.z).toBeLessThan(0);
      expect(f.y).toBeLessThan(s.water);
    }
    expect(await stageSpread(page)).toBeGreaterThan(BLANK_STDDEV);
    await page.waitForTimeout(1000);
    const later = await tank(page);
    expect(later.t).toBeGreaterThan(s.t);
    expect(later.drawn).toBeGreaterThan(s.drawn);
    expect(problems).toEqual([]);
  });

  test("a tap startles fish, then curious ones come to look at the finger", async ({ page }) => {
    const problems = await openWall(page, { "o.feeding": "false" });
    await page.waitForTimeout(1500);
    const s = await tank(page);
    const angel = s.fish.find((f) => f.species === "angel")!;
    const at = {
      x: Math.max(-5.5, Math.min(5.5, angel.x)),
      y: Math.max(1, Math.min(2.2, angel.y)),
    };
    const { during } = await touchGlass(page, [at], 100);
    expect(during.counts.tap).toBe(1);
    expect(during.fish.some((f) => f.fear > 0.1)).toBe(true);
    let peek = false;
    for (let i = 0; i < 20 && !peek; i++) {
      await tankAdvance(page, 0.5);
      peek = (await tank(page)).fish.some(
        (f) => f.task === "peek" && f.phase === "hold" && Math.hypot(f.x - at.x, f.y - at.y) < 1.8,
      );
    }
    expect(peek).toBe(true);
    expect(problems).toEqual([]);
  });

  test("holding the glass sprinkles food the fish rush to eat", async ({ page }) => {
    const problems = await openWall(page, { "o.feeding": "false" });
    const { held } = await touchGlass(page, [{ x: 0.5, y: 1.4 }], 1600);
    expect(held.fingers).toBe(1);
    expect(held.counts.hold).toBe(1);
    expect(held.food).toBeGreaterThan(2);
    await tankAdvance(page, 1);
    expect((await tank(page)).fish.some((f) => f.task === "feed")).toBe(true);
    await tankAdvance(page, 80);
    expect((await tank(page)).food).toBe(0);
    expect(problems).toEqual([]);
  });

  test("follows several fingers at once along the wall", async ({ page }) => {
    const problems = await openWall(page, { "o.feeding": "false" });
    const points = [
      { x: -5, y: 1 },
      { x: -1, y: 2 },
      { x: 3, y: 0.8 },
      { x: 5.5, y: 1.8 },
    ];
    const { held } = await touchGlass(page, points, 900);
    expect(held.fingers).toBe(4);
    expect(held.counts.tap).toBe(4);
    expect(held.counts.hold).toBeGreaterThanOrEqual(3);
    await page.waitForTimeout(300);
    expect((await tank(page)).fingers).toBe(0);
    expect(problems).toEqual([]);
  });

  test("bots tap and feed through the glass", async ({ page }) => {
    const problems = await openWall(page, { "o.feeding": "false" }, 2);
    await page.waitForFunction(
      () => ((window.__fishbowl as unknown as TankHook).state().counts.tap ?? 0) >= 3,
      undefined,
      { timeout: 45_000 },
    );
    expect(await stageSpread(page)).toBeGreaterThan(BLANK_STDDEV);
    expect(problems).toEqual([]);
  });

  test("goes to attract when idle, and a ghost finger shows what to do", async ({ page }) => {
    const problems = await openWall(page, { idle: 5, "o.feeding": "false" });
    await page.waitForFunction(
      () => (window.__fishbowl as unknown as TankHook).state().attract,
      undefined,
      {
        timeout: 30_000,
      },
    );
    await page.waitForFunction(
      () => ((window.__fishbowl as unknown as TankHook).state().counts.tap ?? 0) >= 1,
      undefined,
      { timeout: 40_000 },
    );
    // A person's touch ends attract.
    await touchGlass(page, [{ x: 0, y: 1.5 }], 80);
    expect((await tank(page)).attract).toBe(false);
    expect(problems).toEqual([]);
  });

  test("does each habit on demand, then lets the fish go", async ({ page }) => {
    test.setTimeout(120_000);
    const problems = await openWall(page);
    for (const kind of TANK_HABITS) {
      for (let i = 0; i < 90 && kind !== "feed" && (await tank(page)).feeding; i++) {
        await tankAdvance(page, 2);
      }
      expect(
        await page.evaluate(
          ([k]) => (window.__fishbowl as unknown as TankHook).trigger(k!, 1),
          [kind],
        ),
        kind,
      ).toBe(true);
      expect(
        (await tank(page)).habits.map((h) => h.kind),
        kind,
      ).toContain(kind);
      await tankAdvance(page, 90);
      const after = await tank(page);
      expect(after.habits.filter((h) => h.kind === kind && h.start < after.t - 80)).toEqual([]);
      expect(after.counts[kind]).toBeGreaterThan(0);
    }
    expect(problems).toEqual([]);
  });

  test("keeps the goldfish bowl's cast lively on the wall", async ({ page }) => {
    const problems = await openWall(page, { variant: "bowl" });
    const s = await tank(page);
    expect(s.fish.some((f) => f.species === "goldfish")).toBe(true);
    expect(s.fish.some((f) => f.species === "puffer")).toBe(true);
    await tankAdvance(page, 1200);
    const later = await tank(page);
    for (const kind of ["kiss", "chase", "loop", "dart", "puff", "feed"]) {
      expect(later.counts[kind], kind).toBeGreaterThan(0);
    }
    const total = later.sides.reduce((a, b) => a + b, 0);
    for (const n of later.sides) expect(n / total).toBeGreaterThan(0.15);
    await page.waitForFunction(
      (n) => (window.__fishbowl as unknown as TankHook).state().drawn > n + 2,
      later.drawn,
    );
    expect(await stageSpread(page)).toBeGreaterThan(BLANK_STDDEV);
    expect(problems).toEqual([]);
  });
});
