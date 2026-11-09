import { expect, type Page, test } from "@playwright/test";
import { watchPage } from "../scripts/lib/play.mjs";

/**
 * X-Ray Diffraction, chapters 7, 8, 9 and 11 on a panel: each chapter's key move, made with real
 * pointer events, changes its picture and shows its "So" line; and the Maths fold opens and
 * touching a formula part pulses its counterpart in the figure.
 */

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface CardState {
  chapter: string;
  maths: boolean;
  linked: string | null;
  so: boolean;
  state: number[];
  layout: { watch: Rect; figure: Rect };
  controls: { id: string; kind: string; rect: Rect }[];
}
interface Debug {
  state(): { unit: number; cards: CardState[] };
  part(card: number, part: string): Rect | null;
  stopAttract(): void;
}
type Point = { x: number; y: number };

const W = 1080;
const H = 1920;

/**
 * Open a panel on chapter 1, stop its demo, then tap the chapter's tab as a person would: the
 * chapter's own demo never runs, so its "So" line starts hidden.
 */
const open = async (page: Page, chapter: string) => {
  const scale = Math.min(900 / W, 900 / H);
  await page.setViewportSize({ width: Math.round(W * scale), height: Math.round(H * scale) });
  const q = new URLSearchParams({
    app: "xrd",
    kind: "panel",
    fit: `${W}x${H}`,
    bots: "0",
    seed: "e2e",
    "o.chapter": "spectrum",
  });
  await page.goto(`play/?${q}`);
  await page.waitForFunction(
    () => (window as unknown as { __xrd?: Debug }).__xrd?.state() !== undefined,
    undefined,
    { timeout: 30_000 },
  );
  await page.evaluate(() => (window as unknown as { __xrd: Debug }).__xrd.stopAttract());
  await tap(page, middle(await control(page, `tab:${chapter}`)));
  await expect.poll(async () => (await card(page)).chapter).toBe(chapter);
};

const card = (page: Page) =>
  page.evaluate(() => (window as unknown as { __xrd: Debug }).__xrd.state().cards[0]!);

const control = async (page: Page, id: string) => {
  const c = (await card(page)).controls.find((k) => k.id === id);
  expect(c, `control ${id}`).toBeTruthy();
  return c!.rect;
};

const middle = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

/** Real pointer events along venue points: down at the first, a move a frame, up at the last. */
const touch = (page: Page, path: Point[], pointerId = 7) =>
  page.evaluate(
    async ({ pts, id }) => {
      const st = (window as unknown as { __xrd: Debug }).__xrd.state();
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
      await new Promise((res) => setTimeout(res, 40));
      fire("pointerup", at(pts[pts.length - 1]!));
    },
    { pts: path, id: pointerId },
  );

const tap = (page: Page, p: Point, id = 7) => touch(page, [p], id);

const line = (a: Point, b: Point, n = 14): Point[] =>
  Array.from({ length: n + 1 }, (_, i) => ({
    x: a.x + ((b.x - a.x) * i) / n,
    y: a.y + ((b.y - a.y) * i) / n,
  }));

/** A screenshot of a venue rect of the stage. */
const shot = async (page: Page, r: Rect) => {
  const clip = await page.evaluate((v) => {
    const st = (window as unknown as { __xrd: Debug }).__xrd.state();
    const stage = document.querySelector<HTMLElement>(".hc-stage")!;
    const b = stage.getBoundingClientRect();
    const k = st.unit * (b.width / stage.offsetWidth);
    return { x: b.left + v.x * k, y: b.top + v.y * k, width: v.width * k, height: v.height * k };
  }, r);
  return page.screenshot({ clip });
};

/** Wait a moment for the engine's next picture, then shoot the watch view. */
const watchShot = async (page: Page) => {
  await page.waitForTimeout(700);
  return shot(page, (await card(page)).layout.watch);
};

const status = (page: Page) => page.evaluate(() => window.__hypercube!.appStatus());

