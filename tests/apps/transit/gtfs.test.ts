import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { toLocalX, toLocalY } from "../../../src/apps/transit/geo";
import {
  clipToRegion,
  createCsvReader,
  createNetworkBuilder,
  parseCsvLine,
  readCsvStream,
  routeBase,
  simplify,
} from "../../../src/apps/transit/gtfs";
import { unpackNetwork } from "../../../src/apps/transit/network";

const rows = (text: string, chunk = 7) => {
  const out: string[][] = [];
  const r = createCsvReader((row) => out.push(row));
  for (let i = 0; i < text.length; i += chunk) r.push(text.slice(i, i + chunk));
  r.end();
  return out;
};

const stream = (bytes: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += 1000) c.enqueue(bytes.subarray(i, i + 1000));
      c.close();
    },
  });

describe("CSV", () => {
  it("splits quoted fields and doubled quotes", () => {
    expect(parseCsvLine('a,"b, c","say ""hi""",')).toEqual(["a", "b, c", 'say "hi"', ""]);
    expect(parseCsvLine("1,2,3")).toEqual(["1", "2", "3"]);
  });

  it("reads rows across chunk boundaries, with CRLF, a BOM and blank lines", () => {
    const text = '﻿id,name\r\n1,"x, y"\r\n\r\n2,z\r\n3,w';
    const cols: string[][] = [];
    const r = createCsvReader((row, c) => cols.push([...c.keys()]) && void row);
    r.push(text);
    r.end();
    expect(cols[0]).toEqual(["id", "name"]);
    expect(rows(text)).toEqual([
      ["1", "x, y"],
      ["2", "z"],
      ["3", "w"],
    ]);
  });

  it("streams a gzipped file", async () => {
    const text = `a,b\n${Array.from({ length: 2000 }, (_, i) => `${i},${i * 2}`).join("\n")}\n`;
    const out: string[][] = [];
    await readCsvStream(stream(gzipSync(text)), true, (row) => out.push(row));
    expect(out).toHaveLength(2000);
    expect(out[1999]).toEqual(["1999", "3998"]);
  });
});

describe("shapes", () => {
  it("simplifies within the tolerance and keeps the ends", () => {
    const pts: number[] = [];
    for (let i = 0; i <= 100; i++) pts.push(i * 10, Math.sin(i / 3) * 2);
    const s = simplify(pts, 5);
    expect(s.length).toBe(4);
    expect(s.slice(0, 2)).toEqual([0, 0]);
    expect(s.slice(-2)).toEqual(pts.slice(-2));
    const bend = simplify([0, 0, 50, 40, 100, 0], 5);
    expect(bend).toHaveLength(6);
  });

  it("clips to the region, splitting where a shape leaves and comes back", () => {
    const runs = clipToRegion([10, 10, 20, 20, -9000, 20, 30, 30, 40, 40, 50, 50], 1000);
    expect(runs).toEqual([
      [10, 10, 20, 20],
      [30, 30, 40, 40, 50, 50],
    ]);
  });

  it("strips the timetable version from route ids", () => {
    expect(routeBase("199-5146")).toBe("199");
    expect(routeBase("SHCL-5257")).toBe("SHCL");
    expect(routeBase("F1")).toBe("F1");
  });
});

describe("network builder", () => {
  const ROUTES =
    "route_id,route_short_name,route_long_name,route_type\n60-1,60,Long name,3\n60-2,60,Long name,3\nF1-1,F1,Ferry name,4\n";
  const TRIPS =
    "route_id,service_id,trip_id,trip_headsign,direction_id,shape_id\n" +
    '60-1,s,t1,"Here",0,A\n60-2,s,t2,Here,0,A\n60-1,s,t3,There,0,B\n60-1,s,t4,Back,1,C\nF1-1,s,t5,Wharf,0,F\n';
  const pt = (id: string, seq: number, lon: number, lat: number) => `${id},${lat},${lon},${seq}`;
  const SHAPES =
    "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n" +
    [
      pt("A", 2, 153.03, -27.47),
      pt("A", 1, 153.02, -27.47),
      pt("A", 3, 153.03, -27.46),
      pt("B", 1, 153.0, -27.5),
      pt("B", 2, 153.01, -27.5),
      pt("C", 1, 153.03, -27.46),
      pt("C", 2, 153.02, -27.47),
      pt("F", 1, 154.5, -27.47),
      pt("F", 2, 154.6, -27.47),
    ].join("\n");

  const build = (headsigns: boolean) => {
    const b = createNetworkBuilder({ tolerance: 1, quantum: 1, headsigns });
    for (const [text, row] of [
      [ROUTES, b.route],
      [TRIPS, b.trip],
      [SHAPES, b.shapePoint],
    ] as const) {
      const r = createCsvReader(row);
      r.push(text);
      r.end();
    }
    return { b, net: b.build() };
  };

  it("keeps the commonest shape per route and direction, in point order, inside the region", () => {
    const { b, net } = build(false);
    expect(net.routes.map((r) => r[0]).sort()).toEqual(["60", "F1"]);
    const n = unpackNetwork(net, "x")!;
    const shapes = n.byRoute.get("60")!;
    expect(shapes.map((s) => s.dir).sort()).toEqual([0, 1]);
    const dir0 = shapes.find((s) => s.dir === 0)!;
    expect(dir0.pts[0]).toBeCloseTo(toLocalX(153.02), -1);
    expect(dir0.pts[1]).toBeCloseTo(toLocalY(-27.47), -1);
    expect(dir0.pts.length).toBe(6);
    // The ferry's shape lies outside the region: the route stays, without a shape.
    expect(n.byRoute.has("F1")).toBe(false);
    expect(n.routes.get("F1")!.mode).toBe("ferry");
    expect(b.tripDirection.get("t4")).toBe(1);
    expect(net.headsigns).toBeUndefined();
  });

  it("keeps the commonest headsign per direction only when asked", () => {
    const { net } = build(true);
    const n = unpackNetwork(net, "x")!;
    expect(n.routes.get("60")!.headsigns).toEqual(["Here", "Back"]);
  });
});
