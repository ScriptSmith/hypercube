import { expect, type Page, test } from "@playwright/test";
import { watchPage } from "../scripts/lib/play.mjs";

/**
 * Fireworks across frames in the simulator, with the local transport: launches climbing from a
 * panel onto the screen, shells crossing the corner, the corner screens' shared show, and panels
 * falling back to their own skies when their screen goes. Headless WebGL is slow and the sim runs
 * every frame in one process, so timings here are generous.
 */

const SETTLE_MS = 90_000;

interface Shell {
  seed: number;
  x: number;
  y: number;
  t0: number;
  tb: number;
  ghost: boolean;
  shared: boolean;
  own: boolean;
}
interface Burst {
  seed: number;
  x: number;
  y: number;
  t0: number;
}
interface Pad {
  tube: { x: number; base: number; length: number };
  size: { x: number; y: number } | null;
  aim: { cx: number; cy: number; r: number; max: number } | null;
}
interface Seen {
  kind: "shell" | "burst";
  seed: number;
  shared: boolean;
  own: boolean;
  x: number;
  t0: number;
}
interface FwState {
  mode: string;
  shells: Shell[];
  bursts: Burst[];
  pads: Pad[];
  arrivals: { seed: number; late: number; exit: number }[];
  modeAt: number;
  partner: string | null;
  history: Seen[];
  clock: number;
}

declare global {
  interface Window {
    __fireworks?: { state(): FwState; setLag(ms: number): void };
  }
}

const openSim = async (page: Page, preset: string) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`sim/?preset=${preset}&app=fireworks&transport=local&seed=e2e&debug=1&res=0.25`);
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

const state = (page: Page, id: string) => inFrame(page, id, () => window.__fireworks!.state());

/** A finger along `path` (venue px) on a frame, as real pointer events. */
const touch = (page: Page, id: string, path: { x: number; y: number }[], ms = 120) =>
  inFrame(
    page,
    id,
    async ({ path: pts, ms: total }) => {
      const stage = document.querySelector<HTMLElement>(".hc-stage")!;
      const r = stage.getBoundingClientRect();
      const scale = (window.__hypercube?.frame?.unit ?? 1) * (r.width / stage.offsetWidth);
      const at = (p: { x: number; y: number }) => ({
        clientX: r.left + p.x * scale,
        clientY: r.top + p.y * scale,
      });
      const pointerId = 7000 + Math.floor(Math.random() * 1000);
      const fire = (type: string, p: { x: number; y: number }) => {
        const c = at(p);
        (document.elementFromPoint(c.clientX, c.clientY) ?? stage).dispatchEvent(
          new PointerEvent(type, {
            ...c,
            pointerId,
            pointerType: "touch",
            bubbles: true,
            isPrimary: true,
          }),
        );
      };
      fire("pointerdown", pts[0]!);
      for (const p of pts.slice(1)) {
        await new Promise((res) => setTimeout(res, total / pts.length));
        fire("pointermove", p);
      }
      await new Promise((res) => setTimeout(res, 20));
      fire("pointerup", pts.at(-1)!);
    },
    { path, ms },
  );

const tapTube = async (page: Page, id: string) => {
  const pad = (await state(page, id)).pads[0]!;
  const p = { x: pad.tube.x, y: pad.tube.base - pad.tube.length * 0.4 };
  await touch(page, id, [p, p], 40);
};

