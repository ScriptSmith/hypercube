/**
 * The screen above a bank: the sky. Touch frames fly their own kites and send them here
 * (fleet.ts); the screen draws each one a little behind the shared clock, with its line from the
 * bottom edge above the frame it belongs to, and its tail. It also finds crossing lines and tells
 * the kites' frames (tangle.ts), pops rings the frames' kites fly through, keeps the ring tally,
 * and sends a beacon twice a second so the frames know it is there and how far behind it draws.
 *
 * With no touch frame heard for a few seconds it flies kites of its own, one patch per column,
 * and drops them the moment a frame is heard.
 */
import { activeVenue } from "../../core/venue";
import { bankFraction } from "../../core/layout";
import type { AppContext, AppInstance, FrameInfo, PeerInfo } from "../../core/types";
import { createSparkles } from "./art";
import {
  spoolAutopilot,
  type SpoolPilot,
  spoolPilot,
  stuntAutopilot,
  type StuntPilot,
  stuntPilot,
} from "./autopilot";
import { BEACON_MS, type Config } from "./config";
import { type KiteView, tailPoint } from "./draw";
import { drawKiteViews } from "./draw";
import { createFleet, type KitePose } from "./fleet";
import {
  createSpool,
  createStunt,
  resetSpool,
  resetStunt,
  SPOOL,
  type SpoolKite,
  stepSpool,
  stepStunt,
  type StuntKite,
  WIND_SPEED,
} from "./kite";
import { shapeFor } from "./patch";
import { inRing, type Ring, ringsAt } from "./rings";
import {
  createSkyScene,
  drawAttribution,
  drawRings,
  drawTally,
  paintSky,
  type SkyRect,
} from "./scene";
import { BANK_KITE, BANK_RING, screenSky, type SkyFrame } from "./sky";
import { createTail, stepTail, type Tail } from "./tail";
import { createTangles, type Line } from "./tangle";
import { windAt } from "./wind";
import { createWindState } from "./windstate";
import {
  decodeKites,
  decodeRing,
  encodeSky,
  encodeTangle,
  FLAG,
  SHAPES,
  type Shape,
  TOPIC,
} from "./wire";

const HZ = 60;
/** With no touch frame heard for this long, the screen flies kites of its own. */
export const DEMO_AFTER_MS = 3000;
/** Columns of the screen's own kites when it doesn't know its bank: a bank of pairs. */
const demoColumns = () => Math.max(1, Math.floor(activeVenue().bankCount / 2));
const MAX_DEMO = 10;
const LOOK_MS = 250;
const TANGLE_LOOK_MS = 50;
/** Tangles are repeated to their frames this often, since frames forget unrepeated ones. */
const TANGLE_REPEAT_MS = 1000;
const MAX_TAKEN = 64;
const MAX_TAILS = 160;

interface DemoPatch {
  spool: SpoolKite;
  stunt: StuntKite | null;
  color: number;
  shape: Shape;
  phase: number;
  pilot: { spool: SpoolPilot; stunt: StuntPilot };
}

