import { layoutFor, type Layout, type LayoutInput } from "../../../src/apps/fourd/layout";
import type { Dim } from "../../../src/apps/fourd/shapes";
import { VENUE_SIZE } from "../../../src/core/frame";
import type { Channel, FrameKind, PeerInfo } from "../../../src/core/types";
import { DEFAULT_VENUE, displayFor, reachFor } from "../../../src/core/venue";

/** The default venue's size of each kind, which the designs are drawn for. */
export const SIZES = Object.fromEntries(
  Object.entries(VENUE_SIZE).map(([kind, s]) => [kind, [s.width, s.height]]),
) as Record<FrameKind, [number, number]>;

/** Venue y of the top of adult and child reach, from the venue's default mounting. */
export const reachTop = (kind: FrameKind) => {
  const d = displayFor(kind, kind === "pair" ? 2 : 1, DEFAULT_VENUE);
  const r = reachFor(d);
  const h = SIZES[kind][1];
  return { adult: h * (1 - r.adult), child: h * (1 - r.child) };
};

export const layoutOf = (kind: FrameKind, dims: Dim[], over: Partial<LayoutInput> = {}): Layout => {
  const [width, height] = SIZES[kind];
  return layoutFor({
    kind,
    width,
    height,
    reachTop: reachTop(kind),
    seams: kind === "pair" ? [width / 2] : [],
    dims,
    bank: false,
    ...over,
  });
};

/** Channels on an in-memory bus: messages arrive at once at every other channel, or the one named. */
export interface Bus {
  channel(info: PeerInfo): Channel;
  peers: PeerInfo[];
  online: boolean;
  remove(frame: string): void;
  sent: { topic: string; from: string; to?: string; data: unknown }[];
  /** Deliver a raw message as if `from` sent it. */
  inject(topic: string, data: unknown, from: string, to?: string): void;
}

export const createBus = (): Bus => {
  const handlers = new Map<string, Map<string, Set<(d: unknown, from: string) => void>>>();
  const deliver = (topic: string, data: unknown, from: string, to?: string) => {
    const copy = JSON.parse(JSON.stringify(data)) as unknown;
    for (const [frame, hs] of handlers) {
      if (frame === from || (to && frame !== to)) continue;
      for (const h of hs.get(topic) ?? []) h(copy, from);
    }
  };
  const bus: Bus = {
    peers: [],
    online: true,
    sent: [],
    channel(info) {
      bus.peers.push(info);
      const mine = new Map<string, Set<(d: unknown, from: string) => void>>();
      handlers.set(info.frame, mine);
      return {
        get online() {
          return bus.online;
        },
        self: info.frame,
        peers: () => bus.peers,
        leader: () => {
          const scr = bus.peers.find((p) => p.role === "screen");
          if (scr) return scr.frame;
          const sorted = [...bus.peers].sort((a, b) => a.pos - b.pos);
          return sorted[0]?.frame ?? null;
        },
        send(topic, data, to) {
          if (!bus.online) return;
          bus.sent.push({ topic, from: info.frame, to, data });
          deliver(topic, data, info.frame, to);
        },
        on(topic, cb) {
          let set = mine.get(topic);
          if (!set) mine.set(topic, (set = new Set()));
          set.add(cb);
          return () => set.delete(cb);
        },
        onPeers: () => () => {},
      };
    },
    remove(frame) {
      handlers.delete(frame);
      bus.peers = bus.peers.filter((p) => p.frame !== frame);
    },
    inject(topic, data, from, to) {
      deliver(topic, data, from, to);
    },
  };
  return bus;
};

export const peer = (
  frame: string,
  kind: FrameKind,
  pos: number,
  over: Partial<PeerInfo> = {},
): PeerInfo => ({
  frame,
  app: "fourd",
  group: "main",
  kind,
  role: kind === "screen" ? "screen" : "station",
  pos,
  side: 0,
  ...(kind === "pair" ? { span: 2 } : {}),
  ...over,
});
