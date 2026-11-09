import { expect, type Page, test } from "@playwright/test";
import { watchPage } from "../scripts/lib/play.mjs";

/**
 * Pinball across frames in the simulator, with the local transport: a deck shot climbing from a
 * table onto the screen with extra delay and coming back down into a playing table, deck shots
 * from both halves of a pair, and tables turning their deck lane back into the orbit when the
 * screen goes. Also a person's first touches on a solo panel, and picking up a ball there.
 * Timings are generous because the sim runs every frame in one process. Then the wall: several
 * people on its tables at once, deck shots up into its band and back down, the grab and the idle
 * reset.
 */

const SETTLE_MS = 90_000;

interface TableState {
  h: number;
  ctrl: string;
  mode: string;
  station: string;
  waiting: boolean;
  inPlay: number;
  exitU: number;
  balls: { id: number; x: number; y: number; vx: number; vy: number; held: boolean }[];
  flippers: { name: string; held: boolean }[];
  active: string[];
}

interface PbTable {
  kind: "table";
  deck: boolean;
  giftCount: number;
  modeAt: number;
  ups: { id: number; h: number; t: number; sent: boolean }[];
  downs: { id: number; h: number; t: number; ok: boolean }[];
  tables: TableState[];
}

interface PbScreen {
  kind: "screen";
  W: number;
  stats: Record<string, number>;
  giftLog: { to: string; h: number; kind: string; t: number }[];
  arrivals: { from: string; ref: number; late: number; x: number }[];
  sent: { to: string; h: number; id: number; from: string; ref: number }[];
  slots: { frame: string | null; pos: number; h: number; chuteX: number; playing: boolean }[];
}

declare global {
  interface Window {
    __pinball?: {
      state(): PbTable | PbScreen;
      setLag(ms: number): void;
      shoot(h?: number): boolean;
      gift?(slot: number, kind: number): boolean;
      burst?(n: number): void;
    };
  }
}

const openSim = async (page: Page, preset: string, extra = "") => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(
    `sim/?preset=${preset}&app=pinball&transport=local&seed=e2e&debug=1&res=0.25${extra}`,
  );
  await page.waitForFunction(() => window.__hypercubeSim !== undefined);
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const frames = [...document.querySelectorAll<HTMLElement>(".sim-frame[data-frame]")];
          const states = frames.map((el) => el.querySelector("iframe")?.contentWindow?.__hypercube);
          const hubs = states.filter((s) => s?.net?.isHub);
          return (
            states.every((s) => s?.phase === "running" && s.room === "online") &&
            hubs.length === 1 &&
            hubs[0]?.net?.roster().length === frames.length
          );
        }),
      { timeout: SETTLE_MS, intervals: [500] },
    )
    .toBe(true);
};

const inFrame = <T, A>(page: Page, id: string, fn: (arg: A) => T, arg?: A): Promise<T> =>
  page.evaluate(
    ([frameId, src, a]) => {
      const w = document.querySelector<HTMLIFrameElement>(
        `.sim-frame[data-frame="${frameId}"] iframe`,
      )?.contentWindow as (Window & typeof globalThis) | null;
      if (!w) throw new Error(`no frame ${frameId}`);
      return new w.Function("arg", `return (${src})(arg)`)(a) as T;
    },
    [id, fn.toString(), arg] as const,
  );

const table = (page: Page, id: string) =>
  inFrame(page, id, () => window.__pinball!.state()) as Promise<PbTable>;
const screen = (page: Page, id = "a-screen") =>
  inFrame(page, id, () => window.__pinball!.state()) as Promise<PbScreen>;

/** Shoot a ball up a table's deck lane and return the id it left with. */
const deckShot = async (page: Page, id: string, h = 0): Promise<number> => {
  const before = (await table(page, id)).ups.length;
  await inFrame(page, id, (k: number) => window.__pinball!.shoot(k), h);
  let shot: PbTable["ups"][number] | undefined;
  await expect
    .poll(async () => {
      shot = (await table(page, id)).ups.slice(before).find((u) => u.sent && u.h === h);
      return shot !== undefined;
    })
    .toBe(true);
  return shot!.id;
};

