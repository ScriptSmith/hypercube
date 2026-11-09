import { isValidPeerId } from "./ids";
import { type Endpoint, type Link, netError, type Transport } from "./transport";
import { randomToken } from "./util";

/**
 * BroadcastChannel transport for frames that share a browser process, such as the simulator's
 * iframes. Every endpoint has an inbox channel named after its id, which carries link setup and
 * data.
 *
 * Claiming an id takes a Web Lock of the same name. Locks are granted atomically and released
 * by the browser when a page goes away, so there are no races and no stale ids, however busy
 * the shared event loop is. Where Web Locks are missing, claims fall back to a broadcast
 * protocol: a claim stands if no holder objects within CLAIM_WAIT_MS, and holders announce
 * themselves so that a conflict missed under load is still settled (the earlier holder keeps
 * the id).
 */
const PREFIX = "hc-local";
const CLAIM_WAIT_MS = 250;
const HELD_EVERY_MS = 2000;
/** Without locks we can't tell whether an id is held, so a connect that gets no answer in this
 * long counts as "nobody holds it". */
const FALLBACK_CONNECT_MS = 2500;
const QUEUE_LIMIT = 32;
const EARLY_LIMIT = 64;

type ControlMsg =
  | { t: "claim"; id: string; n: number }
  | { t: "taken"; id: string; n: number }
  | { t: "held"; id: string; at: number; n: number };

type InboxMsg =
  | { t: "conn"; l: string; from: string }
  | { t: "acc"; l: string }
  | { t: "data"; l: string; d: string }
  | { t: "fin"; l: string };

/** A claim in the fallback protocol. */
interface Holder {
  /** Lower wins a race between pending claims. */
  nonce: number;
  /** Date.now() when the claim stood; the earlier holder wins a conflict. */
  at: number;
  pending: boolean;
  lose(): void;
}

interface LinkState {
  handler: ((text: string) => void) | null;
  early: string[];
  onClose: (() => void) | null;
  closed: boolean;
  link: Link;
  remoteClosed(): void;
}

const isMsg = (v: unknown): v is { t: string } =>
  typeof v === "object" && v !== null && typeof (v as { t?: unknown }).t === "string";

const lockName = (id: string) => `${PREFIX}:${id}`;

export interface LocalOptions {
  /** Use Web Locks for claims when the browser has them. Default true. */
  locks?: boolean;
}

