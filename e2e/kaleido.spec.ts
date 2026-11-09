import { expect, type Page, test } from "@playwright/test";
import { waitForRunning, watchPage } from "../scripts/lib/play.mjs";

interface KaleidoState {
  mode: string;
  variant: string;
  connected: boolean;
  pours: number;
  humans: number;
  remote: number;
  emitters: number;
  grid: number[] | null;
  bands: { hour: number; total: number }[];
  layerAlpha: number;
  sent: number;
  received: number;
  frames: number;
  params: { cx: number; cy: number; rot: number; zoom: number; mirrors: number; fade: number };
  settledToday: number;
  meanInk: number;
  steps: number;
  hour: number;
  day: string;
}

interface CheckResult {
  step: number[];
  total: number[];
  centroid: number[];
  reach: number[];
  speed: number[];
  heat: number[];
}

interface KaleidoDebug {
  state(): KaleidoState;
  dye(): { total: number; centroid: number; top: number; max: number } | null;
  check(s: Record<string, unknown>): CheckResult | null;
  stopAttract(): void;
  pause(on: boolean): void;
  advance(n: number): number;
  regrid(cell: number): void;
  setHour(h: number): void;
  loseContext(ms: number): boolean;
  losses(): number;
  probe(w: number, h: number): number[] | null;
  fakeDay(from: number, to: number): void;
  command(name: string): void;
  touch(u: number, v: number): number;
  lift(id: number): void;
  remoteAt(): number[];
}

declare global {
  interface Window {
    __kaleido?: KaleidoDebug;
  }
}

const SIZES = {
  panel: { width: 1080, height: 1920 },
  pair: { width: 2160, height: 1920 },
  wall: { width: 5760, height: 2160 },
  screen: { width: 4000, height: 3600 },
} as const;
type Kind = keyof typeof SIZES;

const open = async (page: Page, kind: Kind, extra = "") => {
  const size = SIZES[kind];
  const scale = Math.min(960 / size.width, 720 / size.height);
  await page.setViewportSize({
    width: Math.round(size.width * scale),
    height: Math.round(size.height * scale),
  });
  await page.goto(
    `play/?app=kaleido&kind=${kind}&fit=${size.width}x${size.height}&bots=0&seed=t&debug=1${extra}`,
  );
  expect((await waitForRunning(page)).phase).toBe("running");
  await page.waitForFunction(() => window.__kaleido !== undefined);
  return scale;
};

const state = (page: Page) => page.evaluate(() => window.__kaleido!.state());

/** Mean luminance of each cell of a grid laid over an RGBA image. */
const cellLuma = (rgba: number[], w: number, h: number, cols: number, rows: number): number[] => {
  const out: number[] = Array.from({ length: cols * rows }, () => 0);
  const n: number[] = Array.from({ length: cols * rows }, () => 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const c =
        Math.min(rows - 1, Math.floor((y / h) * rows)) * cols +
        Math.min(cols - 1, Math.floor((x / w) * cols));
      out[c]! += (0.2126 * rgba[i]! + 0.7152 * rgba[i + 1]! + 0.0722 * rgba[i + 2]!) / 255;
      n[c]!++;
    }
  }
  return out.map((v, i) => v / Math.max(1, n[i]!));
};

/**
 * Flashes per second in the worst cell: a flash is a rise and a fall (or a fall and a rise) of at
 * least `step` in a cell's mean luminance, the rule of thumb for photosensitive safety.
 */
const flashRate = (frames: number[][], seconds: number, step = 0.1): number => {
  let worst = 0;
  const cells = frames[0]?.length ?? 0;
  for (let c = 0; c < cells; c++) {
    let swings = 0;
    let anchor = frames[0]![c]!;
    let dir = 0;
    for (const f of frames) {
      const v = f[c]!;
      if (dir >= 0 && v <= anchor - step) {
        if (dir > 0) swings++;
        dir = -1;
        anchor = v;
      } else if (dir <= 0 && v >= anchor + step) {
        if (dir < 0) swings++;
        dir = 1;
        anchor = v;
      } else if ((dir > 0 && v > anchor) || (dir < 0 && v < anchor)) {
        anchor = v;
      }
    }
    worst = Math.max(worst, swings / 2 / seconds);
  }
  return worst;
};

