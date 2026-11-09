/**
 * Evolution: Heron Pond. Wires the pieces together:
 *
 * - genes.ts    what a fish inherits, how it looks and how much it stands out from a floor
 * - pond.ts     one pond's fish, swimming, hatching, herons and floors; world.ts a frame's ponds
 * - lineage.ts  the family tree; treeview.ts draws it
 * - layout.ts, view.ts, art.ts   where things go and drawing; bots.ts injected taps
 * - link.ts, wire.ts   the bank: frames send their ponds to the screen above (screen.ts, fleet.ts)
 *   and pass migrants to their neighbours
 *
 * A touch frame owns its ponds. In a bank it also sends them to the screen, which draws the whole
 * bank's tree; while no screen answers it draws its own.
 */
import type { AppContext, AppInstance, FrameInfo, Pointer } from "../../core/types";
import { createBots, type Bots } from "./bots";
import { type Config, HAND_PX, HAND_S, readConfig, TREE_CAP } from "./config";
import { FLOOR_ROTATION } from "./genes";
import { orderTips } from "./lineage";
import { hitAt, type Layout, layoutFor, type LayoutInput } from "./layout";
import { createLink, type Link } from "./link";
import { mountScreen } from "./screen";
import { createTreeView, type TreeFrame, type TreeStyle } from "./treeview";
import { createFrameView, type TopMode } from "./view";
import { createWorld, type WorldEvent } from "./world";

const HZ = 30;
const ORDER_MS = 250;
/** A pond untouched this long shows the tap hint. */
const HINT_S = 20;
const MAX_PENDING = 256;

export const mount = (ctx: AppContext): AppInstance => {
  const config = readConfig(ctx.options);
  if (ctx.frame.kind === "screen" || ctx.setup.role === "screen") return mountScreen(ctx, config);
  return mountFrame(ctx, config);
};

const inputOf = (f: FrameInfo, config: Config): LayoutInput => {
  const u = f.unit;
  return {
    kind: f.kind,
    width: f.width / u,
    height: f.height / u,
    reachTop: { adult: f.reachTop.adult / u, child: f.reachTop.child / u },
    seams: f.seams.map((s) => s / u),
    ponds: config.ponds,
  };
};

const styleFor = (kind: FrameInfo["kind"]): TreeStyle =>
  kind === "wall"
    ? { line: 6, window: 15 * 60_000, gamma: 0.6, strip: 16, label: 30 }
    : { line: 4.5, window: 10 * 60_000, gamma: 0.6, strip: 10, label: 22 };

