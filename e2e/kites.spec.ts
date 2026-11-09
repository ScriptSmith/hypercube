import { expect, type Frame, type Page, test } from "@playwright/test";
import { watchPage } from "../scripts/lib/play.mjs";

/**
 * Kites: the spool held, let go and tapped on real pointer events, the stunt bar, hold-to-reset,
 * idle, bots on a wall flying without jitter, live wind (with Open-Meteo answered or refused by
 * the test, never the network), and a bank in the simulator: kites on the screen above their
 * panels, a held spool sending its kite up on the panel and the screen, lines that stay joined at
 * the panels' top edges with 300 ms of extra delay, and panels drawing their own sky when the
 * screen goes.
 */

interface GripState {
  x: number;
  restY: number;
  travel: number;
  w: number;
  h: number;
  y: number;
}
interface ButtonState {
  x: number;
  y: number;
  r: number;
  held: boolean;
  reeling: boolean;
}
interface PatchState {
  cx: number;
  modes: { spool: "auto" | "people"; stunt: "auto" | "people" };
  reset: { x: number; y: number; r: number };
  button: ButtonState;
  grips: { left: GripState | null; right: GripState | null };
  spool: {
    x: number;
    y: number;
    length: number;
    col: [number, number];
    tangled: boolean;
    sparkle: boolean;
  };
  stunt: {
    x: number;
    y: number;
    heading: number;
    speed: number;
    phase: string;
    parked: number;
  } | null;
}
interface FrameState {
  screen: false;
  mode: "bank" | "local";
  modeAt: number;
  unit: number;
  delay: number;
  exits: number[];
  drawExits: number[];
  counts: { flown: number; rings: number; tangles: number };
  wind: { source: string; speed: number };
  attribution: string | null;
  gusts: number;
  patches: PatchState[];
}
interface ScreenKite {
  key: string;
  kind: "spool" | "stunt";
  x: number;
  y: number;
  alpha: number;
  glow: boolean;
  starts: { x: number; y: number }[];
}
interface ScreenState {
  screen: true;
  demo: boolean;
  delay: number;
  width: number;
  height: number;
  frames: { frame: string; pos: number; count: number }[];
  kites: ScreenKite[];
}

declare global {
  interface Window {
    __kites?: {
      state(): FrameState | ScreenState;
      setLag?(ms: number): void;
      command(name: string): void;
    };
  }
}

const SIZES: Record<"pair" | "wall" | "panel", [number, number]> = {
  pair: [2160, 1920],
  wall: [5760, 2160],
  panel: [1080, 1920],
};

const open = async (
  page: Page,
  kind: keyof typeof SIZES,
  params: Record<string, string | number> = {},
) => {
  const [w, h] = SIZES[kind];
  const scale = Math.min(1000 / w, 800 / h);
  await page.setViewportSize({ width: Math.round(w * scale), height: Math.round(h * scale) });
  const q = new URLSearchParams({
    app: "kites",
    kind,
    fit: `${w}x${h}`,
    bots: "0",
    seed: "e2e",
    debug: "1",
  });
  for (const [k, v] of Object.entries(params)) q.set(k, String(v));
  await page.goto(`play/?${q}`);
  await page.waitForFunction(() => window.__kites !== undefined, undefined, { timeout: 30_000 });
};

const state = (page: Page) => page.evaluate(() => window.__kites!.state() as FrameState);

/**
 * A finger at a venue point, as real pointer events, in a page or a sim frame. Returns helpers to
 * move and lift it.
 */
