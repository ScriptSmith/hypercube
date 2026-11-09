import { expect, type Frame, type Page, test } from "@playwright/test";
import { watchPage } from "../scripts/lib/play.mjs";

/**
 * Traffic: on a lone wall a tap brakes a car and its jam travels backwards on the road and up
 * the diagram, a held finger keeps a car stopped, and the adults' controls change the road until
 * idle puts them back; on a lone panel the loop answers a tap. In the simulator: a bank whose
 * panels show one ring lined up with the screen (also with 300 ms of added delay), a tap on a
 * panel braking the host's car, the road carrying on when the screen goes, and two walls in
 * versus throwing slowdowns at each other. With the road as a circle: a tap on the wall's lower
 * arc starts a jam that moves back, a lone panel's circle answers a tap, and a bank's screen
 * draws every car round its circle where the panels below have it.
 */

interface DrawnCar {
  id: number;
  x: number;
  y: number;
  angle: number;
  v: number;
  ringX: number;
  flags: number;
}
interface RingCar {
  id: number;
  x: number;
  v: number;
  flags: number;
}
interface Cell {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface Group {
  key: "cars" | "limit" | "smart";
  cells: Cell[];
}
interface Settings {
  count: number;
  limit: number;
  smart: number;
}
interface FrameState {
  screen: false;
  mode: "solo" | "bank" | "local" | "versus";
  modeAt: number;
  hosting: boolean;
  host: string | null;
  handovers: number;
  delay: number;
  late: number;
  settings: Settings | null;
  length: number;
  layout: {
    kind: string;
    width: number;
    height: number;
    laneY: number;
    controls: Group[];
    circle: Circle | null;
  };
  cars: DrawnCar[];
  ring: RingCar[];
}
interface Circle {
  cx: number;
  cy: number;
  r: number;
}
interface ScreenState {
  screen: true;
  hosting: boolean;
  host: string | null;
  settings: Settings | null;
  length: number;
  ring: RingCar[];
  circle: Circle | null;
  diagram: Cell;
  drawn: { id: number; x: number; y: number; angle: number }[];
}
interface VersusState {
  mode: "versus";
  side: number;
  round: number;
  phantom: boolean;
  /** Thousandths of car time moving this round. */
  ours: number;
  theirs: number;
  theirRound: number;
  thrown: number;
  landed: number;
  slowdowns: Cell[];
  seed: number;
  step: number;
  ring: { id: number; x: number; v: number; mark: number }[];
}

declare global {
  interface Window {
    __traffic?: {
      /** One of FrameState, ScreenState or VersusState, by the frame. */
      state(): FrameState & { unit: number };
      peek(f: number, secs: number): [number, number, number];
      setLag(ms: number): void;
    };
  }
}

const FLAG = { brake: 1, smart: 2, ghost: 4, touched: 8 };

const SIZES = {
  wall: [5760, 2160],
  panel: [1080, 1920],
  pair: [2160, 1920],
} as const;

const open = async (
  page: Page,
  kind: keyof typeof SIZES,
  params: Record<string, string | number> = {},
) => {
  const [w, h] = SIZES[kind];
  const scale = Math.min(1200 / w, 800 / h);
  await page.setViewportSize({ width: Math.round(w * scale), height: Math.round(h * scale) });
  const q = new URLSearchParams({
    app: "traffic",
    kind,
    fit: `${w}x${h}`,
    bots: "0",
    seed: "e2e",
    debug: "1",
  });
  for (const [k, v] of Object.entries(params)) q.set(k, String(v));
  await page.goto(`play/?${q}`);
  await page.waitForFunction(() => window.__traffic !== undefined, undefined, { timeout: 30_000 });
};

const state = (page: Page | Frame): Promise<FrameState> =>
  page.evaluate(() => window.__traffic!.state());

/** A finger at a venue point, as real pointer events. Returns a function that lifts it. */
const finger = async (page: Page | Frame, at: { x: number; y: number }) => {
  const id = await page.evaluate((p) => {
    const stage = document.querySelector<HTMLElement>(".hc-stage")!;
    const r = stage.getBoundingClientRect();
    const unit = window.__traffic!.state().unit;
    const k = unit * (r.width / stage.offsetWidth);
    const clientX = r.left + p.x * k;
    const clientY = r.top + p.y * k;
    const pointerId = 5000 + Math.floor(Math.random() * 4000);
    const target = document.elementFromPoint(clientX, clientY) ?? stage;
    target.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX,
        clientY,
        pointerId,
        pointerType: "touch",
        bubbles: true,
        isPrimary: true,
      }),
    );
    (window as unknown as Record<string, unknown>)[`__tf${pointerId}`] = {
      target,
      clientX,
      clientY,
    };
    return pointerId;
  }, at);
  return () =>
    page.evaluate((pointerId) => {
      const f = (
        window as unknown as Record<string, { target: Element; clientX: number; clientY: number }>
      )[`__tf${pointerId}`]!;
      f.target.dispatchEvent(
        new PointerEvent("pointerup", {
          clientX: f.clientX,
          clientY: f.clientY,
          pointerId,
          pointerType: "touch",
          bubbles: true,
        }),
      );
    }, id);
};

