import { createRenderer3D } from "../../core/renderer3d";
import { WHOLE_SPHERE } from "../../core/sphere";
import { createSectorViews, type SectorViews } from "../../core/sphere3d";
import type { AppContext, AppInstance, FrameInfo } from "../../core/types";
import { sideOf, waterLevel } from "./bowl";
import { createGlass } from "./glass";
import { type HabitKind, HABITS } from "./habits";
import { createBowlScene } from "./scene";
import { layoutScenery } from "./scenery";
import { LOOP_SECONDS } from "./shaders";
import { createShow } from "./show";
import type { Stock } from "./species";
import { latLonOf } from "../../core/sphere";

const DEBUG_KEY = "__fishbowl";
/** Most a debug skip runs the show forward, seconds. */
const MAX_SKIP = 3600;
/**
 * Software renderers (tests, a machine without a GPU) render each view this big, unsampled,
 * and the feed at half size, since a full frame would take most of a second.
 */
const SOFTWARE_VIEW = 320;
const SOFTWARE_SCALE = 0.5;
/**
 * Viewers round the ball. With the default three, the band from about 25° above the equator
 * to the waterline, midway between two viewers, is seen edge on or not at all and shows smeared
 * views. Five see the worst of it at about 80° from square on. Something in the middle of the
 * bowl shows once in each view, and with five the extra copies fall near the edge of the ball
 * as seen from any one viewer; with six they move further in. On the laptop's NVIDIA GPU at the
 * full feed, five cost about 1 ms a frame more than four and 1.5 ms less than six.
 */
const AROUND = 5;

const isSoftware = (gl: WebGLRenderingContext | WebGL2RenderingContext): boolean => {
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  return /swiftshader|llvmpipe|softpipe|software/i.test(name);
};

/**
 * The views' cameras stop just behind the ball; the surface's reflected copy of the bowl lies
 * beyond that, so they need to see further.
 */
const reachFar = (views: SectorViews, f: FrameInfo) => {
  const r = (f.sphere ?? WHOLE_SPHERE).radius;
  for (const v of views.viewers) {
    v.camera.far = v.camera.near + r * 6;
    v.camera.updateProjectionMatrix();
  }
};

export const mountBowl = (ctx: AppContext): AppInstance => {
  let frame = ctx.frame;
  const sphere = () => frame.sphere ?? WHOLE_SPHERE;
  const stock: Stock = ctx.options.fish === "many" ? "many" : "few";
  const feeding = ctx.options.feeding !== false;

  const r3d = createRenderer3D(ctx.root, frame, { antialias: false });
  const software = isSoftware(r3d.renderer.getContext());
  const fit = (f: FrameInfo) => {
    r3d.resize(f);
    if (!software) return;
    r3d.renderer.setPixelRatio(f.pixelRatio * SOFTWARE_SCALE);
    r3d.renderer.setSize(f.width, f.height, false);
  };
  fit(frame);
  const views = r3d.keep(
    createSectorViews(r3d, frame, {
      around: AROUND,
      ...(software ? { size: SOFTWARE_VIEW, samples: 0 } : {}),
    }),
  );
  reachFar(views, frame);
  const viewSide = (f: FrameInfo) =>
    software ? SOFTWARE_VIEW : Math.max(256, Math.min(2048, Math.round(f.height * f.pixelRatio)));

  const base = ctx.rng();
  const scenery = layoutScenery(base.fork("scenery"));
  const show = createShow(base.fork("show"), scenery, {
    stock,
    variant: ctx.variant,
    feeding,
    water: waterLevel(sphere()),
    view: sphere().view,
  });
  const bowl = createBowlScene(sphere(), scenery, show, base.fork("looks"), software);
  bowl.resize(sphere(), show.water, viewSide(frame));
  r3d.prepare(bowl.scene, views.viewers[0]!.camera);
  const glass = createGlass(r3d, frame, views, show.water);

  let drawn = 0;
  const loop = ctx.loop({
    hz: 60,
    update(dt) {
      show.step(dt);
    },
    render() {
      if (!r3d.ready) return;
      bowl.sync(show, show.time % LOOP_SECONDS);
      views.render(bowl.scene);
      glass.render();
      drawn++;
    },
  });
  loop.start();

  const offResize = ctx.onResize((f) => {
    frame = f;
    fit(f);
    views.resize(f);
    reachFar(views, f);
    const water = waterLevel(sphere());
    show.setView(water, sphere().view);
    bowl.resize(sphere(), water, viewSide(f));
    glass.resize(f, water);
  });

  const state = () => ({
    t: show.time,
    drawn,
    ready: r3d.ready,
    software,
    water: show.water,
    feeding: show.feeding,
    flakes: show.flakes.length,
    habits: show.habits.map((h) => ({ kind: h.kind, side: h.side, start: h.start })),
    counts: { ...show.counts },
    sides: [...show.sideCounts],
    fish: show.fish.map((f) => {
      const { lat, lon } = latLonOf(f.pos);
      return {
        species: f.species,
        r: Math.hypot(...f.pos),
        lat,
        lon,
        side: sideOf(lon),
        task: f.task?.kind ?? null,
        phase: f.task && "phase" in f.task ? f.task.phase : null,
        nose: Math.hypot(...f.pos.map((v, i) => v + f.fwd[i]! * f.len * 0.5)),
        puff: f.puff,
      };
    }),
    snails: show.snails.length,
    snailsAt: show.snails.map((s) => latLonOf(s.u)),
    triangles: bowl.triangles,
    drawCalls: bowl.drawCalls,
  });

  if (ctx.debug) {
    Object.defineProperty(window, DEBUG_KEY, {
      configurable: true,
      value: {
        state,
        /** Run the show forward by `seconds`, as if they had passed. */
        advance(seconds: number) {
          let left = Math.min(MAX_SKIP, Math.max(0, seconds));
          while (left > 0) {
            const dt = Math.min(1 / 30, left);
            show.step(dt);
            left -= dt;
          }
        },
        trigger: (kind: HabitKind, side?: number) => show.trigger(kind, side),
      },
    });
  }

  return {
    // The show runs on: nothing an idle reset or admin should undo.
    reset() {},
    status: () => ({
      fish: show.fish.length,
      doing: show.habits.map((h) => h.kind).join(" ") || "swimming",
      feeds: show.counts.feed,
    }),
    command(name) {
      if ((HABITS as readonly string[]).includes(name)) show.trigger(name as HabitKind);
    },
    dispose() {
      loop.stop();
      offResize();
      if (ctx.debug) delete (window as unknown as Record<string, unknown>)[DEBUG_KEY];
      bowl.dispose();
      r3d.dispose();
    },
  };
};
