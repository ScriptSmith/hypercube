/**
 * Static GTFS (routes, trips, shapes) cut down to the region: one representative shape per route
 * and direction, clipped to the region, simplified and quantised. The worker builds this from
 * brisbus's daily files at runtime (with headsigns), and `scripts/transit-record.mjs` builds the
 * bundled copy (without any names) from the same code.
 */
import { inRegion, REGION, toLocalX, toLocalY } from "./geo";

/** GTFS route_type values this app knows. */
export const ROUTE_TYPE = { tram: 0, rail: 2, bus: 3, ferry: 4 } as const;

/** The packed network, as bundled in `data/network.json` and sent by the worker. */
export interface PackedNetwork {
  v: 1;
  region: [number, number, number, number];
  /** Metres per unit of the shape coordinates. */
  q: number;
  /** Route base id (the GTFS route_id before its version suffix) and GTFS route_type. */
  routes: [string, number][];
  /** Route index, direction (0, 1), then x0, y0 and deltas, in units of `q`, from the region's corner. */
  shapes: number[][];
  /** Runtime only, never bundled: per route, the commonest headsign in each direction. */
  headsigns?: [string | null, string | null][];
}

/** "199-5146" to "199": the id without the timetable version, stable across releases. */
export const routeBase = (routeId: string): string => {
  const dash = routeId.indexOf("-");
  return dash > 0 ? routeId.slice(0, dash) : routeId;
};

// ---- CSV ------------------------------------------------------------------------------------

/** One CSV line, with quoted fields and doubled quotes. */
export const parseCsvLine = (line: string): string[] => {
  if (!line.includes('"')) return line.split(",");
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(field);
      field = "";
    } else field += c;
  }
  out.push(field);
  return out;
};

export type Columns = ReadonlyMap<string, number>;

/** Feeds text in chunks and calls `onRow` per data row with the header's column map. */
export const createCsvReader = (onRow: (row: string[], cols: Columns) => void) => {
  let carry = "";
  let cols: Map<string, number> | null = null;
  const line = (raw: string) => {
    const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (!text) return;
    if (!cols) {
      cols = new Map(parseCsvLine(text.replace(/^﻿/, "")).map((h, i) => [h.trim(), i]));
      return;
    }
    onRow(parseCsvLine(text), cols);
  };
  return {
    push(chunk: string) {
      const parts = (carry + chunk).split("\n");
      carry = parts.pop() ?? "";
      for (const p of parts) line(p);
    },
    end() {
      if (carry) line(carry);
      carry = "";
    },
  };
};

/** Read a (gzipped) CSV stream row by row. */
export const readCsvStream = async (
  body: ReadableStream<Uint8Array>,
  gzip: boolean,
  onRow: (row: string[], cols: Columns) => void,
): Promise<void> => {
  const reader = createCsvReader(onRow);
  // The stream classes' DOM typings disagree on Uint8Array generics; the runtime types match.
  const bytes = gzip
    ? body.pipeThrough(
        new DecompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>,
      )
    : body;
  const text = bytes
    .pipeThrough(new TextDecoderStream() as unknown as TransformStream<Uint8Array, string>)
    .getReader();
  for (;;) {
    const { done, value } = await text.read();
    if (done) break;
    reader.push(value);
  }
  reader.end();
};

const col = (row: string[], cols: Columns, name: string): string => {
  const i = cols.get(name);
  return i === undefined ? "" : (row[i] ?? "");
};

// ---- Simplification -------------------------------------------------------------------------

/** Douglas-Peucker on a flat [x0, y0, x1, y1, ...] list. Keeps the end points. */
export const simplify = (pts: readonly number[], tolerance: number): number[] => {
  const n = pts.length / 2;
  if (n <= 2) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: number[] = [0, n - 1];
  while (stack.length) {
    const b = stack.pop()!;
    const a = stack.pop()!;
    const ax = pts[a * 2]!;
    const ay = pts[a * 2 + 1]!;
    const dx = pts[b * 2]! - ax;
    const dy = pts[b * 2 + 1]! - ay;
    const len = Math.hypot(dx, dy);
    let best = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i * 2]! - ax;
      const py = pts[i * 2 + 1]! - ay;
      const d = len > 1e-9 ? Math.abs(dx * py - dy * px) / len : Math.hypot(px, py);
      if (d > best) {
        best = d;
        at = i;
      }
    }
    if (at >= 0 && best > tolerance) {
      keep[at] = 1;
      stack.push(a, at, at, b);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2]!, pts[i * 2 + 1]!);
  return out;
};

/** Runs of consecutive points inside the region (plus `margin` metres), each of two or more. */
export const clipToRegion = (pts: readonly number[], margin: number): number[][] => {
  const runs: number[][] = [];
  let run: number[] = [];
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i]!;
    const y = pts[i + 1]!;
    if (inRegion(x, y, margin)) run.push(x, y);
    else {
      if (run.length >= 4) runs.push(run);
      run = [];
    }
  }
  if (run.length >= 4) runs.push(run);
  return runs;
};

// ---- Building the network -------------------------------------------------------------------

export interface BuildOptions {
  /** Douglas-Peucker tolerance, metres. */
  tolerance: number;
  /** Metres per stored unit. */
  quantum: number;
  /** Keep the commonest headsign per route and direction (runtime only, never bundled). */
  headsigns: boolean;
  /** Clip slack around the region, metres. */
  margin?: number;
}