export const mountScreen = (ctx: AppContext, config: Config): AppInstance => {
  const players = ctx.ui.palette.players;
  const side = ctx.setup.side ?? 0;
  const clock = () => ctx.clock.now();
  const preview = ctx.identity.mode === "preview";
  const wind = createWindState(ctx, config, preview);
  const fleet = createFleet();
  const tangles = createTangles();
  const sparkles = createSparkles(360);
  const tails = new Map<string, Tail>();
  const tailSeen = new Set<string>();
  const tally = new Map<number, number>();
  const taken = new Map<number, { t: number; color: number; popped: boolean }>();
  const rings: Ring[] = [];
  const counts = { rings: 0, tangles: 0 };
  let frame: FrameInfo = ctx.frame;
  let demo: DemoPatch[] | null = null;
  let demoSky: SkyFrame | null = null;
  const mountedAt = performance.now();
  let lastHeard = Number.NEGATIVE_INFINITY;
  let received = 0;
  let disposed = false;
  let day = new Date().toDateString();

  const bg = document.createElement("canvas");
  const fg = document.createElement("canvas");
  bg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
  fg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
  ctx.root.append(bg, fg);
  const gb = bg.getContext("2d");
  const gf = fg.getContext("2d");
  let W = 1;
  let H = 1;
  let k = 1;
  const skyRect: SkyRect = { x: 0, y: 0, w: 1, h: 1, unit: 1, fOf: (px) => px / Math.max(1, W) };
  let scenery = createSkyScene(() => wind.field, {
    clouds: 6,
    px: activeVenue().screen.height,
    seed: ctx.seed,
  });

  const setupCanvas = () => {
    W = frame.width / frame.unit;
    H = frame.height / frame.unit;
    const pr = frame.pixelRatio;
    for (const c of [bg, fg]) {
      c.width = Math.max(1, Math.round(frame.width * pr));
      c.height = Math.max(1, Math.round(frame.height * pr));
    }
    k = frame.unit * pr;
    skyRect.w = W;
    skyRect.h = H;
    skyRect.unit = H;
    if (gb) {
      gb.setTransform(k, 0, 0, k, 0, 0);
      paintSky(gb, { x: 0, y: 0, w: W, h: H }, H);
    }
    scenery.dispose();
    scenery = createSkyScene(() => wind.field, { clouds: 6, px: H, seed: ctx.seed });
  };
  setupCanvas();

  const isTouchFrame = (p: PeerInfo) =>
    p.role !== "screen" && p.frame !== ctx.net.self && (p.side ?? 0) === side;
  const touchFrame = (from: string) => {
    const p = ctx.net.peers().find((x) => x.frame === from);
    return !!p && isTouchFrame(p);
  };

  // ---- The screen's own kites ---------------------------------------------------------------

  const columns = () => Math.min(MAX_DEMO, ctx.setup.count > 1 ? ctx.setup.count : demoColumns());

  const startDemo = () => {
    const n = columns();
    const width = W / H;
    const sky = screenSky(width, n);
    demoSky = sky;
    const s = wind.dir(clock() / 1000) >= 0 ? 1 : -1;
    const half = sky.kite * 0.5;
    demo = Array.from({ length: n }, (_, i) => {
      const ax = ((i + 0.5) / n) * width;
      const col = [(i / n) * width + half, ((i + 1) / n) * width - half] as const;
      const phase = ctx.rng(`kites:screen:${i}`).next() * 6.283;
      const d: DemoPatch = {
        spool: createSpool(ax, s, col),
        stunt: config.variant === "duo" ? createStunt(ax, sky.window, s) : null,
        color: i % 8,
        shape: shapeFor(i),
        phase,
        pilot: { spool: spoolPilot(phase), stunt: stuntPilot() },
      };
      return d;
    });
  };

  const stopDemo = () => {
    demo = null;
    demoSky = null;
    for (const t of tangles.clear()) void t;
  };

  // ---- Touch frames -------------------------------------------------------------------------

  const offs = [
    ctx.net.on(TOPIC.kite, (data, from) => {
      if (disposed || !touchFrame(from)) return;
      const m = decodeKites(data);
      if (!m) return;
      const now = performance.now();
      if (!fleet.accept(m, from, now, clock())) return;
      received++;
      lastHeard = now;
      if (demo) stopDemo();
    }),
    ctx.net.on(TOPIC.ring, (data, from) => {
      if (disposed || !touchFrame(from)) return;
      const m = decodeRing(data);
      if (!m || taken.has(m.ring)) return;
      taken.set(m.ring, { t: m.t, color: m.color, popped: false });
      if (taken.size > MAX_TAKEN) taken.delete(taken.keys().next().value!);
    }),
  ];

  // ---- Tangles ------------------------------------------------------------------------------

  const keyOf = (frameId: string, slot: number) => `${frameId}#${slot}`;
  const splitKey = (key: string): { frame: string; slot: number } | null => {
    const i = key.lastIndexOf("#");
    if (i < 0) return null;
    const slot = Number(key.slice(i + 1));
    return Number.isInteger(slot) ? { frame: key.slice(0, i), slot } : null;
  };
  const tell = (key: string, on: boolean, x: number, y: number) => {
    const k = splitKey(key);
    if (!k || k.frame === "demo" || !ctx.net.online) return;
    ctx.net.send(TOPIC.tangle, encodeTangle({ slot: k.slot, on, x, y }), k.frame);
  };

  const lines: Line[] = [];
  let tangleAt = 0;
  let tangleLast = performance.now();
  let repeatAt = 0;

  // ---- Loop ---------------------------------------------------------------------------------

  const poses: KitePose[] = [];
  const views: KiteView[] = [];
  const viewKeys: string[] = [];
  let lookAt = 0;
  let beaconAt = 0;
  let pokedAt = 0;
  let lastRender = performance.now();
  let flying = 0;

  const demoStep = (dt: number) => {
    if (!demo || !demoSky) return;
    const sky = demoSky;
    const t = clock() / 1000;
    const fn = (x: number, y: number) => windAt(wind.field, t, sky.fOf(x), y) * WIND_SPEED;
    for (const d of demo) {
      const hold = spoolAutopilot(d.spool, t, d.phase, sky.bounds.top, d.pilot.spool, dt);
      stepSpool(d.spool, hold ? SPOOL.hold : 0, fn, sky.bounds, dt);
      if (d.stunt) {
        const h = stuntAutopilot(d.stunt, sky.window, t, d.phase, d.pilot.stunt, dt);
        stepStunt(
          d.stunt,
          { held: true, left: h.left, right: h.right },
          fn,
          sky.window,
          sky.bounds,
          dt,
        );
      }
    }
  };

  const look = (now: number) => {
    fleet.prune(now);
    if (demo || fleet.size > 0 || now - lastHeard <= DEMO_AFTER_MS) return;
    // Give touch frames in the roster a moment to start sending before flying our own kites.
    const touchFrames = ctx.net.peers().some(isTouchFrame);
    if (!touchFrames || now - mountedAt > DEMO_AFTER_MS) startDemo();
  };

  const tailFor = (key: string, shape: Shape, size: number): Tail | null => {
    let t = tails.get(key);
    if (!t) {
      if (tails.size >= MAX_TAILS) return null;
      t = createTail(shape === "dragon" ? 9 : 10, size * 0.16);
      tails.set(key, t);
    }
    tailSeen.add(key);
    return t;
  };

  /** Twist points by kite key, refreshed once a drawing; tangle points are in screen heights. */
  const twists = new Map<string, { x: number; y: number }>();
  const refreshTwists = () => {
    twists.clear();
    for (const t of tangles.active()) {
      const at = { x: t.x * H, y: H - t.y * H };
      if (!twists.has(t.a)) twists.set(t.a, at);
      if (!twists.has(t.b)) twists.set(t.b, at);
    }
  };
  const twistFor = (key: string) => twists.get(key) ?? null;
  /** Kites in the top band, which trail sparkles. */
  const sparkling: number[] = [];
  /** Kites the autopilot flies, this drawing. */
  const autoKeys = new Set<string>();
  let sparkleAt = 0;

  const loop = ctx.loop({
    hz: HZ,
    update(dt) {
      if (disposed) return;
      fleet.tick(dt);
      demoStep(dt);
    },
    render() {
      if (disposed || !gf) return;
      const now = performance.now();
      const dt = Math.min(0.25, (now - lastRender) / 1000);
      lastRender = now;
      const today = new Date().toDateString();
      if (today !== day) {
        day = today;
        counts.rings = counts.tangles = 0;
      }
      if (now >= lookAt) {
        lookAt = now + LOOK_MS;
        look(now);
      }
      wind.tick(now, clock() / 1000);
      if (ctx.net.online && now >= beaconAt) {
        beaconAt = now + BEACON_MS;
        ctx.net.send(TOPIC.sky, encodeSky({ side, delay: fleet.delay }));
      }
      // Kites from frames are drawn `delay` behind the shared clock; the screen's own, now.
      const at = demo ? clock() : clock() - fleet.delay;
      const t = at / 1000;
      const size = BANK_KITE * H;

      views.length = 0;
      viewKeys.length = 0;
      sparkling.length = 0;
      autoKeys.clear();
      tailSeen.clear();
      flying = 0;
      refreshTwists();
      if (demo && demoSky) {
        demo.forEach((d, i) => {
          const color = players[d.color % players.length] ?? "#6fa4fc";
          const ax = (d.spool.ax / demoSky!.width) * W;
          const key = keyOf("demo", i * 2);
          views.push({
            kind: "spool",
            x: (d.spool.x / demoSky!.width) * W,
            y: H - d.spool.y * H,
            spin: d.spool.spin,
            size,
            color,
            shape: d.shape,
            tension: d.spool.tension,
            alpha: 0.9,
            glow: false,
            starts: [{ x: ax, y: H }],
            tail: tailFor(key, d.shape, size),
            twist: d.spool.tangled ? twistFor(key) : null,
          });
          if (d.spool.sparkle) sparkling.push(views.length - 1);
          viewKeys.push(key);
          autoKeys.add(key);
          if (d.stunt) {
            const sk = keyOf("demo", i * 2 + 1);
            views.push({
              kind: "stunt",
              x: (d.stunt.x / demoSky!.width) * W,
              y: H - d.stunt.y * H,
              spin: d.stunt.spin,
              size,
              color,
              shape: "delta",
              tension: d.stunt.tension,
              alpha: 0.9,
              glow: false,
              // As a panel's handles: about 0.29 of a column either side.
              starts: [
                { x: ax - (W / demo!.length) * 0.29, y: H },
                { x: ax + (W / demo!.length) * 0.29, y: H },
              ],
              tail: null,
              twist: d.stunt.tangled ? twistFor(sk) : null,
            });
            viewKeys.push(sk);
            autoKeys.add(sk);
          }
        });
      } else {
        for (const r of fleet.frames()) {
          const n = fleet.poses(r, at, now, poses);
          for (let i = 0; i < n; i++) {
            const p = poses[i]!;
            const key = keyOf(r.frame, p.slot);
            const shape: Shape = SHAPES[p.shape] ?? "diamond";
            const stunt = (p.slot & 1) === 1;
            const a = p.alpha;
            const sx = bankFraction(r.pos, p.u, r.count) * W;
            const sx2 = bankFraction(r.pos, p.u2, r.count) * W;
            // A frame that went quiet reels its kites in as they fade.
            const kx = sx + (p.x * W - sx) * a;
            const ky = H - p.y * H * a;
            const human = (p.flags & FLAG.human) !== 0;
            if (human) flying++;
            views.push({
              kind: stunt ? "stunt" : "spool",
              x: kx,
              y: ky,
              spin: p.spin,
              size,
              color: players[p.color % players.length] ?? "#6fa4fc",
              shape,
              tension: p.tension,
              alpha: a * ((p.flags & FLAG.auto) !== 0 ? 0.85 : 1),
              glow: (p.flags & FLAG.auto) === 0,
              starts: stunt
                ? [
                    { x: sx, y: H },
                    { x: sx2, y: H },
                  ]
                : [{ x: sx, y: H }],
              tail: stunt ? null : tailFor(key, shape, size),
              twist: (p.flags & FLAG.tangled) !== 0 || tangles.caught(key) ? twistFor(key) : null,
            });
            if ((p.flags & FLAG.sparkle) !== 0) sparkling.push(views.length - 1);
            if ((p.flags & FLAG.auto) !== 0) autoKeys.add(key);
            viewKeys.push(key);
          }
        }
      }
      for (const key of tails.keys()) if (!tailSeen.has(key)) tails.delete(key);
      if (flying > 0 && now - pokedAt > 1000) {
        pokedAt = now;
        ctx.idle.poke();
      }

      // Tangles between any two lines on this screen.
      if (config.tangles && now >= tangleAt) {
        const tdt = Math.min(0.5, (now - tangleLast) / 1000);
        tangleAt = now + TANGLE_LOOK_MS;
        tangleLast = now;
        lines.length = 0;
        views.forEach((v, i) => {
          const s0 = v.starts[0]!;
          const s1 = v.starts[v.starts.length - 1]!;
          const key = viewKeys[i]!;
          const k = splitKey(key);
          lines.push({
            key,
            group: k ? `${k.frame}#${k.slot >> 1}` : key,
            auto: autoKeys.has(key),
            x0: (s0.x + s1.x) / 2 / H,
            y0: 0,
            x1: v.x / H,
            y1: (H - v.y) / H,
          });
        });
        for (const e of tangles.update(lines, tdt)) {
          if (e.on) counts.tangles++;
          const fx = (e.x * H) / W;
          tell(e.a, e.on, fx, e.y);
          tell(e.b, e.on, fx, e.y);
          for (const key of [e.a, e.b]) {
            const k = splitKey(key);
            if (!k || k.frame !== "demo" || !demo) continue;
            const d = demo[k.slot >> 1];
            const kite = k.slot & 1 ? d?.stunt : d?.spool;
            if (kite) kite.tangled = e.on;
          }
        }
        if (now >= repeatAt) {
          repeatAt = now + TANGLE_REPEAT_MS;
          for (const tg of tangles.active()) {
            const fx = (tg.x * H) / W;
            tell(tg.a, true, fx, tg.y);
            tell(tg.b, true, fx, tg.y);
          }
        }
      }
      // Rings: the frames' catches pop when the drawing reaches them; the screen's own kites
      // catch them here.
      if (config.rings) {
        ringsAt(wind.field, t, rings);
        for (const [id, c] of taken) {
          if (c.popped || c.t > at) continue;
          c.popped = true;
          counts.rings++;
          tally.set(c.color, (tally.get(c.color) ?? 0) + 1);
          const r = rings.find((x) => x.id === id);
          if (r) {
            const color = players[c.color % players.length] ?? "#ffffff";
            sparkles.emit(r.f * W, H - r.h * H, color, 36, H * 0.05);
          }
        }
        if (demo && demoSky) {
          for (const d of demo) {
            const kite = config.variant === "single" ? d.spool : d.stunt;
            if (!kite || (kite.kind === "stunt" && kite.phase === "down")) continue;
            for (const r of rings) {
              if (taken.has(r.id) || !inRing(r, kite.x, kite.y, demoSky.width, BANK_RING)) continue;
              taken.set(r.id, { t: at, color: d.color, popped: false });
              if (taken.size > MAX_TAKEN) taken.delete(taken.keys().next().value!);
            }
          }
        }
      }

      // Tails and sparkle trails.
      for (const v of views) {
        if (!v.tail) continue;
        const tp = tailPoint(v);
        const w = windAt(wind.field, t, tp.x / W, (H - tp.y) / H) * WIND_SPEED;
        stepTail(v.tail, tp.x, tp.y, w * H * 3, H * 0.8, dt);
      }
      if (now >= sparkleAt) {
        sparkleAt = now + 70;
        for (const i of sparkling) {
          const v = views[i]!;
          const end = v.tail ? { x: v.tail.x[v.tail.n - 1]!, y: v.tail.y[v.tail.n - 1]! } : v;
          sparkles.emit(end.x, end.y, "#fff4c0", 1, H * 0.012);
        }
      }
      sparkles.step(dt);

      gf.setTransform(1, 0, 0, 1, 0, 0);
      gf.clearRect(0, 0, fg.width, fg.height);
      gf.setTransform(k, 0, 0, k, 0, 0);
      scenery.step(dt, t);
      scenery.drawBack(gf, skyRect);
      if (config.rings) {
        drawRings(gf, skyRect, rings, BANK_RING, t, (id) => taken.get(id)?.popped === true);
      }
      scenery.drawFront(gf, skyRect, t, 0.12);
      drawKiteViews(gf, views, Math.max(2.5, H * 0.0009), t);
      sparkles.draw(gf, H * 0.006);
      drawTally(gf, skyRect, tally, players, H * 0.009);
      const credit = wind.attribution;
      if (credit) drawAttribution(gf, credit, W - H * 0.01, H * 0.012, H * 0.009, "right");
    },
  });
  loop.start();

  const offResize = ctx.onResize((f) => {
    frame = f;
    setupCanvas();
    if (demo) startDemo();
  });

  const debugKey = "__kites";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => ({
          screen: true,
          demo: demo !== null,
          delay: fleet.delay,
          received,
          clock: clock(),
          width: W,
          height: H,
          frames: [...fleet.frames()].map((r) => ({ frame: r.frame, pos: r.pos, count: r.count })),
          kites: views.map((v, i) => ({
            key: viewKeys[i],
            kind: v.kind,
            x: v.x,
            y: v.y,
            alpha: v.alpha,
            glow: v.glow,
            starts: v.starts.map((s) => ({ ...s })),
            twist: v.twist,
          })),
          tangles: tangles.active().map((tg) => ({ ...tg })),
          tally: [...tally],
          rings: counts.rings,
          tangleCount: counts.tangles,
          wind: wind.status(),
          attribution: wind.attribution,
          gusts: wind.field.commanded.length,
        }),
        command(name: string) {
          if (name === "gust") wind.commandGust();
        },
      },
    });
  }

  return {
    reset() {
      tally.clear();
      taken.clear();
      sparkles.clear();
      for (const e of tangles.clear()) {
        tell(e.a, false, e.x, e.y);
        tell(e.b, false, e.x, e.y);
      }
      if (demo && demoSky) {
        const s = wind.dir(clock() / 1000) >= 0 ? 1 : -1;
        for (const d of demo) {
          resetSpool(d.spool, s);
          if (d.stunt) resetStunt(d.stunt, demoSky.window, s);
          d.pilot.spool = spoolPilot(d.phase);
          d.pilot.stunt = stuntPilot();
        }
      }
    },
    attract() {},
    status() {
      const w = wind.status();
      return {
        frames: fleet.size,
        kites: views.length,
        flying,
        demo: demo !== null,
        rings: counts.rings,
        tangles: counts.tangles,
        wind: w.source,
        windSpeed: w.speed,
        delay: Math.round(fleet.delay),
      };
    },
    command(name) {
      if (name === "gust") wind.commandGust();
    },
    dispose() {
      disposed = true;
      loop.stop();
      for (const off of offs) off();
      offResize();
      wind.dispose();
      scenery.dispose();
      fleet.clear();
      tails.clear();
      taken.clear();
      sparkles.clear();
      bg.remove();
      fg.remove();
      demo = null;
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
