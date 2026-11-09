/**
 * Claw Machine: arcade claw machines stand round the ball and play themselves. Claws drop, grab,
 * wobble and mostly let go; now and then a prize goes down the chute, out of the door and across
 * the floor to a heap round the bottom pole for the people underneath.
 *
 * - world.ts     one cabinet's planck.js physics: walls, chute, the claw on its cable, prizes
 * - machine.ts   the cabinet's own logic (phases, grip strength, top-ups); bot.ts its player
 * - arcade.ts    every cabinet and the heap, without drawing; heap.ts the prizes' way out
 * - layout.ts    the strip round the ball and the cabinet's proportions
 * - scene.ts     the strip (wall and cabinets) on a Mercator `Strip`; cabinet.ts one cabinet
 * - floor.ts     the ceiling, the carpet and the heap round the pole, a `SurfacePass`
 * - plush.ts     the prizes' drawings; designs.ts their outlines and colours
 *
 * On a wall the same cabinets stand in a row with buttons to play them: see wall.ts.
 */
import { createRenderer3D } from "../../core/renderer3d";
import { type SphereMap, sphereMap, WHOLE_SPHERE } from "../../core/sphere";
import type { AppContext, AppInstance, FrameInfo } from "../../core/types";
import { type Arcade, createArcade, heapRadius, type Luck } from "./arcade";
import { createFloor } from "./floor";
import { layoutArcade } from "./layout";
import { createStripScene, NEON_LINEAR, type StripScene } from "./scene";
import { mountWall } from "./wall";

const DEBUG_KEY = "__claw";

export const mount = (ctx: AppContext): AppInstance =>
  ctx.frame.kind === "wall" ? mountWall(ctx) : mountSphere(ctx);

