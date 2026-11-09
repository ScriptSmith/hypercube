import { expect, type Page, test } from "@playwright/test";
import { watchPage } from "../scripts/lib/play.mjs";

/**
 * Tilt Maze: holding the pad tips the board and rolls the ball that way (real pointer events),
 * the level buttons, bots finishing mazes with injected touches, the together mode's helping
 * lever, and in the simulator's banks, finished balls rising out of each frame into the screen's
 * run right above their own column and counting in its jar, then every frame showing its own
 * jar when the screen goes.
 */

interface Circle {
  x: number;
  y: number;
  r: number;
}
interface BoardState {
  level: number;
  phase: string;
  mode: string;
  ball: { x: number; z: number; vx: number; vz: number };
  tilt: { x: number; z: number };
  command: { x: number; y: number };
  counts: { finished: number; falls: number; mazes: number };
  room: { left: number; right: number; far: number; near: number };
  bot: boolean;
  helping: { h: boolean; v: boolean };
}
interface FrameState {
  screen: false;
  unit: number;
  ready: boolean;
  out: boolean;
  toScreen: string | null;
  sent: number;
  layout: {
    width: number;
    boards: { pad: Circle | null; minus: Circle; plus: Circle; tube: { x: number; y: number } }[];
  };
  glass: { top: number; tubes: number[]; edgeStage: { x: number; y: number }[] };
  boards: BoardState[];
  run: {
    jar: { count: number; phase: string };
    capacity: number;
    balls: { state: string; tube: number; x: number; y: number }[];
    counts: { arrived: number; jarred: number };
  };
}
interface ScreenState {
  screen: true;
  ready: boolean;
  clock: number;
  span: number;
  count: number;
  edge: number;
  bottom: number;
  tubes: { key: string; pos: number; x: number; stage: { x: number; y: number } }[];
  balls: { state: string; tube: number; pos: number; x: number; y: number }[];
  jar: { count: number; phase: string };
  counts: { drops: number; jarred: number; arrived: number };
  recent: { pos: number; b: number; t: number; at: number; tube: number }[];
}

declare global {
  interface Window {
    __tiltmaze?: { state(): FrameState | ScreenState; command(name: string): void };
  }
}

const SIZES = { panel: [1080, 1920], pair: [2160, 1920], kiosk: [1920, 1080] } as const;

const open = async (
  page: Page,
  kind: keyof typeof SIZES,
  params: Record<string, string | number> = {},
) => {
  const [w, h] = SIZES[kind];
  const scale = Math.min(900 / w, 900 / h);
  await page.setViewportSize({ width: Math.round(w * scale), height: Math.round(h * scale) });
  const q = new URLSearchParams({
    app: "tiltmaze",
    kind,
    fit: `${w}x${h}`,
    bots: "0",
    seed: "e2e",
    debug: "1",
  });
  for (const [k, v] of Object.entries(params)) q.set(k, String(v));
  await page.goto(`play/?${q}`);
  await page.waitForFunction(() => window.__tiltmaze?.state() !== undefined, undefined, {
    timeout: 30_000,
  });
};

const state = (page: Page) => page.evaluate(() => window.__tiltmaze!.state() as FrameState);

/** Fire a real pointer event at a venue point on the stage. */
const pointer = (page: Page, type: string, p: { x: number; y: number }, id: number) =>
  page.evaluate(
    ({ type: t, pt, pid }) => {
      const st = window.__tiltmaze!.state() as { unit: number };
      const stage = document.querySelector<HTMLElement>(".hc-stage")!;
      const r = stage.getBoundingClientRect();
      const k = st.unit * (r.width / stage.offsetWidth);
      const clientX = r.left + pt.x * k;
      const clientY = r.top + pt.y * k;
      const target = document.elementFromPoint(clientX, clientY) ?? stage;
      target.dispatchEvent(
        new PointerEvent(t, {
          clientX,
          clientY,
          pointerId: pid,
          pointerType: "touch",
          bubbles: true,
          isPrimary: true,
          buttons: t === "pointerup" ? 0 : 1,
        }),
      );
    },
    { type, pt: p, pid: id },
  );

