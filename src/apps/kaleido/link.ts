/**
 * The bank's two ends.
 *
 * A touch frame (`createUplink`) listens for its screen's beacon and, while one has come in the
 * last SKY_TIMEOUT_MS, sends its fingers about INK_HZ times a second while any are down, and once
 * more when the last lifts. Without a beacon it sends nothing and draws its own layers.
 *
 * The screen (`createDownlink`) keeps a short history of each frame's messages and plays each
 * finger back a little late: the lower the finger on its frame, the later, as if its ink had
 * risen to the frame's top first. A frame's fingers end FORGET_MS after its last message (in
 * that delayed time), so a frame that vanishes mid-pour stops pouring.
 */
import type { Channel, PeerInfo } from "../../core/types";
import {
  decodeInk,
  decodeSky,
  encodeInk,
  encodeSky,
  FORGET_MS,
  INK_HZ,
  type InkMsg,
  MAX_POS,
  SKY_EVERY_MS,
  SKY_TIMEOUT_MS,
  type SkyMsg,
  TOPIC,
  type WireFinger,
} from "./wire";

const sideOf = (p: PeerInfo) => p.side ?? 0;
const MAX_SCREENS = 2;
/** Messages kept per frame: about three seconds at INK_HZ. */
export const HISTORY = 96;
/** The longest a finger waits before the screen pours it (a finger at the bottom of its frame). */
export const MAX_DELAY_MS = 1200;
const MIN_DELAY_MS = 150;

export const delayFor = (y: number): number =>
  MIN_DELAY_MS + Math.min(1, Math.max(0, y)) * (MAX_DELAY_MS - MIN_DELAY_MS);

export interface Uplink {
  /** The screen above, while its beacons keep coming. `now` is local ms. */
  screen(now: number): string | null;
  /** The latest beacon, while the screen counts as there. */
  sky(now: number): SkyMsg | null;
  /** Send fingers if a message is due. */
  tick(now: number, build: () => InkMsg): void;
  readonly sent: number;
  dispose(): void;
}

export const createUplink = (net: Channel, side: number): Uplink => {
  let last: { from: string; at: number; msg: SkyMsg } | null = null;
  let sentAt = Number.NEGATIVE_INFINITY;
  let sent = 0;
  let wasTouching = false;
  const every = 1000 / INK_HZ;

  const isScreen = (from: string) => {
    const p = net.peers().find((x) => x.frame === from);
    return !!p && p.role === "screen" && sideOf(p) === side;
  };

  const off = net.on(TOPIC.sky, (data, from) => {
    const m = decodeSky(data);
    if (!m || m.side !== side || !isScreen(from)) return;
    last = { from, at: performance.now(), msg: m };
  });

  const screen = (now: number) => (last && now - last.at <= SKY_TIMEOUT_MS ? last.from : null);

  return {
    screen,
    sky: (now) => (screen(now) ? (last?.msg ?? null) : null),
    tick(now, build) {
      if (!net.online || now - sentAt < every - 4) return;
      if (!screen(now)) return;
      const msg = build();
      const touching = msg.fingers.length > 0;
      if (!touching && !wasTouching) return;
      wasTouching = touching;
      sentAt = now;
      const data = encodeInk(msg);
      let n = 0;
      for (const p of net.peers()) {
        if (p.role !== "screen" || sideOf(p) !== side || p.frame === net.self) continue;
        net.send(TOPIC.ink, data, p.frame);
        if (++n >= MAX_SCREENS) break;
      }
      if (n > 0) sent++;
    },
    get sent() {
      return sent;
    },
    dispose() {
      off();
    },
  };
};

/** A remote finger as the screen pours it now. */
export interface RemoteFinger extends WireFinger {
  frame: string;
  pos: number;
  count: number;
  /** Local ms when the screen first heard of it. */
  since: number;
}

interface Entry {
  at: number;
  msg: InkMsg;
}

interface Remote {
  frame: string;
  history: Entry[];
  lastAt: number;
  /** Finger id to [latest y, first heard]. */
  seen: Map<number, [number, number]>;
}

export interface Downlink {
  /** Fingers to pour at local time `now`. */
  fingers(now: number): RemoteFinger[];
  /** Frames heard from lately. */
  frames(now: number): number;
  /** True if any of the fingers heard in the last `ms` was a person's. */
  human(now: number, ms: number): boolean;
  /** Send the beacon if due. */
  beacon(now: number, build: () => SkyMsg): void;
  readonly received: number;
  dispose(): void;
}

export const createDownlink = (net: Channel, side: number): Downlink => {
  const remotes = new Map<string, Remote>();
  let beaconAt = Number.NEGATIVE_INFINITY;
  let received = 0;
  let humanAt = Number.NEGATIVE_INFINITY;

  const off = net.on(TOPIC.ink, (data, from) => {
    const p = net.peers().find((x) => x.frame === from);
    if (!p || p.role === "screen" || sideOf(p) !== side) return;
    const msg = decodeInk(data);
    if (!msg) return;
    const now = performance.now();
    received++;
    let r = remotes.get(from);
    if (!r) {
      if (remotes.size >= MAX_POS * 2) return;
      r = { frame: from, history: [], lastAt: now, seen: new Map() };
      remotes.set(from, r);
    }
    const prev = r.history[r.history.length - 1]?.msg.fingers;
    r.lastAt = now;
    r.history.push({ at: now, msg });
    if (r.history.length > HISTORY) r.history.splice(0, r.history.length - HISTORY);
    for (const f of msg.fingers) {
      const s = r.seen.get(f.id);
      // An id that wasn't down in the previous message is a new touch.
      if (s && prev?.some((x) => x.id === f.id)) s[0] = f.y;
      else r.seen.set(f.id, [f.y, now]);
      if (f.human) humanAt = now;
    }
  });

  const fingers = (now: number): RemoteFinger[] => {
    const out: RemoteFinger[] = [];
    for (const [frame, r] of remotes) {
      if (now - r.lastAt > FORGET_MS + MAX_DELAY_MS + 200) {
        remotes.delete(frame);
        continue;
      }
      const h = r.history;
      for (const [id, [y, since]] of r.seen) {
        const t = now - delayFor(y);
        let k = h.length - 1;
        while (k >= 0 && h[k]!.at > t) k--;
        if (k < 0) {
          // Not heard of yet in delayed time.
          continue;
        }
        const e = h[k]!;
        if (k === h.length - 1 && t - e.at > FORGET_MS) {
          r.seen.delete(id);
          continue;
        }
        const f = e.msg.fingers.find((x) => x.id === id);
        if (!f) {
          // Lifted by then; forget it once even the latest message lacks it.
          if (!h[h.length - 1]!.msg.fingers.some((x) => x.id === id) && k === h.length - 1) {
            r.seen.delete(id);
          }
          continue;
        }
        out.push({ ...f, frame, pos: e.msg.pos, count: e.msg.count, since });
      }
    }
    return out;
  };

  return {
    fingers,
    frames(now) {
      let n = 0;
      for (const r of remotes.values()) if (now - r.lastAt < 3000) n++;
      return n;
    },
    human: (now, ms) => now - humanAt <= ms,
    beacon(now, build) {
      if (now - beaconAt < SKY_EVERY_MS) return;
      beaconAt = now;
      if (net.online) net.send(TOPIC.sky, encodeSky(build()));
    },
    get received() {
      return received;
    },
    dispose() {
      off();
      remotes.clear();
    },
  };
};
