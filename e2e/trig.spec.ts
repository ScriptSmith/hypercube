import { expect, type Page, test } from "@playwright/test";
import { watchPage } from "../scripts/lib/play.mjs";

/**
 * Unit Circle: turning the angle through real pointer events on the ring, the point, the wheel
 * and the graph, the readout's values, the toggles and the steps; and in the sim's banks, the
 * screen showing every frame's angle and the frames carrying on when it goes.
 */

interface Pic {
  cx: number;
  cy: number;
  r: number;
  x0: number;
  s: number;
  x1: number;
}
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface FrameState {
  screen: false;
  unit: number;
  kind: string;
  bank: boolean;
  pos: number;
  theta: number;
  deg: number;
  mode: string;
  auto: boolean;
  step: string | null;
  on: { sin: boolean; cos: boolean; tan: boolean };
  values: {
    sin: number;
    cos: number;
    tan: number | null;
    exact: { sin: string; cos: string; tan: string | null } | null;
  };
  hearsScreen: boolean;
  sends: number;
  touches: number;
  pic: Pic;
  layout: {
    pic: Pic;
    wheel: { x: number; y: number; r: number } | null;
    graph: Rect;
    toggles: { fn: string; rect: Rect }[];
  };
}
interface ScreenState {
  screen: true;
  bank: boolean;
  featured: number | null;
  step: string | null;
  frames: { pos: number; theta: number; own: boolean; held: boolean; beadX: number }[];
}

declare global {
  interface Window {
    __trig?: { state(): FrameState | ScreenState; pose(deg: number, step?: number | null): void };
  }
}

const SIZES: Record<"pair" | "wall" | "panel" | "kiosk" | "screen", [number, number]> = {
  pair: [2160, 1920],
  wall: [5760, 2160],
  panel: [1080, 1920],
  kiosk: [1920, 1080],
  screen: [4000, 3600],
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
    app: "trig",
    kind,
    fit: `${w}x${h}`,
    bots: "0",
    seed: "e2e",
    debug: "1",
  });
  for (const [k, v] of Object.entries(params)) q.set(k, String(v));
  await page.goto(`play/?${q}`);
  await page.waitForFunction(() => window.__trig?.state() !== undefined, undefined, {
    timeout: 30_000,
  });
};

const state = (page: Page) => page.evaluate(() => window.__trig!.state() as FrameState);

/**
 * Real pointer events along venue points: down at the first, a move a frame, up at the last.
 * Resolves to θ just after the finger went down, before anything else could turn it.
 */
const drag = (page: Page, path: { x: number; y: number }[], pointerId: number, holdMs = 0) =>
  page.evaluate(
    async ({ pts, id, hold }) => {
      const st = window.__trig!.state() as { unit: number };
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
      const atDown = (window.__trig!.state() as { theta: number }).theta;
      for (const p of pts.slice(1)) {
        await new Promise((res) => setTimeout(res, 16));
        fire("pointermove", at(p));
      }
      if (hold > 0) await new Promise((res) => setTimeout(res, hold));
      fire("pointerup", at(pts[pts.length - 1]!));
      return atDown;
    },
    { pts: path, id: pointerId, hold: holdMs },
  );

const onRing = (p: Pic, a: number, rr = p.r) => ({
  x: p.cx + rr * Math.cos(a),
  y: p.cy - rr * Math.sin(a),
});
const arc = (p: Pic, a0: number, a1: number, rr = p.r, n = 30) =>
  Array.from({ length: n + 1 }, (_, i) => onRing(p, a0 + ((a1 - a0) * i) / n, rr));

