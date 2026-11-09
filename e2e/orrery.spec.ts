import { expect, type Page, test } from "@playwright/test";
import { watchPage } from "../scripts/lib/play.mjs";

/**
 * Sun, Earth and Moon: turning the year wheel, the tilt slider, the place slider and the flat
 * orbit through real pointer events; and in the sim's banks, one frame's wheel moving the
 * screen's Earth and every frame's Sun, and the frames carrying on when the screen goes.
 */

interface Circle {
  x: number;
  y: number;
  r: number;
}
interface Slider {
  x0: number;
  x1: number;
  y: number;
  r: number;
}
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface State {
  variant: string;
  kind: string;
  screen: boolean;
  bank: boolean;
  pos: number;
  unit: number;
  ready: boolean;
  mode: string;
  deciding: boolean;
  leader: string | null;
  spaceShown: boolean;
  sky: { day: number; hour: number; tilt: number; flat: boolean; speed: number };
  date: string;
  lambda: number;
  places: {
    lat: number;
    name: string | null;
    dayLength: number;
    noonAlt: number;
    sun: { alt: number; az: number };
  }[];
  moon: { elong: number; phase: string; eclipse: string | null; beta: number };
  eclipsed: string | null;
  bodies: { earth: [number, number, number]; moon: [number, number, number] } | null;
  caption: string | null;
  markers: number[];
  layout: {
    wheel: Circle | null;
    dial: Circle | null;
    tilt: Slider | null;
    places: Slider[];
    flat: Rect | null;
  };
}

declare global {
  interface Window {
    __orrery?: {
      state(): State;
      claim(knob: string, a: number, b?: number): void;
      hours(h: number): void;
    };
  }
}

const SIZES: Record<string, [number, number]> = {
  pair: [2160, 1920],
  wall: [5760, 2160],
  panel: [1080, 1920],
  kiosk: [1920, 1080],
  screen: [4000, 3600],
};

const open = async (page: Page, kind: string, params: Record<string, string | number> = {}) => {
  const [w, h] = SIZES[kind]!;
  const scale = Math.min(1000 / w, 800 / h);
  await page.setViewportSize({ width: Math.round(w * scale), height: Math.round(h * scale) });
  const q = new URLSearchParams({
    app: "orrery",
    kind,
    fit: `${w}x${h}`,
    bots: "0",
    seed: "e2e",
    debug: "1",
  });
  for (const [k, v] of Object.entries(params)) q.set(k, String(v));
  await page.goto(`play/?${q}`);
  await page.waitForFunction(() => window.__orrery?.state().ready === true, undefined, {
    timeout: 30_000,
  });
};

const state = (page: Page) => page.evaluate(() => window.__orrery!.state());

/** Real pointer events along venue points in the page's stage: down, a move a frame, up. */
const drag = (page: Page, path: { x: number; y: number }[], pointerId: number, holdMs = 0) =>
  page.evaluate(
    async ({ pts, id, hold }) => {
      const st = window.__orrery!.state();
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

const arc = (c: Circle, a0: number, a1: number, rr = c.r * 0.7, n = 30) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return { x: c.x + rr * Math.cos(a), y: c.y - rr * Math.sin(a) };
  });

const along = (s: Slider, u0: number, u1: number, n = 20) =>
  Array.from({ length: n + 1 }, (_, i) => ({
    x: s.x0 + (s.x1 - s.x0) * (u0 + ((u1 - u0) * i) / n),
    y: s.y,
  }));

const YEAR = 365.2422;

