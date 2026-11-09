/**
 * Ghost hands: a pale hand pressing wherever the attract (or a bot) is pouring, so someone walking
 * up to an idle frame sees that a finger pours the ink, without any words.
 */
import { iconElement } from "../../core/ui";

export const MAX_GHOSTS = 8;

export interface Ghosts {
  /** Fingertip positions in venue px; anything past MAX_GHOSTS is left out. */
  show(points: readonly { x: number; y: number }[], unit: number): void;
  dispose(): void;
}

export const createGhosts = (root: HTMLElement, size: number): Ghosts => {
  const layer = document.createElement("div");
  layer.className = "kl-ghosts";
  layer.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;";
  root.append(layer);
  const hands = Array.from({ length: MAX_GHOSTS }, () => {
    const el = iconElement("hand", "100%", "rgba(235,245,250,0.8)");
    el.style.cssText +=
      "position:absolute;left:0;top:0;opacity:0;transition:opacity 0.5s ease;will-change:transform;";
    el.style.filter = "drop-shadow(0 0 0.12em rgba(150,210,255,0.7))";
    layer.append(el);
    return el;
  });
  return {
    show(points, unit) {
      const s = size * unit;
      hands.forEach((el, i) => {
        const p = points[i];
        if (!p) {
          el.style.opacity = "0";
          return;
        }
        el.style.width = `${s.toFixed(1)}px`;
        el.style.height = `${s.toFixed(1)}px`;
        el.style.fontSize = `${(s * 0.5).toFixed(1)}px`;
        // The icon's index fingertip is at (0.41, 0.03) of its box.
        el.style.transform = `translate(${(p.x * unit - 0.41 * s).toFixed(1)}px,${(p.y * unit - 0.03 * s).toFixed(1)}px)`;
        el.style.opacity = "0.85";
      });
    },
    dispose() {
      layer.remove();
    },
  };
};
