import { expect, type Page, test } from "@playwright/test";
import { watchPage } from "../scripts/lib/play.mjs";

/**
 * Fourth Dimension: the lever, a dial, a "first" button, a shape button and the view, through
 * real pointer events; and in the sim's banks, every frame showing its own slice of one shared
 * orientation, a dial on one frame turning the screen and every frame, and the frames carrying
 * on when the screen goes.
 */

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface StageState {
  dim: number;
  mode: string;
  lever: number;
  cut: number;
  rot: number[];
  dials: number[];
  active: number | null;
  slice: { kind: string; size: number; faces: number };
  azimuth: number;
  caption: string | null;
}
interface FrameState {
  screen: false;
  unit: number;
  ready: boolean;
  pos: number;
  family: string;
  link: { leading: boolean; following: boolean; live: boolean } | null;
  layout: {
    stages: {
      dim: number;
      views: { kind: string; lane: Rect; focus: Rect }[];
      lever: { x0: number; x1: number; y: number; h: number };
      dials: { x: number; y: number; r: number }[];
      orients: { rect: Rect; k: number }[];
      shapes: { rect: Rect; family: number }[];
    }[];
  };
  stages: StageState[];
}
interface ScreenState {
  screen: true;
  ready: boolean;
  rot: number[];
  family: string;
  frames: { pos: number; cut: number; heard: boolean }[];
  slices: string[];
  link: { leading: boolean; live: boolean };
}

declare global {
  interface Window {
    __fourd?: { state(): FrameState | ScreenState };
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
    app: "fourd",
    kind,
    fit: `${w}x${h}`,
    bots: "0",
    seed: "e2e",
    debug: "1",
  });
  for (const [k, v] of Object.entries(params)) q.set(k, String(v));
  await page.goto(`play/?${q}`);
  await page.waitForFunction(
    () => (window.__fourd?.state() as { ready?: boolean } | undefined)?.ready === true,
    undefined,
    {
      timeout: 60_000,
    },
  );
};

const state = (page: Page) => page.evaluate(() => window.__fourd!.state() as FrameState);

/** Real pointer events along venue points, in the page or window `w`. */
const dragIn = (pts: { x: number; y: number }[], id: number, holdMs = 250) =>
  `(async () => {
    const pts = ${JSON.stringify(pts)};
    const st = window.__fourd.state();
    const stage = document.querySelector(".hc-stage");
    const r = stage.getBoundingClientRect();
    const k = st.unit * (r.width / stage.offsetWidth);
    const at = (p) => ({ clientX: r.left + p.x * k, clientY: r.top + p.y * k });
    const first = at(pts[0]);
    const target = document.elementFromPoint(first.clientX, first.clientY) ?? stage;
    const fire = (type, p) => target.dispatchEvent(new PointerEvent(type, { ...p, pointerId: ${id}, pointerType: "touch", bubbles: true, isPrimary: true, buttons: type === "pointerup" ? 0 : 1 }));
    fire("pointerdown", first);
    for (const p of pts.slice(1)) {
      await new Promise((res) => setTimeout(res, 16));
      fire("pointermove", at(p));
    }
    // A flick lifts straight after its last move; otherwise the finger rests first.
    if (${holdMs} > 0) await new Promise((res) => setTimeout(res, ${holdMs}));
    fire("pointerup", at(pts[pts.length - 1]));
  })()`;

const drag = (page: Page, pts: { x: number; y: number }[], id: number, holdMs = 250) =>
  page.evaluate(dragIn(pts, id, holdMs));

const leverPath = (l: { x0: number; x1: number; y: number }, t0: number, t1: number, n = 12) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = t0 + ((t1 - t0) * i) / n;
    return { x: l.x0 + ((t + 1) / 2) * (l.x1 - l.x0), y: l.y };
  });

const arc = (d: { x: number; y: number; r: number }, a0: number, a1: number, n = 24) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return { x: d.x + Math.cos(a) * d.r * 0.7, y: d.y + Math.sin(a) * d.r * 0.7 };
  });

const centre = (r: Rect) => [{ x: r.x + r.width / 2, y: r.y + r.height / 2 }];

const rotDistance = (a: number[], b: number[]) =>
  Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]!) ** 2, 0));

