import type { Room } from "../types";
import {
  createVerifier,
  type Envelope,
  ENVELOPE_VERSION,
  newNonce,
  type Rejection,
  signEnvelope,
} from "./sign";
import type { Target } from "./target";

export const ADMIN_CHANNEL = "admin";
const TOPIC = "env";
/**
 * Envelopes waiting for verification; more than this and new ones are dropped. Log replies from a
 * large selection can arrive in a burst of a few hundred.
 */
const MAX_PENDING = 256;

/** Signed admin traffic over the room's "admin" channel. Frames and consoles each open one. */
export interface AdminLink {
  readonly self: string;
  /**
   * Sign and send. With `to`, only that frame gets it. Envelopes sent to everyone are also
   * delivered to this link's own listeners, because the hub never echoes a sender's messages.
   */
  send(target: Target, cmd: string, args?: unknown, to?: string): Promise<Envelope | null>;
  /** Verified envelopes from the room and from this link itself. */
  on(cb: (env: Envelope) => void): () => void;
  /** Envelopes dropped so far, by reason. */
  readonly rejected: Readonly<Record<Rejection | "overflow", number>>;
  dispose(): void;
}

export interface LinkOptions {
  /** Nonces already used, as [id, ts], e.g. remembered across a reload. */
  seen?: readonly [string, number][];
}

export const createLink = (
  room: Room,
  key: Promise<CryptoKey | null>,
  opts: LinkOptions = {},
): AdminLink => {
  const channel = room.channel(ADMIN_CHANNEL);
  const verifier = createVerifier(key, () => room.clock.now());
  for (const [id, ts] of opts.seen ?? []) verifier.remember(id, ts);
  const listeners = new Set<(env: Envelope) => void>();
  const rejected: Record<Rejection | "overflow", number> = {
    malformed: 0,
    sender: 0,
    signature: 0,
    stale: 0,
    replay: 0,
    overflow: 0,
  };
  let chain: Promise<void> = Promise.resolve();
  let pending = 0;
  let disposed = false;

  const dispatch = (env: Envelope) => {
    if (disposed) return;
    for (const cb of listeners) {
      try {
        cb(env);
      } catch (err) {
        console.error("[admin] listener failed", err);
      }
    }
  };

  // One at a time, so a set followed by a clear is applied in the order it arrived.
  channel.on(TOPIC, (data, from) => {
    if (disposed) return;
    if (pending >= MAX_PENDING) {
      rejected.overflow++;
      return;
    }
    pending++;
    chain = chain.then(async () => {
      try {
        const result = await verifier.check(data, from);
        if ("env" in result) dispatch(result.env);
        else rejected[result.reason]++;
      } finally {
        pending--;
      }
    });
  });

  return {
    get self() {
      return room.self;
    },
    async send(target, cmd, args, to) {
      const k = await key;
      if (!k || disposed) return null;
      const unsigned: Omit<Envelope, "sig"> = {
        v: ENVELOPE_VERSION,
        id: newNonce(),
        ts: Math.round(room.clock.now()),
        from: room.self,
        target,
        cmd,
      };
      if (args !== undefined) unsigned.args = args;
      const env = await signEnvelope(k, unsigned);
      if (disposed) return null;
      verifier.remember(env.id, env.ts);
      channel.send(TOPIC, env, to);
      if (to === undefined || to === room.self) queueMicrotask(() => dispatch(env));
      return env;
    },
    on(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    rejected,
    dispose() {
      disposed = true;
      listeners.clear();
      channel.close?.();
    },
  };
};
