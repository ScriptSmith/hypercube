/**
 * One workbench: its circuit, the fingers working on it and, in the `goals` variant, its card.
 * Touches arrive in venue px. A press on a piece's port drags a wire, on a tray item drags a new
 * piece out, on a piece moves it (or flips a switch, or holds a button), and on a wire's middle
 * cuts it. A wire end snaps to the nearest suitable port within `snap` when the finger lifts and
 * springs back otherwise. Nothing here touches the DOM.
 */
import {
  addError,
  addPiece,
  type Circuit,
  clearCircuit,
  connect,
  createCircuit,
  disconnect,
  driver,
  fanout,
  KINDS,
  LIMITS,
  type Piece,
  pieceById,
  type PieceKind,
  postsOf,
  powered,
  removePiece,
  replug,
  setOn,
  socketError,
  step,
  TICK_MS,
  wireById,
  wireError,
  movePiece,
} from "./circuit";
import { CHECK_MS, TRICK_MS, type Variant } from "./config";
import { CARDS, checkCard, type GoalCard, placeCardInputs, rowsOf } from "./goals";
import {
  allPorts,
  bodyBox,
  nearestPort,
  type Port,
  pieceSize,
  pointOn,
  portOf,
  route,
  socketPoint,
} from "./geometry";
import { type BenchLayout, inBox, type Point } from "./layout";

export interface PortRef {
  piece: number;
  pin: number;
}

export type Gesture =
  | {
      t: "body";
      piece: number;
      x0: number;
      y0: number;
      x: number;
      y: number;
      /** Started inside the piece's own output port, so a drag pulls a wire instead. */
      port: boolean;
      pressed: boolean;
    }
  | {
      t: "move";
      piece: number;
      /** Offset from the finger to the piece's centre. */
      gx: number;
      gy: number;
      x: number;
      y: number;
      target: number | null;
      toTray: boolean;
    }
  | { t: "new"; kind: PieceKind; x: number; y: number; target: number | null }
  | { t: "wire"; from: PortRef; x: number; y: number; target: PortRef | null }
  | { t: "replug"; wire: number; x: number; y: number; target: PortRef | null }
  | { t: "cut"; wire: number; x0: number; y0: number }
  | { t: "none" };

export type FxKind = "shake" | "plug" | "spring" | "poof" | "place" | "flip";

export interface Fx {
  kind: FxKind;
  x: number;
  y: number;
  /** Where a springing wire end goes back to. */
  x2: number;
  y2: number;
  at: number;
}

export const MAX_FX = 24;
/** Fingers whose lift never arrived are dropped after this long. */
const STALE_GESTURE_MS = 30_000;

export interface BenchOptions {
  layout: BenchLayout;
  variant: Variant;
  /** Gate kinds in the tray. */
  gates: readonly PieceKind[];
  now(): number;
}

export interface Bench {
  readonly layout: BenchLayout;
  readonly circuit: Circuit;
  readonly gestures: ReadonlyMap<number, Gesture>;
  readonly fx: readonly Fx[];
  readonly variant: Variant;
  /** The card in play (goals), its pinned inputs, and which rows pass. */
  readonly card: GoalCard | null;
  readonly cardIndex: number;
  readonly inputs: readonly number[];
  readonly rows: readonly boolean[];
  /** When the current card was completed, or -Infinity. */
  readonly doneAt: number;
  /** Cards completed with a person's help (bots and the ghost don't count). */
  readonly completed: number;
  /** Cards completed by anyone. */
  readonly solved: number;
  /** Last time a person (not a bot) touched this bench. */
  readonly lastHuman: number;
  /** Post values, left to right, for the machine. */
  posts(): boolean[];
  /** Where a piece is drawn: its socket, or the finger carrying it. */
  placement(p: Piece): Point;
  /** Ports with carried pieces where their fingers are. */
  ports(): Port[];
  /** The tray item under a point, if any. */
  trayItemAt(x: number, y: number): PieceKind | null;
  down(id: number, x: number, y: number, human: boolean): void;
  move(id: number, x: number, y: number): void;
  up(id: number, x: number, y: number): void;
  cancel(id: number): void;
  /** Advance the simulation and the goal checker by `ms`. */
  update(ms: number): void;
  setLayout(l: BenchLayout): void;
  /** Back to the start: the starting circuit, or the first card. */
  reset(): void;
  starter(): void;
  clear(): void;
  /** Tests and debugging: jump to a card. */
  setCard(i: number): void;
}

