import { expect, type Page, test } from "@playwright/test";
import { watchPage } from "../scripts/lib/play.mjs";

/**
 * X-Ray Diffraction's wave and crystal chapters (1, 2, 3 and 10) on a panel: each chapter's key
 * move, made with real pointer events on its controls, changes its figure and shows its "So"
 * line; and the Maths fold opens, where touching a formula part makes it pulse with its
 * counterpart in the figure.
 */

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface CardState {
  chapter: string;
  mode: string;
  maths: boolean;
  linked: string | null;
  so: boolean;
  state: number[];
  numbers: string[];
  controls: { id: string; kind: string; rect: Rect }[];
}
interface FrameState {
  unit: number;
  layer: { ready: boolean } | null;
  cards: CardState[];
}

declare global {
  interface Window {
    __xrd?: {
      state(): FrameState;
      part(card: number, part: string): Rect | null;
      stopAttract(): void;
    };
  }
}

const open = async (page: Page, chapter: string) => {
  await page.setViewportSize({ width: 450, height: 800 });
  const q = new URLSearchParams({
    app: "xrd",
    kind: "panel",
    fit: "1080x1920",
    bots: "0",
    seed: "e2e",
    "o.chapter": chapter,
  });
  await page.goto(`play/?${q}`);
  await page.waitForFunction(() => window.__xrd?.state() !== undefined, undefined, {
    timeout: 30_000,
  });
  // The page's frames can start late on a fresh browser; the chapters update on them.
  await frames(page, 3);
  // Stop the attract demo, so only these touches move anything.
  await page.evaluate(() => window.__xrd!.stopAttract());
  await page.waitForTimeout(300);
};

/** Wait for `n` animation frames, each of which runs the chapters' updates. */
const frames = (page: Page, n: number) =>
  page.evaluate(
    (k) =>
      new Promise<void>((done) => {
        let left = k;
        const tick = () => (--left <= 0 ? done() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    n,
  );

const card = (page: Page) => page.evaluate(() => window.__xrd!.state().cards[0]!);
const status = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as { __hypercube: { appStatus(): Record<string, unknown> } }
    ).__hypercube.appStatus(),
  );
const control = async (page: Page, id: string) => {
  const c = (await card(page)).controls.find((k) => k.id === id);
  expect(c, `control ${id}`).toBeTruthy();
  return c!.rect;
};

/** Real pointer events along venue points: down at the first, a move a frame, up at the last. */
const drag = (page: Page, path: { x: number; y: number }[], pointerId = 11) =>
  page.evaluate(
    async ({ pts, id }) => {
      const st = window.__xrd!.state();
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
      await new Promise((res) => setTimeout(res, 30));
      fire("pointerup", at(pts[pts.length - 1]!));
    },
    { pts: path, id: pointerId },
  );

const tap = (page: Page, p: { x: number; y: number }, id = 12) => drag(page, [p], id);
const mid = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

/** A turn of a wheel (no label) by `turns` of a full turn, clockwise positive, from its marker at `deg`. */
const wheelPath = (r: Rect, fromDeg: number, perTurn: number, by: number) => {
  const c = mid(r);
  const rr = (Math.min(r.width, r.height) / 2 - 4) * 0.72;
  const a0 = Math.PI / 2 - (fromDeg / perTurn) * Math.PI * 2;
  const turn = -(by / perTurn) * Math.PI * 2;
  const steps = Math.max(8, Math.ceil(Math.abs(turn) / 0.15));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = a0 + (turn * i) / steps;
    return { x: c.x + rr * Math.cos(a), y: c.y - rr * Math.sin(a) };
  });
};

/** The So line's DOM text is the chapter's, and visible. */
const soShows = async (page: Page, text: string) => {
  await expect(page.getByText(text, { exact: true })).toBeVisible();
};

