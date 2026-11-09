import { isValidPeerId } from "./ids";
import { type Endpoint, type Link, netError, type Transport } from "./transport";

/**
 * In-memory network for unit tests. One FakeNet stands in for the broker and the paths between
 * frames; each simulated frame gets its own Transport from it. All delays use setTimeout, so
 * tests drive it with fake timers.
 */
export interface FakeNet {
  /** A transport for one simulated frame; `name` labels it in latency rules and failures. */
  transport(name: string): Transport;
  /** One-way delay in ms between two frames, or between a frame and "broker". */
  latency: (from: string, to: string) => number;
  /** When false, claims and new connections fail as "offline". Existing links keep working. */
  brokerUp: boolean;
  /** Whether the broker keeps a crashed frame's ids (it does, until `expire`). Reported to rooms
   * as `Transport.stale`; set before creating transports. */
  stale: boolean;
  /** How long the broker takes to report that nobody holds an id. When it is above 0, an offer
   * whose target gets claimed meanwhile is lost without an answer, as on the public broker. */
  expireDelay: number;
  /** Claims (new broker connections) made so far, to check how hard a room hits the broker. */
  claims: number;
  /** The frame's machine dies: nothing goes in or out, and the broker keeps its ids. */
  crash(name: string): void;
  /** The broker finally frees the ids a crashed frame held. */
  expire(name: string): void;
  /** The broker forgets an id without telling its holder. If someone else claims it within
   * a second the holder later learns it was taken; otherwise it quietly gets it back. */
  evict(id: string): void;
  /** No path between two frames: connections time out and traffic vanishes. */
  block(a: string, b: string): void;
  unblock(a: string, b: string): void;
  /** Ids the broker holds now. */
  held(): string[];
  /** Link ends still open. */
  links(): number;
}

export const BROKER = "broker";

interface Side {
  owner: string;
  remoteId: string;
  other: Side | null;
  handler: ((text: string) => void) | null;
  early: string[];
  onClose: (() => void) | null;
  closed: boolean;
  nextAt: number;
  ep: FakeEndpoint;
  link: Link;
}

interface FakeEndpoint {
  id: string;
  owner: string;
  closed: boolean;
  sides: Set<Side>;
  onLink: ((link: Link) => void) | null;
  early: Link[];
  onLost: ((reason: "taken" | "offline") => void) | null;
  /** Fails connect() calls still in progress when the endpoint closes. */
  connecting: Set<() => void>;
  api: Endpoint;
}

const EARLY_LIMIT = 64;

