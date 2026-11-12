import { createBotHand } from "../../core/input";
import { listApps } from "../../core/registry";
import type {
  AppContext,
  AppInstance,
  FrameInfo,
  LaunchOptions,
  OptionValues,
  Rect,
} from "../../core/types";
import { FONT, withAlpha } from "../../core/ui";
import { appArt } from "../../pages/landing/art";
import { type Offer, offers, parseEntries, withPresets } from "./catalog";
import { type ChooseHandle, type ChooseState, chooseCss, createChoose, fitChoose } from "./choose";
import { defaultOptions, needsChoice, startVariant } from "./choices";
import { type Deck, markRan, peekNext } from "./cycle";
import { div, fitLabel, place, px } from "./dom";
import { layoutMenu, type MenuLayout, pageCount, pageTiles } from "./layout";
import { createTapTracker } from "./taps";
import { hasThumb, thumbUrl } from "./thumbs";

const COPY = "Pick one to play";
/** How long a chosen tile or Play glows before the app starts. */
const LAUNCH_DELAY_MS = 350;
/** The attract highlight moves on this often, and pauses this long after a person's touch. */
const SWEEP_MS = 2200;
const QUIET_MS = 6000;
/** The choose step gives up and shows the tiles again after this long without a touch. */
const CHOOSE_TIMEOUT_MS = 20_000;
/** Seconds between a bot's page turns. */
const BOT_GAP_S: [number, number] = [6, 11];
/**
 * When the picker changes app by itself, the next tile glows this long first, so people see
 * there's a choice.
 */
const CYCLE_REVEAL_MS = 2000;

/** Outlives the picker, which mounts again between every app it starts. */
const deck: Deck = { left: [], last: null };

const chevron = (d: string) =>
  `<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true"><path d="${d}" ` +
  'fill="none" stroke="currentColor" stroke-width="12" stroke-linecap="round" ' +
  'stroke-linejoin="round"/></svg>';
const PREV_ICON = chevron("M62 16L28 50L62 84");
const NEXT_ICON = chevron("M38 16L72 50L38 84");

const css = (p: AppContext["ui"]["palette"]) => `
.mn{position:absolute;inset:0;overflow:hidden;z-index:1;background:${p.background};color:${p.foreground};
font-family:${FONT};user-select:none;-webkit-user-select:none;touch-action:none;}
.mn-glow{position:absolute;border-radius:50%;pointer-events:none;
animation:mn-drift 28s ease-in-out infinite alternate;}
.mn-title{position:absolute;transform:translate(-50%,-50%);text-align:center;font-weight:800;
line-height:1.08;letter-spacing:-0.01em;text-wrap:balance;pointer-events:none;
text-shadow:0 0 0.4em rgba(0,0,0,0.6);}
.mn-page,.mn-chrome{position:absolute;inset:0;}
.mn-page.mn-in-next{animation:mn-in-next 0.45s ease-out both;}
.mn-page.mn-in-prev{animation:mn-in-prev 0.45s ease-out both;}
.mn-tile{position:absolute;box-sizing:border-box;overflow:hidden;background:#0d1220;
border-style:solid;border-color:${withAlpha(p.foreground, 0.16)};
transition:transform 0.5s ease-out,border-color 1.1s ease-in-out,box-shadow 1.1s ease-in-out;}
.mn-tile.is-lit{border-color:${withAlpha(p.accent, 0.75)};transform:scale(1.02);}
.mn-tile.is-pressed{border-color:${p.foreground};transform:scale(0.97);
transition-duration:0.12s;}
.mn-tile.is-chosen{border-color:${p.accent};transform:scale(1.04);transition-duration:0.18s;}
.mn-art{position:absolute;left:0;top:0;right:0;overflow:hidden;background:#000;}
.mn-art>svg,.mn-art>img{position:absolute;inset:0;width:100%;height:100%;display:block;}
.mn-art>img{object-fit:cover;opacity:0;transition:opacity 0.4s;}
.mn-art>img.is-loaded{opacity:1;}
.mn-chip{position:absolute;box-sizing:border-box;max-width:90%;overflow:hidden;
white-space:nowrap;font-weight:800;line-height:1;background:${p.accent};color:${p.background};
box-shadow:0 0.1em 0.5em rgba(0,0,0,0.5);}
.mn-bar{position:absolute;left:0;right:0;}
.mn-label{position:absolute;left:0;right:0;bottom:0;box-sizing:border-box;display:flex;
align-items:center;justify-content:center;text-align:center;font-weight:800;line-height:1.05;
overflow:hidden;overflow-wrap:normal;text-wrap:balance;}
.mn-dot{position:absolute;border-radius:50%;transform:translate(-50%,-50%);
background:${withAlpha(p.muted, 0.45)};transition:background 0.4s,transform 0.4s;}
.mn-dot.is-on{background:${p.accent};transform:translate(-50%,-50%) scale(1.35);}
@keyframes mn-drift{from{transform:translate(-5%,-4%) scale(1);}to{transform:translate(5%,4%) scale(1.12);}}
@keyframes mn-in-next{from{opacity:0;transform:translateX(3%);}to{opacity:1;transform:none;}}
@keyframes mn-in-prev{from{opacity:0;transform:translateX(-3%);}to{opacity:1;transform:none;}}
@media (prefers-reduced-motion: reduce){.mn-glow,.mn-page,.mn-choose{animation:none !important;}}
${chooseCss(p)}`;

