import { expect, type Page, test } from "@playwright/test";
import { watchPage } from "../scripts/lib/play.mjs";

/**
 * Robot Arm on single frames: dials turning joints through real pointer events, the first touch
 * taking an arm off its demonstration, the grip button, the clamp at the bench, hold-to-reset
 * and idle, and bots tidying and stacking with injected touches.
 */

interface Circle {
  x: number;
  y: number;
  r: number;
}
interface Vec {
  x: number;
  y: number;
  z: number;
}
interface CellState {
  mode: "demo" | "people";
  view: { azimuth: number; elevation: number };
  q: number[];
  target: number[];
  grip: { closed: boolean; gap: number; held: number | null };
  pose: { grip: Vec };
  counts: { grabs: number; sorted: number; towers: number; drops: number };
  clearance: number;
  pieces: { id: number; state: string; pos: Vec }[];
  lift: { active: boolean; needs: number[] } | null;
  beam: { u: number; w: number; visible: boolean } | null;
}
interface RaState {
  unit: number;
  ready: boolean;
  layout: {
    cells: {
      dials: (Circle & { joint: number })[];
      grip: Circle;
      reset: Circle;
      focus: { x: number; y: number; width: number; height: number };
    }[];
  };
  cells: CellState[];
}

declare global {
  interface Window {
    __robotarm?: { state(): RaState; command(name: string): void };
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
    app: "robotarm",
    kind,
    fit: `${w}x${h}`,
    bots: "0",
    seed: "e2e",
    debug: "1",
  });
  for (const [k, v] of Object.entries(params)) q.set(k, String(v));
  await page.goto(`play/?${q}`);
  await page.waitForFunction(() => window.__robotarm?.state().ready === true, undefined, {
    timeout: 30_000,
  });
};

const state = (page: Page) => page.evaluate(() => window.__robotarm!.state());

/** Real pointer events along a path of venue points: down at the first, moves, up at the last. */
const drag = (page: Page, path: { x: number; y: number }[], pointerId: number) =>
  page.evaluate(
    async ({ pts, id }) => {
      const st = window.__robotarm!.state();
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
      fire("pointerup", at(pts[pts.length - 1]!));
    },
    { pts: path, id: pointerId },
  );

/** Drag round a dial by `turn` radians, clockwise positive, starting at its top. */
const turnDial = async (page: Page, joint: number, turn: number, cell = 0) => {
  const d = (await state(page)).layout.cells[cell]!.dials[joint]!;
  const steps = Math.max(8, Math.ceil(Math.abs(turn) / 0.08));
  const path = Array.from({ length: steps + 1 }, (_, i) => {
    const a = -Math.PI / 2 + (turn * i) / steps;
    return { x: d.x + Math.cos(a) * d.r * 0.65, y: d.y + Math.sin(a) * d.r * 0.65 };
  });
  await drag(page, path, 7000 + joint);
};

const tap = async (page: Page, at: { x: number; y: number }, ms = 80) => {
  await drag(page, [at], 7100);
  if (ms > 80) await page.waitForTimeout(ms);
};

/** Hold a point for `ms` with a real pointer. */
const hold = (page: Page, at: { x: number; y: number }, ms: number) =>
  page.evaluate(
    async ({ p, wait }) => {
      const st = window.__robotarm!.state();
      const stage = document.querySelector<HTMLElement>(".hc-stage")!;
      const r = stage.getBoundingClientRect();
      const k = st.unit * (r.width / stage.offsetWidth);
      const clientX = r.left + p.x * k;
      const clientY = r.top + p.y * k;
      const target = document.elementFromPoint(clientX, clientY) ?? stage;
      const init = {
        clientX,
        clientY,
        pointerId: 7200,
        pointerType: "touch",
        bubbles: true,
        isPrimary: true,
      };
      target.dispatchEvent(new PointerEvent("pointerdown", { ...init, buttons: 1 }));
      await new Promise((res) => setTimeout(res, wait));
      target.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0 }));
    },
    { p: at, wait: ms },
  );

