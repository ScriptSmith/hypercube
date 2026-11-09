/**
 * Bank messages. Every 2 s a touch frame tells the screen above it about each of its ponds (`pond`):
 * its floor, where its fish's tips go, every living fish in tip order (id, parent, age and genes
 * as twelve hex digits) and the fish that died since the last message. When it first hears a
 * screen it also sends the dead ancestors it remembers (`hist`), so a screen that starts late
 * still gets the whole tree. A fish swimming off a pond's edge goes to the neighbouring frame as
 * a `mig`, with its nearest ancestors. The screen sends a `beacon` every second.
 *
 * Times travel as ages in tenths of a second before the message's shared-clock time `t`. A pond
 * of 22 fish is about 1 KB. Everything that arrives is checked field by field and dropped whole
 * if anything is out of range, because any page on the public site can join a room it guesses.
 */
import { FLOORS, type FloorId, packGenes, unpackGenes } from "./genes";
import type { NodeRec } from "./lineage";

export const TOPIC = {
  pond: "ev:pond",
  hist: "ev:hist",
  beacon: "ev:beacon",
  migrant: "ev:mig",
} as const;

export const MAX_POS = 64;
export const MAX_ISLAND = 63;
const MAX_FISH = 96;
const MAX_DEAD = 160;
const MAX_HIST = 200;
const MAX_CHAIN = 12;
const MAX_ID = 2 ** 31;
/** Ages up to 10 hours, tenths of a second. */
const MAX_AGE = 360_000;
const T_MAX = 1e14;

export interface IslandMsg {
  island: number;
  floor: FloorId;
  /** Tip range across the frame, 0 to 1. */
  u0: number;
  u1: number;
  /** Living fish, in tip order. */
  fish: NodeRec[];
  /** Deaths since the last message: id and shared-clock ms. */
  dead: { id: number; t: number }[];
}

export interface PondMsg {
  /** Random per page load, so a reloaded frame's old fish end cleanly. */
  epoch: number;
  t: number;
  pos: number;
  count: number;
  /** Ponds on the sending frame. */
  ponds: number;
  islands: IslandMsg[];
}

export interface HistMsg {
  epoch: number;
  t: number;
  nodes: NodeRec[];
}

export interface MigrantMsg {
  t: number;
  /** Island it arrives in, and the edge it arrives at (-1 left, 1 right). */
  to: number;
  edge: -1 | 1;
  /** 0 top to 1 bottom. */
  y: number;
  /** Seconds lived and lifespan. */
  age: number;
  life: number;
  fish: NodeRec;
  chain: NodeRec[];
}

const isInt = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
const obj = (d: unknown): Record<string, unknown> | null =>
  typeof d === "object" && d !== null && !Array.isArray(d) ? (d as Record<string, unknown>) : null;

const ageOf = (t: number, at: number) => Math.round(Math.min(MAX_AGE, Math.max(0, (t - at) / 100)));

const encRec = (t: number, n: NodeRec): unknown[] => [
  n.id,
  n.parent,
  ageOf(t, n.born),
  packGenes(n.genes),
];

const decRec = (t: number, v: unknown): NodeRec | null => {
  if (!Array.isArray(v) || v.length !== 4) return null;
  const [id, parent, age, g] = v as unknown[];
  if (!isInt(id, 1, MAX_ID) || !isInt(parent, 0, MAX_ID) || !isInt(age, 0, MAX_AGE)) return null;
  if (parent === id) return null;
  const genes = unpackGenes(g);
  if (!genes) return null;
  return { id, parent, born: t - age * 100, genes };
};

const decList = (t: number, v: unknown, max: number): NodeRec[] | null => {
  if (!Array.isArray(v) || v.length > max) return null;
  const out: NodeRec[] = [];
  for (const x of v) {
    const r = decRec(t, x);
    if (!r) return null;
    out.push(r);
  }
  return out;
};

export const encodePond = (m: PondMsg): unknown => ({
  e: m.epoch >>> 0,
  t: Math.round(m.t),
  p: m.pos,
  n: m.count,
  k: m.ponds,
  i: m.islands.map((s) => ({
    i: s.island,
    f: FLOORS.indexOf(s.floor),
    u: [Math.round(s.u0 * 1000), Math.round(s.u1 * 1000)],
    x: s.fish.slice(0, MAX_FISH).map((f) => encRec(m.t, f)),
    d: s.dead.slice(-MAX_DEAD).map((d) => [d.id, ageOf(m.t, d.t)]),
  })),
});

