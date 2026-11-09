import { Color, Matrix3, Vector2, Vector3, Vector4 } from "three";
import { createRenderer3D } from "../../core/renderer3d";
import {
  apply3,
  DEG,
  defaultViewers,
  latLonOf,
  type Mat3,
  multiply3,
  transpose3,
  type Vec3,
  WHOLE_SPHERE,
} from "../../core/sphere";
import { createSurfacePass, toMatrix3 } from "../../core/sphere3d";
import type { AppContext, AppInstance, FrameInfo, SphereInfo } from "../../core/types";
import { ANSWERS } from "./answers";
import { cellFor, createAtlas, createPromptPicture } from "./atlas";
import { BUBBLES, createBubbles } from "./bubbles";
import { FACES } from "./die";
import { createMotion } from "./motion";
import { paletteOf, PALETTE_IDS, type PaletteId } from "./palettes";
import { BALL_GLSL, MAX_WINDOWS } from "./shader";
import { createShow, type Pace, STAGE_IDS, type StageId, type Windows } from "./show";
import { mountWall } from "./wall";

const HZ = 60;
/** The viewer the window's inside is drawn for stands this far from the centre, ball radii. */
const VIEW_DISTANCE = 2.6;
/** Longest stretch the debug hook may skip in one go, s. */
const MAX_SKIP = 7 * 24 * 3600;

const viewerOf = (s: SphereInfo): [number, number] => {
  const v = defaultViewers(s.radius);
  return [Math.max(0.05, (s.centreY - v.eyes[0]!) / s.radius), v.far / s.radius];
};

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

export const mount = (ctx: AppContext): AppInstance =>
  ctx.frame.kind === "wall" ? mountWall(ctx) : mountSphere(ctx);

