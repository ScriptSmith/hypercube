/**
 * A touch frame: its stages, their controls and the show. Solo frames stand alone. A bank's frame
 * shows its own slice of the bank's shared shape (link.ts): its lever moves only its slice, its
 * dials and buttons turn the shape for everyone, and it tells the screen where its slice is.
 */
import { Color } from "three";
import type { AppContext, AppInstance, FrameInfo, OptionValue, Pointer } from "../../core/types";
import { type Bot, createBot } from "./bots";
import {
  BACKGROUND,
  type Config,
  familyAt,
  frameColor,
  HZ,
  NEAR_COLOR,
  readConfig,
  SLICE_COLOR,
  TIMING,
} from "./config";
import {
  coastLever,
  type Controls,
  createControls,
  type LeverState,
  releaseLever,
  type Who,
} from "./controls";
import { createFlat, type Flat } from "./flat";
import { DIAL_PLANES, type Layout, layoutFor, leverX, type StageLayout } from "./layout";
import { CUT_FLAG, createCutSender, createShared, type CutSender, type Shared } from "./link";
import { autoAzimuth, createOrbit, type Orbit } from "./orbit";
import { ease, pathAt, presetPath, restRot, startTurning, type Turning, turningAt } from "./orient";
import { createPanel, type Panel, type StageLook } from "./panel";
import {
  copyMat,
  identity,
  type Mat4,
  planeTurn,
  mul,
  orthonormalize,
  slerpRot,
  turnBy,
  type Vec4,
} from "./rot";
import type { SliceSlot } from "./scenes";
import { type Dim, FAMILIES, shapeOf, type Shape } from "./shapes";
import { type ShowPose, showAt, SHOW_S } from "./show";
import { cutOf, extent, HIDDEN, leverOf, slice2, turned } from "./slice";
import { createPainter, type Painter, type Port, type PortKind } from "./view";
import { quantCut } from "./wire";

/** A bank frame's lever eases back to its place this long after its last touch. */
const BANK_LEVER_IDLE_MS = 30_000;
/** A bank frame's "first" button stays lit this long after its press. */
const BANK_ACTIVE_MS = 4000;

interface StageRun {
  dim: Dim;
  /** People's orientation (solo). */
  rot: Mat4;
  turning: Turning | null;
  lever: LeverState;
  dials: number[];
  mode: "show" | "people";
  lastTouch: number;
  lastHuman: number;
  active: number | null;
  activeAt: number;
  orbit: Orbit;
  /** What was drawn last, and an ease from it back into the show. */
  shown: Mat4;
  shownLever: number;
  blend: { rot: Mat4; lever: number; at: number } | null;
  ports: Port[];
  flat: Flat | null;
}

/** The bank's default slice: its place in a flip-book of the shape at rest. */
export const defaultLever = (shape: Shape, pos: number, count: number): number => {
  const e = extent(shape, restRot(shape), HIDDEN[shape.dim]);
  const n = Math.max(1, count);
  const p = Math.min(Math.max(0, pos), n - 1);
  return leverOf(shape.dim, e.lo + ((e.hi - e.lo) * (p + 0.5)) / n);
};

/** The turn a dial's finger angle makes: on a 2D stage the shape follows the finger round. */
export const dialTurn = (dim: Dim, delta: number): number => (dim === 2 ? -delta : delta);

export const dimsFor = (kind: FrameInfo["kind"], config: Config, inBank: boolean): Dim[] => {
  const base: Dim = config.variant === "flat" ? 3 : 4;
  if (inBank) return [base];
  if (kind === "screen") return config.variant === "flat" ? [2, 3] : [2, 3, 4];
  if (kind === "wall") return config.ladder ? [2, 3, 4] : [base, base, base];
  if (kind === "pair") return config.variant === "flat" ? [3, 3] : [3, 4];
  return [base];
};

export const legendsFor = (st: StageLayout, color: string) =>
  st.views.map((v) => ({
    x: v.focus.x,
    y: v.focus.y + v.focus.height - st.legend.size * 1.2,
    items:
      v.kind === "slice" || st.dim === 2
        ? [{ label: "Slice", color }]
        : st.dim === 4
          ? [
              { label: "Shadow", color: NEAR_COLOR },
              { label: "Slice", color },
            ]
          : [
              { label: "Slice", color },
              { label: "Shadow", color: "#8790a8" },
            ],
  }));

