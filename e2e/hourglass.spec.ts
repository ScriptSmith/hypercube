import { expect, type Page, test } from "@playwright/test";
import { playPath, viewportFor, waitForRunning, watchPage } from "../scripts/lib/play.mjs";
import { BLANK_STDDEV, decodePng, pixelStats } from "../scripts/lib/png.mjs";

const FEED = { width: 4096, height: 2048 };
/** Sine of the latitude where the collar ends and a chamber begins. */
const COLLAR = Math.sin((7.5 * Math.PI) / 180);
const EMPTY = -2;

interface Ring {
  role: string;
  text: string;
  lat: number;
  repeats: number;
  crawl: boolean;
  seam: boolean;
  width: number;
  height: number;
  opacity: number;
}

interface GlassState {
  now: number;
  ready: boolean;
  drawn: number;
  state: "running" | "turning" | "resting";
  left: number;
  turn: number;
  remainingMs: number;
  startMs: number;
  endMs: number;
  nextStartMs: number;
  upper: number;
  lower: number;
  roll: number;
  fall: string;
  feed: number;
  flowing: number;
  time: string;
  message: string;
  ink: { time: number; message: number };
  rings: Ring[];
  sand: string;
  startLat: number;
}

declare global {
  interface Window {
    __hourglass?: { state(): GlassState; setNow(ms?: number | null, hold?: boolean): void };
  }
}

const ready = (page: Page) =>
  page.waitForFunction(() => (window.__hourglass?.state().drawn ?? 0) > 1, undefined, {
    timeout: 45_000,
  });

const open = async (page: Page, params: Record<string, string | number> = {}) => {
  const problems = watchPage(page);
  await page.setViewportSize(viewportFor(FEED));
  await page.goto(
    playPath({
      app: "hourglass",
      kind: "sphere",
      size: FEED,
      bots: 0,
      params: { debug: 1, res: 0.5, ...params },
    }),
  );
  const started = await waitForRunning(page);
  expect(started.phase, started.errors.join("; ")).toBe("running");
  await ready(page);
  return problems;
};

const state = (page: Page) => page.evaluate(() => window.__hourglass!.state());

/**
 * Set the piece's clock to a time today on the display's own clock, and let it draw. The clock
 * stays there unless `runs`, so what a slow software renderer then reports is exact.
 */
const setTime = async (page: Page, h: number, m = 0, s = 0, runs = false) => {
  const before = (await state(page)).drawn;
  await page.evaluate(
    ([hh, mm, ss, hold]) => {
      const d = new Date();
      d.setHours(hh!, mm!, Math.floor(ss!), Math.round((ss! % 1) * 1000));
      window.__hourglass!.setNow(d.getTime(), hold === 1);
    },
    [h, m, s, runs ? 0 : 1],
  );
  await page.waitForFunction((n) => window.__hourglass!.state().drawn > n + 1, before, {
    timeout: 30_000,
  });
  return state(page);
};

/** Mean brightness and spread of the feed's rows round a height, given as sin(latitude). */
const band = async (page: Page, height: number, rows = 8) => {
  const box = (await page.locator(".hc-stage").boundingBox())!;
  const lat = Math.asin(height);
  const y = box.y + (0.5 - lat / Math.PI) * box.height;
  const clip = { x: box.x, y: y - rows / 2, width: box.width, height: rows };
  return pixelStats(decodePng(await page.screenshot({ clip })));
};

/** The feed's rows round a height (as sin(latitude)), as pixels. */
const shootBand = async (page: Page, height: number, rows: number) => {
  const box = (await page.locator(".hc-stage").boundingBox())!;
  const y = box.y + (0.5 - Math.asin(height) / Math.PI) * box.height;
  const clip = { x: box.x, y: Math.round(y - rows / 2), width: box.width, height: rows };
  return decodePng(await page.screenshot({ clip }));
};

/** How many pixels differ by more than a little between two pictures of the same size. */
const changed = (a: { data: Uint8Array }, b: { data: Uint8Array }) => {
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.max(
      Math.abs(a.data[i]! - b.data[i]!),
      Math.abs(a.data[i + 1]! - b.data[i + 1]!),
      Math.abs(a.data[i + 2]! - b.data[i + 2]!),
    );
    if (d > 12) n++;
  }
  return n;
};

