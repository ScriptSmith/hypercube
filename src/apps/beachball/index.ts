import { Color, Matrix3, Vector3, Vector4 } from "three";
import { createRenderer3D } from "../../core/renderer3d";
import {
  DEG,
  latLonOf,
  type Mat3,
  multiply3,
  rotationAbout,
  transpose3,
  type Vec3,
  WHOLE_SPHERE,
} from "../../core/sphere";
import { createSurfacePass, toMatrix3 } from "../../core/sphere3d";
import type { AppContext, AppInstance, FrameInfo } from "../../core/types";
import { createDrops, dropBands, MAX_DROPS } from "./drops";
import { sandCentre } from "./geometry";
import { createMotion, type Pace, tossFactor } from "./motion";
import { PALETTE_IDS, type PaletteId, paletteOf } from "./palettes";
import { BALL_GLSL } from "./shader";
import { mountWall } from "./wall";

const HZ = 60;
const TAU = Math.PI * 2;
/** Overall brightness: white vinyl under the overhead light stays short of full white. */
const EXPOSURE = 0.88;
/** Longest stretch the debug hook may skip in one go, s. */
const MAX_SKIP = 3600;

const len3 = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);

export const mount = (ctx: AppContext): AppInstance =>
  ctx.frame.kind === "wall" ? mountWall(ctx) : mountSphere(ctx);

const mountSphere = (ctx: AppContext): AppInstance => {
  let frame = ctx.frame;
  const sphereOf = (f: FrameInfo) => f.sphere ?? WHOLE_SPHERE;
  const colours: PaletteId = (PALETTE_IDS as unknown[]).includes(ctx.options.colours)
    ? (ctx.options.colours as PaletteId)
    : "classic";
  const palette = paletteOf(colours);
  const pace: Pace = ctx.options.pace === "lively" ? "lively" : "lazy";
  const tossing = ctx.options.toss !== false;
  const extras = ctx.options.extras !== false;

  const r3d = createRenderer3D(ctx.root, frame, { antialias: false });
  const rng = ctx.rng().fork("beachball");
  const motion = createMotion(rng.fork("motion"), { pace, toss: tossing });
  const drops = createDrops(rng.fork("drops"), dropBands(sphereOf(frame).view), motion.rotation);

  const dropAt = Array.from({ length: MAX_DROPS }, () => new Vector4());
  const dropAlong = Array.from({ length: MAX_DROPS }, () => new Vector4(1, 0, 0, 1));
  const sand = sandCentre();
  const uniforms = {
    uSpin: { value: new Matrix3() },
    uGore: { value: palette.gores.map((c) => new Color(c)) },
    uCapColour: { value: new Color(palette.cap) },
    uValveColour: { value: new Color(palette.valve) },
    uDrop: { value: dropAt },
    uDropAlong: { value: dropAlong },
    uSand: { value: extras ? new Vector3(sand[0], sand[1], sand[2]) : new Vector3() },
    uCentreY: { value: 0 },
    uRadius: { value: 1 },
    uHidden: { value: 1 },
    uAA: { value: 0.001 },
    uExposure: { value: EXPOSURE },
  };
  const pass = createSurfacePass(r3d, frame, { fragment: BALL_GLSL, uniforms });

  const fit = (f: FrameInfo) => {
    const s = sphereOf(f);
    uniforms.uCentreY.value = s.centreY;
    uniforms.uRadius.value = s.radius;
    uniforms.uHidden.value = Math.sin(s.view.top);
    const rows = r3d.canvas.height || Math.round(f.height * f.pixelRatio);
    uniforms.uAA.value = (s.cover.top - s.cover.bottom) / Math.max(1, rows);
    drops.setOptions(dropBands(s.view));
  };
  fit(frame);

  const update = (dt: number) => {
    motion.step(dt);
    if (extras) drops.step(dt, motion.rotation, motion.omega);
  };

  const writeDrops = () => {
    for (let i = 0; i < MAX_DROPS; i++) {
      const d = extras ? drops.list[i] : undefined;
      if (!d) {
        dropAt[i]!.set(0, 0, 0, 0);
        continue;
      }
      const { along, stretch } = drops.shape(d);
      dropAt[i]!.set(d.p[0], d.p[1], d.p[2], drops.radius(d));
      dropAlong[i]!.set(along[0], along[1], along[2], stretch);
    }
  };

  const loop = ctx.loop({
    hz: HZ,
    update,
    render(alpha) {
      if (!r3d.ready) return;
      const w = motion.omega;
      const l = len3(w);
      const m: Mat3 =
        l > 0 ? multiply3(rotationAbout(w, (l * alpha) / HZ), motion.rotation) : motion.rotation;
      toMatrix3(transpose3(m), uniforms.uSpin.value);
      writeDrops();
      pass.render();
    },
  });
  loop.start();

  ctx.onResize((f) => {
    frame = f;
    r3d.resize(f);
    pass.setSphere(sphereOf(f));
    fit(f);
  });

  let resets = 0;
  const tossNow = () => motion.tosses.some((k) => tossFactor(k, motion.time) > 0.05);
  const turnsPerMinute = (w: Vec3) => (len3(w) / TAU) * 60;

  const debugKey = "__beachball";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => {
          const a = motion.axis();
          return {
            ready: r3d.ready,
            time: motion.time,
            tilt: motion.tilt() / DEG,
            targetTilt: motion.targetTilt() / DEG,
            axis: a,
            turns: turnsPerMinute(motion.omega),
            lazyTurns: turnsPerMinute(motion.lazyOmega()),
            tossing: tossNow(),
            tossCount: motion.tossCount,
            resets,
            nextToss: motion.nextToss - motion.time,
            drops: (extras ? drops.list : []).map((d) => ({
              radius: drops.radius(d),
              lat: latLonOf(d.p).lat / DEG,
            })),
          };
        },
        toss: () => motion.toss(),
        skip: (seconds: number) => {
          const n = Math.round(Math.min(MAX_SKIP, Math.max(0, seconds)) * HZ);
          for (let i = 0; i < n; i++) update(1 / HZ);
        },
      },
    });
  }

  return {
    reset() {
      // The show keeps running: nobody touches the ball, and the runtime resets it at 60 s.
      resets++;
      fit(frame);
    },
    command(name) {
      if (name === "toss") motion.toss();
    },
    status: () => ({
      colours,
      turns: Math.round(turnsPerMinute(motion.omega) * 10) / 10,
      tilt: Math.round(motion.tilt() / DEG),
      tossing: tossNow(),
      nextToss: Number.isFinite(motion.nextToss) ? Math.round(motion.nextToss - motion.time) : -1,
      drops: extras ? drops.list.length : 0,
    }),
    dispose() {
      loop.stop();
      if (ctx.debug) delete (window as unknown as Record<string, unknown>)[debugKey];
      r3d.dispose();
    },
  };
};
