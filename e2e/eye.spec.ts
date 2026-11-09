import { expect, type Page, test } from "@playwright/test";
import { watchPage } from "../scripts/lib/play.mjs";

/**
 * Eye Lab: real pointer events on the eye's parts, the eye length slider, the glasses and the
 * condition tiles, checking the caption card, the view caption and the simulated view; and in
 * the sim's bank, the screen showing a column for every frame, following a frame's change, and
 * the frames carrying on when it goes.
 */

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface FrameState {
  screen: false;
  kind: string;
  unit: number;
  pos: number;
  mode: string;
  look: string;
  openness: number;
  isolate: boolean;
  ready: boolean;
  eye: { condition: string; length: number; correction: string; looking: string };
  refraction: { h: number; v: number };
  lens: { kind: string; power: { h: number; v: number } } | null;
  part: string | null;
  card: { title: string; line: { text: string } } | null;
  pages: string[];
  viewCaption: string | null;
  blurPx: number[];
  blurs: number;
  sliders: string[];
  hearsScreen: boolean;
  screenUp: boolean;
  layout: {
    eye: Rect;
    views: { rect: Rect }[];
    sliderSlots: Rect[];
    tiles: Rect[];
    buttons: Record<string, Rect | undefined>;
    chips: Rect[];
  };
}
interface ScreenState {
  screen: true;
  bank: boolean;
  ready: boolean;
  count: number;
  heard: number;
  columns: { pos: number; condition: string; heard: boolean }[];
  cells: { name: string; caption: string }[];
}

declare global {
  interface Window {
    __eye?: {
      state(): FrameState | ScreenState;
      where(part: string): { x: number; y: number } | null;
      condition(c: string): void;
      pose(over: Record<string, unknown>, part?: string | null): void;
    };
  }
}

const SIZES = {
  panel: [1080, 1920],
  pair: [2160, 1920],
  wall: [5760, 2160],
  kiosk: [1920, 1080],
  screen: [4000, 3600],
} as const;

const open = async (page: Page, kind: keyof typeof SIZES, params: Record<string, string> = {}) => {
  const [w, h] = SIZES[kind];
  const scale = Math.min(1000 / w, 800 / h);
  await page.setViewportSize({ width: Math.round(w * scale), height: Math.round(h * scale) });
  const q = new URLSearchParams({
    app: "eye",
    kind,
    fit: `${w}x${h}`,
    bots: "0",
    seed: "e2e",
    debug: "1",
    ...params,
  });
  await page.goto(`play/?${q}`);
  await page.waitForFunction(() => window.__eye?.state()?.ready === true, undefined, {
    timeout: 60_000,
  });
};

const state = (page: Page) => page.evaluate(() => window.__eye!.state() as FrameState);

/** A real touch (pointer events) at stage CSS px, or at venue px when `venue` is set. */
const tap = (page: Page, x: number, y: number, venue = false) =>
  page.evaluate(
    async ({ x, y, venue }) => {
      const st = window.__eye!.state() as { unit: number };
      const stage = document.querySelector<HTMLElement>(".hc-stage")!;
      const r = stage.getBoundingClientRect();
      const k = (venue ? st.unit : 1) * (r.width / stage.offsetWidth);
      const p = { clientX: r.left + x * k, clientY: r.top + y * k };
      const target = document.elementFromPoint(p.clientX, p.clientY) ?? stage;
      const fire = (type: string) =>
        target.dispatchEvent(
          new PointerEvent(type, {
            ...p,
            pointerId: 7,
            pointerType: "touch",
            bubbles: true,
            isPrimary: true,
            buttons: type === "pointerup" ? 0 : 1,
          }),
        );
      fire("pointerdown");
      await new Promise((res) => setTimeout(res, 60));
      fire("pointerup");
    },
    { x, y, venue },
  );

/** A real drag along venue points. */
const drag = (page: Page, pts: { x: number; y: number }[]) =>
  page.evaluate(async (path) => {
    const st = window.__eye!.state() as { unit: number };
    const stage = document.querySelector<HTMLElement>(".hc-stage")!;
    const r = stage.getBoundingClientRect();
    const k = st.unit * (r.width / stage.offsetWidth);
    const at = (p: { x: number; y: number }) => ({
      clientX: r.left + p.x * k,
      clientY: r.top + p.y * k,
    });
    const first = at(path[0]!);
    const target = document.elementFromPoint(first.clientX, first.clientY) ?? stage;
    const fire = (type: string, p: { clientX: number; clientY: number }) =>
      target.dispatchEvent(
        new PointerEvent(type, {
          ...p,
          pointerId: 8,
          pointerType: "touch",
          bubbles: true,
          isPrimary: true,
          buttons: type === "pointerup" ? 0 : 1,
        }),
      );
    fire("pointerdown", first);
    for (const p of path.slice(1)) {
      await new Promise((res) => setTimeout(res, 16));
      fire("pointermove", at(p));
    }
    fire("pointerup", at(path[path.length - 1]!));
  }, pts);

const centre = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

