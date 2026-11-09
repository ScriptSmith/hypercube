/**
 * One bench's state and how touches change it, in venue px, with no DOM. A touch on a piece
 * either taps it (one detent clockwise) or drags it to another socket or back to its tray; a
 * touch on the ring around a placed piece turns it in 15 degree detents. In free play, trays are
 * dispensers and lamps can be dragged between their spots.
 *
 * The bench retraces only when a piece or lamp moves, or when the light coming in changes.
 */
import { ACTIVE_MS, GLOW_MS, SNAP, TAP_MS, TAP_SLOP } from "./config";
import { type BenchLayout, inBox } from "./layout";
import { type PieceKind, STEP, normDetent } from "./pieces";
import {
  type Item,
  type Lamp,
  type Place,
  type Puzzle,
  sceneOf,
  sourcesOf,
  trayFor,
} from "./puzzle";
import type { ColourBand } from "./spectrum";
import { type Glow, type Source, type TraceResult, glowOf, trace } from "./trace";

export interface BenchItem extends Item {
  /** The tray it goes back to. */
  tray: number;
}

export type Grab =
  | { kind: "press"; item: number; x0: number; y0: number; t0: number; synthetic: boolean }
  | {
      kind: "drag";
      item: number;
      /** Where the piece is drawn while it is carried. */
      x: number;
      y: number;
      ox: number;
      oy: number;
      from: Place;
      hover: number | null;
      synthetic: boolean;
      /** Taken from a free-play dispenser: it disappears unless dropped into a socket. */
      fresh: boolean;
    }
  | {
      kind: "turn";
      item: number;
      last: number;
      sum: number;
      turn0: number;
      synthetic: boolean;
    }
  | { kind: "lamp"; lamp: number; x: number; y: number; hover: number | null; synthetic: boolean };

export interface Dispenser {
  tray: number;
  slot: number;
  kind: PieceKind;
  band?: ColourBand;
}

export interface Bench {
  readonly layout: BenchLayout;
  readonly puzzle: Puzzle;
  readonly items: readonly BenchItem[];
  readonly grabs: ReadonlyMap<number, Grab>;
  readonly result: TraceResult;
  readonly glows: readonly Glow[];
  /** Displayed brightness of each crystal, easing towards its glow. */
  readonly shown: readonly number[];
  readonly dispensers: readonly Dispenser[];
  /** Counts up when the light changes, and when the fixed parts (lamps) move. */
  readonly traceVersion: number;
  readonly fixedVersion: number;
  /** Every crystal glows; and every crystal glows from real light. */
  readonly solved: boolean;
  readonly realSolved: boolean;
  readonly lit: number;
  /** The piece whose ring is bright, while it is. */
  active(now: number): number | null;
  /** Where an item is drawn: its socket, its tray slot, or under the finger carrying it. */
  where(i: number): { x: number; y: number; carried: boolean } | null;
  load(p: Puzzle, places?: readonly Place[]): void;
  /** Light coming in from outside (a bank's neighbours, or a guide). */
  setExtra(sources: readonly Source[]): void;
  down(id: number, x: number, y: number, synthetic: boolean): boolean;
  move(id: number, x: number, y: number): void;
  up(id: number, x: number, y: number): void;
  cancel(id: number): void;
  release(): void;
  /** Put every piece in its solution place. */
  solve(): void;
  /** Back to the puzzle's starting places. */
  restart(): void;
  placedOn(half: number): number;
  tick(dt: number): boolean;
  /** Current places of the puzzle's pieces (puzzle mode). */
  places(): Place[];
  /** What a touch at this point would take hold of. */
  target(x: number, y: number): { kind: "piece" | "ring"; item: number } | null;
}

export interface BenchOptions {
  layout: BenchLayout;
  sandbox: boolean;
  colour: boolean;
  now: () => number;
}

const emptyResult = (): TraceResult => ({
  segs: [],
  real: [],
  guide: [],
  hits: [],
  exits: [],
  truncated: false,
});

