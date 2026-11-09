/**
 * The screen above a bank: one big circle with every frame's point on it in that frame's
 * colour, every frame's point riding the sine and cosine curves, and along the bottom a bead
 * above each frame at the height of its sin θ, so the bank's offset angles make a travelling
 * wave. The latest frame someone turns gets the full picture and the readout; with nobody
 * turning one, the screen plays the walk-through on the leftmost frame's point. A screen on
 * its own plays the walk-through on its own circle.
 *
 * Canvas2D on one canvas over the CSS background, at most 40 frames a second.
 */
import { bankFraction } from "../../core/layout";
import type { AppContext, AppInstance, FrameInfo, OptionValue, PeerInfo } from "../../core/types";
import { BACKGROUND, type Fn, FNS, frameColour, HZ, readConfig, TAU } from "./config";
import { drawBeads, drawCaption, drawPicture, drawReadout, type Look } from "./draw";
import { exploreCaption } from "./frame";
import { layoutFor } from "./layout";
import { BEACON_MS, createInbox, sendBeacon, STALE_MS } from "./link";
import { bankTourAngle, shortest, tourAngle, valuesAt, wrap } from "./maths";
import { createShow } from "./show";
import { createView, zoomFor } from "./view";
import { ALL_PARTS, fnsAt, stepsFor } from "./walk";
import { FLAG, MAX_COUNT } from "./wire";

const RENDER_MS = 1000 / 40;
/** A frame turned within this long keeps the full picture. */
export const FEATURE_MS = 15_000;
/** A frame's own angle is drawn following its 20 Hz messages over about this long. */
const FOLLOW_S = 0.06;

interface Shown {
  frame: string;
  pos: number;
  theta: number;
  own: boolean;
  held: boolean;
}

