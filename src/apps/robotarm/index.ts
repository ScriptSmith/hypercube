/**
 * Robot Arm. Wires the pieces together:
 *
 * - kinematics.ts the joints, their limits and forward kinematics; ik.ts the autopilot's inverse
 * - bench.ts      the workbench, bins, pad and slots; pieces.ts the pieces and their physics
 * - cell.ts       one arm: servos, the clamp, the gripper and the held piece
 * - layout.ts     where the views and controls go; controls.ts touches on them
 * - pilot.ts      the autopilot's plans; driver.ts carries them out by turning dials
 * - view.ts       three.js; panel.ts the dials' DOM; bots.ts injected touches
 *
 * Standalone. Each arm is in its demonstration until someone touches its controls; it goes back
 * to it after a while untouched, and the whole frame resets on idle.
 */
import type { AppContext, AppInstance, FrameInfo, Pointer } from "../../core/types";
import { benchFor } from "./bench";
import { createBot, type Bot } from "./bots";
import { type Cell, createCell } from "./cell";
import { DEMO_REST_MS, HZ, PEOPLE_IDLE_MS, readConfig } from "./config";
import { type Controls, createControls } from "./controls";
import { createDirectHand, createDriver, type Driver } from "./driver";
import { GRIP, JOINT_COUNT, SPEED_SCALE } from "./kinematics";
import { layoutFor, type Layout, type LayoutInput } from "./layout";
import { createOrbit, type Orbit } from "./orbit";
import { type CellLook, createPanel, type Panel } from "./panel";
import { createUplink, type Uplink } from "./link";
import { riseTime, UP_S } from "./pieces";
import { mountScreen } from "./screen";
import { createView } from "./view";

const inRect = (r: { x: number; y: number; width: number; height: number }, x: number, y: number) =>
  x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;

/** A lifted piece counts as a person's if someone touched the arm this recently. */
const HUMAN_MS = 30_000;
const NO_NEEDS = [0, 0, 0] as const;
/** The beam's place goes to the screen at most this often while it moves, and at least this often. */
const BEAM_GAP_MS = 150;
const BEAM_HEARTBEAT_MS = 3000;
const MAX_PENDING = 8;

const BACKGROUND =
  "radial-gradient(ellipse 80% 70% at 50% 38%, #18213a 0%, #0b1022 55%, #05070d 100%)";

