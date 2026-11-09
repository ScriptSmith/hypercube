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
const WALL = { width: 5760, height: 2160 };
/** Venue px per metre on the default wall, 4.5 m tall. */
const PX_PER_M = WALL.height / 4.5;

interface BallState {
  ready: boolean;
  time: number;
  tilt: number;
  turns: number;
  lazyTurns: number;
  tossing: boolean;
  tossCount: number;
  resets: number;
  nextToss: number;
  drops: { radius: number; lat: number }[];
}

interface WallBallState {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  spin: number;
  held: boolean;
  grounded: boolean;
  wet: number;
  taps: number;
  throws: number;
  bats: number;
}

interface WallToyState {
  kind: string;
  x: number;
  y: number;
  angle: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  vx: number;
  vy: number;
  held: boolean;
  grounded: boolean;
  asleep: boolean;
  taps: number;
  throws: number;
  bats: number;
}

/** The wall's debug state; positions in venue px with y down, like the stage. */
interface WallState {
  kind: "wall";
  ready: boolean;
  time: number;
  attract: boolean;
  handTosses: number;
  resets: number;
  floor: number;
  childTop: number;
  adultTop: number;
  rest: number[];
  balls: WallBallState[];
  props: WallToyState[];
  propRest: number[];
  net: { x: number; top: number; bottom: number; radius: number } | null;
  volleys: number;
  moves: { tap: number; throw: number; bat: number };
  botVolleys: number;
  botToys: number;
  particles: number;
  spawned: number;
  sea: { edge: number; wetTo: number; bigCount: number };
  botCrab: number;
  handPokes: number;
  uncovered: number;
  umbrella: {
    state: string;
    fold: number;
    closes: number;
    pulls: number;
    plants: number;
    x: number;
    home: number;
    rim: number;
    top: number;
    radius: number;
    tilt: number;
    hits: number;
    nudges: number;
    loose: { x: number; y: number; angle: number; grounded: boolean; asleep: boolean };
  } | null;
  bucket: {
    fill: number;
    mass: number;
    spadeIn: boolean;
    spadeLoad: number;
    castles: number;
    slumps: number;
    flings: number;
    refills: number;
    knocks: number;
  } | null;
  mounds: { castle: boolean; x: number; shape: number; hidden: boolean; phase: string }[];
  crab: {
    x: number;
    y: number;
    mode: string;
    claws: number;
    pokes: number;
    angers: number;
    pushes: number;
    shoves: number;
  } | null;
  sky: { mode: string; time: number; from: string; to: string; fade: number };
}

declare global {
  interface Window {
    __beachball?: {
      state(): BallState & WallState;
      toss(i?: number | string): void;
      wave(): void;
      skip(seconds: number): void;
      drop(kind: string, x: number, height: number, angle: number, spin?: number): void;
      roll(i: number, x: number, vx: number): void;
      crab(x: number): void;
      sky(t: number): void;
    };
  }
}

const open = async (page: Page, params: Record<string, string> = {}) => {
  const problems = watchPage(page);
  await page.setViewportSize(viewportFor(FEED));
  await page.goto(
    playPath({
      app: "beachball",
      kind: "sphere",
      size: FEED,
      bots: 0,
      params: { debug: "1", ...params },
    }),
  );
  const started = await waitForRunning(page);
  expect(started.phase, started.errors.join("; ")).toBe("running");
  await page.waitForFunction(() => window.__beachball?.state().ready === true, undefined, {
    timeout: 30_000,
  });
  return problems;
};

const ball = (page: Page) => page.evaluate(() => window.__beachball!.state());

type Png = ReturnType<typeof decodePng>;

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

/** Luminance spread along one row. */
const rowSpread = (img: Png, y: number) => {
  const row = img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4);
  return pixelStats({ width: img.width, height: 1, data: row }).stddev;
};