const tap = async (page: Page | Frame, at: { x: number; y: number }, ms = 80) => {
  const up = await finger(page, at);
  await new Promise((r) => setTimeout(r, ms));
  await up();
};

/** The car drawn nearest the middle of the frame, a little ahead of where it is drawn. */
const middleCar = (st: FrameState): DrawnCar => {
  const cars = [...st.cars].sort(
    (a, b) => Math.abs(a.x - st.layout.width / 2) - Math.abs(b.x - st.layout.width / 2),
  );
  return cars[0]!;
};

const cellOf = (st: FrameState, key: Group["key"], i: number) => {
  const c = st.layout.controls.find((g) => g.key === key)!.cells[i]!;
  return { x: c.x + c.width / 2, y: c.y + c.height / 2 };
};

/** Signed metres from a forward to b round a ring. */
const ahead = (a: number, b: number, L: number) => {
  let d = (b - a) % L;
  if (d > L / 2) d -= L;
  if (d <= -L / 2) d += L;
  return d;
};

/** Where ring fraction `f` is drawn round a circle: from the top, anticlockwise on screen. */
const onCircle = (c: Circle, f: number) => {
  const t = 2 * Math.PI * (f - Math.floor(f)) - Math.PI;
  return { x: c.cx + c.r * Math.sin(t), y: c.cy + c.r * Math.cos(t) };
};