const MAX_TICKS_PER_UPDATE = 5;

export const createBench = (o: BenchOptions): Bench => {
  let layout = o.layout;
  const bands = () => layout.sockets.map((s) => s.band);
  let circuit = createCircuit(bands());
  const gestures = new Map<number, Gesture>();
  const started = new Map<number, number>();
  const fx: Fx[] = [];
  let tickAcc = 0;
  let checkAcc = 0;
  let cardIndex = 0;
  let inputs: number[] = [];
  let rows: boolean[] = [];
  let doneAt = Number.NEGATIVE_INFINITY;
  let completed = 0;
  let solved = 0;
  /** A person touched the bench since this card came up. */
  let helped = false;
  let lastHuman = Number.NEGATIVE_INFINITY;
  const goals = o.variant === "goals";

  const effect = (kind: FxKind, x: number, y: number, x2 = x, y2 = y) => {
    fx.push({ kind, x, y, x2, y2, at: o.now() });
    while (fx.length > MAX_FX) fx.shift();
  };

  const slip = () => layout.child * 0.16;

  const card = (): GoalCard | null => (goals ? (CARDS[cardIndex] ?? null) : null);

  // ---- Starting states -----------------------------------------------------------------------

  const buildStarter = () => {
    const s = layout.starter;
    const a = addPiece(circuit, "switch", s.a);
    const b = addPiece(circuit, "switch", s.b);
    const lamp = addPiece(circuit, "lamp", s.lamp);
    const and = addPiece(circuit, "and", s.and);
    addPiece(circuit, "or", s.or);
    const post = postsOf(circuit)[0];
    if (a && b && and) {
      connect(circuit, a.id, and.id, 0);
      connect(circuit, b.id, and.id, 1);
      if (lamp) connect(circuit, and.id, lamp.id, 0);
      if (post) connect(circuit, and.id, post.id, 0);
      // One switch already on, so the first flip of the other lights the lamp.
      setOn(circuit, a.id, true);
    }
  };

  const buildCard = () => {
    const c = card();
    inputs = c ? placeCardInputs(circuit, c, layout.goalSockets) : [];
    rows = c ? rowsOf(c).map(() => false) : [];
    doneAt = Number.NEGATIVE_INFINITY;
    checkAcc = 0;
    helped = false;
  };

  const fresh = () => {
    circuit = createCircuit(bands());
    gestures.clear();
    started.clear();
    tickAcc = 0;
    if (goals) buildCard();
    else buildStarter();
  };

  fresh();

  // ---- Hit testing ---------------------------------------------------------------------------

  const placement = (p: Piece): Point => {
    for (const g of gestures.values()) {
      if (g.t === "move" && g.piece === p.id) return { x: g.x + g.gx, y: g.y + g.gy };
    }
    return socketPoint(layout, p.socket);
  };

  const ports = () => allPorts(layout, circuit, placement);

  /** A finger is carrying this piece to another socket. */
  const carried = (id: number) => {
    for (const g of gestures.values()) {
      if (g.t === "move" && g.piece === id) return true;
    }
    return false;
  };

  /** Another finger is still holding this button down. */
  const held = (id: number, except: Gesture) => {
    for (const g of gestures.values()) {
      if (g !== except && g.t === "body" && g.piece === id && g.pressed) return true;
    }
    return false;
  };

  const trayItemAt = (x: number, y: number): PieceKind | null => {
    for (const t of layout.trays) {
      for (const it of t.items) {
        const h = Math.max(it.size, 120) / 2;
        if (Math.abs(x - it.x) <= h && Math.abs(y - it.y) <= h) {
          if (KINDS[it.kind].group === "gate" && !o.gates.includes(it.kind)) continue;
          return it.kind;
        }
      }
    }
    return null;
  };

  const inTray = (x: number, y: number) => layout.trays.some((t) => inBox(t.box, x, y, 20));

  const pieceUnder = (x: number, y: number): Piece | null => {
    for (let i = circuit.pieces.length - 1; i >= 0; i--) {
      const p = circuit.pieces[i]!;
      if (p.kind === "post") continue;
      const c = socketPoint(layout, p.socket);
      if (inBox(bodyBox(layout, p.kind, c.x, c.y), x, y, 6)) return p;
    }
    return null;
  };

  /** The middle of a wire, where its cut handle is. */
  const wireMiddle = (wireId: number): Point | null => {
    const w = wireById(circuit, wireId);
    if (!w) return null;
    const a = pieceById(circuit, w.from);
    const b = pieceById(circuit, w.to);
    if (!a || !b) return null;
    const pa = portOf(layout, a, -1, placement(a));
    const pb = portOf(layout, b, w.pin, placement(b));
    if (!pa || !pb) return null;
    return pointOn(route(pa, pb, layout.child * 0.35), 0.5);
  };

  const cutAt = (x: number, y: number): number | null => {
    let best: number | null = null;
    let bestD = (layout.hit * 0.8) ** 2;
    for (const w of circuit.wires) {
      const m = wireMiddle(w.id);
      if (!m) continue;
      const d = (m.x - x) ** 2 + (m.y - y) ** 2;
      if (d <= bestD) {
        best = w.id;
        bestD = d;
      }
    }
    return best;
  };

  /** The nearest free socket of a piece's band to (x, y), within reach of a drop. */
  const socketNear = (kind: PieceKind, x: number, y: number, self = -1): number | null => {
    const s = pieceSize(layout, kind);
    const r = Math.max(s.w, s.h) * 0.75;
    let best: number | null = null;
    let bestD = r * r;
    layout.sockets.forEach((sock, i) => {
      if (socketError(circuit, kind, i, self)) return;
      const d = (sock.x - x) ** 2 + (sock.y - y) ** 2;
      if (d <= bestD) {
        best = i;
        bestD = d;
      }
    });
    return best;
  };

  // ---- Wire targets --------------------------------------------------------------------------

  const wireTarget = (from: PortRef, x: number, y: number): PortRef | null => {
    const forward = from.pin < 0;
    const hit = nearestPort(ports(), x, y, layout.snap, (p) =>
      forward
        ? p.pin >= 0 && wireError(circuit, from.piece, p.piece, p.pin) === null
        : p.pin < 0 && wireError(circuit, p.piece, from.piece, from.pin) === null,
    );
    return hit ? { piece: hit.piece, pin: hit.pin } : null;
  };

  const replugTarget = (wireId: number, x: number, y: number): PortRef | null => {
    const w = wireById(circuit, wireId);
    if (!w) return null;
    const hit = nearestPort(
      ports(),
      x,
      y,
      layout.snap,
      (p) =>
        p.pin >= 0 && ((p.piece === w.to && p.pin === w.pin) || !driver(circuit, p.piece, p.pin)),
    );
    return hit ? { piece: hit.piece, pin: hit.pin } : null;
  };

  const portPoint = (ref: PortRef): Point | null => {
    const p = pieceById(circuit, ref.piece);
    if (!p) return null;
    const port = portOf(layout, p, ref.pin, placement(p));
    return port ? { x: port.x, y: port.y } : null;
  };

  // ---- Gestures ------------------------------------------------------------------------------

  const startWire = (id: number, port: Port, x: number, y: number) => {
    const from = { piece: port.piece, pin: port.pin };
    if (port.pin < 0) {
      if (fanout(circuit, port.piece) >= LIMITS.fanout || circuit.wires.length >= LIMITS.wires) {
        effect("shake", port.x, port.y);
        gestures.set(id, { t: "none" });
        return;
      }
      gestures.set(id, { t: "wire", from, x, y, target: null });
      return;
    }
    const w = driver(circuit, port.piece, port.pin);
    if (w) {
      gestures.set(id, { t: "replug", wire: w.id, x, y, target: { piece: w.to, pin: w.pin } });
      return;
    }
    if (circuit.wires.length >= LIMITS.wires) {
      effect("shake", port.x, port.y);
      gestures.set(id, { t: "none" });
      return;
    }
    gestures.set(id, { t: "wire", from, x, y, target: null });
  };

  const down = (id: number, x: number, y: number, human: boolean) => {
    if (human) {
      lastHuman = o.now();
      helped = true;
    }
    started.set(id, o.now());
    const port = nearestPort(ports(), x, y, layout.hit);
    const under = pieceUnder(x, y);
    if (port) {
      const owner = pieceById(circuit, port.piece);
      // A press on a switch or button near its own port is still a press; a drag pulls a wire.
      if (
        owner &&
        under &&
        under.id === owner.id &&
        KINDS[owner.kind].group === "source" &&
        port.pin < 0 &&
        !carried(owner.id)
      ) {
        const pressed = owner.kind === "button";
        if (pressed) setOn(circuit, owner.id, true);
        gestures.set(id, { t: "body", piece: owner.id, x0: x, y0: y, x, y, port: true, pressed });
        return;
      }
      if (owner && !carried(owner.id)) {
        startWire(id, port, x, y);
        return;
      }
    }
    const tray = trayItemAt(x, y);
    if (tray) {
      if (addError(circuit, tray)) {
        effect("shake", x, y);
        gestures.set(id, { t: "none" });
      } else gestures.set(id, { t: "new", kind: tray, x, y, target: null });
      return;
    }
    if (under && !carried(under.id)) {
      const pressed = under.kind === "button";
      if (pressed) setOn(circuit, under.id, true);
      gestures.set(id, { t: "body", piece: under.id, x0: x, y0: y, x, y, port: false, pressed });
      return;
    }
    const cut = cutAt(x, y);
    if (cut !== null) {
      gestures.set(id, { t: "cut", wire: cut, x0: x, y0: y });
      return;
    }
    gestures.set(id, { t: "none" });
  };

  const release = (g: Gesture) => {
    if (g.t === "body" && g.pressed && !held(g.piece, g)) setOn(circuit, g.piece, false);
  };

  const move = (id: number, x: number, y: number) => {
    const g = gestures.get(id);
    if (!g) return;
    switch (g.t) {
      case "body": {
        g.x = x;
        g.y = y;
        const p = pieceById(circuit, g.piece);
        if (!p) {
          gestures.set(id, { t: "none" });
          return;
        }
        if (Math.hypot(x - g.x0, y - g.y0) <= slip()) return;
        if (g.port) {
          release(g);
          const port = portOf(layout, p, -1);
          if (port) startWire(id, port, x, y);
          const now = gestures.get(id);
          if (now?.t === "wire") now.target = wireTarget(now.from, x, y);
          return;
        }
        if (!p.pinned) {
          release(g);
          const c = socketPoint(layout, p.socket);
          gestures.set(id, {
            t: "move",
            piece: p.id,
            gx: c.x - g.x0,
            gy: c.y - g.y0,
            x,
            y,
            target: null,
            toTray: false,
          });
          move(id, x, y);
          return;
        }
        // A pinned button lets go when the finger slides off it.
        const c = socketPoint(layout, p.socket);
        if (g.pressed && !inBox(bodyBox(layout, p.kind, c.x, c.y), x, y, slip())) {
          release(g);
          g.pressed = false;
        }
        return;
      }
      case "move": {
        g.x = x;
        g.y = y;
        const p = pieceById(circuit, g.piece);
        if (!p) {
          gestures.set(id, { t: "none" });
          return;
        }
        g.toTray = inTray(x, y);
        g.target = g.toTray ? null : socketNear(p.kind, x + g.gx, y + g.gy, p.id);
        return;
      }
      case "new":
        g.x = x;
        g.y = y;
        g.target = socketNear(g.kind, x, y);
        return;
      case "wire":
        g.x = x;
        g.y = y;
        if (!pieceById(circuit, g.from.piece)) {
          gestures.set(id, { t: "none" });
          return;
        }
        g.target = wireTarget(g.from, x, y);
        return;
      case "replug":
        g.x = x;
        g.y = y;
        if (!wireById(circuit, g.wire)) {
          gestures.set(id, { t: "none" });
          return;
        }
        g.target = replugTarget(g.wire, x, y);
        return;
      case "cut":
        if (Math.hypot(x - g.x0, y - g.y0) > slip()) gestures.set(id, { t: "none" });
        return;
      case "none":
        return;
    }
  };

  const up = (id: number, x: number, y: number) => {
    move(id, x, y);
    const g = gestures.get(id);
    gestures.delete(id);
    started.delete(id);
    if (!g) return;
    switch (g.t) {
      case "body": {
        const p = pieceById(circuit, g.piece);
        release(g);
        if (p && p.kind === "switch") {
          setOn(circuit, p.id, !p.on);
          const c = socketPoint(layout, p.socket);
          effect("flip", c.x, c.y);
        }
        return;
      }
      case "move": {
        const p = pieceById(circuit, g.piece);
        if (!p) return;
        const at = { x: g.x + g.gx, y: g.y + g.gy };
        if (g.toTray) {
          if (removePiece(circuit, p.id)) effect("poof", at.x, at.y);
          return;
        }
        const from = socketPoint(layout, p.socket);
        if (g.target !== null && movePiece(circuit, p.id, g.target)) {
          const to = socketPoint(layout, g.target);
          effect("place", to.x, to.y);
        } else effect("spring", at.x, at.y, from.x, from.y);
        return;
      }
      case "new": {
        if (g.target === null) {
          effect("poof", g.x, g.y);
          return;
        }
        if (addPiece(circuit, g.kind, g.target)) {
          const to = socketPoint(layout, g.target);
          effect("place", to.x, to.y);
        } else effect("shake", g.x, g.y);
        return;
      }
      case "wire": {
        const anchor = portPoint(g.from);
        if (g.target) {
          const forward = g.from.pin < 0;
          const made = forward
            ? connect(circuit, g.from.piece, g.target.piece, g.target.pin)
            : connect(circuit, g.target.piece, g.from.piece, g.from.pin);
          const at = portPoint(g.target);
          if (made && at) {
            effect("plug", at.x, at.y);
            return;
          }
        }
        if (anchor) effect("spring", g.x, g.y, anchor.x, anchor.y);
        return;
      }
      case "replug": {
        const w = wireById(circuit, g.wire);
        if (!w) return;
        if (g.target && replug(circuit, w.id, g.target.piece, g.target.pin)) {
          const at = portPoint(g.target);
          if (at) effect("plug", at.x, at.y);
          return;
        }
        const anchor = portPoint({ piece: w.from, pin: -1 });
        disconnect(circuit, w.id);
        if (anchor) effect("spring", g.x, g.y, anchor.x, anchor.y);
        return;
      }
      case "cut": {
        const m = wireMiddle(g.wire);
        if (disconnect(circuit, g.wire) && m) effect("poof", m.x, m.y);
        return;
      }
      case "none":
        return;
    }
  };

  const cancel = (id: number) => {
    const g = gestures.get(id);
    gestures.delete(id);
    started.delete(id);
    if (g) release(g);
  };

  // ---- Time ----------------------------------------------------------------------------------

  const nextCard = () => {
    cardIndex = (cardIndex + 1) % CARDS.length;
    fresh();
  };

  const update = (ms: number) => {
    const now = o.now();
    for (const [id, t] of started) {
      if (now - t > STALE_GESTURE_MS) cancel(id);
    }
    tickAcc += ms;
    let n = 0;
    while (tickAcc >= TICK_MS && n < MAX_TICKS_PER_UPDATE) {
      step(circuit);
      tickAcc -= TICK_MS;
      n++;
    }
    if (tickAcc >= TICK_MS) tickAcc = 0;
    const c = card();
    if (!c) return;
    if (doneAt > Number.NEGATIVE_INFINITY) {
      if (now - doneAt >= TRICK_MS) nextCard();
      return;
    }
    checkAcc += ms;
    if (checkAcc < CHECK_MS) return;
    checkAcc = 0;
    rows = checkCard(
      circuit,
      c,
      inputs,
      postsOf(circuit).map((p) => p.id),
    );
    if (rows.length > 0 && rows.every(Boolean)) {
      doneAt = now;
      solved++;
      if (helped) completed++;
    }
  };

  return {
    get layout() {
      return layout;
    },
    get circuit() {
      return circuit;
    },
    gestures,
    fx,
    variant: o.variant,
    get card() {
      return card();
    },
    get cardIndex() {
      return cardIndex;
    },
    get inputs() {
      return inputs;
    },
    get rows() {
      return rows;
    },
    get doneAt() {
      return doneAt;
    },
    get completed() {
      return completed;
    },
    get solved() {
      return solved;
    },
    get lastHuman() {
      return lastHuman;
    },
    posts: () => postsOf(circuit).map((p) => powered(circuit, p)),
    placement,
    ports,
    trayItemAt,
    down,
    move,
    up,
    cancel,
    update,
    setLayout(l) {
      const same =
        l.sockets.length === layout.sockets.length &&
        l.sockets.every((s, i) => s.band === layout.sockets[i]!.band);
      layout = l;
      for (const g of gestures.values()) release(g);
      gestures.clear();
      started.clear();
      if (!same) fresh();
    },
    reset() {
      for (const g of gestures.values()) release(g);
      cardIndex = 0;
      fx.length = 0;
      fresh();
    },
    starter() {
      for (const g of gestures.values()) release(g);
      if (goals) {
        fresh();
        return;
      }
      circuit = createCircuit(bands());
      gestures.clear();
      started.clear();
      buildStarter();
    },
    clear() {
      for (const g of gestures.values()) release(g);
      gestures.clear();
      started.clear();
      clearCircuit(circuit, true);
      if (goals) rows = rows.map(() => false);
    },
    setCard(i) {
      if (!goals) return;
      cardIndex = ((i % CARDS.length) + CARDS.length) % CARDS.length;
      fresh();
    },
  };
};