test.describe("xrd waves", () => {
  test.describe.configure({ timeout: 90_000 });

  test("spectrum: sliding the wave to X-rays shows the So line", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "spectrum");
    let c = await card(page);
    expect(c.chapter).toBe("spectrum");
    expect(c.so).toBe(false);
    const before = c.state[0]!;
    expect((await status(page)).xray).toBe(false);
    const r = await control(page, "wave");
    // The slider's track runs along its foot; slide from the knob to near the short end.
    const y = r.y + r.height - Math.min(r.height * 0.27, 44) - 6;
    const x0 = r.x + 44 + ((1.477 + 6.28) / 13.477) * (r.width - 88);
    const x1 = r.x + 44 + ((1.477 + 9.8) / 13.477) * (r.width - 88);
    await drag(
      page,
      Array.from({ length: 16 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / 15, y })),
    );
    await expect.poll(async () => (await card(page)).so).toBe(true);
    c = await card(page);
    expect(c.state[0]!).toBeLessThan(before - 20_000);
    expect((await status(page)).band).toBe("xray");
    expect(c.numbers[0]).toMatch(/keV/);
    await soShows(
      page,
      "Visible light is thousands of times longer than an X-ray, far too long to measure the gaps between atoms.",
    );
    expect(problems).toEqual([]);
  });

  test("interference: a full add then a full cancel shows the So line", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "interference");
    expect((await card(page)).so).toBe(false);
    const r = await control(page, "dial");
    // The attract demo may have nudged the dial before it stopped; turn from wherever it is.
    const phi0 = (await card(page)).state[0]!;
    // Back to in step: bright.
    await drag(page, wheelPath(r, phi0, 360, -phi0));
    await expect.poll(async () => (await card(page)).state[0]).toBe(0);
    await frames(page, 3);
    expect((await status(page)).bright).toBeGreaterThan(0.98);
    expect((await card(page)).so).toBe(false);
    // Half a wave on: dark.
    await drag(page, wheelPath(r, 0, 360, 180), 13);
    await expect.poll(async () => (await card(page)).state[0]).toBe(180);
    expect((await status(page)).bright).toBeLessThan(0.02);
    await expect.poll(async () => (await card(page)).so).toBe(true);
    await soShows(page, "Moving one wave by just half a wavelength turns bright into dark.");
    // Dragging the lower slit moves it along the wall and the fringes with it.
    const slitBefore = (await status(page)).slit as number;
    const s = await control(page, "slit");
    const from = mid(s);
    await drag(
      page,
      Array.from({ length: 10 }, (_, i) => ({ x: from.x, y: from.y - (i * 60) / 9 })),
      14,
    );
    await expect.poll(async () => (await status(page)).slit).not.toBe(slitBefore);
    expect(problems).toEqual([]);
  });

  test("crystal: picking a crystal shows its layers and the So line", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "crystal");
    // The 3D view comes up.
    await expect
      .poll(async () => (await page.evaluate(() => window.__xrd!.state().layer?.ready)) ?? false, {
        timeout: 20_000,
      })
      .toBe(true);
    let c = await card(page);
    expect(c.so).toBe(false);
    // Diamond: the third tile. A child's tap: the zoom, then its first family of layers.
    const tiles = await control(page, "tiles");
    const w = (tiles.width - 14 * 5) / 6;
    await tap(page, { x: tiles.x + 2 * (w + 14) + w / 2, y: tiles.y + tiles.height / 2 });
    await expect.poll(async () => (await card(page)).state[0]).toBe(2);
    expect((await status(page)).crystal).toBe("diamond");
    // Turn it by dragging the figure.
    const yaw = (await card(page)).state[2]!;
    const turn = await control(page, "turn");
    const m = mid(turn);
    await drag(
      page,
      Array.from({ length: 12 }, (_, i) => ({ x: m.x - 100 + (200 * i) / 11, y: m.y })),
      15,
    );
    await expect.poll(async () => (await card(page)).state[2]).not.toBe(yaw);
    await expect.poll(async () => (await card(page)).state[1], { timeout: 15_000 }).toBe(1);
    await expect.poll(async () => (await card(page)).so).toBe(true);
    c = await card(page);
    expect(c.numbers.join(" ")).toMatch(/\(1 1 1\): d = 3\.57 \/ √3 = 2\.059 Å/);
    await soShows(
      page,
      "Because the pattern repeats, the atoms line up in flat layers that are all the same distance apart.",
    );
    // The watch view turns to look along the layers.
    await expect.poll(async () => (await card(page)).state[5]).toBe(20);
    // The Layers button steps to the next family.
    const layers = await control(page, "layers");
    await tap(page, mid(layers), 16);
    await expect.poll(async () => (await card(page)).state[1]).toBe(2);
    expect((await card(page)).numbers.join(" ")).toMatch(/\(2 2 0\)/);
    expect(problems).toEqual([]);
  });

  test("helix: two strands, and a twist, change the X and show the So line", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "helix");
    expect((await card(page)).so).toBe(false);
    const [p0] = (await card(page)).state;
    // Twist: the wheel stretches the pitch.
    const twist = await control(page, "twist");
    await drag(page, wheelPath(twist, p0! / 10 - 20, 40, 12));
    await expect.poll(async () => (await card(page)).state[0]!).toBeGreaterThan(400);
    await expect.poll(async () => (await card(page)).so).toBe(true);
    const angle = (await status(page)).angle as number;
    expect(angle).toBeGreaterThan(32);
    // Two strands: the fourth row goes.
    const strands = await control(page, "strands");
    await tap(page, { x: strands.x + strands.width * 0.75, y: strands.y + strands.height / 2 }, 17);
    await expect.poll(async () => (await card(page)).state[2]).toBe(2);
    expect((await card(page)).numbers.join(" ")).toMatch(/row 4 cancels/);
    // The two-strand line takes the caption slot while two strands show.
    await soShows(
      page,
      "With two strands offset like DNA's, the fourth row cancels out, like a missing spot.",
    );
    await soShows(
      page,
      "The X's angle shows how steep the helix is, and the gaps between its rows show how long each turn is.",
    );
    expect(problems).toEqual([]);
  });

  test("the Maths fold opens, and touching a formula part makes it pulse", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "interference");
    expect((await card(page)).maths).toBe(false);
    await tap(page, mid(await control(page, "maths")));
    await expect.poll(async () => (await card(page)).maths).toBe(true);
    for (const part of ["phi", "lam"]) {
      const r = await page.evaluate((p) => window.__xrd!.part(0, p), part);
      expect(r, part).toBeTruthy();
      await tap(page, mid(r!), 20 + part.length);
      await expect.poll(async () => (await card(page)).linked).toBe(part);
    }
    // The live numbers follow the dial.
    const c = await card(page);
    expect(c.numbers[0]).toContain(`φ = ${c.state[0]}°`);
    // Close it again.
    await tap(page, mid(await control(page, "maths")), 30);
    await expect.poll(async () => (await card(page)).maths).toBe(false);
    expect(problems).toEqual([]);
  });
});
