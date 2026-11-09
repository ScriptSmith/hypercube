/**
 * Puzzle generation. Each puzzle is built from a random stream by placing a solution (pieces in
 * sockets at detent turns, one step at a time, tracing as it goes), putting crystals on the
 * traced beams where the solution needs them, and then scrambling: turning pieces and putting
 * some back in their trays. A puzzle is thrown away if it is solved after scrambling, if any
 * crystal glows before a piece is placed, or if the solution misses a piece or a crystal.
 *
 * On a bank, each frame's puzzle starts from the light the frame to its left sends in when it is
 * solved, and must send light on through its right edge. A fixed splitter near the right edge
 * also sends light up through the top edge, to the screen above.
 */
import { createRng } from "../../core/rng";
import type { Rng } from "../../core/types";
import type { BenchLayout } from "./layout";
import {
  DETENTS,
  isChildKind,
  type PieceKind,
  SKY_SCALE,
  STEP,
  normDetent,
  sameTurn,
  symmetryOf,
} from "./pieces";
import {
  type BeamOut,
  type Crystal,
  type Fixed,
  type Lamp,
  type LampKind,
  type LevelId,
  NEED,
  NEED_SMALL,
  type PieceDef,
  type Place,
  type Puzzle,
  allLit,
  tracePlaces,
} from "./puzzle";
import { BAND_BITS, type Band, type ColourBand, COLOUR_BANDS, WHITE, bandOf } from "./spectrum";
import { EDGE_RIGHT, EDGE_TOP, type Seg, type TraceResult, glowOf, segDist2 } from "./trace";

/** Levels a bank uses: lenses need a wide lamp, which only the first frame has. */
export const BANK_RAMP: readonly LevelId[] = ["m1", "m2", "filter", "split", "prism"];
export const BANK_PLAIN: readonly LevelId[] = ["m1", "m2", "split"];

export interface BankSpec {
  /** Light expected in through the left edge; null on the first frame, which has the lamp. */
  entry: BeamOut[] | null;
  /** The last frame of the bank: nothing has to leave through its right edge. */
  last: boolean;
}

export interface GenSpec {
  bench: BenchLayout;
  level: LevelId;
  /** Label of the random stream: the same label always gives the same puzzle. */
  seed: string;
  colour: boolean;
  bank: BankSpec | null;
}

const ATTEMPTS = 160;

/** Easier levels to fall back on, in order. */
const fallbacks = (level: LevelId, colour: boolean, bank: boolean): LevelId[] => {
  const order: LevelId[] = ["spread", "lens", "prism", "split", "filter", "m2", "m1"];
  const i = order.indexOf(level);
  return order.slice(i).filter((l) => {
    if (!colour && (l === "filter" || l === "prism")) return false;
    if (bank && (l === "lens" || l === "spread")) return false;
    return true;
  });
};

interface Draft {
  lamps: Lamp[];
  entry: BeamOut[];
  pieces: PieceDef[];
  places: Place[];
  fixed: Fixed[];
  crystals: Crystal[];
}

const toPuzzle = (level: LevelId, d: Draft, start: Place[] = d.places): Puzzle => ({
  level,
  lamps: d.lamps,
  crystals: d.crystals,
  fixed: d.fixed,
  pieces: d.pieces,
  solution: d.places,
  start,
  entry: d.entry,
  exits: [],
  sky: [],
  fallback: false,
});

const segLen = (s: Seg) => Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
const dirOf = (s: Seg): [number, number] => {
  const l = segLen(s) || 1;
  return [(s.x1 - s.x0) / l, (s.y1 - s.y0) / l];
};

const shuffle = <T>(rng: Rng, xs: T[]): T[] => {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [xs[i], xs[j]] = [xs[j]!, xs[i]!];
  }
  return xs;
};

const uniqueTurns = (kind: PieceKind | "sky"): number[] =>
  Array.from({ length: symmetryOf(kind) }, (_, i) => i);

class Gen {
  readonly R: number;
  readonly rc: number;
  constructor(
    readonly spec: GenSpec,
    readonly rng: Rng,
    readonly level: LevelId,
  ) {
    this.R = spec.bench.sizes.piece;
    this.rc = spec.bench.sizes.crystal;
  }

  get bench() {
    return this.spec.bench;
  }

  traceDraft(d: Draft): TraceResult {
    return tracePlaces(this.bench, toPuzzle(this.level, d), d.places);
  }

  /** Segments of real light leaving body `b` (not running inside it). */
  outOf(t: TraceResult, b: number): Seg[] {
    return t.segs.filter((s) => s.from === b && s.to !== b && !s.guide);
  }