const mountSphere = (ctx: AppContext): AppInstance => {
  const sphere = (f: FrameInfo = ctx.frame): SphereInfo => f.sphere ?? WHOLE_SPHERE;
  const colours: PaletteId = (PALETTE_IDS as unknown[]).includes(ctx.options.colours)
    ? (ctx.options.colours as PaletteId)
    : "night";
  const palette = paletteOf(colours);
  const windows: Windows =
    ctx.options.windows === "one" ? 1 : ctx.options.windows === "three" ? 3 : 6;
  const pace: Pace = ctx.options.pace === "lively" ? "lively" : "calm";
  const prompting = ctx.options.prompt !== false;

  const rng = ctx.rng().fork("answerball");
  const show = createShow(rng.fork("show"), {
    windows,
    under: windows === 6 && ctx.options.under !== false,
    pace,
    prompt: prompting,
    view: sphere().view,
  });
  const motion = createMotion(show);
  /** Windows on the ball, with the one underneath if there is one. */
  const lanes = show.seats.length;
  const bubbles = Array.from({ length: lanes }, (_, i) => createBubbles(rng.fork(`bubbles-${i}`)));
  const swirled: number[] = Array.from({ length: lanes }, () => -1);

  const r3d = createRenderer3D(ctx.root, ctx.frame, { antialias: false });
  const feedRows = Math.round(ctx.frame.height * ctx.frame.pixelRatio);
  const atlas = r3d.keep(createAtlas(cellFor(feedRows)));
  const promptPic = r3d.keep(createPromptPicture(Math.round(feedRows * 0.4)));

  const toWin = Array.from({ length: MAX_WINDOWS }, () => new Matrix3());
  const dieRot = Array.from({ length: MAX_WINDOWS }, () => new Matrix3());
  const diePos = Array.from({ length: MAX_WINDOWS }, () => new Vector3());
  const look = Array.from({ length: MAX_WINDOWS }, () => new Vector4(VIEW_DISTANCE, 1, 0, 0));
  const light = Array.from({ length: MAX_WINDOWS }, () => new Vector3(0, 0, 1));
  const slosh = Array.from({ length: MAX_WINDOWS }, () => new Vector2());
  const bubbleAt = Array.from({ length: MAX_WINDOWS * BUBBLES }, () => new Vector4());
  const uniforms = {
    uToBall: { value: new Matrix3() },
    uWindows: { value: lanes },
    uToWin: { value: toWin },
    uDieRot: { value: dieRot },
    uDiePos: { value: diePos },
    uLook: { value: look },
    uLight: { value: light },
    uSlosh: { value: slosh },
    uBubble: { value: bubbleAt },
    uAtlas: { value: atlas.texture },
    uPrompt: { value: promptPic.texture },
    uBody: { value: new Color(palette.body) },
    uLiquid: { value: new Color(palette.liquid) },
    uDie: { value: new Color(palette.die) },
    uInk: { value: new Color(palette.ink) },
    uCentreY: { value: 0 },
    uRadius: { value: 1 },
    uViewer: { value: new Vector2() },
    uHidden: { value: 1 },
    uDrift: { value: new Vector4() },
    uExposure: { value: 1 },
    uSeamAxis: { value: windows === 1 ? 0 : windows === 3 ? 1 : 2 },
    uSeamWave: { value: new Vector2() },
  };
  if (windows === 6) {
    // The seam weaves between the rows: over each low window, under each high one.
    const [first, second] = [show.seats[0]!.pitch, show.seats[1]!.pitch];
    uniforms.uSeamWave.value.set((first + second) / 2, (first - second) / 4);
  }
  const pass = createSurfacePass(r3d, ctx.frame, { fragment: BALL_GLSL, uniforms });

  const fit = (f: FrameInfo) => {
    const s = sphere(f);
    uniforms.uCentreY.value = s.centreY;
    uniforms.uRadius.value = s.radius;
    const [below, far] = viewerOf(s);
    uniforms.uViewer.value.set(below, far);
    uniforms.uHidden.value = Math.sin(s.view.top);
    show.setView(s.view);
  };
  fit(ctx.frame);
  motion.windows.forEach((m, i) => toMatrix3(transpose3(m), toWin[i]!));

  let t = 0;
  let resets = 0;
  let shakes = 0;
  /** Tests stop the show's clock while they take a picture. */
  let paused = false;

  /** The room's up in window `lane`'s frame, with the ball at `ball`. */
  const upIn = (lane: number, ball: Mat3): Vec3 =>
    apply3(transpose3(multiply3(ball, motion.windows[lane]!)), [0, 1, 0]);

  const advance = (dt: number) => {
    t += dt;
    const ball = motion.ball(t);
    for (let lane = 0; lane < lanes; lane++) {
      const c = show.cycle(lane, t);
      const s = show.stageAt(c, t - c.start);
      if (s.id === "shake" && swirled[lane] !== c.index) {
        swirled[lane] = c.index;
        bubbles[lane]!.swirl(c.long ? 1.3 : 0.8);
      }
      bubbles[lane]!.step(dt, upIn(lane, ball));
    }
  };

  const update = (dt: number) => {
    if (!paused) advance(dt);
  };

  const write = (at: number) => {
    const ball = motion.ball(at);
    toMatrix3(transpose3(ball), uniforms.uToBall.value);
    for (let lane = 0; lane < lanes; lane++) {
      const pose = motion.die(lane, at);
      toMatrix3(transpose3(pose.rot), dieRot[lane]!);
      diePos[lane]!.set(pose.pos[0], pose.pos[1], pose.pos[2]);
      look[lane]!.set(
        VIEW_DISTANCE,
        Math.cos(pose.angle),
        Math.sin(pose.angle),
        motion.prompt(lane, at),
      );
      // Light reaches the die through the window, from the room in front and a little above.
      const aim = motion.aim(lane, ball);
      const toWindow = transpose3(multiply3(ball, motion.windows[lane]!));
      const l = apply3(toWindow, norm([aim[0], aim[1] + 0.35, aim[2]]));
      light[lane]!.set(l[0], l[1], l[2]);
      const sl = motion.slosh(lane, at, ball);
      slosh[lane]!.set(sl[0], sl[1]);
      bubbles[lane]!.list.forEach((b, j) =>
        bubbleAt[lane * BUBBLES + j]!.set(b.x, b.y, b.r, b.alpha),
      );
    }
    uniforms.uDrift.value.set(
      0.03 * Math.sin(at * 0.05),
      0.03 * Math.cos(at * 0.04),
      0.03 * Math.sin(at * 0.05 + 2),
      0.03 * Math.cos(at * 0.04 + 1),
    );
  };

  const loop = ctx.loop({
    hz: HZ,
    update,
    render(alpha) {
      if (!r3d.ready) return;
      write(t + alpha / HZ);
      pass.render();
    },
  });
  loop.start();

  ctx.onResize((f) => {
    r3d.resize(f);
    pass.setSphere(sphere(f));
    fit(f);
  });

  const stageOf = (lane: number) => {
    const c = show.cycle(lane, t);
    return { c, s: show.stageAt(c, t - c.start), at: t - c.start };
  };

  const windowState = (lane: number) => {
    const { c, s, at } = stageOf(lane);
    const ball = motion.ball(t);
    const aim = latLonOf(motion.aim(lane, ball));
    const pose = motion.die(lane, t);
    // The text's up in the venue, against the room's up as seen on the window.
    const textUp = apply3(
      multiply3(ball, motion.windows[lane]!),
      apply3(pose.rot, FACES[c.answer]!.up),
    );
    const toVenue = multiply3(ball, motion.windows[lane]!);
    const axis: Vec3 = [toVenue[2], toVenue[5], toVenue[8]];
    const upOn = norm([-axis[0] * axis[1], 1 - axis[1] * axis[1], -axis[2] * axis[1]]);
    return {
      cycle: c.index,
      stage: s.id,
      at: at - s.start,
      stageLength: s.end - s.start,
      stages: c.stages.map((x) => ({ ...x })),
      answer: ANSWERS[c.answer]!.text,
      kind: ANSWERS[c.answer]!.kind,
      face: c.answer,
      long: c.long,
      down: c.down,
      target: {
        lat: c.to.pitch / DEG,
        lon: Math.atan2(Math.sin(c.to.yaw), Math.cos(c.to.yaw)) / DEG,
      },
      lat: aim.lat / DEG,
      lon: aim.lon / DEG,
      depth: pose.depth,
      prompt: motion.prompt(lane, t),
      upright: textUp[0] * upOn[0] + textUp[1] * upOn[1] + textUp[2] * upOn[2],
      bubbles: bubbles[lane]!.list.map((b) => ({ x: b.x, y: b.y, alpha: b.alpha })),
    };
  };

  const jump = (stage: StageId, into = 0) => {
    const { c } = stageOf(0);
    const s = c.stages.find((x) => x.id === stage);
    if (!s) return;
    const target = c.start + s.start + Math.max(0, Math.min(into, s.end - s.start - 0.01));
    if (target > t) skip(target - t);
  };

  const skip = (seconds: number) => {
    const n = Math.round(Math.min(MAX_SKIP, Math.max(0, seconds)) * HZ);
    for (let i = 0; i < n; i++) advance(1 / HZ);
  };

  const shakeNow = () => {
    shakes++;
    for (let lane = 0; lane < lanes; lane++) show.shakeNow(lane, t);
  };

  const debugKey = "__answerball";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => ({
          ready: r3d.ready,
          time: t,
          windows: lanes,
          pace,
          colours,
          resets,
          shakes,
          stageIds: STAGE_IDS,
          lanes: Array.from({ length: lanes }, (_, i) => windowState(i)),
        }),
        skip,
        jump,
        next: () => {
          const { c } = stageOf(0);
          skip(c.start + c.duration - t + 0.001);
        },
        shake: shakeNow,
        pause: (on: boolean) => {
          paused = on;
        },
      },
    });
  }

  return {
    reset() {
      // The show keeps running: nobody touches the ball, and the runtime resets it at 60 s.
      resets++;
      fit(ctx.frame);
    },
    command(name) {
      if (name === "shake") shakeNow();
    },
    status: () => {
      const { c, s } = stageOf(0);
      const ball = motion.ball(t);
      const aim = latLonOf(motion.aim(0, ball));
      return {
        stage: s.id,
        answer: ANSWERS[c.answer]!.text,
        facing: c.down ? "down" : `${Math.round(aim.lat / DEG)}, ${Math.round(aim.lon / DEG)}`,
        windows: lanes,
      };
    },
    dispose() {
      loop.stop();
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
      r3d.dispose();
    },
  };
};
