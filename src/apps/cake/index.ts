import { createRenderer3D } from "../../core/renderer3d";
import type { AppContext, AppInstance, FrameInfo } from "../../core/types";
import { createGlaze, type DripMode, type Pace, SEEN_SPEED } from "./glaze";
import { type CakeId, CAKES, lookOf } from "./looks";
import { createPainter } from "./painter";

const MODES: readonly DripMode[] = ["none", "set", "runs", "drops"];

/** Seconds of glaze run before the show starts, so it opens with drips under way. */
const PREWARM = 420;
/** Longest the debug hook may skip in one go, s. */
const MAX_SKIP = 3600;
/** How often the glaze field is redrawn while nothing moves fast, s. */
const FIELD_EVERY = 1 / 15;
const EXPOSURE = 0.9;
/** Software renderers (tests, a machine without a GPU) draw the feed at this fraction. */
const SOFTWARE_SCALE = 0.5;

const isSoftware = (gl: WebGLRenderingContext | WebGL2RenderingContext): boolean => {
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  return /swiftshader|llvmpipe|softpipe|software/i.test(name);
};

export const mount = (ctx: AppContext): AppInstance => {
  const cake: CakeId = (CAKES as readonly string[]).includes(ctx.variant)
    ? (ctx.variant as CakeId)
    : "pudding";
  const look = lookOf(cake, ctx.options.glaze === "custard" ? "custard" : "icing");
  const drips: DripMode = (MODES as readonly unknown[]).includes(ctx.options.drips)
    ? (ctx.options.drips as DripMode)
    : "none";
  const pace: Pace = ctx.options.pace === "lively" ? "lively" : "slow";
  const turn = ctx.options.turn !== false;

  const r3d = createRenderer3D(ctx.root, ctx.frame, { antialias: false });
  const software = isSoftware(r3d.renderer.getContext());
  const fit = (f: FrameInfo) => {
    r3d.resize(f);
    if (!software) return;
    r3d.renderer.setPixelRatio(f.pixelRatio * SOFTWARE_SCALE);
    r3d.renderer.setSize(f.width, f.height, false);
  };
  fit(ctx.frame);

  const glaze = createGlaze(ctx.rng().fork("glaze"), {
    pace,
    kind: look.kind,
    turn,
    drips,
    prewarm: PREWARM,
  });
  const painter = createPainter(r3d, ctx.frame, {
    look,
    exposure: EXPOSURE,
    software,
    seed: ctx.seed,
  });

  let fieldAt = -1e9;
  // A still glaze is drawn into the field once, and again only when the field is lost.
  let fieldStale = true;
  const offRestore = r3d.onRestore(() => {
    fieldStale = true;
  });
  let fieldUpdates = 0;
  let drawn = 0;
  let resets = 0;

  /** Something is stretching, springing back or falling, so the field must keep up. */
  const quick = () =>
    glaze.pool.neck > 0 ||
    glaze.drops.length > 0 ||
    glaze.drips.some((d) => d.neck > 0 || d.spring !== 0);

  const loop = ctx.loop({
    hz: 60,
    update(dt) {
      glaze.step(dt);
    },
    render() {
      if (!r3d.ready) return;
      if (!painter.bake()) return;
      const due = glaze.moving ? quick() || glaze.time - fieldAt >= FIELD_EVERY : fieldStale;
      if (due) {
        fieldStale = false;
        painter.updateField(glaze);
        fieldAt = glaze.time;
        fieldUpdates++;
      }
      painter.draw(glaze);
      drawn++;
    },
  });
  loop.start();

  const offResize = ctx.onResize((f) => {
    fit(f);
    painter.resize(f);
    fieldStale = true;
  });

  const moving = () => glaze.drips.filter((d) => d.v > SEEN_SPEED).length;
  const bottomShare = () => Math.round((glaze.pool.vol / glaze.pool.need) * 100) / 100;

  const debugKey = "__cake";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => ({
          cake,
          mode: glaze.mode,
          moving: glaze.moving,
          ready: painter.ready,
          drawn,
          fieldUpdates,
          resets,
          software,
          bake: painter.bakeSize,
          time: glaze.time,
          yaw: glaze.yaw,
          pours: glaze.pours,
          nextPour: glaze.nextPour - glaze.time,
          released: glaze.released,
          falls: glaze.pool.falls,
          bottom: bottomShare(),
          capFresh: glaze.capFresh,
          edge: [Math.min(...glaze.edge), Math.max(...glaze.edge)],
          drops: glaze.drops.length,
          drips: glaze.drips.map((d) => ({
            id: d.id,
            lon: d.lon,
            tip: d.tip,
            v: d.v,
            phase: d.phase,
            bead: d.bead,
            drops: d.drops,
            neck: d.neck,
          })),
        }),
        skip: (seconds: number) => {
          let left = Math.min(MAX_SKIP, Math.max(0, seconds));
          while (left > 0) {
            const dt = Math.min(1 / 30, left);
            glaze.step(dt);
            left -= dt;
          }
        },
        pour: () => glaze.pour(),
        /** Milliseconds per surface draw and per field update, waiting for the GPU each time. */
        bench: (n = 20) => {
          const gl = r3d.renderer.getContext();
          const px = new Uint8Array(4);
          const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          const time = (f: () => void) => {
            sync();
            const t0 = performance.now();
            for (let i = 0; i < n; i++) {
              f();
              sync();
            }
            return (performance.now() - t0) / n;
          };
          const empty = time(() => undefined);
          return {
            draw: time(() => painter.draw(glaze)) - empty,
            field: time(() => painter.updateField(glaze)) - empty,
            sync: empty,
            canvas: [r3d.canvas.width, r3d.canvas.height],
          };
        },
      },
    });
  }

  return {
    reset() {
      // The show is the app: nothing restarts it. Only re-read the frame's sphere.
      resets++;
      painter.resize(ctx.frame);
      fieldStale = true;
    },
    command(name) {
      if (name === "pour") glaze.pour();
    },
    status: () => ({
      cake,
      glaze: look.kind,
      mode: drips,
      pace,
      turn,
      drips: glaze.drips.length,
      moving: moving(),
      pours: glaze.pours,
      nextPour: glaze.moving ? Math.max(0, Math.round(glaze.nextPour - glaze.time)) : -1,
      bottom: bottomShare(),
      falls: glaze.pool.falls,
      dropped: glaze.released,
    }),
    dispose() {
      loop.stop();
      offResize();
      offRestore();
      if (ctx.debug) delete (window as unknown as Record<string, unknown>)[debugKey];
      painter.dispose();
      r3d.dispose();
    },
  };
};
