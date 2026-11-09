import { expect, type Page, test } from "@playwright/test";
import { playPath, viewportFor, waitForRunning, watchPage } from "../scripts/lib/play.mjs";
import { BLANK_STDDEV, decodePng, pixelStats } from "../scripts/lib/png.mjs";

const FEED = { width: 4096, height: 2048 };
const DEG = Math.PI / 180;

interface GazeState {
  kind?: string;
  elevation: number;
  bearing: number;
  pupil: number;
  mood: string;
  time: number;
  stats: {
    saccades: number;
    micro: number;
    stares: number;
    glances: number;
    attends?: number;
  };
  people: number;
  upper: number;
  iris: { from: string; to: string; mix: number };
  reflections: boolean;
  depth: boolean;
  ready: boolean;
  frames: number;
  touching?: number;
  resets?: number;
  target?: number | null;
  bots?: number;
  ball?: { x: number; y: number; r: number } | null;
  lids?: {
    on: boolean;
    upper: number;
    lower: number;
    shut: number;
    blinks: number;
    reflexes: number;
    lashes?: { on: boolean; upper: number; lower: number };
    shape?: boolean;
    tears?: boolean;
  };
  wall?: string;
  skin?: { from: number; to: number; mix: number };
  petting?: { stroking: boolean; content: number; episodes: number };
}

declare global {
  interface Window {
    __gaze?: {
      state(): GazeState;
      skip(seconds: number): GazeState;
      look(elevation: number, bearing: number, seconds?: number): void;
      light(lamps: number, day: number, ramp?: number, hold?: number): void;
      blink?(): void;
      freeze?(on?: boolean): void;
      lashes?(on?: boolean): void;
    };
  }
}

const open = async (page: Page, params: Record<string, string> = {}) => {
  const problems = watchPage(page);
  await page.setViewportSize(viewportFor(FEED));
  await page.goto(playPath({ app: "gaze", kind: "sphere", size: FEED, bots: 0, params }));
  const state = await waitForRunning(page);
  expect(state.phase, state.errors.join("; ")).toBe("running");
  await page.waitForFunction(
    () => window.__gaze?.state().ready && window.__gaze.state().frames > 2,
  );
  return problems;
};

const gaze = (page: Page) => page.evaluate(() => window.__gaze!.state());

/** Mean colour of a small box of the stage at a feed latitude and longitude, degrees. */
const colourAt = async (page: Page, lat: number, lon: number) => {
  const stage = page.locator(".hc-stage");
  const box = (await stage.boundingBox())!;
  const png = decodePng(await stage.screenshot());
  const sx = png.width / box.width;
  const x = Math.round(((lon + 180) / 360) * png.width);
  const y = Math.round(((90 - lat) / 180) * png.height);
  const r = Math.max(1, Math.round(2 * sx));
  const sum = [0, 0, 0];
  let n = 0;
  for (let j = -r; j <= r; j++) {
    for (let i = -r; i <= r; i++) {
      const px = Math.min(png.width - 1, Math.max(0, x + i));
      const py = Math.min(png.height - 1, Math.max(0, y + j));
      const o = (py * png.width + px) * 4;
      for (let c = 0; c < 3; c++) sum[c]! += png.data[o + c]!;
      n++;
    }
  }
  return sum.map((v) => v / n);
};
const brightness = (c: number[]) => (c[0]! + c[1]! + c[2]!) / 3;

