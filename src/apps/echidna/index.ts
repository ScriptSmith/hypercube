import {
  Data3DTexture,
  DataTexture,
  FloatType,
  LinearFilter,
  Matrix3,
  NearestFilter,
  RedFormat,
  RepeatWrapping,
  RGBAFormat,
  RGBAIntegerFormat,
  UnsignedByteType,
  UnsignedIntType,
  Vector2,
  Vector3,
  Vector4,
} from "three";
import { createRenderer3D } from "../../core/renderer3d";
import { apply3, WHOLE_SPHERE } from "../../core/sphere";
import { createSurfacePass, toMatrix3 } from "../../core/sphere3d";
import type { AppContext, AppInstance, FrameInfo } from "../../core/types";
import { BODY_SEED, type Built, buildBody } from "./build";
import { NOISE_SIZE } from "./noise";
import { ECHIDNA_GLSL } from "./shader";
import { createShow, type Event, MAX_RIPPLES, type Pace, spinOf } from "./show";
import type { WorkerRequest, WorkerResponse } from "./worker";

const EVENTS: readonly Event[] = ["ripple", "sniff", "claw", "stretch", "lid", "stir"];
/** Above the band people see, a little margin, then the cheaper, dimmer cap. */
const CAP_MARGIN = 0.08;
/** Most a debug skip runs the show forward, seconds. */
const MAX_SKIP = 3600;
/** If the worker hasn't answered by then, build on the page instead. */
const WORKER_TIMEOUT_MS = 10_000;

const candidateTexture = (words: Uint32Array, width: number, height: number) => {
  const tex = new DataTexture(words, width, height, RGBAIntegerFormat, UnsignedIntType);
  tex.internalFormat = "RGBA32UI";
  return nearest(tex);
};

const spineTexture = (data: Float32Array, width: number, height: number) =>
  nearest(new DataTexture(data, width, height, RGBAFormat, FloatType));

const noiseTexture = (data: Uint8Array, size: number) => {
  const tex = new Data3DTexture(data, size, size, size);
  tex.format = RedFormat;
  tex.type = UnsignedByteType;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.wrapR = RepeatWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
};

const nearest = (tex: DataTexture) => {
  tex.minFilter = NearestFilter;
  tex.magFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
};

/** Software renderers (tests, a machine without a GPU) draw the feed at this fraction. */
const SOFTWARE_SCALE = 0.5;

const isSoftware = (gl: WebGLRenderingContext | WebGL2RenderingContext): boolean => {
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  return /swiftshader|llvmpipe|softpipe|software/i.test(name);
};

const capY = (f: FrameInfo) => {
  const top = (f.sphere ?? WHOLE_SPHERE).view.top + CAP_MARGIN;
  return top >= Math.PI / 2 ? 2 : Math.sin(top);
};