/** Free play's dispensers: children's pieces in the low tray, adults' in the high one. */
export const dispensersFor = (layout: BenchLayout, colour: boolean): Dispenser[] => {
  const out: Dispenser[] = [];
  const child: { kind: PieceKind; band?: ColourBand }[] = colour
    ? [
        { kind: "mirror" },
        { kind: "filter", band: "r" },
        { kind: "filter", band: "g" },
        { kind: "filter", band: "b" },
      ]
    : [{ kind: "mirror" }, { kind: "mirror" }];
  const adult: { kind: PieceKind }[] = colour
    ? [{ kind: "prism" }, { kind: "convex" }, { kind: "concave" }, { kind: "splitter" }]
    : [{ kind: "convex" }, { kind: "concave" }, { kind: "splitter" }];
  layout.trays.forEach((t, ti) => {
    const list = t.child ? child : adult;
    // A pair's second half starts where the first left off, so between them they hold every kind.
    const skip = t.half * t.slots.length;
    t.slots.forEach((_, si) => {
      if (si >= list.length) return;
      const d = list[(skip + si) % list.length];
      if (d) out.push({ tray: ti, slot: si, ...d });
    });
  });
  return out;
};

export const createBench = (o: BenchOptions): Bench => {
  const L = o.layout;
  const R = L.sizes.piece;
  const ringOuter = L.sizes.ring + L.sizes.knob * 0.55;
  const spacing = (() => {
    let best = Infinity;
    for (let i = 0; i < L.sockets.length; i++) {
      for (let j = i + 1; j < L.sockets.length; j++) {
        const a = L.sockets[i]!;
        const b = L.sockets[j]!;
        best = Math.min(best, Math.hypot(a.x - b.x, a.y - b.y));
      }
    }
    return Number.isFinite(best) ? best : 3 * R;
  })();
  const snap = spacing * SNAP;

  let puzzle: Puzzle = {
    level: "m1",
    lamps: [],
    crystals: [],
    fixed: [],
    pieces: [],
    solution: [],
    start: [],
    entry: [],
    exits: [],
    sky: [],
    fallback: true,
  };
  let items: BenchItem[] = [];
  const grabs = new Map<number, Grab>();
  let extra: readonly Source[] = [];
  let result: TraceResult = emptyResult();
  let glows: Glow[] = [];
  let shown: number[] = [];
  let traceVersion = 0;
  let fixedVersion = 0;
  let active: { item: number; at: number } | null = null;
  const dispensers = o.sandbox ? dispensersFor(L, o.colour) : [];

  const touch = (item: number) => {
    active = { item, at: o.now() };
  };

  const retrace = () => {
    result = trace(sceneOf(L, puzzle, items), sourcesOf(L, puzzle, extra));
    glows = puzzle.crystals.map((c, i) => glowOf(c, result.real[i] ?? 0, result.guide[i] ?? 0));
    if (shown.length !== glows.length) shown = glows.map(() => 0);
    traceVersion++;
  };

  const halfOf = (socket: number) => L.sockets[socket]?.half ?? 0;
  const placedOn = (half: number) =>
    items.reduce(
      (n, it) => n + (it.place.socket !== null && halfOf(it.place.socket) === half ? 1 : 0),
      0,
    );
  const occupied = (socket: number) => items.some((it) => it.place.socket === socket);
  const carried = (i: number) => {
    for (const g of grabs.values()) if (g.kind === "drag" && g.item === i) return g;
    return null;
  };
  const held = (i: number) => {
    for (const g of grabs.values()) if ("item" in g && g.item === i) return true;
    return false;
  };

  /** Slot positions of the items resting in each tray, in id order. */
  const traySlot = (i: number): { x: number; y: number } | null => {
    const it = items[i];
    if (!it || it.place.socket !== null || carried(i)) return null;
    const tray = L.trays[it.tray];
    if (!tray) return null;
    let k = 0;
    for (let j = 0; j < i; j++) {
      const o2 = items[j]!;
      if (o2.tray === it.tray && o2.place.socket === null && !carried(j)) k++;
    }
    const slot = tray.slots[Math.min(k, tray.slots.length - 1)];
    return slot ?? null;
  };

  const where = (i: number) => {
    const it = items[i];
    if (!it) return null;
    const g = carried(i);
    if (g) return { x: g.x, y: g.y, carried: true };
    if (it.place.socket !== null) {
      const s = L.sockets[it.place.socket];
      return s ? { x: s.x, y: s.y, carried: false } : null;
    }
    const slot = traySlot(i);
    return slot ? { x: slot.x, y: slot.y, carried: false } : null;
  };

  const hoverFor = (
    i: number | null,
    x: number,
    y: number,
    fromHalf: number | null,
  ): number | null => {
    let best: number | null = null;
    let bestD = snap;
    L.sockets.forEach((s, k) => {
      if (occupied(k)) return;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d >= bestD) return;
      // A piece moving within its own half doesn't change that half's count.
      if (fromHalf !== s.half && placedOn(s.half) >= L.limit) return;
      best = k;
      bestD = d;
    });
    void i;
    return best;
  };

  const overTray = (x: number, y: number) =>
    L.trays.some((t) => inBox(t.box, x, y, R * 0.4)) || !inBox(L.box, x, y, -R * 0.3);

  const load = (p: Puzzle, places?: readonly Place[]) => {
    grabs.clear();
    active = null;
    puzzle = { ...p, lamps: p.lamps.map((l) => ({ ...l })) };
    const at = places ?? p.start;
    items = p.pieces.map((d, i) => {
      const sol = p.solution[i];
      const half = sol?.socket !== null && sol?.socket !== undefined ? halfOf(sol.socket) : 0;
      return {
        kind: d.kind,
        band: d.band,
        place: { ...(at[i] ?? { socket: null, turn: 0 }) },
        tray: trayFor(L, d.kind, half),
      };
    });
    shown = p.crystals.map(() => 0);
    fixedVersion++;
    retrace();
  };

  const hitItem = (x: number, y: number): number | null => {
    let best: number | null = null;
    let bestD = Infinity;
    items.forEach((it, i) => {
      if (held(i)) return;
      const w = where(i);
      if (!w) return;
      const d = Math.hypot(w.x - x, w.y - y);
      const reach = it.place.socket !== null ? R : R * 0.95;
      if (d <= reach && d < bestD) {
        best = i;
        bestD = d;
      }
    });
    return best;
  };

  const hitRing = (x: number, y: number): number | null => {
    const act = active && o.now() - active.at < ACTIVE_MS ? active.item : null;
    let best: number | null = null;
    let bestD = Infinity;
    items.forEach((it, i) => {
      if (it.place.socket === null || held(i)) return;
      const s = L.sockets[it.place.socket]!;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d <= R || d > ringOuter) return;
      const score = i === act ? d - ringOuter : d;
      if (score < bestD) {
        best = i;
        bestD = score;
      }
    });
    return best;
  };

  const down = (id: number, x: number, y: number, synthetic: boolean): boolean => {
    if (grabs.has(id)) return false;
    const it = hitItem(x, y);
    if (it !== null) {
      touch(it);
      const item = items[it]!;
      if (item.place.socket === null) {
        const w = where(it)!;
        grabs.set(id, {
          kind: "drag",
          item: it,
          x: w.x,
          y: w.y,
          ox: w.x - x,
          oy: w.y - y,
          from: { ...item.place },
          hover: null,
          synthetic,
          fresh: false,
        });
      } else {
        grabs.set(id, { kind: "press", item: it, x0: x, y0: y, t0: o.now(), synthetic });
      }
      return true;
    }
    const ring = hitRing(x, y);
    if (ring !== null) {
      const s = L.sockets[items[ring]!.place.socket!]!;
      touch(ring);
      grabs.set(id, {
        kind: "turn",
        item: ring,
        last: Math.atan2(y - s.y, x - s.x),
        sum: 0,
        turn0: items[ring]!.place.turn,
        synthetic,
      });
      return true;
    }
    if (o.sandbox) {
      for (const d of dispensers) {
        const slot = L.trays[d.tray]?.slots[d.slot];
        if (!slot || Math.hypot(slot.x - x, slot.y - y) > R * 0.95) continue;
        if (items.length >= L.limit * L.halves + 2) return true;
        items.push({ kind: d.kind, band: d.band, place: { socket: null, turn: 0 }, tray: d.tray });
        const i = items.length - 1;
        touch(i);
        grabs.set(id, {
          kind: "drag",
          item: i,
          x: slot.x,
          y: slot.y,
          ox: slot.x - x,
          oy: slot.y - y,
          from: { socket: null, turn: 0 },
          hover: null,
          synthetic,
          fresh: true,
        });
        return true;
      }
      const lamp = puzzle.lamps.findIndex((l) => Math.hypot(l.x - x, l.y - y) < L.sizes.lamp * 0.9);
      if (lamp >= 0) {
        grabs.set(id, { kind: "lamp", lamp, x, y, hover: null, synthetic });
        return true;
      }
    }
    return false;
  };

  const lift = (id: number, g: Extract<Grab, { kind: "press" }>, x: number, y: number) => {
    const item = items[g.item]!;
    const s = L.sockets[item.place.socket!]!;
    const from = { ...item.place };
    item.place = { socket: null, turn: item.place.turn };
    grabs.set(id, {
      kind: "drag",
      item: g.item,
      x: s.x + (x - g.x0),
      y: s.y + (y - g.y0),
      ox: s.x - g.x0,
      oy: s.y - g.y0,
      from,
      hover: null,
      synthetic: g.synthetic,
      fresh: false,
    });
    retrace();
  };

  const move = (id: number, x: number, y: number) => {
    const g = grabs.get(id);
    if (!g) return;
    switch (g.kind) {
      case "press":
        if (Math.hypot(x - g.x0, y - g.y0) > TAP_SLOP) {
          lift(id, g, x, y);
          move(id, x, y);
        }
        break;
      case "drag": {
        g.x = x + g.ox;
        g.y = y + g.oy;
        const fromHalf = g.from.socket !== null ? halfOf(g.from.socket) : null;
        g.hover = hoverFor(g.item, g.x, g.y, fromHalf);
        touch(g.item);
        break;
      }
      case "turn": {
        const item = items[g.item]!;
        if (item.place.socket === null) break;
        const s = L.sockets[item.place.socket]!;
        if (Math.hypot(x - s.x, y - s.y) < R * 0.25) break;
        const a = Math.atan2(y - s.y, x - s.x);
        let da = a - g.last;
        da -= Math.round(da / (Math.PI * 2)) * Math.PI * 2;
        g.sum += da;
        g.last = a;
        const turn = normDetent(g.turn0 + Math.round(g.sum / STEP));
        touch(g.item);
        if (turn !== item.place.turn) {
          item.place = { ...item.place, turn };
          retrace();
        }
        break;
      }
      case "lamp": {
        g.x = x;
        g.y = y;
        let best: number | null = null;
        let bestD = L.sizes.lamp * 2.5;
        L.lampSpots.forEach((s, k) => {
          if (puzzle.lamps.some((l, li) => li !== g.lamp && l.spot === k)) return;
          const d = Math.hypot(s.x - x, s.y - y);
          if (d < bestD) {
            best = k;
            bestD = d;
          }
        });
        g.hover = best;
        break;
      }
    }
  };

  const drop = (g: Extract<Grab, { kind: "drag" }>) => {
    const item = items[g.item]!;
    if (g.hover !== null && !occupied(g.hover)) {
      item.place = { socket: g.hover, turn: item.place.turn };
    } else if (g.fresh || (o.sandbox && overTray(g.x, g.y))) {
      items.splice(g.item, 1);
      remapAfterRemove(g.item);
      active = null;
      return;
    } else if (overTray(g.x, g.y)) {
      item.place = { socket: null, turn: item.place.turn };
    } else {
      const back = g.from.socket !== null && !occupied(g.from.socket) ? g.from.socket : null;
      item.place = { socket: back, turn: item.place.turn };
    }
    touch(g.item);
  };

  const remapAfterRemove = (removed: number) => {
    for (const [id, g] of grabs) {
      if (!("item" in g)) continue;
      if (g.item === removed) grabs.delete(id);
      else if (g.item > removed) g.item--;
    }
  };

  const up = (id: number, x: number, y: number) => {
    const g = grabs.get(id);
    if (!g) return;
    if (g.kind === "drag" || g.kind === "lamp") move(id, x, y);
    grabs.delete(id);
    switch (g.kind) {
      case "press": {
        if (o.now() - g.t0 <= TAP_MS) {
          const item = items[g.item]!;
          item.place = { ...item.place, turn: normDetent(item.place.turn + 1) };
          touch(g.item);
          retrace();
        }
        break;
      }
      case "drag":
        drop(g);
        retrace();
        break;
      case "lamp": {
        if (g.hover !== null) {
          const spot = L.lampSpots[g.hover]!;
          const l = puzzle.lamps[g.lamp]!;
          puzzle.lamps[g.lamp] = {
            ...l,
            x: spot.x,
            y: spot.y,
            angle: spot.side === "l" ? 0 : Math.PI,
            spot: g.hover,
          } satisfies Lamp;
          fixedVersion++;
          retrace();
        }
        break;
      }
      default:
        break;
    }
  };

  const cancel = (id: number) => {
    const g = grabs.get(id);
    if (!g) return;
    grabs.delete(id);
    if (g.kind === "drag") {
      const item = items[g.item]!;
      if (g.fresh) {
        items.splice(g.item, 1);
        remapAfterRemove(g.item);
      } else {
        const back = g.from.socket !== null && !occupied(g.from.socket) ? g.from.socket : null;
        item.place = { socket: back, turn: item.place.turn };
      }
      retrace();
    }
  };

  const release = () => {
    for (const id of Array.from(grabs.keys())) cancel(id);
  };

  const bench: Bench = {
    layout: L,
    get puzzle() {
      return puzzle;
    },
    get items() {
      return items;
    },
    grabs,
    get result() {
      return result;
    },
    get glows() {
      return glows;
    },
    get shown() {
      return shown;
    },
    dispensers,
    get traceVersion() {
      return traceVersion;
    },
    get fixedVersion() {
      return fixedVersion;
    },
    // A puzzle generation couldn't fill (no crystals) never holds a bank up.
    get solved() {
      return o.sandbox ? glows.length > 0 && glows.every((g) => g > 0) : glows.every((g) => g > 0);
    },
    get realSolved() {
      return o.sandbox
        ? glows.length > 0 && glows.every((g) => g === 2)
        : glows.every((g) => g === 2);
    },
    get lit() {
      return glows.reduce<number>((n, g) => n + (g > 0 ? 1 : 0), 0);
    },
    active(now) {
      return active && now - active.at < ACTIVE_MS && items[active.item] ? active.item : null;
    },
    where,
    load,
    setExtra(sources) {
      extra = sources;
      retrace();
    },
    down,
    move,
    up,
    cancel,
    release,
    solve() {
      release();
      items.forEach((it, i) => {
        const s = puzzle.solution[i];
        if (s) it.place = { ...s };
      });
      retrace();
    },
    restart() {
      release();
      if (o.sandbox) items = [];
      else
        items.forEach(
          (it, i) => (it.place = { ...(puzzle.start[i] ?? { socket: null, turn: 0 }) }),
        );
      retrace();
    },
    placedOn,
    tick(dt) {
      let moving = false;
      const step = (dt * 1000) / GLOW_MS;
      for (let i = 0; i < shown.length; i++) {
        const target = glows[i] === 2 ? 1 : glows[i] === 1 ? 0.42 : 0;
        const cur = shown[i]!;
        if (cur === target) continue;
        moving = true;
        shown[i] = cur < target ? Math.min(target, cur + step) : Math.max(target, cur - step);
      }
      return moving;
    },
    places: () => items.map((it) => ({ ...it.place })),
    target(x, y) {
      const it = hitItem(x, y);
      if (it !== null) return { kind: "piece", item: it };
      const ring = hitRing(x, y);
      return ring !== null ? { kind: "ring", item: ring } : null;
    },
  };
  return bench;
};
