/**
 * The hub is one frame per room that keeps the roster, relays channel messages and answers clock
 * pings. Whichever frame holds a hub id acts as the hub, and it is also an ordinary member.
 *
 * Election. A room has HUB_SLOTS hub ids, `<namespace>-hub0` upwards; a lower slot outranks a
 * higher one. Screens claim slot 0 at once. Other frames wait 0.3 to 2 s, connect to the slots in
 * order through one random-id endpoint, and claim only a slot that nobody holds. Every claim is a
 * new broker connection and the public broker rate-limits those, so this keeps a room to about
 * one connection per frame. Frames with `hubEligible: false` never claim.
 *
 * Brokers and dead ids. The public PeerJS broker keeps a vanished peer's id for up to a minute,
 * so there (`Transport.stale`) a slot that is taken but doesn't answer is skipped for the next.
 * Our own signalling server (a ws(s):// URL) frees an id within a second of a crash, or after
 * 12 s on a half-open socket, and the BroadcastChannel transport claims ids with Web Locks, so
 * neither has stale ids: they retry the same slot, and a slow hub can't cause a second one.
 * signalling.ts holds the other per-broker settings.
 *
 * Two hubs. A hub on slot n > 0 probes the lower slots after 1 to 3 s and then every 10 s or so;
 * when one answers, it moves its clients there and steps down. A hub whose id is taken from it
 * (found on a broker reconnect) steps down to the same slot.
 *
 * Failover. Clients ping every 1.5 s and give up after 5 s of silence with three pings unanswered,
 * or when the link closes. The frame that would lead the rest of the roster claims at once. The
 * others join it over the broker connection they already have, after 1 to 3 s on the public
 * broker and 0.3 to 1 s on ours.
 */
import type { PeerInfo } from "../types";
import type { SyncClock } from "./clock";
import { hubId } from "./ids";
import {
  type FromHub,
  type Hello,
  MAX_MEMBERS,
  MAX_MESSAGE_BYTES,
  MAX_SUBS,
  PROTOCOL,
  readFromHub,
  readToHub,
  RELAY_BURST,
  RELAY_RATE,
  type StatusMap,
  type ToHub,
  type WireEntry,
} from "./protocol";
import type { Endpoint, Link } from "./transport";
import { createTimers } from "./util";

export interface Timing {
  /** Delay before a screen claims, as [min, max] ms. Also used by a failover successor. */
  screenDelay: [number, number];
  /** Delay before any other frame starts joining. */
  memberDelay: [number, number];
  /** Delay before the other frames rejoin after the hub goes away. */
  followDelay: [number, number];
  /** A joining frame that finds a slot free waits up to this long before claiming it. */
  claimSpread: number;
  /** One attempt at opening a link to a hub id (stale transports try twice). */
  connectTimeout: number;
  /** From link open to the hub's welcome (and the hub's wait for a hello). */
  welcomeTimeout: number;
  /** Client ping period; pings double as heartbeats. */
  heartbeat: number;
  /** A client gives up on a hub after this much silence (and three unanswered pings). */
  hubTimeout: number;
  /** The hub drops a silent member after this long. */
  memberTimeout: number;
  /** A hub on a higher slot first looks for lower-slot hubs after [min, max] ms... */
  probeFirst: [number, number];
  /** ...and then this often. */
  probeEvery: number;
  /** Backoff after a failed election doubles from retryMin. Broker failures back off up to
   * retryMax; other failures (no hub reachable yet) up to retryJoinMax. */
  retryMin: number;
  retryMax: number;
  retryJoinMax: number;
  /** Roster changes are batched for this long before the hub sends them. */
  rosterFlush: number;
  /** Status updates from one frame are sent at most this often. */
  statusEvery: number;
}

