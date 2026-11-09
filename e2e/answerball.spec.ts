import { expect, type Page, test } from "@playwright/test";
import {
  playPath,
  shootStage,
  viewportFor,
  waitForRunning,
  watchPage,
} from "../scripts/lib/play.mjs";
import { BLANK_STDDEV, decodePng, pixelStats } from "../scripts/lib/png.mjs";

const FEED = { width: 4096, height: 2048 };

interface Lane {
  cycle: number;
  stage: string;
  at: number;
  stageLength: number;
  answer: string;
  kind: string;
  long: boolean;
  down: boolean;
  target: { lat: number; lon: number };
  lat: number;
  lon: number;
  depth: number;
  prompt: number;
  upright: number;
  bubbles: { x: number; y: number; alpha: number }[];
}

interface BallState {
  ready: boolean;
  time: number;
  windows: number;
  pace: string;
  colours: string;
  resets: number;
  shakes: number;
  lanes: Lane[];
}

declare global {
  interface Window {
    __answerball?: {
      state(): BallState;
      skip(seconds: number): void;
      jump(stage: string, into?: number): void;
      next(): void;
      shake(): void;
      pause(on: boolean): void;
    };
  }
}

const open = async (page: Page, params: Record<string, string> = {}) => {
  const problems = watchPage(page);
  await page.setViewportSize(viewportFor(FEED));
  await page.goto(
    playPath({
      app: "answerball",
      kind: "sphere",
      size: FEED,
      bots: 0,
      params: { debug: "1", ...params },
    }),
  );
  const started = await waitForRunning(page);
  expect(started.phase, started.errors.join("; ")).toBe("running");
  await page.waitForFunction(() => window.__answerball?.state().ready === true, undefined, {
    timeout: 30_000,
  });
  return problems;
};

/** One window that turns to face each side; six round the ball is the default. */
const ONE = { "o.windows": "one" };

const ball = (page: Page) => page.evaluate(() => window.__answerball!.state());
const lane = async (page: Page) => (await ball(page)).lanes[0]!;
/** Jump ahead to a stage and read the window's state in one go, so no time passes between. */
const jump = (page: Page, stage: string, into = 0) =>
  page.evaluate(
    ([s, n]) => {
      window.__answerball!.jump(s as string, n as number);
      return window.__answerball!.state().lanes[0]!;
    },
    [stage, into] as const,
  );
const next = (page: Page) => page.evaluate(() => window.__answerball!.next());
const pause = (page: Page, on: boolean) => page.evaluate((x) => window.__answerball!.pause(x), on);

type Png = ReturnType<typeof decodePng>;

/** Mean colour of a small square of the flat feed round a latitude and longitude, degrees. */
const colourAt = (img: Png, lat: number, lon: number, half = 6) => {
  const cx = Math.round(((lon + 180) / 360) * img.width);
  const cy = Math.round(((90 - lat) / 180) * img.height);
  const sum = [0, 0, 0];
  let n = 0;
  for (let y = cy - half; y <= cy + half; y++) {
    for (let x = cx - half; x <= cx + half; x++) {
      const i =
        (Math.min(img.height - 1, Math.max(0, y)) * img.width + ((x + img.width) % img.width)) * 4;
      for (let c = 0; c < 3; c++) sum[c]! += img.data[i + c]!;
      n++;
    }
  }
  return sum.map((s) => s / n) as [number, number, number];
};

/**
 * The colour of the die's face in the window `l` points from: just above its text for a side
 * window, the rows round the pole for a window facing down.
 */
const faceColour = (img: Png, l: Lane) => {
  if (!l.down) return colourAt(img, l.lat + 9, l.lon, 3);
  const sum = [0, 0, 0];
  let n = 0;
  for (
    let y = Math.round(img.height * (174 / 180));
    y < Math.round(img.height * (178 / 180));
    y++
  ) {
    for (let x = 0; x < img.width; x += 3) {
      const i = (y * img.width + x) * 4;
      for (let c = 0; c < 3; c++) sum[c]! += img.data[i + c]!;
      n++;
    }
  }
  return sum.map((v) => v / n) as [number, number, number];
};

