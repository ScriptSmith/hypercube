import { expect, type Page, test } from "@playwright/test";
import { waitForRunning, watchPage } from "../scripts/lib/play.mjs";
import type {
  GlideSpec,
  KeySpec,
  MapSpec,
  PlateBox,
  Rect,
  SliderSpec,
} from "../src/apps/chladni/layout";
import {
  formModes,
  HOME,
  type Mode,
  modeId,
  modesFor,
  type PlateShape,
  type Point,
  ringsAt,
  shapeAt,
  turnToward,
} from "../src/apps/chladni/modes";

interface ChladniState {
  mode: string;
  shape: PlateShape;
  share: number;
  grains: number[];
  amps: number[][];
  levels: number[];
  strongest: string;
  remote: number[];
  remoteDrives: number;
  screenAttract: boolean;
  knobs: { stretch: number; damping: number; at: Point; wide: boolean }[];
  stretchNow: number[];
  rects: (Rect | null)[];
  freqs: number[][];
  layout: {
    keys: KeySpec[];
    glides: GlideSpec[];
    sliders: SliderSpec[];
    maps: MapSpec[];
    plates: PlateBox[];
    reach: { adult: number; child: number };
  };
}

interface ChladniDebug {
  state(): ChladniState;
  grains(plate?: number): { u: number[]; v: number[]; motion: number[]; active: number } | null;
  sprinkle(ms?: number): void;
  stopAttract(): void;
  loseContext(ms: number): boolean;
}

declare global {
  interface Window {
    __chladni?: ChladniDebug;
  }
}

const SIZES = {
  panel: { width: 1080, height: 1920 },
  kiosk: { width: 1920, height: 1080 },
  pair: { width: 2160, height: 1920 },
} as const;

const open = async (page: Page, kind: keyof typeof SIZES, extra = "") => {
  const size = SIZES[kind];
  const scale = Math.min(1000 / size.width, 900 / size.height);
  await page.setViewportSize({
    width: Math.round(size.width * scale),
    height: Math.round(size.height * scale),
  });
  await page.goto(
    `play/?app=chladni&kind=${kind}&fit=${size.width}x${size.height}&bots=0&seed=t&debug=1${extra}`,
  );
  expect((await waitForRunning(page)).phase).toBe("running");
  await page.waitForFunction(() => (window.__chladni?.state().grains[0] ?? 0) > 0);
  await page.evaluate(() => window.__chladni?.stopAttract());
};

const state = (page: Page) => page.evaluate(() => window.__chladni!.state());

/** Client coordinates of a venue point on the stage. */
const client = async (page: Page, kind: keyof typeof SIZES, x: number, y: number) => {
  const r = await page.locator(".hc-stage").boundingBox();
  const unit = r!.width / SIZES[kind].width;
  return { x: r!.x + x * unit, y: r!.y + y * unit };
};

/** Share of the moving grains that sit where `mode` is still (|w| below `limit`). */
const stillShare = async (
  page: Page,
  shape: PlateShape,
  mode: number,
  limit = 0.15,
  list: readonly Mode[] = modesFor(shape),
) => {
  const g = await page.evaluate(() => window.__chladni!.grains(0));
  if (!g) return 0;
  const m = list[mode]!;
  let still = 0;
  for (let i = 0; i < g.active; i++) if (Math.abs(shapeAt(m, g.u[i]!, g.v[i]!)) < limit) still++;
  return still / g.active;
};

/** Hold a key down with a touch of its own (so the mouse stays free), or let it go. */
const touchKey = (page: Page, kind: keyof typeof SIZES, key: KeySpec, down: boolean, id = 501) =>
  page.evaluate(
    ({ kx, ky, w, down, id }) => {
      const stage = document.querySelector<HTMLElement>(".hc-stage")!;
      const r = stage.getBoundingClientRect();
      const unit = r.width / w;
      const x = r.x + kx * unit;
      const y = r.y + ky * unit;
      document.elementFromPoint(x, y)!.dispatchEvent(
        new PointerEvent(down ? "pointerdown" : "pointerup", {
          clientX: x,
          clientY: y,
          pointerId: id,
          pointerType: "touch",
          bubbles: true,
          isPrimary: true,
        }),
      );
    },
    {
      kx: key.box.x + key.box.width / 2,
      ky: key.box.y + key.box.height / 2,
      w: SIZES[kind].width,
      down,
      id,
    },
  );