test.describe("pinball in the simulator", () => {
  test.describe.configure({ timeout: 240_000 });

  test("a deck shot climbs onto the screen with 300 ms of extra delay and comes back down", async ({
    page,
  }) => {
    const problems = watchPage(page);
    // Bots on every table, so every table counts as playing.
    await openSim(page, "bank-panels", "&bots=6");
    const panels = Array.from({ length: 6 }, (_, i) => `a-p${i + 1}`);
    for (const id of panels)
      await inFrame(page, id, (ms: number) => window.__pinball!.setLag(ms), 300);
    await expect.poll(async () => (await table(page, "a-p4")).deck, { timeout: 20_000 }).toBe(true);

    const id = await deckShot(page, "a-p4");
    let arrival: PbScreen["arrivals"][number] | undefined;
    let slot: PbScreen["slots"][number] | undefined;
    await expect
      .poll(async () => {
        const s = await screen(page);
        arrival = s.arrivals.find((a) => a.from === "a-p4" && a.ref === id);
        slot = s.slots.find((x) => x.frame === "a-p4");
        return arrival !== undefined;
      })
      .toBe(true);
    test.info().annotations.push({
      type: "arrival",
      description: `${arrival!.late.toFixed(0)} ms against the end of the climb (negative is early)`,
    });
    // The screen holds the ball before it leaves the table, so it starts at the bottom edge.
    expect.soft(arrival!.late, "arrived before the climb ended").toBeLessThan(0);
    expect(Math.abs(arrival!.x - slot!.chuteX), "comes up the table's own chute").toBeLessThan(1);

    // It falls into a hole sooner or later (guided after 20 s) and goes down to a playing table.
    let sent: PbScreen["sent"][number] | undefined;
    await expect
      .poll(
        async () => {
          sent = (await screen(page)).sent.find((x) => x.from === "a-p4" && x.ref === id);
          return sent !== undefined;
        },
        { timeout: 45_000 },
      )
      .toBe(true);
    await expect
      .poll(async () => (await table(page, sent!.to)).downs.some((d) => d.id === sent!.id), {
        timeout: 15_000,
      })
      .toBe(true);
    expect.soft(problems).toEqual([]);
  });

  test("deck shots from both halves of a pair come up their own chutes", async ({ page }) => {
    const problems = watchPage(page);
    await openSim(page, "bank-pairs");
    await expect
      .poll(async () => (await table(page, "a-pair2")).deck, { timeout: 20_000 })
      .toBe(true);
    const tables = (await table(page, "a-pair2")).tables;
    expect(tables).toHaveLength(2);
    // The left table is mirrored so its plunger, and its deck lane, are at the outer edge.
    expect(tables[0]!.exitU).toBeGreaterThan(0.5);
    expect(tables[1]!.exitU).toBeLessThan(0.5);
    for (const h of [0, 1]) {
      const id = await deckShot(page, "a-pair2", h);
      await expect
        .poll(async () => {
          const s = await screen(page);
          const a = s.arrivals.find((x) => x.from === "a-pair2" && x.ref === id);
          const slot = s.slots.find((x) => x.frame === "a-pair2" && x.h === h);
          return a && slot ? Math.abs(a.x - slot.chuteX) : -1;
        })
        .toBeGreaterThanOrEqual(0);
      const s = await screen(page);
      const a = s.arrivals.find((x) => x.from === "a-pair2" && x.ref === id)!;
      const slot = s.slots.find((x) => x.frame === "a-pair2" && x.h === h)!;
      expect(Math.abs(a.x - slot.chuteX)).toBeLessThan(1);
      expect(slot.pos).toBe(1);
    }
    expect.soft(problems).toEqual([]);
  });

  test("deck balls work the deck's devices, and a gift from the deck reaches its table", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openSim(page, "bank-panels", "&bots=6");
    const panels = Array.from({ length: 6 }, (_, i) => `a-p${i + 1}`);
    await expect.poll(async () => (await table(page, "a-p5")).deck, { timeout: 20_000 }).toBe(true);
    // A busy bank: every table shoots the deck now and then, as well as its bot's own shots.
    const kinds = ["saucer", "magnet", "lock", "orbit", "vuk", "nest", "loop", "captive", "bubble"];
    const visited = async () => {
      const st = (await screen(page)).stats;
      return kinds.filter((k) => (st[k] ?? 0) > 0);
    };
    const until = Date.now() + 120_000;
    while (Date.now() < until && (await visited()).length < 4) {
      for (const id of panels.slice(0, 5)) {
        await inFrame(page, id, () => window.__pinball!.shoot(0));
      }
      await page.waitForTimeout(2500);
    }
    const seen = await visited();
    test.info().annotations.push({
      type: "devices",
      description: JSON.stringify((await screen(page)).stats),
    });
    expect(seen.length, `devices visited: ${seen.join(", ")}`).toBeGreaterThanOrEqual(4);
    // A gift for the fourth table, sent the way a popped bubble sends it.
    const before = (await table(page, "a-p4")).giftCount;
    expect(await inFrame(page, "a-screen", () => window.__pinball!.gift!(3, 2))).toBe(true);
    await expect
      .poll(async () => (await table(page, "a-p4")).giftCount, { timeout: 10_000 })
      .toBeGreaterThan(before);
    // It comes down the return tube and the table scores double for a while.
    await expect
      .poll(async () => (await table(page, "a-p4")).tables[0]!.active, { timeout: 10_000 })
      .toContain("double");
    const natural = (await screen(page)).giftLog.length;
    test.info().annotations.push({ type: "gifts", description: `${natural} sent in all` });
    expect.soft(problems).toEqual([]);
  });

  test("tables turn the deck lane back into the orbit when the screen goes", async ({ page }) => {
    await openSim(page, "bank-pairs");
    const pairs = Array.from({ length: 3 }, (_, i) => `a-pair${i + 1}`);
    for (const id of pairs) {
      await expect.poll(async () => (await table(page, id)).deck, { timeout: 20_000 }).toBe(true);
    }
    const removed = await page.evaluate(() => {
      const t = Date.now();
      document.querySelector('.sim-frame[data-frame="a-screen"] iframe')?.remove();
      return t;
    });
    for (const id of pairs) {
      await expect.poll(async () => (await table(page, id)).deck, { timeout: 15_000 }).toBe(false);
    }
    const took = await Promise.all(
      pairs.map(async (id) => (await table(page, id)).modeAt - removed),
    );
    test.info().annotations.push({ type: "fallback", description: `${took.join(", ")} ms` });
    for (const ms of took) expect(ms).toBeLessThan(3000);
    // And a deck shot now goes round the orbit and stays on the table.
    const before = (await table(page, "a-pair3")).tables[1]!;
    await inFrame(page, "a-pair3", () => window.__pinball!.shoot(1));
    await expect
      .poll(async () => {
        const t = (await table(page, "a-pair3")).tables[1]!;
        return t.inPlay >= before.inPlay;
      })
      .toBe(true);
    expect((await table(page, "a-pair3")).ups.filter((u) => u.sent && u.t > removed)).toHaveLength(
      0,
    );
  });
});

