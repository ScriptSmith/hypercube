import { expect, type Page, test } from "@playwright/test";
import { watchPage } from "../scripts/lib/play.mjs";

/**
 * Touchdown on single frames: the autopilot handing over to people, engines on real pointer
 * events, hold-to-reset, idle, the admin terrain command and bots landing on a three-crew wall.
 */

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface CrewState {
  mode: "auto" | "people";
  phase: "flying" | "landed" | "bumped";
  run: number;
  runT: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: number;
  helping: 0 | 1 | null;
  ghost: boolean;
  terrain: number;
  thrust: { left: boolean; right: boolean; main: boolean; turnLeft: boolean; turnRight: boolean };
  counts: { runs: number; landings: number; bumps: number; stars: number };
}
interface TdState {
  unit: number;
  pads: { id: number; crew: number; role: string; rect: Rect }[];
  layout: { crews: { reset: { x: number; y: number; r: number } }[] };
  crews: CrewState[];
}

declare global {
  interface Window {
    __touchdown?: { state(): TdState; command(name: string): void };
  }
}

const SIZES: Record<"pair" | "wall" | "panel" | "kiosk", [number, number]> = {
  pair: [2160, 1920],
  wall: [5760, 2160],
  panel: [1080, 1920],
  kiosk: [1920, 1080],
};

const open = async (
  page: Page,
  kind: keyof typeof SIZES,
  params: Record<string, string | number> = {},
) => {
  const [w, h] = SIZES[kind];
  const scale = Math.min(1000 / w, 800 / h);
  await page.setViewportSize({ width: Math.round(w * scale), height: Math.round(h * scale) });
  const q = new URLSearchParams({
    app: "touchdown",
    kind,
    fit: `${w}x${h}`,
    bots: "0",
    seed: "e2e",
    debug: "1",
  });
  for (const [k, v] of Object.entries(params)) q.set(k, String(v));
  await page.goto(`play/?${q}`);
  await page.waitForFunction(() => window.__touchdown !== undefined, undefined, {
    timeout: 30_000,
  });
};

const state = (page: Page) => page.evaluate(() => window.__touchdown!.state());

/** A finger down at a venue point, as a real pointer event; returns its id. */
const down = (page: Page, at: { x: number; y: number }) =>
  page.evaluate((p) => {
    const st = window.__touchdown!.state();
    const stage = document.querySelector<HTMLElement>(".hc-stage")!;
    const r = stage.getBoundingClientRect();
    const k = st.unit * (r.width / stage.offsetWidth);
    const clientX = r.left + p.x * k;
    const clientY = r.top + p.y * k;
    const pointerId = 5000 + Math.floor(Math.random() * 4000);
    const target = document.elementFromPoint(clientX, clientY) ?? stage;
    target.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX,
        clientY,
        pointerId,
        pointerType: "touch",
        bubbles: true,
        isPrimary: true,
      }),
    );
    const w = window as unknown as Record<string, unknown>;
    w[`__tdFinger${pointerId}`] = { clientX, clientY, target };
    return pointerId;
  }, at);

const up = (page: Page, pointerId: number) =>
  page.evaluate((id) => {
    const w = window as unknown as Record<string, unknown>;
    const f = w[`__tdFinger${id}`] as { clientX: number; clientY: number; target: Element };
    f.target.dispatchEvent(
      new PointerEvent("pointerup", {
        clientX: f.clientX,
        clientY: f.clientY,
        pointerId: id,
        pointerType: "touch",
        bubbles: true,
      }),
    );
    delete w[`__tdFinger${id}`];
  }, pointerId);

const padCentre = async (page: Page, role: string, crew = 0) => {
  const pad = (await state(page)).pads.find((p) => p.role === role && p.crew === crew)!;
  return { x: pad.rect.x + pad.rect.width / 2, y: pad.rect.y + pad.rect.height / 2 };
};

