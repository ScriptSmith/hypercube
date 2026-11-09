import { gzipSync } from "node:zlib";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { watchPage } from "../scripts/lib/play.mjs";
import { buildFeed, type TestVehicle } from "../tests/apps/transit/helpers";

/**
 * Brisbane Transit with every request outside the test server intercepted: the map tiles are
 * refused, and brisbus's static files and realtime feed are either refused or answered with
 * small fixtures built here. Covers the replay with no network, mode and route buttons, follow
 * and the return to the tour, vehicle cards, dragging, pinching and the zoom buttons, the live
 * feed relayed by the group's leader, a kiosk's route lighting up on a wall, and falling back to
 * the replay and recovering.
 */

interface Visible {
  key: number;
  route: string;
  mode: string;
  x: number;
  y: number;
}
interface State {
  source: string;
  vehicles: number;
  visible: Visible[];
  camera: {
    mode: string;
    view: string;
    following: number | null;
    zoom: number;
    pitch: number;
    center: { lon: number; lat: number };
    range: { min: number; max: number };
    moving: boolean;
  };
  gesture: { active: boolean; fingers: number };
  focus: { kind: string; id: string } | null;
  picks: { line: string; color: number }[];
  lines: { id: string; vehicles: number }[];
  kioskColor: number;
  card: { key: number; title: string; subtitle: string | null } | null;
  buttons: { kind: string; id: string; x: number; y: number }[];
  tapTop: number;
  static: string;
  feed: { fetches: number; failures: number; age: number } | null;
  relayed: number;
  map: { loaded: boolean; errors: number };
  layer: { glyphs: number; segments: number; frames: number };
  tag: boolean;
}

declare global {
  interface Window {
    __transit?: { state(): State; setTiming(t: Record<string, number>): void };
  }
}

const SIZES = { wall: [5760, 2160], kiosk: [1920, 1080], screen: [4000, 3600] } as const;
const FEED = "https://brisbus.adsm.dev/";
const STATIC = "https://brisbus.com/data/";

// ---- Fixtures --------------------------------------------------------------------------------

/** Two fixes per vehicle, in the city view. */
const MOVES: Record<
  string,
  { route: string; trip: string; a: [number, number]; b: [number, number] }
> = {
  bus199: { route: "199-1", trip: "T199", a: [153.0235, -27.468], b: [153.027, -27.466] },
  busM1: { route: "M1-1", trip: "TM1", a: [153.0285, -27.479], b: [153.03, -27.482] },
  ferry: { route: "F1-1", trip: "TF1", a: [153.031, -27.474], b: [153.033, -27.4705] },
  train: { route: "SHCL-1", trip: "TSH", a: [153.018, -27.466], b: [153.023, -27.465] },
};

const feedBody = (call: number) => {
  const t = Math.floor(Date.now() / 1000);
  const vehicles: TestVehicle[] = Object.entries(MOVES).map(([id, m]) => {
    const [lon, lat] = call === 0 ? m.a : m.b;
    return { id, route: m.route, trip: m.trip, lon, lat, timestamp: t - 5 };
  });
  return Buffer.from(buildFeed(t, vehicles));
};

const csv = (rows: string[]) => gzipSync(`${rows.join("\n")}\n`);
const shapeRows = (id: string, a: [number, number], b: [number, number]) =>
  [0, 1, 2, 3, 4].map((i) => {
    const lon = a[0] + ((b[0] - a[0]) * i) / 4;
    const lat = a[1] + ((b[1] - a[1]) * i) / 4;
    return `S${id},${lat.toFixed(6)},${lon.toFixed(6)},${i + 1}`;
  });
