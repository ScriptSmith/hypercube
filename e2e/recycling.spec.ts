import { expect, type Page, test } from "@playwright/test";
import { watchPage } from "../scripts/lib/play.mjs";

/**
 * Recycling Rush: dragging an item into its bin with real pointer events, a wrong bin pushing it
 * back out with the right bin's lid glowing, bots sorting through injected touches, and in the
 * simulator's banks, items falling from the screen across the bezel without a jump (with and
 * without added delay) and every frame starting its own plant when the screen goes.
 */

interface Mouth {
  x0: number;
  x1: number;
  y: number;
}
interface BinSlot {
  id: number;
  kind: string;
  line: number;
  x: number;
  w: number;
  top: number;
  bottom: number;
  mouth: Mouth;
}
interface ItemState {
  id: number;
  kind: number;
  item: string;
  bin: string;
  line: number;
  state: string;
  x: number;
  y: number;
  belt: number;
  s: number;
}
interface Arrival {
  id: number;
  line: number;
  t0: number;
  cross: number;
  received: number;
  enterY: number | null;
  enterAt: number | null;
  x: number;
}
interface FrameState {
  screen: false;
  unit: number;
  mode: string;
  own: boolean;
  toScreen: string | null;
  layout: {
    width: number;
    d: number;
    r: number;
    belts: { id: number; start: number; end: number; y: number; speed: string }[];
    bins: BinSlot[];
  };
  items: ItemState[];
  bins: { kind: string; fill: number; phase: string; glow: number }[];
  counts: { right: number; wrong: number; people: number; arrived: number; spawned: number };
  arrivals: Arrival[];
}
interface ScreenState {
  screen: true;
  clock: number;
  fw: number;
  columns: { pos: number; kind: string; frame: string | null }[];
  recent: { id: number; column: number; inlet: number; x: number; t0: number; cross: number }[];
  counts: { drops: number; sent: number };
}

declare global {
  interface Window {
    __recycling?: {
      state(): FrameState | ScreenState;
      setLag(ms: number): void;
      command(name: string): void;
    };
  }
}

const SIZES = { panel: [1080, 1920], wall: [5760, 2160], kiosk: [1920, 1080] } as const;

const open = async (
  page: Page,
  kind: keyof typeof SIZES,
  params: Record<string, string | number> = {},
) => {
  const [w, h] = SIZES[kind];
  const scale = Math.min(900 / w, 900 / h);
  await page.setViewportSize({ width: Math.round(w * scale), height: Math.round(h * scale) });
  const q = new URLSearchParams({
    app: "recycling",
    kind,
    fit: `${w}x${h}`,
    bots: "0",
    seed: "e2e",
    debug: "1",
  });
  for (const [k, v] of Object.entries(params)) q.set(k, String(v));
  await page.goto(`play/?${q}`);
  await page.waitForFunction(() => window.__recycling?.state() !== undefined, undefined, {
    timeout: 30_000,
  });
};

const state = (page: Page) => page.evaluate(() => window.__recycling!.state() as FrameState);

/** Real pointer events along venue points, a move every 16 ms; returns once the finger lifts. */
const drag = (page: Page, path: { x: number; y: number }[], pointerId: number, stepMs = 16) =>
  page.evaluate(
    async ({ pts, id, ms }) => {
      const st = window.__recycling!.state() as { unit: number };
      const stage = document.querySelector<HTMLElement>(".hc-stage")!;
      const r = stage.getBoundingClientRect();
      const k = st.unit * (r.width / stage.offsetWidth);
      const at = (p: { x: number; y: number }) => ({
        clientX: r.left + p.x * k,
        clientY: r.top + p.y * k,
      });
      const first = at(pts[0]!);
      const target = document.elementFromPoint(first.clientX, first.clientY) ?? stage;
      const fire = (type: string, p: { clientX: number; clientY: number }) =>
        target.dispatchEvent(
          new PointerEvent(type, {
            ...p,
            pointerId: id,
            pointerType: "touch",
            bubbles: true,
            isPrimary: true,
            buttons: type === "pointerup" ? 0 : 1,
          }),
        );
      fire("pointerdown", first);
      for (const p of pts.slice(1)) {
        await new Promise((res) => setTimeout(res, ms));
        fire("pointermove", at(p));
      }
      fire("pointerup", at(pts[pts.length - 1]!));
    },
    { pts: path, id: pointerId, ms: stepMs },
  );

/** Points every `step` venue px along a polyline, so the item follows smoothly. */
const densify = (pts: { x: number; y: number }[], step = 40) => {
  const out = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 1; k <= n; k++)
      out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
};

