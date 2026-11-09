/**
 * The screen's picture of the bank: one family tree built from every touch frame's `pond`
 * messages. A fish a frame lists is alive in the column of its island; one it stops listing and
 * reports dead died then. One it stops listing without a death has swum to another frame: it
 * stays alive for a few seconds, and if no frame lists it by then it died on the way. A frame
 * that goes quiet for 6 s takes its fish with it (their lines end there), and a frame that
 * reloads (a new epoch) ends its old fish at once.
 */
import { DROP_MS, HORIZON_MS, TRANSIT_MS } from "./config";
import type { FloorId } from "./genes";
import { createLineage, type Lineage, type TreeNode } from "./lineage";
import { type Band, createBand, noteColor, noteFloor } from "./world";
import type { HistMsg, PondMsg } from "./wire";

export interface IslandState {
  island: number;
  pos: number;
  count: number;
  /** Tip range across its frame, 0 to 1. */
  u0: number;
  u1: number;
  floor: FloorId;
  ids: number[];
}

interface Remote {
  frame: string;
  epoch: number;
  /** Local ms of the last message, and its shared-clock time. */
  at: number;
  t: number;
  pos: number;
  count: number;
  ponds: number;
  islands: Map<number, IslandState>;
}

export interface Fleet {
  readonly lineage: Lineage;
  readonly bands: ReadonlyMap<number, Band>;
  accept(m: PondMsg, from: string, now: number): void;
  history(m: HistMsg, from: string): void;
  /** Drop quiet frames and settle migrants; prune the tree. Returns lines that died out. */
  prune(now: number, clock: number, cap: number): TreeNode[];
  islands(): IslandState[];
  /** Columns the tree spreads over: every island of the bank. */
  columns(fallback: number): number;
  readonly frames: number;
  readonly transit: number;
  clear(): void;
}

const MAX_REMOTES = 32;
const MAX_TRANSIT = 256;

export const createFleet = (): Fleet => {
  const lineage = createLineage();
  const remotes = new Map<string, Remote>();
  const transit = new Map<number, { at: number; t: number }>();
  const bands = new Map<number, Band>();
  const listed = new Set<number>();

  const end = (r: Remote) => {
    for (const s of r.islands.values()) for (const id of s.ids) lineage.kill(id, r.t);
  };

  return {
    lineage,
    bands,
    accept(m, from, now) {
      let r = remotes.get(from);
      if (r && r.epoch !== m.epoch) {
        end(r);
        remotes.delete(from);
        r = undefined;
      }
      if (!r) {
        if (remotes.size >= MAX_REMOTES) return;
        r = {
          frame: from,
          epoch: m.epoch,
          at: now,
          t: m.t,
          pos: m.pos,
          count: m.count,
          ponds: m.ponds,
          islands: new Map(),
        };
        remotes.set(from, r);
      }
      r.at = now;
      r.t = m.t;
      r.pos = m.pos;
      r.count = m.count;
      r.ponds = m.ponds;
      const seen = new Set<number>();
      for (const s of m.islands) {
        const prev = r.islands.get(s.island);
        const gone = new Set<number>();
        for (const d of s.dead) {
          lineage.kill(d.id, d.t);
          transit.delete(d.id);
          gone.add(d.id);
        }
        const ids: number[] = [];
        s.fish.forEach((rec, i) => {
          const n = lineage.add(rec, true);
          n.died = null;
          n.col = s.island;
          n.order = i;
          ids.push(rec.id);
          transit.delete(rec.id);
        });
        for (const id of ids) seen.add(id);
        if (prev) {
          const now2 = new Set(ids);
          for (const id of prev.ids) {
            if (now2.has(id) || gone.has(id) || transit.has(id)) continue;
            if (transit.size >= MAX_TRANSIT) lineage.kill(id, m.t);
            else transit.set(id, { at: now, t: m.t });
          }
        }
        r.islands.set(s.island, {
          island: s.island,
          pos: m.pos,
          count: m.count,
          u0: s.u0,
          u1: s.u1,
          floor: s.floor,
          ids,
        });
        let band = bands.get(s.island);
        if (!band) {
          band = createBand(s.floor, m.t);
          bands.set(s.island, band);
        }
        noteFloor(band, s.floor, m.t);
        noteColor(
          band,
          s.fish.map((f) => f.genes),
          m.t,
        );
      }
      // Islands this frame no longer has (it changed size): their fish end.
      for (const [island, s] of r.islands) {
        if (m.islands.some((x) => x.island === island)) continue;
        for (const id of s.ids) if (!seen.has(id)) lineage.kill(id, m.t);
        r.islands.delete(island);
      }
    },
    history(m, from) {
      const r = remotes.get(from);
      if (r && r.epoch !== m.epoch) return;
      for (const rec of m.nodes) if (!lineage.has(rec.id)) lineage.add(rec, false);
    },
    prune(now, clock, cap) {
      for (const [frame, r] of remotes) {
        if (now - r.at <= DROP_MS) continue;
        end(r);
        remotes.delete(frame);
      }
      listed.clear();
      for (const r of remotes.values())
        for (const s of r.islands.values()) for (const id of s.ids) listed.add(id);
      for (const [id, tr] of transit) {
        if (listed.has(id)) {
          transit.delete(id);
        } else if (now - tr.at > TRANSIT_MS) {
          lineage.kill(id, tr.t);
          transit.delete(id);
        }
      }
      return lineage.prune(clock, HORIZON_MS, cap);
    },
    islands() {
      const out: IslandState[] = [];
      for (const r of remotes.values()) for (const s of r.islands.values()) out.push(s);
      out.sort((a, b) => a.island - b.island);
      return out;
    },
    columns(fallback) {
      let n = Math.max(1, fallback);
      for (const r of remotes.values()) {
        n = Math.max(n, r.count * r.ponds);
        for (const s of r.islands.values()) n = Math.max(n, s.island + 1);
      }
      return Math.min(64, n);
    },
    get frames() {
      return remotes.size;
    },
    get transit() {
      return transit.size;
    },
    clear() {
      lineage.clear();
      remotes.clear();
      transit.clear();
      bands.clear();
    },
  };
};