const STATIC_FILES: Record<string, Buffer> = {
  "routes.txt.gz": csv([
    "route_id,route_short_name,route_long_name,route_type",
    "199-1,199,Fixture road,3",
    "M1-1,M1,Fixture busway,3",
    "F1-1,F1,Fixture river,4",
    "SHCL-1,SHCL,Fixture rail,2",
  ]),
  "trips.txt.gz": csv([
    "route_id,service_id,trip_id,trip_headsign,direction_id,shape_id",
    "199-1,s,T199,To the test terminal,0,Sbus199",
    "M1-1,s,TM1,To the test stop,1,SbusM1",
    "F1-1,s,TF1,To the test wharf,0,Sferry",
    "SHCL-1,s,TSH,To the test station,0,Strain",
  ]),
  "shapes.txt.gz": csv([
    "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence",
    ...Object.entries(MOVES).flatMap(([id, m]) => shapeRows(id, m.a, m.b)),
  ]),
};

interface Net {
  feedCalls: number;
  feed: "fixture" | "refuse";
  staticCalls: number;
}

/** Intercept everything that isn't the test server. */
const intercept = async (context: BrowserContext, net: Net) => {
  await context.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, async (route) => {
    const url = route.request().url();
    const cors = { "access-control-allow-origin": "*" };
    if (url.startsWith(FEED)) {
      const call = net.feedCalls++;
      if (net.feed === "refuse") return route.abort();
      return route.fulfill({
        body: feedBody(call),
        headers: cors,
        contentType: "application/x-protobuf",
      });
    }
    if (url.startsWith(STATIC)) {
      net.staticCalls++;
      const file = STATIC_FILES[url.slice(STATIC.length)];
      if (file) return route.fulfill({ body: file, headers: cors });
      return route.fulfill({ status: 404, body: "", headers: cors });
    }
    return route.abort();
  });
};

// ---- Helpers ---------------------------------------------------------------------------------

const open = async (
  page: Page,
  kind: keyof typeof SIZES,
  params: Record<string, string | number> = {},
) => {
  const [w, h] = SIZES[kind];
  const scale = Math.min(1100 / w, 800 / h);
  await page.setViewportSize({ width: Math.round(w * scale), height: Math.round(h * scale) });
  const q = new URLSearchParams({
    app: "transit",
    kind,
    fit: `${w}x${h}`,
    bots: "0",
    seed: "e2e",
    debug: "1",
  });
  for (const [k, v] of Object.entries(params)) q.set(k, String(v));
  await page.goto(`play/?${q}`);
  await page.waitForFunction(() => window.__transit !== undefined, undefined, { timeout: 30_000 });
};

const state = (page: Page) => page.evaluate(() => window.__transit!.state());

/** A real touch at stage px (x, y): pointerdown then pointerup on whatever is there. */
const tap = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([sx, sy]) => {
      const stage = document.querySelector<HTMLElement>(".hc-stage")!;
      const r = stage.getBoundingClientRect();
      const k = r.width / stage.offsetWidth;
      const clientX = r.left + sx * k;
      const clientY = r.top + sy * k;
      const pointerId = 5000 + Math.floor(Math.random() * 4000);
      const target = document.elementFromPoint(clientX, clientY) ?? stage;
      const init = { clientX, clientY, pointerId, pointerType: "touch", bubbles: true };
      target.dispatchEvent(new PointerEvent("pointerdown", { ...init, isPrimary: true }));
      target.dispatchEvent(new PointerEvent("pointerup", init));
    },
    [x, y] as const,
  );

/**
 * Fingers dragged in a straight line from `from` to `to` (stage px, one pair per finger) over
 * `steps` moves 16 ms apart, then held still for `rest` ms (so nothing glides on) and lifted.
 */