const FALLS = ["streams", "trails", "grains", "veil", "spiral"];

/**
 * Leave an admin override for a frame, as a signed `set` command does, so the frame mounts with
 * these options when it next loads in this tab. Text options only ever arrive this way.
 */
const leaveOverride = (page: Page, room: string, frame: string, options: Record<string, unknown>) =>
  page.evaluate(([key, opts]) => sessionStorage.setItem(key, JSON.stringify({ options: opts })), [
    `hc:override:${room}:${frame}`,
    options,
  ] as const);

test.describe("hourglass", () => {
  test("hourglass: sand above and below the collar, and the time left round it", async ({
    page,
  }) => {
    const problems = await open(page);
    const s = await setTime(page, 13);
    expect(s.ready).toBe(true);
    expect(s.state).toBe("running");
    expect(s.left).toBeGreaterThan(0.49);
    expect(s.left).toBeLessThan(0.51);
    expect(s.remainingMs).toBe(4 * 3_600_000);
    expect(s.upper).toBeGreaterThan(COLLAR);
    expect(s.upper).toBeLessThan(Math.sin(s.startLat));
    expect(s.lower).toBeGreaterThan(-1);
    expect(s.lower).toBeLessThan(-COLLAR);
    expect(s.roll).toBe(0);
    expect(s.flowing).toBe(5);
    expect(s.time).toBe("4 h");
    expect(s.ink).toEqual({ time: 1, message: 1 });

    // The collar's ring stands still with a copy for every side; the pole's goes round.
    const [collar, message, pole] = s.rings;
    expect(s.rings.map((r) => r.role)).toEqual(["collar", "message", "pole"]);
    expect(collar!.text).toBe(s.time);
    expect(collar!.repeats).toBeGreaterThanOrEqual(3);
    expect(collar!.crawl).toBe(false);
    expect(collar!.opacity).toBe(1);
    expect(message!.text).toBe("");
    expect(message!.opacity).toBe(0);
    expect(pole!.text).toBe(s.time);
    expect(pole!.crawl).toBe(true);

    // The picture: sand is bright just under each level and the glass dark just over it.
    const shot = await page.locator(".hc-stage").screenshot();
    expect(pixelStats(decodePng(shot)).stddev).toBeGreaterThan(BLANK_STDDEV);
    const sandAbove = await band(page, s.upper - 0.06);
    const glassAbove = await band(page, s.upper + 0.12);
    expect(sandAbove.mean).toBeGreaterThan(glassAbove.mean * 2.5);
    const sandBelow = await band(page, s.lower - 0.12);
    const glassBelow = await band(page, (s.lower - COLLAR) / 2);
    expect(sandBelow.mean).toBeGreaterThan(glassBelow.mean * 2.5);
    // The streams cross the glass between the collar and the heap, and the collar is lettered.
    expect(glassBelow.stddev).toBeGreaterThan(BLANK_STDDEV);
    expect((await band(page, 0)).stddev).toBeGreaterThan(BLANK_STDDEV);

    const status = await page.evaluate(() => window.__hypercube?.appStatus() ?? {});
    expect(status).toMatchObject({ state: "running", ends: "17:00" });
    expect(problems).toEqual([]);
  });

  test("hourglass: the upper sand sinks and the heap rises through the day", async ({ page }) => {
    const problems = await open(page);
    let last = await setTime(page, 9, 5);
    expect(last.upper).toBeCloseTo(Math.sin(last.startLat), 1);
    for (const hour of [10, 12, 14, 16]) {
      const s = await setTime(page, hour, 30);
      expect(s.state).toBe("running");
      expect(s.left).toBeLessThan(last.left);
      expect(s.upper).toBeLessThan(last.upper);
      expect(s.lower).toBeGreaterThan(last.lower);
      expect(s.time).toMatch(/^\d h( \d+ min)?$|^\d+:\d\d$/);
      last = s;
    }
    // Inside the last hour it counts minutes and seconds.
    const late = await setTime(page, 16, 47, 53);
    expect(late.time).toBe("12:07");
    expect(late.rings[0]!.repeats).toBeGreaterThanOrEqual(3);
    expect(problems).toEqual([]);
  });

  test("hourglass: looks like one ball from beside, below and far", async ({ page }) => {
    const problems = await open(page, { look: "globe" });
    await setTime(page, 13);
    await expect(page.locator(".hc-globe")).toBeVisible();
    await page.waitForTimeout(1000);
    const size = page.viewportSize() ?? { width: 1280, height: 640 };
    const ball = { x: size.width / 2 - 60, y: size.height / 2 - 140, width: 120, height: 120 };
    expect(pixelStats(decodePng(await page.screenshot({ clip: ball }))).stddev).toBeGreaterThan(
      BLANK_STDDEV,
    );
    for (const view of ["under", "far"]) {
      await page.click(`button[data-globe=${view}]`);
      await page.waitForTimeout(600);
      expect(pixelStats(decodePng(await page.screenshot())).stddev).toBeGreaterThan(BLANK_STDDEV);
    }
    expect(problems).toEqual([]);
  });

  test("hourglass: the last minute counts in seconds while the streams stop one by one", async ({
    page,
  }) => {
    const problems = await open(page);
    const early = await setTime(page, 16, 58, 30);
    expect(early.flowing).toBe(5);
    expect(early.time).toBe("1:30");
    const counts: number[] = [];
    for (const second of [15, 27, 39, 51, 57]) {
      const s = await setTime(page, 16, 59, second);
      expect(s.state).toBe("running");
      expect(s.time).toBe(String(60 - second));
      expect(s.upper).toBeLessThan(COLLAR + 0.02);
      counts.push(s.flowing);
    }
    expect(counts).toEqual([4, 3, 2, 1, 1]);
    expect(problems).toEqual([]);
  });

  test("hourglass: rests with all the sand below and a closing line", async ({ page }) => {
    const problems = await open(page);
    const full = await setTime(page, 16, 59);
    const s = await setTime(page, 17, 0, 10);
    expect(s.state).toBe("resting");
    expect(s.left).toBe(0);
    expect(s.upper).toBe(EMPTY);
    expect(s.lower).toBeGreaterThanOrEqual(full.lower);
    expect(s.lower).toBeLessThan(-COLLAR);
    expect(s.flowing).toBe(0);
    expect(s.time).toBe("Time's up");
    expect(s.ink.time).toBe(1);
    expect(s.rings[0]!.text).toBe("Time's up");
    expect(s.rings[0]!.repeats).toBeGreaterThanOrEqual(3);
    // The same picture late at night and before the glass is next turned.
    for (const [h, m] of [
      [23, 30],
      [3, 0],
      [8, 59],
    ] as const) {
      const night = await setTime(page, h, m);
      expect(night.state).toBe("resting");
      expect(night.lower).toBeCloseTo(s.lower, 9);
      expect(night.time).toBe("Time's up");
    }
    // Above the collar the glass is empty; below it the sand reaches nearly to the collar.
    const above = await band(page, 0.4);
    const below = await band(page, s.lower - 0.1);
    expect(below.mean).toBeGreaterThan(above.mean * 2.5);
    expect(await page.evaluate(() => window.__hypercube?.appStatus() ?? {})).toMatchObject({
      state: "resting",
      above: "0%",
      shows: "Time's up",
    });
    expect(problems).toEqual([]);
  });

  test("hourglass: turns over when a run begins, then the sand starts to fall", async ({
    page,
  }) => {
    const problems = await open(page);
    const before = await setTime(page, 8, 59, 58);
    expect(before.state).toBe("resting");
    const rolls: number[] = [];
    for (const second of [1, 2.5, 4, 5.5]) {
      const s = await setTime(page, 9, 0, second);
      expect(s.state).toBe("turning");
      expect(s.left).toBe(1);
      expect(s.lower).toBe(EMPTY);
      expect(s.upper).toBeGreaterThanOrEqual(before.lower - 0.01);
      expect(s.flowing).toBe(0);
      expect(s.ink).toEqual({ time: 0, message: 0 });
      rolls.push(s.roll);
      expect(
        pixelStats(decodePng(await page.locator(".hc-stage").screenshot())).stddev,
      ).toBeGreaterThan(BLANK_STDDEV);
    }
    // From upside down to upright.
    expect(rolls[0]).toBeGreaterThan(2.4);
    expect(rolls[0]).toBeLessThan(Math.PI);
    for (let i = 1; i < rolls.length; i++) expect(rolls[i]).toBeLessThan(rolls[i - 1]!);
    expect(rolls.at(-1)).toBeLessThan(0.3);
    const started = await setTime(page, 9, 0, 12);
    expect(started.state).toBe("running");
    expect(started.roll).toBe(0);
    expect(started.left).toBeGreaterThan(0.999);
    expect(started.upper).toBeCloseTo(Math.sin(started.startLat), 2);
    expect(started.flowing).toBe(5);
    expect(started.ink).toEqual({ time: 1, message: 1 });
    expect(started.time).toBe("7 h 59 min");
    expect(problems).toEqual([]);
  });

  test("hourglass: the operator's lines come from the URL or admin; the message shows all day", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await page.setViewportSize(viewportFor(FEED));
    const room = "e2ehourglassown";
    const url = `play/?app=hourglass&kind=sphere&fit=4096x2048&frame=e2e-hourglass&room=${room}&transport=local&bots=0&debug=1&res=0.5`;
    // These two lines may come from the URL, and admin's replace them.
    await page.goto(`${url}&o.message=Hello%20from%20a%20link&o.ending=Bye`);
    await ready(page);
    expect((await state(page)).message).toBe("Hello from a link");
    expect((await setTime(page, 20)).time).toBe("Bye");

    const message = `Thank you for coming ${String.fromCodePoint(0x1f389)} see you again soon`;
    await leaveOverride(page, room, "e2e-hourglass", { message, ending: "Goodnight" });
    await page.reload();
    await ready(page);
    const day = await setTime(page, 11);
    expect(day.message).toBe("Thank you for coming see you again soon");
    const ring = day.rings.find((r) => r.role === "message")!;
    expect(ring.text).toBe(day.message);
    expect(ring.opacity).toBe(1);
    expect(ring.crawl).toBe(true);
    expect(ring.width).toBeGreaterThan(ring.height * 4);
    expect(day.rings[0]!.text).toBe("6 h");
    // Lettering shows in the message's band.
    expect((await band(page, Math.sin(ring.lat), 6)).stddev).toBeGreaterThan(BLANK_STDDEV);

    // After the sand has run out the operator's line takes the countdown's place, and the
    // message is still there.
    const night = await setTime(page, 21);
    expect(night.state).toBe("resting");
    expect(night.time).toBe("Goodnight");
    expect(night.rings[0]!.text).toBe("Goodnight");
    const still = night.rings.find((r) => r.role === "message")!;
    expect(still.text).toBe(day.message);
    expect(still.opacity).toBe(1);
    expect(problems).toEqual([]);
  });

  test("hourglass: takes its times, countdown and sand from the options", async ({ page }) => {
    const problems = await open(page, {
      "o.starthour": 20,
      "o.startminute": 30,
      "o.endhour": 2,
      "o.endminute": 15,
      "o.countdown": "false",
      "o.sand": "blue",
    });
    // A run over midnight.
    const late = await setTime(page, 23, 30);
    expect(late.state).toBe("running");
    expect(late.sand).toBe("blue");
    expect(new Date(late.startMs).getHours()).toBe(20);
    expect(new Date(late.startMs).getMinutes()).toBe(30);
    expect(new Date(late.endMs).getHours()).toBe(2);
    expect(new Date(late.endMs).getMinutes()).toBe(15);
    expect(late.endMs - late.startMs).toBe(5.75 * 3_600_000);
    expect(late.left).toBeGreaterThan(0.45);
    expect(late.left).toBeLessThan(0.5);
    // No time shown, in the run or after it.
    expect(late.time).toBe("");
    expect(late.rings.every((r) => r.text === "" && r.opacity === 0)).toBe(true);
    const small = await setTime(page, 1);
    expect(small.state).toBe("running");
    expect(small.left).toBeLessThan(late.left);
    const day = await setTime(page, 12);
    expect(day.state).toBe("resting");
    expect(day.time).toBe("");
    expect(
      pixelStats(decodePng(await page.locator(".hc-stage").screenshot())).stddev,
    ).toBeGreaterThan(BLANK_STDDEV);
    expect(await page.evaluate(() => window.__hypercube?.appStatus() ?? {})).toMatchObject({
      ends: "2:15",
    });
    expect(problems).toEqual([]);
  });

  for (const fall of FALLS) {
    test(`hourglass: sand falls as ${fall}, thins in the last minute and stops`, async ({
      page,
    }) => {
      const problems = await open(page, { variant: fall, res: 1 });
      const s = await setTime(page, 10, 30);
      expect(s.fall).toBe(fall);
      expect(s.state).toBe("running");
      expect(s.feed).toBe(1);
      expect(s.flowing).toBe(fall === "streams" || fall === "spiral" ? 5 : 0);
      // The levels are the same however it falls.
      expect(s.left).toBeCloseTo(6.5 / 8, 3);
      expect(s.upper).toBeGreaterThan(COLLAR);
      expect(s.lower).toBeLessThan(-0.5);

      // Something is on the glass between the collar and the heap, and a moment later it has moved.
      const glass = (s.lower - COLLAR) / 2;
      const first = await shootBand(page, glass, 40);
      expect(pixelStats(first).stddev).toBeGreaterThan(BLANK_STDDEV);
      await setTime(page, 10, 30, 0.6);
      const moved = changed(first, await shootBand(page, glass, 40));
      expect(moved).toBeGreaterThan(30);
      // Held at one moment it is still: the movement is the fall, not noise.
      await setTime(page, 10, 30, 0.6);
      const held = await shootBand(page, glass, 40);
      await page.waitForTimeout(500);
      expect(changed(held, await shootBand(page, glass, 40))).toBeLessThan(moved / 5);

      // Half as much leaves the collar with half a minute to go, and none at the set time.
      const thin = await setTime(page, 16, 59, 30);
      expect(thin.feed).toBeCloseTo(0.5, 6);
      const last = await setTime(page, 16, 59, 59.5);
      expect(last.feed).toBeGreaterThan(0);
      expect(last.feed).toBeLessThan(0.01);
      const done = await setTime(page, 17, 0, 20);
      expect(done.state).toBe("resting");
      expect(done.fall).toBe(fall);
      expect(done.feed).toBe(0);
      expect(done.flowing).toBe(0);
      // The strip of glass left between the collar and the full heap is empty and still.
      const strip = (done.lower - COLLAR) / 2;
      const quiet = await shootBand(page, strip, 4);
      await setTime(page, 17, 0, 20.6);
      expect(changed(quiet, await shootBand(page, strip, 4))).toBeLessThanOrEqual(2);
      expect(problems).toEqual([]);
    });
  }

  test("hourglass: a picker can list one way of falling and hand it the times", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await page.setViewportSize(viewportFor(FEED));
    await page.goto(
      "play/?app=menu&kind=sphere&fit=4096x2048&res=0.5&debug=1&o.apps=hourglass:trails&o.hourglass.endhour=23&o.hourglass.endminute=45",
    );
    await page.waitForFunction(() => window.__hypercube?.app === "hourglass");
    await ready(page);
    expect(await page.evaluate(() => window.__hypercube?.variant)).toBe("trails");
    expect((await state(page)).fall).toBe("trails");
    expect(await page.evaluate(() => window.__hypercube?.options)).toMatchObject({
      endhour: 23,
      endminute: 45,
      starthour: 9,
    });
    expect(problems).toEqual([]);
  });

  test("hourglass: going idle changes nothing, and it keeps to the clock", async ({ page }) => {
    const problems = await open(page, { idle: 4 });
    const before = await setTime(page, 13, 59, 0, true);
    await page.waitForTimeout(6000);
    const after = await state(page);
    expect(after.state).toBe("running");
    expect(after.drawn).toBeGreaterThan(before.drawn);
    // Six seconds of an eight-hour run.
    expect(before.left - after.left).toBeGreaterThan(0);
    expect(before.left - after.left).toBeLessThan(0.001);
    expect(after.now - before.now).toBeGreaterThan(5000);
    expect(after.now - before.now).toBeLessThan(20_000);
    expect(before.time).toBe("3 h 1 min");
    expect(after.time).toBe("3 h");
    // Putting the clock back shows the real time of day again.
    await page.evaluate(() => window.__hourglass!.setNow(null));
    const real = await state(page);
    expect(Math.abs(real.now - Date.now())).toBeLessThan(60_000);
    expect(problems).toEqual([]);
  });
});
