/**
 * Answer balls on a wall: one to three of the toy in a row, each with its window facing the
 * people in front of it, standing in a dark studio. Touch a ball to shake it; it answers once it
 * settles. With nobody about, the balls shake themselves now and then, one at a time.
 *
 * Each ball is the sphere's surface shader drawn by ray casting (`wallview.ts`) from its own eye,
 * over a backdrop drawn for the same eyes (`wallscene.ts`). Their motion is `wallshake.ts`.
 */
import { Color, Matrix3, OrthographicCamera, Scene, Vector2, Vector3, Vector4 } from "three";
import { createRenderer3D } from "../../core/renderer3d";
import { apply3, DEG, IDENTITY3, transpose3, type Vec3 } from "../../core/sphere";
import { toMatrix3 } from "../../core/sphere3d";
import type { AppContext, AppInstance, FrameInfo, Pointer } from "../../core/types";
import { iconElement } from "../../core/ui";
import { ANSWERS } from "./answers";
import { createAtlas, createPromptPicture } from "./atlas";
import { BUBBLES } from "./bubbles";
import { FACES } from "./die";
import { FACE_SIZE, poseRotation } from "./motion";
import { paletteOf, PALETTE_IDS, type PaletteId } from "./palettes";
import { BALL_GLSL, MAX_WINDOWS } from "./shader";
import { deck, type Pace, WINDOW_RADIUS } from "./show";
import { createBackdrop } from "./wallscene";
import { type BallCount, ballAt, EYE, wallLayout, type WallLayout } from "./walllayout";
import { createWallBots, MAX_BOTS } from "./wallbots";
import { createWallBallModel, createWallDeck, WALL_STAGES, type WallBallModel } from "./wallshake";
import { createWallBall, type WallBall } from "./wallview";

const HZ = 60;
/** The softbox that lights the balls' highlights and casts their side shadows: up, left, in front. */
const KEY_DIR: Vec3 = (() => {
  const v = [-0.6, 0.62, 0.5];
  const l = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / l, v[1]! / l, v[2]! / l];
})();
/** Light reaching the die, from the room in front and the softbox. */
const DIE_LIGHT: Vec3 = (() => {
  const v = [KEY_DIR[0] * 0.6, KEY_DIR[1] * 0.6 + 0.25, KEY_DIR[2] * 0.6 + 0.8];
  const l = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / l, v[1]! / l, v[2]! / l];
})();
/** With nobody touching for this long, the balls shake themselves; bots wait this long too, s. */
const QUIET = 20;
const BOT_YIELD = 15;
/** Seconds between a ball finishing and the next shaking itself, with nobody about. */
const SELF_GAP: Record<Pace, [number, number]> = { calm: [6, 12], lively: [4, 8] };
/** The hint's size, venue px. */
const HINT = 210;
const MAX_SKIP = 24 * 3600;

const toLinear = (hex: string) => new Color(hex);