test.describe("fourd", () => {
  test.describe.configure({ timeout: 120_000 });

  test("the lever moves the slice, a dial turns the shape, and a first button turns it corner first", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await open(page, "panel");
    let st = await state(page);
    const L = st.layout.stages[0]!;
    expect(st.stages[0]!.mode).toBe("show");
    expect(st.stages[0]!.caption).not.toBeNull();
    // Push it through: from the start of the travel to the middle.
    await drag(page, leverPath(L.lever, -1, 0), 1);
    st = await state(page);
    const s0 = st.stages[0]!;
    expect(s0.mode).toBe("people");
    expect(s0.lever).toBeCloseTo(0, 1);
    expect(s0.caption).toBeNull();
    expect(s0.slice.kind).toBe("solid");
    // Then off the end: nothing left to slice.
    await drag(page, leverPath(L.lever, 0, 1), 2);
    await expect.poll(async () => (await state(page)).stages[0]!.slice.kind).toBe("none");
    await drag(page, leverPath(L.lever, 1, 0), 3);
    // Cell first again, then corner first: the middle slice becomes an octahedron (8 faces).
    await drag(page, centre(L.orients.find((o) => o.k === 3)!.rect), 4);
    await page.waitForTimeout(1700);
    await drag(page, centre(L.orients.find((o) => o.k === 0)!.rect), 5);
    await expect
      .poll(async () => (await state(page)).stages[0]!.slice.faces, { timeout: 5000 })
      .toBe(8);
    st = await state(page);
    expect(st.stages[0]!.active).toBe(0);
    // A dial turns the shape: the orientation changes, and so does the slice.
    const before = st.stages[0]!;
    await drag(page, arc(L.dials[0]!, 0, Math.PI / 3), 6);
    st = await state(page);
    const after = st.stages[0]!;
    expect(rotDistance(before.rot, after.rot)).toBeGreaterThan(0.3);
    expect(after.dials[0]).toBeCloseTo(Math.PI / 3, 1);
    expect(after.active).toBeNull();
    expect(
      Math.abs(after.slice.size - before.slice.size) > 0.01 ||
        after.slice.faces !== before.slice.faces,
    ).toBe(true);
    // A shape button picks another family.
    await drag(page, centre(L.shapes[3]!.rect), 7);
    await expect.poll(async () => (await state(page)).family).toBe("ball");
    await expect.poll(async () => (await state(page)).stages[0]!.slice.kind).toBe("ball");
    // Let go while still moving: the lever coasts on.
    await drag(page, leverPath(L.lever, -0.95, -0.35, 6), 8, 0);
    await page.waitForTimeout(1200);
    expect((await state(page)).stages[0]!.lever).toBeGreaterThan(-0.2);
    expect(problems).toEqual([]);
  });

  test("dragging the view turns the camera and leaves the slice alone", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "kiosk", { "o.spin": "false" });
    let st = await state(page);
    const L = st.layout.stages[0]!;
    await drag(page, leverPath(L.lever, -1, 0.1), 1);
    st = await state(page);
    const before = st.stages[0]!;
    const f = L.views[0]!.focus;
    const y = f.y + f.height / 2;
    await drag(
      page,
      Array.from({ length: 11 }, (_, i) => ({ x: f.x + f.width * (0.3 + 0.04 * i), y })),
      2,
    );
    st = await state(page);
    const after = st.stages[0]!;
    expect(Math.abs(after.azimuth - before.azimuth)).toBeGreaterThan(20);
    expect(rotDistance(before.rot, after.rot)).toBeLessThan(1e-9);
    expect(after.cut).toBeCloseTo(before.cut, 9);
    expect(problems).toEqual([]);
  });

  test("a wall's ladder: each stage has its own lever", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "wall");
    let st = await state(page);
    expect(st.stages.map((s) => s.dim)).toEqual([2, 3, 4]);
    const L = st.layout.stages[0]!;
    await drag(page, leverPath(L.lever, -1, 0), 1);
    st = await state(page);
    expect(st.stages[0]!.mode).toBe("people");
    expect(st.stages[0]!.slice.kind).toBe("span");
    expect(st.stages[1]!.mode).toBe("show");
    expect(st.stages[2]!.mode).toBe("show");
    // The flat world's slice is a polygon; the 4D stage's is a solid, both mid-show.
    await drag(page, leverPath(st.layout.stages[1]!.lever, -1, 0), 2);
    st = await state(page);
    expect(st.stages[1]!.slice.kind).toBe("polygon");
    expect(problems).toEqual([]);
  });

  test("ladder off: three 4D stages; flat world: a cube's slices on a sheet", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "wall", { "o.ladder": "false" });
    expect((await state(page)).stages.map((s) => s.dim)).toEqual([4, 4, 4]);
    await open(page, "pair", { variant: "flat" });
    expect((await state(page)).stages.map((s) => s.dim)).toEqual([3, 3]);
    await open(page, "screen");
    const st = await state(page);
    expect(st.stages.map((s) => s.dim)).toEqual([2, 3, 4]);
    expect(st.stages.every((s) => s.mode === "show")).toBe(true);
    expect(problems).toEqual([]);
  });
});

/** Evaluate in one sim frame. */
const inFrame = <T>(page: Page, id: string, src: string): Promise<T> =>
  page.evaluate(
    ([frameId, code]) => {
      const w = document.querySelector<HTMLIFrameElement>(
        `.sim-frame[data-frame="${frameId}"] iframe`,
      )?.contentWindow as (Window & typeof globalThis) | null;
      if (!w) throw new Error(`no frame ${frameId}`);
      return w.eval(code) as T;
    },
    [id, src] as const,
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
                (w) =>
                  w?.__hypercube?.phase === "running" &&
                  w.__hypercube.room === "online" &&
                  (w.__fourd?.state() as { ready?: boolean } | undefined)?.ready,
              ).length &&
            wins.filter((w) => w?.__hypercube?.net?.isHub).length === 1 &&
            all.length
          );
        }),
      { timeout: 150_000, intervals: [1000] },
    )
    .toBe(count);

