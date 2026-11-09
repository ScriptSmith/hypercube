/**
 * The ghost hand: a hand drawn where a bot's or demo's finger is, or resting over the main
 * control between demos, so passers-by see what to do. DOM, no pointer events.
 */
import { withAlpha } from "../../core/ui/palette";
import { FONT } from "../../core/ui/style";
import { COLOR } from "./config";

const HAND_SVG =
  '<svg viewBox="0 0 100 120" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M38 8c-5 0-9 4-9 9v46l-7-8c-4-4-10-4-13 0-3 3-3 8 0 12l22 30c6 9 14 15 26 15h8c15 0 26-12 26-27V52c0-5-4-9-9-9s-8 3-9 7v-3c0-5-4-9-9-9-4 0-7 2-8 5v-2c0-5-4-9-9-9-3 0-5 1-6 3V17c0-5-4-9-9-9z" ' +
  'fill="rgba(242,245,250,0.92)" stroke="rgba(5,7,13,0.85)" stroke-width="4" stroke-linejoin="round"/>' +
  "</svg>";

/** The move in a few words, beside the hand, on the side nearer the card's middle. */
export interface HandVerb {
  text: string;
  side: "left" | "right";
  /** Venue y the words stay above, so they never cover the tabs or Back and Next. */
  floor: number;
}

export interface GhostHand {
  /** Venue px of the fingertip, or null to hide; `rest` bobs it gently. */
  set(
    at: { x: number; y: number } | null,
    rest: boolean,
    pressed: boolean,
    verb?: HandVerb | null,
  ): void;
  resize(unit: number): void;
  dispose(): void;
}

export const createHand = (
  parent: HTMLElement,
  unit: number,
  size = 150,
  /** The verb's type size, venue px. */
  text = 38,
): GhostHand => {
  let u = unit;
  const el = document.createElement("div");
  el.style.cssText =
    "position:absolute;left:0;top:0;pointer-events:none;z-index:5;display:none;" +
    "transition:opacity 0.25s;will-change:transform;";
  const inner = document.createElement("div");
  inner.innerHTML = HAND_SVG;
  el.append(inner);
  const ring = document.createElement("div");
  el.append(ring);
  const words = document.createElement("div");
  el.append(words);
  parent.append(el);
  let last = "";

  const style = () => {
    const s = size * u;
    inner.style.cssText = `width:${s}px;height:${s * 1.2}px;filter:drop-shadow(0 ${4 * u}px ${10 * u}px rgba(0,0,0,0.6));`;
    ring.style.cssText =
      `position:absolute;left:${-s * 0.18}px;top:${-s * 0.18}px;width:${s * 0.36}px;height:${s * 0.36}px;` +
      `border-radius:50%;border:${Math.max(2, 5 * u)}px solid ${withAlpha(COLOR.accent, 0.9)};` +
      "box-sizing:border-box;";
    const t = text * u;
    words.style.cssText =
      `position:absolute;top:${s * 0.82}px;white-space:nowrap;padding:${t * 0.22}px ${t * 0.5}px;` +
      `border-radius:${t}px;background:${withAlpha(COLOR.background, 0.86)};` +
      `border:${Math.max(1, 3 * u)}px solid ${withAlpha(COLOR.accent, 0.8)};` +
      `color:${COLOR.ink};font:800 ${t}px ${FONT};line-height:1.1;display:none;`;
  };
  style();

  return {
    set(at, rest, pressed, verb = null) {
      if (!at) {
        if (last !== "hidden") {
          el.style.display = "none";
          last = "hidden";
        }
        return;
      }
      // The fingertip is the top of the index finger, at about (0.38, 0.07) of the picture.
      const s = size * u;
      const x = at.x * u - s * 0.38;
      const y = at.y * u - s * 0.07 * 1.2;
      const key = `${x.toFixed(1)},${y.toFixed(1)},${rest},${pressed},${verb?.text},${verb?.side},${verb?.floor}`;
      if (key === last) return;
      last = key;
      el.style.display = "block";
      el.style.transform = `translate(${x}px,${y}px)`;
      inner.className = rest ? "hc-anim-bob-down" : "";
      ring.style.display = pressed ? "block" : "none";
      ring.style.transform = `translate(${s * 0.38}px,${s * 0.084}px)`;
      if (verb) {
        if (words.textContent !== verb.text) words.textContent = verb.text;
        words.style.display = "block";
        words.style.left = verb.side === "right" ? `${s * 0.92}px` : "";
        words.style.right = verb.side === "left" ? `${s * 0.98}px` : "";
        // Level with the palm, or higher where the palm is near the card's foot.
        const t = text * u;
        words.style.top = `${Math.min(s * 0.82, verb.floor * u - y - t * 1.7)}px`;
      } else words.style.display = "none";
    },
    resize(nu) {
      u = nu;
      last = "";
      style();
    },
    dispose() {
      el.remove();
    },
  };
};
