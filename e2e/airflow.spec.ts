import { expect, type Frame, type Page, test } from "@playwright/test";
import { waitForRunning, watchPage } from "../scripts/lib/play.mjs";
import { BULK_TAU, SMAGORINSKY, SPONGE_TAU } from "../src/apps/airflow/config";
import {
  createLattice,
  fill,
  LIMIT_TAU,
  maskBytes,
  setSolid,
  SOLID,
  step,
} from "../src/apps/airflow/lattice";
import type { Sting, Zone } from "../src/apps/airflow/layout";

interface AirState {
  kind: string;
  screen: boolean;
  grid: { width: number; height: number; visible: number; cell: number };
  ready: boolean;
  steps: number;
  resets: number;
  topSpeed: number;
  attract: boolean;
  stings: {
    shape: string;
    size: number;
    scale: number;
    sizeButtons: Record<
      "smaller" | "bigger",
      { x: number; y: number; width: number; height: number }
    >;
    range: { x0: number; x1: number; y0: number; y1: number };
    hx: number;
    hy: number;
    sx: number;
    sy: number;
    angle: number;
    drag: number;
    lift: number;
    held: boolean;
  }[];
  zones: { wind: number; now: number; view: string }[];
  fingers: { x: number; y: number }[];
  layout: {
    stings: Sting[];
    zones: Zone[];
    tunnel: { rect: { x: number; y: number; width: number; height: number }; flow: string };
    adultTop: number;
    childTop: number;
  };
  sent: number;
  heard: number;
  live: number[];
  weights: number[];
  losses: number;
}

interface AirDebug {
  state(): AirState;
  sample(x: number, y: number): number[] | null;
  gpuCheck(opts: Record<string, unknown>): number[][] | null;
  stopAttract(): void;
  setWind(zone: number, v: number): void;
  setShape(i: number, id: string): void;
  loseContext(ms: number): boolean;
}

declare global {
  interface Window {
    __airflow?: AirDebug;
  }
}

const SIZES = {
  wall: { width: 5760, height: 2160 },
  panel: { width: 1080, height: 1920 },
  pair: { width: 2160, height: 1920 },
  kiosk: { width: 1920, height: 1080 },
} as const;
type Kind = keyof typeof SIZES;

const open = async (page: Page, kind: Kind, extra = "") => {
  const size = SIZES[kind];
  const scale = Math.min(1200 / size.width, 900 / size.height);
  await page.setViewportSize({
    width: Math.round(size.width * scale),
    height: Math.round(size.height * scale),
  });
  await page.goto(
    `play/?app=airflow&kind=${kind}&fit=${size.width}x${size.height}&bots=0&seed=t&debug=1${extra}`,
  );
  expect((await waitForRunning(page)).phase).toBe("running");
  await page.waitForFunction(() => window.__airflow?.state().ready === true, undefined, {
    timeout: 30_000,
  });
  await page.evaluate(() => window.__airflow!.stopAttract());
};

const state = (page: Page | Frame) => page.evaluate(() => window.__airflow!.state());

/** Client coordinates of a venue point. */
const client = async (page: Page, kind: Kind, x: number, y: number) => {
  const r = await page.locator(".hc-stage").boundingBox();
  const unit = r!.width / SIZES[kind].width;
  return { x: r!.x + x * unit, y: r!.y + y * unit };
};

/** A touch of its own (so the mouse stays free), held until `up`. */
const finger = async (page: Page, kind: Kind, x: number, y: number, id: number) => {
  const send = (type: string, vx: number, vy: number) =>
    page.evaluate(
      ({ type, vx, vy, id, w }) => {
        const stage = document.querySelector<HTMLElement>(".hc-stage")!;
        const r = stage.getBoundingClientRect();
        const unit = r.width / w;
        const cx = r.x + vx * unit;
        const cy = r.y + vy * unit;
        const target = type === "pointerdown" ? document.elementFromPoint(cx, cy)! : stage;
        target.dispatchEvent(
          new PointerEvent(type, {
            clientX: cx,
            clientY: cy,
            pointerId: id,
            pointerType: "touch",
            bubbles: true,
            isPrimary: false,
          }),
        );
      },
      { type, vx, vy, id, w: SIZES[kind].width },
    );
  await send("pointerdown", x, y);
  return {
    move: (nx: number, ny: number) => send("pointermove", nx, ny),
    up: (nx = x, ny = y) => send("pointerup", nx, ny),
  };
};

