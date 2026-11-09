/**
 * The circuit on one bench as plain data, with functions that change only the circuit they are
 * given. Sockets are numbered by the layout; the circuit knows only each socket's band. Pieces
 * sit in sockets, wires join one piece's output to another piece's input pin, and `step` is one
 * synchronous tick: every gate's output becomes its function of its inputs as they were before
 * the tick. Switches and buttons change their outputs at once; lamps, fans, bells and posts read
 * their input wire directly, so only gates add delay.
 */

export type PieceKind =
  | "switch"
  | "button"
  | "lamp"
  | "fan"
  | "bell"
  | "not"
  | "and"
  | "or"
  | "xor"
  | "blinker"
  | "post";

/** Which sockets a piece goes in: children's pieces low, gates above, posts fixed at the top. */
export type Band = "child" | "adult" | "post";
/** What a piece does, for limits: sources drive wires, sinks show a signal, gates compute. */
export type Group = "source" | "sink" | "gate" | "post";

export interface KindSpec {
  band: Band;
  group: Group;
  inputs: number;
  output: boolean;
}

export const KINDS: Readonly<Record<PieceKind, KindSpec>> = {
  switch: { band: "child", group: "source", inputs: 0, output: true },
  button: { band: "child", group: "source", inputs: 0, output: true },
  lamp: { band: "child", group: "sink", inputs: 1, output: false },
  fan: { band: "child", group: "sink", inputs: 1, output: false },
  bell: { band: "child", group: "sink", inputs: 1, output: false },
  not: { band: "adult", group: "gate", inputs: 1, output: true },
  and: { band: "adult", group: "gate", inputs: 2, output: true },
  or: { band: "adult", group: "gate", inputs: 2, output: true },
  xor: { band: "adult", group: "gate", inputs: 2, output: true },
  blinker: { band: "adult", group: "gate", inputs: 0, output: true },
  post: { band: "post", group: "post", inputs: 1, output: false },
};

export const CHILD_KINDS: readonly PieceKind[] = ["switch", "button", "lamp", "fan", "bell"];
export const BASIC_GATES: readonly PieceKind[] = ["not", "and", "or"];
export const ALL_GATES: readonly PieceKind[] = ["not", "and", "or", "xor", "blinker"];

/** Per bench. Posts don't count as pieces. */
export const LIMITS = {
  pieces: 14,
  wires: 24,
  fanout: 4,
  source: 4,
  sink: 4,
  gate: 6,
} as const;

/** One tick: the time a gate takes to change. A gate looped on itself blinks at 2.5 Hz. */
export const TICK_MS = 200;
/** A blinker holds each state for this many ticks: on and off about once a second. */
export const BLINK_TICKS = 3;

export interface Piece {
  id: number;
  kind: PieceKind;
  socket: number;
  /** A switch's position, or a button held down. */
  on: boolean;
  /** The output now. Sources follow `on` at once; gates change only on a tick. */
  out: boolean;
  /** Ticks since the piece was placed, which paces the blinker. */
  age: number;
  /** Fixed in place: posts, and a goal card's inputs. */
  pinned: boolean;
  /** Colour slot, unique among the pieces of its group on the bench. */
  hue: number;
}

export interface Wire {
  id: number;
  /** The driving piece (its output). */
  from: number;
  /** The driven piece and which of its inputs. */
  to: number;
  pin: number;
}

export interface Circuit {
  sockets: Band[];
  pieces: Piece[];
  wires: Wire[];
  tick: number;
  nextId: number;
  /** Bumped on every change of pieces or wires, so views can cache what depends on them. */
  version: number;
}

export type Refusal =
  | "missing"
  | "band"
  | "taken"
  | "pinned"
  | "pieces"
  | "source"
  | "sink"
  | "gate"
  | "port"
  | "fanout"
  | "wires";

const HUES = 8;

export const createCircuit = (sockets: readonly Band[]): Circuit => {
  const c: Circuit = {
    sockets: [...sockets],
    pieces: [],
    wires: [],
    tick: 0,
    nextId: 1,
    version: 0,
  };
  sockets.forEach((band, i) => {
    if (band === "post") insert(c, "post", i, true);
  });
  return c;
};

export const pieceById = (c: Circuit, id: number): Piece | undefined =>
  c.pieces.find((p) => p.id === id);

export const pieceAt = (c: Circuit, socket: number): Piece | undefined =>
  c.pieces.find((p) => p.socket === socket);

export const countGroup = (c: Circuit, group: Group): number =>
  c.pieces.reduce((n, p) => n + (KINDS[p.kind].group === group ? 1 : 0), 0);

export const pieceCount = (c: Circuit): number =>
  c.pieces.reduce((n, p) => n + (p.kind === "post" ? 0 : 1), 0);

