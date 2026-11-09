import type { Beetle } from "./critters";
import type { Gadget, GadgetKind } from "./gadgets";
import { GLYPHS } from "./swatches";

/**
 * Gadgets and beetles drawn as small DOM sprites over the world. Both pools are made once at
 * their caps, so the node count never changes; unused sprites are hidden.
 */
export interface Sprites {
  update(gadgets: readonly Gadget[], beetles: readonly Beetle[]): void;
  dispose(): void;
}

const STYLE_ID = "tinyworld-sprite-style";
const CSS = `
.pw-sprite { position:absolute; left:0; top:0; pointer-events:none; will-change:transform; }
.pw-spin { animation:pw-spin 0.6s linear infinite; }
.pw-spin.pw-back { animation-direction:reverse; }
@keyframes pw-spin { to { transform:rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .pw-spin { animation:none; } }
`;

const TINT: Record<GadgetKind, string> = {
  geyser: "#8fd3f0",
  fan: "#d8e2ee",
  heater: "#ffad66",
  cooler: "#8cc8ff",
  spout: "#9fd0e8",
};

const BEETLE = `<svg viewBox="0 0 100 64" width="100%" height="100%" style="display:block;overflow:visible">
<g stroke="#262a33" stroke-width="5" stroke-linecap="round" fill="none" class="pw-legs">
<path d="M30 50l-6 12M50 52l0 12M70 50l6 12"/></g>
<path d="M88 30l8-12M84 28l2-14" stroke="#262a33" stroke-width="3" stroke-linecap="round" fill="none"/>
<circle cx="84" cy="40" r="11" fill="#262a33"/>
<path d="M10 52C10 22 30 10 50 10s40 12 40 42z" fill="#c8483c"/>
<path d="M50 11v41" stroke="#3a1712" stroke-width="3"/>
<circle cx="33" cy="30" r="6" fill="#2a1712"/><circle cx="66" cy="28" r="5" fill="#2a1712"/>
<circle cx="40" cy="44" r="5" fill="#2a1712"/><circle cx="61" cy="44" r="5" fill="#2a1712"/>
<path d="M24 22c6-6 14-9 22-9" stroke="#f3b2a8" stroke-width="4" stroke-linecap="round" fill="none" opacity="0.6"/>
</svg>`;

export const createSprites = (
  root: HTMLElement,
  unit: number,
  caps: { gadgets: number; beetles: number },
  sizes: { gadget: number; beetle: number },
): Sprites => {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.append(style);
  }
  const layer = document.createElement("div");
  layer.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:1;overflow:hidden;";
  root.append(layer);
  const gs = sizes.gadget * unit;
  const bs = sizes.beetle * unit;

  const gadgetPool = Array.from({ length: caps.gadgets }, () => {
    const el = document.createElement("div");
    el.className = "pw-sprite";
    el.style.cssText += `width:${gs}px;height:${gs}px;border-radius:50%;display:none;box-sizing:border-box;`;
    const icon = document.createElement("div");
    icon.style.cssText = "position:absolute;inset:18%;";
    el.append(icon);
    layer.append(el);
    return { el, icon, kind: "" as GadgetKind | "", dir: 0 };
  });

  const beetlePool = Array.from({ length: caps.beetles }, () => {
    const el = document.createElement("div");
    el.className = "pw-sprite";
    el.style.cssText += `width:${bs}px;height:${bs * 0.64}px;display:none;filter:drop-shadow(0 ${bs * 0.06}px ${bs * 0.08}px rgba(0,0,0,0.5));`;
    el.innerHTML = BEETLE;
    layer.append(el);
    return { el, legs: el.querySelector<SVGGElement>(".pw-legs") };
  });

  return {
    update(gadgets, beetles) {
      gadgetPool.forEach((slot, i) => {
        const g = gadgets[i];
        if (!g) {
          slot.el.style.display = "none";
          return;
        }
        slot.el.style.display = "";
        if (slot.kind !== g.kind || slot.dir !== g.dir) {
          slot.kind = g.kind;
          slot.dir = g.dir;
          const tint = TINT[g.kind];
          slot.el.style.background = "rgba(12,16,26,0.72)";
          slot.el.style.border = `${Math.max(1, 4 * unit)}px solid ${tint}`;
          slot.el.style.boxShadow = `0 0 ${24 * unit}px ${tint}`;
          slot.icon.style.color = tint;
          slot.icon.innerHTML = `<svg viewBox="0 0 100 100" width="100%" height="100%" style="display:block;overflow:visible">${GLYPHS[g.kind]}</svg>`;
          slot.icon.className = g.kind === "fan" ? `pw-spin${g.dir < 0 ? " pw-back" : ""}` : "";
          slot.icon.style.transform = g.kind === "spout" && g.dir < 0 ? "scaleX(-1)" : "";
        }
        slot.el.style.transform = `translate(${g.x * unit - gs / 2}px,${g.y * unit - gs / 2}px)`;
      });
      beetlePool.forEach((slot, i) => {
        const b = beetles[i];
        if (!b) {
          slot.el.style.display = "none";
          return;
        }
        slot.el.style.display = "";
        slot.el.style.opacity = String(b.alpha);
        const flip = b.dir < 0 ? -1 : 1;
        const tilt = b.state === "leave" ? -14 : b.state === "swim" ? Math.sin(b.phase) * 6 : 0;
        slot.el.style.transform = `translate(${b.x * unit - bs / 2}px,${b.y * unit - bs * 0.62}px) scaleX(${flip}) rotate(${tilt}deg)`;
        if (slot.legs) slot.legs.style.transform = `translateX(${Math.sin(b.phase) * 3}px)`;
      });
    },

    dispose() {
      layer.remove();
    },
  };
};