export const mountScreen = (ctx: AppContext): AppInstance => {
  const config = readConfig(ctx.variant, ctx.options);
  const inBank = ctx.setup.name === "bank";
  const side = ctx.setup.side ?? 0;
  let frame: FrameInfo = ctx.frame;
  const layoutOf = (f: FrameInfo) =>
    layoutFor({
      kind: "screen",
      width: f.width / f.unit,
      height: f.height / f.unit,
      bank: inBank,
      steps: false,
    });
  let layout = layoutOf(frame);
  ctx.root.style.background = BACKGROUND;
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
  ctx.root.append(canvas);
  const g = canvas.getContext("2d");
  let k = 1;
  const size = () => {
    const ratio = Math.min(frame.pixelRatio, 1.5);
    canvas.width = Math.max(1, Math.round(frame.width * ratio));
    canvas.height = Math.max(1, Math.round(frame.height * ratio));
    k = frame.unit * ratio;
  };
  size();

  const now = () => performance.now();
  const inbox = inBank ? createInbox(ctx.net, { side, frame: ctx.net.self }, now) : null;
  const steps = stepsFor(config.tan);
  const show = createShow(config.variant, steps, inBank ? "clock" : now());
  const shown = new Map<string, Shown>();
  const view = createView(() => layout, zoomFor(show.at(now(), ctx.clock.now())));
  let featured: string | null = null;
  let beaconAt = Number.NEGATIVE_INFINITY;
  let lastRender = 0;
  let lastStep = now();
  let disposed = false;
  let time = 0;

  const touchFrames = (): PeerInfo[] =>
    inBank
      ? ctx.net
          .peers()
          .filter(
            (p) => p.role !== "screen" && (p.side ?? 0) === side && p.pos >= 0 && p.pos < MAX_COUNT,
          )
          .sort((a, b) => a.pos - b.pos)
      : [];
  const countOf = (frames: readonly PeerInfo[]) =>
    Math.min(MAX_COUNT, Math.max(1, inBank ? ctx.setup.count : 1, ...frames.map((p) => p.pos + 1)));

  const update = (dt: number) => {
    const t = now();
    const clock = ctx.clock.now();
    time += dt;
    const frames = touchFrames();
    const count = countOf(frames);
    const seen = new Set<string>();
    const f = 1 - Math.exp(-dt / FOLLOW_S);
    let best: { frame: string; at: number } | null = null;
    for (const p of frames) {
      seen.add(p.frame);
      const h = inbox?.get(p.frame);
      const fresh = h !== undefined && t - h.at <= STALE_MS;
      const own = fresh && (h.flags & FLAG.own) !== 0;
      const prev = shown.get(p.frame);
      let theta: number;
      if (own) {
        theta = prev?.own ? prev.theta + shortest(prev.theta, h.theta) * f : h.theta;
      } else {
        theta = bankTourAngle(clock, p.pos, h?.n ?? count);
      }
      shown.set(p.frame, {
        frame: p.frame,
        pos: p.pos,
        theta,
        own,
        held: fresh && (h.flags & FLAG.held) !== 0,
      });
      if (h && t - h.heldLast <= FEATURE_MS && (!best || h.heldStart > best.at)) {
        best = { frame: p.frame, at: h.heldStart };
      }
    }
    for (const id of shown.keys()) if (!seen.has(id)) shown.delete(id);
    featured = best?.frame ?? null;
    view.step(dt, featured ? "none" : zoomFor(show.at(t, clock)));
    if (inBank && t - beaconAt >= BEACON_MS && ctx.net.online) {
      beaconAt = t;
      sendBeacon(ctx.net, side);
    }
    lastStep = t;
  };

  const draw = () => {
    if (!g) return;
    const t = now();
    const W = frame.width / frame.unit;
    const list = [...shown.values()].sort((a, b) => a.pos - b.pos);
    const lead = featured ? shown.get(featured) : list[0];
    const theta = lead ? wrap(lead.theta) : wrap(tourAngle(t));
    const sh = featured
      ? { auto: false, step: null, id: null, t: 0, u: 0, line: 0, caption: null, parts: ALL_PARTS }
      : show.at(t, ctx.clock.now());
    const v = valuesAt(theta);
    const on: Record<Fn, boolean> = { sin: true, cos: true, tan: config.tan };
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.setTransform(k, 0, 0, k, 0, 0);
    const look: Look = {
      theta,
      v,
      parts: sh.parts,
      show: on,
      units: config.units,
      step: { id: sh.id, t: sh.t, u: sh.u, line: sh.line },
      traced: sh.id === "waves",
      ring: lead ? frameColour(lead.pos) : null,
      others: list
        .filter((s) => s !== lead)
        .map((s) => ({ theta: wrap(s.theta), colour: frameColour(s.pos) })),
      time,
      graphAlpha: view.graphAlpha,
    };
    drawPicture(g, view.pic, look);
    const caption =
      sh.caption ??
      (featured || !sh.auto ? exploreCaption(v, config.tan) : ["sin, cos and tan from one circle"]);
    drawCaption(g, layout.caption, caption, 1);
    const fns = (sh.auto ? fnsAt(sh.parts) : FNS).filter((fn) => on[fn]);
    const box = view.readout;
    drawReadout(g, box, v, fns, config.units);
    // Whose values these are: the featured frame's colour beside them.
    if (lead && featured) {
      g.beginPath();
      g.arc(box.x - box.size * 0.55, box.y + box.size * 0.8, box.size * 0.28, 0, TAU);
      g.fillStyle = frameColour(lead.pos);
      g.fill();
    }
    if (layout.beads) {
      const count = countOf(list.map((s) => ({ pos: s.pos }) as PeerInfo));
      drawBeads(
        g,
        layout.beads,
        W,
        list.map((s) => ({
          x: bankFraction(s.pos, 0.5, count) * W,
          theta: s.theta,
          colour: frameColour(s.pos),
          lead: s === lead && featured !== null,
        })),
        layout.pic.line,
      );
    }
  };

  const loop = ctx.loop({
    hz: HZ,
    update(dt) {
      if (!disposed) update(dt);
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
    layout = layoutOf(f);
    size();
  });

  const debugKey = "__trig";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => {
          const list = [...shown.values()].sort((a, b) => a.pos - b.pos);
          const count = countOf(list.map((s) => ({ pos: s.pos }) as PeerInfo));
          return {
            screen: true,
            bank: inBank,
            width: frame.width / frame.unit,
            featured: featured ? (shown.get(featured)?.pos ?? null) : null,
            step: featured ? null : show.at(now(), ctx.clock.now()).id,
            frames: list.map((s) => ({
              pos: s.pos,
              theta: wrap(s.theta),
              own: s.own,
              held: s.held,
              beadX: bankFraction(s.pos, 0.5, count),
            })),
            lastStep,
          };
        },
      },
    });
  }

  return {
    // Nobody touches a screen: idle changes nothing here.
    reset() {},
    status(): Record<string, OptionValue> {
      const list = [...shown.values()];
      return {
        frames: list.length,
        turning: list.filter((s) => s.own).length,
        featured: featured ? (shown.get(featured)?.pos ?? -1) : -1,
        step: featured ? "explore" : (show.at(now(), ctx.clock.now()).id ?? "all"),
      };
    },
    dispose() {
      disposed = true;
      loop.stop();
      inbox?.dispose();
      offResize();
      canvas.remove();
      ctx.root.style.background = "";
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
