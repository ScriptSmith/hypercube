import { expect, type Page, test } from "@playwright/test";
import { watchPage } from "../scripts/lib/play.mjs";

/** What each frame's treetop app reports on its root element (see panel.ts and screen.ts). */
interface Hook {
  k: number;
  phase: string;
  /** Touch frames: lone, attract or bank. */
  play?: string;
  /** The bank's heat phase, and on the screen the lanes in it. */
  heat?: string | null;
  racers?: number[];
  start: number;
  hash: number;
  leader: boolean;
  offset: number;
  synced: boolean;
  lanes: {
    id: number;
    ctrl: string;
    state?: string;
    mode: string;
    d: number;
    racer?: boolean;
    practice?: boolean;
    shown?: boolean;
  }[];
}

interface Snap {
  id: string;
  kind: string | null;
  room: string;
  hook: Hook | null;
  box: { x: number; y: number; width: number; height: number } | null;
}

const snapshot = (page: Page): Promise<Snap[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".sim-frame[data-frame]")].map((el) => {
      const iframe = el.querySelector("iframe");
      const w = iframe?.contentWindow;
      const raw = w?.document.querySelector("[data-treetop]")?.getAttribute("data-treetop");
      const r = iframe?.getBoundingClientRect();
      return {
        id: el.dataset.frame ?? "?",
        kind: w?.__hypercube?.frame?.kind ?? null,
        room: w?.__hypercube?.room ?? "none",
        hook: raw ? (JSON.parse(raw) as Hook) : null,
        box: r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null,
      };
    }),
  );

const hookOf = (page: Page) =>
  page.evaluate(() => {
    const raw = document.querySelector("[data-treetop]")?.getAttribute("data-treetop");
    return raw ? (JSON.parse(raw) as Hook) : null;
  });

/** Wait until every frame is online with a synced clock and the app reporting. */
const settle = async (page: Page, timeout = 120_000): Promise<Snap[]> => {
  const start = Date.now();
  let frames: Snap[] = [];
  while (Date.now() - start < timeout) {
    frames = await snapshot(page);
    if (frames.length > 1 && frames.every((f) => f.room === "online" && f.hook?.synced))
      return frames;
    await page.waitForTimeout(500);
  }
  return frames;
};

test.describe("treetop in a bank", () => {
  test.setTimeout(240_000);

  test("treetop: every frame flies the same course on the same countdown", async ({ page }) => {
    const problems = watchPage(page);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto("sim/?preset=bank-panels&app=treetop&transport=local&bots=0&seed=test");
    let frames = await settle(page);
    expect(frames.length).toBe(7);
    // Read again a moment later so no frame is caught between races.
    await page.waitForTimeout(1500);
    frames = await snapshot(page);
    const hooks = frames.map((f) => f.hook!);
    const sameRace = hooks.filter((h) => h.k === hooks[0]!.k);
    expect(sameRace.length, "frames on one race").toBeGreaterThanOrEqual(6);
    expect(new Set(sameRace.map((h) => h.hash)).size, "course hashes").toBe(1);
    expect(new Set(sameRace.map((h) => h.start)).size, "race starts").toBe(1);
    // Countdowns follow each frame's clock, so the clocks must agree within 50 ms. The estimate
    // tightens over its first few pings, so give it time on a busy machine.
    const spread = async () => {
      const offsets = (await snapshot(page)).flatMap((f) => (f.hook ? [f.hook.offset] : []));
      return Math.max(...offsets) - Math.min(...offsets);
    };
    await expect.poll(spread, { timeout: 60_000, intervals: [1000] }).toBeLessThan(50);
    const screen = frames.find((f) => f.kind === "screen")!;
    expect(screen.hook!.leader, "the screen leads").toBe(true);
    // The screen hears every lane below it.
    await expect
      .poll(
        async () =>
          (await snapshot(page)).find((f) => f.kind === "screen")?.hook?.lanes.length ?? 0,
        {
          timeout: 15_000,
        },
      )
      .toBe(6);
    expect(problems).toEqual([]);
  });

  test("treetop: panels keep racing when the screen goes", async ({ page }) => {
    const problems = watchPage(page);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto("sim/?preset=bank-pairs&app=treetop&transport=local&bots=0&seed=test");
    await settle(page);
    await page.evaluate(() => {
      for (const el of document.querySelectorAll(".sim-frame[data-frame] iframe")) {
        const w = (el as HTMLIFrameElement).contentWindow;
        if (w?.__hypercube?.frame?.kind === "screen") el.remove();
      }
    });
    // The lowest pair takes the lead, and every pair goes on racing on one course.
    await expect
      .poll(async () => (await snapshot(page)).filter((f) => f.hook?.leader).map((f) => f.id), {
        timeout: 30_000,
      })
      .toEqual(["a-pair1"]);
    const before = await snapshot(page);
    await page.waitForTimeout(6000);
    const after = (await snapshot(page)).filter((f) => f.hook);
    expect(after).toHaveLength(3);
    for (const f of after) {
      const was = before.find((b) => b.id === f.id)!.hook!;
      const now = f.hook!;
      const moved =
        now.k > was.k ||
        now.lanes.some((l, i) => l.d !== was.lanes[i]?.d || l.mode !== was.lanes[i]?.mode);
      expect(moved, `${f.id} still racing`).toBe(true);
    }
    const ks = after.map((f) => f.hook!.k);
    expect(new Set(after.filter((f) => f.hook!.k === ks[0]).map((f) => f.hook!.hash)).size).toBe(1);
    expect(problems).toEqual([]);
  });
});