export const mount = (ctx: AppContext): AppInstance => {
  const r3d = createRenderer3D(ctx.root, ctx.frame, { antialias: false });
  // A software renderer takes most of a second for each full frame, so it gets fewer pixels.
  const software = isSoftware(r3d.renderer.getContext());
  const fit = (f: FrameInfo) => {
    r3d.resize(f);
    if (!software) return;
    r3d.renderer.setPixelRatio(f.pixelRatio * SOFTWARE_SCALE);
    r3d.renderer.setSize(f.width, f.height, false);
  };
  fit(ctx.frame);
  // Stand-ins until the spines are built; nothing is drawn before then.
  let candidates = candidateTexture(new Uint32Array(4).fill(0xffffffff), 1, 1);
  let data = spineTexture(new Float32Array(4), 1, 1);
  let noise = noiseTexture(new Uint8Array(1), 1);
  let built: Built | null = null;
  let disposed = false;
  let drawn = 0;

  const uniforms = {
    uSpin: { value: new Matrix3() },
    uUp: { value: new Vector3() },
    uCand: { value: candidates },
    uSpines: { value: data },
    uNoise: { value: noise },
    uBreath: { value: new Vector2() },
    uRip: { value: Array.from({ length: MAX_RIPPLES }, () => new Vector4()) },
    uRipShape: { value: Array.from({ length: MAX_RIPPLES }, () => new Vector2()) },
    uBristle: { value: 0 },
    uSnout: { value: new Vector4() },
    uFeet: { value: new Vector4() },
    uToesLid: { value: new Vector2() },
    uCapY: { value: capY(ctx.frame) },
    uExposure: { value: 1 },
  };
  const pass = createSurfacePass(r3d, ctx.frame, { fragment: ECHIDNA_GLSL, uniforms });

  const take = (b: Built) => {
    if (disposed || built) return;
    built = b;
    candidates.dispose();
    data.dispose();
    noise.dispose();
    candidates = r3d.keep(candidateTexture(b.words, b.width, b.height));
    data = r3d.keep(spineTexture(b.spineData, b.spineWidth, b.spineHeight));
    noise = r3d.keep(noiseTexture(b.noise, NOISE_SIZE));
    uniforms.uCand.value = candidates;
    uniforms.uSpines.value = data;
    uniforms.uNoise.value = noise;
    stopWorker();
  };
  let worker: Worker | null = null;
  let fallback = 0;
  const stopWorker = () => {
    window.clearTimeout(fallback);
    worker?.terminate();
    worker = null;
  };
  const onPage = () => {
    if (!disposed && !built) take(buildBody(BODY_SEED));
  };
  try {
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      if (e.data.ok) take(e.data.built);
      else onPage();
    };
    worker.onerror = () => onPage();
    worker.postMessage({ seed: BODY_SEED } satisfies WorkerRequest);
    fallback = window.setTimeout(onPage, WORKER_TIMEOUT_MS);
  } catch {
    onPage();
  }

  const pace: Pace = ctx.options.pace === "restless" ? "restless" : "sleepy";
  const show = createShow(ctx.rng().fork("show"), { stirs: ctx.options.stirs !== false, pace });

  const apply = () => {
    const spin = spinOf(show.yaw, show.tilt);
    toMatrix3(spin, uniforms.uSpin.value);
    const up = apply3(spin, [0, 1, 0]);
    uniforms.uUp.value.set(up[0], up[1], up[2]);
    uniforms.uBreath.value.set(show.breath, show.breathRate);
    for (let k = 0; k < MAX_RIPPLES; k++) {
      const r = show.ripples[k];
      if (r) {
        uniforms.uRip.value[k]!.set(r.at[0], r.at[1], r.at[2], r.age);
        uniforms.uRipShape.value[k]!.set(r.lift, r.size);
      } else {
        uniforms.uRipShape.value[k]!.set(0, 1);
      }
    }
    uniforms.uBristle.value = show.bristle;
    uniforms.uSnout.value.set(show.snout[0], show.snout[1], show.snout[2], show.tuck);
    uniforms.uFeet.value.set(show.claws[0], show.claws[1], show.hind[0], show.hind[1]);
    uniforms.uToesLid.value.set(show.hind[2], show.lid);
  };

  const loop = ctx.loop({
    hz: 60,
    update(dt) {
      show.step(dt);
    },
    render() {
      if (!r3d.ready || !built) return;
      apply();
      pass.render();
      drawn++;
    },
  });
  loop.start();

  const offResize = ctx.onResize((f) => {
    fit(f);
    pass.setSphere(f.sphere ?? WHOLE_SPHERE);
    uniforms.uCapY.value = capY(f);
  });

  const counts = () => ({ ...show.counts });

  // Tests and debugging only: the show's state, a way to skip time and to start an event.
  const debugKey = "__echidna";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => ({
          drawn,
          time: show.time,
          breath: show.breath,
          yaw: show.yaw,
          tilt: [...show.tilt],
          ripples: show.ripples.length,
          bristle: show.bristle,
          counts: counts(),
          due: show.due(),
          built: built && {
            spines: built.spines,
            mean: built.mean,
            max: built.max,
            dropped: built.dropped,
            ms: built.ms,
          },
        }),
        advance(seconds: number) {
          let left = Math.min(MAX_SKIP, Math.max(0, seconds));
          while (left > 0) {
            const dt = Math.min(1 / 30, left);
            show.step(dt);
            left -= dt;
          }
        },
        trigger: (kind: Event) => show.trigger(kind),
      },
    });
  }

  return {
    // A running show keeps running: there is nothing admin or a resize leaves behind to undo.
    reset() {},
    status: () => ({
      pace,
      software,
      breaths: show.counts.breaths,
      twitches: show.counts.ripples,
      stirs: show.counts.stirs,
      stretches: show.counts.stretches,
    }),
    command(name) {
      if ((EVENTS as readonly string[]).includes(name)) show.trigger(name as Event);
    },
    dispose() {
      disposed = true;
      stopWorker();
      loop.stop();
      offResize();
      candidates.dispose();
      data.dispose();
      noise.dispose();
      r3d.dispose();
      if (ctx.debug) delete (window as unknown as Record<string, unknown>)[debugKey];
    },
  };
};