  /** Free sockets the light of `segs` passes close to the centre of, far enough along. */
  socketsNear(
    segs: readonly Seg[],
    used: ReadonlySet<number>,
    child: boolean,
    tol: number,
    minT = 2.2 * this.R,
  ): { socket: number; seg: Seg }[] {
    const out: { socket: number; seg: Seg; w: number }[] = [];
    const R = this.R;
    this.bench.sockets.forEach((s, i) => {
      if (used.has(i)) return;
      for (const seg of segs) {
        const len = segLen(seg);
        const [dx, dy] = dirOf(seg);
        const t = (s.x - seg.x0) * dx + (s.y - seg.y0) * dy;
        if (t < minT || t > len + R * 0.2) continue;
        const d = Math.abs((s.x - seg.x0) * dy - (s.y - seg.y0) * dx);
        if (d > tol) continue;
        out.push({ socket: i, seg, w: s.child === child ? 3 : 1 });
        return;
      }
    });
    const pick: { socket: number; seg: Seg }[] = [];
    // Weighted shuffle: preferred-band sockets come first more often.
    const pool = [...out];
    while (pool.length > 0) {
      const total = pool.reduce((n, c) => n + c.w, 0);
      let r = this.rng.next() * total;
      let k = 0;
      for (; k < pool.length - 1; k++) {
        r -= pool[k]!.w;
        if (r <= 0) break;
      }
      pick.push(pool[k]!);
      pool.splice(k, 1);
    }
    return pick;
  }

  /** True when a point is clear of sockets, trays, controls, lamps, fixed parts and crystals. */
  clear(x: number, y: number, r: number, d: Draft, socketGap?: number): boolean {
    const b = this.bench.box;
    const R = this.R;
    if (x < b.x + r + 16 || x > b.x + b.width - r - 16) return false;
    if (y < b.y + r + 16 || y > b.y + b.height - r - 16) return false;
    for (const k of this.bench.keepOut) {
      if (x > k.x - r && x < k.x + k.width + r && y > k.y - r && y < k.y + k.height + r)
        return false;
    }
    const gap = socketGap ?? R + r * 0.5;
    for (const s of this.bench.sockets) if (Math.hypot(s.x - x, s.y - y) < gap) return false;
    for (const l of d.lamps)
      if (Math.hypot(l.x - x, l.y - y) < this.bench.sizes.lamp + r) return false;
    for (const f of d.fixed) {
      if (Math.hypot(f.x - x, f.y - y) < (f.kind === "sky" ? SKY_SCALE * R : R) + r) return false;
    }
    for (const c of d.crystals)
      if (Math.hypot(c.x - x, c.y - y) < 2.6 * Math.max(r, c.r)) return false;
    return true;
  }

  /** A clear point on a segment between `t0` and its end; higher points preferred when asked. */
  pointOn(
    seg: Seg,
    r: number,
    d: Draft,
    opts: { t0?: number; tail?: number; high?: boolean; socketGap?: number } = {},
  ): { x: number; y: number; t: number } | null {
    const len = segLen(seg);
    const [dx, dy] = dirOf(seg);
    const t0 = opts.t0 ?? 1.7 * this.R;
    const t1 = len - (opts.tail ?? r + 12);
    const ok: { x: number; y: number; t: number }[] = [];
    for (let t = t0; t <= t1; t += 14) {
      const x = seg.x0 + dx * t;
      const y = seg.y0 + dy * t;
      if (this.clear(x, y, r, d, opts.socketGap)) ok.push({ x, y, t });
    }
    if (ok.length === 0) return null;
    if (opts.high) {
      const top = this.bench.reachTop;
      const high = ok.filter((p) => p.y < top - r * 2);
      if (high.length > 0) return high[this.rng.int(high.length)]!;
      ok.sort((a, b) => a.y - b.y);
      return ok[this.rng.int(Math.max(1, Math.ceil(ok.length / 3)))]!;
    }
    return ok[this.rng.int(ok.length)]!;
  }