test.describe("pinball on a panel", () => {
  const PANEL = "play/?app=pinball&kind=panel&fit=1080x1920&bots=0&seed=e2e&debug=1";
  const state = (page: Page) =>
    page.evaluate(() => (window.__pinball!.state() as PbTable).tables[0]!);
  /** A touch event at (x, y) table px, dispatched where a finger there would land. */
  const touchAt = (page: Page, type: string, x: number, y: number, id: number) =>
    page.evaluate(
      ([type, x, y, id]) => {
        const stage = document.querySelector<HTMLElement>(".hc-stage")!;
        const r = stage.getBoundingClientRect();
        const s = r.width / 1080;
        const cx = r.left + x * s;
        const cy = r.top + y * s;
        (document.elementFromPoint(cx, cy) ?? stage).dispatchEvent(
          new PointerEvent(type, {
            clientX: cx,
            clientY: cy,
            pointerId: id,
            pointerType: "touch",
            bubbles: true,
            isPrimary: true,
          }),
        );
      },
      [type, x, y, id] as const,
    );
  /** Take the table with a first touch and launch the ball. */
  const startGame = async (page: Page) => {
    await page.waitForFunction(() => window.__pinball !== undefined);
    expect((await state(page)).ctrl).toBe("attract");
    await touchAt(page, "pointerdown", 300, 1500, 11);
    await touchAt(page, "pointerup", 300, 1500, 11);
    await expect.poll(async () => (await state(page)).ctrl).toBe("human");
    expect((await state(page)).station).toBe("playing");
    expect((await state(page)).waiting).toBe(true);
    // Hold the plunger, let go: the ball leaves the lane.
    await touchAt(page, "pointerdown", 980, 1800, 12);
    await page.waitForTimeout(500);
    await touchAt(page, "pointerup", 980, 1800, 12);
    await expect.poll(async () => (await state(page)).waiting).toBe(false);
  };

  test("the first touch takes the table, then the plunger and flippers answer", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await page.setViewportSize({ width: 540, height: 960 });
    // With the grab off, so a passing ball can't take a touch meant for a pad.
    await page.goto(`${PANEL}&o.grab=0`);
    await startGame(page);
    // Each pad works its flipper while held.
    await touchAt(page, "pointerdown", 200, 1500, 13);
    await touchAt(page, "pointerdown", 1000, 600, 14);
    await expect
      .poll(async () => (await state(page)).flippers.filter((f) => f.held).map((f) => f.name))
      .toEqual(["left", "upRight"]);
    await touchAt(page, "pointerup", 200, 1500, 13);
    await touchAt(page, "pointerup", 1000, 600, 14);
    await expect.poll(async () => (await state(page)).flippers.some((f) => f.held)).toBe(false);
    expect(problems).toEqual([]);
  });

  test("a touch on a ball picks it up, drags it and throws it", async ({ page }) => {
    const problems = watchPage(page);
    await page.setViewportSize({ width: 540, height: 960 });
    // The grab is off unless the operator turns it on.
    await page.goto(`${PANEL}&o.grab=1`);
    await startGame(page);
    // Touch the ball where it is, in the same task as reading it, so it can't have moved on.
    const FINGER = 21;
    await expect
      .poll(
        () =>
          page.evaluate((id) => {
            const t = (window.__pinball!.state() as PbTable).tables[0]!;
            const b = t.balls.find((x) => x.x > 100 && x.x < 900 && x.y > 650 && x.y < 1600);
            if (!b) return "no ball in the open";
            const stage = document.querySelector<HTMLElement>(".hc-stage")!;
            const r = stage.getBoundingClientRect();
            const s = r.width / 1080;
            const fire = (type: string) =>
              (document.elementFromPoint(r.left + b.x * s, r.top + b.y * s) ?? stage).dispatchEvent(
                new PointerEvent(type, {
                  clientX: r.left + b.x * s,
                  clientY: r.top + b.y * s,
                  pointerId: id,
                  pointerType: "touch",
                  bubbles: true,
                  isPrimary: true,
                }),
              );
            fire("pointerdown");
            const after = (window.__pinball!.state() as PbTable).tables[0]!;
            if (!after.balls.some((x) => x.held)) {
              fire("pointerup");
              return "not picked up";
            }
            return after.flippers.some((f) => f.held) ? "flipped" : "held";
          }, FINGER),
        { timeout: 20_000, intervals: [50] },
      )
      .toBe("held");
    // Drag it to the middle of the table, clear of everything: it follows and stays held.
    const to = { x: 540, y: 1100 };
    const from = (await state(page)).balls.find((b) => b.held)!;
    for (let i = 1; i <= 8; i++) {
      const k = i / 8;
      await touchAt(
        page,
        "pointermove",
        from.x + (to.x - from.x) * k,
        from.y + (to.y - from.y) * k,
        FINGER,
      );
      await page.waitForTimeout(30);
    }
    await expect
      .poll(async () => {
        const b = (await state(page)).balls.find((x) => x.held);
        return b ? Math.hypot(b.x - to.x, b.y - to.y) : Infinity;
      })
      .toBeLessThan(30);
    // Flick it upwards and let go, below the bumpers: it flies on upwards on its own.
    for (let i = 1; i <= 5; i++) {
      await touchAt(page, "pointermove", to.x, to.y - i * 60, FINGER);
      await page.waitForTimeout(20);
    }
    const thrown = await page.evaluate(
      ([id, x, y]) => {
        const stage = document.querySelector<HTMLElement>(".hc-stage")!;
        const r = stage.getBoundingClientRect();
        const s = r.width / 1080;
        stage.dispatchEvent(
          new PointerEvent("pointerup", {
            clientX: r.left + x * s,
            clientY: r.top + y * s,
            pointerId: id,
            pointerType: "touch",
            bubbles: true,
            isPrimary: true,
          }),
        );
        return (window.__pinball!.state() as PbTable).tables[0]!.balls;
      },
      [FINGER, to.x, to.y - 340] as const,
    );
    expect(thrown.some((b) => b.held)).toBe(false);
    const ball = thrown.find((b) => b.id === from.id);
    expect(ball, "the thrown ball").toBeDefined();
    expect(ball!.vy).toBeLessThan(-100);
    expect(problems).toEqual([]);
  });
});

