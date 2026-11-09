import { E, ELEMENTS, KIND_CODE } from "./elements";

/**
 * CPU reference for the movement half of the block rule. The step shader (`shaders/step.ts`,
 * `moveBlock`) mirrors this function line for line; change both together. Tests run it on small
 * grids to check that mass is conserved, sand piles, water levels and gas rises.
 *
 * Gadget zones run first: a geyser lifts (`liftBlock`), a fan pushes (`pushBlock`).
 *
 * The world is updated in 2 x 2 blocks (a Margolus neighbourhood). Every cell of a block computes
 * the same new block from the same inputs and random numbers, then keeps its own quarter, so
 * cells only ever swap within a block and no two blocks can claim the same cell. Successive passes
 * shift the block grid by one cell, cycling through the four offsets, so motion crosses block edges.
 */
export interface Cell {
  id: number;
  /** Random byte fixed at birth: per-cell colour variation (and a plant's genome). */
  shade: number;
  /** Life, heat or growth energy, depending on the element. */
  life: number;
  /** Bit field, see the AUX_ constants. */
  aux: number;
}

/** Fall speed, 0 to 7: falling cells start slow and speed up. */
export const AUX_SPEED = 0x07;
/** Flow direction of a liquid or gas: set means right. */
export const AUX_RIGHT = 0x08;
/** Set when the cell moved in the last pass (erosion reads it). */
export const AUX_MOVED = 0x10;
/** Plant leaf. */
export const AUX_LEAF = 0x20;
/** Plant flower. */
export const AUX_FLOWER = 0x40;
/** Bedrock: volcanic. Plant: a node that will put out a leaf. */
export const AUX_STYLE = 0x80;

/** Block positions, y up. */
export const BL = 0;
export const BR = 1;
export const TL = 2;
export const TR = 3;

/** Pass offsets: y alternates every pass so falling never stalls; x cycles for symmetry. */
export const PASS_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 1],
  [1, 0],
  [0, 1],
];

const K = KIND_CODE;
const kindOf = (c: Cell): number => K[ELEMENTS[c.id]?.kind ?? "static"];
const density = (c: Cell): number => ELEMENTS[c.id]?.density ?? 9;
const prop = (c: Cell, key: "fall" | "slide" | "spread" | "rise"): number =>
  ELEMENTS[c.id]?.[key] ?? 0;

const isFluid = (c: Cell) => kindOf(c) <= K.liquid;
const isMover = (c: Cell) => kindOf(c) === K.powder || kindOf(c) === K.liquid;
const flows = (c: Cell) => kindOf(c) === K.liquid || kindOf(c) === K.gas;
const right = (c: Cell) => (c.aux & AUX_RIGHT) !== 0;

/** Can `a` (above) swap with `b` (below)? Empty over gas counts: that is the gas rising. */
export const sinks = (a: Cell, b: Cell): boolean =>
  kindOf(a) !== K.static && isFluid(b) && density(a) > density(b);

const speedFactor = (c: Cell) => 0.5 + (0.5 * (c.aux & AUX_SPEED)) / 7;

const sinkChance = (a: Cell, b: Cell): number => {
  const fall =
    kindOf(a) === K.empty ? 0 : prop(a, "fall") * (kindOf(b) === K.liquid ? 0.35 : speedFactor(a));
  const rise = kindOf(b) === K.gas ? prop(b, "rise") : 0;
  return Math.max(fall, rise);
};

const flowsInto = (a: Cell, b: Cell): boolean =>
  kindOf(b) === K.empty ||
  (kindOf(a) === K.liquid && kindOf(b) === K.gas) ||
  (kindOf(b) === kindOf(a) && density(a) > density(b));

const setSpeed = (c: Cell, s: number) => {
  c.aux = (c.aux & ~AUX_SPEED) | Math.max(0, Math.min(7, s));
};

const swap = (c: Cell[], i: number, j: number) => {
  const t = c[i]!;
  c[i] = c[j]!;
  c[j] = t;
};

const isMovable = (c: Cell) => isMover(c) || kindOf(c) === K.gas;

/** Can a lifted or pushed cell `a` take the place of `b`? Open space, gas, or (for grains) liquid. */
const yields = (a: Cell, b: Cell): boolean =>
  kindOf(b) === K.empty ||
  (kindOf(b) === K.gas && a.id !== b.id) ||
  (kindOf(b) === K.liquid && kindOf(a) === K.powder);

/** Geyser zone: everything in the column rises a cell per pass. Mirrors liftBlock in the shader. */
export const liftBlock = (
  c: Cell[],
  moved: boolean[],
  strength: number,
  rnd: () => number,
): void => {
  for (const [top, bottom] of [
    [TL, BL],
    [TR, BR],
  ] as const) {
    if (isMovable(c[bottom]!) && yields(c[bottom]!, c[top]!) && rnd() < strength) {
      swap(c, top, bottom);
      moved[top] = moved[bottom] = true;
    }
  }
};

/** Fan zone: everything is blown one cell downwind. Mirrors pushBlock in the shader. */
export const pushBlock = (
  c: Cell[],
  moved: boolean[],
  right: boolean,
  strength: number,
  rnd: () => number,
): void => {
  for (const [l, r] of [
    [BL, BR],
    [TL, TR],
  ] as const) {
    const [from, to] = right ? [l, r] : [r, l];
    if (moved[from] || moved[to]) continue;
    if (isMovable(c[from]!) && yields(c[from]!, c[to]!) && rnd() < strength) {
      swap(c, from, to);
      moved[from] = moved[to] = true;
    }
  }
};

