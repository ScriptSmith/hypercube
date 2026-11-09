/**
 * Bots and the attract ghost, working a bench through injected touches like a visitor would:
 * taps on switches, holds on buttons, drags from port to port, pieces dragged out of the tray
 * and back. The attract ghost mostly flips switches and presses buttons and now and then moves
 * a wire to another gate; bots also add and remove pieces and wires and swap gates. In the
 * `goals` variant both work towards the card's known solution and then try its rows.
 */
import { type BotHand, createBotHand } from "../../core/input";
import type { Input, Rng } from "../../core/types";
import type { Bench } from "./bench";
import {
  addError,
  driver,
  fanout,
  KINDS,
  LIMITS,
  type Piece,
  pieceById,
  type PieceKind,
  pieceCount,
  wireError,
} from "./circuit";
import { pieceSize, pointOn, portOf, route, socketPoint } from "./geometry";
import { nextStep, type Recipe } from "./goals";
import type { Point } from "./layout";

export type BotMode = "attract" | "bot";

export interface BenchBot {
  /** `dt` in seconds; `active` says whether it may start a new action now. */
  update(dt: number, active: boolean): void;
  /** Lift every finger and forget queued actions. */
  release(): void;
  dispose(): void;
  readonly mode: BotMode;
}

export interface BotOptions {
  input: Pick<Input, "inject">;
  rng: Rng;
  mode: BotMode;
  bench(): Bench;
  /** Stage px per venue px. */
  unit(): number;
  gates: readonly PieceKind[];
  /** The goal card's solution for this gate set, or null in free building. */
  recipe(): Recipe | null;
}

type Action = () => Promise<void> | null;

const REST: Record<BotMode, readonly [number, number]> = {
  attract: [1.4, 3.2],
  bot: [0.7, 2.2],
};

