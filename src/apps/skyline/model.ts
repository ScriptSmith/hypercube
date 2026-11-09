/**
 * What a crane's pad shows and what its bots read, built from a crane simulated here or from
 * the screen's `st` and `geo` messages. Positions are in the pad's box: 0..1 across the
 * trolley's travel, 0..1 up to the top of the hook's work. Pure.
 */
import { BH, BLOCK_DRAW_W, G as GRAVITY } from "./config";
import type { Crane, Point, Readout } from "./crane";
import type { CraneGeo, CraneState } from "./wire";

export type Driver = "auto" | "person" | "bot";
export const DRIVER_CODE: Record<Driver, number> = { auto: 0, person: 1, bot: 2 };
export const DRIVERS: Driver[] = ["auto", "person", "bot"];

export interface PadShape {
  /** Bottom-left corner. */
  x: number;
  y: number;
  /** -1 while empty. */
  kind: number;
  top: boolean;
  round: boolean;
  /** The slot the next block goes in. */
  next: boolean;
}

export interface PadModel {
  /** Block size. */
  bw: number;
  bh: number;
  slots: PadShape[];
  /** Yard slot centres and what is in them (-1 empty). */
  yard: { x: number; kind: number }[];
  trolley: number;
  hook: Point;
  load: Point | null;
  carrying: number;
  target: Point;
  /** Where the carried block would snap (centre), for the guide line. */
  guide: Point | null;
  driver: Driver;
  /** Blocks the yard can still take, counting those on their way. */
  room: number;
  inZone: boolean;
}

/** The pad's picture of a crane simulated on this frame. */
export const padFromCrane = (crane: Crane, driver: Driver, assist: boolean): PadModel => {
  const r = crane.readout();
  const span = crane.world.tMax - crane.world.tMin;
  const bw = BLOCK_DRAW_W / span;
  const bh = BH / crane.workTop;
  const hint = crane.hint();
  const slots: PadShape[] = [];
  if (crane.tower) {
    const t = crane.tower;
    t.blocks.forEach((b, i) => {
      const p = crane.toNorm({ x: b.x - 0.5, y: i * BH });
      slots.push({ x: p.x, y: p.y, kind: b.kind, top: true, round: false, next: false });
    });
    if (t.phase === "build") {
      const n = t.blocks.length;
      const x = n > 0 ? t.blocks[n - 1]!.x : t.x;
      const p = crane.toNorm({ x: x - 0.5, y: n * BH });
      slots.push({ x: p.x, y: p.y, kind: -1, top: true, round: false, next: true });
    }
  } else {
    crane.lots.forEach((lot, li) => {
      lot.bp.slots.forEach((s, i) => {
        const p = crane.toNorm({ x: lot.left + s.x, y: s.r * BH });
        slots.push({
          x: p.x,
          y: p.y,
          kind: lot.filled[i] ?? -1,
          top: s.top,
          round: lot.bp.shape === "round",
          next: !!hint.next && hint.next.lot === li && hint.next.slot === i,
        });
      });
    });
  }
  const yard = crane.world.yard.map((x, i) => ({
    x: crane.toNorm({ x, y: 0 }).x,
    kind: crane.yard[i]?.kind ?? -1,
  }));
  return {
    bw,
    bh,
    slots,
    yard,
    trolley: r.trolley,
    hook: r.hook,
    load: r.load,
    carrying: r.carrying,
    target: r.target,
    guide: assist && hint.snap ? crane.toNorm(hint.snap) : null,
    driver,
    room: crane.freeSlots() - crane.riders.length,
    inZone: r.inZone,
  };
};

const k1 = (v: number) => Math.round(v * 1000);
const opt = (p: Point | null, axis: "x" | "y") => (p ? k1(p[axis]) : -1);

/** The `st` entry for a crane the screen simulates. */
export const stateFromCrane = (
  crane: Crane,
  c: number,
  gen: number,
  driver: Driver,
  assist: boolean,
): CraneState => {
  const r = crane.readout();
  const hint = crane.hint();
  const guide = assist && hint.snap ? crane.toNorm(hint.snap) : null;
  const kinds = (list: (number | null)[]) =>
    list.map((k) => (k === null ? "-" : String(k))).join("");
  let f: string;
  if (crane.tower) {
    f = crane.tower.blocks.map((b) => String(b.kind)).join("");
    if (crane.tower.phase === "build") f += "-";
  } else {
    f = crane.lots.map((l) => kinds(l.filled)).join("");
  }
  return {
    c,
    g: gen,
    tr: k1(r.trolley),
    hx: k1(r.hook.x),
    hy: k1(r.hook.y),
    lx: opt(r.load, "x"),
    ly: opt(r.load, "y"),
    k: r.carrying,
    tx: k1(r.target.x),
    ty: k1(r.target.y),
    d: DRIVER_CODE[driver],
    f: f.slice(0, 64),
    yd: kinds(crane.yard.map((b) => b?.kind ?? null)).slice(0, 8),
    fr: Math.max(0, Math.min(9, crane.room())),
    px: opt(r.pick, "x"),
    py: opt(r.pick, "y"),
    dx: opt(r.drop, "x"),
    dy: opt(r.drop, "y"),
    qx: opt(r.park, "x"),
    qy: opt(r.park, "y"),
    cy: k1(r.carry),
    sw: Math.min(10_000, Math.round(r.sway * 1000)),
    pe: Math.min(10_000, Math.round(r.period * 100)),
    vx: Math.min(100_000, k1(r.vx)),
    ax: Math.min(100_000, k1(r.ax)),
    vy: Math.min(100_000, k1(r.vy)),
    un: Math.min(1000, k1(r.unit)),
    j: Math.min(1000, k1(r.jitter)),
    z: r.inZone ? 1 : 0,
    gx: opt(guide, "x"),
    gy: opt(guide, "y"),
  };
};