test.describe("treetop bank lobby", () => {
  test.use({ hasTouch: true });
  test.setTimeout(300_000);

  test("treetop: only the lanes that joined race, and a late joiner practises first", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(
      "sim/?preset=bank&count=3&span=1&app=treetop&transport=local&bots=0&seed=test&o.race=30",
    );
    await settle(page);
    const tapFrame = async (id: string) => {
      const f = (await snapshot(page)).find((s) => s.id === id);
      if (f?.box) await page.touchscreen.tap(f.box.x + f.box.width / 2, f.box.y + f.box.height / 2);
    };
    const hooks = async () =>
      Object.fromEntries((await snapshot(page)).map((f) => [f.id, f.hook] as const));
    // People keep tapping their lanes, so their gliders fly and they stay in.
    const tapping = new Set<string>();
    let stop = false;
    const tapper = (async () => {
      while (!stop) {
        for (const id of tapping) await tapFrame(id).catch(() => {});
        await page.waitForTimeout(300);
      }
    })();
    try {
      await tapFrame("a-p1");
      await tapFrame("a-p3");
      await expect
        .poll(async () => (await hooks())["a-screen"]?.heat, { timeout: 15_000 })
        .toBe("lobby");
      tapping.add("a-p1");
      tapping.add("a-p3");
      await expect
        .poll(async () => (await hooks())["a-screen"]?.heat, { timeout: 30_000 })
        .toBe("racing");
      let h = await hooks();
      expect(h["a-screen"]!.racers).toEqual([0, 8]);
      // The idle lane in the middle flies nothing.
      expect(h["a-p2"]!.lanes[0]).toMatchObject({ shown: false, mode: "waiting" });
      const first = h["a-screen"]!.k;
      await tapFrame("a-p2");
      tapping.add("a-p2");
      await expect
        .poll(async () => (await hooks())["a-p2"]?.lanes[0]?.practice, { timeout: 10_000 })
        .toBe(true);
      h = await hooks();
      expect(h["a-screen"]!.lanes.map((l) => l.id)).not.toContain(4);
      // The 30 s race ends, and the next one has all three.
      await expect
        .poll(async () => (await hooks())["a-screen"]?.heat, { timeout: 60_000 })
        .toBe("lobby");
      expect((await hooks())["a-screen"]!.racers).toEqual([0, 4, 8]);
      await expect
        .poll(
          async () => {
            const s = (await hooks())["a-screen"];
            return s?.heat === "racing" && s.k !== first;
          },
          { timeout: 30_000 },
        )
        .toBe(true);
      expect((await hooks())["a-screen"]!.racers).toEqual([0, 4, 8]);
      await expect
        .poll(async () => (await hooks())["a-p2"]?.lanes[0]?.racer, { timeout: 5000 })
        .toBe(true);
    } finally {
      stop = true;
      await tapper;
    }
    expect(problems).toEqual([]);
  });
});

