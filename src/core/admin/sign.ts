import { fromBase64Url, toBase64Url } from "../adminkey";
import { readTarget, type Target } from "./target";

/**
 * Admin envelopes are HMAC-SHA256 signed with the room's admin key (`ak`, itself derived from the
 * operator's PIN). The signature covers the canonical form of every field except `sig`, so both
 * ends hash the same bytes whatever order the keys arrive in.
 */
export const ENVELOPE_VERSION = 1;
/** Envelopes further than this from the receiver's room clock are refused. */
export const MAX_SKEW_MS = 30_000;
/** Nonces remembered for replay checks. */
// Commands and state acks share this set. About 30 frames acking a burst of commands must not
// evict a nonce that is still inside the skew window.
export const REPLAY_LIMIT = 8192;
export const MAX_ENVELOPE_BYTES = 8 * 1024;

export interface Envelope {
  v: typeof ENVELOPE_VERSION;
  /** Random nonce. */
  id: string;
  /** Room clock ms when sent. */
  ts: number;
  /** Sender frame id. */
  from: string;
  target: Target;
  cmd: string;
  args?: unknown;
  sig: string;
}

export type Unsigned = Omit<Envelope, "sig">;

export type Rejection = "malformed" | "sender" | "signature" | "stale" | "replay";

/** JSON with object keys sorted at every level, no whitespace and no undefined fields. */
export const canonical = (value: unknown): string => {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("cannot sign a non-finite number");
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((v: unknown) => (v === undefined ? "null" : canonical(v))).join(",")}]`;
      }
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
    }
    default:
      throw new TypeError(`cannot sign a ${typeof value}`);
  }
};

const encoder = new TextEncoder();

/** The HMAC key for `ak`, or null when `ak` is not a usable key. */
export const importAdminKey = async (ak: string): Promise<CryptoKey | null> => {
  try {
    const raw = new Uint8Array(fromBase64Url(ak));
    if (raw.length < 16) return null;
    return await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
      "verify",
    ]);
  } catch {
    return null;
  }
};

export const newNonce = (): string => toBase64Url(crypto.getRandomValues(new Uint8Array(12)));

export const signEnvelope = async (key: CryptoKey, unsigned: Unsigned): Promise<Envelope> => {
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(canonical(unsigned)));
  return { ...unsigned, sig: toBase64Url(new Uint8Array(sig)) };
};

/** The envelope's fields, checked for shape only. The signature is not checked here. */
export const readEnvelope = (raw: unknown): Envelope | null => {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== ENVELOPE_VERSION) return null;
  if (typeof o.id !== "string" || o.id.length < 8 || o.id.length > 64) return null;
  if (typeof o.ts !== "number" || !Number.isFinite(o.ts)) return null;
  if (typeof o.from !== "string" || o.from.length === 0 || o.from.length > 128) return null;
  if (typeof o.cmd !== "string" || o.cmd.length === 0 || o.cmd.length > 32) return null;
  if (typeof o.sig !== "string" || o.sig.length > 64) return null;
  const target = readTarget(o.target);
  if (!target) return null;
  const env: Envelope = {
    v: ENVELOPE_VERSION,
    id: o.id,
    ts: o.ts,
    from: o.from,
    target,
    cmd: o.cmd,
    sig: o.sig,
  };
  if (o.args !== undefined) env.args = o.args;
  return env;
};

/** Checks `sig` over everything else in the object as received, unknown fields included. */
export const verifySignature = async (key: CryptoKey, raw: unknown): Promise<boolean> => {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return false;
  const { sig, ...rest } = raw as Record<string, unknown>;
  if (typeof sig !== "string") return false;
  let bytes: Uint8Array<ArrayBuffer>;
  let text: string;
  try {
    bytes = new Uint8Array(fromBase64Url(sig));
    text = canonical(rest);
  } catch {
    return false;
  }
  if (bytes.length !== 32 || text.length > MAX_ENVELOPE_BYTES) return false;
  try {
    return await crypto.subtle.verify("HMAC", key, bytes, encoder.encode(text));
  } catch {
    return false;
  }
};

export interface Verifier {
  /**
   * Accepts a signed, fresh, unseen envelope. `from` is the sender the network reported, which
   * must match the envelope's own.
   */
  check(raw: unknown, from?: string): Promise<{ env: Envelope } | { reason: Rejection }>;
  /** Treat a nonce as seen, e.g. one this frame sent itself. */
  remember(id: string, ts: number): void;
}

export const createVerifier = (
  key: CryptoKey | Promise<CryptoKey | null>,
  now: () => number,
  limit = REPLAY_LIMIT,
): Verifier => {
  /** Nonce to timestamp, oldest first. */
  const seen = new Map<string, number>();

  const remember = (id: string, ts: number) => {
    seen.delete(id);
    seen.set(id, ts);
    // Entries outside the skew window can't be replayed anyway, so they go first.
    const oldest = now() - 2 * MAX_SKEW_MS;
    for (const [nonce, at] of seen) {
      if (seen.size <= limit && at >= oldest) break;
      seen.delete(nonce);
    }
  };

  return {
    async check(raw, from) {
      const env = readEnvelope(raw);
      if (!env) return { reason: "malformed" };
      if (from !== undefined && env.from !== from) return { reason: "sender" };
      const k = await key;
      if (!k || !(await verifySignature(k, raw))) return { reason: "signature" };
      if (Math.abs(env.ts - now()) > MAX_SKEW_MS) return { reason: "stale" };
      if (seen.has(env.id)) return { reason: "replay" };
      remember(env.id, env.ts);
      return { env };
    },
    remember,
  };
};