test.describe("traffic on its own", () => {
  test("a tap brakes a car and the jam travels backwards on the road and up the diagram", async ({
    page,
  }) => {
    const problems = watchPage(page);
    // A smooth ring (no driver wobble), so the only jam is the one the tap makes.
    await open(page, "wall", { "o.noise": "false" });
    await page.waitForTimeout(2500);
    const before = await state(page);
    const L = before.length;
    expect(before.mode).toBe("solo");
    expect(Math.min(...before.ring.map((c) => c.v))).toBeGreaterThan(4);
    const car = middleCar(before);
    const at = car.ringX;
    const tapAt = Date.now();
    await tap(page, { x: car.x + 20, y: car.y });

    // Brake lights at once, and the car stops.
    const mine = async () => (await state(page)).ring.find((c) => c.id === car.id)!;
    expect((await mine()).flags & (FLAG.brake | FLAG.touched)).not.toBe(0);
    await expect.poll(async () => (await mine()).v, { timeout: 4000 }).toBeLessThan(1);

    // The slowest car is behind the tap and moves further back, while the tapped car drives on.
    const slowest = async () => {
      const st = await state(page);
      const s = [...st.ring].sort((a, b) => a.v - b.v)[0]!;
      return { at: ahead(at, s.x, L), v: s.v, tapped: st.ring.find((c) => c.id === car.id)! };
    };
    await page.waitForTimeout(3000);
    const a = await slowest();
    await page.waitForTimeout(4000);
    const b = await slowest();
    test.info().annotations.push({
      type: "jam",
      description: `slowest car ${a.at.toFixed(0)} m from the tap at 3 s, ${b.at.toFixed(0)} m at 7 s (${b.v.toFixed(1)} m/s)`,
    });
    expect(a.at).toBeLessThan(0);
    expect(b.at).toBeLessThan(a.at - 10);
    expect(b.v).toBeLessThan(2.5);
    expect(ahead(at, b.tapped.x, L)).toBeGreaterThan(5);

    // The diagram: white where the finger braked, and dark crimson where the jam is now.
    // Where the car was just after the tap, as long ago as that was (it was moving, so look
    // along a car length or two ahead of where it was drawn).
    const white = await page.evaluate(
      ([x, len, secs]) => {
        let best = [0, 0, 0];
        for (let dx = 0; dx <= 14; dx += 0.5) {
          const c = window.__traffic!.peek(((x! + dx) % len!) / len!, secs!);
          if (Math.min(...c) > Math.min(...best)) best = c;
        }
        return best;
      },
      [at, L, (Date.now() - tapAt) / 1000 - 0.35],
    );
    test.info().annotations.push({ type: "diagram at the tap", description: white.join(",") });
    const now = await page.evaluate(
      ([f]) => window.__traffic!.peek(f!, 0.2),
      [((((at + b.at + 2.25) % L) + L) % L) / L],
    );
    test.info().annotations.push({ type: "diagram at the jam", description: now.join(",") });
    expect(Math.min(...white)).toBeGreaterThan(200);
    expect(now[0]).toBeGreaterThan(now[2]!);
    expect.soft(problems).toEqual([]);
  });

  test("a held finger keeps its car stopped; let go and it drives on", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "wall", { "o.noise": "false" });
    await page.waitForTimeout(2000);
    const car = middleCar(await state(page));
    const up = await finger(page, { x: car.x + 20, y: car.y });
    const speed = async () => (await state(page)).ring.find((c) => c.id === car.id)!.v;
    await page.waitForTimeout(3500);
    expect(await speed()).toBeLessThan(0.05);
    await up();
    await expect.poll(speed, { timeout: 8000 }).toBeGreaterThan(2);
    expect.soft(problems).toEqual([]);
  });

  test("the adults' controls change the road, and idle puts them back", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "wall", { idle: 10 });
    await page.waitForTimeout(1500);
    let st = await state(page);
    const start = st.settings!;
    expect(start).toEqual({ count: st.ring.length, limit: 1, smart: 0 });
    await tap(page, cellOf(st, "cars", 2));
    await tap(page, cellOf(st, "limit", 2));
    await tap(page, cellOf(st, "smart", 3));
    await expect
      .poll(async () => (await state(page)).settings, { timeout: 3000 })
      .toEqual({ count: expect.any(Number), limit: 2, smart: 3 });
    st = await state(page);
    expect(st.settings!.count).toBeGreaterThan(start.count);
    await expect.poll(async () => (await state(page)).ring.length).toBe(st.settings!.count);
    const smart = st.ring.filter((c) => c.flags & FLAG.smart).length;
    expect(smart).toBe(Math.ceil(st.ring.length / 2));
    // The cars button can't go below about half.
    for (let i = 0; i < 12; i++) await tap(page, cellOf(st, "cars", 0), 30);
    await expect
      .poll(async () => (await state(page)).settings!.count)
      .toBe(Math.max(3, Math.round(start.count / 2)));
    // Nobody touches for the idle time: back to the start.
    await expect
      .poll(async () => (await state(page)).settings, { timeout: 25_000, intervals: [1000] })
      .toEqual(start);
    expect.soft(problems).toEqual([]);
  });

  test("a lone panel runs a loop, and a tap there brakes a car too", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "panel");
    await page.waitForTimeout(2000);
    const st = await state(page);
    expect(st.layout.kind).toBe("loop");
    expect(st.ring.length).toBeGreaterThanOrEqual(4);
    // A car on the bottom straight, where children reach.
    const car = st.cars.filter((c) => Math.abs(c.angle) < 0.01).sort((a, b) => b.y - a.y)[0]!;
    await tap(page, { x: car.x, y: car.y + 40 });
    await expect
      .poll(
        async () => (await state(page)).ring.find((c) => c.id === car.id)!.flags & FLAG.touched,
        {
          timeout: 2000,
        },
      )
      .not.toBe(0);
    expect.soft(problems).toEqual([]);
  });

  test("traffic: on a circle, a tap on the lower arc brakes a car and the jam moves back", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await open(page, "wall", { "o.noise": "false", "o.road": "circle" });
    await page.waitForTimeout(2500);
    const before = await state(page);
    const L = before.length;
    const circle = before.layout.circle!;
    expect(circle).not.toBeNull();
    expect(Math.min(...before.ring.map((c) => c.v))).toBeGreaterThan(4);
    // Every car is drawn on the circle, where its place round the ring says.
    for (const c of before.cars) {
      const p = onCircle(circle, (c.ringX + 2.25) / L);
      expect(Math.hypot(c.x - p.x, c.y - p.y)).toBeLessThan(2);
    }
    // The car nearest the bottom, where children reach; a finger lands just ahead of it.
    const car = [...before.cars].sort((a, b) => b.y - a.y)[0]!;
    expect(car.y).toBeGreaterThan(circle.cy + circle.r * 0.8);
    const at = car.ringX;
    const tapAt = Date.now();
    await tap(page, {
      x: car.x + 20 * Math.cos(car.angle),
      y: car.y + 20 * Math.sin(car.angle) + 30,
    });
    const mine = async () => (await state(page)).ring.find((c) => c.id === car.id)!;
    expect((await mine()).flags & (FLAG.brake | FLAG.touched)).not.toBe(0);
    await expect.poll(async () => (await mine()).v, { timeout: 4000 }).toBeLessThan(1);

    const slowest = async () => {
      const st = await state(page);
      const s = [...st.ring].sort((a, b) => a.v - b.v)[0]!;
      return { at: ahead(at, s.x, L), v: s.v, tapped: st.ring.find((c) => c.id === car.id)! };
    };
    await page.waitForTimeout(3000);
    const a = await slowest();
    await page.waitForTimeout(4000);
    const b = await slowest();
    test.info().annotations.push({
      type: "jam",
      description: `slowest car ${a.at.toFixed(0)} m from the tap at 3 s, ${b.at.toFixed(0)} m at 7 s (${b.v.toFixed(1)} m/s), on a ${L.toFixed(0)} m circle`,
    });
    expect(a.at).toBeLessThan(0);
    expect(b.at).toBeLessThan(a.at - 10);
    expect(b.v).toBeLessThan(2.5);
    expect(ahead(at, b.tapped.x, L)).toBeGreaterThan(5);
    // The diagram shows the ring unrolled: white where the finger braked.
    const white = await page.evaluate(
      ([x, len, secs]) => {
        let best = [0, 0, 0];
        for (let dx = 0; dx <= 14; dx += 0.5) {
          const c = window.__traffic!.peek(((x! + dx) % len!) / len!, secs!);
          if (Math.min(...c) > Math.min(...best)) best = c;
        }
        return best;
      },
      [at, L, (Date.now() - tapAt) / 1000 - 0.35],
    );
    expect(Math.min(...white)).toBeGreaterThan(200);
    expect.soft(problems).toEqual([]);
  });

  test("traffic: a lone panel's circle answers a tap", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "panel", { "o.road": "circle" });
    await page.waitForTimeout(2000);
    const st = await state(page);
    const circle = st.layout.circle!;
    expect(circle).not.toBeNull();
    expect(st.ring.length).toBeGreaterThanOrEqual(4);
    for (const c of st.cars) {
      expect(Math.abs(Math.hypot(c.x - circle.cx, c.y - circle.cy) - circle.r)).toBeLessThan(2);
    }
    // The lowest car; a child's finger lands on the verge just below it.
    const car = [...st.cars].sort((a, b) => b.y - a.y)[0]!;
    await tap(page, { x: car.x, y: car.y + 70 });
    await expect
      .poll(
        async () => (await state(page)).ring.find((c) => c.id === car.id)!.flags & FLAG.touched,
        { timeout: 2000 },
      )
      .not.toBe(0);
    // A touch in the middle of the circle brakes nothing.
    const others = (await state(page)).ring.filter((c) => c.id !== car.id);
    await tap(page, { x: circle.cx, y: circle.cy });
    await page.waitForTimeout(300);
    const after = (await state(page)).ring;
    for (const c of others) {
      expect(after.find((x) => x.id === c.id)!.flags & FLAG.touched).toBe(0);
    }
    expect.soft(problems).toEqual([]);
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

