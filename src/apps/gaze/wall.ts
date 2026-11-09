/**
 * The eye on a wall: one big eye set into the middle of the wall, drawn as a ball seen from in
 * front (`wallview.ts`) with the sphere's surface shader, looking round an imagined crowd in front
 * of the wall and at whoever touches it. A touch puts someone at the touch, and the eye turns to
 * meet their gaze with its usual saccades and fixations, follows a moving finger for a moment,
 * darts between several people touching (the latest most) and glances at their hands. A touch on
 * the eye itself makes it flinch: it blinks if it has lids, darts away and comes back. Stroking
 * the wall makes it content (`wallpet.ts`): it rolls slowly up under heavy lids until the
 * stroking stops.
 */
import { createRenderer3D } from "../../core/renderer3d";
import { DEG, type Vec3 } from "../../core/sphere";
import type { AppContext, AppInstance, Pointer, SphereInfo } from "../../core/types";
import { displaySurface } from "../../core/view3d";
import { bearing, degrees, elevation, fromAngles, LOOKING_OUT, nudge, slerp } from "./geom";
import { irisTexSize } from "./irisgen";
import { createLids, LIDS, marginPlane } from "./lids";
import { createEyeLook, irisOption, paceOption } from "./look";
import { createMotion } from "./motion";
import { IRIS_ANGLE } from "./physiology";
import { SURFACE } from "./surface";
import { createWallBots } from "./wallbots";
import { createWallCrowd, type WallCrowd, type WallRoom } from "./wallcrowd";
import { createLashes } from "./walllashes";
import { BLISS, blissPose, createPetting, PET } from "./wallpet";
import { lidCorners, WALL_SCENE } from "./wallscene";
import { createSkinCycle, SLATE } from "./wallskin";
import { createWallView, type WallBall } from "./wallview";

const SKIP_MAX_S = 3600;

/**
 * The eye's size and place: its diameter a share of the wall's height, centred on the wall, its
 * centre on the wall's plane so its front half stands out of the socket. The lamp is above and in
 * front of it, in ball radii from its centre. The room runs this far out from the wall, metres.
 */
export const WALL_EYE = { diameter: 0.4, lamp: [-0.62, 1.75, 1.75] as Vec3, depth: 9 };

/**
 * What the eye on a wall can turn to: no further than `off` from straight out (radians), and
 * within `high` above and `low` below level.
 */
export const WALL_LOOK = { off: 56 * DEG, high: 45 * DEG, low: -52 * DEG };

export type WallSurface = "slate" | "skin";
export const wallOption = (v: unknown): WallSurface => (v === "skin" ? "skin" : "slate");

export const wallLimit = (d: Vec3): Vec3 => {
  let v = d;
  const a = Math.acos(Math.max(-1, Math.min(1, v[2])));
  if (a > WALL_LOOK.off) v = slerp([0, 0, 1], v, WALL_LOOK.off / a);
  const e = elevation(v);
  if (e > WALL_LOOK.high || e < WALL_LOOK.low) {
    v = fromAngles(Math.max(WALL_LOOK.low, Math.min(WALL_LOOK.high, e)), bearing(v));
  }
  return v;
};

/** A flinch pulls the ball back into its socket, quickly, and lets it out again slowly. */
const RECOIL = { depth: 0.05, in: 0.06, out: 0.45, gap: 0.45 };

export interface WallLayout {
  ball: WallBall;
  lamp: Vec3;
  room: WallRoom;
}

export const wallLayout = (ctx: Pick<AppContext, "frame" | "setup">): WallLayout => {
  const d = displaySurface(ctx.frame, ctx.setup);
  const centre: Vec3 = [
    d.origin[0] + (d.right[0] * d.width) / 2,
    d.origin[1] + d.height / 2,
    d.origin[2],
  ];
  const radius = (WALL_EYE.diameter * d.height) / 2;
  const lamp: Vec3 = [
    centre[0] + WALL_EYE.lamp[0] * radius,
    centre[1] + WALL_EYE.lamp[1] * radius,
    centre[2] + WALL_EYE.lamp[2] * radius,
  ];
  return {
    ball: { centre, radius },
    lamp,
    room: {
      centre,
      radius,
      left: d.origin[0],
      right: d.origin[0] + d.width,
      depth: WALL_EYE.depth,
    },
  };
};

