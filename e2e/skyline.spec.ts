import { expect, type Page, test } from "@playwright/test";
import { watchPage } from "../scripts/lib/play.mjs";

/**
 * Crane Skyline: a pad drag moving a crane, a child's block riding the lift to the yard, a
 * person catching a block and setting it in a slot with the pad and release button, the
 * autopilot finishing a building, bots stacking tall towers, and on a bank a block crossing the
 * bezel into the screen's yard where the frame's lift leaves, then the frames carrying on alone
 * when the screen goes.
 */

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface Point {
  x: number;
  y: number;
}
interface CraneLayoutState {
  pad: Rect;
  release: { x: number; y: number; r: number };
  buttons: { kind: number; rect: Rect }[];
  lift: { x: number; width: number; bottom: number; top: number };
  lane: Rect;
}
interface Readout {
  hook: Point;
  target: Point;
  carrying: number;
  pick: Point | null;
  drop: Point | null;
  inZone: boolean;
}
interface CraneState {
  driver: "auto" | "person" | "bot" | null;
  riders: { kind: number; t: number }[];
  pad: { room: number } | null;
  sim: {
    trolley: number;
    target: Point;
    carrying: number;
    counts: { placed: number; finished: number; dropped: number; arrived: number };
    yard: number[];
    lots: { phase: string; slots: number; filled: number }[];
    tower: { floors: number; phase: string; best: number } | null;
    readout: Readout;
  } | null;
}
interface FrameState {
  mode: "solo" | "bank";
  unit: number;
  sent: number;
  screenId: string | null;
  layout: { width: number; height: number; cranes: CraneLayoutState[] };
  cranes: CraneState[];
}
interface LaneState {
  pos: number;
  crane: number;
  driver: string;
  counts: { placed: number; arrived: number };
  yard: number[];
  loose: { state: string; x: number; y: number }[];
  shaft: { x: number; w: number };
  reported: boolean;
  target: Point;
}
interface ScreenState {
  screen: true;
  width: number;
  lanes: LaneState[];
}

declare global {
  interface Window {
    __skyline?: {
      state(): FrameState | ScreenState;
      command(name: string): void;
      speed(k: number): void;
    };
  }
}

const SIZES = {
  panel: [1080, 1920],
  pair: [2160, 1920],
  wall: [5760, 2160],
  kiosk: [1920, 1080],
} as const;

const PAD_INSET = 26;

const open = async (
  page: Page,
  kind: keyof typeof SIZES,
  params: Record<string, string | number> = {},
) => {
  const [w, h] = SIZES[kind];
  const scale = Math.min(1000 / w, 800 / h);
  await page.setViewportSize({ width: Math.round(w * scale), height: Math.round(h * scale) });
  const q = new URLSearchParams({
    app: "skyline",
    kind,
    fit: `${w}x${h}`,
    bots: "0",
    seed: "e2e",
    debug: "1",
  });
  for (const [k, v] of Object.entries(params)) q.set(k, String(v));
  await page.goto(`play/?${q}`);
  await page.waitForFunction(() => window.__skyline !== undefined, undefined, { timeout: 30_000 });
};

const state = (page: Page) => page.evaluate(() => window.__skyline!.state() as FrameState);

/** Real pointer events along a path of venue points: down at the first, moves, up at the last. */
const drag = (page: Page, path: Point[], pointerId: number, holdMs = 0) =>
  page.evaluate(
    async ({ pts, id, hold }) => {
      const st = window.__skyline!.state() as { unit: number };
      const stage = document.querySelector<HTMLElement>(".hc-stage")!;
      const r = stage.getBoundingClientRect();
      const k = st.unit * (r.width / stage.offsetWidth);
      const at = (p: { x: number; y: number }) => ({
        clientX: r.left + p.x * k,
        clientY: r.top + p.y * k,
      });
      const first = at(pts[0]!);
      const target = document.elementFromPoint(first.clientX, first.clientY) ?? stage;
      const fire = (type: string, p: { clientX: number; clientY: number }) =>
        target.dispatchEvent(
          new PointerEvent(type, {
            ...p,
            pointerId: id,
            pointerType: "touch",
            bubbles: true,
            isPrimary: true,
            buttons: type === "pointerup" ? 0 : 1,
          }),
        );
      fire("pointerdown", first);
      for (const p of pts.slice(1)) {
        await new Promise((res) => setTimeout(res, 16));
        fire("pointermove", at(p));
      }
      if (hold > 0) await new Promise((res) => setTimeout(res, hold));
      fire("pointerup", at(pts[pts.length - 1]!));
    },
    { pts: path, id: pointerId, hold: holdMs },
  );

const tap = (page: Page, at: Point) => drag(page, [at], 8100);

