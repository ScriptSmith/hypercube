import { expect, type Page, test } from "@playwright/test";
import { watchPage } from "../scripts/lib/play.mjs";

/**
 * Gravity Sandbox: a drawn slingshot shows a ribbon and the body flies along it; a short pull
 * cancels; a black hole fires and the launcher recharges; the pickers, time control and scene
 * button work; the ghost and bots throw; and in the sim's banks every body crosses the bezel onto
 * the screen at the same step and place, also with 300 ms of added delay, the screen carries a
 * drawn ribbon on, and the frames play alone when the screen goes.
 */

interface Btn {
  x: number;
  y: number;
  r: number;
}
interface Pad {
  x: number;
  y: number;
  grab: number;
  pull: number;
  minPull: number;
  holder: string | null;
  ready: boolean;
  pick: string;
}
interface Crossing {
  k: number;
  x: number;
  y?: number;
  owner?: string;
  pad?: number;
  late?: boolean;
}
interface BodyState {
  id: number;
  kind: string;
  x: number;
  y: number;
  r: number;
  re: number;
  rt: number;
  owner: string;
  pad: number;
}
interface TouchState {
  role: "touch";
  mode: "solo" | "strip";
  unit: number;
  screen: string | null;
  scene: string;
  time: number;
  sizes: boolean;
  sizesButton: Btn;
  step: number;
  pads: Pad[];
  pickers: (Btn & { pick: string })[][];
  slower: Btn;
  faster: Btn;
  sceneButton: Btn;
  launchers: { x: number; y: number; r: number; charge: number }[];
  ribbons: { pad: number; n: number; stop: string; pts: number[] }[];
  bodies: BodyState[];
  crossings: Crossing[];
  launches: number;
  ghostShots: number;
  botShots: number;
}
interface ScreenState {
  role: "screen";
  W: number;
  sizes: boolean;
  stations: number;
  scene: string;
  crossings: Crossing[];
  aims: { key: string; n: number }[];
  arrived: number;
  bodies: BodyState[];
}

declare global {
  interface Window {
    __gravity?: { state(): TouchState | ScreenState; setLag?(ms: number): void };
  }
}

const SIZES = {
  panel: [1080, 1920],
  pair: [2160, 1920],
  wall: [5760, 2160],
  kiosk: [1920, 1080],
} as const;

const open = async (page: Page, kind: keyof typeof SIZES, params: Record<string, string> = {}) => {
  const [w, h] = SIZES[kind];
  const scale = Math.min(1000 / w, 800 / h);
  await page.setViewportSize({ width: Math.round(w * scale), height: Math.round(h * scale) });
  const q = new URLSearchParams({
    app: "gravity",
    kind,
    fit: `${w}x${h}`,
    bots: "0",
    seed: "e2e",
    debug: "1",
    ...params,
  });
  await page.goto(`play/?${q}`);
  await page.waitForFunction(() => window.__gravity?.state() !== undefined, undefined, {
    timeout: 30_000,
  });
};

const touch = (page: Page) => page.evaluate(() => window.__gravity!.state() as TouchState);

/**
 * Real pointer events: down at the first venue point, moves along the rest. The finger stays
 * down unless `lift`; `window.__lift()` lifts it later.
 */
const press = (page: Page, path: { x: number; y: number }[], lift: boolean, id = 4242) =>
  page.evaluate(
    async ({ pts, up, pointerId }) => {
      const st = window.__gravity!.state();
      const stage = document.querySelector<HTMLElement>(".hc-stage")!;
      const r = stage.getBoundingClientRect();
      const k = st.role === "touch" ? st.unit * (r.width / stage.offsetWidth) : 1;
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
            pointerId,
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
      const last = at(pts[pts.length - 1]!);
      (window as unknown as { __lift(): void }).__lift = () => fire("pointerup", last);
      if (up) fire("pointerup", last);
    },
    { pts: path, up: lift, pointerId: id },
  );

const lift = (page: Page) =>
  page.evaluate(() => (window as unknown as { __lift(): void }).__lift());

const pullPath = (pad: Pad, fx: number, fy: number) =>
  Array.from({ length: 13 }, (_, i) => ({
    x: pad.x + pad.pull * fx * (i / 12),
    y: pad.y + pad.pull * fy * (i / 12),
  }));

