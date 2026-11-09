/**
 * The screen's pipes. Each touch panel of the bank below has a riser that comes in at the
 * screen's bottom edge right above it. The risers join a header along the bottom of the screen,
 * which has a lane each way so balls heading left and right never meet head on. From the header
 * one branch per tube climbs beside it and hooks over into its mouth. A ball comes up its panel's
 * riser, turns into the lane towards its tube, and leaves the header up its answer's branch.
 * Risers and the header carry every answer, so they're neutral; branches wear their answer's
 * colour, so the last part of the trip says where the ball is going.
 *
 * Junctions are booked through transit.ts: every place two balls' ways can meet (a riser joining
 * a lane, a ball crossing the other lane, a branch's foot) is a node shared by the ways through it.
 */
import type { Block, PipeDef, Way } from "./layout";
import { filleted, type Pt, type Spout, spoutPoints } from "./pipes";
import type { NodeSpot } from "./transit";

export interface NetworkInput {
  W: number;
  H: number;
  blocks: readonly Block[];
  /** x of each panel's riser where it meets the bottom edge. */
  inlets: readonly number[];
  pipe: { inner: number; wall: number; outer: number; r: number };
  header: { inner: number; wall: number };
  /** Centre line of the header. */
  yHeader: number;
}

export interface Network {
  readonly pipes: PipeDef[];
  readonly inlets: readonly number[];
  readonly yHeader: number;
  /** Lane centre lines: rightward balls run in the upper one. */
  readonly lanes: { up: number; down: number };
  /** The way from inlet `inlet` to answer `answer` of block `block`, or null. */
  way(inlet: number, block: number, answer: number): Way | null;
  /** The inlet nearest to `x`. */
  nearest(x: number): number;
}

export const buildNetwork = (d: NetworkInput): Network => {
  const { H, blocks, inlets, pipe, header, yHeader } = d;
  const off = header.inner * 0.25;
  const up = yHeader - off;
  const down = yHeader + off;
  const headerTop = yHeader - header.inner / 2 - header.wall;
  const bendNet = pipe.outer * 0.6;

  const spoutXs = blocks.flatMap((b) => b.spouts.map((s) => s.x));
  const keys = [...new Set([...inlets, ...spoutXs].map((x) => Math.round(x)))].sort(
    (a, b) => a - b,
  );
  const keyOf = (x: number) => {
    let best = 0;
    for (let k = 1; k < keys.length; k++)
      if (Math.abs(keys[k]! - x) < Math.abs(keys[best]! - x)) best = k;
    return best;
  };

  const pipes: PipeDef[] = [];
  const xs = [...inlets, ...spoutXs];
  const x0 = Math.min(...xs) - pipe.outer;
  const x1 = Math.max(...xs) + pipe.outer;
  pipes.push({
    path: filleted(
      [
        { x: x0, y: yHeader },
        { x: x1, y: yHeader },
      ],
      0,
    ),
    inner: header.inner,
    wall: header.wall,
    color: -1,
    intake: false,
    outlet: false,
  });
  for (const x of inlets) {
    pipes.push({
      path: filleted(
        [
          { x, y: H + pipe.outer },
          { x, y: yHeader },
        ],
        0,
      ),
      inner: pipe.inner,
      wall: pipe.wall,
      color: -1,
      intake: false,
      outlet: false,
    });
  }
  for (const b of blocks) {
    for (const s of b.spouts) {
      const { pts, radii } = spoutPoints(s, { x: s.x, y: yHeader });
      pipes.push({
        path: filleted(pts, radii),
        inner: s.inner,
        wall: s.wall,
        color: s.answer,
        intake: false,
        outlet: true,
      });
    }
  }

  const ways = new Map<string, Way | null>();
  const make = (inlet: number, bi: number, answer: number): Way | null => {
    const xc = inlets[inlet];
    const s: Spout | undefined = blocks[bi]?.spouts.find((x) => x.answer === answer);
    if (xc === undefined || !s) return null;
    const right = s.x >= xc;
    const lane = right ? up : down;
    const tail = spoutPoints(s, { x: s.x, y: lane });
    const pts: Pt[] = [{ x: xc, y: H + pipe.r * 1.3 }, { x: xc, y: lane }, ...tail.pts];
    const radii = [0, bendNet, bendNet, ...tail.radii.slice(1)];
    const nodes: NodeSpot[] = [{ id: `i${inlet}`, x: xc, y: H + pipe.r * 1.3 }];
    const lo = Math.min(xc, s.x) - 0.5;
    const hi = Math.max(xc, s.x) + 0.5;
    for (const [k, x] of keys.entries()) {
      if (x >= lo && x <= hi) nodes.push({ id: `${right ? "U" : "L"}${k}`, x, y: lane });
    }
    // The lane it crosses: on the way up from its riser, or on the way into its branch.
    if (right) nodes.push({ id: `L${keyOf(xc)}`, x: xc, y: down });
    else nodes.push({ id: `U${keyOf(s.x)}`, x: s.x, y: up });
    nodes.push({ id: `b${bi}.${answer}`, x: s.x, y: headerTop });
    return { path: filleted(pts, radii), nodes, r: pipe.r, lands: true };
  };

  return {
    pipes,
    inlets,
    yHeader,
    lanes: { up, down },
    way(inlet, bi, answer) {
      const key = `${inlet}:${bi}:${answer}`;
      if (!ways.has(key)) ways.set(key, make(inlet, bi, answer));
      return ways.get(key) ?? null;
    },
    nearest(x) {
      let best = 0;
      for (let k = 1; k < inlets.length; k++)
        if (Math.abs(inlets[k]! - x) < Math.abs(inlets[best]! - x)) best = k;
      return best;
    },
  };
};
