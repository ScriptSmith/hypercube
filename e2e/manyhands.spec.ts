import { expect, type Page, test } from "@playwright/test";
import { watchPage } from "../scripts/lib/play.mjs";

/**
 * Many Hands with real pointer events: a person taking a slot from the ghost, every task done
 * through injected touches, the admin finish and idle on a wall, and a bank in the simulator
 * (parts flying from their panel to the screen with extra delay, pairs as two columns, panels
 * falling back to their own builds and returning to the screen). Headless rendering is slow
 * and the simulator runs every frame in one process, so timings here are generous.
 */

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface SlotState {
  station: number;
  band: "low" | "high";
  task: string;
  phase: string;
  who: string;
  progress: number;
  made: number;
  rect: Box;
  reset: { x: number; y: number; r: number };
}
interface BuildState {
  id: number;
  theme: string;
  phase: string;
  total: number;
  made: number;
  filled: number;
  people: number;
  bots: number;
  trophies: number;
}
interface MhState {
  screen: boolean;
  mode: string;
  modeAt: number;
  width: number;
  height: number;
  slots: SlotState[];
  build: BuildState | null;
  remote: { id: number } | null;
  sent: { i: number; t: number; at: number }[];
  counts: { person: number; bot: number; ghost: number };
  // Screen only.
  columns?: number;
  span?: number;
  arrivals?: { id: number; frame: string; late: number; column: number; slot: number }[];
  coming?: { slot: number; column: number; startX: number }[];
}

declare global {
  interface Window {
    __manyhands?: {
      state(): MhState;
      setLag(ms: number): void;
      deal(i: number, id: string): void;
      target(i: number): { x: number; y: number } | null;
      command(name: string): void;
    };
  }
}

const LOW = ["pop", "pump", "hold", "catch", "sort"];
const HIGH = ["crank", "plug", "repeat", "gauge", "count"];

const openPlay = async (page: Page, kind: "panel" | "pair" | "wall", query: string) => {
  const size = { panel: [1080, 1920], pair: [2160, 1920], wall: [5760, 2160] }[kind];
  const scale = Math.min(1280 / size[0]!, 960 / size[1]!);
  await page.setViewportSize({
    width: Math.round(size[0]! * scale),
    height: Math.round(size[1]! * scale),
  });
  await page.goto(
    `play/?app=manyhands&kind=${kind}&fit=${size[0]}x${size[1]}&seed=e2e&debug=1&${query}`,
  );
  await page.waitForFunction(() => window.__manyhands !== undefined, null, { timeout: 30_000 });
};

const state = (page: Page) => page.evaluate(() => window.__manyhands!.state());

/** Fingers (venue px) on the page's stage as real touch pointer events, held for `ms`. */
const press = (page: Page, points: { x: number; y: number }[], ms = 90) =>
  page.evaluate(
    async ({ pts, ms: hold }) => {
      const stage = document.querySelector<HTMLElement>(".hc-stage")!;
      const r = stage.getBoundingClientRect();
      const scale = (window.__hypercube?.frame?.unit ?? 1) * (r.width / stage.offsetWidth);
      const ids = pts.map((_, i) => 9000 + i + Math.floor(Math.random() * 500) * 4);
      const fire = (type: string, p: { x: number; y: number }, pointerId: number) => {
        const clientX = r.left + p.x * scale;
        const clientY = r.top + p.y * scale;
        (document.elementFromPoint(clientX, clientY) ?? stage).dispatchEvent(
          new PointerEvent(type, {
            clientX,
            clientY,
            pointerId,
            pointerType: "touch",
            bubbles: true,
            isPrimary: pointerId === ids[0],
            buttons: type === "pointerup" ? 0 : 1,
          }),
        );
      };
      pts.forEach((p, i) => fire("pointerdown", p, ids[i]!));
      await new Promise((res) => setTimeout(res, hold));
      pts.forEach((p, i) => fire("pointerup", p, ids[i]!));
    },
    { pts: points, ms },
  );