/**
 * Move the four cells of one block in place. `rnd` returns uniform numbers in [0, 1). Cells
 * already moved this pass (by a zone) are left alone.
 */
export const moveBlock = (
  c: Cell[],
  rnd: () => number,
  moved: boolean[] = [false, false, false, false],
): void => {
  // 1. Columns: a cell sinks into a lighter fluid below it, speeding up as it goes.
  for (const [top, bottom] of [
    [TL, BL],
    [TR, BR],
  ] as const) {
    if (moved[top] || moved[bottom]) continue;
    const t = c[top]!;
    const b = c[bottom]!;
    if (sinks(t, b)) {
      if (rnd() < sinkChance(t, b)) {
        swap(c, top, bottom);
        moved[top] = moved[bottom] = true;
        if (isMover(t)) setSpeed(t, (t.aux & AUX_SPEED) + 1);
        setSpeed(b, 0);
      }
    } else if (isMover(t)) {
      setSpeed(t, 0);
    }
  }

  // 2. Diagonals: a powder or liquid that can't fall slides to the far bottom corner, if the
  // cell beside it is open (so grains don't squeeze past a wall corner).
  const slides = (top: number, under: number, target: number, side: number) => {
    const a = c[top]!;
    return (
      !moved[top] &&
      !moved[target] &&
      isMover(a) &&
      !sinks(a, c[under]!) &&
      sinks(a, c[target]!) &&
      isFluid(c[side]!)
    );
  };
  const fromTL = slides(TL, BL, BR, TR);
  const fromTR = slides(TR, BR, BL, TL);
  if (fromTL || fromTR) {
    const useTL = fromTL && (!fromTR || rnd() < 0.5);
    const [top, target] = useTL ? [TL, BR] : [TR, BL];
    const a = c[top]!;
    const chance = prop(a, "slide") * (kindOf(c[target]!) === K.liquid ? 0.5 : 1);
    if (rnd() < chance) {
      swap(c, top, target);
      moved[top] = moved[target] = true;
    }
  }

  // 3. Rows: liquids and gases flow sideways in the direction they remember, and turn around
  // when blocked, which levels pools far faster than a random walk.
  for (const [l, r] of [
    [BL, BR],
    [TL, TR],
  ] as const) {
    if (moved[l] || moved[r]) continue;
    const a = c[l]!;
    const b = c[r]!;
    const aGo = flows(a) && right(a) && flowsInto(a, b);
    const bGo = flows(b) && !right(b) && flowsInto(b, a);
    if (aGo && (!bGo || rnd() < 0.5)) {
      if (rnd() < prop(a, "spread")) {
        swap(c, l, r);
        moved[l] = moved[r] = true;
      }
    } else if (bGo) {
      if (rnd() < prop(b, "spread")) {
        swap(c, l, r);
        moved[l] = moved[r] = true;
      }
    } else {
      if (flows(a) && right(a)) a.aux ^= AUX_RIGHT;
      if (flows(b) && !right(b)) b.aux ^= AUX_RIGHT;
    }
  }

  for (let i = 0; i < 4; i++) {
    const cell = c[i]!;
    cell.aux = moved[i] ? cell.aux | AUX_MOVED : cell.aux & ~AUX_MOVED;
  }
};

/** A small CPU world for tests: `cells[y * width + x]`, y up, bedrock outside. */
export interface Grid {
  width: number;
  height: number;
  cells: Cell[];
}

export const makeGrid = (width: number, height: number): Grid => ({
  width,
  height,
  cells: Array.from({ length: width * height }, () => ({ id: E.EMPTY, shade: 0, life: 0, aux: 0 })),
});

const OUTSIDE: Cell = { id: E.BEDROCK, shade: 0, life: 0, aux: 0 };

/** A gadget zone for the CPU world: cells (x0, y0) to (x1, y1) inclusive, as in the shader. */
export interface Zone {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  kind: "lift" | "right" | "left";
  strength: number;
}

/** One pass over the whole grid with the given offset. */
export const stepGrid = (
  g: Grid,
  offset: readonly [number, number],
  rnd: () => number,
  zones: readonly Zone[] = [],
): void => {
  const [ox, oy] = offset;
  for (let by = -oy; by < g.height; by += 2) {
    for (let bx = -ox; bx < g.width; bx += 2) {
      const at = [
        [bx, by],
        [bx + 1, by],
        [bx, by + 1],
        [bx + 1, by + 1],
      ] as const;
      const inside = at.map(([x, y]) => x >= 0 && y >= 0 && x < g.width && y < g.height);
      const block = at.map(([x, y], i) =>
        inside[i] ? { ...g.cells[y * g.width + x]! } : { ...OUTSIDE },
      );
      const moved = [false, false, false, false];
      const cx = bx + 1;
      const cy = by + 1;
      const zone = zones.find((z) => cx >= z.x0 && cx <= z.x1 && cy >= z.y0 && cy <= z.y1);
      if (zone?.kind === "lift") liftBlock(block, moved, zone.strength, rnd);
      else if (zone) pushBlock(block, moved, zone.kind === "right", zone.strength, rnd);
      moveBlock(block, rnd, moved);
      at.forEach(([x, y], i) => {
        if (inside[i]) g.cells[y * g.width + x] = block[i]!;
      });
    }
  }
};
