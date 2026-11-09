/**
 * The card a tapped vehicle shows for a few seconds: its mode, route number and (when the day's
 * static data has loaded) where it is going. It sits beside the vehicle and follows it, joined to
 * it by a short line.
 */
import { withAlpha } from "../../core/ui/palette";
import { FONT } from "../../core/ui/style";
import { modeIcon } from "./icons";
import { MODE_COLOR, type Mode } from "./routes";

export const CARD_MS = 7000;
const GAP = 46;
const MARGIN = 16;

export interface CardInfo {
  key: number;
  mode: Mode;
  title: string;
  subtitle: string | null;
}

export interface Card {
  show(info: CardInfo, now: number): void;
  hide(): void;
  /** Follow the vehicle at stage px `at` (null hides it); keep inside the stage below `top`. */
  update(now: number, at: { x: number; y: number } | null, w: number, h: number, top: number): void;
  readonly key: number | null;
  readonly info: CardInfo | null;
  dispose(): void;
}

export const createCard = (root: HTMLElement, unit: number, scale: number): Card => {
  const s = unit * scale;
  const px = (v: number) => `${(v * s).toFixed(2)}px`;
  const el = document.createElement("div");
  el.style.cssText =
    `position:absolute;left:0;top:0;display:none;flex-direction:column;gap:${px(4)};` +
    `padding:${px(14)} ${px(22)} ${px(16)} ${px(16)};border-radius:${px(22)};` +
    `background:${withAlpha("#080c16", 0.94)};pointer-events:none;z-index:2;` +
    `max-width:${px(560)};box-sizing:border-box;opacity:0;transition:opacity 0.3s;`;
  const row = document.createElement("div");
  row.style.cssText = `display:flex;align-items:center;gap:${px(14)};`;
  const icon = document.createElement("div");
  icon.style.cssText = `width:${px(70)};height:${px(70)};flex:none;`;
  const title = document.createElement("div");
  title.style.cssText = `font:800 ${px(58)} ${FONT};color:#f2f5fa;line-height:1;white-space:nowrap;`;
  row.append(icon, title);
  const sub = document.createElement("div");
  sub.style.cssText =
    `font:600 ${px(30)} ${FONT};color:#c9d3ea;white-space:nowrap;overflow:hidden;` +
    `text-overflow:ellipsis;padding-left:${px(4)};`;
  el.append(row, sub);
  const link = document.createElement("div");
  link.style.cssText = `position:absolute;left:0;top:0;height:${px(4)};transform-origin:0 50%;pointer-events:none;z-index:2;display:none;border-radius:${px(2)};`;
  root.append(link, el);

  let info: CardInfo | null = null;
  let until = 0;

  const hide = () => {
    info = null;
    el.style.opacity = "0";
    el.style.display = "none";
    link.style.display = "none";
  };

  return {
    show(next, now) {
      info = next;
      until = now + CARD_MS;
      const color = MODE_COLOR[next.mode];
      el.style.border = `${px(4)} solid ${color}`;
      el.style.boxShadow = `0 0 ${px(40)} ${withAlpha(color, 0.35)}`;
      icon.style.color = color;
      icon.innerHTML = modeIcon(next.mode);
      title.textContent = next.title;
      sub.textContent = next.subtitle ?? "";
      sub.style.display = next.subtitle ? "block" : "none";
      link.style.background = color;
      el.style.display = "flex";
      link.style.display = "block";
      // Next frame, so the fade runs.
      requestAnimationFrame(() => {
        if (info === next) el.style.opacity = "1";
      });
    },
    hide,
    update(now, at, w, h, top) {
      if (!info) return;
      if (now >= until || !at) {
        hide();
        return;
      }
      const cw = el.offsetWidth;
      const ch = el.offsetHeight;
      const gap = GAP * s;
      const m = MARGIN * s;
      let x = at.x + gap;
      if (x + cw > w - m) x = at.x - gap - cw;
      x = Math.max(m, Math.min(w - m - cw, x));
      const y = Math.max(top + m, Math.min(h - m - ch, at.y - ch / 2 - gap * 0.6));
      el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
      // The joining line, from the vehicle to the card's nearer side.
      const ex = x > at.x ? x : x + cw;
      const ey = Math.max(y + ch * 0.2, Math.min(y + ch * 0.8, at.y));
      const dx = ex - at.x;
      const dy = ey - at.y;
      const len = Math.hypot(dx, dy);
      link.style.width = `${Math.max(0, len - 14 * s).toFixed(1)}px`;
      const ux = len > 0 ? dx / len : 1;
      const uy = len > 0 ? dy / len : 0;
      link.style.transform = `translate(${(at.x + ux * 14 * s).toFixed(1)}px,${(at.y + uy * 14 * s - 2 * s).toFixed(1)}px) rotate(${Math.atan2(dy, dx)}rad)`;
    },
    get key() {
      return info?.key ?? null;
    },
    get info() {
      return info;
    },
    dispose() {
      el.remove();
      link.remove();
    },
  };
};