test.describe("touchdown", () => {
  test.describe.configure({ timeout: 120_000 });

  test("the first touch hands over from the autopilot, and both engines lift", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "pair");
    expect((await state(page)).crews[0]!.mode).toBe("auto");
    const runs = (await state(page)).crews[0]!.run;
    const left = await down(page, await padCentre(page, "left"));
    const right = await down(page, await padCentre(page, "right"));
    const after = (await state(page)).crews[0]!;
    expect(after.mode).toBe("people");
    expect(after.run).toBe(runs + 1);
    await expect
      .poll(async () => (await state(page)).crews[0]!.vy, { timeout: 15_000 })
      .toBeLessThan(0);
    const c = (await state(page)).crews[0]!;
    expect(c.thrust.left && c.thrust.right).toBe(true);
    expect(Math.abs(c.a)).toBeLessThan(0.05);
    await up(page, left);
    await up(page, right);
    // Thrust follows the pads at the next simulation step.
    await expect.poll(async () => (await state(page)).crews[0]!.thrust.left).toBe(false);
    expect(problems).toEqual([]);
  });

  test("one engine alone turns the craft its way", async ({ page }) => {
    await open(page, "pair", { "o.assist": "off" });
    const left = await down(page, await padCentre(page, "left"));
    await expect
      .poll(async () => (await state(page)).crews[0]!.a, { timeout: 15_000 })
      .toBeGreaterThan(0.3);
    await up(page, left);
    await page.reload();
    await page.waitForFunction(() => window.__touchdown !== undefined);
    const right = await down(page, await padCentre(page, "right"));
    await expect
      .poll(async () => (await state(page)).crews[0]!.a, { timeout: 15_000 })
      .toBeLessThan(-0.3);
    await up(page, right);
  });

  test("a lone visitor gets the helper on the other engine", async ({ page }) => {
    await open(page, "panel");
    const left = await down(page, await padCentre(page, "left"));
    await expect
      .poll(async () => (await state(page)).crews[0]!.helping, { timeout: 20_000 })
      .toBe(1);
    const right = await down(page, await padCentre(page, "right"));
    await expect.poll(async () => (await state(page)).crews[0]!.helping).toBeNull();
    await up(page, left);
    await up(page, right);
  });

  test("the crew variant fires the main engine and the turn thrusters", async ({ page }) => {
    await open(page, "pair", { variant: "crew", "o.assist": "off" });
    const main = await down(page, await padCentre(page, "main"));
    await expect
      .poll(async () => (await state(page)).crews[0]!.vy, { timeout: 15_000 })
      .toBeLessThan(0);
    await up(page, main);
    const turn = await down(page, await padCentre(page, "turnRight"));
    await expect
      .poll(async () => (await state(page)).crews[0]!.a, { timeout: 15_000 })
      .toBeGreaterThan(0.3);
    await up(page, turn);
  });

  test("hold-to-reset starts a fresh run, admin makes new terrain, idle goes back to attract", async ({
    page,
  }) => {
    await open(page, "kiosk", { idle: 6 });
    const tap = await down(page, await padCentre(page, "left"));
    await up(page, tap);
    await page.waitForTimeout(1500);
    const before = (await state(page)).crews[0]!;
    expect(before.mode).toBe("people");
    const reset = (await state(page)).layout.crews[0]!.reset;
    const finger = await down(page, { x: reset.x, y: reset.y });
    await page.waitForTimeout(1400);
    await up(page, finger);
    const after = (await state(page)).crews[0]!;
    expect(after.run).toBe(before.run + 1);
    expect(after.terrain).toBe(before.terrain);
    expect(after.runT).toBeLessThan(1.4);

    await page.evaluate(() => window.__touchdown!.command("terrain"));
    expect((await state(page)).crews[0]!.terrain).toBeGreaterThan(after.terrain);

    await expect
      .poll(async () => (await state(page)).crews[0]!.mode, { timeout: 20_000 })
      .toBe("auto");
  });

  test("bots fly three crews on a wall and land", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "wall", { bots: 3, "o.crews": 3 });
    const st = await state(page);
    expect(st.crews).toHaveLength(3);
    expect(st.pads).toHaveLength(6);
    await expect
      .poll(async () => (await state(page)).crews.every((c) => c.mode === "people"), {
        timeout: 15_000,
      })
      .toBe(true);
    await expect
      .poll(async () => (await state(page)).crews.reduce((n, c) => n + c.counts.landings, 0), {
        timeout: 100_000,
        intervals: [2000],
      })
      .toBeGreaterThan(0);
    const status = await page.evaluate(() => window.__hypercube!.appStatus());
    expect(status.crews).toBe(3);
    expect(Number(status.landings)).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });
});

