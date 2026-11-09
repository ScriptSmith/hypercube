/**
 * Shapes on a bench: where a piece's body and ports are, and the route a wire takes. A wire's
 * route depends only on its two ports, never on the path a finger took: a cubic curve that
 * leaves each port in the way the port faces.
 */
import { type Circuit, KINDS, type Piece, type PieceKind } from "./circuit";
import type { BenchLayout, Box, Point } from "./layout";

export interface Port {
  piece: number;
  /** Input pin, or -1 for the output. */
  pin: number;
  x: number;
  y: number;
  /** Unit vector the port faces, out of its piece. */
  dx: number;
  dy: number;
}

/** Size of a piece of this kind on this bench. */
export const pieceSize = (l: BenchLayout, kind: PieceKind): { w: number; h: number } => {
  const band = KINDS[kind].band;
  if (band === "child") return { w: l.child, h: l.child };
  if (band === "adult") return { w: l.gateW, h: l.gateH };
  return { w: 90, h: 90 };
};

export const bodyBox = (l: BenchLayout, kind: PieceKind, x: number, y: number): Box => {
  const s = pieceSize(l, kind);
  return { x: x - s.w / 2, y: y - s.h / 2, width: s.w, height: s.h };
};

/** Ports of a piece of `kind` centred at (x, y). Posts use their spot in the layout instead. */
export const portsAt = (
  l: BenchLayout,
  kind: PieceKind,
  id: number,
  x: number,
  y: number,
): Port[] => {
  const k = KINDS[kind];
  const s = pieceSize(l, kind);
  const ports: Port[] = [];
  if (k.band === "child") {
    const lead = s.h * 0.06;
    ports.push({ piece: id, pin: k.output ? -1 : 0, x, y: y - s.h / 2 - lead, dx: 0, dy: -1 });
    return ports;
  }
  // Gate ports sit just inside the piece's width, so neighbouring gates' ports stay apart.
  const edge = s.w / 2 - s.w * 0.05;
  if (k.inputs === 1) ports.push({ piece: id, pin: 0, x: x - edge, y, dx: -1, dy: 0 });
  if (k.inputs === 2) {
    const off = s.h * 0.25;
    ports.push({ piece: id, pin: 0, x: x - edge, y: y - off, dx: -1, dy: 0 });
    ports.push({ piece: id, pin: 1, x: x - edge, y: y + off, dx: -1, dy: 0 });
  }
  if (k.output) ports.push({ piece: id, pin: -1, x: x + edge, y, dx: 1, dy: 0 });
  return ports;
};

/** Where a piece is drawn: its socket, unless a finger is carrying it. */
export type Placement = (p: Piece) => Point;

export const socketPoint = (l: BenchLayout, socket: number): Point => {
  const s = l.sockets[socket];
  return s ? { x: s.x, y: s.y } : { x: 0, y: 0 };
};

export const portsOf = (l: BenchLayout, p: Piece, at?: Point): Port[] => {
  if (p.kind === "post") {
    const post = l.posts.find((q) => q.socket === p.socket);
    if (!post) return [];
    return [
      { piece: p.id, pin: 0, x: post.port.x, y: post.port.y, dx: post.dir.x, dy: post.dir.y },
    ];
  }
  const c = at ?? socketPoint(l, p.socket);
  return portsAt(l, p.kind, p.id, c.x, c.y);
};

export const portOf = (l: BenchLayout, p: Piece, pin: number, at?: Point): Port | undefined =>
  portsOf(l, p, at).find((q) => q.pin === pin);

/** Every port on the bench, with carried pieces where their fingers hold them. */
export const allPorts = (l: BenchLayout, c: Circuit, place?: Placement): Port[] =>
  c.pieces.flatMap((p) => portsOf(l, p, place ? place(p) : undefined));

/** The nearest port within `r` that passes `ok`. */
export const nearestPort = (
  ports: readonly Port[],
  x: number,
  y: number,
  r: number,
  ok: (p: Port) => boolean = () => true,
): Port | null => {
  let best: Port | null = null;
  let bestD = r * r;
  for (const p of ports) {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d <= bestD && ok(p)) {
      best = p;
      bestD = d;
    }
  }
  return best;
};

// ---- Wire routes ------------------------------------------------------------------------------

export interface Curve {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x3: number;
  y3: number;
}

/**
 * The route between two ports: a cubic that leaves `a` along its facing and enters `b` along
 * its facing. `b` may be a free end (a finger), which then has no facing of its own.
 */
export const route = (
  a: { x: number; y: number; dx: number; dy: number },
  b: { x: number; y: number; dx: number; dy: number },
  minLead: number,
): Curve => {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const lead = Math.max(minLead, Math.min(d * 0.45, minLead * 6));
  return {
    x0: a.x,
    y0: a.y,
    x1: a.x + a.dx * lead,
    y1: a.y + a.dy * lead,
    x2: b.x + b.dx * lead,
    y2: b.y + b.dy * lead,
    x3: b.x,
    y3: b.y,
  };
};

export const pointOn = (c: Curve, t: number): Point => {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return {
    x: a * c.x0 + b * c.x1 + d * c.x2 + e * c.x3,
    y: a * c.y0 + b * c.y1 + d * c.y2 + e * c.y3,
  };
};

/** Arc-length table of a curve in `n` steps, written into `out` (length n + 1). */
export const arcTable = (c: Curve, out: Float32Array): number => {
  const n = out.length - 1;
  let prev = pointOn(c, 0);
  out[0] = 0;
  let total = 0;
  for (let i = 1; i <= n; i++) {
    const p = pointOn(c, i / n);
    total += Math.hypot(p.x - prev.x, p.y - prev.y);
    out[i] = total;
    prev = p;
  }
  return total;
};

/** The curve parameter at arc length `s`, from a table made by `arcTable`. */
export const paramAt = (table: Float32Array, s: number): number => {
  const n = table.length - 1;
  const total = table[n] ?? 0;
  if (s <= 0 || total <= 0) return 0;
  if (s >= total) return 1;
  let lo = 0;
  let hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((table[mid] ?? 0) < s) lo = mid;
    else hi = mid;
  }
  const a = table[lo] ?? 0;
  const b = table[hi] ?? a;
  return (lo + (b > a ? (s - a) / (b - a) : 0)) / n;
};

/** Facing for a free wire end: back towards the port it comes from, so the curve stays gentle. */
export const freeEnd = (from: Port, x: number, y: number) => {
  const d = Math.hypot(x - from.x, y - from.y) || 1;
  return { x, y, dx: (from.x - x) / d, dy: (from.y - y) / d };
};