export const mountWall = (ctx: AppContext): AppInstance => {
  const colours: PaletteId = (PALETTE_IDS as unknown[]).includes(ctx.options.colours)
    ? (ctx.options.colours as PaletteId)
    : "night";
  const palette = paletteOf(colours);
  const pace: Pace = ctx.options.pace === "lively" ? "lively" : "calm";
  const prompting = ctx.options.prompt !== false;
  const asked = Number(ctx.options.balls);
  const count: BallCount = asked === 1 || asked === 2 ? asked : 3;

  let frame = ctx.frame;
  let layout: WallLayout = wallLayout(frame, count);
  const rng = ctx.rng().fork("answerball-wall");
  const rest = poseRotation(Math.atan2(EYE.up, EYE.out), 0);

  const models: WallBallModel[] = [];
  const dealer = createWallDeck(rng.fork("deck"), count, deck, () =>
    models.map((m) => m.showing()),
  );
  // The middle ball starts with an answer, so the wall says something from the start.
  const first = Math.floor((count - 1) / 2);
  for (let i = 0; i < count; i++) {
    models.push(
      createWallBallModel({
        rng: rng.fork(`ball-${i}`),
        pace,
        prompt: prompting,
        rest,
        deal: () => dealer.deal(),
        holding: i === first ? dealer.deal() : undefined,
      }),
    );
  }

  const r3d = createRenderer3D(ctx.root, frame, { antialias: false });
  const buffer = () => r3d.canvas.width / Math.max(1, frame.width);
  const faceTexels = FACE_SIZE * layout.scale * buffer();
  const cell = Math.max(128, Math.min(512, Math.round(faceTexels / 0.55 / 32) * 32));
  const atlas = r3d.keep(createAtlas(cell));
  const promptPic = r3d.keep(
    createPromptPicture(Math.round(2 * Math.sin(WINDOW_RADIUS) * layout.scale * buffer())),
  );

  const albedo = toLinear(palette.room);
  const floorSeen = albedo.clone().multiplyScalar(0.45);
  const backSeen = albedo.clone().multiplyScalar(0.2);
  const keyDir = new Vector3(...KEY_DIR);

  interface Drawn {
    view: WallBall;
    uniforms: {
      uToBall: { value: Matrix3 };
      uDieRot: { value: Matrix3[] };
      uDiePos: { value: Vector3[] };
      uLook: { value: Vector4[] };
      uLight: { value: Vector3[] };
      uSlosh: { value: Vector2[] };
      uBubble: { value: Vector4[] };
      uDrift: { value: Vector4 };
    };
  }

  const drawn: Drawn[] = models.map(() => {
    const uniforms = {
      uToBall: { value: new Matrix3() },
      uWindows: { value: 1 },
      uToWin: { value: Array.from({ length: MAX_WINDOWS }, () => toMatrix3(IDENTITY3)) },
      uDieRot: { value: Array.from({ length: MAX_WINDOWS }, () => new Matrix3()) },
      uDiePos: { value: Array.from({ length: MAX_WINDOWS }, () => new Vector3()) },
      uLook: { value: Array.from({ length: MAX_WINDOWS }, () => new Vector4(3, 1, 0, 0)) },
      uLight: { value: Array.from({ length: MAX_WINDOWS }, () => new Vector3(0, 0, 1)) },
      uSlosh: { value: Array.from({ length: MAX_WINDOWS }, () => new Vector2()) },
      uBubble: { value: Array.from({ length: MAX_WINDOWS * BUBBLES }, () => new Vector4()) },
      uAtlas: { value: atlas.texture },
      uPrompt: { value: promptPic.texture },
      uBody: { value: new Color(palette.body) },
      uLiquid: { value: new Color(palette.liquid) },
      uDie: { value: new Color(palette.die) },
      uInk: { value: new Color(palette.ink) },
      uCentreY: { value: 0 },
      uRadius: { value: 1 },
      uViewer: { value: new Vector2(1, 3) },
      // No hidden cap on a wall.
      uHidden: { value: 2 },
      uDrift: { value: new Vector4() },
      uExposure: { value: 1 },
      uSeamAxis: { value: 0 },
      uSeamWave: { value: new Vector2() },
      uKeyDir: { value: keyDir },
      uFloorSeen: { value: floorSeen },
      uBackSeen: { value: backSeen },
    };
    const view = createWallBall({
      fragment: BALL_GLSL,
      uniforms,
      defines: { ANSWERBALL_WALL: "" },
    });
    return { view, uniforms };
  });

  const backdrop = createBackdrop(palette.room, KEY_DIR);
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  scene.add(backdrop.mesh);
  drawn.forEach((d, i) => {
    d.view.mesh.renderOrder = i;
    scene.add(d.view.mesh);
  });
  r3d.prepare(scene, camera);

  // A hand on each waiting ball while nobody is about, low enough for a child.
  const hints = models.map(() => {
    const el = iconElement("hand", "100%", "#e8ecf4");
    el.style.cssText +=
      "position:absolute;pointer-events:none;opacity:0;transform-origin:50% 50%;z-index:1;";
    ctx.root.append(el);
    return { el, shown: -1 };
  });
  const placeHints = () => {
    const size = HINT * frame.unit;
    const child = frame.reachTop.child;
    hints.forEach((h, i) => {
      const b = layout.balls[i]!;
      const bottom = layout.floor - 0.12 * layout.scale;
      const y = Math.min(
        bottom - size / 2,
        Math.max(child + (bottom - child) * 0.45, b.y + 0.3 * layout.scale),
      );
      h.el.style.width = `${size}px`;
      h.el.style.height = `${size}px`;
      h.el.style.left = `${b.x - size / 2}px`;
      h.el.style.top = `${y - size / 2}px`;
    });
  };
  placeHints();

  let t = 0;
  let resets = 0;
  let shakes = 0;
  let paused = false;
  let lastPerson = -Infinity;
  let selfAt: number | null = null;
  const owner = new Map<number, number>();

  const centreOf = (i: number) => {
    const b = layout.balls[i]!;
    const [dx, dy] = models[i]!.offset();
    return { x: b.x + dx * layout.scale, y: b.y - dy * layout.scale };
  };

  /** A touch in ball radii from ball `i`'s centre at rest, y up, and its upward speed. */
  const onBall = (i: number, p: Pointer) => {
    const b = layout.balls[i]!;
    return {
      x: (p.x - b.x) / layout.scale,
      y: (b.y - p.y) / layout.scale,
      vy: -p.vy / layout.scale,
    };
  };

  const onDown = (p: Pointer) => {
    const i = ballAt(
      layout,
      p.x,
      p.y,
      models.map((_, k) => centreOf(k)),
    );
    if (i < 0) return;
    owner.set(p.id, i);
    const at = onBall(i, p);
    models[i]!.press(p.id, at.x, at.y, !p.synthetic, at.vy);
    if (!p.synthetic) lastPerson = t;
  };
  const onMove = (p: Pointer) => {
    const i = owner.get(p.id);
    if (i === undefined) return;
    const at = onBall(i, p);
    models[i]!.move(p.id, at.x, at.y, at.vy);
    if (!p.synthetic) lastPerson = t;
  };
  const onUp = (p: Pointer) => {
    const i = owner.get(p.id);
    if (i === undefined) return;
    owner.delete(p.id);
    models[i]!.release(p.id);
  };
  const unlisten = [
    ctx.input.on("down", onDown),
    ctx.input.on("move", onMove),
    ctx.input.on("up", onUp),
    ctx.input.on("cancel", onUp),
  ];

  const botCount = Math.min(MAX_BOTS, count, Math.max(0, ctx.bots));
  const bots =
    botCount > 0
      ? createWallBots(
          ctx.input,
          rng.fork("bots"),
          () =>
            models.map((m, i) => {
              const c = centreOf(i);
              return {
                x: c.x,
                y: c.y,
                r: layout.outline,
                free:
                  m.fingers === 0 &&
                  m.sincePerson > 10 &&
                  (m.stage === "wait" || (m.stage === "hold" && m.age > 3)),
              };
            }),
          () => ({ top: frame.reachTop.adult, floor: layout.floor, unit: frame.unit }),
        )
      : null;

  /** With nobody about, the ball that has waited longest shakes itself, one at a time. */
  const selfShake = () => {
    const quiet = t - lastPerson > QUIET;
    const botsOn = bots !== null && t - lastPerson > BOT_YIELD;
    if (!quiet || botsOn || !models.every((m) => m.stage === "wait")) {
      selfAt = null;
      return;
    }
    if (selfAt === null) selfAt = t + rng.range(...SELF_GAP[pace]);
    if (t < selfAt) return;
    selfAt = null;
    let pick = 0;
    models.forEach((m, i) => {
      if (m.waiting > models[pick]!.waiting) pick = i;
    });
    const long = rng.next() < 0.2;
    models[pick]!.jiggle(rng.range(0.8, 1.2), long);
  };

  const advance = (dt: number) => {
    t += dt;
    selfShake();
    for (const m of models) m.step(dt);
  };

  const update = (dt: number) => {
    if (paused) return;
    advance(dt);
    const botsOn = bots && t - lastPerson > BOT_YIELD ? botCount : 0;
    bots?.update(dt, botsOn);
  };

  const write = () => {
    const scale = layout.scale;
    const buf = buffer();
    const stage = { width: frame.width, height: frame.height };
    const centres: Vec3[] = [];
    models.forEach((m, i) => {
      const d = drawn[i]!;
      const rot = m.rotation();
      const [dx, dy] = m.offset();
      const c = centreOf(i);
      d.view.place({ x: c.x, y: c.y, scale, eye: [-dx, EYE.up - dy, EYE.out] }, stage, buf);
      centres.push([c.x / scale, (layout.floor - c.y) / scale, 0]);
      const u = d.uniforms;
      toMatrix3(transpose3(rot), u.uToBall.value);
      const pose = m.die();
      toMatrix3(transpose3(pose.rot), u.uDieRot.value[0]!);
      u.uDiePos.value[0]!.set(pose.pos[0], pose.pos[1], pose.pos[2]);
      u.uLook.value[0]!.set(EYE.out, 1, 0, m.prompt());
      const l = apply3(transpose3(rot), DIE_LIGHT);
      u.uLight.value[0]!.set(l[0], l[1], l[2]);
      const s = m.slosh();
      u.uSlosh.value[0]!.set(s[0], s[1]);
      m.bubbles.list.forEach((b, j) => u.uBubble.value[j]!.set(b.x, b.y, b.r, b.alpha));
      u.uDrift.value.set(
        0.03 * Math.sin(t * 0.05 + i),
        0.03 * Math.cos(t * 0.04 + i),
        0.03 * Math.sin(t * 0.05 + 2 + i),
        0.03 * Math.cos(t * 0.04 + 1 + i),
      );
    });
    backdrop.set({
      floor: (frame.height - layout.floor) * buf,
      scale: scale * buf,
      eye: EYE,
      balls: centres,
    });
    // The hint shows on a waiting ball once nobody has touched the wall for a few seconds.
    const quiet = t - lastPerson > 6;
    hints.forEach((h, i) => {
      const m = models[i]!;
      const on = quiet && m.stage === "wait" && m.waiting > 2 && m.fingers === 0;
      const beat = 0.5 + 0.5 * Math.sin(t * 2.2 + i * 1.3);
      const level = on ? Math.min(1, (m.waiting - 2) / 1.5) * (0.28 + 0.3 * beat) : 0;
      if (Math.abs(level - h.shown) < 0.01) return;
      h.shown = level;
      h.el.style.opacity = level.toFixed(3);
      h.el.style.transform = `scale(${(0.94 + 0.06 * beat).toFixed(3)})`;
    });
  };

  const loop = ctx.loop({
    hz: HZ,
    update,
    render() {
      if (!r3d.ready) return;
      write();
      r3d.renderer.render(scene, camera);
    },
  });
  loop.start();

  ctx.onResize((f: FrameInfo) => {
    frame = f;
    layout = wallLayout(f, count);
    r3d.resize(f);
    placeHints();
  });

  const skip = (seconds: number) => {
    const n = Math.round(Math.min(MAX_SKIP, Math.max(0, seconds)) * HZ);
    for (let i = 0; i < n; i++) advance(1 / HZ);
  };

  const shakeAll = () => {
    shakes++;
    models.forEach((m) => m.jiggle(1));
  };

  const ballState = (i: number) => {
    const m = models[i]!;
    const c = centreOf(i);
    const rot = m.rotation();
    const pose = m.die();
    // The text's up on the wall, against the wall's up.
    const up = apply3(rot, apply3(pose.rot, FACES[m.answer]!.up));
    const [dx, dy] = m.offset();
    return {
      stage: m.stage,
      age: m.age,
      answer: ANSWERS[m.answer]!.text,
      kind: ANSWERS[m.answer]!.kind,
      showing: m.showing() === null ? null : ANSWERS[m.answer]!.text,
      long: m.long,
      depth: pose.depth,
      prompt: m.prompt(),
      tilt: m.tilt() / DEG,
      offset: [dx, dy],
      fingers: m.fingers,
      upright: up[1],
      x: c.x,
      y: c.y,
      r: layout.outline,
      bubbles: m.bubbles.list.map((b) => ({ x: b.x, y: b.y, alpha: b.alpha })),
      hint: hints[i]!.shown,
    };
  };

  const debugKey = "__answerball";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => ({
          ready: r3d.ready,
          kind: "wall",
          time: t,
          count,
          pace,
          colours,
          resets,
          shakes,
          quiet: t - lastPerson,
          stageIds: WALL_STAGES,
          balls: models.map((_, i) => ballState(i)),
          layout: {
            scale: layout.scale,
            floor: layout.floor,
            outline: layout.outline,
            reach: frame.reachTop,
          },
        }),
        skip,
        shake: (i?: number) => {
          if (i === undefined) shakeAll();
          else models[i]?.jiggle(1);
        },
        /** A synthetic finger at stage px, through the same path as people's. */
        touch: (x: number, y: number) => ctx.input.inject.down(x, y),
        move: (id: number, x: number, y: number) => ctx.input.inject.move(id, x, y),
        lift: (id: number) => ctx.input.inject.up(id),
        pause: (on: boolean) => {
          paused = on;
        },
      },
    });
  }

  return {
    reset() {
      resets++;
      bots?.release();
      for (const m of models) m.reset();
      owner.clear();
      selfAt = null;
    },
    attract() {
      // Shake one soon, then carry on as with nobody about.
      lastPerson = -Infinity;
      selfAt = t + 2;
    },
    command(name) {
      if (name === "shake") shakeAll();
    },
    status: () => ({
      balls: count,
      stages: models.map((m) => m.stage).join(", "),
      answers: models.map((m) => (m.showing() === null ? "-" : ANSWERS[m.answer]!.text)).join(", "),
    }),
    homeSpot(size) {
      // In the margin past the last ball, inside the reach band, if there is room.
      const last = layout.balls[layout.balls.length - 1]!;
      const x = frame.width - size - 12 * frame.unit;
      if (x < last.x + layout.outline + 8 * frame.unit) return null;
      return { x, y: Math.max(frame.reachTop.adult, layout.floor - size - 40 * frame.unit) };
    },
    dispose() {
      loop.stop();
      for (const u of unlisten) u();
      bots?.dispose();
      for (const h of hints) h.el.remove();
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
      r3d.dispose();
    },
  };
};