test.describe("orrery", () => {
  test.describe.configure({ timeout: 120_000 });

  test("turning the year wheel moves the Earth round the Sun and changes the day length", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await open(page, "panel");
    let st = await state(page);
    expect(st.mode).toBe("tour");
    // Start from the June solstice at noon with the Earth's tilt, as a visitor's earlier turns
    // would have left it (the tour has a spell with no tilt).
    await page.evaluate(() => window.__orrery!.claim("tilt", 23.44));
    await page.evaluate(() => window.__orrery!.claim("time", 9668.5 - 0.5, 12));
    await expect.poll(async () => (await state(page)).date).toBe("21 June");
    st = await state(page);
    const june = st.places[0]!.dayLength;
    const earth0 = st.bodies!.earth;
    expect(june).toBeCloseTo(10.26, 1);
    // A half turn anticlockwise is half a year: December, long days in Brisbane.
    const w = st.layout.wheel!;
    await drag(page, arc(w, 0, Math.PI, w.r * 0.7, 40), 11, 150);
    st = await state(page);
    expect(st.mode).toBe("manual");
    expect(st.date).toMatch(/December/);
    expect(st.places[0]!.dayLength).toBeGreaterThan(13.5);
    expect(st.places[0]!.noonAlt).toBeGreaterThan(84);
    // The Earth is across the Sun from where it was.
    const e1 = st.bodies!.earth;
    expect(earth0[0] * e1[0] + earth0[2] * e1[2]).toBeLessThan(0);
    expect(problems).toEqual([]);
  });

  test("with no tilt every day is 12 h long, all year, everywhere", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "wall");
    let st = await state(page);
    const t = st.layout.tilt!;
    // Drag the tilt down to the left end.
    await drag(page, along(t, 0.26, 0.0), 21, 100);
    st = await state(page);
    expect(st.sky.tilt).toBe(0);
    for (const p of st.places) expect(p.dayLength).toBeCloseTo(12, 6);
    // Turn the year on a quarter and a half: still 12 h in Brisbane and London.
    const w = st.layout.wheel!;
    for (const turn of [Math.PI / 2, Math.PI]) {
      const before = st.sky.day;
      await drag(page, arc(w, 0, turn, w.r * 0.7, 30), 22, 120);
      st = await state(page);
      expect(st.sky.day - before).toBeCloseTo((YEAR * turn) / (2 * Math.PI), 0);
      for (const p of st.places) expect(p.dayLength).toBeCloseTo(12, 6);
    }
    expect(st.caption).toMatch(/No tilt/);
    // Reset brings the Earth's tilt back.
    await page.getByRole("button", { name: "Reset" }).dispatchEvent("pointerdown");
    await expect
      .poll(async () => (await state(page)).sky.tilt, { timeout: 5000 })
      .toBeCloseTo(23.44, 2);
    expect(problems).toEqual([]);
  });

  test("the place slider walks the ground view to the pole, into polar day", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "pair");
    await page.evaluate(() => window.__orrery!.claim("tilt", 23.44));
    await page.evaluate(() => window.__orrery!.claim("time", 9668, 12));
    await expect.poll(async () => (await state(page)).sky.tilt).toBe(23.44);
    let st = await state(page);
    expect(st.places[0]!.name).toBe("Brisbane");
    const s = st.layout.places[0]!;
    await drag(page, along(s, (90 + 27.5) / 180, 0.01), 31, 100);
    st = await state(page);
    expect(st.places[0]!.lat).toBe(90);
    expect(st.places[0]!.name).toBeNull();
    expect(st.places[0]!.dayLength).toBe(24);
    expect(problems).toEqual([]);
  });

  test("a flat orbit brings an eclipse at a full Moon that misses the shadow", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "kiosk", { variant: "moon" });
    // The full Moon of 31 May 2026 passes south of the Earth's shadow; stop time there.
    await page.evaluate(() => window.__orrery!.claim("speed", 0));
    await page.evaluate(() => window.__orrery!.claim("time", 9647, 18));
    await expect.poll(async () => (await state(page)).moon.phase).toBe("full");
    let st = await state(page);
    expect(st.moon.eclipse).toBeNull();
    expect(st.eclipsed).toBeNull();
    await page.getByRole("button", { name: "Flat orbit" }).dispatchEvent("pointerdown");
    await expect
      .poll(async () => (await state(page)).moon.eclipse, { timeout: 5000 })
      .toBe("lunar");
    st = await state(page);
    expect(st.sky.flat).toBe(true);
    expect(st.eclipsed).toBe("lunar");
    expect(st.caption).toMatch(/eclipse of the Moon/);
    expect(problems).toEqual([]);
  });

  test("a screen on its own runs the tour", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "screen");
    const a = await state(page);
    expect(a.mode).toBe("tour");
    expect(a.spaceShown).toBe(true);
    await page.waitForTimeout(1500);
    const b = await state(page);
    // The tour moves the date, turns the Earth through a day, or changes the tilt.
    const moved =
      b.sky.day + b.sky.hour / 24 !== a.sky.day + a.sky.hour / 24 || b.sky.tilt !== a.sky.tilt;
    expect(moved).toBe(true);
    expect(problems).toEqual([]);
  });
});