/** The frame point of a plate point on a drawn plate. */
const onRect = (r: Rect, p: Point) => ({
  x: r.cx + (p.u * r.width) / 2,
  y: r.cy + (p.v * r.height) / 2,
});

/** Drag with the mouse between two venue points. */
const drag = async (
  page: Page,
  kind: keyof typeof SIZES,
  from: { x: number; y: number },
  to: { x: number; y: number },
) => {
  const a = await client(page, kind, from.x, from.y);
  const b = await client(page, kind, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 16 });
  await page.mouse.up();
};

/** The point on a still line of `m` nearest to `near`, inside the plate. */
const stillNear = (m: Mode, near: Point): Point => {
  let best: Point = near;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i <= 400; i++) {
    const v = -0.9 + (1.8 * i) / 400;
    for (let j = 0; j < 400; j++) {
      const u = -0.9 + (1.8 * j) / 400;
      const a = shapeAt(m, u, v);
      const b = shapeAt(m, u + 0.0045, v);
      if (a * b > 0) continue;
      const p = { u: u + (0.0045 * a) / (a - b || 1), v };
      const d = Math.hypot(p.u - near.u, p.v - near.v);
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    }
  }
  return best;
};

for (const [kind, shape] of [
  ["panel", "square"],
  ["kiosk", "round"],
] as const) {
  test(`chladni ${shape} on a ${kind}: a held key gathers the sand onto its figure`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const problems = watchPage(page);
    await open(page, kind, `&variant=${shape}`);
    // A disc's figures face the drive point, at home as everywhere.
    const list = formModes(shape, { stretch: 0, wide: true, turn: turnToward(HOME[shape]) });
    await page.evaluate(() => window.__chladni!.sprinkle(200));
    await page.waitForTimeout(800);
    const st = await state(page);
    const key = st.layout.keys[2]!;
    const before = await stillShare(page, shape, key.mode, 0.15, list);
    expect(before, "share on the lines before ringing").toBeLessThan(0.5);

    const at = await client(
      page,
      kind,
      key.box.x + key.box.width / 2,
      key.box.y + key.box.height / 2,
    );
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await expect
      .poll(() => stillShare(page, shape, key.mode, 0.15, list), {
        timeout: 30_000,
        intervals: [1000],
      })
      .toBeGreaterThan(0.75);
    expect((await state(page)).strongest).toBe(modeId(modesFor(shape)[key.mode]!));
    await page.mouse.up();
    // Rung down, the sand stays where it settled.
    await page.waitForTimeout(6000);
    expect((await state(page)).levels[0]).toBeLessThan(0.05);
    expect(await stillShare(page, shape, key.mode, 0.15, list)).toBeGreaterThan(0.7);
    expect(problems).toEqual([]);
  });
}

test("chladni: a tap rings its note for about four seconds", async ({ page }) => {
  const problems = watchPage(page);
  await open(page, "panel");
  const key = (await state(page)).layout.keys[0]!;
  const at = await client(
    page,
    "panel",
    key.box.x + key.box.width / 2,
    key.box.y + key.box.height / 2,
  );
  await page.mouse.click(at.x, at.y);
  const t0 = Date.now();
  // The default drive point rings every figure, this one at about 0.7.
  await expect
    .poll(async () => (await state(page)).amps[0]![key.mode]!, { timeout: 3000 })
    .toBeGreaterThan(0.6);
  await expect
    .poll(async () => (await state(page)).amps[0]![key.mode]!, {
      timeout: 10_000,
      intervals: [200],
    })
    .toBeLessThan(0.1);
  const rang = Date.now() - t0;
  expect(rang).toBeGreaterThan(3500);
  expect(rang).toBeLessThan(7000);
  expect(problems).toEqual([]);
});