test.describe("beach ball", () => {
  test("spins lazily, takes a toss and settles back", async ({ page }) => {
    const problems = await open(page);
    const shot = decodePng(await shootStage(page));
    expect(pixelStats(shot).stddev).toBeGreaterThan(BLANK_STDDEV);

    const first = await ball(page);
    expect(first.tossing).toBe(false);
    expect(first.turns).toBeGreaterThan(1);
    expect(first.turns).toBeLessThan(5);
    await page.waitForTimeout(1000);
    expect((await ball(page)).time).toBeGreaterThan(first.time);

    await page.evaluate(() => window.__beachball!.toss());
    await page.evaluate(() => window.__beachball!.skip(1));
    const tossed = await ball(page);
    expect(tossed.tossing).toBe(true);
    expect(tossed.tossCount).toBe(first.tossCount + 1);
    expect(tossed.turns).toBeGreaterThan(2 * tossed.lazyTurns);

    await page.evaluate(() => window.__beachball!.skip(30));
    const settled = await ball(page);
    expect(settled.tossing).toBe(false);
    expect(Math.abs(settled.turns - settled.lazyTurns)).toBeLessThan(0.5);
    expect(problems).toEqual([]);
  });

  test("moves on through its poses and keeps its drops in bounds for hours", async ({ page }) => {
    const problems = await open(page);
    const tilts = new Set<number>();
    let tosses = 0;
    for (let i = 0; i < 12; i++) {
      await page.evaluate(() => window.__beachball!.skip(600));
      const s = await ball(page);
      tilts.add(s.tilt < 40 ? 0 : s.tilt > 140 ? 2 : 1);
      expect(s.drops.length).toBeLessThanOrEqual(3);
      for (const d of s.drops) expect(d.radius).toBeLessThan(0.03);
      tosses = s.tossCount;
    }
    expect(tilts.size).toBeGreaterThanOrEqual(2);
    expect(tosses).toBeGreaterThan(40);
    const shot = decodePng(await shootStage(page));
    expect(pixelStats(shot).stddev).toBeGreaterThan(BLANK_STDDEV);
    expect(problems).toEqual([]);
  });

  test("joins round the back and closes at the poles", async ({ page }) => {
    await open(page, { "o.extras": "false" });
    const img = decodePng(await shootStage(page));
    const w = img.width;
    // Across the seam at the back is no more different than any two neighbouring columns.
    const neighbours = Math.max(columnDiff(img, 0, 1), columnDiff(img, w - 2, w - 1), 1);
    expect(columnDiff(img, w - 1, 0)).toBeLessThan(4 * neighbours + 3);
    // The top and bottom rows each sit round a single point.
    expect(rowSpread(img, 0)).toBeLessThan(12);
    expect(rowSpread(img, img.height - 1)).toBeLessThan(12);
  });

  test("hangs as a ball in the globe preview", async ({ page }) => {
    const problems = await open(page, { look: "globe" });
    await expect(page.locator(".hc-globe")).toBeVisible();
    await page.waitForTimeout(2000);
    const size = page.viewportSize() ?? { width: 1280, height: 640 };
    const clip = { x: size.width / 2 - 60, y: size.height / 2 - 140, width: 120, height: 120 };
    const box = decodePng(await page.screenshot({ clip }));
    expect(pixelStats(box).stddev).toBeGreaterThan(BLANK_STDDEV);
    expect(pixelStats(box).mean).toBeGreaterThan(40);
    expect(problems).toEqual([]);
  });

  test("runs every palette, with tosses and extras off", async ({ page }) => {
    for (const colours of ["classic", "ocean", "sunset"]) {
      const problems = await open(page, {
        "o.colours": colours,
        "o.toss": "false",
        "o.extras": "false",
        "o.pace": "lively",
      });
      const status = await page.evaluate(() => window.__hypercube?.appStatus() ?? {});
      expect(status.colours).toBe(colours);
      expect(status.nextToss).toBe(-1);
      expect(status.drops).toBe(0);
      await page.evaluate(() => window.__beachball!.skip(300));
      expect((await ball(page)).tossCount).toBe(0);
      const shot = decodePng(await shootStage(page));
      expect(pixelStats(shot).stddev).toBeGreaterThan(BLANK_STDDEV);
      expect(problems).toEqual([]);
    }
  });

  test("keeps the show running through the idle reset", async ({ page }) => {
    const problems = await open(page, { idle: "5" });
    const before = await ball(page);
    await page.waitForFunction(() => (window.__beachball?.state().resets ?? 0) > 0, undefined, {
      timeout: 15_000,
    });
    const after = await ball(page);
    expect(after.time).toBeGreaterThan(before.time);
    expect(after.time).toBeGreaterThan(4);
    expect(after.drops.length).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });
});

