import { expect, type Page, test } from "@playwright/test";
import { playPath, viewportFor, waitForRunning, watchPage } from "../scripts/lib/play.mjs";
import { BLANK_STDDEV, decodePng, pixelStats } from "../scripts/lib/png.mjs";

const FEED = { width: 4096, height: 2048 };

interface ClawMachine {
  phase: string;
  round: number;
  wins: number;
  prizes: number;
  stock: number;
  rounds: number;
  bodies: number;
}

interface ClawState {
  t: number;
  ready: boolean;
  frames: number;
  wins: number;
  luck: string;
  heap: number;
  landed: number;
  flights: { cabinet: number; stage: string }[];
  machines: ClawMachine[];
  layout: { top: number; bottom: number; play: { width: number; height: number } };
  strip: { width: number; height: number } | null;
  feed: { width: number; height: number };
  onFloor: number;
  floorDraws: number;
}

interface WallMachine extends ClawMachine {
  x: number;
  timeLeft: number;
  player: "auto" | "bot" | "person";
  queued: string | null;
  waiting: boolean;
  stick: number;
  tray: number;
  landed: number;
  personRounds: number;
  personWins: number;
  botRounds: number;
  botWins: number;
}

interface WallState {
  kind: "wall";
  t: number;
  frames: number;
  wins: number;
  luck: string;
  layout: { count: number; play: { width: number }; button: number; childTop: number };
  machines: WallMachine[];
  visitors: { cabinet: number | null; state: string; rounds: number }[];
  canvas: { width: number; height: number };
}

type Button = "left" | "right" | "drop";

declare global {
  interface Window {
    __claw?: {
      state(): ClawState;
      skip(seconds: number): void;
      win(i: number): boolean;
      strong(i: number): void;
      button?(i: number, b: Button): { x: number; y: number; r: number } | null;
      glass?(i: number): { x: number; y: number } | null;
    };
  }
}

const open = async (page: Page, params: Record<string, string | number> = {}) => {
  const problems = watchPage(page);
  await page.setViewportSize(viewportFor(FEED));
  await page.goto(
    playPath({
      app: "claw",
      kind: "sphere",
      size: FEED,
      bots: 0,
      params: { debug: 1, res: 0.5, ...params },
    }),
  );
  const started = await waitForRunning(page);
  expect(started.phase, started.errors.join("; ")).toBe("running");
  await page.waitForFunction(
    () => window.__claw?.state().ready === true && window.__claw.state().frames > 10,
    undefined,
    { timeout: 30_000 },
  );
  return problems;
};

const state = (page: Page) => page.evaluate(() => window.__claw!.state());

const spread = async (page: Page, clip: { x: number; y: number; width: number; height: number }) =>
  pixelStats(decodePng(await page.screenshot({ clip }))).stddev;

