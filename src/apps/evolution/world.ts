/**
 * A frame's ponds and their family tree. It steps the ponds, keeps the lineage in step with
 * births, catches and deaths, passes migrants between neighbouring ponds on the same frame (a
 * wall's ponds, a pair's halves) and asks its owner to send them further (a bank). It also keeps
 * each pond's history for the tree: when its floor changed and how its fish looked on average.
 */
import type { Rng } from "../../core/types";
import { ATTRACT_FLOOR_S, type Config, HORIZON_MS, MIGRANT_CHAIN } from "./config";
import { type FloorId, type Genes, lookOf, meanGenes } from "./genes";
import { ancestorsOf, createLineage, type Lineage, type NodeRec, type TreeNode } from "./lineage";
import {
  arrive,
  type Catcher,
  catchNear,
  createFish,
  createPond,
  type Fish,
  genesOf,
  meanStandout,
  type Pond,
  type PondDeps,
  type PondEvent,
  type PondSpec,
  populate,
  setFloor,
  stepPond,
  turnBack,
} from "./pond";

/** Fish ids: the island in the high bits, a running count in the low 20. */
const SEQ = 1 << 20;
const MAX_ISLAND = 63;

export interface Band {
  /** Shared-clock ms each floor began, oldest first. */
  floors: { t: number; floor: FloorId }[];
  /** The pond's average fish colour, sampled every few seconds. */
  colors: { t: number; color: string }[];
}

const COLOR_EVERY_MS = 4000;
const MAX_FLOORS = 48;
const MAX_COLORS = Math.ceil(HORIZON_MS / COLOR_EVERY_MS) + 4;

export const createBand = (floor: FloorId, t: number): Band => ({
  floors: [{ t, floor }],
  colors: [],
});

export const noteFloor = (b: Band, floor: FloorId, t: number): void => {
  const last = b.floors[b.floors.length - 1];
  if (last && last.floor === floor) return;
  b.floors.push({ t, floor });
  // Keep the floor that was showing at the horizon, so the band reaches the top.
  while (b.floors.length > MAX_FLOORS || (b.floors.length > 1 && b.floors[1]!.t < t - HORIZON_MS)) {
    b.floors.shift();
  }
};

export const noteColor = (b: Band, genes: readonly Genes[], t: number): void => {
  const last = b.colors[b.colors.length - 1];
  if (last && t - last.t < COLOR_EVERY_MS) return;
  const mean = meanGenes(genes);
  if (!mean) return;
  b.colors.push({ t, color: lookOf(mean).body });
  while (b.colors.length > MAX_COLORS || (b.colors.length > 0 && b.colors[0]!.t < t - HORIZON_MS)) {
    b.colors.shift();
  }
};

/** A migrant as it travels: the fish, its remaining life and its nearest ancestors. */
export interface Migrant {
  fish: NodeRec;
  /** Seconds lived and lifespan. */
  age: number;
  life: number;
  /** 0 top to 1 bottom of the pond, where it left. */
  y: number;
  chain: NodeRec[];
}

export interface WorldOpts {
  specs: PondSpec[];
  config: Config;
  rng: Rng;
  /** Shared-clock ms. */
  stamp(): number;
  /** Tree nodes kept at most. */
  cap: number;
  /** Whether a pond's edge leads to a pond on another frame. */
  outside?(pond: number, edge: -1 | 1): boolean;
  /** Hand a migrant to another frame; false if nobody is there to take it. */
  emigrate?(pond: number, edge: -1 | 1, m: Migrant): boolean;
}

export interface WorldEvent {
  pond: number;
  e: PondEvent;
}

