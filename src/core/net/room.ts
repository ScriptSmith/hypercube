import type { Clock, PeerInfo, Room, RoomOptions, RosterEntry } from "../types";
import { type ChannelHandle, type ChannelHost, createChannel, leaderOf } from "./channel";
import { createSyncClock } from "./clock";
import { createHub, type Entry, fromWire, type Hub, TIMING, type Timing } from "./hub";
import { HUB_SLOTS, hubId, memberId, roomNamespace } from "./ids";
import {
  cleanInfo,
  cleanStatus,
  type FromHub,
  type Hello,
  MAX_MEMBERS,
  MAX_MESSAGE_BYTES,
  PROTOCOL,
  readFromHub,
  type StatusMap,
  type ToHub,
  type Welcome,
} from "./protocol";
import { failureOf, type Endpoint, type Link, type Transport } from "./transport";
import { createTimers, report, type Timers } from "./util";

type Status = Room["status"];

export interface RoomDeps {
  transport: Transport;
  /** Local monotonic milliseconds. Tests pass a skewed clock per frame. */
  now?: () => number;
  random?: () => number;
  timing?: Partial<Timing>;
}

/** The link to the hub while this frame is a client. */
interface Client {
  link: Link;
  slot: number;
  welcomed: boolean;
  lastSeen: number;
  /** Pings sent since the hub last said anything. */
  missed: number;
  seq: number;
  rtt?: number;
  statusAt: number;
  statusQueued: boolean;
  /** Channel names the hub learned from our hello. */
  helloSubs: Set<string>;
  /** Token bucket for roster entries the hub adds, so a hostile hub can't flood us. */
  newEntries: number;
  newEntriesAt: number;
  timers: Timers;
}

/** New roster entries a client accepts: a burst of a full room, then this many a second. */
const NEW_ENTRY_RATE = 10;
/** Open handles kept per channel name; opening another closes the oldest. */
const MAX_HANDLES = 8;
/** Initial clock burst after joining: this many pings this far apart. */
const BURST = 6;
const BURST_GAP_MS = 150;

const infoKey = (i: PeerInfo): string =>
  JSON.stringify([
    i.frame,
    i.app,
    i.group,
    i.kind,
    i.role,
    i.pos,
    i.side,
    i.span,
    i.zone,
    i.display,
  ]);

const statusKey = (s: StatusMap | undefined): string => JSON.stringify(s ?? {});

const sortRoster = (a: RosterEntry, b: RosterEntry): number =>
  (a.frame < b.frame ? -1 : a.frame > b.frame ? 1 : 0) || a.joinedAt - b.joinedAt;

/**
 * One frame's membership of a room: election, the client side of the hub protocol, channels
 * and status. The hub side lives in hub.ts, which also explains the election design.
 */
