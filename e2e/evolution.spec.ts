import { expect, type Frame, type Page, test } from "@playwright/test";
import { watchPage } from "../scripts/lib/play.mjs";

/**
 * Evolution on single frames (a tap catches a fish and a hatchling replaces it; tiles and the
 * switch; idle keeps the fish but sends floors home, admin's reset starts fresh; bots and herons
 * on a wall) and in a four-panel sim bank (the screen's tree holds every panel's fish over its
 * panel, a migrant crosses between panels with its lineage, panels draw their own tree when the
 * screen goes, a lone screen runs ponds of its own).
 */

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface FishState {
  id: number;
  parent: number;
  x: number;
  y: number;
  state: string;
  standout: number;
}
interface PondState {
  island: number;
  floor: string;
  mutation: string;
  sweep: boolean;
  target: number;
  box: Box;
  tiles: { floor: string; box: Box }[];
  small: Box;
  big: Box;
  standout: number;
  counts: { caught: number; byHeron: number; born: number; left: number; arrived: number };
  fish: FishState[];
}
interface FrameState {
  screen: false;
  mode: "tree" | "comb" | "none";
  modeAt: number;
  unit: number;
  nodes: number;
  leaves: number;
  sent: number;
  migrants: { out: number; in: number };
  counts: { caught: number; people: number; floors: number; migrants: number };
  ponds: PondState[];
}
interface ScreenState {
  screen: true;
  demo: boolean;
  frames: number;
  columns: number;
  nodes: number;
  leaves: number;
  islands: { island: number; pos: number; fish: number; floor: string }[];
}

declare global {
  interface Window {
    __evolution?: {
      state(): FrameState | ScreenState;
      reset?(): void;
      migrate?(pond: number, edge: -1 | 1): number | null;
    };
  }
}

const SIZES = { panel: [1080, 1920], pair: [2160, 1920], wall: [5760, 2160] } as const;

const open = async (
  page: Page,
  kind: keyof typeof SIZES,
  params: Record<string, string | number> = {},
) => {
  const [w, h] = SIZES[kind];
  const scale = Math.min(1000 / w, 800 / h);
  await page.setViewportSize({ width: Math.round(w * scale), height: Math.round(h * scale) });
  const q = new URLSearchParams({
    app: "evolution",
    kind,
    fit: `${w}x${h}`,
    bots: "0",
    seed: "e2e",
    debug: "1",
  });
  for (const [k, v] of Object.entries(params)) q.set(k, String(v));
  await page.goto(`play/?${q}`);
  await page.waitForFunction(() => window.__evolution !== undefined, undefined, {
    timeout: 30_000,
  });
};

const state = (page: Page) => page.evaluate(() => window.__evolution!.state() as FrameState);

/** A tap at a venue point, as real pointer events. */
const tap = (page: Page | Frame, at: { x: number; y: number }) =>
  page.evaluate((p) => {
    const st = window.__evolution!.state() as { unit: number };
    const stage = document.querySelector<HTMLElement>(".hc-stage")!;
    const r = stage.getBoundingClientRect();
    const k = st.unit * (r.width / stage.offsetWidth);
    const clientX = r.left + p.x * k;
    const clientY = r.top + p.y * k;
    const pointerId = 5000 + Math.floor(Math.random() * 4000);
    const target = document.elementFromPoint(clientX, clientY) ?? stage;
    const init = {
      clientX,
      clientY,
      pointerId,
      pointerType: "touch",
      bubbles: true,
      isPrimary: true,
    };
    target.dispatchEvent(new PointerEvent("pointerdown", init));
    target.dispatchEvent(new PointerEvent("pointerup", init));
  }, at);

const centre = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