const drag = (
  page: Page,
  from: [number, number][],
  to: [number, number][],
  opts: { steps?: number; rest?: number } = {},
) =>
  page.evaluate(
    async ({ from, to, steps, rest }) => {
      const stage = document.querySelector<HTMLElement>(".hc-stage")!;
      const r = stage.getBoundingClientRect();
      const k = r.width / stage.offsetWidth;
      const client = ([x, y]: [number, number]) => [r.left + x * k, r.top + y * k] as const;
      const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
      const fingers = from.map((p, i) => {
        const [clientX, clientY] = client(p);
        const target = document.elementFromPoint(clientX, clientY) ?? stage;
        const pointerId = 6000 + i + Math.floor(Math.random() * 1000) * 4;
        target.dispatchEvent(
          new PointerEvent("pointerdown", {
            clientX,
            clientY,
            pointerId,
            pointerType: "touch",
            isPrimary: i === 0,
            bubbles: true,
          }),
        );
        return { target, pointerId };
      });
      const at = (i: number, t: number) =>
        client([
          from[i]![0] + (to[i]![0] - from[i]![0]) * t,
          from[i]![1] + (to[i]![1] - from[i]![1]) * t,
        ]);
      for (let s = 1; s <= steps; s++) {
        await wait(16);
        fingers.forEach((f, i) => {
          const [clientX, clientY] = at(i, s / steps);
          f.target.dispatchEvent(
            new PointerEvent("pointermove", {
              clientX,
              clientY,
              pointerId: f.pointerId,
              pointerType: "touch",
              bubbles: true,
            }),
          );
        });
      }
      // Without a rest the fingers lift at once: even a zero timeout can take longer than the
      // gesture's velocity window on a loaded machine, and the flick would read as stopped.
      if (rest > 0) await wait(rest);
      fingers.forEach((f, i) => {
        const [clientX, clientY] = at(i, 1);
        f.target.dispatchEvent(
          new PointerEvent("pointerup", {
            clientX,
            clientY,
            pointerId: f.pointerId,
            pointerType: "touch",
            bubbles: true,
          }),
        );
      });
      // The camera as the fingers lifted, before a glide can finish.
      return window.__transit!.state().camera;
    },
    { from, to, steps: opts.steps ?? 12, rest: opts.rest ?? 250 },
  );

/** Wait for the camera to stop moving. */
const settled = async (page: Page) =>
  expect.poll(async () => (await state(page)).camera.moving, { timeout: 15_000 }).toBe(false);

const press = async (page: Page, id: string) => {
  const b = (await state(page)).buttons.find((x) => x.id === id);
  if (!b) throw new Error(`no button ${id}`);
  await tap(page, b.x, b.y);
};

/** A vehicle of `route` once it is drawn in full on the map. */
const seen = async (page: Page, route: string) => {
  await expect
    .poll(async () => (await state(page)).visible.some((v) => v.route === route), {
      timeout: 15_000,
    })
    .toBe(true);
  return (await state(page)).visible.find((v) => v.route === route)!;
};

/** A featured line with a vehicle on the map now. */
const busyLine = async (page: Page) => {
  await expect
    .poll(async () => (await state(page)).lines.some((l) => l.vehicles > 0), { timeout: 15_000 })
    .toBe(true);
  return (await state(page)).lines.find((l) => l.vehicles > 0)!.id;
};

// ---- Tests -----------------------------------------------------------------------------------

