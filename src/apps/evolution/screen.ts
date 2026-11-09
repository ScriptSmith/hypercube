/**
 * The screen above a bank: the family tree of every fish in every island pond below, each pond's
 * living fish at the bottom edge directly above that pond, with the floor history and average
 * colour of each island behind its column. It sends a beacon every second so the frames know it
 * is there. With no touch frame heard for a few seconds it runs island ponds of its own, unseen,
 * and shows their tree, so it is never empty; the moment a frame is heard it shows the bank's.
 */
import type { AppContext, AppInstance, FrameInfo, PeerInfo } from "../../core/types";
import { activeVenue } from "../../core/venue";
import { BEACON_EVERY_MS, type Config, PANEL_FISH, TREE_CAP } from "./config";
import { FLOOR_LOOK } from "./art";
import { createFleet } from "./fleet";
import { FLOOR_ROTATION } from "./genes";
import { orderTips } from "./lineage";
import type { Box } from "./pond";
import { createTreeView, type TreeFrame, type TreeStyle } from "./treeview";
import { decodeHist, decodePond, encodeBeacon, TOPIC } from "./wire";
import { createWorld, type World } from "./world";

const HZ = 10;
/** With no touch frame heard for this long, the screen runs ponds of its own. */
export const DEMO_AFTER_MS = 3000;
/** Ponds of the screen's own when it doesn't know its bank: a bank of pairs. */
const unknownBank = () => Math.max(1, Math.floor(activeVenue().bankCount / 2));
const MAX_DEMO = 10;
const TREE_MS = 100;