const DEG = Math.PI / 180;
const wrapDelta = (a: number, b: number) => {
  const d = (((b - a) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return d > Math.PI ? d - 2 * Math.PI : d;
};

/** The readout's values are those of the whole degree it shows. */
const valuesMatch = (st: FrameState) => {
  expect(Math.abs(wrapDelta(st.deg * DEG, st.theta))).toBeLessThanOrEqual(0.5 * DEG + 1e-9);
  const r = st.deg * DEG;
  expect(st.values.sin).toBeCloseTo(Math.sin(r), 9);
  expect(st.values.cos).toBeCloseTo(Math.cos(r), 9);
  if (st.deg % 180 === 90) expect(st.values.tan).toBeNull();
  else expect(st.values.tan!).toBeCloseTo(Math.tan(r), 6);
};

test.describe("trig", () => {
  test.describe.configure({ timeout: 120_000 });

  test("dragging the point and turning by the ring move the angle, and the values follow", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await open(page, "wall", { "o.snap": "false" });
    let st = await state(page);
    // The walk-through plays until someone touches.
    expect(st.auto).toBe(true);
    // The walk-through shows the circle larger; a finger turns it where it is drawn.
    const p = st.pic;
    expect(p.r).toBeGreaterThan(st.layout.pic.r);
    // Drag on the lower half of the ring (the reachable part) from 200° to 320°. The walk-through
    // keeps turning until the finger lands, so measure from there.
    const before = await drag(page, arc(p, 200 * DEG, 320 * DEG, p.r * 0.9), 11);
    st = await state(page);
    expect(st.auto).toBe(false);
    expect(wrapDelta(before, st.theta) / DEG).toBeCloseTo(120, -0.5);
    valuesMatch(st);
    // Now drag the point itself to 150°.
    // Let go, the circle slides back beside the waves.
    await expect.poll(async () => (await state(page)).pic.r).toBe(st.layout.pic.r);
    st = await state(page);
    const q = st.pic;
    await drag(page, arc(q, st.theta, 150 * DEG), 12);
    st = await state(page);
    expect(Math.abs(wrapDelta(st.theta, 150 * DEG)) / DEG).toBeLessThan(1.5);
    expect(st.deg).toBeGreaterThanOrEqual(149);
    expect(st.deg).toBeLessThanOrEqual(151);
    valuesMatch(st);
    expect(st.values.cos).toBeLessThan(0);
    expect(st.values.tan!).toBeLessThan(0);
    expect(problems).toEqual([]);
  });

  test("scrubbing the graph sets θ, and special angles show exact values", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "kiosk");
    let st = await state(page);
    // Touch the circle first so the whole picture shows.
    await drag(page, [onRing(st.pic, 1.5 * Math.PI, st.pic.r * 0.6)], 21, 50);
    await expect.poll(async () => (await state(page)).pic.r).toBe(st.layout.pic.r);
    st = await state(page);
    const p = st.pic;
    const y = p.cy + p.r * 0.4;
    const xs = [0.5, 1, 1.5, 2].map((a) => ({ x: p.x0 + a * p.s, y }));
    await drag(page, xs, 22, 300);
    st = await state(page);
    expect(st.theta).toBeCloseTo(2, 1);
    valuesMatch(st);
    // Scrub slowly onto 60°: the detent holds it there, exactly.
    const slow = Array.from({ length: 30 }, (_, i) => ({
      x: p.x0 + (55 + (i * 6) / 29) * DEG * p.s,
      y,
    }));
    await drag(page, slow, 23, 300);
    st = await state(page);
    expect(st.deg).toBe(60);
    expect(st.values.exact).toEqual({ sin: "√3/2", cos: "1/2", tan: "√3" });
    // Tap the 90° tick: tan has no value there.
    await drag(page, [{ x: p.x0 + 89 * DEG * p.s, y }], 24, 60);
    await expect.poll(async () => (await state(page)).deg).toBe(90);
    st = await state(page);
    expect(st.values.tan).toBeNull();
    expect(st.values.exact).toEqual({ sin: "1", cos: "0", tan: null });
    expect(problems).toEqual([]);
  });

  test("the wheel turns the angle one to one, and a flick coasts", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "panel", { "o.snap": "false" });
    let st = await state(page);
    const w = st.layout.wheel!;
    const pt = (a: number) => ({
      x: w.x + w.r * 0.7 * Math.cos(a),
      y: w.y - w.r * 0.7 * Math.sin(a),
    });
    const before = st.theta;
    await drag(
      page,
      Array.from({ length: 31 }, (_, i) => pt((i / 30) * 1.2)),
      31,
      200,
    );
    st = await state(page);
    expect(wrapDelta(before, st.theta)).toBeCloseTo(1.2, 1);
    // A quick turn, let go at once: it carries on by itself, then stops.
    await drag(
      page,
      Array.from({ length: 6 }, (_, i) => pt(1.2 + (i / 5) * 1.6)),
      32,
    );
    st = await state(page);
    expect(st.mode).toBe("coast");
    const at = st.theta;
    await page.waitForTimeout(300);
    expect(Math.abs(wrapDelta(at, (await state(page)).theta))).toBeGreaterThan(0.2);
    await expect.poll(async () => (await state(page)).mode, { timeout: 20_000 }).toBe("hold");
    expect(problems).toEqual([]);
  });

  test("toggles hide and show each function, and steps move with Next and Back", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await open(page, "pair", { variant: "steps" });
    expect((await state(page)).step).toBe("circle");
    await page.getByRole("button", { name: "tan" }).dispatchEvent("pointerdown");
    expect((await state(page)).on.tan).toBe(false);
    await page.getByRole("button", { name: "tan" }).dispatchEvent("pointerdown");
    expect((await state(page)).on.tan).toBe(true);
    const next = page.getByRole("button", { name: "Next" });
    for (let i = 0; i < 3; i++) await next.dispatchEvent("pointerdown");
    expect((await state(page)).step).toBe("tan");
    // Held: it stays on the step.
    await page.waitForTimeout(1500);
    expect((await state(page)).step).toBe("tan");
    await page.getByRole("button", { name: "Back" }).dispatchEvent("pointerdown");
    expect((await state(page)).step).toBe("squares");
    for (let i = 0; i < 9; i++) await next.dispatchEvent("pointerdown");
    expect((await state(page)).step).toBe("signs");
    expect(problems).toEqual([]);
  });

  test("Show me brings Back and Next, and stepping past the last step brings it back", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await open(page, "panel");
    const showMe = page.getByRole("button", { name: "Show me" });
    const next = page.getByRole("button", { name: "Next" });
    const back = page.getByRole("button", { name: "Back" });
    // The walk-through plays by itself with the step buttons; a touch shows everything.
    await expect(next).toBeVisible();
    await expect(showMe).toBeHidden();
    const st = await state(page);
    await drag(page, arc(st.pic, 200 * DEG, 260 * DEG, st.pic.r * 0.9), 21);
    expect((await state(page)).step).toBeNull();
    await expect(showMe).toBeVisible();
    await expect(next).toBeHidden();
    // Show me: the steps from the first, with Back and Next in its place.
    await showMe.dispatchEvent("pointerdown");
    expect((await state(page)).step).toBe("circle");
    await expect(next).toBeVisible();
    await expect(back).toBeVisible();
    await expect(showMe).toBeHidden();
    for (let i = 0; i < 3; i++) await next.dispatchEvent("pointerdown");
    expect((await state(page)).step).toBe("tan");
    await page.waitForTimeout(1500);
    expect((await state(page)).step).toBe("tan");
    await back.dispatchEvent("pointerdown");
    expect((await state(page)).step).toBe("squares");
    // On to the last step, then past it: everything, and Show me again.
    for (let i = 0; i < 4; i++) await next.dispatchEvent("pointerdown");
    expect((await state(page)).step).toBe("signs");
    await next.dispatchEvent("pointerdown");
    expect((await state(page)).step).toBeNull();
    await expect(showMe).toBeVisible();
    await expect(next).toBeHidden();
    expect(problems).toEqual([]);
  });

  test("a screen on its own plays the walk-through", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "screen");
    const st = (await page.evaluate(() => window.__trig!.state())) as ScreenState;
    expect(st.bank).toBe(false);
    expect(st.featured).toBeNull();
    expect(st.step).not.toBeNull();
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

