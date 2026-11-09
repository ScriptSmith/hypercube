/**
 * A touch frame: its own circle, angle, graphs and controls. Solo frames stand alone. Bank
 * frames do too, and also send their angle to the screen while they hear it; untouched, their
 * angle follows the bank's slow turn from the shared clock, a little behind the frame to their
 * left, so the bank's beads on the screen make a travelling wave.
 */
import type { AppContext, AppInstance, FrameInfo, OptionValue, Pointer } from "../../core/types";
import { createAngle } from "./angle";
import { type Bot, createBot } from "./bots";
import {
  BACKGROUND,
  COLOUR,
  type Config,
  type Fn,
  FNS,
  frameColour,
  HZ,
  INK,
  readConfig,
  rgba,
  TIMING,
} from "./config";
import { createControls } from "./controls";
import {
  drawCaption,
  drawDots,
  drawHand,
  drawPicture,
  drawReadout,
  drawWheel,
  type Look,
} from "./draw";
import { type Layout, layoutFor, pointAt } from "./layout";
import { createWatch, sendAngle, type Watch } from "./link";
import { bankTourAngle, exactText, tanUndefined, tourAngle, type Values, valuesAt } from "./maths";
import { createShow } from "./show";
import { createView, zoomFor } from "./view";
import { fnsAt, stepsFor } from "./walk";
import { FLAG, quantAngle } from "./wire";

/** Sending the angle: while it moves, and otherwise. */
const SEND_MOVING_MS = 50;
const SEND_IDLE_MS = 1000;
/** A person's touch counts as recent for this long (sent to the screen). */
const PERSON_MS = 30_000;

