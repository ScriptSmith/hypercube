/**
 * The screen above a bank. It flies nothing while touch frames are sending: it shows each frame's
 * craft above that frame, faint while the frame's autopilot flies it and bright while people do
 * (screenview.ts). With no touch frame heard for a few seconds it flies attract crews of its own,
 * one per column, and drops them the moment a frame is heard.
 */
import { kindReach, venueSize } from "../../core/frame";
import { activeVenue } from "../../core/venue";
import type { AppContext, AppInstance, FrameInfo, PeerInfo } from "../../core/types";
import { type Config, seedLabel } from "./config";
import { createCrew, type Crew, type CrewEvent } from "./crew";
import { createFleet, emptyPose, type Remote } from "./fleet";
import { type Pose, poseAt } from "./ghost";
import { type Layout, layoutFor } from "./layout";
import { shipFlags } from "./link";
import { createScreenRenderer, type ShipView } from "./screenview";
import { decodeShip, TOPIC_SHIP } from "./wire";

const HZ = 120;
/** Without a message from any touch frame for this long, the screen flies its own crews. */
export const DEMO_AFTER_MS = 3000;
/**
 * Columns of the screen's own crews when it doesn't know how many frames it serves: a bank of
 * pairs.
 */
const demoFrames = () => Math.max(1, Math.floor(activeVenue().bankCount / 2));
const MAX_DEMO = 16;
const LOOK_MS = 250;