// ---- Banks ---------------------------------------------------------------------------------------

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
          st: w?.__orrery?.state() ?? null,
        };
      }),
  );

const screenState = (page: Page) => inFrame(page, "a-screen", () => window.__orrery!.state());

/** Turn a frame's wheel with real pointer events inside its iframe. */
const turnWheel = (page: Page, id: string, turn: number) =>
  inFrame(
    page,
    id,
    async (t: number) => {
      const st = window.__orrery!.state();
      const w = st.layout.wheel!;
      const stage = document.querySelector<HTMLElement>(".hc-stage")!;
      const r = stage.getBoundingClientRect();
      const k = st.unit * (r.width / stage.offsetWidth);
      const pt = (a: number) => ({
        clientX: r.left + (w.x + w.r * 0.7 * Math.cos(a)) * k,
        clientY: r.top + (w.y - w.r * 0.7 * Math.sin(a)) * k,
      });
      const first = pt(0);
      const target = document.elementFromPoint(first.clientX, first.clientY) ?? stage;
      const fire = (type: string, p: { clientX: number; clientY: number }) =>
        target.dispatchEvent(
          new PointerEvent(type, {
            ...p,
            pointerId: 41,
            pointerType: "touch",
            bubbles: true,
            isPrimary: true,
            buttons: type === "pointerup" ? 0 : 1,
          }),
        );
      fire("pointerdown", first);
      for (let i = 1; i <= 30; i++) {
        await new Promise((res) => setTimeout(res, 20));
        fire("pointermove", pt((t * i) / 30));
      }
      await new Promise((res) => setTimeout(res, 200));
      fire("pointerup", pt(t));
    },
    turn,
  );