test.describe("gravity", () => {
  test.describe.configure({ timeout: 150_000 });

  test("a drawn slingshot shows a ribbon and the body flies along it", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "panel");
    const pad = (await touch(page)).pads[0]!;
    await press(page, pullPath(pad, -0.3, 0.6), false);
    await expect.poll(async () => (await touch(page)).ribbons[0]?.n ?? 0).toBeGreaterThan(20);
    expect((await touch(page)).pads[0]!.holder).toBe("person");
    const before = new Set((await touch(page)).bodies.map((b) => b.id));
    const ribbon = (await touch(page)).ribbons[0]!;
    await lift(page);
    const seen: { x: number; y: number }[] = [];
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(120);
      const b = (await touch(page)).bodies.find((x) => !before.has(x.id));
      if (b) seen.push(b);
    }
    expect(seen.length).toBeGreaterThan(3);
    const pts = ribbon.pts;
    const far = seen.map((p) => {
      let best = Infinity;
      for (let i = 0; i < pts.length; i += 2)
        best = Math.min(best, Math.hypot(pts[i]! - p.x, pts[i + 1]! - p.y));
      return best;
    });
    // The ribbon was worked out a frame or so before the release, in a world that kept moving,
    // so allow a little more than the gap between its points.
    expect(Math.max(...far)).toBeLessThan(30);
    expect((await touch(page)).ribbons).toHaveLength(0);
    expect(problems).toEqual([]);
  });

  test("a short pull cancels, and a black hole fires and recharges", async ({ page }) => {
    await open(page, "kiosk");
    const st = await touch(page);
    const pad = st.pads[1]!;
    await press(page, pullPath(pad, 0, (pad.minPull * 0.5) / pad.pull), true);
    await page.waitForTimeout(200);
    expect((await touch(page)).launches).toBe(0);
    const l = st.launchers[0]!;
    expect(l.charge).toBe(1);
    const holes = async () => (await touch(page)).bodies.filter((b) => b.kind === "hole").length;
    const h0 = await holes();
    await press(page, [{ x: l.x, y: l.y }], true);
    await expect.poll(holes).toBe(h0 + 1);
    expect((await touch(page)).launchers[0]!.charge).toBeLessThan(0.05);
    await press(page, [{ x: l.x, y: l.y }], true);
    await page.waitForTimeout(200);
    expect(await holes()).toBeLessThanOrEqual(h0 + 1);
  });

  test("the picker, time control and scene button change what happens", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "pair");
    let st = await touch(page);
    expect(st.scene).toBe("solar");
    expect(st.time).toBe(1);
    const star = st.pickers[1]!.find((b) => b.pick === "star")!;
    await press(page, [{ x: star.x, y: star.y }], true);
    await expect.poll(async () => (await touch(page)).pads[1]!.pick).toBe("star");
    const stars0 = st.bodies.filter((b) => b.kind === "star").length;
    await press(page, pullPath(st.pads[1]!, 0.2, 0.7), true, 4300);
    await expect
      .poll(async () => (await touch(page)).bodies.filter((b) => b.kind === "star").length)
      .toBeGreaterThan(stars0);
    await press(page, [{ x: st.faster.x, y: st.faster.y }], true, 4301);
    await expect.poll(async () => (await touch(page)).time).toBe(2);
    await press(page, [{ x: st.slower.x, y: st.slower.y }], true, 4302);
    await press(page, [{ x: st.slower.x, y: st.slower.y }], true, 4303);
    await expect.poll(async () => (await touch(page)).time).toBe(0.5);
    // True sizes: every body's radius for contacts becomes its true one, and back.
    expect(st.sizes).toBe(false);
    await press(page, [{ x: st.sizesButton.x, y: st.sizesButton.y }], true, 4310);
    await expect.poll(async () => (await touch(page)).sizes).toBe(true);
    const small = await touch(page);
    expect(small.bodies.every((b) => b.r === b.rt && b.rt < b.re)).toBe(true);
    await press(page, [{ x: st.sizesButton.x, y: st.sizesButton.y }], true, 4311);
    await expect.poll(async () => (await touch(page)).sizes).toBe(false);
    expect((await touch(page)).bodies.every((b) => b.r === b.re)).toBe(true);
    // A tap on the scene button does nothing; holding it a second moves to the next scene.
    await press(page, [{ x: st.sceneButton.x, y: st.sceneButton.y }], true, 4304);
    await page.waitForTimeout(1300);
    expect((await touch(page)).scene).toBe("solar");
    await press(page, [{ x: st.sceneButton.x, y: st.sceneButton.y }], false, 4305);
    await expect.poll(async () => (await touch(page)).scene, { timeout: 5000 }).toBe("binary");
    await lift(page);
    st = await touch(page);
    expect(st.bodies.filter((b) => b.kind === "star")).toHaveLength(2);
    expect(problems).toEqual([]);
  });

  test("with nobody playing, the ghost takes a slingshot and throws", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "panel", { "o.scene": "rings" });
    await expect
      .poll(async () => (await touch(page)).ghostShots, { timeout: 40_000 })
      .toBeGreaterThanOrEqual(1);
    expect((await touch(page)).launches).toBeGreaterThanOrEqual(1);
    expect(problems).toEqual([]);
  });

  test("bots throw bodies with injected touches", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "wall", { bots: "3", "o.blackhole": "false" });
    await expect
      .poll(async () => (await touch(page)).launches, { timeout: 60_000, intervals: [1000] })
      .toBeGreaterThanOrEqual(4);
    const st = await touch(page);
    expect(st.botShots).toBeGreaterThan(0);
    expect(st.bodies.some((b) => b.pad >= 0)).toBe(true);
    const status = await page.evaluate(() => window.__hypercube!.appStatus());
    expect(Number(status.launches)).toBeGreaterThanOrEqual(4);
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