test.describe("evolution", () => {
  test.describe.configure({ timeout: 120_000 });

  test("a tap catches the fish under it, and a hatchling replaces it a second or two later", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await open(page, "panel", { "o.herons": "off" });
    await page.waitForTimeout(1500);
    const before = (await state(page)).ponds[0]!;
    const target = before.fish.find((f) => f.state === "swim")!;
    await tap(page, { x: target.x + 20, y: target.y + 20 });
    const after = (await state(page)).ponds[0]!;
    expect((await state(page)).counts.people).toBe(1);
    expect(after.counts.caught).toBe(1);
    expect(after.fish.some((f) => f.id === target.id)).toBe(false);
    await expect
      .poll(async () => (await state(page)).ponds[0]!.counts.born, { timeout: 5000 })
      .toBe(1);
    const now = (await state(page)).ponds[0]!;
    const young = now.fish.find((f) => !before.fish.some((b) => b.id === f.id))!;
    expect(before.fish.some((b) => b.id === young.parent)).toBe(true);
    expect(young.parent).not.toBe(target.id);
    expect(problems).toEqual([]);
  });

  test("tiles change the pond's floor and the switch changes the young", async ({ page }) => {
    await open(page, "panel", { "o.herons": "off" });
    const p = (await state(page)).ponds[0]!;
    expect(p.floor).toBe("sand");
    const mud = p.tiles.find((t) => t.floor === "mud")!;
    await tap(page, centre(mud.box));
    let s = (await state(page)).ponds[0]!;
    expect(s.floor).toBe("mud");
    expect(s.sweep).toBe(true);
    await expect
      .poll(async () => (await state(page)).ponds[0]!.sweep, { timeout: 10_000 })
      .toBe(false);
    expect(s.mutation).toBe("small");
    await tap(page, centre(p.big));
    s = (await state(page)).ponds[0]!;
    expect(s.mutation).toBe("big");
    await tap(page, centre(p.small));
    expect((await state(page)).ponds[0]!.mutation).toBe("small");
  });

  test("idle keeps the fish and sends floors home; admin's reset starts afresh", async ({
    page,
  }) => {
    await open(page, "pair", { idle: 6, "o.herons": "off" });
    const p = (await state(page)).ponds;
    await tap(page, centre(p[1]!.tiles.find((t) => t.floor === "pebbles")!.box));
    await tap(page, centre(p[1]!.big));
    expect((await state(page)).ponds[1]!.floor).toBe("pebbles");
    const ids = new Set((await state(page)).ponds.flatMap((x) => x.fish.map((f) => f.id)));
    // Idle after 6 s, then the pond's floor goes home after its stagger.
    await expect
      .poll(async () => (await state(page)).ponds[1]!.floor, { timeout: 30_000 })
      .toBe("weed");
    const s = await state(page);
    expect(s.ponds[1]!.mutation).toBe("small");
    const kept = s.ponds.flatMap((x) => x.fish).filter((f) => ids.has(f.id)).length;
    expect(kept).toBeGreaterThan(30);
    await page.evaluate(() => window.__evolution!.reset!());
    await page.waitForTimeout(200);
    const fresh = await state(page);
    expect(fresh.ponds.flatMap((x) => x.fish).filter((f) => ids.has(f.id))).toHaveLength(0);
    expect(fresh.nodes).toBe(44);
  });

  test("on a wall, bots and herons hunt the conspicuous fish and the tree stays bounded", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await open(page, "wall", { bots: 4, "o.herons": "many" });
    const first = await state(page);
    expect(first.ponds).toHaveLength(3);
    const start = first.ponds.map((p) => p.standout);
    await page.waitForTimeout(40_000);
    const s = await state(page);
    expect(s.counts.caught).toBeGreaterThan(15);
    expect(s.ponds.reduce((n, p) => n + p.counts.byHeron, 0)).toBeGreaterThan(10);
    expect(s.nodes).toBeLessThan(2000);
    // Hunting makes the ponds harder to see.
    const end = s.ponds.map((p) => p.standout);
    expect(end.reduce((a, b) => a + b, 0)).toBeLessThan(start.reduce((a, b) => a + b, 0));
    for (const p of s.ponds) expect(p.fish.length).toBeGreaterThanOrEqual(25);
    expect(problems).toEqual([]);
  });
});

// ---- A bank in the simulator ------------------------------------------------------------------

const PANELS = ["a-p1", "a-p2", "a-p3", "a-p4"];

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

const screenState = (page: Page) =>
  inFrame(page, "a-screen", () => window.__evolution!.state()) as Promise<ScreenState>;
