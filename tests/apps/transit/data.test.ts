import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REGION } from "../../../src/apps/transit/geo";
import type { PackedNetwork } from "../../../src/apps/transit/gtfs";
import {
  headsignOf,
  mergeNetworks,
  modeOf,
  shapesFor,
  unpackNetwork,
} from "../../../src/apps/transit/network";
import {
  decodeReplay,
  encodeReplay,
  type Replay,
  replayKey,
  replaySnapshot,
} from "../../../src/apps/transit/replay";
import { FEATURED } from "../../../src/apps/transit/routes";

const DATA = join(import.meta.dirname, "../../../src/apps/transit/data");
const bundledNet = JSON.parse(readFileSync(join(DATA, "network.json"), "utf8")) as PackedNetwork;
const bundledReplay = JSON.parse(readFileSync(join(DATA, "replay.json"), "utf8"));
const region: [number, number, number, number] = [
  REGION.west,
  REGION.south,
  REGION.east,
  REGION.north,
];

const tiny: Replay = {
  start: 1_792_675_000,
  duration: 120,
  every: 15,
  routes: ["60", "F1"],
  tracks: [
    {
      route: 0,
      dir: 1,
      t: Float64Array.from([0, 20, 40]),
      x: Float32Array.from([100, 200, 300]),
      y: Float32Array.from([10, 20, 30]),
    },
    {
      route: 1,
      dir: -1,
      t: Float64Array.from([50]),
      x: Float32Array.from([7]),
      y: Float32Array.from([8]),
    },
  ],
};

describe("replay", () => {
  it("round-trips through its packed form", () => {
    const back = decodeReplay(JSON.parse(JSON.stringify(encodeReplay(tiny))))!;
    expect(back.routes).toEqual(tiny.routes);
    expect(back.tracks[0]!.dir).toBe(1);
    expect(back.tracks[1]!.dir).toBe(-1);
    expect(Array.from(back.tracks[0]!.t)).toEqual([0, 20, 40]);
    expect(Array.from(back.tracks[0]!.x)).toEqual([100, 200, 300]);
  });

  it("rejects another region or malformed data, and skips bad tracks", () => {
    const packed = encodeReplay(tiny);
    expect(decodeReplay({ ...packed, region: [0, 0, 1, 1] })).toBeNull();
    expect(decodeReplay({ ...packed, duration: -1 })).toBeNull();
    expect(decodeReplay({ ...packed, v: 2 })).toBeNull();
    expect(decodeReplay(null)).toBeNull();
    const bad = decodeReplay({
      ...packed,
      tracks: [[0, 0, 1, 2], [9, 0, 0, 1, 1], ...packed.tracks],
    })!;
    expect(bad.tracks).toHaveLength(2);
  });

  it("gives each track's latest fix at or before the moment asked", () => {
    const s = replaySnapshot(tiny, 25, 0);
    expect(s.source).toBe("replay");
    expect(s.vehicles).toHaveLength(1);
    expect(s.vehicles[0]).toMatchObject({
      route: "60",
      dir: 1,
      x: 200,
      y: 20,
      ts: tiny.start + 20,
    });
    expect(replaySnapshot(tiny, 60, 0).vehicles.map((v) => v.route)).toEqual(["60", "F1"]);
  });

  it("drops a track that ended a while ago", () => {
    expect(replaySnapshot(tiny, 40 + 121, 0).vehicles.map((v) => v.route)).toEqual(["F1"]);
  });

  it("uses negative keys that differ between loops", () => {
    const a = replaySnapshot(tiny, 60, 3).vehicles[0]!;
    const b = replaySnapshot(tiny, 60, 4).vehicles[0]!;
    expect(a.key).toBeLessThan(0);
    expect(a.key).not.toBe(b.key);
    expect(replayKey(3, 0)).toBe(a.key);
    expect(a.ts).toBe(tiny.start + 3 * tiny.duration + 40);
  });

  it("bundles a recording for this region with vehicles all the way through", () => {
    const r = decodeReplay(bundledReplay)!;
    expect(r).not.toBeNull();
    expect(r.duration).toBeGreaterThanOrEqual(300);
    expect(r.tracks.length).toBeGreaterThan(50);
    for (let tau = 0; tau < r.duration; tau += 60) {
      expect(replaySnapshot(r, tau, 0).vehicles.length).toBeGreaterThan(20);
    }
  });
});

