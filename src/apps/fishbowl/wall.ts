/**
 * The wall: the front glass of a big planted tank, seen through `view3d` from a person in front
 * of it. A tap on the glass startles the fish nearby and brings curious ones to look at the
 * finger; a finger held on the glass sprinkles food on the surface above it.
 */
import { PerspectiveCamera } from "three";
import { type BotTouch, createBotHand } from "../../core/input";
import { createRenderer3D } from "../../core/renderer3d";
import type { AppContext, AppInstance, FrameInfo, Pointer } from "../../core/types";
import {
  applyToCamera,
  defaultEye,
  displaySurface,
  frameView,
  surfaceOf,
  type Surface,
} from "../../core/view3d";
import { createPost } from "./post";
import { LOOP_SECONDS } from "./shaders";
import { tankCast, type Stock } from "./species";
import { layoutTank, tankBox } from "./tank";
import { createTankScene, type Ring, type TankScene } from "./tankscene";
import { createTankShow, TANK_HABITS, type TankHabit } from "./tankshow";

const DEBUG_KEY = "__fishbowl";
const MAX_SKIP = 3600;
/** A software renderer draws the wall at this share of the stage's pixels, without multisampling. */
const SOFTWARE_SCALE = 0.3;
/** Held this long, a finger starts to sprinkle food. */
const HOLD_S = 0.35;
/** Seconds between flakes while a finger is held. */
const SPRINKLE_S = 0.16;
/** Most fingers followed at once. */
const MAX_TOUCHES = 12;
/** Bots stand back this long after a person touches the glass. */
const BOT_YIELD_S = 20;

const isSoftware = (gl: WebGLRenderingContext | WebGL2RenderingContext): boolean => {
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  return /swiftshader|llvmpipe|softpipe|software/i.test(name);
};

interface Finger {
  x: number;
  y: number;
  down: number;
  next: number;
  synthetic: boolean;
}