const openWall = async (page: Page, params: Record<string, string> = {}, bots = 0) => {
  const problems = watchPage(page);
  await page.setViewportSize(viewportFor(WALL));
  await page.goto(
    playPath({
      app: "beachball",
      kind: "wall",
      size: WALL,
      bots,
      params: { debug: "1", ...params },
    }),
  );
  const started = await waitForRunning(page);
  expect(started.phase, started.errors.join("; ")).toBe("running");
  await page.waitForFunction(() => window.__beachball?.state().ready === true, undefined, {
    timeout: 30_000,
  });
  return problems;
};

const wall = (page: Page) => page.evaluate(() => window.__beachball!.state() as WallState);

interface Stroke {
  /** Venue px, y down. */
  points: { x: number; y: number }[];
  /** Ms between points. */
  every: number;
  /** Lift straight after the last move, as a flick does, rather than resting first. */
  flick?: boolean;
}

/** Fingers as real touch pointer events, each along its own path, all at once. */
const touch = (page: Page, strokes: Stroke[]) =>
  page.evaluate(async (list) => {
    const stage = document.querySelector<HTMLElement>(".hc-stage")!;
    const r = stage.getBoundingClientRect();
    const scale = (window.__hypercube?.frame?.unit ?? 1) * (r.width / stage.offsetWidth);
    const fire = (type: string, p: { x: number; y: number }, pointerId: number) => {
      const clientX = r.left + p.x * scale;
      const clientY = r.top + p.y * scale;
      (document.elementFromPoint(clientX, clientY) ?? stage).dispatchEvent(
        new PointerEvent(type, {
          clientX,
          clientY,
          pointerId,
          pointerType: "touch",
          bubbles: true,
          isPrimary: false,
          buttons: type === "pointerup" ? 0 : 1,
        }),
      );
    };
    const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
    await Promise.all(
      list.map(async (stroke, i) => {
        const id = 7000 + i + Math.floor(Math.random() * 400) * 8;
        const [first, ...rest] = stroke.points;
        fire("pointerdown", first!, id);
        let last = first!;
        for (const p of rest) {
          await wait(stroke.every);
          fire("pointermove", p, id);
          last = p;
        }
        if (!stroke.flick) await wait(stroke.every);
        fire("pointerup", last, id);
      }),
    );
  }, strokes);