/** Mean absolute difference, per channel, between two columns of a picture. */
const columnDiff = (img: Png, a: number, b: number) => {
  let sum = 0;
  for (let y = 0; y < img.height; y++) {
    for (let c = 0; c < 3; c++) {
      sum += Math.abs(
        img.data[(y * img.width + a) * 4 + c]! - img.data[(y * img.width + b) * 4 + c]!,
      );
    }
  }
  return sum / (img.height * 3);
};

const rowSpread = (img: Png, y: number) => {
  const row = img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4);
  return pixelStats({ width: img.width, height: 1, data: row }).stddev;
};

test.describe("answer ball", () => {
  test("asks, shakes, raises an answer to the window and sinks it again", async ({ page }) => {
    const problems = await open(page, ONE);
    const first = await lane(page);
    expect(first.down).toBe(false);
    expect(first.target.lat).toBeCloseTo(-20, 3);
    expect(first.target.lon).toBeCloseTo(0, 3);

    // From the start of the next answer, however long the page took to be ready.
    await next(page);
    const asking = await jump(page, "prompt", 1);
    expect(asking.stage).toBe("prompt");
    expect(asking.prompt).toBeGreaterThan(0.5);
    expect(asking.depth).toBeGreaterThan(0.5);

    expect((await jump(page, "shake", 0.3)).stage).toBe("shake");
    const rising = await jump(page, "rise", 0.2);
    expect(rising.stage).toBe("rise");
    expect(rising.depth).toBeGreaterThan(0.05);

    const holding = await jump(page, "hold", 2);
    expect(holding.stage).toBe("hold");
    expect(holding.depth).toBeLessThan(0.02);
    if (!holding.down) expect(holding.upright).toBeGreaterThan(0.98);
    // The die's blue face fills the window, with white letters; the plastic round it is dark.
    await pause(page, true);
    const shot = decodePng(await shootStage(page));
    await pause(page, false);
    expect(pixelStats(shot).stddev).toBeGreaterThan(BLANK_STDDEV);
    const face = faceColour(shot, holding);
    expect(face[2]).toBeGreaterThan(face[0] + 40);
    const behind = colourAt(shot, -20, 180, 4);
    expect(Math.max(...behind)).toBeLessThan(60);

    // A screenshot can outlast the hold on software rendering, so sink the next answer's die.
    await next(page);
    const sinking = await jump(page, "sink", 0.7);
    expect(sinking.stage).toBe("sink");
    expect(sinking.depth).toBeGreaterThan(0.1);
    expect(problems).toEqual([]);
  });

  test("turns to face each side in turn, and straight down now and then", async ({ page }) => {
    const problems = await open(page, ONE);
    const seen: Lane[] = [];
    for (let i = 0; i < 12; i++) {
      await next(page);
      seen.push(await jump(page, "hold", 1));
    }
    await pause(page, true);
    const downs = seen.filter((l) => l.down);
    expect(downs.length).toBeGreaterThanOrEqual(2);
    expect(downs.length).toBeLessThanOrEqual(6);
    for (const l of downs) expect(l.lat).toBeLessThan(-89);
    const sides = seen.filter((l) => !l.down);
    for (let i = 1; i < sides.length; i++) {
      const d = Math.abs(((sides[i]!.target.lon - sides[i - 1]!.target.lon + 540) % 360) - 180);
      expect(d).toBeGreaterThanOrEqual(89.9);
    }
    for (const l of sides) {
      expect(l.stage).toBe("hold");
      expect(l.target.lat).toBeLessThanOrEqual(0.5);
      expect(l.target.lat).toBeGreaterThanOrEqual(-35.5);
      expect(l.lat).toBeCloseTo(l.target.lat, 0);
      expect(l.upright).toBeGreaterThan(0.98);
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]!.answer).not.toBe(seen[i - 1]!.answer);
    // The flat feed shows the window where the state says.
    const last = seen[seen.length - 1]!;
    const shot = decodePng(await shootStage(page));
    await pause(page, false);
    const at = faceColour(shot, last);
    expect(at[2]).toBeGreaterThan(at[0] + 30);
    expect(problems).toEqual([]);
  });

  test("joins round the back and closes at the poles", async ({ page }) => {
    await open(page);
    const img = decodePng(await shootStage(page));
    const w = img.width;
    const neighbours = Math.max(columnDiff(img, 0, 1), columnDiff(img, w - 2, w - 1), 1);
    expect(columnDiff(img, w - 1, 0)).toBeLessThan(4 * neighbours + 3);
    expect(rowSpread(img, 0)).toBeLessThan(6);
    expect(rowSpread(img, img.height - 1)).toBeLessThan(6);
  });

  test("hangs as a ball in the globe preview, its answer facing the camera beside it", async ({
    page,
  }) => {
    const problems = await open(page, { look: "globe" });
    await expect(page.locator(".hc-globe")).toBeVisible();
    // Until a low window holds an answer facing the Beside camera, at longitude 0.
    await page.evaluate(() => {
      const b = window.__answerball!;
      const facing = () =>
        b
          .state()
          .lanes.some(
            (l, i) =>
              !l.down && i % 2 === 0 && l.stage === "hold" && l.at > 1 && Math.abs(l.lon) < 12,
          );
      for (let i = 0; i < 1200 && !facing(); i++) b.skip(0.25);
      b.pause(true);
    });
    await page.waitForTimeout(800);
    const size = page.viewportSize() ?? { width: 1280, height: 640 };
    const clip = { x: size.width / 2 - 50, y: size.height * 0.33, width: 100, height: 80 };
    const window_ = decodePng(await page.screenshot({ clip }));
    expect(pixelStats(window_).stddev).toBeGreaterThan(BLANK_STDDEV);
    const blue = colourAt(window_, 0, 0, 20);
    expect(blue[2]).toBeGreaterThan(blue[0] + 30);
    for (const view of ["under", "far", "side"]) {
      await page.click(`button[data-globe=${view}]`);
      await page.waitForTimeout(500);
      const box = decodePng(
        await page.screenshot({
          clip: { x: size.width / 2 - 80, y: 20, width: 160, height: size.height / 2 },
        }),
      );
      expect(pixelStats(box).stddev, view).toBeGreaterThan(BLANK_STDDEV);
    }
    await pause(page, false);
    expect(problems).toEqual([]);
  });

  test("runs six windows alternately high and low and one underneath, a row at a time", async ({
    page,
  }) => {
    const problems = await open(page);
    const s = await ball(page);
    expect(s.windows).toBe(7);
    expect(s.lanes.length).toBe(7);
    s.lanes.slice(0, 6).forEach((l, i) => {
      expect(l.down).toBe(false);
      if (i % 2 === 0) expect(l.lat).toBeCloseTo(-25, -1);
      else expect(l.lat).toBeCloseTo(15, -1);
      const next = s.lanes[(i + 1) % 6]!;
      expect(((next.lon - l.lon + 540) % 360) - 180).toBeCloseTo(60, -1);
    });
    expect(s.lanes[6]!.down).toBe(true);
    expect(s.lanes[6]!.lat).toBeLessThan(-86);
    /** The low row is 0, the high row and the window underneath 1. */
    const rowOf = (i: number) => (i === 6 ? 1 : i % 2);
    /** Step on until `lane` holds its answer, then picture the feed. */
    const holding = async (lane: number) => {
      const lanes = await page.evaluate((k) => {
        const b = window.__answerball!;
        for (let i = 0; i < 400; i++) {
          const l = b.state().lanes[k]!;
          if (l.stage === "hold" && l.at > 1.5) break;
          b.skip(0.1);
        }
        b.pause(true);
        return b.state().lanes;
      }, lane);
      const shot = decodePng(await shootStage(page));
      await pause(page, false);
      return { lanes, shot };
    };
    for (const row of [0, 1]) {
      const { lanes, shot } = await holding(row);
      lanes.forEach((l, i) => {
        // A row rises and holds together; the other row is between answers.
        if (rowOf(i) === row) {
          expect(l.stage, `window ${i}`).toBe("hold");
          if (!l.down) expect(l.upright).toBeGreaterThan(0.97);
          const face = faceColour(shot, l);
          expect(face[2], `window ${i}`).toBeGreaterThan(face[0] + 40);
        } else expect(l.stage, `window ${i}`).not.toBe("hold");
      });
      const shown = lanes.filter((_, i) => rowOf(i) === row).map((l) => l.answer);
      expect(new Set(shown).size).toBe(row === 0 ? 3 : 4);
    }
    expect(problems).toEqual([]);
  });

  test("runs every look, each number of windows, no prompt and the lively pace", async ({
    page,
  }) => {
    for (const [colours, windows, prompt, pace, under] of [
      ["night", "three", "false", "lively", "true"],
      ["violet", "one", "false", "calm", "true"],
      ["teal", "three", "true", "calm", "true"],
      ["night", "six", "false", "lively", "false"],
    ]) {
      const problems = await open(page, {
        "o.colours": colours!,
        "o.windows": windows!,
        "o.prompt": prompt!,
        "o.pace": pace!,
        "o.under": under!,
      });
      const s = await ball(page);
      expect(s.colours).toBe(colours);
      expect(s.pace).toBe(pace);
      // The window underneath comes only with six.
      expect(s.windows).toBe({ one: 1, three: 3, six: under === "true" ? 7 : 6 }[windows!]);
      expect(s.lanes.length).toBe(s.windows);
      const status = await page.evaluate(() => window.__hypercube?.appStatus() ?? {});
      expect(status.windows).toBe(s.windows);
      await page.evaluate(() => window.__answerball!.skip(240));
      const later = await ball(page);
      for (const l of later.lanes) {
        if (prompt === "false") expect(l.prompt).toBe(0);
        if (windows === "three") expect(l.lat).toBeLessThan(-15);
      }
      // With three windows they are all on show at once, a third of a turn apart.
      if (windows === "three") {
        const lons = later.lanes.map((l) => l.lon).sort((a, b) => a - b);
        expect(lons[1]! - lons[0]!).toBeCloseTo(120, -1);
        expect(lons[2]! - lons[1]!).toBeCloseTo(120, -1);
      }
      const shot = decodePng(await shootStage(page));
      expect(pixelStats(shot).stddev).toBeGreaterThan(BLANK_STDDEV);
      expect(problems).toEqual([]);
    }
  });

  test("gives an answer on demand", async ({ page }) => {
    const problems = await open(page);
    const before = await jump(page, "hold", 1);
    const after = await page.evaluate(() => {
      window.__answerball!.shake();
      window.__answerball!.skip(1.2);
      return window.__answerball!.state().lanes[0]!;
    });
    expect(after.cycle).toBe(before.cycle + 1);
    expect(["shake", "rise"]).toContain(after.stage);
    expect(after.target).toEqual(before.target);
    expect((await ball(page)).shakes).toBe(1);
    expect(problems).toEqual([]);
  });

  test("runs for hours, its windows always in the band people see", async ({ page }) => {
    test.setTimeout(120_000);
    const problems = await open(page);
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.__answerball!.skip(1800));
      for (const l of (await ball(page)).lanes) {
        // The window's top edge, 20° above its centre, stays below the default ball's 36°, rocks
        // and all.
        expect(l.lat).toBeLessThan(16);
        expect(l.lat).toBeGreaterThan(l.down ? -90.1 : -30);
        if (l.down) expect(l.lat).toBeLessThan(-86);
        for (const b of l.bubbles) expect(Math.hypot(b.x, b.y)).toBeLessThan(1);
      }
    }
    const shot = decodePng(await shootStage(page));
    expect(pixelStats(shot).stddev).toBeGreaterThan(BLANK_STDDEV);
    expect(problems).toEqual([]);
  });

  test("keeps the show running through the runtime's idle reset", async ({ page }) => {
    const problems = await open(page, { idle: "5" });
    const before = await ball(page);
    await page.waitForFunction(() => (window.__answerball?.state().resets ?? 0) > 0, undefined, {
      timeout: 15_000,
    });
    const after = await ball(page);
    // The show's clock runs on through the reset (slower than the wall's on software rendering).
    expect(after.time).toBeGreaterThan(before.time);
    await page.waitForTimeout(1000);
    expect((await ball(page)).time).toBeGreaterThan(after.time);
    expect(after.lanes[0]!.cycle).toBeGreaterThanOrEqual(before.lanes[0]!.cycle);
    expect(after.lanes[0]!.cycle).toBeLessThanOrEqual(before.lanes[0]!.cycle + 1);
    expect(problems).toEqual([]);
  });
});

