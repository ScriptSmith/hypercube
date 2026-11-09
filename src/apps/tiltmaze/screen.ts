/**
 * The screen: one big marble run in 3D. Above a bank, each touch frame's tubes carry straight on
 * up from the screen's bottom edge exactly above where they left the frame (both are one object
 * in venue space, seen through window views; no measuring), balls pop out onto zigzag rails and
 * roll down into the jar in the middle. A full jar celebrates, empties through its trapdoor and
 * tells every frame to step its boards up a level.
 *
 * Alone, or above a bank whose frames have all gone, it feeds itself from imaginary boards.
 */
import type { AppContext, AppInstance, FrameInfo } from "../../core/types";
import { createRenderer3D } from "../../core/renderer3d";
import { readConfig } from "./config";
import { BANK_RB } from "./frame";
import {
  bankEdge,
  bankTubes,
  type Column,
  createGlass,
  type Glass,
  Z_SCREEN_RAIL,
  Z_TUBE,
} from "./glass";
import { createDownlink } from "./link";
import { createLook } from "./look";
import { createRun } from "./run";
import { buildPlan, pathFor, type RunPlan, tubeTop } from "./runplan";
import { createRunView, type TubeShape } from "./runview";
import { PHASES } from "./wire";

const BACKGROUND = "linear-gradient(180deg, #0b0d16 0%, #121524 55%, #1a1712 100%)";
/** With no frames below for this long, the screen feeds itself. */
const ALONE_MS = 8000;
const FEED_MS = 2600;
const SOLO_TUBES = 5;
const MAX_RECENT = 16;