const panelState = (page: Page, id: string) =>
  inFrame(page, id, () => window.__evolution!.state()) as Promise<FrameState>;

const openBank = async (page: Page) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(
    "sim/?preset=bank&count=4&span=1&app=evolution&transport=local&bots=1&seed=e2e&debug=1&res=0.25",
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
                w.__evolution !== undefined,
            ) &&
            hubs.length === 1
          );
        }),
      { timeout: 120_000, intervals: [500] },
    )
    .toBe(true);
  await expect.poll(async () => (await screenState(page)).frames, { timeout: 30_000 }).toBe(4);
};

test.describe("evolution in a bank", () => {
  test.describe.configure({ timeout: 240_000 });

  test("evolution: the screen's tree holds every panel's fish over its panel, and a migrant keeps its lineage", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openBank(page);
    const sc = await screenState(page);
    expect(sc.demo).toBe(false);
    expect(sc.columns).toBe(4);
    expect(sc.islands.map((i) => [i.island, i.pos])).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
    for (const i of sc.islands) expect(i.fish).toBeGreaterThanOrEqual(15);
    expect(sc.leaves).toBeGreaterThan(70);
    for (const id of PANELS) expect((await panelState(page, id)).mode).toBe("comb");
    // Send a fish from the second panel to the third.
    const sent = await inFrame(page, "a-p2", () => window.__evolution!.migrate!(0, 1));
    expect(sent).not.toBeNull();
    const id = sent!;
    await expect
      .poll(async () => (await panelState(page, "a-p3")).ponds[0]!.fish.some((f) => f.id === id), {
        timeout: 40_000,
      })
      .toBe(true);
    expect((await panelState(page, "a-p2")).ponds[0]!.fish.some((f) => f.id === id)).toBe(false);
    // The screen keeps its line, alive and now in the third panel's column.
    await expect
      .poll(
        () =>
          inFrame(
            page,
            "a-screen",
            (fid: number) =>
              (
                window.__evolution as unknown as {
                  where(id: number): { col: number; alive: boolean } | null;
                }
              ).where(fid),
            id,
          ),
        { timeout: 10_000 },
      )
      .toEqual({ col: 2, alive: true });
    expect.soft(problems).toEqual([]);
  });

  test("evolution: panels draw their own tree within 3 s of the screen going", async ({ page }) => {
    await openBank(page);
    const removed = await page.evaluate(() => {
      document.querySelector('.sim-frame[data-frame="a-screen"] iframe')?.remove();
      return performance.timeOrigin + performance.now();
    });
    for (const id of PANELS) {
      await expect
        .poll(async () => (await panelState(page, id)).mode, { timeout: 15_000 })
        .toBe("tree");
    }
    const took = await Promise.all(
      PANELS.map(async (id) => {
        const at = await inFrame(
          page,
          id,
          () =>
            performance.timeOrigin +
            (window.__evolution!.state() as unknown as { modeAt: number }).modeAt,
        );
        return Math.round(at - removed);
      }),
    );
    test.info().annotations.push({ type: "fallback", description: `${took.join(", ")} ms` });
    for (const t of took) {
      expect.soft(t).toBeLessThan(3500);
      expect(t).toBeLessThan(5000);
    }
    const st = await panelState(page, "a-p2");
    expect(st.leaves).toBeGreaterThan(15);
  });

  test("evolution: a screen with no panels runs ponds of its own", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 730 });
    await page.goto("play/?app=evolution&kind=screen&fit=4000x3600&bots=0&seed=e2e&debug=1");
    await page.waitForFunction(() => window.__evolution !== undefined);
    await expect
      .poll(
        async () => (await page.evaluate(() => window.__evolution!.state() as ScreenState)).demo,
        {
          timeout: 15_000,
        },
      )
      .toBe(true);
    const s = await page.evaluate(() => window.__evolution!.state() as ScreenState);
    // A bank of pairs, the venue's usual bank of panels halved.
    expect(s.columns).toBeGreaterThanOrEqual(3);
    expect(s.leaves).toBeGreaterThan(16 * s.columns);
  });
});