test.describe("treetop touch", () => {
  test.use({ hasTouch: true });
  test.setTimeout(150_000);

  const waitRacing = (page: Page) =>
    page.waitForFunction(
      () => {
        const raw = document.querySelector("[data-treetop]")?.getAttribute("data-treetop");
        return raw ? JSON.parse(raw).phase === "racing" : false;
      },
      undefined,
      { timeout: 90_000, polling: 200 },
    );

  test("treetop: a touch takes the lane and taps fly it", async ({ page }) => {
    const problems = watchPage(page);
    await page.setViewportSize({ width: 432, height: 768 });
    await page.goto("play/?app=treetop&kind=panel&fit=1080x1920&bots=0&seed=test");
    await waitRacing(page);
    expect((await hookOf(page))!.lanes[0]).toMatchObject({ ctrl: "attract", state: "idle" });
    await page.touchscreen.tap(216, 384);
    await expect.poll(async () => (await hookOf(page))!.lanes[0]?.ctrl).toBe("human");
    const lane = (await hookOf(page))!.lanes[0]!;
    expect(lane.state).toBe("playing");
    expect(lane.mode).toBe("flying");
    for (let i = 0; i < 8; i++) {
      await page.touchscreen.tap(216, 600);
      await page.waitForTimeout(150);
    }
    const later = (await hookOf(page))!.lanes[0]!;
    expect(later.ctrl).toBe("human");
    expect(later.d).toBeGreaterThan(lane.d);
    expect(problems).toEqual([]);
  });

  test("treetop: taps beside a pair's seam don't take a lane", async ({ page }) => {
    await page.setViewportSize({ width: 864, height: 768 });
    await page.goto("play/?app=treetop&kind=pair&fit=2160x1920&bots=0&seed=test");
    await waitRacing(page);
    // 0.4 stage px per venue px: 100 venue px either side of the seam at 1080.
    for (const x of [392, 472]) await page.touchscreen.tap(x, 384);
    await page.waitForTimeout(500);
    expect((await hookOf(page))!.lanes.map((l) => l.ctrl)).toEqual(["attract", "attract"]);
    await page.touchscreen.tap(780, 384);
    await expect
      .poll(async () => (await hookOf(page))!.lanes.map((l) => l.ctrl))
      .toEqual(["attract", "human"]);
  });
});

/** What a wall reports (wall.ts): the wall's race and every lane on it. */
interface WallHook {
  k: number;
  phase: string;
  play: string;
  heat: string | null;
  racers: number[];
  leading: boolean;
  hashes: number[];
  columns: number;
  places: [number, number][] | null;
  lanes: {
    id: number;
    column: number;
    pad: string | null;
    ctrl: string;
    state: string;
    joined: boolean;
    racer: boolean;
    practice: boolean;
    shown: boolean;
    mode: string;
    d: number;
    place: number | null;
    /** Stage px of the middle of the lane's touch area. */
    at: [number, number];
  }[];
}