export const createFakeNet = (): FakeNet => {
  const registry = new Map<string, FakeEndpoint>();
  const crashed = new Set<string>();
  const blocked = new Set<string>();
  const open = new Set<Side>();

  const pair = (a: string, b: string) => (a < b ? `${a}\n${b}` : `${b}\n${a}`);
  const cut = (a: string, b: string) => crashed.has(a) || crashed.has(b) || blocked.has(pair(a, b));
  const later = (ms: number, fn: () => void) => {
    setTimeout(fn, Math.max(0, ms));
  };

  const finish = (side: Side) => {
    side.closed = true;
    open.delete(side);
    side.ep.sides.delete(side);
  };

  const makeSide = (ep: FakeEndpoint, remoteId: string): Side => {
    // Keep each direction in order, as a data channel does, even when latency varies.
    const schedule = (fn: () => void) => {
      const other = side.other;
      if (!other) return;
      const at = Math.max(Date.now() + net.latency(side.owner, other.owner), side.nextAt);
      side.nextAt = at;
      later(at - Date.now(), fn);
    };
    const link: Link = {
      remote: remoteId,
      send(text) {
        if (side.closed) return false;
        const other = side.other;
        if (!other || cut(side.owner, other.owner)) return true;
        schedule(() => {
          if (other.closed || cut(side.owner, other.owner)) return;
          if (other.handler) other.handler(text);
          else if (other.early.length < EARLY_LIMIT) other.early.push(text);
        });
        return true;
      },
      close() {
        if (side.closed) return;
        finish(side);
        const other = side.other;
        if (!other || cut(side.owner, other.owner)) return;
        schedule(() => {
          if (other.closed) return;
          finish(other);
          other.onClose?.();
        });
      },
      onMessage(cb) {
        side.handler = cb;
        for (const text of side.early.splice(0)) cb(text);
      },
      onClose(cb) {
        side.onClose = cb;
      },
      candidates: async () => "host/host",
    };
    const side: Side = {
      owner: ep.owner,
      remoteId,
      other: null,
      handler: null,
      early: [],
      onClose: null,
      closed: false,
      nextAt: 0,
      ep,
      link,
    };
    open.add(side);
    ep.sides.add(side);
    return side;
  };

  const offerLink = (ep: FakeEndpoint, link: Link) => {
    if (ep.onLink) ep.onLink(link);
    else if (ep.early.length < 16) ep.early.push(link);
    else link.close();
  };

  const connect = (ep: FakeEndpoint, target: string, timeoutMs: number): Promise<Link> =>
    new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => settle(netError("timeout")), timeoutMs);
      const abort = () => settle(netError("offline"));
      const settle = (err: Error | null, link?: Link) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        ep.connecting.delete(abort);
        if (err || !link) reject(err ?? netError("offline"));
        else resolve(link);
      };
      ep.connecting.add(abort);
      const reply = (err: Error) => later(net.latency(BROKER, ep.owner), () => settle(err));
      later(net.latency(ep.owner, BROKER), () => {
        if (ep.closed || crashed.has(ep.owner)) return settle(netError("offline"));
        if (!net.brokerUp) return reply(netError("offline"));
        const dst = registry.get(target);
        if (!dst) {
          later(net.expireDelay, () => {
            // Like the public PeerServer, lose an offer whose target was claimed while it waited.
            if (net.expireDelay > 0 && registry.has(target)) return;
            reply(netError("unavailable"));
          });
          return;
        }
        // A dead or unreachable holder never answers, so the caller times out.
        if (dst.closed || cut(ep.owner, dst.owner)) return;
        later(net.latency(BROKER, dst.owner), () => {
          if (done || dst.closed || cut(ep.owner, dst.owner)) return;
          const mine = makeSide(ep, dst.id);
          const theirs = makeSide(dst, ep.id);
          mine.other = theirs;
          theirs.other = mine;
          offerLink(dst, theirs.link);
          later(net.latency(dst.owner, ep.owner), () => {
            if (done) mine.link.close();
            else settle(null, mine.link);
          });
        });
      });
    });

  const makeEndpoint = (id: string, owner: string): FakeEndpoint => {
    const api: Endpoint = {
      id,
      onLink(cb) {
        ep.onLink = cb;
        for (const link of ep.early.splice(0)) cb(link);
      },
      connect: (target, timeoutMs) => connect(ep, target, timeoutMs),
      onLost(cb) {
        ep.onLost = cb;
      },
      close() {
        if (ep.closed) return;
        ep.closed = true;
        for (const side of ep.sides) side.link.close();
        for (const abort of ep.connecting) abort();
        // A crashed frame can't tell the broker it left, so its ids stay held.
        if (!crashed.has(owner) && registry.get(id) === ep) registry.delete(id);
      },
    };
    const ep: FakeEndpoint = {
      id,
      owner,
      closed: false,
      sides: new Set(),
      onLink: null,
      early: [],
      onLost: null,
      connecting: new Set(),
      api,
    };
    return ep;
  };

  const net: FakeNet = {
    latency: () => 5,
    brokerUp: true,
    stale: true,
    expireDelay: 0,
    claims: 0,
    transport(name) {
      return {
        stale: net.stale,
        open(id) {
          net.claims++;
          return new Promise((resolve, reject) => {
            later(net.latency(name, BROKER) + net.latency(BROKER, name), () => {
              if (!net.brokerUp || crashed.has(name)) return reject(netError("offline"));
              if (!isValidPeerId(id)) return reject(netError("invalid"));
              if (registry.has(id)) return reject(netError("taken"));
              const ep = makeEndpoint(id, name);
              registry.set(id, ep);
              resolve(ep.api);
            });
          });
        },
        close() {},
      };
    },
    crash(name) {
      crashed.add(name);
    },
    expire(name) {
      for (const [id, ep] of registry) if (ep.owner === name) registry.delete(id);
    },
    evict(id) {
      const ep = registry.get(id);
      if (!ep) return;
      registry.delete(id);
      later(1000, () => {
        if (ep.closed) return;
        if (registry.has(id)) ep.onLost?.("taken");
        else registry.set(id, ep);
      });
    },
    block(a, b) {
      blocked.add(pair(a, b));
    },
    unblock(a, b) {
      blocked.delete(pair(a, b));
    },
    held: () => [...registry.keys()],
    links: () => open.size,
  };
  return net;
};