const finger = async (page: Page | Frame, at: { x: number; y: number }) => {
  const id = await page.evaluate((p) => {
    const st = window.__kites!.state() as FrameState;
    const stage = document.querySelector<HTMLElement>(".hc-stage")!;
    const r = stage.getBoundingClientRect();
    const k = st.unit * (r.width / stage.offsetWidth);
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
    (window as unknown as Record<string, unknown>)[`__kf${pointerId}`] = {
      k,
      left: r.left,
      top: r.top,
      target,
    };
    return pointerId;
  }, at);
  const fire = (type: string, p: { x: number; y: number } | null) =>
    page.evaluate(
      ([pointerId, t, pt]) => {
        const f = (
          window as unknown as Record<
            string,
            { k: number; left: number; top: number; target: Element }
          >
        )[`__kf${pointerId}`]!;
        const clientX = pt ? f.left + pt.x * f.k : 0;
        const clientY = pt ? f.top + pt.y * f.k : 0;
        const el = t === "pointermove" ? window : f.target;
        el.dispatchEvent(
          new PointerEvent(t as string, {
            clientX,
            clientY,
            pointerId: pointerId as number,
            pointerType: "touch",
            bubbles: true,
          }),
        );
      },
      [id, type, p] as const,
    );
  return {
    move: (p: { x: number; y: number }) => fire("pointermove", p),
    up: (p: { x: number; y: number }) => fire("pointerup", p),
  };
};

/** Hold the spool button for `ms`, then let go. */
const hold = async (page: Page | Frame, b: ButtonState, ms: number) => {
  const f = await finger(page, { x: b.x, y: b.y });
  await new Promise((r) => setTimeout(r, ms));
  await f.up({ x: b.x, y: b.y });
};

/**
 * In the page, for `secs`: how often each patch's stunt handles and stunt kite turn back, a
 * second, sampled every frame (handles by 3 % of their travel, the heading by 0.05 rad).
 */
const sampleJitter = (secs: number) =>
  new Promise<{ handle: number; heading: number }[]>((done) => {
    const zigzags = (xs: number[], eps: number) => {
      let n = 0;
      let dir = 0;
      let hi = xs[0] ?? 0;
      let lo = hi;
      for (const x of xs) {
        if (dir === 0) {
          hi = Math.max(hi, x);
          lo = Math.min(lo, x);
          if (x < hi - eps) [dir, lo] = [-1, x];
          else if (x > lo + eps) [dir, hi] = [1, x];
        } else if (dir > 0) {
          if (x > hi) hi = x;
          else if (x < hi - eps) [n, dir, lo] = [n + 1, -1, x];
        } else if (x < lo) lo = x;
        else if (x > lo + eps) [n, dir, hi] = [n + 1, 1, x];
      }
      return n;
    };
    type P = {
      grips: { left: { restY: number; travel: number; y: number } | null };
      stunt: { heading: number } | null;
    };
    const runs: { handle: number[]; heading: number[]; last: number; turned: number }[] = [];
    const t0 = performance.now();
    const tick = () => {
      const st = (window.__kites!.state() as unknown as { patches: P[] }).patches;
      st.forEach((p, i) => {
        if (!p.stunt || !p.grips.left) return;
        const g = p.grips.left;
        const r = (runs[i] ??= { handle: [], heading: [], last: p.stunt.heading, turned: 0 });
        let d = p.stunt.heading - r.last;
        if (d > Math.PI) d -= 2 * Math.PI;
        if (d < -Math.PI) d += 2 * Math.PI;
        r.turned += d;
        r.last = p.stunt.heading;
        r.handle.push((g.y - g.restY) / g.travel);
        r.heading.push(r.turned);
      });
      if (performance.now() - t0 < secs * 1000) requestAnimationFrame(tick);
      else
        done(
          runs.map((r) => ({
            handle: zigzags(r.handle, 0.03) / secs,
            heading: zigzags(r.heading, 0.05) / secs,
          })),
        );
    };
    requestAnimationFrame(tick);
  });