test.describe("claw", () => {
  test("draws four stocked cabinets on the flat feed and plays", async ({ page }) => {
    const problems = await open(page);
    const a = await state(page);
    expect(a.machines).toHaveLength(4);
    expect(a.luck).toBe("fair");
    for (const m of a.machines) {
      expect(m.prizes).toBeGreaterThanOrEqual(m.stock - 1);
      expect(m.prizes).toBeLessThanOrEqual(m.stock);
    }
    expect(a.heap).toBeGreaterThan(10);
    expect(a.strip!.width).toBe(a.feed.width);
    const shot = await page.locator(".hc-stage").screenshot();
    expect(pixelStats(decodePng(shot)).stddev).toBeGreaterThan(BLANK_STDDEV);

    await page.waitForTimeout(1500);
    const b = await state(page);
    expect(b.t).toBeGreaterThan(a.t + 1);
    expect(b.frames).toBeGreaterThan(a.frames);
    const status = await page.evaluate(() => window.__hypercube?.appStatus() ?? {});
    expect(status.machines).toBe(4);
    expect(status.heap).toBe(b.heap);
    expect(problems).toEqual([]);
  });

  test("looks like a ball in the globe preview, from beside, below and far", async ({ page }) => {
    const problems = await open(page, { look: "globe" });
    await expect(page.locator(".hc-globe")).toBeVisible();
    await page.waitForTimeout(1500);
    const size = page.viewportSize() ?? { width: 1280, height: 640 };
    const ball = { x: size.width / 2 - 80, y: size.height / 2 - 160, width: 160, height: 160 };
    expect(await spread(page, ball)).toBeGreaterThan(BLANK_STDDEV);
    for (const view of ["under", "far"]) {
      await page.click(`button[data-globe=${view}]`);
      await page.waitForTimeout(500);
      const shot = await page.screenshot();
      expect(pixelStats(decodePng(shot)).stddev).toBeGreaterThan(BLANK_STDDEV);
    }
    expect(problems).toEqual([]);
  });

  test("a won prize comes out of the door and slides to the heap", async ({ page }) => {
    const problems = await open(page);
    const before = await state(page);
    expect(await page.evaluate(() => window.__claw!.win(0))).toBe(true);
    await page.waitForFunction(() => (window.__claw?.state().flights.length ?? 0) > 0, undefined, {
      timeout: 10_000,
    });
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const s = await state(page);
      for (const f of s.flights) seen.add(f.stage);
      if (s.landed > before.landed) break;
      await page.waitForTimeout(150);
    }
    const after = await state(page);
    expect(after.wins).toBeGreaterThan(before.wins);
    expect(after.landed).toBeGreaterThan(before.landed);
    expect(seen.has("slide")).toBe(true);
    expect(after.floorDraws).toBeGreaterThan(before.floorDraws);
    expect(problems).toEqual([]);
  });

  test("every machine moves on through rounds, and nothing piles up", async ({ page }) => {
    test.setTimeout(90_000);
    const problems = await open(page);
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.__claw!.skip(30));
      await page.waitForTimeout(100);
    }
    const s = await state(page);
    expect(s.t).toBeGreaterThan(175);
    for (const m of s.machines) {
      expect(m.round).toBeGreaterThanOrEqual(4);
      expect(m.prizes).toBeLessThanOrEqual(m.stock);
      expect(m.prizes).toBeGreaterThanOrEqual(m.stock - 2);
      expect(m.bodies).toBeLessThanOrEqual(m.stock + 6);
    }
    expect(s.heap).toBeLessThanOrEqual(33);
    const phases = new Set(s.machines.map((m) => m.phase));
    expect(phases.size).toBeGreaterThanOrEqual(1);
    expect(problems).toEqual([]);
  });

  test("three wider machines with generous luck", async ({ page }) => {
    const problems = await open(page, { "o.machines": "3", "o.luck": "generous" });
    const s = await state(page);
    expect(s.machines).toHaveLength(3);
    expect(s.luck).toBe("generous");
    expect(s.layout.play.width).toBeGreaterThan(4);
    const shot = await page.locator(".hc-stage").screenshot();
    expect(pixelStats(decodePng(shot)).stddev).toBeGreaterThan(BLANK_STDDEV);
    expect(problems).toEqual([]);
  });

  test("a resize rebuilds the picture and the machines carry on", async ({ page }) => {
    const problems = await open(page);
    const before = await state(page);
    await page.setViewportSize({ width: 960, height: 480 });
    await page.waitForFunction(
      (w) => (window.__claw?.state().feed.width ?? w) !== w,
      before.feed.width,
      { timeout: 10_000 },
    );
    await page.waitForTimeout(800);
    const after = await state(page);
    expect(after.strip!.width).toBe(after.feed.width);
    expect(after.machines).toHaveLength(4);
    expect(after.t).toBeGreaterThan(before.t);
    expect(after.heap).toBeGreaterThanOrEqual(before.heap);
    expect(after.onFloor).toBeGreaterThanOrEqual(after.heap - 1);
    const shot = await page.locator(".hc-stage").screenshot();
    expect(pixelStats(decodePng(shot)).stddev).toBeGreaterThan(BLANK_STDDEV);
    expect(problems).toEqual([]);
  });

  test("going idle keeps the machines playing without a jump", async ({ page }) => {
    const problems = await open(page, { idle: 5 });
    const before = await state(page);
    await page.waitForTimeout(6500);
    const after = await state(page);
    expect(after.t - before.t).toBeGreaterThan(5);
    expect(after.heap).toBeGreaterThanOrEqual(before.heap);
    for (let i = 0; i < after.machines.length; i++) {
      expect(after.machines[i]!.round).toBeGreaterThanOrEqual(before.machines[i]!.round);
    }
    expect(problems).toEqual([]);
  });
});