export const mountWall = (ctx: AppContext): AppInstance => {
  let frame = ctx.frame;
  const stock: Stock = ctx.options.fish === "many" ? "many" : "few";
  const feedingOn = ctx.options.feeding !== false;

  const r3d = createRenderer3D(ctx.root, frame, { antialias: false });
  const software = isSoftware(r3d.renderer.getContext());
  const post = createPost(r3d.renderer, {
    samples: software ? 0 : 4,
    bloom: !software,
    exposure: 1.15,
  });
  let tank: TankScene | null = null;
  const fit = (f: FrameInfo) => {
    r3d.resize(f);
    if (software) {
      r3d.renderer.setPixelRatio(f.pixelRatio * SOFTWARE_SCALE);
      r3d.renderer.setSize(f.width, f.height, false);
    }
    post.resize(r3d.canvas.width, r3d.canvas.height);
    tank?.resize(r3d.canvas.height);
  };
  fit(frame);

  const wall = displaySurface(frame, ctx.setup);
  const eye = defaultEye(frame, ctx.setup);
  const base = ctx.rng();
  const layout = layoutTank(tankBox(wall, eye), base.fork("tank"));
  const show = createTankShow(base.fork("show"), {
    cast: tankCast(ctx.variant, stock),
    feeding: feedingOn,
    layout,
    eye,
  });
  tank = createTankScene(layout, show, base.fork("looks"), {
    detail: software ? 1 : 2,
    light: software,
  });
  tank.resize(r3d.canvas.height);

  const camera = new PerspectiveCamera();
  let surface: Surface = surfaceOf(frame, ctx.setup);
  const aim = (f: FrameInfo) => {
    surface = surfaceOf(f, ctx.setup);
    const view = frameView(f, ctx.setup, { eye });
    const d = view.distance;
    applyToCamera(view, camera, Math.max(0.5, d * 0.6), d + 40);
  };
  aim(frame);
  r3d.prepare(tank.scene, camera);
  r3d.prepare(tank.lamp.scene, tank.lamp.camera);

  /** The glass under a stage point, in metres. */
  const toGlass = (x: number, y: number) => ({
    x: surface.origin[0] + (x / Math.max(1, frame.width)) * surface.width,
    y: surface.origin[1] + (1 - y / Math.max(1, frame.height)) * surface.height,
  });

  const fingers = new Map<number, Finger>();
  let lastHuman = -Infinity;
  let attract = false;

  const offDown = ctx.input.on("down", (p: Pointer) => {
    if (fingers.size >= MAX_TOUCHES) return;
    const g = toGlass(p.x, p.y);
    if (g.y > layout.box.water) return;
    if (!p.synthetic) {
      lastHuman = show.time;
      attract = false;
    }
    fingers.set(p.id, {
      x: g.x,
      y: g.y,
      down: show.time,
      next: show.time + HOLD_S,
      synthetic: p.synthetic,
    });
    show.tap(g.x, g.y);
  });
  const offMove = ctx.input.on("move", (p: Pointer) => {
    const f = fingers.get(p.id);
    if (!f) return;
    const g = toGlass(p.x, p.y);
    f.x = g.x;
    f.y = Math.min(g.y, layout.box.water);
  });
  const lift = (p: Pointer) => {
    fingers.delete(p.id);
    show.lift(p.id);
  };
  const offUp = ctx.input.on("up", lift);
  const offCancel = ctx.input.on("cancel", lift);

  const stepFingers = () => {
    for (const [id, f] of fingers) {
      if (show.time < f.next) continue;
      f.next = show.time + SPRINKLE_S;
      show.sprinkle(f.x, id);
    }
  };

  // Bots tap and feed through synthetic touches, as a visitor would; one slow ghost in attract.
  const hand = createBotHand(ctx.input);
  const botRng = base.fork("bots");
  const bots = Array.from({ length: Math.min(4, Math.max(0, ctx.bots)) }, (_, i) => ({
    next: 2 + i * 1.7,
    touch: null as BotTouch | null,
    until: 0,
  }));
  const ghost = { next: 6, touch: null as BotTouch | null, until: 0 };
  const reachable = () => {
    const band = Math.max(0.1, frame.reach.adult);
    const child = Math.max(0.05, frame.reach.child);
    const low = botRng.next() < 0.4;
    const y = frame.height * (1 - (low ? botRng.range(0.06, child) : botRng.range(child, band)));
    const x = frame.width * botRng.range(0.06, 0.94);
    return { x, y };
  };
  const act = (b: { next: number; touch: BotTouch | null; until: number }, slow: boolean) => {
    if (b.touch) {
      if (show.time >= b.until) {
        b.touch.up();
        b.touch = null;
        b.next = show.time + (slow ? botRng.range(14, 26) : botRng.range(3, 9));
      }
      return;
    }
    if (show.time < b.next) return;
    const { x, y } = reachable();
    b.touch = hand.press(x, y);
    b.until = show.time + (botRng.next() < (slow ? 0.5 : 0.35) ? botRng.range(1.5, 4) : 0.12);
  };
  const stepBots = () => {
    const quiet = show.time - lastHuman > BOT_YIELD_S;
    if (bots.length > 0) {
      for (const b of bots) {
        if (quiet) act(b, false);
        else if (b.touch) {
          b.touch.up();
          b.touch = null;
        }
      }
    } else if (attract && quiet) {
      act(ghost, true);
    } else if (ghost.touch) {
      ghost.touch.up();
      ghost.touch = null;
    }
  };

  const rings: Ring[] = [];
  const ringsNow = (): Ring[] => {
    rings.length = 0;
    for (const f of fingers.values())
      rings.push({ x: f.x, y: f.y, age: show.time - f.down, held: show.time - f.down > HOLD_S });
    for (const t of show.taps) {
      const age = show.time - t.at;
      if (age < 0.9) rings.push({ x: t.x, y: t.y, age, held: false });
    }
    return rings;
  };

  let drawn = 0;
  const loop = ctx.loop({
    hz: 60,
    update(dt) {
      stepBots();
      stepFingers();
      show.step(dt);
    },
    render() {
      if (!r3d.ready) return;
      tank.sync(show, show.time % LOOP_SECONDS, ringsNow());
      const r = r3d.renderer;
      tank.lamp.render(r);
      r.setRenderTarget(post.target);
      r.clear();
      r.render(tank.scene, camera);
      post.finish();
      drawn++;
    },
  });
  // Start from inside a frame: building the tank holds the page for a moment, and a frame
  // stamped before the loop started would otherwise set its clock back.
  let startFrame = requestAnimationFrame(() => {
    startFrame = 0;
    loop.start();
  });

  const offResize = ctx.onResize((f) => {
    frame = f;
    fit(f);
    aim(f);
  });

  const state = () => ({
    t: show.time,
    drawn,
    ready: r3d.ready,
    software,
    kind: "wall",
    water: layout.box.water,
    feeding: show.feeding,
    food: show.food.length,
    flakes: show.food.length,
    fingers: fingers.size,
    attract,
    habits: show.habits.map((h) => ({ kind: h.kind, side: h.side, start: h.start })),
    counts: { ...show.counts },
    sides: [...show.sideCounts],
    taps: show.taps.length,
    fish: show.fish.map((f) => ({
      species: f.species,
      x: f.pos[0],
      y: f.pos[1],
      z: f.pos[2],
      speed: f.speed,
      task: f.task?.kind ?? null,
      phase: f.task && "phase" in f.task ? f.task.phase : null,
      nose: f.pos[2] + f.fwd[2] * f.len * 0.5,
      hunger: f.hunger,
      fear: f.fear,
      puff: f.puff,
    })),
    shrimp: show.shrimp.map((s) => ({ x: s.pos[0], y: s.pos[1], z: s.pos[2], state: s.state })),
    snails: show.snails.length,
    box: layout.box,
    triangles: tank.triangles,
    drawCalls: tank.drawCalls,
  });

  if (ctx.debug) {
    Object.defineProperty(window, DEBUG_KEY, {
      configurable: true,
      value: {
        state,
        advance(seconds: number) {
          let left = Math.min(MAX_SKIP, Math.max(0, seconds));
          while (left > 0) {
            const dt = Math.min(1 / 30, left);
            stepFingers();
            show.step(dt);
            left -= dt;
          }
        },
        trigger: (kind: TankHabit | "feed", side?: number) => show.trigger(kind, side),
        scene: tank.scene,
        camera,
        /** Stage px of a glass point in metres, for tests that touch it. */
        toStage(x: number, y: number) {
          return {
            x: ((x - surface.origin[0]) / surface.width) * frame.width,
            y: (1 - (y - surface.origin[1]) / surface.height) * frame.height,
          };
        },
      },
    });
  }

  return {
    reset() {
      // The tank lives on; only what visitors started is let go.
      for (const b of [...bots, ghost]) {
        b.touch?.up();
        b.touch = null;
      }
      hand.release();
      fingers.clear();
      show.calm();
      attract = false;
    },
    attract() {
      attract = true;
      ghost.next = show.time + 8;
    },
    status: () => ({
      fish: show.fish.length,
      doing: show.habits.map((h) => h.kind).join(" ") || "swimming",
      feeds: show.counts.feed,
      taps: show.counts.tap,
    }),
    command(name) {
      if ((TANK_HABITS as readonly string[]).includes(name)) show.trigger(name as TankHabit);
    },
    dispose() {
      cancelAnimationFrame(startFrame);
      loop.stop();
      offResize();
      offDown();
      offMove();
      offUp();
      offCancel();
      hand.dispose();
      if (ctx.debug) delete (window as unknown as Record<string, unknown>)[DEBUG_KEY];
      tank.dispose();
      post.dispose();
      r3d.dispose();
    },
  };
};
