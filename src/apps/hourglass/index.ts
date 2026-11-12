/**
 * Hourglass: the ball is a giant hourglass whose sand runs out at a time of day.
 *
 * - time.ts      when the sand runs, from the display's clock; the countdown's wording
 * - levels.ts    how high the sand stands above and below the collar, by volume
 * - streams.ts   the streams down the glass and the mounds where they land
 * - rings.ts     where the lettering goes; text.ts what it says and how it is set round a ring
 * - lettering.ts the rings' canvases; shader.ts the picture itself
 *
 * Every frame is worked out from the time alone, so nothing is kept between frames and a reload,
 * an idle reset or a later start by a picker all land on the same picture.
 */
import { Color, Matrix3, Vector2, Vector3, Vector4 } from "three";
import { createRenderer3D } from "../../core/renderer3d";
import { DEG, direction, rotationAbout, WHOLE_SPHERE, wrapLon } from "../../core/sphere";
import { createSurfacePass, toMatrix3 } from "../../core/sphere3d";
import type { AppContext, AppInstance, FrameInfo } from "../../core/types";
import { driftOf, type Fall, fallAt, fallOf, isStreams, TIME_WRAP_S, twistOf } from "./fall";
import { createLettering } from "./lettering";
import {
  COLLAR,
  COLLAR_LAT,
  EMPTY,
  type Levels,
  levelsAt,
  sandVolume,
  startLatitude,
} from "./levels";
import { type SandId, SANDS } from "./manifest";
import { hourglassGlsl, MOUND_HEIGHT } from "./shader";
import { flowingCount, type Stream, STREAMS, streamsAt } from "./streams";
import { linesOf, timeLine } from "./text";
import {
  clockText,
  countdownTemplate,
  countdownText,
  type Ink,
  inkAt,
  type Phase,
  phaseAt,
  scheduleOf,
} from "./time";

const DEBUG_KEY = "__hourglass";
const SAND_COLOURS: Record<SandId, string> = {
  golden: "#dba94e",
  white: "#cfc8b8",
  rose: "#d9949c",
  blue: "#7aa9d9",
};
/** The lamp that lights the sand goes once round the ball in this long, seconds. */
const LAMP_TURN_S = 1500;
const LAMP_LAT = 28 * DEG;
/** The glass rolls over about a level axis at this longitude, radians. */
const ROLL_LON = 0.6;
/** Software renderers (tests, a machine without a GPU) draw the feed at this fraction... */
const SOFTWARE_SCALE = 0.5;
/** ...and at most this often, ms, to leave the page time for everything else. */
const SOFTWARE_FRAME_MS = 200;

const isSoftware = (gl: WebGLRenderingContext | WebGL2RenderingContext): boolean => {
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  return /swiftshader|llvmpipe|softpipe|software/i.test(name);
};

