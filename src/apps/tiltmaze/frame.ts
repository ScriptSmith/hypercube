/**
 * A touch frame: one board (or two on a pair side by side, or 2 to 4 on a wall), each with its
 * pad, its demonstration and maybe a bot, and the frame's own marble run and jar at the top. In a
 * bank, finished balls go up the tube and out of the top edge to the screen instead, and the
 * frame shows its own jar only while it hears no screen.
 */
import type { AppContext, AppInstance, FrameInfo, FrameKind, Pointer } from "../../core/types";
import { createRenderer3D } from "../../core/renderer3d";
import { type Board, createBoard } from "./board";
import { type BoardView, createBoardView } from "./boardview";
import { type Bot, createBot } from "./bots";
import {
  HANDLING,
  HELP_AFTER_MS,
  IN_USE_MS,
  MAX_LEVEL,
  PEOPLE_IDLE_MS,
  readConfig,
} from "./config";
import { createControls } from "./controls";
import { createGlass, type Glass, Z_RAIL, Z_TUBE } from "./glass";
import { type Layout, type LayoutInput, layoutFor, withOrient } from "./layout";
import { createUplink, type Uplink } from "./link";
import { ACCENTS, createLook } from "./look";
import { createOverlay, type PadState } from "./overlay";
import { createPilot, fullAccel, type Pilot } from "./pilot";
import { createRun } from "./run";
import { buildPlan, fitCapacity, pathFor, type RunPlan, tubeTop } from "./runplan";
import { createRunView, type TubeShape } from "./runview";

/** Ball radius in a bank, glass metres: the frames' tubes and the screen's must match. */
export const BANK_RB = 0.045;
/** Ball size on a frame's own run, venue px of radius. */
const BALL_PX: Record<FrameKind, number> = {
  panel: 24,
  pair: 24,
  kiosk: 22,
  wall: 34,
  screen: 30,
  sphere: 30,
};
/** A finished ball counts as a person's if someone touched its board this recently. */
const HUMAN_MS = 30_000;
const BACKGROUND =
  "radial-gradient(ellipse 90% 60% at 50% 62%, #2a2018 0%, #15110e 55%, #08070a 100%)";

