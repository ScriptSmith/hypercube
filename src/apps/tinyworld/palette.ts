import { type ButtonHandle, createButton, iconElement, PALETTE, withAlpha } from "../../core/ui";
import type { WidgetHost } from "./controls";
import { elementDef, hexToRgb } from "./elements";
import {
  hitWidget,
  layoutWidget,
  metrics,
  nearestWidget,
  type Part,
  resizeTo,
  type WidgetLayout,
  type WidgetRoom,
  type WidgetSpec,
  type WidgetState,
} from "./layout";
import { PIECE_KINDS, PIECE_MATERIAL } from "./pieces";
import { isRemove, type PlaceKind, type SwatchDef } from "./swatches";

/**
 * The palette widgets as plain DOM over the canvas. Each is a translucent panel the world shows
 * through; the panel itself ignores touches and the app hit-tests the parts from its own input,
 * so a finger can press a swatch and drag straight out, and a touch in a gap pours into the world.
 * Every node is made once per layout: moving, resizing and paging only change styles.
 */
export interface PaletteView extends WidgetHost {
  readonly layouts: readonly WidgetLayout[];
  /** Which widget's side of the world a position is on. */
  side(x: number): number;
  /** Pressed feedback and the name callout. */
  press(widget: number, swatch: SwatchDef): void;
  /** Mark each widget's current element and any waiting piece or tool. */
  mark(widget: number, element: number, place: PlaceKind | null): void;
  /** Show or move ghost hand `i` (venue px), or hide it with null. */
  ghost(i: number, at: { x: number; y: number; down: boolean } | null): void;
  /** Back to where the widgets started. */
  home(): void;
  dispose(): void;
}

export const MAX_GHOST_HANDS = 4;
const CALLOUT_MS = 1400;

const STYLE_ID = "tinyworld-palette-style";
const CSS = `
.pw-panel { position:absolute; transform-origin:0 0; pointer-events:none; }
.pw-tile { position:absolute; box-sizing:border-box; transition:transform 0.14s ease-out, filter 0.14s; }
.pw-tile.pw-pressed { transform:scale(0.9); filter:brightness(1.25); }
.pw-ring { position:absolute; box-sizing:border-box; opacity:0; transition:opacity 0.25s; pointer-events:none; }
.pw-selected > .pw-ring, .pw-armed > .pw-ring { opacity:1; }
.pw-armed > .pw-ring { animation:pw-armed 1.1s ease-in-out infinite; }
.pw-callout { position:absolute; transform:translate(-50%,-100%); white-space:nowrap; opacity:0;
  transition:opacity 0.25s; pointer-events:none; }
.pw-callout.pw-show { opacity:1; }
@keyframes pw-armed { 0%,100% { transform:scale(1); opacity:0.95; } 50% { transform:scale(1.06); opacity:0.45; } }
@media (prefers-reduced-motion: reduce) { .pw-armed > .pw-ring { animation:none; } }
`;

const ensureCss = () => {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
};