test.describe("kites", () => {
  test.describe.configure({ timeout: 120_000 });

  test("the first touch takes the spool from the autopilot; held, its kite climbs, let go, it sinks", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await open(page, "panel");
    let st = await state(page);
    expect(st.mode).toBe("local");
    expect(st.patches[0]!.modes.spool).toBe("auto");
    const b = st.patches[0]!.button;
    await hold(page, b, 50);
    st = await state(page);
    expect(st.patches[0]!.modes.spool).toBe("people");
    expect((await page.evaluate(() => window.__hypercube!.appStatus())).flown).toBe(1);
    // Let it settle low with nobody holding first.
    await expect
      .poll(async () => (await state(page)).patches[0]!.spool.y, { timeout: 20_000 })
      .toBeLessThan(0.3);
    await page.waitForTimeout(1000);
    const rest = (await state(page)).patches[0]!.spool.y;

    // Held: it reels in and climbs at once.
    const f = await finger(page, { x: b.x, y: b.y });
    await page.waitForTimeout(400);
    let now = (await state(page)).patches[0]!;
    expect(now.button.held).toBe(true);
    expect(now.button.reeling).toBe(true);
    expect(now.spool.y).toBeGreaterThan(rest + 0.03);
    await page.waitForTimeout(2600);
    now = (await state(page)).patches[0]!;
    expect(now.spool.y).toBeGreaterThan(rest + 0.4);
    const high = now.spool.y;
    await f.up({ x: b.x, y: b.y });

    // Let go: it drifts down slowly, then hovers low.
    await page.waitForTimeout(1000);
    now = (await state(page)).patches[0]!;
    expect(now.button.reeling).toBe(false);
    expect(now.spool.y).toBeLessThan(high);
    expect(now.spool.y).toBeGreaterThan(high - 0.25);
    await expect
      .poll(async () => (await state(page)).patches[0]!.spool.y, { timeout: 20_000 })
      .toBeLessThan(rest + 0.05);

    // A tap gives a short hop.
    const before = (await state(page)).patches[0]!.spool.y;
    await hold(page, b, 60);
    const ys: number[] = [];
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(100);
      ys.push((await state(page)).patches[0]!.spool.y);
    }
    expect(Math.max(...ys)).toBeGreaterThan(before + 0.04);
    expect(Math.max(...ys)).toBeLessThan(before + 0.3);
    expect(problems).toEqual([]);
  });

  test("the lower stunt handle turns the kite that way; let go, it parks at the top", async ({
    page,
  }) => {
    await open(page, "pair");
    const p = (await state(page)).patches[0]!;
    const left = p.grips.left!;
    const right = p.grips.right!;
    // The autopilot may have the handles part way down: take them where they are, push the
    // right one up to rest and pull the left one all the way down.
    const fl = await finger(page, { x: left.x, y: left.y });
    const fr = await finger(page, { x: right.x, y: right.y });
    await fr.move({ x: right.x, y: right.restY - 200 });
    await fl.move({ x: left.x, y: left.restY + left.travel + 200 });
    await page.waitForTimeout(100);
    const now = (await state(page)).patches[0]!;
    expect(now.grips.left!.y).toBeCloseTo(left.restY + left.travel, 0);
    expect(now.grips.right!.y).toBeCloseTo(right.restY, 0);
    const headings: number[] = [];
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(100);
      headings.push((await state(page)).patches[0]!.stunt!.heading);
    }
    let turned = 0;
    for (let i = 1; i < headings.length; i++) {
      let d = headings[i]! - headings[i - 1]!;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      turned += d;
    }
    // Counterclockwise: towards the left.
    expect(turned).toBeGreaterThan(1);
    expect((await state(page)).patches[0]!.modes.stunt).toBe("people");
    await fl.up({ x: left.x, y: left.restY + left.travel });
    await fr.up({ x: right.x, y: right.restY });
    await expect
      .poll(async () => (await state(page)).patches[0]!.stunt!.parked, { timeout: 20_000 })
      .toBeGreaterThan(0.8);
  });

  test("hold-to-reset reels the kites in; idle hands them back to the autopilot", async ({
    page,
  }) => {
    await open(page, "panel", { idle: 8 });
    await hold(page, (await state(page)).patches[0]!.button, 2500);
    const before = (await state(page)).patches[0]!.spool.length;
    expect(before).toBeGreaterThan(0.4);
    const r = (await state(page)).patches[0]!.reset;
    const f = await finger(page, { x: r.x, y: r.y });
    await page.waitForTimeout(1300);
    await f.up({ x: r.x, y: r.y });
    const after = (await state(page)).patches[0]!;
    expect(after.spool.length).toBeLessThan(0.3);
    expect(after.modes.spool).toBe("people");
    await expect
      .poll(async () => (await state(page)).patches[0]!.modes.spool, { timeout: 30_000 })
      .toBe("auto");
  });

  test("bots fly a wall of six patches through the same grips", async ({ page }) => {
    const problems = watchPage(page);
    await open(page, "wall", { bots: 6 });
    const st = await state(page);
    expect(st.patches).toHaveLength(6);
    await expect
      .poll(
        async () => {
          const p = (await state(page)).patches;
          return p
            .slice(0, 3)
            .every((x) => x.modes.spool === "people" || x.modes.stunt === "people");
        },
        { timeout: 20_000 },
      )
      .toBe(true);
    await page.evaluate(() => window.__kites!.command("gust"));
    expect((await state(page)).gusts).toBe(1);
    const status = await page.evaluate(() => window.__hypercube!.appStatus());
    expect(status.kites).toBe(12);
    // Bots aren't people.
    expect(status.flying).toBe(0);
    expect(problems).toEqual([]);
  });

  test("bots and the autopilot fly stunt kites without jitter", async ({ page }) => {
    // Before the fix the handles turned back 2 to 11 times a second here; a figure eight turns
    // each one back about once a second.
    for (const [kind, bots] of [
      ["wall", 12],
      ["wall", 0],
      ["panel", 2],
    ] as const) {
      await open(page, kind, { bots });
      await page.waitForTimeout(3000);
      const runs = await page.evaluate(sampleJitter, 10);
      test.info().annotations.push({
        type: `jitter ${kind} bots=${bots}`,
        description: runs
          .map((r) => `handle ${r.handle.toFixed(2)}/s heading ${r.heading.toFixed(2)}/s`)
          .join("; "),
      });
      expect(runs.length).toBe(kind === "wall" ? 6 : 1);
      for (const r of runs) {
        expect(r.handle).toBeLessThan(1.8);
        expect(r.heading).toBeLessThan(1.4);
      }
    }
  });

  test("live wind shows its attribution, and falls back to breezy when the fetch fails", async ({
    page,
  }) => {
    let calls = 0;
    await page.route("https://api.open-meteo.com/**", (route) => {
      calls++;
      return route.fulfill({
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({
          current: { wind_speed_10m: 7.5, wind_gusts_10m: 12, wind_direction_10m: 260 },
        }),
      });
    });
    // A named frame (not a host's preview thumbnail, which never fetches), with no room.
    await open(page, "panel", { "o.wind": "live", frame: "e2e-panel" });
    await expect
      .poll(async () => (await state(page)).wind.source, { timeout: 15_000 })
      .toBe("live");
    const st = await state(page);
    expect(st.attribution).toBe("Weather data by Open-Meteo.com");
    expect(st.wind.speed).toBe(7.5);
    expect(calls).toBe(1);

    await page.unroute("https://api.open-meteo.com/**");
    await page.route("https://api.open-meteo.com/**", (route) => route.abort());
    await page.reload();
    await page.waitForFunction(() => window.__kites !== undefined);
    await page.waitForTimeout(2000);
    const failed = await state(page);
    expect(failed.wind.source).toContain("breezy");
    expect(failed.attribution).toBeNull();
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

const PANELS = ["a-p1", "a-p2", "a-p3", "a-p4"];

/** A sim frame's document, for fingers and sampling inside it. */
const simFrame = async (page: Page, id: string): Promise<Frame> => {
  const el = await page.$(`.sim-frame[data-frame="${id}"] iframe`);
  const frame = await el?.contentFrame();
  if (!frame) throw new Error(`no frame ${id}`);
  return frame;
};

const openBank = async (page: Page) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(
    "sim/?preset=bank&count=4&span=1&app=kites&transport=local&bots=2&seed=e2e&debug=1&res=0.25",
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
                w.__kites !== undefined,
            ) &&
            hubs.length === 1
          );
        }),
      { timeout: 120_000, intervals: [500] },
    )
    .toBe(true);
  await expect
    .poll(
      async () => {
        const st = (await inFrame(page, "a-screen", () => window.__kites!.state())) as ScreenState;
        return st.frames.length;
      },
      { timeout: 30_000 },
    )
    .toBe(4);
};

