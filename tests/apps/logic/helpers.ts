import { type Bench, createBench } from "../../../src/apps/logic/bench";
import { ALL_GATES, BASIC_GATES, type Band, type PieceKind } from "../../../src/apps/logic/circuit";
import type { Variant } from "../../../src/apps/logic/config";
import { portsOf } from "../../../src/apps/logic/geometry";
import { type Layout, layoutFor, type LayoutInput } from "../../../src/apps/logic/layout";
import type { FrameKind } from "../../../src/core/types";
import { DEFAULT_VENUE, displayFor, reachFor } from "../../../src/core/venue";

export const KINDS = ["wall", "pair", "kiosk"] as const;

/** Venue size and default reach tops (adult, child) for a kind, from the venue profile. */
const sizeOf = (kind: FrameKind) => {
  const d = displayFor(kind, 2, DEFAULT_VENUE);
  const r = reachFor(d);
  return {
    width: d.width,
    height: d.height,
    adult: d.height * (1 - r.adult),
    child: d.height * (1 - r.child),
  };
};

export const layoutInput = (kind: FrameKind, over: Partial<LayoutInput> = {}): LayoutInput => {
  const s = sizeOf(kind);
  const benches = over.benches ?? (kind === "wall" ? 2 : 1);
  return {
    kind,
    width: s.width,
    height: s.height,
    reachTop: { adult: s.adult, child: s.child },
    seams: kind === "pair" ? [s.width / 2] : [],
    benches,
    posts: Array.from({ length: benches }, () => 2),
    goals: false,
    gates: ALL_GATES,
    ...over,
  };
};

export const layoutOf = (kind: FrameKind, over: Partial<LayoutInput> = {}): Layout =>
  layoutFor(layoutInput(kind, over));

/** An abstract bench's sockets: 8 child, 6 gates, 3 posts. */
export const SOCKETS: Band[] = [
  ...Array<Band>(8).fill("child"),
  ...Array<Band>(6).fill("adult"),
  ...Array<Band>(3).fill("post"),
];

export interface TestBench {
  bench: Bench;
  clock: { t: number };
  /** Advance the bench's time by `ms` in 1/60 s steps. */
  run(ms: number): void;
  /** A port's venue point. */
  port(piece: number, pin: number): { x: number; y: number };
  /** A finger drag in a few steps. */
  drag(from: { x: number; y: number }, to: { x: number; y: number }, id?: number): void;
  tap(at: { x: number; y: number }, id?: number): void;
}

export const benchOf = (
  kind: FrameKind = "pair",
  variant: Variant = "bench",
  gates: readonly PieceKind[] = ALL_GATES,
  over: Partial<LayoutInput> = {},
): TestBench => {
  const layout = layoutOf(kind, { goals: variant === "goals", gates, ...over });
  const clock = { t: 0 };
  const bench = createBench({ layout: layout.benches[0]!, variant, gates, now: () => clock.t });
  const run = (ms: number) => {
    const step = 1000 / 60;
    for (let t = 0; t < ms - 1e-6; t += step) {
      clock.t += step;
      bench.update(step);
    }
  };
  const port = (piece: number, pin: number) => {
    const p = bench.circuit.pieces.find((q) => q.id === piece);
    const q = p ? portsOf(bench.layout, p).find((x) => x.pin === pin) : undefined;
    if (!q) throw new Error(`no port ${piece}:${pin}`);
    return { x: q.x, y: q.y };
  };
  const drag = (from: { x: number; y: number }, to: { x: number; y: number }, id = 1) => {
    bench.down(id, from.x, from.y, true);
    for (let i = 1; i <= 8; i++) {
      bench.move(id, from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
    }
    bench.up(id, to.x, to.y);
  };
  const tap = (at: { x: number; y: number }, id = 1) => {
    bench.down(id, at.x, at.y, true);
    bench.up(id, at.x, at.y);
  };
  return { bench, clock, run, port, drag, tap };
};

export { ALL_GATES, BASIC_GATES };