const mountSphere = (ctx: AppContext): AppInstance => {
  const count = ctx.options.machines === "3" ? 3 : 4;
  const luck: Luck = ctx.options.luck === "generous" ? "generous" : "fair";
  const rng = ctx.rng().fork("claw");
  let frame = ctx.frame;
  const sphere = () => frame.sphere ?? WHOLE_SPHERE;

  let layout = layoutArcade(sphere(), count);
  let arcade: Arcade = createArcade({ layout, sphere: sphere(), rng: rng.fork("arcade"), luck });

  const r3d = createRenderer3D(ctx.root, frame, { antialias: false, zIndex: 0 });
  const floor = createFloor(r3d, {
    frame,
    top: layout.top,
    bottom: layout.bottom,
    metresPerU: layout.metresPerU,
    heapR: heapRadius(sphere()),
    heap: arcade.heap,
    neon: NEON_LINEAR,
  });
  const feed = document.createElement("canvas");
  feed.style.cssText = "position:absolute;inset:0;width:100%;height:100%;z-index:1;";
  ctx.root.append(feed);
  const fg = feed.getContext("2d");

  let scene: StripScene | null = null;
  let map: SphereMap = sphereMap(sphere(), 1, 1);
  let rebuilds = 0;

  const build = (f: FrameInfo) => {
    feed.width = Math.max(1, Math.round(f.width * f.pixelRatio));
    feed.height = Math.max(1, Math.round(f.height * f.pixelRatio));
    map = sphereMap(sphere(), feed.width, feed.height);
    scene?.dispose();
    scene = createStripScene({
      arcade,
      sphere: sphere(),
      feedWidth: feed.width,
      rng: rng.fork("scene"),
    });
  };
  build(frame);

  let physicsMs = 0;
  let drawMs = 0;
  let floorMs = 0;
  let floorDraws = 0;
  let frames = 0;
  let wasReady = false;
  const smooth = (v: number, x: number) => v + (x - v) * 0.05;

  const loop = ctx.loop({
    hz: 60,
    update() {
      const t0 = performance.now();
      arcade.step();
      physicsMs = smooth(physicsMs, performance.now() - t0);
    },
    render() {
      const now = arcade.time;
      const t0 = performance.now();
      if (scene && fg) {
        scene.draw(now);
        scene.paint(fg, map);
      }
      const t1 = performance.now();
      drawMs = smooth(drawMs, t1 - t0);
      if (r3d.ready) {
        if (floor.render(now, !wasReady)) {
          floorDraws++;
          floorMs = smooth(floorMs, performance.now() - t1);
        }
        wasReady = true;
      }
      frames++;
    },
  });
  loop.start();

  ctx.onResize((f) => {
    frame = f;
    r3d.resize(f);
    const next = layoutArcade(sphere(), count);
    const same =
      next.play.width === layout.play.width &&
      next.play.height === layout.play.height &&
      next.cabinets.length === layout.cabinets.length;
    layout = next;
    if (!same) {
      // A different ball: new cabinets, but the heap stays.
      const heap = arcade.heap;
      arcade.dispose();
      arcade = createArcade({
        layout,
        sphere: sphere(),
        rng: rng.fork(`arcade-${++rebuilds}`),
        luck,
        heap,
        start: arcade.time,
      });
    }
    arcade.heap.setGeometry({
      radius: sphere().radius,
      floor: layout.bottom,
      heap: heapRadius(sphere()),
    });
    floor.setGeometry({
      frame: f,
      top: layout.top,
      bottom: layout.bottom,
      metresPerU: layout.metresPerU,
      heapR: heapRadius(sphere()),
    });
    build(f);
    wasReady = false;
  });

  const state = () => ({
    t: arcade.time,
    ready: r3d.ready,
    frames,
    wins: arcade.wins,
    luck,
    heap: arcade.heap.items.length,
    landed: arcade.heap.landed,
    flights: arcade.heap.flights.map((f) => ({
      cabinet: f.cabinet,
      stage: arcade.heap.pose(f, arcade.time).stage,
    })),
    machines: arcade.machines.map((m) => ({
      phase: m.phase,
      round: m.round,
      wins: m.wins,
      prizes: m.world.prizes.length,
      stock: m.stock,
      strong: m.grip?.strong ?? null,
      x: m.world.trolleyX(),
      rounds: m.rounds.length,
      bodies: m.world.world.getBodyCount(),
    })),
    layout: {
      top: layout.top,
      bottom: layout.bottom,
      play: layout.play,
      glassLat: layout.glassLat,
      metresPerU: layout.metresPerU,
    },
    strip: scene ? { width: scene.canvas.width, height: scene.canvas.height } : null,
    feed: { width: feed.width, height: feed.height },
    atlas: { width: floor.atlas.width, height: floor.atlas.height },
    onFloor: floor.drawn,
    physicsMs,
    drawMs,
    floorMs,
    floorDraws,
  });

  if (ctx.debug) {
    Object.defineProperty(window, DEBUG_KEY, {
      configurable: true,
      value: {
        state,
        /** Run the arcade on by `seconds`, as if they had passed (without drawing them). */
        skip(seconds: number) {
          const n = Math.max(0, Math.round(seconds * 60));
          for (let i = 0; i < n; i++) arcade.step();
        },
        /** Drop a prize from cabinet `i` into its chute. */
        win: (i: number) => arcade.forceWin(i),
        /** Make cabinet `i`'s next round a strong one. */
        strong(i: number) {
          arcade.machines[i]?.forceStrong();
        },
      },
    });
  }

  return {
    // Nothing is touched and nothing needs putting back: the machines play on.
    reset() {},
    attract() {},
    status: () => ({
      machines: arcade.machines.length,
      luck,
      wins: arcade.wins,
      heap: arcade.heap.items.length,
    }),
    dispose() {
      loop.stop();
      if (ctx.debug) delete (window as unknown as Record<string, unknown>)[DEBUG_KEY];
      scene?.dispose();
      scene = null;
      floor.dispose();
      arcade.dispose();
      feed.width = feed.height = 0;
      feed.remove();
      r3d.dispose();
    },
  };
};
