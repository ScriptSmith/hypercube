import { describe, expect, test } from "vitest";
import { HOSTED_VIEWER, parseViewerMessage, viewerUrl } from "../../../src/apps/graphs/bridge";
import manifest from "../../../src/apps/graphs/manifest";
import { GRAPHS, graphById, nextGraph } from "../../../src/apps/graphs/graphs";
import { iconSvg } from "../../../src/apps/graphs/icons";
import { arrange, levels, place, placeFixed } from "../../../src/apps/graphs/layout";
import { regionsFor } from "../../../src/apps/graphs/regions";
import { neighboursOf, nextOnTour } from "../../../src/apps/graphs/tour";
import { buildWorkspace } from "../../../src/apps/graphs/workspace";
import { createRng } from "../../../src/core/rng";

describe.each(GRAPHS)("graph $id", (def) => {
  const ids = def.nodes.map((n) => n.id);

  test("is a consistent graph", () => {
    expect(new Set(ids).size).toBe(ids.length);
    expect(def.sources.length).toBeGreaterThan(0);
    expect(def.title.length).toBeLessThan(30);
    expect(def.caption.length).toBeLessThan(60);
    const roles = new Set(def.roles.map((r) => r.id));
    for (const n of def.nodes) {
      expect(roles.has(n.role), `${n.id} role`).toBe(true);
      expect(n.note.length).toBeGreaterThan(10);
      expect(n.note.length).toBeLessThan(90);
      expect(n.note).not.toMatch(/—/);
    }
    for (const r of def.roles) expect(r.color).toMatch(/^#[0-9a-f]{6}$/);
    const seen = new Set<string>();
    for (const [a, b] of def.edges) {
      expect(ids).toContain(a);
      expect(ids).toContain(b);
      expect(a).not.toBe(b);
      expect(seen.has(`${a}>${b}`), `duplicate ${a}>${b}`).toBe(false);
      seen.add(`${a}>${b}`);
    }
    // every node is linked, so nothing floats loose
    const linked = new Set(def.edges.flat());
    for (const id of ids) expect(linked.has(id), `${id} linked`).toBe(true);
  });

  test.skipIf(def.layout === "fixed")("has no loops, and every edge climbs a level", () => {
    const level = levels(ids, def.edges);
    for (const [a, b] of def.edges) expect(level.get(b)!).toBeGreaterThan(level.get(a)!);
    const top = Math.max(...level.values());
    expect(top).toBeLessThan(ids.length);
  });

  test.each([
    ["up", { width: 432, height: 560 }],
    ["right", { width: 2592, height: 436 }],
  ] as const)("lays out %s inside its region, apart, in order", (direction, region) => {
    const fixed = def.layout === "fixed";
    if (fixed) for (const n of def.nodes) expect(n.pos, `${n.id} pos`).toBeDefined();
    const { points, radius } = fixed
      ? placeFixed(new Map(def.nodes.map((n) => [n.id, n.pos!])), region)
      : place(arrange(ids, def.edges), region, direction);
    expect(points.size).toBe(ids.length);
    for (const p of points.values()) {
      expect(p.x - radius).toBeGreaterThanOrEqual(0);
      expect(p.x + radius).toBeLessThanOrEqual(region.width);
      expect(p.y - radius).toBeGreaterThanOrEqual(0);
      expect(p.y + radius).toBeLessThanOrEqual(region.height);
    }
    const all = [...points.values()];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const d = Math.hypot(all[i]!.x - all[j]!.x, all[i]!.y - all[j]!.y);
        expect(d, "nodes overlap").toBeGreaterThan(radius * 2);
      }
    }
    for (const [a, b] of fixed ? [] : def.edges) {
      if (direction === "up") expect(points.get(b)!.y).toBeLessThan(points.get(a)!.y);
      else expect(points.get(b)!.x).toBeGreaterThan(points.get(a)!.x);
    }
  });

  test("builds a workspace the viewer can read", () => {
    const region = { width: 432, height: 560, direction: "up" } as const;
    const ws = JSON.parse(buildWorkspace(def, region));
    expect(ws.format).toBe("network-graph-viewer");
    expect(ws.doc.nodes.rows).toHaveLength(ids.length);
    expect(ws.doc.edges.rows).toHaveLength(def.edges.length);
    const columns = ws.doc.nodes.columns.map((c: { name: string }) => c.name);
    for (const key of ["Id", "Name", "Colour", "Icon"]) expect(columns).toContain(key);
    expect(ws.style.nodeImage).toBe("column:Icon");
    expect(ws.style.nodeColor).toBe("cell:Colour");
    expect(Object.keys(ws.positions).sort()).toEqual([...ids].sort());
    expect(ws.pinned.sort()).toEqual([...ids].sort());
    // a workspace travels in a message and a link, so it stays small
    expect(buildWorkspace(def, region).length).toBeLessThan(60_000);
  });

  test("the tour follows the links and never stalls", () => {
    const rng = createRng(7);
    let at: string | null = null;
    const targets = new Set(def.edges.map(([, b]) => b));
    for (let i = 0; i < 200; i++) {
      const next = nextOnTour(def, at, rng);
      expect(ids).toContain(next);
      if (def.directed === false) {
        if (at !== null) {
          expect(
            def.edges.some(([a, b]) => (a === at && b === next) || (b === at && a === next)),
          ).toBe(true);
        }
      } else if (at !== null && def.edges.some(([a]) => a === at)) {
        expect(def.edges.some(([a, b]) => a === at && b === next)).toBe(true);
      } else {
        expect(targets.has(next), `${next} is a source`).toBe(false);
      }
      at = next;
    }
  });

  test("names what a node eats and what eats it", () => {
    for (const n of def.nodes) {
      const { inbound, outbound } = neighboursOf(def, n.id);
      expect(inbound.length + outbound.length).toBeGreaterThan(0);
      if (def.directed === false) expect(inbound).toEqual([]);
    }
  });
});