/** An item well along a belt (the slow one unless `any`) whose bin is one of `kinds`. */
const beltItem = async (
  page: Page,
  o: { kinds?: string[]; any?: boolean } = {},
): Promise<{ item: ItemState; st: FrameState }> => {
  const kinds = o.kinds ?? ["recycle", "compost", "rubbish"];
  let found: { item: ItemState; st: FrameState } | null = null;
  await expect
    .poll(
      async () => {
        const st = await state(page);
        const ok = st.layout.belts.filter((b) => o.any || b.speed === "slow").map((b) => b.id);
        const item = st.items.find((it) => {
          const b = st.layout.belts[it.belt];
          return (
            b !== undefined &&
            it.state === "belt" &&
            ok.includes(it.belt) &&
            kinds.includes(it.bin) &&
            it.s > st.layout.d &&
            it.s < Math.abs(b.end - b.start) * 0.6
          );
        });
        found = item ? { item, st } : null;
        return found !== null;
      },
      { timeout: 40_000, intervals: [300] },
    )
    .toBe(true);
  return found!;
};

/** Down past the mouth of `bin`, starting straight across at the item's height. */
const into = (item: ItemState, bin: BinSlot) =>
  densify([
    { x: item.x, y: item.y },
    { x: bin.x, y: item.y },
    { x: bin.x, y: bin.mouth.y + 70 },
  ]);

test.describe("recycling", () => {
  test.describe.configure({ timeout: 120_000 });

  test("dragging an item into its bin counts and fills the bin", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "panel");
    // A first touch on empty floor wakes it from attract, so the ghost hand leaves things be.
    await drag(page, [{ x: 540, y: 1880 }], 9001);
    expect((await state(page)).mode).toBe("play");
    const { item, st } = await beltItem(page);
    const bin = st.layout.bins.find((b) => b.kind === item.bin && b.line === item.line)!;
    const before = st.counts;
    await drag(page, into(item, bin), 9002);
    await expect
      .poll(async () => (await state(page)).counts.right, { timeout: 5_000 })
      .toBe(before.right + 1);
    const after = await state(page);
    expect(after.counts.people).toBe(before.people + 1);
    expect(after.counts.wrong).toBe(before.wrong);
    // The bin counts it once it has sunk in.
    await expect
      .poll(async () => (await state(page)).bins[bin.id]!.fill, {
        timeout: 3_000,
        intervals: [100],
      })
      .toBe(st.bins[bin.id]!.fill + 1);
    expect(problems).toEqual([]);
  });

  test("a wrong bin pushes the item back out onto the belt, and the right bin's lid glows", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await open(page, "kiosk");
    await drag(page, [{ x: 960, y: 1060 }], 9001);
    // A kiosk has one belt, at middle speed.
    const { item, st } = await beltItem(page, {
      any: true,
      kinds: ["recycle", "compost", "rubbish", "dropoff"],
    });
    const wrong = st.layout.bins.find((b) => b.kind !== item.bin && b.line === item.line)!;
    const right = st.layout.bins.find((b) => b.kind === item.bin && b.line === item.line)!;
    const before = st.counts.wrong;
    await drag(page, into(item, wrong), 9003);
    await expect
      .poll(async () => (await state(page)).counts.wrong, { timeout: 5_000 })
      .toBe(before + 1);
    await expect
      .poll(async () => (await state(page)).bins[right.id]!.glow, {
        timeout: 3_000,
        intervals: [100],
      })
      .toBeGreaterThan(0);
    await expect
      .poll(async () => (await state(page)).items.find((x) => x.id === item.id)?.state, {
        timeout: 5_000,
        intervals: [100],
      })
      .toBe("belt");
    expect((await state(page)).bins[wrong.id]!.fill).toBe(st.bins[wrong.id]!.fill);
    expect(problems).toEqual([]);
  });

  test("bots sort with injected touches, on a panel and on all three lines of a wall", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await open(page, "panel", { bots: 2 });
    await expect
      .poll(async () => (await state(page)).counts.right, { timeout: 60_000, intervals: [1000] })
      .toBeGreaterThanOrEqual(4);
    await open(page, "wall", { bots: 3 });
    await expect
      .poll(
        async () => {
          const st = await state(page);
          return new Set(st.bins.flatMap((b, i) => (b.fill > 0 ? [st.layout.bins[i]!.line] : [])))
            .size;
        },
        { timeout: 60_000, intervals: [1000] },
      )
      .toBe(3);
    const status = await page.evaluate(() => window.__hypercube!.appStatus());
    expect(Number(status.right)).toBeGreaterThanOrEqual(3);
    expect(problems).toEqual([]);
  });
});

/** Evaluate in one sim frame. */
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

const frameState = (page: Page, id: string) =>
  inFrame(page, id, () => window.__recycling?.state() as FrameState | undefined);
const screenState = (page: Page) =>
  inFrame(page, "a-screen", () => window.__recycling?.state() as ScreenState | undefined);

const touchFrames = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".sim-frame[data-frame]")]
      .map((el) => el.dataset.frame!)
      .filter((id) => id !== "a-screen"),
  );

