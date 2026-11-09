/**
 * The screen above a bank: one crane above every panel, each in its own thin lane directly over
 * the frame below, with the yard deck along the bottom edge where blocks arrive.
 *
 * The screen simulates every crane (it is authoritative). Each touch frame aims its cranes'
 * hooks with its pads, presses release and sends blocks up its lift; the screen tells each frame
 * how its cranes stand about five times a second (link.ts). A block a frame sends rises out of
 * the bottom edge where that frame's lift left its top edge, at the size it had there, and grows
 * to the screen's size as it comes up into the yard. A crane nobody aims for 10 s drives itself,
 * and lanes with no frame below are fed slowly by themselves, so a screen alone still builds.
 *
 * Canvas2D in two layers, over the same sky as the frames.
 */
import { bankFraction } from "../../core/layout";
import { createRng } from "../../core/rng";
import type { AppContext, AppInstance, FrameInfo, PeerInfo } from "../../core/types";
import { type G, mix, rgba } from "./art";
import { drawBackdrop, makeBackdrop, type Backdrop } from "./backdrop";
import { AUTO_AFTER_MS, BH, BLOCK_DRAW_W, HZ, readConfig, SELF_FEED_MS } from "./config";
import { type Crane, createCrane } from "./crane";
import { createDownlink } from "./link";
import { defaultLiftShare, type ScreenColumn, type ScreenLayout, screenLayout } from "./layout";
import { type Driver, geoFromCrane, geoKey, stateFromCrane } from "./model";
import { createParticles } from "./particles";
import { createPilot, type Pilot } from "./pilot";
import { buildingsAnimating, buildingsKey, drawSiteDynamic, drawSiteStatic } from "./scene";
import { createSkyLayer, phaseAt, windowLight } from "./sky";
import { ST_MS, GEO_MS } from "./link";

/** A lone screen (no bank) shows this many cranes. */
const LONE_LANES = 4;
/** A held pad not heard from for this long has let go (its frame went). */
const PAD_GONE_MS = 3000;
/** Exit reports go stale after this long without one. */
const EXIT_TTL_MS = 10_000;
const RENDER_MS = 1000 / 40;

interface Lane {
  key: string;
  column: ScreenColumn;
  crane: Crane;
  pilot: Pilot;
  lastPad: number;
  held: boolean;
  driver: Driver;
  gen: number;
  geoKey: string;
  geoAt: number;
  feedAt: number;
}