const WALL = { width: 5760, height: 2160 };

interface WallBall {
  stage: string;
  age: number;
  answer: string;
  showing: string | null;
  long: boolean;
  depth: number;
  prompt: number;
  tilt: number;
  offset: [number, number];
  fingers: number;
  upright: number;
  x: number;
  y: number;
  r: number;
  hint: number;
}

interface WallState {
  ready: boolean;
  kind: string;
  time: number;
  count: number;
  pace: string;
  colours: string;
  resets: number;
  shakes: number;
  balls: WallBall[];
  layout: {
    scale: number;
    floor: number;
    outline: number;
    reach: { adult: number; child: number };
  };
}

/** The wall's debug hook; the sphere's has another shape. */
type WallWindow = {
  __answerball: {
    state(): WallState;
    skip(seconds: number): void;
    shake(ball?: number): void;
    touch(x: number, y: number): number;
    move(id: number, x: number, y: number): void;
    lift(id: number): void;
    pause(on: boolean): void;
  };
};

const openWall = async (page: Page, params: Record<string, string> = {}, bots = 0) => {
  const problems = watchPage(page);
  await page.setViewportSize(viewportFor(WALL));
  await page.goto(
    playPath({
      app: "answerball",
      kind: "wall",
      size: WALL,
      bots,
      params: { debug: "1", ...params },
    }),
  );
  const started = await waitForRunning(page);
  expect(started.phase, started.errors.join("; ")).toBe("running");
  await page.waitForFunction(
    () => (window as unknown as WallWindow).__answerball?.state().ready === true,
    undefined,
    { timeout: 30_000 },
  );
  return problems;
};