export const decodePond = (data: unknown): PondMsg | null => {
  const o = obj(data);
  if (!o) return null;
  const { e, t, p, n, k, i } = o;
  if (!isInt(e, 0, 0xffffffff) || !isInt(t, 0, T_MAX)) return null;
  if (!isInt(p, 0, MAX_POS - 1) || !isInt(n, 1, MAX_POS) || p >= n || !isInt(k, 1, 4)) return null;
  if (!Array.isArray(i) || i.length < 1 || i.length > 4) return null;
  const islands: IslandMsg[] = [];
  for (const raw of i) {
    const s = obj(raw);
    if (!s) return null;
    if (!isInt(s.i, 0, MAX_ISLAND) || !isInt(s.f, 0, FLOORS.length - 1)) return null;
    const u = s.u;
    if (!Array.isArray(u) || u.length !== 2 || !isInt(u[0], 0, 1000) || !isInt(u[1], 0, 1000)) {
      return null;
    }
    if (u[1] <= u[0]) return null;
    const fish = decList(t, s.x, MAX_FISH);
    if (!fish) return null;
    if (!Array.isArray(s.d) || s.d.length > MAX_DEAD) return null;
    const dead: { id: number; t: number }[] = [];
    for (const d of s.d) {
      if (
        !Array.isArray(d) ||
        d.length !== 2 ||
        !isInt(d[0], 1, MAX_ID) ||
        !isInt(d[1], 0, MAX_AGE)
      ) {
        return null;
      }
      dead.push({ id: d[0], t: t - d[1] * 100 });
    }
    islands.push({
      island: s.i,
      floor: FLOORS[s.f]!,
      u0: u[0] / 1000,
      u1: u[1] / 1000,
      fish,
      dead,
    });
  }
  return { epoch: e, t, pos: p, count: n, ponds: k, islands };
};

export const encodeHist = (m: HistMsg): unknown => ({
  e: m.epoch >>> 0,
  t: Math.round(m.t),
  x: m.nodes.slice(0, MAX_HIST).map((f) => encRec(m.t, f)),
});

export const decodeHist = (data: unknown): HistMsg | null => {
  const o = obj(data);
  if (!o || !isInt(o.e, 0, 0xffffffff) || !isInt(o.t, 0, T_MAX)) return null;
  const nodes = decList(o.t, o.x, MAX_HIST);
  return nodes ? { epoch: o.e, t: o.t, nodes } : null;
};

export const HIST_CHUNK = MAX_HIST;

export const encodeMigrant = (m: MigrantMsg): unknown => ({
  t: Math.round(m.t),
  to: m.to,
  g: m.edge,
  y: Math.round(Math.min(1, Math.max(0, m.y)) * 1000),
  a: Math.round(Math.min(MAX_AGE, m.age * 10)),
  l: Math.round(Math.min(MAX_AGE, m.life * 10)),
  x: encRec(m.t, m.fish),
  c: m.chain.slice(0, MAX_CHAIN).map((n) => encRec(m.t, n)),
});

export const decodeMigrant = (data: unknown): MigrantMsg | null => {
  const o = obj(data);
  if (!o || !isInt(o.t, 0, T_MAX) || !isInt(o.to, 0, MAX_ISLAND)) return null;
  if (o.g !== -1 && o.g !== 1) return null;
  if (!isInt(o.y, 0, 1000) || !isInt(o.a, 0, MAX_AGE) || !isInt(o.l, 1, MAX_AGE)) return null;
  const fish = decRec(o.t, o.x);
  const chain = decList(o.t, o.c, MAX_CHAIN);
  if (!fish || !chain) return null;
  return {
    t: o.t,
    to: o.to,
    edge: o.g,
    y: o.y / 1000,
    age: o.a / 10,
    life: o.l / 10,
    fish,
    chain,
  };
};

export const encodeBeacon = (side: number): unknown => ({ s: side ? 1 : 0 });

export const decodeBeacon = (data: unknown): { side: number } | null => {
  const o = obj(data);
  return o && (o.s === 0 || o.s === 1) ? { side: o.s } : null;
};
