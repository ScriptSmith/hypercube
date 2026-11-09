/**
 * The screen above a bank. It flies nothing of its own: it shows the race.
 *
 * - The lower third has one progress column per lane, directly above that lane's touch frame
 *   (the screen spans the bank exactly). A column fills as its glider advances, marks crashes
 *   and lights up at the finish; placings show at the top of the columns.
 * - The upper two-thirds is a pack view of the shared course with every glider in its colour.
 *   It follows the pack and zooms out (down to half size) to keep as many gliders in view as it
 *   can; the rest appear as arrows at its edges. Positions are drawn 150 ms in the past and
 *   interpolated between the 10 Hz reports.
 * - It is the leader while it is present: it runs the bank's lobby and races (lobby.ts,
 *   heats.ts), works out placings and sends `pack` (board.ts).
 * - In attract the touch frames' faded bots race on the clock's cadence, and the screen shows
 *   them; they go the moment someone joins. With no touch frames at all it races demo bots of its
 *   own, so it always shows a race.
 * - In a lobby it shows the seconds to the start and an arrow over every lane still free.
 */
import type { AppContext, AppInstance, FrameInfo } from "../../core/types";
import { activeVenue } from "../../core/venue";
import { type Atlas, buildAtlas } from "./art";
import { type Known, STALE_MS } from "./board";
import { ADULT, COURSE_H, type FlapConfig, STANDARD } from "./config";
import { buildCourse, type Course } from "./course";
import {
  createFlight,
  distanceOf,
  flap,
  type Flight,
  launch,
  type Mode,
  resetFlight,
  type Rules,
  stepFlight,
} from "./flight";
import { createGfx, rgb, type Rgb, WHITE } from "./gl";
import { columnSpan } from "./layout";
import { createHost } from "./host";
import { createLabel, createNumeral, type Label, type Numeral, placeColor } from "./numerals";
import { stepPackCam } from "./packcam";
import { createPilot, laneBias, type Pilot, SKILLS } from "./pilot";
import type { LocalPhase, Plan } from "./plan";
import { angleFor, drawFlyer, drawWorld, poseFor, SKY_DARK, type Viewport } from "./scene";
import { type Ctrl, type Fly, laneId, MAX_SLOTS } from "./wire";

/** Reports are drawn this far in the past, so there is always a newer one to move towards. */
const DELAY_MS = 150;
const SAMPLES = 8;
const MAX_CRASHES = 12;
/** Without a report from any touch frame for this long, the screen races demo bots. */
const DEMO_AFTER_MS = 3000;
/** Frames in the demo race when the screen doesn't know how many it serves: a bank of pairs. */
const demoFrames = () => Math.max(1, Math.floor(activeVenue().bankCount / 2));
const MAX_COLUMNS = 64;
const HOOK_MS = 500;
/** The lobby's ring of dots, as a fraction of the pack view's height. */
const LOBBY_RING = 0.16;

interface Sample {
  t: number;
  d: number;
  h: number;
  flap: boolean;
  mode: Mode;
}

interface Column {
  id: number;
  pos: number;
  slot: number;
  n: number;
  color: string;
  rgb: Rgb;
  rings: number;
  adult: boolean;
  ctrl: Ctrl;
  samples: Sample[];
  crashes: number[];
  lastMode: Mode;
  /** Local ms of the last flap, for the wing beat. */
  flapAt: number;
  heard: number;
  /** Shown level 0 to 1, eased. */
  fill: number;
  /** Demo bot, when the screen races on its own. */
  demo: { flight: Flight; pilot: Pilot } | null;
}