/** A point in a pad's box (0..1, y up) to venue px. */
const padPoint = (pad: Rect, x: number, y: number): Point => ({
  x: pad.x + PAD_INSET + x * (pad.width - 2 * PAD_INSET),
  y: pad.y + PAD_INSET + (1 - y) * (pad.height - 2 * PAD_INSET),
});

const centre = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

test.describe("skyline", () => {
  test.describe.configure({ timeout: 150_000 });

  test("a pad drag moves the crane, and a person takes it from the autopilot", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "panel");
    const st = await state(page);
    expect(st.mode).toBe("solo");
    expect(st.cranes[0]!.driver).toBe("auto");
    const pad = st.layout.cranes[0]!.pad;
    const path = Array.from({ length: 12 }, (_, i) => padPoint(pad, 0.1 + (0.8 * i) / 11, 0.8));
    await drag(page, path, 8001, 300);
    const after = await state(page);
    expect(after.cranes[0]!.driver).toBe("person");
    const r = after.cranes[0]!.sim!.readout;
    expect(r.target.x).toBeGreaterThan(0.85);
    expect(r.target.y).toBeGreaterThan(0.75);
    // The trolley follows at crane speed.
    await expect
      .poll(async () => (await state(page)).cranes[0]!.sim!.readout.hook.x, { timeout: 8000 })
      .toBeGreaterThan(0.8);
    expect(problems).toEqual([]);
  });

  test("a block button sends a block up the lift to the yard, and the autopilot keeps the crane", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await open(page, "wall", { "o.cranes": 3 });
    const st = await state(page);
    const b = st.layout.cranes[1]!.buttons.find((x) => x.kind === 1)!;
    const before = st.cranes[1]!.sim!.counts.arrived;
    await tap(page, centre(b.rect));
    await expect
      .poll(async () => (await state(page)).cranes[1]!.sim!.counts.arrived, { timeout: 8000 })
      .toBeGreaterThan(before);
    expect((await state(page)).cranes[1]!.driver).toBe("auto");
    expect(problems).toEqual([]);
  });

  test("a person catches a block with the pad and sets it in a slot with the release button", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await open(page, "kiosk");
    let st = await state(page);
    const c = st.layout.cranes[0]!;
    // Two plain floors into the yard.
    await tap(page, centre(c.buttons.find((b) => b.kind === 0)!.rect));
    await page.waitForTimeout(400);
    await tap(page, centre(c.buttons.find((b) => b.kind === 0)!.rect));
    await expect
      .poll(async () => (await state(page)).cranes[0]!.sim!.readout.pick !== null, {
        timeout: 10_000,
      })
      .toBe(true);
    // Take the crane, then lower the hook onto the block the readout points at.
    st = await state(page);
    if (st.cranes[0]!.sim!.carrying < 0) {
      const pick = st.cranes[0]!.sim!.readout.pick!;
      const hook = st.cranes[0]!.sim!.readout.hook;
      await drag(page, [padPoint(c.pad, hook.x, 0.9), padPoint(c.pad, pick.x, 0.9)], 8201, 100);
      await page.waitForTimeout(3000);
      await drag(page, [padPoint(c.pad, pick.x, 0.9), padPoint(c.pad, pick.x, 0.02)], 8202, 100);
      await expect
        .poll(async () => (await state(page)).cranes[0]!.sim!.carrying, { timeout: 15_000 })
        .toBeGreaterThanOrEqual(0);
    }
    expect((await state(page)).cranes[0]!.driver).toBe("person");
    // Up, over the slot the readout points at, down close above it, and let go.
    st = await state(page);
    const drop = st.cranes[0]!.sim!.readout.drop!;
    expect(drop).not.toBeNull();
    const placed = st.cranes[0]!.sim!.counts.placed;
    await drag(page, [padPoint(c.pad, drop.x, 0.6), padPoint(c.pad, drop.x, 0.9)], 8203, 50);
    await page.waitForTimeout(3500);
    await drag(
      page,
      [padPoint(c.pad, drop.x, 0.9), padPoint(c.pad, drop.x, drop.y + 0.12)],
      8204,
      50,
    );
    await page.waitForTimeout(3500);
    if ((await state(page)).cranes[0]!.sim!.carrying >= 0) await tap(page, c.release);
    await expect
      .poll(async () => (await state(page)).cranes[0]!.sim!.counts.placed, { timeout: 8000 })
      .toBe(placed + 1);
    expect((await state(page)).cranes[0]!.sim!.counts.dropped).toBe(0);
    expect(problems).toEqual([]);
  });

  test("the autopilot finishes a building with the blocks a child sends", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "panel", { seed: "finish" });
    await page.evaluate(() => window.__skyline!.speed(8));
    const c = (await state(page)).layout.cranes[0]!;
    const floors = c.buttons.filter((b) => b.kind !== 3);
    const roof = c.buttons.find((b) => b.kind === 3)!;
    for (let i = 0; i < 400; i++) {
      const st = await state(page);
      const sim = st.cranes[0]!.sim!;
      if (sim.counts.finished >= 1) break;
      if ((st.cranes[0]!.pad?.room ?? 0) > 0) {
        // Floors, and a roof once the building is nearly up.
        const lot = sim.lots[0]!;
        const b = lot.slots - lot.filled <= 1 ? roof : floors[i % floors.length]!;
        await tap(page, centre(b.rect));
      }
      await page.waitForTimeout(250);
    }
    const st = await state(page);
    expect(st.cranes[0]!.sim!.counts.finished).toBeGreaterThanOrEqual(1);
    expect(st.cranes[0]!.driver).toBe("auto");
    expect(problems).toEqual([]);
  });

  test("bots stack tall towers on a wall", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "wall", { bots: 2, variant: "tall", "o.cranes": 2 });
    await page.evaluate(() => window.__skyline!.speed(6));
    await expect
      .poll(async () => Math.min(...(await state(page)).cranes.map((c) => c.sim!.tower!.best)), {
        timeout: 120_000,
        intervals: [2000],
      })
      .toBeGreaterThanOrEqual(4);
    const st = await state(page);
    expect(st.cranes.every((c) => c.driver === "bot")).toBe(true);
    expect(problems).toEqual([]);
  });
});

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
  inFrame(page, "a-screen", () => window.__skyline?.state() as ScreenState | undefined);

