#!/usr/bin/env node
// Builds the transit app's bundled data from public sources.
//
//   node scripts/transit-record.mjs network [--gtfs=<dir>]
//   node scripts/transit-record.mjs replay [--minutes=10] [--every=15] [--gtfs=<dir>]
//
// `network` reads brisbus's daily copy of the static GTFS (routes, trips, shapes) and writes
// src/apps/transit/data/network.json: route ids, route types and one simplified shape per route
// and direction inside the region. `replay` reads the realtime feed through brisbus's proxy every
// `every` seconds for `minutes` and writes src/apps/transit/data/replay.json: route ids and
// positions only. Neither file holds any names (no stops, headsigns, long names or vehicle
// labels). --gtfs reads routes.txt, trips.txt and shapes.txt (or .txt.gz) from a folder instead
// of downloading them. Record the replay on a weekday during the day, when the fleet is busiest. The proxy is on a free tier: one recording is a few dozen
// requests, so don't loop this.
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { importTs, ROOT } from "./lib/apps.mjs";

const STATIC_BASE = "https://brisbus.com/data/";
const FEED_URL = "https://brisbus.adsm.dev/";
const OUT = join(ROOT, "src/apps/transit/data");
const APP = join(ROOT, "src/apps/transit");

const args = process.argv.slice(2);
const flags = Object.fromEntries(
  args
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const eq = a.indexOf("=");
      return eq < 0 ? [a.slice(2), "true"] : [a.slice(2, eq), a.slice(eq + 1)];
    }),
);
const command = args.find((a) => !a.startsWith("--")) ?? "";
if (!["network", "replay"].includes(command)) {
  console.error(
    "Usage: node scripts/transit-record.mjs network|replay [--minutes=10] [--every=15] [--gtfs=<dir>]",
  );
  process.exit(2);
}

const gtfs = await importTs(join(APP, "gtfs.ts"));
const geo = await importTs(join(APP, "geo.ts"));
const pbf = await importTs(join(APP, "pbf.ts"));
const replay = await importTs(join(APP, "replay.ts"));

const openCsv = async (name) => {
  const dir = flags.gtfs;
  if (dir) {
    for (const [file, gzip] of [
      [`${name}.txt`, false],
      [`${name}.txt.gz`, true],
    ]) {
      const path = join(dir, file);
      if (existsSync(path)) return { body: Readable.toWeb(createReadStream(path)), gzip };
    }
    throw new Error(`no ${name}.txt or ${name}.txt.gz in ${dir}`);
  }
  const res = await fetch(`${STATIC_BASE}${name}.txt.gz`);
  if (!res.ok || !res.body) throw new Error(`${name}.txt.gz: HTTP ${res.status}`);
  return { body: res.body, gzip: true };
};

const loadStatic = async (builder, withShapes) => {
  for (const [name, row] of [
    ["routes", builder.route],
    ["trips", builder.trip],
    ...(withShapes ? [["shapes", builder.shapePoint]] : []),
  ]) {
    const t0 = performance.now();
    const { body, gzip } = await openCsv(name);
    await gtfs.readCsvStream(body, gzip, row);
    console.log(`  ${name}.txt read in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  }
};

const write = (file, data) => {
  const path = join(OUT, file);
  writeFileSync(path, `${JSON.stringify(data)}\n`);
  execFileSync(join(ROOT, "node_modules/.bin/oxfmt"), [path], { stdio: "ignore" });
  console.log(`Wrote ${path}`);
};

if (command === "network") {
  const builder = gtfs.createNetworkBuilder({ tolerance: 10, quantum: 2, headsigns: false });
  await loadStatic(builder, true);
  const net = builder.build();
  const points = net.shapes.reduce((n, s) => n + (s.length - 2) / 2, 0);
  console.log(`${net.routes.length} routes, ${net.shapes.length} shape runs, ${points} points`);
  write("network.json", net);
}

if (command === "replay") {
  const minutes = Number(flags.minutes ?? 10);
  const every = Number(flags.every ?? 15);
  if (!(minutes > 0 && minutes <= 30 && every >= 10 && every <= 60)) {
    console.error("--minutes must be 1 to 30 and --every 10 to 60");
    process.exit(2);
  }
  const builder = gtfs.createNetworkBuilder({ tolerance: 10, quantum: 2, headsigns: false });
  await loadStatic(builder, false);
  const routes = [];
  const routeIndex = new Map();
  const tracks = [];
  const open = new Map();
  let start = 0;
  let last = 0;
  const rounds = Math.round((minutes * 60) / every) + 1;
  for (let i = 0; i < rounds; i++) {
    const began = Date.now();
    try {
      const res = await fetch(FEED_URL, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const feed = pbf.decodeFeed(new Uint8Array(await res.arrayBuffer()));
      const now = feed.timestamp || Math.round(began / 1000);
      if (!start) start = now;
      last = now;
      let seen = 0;
      for (const v of feed.vehicles) {
        if (!v.routeId || !geo.inRegionLonLat(v.lon, v.lat)) continue;
        const ts = v.timestamp || now;
        if (ts < start - 60) continue;
        seen++;
        const base = gtfs.routeBase(v.routeId);
        let ri = routeIndex.get(base);
        if (ri === undefined) {
          ri = routes.length;
          routes.push(base);
          routeIndex.set(base, ri);
        }
        const dir = v.tripId ? (builder.tripDirection.get(v.tripId) ?? -1) : -1;
        let tr = open.get(v.id);
        if (!tr || tr.route !== ri) {
          tr = { route: ri, dir, t: [], x: [], y: [] };
          tracks.push(tr);
          open.set(v.id, tr);
        }
        const t = Math.max(0, ts - start);
        if (tr.t.length && t <= tr.t[tr.t.length - 1]) continue;
        tr.t.push(t);
        tr.x.push(Math.round(geo.toLocalX(v.lon)));
        tr.y.push(Math.round(geo.toLocalY(v.lat)));
      }
      console.log(`  fetch ${i + 1}/${rounds}: ${seen} vehicles in the region`);
    } catch (err) {
      console.warn(`  fetch ${i + 1}/${rounds} failed: ${String(err)}`);
    }
    if (i < rounds - 1) {
      await new Promise((r) => setTimeout(r, Math.max(0, every * 1000 - (Date.now() - began))));
    }
  }
  if (!start || tracks.length === 0) {
    console.error("No vehicles recorded");
    process.exit(1);
  }
  const data = replay.encodeReplay({
    start,
    duration: Math.max(every, last - start),
    every,
    routes,
    tracks: tracks.map((tr) => ({
      route: tr.route,
      dir: tr.dir,
      t: Float64Array.from(tr.t),
      x: Float32Array.from(tr.x),
      y: Float32Array.from(tr.y),
    })),
  });
  console.log(`${tracks.length} tracks over ${data.duration} s on ${routes.length} routes`);
  write("replay.json", data);
}
