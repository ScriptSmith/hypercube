import { expect, type Page, test } from "@playwright/test";
import { watchPage } from "../scripts/lib/play.mjs";
import { BLANK_STDDEV, decodePng, pixelStats } from "../scripts/lib/png.mjs";

/**
 * The Fun fair theme in 3D: a person plays a table on a panel, the cannon fires a draining ball
 * back up, a ball rides the Ferris wheel and the big wheel brings two guests for a multiball;
 * and the wall runs its tables and band in 3D on one context, with a deck shot up and down.
 */

interface Ball {
  id: number;
  x: number;
  y: number;
  held: boolean;
}

interface TableState {
  ctrl: string;
  mode: string;
  waiting: boolean;
  inPlay: number;
  held: number;
  shakeAt: number | null;
  score: number;
  balls: Ball[];
  flippers: { name: string; held: boolean }[];
}

interface PbState {
  view: string;
  ups: { id: number; h: number; sent: boolean }[];
  downs: { id: number; h: number }[];
  tables: TableState[];
  band?: {
    arrivals: { ref: number; x: number }[];
    sent: { to: string; h: number; id: number; ref: number }[];
    slots: { h: number; chuteX: number; playing: boolean }[];
  } | null;
}

interface Middle {
  wheel: { station: { x: number; y: number } };
  cannon: { x: number; y: number };
}

/** The debug hook, typed here rather than on Window, which pinball.spec.ts types its own way. */
interface PbWindow {
  __pinball?: {
    state(): PbState;
    shoot(h?: number): boolean;
    place(h: number, x: number, y: number, vx?: number, vy?: number): boolean;
    middle(h?: number): Middle | null;
  };
}

/** A WebGL canvas is on the stage and the stage isn't blank. */
const drawsIn3D = async (page: Page) => {
  const gl = await page.evaluate(() => document.querySelectorAll("canvas[data-engine]").length);
  expect(gl, "a WebGL canvas").toBeGreaterThan(0);
  const shot = await page.locator(".hc-stage").screenshot();
  expect(pixelStats(decodePng(shot)).stddev).toBeGreaterThan(BLANK_STDDEV);
};

test.describe("pinball fair on a panel", () => {
  const PANEL =
    "play/?app=pinball&variant=fair&kind=panel&fit=1080x1920&bots=0&seed=e2e&debug=1&o.grab=0";
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

  test("draws in 3D, a person plays, the cannon fires, and the big wheel brings a multiball", async ({
    page,
  }) => {
    test.setTimeout(150_000);
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
    // The first touch takes the table: a new game, with the cannon lit.
    await touchAt(page, "pointerdown", 300, 1500, 11);
    await touchAt(page, "pointerup", 300, 1500, 11);
    await expect.poll(async () => (await state(page)).ctrl).toBe("human");
    await expect.poll(async () => (await state(page)).waiting).toBe(true);

    // A ball down the left outlane: the cannon catches it, fires it (shaking the table a
    // little) and it is back in play up the table.
    const shook = (await state(page)).shakeAt;
    await page.evaluate(() => {
      const pb = (window as unknown as PbWindow).__pinball!;
      const m = pb.middle(0)!;
      pb.place(0, m.cannon.x, m.cannon.y - 150, 0, 800);
    });
    await expect.poll(async () => (await state(page)).held, { timeout: 5_000 }).toBe(1);
    await expect.poll(async () => (await state(page)).shakeAt, { timeout: 10_000 }).not.toBe(shook);
    await expect.poll(async () => (await state(page)).held, { timeout: 10_000 }).toBe(0);
    expect((await state(page)).mode).toBe("play");

    // The plunger launches the waiting ball; each pad works its flipper while held.
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

    // Balls rolled into the wheel's station, one at a time, until the big wheel's guests land:
    // with at most two other balls about when each is fed, four free balls means guests.
    const score = (await state(page)).score;
    await page.evaluate(() => {
      const pb = (window as unknown as PbWindow).__pinball!;
      const m = pb.middle(0)!;
      const w = window as unknown as { __fairFeed?: number };
      w.__fairFeed = window.setInterval(() => {
        const t = pb.state().tables[0]!;
        if (t.held === 0 && t.balls.length <= 2) {
          pb.place(0, m.wheel.station.x, m.wheel.station.y + 40, 0, -200);
        }
      }, 250);
    });
    await page.waitForFunction(
      () =>
        (window as unknown as PbWindow).__pinball!.state().tables[0]!.balls.filter((b) => !b.held)
          .length >= 4,
      undefined,
      { polling: 50, timeout: 90_000 },
    );
    await page.evaluate(() =>
      window.clearInterval((window as unknown as { __fairFeed?: number }).__fairFeed),
    );
    // Four rides (1,000 each) and the big wheel (5,000) at least.
    expect((await state(page)).score - score).toBeGreaterThanOrEqual(9000);
    await drawsIn3D(page);
    expect(problems).toEqual([]);
  });
});

test.describe("pinball fair on a wall", () => {
  test.describe.configure({ timeout: 180_000 });

  test("runs its tables and the band in 3D, and a deck shot goes up and comes down", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await page.setViewportSize({ width: 1296, height: 486 });
    await page.goto(
      "play/?app=pinball&variant=fair&kind=wall&fit=5760x2160&res=0.25&seed=e2e&debug=1&bots=5",
    );
    await page.waitForFunction(() => (window as unknown as PbWindow).__pinball !== undefined);
    const wall = () => page.evaluate(() => (window as unknown as PbWindow).__pinball!.state());
    expect((await wall()).view).toBe("3d");
    // One WebGL context for the tables and the band.
    const contexts = await page.evaluate(
      () => document.querySelectorAll("canvas[data-engine]").length,
    );
    expect(contexts).toBe(1);
    await expect
      .poll(async () => (await wall()).band!.slots.every((s) => s.playing), { timeout: 20_000 })
      .toBe(true);
    await drawsIn3D(page);
    const before = (await wall()).ups.length;
    await page.evaluate(() => (window as unknown as PbWindow).__pinball!.shoot(1));
    let id = 0;
    await expect
      .poll(async () => {
        id = (await wall()).ups.slice(before).find((u) => u.sent && u.h === 1)?.id ?? 0;
        return id;
      })
      .toBeGreaterThan(0);
    await expect
      .poll(async () => {
        const b = (await wall()).band!;
        const a = b.arrivals.find((x) => x.ref === id);
        return a ? Math.abs(a.x - b.slots[1]!.chuteX) : -1;
      })
      .toBeGreaterThanOrEqual(0);
    let sent: { h: number; id: number } | undefined;
    await expect
      .poll(
        async () => {
          sent = (await wall()).band!.sent.find((x) => x.ref === id);
          return sent !== undefined;
        },
        // Software rendering of a whole 3D wall under load can run the deck slower than real time.
        { timeout: 90_000 },
      )
      .toBe(true);
    await expect
      .poll(async () => (await wall()).downs.some((d) => d.id === sent!.id && d.h === sent!.h), {
        timeout: 15_000,
      })
      .toBe(true);
    expect.soft(problems).toEqual([]);
  });
});
