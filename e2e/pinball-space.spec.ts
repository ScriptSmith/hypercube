import { expect, type Page, test } from "@playwright/test";
import { watchPage } from "../scripts/lib/play.mjs";
import { BLANK_STDDEV, decodePng, pixelStats } from "../scripts/lib/png.mjs";

/**
 * The Space theme in 3D: a person plays a table on a panel (first touch, plunger, flippers) and
 * fills the rocket for a multiball; a deck shot from a panel climbs onto a 3D screen in a small
 * bank and comes back down; and the wall runs its tables and band in 3D on one context.
 */

interface Ball {
  id: number;
  x: number;
  y: number;
  held: boolean;
}

interface TableState {
  ctrl: string;
  station: string;
  waiting: boolean;
  inPlay: number;
  held: number;
  /** World seconds of the table's last shake (null before any). */
  shakeAt: number | null;
  score: number;
  balls: Ball[];
  flippers: { name: string; held: boolean }[];
}

interface PbState {
  kind: string;
  view: string;
  deck: boolean;
  ups: { id: number; h: number; sent: boolean }[];
  downs: { id: number; h: number }[];
  tables: TableState[];
  band?: {
    arrivals: { ref: number; x: number }[];
    sent: { to: string; h: number; id: number; ref: number }[];
    slots: { h: number; chuteX: number; playing: boolean }[];
  } | null;
}

interface PbScreen {
  kind: "screen";
  view: string;
  arrivals: { from: string; ref: number; x: number }[];
  sent: { to: string; id: number; from: string; ref: number }[];
  slots: { frame: string | null; chuteX: number }[];
}

/** The debug hook, typed here rather than on Window, which pinball.spec.ts types its own way. */
interface PbWindow {
  __pinball?: {
    state(): PbState | PbScreen;
    shoot(h?: number): boolean;
    place(h: number, x: number, y: number, vx?: number, vy?: number): boolean;
    middle(h?: number): { pad: { x: number; y: number } } | null;
  };
}

/** A WebGL canvas is on the stage and the stage isn't blank. */
const drawsIn3D = async (page: Page) => {
  // three.js marks its canvases; asking a canvas for a context would make one.
  const gl = await page.evaluate(() => document.querySelectorAll("canvas[data-engine]").length);
  expect(gl, "a WebGL canvas").toBeGreaterThan(0);
  const shot = await page.locator(".hc-stage").screenshot();
  expect(pixelStats(decodePng(shot)).stddev).toBeGreaterThan(BLANK_STDDEV);
};

test.describe("pinball space on a panel", () => {
  const PANEL =
    "play/?app=pinball&variant=space&kind=panel&fit=1080x1920&bots=0&seed=e2e&debug=1&o.grab=0";
  const state = (page: Page) =>
    page.evaluate(() => ((window as unknown as PbWindow).__pinball!.state() as PbState).tables[0]!);
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

  test("draws in 3D, a person plays, and three balls in the rocket lift off as a multiball", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const problems = watchPage(page);
    await page.setViewportSize({ width: 540, height: 960 });
    await page.goto(PANEL);
    await page.waitForFunction(() => (window as unknown as PbWindow).__pinball !== undefined);
    expect(
      (await page.evaluate(() => (window as unknown as PbWindow).__pinball!.state() as PbState))
        .view,
    ).toBe("3d");
    expect((await state(page)).ctrl).toBe("attract");
    await page.waitForTimeout(1500);
    await drawsIn3D(page);
    // The first touch takes the table; the plunger launches the ball.
    await touchAt(page, "pointerdown", 300, 1500, 11);
    await touchAt(page, "pointerup", 300, 1500, 11);
    await expect.poll(async () => (await state(page)).ctrl).toBe("human");
    await expect.poll(async () => (await state(page)).waiting).toBe(true);
    await touchAt(page, "pointerdown", 980, 1800, 12);
    await page.waitForTimeout(500);
    await touchAt(page, "pointerup", 980, 1800, 12);
    await expect.poll(async () => (await state(page)).waiting).toBe(false);
    // Each pad works its flipper while held.
    await touchAt(page, "pointerdown", 200, 1500, 13);
    await touchAt(page, "pointerdown", 1000, 600, 14);
    await expect
      .poll(async () => (await state(page)).flippers.filter((f) => f.held).map((f) => f.name))
      .toEqual(["left", "upRight"]);
    await touchAt(page, "pointerup", 200, 1500, 13);
    await touchAt(page, "pointerup", 1000, 600, 14);
    // Balls rolled into the launch pad until the rocket lifts off (the only thing that shakes a
    // Space table). Fed again and again: if the player's ball drains while one is locked, the
    // lock lets it go and closes for a moment, but keeps its count.
    const score = (await state(page)).score;
    const shook = (await state(page)).shakeAt;
    const feed = () =>
      page.evaluate(() => {
        const pb = (window as unknown as PbWindow).__pinball!;
        const m = pb.middle(0)!;
        pb.place(0, m.pad.x, m.pad.y + 30, 0, -150);
      });
    await expect
      .poll(
        async () => {
          if ((await state(page)).shakeAt !== shook) return true;
          await feed();
          return false;
        },
        { timeout: 40_000, intervals: [700] },
      )
      .toBe(true);
    // Watched in the page, since a multiball's balls can drain between two polls from here.
    await page.waitForFunction(
      () =>
        ((window as unknown as PbWindow).__pinball!.state() as PbState).tables[0]!.balls.length >=
        3,
      undefined,
      { polling: 50, timeout: 20_000 },
    );
    expect((await state(page)).score - score).toBeGreaterThanOrEqual(5000);
    await drawsIn3D(page);
    expect(problems).toEqual([]);
  });
});