const WALL = { width: 5760, height: 2160 };

const openWall = async (page: Page, params: Record<string, string | number> = {}, bots = 0) => {
  const problems = watchPage(page);
  await page.setViewportSize(viewportFor(WALL));
  await page.goto(
    playPath({
      app: "claw",
      kind: "wall",
      size: WALL,
      bots,
      params: { debug: 1, res: 0.5, ...params },
    }),
  );
  const started = await waitForRunning(page);
  expect(started.phase, started.errors.join("; ")).toBe("running");
  await page.waitForFunction(() => (window.__claw?.state().frames ?? 0) > 10, undefined, {
    timeout: 30_000,
  });
  return problems;
};

const wallState = (page: Page) =>
  page.evaluate(() => window.__claw!.state() as unknown as WallState);

const buttonOf = async (page: Page, i: number, b: Button) => {
  const p = await page.evaluate(([i, b]) => window.__claw!.button!(i, b), [i, b] as const);
  expect(p, `${b} on cabinet ${i}`).not.toBeNull();
  return p!;
};

/** Wait until cabinet `i` is between rounds or being aimed, so a press takes it at once. */
const whenFree = async (page: Page, i: number) =>
  page.waitForFunction(
    (i) => ["idle", "play"].includes(window.__claw!.state().machines[i]!.phase),
    i,
    { timeout: 40_000 },
  );

/** A real touch with its own pointer id, down at a client point until `up()`. */
const finger = async (page: Page, id: number, at: { x: number; y: number }) => {
  await page.evaluate(
    ({ id, x, y }) => {
      const target = document.elementFromPoint(x, y) ?? document.body;
      const init = { pointerId: id, pointerType: "touch", bubbles: true, clientX: x, clientY: y };
      target.dispatchEvent(new PointerEvent("pointerdown", { ...init, buttons: 1 }));
    },
    { id, ...at },
  );
  return {
    up: () =>
      page.evaluate(
        ({ id, x, y }) => {
          const init = {
            pointerId: id,
            pointerType: "touch",
            bubbles: true,
            clientX: x,
            clientY: y,
          };
          window.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0 }));
        },
        { id, ...at },
      ),
  };
};

