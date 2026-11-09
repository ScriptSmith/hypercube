import { expect, type Page, test } from "@playwright/test";
import { waitForRunning, watchPage } from "../scripts/lib/play.mjs";

/**
 * Logic Lab on single frames, through real pointer events: the starting circuit lighting its
 * lamp, wires that snap only onto ports, a goal card completing, hold-to-reset and admin
 * commands, the attract ghost giving way to a person, and idle bringing a new machine.
 */

interface PieceState {
  id: number;
  kind: string;
  socket: number;
  on: boolean;
  out: boolean;
  pinned: boolean;
  live: boolean;
  ports: { pin: number; x: number; y: number }[];
}
interface BenchState {
  slot: { x: number; y: number; width: number; height: number };
  reset: { x: number; y: number; width: number; height: number };
  snap: number;
  machine: string;
  posts: boolean[];
  sockets: { x: number; y: number; band: string; piece: number | null }[];
  trays: {
    band: string;
    box: { x: number; y: number; width: number; height: number };
    items: { kind: string; x: number; y: number }[];
  }[];
  pieces: PieceState[];
  wires: { id: number; from: number; to: number; pin: number }[];
  card: string | null;
  cardIndex: number;
  rows: boolean[];
  done: boolean;
  completed: number;
  gestures: number;
  ghost: boolean;
}
interface LogicState {
  unit: number;
  kind: string;
  benches: BenchState[];
}

declare global {
  interface Window {
    __logic?: {
      state(): LogicState;
      command(name: string): void;
      setCard(bench: number, card: number): void;
      cards: string[];
    };
  }
}

const SIZES = {
  pair: [2160, 1920],
  wall: [5760, 2160],
  kiosk: [1920, 1080],
} as const;

const open = async (
  page: Page,
  kind: keyof typeof SIZES,
  params: Record<string, string | number> = {},
) => {
  const [w, h] = SIZES[kind];
  const scale = Math.min(1100 / w, 820 / h);
  await page.setViewportSize({ width: Math.round(w * scale), height: Math.round(h * scale) });
  const q = new URLSearchParams({
    app: "logic",
    kind,
    fit: `${w}x${h}`,
    bots: "0",
    seed: "e2e",
    debug: "1",
    idle: "600",
  });
  for (const [k, v] of Object.entries(params)) q.set(k, String(v));
  await page.goto(`play/?${q}`);
  expect((await waitForRunning(page)).phase).toBe("running");
  await page.waitForFunction(() => window.__logic !== undefined);
};

const state = (page: Page) => page.evaluate(() => window.__logic!.state());
const bench = async (page: Page, i = 0) => (await state(page)).benches[i]!;

/** A pen touch at venue px: down on whatever is there, moves and lifts on the window. */
const pen = (page: Page, type: string, vx: number, vy: number, pointerId: number) =>
  page.evaluate(
    ({ type, vx, vy, pointerId }) => {
      const stage = document.querySelector<HTMLElement>(".hc-stage")!;
      const r = stage.getBoundingClientRect();
      const unit = window.__hypercube!.frame!.unit;
      const x = r.left + vx * unit * (r.width / stage.offsetWidth);
      const y = r.top + vy * unit * (r.height / stage.offsetHeight);
      const target = type === "pointerdown" ? document.elementFromPoint(x, y) : window;
      target?.dispatchEvent(
        new PointerEvent(type, {
          pointerId,
          clientX: x,
          clientY: y,
          bubbles: true,
          pointerType: "pen",
          buttons: type === "pointerup" ? 0 : 1,
        }),
      );
    },
    { type, vx, vy, pointerId },
  );

let nextId = 70;
const tap = async (page: Page, at: { x: number; y: number }) => {
  const id = nextId++;
  await pen(page, "pointerdown", at.x, at.y, id);
  await page.waitForTimeout(60);
  await pen(page, "pointerup", at.x, at.y, id);
};
const drag = async (page: Page, from: { x: number; y: number }, to: { x: number; y: number }) => {
  const id = nextId++;
  await pen(page, "pointerdown", from.x, from.y, id);
  for (let i = 1; i <= 10; i++) {
    // A wobbly path: the wire must not care.
    const wob = i < 10 ? Math.sin(i * 1.7) * 60 : 0;
    await pen(
      page,
      "pointermove",
      from.x + ((to.x - from.x) * i) / 10 + wob,
      from.y + ((to.y - from.y) * i) / 10 - wob,
      id,
    );
    await page.waitForTimeout(16);
  }
  await pen(page, "pointerup", to.x, to.y, id);
};
const hold = async (page: Page, at: { x: number; y: number }, ms: number) => {
  const id = nextId++;
  await pen(page, "pointerdown", at.x, at.y, id);
  await page.waitForTimeout(ms);
  await pen(page, "pointerup", at.x, at.y, id);
};