test.describe("pinball space in a bank", () => {
  test.describe.configure({ timeout: 240_000 });

  const inFrame = <T, A>(page: Page, id: string, fn: (arg: A) => T, arg?: A): Promise<T> =>
    page.evaluate(
      ([frameId, src, a]) => {
        const w = document.querySelector<HTMLIFrameElement>(
          `.sim-frame[data-frame="${frameId}"] iframe`,
        )?.contentWindow as (Window & typeof globalThis) | null;
        if (!w) throw new Error(`no frame ${frameId}`);
        return new w.Function("arg", `return (${src})(arg)`)(a) as T;
      },
      [id, fn.toString(), arg] as const,
    );

  test("a deck shot climbs from a panel onto the 3D screen and comes back down", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(
      "sim/?preset=bank&count=3&app=pinball&variant=space&transport=local&seed=e2e&debug=1&res=0.25&bots=3",
    );
    await page.waitForFunction(() => window.__hypercubeSim !== undefined);
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const frames = [...document.querySelectorAll<HTMLElement>(".sim-frame[data-frame]")];
            const states = frames.map(
              (el) => el.querySelector("iframe")?.contentWindow?.__hypercube,
            );
            return (
              frames.length === 4 &&
              states.every((s) => s?.phase === "running" && s.room === "online")
            );
          }),
        { timeout: 90_000, intervals: [500] },
      )
      .toBe(true);
    const table = (id: string) =>
      inFrame(page, id, () =>
        (window as unknown as PbWindow).__pinball!.state(),
      ) as Promise<PbState>;
    const screen = () =>
      inFrame(page, "a-screen", () =>
        (window as unknown as PbWindow).__pinball!.state(),
      ) as Promise<PbScreen>;
    await expect.poll(async () => (await table("a-p2")).deck, { timeout: 30_000 }).toBe(true);
    expect((await table("a-p2")).view).toBe("3d");
    expect((await screen()).view).toBe("3d");
    const before = (await table("a-p2")).ups.length;
    await inFrame(page, "a-p2", () => (window as unknown as PbWindow).__pinball!.shoot(0));
    let id = 0;
    await expect
      .poll(async () => {
        id = (await table("a-p2")).ups.slice(before).find((u) => u.sent)?.id ?? 0;
        return id;
      })
      .toBeGreaterThan(0);
    await expect
      .poll(async () => {
        const s = await screen();
        const a = s.arrivals.find((x) => x.from === "a-p2" && x.ref === id);
        const slot = s.slots.find((x) => x.frame === "a-p2");
        return a && slot ? Math.abs(a.x - slot.chuteX) : -1;
      })
      .toBeGreaterThanOrEqual(0);
    const s0 = await screen();
    const arrival = s0.arrivals.find((x) => x.from === "a-p2" && x.ref === id)!;
    expect(Math.abs(arrival.x - s0.slots.find((x) => x.frame === "a-p2")!.chuteX)).toBeLessThan(1);
    let sent: PbScreen["sent"][number] | undefined;
    await expect
      .poll(
        async () => {
          sent = (await screen()).sent.find((x) => x.from === "a-p2" && x.ref === id);
          return sent !== undefined;
        },
        { timeout: 60_000 },
      )
      .toBe(true);
    await expect
      .poll(async () => (await table(sent!.to)).downs.some((d) => d.id === sent!.id), {
        timeout: 15_000,
      })
      .toBe(true);
    expect.soft(problems).toEqual([]);
  });
});

test.describe("pinball space on a wall", () => {
  test.describe.configure({ timeout: 180_000 });

  test("runs its tables and the band in 3D, and a deck shot goes up and comes down", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await page.setViewportSize({ width: 1296, height: 486 });
    await page.goto(
      "play/?app=pinball&variant=space&kind=wall&fit=5760x2160&res=0.25&seed=e2e&debug=1&bots=5",
    );
    await page.waitForFunction(() => (window as unknown as PbWindow).__pinball !== undefined);
    const wall = () =>
      page.evaluate(() => (window as unknown as PbWindow).__pinball!.state() as PbState);
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
    await page.evaluate(() => (window as unknown as PbWindow).__pinball!.shoot(2));
    let id = 0;
    await expect
      .poll(async () => {
        id = (await wall()).ups.slice(before).find((u) => u.sent && u.h === 2)?.id ?? 0;
        return id;
      })
      .toBeGreaterThan(0);
    await expect
      .poll(async () => {
        const b = (await wall()).band!;
        const a = b.arrivals.find((x) => x.ref === id);
        return a ? Math.abs(a.x - b.slots[2]!.chuteX) : -1;
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
