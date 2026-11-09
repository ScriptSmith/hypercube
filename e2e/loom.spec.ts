import { expect, type Page, test } from "@playwright/test";
import { watchPage } from "../scripts/lib/play.mjs";

/**
 * Fourier Loom: sliders and dials through real pointer events, a harmonic going auto when let
 * go, bots matching targets, and in the sim's banks the threads carrying on across the bezel
 * into the screen and the frames standing in for the screen when it goes.
 */

interface Term {
  amp: number;
  phase: number;
}
interface StrandState extends Term {
  k: number;
  live: boolean;
  held: number;
  hint: Term | null;
  ok: boolean;
}
interface Slider {
  x: number;
  y0: number;
  y1: number;
  w: number;
  h: number;
}
interface Circle {
  x: number;
  y: number;
  r: number;
}
interface FrameState {
  screen: false;
  unit: number;
  bank: boolean;
  conducting: boolean;
  following: string | null;
  followScreen: boolean;
  picture: boolean;
  n: number;
  target: string | null;
  mode: string | null;
  matches: number;
  peopleMatches: number;
  woven: number;
  strands: StrandState[];
  layout: { strands: { k: number; slider: Slider; dial: Circle }[] };
}
interface ScreenState {
  screen: true;
  n: number;
  width: number;
  target: string | null;
  matches: number;
  peopleMatches: number;
  live: boolean[];
  stations: number;
  woven: number;
}
interface Edges {
  clock: number;
  edges: { k: number; u: number }[];
}

declare global {
  interface Window {
    __loom?: { state(): FrameState | ScreenState; edges(): Edges; command(name: string): void };
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
    app: "loom",
    kind,
    fit: `${w}x${h}`,
    bots: "0",
    seed: "e2e",
    debug: "1",
  });
  for (const [k, v] of Object.entries(params)) q.set(k, String(v));
  await page.goto(`play/?${q}`);
  await page.waitForFunction(() => window.__loom?.state() !== undefined, undefined, {
    timeout: 30_000,
  });
};

const state = (page: Page) => page.evaluate(() => window.__loom!.state() as FrameState);