test.describe("fireworks in the simulator", () => {
  test.describe.configure({ timeout: 180_000 });

  test("a shell climbs from a panel onto the screen, with 300 ms of extra delay", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openSim(page, "bank-panels");
    const panels = Array.from({ length: 6 }, (_, i) => `a-p${i + 1}`);
    for (const id of panels)
      await inFrame(page, id, (ms: number) => window.__fireworks!.setLag(ms), 300);
    await expect
      .poll(async () => (await state(page, "a-p4")).mode, { timeout: 20_000 })
      .toBe("screen");

    await tapTube(page, "a-p4");
    let ghost: Shell | undefined;
    await expect
      .poll(async () => {
        ghost = (await state(page, "a-p4")).shells.find((s) => s.ghost);
        return ghost !== undefined;
      })
      .toBe(true);
    const seed = ghost!.seed;
    let arrival: FwState["arrivals"][number] | undefined;
    await expect
      .poll(async () => {
        arrival = (await state(page, "a-screen")).arrivals.find((a) => a.seed === seed);
        return arrival !== undefined;
      })
      .toBe(true);
    test.info().annotations.push({
      type: "arrival",
      description: `${arrival!.late.toFixed(0)} ms after launch; the shell leaves the panel at ${arrival!.exit.toFixed(0)} ms`,
    });
    // On a loaded machine the sim's own timers run late, so this is soft.
    expect
      .soft(arrival!.late, "launch reached the screen before the shell left the panel")
      .toBeLessThan(arrival!.exit);

    // Both frames fly the same path: it starts from the same place on both.
    const [hp, hs] = await Promise.all([state(page, "a-p4"), state(page, "a-screen")]);
    const fromPanel = hp.history.find((x) => x.kind === "shell" && x.own && x.seed === seed);
    const onScreen = hs.history.find((x) => x.kind === "shell" && x.seed === seed);
    expect(onScreen, "the screen holds the shell").toBeDefined();
    expect(Math.abs(fromPanel!.x - onScreen!.x)).toBeLessThan(2);
    expect(Math.abs(fromPanel!.t0 - onScreen!.t0)).toBeLessThan(2);
    await expect
      .poll(
        async () =>
          (await state(page, "a-screen")).history.some(
            (x) => x.kind === "burst" && x.seed === seed,
          ),
        { timeout: 30_000 },
      )
      .toBe(true);
    expect.soft(problems).toEqual([]);
  });

  test("shells cross the corner and both screens play the show in step", async ({ page }) => {
    const problems = watchPage(page);
    await openSim(page, "corner");
    await expect
      .poll(async () => (await state(page, "a-screen")).partner, { timeout: 30_000 })
      .toBe("b-screen");
    await expect
      .poll(async () => (await state(page, "a-p6")).mode, { timeout: 30_000 })
      .toBe("screen");

    // Show in step: the bursts near the corner over a few seconds are the same on both screens.
    await page.waitForTimeout(9000);
    const clock = await inFrame(page, "a-screen", () => window.__fireworks!.state().clock);
    const near = (h: Seen[]) =>
      h
        .filter(
          (x) =>
            x.kind === "burst" && Math.abs(x.x) < 600 && x.t0 > clock - 8000 && x.t0 < clock - 1500,
        )
        .map((x) => `${x.seed}@${Math.round(x.t0)}`)
        .sort();
    const [ha, hb] = await Promise.all([state(page, "a-screen"), state(page, "b-screen")]);
    test.info().annotations.push({
      type: "show",
      description: `${near(ha.history).length} bursts near the corner on a, ${near(hb.history).length} on b`,
    });
    expect(near(ha.history)).toEqual(near(hb.history));

    // The corner panel on side a, aimed hard right.
    const pad = (await state(page, "a-p6")).pads[0]!;
    const aim = pad.aim!;
    const k0 = { x: aim.cx, y: aim.cy - aim.r };
    const k1 = { x: aim.cx + aim.r * Math.sin(aim.max), y: aim.cy - aim.r * Math.cos(aim.max) };
    await touch(page, "a-p6", [k0, k1, k1], 150);
    await tapTube(page, "a-p6");
    let seed = -1;
    await expect
      .poll(
        async () => {
          seed =
            (await state(page, "a-p6")).history.find((x) => x.kind === "shell" && x.own)?.seed ??
            -1;
          return seed;
        },
        { timeout: 20_000 },
      )
      .not.toBe(-1);
    // Side b holds the shell before it gets there, and both burst it in the same place.
    await expect
      .poll(
        async () =>
          (await state(page, "b-screen")).history.some(
            (x) => x.kind === "shell" && x.seed === seed && x.shared,
          ),
        { timeout: 30_000 },
      )
      .toBe(true);
    let pair: Seen[] = [];
    await expect
      .poll(
        async () => {
          const [sa, sb] = await Promise.all([state(page, "a-screen"), state(page, "b-screen")]);
          pair = [sa, sb].flatMap((st) =>
            st.history.filter((x) => x.kind === "burst" && x.seed === seed),
          );
          return pair.length;
        },
        { timeout: 30_000 },
      )
      .toBe(2);
    expect(Math.abs(pair[0]!.x - pair[1]!.x)).toBeLessThan(20);
    expect(Math.abs(pair[0]!.t0 - pair[1]!.t0)).toBeLessThan(20);
    expect(pair[0]!.x, "it burst over side b").toBeGreaterThan(0);
    expect.soft(problems).toEqual([]);
  });

  test("panels fall back to their own skies when their screen goes", async ({ page }) => {
    await openSim(page, "bank-panels");
    await expect
      .poll(async () => (await state(page, "a-p1")).mode, { timeout: 20_000 })
      .toBe("screen");
    const removed = await page.evaluate(() => {
      const t = Date.now();
      document.querySelector('.sim-frame[data-frame="a-screen"] iframe')?.remove();
      return t;
    });
    const panels = ["a-p1", "a-p3", "a-p6"];
    for (const id of panels) {
      await expect
        .poll(async () => (await state(page, id)).mode, { timeout: 15_000 })
        .toBe("local");
    }
    const took = await Promise.all(
      panels.map(async (id) => (await state(page, id)).modeAt - removed),
    );
    test.info().annotations.push({ type: "fallback", description: `${took.join(", ")} ms` });
    // The aim is 3 s, which the sim meets when the machine isn't loaded. The bound here
    // still catches waiting for the hub to drop a silent member (about 7 s).
    for (const ms of took) expect(ms).toBeLessThan(5000);
    // And the sky is the panel's own now: a launch bursts on it.
    const before = new Set((await state(page, "a-p5")).shells.map((s) => s.seed));
    await tapTube(page, "a-p5");
    let seed = -1;
    await expect
      .poll(async () => {
        const mine = (await state(page, "a-p5")).shells.find(
          (s) => !before.has(s.seed) && s.own && !s.ghost,
        );
        seed = mine?.seed ?? -1;
        return seed;
      })
      .not.toBe(-1);
    await expect
      .poll(async () => (await state(page, "a-p5")).bursts.some((b) => b.seed === seed), {
        timeout: 10_000,
      })
      .toBe(true);
  });
});