const frames = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".sim-frame[data-frame]")].map((el) => {
      const w = el.querySelector("iframe")?.contentWindow;
      return {
        id: el.dataset.frame!,
        self: w?.__hypercube?.net?.self ?? "",
        phase: w?.__hypercube?.phase ?? "loading",
        room: w?.__hypercube?.room ?? "none",
        hub: w?.__hypercube?.net?.isHub ?? false,
        errors: w?.__hypercube ? [...w.__hypercube.errors] : ["missing"],
        state: w?.__gravity?.state() ?? null,
      };
    }),
  );

/** Each frame's crossings paired with the screen's record of the same body. */
const unmatched = async (page: Page, since: number) => {
  const all = await frames(page);
  const screen = all.find((f) => f.state?.role === "screen")?.state as ScreenState | undefined;
  if (!screen) return { pairs: 0, bad: ["no screen"] };
  let pairs = 0;
  const bad: string[] = [];
  for (const f of all) {
    const st = f.state;
    if (!st || st.role !== "touch") continue;
    for (const c of st.crossings) {
      if (c.k < since) continue;
      const there = screen.crossings.find((s) => s.owner === f.self && s.k === c.k);
      if (!there) continue;
      pairs++;
      if (there.late || there.x !== c.x) {
        bad.push(
          `${f.id} step ${c.k}: frame x ${c.x}, screen x ${there.x}${there.late ? " late" : ""}`,
        );
      }
    }
  }
  return { pairs, bad };
};

