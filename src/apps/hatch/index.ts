import { createRenderer3D } from "../../core/renderer3d";
import { DEG, direction, IDENTITY3, transpose3, type Vec3, WHOLE_SPHERE } from "../../core/sphere";
import type { AppContext, AppInstance, Rng } from "../../core/types";
import { candleState, veinDay } from "./candling";
import { dayLine, type Line, STEP_LINES } from "./captions";
import { type CrackNet, makeCracks } from "./cracks";
import { SHELLS } from "./looks";
import {
  brightness,
  candleMix,
  chickPose,
  crackClock,
  dayOf,
  dryness,
  eggOrientation,
  hatchState,
  pipHole,
} from "./motion";
import { createPainter, DATA_H, DATA_W, type DrawState } from "./painter";
import { createEggData, eggDataJob, type EggData, type Job } from "./raster";
import {
  createShow,
  type EggPlan,
  findStage,
  type Pace,
  type ShellOption,
  type ShowOptions,
  type StageId,
  stageAt,
  type Variant,
} from "./show";
import { makeVeins, tangents } from "./veins";

const SHELL_OPTIONS: readonly ShellOption[] = ["mixed", "brown", "white", "speckled", "blue"];
/** Stages that show the shell or the candling picture, so need the egg's own textures. */
const NEEDS_EGG = new Set<StageId>(["candle", "egg", "stir", "pip", "rest", "zip", "hatch"]);
/** Milliseconds a frame may spend preparing the next egg. */
const PREP_MS = 3;

interface Inside {
  /** The embryo's longitude and the yolk's place, in the egg's frame. */
  lon: number;
  yolk: Vec3;
  /** Where the air cell dips (drawdown) and the beak breaks into it: over the pip. */
  drawdown: number;
  phase: number;
}

const insideOf = (rng: Rng, egg: EggPlan): Inside => {
  // The beak points to the air cell where it will pip, so the embryo lies on that side.
  const lon = egg.pip.lon + rng.range(-0.25, 0.25);
  return {
    lon,
    yolk: direction(rng.range(-14, -6) * DEG, lon + rng.range(-0.15, 0.15)),
    drawdown: egg.pip.lon,
    phase: rng.range(0, 10),
  };
};

const embryoAt = (lat: number, lon: number) => {
  const dir = direction(lat, lon);
  return { dir, ...tangents(dir) };
};

/** The caption for a stage of the hatch in the candling variant; null hides it. */
const stepLine = (stage: StageId, wet: boolean): Line | null => {
  switch (stage) {
    case "stir":
      return dayLine(21);
    case "pip":
      return STEP_LINES.external;
    case "rest":
      return STEP_LINES.rest;
    case "zip":
      return STEP_LINES.zip;
    case "hatch":
      return STEP_LINES.hatched;
    case "dry":
      return wet ? STEP_LINES.tired : STEP_LINES.drying;
    default:
      return null;
  }
};

