/**
 * A touch frame: a wall, panel or pair on its own, or one frame of a bank. Taps dig, holds plant
 * flags, and a hold on the wash control (above the beach, out of children's reach) brings a new
 * patch. Drags never dig.
 */
import type { AppContext, AppInstance, FrameInfo, Pointer } from "../../core/types";
import { type Bots, createBots } from "./bots";
import {
  ATTRACT_REST,
  BOT_REST,
  BOT_YIELD_MS,
  type Config,
  HOLD_MS,
  RING_DELAY_MS,
  SLIP,
  WASH_HOLD_MS,
} from "./config";
import { type Box, cellAt, cellCentre, type TouchLayout, touchLayout } from "./layout";
import { stateHash } from "./patch";
import { createShore, type Current } from "./shore";
import { createHud, createSea, type HudBoxes } from "./sky";
import { createToday } from "./today";
import { createBeachView, type Grid, type Hold } from "./view";

interface Press {
  /** Local cell on this frame's grid. */
  local: number;
  x0: number;
  y0: number;
  t0: number;
  synthetic: boolean;
  done: boolean;
  failedAt: number;
}

const FAIL_SHOW_MS = 450;
const STALE_PRESS_MS = 30_000;

export const mountTouch = (ctx: AppContext, cfg: Config, bank: boolean): AppInstance => {
  let frame: FrameInfo = ctx.frame;
  const venue = () => ({ width: frame.venueWidth, height: frame.venueHeight });
  let layout: TouchLayout = touchLayout(frame.kind, venue(), frame.reach, bank);
  const now = () => performance.now();

  const shore = createShore({
    net: ctx.net,
    now: () => ctx.clock.now(),
    local: now,
    synced: () => ctx.clock.synced,
    bank,
    screen: false,
    pos: ctx.setup.pos,
    count: bank ? ctx.setup.count : 1,
    geom: { w: layout.cols, r: layout.rows, k: layout.kid },
    cfg,
    rng: ctx.rng(`bluebottle:${ctx.net.self}:${Date.now()}`),
  });
  const today = createToday();

  const gridOf = (l: TouchLayout): Grid => ({
    box: l.beach,
    cols: l.cols,
    rows: l.rows,
    cell: l.cell,
    kid: l.kid,
  });
  const skyBox = (l: TouchLayout): Box => ({ x: 0, y: 0, width: l.W, height: l.beach.y });
  const hudBoxes = (l: TouchLayout): HudBoxes => ({
    area: skyBox(l),
    tower: l.tower,
    progress: l.progress,
    flags: l.flags,
    today: l.today,
    banner: l.banner,
    map: l.map,
  });
  const seaSpec = (l: TouchLayout) => ({ box: skyBox(l), horizon: l.horizon, shore: l.shore });

  const sea = createSea(ctx.root, seaSpec(layout), frame.unit, frame.pixelRatio);
  const hud = createHud(ctx.root, hudBoxes(layout), frame.unit, frame.pixelRatio);
  const view = createBeachView(ctx.root, gridOf(layout), frame.unit, frame.pixelRatio, cfg.counts);
  const backdrop = document.createElement("div");
  backdrop.style.cssText = "position:absolute;inset:0;z-index:-1;background:#3a2717;";
  ctx.root.append(backdrop);

  let celebrate = -Infinity;
  let lastHuman = -Infinity;
  let attractOn = true;
  let disposed = false;

  const c0 = () => shore.columns().c0;

  shore.onPatch((cur) => view.setPatch(cur, c0()));
  shore.onEffect((e, cur) => {
    view.effect(e, cur, c0());
    if (e.kind === "end" && e.why === "clear") {
      celebrate = now();
      today.add(Date.now());
    }
    if (e.kind === "refused" && e.ev.s === ctx.net.self && e.ev.h) {
      ctx.ui.toast("Others are still digging", 2600);
    }
  });
  if (shore.cur) view.setPatch(shore.cur, c0());

  // ---- Wash control ----------------------------------------------------------------------------

  let washButtons: HTMLElement[] = [];
  const placeWash = () => {
    for (const b of washButtons) b.remove();
    const u = frame.unit;
    washButtons = layout.wash.map((b) =>
      ctx.ui.button({
        icon: "reset",
        rect: { x: b.x * u, y: b.y * u, width: b.width * u, height: b.height * u },
        hold: WASH_HOLD_MS,
        look: "ghost",
        color: "#ffffff",
        onPress: () => {
          lastHuman = now();
          shore.touched();
          shore.wash(true);
        },
      }),
    );
  };
  placeWash();

  // ---- Input -----------------------------------------------------------------------------------

  const presses = new Map<number, Press>();

  /** The patch cell under a local cell, if this frame shows that cell. */
  const patchCell = (cur: Current, local: number): number => {
    const r = Math.floor(local / layout.cols);
    const c = (local % layout.cols) + c0();
    if (r >= cur.spec.rows || c >= cur.spec.cols) return -1;
    return r * cur.spec.cols + c;
  };

  const human = (p: Pointer) => {
    if (p.synthetic) return;
    lastHuman = now();
    attractOn = false;
    shore.touched();
    bots?.release();
    attract?.release();
  };

  const offInput = [
    ctx.input.on("down", (p) => {
      human(p);
      const x = p.x / frame.unit;
      const y = p.y / frame.unit;
      const hit = cellAt(layout, x, y);
      if (!hit) return;
      presses.set(p.id, {
        local: hit.r * layout.cols + hit.c,
        x0: x,
        y0: y,
        t0: now(),
        synthetic: p.synthetic,
        done: false,
        failedAt: -Infinity,
      });
    }),
    ctx.input.on("move", (p) => {
      const pr = presses.get(p.id);
      if (!pr) return;
      const moved = Math.hypot(p.x / frame.unit - pr.x0, p.y / frame.unit - pr.y0);
      if (moved > SLIP * layout.cell) presses.delete(p.id);
    }),
    ctx.input.on("up", (p) => {
      const pr = presses.get(p.id);
      presses.delete(p.id);
      if (!pr || pr.done) return;
      const moved = Math.hypot(p.x / frame.unit - pr.x0, p.y / frame.unit - pr.y0);
      if (moved > SLIP * layout.cell) return;
      const cur = shore.cur;
      if (!cur || !shore.playing()) return;
      const i = patchCell(cur, pr.local);
      if (i < 0) return;
      const h = !pr.synthetic;
      const patch = cur.patch;
      if (patch.flag[i]) shore.flag(i, false, h);
      else if (!patch.found[i] && (!patch.dug[i] || patch.board.count[i] === 0)) shore.dig(i, h);
    }),
    ctx.input.on("cancel", (p) => {
      presses.delete(p.id);
    }),
  ];

  const holdTick = (t: number) => {
    const cur = shore.cur;
    for (const [id, pr] of presses) {
      // A finger whose lift never arrived.
      if (t - pr.t0 > STALE_PRESS_MS) presses.delete(id);
    }
    for (const pr of presses.values()) {
      if (pr.done || t - pr.t0 < HOLD_MS) continue;
      pr.done = true;
      if (!cfg.flags || !cur || !shore.playing()) continue;
      const i = patchCell(cur, pr.local);
      if (i < 0 || cur.patch.dug[i] || cur.patch.found[i] || cur.patch.flag[i]) continue;
      if (cur.patch.canFlag(i)) shore.flag(i, true, !pr.synthetic);
      else pr.failedAt = t;
    }
  };

  const holds: Hold[] = [];
  const holdRings = (t: number): readonly Hold[] => {
    holds.length = 0;
    const cur = shore.cur;
    if (!cfg.flags || !cur) return holds;
    for (const [id, pr] of presses) {
      if (pr.failedAt > -Infinity) {
        if (t - pr.failedAt < FAIL_SHOW_MS) holds.push({ cell: pr.local, fill: -1 });
        else presses.delete(id);
        continue;
      }
      if (pr.done || t - pr.t0 < RING_DELAY_MS) continue;
      const i = patchCell(cur, pr.local);
      if (i < 0 || cur.patch.dug[i] || cur.patch.found[i] || cur.patch.flag[i]) continue;
      holds.push({ cell: pr.local, fill: (t - pr.t0 - RING_DELAY_MS) / (HOLD_MS - RING_DELAY_MS) });
    }
    return holds;
  };

  // ---- Bots ------------------------------------------------------------------------------------

  const scene = () => {
    const cur = shore.cur;
    const { c0: a, c1: b } = shore.columns();
    return {
      cur,
      playing: shore.playing() && !view.tiding,
      c0: a,
      c1: b,
      flags: cfg.flags,
      point: (cell: number) => {
        if (!cur) return null;
        const c = (cell % cur.spec.cols) - a;
        const r = Math.floor(cell / cur.spec.cols);
        if (c < 0 || c >= layout.cols || r >= layout.rows) return null;
        const p = cellCentre(layout, c, r);
        return { x: p.x * frame.unit, y: p.y * frame.unit };
      },
    };
  };
  const bots: Bots | null =
    ctx.bots > 0
      ? createBots({
          input: ctx.input,
          rng: ctx.rng("bluebottle:bots"),
          count: Math.min(6, ctx.bots),
          rest: BOT_REST,
          random: 0.03,
          flag: 0.2,
          scene,
        })
      : null;
  const attract: Bots | null = bots
    ? null
    : createBots({
        input: ctx.input,
        rng: ctx.rng("bluebottle:attract"),
        count: 1,
        rest: ATTRACT_REST,
        random: 0.06,
        flag: 0.22,
        scene,
      });

  // ---- Loop ------------------------------------------------------------------------------------

  const loop = ctx.loop({
    hz: 30,
    update(dt) {
      if (disposed) return;
      const t = now();
      shore.tick();
      holdTick(t);
      const yielded = t - lastHuman < BOT_YIELD_MS;
      bots?.update(dt, yielded ? 0 : Math.min(6, ctx.bots));
      attract?.update(dt, attractOn && !yielded ? 1 : 0);
    },
    render() {
      if (disposed) return;
      const t = now();
      sea.draw(t);
      const cur = shore.cur;
      const cols = shore.columns();
      hud.draw(t, {
        progress: cur ? cur.patch.progress() : null,
        flagsLeft: cur && cfg.flags ? cur.patch.flagsLeft() : null,
        today: today.count(Date.now()),
        celebrate,
        map: cur && cur.shared && layout.map ? { cur, c0: cols.c0, c1: cols.c1 } : null,
      });
      view.draw(t, holdRings(t));
      publish(t);
    },
  });
  loop.start();

  // ---- State for tests -------------------------------------------------------------------------

  let publishedAt = -Infinity;
  const publish = (t: number) => {
    if (t - publishedAt < 400) return;
    publishedAt = t;
    const cur = shore.cur;
    const s = shore.status();
    ctx.root.dataset.bluebottle = JSON.stringify({
      ...s,
      key: cur ? `${cur.spec.b}:${cur.spec.n}` : null,
      cols: cur?.spec.cols ?? 0,
      c0: shore.columns().c0,
      c1: shore.columns().c1,
      shared: cur?.shared ?? false,
      events: cur?.patch.events.length ?? 0,
      hash: cur ? stateHash(cur.patch) : 0,
      end: cur?.patch.end?.why ?? null,
      playing: shore.playing(),
      cell: layout.cell,
      top: layout.beach.y,
      rows: layout.rows,
      lcols: layout.cols,
    });
  };

  // Tests and debugging only: what this frame's beach holds.
  const debugKey = "__bluebottle";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        cells: () => {
          const cur = shore.cur;
          if (!cur) return null;
          const p = cur.patch;
          return {
            cols: cur.spec.cols,
            rows: cur.spec.rows,
            c0: shore.columns().c0,
            dug: [...p.dug],
            flag: [...p.flag],
            found: [...p.found],
            bottle: [...p.board.bottle],
            count: [...p.board.count],
          };
        },
        layout: () => ({ cell: layout.cell, top: layout.beach.y, left: layout.beach.x }),
      },
    });
  }

  // ---- Resize ----------------------------------------------------------------------------------

  let resizeTimer = 0;
  const offResize = ctx.onResize((f) => {
    frame = f;
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (disposed) return;
      const next = touchLayout(frame.kind, venue(), frame.reach, bank);
      // The grid of cells can't change under a running patch; only its scale does.
      layout = { ...next, cols: layout.cols, rows: layout.rows, kid: layout.kid };
      sea.set(seaSpec(layout), frame.unit, frame.pixelRatio);
      hud.set(hudBoxes(layout), frame.unit, frame.pixelRatio);
      view.setGrid(gridOf(layout), frame.unit, frame.pixelRatio);
      placeWash();
    }, 200);
  });

  return {
    reset() {
      bots?.release();
      attract?.release();
      presses.clear();
      shore.wash(false);
    },
    attract() {
      attractOn = true;
      lastHuman = -Infinity;
    },
    status() {
      const s = shore.status();
      return {
        mode: s.mode,
        patch: s.patch,
        dug: s.dug,
        found: s.found,
        stings: s.stings,
        crabs: s.hints,
        leader: s.leader,
      };
    },
    command(name) {
      if (name === "wash") shore.tide();
    },
    homeSpot(size) {
      if (!layout.home) return null;
      const u = frame.unit;
      const h = layout.home;
      return {
        x: Math.round((h.x + h.width) * u - size),
        y: Math.round((h.y + h.height) * u - size),
      };
    },
    dispose() {
      disposed = true;
      loop.stop();
      clearTimeout(resizeTimer);
      offResize();
      for (const off of offInput) off();
      bots?.dispose();
      attract?.dispose();
      shore.dispose();
      for (const b of washButtons) b.remove();
      washButtons = [];
      sea.dispose();
      hud.dispose();
      view.dispose();
      backdrop.remove();
      presses.clear();
      delete ctx.root.dataset.bluebottle;
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