/** Every touch frame's state and the screen's, read in one pass. */
const snapshot = (page: Page) =>
  page.evaluate(() => {
    const els = [...document.querySelectorAll<HTMLElement>(".sim-frame[data-frame]")];
    let screen: ScreenState | null = null;
    const frames: { id: string; phase: string; errors: string[]; st: FrameState | null }[] = [];
    for (const el of els) {
      const w = el.querySelector("iframe")?.contentWindow;
      const st = w?.__fourd?.state();
      if (el.dataset.frame === "a-screen") screen = (st as ScreenState | undefined) ?? null;
      else
        frames.push({
          id: el.dataset.frame ?? "?",
          phase: w?.__hypercube?.phase ?? "loading",
          errors: w?.__hypercube ? [...w.__hypercube.errors] : ["missing"],
          st: (st as FrameState | undefined) ?? null,
        });
    }
    return { screen: screen as ScreenState | null, frames };
  });

for (const preset of ["bank-panels", "bank-pairs"] as const) {
  test.describe(`fourd in the sim's ${preset}`, () => {
    test.describe.configure({ timeout: 360_000 });

    test(`fourd: each frame its own slice of one turn; a dial turns everyone; frames carry on without the screen (${preset})`, async ({
      page,
    }) => {
      const problems = watchPage(page);
      const n = preset === "bank-panels" ? 6 : 3;
      await page.setViewportSize({ width: 1600, height: 1000 });
      await page.goto(`sim/?preset=${preset}&app=fourd&transport=local&bots=0&seed=e2e&debug=1`);
      await settle(page, n + 1);
      // Every frame follows the screen, at its own depth, on one orientation.
      await expect
        .poll(
          async () => (await snapshot(page)).frames.every((f) => f.st?.link?.following === true),
          { timeout: 30_000 },
        )
        .toBe(true);
      let snap = await snapshot(page);
      const cuts = snap.frames.map((f) => f.st!.stages[0]!.cut);
      expect(new Set(cuts.map((c) => c.toFixed(4))).size).toBe(n);
      for (let i = 1; i < n; i++) {
        const byPos = [...snap.frames].sort((a, b) => a.st!.pos - b.st!.pos);
        expect(byPos[i]!.st!.stages[0]!.cut).toBeGreaterThan(byPos[i - 1]!.st!.stages[0]!.cut);
      }
      const rots = snap.frames.map((f) => f.st!.stages[0]!.rot);
      for (const r of rots) expect(rotDistance(r, rots[0]!)).toBeLessThan(0.05);
      expect(snap.screen!.frames.map((f) => f.pos)).toEqual(Array.from({ length: n }, (_, i) => i));
      expect(snap.screen!.slices.every((k) => k !== "off")).toBe(true);
      // A person turns a dial on the third frame: the screen and every frame turn with it.
      const third = [...snap.frames].sort((a, b) => a.st!.pos - b.st!.pos)[2]!;
      const d = third.st!.layout.stages[0]!.dials[0]!;
      await inFrame(page, third.id, dragIn(arc(d, 0, Math.PI / 2), 1));
      await expect
        .poll(
          async () => {
            const s = await snapshot(page);
            if (!s.screen?.link.live) return "not live";
            const far = s.frames.filter(
              (f) => rotDistance(f.st!.stages[0]!.rot, s.screen!.rot) > 0.02,
            );
            return far.length === 0 ? "ok" : `${far.length} apart`;
          },
          { timeout: 10_000 },
        )
        .toBe("ok");
      // The screen goes: frames keep running, one leads, and a dial still turns them all.
      await page.evaluate(() =>
        document.querySelector('.sim-frame[data-frame="a-screen"] iframe')?.remove(),
      );
      await expect
        .poll(async () => (await snapshot(page)).frames.filter((f) => f.st?.link?.leading).length, {
          timeout: 20_000,
        })
        .toBe(1);
      snap = await snapshot(page);
      expect(snap.frames.every((f) => f.phase === "running")).toBe(true);
      expect(snap.frames.flatMap((f) => f.errors)).toEqual([]);
      const leader = snap.frames.find((f) => f.st!.link!.leading)!;
      const other = snap.frames.find((f) => !f.st!.link!.leading)!;
      const before = leader.st!.stages[0]!.rot;
      const od = other.st!.layout.stages[0]!.dials[1]!;
      await inFrame(page, other.id, dragIn(arc(od, 0, Math.PI / 2), 2));
      await expect
        .poll(
          async () => {
            const s = await snapshot(page);
            const lead = s.frames.find((f) => f.id === leader.id)!.st!.stages[0]!.rot;
            if (rotDistance(lead, before) < 0.3) return "not turned";
            const far = s.frames.filter((f) => rotDistance(f.st!.stages[0]!.rot, lead) > 0.02);
            return far.length === 0 ? "ok" : `${far.length} apart`;
          },
          { timeout: 15_000 },
        )
        .toBe("ok");
      expect(problems).toEqual([]);
    });
  });
}