export const mount = (ctx: AppContext): AppInstance => {
  const variant: Variant = ctx.variant === "candling" ? "candling" : "hatch";
  const pace: Pace = ctx.options.pace === "quick" ? "quick" : "normal";
  const shell = (SHELL_OPTIONS as readonly string[]).includes(String(ctx.options.shell))
    ? (ctx.options.shell as ShellOption)
    : "mixed";
  const sphere = () => ctx.frame.sphere ?? WHOLE_SPHERE;
  const opts: ShowOptions = { variant, pace, shell, viewTop: sphere().view.top };
  const base = ctx.rng();
  const show = createShow(base.fork("show"), opts);

  const r3d = createRenderer3D(ctx.root, ctx.frame, { antialias: false });
  const painter = createPainter(r3d, ctx.frame);
  painter.resize(ctx.frame);

  // Cracks and the inside of each egg, made once and kept for the egg playing and the next.
  const nets = new Map<number, CrackNet>();
  const insides = new Map<number, Inside>();
  const netFor = (egg: EggPlan): CrackNet => {
    let net = nets.get(egg.index);
    if (!net) {
      net = makeCracks(base.fork(`cracks-${egg.index}`), egg);
      nets.set(egg.index, net);
      for (const k of nets.keys()) if (k < egg.index - 1) nets.delete(k);
    }
    return net;
  };
  const insideFor = (egg: EggPlan): Inside => {
    let inside = insides.get(egg.index);
    if (!inside) {
      inside = insideOf(base.fork(`inside-${egg.index}`), egg);
      insides.set(egg.index, inside);
      for (const k of insides.keys()) if (k < egg.index - 1) insides.delete(k);
    }
    return inside;
  };

  let pending: { egg: EggPlan; data: EggData; job: Job } | null = null;
  const prepare = (egg: EggPlan) => {
    const data = createEggData(DATA_W, DATA_H);
    const veins = makeVeins(
      base.fork(`veins-${egg.index}`),
      direction(0, insideFor(egg).lon),
      veinDay,
    );
    return { egg, data, job: eggDataJob(data, netFor(egg), veins) };
  };
  const load = (p: { egg: EggPlan; data: EggData }) =>
    painter.loadEgg(p.egg.index, p.data, SHELLS[p.egg.kind], p.egg.seed);

  let t = 0;
  let stage: StageId = "egg";
  let current: EggPlan = show.egg(0);

  const state = (egg: EggPlan, at: number): DrawState => {
    const net = netFor(egg);
    const inside = insideFor(egg);
    const s = stageAt(egg, at).id;
    const orient = eggOrientation(egg, at);
    const hatching = s === "hatch" ? hatchState(egg, net, at) : null;
    const mode: 0 | 1 | 2 =
      s === "dry" || s === "chick" || s === "fade" ? 2 : hatching?.moving ? 1 : 0;
    const pose = chickPose(egg, net, at);
    const pipDir = direction(egg.pip.lat, egg.pip.lon);
    const candle = candleMix(egg, at);
    const day = dayOf(egg, at);
    const cs = candle > 0 ? candleState(day, t, inside.phase) : null;
    const tiltAxis = direction(0, inside.drawdown);
    const tilt = cs?.tilt ?? 0;
    const airN: Vec3 = [Math.sin(tilt) * tiltAxis[0], Math.cos(tilt), Math.sin(tilt) * tiltAxis[2]];
    const airLat = cs ? Math.asin(Math.min(1, cs.air)) - tilt : 0;
    const rest = findStage(egg, "rest")!;
    const breathing = at > rest.start ? 0.06 * Math.sin(at * 1.4) : 0;
    // Lying still at first, eyes open but heavy, until the head comes up.
    const lift = egg.chick.glances[1]?.at ?? 0;
    const wet = at < lift;
    let caption = { day: "", line: "", on: 0 };
    if (egg.variant === "candling") {
      const line = s === "candle" ? dayLine(day) : stepLine(s, wet);
      if (line) caption = { day: `Day ${Math.min(21, Math.floor(day))}`, line: line.text, on: 1 };
    }
    const wetLids = wet ? 0.3 : 0;
    return {
      egg: transpose3(orient),
      chick: mode === 0 ? IDENTITY3 : pose.inverse,
      bright: brightness(egg, at),
      crack: crackClock(egg, at),
      mode,
      pip: { dir: pipDir, ...tangents(pipDir) },
      hole: pipHole(egg, at),
      beakOff: [breathing, 0.04 * Math.sin(at * 0.9)],
      hatch: hatching,
      dry: dryness(egg, at),
      lids: Math.max(pose.lids, wetLids),
      beak: pose.beak,
      wings: pose.wings,
      down: egg.chick.down,
      candle,
      day,
      cs,
      embryo: embryoAt(cs?.embryoLat ?? 0, inside.lon),
      yolk: inside.yolk,
      airN,
      pipInC: direction(airLat + 0.02, inside.drawdown),
      caption,
    };
  };

  const loop = ctx.loop({
    hz: 60,
    update(dt) {
      t += dt;
    },
    render() {
      if (!r3d.ready) return;
      current = show.egg(t);
      const at = t - current.start;
      stage = stageAt(current, at).id;
      if (NEEDS_EGG.has(stage)) {
        if (painter.holds !== current.index) {
          pending = null;
          const p = prepare(current);
          p.job.step(Infinity);
          load(p);
          painter.bake(true);
        }
      } else {
        const next = show.next();
        if (painter.holds !== next.index) {
          if (pending?.egg.index !== next.index) pending = prepare(next);
          if (pending.job.step(PREP_MS)) {
            load(pending);
            pending = null;
          }
        }
      }
      painter.bake();
      // The chick needs only its down; the next egg's shell can bake meanwhile.
      if (!painter.ready || (NEEDS_EGG.has(stage) && !painter.shellReady)) return;
      painter.draw(state(current, at));
    },
  });
  loop.start();

  ctx.onResize((f) => {
    painter.resize(f);
    opts.viewTop = (f.sphere ?? WHOLE_SPHERE).view.top;
  });

  const jump = (to: StageId, into = 0) => {
    const egg = show.egg(t);
    const s = findStage(egg, to);
    if (s) t = egg.start + s.start + Math.max(0, Math.min(into, s.end - s.start - 0.01));
  };

  // Tests and debugging: read the show, and jump through it.
  Object.defineProperty(window, "__hatch", {
    configurable: true,
    value: {
      state: () => {
        const egg = show.egg(t);
        const at = t - egg.start;
        return {
          egg: egg.index,
          stage: stageAt(egg, at).id,
          at,
          kind: egg.kind,
          variant: egg.variant,
          day: dayOf(egg, at),
          crack: crackClock(egg, at),
          dry: dryness(egg, at),
          holds: painter.holds,
          ready: painter.ready && (painter.shellReady || !NEEDS_EGG.has(stageAt(egg, at).id)),
          stages: egg.stages.map((s) => ({ ...s })),
        };
      },
      jump,
      nextEgg: () => {
        const egg = show.egg(t);
        t = egg.start + egg.duration;
      },
    },
  });

  return {
    reset() {
      // The show is the app: nothing here restarts it or jumps the picture.
      painter.resize(ctx.frame);
    },
    status: () => ({ stage, egg: current.index, shell: current.kind }),
    command(name) {
      if (name === "next") {
        const egg = show.egg(t);
        t = egg.start + egg.duration;
      }
    },
    dispose() {
      loop.stop();
      painter.dispose();
      r3d.dispose();
      Reflect.deleteProperty(window, "__hatch");
    },
  };
};
