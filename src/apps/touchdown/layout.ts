/**
 * Where everything goes on a frame, in venue px (y down). Pure.
 *
 * Duo pads sit in the child band, below the ground line where nothing important happens, so a
 * hand never covers the craft or a landing pad. Crew turn pads go in the adult band above the
 * child's main pad. On a pair the two players stand at the outer edges, one per half; on a wall
 * each crew owns an equal lane of the reachable band.
 */
import type { FrameKind, Rect } from "../../core/types";
import type { Variant } from "./config";

export type PadRole = "left" | "right" | "main" | "turnLeft" | "turnRight";

export interface PadSpec {
  /** Index across the frame. */
  id: number;
  crew: number;
  role: PadRole;
  rect: Rect;
}

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export interface CrewSpec {
  index: number;
  /** Where this crew's craft may fly and its landing pads go. */
  lane: { x0: number; x1: number };
  pads: PadSpec[];
  reset: Circle;
  /** x ranges kept clear of landing pads, because pads or arms cover them. */
  noLand: [number, number][];
}

export interface Layout {
  kind: FrameKind;
  width: number;
  height: number;
  variant: Variant;
  /** Craft size: the width of its body and legs. */
  craft: number;
  spawnY: number;
  /** The craft's centre never rises above this. */
  ceiling: number;
  /** The terrain surface stays between these heights. */
  ground: { top: number; bottom: number };
  /** Spawn height to the middle of the ground band. Speeds scale with it. */
  drop: number;
  crews: CrewSpec[];
}

export interface LayoutInput {
  kind: FrameKind;
  width: number;
  height: number;
  /** Venue y of the top of adult and child reach. */
  reachTop: { adult: number; child: number };
  seams: readonly number[];
  variant: Variant;
  crews: number;
}

/** Drop height over craft size: the same game at every scale. */
export const DROP_PER_CRAFT = 6.2;
/** Share of the drop the terrain's hills and valleys may use. */
const BAND_SHARE = 0.24;

export const PANEL_PAD = { w: 300, h: 420, minH: 300 };
export const WALL_PAD = { w: 520, h: 460, minH: 300 };
export const WALL_TURN = { w: 500, h: 320, minH: 240 };
/** Wall: space between a crew's two duo pads. */
export const WALL_PARTNER_GAP = 440;
/** Pair: pads keep at least this far from the outer edges. */
export const PAIR_EDGE = 120;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const rect = (x: number, y: number, width: number, height: number): Rect => ({
  x,
  y,
  width,
  height,
});

interface Draft {
  lane: { x0: number; x1: number };
  pads: { role: PadRole; rect: Rect }[];
  reset: Circle;
  noLand: [number, number][];
}

const finish = (
  input: LayoutInput,
  drafts: Draft[],
  spawnY: number,
  groundBottom: number,
): Layout => {
  const band = BAND_SHARE * (groundBottom - spawnY);
  const ground = { top: groundBottom - band, bottom: groundBottom };
  const drop = (ground.top + ground.bottom) / 2 - spawnY;
  const craft = drop / DROP_PER_CRAFT;
  let id = 0;
  const crews: CrewSpec[] = drafts.map((d, index) => ({
    index,
    lane: d.lane,
    pads: d.pads.map((p) => ({ id: id++, crew: index, role: p.role, rect: p.rect })),
    reset: d.reset,
    noLand: d.noLand,
  }));
  return {
    kind: input.kind,
    width: input.width,
    height: input.height,
    variant: input.variant,
    craft,
    spawnY,
    ceiling: Math.max(craft * 0.6, spawnY - craft * 0.5),
    ground,
    drop,
    crews,
  };
};

/** Panels and pairs: pads along the bottom, the ground line above them. */
const layoutTall = (input: LayoutInput): Layout => {
  const { width: W, height: H, variant } = input;
  const pair = input.kind === "pair";
  const child = clamp(input.reachTop.child, 0, H);
  const margin = 40;
  const h = clamp(H - child - margin - 10, PANEL_PAD.minH, PANEL_PAD.h);
  const w = PANEL_PAD.w;
  const top = H - margin - h;
  const edge = pair ? PAIR_EDGE : margin;
  const spawnY = H * 0.075;
  const groundBottom = top - 40;
  const leftX = edge;
  const rightX = W - edge - w;
  const pads: Draft["pads"] = [];
  const noLand: [number, number][] = [];
  let reset: Circle;
  if (variant === "duo") {
    pads.push({ role: "left", rect: rect(leftX, top, w, h) });
    pads.push({ role: "right", rect: rect(rightX, top, w, h) });
    reset = pair ? { x: W / 2 - 300, y: top + h / 2, r: 80 } : { x: W / 2, y: top + h / 2, r: 80 };
  } else if (pair) {
    // The child's main engine low on the left half, the adult's turn pads high on the right.
    pads.push({ role: "main", rect: rect(leftX, top, w, h) });
    const adult = clamp(input.reachTop.adult, 0, H);
    const turnBottom = Math.max(adult + h + 20, Math.min(child - 60, groundBottom - 40));
    const turnTop = Math.max(adult + 20, turnBottom - h);
    const gap = 40;
    pads.push({ role: "turnLeft", rect: rect(rightX - gap - w, turnTop, w, turnBottom - turnTop) });
    pads.push({ role: "turnRight", rect: rect(rightX, turnTop, w, turnBottom - turnTop) });
    noLand.push([rightX - gap - w - 40, W]);
    reset = { x: W / 2 - 300, y: top + h / 2, r: 80 };
  } else {
    // A panel is too narrow for raised turn pads clear of the play area: one row of three,
    // the main engine in the middle for a child, the turn pads at the corners.
    const gap = (W - 3 * w) / 4;
    pads.push({ role: "turnLeft", rect: rect(gap, top, w, h) });
    pads.push({ role: "main", rect: rect(2 * gap + w, top, w, h) });
    pads.push({ role: "turnRight", rect: rect(3 * gap + 2 * w, top, w, h) });
    reset = { x: margin + 80, y: Math.min(child - 140, H * 0.47), r: 80 };
  }
  return finish(input, [{ lane: { x0: 0, x1: W }, pads, reset, noLand }], spawnY, groundBottom);
};