/** The simulated view's pixels, to tell whether a change shows in it. */
const viewShot = async (page: Page) => {
  const st = await state(page);
  const v = st.layout.views[0]!.rect;
  const stage = await page.evaluate(() => {
    const s = document.querySelector<HTMLElement>(".hc-stage")!;
    const r = s.getBoundingClientRect();
    return { left: r.left, top: r.top, k: r.width / s.offsetWidth };
  });
  const k = st.unit * stage.k;
  return page.screenshot({
    clip: {
      x: stage.left + v.x * k,
      y: stage.top + v.y * k,
      width: v.width * k,
      height: v.height * k,
    },
  });
};

test.describe("eye on a panel", () => {
  test.describe.configure({ timeout: 120_000 });

  for (const [variant, parts] of [
    ["real", ["cornea", "iris", "sclera"]],
    ["diagram", ["lens", "cornea", "disc"]],
  ] as const) {
    test(`eye: tapping a part of the eye shows its caption (${variant})`, async ({ page }) => {
      const problems = watchPage(page);
      await open(page, "panel", { variant });
      for (const part of parts) {
        const at = await page.evaluate((p) => window.__eye!.where(p), part);
        expect(at, part).not.toBeNull();
        // A second tap at the same spot looks one layer deeper (through the clear cornea).
        for (let i = 0; i < 4 && (await state(page)).part !== part; i++) {
          await tap(page, at!.x, at!.y);
          await page.waitForTimeout(150);
        }
        await expect.poll(async () => (await state(page)).part, { timeout: 5000 }).toBe(part);
        const st = await state(page);
        const card = await page.locator('[data-eye="card"]').textContent();
        expect(card).toContain(st.card!.line.text);
        expect(st.card!.title).toBe(
          { lens: "Lens", cornea: "Cornea", disc: "Optic disc", iris: "Iris", sclera: "Sclera" }[
            part
          ],
        );
      }
      expect(problems).toEqual([]);
    });
  }

  test("eye: the realistic eye opens for a part inside, and 'Only this part' shows it alone", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await open(page, "panel");
    let st = await state(page);
    // Whole at the start of the tour.
    expect(st.look).toBe("real");
    expect(st.openness).toBeLessThan(0.1);
    const next = centre(st.layout.buttons.next!);
    await tap(page, next.x, next.y, true);
    // Next part from none is the whole eye: still whole.
    expect((await state(page)).part).toBe("whole");
    await page.evaluate(() => window.__eye!.pose({}, "retina"));
    await expect
      .poll(async () => (await state(page)).openness, { timeout: 5000 })
      .toBeGreaterThan(0.95);
    st = await state(page);
    const only = centre(st.layout.buttons.only!);
    await tap(page, only.x, only.y, true);
    expect((await state(page)).isolate).toBe(true);
    await expect(page.locator('[data-eye="button-only"]')).toHaveText("Show all");
    await tap(page, only.x, only.y, true);
    expect((await state(page)).isolate).toBe(false);
    expect(problems).toEqual([]);
  });

  test("eye: the eye length slider changes the refraction and the blur, and glasses correct it", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await open(page, "panel");
    let st = await state(page);
    const slot = st.layout.sliderSlots[st.sliders.indexOf("length")]!;
    const y = slot.y + slot.height * 0.68;
    // Stop the tour, then drag the length to about 25.6 mm.
    await tap(page, centre(st.layout.tiles[0]!).x, centre(st.layout.tiles[0]!).y, true);
    const before = await viewShot(page);
    const farBlur = (await state(page)).blurPx[0]!;
    await drag(
      page,
      Array.from({ length: 10 }, (_, i) => ({ x: slot.x + slot.width * (0.5 + i * 0.03), y })),
    );
    st = await state(page);
    expect(st.eye.length).toBeGreaterThan(25.2);
    expect(st.refraction.h).toBeLessThan(-2.5);
    expect(st.blurPx[0]).toBeGreaterThan(farBlur + 3);
    expect(st.viewCaption).toContain("short sight");
    await expect
      .poll(async () => (await viewShot(page)).equals(before), { timeout: 5000 })
      .toBe(false);
    // Glasses: a minus lens, the far view sharp again, and the glasses' caption.
    await tap(page, centre(st.layout.buttons.corrA!).x, centre(st.layout.buttons.corrA!).y, true);
    st = await state(page);
    expect(st.eye.correction).toBe("glasses");
    expect(st.lens!.power.h).toBeLessThan(-2);
    expect(st.blurPx[0]).toBeLessThan(2);
    expect(st.viewCaption).toBeNull();
    expect(st.card!.line.text).toBe(
      "Glasses move the focus back onto the retina. Short sight needs a minus lens, and long sight needs a plus lens.",
    );
    expect(problems).toEqual([]);
  });

  test("eye: each condition tile shows its caption and changes the view", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "panel");
    let st = await state(page);
    await tap(page, centre(st.layout.tiles[0]!).x, centre(st.layout.tiles[0]!).y, true);
    await page.waitForTimeout(500);
    const typical = await viewShot(page);
    const names = [
      "Short sight (myopia)",
      "Long sight (hyperopia)",
      "Astigmatism",
      "Ageing focus (presbyopia)",
      "Cataract",
      "Glaucoma",
      "Macular degeneration",
      "Diabetic retinopathy",
      "Keratoconus",
      "Colour vision deficiency",
    ];
    for (let i = 1; i < 11; i++) {
      st = await state(page);
      await tap(page, centre(st.layout.tiles[i]!).x, centre(st.layout.tiles[i]!).y, true);
      await expect
        .poll(async () => (await state(page)).card?.title, { timeout: 5000 })
        .toBe(names[i - 1]);
      st = await state(page);
      expect(st.viewCaption, names[i - 1]).not.toBeNull();
      expect(await page.locator('[data-eye="view-caption"]').textContent()).toBe(st.viewCaption);
      await expect
        .poll(async () => (await viewShot(page)).equals(typical), { timeout: 8000 })
        .toBe(false);
    }
    expect(problems).toEqual([]);
  });
});