const smoothstep = (a: number, b: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Everything the picture shows at one instant. */
interface Moment {
  phase: Phase;
  levels: Levels;
  streams: Stream[];
  fall: Fall;
  ink: Ink;
  /** What the collar and the pole's ring say. */
  time: string;
  template: string;
}

export const mount = (ctx: AppContext): AppInstance => {
  let frame = ctx.frame;
  const sphere = () => frame.sphere ?? WHOLE_SPHERE;
  const schedule = scheduleOf(ctx.options);
  const lines = linesOf(ctx.options);
  const sand = SANDS.find((s) => s === ctx.options.sand) ?? "golden";
  const fall = fallOf(ctx.variant);

  const r3d = createRenderer3D(ctx.root, frame, { antialias: false });
  const software = isSoftware(r3d.renderer.getContext());
  const scale = software ? SOFTWARE_SCALE : 1;
  const fit = (f: FrameInfo) => {
    r3d.resize(f);
    if (!software) return;
    r3d.renderer.setPixelRatio(f.pixelRatio * SOFTWARE_SCALE);
    r3d.renderer.setSize(f.width, f.height, false);
  };
  fit(frame);

  const lettering = createLettering(r3d.renderer.capabilities.maxTextureSize);
  const uniforms = {
    uPose: { value: new Matrix3() },
    uLevel: { value: new Vector2(EMPTY, EMPTY) },
    uSand: { value: new Color(SAND_COLOURS[sand]) },
    uLight: { value: new Vector3(0, 1, 0) },
    uLamp: { value: new Vector2() },
    uTime: { value: 0 },
    uStream: { value: Array.from({ length: STREAMS }, () => new Vector4()) },
    uMound: { value: Array.from({ length: STREAMS }, () => new Vector3(0, 0, 0.1)) },
    uMoundMean: { value: 0 },
    uFall: { value: new Vector3() },
    ...lettering.uniforms,
  };
  const pass = createSurfacePass(r3d, frame, { fragment: hourglassGlsl(fall), uniforms });

  const streamed = isStreams(fall);
  const twist = twistOf(fall);
  let volume = sandVolume(startLatitude(sphere()));
  const place = () => {
    const s = sphere();
    volume = sandVolume(startLatitude(s));
    const rows = (frame.height * frame.pixelRatio * scale) / (s.cover.top - s.cover.bottom);
    lettering.place(s, rows);
  };
  place();
  lettering.say("message", lines.message);

  /** Set by the debug hook: ms added to the clock, or a moment the clock is held at. */
  let offset = 0;
  let held: number | null = null;
  const now = () => held ?? ctx.clock.now() + offset;

  const momentAt = (at: number): Moment => {
    const phase = phaseAt(at, schedule);
    return {
      phase,
      levels: levelsAt(volume, phase.left, phase.turn, phase.running),
      streams: streamsAt(at, phase),
      fall: fallAt(at, phase),
      ink: inkAt(at, phase),
      time: timeLine(lines, phase.running, countdownText(phase.remainingMs)),
      template: phase.running ? countdownTemplate(phase.remainingMs) : "",
    };
  };

  const show = (at: number, m: Moment) => {
    const seconds = at / 1000;
    const { levels } = m;
    uniforms.uLevel.value.set(levels.upper, levels.lower);
    const axis = [Math.cos(ROLL_LON), 0, Math.sin(ROLL_LON)] as const;
    toMatrix3(rotationAbout(axis, levels.roll), uniforms.uPose.value);

    // Mounds flatten where the heap's edge is a small circle round the pole, and just under
    // the collar, where there is no room for them.
    const edge = levels.lower > EMPTY ? Math.sqrt(Math.max(0, 1 - levels.lower ** 2)) : 0;
    const room = smoothstep(0.08, 0.35, edge) * smoothstep(0, 0.06, -COLLAR - levels.lower);
    // A winding stream lands further round the ball the further down the heap's edge is.
    const reach = levels.lower > EMPTY ? -COLLAR_LAT - Math.asin(levels.lower) : 0;
    const drift = driftOf(fall, at);
    let mean = 0;
    m.streams.forEach((s, i) => {
      const lon = s.lon + drift;
      uniforms.uStream.value[i]!.set(wrapLon(lon), s.strength, s.head, s.tail);
      const height = streamed ? MOUND_HEIGHT * s.mound * room : 0;
      const width = 0.12 + 0.06 * s.slump;
      uniforms.uMound.value[i]!.set(wrapLon(lon + twist * reach), height, width);
      if (edge > 0) mean += (height * width * Math.sqrt(Math.PI)) / (2 * Math.PI * edge);
    });
    uniforms.uMoundMean.value = mean;
    uniforms.uFall.value.set(m.fall.remaining, m.fall.since, m.fall.on ? 1 : 0);

    const lampLon = wrapLon((seconds / LAMP_TURN_S) * 2 * Math.PI);
    const [lx, ly, lz] = direction(LAMP_LAT, lampLon);
    uniforms.uLight.value.set(lx, ly, lz);
    uniforms.uLamp.value.set(LAMP_LAT, lampLon);
    uniforms.uTime.value = seconds % TIME_WRAP_S;

    lettering.say("collar", m.time, m.template);
    lettering.say("pole", m.time, m.template);
    lettering.update(seconds, m.ink);
  };

  let drawn = 0;
  let lastDraw = Number.NEGATIVE_INFINITY;
  const loop = ctx.loop({
    render() {
      if (!r3d.ready) return;
      const t0 = performance.now();
      if (software && t0 - lastDraw < SOFTWARE_FRAME_MS) return;
      lastDraw = t0;
      const at = now();
      show(at, momentAt(at));
      pass.render();
      drawn++;
    },
  });
  loop.start();

  const offResize = ctx.onResize((f) => {
    frame = f;
    fit(f);
    pass.setSphere(sphere());
    place();
  });

  const stateOf = (m: Moment): "running" | "turning" | "resting" =>
    !m.phase.running ? "resting" : m.phase.turn < 1 ? "turning" : "running";

  if (ctx.debug) {
    Object.defineProperty(window, DEBUG_KEY, {
      configurable: true,
      value: {
        state: () => {
          const at = now();
          const m = momentAt(at);
          return {
            now: at,
            ready: r3d.ready,
            software,
            drawn,
            state: stateOf(m),
            left: m.phase.left,
            turn: m.phase.turn,
            remainingMs: m.phase.remainingMs,
            startMs: m.phase.startMs,
            endMs: m.phase.endMs,
            nextStartMs: m.phase.nextStartMs,
            upper: m.levels.upper,
            lower: m.levels.lower,
            roll: m.levels.roll,
            fall,
            feed: m.fall.feed,
            flowing: streamed ? flowingCount(m.streams) : 0,
            time: m.time,
            message: lines.message,
            ink: m.ink,
            rings: lettering.state(),
            sand,
            startLat: startLatitude(sphere()),
          };
        },
        /**
         * Set the clock to `ms`. It keeps running from there, or stays there with `hold`.
         * Anything but a number puts the real clock back.
         */
        setNow: (ms?: number | null, hold = false) => {
          const set = typeof ms === "number" && Number.isFinite(ms);
          offset = set ? ms - ctx.clock.now() : 0;
          held = set && hold ? ms : null;
        },
      },
    });
  }

  return {
    // The picture follows the clock, so there is nothing to put back.
    reset() {},
    attract() {},
    status: () => {
      const m = momentAt(now());
      return {
        state: stateOf(m),
        above: `${Math.round(m.phase.left * 100)}%`,
        ends: clockText(schedule.end),
        shows: m.time,
      };
    },
    dispose() {
      loop.stop();
      offResize();
      if (ctx.debug) delete (window as unknown as Record<string, unknown>)[DEBUG_KEY];
      lettering.dispose();
      r3d.dispose();
    },
  };
};