test.describe("tiltmaze", () => {
  test.describe.configure({ timeout: 150_000 });

  test("holding the pad tips the board and rolls the ball towards that side", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "panel");
    await expect
      .poll(async () => (await state(page)).boards[0]!.phase, { timeout: 20_000 })
      .toBe("roll");
    const pad = (await state(page)).layout.boards[0]!.pad!;
    const dirs = [
      { name: "right", dx: 1, dy: 0, room: "right", axis: "x", sign: 1 },
      { name: "left", dx: -1, dy: 0, room: "left", axis: "x", sign: -1 },
      { name: "away", dx: 0, dy: -1, room: "far", axis: "z", sign: -1 },
      { name: "towards", dx: 0, dy: 1, room: "near", axis: "z", sign: 1 },
    ] as const;
    let tried = 0;
    for (const d of dirs) {
      const before = await state(page);
      const b0 = before.boards[0]!;
      if (b0.phase !== "roll" || b0.room[d.room] < 0.012) continue;
      const at = { x: pad.x + d.dx * pad.r * 0.7, y: pad.y + d.dy * pad.r * 0.7 };
      await pointer(page, "pointerdown", at, 7001 + tried);
      await page.waitForTimeout(700);
      const mid = (await state(page)).boards[0]!;
      await pointer(page, "pointerup", at, 7001 + tried);
      // The board took a person's command that way and tipped that way.
      expect(mid.mode, d.name).toBe("people");
      expect(d.dx * mid.command.x + d.dy * mid.command.y, d.name).toBeGreaterThan(0.6);
      const tilt = d.axis === "x" ? mid.tilt.x : mid.tilt.z;
      expect(tilt * d.sign, d.name).toBeGreaterThan(0.03);
      // The ball rolled that way.
      const moved = (d.axis === "x" ? mid.ball.x - b0.ball.x : mid.ball.z - b0.ball.z) * d.sign;
      expect(moved, d.name).toBeGreaterThan(0.004);
      tried++;
      // Let it ease back level before the next.
      await page.waitForTimeout(600);
      if (tried >= 2) break;
    }
    expect(tried).toBeGreaterThanOrEqual(1);
    // Let go and the board eases back level.
    await expect
      .poll(async () => Math.abs((await state(page)).boards[0]!.tilt.x), { timeout: 3000 })
      .toBeLessThan(0.002);
    expect(problems).toEqual([]);
  });

  test("the level buttons change the maze, in adult reach", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "kiosk");
    const st = await state(page);
    const plus = st.layout.boards[0]!.plus;
    const mazes = st.boards[0]!.counts.mazes;
    await pointer(page, "pointerdown", plus, 7101);
    await pointer(page, "pointerup", plus, 7101);
    await expect.poll(async () => (await state(page)).boards[0]!.level, { timeout: 3000 }).toBe(2);
    const after = (await state(page)).boards[0]!;
    expect(after.counts.mazes).toBe(mazes + 1);
    expect(after.mode).toBe("people");
    const minus = st.layout.boards[0]!.minus;
    await pointer(page, "pointerdown", minus, 7102);
    await pointer(page, "pointerup", minus, 7102);
    await expect.poll(async () => (await state(page)).boards[0]!.level, { timeout: 3000 }).toBe(1);
    expect(problems).toEqual([]);
  });

  test("a bot finishes a level-1 maze and its ball reaches the jar", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "panel", { bots: 1 });
    await expect
      .poll(async () => (await state(page)).boards[0]!.counts.finished, {
        timeout: 90_000,
        intervals: [1000],
      })
      .toBeGreaterThanOrEqual(1);
    await expect
      .poll(async () => (await state(page)).run.jar.count, { timeout: 30_000, intervals: [500] })
      .toBeGreaterThanOrEqual(1);
    const status = await page.evaluate(() => window.__hypercube!.appStatus());
    expect(Number(status.finished)).toBeGreaterThanOrEqual(1);
    expect(problems).toEqual([]);
  });

  test("on a pair together, the lever nobody holds helps by itself", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "pair", { bots: 1, "o.pair": "together" });
    await expect
      .poll(async () => (await state(page)).boards[0]!.helping.v, {
        timeout: 40_000,
        intervals: [500],
      })
      .toBe(true);
    await expect
      .poll(async () => (await state(page)).boards[0]!.counts.finished, {
        timeout: 120_000,
        intervals: [1000],
      })
      .toBeGreaterThanOrEqual(1);
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

const frameState = (page: Page, id: string) =>
  inFrame(page, id, () => window.__tiltmaze?.state() as FrameState | undefined);
const screenState = (page: Page) =>
  inFrame(page, "a-screen", () => window.__tiltmaze?.state() as ScreenState | undefined);

const touchFrames = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".sim-frame[data-frame]")]
      .map((el) => el.dataset.frame!)
      .filter((id) => id !== "a-screen"),
  );