test.describe("robotarm", () => {
  test.describe.configure({ timeout: 150_000 });

  test("a dial turns its joint, and the first touch takes the arm off its demonstration", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await open(page, "panel");
    expect((await state(page)).cells[0]!.mode).toBe("demo");
    // Let the demonstration finish whatever it is doing with the base, then take over.
    const before = (await state(page)).cells[0]!.target[0]!;
    await turnDial(page, 0, Math.PI / 3);
    const after = (await state(page)).cells[0]!;
    expect(after.mode).toBe("people");
    expect(after.target[0]! - before).toBeGreaterThan(0.6);
    expect(after.target[0]! - before).toBeLessThan(1.5);
    // The joint follows the dial at its servo speed.
    const goal = after.target[0]!;
    await expect
      .poll(async () => Math.abs((await state(page)).cells[0]!.q[0]! - goal), { timeout: 15_000 })
      .toBeLessThan(0.01);
    // Anticlockwise turns it back.
    await turnDial(page, 0, -Math.PI / 6);
    expect((await state(page)).cells[0]!.target[0]!).toBeLessThan(goal - 0.3);
    expect(problems).toEqual([]);
  });

  test("a dial stops at its joint's limit", async ({ page }) => {
    await open(page, "kiosk");
    // The forearm roll goes to 170 degrees each way: three half turns clockwise end at the stop.
    for (let i = 0; i < 3; i++) await turnDial(page, 3, Math.PI * 0.9);
    const t = (await state(page)).cells[0]!.target[3]!;
    expect(t).toBeCloseTo((170 * Math.PI) / 180, 3);
  });

  test("the clamp stops the arm at the bench", async ({ page }) => {
    await open(page, "panel");
    // Lean the shoulder far forward: the gripper reaches the bench and stops there.
    await turnDial(page, 1, Math.PI * 0.55);
    await expect
      .poll(
        async () => {
          const c = (await state(page)).cells[0]!;
          return Math.abs(c.target[1]! - c.q[1]!) < 0.005 && c.clearance < 0.05;
        },
        { timeout: 20_000 },
      )
      .toBe(true);
    const c = (await state(page)).cells[0]!;
    expect(c.clearance).toBeGreaterThan(-0.02);
    expect(c.q[1]!).toBeLessThan((100 * Math.PI) / 180);
  });

  test("the grip button closes and opens the jaws", async ({ page }) => {
    await open(page, "pair");
    const g = (await state(page)).layout.cells[0]!.grip;
    // Hold the demonstration off first so it doesn't press the grip too.
    await turnDial(page, 0, 0.05);
    const was = (await state(page)).cells[0]!.grip.closed;
    await tap(page, g);
    expect((await state(page)).cells[0]!.grip.closed).toBe(!was);
    await page.waitForTimeout(500);
    await tap(page, g);
    expect((await state(page)).cells[0]!.grip.closed).toBe(was);
  });

  test("hold-to-reset sends the arm home and the pieces back; idle resumes the demonstration", async ({
    page,
  }) => {
    await open(page, "kiosk", { idle: 8 });
    const start = (await state(page)).cells[0]!.pieces.map((p) => p.pos);
    await turnDial(page, 0, 1);
    await page.waitForTimeout(1500);
    const moved = (await state(page)).cells[0]!;
    expect(moved.mode).toBe("people");
    expect(Math.abs(moved.q[0]!)).toBeGreaterThan(0.3);
    const reset = (await state(page)).layout.cells[0]!.reset;
    await hold(page, reset, 1400);
    const after = (await state(page)).cells[0]!;
    expect(Math.abs(after.q[0]!)).toBeLessThan(1e-6);
    expect(after.grip.held).toBeNull();
    after.pieces.forEach((p, i) => {
      expect(p.pos.x).toBeCloseTo(start[i]!.x, 5);
      expect(p.pos.z).toBeCloseTo(start[i]!.z, 5);
    });
    await expect
      .poll(async () => (await state(page)).cells[0]!.mode, { timeout: 30_000 })
      .toBe("demo");
  });

  test("dragging the view turns that arm's camera and leaves the arm to its demonstration", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await open(page, "wall", { "o.arms": 2, idle: 6 });
    const st = await state(page);
    expect(st.cells[1]!.view).toEqual({ azimuth: -36, elevation: 27 });
    // The wall's view is out of reach: drag on the free floor of the lane beside the controls.
    const lane = st.layout.cells[1]!;
    const right = Math.max(...lane.dials.map((d) => d.x + d.r), lane.reset.x + lane.reset.r);
    const x = right + 60;
    const y = 2000;
    const path = Array.from({ length: 16 }, (_, i) => ({ x: x - i * 12, y: y + i * 6 }));
    await drag(page, path, 7300);
    const after = (await state(page)).cells;
    expect(after[1]!.view.azimuth).toBeGreaterThan(-36 + 20);
    expect(after[1]!.view.elevation).toBeGreaterThan(27 + 5);
    expect(after[1]!.mode).toBe("demo");
    // The other arm's view is untouched.
    expect(after[0]!.view).toEqual({ azimuth: -36, elevation: 27 });
    // Idle sends the view home with everything else.
    await expect
      .poll(async () => (await state(page)).cells[1]!.view, { timeout: 20_000 })
      .toEqual({ azimuth: -36, elevation: 27 });
    expect(problems).toEqual([]);
  });

  test("a bot tidies pieces into their bins with injected touches", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "panel", { bots: 1 });
    await expect
      .poll(async () => (await state(page)).cells[0]!.mode, { timeout: 15_000 })
      .toBe("people");
    await expect
      .poll(async () => (await state(page)).cells[0]!.counts.sorted, {
        timeout: 120_000,
        intervals: [2000],
      })
      .toBeGreaterThanOrEqual(2);
    const status = await page.evaluate(() => window.__hypercube!.appStatus());
    expect(Number(status.sorted)).toBeGreaterThanOrEqual(2);
    expect(problems).toEqual([]);
  });

  test("bots stack a tower to the hoop on two wall arms", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "wall", { bots: 2, "o.arms": 2, variant: "stack" });
    const st = await state(page);
    expect(st.cells).toHaveLength(2);
    await expect
      .poll(async () => (await state(page)).cells.reduce((n, c) => n + c.counts.towers, 0), {
        timeout: 140_000,
        intervals: [2000],
      })
      .toBeGreaterThanOrEqual(1);
    expect(problems).toEqual([]);
  });
});

