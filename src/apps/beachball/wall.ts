/**
 * Beach balls on a wall. A few big balls rest on the sand of a beach that fills the wall;
 * fingers bat them, carry them and throw them, and they fly, spin, bounce off the sand, the
 * sides, the top and each other, then roll to rest. Now and then a big wave runs up under them
 * and leaves them wet, and a wet ball flings drops when it is struck. Beach toys lie on the sand
 * between them to pick up, flip and throw, and a volleyball net can stand across the middle. A
 * beach umbrella stands at the left end for things to bounce off; the bucket's sand falls out
 * when it is turned over and leaves a castle or a heap; and a crab scuttles about the sand and
 * snaps at fingers that touch it.
 *
 * With nobody there an unseen hand tosses a ball or a toy every few seconds, now and then over
 * the net, and bots (`ctx.bots`) play through synthetic touches. A person's touch sends both
 * away for a while.
 */
import { Color, Matrix3, OrthographicCamera, Scene, Vector3, Vector4 } from "three";
import { createRenderer3D } from "../../core/renderer3d";
import { type Mat3, multiply3, rotationAbout, transpose3 } from "../../core/sphere";
import { toMatrix3 } from "../../core/sphere3d";
import type { AppContext, AppInstance, FrameInfo, Pointer } from "../../core/types";
import { sandCentre } from "./geometry";
import { PALETTE_IDS, type PaletteId, paletteOf } from "./palettes";
import { type BotBall, createWallBots } from "./wallbots";
import { createBatch, createFx, fadeOf, MAX_PARTICLES } from "./wallfx";
import { ballCount, ballShadow, pxPerM, type WallLayout, wallLayout } from "./walllayout";
import { netScene } from "./wallnet";
import { createCrab, CRAB } from "./wallcrab";
import { createCrabView } from "./wallcrabview";
import { createWorld, GRAB, netFlight, type Prop, type WorldEvent } from "./wallphysics";
import { extentAt, PROP_KINDS, PROP_SPECS } from "./wallprops";
import { createBeachLights, createPropViews, setPaintEnv } from "./wallpropview";
import { CASTLE, createSand, HEAP, MAX_MOUNDS, type SandFx } from "./wallsand";
import { createMoundViews } from "./wallsandview";
import { createUmbrellaView } from "./wallumbrellaview";
import { createBeach, createNoiseTexture, SWELL_WRAP } from "./wallscene";
import { createSea } from "./wallsea";
import { SUN, WALL_BALL_GLSL } from "./wallshade";
import {
  applyLook,
  blankLook,
  createSkyUniforms,
  CYCLE_S,
  cycleAt,
  lookAt,
  shadowSun,
  SKY_MODES,
  type SkyMode,
} from "./wallsky";
import { createWallBall, type WallBall } from "./wallview";

const HZ = 120;
const TAU = Math.PI * 2;
/** Where the eye that sees each ball stands: its height off the wall's bottom edge and distance. */
const EYE_HEIGHT = 1.5;
const EYE_BACK = 4;
/** A share of each ball's offset from the middle the eye leans towards, for a hint of perspective. */
const EYE_LEAN = 0.12;
/** A person's touch keeps the bots and the unseen hand away this long, s. */
export const YIELD_S = 12;
/** A finger's speed fades this fast once it has sent no moves for two frames, ms. */
const FINGER_QUIET_MS = 40;
/** Seconds between the unseen hand's tosses. */
export const HAND_GAP = [5, 12] as const;
/** Shares of the unseen hand's tosses that go to a toy, and of its ball tosses aimed over the net. */
const HAND_TOY = 0.3;
const HAND_VOLLEY = 0.5;
/** Share of the unseen hand's turns spent poking the crab, and how long it presses, s. */
const HAND_CRAB = 0.18;
const HAND_PRESS = [0.5, 0.9] as const;
/** The unseen hand's finger, which no real pointer uses. */
const HAND_FINGER = -7;
/**
 * A bucket left upside down over its castle is lifted off by the unseen hand after this long,
 * s: soon with nobody there, later when people are, so they can lift it themselves.
 */
export const UNCOVER = { quiet: 2.5, busy: 7 } as const;
/**
 * The umbrella left lying out of the sand is stood up again by the unseen hand after this long,
 * s: a while with nobody there, much longer when people are, so a game can go on without it.
 */
export const REPLANT = { quiet: 20, busy: 120 } as const;
/** How high off the sand a ball can be and still be caught by the wash, metres. */
const WASH_DEPTH = 0.08;
/** Seconds for a soaked ball to dry. */
const DRY_S = 75;
/** One swell every this many seconds, and the clouds' drift in noise tiles a second. */
const SWELL_PERIOD = 8;
const CLOUD_DRIFT = [0.0011, 0.00025] as const;
const MAX_SKIP = 3600;
const SHADOW: readonly number[] = [0.04, 0.05, 0.1];
/** Soft patches the umbrella's shadow is drawn with: its canopy's and its pole's. */
const POLE_SHADOWS = 9;
const UMBRELLA_SHADOWS = 2 + POLE_SHADOWS;

/** Software renderers (tests, a machine without a GPU) draw at this share of the pixel ratio. */
const SOFTWARE_SCALE = 0.5;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The shortest turn from angle a to b. */
const turnBetween = (a: number, b: number) => {
  const d = b - a;
  return d - TAU * Math.round(d / TAU);
};

const isSoftware = (gl: WebGLRenderingContext | WebGL2RenderingContext): boolean => {
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  return /swiftshader|llvmpipe|softpipe|software/i.test(name);
};

