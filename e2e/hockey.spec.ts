import { expect, type Page, test } from "@playwright/test";
import { watchPage } from "../scripts/lib/play.mjs";

/**
 * Versus hockey in the simulator, with the local transport: two walls side by side (side a on
 * the left) hold the two ends of one table, and a puck leaving one slides straight onto the
 * other through the join, at the same height and moving the same way, with extra network delay
 * added by the app's debug hook. Headless WebGL is slow and the sim runs every frame in one
 * process, so timings here are generous.
 */

const SETTLE_MS = 90_000;
const FRAMES = ["a-wall", "b-wall"] as const;

interface Crossing {
  kind: "out" | "in";
  id: number;
  t: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  cap: number;
  top: number;
  height: number;
  depth: number;
}

interface HkState {
  side: number;
  clock: number;
  lag: number;
  crossings: Crossing[];
}

declare global {
  interface Window {
    __hockey?: { state(): HkState; setLag(ms: number): void };
  }
}

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

const state = (page: Page, id: string) => inFrame(page, id, () => window.__hockey?.state() ?? null);

/** Where a puck crossing the end at (y, vy) is `t` seconds on, bouncing off the side rims. */
const glideY = (c: Crossing, t: number) => {
  const span = c.height - 2 * c.r;
  const u = (((c.y - c.top - c.r + c.vy * t) % (2 * span)) + 2 * span) % (2 * span);
  return c.top + c.r + (u <= span ? u : 2 * span - u);
};

/** Each puck leaving one wall, paired with its entry on the other (the clocks agree to a few ms). */
const pairUp = (outs: Crossing[], ins: Crossing[]) =>
  outs.flatMap((out) => {
    const next = ins.find((c) => c.id === out.id && c.t > out.t - 50 && c.t - out.t < 1500);
    return next ? [{ out, in: next }] : [];
  });

test.describe("hockey versus in the simulator", () => {
  test.describe.configure({ timeout: 300_000 });

  test("a puck leaving one wall slides straight onto the other, at 0, 100 and 300 ms of delay", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(
      `sim/?preset=versus&app=hockey&transport=local&bots=2&seed=e2e&debug=1&res=0.25`,
    );
    await page.waitForFunction(() => window.__hypercubeSim !== undefined);
    await expect
      .poll(
        async () => {
          const s = await Promise.all(FRAMES.map((id) => state(page, id)));
          return s.every((x) => x !== null);
        },
        { timeout: SETTLE_MS, intervals: [500] },
      )
      .toBe(true);

    const notes: string[] = [];
    for (const lag of [0, 100, 300]) {
      for (const id of FRAMES)
        await inFrame(page, id, (ms: number) => window.__hockey!.setLag(ms), lag);
      // Crossings from now on, both ways.
      const since = Math.max(
        ...(await Promise.all(FRAMES.map(async (id) => (await state(page, id))!.clock))),
      );
      let pairs: ReturnType<typeof pairUp> = [];
      await expect
        .poll(
          async () => {
            const [a, b] = await Promise.all(FRAMES.map((id) => state(page, id)));
            const fresh = (s: HkState | null, kind: "out" | "in") =>
              (s?.crossings ?? []).filter((c) => c.kind === kind && c.t > since);
            pairs = [
              ...pairUp(fresh(a!, "out"), fresh(b!, "in")),
              ...pairUp(fresh(b!, "out"), fresh(a!, "in")),
            ];
            return pairs.length;
          },
          { timeout: 120_000, intervals: [1000] },
        )
        .toBeGreaterThanOrEqual(6);

      let exact = 0;
      let late = 0;
      const waits: number[] = [];
      const hidden: number[] = [];
      for (const { out, in: inc } of pairs) {
        const speed = Math.max(Math.abs(out.vx), 0.05 * out.cap);
        // The same way, at the same speed.
        expect(Math.sign(inc.vx)).toBe(Math.sign(out.vx));
        expect(Math.abs(inc.vx) / speed).toBeCloseTo(1, 2);
        // Into the other wall's open end, which meets this one's: side a's right edge is side
        // b's left edge, so the puck is as far into b as it was past a's edge.
        const dt = (inc.t - out.t) / 1000;
        const truth = -out.depth * out.r + speed * dt;
        const wait = inc.t - out.t;
        waits.push(wait);
        hidden.push(Math.max(0, wait - ((out.depth * out.r + out.r) / speed) * 1000));
        expect(inc.depth).toBeGreaterThanOrEqual(-1.001);
        expect(inc.depth).toBeLessThanOrEqual(1.001);
        if (Math.abs(inc.depth * inc.r - truth) < out.r * 0.25) exact++;
        if (inc.depth < -0.999) late++;
        // On the path it left on: the same height at the join.
        const at = (inc.depth * inc.r + out.depth * out.r) / speed;
        expect(Math.abs(inc.y - glideY(out, at))).toBeLessThan(2);
        // No hang beyond the delay (the sim's timers run late under load).
        expect(wait).toBeLessThan(lag + 400);
      }
      // Without added delay the receiver mostly takes the puck where the sender still shows it.
      if (lag === 0) expect.soft(exact / pairs.length).toBeGreaterThanOrEqual(0.5);
      waits.sort((p, q) => p - q);
      hidden.sort((p, q) => p - q);
      const med = (xs: number[]) => xs[Math.floor(xs.length / 2)] ?? NaN;
      notes.push(
        `${lag} ms: ${pairs.length} crossings, ${exact} picked up where the sender still showed it, ${late} slid in from the edge; ` +
          `exit to entry median ${med(waits).toFixed(0)} ms, hidden at the join median ${med(hidden).toFixed(0)} ms, max ${(hidden.at(-1) ?? 0).toFixed(0)} ms`,
      );
    }
    test.info().annotations.push({ type: "crossings", description: notes.join("\n") });
    expect.soft(problems).toEqual([]);
  });
});