const simFrame = async (page: Page, id: string): Promise<Frame> => {
  const el = await page.$(`.sim-frame[data-frame="${id}"] iframe`);
  const frame = await el?.contentFrame();
  if (!frame) throw new Error(`no frame ${id}`);
  return frame;
};

const PANELS = ["a-p1", "a-p2", "a-p3", "a-p4"];

const openSim = async (page: Page, preset: string, ids: string[]) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`sim/?${preset}&app=traffic&transport=local&bots=0&seed=e2e&debug=1&res=0.25`);
  await expect
    .poll(
      () =>
        page.evaluate((want) => {
          const wins = want.map(
            (id) =>
              document.querySelector<HTMLIFrameElement>(`.sim-frame[data-frame="${id}"] iframe`)
                ?.contentWindow,
          );
          const hubs = wins.filter((w) => w?.__hypercube?.net?.isHub);
          return (
            wins.every(
              (w) =>
                w?.__hypercube?.phase === "running" &&
                w.__hypercube.room === "online" &&
                w.__traffic !== undefined,
            ) && hubs.length === 1
          );
        }, ids),
      { timeout: 120_000, intervals: [500] },
    )
    .toBe(true);
};

/** Every frame's cars at one moment (the sim runs them on one thread), in ring metres. */
const ringsNow = (page: Page, ids: string[]) =>
  page.evaluate((list) => {
    const out: Record<
      string,
      {
        length: number;
        ring: { id: number; x: number }[];
        host: string | null;
        hosting: boolean;
        mode: string | null;
      }
    > = {};
    for (const id of list) {
      const w = document.querySelector<HTMLIFrameElement>(
        `.sim-frame[data-frame="${id}"] iframe`,
      )?.contentWindow;
      const st = w?.__traffic?.state() as
        | {
            length: number;
            ring: { id: number; x: number }[];
            host: string | null;
            hosting: boolean;
            mode?: string;
          }
        | undefined;
      if (st) {
        out[id] = {
          length: st.length,
          ring: st.ring.map((c) => ({ id: c.id, x: c.x })),
          host: st.host,
          hosting: st.hosting,
          mode: st.mode ?? null,
        };
      }
    }
    return out;
  }, ids);