/** Why one more piece of this kind can't go on the bench, or null when it can. */
export const addError = (c: Circuit, kind: PieceKind): Refusal | null => {
  const group = KINDS[kind].group;
  if (group === "post") return "band";
  if (pieceCount(c) >= LIMITS.pieces) return "pieces";
  if (countGroup(c, group) >= LIMITS[group]) return group;
  return null;
};

/** Why this socket can't take a piece of this kind, ignoring limits, or null. */
export const socketError = (c: Circuit, kind: PieceKind, socket: number, self = -1) => {
  const band = c.sockets[socket];
  if (band === undefined) return "missing" as const;
  if (band !== KINDS[kind].band) return "band" as const;
  const there = pieceAt(c, socket);
  if (there && there.id !== self) return "taken" as const;
  return null;
};

export const placeError = (c: Circuit, kind: PieceKind, socket: number): Refusal | null =>
  socketError(c, kind, socket) ?? addError(c, kind);

const freeHue = (c: Circuit, group: Group) => {
  const used = new Set(c.pieces.filter((p) => KINDS[p.kind].group === group).map((p) => p.hue));
  for (let h = 0; h < HUES; h++) if (!used.has(h)) return h;
  return 0;
};

const insert = (c: Circuit, kind: PieceKind, socket: number, pinned: boolean): Piece => {
  const piece: Piece = {
    id: c.nextId++,
    kind,
    socket,
    on: false,
    out: false,
    age: 0,
    pinned,
    hue: freeHue(c, KINDS[kind].group),
  };
  c.pieces.push(piece);
  c.version++;
  return piece;
};

export const addPiece = (
  c: Circuit,
  kind: PieceKind,
  socket: number,
  pinned = false,
): Piece | null => (placeError(c, kind, socket) ? null : insert(c, kind, socket, pinned));

/** Move a piece to a free socket of its band. Its wires go with it. */
export const movePiece = (c: Circuit, id: number, socket: number): boolean => {
  const p = pieceById(c, id);
  if (!p || p.pinned || socketError(c, p.kind, socket, id)) return false;
  if (p.socket !== socket) {
    p.socket = socket;
    c.version++;
  }
  return true;
};

/** Take a piece off the bench, with every wire that touches it. Posts and pinned pieces stay. */
export const removePiece = (c: Circuit, id: number): boolean => {
  const i = c.pieces.findIndex((p) => p.id === id);
  const p = c.pieces[i];
  if (!p || p.pinned) return false;
  c.pieces.splice(i, 1);
  c.wires = c.wires.filter((w) => w.from !== id && w.to !== id);
  c.version++;
  return true;
};

export const driver = (c: Circuit, to: number, pin: number): Wire | undefined =>
  c.wires.find((w) => w.to === to && w.pin === pin);

export const fanout = (c: Circuit, from: number): number =>
  c.wires.reduce((n, w) => n + (w.from === from ? 1 : 0), 0);

/** Why a wire can't join `from`'s output to `to`'s input `pin`, or null when it can. */
export const wireError = (c: Circuit, from: number, to: number, pin: number): Refusal | null => {
  const a = pieceById(c, from);
  const b = pieceById(c, to);
  if (!a || !b) return "missing";
  if (!KINDS[a.kind].output || pin < 0 || pin >= KINDS[b.kind].inputs) return "port";
  if (driver(c, to, pin)) return "taken";
  if (fanout(c, from) >= LIMITS.fanout) return "fanout";
  if (c.wires.length >= LIMITS.wires) return "wires";
  return null;
};

export const connect = (c: Circuit, from: number, to: number, pin: number): Wire | null => {
  if (wireError(c, from, to, pin)) return null;
  const w: Wire = { id: c.nextId++, from, to, pin };
  c.wires.push(w);
  c.version++;
  return w;
};

export const wireById = (c: Circuit, id: number): Wire | undefined =>
  c.wires.find((w) => w.id === id);

export const disconnect = (c: Circuit, id: number): boolean => {
  const i = c.wires.findIndex((w) => w.id === id);
  if (i < 0) return false;
  c.wires.splice(i, 1);
  c.version++;
  return true;
};

/** Move a wire's input end to another free input. Its output end stays. */
export const replug = (c: Circuit, id: number, to: number, pin: number): boolean => {
  const w = wireById(c, id);
  const b = pieceById(c, to);
  if (!w || !b || pin < 0 || pin >= KINDS[b.kind].inputs) return false;
  if (w.to === to && w.pin === pin) return true;
  if (driver(c, to, pin)) return false;
  w.to = to;
  w.pin = pin;
  c.version++;
  return true;
};