test.describe("beach balls on a wall", () => {
  test("rest on the sand within a child's reach in front of a beach", async ({ page }) => {
    const problems = await openWall(page);
    const s = await wall(page);
    expect(s.balls).toHaveLength(2);
    for (const b of s.balls) {
      expect(b.grounded).toBe(true);
      // Venue y grows downwards: the ball's top is below the top of a child's reach.
      expect(b.y - b.r).toBeGreaterThan(s.childTop);
      expect(b.y + b.r).toBeCloseTo(s.floor, 0);
      expect(b.r * 2).toBeGreaterThan(120);
    }
    expect(Math.abs(s.balls[1]!.x - s.balls[0]!.x)).toBeGreaterThan(4 * s.balls[0]!.r);
    const shot = decodePng(await shootStage(page));
    expect(pixelStats(shot).stddev).toBeGreaterThan(BLANK_STDDEV);
    expect(problems).toEqual([]);
  });

  test("a tap pops a ball up and it comes down again", async ({ page }) => {
    const problems = await openWall(page);
    const before = (await wall(page)).balls[0]!;
    await touch(page, [{ points: [{ x: before.x - 30, y: before.y + 60 }], every: 60 }]);
    await expect
      .poll(async () => before.y - (await wall(page)).balls[0]!.y, { timeout: 3000 })
      .toBeGreaterThan(150);
    await expect
      .poll(async () => (await wall(page)).balls[0]!.grounded, { timeout: 10_000 })
      .toBe(true);
    expect(problems).toEqual([]);
  });

  test("a finger carries a ball and a flick throws it high", async ({ page }) => {
    const problems = await openWall(page);
    const s0 = await wall(page);
    const b = s0.balls[1]!;
    const points = Array.from({ length: 14 }, (_, i) => ({
      x: b.x + i * i * 2.5,
      y: b.y - i * i * 4.5,
    }));
    // Watch the ball's height while the finger moves, since a slow page stretches the gesture.
    const watch = page.evaluate(async () => {
      let top = Infinity;
      const until = performance.now() + 6000;
      while (performance.now() < until) {
        const ball = window.__beachball!.state().balls[1]!;
        top = Math.min(top, ball.y - ball.r);
        await new Promise((res) => requestAnimationFrame(res));
      }
      return top;
    });
    await touch(page, [{ points, every: 16, flick: true }]);
    const s1 = await wall(page);
    expect(s1.balls[1]!.throws).toBe(1);
    expect(s1.balls[1]!.taps).toBe(0);
    // It went up above a child's reach.
    expect(await watch).toBeLessThan(s0.childTop);
    expect(problems).toEqual([]);
  });

  test("swipes bat balls, and several fingers play at once", async ({ page }) => {
    // Without toys, which could lie where these swipes start.
    const problems = await openWall(page, { "o.balls": "3", "o.props": "false" });
    const s0 = await wall(page);
    expect(s0.balls).toHaveLength(3);
    const [a, b, c] = s0.balls as [WallBallState, WallBallState, WallBallState];
    const swipe = (ball: WallBallState, dir: number): Stroke => ({
      points: Array.from({ length: 10 }, (_, i) => ({
        x: ball.x - dir * 2.2 * ball.r + dir * i * ball.r * 0.6,
        y: ball.y + ball.r * 0.5 - i * 18,
      })),
      every: 16,
    });
    await touch(page, [
      swipe(a, 1),
      swipe(c, -1),
      { points: [{ x: b.x, y: b.y + 40 }], every: 50 },
    ]);
    const s1 = await wall(page);
    expect(s1.balls[0]!.bats, "the left ball batted").toBeGreaterThanOrEqual(1);
    expect(s1.balls[2]!.bats, "the right ball batted").toBeGreaterThanOrEqual(1);
    expect(s1.balls[1]!.taps, "the middle ball tapped").toBe(1);
    await page.waitForTimeout(300);
    const s2 = await wall(page);
    expect(s2.balls[0]!.x - a.x, "batted right").toBeGreaterThan(40);
    expect(c.x - s2.balls[2]!.x, "batted left").toBeGreaterThan(40);
    expect(problems).toEqual([]);
  });

  test("bots play through touches, and an unseen hand tosses balls in attract", async ({
    page,
  }) => {
    let problems = await openWall(page, {}, 2);
    await expect
      .poll(
        async () => {
          const m = (await wall(page)).moves;
          return m.tap + m.throw + m.bat;
        },
        { timeout: 20_000 },
      )
      .toBeGreaterThanOrEqual(3);
    expect((await wall(page)).handTosses).toBe(0);
    expect(problems).toEqual([]);

    problems = await openWall(page);
    await expect
      .poll(async () => (await wall(page)).handTosses, { timeout: 15_000 })
      .toBeGreaterThanOrEqual(1);
    expect(problems).toEqual([]);
  });

  test("a person's touch sends the unseen hand away, and idle puts the balls back", async ({
    page,
  }) => {
    const problems = await openWall(page, { idle: "6" });
    const s0 = await wall(page);
    const b = s0.balls[0]!;
    await touch(page, [{ points: [{ x: b.x, y: b.y }], every: 60 }]);
    expect((await wall(page)).attract).toBe(false);
    await page.evaluate(() => window.__beachball!.toss(1));
    await page.waitForFunction(() => (window.__beachball?.state().resets ?? 0) > 0, undefined, {
      timeout: 20_000,
    });
    const s1 = await wall(page);
    expect(s1.attract).toBe(true);
    s1.balls.forEach((ball, i) => {
      expect(ball.grounded).toBe(true);
      expect(Math.abs(ball.x - s1.rest[i]!)).toBeLessThan(2);
      expect(ball.vx).toBe(0);
    });
    s1.props.forEach((toy, i) => {
      expect(toy.grounded).toBe(true);
      expect(Math.abs(toy.x - s1.propRest[i]!)).toBeLessThan(2);
    });
    expect(s1.umbrella!.state).toBe("open");
    expect(s1.umbrella!.x).toBe(s1.umbrella!.home);
    expect(s1.bucket!.fill).toBe(1);
    expect(problems).toEqual([]);
  });

  test("a big wave wets the balls, they shed drops when struck, and effects stay bounded", async ({
    page,
  }) => {
    // Without toys, which a tossed ball can come to rest on above the water.
    const problems = await openWall(page, { "o.props": "false" });
    // The unseen hand may toss a ball while the wave is in, so each ball's wettest moment counts.
    const wettest = await page.evaluate(() => {
      const bb = window.__beachball!;
      bb.wave();
      const most: number[] = [];
      for (let i = 0; i < 24; i++) {
        bb.skip(0.25);
        (bb.state() as WallState).balls.forEach(
          (b, j) => (most[j] = Math.max(most[j] ?? 0, b.wet)),
        );
      }
      return most;
    });
    const wet = await wall(page);
    expect(wet.sea.bigCount).toBe(1);
    expect(wettest).toHaveLength(wet.balls.length);
    for (const w of wettest) expect(w).toBeGreaterThan(0.5);
    const before = wet.spawned;
    const b = wet.balls[0]!;
    await touch(page, [{ points: [{ x: b.x, y: b.y + 50 }], every: 50 }]);
    await expect.poll(async () => (await wall(page)).spawned).toBeGreaterThan(before + 3);
    // Hours of tosses keep every pool within its bounds.
    for (let i = 0; i < 20; i++) {
      await page.evaluate(() => {
        window.__beachball!.toss(0);
        window.__beachball!.toss(1);
        window.__beachball!.skip(9);
      });
    }
    const after = await wall(page);
    expect(after.particles).toBeLessThanOrEqual(160);
    for (const ball of after.balls) {
      expect(ball.x - ball.r).toBeGreaterThanOrEqual(-1);
      expect(ball.x + ball.r).toBeLessThanOrEqual(WALL.width + 1);
      expect(ball.y - ball.r).toBeGreaterThanOrEqual(-1);
      expect(ball.y + ball.r).toBeLessThanOrEqual(after.floor + 1);
    }
    expect(problems).toEqual([]);
  });

  test("runs every palette, one to three balls, with extras off", async ({ page }) => {
    for (const [colours, balls] of [
      ["ocean", "1"],
      ["sunset", "3"],
      ["classic", "2"],
    ] as const) {
      const problems = await openWall(page, {
        "o.colours": colours,
        "o.balls": balls,
        "o.extras": "false",
      });
      const status = await page.evaluate(() => window.__hypercube?.appStatus() ?? {});
      expect(status.colours).toBe(colours);
      expect(status.balls).toBe(Number(balls));
      await page.evaluate(() => {
        window.__beachball!.wave();
        window.__beachball!.toss(0);
        window.__beachball!.skip(8);
      });
      const s = await wall(page);
      expect(s.balls).toHaveLength(Number(balls));
      for (const b of s.balls) expect(b.wet).toBe(0);
      const shot = decodePng(await shootStage(page));
      expect(pixelStats(shot).stddev).toBeGreaterThan(BLANK_STDDEV);
      expect(problems).toEqual([]);
    }
  });

  test("beach toys rest on the sand within a child's reach, a tap flips one and a flick throws one", async ({
    page,
  }) => {
    const problems = await openWall(page);
    const s0 = await wall(page);
    expect(s0.props.map((t) => t.kind).sort()).toEqual(
      ["bottle", "bucket", "hat", "spade", "sunnies"].sort(),
    );
    for (const t of s0.props) {
      expect(t.grounded, t.kind).toBe(true);
      // Venue y grows downwards: each toy's bottom is on the sand and its top within a child's reach.
      expect(Math.abs(t.bottom - s0.floor), t.kind).toBeLessThan(4);
      expect(t.top, t.kind).toBeGreaterThan(s0.childTop);
      expect(t.right - t.left + 2 * 58, t.kind).toBeGreaterThan(120);
      for (const b of s0.balls) expect(t.right < b.x - b.r || t.left > b.x + b.r).toBe(true);
    }
    // A tap on the bucket pops it up and turns it over.
    const bucket = s0.props.find((t) => t.kind === "bucket")!;
    const i = s0.props.indexOf(bucket);
    const watch = page.evaluate(async (k) => {
      let top = Infinity;
      let turn = 0;
      const until = performance.now() + 2500;
      while (performance.now() < until) {
        const t = window.__beachball!.state().props[k]!;
        top = Math.min(top, t.y);
        turn = Math.max(turn, Math.abs(t.angle));
        await new Promise((res) => requestAnimationFrame(res));
      }
      return { top, turn };
    }, i);
    await touch(page, [{ points: [{ x: bucket.left + 30, y: bucket.y }], every: 60 }]);
    const tapped = await watch;
    expect((await wall(page)).props[i]!.taps).toBe(1);
    expect(bucket.y - tapped.top).toBeGreaterThan(100);
    expect(tapped.turn).toBeGreaterThan(0.8);
    // A flick from the bottle throws it up out of a child's reach. The tipped bucket may have
    // nudged it, so it is found afresh.
    const now = (await wall(page)).props;
    const bottle = now.find((t) => t.kind === "bottle")!;
    const j = now.indexOf(bottle);
    const high = page.evaluate(async (k) => {
      let top = Infinity;
      const until = performance.now() + 5000;
      while (performance.now() < until) {
        top = Math.min(top, window.__beachball!.state().props[k]!.top);
        await new Promise((res) => requestAnimationFrame(res));
      }
      return top;
    }, j);
    const side = bottle.x > WALL.width / 2 ? -1 : 1;
    const points = Array.from({ length: 14 }, (_, n) => ({
      x: bottle.x + side * n * n * 1.5,
      y: bottle.y - n * n * 4.5,
    }));
    await touch(page, [{ points, every: 16, flick: true }]);
    expect((await wall(page)).props[j]!.throws).toBe(1);
    expect(await high).toBeLessThan(s0.childTop);
    await page.evaluate(() => window.__beachball!.skip(8));
    for (const t of (await wall(page)).props) {
      expect(t.bottom, t.kind).toBeGreaterThan(s0.floor - 260);
      expect(t.bottom, t.kind).toBeLessThan(s0.floor + 25);
    }
    expect(problems).toEqual([]);
  });

  test("toys and the net are options", async ({ page }) => {
    let problems = await openWall(page, { "o.props": "false", "o.net": "false" });
    let s = await wall(page);
    expect(s.props).toEqual([]);
    expect(s.net).toBeNull();
    let status = await page.evaluate(() => window.__hypercube?.appStatus() ?? {});
    expect(status.toys).toBe(0);
    expect(status.net).toBe(false);
    const shot = decodePng(await shootStage(page));
    expect(pixelStats(shot).stddev).toBeGreaterThan(BLANK_STDDEV);
    expect(problems).toEqual([]);

    problems = await openWall(page, { "o.net": "false" });
    s = await wall(page);
    expect(s.props).toHaveLength(5);
    expect(s.net).toBeNull();
    status = await page.evaluate(() => window.__hypercube?.appStatus() ?? {});
    expect(status.toys).toBe(5);
    expect(problems).toEqual([]);
  });

  test("a net divides the wall within an adult's reach, and the unseen hand volleys over it", async ({
    page,
  }) => {
    const problems = await openWall(page);
    const s0 = await wall(page);
    const net = s0.net!;
    expect(Math.abs(net.x - WALL.width / 2)).toBeLessThan(2);
    // Venue y grows downwards: the net's top is below the top of an adult's reach and above the
    // balls, with one ball each side.
    expect(net.top).toBeGreaterThan(s0.adultTop);
    expect(net.top).toBeLessThan(s0.balls[0]!.y - s0.balls[0]!.r);
    expect(s0.balls.filter((b) => b.x < net.x)).toHaveLength(1);
    // Tosses from the unseen hand: some go over the net, and nothing stays on it.
    let crossed = 0;
    let side = Math.sign(s0.balls[0]!.x - net.x);
    for (let n = 0; n < 16; n++) {
      await page.evaluate(() => {
        window.__beachball!.toss(0);
        window.__beachball!.skip(7);
      });
      const s = await wall(page);
      const now = Math.sign(s.balls[0]!.x - net.x);
      if (now !== side) crossed++;
      side = now;
    }
    const s1 = await wall(page);
    expect(s1.volleys).toBeGreaterThanOrEqual(2);
    expect(crossed).toBeGreaterThanOrEqual(2);
    for (const b of s1.balls) {
      expect(Math.abs(b.x - net.x)).toBeGreaterThan(b.r);
      // On the sand, or resting low on a toy.
      expect(b.y + b.r).toBeGreaterThan(s1.floor - 130);
    }
    expect(problems).toEqual([]);
  });

  test("bots play with the toys and volley over the net", async ({ page }) => {
    const problems = await openWall(page, {}, 3);
    await expect
      .poll(async () => (await wall(page)).botToys, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(1);
    await expect
      .poll(async () => (await wall(page)).botVolleys, { timeout: 40_000 })
      .toBeGreaterThanOrEqual(1);
    await expect
      .poll(async () => (await wall(page)).props.some((t) => t.taps + t.throws > 0), {
        timeout: 40_000,
      })
      .toBe(true);
    expect(problems).toEqual([]);
  });

  test("an umbrella stands at the left end: knocks rock it, a hold folds it, a drag pulls it out and a hold stands it up", async ({
    page,
  }) => {
    const problems = await openWall(page, { "o.props": "false" });
    const s0 = await wall(page);
    const u = s0.umbrella!;
    expect(u.state).toBe("open");
    expect(u.x - u.radius).toBeGreaterThan(0);
    expect(u.x).toBeLessThan(WALL.width / 4);
    // Venue y grows downwards: its rim is above a child's reach and within an adult's, and its
    // crown no more than a hand's span above an adult's.
    expect(u.rim).toBeLessThan(s0.childTop);
    expect(u.rim).toBeGreaterThan(s0.adultTop);
    expect(u.top).toBeGreaterThan(s0.adultTop - 0.25 * PX_PER_M);
    const pole = { x: u.x, y: s0.floor - 450 };
    // A tap rocks it.
    await touch(page, [{ points: [pole], every: 60 }]);
    await expect.poll(async () => (await wall(page)).umbrella!.nudges).toBeGreaterThanOrEqual(1);
    // A finger held on it folds it.
    await touch(page, [{ points: Array.from({ length: 12 }, () => pole), every: 90 }]);
    await expect
      .poll(async () => (await wall(page)).umbrella!.state, { timeout: 5000 })
      .toBe("closed");
    // Dragged, it comes out of the sand, and lies down out of the way.
    await touch(page, [
      {
        points: Array.from({ length: 12 }, (_, i) => ({ x: pole.x + i * 30, y: pole.y })),
        every: 40,
      },
    ]);
    await expect.poll(async () => (await wall(page)).umbrella!.state).toBe("loose");
    await page.evaluate(() => window.__beachball!.skip(6));
    const lying = (await wall(page)).umbrella!;
    expect(lying.loose.asleep).toBe(true);
    // Held still where it lies, it stands up there and opens.
    const at = { x: lying.loose.x, y: lying.loose.y };
    await touch(page, [{ points: Array.from({ length: 12 }, () => at), every: 90 }]);
    await page.evaluate(() => window.__beachball!.skip(3));
    const s1 = await wall(page);
    expect(s1.umbrella!.state).toBe("open");
    expect(s1.umbrella!.plants).toBe(1);
    expect(problems).toEqual([]);
  });

  test("the bucket's sand falls out when it is turned over, and an empty bucket fills again", async ({
    page,
  }) => {
    const problems = await openWall(page, { "o.net": "false" });
    const s0 = await wall(page);
    expect(s0.bucket!.fill).toBe(1);
    const bucket = s0.props.find((t) => t.kind === "bucket")!;
    // Turned over onto the sand, it leaves a castle that shows once it is lifted off.
    await page.evaluate((x) => {
      window.__beachball!.drop("bucket", x, 0.3, Math.PI - 0.04);
      window.__beachball!.skip(1.5);
    }, bucket.x);
    let s = await wall(page);
    expect(s.bucket!.castles).toBe(1);
    expect(s.bucket!.fill).toBe(0);
    expect(s.bucket!.mass).toBeLessThan(1);
    await page.evaluate(() => window.__beachball!.skip(10));
    s = await wall(page);
    expect(s.uncovered).toBeGreaterThanOrEqual(1);
    const castle = s.mounds.find((m) => m.castle)!;
    expect(castle.hidden).toBe(false);
    const shot = decodePng(await shootStage(page));
    expect(pixelStats(shot).stddev).toBeGreaterThan(BLANK_STDDEV);
    // A finger knocks it down.
    await touch(page, [{ points: [{ x: castle.x, y: s.floor - 60 }], every: 60 }]);
    await expect.poll(async () => (await wall(page)).bucket!.knocks).toBeGreaterThanOrEqual(1);
    // Left upright, it is shovelled full again, and the sand in its pools stays bounded.
    await page.evaluate(() => window.__beachball!.skip(40));
    for (let i = 0; i < 12; i++) {
      await page.evaluate(() => {
        window.__beachball!.toss("bucket");
        window.__beachball!.skip(15);
      });
    }
    s = await wall(page);
    expect(s.bucket!.refills).toBeGreaterThanOrEqual(1);
    expect(s.mounds.length).toBeLessThanOrEqual(6);
    expect(s.particles).toBeLessThanOrEqual(160);
    expect(problems).toEqual([]);
  });

  test("the crab scuttles about, snaps at a finger and pushes away a ball rolling at it", async ({
    page,
  }) => {
    const problems = await openWall(page, { "o.props": "false", "o.net": "false" });
    const s0 = await wall(page);
    const c0 = s0.crab!;
    expect(c0.y).toBeGreaterThan(s0.childTop);
    await page.evaluate(() => window.__beachball!.skip(20));
    const moved = (await wall(page)).crab!;
    expect(Math.abs(moved.x - c0.x)).toBeGreaterThan(20);
    // A finger on it: it snaps, never carried along.
    await page.evaluate(() => window.__beachball!.crab(3000));
    const c = (await wall(page)).crab!;
    // The unseen hand may already have poked it.
    const watch = page.evaluate(async () => {
      let angry = false;
      const until = performance.now() + 1500;
      while (performance.now() < until) {
        if (window.__beachball!.state().crab!.mode === "angry") angry = true;
        await new Promise((res) => requestAnimationFrame(res));
      }
      return angry;
    });
    await touch(page, [
      {
        points: Array.from({ length: 10 }, (_, i) => ({ x: c.x + i * 25, y: c.y - 20 - i * 25 })),
        every: 60,
      },
    ]);
    expect(await watch).toBe(true);
    const s1 = await wall(page);
    expect(s1.crab!.pokes).toBe(c.pokes + 1);
    expect(s1.crab!.angers).toBeGreaterThanOrEqual(c.angers + 1);
    expect(s1.crab!.y).toBeCloseTo(c.y, 0);
    // A ball rolled at it is pushed back.
    await page.evaluate(() => {
      window.__beachball!.skip(4);
      window.__beachball!.crab(3000);
      window.__beachball!.roll(0, 3900, -1400);
      window.__beachball!.skip(1.5);
    });
    const s2 = await wall(page);
    expect(s2.crab!.pushes).toBeGreaterThanOrEqual(1);
    expect(s2.balls[0]!.x).toBeGreaterThan(3000);
    expect(problems).toEqual([]);
  });

  test("bots and the unseen hand poke the crab", async ({ page }) => {
    let problems = await openWall(page, {}, 3);
    await expect
      .poll(async () => (await wall(page)).botCrab, { timeout: 40_000 })
      .toBeGreaterThanOrEqual(1);
    expect(problems).toEqual([]);
    problems = await openWall(page);
    for (let i = 0; i < 30; i++) {
      await page.evaluate(() => window.__beachball!.skip(12));
      if ((await wall(page)).handPokes > 0) break;
    }
    expect((await wall(page)).handPokes).toBeGreaterThanOrEqual(1);
    expect(problems).toEqual([]);
  });

  test("runs every time of day, fading from one to the next, with the umbrella and crab off", async ({
    page,
  }) => {
    for (const sky of ["sunset", "evening", "sunrise"]) {
      const problems = await openWall(page, { "o.sky": sky });
      const s = await wall(page);
      expect(s.sky.mode).toBe(sky);
      const status = await page.evaluate(() => window.__hypercube?.appStatus() ?? {});
      expect(status.sky).toBe(sky);
      const shot = decodePng(await shootStage(page));
      expect(pixelStats(shot).stddev).toBeGreaterThan(BLANK_STDDEV);
      expect(problems).toEqual([]);
    }
    const problems = await openWall(page, { "o.umbrella": "false", "o.crab": "false" });
    let s = await wall(page);
    expect(s.umbrella).toBeNull();
    expect(s.crab).toBeNull();
    expect(s.sky).toMatchObject({ mode: "cycle", from: "day" });
    // Eight minutes on, the day is fading into sunset.
    await page.evaluate(() => window.__beachball!.sky(510));
    s = await wall(page);
    expect(s.sky).toMatchObject({ from: "day", to: "sunset" });
    const shot = decodePng(await shootStage(page));
    expect(pixelStats(shot).stddev).toBeGreaterThan(BLANK_STDDEV);
    expect(problems).toEqual([]);
  });
});
