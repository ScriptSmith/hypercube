/**
 * Debug only (`debug=1`): `window.__hockey` for the versus e2e tests. It logs pucks crossing a
 * versus open end, in frame venue px and shared clock ms, and can hold back this frame's versus
 * messages for a while, like a slow network.
 */
import type { Channel, Clock } from "../../core/types";
import type { Side } from "./config";
import { apply } from "./layout";
import type { TableEvent } from "./table";

const DEBUG_KEY = "__hockey";
const MAX_LOG = 48;
const MAX_HELD = 256;

export interface Crossing {
  kind: "out" | "in";
  id: number;
  /** Shared clock ms. */
  t: number;
  /** Centre and velocity in frame venue px and px/s. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Puck radius and speed cap, and the lane's top and height, venue px. */
  r: number;
  cap: number;
  top: number;
  height: number;
  /** How far the centre is inside the open end, in radii (negative while partly outside). */
  depth: number;
}

export interface Probe {
  /** The channel for versus to use: messages sent on it wait out the lag. */
  readonly net: Channel;
  event(e: TableEvent): void;
  dispose(): void;
}

export const createProbe = (base: Channel, clock: Clock, side: Side): Probe => {
  const log: Crossing[] = [];
  const held = new Set<number>();
  let lag = 0;

  const net: Channel = {
    get online() {
      return base.online;
    },
    get self() {
      return base.self;
    },
    peers: () => base.peers(),
    leader: () => base.leader(),
    on: (topic, cb) => base.on(topic, cb),
    onPeers: (cb) => base.onPeers(cb),
    send(topic, data, to) {
      if (lag <= 0) {
        base.send(topic, data, to);
        return;
      }
      if (held.size >= MAX_HELD) return;
      const id = window.setTimeout(() => {
        held.delete(id);
        base.send(topic, data, to);
      }, lag);
      held.add(id);
    },
  };

  Object.defineProperty(window, DEBUG_KEY, {
    configurable: true,
    value: {
      state: () => ({ side, clock: clock.now(), lag, crossings: [...log] }),
      setLag: (ms: number) => {
        lag = Math.max(0, Math.min(2000, ms));
      },
    },
  });

  return {
    net,
    event(e) {
      if (e.type !== "exit" && e.type !== "enter") return;
      const { lane, puck: p } = e;
      const params = lane.spec.params;
      if (params.ends[1].kind !== "open" || params.variant === "defence") return;
      const t = lane.spec.toVenue;
      const at = apply(t, p.x, p.y);
      log.push({
        kind: e.type === "exit" ? "out" : "in",
        id: p.id,
        t: e.at,
        x: at.x,
        y: at.y,
        vx: t.a * p.vx + t.c * p.vy,
        vy: t.b * p.vx + t.d * p.vy,
        r: params.puckR,
        cap: params.maxPuck,
        top: lane.spec.rect.y,
        height: lane.spec.rect.height,
        depth: (params.length - p.x) / params.puckR,
      });
      if (log.length > MAX_LOG) log.shift();
    },
    dispose() {
      for (const id of held) window.clearTimeout(id);
      held.clear();
      Reflect.deleteProperty(window, DEBUG_KEY);
    },
  };
};