export const localTransport = (ns: string, options: LocalOptions = {}): Transport => {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  const locks = options.locks === false ? undefined : nav?.locks;
  const control = new BroadcastChannel(`${PREFIX}:${ns}`);
  const holders = new Map<string, Holder>();
  let closed = false;
  let heldTimer: ReturnType<typeof setInterval> | null = null;

  const post = (msg: ControlMsg) => {
    if (!closed) control.postMessage(msg);
  };

  const announce = (id: string, h: Holder) => post({ t: "held", id, at: h.at, n: h.nonce });

  control.onmessage = (e: MessageEvent<unknown>) => {
    if (!isMsg(e.data)) return;
    const m = e.data as ControlMsg;
    const h = holders.get(m.id);
    if (!h) return;
    switch (m.t) {
      case "claim":
        // A holder always objects; of two pending claimants the lower nonce wins.
        if (!h.pending || h.nonce < m.n) post({ t: "taken", id: m.id, n: m.n });
        else h.lose();
        break;
      case "taken":
        if (h.pending && m.n === h.nonce) h.lose();
        break;
      case "held":
        if (h.pending || m.at < h.at || (m.at === h.at && m.n < h.nonce)) h.lose();
        // The other holder is the later one; tell it now rather than at the next announcement.
        else announce(m.id, h);
        break;
      default:
        break;
    }
  };

  /** Whether anyone holds `id`, or null when we can't know. */
  const isHeld = async (id: string): Promise<boolean | null> => {
    if (!locks) return null;
    try {
      const state = await locks.query();
      return state.held?.some((l) => l.name === lockName(id)) ?? false;
    } catch {
      return null;
    }
  };

  const makeEndpoint = (id: string, release: () => void) => {
    const inbox = new BroadcastChannel(`${PREFIX}:${id}`);
    const links = new Map<string, LinkState>();
    const outboxes = new Map<string, { bc: BroadcastChannel; refs: number }>();
    const connecting = new Map<
      string,
      { to: string; resolve: (link: Link) => void; reject: (err: Error) => void; cancel(): void }
    >();
    const queued: { l: string; from: string }[] = [];
    const earlyLinks: Link[] = [];
    let onLink: ((link: Link) => void) | null = null;
    let onLost: ((reason: "taken" | "offline") => void) | null = null;
    let active = false;
    let dead = false;

    const outbox = (remote: string) => {
      let box = outboxes.get(remote);
      if (!box) {
        box = { bc: new BroadcastChannel(`${PREFIX}:${remote}`), refs: 0 };
        outboxes.set(remote, box);
      }
      box.refs++;
      return box.bc;
    };
    const releaseOutbox = (remote: string) => {
      const box = outboxes.get(remote);
      if (!box || --box.refs > 0) return;
      box.bc.close();
      outboxes.delete(remote);
    };

    const makeLink = (l: string, remote: string, out: BroadcastChannel): Link => {
      const shut = () => {
        state.closed = true;
        links.delete(l);
        releaseOutbox(remote);
      };
      const link: Link = {
        remote,
        send(text) {
          if (state.closed) return false;
          out.postMessage({ t: "data", l, d: text } satisfies InboxMsg);
          return true;
        },
        close() {
          if (state.closed) return;
          out.postMessage({ t: "fin", l } satisfies InboxMsg);
          shut();
        },
        onMessage(cb) {
          state.handler = cb;
          for (const text of state.early.splice(0)) cb(text);
        },
        onClose(cb) {
          state.onClose = cb;
        },
      };
      const state: LinkState = {
        handler: null,
        early: [],
        onClose: null,
        closed: false,
        link,
        remoteClosed() {
          if (state.closed) return;
          shut();
          state.onClose?.();
        },
      };
      links.set(l, state);
      return link;
    };

    const accept = (l: string, from: string) => {
      const out = outbox(from);
      out.postMessage({ t: "acc", l } satisfies InboxMsg);
      const link = makeLink(l, from, out);
      if (onLink) onLink(link);
      else if (earlyLinks.length < 16) earlyLinks.push(link);
      else link.close();
    };

    inbox.onmessage = (e: MessageEvent<unknown>) => {
      if (dead || !isMsg(e.data)) return;
      const m = e.data as InboxMsg;
      switch (m.t) {
        case "conn":
          if (active) accept(m.l, m.from);
          else if (queued.length < QUEUE_LIMIT) queued.push({ l: m.l, from: m.from });
          break;
        case "acc": {
          const c = connecting.get(m.l);
          if (!c) break;
          connecting.delete(m.l);
          c.cancel();
          c.resolve(makeLink(m.l, c.to, outbox(c.to)));
          releaseOutbox(c.to);
          break;
        }
        case "data": {
          const s = links.get(m.l);
          if (!s || typeof m.d !== "string") break;
          if (s.handler) s.handler(m.d);
          else if (s.early.length < EARLY_LIMIT) s.early.push(m.d);
          break;
        }
        case "fin":
          links.get(m.l)?.remoteClosed();
          break;
        default:
          break;
      }
    };

    const shutdown = () => {
      if (dead) return;
      dead = true;
      for (const s of links.values()) s.link.close();
      for (const [l, c] of connecting) {
        c.cancel();
        releaseOutbox(c.to);
        c.reject(netError("offline"));
        connecting.delete(l);
      }
      queued.length = 0;
      inbox.close();
      for (const box of outboxes.values()) box.bc.close();
      outboxes.clear();
      release();
    };

    const connect = async (target: string, timeoutMs: number): Promise<Link> => {
      const held = await isHeld(target);
      if (dead) throw netError("offline");
      if (held === false) throw netError("unavailable");
      return new Promise((resolve, reject) => {
        const l = randomToken(Math.random, 10);
        const limit = held === null ? Math.min(timeoutMs, FALLBACK_CONNECT_MS) : timeoutMs;
        const timer = setTimeout(() => {
          if (!connecting.delete(l)) return;
          releaseOutbox(target);
          reject(netError(held === null ? "unavailable" : "timeout"));
        }, limit);
        connecting.set(l, { to: target, resolve, reject, cancel: () => clearTimeout(timer) });
        outbox(target).postMessage({ t: "conn", l, from: id } satisfies InboxMsg);
      });
    };

    const api: Endpoint = {
      id,
      onLink(cb) {
        onLink = cb;
        for (const link of earlyLinks.splice(0)) cb(link);
      },
      connect,
      onLost(cb) {
        onLost = cb;
      },
      close: shutdown,
    };

    return {
      api,
      activate() {
        active = true;
        for (const q of queued.splice(0)) accept(q.l, q.from);
      },
      dispose: shutdown,
      lost() {
        if (dead) return;
        shutdown();
        onLost?.("taken");
      },
    };
  };

  const claimByLock = (lockApi: LockManager, id: string): Promise<Endpoint> =>
    new Promise((resolve, reject) => {
      let unlock: () => void = () => {};
      const ep = makeEndpoint(id, () => unlock());
      lockApi
        .request(lockName(id), { ifAvailable: true }, (lock) => {
          if (!lock) {
            ep.dispose();
            reject(netError("taken"));
            return undefined;
          }
          // The lock is held until this promise settles, which closing the endpoint does.
          return new Promise<void>((release) => {
            unlock = release;
            ep.activate();
            resolve(ep.api);
          });
        })
        .catch(() => {
          ep.dispose();
          reject(netError("offline"));
        });
    });

  const claimByBroadcast = (id: string, priority: number | undefined): Promise<Endpoint> => {
    if (holders.has(id)) return Promise.reject(netError("taken"));
    return new Promise((resolve, reject) => {
      const holder: Holder = {
        nonce: (priority ?? 1) + Math.random() * 1e-3,
        at: 0,
        pending: true,
        lose: () => {},
      };
      const ep = makeEndpoint(id, () => {
        if (holders.get(id) === holder) holders.delete(id);
      });
      holders.set(id, holder);
      const timer = setTimeout(() => {
        holder.pending = false;
        holder.at = Date.now();
        holder.lose = () => ep.lost();
        ep.activate();
        announce(id, holder);
        heldTimer ??= setInterval(() => {
          for (const [hid, h] of holders) if (!h.pending) announce(hid, h);
        }, HELD_EVERY_MS);
        resolve(ep.api);
      }, CLAIM_WAIT_MS);
      holder.lose = () => {
        clearTimeout(timer);
        ep.dispose();
        reject(netError("taken"));
      };
      post({ t: "claim", id, n: holder.nonce });
    });
  };

  return {
    stale: false,
    open(id, priority) {
      if (closed) return Promise.reject(netError("offline"));
      if (!isValidPeerId(id)) return Promise.reject(netError("invalid"));
      return locks ? claimByLock(locks, id) : claimByBroadcast(id, priority);
    },
    close() {
      if (closed) return;
      closed = true;
      if (heldTimer !== null) clearInterval(heldTimer);
      control.close();
    },
  };
};