interface Tile {
  offer: Offer;
  rect: Rect;
  el: HTMLElement;
}

/** An open choose step, with what's needed to rebuild it after a resize. */
interface Choosing {
  handle: ChooseHandle;
  offer: Offer;
  anchorX: number;
}

type Stay = NonNullable<LaunchOptions["stay"]>;

/** Start an offer with its preset or first variant and default options, as a tap on its tile does. */
const startArgs = (offer: Offer): { variant?: string; options: OptionValues } => {
  const variant = startVariant(offer);
  const options = defaultOptions(offer.app);
  return variant === undefined ? { options } : { variant, options };
};

/**
 * A picker nobody sees, as on a sphere, which can't be touched and shows only canvases. It
 * starts the next app at once, and again each time that app's stay runs out. After a failed
 * start it waits for its own idle, so a broken app can't make it spin.
 */
const mountHidden = (ctx: AppContext, list: Offer[], stay: Stay): AppInstance => {
  let timer = 0;
  const startNext = () => {
    clearTimeout(timer);
    // Not inside this mount, so the runtime never swaps apps before this one has mounted.
    timer = window.setTimeout(() => {
      timer = 0;
      const key = peekNext(
        list.map((o) => o.key),
        deck,
        Math.random,
      );
      const offer = list.find((o) => o.key === key);
      if (!offer) return;
      markRan(deck, offer.key);
      ctx.log("launch", offer.app.id);
      ctx.system.launch(offer.app.id, { ...startArgs(offer), stay, homeControl: false });
    }, 0);
  };
  if (ctx.system.returned !== "error") startNext();
  return {
    reset() {
      clearTimeout(timer);
      timer = 0;
    },
    attract: startNext,
    status: () => ({ offered: list.length, step: "hidden", cycle: stay.ms < Infinity, next: "" }),
    dispose() {
      clearTimeout(timer);
    },
  };
};