export const createRoom = (opts: RoomOptions, deps: RoomDeps): Room => {
  const timing: Timing = { ...TIMING, ...deps.timing };
  const random = deps.random ?? Math.random;
  const local = deps.now ?? (() => performance.timeOrigin + performance.now());
  const transport = deps.transport;
  const eligible = opts.hubEligible !== false;
  const ns = roomNamespace(opts.room);
  const clock = createSyncClock(local);
  const timers = createTimers();

  let info: PeerInfo = cleanInfo(opts.self) ?? { ...opts.self };
  let ownStatus: StatusMap | undefined;
  let status: Status = "connecting";
  let closed = false;
  /** Bumped by every election, join and close, so stale async steps can tell they are stale. */
  let epoch = 0;
  let attempts = 0;
  let hub: Hub | null = null;
  let conn: Client | null = null;
  let memberEp: Promise<Endpoint> | null = null;
  let hubFrame: string | null = null;
  let bytesIn = 0;
  let bytesOut = 0;
  let warnedSize = false;

  const statusListeners = new Set<(s: Status) => void>();
  const rosterListeners = new Set<(r: readonly RosterEntry[]) => void>();
  const channels = new Map<string, Set<ChannelHandle>>();

  const entries = new Map<string, Entry>();
  let selfKey = "self";
  const startedAt = Math.round(clock.now());

  const resetRoster = () => {
    entries.clear();
    selfKey = "self";
    const self: Entry = { key: selfKey, info, joinedAt: startedAt };
    if (ownStatus) self.status = ownStatus;
    entries.set(selfKey, self);
  };
  resetRoster();

  let version = 0;
  let cache: readonly RosterEntry[] | null = null;
  let notifyQueued = false;

  const roster = (): readonly RosterEntry[] => {
    if (cache) return cache;
    const counts = new Map<string, number>();
    for (const e of entries.values()) counts.set(e.info.frame, (counts.get(e.info.frame) ?? 0) + 1);
    const list = [...entries.values()].map((e): RosterEntry => {
      const r: RosterEntry = { ...e.info, joinedAt: e.joinedAt };
      if (e.rtt !== undefined) r.rtt = e.rtt;
      if ((counts.get(e.info.frame) ?? 0) > 1) r.duplicate = true;
      if (e.status) r.status = e.status;
      return r;
    });
    list.sort(sortRoster);
    cache = list;
    return list;
  };

  /** Coalesces notifications to one per task, after the roster settles. */
  const changed = () => {
    version++;
    cache = null;
    if (notifyQueued || closed) return;
    notifyQueued = true;
    queueMicrotask(() => {
      notifyQueued = false;
      if (closed) return;
      const list = roster();
      for (const cb of rosterListeners) {
        try {
          cb(list);
        } catch (err) {
          report(err);
        }
      }
      for (const set of channels.values()) for (const ch of set) ch.notifyPeers();
    });
  };

  const setRoomStatus = (next: Status) => {
    if (status === next) return;
    status = next;
    for (const cb of statusListeners) {
      try {
        cb(next);
      } catch (err) {
        report(err);
      }
    }
  };

  const sendText = (link: Link, text: string): boolean => {
    if (!link.send(text)) return false;
    bytesOut += text.length;
    return true;
  };

  const sendHub = (msg: ToHub) => {
    if (conn?.welcomed) sendText(conn.link, JSON.stringify(msg));
  };

  const warnSize = () => {
    if (warnedSize) return;
    warnedSize = true;
    console.warn(`[net] dropped a message over ${MAX_MESSAGE_BYTES} bytes or not JSON`);
  };

  const deliver = (name: string, topic: string, data: unknown, from: string) => {
    const set = channels.get(name);
    if (!set) return;
    for (const ch of set) ch.deliver(topic, data, from);
  };

  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      timers.after(ms, resolve);
    });

  const between = ([lo, hi]: [number, number]): number => lo + random() * (hi - lo);

  const isScreen = () => info.role === "screen";

  /** Breaks ties between racing claims on transports that arbitrate them: screens win. */
  const claimPriority = () => (isScreen() ? 0 : 1) + random();

  /** Back to a roster of one, as when standalone. */
  const enterIdle = () => {
    hubFrame = null;
    resetRoster();
    changed();
    if (!closed) setRoomStatus("connecting");
  };

  const releaseMember = () => {
    const p = memberEp;
    memberEp = null;
    void p?.then(
      (ep) => ep.close(),
      () => {},
    );
  };

  /** The random-id endpoint used to reach the hub, opened on first need and kept. */
  const memberEndpoint = (): Promise<Endpoint> => {
    if (memberEp) return memberEp;
    const p = (async () => {
      for (let tries = 0; ; tries++) {
        try {
          return await transport.open(memberId(ns, random));
        } catch (err) {
          if (failureOf(err) !== "taken" || tries >= 2) throw err;
        }
      }
    })();
    memberEp = p;
    p.then(
      (ep) => {
        if (closed || memberEp !== p) {
          ep.close();
          return;
        }
        ep.onLink((link) => link.close());
        ep.onLost(() => {
          if (memberEp === p) memberEp = null;
        });
      },
      () => {
        if (memberEp === p) memberEp = null;
      },
    );
    return p;
  };

  // Client side

  const dropClient = (c: Client) => {
    c.timers.clear();
    c.link.close();
    if (conn === c) conn = null;
  };

  /** Whether this frame should claim first after the hub goes: it leads what remains. */
  const succeeds = (): boolean => {
    if (!eligible) return false;
    if (isScreen()) return true;
    const rest: PeerInfo[] = [];
    for (const e of entries.values()) if (e.key !== "0" && !e.noHub) rest.push(e.info);
    return leaderOf(rest) === info.frame;
  };

  const hubLost = () => {
    if (!conn) return;
    const first = succeeds();
    dropClient(conn);
    enterIdle();
    void elect(between(first ? timing.screenDelay : timing.followDelay), first);
  };

  const ping = (c: Client) => {
    c.seq++;
    c.missed++;
    const msg: ToHub = { t: "pi", n: c.seq, a: local() };
    if (c.rtt !== undefined) msg.r = Math.round(c.rtt);
    sendText(c.link, JSON.stringify(msg));
  };

  const pushStatus = (c: Client) => {
    if (c.statusQueued) return;
    const delay = c.statusAt + timing.statusEvery - local();
    const flush = () => {
      c.statusQueued = false;
      c.statusAt = local();
      sendHub({ t: "st", s: ownStatus ?? {} });
    };
    if (delay <= 0) {
      flush();
      return;
    }
    c.statusQueued = true;
    c.timers.after(delay, flush);
  };

  const welcome = (c: Client, msg: Welcome) => {
    c.welcomed = true;
    attempts = 0;
    hubFrame = msg.h;
    entries.clear();
    for (const w of msg.r) entries.set(w.k, fromWire(w));
    selfKey = msg.k;
    const mine = entries.get(selfKey);
    // Info or status may have changed between our hello and this welcome.
    if (mine && infoKey(mine.info) !== infoKey(info)) sendHub({ t: "info", i: info });
    if (statusKey(mine?.status) !== statusKey(ownStatus)) pushStatus(c);
    // Channels opened or closed while we waited for the welcome were never sent.
    for (const name of channels.keys()) if (!c.helloSubs.has(name)) sendHub({ t: "sub", c: name });
    for (const name of c.helloSubs) if (!channels.has(name)) sendHub({ t: "uns", c: name });
    const self: Entry = mine ?? { key: selfKey, info, joinedAt: Math.round(clock.now()) };
    self.info = info;
    if (ownStatus) self.status = ownStatus;
    else delete self.status;
    entries.set(selfKey, self);
    clock.restart();
    changed();
    setRoomStatus("online");
    for (let i = 0; i < BURST; i++) c.timers.after(i * BURST_GAP_MS, () => ping(c));
    c.timers.every(timing.heartbeat, () => {
      // Silence alone could be our own stalled event loop (simulator frames share one thread),
      // so also require pings that went out and got no answer.
      if (c.missed >= 3 && local() - c.lastSeen > timing.hubTimeout) {
        if (conn === c) hubLost();
        return;
      }
      ping(c);
    });
  };

  const onHubMessage = (c: Client, msg: FromHub) => {
    switch (msg.t) {
      case "ro": {
        for (const key of msg.x) if (key !== selfKey) entries.delete(key);
        const t = local();
        c.newEntries = Math.min(
          MAX_MEMBERS + 1,
          c.newEntries + ((t - c.newEntriesAt) / 1000) * NEW_ENTRY_RATE,
        );
        c.newEntriesAt = t;
        for (const w of msg.u) {
          if (w.k !== selfKey) {
            if (!entries.has(w.k)) {
              if (entries.size > MAX_MEMBERS || c.newEntries < 1) continue;
              c.newEntries--;
            }
            entries.set(w.k, fromWire(w));
            continue;
          }
          // Our own info and status are authoritative here; take only what the hub measured.
          const self = entries.get(selfKey);
          if (!self) continue;
          self.joinedAt = w.j;
          if (w.r !== undefined) self.rtt = w.r;
        }
        changed();
        break;
      }
      case "m":
        deliver(msg.c, msg.k, msg.d, msg.f);
        break;
      case "po": {
        const t3 = local();
        const rtt = t3 - msg.a;
        if (rtt < 0 || rtt > 10_000) break;
        c.rtt = c.rtt === undefined ? rtt : c.rtt * 0.8 + rtt * 0.2;
        clock.sample(msg.h + rtt / 2 - t3, rtt);
        break;
      }
      case "mv":
        dropClient(c);
        enterIdle();
        void joinDirect(msg.s);
        break;
      case "bye":
        hubLost();
        break;
      default:
        break;
    }
  };

  /** Says hello over a fresh link and resolves true once the hub welcomes us. */
  const startClient = (link: Link, slot: number): Promise<boolean> =>
    new Promise((resolve) => {
      if (conn) dropClient(conn);
      const c: Client = {
        link,
        slot,
        welcomed: false,
        lastSeen: local(),
        missed: 0,
        seq: 0,
        statusAt: 0,
        statusQueued: false,
        helloSubs: new Set(channels.keys()),
        newEntries: MAX_MEMBERS + 1,
        newEntriesAt: local(),
        timers: createTimers(),
      };
      conn = c;
      let settled = false;
      const settle = (ok: boolean) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
      const fail = () => {
        dropClient(c);
        settle(false);
      };
      c.timers.after(timing.welcomeTimeout, () => {
        if (!c.welcomed) fail();
      });
      link.onMessage((text) => {
        if (conn !== c) return;
        bytesIn += text.length;
        c.lastSeen = local();
        c.missed = 0;
        const msg = readFromHub(text);
        if (!msg) return;
        if (c.welcomed) {
          onHubMessage(c, msg);
        } else if (msg.t === "wel") {
          welcome(c, msg);
          settle(true);
        } else if (msg.t === "full" || msg.t === "bye" || msg.t === "mv") {
          fail();
        }
      });
      link.onClose(() => {
        if (conn !== c) return;
        if (c.welcomed) hubLost();
        else fail();
      });
      const hello: Hello = { t: "hello", v: PROTOCOL, i: info, c: [...c.helloSubs] };
      if (ownStatus) hello.s = ownStatus;
      if (!eligible) hello.n = 1;
      sendText(link, JSON.stringify(hello));
    });

  type Outcome = "ok" | "fail" | "offline";

  /** Connect to a hub slot through our member endpoint. "absent" means nobody holds it. */
  const tryJoin = async (slot: number, my: number): Promise<Outcome | "absent"> => {
    let ep: Endpoint;
    try {
      ep = await memberEndpoint();
    } catch {
      return "offline";
    }
    if (my !== epoch || closed) return "fail";
    let link: Link | null = null;
    for (let attempt = 0; !link; attempt++) {
      try {
        link = await ep.connect(hubId(ns, slot), timing.connectTimeout);
      } catch (err) {
        const why = failureOf(err);
        if (my !== epoch || closed) return "fail";
        // The public broker can drop an offer sent just before the slot was claimed, without
        // any answer, so a timeout earns one fresh attempt before the slot counts as dead.
        if (why === "timeout" && attempt === 0 && transport.stale) continue;
        return why === "offline" ? "offline" : why === "unavailable" ? "absent" : "fail";
      }
    }
    if (my !== epoch || closed) {
      link.close();
      return "fail";
    }
    return (await startClient(link, slot)) ? "ok" : "fail";
  };

  // Hub side

  const stepDown = (slot: number | null) => {
    const h = hub;
    if (!h) return;
    hub = null;
    h.close(slot ?? "bye");
    enterIdle();
    if (slot === null) void elect(between(timing.followDelay), false);
    else void joinDirect(slot);
  };

  const becomeHub = (ep: Endpoint, slot: number) => {
    releaseMember();
    attempts = 0;
    clock.anchor();
    entries.clear();
    selfKey = "0";
    const self: Entry = { key: selfKey, info, joinedAt: Math.round(clock.now()), rtt: 0 };
    if (ownStatus) self.status = ownStatus;
    entries.set(selfKey, self);
    hubFrame = info.frame;
    hub = createHub({
      endpoint: ep,
      slot,
      ns,
      entries,
      self,
      clock,
      timing,
      random,
      subscribed: (name) => channels.has(name),
      deliver,
      changed,
      stepDown,
      traffic: (i, o) => {
        bytesIn += i;
        bytesOut += o;
      },
    });
    changed();
    setRoomStatus("online");
  };

  // Election (the design is described at the top of hub.ts)

  /** Claim a slot, or join whoever holds it. */
  const claimOrJoin = async (slot: number, my: number, again = true): Promise<Outcome> => {
    let ep: Endpoint;
    try {
      ep = await transport.open(hubId(ns, slot), claimPriority());
    } catch (err) {
      if (my !== epoch || closed) return "fail";
      const taken = failureOf(err) === "taken";
      // A refused claim can mean the broker turned away a new connection (rate limits); an
      // endpoint we already hold may still reach a hub that exists.
      if (!taken && !memberEp) return "offline";
      const joined = await tryJoin(slot, my);
      if (joined === "ok" || joined === "offline") return joined;
      // The holder let go between our claim and our connect, as a closing hub does.
      if (taken && joined === "absent" && again && !transport.stale) {
        await wait(100 + random() * 200);
        if (my !== epoch || closed) return "fail";
        return claimOrJoin(slot, my, false);
      }
      return taken ? "fail" : "offline";
    }
    if (my !== epoch || closed) {
      ep.close();
      return "fail";
    }
    becomeHub(ep, slot);
    return "ok";
  };

  /** Screens and failover successors claim first. */
  const claimPass = async (my: number): Promise<Outcome> => {
    for (let slot = 0; slot < HUB_SLOTS; slot++) {
      const r = await claimOrJoin(slot, my);
      if (r !== "fail" || my !== epoch || closed || !transport.stale) return r;
      // Taken but unreachable: probably a dead peer whose id the broker still holds.
    }
    return "fail";
  };

  /** Everyone else joins an existing hub and claims only a slot that nobody holds. */
  const joinPass = async (my: number): Promise<Outcome> => {
    for (let slot = 0; slot < HUB_SLOTS; slot++) {
      let r = await tryJoin(slot, my);
      if (my !== epoch || closed) return "fail";
      if (r === "absent") {
        if (!eligible) continue;
        await wait(random() * timing.claimSpread);
        if (my !== epoch || closed) return "fail";
        r = await claimOrJoin(slot, my);
        if (my !== epoch || closed) return "fail";
      }
      if (r === "ok" || r === "offline") return r;
      if (!transport.stale) return "fail";
    }
    return "fail";
  };

  const retry = (offline: boolean) => {
    attempts++;
    setRoomStatus(offline ? "offline" : "connecting");
    const cap = offline ? timing.retryMax : Math.min(timing.retryMax, timing.retryJoinMax);
    const base = Math.min(cap, timing.retryMin * 2 ** Math.min(attempts - 1, 12));
    void elect(base * (0.5 + random()), isScreen());
  };

  const elect = async (delay: number, eager: boolean) => {
    const my = ++epoch;
    if (conn) dropClient(conn);
    await wait(delay);
    if (my !== epoch || closed) return;
    const r = eager && eligible ? await claimPass(my) : await joinPass(my);
    if (r === "ok" || my !== epoch || closed) return;
    retry(r === "offline");
  };

  /** Join a known hub slot without claiming, after a hub said to move there. */
  const joinDirect = async (slot: number) => {
    const my = ++epoch;
    await wait(random() * 300);
    if (my !== epoch || closed) return;
    const joined = await tryJoin(slot, my);
    if (my !== epoch || closed || joined === "ok") return;
    void elect(between(timing.followDelay), false);
  };

  // Channels

  const host: ChannelHost = {
    online: () => status === "online",
    self: () => info.frame,
    roster,
    version: () => version,
    send(name, topic, data, to) {
      if (closed || status !== "online") return;
      if (hub) {
        if (!hub.relay(name, topic, data, to)) warnSize();
        return;
      }
      if (!conn?.welcomed) return;
      const msg: ToHub = { t: "m", c: name, k: topic, d: data };
      if (to !== undefined) msg.to = to;
      let text: string;
      try {
        text = JSON.stringify(msg);
      } catch {
        warnSize();
        return;
      }
      if (text.length > MAX_MESSAGE_BYTES) warnSize();
      else sendText(conn.link, text);
    },
    release(name, handle) {
      const set = channels.get(name);
      if (!set?.delete(handle) || set.size > 0) return;
      channels.delete(name);
      sendHub({ t: "uns", c: name });
    },
  };

  const clockFacade: Clock = {
    now: () => clock.now(),
    get synced() {
      return clock.synced;
    },
    onSync: (cb) => clock.onSync(cb),
  };

  const room: Room = {
    get status() {
      return status;
    },
    get isHub() {
      return hub !== null;
    },
    get hub() {
      return hubFrame;
    },
    get self() {
      return info.frame;
    },
    clock: clockFacade,
    roster,
    channel(name, filter) {
      const handle = createChannel(name, host, filter);
      if (closed) {
        handle.close();
        return handle;
      }
      let set = channels.get(name);
      if (!set) {
        set = new Set();
        channels.set(name, set);
        sendHub({ t: "sub", c: name });
      }
      // A caller that never closes its handles (an app remounted many times) must not keep
      // every old one, and the handlers it holds, alive for days.
      if (set.size >= MAX_HANDLES) set.values().next().value?.close();
      set.add(handle);
      return handle;
    },
    update(partial) {
      const next = cleanInfo({ ...info, ...partial });
      if (!next || infoKey(next) === infoKey(info)) return;
      info = next;
      const self = entries.get(selfKey);
      if (self) self.info = info;
      changed();
      if (hub) hub.touched(selfKey);
      else sendHub({ t: "info", i: info });
    },
    setStatus(next) {
      const clean = cleanStatus(next);
      if (statusKey(clean) === statusKey(ownStatus)) return;
      ownStatus = clean;
      const self = entries.get(selfKey);
      if (self) {
        if (ownStatus) self.status = ownStatus;
        else delete self.status;
      }
      changed();
      if (hub) hub.touched(selfKey);
      else if (conn?.welcomed) pushStatus(conn);
    },
    onStatus(cb) {
      statusListeners.add(cb);
      return () => {
        statusListeners.delete(cb);
      };
    },
    onRoster(cb) {
      rosterListeners.add(cb);
      return () => {
        rosterListeners.delete(cb);
      };
    },
    async stats() {
      const links = hub ? hub.links() : conn?.welcomed ? [conn.link] : [];
      const types = await Promise.all(
        links.map((l) => (l.candidates ? l.candidates().catch(() => null) : null)),
      );
      const candidates = [...new Set(types.filter((t): t is string => !!t))].sort();
      return { hub: hubFrame, connections: links.length, candidates, bytesIn, bytesOut };
    },
    close() {
      if (closed) return;
      closed = true;
      epoch++;
      const h = hub;
      hub = null;
      h?.close("bye");
      if (conn) {
        if (conn.welcomed) sendText(conn.link, JSON.stringify({ t: "bye" } satisfies ToHub));
        dropClient(conn);
      }
      releaseMember();
      transport.close();
      timers.clear();
      for (const set of channels.values()) for (const ch of set) ch.close();
      channels.clear();
      hubFrame = null;
      resetRoster();
      version++;
      cache = null;
      setRoomStatus("offline");
      statusListeners.clear();
      rosterListeners.clear();
      clock.dispose();
    },
  };

  void elect(between(isScreen() ? timing.screenDelay : timing.memberDelay), isScreen());
  return room;
};