test("kaleido fluid: a still fluid stays still, a warm blob rises, and ink never grows", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = watchPage(page);
  await open(page, "panel");
  const still = await page.evaluate(() =>
    window.__kaleido!.check({ cell: 24, steps: 120, every: 20, pours: [], patch: { swirl: 0 } }),
  );
  expect(still).not.toBeNull();
  for (let i = 0; i < still!.step.length; i++) {
    expect(still!.speed[i], `still speed at ${still!.step[i]}`).toBeLessThan(1e-3);
    expect(still!.total[i]).toBe(0);
  }

  const blob = await page.evaluate(() =>
    window.__kaleido!.check({
      cell: 20,
      steps: 300,
      every: 30,
      pours: [{ x: 540, y: 1700, hot: false, from: 0, to: 60 }],
    }),
  );
  expect(blob).not.toBeNull();
  const { centroid, total, reach } = blob!;
  // It rises every sample once poured, and gets well over halfway up within five seconds.
  for (let i = 1; i < centroid.length; i++) {
    expect(centroid[i]!, `centre at ${blob!.step[i]}`).toBeGreaterThan(centroid[i - 1]!);
  }
  expect(centroid[0]).toBeLessThan(0.2);
  expect(reach[reach.length - 1]).toBeGreaterThan(0.5);
  // After the pour stops, total ink only ever falls, and slowly.
  const after = total.slice(2);
  for (let i = 1; i < after.length; i++) {
    expect(after[i]!, `ink at sample ${i + 2}`).toBeLessThanOrEqual(after[i - 1]! * 1.002);
  }
  expect(after[after.length - 1]! / after[0]!).toBeGreaterThan(0.6);
  expect(problems).toEqual([]);
});

test("kaleido wall: a person's pour at waist height billows up and settles into the hour's layer", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const problems = watchPage(page);
  const scale = await open(page, "wall", "&frame=kl-wall");
  await page.evaluate(() => {
    const k = window.__kaleido!;
    k.command("clear");
    k.stopAttract();
    k.pause(true);
    k.regrid(24);
  });
  // A finger held at waist height (child band) for three seconds.
  const x = 0.5 * SIZES.wall.width * scale;
  const y = 0.83 * SIZES.wall.height * scale;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect.poll(async () => (await state(page)).humans).toBe(1);
  for (let i = 0; i < 6; i++) await page.evaluate(() => window.__kaleido!.advance(30));
  await page.mouse.up();
  for (let i = 0; i < 10; i++) await page.evaluate(() => window.__kaleido!.advance(30));
  const dye = await page.evaluate(() => window.__kaleido!.dye());
  // The ink's centre is above the middle and some reached the top quarter.
  expect(dye!.centroid).toBeGreaterThan(0.5);
  expect(dye!.top).toBeGreaterThan(0);

  // A hot pour from the adult band reaches the top and settles into the layer.
  await page.mouse.move(0.3 * SIZES.wall.width * scale, 0.62 * SIZES.wall.height * scale);
  await page.mouse.down();
  for (let i = 0; i < 8; i++) await page.evaluate(() => window.__kaleido!.advance(30));
  await page.mouse.up();
  for (let i = 0; i < 12; i++) await page.evaluate(() => window.__kaleido!.advance(30));
  const s = await state(page);
  expect(s.bands).toHaveLength(1);
  expect(s.bands[0]!.hour).toBe(s.hour);
  expect(s.bands[0]!.total).toBeGreaterThan(1);

  // The day's layer survives a reload.
  await page.evaluate(() => window.__hypercube?.appStatus());
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await page.reload();
  expect((await waitForRunning(page)).phase).toBe("running");
  await page.waitForFunction(() => window.__kaleido !== undefined);
  const again = await state(page);
  expect(again.bands.map((b) => b.hour)).toEqual([s.hour]);
  expect(again.bands[0]!.total).toBeCloseTo(s.bands[0]!.total, 0);

  // Admin's clear empties it.
  await page.evaluate(() => window.__kaleido!.command("clear"));
  expect((await state(page)).bands).toHaveLength(0);
  expect(problems).toEqual([]);
});