/** Real pointer events along a path of venue points: down at the first, moves, up at the last. */
const drag = (page: Page, path: { x: number; y: number }[], pointerId: number, holdMs = 0) =>
  page.evaluate(
    async ({ pts, id, hold }) => {
      const st = window.__loom!.state() as { unit: number };
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

const sliderAt = (s: Slider, amp: number) => ({ x: s.x, y: s.y0 + (s.y1 - s.y0) * amp });

/** Drag a strand's slider from where its handle is to `amp`. */
const setSlider = async (page: Page, j: number, amp: number, holdMs = 0) => {
  const st = await state(page);
  const s = st.layout.strands[j]!.slider;
  const from = st.strands[j]!.amp;
  const path = Array.from({ length: 12 }, (_, i) => sliderAt(s, from + ((amp - from) * i) / 11));
  await drag(page, path, 7000 + j, holdMs);
};

/** Drag round a strand's dial by `turn` radians, clockwise positive, from `start`. */
const turnDial = async (page: Page, j: number, turn: number, start = -Math.PI / 2) => {
  const d = (await state(page)).layout.strands[j]!.dial;
  const steps = Math.max(8, Math.ceil(Math.abs(turn) / 0.08));
  const path = Array.from({ length: steps + 1 }, (_, i) => {
    const a = start + (turn * i) / steps;
    return { x: d.x + Math.cos(a) * d.r * 0.65, y: d.y + Math.sin(a) * d.r * 0.65 };
  });
  await drag(page, path, 7100 + j);
};

const wrapDelta = (a: number, b: number) => {
  const d = (((b - a) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return d > Math.PI ? d - 2 * Math.PI : d;
};

test.describe("loom", () => {
  test.describe.configure({ timeout: 150_000 });

  test("a slider sets the amplitude, a dial turns the phase, and a harmonic let go goes auto", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await open(page, "panel", { "o.hints": "false" });
    const before = await state(page);
    expect(before.strands).toHaveLength(5);
    expect(before.strands.every((s) => !s.live)).toBe(true);
    // Harmonic 2 of a square wants nothing; set it to 0.6.
    await setSlider(page, 1, 0.6);
    let st = await state(page);
    expect(st.strands[1]!.live).toBe(true);
    expect(st.strands[1]!.amp).toBeCloseTo(0.6, 1);
    const p0 = st.strands[1]!.phase;
    await turnDial(page, 1, Math.PI / 2);
    st = await state(page);
    expect(wrapDelta(p0, st.strands[1]!.phase)).toBeCloseTo(Math.PI / 2, 1);
    // Its column is wrong for the square, so no match while it is live.
    expect(st.strands[1]!.ok).toBe(false);
    // Let go: after a few seconds it is auto again and eases back to nothing.
    await expect
      .poll(async () => (await state(page)).strands[1]!.live, { timeout: 15_000 })
      .toBe(false);
    await expect
      .poll(async () => (await state(page)).strands[1]!.amp, { timeout: 15_000 })
      .toBeLessThan(0.05);
    expect(problems).toEqual([]);
  });

  test("hint notches show where to go, and letting go near one settles onto it", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await open(page, "kiosk");
    // Wait for the square, then pull harmonic 1 away and back close to its notch.
    await expect.poll(async () => (await state(page)).target).toBe("square");
    const hint = (await state(page)).strands[0]!.hint!;
    expect(hint.amp).toBeCloseTo(0.8, 2);
    await setSlider(page, 0, 0.3);
    await setSlider(page, 0, hint.amp - 0.05);
    await expect
      .poll(async () => (await state(page)).strands[0]!.amp, { timeout: 5_000 })
      .toBeCloseTo(hint.amp, 3);
    expect((await state(page)).strands[0]!.live).toBe(true);
    expect(problems).toEqual([]);
  });

  test("bots match targets with injected touches on a solo panel", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "panel", { bots: 5 });
    await expect
      .poll(async () => (await state(page)).strands.filter((s) => s.live).length, {
        timeout: 20_000,
      })
      .toBeGreaterThanOrEqual(3);
    await expect
      .poll(async () => (await state(page)).peopleMatches, { timeout: 120_000, intervals: [2000] })
      .toBeGreaterThanOrEqual(2);
    const status = await page.evaluate(() => window.__hypercube!.appStatus());
    expect(Number(status.matches)).toBeGreaterThanOrEqual(1);
    expect(problems).toEqual([]);
  });

  test("free weave has no target, and a wall's untouched harmonics fade while one plays", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await open(page, "wall", { variant: "free", "o.harmonics": 6 });
    let st = await state(page);
    expect(st.strands).toHaveLength(6);
    expect(st.target).toBeNull();
    // Nobody plays: the harmonics drift through shapes on their own.
    await expect
      .poll(async () => (await state(page)).strands.some((s) => s.amp > 0.1), { timeout: 20_000 })
      .toBe(true);
    // Someone holds harmonic 1; the others fade.
    const others = () => state(page).then((s) => s.strands.slice(1).reduce((n, x) => n + x.amp, 0));
    const was = await others();
    await setSlider(page, 0, 0.9, 4000);
    st = await state(page);
    expect(st.strands[0]!.amp).toBeCloseTo(0.9, 1);
    if (was > 0.1) expect(await others()).toBeLessThan(was);
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
  inFrame(page, "a-screen", () => window.__loom?.state() as ScreenState | undefined);

interface Snap {
  id: string;
  pos: number;
  phase: string;
  errors: string[];
  st: FrameState | null;
}

/** Every touch frame's state. */
const frames = (page: Page): Promise<Snap[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".sim-frame[data-frame]")]
      .filter((el) => el.dataset.frame !== "a-screen")
      .map((el) => {
        const w = el.querySelector("iframe")?.contentWindow;
        return {
          id: el.dataset.frame ?? "?",
          pos: w?.__hypercube?.setup?.pos ?? -1,
          phase: w?.__hypercube?.phase ?? "loading",
          errors: w?.__hypercube ? [...w.__hypercube.errors] : ["missing"],
          st: (w?.__loom?.state() as FrameState | undefined) ?? null,
        };
      }),
  );

/**
 * Columns whose thread on the screen starts more than 3 venue px (screen px) from where its
 * frame's thread leaves the top edge. Every frame and the screen are read in one synchronous
 * pass, each at its own clock, so this includes clock differences. Harmonics with a finger on
 * them right now are skipped (their 20 Hz messages lag the finger by design).
 */
const misaligned = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const els = [...document.querySelectorAll<HTMLElement>(".sim-frame[data-frame]")];
    const screenWin = els
      .find((el) => el.dataset.frame === "a-screen")
      ?.querySelector("iframe")?.contentWindow;
    const scr = screenWin?.__loom;
    if (!scr) return ["no screen"];
    const s = scr.state() as ScreenState;
    const se = scr.edges();
    const out: string[] = [];
    let compared = 0;
    for (const el of els) {
      if (el.dataset.frame === "a-screen") continue;
      const w = el.querySelector("iframe")?.contentWindow;
      const l = w?.__loom;
      const pos = w?.__hypercube?.setup?.pos;
      if (!l || pos === undefined) {
        out.push(`${el.dataset.frame}: not running`);
        continue;
      }
      const st = l.state() as FrameState;
      const fe = l.edges();
      const per = fe.edges.length;
      const count = s.n / per;
      fe.edges.forEach((e, j) => {
        if (st.strands[j]!.held > 0) return;
        const want = ((pos + e.u) / count) * s.width;
        const got = se.edges[e.k - 1];
        if (!got) {
          out.push(`${el.dataset.frame}: no column ${e.k} on the screen`);
          return;
        }
        compared++;
        const x = got.u * s.width;
        if (Math.abs(x - want) > 3) {
          out.push(`${el.dataset.frame} k${e.k}: screen ${x.toFixed(1)}, frame ${want.toFixed(1)}`);
        }
      });
    }
    if (compared < 3) out.push(`only ${compared} columns compared`);
    return out;
  });

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

