/**
 * The screen above a bank: the whole beach as a map whose columns sit over the frames below,
 * the lifeguard tower, the progress and the celebrations. It holds the patch like any frame and
 * leads the crabs while it is there, but it is never the only one with the log. On its own it
 * shows crabs digging a beach by themselves.
 */
import type { AppContext, AppInstance, FrameInfo } from "../../core/types";
import { activeVenue } from "../../core/venue";
import { REGION_COLS, type Config } from "./config";
import { type ScreenLayout, screenLayout } from "./layout";
import { stateHash } from "./patch";
import { createShore, type Current } from "./shore";
import { createHud, createSea, type HudBoxes } from "./sky";
import { createToday } from "./today";
import { createBeachView, type Grid } from "./view";

/** A screen with no bank below it shows a beach as wide as the venue's bank. */
const soloPanels = () => activeVenue().bankCount;
const DEFAULT_GEOM = { w: REGION_COLS, r: 11, k: 6 };

export const mountScreen = (ctx: AppContext, cfg: Config, bank: boolean): AppInstance => {
  let frame: FrameInfo = ctx.frame;
  const venue = () => ({ width: frame.venueWidth, height: frame.venueHeight });
  const count = bank ? Math.max(1, ctx.setup.count) : soloPanels();
  const now = () => performance.now();

  const shore = createShore({
    net: ctx.net,
    now: () => ctx.clock.now(),
    local: now,
    synced: () => ctx.clock.synced,
    bank,
    screen: true,
    pos: 0,
    count,
    geom: DEFAULT_GEOM,
    cfg,
    rng: ctx.rng(`bluebottle:${ctx.net.self}:${Date.now()}`),
  });
  const today = createToday();

  let cols = count * DEFAULT_GEOM.w;
  let rows = DEFAULT_GEOM.r;
  let kid = DEFAULT_GEOM.k;
  let layout: ScreenLayout = screenLayout(venue(), cols, rows);
  const gridOf = (): Grid => ({ box: layout.map, cols, rows, cell: layout.map.width / cols, kid });
  const full = () => ({ x: 0, y: 0, width: layout.W, height: layout.H });
  const hudBoxes = (): HudBoxes => ({
    area: full(),
    tower: layout.tower,
    progress: layout.progress,
    flags: layout.flags,
    today: layout.today,
    banner: layout.banner,
    map: null,
  });
  const seaSpec = () => ({ box: full(), horizon: layout.horizon, shore: null });

  const backdrop = document.createElement("div");
  backdrop.style.cssText = "position:absolute;inset:0;z-index:-1;background:#0d1a3c;";
  ctx.root.append(backdrop);
  const sea = createSea(ctx.root, seaSpec(), frame.unit, frame.pixelRatio);
  const hud = createHud(ctx.root, hudBoxes(), frame.unit, frame.pixelRatio);
  const view = createBeachView(ctx.root, gridOf(), frame.unit, frame.pixelRatio, cfg.counts);

  // Lines over the map where one frame's beach meets the next.
  const marks = document.createElement("div");
  marks.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:4;";
  ctx.root.append(marks);
  const placeMarks = () => {
    marks.replaceChildren();
    if (!bank || count < 2) return;
    const u = frame.unit;
    const m = layout.map;
    for (let k = 1; k < count; k++) {
      const el = document.createElement("div");
      const x = (m.x + (m.width * k) / count) * u;
      el.style.cssText =
        `position:absolute;left:${x - 2 * u}px;top:${(m.y - 30) * u}px;width:${Math.max(1, 4 * u)}px;` +
        `height:${(m.height + 60) * u}px;background:rgba(255,255,255,0.55);border-radius:${2 * u}px;`;
      marks.append(el);
    }
  };

  const relayout = () => {
    layout = screenLayout(venue(), cols, rows);
    sea.set(seaSpec(), frame.unit, frame.pixelRatio);
    hud.set(hudBoxes(), frame.unit, frame.pixelRatio);
    view.setGrid(gridOf(), frame.unit, frame.pixelRatio);
    placeMarks();
  };
  placeMarks();

  let celebrate = -Infinity;
  let disposed = false;

  const showPatch = (cur: Current | null) => {
    if (cur && (cur.spec.cols !== cols || cur.spec.rows !== rows || cur.spec.kid !== kid)) {
      cols = cur.spec.cols;
      rows = cur.spec.rows;
      kid = cur.spec.kid;
      relayout();
    }
    view.setPatch(cur, 0);
  };
  shore.onPatch(showPatch);
  shore.onEffect((e, cur) => {
    view.effect(e, cur, 0);
    if (e.kind === "end" && e.why === "clear") {
      celebrate = now();
      today.add(Date.now());
    }
    // People are playing below: the screen counts as busy.
    if (e.kind !== "replayed" && "ev" in e && e.ev.h) ctx.idle.poke();
  });
  if (shore.cur) showPatch(shore.cur);

  const loop = ctx.loop({
    hz: 30,
    update() {
      if (!disposed) shore.tick();
    },
    render() {
      if (disposed) return;
      const t = now();
      sea.draw(t);
      const cur = shore.cur;
      hud.draw(t, {
        progress: cur ? cur.patch.progress() : null,
        flagsLeft: cur && cfg.flags ? cur.patch.flagsLeft() : null,
        today: today.count(Date.now()),
        celebrate,
        map: null,
      });
      view.draw(t, []);
      publish(t);
    },
  });
  loop.start();

  let publishedAt = -Infinity;
  const publish = (t: number) => {
    if (t - publishedAt < 400) return;
    publishedAt = t;
    const cur = shore.cur;
    ctx.root.dataset.bluebottle = JSON.stringify({
      ...shore.status(),
      key: cur ? `${cur.spec.b}:${cur.spec.n}` : null,
      cols: cur?.spec.cols ?? 0,
      shared: cur?.shared ?? false,
      events: cur?.patch.events.length ?? 0,
      hash: cur ? stateHash(cur.patch) : 0,
      end: cur?.patch.end?.why ?? null,
      playing: shore.playing(),
    });
  };

  let resizeTimer = 0;
  const offResize = ctx.onResize((f) => {
    frame = f;
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (!disposed) relayout();
    }, 200);
  });

  return {
    reset() {},
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
    dispose() {
      disposed = true;
      loop.stop();
      clearTimeout(resizeTimer);
      offResize();
      shore.dispose();
      sea.dispose();
      hud.dispose();
      view.dispose();
      marks.remove();
      backdrop.remove();
      delete ctx.root.dataset.bluebottle;
    },
  };
};