test.describe("many hands on its own", () => {
  test.describe.configure({ timeout: 150_000 });

  test("a person takes a slot from the ghost and their part flies into the build", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openPlay(page, "panel", "bots=0");
    await expect.poll(async () => (await state(page)).slots[0]?.who).toBe("ghost");
    await page.evaluate(() => window.__manyhands!.deal(0, "pump"));
    await expect.poll(async () => (await state(page)).slots[0]?.phase).toBe("play");
    const handle = await page.evaluate(() => window.__manyhands!.target(0));
    expect(handle).not.toBeNull();
    for (let i = 0; i < 8; i++) {
      await press(page, [handle!], 80);
      await page.waitForTimeout(200);
      if (i === 0) expect((await state(page)).slots[0]?.who, "the ghost lets go").toBe("person");
    }
    await expect.poll(async () => (await state(page)).counts.person).toBe(1);
    await expect.poll(async () => (await state(page)).build?.people, { timeout: 15_000 }).toBe(1);
    await expect
      .poll(async () => (await state(page)).slots[0]?.task, { message: "the next task differs" })
      .not.toBe("pump");
    const s = await state(page);
    expect(s.build!.bots).toBe(0);
    expect.soft(problems).toEqual([]);
  });

  test("every task completes through injected touches", async ({ page }) => {
    const problems = watchPage(page);
    await openPlay(page, "panel", "bots=2");
    for (let k = 0; k < LOW.length; k++) {
      const before = await state(page);
      const made = [before.slots[0]!.made, before.slots[1]!.made];
      await page.evaluate(
        ([low, high]) => {
          window.__manyhands!.deal(0, low!);
          window.__manyhands!.deal(1, high!);
        },
        [LOW[k]!, HIGH[k]!],
      );
      await expect
        .poll(
          async () => {
            const s = await state(page);
            return [s.slots[0]!.made > made[0]!, s.slots[1]!.made > made[1]!];
          },
          { timeout: 40_000, message: `${LOW[k]} and ${HIGH[k]}` },
        )
        .toEqual([true, true]);
    }
    const s = await state(page);
    expect(s.counts.bot).toBeGreaterThanOrEqual(10);
    expect.soft(problems).toEqual([]);
  });

  test("the reset control deals a new task", async ({ page }) => {
    await openPlay(page, "panel", "bots=0");
    await page.evaluate(() => window.__manyhands!.deal(1, "gauge"));
    await expect.poll(async () => (await state(page)).slots[1]?.phase).toBe("play");
    const r = (await state(page)).slots[1]!.reset;
    await press(page, [{ x: r.x, y: r.y }], 1300);
    await expect.poll(async () => (await state(page)).slots[1]?.task).not.toBe("gauge");
    expect((await state(page)).slots[1]?.who).toBe("person");
  });

  test("admin finishes a wall's build, early builds earn trophies, and idle clears them", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openPlay(page, "wall", "bots=12&o.round=300&idle=8");
    const first = (await state(page)).build!;
    await page.evaluate(() => window.__manyhands!.command("next"));
    await expect
      .poll(async () => (await state(page)).build?.phase, { timeout: 8000 })
      .toBe("alive");
    expect((await state(page)).build!.id).toBe(first.id);
    // Twelve bots finish the next build long before its five minutes are up.
    await expect
      .poll(async () => (await state(page)).build?.trophies, { timeout: 100_000 })
      .toBeGreaterThanOrEqual(1);
    const built = (await state(page)).build!;
    expect(built.bots).toBeGreaterThan(0);
    // A real touch on the build area, then idle: the trophy row clears, the build carries on.
    await press(page, [{ x: 2880, y: 400 }], 60);
    await expect.poll(async () => (await state(page)).build?.trophies, { timeout: 20_000 }).toBe(0);
    expect((await state(page)).build!.id).toBeGreaterThanOrEqual(built.id);
    expect.soft(problems).toEqual([]);
  });
});

// ---- The simulator ------------------------------------------------------------------------

const SETTLE_MS = 90_000;

const openSim = async (page: Page, preset: string, query = "") => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(
    `sim/?preset=${preset}&app=manyhands&transport=local&seed=e2e&debug=1&res=0.25&${query}`,
  );
  await page.waitForFunction(() => window.__hypercubeSim !== undefined);
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const frames = [...document.querySelectorAll<HTMLElement>(".sim-frame[data-frame]")];
          const states = frames.map((el) => el.querySelector("iframe")?.contentWindow?.__hypercube);
          const hubs = states.filter((s) => s?.net?.isHub);
          return (
            states.every((s) => s?.phase === "running" && s.room === "online") &&
            hubs.length === 1 &&
            hubs[0]?.net?.roster().length === frames.length
          );
        }),
      { timeout: SETTLE_MS, intervals: [500] },
    )
    .toBe(true);
};

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

const frameState = (page: Page, id: string) => inFrame(page, id, () => window.__manyhands!.state());

