import { expect, type Page, test } from "@playwright/test";
import { watchPage } from "../scripts/lib/play.mjs";
import { BLANK_STDDEV, decodePng, pixelStats } from "../scripts/lib/png.mjs";

/**
 * The Reef theme in 3D: a person plays a table on a panel, rides the turtle ramp and fills the
 * clam with three pearls for the jackpot and its pearl balls; the deck's reef skin runs on a
 * screen with a burst of balls; and the wall runs its tables and band on one context.
 */

interface TableState {
  ctrl: string;
  waiting: boolean;
  held: number;
  /** World seconds of the table's last shake. */
  shakeAt: number | null;
  score: number;
  balls: { id: number; x: number; y: number }[];
  flippers: { name: string; held: boolean }[];
}

interface PbState {
  view: string;
  tables: TableState[];
  band?: { slots: { playing: boolean }[] } | null;
  balls?: unknown[];
}

interface ReefMiddle {
  clam: { x: number; y: number; side: number };
  ramp: { mouth: { x: number; y: number }; dir: { x: number; y: number } };
}

/** The debug hook, typed here rather than on Window, which pinball.spec.ts types its own way. */
interface PbWindow {
  __pinball?: {
    state(): PbState;
    place(h: number, x: number, y: number, vx?: number, vy?: number): boolean;
    middle(h?: number): ReefMiddle | null;
    burst?(n: number): void;
  };
}

/** A WebGL canvas is on the stage and the stage isn't blank. */
const drawsIn3D = async (page: Page) => {
  const gl = await page.evaluate(() => document.querySelectorAll("canvas[data-engine]").length);
  expect(gl, "a WebGL canvas").toBeGreaterThan(0);
  const shot = await page.locator(".hc-stage").screenshot();
  expect(pixelStats(decodePng(shot)).stddev).toBeGreaterThan(BLANK_STDDEV);
};

test.describe("pinball reef on a panel", () => {
  const PANEL =
    "play/?app=pinball&variant=reef&kind=panel&fit=1080x1920&bots=0&seed=e2e&debug=1&o.grab=0";
  const state = (page: Page) =>
    page.evaluate(() => (window as unknown as PbWindow).__pinball!.state().tables[0]!);
  const touchAt = (page: Page, type: string, x: number, y: number, id: number) =>
    page.evaluate(
      ([type, x, y, id]) => {
        const stage = document.querySelector<HTMLElement>(".hc-stage")!;
        const r = stage.getBoundingClientRect();
        const s = r.width / 1080;
        const cx = r.left + x * s;
        const cy = r.top + y * s;
        (document.elementFromPoint(cx, cy) ?? stage).dispatchEvent(
          new PointerEvent(type, {
            clientX: cx,
            clientY: cy,
            pointerId: id,
            pointerType: "touch",
            bubbles: true,
            isPrimary: true,
          }),
        );
      },
      [type, x, y, id] as const,
    );

  test("draws in 3D, a person plays, rides the turtle ramp and fills the clam for a jackpot", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const problems = watchPage(page);
    await page.setViewportSize({ width: 540, height: 960 });
    await page.goto(PANEL);
    await page.waitForFunction(() => (window as unknown as PbWindow).__pinball !== undefined);
    expect(await page.evaluate(() => (window as unknown as PbWindow).__pinball!.state().view)).toBe(
      "3d",
    );
    expect((await state(page)).ctrl).toBe("attract");
    await page.waitForTimeout(1500);
    await drawsIn3D(page);
    // The first touch takes the table; the plunger launches the ball; the pads work flippers.
    await touchAt(page, "pointerdown", 300, 1500, 11);
    await touchAt(page, "pointerup", 300, 1500, 11);
    await expect.poll(async () => (await state(page)).ctrl).toBe("human");
    await expect.poll(async () => (await state(page)).waiting).toBe(true);
    await touchAt(page, "pointerdown", 980, 1800, 12);
    await page.waitForTimeout(500);
    await touchAt(page, "pointerup", 980, 1800, 12);
    await expect.poll(async () => (await state(page)).waiting).toBe(false);
    await touchAt(page, "pointerdown", 200, 1500, 13);
    await touchAt(page, "pointerdown", 1000, 600, 14);
    await expect
      .poll(async () => (await state(page)).flippers.filter((f) => f.held).map((f) => f.name))
      .toEqual(["left", "upRight"]);
    await touchAt(page, "pointerup", 200, 1500, 13);
    await touchAt(page, "pointerup", 1000, 600, 14);

    // A fast ball up the ramp's mouth rides the ramp (held by it), and pays when it comes off.
    const rideFrom = (await state(page)).score;
    await page.evaluate(() => {
      const pb = (window as unknown as PbWindow).__pinball!;
      const { mouth, dir } = pb.middle(0)!.ramp;
      pb.place(0, mouth.x - dir.x * 40, mouth.y - dir.y * 40, dir.x * 1100, dir.y * 1100);
    });
    await page.waitForFunction(
      () => (window as unknown as PbWindow).__pinball!.state().tables[0]!.held > 0,
      undefined,
      { polling: 30, timeout: 5_000 },
    );
    await expect
      .poll(async () => (await state(page)).score - rideFrom)
      .toBeGreaterThanOrEqual(2000);

    // Balls rolled into the clam until the third pearl's jackpot (the only thing that shakes a
    // reef table), fed while its shell is open and it holds nothing. The page watches for the
    // jackpot and then for the two pearl balls that follow its ball out.
    const score = (await state(page)).score;
    const shook = (await state(page)).shakeAt;
    const pearls = page.evaluate(async (before) => {
      const pb = (window as unknown as PbWindow).__pinball!;
      const table = () => pb.state().tables[0]!;
      const sleep = () => new Promise((r) => setTimeout(r, 15));
      const t0 = performance.now();
      while (performance.now() - t0 < 80_000 && table().shakeAt === before) await sleep();
      const seen = new Set(table().balls.map((b) => b.id));
      const fresh = new Set<number>();
      const until = performance.now() + 3000;
      while (performance.now() < until && fresh.size < 2) {
        for (const b of table().balls) if (!seen.has(b.id)) fresh.add(b.id);
        await sleep();
      }
      return fresh.size;
    }, shook);
    const feed = () =>
      page.evaluate(() => {
        const pb = (window as unknown as PbWindow).__pinball!;
        const c = pb.middle(0)!.clam as ReefMiddle["clam"] & { shell: { on: boolean } };
        if (pb.state().tables[0]!.held === 0 && !c.shell.on) {
          pb.place(0, c.x - c.side * 20, c.y + 10, 0, 0);
        }
      });
    await expect
      .poll(
        async () => {
          if ((await state(page)).shakeAt !== shook) return true;
          await feed();
          return false;
        },
        { timeout: 75_000, intervals: [400] },
      )
      .toBe(true);
    expect(await pearls).toBe(2);
    expect((await state(page)).score - score).toBeGreaterThanOrEqual(7500);
    await drawsIn3D(page);
    expect(problems).toEqual([]);
  });
});

