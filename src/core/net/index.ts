import type { Channel, Clock, PeerInfo, Room, RoomOptions } from "../types";
import { roomNamespace } from "./ids";
import { localTransport } from "./local";
import { createRoom } from "./room";
import { brokerFor } from "./signalling";
import { deferredTransport, type Transport } from "./transport";

/** Local monotonic time, for frames that are not in a room. */
export const localClock = (): Clock => ({
  now: () => performance.timeOrigin + performance.now(),
  synced: false,
  onSync: () => () => {},
});

/** The app channel of a frame with no room: only itself in scope, sends dropped. */
export const offlineChannel = (self: PeerInfo): Channel => ({
  online: false,
  self: self.frame,
  peers: () => [self],
  leader: () => self.frame,
  send: () => {},
  on: () => () => {},
  onPeers: () => () => {},
});

/**
 * Join a room. `transport: "local"` uses BroadcastChannel (frames in one browser process, as in
 * the simulator); otherwise PeerJS, loaded on first use, with the public broker or our own
 * PeerServer. The room starts "connecting" and keeps retrying in the background; until it is
 * online the frame runs standalone with a roster of one.
 */
export const connectRoom = (opts: RoomOptions): Room => {
  if (opts.transport === "local" && typeof BroadcastChannel === "function") {
    return createRoom(opts, { transport: localTransport(roomNamespace(opts.room)) });
  }
  const broker = brokerFor(opts.signalling);
  const transport: Transport = deferredTransport(
    () => import("./peer").then((m) => m.peerTransport(opts.signalling)),
    broker.stale,
  );
  return createRoom(opts, { transport, timing: broker.timing });
};