export const TIMING: Timing = {
  screenDelay: [0, 200],
  memberDelay: [300, 2000],
  followDelay: [1000, 3000],
  claimSpread: 1500,
  connectTimeout: 5000,
  welcomeTimeout: 6000,
  heartbeat: 1500,
  hubTimeout: 5000,
  memberTimeout: 7000,
  probeFirst: [1000, 3000],
  probeEvery: 10_000,
  retryMin: 2000,
  retryMax: 300_000,
  retryJoinMax: 15_000,
  rosterFlush: 100,
  statusEvery: 1000,
};

/** The room's view of one frame. The hub assigns keys; key "0" is the hub itself. */
export interface Entry {
  key: string;
  info: PeerInfo;
  joinedAt: number;
  status?: StatusMap;
  rtt?: number;
  /** This frame never becomes the hub, so it can't be a failover successor. */
  noHub?: boolean;
}

export const toWire = (e: Entry): WireEntry => {
  const w: WireEntry = { k: e.key, i: e.info, j: e.joinedAt };
  if (e.status) w.s = e.status;
  if (e.rtt !== undefined) w.r = Math.round(e.rtt);
  if (e.noHub) w.n = 1;
  return w;
};

export const fromWire = (w: WireEntry): Entry => {
  const e: Entry = { key: w.k, info: w.i, joinedAt: w.j };
  if (w.s) e.status = w.s;
  if (w.r !== undefined) e.rtt = w.r;
  if (w.n) e.noHub = true;
  return e;
};

export interface HubDeps {
  endpoint: Endpoint;
  slot: number;
  ns: string;
  /** The room's roster, which the hub owns while it runs. Holds `self` under key "0". */
  entries: Map<string, Entry>;
  self: Entry;
  clock: SyncClock;
  timing: Timing;
  random: () => number;
  /** Whether this frame has the channel open. */
  subscribed(name: string): boolean;
  deliver(name: string, topic: string, data: unknown, from: string): void;
  /** The roster changed. */
  changed(): void;
  /** Stop being the hub: move everyone to `slot`, or re-elect when null. */
  stepDown(slot: number | null): void;
  traffic(bytesIn: number, bytesOut: number): void;
}

export interface Hub {
  /** A message from this frame's own channel. False when it was dropped. */
  relay(name: string, topic: string, data: unknown, to: string | undefined): boolean;
  /** An entry changed locally (the hub's own info or status). */
  touched(key: string): void;
  links(): Link[];
  /** Tell members goodbye, or to move to a slot, then release the hub id. */
  close(farewell: "bye" | number): void;
}

interface Member {
  key: string;
  link: Link;
  subs: Set<string>;
  lastSeen: number;
  tokens: number;
  refilledAt: number;
  rttMarkedAt: number;
}

/** A member's rtt is re-broadcast only when it moves this much, and at most this often. */
const RTT_CHANGE = 0.25;
const RTT_EVERY_MS = 10_000;
const SWEEP_MS = 1000;