const wall = (page: Page) =>
  page.evaluate(() => (window as unknown as WallWindow).__answerball.state());
const wallSkip = (page: Page, s: number) =>
  page.evaluate((x) => (window as unknown as WallWindow).__answerball.skip(x), s);
const wallPause = (page: Page, on: boolean) =>
  page.evaluate((x) => (window as unknown as WallWindow).__answerball.pause(x), on);

/** Mean colour of a square of a stage picture round stage px (x, y). */
const colourNear = (img: Png, x: number, y: number, half = 4) => {
  const sum = [0, 0, 0];
  let n = 0;
  for (let yy = Math.round(y) - half; yy <= Math.round(y) + half; yy++) {
    for (let xx = Math.round(x) - half; xx <= Math.round(x) + half; xx++) {
      const i = (Math.max(0, Math.min(img.height - 1, yy)) * img.width + xx) * 4;
      for (let c = 0; c < 3; c++) sum[c]! += img.data[i + c]!;
      n++;
    }
  }
  return sum.map((s) => s / n) as [number, number, number];
};

/** Just above the middle of a ball's window: the die's face when an answer shows. */
const faceOn = (img: Png, b: WallBall) => colourNear(img, b.x, b.y - b.r * 0.22);

test.describe("answer balls on a wall", () => {
  test("stand in a row, answer, and shake when a person drags one", async ({ page }) => {
    // Every mouse move waits for a frame, and software rendering draws about ten a second.
    test.setTimeout(150_000);
    const problems = await openWall(page);
    const s = await wall(page);
    expect(s.kind).toBe("wall");
    expect(s.count).toBe(3);
    expect(s.balls[0]!.x).toBeLessThan(s.balls[1]!.x);
    expect(s.balls[1]!.x).toBeLessThan(s.balls[2]!.x);
    expect(s.balls[0]!.y).toBeCloseTo(s.balls[2]!.y, 3);
    // The middle ball starts with an answer; a child reaches the bottom of every ball.
    expect(s.balls[1]!.stage).toBe("hold");
    expect(s.balls[1]!.showing).not.toBeNull();
    expect(s.balls[1]!.upright).toBeGreaterThan(0.97);
    expect(s.layout.floor).toBeGreaterThan(s.layout.reach.child);
    await wallSkip(page, 1.5);
    const asking = await wall(page);
    for (const i of [0, 2]) {
      expect(asking.balls[i]!.stage).toBe("wait");
      expect(asking.balls[i]!.prompt).toBeGreaterThan(0.5);
    }

    await wallPause(page, true);
    const shot = decodePng(await shootStage(page));
    await wallPause(page, false);
    expect(pixelStats(shot).stddev).toBeGreaterThan(BLANK_STDDEV);
    // A blue face with white letters in the middle window; dark plastic round it; a lit backdrop.
    const face = faceOn(shot, asking.balls[1]!);
    expect(face[2]).toBeGreaterThan(face[0] + 40);
    const plastic = colourNear(
      shot,
      asking.balls[0]!.x - asking.balls[0]!.r * 0.7,
      asking.balls[0]!.y,
    );
    expect(Math.max(...plastic)).toBeLessThan(60);
    const backdrop = colourNear(shot, (asking.balls[0]!.x + asking.balls[1]!.x) / 2, 30);
    expect(Math.max(...backdrop)).toBeGreaterThan(Math.max(...plastic));

    // A person drags the left ball from side to side, low down. The show's clock is held and
    // stepped between moves, so a slow software renderer can't let the shake settle meanwhile.
    const b = asking.balls[0]!;
    const y = b.y + b.r * 0.5;
    await wallPause(page, true);
    await page.mouse.move(b.x, y);
    await page.mouse.down();
    const pressed = (await wall(page)).balls[0]!;
    expect(pressed.stage).toBe("shake");
    expect(pressed.fingers).toBe(1);
    let most = 0;
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(b.x + Math.sin(i * 1.3) * b.r * 0.45, y);
      await wallSkip(page, 0.08);
      most = Math.max(most, (await wall(page)).balls[0]!.tilt);
    }
    const held = (await wall(page)).balls[0]!;
    expect(held.stage).toBe("shake");
    expect(held.fingers).toBe(1);
    expect(held.prompt).toBeLessThan(0.5);
    expect(most).toBeGreaterThan(4);
    await page.mouse.up();
    expect((await wall(page)).balls[0]!.fingers).toBe(0);
    await wallPause(page, false);

    // It settles and raises an answer of its own.
    await page.evaluate(() => {
      const h = (window as unknown as WallWindow).__answerball;
      for (let i = 0; i < 200 && h.state().balls[0]!.stage !== "hold"; i++) h.skip(0.05);
      h.skip(1);
      h.pause(true);
    });
    const after = await wall(page);
    const left = after.balls[0]!;
    expect(left.stage).toBe("hold");
    expect(left.showing).not.toBeNull();
    expect(left.tilt).toBeLessThan(2);
    expect(left.upright).toBeGreaterThan(0.95);
    expect(left.showing).not.toBe(after.balls[1]!.showing);
    const answered = decodePng(await shootStage(page));
    await wallPause(page, false);
    const leftFace = faceOn(answered, left);
    expect(leftFace[2]).toBeGreaterThan(leftFace[0] + 40);
    expect(problems).toEqual([]);
  });

  test("lets several people shake balls at once, two hands on one", async ({ page }) => {
    const problems = await openWall(page);
    const s = await wall(page);
    // The show's clock is held while the touches land, and stepped from here.
    await wallPause(page, true);
    const ids = await page.evaluate((balls) => {
      const h = (window as unknown as WallWindow).__answerball;
      const out = balls.map((b) => h.touch(b.x, b.y + b.r * 0.4));
      out.push(h.touch(balls[2]!.x - balls[2]!.r * 0.4, balls[2]!.y + balls[2]!.r * 0.3));
      return out;
    }, s.balls);
    const during = await wall(page);
    expect(during.balls.map((b) => b.fingers)).toEqual([1, 1, 2]);
    for (const b of during.balls) expect(b.stage).toBe("shake");
    await page.evaluate(
      ([balls, list]) => {
        const h = (window as unknown as WallWindow).__answerball;
        list.forEach((id, i) => {
          const b = balls[Math.min(i, 2)]!;
          h.move(id, b.x + b.r * (i % 2 === 0 ? 0.35 : -0.35), b.y + b.r * 0.2);
        });
      },
      [s.balls, ids] as const,
    );
    await wallSkip(page, 0.4);
    await page.evaluate((list) => {
      const h = (window as unknown as WallWindow).__answerball;
      for (const id of list) h.lift(id);
      for (let i = 0; i < 160; i++) h.skip(0.05);
    }, ids);
    const after = await wall(page);
    await wallPause(page, false);
    expect(after.balls.map((b) => b.fingers)).toEqual([0, 0, 0]);
    const shown = after.balls.map((b) => b.showing);
    for (const a of shown) expect(a).not.toBeNull();
    expect(new Set(shown).size).toBe(3);
    expect(problems).toEqual([]);
  });

  test("shake themselves one at a time with nobody about, and bots shake them", async ({
    page,
  }) => {
    let problems = await openWall(page);
    const answers = await page.evaluate(() => {
      const h = (window as unknown as WallWindow).__answerball;
      const seen: string[] = [];
      let most = 0;
      let last: (string | null)[] = [];
      for (let i = 0; i < 400; i++) {
        h.skip(0.5);
        const balls = h.state().balls;
        most = Math.max(most, balls.filter((b) => b.stage !== "wait" && b.stage !== "sink").length);
        balls.forEach((b, k) => {
          if (b.showing && b.showing !== last[k]) seen.push(b.showing);
        });
        last = balls.map((b) => b.showing);
      }
      return { seen, most, hints: h.state().balls.map((b) => b.hint) };
    });
    // Two hundred seconds: about one answer every twenty, from one ball at a time.
    expect(answers.most).toBe(1);
    expect(answers.seen.length).toBeGreaterThanOrEqual(6);
    for (let i = 1; i < answers.seen.length; i++) {
      expect(answers.seen[i]).not.toBe(answers.seen[i - 1]);
    }
    expect(problems).toEqual([]);

    problems = await openWall(page, {}, 2);
    const touched = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const h = (window as unknown as WallWindow).__answerball;
          let fingers = 0;
          const started = performance.now();
          const tick = () => {
            fingers = Math.max(fingers, ...h.state().balls.map((b) => b.fingers));
            if (fingers > 0 || performance.now() - started > 15_000) resolve(fingers);
            else setTimeout(tick, 50);
          };
          tick();
        }),
    );
    expect(touched).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  test("comes back to rest on the idle reset", async ({ page }) => {
    test.setTimeout(90_000);
    const problems = await openWall(page, { idle: "5" });
    const s = await wall(page);
    const b = s.balls[2]!;
    await page.mouse.move(b.x, b.y + b.r * 0.5);
    await page.mouse.down();
    await page.mouse.move(b.x + b.r * 0.4, b.y + b.r * 0.5, { steps: 4 });
    await page.mouse.up();
    await page.waitForFunction(
      () => ((window as unknown as WallWindow).__answerball.state().resets ?? 0) > 0,
      undefined,
      { timeout: 20_000 },
    );
    await wallSkip(page, 4);
    const after = await wall(page);
    for (const ball of after.balls) {
      expect(ball.tilt).toBeLessThan(1);
      expect(ball.fingers).toBe(0);
    }
    expect(problems).toEqual([]);
  });

  test("runs one or two balls, every look, no prompt and the lively pace", async ({ page }) => {
    test.setTimeout(120_000);
    for (const [balls, colours, prompt, pace] of [
      ["1", "violet", "true", "lively"],
      ["2", "teal", "false", "calm"],
      ["3", "night", "false", "lively"],
    ]) {
      const problems = await openWall(page, {
        "o.balls": balls!,
        "o.colours": colours!,
        "o.prompt": prompt!,
        "o.pace": pace!,
      });
      const s = await wall(page);
      expect(s.count).toBe(Number(balls));
      expect(s.balls).toHaveLength(Number(balls));
      expect(s.colours).toBe(colours);
      expect(s.pace).toBe(pace);
      const status = await page.evaluate(() => window.__hypercube?.appStatus() ?? {});
      expect(status.balls).toBe(Number(balls));
      await wallSkip(page, 3);
      for (const b of (await wall(page)).balls) {
        if (prompt === "false") expect(b.prompt).toBe(0);
        // The prompt fades in once a ball has waited a moment.
        else if (b.stage === "wait" && b.age > 1.5) expect(b.prompt).toBeGreaterThan(0.3);
      }
      const shot = decodePng(await shootStage(page));
      expect(pixelStats(shot).stddev).toBeGreaterThan(BLANK_STDDEV);
      expect(problems).toEqual([]);
    }
  });
});
