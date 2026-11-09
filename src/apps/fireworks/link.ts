/**
 * Who talks to whom. A touch frame sends its launches to the screen on its own side (the group's
 * `leader()` would pick one frame for both sides of a corner). A screen echoes bursts back to the
 * frames below it and, in a corner, shares shells, bursts and volley counts with the other screen.
 *
 * Screens send a small beacon every BEACON_MS. A screen counts as present only while its beacons
 * keep coming and the roster lists it, so one that crashes or is unplugged is noticed in a couple
 * of seconds even while the hub still lists it. For the first half second the room is between hubs
 * the beacons' ages stand still, so a quick hub change doesn't look like every screen leaving.
 */
import type { Channel, PeerInfo } from "../../core/types";
import { activeVenue } from "../../core/venue";
import type { Burst, Shell } from "./records";
import {
  type BoomMsg,
  decodeBoom,
  decodeLaunch,
  decodeVolley,
  encodeBurst,
  encodeLaunch,
  encodeShell,
  type LaunchMsg,
  TOPIC,
  type VolleyMsg,
} from "./wire";

export const BEACON_MS = 600;
/** A screen with no beacon for this long has gone. */
export const BEACON_GRACE_MS = 1900;
/** While the room is offline, beacon ages stand still for at most this long. */
const FREEZE_MS = 500;
/**
 * A screen whose beacons are overdue still counts until this frame has looked this many more
 * times. If the frame's own event loop was held up (the simulator runs every frame on one
 * thread), the beacons that queued meanwhile arrive in those looks; a screen that really went
 * costs only about a quarter of a second more.
 */
const AWAKE_LOOKS = 8;
/** Looks closer together than this count once. */
const LOOK_MS = 20;

const sideOf = (p: PeerInfo) => p.side ?? 0;

/** The latest beacon from each screen, checked against the roster when it arrives. */
export interface Beacons {
  /** The screen on `side` heard from within the grace period, or null. */
  screen(side: number, now: number): string | null;
  /** Longest wait between two beacons from one screen, for tests. */
  readonly maxGap: number;
  dispose(): void;
}

export const listenBeacons = (net: Channel, now: () => number): Beacons => {
  const heard = new Map<string, { side: number; at: number; staleAt: number | null }>();
  let offlineSince: number | null = null;
  let maxGap = 0;
  let looks = 0;
  let lookedAt = -Infinity;
  const sync = (t: number) => {
    if (!net.online) {
      offlineSince ??= t;
      return;
    }
    if (offlineSince !== null) {
      const gap = Math.min(FREEZE_MS, t - offlineSince);
      for (const h of heard.values()) h.at += gap;
      offlineSince = null;
    }
  };
  const off = net.on(TOPIC.sky, (data, from) => {
    const s = (data as { s?: unknown } | null)?.s;
    if (s !== 0 && s !== 1) return;
    const peer = net.peers().find((p) => p.frame === from);
    if (!peer || peer.role !== "screen" || sideOf(peer) !== s) return;
    const prev = heard.get(from);
    const t = now();
    if (prev && offlineSince === null) maxGap = Math.max(maxGap, t - prev.at);
    heard.set(from, { side: s, at: t, staleAt: null });
    if (heard.size > 8) {
      const first = heard.keys().next().value;
      if (first !== undefined) heard.delete(first);
    }
  });
  return {
    screen(side, t) {
      if (t - lookedAt >= LOOK_MS) {
        looks++;
        lookedAt = t;
      }
      sync(t);
      const ref = offlineSince === null ? t : t - Math.min(FREEZE_MS, t - offlineSince);
      const peers = offlineSince === null ? net.peers() : null;
      let best: string | null = null;
      let at = -Infinity;
      for (const [frame, h] of heard) {
        if (h.side !== side || h.at <= at) continue;
        if (ref - h.at > BEACON_GRACE_MS) {
          h.staleAt ??= looks;
          if (looks - h.staleAt >= AWAKE_LOOKS) continue;
        } else {
          h.staleAt = null;
        }
        if (peers && !peers.some((p) => p.frame === frame && p.role === "screen")) continue;
        best = frame;
        at = h.at;
      }
      return best;
    },
    get maxGap() {
      return maxGap;
    },
    dispose() {
      off();
      heard.clear();
    },
  };
};

export interface Uplink {
  /** The screen above this frame, if it is answering. */
  screen(): string | null;
  readonly beacons: Beacons;
  send(m: LaunchMsg): boolean;
  dispose(): void;
}

export const createUplink = (
  net: Channel,
  side: number,
  now: () => number,
  onBoom: (m: BoomMsg) => void,
): Uplink => {
  const beacons = listenBeacons(net, now);
  // Beacon expiry alone decides: a hub change takes the room offline for a moment, and the
  // screen shouldn't seem to vanish for that.
  const screen = () => beacons.screen(side, now());
  const off = net.on(TOPIC.boom, (data, from) => {
    if (from !== screen()) return;
    const m = decodeBoom(data);
    if (m) onBoom(m);
  });
  return {
    screen,
    beacons,
    send(m) {
      const to = screen();
      if (!to || !net.online) return false;
      net.send(TOPIC.launch, encodeLaunch(m), to);
      return true;
    },
    dispose() {
      off();
      beacons.dispose();
    },
  };
};