/** The worst disagreement between frames about where any car is, venue px on a panel. */
const disagreement = (rings: Awaited<ReturnType<typeof ringsNow>>, ids: string[]) => {
  const ref = rings[ids[0]!]!;
  const L = ref.length;
  const pxPerM = (1080 * ids.length) / L;
  let worst = 0;
  for (const id of ids.slice(1)) {
    for (const c of rings[id]?.ring ?? []) {
      const o = ref.ring.find((x) => x.id === c.id);
      if (!o) continue;
      let d = Math.abs(o.x - c.x);
      d = Math.min(d, L - d);
      worst = Math.max(worst, d * pxPerM);
    }
  }
  return worst;
};

test.describe("traffic in a bank", () => {
  test.describe.configure({ timeout: 240_000 });

  test("traffic: every panel shows its stretch of one ring, lined up with 300 ms of delay", async ({
    page,
  }) => {
    const problems = watchPage(page);
    const all = ["a-screen", ...PANELS];
    await openSim(page, "preset=bank&count=4&span=1", all);
    await expect
      .poll(
        async () => (await inFrame(page, "a-screen", () => window.__traffic!.state())).hosting,
        {
          timeout: 20_000,
        },
      )
      .toBe(true);
    await page.waitForTimeout(2000);
    let worst = 0;
    for (let i = 0; i < 6; i++) {
      worst = Math.max(worst, disagreement(await ringsNow(page, PANELS), PANELS));
      await page.waitForTimeout(250);
    }
    expect(worst).toBeLessThan(3);

    await inFrame(page, "a-screen", (ms: number) => window.__traffic!.setLag(ms), 300);
    await expect
      .poll(async () => (await inFrame(page, "a-p2", () => window.__traffic!.state())).delay, {
        timeout: 20_000,
      })
      .toBeGreaterThan(340);
    await page.waitForTimeout(2500);
    worst = 0;
    for (let i = 0; i < 12; i++) {
      worst = Math.max(worst, disagreement(await ringsNow(page, PANELS), PANELS));
      await page.waitForTimeout(300);
    }
    test.info().annotations.push({
      type: "edges",
      description: `frames disagree about a car by at most ${worst.toFixed(1)} venue px with 300 ms added`,
    });
    // A car is 120 venue px long; a few px at a bezel doesn't show.
    expect(worst).toBeLessThan(6);
    expect.soft(problems).toEqual([]);
  });

  test("traffic: a tap on a panel brakes that car on the host, and its neighbours see it", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openSim(page, "preset=bank&count=4&span=1", ["a-screen", ...PANELS]);
    await page.waitForTimeout(4000);
    const p2 = await simFrame(page, "a-p2");
    const st = await state(p2);
    expect(st.mode).toBe("bank");
    expect(st.host).not.toBeNull();
    const car = middleCar(st);
    await tap(p2, { x: car.x + 20, y: car.y });
    const onScreen = async () =>
      (
        (await inFrame(page, "a-screen", () => window.__traffic!.state())) as unknown as ScreenState
      ).ring.find((c) => c.id === car.id)!;
    await expect
      .poll(async () => (await onScreen()).flags & FLAG.touched, { timeout: 3000 })
      .not.toBe(0);
    await expect.poll(async () => (await onScreen()).v, { timeout: 5000 }).toBeLessThan(1);
    // The car behind it, on this panel or the one before, brakes too.
    await expect
      .poll(
        async () => {
          const ring = (
            (await inFrame(page, "a-p1", () => window.__traffic!.state())) as FrameState
          ).ring;
          const sorted = [...ring].sort((a, b) => a.x - b.x);
          const i = sorted.findIndex((c) => c.id === car.id);
          return sorted[(i - 1 + sorted.length) % sorted.length]!.v;
        },
        { timeout: 6000 },
      )
      .toBeLessThan(2);
    expect.soft(problems).toEqual([]);
  });

  test("traffic: when the screen goes, a panel hosts within 3 s and the road keeps going", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openSim(page, "preset=bank&count=4&span=1", ["a-screen", ...PANELS]);
    await page.waitForTimeout(4000);
    const ids = (await ringsNow(page, PANELS))["a-p3"]!.ring.map((c) => c.id).sort();
    const removed = await page.evaluate(() => {
      document.querySelector('.sim-frame[data-frame="a-screen"] iframe')?.remove();
      return performance.now();
    });
    // Watch a panel's cars every 100 ms: they keep moving, without jumps.
    let last = (await ringsNow(page, ["a-p3"]))["a-p3"]!;
    let lastAt = removed;
    let worstJump = 0;
    let stoodStill = 0;
    let hostedAt: number | null = null;
    while (true) {
      await page.waitForTimeout(100);
      const [now, rings] = await Promise.all([
        page.evaluate(() => performance.now()),
        ringsNow(page, PANELS),
      ]);
      const r = rings["a-p3"]!;
      const L = r.length;
      let moved = 0;
      for (const c of r.ring) {
        const o = last.ring.find((x) => x.id === c.id);
        if (!o) continue;
        let d = c.x - o.x;
        if (d < -L / 2) d += L;
        // Fastest a car can go is under 20 m/s of ring time: 30 m a second.
        worstJump = Math.max(worstJump, Math.abs(d) - (30 * (now - lastAt)) / 1000);
        moved = Math.max(moved, d);
      }
      if (moved < 0.01) stoodStill++;
      last = r;
      lastAt = now;
      if (hostedAt === null && PANELS.some((id) => rings[id]?.hosting)) hostedAt = now - removed;
      if (now - removed > 6000) break;
    }
    test.info().annotations.push({
      type: "handover",
      description: `a panel hosted ${Math.round(hostedAt ?? -1)} ms after the screen went; worst jump ${worstJump.toFixed(2)} m`,
    });
    expect(hostedAt).not.toBeNull();
    expect(hostedAt!).toBeLessThan(3000);
    expect(stoodStill).toBeLessThan(3);
    expect(worstJump).toBeLessThan(2);
    const rings = await ringsNow(page, PANELS);
    expect(PANELS.filter((id) => rings[id]!.hosting)).toEqual(["a-p1"]);
    for (const id of PANELS) {
      expect(rings[id]!.mode).toBe("bank");
      expect(rings[id]!.ring.map((c) => c.id).sort()).toEqual(ids);
    }
    expect.soft(problems).toEqual([]);
  });

  test("traffic: with the circle, the screen draws every car round it where the panels have it", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openSim(page, "preset=bank&count=4&span=1&o.road=circle", ["a-screen", ...PANELS]);
    const screen = () =>
      inFrame(page, "a-screen", () => window.__traffic!.state()) as unknown as Promise<ScreenState>;
    await expect.poll(async () => (await screen()).hosting, { timeout: 20_000 }).toBe(true);
    await page.waitForTimeout(2000);
    // One moment for the screen and the panels (the sim runs them on one thread).
    const [st, panels] = await Promise.all([
      screen(),
      page.evaluate((list) => {
        const out: Record<string, { kind: string; circle: unknown; cars: DrawnCar[] }> = {};
        for (const id of list) {
          const w = document.querySelector<HTMLIFrameElement>(
            `.sim-frame[data-frame="${id}"] iframe`,
          )?.contentWindow;
          const s = w?.__traffic?.state() as unknown as FrameState | undefined;
          if (s) out[id] = { kind: s.layout.kind, circle: s.layout.circle, cars: s.cars };
        }
        return out;
      }, PANELS),
    ]);
    const circle = st.circle!;
    expect(circle).not.toBeNull();
    // The circle sits above the diagram, which still spans the screen.
    expect(circle.cy + circle.r).toBeLessThan(st.diagram.y);
    expect(st.diagram.x).toBe(0);
    expect(st.ring.length).toBeGreaterThanOrEqual(8);
    // Every car is drawn, round the circle, at its place on the ring.
    expect(st.drawn.map((c) => c.id).sort()).toEqual(st.ring.map((c) => c.id).sort());
    for (const c of st.ring) {
      const d = st.drawn.find((x) => x.id === c.id)!;
      const p = onCircle(circle, (c.x + 2.25) / st.length);
      expect(Math.hypot(d.x - p.x, d.y - p.y)).toBeLessThan(2);
    }
    // The panels keep their straight stretches, and a car on panel k of 4 is on the circle's
    // stretch for that share of the ring: panel 1 from the top down the left, and so on.
    for (const [k, id] of PANELS.entries()) {
      const p = panels[id]!;
      expect(p.kind).toBe("stretch");
      expect(p.circle).toBeNull();
      for (const c of p.cars) {
        if (c.x < 60 || c.x > 1020) continue;
        const f = (c.ringX + 2.25) / st.length;
        expect(f).toBeGreaterThanOrEqual(k / 4 - 0.01);
        expect(f).toBeLessThan((k + 1) / 4 + 0.01);
      }
    }
    expect.soft(problems).toEqual([]);
  });
});

