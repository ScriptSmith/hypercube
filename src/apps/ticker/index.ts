/**
 * Ticker Ring: rings of lit lettering crawl round a sphere.
 *
 * - rings.ts      where the rings go, sized and timed in metres on the ball
 * - messages.ts   the curated lines, facts about the ball, the time and the date
 * - schedule.ts   which line comes next on a ring; operator text set through admin comes first
 * - tape.ts       the endless tape and the printer where new words appear; ring.ts runs a ring
 * - draw.ts       a ring's band on a `Strip`, drawn in tiles and copied onto the feed
 * - background.ts the dim ball behind, a `SurfacePass`; styles.ts the looks
 */
import { cutText } from "../../core/options";
import { createRenderer3D } from "../../core/renderer3d";
import { DEG, type SphereMap, sphereMap, WHOLE_SPHERE } from "../../core/sphere";
import type { AppContext, AppInstance, FrameInfo, OptionValues } from "../../core/types";
import { createBackground } from "./background";
import { createRingView, type RingView } from "./draw";
import { MESSAGE_MAX, MESSAGE_SLOTS } from "./manifest";
import { ballFacts } from "./messages";
import { layoutRings, type RingRole, SPEEDS } from "./rings";
import { createSchedule, type ListMode, type Schedule } from "./schedule";
import { styleOf } from "./styles";

/** The background barely moves, so it is drawn at half the frame rate. */
const BACKGROUND_HZ = 30;
const LISTS: readonly ListMode[] = ["general", "welcome", "operator"];

/** The operator's messages from admin, cleaned again and without empty ones. */
export const operatorMessages = (o: OptionValues): string[] => {
  const out: string[] = [];
  for (let i = 1; i <= MESSAGE_SLOTS; i++) {
    const v = o[`message${i}`];
    const text = typeof v === "string" ? cutText(v, MESSAGE_MAX) : "";
    if (text) out.push(text);
  }
  return out;
};

/**
 * The medallion at the bottom pole, radians from it: as big as fits below the lowest ring, and
 * none when there is no room for one.
 */
export const emblemRadius = (specs: readonly { bottom: number }[]): number => {
  const lowest = Math.min(...specs.map((s) => s.bottom), Math.PI / 2);
  const room = lowest + Math.PI / 2 - 4 * DEG;
  return room < 5 * DEG ? 0 : Math.min(room, 15 * DEG);
};

interface Placed {
  view: RingView;
  /** Show time when it was built: a resize starts the rings afresh. */
  t0: number;
}

export const mount = (ctx: AppContext): AppInstance => {
  const style = styleOf(ctx.options.style);
  const list = LISTS.find((l) => l === ctx.options.list) ?? "general";
  const ringCount = Number(ctx.options.rings) || 2;
  const speed = SPEEDS[String(ctx.options.speed)] ?? 1;
  const operator = operatorMessages(ctx.options);
  const sphere = () => ctx.frame.sphere ?? WHOLE_SPHERE;
  const rng = ctx.rng().fork("ticker");

  const r3d = createRenderer3D(ctx.root, ctx.frame, { antialias: false, zIndex: 0 });
  // The medallion's lamps chase about as fast as the rings' edge lamps on the main ring.
  const background = createBackground(r3d, ctx.frame, { style, emblem: 0, chase: 2.8 * speed });
  const feed = document.createElement("canvas");
  feed.style.cssText = "position:absolute;inset:0;width:100%;height:100%;z-index:1;";
  ctx.root.append(feed);
  const fg = feed.getContext("2d");

  // Schedules outlive a resize, so the order of lines carries on.
  const schedules = new Map<RingRole, Schedule>();
  let rings: Placed[] = [];
  let map: SphereMap = sphereMap(sphere(), 1, 1);
  let t = 0;
  let lastBackground = Number.NEGATIVE_INFINITY;

  const build = (f: FrameInfo) => {
    for (const r of rings) r.view.dispose();
    const s = f.sphere ?? WHOLE_SPHERE;
    feed.width = Math.max(1, Math.round(f.width * f.pixelRatio));
    feed.height = Math.max(1, Math.round(f.height * f.pixelRatio));
    map = sphereMap(s, feed.width, feed.height);
    rings = layoutRings(s, ringCount, speed).map((spec) => {
      let schedule = schedules.get(spec.role);
      if (!schedule) {
        schedule = createSchedule(
          { list, role: spec.role, operator, ballFacts: [] },
          rng.fork(spec.role),
        );
        schedules.set(spec.role, schedule);
      }
      schedule.setBallFacts(ballFacts(s, spec.speedM));
      const view = createRingView({
        spec,
        sphere: s,
        feedWidth: feed.width,
        style,
        schedule,
        now: () => ctx.clock.now(),
        rng: rng.fork(`${spec.role}:sparkle`),
        startS: t,
      });
      return { view, t0: t };
    });
    background.setEmblem(emblemRadius(rings.map((r) => r.view.spec)));
    lastBackground = Number.NEGATIVE_INFINITY;
  };
  build(ctx.frame);

  const step = (dt: number) => {
    t += dt;
    for (const r of rings) r.view.update(t - r.t0, dt);
  };

  const loop = ctx.loop({
    hz: 60,
    update: step,
    render() {
      if (r3d.ready && t - lastBackground >= 1 / BACKGROUND_HZ - 1e-6) {
        background.render(t);
        lastBackground = t;
      }
      if (!fg) return;
      for (const r of rings) {
        r.view.draw();
        r.view.paint(fg, map);
      }
    },
  });
  loop.start();

  ctx.onResize((f) => {
    r3d.resize(f);
    background.setSphere(f.sphere ?? WHOLE_SPHERE);
    build(f);
  });

  const printed = () => rings.reduce((n, r) => n + r.view.model.printed, 0);

  const debugKey = "__ticker";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => ({
          t,
          ready: r3d.ready,
          style: String(ctx.options.style),
          list,
          operator: operator.length,
          feed: { width: feed.width, height: feed.height },
          rings: rings.map(({ view }) => ({
            role: view.spec.role,
            top: view.spec.top,
            bottom: view.spec.bottom,
            centre: view.spec.centre,
            letterM: view.spec.letterM,
            speedM: view.spec.speedM,
            letterPx: view.letterPx,
            pitch: view.pitch,
            dots: view.dots,
            width: view.strip.width,
            printed: view.model.printed,
            tiles: view.tiles(),
            printer: view.model.printer(),
            lines: view.model.lines().map((l) => ({ kind: l.kind, text: l.text })),
            recent: view.model.recent().map((l) => ({ kind: l.kind, text: l.text })),
          })),
        }),
        /** Run the show forward, as if `seconds` had passed. */
        skip: (seconds: number) => {
          const n = Math.max(1, Math.ceil(seconds * 4));
          for (let i = 0; i < n; i++) step(seconds / n);
        },
      },
    });
  }

  return {
    // Nothing is touched, so there is nothing to put back; the show runs on.
    reset() {},
    status: () => ({
      rings: rings.length,
      style: String(ctx.options.style ?? "amber"),
      list,
      messages: operator.length,
      printed: printed(),
    }),
    dispose() {
      loop.stop();
      for (const r of rings) r.view.dispose();
      rings = [];
      feed.width = feed.height = 0;
      feed.remove();
      r3d.dispose();
      if (ctx.debug) delete (window as unknown as Record<string, unknown>)[debugKey];
    },
  };
};