/** Every touch frame's state and where its iframe sits on the page. */
const frames = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".sim-frame[data-frame]")]
      .filter((el) => el.dataset.frame !== "a-screen")
      .map((el) => {
        const iframe = el.querySelector("iframe");
        const w = iframe?.contentWindow;
        const r = iframe?.getBoundingClientRect();
        return {
          id: el.dataset.frame!,
          pos: w?.__hypercube?.setup?.pos ?? -1,
          phase: w?.__hypercube?.phase ?? "loading",
          errors: w?.__hypercube ? [...w.__hypercube.errors] : ["missing"],
          st: (w?.__skyline?.state() as FrameState | undefined) ?? null,
          rect: r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null,
        };
      }),
  );

/**
 * Lanes whose lift on the screen is more than 3 screen venue px off where its frame's lift
 * leaves the frame's top edge, carried across the bank as the shared layout maps it.
 */
const misaligned = async (page: Page): Promise<string[]> => {
  const screen = await screenState(page);
  if (!screen) return ["no screen"];
  const all = await frames(page);
  const count = Math.max(...all.map((f) => f.pos + 1));
  const out: string[] = [];
  for (const f of all) {
    if (!f.st) continue;
    f.st.layout.cranes.forEach((c, i) => {
      const lane = screen.lanes.find((l) => l.pos === f.pos && l.crane === i);
      if (!lane) {
        out.push(`${f.id}.${i}: no lane`);
        return;
      }
      const u = c.lift.x / f.st!.layout.width;
      const want = ((f.pos + u) / count) * screen.width;
      const wantW = (c.lift.width / f.st!.layout.width / count) * screen.width;
      const dx = Math.abs(lane.shaft.x - want);
      const dw = Math.abs(lane.shaft.w - wantW);
      if (!lane.reported || dx > 3 || dw > 3) {
        out.push(
          `${f.id}.${i}: reported ${lane.reported}, ${dx.toFixed(1)} px off, ${dw.toFixed(1)} px wider`,
        );
      }
    });
  }
  return out;
};