test("kaleido recovers from a lost GPU context and keeps its layers", async ({ page }) => {
  test.setTimeout(90_000);
  const problems = watchPage(page);
  await open(page, "panel", "&frame=kl-panel");
  await page.evaluate(() => window.__kaleido!.command("clear"));
  await page.waitForFunction(() => (window.__kaleido!.state().grid ?? null) !== null);
  await page.evaluate(() => window.__kaleido!.fakeDay(9, 10));
  expect(await page.evaluate(() => window.__kaleido!.loseContext(800))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__kaleido!.losses())).toBe(1);
  // The fluid is gone with the context, then rebuilt once the browser restores it.
  await expect
    .poll(async () => (await state(page)).grid, { timeout: 20_000, intervals: [250] })
    .not.toBeNull();
  const steps = await page.evaluate(async () => {
    const before = window.__kaleido!.dye();
    await new Promise((r) => setTimeout(r, 1500));
    return { before, after: window.__kaleido!.dye() };
  });
  expect(steps.after).not.toBeNull();
  expect(steps.before).not.toBeNull();
  expect((await state(page)).bands.map((b) => b.hour)).toEqual([9, 10]);
  expect(problems).toEqual([]);
});

test("kaleidoscope: hands steer it", async ({ page }) => {
  test.setTimeout(150_000);
  const problems = watchPage(page);
  const scale = await open(page, "wall", "&variant=kaleido");
  const before = (await state(page)).params;
  // A hand at the left of the reach band, then the right: c follows.
  const W = SIZES.wall.width * scale;
  const H = SIZES.wall.height * scale;
  await page.mouse.move(0.1 * W, 0.9 * H);
  await page.mouse.down();
  await page.waitForTimeout(3000);
  const left = (await state(page)).params;
  await page.mouse.move(0.9 * W, 0.65 * H, { steps: 10 });
  await page.waitForTimeout(4000);
  const right = (await state(page)).params;
  await page.mouse.up();
  expect(Math.hypot(left.cx - right.cx, left.cy - right.cy)).toBeGreaterThan(0.1);
  expect(before.mirrors).toBe(6);

  expect(problems).toEqual([]);
});

/**
 * Six bots on a panel (at half resolution, so software GL keeps up), sampling a small copy of the
 * picture several times a second for `seconds`: the worst cell's flash rate.
 */
const flashesWithBots = async (page: Page, variant: string, seconds: number) => {
  await page.setViewportSize({ width: 270, height: 480 });
  await page.goto(
    `play/?app=kaleido&kind=panel&variant=${variant}&fit=1080x1920&bots=6&seed=t&debug=1&res=0.5`,
  );
  expect((await waitForRunning(page)).phase).toBe("running");
  await page.waitForFunction(() => window.__kaleido !== undefined);
  await page.waitForTimeout(3000);
  const frames: number[][] = [];
  const t0 = Date.now();
  while (Date.now() - t0 < seconds * 1000) {
    const px = await page.evaluate(() => window.__kaleido!.probe(18, 32));
    if (px) frames.push(cellLuma(px, 18, 32, 6, 8));
    await page.waitForTimeout(60);
  }
  return { frames: frames.length, rate: flashRate(frames, (Date.now() - t0) / 1000) };
};

test("kaleidoscope never flashes, even with six bots steering it", async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watchPage(page);
  const r = await flashesWithBots(page, "kaleido", 15);
  expect(r.frames).toBeGreaterThan(40);
  expect(r.rate).toBeLessThan(1);
  expect(problems).toEqual([]);
});

test("kaleido ink never flashes either", async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watchPage(page);
  const r = await flashesWithBots(page, "strata", 15);
  expect(r.frames).toBeGreaterThan(40);
  expect(r.rate).toBeLessThan(1);
  expect(problems).toEqual([]);
});

const simStates = (page: Page) =>
  page.evaluate(() => {
    const out: Record<string, KaleidoState | null> = {};
    for (const el of document.querySelectorAll<HTMLElement>(".sim-frame[data-frame]")) {
      const w = el.querySelector("iframe")?.contentWindow as
        | (Window & { __kaleido?: KaleidoDebug })
        | null;
      try {
        out[el.dataset.frame ?? "?"] = w?.__kaleido?.state() ?? null;
      } catch {
        out[el.dataset.frame ?? "?"] = null;
      }
    }
    return out;
  });

/** Run `fn` inside a sim frame, where `window.__kaleido` is that frame's. */
const inFrame = async <T>(
  page: Page,
  id: string,
  fn: (arg: number) => T,
  arg = 0,
): Promise<T | null> => {
  const el = await page.$(`.sim-frame[data-frame="${id}"] iframe`);
  const frame = await el?.contentFrame();
  return frame ? frame.evaluate(fn, arg) : null;
};

const setScreen = (page: Page, on: boolean) =>
  page.evaluate((on) => {
    const f = document.querySelector<HTMLIFrameElement>('.sim-frame[data-frame="a-screen"] iframe');
    if (!f) return;
    if (on) {
      if (f.dataset.src) f.src = f.dataset.src;
    } else {
      f.dataset.src = f.src;
      f.src = "about:blank";
    }
  }, on);

