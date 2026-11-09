/**
 * What the room needs from a transport: claim an id with a broker, accept links to it, and
 * open links to other ids. PeerJS, BroadcastChannel and the in-memory fake all provide this,
 * so election, roster, relay and clock code never sees which one is in use.
 */

/** Why an id could not be claimed or reached. */
export type NetFailure = "taken" | "offline" | "unavailable" | "timeout" | "invalid";

export interface NetError extends Error {
  reason: NetFailure;
}

export const netError = (reason: NetFailure, message?: string): NetError =>
  Object.assign(new Error(message ?? reason), { reason });

export const failureOf = (err: unknown): NetFailure =>
  typeof err === "object" && err !== null && "reason" in err
    ? ((err as NetError).reason ?? "offline")
    : "offline";

/** A reliable, ordered text pipe to one other endpoint. */
export interface Link {
  /** Transport id of the far end. */
  readonly remote: string;
  /** False when the message was dropped because the link is closed or too backed up. */
  send(text: string): boolean;
  /** Close from this side. `onClose` does not fire for our own close. */
  close(): void;
  /** Messages that arrive before a handler is set are kept (a few) and replayed. */
  onMessage(cb: (text: string) => void): void;
  /** The far end closed, or the link failed. */
  onClose(cb: () => void): void;
  /** ICE candidate pair type in use, such as "host/host", when the transport knows it. */
  candidates?(): Promise<string | null>;
}

/** An id held with the broker. */
export interface Endpoint {
  readonly id: string;
  /** Links that other endpoints open to this id. Early arrivals are kept until a handler is set. */
  onLink(cb: (link: Link) => void): void;
  /** Rejects with a NetError: "unavailable", "timeout" or "offline". */
  connect(id: string, timeoutMs: number): Promise<Link>;
  /** The id was lost: another peer holds it now ("taken"), or the endpoint died ("offline"). */
  onLost(cb: (reason: "taken" | "offline") => void): void;
  /** Release the id and close every link. */
  close(): void;
}

export interface Transport {
  /**
   * Claim `id`. Rejects with a NetError: "taken", "offline" or "invalid". When two claims race,
   * a transport that arbitrates them itself prefers the lower `priority`.
   */
  open(id: string, priority?: number): Promise<Endpoint>;
  /** True when a taken id may still belong to a peer that has gone (brokers time them out). */
  readonly stale: boolean;
  close(): void;
}

/** Loads a transport on first use, so PeerJS stays out of the bundle until a room needs it. */
export const deferredTransport = (load: () => Promise<Transport>, stale: boolean): Transport => {
  let loading: Promise<Transport> | null = null;
  let closed = false;
  return {
    stale,
    async open(id, priority) {
      let transport: Transport;
      try {
        transport = await (loading ??= load());
      } catch {
        loading = null;
        throw netError("offline", "transport failed to load");
      }
      if (closed) throw netError("offline", "closed");
      return transport.open(id, priority);
    },
    close() {
      closed = true;
      void loading?.then(
        (t) => t.close(),
        () => {},
      );
    },
  };
};