interface ScreenState {
  screen: true;
  columns: number;
  width: number;
  beams: { column: number; x: number; width: number }[];
  filled: number;
  total: number;
  counts: { arrived: number; placed: number };
  stations: number;
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
  inFrame(page, "a-screen", () => window.__robotarm?.state() as unknown as ScreenState | undefined);

/** Every touch frame's lift and status. */
const lifts = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".sim-frame[data-frame]")]
      .filter((el) => el.dataset.frame !== "a-screen")
      .map((el) => {
        const w = el.querySelector("iframe")?.contentWindow;
        const st = w?.__robotarm?.state();
        return {
          id: el.dataset.frame,
          phase: w?.__hypercube?.phase ?? "loading",
          errors: w?.__hypercube ? [...w.__hypercube.errors] : ["missing"],
          lift: st?.cells[0]?.lift ?? null,
          beam: st?.cells[0]?.beam ?? null,
          pos: w?.__hypercube?.setup?.pos ?? -1,
        };
      }),
  );

/** Columns whose beam on the screen is more than 3 venue px off its frame's, in place or width. */
const misaligned = async (page: Page): Promise<string[]> => {
  const st = await screenState(page);
  if (!st) return ["no screen"];
  const out: string[] = [];
  for (const l of await lifts(page)) {
    if (!l.beam?.visible) continue;
    const want = ((l.pos + l.beam.u) / st.columns) * st.width;
    const wantW = (l.beam.w * st.width) / st.columns;
    const got = st.beams.find((b) => b.column === l.pos);
    if (!got) out.push(`${l.id}: no beam on the screen`);
    else if (Math.abs(got.x - want) > 3 || Math.abs(got.width - wantW) > 3) {
      out.push(
        `${l.id}: screen ${got.x.toFixed(1)} wide ${got.width.toFixed(1)}, frame ${want.toFixed(1)} wide ${wantW.toFixed(1)}`,
      );
    }
  }
  return out;
};

