import type { AppContext, AppInstance } from "../../core/types";
import { BRIDGE_VERSION, parseViewerMessage, viewerUrl, type KioskLevel } from "./bridge";
import { graphById, nextGraph } from "./graphs";
import { LAYOUT_CHOICES, LAYOUT_ICON, layoutById, type LayoutChoice } from "./layouts";
import { regionsFor, type Box, type Regions } from "./regions";
import { neighboursOf, nextOnTour } from "./tour";
import type { GraphDef } from "./types";
import { buildWorkspace } from "./workspace";

/**
 * Venue px per viewer px. The viewer lays itself out at a smaller size and is scaled up, so
 * its own text and controls read from a distance. The steps with panels need room for them.
 */
const SCALE_GRAPH = 2.5;
const SCALE_PANELS = 1.6;
/** The corner the admin unlock gesture listens in (`CORNER_VENUE_PX`), plus a margin. */
const CORNER_PAD = 240;
/** Without a `ready` from the viewer after this long, load it again (offline, slow, updated). */
const LOAD_RETRY_MS = 20_000;
/** A bot acts every few seconds, and stands back this long after a person touches the viewer. */
const BOT_MS = [2500, 5000] as const;
const BOT_REST_MS = 20_000;

const LEVELS: readonly KioskLevel[] = ["display", "touch", "panels"];

const level = (ctx: AppContext): KioskLevel => {
  const choice = String(ctx.options.level);
  if ((LEVELS as readonly string[]).includes(choice)) return choice as KioskLevel;
  return ctx.frame.touch ? "touch" : "display";
};

const list = (names: string[]) => names.join(", ");