const mountFrame = (ctx: AppContext, config: Config): AppInstance => {
  const setup = ctx.setup;
  let frame = ctx.frame;
  const inBank = setup.name === "bank" && (frame.kind === "panel" || frame.kind === "pair");
  const clock = () => ctx.clock.now();
  let layout: Layout = layoutFor(inputOf(frame, config));
  const per = layout.ponds.length;
  const islandOf = (i: number) => (inBank ? setup.pos * per + i : i);

  let link: Link | null = null;
  const world = createWorld({
    specs: layout.ponds.map((pl, i) => ({
      island: islandOf(i),
      box: { ...pl.box },
      target: layout.target,
      fish: layout.fish,
      floor: FLOOR_ROTATION[islandOf(i) % FLOOR_ROTATION.length]!,
    })),
    config,
    rng: ctx.rng("evolution"),
    stamp: clock,
    cap: frame.kind === "wall" ? TREE_CAP.wall : TREE_CAP.panel,
    outside: (pond, edge) => link?.outside(pond, edge) ?? false,
    emigrate: (pond, edge, m) => link?.emigrate(pond, edge, m) ?? false,
  });
  if (inBank) {
    link = createLink({
      net: ctx.net,
      side: setup.side ?? 0,
      pos: setup.pos,
      count: Math.max(1, setup.count),
      world,
      layout: () => layout,
      clock,
    });
  }

  const treeView = createTreeView();
  const view = createFrameView(ctx.root, treeView);
  view.setup(frame, layout);
  let bots: Bots | null =
    ctx.bots > 0
      ? createBots({
          input: ctx.input,
          count: ctx.bots,
          ponds: () => world.ponds,
          layout: () => layout,
          unit: () => frame.unit,
          rng: ctx.rng("evolution:bots"),
        })
      : null;

  const pending: WorldEvent[] = [];
  const recent: { x: number; y: number; t: number }[] = [];
  const counts = { caught: 0, people: 0, floors: 0 };
  let day = new Date().toDateString();
  let t = 0;
  let orderAt = 0;
  let mode: TopMode = config.tree ? "tree" : "none";
  let modeAt = performance.now();
  let freshQueued = false;
  let disposed = false;

  const take = (events: readonly WorldEvent[]) => {
    link?.note(events);
    for (const e of events) {
      if (pending.length >= MAX_PENDING) pending.shift();
      pending.push(e);
    }
  };

  // ---- Input --------------------------------------------------------------------------------

  const offs = [
    ctx.input.on("down", (p: Pointer) => {
      const u = frame.unit;
      const x = p.x / u;
      const y = p.y / u;
      const hit = hitAt(layout, x, y);
      if (!hit) return;
      const pond = world.ponds[hit.pond];
      if (!pond) return;
      pond.touchT = 0;
      if (hit.kind === "tile") {
        const pl = layout.ponds[hit.pond]!;
        const tile = pl.tiles.find((tt) => tt.floor === hit.floor)!;
        const cx = tile.box.x + tile.box.w / 2;
        if (world.setFloor(hit.pond, hit.floor, cx)) counts.floors++;
        view.press("tile", hit.pond, hit.floor);
      } else if (hit.kind === "mutation") {
        world.setMutation(hit.pond, hit.value);
        view.press(hit.value, hit.pond);
      } else {
        // One hand bouncing on the glass catches once.
        for (const r of recent) {
          if (t - r.t < HAND_S && Math.hypot(r.x - x, r.y - y) < HAND_PX) return;
        }
        const f = world.catchAt(hit.pond, x, y, p.synthetic ? "bot" : "person");
        if (f) {
          counts.caught++;
          if (!p.synthetic) counts.people++;
          if (recent.length >= 16) recent.shift();
          recent.push({ x, y, t });
        }
      }
      take(world.drain());
    }),
  ];

  // ---- Loop ---------------------------------------------------------------------------------

  const treeFrame = (): TreeFrame => {
    const box = layout.tree;
    const x0: number[] = [];
    const x1: number[] = [];
    const extents: [number, number][] = [];
    for (const pl of layout.ponds) {
      x0.push(Math.max(box.x + 20, pl.tips[0]));
      x1.push(Math.min(box.x + box.w - 20, pl.tips[1]));
      extents.push([Math.max(box.x, pl.water.x), Math.min(box.x + box.w, pl.water.x + pl.water.w)]);
    }
    return { box, cols: { x0, x1 }, extents, bands: world.bands, now: clock() };
  };

  const combTips = () => {
    const out: { x: number; color: string }[] = [];
    world.ponds.forEach((p, i) => {
      const pl = layout.ponds[i]!;
      const list = p.fish
        .filter((f) => f.state !== "dying")
        .map((f) => world.lineage.get(f.id))
        .filter((n) => n !== undefined)
        .sort((a, b) => a.order - b.order || a.id - b.id);
      const n = list.length;
      list.forEach((node, j) => {
        out.push({
          x: pl.tips[0] + ((j + 0.5) / n) * (pl.tips[1] - pl.tips[0]),
          color: node.color,
        });
      });
    });
    return out;
  };

  let tips: { x: number; color: string }[] = [];
  const hints: boolean[] = world.ponds.map(() => false);

  const loop = ctx.loop({
    hz: HZ,
    update(dt) {
      if (disposed) return;
      t += dt;
      world.step(dt);
      take(world.drain());
      bots?.update(t);
    },
    render() {
      if (disposed) return;
      const now = performance.now();
      const today = new Date().toDateString();
      if (today !== day) {
        day = today;
        counts.caught = counts.people = counts.floors = 0;
        world.counts.caught = world.counts.migrants = world.counts.born = 0;
      }
      if (now >= orderAt) {
        orderAt = now + ORDER_MS;
        treeView.fade(world.prune(clock()), clock());
        orderTips(world.lineage);
        world.columns();
        tips = mode === "comb" ? combTips() : tips;
      }
      if (link) {
        const screen = link.screen(now);
        const next: TopMode = screen ? "comb" : config.tree ? "tree" : "none";
        if (next !== mode) {
          mode = next;
          modeAt = now;
          tips = mode === "comb" ? combTips() : [];
        }
        link.tick(now);
      }
      world.ponds.forEach((p, i) => {
        hints[i] = p.touchT > HINT_S;
      });
      view.draw({
        ponds: world.ponds,
        t,
        now: clock(),
        events: pending,
        top: mode,
        lineage: world.lineage,
        tree: mode === "tree" ? treeFrame() : null,
        treeStyle: styleFor(frame.kind),
        tips,
        hint: hints,
      });
      pending.length = 0;
    },
  });
  loop.start();

  let resizeTimer = 0;
  const offResize = ctx.onResize((f) => {
    frame = f;
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (disposed) return;
      const next = layoutFor(inputOf(frame, config));
      world.ponds.forEach((p, i) => {
        const pl = next.ponds[i];
        if (!pl) return;
        const a = p.spec.box;
        const b = pl.box;
        for (const fish of p.fish) {
          fish.x = b.x + ((fish.x - a.x) / Math.max(1, a.w)) * b.w;
          fish.y = b.y + ((fish.y - a.y) / Math.max(1, a.h)) * b.h;
          fish.px = fish.x;
          fish.py = fish.y;
        }
        Object.assign(p.spec.box, b);
        p.spec.fish = next.fish;
      });
      layout = next;
      view.setup(frame, layout);
    }, 150);
  });

  const debugKey = "__evolution";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => {
          let leaves = 0;
          for (const n of world.lineage.nodes()) if (n.died === null) leaves++;
          return {
            screen: false,
            mode,
            modeAt,
            unit: frame.unit,
            t,
            nodes: world.lineage.size,
            leaves,
            sent: link?.sent ?? 0,
            migrants: link ? { ...link.migrants } : { out: 0, in: 0 },
            counts: { ...counts, ...world.counts },
            sprites: view.sprites,
            anims: view.anims,
            tree: layout.tree,
            ponds: world.ponds.map((p, i) => {
              const pl = layout.ponds[i]!;
              return {
                island: p.spec.island,
                floor: p.floor,
                mutation: p.mutation,
                sweep: p.sweep !== null,
                target: p.spec.target,
                box: { ...p.spec.box },
                water: { ...pl.water },
                tiles: pl.tiles.map((tt) => ({ floor: tt.floor, box: { ...tt.box } })),
                small: { ...pl.small },
                big: { ...pl.big },
                standout: world.standout(i),
                aim: p.aim?.id ?? null,
                counts: { ...p.counts },
                fish: p.fish.map((f) => ({
                  id: f.id,
                  parent: f.parent,
                  x: f.x,
                  y: f.y,
                  state: f.state,
                  standout: f.standout,
                  genes: [...f.genes],
                })),
              };
            }),
          };
        },
        /** What admin's reset does (idle calls attract() straight after). */
        reset: () => instance.reset(),
        /** Send a fish off one edge of a pond now. */
        migrate(pond: number, edge: -1 | 1) {
          const p = world.ponds[pond];
          if (!p) return null;
          const b = p.spec.box;
          const edgeX = edge < 0 ? b.x : b.x + b.w;
          const f = p.fish
            .filter((x) => x.state === "swim" && x.arriving <= 0)
            .sort((a, c) => Math.abs(a.x - edgeX) - Math.abs(c.x - edgeX))[0];
          if (!f) return null;
          f.state = "leaving";
          f.edge = edge;
          return f.id;
        },
      },
    });
  }

  const instance: AppInstance = {
    reset() {
      // Idle calls reset() then attract() at once; admin calls reset() alone. Only admin's
      // reset starts fresh populations, since evolution over time is the point.
      bots?.release();
      recent.length = 0;
      if (freshQueued) return;
      freshQueued = true;
      queueMicrotask(() => {
        if (!freshQueued || disposed) return;
        freshQueued = false;
        world.fresh();
        treeView.clear();
        take(world.drain());
      });
    },
    attract() {
      freshQueued = false;
      world.homeFloors(10);
      for (const p of world.ponds) {
        p.touchT = Infinity;
        p.peopleT = Infinity;
        p.mutation = config.mutation;
      }
      view.dirty();
    },
    status() {
      return {
        mode,
        fish: world.ponds.reduce((n, p) => n + p.fish.length, 0),
        caught: counts.caught,
        migrants: world.counts.migrants,
        camouflage: world.ponds.map((_, i) => world.standout(i).toFixed(2)).join(","),
        floors: world.ponds.map((p) => p.floor).join(","),
        nodes: world.lineage.size,
      };
    },
    command(name) {
      if (name === "fresh") {
        world.fresh();
        treeView.clear();
      }
    },
    homeSpot(size) {
      const h = layout.home;
      if (!h) return null;
      const u = frame.unit;
      return { x: (h.x + h.size) * u - size, y: (h.y + h.size) * u - size };
    },
    dispose() {
      disposed = true;
      loop.stop();
      clearTimeout(resizeTimer);
      offResize();
      for (const off of offs) off();
      bots?.dispose();
      bots = null;
      link?.dispose();
      view.dispose();
      treeView.clear();
      world.dispose();
      pending.length = 0;
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
  return instance;
};
