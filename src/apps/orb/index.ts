import {
  DataUtils,
  Data3DTexture,
  HalfFloatType,
  LinearFilter,
  RepeatWrapping,
  RGBAFormat,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
} from "three";
import { createRenderer3D } from "../../core/renderer3d";
import {
  IDENTITY3,
  type Mat3,
  multiply3,
  orthonormalize3,
  rotationAbout,
  WHOLE_SPHERE,
} from "../../core/sphere";
import { toMatrix3 } from "../../core/sphere3d";
import type { AppContext, AppInstance, FrameInfo, SphereInfo } from "../../core/types";
import { GLASS_GLSL } from "./glass";
import { createGpuTimer, type GpuTimer } from "./gputimer";
import { createGlow, type GlowMode, hash, LIGHTS, type Light } from "./glow";
import { buildNoise, NOISE_SIZE } from "./noise";
import { createPass, type Pass } from "./pass";
import { createShow, openness, type Pace, parting, reveal, SCENES, type SceneId } from "./show";
import { SMOKE_GLSL } from "./smoke";
import { LOOKS } from "./visions";
import { VISION_VERTEX, visionFragment } from "./visions/common";
import {
  bearingAt,
  DISTANCE_R,
  eyeY,
  hasBelow,
  type Viewer,
  VIEWERS,
  viewersFor,
  WINDOW_R,
} from "./views";

const DEBUG_KEY = "__orb";
/** The same smoke texture on every orb. */
const NOISE_SEED = 20261102;
/** Seconds each of the two blended copies of the smoke lives before it starts again. */
const PHASE_S = 26;
/** The swirl round its axis (radians a second) and the rise up the middle (radii a second). */
const SWIRL = 0.05;
const RISE = 0.012;
/** Seconds for the whole body of smoke to turn once. */
const TURN_S = 300;
/** The smoke is drawn this many times smaller than the feed each way, since it is soft. */
const SMOKE_SCALE = 0.5;
/** Steps along each ray. */
const STEPS = 22;
/** Software renderers (tests, a machine without a GPU) draw at this fraction, with fewer steps. */
const SOFTWARE_SCALE = 0.5;
const SOFTWARE_STEPS = 12;
/** The vision's picture is about this fraction of the feed's height across, within limits. */
const VISION_SHARE = 0.42;
const VISION_MIN = 256;
const VISION_MAX = 1024;
/** Most a debug skip moves the show on at once, seconds. */
const MAX_SKIP = 3600;

const linear = (hex: string): [number, number, number] => {
  const n = Number.parseInt(hex.slice(1), 16);
  const c = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return [c((n >> 16) & 255), c((n >> 8) & 255), c(n & 255)];
};

const isSoftware = (gl: WebGLRenderingContext | WebGL2RenderingContext): boolean => {
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  return /swiftshader|llvmpipe|softpipe|software/i.test(name);
};

/** How much smoke there is, where the noise starts to count as smoke, and how much it hides. */
const DENSITY = 1.6;
const THRESHOLD = 0.56;
const SIGMA = 0.8;
/** How quickly each glow fades with distance (per radius squared). */
const FALLOFF = 20;

const GLOWS: Record<GlowMode, { ambient: string; gain: number }> = {
  cool: { ambient: "#0b1020", gain: 0.63 },
  warm: { ambient: "#140c10", gain: 0.6 },
};