test.describe("gaze", () => {
  test("draws an eye whose pupil sits where it looks", async ({ page }) => {
    const problems = await open(page);
    const shot = await page.locator(".hc-stage").screenshot();
    expect(pixelStats(decodePng(shot)).stddev).toBeGreaterThan(BLANK_STDDEV);

    await page.evaluate(() => window.__gaze!.look(-30, 40, 30));
    await page.waitForFunction(() => {
      const s = window.__gaze!.state();
      return Math.abs(s.elevation + 30) < 1.5 && Math.abs(s.bearing - 40) < 2;
    });
    await page.waitForTimeout(300);
    const pupil = brightness(await colourAt(page, -30, 40));
    // The white of the eye, a quarter turn away round the ball.
    const white = brightness(await colourAt(page, -10, 130));
    expect(pupil).toBeLessThan(40);
    expect(white).toBeGreaterThan(120);
    expect(problems).toEqual([]);
  });

  test("darts, fixates and stares as the show runs on", async ({ page }) => {
    const problems = await open(page);
    const before = await gaze(page);
    const after = await page.evaluate(() => window.__gaze!.skip(600));
    expect(after.time - before.time).toBeGreaterThan(599);
    expect(after.stats.saccades - before.stats.saccades).toBeGreaterThan(300);
    expect(after.stats.micro).toBeGreaterThan(before.stats.micro);
    expect(after.stats.stares).toBeGreaterThan(before.stats.stares);
    expect(after.stats.glances).toBeGreaterThan(before.stats.glances);
    expect(after.elevation).toBeLessThan(40);
    expect(after.pupil).toBeGreaterThan(2);
    expect(after.pupil).toBeLessThan(8);
    // It keeps drawing after the jump.
    const frames = after.frames;
    await page.waitForFunction((f) => window.__gaze!.state().frames > f + 5, frames);
    expect(problems).toEqual([]);
  });

  test("widens its pupil as the room dims and narrows it quickly as the lamps come up", async ({
    page,
  }) => {
    const problems = await open(page);
    await page.evaluate(() => {
      window.__gaze!.look(-50, 60, 120);
      window.__gaze!.light(1, 1, 0.1, 120);
    });
    const lit = await page.evaluate(() => window.__gaze!.skip(15).pupil);
    await page.evaluate(() => window.__gaze!.light(0.15, 0.3, 4, 120));
    const dim = await page.evaluate(() => window.__gaze!.skip(25).pupil);
    expect(dim - lit).toBeGreaterThan(0.8);
    await page.evaluate(() => window.__gaze!.light(1, 1, 0.5, 120));
    const back = await page.evaluate(() => window.__gaze!.skip(2).pupil);
    expect(dim - back).toBeGreaterThan(0.6);
    expect(problems).toEqual([]);
  });

  test("keeps looking where it was when the runtime resets it", async ({ page }) => {
    const problems = await open(page, { idle: "5" });
    await page.evaluate(() => window.__gaze!.look(-55, -100, 30));
    await page.waitForTimeout(7000);
    const s = await gaze(page);
    // Reset came at 5 s; the hold of 30 s survives it, and the show's clock never restarted.
    expect(Math.abs(s.elevation + 55)).toBeLessThan(2);
    expect(s.time).toBeGreaterThan(6.5);
    expect(problems).toEqual([]);
  });

  test("looks across at people on a gallery unless there are none", async ({ page }) => {
    test.setTimeout(120_000);
    /** Share of 20 minutes of the show spent within 6 degrees of level, and who was upstairs. */
    const levelShare = () =>
      page.evaluate(() => {
        let level = 0;
        let upper = 0;
        for (let i = 0; i < 20 * 60; i++) {
          const s = window.__gaze!.skip(1);
          if (Math.abs(s.elevation) <= 6) level++;
          upper = Math.max(upper, s.upper);
        }
        return { level: level / (20 * 60), upper };
      });
    // The venue profile says there is a gallery round the ball.
    const problems = await open(page, { venue: "gallery:1" });
    const on = await levelShare();
    expect(on.upper).toBeGreaterThan(0);
    expect(on.level).toBeGreaterThan(0.12);
    expect(problems).toEqual([]);

    const offProblems = await open(page, { venue: "gallery:1", "o.upper": "false" });
    const off = await levelShare();
    expect(off.upper).toBe(0);
    expect(off.level).toBeLessThan(0.1);
    expect(offProblems).toEqual([]);

    // Without one, nobody is up there whatever the option says.
    const noneProblems = await open(page);
    expect((await levelShare()).upper).toBe(0);
    expect(noneProblems).toEqual([]);
  });

  test("changes its iris colour when asked to", async ({ page }) => {
    const problems = await open(page, { "o.iris": "changes" });
    const first = await gaze(page);
    const later = await page.evaluate(() => window.__gaze!.skip(400));
    expect(later.iris.to === first.iris.to && later.iris.mix === 1).toBe(false);
    expect(problems).toEqual([]);
  });

  test("can leave out the room's reflections", async ({ page }) => {
    /** The brightest spot on the iris, where the windows' reflections fall. */
    const brightest = async (params: Record<string, string>) => {
      await open(page, params);
      await page.evaluate(() => window.__gaze!.look(-30, 40, 30));
      await page.waitForFunction(() => Math.abs(window.__gaze!.state().elevation + 30) < 1.5);
      await page.waitForTimeout(300);
      const stage = page.locator(".hc-stage");
      const png = decodePng(await stage.screenshot());
      const cx = Math.round(((40 + 180) / 360) * png.width);
      const cy = Math.round(((90 + 30) / 180) * png.height);
      const r = Math.round((25 / 360) * png.width);
      // Only within 22 degrees of the iris's centre (it reaches 29), clear of the white.
      const centre = [
        Math.cos(-30 * DEG) * Math.sin(40 * DEG),
        Math.sin(-30 * DEG),
        Math.cos(-30 * DEG) * Math.cos(40 * DEG),
      ];
      let top = 0;
      for (let y = cy - r; y <= cy + r; y++) {
        for (let x = cx - 2 * r; x <= cx + 2 * r; x++) {
          const lat = (90 - (y / png.height) * 180) * DEG;
          const lon = ((x / png.width) * 360 - 180) * DEG;
          const dir = [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
          const cos = dir[0]! * centre[0]! + dir[1]! * centre[1]! + dir[2]! * centre[2]!;
          if (cos < Math.cos(22 * DEG)) continue;
          const o = (y * png.width + x) * 4;
          top = Math.max(top, (png.data[o]! + png.data[o + 1]! + png.data[o + 2]!) / 3);
        }
      }
      return top;
    };
    const shiny = await brightest({});
    const plain = await brightest({ "o.reflections": "false" });
    expect((await gaze(page)).reflections).toBe(false);
    expect(shiny).toBeGreaterThan(200);
    expect(plain).toBeLessThan(shiny - 40);
  });

  test("can leave out the iris's depth", async ({ page }) => {
    /**
     * How much neighbouring rows differ over the iris between the pupil and the limbus: the
     * lamps' shadows fall down the tissue, so depth adds edges across them.
     */
    const edges = async (params: Record<string, string>) => {
      await open(page, { "o.iris": "hazel", "o.reflections": "false", ...params });
      await page.evaluate(() => {
        window.__gaze!.light(1, 1, 0.1, 120);
        window.__gaze!.look(-30, 40, 30);
      });
      await page.waitForFunction(() => Math.abs(window.__gaze!.state().elevation + 30) < 1.5);
      await page.waitForTimeout(300);
      const png = decodePng(await page.locator(".hc-stage").screenshot());
      const lum = (x: number, y: number) => {
        const o = (y * png.width + x) * 4;
        return (png.data[o]! + png.data[o + 1]! + png.data[o + 2]!) / 3;
      };
      const centre = [
        Math.cos(-30 * DEG) * Math.sin(40 * DEG),
        Math.sin(-30 * DEG),
        Math.cos(-30 * DEG) * Math.cos(40 * DEG),
      ];
      let sum = 0;
      let n = 0;
      for (let y = 1; y < png.height; y++) {
        const lat = (90 - ((y + 0.5) / png.height) * 180) * DEG;
        for (let x = 0; x < png.width; x++) {
          const lon = (((x + 0.5) / png.width) * 360 - 180) * DEG;
          const cos =
            Math.cos(lat) * Math.sin(lon) * centre[0]! +
            Math.sin(lat) * centre[1]! +
            Math.cos(lat) * Math.cos(lon) * centre[2]!;
          // The iris reaches 29 degrees and the widest pupil about 13.
          if (cos > Math.cos(15 * DEG) || cos < Math.cos(24 * DEG)) continue;
          sum += Math.abs(lum(x, y) - lum(x, y - 1));
          n++;
        }
      }
      return sum / n;
    };
    const deep = await edges({});
    expect((await gaze(page)).depth).toBe(true);
    const flat = await edges({ "o.depth": "false" });
    expect((await gaze(page)).depth).toBe(false);
    // About 10% more at this size; runs vary by about 2%.
    expect(deep).toBeGreaterThan(flat * 1.05);
  });

  test("shows as a ball in the globe preview", async ({ page }) => {
    const problems = await open(page, { look: "globe" });
    await expect(page.locator(".hc-globe")).toBeVisible();
    await page.evaluate(() => window.__gaze!.look(-20, 0, 30));
    await page.waitForTimeout(1500);
    const size = page.viewportSize() ?? { width: 1280, height: 640 };
    const ball = { x: size.width / 2 - 80, y: size.height / 2 - 160, width: 160, height: 160 };
    const stats = pixelStats(decodePng(await page.screenshot({ clip: ball })));
    expect(stats.stddev).toBeGreaterThan(BLANK_STDDEV);
    expect(problems).toEqual([]);
  });
});

const WALL = { width: 5760, height: 2160 };

const openWall = async (page: Page, params: Record<string, string> = {}, bots = 0) => {
  const problems = watchPage(page);
  await page.setViewportSize(viewportFor(WALL));
  await page.goto(
    playPath({ app: "gaze", kind: "wall", size: WALL, bots, params: { res: "0.5", ...params } }),
  );
  const state = await waitForRunning(page);
  expect(state.phase, state.errors.join("; ")).toBe("running");
  await page.waitForFunction(
    () => window.__gaze?.state().ready && window.__gaze.state().frames > 2,
    null,
    { timeout: 60_000 },
  );
  return problems;
};

/** The stage's box and a screenshot of it. */
const wallShot = async (page: Page) => {
  const stage = page.locator(".hc-stage");
  const box = (await stage.boundingBox())!;
  const png = decodePng(await stage.screenshot());
  const lum = (x: number, y: number) => {
    const px = Math.round((x / box.width) * png.width);
    const py = Math.round((y / box.height) * png.height);
    let sum = 0;
    let n = 0;
    for (let j = -2; j <= 2; j++) {
      for (let i = -2; i <= 2; i++) {
        const cx = Math.min(png.width - 1, Math.max(0, px + i));
        const cy = Math.min(png.height - 1, Math.max(0, py + j));
        const o = (cy * png.width + cx) * 4;
        sum += (png.data[o]! + png.data[o + 1]! + png.data[o + 2]!) / 3;
        n++;
      }
    }
    return sum / n;
  };
  return { box, png, lum };
};

/** Mean colour of a small box of the stage at a share of its width and height. */
const rgbAt = async (page: Page, fx: number, fy: number) => {
  const png = decodePng(await page.locator(".hc-stage").screenshot());
  const cx = Math.round(fx * png.width);
  const cy = Math.round(fy * png.height);
  const sum = [0, 0, 0];
  let n = 0;
  for (let y = cy - 3; y <= cy + 3; y++) {
    for (let x = cx - 3; x <= cx + 3; x++) {
      const o = (y * png.width + x) * 4;
      for (let k = 0; k < 3; k++) sum[k]! += png.data[o + k]!;
      n++;
    }
  }
  return sum.map((v) => v / n);
};

/**
 * Stroke the wall from inside the page, as a finger's moves arrive: a pen down at a share of the
 * stage's width and height, moved back and forth by a share `amp` of its width every animation
 * frame, until the eye is content or `seconds` pass. The pen stays down until `lift`. On
 * failure, what the petting looked like along the way.
 */
const stroke = (page: Page, fx: number, fy: number, amp = 0.04, seconds = 30) =>
  page.evaluate(
    ({ fx, fy, amp, seconds }) =>
      new Promise<string>((resolve) => {
        const r = document.querySelector(".hc-stage")!.getBoundingClientRect();
        const x0 = r.left + fx * r.width;
        const y = r.top + fy * r.height;
        const fire = (type: string, x: number, target: EventTarget) =>
          target.dispatchEvent(
            new PointerEvent(type, {
              pointerId: 41,
              clientX: x,
              clientY: y,
              bubbles: true,
              pointerType: "pen",
              buttons: 1,
            }),
          );
        fire("pointerdown", x0, document.elementFromPoint(x0, y)!);
        const t0 = performance.now();
        const seen: string[] = [];
        const tick = () => {
          const t = (performance.now() - t0) / 1000;
          fire("pointermove", x0 + amp * r.width * Math.sin((2 * Math.PI * t) / 1.6), window);
          const s = window.__gaze!.state();
          if (s.petting!.content > 0.95) return resolve("");
          if (seen.length < 40) seen.push(`${s.time.toFixed(1)} ${JSON.stringify(s.petting)}`);
          if (t > seconds) return resolve(seen.join("\n"));
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    { fx, fy, amp, seconds },
  );

const lift = (page: Page) =>
  page.evaluate(() =>
    window.dispatchEvent(
      new PointerEvent("pointerup", { pointerId: 41, bubbles: true, pointerType: "pen" }),
    ),
  );

/** Press at a share of the stage's width and height, as a person would. */
const press = async (page: Page, fx: number, fy: number) => {
  const box = (await page.locator(".hc-stage").boundingBox())!;
  await page.mouse.move(box.x + fx * box.width, box.y + fy * box.height);
  await page.mouse.down();
};

test.describe("gaze on a wall", () => {
  test("draws one eye in the middle of the wall", async ({ page }) => {
    const problems = await openWall(page);
    const s = await gaze(page);
    expect(s.kind).toBe("wall");
    await page.waitForFunction(() => window.__gaze!.state().lids!.shut === 0);
    const { box, png, lum } = await wallShot(page);
    expect(pixelStats(png).stddev).toBeGreaterThan(BLANK_STDDEV);
    const ball = s.ball!;
    expect(Math.abs(ball.x - box.width / 2)).toBeLessThan(box.width * 0.02);
    expect(Math.abs(ball.y - box.height / 2)).toBeLessThan(box.height * 0.04);
    // It opens looking out at the room: the pupil near the middle, white either side of the iris.
    expect(lum(ball.x, ball.y + 0.15 * ball.r)).toBeLessThan(40);
    expect(lum(ball.x - 0.7 * ball.r, ball.y)).toBeGreaterThan(90);
    expect(lum(ball.x + 0.7 * ball.r, ball.y)).toBeGreaterThan(90);
    // The wall round it is dark.
    expect(lum(box.width * 0.05, box.height * 0.5)).toBeLessThan(60);
    expect(problems).toEqual([]);
  });

  test("turns to a touch anywhere on the wall", async ({ page }) => {
    const problems = await openWall(page);
    await press(page, 0.06, 0.5);
    await page.waitForFunction(() => window.__gaze!.state().bearing < -25, null, {
      timeout: 5000,
    });
    // The picture follows: the pupil, the darkest spot on the eye, is left of its middle. A
    // blink hides it, so look again after one.
    const ball = (await gaze(page)).ball!;
    const pupilX = async () => {
      await page.waitForFunction(() => window.__gaze!.state().lids!.shut === 0);
      const shot = await wallShot(page);
      let darkest = { x: 0, v: Infinity };
      for (let x = ball.x - ball.r; x <= ball.x + ball.r; x += ball.r / 20) {
        for (let y = ball.y - 0.5 * ball.r; y <= ball.y + 0.5 * ball.r; y += ball.r / 20) {
          const v = shot.lum(x, y);
          if (v < darkest.v) darkest = { x, v };
        }
      }
      return darkest.x;
    };
    let x = await pupilX();
    for (let i = 0; i < 3 && x >= ball.x - 0.2 * ball.r; i++) x = await pupilX();
    expect(x).toBeLessThan(ball.x - 0.2 * ball.r);
    await page.mouse.up();

    await press(page, 0.9, 0.08);
    await page.waitForFunction(
      () => window.__gaze!.state().bearing > 20 && window.__gaze!.state().elevation > 10,
      null,
      { timeout: 5000 },
    );
    await page.mouse.up();
    await press(page, 0.3, 0.95);
    await page.waitForFunction(
      () => window.__gaze!.state().bearing < -10 && window.__gaze!.state().elevation < -15,
      null,
      { timeout: 5000 },
    );
    const s = await gaze(page);
    expect(s.touching).toBe(1);
    expect(s.stats.attends).toBeGreaterThanOrEqual(3);
    await page.mouse.up();
    expect(problems).toEqual([]);
  });

  test("blinks now and then, and at once when the eye itself is touched", async ({ page }) => {
    const problems = await openWall(page);
    const before = await gaze(page);
    expect(before.lids!.on).toBe(true);
    const later = await page.evaluate(() => window.__gaze!.skip(60));
    expect(later.lids!.blinks - before.lids!.blinks).toBeGreaterThan(8);
    const ball = later.ball!;
    const box = (await page.locator(".hc-stage").boundingBox())!;
    await page.mouse.move(box.x + ball.x, box.y + ball.y + 0.2 * ball.r);
    // Watch the lids from the page itself, frame by frame, from the press on.
    const watch = page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let most = 0;
          const t0 = performance.now();
          const tick = () => {
            most = Math.max(most, window.__gaze!.state().lids!.shut);
            if (performance.now() - t0 < 1500) requestAnimationFrame(tick);
            else resolve(most);
          };
          tick();
        }),
    );
    await page.mouse.down();
    const most = await watch;
    await page.mouse.up();
    const after = await gaze(page);
    expect(after.lids!.reflexes).toBe(1);
    expect(most).toBeGreaterThan(0.5);
    expect(problems).toEqual([]);
  });

  test("can leave out the lids", async ({ page }) => {
    const above = async (params: Record<string, string>) => {
      await openWall(page, params);
      await page.evaluate(() => window.__gaze!.look(-5, 0, 30));
      await page.waitForTimeout(600);
      const s = await gaze(page);
      return { lum: (await wallShot(page)).lum(s.ball!.x, s.ball!.y - 0.75 * s.ball!.r), s };
    };
    const lidded = await above({});
    const bare = await above({ "o.lids": "false" });
    expect(bare.s.lids!.on).toBe(false);
    // Without lids the white shows above the iris, where the upper lid would be.
    expect(bare.lum).toBeGreaterThan(lidded.lum + 40);
  });

  test("bots touch the wall and the eye turns to them", async ({ page }) => {
    const problems = await openWall(page, {}, 2);
    await page.waitForFunction(() => (window.__gaze!.state().stats.attends ?? 0) >= 2, null, {
      timeout: 30_000,
    });
    expect(problems).toEqual([]);
  });

  test("lets go of everyone touching when the runtime resets it", async ({ page }) => {
    const problems = await openWall(page, { idle: "5" });
    await press(page, 0.2, 0.7);
    await page.waitForFunction(() => window.__gaze!.state().touching === 1);
    // A finger held still for longer than the idle time; the reset lets it go.
    await page.waitForFunction(() => window.__gaze!.state().touching === 0, null, {
      timeout: 15_000,
    });
    expect((await gaze(page)).resets).toBeGreaterThan(0);
    const frames = (await gaze(page)).frames;
    await page.waitForFunction((f) => window.__gaze!.state().frames > f + 3, frames);
    await page.mouse.up();
    expect(problems).toEqual([]);
  });

  test("grows content when the wall is stroked, and comes back when it stops", async ({ page }) => {
    // Software rendering draws a few frames a second.
    test.setTimeout(120_000);
    const problems = await openWall(page);
    const before = await gaze(page);
    expect(before.petting!.content).toBe(0);
    // A tap and a still finger don't count.
    await press(page, 0.15, 0.8);
    await page.waitForTimeout(1500);
    await page.mouse.up();
    expect((await gaze(page)).petting!.content).toBe(0);
    // Stroking beside the eye, low on the wall where a child can reach.
    expect(await stroke(page, 0.18, 0.85)).toBe("");
    const s = await gaze(page);
    expect(s.petting!.content).toBeGreaterThan(0.9);
    // It rolls up under heavy lids, with the lower lid raised.
    expect(s.elevation).toBeGreaterThan(12);
    expect(s.lids!.upper - s.lids!.lower).toBeLessThan(
      before.lids!.upper - before.lids!.lower - 15,
    );
    await lift(page);
    // A few seconds of show, which software rendering runs slower than real time.
    await page.waitForFunction(() => window.__gaze!.state().petting!.content === 0, null, {
      timeout: 20_000,
    });
    expect((await gaze(page)).petting!.episodes).toBe(1);
    expect(problems).toEqual([]);
  });

  test("is startled out of it by a touch on the eye", async ({ page }) => {
    test.setTimeout(120_000);
    const problems = await openWall(page);
    expect(await stroke(page, 0.82, 0.85)).toBe("");
    await lift(page);
    const ball = (await gaze(page)).ball!;
    const box = (await page.locator(".hc-stage").boundingBox())!;
    await page.mouse.move(box.x + ball.x, box.y + ball.y + 0.3 * ball.r);
    await page.mouse.down();
    // Well before it would have come back by itself.
    await page.waitForFunction(() => window.__gaze!.state().petting!.content === 0, null, {
      timeout: 1000,
    });
    expect((await gaze(page)).lids!.reflexes).toBe(1);
    await page.mouse.up();
    expect(problems).toEqual([]);
  });

  test("has lashes on both lids, a pink inner corner, and shuts all the way", async ({ page }) => {
    const problems = await openWall(page);
    await page.evaluate(() => window.__gaze!.look(-5, 0, 60));
    await page.waitForFunction(() => window.__gaze!.state().lids!.shut === 0);
    await page.evaluate(() => window.__gaze!.freeze!(true));
    const s = await gaze(page);
    expect(s.lids!.lashes!.upper).toBeGreaterThanOrEqual(90);
    expect(s.lids!.lashes!.lower).toBeGreaterThan(20);
    const ball = s.ball!;
    // The upper lashes darken a band above the upper lid's margin.
    const band = (shot: Awaited<ReturnType<typeof wallShot>>) => {
      let sum = 0;
      let n = 0;
      for (let x = ball.x - 0.5 * ball.r; x <= ball.x + 0.3 * ball.r; x += ball.r / 25) {
        for (let y = ball.y - 0.6 * ball.r; y <= ball.y - 0.38 * ball.r; y += ball.r / 25) {
          sum += shot.lum(x, y);
          n++;
        }
      }
      return sum / n;
    };
    const lashed = await wallShot(page);
    await page.evaluate(() => window.__gaze!.lashes!(false));
    await page.waitForTimeout(200);
    const bare = await wallShot(page);
    await page.evaluate(() => window.__gaze!.lashes!(true));
    expect(band(lashed)).toBeLessThan(band(bare) - 3);
    // The caruncle shows pink in the inner corner, on the nose side (+x).
    let pinkest = -Infinity;
    for (let x = ball.x + 0.7 * ball.r; x <= ball.x + 0.95 * ball.r; x += ball.r / 50) {
      for (let y = ball.y - 0.2 * ball.r; y <= ball.y + 0.2 * ball.r; y += ball.r / 50) {
        const px = Math.round((x / lashed.box.width) * lashed.png.width);
        const py = Math.round((y / lashed.box.height) * lashed.png.height);
        const o = (py * lashed.png.width + px) * 4;
        pinkest = Math.max(pinkest, lashed.png.data[o]! - lashed.png.data[o + 1]!);
      }
    }
    expect(pinkest).toBeGreaterThan(25);
    // White shows either side of the iris while open, and none at the height of a blink.
    const white = (shot: Awaited<ReturnType<typeof wallShot>>) =>
      Math.max(shot.lum(ball.x - 0.6 * ball.r, ball.y), shot.lum(ball.x + 0.55 * ball.r, ball.y));
    expect(white(lashed)).toBeGreaterThan(110);
    await page.evaluate(() => {
      window.__gaze!.freeze!(false);
      window.__gaze!.blink!();
      for (let i = 0; i < 30 && window.__gaze!.state().lids!.shut < 1; i++) {
        window.__gaze!.skip(1 / 60);
      }
      window.__gaze!.freeze!(true);
    });
    expect((await gaze(page)).lids!.shut).toBe(1);
    await page.waitForTimeout(200);
    expect(white(await wallShot(page))).toBeLessThan(80);
    await page.evaluate(() => window.__gaze!.freeze!(false));
    expect(problems).toEqual([]);
  });

  test("can be skin that changes slowly through human skin tones", async ({ page }) => {
    // Two pages and a stretch of show on software rendering.
    test.setTimeout(120_000);
    await openWall(page);
    const slate = await rgbAt(page, 0.08, 0.5);
    // Slate is dark and cool.
    expect(slate[2]!).toBeGreaterThanOrEqual(slate[0]! - 2);

    const problems = await openWall(page, { "o.wall": "skin" });
    const s = await gaze(page);
    expect(s.wall).toBe("skin");
    const first = await rgbAt(page, 0.08, 0.5);
    // Skin is warm: red over green over blue.
    expect(first[0]!).toBeGreaterThan(first[1]!);
    expect(first[1]!).toBeGreaterThan(first[2]!);
    expect(first[0]! - first[2]!).toBeGreaterThan(10);
    // Within a tone's time it moves on to the next.
    const later = await page.evaluate(() => window.__gaze!.skip(80));
    expect(later.skin!.from).not.toBe(s.skin!.from);
    await page.waitForTimeout(300);
    const next = await rgbAt(page, 0.08, 0.5);
    expect(Math.abs(next[0]! - first[0]!) + Math.abs(next[2]! - first[2]!)).toBeGreaterThan(8);
    expect(next[0]!).toBeGreaterThan(next[2]!);
    expect(problems).toEqual([]);
  });
});
