import { contains, type Geometry, venueToCell } from "./config";
import { E, elementDef, type ElementId } from "./elements";
import type { Part } from "./layout";
import type { Piece, PieceKind, PieceSet } from "./pieces";
import { PIECE_KINDS } from "./pieces";
import { BASE_POUR_AREA, capsuleArea, fillChance, type Hand, type Hands } from "./pour";
import type { PlaceKind, SwatchDef } from "./swatches";
import type { Emit } from "./weather";

/**
 * Turns fingers into pours, placements and palette handling. A finger pressed on a swatch picks
 * it for its side of the world: dragged out, it pours that element (or carries that piece or
 * tool), even across other swatches; let go, the pick waits for the next touch on that side. A finger on a widget's bar moves it, on its
 * corner resizes it, on a tab changes page. A finger anywhere else, including the gaps in a
 * widget, is in the world: it pours what its hand memory holds, places what was picked, or (in
 * the delta) picks up a barrier. Pours are capsules from last tick's position to this one, so a
 * quick swipe leaves a continuous stream rather than dots.
 */
export type FingerMode = "pour" | "swatch" | "place" | "move" | "drag" | "resize" | "idle";

export interface Finger {
  id: number;
  /** Venue px, y down. */
  x: number;
  y: number;
  px: number;
  py: number;
  mode: FingerMode;
  element: ElementId;
  place: PlaceKind | null;
  /** A barrier being carried (delta). */
  moving: Piece | null;
  hand: Hand | null;
  /** The swatch under a finger in "swatch" mode, and the widget it belongs to. */
  swatch: { widget: number; swatch: SwatchDef; part: Part } | null;
  widget: number;
  /** Where the finger came down, for resizing. */
  x0: number;
  y0: number;
  synthetic: boolean;
}

/** What the controls need from the palette widgets. */
export interface WidgetHost {
  hit(x: number, y: number): { widget: number; part: Part } | null;
  moveBy(widget: number, dx: number, dy: number): void;
  /** A resize drag that began at (x0, y0) is now at (x, y). */
  resizeTo(widget: number, x0: number, y0: number, x: number, y: number): void;
  setPage(widget: number, page: number): void;
}

export interface ControlsDeps {
  geometry: Geometry;
  widgets: WidgetHost;
  pieces: PieceSet;
  hands: Hands;
  /** Barriers can be picked up and moved (delta). */
  movable: boolean;
  rand(): number;
  now(): number;
  /** Stamp ops for the world. */
  stamp(op: "place" | "remove" | "crumble", piece: Piece): void;
  /** Place a tool (gadget or beetle) at a spot, with the element the hand was pouring. */
  placeTool(kind: Exclude<PlaceKind, PieceKind>, x: number, y: number, element: ElementId): void;
  /** A tap on something already placed (a fan turns round). True if it took the touch. */
  tapPlaced(x: number, y: number): boolean;
  /** A Remove finger is over (x, y): take away any piece, gadget or beetle there. */
  removeAt(x: number, y: number): void;
  /** A finger pressed a swatch, for feedback. */
  pressed(widget: number, swatch: SwatchDef): void;
}

export interface Controls {
  readonly fingers: ReadonlyMap<number, Finger>;
  down(id: number, x: number, y: number, synthetic: boolean): void;
  move(id: number, x: number, y: number): void;
  up(id: number, cancelled: boolean): void;
  /** Write this tick's pours. Returns how many were written (at most `max`). */
  emit(out: Emit, dt: number, max: number): number;
  /** Drop every finger without placing anything. */
  clear(): void;
}

/** Pour radius in venue px: about a fingertip. */
export const POUR_RADIUS = 16;
/** Remove works over a broader patch, clearing about this share of it each tick. */
export const ERASE_RADIUS = 40;
const ERASE_RATE = 0.5;
/** A finger that slides this far (fraction of a swatch) off a swatch has left it. */
const SWATCH_SLOP = 0.12;
/** Piece pick-up slop in venue px. */
const PICK_SLOP = 30;
export const MAX_FINGERS = 40;

const isPiece = (k: PlaceKind): k is PieceKind => (PIECE_KINDS as readonly string[]).includes(k);