const chevron = (d: string) =>
  `<svg viewBox="0 0 100 100" width="100%" height="100%"><path d="${d}" fill="none" ` +
  `stroke="currentColor" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CHEVRON_LEFT = chevron("M62 16L28 50L62 84");
const CHEVRON_RIGHT = chevron("M38 16L72 50L38 84");

/** The caption while everything shows: the two identities, or tan's missing value. */
export const exploreCaption = (v: Values, tan: boolean): string[] => {
  if (tan && tanUndefined(v.deg)) return [`At ${v.deg}°, tan θ has no value`];
  return tan ? ["sin²θ + cos²θ = 1", "tan θ = sin θ ÷ cos θ"] : ["sin²θ + cos²θ = 1"];
};

const styleToggle = (el: HTMLElement, on: boolean, colour: string, unit: number) => {
  el.style.background = on ? colour : "rgba(5,7,13,0.78)";
  el.style.color = on ? "#05070d" : rgba(colour, 0.9);
  el.style.border = `${Math.max(2, 6 * unit)}px solid ${rgba(colour, on ? 1 : 0.6)}`;
  el.style.boxShadow = on ? `0 0 ${Math.round(30 * unit)}px ${rgba(colour, 0.4)}` : "none";
  el.setAttribute("aria-pressed", on ? "true" : "false");
};

export const mountFrame = (ctx: AppContext): AppInstance => {
  const config: Config = readConfig(ctx.variant, ctx.options);
  const inBank =
    ctx.setup.name === "bank" && (ctx.frame.kind === "panel" || ctx.frame.kind === "pair");
  const side = ctx.setup.side ?? 0;
  const pos = Math.max(0, ctx.setup.pos);
  const count = Math.max(1, ctx.setup.count, pos + 1);
  const colour = inBank ? frameColour(pos) : null;
  let frame: FrameInfo = ctx.frame;
  const layoutOf = (f: FrameInfo): Layout =>
    layoutFor({
      kind: f.kind === "screen" ? "panel" : f.kind,
      width: f.width / f.unit,
      height: f.height / f.unit,
      bank: inBank,
      steps: config.variant === "steps",
    });
  let layout = layoutOf(frame);
  ctx.root.style.background = BACKGROUND;
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
  ctx.root.append(canvas);
  const g = canvas.getContext("2d");
  let k = 1;
  const size = () => {
    const ratio = Math.min(frame.pixelRatio, 2);
    canvas.width = Math.max(1, Math.round(frame.width * ratio));
    canvas.height = Math.max(1, Math.round(frame.height * ratio));
    k = frame.unit * ratio;
  };
  size();

  const now = () => performance.now();
  const clockAt = (t: number) => t + (ctx.clock.now() - performance.now());
  const tour = (t: number) => (inBank ? bankTourAngle(clockAt(t), pos, count) : tourAngle(t));
  const angle = createAngle(
    {
      snap: config.snap,
      tour,
      holdMs: inBank ? TIMING.bankHold : TIMING.soloHold,
      easeMs: TIMING.ease,
      gotoMs: TIMING.goto,
    },
    now(),
  );
  const steps = stepsFor(config.tan);
  const show = createShow(config.variant, steps, inBank ? "clock" : now());
  const on: Record<Fn, boolean> = { sin: true, cos: true, tan: config.tan };
  let lastPerson = Number.NEGATIVE_INFINITY;
  let lastAny = Number.NEGATIVE_INFINITY;
  let disposed = false;

  const view = createView(() => layout, zoomFor(show.at(now(), ctx.clock.now())));
  let graphsLive = false;
  const controls = createControls({
    layout: () => layout,
    pic: () => view.pic,
    graphs: () => graphsLive,
    angle,
    onTake: (_hit, person, t) => {
      lastAny = t;
      if (person) lastPerson = t;
      show.hold(t, ctx.clock.now());
    },
  });

  const venue = (p: Pointer) => ({ x: p.x / frame.unit, y: p.y / frame.unit });
  const offs = [
    ctx.input.on("down", (p) => {
      const v = venue(p);
      controls.down(p.id, v.x, v.y, now(), !p.synthetic);
    }),
    ctx.input.on("move", (p) => {
      const v = venue(p);
      controls.move(p.id, v.x, v.y, now());
      if (!p.synthetic) lastPerson = now();
    }),
    ctx.input.on("up", (p) => controls.up(p.id, now())),
    ctx.input.on("cancel", (p) => controls.cancel(p.id, now())),
  ];

  // Toggles and the walk-through buttons are the UI kit's, so they swallow their presses.
  let buttons: HTMLElement[] = [];
  /** "Show me" shows while everything does; Back and Next take its place while the steps show. */
  let walkEls: HTMLElement[] = [];
  let stepEls: HTMLElement[] = [];
  let stepping: boolean | null = null;
  /** The UI kit lays its buttons out with an inline display, so hiding one keeps it to restore. */
  const shownAs = new WeakMap<HTMLElement, string>();
  const setShown = (el: HTMLElement, on: boolean) => {
    if (!shownAs.has(el)) shownAs.set(el, el.style.display);
    el.style.display = on ? shownAs.get(el)! : "none";
  };
  const showStepping = (on: boolean) => {
    if (on === stepping) return;
    stepping = on;
    for (const el of walkEls) setShown(el, !on);
    for (const el of stepEls) setShown(el, on);
  };
  const toggleEls = new Map<Fn, HTMLElement>();
  const restyle = () => {
    for (const [fn, el] of toggleEls) styleToggle(el, on[fn], COLOUR[fn], frame.unit);
  };
  const toScreen = (r: { x: number; y: number; width: number; height: number }) => {
    const u = frame.unit;
    return { x: r.x * u, y: r.y * u, width: r.width * u, height: r.height * u };
  };
  const buildButtons = () => {
    for (const b of buttons) b.remove();
    buttons = [];
    walkEls = [];
    stepEls = [];
    stepping = null;
    toggleEls.clear();
    for (const t of layout.toggles) {
      if (t.fn === "tan" && !config.tan) continue;
      const fn = t.fn;
      const el = ctx.ui.button({
        label: fn,
        rect: toScreen(t.rect),
        color: COLOUR[fn],
        onPress: () => {
          on[fn] = !on[fn];
          lastAny = now();
          show.hold(now(), ctx.clock.now());
          restyle();
        },
      });
      toggleEls.set(fn, el);
      buttons.push(el);
    }
    restyle();
    if (layout.walk) {
      const el = ctx.ui.button({
        label: "Show me",
        icon: "play",
        rect: toScreen(layout.walk),
        look: "ghost",
        color: INK,
        onPress: () => {
          const t = now();
          lastAny = t;
          show.guide(t);
          angle.follow(t);
        },
      });
      walkEls.push(el);
      buttons.push(el);
    }
    for (const [r, d, name] of [
      [layout.back, -1, "Back"],
      [layout.next, 1, "Next"],
    ] as const) {
      if (!r) continue;
      // Arrows rather than words; the name stays for assistive tools and tests.
      const el = ctx.ui.button({
        icon: d > 0 ? CHEVRON_RIGHT : CHEVRON_LEFT,
        rect: toScreen(r),
        look: d > 0 ? "solid" : "ghost",
        color: d > 0 ? COLOUR.theta : INK,
        onPress: () => {
          const t = now();
          lastAny = t;
          if (d > 0) show.next(t, ctx.clock.now());
          else show.back(t, ctx.clock.now());
        },
      });
      el.setAttribute("aria-label", name);
      stepEls.push(el);
      buttons.push(el);
    }
    showStepping(show.at(now(), ctx.clock.now()).stepping);
  };
  buildButtons();

  const bots: Bot[] =
    ctx.bots > 0
      ? [
          createBot({
            input: ctx.input,
            layout: () => layout,
            pic: () => view.pic,
            graphs: () => graphsLive,
            unit: () => frame.unit,
            rng: ctx.rng().fork(`trig-bot:${pos}`),
            theta: () => angle.theta,
            reachTop: () => frame.reachTop.adult / frame.unit,
            lastPerson: () => lastPerson,
            toggles: () => [...toggleEls.keys()].map((fn) => ({ fn, on: on[fn] })),
            steps: config.variant === "steps",
          }),
        ]
      : [];

  // A bank frame tells its screen its angle.
  const watch: Watch | null = inBank ? createWatch(ctx.net, side, now) : null;
  let sentAt = Number.NEGATIVE_INFINITY;
  let sentFlags = -1;
  let sends = 0;
  const flagsNow = (t: number) =>
    (angle.mode !== "tour" ? FLAG.own : 0) |
    (controls.count > 0 ? FLAG.held : 0) |
    (t - lastPerson < PERSON_MS ? FLAG.person : 0);
  const sendDue = (t: number) => {
    const to = watch?.screen();
    if (!to) return;
    const f = flagsNow(t);
    const gap = angle.moving ? SEND_MOVING_MS : SEND_IDLE_MS;
    if (f === sentFlags && t - sentAt < gap) return;
    if (sendAngle(ctx.net, to, { p: pos, a: quantAngle(angle.theta), f, n: count })) {
      sentAt = t;
      sentFlags = f;
      sends++;
    }
  };

  let time = 0;
  let hand = 0;
  /** Debug poses keep their angle while the show plays. */
  let pinned = false;
  const loop = ctx.loop({
    hz: HZ,
    update(dt) {
      if (disposed) return;
      const t = now();
      time += dt;
      // While the show plays by itself the angle turns with it.
      if (
        !pinned &&
        show.auto &&
        (angle.mode === "hold" || angle.mode === "goto") &&
        controls.count === 0
      ) {
        angle.follow(t);
      }
      angle.step(t);
      const sh = show.at(t, ctx.clock.now());
      showStepping(sh.stepping);
      // The circle never slides out from under a finger; it goes when the finger lifts.
      if (controls.count === 0) view.step(dt, zoomFor(sh));
      graphsLive = sh.parts.graphs && view.u < 0.05;
      for (const b of bots) b.update(dt, t);
      sendDue(t);
    },
    render() {
      if (disposed || !g) return;
      const t = now();
      const theta = angle.theta;
      const v = valuesAt(theta);
      const sh = show.at(t, ctx.clock.now());
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.setTransform(k, 0, 0, k, 0, 0);
      const look: Look = {
        theta,
        v,
        parts: sh.parts,
        show: { sin: on.sin, cos: on.cos, tan: on.tan && config.tan },
        units: config.units,
        step: { id: sh.id, t: sh.t, u: sh.u, line: sh.line },
        traced: sh.id === "waves",
        ring: colour,
        others: [],
        time,
        graphAlpha: view.graphAlpha,
      };
      drawPicture(g, view.pic, look);
      if (layout.wheel) {
        const quiet = t - lastAny > 4000 && controls.count === 0;
        drawWheel(
          g,
          layout.wheel,
          theta,
          controls.leading === "wheel",
          layout.pic.line,
          quiet ? 1 : 0,
        );
      }
      const caption =
        sh.caption ??
        (sh.auto ? ["Turn the wheel or drag the point"] : exploreCaption(v, look.show.tan));
      drawCaption(g, layout.caption, caption, 1);
      const fns = (sh.stepping ? fnsAt(sh.parts) : FNS).filter((fn) => look.show[fn]);
      drawReadout(g, view.readout, v, fns, config.units);
      if (layout.dots && sh.stepping) {
        drawDots(g, layout.dots, steps.length, sh.step ?? steps.length - 1);
      }
      if (layout.strip && colour) {
        g.fillStyle = colour;
        g.fillRect(layout.strip.x, layout.strip.y, layout.strip.width, layout.strip.height);
      }
      // In the show, a ghost hand rides the point as if turning it.
      const wantHand = sh.auto && bots.length === 0 && (sh.id === "circle" || sh.step === null);
      hand += ((wantHand ? 1 : 0) - hand) * 0.05;
      if (hand > 0.02) {
        const p = pointAt(view.pic, theta);
        drawHand(
          g,
          p.x + layout.pic.line * 2,
          p.y + layout.pic.line * 2,
          layout.pic.label * 2.4,
          hand,
        );
      }
    },
  });
  loop.start();

  let resizeTimer = 0;
  const offResize = ctx.onResize((f) => {
    frame = f;
    layout = layoutOf(f);
    size();
    controls.clear(now());
    for (const b of bots) b.release();
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (!disposed) buildButtons();
    }, 150);
  });

  const debugKey = "__trig";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => {
          const v = valuesAt(angle.theta);
          const sh = show.at(now(), ctx.clock.now());
          return {
            screen: false,
            unit: frame.unit,
            kind: layout.kind,
            bank: inBank,
            pos,
            theta: angle.theta,
            deg: v.deg,
            mode: angle.mode,
            auto: sh.auto,
            step: sh.id,
            line: sh.line,
            on: { ...on },
            values: {
              sin: v.sin,
              cos: v.cos,
              tan: v.tan,
              exact: v.exact
                ? {
                    sin: exactText(v.exact.sin),
                    cos: exactText(v.exact.cos),
                    tan: v.exact.tan ? exactText(v.exact.tan) : null,
                  }
                : null,
            },
            hearsScreen: watch?.screen() !== null && watch !== null,
            sends,
            touches: controls.count,
            /** The picture as drawn now (zoomed in the walk-through's first steps). */
            pic: view.pic,
            layout: {
              pic: layout.pic,
              wheel: layout.wheel,
              graph: layout.graph,
              toggles: layout.toggles,
              walk: layout.walk,
              back: layout.back,
              next: layout.next,
            },
            bots: bots.map((b) => ({ ...b.moves })),
          };
        },
        /** Put the angle at `deg` and show step `step` (an index), or everything (null). */
        pose: (deg: number, step: number | null = null) => {
          const t = now();
          pinned = true;
          controls.clear(t);
          angle.setTo((deg * Math.PI) / 180, t, false);
          angle.release(t);
          if (step === null) show.hold(t, ctx.clock.now());
          else {
            let start = 0;
            for (let i = 0; i < step && i < steps.length; i++) start += steps[i]!.secs;
            show.play(t - (start + 0.6 * (steps[step]?.secs ?? 0)) * 1000);
          }
        },
      },
    });
  }

  return {
    reset() {
      const t = now();
      pinned = false;
      controls.clear(t);
      for (const b of bots) b.release();
      on.sin = true;
      on.cos = true;
      on.tan = config.tan;
      restyle();
      show.play(inBank ? "clock" : t);
      angle.follow(t);
    },
    attract() {},
    status(): Record<string, OptionValue> {
      const v = valuesAt(angle.theta);
      const sh = show.at(now(), ctx.clock.now());
      return {
        angle: v.deg,
        shown: FNS.filter((fn) => on[fn] && (fn !== "tan" || config.tan)).join(",") || "none",
        step: sh.id ?? (sh.auto ? "all" : "explore"),
        touches: controls.count,
        mode: angle.mode,
        ...(inBank ? { screen: watch?.screen() != null } : {}),
      };
    },
    homeSpot(sz) {
      const u = frame.unit;
      return {
        x: Math.max(0, Math.min(frame.width - sz, layout.home.x * u)),
        y: Math.max(0, Math.min(frame.height - sz, layout.home.y * u)),
      };
    },
    dispose() {
      disposed = true;
      loop.stop();
      watch?.dispose();
      clearTimeout(resizeTimer);
      offResize();
      for (const off of offs) off();
      for (const b of bots) b.dispose();
      for (const b of buttons) b.remove();
      canvas.remove();
      ctx.root.style.background = "";
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
