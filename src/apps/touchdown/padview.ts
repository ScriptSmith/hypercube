/**
 * The engine pads' DOM: one rounded panel per pad with an icon of what it does, a fuel strip
 * along its bottom and a glow while its engine fires. None of it takes pointer events; the app
 * hit-tests touches itself, so bots and fingers go through the same path. Elements change only
 * when what they show changes.
 */
import { iconSvg } from "../../core/ui";
import type { Layout, PadRole, PadSpec } from "./layout";

export interface PadLook {
  /** A finger (person or bot) is on it. */
  held: boolean;
  /** Its engine is firing, whoever fires it. */
  firing: boolean;
  /** Nobody is using it: pulse to invite a touch. */
  invite: boolean;
  /** The helper is flying this pad. */
  helper: boolean;
  /** Fuel left, 0 to 1, or null with no fuel gauge. */
  fuel: number | null;
  /** Out of fuel (or time): engines only sputter. */
  empty: boolean;
}

export interface PadView {
  update(looks: readonly PadLook[]): void;
  dispose(): void;
}

const STYLE_ID = "td-pad-styles";
const CSS = `
.td-layer{position:absolute;inset:0;pointer-events:none;z-index:2;overflow:hidden}
.td-layer *{pointer-events:none}
.td-pad{position:absolute;box-sizing:border-box;background:rgba(8,10,26,0.66);
  transition:transform 0.1s ease-out, background-color 0.15s, opacity 0.3s}
.td-pad.td-held{transform:scale(0.965);background:rgba(30,26,60,0.82)}
.td-glow{position:absolute;inset:0;border-radius:inherit;opacity:0;transition:opacity 0.08s}
.td-pad.td-fire .td-glow{opacity:1}
.td-flame{transform-box:fill-box;transform-origin:50% 0%;opacity:0.45;transition:opacity 0.1s}
.td-pad.td-fire .td-flame{opacity:1;animation:td-flicker 0.18s ease-in-out infinite alternate}
@keyframes td-flicker{from{transform:scale(1,1.15)}to{transform:scale(0.92,1.45)}}
.td-ring{position:absolute;inset:0;border-radius:inherit;box-sizing:border-box;opacity:0.55}
.td-pad.td-invite .td-ring{animation:td-pulse 1.7s ease-in-out infinite}
.td-pad.td-helper .td-ring{border-style:dashed !important;opacity:0.4}
.td-icon{position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);transition:opacity 0.3s}
.td-pad.td-empty .td-icon{opacity:0.35}
.td-hand{position:absolute;opacity:0;transition:opacity 0.4s}
.td-pad.td-helper .td-hand{opacity:0.45}
.td-fuel{position:absolute;left:10%;right:10%;border-radius:999px;background:rgba(255,255,255,0.12);overflow:hidden}
.td-fuel>div{position:absolute;left:0;top:0;bottom:0;border-radius:999px;transition:width 0.25s linear, background-color 0.3s}
@keyframes td-pulse{0%,100%{opacity:0.35;transform:scale(1)}50%{opacity:1;transform:scale(1.025)}}
`;