/** The screen goes: every frame shows the picture itself, the leftmost runs the rules. */
const fallBack = async (page: Page) => {
  await page.evaluate(() =>
    document.querySelector('.sim-frame[data-frame="a-screen"] iframe')?.remove(),
  );
  await expect
    .poll(
      async () => {
        const fs = await frames(page);
        return fs.every(
          (f) =>
            f.st?.picture === true &&
            f.st.conducting === (f.pos === 0) &&
            (f.pos === 0 || f.st.following !== null) &&
            f.st.target !== null,
        );
      },
      { timeout: 20_000, intervals: [500] },
    )
    .toBe(true);
  const after = await frames(page);
  expect(after.every((f) => f.phase === "running")).toBe(true);
  expect(after.flatMap((f) => f.errors)).toEqual([]);
  // Every frame shows the same target, from the leftmost.
  expect(new Set(after.map((f) => f.st!.target)).size).toBe(1);
};

test.describe("loom in a bank of panels", () => {
  test.describe.configure({ timeout: 300_000 });

  test("loom: bots match a target on the screen, the threads line up across the bezel, and the frames stand in when the screen goes (bank of panels)", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(`sim/?preset=bank-panels&app=loom&transport=local&bots=1&seed=e2e&debug=1`);
    await settle(page, 7);
    // Every frame follows the screen.
    await expect
      .poll(async () => (await frames(page)).every((f) => f.st?.followScreen === true), {
        timeout: 30_000,
      })
      .toBe(true);
    const st = (await screenState(page))!;
    expect(st.n).toBe(6);
    expect(st.stations).toBe(6);
    // The bots' harmonics are live on the screen, and they make a match.
    await expect
      .poll(async () => (await screenState(page))!.live.filter(Boolean).length, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(3);
    await expect
      .poll(async () => (await screenState(page))!.peopleMatches, {
        timeout: 150_000,
        intervals: [2000],
      })
      .toBeGreaterThanOrEqual(1);
    expect((await screenState(page))!.woven).toBeGreaterThanOrEqual(1);
    // The threads carry on across the bezel.
    await expect.poll(() => misaligned(page), { timeout: 15_000 }).toEqual([]);
    await fallBack(page);
    expect(problems).toEqual([]);
  });
});

test.describe("loom in a bank of pairs", () => {
  test.describe.configure({ timeout: 240_000 });

  test("loom: two harmonics per pair, every thread lined up with the screen's, and a fallback (bank of pairs)", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(`sim/?preset=bank-pairs&app=loom&transport=local&bots=0&seed=e2e&debug=1`);
    await settle(page, 4);
    await expect
      .poll(async () => (await frames(page)).every((f) => f.st?.followScreen === true), {
        timeout: 30_000,
      })
      .toBe(true);
    const fs = await frames(page);
    expect(fs.map((f) => f.st!.strands.map((s) => s.k)).sort((a, b) => a[0]! - b[0]!)).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
    expect((await screenState(page))!.n).toBe(6);
    // All auto: every column's thread meets its frame's within 3 px, now and a while later.
    await expect.poll(() => misaligned(page), { timeout: 15_000 }).toEqual([]);
    await page.waitForTimeout(3000);
    expect(await misaligned(page)).toEqual([]);
    await fallBack(page);
    expect(problems).toEqual([]);
  });
});