test("chladni: the glide rings a note at its mark and only shivers between marks", async ({
  page,
}) => {
  const problems = watchPage(page);
  await open(page, "panel");
  const st = await state(page);
  const glide = st.layout.glides[0]!;
  const marks = glide.notes.length;
  // Positions along the strip, as layout.glidePoint does, for marks at even spacing.
  const point = (t: number) => {
    const b = glide.box;
    const pad = b.height / 2;
    return { x: b.x + pad + t * (b.width - 2 * pad), y: b.y + b.height / 2 };
  };
  const span = marks - 1 + 2 * 0.6;
  const markT = (i: number) => (0.6 + i) / span;
  const mid = point((markT(1) + markT(2)) / 2);
  const on = point(markT(1));
  const a = await client(page, "panel", mid.x, mid.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.waitForTimeout(1500);
  expect((await state(page)).levels[0], "between two marks").toBeLessThan(0.4);
  const b = await client(page, "panel", on.x, on.y);
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await expect
    .poll(async () => (await state(page)).amps[0]![glide.notes[1]!]!, { timeout: 5000 })
    .toBeGreaterThan(0.8);
  await page.mouse.up();
  expect(problems).toEqual([]);
});

test("chladni: a finger on the plate damps the figure moving under it and shows a ring", async ({
  page,
}) => {
  const problems = watchPage(page);
  await open(page, "panel");
  const st = await state(page);
  const key = st.layout.keys[0]!;
  const plate = st.layout.plates[0]!;
  const m = modesFor("square")[key.mode]!;
  // s1-1+ moves most in the corners and not at all along the centre lines.
  expect(modeId(m)).toBe("s1-1+");
  await page.evaluate(
    async ({ kx, ky }) => {
      const stage = document.querySelector<HTMLElement>(".hc-stage")!;
      const r = stage.getBoundingClientRect();
      const unit = r.width / 1080;
      const x = r.x + kx * unit;
      const y = r.y + ky * unit;
      document.elementFromPoint(x, y)!.dispatchEvent(
        new PointerEvent("pointerdown", {
          clientX: x,
          clientY: y,
          pointerId: 501,
          pointerType: "touch",
          bubbles: true,
          isPrimary: true,
        }),
      );
    },
    { kx: key.box.x + key.box.width / 2, ky: key.box.y + key.box.height / 2 },
  );
  await expect.poll(async () => (await state(page)).amps[0]![key.mode]!).toBeGreaterThan(0.6);
  // A second finger near a corner of the plate.
  const finger = await client(
    page,
    "panel",
    plate.cx + plate.size * 0.4,
    plate.cy + plate.size * 0.4,
  );
  await page.mouse.move(finger.x, finger.y);
  await page.mouse.down();
  await expect.poll(async () => (await state(page)).amps[0]![key.mode]!).toBeLessThan(0.15);
  const amps = (await state(page)).amps[0]!;
  const grown = amps.reduce(
    (best, a, i) => (i !== key.mode && a > amps[best]! ? i : best),
    key.mode === 0 ? 1 : 0,
  );
  expect(amps[grown]!).toBeGreaterThan(0.2);
  const ringOpacity = await page.$$eval(".ch-ring", (els) =>
    els.map((e) => getComputedStyle(e).opacity),
  );
  expect(ringOpacity.filter((o) => Number(o) > 0.5)).toHaveLength(1);
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).amps[0]![key.mode]!).toBeGreaterThan(0.6);
  expect(problems).toEqual([]);
});