const ensureCss = (doc: Document) => {
  if (doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement("style");
  el.id = STYLE_ID;
  el.textContent = CSS;
  doc.head.append(el);
};

/** An arc most of the way round the icon with its head showing the way it turns. */
const turnArrow = (clockwise: boolean): string => {
  const r = 34;
  const deg = Math.PI / 180;
  // Screen angles, clockwise from +x. Clockwise runs from lower left over the top to lower right.
  const from = (clockwise ? 125 : 55) * deg;
  const to = (clockwise ? 415 : -235) * deg;
  const at = (a: number) => [50 + r * Math.cos(a), 50 + r * Math.sin(a)] as const;
  const [x0, y0] = at(from);
  const [x1, y1] = at(to);
  const s = clockwise ? 1 : -1;
  const dx = -Math.sin(to) * s;
  const dy = Math.cos(to) * s;
  const tip = [x1 + dx * 12, y1 + dy * 12];
  const b1 = [x1 - dx * 3 - dy * 10, y1 - dy * 3 + dx * 10];
  const b2 = [x1 - dx * 3 + dy * 10, y1 - dy * 3 - dx * 10];
  const f = (v: number) => v.toFixed(1);
  return (
    `<path d="M${f(x0)} ${f(y0)} A${r} ${r} 0 1 ${clockwise ? 1 : 0} ${f(x1)} ${f(y1)}" fill="none" stroke="#ffcc33" stroke-width="7" stroke-linecap="round"/>` +
    `<path d="M${f(tip[0]!)} ${f(tip[1]!)} L${f(b1[0]!)} ${f(b1[1]!)} L${f(b2[0]!)} ${f(b2[1]!)} Z" fill="#ffcc33"/>`
  );
};

/** A small craft with the pad's engine lit, or a turning arrow around it. */
export const padIcon = (role: PadRole, color: string): string => {
  const flame = (x: number, w: number, h: number) =>
    `<g class="td-flame"><path d="M${x - w} 66 Q${x - w * 1.2} ${66 + h * 0.45} ${x} ${66 + h} Q${x + w * 1.2} ${66 + h * 0.45} ${x + w} 66 Z" fill="#ff9a3c"/>` +
    `<path d="M${x - w * 0.5} 66 Q${x - w * 0.6} ${66 + h * 0.3} ${x} ${66 + h * 0.55} Q${x + w * 0.6} ${66 + h * 0.3} ${x + w * 0.5} 66 Z" fill="#fff2b0"/></g>`;
  const bell = (x: number, lit: boolean) =>
    `<path d="M${x - 4} 56 L${x + 4} 56 L${x + 7} 66 L${x - 7} 66 Z" fill="${lit ? "#ffd27a" : "#68728c"}" stroke="#0b0f1e" stroke-width="1.5"/>`;
  const body =
    `<path d="M38 45 L28 70 M62 45 L72 70" stroke="#b9c3d8" stroke-width="4" stroke-linecap="round"/>` +
    `<rect x="31" y="40" width="38" height="15" rx="5" fill="${color}" stroke="#0b0f1e" stroke-width="2"/>` +
    `<path d="M33 41 A17 17 0 0 1 67 41 Z" fill="#eef2fa" stroke="#0b0f1e" stroke-width="2"/>` +
    `<circle cx="50" cy="35" r="6.5" fill="#1d2b4d" stroke="#c9d6ee" stroke-width="2"/>`;
  let parts: string;
  if (role === "left" || role === "right") {
    const lit = role === "left" ? 36 : 64;
    const other = role === "left" ? 64 : 36;
    // The lit engine's flame leans outward, as on the craft.
    parts = `${bell(other, false)}${bell(lit, true)}${flame(lit, 6, 26)}${body}`;
  } else if (role === "main") {
    parts = `${bell(50, true)}${flame(50, 8, 30)}${body}`;
  } else {
    const ccw = role === "turnLeft";
    parts = `<g transform="translate(50 50) rotate(${ccw ? -18 : 18}) translate(-50 -50)">${bell(50, false)}${body}</g>${turnArrow(!ccw)}`;
  }
  return `<svg viewBox="0 0 100 100" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">${parts}</svg>`;
};

interface Parts {
  el: HTMLElement;
  fill: HTMLElement | null;
  last: PadLook;
}

export const createPadView = (
  host: HTMLElement,
  layout: Layout,
  unit: number,
  colorOf: (crew: number) => string,
): PadView => {
  ensureCss(host.ownerDocument);
  const layer = document.createElement("div");
  layer.className = "td-layer";
  host.append(layer);
  const px = (v: number) => `${(v * unit).toFixed(2)}px`;
  const pads: PadSpec[] = layout.crews.flatMap((c) => c.pads);

  const parts: Parts[] = pads.map((p) => {
    const r = p.rect;
    const color = colorOf(p.crew);
    const short = Math.min(r.width, r.height);
    const el = document.createElement("div");
    el.className = "td-pad";
    el.dataset.role = p.role;
    el.style.left = px(r.x);
    el.style.top = px(r.y);
    el.style.width = px(r.width);
    el.style.height = px(r.height);
    el.style.borderRadius = px(short * 0.16);
    const glow = document.createElement("div");
    glow.className = "td-glow";
    glow.style.background = `radial-gradient(ellipse at 50% 70%, rgba(255,160,60,0.55), rgba(255,120,40,0.12) 55%, transparent 75%)`;
    const ring = document.createElement("div");
    ring.className = "td-ring";
    ring.style.border = `${px(9)} solid ${color}`;
    const icon = document.createElement("div");
    icon.className = "td-icon";
    icon.style.width = px(short * 0.72);
    icon.style.height = px(short * 0.72);
    icon.innerHTML = padIcon(p.role, color);
    const hand = document.createElement("div");
    hand.className = "td-hand";
    hand.style.right = px(short * 0.07);
    hand.style.top = px(short * 0.07);
    hand.style.width = px(short * 0.22);
    hand.style.height = px(short * 0.22);
    hand.style.color = "#e8eeff";
    hand.innerHTML = iconSvg("hand");
    const fuel = document.createElement("div");
    fuel.className = "td-fuel";
    fuel.style.bottom = px(short * 0.07);
    fuel.style.height = px(Math.max(14, short * 0.05));
    const fill = document.createElement("div");
    fill.style.width = "100%";
    fill.style.background = color;
    fuel.append(fill);
    el.append(glow, ring, icon, hand, fuel);
    layer.append(el);
    return {
      el,
      fill,
      last: { held: false, firing: false, invite: false, helper: false, fuel: 1, empty: false },
    };
  });

  return {
    update(looks) {
      looks.forEach((look, i) => {
        const p = parts[i];
        if (!p) return;
        const L = p.last;
        if (look.held !== L.held) p.el.classList.toggle("td-held", look.held);
        if (look.firing !== L.firing) p.el.classList.toggle("td-fire", look.firing);
        if (look.invite !== L.invite) p.el.classList.toggle("td-invite", look.invite);
        if (look.helper !== L.helper) p.el.classList.toggle("td-helper", look.helper);
        if (look.empty !== L.empty) p.el.classList.toggle("td-empty", look.empty);
        if (look.fuel !== L.fuel && p.fill) {
          const bar = p.fill.parentElement;
          if (look.fuel === null) {
            if (bar) bar.style.display = "none";
          } else {
            if (bar) bar.style.display = "";
            const pct = Math.round(look.fuel * 100);
            if (L.fuel === null || Math.round(L.fuel * 100) !== pct) p.fill.style.width = `${pct}%`;
            const low = look.fuel < 0.2;
            if (L.fuel === null || low !== L.fuel < 0.2) {
              p.fill.style.background = low ? "#ff5a4f" : colorOf(pads[i]!.crew);
            }
          }
        }
        p.last = { ...look };
      });
    },
    dispose() {
      layer.remove();
    },
  };
};