  /**
   * Place a piece at a socket on the light in `segs`, at a turn whose output runs a fair way
   * across the bench. Returns its index, or -1.
   */
  placePiece(
    d: Draft,
    kind: PieceKind,
    segs: readonly Seg[],
    band?: ColourBand,
    opts: {
      aimed?: number;
      turn?: number;
      upward?: boolean;
      minOut?: number;
      /** Only turns whose light out passes this test. */
      want?: (out: readonly Seg[]) => boolean;
    } = {},
  ): number {
    const used = new Set(d.places.map((p) => p.socket ?? -1));
    const tol = kind === "prism" ? 0.3 * this.R : 0.42 * this.R;
    const options =
      opts.aimed !== undefined
        ? [{ socket: opts.aimed }]
        : this.socketsNear(
            segs,
            used,
            isChildKind(kind),
            tol,
            segs.every((g) => g.from === -1) && this.spec.bank?.entry ? 1.1 * this.R : undefined,
          ).slice(0, 6);
    const idx = d.pieces.length;
    for (const o of options) {
      const turns = opts.turn !== undefined ? [opts.turn] : shuffle(this.rng, uniqueTurns(kind));
      const good: { turn: number; score: number }[] = [];
      for (const turn of turns) {
        const trial: Draft = {
          ...d,
          pieces: [...d.pieces, { kind, band }],
          places: [...d.places, { socket: o.socket, turn }],
        };
        const t = this.traceDraft(trial);
        if (t.truncated || (t.hits[idx] ?? 0) === 0) continue;
        const out = this.outOf(t, idx);
        if (out.length === 0) continue;
        const longest = Math.max(...out.map(segLen));
        if (longest < (opts.minOut ?? 2.6 * this.R)) continue;
        if (
          kind === "splitter" &&
          (out.length < 2 || Math.min(...out.map(segLen)) < 2.4 * this.R)
        ) {
          continue;
        }
        if (opts.want && !opts.want(out)) continue;
        // Light bounced almost straight back is no fun to follow.
        const inc = segs[0];
        if (inc && kind === "mirror") {
          const [ix, iy] = dirOf(inc);
          const [ox, oy] = dirOf(out[0]!);
          if (ix * ox + iy * oy < -0.9) continue;
        }
        let score = longest;
        if (opts.upward) score += Math.max(0, -dirOf(out[0]!)[1]) * 3000;
        // A bank's light runs on to the right, into the sky lane.
        if (this.spec.bank) score += Math.max(0, dirOf(out[0]!)[0]) * 2000;
        good.push({ turn, score });
        if (good.length >= 6 && !opts.upward && !this.spec.bank) break;
      }
      if (good.length === 0) continue;
      good.sort((a, b) => b.score - a.score);
      const choice = opts.upward
        ? good[this.rng.int(Math.min(2, good.length))]!
        : good[this.rng.int(Math.min(4, good.length))]!;
      d.pieces.push({ kind, band });
      d.places.push({ socket: o.socket, turn: choice.turn });
      return idx;
    }
    return -1;
  }