export const mountScreen = (ctx: AppContext): AppInstance => {
  const config = readConfig(ctx.variant, ctx.options);
  const side = ctx.setup.side ?? 0;
  const inBank = ctx.setup.name === "bank";
  let frame: FrameInfo = ctx.frame;
  const W = () => frame.width / frame.unit;
  const H = () => frame.height / frame.unit;
  const now = () => performance.now();
  const base = ctx.rng().fork("skyline-screen");
  const fx = createRng(`${ctx.seed}:screen-fx`);
  const palette = ctx.ui.palette.players;

  const sky = createSkyLayer(ctx.root, createRng(`${ctx.seed}:sky`).next);
  const make = (z: number) => {
    const c = document.createElement("canvas");
    c.style.cssText = `position:absolute;inset:0;width:100%;height:100%;z-index:${z};pointer-events:none;`;
    ctx.root.append(c);
    return c;
  };
  const backCanvas = make(1);
  const frontCanvas = make(2);
  const back = backCanvas.getContext("2d");
  const g = frontCanvas.getContext("2d");
  const particles = createParticles();
  let k = 1;
  let backdrop: Backdrop | null = null;

  // ---- Lanes -------------------------------------------------------------------------------

  const exits = new Map<string, { u: number; w: number; at: number }>();
  let lanes: Lane[] = [];
  let layout: ScreenLayout = screenLayout(W(), H(), [], config.variant);
  let shape = "";
  let lastStations: PeerInfo[] = [];

  const columnsFor = (stations: readonly PeerInfo[]): ScreenColumn[] => {
    if (!inBank) {
      return Array.from({ length: LONE_LANES }, (_, i) => ({
        pos: i,
        crane: 0,
        from: i / LONE_LANES,
        width: 1 / LONE_LANES,
        liftAt: defaultLiftShare("panel", 0, config.variant),
        mast: "left" as const,
      }));
    }
    const count = Math.max(1, ctx.setup.count, ...stations.map((p) => p.pos + 1));
    const spanOf = (p: PeerInfo | undefined) => (p?.kind === "pair" ? Math.max(2, p.span ?? 2) : 1);
    // Frames not here yet are taken to be like the ones that are.
    const usual = stations.length > 0 ? spanOf(stations[0]) : 1;
    const out: ScreenColumn[] = [];
    for (let pos = 0; pos < count; pos++) {
      const peer = stations.find((p) => p.pos === pos);
      const span = peer ? spanOf(peer) : usual;
      const kind = span > 1 ? "pair" : "panel";
      for (let c = 0; c < Math.min(2, span); c++) {
        out.push({
          pos,
          crane: c,
          from: (pos + c / span) / count,
          width: 1 / (count * span),
          liftAt: defaultLiftShare(kind, c, config.variant),
          mast: c === 1 ? "right" : "left",
        });
      }
    }
    return out;
  };

  const rebuild = (stations: readonly PeerInfo[]) => {
    const columns = columnsFor(stations);
    const key = columns.map((c) => `${c.pos}.${c.crane}:${c.width.toFixed(4)}`).join("|");
    if (key === shape) return;
    shape = key;
    layout = screenLayout(W(), H(), columns, config.variant);
    const old = new Map(lanes.map((l) => [l.key, l]));
    lanes = layout.cranes.map((cl, i) => {
      const laneKey = `${cl.column.pos}:${cl.column.crane}`;
      const prev = old.get(laneKey);
      // A lane of the same width keeps its crane and buildings.
      if (prev && Math.abs(prev.column.width - cl.column.width) < 1e-6) {
        return { ...prev, column: cl.column };
      }
      const crane = createCrane({
        world: cl.world,
        variant: config.variant,
        assist: config.assist,
        wind: config.wind,
        rng: base.fork(`lane:${laneKey}`),
      });
      return {
        key: laneKey,
        column: cl.column,
        crane,
        pilot: createPilot({
          rng: base.fork(`pilot:${laneKey}`),
          hand: {
            aim: (x, y) => crane.setTargetNorm(x, y),
            release: () => crane.release(),
            rest: () => {},
          },
        }),
        lastPad: Number.NEGATIVE_INFINITY,
        held: false,
        driver: "auto",
        gen: 1,
        geoKey: "",
        geoAt: Number.NEGATIVE_INFINITY,
        feedAt: now() + 2000 + i * 700,
      };
    });
    backKey = "";
  };

  const laneOf = (pos: number, c: number) =>
    lanes.find((l) => l.column.pos === pos && l.column.crane === c) ?? null;

  /** How far below the ground (world units) the screen's bottom edge is, for arrivals. */
  const depthOf = (lane: Lane) => {
    const cl = layout.cranes[lanes.indexOf(lane)];
    if (!cl) return -BH;
    return -((H() - cl.scene.gy) / cl.scene.s + BH * 0.6);
  };

  const link = createDownlink(
    ctx.net,
    { side, now },
    {
      pad(pos, m) {
        const lane = laneOf(pos, m.c);
        if (!lane) return;
        lane.lastPad = now();
        lane.held = m.h === 1;
        lane.driver = m.b ? "bot" : "person";
        lane.pilot.reset();
        lane.crane.setTargetNorm(m.x / 1000, m.y / 1000);
      },
      release(pos, m) {
        const lane = laneOf(pos, m.c);
        if (!lane) return;
        lane.lastPad = now();
        lane.driver = m.b ? "bot" : "person";
        lane.pilot.reset();
        lane.crane.release();
      },
      block(pos, m) {
        laneOf(pos, m.c)?.crane.arrive(m.k, depthOf(laneOf(pos, m.c)!));
      },
      exit(pos, m) {
        exits.set(`${pos}:${m.c}`, { u: m.u / 1000, w: m.w / 1000, at: now() });
        if (exits.size > 64) {
          const first = exits.keys().next().value;
          if (first !== undefined) exits.delete(first);
        }
      },
    },
  );

  /** Where a lane's frame says its lift leaves (venue px of this screen), or null. */
  const exitOf = (lane: Lane): { x: number; w: number } | null => {
    const e = exits.get(lane.key);
    if (!e) return null;
    if (now() - e.at > EXIT_TTL_MS) {
      exits.delete(lane.key);
      return null;
    }
    const count = inBank ? Math.max(1, ...lanes.map((l) => l.column.pos + 1)) : LONE_LANES;
    return { x: bankFraction(lane.column.pos, e.u, count) * W(), w: (e.w / count) * W() };
  };

  // ---- Drawing -----------------------------------------------------------------------------

  const size = () => {
    const ratio = Math.min(frame.pixelRatio, 2);
    for (const c of [backCanvas, frontCanvas]) {
      c.width = Math.max(1, Math.round(frame.width * ratio));
      c.height = Math.max(1, Math.round(frame.height * ratio));
    }
    k = frame.unit * ratio;
    backdrop = makeBackdrop(W(), layout.ground, 0.3, 2.2, createRng(`${ctx.seed}:backdrop`).next);
    sky.resize(frame.width, frame.height, layout.ground * frame.unit, frame.unit);
    backKey = "";
  };

  const colorOf = (i: number) => palette[i % palette.length]!;

  const drawShaft = (ctx2: G, x: number, w: number, top: number, bottom: number, color: string) => {
    ctx2.fillStyle = "rgba(10,16,30,0.6)";
    ctx2.fillRect(x - w / 2, top, w, bottom - top);
    ctx2.strokeStyle = mix("#59627a", color, 0.35);
    ctx2.lineWidth = Math.max(2, w * 0.04);
    ctx2.beginPath();
    ctx2.moveTo(x - w / 2, top);
    ctx2.lineTo(x - w / 2, bottom);
    ctx2.moveTo(x + w / 2, top);
    ctx2.lineTo(x + w / 2, bottom);
    ctx2.stroke();
  };

  let backKey = "";
  const drawBack = (night: number, t: number) => {
    if (!back) return;
    back.setTransform(1, 0, 0, 1, 0, 0);
    back.clearRect(0, 0, backCanvas.width, backCanvas.height);
    back.setTransform(k, 0, 0, k, 0, 0);
    if (backdrop) drawBackdrop(back, backdrop, night, 2.2);
    const gy = layout.ground;
    // The yard deck along the bottom edge.
    const deck = back.createLinearGradient(0, gy, 0, H());
    deck.addColorStop(0, "#2a3346");
    deck.addColorStop(1, "#141a28");
    back.fillStyle = deck;
    back.fillRect(0, gy, W(), H() - gy);
    back.fillStyle = "#3a4560";
    back.fillRect(0, gy - 4, W(), 10);
    lanes.forEach((lane, i) => {
      const cl = layout.cranes[i];
      if (!cl) return;
      drawSiteStatic(back, cl.scene, lane.crane, {
        color: colorOf(i),
        light: windowLight(night),
        assist: config.assist,
        footY: H(),
        t,
      });
      const e = exitOf(lane);
      const x = e?.x ?? cl.lift.x;
      const w = e?.w ?? cl.lift.width;
      drawShaft(back, x, w, gy, H(), colorOf(i));
    });
  };

  const drawFront = (night: number, t: number, dt: number) => {
    if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, frontCanvas.width, frontCanvas.height);
    g.setTransform(k, 0, 0, k, 0, 0);
    lanes.forEach((lane, i) => {
      const cl = layout.cranes[i];
      if (!cl) return;
      const e = exitOf(lane);
      const sc = cl.scene;
      const bottom = depthOf(lane);
      drawSiteDynamic(g, sc, lane.crane, {
        color: colorOf(i),
        light: windowLight(night),
        assist: config.assist,
        t,
        rise: (x, y) => {
          // From the frame's lift (its place and size at the bezel) to the screen's own.
          const f = Math.max(0, Math.min(1, (y - bottom) / (BH / 2 - bottom)));
          const ease = f * f * (3 - 2 * f);
          const fromX = e ? (e.x - sc.ox) / sc.s : x;
          const frameBlock = e ? (e.w / 1.12) * BLOCK_DRAW_W : BLOCK_DRAW_W * sc.s;
          const start = frameBlock / (BLOCK_DRAW_W * sc.s);
          return { dx: (fromX - x) * (1 - ease), scale: start + (1 - start) * ease };
        },
      });
      // Who drives: a soft ring under a person's crane cab.
      if (lane.driver === "person" && now() - lane.lastPad < AUTO_AFTER_MS) {
        const mx = sc.ox + lane.crane.world.mastX * sc.s;
        const my = sc.gy - lane.crane.world.jibY * sc.s;
        g.strokeStyle = rgba(colorOf(i), 0.5 + 0.3 * Math.sin(t * 4));
        g.lineWidth = Math.max(3, 0.06 * sc.s);
        g.beginPath();
        g.arc(mx, my, 0.9 * sc.s, 0, Math.PI * 2);
        g.stroke();
      }
    });
    particles.step(dt);
    particles.draw(g);
  };

  // ---- Loop --------------------------------------------------------------------------------

  const effects = (lane: Lane, i: number) => {
    const cl = layout.cranes[i];
    const crane = lane.crane;
    if (!cl) {
      crane.events.length = 0;
      return;
    }
    const sc = cl.scene;
    for (const e of crane.events) {
      if (e.type === "finished") {
        const lot = crane.lots[e.lot];
        if (!lot) continue;
        for (let j = 0; j < 4; j++) {
          const x = sc.ox + (lot.left + fx.next() * lot.bp.cols) * sc.s;
          const y = sc.gy - lot.bp.rows * BH * (0.4 + 0.6 * fx.next()) * sc.s;
          particles.burst(
            x,
            y,
            {
              n: 14,
              speed: 2.4 * sc.s,
              size: 0.07 * sc.s,
              colors: [colorOf(i), "#ffffff", "#ffd581"],
              fall: 1.2 * sc.s,
              up: 0.8 * sc.s,
            },
            fx.next,
          );
        }
      } else if (e.type === "capped" && crane.tower) {
        const x = sc.ox + crane.tower.x * sc.s;
        const y = sc.gy - crane.tower.blocks.length * BH * sc.s;
        particles.burst(
          x,
          y,
          {
            n: 40,
            speed: 3 * sc.s,
            size: 0.08 * sc.s,
            colors: [colorOf(i), "#ffffff", "#ffd581"],
            fall: 1.2 * sc.s,
            up: sc.s,
          },
          fx.next,
        );
      }
    }
    crane.events.length = 0;
  };

  let stAt = Number.NEGATIVE_INFINITY;
  let disposed = false;
  let lastRender = 0;
  let simSeconds = 0;

  const tick = (dt: number) => {
    const t = now();
    simSeconds += dt;
    const stations = inBank ? link.stations() : [];
    if (
      stations.length !== lastStations.length ||
      stations.some(
        (p, i) => p.frame !== lastStations[i]?.frame || p.kind !== lastStations[i]?.kind,
      )
    ) {
      lastStations = stations;
      rebuild(stations);
    }
    lanes.forEach((lane, i) => {
      const frameHere = stations.some((p) => p.pos === lane.column.pos);
      if (lane.held && t - lane.lastPad > PAD_GONE_MS) {
        // The frame holding this pad went quiet: its crane runs itself now.
        lane.held = false;
        lane.lastPad = Number.NEGATIVE_INFINITY;
      }
      if (t - lane.lastPad > AUTO_AFTER_MS) lane.driver = "auto";
      if (lane.driver === "auto") lane.pilot.update(dt, lane.crane.readout());
      // Lanes with nobody below are fed slowly, so the skyline keeps growing.
      if (!frameHere && t >= lane.feedAt) {
        lane.feedAt = t + SELF_FEED_MS * (1 + 0.6 * fx.next());
        if (lane.crane.freeSlots() > 0) {
          const kind = config.variant === "tall" || fx.next() < 0.8 ? fx.int(3) : 3;
          lane.crane.arrive(kind, depthOf(lane));
        }
      }
      lane.crane.step(dt);
      effects(lane, i);
    });
    if (t - stAt >= ST_MS) {
      stAt = t;
      for (const p of stations) {
        const mine = lanes.filter((l) => l.column.pos === p.pos);
        if (mine.length === 0) continue;
        const cr = mine.map((l) => {
          const key = geoKey(l.crane);
          if (key !== l.geoKey) {
            l.geoKey = key;
            l.gen++;
            l.geoAt = Number.NEGATIVE_INFINITY;
          }
          return stateFromCrane(l.crane, l.column.crane, l.gen, l.driver, config.assist);
        });
        if (mine.some((l) => t - l.geoAt >= GEO_MS)) {
          const geo = mine.map((l) => {
            l.geoAt = t;
            const cl = layout.cranes[lanes.indexOf(l)]!;
            const mast = {
              u: (cl.scene.ox + l.crane.world.mastX * cl.scene.s - cl.lane.x) / cl.lane.width,
              w: (0.42 * cl.scene.s) / cl.lane.width,
            };
            return geoFromCrane(l.crane, l.column.crane, l.gen, mast);
          });
          link.sendGeo(p.frame, { s: side, cr: geo });
        }
        link.send(p.frame, { s: side, cr });
      }
    }
  };

  rebuild([]);
  size();

  /** Debug only: simulation steps per tick. */
  let speed = 1;
  let phaseOverride: number | null = null;
  const loop = ctx.loop({
    hz: HZ,
    update(dt) {
      if (disposed) return;
      for (let i = 0; i < speed; i++) tick(dt);
    },
    render() {
      if (disposed) return;
      const t = now();
      if (t - lastRender < RENDER_MS) return;
      const dt = Math.min(0.1, (t - lastRender) / 1000);
      lastRender = t;
      const colours = sky.update(
        dt,
        phaseOverride ?? phaseAt(ctx.clock.now()),
        lanes[0]?.crane.wind ?? 0,
      );
      const night = colours.night;
      let key = `${Math.round(night * 40)}:${shape}`;
      let animating = false;
      for (const l of lanes) {
        key += `:${buildingsKey(l.crane)}`;
        if (buildingsAnimating(l.crane)) animating = true;
        const e = exits.get(l.key);
        if (e) key += `:${e.u.toFixed(3)},${e.w.toFixed(3)}`;
      }
      if (animating || key !== backKey) {
        backKey = key;
        drawBack(night, t / 1000);
      }
      drawFront(night, t / 1000, dt);
    },
  });
  loop.start();

  const offResize = ctx.onResize((f) => {
    frame = f;
    shape = "";
    rebuild(lastStations);
    size();
  });

  const command = (name: string) => {
    if (name === "clear") for (const l of lanes) l.crane.clear();
  };

  const debugKey = "__skyline";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => ({
          screen: true,
          sim: simSeconds,
          width: W(),
          height: H(),
          ground: layout.ground,
          stations: link.stations().length,
          lanes: lanes.map((l, i) => {
            const cl = layout.cranes[i]!;
            const e = exitOf(l);
            return {
              pos: l.column.pos,
              crane: l.column.crane,
              from: l.column.from,
              width: l.column.width,
              driver: l.driver,
              carrying: l.crane.carrying?.kind ?? -1,
              counts: { ...l.crane.counts },
              yard: l.crane.yard.map((b) => b?.kind ?? -1),
              loose: l.crane.loose.map((x) => ({ state: x.state, x: x.x, y: x.y })),
              lots: l.crane.lots.map((lot) => ({
                phase: lot.phase,
                slots: lot.bp.slots.length,
                filled: lot.filled.filter((x) => x !== null).length,
              })),
              tower: l.crane.tower
                ? { floors: l.crane.tower.blocks.length, phase: l.crane.tower.phase }
                : null,
              shaft: e ?? { x: cl.lift.x, w: cl.lift.width },
              reported: e !== null,
              liftX: cl.lift.x,
              mast: { x: cl.scene.ox + l.crane.world.mastX * cl.scene.s, w: 0.42 * cl.scene.s },
              hook: l.crane.hook(),
              target: { ...l.crane.target },
            };
          }),
          particles: particles.list.length,
        }),
        command,
        speed: (k: number) => {
          speed = Math.max(1, Math.min(20, Math.round(k)));
        },
        /** Hold the sky at a time of day (0..1, null to follow the clock). */
        phase: (p: number | null) => {
          phaseOverride = p;
        },
      },
    });
  }

  return {
    // The skyline is everyone's: an idle timeout (a screen is never touched) keeps it.
    reset() {
      particles.clear();
    },
    attract() {},
    status() {
      const sum = (k2: "placed" | "finished") => lanes.reduce((n, l) => n + l.crane.counts[k2], 0);
      return {
        lanes: lanes.length,
        placed: sum("placed"),
        finished: sum("finished"),
        frames: link.stations().length,
        drivers: lanes.map((l) => l.driver[0]).join(""),
      };
    },
    command(name) {
      command(name);
    },
    dispose() {
      disposed = true;
      loop.stop();
      offResize();
      link.dispose();
      particles.clear();
      sky.dispose();
      backCanvas.remove();
      frontCanvas.remove();
      lanes = [];
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