test.describe("xrd chapters 7, 8, 9 and 11", () => {
  test.describe.configure({ timeout: 90_000 });

  test("inverse: the wide tile squashes the crystal, the pattern goes tall, the So line shows", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await open(page, "inverse");
    let c = await card(page);
    expect(c.chapter).toBe("inverse");
    expect(c.so).toBe(false);
    const a0 = c.state[0];
    const before = await watchShot(page);
    const tiles = await control(page, "shape");
    // The third of three tiles: wide.
    const cellW = (tiles.width - 28) / 3;
    await tap(page, { x: tiles.x + 2 * (cellW + 14) + cellW / 2, y: tiles.y + tiles.height / 2 });
    await expect.poll(async () => (await card(page)).state.slice(0, 2)).toEqual([128, 64]);
    c = await card(page);
    expect(c.state[0]).not.toBe(a0);
    expect(c.so).toBe(true);
    expect((await watchShot(page)).equals(before)).toBe(false);
    // Fewer repeats: the slider, dragged to its left end.
    const slider = await control(page, "repeats");
    const y = slider.y + slider.height - 30;
    await touch(page, line({ x: slider.x + slider.width * 0.5, y }, { x: slider.x + 4, y }));
    await expect.poll(async () => (await card(page)).state[3]).toBe(2);
    expect(problems).toEqual([]);
  });

  test("absences: a heavy atom dragged to the middle cancels every other spot", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await open(page, "absences");
    let c = await card(page);
    expect(c.chapter).toBe("absences");
    expect(c.so).toBe(false);
    expect(c.state).toEqual([0, 0, 1, 0, 0, 0]);
    // Look at a spot that stays bright first: (1 1).
    await tap(page, middle(await control(page, "spot")));
    await expect.poll(async () => (await card(page)).state[5]).toBe(1);
    const before = await watchShot(page);
    // The cell is the square at the left of the pad, the tray beside it; the heavy atom waits in
    // the tray's lower slot, in a child's reach.
    const pad = await control(page, "cell");
    const cs = pad.height;
    const trayX = pad.x + cs + 22;
    const trayW = pad.x + pad.width - trayX;
    const tray0 = { x: trayX + trayW / 2, y: pad.y + cs - (cs - 22) / 4 };
    const mid = { x: pad.x + cs / 2, y: pad.y + cs / 2 };
    await touch(page, line(tray0, mid));
    await expect.poll(async () => (await card(page)).state.slice(1, 3)).toEqual([10, 1]);
    c = await card(page);
    expect(c.so).toBe(true);
    expect((await status(page)).centred).toBe(true);
    // The arrow sum moves to a spot that just vanished, (1 0), whose arrows cancel.
    await expect.poll(async () => (await card(page)).state[5]).toBe(0);
    expect((await status(page)).spot).toBe("(1 0)");
    expect((await watchShot(page)).equals(before)).toBe(false);
    // A tap on the atom makes it light: the spots come back, dimly.
    await tap(page, mid);
    await expect.poll(async () => (await card(page)).state[2]).toBe(0);
    expect((await status(page)).centred).toBe(false);
    // Potassium chloride, the third case, opens on (1 1), where its two kinds of ion cancel.
    await tap(page, middle(await control(page, "case2")));
    await expect.poll(async () => (await card(page)).state[0]).toBe(2);
    expect((await card(page)).state[5]).toBe(1);
    expect(problems).toEqual([]);
  });

  test("synthesis: adding every ripple brings the atoms out", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "synthesis");
    let c = await card(page);
    expect(c.chapter).toBe("synthesis");
    expect(c.so).toBe(false);
    const before = await watchShot(page);
    await tap(page, middle(await control(page, "addAll")));
    await expect.poll(async () => (await card(page)).so, { timeout: 15_000 }).toBe(true);
    await expect.poll(async () => (await status(page)).kept, { timeout: 15_000 }).toBe(24);
    expect((await watchShot(page)).equals(before)).toBe(false);
    // The swap shows a picture instead.
    const atoms = await watchShot(page);
    await tap(page, middle(await control(page, "swap")));
    await expect.poll(async () => (await status(page)).view).toBe("pictures");
    expect((await watchShot(page)).equals(atoms)).toBe(false);
    c = await card(page);
    expect(c.so).toBe(true);
    expect(problems).toEqual([]);
  });

  test("mystery: a wrong pick shows the difference, the right one the crystal", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await open(page, "mystery");
    let c = await card(page);
    expect(c.chapter).toBe("mystery");
    expect(c.so).toBe(false);
    const st = await status(page);
    const choices = String(st.choices).split(",");
    const answer = choices.indexOf(String(st.mystery));
    expect(answer).toBeGreaterThanOrEqual(0);
    const wrong = (answer + 1) % 3;
    const chart = await shot(page, c.layout.figure);
    await tap(page, middle(await control(page, `pick${wrong}`)));
    await expect.poll(async () => (await card(page)).state[1]).toBe(1 << wrong);
    expect((await card(page)).so).toBe(false);
    // The chart lines the mystery's strong rings up against the cards.
    await page.waitForTimeout(300);
    expect((await shot(page, c.layout.figure)).equals(chart)).toBe(false);
    const before = await watchShot(page);
    await tap(page, middle(await control(page, `pick${answer}`)));
    await expect.poll(async () => (await card(page)).state[2]).toBe(1);
    c = await card(page);
    expect(c.so).toBe(true);
    expect((await watchShot(page)).equals(before)).toBe(false);
    expect(problems).toEqual([]);
  });

  test("the Maths fold opens, and touching F in the formula pulses the arrow sum", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await open(page, "absences");
    await tap(page, middle(await control(page, "maths")));
    await expect.poll(async () => (await card(page)).maths).toBe(true);
    const part = await page.evaluate(() =>
      (window as unknown as { __xrd: Debug }).__xrd.part(0, "F"),
    );
    expect(part).not.toBeNull();
    const c = await card(page);
    await page.waitForTimeout(300);
    const before = await shot(page, c.layout.figure);
    await tap(page, middle(part!));
    await expect.poll(async () => (await card(page)).linked).toBe("F");
    expect((await shot(page, c.layout.figure)).equals(before)).toBe(false);
    expect(problems).toEqual([]);
  });
});