export const mountFrame = (ctx: AppContext): AppInstance => {
  const config = readConfig(ctx.variant, ctx.options);
  const kind = ctx.frame.kind;
  const inBank = ctx.setup.name === "bank" && (kind === "panel" || kind === "pair");
  const pos = Math.max(0, ctx.setup.pos);
  const count = Math.max(1, ctx.setup.count, pos + 1);
  const dims = dimsFor(kind, config, inBank);
  const color = inBank ? frameColor(pos) : SLICE_COLOR;
  const sliceColor = new Color(color);
  let frame: FrameInfo = ctx.frame;
  const layoutOf = (f: FrameInfo): Layout =>
    layoutFor({
      kind: f.kind,
      width: f.width / f.unit,
      height: f.height / f.unit,
      reachTop: { adult: f.reachTop.adult / f.unit, child: f.reachTop.child / f.unit },
      seams: f.seams.map((s) => s / f.unit),
      dims,
      bank: inBank,
    });
  let layout = layoutOf(frame);
  ctx.root.style.background = BACKGROUND;
  const now = () => performance.now();
  const clockNow = () => ctx.clock.now();
  const started = now();

  const painter: Painter = createPainter(ctx.root, frame);
  let family = 0;
  const shapeFor = (dim: Dim) => shapeOf(familyAt(inBank && shared ? shared.family : family), dim);

  const shared: Shared | null = inBank
    ? createShared({ net: ctx.net, pos, dim: dims[0]!, clock: clockNow, now })
    : null;
  const cuts: CutSender | null = inBank ? createCutSender(ctx.net) : null;

  const portKind = (dim: Dim, v: "stage" | "slice"): PortKind =>
    dim === 4 ? (v === "stage" ? "stage4" : "slice4") : v === "stage" ? "stage3" : "slice3";

  const stages: StageRun[] = layout.stages.map((st) => {
    const ports: Port[] = [];
    let flat: Flat | null = null;
    if (st.dim === 2) flat = createFlat(ctx.root);
    else
      for (const v of st.views)
        ports.push(painter.add(portKind(st.dim, v.kind), 1, v.lane, v.focus));
    const lane = st.views[0]?.lane.width ?? 1000;
    const shape = shapeOf(familyAt(0), st.dim);
    return {
      dim: st.dim,
      rot: copyMat(restRot(shape)),
      turning: null,
      lever: { t: inBank ? defaultLever(shape, pos, count) : -1, v: 0 },
      dials: DIAL_PLANES[st.dim].map(() => 0),
      mode: "show",
      lastTouch: Number.NEGATIVE_INFINITY,
      lastHuman: Number.NEGATIVE_INFINITY,
      active: null,
      activeAt: 0,
      orbit: createOrbit(lane, st.dim === 3 ? 4 : undefined),
      shown: identity(),
      shownLever: -1,
      blend: null,
      ports,
      flat,
    };
  });
  painter.prepare();

  const placeFlats = () => {
    layout.stages.forEach((st, i) => {
      const v = st.views[0];
      if (v) stages[i]?.flat?.place(v.lane, v.focus, frame.unit, frame.pixelRatio);
    });
  };
  placeFlats();

  const panelOf = () =>
    createPanel(ctx.root, layout, frame.unit, frame.pixelRatio, {
      axes: config.axes,
      legends: layout.stages.map((st) => legendsFor(st, color)),
    });
  let panel: Panel = panelOf();
  let resets: HTMLElement[] = [];

  // ---- The show ----------------------------------------------------------------------------

  let showStart = now();
  let lastLoop = 0;
  const showSeconds = () => (now() - showStart) / 1000;

  const tmpA = identity();
  const tmpB = identity();
  /** A stage's orientation in the show at pose `p`. */
  const showRot = (st: StageRun, p: ShowPose, out: Mat4): Mat4 => {
    const shape = shapeFor(st.dim);
    const rest = restRot(shape);
    pathAt(presetPath(shape, rest, 0), rest, p.corner, out);
    if (p.turn !== 0) {
      const pl = DIAL_PLANES[st.dim][0]!;
      planeTurn(pl[0], pl[1], dialTurn(st.dim, p.turn), tmpA);
      mul(tmpA, out, out);
      orthonormalize(out);
    }
    return out;
  };

  const anyPeople = () => stages.some((s) => s.mode === "people");

  // ---- Input -------------------------------------------------------------------------------

  const touch = (i: number, who: Who) => {
    const st = stages[i];
    if (!st) return;
    const t = now();
    st.lastTouch = t;
    if (who === "person") st.lastHuman = t;
    // A bank frame's own state is only its lever (see the lever handler).
    if (inBank) return;
    if (st.mode === "show") {
      // Take over from the show where it is.
      copyMat(st.shown, st.rot);
      st.lever.t = st.shownLever;
      st.lever.v = 0;
      st.turning = null;
      st.blend = null;
      st.mode = "people";
    }
  };

  const human = (who: Who) => who === "person";

  const controls: Controls = createControls(layout, {
    lever(i, t, who) {
      const st = stages[i];
      if (!st) return;
      touch(i, who);
      if (inBank) st.mode = "people";
      st.lever.t = t;
      st.lever.v = 0;
    },
    leverUp(i, vt) {
      const st = stages[i];
      if (st) releaseLever(st.lever, vt);
    },
    turn(i, dial, delta, who) {
      const st = stages[i];
      if (!st) return;
      touch(i, who);
      if (delta === 0) return;
      st.dials[dial] = (st.dials[dial] ?? 0) + delta;
      st.active = null;
      const angle = dialTurn(st.dim, delta);
      if (shared) {
        shared.turn(dial, angle, human(who));
        return;
      }
      const pl = DIAL_PLANES[st.dim][dial];
      if (!pl) return;
      if (st.turning) {
        turningAt(st.turning, now(), st.rot);
        st.turning = null;
      }
      turnBy(st.rot, pl[0], pl[1], angle);
    },
    orient(i, k, who) {
      const st = stages[i];
      if (!st) return;
      touch(i, who);
      st.active = k;
      st.activeAt = now();
      if (shared) {
        shared.preset(k, human(who));
        return;
      }
      if (st.turning) turningAt(st.turning, now(), st.rot);
      st.turning = startTurning(shapeFor(st.dim), st.rot, k, now());
    },
    shape(i, f, who) {
      touch(i, who);
      if (shared) {
        shared.setFamily(f, human(who));
        for (const st of stages) st.active = null;
        return;
      }
      if (f === family) return;
      family = f;
      for (const st of stages) {
        st.active = null;
        if (st.mode === "people") {
          copyMat(restRot(shapeFor(st.dim)), st.rot);
          st.turning = null;
        }
      }
    },
    viewDown(i, _v, id, x, y, who) {
      if (who !== "person") return;
      stages[i]?.orbit.begin(id, x, y, now());
    },
    viewMove(i, id, x, y) {
      stages[i]?.orbit.move(id, x, y, now());
    },
    viewUp(i, id, vx) {
      stages[i]?.orbit.end(id, vx, now());
    },
  });

  const venue = (p: Pointer) => ({ x: p.x / frame.unit, y: p.y / frame.unit });
  const offs = [
    ctx.input.on("down", (p) => {
      const v = venue(p);
      controls.down(p.id, v.x, v.y, p.synthetic ? "bot" : "person");
    }),
    ctx.input.on("move", (p) => {
      const v = venue(p);
      controls.move(p.id, v.x, v.y);
    }),
    ctx.input.on("up", (p) => controls.up(p.id, p.vx / frame.unit)),
    ctx.input.on("cancel", (p) => controls.up(p.id, 0, true)),
  ];

  const resetStage = (i: number, toShow: boolean) => {
    const st = stages[i];
    if (!st) return;
    for (const [id, f] of controls.fingers) if (f.hit.stage === i) controls.up(id, 0, true);
    const shape = shapeFor(st.dim);
    copyMat(restRot(shape), st.rot);
    st.turning = null;
    st.lever.t = inBank ? defaultLever(shape, pos, count) : -1;
    st.lever.v = 0;
    st.dials.fill(0);
    st.active = null;
    st.orbit.home();
    if (toShow && !inBank) {
      st.blend = { rot: copyMat(st.shown), lever: st.shownLever, at: now() };
      st.mode = "show";
    }
  };

  const buildResets = () => {
    for (const b of resets) b.remove();
    const u = frame.unit;
    resets = [];
    layout.stages.forEach((st, i) => {
      const r = st.reset;
      if (!r) return;
      resets.push(
        ctx.ui.button({
          icon: "reset",
          rect: { x: (r.x - r.r) * u, y: (r.y - r.r) * u, width: 2 * r.r * u, height: 2 * r.r * u },
          hold: 1000,
          look: "ghost",
          color: "#c9d3ea",
          onPress: () => {
            const s = stages[i];
            if (s) {
              s.lastHuman = now();
              s.lastTouch = now();
            }
            resetStage(i, false);
            if (s && !inBank) s.mode = "people";
          },
        }),
      );
    });
  };
  buildResets();

  // ---- Bots --------------------------------------------------------------------------------

  const rng = ctx.rng().fork(inBank ? `fourd:${pos}` : "fourd");
  const botCount =
    kind === "screen" ? 0 : Math.min(stages.length, Math.max(0, Math.round(ctx.bots)));
  const bots: Bot[] = Array.from({ length: botCount }, (_, i) =>
    createBot({
      input: ctx.input,
      stage: i,
      layout: () => layout.stages[i],
      unit: () => frame.unit,
      rng: rng.fork(`bot:${i}`),
      yieldNow: () => now() - (stages[i]?.lastHuman ?? -Infinity) < TIMING.botYieldMs,
    }),
  );

  // ---- Loop --------------------------------------------------------------------------------

  let disposed = false;
  let lastRender = now();
  const slots: SliceSlot[] = [{ cut: 0, color: sliceColor, on: true }];
  const looks: StageLook[] = stages.map((st) => ({
    dim: st.dim,
    lever: -1,
    extent: null,
    leverHeld: false,
    dials: st.dials,
    dialHeld: st.dials.map(() => false),
    active: null,
    family: 0,
    caption: null,
    ghost: null,
    gauge: null,
    color,
  }));
  const flatPts: Vec4[] = [];
  const lastSlice: { kind: string; size: number; faces: number }[] = stages.map(() => ({
    kind: "none",
    size: 0,
    faces: 0,
  }));

  const loop = ctx.loop({
    hz: HZ,
    update(dt) {
      if (disposed) return;
      const t = now();
      for (let i = 0; i < stages.length; i++) {
        const st = stages[i]!;
        if (controls.holder(i, "lever") === null) coastLever(st.lever, dt);
        if (inBank) {
          // An untouched bank frame's lever eases back to its place in the flip-book.
          if (st.mode === "people" && t - st.lastTouch > BANK_LEVER_IDLE_MS) st.mode = "show";
          if (st.mode === "show" && controls.holder(i, "lever") === null) {
            const target = defaultLever(shapeFor(st.dim), pos, count);
            st.lever.t += (target - st.lever.t) * (1 - Math.exp(-dt / 0.5));
            st.lever.v = 0;
          }
        } else if (
          stages.length > 1 &&
          st.mode === "people" &&
          t - st.lastTouch > TIMING.peopleIdleMs
        ) {
          resetStage(i, true);
        }
      }
      if (!inBank) {
        const pose = showAt(showSeconds(), 4, familyAt(family));
        if (pose.loop !== lastLoop) {
          lastLoop = pose.loop;
          // A loop nobody interrupted moves on to the next family.
          if (!anyPeople()) family = (family + 1) % FAMILIES.length;
        }
      }
      shared?.step();
      if (cuts) {
        const st = stages[0]!;
        const held = controls.holder(0, "lever") !== null;
        cuts.tick(
          {
            p: pos,
            c: quantCut(st.lever.t),
            f:
              (held ? CUT_FLAG.held : 0) |
              (t - st.lastHuman < 30_000 ? CUT_FLAG.person : 0) |
              (st.mode === "people" ? CUT_FLAG.moved : 0),
          },
          t,
        );
      }
      for (const b of bots) b.update(t);
    },
    render() {
      if (disposed) return;
      const t = now();
      const dt = Math.min(0.1, (t - lastRender) / 1000);
      lastRender = t;
      const seconds = showSeconds();
      const autoSec = inBank ? clockNow() / 1000 : (t - started) / 1000;
      const fam = inBank && shared ? shared.family : family;
      stages.forEach((st, i) => {
        const shape = shapeFor(st.dim);
        const sl = layout.stages[i]!;
        const look = looks[i]!;
        let pose: ShowPose | null = null;
        // The orientation and lever to draw.
        if (inBank && shared) {
          shared.orientation(st.shown);
          st.shownLever = st.lever.t;
        } else if (st.mode === "show") {
          pose = showAt(seconds, st.dim, familyAt(fam));
          showRot(st, pose, tmpB);
          let lever = pose.lever;
          if (st.blend) {
            const f = (t - st.blend.at) / TIMING.rejoinMs;
            if (f >= 1) st.blend = null;
            else {
              slerpRot(st.blend.rot, tmpB, ease(f), tmpB);
              lever = st.blend.lever + (lever - st.blend.lever) * ease(f);
            }
          }
          copyMat(tmpB, st.shown);
          st.shownLever = lever;
          st.dials.fill(0);
          st.dials[0] = pose.turn;
        } else {
          if (st.turning && turningAt(st.turning, t, st.rot)) {
            st.turning = null;
          }
          copyMat(st.rot, st.shown);
          st.shownLever = st.lever.t;
        }
        st.orbit.step(dt, t);
        const az = autoAzimuth(config.spin, autoSec) + st.orbit.offset;
        const cut = cutOf(st.dim, st.shownLever);
        slots[0]!.cut = cut;
        for (const port of st.ports) {
          port.azimuth = az;
          port.elevation = st.orbit.elevation;
          painter.update(port, shape, st.shown, slots);
        }
        if (st.flat) st.flat.draw(shape, st.shown, st.shownLever, color);
        const last = st.ports[0]?.stage.last;
        if (st.flat) {
          const s2 = slice2(shape, turned(shape, st.shown, flatPts), cut);
          lastSlice[i] = { kind: s2.kind, size: s2.kind === "span" ? s2.hi - s2.lo : 0, faces: 0 };
        } else {
          lastSlice[i] = {
            kind: last?.sliceKind[0] ?? "none",
            size: last?.sliceSize[0] ?? 0,
            faces: last?.sliceFaces?.[0] ?? 0,
          };
        }
        // The controls.
        const ext = extent(shape, st.shown, HIDDEN[st.dim]);
        look.lever = st.shownLever;
        const a = leverOf(st.dim, ext.lo);
        const b = leverOf(st.dim, ext.hi);
        look.extent = { lo: Math.min(a, b), hi: Math.max(a, b) };
        look.leverHeld = controls.holder(i, "lever") !== null;
        look.dials = st.dials;
        look.dialHeld = st.dials.map((_, d) => controls.holder(i, "dial", d) !== null);
        // On a bank others may have turned the shape since; the highlight fades after a while.
        if (inBank && st.active !== null && t - st.activeAt > BANK_ACTIVE_MS) st.active = null;
        look.active = st.active;
        look.family = fam;
        look.caption = pose?.caption ?? null;
        look.gauge = { lo: ext.lo, hi: ext.hi, cut };
        look.ghost = null;
        const g = pose?.ghost;
        if (g && !st.blend) {
          if (g.kind === "lever" && sl.lever)
            look.ghost = { x: leverX(sl.lever, g.t), y: sl.lever.y };
          else if (g.kind === "dial") {
            const d = sl.dials[g.index];
            if (d) {
              const ang = g.angle - Math.PI / 2;
              look.ghost = {
                x: d.x + Math.cos(ang) * d.r * 0.8,
                y: d.y + Math.sin(ang) * d.r * 0.8,
              };
            }
          } else if (g.kind === "orient") {
            const o = sl.orients.find((x) => x.k === g.k);
            if (o) look.ghost = { x: o.rect.x + o.rect.width / 2, y: o.rect.y + o.rect.height / 2 };
          }
        }
        if (pose && g?.kind === "orient") look.active = g.k;
        if (pose && pose.at > SHOW_S - 0.5) look.active = null;
      });
      painter.render(stages.flatMap((st) => st.ports.map((port) => ({ port }))));
      panel.update(looks);
    },
  });
  loop.start();

  // ---- Resize, reset, status ---------------------------------------------------------------

  let resizeTimer = 0;
  const offResize = ctx.onResize((f) => {
    frame = f;
    layout = layoutOf(f);
    controls.setLayout(layout);
    painter.resize(f);
    layout.stages.forEach((st, i) => {
      const run = stages[i];
      if (!run) return;
      st.views.forEach((v, k) => {
        const port = run.ports[k];
        if (port) {
          port.lane = v.lane;
          port.focus = v.focus;
        }
      });
      run.orbit.setSpan(st.views[0]?.lane.width ?? 1000);
    });
    placeFlats();
    for (const b of bots) b.release();
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (disposed) return;
      panel.dispose();
      panel = panelOf();
      buildResets();
    }, 150);
  });

  const resetAll = () => {
    for (let i = 0; i < stages.length; i++) {
      resetStage(i, false);
      const st = stages[i]!;
      st.mode = "show";
      st.blend = null;
      st.lastTouch = Number.NEGATIVE_INFINITY;
    }
    family = 0;
    shared?.reset();
    showStart = now();
    lastLoop = 0;
    controls.clear();
    for (const b of bots) b.release();
  };

  const debugKey = "__fourd";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => ({
          screen: false,
          unit: frame.unit,
          kind,
          bank: inBank,
          pos,
          ready: painter.ready,
          family: FAMILIES[inBank && shared ? shared.family : family],
          link: shared
            ? {
                leading: shared.leading,
                following: shared.following,
                live: shared.live,
                stats: { ...shared.stats },
              }
            : null,
          cutsSent: cuts?.sent ?? 0,
          layout: {
            stages: layout.stages.map((s) => ({
              dim: s.dim,
              views: s.views,
              lever: s.lever,
              dials: s.dials,
              orients: s.orients,
              shapes: s.shapes,
              reset: s.reset,
            })),
          },
          stages: stages.map((st, i) => ({
            dim: st.dim,
            mode: st.mode,
            lever: st.shownLever,
            cut: cutOf(st.dim, st.shownLever),
            rot: Array.from(st.shown),
            dials: [...st.dials],
            active: st.active,
            slice: lastSlice[i],
            azimuth: st.ports[0]?.azimuth ?? 0,
            elevation: st.orbit.elevation,
            caption: looks[i]?.caption ?? null,
          })),
          bots: bots.map((b) => b.actions),
        }),
      },
    });
  }

  return {
    reset() {
      resetAll();
    },
    attract() {},
    status() {
      const out: Record<string, OptionValue> = {
        shape: FAMILIES[inBank && shared ? shared.family : family] ?? "cube",
        stages: dims.join(" "),
        slice: Math.round((stages[0]?.shownLever ?? 0) * 100) / 100,
        touches: controls.fingers.size,
        playing: stages.filter((s) => s.mode === "people").length,
      };
      if (shared) {
        out.leading = shared.leading;
        out.live = shared.live;
      }
      return out;
    },
    command(name) {
      if (name === "reset") resetAll();
    },
    homeSpot(size) {
      const u = frame.unit;
      const h = layout.home;
      return { x: Math.min(frame.width - size, h.x * u), y: Math.max(0, h.y * u) };
    },
    dispose() {
      disposed = true;
      loop.stop();
      clearTimeout(resizeTimer);
      offResize();
      for (const off of offs) off();
      for (const b of bots) b.dispose();
      controls.clear();
      shared?.dispose();
      panel.dispose();
      for (const b of resets) b.remove();
      for (const st of stages) st.flat?.dispose();
      painter.dispose();
      ctx.root.style.background = "";
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
