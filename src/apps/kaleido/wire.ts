/**
 * Bank messages, quantised and checked field by field on arrival (any page on the public site can
 * join a room it guesses, so anything out of range drops the whole message).
 *
 * - `ink` (touch frame to the screen on its side, about 30 a second while touched, and once more
 *   when the last finger lifts): per finger an id, x as a fraction across the bank, y as a
 *   fraction down the frame, velocity in frame heights a second, colour and flags. Ten fingers
 *   come to about 330 bytes as JSON.
 * - `sky` (screen beacon to the group, twice a second): its side and variant and, for the
 *   kaleidoscope, the parameters it is drawing, so touch frames' small kaleidoscopes match.
 */
import type { KParams } from "./kparams";

export const TOPIC = { ink: "kl:ink", sky: "kl:sky" } as const;

export const INK_HZ = 30;
export const SKY_EVERY_MS = 500;
/** A touch frame with no beacon for this long draws its own layers. */
export const SKY_TIMEOUT_MS = 3000;
/** The screen forgets a frame's fingers this long after its last message. */
export const FORGET_MS = 500;

export const MAX_POS = 16;
export const MAX_FINGERS = 20;
const FIELDS = 7;
const XQ = 4095;
const YQ = 1023;
const VQ = 100;
const V_MAX = 4;

export const FLAG = { hot: 1, human: 2 } as const;

export interface WireFinger {
  /** Small id, stable while the finger is down. */
  id: number;
  /** Fraction across the bank. */
  x: number;
  /** Fraction down the frame, 0 at the top. */
  y: number;
  /** Frame heights a second; y grows downwards. */
  vx: number;
  vy: number;
  /** 24-bit colour. */
  rgb: number;
  /** Poured in the adult band. */
  hot: boolean;
  /** A person's finger (not a bot or the attract). */
  human: boolean;
}

export interface InkMsg {
  pos: number;
  count: number;
  fingers: WireFinger[];
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const fin = (v: number) => (Number.isFinite(v) ? v : 0);
const isInt = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

export const encodeInk = (m: InkMsg): { p: number; n: number; f: number[] } => {
  const f: number[] = [];
  for (const g of m.fingers.slice(0, MAX_FINGERS)) {
    f.push(
      clamp(Math.round(fin(g.id)), 0, 63),
      Math.round(clamp(fin(g.x), 0, 1) * XQ),
      Math.round(clamp(fin(g.y), 0, 1) * YQ),
      Math.round(clamp(fin(g.vx), -V_MAX, V_MAX) * VQ),
      Math.round(clamp(fin(g.vy), -V_MAX, V_MAX) * VQ),
      clamp(Math.round(fin(g.rgb)), 0, 0xffffff),
      (g.hot ? FLAG.hot : 0) | (g.human ? FLAG.human : 0),
    );
  }
  return {
    p: clamp(Math.round(fin(m.pos)), 0, MAX_POS - 1),
    n: clamp(Math.round(fin(m.count)), 1, MAX_POS),
    f,
  };
};

export const decodeInk = (data: unknown): InkMsg | null => {
  const d = obj(data);
  if (!d) return null;
  const { p, n, f } = d;
  if (!isInt(n, 1, MAX_POS) || !isInt(p, 0, n - 1) || !Array.isArray(f)) return null;
  if (f.length % FIELDS !== 0 || f.length > MAX_FINGERS * FIELDS) return null;
  const fingers: WireFinger[] = [];
  const ids = new Set<number>();
  for (let i = 0; i < f.length; i += FIELDS) {
    const [id, x, y, vx, vy, rgb, flags] = f.slice(i, i + FIELDS) as unknown[];
    if (!isInt(id, 0, 63) || ids.has(id) || !isInt(x, 0, XQ) || !isInt(y, 0, YQ)) return null;
    if (!isInt(vx, -V_MAX * VQ, V_MAX * VQ) || !isInt(vy, -V_MAX * VQ, V_MAX * VQ)) return null;
    if (!isInt(rgb, 0, 0xffffff) || !isInt(flags, 0, 3)) return null;
    ids.add(id);
    fingers.push({
      id,
      x: x / XQ,
      y: y / YQ,
      vx: vx / VQ,
      vy: vy / VQ,
      rgb,
      hot: (flags & FLAG.hot) !== 0,
      human: (flags & FLAG.human) !== 0,
    });
  }
  return { pos: p, count: n, fingers };
};

export interface SkyMsg {
  side: number;
  variant: "strata" | "kaleido";
  /** The kaleidoscope's parameters, in `kaleido`. */
  k: KParams | null;
}

const CQ = 10000;
const RQ = 1000;
const ZQ = 1000;
const C_MAX = 2;
const Z_MIN = 0.2;
const Z_MAX = 5;
const MIRRORS = [6, 8, 12];

export const encodeSky = (m: SkyMsg): Record<string, unknown> => {
  const out: Record<string, unknown> = { s: m.side ? 1 : 0, v: m.variant === "kaleido" ? 1 : 0 };
  if (m.k) {
    const rot = Math.atan2(Math.sin(fin(m.k.rot)), Math.cos(fin(m.k.rot)));
    out.k = [
      Math.round(clamp(fin(m.k.cx), -C_MAX, C_MAX) * CQ),
      Math.round(clamp(fin(m.k.cy), -C_MAX, C_MAX) * CQ),
      Math.round(clamp(rot, -Math.PI, Math.PI) * RQ),
      Math.round(clamp(fin(m.k.zoom), Z_MIN, Z_MAX) * ZQ),
      MIRRORS.includes(m.k.mirrors) ? m.k.mirrors : 6,
    ];
  }
  return out;
};

export const decodeSky = (data: unknown): SkyMsg | null => {
  const d = obj(data);
  if (!d) return null;
  const { s, v, k } = d;
  if (!isInt(s, 0, 1) || !isInt(v, 0, 1)) return null;
  const variant = v === 1 ? "kaleido" : "strata";
  if (k === undefined) return { side: s, variant, k: null };
  if (!Array.isArray(k) || k.length !== 5) return null;
  const [cx, cy, rot, zoom, mirrors] = k as unknown[];
  const cl = C_MAX * CQ;
  if (!isInt(cx, -cl, cl) || !isInt(cy, -cl, cl)) return null;
  if (!isInt(rot, -Math.round(Math.PI * RQ), Math.round(Math.PI * RQ))) return null;
  if (!isInt(zoom, Z_MIN * ZQ, Z_MAX * ZQ) || !MIRRORS.includes(mirrors as number)) return null;
  return {
    side: s,
    variant,
    k: { cx: cx / CQ, cy: cy / CQ, rot: rot / RQ, zoom: zoom / ZQ, mirrors: mirrors as number },
  };
};