test.describe("pinball reef deck", () => {
  test("runs the reef deck on a screen with a burst of balls", async ({ page }) => {
    test.setTimeout(60_000);
    const problems = watchPage(page);
    await page.setViewportSize({ width: 1053, height: 960 });
    await page.goto(
      "play/?app=pinball&variant=reef&kind=screen&fit=4000x3600&res=0.5&seed=e2e&debug=1&bots=2",
    );
    await page.waitForFunction(() => (window as unknown as PbWindow).__pinball !== undefined);
    expect(await page.evaluate(() => (window as unknown as PbWindow).__pinball!.state().view)).toBe(
      "3d",
    );
    await page.evaluate(() => (window as unknown as PbWindow).__pinball!.burst!(24));
    await expect
      .poll(async () =>
        page.evaluate(() => (window as unknown as PbWindow).__pinball!.state().balls?.length ?? 0),
      )
      .toBeGreaterThan(10);
    await page.waitForTimeout(1500);
    await drawsIn3D(page);
    expect(problems).toEqual([]);
  });

  test("runs the wall's tables and band in 3D on one context", async ({ page }) => {
    test.setTimeout(90_000);
    const problems = watchPage(page);
    await page.setViewportSize({ width: 1296, height: 486 });
    await page.goto(
      "play/?app=pinball&variant=reef&kind=wall&fit=5760x2160&res=0.25&seed=e2e&debug=1&bots=5",
    );
    await page.waitForFunction(() => (window as unknown as PbWindow).__pinball !== undefined);
    const wall = () =>
      page.evaluate(() => (window as unknown as PbWindow).__pinball!.state() as PbState);
    expect((await wall()).view).toBe("3d");
    const contexts = await page.evaluate(
      () => document.querySelectorAll("canvas[data-engine]").length,
    );
    expect(contexts).toBe(1);
    await expect
      .poll(async () => (await wall()).band!.slots.every((s) => s.playing), { timeout: 20_000 })
      .toBe(true);
    await page.evaluate(() => (window as unknown as PbWindow).__pinball!.burst!(10));
    await page.waitForTimeout(2000);
    await drawsIn3D(page);
    expect(problems).toEqual([]);
  });
});