export const createHub = (d: HubDeps): Hub => {
  const timers = createTimers();
  const members = new Map<string, Member>();
  /** Links that are not members: before their hello, and probes in both directions. */
  const loose = new Set<Link>();
  const dirty = new Set<string>();
  const removed = new Set<string>();
  const now = d.clock.local;
  let counter = 0;
  let flushQueued = false;
  let closed = false;

  const sendText = (link: Link, text: string) => {
    if (link.send(text)) d.traffic(0, text.length);
  };
  const send = (link: Link, msg: FromHub) => sendText(link, JSON.stringify(msg));

  const flush = () => {
    flushQueued = false;
    if (closed) return;
    const u: WireEntry[] = [];
    for (const key of dirty) {
      const e = d.entries.get(key);
      if (e) u.push(toWire(e));
    }
    const x = [...removed];
    dirty.clear();
    removed.clear();
    if (u.length === 0 && x.length === 0) return;
    const text = JSON.stringify({ t: "ro", u, x } satisfies FromHub);
    for (const m of members.values()) sendText(m.link, text);
  };

  const mark = (key: string) => {
    dirty.add(key);
    removed.delete(key);
    if (!flushQueued) {
      flushQueued = true;
      timers.after(d.timing.rosterFlush, flush);
    }
    d.changed();
  };

  const drop = (m: Member) => {
    if (members.get(m.key) !== m) return;
    members.delete(m.key);
    d.entries.delete(m.key);
    dirty.delete(m.key);
    removed.add(m.key);
    if (!flushQueued) {
      flushQueued = true;
      timers.after(d.timing.rosterFlush, flush);
    }
    d.changed();
  };

  const route = (
    from: string,
    fromKey: string,
    name: string,
    topic: string,
    data: unknown,
    to: string | undefined,
  ): boolean => {
    let text: string;
    try {
      text = JSON.stringify({ t: "m", c: name, k: topic, d: data, f: from } satisfies FromHub);
    } catch {
      return false;
    }
    if (text.length > MAX_MESSAGE_BYTES) return false;
    for (const m of members.values()) {
      if (m.key === fromKey || !m.subs.has(name)) continue;
      if (to !== undefined && d.entries.get(m.key)?.info.frame !== to) continue;
      sendText(m.link, text);
    }
    if (
      fromKey !== d.self.key &&
      d.subscribed(name) &&
      (to === undefined || to === d.self.info.frame)
    ) {
      d.deliver(name, topic, data, from);
    }
    return true;
  };

  /** Token bucket per member, so one runaway frame can't flood everyone else. */
  const spend = (m: Member): boolean => {
    const t = now();
    m.tokens = Math.min(RELAY_BURST, m.tokens + ((t - m.refilledAt) / 1000) * RELAY_RATE);
    m.refilledAt = t;
    if (m.tokens < 1) return false;
    m.tokens -= 1;
    return true;
  };

  const noteRtt = (m: Member, entry: Entry, rtt: number) => {
    const prev = entry.rtt;
    const moved = prev === undefined || Math.abs(rtt - prev) > Math.max(5, prev * RTT_CHANGE);
    if (!moved || (prev !== undefined && now() - m.rttMarkedAt < RTT_EVERY_MS)) return;
    entry.rtt = Math.round(rtt);
    m.rttMarkedAt = now();
    mark(m.key);
  };

  const join = (link: Link, hello: Hello): Member | null => {
    if (members.size >= MAX_MEMBERS) {
      send(link, { t: "full" });
      link.close();
      return null;
    }
    const key = String(++counter);
    const t = now();
    const member: Member = {
      key,
      link,
      subs: new Set(hello.c),
      lastSeen: t,
      tokens: RELAY_BURST,
      refilledAt: t,
      rttMarkedAt: 0,
    };
    members.set(key, member);
    const entry: Entry = { key, info: hello.i, joinedAt: Math.round(d.clock.now()) };
    if (hello.s) entry.status = hello.s;
    if (hello.n) entry.noHub = true;
    d.entries.set(key, entry);
    send(link, {
      t: "wel",
      v: PROTOCOL,
      k: key,
      h: d.self.info.frame,
      s: d.slot,
      r: [...d.entries.values()].map(toWire),
    });
    mark(key);
    return member;
  };

  const handle = (m: Member, msg: ToHub) => {
    const entry = d.entries.get(m.key);
    if (!entry) return;
    m.lastSeen = now();
    switch (msg.t) {
      case "info":
        entry.info = msg.i;
        mark(m.key);
        break;
      case "st":
        entry.status = msg.s;
        mark(m.key);
        break;
      case "sub":
        m.subs.delete(msg.c);
        m.subs.add(msg.c);
        if (m.subs.size > MAX_SUBS) {
          const oldest = m.subs.values().next();
          if (!oldest.done) m.subs.delete(oldest.value);
        }
        break;
      case "uns":
        m.subs.delete(msg.c);
        break;
      case "m":
        if (spend(m)) route(entry.info.frame, m.key, msg.c, msg.k, msg.d, msg.to);
        break;
      case "pi":
        send(m.link, { t: "po", n: msg.n, a: msg.a, h: d.clock.now() });
        if (msg.r !== undefined) noteRtt(m, entry, msg.r);
        break;
      case "bye":
        m.link.close();
        drop(m);
        break;
      default:
        break;
    }
  };

  const accept = (link: Link) => {
    if (closed) {
      link.close();
      return;
    }
    let member: Member | null = null;
    loose.add(link);
    const cancelHello = timers.after(d.timing.welcomeTimeout, () => {
      if (member) return;
      loose.delete(link);
      link.close();
    });
    link.onMessage((text) => {
      d.traffic(text.length, 0);
      if (text.length > MAX_MESSAGE_BYTES + 1024) return;
      const msg = readToHub(text);
      if (!msg) return;
      if (member) {
        handle(member, msg);
        return;
      }
      if (msg.t === "hello") {
        cancelHello();
        loose.delete(link);
        member = join(link, msg);
      } else if (msg.t === "probe") {
        send(link, { t: "hub", s: d.slot });
      }
    });
    link.onClose(() => {
      cancelHello();
      loose.delete(link);
      if (member) drop(member);
    });
  };

  let sweptAt = now();
  const sweep = () => {
    const t = now();
    // If this frame's event loop stalled, members' pings are queued behind it; don't count the
    // stall against them.
    const stall = t - sweptAt - SWEEP_MS;
    sweptAt = t;
    if (stall > SWEEP_MS) for (const m of members.values()) m.lastSeen += stall;
    for (const m of members.values()) {
      if (t - m.lastSeen <= d.timing.memberTimeout) continue;
      m.link.close();
      drop(m);
    }
  };

  /** Resolves true when a live hub holds `slot`. */
  const answers = async (slot: number): Promise<boolean> => {
    let link: Link;
    try {
      link = await d.endpoint.connect(hubId(d.ns, slot), d.timing.connectTimeout);
    } catch {
      return false;
    }
    if (closed) {
      link.close();
      return false;
    }
    loose.add(link);
    const found = await new Promise<boolean>((resolve) => {
      const cancel = timers.after(d.timing.welcomeTimeout, () => resolve(false));
      link.onMessage((text) => {
        if (readFromHub(text)?.t !== "hub") return;
        cancel();
        resolve(true);
      });
      link.onClose(() => {
        cancel();
        resolve(false);
      });
      sendText(link, JSON.stringify({ t: "probe", s: d.slot } satisfies ToHub));
    });
    loose.delete(link);
    link.close();
    return found;
  };

  const probe = async () => {
    for (let slot = 0; slot < d.slot; slot++) {
      if (closed) return;
      if (await answers(slot)) {
        if (!closed) d.stepDown(slot);
        return;
      }
    }
    if (!closed) probeLater([d.timing.probeEvery * 0.75, d.timing.probeEvery * 1.25]);
  };

  const probeLater = ([lo, hi]: [number, number]) => {
    timers.after(lo + d.random() * (hi - lo), () => void probe());
  };

  d.endpoint.onLink(accept);
  d.endpoint.onLost((reason) => {
    if (!closed) d.stepDown(reason === "taken" ? d.slot : null);
  });
  timers.every(SWEEP_MS, sweep);
  if (d.slot > 0) probeLater(d.timing.probeFirst);

  return {
    relay: (name, topic, data, to) => route(d.self.info.frame, d.self.key, name, topic, data, to),
    touched: mark,
    links: () => [...members.values()].map((m) => m.link),
    close(farewell) {
      if (closed) return;
      closed = true;
      timers.clear();
      const text = JSON.stringify(
        (farewell === "bye" ? { t: "bye" } : { t: "mv", s: farewell }) satisfies FromHub,
      );
      for (const m of members.values()) {
        sendText(m.link, text);
        m.link.close();
      }
      for (const link of loose) link.close();
      members.clear();
      loose.clear();
      d.endpoint.close();
    },
  };
};