test.describe("kites in a bank", () => {
  test.describe.configure({ timeout: 240_000 });

  test("kites: every panel's kites fly over that panel, and lines stay joined with 300 ms of delay", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openBank(page);
    const frameIds = await Promise.all(
      PANELS.map((id) => inFrame(page, id, () => window.__hypercube!.identity!.frame)),
    );
    // Each panel's two kites are on the screen, their lines starting on the bottom edge above
    // that panel. (Polled: the screen's first drawing after the panels arrive may still be its own.)
    const columns = async () => {
      const screen = (await inFrame(page, "a-screen", () =>
        window.__kites!.state(),
      )) as ScreenState;
      return frameIds.map((frameId, i) => {
        const mine = screen.kites.filter((k) => k.key.startsWith(`${frameId}#`));
        const kinds = mine
          .map((k) => k.kind)
          .sort()
          .join(",");
        const inColumn = mine.every((k) =>
          k.starts.every(
            (s) =>
              s.x / screen.width >= i / 4 - 0.001 &&
              s.x / screen.width <= (i + 1) / 4 + 0.001 &&
              Math.abs(s.y - screen.height) < 1,
          ),
        );
        return `${kinds}${inColumn ? "" : " outside"}${screen.demo ? " demo" : ""}`;
      });
    };
    await expect.poll(columns, { timeout: 20_000 }).toEqual(PANELS.map(() => "spool,stunt"));

    for (const id of PANELS)
      await inFrame(page, id, (ms: number) => window.__kites!.setLag!(ms), 300);
    await expect
      .poll(
        async () =>
          ((await inFrame(page, "a-screen", () => window.__kites!.state())) as ScreenState).delay,
        {
          timeout: 20_000,
        },
      )
      .toBeGreaterThan(330);
    await page.waitForTimeout(3000);

    // Read the screen and every panel in one go (they share the sim's thread) and compare where
    // each line meets the panel's top edge, in bank fractions.
    let worst = 0;
    let naive = 0;
    for (let n = 0; n < 12; n++) {
      const r = await page.evaluate((ids) => {
        const win = (id: string) =>
          document.querySelector<HTMLIFrameElement>(`.sim-frame[data-frame="${id}"] iframe`)!
            .contentWindow!;
        const scr = win("a-screen").__kites!.state() as unknown as {
          width: number;
          kites: { key: string; starts: { x: number }[] }[];
        };
        const out: { joined: number; now: number }[] = [];
        ids.forEach((id, pos) => {
          const w = win(id);
          const st = w.__kites!.state() as unknown as { drawExits: number[]; exits: number[] };
          const frame = w.__hypercube!.identity!.frame;
          for (const slot of [0, 1]) {
            const k = scr.kites.find((x) => x.key === `${frame}#${slot}`);
            if (!k || st.drawExits.length < 3) continue;
            const s = k.starts.reduce((a, b) => a + b.x, 0) / k.starts.length / scr.width;
            // Exits per patch: the spool's line, then the stunt kite's left and right lines.
            const at = (e: number[]) => (slot === 0 ? e[0]! : (e[1]! + e[2]!) / 2);
            const drawn = (pos + at(st.drawExits) / 1080) / 4;
            const now = (pos + at(st.exits) / 1080) / 4;
            out.push({ joined: Math.abs(s - drawn) * 4 * 1080, now: Math.abs(s - now) * 4 * 1080 });
          }
        });
        return out;
      }, PANELS);
      for (const x of r) {
        worst = Math.max(worst, x.joined);
        naive = Math.max(naive, x.now);
      }
      await page.waitForTimeout(400);
    }
    test.info().annotations.push({
      type: "join",
      description: `worst gap at the top edge ${worst.toFixed(1)} venue px (without matching the screen's delay it would be up to ${naive.toFixed(0)} px)`,
    });
    // A line is 6 venue px wide on a panel; a gap under about a line's width doesn't show.
    expect(worst).toBeLessThan(12);
    expect.soft(problems).toEqual([]);
  });

  test("kites: a held spool sends its kite up on the panel and the screen; let go, it sinks", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openBank(page);
    const panel = await simFrame(page, "a-p2");

    // The panel's bots fly its stunt kite without jitter.
    const runs = await panel.evaluate(sampleJitter, 8);
    test.info().annotations.push({
      type: "jitter in a bank",
      description: runs
        .map((r) => `handle ${r.handle.toFixed(2)}/s heading ${r.heading.toFixed(2)}/s`)
        .join("; "),
    });
    for (const r of runs) {
      expect(r.handle).toBeLessThan(1.8);
      expect(r.heading).toBeLessThan(1.4);
    }

    const frameId = await panel.evaluate(() => window.__hypercube!.identity!.frame);
    const onPanel = async () =>
      ((await panel.evaluate(() => window.__kites!.state())) as FrameState).patches[0]!;
    /** The spool kite on the screen: x across the screen, y up from its bottom, in heights. */
    const onScreen = async () => {
      const st = (await inFrame(page, "a-screen", () => window.__kites!.state())) as ScreenState;
      const k = st.kites.find((x) => x.key === `${frameId}#0`);
      return k ? { x: k.x / st.width, y: 1 - k.y / st.height } : { x: -1, y: 2 };
    };
    // A tap takes the spool from its bot; then let the kite settle low.
    const b = (await onPanel()).button;
    await hold(panel, b, 50);
    await expect
      .poll(async () => (await onPanel()).spool.y, { timeout: 20_000 })
      .toBeLessThan(0.32);
    await expect.poll(async () => (await onScreen()).y, { timeout: 5000 }).toBeLessThan(0.36);
    const low = (await onPanel()).spool.y;
    const lowOnScreen = (await onScreen()).y;

    const f = await finger(panel, { x: b.x, y: b.y });
    await page.waitForTimeout(3000);
    const high = (await onPanel()).spool.y;
    expect((await onPanel()).button.reeling).toBe(true);
    expect(high).toBeGreaterThan(low + 0.4);
    await expect
      .poll(async () => (await onScreen()).y, { timeout: 3000 })
      .toBeGreaterThan(lowOnScreen + 0.35);
    // Over its own panel, the second of four.
    const { x } = await onScreen();
    expect(x).toBeGreaterThan(0.25);
    expect(x).toBeLessThan(0.5);
    await f.up({ x: b.x, y: b.y });
    const top = (await onScreen()).y;

    await expect
      .poll(async () => (await onPanel()).spool.y, { timeout: 15_000 })
      .toBeLessThan(high - 0.25);
    await expect.poll(async () => (await onScreen()).y, { timeout: 5000 }).toBeLessThan(top - 0.25);
    expect.soft(problems).toEqual([]);
  });

  test("kites: panels draw their own sky within 3 s of the screen going", async ({ page }) => {
    await openBank(page);
    for (const id of PANELS) {
      expect(((await inFrame(page, id, () => window.__kites!.state())) as FrameState).mode).toBe(
        "bank",
      );
    }
    const removed = await page.evaluate(() => {
      document.querySelector('.sim-frame[data-frame="a-screen"] iframe')?.remove();
      return performance.timeOrigin + performance.now();
    });
    for (const id of PANELS) {
      await expect
        .poll(
          async () => ((await inFrame(page, id, () => window.__kites!.state())) as FrameState).mode,
          {
            timeout: 15_000,
          },
        )
        .toBe("local");
    }
    const took = await Promise.all(
      PANELS.map(async (id) => {
        const at = await inFrame(
          page,
          id,
          () =>
            performance.timeOrigin +
            (window.__kites!.state() as unknown as { modeAt: number }).modeAt,
        );
        return Math.round(at - removed);
      }),
    );
    test.info().annotations.push({ type: "fallback", description: `${took.join(", ")} ms` });
    // The aim is 3 s, which the sim meets unless the machine is loaded.
    for (const t of took) {
      expect.soft(t).toBeLessThan(3000);
      expect(t).toBeLessThan(4500);
    }
    // The kites fly on in the panel's own sky.
    const st = (await inFrame(page, "a-p2", () => window.__kites!.state())) as FrameState;
    expect(st.patches[0]!.spool.y).toBeGreaterThan(0);
  });
});