test.describe("many hands in the simulator", () => {
  test.describe.configure({ timeout: 180_000 });

  test("parts fly from their panel onto the screen, with 300 ms of extra delay", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openSim(page, "bank-panels", "bots=1");
    const panels = Array.from({ length: 6 }, (_, i) => `a-p${i + 1}`);
    for (const id of panels) {
      await inFrame(page, id, (ms: number) => window.__manyhands!.setLag(ms), 300);
    }
    await expect
      .poll(async () => (await frameState(page, "a-p4")).mode, { timeout: 20_000 })
      .toBe("screen");
    const since = Date.now();
    let arrival: NonNullable<MhState["arrivals"]>[number] | undefined;
    let startX = -1;
    await expect
      .poll(
        async () => {
          const p4 = await frameState(page, "a-p4");
          const ids = new Set(p4.sent.filter((s) => s.at >= since).map((s) => s.i));
          const scr = await frameState(page, "a-screen");
          arrival = scr.arrivals?.find((a) => ids.has(a.id));
          const coming = scr.coming?.find((c) => c.column === 3);
          if (coming) startX = coming.startX / scr.width;
          return arrival !== undefined && startX >= 0;
        },
        { timeout: 40_000 },
      )
      .toBe(true);
    test.info().annotations.push({
      type: "arrival",
      description: `${(-arrival!.late).toFixed(0)} ms before the part left the panel's top edge`,
    });
    // The screen had the part before it left the panel, so it flies on from the bottom edge.
    expect
      .soft(arrival!.late, "the part reached the screen before it left the panel")
      .toBeLessThan(0);
    expect(arrival!.column).toBe(3);
    // It sets off right above the fourth panel.
    expect(startX).toBeGreaterThan(3 / 6);
    expect(startX).toBeLessThan(4 / 6);
    const scr = await frameState(page, "a-screen");
    expect(scr.columns).toBe(6);
    expect(scr.build!.bots).toBeGreaterThan(0);
    expect.soft(problems).toEqual([]);
  });

  test("each half of a pair is its own column", async ({ page }) => {
    const problems = watchPage(page);
    await openSim(page, "bank-pairs", "bots=2");
    await expect
      .poll(
        async () => {
          const scr = await frameState(page, "a-screen");
          const cols = new Set(
            (scr.arrivals ?? []).filter((a) => a.frame === "a-pair2").map((a) => a.column),
          );
          return [scr.span, scr.columns, cols.has(2), cols.has(3)];
        },
        { timeout: 60_000 },
      )
      .toEqual([2, 6, true, true]);
    const pair = await frameState(page, "a-pair2");
    expect(pair.mode).toBe("screen");
    expect(pair.slots.filter((s) => s.who === "bot")).toHaveLength(2);
    expect(new Set(pair.slots.filter((s) => s.who === "bot").map((s) => s.station))).toEqual(
      new Set([0, 1]),
    );
    expect.soft(problems).toEqual([]);
  });

  test("panels make their own builds when the screen goes, and go back when it returns", async ({
    page,
  }) => {
    await openSim(page, "bank-panels", "bots=1");
    for (const id of ["a-p1", "a-p5", "a-p6"]) {
      await expect
        .poll(async () => (await frameState(page, id)).mode, { timeout: 20_000 })
        .toBe("screen");
    }
    const { removed, src } = await page.evaluate(() => {
      const frame = document.querySelector<HTMLIFrameElement>(
        '.sim-frame[data-frame="a-screen"] iframe',
      )!;
      const url = frame.src;
      frame.src = "about:blank";
      return { removed: Date.now(), src: url };
    });
    const panels = ["a-p1", "a-p5", "a-p6"];
    for (const id of panels) {
      await expect
        .poll(async () => (await frameState(page, id)).mode, { timeout: 15_000 })
        .toBe("local");
    }
    const took = await Promise.all(
      panels.map(async (id) => (await frameState(page, id)).modeAt - removed),
    );
    test.info().annotations.push({ type: "fallback", description: `${took.join(", ")} ms` });
    // The aim is 3 s, which the sim meets when the machine isn't loaded; this bound still
    // catches waiting for the hub to drop a silent member.
    for (const ms of took) expect(ms).toBeLessThan(5000);
    // Their own builds keep growing from their own tasks.
    await expect
      .poll(async () => (await frameState(page, "a-p5")).build?.made ?? 0, { timeout: 30_000 })
      .toBeGreaterThan(0);
    // The screen comes back: panels drop their builds and send to it again.
    await page.evaluate((url) => {
      document.querySelector<HTMLIFrameElement>('.sim-frame[data-frame="a-screen"] iframe')!.src =
        url;
    }, src);
    for (const id of panels) {
      await expect
        .poll(async () => (await frameState(page, id)).mode, { timeout: 60_000 })
        .toBe("screen");
    }
    expect((await frameState(page, "a-p5")).build).toBeNull();
    await expect
      .poll(
        async () =>
          (await frameState(page, "a-screen")).arrivals?.some((a) => a.frame === "a-p5") ?? false,
        { timeout: 40_000 },
      )
      .toBe(true);
  });
});