for (const [preset, count] of [
  ["bank-panels", 7],
  ["bank-pairs", 4],
] as const) {
  test.describe(`gravity in a sim ${preset}`, () => {
    test.describe.configure({ timeout: 300_000 });

    test(`gravity: bodies cross the bezel without a jump, ribbons carry on, frames fall back (${preset})`, async ({
      page,
    }) => {
      const problems = watchPage(page);
      await page.setViewportSize({ width: 1600, height: 1000 });
      await page.goto(`sim/?preset=${preset}&app=gravity&transport=local&bots=1&seed=e2e&debug=1`);
      await expect
        .poll(
          async () => {
            const all = await frames(page);
            const ok = all.filter((f) => f.phase === "running" && f.room === "online");
            return ok.length === all.length && all.filter((f) => f.hub).length === 1
              ? all.length
              : 0;
          },
          { timeout: 120_000, intervals: [1000] },
        )
        .toBe(count);
      await expect
        .poll(
          async () =>
            (await frames(page)).every(
              (f) => f.state?.role === "screen" || (f.state?.mode === "strip" && f.state.screen),
            ),
          { timeout: 30_000 },
        )
        .toBe(true);

      // Bots throw; every crossing the screen saw matches the frame's step and place exactly.
      await expect
        .poll(async () => (await unmatched(page, 0)).pairs, { timeout: 60_000, intervals: [1000] })
        .toBeGreaterThanOrEqual(4);
      expect((await unmatched(page, 0)).bad).toEqual([]);

      // The same with 300 ms added to every message from the frames.
      const touchIds = (await frames(page))
        .filter((f) => f.state?.role === "touch")
        .map((f) => f.id);
      for (const id of touchIds)
        await inFrame(page, id, (ms: number) => window.__gravity!.setLag!(ms), 300);
      const step = await inFrame(
        page,
        touchIds[0]!,
        () => (window.__gravity!.state() as TouchState).step,
      );
      await expect
        .poll(async () => (await unmatched(page, step + 60)).pairs, {
          timeout: 90_000,
          intervals: [1000],
        })
        .toBeGreaterThanOrEqual(4);
      expect((await unmatched(page, step + 60)).bad).toEqual([]);
      for (const id of touchIds)
        await inFrame(page, id, (ms: number) => window.__gravity!.setLag!(ms), 0);

      // True sizes switched on from one frame: the screen and every frame follow, and crossings
      // still match, since the mode travels in the snapshot the frames climb in.
      await inFrame(page, touchIds[1]!, () => {
        const st = window.__gravity!.state() as TouchState;
        const stage = document.querySelector<HTMLElement>(".hc-stage")!;
        const r = stage.getBoundingClientRect();
        const k = st.unit * (r.width / stage.offsetWidth);
        const x = r.left + st.sizesButton.x * k;
        const y = r.top + st.sizesButton.y * k;
        const target = document.elementFromPoint(x, y) ?? stage;
        for (const type of ["pointerdown", "pointerup"]) {
          target.dispatchEvent(
            new PointerEvent(type, {
              clientX: x,
              clientY: y,
              pointerId: 4344,
              pointerType: "touch",
              bubbles: true,
              buttons: type === "pointerup" ? 0 : 1,
            }),
          );
        }
      });
      await expect
        .poll(
          async () =>
            (await frames(page)).every((f) =>
              f.state?.role === "screen" ? f.state.sizes : f.state?.sizes,
            ),
          { timeout: 15_000 },
        )
        .toBe(true);
      const sizedFrom = await inFrame(
        page,
        touchIds[0]!,
        () => (window.__gravity!.state() as TouchState).step,
      );
      await expect
        .poll(async () => (await unmatched(page, sizedFrom + 60)).pairs, {
          timeout: 90_000,
          intervals: [1000],
        })
        .toBeGreaterThanOrEqual(4);
      expect((await unmatched(page, sizedFrom + 60)).bad).toEqual([]);

      // A slingshot held drawn on one frame: the screen draws its ribbon on.
      const third = touchIds[2]!;
      await inFrame(page, third, async () => {
        const st = window.__gravity!.state() as TouchState;
        const pad = st.pads[0]!;
        const stage = document.querySelector<HTMLElement>(".hc-stage")!;
        const r = stage.getBoundingClientRect();
        const k = st.unit * (r.width / stage.offsetWidth);
        const x = r.left + pad.x * k;
        const y = r.top + pad.y * k;
        const target = document.elementFromPoint(x, y) ?? stage;
        const fire = (type: string, dy: number) =>
          target.dispatchEvent(
            new PointerEvent(type, {
              clientX: x,
              clientY: y + dy * k,
              pointerId: 4343,
              pointerType: "touch",
              bubbles: true,
              buttons: type === "pointerup" ? 0 : 1,
            }),
          );
        fire("pointerdown", 0);
        for (let i = 1; i <= 10; i++) {
          await new Promise((res) => setTimeout(res, 20));
          fire("pointermove", pad.pull * 0.08 * i);
        }
        (window as unknown as { __lift(): void }).__lift = () => fire("pointerup", pad.pull * 0.8);
      });
      const thirdSelf = (await frames(page)).find((f) => f.id === third)!.self;
      await expect
        .poll(
          async () => {
            const screen = (await frames(page)).find((f) => f.state?.role === "screen")!
              .state as ScreenState;
            return screen.aims.find((a) => a.key.startsWith(`${thirdSelf}:`))?.n ?? 0;
          },
          { timeout: 15_000 },
        )
        .toBeGreaterThan(10);
      await inFrame(page, third, () => (window as unknown as { __lift(): void }).__lift());

      // The screen goes: every frame plays alone within a few seconds.
      await page.evaluate(() => {
        const el = [...document.querySelectorAll<HTMLElement>(".sim-frame[data-frame]")].find(
          (f) => f.querySelector("iframe")?.contentWindow?.__gravity?.state().role === "screen",
        );
        el?.querySelector("iframe")?.remove();
      });
      await expect
        .poll(
          async () =>
            (await frames(page))
              .filter((f) => f.state)
              .every((f) => f.state!.role === "touch" && f.state!.mode === "solo"),
          { timeout: 20_000, intervals: [500] },
        )
        .toBe(true);
      const after = await frames(page);
      expect(after.flatMap((f) => (f.state ? f.errors : []))).toEqual([]);
      expect(problems).toEqual([]);
    });
  });
}