test.describe("traffic in versus", () => {
  test.describe.configure({ timeout: 240_000 });

  test("traffic: both walls run the same ring, and a slowdown thrown at one lands on the other", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openSim(page, "preset=versus", ["a-wall", "b-wall"]);
    const vs = (id: string) =>
      inFrame(page, id, () => window.__traffic!.state()) as unknown as Promise<VersusState>;
    await expect
      .poll(async () => [(await vs("a-wall")).phantom, (await vs("b-wall")).phantom], {
        timeout: 20_000,
      })
      .toEqual([false, false]);
    const a = await vs("a-wall");
    const b = await vs("b-wall");
    expect(a.round).toBe(b.round);
    expect(a.seed).toBe(b.seed);
    // Slowdowns only fly while a round runs: wait out the break if we are in one.
    await expect
      .poll(
        async () => {
          const st = (await vs("a-wall")) as VersusState & { roundEnd: number; clock: number };
          return st.roundEnd - st.clock;
        },
        { timeout: 30_000, intervals: [500] },
      )
      .toBeGreaterThan(12_000);
    const landed = (await vs("b-wall")).landed;
    const wall = await simFrame(page, "a-wall");
    // Two buttons, in case the attract hand just used one and it is recharging.
    for (const button of a.slowdowns.slice(1, 3)) {
      await tap(wall, { x: button.x + button.width / 2, y: button.y + button.height / 2 });
    }
    await expect
      .poll(async () => (await vs("a-wall")).thrown, { timeout: 3000 })
      .toBeGreaterThan(0);
    // It lands on B, where a car brakes for it (gently, for under a second, so look often).
    await expect
      .poll(async () => (await vs("b-wall")).ring.some((c) => c.mark === 1), {
        timeout: 6000,
        intervals: [100],
      })
      .toBe(true);
    expect((await vs("b-wall")).landed).toBeGreaterThan(landed);
    // Each wall knows the other's score.
    await expect
      .poll(async () => {
        const [x, y] = [await vs("a-wall"), await vs("b-wall")];
        // Scores are thousandths of car time moving, sent once a second.
        return x.theirRound === x.round && Math.abs(x.theirs - y.ours) <= 40;
      })
      .toBe(true);
    expect.soft(problems).toEqual([]);
  });
});