/** Shapes on the pad's picture, changing only when a lot (or a tall tower) changes. */
export const geoKey = (crane: Crane): string =>
  crane.tower
    ? `t${crane.tower.blocks.map((b) => Math.round(b.x * 100)).join(",")}:${crane.tower.phase}`
    : crane.lots.map((l) => `${l.bp.shape}${l.bp.slots.length}@${l.left.toFixed(2)}`).join("|");

export const geoFromCrane = (
  crane: Crane,
  c: number,
  gen: number,
  mast: { u: number; w: number },
): CraneGeo => {
  const model = padFromCrane(crane, "auto", false);
  const span = crane.world.tMax - crane.world.tMin;
  return {
    c,
    g: gen,
    bw: Math.max(1, Math.min(1000, k1(BLOCK_DRAW_W / span))),
    bh: Math.max(1, Math.min(1000, k1(BH / crane.workTop))),
    sl: model.slots.slice(0, 64).flatMap((s) => [k1(s.x), k1(s.y)]),
    tp: model.slots
      .slice(0, 64)
      .map((s) => (s.top ? "1" : "0"))
      .join(""),
    rd: model.slots
      .slice(0, 64)
      .map((s) => (s.round ? "1" : "0"))
      .join(""),
    yx: model.yard.slice(0, 8).map((y) => k1(y.x)),
    mu: Math.max(0, Math.min(1000, k1(mast.u))),
    mw: Math.max(0, Math.min(400, k1(mast.w))),
  };
};

const fromK = (v: number) => v / 1000;
const pt = (x: number, y: number): Point | null =>
  x < 0 && y < 0 ? null : { x: fromK(x), y: fromK(y) };
const kindAt = (s: string, i: number) => {
  const ch = s[i];
  return ch === undefined || ch === "-" ? -1 : Number(ch);
};

/** What a bank frame's bots read: the screen's crane, as of its last word. */
export const readoutFromState = (st: CraneState): Readout => ({
  hook: { x: fromK(st.hx), y: fromK(st.hy) },
  target: { x: fromK(st.tx), y: fromK(st.ty) },
  trolley: fromK(st.tr),
  carrying: st.k,
  load: st.k >= 0 ? { x: fromK(st.lx), y: fromK(st.ly) } : null,
  pick: pt(st.px, st.py),
  drop: pt(st.dx, st.dy),
  park: pt(st.qx, st.qy),
  carry: fromK(st.cy),
  sway: st.sw / 1000,
  // The swing's reach from its angle and the cable length its period implies.
  drift: (st.sw / 1000) * GRAVITY * (Math.max(0.5, st.pe / 100) / (2 * Math.PI)) ** 2,
  period: Math.max(0.5, st.pe / 100),
  vx: fromK(st.vx),
  ax: fromK(st.ax),
  vy: fromK(st.vy),
  inZone: st.z === 1,
  jitter: fromK(st.j),
  unit: fromK(st.un),
});

/** The pad's picture from the screen's messages, or null until both have come. */
export const padFromRemote = (
  st: CraneState,
  geo: CraneGeo | null,
  room: number,
): PadModel | null => {
  if (!geo || geo.g !== st.g) return null;
  const n = geo.sl.length / 2;
  const slots: PadShape[] = [];
  const next = (() => {
    // While a block hangs on the hook, the lowest empty slot is where it goes next (as the
    // screen's autopilot picks), as on a crane simulated here.
    if (st.k < 0) return -1;
    let best = -1;
    for (let i = 0; i < n; i++) {
      if (kindAt(st.f, i) >= 0) continue;
      if (best < 0 || geo.sl[2 * i + 1]! < geo.sl[2 * best + 1]!) best = i;
    }
    return best;
  })();
  for (let i = 0; i < n; i++) {
    slots.push({
      x: fromK(geo.sl[2 * i]!),
      y: fromK(geo.sl[2 * i + 1]!),
      kind: kindAt(st.f, i),
      top: geo.tp[i] === "1",
      round: geo.rd[i] === "1",
      next: i === next,
    });
  }
  return {
    bw: fromK(geo.bw),
    bh: fromK(geo.bh),
    slots,
    yard: geo.yx.map((x, i) => ({ x: fromK(x), kind: kindAt(st.yd, i) })),
    trolley: fromK(st.tr),
    hook: { x: fromK(st.hx), y: fromK(st.hy) },
    load: st.k >= 0 ? { x: fromK(st.lx), y: fromK(st.ly) } : null,
    carrying: st.k,
    target: { x: fromK(st.tx), y: fromK(st.ty) },
    guide: pt(st.gx, st.gy),
    driver: DRIVERS[st.d] ?? "auto",
    room,
    inZone: st.z === 1,
  };
};
