import { describe, expect, it } from "vitest";
import { REGION_H, REGION_W, toLocalX, toLocalY } from "../../../src/apps/transit/geo";
import { decodeFeed } from "../../../src/apps/transit/pbf";
import type { Snapshot, SnapVehicle } from "../../../src/apps/transit/replay";
import {
  CHUNK_BYTES,
  decodeChunk,
  decodePick,
  encodeSnapshot,
  feedToSnapshot,
  vehicleKey,
} from "../../../src/apps/transit/wire";
import { buildFeed } from "./helpers";

const T = 1_792_675_000;

const fleet = (n: number): Snapshot => {
  const vehicles: SnapVehicle[] = [];
  for (let i = 0; i < n; i++) {
    vehicles.push({
      key: vehicleKey(`VU-${i}`),
      route: ["199", "M1", "F1", "SHCL", "60"][i % 5]!,
      dir: [0, 1, -1][i % 3]!,
      x: (i * 7919) % REGION_W,
      y: (i * 104729) % REGION_H,
      bearing: i % 4 === 0 ? -1 : (i * 37) % 360,
      ts: T - (i % 50),
    });
  }
  return { t: T, vehicles, source: "live" };
};

describe("vehicle keys", () => {
  it("are stable, positive 32-bit integers that differ between ids", () => {
    expect(vehicleKey("VU-1")).toBe(vehicleKey("VU-1"));
    const keys = new Set(Array.from({ length: 3000 }, (_, i) => vehicleKey(`VU-${i}`)));
    expect(keys.size).toBe(3000);
    for (const k of keys) {
      expect(Number.isInteger(k) && k > 0 && k < 2 ** 32).toBe(true);
    }
    expect(vehicleKey("")).toBeGreaterThan(0);
  });
});

describe("snapshot chunks", () => {
  it("keep every chunk's JSON under the limit and round-trip, quantised", () => {
    const snap = fleet(2000);
    const chunks = encodeSnapshot(snap, 7);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(JSON.stringify(c).length).toBeLessThanOrEqual(CHUNK_BYTES);
    const back = chunks.flatMap((c) => decodeChunk(JSON.parse(JSON.stringify(c)))!.vehicles);
    expect(back).toHaveLength(2000);
    back.forEach((v, i) => {
      const o = snap.vehicles[i]!;
      expect(v.key).toBe(o.key);
      expect(v.route).toBe(o.route);
      expect(v.dir).toBe(o.dir);
      expect(Math.abs(v.x - o.x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(v.y - o.y)).toBeLessThanOrEqual(0.5);
      expect(v.ts).toBe(o.ts);
      if (o.bearing < 0) expect(v.bearing).toBe(-1);
      else expect(Math.abs(v.bearing - o.bearing)).toBeLessThan(1.5);
    });
  });

  it("sends nothing for an empty snapshot", () => {
    expect(encodeSnapshot({ t: T, vehicles: [], source: "live" }, 1)).toEqual([]);
  });

  it("drops vehicles whose route id isn't a plain id", () => {
    const snap = fleet(3);
    snap.vehicles[1]!.route = "bad id!";
    const back = encodeSnapshot(snap, 1).flatMap((c) => decodeChunk(c)!.vehicles);
    expect(back.map((v) => v.route)).toEqual(["199", "F1"]);
  });

  it("rejects chunks with anything out of range", () => {
    const good = encodeSnapshot(fleet(3), 1)[0]!;
    expect(decodeChunk(good)).not.toBeNull();
    const bad = (patch: object) => decodeChunk({ ...good, ...patch });
    expect(bad({ s: -1 })).toBeNull();
    expect(bad({ t: 5 })).toBeNull();
    expect(bad({ r: ["ok", "not ok"] })).toBeNull();
    expect(bad({ v: good.v.slice(0, 6) })).toBeNull();
    const v = [...good.v];
    v[3] = 99;
    expect(bad({ v })).toBeNull();
    const far = [...good.v];
    far[1] = 900_000;
    expect(bad({ v: far })).toBeNull();
    const frac = [...good.v];
    frac[2] = 1.5;
    expect(bad({ v: frac })).toBeNull();
    expect(decodeChunk(null)).toBeNull();
    expect(decodeChunk("x")).toBeNull();
  });
});

describe("picks", () => {
  it("accept featured lines and palette colours only", () => {
    expect(decodePick({ line: "199", color: 5 })).toEqual({ line: "199", color: 5 });
    expect(decodePick({ line: "nope", color: 5 })).toBeNull();
    expect(decodePick({ line: "199", color: 9 })).toBeNull();
    expect(decodePick({ line: "199" })).toBeNull();
  });
});

describe("feed to snapshot", () => {
  it("keeps the region's vehicles with route ids, keys and local metres, and no labels", () => {
    const feed = decodeFeed(
      buildFeed(T, [
        {
          id: "a",
          route: "199-5146",
          trip: "t1",
          lat: -27.47,
          lon: 153.02,
          timestamp: T - 10,
          label: "x",
        },
        { id: "b", route: "777-5054", lat: -28.0, lon: 153.4, timestamp: T },
        { id: "c", lat: -27.47, lon: 153.02 },
        { id: "d", route: "F1-4055", direction: 1, lat: -27.46, lon: 153.03, timestamp: T + 999 },
      ]),
    );
    const snap = feedToSnapshot(feed, T, new Map([["t1", 0]]));
    expect(snap.t).toBe(T);
    expect(snap.vehicles).toHaveLength(2);
    const [a, d] = snap.vehicles;
    expect(a).toMatchObject({ key: vehicleKey("a"), route: "199", dir: 0, ts: T - 10 });
    expect(a!.x).toBeCloseTo(toLocalX(153.02), -1);
    expect(a!.y).toBeCloseTo(toLocalY(-27.47), -1);
    // A fix stamped far in the future takes the feed's time instead.
    expect(d).toMatchObject({ route: "F1", dir: 1, ts: T });
    expect(JSON.stringify(snap)).not.toContain("label");
  });

  it("falls back to the clock when the header has no time", () => {
    const snap = feedToSnapshot(decodeFeed(buildFeed(0, [])), T + 0.4);
    expect(snap.t).toBe(T);
  });
});