/** Kiosk: landscape, pads on consoles at the left and right edges beside the play area. */
const layoutKiosk = (input: LayoutInput): Layout => {
  const { width: W, height: H, variant } = input;
  const margin = 40;
  const h = clamp(H * 0.37, 300, 400);
  const top = H - 50 - h;
  const w = 300;
  const pads: Draft["pads"] = [];
  let laneX1: number;
  if (variant === "duo") {
    pads.push({ role: "left", rect: rect(margin, top, w, h) });
    pads.push({ role: "right", rect: rect(W - margin - w, top, w, h) });
    laneX1 = W - margin - w - 20;
  } else {
    pads.push({ role: "main", rect: rect(margin, top, w, h) });
    const tw = 270;
    const gap = 24;
    pads.push({ role: "turnLeft", rect: rect(W - margin - 2 * tw - gap, top, tw, h) });
    pads.push({ role: "turnRight", rect: rect(W - margin - tw, top, tw, h) });
    laneX1 = W - margin - 2 * tw - gap - 20;
  }
  const reset: Circle = { x: margin + w / 2, y: top - 40 - 70, r: 70 };
  return finish(
    input,
    [{ lane: { x0: margin + w + 20, x1: laneX1 }, pads, reset, noLand: [] }],
    H * 0.085,
    H - 70,
  );
};

/** Wall: equal lanes, one per crew, pads in the reachable band at the bottom. */
const layoutWall = (input: LayoutInput): Layout => {
  const { width: W, height: H, variant } = input;
  const n = clamp(Math.round(input.crews), 1, 3);
  const child = clamp(input.reachTop.child, 0, H);
  const adult = clamp(input.reachTop.adult, 0, child);
  // Keep pads off the floor: the lowest 8 % of the wall is below a child's knees.
  const floor = H * 0.08;
  const h = clamp(H - child - floor - 10, WALL_PAD.minH, WALL_PAD.h);
  const w = WALL_PAD.w;
  const top = H - floor - h;
  const L = W / n;
  const drafts: Draft[] = [];
  let groundBottom = top - 50;
  for (let i = 0; i < n; i++) {
    const x0 = i * L;
    const cx = x0 + L / 2;
    const pads: Draft["pads"] = [];
    let reset: Circle;
    if (variant === "duo") {
      const g = WALL_PARTNER_GAP / 2;
      pads.push({ role: "left", rect: rect(cx - g - w, top, w, h) });
      pads.push({ role: "right", rect: rect(cx + g, top, w, h) });
      reset = { x: cx, y: top + h / 2, r: 90 };
    } else {
      pads.push({ role: "main", rect: rect(cx - w / 2, top, w, h) });
      const th = clamp(child - adult - 40, WALL_TURN.minH, WALL_TURN.h);
      const tTop = Math.max(adult + 20, child - 20 - th);
      const tw = WALL_TURN.w;
      pads.push({ role: "turnLeft", rect: rect(cx - 20 - tw, tTop, tw, th) });
      pads.push({ role: "turnRight", rect: rect(cx + 20, tTop, tw, th) });
      reset = { x: cx + w / 2 + 140, y: top + h / 2, r: 90 };
      groundBottom = Math.min(groundBottom, tTop - 40);
    }
    drafts.push({ lane: { x0, x1: x0 + L }, pads, reset, noLand: [] });
  }
  return finish(input, drafts, H * 0.07, groundBottom);
};

export const layoutFor = (input: LayoutInput): Layout => {
  if (input.kind === "wall") return layoutWall(input);
  if (input.kind === "kiosk") return layoutKiosk(input);
  return layoutTall(input);
};

/** The pad under a point, allowing `slop` venue px around each. */
export const padAt = (layout: Layout, x: number, y: number, slop = 24): PadSpec | null => {
  for (const crew of layout.crews) {
    for (const p of crew.pads) {
      const r = p.rect;
      if (
        x >= r.x - slop &&
        x <= r.x + r.width + slop &&
        y >= r.y - slop &&
        y <= r.y + r.height + slop
      ) {
        return p;
      }
    }
  }
  return null;
};

/** Whether a point is still close enough to a held pad to keep it held. */
export const nearPad = (p: PadSpec, x: number, y: number, slop = 140): boolean => {
  const r = p.rect;
  return (
    x >= r.x - slop && x <= r.x + r.width + slop && y >= r.y - slop && y <= r.y + r.height + slop
  );
};