test("kaleido bank: ink rises off a panel and carries on up the screen above it", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const problems = watchPage(page);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(
    "sim/?preset=bank-panels&app=kaleido&transport=local&bots=0&seed=test&debug=1&res=0.25",
  );
  await page.waitForFunction(() => window.__hypercubeSim !== undefined);
  const panels = Array.from({ length: 6 }, (_, i) => `a-p${i + 1}`);
  await expect
    .poll(
      async () => {
        const s = await simStates(page);
        return panels.filter((id) => s[id]?.mode === "station").length;
      },
      { timeout: 150_000, intervals: [1000] },
    )
    .toBe(6);
  // Under a live screen panels keep no layers of their own; the screen does.
  let s = await simStates(page);
  expect(s["a-screen"]?.mode).toBe("screen");
  await expect.poll(async () => (await simStates(page))["a-p3"]?.layerAlpha).toBe(0);

  // A finger in the middle of the fourth panel pours on the screen right above it.
  await inFrame(page, "a-p4", () => {
    window.__kaleido!.stopAttract();
    window.__kaleido!.touch(0.5, 0.8);
  });
  await expect
    .poll(async () => (await inFrame(page, "a-screen", () => window.__kaleido!.remoteAt())) ?? [], {
      timeout: 30_000,
    })
    .toContainEqual(expect.closeTo(3.5 / 6, 2));
  s = await simStates(page);
  expect(s["a-p4"]!.sent).toBeGreaterThan(0);

  // Without the screen, panels draw their own layers within a few seconds.
  await setScreen(page, false);
  const gone = Date.now();
  await expect
    .poll(
      async () => {
        const st = await simStates(page);
        return panels.filter((id) => st[id]?.mode === "solo").length;
      },
      { timeout: 8000, intervals: [250] },
    )
    .toBe(6);
  expect(Date.now() - gone).toBeLessThan(6000);
  await expect.poll(async () => (await simStates(page))["a-p3"]?.layerAlpha).toBe(1);

  // And they hand their ink up again when it comes back.
  await setScreen(page, true);
  await expect
    .poll(
      async () => {
        const st = await simStates(page);
        return panels.filter((id) => st[id]?.mode === "station").length;
      },
      { timeout: 120_000, intervals: [1000] },
    )
    .toBe(6);
  expect(problems).toEqual([]);
});

test("kaleidoscope bank: panels steer the screen and show what it shows", async ({ page }) => {
  test.setTimeout(300_000);
  const problems = watchPage(page);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(
    "sim/?preset=bank-pairs&app=kaleido&variant=kaleido&transport=local&bots=0&seed=test&debug=1&res=0.25",
  );
  await page.waitForFunction(() => window.__hypercubeSim !== undefined);
  const pairs = Array.from({ length: 3 }, (_, i) => `a-pair${i + 1}`);
  await expect
    .poll(
      async () => {
        const s = await simStates(page);
        return pairs.filter((id) => s[id]?.mode === "station").length;
      },
      { timeout: 150_000, intervals: [1000] },
    )
    .toBe(3);
  // A hand low on the first pair, then high on the last: the screen's c moves between them.
  const id = await inFrame(page, "a-pair1", () => window.__kaleido!.touch(0.1, 0.95));
  await page.waitForTimeout(6000);
  const first = (await simStates(page))["a-screen"]!.params;
  expect(id).not.toBeNull();
  await inFrame(page, "a-pair1", (touch) => window.__kaleido!.lift(touch), id!);
  await inFrame(page, "a-pair3", () => window.__kaleido!.touch(0.9, 0.1));
  await page.waitForTimeout(6000);
  const later = (await simStates(page))["a-screen"]!.params;
  expect(Math.hypot(first.cx - later.cx, first.cy - later.cy)).toBeGreaterThan(0.05);
  // Every pair shows the screen's picture, give or take its easing.
  await expect
    .poll(
      async () => {
        const st = await simStates(page);
        const scr = st["a-screen"]!.params;
        return pairs.every((p) => {
          const q = st[p]?.params;
          return q
            ? Math.hypot(q.cx - scr.cx, q.cy - scr.cy) < 0.08 && q.mirrors === scr.mirrors
            : false;
        });
      },
      { timeout: 30_000, intervals: [1000] },
    )
    .toBe(true);
  expect(problems).toEqual([]);
});
