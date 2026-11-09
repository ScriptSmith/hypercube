/**
 * Mode and route buttons. A mode button shows its vehicle in the colour those vehicles have on
 * the map; pressing it lights them up, so the button explains itself. A route button shows the
 * route's number (none for rail, whose codes mean nothing to visitors) and a sketch of the line's
 * real shape; pressing it lights that line on the map and the sketch matches what appears.
 * While a highlight lasts its button stays lit, with a ring or bar running down. Zoom buttons
 * zoom in, out, or back to the tour; one fades while the map is as close or as far as it goes.
 */
import { SYNTHETIC_ID_BASE } from "../../core/input";
import { withAlpha } from "../../core/ui/palette";
import { FONT } from "../../core/ui/style";
import type { Focus } from "./highlight";
import { modeIcon, sketchPath, zoomIcon } from "./icons";
import type { Box, TransitLayout, ZoomAction } from "./layout";
import type { Network } from "./network";
import { lineById, type Line, MODE_COLOR, type Mode } from "./routes";

const DARK = "#05070d";
const PRESS_MS = 160;
const MAX_SKETCH_SHAPES = 14;
const ZOOM_COLOR = "#e8eef8";

export interface Controls {
  update(focus: Focus | null, now: number): void;
  sketch(net: Network): void;
  /** Fade the zoom in or out buttons while the map can't zoom further that way. */
  zoomable(canIn: boolean, canOut: boolean): void;
  /** Button centres in stage px, for bots. */
  targets(): { kind: "mode" | "line" | "zoom"; id: string; x: number; y: number }[];
  dispose(): void;
}

interface ModeButton {
  mode: Mode;
  el: HTMLElement;
  icon: HTMLElement;
  ring: SVGCircleElement;
  circumference: number;
  box: Box;
}

interface LineButton {
  line: Line;
  el: HTMLElement;
  sketch: SVGSVGElement;
  path: SVGPathElement;
  bar: HTMLElement;
  icon: HTMLElement;
  label: HTMLElement | null;
  box: Box;
}

const SVG = "http://www.w3.org/2000/svg";