test("chladni: the drive point on a figure's still line stops it forming; moved off, it forms", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = watchPage(page);
  await open(page, "panel");
  const st = await state(page);
  const key = st.layout.keys[2]!;
  const m = modesFor("square")[key.mode]!;
  const rect = st.rects[0]!;
  const home = st.knobs[0]!.at;
  expect(home).toEqual(HOME.square);
  // A still line of the key's figure near the puck, in reach on the plate.
  const dead = stillNear(m, { u: home.u + 0.2, v: home.v - 0.15 });
  expect(Math.abs(shapeAt(m, dead.u, dead.v))).toBeLessThan(0.01);
  await drag(page, "panel", onRect(rect, home), onRect(rect, dead));
  const at = (await state(page)).knobs[0]!.at;
  expect(Math.hypot(at.u - dead.u, at.v - dead.v)).toBeLessThan(0.02);
  expect(ringsAt(m, at)).toBeLessThan(0.15);

  await page.evaluate(() => window.__chladni!.sprinkle(200));
  await page.waitForTimeout(800);
  expect(await stillShare(page, "square", key.mode)).toBeLessThan(0.5);
  await touchKey(page, "panel", key, true);
  await page.waitForTimeout(6000);
  // Nothing rings: the plate stays too quiet to lift the sand, and the puck says why.
  expect((await state(page)).levels[0]).toBeLessThan(0.3);
  expect(await stillShare(page, "square", key.mode)).toBeLessThan(0.5);
  const flat = await page.$eval(".ch-puck .ch-flat", (e) => Number(getComputedStyle(e).opacity));
  expect(flat).toBeGreaterThan(0.5);
  const keyOpacity = await page.$$eval(
    ".ch-key",
    (els, i) => Number(getComputedStyle(els[i]!).opacity),
    key.index,
  );
  expect(keyOpacity).toBeLessThan(0.7);

  // Off the line, the figure forms while the key is still held.
  await drag(page, "panel", onRect(rect, at), onRect(rect, home));
  await expect
    .poll(() => stillShare(page, "square", key.mode), { timeout: 30_000, intervals: [1000] })
    .toBeGreaterThan(0.75);
  await touchKey(page, "panel", key, false);
  expect(problems).toEqual([]);
});

test("chladni: the stretch slider draws the plate out to 2:1 and its figures follow", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = watchPage(page);
  await open(page, "panel");
  const st = await state(page);
  const slider = st.layout.sliders.find((x) => x.knob === "stretch")!;
  const b = slider.box;
  const pad = b.height / 2;
  await drag(
    page,
    "panel",
    { x: b.x + pad, y: b.y + b.height / 2 },
    { x: b.x + b.width - pad, y: b.y + b.height / 2 },
  );
  await expect
    .poll(async () => {
      const r = (await state(page)).rects[0]!;
      return r.width / r.height;
    })
    .toBeGreaterThan(1.995);
  const after = await state(page);
  const r = after.rects[0]!;
  expect(r.width).toBeGreaterThan(st.rects[0]!.width);
  const stretched = formModes("square", { stretch: 1, wide: true, turn: 0 });
  after.freqs[0]!.forEach((f, i) => expect(f).toBeCloseTo(stretched[i]!.freq, 6));
  // The pair s2-0 splits further apart.
  expect(after.freqs[0]![2]! / after.freqs[0]![1]!).toBeGreaterThan(2);
  // Key pictures take the plate's new shape.
  const pic = await page.$eval(".ch-key .ch-pic", (e) => {
    const r = e.getBoundingClientRect();
    return r.width / r.height;
  });
  expect(pic).toBeCloseTo(2, 1);
  // A key whose figure the home drive point still rings forms its stretched figure.
  const key = after.layout.keys.find((k) => ringsAt(stretched[k.mode]!, HOME.square) > 0.65)!;
  await page.evaluate(() => window.__chladni!.sprinkle(200));
  await page.waitForTimeout(800);
  await touchKey(page, "panel", key, true);
  await expect
    .poll(() => stillShare(page, "square", key.mode, 0.15, stretched), {
      timeout: 30_000,
      intervals: [1000],
    })
    .toBeGreaterThan(0.7);
  await touchKey(page, "panel", key, false);
  expect(problems).toEqual([]);
});