export const mountFrame = (ctx: AppContext): AppInstance => {
  const config = readConfig(ctx.variant, ctx.options);
  const handling = HANDLING[config.speed];
  const setup = ctx.setup;
  let frame: FrameInfo = ctx.frame;
  const kind = frame.kind;
  const inBank = setup.name === "bank" && (kind === "panel" || kind === "pair");
  const together = kind === "pair" && config.pair === "together";
  const inputOf = (f: FrameInfo): LayoutInput => {
    const u = f.unit;
    return {
      kind: f.kind,
      width: f.width / u,
      height: f.height / u,
      reachTop: { adult: f.reachTop.adult / u, child: f.reachTop.child / u },
      seams: f.seams.map((s) => s / u),
      boards: config.boards,
      together,
    };
  };
  let layout: Layout = layoutFor(inputOf(frame));
  ctx.root.style.background = BACKGROUND;
  const now = () => performance.now();
  const clock = () => ctx.clock.now();

  // Every frame of a group gets the same seed; in a bank, mix in the position so mazes differ.
  const base = ctx.rng().fork(inBank ? `tiltmaze:${setup.pos}` : "tiltmaze");
  const boards: Board[] = layout.boards.map((slot, i) =>
    createBoard({
      index: i,
      orient: slot.orient,
      holes: config.variant === "holes",
      handling,
      rng: base.fork(`board:${i}`),
      human: () => now() - (boards[i]?.lastHuman ?? -Infinity) < HUMAN_MS,
    }),
  );
  const fixOrients = (l: Layout): Layout => ({
    ...l,
    boards: l.boards.map((s, i) => withOrient(s, boards[i]?.orient ?? s.orient)),
  });
  const aMax = fullAccel(handling.maxTilt);
  const botSpeed = config.speed === "lively" ? 0.36 : 0.26;
  const pilotFor = (label: string, pace: number, mistakes: boolean): Pilot =>
    createPilot({
      rng: base.fork(label),
      speed: botSpeed * pace,
      aMax,
      damping: handling.damping,
      mistakes,
    });
  const demos = boards.map((_, i) => pilotFor(`demo:${i}`, 0.62, true));
  const helpers = boards.map((_, i) => pilotFor(`help:${i}`, 0.7, false));

  const look = createLook();
  const r3 = createRenderer3D(ctx.root, frame, { alpha: true });
  r3.renderer.setClearColor(0x000000, 0);
  r3.renderer.autoClear = false;
  const views: BoardView[] = boards.map((b) => createBoardView(look, b));
  const runView = createRunView(look);
  const overlay = createOverlay(ctx.root);
  const run = createRun(clock);
  const controls = createControls(layout);

  let glass: Glass = createGlass(frame, setup);
  let plan: RunPlan | null = null;
  let out = false;
  let epoch: number | null = null;
  const bumpedAt = boards.map(() => Number.NEGATIVE_INFINITY);
  const axisTouch = boards.map(() => ({
    h: Number.NEGATIVE_INFINITY,
    v: Number.NEGATIVE_INFINITY,
  }));
  /** When each lever's current spell of use began. */
  const axisSince = boards.map(() => ({
    h: Number.NEGATIVE_INFINITY,
    v: Number.NEGATIVE_INFINITY,
  }));
  const helping = boards.map(() => ({ h: false, v: false }));

  const uplink: Uplink | null = inBank
    ? createUplink(ctx.net, setup.side ?? 0, now, (e) => {
        if (epoch === null || e < epoch) {
          epoch = e;
          return;
        }
        if (e === epoch) return;
        epoch = e;
        // The jar above filled: everyone playing steps up a level.
        boards.forEach((b, i) => {
          if (b.mode === "demo") return;
          b.level = Math.min(MAX_LEVEL, b.level + 1);
          bumpedAt[i] = now();
        });
      })
    : null;

  const planFor = (l: Layout, g: Glass): RunPlan => {
    const tl = g.toGlass(l.run.x0, l.run.top);
    const right = g.toGlass(l.run.x1, l.run.top);
    const low = g.toGlass(l.run.jar.cx, l.run.railBottom);
    const floor = g.toGlass(l.run.jar.cx, l.run.jar.floor);
    const maxW = l.run.jar.maxW * g.mPerPx;
    const maxH = Math.max(0, low.y - floor.y);
    // Balls look a little bigger on the rails, which stand in front of the tubes.
    const tubeScale = g.scaleAt(Z_RAIL) / g.scaleAt(Z_TUBE);
    const rb = inBank ? BANK_RB / tubeScale : null;
    return buildPlan({
      rb,
      tubeScale,
      rbMax: BALL_PX[kind] * g.mPerPx,
      capacity: inBank ? fitCapacity(BANK_RB / tubeScale, maxW, maxH, config.jar) : config.jar,
      x0: tl.x,
      x1: right.x,
      top: tl.y,
      railBottom: low.y,
      jar: { cx: low.x, floor: floor.y, maxW },
    });
  };

  const tubes = () =>
    layout.boards.map((s) => {
      const p = glass.toGlass(s.tube.x, s.tube.y);
      return { x: p.x, yBase: p.y };
    });

  const tubeShapes = (): TubeShape[] => {
    const rb = plan?.tubeRb ?? BANK_RB;
    return tubes().map((t) => {
      if (out || !plan) return { x: t.x, y0: t.yBase, y1: glass.top + 1, lip: false, base: true };
      const path = pathFor(plan, t.x);
      const top = path ? tubeTop(plan, path, t.x) : t.yBase + rb * 4;
      return { x: t.x, y0: t.yBase, y1: top + rb * 1.25, lip: true, base: true };
    });
  };

  const rebuildRun = () => {
    runView.build(out ? null : plan, glass, tubeShapes(), plan?.tubeRb ?? BANK_RB);
  };

  const tubeWidthPx = () => {
    const rb = plan?.tubeRb ?? BANK_RB;
    return ((2 * rb * 1.28) / glass.mPerPx) * frame.unit;
  };

  const place = () => {
    glass = createGlass(frame, setup);
    plan = planFor(layout, glass);
    run.setPlan(plan);
    run.setTubes(tubes());
    const tw = tubeWidthPx();
    layout.boards.forEach((slot, i) => views[i]?.setSlot(slot, frame.unit, tw));
    overlay.setup(layout, frame);
    rebuildRun();
  };
  layout = fixOrients(layout);
  place();
  for (const v of views) r3.prepare(v.scene, v.camera);
  r3.prepare(runView.scene, runView.camera);

  // ---- Level buttons ------------------------------------------------------------------------

  let buttons: HTMLElement[] = [];
  const touchedBy = (i: number) => {
    const b = boards[i];
    if (!b) return;
    b.lastHuman = now();
    b.mode = "people";
  };
  const buildButtons = () => {
    for (const el of buttons) el.remove();
    const u = frame.unit;
    buttons = layout.boards.flatMap((slot, i) =>
      (["minus", "plus"] as const).map((which) => {
        const c = slot[which];
        return ctx.ui.button({
          icon: which === "minus" ? "−" : "+",
          rect: { x: (c.x - c.r) * u, y: (c.y - c.r) * u, width: 2 * c.r * u, height: 2 * c.r * u },
          look: "ghost",
          color: ACCENTS[i % ACCENTS.length],
          onPress: () => {
            const b = boards[i];
            if (!b) return;
            touchedBy(i);
            b.setLevel(b.level + (which === "minus" ? -1 : 1));
          },
        });
      }),
    );
  };
  buildButtons();

  // ---- Bots and input -----------------------------------------------------------------------

  const botCount = Math.max(0, Math.round(ctx.bots));
  const bots: Bot[] = [];
  if (together) {
    const b = boards[0]!;
    (["h", "v"] as const).slice(0, botCount).forEach((axis) =>
      bots.push(
        createBot({
          input: ctx.input,
          board: b,
          slot: () => layout.boards[0],
          unit: () => frame.unit,
          pilot: pilotFor(`bot:${axis}`, 1, true),
          axis,
        }),
      ),
    );
  } else {
    boards.slice(0, botCount).forEach((b, i) =>
      bots.push(
        createBot({
          input: ctx.input,
          board: b,
          slot: () => layout.boards[i],
          unit: () => frame.unit,
          pilot: pilotFor(`bot:${i}`, 1, true),
          axis: "both",
        }),
      ),
    );
  }
  const botted = new Set(bots.map((b) => b.board));
  let touches = 0;

  const venueOf = (p: Pointer) => ({ x: p.x / frame.unit, y: p.y / frame.unit });
  const offs = [
    ctx.input.on("down", (p) => {
      const v = venueOf(p);
      const hit = controls.down(p.id, v.x, v.y, p.synthetic);
      if (!hit) return;
      if (!p.synthetic) {
        touches++;
        touchedBy(hit.board);
      }
    }),
    ctx.input.on("move", (p) => {
      const v = venueOf(p);
      controls.move(p.id, v.x, v.y);
    }),
    ctx.input.on("up", (p) => controls.up(p.id)),
    ctx.input.on("cancel", (p) => controls.up(p.id)),
  ];

  // ---- Loop ---------------------------------------------------------------------------------

  const resetBoard = (i: number) => {
    const b = boards[i];
    if (!b) return;
    b.lastHuman = Number.NEGATIVE_INFINITY;
    b.mode = botted.has(i) ? "bot" : "demo";
    b.reset();
    demos[i]?.reset();
    helpers[i]?.reset();
  };

  const steerBoard = (i: number, dt: number, t: number) => {
    const b = boards[i]!;
    const slot = layout.boards[i];
    const people = t - b.lastHuman < PEOPLE_IDLE_MS;
    const mode = people ? "people" : botted.has(i) ? "bot" : "demo";
    if (b.mode === "people" && mode !== "people") {
      // Nobody has touched it for a while: back to the first level and the demonstration.
      b.mode = mode;
      resetBoard(i);
    }
    b.mode = mode;
    if (slot?.levers) {
      const h = controls.lever(i, "h");
      const v = controls.lever(i, "v");
      const at = axisTouch[i]!;
      const since = axisSince[i]!;
      for (const [k, held] of [
        ["h", h],
        ["v", v],
      ] as const) {
        if (!held) continue;
        if (t - at[k] > IN_USE_MS) since[k] = t;
        at[k] = t;
        if (!held.synthetic) b.lastHuman = t;
      }
      const demo = b.mode === "demo";
      const auto = demo ? demos[i]!.update(dt, b) : null;
      const help = helpers[i]!.update(dt, b);
      // One lever in use for a while and the other untouched: the other helps by itself.
      const hh =
        !h &&
        !demo &&
        t - at.v < IN_USE_MS &&
        t - since.v >= HELP_AFTER_MS &&
        t - at.h > HELP_AFTER_MS;
      const hv =
        !v &&
        !demo &&
        t - at.h < IN_USE_MS &&
        t - since.h >= HELP_AFTER_MS &&
        t - at.v > HELP_AFTER_MS;
      helping[i]!.h = hh;
      helping[i]!.v = hv;
      const x = h ? h.v : auto ? auto.x : hh ? help.x : 0;
      const y = v ? v.v : auto ? auto.y : hv ? help.y : 0;
      b.steer(x, y);
      return;
    }
    const p = controls.pad(i);
    if (p) {
      if (!p.synthetic) b.lastHuman = t;
      b.steer(p.x, p.y);
    } else if (b.mode === "demo") {
      const c = demos[i]!.update(dt, b);
      b.steer(c.x, c.y);
    } else b.steer(0, 0);
  };

  const launch = (i: number, color: number, human: boolean) => {
    if (out && uplink) {
      const r = run.launchOut(i, color, human, glass.top);
      if (r)
        uplink.drop({ b: i, n: boards.length, c: color, t: r.t, v: r.v * 1000, h: human ? 1 : 0 });
    } else {
      run.launch(i, color, human);
    }
  };

  let simMs = 0;
  let lastRender = now();
  let disposed = false;
  const states: PadState[] = boards.map((_, i) => ({
    command: { x: 0, y: 0 },
    tilt: { x: 0, y: 0 },
    touched: false,
    ghost: false,
    lever: { h: false, v: false, helpH: false, helpV: false },
    accent: ACCENTS[i % ACCENTS.length]!,
    level: 1,
    bumped: 99,
  }));

  const loop = ctx.loop({
    hz: 120,
    update(dt) {
      if (disposed) return;
      simMs += dt * 1000;
      const t = now();
      if (uplink) {
        const nowOut = uplink.screen() !== null;
        if (nowOut !== out) {
          out = nowOut;
          if (out) run.clear();
          rebuildRun();
        }
      }
      for (const bot of bots) bot.update(dt, t);
      for (let i = 0; i < boards.length; i++) {
        steerBoard(i, dt, t);
        const b = boards[i]!;
        b.step(dt);
        for (const e of b.events) if (e.type === "finished") launch(i, e.color, e.human);
        b.events.length = 0;
      }
      run.step(dt);
      run.events.length = 0;
    },
    render() {
      if (disposed) return;
      const t = now();
      const dt = Math.min(0.1, (t - lastRender) / 1000);
      lastRender = t;
      const time = t / 1000;
      // The loop's alpha isn't passed through here; drawing the latest step is smooth at 120 Hz.
      boards.forEach((b, i) => views[i]?.sync(b, 1, time));
      runView.sync(run, time, dt);
      boards.forEach((b, i) => {
        const s = states[i]!;
        s.command.x = b.command.x;
        s.command.y = b.command.y;
        s.tilt.x = b.tilt.x / handling.maxTilt;
        s.tilt.y = b.tilt.z / handling.maxTilt;
        s.touched = controls.pad(i) !== null;
        s.ghost = b.mode === "demo";
        s.lever.h = controls.lever(i, "h") !== null;
        s.lever.v = controls.lever(i, "v") !== null;
        s.lever.helpH = helping[i]!.h;
        s.lever.helpV = helping[i]!.v;
        s.level = b.level;
        s.bumped = (t - bumpedAt[i]!) / 1000;
      });
      overlay.draw(states, time);
      if (!r3.ready) return;
      const R = r3.renderer;
      R.setScissorTest(false);
      R.clear();
      R.setScissorTest(true);
      const H = frame.height;
      for (const v of views) {
        const l = v.lane;
        R.setViewport(l.x, H - l.y - l.height, l.width, l.height);
        R.setScissor(l.x, H - l.y - l.height, l.width, l.height);
        R.render(v.scene, v.camera);
      }
      R.setScissorTest(false);
      R.setViewport(0, 0, frame.width, frame.height);
      R.clearDepth();
      R.render(runView.scene, runView.camera);
    },
  });
  loop.start();

  let resizeTimer = 0;
  const offResize = ctx.onResize((f) => {
    frame = f;
    layout = fixOrients(layoutFor(inputOf(f)));
    controls.setLayout(layout);
    for (const b of bots) b.release();
    r3.resize(f);
    place();
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (!disposed) buildButtons();
    }, 150);
  });

  const resetAll = () => {
    for (let i = 0; i < boards.length; i++) resetBoard(i);
    for (const a of [...axisTouch, ...axisSince]) a.h = a.v = Number.NEGATIVE_INFINITY;
    controls.clear();
    for (const b of bots) b.release();
  };

  const command = (name: string) => {
    if (name === "reset") resetAll();
    else if (name === "empty") run.empty();
  };

  /** How far the ball could roll each way before touching a wall, metres (for tests). */
  const roomOf = (b: Board) => {
    const m = b.maze;
    const r = m.r;
    const probe = (dx: number, dz: number) => {
      for (let d = 0; d <= 0.06; d += 0.001) {
        const x = b.ball.x + dx * d;
        const z = b.ball.z + dz * d;
        const hit = m.boxes.some((box) => {
          const qx = Math.min(box.x1, Math.max(box.x0, x));
          const qz = Math.min(box.z1, Math.max(box.z0, z));
          return Math.hypot(x - qx, z - qz) < r;
        });
        if (hit) return Math.max(0, d - 0.001);
      }
      return 0.06;
    };
    return { left: probe(-1, 0), right: probe(1, 0), far: probe(0, -1), near: probe(0, 1) };
  };

  const debugKey = "__tiltmaze";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => ({
          screen: false,
          unit: frame.unit,
          ready: r3.ready,
          sim: simMs / 1000,
          inBank,
          out,
          toScreen: uplink?.screen() ?? null,
          sent: uplink?.sent ?? 0,
          epoch,
          layout: {
            width: layout.width,
            height: layout.height,
            boards: layout.boards.map((s) => ({
              pad: s.pad,
              levers: s.levers,
              tube: s.tube,
              minus: s.minus,
              plus: s.plus,
              lane: s.lane,
              focus: s.focus,
              orient: s.orient,
            })),
          },
          glass: {
            top: glass.top,
            tubes: tubes().map((t) => t.x),
            edgeStage: tubes().map((t) => glass.toVenue(t.x, glass.top)),
          },
          boards: boards.map((b, i) => ({
            level: b.level,
            phase: b.phase,
            mode: b.mode,
            ball: { x: b.ball.x, z: b.ball.z, vx: b.ball.vx, vz: b.ball.vz },
            tilt: { ...b.tilt },
            command: { ...b.command },
            color: b.color,
            counts: { ...b.counts },
            maze: {
              cols: b.maze.cols,
              rows: b.maze.rows,
              r: b.maze.r,
              holes: b.maze.holes.length,
            },
            room: roomOf(b),
            bot: bots.find((x) => x.board === i)?.active ?? false,
            helping: { ...helping[i]! },
          })),
          run: {
            jar: { ...run.jar },
            capacity: plan?.jar.capacity ?? 0,
            balls: run.balls.map((b) => ({ state: b.state, tube: b.tube, x: b.x, y: b.y })),
            counts: { ...run.counts },
          },
          particles: runView.particles,
        }),
        command,
      },
    });
  }

  return {
    reset() {
      resetAll();
    },
    attract() {},
    status() {
      return {
        boards: boards.length,
        levels: boards.map((b) => b.level).join(","),
        playing: boards.filter((b) => b.mode === "people").length,
        finished: boards.reduce((n, b) => n + b.counts.finished, 0),
        falls: boards.reduce((n, b) => n + b.counts.falls, 0),
        jar: run.jar.count,
        touches,
        ...(uplink ? { sent: uplink.sent, screen: uplink.screen() !== null } : {}),
      };
    },
    command(name) {
      command(name);
    },
    homeSpot(size) {
      const u = frame.unit;
      return {
        x: Math.max(0, Math.min(frame.width - size, layout.home.x * u)),
        y: Math.max(0, Math.min(frame.height - size, layout.home.y * u)),
      };
    },
    dispose() {
      disposed = true;
      loop.stop();
      uplink?.dispose();
      clearTimeout(resizeTimer);
      offResize();
      for (const off of offs) off();
      for (const b of bots) b.dispose();
      controls.clear();
      for (const el of buttons) el.remove();
      buttons = [];
      overlay.dispose();
      for (const v of views) v.dispose();
      runView.dispose();
      look.dispose();
      r3.dispose();
      run.clear();
      ctx.root.style.background = "";
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