/** Touch an empty spot of a bench's slot, which ends its ghost, then set a known circuit. */
const takeOver = async (page: Page, i = 0, command = "starter") => {
  const b = await bench(page, i);
  await tap(page, { x: b.slot.x + 30, y: b.slot.y + b.slot.height - 20 });
  await expect.poll(async () => (await bench(page, i)).ghost).toBe(false);
  await expect.poll(async () => (await bench(page, i)).gestures).toBe(0);
  await page.evaluate((c) => window.__logic!.command(c), command);
};

const port = (p: PieceState, pin: number) => {
  const q = p.ports.find((x) => x.pin === pin)!;
  return { x: q.x, y: q.y };
};
/** A point low on a child piece, clear of its port. */
const grip = (b: BenchState, p: PieceState) => {
  const s = b.sockets[p.socket]!;
  return { x: s.x, y: s.y + 60 };
};
const of = (b: BenchState, kind: string) => b.pieces.filter((p) => p.kind === kind);

test.describe("logic", () => {
  test.describe.configure({ timeout: 120_000 });

  test("flipping a switch lights its lamp and post through the starting circuit", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await open(page, "pair");
    await takeOver(page);
    let b = await bench(page);
    const [a, s2] = of(b, "switch");
    expect(a!.on).toBe(true);
    expect(s2!.on).toBe(false);
    expect(of(b, "lamp")[0]!.live).toBe(false);
    await tap(page, grip(b, s2!));
    await expect.poll(async () => of(await bench(page), "lamp")[0]!.live).toBe(true);
    b = await bench(page);
    expect(b.posts[0]).toBe(true);
    // The machine's first input comes up.
    await expect
      .poll(() => page.evaluate(() => window.__hypercube?.appStatus?.()?.wires ?? 0))
      .toBe(4);
    await tap(page, grip(b, s2!));
    await expect.poll(async () => of(await bench(page), "lamp")[0]!.live).toBe(false);
    expect(problems).toEqual([]);
  });

  test("a drag from an output to an input makes a wire, and a drag ending elsewhere doesn't", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await open(page, "kiosk");
    await takeOver(page);
    let b = await bench(page);
    const s1 = of(b, "switch")[0]!;
    const or = of(b, "or")[0]!;
    const n = b.wires.length;
    const from = port(s1, -1);
    // Into empty board space: it springs back.
    await drag(page, from, { x: from.x + 40, y: from.y - 260 });
    await expect.poll(async () => (await bench(page)).gestures).toBe(0);
    expect((await bench(page)).wires).toHaveLength(n);
    // From one output to another output: nothing.
    await drag(page, from, port(of(b, "switch")[1]!, -1));
    expect((await bench(page)).wires).toHaveLength(n);
    // Near (not on) the OR's first input: it snaps.
    const pin = port(or, 0);
    await drag(page, from, { x: pin.x - 50, y: pin.y - 50 });
    await expect.poll(async () => (await bench(page)).wires.length).toBe(n + 1);
    b = await bench(page);
    expect(b.wires.some((w) => w.from === s1.id && w.to === or.id && w.pin === 0)).toBe(true);
    // Dragging that wire's input end off its port removes it.
    await drag(page, pin, { x: pin.x + 50, y: pin.y + 330 });
    await expect.poll(async () => (await bench(page)).wires.length).toBe(n);
    // A piece from the tray into a free gate socket, and a gate back to the tray.
    const gateTray = b.trays.find((t) => t.band === "adult")!.box;
    const free = b.sockets.findIndex((s) => s.band === "adult" && s.piece === null);
    const xor = b.trays.flatMap((t) => t.items).find((i) => i.kind === "xor")!;
    await drag(page, xor, b.sockets[free]!);
    await expect.poll(async () => of(await bench(page), "xor").length).toBe(1);
    const placed = of(await bench(page), "xor")[0]!;
    const s = b.sockets[placed.socket]!;
    await drag(page, s, { x: gateTray.x + gateTray.width / 2, y: gateTray.y + 40 });
    await expect.poll(async () => of(await bench(page), "xor").length).toBe(0);
    expect(problems).toEqual([]);
  });

  test("a goal card completes when its rows are right, and the next one comes", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await open(page, "pair", { variant: "goals" });
    await takeOver(page);
    await page.evaluate(() => window.__logic!.setCard(0, 0));
    let b = await bench(page);
    expect(b.card).toBe("copy");
    expect(b.wires).toHaveLength(0);
    const input = b.pieces.find((p) => p.pinned && p.kind === "switch")!;
    const post = of(b, "post").sort((x, y) => x.socket - y.socket)[0]!;
    await expect.poll(async () => (await bench(page)).rows).toEqual([true, false]);
    await drag(page, port(input, -1), port(post, 0));
    await expect.poll(async () => (await bench(page)).rows).toEqual([true, true]);
    b = await bench(page);
    expect(b.done).toBe(true);
    expect(b.completed).toBe(1);
    await expect.poll(async () => (await bench(page)).card, { timeout: 15_000 }).toBe("not");
    expect((await bench(page)).wires).toHaveLength(0);
    expect(problems).toEqual([]);
  });

  test("hold-to-reset restores a bench, and admin clears and restores every bench", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await open(page, "wall", { "o.benches": 3 });
    expect((await state(page)).benches).toHaveLength(3);
    await takeOver(page, 1);
    let b = await bench(page, 1);
    // Take the lamp off to the tray.
    const lamp = of(b, "lamp")[0]!;
    const tray = b.trays.find((t) => t.band === "child")!.box;
    await drag(page, grip(b, lamp), { x: tray.x + tray.width / 2, y: tray.y + tray.height / 2 });
    await expect.poll(async () => of(await bench(page, 1), "lamp").length).toBe(0);
    b = await bench(page, 1);
    await hold(page, { x: b.reset.x + b.reset.width / 2, y: b.reset.y + b.reset.height / 2 }, 1400);
    await expect.poll(async () => of(await bench(page, 1), "lamp").length).toBe(1);
    expect((await bench(page, 1)).wires).toHaveLength(4);
    await page.evaluate(() => window.__logic!.command("clear"));
    for (const x of (await state(page)).benches) {
      expect(x.pieces.every((p) => p.kind === "post")).toBe(true);
      expect(x.wires).toHaveLength(0);
    }
    await page.evaluate(() => window.__logic!.command("starter"));
    for (const x of (await state(page)).benches) expect(x.wires).toHaveLength(4);
    const status = await page.evaluate(() => window.__hypercube?.appStatus?.());
    expect(status).toMatchObject({ benches: 3, pieces: 15, wires: 12 });
    expect(problems).toEqual([]);
  });

  test("the ghost works benches nobody touches, gives way to a person, and idle brings it back", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await open(page, "wall", { idle: 8, "o.machine": "rotate" });
    const first = (await state(page)).benches.map((b) => b.machine);
    // The ghost flips switches on both benches.
    const flips = async (i: number) =>
      of(await bench(page, i), "switch")
        .map((p) => (p.on ? 1 : 0))
        .join("");
    const start = [await flips(0), await flips(1)];
    await expect
      .poll(async () => [await flips(0), await flips(1)].some((f, i) => f !== start[i]), {
        timeout: 30_000,
      })
      .toBe(true);
    await takeOver(page, 0);
    expect((await bench(page, 0)).ghost).toBe(false);
    expect((await bench(page, 1)).ghost).toBe(true);
    // Untouched for the idle time: every bench starts again with a new machine and its ghost.
    await expect
      .poll(async () => (await state(page)).benches.map((b) => b.machine).join(), {
        timeout: 30_000,
      })
      .not.toBe(first.join());
    expect((await bench(page, 0)).ghost).toBe(true);
    expect(problems).toEqual([]);
  });

  test("bots play a whole wall within the limits", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "wall", { bots: 3, "o.benches": 3, "o.gates": "basic" });
    const versions = async () =>
      (await state(page)).benches.map((b) => `${b.pieces.length}:${b.wires.length}`).join();
    const before = await versions();
    await expect.poll(versions, { timeout: 30_000 }).not.toBe(before);
    for (const b of (await state(page)).benches) {
      expect(b.pieces.filter((p) => p.kind !== "post").length).toBeLessThanOrEqual(14);
      expect(b.wires.length).toBeLessThanOrEqual(24);
      expect(b.pieces.some((p) => p.kind === "xor" || p.kind === "blinker")).toBe(false);
    }
    expect(problems).toEqual([]);
  });
});