test.describe("eye on a wall", () => {
  test.describe.configure({ timeout: 120_000 });

  test("eye: part chips in reach pick parts; two views compare a typical eye", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "wall");
    const st = await state(page);
    expect(st.layout.views).toHaveLength(2);
    expect(st.layout.chips).toHaveLength(21);
    await tap(page, centre(st.layout.chips[13]!).x, centre(st.layout.chips[13]!).y, true);
    await expect.poll(async () => (await state(page)).part, { timeout: 5000 }).toBe("retina");
    expect(await page.locator('[data-eye="chip-retina"]').getAttribute("data-eye")).toBe(
      "chip-retina",
    );
    expect(problems).toEqual([]);
  });
});

test.describe("eye on a lone screen", () => {
  test("eye: a lone screen shows a gallery of conditions with their captions", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "screen");
    await page.waitForTimeout(1000);
    const st = (await page.evaluate(() => window.__eye!.state())) as ScreenState;
    expect(st.bank).toBe(false);
    expect(st.cells).toHaveLength(6);
    expect(new Set(st.cells.map((c) => c.name)).size).toBe(6);
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
    [...document.querySelectorAll<HTMLElement>(".sim-frame[data-frame]")]
      .filter((el) => el.dataset.frame !== "a-screen")
      .map((el) => {
        const w = el.querySelector("iframe")?.contentWindow;
        return {
          id: el.dataset.frame ?? "?",
          phase: w?.__hypercube?.phase ?? "loading",
          errors: w?.__hypercube ? [...w.__hypercube.errors] : ["missing"],
          st: (w?.__eye?.state() as FrameState | undefined) ?? null,
        };
      }),
  );

const screenState = (page: Page) =>
  inFrame(page, "a-screen", () => window.__eye?.state()) as Promise<ScreenState>;

test.describe("eye in a bank", () => {
  test.describe.configure({ timeout: 300_000 });

  test("eye: the screen shows every frame's eye, follows a change, and the frames carry on without it (bank of panels)", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(`sim/?preset=bank-panels&app=eye&transport=local&bots=0&seed=e2e&debug=1`);
    await expect
      .poll(async () => (await frames(page)).filter((f) => f.st?.hearsScreen).length, {
        timeout: 150_000,
        intervals: [1000],
      })
      .toBe(6);
    await expect.poll(async () => (await screenState(page)).heard, { timeout: 30_000 }).toBe(6);
    let scr = await screenState(page);
    expect(scr.count).toBe(6);
    expect(scr.columns.map((c) => c.pos)).toEqual([0, 1, 2, 3, 4, 5]);
    // With the screen there, the frames give their view's space to the eye.
    await expect
      .poll(async () => (await frames(page)).every((f) => f.st?.screenUp === true), {
        timeout: 15_000,
      })
      .toBe(true);
    // Someone picks colour vision deficiency on the fourth frame: its column follows.
    const id = (await frames(page)).find((f) => f.st?.pos === 3)!.id;
    await inFrame(page, id, () => window.__eye!.condition("cvd"));
    await expect
      .poll(async () => (await screenState(page)).columns.find((c) => c.pos === 3)?.condition, {
        timeout: 10_000,
      })
      .toBe("cvd");
    scr = await screenState(page);
    expect(scr.cells.some((c) => c.name === "Colour vision deficiency")).toBe(true);
    // The screen goes: every frame stops hearing it, gets its own view back and carries on.
    await page.evaluate(() =>
      document.querySelector('.sim-frame[data-frame="a-screen"] iframe')?.remove(),
    );
    await expect
      .poll(async () => (await frames(page)).every((f) => f.st?.screenUp === false), {
        timeout: 20_000,
      })
      .toBe(true);
    const after = await frames(page);
    expect(after.every((f) => f.phase === "running")).toBe(true);
    expect(after.flatMap((f) => f.errors)).toEqual([]);
    expect(after.every((f) => (f.st?.layout.views.length ?? 0) === 1)).toBe(true);
    expect(problems).toEqual([]);
  });
});