for (const [preset, count] of [
  ["bank-panels", 7],
  ["bank-pairs", 4],
] as const) {
  test.describe(`skyline in a sim ${preset}`, () => {
    test.describe.configure({ timeout: 240_000 });
    const third = preset === "bank-pairs" ? "a-pair3" : "a-p3";

    test(`skyline: a block crosses the bezel into the screen's yard, a pad drives the screen's crane, and frames build alone when the screen goes (${preset})`, async ({
      page,
    }) => {
      const problems = watchPage(page);
      await page.setViewportSize({ width: 1600, height: 1000 });
      await page.goto(`sim/?preset=${preset}&app=skyline&transport=local&bots=0&seed=e2e&debug=1`);
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const all = [...document.querySelectorAll<HTMLElement>(".sim-frame[data-frame]")];
              const wins = all.map((el) => el.querySelector("iframe")?.contentWindow);
              return (
                all.length ===
                  wins.filter(
                    (w) => w?.__hypercube?.phase === "running" && w.__hypercube.room === "online",
                  ).length &&
                wins.filter((w) => w?.__hypercube?.net?.isHub).length === 1 &&
                all.length
              );
            }),
          { timeout: 120_000, intervals: [1000] },
        )
        .toBe(count);
      // Every frame hears the screen and draws its cranes from it.
      await expect
        .poll(
          async () =>
            (await frames(page)).every(
              (f) => f.st?.mode === "bank" && f.st.cranes[0]?.pad !== null,
            ),
          {
            timeout: 30_000,
          },
        )
        .toBe(true);
      // Every lift on the screen carries on where its frame's leaves.
      await expect.poll(() => misaligned(page), { timeout: 15_000 }).toEqual([]);
      const lanes = (await screenState(page))!.lanes;
      expect(lanes).toHaveLength(6);

      // A child on the third frame sends a block: it rides up and out, and lands in that lane's yard.
      const f3 = (await frames(page)).find((f) => f.id === third)!;
      const pos = f3.pos;
      const before = lanes.find((l) => l.pos === pos && l.crane === 0)!.counts.arrived;
      await inFrame(
        page,
        third,
        async (b: { x: number; y: number }) => {
          const st = window.__skyline!.state() as { unit: number };
          const stage = document.querySelector<HTMLElement>(".hc-stage")!;
          const r = stage.getBoundingClientRect();
          const k = st.unit * (r.width / stage.offsetWidth);
          const init = {
            clientX: r.left + b.x * k,
            clientY: r.top + b.y * k,
            pointerId: 8301,
            pointerType: "touch",
            bubbles: true,
            isPrimary: true,
          };
          const el = document.elementFromPoint(init.clientX, init.clientY) ?? stage;
          el.dispatchEvent(new PointerEvent("pointerdown", { ...init, buttons: 1 }));
          await new Promise((res) => setTimeout(res, 80));
          el.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0 }));
        },
        centre(f3.st!.layout.cranes[0]!.buttons[0]!.rect),
      );
      await expect
        .poll(
          async () =>
            (await screenState(page))!.lanes.find((l) => l.pos === pos && l.crane === 0)!.counts
              .arrived,
          { timeout: 15_000 },
        )
        .toBeGreaterThan(before);

      // A person drags the third frame's pad: the screen's crane in that lane follows them.
      const pad = f3.st!.layout.cranes[0]!.pad;
      await inFrame(
        page,
        third,
        async (o: {
          pad: { x: number; y: number; width: number; height: number };
          inset: number;
        }) => {
          const st = window.__skyline!.state() as { unit: number };
          const stage = document.querySelector<HTMLElement>(".hc-stage")!;
          const r = stage.getBoundingClientRect();
          const k = st.unit * (r.width / stage.offsetWidth);
          const at = (x: number, y: number) => ({
            clientX: r.left + (o.pad.x + o.inset + x * (o.pad.width - 2 * o.inset)) * k,
            clientY: r.top + (o.pad.y + o.inset + (1 - y) * (o.pad.height - 2 * o.inset)) * k,
          });
          const first = at(0.1, 0.9);
          const el = document.elementFromPoint(first.clientX, first.clientY) ?? stage;
          const fire = (type: string, p: { clientX: number; clientY: number }) =>
            el.dispatchEvent(
              new PointerEvent(type, {
                ...p,
                pointerId: 8302,
                pointerType: "touch",
                bubbles: true,
                isPrimary: true,
                buttons: type === "pointerup" ? 0 : 1,
              }),
            );
          fire("pointerdown", first);
          for (let i = 1; i <= 20; i++) {
            await new Promise((res) => setTimeout(res, 30));
            fire("pointermove", at(0.1 + (0.8 * i) / 20, 0.9));
          }
          await new Promise((res) => setTimeout(res, 300));
          fire("pointerup", at(0.9, 0.9));
        },
        { pad, inset: PAD_INSET },
      );
      await expect
        .poll(
          async () =>
            (await screenState(page))!.lanes.find((l) => l.pos === pos && l.crane === 0)!.driver,
          {
            timeout: 5000,
          },
        )
        .toBe("person");

      // The screen goes: every frame builds on its own within a few seconds and keeps running.
      await page.evaluate(() =>
        document.querySelector('.sim-frame[data-frame="a-screen"] iframe')?.remove(),
      );
      await expect
        .poll(async () => (await frames(page)).every((f) => f.st?.mode === "solo"), {
          timeout: 15_000,
          intervals: [500],
        })
        .toBe(true);
      const after = await frames(page);
      expect(after.every((f) => f.phase === "running")).toBe(true);
      expect(after.every((f) => f.st!.cranes.every((c) => c.sim !== null))).toBe(true);
      expect(after.flatMap((f) => f.errors)).toEqual([]);
      expect(problems).toEqual([]);
    });
  });
}