export const mountScreen = (ctx: AppContext, config: Config): AppInstance => {
  const side = ctx.setup.side ?? 0;
  const clock = () => ctx.clock.now();
  const fleet = createFleet();
  const treeView = createTreeView();
  let frame: FrameInfo = ctx.frame;
  let demo: World | null = null;
  const mountedAt = performance.now();
  let lastHeard = Number.NEGATIVE_INFINITY;
  let received = 0;
  let beaconAt = 0;
  let treeAt = 0;
  let lastDraw = 0;
  let disposed = false;

  const c = document.createElement("canvas");
  c.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
  ctx.root.append(c);
  const g = c.getContext("2d");
  let W = 1;
  let H = 1;
  let k = 1;

  const size = () => {
    W = frame.width / frame.unit;
    H = frame.height / frame.unit;
    k = frame.unit * frame.pixelRatio;
    c.width = Math.max(1, Math.round(frame.width * frame.pixelRatio));
    c.height = Math.max(1, Math.round(frame.height * frame.pixelRatio));
  };
  size();

  const isTouchFrame = (p: PeerInfo) =>
    p.role !== "screen" && p.frame !== ctx.net.self && (p.side ?? 0) === side;
  const touchFrame = (from: string) => {
    const p = ctx.net.peers().find((x) => x.frame === from);
    return !!p && isTouchFrame(p);
  };

  // ---- The screen's own ponds ---------------------------------------------------------------

  const demoColumns = () =>
    Math.min(MAX_DEMO, ctx.setup.count > 1 ? ctx.setup.count : unknownBank());

  const startDemo = () => {
    const n = demoColumns();
    demo = createWorld({
      specs: Array.from({ length: n }, (_, i) => ({
        island: i,
        box: { x: 0, y: 0, w: 900, h: 700 },
        target: PANEL_FISH,
        fish: 84,
        floor: FLOOR_ROTATION[i % FLOOR_ROTATION.length]!,
      })),
      config,
      rng: ctx.rng("evolution:screen"),
      stamp: clock,
      cap: TREE_CAP.screen,
    });
    treeView.clear();
  };

  const stopDemo = () => {
    demo?.dispose();
    demo = null;
    treeView.clear();
  };

  // ---- Touch frames -------------------------------------------------------------------------

  const offs = [
    ctx.net.on(TOPIC.pond, (data, from) => {
      if (disposed || !touchFrame(from)) return;
      const m = decodePond(data);
      if (!m) return;
      const now = performance.now();
      if (demo) stopDemo();
      fleet.accept(m, from, now);
      received++;
      lastHeard = now;
    }),
    ctx.net.on(TOPIC.hist, (data, from) => {
      if (disposed || !touchFrame(from)) return;
      const m = decodeHist(data);
      if (m) fleet.history(m, from);
    }),
  ];

  const look = (now: number) => {
    if (demo || fleet.frames > 0 || now - lastHeard <= DEMO_AFTER_MS) return;
    const touchFrames = ctx.net.peers().some(isTouchFrame);
    if (!touchFrames || now - mountedAt > DEMO_AFTER_MS) startDemo();
  };

  // ---- Drawing ------------------------------------------------------------------------------

  const style = (): TreeStyle => ({
    line: 9,
    window: 15 * 60_000,
    gamma: 0.6,
    strip: 26,
    label: 52,
  });

  const treeBox = (): Box => ({ x: 40, y: 150, w: W - 80, h: H - 150 - 90 });

  const frameFor = (): { tree: TreeFrame; floors: { x0: number; x1: number; color: string }[] } => {
    const box = treeBox();
    const x0: number[] = [];
    const x1: number[] = [];
    const extents: [number, number][] = [];
    const bands = [];
    const floors: { x0: number; x1: number; color: string }[] = [];
    if (demo) {
      const n = demo.ponds.length;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * W;
        const b = ((i + 1) / n) * W;
        x0.push(a + (b - a) * 0.1);
        x1.push(b - (b - a) * 0.1);
        extents.push([a + 6, b - 6]);
        bands.push(demo.bands[i] ?? null);
        floors.push({ x0: a + 6, x1: b - 6, color: FLOOR_LOOK[demo.ponds[i]!.floor].body });
      }
    } else {
      const cols = fleet.columns(1);
      for (let i = 0; i < cols; i++) {
        const a = (i / cols) * W;
        const b = ((i + 1) / cols) * W;
        x0.push(a + (b - a) * 0.1);
        x1.push(b - (b - a) * 0.1);
        extents.push([a + 6, b - 6]);
        bands.push(fleet.bands.get(i) ?? null);
      }
      // Islands place their tips exactly over their ponds.
      for (const s of fleet.islands()) {
        if (s.island >= cols) continue;
        const count = Math.max(1, ctx.setup.count > 1 ? ctx.setup.count : s.count);
        const a = ((s.pos + s.u0) / count) * W;
        const b = ((s.pos + s.u1) / count) * W;
        x0[s.island] = a;
        x1[s.island] = b;
        extents[s.island] = [a - 10, b + 10];
        floors.push({ x0: a - 10, x1: b + 10, color: FLOOR_LOOK[s.floor].body });
      }
    }
    return {
      tree: { box, cols: { x0, x1 }, extents, bands, now: clock() },
      floors,
    };
  };

  const draw = (now: number) => {
    if (!g) return;
    const dt = lastDraw ? Math.min(0.5, (now - lastDraw) / 1000) : 0;
    lastDraw = now;
    const lin = demo ? demo.lineage : fleet.lineage;
    if (demo) {
      demo.columns();
      treeView.fade(demo.prune(clock()), clock());
    } else {
      treeView.fade(fleet.prune(now, clock(), TREE_CAP.screen), clock());
    }
    // The bank's frames choose their own tip order; only the screen's own ponds need one.
    if (demo) orderTips(lin);
    const { tree, floors } = frameFor();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = "#0b1219";
    g.fillRect(0, 0, c.width, c.height);
    g.setTransform(k, 0, 0, k, 0, 0);
    g.fillStyle = "rgba(200,214,230,0.7)";
    g.font = "700 64px system-ui, sans-serif";
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillText("Family tree of the fish below", 60, 80);
    treeView.draw(g, lin, tree, style(), dt);
    for (const f of floors) {
      g.fillStyle = f.color;
      g.fillRect(f.x0, H - 40, f.x1 - f.x0, 40);
    }
  };

  const loop = ctx.loop({
    hz: HZ,
    update(dt) {
      if (disposed) return;
      demo?.step(dt, false);
      demo?.drain();
    },
    render() {
      if (disposed) return;
      const now = performance.now();
      if (now - beaconAt >= BEACON_EVERY_MS && ctx.net.online) {
        beaconAt = now;
        ctx.net.send(TOPIC.beacon, encodeBeacon(side));
      }
      look(now);
      if (now - treeAt >= TREE_MS) {
        treeAt = now;
        draw(now);
      }
    },
  });
  loop.start();

  const offResize = ctx.onResize((f) => {
    frame = f;
    size();
    treeAt = 0;
  });

  const debugKey = "__evolution";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => {
          const lin = demo ? demo.lineage : fleet.lineage;
          let leaves = 0;
          for (const n of lin.nodes()) if (n.died === null) leaves++;
          return {
            screen: true,
            demo: demo !== null,
            frames: fleet.frames,
            received,
            transit: fleet.transit,
            columns: demo ? demo.ponds.length : fleet.columns(1),
            nodes: lin.size,
            leaves,
            islands: fleet.islands().map((s) => ({
              island: s.island,
              pos: s.pos,
              fish: s.ids.length,
              floor: s.floor,
            })),
            ghosts: treeView.ghosts,
          };
        },
        where(id: number) {
          const n = (demo ? demo.lineage : fleet.lineage).get(id);
          return n ? { col: n.col, alive: n.died === null } : null;
        },
      },
    });
  }

  return {
    reset() {
      if (demo) demo.fresh();
      treeView.clear();
    },
    attract() {
      demo?.homeFloors(8);
    },
    status() {
      const lin = demo ? demo.lineage : fleet.lineage;
      let fish = 0;
      for (const n of lin.nodes()) if (n.died === null) fish++;
      return { frames: fleet.frames, fish, nodes: lin.size, demo: demo !== null, received };
    },
    dispose() {
      disposed = true;
      loop.stop();
      for (const off of offs) off();
      offResize();
      demo?.dispose();
      demo = null;
      fleet.clear();
      treeView.clear();
      c.width = c.height = 0;
      c.remove();
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
