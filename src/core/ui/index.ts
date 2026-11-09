import type { FrameInfo, Rect, Ui } from "../types";
import { type ButtonOptions, createButton } from "./button";
import { PALETTE, withAlpha } from "./palette";
import { ensureStyles, FONT } from "./style";

export { type ButtonHandle, type ButtonOptions, createButton } from "./button";
export { ICON_NAMES, type IconName, iconElement, iconSvg, isIconName } from "./icons";
export { PALETTE, withAlpha } from "./palette";
export { ensureStyles, FONT } from "./style";

export interface CountdownOptions {
  /** Area to centre the numbers in, in stage px. Defaults to the whole frame. */
  rect?: Rect;
  color?: string;
}

export interface UiHandle extends Ui {
  /** Remove the button's element to discard it. */
  button(opts: ButtonOptions): HTMLElement;
  countdown(seconds: number, opts?: CountdownOptions): Promise<void>;
  dispose(): void;
}

const MAX_TOASTS = 3;

export const createUi = (root: HTMLElement, frame: () => FrameInfo): UiHandle => {
  ensureStyles();
  const layer = document.createElement("div");
  layer.className = "hc-ui";
  layer.style.cssText =
    "position:absolute;inset:0;pointer-events:none;z-index:3;overflow:hidden;" +
    `font-family:${FONT};`;
  root.append(layer);

  const timers = new Set<number>();
  const toasts: HTMLElement[] = [];
  let disposed = false;

  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };

  const ui: UiHandle = {
    palette: PALETTE,

    button(opts) {
      const handle = createButton(opts, frame().unit);
      layer.append(handle.el);
      return handle.el;
    },

    label(text, opts) {
      const unit = frame().unit;
      const el = document.createElement("div");
      el.textContent = text;
      el.style.cssText =
        `position:absolute;left:${opts.x}px;top:${opts.y}px;transform:translate(-50%,-50%);` +
        `white-space:nowrap;font:800 ${Math.max(8, opts.size * unit)}px ${FONT};` +
        `text-shadow:0 0 ${Math.round(10 * unit)}px rgba(0,0,0,0.85);`;
      el.style.color = opts.color ?? PALETTE.foreground;
      layer.append(el);
      return el;
    },

    toast(text, ms = 2500) {
      if (disposed) return;
      const f = frame();
      const unit = f.unit;
      const el = document.createElement("div");
      el.className = "hc-anim-fade-in";
      el.textContent = text;
      el.style.cssText =
        `position:absolute;left:50%;top:${f.height * 0.08}px;transform:translateX(-50%);` +
        `padding:${18 * unit}px ${40 * unit}px;border-radius:${60 * unit}px;` +
        `background:${withAlpha(PALETTE.background, 0.85)};color:${PALETTE.foreground};` +
        `border:${Math.max(1, 3 * unit)}px solid ${withAlpha(PALETTE.foreground, 0.25)};` +
        `font:700 ${Math.max(10, 56 * unit)}px ${FONT};white-space:nowrap;`;
      layer.append(el);
      toasts.push(el);
      while (toasts.length > MAX_TOASTS) toasts.shift()?.remove();
      // Later toasts stack below earlier ones.
      toasts.forEach((t, i) => {
        t.style.top = `${f.height * 0.08 + i * 120 * unit}px`;
      });
      later(() => {
        el.remove();
        const i = toasts.indexOf(el);
        if (i >= 0) toasts.splice(i, 1);
      }, ms);
    },

    countdown(seconds, opts = {}) {
      const steps = Math.max(0, Math.floor(seconds));
      if (steps === 0 || disposed) return Promise.resolve();
      const f = frame();
      const area = opts.rect ?? { x: 0, y: 0, width: f.width, height: f.height };
      const color = opts.color ?? PALETTE.accent;
      const size = Math.max(40, Math.min(area.width * 0.8, area.height * 0.6, 640 * f.unit));
      const box = document.createElement("div");
      box.style.cssText =
        `position:absolute;left:${area.x + (area.width - size) / 2}px;` +
        `top:${area.y + (area.height - size) / 2}px;width:${size}px;height:${size}px;`;
      layer.append(box);

      const digit = (n: number) => {
        const el = document.createElement("div");
        el.className = "hc-anim-pop";
        el.style.cssText =
          "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;" +
          `border-radius:50%;background:${withAlpha(PALETTE.background, 0.88)};` +
          `border:${size * 0.035}px solid ${withAlpha(color, 0.7)};` +
          `box-shadow:0 0 ${size * 0.15}px ${withAlpha(color, 0.35)};` +
          `color:${color};font:900 ${size * 0.62}px ${FONT};line-height:1;` +
          "font-variant-numeric:tabular-nums;";
        el.textContent = String(n);
        return el;
      };

      return new Promise<void>((resolve) => {
        let n = steps;
        const show = () => {
          if (disposed) return;
          if (n === 0) {
            box.remove();
            resolve();
            return;
          }
          box.replaceChildren(digit(n));
          n--;
          later(show, 1000);
        };
        show();
      });
    },

    dispose() {
      disposed = true;
      for (const id of timers) clearTimeout(id);
      timers.clear();
      toasts.length = 0;
      layer.remove();
    },
  };
  return ui;
};
