/**
 * Big numerals over the canvas: the countdown (5 to 1), placings and the seconds to the next
 * race, plus a few short labels. DOM text stays crisp at any size and costs nothing while it
 * doesn't change, so each one is only touched when its value does.
 */
import { FONT, withAlpha } from "../../core/ui";

export interface NumeralSpot {
  /** Centre and size in stage px. */
  x: number;
  y: number;
  size: number;
}

export interface Numeral {
  /** Show `text` (null hides it). `pop` replays the entrance even if the text is the same. */
  set(text: string | null, color: string, alpha?: number, pop?: boolean): void;
  move(spot: NumeralSpot): void;
  dispose(): void;
}

/** Placing colours: gold, silver and bronze, then plain. */
export const PLACE_COLORS = ["#ffcc33", "#dfe6f0", "#e89a5b"] as const;

export const placeColor = (place: number, fallback: string): string =>
  PLACE_COLORS[place - 1] ?? fallback;

/** `count` pops in, `place` is revealed, `plain` just changes (seconds ticking down). */
export type NumeralKind = "count" | "place" | "plain";

export const createNumeral = (
  layer: HTMLElement,
  spot: NumeralSpot,
  kind: NumeralKind,
): Numeral => {
  // The outer element carries position and opacity; the inner one the entrance animation,
  // whose fill would otherwise override the opacity.
  let el: HTMLElement | null = null;
  let inner: HTMLElement | null = null;
  let text = "";
  let key = "";
  let at = spot;
  const place = (e: HTMLElement) => {
    e.style.left = `${at.x}px`;
    e.style.top = `${at.y}px`;
    // Two digits are about twice as wide as one, so they shrink to stay inside the lane.
    e.style.fontSize = `${Math.max(8, at.size * (text.length > 1 ? 0.7 : 1))}px`;
  };
  return {
    set(next, color, alpha = 1, pop = false) {
      if (next === null) {
        el?.remove();
        el = null;
        inner = null;
        text = "";
        key = "";
        return;
      }
      const nextKey = `${next}|${color}|${alpha}`;
      if (el && nextKey === key && !pop) return;
      if (!el) {
        el = document.createElement("div");
        el.style.cssText =
          "position:absolute;transform:translate(-50%,-50%);pointer-events:none;line-height:1;" +
          `font-family:${FONT};font-weight:900;white-space:nowrap;font-variant-numeric:tabular-nums;`;
        layer.append(el);
      }
      if (!inner || ((next !== text || pop) && kind !== "plain")) {
        inner?.remove();
        inner = document.createElement("div");
        if (kind !== "plain") {
          inner.className = kind === "count" ? "hc-anim-pop" : "hc-anim-reveal";
          inner.style.animationDuration = kind === "count" ? "1s" : "0.6s";
        }
        el.append(inner);
      }
      text = next;
      place(el);
      inner.textContent = next;
      el.style.color = color;
      el.style.opacity = String(alpha);
      el.style.textShadow =
        `0 0 ${Math.round(at.size * 0.12)}px ${withAlpha(color, 0.75)},` +
        `0 ${Math.round(at.size * 0.04)}px ${Math.round(at.size * 0.08)}px rgba(0,0,0,0.85)`;
      key = nextKey;
    },
    move(next) {
      at = next;
      if (el) place(el);
    },
    dispose() {
      el?.remove();
      el = null;
      inner = null;
    },
  };
};

export interface Label {
  set(text: string | null, color: string, alpha?: number): void;
  move(spot: NumeralSpot): void;
  dispose(): void;
}

/** A line of text centred on `spot`, `size` px tall. */
export const createLabel = (layer: HTMLElement, spot: NumeralSpot): Label => {
  let el: HTMLElement | null = null;
  let key = "";
  let at = spot;
  const place = (e: HTMLElement) => {
    e.style.left = `${at.x}px`;
    e.style.top = `${at.y}px`;
    e.style.fontSize = `${Math.max(8, at.size)}px`;
  };
  return {
    set(text, color, alpha = 1) {
      if (text === null) {
        el?.remove();
        el = null;
        key = "";
        return;
      }
      const next = `${text}|${color}|${alpha}`;
      if (el && next === key) return;
      if (!el) {
        el = document.createElement("div");
        el.style.cssText =
          "position:absolute;transform:translate(-50%,-50%);pointer-events:none;line-height:1;" +
          `font-family:${FONT};font-weight:800;white-space:nowrap;`;
        layer.append(el);
      }
      place(el);
      el.textContent = text;
      el.style.color = color;
      el.style.opacity = String(alpha);
      el.style.textShadow = `0 ${Math.round(at.size * 0.06)}px ${Math.round(at.size * 0.2)}px rgba(0,0,0,0.9)`;
      key = next;
    },
    move(next) {
      at = next;
      if (el) place(el);
    },
    dispose() {
      el?.remove();
      el = null;
    },
  };
};