export const createControls = (deps: ControlsDeps): Controls => {
  const fingers = new Map<number, Finger>();

  const pick = (f: Finger, widget: number, swatch: SwatchDef, part: Part) => {
    deps.hands.pick(widget, swatch.choice, deps.now());
    if (swatch.choice.type === "element") f.element = swatch.choice.element;
    f.mode = "swatch";
    f.swatch = { widget, swatch, part };
    deps.pressed(widget, swatch);
  };

  /** The finger goes into the world here: it takes its side's pick, if any. */
  const enterWorld = (f: Finger) => {
    const b = deps.hands.bind(f.x, f.y, deps.now());
    f.hand = b.hand;
    f.swatch = null;
    f.px = f.x;
    f.py = f.y;
    if (b.place) {
      f.mode = "place";
      f.place = b.place;
    } else {
      f.mode = "pour";
      f.element = b.hand.element;
    }
  };

  const dropPiece = (kind: PieceKind, x: number, y: number, steady: boolean) => {
    const placed = deps.pieces.place(kind, x, y, steady ? () => 0.5 : deps.rand, deps.now());
    if (!placed) return;
    for (const old of placed.removed) deps.stamp("crumble", old);
    deps.stamp("place", placed.piece);
  };

  return {
    fingers,

    down(id, x, y, synthetic) {
      if (fingers.size >= MAX_FINGERS) return;
      const f: Finger = {
        id,
        x,
        y,
        px: x,
        py: y,
        mode: "idle",
        element: E.SAND,
        place: null,
        moving: null,
        hand: null,
        swatch: null,
        widget: -1,
        x0: x,
        y0: y,
        synthetic,
      };
      fingers.set(id, f);
      const hit = deps.widgets.hit(x, y);
      if (hit) {
        const { part, widget } = hit;
        f.widget = widget;
        if (part.type === "swatch") pick(f, widget, part.swatch, part);
        else if (part.type === "tab") deps.widgets.setPage(widget, part.page);
        else if (part.type === "move") f.mode = "drag";
        else if (part.type === "resize") f.mode = "resize";
        return;
      }
      if (deps.tapPlaced(x, y)) return;
      if (deps.movable) {
        const piece = deps.pieces.at(x, y, PICK_SLOP);
        if (piece && deps.pieces.remove(piece.id)) {
          deps.stamp("remove", piece);
          f.mode = "move";
          f.moving = piece;
          return;
        }
      }
      enterWorld(f);
      if (f.mode === "pour" && f.element === E.EMPTY) deps.removeAt(x, y);
    },

    move(id, x, y) {
      const f = fingers.get(id);
      if (!f) return;
      const dx = x - f.x;
      const dy = y - f.y;
      f.x = x;
      f.y = y;
      if (f.mode === "drag") {
        deps.widgets.moveBy(f.widget, dx, dy);
      } else if (f.mode === "resize") {
        deps.widgets.resizeTo(f.widget, f.x0, f.y0, x, y);
      } else if (f.mode === "swatch" && f.swatch) {
        // Off its swatch, the finger is in the world with what it picked, even while it crosses
        // other swatches on the way out: only a press chooses.
        const box = f.swatch.part.box;
        if (!contains(box, x, y, box.width * SWATCH_SLOP)) enterWorld(f);
      } else if (f.mode === "pour" && f.element === E.EMPTY) {
        deps.removeAt(x, y);
      }
    },

    up(id, cancelled) {
      const f = fingers.get(id);
      if (!f) return;
      fingers.delete(id);
      if (cancelled) {
        if (f.mode === "move" && f.moving) dropPiece(f.moving.kind, f.moving.x, f.moving.y, true);
        return;
      }
      if (f.mode === "place" && f.place) {
        if (isPiece(f.place)) dropPiece(f.place, f.x, f.y, false);
        else deps.placeTool(f.place, f.x, f.y, f.hand?.element ?? f.element);
      } else if (f.mode === "move" && f.moving) {
        dropPiece(f.moving.kind, f.x, f.y, true);
      }
    },

    emit(out, dt, max) {
      const g = deps.geometry;
      const now = deps.now();
      let n = 0;
      for (const f of fingers.values()) {
        if (n >= max) break;
        if (f.mode !== "pour" || !f.hand) continue;
        const def = elementDef(f.element);
        const erasing = f.element === E.EMPTY;
        if (!def.pour && !erasing) continue;
        const share = deps.hands.spend(f.hand, dt, now);
        deps.hands.follow(f.hand, f.x, f.y, now);
        f.hand.element = f.element;
        const a = venueToCell(g, f.px, f.py);
        const b = venueToCell(g, f.x, f.y);
        if (erasing || !def.pour) {
          // Remove: clears loose matter under a broad fingertip, about half of it per tick.
          const r = Math.max(2, ERASE_RADIUS / g.cell);
          out(a.x, a.y, b.x, b.y, r, Math.min(1, ERASE_RATE * share), E.EMPTY, [0, 0], 2);
          f.px = f.x;
          f.py = f.y;
          n++;
          continue;
        }
        const radius = Math.max(1.5, POUR_RADIUS / g.cell);
        const cellsPerSecond = (BASE_POUR_AREA * def.pour.rate) / (g.cell * g.cell);
        const wanted = cellsPerSecond * dt * share;
        const area = capsuleArea(Math.hypot(b.x - a.x, b.y - a.y), radius);
        out(
          a.x,
          a.y,
          b.x,
          b.y,
          radius,
          fillChance(wanted, area),
          f.element,
          def.pour.life,
          def.pour.mode === "ignite" ? 1 : 0,
        );
        f.px = f.x;
        f.py = f.y;
        n++;
      }
      return n;
    },

    clear() {
      fingers.clear();
    },
  };
};
