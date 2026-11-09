import type { Channel, PeerInfo } from "../../../src/core/types";
import {
  createUniverse,
  type Spec,
  step,
  takeEvents,
  type Event,
  type Universe,
} from "../../../src/apps/gravity/physics";

/** A plain universe: home at the origin, a big view, no drift correction unless asked. */
export const spec = (over: Partial<Spec> = {}): Spec => ({
  units: { gmUnit: 1e7, lenUnit: 1000, minR: 2, kmPx: 1e5 },
  home: { x: 0, y: 0 },
  keepR: 1e6,
  farR: 1e6,
  lostR: 1e7,
  maxBodies: 48,
  omega: 0,
  ...over,
});

export const universe = (over: Partial<Spec> = {}, k = 1000): Universe =>
  createUniverse(spec(over), k, 7);

export const run = (u: Universe, steps: number): Event[] => {
  const out: Event[] = [];
  for (let i = 0; i < steps; i++) {
    step(u);
    out.push(...takeEvents(u));
  }
  return out;
};

export const seconds = (s: number) => Math.round(s * 120);

/** Channels that deliver to each other at once, with a shared roster. */
export const fakeNet = () => {
  const peers: PeerInfo[] = [];
  const handlers = new Map<string, Map<string, Set<(data: unknown, from: string) => void>>>();
  let online = true;
  const sent: { from: string; to: string | undefined; topic: string; data: unknown }[] = [];
  const channel = (info: PeerInfo): Channel => {
    peers.push(info);
    handlers.set(info.frame, new Map());
    return {
      get online() {
        return online;
      },
      self: info.frame,
      peers: () => peers,
      leader: () => peers.find((p) => p.role === "screen")?.frame ?? peers[0]?.frame ?? null,
      send(topic, data, to) {
        if (!online) return;
        sent.push({ from: info.frame, to, topic, data });
        for (const [frame, topics] of handlers) {
          if (frame === info.frame || (to !== undefined && to !== frame)) continue;
          for (const cb of topics.get(topic) ?? [])
            cb(JSON.parse(JSON.stringify(data)), info.frame);
        }
      },
      on(topic, cb) {
        const topics = handlers.get(info.frame)!;
        let set = topics.get(topic);
        if (!set) topics.set(topic, (set = new Set()));
        set.add(cb);
        return () => set.delete(cb);
      },
      onPeers: () => () => {},
    };
  };
  return {
    channel,
    sent,
    peers,
    setOnline(v: boolean) {
      online = v;
    },
    remove(frame: string) {
      const i = peers.findIndex((p) => p.frame === frame);
      if (i >= 0) peers.splice(i, 1);
      handlers.delete(frame);
    },
  };
};

export const peer = (
  frame: string,
  role: PeerInfo["role"],
  pos = 0,
  side = 0,
  kind: PeerInfo["kind"] = role === "screen" ? "screen" : "panel",
): PeerInfo => ({ frame, app: "gravity", group: "main", kind, role, pos, side });
