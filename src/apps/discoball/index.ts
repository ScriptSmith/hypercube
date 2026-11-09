import {
  DataTexture,
  FloatType,
  NearestFilter,
  RGBAFormat,
  Vector2,
  type WebGLRenderTarget,
} from "three";
import { createRenderer3D } from "../../core/renderer3d";
import { WHOLE_SPHERE } from "../../core/sphere";
import { createSurfacePass } from "../../core/sphere3d";
import type { AppContext, AppInstance, FrameInfo } from "../../core/types";
import { createCrowd, createShading, shade } from "./light";
import { measureFlashes } from "./measure";
import { BALL } from "./shader";
import {
  createShow,
  type LightsMode,
  type SpinSetting,
  spinAngle,
  spinRate,
  TURN_SECONDS,
} from "./show";
import { buildLayout, CAP_LAT, PITCH, POLE_RADIUS, ROWS, TEX_WIDTH, TILE, GROUT } from "./tiles";

const DEBUG_KEY = "__discoball";

const dataTexture = (data: Float32Array, width: number, height: number): DataTexture => {
  const tex = new DataTexture(data, width, height, RGBAFormat, FloatType);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
};

export const mount = (ctx: AppContext): AppInstance => {
  let frame = ctx.frame;
  const sphere = () => frame.sphere ?? WHOLE_SPHERE;
  const mode: LightsMode = ctx.options.lights === "white" ? "white" : "party";
  const spin: SpinSetting = ctx.options.spin === "medium" ? "medium" : "slow";
  const turn = TURN_SECONDS[spin];

  const r3d = createRenderer3D(ctx.root, frame, { antialias: false });
  // The same tiles on every ball and every run; the show follows the frame's seed.
  const layout = buildLayout(ctx.rng("discoball:tiles"));
  const show = createShow(ctx.seed, mode);
  const crowd = createCrowd(ctx.seed);
  const shading = createShading(layout);

  const rowData = new Float32Array(ROWS * 4);
  layout.rows.forEach((r, i) => rowData.set([r.count, r.offset, r.lat, 0], i * 4));
  const rowTex = r3d.keep(dataTexture(rowData, ROWS, 1));
  const tileTex = r3d.keep(dataTexture(shading.data, TEX_WIDTH, ROWS));

  const uniforms = {
    uTheta: { value: 0 },
    uRowTex: { value: rowTex },
    uTileTex: { value: tileTex },
    uRows: { value: ROWS },
    uTexWidth: { value: TEX_WIDTH },
    uPitch: { value: PITCH },
    uTile: { value: TILE },
    uGrout: { value: GROUT },
    uCapLat: { value: CAP_LAT },
    uPoleR: { value: POLE_RADIUS },
    uPx: { value: new Vector2(1e-3, 1e-3) },
  };
  const pass = createSurfacePass(r3d, frame, { fragment: BALL, uniforms });

  const buffer = new Vector2();
  /** The shader smooths tile edges over one feed pixel. */
  const fitPixels = () => {
    r3d.renderer.getDrawingBufferSize(buffer);
    const s = sphere();
    uniforms.uPx.value.set(
      (2 * Math.PI) / Math.max(1, buffer.x),
      (s.cover.top - s.cover.bottom) / Math.max(1, buffer.y),
    );
  };
  fitPixels();

  let t = 0;
  let theta = 0;
  let drawn = 0;
  /** Milliseconds the CPU spends shading tiles each frame, smoothed. */
  let shadeMs = 0;
  let last = 0;
  const draw = (now: number, target: WebGLRenderTarget | null = null) => {
    const s = sphere();
    const lights = show.at(now);
    theta = spinAngle(now, turn);
    const t0 = performance.now();
    const dt = Math.min(0.25, Math.max(0, now - last));
    last = now;
    shade(layout, s, theta, lights, crowd.at(now, s.radius), shading, dt);
    shadeMs += (performance.now() - t0 - shadeMs) * 0.05;
    tileTex.needsUpdate = true;
    uniforms.uTheta.value = theta;
    pass.render(target);
    drawn++;
  };

  const step = 1 / 60;
  const loop = ctx.loop({
    hz: 60,
    update(dt) {
      t += dt;
    },
    render(alpha) {
      if (r3d.ready) draw(t + alpha * step);
    },
  });
  loop.start();

  ctx.onResize((f: FrameInfo) => {
    frame = f;
    r3d.resize(f);
    pass.setSphere(sphere());
    fitPixels();
  });

  const state = () => {
    const lights = show.at(t);
    return {
      t,
      ready: r3d.ready,
      drawn,
      shadeMs,
      scene: lights.scene,
      next: lights.next,
      fade: lights.fade,
      index: lights.index,
      lights: mode,
      spin,
      turn,
      rate: spinRate(t, turn),
      theta,
      spots: lights.spots.map((s) => ({ color: [...s.color], power: s.power, dir: [...s.dir] })),
      lit: shading.lit,
      tiles: layout.count,
    };
  };

  if (ctx.debug) {
    Object.defineProperty(window, DEBUG_KEY, {
      configurable: true,
      value: {
        state,
        /** Move the show on by `seconds`, as if they had passed. */
        skip: (seconds: number) => {
          t += Math.max(0, seconds);
        },
        /** Draw the next `seconds` of the show small and measure its flashing. */
        measure: (opts: { seconds: number; hz: number; width: number }) => {
          const px = uniforms.uPx.value.clone();
          uniforms.uPx.value.set((2 * Math.PI) / opts.width, (2 * Math.PI) / opts.width);
          const report = measureFlashes({
            ...opts,
            renderer: r3d.renderer,
            sphere: sphere(),
            start: t,
            draw: (now, target) => {
              draw(now, target);
              return shading.lit;
            },
          });
          uniforms.uPx.value.copy(px);
          return report;
        },
      },
    });
  }

  return {
    // Nothing a visitor or the 60 s idle can change; the show keeps running.
    reset() {},
    attract() {},
    status: () => {
      const lights = show.at(t);
      return { scene: lights.scene, lit: shading.lit, turn };
    },
    dispose() {
      loop.stop();
      if (ctx.debug) delete (window as unknown as Record<string, unknown>)[DEBUG_KEY];
      r3d.dispose();
    },
  };
};