describe("network", () => {
  const packed: PackedNetwork = {
    v: 1,
    region,
    q: 2,
    routes: [
      ["60", 3],
      ["F1", 4],
      ["SHCL", 2],
    ],
    shapes: [
      [0, 0, 0, 0, 50, 0, 0, 50],
      [0, 1, 1, 1, 50, 0],
      [1, 0, 10, 10, 5, 5],
    ],
    headsigns: [
      ["City", "Suburb"],
      [null, null],
      [null, null],
    ],
  };

  it("unpacks routes, modes, shapes in metres and headsigns", () => {
    const n = unpackNetwork(packed, "daily")!;
    expect(modeOf(n, "60")).toBe("bus");
    expect(modeOf(n, "F1")).toBe("ferry");
    expect(modeOf(n, "SHCL")).toBe("train");
    expect(modeOf(n, "F11")).toBe("ferry");
    expect(modeOf(n, "BNFG")).toBe("train");
    expect(modeOf(n, "333")).toBe("bus");
    const s = n.byRoute.get("60")![0]!;
    expect(Array.from(s.pts)).toEqual([0, 0, 100, 0, 100, 100]);
    expect(s.cum[2]).toBe(200);
    expect(shapesFor(n, "60", 1)).toHaveLength(1);
    expect(shapesFor(n, "60", -1)).toHaveLength(2);
    expect(shapesFor(n, "F1", 1)).toHaveLength(1);
    expect(headsignOf(n, "60", 1)).toBe("Suburb");
    expect(headsignOf(n, "60", -1)).toBeNull();
  });

  it("rejects malformed or foreign data", () => {
    expect(unpackNetwork({ ...packed, region: [1, 2, 3, 4] }, "x")).toBeNull();
    expect(unpackNetwork({ ...packed, q: 0 }, "x")).toBeNull();
    expect(unpackNetwork("nope", "x")).toBeNull();
    const n = unpackNetwork(
      {
        ...packed,
        shapes: [
          [9, 0, 1, 1, 1, 1],
          [0, 0, 1],
          [0, 0, 1, "x", 2, 2],
        ],
      },
      "x",
    )!;
    expect(n.shapes).toHaveLength(0);
  });

  it("merges the day's network over the bundled one, keeping routes only the bundle has", () => {
    const daily = unpackNetwork(
      { ...packed, routes: [["60", 3]], shapes: [[0, 0, 0, 0, 9, 9]] },
      "daily",
    )!;
    const bundled = unpackNetwork(packed, "bundled")!;
    const m = mergeNetworks(daily, bundled);
    expect(m.source).toBe("daily");
    expect(m.byRoute.get("60")).toHaveLength(1);
    expect(m.byRoute.get("F1")).toHaveLength(1);
    expect(m.routes.has("SHCL")).toBe(true);
  });

  it("bundles a network with every featured line and no names", () => {
    const n = unpackNetwork(bundledNet, "bundled")!;
    expect(n).not.toBeNull();
    for (const line of FEATURED) {
      const bases = [...n.byRoute.keys()].filter((b) => line.has(b));
      expect(bases.length, line.id).toBeGreaterThan(0);
      expect(modeOf(n, bases[0]!)).toBe(line.mode);
    }
    expect(bundledNet.headsigns).toBeUndefined();
    // Route ids are the only strings in it.
    for (const [base] of bundledNet.routes) expect(base).toMatch(/^[A-Za-z0-9]{1,8}$/);
    for (const r of bundledReplay.routes as string[]) expect(r).toMatch(/^[A-Za-z0-9]{1,8}$/);
  });
});