/** Drag across one sim frame's view with real pointer events, turning its camera. */
const turnView = (page: Page, id: string) =>
  inFrame(page, id, async () => {
    const st = window.__robotarm!.state();
    const f = (
      st.layout.cells[0] as unknown as {
        focus: { x: number; y: number; width: number; height: number };
      }
    ).focus;
    const stage = document.querySelector<HTMLElement>(".hc-stage")!;
    const r = stage.getBoundingClientRect();
    const k = st.unit * (r.width / stage.offsetWidth);
    const x0 = r.left + (f.x + f.width * 0.5) * k;
    const y0 = r.top + (f.y + f.height * 0.3) * k;
    const target = document.elementFromPoint(x0, y0) ?? stage;
    const fire = (type: string, x: number) =>
      target.dispatchEvent(
        new PointerEvent(type, {
          clientX: x,
          clientY: y0,
          pointerId: 7400,
          pointerType: "touch",
          bubbles: true,
          buttons: type === "pointerup" ? 0 : 1,
        }),
      );
    fire("pointerdown", x0);
    for (let i = 1; i <= 20; i++) {
      await new Promise((res) => setTimeout(res, 30));
      fire("pointermove", x0 - (220 * k * i) / 20);
    }
    await new Promise((res) => setTimeout(res, 300));
    fire("pointerup", x0 - 220 * k);
  });

for (const [preset, frames] of [
  ["bank-panels", 7],
  ["bank-pairs", 4],
] as const) {
  test.describe(`robotarm in a ${preset} bank`, () => {
    test.describe.configure({ timeout: 240_000 });

    // The sim names pair frames `pair1`, `pair2` and so on.
    const third = preset === "bank-pairs" ? "a-pair3" : "a-p3";

    test(`robotarm: a bot's piece rises to the screen and fills a square; the lifts fall back when the screen goes (${preset})`, async ({
      page,
    }) => {
      const problems = watchPage(page);
      await page.setViewportSize({ width: 1600, height: 1000 });
      await page.goto(`sim/?preset=${preset}&app=robotarm&transport=local&bots=1&seed=e2e&debug=1`);
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
      // Every frame's lift comes on once the screen's word reaches it.
      await expect
        .poll(async () => (await lifts(page)).every((l) => l.lift?.active === true), {
          timeout: 30_000,
        })
        .toBe(true);
      // The bots send pieces up; the screen fills squares from them.
      await expect
        .poll(async () => (await screenState(page))?.counts.placed ?? 0, {
          timeout: 120_000,
          intervals: [2000],
        })
        .toBeGreaterThanOrEqual(2);
      const st = (await screenState(page))!;
      expect(st.filled).toBeGreaterThanOrEqual(2);
      expect(st.columns).toBe(frames - 1);
      expect(st.stations).toBe(frames - 1);

      // Every column's beam on the screen carries its frame's beam on: same place, same width.
      await expect.poll(() => misaligned(page), { timeout: 15_000 }).toEqual([]);
      // Someone turns the third frame's view: its beam moves, and the screen's follows.
      const before = (await lifts(page)).find((l) => l.id === third)!.beam!;
      await turnView(page, third);
      await expect
        .poll(
          async () => Math.abs((await lifts(page)).find((l) => l.id === third)!.beam!.u - before.u),
          {
            timeout: 10_000,
          },
        )
        .toBeGreaterThan(0.005);
      await expect.poll(() => misaligned(page), { timeout: 10_000 }).toEqual([]);

      // The screen goes: every lift hides within a few seconds, and the arms play on.
      await page.evaluate(() =>
        document.querySelector('.sim-frame[data-frame="a-screen"] iframe')?.remove(),
      );
      await expect
        .poll(async () => (await lifts(page)).every((l) => l.lift?.active === false), {
          timeout: 15_000,
          intervals: [500],
        })
        .toBe(true);
      const after = await lifts(page);
      expect(after.every((l) => l.phase === "running")).toBe(true);
      expect(after.flatMap((l) => l.errors)).toEqual([]);
      expect(problems).toEqual([]);
    });
  });
}