export const mount = (ctx: AppContext): AppInstance => {
  if (ctx.frame.kind === "screen" || ctx.setup.role === "screen") return mountScreen(ctx);
  const config = readConfig(ctx.variant, ctx.options);
  const setup = ctx.setup;
  // In a bank each frame keeps its own arm and bench, plus a lift up to the screen above.
  const inBank = setup.name === "bank" && (ctx.frame.kind === "panel" || ctx.frame.kind === "pair");
  let frame: FrameInfo = ctx.frame;
  const arms = frame.kind === "wall" ? config.arms : 1;
  const inputOf = (f: FrameInfo): LayoutInput => {
    const u = f.unit;
    return {
      kind: f.kind,
      width: f.width / u,
      height: f.height / u,
      reachTop: { adult: f.reachTop.adult / u, child: f.reachTop.child / u },
      seams: f.seams.map((s) => s / u),
      arms,
    };
  };
  let layout: Layout = layoutFor(inputOf(frame));
  ctx.root.style.background = BACKGROUND;

  // Every frame of a group gets the same seed; in a bank, mix in the position so the benches
  // and bots differ from frame to frame.
  const base = ctx.rng().fork(inBank ? `robotarm:${setup.pos}` : "robotarm");
  const cells: Cell[] = Array.from({ length: arms }, (_, i) =>
    createCell({
      index: i,
      bench: benchFor(config.variant, inBank),
      config,
      rng: base.fork(`cell:${i}`),
    }),
  );
  const uplink: Uplink | null = inBank
    ? createUplink(ctx.net, setup.side ?? 0, () => performance.now())
    : null;
  const controls: Controls = createControls(cells, layout);
  const orbits: Orbit[] = layout.cells.map((c) => createOrbit(c.lane.width));
  const view = createView(ctx.root, cells, config.guides);
  view.setup(frame, layout);
  let panel: Panel = createPanel(ctx.root, layout, frame.unit, frame.pixelRatio);
  let resets: HTMLElement[] = [];
  const speed = SPEED_SCALE[config.speed];
  let simMs = 0;
  const now = () => performance.now();

  const buildResets = () => {
    for (const b of resets) b.remove();
    const u = frame.unit;
    resets = layout.cells.map((cl, i) => {
      const r = cl.reset;
      return ctx.ui.button({
        icon: "reset",
        rect: { x: (r.x - r.r) * u, y: (r.y - r.r) * u, width: 2 * r.r * u, height: 2 * r.r * u },
        hold: 1000,
        look: "ghost",
        color: "#c9d3ea",
        onPress: () => {
          // A person pressed it: bots on this arm stand back.
          const cell = cells[i];
          if (cell) cell.lastHuman = now();
          resetCell(i);
        },
      });
    });
  };

  // The demonstration: an autopilot per arm on ghost fingers.
  const demos: Driver[] = cells.map((cell, i) =>
    createDriver({
      cell,
      layout: () => layout.cells[i],
      hand: createDirectHand(controls, "ghost", now),
      rng: base.fork(`demo:${i}`),
      speed,
      restAtHome: true,
      // An unattended bank sends one piece in three up, so the screen makes slow progress.
      liftEvery: 3,
      rest: DEMO_REST_MS / 1000,
      onStuck: () => cell.home(),
    }),
  );

  // Bots on injected touches: one per arm on a wall, up to `bots`; the one arm elsewhere.
  const botCount = Math.min(cells.length, Math.max(0, Math.round(ctx.bots)));
  const bots: Bot[] = cells.slice(0, botCount).map((cell, i) =>
    createBot({
      input: ctx.input,
      cell,
      layout: () => layout.cells[i],
      unit: () => frame.unit,
      rng: base.fork(`bot:${i}`),
      speed,
    }),
  );
  const botted = new Set(bots.map((b) => b.cell));

  const resetCell = (i: number) => {
    const cell = cells[i];
    if (!cell) return;
    demos[i]?.release();
    bots.find((b) => b.cell === i)?.release();
    for (const [id, h] of controls.holds) if (h.cell === i) controls.up(id);
    cell.reset();
    cell.lastTouch = now();
  };

  // ---- Input --------------------------------------------------------------------------------

  const venueOf = (p: Pointer) => ({ x: p.x / frame.unit, y: p.y / frame.unit });
  /** Fingers turning a view, by the arm they turn. */
  const viewing = new Map<number, number>();
  const lift = (p: Pointer, up: boolean) => {
    controls.up(p.id);
    const i = viewing.get(p.id);
    if (i === undefined) return;
    viewing.delete(p.id);
    // A tap on the view (no drag) shows which controls move the arm.
    const tap = orbits[i]?.end(p.id, up ? p.vx / frame.unit : 0, now()) ?? false;
    if (tap && up) hintAt[i] = now();
  };
  const offs = [
    ctx.input.on("down", (p) => {
      const v = venueOf(p);
      if (controls.down(p.id, v.x, v.y, p.synthetic ? "bot" : "person", now())) return;
      // A touch on the view turns that arm's view; bots only use the controls.
      if (p.synthetic) return;
      const i = layout.cells.findIndex((c) => inRect(c.lane, v.x, v.y));
      if (i < 0) return;
      viewing.set(p.id, i);
      orbits[i]?.begin(p.id, v.x, v.y, now());
    }),
    ctx.input.on("move", (p) => {
      const v = venueOf(p);
      const i = viewing.get(p.id);
      if (i !== undefined) orbits[i]?.move(p.id, v.x, v.y, now());
      else controls.move(p.id, v.x, v.y, now());
    }),
    ctx.input.on("up", (p) => lift(p, true)),
    ctx.input.on("cancel", (p) => lift(p, false)),
  ];

  // ---- Loop ---------------------------------------------------------------------------------

  // ---- The bank's beam ----------------------------------------------------------------------

  /** Pieces on their way up the beam, sent to the screen as they leave the frame. */
  const pending: { at: number; c: number; k: number; h: number }[] = [];
  let toldScreen: string | null = null;
  let toldAt = Number.NEGATIVE_INFINITY;
  let toldU = -1;
  let toldW = -1;
  /** Tell the screen where the beam leaves: when first heard, when it moves, and now and then. */
  const tellBeam = (t: number) => {
    const screen = uplink?.screen() ?? null;
    if (!uplink || !screen) {
      toldScreen = null;
      return;
    }
    const b = view.beam(0);
    if (!b) return;
    const moved = Math.abs(b.u - toldU) > 0.002 || Math.abs(b.w - toldW) > 0.002;
    const due =
      screen !== toldScreen ||
      (moved && t - toldAt >= BEAM_GAP_MS) ||
      t - toldAt >= BEAM_HEARTBEAT_MS;
    if (!due) return;
    if (uplink.sendExit({ p: setup.pos, u: b.u * 1000, w: b.w * 1000 })) {
      toldScreen = screen;
      toldAt = t;
      toldU = b.u;
      toldW = b.w;
    }
  };

  const held: boolean[][] = cells.map(() => Array.from({ length: JOINT_COUNT }, () => false));
  const hintAt: number[] = cells.map(() => Number.NEGATIVE_INFINITY);
  const looks: CellLook[] = cells.map(() => ({
    dials: Array.from({ length: JOINT_COUNT }, () => ({
      target: 0,
      actual: 0,
      held: false,
      blocked: 99,
      limited: 99,
    })),
    grip: { closed: false, open: 1, holding: null, ready: null },
    ghosts: [],
    hint: 99,
  }));
  let lastRender = now();
  let disposed = false;

  const loop = ctx.loop({
    hz: HZ,
    update(dt) {
      if (disposed) return;
      simMs += dt * 1000;
      const t = now();
      cells.forEach((cell, i) => {
        // Alone on a frame, the runtime's idle reset brings the demonstration back instead.
        if (cells.length > 1 && cell.mode === "people" && t - cell.lastTouch > PEOPLE_IDLE_MS) {
          cell.mode = "demo";
          demos[i]?.release();
        }
        const demo = demos[i];
        if (demo) {
          if (cell.mode === "demo" && !botted.has(i)) demo.update(dt);
          else if (demo.step) demo.release();
        }
      });
      if (uplink) {
        const needs = uplink.needs();
        for (const c of cells) c.table.setLift(needs !== null, needs ?? NO_NEEDS);
        tellBeam(t);
        while (pending.length > 0 && pending[0]!.at <= t) {
          const p = pending.shift()!;
          uplink.send({ c: p.c, k: p.k, p: setup.pos, u: (view.beam(0)?.u ?? 0.5) * 1000, h: p.h });
        }
      }
      for (const b of bots) b.update(dt, t);
      for (const c of cells) c.step(dt);
    },
    render(alpha) {
      if (disposed) return;
      const t = now();
      const dt = Math.min(0.1, (t - lastRender) / 1000);
      lastRender = t;
      cells.forEach((cell, i) => {
        const h = held[i]!;
        for (let j = 0; j < JOINT_COUNT; j++) h[j] = controls.holder(i, j) !== null;
        for (const e of cell.events) {
          view.event(i, e);
          if (e.type === "lifted" && uplink) {
            // Tell the screen when the piece reaches the frame's top edge, so it carries on
            // from there rather than appearing before it has gone.
            const human = cell.mode === "people" && t - cell.lastHuman < HUMAN_MS;
            const piece = cell.table.pieces.find((q) => q.id === e.piece);
            const length = Math.max(0, (view.beam(i)?.length ?? 0) - (piece?.half ?? 0));
            if (pending.length >= MAX_PENDING) pending.shift();
            pending.push({
              at: t + Math.min(UP_S * 1000, riseTime(length) * 1000),
              c: e.color,
              k: e.kind === "ball" ? 1 : 0,
              h: human ? 1 : 0,
            });
          }
        }
        cell.events.length = 0;
        const look = looks[i]!;
        for (let j = 0; j < JOINT_COUNT; j++) {
          const d = look.dials[j]!;
          d.target = cell.target[j]!;
          d.actual = cell.q[j]!;
          d.held = h[j]!;
          d.blocked = cell.blocked[j]!;
          d.limited = cell.limited[j]!;
        }
        const g = cell.grip;
        const hp = cell.heldPiece();
        look.grip.closed = g.closed;
        look.grip.open = g.gap / GRIP.openHalf;
        look.grip.holding = hp ? { color: hp.color, kind: hp.kind } : null;
        let ready: number | null = null;
        if (!hp && !g.closed) {
          const pose = cell.pose;
          const cand = cell.table.grabCandidate(
            {
              grip: pose.grip,
              approach: pose.approach,
              close: pose.close,
              side: pose.side,
              tool: pose.tool,
            },
            g.gap,
          );
          ready = cand ? cand.piece.color : null;
        }
        look.grip.ready = ready;
        look.ghosts = cell.mode === "demo" && !botted.has(i) ? (demos[i]?.fingers ?? []) : [];
        look.hint = (t - hintAt[i]!) / 1000;
      });
      orbits.forEach((o, i) => {
        o.step(dt, t);
        view.setOrbit(i, o.azimuth, o.elevation);
      });
      view.draw(cells, alpha, dt, held);
      panel.update(looks, t / 1000);
    },
  });
  loop.start();
  buildResets();

  let resizeTimer = 0;
  const offResize = ctx.onResize((f) => {
    frame = f;
    layout = layoutFor(inputOf(f));
    controls.setLayout(layout);
    viewing.clear();
    layout.cells.forEach((c, i) => orbits[i]?.setSpan(c.lane.width));
    for (const d of demos) d.release();
    for (const b of bots) b.release();
    view.setup(frame, layout);
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (disposed) return;
      panel.dispose();
      panel = createPanel(ctx.root, layout, frame.unit, frame.pixelRatio);
      buildResets();
    }, 150);
  });

  const resetAll = () => {
    for (let i = 0; i < cells.length; i++) resetCell(i);
    for (const o of orbits) o.home();
    viewing.clear();
    for (const c of cells) {
      c.mode = "demo";
      c.lastTouch = Number.NEGATIVE_INFINITY;
    }
    controls.clear();
  };

  const command = (name: string) => {
    if (name === "reset") resetAll();
    else if (name === "demo") for (const c of cells) c.mode = "demo";
  };

  const botStats = (i: number) => {
    const b = bots.find((x) => x.cell === i);
    return b ? { ...b.driver.stats } : null;
  };

  const debugKey = "__robotarm";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => ({
          unit: frame.unit,
          ready: view.ready,
          sim: simMs / 1000,
          particles: view.particles,
          layout: {
            width: layout.width,
            height: layout.height,
            cells: layout.cells.map((c) => ({
              lane: c.lane,
              focus: c.focus,
              dials: c.dials,
              grip: c.grip,
              reset: c.reset,
            })),
          },
          cells: cells.map((c, i) => ({
            mode: c.mode,
            view: { azimuth: orbits[i]!.azimuth, elevation: orbits[i]!.elevation },
            q: [...c.q],
            target: [...c.target],
            grip: { closed: c.grip.closed, gap: c.grip.gap, held: c.grip.held },
            pose: { grip: c.pose.grip, approach: c.pose.approach },
            counts: { ...c.counts },
            clearance: c.clearance(),
            demoStep: demos[i]?.step?.label ?? null,
            demoStats: { ...demos[i]!.stats },
            botStats: botStats(i),
            botStep: bots.find((b) => b.cell === i)?.driver.step?.label ?? null,
            pieces: c.table.pieces.map((p) => ({
              id: p.id,
              kind: p.kind,
              color: p.color,
              state: p.state,
              pos: { ...p.pos },
              support: p.support,
            })),
            towerTop: c.table.towerTop(),
            beam: view.beam(i),
            lift: c.table.lift
              ? { active: c.table.lift.active, needs: [...c.table.lift.needs] }
              : null,
          })),
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
      const sum = (k: "sorted" | "towers" | "grabs" | "drops" | "sent") =>
        cells.reduce((n, c) => n + c.counts[k], 0);
      return {
        arms: cells.length,
        playing: cells.filter((c) => c.mode === "people").length,
        grabs: sum("grabs"),
        sorted: sum("sorted"),
        towers: sum("towers"),
        ...(uplink ? { sent: sum("sent"), screen: uplink.screen() !== null } : {}),
      };
    },
    command(name) {
      command(name);
    },
    homeSpot(size) {
      const u = frame.unit;
      const h = layout.home;
      return { x: Math.min(frame.width - size, h.x * u), y: Math.max(0, h.y * u) };
    },
    dispose() {
      disposed = true;
      loop.stop();
      uplink?.dispose();
      clearTimeout(resizeTimer);
      offResize();
      for (const off of offs) off();
      for (const d of demos) d.release();
      for (const b of bots) b.dispose();
      controls.clear();
      panel.dispose();
      for (const b of resets) b.remove();
      view.dispose();
      ctx.root.style.background = "";
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