test.describe("treetop on a wall", () => {
  test.use({ hasTouch: true });
  test.setTimeout(240_000);

  /** A quarter of the wall's venue size, so stage px are venue px / 4. */
  const VIEW = { width: 1440, height: 540 };
  const WALL = "play/?app=treetop&kind=wall&fit=5760x2160&res=0.5&seed=test";

  const wallHook = async (page: Page) => (await hookOf(page)) as unknown as WallHook | null;

  /** Wait for the wall's race to have a heat, with its lanes reporting. */
  const ready = async (page: Page) => {
    await expect
      .poll(async () => (await wallHook(page))?.heat ?? null, { timeout: 60_000 })
      .not.toBeNull();
    return (await wallHook(page))!;
  };

  const tapLane = async (page: Page, h: WallHook, id: number, dy = 0) => {
    const lane = h.lanes.find((l) => l.id === id)!;
    await page.touchscreen.tap(lane.at[0], lane.at[1] + dy);
  };

  test("treetop wall: people take lanes by touch, race in a lobby and get placed", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await page.setViewportSize(VIEW);
    await page.goto(`${WALL}&bots=0&o.race=30`);
    const h0 = await ready(page);
    expect(h0.columns).toBe(6);
    expect(h0.lanes.map((l) => l.id)).toEqual([0, 4, 8, 12, 16, 20]);
    // Nobody yet: a faded bot flies every lane, on one course.
    await expect
      .poll(async () => (await wallHook(page))!.lanes.every((l) => l.mode !== "waiting"), {
        timeout: 60_000,
      })
      .toBe(true);
    let h = (await wallHook(page))!;
    expect(h.play).toBe("attract");
    expect(h.lanes.every((l) => l.ctrl === "attract" && l.shown && l.state === "idle")).toBe(true);
    expect(h.hashes).toHaveLength(1);

    // People keep tapping their lanes, low down where a child reaches, so they stay in.
    const tapping = new Set<number>();
    let stop = false;
    const tapper = (async () => {
      while (!stop) {
        for (const id of tapping) await tapLane(page, h0, id, 80).catch(() => {});
        await page.waitForTimeout(300);
      }
    })();
    try {
      await tapLane(page, h0, 4);
      await tapLane(page, h0, 16);
      await expect
        .poll(async () => (await wallHook(page))?.heat, { timeout: 15_000 })
        .toBe("lobby");
      h = (await wallHook(page))!;
      expect(h.lanes.filter((l) => l.joined).map((l) => l.id)).toEqual([4, 16]);
      // The bots have left every lane.
      expect(h.lanes.filter((l) => l.shown).map((l) => l.id)).toEqual([4, 16]);
      tapping.add(4);
      tapping.add(16);
      await expect
        .poll(async () => (await wallHook(page))?.heat, { timeout: 30_000 })
        .toBe("racing");
      h = (await wallHook(page))!;
      expect(h.racers).toEqual([4, 16]);
      const first = h.k;
      // A lane nobody took flies nothing.
      expect(h.lanes.find((l) => l.id === 8)).toMatchObject({ shown: false, mode: "waiting" });
      // Someone arriving mid-race practises at once.
      await tapLane(page, h0, 8);
      tapping.add(8);
      await expect
        .poll(async () => (await wallHook(page))?.lanes.find((l) => l.id === 8)?.practice, {
          timeout: 10_000,
        })
        .toBe(true);
      expect((await wallHook(page))!.racers).toEqual([4, 16]);
      // The race ends; only its racers are placed, and the next one has all three.
      await expect
        .poll(async () => (await wallHook(page))?.heat, { timeout: 60_000 })
        .toBe("lobby");
      h = (await wallHook(page))!;
      expect((h.places ?? []).map(([id]) => id).sort((a, b) => a - b)).toEqual([4, 16]);
      await expect
        .poll(
          async () => {
            const w = await wallHook(page);
            return w?.heat === "racing" && w.k !== first ? w.racers : null;
          },
          { timeout: 40_000 },
        )
        .toEqual([4, 8, 16]);
      await expect
        .poll(async () => (await wallHook(page))?.lanes.find((l) => l.id === 8)?.racer, {
          timeout: 5000,
        })
        .toBe(true);
    } finally {
      stop = true;
      await tapper;
    }
    expect(problems).toEqual([]);
  });

  test("treetop wall: test bots race alone, and an idle wall hands people's lanes back", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await page.setViewportSize(VIEW);
    await page.goto(`${WALL}&bots=2&idle=6`);
    const h0 = await ready(page);
    // Two bots, spread along the wall, join and race; nobody else does.
    await expect.poll(async () => (await wallHook(page))?.heat, { timeout: 30_000 }).toBe("racing");
    let h = (await wallHook(page))!;
    expect(h.racers).toEqual([4, 16]);
    expect(h.lanes.filter((l) => l.ctrl === "bot").map((l) => l.state)).toEqual([
      "playing",
      "playing",
    ]);
    // A person takes the first lane, then walks away: the idle reset gives it back.
    await tapLane(page, h0, 0);
    await expect
      .poll(async () => (await wallHook(page))?.lanes[0]?.ctrl, { timeout: 5000 })
      .toBe("human");
    await expect
      .poll(async () => (await wallHook(page))?.lanes[0]?.state, { timeout: 20_000 })
      .toBe("idle");
    h = (await wallHook(page))!;
    expect(h.lanes[0]!.joined).toBe(false);
    expect(h.lanes.filter((l) => l.ctrl === "bot")).toHaveLength(2);
    expect(problems).toEqual([]);
  });

  test("treetop wall: in pads a child lane sits under an adult lane, and both race", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await page.setViewportSize(VIEW);
    await page.goto(`${WALL}&bots=0&variant=pads`);
    const h0 = await ready(page);
    expect(h0.lanes).toHaveLength(12);
    const child = h0.lanes.find((l) => l.column === 2 && l.pad === "child")!;
    const adult = h0.lanes.find((l) => l.column === 2 && l.pad === "adult")!;
    expect(child.at[1]).toBeGreaterThan(adult.at[1]);
    // The child lane is within a child's reach, near the floor.
    expect(child.at[1]).toBeGreaterThan(VIEW.height * 0.8);
    await tapLane(page, h0, child.id);
    await tapLane(page, h0, adult.id);
    await expect.poll(async () => (await wallHook(page))?.heat, { timeout: 15_000 }).toBe("lobby");
    let stop = false;
    const tapper = (async () => {
      while (!stop) {
        await tapLane(page, h0, child.id).catch(() => {});
        await tapLane(page, h0, adult.id).catch(() => {});
        await page.waitForTimeout(300);
      }
    })();
    try {
      await expect
        .poll(async () => (await wallHook(page))?.heat, { timeout: 30_000 })
        .toBe("racing");
      expect((await wallHook(page))!.racers).toEqual([child.id, adult.id]);
    } finally {
      stop = true;
      await tapper;
    }
    expect(problems).toEqual([]);
  });

  test("treetop wall: runs in the simulator's wall preset", async ({ page }) => {
    const problems = watchPage(page);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto("sim/?preset=wall&app=treetop&transport=local&bots=2&seed=test");
    await expect
      .poll(
        async () => {
          const frames = await snapshot(page);
          const hook = frames[0]?.hook as unknown as WallHook | undefined;
          return frames.length === 1 && frames[0]!.kind === "wall" ? (hook?.heat ?? null) : null;
        },
        { timeout: 90_000, intervals: [1000] },
      )
      .toBe("racing");
    const hook = (await snapshot(page))[0]!.hook as unknown as WallHook;
    expect(hook.columns).toBe(6);
    expect(hook.racers).toHaveLength(2);
    expect(problems).toEqual([]);
  });
});
