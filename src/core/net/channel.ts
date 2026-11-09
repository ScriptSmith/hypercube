import type { Channel, PeerInfo, RosterEntry } from "../types";
import { report } from "./util";

/** What a channel needs from its room. */
export interface ChannelHost {
  online(): boolean;
  self(): string;
  roster(): readonly RosterEntry[];
  /** Changes whenever the roster does, so channels can cache their filtered view. */
  version(): number;
  send(name: string, topic: string, data: unknown, to: string | undefined): void;
  release(name: string, handle: ChannelHandle): void;
}

export interface ChannelHandle extends Channel {
  readonly name: string;
  deliver(topic: string, data: unknown, from: string): void;
  /** Called after roster changes; fires onPeers when this channel's view changed. */
  notifyPeers(): void;
  /** Drop every handler and stop receiving this channel's messages (when no other handle for the
   * same name is open). */
  close(): void;
}

const rank = (a: PeerInfo, b: PeerInfo): number =>
  (a.role === "screen" ? 0 : 1) - (b.role === "screen" ? 0 : 1) ||
  a.pos - b.pos ||
  (a.frame < b.frame ? -1 : a.frame > b.frame ? 1 : 0);

/** A screen if there is one, else the lowest pos, else the lowest frame id; ties by frame id. */
export const leaderOf = (peers: readonly PeerInfo[]): string | null => {
  let best: PeerInfo | null = null;
  for (const p of peers) if (best === null || rank(p, best) < 0) best = p;
  return best?.frame ?? null;
};

/** Everything about a peer list that matters to apps, ignoring rtt and status churn. */
const peersKey = (peers: readonly PeerInfo[]): string =>
  JSON.stringify(
    peers.map((p) => [
      p.frame,
      p.app,
      p.group,
      p.kind,
      p.role,
      p.pos,
      p.side ?? 0,
      p.zone ?? "",
      p.display ?? "",
      (p as RosterEntry).duplicate === true,
    ]),
  );

export const createChannel = (
  name: string,
  host: ChannelHost,
  filter?: (p: PeerInfo) => boolean,
): ChannelHandle => {
  const topics = new Map<string, Set<(data: unknown, from: string) => void>>();
  const peerListeners = new Set<(peers: readonly PeerInfo[]) => void>();
  let cachedAt = -1;
  let cached: readonly PeerInfo[] = [];
  let lastKey = "";
  let closed = false;

  const accepts = (p: PeerInfo): boolean => {
    if (!filter) return true;
    try {
      return filter(p);
    } catch (err) {
      report(err);
      return false;
    }
  };

  const peers = (): readonly PeerInfo[] => {
    const v = host.version();
    if (v !== cachedAt) {
      cachedAt = v;
      cached = host.roster().filter(accepts);
    }
    return cached;
  };

  const handle: ChannelHandle = {
    name,
    get online() {
      return !closed && host.online();
    },
    get self() {
      return host.self();
    },
    peers,
    leader: () => leaderOf(peers()),
    send(topic, data, to) {
      if (!closed) host.send(name, topic, data, to);
    },
    on(topic, cb) {
      if (closed) return () => {};
      let set = topics.get(topic);
      if (!set) {
        set = new Set();
        topics.set(topic, set);
      }
      set.add(cb);
      return () => {
        const current = topics.get(topic);
        current?.delete(cb);
        if (current?.size === 0) topics.delete(topic);
      };
    },
    onPeers(cb) {
      if (closed) return () => {};
      if (peerListeners.size === 0) lastKey = peersKey(peers());
      peerListeners.add(cb);
      return () => {
        peerListeners.delete(cb);
      };
    },
    deliver(topic, data, from) {
      const set = topics.get(topic);
      if (!set) return;
      for (const cb of set) {
        try {
          cb(data, from);
        } catch (err) {
          report(err);
        }
      }
    },
    notifyPeers() {
      if (peerListeners.size === 0) return;
      const list = peers();
      const key = peersKey(list);
      if (key === lastKey) return;
      lastKey = key;
      for (const cb of peerListeners) {
        try {
          cb(list);
        } catch (err) {
          report(err);
        }
      }
    },
    close() {
      if (closed) return;
      closed = true;
      topics.clear();
      peerListeners.clear();
      host.release(name, handle);
    },
  };
  return handle;
};