export const mountScreen = (ctx: AppContext): AppInstance => {
  const config = readConfig(ctx.variant, ctx.options);
  const setup = ctx.setup;
  let frame: FrameInfo = ctx.frame;
  const inBank = setup.name === "bank";
  const side = setup.side ?? 0;
  const count = () => Math.max(1, setup.count);
  const now = () => performance.now();
  const clock = () => ctx.clock.now();
  ctx.root.style.background = BACKGROUND;

  const look = createLook();
  const r3 = createRenderer3D(ctx.root, frame, { alpha: true });
  r3.renderer.setClearColor(0x000000, 0);
  r3.renderer.autoClear = false;
  const runView = createRunView(look);
  const run = createRun(clock, 160);
  const rng = ctx.rng().fork("tiltmaze-screen");

  let span = 1;
  let glass: Glass = createGlass(frame, setup);
  let plan: RunPlan | null = null;
  /** Boards per column, as their drops said (a pair together has one). */
  const boardsAt = new Map<number, number>();
  let tubeKeys: string[] = [];
  let columnOf: number[] = [];
  let epoch = 0;
  const recent: { pos: number; b: number; t: number; at: number; tube: number }[] = [];
  let lastFrameSeen = Number.NEGATIVE_INFINITY;
  let feedAt = 0;
  const counts = { drops: 0, fed: 0 };

  const spanOf = () => {
    const s = link.stations();
    return s.some((p) => p.kind === "pair")
      ? Math.max(2, ...s.map((p) => p.span ?? 2))
      : s.length
        ? 1
        : 0;
  };

  const planFor = (g: Glass): RunPlan => {
    const W = frame.width / frame.unit;
    const H = frame.height / frame.unit;
    const tl = g.toGlass(W * 0.03, H * 0.05);
    const right = g.toGlass(W * 0.97, H * 0.05);
    const low = g.toGlass(W / 2, H * 0.52);
    const floor = g.toGlass(W / 2, H * 0.9);
    // The rails stand in front of the wall, so balls there look bigger than in the tubes.
    const tubeScale = g.scaleAt(Z_SCREEN_RAIL) / g.scaleAt(Z_TUBE);
    return buildPlan({
      rb: (inBank ? BANK_RB : 30 * g.mPerPx) / tubeScale,
      tubeScale,
      rbMax: 1,
      capacity: config.jar,
      x0: tl.x,
      x1: right.x,
      top: tl.y,
      railBottom: low.y,
      jar: { cx: low.x, floor: floor.y, maxW: W * 0.3 * g.mPerPx },
      maxDrop: 26,
    });
  };

  /** The tubes rising into this screen: from the bank's frames, or imaginary boards. */
  const tubeList = () => {
    const yBase = Math.min(bankEdge(), glass.toGlass(0, frame.height / frame.unit).y) - 0.1;
    if (!inBank) {
      const W = frame.width / frame.unit;
      tubeKeys = [];
      columnOf = [];
      return Array.from({ length: SOLO_TUBES }, (_, i) => {
        tubeKeys.push(`solo:${i}`);
        columnOf.push(i);
        const g = glass.toGlass(W * (0.12 + (0.76 * i) / (SOLO_TUBES - 1)), 0);
        return { x: g.x, yBase };
      });
    }
    const n = count();
    const present = new Map(link.stations().map((p) => [p.pos, p]));
    const columns: Column[] = [];
    for (let pos = 0; pos < n; pos++) {
      const peer = present.get(pos);
      const pair = peer ? peer.kind === "pair" : span >= 2;
      const kind = pair ? "pair" : "panel";
      columns.push({ pos, kind, boards: boardsAt.get(pos) ?? (pair ? 2 : 1) });
    }
    const list = bankTubes(columns, n, Math.max(1, span));
    tubeKeys = list.map((t) => `${t.pos}:${t.board}`);
    columnOf = list.map((t) => t.pos);
    return list.map((t) => ({ x: t.x, yBase }));
  };

  const shapes = (list: { x: number; yBase: number }[]): TubeShape[] =>
    list.map((t) => {
      const path = plan ? pathFor(plan, t.x) : null;
      const top = plan && path ? tubeTop(plan, path, t.x) : t.yBase + 1;
      return {
        x: t.x,
        y0: t.yBase,
        y1: top + (plan?.tubeRb ?? BANK_RB) * 1.25,
        lip: true,
        base: false,
      };
    });

  let shapeKey = "";
  const refreshTubes = (force = false) => {
    const list = tubeList();
    const key = list.map((t) => t.x.toFixed(4)).join(",");
    if (!force && key === shapeKey) return;
    shapeKey = key;
    run.setTubes(list);
    runView.build(plan, glass, shapes(list), plan?.tubeRb ?? BANK_RB, Z_SCREEN_RAIL);
  };

  const place = () => {
    glass = createGlass(frame, setup, inBank && span > 0 ? { span } : {});
    plan = planFor(glass);
    run.setPlan(plan);
    refreshTubes(true);
  };

  const link = createDownlink(ctx.net, { side, count, now }, (m, column, peer) => {
    lastFrameSeen = now();
    if (peer.kind === "pair" && boardsAt.get(column) !== m.n) {
      if (boardsAt.size > 64) boardsAt.clear();
      boardsAt.set(column, m.n);
      refreshTubes();
    }
    const tube = tubeKeys.indexOf(`${column}:${m.b}`);
    if (tube < 0) return;
    counts.drops++;
    if (recent.length >= MAX_RECENT) recent.shift();
    recent.push({ pos: column, b: m.b, t: m.t, at: clock(), tube });
    run.arrive(tube, m.c, m.h === 1, m.t, bankEdge(), m.v / 1000);
  });

  span = Math.max(1, spanOf());
  place();
  r3.prepare(runView.scene, runView.camera);

  const offPeers = ctx.net.onPeers(() => {
    const s = spanOf();
    if (s > 0 && s !== span) {
      span = s;
      place();
    } else refreshTubes();
  });

  let disposed = false;
  let lastRender = now();
  const loop = ctx.loop({
    hz: 60,
    update(dt) {
      if (disposed) return;
      const t = now();
      if (link.stations().length > 0) lastFrameSeen = Math.max(lastFrameSeen, t - ALONE_MS / 2);
      // Alone, imaginary boards keep the run going.
      const alone = !inBank || t - lastFrameSeen > ALONE_MS;
      if (alone && t >= feedAt && run.tubes.length > 0) {
        feedAt = t + FEED_MS * (0.6 + rng.next() * 0.8);
        const tube = rng.int(run.tubes.length);
        const rb = plan?.tubeRb ?? BANK_RB;
        run.arrive(tube, rng.int(8), false, clock() + 50, run.tubes[tube]!.yBase, 58 * rb);
        counts.fed++;
      }
      run.step(dt);
      for (const e of run.events) {
        if (e.type === "emptied") {
          epoch++;
          link.level(epoch);
        }
      }
      run.events.length = 0;
      link.tick({
        j: run.jar.count,
        cap: plan?.jar.capacity ?? config.jar,
        p: PHASES.indexOf(run.jar.phase),
        e: epoch,
      });
    },
    render() {
      if (disposed) return;
      const t = now();
      const dt = Math.min(0.1, (t - lastRender) / 1000);
      lastRender = t;
      runView.sync(run, t / 1000, dt);
      if (!r3.ready) return;
      const R = r3.renderer;
      R.clear();
      R.render(runView.scene, runView.camera);
    },
  });
  loop.start();

  const offResize = ctx.onResize((f) => {
    frame = f;
    r3.resize(f);
    place();
  });

  const debugKey = "__tiltmaze";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => ({
          screen: true,
          ready: r3.ready,
          clock: clock(),
          unit: frame.unit,
          span,
          count: count(),
          edge: bankEdge(),
          bottom: glass.toGlass(0, frame.height / frame.unit).y,
          tubes: run.tubes.map((tb, i) => ({
            key: tubeKeys[i],
            pos: columnOf[i],
            x: tb.x,
            stage: glass.toVenue(tb.x, glass.toGlass(0, frame.height / frame.unit).y),
          })),
          balls: run.balls.map((b) => ({
            state: b.state,
            tube: b.tube,
            pos: columnOf[b.tube] ?? -1,
            x: b.x,
            y: b.y,
            stage: glass.toVenue(b.x, b.y),
          })),
          jar: { ...run.jar },
          capacity: plan?.jar.capacity ?? 0,
          rails: plan?.rails ?? 0,
          counts: { ...run.counts, ...counts },
          recent: recent.map((r) => ({ ...r })),
          epoch,
          particles: runView.particles,
        }),
        command: (name: string) => {
          if (name === "empty") run.empty();
        },
      },
    });
  }

  return {
    reset() {
      // The jar is everyone's: an idle screen keeps its balls.
    },
    attract() {},
    status() {
      return {
        jar: run.jar.count,
        capacity: plan?.jar.capacity ?? config.jar,
        drops: counts.drops,
        frames: link.stations().length,
        epoch,
      };
    },
    command(name) {
      if (name === "empty") run.empty();
    },
    dispose() {
      disposed = true;
      loop.stop();
      link.dispose();
      offPeers();
      offResize();
      runView.dispose();
      look.dispose();
      r3.dispose();
      run.clear();
      ctx.root.style.background = "";
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