export interface World {
  readonly ponds: readonly Pond[];
  readonly lineage: Lineage;
  readonly bands: readonly Band[];
  /** Events since the last `drain`, for drawing. */
  drain(): WorldEvent[];
  step(dt: number, swim?: boolean): void;
  /** A tap at a venue point in pond `i`. */
  catchAt(i: number, x: number, y: number, by: Catcher): Fish | null;
  setFloor(i: number, floor: FloorId, x: number, ghost?: boolean): boolean;
  setMutation(i: number, value: "small" | "big"): void;
  setHerons(value: Config["herons"]): void;
  immigrate(i: number, edge: -1 | 1, m: Migrant): boolean;
  /** Prune the tree; returns lines that just lost their last living descendant. */
  prune(now: number): TreeNode[];
  /** Set each living fish's tree column to its pond. */
  columns(): void;
  /** Start again from fresh, mixed populations on the default floors. */
  fresh(): void;
  /** Floors back to their defaults, one pond every `stagger` s. */
  homeFloors(stagger: number): void;
  standout(i: number): number;
  readonly counts: { caught: number; migrants: number; born: number };
  dispose(): void;
}

export const createWorld = (opts: WorldOpts): World => {
  const { specs, config, rng, stamp } = opts;
  const lineage = createLineage();
  const seq = specs.map(() => Math.floor(Math.random() * SEQ));
  const depsFor = (i: number): PondDeps => ({
    rng: rng.fork(`pond:${specs[i]!.island}`),
    stamp,
    nextId: () => {
      const island = Math.min(MAX_ISLAND, Math.max(0, specs[i]!.island));
      seq[i] = ((seq[i] ?? 0) + 1) % SEQ;
      return island * SEQ + (seq[i] || 1);
    },
  });
  const deps = specs.map((_, i) => depsFor(i));
  const ponds = specs.map((spec, i) =>
    createPond(spec, { mutation: config.mutation, herons: config.herons }, deps[i]!),
  );
  const bands = specs.map((s) => createBand(s.floor, stamp()));
  const counts = { caught: 0, migrants: 0, born: 0 };
  const events: WorldEvent[] = [];
  const out: WorldEvent[] = [];
  /** Floors heading home after idle: pond, seconds left. */
  const homing: { pond: number; t: number }[] = [];

  const migrantOf = (p: Pond, f: Fish): Migrant => {
    const b = p.spec.box;
    return {
      fish: { id: f.id, parent: f.parent, born: f.born, genes: f.genes },
      age: f.age,
      life: f.life,
      y: (f.y - b.y) / Math.max(1, b.h),
      chain: ancestorsOf(lineage, f.id, MIGRANT_CHAIN).map((n) => ({
        id: n.id,
        parent: n.parent,
        born: n.born,
        genes: n.genes,
      })),
    };
  };

  const handle = (i: number, e: PondEvent) => {
    const now = stamp();
    switch (e.kind) {
      case "birth":
        lineage.add(e.fish, true);
        if (e.parent) counts.born++;
        break;
      case "catch":
        lineage.kill(e.fish.id, now);
        counts.caught++;
        break;
      case "death":
        lineage.kill(e.fish.id, now);
        break;
      case "floor":
        noteFloor(bands[i]!, e.floor, now);
        break;
      case "leave": {
        const j = i + e.edge;
        const p = ponds[i]!;
        const next = ponds[j];
        if (next) {
          arrive(next, e.fish, e.edge < 0 ? 1 : -1, (e.fish.y - p.spec.box.y) / p.spec.box.h);
          counts.migrants++;
        } else if (opts.emigrate?.(i, e.edge, migrantOf(p, e.fish))) {
          lineage.kill(e.fish.id, now);
          counts.migrants++;
        } else {
          turnBack(p, e.fish);
          p.counts.left--;
        }
        break;
      }
      default:
        break;
    }
    if (events.length < 512) events.push({ pond: i, e });
  };

  const world: World = {
    ponds,
    lineage,
    bands,
    counts,
    drain() {
      out.length = 0;
      for (const e of events) out.push(e);
      events.length = 0;
      return out;
    },
    step(dt, swim = true) {
      for (let i = 0; i < ponds.length; i++) {
        const p = ponds[i]!;
        p.open[0] = i > 0 || !!opts.outside?.(i, -1);
        p.open[1] = i < ponds.length - 1 || !!opts.outside?.(i, 1);
      }
      for (let k = homing.length - 1; k >= 0; k--) {
        const h = homing[k]!;
        h.t -= dt;
        if (h.t > 0) continue;
        homing.splice(k, 1);
        const p = ponds[h.pond];
        if (p) setFloor(p, p.spec.floor, p.spec.box.x + p.spec.box.w / 2, true);
      }
      const now = stamp();
      for (let i = 0; i < ponds.length; i++) {
        const p = ponds[i]!;
        stepPond(p, dt, deps[i]!, { swim });
        // Events are taken one at a time: a migrant handed on may raise events in another pond.
        while (p.events.length > 0) handle(i, p.events.shift()!);
        noteColor(bands[i]!, genesOf(p), now);
      }
    },
    catchAt(i, x, y, by) {
      const p = ponds[i];
      if (!p) return null;
      const f = catchNear(p, x, y, by);
      while (p.events.length > 0) handle(i, p.events.shift()!);
      return f;
    },
    setFloor(i, floor, x, ghost = false) {
      const p = ponds[i];
      if (!p) return false;
      const k = homing.findIndex((h) => h.pond === i);
      if (k >= 0 && !ghost) homing.splice(k, 1);
      const changed = setFloor(p, floor, x, ghost);
      // A visitor's floor stays a good while before the pond picks another by itself.
      if (changed && !ghost) p.floorT = Math.max(p.floorT, ATTRACT_FLOOR_S);
      while (p.events.length > 0) handle(i, p.events.shift()!);
      return changed;
    },
    setMutation(i, value) {
      const p = ponds[i];
      if (p) p.mutation = value;
    },
    setHerons(value) {
      for (const p of ponds) p.herons = value;
    },
    immigrate(i, edge, m) {
      const p = ponds[i];
      if (!p) return false;
      const d = deps[i]!;
      for (let k = m.chain.length - 1; k >= 0; k--) lineage.add(m.chain[k]!, false);
      lineage.add(m.fish, true);
      const f = createFish(
        d,
        { ...m.fish, genes: [...m.fish.genes] },
        { x: 0, y: 0, heading: 0 },
        m.age,
      );
      f.life = m.life;
      arrive(p, f, edge, m.y);
      while (p.events.length > 0) handle(i, p.events.shift()!);
      counts.migrants++;
      return true;
    },
    prune(now) {
      return lineage.prune(now, HORIZON_MS, opts.cap);
    },
    columns() {
      ponds.forEach((p, i) => {
        for (const f of p.fish) {
          const n = lineage.get(f.id);
          if (n) n.col = i;
        }
      });
    },
    fresh() {
      lineage.clear();
      homing.length = 0;
      const now = stamp();
      ponds.forEach((p, i) => {
        p.floor = p.spec.floor;
        p.sweep = null;
        p.counts.caught = p.counts.byHeron = p.counts.born = p.counts.died = 0;
        p.counts.left = p.counts.arrived = 0;
        populate(p, deps[i]!);
        const b = bands[i]!;
        b.floors.length = 0;
        b.floors.push({ t: now, floor: p.floor });
        b.colors.length = 0;
        while (p.events.length > 0) handle(i, p.events.shift()!);
      });
      events.length = 0;
    },
    homeFloors(stagger) {
      homing.length = 0;
      ponds.forEach((p, i) => {
        if (p.floor !== p.spec.floor) homing.push({ pond: i, t: 2 + i * stagger });
      });
    },
    standout: (i) => (ponds[i] ? meanStandout(ponds[i]) : 0),
    dispose() {
      lineage.clear();
      events.length = 0;
      out.length = 0;
      for (const p of ponds) {
        p.fish.length = 0;
        p.events.length = 0;
      }
    },
  };
  // Founders are in the tree from the start.
  ponds.forEach((p, i) => {
    while (p.events.length > 0) handle(i, p.events.shift()!);
  });
  events.length = 0;
  return world;
};
