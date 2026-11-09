import { type Layout, layoutFor, type LayoutInput } from "../../../src/apps/loom/layout";
import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";
import type { Channel, FrameKind, PeerInfo } from "../../../src/core/types";

export const DT = 1 / 60;

export const layoutInput = (kind: FrameKind, over: Partial<LayoutInput> = {}): LayoutInput => {
  const { width, height } = VENUE_SIZE[kind];
  const reach = DEFAULT_REACH[kind];
  return {
    kind,
    width,
    height,
    reachTop: { adult: height * (1 - reach.adult), child: height * (1 - reach.child) },
    seams: kind === "pair" ? [width / 2] : [],
    bank: false,
    harmonics: 10,
    firstK: 1,
    ...over,
  };
};

export const layoutOf = (kind: FrameKind, over: Partial<LayoutInput> = {}): Layout =>
  layoutFor(layoutInput(kind, over));

/**
 * Channels on an in-memory bus. Messages are delivered when `flush()` runs (or at once with
 * `sync`), to every other channel or the one named. `online` and the roster can be changed.
 */
export interface Bus {
  channel(info: PeerInfo): Channel;
  peers: PeerInfo[];
  online: boolean;
  flush(): void;
  /** Drop a frame: its channel stops hearing and the roster forgets it. */
  remove(frame: string): void;
  sent: { topic: string; from: string; to?: string }[];
}

export const createBus = (sync = true): Bus => {
  const handlers = new Map<string, Map<string, Set<(d: unknown, from: string) => void>>>();
  const queue: (() => void)[] = [];
  const bus: Bus = {
    peers: [],
    online: true,
    sent: [],
    channel(info) {
      bus.peers.push(info);
      const mine = new Map<string, Set<(d: unknown, from: string) => void>>();
      handlers.set(info.frame, mine);
      const ch: Channel = {
        get online() {
          return bus.online;
        },
        self: info.frame,
        peers: () => bus.peers,
        leader: () => null,
        send(topic, data, to) {
          if (!bus.online) return;
          bus.sent.push({ topic, from: info.frame, to });
          const copy = JSON.parse(JSON.stringify(data)) as unknown;
          for (const [frame, hs] of handlers) {
            if (frame === info.frame || (to && frame !== to)) continue;
            const set = hs.get(topic);
            if (!set) continue;
            for (const h of set) {
              const deliver = () => h(copy, info.frame);
              if (sync) deliver();
              else queue.push(deliver);
            }
          }
        },
        on(topic, cb) {
          let set = mine.get(topic);
          if (!set) mine.set(topic, (set = new Set()));
          set.add(cb);
          return () => set.delete(cb);
        },
        onPeers: () => () => {},
      };
      return ch;
    },
    flush() {
      while (queue.length > 0) queue.shift()!();
    },
    remove(frame) {
      handlers.delete(frame);
      bus.peers = bus.peers.filter((p) => p.frame !== frame);
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
  app: "loom",
  group: "main",
  kind,
  role: kind === "screen" ? "screen" : "station",
  pos,
  side: 0,
  ...(kind === "pair" ? { span: 2 } : {}),
  ...over,
});