export const mountScreen = (ctx: AppContext, cfg: FlapConfig): AppInstance => {
  const palette = ctx.ui.palette;
  const rules: Rules = { crash: cfg.crash, base: cfg.base, race: cfg.race };
  const seedRng = ctx.rng();
  const columns = new Map<number, Column>();
  let frame: FrameInfo = ctx.frame;
  let atlas: Atlas | null = null;
  let course: Course | null = null;
  /** Touch frames heard from: their lane count and when. */
  const frames = new Map<number, { n: number; heard: number }>();
  let lastHeard = -Infinity;
  let demo = false;
  let lastHook = -Infinity;
  let errors = 0;
  let cam = { x: -400, zoom: 1 };
  let lastDraw = performance.now();

  const gfx = createGfx(ctx.root, 0, (msg) => {
    errors++;
    console.error(msg);
  });
  const hud = document.createElement("div");
  hud.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:1;overflow:hidden;";
  ctx.root.append(hud);

  const colorAt = (index: number) =>
    palette.players[index % palette.players.length] ?? palette.accent;

  const columnFor = (pos: number, slot: number, n: number, adult: boolean): Column | null => {
    const id = laneId(pos, slot);
    let c = columns.get(id);
    if (!c) {
      if (columns.size >= MAX_COLUMNS * MAX_SLOTS) return null;
      const index = pos * n + slot;
      const color = colorAt(index);
      c = {
        id,
        pos,
        slot,
        n,
        color,
        rgb: rgb(color),
        rings: Math.floor(index / palette.players.length),
        adult,
        ctrl: "attract",
        samples: [],
        crashes: [],
        lastMode: "waiting",
        flapAt: -Infinity,
        heard: performance.now(),
        fill: 0,
        demo: null,
      };
      columns.set(id, c);
    }
    if (c.n !== n) {
      const index = pos * n + slot;
      c.n = n;
      c.color = colorAt(index);
      c.rgb = rgb(c.color);
      c.rings = Math.floor(index / palette.players.length);
    }
    c.adult = adult;
    return c;
  };

  const push = (c: Column, s: Sample) => {
    if (s.mode === "tumbling" && c.lastMode !== "tumbling" && c.crashes.length < MAX_CRASHES)
      c.crashes.push(s.d);
    if (s.mode === "out" && c.lastMode !== "out" && c.crashes.length < MAX_CRASHES)
      c.crashes.push(s.d);
    if (s.mode === "waiting" && c.lastMode !== "waiting") c.crashes.length = 0;
    if (s.flap) c.flapAt = performance.now();
    c.lastMode = s.mode;
    c.samples.push(s);
    if (c.samples.length > SAMPLES) c.samples.shift();
    c.heard = performance.now();
  };

  /** Smoothed age of `fly` reports on arrival: the relay latency through the hub. */
  let latency = 0;

  const onFly = (fly: Fly, from: string) => {
    if (frames.has(fly.pos) || frames.size < MAX_COLUMNS)
      frames.set(fly.pos, { n: fly.n, heard: performance.now() });
    if (fly.k !== k) return;
    lastHeard = performance.now();
    if (ctx.clock.synced && from !== ctx.net.self) {
      const age = Math.max(0, ctx.clock.now() - fly.t);
      if (age < 5000) latency += (age - latency) * 0.05;
    }
    if (demo) stopDemo();
    let human = false;
    for (const r of fly.lanes) {
      const c = columnFor(fly.pos, r.slot, fly.n, r.adult);
      if (!c) continue;
      c.ctrl = r.ctrl;
      push(c, { t: fly.t, d: r.d, h: r.h, flap: r.flap, mode: r.mode });
      if (r.ctrl === "human") human = true;
    }
    if (human) ctx.idle.poke();
  };

  const host = createHost({
    net: ctx.net,
    now: () => ctx.clock.now(),
    local: () => performance.now(),
    cfg,
    onFly,
    onRace: (p) => newRace(p),
    onPlay: (play) => {
      if (play === "bank") dropBots();
    },
  });
  const { board, heats } = host;
  let plan: Plan = host.plan;
  let phase: LocalPhase = host.phase;
  let k = -1;
  const raceT = () => host.raceT();

  // ---- Demo race ------------------------------------------------------------------------------

  const touchFrames = () => ctx.net.peers().filter((p) => p.role !== "screen").length;

  const startDemo = () => {
    demo = true;
    for (const c of columns.values()) if (!c.demo) columns.delete(c.id);
    const frames = ctx.setup.count > 1 ? ctx.setup.count : demoFrames();
    const n = cfg.variant === "pads" ? 2 : 1;
    for (let pos = 0; pos < Math.min(frames, MAX_COLUMNS); pos++) {
      for (let slot = 0; slot < n; slot++) {
        const c = columnFor(pos, slot, n, n === 2 && slot === 1);
        if (!c) continue;
        c.demo = {
          flight: createFlight(),
          pilot: createPilot(
            ctx.rng(`treetop:demo:${pos}:${slot}`),
            SKILLS.attract,
            laneBias(pos * n + slot),
          ),
        };
        if (phase === "racing")
          launch(c.demo.flight, c.adult ? ADULT : STANDARD, rules, raceT() / 1000);
      }
    }
  };

  const stopDemo = () => {
    demo = false;
    for (const c of columns.values()) if (c.demo) columns.delete(c.id);
  };

  let demoLast = -Infinity;

  const stepDemo = (dt: number) => {
    if (!course) return;
    const now = ctx.clock.now();
    for (const c of columns.values()) {
      const d = c.demo;
      if (!d) continue;
      const body = c.adult ? ADULT : STANDARD;
      if (phase === "racing") {
        if (d.pilot.step(d.flight, course, body, dt)) flap(d.flight, body);
        stepFlight(d.flight, dt, course, body, rules, raceT() / 1000);
      } else if (phase === "countdown") {
        stepFlight(d.flight, dt, course, body, rules, 0);
      }
    }
    // Feed the demo through the same path as real reports, a tenth of a second apart.
    if (now - demoLast < 100) return;
    demoLast = now;
    const byPos = new Map<number, Column[]>();
    for (const c of columns.values())
      if (c.demo) byPos.set(c.pos, [...(byPos.get(c.pos) ?? []), c]);
    for (const [pos, list] of byPos) {
      board.own({
        k,
        pos,
        count: byPos.size,
        n: list.length,
        t: now,
        lanes: list.map((c) => {
          const f = c.demo!.flight;
          const r = {
            slot: c.slot,
            d: distanceOf(f),
            h: f.y,
            mode: f.mode,
            flap: f.flapped,
            ctrl: "attract" as const,
            adult: c.adult,
            gates: f.gates,
            fin: f.fin,
          };
          f.flapped = false;
          push(c, { t: now, d: r.d, h: r.h, flap: r.flap, mode: r.mode });
          return r;
        }),
      });
    }
  };

  // ---- Races ---------------------------------------------------------------------------------

  const newRace = (p: Plan) => {
    k = p.k;
    course = buildCourse(seedRng, p.label, cfg);
    for (const c of columns.values()) {
      c.crashes.length = 0;
      c.samples.length = 0;
      c.fill = 0;
      if (c.demo) {
        resetFlight(c.demo.flight);
        c.demo.pilot.reset();
      }
    }
  };

  // ---- Layout --------------------------------------------------------------------------------

  /** Venue px. */
  const geometry = () => {
    const W = frame.width / frame.unit;
    const H = frame.height / frame.unit;
    const packH = Math.round(H * (2 / 3));
    return { W, H, packH, colTop: packH + 40, colBottom: H - 70 };
  };

  const numerals: Numeral[] = [];
  let countdown: Numeral | null = null;
  let timer: Numeral | null = null;
  let lobbyLabel: Label | null = null;

  const resize = (f: FrameInfo) => {
    frame = f;
    const kpx = f.unit * f.pixelRatio;
    gfx.resize(f.width * f.pixelRatio, f.height * f.pixelRatio);
    const { packH } = geometry();
    const scale = (packH / COURSE_H) * kpx;
    if (!atlas || Math.abs(atlas.scale - scale) / scale > 0.1) {
      atlas = buildAtlas(scale, cfg.flyer);
      gfx.setAtlas(atlas.canvas);
    }
    countdown?.dispose();
    countdown = createNumeral(
      hud,
      { x: f.width / 2, y: (packH * f.unit) / 2, size: packH * f.unit * 0.42 },
      "count",
    );
    timer?.dispose();
    timer = createNumeral(
      hud,
      { x: f.width / 2, y: (packH * f.unit) / 2, size: packH * f.unit * 0.17 },
      "plain",
    );
    lobbyLabel?.dispose();
    lobbyLabel = createLabel(hud, {
      x: f.width / 2,
      y: packH * f.unit * (0.5 - LOBBY_RING - 0.07),
      size: packH * f.unit * 0.055,
    });
  };

  const over = () => phase === "results" || phase === "lobby";

  /** Someone joined: the attract bots leave at once. */
  const dropBots = () => {
    for (const [id, c] of columns) if (c.ctrl === "attract" && !c.demo) columns.delete(id);
  };

  const columnCount = () => {
    let n = Math.max(1, ctx.setup.count);
    for (const c of columns.values()) n = Math.max(n, c.pos + 1);
    if (demo && ctx.setup.count <= 1) n = Math.max(n, demoFrames());
    return Math.min(MAX_COLUMNS, n);
  };

  // ---- Interpolation and camera --------------------------------------------------------------

  const sampleAt = (c: Column, t: number): { d: number; h: number } | null => {
    const s = c.samples;
    if (s.length === 0) return null;
    if (t <= s[0]!.t) return { d: s[0]!.d, h: s[0]!.h };
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1]!;
      const b = s[i]!;
      if (t <= b.t) {
        // A jump back (a new race) shouldn't sweep across the course.
        if (b.d < a.d - 400) return { d: b.d, h: b.h };
        const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
        return { d: a.d + (b.d - a.d) * f, h: a.h + (b.h - a.h) * f };
      }
    }
    const last = s[s.length - 1]!;
    return { d: last.d, h: last.h };
  };

  interface Shown {
    c: Column;
    d: number;
    h: number;
    alpha: number;
    mode: Mode;
  }

  const shown = (local: number): Shown[] => {
    const t = ctx.clock.now() - DELAY_MS;
    const out: Shown[] = [];
    for (const c of columns.values()) {
      const age = local - c.heard;
      if (age > STALE_MS * 2) continue;
      const p = sampleAt(c, t);
      if (!p) continue;
      const fade = age < STALE_MS ? 1 : 1 - (age - STALE_MS) / STALE_MS;
      const known = board.lanes.get(c.id);
      const attract = known?.ctrl === "attract";
      out.push({
        c,
        d: p.d,
        h: p.h,
        alpha: Math.max(0, fade) * (attract ? 0.55 : 1),
        mode: c.lastMode,
      });
    }
    return out;
  };

  /** The span of course to show: the window holding the most gliders (people count triple). */
  /** Before a bank race, the pack view waits on the start line with the course ahead. */
  const atStart = () => plan.play === "bank" && (phase === "lobby" || phase === "countdown");

  const frameCamera = (list: readonly Shown[], viewW1: number, dt: number) => {
    const gliders = list.map((s) => ({
      d: s.d,
      weight: board.lanes.get(s.c.id)?.ctrl === "human" ? 3 : 1,
    }));
    stepPackCam(cam, gliders, viewW1, atStart(), dt);
  };

  // ---- Drawing -------------------------------------------------------------------------------

  /** Column geometry in venue px: the track runs from `top` (the finish) down to `bottom`. */
  const columnBox = (c: Column, count: number) => {
    const { W, colTop, colBottom } = geometry();
    const span = columnSpan(c.pos, c.slot, c.n, count);
    const x0 = span.x0 * W;
    const x1 = span.x1 * W;
    const cw = x1 - x0;
    return {
      cx: (x0 + x1) / 2,
      cw,
      bw: Math.min(cw * 0.46, 180),
      top: colTop + 250,
      bottom: colBottom,
    };
  };

  const drawColumns = (list: readonly Shown[], local: number) => {
    if (!atlas || !course) return;
    const r = atlas.regions;
    const kpx = frame.unit * frame.pixelRatio;
    const { W, H, packH, colTop, colBottom } = geometry();
    const count = columnCount();
    const byId = new Map(list.map((s) => [s.c.id, s]));
    // The ground band between the race above and the columns.
    gfx.sprite(r.white, 0, packH * kpx, W * kpx, (H - packH) * kpx, [0.03, 0.045, 0.1], 1, 0, 0, 0);
    gfx.sprite(r.grad, 0, packH * kpx, W * kpx, 140 * kpx, [0.2, 0.15, 0.32], 0.7, 0, 0, 0);
    for (let i = 1; i < count; i++) {
      const x = (i / count) * W * kpx;
      gfx.sprite(
        r.white,
        x,
        colTop * kpx,
        4 * kpx,
        (colBottom - colTop) * kpx,
        WHITE,
        0.07,
        0,
        0.5,
        0,
      );
    }
    const places = board.places;
    const results = over();
    const empty: Rgb = [0.11, 0.14, 0.24];
    for (const c of columns.values()) {
      const box = columnBox(c, count);
      const cx = box.cx * kpx;
      const bw = box.bw * kpx;
      const top = box.top * kpx;
      const bottom = box.bottom * kpx;
      const len = bottom - top;
      const s = byId.get(c.id);
      const alpha = s?.alpha ?? 0.2;
      const known = board.lanes.get(c.id);
      const target = Math.min(1, Math.max(0, (s?.d ?? 0) / course.length));
      c.fill += (target - c.fill) * 0.2;
      if (target < c.fill - 0.3) c.fill = target;
      const fin = known?.fin != null;
      const place = places?.get(c.id) ?? (fin ? board.place(c.id) : null);
      // Light behind the podium.
      if (results && place !== null && place <= 3) {
        const glow = rgb(placeColor(place, palette.foreground));
        const pulse = 0.55 + 0.25 * Math.sin(local / 300);
        gfx.sprite(
          r.glow,
          cx,
          top + len * 0.4,
          box.cw * 1.1 * kpx,
          len * 1.6,
          glow,
          pulse * (place === 1 ? 1 : 0.6),
          0,
          0.5,
          0.5,
          true,
        );
      }
      // The track, tinted with the lane's colour so an empty column still says whose it is.
      gfx.sprite(r.white, cx, top, bw, len, empty, 0.95, 0, 0.5, 0);
      gfx.sprite(r.dot, cx, top, bw, bw, empty, 0.95);
      gfx.sprite(r.dot, cx, bottom, bw, bw, empty, 0.95);
      gfx.sprite(r.white, cx, top, bw, len, c.rgb, 0.1 * Math.max(alpha, 0.5), 0, 0.5, 0);
      const out = c.lastMode === "out";
      const fillH = len * c.fill;
      const fillA = alpha * (out ? 0.35 : 1);
      if (fillH > 0) {
        gfx.sprite(r.white, cx, bottom, bw * 0.8, fillH, c.rgb, fillA, 0, 0.5, 1);
        gfx.sprite(
          r.grad,
          cx,
          bottom - fillH,
          bw * 0.8,
          Math.min(fillH, 200 * kpx),
          WHITE,
          0.4 * fillA,
          0,
          0.5,
          0,
          true,
        );
      }
      gfx.sprite(r.dot, cx, bottom, bw * 0.8, bw * 0.8, c.rgb, Math.max(fillA, 0.4));
      // A notch for every gate, lit once passed.
      const d = s?.d ?? 0;
      for (const g of course.gates) {
        const at = g.x + g.w / 2;
        const y = bottom - len * (at / course.length);
        const lit = d > at;
        gfx.sprite(
          r.white,
          cx,
          y,
          bw * (lit ? 0.5 : 0.36),
          7 * kpx,
          lit ? WHITE : [0.5, 0.56, 0.75],
          lit ? 0.55 * alpha : 0.5,
          0,
          0.5,
          0.5,
        );
      }
      for (const cd of c.crashes) {
        const y = bottom - len * Math.min(1, cd / course.length);
        gfx.sprite(r.white, cx, y, bw * 1.3, 12 * kpx, [1, 0.42, 0.33], 0.9 * alpha, 0, 0.5, 0.5);
      }
      // Finish: a star that lights when the glider crosses.
      const starSize = Math.min(bw * 1.5, 190 * kpx);
      if (fin)
        gfx.sprite(
          r.glow,
          cx,
          top - 6 * kpx,
          starSize * 2.4,
          starSize * 2.4,
          [1, 0.8, 0.2],
          0.6,
          0,
          0.5,
          0.5,
          true,
        );
      gfx.sprite(
        r.star,
        cx,
        top - 6 * kpx,
        starSize,
        starSize,
        fin ? [1, 0.82, 0.25] : [0.3, 0.33, 0.46],
        fin ? 1 : 0.8,
        fin ? local / 900 : 0,
      );
      // The glider riding the top of its fill, climbing.
      const fy = bottom - fillH;
      const flapAge = (local - c.flapAt) / 1000;
      const size = Math.min(1.25, (box.cw / 420) * 1.15);
      drawFlyer(
        gfx,
        atlas,
        { x: 0, y: 0, w: W * kpx, h: H * kpx, s: kpx, camX: 0, top: 0 },
        box.cx,
        fy / kpx - 30 * size,
        {
          color: c.rgb,
          alpha: out ? alpha * 0.5 : alpha,
          pose: out ? 2 : poseFor(flapAge, 0),
          angle: out ? 2.6 : -0.7,
          size,
          rings: c.rings,
          glow: alpha > 0.8 ? 0.45 : 0.15,
        },
      );
    }
  };

  const updateNumerals = (now: number) => {
    const left = phase === "countdown" ? Math.max(1, Math.ceil((plan.start - now) / 1000)) : 0;
    countdown?.set(left > 0 ? String(left) : null, palette.foreground);
    const lobby = phase === "lobby" && plan.play === "bank";
    const wait = Math.max(0, Math.ceil((plan.next - now) / 1000));
    timer?.set(lobby ? String(wait) : null, palette.foreground, 0.95);
    lobbyLabel?.set(lobby ? "Next race" : null, palette.foreground, 0.85);
    const { W, colTop } = geometry();
    const count = columnCount();
    const places = board.places;
    const results = over();
    let i = 0;
    for (const c of columns.values()) {
      const known = board.lanes.get(c.id);
      const place = places?.get(c.id) ?? (known?.fin != null || results ? board.place(c.id) : null);
      if (i >= numerals.length)
        numerals.push(createNumeral(hud, { x: 0, y: 0, size: 10 }, "place"));
      const n = numerals[i++]!;
      const span = columnSpan(c.pos, c.slot, c.n, count);
      const cw = (span.x1 - span.x0) * W;
      const u = frame.unit;
      n.move({
        x: ((span.x0 + span.x1) / 2) * W * u,
        y: (colTop + 80) * u,
        size: Math.min(cw * 0.6, 200) * u,
      });
      if (place !== null && (results || known?.fin != null))
        n.set(String(place), placeColor(place, palette.foreground));
      else n.set(null, c.color);
    }
    for (; i < numerals.length; i++) numerals[i]!.set(null, palette.foreground);
  };

  /** The lobby's seconds to the start, as a ring of dots that empties. */
  const drawLobbyRing = (vp: Viewport, kpx: number) => {
    if (!atlas) return;
    const r = atlas.regions;
    const total = Math.max(1, plan.next - plan.from);
    const left = Math.max(0, Math.min(1, (plan.next - ctx.clock.now()) / total));
    const dots = 16;
    const lit = Math.ceil(left * dots);
    const radius = vp.h * LOBBY_RING;
    const cx = vp.w / 2;
    const cy = vp.h / 2;
    for (let i = 0; i < dots; i++) {
      const a = -Math.PI / 2 + (i / dots) * Math.PI * 2;
      const on = i < lit;
      const size = (on ? 70 : 50) * kpx;
      gfx.sprite(
        r.dot,
        cx + Math.cos(a) * radius,
        cy + Math.sin(a) * radius,
        size,
        size,
        on ? [1, 0.8, 0.2] : WHITE,
        on ? 0.9 : 0.25,
      );
    }
  };

  /** Before a race, an arrow over each lane still free points down at its touch frame. */
  const drawFree = (local: number) => {
    if (!atlas || plan.play !== "bank" || (phase !== "lobby" && phase !== "countdown")) return;
    const r = atlas.regions;
    const kpx = frame.unit * frame.pixelRatio;
    const { W, colTop, colBottom } = geometry();
    const count = columnCount();
    const joined = board.joined();
    const bob = Math.sin(local / 260) * 24;
    for (const [pos, f] of frames) {
      for (let slot = 0; slot < f.n; slot++) {
        const id = laneId(pos, slot);
        const c = columns.get(id);
        if (joined.has(id) || (c && local - c.heard < STALE_MS)) continue;
        const span = columnSpan(pos, slot, f.n, count);
        const cw = (span.x1 - span.x0) * W;
        const size = Math.min(cw * 0.5, 220);
        const x = ((span.x0 + span.x1) / 2) * W * kpx;
        const y = (colTop + (colBottom - colTop) * 0.6 + bob) * kpx;
        const color = rgb(colorAt(pos * f.n + slot));
        gfx.sprite(r.glow, x, y, size * 1.8 * kpx, size * 1.8 * kpx, color, 0.3, 0, 0.5, 0.5, true);
        gfx.sprite(r.arrow, x, y, size * kpx, size * kpx, color, 0.85, Math.PI / 2);
      }
    }
  };

  const draw = (local: number, dt: number) => {
    if (!atlas || !gfx.begin(SKY_DARK[0], SKY_DARK[1], SKY_DARK[2])) return;
    const r = atlas.regions;
    const kpx = frame.unit * frame.pixelRatio;
    const { W, packH } = geometry();
    const s1 = (packH / COURSE_H) * kpx;
    const list = shown(local);
    frameCamera(list, (W * kpx) / s1, dt);
    const s = s1 * cam.zoom;
    const vp: Viewport = {
      x: 0,
      y: 0,
      w: W * kpx,
      h: packH * kpx,
      s,
      camX: cam.x,
      top: packH * kpx - COURSE_H * s,
    };
    gfx.clip(vp.x, vp.y, vp.w, vp.h);
    const time = local / 1000;
    drawWorld(gfx, atlas, vp, course, { time, start: over() && !atStart() ? 0 : 1 });
    const left = vp.camX;
    const right = vp.camX + vp.w / s;
    const arrows: Shown[] = [];
    // Gliders behind first, people on top.
    const order = [...list].sort((a, b) => a.alpha - b.alpha);
    for (const g of order) {
      if (g.d < left - 60 || g.d > right + 60) {
        // Before a race, last race's gliders out on the course have nothing to point at.
        if (!atStart()) arrows.push(g);
        continue;
      }
      const flapAge = (local - g.c.flapAt) / 1000;
      const tumbling = g.mode === "tumbling" || g.mode === "out";
      const prev = g.c.samples.at(-2);
      const last = g.c.samples.at(-1);
      const vy =
        prev && last && last.t > prev.t ? ((last.h - prev.h) / (last.t - prev.t)) * 1000 : 0;
      // Gliders on the start line all hover at one height: fan them out so each one shows.
      const fan = g.mode === "waiting" ? (((g.c.pos * g.c.n + g.c.slot) % 7) - 3) * 120 : 0;
      drawFlyer(gfx, atlas, vp, g.d, g.h + fan, {
        color: g.c.rgb,
        alpha: g.alpha,
        pose: tumbling ? 1 : poseFor(flapAge, vy),
        angle: tumbling ? time * 9 : angleFor(vy),
        rings: g.c.rings,
        glow: g.alpha > 0.8 ? 0.5 : 0.2,
        size: g.c.adult ? 1.05 : 1,
      });
    }
    for (const g of arrows) {
      const leftSide = g.d < left;
      const x = leftSide ? 70 * kpx : vp.w - 70 * kpx;
      const y = Math.min(vp.h - 80 * kpx, Math.max(80 * kpx, vp.top + g.h * s));
      gfx.sprite(r.glow, x, y, 170 * kpx, 170 * kpx, g.c.rgb, 0.5 * g.alpha, 0, 0.5, 0.5, true);
      gfx.sprite(r.arrow, x, y, 110 * kpx, 110 * kpx, g.c.rgb, g.alpha, leftSide ? Math.PI : 0);
    }
    // Time left in the race, as a thin bar along the top.
    if (phase === "racing") {
      const frac = Math.max(0, 1 - raceT() / Math.max(1, plan.end - plan.start));
      gfx.sprite(
        r.white,
        vp.w / 2,
        26 * kpx,
        vp.w * 0.6 * frac,
        16 * kpx,
        [1, 0.8, 0.2],
        0.75,
        0,
        0.5,
        0.5,
      );
    }
    if (phase === "lobby" && plan.play === "bank") drawLobbyRing(vp, kpx);
    gfx.unclip();
    drawColumns(list, local);
    drawFree(local);
    gfx.end();
  };

  // ---- Loop ----------------------------------------------------------------------------------

  const loop = ctx.loop({
    hz: 60,
    update(dt) {
      const local = performance.now();
      host.tick();
      plan = host.plan;
      phase = host.phase;
      const bank = plan.play === "bank";
      if (!bank && !demo && touchFrames() === 0 && local - lastHeard > DEMO_AFTER_MS) startDemo();
      if (bank && demo) stopDemo();
      if (demo) {
        if (phase === "racing") {
          for (const c of columns.values()) {
            if (c.demo && c.demo.flight.mode === "waiting")
              launch(c.demo.flight, c.adult ? ADULT : STANDARD, rules, raceT() / 1000);
          }
        }
        stepDemo(dt);
      }
      for (const [id, c] of columns) if (!c.demo && local - c.heard > 10_000) columns.delete(id);
      for (const [p, f] of frames) if (local - f.heard > 10_000) frames.delete(p);
      if (local - lastHook >= HOOK_MS) {
        lastHook = local;
        hook(local);
      }
    },
    render() {
      const local = performance.now();
      const dt = Math.min(0.1, (local - lastDraw) / 1000);
      lastDraw = local;
      updateNumerals(ctx.clock.now());
      draw(local, dt);
    },
  });

  const hook = (local: number) => {
    const live = board.live();
    ctx.root.dataset.treetop = JSON.stringify({
      k,
      phase,
      play: plan.play,
      heat: heats.heat?.phase ?? null,
      racers: heats.heat?.lanes ?? [],
      leading: heats.leading,
      start: plan.start,
      hash: course?.hash ?? 0,
      label: course?.label ?? "",
      leader: board.leader(),
      demo,
      columns: columns.size,
      shown: shown(local).length,
      lanes: live.map((l: Known) => ({
        id: l.id,
        ctrl: l.ctrl,
        mode: l.mode,
        d: Math.round(l.d),
        fin: l.fin,
      })),
      places: board.places ? [...board.places.entries()] : null,
      latency: Math.round(latency),
      offset: Math.round(ctx.clock.now() - (performance.timeOrigin + performance.now())),
      synced: ctx.clock.synced,
    });
  };

  resize(frame);
  const offResize = ctx.onResize(resize);
  loop.start();

  return {
    reset() {
      cam = { x: -400, zoom: 1 };
    },
    status() {
      return {
        variant: cfg.variant,
        race: k,
        phase: plan.play === "bank" ? phase : "attract",
        humans: board
          .live()
          .filter((l) => l.ctrl === "human" && (l.mode === "flying" || l.mode === "tumbling"))
          .length,
        latency: Math.round(latency),
        ...(errors ? { gfxErrors: errors } : {}),
      };
    },
    dispose() {
      loop.stop();
      offResize();
      host.dispose();
      for (const n of numerals) n.dispose();
      countdown?.dispose();
      timer?.dispose();
      lobbyLabel?.dispose();
      frames.clear();
      columns.clear();
      gfx.dispose();
      hud.remove();
      atlas = null;
    },
  };
};