interface WallState {
  kind: "wall";
  deck: boolean;
  ups: { id: number; h: number; t: number; sent: boolean }[];
  downs: { id: number; h: number; t: number; ok: boolean }[];
  giftCount: number;
  tables: (TableState & {
    stats: { orbit: number; deck: number };
    place: { x: number; y: number; k: number };
    pads: Record<"left" | "right" | "upLeft" | "upRight" | "plunger", Box>;
  })[];
  band: {
    resets: number;
    W: number;
    H: number;
    f: number;
    launchY: number;
    total: number;
    stats: Record<string, number>;
    arrivals: { from: string; ref: number; late: number; x: number }[];
    sent: { to: string; h: number; id: number; ref: number }[];
    balls: { ref: number; phase: string; y: number }[];
    slots: { h: number; chuteX: number; holeX: number; playing: boolean }[];
  };
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

test.describe("pinball on a wall", () => {
  test.describe.configure({ timeout: 120_000 });
  const WALL = "play/?app=pinball&kind=wall&fit=5760x2160&res=0.5&seed=e2e&debug=1";
  const wall = (page: Page) =>
    page.evaluate(() => window.__pinball!.state() as unknown as WallState);
  /** A touch event at (x, y) venue px of the wall, dispatched where a finger there would land. */
  const touchAt = (page: Page, type: string, x: number, y: number, id: number) =>
    page.evaluate(
      ([type, x, y, id]) => {
        const stage = document.querySelector<HTMLElement>(".hc-stage")!;
        const r = stage.getBoundingClientRect();
        const s = r.width / 5760;
        const cx = r.left + x * s;
        const cy = r.top + y * s;
        (document.elementFromPoint(cx, cy) ?? stage).dispatchEvent(
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
      [type, x, y, id] as const,
    );
  /** Where a pad's centre is on the wall, venue px. */
  const padAt = (t: WallState["tables"][number], c: keyof WallState["tables"][number]["pads"]) => {
    const b = t.pads[c];
    return {
      x: t.place.x + (b.x + b.w / 2) * t.place.k,
      y: t.place.y + (b.y + b.h / 2) * t.place.k,
    };
  };
  const open = async (page: Page, query: string) => {
    await page.setViewportSize({ width: 1296, height: 486 });
    await page.goto(`${WALL}${query}`);
    await page.waitForFunction(() => window.__pinball !== undefined);
  };

  test("several people take different tables at once, and the pads answer", async ({ page }) => {
    const problems = watchPage(page);
    // With the grab off, so a passing ball can't take a touch meant for a pad.
    await open(page, "&bots=0&o.grab=0");
    const s0 = await wall(page);
    expect(s0.kind).toBe("wall");
    expect(s0.tables).toHaveLength(5);
    expect(s0.tables.every((t) => t.ctrl === "attract")).toBe(true);
    // Every pad sits inside its own table, and below the top of adult reach.
    for (const t of s0.tables) {
      for (const c of ["left", "right", "upLeft", "upRight", "plunger"] as const) {
        const b = t.pads[c];
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.w).toBeLessThanOrEqual(1080);
        expect(Math.min(b.w, b.h) * t.place.k).toBeGreaterThanOrEqual(150);
        // The default wall's adult reach: (2.2 - 0.2) / 4.5 of its 2160 px.
        expect(2160 - (t.place.y + b.y * t.place.k)).toBeLessThanOrEqual(960 + 1);
      }
    }
    // Three people, one touch each, on tables 0, 2 and 4.
    for (const [h, id] of [
      [0, 31],
      [2, 32],
      [4, 33],
    ] as const) {
      const at = padAt(s0.tables[h]!, "left");
      await touchAt(page, "pointerdown", at.x, at.y, id);
      await touchAt(page, "pointerup", at.x, at.y, id);
    }
    await expect
      .poll(async () => (await wall(page)).tables.map((t) => t.ctrl))
      .toEqual(["human", "attract", "human", "attract", "human"]);
    // Each pulls its own plunger.
    const plungers = [0, 2, 4].map((h) => padAt(s0.tables[h]!, "plunger"));
    for (const [i, at] of plungers.entries())
      await touchAt(page, "pointerdown", at.x, at.y, 40 + i);
    await page.waitForTimeout(500);
    for (const [i, at] of plungers.entries()) await touchAt(page, "pointerup", at.x, at.y, 40 + i);
    await expect
      .poll(async () => (await wall(page)).tables.filter((t) => t.ctrl === "human" && !t.waiting))
      .toHaveLength(3);
    // Two at once, on different tables: a child's main flipper and an adult's upper one.
    const low = padAt(s0.tables[0]!, "left");
    const high = padAt(s0.tables[4]!, "upRight");
    await touchAt(page, "pointerdown", low.x, low.y, 51);
    await touchAt(page, "pointerdown", high.x, high.y, 52);
    await expect
      .poll(async () => {
        const t = (await wall(page)).tables;
        return [t[0]!, t[4]!].map((x) => x.flippers.filter((f) => f.held).map((f) => f.name));
      })
      .toEqual([["left"], ["upRight"]]);
    await touchAt(page, "pointerup", low.x, low.y, 51);
    await touchAt(page, "pointerup", high.x, high.y, 52);
    await expect
      .poll(async () => (await wall(page)).tables.some((t) => t.flippers.some((f) => f.held)))
      .toBe(false);
    expect(problems).toEqual([]);
  });

  test("a deck shot rises into the band and rains back down, and gifts reach their tables", async ({
    page,
  }) => {
    const problems = watchPage(page);
    // Bots on every table, so every table counts as playing.
    await open(page, "&bots=5");
    await expect
      .poll(async () => (await wall(page)).band.slots.every((s) => s.playing), { timeout: 20_000 })
      .toBe(true);
    const before = (await wall(page)).ups.length;
    await page.evaluate(() => window.__pinball!.shoot(1));
    let id = 0;
    await expect
      .poll(async () => {
        const up = (await wall(page)).ups.slice(before).find((u) => u.sent && u.h === 1);
        id = up?.id ?? 0;
        return id;
      })
      .toBeGreaterThan(0);
    // It comes up its own table's chute, and climbs up into the band among the pieces.
    let top = Infinity;
    await expect
      .poll(async () => {
        const b = (await wall(page)).band;
        const a = b.arrivals.find((x) => x.ref === id);
        const ball = b.balls.find((x) => x.ref === id);
        if (ball && ball.phase === "free") top = Math.min(top, ball.y);
        return a ? Math.abs(a.x - b.slots[1]!.chuteX) : -1;
      })
      .toBeGreaterThanOrEqual(0);
    const b0 = (await wall(page)).band;
    expect(Math.abs(b0.arrivals.find((x) => x.ref === id)!.x - b0.slots[1]!.chuteX)).toBeLessThan(
      1,
    );
    await expect
      .poll(
        async () => {
          const b = (await wall(page)).band;
          const ball = b.balls.find((x) => x.ref === id);
          if (ball && ball.phase === "free") top = Math.min(top, ball.y);
          return top;
        },
        { timeout: 10_000, intervals: [100] },
      )
      .toBeLessThan(b0.launchY * 0.75);
    // Sooner or later it falls into a hole and goes down to a table, which takes it.
    let sent: WallState["band"]["sent"][number] | undefined;
    await expect
      .poll(
        async () => {
          sent = (await wall(page)).band.sent.find((x) => x.ref === id);
          return sent !== undefined;
        },
        { timeout: 45_000 },
      )
      .toBe(true);
    await expect
      .poll(
        async () => (await wall(page)).downs.some((d) => d.id === sent!.id && d.h === sent!.h),
        {
          timeout: 15_000,
        },
      )
      .toBe(true);
    // A gift for the fourth table, sent the way a popped bubble sends it, doubles its scoring.
    const gifts = (await wall(page)).giftCount;
    expect(await page.evaluate(() => window.__pinball!.gift!(3, 2))).toBe(true);
    await expect
      .poll(async () => (await wall(page)).tables[3]!.active, { timeout: 10_000 })
      .toContain("double");
    expect((await wall(page)).giftCount).toBeGreaterThan(gifts);
    expect.soft(problems).toEqual([]);
  });

  test("a touch on a ball picks it up there too, when the operator turns the grab on", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await open(page, "&bots=0&o.grab=1");
    const s0 = await wall(page);
    const t = s0.tables[2]!;
    const start = padAt(t, "left");
    await touchAt(page, "pointerdown", start.x, start.y, 61);
    await touchAt(page, "pointerup", start.x, start.y, 61);
    await expect.poll(async () => (await wall(page)).tables[2]!.ctrl).toBe("human");
    const pl = padAt(t, "plunger");
    await touchAt(page, "pointerdown", pl.x, pl.y, 62);
    await page.waitForTimeout(500);
    await touchAt(page, "pointerup", pl.x, pl.y, 62);
    // Touch the ball where it is, in the same task as reading it.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const s = window.__pinball!.state() as unknown as WallState;
            const tb = s.tables[2]!;
            const b = tb.balls.find((x) => x.x > 100 && x.x < 900 && x.y > 650 && x.y < 1600);
            if (!b) return "no ball in the open";
            const stage = document.querySelector<HTMLElement>(".hc-stage")!;
            const r = stage.getBoundingClientRect();
            const s6 = r.width / 5760;
            const cx = r.left + (tb.place.x + b.x * tb.place.k) * s6;
            const cy = r.top + (tb.place.y + b.y * tb.place.k) * s6;
            const fire = (type: string) =>
              (document.elementFromPoint(cx, cy) ?? stage).dispatchEvent(
                new PointerEvent(type, {
                  clientX: cx,
                  clientY: cy,
                  pointerId: 63,
                  pointerType: "touch",
                  bubbles: true,
                  isPrimary: false,
                }),
              );
            fire("pointerdown");
            const held = (window.__pinball!.state() as unknown as WallState).tables[2]!.balls.some(
              (x) => x.held,
            );
            fire("pointerup");
            return held ? "held" : "not picked up";
          }),
        { timeout: 20_000, intervals: [50] },
      )
      .toBe("held");
    expect(problems).toEqual([]);
  });

  test("without the deck the tables are bigger and deck shots go round the orbit", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await open(page, "&bots=5&o.deck=0");
    const s0 = await wall(page);
    expect(s0.deck).toBe(false);
    expect(s0.band).toBeNull();
    expect(s0.tables[0]!.place.k).toBeGreaterThan(1);
    const before = s0.tables[2]!.stats.orbit;
    await page.evaluate(() => window.__pinball!.shoot(2));
    await expect
      .poll(async () => (await wall(page)).tables[2]!.stats.orbit)
      .toBeGreaterThan(before);
    expect((await wall(page)).ups.filter((u) => u.sent)).toHaveLength(0);
    expect(problems).toEqual([]);
  });

  test("goes back to attract once nobody has touched it for the idle time", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "&bots=0&idle=5");
    const s0 = await wall(page);
    const at = padAt(s0.tables[3]!, "right");
    await touchAt(page, "pointerdown", at.x, at.y, 71);
    await touchAt(page, "pointerup", at.x, at.y, 71);
    await expect.poll(async () => (await wall(page)).tables[3]!.ctrl).toBe("human");
    const resets = (await wall(page)).band.resets;
    // The runtime resets the app after 5 s without a touch: the person's table goes back to
    // attract and the band starts its total again.
    await expect
      .poll(
        async () => {
          const s = await wall(page);
          return { ctrl: s.tables[3]!.ctrl, reset: s.band.resets > resets };
        },
        { timeout: 20_000 },
      )
      .toEqual({ ctrl: "attract", reset: true });
    // The tables play on by themselves, shooting the band now and then.
    await expect
      .poll(async () =>
        (await wall(page)).tables.every((t) => t.ctrl === "attract" && t.inPlay > 0),
      )
      .toBe(true);
    expect(problems).toEqual([]);
  });
});