  /** A lamp at one of the bench's spots, aimed at the centre of a socket. */
  aimLamp(d: Draft, kind: LampKind, firstKind: PieceKind, band?: ColourBand): number | null {
    // A lens works best square to its bundle, and a bank's mirrors must be able to send the
    // light on level with the sockets: aim along whole detents (or pairs of them).
    const quantum = kind === "wide" ? STEP : this.spec.bank ? 2 * STEP : 0;
    const spots = this.bench.lampSpots
      .map((s, i) => ({ ...s, i }))
      .filter((s) => !this.spec.bank || s.side === "l");
    const pairs: { spot: number; socket: number; angle: number; w: number }[] = [];
    const R = this.R;
    for (const s of spots) {
      this.bench.sockets.forEach((k, i) => {
        const dx = k.x - s.x;
        const dy = k.y - s.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 2.4 * R) return;
        const inward = s.side === "l" ? dx / dist : -dx / dist;
        if (inward < 0.55) return;
        let angle = Math.atan2(dy, dx);
        if (quantum > 0) {
          const q = Math.round(angle / quantum) * quantum;
          if (Math.abs(q - angle) * dist > 0.12 * R) return;
          angle = q;
        }
        const w = k.child === isChildKind(firstKind) ? 3 : 1;
        pairs.push({ spot: s.i, socket: i, angle, w });
      });
    }
    if (pairs.length === 0) return null;
    const total = pairs.reduce((n, p) => n + p.w, 0);
    let r = this.rng.next() * total;
    let pick = pairs[0]!;
    for (const p of pairs) {
      r -= p.w;
      if (r <= 0) {
        pick = p;
        break;
      }
    }
    const spot = this.bench.lampSpots[pick.spot]!;
    d.lamps.push({ kind, x: spot.x, y: spot.y, angle: pick.angle, band, spot: pick.spot });
    return pick.socket;
  }

  /** The light the first piece has to catch: from the lamp, or in through the left edge. */
  firstLight(d: Draft): Seg[] {
    const t = this.traceDraft(d);
    return t.segs.filter((s) => s.from === -1 && !s.guide);
  }

  addCrystal(d: Draft, at: { x: number; y: number }, band: Band, small = false): void {
    const r = small ? this.bench.sizes.small : this.rc;
    d.crystals.push({ x: at.x, y: at.y, r, band, need: small ? NEED_SMALL : NEED, small });
  }

  /** A crystal on the longest segment of `segs`, of the light's own band or white. */
  crystalOn(d: Draft, segs: readonly Seg[], opts: { high?: boolean; band?: Band } = {}): boolean {
    const sorted = [...segs].sort((a, b) => segLen(b) - segLen(a));
    for (const seg of sorted) {
      const at = this.pointOn(seg, this.rc, d, { high: opts.high });
      if (!at) continue;
      const band = opts.band ?? this.bandFor(seg.bits);
      this.addCrystal(d, at, band);
      return true;
    }
    return false;
  }

  bandFor(bits: number): Band {
    const b = bandOf(bits);
    if (b === "w" || !this.spec.colour) return "w";
    return this.rng.next() < 0.75 ? b : "w";
  }

  get wall(): boolean {
    return this.bench.kind === "wall";
  }

  lampKind(): { kind: LampKind; band?: ColourBand } {
    if (this.spec.colour && this.rng.next() < 0.35) {
      return { kind: "laser", band: this.rng.pick(COLOUR_BANDS) };
    }
    return { kind: "white" };
  }

  /** Light that the first piece catches: a lamp aimed at its socket, or the entry light. */
  start(
    d: Draft,
    kind: LampKind,
    first: PieceKind,
    band?: ColourBand,
  ): {
    segs: Seg[];
    aimed?: number;
  } | null {
    if (this.spec.bank?.entry) {
      d.entry = this.spec.bank.entry;
      const segs = this.firstLight(d);
      return segs.length > 0 ? { segs } : null;
    }
    const socket = this.aimLamp(d, kind, first, band);
    if (socket === null) return null;
    return { segs: this.firstLight(d), aimed: socket };
  }

  attempt(): Puzzle | null {
    if (this.spec.bank) return this.attemptBank();
    const d: Draft = { lamps: [], entry: [], pieces: [], places: [], fixed: [], crystals: [] };
    const bank = this.spec.bank;
    const rng = this.rng;
    // On the wall the last piece sends light up to a crystal high above the bench.
    const up = this.wall;
    let finalSegs: Seg[] = [];
    // Crystals to place after a bank's sky splitter is in, so they sit before it.
    const plans: (() => boolean)[] = [];

    switch (this.level) {
      case "m1":
      case "m2": {
        const lk = this.lampKind();
        const s = this.start(d, lk.kind, "mirror", lk.band);
        if (!s) return null;
        const two = this.level === "m2";
        const a = this.placePiece(d, "mirror", s.segs, undefined, {
          aimed: s.aimed,
          upward: up && !two,
        });
        if (a < 0) return null;
        let out = this.outOf(this.traceDraft(d), a);
        if (two) {
          const b = this.placePiece(d, "mirror", out, undefined, { upward: up });
          if (b < 0) return null;
          const t = this.traceDraft(d);
          const mid = this.outOf(t, a);
          out = this.outOf(t, b);
          if (rng.next() < 0.45) plans.push(() => this.crystalOn(d, mid) || true);
        }
        finalSegs = out;
        plans.push(() => this.crystalOn(d, finalSegs, { high: this.wall || !bank }));
        if (rng.next() < 0.3) plans.push(() => this.crystalOn(d, finalSegs) || true);
        break;
      }
      case "filter": {
        const s = this.start(d, "white", "mirror");
        if (!s) return null;
        let segs = s.segs;
        let aimed = s.aimed;
        let before: Seg[] | null = null;
        if (rng.next() < 0.5) {
          const m = this.placePiece(d, "mirror", segs, undefined, { aimed });
          if (m < 0) return null;
          segs = this.outOf(this.traceDraft(d), m);
          before = segs;
          aimed = undefined;
        }
        const band = rng.pick(this.presentBands(segs));
        if (!band) return null;
        const f = this.placePiece(d, "filter", segs, band, { aimed, upward: up });
        if (f < 0) return null;
        const t = this.traceDraft(d);
        finalSegs = this.outOf(t, f);
        if (before && rng.next() < 0.5) {
          const into = this.outOf(t, f - 1);
          plans.push(() => this.crystalOn(d, into, { band: "w" }) || true);
        }
        plans.push(() => this.crystalOn(d, finalSegs, { band, high: !bank }));
        break;
      }
      case "split": {
        const lk = this.lampKind();
        const s = this.start(d, lk.kind, "splitter", lk.band);
        if (!s) return null;
        const sp = this.placePiece(d, "splitter", s.segs, undefined, { aimed: s.aimed });
        if (sp < 0) return null;
        const branches = this.outOf(this.traceDraft(d), sp).filter((g) => segLen(g) > 2.4 * this.R);
        if (branches.length < 2) return null;
        const k = rng.int(2);
        const m = this.placePiece(d, "mirror", [branches[k]!], undefined, { upward: up });
        if (m < 0) return null;
        const t = this.traceDraft(d);
        const other = this.outOf(t, sp).filter((g) => g.to !== m);
        finalSegs = this.outOf(t, m);
        plans.push(() => this.crystalOn(d, other));
        plans.push(() => this.crystalOn(d, finalSegs, { high: !bank }));
        break;
      }
      case "prism": {
        const s = this.start(d, "white", "prism");
        if (!s) return null;
        let segs = s.segs;
        let aimed = s.aimed;
        if (rng.next() < 0.4) {
          const m = this.placePiece(d, "mirror", segs, undefined, { aimed });
          if (m < 0) return null;
          segs = this.outOf(this.traceDraft(d), m);
          aimed = undefined;
        }
        if (segs.some((g) => (g.bits & (g.bits - 1)) === 0)) return null;
        const p = this.placePiece(d, "prism", segs, undefined, { aimed, minOut: 3.5 * this.R });
        if (p < 0) return null;
        const out = this.outOf(this.traceDraft(d), p);
        const bands = this.presentBands(out);
        if (bands.length < 2) return null;
        const pair = bands.includes("r") && bands.includes("b") ? (["r", "b"] as const) : bands;
        finalSegs = out;
        const want: ColourBand[] = shuffle(rng, [...pair]).slice(0, 2);
        for (const b of want) {
          plans.push(() => {
            const rays = out.filter((g) => g.bits && (g.bits & ~BAND_BITS[b]) === 0);
            const far = rays.map((g) => ({ ...g })).sort((a, c) => segLen(c) - segLen(a));
            for (const g of far) {
              const at = this.pointOn(g, this.rc, d, {
                t0: Math.max(2 * this.R, segLen(g) * 0.45),
              });
              if (at) {
                this.addCrystal(d, at, b);
                return true;
              }
            }
            return false;
          });
        }
        break;
      }
      case "lens":
      case "spread": {
        const kind: PieceKind = this.level === "lens" ? "convex" : "concave";
        const s = this.start(d, "wide", kind);
        if (!s || s.aimed === undefined) return null;
        const lamp = d.lamps[0]!;
        const turn = normDetent(Math.round(lamp.angle / STEP)) % (DETENTS / 2);
        const l = this.placePiece(d, kind, s.segs, undefined, {
          aimed: s.aimed,
          turn,
          minOut: 2 * this.R,
        });
        if (l < 0) return null;
        const out = this.outOf(this.traceDraft(d), l);
        if (out.length < 4) return null;
        finalSegs = out;
        if (kind === "convex") plans.push(() => this.focusCrystal(d, out));
        else plans.push(() => this.spreadCrystals(d, out, lamp));
        break;
      }
    }

    if (bank) {
      if (!this.skySplitter(d, finalSegs)) return null;
      // The last piece's light now stops at the splitter, so its crystals go before it.
      finalSegs = this.outOf(this.traceDraft(d), d.pieces.length - 1);
    }
    for (const p of plans) if (!p()) return null;
    if (d.crystals.length === 0) return null;
    return this.finish(d);
  }

  /**
   * A bank frame: the main line takes the light in (from the lamp on the first frame, through
   * the left edge on the others) and sends it level and to the right into the sky lane, so it
   * leaves on a socket row and the next frame's sockets line up with it. The first frame's
   * lamp needs one mirror; light coming in level needs two (a periscope), or a filter in line.
   * Splitter levels take a branch off the main line for the colour or the second crystal.
   */
  attemptBank(): Puzzle | null {
    const d: Draft = { lamps: [], entry: [], pieces: [], places: [], fixed: [], crystals: [] };
    const rng = this.rng;
    const R = this.R;
    const level = this.level;
    const level0 = (g: Seg) => dirOf(g)[0] > 0.995 && segLen(g) > 1.5 * R;
    const isLevel = (out: readonly Seg[]) => out.some(level0);
    const lk =
      level === "filter" || level === "prism" ? { kind: "white" as const } : this.lampKind();
    const branchy = level === "split" || level === "prism";
    const first: PieceKind = branchy && this.spec.bank?.entry ? "splitter" : "mirror";
    const s = this.start(d, lk.kind, first, lk.band);
    if (!s) return null;
    let main = s.segs;
    const plans: (() => boolean)[] = [];

    const periscope = (aimed?: number): boolean => {
      if (main.some(level0)) {
        // Up or down a column of sockets, to be brought level again further along.
        const a = this.placePiece(d, "mirror", main, undefined, {
          aimed,
          want: (out) => out.some((g) => Math.abs(dirOf(g)[0]) < 0.3),
        });
        if (a < 0) return false;
        main = this.outOf(this.traceDraft(d), a);
        aimed = undefined;
        if (rng.next() < 0.5) {
          const leg = main;
          plans.push(() => this.crystalOn(d, leg) || true);
        }
      }
      const b = this.placePiece(d, "mirror", main, undefined, { aimed, want: isLevel });
      if (b < 0) return false;
      main = this.outOf(this.traceDraft(d), b).filter(level0);
      return main.length > 0;
    };

    switch (level) {
      case "m1":
      case "m2": {
        if (!periscope(s.aimed)) return null;
        if (level === "m2" && d.pieces.length < 2) {
          // The lamp's light, made level, is taken up and brought down again.
          const two = this.placePiece(d, "mirror", main, undefined, {
            want: (out) => out.some((g) => Math.abs(dirOf(g)[0]) < 0.9),
          });
          if (two < 0) return null;
          main = this.outOf(this.traceDraft(d), two);
          const b = this.placePiece(d, "mirror", main, undefined, { want: isLevel });
          if (b < 0) return null;
          main = this.outOf(this.traceDraft(d), b).filter(level0);
        }
        break;
      }
      case "filter":
      case "split":
      case "prism": {
        // Level light is first turned up or down a column; the splitter then sends half on level
        // along another row and half on as a branch, so a block can stop unsolved light.
        let aimed = s.aimed;
        if (main.some(level0)) {
          const a = this.placePiece(d, "mirror", main, undefined, {
            aimed,
            want: (out) => out.some((g) => Math.abs(dirOf(g)[0]) < 0.3),
          });
          if (a < 0) return null;
          main = this.outOf(this.traceDraft(d), a);
          aimed = undefined;
        }
        const sp = this.placePiece(d, "splitter", main, undefined, {
          aimed,
          want: (out) => out.some(level0) && out.some((g) => !level0(g) && segLen(g) > 2.4 * R),
        });
        if (sp < 0) return null;
        const outs = this.outOf(this.traceDraft(d), sp);
        const branch = outs.filter((g) => !level0(g));
        main = outs.filter(level0);
        if (level === "split") {
          const m = this.placePiece(d, "mirror", branch);
          if (m < 0) return null;
          const end = this.outOf(this.traceDraft(d), m);
          plans.push(() => this.crystalOn(d, end));
        } else if (level === "filter") {
          // The branch takes the colour, so the light running on to the next frame stays white.
          const band = rng.pick(this.presentBands(branch));
          if (!band) return null;
          const f = this.placePiece(d, "filter", branch, band);
          if (f < 0) return null;
          const end = this.outOf(this.traceDraft(d), f);
          plans.push(() => this.crystalOn(d, end, { band }));
        } else {
          if (branch.some((g) => (g.bits & (g.bits - 1)) === 0)) return null;
          const p = this.placePiece(d, "prism", branch, undefined, { minOut: 3.2 * R });
          if (p < 0) return null;
          const out = this.outOf(this.traceDraft(d), p);
          const bands = this.presentBands(out);
          if (bands.length < 2) return null;
          for (const b of shuffle(rng, [...bands]).slice(0, 2)) {
            plans.push(() => {
              const rays = out
                .filter((g) => g.bits && (g.bits & ~BAND_BITS[b]) === 0)
                .sort((a, c) => segLen(c) - segLen(a));
              for (const g of rays) {
                const at = this.pointOn(g, this.rc, d, { t0: Math.max(2 * R, segLen(g) * 0.4) });
                if (at) {
                  this.addCrystal(d, at, b);
                  return true;
                }
              }
              return false;
            });
          }
        }
        break;
      }
      default:
        return null;
    }
    if (main.length === 0 || !this.skySplitter(d, main)) return null;
    // The main line now stops at the sky splitter; its crystal sits before it.
    const last = this.outOf(this.traceDraft(d), d.pieces.length - 1).filter(level0);
    const onMain = last.length > 0 ? last : main;
    plans.unshift(() => this.crystalOn(d, onMain, { band: this.bandFor(onMain[0]?.bits ?? 0) }));
    for (const p of plans) if (!p()) return null;
    if (!this.blockStray(d)) return null;
    return this.finish(d);
  }

  /**
   * Light that crosses the bench untouched when no piece is placed would run on into the next
   * frame and light its crystals by accident: put a fixed block in its way, clear of the
   * solution's light.
   */
  blockStray(d: Draft): boolean {
    const R = this.R;
    const box = this.bench.box;
    const right = box.x + box.width - 1;
    for (let round = 0; round < 3; round++) {
      const p = toPuzzle(this.level, d);
      const empty = tracePlaces(
        this.bench,
        p,
        d.places.map((x) => ({ ...x, socket: null })),
      );
      const leak = empty.segs.find((g) => !g.guide && g.to === -1 && g.x1 >= right);
      if (!leak) return true;
      const len = segLen(leak);
      const [dx, dy] = dirOf(leak);
      let placed = false;
      for (let t = 1.4 * R; t < len - R && !placed; t += 16) {
        const x = leak.x0 + dx * t;
        const y = leak.y0 + dy * t;
        if (!this.clear(x, y, 0.72 * R, d, 1.6 * R)) continue;
        d.fixed.push({ kind: "block", x, y, turn: 0 });
        const sol = this.traceDraft(d);
        const ok =
          allLit(toPuzzle(this.level, d), sol) &&
          sol.exits.some((e) => e.edge === EDGE_TOP && !e.guide) &&
          (this.spec.bank?.last || sol.exits.some((e) => e.edge === EDGE_RIGHT && !e.guide));
        if (ok) placed = true;
        else d.fixed.pop();
      }
      if (!placed) return false;
    }
    return false;
  }

  presentBands(segs: readonly Seg[]): ColourBand[] {
    const out: ColourBand[] = [];
    for (const b of COLOUR_BANDS) {
      if (segs.some((g) => g.bits & BAND_BITS[b])) out.push(b);
    }
    return out;
  }

  /** The small crystal where most of a lens's bundle meets. */
  focusCrystal(d: Draft, out: readonly Seg[]): boolean {
    const small = this.bench.sizes.small;
    const mid = [...out].sort((a, b) => segLen(b) - segLen(a))[0]!;
    const [dx, dy] = dirOf(mid);
    let best: { x: number; y: number; n: number; spread: number } | null = null;
    for (let t = 0; t <= segLen(mid); t += 4) {
      const x = mid.x0 + dx * t;
      const y = mid.y0 + dy * t;
      let n = 0;
      let spread = 0;
      for (const g of out) {
        const dist = Math.sqrt(segDist2(g.x0, g.y0, g.x1, g.y1, x, y));
        if (dist <= small * 0.8) n++;
        spread = Math.max(spread, dist);
      }
      if (!best || n > best.n || (n === best.n && spread < best.spread)) best = { x, y, n, spread };
    }
    if (!best || best.n < 4) return false;
    if (!this.clear(best.x, best.y, small, d)) return false;
    this.addCrystal(d, best, "w", true);
    return true;
  }

  /** Crystals on the outer rays of a spread bundle, out of the straight bundle's way. */
  spreadCrystals(d: Draft, out: readonly Seg[], lamp: Lamp): boolean {
    const ax = Math.cos(lamp.angle);
    const ay = Math.sin(lamp.angle);
    const off = (g: Seg) => (g.x0 - lamp.x) * -ay + (g.y0 - lamp.y) * ax;
    const sorted = [...out].sort((a, b) => off(a) - off(b));
    const outer = [sorted[0]!, sorted[sorted.length - 1]!];
    const halfWidth = this.bench.sizes.bundle * 2;
    for (const g of outer) {
      const [dx, dy] = dirOf(g);
      let placed = false;
      for (let t = segLen(g) - this.rc - 12; t > 1.5 * this.R; t -= 14) {
        const x = g.x0 + dx * t;
        const y = g.y0 + dy * t;
        const side = Math.abs((x - lamp.x) * -ay + (y - lamp.y) * ax);
        if (side < halfWidth + this.rc * 2) break;
        if (!this.clear(x, y, this.rc, d)) continue;
        this.addCrystal(d, { x, y }, "w");
        placed = true;
        break;
      }
      if (!placed) return false;
    }
    return true;
  }

  /**
   * A bank's fixed splitter in the sky lane, where the last piece's light crosses it heading
   * right: half carries on through the right edge, half is turned up through the top edge.
   */
  skySplitter(d: Draft, segs: readonly Seg[]): boolean {
    const R = this.R;
    const lane = this.bench.skyLane;
    if (lane === null) return false;
    for (const seg of shuffle(this.rng, [...segs])) {
      const [dx, dy] = dirOf(seg);
      if (dx < 0.5) continue;
      const t = (lane - seg.x0) / dx;
      if (t < 1.5 * R || t > segLen(seg) - 4) continue;
      const at = { x: lane, y: seg.y0 + dy * t };
      if (at.y < this.bench.reachTop + 1.2 * R) continue;
      if (!this.clear(at.x, at.y, R * SKY_SCALE, d, R * (1 + SKY_SCALE))) continue;
      for (const turn of shuffle(this.rng, uniqueTurns("sky"))) {
        const a = turn * STEP;
        // The splitter's face normal at this turn, and the light reflected off it.
        const nx = Math.sin(a);
        const ny = -Math.cos(a);
        const k = 2 * (dx * nx + dy * ny);
        // Straight up, so each frame's beam rises above it into the screen.
        if (dy - k * ny > -0.99) continue;
        const trial: Draft = { ...d, fixed: [...d.fixed, { kind: "sky", x: at.x, y: at.y, turn }] };
        const tr = this.traceDraft(trial);
        if (tr.truncated) continue;
        const up = tr.exits.some((e) => e.edge === EDGE_TOP && !e.guide);
        const on = tr.exits.some((e) => e.edge === EDGE_RIGHT && !e.guide);
        if (!up || !on) continue;
        d.fixed.push({ kind: "sky", x: at.x, y: at.y, turn });
        return true;
      }
    }
    return false;
  }

  /** Check the solution, the empty bench and the scramble, and fill in exits. */
  finish(d: Draft): Puzzle | null {
    const level = this.level;
    const sol = this.traceDraft(d);
    if (sol.truncated) return null;
    const p = toPuzzle(level, d);
    if (!allLit(p, sol)) return null;
    for (let i = 0; i < d.pieces.length; i++) if ((sol.hits[i] ?? 0) === 0) return null;
    // Every piece is needed: without any one of them, some crystal goes dark.
    for (let i = 0; i < d.pieces.length; i++) {
      const without = d.places.map((x, k) => (k === i ? { ...x, socket: null } : x));
      if (allLit(p, tracePlaces(this.bench, p, without))) return null;
    }
    const empty = tracePlaces(
      this.bench,
      p,
      d.places.map((x) => ({ ...x, socket: null })),
    );
    if (d.crystals.some((c, i) => glowOf(c, empty.real[i] ?? 0, 0) > 0)) return null;
    const start = this.scramble(d);
    if (!start) return null;
    const exits = sol.exits
      .filter((e) => e.edge === EDGE_RIGHT && !e.guide)
      .map((e) => ({ x: e.x, y: e.y, dx: e.dx, dy: e.dy, bits: e.bits, level: e.level }));
    const sky = sol.exits
      .filter((e) => e.edge === EDGE_TOP && !e.guide)
      .map((e) => ({ x: e.x, y: e.y, dx: e.dx, dy: e.dy, bits: e.bits, level: e.level }));
    const bank = this.spec.bank;
    if (bank && !bank.last) {
      const H = this.bench.box.height;
      if (exits.length === 0 || exits.length > 4) return null;
      for (const e of exits) {
        if (e.y < this.bench.reachTop + H * 0.18 || e.y > H * 0.86) return null;
        if (Math.abs(e.dy) > 0.6) return null;
      }
    }
    if (bank && sky.length === 0) return null;
    return { ...p, start, exits, sky };
  }

  scramble(d: Draft): Place[] | null {
    const n = d.pieces.length;
    const rng = this.rng;
    const neat = (kind: PieceKind, sol: number) => {
      for (const t of [0, 6, 3, 9]) if (!sameTurn(kind, t, sol)) return t;
      return 1;
    };
    const wrong = (kind: PieceKind, sol: number) => {
      const offsets = shuffle(rng, [2, 3, 4, 5, 6, 7, 8, 9, -2, -3, -4, -5, -6, -7, -8, -9]);
      for (const o of offsets) {
        const t = normDetent(sol + o);
        if (!sameTurn(kind, t, sol)) return t;
      }
      return normDetent(sol + 1);
    };
    const p = toPuzzle(this.level, d);
    for (let attempt = 0; attempt < 12; attempt++) {
      const inTray = d.pieces.map(() => rng.next() < (n === 1 ? 0.5 : 0.62));
      if (n >= 2 && !inTray.some(Boolean)) inTray[rng.int(n)] = true;
      const start = d.pieces.map((pc, i): Place => {
        const sol = d.places[i]!;
        if (inTray[i]) return { socket: null, turn: neat(pc.kind, sol.turn) };
        return { socket: sol.socket, turn: wrong(pc.kind, sol.turn) };
      });
      if (!allLit(p, tracePlaces(this.bench, p, start))) return start;
    }
    const all = d.pieces.map((pc, i): Place => ({
      socket: null,
      turn: neat(pc.kind, d.places[i]!.turn),
    }));
    return allLit(p, tracePlaces(this.bench, p, all)) ? null : all;
  }
}

