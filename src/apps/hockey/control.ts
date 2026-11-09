/**
 * Fingers steer mallets. A finger that goes down inside a playing person's station steers that
 * station's mallet until it lifts; a newer finger in the same station takes over.
 *
 * Each axis is mapped separately from the player's control range (the station's width and the
 * calibrated band's height) onto the range the mallet may use. When the control range covers
 * the mallet's range the finger drives the mallet directly, so the mallet sits under the
 * finger. When it does not (a child's short band on a tall table) the range is stretched, and
 * the renderer shows the band as a faint control strip so the offset makes sense.
 */
import type { Input, Pointer, Rect } from "../../core/types";
import { type Affine, apply, boxToRect, invert } from "./layout";
import type { Seat } from "./seats";
import type { Table } from "./table";

export interface AxisMap {
  from: readonly [number, number];
  to: readonly [number, number];
  direct: boolean;
}

export interface ControlMap {
  x: AxisMap;
  y: AxisMap;
  /** The control strip in stage px, when either axis is stretched. */
  strip: Rect | null;
}

/** The control range may fall this far (as a fraction of the mallet range) short of each end. */
const DIRECT_SLACK = 0.08;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export const axisMap = (c0: number, c1: number, z0: number, z1: number): AxisMap => {
  const slack = (z1 - z0) * DIRECT_SLACK;
  return { from: [c0, c1], to: [z0, z1], direct: c0 <= z0 + slack && c1 >= z1 - slack };
};

export const mapAxis = (m: AxisMap, v: number): number => {
  if (m.direct) return clamp(v, m.to[0], m.to[1]);
  const span = m.from[1] - m.from[0];
  const t = span > 0 ? clamp((v - m.from[0]) / span, 0, 1) : 0.5;
  return m.to[0] + t * (m.to[1] - m.to[0]);
};

/** `station`, `band` and `zone` in stage px. */
export const controlMap = (
  station: Rect,
  band: { top: number; bottom: number } | null,
  zone: Rect,
): ControlMap => {
  const top = band?.top ?? station.y;
  const bottom = band?.bottom ?? station.y + station.height;
  const x = axisMap(station.x, station.x + station.width, zone.x, zone.x + zone.width);
  const y = axisMap(top, bottom, zone.y, zone.y + zone.height);
  const strip =
    x.direct && y.direct
      ? null
      : { x: station.x, y: top, width: station.width, height: bottom - top };
  return { x, y, strip };
};

export interface Steering {
  seat: Seat;
  table: Table;
  /** Lane to venue transform of the seat's lane. */
  toVenue: Affine;
}

export interface Controls {
  /** The control map for a seat's current band, or null when no person is playing it. */
  mapOf(s: Steering): ControlMap | null;
  /** Stage position of the finger steering a seat, if any. */
  fingerOf(s: Steering): { x: number; y: number } | null;
  dispose(): void;
}

const inside = (r: Rect, x: number, y: number) =>
  x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;

export const createControls = (
  input: Input,
  steering: () => readonly Steering[],
  unit: () => number,
): Controls => {
  const fingers = new Map<number, { s: Steering; x: number; y: number }>();
  const maps = new WeakMap<Steering, { key: string; map: ControlMap }>();

  const mapOf = (s: Steering): ControlMap | null => {
    const st = s.seat.station;
    if (st.state !== "playing" || st.bot) return null;
    const band = st.band;
    const u = unit();
    const z = s.seat.player.mallet.zone;
    // The zone changes when the table is fitted to a band, so it is part of the key.
    const key = `${band?.top}|${band?.bottom}|${u}|${z.x0}|${z.x1}|${z.y0}|${z.y1}`;
    const cached = maps.get(s);
    if (cached?.key === key) return cached.map;
    const zone = boxToRect(s.toVenue, s.seat.player.mallet.zone);
    const map = controlMap(st.rect, band, {
      x: zone.x * u,
      y: zone.y * u,
      width: zone.width * u,
      height: zone.height * u,
    });
    maps.set(s, { key, map });
    return map;
  };

  const steer = (s: Steering, x: number, y: number) => {
    const map = mapOf(s);
    if (!map) return false;
    const u = unit();
    const venue = { x: mapAxis(map.x, x) / u, y: mapAxis(map.y, y) / u };
    const lane = apply(invert(s.toVenue), venue.x, venue.y);
    s.table.aim(s.seat.player, lane.x, lane.y);
    return true;
  };

  const down = (p: Pointer) => {
    for (const s of steering()) {
      const st = s.seat.station;
      if (st.state !== "playing" || st.bot || !inside(st.rect, p.x, p.y)) continue;
      for (const [id, f] of fingers) if (f.s === s) fingers.delete(id);
      fingers.set(p.id, { s, x: p.x, y: p.y });
      s.seat.touched = p.time;
      steer(s, p.x, p.y);
      return;
    }
  };

  const move = (p: Pointer) => {
    const f = fingers.get(p.id);
    if (!f) return;
    f.x = p.x;
    f.y = p.y;
    f.s.seat.touched = p.time;
    if (!steer(f.s, p.x, p.y)) fingers.delete(p.id);
  };

  const lift = (p: Pointer) => {
    fingers.delete(p.id);
  };

  const offs = [
    input.on("down", down),
    input.on("move", move),
    input.on("up", lift),
    input.on("cancel", lift),
  ];

  return {
    mapOf,
    fingerOf(s) {
      for (const f of fingers.values()) if (f.s === s) return { x: f.x, y: f.y };
      return null;
    },
    dispose() {
      for (const off of offs) off();
      fingers.clear();
    },
  };
};