/** Input pins of a piece that no wire drives. */
export const freePins = (c: Circuit, id: number): number[] => {
  const p = pieceById(c, id);
  if (!p) return [];
  const pins: number[] = [];
  for (let pin = 0; pin < KINDS[p.kind].inputs; pin++) if (!driver(c, id, pin)) pins.push(pin);
  return pins;
};

/** The value on an input pin: its driver's output, or off when unwired. */
export const inputOf = (c: Circuit, piece: Piece, pin: number): boolean => {
  const w = driver(c, piece.id, pin);
  if (!w) return false;
  return pieceById(c, w.from)?.out ?? false;
};

/** Whether a lamp, fan, bell or post is powered. */
export const powered = (c: Circuit, piece: Piece): boolean => inputOf(c, piece, 0);

/** Set a switch's position or a button's press. Its output follows at once. */
export const setOn = (c: Circuit, id: number, on: boolean): boolean => {
  const p = pieceById(c, id);
  if (!p || KINDS[p.kind].group !== "source") return false;
  p.on = on;
  p.out = on;
  return true;
};

export const gateOut = (kind: PieceKind, a: boolean, b: boolean, age: number): boolean => {
  switch (kind) {
    case "not":
      return !a;
    case "and":
      return a && b;
    case "or":
      return a || b;
    case "xor":
      return a !== b;
    case "blinker":
      return Math.floor(age / BLINK_TICKS) % 2 === 0;
    default:
      return false;
  }
};

/** One synchronous tick. */
export const step = (c: Circuit): void => {
  const next: boolean[] = [];
  for (const p of c.pieces) {
    next.push(
      KINDS[p.kind].group === "gate"
        ? gateOut(p.kind, inputOf(c, p, 0), inputOf(c, p, 1), p.age)
        : p.out,
    );
  }
  c.pieces.forEach((p, i) => {
    if (KINDS[p.kind].group !== "gate") return;
    p.out = next[i] ?? false;
    p.age++;
  });
  c.tick++;
};

export const cloneCircuit = (c: Circuit): Circuit => ({
  sockets: [...c.sockets],
  pieces: c.pieces.map((p) => ({ ...p })),
  wires: c.wires.map((w) => ({ ...w })),
  tick: c.tick,
  nextId: c.nextId,
  version: c.version,
});

/** Take everything off except the posts and, when asked, pinned pieces. */
export const clearCircuit = (c: Circuit, keepPinned = true): void => {
  const keep = new Set(
    c.pieces.filter((p) => p.kind === "post" || (keepPinned && p.pinned)).map((p) => p.id),
  );
  c.pieces = c.pieces.filter((p) => keep.has(p.id));
  c.wires = c.wires.filter((w) => keep.has(w.from) && keep.has(w.to));
  c.version++;
};

/** Posts in socket order, which is left to right. */
export const postsOf = (c: Circuit): Piece[] =>
  c.pieces.filter((p) => p.kind === "post").sort((a, b) => a.socket - b.socket);

/** Is the circuit internally consistent? Used by tests and as a guard. */
export const validate = (c: Circuit): string[] => {
  const problems: string[] = [];
  const ids = new Set<number>();
  const sockets = new Set<number>();
  for (const p of c.pieces) {
    if (ids.has(p.id)) problems.push(`duplicate id ${p.id}`);
    ids.add(p.id);
    if (sockets.has(p.socket)) problems.push(`two pieces in socket ${p.socket}`);
    sockets.add(p.socket);
    if (c.sockets[p.socket] !== KINDS[p.kind].band) problems.push(`${p.kind} in wrong band`);
  }
  if (pieceCount(c) > LIMITS.pieces) problems.push("too many pieces");
  for (const g of ["source", "sink", "gate"] as const) {
    if (countGroup(c, g) > LIMITS[g]) problems.push(`too many ${g}s`);
  }
  if (c.wires.length > LIMITS.wires) problems.push("too many wires");
  const pins = new Set<string>();
  for (const w of c.wires) {
    const a = pieceById(c, w.from);
    const b = pieceById(c, w.to);
    if (!a || !b) {
      problems.push(`dangling wire ${w.id}`);
      continue;
    }
    if (!KINDS[a.kind].output) problems.push(`wire ${w.id} from a piece without an output`);
    if (w.pin < 0 || w.pin >= KINDS[b.kind].inputs) problems.push(`wire ${w.id} to a bad pin`);
    const key = `${w.to}:${w.pin}`;
    if (pins.has(key)) problems.push(`two wires into ${key}`);
    pins.add(key);
  }
  for (const p of c.pieces) {
    if (fanout(c, p.id) > LIMITS.fanout) problems.push(`fanout over limit on ${p.id}`);
  }
  return problems;
};
