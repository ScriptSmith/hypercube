/**
 * Who talks to whom in a bank. A touch frame sends `go`, `aim` and `ctl` to the screen on its
 * side; the screen sends `sky` to everyone four times a second, which is also its beacon. A frame
 * counts the screen as there only while its `sky` keeps
 * coming (and, while the room is up, the roster lists it), so a screen that crashes or is
 * unplugged is noticed within a few seconds. While the room is between hubs the last word from
 * the screen stands a little longer, so a quick hub change doesn't send every frame solo.
 */
import type { Channel, PeerInfo } from "../../core/types";
import { activeVenue } from "../../core/venue";
import {
  type AimMsg,
  type CtlMsg,
  decodeAim,
  decodeCtl,
  decodeGo,
  decodeSky,
  encodeAim,
  encodeCtl,
  encodeGo,
  type GoMsg,
  type SkyMsg,
  TOPIC,
} from "./wire";

export const SKY_MS = 250;
/** A screen not heard from for this long has gone. */
export const SKY_GRACE_MS = 3000;
/** While the room is offline, a screen's word stands at most this much longer. */
const OFFLINE_EXTRA_MS = 3000;
/** Aims are sent at most this often per pad. */
export const AIM_MS = 1000 / 15;
/** A ribbon on the screen with no aim for this long ends. */
export const AIM_STALE_MS = 450;
/** Fewest ms between two planets from one pad (pads reload in 650) and holes from one launcher. */
const PLANET_GAP_MS = 400;
const HOLE_GAP_MS = 20_000;
const CTL_GAP_MS = 200;
/** A launch whose step is further than this from the screen's is refused. */
export const MAX_SKEW_STEPS = 720;
const MAX_SENDERS = 64;

const sideOf = (p: PeerInfo) => p.side ?? 0;

export interface Uplink {
  /** The screen above this frame, while it answers. */
  screen(): string | null;
  /** The latest `sky` from that screen. */
  sky(): SkyMsg | null;
  go(m: GoMsg): boolean;
  aim(m: AimMsg): boolean;
  ctl(m: CtlMsg): boolean;
  readonly sent: number;
  dispose(): void;
}

export const createUplink = (net: Channel, side: number, now: () => number): Uplink => {
  let heard: { from: string; at: number; msg: SkyMsg } | null = null;
  let offlineSince: number | null = null;
  let sent = 0;
  const offs = [
    net.on(TOPIC.sky, (data, from) => {
      const m = decodeSky(data);
      if (!m) return;
      const peer = net.peers().find((p) => p.frame === from);
      if (!peer || peer.role !== "screen" || sideOf(peer) !== side) return;
      heard = { from, at: now(), msg: m };
    }),
  ];
  const screen = (): string | null => {
    const t = now();
    if (!heard) return null;
    if (!net.online) {
      offlineSince ??= t;
      return t - heard.at <= SKY_GRACE_MS + OFFLINE_EXTRA_MS ? heard.from : null;
    }
    offlineSince = null;
    if (t - heard.at > SKY_GRACE_MS) return null;
    const from = heard.from;
    if (!net.peers().some((p) => p.frame === from && p.role === "screen")) return null;
    return from;
  };
  const send = (topic: string, data: unknown) => {
    const to = screen();
    if (!to || !net.online) return false;
    net.send(topic, data, to);
    sent++;
    return true;
  };
  return {
    screen,
    sky: () => (screen() && heard ? heard.msg : null),
    go: (m) => send(TOPIC.go, encodeGo(m)),
    aim: (m) => send(TOPIC.aim, encodeAim(m)),
    ctl: (m) => send(TOPIC.ctl, encodeCtl(m)),
    get sent() {
      return sent;
    },
    dispose() {
      for (const off of offs) off();
      heard = null;
    },
  };
};

export interface Sender {
  frame: string;
  pos: number;
  kind: PeerInfo["kind"];
  span: number;
}

export interface DownlinkHandlers {
  go(m: GoMsg, from: Sender): void;
  aim(m: AimMsg, from: Sender): void;
  ctl(m: CtlMsg, from: Sender): void;
}

export interface Downlink {
  /** Touch frames on this screen's side. */
  stations(): PeerInfo[];
  /** Send the sky when it is due; `sky` returns it already encoded. */
  tick(sky: () => SkyMsg): void;
  readonly received: number;
  dispose(): void;
}

export const createDownlink = (
  net: Channel,
  opts: {
    side: number;
    count: () => number;
    /** The screen's current step. */
    step: () => number;
    /** Local ms, for rates and beacons. */
    now: () => number;
  },
  on: DownlinkHandlers,
): Downlink => {
  const last = new Map<string, number>();
  let skyAt = -Infinity;
  let received = 0;
  const stations = () => net.peers().filter((p) => p.role !== "screen" && sideOf(p) === opts.side);
  const senderOf = (from: string): Sender | null => {
    const peer = net.peers().find((p) => p.frame === from);
    // Only touch frames below this screen, on its own side.
    if (!peer || peer.role === "screen" || sideOf(peer) !== opts.side) return null;
    if (peer.kind !== "panel" && peer.kind !== "pair") return null;
    if (peer.pos < 0 || peer.pos >= Math.max(1, opts.count())) return null;
    return { frame: from, pos: peer.pos, kind: peer.kind, span: peer.span ?? 2 };
  };
  const allow = (key: string, gap: number) => {
    const t = opts.now();
    const prev = last.get(key);
    if (prev !== undefined && t - prev < gap) return false;
    last.set(key, t);
    if (last.size > MAX_SENDERS * 4) {
      const first = last.keys().next().value;
      if (first !== undefined) last.delete(first);
    }
    return true;
  };
  const offs = [
    net.on(TOPIC.go, (data, from) => {
      const s = senderOf(from);
      const m = s ? decodeGo(data) : null;
      if (!s || !m) return;
      if (Math.abs(m.s - opts.step()) > MAX_SKEW_STEPS) return;
      if (!allow(`${from}:${m.k}:${m.p}`, m.k === 1 ? HOLE_GAP_MS : PLANET_GAP_MS)) return;
      received++;
      on.go(m, s);
    }),
    net.on(TOPIC.aim, (data, from) => {
      const s = senderOf(from);
      const m = s ? decodeAim(data) : null;
      if (!s || !m) return;
      if (!m.off && !allow(`${from}:aim:${m.p}`, AIM_MS * 0.6)) return;
      on.aim(m, s);
    }),
    net.on(TOPIC.ctl, (data, from) => {
      const s = senderOf(from);
      const m = s ? decodeCtl(data) : null;
      if (!s || !m || !allow(`${from}:ctl`, CTL_GAP_MS)) return;
      on.ctl(m, s);
    }),
  ];
  return {
    stations,
    tick(sky) {
      const t = opts.now();
      if (!net.online || t - skyAt < SKY_MS) return;
      skyAt = t;
      net.send(TOPIC.sky, sky());
    },
    get received() {
      return received;
    },
    dispose() {
      for (const off of offs) off();
      last.clear();
    },
  };
};

/** Width in venue px of the touch frames a screen serves, from its peers or the default. */
export const touchFrameWidth = (stations: readonly PeerInfo[]): number => {
  const pair = stations.find((p) => p.kind === "pair");
  const panel = activeVenue().panel.width;
  return pair ? panel * Math.max(2, pair.span ?? 2) : panel;
};
