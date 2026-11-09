import type { Rect } from "../types";
import { iconElement, isIconName } from "./icons";
import { PALETTE, withAlpha } from "./palette";
import { ensureStyles, FONT } from "./style";

export interface ButtonOptions {
  label?: string;
  /** An icon name from the set, raw `<svg>` markup, or a short glyph. */
  icon?: string;
  rect: Rect;
  /** Press length in ms before `onPress` fires, shown as a filling ring. Unset fires on touch. */
  hold?: number;
  color?: string;
  /** "solid" fills with the colour behind a dark icon; "ghost" is a dark disc with a coloured icon. */
  look?: "solid" | "ghost";
  /** Ignore presses for this many ms after creation, so a finger already down can't fire it. */
  armDelay?: number;
  onPress(): void;
}

export interface ButtonHandle {
  readonly el: HTMLElement;
  dispose(): void;
}

/** How far (as a fraction of the button's short side) a held finger may slide off it. */
const HOLD_SLOP = 0.35;

const roundRectPerimeter = (w: number, h: number, r: number) =>
  2 * (w - 2 * r) + 2 * (h - 2 * r) + 2 * Math.PI * r;

/**
 * A large touch button. It swallows the press so the app's input listeners never see it.
 * `unit` is CSS px per venue px.
 */
export const createButton = (opts: ButtonOptions, unit: number): ButtonHandle => {
  ensureStyles();
  const { rect } = opts;
  const color = opts.color ?? PALETTE.accent;
  const ghost = opts.look === "ghost";
  const short = Math.max(1, Math.min(rect.width, rect.height));
  const hold = Math.max(0, opts.hold ?? 0);
  const armedAt = performance.now() + (opts.armDelay ?? 0);

  const el = document.createElement("div");
  el.className = "hc-button";
  el.setAttribute("role", "button");
  if (opts.label) el.setAttribute("aria-label", opts.label);
  const fontSize = Math.max(10, Math.min(short * 0.42, 64 * unit));
  el.style.cssText =
    `position:absolute;left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;` +
    `height:${rect.height}px;border-radius:${short / 2}px;box-sizing:border-box;` +
    "display:flex;align-items:center;justify-content:center;pointer-events:auto;" +
    "touch-action:none;user-select:none;-webkit-user-select:none;cursor:pointer;" +
    `gap:${short * 0.12}px;padding:0 ${short * 0.3}px;font:800 ${fontSize}px ${FONT};` +
    "letter-spacing:0.01em;white-space:nowrap;";
  if (ghost) {
    el.style.background = withAlpha(PALETTE.background, 0.72);
    el.style.color = color;
    el.style.border = `${Math.max(2, 5 * unit)}px solid ${withAlpha(color, 0.55)}`;
  } else {
    el.style.background = color;
    el.style.color = PALETTE.background;
    el.style.boxShadow = `0 0 ${Math.round(36 * unit)}px ${withAlpha(color, 0.45)}`;
  }

  if (opts.icon) {
    const iconSize = opts.label ? short * 0.5 : short * 0.56;
    if (isIconName(opts.icon)) {
      el.append(iconElement(opts.icon, iconSize));
    } else if (opts.icon.trimStart().startsWith("<svg")) {
      const wrap = document.createElement("span");
      wrap.style.cssText = `display:inline-flex;width:${iconSize}px;height:${iconSize}px;`;
      wrap.innerHTML = opts.icon;
      el.append(wrap);
    } else {
      const glyph = document.createElement("span");
      glyph.textContent = opts.icon;
      glyph.style.fontSize = `${iconSize}px`;
      el.append(glyph);
    }
  }
  if (opts.label) {
    const text = document.createElement("span");
    text.textContent = opts.label;
    el.append(text);
  }

  let progress: SVGRectElement | null = null;
  let perimeter = 0;
  if (hold > 0) {
    const sw = Math.max(3, short * (ghost ? 0.07 : 0.08));
    const w = rect.width - sw;
    const h = rect.height - sw;
    const r = Math.min(w, h) / 2;
    perimeter = roundRectPerimeter(w, h, r);
    const ringColor = ghost ? color : withAlpha(PALETTE.background, 0.85);
    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
    svg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;";
    const track = document.createElementNS(svgNs, "rect");
    progress = document.createElementNS(svgNs, "rect");
    for (const shape of [track, progress]) {
      shape.setAttribute("x", String(sw / 2));
      shape.setAttribute("y", String(sw / 2));
      shape.setAttribute("width", String(w));
      shape.setAttribute("height", String(h));
      shape.setAttribute("rx", String(r));
      shape.setAttribute("fill", "none");
      shape.setAttribute("stroke-width", String(sw));
      shape.setAttribute("stroke-linecap", "round");
      svg.append(shape);
    }
    track.setAttribute(
      "stroke",
      ghost ? withAlpha(color, 0.18) : withAlpha(PALETTE.background, 0.2),
    );
    progress.setAttribute("stroke", ringColor);
    progress.setAttribute("stroke-dasharray", `${perimeter} ${perimeter}`);
    progress.style.strokeDashoffset = `${perimeter}px`;
    if (ghost) el.style.borderColor = "transparent";
    el.append(svg);
  }

  const active = new Set<number>();
  let timer = 0;
  let disposed = false;

  const fire = () => {
    if (disposed || !el.isConnected) return;
    try {
      opts.onPress();
    } catch (err) {
      console.error("[ui] button handler failed", err);
    }
  };

  const setRing = (filling: boolean) => {
    if (!progress) return;
    progress.style.transition = filling
      ? `stroke-dashoffset ${hold}ms linear`
      : "stroke-dashoffset 0.25s ease-out";
    progress.style.strokeDashoffset = filling ? "0px" : `${perimeter}px`;
  };

  const stopTracking = () => {
    window.removeEventListener("pointerup", onRelease, true);
    window.removeEventListener("pointercancel", onRelease, true);
    window.removeEventListener("pointermove", onMove, true);
    active.clear();
    clearTimeout(timer);
    timer = 0;
    el.classList.remove("hc-pressed");
  };

  const abort = () => {
    stopTracking();
    setRing(false);
  };

  const complete = () => {
    stopTracking();
    setRing(false);
    fire();
  };

  function onRelease(e: PointerEvent) {
    if (!active.delete(e.pointerId)) return;
    if (active.size === 0) abort();
  }

  function onMove(e: PointerEvent) {
    if (!active.has(e.pointerId)) return;
    const r = el.getBoundingClientRect();
    const slop = Math.min(r.width, r.height) * HOLD_SLOP;
    const outside =
      e.clientX < r.left - slop ||
      e.clientX > r.right + slop ||
      e.clientY < r.top - slop ||
      e.clientY > r.bottom + slop;
    if (!outside) return;
    active.delete(e.pointerId);
    if (active.size === 0) abort();
  }

  el.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
    if (disposed || performance.now() < armedAt) return;
    if (hold === 0) {
      el.classList.add("hc-pressed");
      setTimeout(() => el.classList.remove("hc-pressed"), 150);
      fire();
      return;
    }
    active.add(e.pointerId);
    if (active.size > 1) return;
    el.classList.add("hc-pressed");
    window.addEventListener("pointerup", onRelease, true);
    window.addEventListener("pointercancel", onRelease, true);
    window.addEventListener("pointermove", onMove, true);
    setRing(true);
    timer = window.setTimeout(complete, hold);
  });

  return {
    el,
    dispose() {
      if (disposed) return;
      abort();
      disposed = true;
      el.remove();
    },
  };
};