test.describe("transit", () => {
  test("plays the bundled replay with no network at all, quietly", async ({ page }) => {
    const problems = watchPage(page);
    const net: Net = { feedCalls: 0, feed: "refuse", staticCalls: 0 };
    await intercept(page.context(), net);
    await open(page, "wall", { variant: "replay" });
    await expect.poll(async () => (await state(page)).source).toBe("replay");
    await expect.poll(async () => (await state(page)).vehicles).toBeGreaterThan(20);
    const st = await state(page);
    expect(st.tag).toBe(true);
    expect(st.static).toBe("bundled");
    expect(st.feed).toBeNull();
    // A preview frame (no identity) never asks for the feed or the static data.
    await page.waitForTimeout(2000);
    expect(net.feedCalls).toBe(0);
    expect(net.staticCalls).toBe(0);
    expect(problems).toEqual([]);
  });

  test("a mode button lights its vehicles for a while, then lets go", async ({ page }) => {
    await intercept(page.context(), { feedCalls: 0, feed: "refuse", staticCalls: 0 });
    await open(page, "kiosk", { variant: "replay" });
    await expect.poll(async () => (await state(page)).vehicles).toBeGreaterThan(20);
    await page.evaluate(() => window.__transit!.setTiming({ mode: 3000 }));
    await press(page, "bus");
    expect((await state(page)).focus).toEqual({ kind: "mode", id: "bus" });
    const lit = page.locator('[data-mode="bus"]');
    await expect(lit).toHaveCSS("box-shadow", /rgba/);
    await expect.poll(async () => (await state(page)).focus, { timeout: 6000 }).toBeNull();
    await expect(lit).toHaveCSS("box-shadow", "none");
  });

  test("a route button follows one of its vehicles, then the tour comes back", async ({ page }) => {
    await intercept(page.context(), { feedCalls: 0, feed: "refuse", staticCalls: 0 });
    await open(page, "kiosk", { variant: "replay" });
    await page.evaluate(() => window.__transit!.setTiming({ follow: 6000, line: 6000 }));
    const line = await busyLine(page);
    const before = await state(page);
    await press(page, line);
    let st = await state(page);
    expect(st.focus).toEqual({ kind: "line", id: line });
    expect(st.camera.mode).toBe("follow");
    const key = st.camera.following!;
    // The camera closes in and tilts, then keeps the vehicle in the middle of the map.
    await expect
      .poll(async () => (await state(page)).camera.pitch, { timeout: 8000 })
      .toBeGreaterThan(35);
    expect((await state(page)).camera.zoom).toBeGreaterThan(before.camera.zoom + 1);
    await page.waitForTimeout(800);
    st = await state(page);
    const v = st.visible.find((x) => x.key === key)!;
    const map = await page.evaluate(() => window.__hypercube!.frame!);
    expect(Math.abs(v.x - map.width / 2)).toBeLessThan(map.width * 0.08);
    // Back to the tour, level, after the follow time.
    await expect.poll(async () => (await state(page)).camera.mode, { timeout: 8000 }).toBe("tour");
    await expect
      .poll(async () => (await state(page)).camera.pitch, { timeout: 8000 })
      .toBeLessThan(1);
  });

  test("tapping a vehicle in reach shows its card; a tap high on the wall does nothing", async ({
    page,
  }) => {
    await intercept(page.context(), { feedCalls: 0, feed: "fixture", staticCalls: 0 });
    // A named wall on the fixture feed: the M1 bus is south of the centre, low on the wall
    // between the consoles, and the 199 bus north of it, out of reach.
    await open(page, "wall", { frame: "w1", "o.view": "city" });
    await expect.poll(async () => (await state(page)).source, { timeout: 20_000 }).toBe("live");
    await expect.poll(async () => (await state(page)).static, { timeout: 20_000 }).toBe("daily");
    const high = await seen(page, "199");
    const low = await seen(page, "M1");
    let st = await state(page);
    expect(high.y).toBeLessThan(st.tapTop);
    expect(low.y).toBeGreaterThan(st.tapTop);
    await tap(page, high.x, high.y);
    expect((await state(page)).card).toBeNull();
    // A finger near the vehicle (about 70 venue px off), not exactly on it, still finds it.
    const unit = await page.evaluate(() => window.__hypercube!.frame!.unit);
    await tap(page, low.x + 60 * unit, low.y - 35 * unit);
    st = await state(page);
    expect(st.card).toMatchObject({ key: low.key, title: "M1", subtitle: "To the test stop" });
    const card = page.getByText("To the test stop");
    await expect(card).toBeVisible();
    // A tap on open map with nothing near closes nothing and opens nothing new.
    await tap(page, low.x + 600 * unit, low.y);
    expect((await state(page)).card?.key).toBe(low.key);
    // A second tap on the vehicle while its card is up follows it.
    expect((await state(page)).camera.mode).toBe("tour");
    await tap(page, low.x, low.y);
    st = await state(page);
    expect(st.camera.mode).toBe("follow");
    expect(st.camera.following).toBe(low.key);
  });

  test("the leader fetches the feed and relays it; a kiosk's route lights up on the wall", async ({
    context,
  }) => {
    test.setTimeout(90_000);
    const net: Net = { feedCalls: 0, feed: "fixture", staticCalls: 0 };
    await intercept(context, net);
    const room = `e2e-transit-${Math.random().toString(36).slice(2, 8)}`;
    const common = { room, transport: "local", group: "g1", "o.view": "city" };
    const kiosk = await context.newPage();
    const wall = await context.newPage();
    const problems = [...watchPage(kiosk), ...watchPage(wall)];
    // Frame ids pick the leader: "k1" sorts before "w1".
    await open(kiosk, "kiosk", { ...common, frame: "k1" });
    await open(wall, "wall", { ...common, frame: "w1" });
    for (const p of [kiosk, wall]) {
      await p.waitForFunction(() => window.__hypercube?.room === "online", undefined, {
        timeout: 30_000,
      });
    }
    for (const p of [kiosk, wall]) {
      await expect.poll(async () => (await state(p)).source, { timeout: 30_000 }).toBe("live");
    }
    // The wall may have started the replay while the room formed; it fades out for live data.
    for (const p of [kiosk, wall]) {
      await expect.poll(async () => (await state(p)).vehicles, { timeout: 5000 }).toBe(4);
    }
    const k = await state(kiosk);
    const w = await state(wall);
    expect(k.feed!.fetches).toBeGreaterThan(0);
    expect(k.relayed).toBeGreaterThan(0);
    expect(w.feed!.fetches).toBe(0);
    expect(w.visible.map((v) => v.key).sort()).toEqual(k.visible.map((v) => v.key).sort());
    // The day's static data loaded through the worker, with headsigns for the cards.
    await expect.poll(async () => (await state(kiosk)).static, { timeout: 20_000 }).toBe("daily");
    const bus = await seen(kiosk, "199");
    await tap(kiosk, bus.x, bus.y);
    expect((await state(kiosk)).card).toMatchObject({
      title: "199",
      subtitle: "To the test terminal",
    });
    // A kiosk's route shows on the wall in the kiosk's colour; the wall's camera stays put.
    await press(kiosk, "199");
    await expect
      .poll(async () => (await state(wall)).picks, { timeout: 10_000 })
      .toEqual([{ line: "199", color: k.kioskColor }]);
    expect((await state(wall)).camera.mode).toBe("tour");
    expect((await state(kiosk)).camera.mode).toBe("follow");
    // Only the leader asks the proxy: about one request every 15 s, never one per frame.
    const calls = net.feedCalls;
    await wall.waitForTimeout(16_000);
    expect(net.feedCalls - calls).toBeLessThanOrEqual(2);
    expect((await state(wall)).feed!.fetches).toBe(0);
    expect(problems).toEqual([]);
  });

  test("a live frame plays the replay while the feed is refused, then switches to live", async ({
    page,
  }) => {
    test.setTimeout(80_000);
    const problems = watchPage(page);
    const net: Net = { feedCalls: 0, feed: "refuse", staticCalls: 0 };
    await intercept(page.context(), net);
    await open(page, "screen", { frame: "s1", "o.view": "city" });
    await expect.poll(async () => (await state(page)).source, { timeout: 20_000 }).toBe("replay");
    let st = await state(page);
    expect(st.tag).toBe(true);
    expect(st.feed!.failures).toBeGreaterThan(0);
    net.feed = "fixture";
    await expect.poll(async () => (await state(page)).source, { timeout: 45_000 }).toBe("live");
    // The replay's vehicles fade out once live data arrives.
    await expect.poll(async () => (await state(page)).vehicles, { timeout: 5000 }).toBe(4);
    st = await state(page);
    expect(st.tag).toBe(false);
    expect(problems).toEqual([]);
  });

  test("vehicles draw again after the map's GL context is lost and restored", async ({ page }) => {
    const problems = watchPage(page);
    await intercept(page.context(), { feedCalls: 0, feed: "refuse", staticCalls: 0 });
    await open(page, "screen", { variant: "replay" });
    await expect.poll(async () => (await state(page)).layer.glyphs).toBeGreaterThan(20);
    // The extension can't be fetched once the context is lost, so keep the one from before.
    const lose = (restore: boolean) =>
      page.evaluate((r) => {
        const w = window as unknown as { __lose?: WEBGL_lose_context | null };
        const canvas = document.querySelector<HTMLCanvasElement>(".maplibregl-canvas")!;
        w.__lose ??= canvas.getContext("webgl2")!.getExtension("WEBGL_lose_context");
        if (r) w.__lose!.restoreContext();
        else w.__lose!.loseContext();
      }, restore);
    await lose(false);
    await page.waitForTimeout(1000);
    await lose(true);
    await page.waitForTimeout(1500);
    const before = (await state(page)).layer.frames;
    await expect.poll(async () => (await state(page)).layer.frames).toBeGreaterThan(before + 5);
    expect((await state(page)).layer.glyphs).toBeGreaterThan(20);
    expect(problems.filter((p) => !p.includes("WebGL"))).toEqual([]);
  });

  test("dragging the map moves the ground with the finger; it tours again later", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await intercept(page.context(), { feedCalls: 0, feed: "refuse", staticCalls: 0 });
    await open(page, "kiosk", { variant: "replay", "o.view": "city" });
    await expect.poll(async () => (await state(page)).vehicles).toBeGreaterThan(20);
    await page.evaluate(() => window.__transit!.setTiming({ manual: 4000 }));
    await settled(page);
    const before = (await state(page)).camera;
    const { width: w, height: h } = await page.evaluate(() => window.__hypercube!.frame!);
    // A quarter of the width right and a tenth of the height down: the ground follows, so the
    // centre moves west and north.
    await drag(page, [[w * 0.3, h * 0.35]], [[w * 0.55, h * 0.45]]);
    let st = await state(page);
    expect(st.camera.mode).toBe("manual");
    expect(st.card).toBeNull();
    const pxPerDeg = (512 * 2 ** st.camera.zoom) / 360;
    expect(st.camera.zoom).toBeCloseTo(before.zoom, 6);
    const moved = (before.center.lon - st.camera.center.lon) * pxPerDeg;
    expect(Math.abs(moved - w * 0.25)).toBeLessThan(w * 0.25 * 0.05);
    expect(st.camera.center.lat).toBeGreaterThan(before.center.lat);
    // A quick flick glides on past where the finger let go.
    const flickFrom = (await state(page)).camera.center.lon;
    const flick = await drag(page, [[w * 0.55, h * 0.35]], [[w * 0.3, h * 0.35]], {
      steps: 6,
      rest: 0,
    });
    const lifted = flick.center.lon;
    expect(flick.moving).toBe(true);
    await settled(page);
    st = await state(page);
    expect(lifted).toBeGreaterThan(flickFrom);
    expect(st.camera.center.lon).toBeGreaterThan(lifted);
    // Left alone, the camera flies back to the tour.
    await expect.poll(async () => (await state(page)).camera.mode, { timeout: 8000 }).toBe("tour");
    await settled(page);
    st = await state(page);
    expect(st.camera.center.lon).toBeCloseTo(before.center.lon, 3);
    expect(problems).toEqual([]);
  });

  test("a pinch zooms about the fingers; zoom buttons zoom and stop at their limits", async ({
    page,
  }) => {
    await intercept(page.context(), { feedCalls: 0, feed: "refuse", staticCalls: 0 });
    await open(page, "kiosk", { variant: "replay", "o.view": "city" });
    await expect.poll(async () => (await state(page)).vehicles).toBeGreaterThan(20);
    await settled(page);
    const start = (await state(page)).camera;
    const { width: w } = await page.evaluate(() => window.__hypercube!.frame!);
    const mapH = (await state(page)).buttons.find((b) => b.kind === "mode")!.y * 0.9;
    // Two fingers spreading to twice their distance, right of the map's centre: one zoom level
    // closer, about the point between them.
    const mid = w * 0.7;
    const y = mapH * 0.5;
    await drag(
      page,
      [
        [mid - w * 0.06, y],
        [mid + w * 0.06, y],
      ],
      [
        [mid - w * 0.12, y],
        [mid + w * 0.12, y],
      ],
    );
    let st = await state(page);
    expect(st.camera.mode).toBe("manual");
    expect(st.camera.zoom - start.zoom).toBeCloseTo(1, 1);
    // The ground between the fingers stayed put, so at twice the scale the centre moved towards
    // it by the middle's distance from the centre.
    const pxPerDeg = (512 * 2 ** st.camera.zoom) / 360;
    const shift = (st.camera.center.lon - start.center.lon) * pxPerDeg;
    expect(Math.abs(shift - (mid - w / 2))).toBeLessThan(w * 0.02);

    await press(page, "reset");
    await expect.poll(async () => (await state(page)).camera.mode).toBe("tour");
    await settled(page);
    st = await state(page);
    expect(st.camera.zoom).toBeCloseTo(start.zoom, 3);

    await press(page, "in");
    await settled(page);
    st = await state(page);
    expect(st.camera.mode).toBe("manual");
    expect(st.camera.zoom).toBeCloseTo(start.zoom + 1, 3);
    for (let i = 0; i < 6; i++) await press(page, "in");
    await settled(page);
    st = await state(page);
    expect(st.camera.zoom).toBeCloseTo(st.camera.range.max, 3);
    await expect(page.locator('[data-zoom="in"]')).toHaveCSS("opacity", "0.35");
    for (let i = 0; i < 12; i++) await press(page, "out");
    await settled(page);
    st = await state(page);
    expect(st.camera.zoom).toBeCloseTo(st.camera.range.min, 3);
    await expect(page.locator('[data-zoom="out"]')).toHaveCSS("opacity", "0.35");
    await expect(page.locator('[data-zoom="in"]')).toHaveCSS("opacity", "1");
    await press(page, "reset");
    await settled(page);
    expect((await state(page)).camera.zoom).toBeCloseTo(start.zoom, 3);
  });

  test("on a wall the map drags anywhere off the consoles; a drag ends a follow", async ({
    page,
  }) => {
    await intercept(page.context(), { feedCalls: 0, feed: "refuse", staticCalls: 0 });
    await open(page, "wall", { variant: "replay", "o.view": "city" });
    await expect.poll(async () => (await state(page)).vehicles).toBeGreaterThan(20);
    await settled(page);
    const st0 = await state(page);
    const f = await page.evaluate(() => window.__hypercube!.frame!);
    const low = st0.tapTop + (f.height - st0.tapTop) * 0.4;
    // On a console's backing, between buttons: nothing moves.
    const zoomIn = st0.buttons.find((b) => b.kind === "zoom" && b.id === "in")!;
    const lineB = st0.buttons.find((b) => b.kind === "line")!;
    await drag(page, [[lineB.x, zoomIn.y]], [[lineB.x + 200, zoomIn.y]]);
    expect((await state(page)).camera.mode).toBe("tour");
    expect((await state(page)).camera.center.lon).toBeCloseTo(st0.camera.center.lon, 6);
    // High on the wall, above the consoles and out of reach: the map moves.
    await drag(page, [[f.width / 2, st0.tapTop * 0.5]], [[f.width / 2 + 300, st0.tapTop * 0.5]]);
    expect((await state(page)).camera.mode).toBe("manual");
    expect((await state(page)).camera.center.lon).toBeLessThan(st0.camera.center.lon);
    await press(page, "reset");
    await settled(page);
    expect((await state(page)).camera.mode).toBe("tour");
    // Follow a line, then drag the open map low between the consoles: the visitor takes over.
    const line = await busyLine(page);
    await press(page, line);
    expect((await state(page)).camera.mode).toBe("follow");
    await drag(page, [[f.width / 2, low]], [[f.width / 2 + 200, low]]);
    const st = await state(page);
    expect(st.camera.mode).toBe("manual");
    expect(st.camera.following).toBeNull();
  });

  test("going idle clears highlights and hands the camera back to the tour", async ({ page }) => {
    await intercept(page.context(), { feedCalls: 0, feed: "refuse", staticCalls: 0 });
    await open(page, "kiosk", { variant: "replay", idle: 5 });
    const line = await busyLine(page);
    await press(page, line);
    expect((await state(page)).camera.mode).toBe("follow");
    await expect.poll(async () => (await state(page)).focus, { timeout: 12_000 }).toBeNull();
    expect((await state(page)).camera.mode).toBe("tour");
  });
});
