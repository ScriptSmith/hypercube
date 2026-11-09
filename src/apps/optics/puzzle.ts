/**
 * A puzzle: fixed lamps, crystals and (in some puzzles) blocks or a bank's sky splitter, plus
 * the movable pieces with their solution and starting places. This module turns a puzzle and
 * the pieces' current places into a scene for the tracer.
 */
import type { BenchLayout } from "./layout";
import { type PieceKind, lampHousing, surfacesOf, isChildKind } from "./pieces";
import { type Band, type ColourBand, LASER_BITS, WHITE } from "./spectrum";
import {
  type CrystalSpec,
  type Scene,
  type Source,
  type Surface,
  type TraceResult,
  glowOf,
  trace,
} from "./trace";

export type LevelId = "m1" | "m2" | "filter" | "split" | "prism" | "lens" | "spread";

/** The ramp, easy to hard. Without colour, filters and prisms are left out. */
export const RAMP: readonly LevelId[] = ["m1", "m2", "filter", "split", "prism", "lens", "spread"];
export const PLAIN_RAMP: readonly LevelId[] = ["m1", "m2", "split", "lens", "spread"];

export const rampOf = (colour: boolean): readonly LevelId[] => (colour ? RAMP : PLAIN_RAMP);

/** Where `start` begins on the ramp: easy is the first level, medium the third. */
export const startIndex = (start: "easy" | "medium"): number => (start === "medium" ? 2 : 0);

export type LampKind = "white" | "laser" | "wide";

export interface Lamp {
  kind: LampKind;
  x: number;
  y: number;
  /** Radians, y down. */
  angle: number;
  band?: ColourBand;
  /** Index into the bench's lamp spots, or -1. */
  spot: number;
}

export interface Crystal {
  x: number;
  y: number;
  r: number;
  band: Band;
  need: number;
  /** The small crystal a lens has to focus onto. */
  small?: boolean;
}

export interface Fixed {
  kind: "block" | "sky";
  x: number;
  y: number;
  turn: number;
}

export interface PieceDef {
  kind: PieceKind;
  band?: ColourBand;
}

/** A piece's place: a socket and a turn in detents; socket null is in the tray. */
export interface Place {
  socket: number | null;
  turn: number;
}

export interface BeamOut {
  x: number;
  y: number;
  dx: number;
  dy: number;
  bits: number;
  level: number;
}

export interface Puzzle {
  level: LevelId;
  lamps: Lamp[];
  crystals: Crystal[];
  fixed: Fixed[];
  pieces: PieceDef[];
  solution: Place[];
  start: Place[];
  /** A bank frame's expected light in through its left edge (empty on the first frame). */
  entry: BeamOut[];
  /** The solution's light out through the right edge, and up through the top edge. */
  exits: BeamOut[];
  sky: BeamOut[];
  /** Generation fell back to an easier level, or found nothing. */
  fallback: boolean;
}

/** Light a crystal needs: any light for most, most of a wide lamp's bundle for the small one. */
export const NEED = 0.06;
export const NEED_SMALL = 0.55;
/** Beams in a wide lamp's bundle, and each one's share. */
export const BUNDLE = 5;
export const BUNDLE_LEVEL = 1 / BUNDLE;

/** The rays a lamp sends. */
export const lampRays = (l: Lamp, bundle: number): Source[] => {
  const dx = Math.cos(l.angle);
  const dy = Math.sin(l.angle);
  const base = { dx, dy, guide: false, hops: 0 };
  if (l.kind === "wide") {
    return Array.from({ length: BUNDLE }, (_, i) => {
      const o = (i - (BUNDLE - 1) / 2) * bundle;
      return { ...base, x: l.x - dy * o, y: l.y + dx * o, bits: WHITE, level: BUNDLE_LEVEL };
    });
  }
  const bits = l.kind === "laser" ? LASER_BITS[l.band ?? "r"] : WHITE;
  return [{ ...base, x: l.x, y: l.y, bits, level: 1 }];
};

/** Bodies: movable pieces first, then fixed parts, then lamp housings. */
export const fixedBody = (p: Puzzle, i: number): number => p.pieces.length + i;
export const lampBody = (p: Puzzle, i: number): number => p.pieces.length + p.fixed.length + i;

export const crystalSpecs = (p: Puzzle): CrystalSpec[] =>
  p.crystals.map((c) => ({ x: c.x, y: c.y, r: c.r, band: c.band, need: c.need }));

/** An item on the bench: a puzzle piece, or a sandbox piece taken from a tray. */
export interface Item {
  kind: PieceKind;
  band?: ColourBand;
  place: Place;
}

/** The scene for the tracer with the given items placed. */
export const sceneOf = (bench: BenchLayout, p: Puzzle, items: readonly Item[]): Scene => {
  const R = bench.sizes.piece;
  const surfaces: Surface[] = [];
  items.forEach((it, i) => {
    const s = it.place.socket;
    if (s === null) return;
    const at = bench.sockets[s];
    if (!at) return;
    surfaces.push(
      ...surfacesOf(
        { kind: it.kind, x: at.x, y: at.y, turn: it.place.turn, r: R, band: it.band },
        i,
      ),
    );
  });
  const base = Math.max(items.length, p.pieces.length);
  p.fixed.forEach((f, i) => {
    surfaces.push(...surfacesOf({ kind: f.kind, x: f.x, y: f.y, turn: f.turn, r: R }, base + i));
  });
  p.lamps.forEach((l, i) => {
    surfaces.push(...lampHousing(l.x, l.y, l.angle, bench.sizes.lamp, base + p.fixed.length + i));
  });
  return {
    surfaces,
    crystals: crystalSpecs(p),
    box: bench.box,
    bodies: base + p.fixed.length + p.lamps.length,
  };
};

export const itemsAt = (p: Puzzle, places: readonly Place[]): Item[] =>
  p.pieces.map((d, i) => ({
    kind: d.kind,
    band: d.band,
    place: places[i] ?? { socket: null, turn: 0 },
  }));

/** The puzzle's own light: its lamps, then any entry light (as given, real or guide). */
export const sourcesOf = (
  bench: BenchLayout,
  p: Puzzle,
  extra: readonly Source[] = [],
): Source[] => [...p.lamps.flatMap((l) => lampRays(l, bench.sizes.bundle)), ...extra];

export const entrySources = (p: Puzzle, guide: boolean): Source[] =>
  p.entry.map((e) => ({ ...e, guide, hops: 0 }));

/** Trace a puzzle with pieces at `places` and its expected entry light as real light. */
export const tracePlaces = (bench: BenchLayout, p: Puzzle, places: readonly Place[]): TraceResult =>
  trace(sceneOf(bench, p, itemsAt(p, places)), sourcesOf(bench, p, entrySources(p, false)));

export const allLit = (p: Puzzle, t: TraceResult, real = true): boolean =>
  p.crystals.length > 0 &&
  p.crystals.every((c, i) => glowOf(c, t.real[i] ?? 0, real ? 0 : (t.guide[i] ?? 0)) > 0);

export const litCount = (p: Puzzle, t: TraceResult): number =>
  p.crystals.reduce((n, c, i) => n + (glowOf(c, t.real[i] ?? 0, t.guide[i] ?? 0) > 0 ? 1 : 0), 0);

/** The tray a piece goes back to: by kind, on the half its solution socket is in. */
export const trayFor = (bench: BenchLayout, kind: PieceKind, half: number): number => {
  const child = isChildKind(kind);
  let i = bench.trays.findIndex((t) => t.child === child && t.half === half);
  if (i < 0) i = bench.trays.findIndex((t) => t.child === child);
  return Math.max(0, i);
};