export const mountWall = (ctx: AppContext): AppInstance => {
  let frame = ctx.frame;
  const colours: PaletteId = (PALETTE_IDS as unknown[]).includes(ctx.options.colours)
    ? (ctx.options.colours as PaletteId)
    : "classic";
  const palette = paletteOf(colours);
  const extras = ctx.options.extras !== false;
  const count = ballCount(ctx.options.balls);
  const kinds = ctx.options.props === false ? [] : PROP_KINDS;
  const hasNet = ctx.options.net !== false;
  const hasUmbrella = ctx.options.umbrella !== false;
  const hasCrab = ctx.options.crab !== false;
  const skyMode: SkyMode = (SKY_MODES as unknown[]).includes(ctx.options.sky)
    ? (ctx.options.sky as SkyMode)
    : "cycle";
  const rng = ctx.rng().fork("beachball-wall");

  /** Stage px per metre. */
  const scale = (f: FrameInfo) => pxPerM() * f.unit;
  const fits = kinds.map((k) => {
    const e = extentAt(PROP_SPECS[k], PROP_SPECS[k].rest);
    return { left: e.left, right: e.right };
  });
  const layoutOf = (f: FrameInfo): WallLayout =>
    wallLayout(f.width / f.unit, f.height / f.unit, f.reach, count, {
      net: hasNet,
      props: fits,
      umbrella: hasUmbrella,
      crab: hasCrab,
    });
  let layout = layoutOf(frame);
  const netOf = (l: WallLayout) =>
    l.net ? netScene(l.net, l.floor, l.horizon, l.shore, l.width, SUN) : null;
  let net = netOf(layout);

  const world = createWorld(
    rng.fork("balls"),
    count,
    layout.radius,
    boundsOf(layout),
    layout.rest,
    {
      props: kinds.map((kind, i) => ({ kind, x: layout.props[i]! })),
      net: layout.net,
      umbrella: layout.umbrella,
    },
  );
  const bucket = world.props.find((p) => p.kind === "bucket") ?? null;
  const spade = world.props.find((p) => p.kind === "spade") ?? null;
  const sand = createSand(rng.fork("sand"), layout.floor);
  const crabs = hasCrab
    ? createCrab(rng.fork("crab"), layout.crab ?? layout.width / 2, layout.floor)
    : null;
  /** Fingers the crab is snapping at, which move and lift for it alone. */
  const crabFingers = new Set<number>();
  /** Free fingers that have already swept across the crab. */
  const swept = new Set<number>();
  const sea = createSea(rng.fork("sea"), { shore: layout.shore, floor: layout.floor, big: extras });
  const fx = createFx(rng.fork("fx"));
  const handRng = rng.fork("hand");
  const wet = world.balls.map(() => 0);
  const soaked = world.balls.map(() => false);
  const prevX = world.balls.map((b) => b.x);
  const prevY = world.balls.map((b) => b.y);
  const prevP = world.props.map((p) => ({ x: p.x, y: p.y, a: p.a, yaw: p.yaw }));
  const prevCrab = { x: crabs?.crab.x ?? 0, y: crabs?.crab.y ?? 0 };

  const r3d = createRenderer3D(ctx.root, frame, { antialias: false });
  const software = isSoftware(r3d.renderer.getContext());
  const fit = (f: FrameInfo) => {
    r3d.resize(f);
    if (!software) return;
    r3d.renderer.setPixelRatio(f.pixelRatio * SOFTWARE_SCALE);
    r3d.renderer.setSize(f.width, f.height, false);
  };
  fit(frame);
  const scene = new Scene();
  // Stage px with y up; only the toys use it, the other passes place themselves.
  const camera = new OrthographicCamera(0, frame.width, frame.height, 0, -1e4, 1e4);
  const noise = createNoiseTexture(rng.fork("noise"));
  const sky = createSkyUniforms();
  const look = blankLook();
  const beach = createBeach(noise, SUN, sky);
  scene.add(beach.mesh);
  const lights = createBeachLights();
  scene.add(lights.root);
  const shadows = createBatch(2 * (count + kinds.length) + UMBRELLA_SHADOWS + 2 + MAX_MOUNDS, {
    opaque: true,
  });
  shadows.mesh.renderOrder = 1;
  scene.add(shadows.mesh);
  const toys = kinds.length > 0 ? createPropViews(kinds) : null;
  if (toys) scene.add(toys.root);
  const mounds = bucket ? createMoundViews(MAX_MOUNDS) : null;
  if (mounds) scene.add(mounds.root);
  const shade = layout.umbrella ? createUmbrellaView(layout.umbrella, layout.floor) : null;
  if (shade) scene.add(shade.root);
  const crabView = crabs ? createCrabView() : null;
  if (crabView) scene.add(crabView.root);
  const sun = new Vector3(SUN[0], SUN[1], SUN[2]);
  const gores = palette.gores.map((c) => new Color(c));
  const cap = new Color(palette.cap);
  const valve = new Color(palette.valve);
  // No drops on the wall: a radius of 0 turns each one off.
  const noDrops = Array.from({ length: 3 }, () => new Vector4(0, 0, 0, 0));
  const along = Array.from({ length: 3 }, () => new Vector4(1, 0, 0, 1));
  const stuck = sandCentre();
  const views: WallBall[] = world.balls.map(() => {
    const v = createWallBall({
      fragment: WALL_BALL_GLSL,
      uniforms: {
        uSpin: { value: new Matrix3() },
        uGore: { value: gores },
        uCapColour: { value: cap },
        uValveColour: { value: valve },
        uDrop: { value: noDrops },
        uDropAlong: { value: along },
        uSand: { value: extras ? new Vector3(stuck[0], stuck[1], stuck[2]) : new Vector3() },
        uSun: { value: sun },
        uWet: { value: 0 },
        uLift: { value: 0 },
        uLightSun: sky.uLightSun,
        uLightSky: sky.uLightSky,
        uLightSand: sky.uLightSand,
        uLightBehind: sky.uLightBehind,
        uGlint: sky.uGlint,
        uEnvTop: sky.uEnvTop,
        uEnvHorizon: sky.uEnvHorizon,
        uEnvGround: sky.uEnvGround,
        uEnvFar: sky.uEnvFar,
      },
    });
    v.mesh.renderOrder = 3;
    scene.add(v.mesh);
    return v;
  });
  const effects = createBatch(MAX_PARTICLES);
  effects.mesh.renderOrder = 4;
  scene.add(effects.mesh);
  r3d.keep(noise);
  r3d.prepare(scene, camera);

  let time = 0;
  let attract = true;
  let lastPerson = -Infinity;
  let handWait = handRng.range(2, 4);
  let handTosses = 0;
  let volleys = 0;
  let resets = 0;
  let swell = 0;
  let cloudX = rng.range(0, 1);
  let cloudY = rng.range(0, 1);
  /** Seconds into the cycle of the time of day. */
  let skyTime = 0;
  /** Where shadows fall from, and how dark they are, for the time of day. */
  let shadeSun: readonly [number, number, number] = SUN;
  let dim = 1;
  /** The unseen hand's press on the crab, seconds left, and its pokes. */
  let handPress = 0;
  let handPokes = 0;
  let coveredFor = 0;
  let uncovered = 0;
  /** How long the umbrella has been out of the sand, and times the unseen hand stood it up. */
  let looseFor = 0;
  let replants = 0;

  /** The bucket's sand thrown about: lumps always, dust only with the extras. */
  const sandFx: SandFx = {
    lumps: (x, y, vx, vy, lumps, grains, spread, land) =>
      fx.lumps(x, y, vx, vy, lumps, extras ? grains : 0, spread, land),
    puff: (x, y, speed) => {
      if (extras) fx.puff(x, y, speed);
    },
  };

  const toWall = (p: Pointer) => {
    const k = scale(frame);
    return { x: p.x / k, y: (frame.height - p.y) / k };
  };
  /**
   * A finger's speed in m/s from the input's timed estimate, fading once the finger stops
   * sending moves, so a finger that came to rest has none.
   */
  const speedOf = (p: Pointer) => {
    const k = scale(frame);
    const fade = Math.exp(-Math.max(0, performance.now() - p.time - 30) / FINGER_QUIET_MS);
    return { vx: (p.vx / k) * fade, vy: (-p.vy / k) * fade };
  };
  const follow = (p: Pointer) => {
    const at = toWall(p);
    if (crabFingers.has(p.id)) {
      crabs?.move(p.id, at.x, at.y);
      return;
    }
    const v = speedOf(p);
    world.move(p.id, at.x, at.y, v.vx, v.vy);
    // A free finger sweeping across the crab annoys it as much as a poke.
    const f = world.fingers.get(p.id);
    if (crabs && f && !f.ball && !f.prop && !swept.has(p.id) && crabs.distance(at.x, at.y) < 0) {
      swept.add(p.id);
      crabs.poke(p.id, at.x, at.y);
      crabs.release(p.id);
    }
  };

  const shed = (i: number, speed: number) => {
    const b = world.balls[i];
    if (!extras || !b || wet[i]! < 0.12 || speed < 1.2) return;
    const n = Math.round(wet[i]! * Math.min(6, speed * 1.2));
    if (n <= 0) return;
    fx.shed(b.x, b.y, b.r, b.vx, b.vy, n);
    wet[i] = Math.max(0, wet[i]! - 0.05 * n);
  };

  const onDown = (p: Pointer) => {
    const at = toWall(p);
    if (!p.synthetic) {
      lastPerson = time;
      attract = false;
    }
    // A finger on the crab is the crab's: it snaps at it, and nothing else feels it.
    if (crabs) {
      const d = crabs.distance(at.x, at.y);
      if (d < GRAB && d < world.nearestThing(at.x, at.y)) {
        crabFingers.add(p.id);
        crabs.poke(p.id, at.x, at.y);
        fx.ripple(at.x, at.y, 1);
        return;
      }
    }
    // A finger on the handle of the spade standing in the bucket pulls it out to hold.
    const handle = sand.handleDistance(spade, at.x, at.y);
    if (handle < GRAB && handle < world.nearestThing(at.x, at.y)) sand.pullSpade(world, spade);
    const did = world.down(p.id, at.x, at.y, p.synthetic);
    if (did === "none" && sand.touch(at.x, at.y, sandFx)) {
      fx.ripple(at.x, at.y, 1);
      return;
    }
    fx.ripple(at.x, at.y, did === "none" ? 0.4 : 1);
    if (did === "none" && extras && at.y < layout.shore - 0.04) {
      // A poke into the sand throws a little of it up; into the wash, a little water.
      if (at.y > sea.edgeAt(at.x)) fx.splash(at.x, at.y, 1.5);
      else fx.puff(at.x, at.y, 1.6);
    }
  };
  const onUp = (p: Pointer) => {
    follow(p);
    swept.delete(p.id);
    if (crabFingers.delete(p.id)) {
      crabs?.release(p.id);
      return;
    }
    world.up(p.id);
  };
  const onCancel = (p: Pointer) => {
    swept.delete(p.id);
    if (crabFingers.delete(p.id)) {
      crabs?.release(p.id);
      return;
    }
    world.cancel(p.id);
  };
  const unlisten = [
    ctx.input.on("down", onDown),
    ctx.input.on("move", follow),
    ctx.input.on("up", onUp),
    ctx.input.on("cancel", onCancel),
  ];

  const botView = {
    balls: (): BotBall[] => {
      const k = scale(frame);
      return world.balls.map((b) => ({
        x: b.x * k,
        y: frame.height - b.y * k,
        r: b.r * k,
        vx: b.vx * k,
        vy: -b.vy * k,
        held: b.holder !== null,
      }));
    },
    props: (): BotBall[] => {
      const k = scale(frame);
      return world.props
        .filter((p) => !p.off && p.kind !== "brolly")
        .map((p) => ({
          x: p.x * k,
          y: frame.height - p.y * k,
          r: Math.min(p.spec.reach, 0.25) * k,
          vx: p.vx * k,
          vy: -p.vy * k,
          held: p.holder !== null,
        }));
    },
    netX: () => (world.net ? world.net.x * scale(frame) : null),
    crab: () => {
      if (!crabs) return null;
      const k = scale(frame);
      const c = crabs.crab;
      return {
        x: c.x * k,
        y: frame.height - (c.y + 0.03) * k,
        r: CRAB.hit * k,
        busy: c.mode !== "walk" && c.mode !== "pause",
      };
    },
    width: () => frame.width,
    height: () => frame.height,
    reachTop: () => frame.reachTop.adult,
  };
  const bots = ctx.bots > 0 ? createWallBots(ctx.input, rng.fork("bots"), botView, ctx.bots) : null;

  /** The middle of the stretch of sand `x` is on: its side of the net, or the whole wall. */
  const middleOf = (x: number) => {
    const n = world.net;
    if (!n) return { mid: layout.width / 2, half: layout.width / 2 };
    return x < n.x
      ? { mid: n.x / 2, half: n.x / 2 }
      : { mid: (n.x + layout.width) / 2, half: (layout.width - n.x) / 2 };
  };

  /** A toss that clears the net and comes down near the middle of the far side, if any. */
  const volleyOf = (x: number, y: number, r: number) => {
    const n = world.net;
    if (!n) return null;
    const dir = x < n.x ? 1 : -1;
    const target = dir > 0 ? (n.x + layout.width) / 2 : n.x / 2;
    const vy = handRng.range(6.5, 8.5);
    let best: { vx: number; vy: number } | null = null;
    let miss = Infinity;
    for (let vx = 0.75; vx <= 8; vx += 0.25) {
      const f = netFlight(n, layout.floor, x, y, dir * vx, vy, r);
      if (f.clear < 0.25) continue;
      const off = Math.abs(f.land - target);
      if (off < miss) {
        miss = off;
        best = { vx: dir * vx, vy };
      }
    }
    return best;
  };

  /** The unseen hand flicks a toy up off the sand, so it flips and lands again. */
  const handTossProp = (pick?: Prop) => {
    const free = world.props.filter((p) => p.holder === null && !p.off && p.kind !== "brolly");
    if (free.length === 0) return false;
    const p = pick ?? free.find((q) => q.grounded && handRng.next() < 0.6) ?? handRng.pick(free);
    if (!p || p.holder !== null) return false;
    const { mid, half } = middleOf(p.x);
    const toward = clamp((mid - p.x) / half, -1, 1);
    const vx = handRng.range(-1.5, 1.5) + toward * 1.5;
    const vy = handRng.range(4.5, 6.5);
    const yaw = handRng.range(-1, 1) * (p.kind === "hat" ? 12 : 6);
    world.kickProp(p.index, vx, vy, handRng.range(-8, 8), yaw);
    fx.ripple(p.x, p.y - p.spec.reach * 0.6, 0.5);
    handTosses++;
    return true;
  };

  /** The unseen hand pokes the crab, as someone just out of sight might. */
  const handPoke = () => {
    const c = crabs?.crab;
    if (!crabs || !c || handPress > 0 || (c.mode !== "walk" && c.mode !== "pause")) return false;
    const x = c.x + handRng.range(-0.06, 0.06);
    const y = c.y + handRng.range(0, 0.08);
    crabs.poke(HAND_FINGER, x, y);
    fx.ripple(x, y, 0.8);
    handPress = handRng.range(HAND_PRESS[0], HAND_PRESS[1]);
    handPokes++;
    return true;
  };

  /** The unseen hand: a toss from below, as if someone just out of sight batted it. */
  const handToss = (pick?: number | string) => {
    if (pick === "crab") {
      handPoke();
      return;
    }
    if (pick === undefined && handRng.next() < HAND_CRAB && handPoke()) return;
    if (typeof pick === "string") {
      const p = world.props.find((q) => q.kind === pick);
      if (p) handTossProp(p);
      return;
    }
    if (pick === undefined && world.props.length > 0 && handRng.next() < HAND_TOY) {
      if (handTossProp()) return;
    }
    const free = world.balls.filter((b) => b.holder === null);
    if (free.length === 0) return;
    const ball =
      pick !== undefined
        ? world.balls[pick]
        : (free.find((b) => b.grounded && handRng.next() < 0.7) ?? handRng.pick(free));
    if (!ball || ball.holder !== null) return;
    const over = handRng.next() < HAND_VOLLEY ? volleyOf(ball.x, ball.y, ball.r) : null;
    const { mid, half } = middleOf(ball.x);
    const toward = clamp((mid - ball.x) / half, -1, 1);
    const vx = over ? over.vx : handRng.range(-2.5, 2.5) + toward * 2;
    const vy = over ? over.vy : handRng.range(5.5, 9);
    const spin = 3 + handRng.range(0, 5);
    world.kick(ball.index, vx, vy, [
      handRng.range(-1, 1) * spin,
      handRng.range(-0.5, 0.5) * spin,
      -vx / ball.r,
    ]);
    fx.ripple(ball.x + handRng.range(-0.3, 0.3) * ball.r, ball.y - ball.r * 0.8, 0.6);
    handTosses++;
    if (over) volleys++;
  };

  const touches = world.balls.map(() => ({ taps: 0, throws: 0, bats: 0 }));
  const propTouches = world.props.map(() => ({ taps: 0, throws: 0, bats: 0 }));
  const handle = (e: WorldEvent) => {
    const t = e.ball >= 0 ? touches[e.ball] : propTouches[e.prop];
    if (t && e.kind === "tap") t.taps++;
    if (t && e.kind === "throw") t.throws++;
    if (t && e.kind === "bat") t.bats++;
    if (e.prop >= 0) {
      if (e.kind === "land" && extras) {
        if (sea.edgeAt(e.x) < layout.floor + 0.02) fx.splash(e.x, e.y, e.speed * 0.7);
        else fx.puff(e.x, e.y, e.speed * 0.7);
      }
      return;
    }
    if (e.kind === "land") {
      if (!extras || e.speed < 2) return;
      const b = world.balls[e.ball];
      if (!b) return;
      if (sea.edgeAt(e.x) < layout.floor + 0.02) fx.splash(e.x, e.y, e.speed);
      else if (sea.wetTo < layout.floor + 0.02) fx.puff(e.x, e.y, e.speed * 0.4);
      else fx.puff(e.x, e.y, e.speed);
      shed(e.ball, e.speed * 0.6);
      return;
    }
    if (e.kind === "hit" || e.kind === "bat" || e.kind === "tap" || e.kind === "throw") {
      shed(e.ball, e.speed);
    }
  };

  const update = (dt: number) => {
    time += dt;
    world.balls.forEach((b, i) => {
      prevX[i] = b.x;
      prevY[i] = b.y;
    });
    world.props.forEach((p, i) => {
      const q = prevP[i]!;
      q.x = p.x;
      q.y = p.y;
      q.a = p.a;
      q.yaw = p.yaw;
    });
    if (crabs) {
      prevCrab.x = crabs.crab.x;
      prevCrab.y = crabs.crab.y + crabs.crab.hop;
    }
    for (const p of ctx.input.pointers.values()) follow(p);
    world.step(dt);
    sea.step(dt);
    for (const e of world.drain()) handle(e);
    sand.step(dt, world, bucket, spade, sandFx);
    // The umbrella left lying out of the sand a while is stood up again by the unseen hand.
    const umb = world.umbrella;
    const lying = umb?.state === "loose" && umb.prop.holder === null && umb.prop.asleep;
    looseFor = lying ? looseFor + dt : 0;
    if (looseFor > (time - lastPerson > YIELD_S ? REPLANT.quiet : REPLANT.busy)) {
      looseFor = 0;
      world.plantUmbrella();
      replants++;
    }
    // An upturned bucket sitting on its castle is lifted off it, so the castle shows.
    const covered = bucket && sand.covered && bucket.holder === null && bucket.asleep;
    coveredFor = covered ? coveredFor + dt : 0;
    if (bucket && coveredFor > (time - lastPerson > YIELD_S ? UNCOVER.quiet : UNCOVER.busy)) {
      coveredFor = 0;
      const way = bucket.x < layout.width / 2 ? 1 : -1;
      const vx = way * handRng.range(1.7, 2.2);
      world.kickProp(bucket.index, vx, handRng.range(3.6, 4.2), -way * handRng.range(3, 4.5));
      fx.ripple(bucket.x, bucket.y, 0.6);
      uncovered++;
    }
    if (crabs) {
      if (handPress > 0) {
        handPress -= dt;
        if (handPress <= 0) crabs.release(HAND_FINGER);
      }
      crabs.step(dt, world, (x) => sand.heightAt(x));
      for (const e of crabs.drain()) {
        if (e.kind === "bubble") fx.bubble(e.x, e.y);
        if (e.kind !== "push") continue;
        // The crab's push sends the ball or toy off; a ball spins away from the claws.
        if (e.ball >= 0)
          world.kick(e.ball, e.vx, e.vy, [0, 0, -e.vx / (world.balls[e.ball]?.r ?? 1)]);
        if (e.prop >= 0) world.kickProp(e.prop, e.vx, e.vy, handRng.range(-3, 3));
        fx.ripple(e.x, e.y, 0.5);
        sandFx.puff(e.x, layout.floor, 0.9);
      }
    }
    world.balls.forEach((b, i) => {
      if (extras) {
        // The wash covers the sand from its front up the beach; a ball is in it when the front
        // has come past the balls' line and the ball is down on the sand.
        const inWash =
          sea.edgeAt(b.x) < layout.floor + 0.02 && b.y - b.r < layout.floor + WASH_DEPTH;
        if (inWash && !soaked[i]) {
          wet[i] = 1;
          // The wash lifts a ball on the sand a little and floats it along.
          if (b.holder === null && b.y - b.r < layout.floor + 0.1) {
            b.vy = Math.max(b.vy, rng.range(0.9, 1.4));
            b.vx += rng.range(-0.5, 0.5);
            b.grounded = false;
          }
        }
        soaked[i] = inWash;
      }
      wet[i] = Math.max(0, wet[i]! - dt / DRY_S);
    });
    fx.step(dt);
    const quiet = time - lastPerson > YIELD_S;
    bots?.update(dt, quiet);
    if (quiet && !bots && attract) {
      handWait -= dt;
      if (handWait <= 0) {
        handToss();
        handWait = handRng.range(HAND_GAP[0], HAND_GAP[1]);
      }
    }
    swell = (swell + (TAU / SWELL_PERIOD) * dt) % (TAU * SWELL_WRAP);
    skyTime = (skyTime + dt) % CYCLE_S;
    cloudX = (cloudX + CLOUD_DRIFT[0] * dt) % 1;
    cloudY = (cloudY + CLOUD_DRIFT[1] * dt) % 1;
  };

  const breaking = () => {
    // The surf breaks hardest as a wave starts to run up the sand.
    const run = layout.shore - sea.edge;
    return clamp(run / 0.3, 0, 1);
  };

  const render = (alpha: number) => {
    if (!r3d.ready) return;
    const k = scale(frame);
    lookAt(skyMode, skyTime, look);
    applyLook(sky, look);
    sky.uSkyTime.value.set(skyTime % 600, 0);
    setPaintEnv(look);
    lights.set(look);
    sun.set(look.sun[0], look.sun[1], look.sun[2]);
    shadeSun = shadowSun(look.sun);
    (beach.material.uniforms.uSun!.value as Vector3).set(shadeSun[0], shadeSun[1], shadeSun[2]);
    dim = look.shadow;
    const W = frame.width;
    const H = frame.height;
    beach.set({
      width: W / k,
      height: H / k,
      floor: layout.floor,
      shore: layout.shore,
      horizon: layout.horizon,
      edge: sea.edge,
      wetTo: sea.wetTo,
      washTime: sea.wrapped,
      breaking: breaking(),
      swell,
      cloudX,
      cloudY,
      net,
      pixel: W / k / Math.max(1, r3d.canvas.width),
    });

    shadows.begin(W, H);
    const umb = world.umbrella;
    if (umb && shade) {
      shade.setFold(umb.state === "loose" ? 1 : umb.fold);
      if (umb.state === "loose") {
        // Out of the sand it is a toy: its foot from its pose, its shadow drawn as a toy's.
        const p = umb.prop;
        const q = prevP[p.index]!;
        const x = q.x + (p.x - q.x) * alpha;
        const y = q.y + (p.y - q.y) * alpha;
        const a = q.a + turnBetween(q.a, p.a) * alpha;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const fx = x + c * p.spec.origin.x - s * p.spec.origin.y;
        const fy = y + s * p.spec.origin.x + c * p.spec.origin.y;
        shade.place(fx * k, fy * k, a, p.yaw, k, false);
      } else {
        const u = umb.at;
        const lean = umb.wobble.tilt + umb.stand;
        shade.place(u.x * k, layout.floor * k, lean, umb.wobble.yaw, k, true);
        // The canopy's shadow lies under it on the sand, and the pole's runs back to it.
        const open = 1 - umb.fold;
        const hc = (u.rim + u.top) / 2 - layout.floor;
        const cx = u.x - Math.sin(lean) * hc;
        const r = u.radius * (0.12 + 0.88 * open);
        const sh = ballShadow(cx, layout.floor + hc, r, layout.floor, layout.horizon, shadeSun);
        const dark = 0.12 + 0.22 * open;
        shadows.add(sh.x * k, H - sh.y * k, sh.hx * k, sh.hy * k, SHADOW, dark * dim, "soft", 0.6);
        shadows.add(
          sh.x * k,
          H - sh.y * k,
          sh.hx * 0.7 * k,
          sh.hy * 0.7 * k,
          SHADOW,
          dark * 0.4 * dim,
          "soft",
          0.8,
        );
        for (let j = 0; j < POLE_SHADOWS; j++) {
          const t = (j + 0.5) / POLE_SHADOWS;
          const h = t * (u.top - layout.floor) * Math.cos(umb.stand);
          const p = ballShadow(
            u.x - Math.sin(lean) * h,
            layout.floor + h,
            0,
            layout.floor,
            layout.horizon,
            shadeSun,
          );
          shadows.add(p.x * k, H - p.y * k, 0.07 * k, 0.016 * k, SHADOW, 0.16 * dim, "soft", 0.5);
        }
      }
    }
    if (crabs && crabView) {
      const c = crabs.crab;
      const x = prevCrab.x + (c.x - prevCrab.x) * alpha;
      const y = prevCrab.y + (c.y + c.hop - prevCrab.y) * alpha;
      crabView.update(c, k);
      crabView.root.position.set(x * k, y * k, 0);
      const h = Math.max(0, y - layout.floor - CRAB.stand);
      shadows.add(
        x * k,
        H - (layout.floor + 0.01) * k,
        CRAB.span * 0.85 * k,
        0.045 * k,
        SHADOW,
        0.42 * Math.exp(-h / 0.25) * dim,
        "soft",
        0.75,
      );
    }
    if (mounds) {
      mounds.update(sand.mounds, layout.floor, k);
      for (const m of sand.mounds) {
        if (!m.active || m.hidden) continue;
        const r = (m.shape * CASTLE.radius + (1 - m.shape) * HEAP.radius) * m.size;
        shadows.add(
          m.x * k,
          H - (layout.floor + 0.008) * k,
          r * 1.15 * k,
          r * 0.22 * k,
          SHADOW,
          0.35 * m.opacity * Math.min(1, m.level * 2) * dim,
          "soft",
          0.7,
        );
      }
    }
    if (toys && bucket) {
      toys.setOrigin(bucket.index, bucket.spec.origin);
      toys.setFill(bucket.index, sand.fill);
    }
    if (toys && spade) toys.setLoad(spade.index, sand.load);
    world.balls.forEach((b, i) => {
      const x = prevX[i]! + (b.x - prevX[i]!) * alpha;
      const y = prevY[i]! + (b.y - prevY[i]!) * alpha;
      const sh = ballShadow(x, y, b.r, layout.floor, layout.horizon, shadeSun);
      shadows.add(
        sh.x * k,
        H - sh.y * k,
        sh.hx * k,
        sh.hy * k,
        SHADOW,
        sh.alpha * dim,
        "soft",
        sh.soft,
      );
      // Where it sits on the sand, a darker patch the ball's own bulk keeps from the sky.
      const h = Math.max(0, y - b.r - layout.floor);
      if (h < 0.5) {
        const spread = 1 + h;
        shadows.add(
          x * k,
          H - (layout.floor + 0.01) * k,
          b.r * 0.6 * spread * k,
          b.r * 0.18 * spread * k,
          SHADOW,
          0.45 * Math.exp(-h / 0.15) * dim,
          "soft",
          0.8,
        );
      }
    });
    world.props.forEach((p, i) => {
      const q = prevP[i]!;
      const x = q.x + (p.x - q.x) * alpha;
      const y = q.y + (p.y - q.y) * alpha;
      const a = q.a + turnBetween(q.a, p.a) * alpha;
      const yaw = q.yaw + turnBetween(q.yaw, p.yaw) * alpha;
      toys?.place(i, x * k, y * k, a, yaw, k);
      // Standing in the bucket, the spade's shadow is the bucket's.
      if (p.off) return;
      // A shadow under the toy as under a ball as wide, sharpening as it comes down.
      const e = extentAt(p.spec, a);
      const half = (e.right - e.left) / 2;
      const cx = x + (e.right + e.left) / 2;
      const low = y + e.bottom;
      const sh = ballShadow(cx, low + half, half, layout.floor, layout.horizon, shadeSun);
      const flat = 0.55 + 0.45 * Math.min(1, (e.top - e.bottom) / (2 * half));
      shadows.add(
        sh.x * k,
        H - sh.y * k,
        sh.hx * k,
        sh.hy * k * flat,
        SHADOW,
        sh.alpha * 0.9 * dim,
        "soft",
        sh.soft,
      );
      const h = Math.max(0, low - layout.floor);
      if (h < 0.3) {
        shadows.add(
          cx * k,
          H - (layout.floor + 0.008) * k,
          half * 0.85 * (1 + h) * k,
          Math.min(half, 0.12) * 0.35 * (1 + h) * k,
          SHADOW,
          0.5 * Math.exp(-h / 0.08) * dim,
          "soft",
          0.75,
        );
      }
    });
    shadows.end();

    world.balls.forEach((b, i) => {
      const x = prevX[i]! + (b.x - prevX[i]!) * alpha;
      const y = prevY[i]! + (b.y - prevY[i]!) * alpha;
      const w = b.w;
      const s = Math.hypot(w[0], w[1], w[2]);
      const m: Mat3 = s > 1e-6 ? multiply3(rotationAbout(w, (s * alpha) / HZ), b.rot) : b.rot;
      const view = views[i]!;
      const u = view.material.uniforms;
      toMatrix3(transpose3(m), u.uSpin!.value as Matrix3);
      u.uWet!.value = extras ? wet[i]! : 0;
      u.uLift!.value = Math.max(0, y - b.r - layout.floor) / b.r;
      const toEye = [EYE_LEAN * (layout.width / 2 - x), EYE_HEIGHT - y, EYE_BACK] as const;
      view.place(x * k, H - y * k, b.r * k, toEye, W, H);
    });

    effects.begin(W, H);
    for (const p of fx.list) {
      const a = fadeOf(p);
      if (a <= 0.003) continue;
      const r = Math.max(p.size * k, 1);
      effects.add(p.x * k, H - p.y * k, r, r, p.colour, a, p.shape, p.soft);
    }
    effects.end();
    r3d.renderer.render(scene, camera);
  };

  const loop = ctx.loop({ hz: HZ, update, render });
  loop.start();

  ctx.onResize((f) => {
    frame = f;
    fit(f);
    layout = layoutOf(f);
    net = netOf(layout);
    camera.right = f.width;
    camera.top = f.height;
    camera.updateProjectionMatrix();
    world.setBounds(boundsOf(layout));
    world.setNet(layout.net);
    world.setUmbrella(layout.umbrella);
    sand.setFloor(layout.floor);
    sea.setOptions({ shore: layout.shore, floor: layout.floor, big: extras });
  });

  const rest = () => {
    world.releaseAll();
    sand.reset(world, bucket, spade);
    if (crabs) {
      for (const id of crabFingers) crabs.release(id);
      crabFingers.clear();
      crabs.place(layout.crab ?? layout.width / 2, layout.floor);
      prevCrab.x = crabs.crab.x;
      prevCrab.y = crabs.crab.y;
    }
    handPress = 0;
    looseFor = 0;
    world.resetUmbrella();
    coveredFor = 0;
    world.balls.forEach((b, i) => {
      world.place(i, layout.rest[i] ?? b.x);
      prevX[i] = b.x;
      prevY[i] = b.y;
      wet[i] = 0;
      soaked[i] = false;
    });
    world.props.forEach((p, i) => {
      world.placeProp(i, layout.props[i] ?? p.x);
      const q = prevP[i]!;
      q.x = p.x;
      q.y = p.y;
      q.a = p.a;
      q.yaw = p.yaw;
    });
    fx.clear();
  };

  const venue = (x: number, y: number) => ({
    x: x * pxPerM(),
    y: frame.height / frame.unit - y * pxPerM(),
  });

  const debugKey = "__beachball";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => ({
          kind: "wall",
          ready: r3d.ready,
          software,
          time,
          attract,
          handTosses,
          resets,
          floor: venue(0, layout.floor).y,
          childTop: venue(0, layout.childTop).y,
          adultTop: venue(0, layout.adultTop).y,
          rest: layout.rest.map((x) => x * pxPerM()),
          balls: world.balls.map((b, i) => ({
            ...venue(b.x, b.y),
            r: b.r * pxPerM(),
            vx: b.vx * pxPerM(),
            vy: -b.vy * pxPerM(),
            spin: Math.hypot(b.w[0], b.w[1], b.w[2]),
            held: b.holder !== null,
            grounded: b.grounded,
            wet: wet[i],
            ...touches[i],
          })),
          props: world.props
            .filter((p) => p.kind !== "brolly")
            .map((p, i) => {
              const e = extentAt(p.spec, p.a);
              return {
                kind: p.kind,
                ...venue(p.x, p.y),
                angle: p.a,
                top: venue(0, p.y + e.top).y,
                bottom: venue(0, p.y + e.bottom).y,
                left: (p.x + e.left) * pxPerM(),
                right: (p.x + e.right) * pxPerM(),
                vx: p.vx * pxPerM(),
                vy: -p.vy * pxPerM(),
                spin: p.w,
                held: p.holder !== null,
                grounded: p.grounded,
                asleep: p.asleep,
                off: p.off,
                ...propTouches[i],
              };
            }),
          propRest: layout.props.map((x) => x * pxPerM()),
          net: world.net
            ? {
                x: world.net.x * pxPerM(),
                top: venue(0, world.net.top).y,
                bottom: venue(0, world.net.bottom).y,
                radius: world.net.radius * pxPerM(),
              }
            : null,
          volleys,
          moves: bots ? { ...bots.moves } : { tap: 0, throw: 0, bat: 0 },
          botVolleys: bots?.volleys ?? 0,
          botToys: bots?.toys ?? 0,
          botCrab: bots?.crab ?? 0,
          umbrella: world.umbrella
            ? {
                state: world.umbrella.state,
                fold: world.umbrella.fold,
                closes: world.umbrella.closes,
                pulls: world.umbrella.pulls,
                plants: world.umbrella.plants,
                replants,
                home: world.umbrella.layout.x * pxPerM(),
                x: world.umbrella.at.x * pxPerM(),
                loose: {
                  ...venue(world.umbrella.prop.x, world.umbrella.prop.y),
                  angle: world.umbrella.prop.a,
                  grounded: world.umbrella.prop.grounded,
                  asleep: world.umbrella.prop.asleep,
                },
                rim: venue(0, world.umbrella.layout.rim).y,
                top: venue(0, world.umbrella.layout.top).y,
                radius: world.umbrella.layout.radius * pxPerM(),
                tilt: world.umbrella.wobble.tilt,
                yaw: world.umbrella.wobble.yaw,
                hits: world.umbrella.hits,
                nudges: world.umbrella.nudges,
              }
            : null,
          bucket: bucket
            ? {
                fill: sand.fill,
                mass: bucket.spec.mass,
                shovelling: sand.shovelling,
                spadeIn: sand.stowed,
                spadeLoad: sand.load,
                ...sand.stats,
              }
            : null,
          mounds: sand.mounds
            .filter((m) => m.active)
            .map((m) => ({
              castle: m.castle,
              x: m.x * pxPerM(),
              shape: m.shape,
              level: m.level,
              hidden: m.hidden,
              phase: m.phase,
            })),
          crab: crabs
            ? {
                ...venue(crabs.crab.x, crabs.crab.y),
                mode: crabs.crab.mode,
                claws: crabs.crab.claws,
                pokes: crabs.crab.pokes,
                angers: crabs.crab.angers,
                pushes: crabs.crab.pushes,
                shoves: crabs.crab.shoves,
              }
            : null,
          handPokes,
          uncovered,
          sky: { mode: skyMode, time: skyTime, ...cycleAt(skyTime) },
          particles: fx.list.length,
          spawned: fx.spawned,
          sea: { edge: venue(0, sea.edge).y, wetTo: venue(0, sea.wetTo).y, bigCount: sea.bigCount },
        }),
        toss: (i?: number | string) => handToss(i),
        wave: () => sea.surge(),
        spill: () => sand.spill(world, bucket, sandFx),
        /** Roll ball `i` along the sand from venue x at `vx` venue px a second. */
        roll: (i: number, x: number, vx: number) => {
          world.place(i, x / pxPerM());
          world.kick(i, vx / pxPerM(), 0.01, [0, 0, -vx / pxPerM() / (world.balls[i]?.r ?? 1)]);
        },
        /** Put the crab standing at venue x. */
        crab: (x: number) => {
          if (!crabs) return;
          crabs.place(x / pxPerM(), layout.floor);
          prevCrab.x = crabs.crab.x;
        },
        /** Jump the time of day to `t` s into its cycle. */
        sky: (t: number) => {
          skyTime = ((t % CYCLE_S) + CYCLE_S) % CYCLE_S;
        },
        /** Drop a toy from `height` m over the sand at venue x, turned `angle`. */
        drop: (kind: string, x: number, height: number, angle: number, spin = 0) => {
          const p = world.props.find((q) => q.kind === kind);
          if (!p) return;
          world.placeProp(p.index, x / pxPerM());
          p.y += height;
          p.a = angle;
          world.kickProp(p.index, 0, 0, spin);
        },
        skip: (seconds: number) => {
          const n = Math.round(clamp(seconds, 0, MAX_SKIP) * HZ);
          for (let i = 0; i < n; i++) update(1 / HZ);
        },
      },
    });
  }

  return {
    reset() {
      resets++;
      rest();
      bots?.release();
      attract = true;
      handWait = handRng.range(2, 4);
    },
    attract() {
      attract = true;
    },
    command(name) {
      if (name === "toss") handToss();
      if (name === "wave") sea.surge();
    },
    status: () => ({
      colours,
      balls: count,
      held: world.balls.filter((b) => b.holder !== null).length,
      flying: world.balls.filter((b) => !b.grounded && b.holder === null).length,
      wet: wet.filter((w) => w > 0.1).length,
      toys: kinds.length,
      toysHeld: world.props.filter((p) => p.holder !== null && p.kind !== "brolly").length,
      toysFlying: world.props.filter(
        (p) => !p.grounded && !p.off && p.holder === null && p.kind !== "brolly",
      ).length,
      net: world.net !== null,
      umbrella: world.umbrella !== null,
      crab: crabs?.crab.mode ?? "none",
      bucketFill: bucket ? Math.round(sand.fill * 100) / 100 : 0,
      spadeInBucket: sand.stowed,
      sky: skyMode === "cycle" ? cycleAt(skyTime).from : skyMode,
      umbrellaState: world.umbrella?.state ?? "none",
      castles: sand.mounds.filter((m) => m.active && m.castle && m.phase === "stand").length,
      attract,
      waves: sea.bigCount,
      volleys,
    }),
    dispose() {
      loop.stop();
      for (const off of unlisten) off();
      bots?.dispose();
      if (ctx.debug) delete (window as unknown as Record<string, unknown>)[debugKey];
      r3d.dispose();
    },
  };
};

function boundsOf(l: WallLayout) {
  return { width: l.width, height: l.height, floor: l.floor };
}