describe.each(GRAPHS)("icons of $id", (def) => {
  test("every node has one, and it is plain self-contained SVG", () => {
    for (const n of def.nodes) {
      const icon = def.icons[n.icon];
      expect(icon, `${n.id} icon ${n.icon}`).toBeDefined();
      const svg = iconSvg(icon!, "#336699");
      expect(svg.startsWith("<svg ")).toBe(true);
      expect(svg.endsWith("</svg>")).toBe(true);
      expect(svg).not.toMatch(/<script|href=|xlink|<image|<style|javascript:|on\w+=/i);
      expect(svg.match(/</g)!.length).toBeGreaterThan(4);
    }
  });
});

test("the card takes a side column on a wall and a kiosk, and a strip on a panel", () => {
  const base = { unit: 1, seams: [] as number[], card: true };
  const wall = regionsFor({ ...base, kind: "wall", width: 5760, height: 2160, reachTop: 1200 });
  expect(wall.viewer.y).toBe(0);
  expect(wall.viewer.height).toBe(2160);
  expect(wall.card.x + wall.card.width).toBe(wall.viewer.x);
  expect(wall.card.height).toBe(2160);
  expect(wall.direction).toBe("up");
  const panel = regionsFor({ ...base, kind: "panel", width: 1080, height: 1920, reachTop: 0 });
  expect(panel.viewer.y + panel.viewer.height).toBeLessThanOrEqual(panel.card.y);
  expect(panel.direction).toBe("up");
  const pair = regionsFor({
    ...base,
    kind: "pair",
    width: 2160,
    height: 1920,
    reachTop: 0,
    seams: [1080],
  });
  expect(pair.card.x + pair.card.width).toBeLessThanOrEqual(1080);
  const kiosk = regionsFor({ ...base, kind: "kiosk", width: 1920, height: 1080, reachTop: 0 });
  expect(kiosk.card.x + kiosk.card.width).toBeLessThanOrEqual(kiosk.viewer.x);
});

test("without a card the viewer takes the whole frame", () => {
  const g = { unit: 1, seams: [] as number[], card: false };
  const panel = regionsFor({ ...g, kind: "panel", width: 1080, height: 1920, reachTop: 0 });
  expect(panel.viewer).toEqual({ x: 0, y: 0, width: 1080, height: 1920 });
  const kiosk = regionsFor({ ...g, kind: "kiosk", width: 1920, height: 1080, reachTop: 0 });
  expect(kiosk.viewer).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
});