test.describe("claw on a wall", () => {
  test("stands three stocked cabinets that play themselves", async ({ page }) => {
    const problems = await openWall(page);
    const a = await wallState(page);
    expect(a.kind).toBe("wall");
    expect(a.machines).toHaveLength(3);
    expect(a.layout.button).toBeGreaterThanOrEqual(150);
    for (const m of a.machines) {
      expect(m.player).toBe("auto");
      expect(m.prizes).toBeGreaterThanOrEqual(m.stock - 1);
      // A prize or two already lies in each hatch.
      expect(m.tray).toBeGreaterThanOrEqual(1);
    }
    const shot = await page.locator(".hc-stage").screenshot();
    expect(pixelStats(decodePng(shot)).stddev).toBeGreaterThan(BLANK_STDDEV);
    await page.evaluate(() => window.__claw!.skip(60));
    await page.waitForTimeout(300);
    const b = await wallState(page);
    for (const m of b.machines) {
      expect(m.round).toBeGreaterThanOrEqual(2);
      expect(m.player).toBe("auto");
    }
    expect(b.frames).toBeGreaterThan(a.frames);
    expect(problems).toEqual([]);
  });

  test("a press takes a cabinet: the arrows move the claw and the button drops it", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const problems = await openWall(page);
    await whenFree(page, 0);
    // The claw starts over the chute, at this cabinet's right: hold left.
    const left = await buttonOf(page, 0, "left");
    await page.mouse.move(left.x, left.y);
    await page.mouse.down();
    await page.waitForTimeout(150);
    const taken = await wallState(page);
    expect(taken.machines[0]!.player).toBe("person");
    await page.waitForTimeout(1200);
    const held = await wallState(page);
    expect(held.machines[0]!.phase).toBe("play");
    expect(held.machines[0]!.stick).toBe(-1);
    await page.mouse.up();
    await page.waitForTimeout(500);
    const a = await wallState(page);
    expect(a.machines[0]!.stick).toBe(0);
    expect(a.machines[0]!.timeLeft).toBeGreaterThan(10);

    const right = await buttonOf(page, 0, "right");
    await page.mouse.move(right.x, right.y);
    await page.mouse.down();
    await page.waitForTimeout(500);
    await page.mouse.up();
    await page.waitForTimeout(500);
    const b = await wallState(page);
    expect(b.machines[0]!.x).toBeGreaterThan(a.machines[0]!.x + 0.1);
    expect(b.machines[0]!.phase).toBe("play");

    const drop = await buttonOf(page, 0, "drop");
    await page.mouse.move(drop.x, drop.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForFunction(() => window.__claw!.state().machines[0]!.phase !== "play");
    // The claw drops, grabs, comes back, and the machine waits for its player.
    await page.waitForFunction(
      () => {
        const m = (window.__claw!.state() as unknown as WallState).machines[0]!;
        return m.phase === "idle" && m.waiting;
      },
      undefined,
      { timeout: 30_000 },
    );
    const c = await wallState(page);
    expect(c.machines[0]!.player).toBe("person");
    expect(c.machines[0]!.personRounds).toBe(1);
    // Nobody comes back: it plays itself again.
    await page.evaluate(() => window.__claw!.skip(12));
    const d = await wallState(page);
    expect(d.machines[0]!.player).toBe("auto");
    expect(problems).toEqual([]);
  });

  test("several people play different cabinets at once", async ({ page }) => {
    test.setTimeout(90_000);
    const problems = await openWall(page);
    await whenFree(page, 0);
    await whenFree(page, 2);
    const before = await wallState(page);
    // Two fingers on two cabinets at once, one on each cabinet's arrow towards the middle.
    const a = await finger(page, 31, await buttonOf(page, 0, "left"));
    const b = await finger(page, 32, await buttonOf(page, 2, "left"));
    await page.waitForTimeout(1000);
    const s = await wallState(page);
    expect(s.machines[0]!.player).toBe("person");
    expect(s.machines[2]!.player).toBe("person");
    expect(s.machines[0]!.stick).toBe(-1);
    expect(s.machines[2]!.stick).toBe(-1);
    expect(s.machines[1]!.player).toBe("auto");
    await a.up();
    await b.up();
    await page.waitForTimeout(300);
    const after = await wallState(page);
    expect(after.machines[0]!.x).toBeLessThan(before.machines[0]!.x - 0.3);
    expect(after.machines[2]!.x).toBeLessThan(before.machines[2]!.x - 0.3);
    // A touch on the glass doesn't take a cabinet.
    const glass = await page.evaluate(() => window.__claw!.glass!(1));
    const g = await finger(page, 33, glass!);
    await g.up();
    expect((await wallState(page)).machines[1]!.player).toBe("auto");
    expect(problems).toEqual([]);
  });

  test("bots press the buttons and play their own rounds, which never count as people's", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const problems = await openWall(page, {}, 2);
    await page.waitForFunction(
      () =>
        (window.__claw!.state() as unknown as WallState).visitors.some((v) => v.state === "play"),
      undefined,
      { timeout: 30_000 },
    );
    for (let i = 0; i < 8; i++) {
      await page.evaluate(() => window.__claw!.skip(20));
      await page.waitForTimeout(100);
    }
    const s = await wallState(page);
    const botRounds = s.machines.reduce((n, m) => n + m.botRounds, 0);
    expect(botRounds).toBeGreaterThan(2);
    for (const m of s.machines) {
      expect(m.personRounds).toBe(0);
      expect(m.personWins).toBe(0);
      expect(m.prizes).toBeLessThanOrEqual(m.stock);
      expect(m.tray).toBeLessThanOrEqual(8);
    }
    const status = await page.evaluate(() => window.__hypercube?.appStatus() ?? {});
    expect(status.rounds).toBe(0);
    expect(problems).toEqual([]);
  });

  test("a won prize drops into the hatch", async ({ page }) => {
    const problems = await openWall(page);
    const before = await wallState(page);
    expect(await page.evaluate(() => window.__claw!.win(1))).toBe(true);
    await page.waitForFunction(
      (n) => (window.__claw!.state() as unknown as WallState).machines[1]!.landed > n,
      before.machines[1]!.landed,
      { timeout: 10_000 },
    );
    const after = await wallState(page);
    expect(after.wins).toBeGreaterThan(before.wins);
    expect(after.machines[1]!.tray).toBeGreaterThan(before.machines[1]!.tray - 1);
    expect(problems).toEqual([]);
  });

  test("going idle hands every cabinet back to the machine", async ({ page }) => {
    test.setTimeout(60_000);
    const problems = await openWall(page, { idle: 5, "o.cabinets": "4", "o.luck": "generous" });
    const a = await wallState(page);
    expect(a.machines).toHaveLength(4);
    expect(a.luck).toBe("generous");
    await whenFree(page, 3);
    const p = await buttonOf(page, 3, "right");
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(200);
    expect((await wallState(page)).machines[3]!.player).toBe("person");
    await page.waitForFunction(
      () => (window.__claw!.state() as unknown as WallState).machines[3]!.player === "auto",
      undefined,
      { timeout: 15_000 },
    );
    expect(problems).toEqual([]);
  });

  test("two wide cabinets, and a resize keeps them playing", async ({ page }) => {
    const problems = await openWall(page, { "o.cabinets": "2" });
    const a = await wallState(page);
    expect(a.machines).toHaveLength(2);
    expect(a.layout.play.width).toBeGreaterThan(4);
    await page.setViewportSize({ width: 960, height: 360 });
    await page.waitForFunction(
      (w) => (window.__claw!.state() as unknown as WallState).canvas.width !== w,
      a.canvas.width,
      { timeout: 10_000 },
    );
    await page.waitForTimeout(500);
    const b = await wallState(page);
    expect(b.machines).toHaveLength(2);
    expect(b.t).toBeGreaterThan(a.t);
    const shot = await page.locator(".hc-stage").screenshot();
    expect(pixelStats(decodePng(shot)).stddev).toBeGreaterThan(BLANK_STDDEV);
    expect(problems).toEqual([]);
  });

  test("runs in the simulator's wall preset", async ({ page }) => {
    test.setTimeout(90_000);
    const problems = watchPage(page);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto("sim/?preset=wall&app=claw&transport=local&bots=2&seed=test");
    await page.waitForFunction(() => window.__hypercubeSim !== undefined);
    await page.waitForFunction(
      () => {
        const f = document.querySelector<HTMLIFrameElement>(".sim-frame[data-frame] iframe");
        const s = f?.contentWindow?.__hypercube;
        return s?.phase === "running" && s.app === "claw" && s.frame?.kind === "wall";
      },
      undefined,
      { timeout: 60_000 },
    );
    await page.waitForTimeout(3000);
    const errors = await page.evaluate(() => {
      const f = document.querySelector<HTMLIFrameElement>(".sim-frame[data-frame] iframe");
      return [...(f?.contentWindow?.__hypercube?.errors ?? [])];
    });
    expect(errors).toEqual([]);
    expect(problems).toEqual([]);
  });
});
