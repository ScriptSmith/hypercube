/**
 * The screen above a bank: the loom. Each column's thread carries on up from the frame below
 * it to the heddle; above that the epicycle chain and the summed wave with the target's ghost;
 * at the top the cloth, a band woven per match. The screen is in charge: it takes every frame's
 * harmonics, eases the auto ones, judges the match and sends the beacon. With no frames below,
 * every harmonic is auto, so it runs the attract show by itself.
 *
 * Canvas2D on one canvas over the CSS background, at most 40 frames a second.
 */
import type { AppContext, AppInstance, FrameInfo, OptionValue } from "../../core/types";
import { createConductor, WEAVE_S } from "./conductor";
import { HZ, PERIOD_S, readConfig, TAU } from "./config";
import { type Box, createClothPainter, drawPicture, drawThread, wantedScale } from "./draw";
import { perFrame } from "./layout";
import { BEACON_MS, createInbox, sendBeacon, STALE_MS } from "./link";
import { beaconFrom } from "./mirror";
import { BACKGROUND, colourOf, GLOW, rgba } from "./palette";
import { peakOf, phaseDelta, type Term, wrapPhase } from "./series";
import { THREAD_W, threadOffset, turnAngle } from "./thread";
import { STATE_FLAG, unquantAmp, unquantPhase } from "./wire";

const RENDER_MS = 1000 / 40;
/** Shares of the screen's height: the cloth, the picture, and where the threads end. */
const CLOTH = { top: 0.02, bottom: 0.31 };
const PICTURE = { top: 0.335, bottom: 0.725 };
export const HEDDLE = 0.745;
/** A live harmonic's drawing follows its 20 Hz messages over about this long. */
const FOLLOW_S = 0.06;
const STEP = 10;

export const screenGeometry = (W: number, H: number) => ({
  cloth: { x: 0, y: H * CLOTH.top, width: W, height: H * (CLOTH.bottom - CLOTH.top) } as Box,
  picture: {
    x: W * 0.03,
    y: H * PICTURE.top,
    width: W * 0.94,
    height: H * (PICTURE.bottom - PICTURE.top),
  } as Box,
  heddle: H * HEDDLE,
});

