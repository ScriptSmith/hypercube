/**
 * The one message on a bank: a touch frame's plume, its top edge sampled across its width,
 * sent to the screen above about PLUME_HZ times a second. Each sample has its air's speed up and
 * to the right (in steady winds, as bytes around 128 spanning PLUME_RANGE either way) and its
 * three smoke colours (bytes, 0 to 1). Decoders check every field and return null otherwise.
 */
import { PLUME_RANGE } from "./config";

export const TOPIC_PLUME = "af:plume";

/** Most samples a frame may send (a merged frame of several panels sends more). */
export const MAX_SAMPLES = 256;
/** Messages stamped further than this from the receiver's clock are refused. */
export const MAX_SKEW_MS = 10_000;
const MAX_POS = 63;

export interface PlumeMsg {
  /** The sender's position along the bank. */
  p: number;
  /** Samples. */
  n: number;
  /** Base64 of 5n bytes: n up, n right, then n each of the three smoke colours. */
  d: string;
  /** Shared clock time. */
  t: number;
  /** Sent while bots or the attract show run the frame. */
  a: boolean;
}

export interface Plume {
  pos: number;
  n: number;
  up: Float32Array;
  right: Float32Array;
  /** Smoke per sample: r, g, b. */
  smoke: Float32Array;
  t: number;
  auto: boolean;
}

export const byteOf = (v: number): number =>
  Math.min(
    255,
    Math.max(0, Math.round(128 + (Math.min(1, Math.max(-1, v / PLUME_RANGE)) || 0) * 127)),
  );
export const speedOfByte = (b: number): number => ((b - 128) / 127) * PLUME_RANGE;

const toBase64 = (bytes: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
};

const fromBase64 = (s: string): Uint8Array | null => {
  try {
    const raw = atob(s);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
};

/**
 * A message from the GPU's plume readback: `n` texels of (up, right, -, -) then `n` of
 * (r, g, b, -), as bytes.
 */
export const encodePlume = (
  pos: number,
  read: Uint8Array,
  n: number,
  t: number,
  auto: boolean,
): PlumeMsg => {
  const bytes = new Uint8Array(n * 5);
  for (let k = 0; k < n; k++) {
    bytes[k] = read[k * 4] ?? 128;
    bytes[n + k] = read[k * 4 + 1] ?? 128;
    const s = (n + k) * 4;
    bytes[2 * n + k] = read[s] ?? 0;
    bytes[3 * n + k] = read[s + 1] ?? 0;
    bytes[4 * n + k] = read[s + 2] ?? 0;
  }
  return { p: pos, n, d: toBase64(bytes), t: Math.round(t), a: auto };
};

/** A message from plain values (tests and the CPU side). */
export const encodeValues = (
  pos: number,
  up: ArrayLike<number>,
  right: ArrayLike<number>,
  smoke: ArrayLike<number>,
  t: number,
  auto: boolean,
): PlumeMsg => {
  const n = up.length;
  const bytes = new Uint8Array(n * 5);
  const unit = (v: number) => Math.min(255, Math.max(0, Math.round((v || 0) * 255)));
  for (let k = 0; k < n; k++) {
    bytes[k] = byteOf(up[k] ?? 0);
    bytes[n + k] = byteOf(right[k] ?? 0);
    bytes[2 * n + k] = unit(smoke[k * 3] ?? 0);
    bytes[3 * n + k] = unit(smoke[k * 3 + 1] ?? 0);
    bytes[4 * n + k] = unit(smoke[k * 3 + 2] ?? 0);
  }
  return { p: pos, n, d: toBase64(bytes), t: Math.round(t), a: auto };
};

const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const int = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

export const decodePlume = (data: unknown): Plume | null => {
  const d = obj(data);
  if (!d) return null;
  const { p, n, t, a } = d;
  if (!int(p, 0, MAX_POS) || !int(n, 1, MAX_SAMPLES) || typeof d.d !== "string") return null;
  if (typeof t !== "number" || !Number.isFinite(t) || typeof a !== "boolean") return null;
  if (d.d.length > Math.ceil((n * 5) / 3) * 4 + 4) return null;
  const bytes = fromBase64(d.d);
  if (!bytes || bytes.length !== n * 5) return null;
  const up = new Float32Array(n);
  const right = new Float32Array(n);
  const smoke = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    up[k] = speedOfByte(bytes[k]!);
    right[k] = speedOfByte(bytes[n + k]!);
    smoke[k * 3] = bytes[2 * n + k]! / 255;
    smoke[k * 3 + 1] = bytes[3 * n + k]! / 255;
    smoke[k * 3 + 2] = bytes[4 * n + k]! / 255;
  }
  return { pos: p, n, up, right, smoke, t, auto: a };
};

/** True when a message stamped `t` is close enough to `now` (both on the shared clock). */
export const fresh = (t: number, now: number): boolean => Math.abs(t - now) <= MAX_SKEW_MS;