test("reset and Home sit inside the frame, apart, and a screen has no reset", () => {
  const base = { unit: 1, seams: [] as number[], card: true };
  const cases = [
    { kind: "panel", width: 1080, height: 1920, reachTop: 0 },
    { kind: "pair", width: 2160, height: 1920, reachTop: 0, seams: [1080] },
    { kind: "kiosk", width: 1920, height: 1080, reachTop: 0 },
    { kind: "wall", width: 5760, height: 2160, reachTop: 1200 },
  ] as const;
  for (const c of cases) {
    const r = regionsFor({ ...base, ...c });
    for (const b of [r.reset, r.layout, r.home]) {
      if (!b) continue;
      expect(b.width).toBeGreaterThanOrEqual(120);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(c.width);
      expect(b.y + b.height).toBeLessThanOrEqual(c.height);
    }
    if (c.kind === "wall") expect(r.reset.y).toBeGreaterThanOrEqual(c.reachTop);
    const edge = regionsFor({ ...base, ...c, buttons: "left" });
    expect(edge.reset.x).toBeLessThan(r.reset.x);
    expect(edge.reset.x).toBeGreaterThanOrEqual(edge.viewer.x);
    expect(r.layout.y + r.layout.height, `${c.kind} layout above reset`).toBeLessThanOrEqual(
      r.reset.y,
    );
    if (c.kind === "wall") expect(r.layout.y).toBeGreaterThanOrEqual(c.reachTop);
    if (r.home) {
      const apart = r.home.x + r.home.width <= r.reset.x || r.reset.x + r.reset.width <= r.home.x;
      expect(apart, `${c.kind} home and reset`).toBe(true);
    }
  }
  expect(
    regionsFor({ ...base, kind: "screen", width: 4000, height: 3600, reachTop: 0 }).reset.width,
  ).toBe(0);
});

test("viewer messages are checked", () => {
  expect(parseViewerMessage({ ngv: 1, type: "ready" })).toEqual({ type: "ready" });
  expect(parseViewerMessage({ ngv: 1, type: "select", id: null })).toEqual({
    type: "select",
    id: null,
  });
  expect(parseViewerMessage({ ngv: 1, type: "select", id: 4 })).toBeNull();
  expect(parseViewerMessage({ ngv: 2, type: "ready" })).toBeNull();
  expect(parseViewerMessage("ready")).toBeNull();
  expect(parseViewerMessage({ ngv: 1, type: "loaded", nodes: 3, edges: 2 })).toEqual({
    type: "loaded",
    nodes: 3,
    edges: 2,
  });
});

test("the viewer URL asks for a kiosk step, and defaults to the published site", () => {
  const url = new URL(viewerUrl({ level: "touch", expand: false }));
  expect(url.origin + url.pathname).toBe("https://adamsm.com/network-graph-viewer/");
  expect(url.searchParams.get("kiosk")).toBe("touch");
  expect(url.searchParams.get("card")).toBe("0");
  expect(url.searchParams.get("expand")).toBe("0");
  const other = new URL(viewerUrl({ level: "panels", expand: true }, HOSTED_VIEWER + "x/"));
  expect(other.pathname).toBe("/network-graph-viewer/x/");
  expect(other.searchParams.get("expand")).toBe("1");
});

test("the manifest lists every graph as a variant", () => {
  expect(manifest.variants).toEqual(
    GRAPHS.map((g) => ({ id: g.id, title: g.title, blurb: g.blurb })),
  );
});

test("the rotation visits every graph and wraps", () => {
  let at = GRAPHS[0]!;
  const seen = new Set<string>();
  for (let i = 0; i < GRAPHS.length; i++) {
    seen.add(at.id);
    at = nextGraph(at.id);
  }
  expect(seen.size).toBe(GRAPHS.length);
  expect(at.id).toBe(GRAPHS[0]!.id);
  expect(graphById("no-such-graph").id).toBe(GRAPHS[0]!.id);
});