export const mountScreen = (ctx: AppContext): AppInstance => {
  const config = readConfig(ctx.variant, ctx.options);
  let frame: FrameInfo = ctx.frame;
  const side = ctx.setup.side ?? 0;
  const inBank = ctx.setup.name === "bank";
  ctx.root.style.background = BACKGROUND;
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
  ctx.root.append(canvas);
  const g = canvas.getContext("2d");
  let k = 1;

  /** Touch frames on this screen's side. */
  const stations = () =>
    ctx.net.peers().filter((p) => p.role !== "screen" && (p.side ?? 0) === side);
  const columns = () => {
    const touch = stations();
    const m = Math.max(1, ...touch.map((p) => perFrame(p.kind)));
    const count = inBank ? Math.max(1, ctx.setup.count, ...touch.map((p) => p.pos + 1)) : 10;
    return Math.min(20, count * m);
  };
  const conductor = createConductor({
    n: columns(),
    variant: config.variant,
    rng: ctx.rng().fork("loom-screen"),
  });
  let shown: Term[] = conductor.values.map((v) => ({ ...v }));
  const now = () => performance.now();
  const inbox = createInbox(ctx.net, { side, frame: ctx.net.self }, now, (i, e) => {
    if (i >= conductor.n) return;
    if (e.f & STATE_FLAG.live) conductor.setLive(i, unquantAmp(e.a), unquantPhase(e.ph));
    else conductor.setAuto(i);
  });
  const painter = createClothPainter(160, 14, 6);
  let scale = 0;
  let pts = new Float64Array(2 * 512);
  let beaconAt = Number.NEGATIVE_INFINITY;
  let lastRender = 0;
  let lastStep = now();
  let disposed = false;

  const vw = () => frame.width / frame.unit;
  const vh = () => frame.height / frame.unit;
  const size = () => {
    const ratio = Math.min(frame.pixelRatio, 1.5);
    canvas.width = Math.max(1, Math.round(frame.width * ratio));
    canvas.height = Math.max(1, Math.round(frame.height * ratio));
    k = frame.unit * ratio;
  };
  size();

  const theta = () => turnAngle(ctx.clock.now(), PERIOD_S[config.speed]);

  /** Where each column's thread meets the screen's bottom edge, as shares of its width. */
  const edges = (th = theta()) => {
    const n = conductor.n;
    return shown.map((v, i) => ({
      k: i + 1,
      u: (i + 0.5) / n + threadOffset(i + 1, v.amp, v.phase, th, 0) / n,
    }));
  };

  const draw = () => {
    if (!g) return;
    const W = vw();
    const H = vh();
    const geo = screenGeometry(W, H);
    const n = conductor.n;
    const colW = W / n;
    const th = theta();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.setTransform(k, 0, 0, k, 0, 0);
    const line = 10;
    const colours = Array.from({ length: n }, (_, i) => colourOf(i + 1));
    const weaving = conductor.mode === "weave";
    const glow =
      conductor.mode === "weave"
        ? 1
        : conductor.mode === "rest"
          ? Math.max(0, 1 - conductor.modeT)
          : 0;

    painter.draw(
      g,
      geo.cloth,
      conductor.cloth.bands,
      colours,
      weaving ? Math.min(1, conductor.modeT / (WEAVE_S * 0.8)) : 1,
      geo.cloth.height / 8,
      line,
    );

    const t = conductor.target();
    drawPicture(
      g,
      geo.picture,
      {
        values: shown,
        colours,
        live: conductor.live,
        target: t,
        theta: th,
        fill: conductor.fill,
        glow,
        title: t?.title ?? null,
      },
      scale,
      line,
      150,
    );

    // The threads, from the bottom edge (carrying on from the frames below) up to the heddle.
    const need = 2 * (Math.ceil(H / STEP) + 4);
    if (pts.length < need) pts = new Float64Array(need);
    for (let i = 0; i < n; i++) {
      const v = shown[i]!;
      const cx = (i + 0.5) * colW;
      let c = 0;
      for (let y = H; ; y -= STEP) {
        const yy = Math.max(geo.heddle, y);
        const h = (H - yy) / colW;
        pts[2 * c] = cx + threadOffset(i + 1, v.amp, v.phase, th, h) * colW;
        pts[2 * c + 1] = yy;
        c++;
        if (yy <= geo.heddle) break;
      }
      const w = THREAD_W * colW * (1 + 0.6 * glow);
      drawThread(g, pts, c, colours[i]!, w, conductor.live[i] ? 1 : 0.6);
      const bx = pts[2 * (c - 1)]!;
      g.beginPath();
      g.arc(bx, geo.heddle, w * 1.8, 0, TAU);
      g.fillStyle = conductor.ok[i] ? GLOW : colours[i]!;
      g.fill();
      if (conductor.ok[i]) {
        g.strokeStyle = rgba(GLOW, 0.35);
        g.lineWidth = w;
        g.beginPath();
        g.arc(bx, geo.heddle, w * 3.2, 0, TAU);
        g.stroke();
      }
    }
    g.strokeStyle = "rgba(160,176,216,0.3)";
    g.lineWidth = line * 0.6;
    g.beginPath();
    g.moveTo(0, geo.heddle);
    g.lineTo(W, geo.heddle);
    g.stroke();
  };

  const loop = ctx.loop({
    hz: HZ,
    update(dt) {
      if (disposed) return;
      const t = now();
      const n = columns();
      if (n !== conductor.n) {
        conductor.resize(n);
        shown = Array.from({ length: n }, (_, i) => shown[i] ?? { amp: 0, phase: 0 });
      }
      // A frame not heard from for a while has gone: its harmonics go auto.
      for (let i = 0; i < conductor.n; i++) {
        if (conductor.live[i] && t - inbox.heardAt(i) > STALE_MS) conductor.setAuto(i);
      }
      conductor.step(dt);
      const f = 1 - Math.exp(-dt / FOLLOW_S);
      shown = conductor.values.map((v, i) => {
        const s = shown[i] ?? v;
        if (!conductor.live[i]) return { ...v };
        return {
          amp: s.amp + (v.amp - s.amp) * f,
          phase: wrapPhase(s.phase + phaseDelta(s.phase, v.phase) * f),
        };
      });
      const geo = screenGeometry(vw(), vh());
      const peak = conductor.target()?.peak ?? Math.max(1, peakOf(shown));
      const want = wantedScale(geo.picture, peak);
      scale = scale === 0 ? want : scale + (want - scale) * (1 - Math.exp(-dt / 0.8));
      if (t - beaconAt >= BEACON_MS && ctx.net.online) {
        beaconAt = t;
        sendBeacon(ctx.net, beaconFrom(conductor, side, true));
      }
      lastStep = t;
    },
    render() {
      if (disposed) return;
      const t = now();
      if (t - lastRender < RENDER_MS) return;
      lastRender = t;
      draw();
    },
  });
  loop.start();

  const offResize = ctx.onResize((f) => {
    frame = f;
    size();
  });

  const command = (name: string) => {
    if (name === "clear") conductor.cloth.clear();
    else if (name === "next") conductor.next();
  };

  const debugKey = "__loom";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => ({
          screen: true,
          n: conductor.n,
          width: vw(),
          height: vh(),
          heddle: screenGeometry(vw(), vh()).heddle,
          round: conductor.round,
          target: conductor.target()?.id ?? null,
          mode: conductor.mode,
          fill: conductor.fill,
          live: [...conductor.live],
          ok: [...conductor.ok],
          values: shown.map((v) => ({ ...v })),
          bands: conductor.cloth.bands.length,
          woven: conductor.cloth.woven,
          matches: conductor.matches,
          peopleMatches: conductor.peopleMatches,
          stations: stations().length,
          lastStep,
        }),
        edges: () => ({ clock: ctx.clock.now(), edges: edges() }),
        command,
      },
    });
  }

  return {
    // The cloth and the round are everyone's: idle (which a screen nobody touches reaches every
    // minute) changes nothing here.
    reset() {},
    status(): Record<string, OptionValue> {
      const live = conductor.live.filter(Boolean).length;
      return {
        target: conductor.target()?.title ?? "free",
        fill: Math.round(conductor.fill * 100),
        live,
        auto: conductor.n - live,
        bands: conductor.cloth.bands.length,
        matches: conductor.matches,
        columns: conductor.n,
      };
    },
    command(name) {
      command(name);
    },
    dispose() {
      disposed = true;
      loop.stop();
      inbox.dispose();
      offResize();
      painter.dispose();
      canvas.remove();
      ctx.root.style.background = "";
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