export const createControls = (opts: {
  root: HTMLElement;
  layout: TransitLayout;
  unit: number;
  onMode(mode: Mode, human: boolean): void;
  onLine(id: string, human: boolean): void;
  onZoom(action: ZoomAction, human: boolean): void;
}): Controls => {
  const u = opts.unit;
  const px = (v: number) => `${(v * u).toFixed(2)}px`;
  const layer = document.createElement("div");
  layer.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:3;";
  opts.root.append(layer);
  const timers = new Set<number>();

  for (const p of opts.layout.panels) {
    const el = document.createElement("div");
    el.style.cssText =
      `position:absolute;left:${px(p.x)};top:${px(p.y)};width:${px(p.w)};height:${px(p.h)};` +
      `background:${withAlpha(DARK, 0.86)};border:${px(2)} solid rgba(255,255,255,0.07);` +
      `border-radius:${px(opts.layout.panels.length > 1 || p.y > 0 ? 40 : 0)};`;
    layer.append(el);
  }

  const press = (el: HTMLElement, run: (human: boolean) => void) => {
    el.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
      el.style.transform = "scale(0.93)";
      const t = window.setTimeout(() => {
        timers.delete(t);
        el.style.transform = "";
      }, PRESS_MS);
      timers.add(t);
      run(e.pointerId < SYNTHETIC_ID_BASE);
    });
  };

  const base = (b: Box, radius: number) => {
    const el = document.createElement("div");
    el.setAttribute("role", "button");
    el.style.cssText =
      `position:absolute;left:${px(b.x)};top:${px(b.y)};width:${px(b.w)};height:${px(b.h)};` +
      `box-sizing:border-box;border-radius:${px(radius)};pointer-events:auto;touch-action:none;` +
      "user-select:none;-webkit-user-select:none;cursor:pointer;transition:transform 0.12s ease-out," +
      "background-color 0.25s,box-shadow 0.25s,border-color 0.25s;";
    layer.append(el);
    return el;
  };

  const modes: ModeButton[] = opts.layout.modes.map(({ mode, box }) => {
    const color = MODE_COLOR[mode];
    const el = base(box, box.w / 2);
    el.setAttribute("aria-label", mode);
    el.dataset.mode = mode;
    el.style.background = withAlpha(DARK, 0.9);
    el.style.border = `${px(7)} solid ${withAlpha(color, 0.75)}`;
    el.style.display = "flex";
    el.style.alignItems = "center";
    el.style.justifyContent = "center";
    const icon = document.createElement("div");
    icon.style.cssText = `width:${px(box.w * 0.6)};height:${px(box.w * 0.6)};color:${color};`;
    icon.innerHTML = modeIcon(mode);
    el.append(icon);
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.style.cssText = `position:absolute;inset:${px(-16)};width:calc(100% + ${px(32)});height:calc(100% + ${px(32)});pointer-events:none;overflow:visible;transform:rotate(-90deg);`;
    const ring = document.createElementNS(SVG, "circle");
    ring.setAttribute("cx", "50");
    ring.setAttribute("cy", "50");
    ring.setAttribute("r", "48");
    ring.setAttribute("fill", "none");
    ring.setAttribute("stroke", color);
    ring.setAttribute("stroke-width", "3");
    ring.setAttribute("stroke-linecap", "round");
    const circumference = 2 * Math.PI * 48;
    ring.setAttribute("stroke-dasharray", `${circumference} ${circumference}`);
    ring.style.strokeDashoffset = String(circumference);
    svg.append(ring);
    el.append(svg);
    press(el, (human) => opts.onMode(mode, human));
    return { mode, el, icon, ring, circumference, box };
  });

  const lines: LineButton[] = [];
  for (const { line: id, box } of opts.layout.lines) {
    const line = lineById(id);
    if (!line) continue;
    const color = MODE_COLOR[line.mode];
    const el = base(box, 26);
    el.setAttribute("aria-label", line.label || line.mode);
    el.dataset.line = id;
    el.style.background = withAlpha(DARK, 0.9);
    el.style.border = `${px(4)} solid ${withAlpha(color, 0.45)}`;
    el.style.overflow = "hidden";
    const rail = !line.label;
    const sketchH = box.h * (rail ? 0.6 : 0.5);
    const sketch = document.createElementNS(SVG, "svg");
    sketch.style.cssText = `position:absolute;left:${px(10)};top:${px(8)};width:${px(box.w - 20)};height:${px(sketchH)};overflow:visible;`;
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", color);
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    sketch.append(path);
    el.append(sketch);
    const row = document.createElement("div");
    const rowH = box.h - sketchH - 18;
    row.style.cssText =
      `position:absolute;left:0;right:0;bottom:${px(12)};height:${px(rowH)};display:flex;` +
      `align-items:center;justify-content:center;gap:${px(12)};color:${color};`;
    const icon = document.createElement("div");
    const iconSize = rail
      ? Math.min(rowH * 1.25, box.w * 0.3)
      : Math.min(rowH, box.w * 0.34) * 0.82;
    icon.style.cssText = `width:${px(iconSize)};height:${px(iconSize)};flex:none;`;
    icon.innerHTML = modeIcon(line.mode);
    row.append(icon);
    let label: HTMLElement | null = null;
    if (line.label) {
      label = document.createElement("div");
      label.textContent = line.label;
      label.style.cssText = `font:800 ${px(Math.min(rowH * 0.92, box.w * 0.26))} ${FONT};color:#f2f5fa;letter-spacing:0.01em;line-height:1;`;
      row.append(label);
    }
    el.append(row);
    const bar = document.createElement("div");
    bar.style.cssText = `position:absolute;left:0;bottom:0;height:${px(7)};width:100%;background:${color};transform-origin:left;transform:scaleX(0);`;
    el.append(bar);
    press(el, (human) => opts.onLine(id, human));
    lines.push({ line, el, sketch, path, bar, icon, label, box });
  }

  const zooms = opts.layout.zooms.map(({ action, box }) => {
    const el = base(box, box.w * 0.24);
    el.setAttribute("aria-label", `zoom ${action}`);
    el.dataset.zoom = action;
    el.style.background = withAlpha(DARK, 0.9);
    el.style.border = `${px(5)} solid ${withAlpha(ZOOM_COLOR, 0.4)}`;
    el.style.display = "flex";
    el.style.alignItems = "center";
    el.style.justifyContent = "center";
    el.style.transition += ",opacity 0.25s";
    const icon = document.createElement("div");
    icon.style.cssText = `width:${px(box.w * 0.52)};height:${px(box.w * 0.52)};color:${ZOOM_COLOR};pointer-events:none;`;
    icon.innerHTML = zoomIcon(action);
    el.append(icon);
    press(el, (human) => opts.onZoom(action, human));
    return { action, el, box };
  });
  let canZoom = { in: true, out: true };

  let lastFocus: Focus | null = null;

  return {
    update(focus, now) {
      const changed = focus !== lastFocus;
      lastFocus = focus;
      const left = focus
        ? Math.max(0, Math.min(1, (focus.until - now) / (focus.until - focus.since)))
        : 0;
      for (const b of modes) {
        const on = focus?.kind === "mode" && focus.mode === b.mode;
        if (changed) {
          const color = MODE_COLOR[b.mode];
          b.el.style.background = on ? color : withAlpha(DARK, 0.9);
          b.el.style.boxShadow = on ? `0 0 ${px(60)} ${withAlpha(color, 0.65)}` : "none";
          b.icon.style.color = on ? DARK : color;
        }
        b.ring.style.strokeDashoffset = String(on ? b.circumference * (1 - left) : b.circumference);
      }
      for (const b of lines) {
        const on = focus?.kind === "line" && focus.line.id === b.line.id;
        if (changed) {
          const color = MODE_COLOR[b.line.mode];
          b.el.style.background = on ? withAlpha(color, 0.3) : withAlpha(DARK, 0.9);
          b.el.style.borderColor = on ? color : withAlpha(color, 0.45);
          b.el.style.boxShadow = on ? `0 0 ${px(50)} ${withAlpha(color, 0.55)}` : "none";
          b.path.setAttribute("stroke", on ? "#ffffff" : color);
        }
        b.bar.style.transform = `scaleX(${on ? left : 0})`;
      }
    },
    sketch(net) {
      for (const b of lines) {
        const shapes: Float32Array[] = [];
        for (const [base, list] of net.byRoute) {
          if (!b.line.has(base)) continue;
          // One direction is enough for a sketch; use the other when a route only has that.
          const dir = list.some((x) => x.dir === 0) ? 0 : 1;
          for (const s of list) if (s.dir === dir) shapes.push(s.pts);
        }
        shapes.sort((p, q) => q.length - p.length);
        const w = (b.box.w - 20) * u;
        const h = b.box.h * (b.label ? 0.5 : 0.6) * u;
        b.sketch.setAttribute("viewBox", `0 0 ${w.toFixed(1)} ${h.toFixed(1)}`);
        b.path.setAttribute("d", sketchPath(shapes.slice(0, MAX_SKETCH_SHAPES), w, h, 6 * u));
        b.path.setAttribute("stroke-width", (4.5 * u).toFixed(2));
      }
    },
    zoomable(canIn, canOut) {
      if (canIn === canZoom.in && canOut === canZoom.out) return;
      canZoom = { in: canIn, out: canOut };
      for (const b of zooms) {
        const off = (b.action === "in" && !canIn) || (b.action === "out" && !canOut);
        b.el.style.opacity = off ? "0.35" : "1";
      }
    },
    targets() {
      const centre = (box: Box) => ({ x: (box.x + box.w / 2) * u, y: (box.y + box.h / 2) * u });
      return [
        ...modes.map((b) => ({ kind: "mode" as const, id: b.mode, ...centre(b.box) })),
        ...lines.map((b) => ({ kind: "line" as const, id: b.line.id, ...centre(b.box) })),
        ...zooms.map((b) => ({ kind: "zoom" as const, id: b.action, ...centre(b.box) })),
      ];
    },
    dispose() {
      for (const t of timers) clearTimeout(t);
      timers.clear();
      layer.remove();
    },
  };
};
