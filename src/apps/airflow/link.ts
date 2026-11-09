/**
 * A bank's touch frames send their plumes to the screen on their side (not the group's
 * leader, which a corner would share), and nothing while the roster lists no screen. The
 * screen keeps each frame's latest plumes by position; a frame that stops sending fades back to
 * the screen's own updraft (see inflow.ts). Touch frames never wait for the screen.
 */
import type { Channel, PeerInfo } from "../../core/types";
import { PLUME_HZ } from "./config";
import { createSlots, type Slots } from "./inflow";
import { decodePlume, fresh, type PlumeMsg, TOPIC_PLUME } from "./wire";

const sideOf = (p: PeerInfo) => p.side ?? 0;

export interface Uplink {
  /** The screen above this frame, if the roster lists one. */
  screen(): string | null;
  /** True when a plume is due (start a readback). */
  due(now: number): boolean;
  send(msg: PlumeMsg): void;
  readonly sent: number;
  dispose(): void;
}

export const createUplink = (net: Channel, side: number): Uplink => {
  let lastAt = Number.NEGATIVE_INFINITY;
  let sent = 0;
  const screen = () =>
    net.peers().find((p) => p.role === "screen" && sideOf(p) === side && p.frame !== net.self)
      ?.frame ?? null;
  return {
    screen,
    due(now) {
      if (!net.online || now - lastAt < 1000 / PLUME_HZ) return false;
      if (!screen()) return false;
      lastAt = now;
      return true;
    },
    send(msg) {
      const to = screen();
      if (!to || !net.online) return;
      net.send(TOPIC_PLUME, msg, to);
      sent++;
    },
    get sent() {
      return sent;
    },
    dispose() {},
  };
};

export interface Downlink {
  readonly slots: Slots;
  /** Plumes heard, and those from frames run by people rather than bots or attract. */
  readonly heard: number;
  readonly lastHuman: number;
  dispose(): void;
}

export const createDownlink = (
  net: Channel,
  opts: { side: number; count: number; now: () => number; clock: () => number },
): Downlink => {
  const slots = createSlots(Math.max(1, opts.count));
  let heard = 0;
  let lastHuman = Number.NEGATIVE_INFINITY;
  const off = net.on(TOPIC_PLUME, (data, from) => {
    const peer = net.peers().find((p) => p.frame === from);
    if (!peer || peer.role === "screen" || sideOf(peer) !== opts.side) return;
    const p = decodePlume(data);
    if (!p || !fresh(p.t, opts.clock())) return;
    const now = opts.now();
    slots.hear(p, now);
    heard++;
    if (!p.auto) lastHuman = now;
  });
  return {
    slots,
    get heard() {
      return heard;
    },
    get lastHuman() {
      return lastHuman;
    },
    dispose() {
      off();
      slots.clear();
    },
  };
};