/** Drag with the mouse along venue points. */
const drag = async (page: Page, kind: Kind, points: { x: number; y: number }[]) => {
  const first = await client(page, kind, points[0]!.x, points[0]!.y);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of points.slice(1)) {
    const c = await client(page, kind, p.x, p.y);
    await page.mouse.move(c.x, c.y, { steps: 8 });
  }
  await page.mouse.up();
};

test.describe("airflow", () => {
  test("the shader step matches the CPU reference cell for cell", async ({ page }) => {
    test.setTimeout(120_000);
    const problems = watchPage(page);
    await open(page, "kiosk");
    const W = 64;
    const H = 40;
    const params = {
      smagorinsky: SMAGORINSKY,
      spongeFrom: 52,
      spongeTau: SPONGE_TAU,
      forceEma: 0.025,
      bulk: BULK_TAU,
      soft: true,
    };
    const lat = createLattice(W, H, { ...params, tau: 0.52, limit: LIMIT_TAU });
    // A still disc, a finger moving across the stream and a wall along the top.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if ((x + 0.5 - 18) ** 2 + (y + 0.5 - 18) ** 2 < 30) setSolid(lat, x, y, 1);
        if ((x + 0.5 - 34) ** 2 + (y + 0.5 - 26) ** 2 < 9)
          setSolid(lat, x, y, SOLID.finger, 0.03, -0.06);
        if (y === H - 1 && x > 40) setSolid(lat, x, y, SOLID.wall);
      }
    }
    const inlet = new Float32Array(H * 8);
    for (let y = 0; y < H; y++) {
      lat.inletU[y] = 0.04 + 0.03 * Math.sin(y / 5);
      lat.inletV[y] = 0.01 * Math.cos(y / 3);
      lat.inletTau[y] = 0.52 + 0.004 * (y % 3);
      inlet.set([lat.inletU[y]!, lat.inletV[y]!, lat.inletTau[y]!, 0], y * 4);
    }
    // Float32 is what the GPU holds.
    for (let y = 0; y < H; y++) {
      lat.inletU[y] = inlet[y * 4]!;
      lat.inletV[y] = inlet[y * 4 + 1]!;
      lat.inletTau[y] = inlet[y * 4 + 2]!;
    }
    fill(lat, (_, y) => [lat.inletU[y]!, lat.inletV[y]!]);
    const steps = 80;
    for (let i = 0; i < steps; i++) step(lat);
    const gpu = await page.evaluate((opts) => window.__airflow!.gpuCheck(opts), {
      width: W,
      height: H,
      mask: Array.from(maskBytes(lat)),
      inlet: Array.from(inlet),
      steps,
      ...params,
    });
    expect(gpu).not.toBeNull();
    const n = W * H;
    let worst = 0;
    let worstForce = 0;
    let ids = 0;
    for (let c = 0; c < n; c++) {
      for (let i = 0; i < 9; i++) {
        const v = gpu![Math.floor(i / 4)]![c * 4 + (i % 4)]!;
        worst = Math.max(worst, Math.abs(v - lat.g[i * n + c]!));
      }
      const t = gpu![2]!;
      worstForce = Math.max(
        worstForce,
        Math.abs(t[c * 4 + 1]! - lat.fx[c]!),
        Math.abs(t[c * 4 + 2]! - lat.fy[c]!),
      );
      if (Math.round(t[c * 4 + 3]!) === lat.fid[c]) ids++;
    }
    test.info().annotations.push({
      type: "difference",
      description: `largest population difference ${worst.toExponential(2)}, force ${worstForce.toExponential(2)}`,
    });
    expect(worst).toBeLessThan(2e-5);
    expect(worstForce).toBeLessThan(2e-5);
    expect(ids).toBe(n);
    expect.soft(problems).toEqual([]);
  });

  test("dragging a handle moves its shape further than the hand; the knob turns it", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const problems = watchPage(page);
    // A coarse lattice: the software rasteriser is slow at the wall's full size.
    await open(page, "wall", "&res=0.25");
    const st = await state(page);
    const s = st.stings[0]!;
    const spec = st.layout.stings[0]!;
    // Up and to the right within the handle's travel.
    const to = { x: s.hx + 400, y: spec.travel.y0 };
    await drag(page, "wall", [
      { x: s.hx, y: s.hy },
      { x: (s.hx + to.x) / 2, y: (s.hy + to.y) / 2 },
      to,
    ]);
    await expect
      .poll(async () => (await state(page)).stings[0]!.sx, { timeout: 5000 })
      .toBeGreaterThan(s.sx + 350);
    const after = (await state(page)).stings[0]!;
    expect(after.hx).toBeCloseTo(to.x, -1);
    // The shape rose more than the handle did.
    expect(s.sy - after.sy).toBeGreaterThan((s.hy - after.hy) * 1.5);
    // A quarter turn clockwise round the knob turns the shape clockwise.
    const k = { x: after.hx, y: spec.knobY! };
    const r = spec.knob * 0.4;
    const arc = Array.from({ length: 7 }, (_, i) => {
      const a = -Math.PI / 2 + (i / 6) * (Math.PI / 2);
      return { x: k.x + Math.cos(a) * r, y: k.y + Math.sin(a) * r };
    });
    const before = after.angle;
    await drag(page, "wall", arc);
    await expect
      .poll(async () => (await state(page)).stings[0]!.angle, { timeout: 5000 })
      .toBeLessThan(before - 70);
    expect.soft(problems).toEqual([]);
  });

  test("a finger in the stream is an obstacle while it touches, and only then", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const problems = watchPage(page);
    await open(page, "panel");
    const st = await state(page);
    const t = st.layout.tunnel.rect;
    const at = { x: t.x + t.width * 0.7, y: 1500 };
    const f = await finger(page, "panel", at.x, at.y, 701);
    await expect.poll(async () => (await state(page)).fingers.length).toBe(1);
    await expect
      .poll(
        async () =>
          (await page.evaluate(({ x, y }) => window.__airflow!.sample(x, y), at))?.[3] ?? 0,
      )
      .toBe(1);
    await f.up();
    await expect.poll(async () => (await state(page)).fingers.length).toBe(0);
    await expect
      .poll(
        async () =>
          (await page.evaluate(({ x, y }) => window.__airflow!.sample(x, y), at))?.[3] ?? 1,
      )
      .toBe(0);
    expect.soft(problems).toEqual([]);
  });

  test("tiles swap the shape, the slider sets the wind and the buttons the view", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const problems = watchPage(page);
    await open(page, "pair");
    const st = await state(page);
    const spec = st.layout.stings[1]!;
    const tile = spec.tiles[2]!;
    const shape = st.stings[1]!.shape;
    const tap = await finger(page, "pair", tile.x + tile.width / 2, tile.y + tile.height / 2, 702);
    await tap.up();
    await expect.poll(async () => (await state(page)).stings[1]!.shape).not.toBe(shape);
    // The other half's shape is untouched.
    expect((await state(page)).stings[0]!.shape).toBe(st.stings[0]!.shape);
    const zone = st.layout.zones[1]!;
    const slider = zone.slider!;
    const f = await finger(page, "pair", slider.from.x, slider.from.y, 703);
    await f.move(slider.to.x, slider.to.y);
    await f.up(slider.to.x, slider.to.y);
    await expect.poll(async () => (await state(page)).zones[1]!.wind).toBeGreaterThan(0.95);
    expect((await state(page)).zones[0]!.wind).toBeCloseTo(0.5, 2);
    const swirl = zone.views.find((v) => v.view === "swirl")!.box;
    const b = await finger(
      page,
      "pair",
      swirl.x + swirl.width / 2,
      swirl.y + swirl.height / 2,
      704,
    );
    await b.up();
    await expect.poll(async () => (await state(page)).zones[1]!.view).toBe("swirl");
    expect((await state(page)).zones[0]!.view).toBe("smoke");
    expect.soft(problems).toEqual([]);
  });

  test("size buttons make a shape bigger and smaller, stop at the limits, and each half of a pair has its own", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const problems = watchPage(page);
    await open(page, "pair");
    await page.evaluate(() => window.__airflow!.setShape(1, "disc"));
    const st = await state(page);
    const scales = st.layout.stings[1]!.scales;
    const biggest = Math.max(...scales);
    const smallest = Math.min(...scales);
    expect(st.stings.map((s) => s.size)).toEqual([1, 1]);
    let id = 710;
    const tap = async (which: "smaller" | "bigger") => {
      const b = (await state(page)).stings[1]!.sizeButtons[which];
      const f = await finger(page, "pair", b.x + b.width / 2, b.y + b.height / 2, id++);
      await f.up();
    };
    /** Is the cell this far out from the disc's centre, across the stream, solid? */
    const solidAt = async (out: number) => {
      const s = (await state(page)).stings[1]!;
      const v = await page.evaluate(({ x, y }) => window.__airflow!.sample(x, y), {
        x: s.sx + out,
        y: s.sy,
      });
      return v?.[3] ?? -1;
    };
    // The disc's rim at its usual size is 108 venue px out (36 units of 300 px per 100).
    const rim = 108;
    await expect.poll(() => solidAt(rim * 1.12)).toBe(0);
    await tap("bigger");
    await expect
      .poll(async () => (await state(page)).stings[1]!.size)
      .toBe(scales[scales.indexOf(1) + 1]);
    // Taps past the largest step do nothing.
    for (let i = 0; i < scales.length; i++) await tap("bigger");
    await expect.poll(async () => (await state(page)).stings[1]!.size).toBe(biggest);
    await expect.poll(async () => (await state(page)).stings[1]!.scale).toBeCloseTo(biggest, 4);
    await expect.poll(() => solidAt(rim * 1.12)).toBe(1);
    // The other half keeps its own size.
    expect((await state(page)).stings[0]!.size).toBe(1);
    for (let i = 0; i < scales.length + 1; i++) await tap("smaller");
    await expect.poll(async () => (await state(page)).stings[1]!.size).toBe(smallest);
    await expect.poll(async () => (await state(page)).stings[1]!.scale).toBeCloseTo(smallest, 4);
    await expect.poll(() => solidAt(rim * 0.8)).toBe(0);
    expect((await state(page)).stings[0]!.size).toBe(1);
    const status = await page.evaluate(() => window.__hypercube?.appStatus());
    expect(status?.sizes).toBe(`1,${smallest}`);
    // A swapped-in shape keeps its sting's size.
    const tile = st.layout.stings[1]!.tiles[0]!;
    const t = await finger(page, "pair", tile.x + tile.width / 2, tile.y + tile.height / 2, id++);
    await t.up();
    await expect.poll(async () => (await state(page)).stings[1]!.shape).not.toBe("disc");
    expect((await state(page)).stings[1]!.size).toBe(smallest);
    expect.soft(problems).toEqual([]);
  });

  test("a growing shape eases its handle inward, even while held, and shrinking gives the room back", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const problems = watchPage(page);
    await open(page, "pair");
    await page.evaluate(() => window.__airflow!.setShape(1, "disc"));
    const st = await state(page);
    const spec = st.layout.stings[1]!;
    const top = Math.max(...spec.scales);
    const s1 = () => state(page).then((s) => s.stings[1]!);
    // Hold the right half's handle at the seam end of its range.
    const start = st.stings[1]!;
    const hold = await finger(page, "pair", start.hx, start.hy, 720);
    await hold.move(spec.travel.x0 - 60, start.hy);
    await expect.poll(async () => (await s1()).hx).toBeCloseTo(spec.travel.x0, 3);
    let id = 721;
    const tap = async (which: "smaller" | "bigger") => {
      const b = (await s1()).sizeButtons[which];
      const f = await finger(page, "pair", b.x + b.width / 2, b.y + b.height / 2, id++);
      await f.up();
    };
    for (let i = 0; i < spec.scales.length; i++) await tap("bigger");
    await expect.poll(async () => (await s1()).scale).toBeCloseTo(top, 4);
    // The handle, still held, has eased inward to the new edge of its range, and the disc
    // (36 % of its size from its centre) stays clear of the seam's wall.
    let now = await s1();
    expect(now.held).toBe(true);
    expect(now.range.x0).toBeGreaterThan(spec.travel.x0 + 30);
    await expect.poll(async () => (await s1()).hx).toBeCloseTo(now.range.x0, 3);
    now = await s1();
    const seam = 1080;
    expect(now.sx - 0.36 * spec.size * top).toBeGreaterThanOrEqual(seam + 29);
    // Pulling further towards the seam does nothing.
    await hold.move(spec.travel.x0 - 200, start.hy);
    await page.waitForTimeout(300);
    expect((await s1()).hx).toBeCloseTo(now.range.x0, 3);
    await hold.up(spec.travel.x0 - 200, start.hy);
    // Back to the usual size: the range comes back, and the handle stays where it was.
    for (let i = 0; i < spec.scales.length; i++) await tap("smaller");
    for (let i = 0; i < spec.scales.indexOf(1); i++) await tap("bigger");
    await expect.poll(async () => (await s1()).scale).toBeCloseTo(1, 4);
    const back = await s1();
    expect(back.range.x0).toBeCloseTo(spec.travel.x0, 3);
    expect(back.hx).toBeCloseTo(now.range.x0, 3);
    expect.soft(problems).toEqual([]);
  });

  test("idle puts every shape back to its usual size", async ({ page }) => {
    test.setTimeout(90_000);
    const problems = watchPage(page);
    await open(page, "kiosk", "&idle=5");
    let id = 740;
    for (const i of [0, 1]) {
      for (let k = 0; k < 3; k++) {
        const b = (await state(page)).stings[i]!.sizeButtons.bigger;
        const f = await finger(page, "kiosk", b.x + b.width / 2, b.y + b.height / 2, id++);
        await f.up();
      }
    }
    await expect.poll(async () => (await state(page)).stings.map((s) => s.size)).toEqual([2, 2]);
    await expect
      .poll(async () => (await state(page)).stings.map((s) => s.scale), { timeout: 20_000 })
      .toEqual([1, 1]);
    expect((await state(page)).attract).toBe(true);
    expect.soft(problems).toEqual([]);
  });

  test("the hands variant has no shapes; hands in the stream are obstacles", async ({ page }) => {
    test.setTimeout(90_000);
    const problems = watchPage(page);
    await open(page, "kiosk", "&variant=hands");
    const st = await state(page);
    expect(st.stings).toHaveLength(0);
    const f = await finger(page, "kiosk", 1200, 500, 705);
    await expect.poll(async () => (await state(page)).fingers.length).toBe(1);
    await f.move(1250, 520);
    await f.up(1250, 520);
    await expect.poll(async () => (await state(page)).fingers.length).toBe(0);
    expect.soft(problems).toEqual([]);
  });

  test("bots play a wall without the flow ever breaking", async ({ page }) => {
    test.setTimeout(120_000);
    const problems = watchPage(page);
    await page.setViewportSize({ width: 1200, height: 450 });
    await page.goto(
      "play/?app=airflow&kind=wall&fit=5760x2160&bots=3&seed=b&debug=1&o.wind=strong",
    );
    expect((await waitForRunning(page)).phase).toBe("running");
    await page.waitForFunction(() => window.__airflow?.state().ready === true);
    const start = (await state(page)).steps;
    await page.waitForTimeout(20_000);
    const st = await state(page);
    expect(st.steps).toBeGreaterThan(start + 100);
    expect(st.resets).toBe(0);
    expect(st.topSpeed).toBeLessThanOrEqual(0.3);
    expect.soft(problems).toEqual([]);
  });

  test("a lost GPU context comes back and the air flows again", async ({ page }) => {
    test.setTimeout(90_000);
    const problems = watchPage(page);
    await open(page, "kiosk");
    expect(await page.evaluate(() => window.__airflow!.loseContext(500))).toBe(true);
    await expect.poll(async () => (await state(page)).losses).toBeGreaterThan(0);
    await expect.poll(async () => (await state(page)).ready, { timeout: 20_000 }).toBe(true);
    const a = (await state(page)).steps;
    await expect
      .poll(async () => (await state(page)).steps, { timeout: 20_000 })
      .toBeGreaterThan(a + 20);
    expect.soft(problems.filter((p) => !/context/i.test(p))).toEqual([]);
  });
});

