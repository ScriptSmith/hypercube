import { Color, Matrix3, Vector3, Vector4 } from "three";
import { createRenderer3D } from "../../core/renderer3d";
import { DEG, WHOLE_SPHERE, wrapLon } from "../../core/sphere";
import { createSurfacePass, toMatrix3 } from "../../core/sphere3d";
import type { AppContext, AppInstance, FrameInfo, SphereInfo } from "../../core/types";
import { faceFrame, handPose } from "./face";
import { type ColourId, colourOf, PALETTES } from "./palettes";
import { FACE_GLSL } from "./shader";
import { createShow, type Cue, type Pace, type Pose } from "./show";

const HZ = 60;
/** Overall brightness: a whole ball of bright skin stays well short of full white. */
const EXPOSURE = 0.84;
/** Longest stretch the debug hook may skip in one go, s. */
const MAX_SKIP = 3600;
const CUES: readonly Cue[] = ["floor", "across", "under", "sweep"];

const paceOf = (v: unknown): Pace => (v === "relaxed" ? "relaxed" : "formal");

export const mount = (ctx: AppContext): AppInstance => {
  let frame = ctx.frame;
  const sphereOf = (f: FrameInfo): SphereInfo => f.sphere ?? WHOLE_SPHERE;
  let colour: ColourId = colourOf(ctx.options.colour);
  // The option, until an admin command says otherwise; a reset must not drop a held salute.
  let held = ctx.options.hold === true;

  const r3d = createRenderer3D(ctx.root, frame, { antialias: false });
  const show = createShow(ctx.rng().fork("salute"), {
    pace: paceOf(ctx.options.pace),
    hold: held,
    sphere: sphereOf(frame),
    gallery: sphereOf(frame).gallery === true,
  });

  const uniforms = {
    uFace: { value: new Matrix3() },
    uAA: { value: 0.001 },
    uHidden: { value: 1 },
    uExposure: { value: EXPOSURE },
    uSkin: { value: new Color() },
    uDeep: { value: new Color() },
    uGlow: { value: new Color() },
    uInk: { value: new Color() },
    uCheek: { value: new Color() },
    uHandSkin: { value: new Color() },
    uHand: { value: new Vector4(0, 0, 1, 0) },
    uHandScale: { value: 0 },
    uLook: { value: new Vector4() },
    uEyes: { value: new Vector3() },
  };
  const pass = createSurfacePass(r3d, frame, { fragment: FACE_GLSL, uniforms });

  const paint = (id: ColourId) => {
    const p = PALETTES[id];
    uniforms.uSkin.value.set(p.skin);
    uniforms.uDeep.value.set(p.deep);
    uniforms.uGlow.value.set(p.glow);
    uniforms.uInk.value.set(p.ink);
    uniforms.uCheek.value.set(p.cheek);
    uniforms.uHandSkin.value.set(p.hand);
  };
  paint(colour);

  const fit = (f: FrameInfo) => {
    const s = sphereOf(f);
    uniforms.uHidden.value = Math.sin(s.view.top);
    const rows = r3d.canvas.height || Math.round(f.height * f.pixelRatio);
    uniforms.uAA.value = (s.cover.top - s.cover.bottom) / Math.max(1, rows);
    show.setSphere(s, s.gallery === true);
  };
  fit(frame);

  const before: Pose = { ...show.pose };
  let frames = 0;
  let paused = false;

  const advance = (dt: number) => {
    Object.assign(before, show.pose);
    show.step(dt);
  };

  const draw = (alpha: number) => {
    const a = before;
    const b = show.pose;
    const mix = (x: number, y: number) => x + (y - x) * alpha;
    const bearing = a.bearing + wrapLon(b.bearing - a.bearing) * alpha;
    const aim = [mix(a.aimX, b.aimX), mix(a.aimY, b.aimY)] as const;
    toMatrix3(
      faceFrame(bearing, mix(a.pitch, b.pitch), mix(a.roll, b.roll), aim),
      uniforms.uFace.value,
    );
    const brow = mix(a.brow, b.brow);
    const hand = handPose(mix(a.raise, b.raise), brow);
    uniforms.uHand.value.set(hand.x, hand.y, Math.cos(hand.angle), Math.sin(hand.angle));
    uniforms.uHandScale.value = hand.scale;
    uniforms.uLook.value.set(
      brow,
      mix(a.smile, b.smile),
      mix(a.blinkRight, b.blinkRight),
      mix(a.blinkLeft, b.blinkLeft),
    );
    uniforms.uEyes.value.set(
      mix(a.glanceX, b.glanceX),
      mix(a.glanceY, b.glanceY),
      mix(a.glisten, b.glisten),
    );
    pass.render();
  };

  const loop = ctx.loop({
    hz: HZ,
    update(dt) {
      // The show starts once the face is on show, so its opening salute isn't spent compiling.
      if (frames === 0 || paused) return;
      advance(dt);
    },
    render(alpha) {
      if (!r3d.ready) return;
      draw(paused ? 1 : alpha);
      frames++;
    },
  });
  loop.start();

  ctx.onResize((f) => {
    frame = f;
    r3d.resize(f);
    pass.setSphere(sphereOf(f));
    fit(f);
  });

  const setHeld = (on: boolean) => {
    held = on;
    show.setHold(on);
  };

  let resets = 0;
  const state = () => {
    const p = show.pose;
    return {
      ready: r3d.ready,
      frames,
      time: show.time,
      stage: show.stage,
      kind: show.kind,
      bearing: p.bearing / DEG,
      pitch: p.pitch / DEG,
      roll: p.roll / DEG,
      raise: p.raise,
      brow: p.brow,
      smile: p.smile,
      blink: [p.blinkRight, p.blinkLeft],
      glance: [p.glanceX, p.glanceY],
      glisten: p.glisten,
      stats: { ...show.stats },
      longestWait: Math.max(...show.waits()),
      colour,
      held,
      resets,
      paused,
    };
  };

  // Always there: e2e tests read it, and it holds nothing secret.
  const debugKey = "__salute";
  Object.defineProperty(window, debugKey, {
    configurable: true,
    value: {
      state,
      /** Run the show on by `seconds` (at most an hour a call) without drawing. */
      skip(seconds: number) {
        const n = Math.round(Math.min(MAX_SKIP, Math.max(0, seconds)) * HZ);
        for (let i = 0; i < n; i++) advance(1 / HZ);
        return state();
      },
      /**
       * Run the show on until it is in `stage` (of a stop of `kind`, if given) and `into` seconds
       * through it, or for `limit` seconds at most. Returns whether it got there.
       */
      seek(stage: string, kind?: string, into = 0, limit = 600) {
        let since = -1;
        for (let i = 0; i < limit * HZ; i++) {
          advance(1 / HZ);
          const there = show.stage === stage && (kind === undefined || show.kind === kind);
          since = there ? since + 1 : -1;
          if (there && since >= into * HZ) return true;
        }
        return false;
      },
      /** Make the next stop one of this kind (floor, across, under or sweep), at a bearing in degrees. */
      cue(kind: string, bearing?: number) {
        if (!(CUES as readonly string[]).includes(kind)) return;
        show.cue(kind as Cue, bearing === undefined ? undefined : bearing * DEG);
      },
      /** Hold the salute for good, or go back to the show, as the admin commands do. */
      hold(on: boolean) {
        setHeld(on);
      },
      /** Stop the show where it is, or let it run again. */
      pause(on: boolean) {
        paused = on;
      },
      /**
       * Milliseconds to draw the feed once, measured over `n` draws that each wait for the GPU,
       * for checking the frame budget.
       */
      bench(n = 30) {
        if (!r3d.ready) return null;
        const gl = r3d.renderer.getContext();
        const px = new Uint8Array(4);
        for (let i = 0; i < 3; i++) {
          pass.render();
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        }
        const t0 = performance.now();
        for (let i = 0; i < n; i++) {
          pass.render();
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        }
        return (performance.now() - t0) / n;
      },
    },
  });

  return {
    reset() {
      // The show keeps running: only put back what admin or a resize may have changed.
      resets++;
      show.setPace(paceOf(ctx.options.pace));
      show.setHold(held);
      const wanted = colourOf(ctx.options.colour);
      if (wanted !== colour) {
        colour = wanted;
        paint(colour);
      }
      fit(frame);
    },
    command(name) {
      if (name === "bow") show.cue("under");
      else if (name === "turn") show.cue("sweep");
      else if (name === "hold" || name === "release") setHeld(name === "hold");
    },
    status: () => ({
      stage: show.stage,
      facing: `${Math.round(show.pose.bearing / DEG)}°`,
      salutes: show.stats.salutes,
      colour,
      held,
    }),
    dispose() {
      loop.stop();
      Reflect.deleteProperty(window, debugKey);
      r3d.dispose();
    },
  };
};