for (const [preset, frames] of [
  ["bank-panels", 7],
  ["bank-pairs", 4],
] as const) {
  test.describe(`recycling in a ${preset} bank`, () => {
    test.describe.configure({ timeout: 240_000 });
    const probe = preset === "bank-pairs" ? "a-pair3" : "a-p4";

    test(`recycling: items fall from the screen across the bezel without a jump, with and without delay; frames feed themselves when the screen goes (${preset})`, async ({
      page,
    }) => {
      const problems = watchPage(page);
      await page.setViewportSize({ width: 1600, height: 1000 });
      await page.goto(
        `sim/?preset=${preset}&app=recycling&transport=local&bots=1&seed=e2e&debug=1`,
      );
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const all = [...document.querySelectorAll<HTMLElement>(".sim-frame[data-frame]")];
              const wins = all.map((el) => el.querySelector("iframe")?.contentWindow);
              return (
                all.length ===
                  wins.filter(
                    (w) => w?.__hypercube?.phase === "running" && w.__hypercube.room === "online",
                  ).length &&
                wins.filter((w) => w?.__hypercube?.net?.isHub).length === 1 &&
                all.length
              );
            }),
          { timeout: 120_000, intervals: [1000] },
        )
        .toBe(frames);
      const ids = await touchFrames(page);
      // Every frame follows the screen and stops its own plant.
      await expect
        .poll(
          async () => {
            const sts = await Promise.all(ids.map((id) => frameState(page, id)));
            return sts.every((s) => s && s.toScreen === "a-screen" && !s.own);
          },
          { timeout: 40_000, intervals: [1000] },
        )
        .toBe(true);

      const pos = await inFrame(page, probe, () => window.__hypercube?.setup?.pos ?? 0);
      /** Arrivals at the probe since `after`, matched with the screen's record of each drop. */
      const crossings = async (after: number) => {
        const f = (await frameState(page, probe))!;
        const s = (await screenState(page))!;
        return f.arrivals
          .filter((a) => a.t0 > after && a.enterY !== null)
          .map((a) => ({ a, drop: s.recent.find((r) => r.id === a.id && r.column === pos) }))
          .filter((x) => x.drop !== undefined)
          .map(({ a, drop }) => ({
            lead: a.cross - a.received,
            enterY: a.enterY!,
            dx: Math.abs(pos * s.fw + a.x - drop!.x),
            dCross: Math.abs(a.cross - drop!.cross),
            r: f.layout.r,
          }));
      };
      const check = (list: Awaited<ReturnType<typeof crossings>>, label: string) => {
        expect(list.length, label).toBeGreaterThanOrEqual(2);
        for (const c of list) {
          // Same place across the bank, same moment at the edge.
          expect(c.dx, label).toBeLessThan(1);
          expect(c.dCross, label).toBeLessThan(2);
          // The message came before the item reached the edge, and the first place the frame
          // drew it was straddling its top edge, not part way down.
          expect(c.lead, label).toBeGreaterThan(0);
          expect(c.enterY, label).toBeGreaterThan(-c.r);
          // How far in it was first drawn depends on the frame rate, which is low in the sim.
          expect.soft(c.enterY, label).toBeLessThanOrEqual(c.r * 2);
        }
      };
      let since = (await screenState(page))!.clock;
      await expect
        .poll(async () => (await crossings(since)).length, { timeout: 60_000, intervals: [1000] })
        .toBeGreaterThanOrEqual(2);
      check(await crossings(since), "no added delay");

      await inFrame(page, "a-screen", (ms: number) => window.__recycling!.setLag(ms), 300);
      since = (await screenState(page))!.clock;
      await expect
        .poll(async () => (await crossings(since)).length, { timeout: 60_000, intervals: [1000] })
        .toBeGreaterThanOrEqual(2);
      const delayed = await crossings(since);
      check(delayed, "300 ms added");
      test.info().annotations.push({
        type: "lead",
        description: `with 300 ms added, drops reached the frame ${Math.min(...delayed.map((c) => c.lead)).toFixed(0)} ms or more before the edge`,
      });

      // The screen goes: every frame starts its own plant within a few seconds.
      const spawned = await Promise.all(
        ids.map(async (id) => (await frameState(page, id))!.counts.spawned),
      );
      await page.evaluate(() =>
        document.querySelector('.sim-frame[data-frame="a-screen"] iframe')?.remove(),
      );
      await expect
        .poll(
          async () => {
            const sts = await Promise.all(ids.map((id) => frameState(page, id)));
            return sts.every((s, i) => s && s.own && s.counts.spawned > spawned[i]!);
          },
          { timeout: 20_000, intervals: [500] },
        )
        .toBe(true);
      const errors = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>(".sim-frame[data-frame]")].flatMap((el) => {
          const s = el.querySelector("iframe")?.contentWindow?.__hypercube;
          return s ? [...s.errors] : [];
        }),
      );
      expect(errors).toEqual([]);
      expect(problems).toEqual([]);
    });
  });
}