// ---- A bank in the simulator ---------------------------------------------------------------

const simFrame = async (page: Page, id: string): Promise<Frame> => {
  const el = await page.$(`.sim-frame[data-frame="${id}"] iframe`);
  const frame = await el?.contentFrame();
  if (!frame) throw new Error(`no frame ${id}`);
  return frame;
};

const openBank = async (page: Page) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(
    "sim/?preset=bank&count=4&span=1&app=airflow&transport=local&bots=1&seed=e2e&debug=1&res=0.25",
  );
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const frames = [...document.querySelectorAll<HTMLElement>(".sim-frame[data-frame]")];
          const wins = frames.map((el) => el.querySelector("iframe")?.contentWindow);
          const hubs = wins.filter((w) => w?.__hypercube?.net?.isHub);
          return (
            frames.length === 5 &&
            wins.every(
              (w) =>
                w?.__hypercube?.phase === "running" &&
                w.__hypercube.room === "online" &&
                w.__airflow?.state().ready === true,
            ) &&
            hubs.length === 1
          );
        }),
      { timeout: 150_000, intervals: [1000] },
    )
    .toBe(true);
};

test.describe("airflow in a bank", () => {
  test.describe.configure({ timeout: 300_000 });

  test("every panel's plume rises on the screen above it; a silent panel falls back, and panels run on without the screen", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openBank(page);
    const screen = await simFrame(page, "a-screen");
    await expect
      .poll(async () => (await state(screen)).live, { timeout: 60_000 })
      .toEqual([0, 1, 2, 3]);
    // Each plume eases in until the screen's inlet above that panel is the panel's own air.
    await expect
      .poll(async () => Math.min(...(await state(screen)).weights), { timeout: 30_000 })
      .toBeGreaterThan(0.9);
    const st = await state(screen);
    expect(st.heard).toBeGreaterThan(8);
    // A panel that goes quiet fades back to the screen's own updraft.
    await page.evaluate(() =>
      document.querySelector('.sim-frame[data-frame="a-p3"] iframe')?.remove(),
    );
    await expect
      .poll(async () => (await state(screen)).live, { timeout: 30_000 })
      .toEqual([0, 1, 3]);
    await expect
      .poll(async () => (await state(screen)).weights[2]!, { timeout: 30_000 })
      .toBeLessThan(0.1);
    // Without the screen the panels keep their own air going.
    await page.evaluate(() =>
      document.querySelector('.sim-frame[data-frame="a-screen"] iframe')?.remove(),
    );
    const p2 = await simFrame(page, "a-p2");
    const before = await state(p2);
    await page.waitForTimeout(6000);
    const after = await state(p2);
    expect(after.steps).toBeGreaterThan(before.steps);
    expect(after.resets).toBe(0);
    expect.soft(problems).toEqual([]);
  });
});