test("chladni: holding reset sprinkles fresh sand, and a lost GPU context comes back", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const problems = watchPage(page);
  await open(page, "panel");
  const st = await state(page);
  const key = st.layout.keys[1]!;
  const at = await client(
    page,
    "panel",
    key.box.x + key.box.width / 2,
    key.box.y + key.box.height / 2,
  );
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await expect
    .poll(() => stillShare(page, "square", key.mode), { timeout: 30_000, intervals: [1000] })
    .toBeGreaterThan(0.7);
  await page.mouse.up();
  await page.waitForTimeout(1500);
  const reset = st.layout.glides.length ? page.locator(".hc-button").first() : null;
  const box = await reset!.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1800);
  await page.mouse.up();
  await expect
    .poll(() => stillShare(page, "square", key.mode), { timeout: 10_000, intervals: [500] })
    .toBeLessThan(0.5);

  expect(await page.evaluate(() => window.__chladni!.loseContext(800))).toBe(true);
  await page.waitForTimeout(300);
  await expect
    .poll(async () => (await state(page)).grains[0], { timeout: 15_000 })
    .toBeGreaterThan(0);
  await expect
    .poll(async () => (await page.evaluate(() => window.__hypercube?.appStatus?.()))?.gl)
    .not.toBe("starting");
  expect(problems.filter((p) => !p.includes("CONTEXT_LOST"))).toEqual([]);
});

/** Drag inside one sim frame, from one venue point to another, with a touch in its iframe. */
const dragIn = (
  page: Page,
  frame: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
) =>
  page.evaluate(
    async ({ frame, from, to }) => {
      const w = document.querySelector<HTMLIFrameElement>(
        `.sim-frame[data-frame="${frame}"] iframe`,
      )!.contentWindow as Window & typeof globalThis;
      const r = w.document.querySelector(".hc-stage")!.getBoundingClientRect();
      const unit = r.width / 1080;
      const at = (p: { x: number; y: number }) => ({ x: r.x + p.x * unit, y: r.y + p.y * unit });
      const send = (type: string, p: { x: number; y: number }, target: EventTarget) =>
        target.dispatchEvent(
          new w.PointerEvent(type, {
            clientX: p.x,
            clientY: p.y,
            pointerId: 9302,
            pointerType: "touch",
            bubbles: true,
            isPrimary: true,
          }),
        );
      const a = at(from);
      const el = w.document.elementFromPoint(a.x, a.y)!;
      send("pointerdown", a, el);
      for (let i = 1; i <= 12; i++) {
        await new Promise((ok) => w.setTimeout(ok, 30));
        const k = i / 12;
        send(
          "pointermove",
          at({ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k }),
          el,
        );
      }
      await new Promise((ok) => w.setTimeout(ok, 30));
      send("pointerup", at(to), el);
    },
    { frame, from, to },
  );

/** Press or lift a key on one sim frame, with a touch inside its iframe. */
const pressKey = (page: Page, frame: string, key: number, down: boolean) =>
  page.evaluate(
    ({ frame, key, down }) => {
      const w = document.querySelector<HTMLIFrameElement>(
        `.sim-frame[data-frame="${frame}"] iframe`,
      )!.contentWindow as Window & typeof globalThis;
      const k = w.__chladni!.state().layout.keys[key]!;
      const r = w.document.querySelector(".hc-stage")!.getBoundingClientRect();
      const unit = r.width / 1080;
      const x = r.x + (k.box.x + k.box.width / 2) * unit;
      const y = r.y + (k.box.y + k.box.height / 2) * unit;
      w.document.elementFromPoint(x, y)!.dispatchEvent(
        new w.PointerEvent(down ? "pointerdown" : "pointerup", {
          clientX: x,
          clientY: y,
          pointerId: 9301,
          pointerType: "touch",
          bubbles: true,
          isPrimary: true,
        }),
      );
      return k.mode;
    },
    { frame, key, down },
  );

const frameState = (page: Page, frame: string) =>
  page.evaluate(
    (frame) =>
      document
        .querySelector<HTMLIFrameElement>(`.sim-frame[data-frame="${frame}"] iframe`)
        ?.contentWindow?.__chladni?.state() ?? null,
    frame,
  );

