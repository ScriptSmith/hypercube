/**
 * The route network the app draws and matches vehicles against: the bundled copy at first, then
 * the day's static data from brisbus once the worker has it (which adds headsigns, and covers
 * routes the bundle doesn't know).
 */
import { REGION } from "./geo";
import type { PackedNetwork } from "./gtfs";
import { makeShapeLine, type ShapeLine } from "./match";
import { guessMode, type Mode, modeOfType } from "./routes";

export interface RouteInfo {
  base: string;
  mode: Mode;
  /** Runtime only. */
  headsigns: [string | null, string | null];
}

export interface NetShape extends ShapeLine {
  route: string;
  dir: number;
}

export interface Network {
  /** "bundled" or "daily". */
  source: string;
  routes: Map<string, RouteInfo>;
  shapes: NetShape[];
  /** Shapes by route base. */
  byRoute: Map<string, NetShape[]>;
}

const MAX_ROUTES = 5000;
const MAX_SHAPES = 20_000;
const MAX_POINTS = 2_000_000;

/** Check and unpack a packed network. Null when malformed or for another region. */
export const unpackNetwork = (data: unknown, source: string): Network | null => {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Partial<PackedNetwork>;
  if (d.v !== 1 || !Array.isArray(d.region) || !Array.isArray(d.routes) || !Array.isArray(d.shapes))
    return null;
  const [w, s, e, n] = d.region;
  if (w !== REGION.west || s !== REGION.south || e !== REGION.east || n !== REGION.north)
    return null;
  const q = Number(d.q);
  if (!(q > 0 && q <= 100)) return null;
  const routes = new Map<string, RouteInfo>();
  const list: (RouteInfo | null)[] = [];
  for (const [i, r] of d.routes.slice(0, MAX_ROUTES).entries()) {
    if (!Array.isArray(r) || typeof r[0] !== "string" || typeof r[1] !== "number") {
      list.push(null);
      continue;
    }
    const heads = d.headsigns?.[i];
    const info: RouteInfo = {
      base: r[0],
      mode: modeOfType(r[1]),
      headsigns: [
        typeof heads?.[0] === "string" ? heads[0] : null,
        typeof heads?.[1] === "string" ? heads[1] : null,
      ],
    };
    list.push(info);
    if (!routes.has(info.base)) routes.set(info.base, info);
  }
  const shapes: NetShape[] = [];
  const byRoute = new Map<string, NetShape[]>();
  let points = 0;
  for (const raw of d.shapes.slice(0, MAX_SHAPES)) {
    if (!Array.isArray(raw) || raw.length < 6 || raw.length % 2 !== 0) continue;
    const route = list[raw[0] as number];
    if (!route) continue;
    const count = (raw.length - 2) / 2;
    if (points + count > MAX_POINTS) break;
    const pts = new Float32Array(count * 2);
    let x = 0;
    let y = 0;
    let ok = true;
    for (let i = 0; i < count; i++) {
      const dx = raw[2 + i * 2];
      const dy = raw[3 + i * 2];
      if (typeof dx !== "number" || typeof dy !== "number") {
        ok = false;
        break;
      }
      x = i === 0 ? dx : x + dx;
      y = i === 0 ? dy : y + dy;
      pts[i * 2] = x * q;
      pts[i * 2 + 1] = y * q;
    }
    if (!ok) continue;
    points += count;
    const shape: NetShape = { ...makeShapeLine(pts), route: route.base, dir: raw[1] === 1 ? 1 : 0 };
    shapes.push(shape);
    const forRoute = byRoute.get(route.base) ?? [];
    forRoute.push(shape);
    byRoute.set(route.base, forRoute);
  }
  return { source, routes, shapes, byRoute };
};

/**
 * The daily network, with anything only the bundle knows kept (old replays use route ids that
 * may have left today's timetable).
 */
export const mergeNetworks = (daily: Network, bundled: Network): Network => {
  const routes = new Map(daily.routes);
  const byRoute = new Map(daily.byRoute);
  const shapes = [...daily.shapes];
  for (const [base, info] of bundled.routes) {
    if (!routes.has(base)) routes.set(base, info);
    if (!byRoute.has(base)) {
      const list = bundled.byRoute.get(base);
      if (list) {
        byRoute.set(base, list);
        shapes.push(...list);
      }
    }
  }
  return { source: daily.source, routes, shapes, byRoute };
};

export const emptyNetwork = (): Network => ({
  source: "none",
  routes: new Map(),
  shapes: [],
  byRoute: new Map(),
});

export const modeOf = (net: Network, base: string): Mode =>
  net.routes.get(base)?.mode ?? guessMode(base);

/** Shapes to match a vehicle against: its direction's when known, else all of its route's. */
export const shapesFor = (net: Network, base: string, dir: number): NetShape[] => {
  const all = net.byRoute.get(base);
  if (!all) return [];
  if (dir !== 0 && dir !== 1) return all;
  const own = all.filter((s) => s.dir === dir);
  return own.length ? own : all;
};

export const headsignOf = (net: Network, base: string, dir: number): string | null => {
  const h = net.routes.get(base)?.headsigns;
  if (!h) return null;
  if (dir === 0 || dir === 1) return h[dir];
  return null;
};