/** Large tiles for the apps on offer. A tap starts that app here, or first asks for choices. */
export const mount = (ctx: AppContext): AppInstance => {
  const hidden = ctx.frame.kind === "sphere" || ctx.options.nopicker === true;
  const cycling = ctx.options.cycle === true;
  const all = listApps().map((app) => withPresets(app, ctx.system.presets(app.id)));
  // A frame that changes app by itself never lands on a tool unless the operator listed it.
  const list = offers(
    all,
    ctx.frame.kind,
    parseEntries(ctx.options.apps),
    ctx.manifest.id,
    !(cycling || hidden),
  );
  const minutes = (key: string) => Number(ctx.options[key]) * 60_000;
  const timed = { ms: minutes("every"), graceMs: minutes("wait") };
  if (hidden) return mountHidden(ctx, list, cycling ? timed : { ms: Infinity, graceMs: 0 });

  const palette = ctx.ui.palette;
  const rng = ctx.rng("menu");
  // Bars keep each app's colour across pages, presets and frames.
  const colourOf = (id: string) =>
    palette.players[
      Math.max(
        0,
        all.findIndex((a) => a.id === id),
      ) % palette.players.length
    ] ?? palette.accent;

  const root = div("mn");
  const style = document.createElement("style");
  style.textContent = css(palette);
  const backdrop = div("");
  const chrome = div("mn-chrome");
  const pageEl = div("mn-page");
  root.append(style, backdrop, chrome, pageEl);
  ctx.root.append(root);

  let frame: FrameInfo = ctx.frame;
  let layout: MenuLayout = layoutMenu(frame, list.length);
  let pages = pageCount(list.length, layout.perPage);
  let page = 0;
  let tiles: Tile[] = [];
  let dots: HTMLElement[] = [];
  let arrows: HTMLElement[] = [];
  let choosing: Choosing | null = null;
  let chooseTouchedAt = 0;
  let pending = 0;
  let disposed = false;
  let lastHuman = -Infinity;
  let sweepAt = 0;
  let sweepStep = -1;
  let sweepOrder: number[] = [];
  const cycle = cycling && list.length > 0;
  const extra: LaunchOptions = {};
  if (cycle) extra.stay = timed;
  if (ctx.options.nohome === true) extra.homeControl = false;
  /** The app the picker starts by itself at `upcomingAt` unless a person touches first. */
  let upcoming: Offer | null = null;
  let upcomingAt = 0;

  const tracker = createTapTracker({
    hit(x, y) {
      return tiles.findIndex(
        (t) =>
          x >= t.rect.x &&
          x <= t.rect.x + t.rect.width &&
          y >= t.rect.y &&
          y <= t.rect.y + t.rect.height,
      );
    },
    get slop() {
      const t = tiles[0]?.rect;
      return t ? Math.min(t.width, t.height) * 0.3 : 100 * frame.unit;
    },
    get swipe() {
      return Math.max(180 * frame.unit, (tiles[0]?.rect.width ?? 0) * 0.3);
    },
  });
  // The choose step's controls are smaller and packed closer, and it never pages.
  const chooseTracker = createTapTracker({
    hit: (x, y) => choosing?.handle.hit(x, y) ?? -1,
    get slop() {
      return 60 * frame.unit;
    },
    swipe: Number.POSITIVE_INFINITY,
  });

  const unlight = () => {
    for (const t of tiles) t.el.classList.remove("is-lit");
    sweepStep = -1;
  };

  const showPressed = () => {
    const armed = tracker.armed();
    tiles.forEach((t, i) => t.el.classList.toggle("is-pressed", armed.has(i)));
    choosing?.handle.showArmed(chooseTracker.armed());
  };

  const makeTile = (offer: Offer, r: Rect): HTMLElement => {
    const { app, variant } = offer;
    const u = frame.unit;
    const el = div("mn-tile");
    el.dataset.app = app.id;
    el.dataset.key = offer.key;
    place(el, r);
    el.style.borderRadius = px(layout.radius);
    el.style.borderWidth = px(Math.max(2, 5 * u));
    el.style.boxShadow = `0 ${px(14 * u)} ${px(40 * u)} rgba(0,0,0,0.45)`;
    const art = div("mn-art");
    art.style.height = px(layout.imageHeight);
    art.innerHTML = appArt(app.id, app.category);
    if (hasThumb(app.id)) {
      const img = document.createElement("img");
      img.alt = "";
      img.draggable = false;
      img.decoding = "async";
      img.addEventListener("load", () => img.classList.add("is-loaded"), { once: true });
      img.addEventListener("error", () => img.remove(), { once: true });
      img.src = thumbUrl(app.id);
      art.append(img);
    }
    if (variant) {
      // A preset names its variant on the picture, so the label stays the app's title.
      const chip = div("mn-chip", variant.title);
      const size = layout.labelSize * 0.8;
      chip.style.fontSize = px(size);
      chip.style.left = px(size * 0.45);
      chip.style.bottom = px(size * 0.45);
      chip.style.padding = `${px(size * 0.28)} ${px(size * 0.5)}`;
      chip.style.borderRadius = px(size);
      art.append(chip);
    }
    const bar = div("mn-bar");
    bar.style.top = px(layout.imageHeight);
    bar.style.height = px(Math.max(2, 8 * u));
    bar.style.background = colourOf(app.id);
    const label = div("mn-label", app.title);
    label.style.height = px(r.height - layout.imageHeight - 8 * u);
    label.style.padding = `0 ${px(layout.labelSize * 0.35)}`;
    el.append(art, bar, label);
    return el;
  };

  const renderPage = (dir: -1 | 0 | 1) => {
    tracker.clear();
    unlight();
    pageEl.replaceChildren();
    pageEl.className = dir === 0 ? "mn-page" : `mn-page mn-in-${dir > 0 ? "next" : "prev"}`;
    const shown = list.slice(page * layout.perPage, (page + 1) * layout.perPage);
    const rects = pageTiles(layout, shown.length);
    tiles = shown.map((offer, i) => {
      const rect = rects[i] ?? { x: 0, y: 0, width: 0, height: 0 };
      const el = makeTile(offer, rect);
      pageEl.append(el);
      return { offer, rect, el };
    });
    for (const t of tiles) {
      const label = t.el.lastElementChild;
      if (label instanceof HTMLElement) fitLabel(label, layout.labelSize);
    }
    sweepOrder = tiles
      .map((t, i) => ({ i, x: t.rect.x, y: t.rect.y }))
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((t) => t.i);
    dots.forEach((d, i) => d.classList.toggle("is-on", i % pages === page));
    sweepAt = performance.now() + SWEEP_MS;
  };

  const turn = (dir: -1 | 1) => {
    if (pending || choosing || pages < 2) return;
    page = (page + dir + pages) % pages;
    renderPage(dir);
  };

  /** Tiles, arrows and dots are hidden while the choose step is open. */
  const showGrid = (on: boolean) => {
    pageEl.hidden = !on;
    chrome.hidden = !on;
    for (const a of arrows) a.style.visibility = on ? "" : "hidden";
  };

  const launch = (offer: Offer, args: { variant?: string; options: OptionValues }) => {
    pending = window.setTimeout(() => {
      pending = 0;
      if (disposed) return;
      ctx.log("launch", offer.app.id, args);
      if (cycle) markRan(deck, offer.key);
      ctx.system.launch(offer.app.id, { ...args, ...extra });
      // Still here only if the runtime refused the launch.
      if (!disposed) {
        for (const t of tiles) t.el.classList.remove("is-chosen");
        closeChoose();
      }
    }, LAUNCH_DELAY_MS);
  };

  const start = (offer: Offer) => {
    for (const t of tiles) t.el.classList.toggle("is-chosen", t.offer === offer);
    launch(offer, startArgs(offer));
  };

  /** Turn to the upcoming app's page and light its tile. */
  const showUpcoming = () => {
    if (!upcoming) return;
    const at = Math.floor(list.indexOf(upcoming) / layout.perPage);
    if (at !== page) {
      page = at;
      renderPage(0);
    }
    for (const t of tiles) t.el.classList.toggle("is-lit", t.offer === upcoming);
  };

  const queueNext = () => {
    if (!cycle || pending) return;
    const key = peekNext(
      list.map((o) => o.key),
      deck,
      Math.random,
    );
    upcoming = list.find((o) => o.key === key) ?? null;
    if (!upcoming) return;
    closeChoose();
    upcomingAt = performance.now() + CYCLE_REVEAL_MS;
    showUpcoming();
  };

  const cancelNext = () => {
    if (!upcoming) return;
    upcoming = null;
    unlight();
  };

  const closeChoose = () => {
    if (!choosing) return;
    chooseTracker.clear();
    choosing.handle.el.remove();
    choosing = null;
    showGrid(true);
    sweepAt = performance.now() + SWEEP_MS;
  };

  const openChoose = (offer: Offer, anchorX: number, initial?: ChooseState) => {
    closeChoose();
    tracker.clear();
    unlight();
    const handle = createChoose({
      frame,
      offer,
      palette,
      anchorX,
      initial,
      onPlay: (args) => {
        chooseTracker.clear();
        showPressed();
        launch(offer, args);
      },
      onBack: closeChoose,
      onReshape: (state) => openChoose(offer, anchorX, state),
    });
    choosing = { handle, offer, anchorX };
    showGrid(false);
    root.append(handle.el);
    fitChoose(handle);
    chooseTouchedAt = performance.now();
  };

  const build = () => {
    layout = layoutMenu(frame, list.length);
    pages = pageCount(list.length, layout.perPage);
    page = Math.min(page, pages - 1);
    backdrop.replaceChildren();
    chrome.replaceChildren();
    // Soft glows in the calm space above the tiles.
    const first = layout.titles[0];
    const glowY = first ? first.y : frame.height * 0.3;
    const glowR = Math.max(frame.width, frame.height) * (frame.kind === "wall" ? 0.28 : 0.42);
    const tints = [palette.players[0], palette.players[2], palette.players[3]];
    tints.forEach((tint, i) => {
      const g = div("mn-glow");
      const cx = frame.width * (0.22 + 0.28 * i);
      const r = glowR * (1 - 0.15 * i);
      place(g, { x: cx - r, y: glowY - r * (0.9 - 0.2 * i), width: 2 * r, height: 2 * r });
      g.style.background = `radial-gradient(closest-side, ${withAlpha(tint ?? palette.accent, 0.16)}, transparent)`;
      g.style.animationDelay = `${-9 * i}s`;
      g.style.animationDuration = `${26 + 6 * i}s`;
      backdrop.append(g);
    });
    if (list.length > 0) {
      for (const t of layout.titles) {
        const el = div("mn-title", COPY);
        el.style.left = px(t.x);
        el.style.top = px(t.y);
        el.style.maxWidth = px(t.width);
        el.style.width = "max-content";
        el.style.fontSize = px(t.size);
        chrome.append(el);
      }
    }
    dots = [];
    if (pages > 1) {
      for (const d of layout.dots) {
        const step = d.size * 2.2;
        for (let i = 0; i < pages; i++) {
          const el = div("mn-dot");
          place(el, {
            x: d.x + (i - (pages - 1) / 2) * step,
            y: d.y,
            width: d.size,
            height: d.size,
          });
          chrome.append(el);
          dots.push(el);
        }
      }
    }
    for (const a of arrows) a.remove();
    arrows = [];
    const arrow = (r: Rect | null, icon: string, dir: -1 | 1) => {
      if (!r) return;
      arrows.push(
        ctx.ui.button({
          icon,
          rect: r,
          look: "ghost",
          color: palette.foreground,
          onPress: () => turn(dir),
        }),
      );
    };
    arrow(layout.prev, PREV_ICON, -1);
    arrow(layout.next, NEXT_ICON, 1);
    renderPage(0);
    showUpcoming();
    if (choosing) {
      const { offer, anchorX, handle } = choosing;
      openChoose(offer, anchorX, handle.state());
    }
  };

  const pick = (index: number) => {
    const t = tiles[index];
    if (!t || pending) return;
    tracker.clear();
    showPressed();
    unlight();
    if (needsChoice(t.offer, frame.kind)) {
      openChoose(t.offer, t.rect.x + t.rect.width / 2);
      return;
    }
    start(t.offer);
  };

  const human = (p: { synthetic: boolean }) => {
    if (p.synthetic || pending) return false;
    const now = performance.now();
    lastHuman = now;
    chooseTouchedAt = now;
    cancelNext();
    if (sweepStep >= 0) unlight();
    return true;
  };

  const offs = [
    ctx.input.on("down", (p) => {
      if (!human(p)) return;
      (choosing ? chooseTracker : tracker).down(p.id, p.x, p.y);
      showPressed();
    }),
    ctx.input.on("move", (p) => {
      if (!human(p)) return;
      tracker.move(p.id, p.x, p.y);
      chooseTracker.move(p.id, p.x, p.y);
      showPressed();
    }),
    ctx.input.on("up", (p) => {
      if (!human(p)) return;
      const inChoose = choosing !== null;
      const out = (inChoose ? chooseTracker : tracker).up(p.id, p.x, p.y);
      tracker.cancel(p.id);
      chooseTracker.cancel(p.id);
      showPressed();
      if (inChoose) {
        if (out?.type === "launch") choosing?.handle.activate(out.index);
      } else if (out?.type === "launch") pick(out.index);
      else if (out?.type === "page") turn(out.dir);
    }),
    ctx.input.on("cancel", (p) => {
      tracker.cancel(p.id);
      chooseTracker.cancel(p.id);
      showPressed();
    }),
  ];

  const hand = ctx.bots > 0 ? createBotHand(ctx.input) : null;
  let botAt = performance.now() + rng.range(3000, 5000);

  const sweep = (now: number) => {
    if (upcoming || pending || choosing || now - lastHuman < QUIET_MS || now < sweepAt) return;
    if (tiles.length === 0) return;
    sweepAt = now + SWEEP_MS;
    // One step past the last tile leaves them all dark for a beat before the sweep repeats.
    sweepStep = (sweepStep + 1) % (sweepOrder.length + 1);
    const lit = sweepOrder[sweepStep];
    tiles.forEach((t, i) => t.el.classList.toggle("is-lit", i === lit));
  };

  // Bots only turn pages, through the arrows, so the picker never leaves itself.
  const browse = (now: number) => {
    if (!hand || now < botAt) return;
    botAt = now + rng.range(BOT_GAP_S[0], BOT_GAP_S[1]) * 1000;
    const target = rng.next() < 0.25 ? layout.prev : layout.next;
    if (!target || pending || choosing || upcoming) return;
    void hand.tap(target.x + target.width / 2, target.y + target.height / 2, 120);
  };

  build();
  const offResize = ctx.onResize((f) => {
    frame = f;
    build();
  });

  const loop = ctx.loop({
    hz: 10,
    update() {
      const now = performance.now();
      if (choosing && !pending && now - chooseTouchedAt > CHOOSE_TIMEOUT_MS) closeChoose();
      if (upcoming && !pending && now >= upcomingAt) {
        const offer = upcoming;
        upcoming = null;
        start(offer);
      }
      sweep(now);
      browse(now);
    },
  });
  loop.start();
  // Changing app by itself, the picker waits for a choice only when a visitor came back to it.
  const why = ctx.system.returned;
  if (why !== "home" && why !== "error") queueNext();

  return {
    reset() {
      clearTimeout(pending);
      pending = 0;
      upcoming = null;
      hand?.release();
      closeChoose();
      lastHuman = -Infinity;
      page = 0;
      renderPage(0);
    },
    attract() {
      queueNext();
    },
    status() {
      return {
        page: page + 1,
        pages,
        offered: list.length,
        step: choosing ? "choose" : "grid",
        choosing: choosing?.offer.key ?? "",
        cycle,
        next: upcoming?.key ?? "",
      };
    },
    dispose() {
      disposed = true;
      clearTimeout(pending);
      pending = 0;
      loop.stop();
      offResize();
      for (const off of offs) off();
      hand?.dispose();
      for (const a of arrows) a.remove();
      root.remove();
    },
  };
};