export const mount = (ctx: AppContext): AppInstance => {
  let frame = ctx.frame;
  const sphere = (): SphereInfo => frame.sphere ?? WHOLE_SPHERE;
  const pace: Pace = ctx.options.visions === "rarely" ? "rarely" : "often";
  const mode: GlowMode = ctx.options.glow === "warm" ? "warm" : "cool";
  const base = ctx.rng().fork("orb");
  const show = createShow(base.fork("show"), pace);
  const glow = createGlow(mode, Math.floor(base.fork("glow").next() * 2 ** 31));
  const phaseSeed = Math.floor(base.fork("phases").next() * 2 ** 31);

  const r3d = createRenderer3D(ctx.root, frame, { antialias: false });
  const software = isSoftware(r3d.renderer.getContext());
  const steps = software ? SOFTWARE_STEPS : STEPS;

  const noise = r3d.keep(
    new Data3DTexture(buildNoise(NOISE_SEED), NOISE_SIZE, NOISE_SIZE, NOISE_SIZE),
  );
  noise.format = RGBAFormat;
  noise.type = UnsignedByteType;
  noise.minFilter = LinearFilter;
  noise.magFilter = LinearFilter;
  noise.wrapS = RepeatWrapping;
  noise.wrapT = RepeatWrapping;
  noise.wrapR = RepeatWrapping;
  noise.unpackAlignment = 1;
  noise.needsUpdate = true;

  const smokeTarget = r3d.keep(
    new WebGLRenderTarget(1, 1, {
      type: HalfFloatType,
      depthBuffer: false,
      wrapS: RepeatWrapping,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
    }),
  );
  const visionTarget = r3d.keep(
    new WebGLRenderTarget(1, 1, {
      type: HalfFloatType,
      depthBuffer: false,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
    }),
  );

  // Window and viewer uniforms, shared by the smoke and glass passes.
  const eyes = Array.from({ length: VIEWERS }, () => new Vector3());
  const winN = Array.from({ length: VIEWERS }, () => new Vector3());
  const winR = Array.from({ length: VIEWERS }, () => new Vector3());
  const winU = Array.from({ length: VIEWERS }, () => new Vector3());
  const shared = {
    uEye: { value: eyes },
    uWindows: { value: 0 },
    uPart: { value: 0 },
    uWinN: { value: winN },
    uWinR: { value: winR },
    uWinU: { value: winU },
    uWindowR: { value: WINDOW_R },
    uCover: { value: [0, 0] },
  };
  const lightPos = Array.from({ length: LIGHTS }, () => new Vector3());
  const lightCol = Array.from({ length: LIGHTS }, () => new Vector3());
  const smokeUniforms = {
    ...shared,
    uNoise: { value: noise },
    uSpin: { value: toMatrix3(IDENTITY3) },
    uAxis: { value: new Vector3(0, 1, 0) },
    uFlow: { value: new Vector2(SWIRL, RISE) },
    uPhaseA: { value: new Vector4() },
    uPhaseB: { value: new Vector4() },
    uAge: { value: new Vector2() },
    uLightPos: { value: lightPos },
    uLightCol: { value: lightCol },
    uAmbient: { value: new Vector3(...linear(GLOWS[mode].ambient)) },
    uThick: { value: new Vector2(DENSITY, THRESHOLD) },
    uSigma: { value: SIGMA },
    uReveal: { value: 0 },
    uSteps: { value: steps },
    uWobble: { value: new Vector3() },
    uFall: { value: FALLOFF },
  };
  const glassUniforms = {
    ...shared,
    uSmoke: { value: smokeTarget.texture },
    uVision: { value: visionTarget.texture },
    uBase: { value: new Vector3(...linear("#06070b")) },
    uMist: { value: new Vector3() },
    uSheen: { value: new Vector3(...linear("#c4cfe0")) },
    uRig: { value: new Vector2() },
    uBelow: { value: 0 },
  };
  const visionUniforms = {
    uStage: { value: new Vector3() },
    uSeed: { value: 0 },
    uPx: { value: 1 / 512 },
  };
  const smokePass = createPass(r3d, SMOKE_GLSL, smokeUniforms);
  const glassPass = createPass(r3d, GLASS_GLSL, glassUniforms);
  const visionPasses = new Map<SceneId, Pass>(
    SCENES.map((id) => [
      id,
      createPass(r3d, visionFragment(LOOKS[id].glsl), visionUniforms, VISION_VERTEX),
    ]),
  );
  const tints = new Map(SCENES.map((id) => [id, linear(LOOKS[id].tint)]));
  const mists = new Map(SCENES.map((id) => [id, linear(LOOKS[id].mist)]));

  const buffer = new Vector2();
  const fit = (f: FrameInfo) => {
    r3d.resize(f);
    if (software) {
      // A software renderer takes most of a second for each full frame, so it gets fewer pixels.
      r3d.renderer.setPixelRatio(f.pixelRatio * SOFTWARE_SCALE);
      r3d.renderer.setSize(f.width, f.height, false);
    }
    r3d.renderer.getDrawingBufferSize(buffer);
    const w = Math.max(16, Math.round(buffer.x * SMOKE_SCALE));
    const h = Math.max(8, Math.round(buffer.y * SMOKE_SCALE));
    if (smokeTarget.width !== w || smokeTarget.height !== h) smokeTarget.setSize(w, h);
    const side = Math.round(Math.min(VISION_MAX, Math.max(VISION_MIN, buffer.y * VISION_SHARE)));
    if (visionTarget.width !== side) visionTarget.setSize(side, side);
    visionUniforms.uPx.value = 2 / side;
    const s = f.sphere ?? WHOLE_SPHERE;
    shared.uCover.value = [s.cover.top, s.cover.bottom];
    glassUniforms.uRig.value.set(DISTANCE_R, eyeY(s));
    glassUniforms.uBelow.value = hasBelow(s) ? 1 : 0;
  };
  fit(frame);

  let t = 0;
  let steps60 = 0;
  let spin: Mat3 = IDENTITY3;
  let drawn = 0;
  const lights: Light[] = [];
  let viewers: Viewer[] = [];

  const placeViewers = () => {
    viewers = viewersFor(sphere(), bearingAt(t));
    shared.uWindows.value = viewers.filter((v) => v.window).length;
    viewers.forEach((v, i) => {
      eyes[i]!.set(...v.eye);
      winN[i]!.set(...v.normal);
      winR[i]!.set(...v.right);
      winU[i]!.set(...v.up);
    });
  };

  const setPhase = (k: 0 | 1, out: Vector4) => {
    const cycles = t / PHASE_S + k * 0.5;
    const j = Math.floor(cycles);
    const phase = cycles - j;
    out.set(
      hash(phaseSeed, k * 2 + 1, j),
      hash(phaseSeed, k * 2 + 2, j),
      hash(phaseSeed, k * 2 + 3, j),
      1 - Math.abs(2 * phase - 1),
    );
    smokeUniforms.uAge.value.setComponent(k, phase * PHASE_S);
  };

  // Debugging only: GPU milliseconds per pass, when the browser can time them.
  let timer: GpuTimer | null = null;
  const timed = (name: string, run: () => void) => {
    if (timer) timer.time(name, run);
    else run();
  };

  const draw = () => {
    const current = show.at(t);
    const open = current ? openness(current, t) : 0;
    const part = parting(open);
    const shown = reveal(open);
    placeViewers();
    shared.uPart.value = part;
    smokeUniforms.uReveal.value = shown;
    const wrap = (x: number) => x - Math.floor(x);
    smokeUniforms.uWobble.value.set(wrap(t * 0.011), 0, wrap(t * 0.007));

    // The swirl's axis leans and wanders a little; the smoke thickens and thins over minutes.
    smokeUniforms.uAxis.value
      .set(0.22 * Math.sin(t * 0.013), 1, 0.22 * Math.cos(t * 0.017))
      .normalize();
    smokeUniforms.uThick.value.set(
      DENSITY * (1 + 0.15 * Math.sin(t / 97) + 0.1 * Math.sin(t / 61 + 1)),
      THRESHOLD - 0.03 * Math.sin(t / 83 + 2),
    );
    setPhase(0, smokeUniforms.uPhaseA.value);
    setPhase(1, smokeUniforms.uPhaseB.value);
    toMatrix3(spin, smokeUniforms.uSpin.value);

    glow.at(t, lights);
    const tint = current ? tints.get(current.scene)! : null;
    const lean = tint ? 0.5 * shown : 0;
    const gain = GLOWS[mode].gain;
    lights.forEach((l, k) => {
      lightPos[k]!.set(...l.pos);
      const c = lightCol[k]!;
      c.set(...l.colour);
      if (tint)
        c.set(
          c.x + (tint[0] - c.x) * lean,
          c.y + (tint[1] - c.y) * lean,
          c.z + (tint[2] - c.z) * lean,
        );
      c.multiplyScalar(l.power * gain);
    });

    if (current && shown > 0.001) {
      const v = current;
      visionUniforms.uStage.value.set(t - v.start, v.open, v.hold);
      visionUniforms.uSeed.value = v.seed;
      glassUniforms.uMist.value.set(...mists.get(v.scene)!);
      timed("vision", () => visionPasses.get(v.scene)!.render(visionTarget));
    }
    timed("smoke", () => smokePass.render(smokeTarget));
    timed("glass", () => glassPass.render(null));
    drawn++;
  };

  const turnAxis = (): [number, number, number] => [
    Math.sin(t * 0.009) * 0.4,
    1,
    Math.cos(t * 0.007) * 0.3,
  ];

  const loop = ctx.loop({
    hz: 60,
    update(dt) {
      t += dt;
      spin = multiply3(rotationAbout(turnAxis(), (dt * 2 * Math.PI) / TURN_S), spin);
      if (++steps60 % 600 === 0) spin = orthonormalize3(spin);
    },
    render() {
      if (r3d.ready) draw();
    },
  });
  loop.start();

  const offResize = ctx.onResize((f) => {
    frame = f;
    fit(f);
  });

  /** Move the show on by `seconds` as if they had passed, turning the smoke with it. */
  const skip = (seconds: number) => {
    let left = Math.min(MAX_SKIP, Math.max(0, seconds));
    while (left > 0) {
      const dt = Math.min(1, left);
      t += dt;
      spin = multiply3(rotationAbout(turnAxis(), (dt * 2 * Math.PI) / TURN_S), spin);
      left -= dt;
    }
    spin = orthonormalize3(spin);
  };

  /** Open a vision now: `scene`, or the next one due. */
  const openNow = (scene?: string): string | null => {
    const id = SCENES.find((s) => s === scene);
    return show.force(t, id)?.scene ?? null;
  };

  const state = () => {
    const v = show.at(t);
    const next = show.next(t);
    const o = v ? openness(v, t) : 0;
    return {
      t,
      ready: r3d.ready,
      drawn,
      software,
      scene: v?.scene ?? null,
      index: v?.index ?? next.index - 1,
      open: o,
      part: parting(o),
      reveal: reveal(o),
      stage: v
        ? t < v.start + v.open
          ? "opening"
          : t < v.start + v.open + v.hold
            ? "clear"
            : "closing"
        : "smoke",
      next: { scene: next.scene, start: next.start },
      kept: show.kept,
      windows: viewers.filter((v) => v.window).length,
      bearing: bearingAt(t),
      feed: [buffer.x, buffer.y],
      smoke: [smokeTarget.width, smokeTarget.height],
      vision: visionTarget.width,
      steps,
      glow: mode,
      pace,
    };
  };

  if (ctx.debug) {
    Object.defineProperty(window, DEBUG_KEY, {
      configurable: true,
      value: {
        state,
        skip,
        open: openNow,
        /** Jump to the middle of a vision: the scene asked for, else the one playing or due. */
        clear(scene?: string) {
          let v = show.at(t);
          if (v && scene && v.scene !== scene) {
            skip(v.end - t + 0.01);
            v = null;
          }
          if (!v) {
            openNow(scene);
            v = show.at(t);
          }
          if (v) t = v.start + v.open + v.hold * 0.5;
        },
        scenes: () => [...SCENES],
        /** Start timing each pass on the GPU; read the averages with timings(). */
        profile() {
          timer ??= createGpuTimer(r3d.renderer.getContext() as WebGL2RenderingContext);
          timer?.reset();
          return timer !== null;
        },
        timings: () => timer?.averages() ?? null,
        /**
         * Read back the smoke: how much of a vision shows through it at most, anywhere, and how
         * bright the smoke is on average.
         */
        seen() {
          const w = smokeTarget.width;
          const h = smokeTarget.height;
          const px = new Uint16Array(w * h * 4);
          r3d.renderer.readRenderTargetPixels(smokeTarget, 0, 0, w, h, px);
          let most = 0;
          let light = 0;
          for (let i = 0; i < px.length; i += 4) {
            most = Math.max(most, DataUtils.fromHalfFloat(px[i + 3]!));
            light += DataUtils.fromHalfFloat(px[i + 1]!);
          }
          return { vision: most, smoke: light / (w * h) };
        },
      },
    });
  }

  return {
    // The show is the app: nothing admin or the 60 s idle does restarts it or jumps the picture.
    reset() {
      fit(frame);
    },
    attract() {},
    status: () => {
      const s = state();
      return { stage: s.stage, scene: s.scene ?? "", visions: s.index + 1, glow: mode };
    },
    command(name) {
      if (name === "vision") openNow();
      else if ((SCENES as readonly string[]).includes(name)) openNow(name);
    },
    dispose() {
      loop.stop();
      offResize();
      if (ctx.debug) Reflect.deleteProperty(window, DEBUG_KEY);
      timer?.dispose();
      r3d.dispose();
    },
  };
};