test.describe("chladni in a bank", () => {
  test.describe.configure({ timeout: 180_000 });

  test("chladni: a panel's key rings the screen's plate, the bank lights it, and panels play alone when the screen goes", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(
      "sim/?preset=bank&count=4&span=1&app=chladni&transport=local&bots=0&seed=e2e&debug=1&res=0.25",
    );
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const frames = [...document.querySelectorAll<HTMLElement>(".sim-frame[data-frame]")];
            const wins = frames.map((el) => el.querySelector("iframe")?.contentWindow);
            return (
              frames.length === 5 &&
              wins.every(
                (w) => w?.__hypercube?.phase === "running" && w.__hypercube.room === "online",
              ) &&
              wins.filter((w) => w?.__hypercube?.net?.isHub).length === 1 &&
              wins.filter((w) => w?.__chladni?.state().mode === "keyboard").length === 4
            );
          }),
        { timeout: 120_000, intervals: [500] },
      )
      .toBe(true);

    // The screen's attract show leaves the drive point where it is.
    await page.evaluate(() =>
      document
        .querySelector<HTMLIFrameElement>('.sim-frame[data-frame="a-screen"] iframe')
        ?.contentWindow?.__chladni?.stopAttract(),
    );

    // The third panel's second key is the bank's sixth note.
    const mode = await pressKey(page, "a-p3", 1, true);
    expect(mode).toBe(5);
    const id = modeId(modesFor("square")[mode]!);
    await expect
      .poll(async () => (await frameState(page, "a-screen"))?.strongest, { timeout: 10_000 })
      .toBe(id);
    expect((await frameState(page, "a-screen"))!.screenAttract).toBe(false);
    // Every panel hears the screen's report and lights that note.
    await expect
      .poll(async () => (await frameState(page, "a-p1"))?.remote[mode] ?? 0, { timeout: 5000 })
      .toBeGreaterThan(0.5);
    await pressKey(page, "a-p3", 1, false);

    // A panel's stretch slider and map move the screen's plate, and every panel follows.
    const p2 = (await frameState(page, "a-p2"))!;
    const slider = p2.layout.sliders.find((x) => x.knob === "stretch")!;
    const b = slider.box;
    const pad = b.height / 2;
    await dragIn(
      page,
      "a-p2",
      { x: b.x + pad, y: b.y + b.height / 2 },
      { x: b.x + b.width - pad, y: b.y + b.height / 2 },
    );
    await expect
      .poll(async () => (await frameState(page, "a-screen"))?.stretchNow[0] ?? 0, {
        timeout: 10_000,
      })
      .toBeGreaterThan(0.95);
    const map = p2.layout.maps[0]!.box;
    const target = { x: map.x + map.width * 0.8, y: map.y + map.height * 0.5 };
    await dragIn(page, "a-p2", { x: map.x + map.width * 0.3, y: target.y }, target);
    await expect
      .poll(async () => (await frameState(page, "a-screen"))?.knobs[0]!.at.u ?? 0, {
        timeout: 10_000,
      })
      .toBeGreaterThan(0.4);
    const screenKnobs = (await frameState(page, "a-screen"))!.knobs[0]!;
    for (const f of ["a-p1", "a-p3", "a-p4"]) {
      await expect
        .poll(async () => (await frameState(page, f))?.knobs[0]!.stretch ?? 0, { timeout: 5000 })
        .toBeGreaterThan(0.95);
      const k = (await frameState(page, f))!.knobs[0]!;
      expect(k.at.u).toBeCloseTo(screenKnobs.at.u, 2);
      expect(k.at.v).toBeCloseTo(screenKnobs.at.v, 2);
    }
    // The screen's plate is drawn out too.
    const sr = (await frameState(page, "a-screen"))!.rects[0]!;
    expect(sr.width / sr.height).toBeGreaterThan(1.9);

    // The screen goes: within a few seconds each panel plays a plate of its own.
    await page.evaluate(() =>
      document.querySelector('.sim-frame[data-frame="a-screen"] iframe')?.remove(),
    );
    await expect
      .poll(async () => (await frameState(page, "a-p2"))?.mode, {
        timeout: 10_000,
        intervals: [250],
      })
      .toBe("solo");
    await expect
      .poll(async () => (await frameState(page, "a-p2"))?.grains[0] ?? 0)
      .toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });
});