/** The sphere-shaped facts the motion model reads (its size and height). */
const ballInfo = (l: WallLayout): SphereInfo => ({
  radius: l.ball.radius,
  centreY: l.ball.centre[1],
  cover: { top: Math.PI / 2, bottom: -Math.PI / 2 },
  view: { top: Math.PI / 2, bottom: -Math.PI / 2 },
});

export const mountWall = (ctx: AppContext): AppInstance => {
  const r3d = createRenderer3D(ctx.root, ctx.frame, { antialias: false });
  const rng = ctx.rng();
  let layout = wallLayout(ctx);

  // The iris's texture about as fine as the iris is drawn round its middle.
  const pxPerM =
    (ctx.frame.width * ctx.frame.pixelRatio) / displaySurface(ctx.frame, ctx.setup).width;
  const irisPx = layout.ball.radius * Math.sin(IRIS_ANGLE) * pxPerM;
  const lamp = { value: [...layout.lamp] };
  const lampOn = { value: 1 };
  const lidsOn = { value: ctx.options.lids === false ? 0 : 1 };
  const lidShell = { value: [0, 0, 0, 1] };
  const lidUpper = { value: [0, 1, 0, 0] };
  const lidLower = { value: [0, 1, 0, 0] };
  const skinOn = { value: wallOption(ctx.options.wall) === "skin" ? 1 : 0 };
  // This round's details, each an option, on unless set false.
  const lashesOn = { value: 1 };
  const shapeOn = { value: 1 };
  const tearsOn = { value: 1 };
  const setDetails = () => {
    lashesOn.value = ctx.options.lashes === false ? 0 : 1;
    shapeOn.value = ctx.options.shape === false ? 0 : 1;
    tearsOn.value = ctx.options.tears === false ? 0 : 1;
  };
  setDetails();
  const paint = { value: [...SLATE] };
  const eye = createEyeLook(ctx, r3d, rng, irisTexSize((2 * Math.PI * irisPx) / 0.72), {
    uLamp: lamp,
    uLampOn: lampOn,
    uLidsOn: lidsOn,
    uLidShell: lidShell,
    uLidUpper: lidUpper,
    uLidLower: lidLower,
    uPaint: paint,
    uSkin: skinOn,
    uLashes: lashesOn,
    uShape: shapeOn,
    uTears: tearsOn,
  });
  const iris = eye.iris;
  const colours = eye.colours;
  const view = createWallView(r3d, ctx.frame, ctx.setup, {
    fragment: [WALL_SCENE, SURFACE].join("\n"),
    uniforms: eye.uniforms,
    defines: { GAZE_WALL: 1, WALL_FRONT: 1 },
    ball: layout.ball,
  });
  r3d.onRestore(() => iris.invalidate());
  // The lashes are drawn over the wall's picture, with its uniforms.
  const lashes = createLashes(rng.fork("lashes"), view.material.uniforms);
  view.scene.add(lashes.mesh);
  const showLashes = (on: boolean) => {
    lashes.mesh.visible = on && lashesOn.value > 0;
  };
  showLashes(true);
  r3d.prepare(view.scene, view.camera);

  const lids = createLids(rng.fork("lids"));
  const pet = createPetting();
  const skin = createSkinCycle(rng.fork("skin"));
  const setPaint = () => {
    const c = skinOn.value > 0 ? skin.colour : SLATE;
    paint.value[0] = c[0];
    paint.value[1] = c[1];
    paint.value[2] = c[2];
  };
  let crowd: WallCrowd | null = null;
  // It opens on a look at someone standing in the middle a few metres out, where the picture is
  // drawn from, so a preview starts with the eye looking at you.
  const motion = createMotion({
    rng: rng.fork("motion"),
    sphere: ballInfo(layout),
    pace: paceOption(ctx.options.pace),
    upper: false,
    start: { x: layout.ball.centre[0], z: 4, eye: 1.6, seconds: 5 },
    onEvent: (e) => {
      if (e.kind === "saccade" && !e.micro && !e.refix && !e.corrective) lids.saccade(e.amp);
    },
    space: {
      limit: wallLimit,
      crowd: (r) => {
        crowd = createWallCrowd(r, layout.room);
        return crowd;
      },
      focus: (current) => crowd?.focus(current) ?? null,
    },
  });
  const people = crowd as unknown as WallCrowd;

  let before = motion.gaze;
  let beforeTwist = motion.torsion;
  let frames = 0;
  let time = 0;
  let lastHuman = -Infinity;
  let lastFlinch = -Infinity;
  let lastSummon = -Infinity;
  let recoil = -Infinity;
  let resets = 0;
  let frozen = false;
  const touchRng = rng.fork("touch");

  /** The eye on the stage, CSS px: its centre and radius. */
  const ballOnStage = () => {
    const c = view.toStage(layout.ball.centre);
    const top = view.toStage([
      layout.ball.centre[0],
      layout.ball.centre[1] + layout.ball.radius,
      layout.ball.centre[2],
    ]);
    return c && top ? { x: c.x, y: c.y, r: Math.abs(c.y - top.y) } : null;
  };

  const bots = createWallBots(ctx.input, ctx.bots, rng.fork("bots"), {
    stage: () => ({ width: ctx.frame.width, height: ctx.frame.height }),
    reach: () => ({ adult: ctx.frame.reachTop.adult, child: ctx.frame.reachTop.child }),
    ball: ballOnStage,
  });

  /** Whether stage px (x, y) is on the open eye, not on its lids. */
  const onOpenEye = (x: number, y: number) => {
    const d = view.hitBall(x, y);
    if (!d) return false;
    if (lidsOn.value === 0) return true;
    const corner = lidCorners(shapeOn.value > 0, tearsOn.value > 0);
    if (d[0] > corner.inner || -d[0] > corner.outer) return false;
    const { centre, radius } = layout.ball;
    const p = [centre[0] + d[0] * radius, centre[1] + d[1] * radius, centre[2] + d[2] * radius];
    const side = (m: number[]) => m[0]! * p[0]! + m[1]! * p[1]! + m[2]! * p[2]! + m[3]!;
    return side(lidUpper.value) <= 0 && side(lidLower.value) >= 0;
  };

  const onDown = (p: Pointer) => {
    if (!p.synthetic) lastHuman = time;
    const w = view.wallPoint(p.x, p.y);
    const onEye = view.hitBall(p.x, p.y) !== null;
    const { person, fresh } = people.touchDown(p.id, w[0], w[1]);
    pet.down(p.id, w[0], w[1]);
    if (onEye && time - lastFlinch > RECOIL.gap) {
      lastFlinch = time;
      lastSummon = time;
      recoil = time;
      pet.startle();
      if (lidsOn.value > 0) lids.reflex();
      motion.attend(person.id, { delay: touchRng.range(0.04, 0.08), flinch: true });
    } else if (fresh || (motion.target !== person.id && time - lastSummon > 1.2)) {
      if (fresh) pet.newcomer();
      lastSummon = time;
      // About a saccade's latency to something that appears.
      motion.attend(person.id, { delay: touchRng.range(0.14, 0.24) });
    }
  };
  const offs = [
    ctx.input.on("down", onDown),
    ctx.input.on("move", (p) => {
      const w = view.wallPoint(p.x, p.y);
      people.touchMove(p.id, w[0], w[1]);
      pet.move(p.id, w[0], w[1], !onOpenEye(p.x, p.y));
    }),
    ctx.input.on("up", (p) => {
      people.touchUp(p.id);
      pet.up(p.id);
    }),
    ctx.input.on("cancel", (p) => {
      people.touchUp(p.id);
      pet.up(p.id);
    }),
  ];

  const setLids = () => {
    const { centre, radius } = layout.ball;
    lidShell.value = [centre[0], centre[1], centre[2], radius * LIDS.shell];
    const tilt = shapeOn.value > 0 ? LIDS.tilt : 0;
    lidUpper.value = marginPlane(centre, radius, lids.upper, tilt);
    lidLower.value = marginPlane(centre, radius, lids.lower, tilt);
    lashes.setLower(lids.lower);
  };

  const ballNow = (): WallBall => {
    const since = time - recoil;
    if (since > RECOIL.in + RECOIL.out) return layout.ball;
    const k =
      since < RECOIL.in
        ? since / RECOIL.in
        : 0.5 + 0.5 * Math.cos((Math.PI * (since - RECOIL.in)) / RECOIL.out);
    const c = layout.ball.centre;
    return {
      centre: [c[0], c[1], c[2] - RECOIL.depth * layout.ball.radius * k],
      radius: layout.ball.radius,
    };
  };

  /**
   * Where the eye is seen to look: the motion model's gaze, rolled up towards the content pose as
   * far as it is content, less while it peeks at someone new.
   */
  const shown = (gaze: Vec3): Vec3 => {
    const w = pet.content * (1 - PET.peekMost * pet.peek);
    if (w <= 0) return gaze;
    const pose = blissPose(time);
    return slerp(gaze, wallLimit(fromAngles(pose.elevation, pose.bearing)), w);
  };
  const stepModels = (dt: number) => {
    motion.step(dt);
    colours.step(dt);
    skin.step(dt);
    pet.step(dt);
    lids.step(dt, elevation(shown(motion.gaze)), motion.moods, pet.content);
  };

  const loop = ctx.loop({
    hz: 60,
    update(dt) {
      time += dt;
      // Bots stand back while a person is at the wall.
      bots.update(dt, time - lastHuman > 20);
      if (frames === 0 || frozen) return;
      before = motion.gaze;
      beforeTwist = motion.torsion;
      stepModels(dt);
    },
    render(alpha) {
      if (!r3d.ready) return;
      iris.draw();
      const gaze = shown(slerp(before, motion.gaze, alpha));
      eye.pose(
        {
          // The eye dips a little while the lids are shut.
          gaze: lidsOn.value > 0 && lids.shut > 0 ? nudge(gaze, 0, -LIDS.dip * lids.shut) : gaze,
          twist: beforeTwist + (motion.torsion - beforeTwist) * alpha,
          pupil: motion.pupil + BLISS.pupil * pet.content,
          lamps: motion.light.lamps,
          day: motion.light.day,
        },
        LOOKING_OUT,
      );
      lampOn.value = 0.45 + 0.55 * motion.light.lamps;
      setLids();
      setPaint();
      view.setBall(ballNow());
      view.render();
      frames++;
    },
  });
  loop.start();

  ctx.onResize((f) => {
    r3d.resize(f);
    view.resize(f);
    layout = wallLayout({ frame: f, setup: ctx.setup });
    lamp.value = [...layout.lamp];
    view.setBall(layout.ball);
    people.setRoom(layout.room);
    motion.setSphere(ballInfo(layout));
  });

  const state = () => {
    const gz = shown(motion.gaze);
    return {
      kind: "wall",
      elevation: degrees(elevation(gz)),
      bearing: degrees(bearing(gz)),
      gaze: [...gz],
      torsion: degrees(motion.torsion),
      pupil: motion.pupil + BLISS.pupil * pet.content,
      mood: motion.mood,
      moods: { ...motion.moods },
      activity: motion.activity,
      staring: motion.staring,
      time: motion.time,
      stats: { ...motion.stats },
      people: people.people.length,
      upper: 0,
      touching: people.touchers.length,
      target: motion.target,
      targetDirection: (() => {
        const id = motion.target;
        const p = id === null ? undefined : people.find(id);
        return p ? [...people.direction(p)] : null;
      })(),
      ball: ballOnStage(),
      bots: bots.touches,
      roomLight: motion.roomLight,
      lamps: motion.light.lamps,
      day: motion.light.day,
      iris: { from: colours.from, to: colours.to, mix: colours.mix },
      lids: {
        on: lidsOn.value > 0,
        upper: degrees(lids.upper),
        lower: degrees(lids.lower),
        shut: lids.shut,
        blinks: lids.blinks,
        reflexes: lids.reflexes,
        lashes: {
          on: lashesOn.value > 0,
          upper: lashes.lashes.filter((l) => !l.lower).length,
          lower: lashes.lashes.filter((l) => l.lower).length,
        },
        shape: shapeOn.value > 0,
        tears: tearsOn.value > 0,
      },
      wall: skinOn.value > 0 ? "skin" : "slate",
      skin: { from: skin.from, to: skin.to, mix: skin.mix, colour: [...skin.colour] },
      petting: {
        stroking: pet.stroking,
        content: pet.content,
        energy: pet.energy,
        peek: pet.peek,
        episodes: pet.episodes,
      },
      reflections: eye.shine,
      depth: eye.depth,
      ready: r3d.ready && iris.done,
      resets,
      frames,
    };
  };

  const debugKey = "__gaze";
  Object.defineProperty(window, debugKey, {
    configurable: true,
    value: {
      state,
      skip(seconds: number) {
        const steps = Math.round(Math.min(SKIP_MAX_S, Math.max(0, seconds)) * 60);
        for (let i = 0; i < steps; i++) {
          time += 1 / 60;
          stepModels(1 / 60);
        }
        before = motion.gaze;
        beforeTwist = motion.torsion;
        return state();
      },
      bench(n = 30) {
        if (!r3d.ready) return null;
        const gl = r3d.renderer.getContext();
        const px = new Uint8Array(4);
        for (let i = 0; i < 3; i++) {
          view.render();
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        }
        const t0 = performance.now();
        for (let i = 0; i < n; i++) {
          view.render();
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        }
        return (performance.now() - t0) / n;
      },
      light(l: number, d: number, ramp = 1, hold = 60) {
        motion.light.set(l, d, ramp, hold);
      },
      look(elev: number, bear: number, seconds = 10) {
        motion.hold(fromAngles(elev * DEG, bear * DEG), seconds);
      },
      blink() {
        lids.blink();
      },
      /** Show or hide the lashes (tests). */
      lashes(on = true) {
        showLashes(on);
      },
      /** Hold the show still (or let it go on), for screenshots of a moment. */
      freeze(on = true) {
        frozen = on;
        before = motion.gaze;
        beforeTwist = motion.torsion;
      },
    },
  });

  return {
    reset() {
      colours.set(irisOption(ctx.options.iris));
      eye.setSurface();
      motion.setPace(paceOption(ctx.options.pace));
      lidsOn.value = ctx.options.lids === false ? 0 : 1;
      skinOn.value = wallOption(ctx.options.wall) === "skin" ? 1 : 0;
      setDetails();
      showLashes(true);
      people.release();
      pet.release();
      resets++;
    },
    status() {
      const gz = motion.gaze;
      return {
        mood: motion.mood,
        looking: `${Math.round(degrees(elevation(gz)))}°, ${Math.round(degrees(bearing(gz)))}°`,
        pupil: `${motion.pupil.toFixed(1)} mm`,
        iris: colours.mix < 1 ? `${colours.from} to ${colours.to}` : colours.to,
        touching: people.touchers.length,
        stroked: pet.stroking,
      };
    },
    dispose() {
      loop.stop();
      for (const off of offs) off();
      bots.dispose();
      Reflect.deleteProperty(window, debugKey);
      eye.dispose();
      r3d.dispose();
    },
  };
};