const luminance = (hex: string): number => {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const svg = (body: string) =>
  `<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true" style="display:block;overflow:visible">${body}</svg>`;

const MOVE_GLYPH = svg(
  '<g fill="currentColor"><path d="M50 6l14 16H56v20h20v-8l16 16-16 16v-8H56v20h8L50 94 36 78h8V58H24v8L8 50l16-16v8h20V22h-8z"/></g>',
);
const RESIZE_GLYPH = svg(
  '<g fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"><path d="M22 78L78 22M50 22h28v28M22 50v28h28"/></g>',
);

interface TileLook {
  background: string;
  glyph: string;
  text: string;
  glow: string;
}

const tileLook = (def: SwatchDef): TileLook => {
  if (isRemove(def.choice)) {
    return {
      background: "linear-gradient(160deg, rgba(62,36,44,0.94), rgba(34,20,26,0.94))",
      glyph: "#f2a7b0",
      text: "rgba(248,226,230,0.95)",
      glow: withAlpha("#f2a7b0", 0.18),
    };
  }
  if (def.choice.type === "place") {
    const k = def.choice.place;
    const tint = (PIECE_KINDS as readonly string[]).includes(k)
      ? elementDef(PIECE_MATERIAL[k as keyof typeof PIECE_MATERIAL]).colors[2]
      : "#9fc7e0";
    return {
      background: "linear-gradient(160deg, rgba(36,44,62,0.94), rgba(20,25,36,0.94))",
      glyph: tint,
      text: "rgba(232,238,248,0.92)",
      glow: withAlpha(tint, 0.16),
    };
  }
  const [dark, base, light] = elementDef(def.choice.element).colors;
  const bright = luminance(base) > 0.35;
  return {
    background: `radial-gradient(circle at 32% 26%, ${light}, ${base} 58%, ${dark})`,
    glyph: bright ? "rgba(12,15,22,0.66)" : "rgba(244,240,232,0.86)",
    text: bright ? "rgba(12,15,22,0.82)" : "rgba(244,240,232,0.95)",
    glow: withAlpha(base, def.danger ? 0.45 : 0.26),
  };
};

interface WidgetDom {
  panel: HTMLElement;
  frame: HTMLElement;
  lower: HTMLElement;
  grip: HTMLElement;
  resize: HTMLElement;
  reset: ButtonHandle;
  tabs: HTMLElement[];
  /** Tiles per swatch id (a swatch appears once per widget). */
  tiles: Map<string, HTMLElement>;
  callout: HTMLElement;
  calloutTimer: number;
  pressTimers: Set<number>;
}

export const createPaletteView = (
  root: HTMLElement,
  spec: WidgetSpec,
  homes: readonly { state: WidgetState; room: WidgetRoom }[],
  unit: number,
  onReset: () => void,
): PaletteView => {
  ensureCss();
  const layer = document.createElement("div");
  layer.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:2;";
  root.append(layer);
  const u = (v: number) => `${v * unit}px`;
  const S = spec.size;
  const bar = metrics(spec).bar * unit;
  const defs = new Map(
    [...spec.palette.pages.flatMap((p) => p.swatches), ...spec.palette.danger].map((s) => [
      s.id,
      s,
    ]),
  );

  let states = homes.map((h) => ({ ...h.state }));
  const rooms = homes.map((h) => h.room);
  let layouts: WidgetLayout[] = [];
  const doms: WidgetDom[] = [];

  const makeTile = (sw: SwatchDef): HTMLElement => {
    const look = tileLook(sw);
    const el = document.createElement("div");
    el.className = "pw-tile";
    el.dataset.swatch = sw.id;
    el.style.cssText +=
      `border-radius:22%;background:${look.background};` +
      `box-shadow:0 0 ${u(24)} ${look.glow},inset 0 ${u(-6)} ${u(14)} rgba(0,0,0,0.28);` +
      `border:${u(3)} solid rgba(255,255,255,0.14);`;
    const glyph = document.createElement("div");
    glyph.style.cssText = `position:absolute;left:22%;right:22%;top:11%;height:56%;color:${look.glyph};`;
    glyph.innerHTML = svg(sw.glyph);
    const label = document.createElement("div");
    label.textContent = sw.label;
    label.style.cssText =
      `position:absolute;left:0;right:0;bottom:7%;text-align:center;color:${look.text};` +
      `font:750 ${u(S * 0.155)} system-ui,"Segoe UI",Roboto,sans-serif;letter-spacing:0.01em;`;
    const ring = document.createElement("div");
    ring.className = "pw-ring";
    ring.style.cssText += `inset:${u(-11)};border-radius:26%;border:${u(7)} solid ${withAlpha(PALETTE.accent, 0.9)};`;
    el.append(glyph, label, ring);
    return el;
  };

  homes.forEach((_, wi) => {
    const panel = document.createElement("div");
    panel.className = "pw-panel";
    // Two cards: the bar and danger row on top, tabs and swatches below. They join into one
    // panel unless the danger row is lifted above children's reach.
    const card = () => {
      const c = document.createElement("div");
      c.style.cssText =
        `position:absolute;left:0;right:0;border-radius:${u(30)};background:rgba(14,19,30,0.32);` +
        `border:${u(3)} solid rgba(255,255,255,0.12);box-shadow:0 0 ${u(30)} rgba(0,0,0,0.25);` +
        "box-sizing:border-box;";
      return c;
    };
    const frame = card();
    const lower = card();
    const handle = (glyph: string) => {
      const h = document.createElement("div");
      h.style.cssText =
        `position:absolute;display:flex;align-items:center;justify-content:center;` +
        `border-radius:${u(26)};background:rgba(255,255,255,0.08);color:rgba(230,236,246,0.75);` +
        `border:${u(2)} solid rgba(255,255,255,0.14);box-sizing:border-box;`;
      const icon = document.createElement("div");
      icon.style.cssText = "width:58%;height:58%;max-width:58%;";
      icon.innerHTML = glyph;
      h.append(icon);
      return h;
    };
    const grip = handle(MOVE_GLYPH);
    const resize = handle(RESIZE_GLYPH);
    panel.dataset.widget = String(wi);
    grip.dataset.part = "move";
    resize.dataset.part = "resize";
    const reset = createButton(
      {
        icon: "reset",
        rect: { x: 0, y: 0, width: bar, height: bar },
        hold: 2000,
        look: "ghost",
        color: PALETTE.muted,
        onPress: onReset,
      },
      unit,
    );
    // The bar's controls grow in local units when the widget shrinks; stay round.
    reset.el.style.borderRadius = "50%";
    // Icon over label, so even "Gadgets" fits a narrow tab.
    const tabs = spec.palette.pages.map((p) => {
      const t = document.createElement("div");
      t.dataset.tab = p.id;
      t.style.cssText =
        `position:absolute;box-sizing:border-box;display:flex;flex-direction:column;` +
        `align-items:center;justify-content:center;gap:${u(S * 0.03)};overflow:hidden;` +
        `border-radius:${u(24)};border:${u(3)} solid rgba(255,255,255,0.16);` +
        `font:750 ${u(S * 0.135)} system-ui,"Segoe UI",Roboto,sans-serif;line-height:1;white-space:nowrap;`;
      const icon = document.createElement("div");
      icon.style.cssText = `width:${u(S * 0.28)};height:${u(S * 0.28)};flex:none;`;
      icon.innerHTML = svg(p.glyph);
      const label = document.createElement("span");
      label.textContent = p.label;
      t.append(icon, label);
      return t;
    });
    const tiles = new Map<string, HTMLElement>();
    for (const sw of defs.values()) tiles.set(sw.id, makeTile(sw));
    panel.append(frame, lower, grip, resize, reset.el, ...tabs, ...tiles.values());
    const callout = document.createElement("div");
    callout.className = "pw-callout";
    callout.style.cssText +=
      `padding:${u(14)} ${u(34)};border-radius:${u(40)};background:rgba(10,14,22,0.88);` +
      `border:${u(3)} solid ${withAlpha(PALETTE.accent, 0.7)};color:${PALETTE.foreground};` +
      `font:800 ${u(64)} system-ui,"Segoe UI",Roboto,sans-serif;`;
    layer.append(panel, callout);
    doms[wi] = {
      panel,
      frame,
      lower,
      grip,
      resize,
      reset,
      tabs,
      tiles,
      callout,
      calloutTimer: 0,
      pressTimers: new Set(),
    };
  });

  const place = (
    el: HTMLElement,
    box: { x: number; y: number; width: number; height: number },
    l: WidgetLayout,
  ) => {
    // World box to the panel's unscaled local space.
    const s = l.scale;
    el.style.left = u((box.x - l.box.x) / s);
    el.style.top = u((box.y - l.box.y) / s);
    el.style.width = u(box.width / s);
    el.style.height = u(box.height / s);
  };

  const render = (wi: number) => {
    const res = layoutWidget(spec, states[wi]!, rooms[wi]!);
    states[wi] = res.state;
    const l = res.layout;
    layouts[wi] = l;
    const d = doms[wi];
    if (!d) return;
    d.panel.style.left = u(l.box.x);
    d.panel.style.top = u(l.box.y);
    d.panel.style.width = u(l.base.width);
    d.panel.style.height = u(l.base.height);
    d.panel.style.transform = `scale(${l.scale})`;
    const split = l.base.spacer > 24;
    d.frame.style.top = "0px";
    d.frame.style.height = u(split ? l.base.gapTop : l.base.height);
    d.lower.style.display = split ? "" : "none";
    d.lower.style.top = u(l.base.gapBottom);
    d.lower.style.height = u(l.base.height - l.base.gapBottom);
    for (const part of l.parts) {
      if (part.type === "move") place(d.grip, part.box, l);
      else if (part.type === "resize") place(d.resize, part.box, l);
      else if (part.type === "tab") {
        const t = d.tabs[part.page];
        if (!t) continue;
        place(t, part.box, l);
        const on = part.page === res.state.page;
        t.style.background = on ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.06)";
        t.style.color = on ? PALETTE.foreground : "rgba(230,236,246,0.7)";
      }
    }
    place(d.reset.el, l.reset, l);
    const shown = new Set(l.swatches.map((s) => s.swatch.id));
    for (const [id, tile] of d.tiles) tile.style.display = shown.has(id) ? "" : "none";
    for (const s of l.swatches) {
      const tile = d.tiles.get(s.swatch.id);
      if (tile) place(tile, s.box, l);
    }
  };

  const renderAll = () => homes.forEach((_, i) => render(i));
  renderAll();

  const ghosts: HTMLElement[] = [];
  const ghostSize = 150 * unit;
  for (let i = 0; i < MAX_GHOST_HANDS; i++) {
    const g = iconElement("hand", "100%", withAlpha(PALETTE.foreground, 0.55));
    g.style.cssText +=
      `position:absolute;left:0;top:0;width:${ghostSize}px;height:${ghostSize}px;` +
      "opacity:0;transition:opacity 0.4s;will-change:transform;" +
      `filter:drop-shadow(0 0 ${u(14)} rgba(0,0,0,0.6));`;
    layer.append(g);
    ghosts.push(g);
  }

  const marks = homes.map(() => ({ element: -1, place: null as PlaceKind | null }));
  const resizing: ({ scale: number; x: number; y: number } | null)[] = homes.map(() => null);

  return {
    get layouts() {
      return layouts;
    },

    hit(x, y) {
      for (let i = layouts.length - 1; i >= 0; i--) {
        const l = layouts[i];
        const part: Part | null = l ? hitWidget(l, x, y) : null;
        if (part) return { widget: i, part };
      }
      return null;
    },

    moveBy(wi, dx, dy) {
      const s = states[wi];
      if (!s) return;
      states[wi] = { ...s, x: s.x + dx, bottom: s.bottom + dy };
      render(wi);
    },

    resizeTo(wi, x0, y0, x, y) {
      const s = states[wi];
      if (!s) return;
      // The scale when this drag began: kept while the same drag continues.
      const drag = resizing[wi];
      const from = drag && drag.x === x0 && drag.y === y0 ? drag : { scale: s.scale, x: x0, y: y0 };
      resizing[wi] = from;
      states[wi] = resizeTo(spec, s, from, x, y);
      render(wi);
    },

    setPage(wi, page) {
      const s = states[wi];
      if (!s || s.page === page) return;
      states[wi] = { ...s, page };
      render(wi);
    },

    side: (x) => nearestWidget(layouts, x),

    press(wi, sw) {
      const d = doms[wi];
      const l = layouts[wi];
      if (!d || !l) return;
      const tile = d.tiles.get(sw.id);
      if (tile) {
        tile.classList.add("pw-pressed");
        const t = window.setTimeout(() => {
          d.pressTimers.delete(t);
          tile.classList.remove("pw-pressed");
        }, 180);
        d.pressTimers.add(t);
      }
      const box = l.swatches.find((s) => s.swatch.id === sw.id)?.box;
      if (!box) return;
      d.callout.textContent = sw.label;
      d.callout.style.left = u(box.x + box.width / 2);
      d.callout.style.top = u(Math.max(80, l.box.y - 16));
      d.callout.classList.add("pw-show");
      clearTimeout(d.calloutTimer);
      d.calloutTimer = window.setTimeout(() => d.callout.classList.remove("pw-show"), CALLOUT_MS);
    },

    mark(wi, element, placeKind) {
      const d = doms[wi];
      const m = marks[wi];
      if (!d || !m || (m.element === element && m.place === placeKind)) return;
      m.element = element;
      m.place = placeKind;
      for (const [id, tile] of d.tiles) {
        const sw = defs.get(id);
        const selected = sw?.choice.type === "element" && sw.choice.element === element;
        const armed = sw?.choice.type === "place" && sw.choice.place === placeKind;
        tile.classList.toggle("pw-selected", Boolean(selected) && !placeKind);
        tile.classList.toggle("pw-armed", Boolean(armed));
      }
    },

    ghost(i, at) {
      const g = ghosts[i];
      if (!g) return;
      if (!at) {
        g.style.opacity = "0";
        return;
      }
      // The fingertip of the glyph sits at the touch point.
      const x = at.x * unit - ghostSize * 0.48;
      const y = at.y * unit - ghostSize * 0.08;
      g.style.transform = `translate(${x}px,${y}px) scale(${at.down ? 0.92 : 1})`;
      g.style.opacity = at.down ? "0.9" : "0.6";
    },

    home() {
      states = homes.map((h) => ({ ...h.state }));
      renderAll();
    },

    dispose() {
      for (const d of doms) {
        clearTimeout(d.calloutTimer);
        for (const t of d.pressTimers) clearTimeout(t);
        d.reset.dispose();
      }
      layer.remove();
    },
  };
};