const settle = async (page: Page, count: number) =>
  expect
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

/**
 * Every touch frame's angle against the screen's copy of it, read in one synchronous pass.
 * Returns the frames whose angles differ by more than `tol` degrees.
 */
const mismatched = (page: Page, tol: number): Promise<string[]> =>
  page.evaluate((tolDeg) => {
    const els = [...document.querySelectorAll<HTMLElement>(".sim-frame[data-frame]")];
    const scrWin = els
      .find((el) => el.dataset.frame === "a-screen")
      ?.querySelector("iframe")?.contentWindow;
    const scr = scrWin?.__trig?.state() as ScreenState | undefined;
    if (!scr) return ["no screen"];
    const out: string[] = [];
    let compared = 0;
    for (const el of els) {
      if (el.dataset.frame === "a-screen") continue;
      const st = el.querySelector("iframe")?.contentWindow?.__trig?.state() as
        | FrameState
        | undefined;
      if (!st) {
        out.push(`${el.dataset.frame}: not running`);
        continue;
      }
      // A frame on the move is drawn following its messages, a moment behind.
      if (!["tour", "hold"].includes(st.mode)) continue;
      const s = scr.frames.find((f) => f.pos === st.pos);
      if (!s) {
        out.push(`${el.dataset.frame}: not on the screen`);
        continue;
      }
      compared++;
      const d = ((((s.theta - st.theta) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
      if (Math.abs(d) > (tolDeg * Math.PI) / 180) {
        out.push(
          `${el.dataset.frame}: screen ${(s.theta * 57.3).toFixed(1)}, frame ${(st.theta * 57.3).toFixed(1)}`,
        );
      }
    }
    if (compared < 1) out.push(`only ${compared} compared`);
    return out;
  }, tol);

const frames = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".sim-frame[data-frame]")]
      .filter((el) => el.dataset.frame !== "a-screen")
      .map((el) => {
        const w = el.querySelector("iframe")?.contentWindow;
        return {
          id: el.dataset.frame ?? "?",
          phase: w?.__hypercube?.phase ?? "loading",
          errors: w?.__hypercube ? [...w.__hypercube.errors] : ["missing"],
          st: (w?.__trig?.state() as FrameState | undefined) ?? null,
        };
      }),
  );

