import { createRenderer3D } from "../../core/renderer3d";
import { DEG, defaultViewers, WHOLE_SPHERE } from "../../core/sphere";
import { createSurfacePass } from "../../core/sphere3d";
import type { AppContext, AppInstance, SphereInfo } from "../../core/types";
import { bearing, degrees, elevation, fromAngles, slerp } from "./geom";
import { irisTexSize } from "./irisgen";
import { createEyeLook, irisOption, paceOption } from "./look";
import { createMotion } from "./motion";
import { SURFACE } from "./surface";
import { mountWall } from "./wall";

const SKIP_MAX_S = 3600;

/**
 * For the white's reflections: how far below the ball's centre people's eyes are, and how far off
 * the furthest stand, in ball radii.
 */
const viewerOf = (s: SphereInfo): [number, number] => {
  const v = defaultViewers(s.radius);
  return [Math.max(0.05, (s.centreY - v.eyes[0]!) / s.radius), v.far / s.radius];
};

export const mount = (ctx: AppContext): AppInstance =>
  ctx.frame.kind === "wall" ? mountWall(ctx) : mountSphere(ctx);

const mountSphere = (ctx: AppContext): AppInstance => {
  const sphere = (): SphereInfo => ctx.frame.sphere ?? WHOLE_SPHERE;
  /** People on the gallery only where the venue profile says there is one. */
  const gallery = () => ctx.options.upper !== false && sphere().gallery === true;
  const r3d = createRenderer3D(ctx.root, ctx.frame, { antialias: false });
  const rng = ctx.rng();
  const viewer = { value: viewerOf(sphere()) };
  const eye = createEyeLook(ctx, r3d, rng, irisTexSize(ctx.frame.width * ctx.frame.pixelRatio), {
    uViewer: viewer,
  });
  const iris = eye.iris;
  const colours = eye.colours;
  const pass = createSurfacePass(r3d, ctx.frame, { fragment: SURFACE, uniforms: eye.uniforms });
  r3d.onRestore(() => iris.invalidate());

  // It opens on a long look at someone standing a little way off, as a preview's camera is.
  const s0 = sphere();
  const motion = createMotion({
    rng: rng.fork("motion"),
    sphere: s0,
    pace: paceOption(ctx.options.pace),
    upper: gallery(),
    start: { x: 0, z: 3.6 * s0.radius, eye: 1.6, seconds: 7 },
  });
  let before = motion.gaze;
  let beforeTwist = motion.torsion;
  let frames = 0;

  const loop = ctx.loop({
    hz: 60,
    update(dt) {
      // The show starts once the eye is on show, so its opening look isn't spent compiling.
      if (frames === 0) return;
      before = motion.gaze;
      beforeTwist = motion.torsion;
      motion.step(dt);
      colours.step(dt);
    },
    render(alpha) {
      if (!r3d.ready) return;
      iris.draw();
      eye.pose({
        gaze: slerp(before, motion.gaze, alpha),
        twist: beforeTwist + (motion.torsion - beforeTwist) * alpha,
        pupil: motion.pupil,
        lamps: motion.light.lamps,
        day: motion.light.day,
      });
      pass.render();
      frames++;
    },
  });
  loop.start();

  ctx.onResize((f) => {
    r3d.resize(f);
    const s = f.sphere ?? WHOLE_SPHERE;
    pass.setSphere(s);
    motion.setSphere(s);
    viewer.value = viewerOf(s);
  });

  const state = () => {
    const gz = motion.gaze;
    return {
      elevation: degrees(elevation(gz)),
      bearing: degrees(bearing(gz)),
      gaze: [...gz],
      torsion: degrees(motion.torsion),
      pupil: motion.pupil,
      mood: motion.mood,
      moods: { ...motion.moods },
      activity: motion.activity,
      staring: motion.staring,
      time: motion.time,
      stats: { ...motion.stats },
      people: motion.crowd.people.length,
      upper: motion.crowd.people.filter((p) => p.upper).length,
      roomLight: motion.roomLight,
      lamps: motion.light.lamps,
      day: motion.light.day,
      iris: { from: colours.from, to: colours.to, mix: colours.mix },
      reflections: eye.shine,
      depth: eye.depth,
      ready: r3d.ready && iris.done,
      frames,
    };
  };

  // Always there: e2e tests read it, and it holds nothing secret.
  const debugKey = "__gaze";
  Object.defineProperty(window, debugKey, {
    configurable: true,
    value: {
      state,
      /** Run the show on by `seconds` (at most an hour a call) without drawing. */
      skip(seconds: number) {
        const steps = Math.round(Math.min(SKIP_MAX_S, Math.max(0, seconds)) * 60);
        for (let i = 0; i < steps; i++) {
          motion.step(1 / 60);
          colours.step(1 / 60);
        }
        before = motion.gaze;
        beforeTwist = motion.torsion;
        return state();
      },
      /**
       * Milliseconds to draw the feed once, measured over `n` draws that each wait for the GPU,
       * for checking the frame budget.
       */
      bench(n = 30) {
        if (!r3d.ready) return null;
        const gl = r3d.renderer.getContext();
        const px = new Uint8Array(4);
        // Drain anything already queued first.
        for (let i = 0; i < 3; i++) {
          pass.render();
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        }
        const t0 = performance.now();
        for (let i = 0; i < n; i++) {
          pass.render();
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        }
        return (performance.now() - t0) / n;
      },
      /** Bring the room's lamps and daylight (shares) to these levels over `ramp` seconds. */
      light(lamps: number, day: number, ramp = 1, hold = 60) {
        motion.light.set(lamps, day, ramp, hold);
      },
      /** Look at an elevation and bearing (degrees) for `seconds`, then carry on. */
      look(elev: number, bear: number, seconds = 10) {
        motion.hold(fromAngles(elev * DEG, bear * DEG), seconds);
      },
    },
  });

  return {
    reset() {
      // A running show keeps running: only put back what admin may have changed.
      colours.set(irisOption(ctx.options.iris));
      eye.setSurface();
      motion.setPace(paceOption(ctx.options.pace));
      motion.setUpper(gallery());
    },
    status() {
      const gz = motion.gaze;
      return {
        mood: motion.mood,
        looking: `${Math.round(degrees(elevation(gz)))}°, ${Math.round(degrees(bearing(gz)))}°`,
        pupil: `${motion.pupil.toFixed(1)} mm`,
        iris: colours.mix < 1 ? `${colours.from} to ${colours.to}` : colours.to,
      };
    },
    dispose() {
      loop.stop();
      Reflect.deleteProperty(window, debugKey);
      eye.dispose();
      r3d.dispose();
    },
  };
};