export const createBenchBot = (o: BotOptions): BenchBot => {
  const hand: BotHand = createBotHand(o.input);
  const { rng } = o;
  let rest = 1 + rng.next() * 1.5;
  let busy = false;
  let generation = 0;
  const queue: Action[] = [];

  const stage = (p: Point) => ({ x: p.x * o.unit(), y: p.y * o.unit() });

  // ---- Where things are -----------------------------------------------------------------------

  /** A point on a piece's body away from its ports: low on child pieces, the middle of gates. */
  const grip = (p: Piece): Point => {
    const b = o.bench();
    const c = socketPoint(b.layout, p.socket);
    const s = pieceSize(b.layout, p.kind);
    return KINDS[p.kind].band === "child" ? { x: c.x, y: c.y + s.h * 0.22 } : c;
  };

  const port = (id: number, pin: number): Point | null => {
    const b = o.bench();
    const p = pieceById(b.circuit, id);
    const q = p ? portOf(b.layout, p, pin) : undefined;
    return q ? { x: q.x, y: q.y } : null;
  };

  const trayItem = (kind: PieceKind): Point | null => {
    for (const t of o.bench().layout.trays) {
      const it = t.items.find((i) => i.kind === kind);
      if (it) return { x: it.x, y: it.y };
    }
    return null;
  };

  const trayFor = (kind: PieceKind): Point | null => {
    const band = KINDS[kind].band;
    const t = o.bench().layout.trays.find((x) => x.band === band) ?? o.bench().layout.trays[0];
    return t ? { x: t.box.x + t.box.width / 2, y: t.box.y + t.box.height / 2 } : null;
  };

  const freeSockets = (kind: PieceKind): number[] => {
    const b = o.bench();
    const out: number[] = [];
    b.layout.sockets.forEach((s, i) => {
      if (s.band === KINDS[kind].band && !b.circuit.pieces.some((p) => p.socket === i)) out.push(i);
    });
    return out;
  };

  // ---- Gestures ------------------------------------------------------------------------------

  /** A drag whose path bows a little, as a hand's would; the wire's shape ignores it. */
  const drag = (a: Point, b: Point, ms: number) => {
    const s = stage(a);
    const e = stage(b);
    const bow = (rng.next() - 0.5) * 0.3;
    const mid = {
      x: (s.x + e.x) / 2 - (e.y - s.y) * bow,
      y: (s.y + e.y) / 2 + (e.x - s.x) * bow,
    };
    return hand.drag([s, mid, e], ms);
  };

  const dragMs = (a: Point, b: Point) => {
    const d = Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, o.bench().layout.child);
    return Math.round(Math.min(1800, 450 + d * 260));
  };

  const tap = (p: Piece) => {
    const at = stage(grip(p));
    return hand.tap(at.x, at.y, 110);
  };

  const press = (p: Piece, ms: number) => {
    const at = stage(grip(p));
    return hand.hold(at.x, at.y, ms);
  };

  const wireUp = (from: number, to: number, pin: number) => {
    const a = port(from, -1);
    const b = port(to, pin);
    return a && b ? drag(a, b, dragMs(a, b)) : null;
  };

  const unplug = (wireId: number, to: Point | null) => {
    const b = o.bench();
    const w = b.circuit.wires.find((x) => x.id === wireId);
    if (!w) return null;
    const a = port(w.to, w.pin);
    if (!a) return null;
    const away = to ?? { x: a.x + b.layout.snap * 2.2, y: a.y + b.layout.snap * 0.6 };
    return drag(a, away, dragMs(a, away));
  };

  const addAt = (kind: PieceKind, socket: number) => {
    const a = trayItem(kind);
    const s = o.bench().layout.sockets[socket];
    if (!a || !s) return null;
    return drag(a, s, dragMs(a, s));
  };

  const removePiece = (p: Piece) => {
    const a = grip(p);
    const t = trayFor(p.kind);
    return t ? drag(a, t, dragMs(a, t)) : null;
  };

  const cut = (wireId: number) => {
    const b = o.bench();
    const w = b.circuit.wires.find((x) => x.id === wireId);
    if (!w) return null;
    const a = pieceById(b.circuit, w.from);
    const z = pieceById(b.circuit, w.to);
    const pa = a ? portOf(b.layout, a, -1) : undefined;
    const pz = z ? portOf(b.layout, z, w.pin) : undefined;
    if (!pa || !pz) return null;
    const m = stage(pointOn(route(pa, pz, b.layout.child * 0.35), 0.5));
    return hand.tap(m.x, m.y, 110);
  };

  // ---- Choices ---------------------------------------------------------------------------------

  const pick = <T>(items: readonly T[]): T | null =>
    items.length ? (items[rng.int(items.length)] ?? null) : null;

  const sources = () => o.bench().circuit.pieces.filter((p) => KINDS[p.kind].group === "source");

  /** A random new wire that's allowed, preferring ones that make sense. */
  const someWire = (): [number, number, number] | null => {
    const c = o.bench().circuit;
    const outs = c.pieces.filter((p) => KINDS[p.kind].output && fanout(c, p.id) < LIMITS.fanout);
    const ins: [Piece, number][] = [];
    for (const p of c.pieces) {
      for (let pin = 0; pin < KINDS[p.kind].inputs; pin++) {
        if (!driver(c, p.id, pin)) ins.push([p, pin]);
      }
    }
    for (let tries = 0; tries < 12; tries++) {
      const a = pick(outs);
      const z = pick(ins);
      if (!a || !z) return null;
      if (a.id === z[0].id && rng.next() > 0.08) continue;
      if (wireError(c, a.id, z[0].id, z[1]) === null) return [a.id, z[0].id, z[1]];
    }
    return null;
  };

  /** Move an existing wire's input end to a free input on a gate. */
  const someReplug = (): Action | null => {
    const c = o.bench().circuit;
    const w = pick(c.wires);
    if (!w) return null;
    const targets: Point[] = [];
    for (const p of c.pieces) {
      if (KINDS[p.kind].group !== "gate" && p.kind !== "post") continue;
      for (let pin = 0; pin < KINDS[p.kind].inputs; pin++) {
        if (driver(c, p.id, pin)) continue;
        const q = port(p.id, pin);
        if (q) targets.push(q);
      }
    }
    const to = pick(targets);
    return to ? () => unplug(w.id, to) : null;
  };

  const freeAction = (attract: boolean): Action | null => {
    const b = o.bench();
    const c = b.circuit;
    const srcs = sources();
    const switches = srcs.filter((p) => p.kind === "switch");
    const buttons = srcs.filter((p) => p.kind === "button");
    const pieces = pieceCount(c);
    const gates = c.pieces.filter((p) => KINDS[p.kind].group === "gate");
    const options: [number, () => Action | null][] = [
      [
        switches.length ? (attract ? 5 : 3) : 0,
        () => {
          const p = pick(switches);
          return p ? () => tap(p) : null;
        },
      ],
      [
        buttons.length ? (attract ? 2.5 : 1.5) : 0,
        () => {
          const p = pick(buttons);
          return p ? () => press(p, Math.round(rng.range(700, 1800))) : null;
        },
      ],
      [c.wires.length ? (attract ? 0.7 : 0.8) : 0, someReplug],
      [
        (attract ? 0.4 : 2) * (c.wires.length < 4 ? 2 : 1),
        () => {
          const w = someWire();
          return w ? () => wireUp(w[0], w[1], w[2]) : null;
        },
      ],
    ];
    if (!attract) {
      // Keep something to press and something to light, so the bench stays lively.
      const sinks = c.pieces.filter((p) => KINDS[p.kind].group === "sink").length;
      const wantSource = srcs.length < 2;
      const pool: PieceKind[] = wantSource
        ? ["switch", "switch", "button"]
        : ["switch", "button", "lamp", "fan", "bell", ...o.gates];
      const addable = pool.filter((k) => !addError(c, k) && freeSockets(k).length > 0);
      const removable = c.pieces.filter((p) => {
        if (p.kind === "post" || p.pinned) return false;
        const group = KINDS[p.kind].group;
        if (group === "source") return srcs.length > 2;
        if (group === "sink") return sinks > 1;
        return true;
      });
      options.push(
        [
          c.wires.length > 3 ? 0.4 : 0,
          () => {
            const w = pick(c.wires);
            return w ? () => unplug(w.id, null) : null;
          },
        ],
        [
          c.wires.length > 3 ? 0.3 : 0,
          () => {
            const w = pick(c.wires);
            return w ? () => cut(w.id) : null;
          },
        ],
        [
          addable.length ? (wantSource ? 6 : pieces < 7 ? 2.4 : 1.2) : 0,
          () => {
            const k = pick(addable);
            const s = k ? pick(freeSockets(k)) : null;
            return k && s !== null ? () => addAt(k, s) : null;
          },
        ],
        [
          removable.length && pieces > 5 ? (pieces > 11 ? 1.5 : 0.5) : 0,
          () => {
            const p = pick(removable);
            return p ? () => removePiece(p) : null;
          },
        ],
        [
          gates.length ? 0.6 : 0,
          () => {
            // Swap a gate for another kind in the same socket.
            const g = pick(gates.filter((p) => !p.pinned));
            const kinds = o.gates.filter((k) => k !== g?.kind);
            const k = pick(kinds);
            if (!g || !k) return null;
            const socket = g.socket;
            queue.push(() => (pieceById(o.bench().circuit, g.id) ? null : addAt(k, socket)));
            return () => removePiece(g);
          },
        ],
        [
          removable.length ? 0.3 : 0,
          () => {
            const p = pick(removable);
            const s = p ? pick(freeSockets(p.kind)) : null;
            const to = s !== null ? o.bench().layout.sockets[s] : undefined;
            return p && to ? () => drag(grip(p), to, dragMs(grip(p), to)) : null;
          },
        ],
      );
    }
    const total = options.reduce((t, [w]) => t + w, 0);
    if (total <= 0) return null;
    let r = rng.next() * total;
    for (const [w, make] of options) {
      r -= w;
      if (r <= 0 && w > 0) return make();
    }
    return null;
  };

  const goalAction = (recipe: Recipe): Action | null => {
    const b = o.bench();
    const c = b.circuit;
    if (b.doneAt === Number.NEGATIVE_INFINITY) {
      const s = nextStep(c, recipe, {
        inputs: b.inputs,
        posts: c.pieces
          .filter((p) => p.kind === "post")
          .sort((x, y) => x.socket - y.socket)
          .map((p) => p.id),
        gateSockets: b.layout.gateSockets,
      });
      if (s) {
        switch (s.kind) {
          case "add":
            return () => addAt(s.gate, s.socket);
          case "remove": {
            const p = pieceById(c, s.piece);
            return p ? () => removePiece(p) : null;
          }
          case "wire":
            return () => wireUp(s.from, s.to, s.pin);
          case "unwire":
            return () => unplug(s.wire, null);
        }
      }
    }
    // Built: try the rows by working the card's inputs.
    const p = pick(b.inputs.map((id) => pieceById(c, id)).filter((x): x is Piece => !!x));
    if (!p) return null;
    return p.kind === "button" ? () => press(p, Math.round(rng.range(1200, 2400))) : () => tap(p);
  };

  const act = () => {
    const recipe = o.recipe();
    const next = queue.shift() ?? (recipe ? goalAction(recipe) : freeAction(o.mode === "attract"));
    const run = next?.() ?? null;
    if (!run) return;
    busy = true;
    const gen = generation;
    void run.then(() => {
      if (gen === generation) busy = false;
    });
  };

  return {
    mode: o.mode,
    update(dt, active) {
      if (busy || !active) return;
      rest -= dt;
      if (rest > 0) return;
      const [lo, hi] = REST[o.mode];
      rest = rng.range(lo, hi);
      act();
    },
    release() {
      generation++;
      busy = false;
      queue.length = 0;
      hand.release();
    },
    dispose() {
      generation++;
      queue.length = 0;
      hand.dispose();
    },
  };
};