for (const [preset, frames] of [
  ["bank-panels", 7],
  ["bank-pairs", 4],
] as const) {
  test.describe(`tiltmaze in a ${preset} bank`, () => {
    test.describe.configure({ timeout: 240_000 });

    test(`tiltmaze: finished balls rise into the screen above their own column and fill its jar; frames show their own jar when it goes (${preset})`, async ({
      page,
    }) => {
      const problems = watchPage(page);
      await page.setViewportSize({ width: 1600, height: 1000 });
      await page.goto(`sim/?preset=${preset}&app=tiltmaze&transport=local&bots=1&seed=e2e&debug=1`);
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
        .toBe(frames);
      const ids = await touchFrames(page);
      // Every frame sends its balls up to the screen rather than into a jar of its own.
      await expect
        .poll(
          async () => {
            const sts = await Promise.all(ids.map((id) => frameState(page, id)));
            return sts.every((s) => s && s.toScreen === "a-screen" && s.out);
          },
          { timeout: 40_000, intervals: [1000] },
        )
        .toBe(true);

      // Each frame's tubes stand exactly where the screen draws them, column by column.
      const scr0 = (await screenState(page))!;
      for (const id of ids) {
        const f = (await frameState(page, id))!;
        const pos = await inFrame(page, id, () => window.__hypercube?.setup?.pos ?? 0);
        f.glass.tubes.forEach((x, b) => {
          const t = scr0.tubes.find((tb) => tb.key === `${pos}:${b}`);
          expect(t, `${id} tube ${b}`).toBeDefined();
          expect(Math.abs(t!.x - x), `${id} tube ${b}`).toBeLessThan(1e-6);
          // On the screen, inside that frame's column.
          const W = 4000;
          expect(t!.stage.x).toBeGreaterThan((pos / scr0.count) * W);
          expect(t!.stage.x).toBeLessThan(((pos + 1) / scr0.count) * W);
        });
      }

      // A finished ball shows up in the screen's tube above its own frame, and the jar counts it.
      await expect
        .poll(
          async () => {
            const s = (await screenState(page))!;
            return s.balls.some((b) => {
              const t = s.tubes[b.tube];
              return (
                (b.state === "tube" || b.state === "top") &&
                t !== undefined &&
                Math.abs(b.x - t.x) < 1e-6 &&
                b.y > s.bottom &&
                s.recent.some((r) => r.tube === b.tube && r.pos === t.pos)
              );
            });
          },
          { timeout: 90_000, intervals: [250] },
        )
        .toBe(true);
      await expect
        .poll(async () => (await screenState(page))!.counts.jarred, {
          timeout: 90_000,
          intervals: [1000],
        })
        .toBeGreaterThanOrEqual(2);
      const sent = (await Promise.all(ids.map((id) => frameState(page, id)))).reduce(
        (n, s) => n + (s?.sent ?? 0),
        0,
      );
      const drops = (await screenState(page))!.counts.drops;
      expect(drops).toBeGreaterThan(0);
      expect(drops).toBeLessThanOrEqual(sent);

      // The screen goes: every frame shows its own jar and keeps playing into it.
      const finished = await Promise.all(
        ids.map(async (id) =>
          (await frameState(page, id))!.boards.reduce((n, b) => n + b.counts.finished, 0),
        ),
      );
      await page.evaluate(() =>
        document.querySelector('.sim-frame[data-frame="a-screen"] iframe')?.remove(),
      );
      await expect
        .poll(
          async () => {
            const sts = await Promise.all(ids.map((id) => frameState(page, id)));
            return sts.every((s) => s && !s.out && s.toScreen === null);
          },
          { timeout: 15_000, intervals: [500] },
        )
        .toBe(true);
      await expect
        .poll(
          async () => {
            const sts = await Promise.all(ids.map((id) => frameState(page, id)));
            const moreFinished = sts.filter(
              (s, i) => s && s.boards.reduce((n, b) => n + b.counts.finished, 0) > finished[i]!,
            ).length;
            const ownJar = sts.filter((s) => s && s.run.counts.arrived > 0).length;
            return moreFinished >= Math.ceil(ids.length / 2) && ownJar >= Math.ceil(ids.length / 2);
          },
          { timeout: 90_000, intervals: [1000] },
        )
        .toBe(true);
      const errors = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>(".sim-frame[data-frame]")].flatMap((el) => {
          const s = el.querySelector("iframe")?.contentWindow?.__hypercube;
          return s ? [...s.errors] : [];
        }),
      );
      expect(errors).toEqual([]);
      expect(problems).toEqual([]);
    });
  });
}