interface RouteAcc {
  base: string;
  type: number;
  /** Per direction: shape id to trip count. */
  shapes: [Map<string, number>, Map<string, number>];
  heads: [Map<string, number>, Map<string, number>];
}

/**
 * Collects routes.txt, then trips.txt, then shapes.txt rows (in that order) and packs the result.
 * `tripDirection` keeps trip id to direction, for matching feed vehicles to directions.
 */
export const createNetworkBuilder = (opts: BuildOptions) => {
  const routeById = new Map<string, RouteAcc>();
  const routes = new Map<string, RouteAcc>();
  const tripDirection = new Map<string, number>();
  /** Shape id to the routes and directions it represents, decided after trips. */
  let wanted: Map<string, { route: RouteAcc; dir: number }[]> | null = null;
  const points = new Map<string, number[]>();
  const margin = opts.margin ?? 1000;

  const chooseShapes = () => {
    wanted = new Map();
    for (const r of routes.values()) {
      r.shapes.forEach((counts, dir) => {
        let best = "";
        let most = 0;
        for (const [id, n] of counts) {
          if (n > most) {
            most = n;
            best = id;
          }
        }
        if (!best) return;
        const list = wanted!.get(best) ?? [];
        list.push({ route: r, dir });
        wanted!.set(best, list);
      });
    }
  };

  return {
    tripDirection,
    route(row: string[], cols: Columns) {
      const id = col(row, cols, "route_id");
      const type = Number.parseInt(col(row, cols, "route_type"), 10);
      if (!id || !Number.isFinite(type)) return;
      const base = routeBase(id);
      let acc = routes.get(base);
      if (!acc) {
        acc = { base, type, shapes: [new Map(), new Map()], heads: [new Map(), new Map()] };
        routes.set(base, acc);
      }
      routeById.set(id, acc);
    },
    trip(row: string[], cols: Columns) {
      const acc = routeById.get(col(row, cols, "route_id"));
      if (!acc) return;
      const dir = col(row, cols, "direction_id") === "1" ? 1 : 0;
      const tripId = col(row, cols, "trip_id");
      if (tripId) tripDirection.set(tripId, dir);
      const shape = col(row, cols, "shape_id");
      if (shape) acc.shapes[dir].set(shape, (acc.shapes[dir].get(shape) ?? 0) + 1);
      if (opts.headsigns) {
        const head = col(row, cols, "trip_headsign").trim();
        if (head) acc.heads[dir].set(head, (acc.heads[dir].get(head) ?? 0) + 1);
      }
    },
    shapePoint(row: string[], cols: Columns) {
      if (!wanted) chooseShapes();
      const id = col(row, cols, "shape_id");
      if (!wanted!.has(id)) return;
      const lat = Number.parseFloat(col(row, cols, "shape_pt_lat"));
      const lon = Number.parseFloat(col(row, cols, "shape_pt_lon"));
      const seq = Number.parseInt(col(row, cols, "shape_pt_sequence"), 10);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(seq)) return;
      let list = points.get(id);
      if (!list) {
        list = [];
        points.set(id, list);
      }
      list.push(seq, toLocalX(lon), toLocalY(lat));
    },
    build(): PackedNetwork {
      if (!wanted) chooseShapes();
      const packedRoutes: [string, number][] = [];
      const index = new Map<RouteAcc, number>();
      const heads: [string | null, string | null][] = [];
      const shapes: number[][] = [];
      const indexOf = (r: RouteAcc) => {
        let i = index.get(r);
        if (i === undefined) {
          i = packedRoutes.length;
          index.set(r, i);
          packedRoutes.push([r.base, r.type]);
          const top = (m: Map<string, number>) => {
            let best: string | null = null;
            let most = 0;
            for (const [h, n] of m) {
              if (n > most) {
                most = n;
                best = h;
              }
            }
            return best;
          };
          heads.push([top(r.heads[0]), top(r.heads[1])]);
        }
        return i;
      };
      const ids = [...points.keys()].sort();
      for (const id of ids) {
        const raw = points.get(id)!;
        const order: number[] = [];
        for (let i = 0; i < raw.length; i += 3) order.push(i);
        order.sort((a, b) => raw[a]! - raw[b]!);
        const flat: number[] = [];
        for (const i of order) flat.push(raw[i + 1]!, raw[i + 2]!);
        const runs = clipToRegion(flat, margin);
        if (!runs.length) continue;
        for (const owner of wanted!.get(id) ?? []) {
          const ri = indexOf(owner.route);
          for (const run of runs) {
            const s = simplify(run, opts.tolerance);
            const q = opts.quantum;
            const out = [ri, owner.dir];
            let px = 0;
            let py = 0;
            for (let i = 0; i < s.length; i += 2) {
              const x = Math.round(s[i]! / q);
              const y = Math.round(s[i + 1]! / q);
              if (i > 0 && x === px && y === py) continue;
              out.push(i === 0 ? x : x - px, i === 0 ? y : y - py);
              px = x;
              py = y;
            }
            if (out.length >= 6) shapes.push(out);
          }
        }
      }
      // Routes with no shape in the region still matter: feed vehicles on them need their mode.
      for (const r of routes.values()) indexOf(r);
      const net: PackedNetwork = {
        v: 1,
        region: [REGION.west, REGION.south, REGION.east, REGION.north],
        q: opts.quantum,
        routes: packedRoutes,
        shapes,
      };
      if (opts.headsigns) net.headsigns = heads;
      return net;
    },
  };
};