export const mount = (ctx: AppContext): AppInstance => {
  let def: GraphDef = graphById(ctx.variant);
  const palette = ctx.ui.palette;
  const rng = ctx.rng("graphs-tour");
  const kiosk = level(ctx);
  const withPanels = kiosk === "panels";
  const scale = withPanels ? SCALE_PANELS : SCALE_GRAPH;
  const showCards = ctx.options.card !== false && !withPanels;
  let nodes = new Map(def.nodes.map((n) => [n.id, n]));
  let roleColor = new Map(def.roles.map((r) => [r.id, r.color]));

  const viewer = document.createElement("iframe");
  viewer.title = def.title;
  viewer.setAttribute("sandbox", "allow-scripts allow-same-origin");
  viewer.style.cssText = `position:absolute;border:0;transform-origin:0 0;background:${palette.background};color-scheme:dark;`;
  const viewerSrc = viewerUrl({ level: kiosk, expand: ctx.options.doubleTap === true });
  viewer.src = viewerSrc;

  const card = document.createElement("div");
  card.style.cssText =
    "position:absolute;box-sizing:border-box;pointer-events:none;display:flex;" +
    "flex-direction:column;justify-content:center;align-items:center;text-align:center;" +
    `overflow:hidden;color:${palette.foreground};font-family:system-ui,sans-serif;`;
  // The unlock gesture listens on the stage, and touches inside an iframe never reach it.
  const pad = document.createElement("div");
  pad.style.cssText = "position:absolute;left:0;bottom:0;touch-action:none;";
  ctx.root.append(viewer, card, pad);

  const px = (v: number) => `${Math.round(v * 10) / 10}px`;
  let regions: Regions;
  let k = 1;
  let resetButton: HTMLElement | null = null;
  let layoutButton: HTMLElement | null = null;
  let choice: LayoutChoice = LAYOUT_CHOICES[0]!;
  const layout = () => {
    const f = ctx.frame;
    regions = regionsFor({
      kind: f.kind,
      width: f.width,
      height: f.height,
      unit: f.unit,
      reachTop: f.reachTop.adult,
      seams: f.seams,
      card: showCards,
      buttons: withPanels ? "left" : "right",
    });
    k = scale * f.unit;
    const v = regions.viewer;
    viewer.style.left = px(v.x);
    viewer.style.top = px(v.y);
    viewer.style.width = px(v.width / k);
    viewer.style.height = px(v.height / k);
    viewer.style.transform = `scale(${k})`;
    const c = regions.card;
    card.style.left = px(c.x);
    card.style.top = px(c.y);
    card.style.width = px(c.width);
    card.style.height = px(c.height);
    // Room beside the text for the reset and Home buttons on a strip.
    const side = f.kind === "panel" || f.kind === "pair" ? 188 * f.unit : 0;
    card.style.padding = `0 ${px(side)}`;
    pad.style.width = pad.style.height = px(CORNER_PAD * f.unit);
    resetButton?.remove();
    resetButton = null;
    layoutButton?.remove();
    layoutButton = null;
    const r = regions.reset;
    if (f.touch && kiosk !== "display" && r.width > 0) {
      resetButton = ctx.ui.button({
        icon: "reset",
        rect: r,
        hold: 1000,
        look: "ghost",
        color: palette.muted,
        onPress: () => api.reset(),
      });
      const l = regions.layout;
      if (ctx.options.layouts !== false && l.width > 0) {
        layoutButton = ctx.ui.button({
          icon: LAYOUT_ICON,
          rect: l,
          look: "ghost",
          color: palette.muted,
          onPress: () => {
            const next =
              LAYOUT_CHOICES[(LAYOUT_CHOICES.indexOf(choice) + 1) % LAYOUT_CHOICES.length]!;
            useLayout(next);
            ctx.ui.toast(next.name, 1400);
          },
        });
      }
    }
  };
  const workspace = () =>
    buildWorkspace(
      def,
      {
        width: regions.viewer.width / k,
        height: regions.viewer.height / k,
        direction: regions.direction,
      },
      choice,
    );

  let picked: string | null = null;
  let ready = false;

  const showCard = (id: string | null) => {
    card.replaceChildren();
    if (!showCards) return;
    const s = ctx.frame.unit * regions.cardScale;
    const node = id === null ? undefined : nodes.get(id);
    const line = (text: string, size: number, color: string, weight = "400") => {
      const el = document.createElement("div");
      el.textContent = text;
      el.style.cssText = `font-size:${size * s}px;line-height:1.25;color:${color};font-weight:${weight};margin-top:${8 * s}px;`;
      card.append(el);
    };
    if (!ready) {
      line("Loading", 44, palette.muted);
      return;
    }
    if (!node) {
      line(def.caption, 44, palette.muted);
      return;
    }
    const edge = roleColor.get(node.role) ?? palette.muted;
    const { inbound, outbound } = neighboursOf(def, node.id);
    const title = document.createElement("div");
    title.style.cssText = `border-bottom:${5 * s}px solid ${edge};padding-bottom:${4 * s}px;`;
    card.append(title);
    const name = document.createElement("span");
    name.textContent = node.name;
    name.style.cssText = `font-size:${64 * s}px;font-weight:700;`;
    title.append(name);
    line(node.note, 38, palette.foreground);
    if (inbound.length) line(`${def.edgeMeaning.in}: ${list(inbound)}`, 32, palette.muted);
    if (outbound.length) line(`${def.edgeMeaning.out}: ${list(outbound)}`, 32, palette.muted);
  };

  const post = (message: Record<string, unknown>) =>
    viewer.contentWindow?.postMessage({ ngv: BRIDGE_VERSION, ...message }, "*");

  let tourTimer = 0;
  let tourAt: string | null = null;
  const stopTour = () => {
    window.clearInterval(tourTimer);
    tourTimer = 0;
  };
  const startTour = () => {
    stopTour();
    // Bots walk the graph themselves.
    if (ctx.options.tour === false || ctx.bots > 0) return;
    const ms = Math.max(3, Number(ctx.options.tourSeconds) || 7) * 1000;
    tourTimer = window.setInterval(() => {
      tourAt = nextOnTour(def, tourAt, rng);
      post({ type: "select", id: tourAt, center: false });
    }, ms);
  };

  const load = () => {
    if (ready) post({ type: "load", workspace: workspace() });
  };
  // An algorithm moves the nodes over a second or two; the view is fitted again once they have.
  let fitTimers: number[] = [];
  const clearFits = () => {
    for (const t of fitTimers) window.clearTimeout(t);
    fitTimers = [];
  };
  /** Sends the graph again under another arrangement; the viewer moves the nodes into it. */
  const useLayout = (next: LayoutChoice) => {
    choice = next;
    picked = null;
    tourAt = null;
    showCard(null);
    load();
    clearFits();
    if (next.viewer) {
      fitTimers = [1500, 3500].map((ms) => window.setTimeout(() => post({ type: "fit" }), ms));
    }
  };
  const useGraph = (next: GraphDef) => {
    clearFits();
    choice = LAYOUT_CHOICES[0]!;
    def = next;
    nodes = new Map(def.nodes.map((n) => [n.id, n]));
    roleColor = new Map(def.roles.map((r) => [r.id, r.color]));
    viewer.title = def.title;
    picked = null;
    tourAt = null;
    showCard(null);
    stopTour();
    load();
  };

  // An unreachable or outdated viewer never says `ready`; keep asking for it.
  const retry = window.setInterval(() => {
    if (!ready) viewer.src = viewerSrc;
  }, LOAD_RETRY_MS);

  // Bots stand in for a visitor: they tap their way along the links, now and then try another
  // layout or hold reset, and stand back while a person uses the viewer.
  const botRng = ctx.rng("graphs-bot");
  let botTimer = 0;
  let botUp = 0;
  let botPointer = -1;
  let personAt = -Infinity;
  const botTap = (b: Box, hold: number) => {
    botPointer = ctx.input.inject.down(b.x + b.width / 2, b.y + b.height / 2);
    botUp = window.setTimeout(() => {
      ctx.input.inject.up(botPointer);
      botPointer = -1;
    }, hold);
  };
  const botStep = () => {
    botTimer = window.setTimeout(botStep, botRng.range(BOT_MS[0], BOT_MS[1]));
    if (!ready || botPointer >= 0 || performance.now() - personAt < BOT_REST_MS) return;
    const roll = botRng.next();
    if (layoutButton && roll < 0.1) botTap(regions.layout, 120);
    else if (resetButton && roll < 0.14) botTap(regions.reset, 1200);
    else post({ type: "select", id: nextOnTour(def, picked, botRng), center: true });
  };
  if (ctx.bots > 0) botStep();

  const onMessage = (e: MessageEvent) => {
    if (e.source !== viewer.contentWindow) return;
    const message = parseViewerMessage(e.data);
    if (!message) return;
    switch (message.type) {
      case "ready":
        ready = true;
        showCard(picked);
        load();
        break;
      case "loaded":
        startTour();
        break;
      case "select":
        picked = message.id;
        showCard(picked);
        break;
      case "activity":
        // A person is using it: the walk stops and the page counts as busy.
        stopTour();
        tourAt = null;
        personAt = performance.now();
        ctx.idle.poke();
        break;
      case "error":
        ctx.log("viewer", message.message);
        break;
    }
  };
  window.addEventListener("message", onMessage);

  layout();
  showCard(null);
  const offResize = ctx.onResize(() => {
    layout();
    showCard(picked);
    load();
  });

  const api: AppInstance = {
    reset() {
      clearFits();
      choice = LAYOUT_CHOICES[0]!;
      picked = null;
      tourAt = null;
      showCard(null);
      stopTour();
      // A fresh load puts every node back where the layout had it and drops any pan or zoom.
      load();
    },
    attract() {
      if (ctx.options.rotate === true) useGraph(nextGraph(def.id));
      if (!tourTimer) startTour();
    },
    status: () => ({ graph: def.id, selected: picked ?? "", ready, layout: choice.id }),
    command(name, args) {
      if (name === "graph" && typeof args === "string") useGraph(graphById(args));
      else if (name === "next") useGraph(nextGraph(def.id));
      else if (name === "layout" && typeof args === "string") useLayout(layoutById(args));
      else if (name === "select" && typeof args === "string") post({ type: "select", id: args });
    },
    homeSpot(size) {
      const h = regions.home;
      return h ? { x: h.x + h.width - size, y: h.y + h.height - size } : null;
    },
    dispose() {
      stopTour();
      clearFits();
      window.clearInterval(retry);
      window.clearTimeout(botTimer);
      window.clearTimeout(botUp);
      if (botPointer >= 0) ctx.input.inject.up(botPointer);
      window.removeEventListener("message", onMessage);
      offResize();
      resetButton?.remove();
      layoutButton?.remove();
      viewer.src = "about:blank";
      viewer.remove();
      card.remove();
      pad.remove();
    },
  };
  return api;
};