/**
 * Light coming in level along the socket row nearest the middle of the bench: what a bank frame
 * expects when the frame to its left has no light to hand on.
 */
export const defaultEntry = (bench: BenchLayout): BeamOut[] => {
  const rows = [...new Set(bench.sockets.map((s) => s.y))];
  const mid = bench.box.y + bench.box.height * 0.6;
  const y = rows.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a), rows[0] ?? mid);
  return [{ x: bench.box.x + 0.5, y, dx: 1, dy: 0, bits: WHITE, level: 1 }];
};

/** Generate the puzzle for a spec, falling back to easier levels if a level won't fit. */
export const generate = (spec: GenSpec): Puzzle => {
  const rng = createRng(spec.seed);
  const order = fallbacks(spec.level, spec.colour, spec.bank !== null);
  for (const level of order) {
    const g = new Gen(spec, rng, level);
    for (let i = 0; i < ATTEMPTS; i++) {
      const p = g.attempt();
      if (p) return { ...p, fallback: level !== spec.level };
    }
  }
  // Light from the left that nothing fits: start from level light along a row instead.
  if (spec.bank?.entry) {
    const fresh = generate({ ...spec, bank: { ...spec.bank, entry: defaultEntry(spec.bench) } });
    if (fresh.crystals.length > 0) return { ...fresh, fallback: true };
  }
  return emptyPuzzle(spec);
};

/** Nothing would fit: a lamp alone. Never expected; tests check every layout avoids it. */
const emptyPuzzle = (spec: GenSpec): Puzzle => {
  const spot = spec.bench.lampSpots[0];
  return {
    level: spec.level,
    lamps:
      spot && !spec.bank?.entry
        ? [{ kind: "white", x: spot.x, y: spot.y, angle: spot.side === "l" ? 0 : Math.PI, spot: 0 }]
        : [],
    crystals: [],
    fixed: [],
    pieces: [],
    solution: [],
    start: [],
    entry: spec.bank?.entry ?? [],
    exits: [],
    sky: [],
    fallback: true,
  };
};

/** The light a frame's solved puzzle sends into its right-hand neighbour, as that neighbour sees it. */
export const handOn = (exits: readonly BeamOut[], frameWidth: number): BeamOut[] => {
  const top = Math.max(0, ...exits.map((e) => e.level));
  if (top <= 0) return [];
  return exits.map((e) => ({ ...e, x: e.x - frameWidth + 0.5, level: e.level / top }));
};