interface ScreenState {
  screen: true;
  count: number;
  demo: boolean;
  width: number;
  ships: { key: string; pos: number; attract: boolean; phase: string; x: number; y: number }[];
}

/** Evaluate in one sim frame. */
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

const screenState = (page: Page) =>
  inFrame(page, "a-screen", () => (window.__touchdown!.state() as unknown as ScreenState) ?? null);

/** Hold or let go of every engine pad on one sim frame, with real pointer events. */
const holdPads = (page: Page, id: string, on: boolean) =>
  inFrame(
    page,
    id,
    (press: boolean) => {
      const st = window.__touchdown!.state();
      const stage = document.querySelector<HTMLElement>(".hc-stage")!;
      const r = stage.getBoundingClientRect();
      const k = st.unit * (r.width / stage.offsetWidth);
      st.pads.forEach((pad, i) => {
        const clientX = r.left + (pad.rect.x + pad.rect.width / 2) * k;
        const clientY = r.top + (pad.rect.y + pad.rect.height / 2) * k;
        const target = document.elementFromPoint(clientX, clientY) ?? stage;
        target.dispatchEvent(
          new PointerEvent(press ? "pointerdown" : "pointerup", {
            clientX,
            clientY,
            pointerId: 9100 + i,
            pointerType: "touch",
            bubbles: true,
            isPrimary: i === 0,
          }),
        );
      });
    },
    on,
  );

test.describe("touchdown in a bank", () => {
  test.describe.configure({ timeout: 180_000 });

  test("touchdown: the screen shows a panel's craft in its column, and drops it when the panel goes", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(
      "sim/?preset=bank&count=4&span=1&app=touchdown&transport=local&bots=0&seed=e2e&debug=1&res=0.25",
    );
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const frames = [...document.querySelectorAll<HTMLElement>(".sim-frame[data-frame]")];
            const states = frames.map((el) => el.querySelector("iframe")?.contentWindow);
            const hubs = states.filter((w) => w?.__hypercube?.net?.isHub);
            return (
              frames.length === 5 &&
              states.every(
                (w) =>
                  w?.__hypercube?.phase === "running" &&
                  w.__hypercube.room === "online" &&
                  w.__touchdown !== undefined,
              ) &&
              hubs.length === 1
            );
          }),
        { timeout: 120_000, intervals: [500] },
      )
      .toBe(true);

    // Every panel's autopilot craft is on the screen, faint, and the screen flies none of its own.
    await expect
      .poll(async () => (await screenState(page)).ships.map((s) => s.pos).sort(), {
        timeout: 20_000,
      })
      .toEqual([0, 1, 2, 3]);
    let st = await screenState(page);
    expect(st.demo).toBe(false);
    expect(st.ships.every((s) => s.attract)).toBe(true);

    // People take the third panel's craft: it turns bright, still above that panel.
    await holdPads(page, "a-p3", true);
    await expect
      .poll(async () => (await screenState(page)).ships.find((s) => s.pos === 2)?.attract, {
        timeout: 10_000,
      })
      .toBe(false);
    st = await screenState(page);
    const third = st.ships.find((s) => s.pos === 2)!;
    expect(third.x).toBeGreaterThanOrEqual((2 / 4) * st.width);
    expect(third.x).toBeLessThanOrEqual((3 / 4) * st.width);
    expect(st.ships.filter((s) => s.pos !== 2).every((s) => s.attract)).toBe(true);
    // Both engines lift it on the panel, and the screen's copy climbs too.
    const y0 = third.y;
    await expect
      .poll(async () => (await screenState(page)).ships.find((s) => s.pos === 2)!.y, {
        timeout: 10_000,
      })
      .toBeLessThan(y0 - 5);
    await holdPads(page, "a-p3", false);

    // The panel goes: its craft leaves the screen within a few seconds; the others stay.
    await page.evaluate(() =>
      document.querySelector('.sim-frame[data-frame="a-p3"] iframe')?.remove(),
    );
    await expect
      .poll(async () => (await screenState(page)).ships.map((s) => s.pos).sort(), {
        timeout: 8_000,
        intervals: [250],
      })
      .toEqual([0, 1, 3]);
    expect((await screenState(page)).demo).toBe(false);
    expect(problems).toEqual([]);
  });
});