/** Fewest ms between two launches from one pad that a screen accepts (pads allow 1200). */
export const SCREEN_PAD_GAP_MS = 1000;
/** Launch times further than this from the screen's clock are refused. */
export const MAX_SKEW_MS = 6000;
/** Corner messages accepted from the other screen per second. */
const CORNER_RATE = 30;

export interface DownlinkHandlers {
  launch(m: LaunchMsg, from: string): void;
  cross(data: unknown): void;
  spill(data: unknown): void;
  volley(m: VolleyMsg): void;
}

export interface Downlink {
  /** The other corner screen, while it is answering. */
  partner(): string | null;
  /** Touch frames on this screen's side. */
  stations(): PeerInfo[];
  /** Send the beacon when it is due. */
  tick(): void;
  boom(to: string, m: BoomMsg): void;
  cross(s: Shell): void;
  spill(b: Burst): void;
  volley(count: number, t: number): void;
  dispose(): void;
}

export const createDownlink = (
  net: Channel,
  opts: {
    side: number;
    corner: boolean;
    count: () => number;
    /** Shared clock, for launch times. */
    clock: () => number;
    /** Local ms, for beacons and rates. */
    now: () => number;
  },
  on: DownlinkHandlers,
): Downlink => {
  const lastByPad = new Map<string, number>();
  const beacons = listenBeacons(net, opts.now);
  let tokens = CORNER_RATE;
  let refilled = opts.now();
  let beaconAt = -Infinity;

  const partner = () => (opts.corner ? beacons.screen(1 - opts.side, opts.now()) : null);
  const stations = () => net.peers().filter((p) => p.role !== "screen" && sideOf(p) === opts.side);
  const spend = () => {
    const t = opts.now();
    tokens = Math.min(CORNER_RATE, tokens + ((t - refilled) / 1000) * CORNER_RATE);
    refilled = t;
    if (tokens < 1) return false;
    tokens--;
    return true;
  };

  const offs = [
    net.on(TOPIC.launch, (data, from) => {
      const peer = net.peers().find((p) => p.frame === from);
      // Only frames below this screen, on its own side, may launch into it.
      if (!peer || peer.role === "screen" || sideOf(peer) !== opts.side) return;
      const m = decodeLaunch(data);
      if (!m || m.pos >= Math.max(1, opts.count())) return;
      if (Math.abs(m.t - opts.clock()) > MAX_SKEW_MS) return;
      const key = `${from}:${m.p}`;
      const last = lastByPad.get(key);
      if (last !== undefined && m.t - last < SCREEN_PAD_GAP_MS) return;
      lastByPad.set(key, m.t);
      if (lastByPad.size > 128) {
        const first = lastByPad.keys().next().value;
        if (first !== undefined) lastByPad.delete(first);
      }
      on.launch(m, from);
    }),
    net.on(TOPIC.cross, (data, from) => {
      if (from === partner() && spend()) on.cross(data);
    }),
    net.on(TOPIC.spill, (data, from) => {
      if (from === partner() && spend()) on.spill(data);
    }),
    net.on(TOPIC.volley, (data, from) => {
      if (from !== partner() || !spend()) return;
      const m = decodeVolley(data);
      if (m && m.s !== opts.side) on.volley(m);
    }),
  ];

  const toPartner = (topic: string, data: unknown) => {
    const to = partner();
    if (to && net.online) net.send(topic, data, to);
  };

  return {
    partner,
    stations,
    tick() {
      const t = opts.now();
      if (!net.online || t - beaconAt < BEACON_MS) return;
      beaconAt = t;
      net.send(TOPIC.sky, { s: opts.side });
    },
    boom(to, m) {
      if (net.online) net.send(TOPIC.boom, m, to);
    },
    cross: (s) => toPartner(TOPIC.cross, encodeShell(s)),
    spill: (b) => toPartner(TOPIC.spill, encodeBurst(b)),
    volley: (count, t) => toPartner(TOPIC.volley, { s: opts.side, c: count, t: Math.round(t) }),
    dispose() {
      for (const off of offs) off();
      beacons.dispose();
      lastByPad.clear();
    },
  };
};

/** Width in venue px of the touch frames a screen serves, from its peers or the default. */
export const touchFrameWidth = (stations: readonly PeerInfo[]): number => {
  const pair = stations.find((p) => p.kind === "pair");
  const panel = activeVenue().panel.width;
  return pair ? panel * Math.max(2, pair.span ?? 2) : panel;
};

/** Pads on a side: two on each merged pair, one on each panel. */
export const padsOn = (stations: readonly PeerInfo[], count: number): number => {
  if (stations.length === 0) return Math.max(1, count);
  return stations.reduce((n, p) => n + (p.kind === "pair" ? Math.max(2, p.span ?? 2) : 1), 0);
};