interface Demo {
  crew: Crew;
  view: ShipView;
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

export const mountScreen = (ctx: AppContext, config: Config): AppInstance => {
  const players = ctx.ui.palette.players;
  const colorAt = (pos: number) => players[pos % players.length] ?? "#f0e82a";
  const side = ctx.setup.side ?? 0;
  const renderer = createScreenRenderer(ctx.root, String(ctx.seed));
  const fleet = createFleet((label) => ctx.rng(label));
  const views = new Map<string, ShipView>();
  const ships: ShipView[] = [];
  let frame: FrameInfo = ctx.frame;
  let demo: Demo[] | null = null;
  const mountedAt = performance.now();
  let lastHeard = Number.NEGATIVE_INFINITY;
  let lookAt = 0;
  let pokedAt = 0;
  let received = 0;
  let dropped = 0;
  let disposed = false;
  const ghost: Pose = { x: 0, y: 0, a: 0, flags: 0 };

  const isTouchFrame = (p: PeerInfo) =>
    p.role !== "screen" && p.frame !== ctx.net.self && (p.side ?? 0) === side;

  /** Columns: the screen's own count, or the frames' when it doesn't know. */
  const columns = (): number => {
    if (ctx.setup.count > 1) return ctx.setup.count;
    let n = 1;
    for (const r of fleet.remotes()) n = Math.max(n, r.count, r.pos + 1);
    if (demo) n = Math.max(n, demo.length);
    return n;
  };

  // ---- The screen's own crews ---------------------------------------------------------------

  /** Pairs when that many fill the venue's bank or fewer, panels otherwise, as a real bank's. */
  const demoLayout = (n: number): Layout => {
    const kind = n * 2 <= activeVenue().bankCount ? "pair" : "panel";
    const size = venueSize(kind);
    const reach = kindReach(kind);
    return layoutFor({
      kind,
      width: size.width,
      height: size.height,
      reachTop: { adult: size.height * (1 - reach.adult), child: size.height * (1 - reach.child) },
      seams: kind === "pair" ? [size.width / 2] : [],
      variant: config.variant,
      crews: 1,
    });
  };

  const demoEvents: CrewEvent[] = [];

  const startDemo = () => {
    const n = Math.min(MAX_DEMO, ctx.setup.count > 1 ? ctx.setup.count : demoFrames());
    const layout = demoLayout(n);
    demo = Array.from({ length: n }, (_, pos) => {
      const crew = createCrew({
        spec: layout.crews[0]!,
        layout,
        config,
        rng: ctx.rng(seedLabel(ctx.seed)).fork(`screen:${pos}`).fork("crew:0"),
        events: demoEvents,
      });
      // Start each crew at a different point of its run, so they don't descend in step.
      const lead = (pos * 7.3) % 18;
      for (let t = 0; t < lead * HZ; t++) crew.step(1 / HZ, 0);
      return {
        crew,
        view: {
          key: `demo:${pos}`,
          pos,
          layout,
          terrain: crew.terrain,
          color: colorAt(pos),
          pose: emptyPose(),
        },
      };
    });
  };

  const stopDemo = () => {
    demo = null;
    demoEvents.length = 0;
    renderer.clear();
  };

  const demoPose = (d: Demo, alpha: number) => {
    const c = d.crew;
    const p = d.view.pose;
    p.x = lerp(c.prev.x, c.craft.x, alpha);
    p.y = lerp(c.prev.y, c.craft.y, alpha);
    p.a = lerp(c.prev.a, c.craft.a, alpha);
    p.vx = c.craft.vx;
    p.vy = c.craft.vy;
    p.flags = shipFlags(c);
    p.phase = c.phase;
    p.phaseT = c.phaseT;
    p.stars = c.phase === "landed" ? (c.outcome?.stars ?? 0) : 0;
    p.attract = true;
    p.run = c.run;
    p.wind = c.wind;
    p.ghost = !!c.ghost && c.ghostAlpha > 0 && poseAt(c.ghost, c.runT, ghost);
    p.gx = ghost.x;
    p.gy = ghost.y;
    p.ga = ghost.a;
    p.gf = ghost.flags;
    p.galpha = c.ghostAlpha;
    d.view.terrain = c.terrain;
  };

  // ---- Touch frames -------------------------------------------------------------------------

  const offShip = ctx.net.on(TOPIC_SHIP, (data, from) => {
    if (disposed) return;
    const peer = ctx.net.peers().find((p) => p.frame === from);
    if (!peer || !isTouchFrame(peer)) return;
    const msg = decodeShip(data);
    if (!msg) return;
    const now = performance.now();
    if (!fleet.accept(msg, from, now)) return;
    received++;
    lastHeard = now;
    if (demo) stopDemo();
    if (!msg.attract && now - pokedAt > 1000) {
      pokedAt = now;
      ctx.idle.poke();
    }
  });

  const viewOf = (r: Remote): ShipView => {
    let v = views.get(r.frame);
    if (!v) {
      v = {
        key: r.frame,
        pos: r.pos,
        layout: r.layout,
        terrain: r.terrain,
        color: colorAt(r.pos),
        pose: emptyPose(),
      };
      views.set(r.frame, v);
    }
    v.pos = r.pos;
    v.layout = r.layout;
    v.terrain = r.terrain;
    v.color = colorAt(r.pos);
    return v;
  };

  const look = (now: number) => {
    dropped += fleet.prune(now);
    if (views.size > fleet.size) {
      const live = new Set<string>();
      for (const r of fleet.remotes()) live.add(r.frame);
      for (const key of views.keys()) if (!live.has(key)) views.delete(key);
    }
    if (demo || fleet.size > 0 || now - lastHeard <= DEMO_AFTER_MS) return;
    // Give touch frames in the roster a moment to start sending before flying our own crews.
    const touchFrames = ctx.net.peers().some(isTouchFrame);
    if (!touchFrames || now - mountedAt > DEMO_AFTER_MS) startDemo();
  };

  // ---- Loop ---------------------------------------------------------------------------------

  renderer.setup(frame);
  let lastRender = performance.now();
  const loop = ctx.loop({
    hz: HZ,
    update(dt) {
      if (disposed || !demo) return;
      for (const d of demo) d.crew.step(dt, performance.now());
      demoEvents.length = 0;
    },
    render(alpha) {
      if (disposed) return;
      const now = performance.now();
      const dt = Math.min(0.25, (now - lastRender) / 1000);
      lastRender = now;
      if (now >= lookAt) {
        lookAt = now + LOOK_MS;
        look(now);
      }
      ships.length = 0;
      if (demo) {
        for (const d of demo) {
          demoPose(d, alpha);
          ships.push(d.view);
        }
      } else {
        for (const r of fleet.remotes()) {
          const v = viewOf(r);
          if (fleet.poseOf(r, now, v.pose)) ships.push(v);
        }
        ships.sort((a, b) => a.pos - b.pos);
      }
      renderer.draw(ships, columns(), now / 1000, dt);
    },
  });
  loop.start();

  const offResize = ctx.onResize((f) => {
    frame = f;
    renderer.setup(frame);
  });

  const debugKey = "__touchdown";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => {
          const count = columns();
          return {
            screen: true,
            count,
            demo: demo !== null,
            received,
            dropped,
            width: frame.width / frame.unit,
            ships: ships.map((s) => {
              const at = renderer.place(s, count);
              return {
                key: s.key,
                pos: s.pos,
                attract: s.pose.attract,
                phase: s.pose.phase,
                run: s.pose.run,
                x: at.x,
                y: at.y,
                scale: at.s,
                pads: s.terrain.pads.map((p) => ({ ...p })),
              };
            }),
          };
        },
      },
    });
  }

  return {
    reset() {
      // The screen only mirrors the frames below, so there is nothing of theirs to reset; clearing
      // the fleet would just make every view blink at each idle timeout.
      renderer.clear();
      if (demo) for (const d of demo) d.crew.reset();
    },
    attract() {},
    status() {
      let people = 0;
      for (const s of ships) if (!s.pose.attract) people++;
      return { frames: fleet.size, playing: people, demo: demo !== null, received };
    },
    dispose() {
      disposed = true;
      loop.stop();
      offShip();
      offResize();
      renderer.dispose();
      fleet.clear();
      views.clear();
      ships.length = 0;
      demo = null;
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