test.describe("orrery in banks", () => {
  test.describe.configure({ timeout: 300_000 });

  test("orrery: a wheel on one frame moves the screen's Earth and every frame's Sun, and frames carry on without the screen (bank of panels)", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(`sim/?preset=bank-panels&app=orrery&transport=local&bots=0&seed=e2e&debug=1`);
    await settle(page, 7);
    await expect
      .poll(
        async () =>
          (await frames(page)).every((f) => f.st?.leader === "a-screen" && !f.st.deciding),
        {
          timeout: 30_000,
        },
      )
      .toBe(true);
    // Each frame stands at its own latitude, north to south, Brisbane among them; the screen
    // marks them all.
    const fs = await frames(page);
    const lats = fs.map((f) => f.st!.places[0]!.lat);
    for (let i = 1; i < lats.length; i++) expect(lats[i]!).toBeLessThan(lats[i - 1]!);
    expect(fs.filter((f) => f.st!.places[0]!.name === "Brisbane")).toHaveLength(1);
    expect(fs.every((f) => !f.st!.spaceShown)).toBe(true);
    expect((await screenState(page)).markers).toEqual([0, 1, 2, 3, 4, 5]);
    // The tour may be in its spell with no tilt, when half a year changes nothing; a visitor on
    // the first frame puts the Earth's tilt back first.
    await inFrame(page, fs[0]!.id, () => window.__orrery!.claim("tilt", 23.44));
    await expect
      .poll(async () => (await frames(page)).every((f) => f.st!.sky.tilt === 23.44), {
        timeout: 5000,
      })
      .toBe(true);
    const scr0 = await screenState(page);
    const earth0 = scr0.bodies!.earth;
    const suns0 = (await frames(page)).map((f) => f.st!.places[0]!.sun.alt);
    // Someone turns the fourth frame's wheel half round: half a year on, everywhere.
    const id = fs.find((f) => f.st!.pos === 3)!.id;
    await turnWheel(page, id, Math.PI);
    // The screen's Earth goes across to the other side of the Sun.
    await expect
      .poll(
        async () => {
          const e = (await screenState(page)).bodies!.earth;
          return Math.hypot(e[0] - earth0[0], e[2] - earth0[2]);
        },
        { timeout: 5000 },
      )
      .toBeGreaterThan(10);
    const scr = await screenState(page);
    expect(scr.sky.day - scr0.sky.day).toBeCloseTo(365.2422 / 2, -1);
    await expect
      .poll(
        async () => {
          const now = await frames(page);
          const s = await screenState(page);
          return now.every(
            (f) => f.st!.mode === "manual" && Math.abs(f.st!.sky.day - s.sky.day) < 0.01,
          );
        },
        { timeout: 5000 },
      )
      .toBe(true);
    const fs1 = await frames(page);
    const moved = fs1.filter((f, i) => Math.abs(f.st!.places[0]!.sun.alt - suns0[i]!) > 2);
    expect(moved.length).toBeGreaterThan(3);
    // The screen goes: each frame keeps the date it had and decides for itself.
    const day = scr.sky.day;
    await page.evaluate(() =>
      document.querySelector('.sim-frame[data-frame="a-screen"] iframe')?.remove(),
    );
    await expect
      .poll(
        async () => (await frames(page)).every((f) => f.st?.leader !== "a-screen" || f.st.deciding),
        {
          timeout: 20_000,
        },
      )
      .toBe(true);
    const after = await frames(page);
    expect(after.every((f) => f.phase === "running")).toBe(true);
    expect(after.flatMap((f) => f.errors)).toEqual([]);
    for (const f of after) expect(Math.abs(f.st!.sky.day - day)).toBeLessThan(0.01);
    // Without the screen each frame shows the space view itself.
    await expect
      .poll(async () => (await frames(page)).filter((f) => f.st?.spaceShown).length, {
        timeout: 20_000,
      })
      .toBe(6);
    expect(problems).toEqual([]);
  });

  test("orrery: three pairs share the Moon's month with the screen (bank of pairs)", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(
      `sim/?preset=bank-pairs&app=orrery&variant=moon&transport=local&bots=1&seed=e2e&debug=1`,
    );
    await settle(page, 4);
    await expect
      .poll(async () => (await screenState(page)).markers.join(","), { timeout: 30_000 })
      .toBe("0,1,2");
    // Bots turn the wheels: the screen takes their claims and every pair follows its state.
    await expect
      .poll(async () => (await screenState(page)).mode, { timeout: 40_000 })
      .toBe("manual");
    await expect
      .poll(
        async () => {
          const s = await screenState(page);
          const fs = await frames(page);
          // A pair whose bot holds its wheel shows its own turn until it lets go.
          return fs.filter((f) => Math.abs(f.st!.moon.elong - s.moon.elong) < 15).length >= 2;
        },
        { timeout: 10_000 },
      )
      .toBe(true);
    const fs = await frames(page);
    expect(fs.map((f) => f.st!.places[0]!.lat)).toEqual([75, -27.5, -75]);
    // A pair keeps its space view in one half and the ground in the other.
    expect(fs.every((f) => f.st!.spaceShown)).toBe(true);
    expect(problems).toEqual([]);
  });
});