test.describe("trig in a bank", () => {
  test.describe.configure({ timeout: 300_000 });

  test("trig: the screen shows every frame's angle, a turned frame's own, and the frames carry on without it (bank of panels)", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(`sim/?preset=bank-panels&app=trig&transport=local&bots=0&seed=e2e&debug=1`);
    await settle(page, 7);
    await expect
      .poll(async () => (await frames(page)).every((f) => f.st?.hearsScreen === true), {
        timeout: 30_000,
      })
      .toBe(true);
    const scr = (await inFrame(page, "a-screen", () => window.__trig?.state())) as ScreenState;
    expect(scr.frames.map((f) => f.pos)).toEqual([0, 1, 2, 3, 4, 5]);
    // Each bead above its own frame.
    expect(scr.frames.map((f) => f.beadX)).toEqual(
      [0, 1, 2, 3, 4, 5].map((i) => expect.closeTo((i + 0.5) / 6, 9)),
    );
    // Untouched, every frame is on the bank's slow turn, and the screen agrees from the clock.
    await expect.poll(() => mismatched(page, 3), { timeout: 15_000 }).toEqual([]);
    // The frames are spread round the turn: a travelling wave, not all in step.
    const thetas = (await frames(page)).map((f) => f.st!.theta);
    expect(new Set(thetas.map((t) => Math.round(t * 10))).size).toBeGreaterThan(3);
    // Someone turns the fourth frame to 135°: the screen shows it there and features it.
    const id = (await frames(page)).find((f) => f.st?.pos === 3)!.id;
    await inFrame(page, id, () => window.__trig!.pose(135));
    await expect
      .poll(
        async () => {
          const s = (await inFrame(page, "a-screen", () => window.__trig?.state())) as ScreenState;
          const f = s.frames.find((x) => x.pos === 3)!;
          return f.own && Math.abs(f.theta - (135 * Math.PI) / 180) < 0.02;
        },
        { timeout: 5_000 },
      )
      .toBe(true);
    await expect.poll(() => mismatched(page, 3), { timeout: 5_000 }).toEqual([]);
    // A few seconds later it has rejoined the wave.
    await expect
      .poll(
        async () =>
          (
            (await inFrame(page, "a-screen", () => window.__trig?.state())) as ScreenState
          ).frames.find((x) => x.pos === 3)!.own,
        { timeout: 15_000, intervals: [500] },
      )
      .toBe(false);
    await expect.poll(() => mismatched(page, 3), { timeout: 5_000 }).toEqual([]);
    // The screen goes: every frame stops hearing it and carries on by itself.
    await page.evaluate(() =>
      document.querySelector('.sim-frame[data-frame="a-screen"] iframe')?.remove(),
    );
    await expect
      .poll(async () => (await frames(page)).every((f) => f.st?.hearsScreen === false), {
        timeout: 15_000,
      })
      .toBe(true);
    const before = (await frames(page)).map((f) => f.st!.theta);
    await page.waitForTimeout(1500);
    const after = await frames(page);
    expect(after.every((f) => f.phase === "running")).toBe(true);
    expect(after.flatMap((f) => f.errors)).toEqual([]);
    expect(
      after.filter((f, i) => Math.abs(f.st!.theta - before[i]!) > 1e-3).length,
    ).toBeGreaterThan(3);
    expect(problems).toEqual([]);
  });

  test("trig: three pairs, one angle each, on the screen (bank of pairs)", async ({ page }) => {
    const problems = watchPage(page);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(`sim/?preset=bank-pairs&app=trig&transport=local&bots=1&seed=e2e&debug=1`);
    await settle(page, 4);
    await expect
      .poll(
        async () => {
          const s = (await inFrame(page, "a-screen", () => window.__trig?.state())) as ScreenState;
          return s.frames.map((f) => f.pos).join(",");
        },
        { timeout: 30_000 },
      )
      .toBe("0,1,2");
    // Bots turn the pairs: the screen follows them and features one.
    await expect
      .poll(
        async () =>
          ((await inFrame(page, "a-screen", () => window.__trig?.state())) as ScreenState).featured,
        { timeout: 30_000 },
      )
      .not.toBeNull();
    await expect.poll(() => mismatched(page, 6), { timeout: 15_000 }).toEqual([]);
    expect(problems).toEqual([]);
  });
});
