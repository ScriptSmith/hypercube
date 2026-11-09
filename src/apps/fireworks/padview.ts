/**
 * The launch pads' DOM: tubes, recipe buttons and aim handles as plain elements with inline SVG.
 * None of it takes pointer events; the controller hit-tests touches itself, so bots and fingers
 * go through the same path. Elements change only when what they show changes.
 */
import { COLORS, MIXED, type Recipe } from "./recipe";
import { colorIcon, shapeIcon, sizeIcon, tubeSvg, upArrow } from "./icons";
import { aimKnob, type Circle, type PadLayout } from "./pads";

export interface PadLook {
  recipe: Recipe;
  angle: number;
  /** Can launch now. */
  ready: boolean;
  /** Nobody has used this pad for a while: pulse and point up. */
  attract: boolean;
  /** Ms timestamps (performance.now) of the last launch and the last refused one. */
  launchedAt: number;
  refusedAt: number;
  /** While a flick drag is held: its size 0..1. */
  charge: number | null;
  /** The pad's own colour (flick shells and the tube bands). */
  padColor: number;
}

export interface PadView {
  update(looks: readonly PadLook[]): void;
  /** A recipe button was pressed: a short pop. */
  pop(pad: number, which: "color" | "shape" | "size"): void;
  dispose(): void;
}

const STYLE_ID = "fw-pad-styles";
const CSS = `
.fw-layer{position:absolute;inset:0;pointer-events:none;z-index:2;overflow:hidden}
.fw-layer *{pointer-events:none}
.fw-btn{position:absolute;border-radius:50%;box-sizing:border-box;background:rgba(8,11,22,0.72);
  transition:transform 0.18s ease-out, box-shadow 0.25s ease-out}
.fw-btn.fw-pop{transform:scale(1.12)}
.fw-icon{position:absolute;inset:12%}
.fw-tube{position:absolute;transform-origin:50% 100%;transition:transform 0.12s ease-out, filter 0.3s}
.fw-tube.fw-wait{filter:brightness(0.55) saturate(0.6)}
.fw-tube.fw-shake{animation:fw-shake 0.32s ease-in-out}
.fw-mouth{position:absolute;border-radius:50%;opacity:0;transition:opacity 0.3s}
.fw-mouth.fw-on{animation:fw-pulse 1.6s ease-in-out infinite}
.fw-mouth.fw-fire{animation:fw-fire 0.5s ease-out}
.fw-arrow{position:absolute;opacity:0;transition:opacity 0.4s}
.fw-zone{position:absolute;box-sizing:border-box;border-radius:6%/4%;
  background:linear-gradient(0deg,rgba(120,140,200,0.10),rgba(120,140,200,0.02))}
.fw-chev{position:absolute;opacity:0.22}
.fw-zone.fw-on .fw-chev{animation:fw-chev 1.5s ease-in-out infinite}
@keyframes fw-chev{0%{opacity:0.1;transform:translateY(25%)}50%{opacity:0.6}100%{opacity:0.1;transform:translateY(-25%)}}
.fw-arrow.fw-on{opacity:1;animation:fw-rise 1.6s ease-in-out infinite}
@keyframes fw-pulse{0%,100%{opacity:0.25}50%{opacity:0.95}}
@keyframes fw-fire{0%{opacity:0.2;transform:scale(0.6)}30%{opacity:1;transform:scale(1.25)}100%{opacity:0;transform:scale(1.6)}}
@keyframes fw-rise{0%{transform:translateY(20%);opacity:0}35%{opacity:1}100%{transform:translateY(-35%);opacity:0}}
@keyframes fw-shake{0%,100%{translate:0 0}25%{translate:-4% 0}75%{translate:4% 0}}
`;

const ensureCss = (doc: Document) => {
  if (doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement("style");
  el.id = STYLE_ID;
  el.textContent = CSS;
  doc.head.append(el);
};

const hexOf = (c: number) => (c >= MIXED ? "#ffffff" : (COLORS[c]?.hex ?? "#ffffff"));

interface Parts {
  tube: HTMLElement;
  mouth: HTMLElement;
  arrow: HTMLElement;
  color: HTMLElement | null;
  shape: HTMLElement | null;
  size: HTMLElement | null;
  knob: SVGCircleElement | null;
  zone: HTMLElement | null;
  uid: string;
  last: {
    color: number;
    shape: number;
    size: number;
    angle: number;
    ready: boolean;
    attract: boolean;
    refusedAt: number;
    launchedAt: number;
    charge: number | null;
  };
}

export const createPadView = (
  host: HTMLElement,
  pads: readonly PadLayout[],
  unit: number,
): PadView => {
  ensureCss(host.ownerDocument);
  const layer = document.createElement("div");
  layer.className = "fw-layer";
  host.append(layer);
  const px = (v: number) => `${(v * unit).toFixed(2)}px`;
  const uid = `fw${Math.random().toString(36).slice(2, 8)}`;

  const button = (c: Circle | null, ring: string): HTMLElement | null => {
    if (!c) return null;
    const el = document.createElement("div");
    el.className = "fw-btn";
    el.style.left = px(c.x - c.r);
    el.style.top = px(c.y - c.r);
    el.style.width = px(2 * c.r);
    el.style.height = px(2 * c.r);
    el.style.border = `${Math.max(2, 6 * unit)}px solid ${ring}`;
    const icon = document.createElement("div");
    icon.className = "fw-icon";
    el.append(icon);
    layer.append(el);
    return el;
  };

  const parts: Parts[] = pads.map((p, i) => {
    const t = p.tube;
    let knob: SVGCircleElement | null = null;
    if (p.aim) {
      const a = p.aim;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const left = a.cx - a.r * Math.sin(a.max) - a.band;
      const top = a.cy - a.r - a.band;
      const w = 2 * (a.r * Math.sin(a.max) + a.band);
      const h = a.r - a.r * Math.cos(a.max) + 2 * a.band;
      svg.setAttribute("viewBox", `${left} ${top} ${w} ${h}`);
      svg.style.cssText = `position:absolute;left:${px(left)};top:${px(top)};width:${px(w)};height:${px(h)};overflow:visible`;
      const k0 = aimKnob(a, -a.max);
      const k1 = aimKnob(a, a.max);
      const track = document.createElementNS(svg.namespaceURI, "path");
      track.setAttribute("d", `M${k0.x} ${k0.y} A${a.r} ${a.r} 0 0 1 ${k1.x} ${k1.y}`);
      track.setAttribute("fill", "none");
      track.setAttribute("stroke", "rgba(170,185,220,0.2)");
      track.setAttribute("stroke-width", String(a.band * 0.34));
      track.setAttribute("stroke-linecap", "round");
      const mid = document.createElementNS(svg.namespaceURI, "path");
      mid.setAttribute("d", `M${k0.x} ${k0.y} A${a.r} ${a.r} 0 0 1 ${k1.x} ${k1.y}`);
      mid.setAttribute("fill", "none");
      mid.setAttribute("stroke", "rgba(220,230,255,0.35)");
      mid.setAttribute("stroke-width", String(a.band * 0.08));
      mid.setAttribute("stroke-dasharray", `${a.band * 0.02} ${a.band * 0.3}`);
      mid.setAttribute("stroke-linecap", "round");
      knob = document.createElementNS(svg.namespaceURI, "circle") as SVGCircleElement;
      knob.setAttribute("r", String(a.band * 0.56));
      knob.setAttribute("fill", "rgba(10,14,28,0.85)");
      knob.setAttribute("stroke", "#e8eeff");
      knob.setAttribute("stroke-width", String(a.band * 0.12));
      svg.append(track, mid, knob);
      layer.append(svg);
      const at = aimKnob(a, 0);
      knob.setAttribute("cx", String(at.x));
      knob.setAttribute("cy", String(at.y));
    }
    let zone: HTMLElement | null = null;
    if (p.flick) {
      // Flick: where to drag from, and which way.
      zone = document.createElement("div");
      zone.className = "fw-zone";
      const zx = p.x0 + 30;
      const zy = p.flick.y;
      zone.style.left = px(zx);
      zone.style.top = px(zy);
      zone.style.width = px(p.x1 - p.x0 - 60);
      zone.style.height = px(t.base + 20 - zy);
      zone.style.border = `${Math.max(1, 4 * unit)}px dashed rgba(170,185,230,0.28)`;
      const cw = Math.min(200, (p.x1 - p.x0) * 0.25);
      for (let k = 0; k < 3; k++) {
        const chev = document.createElement("div");
        chev.className = "fw-chev";
        chev.style.left = px(t.x - zx - cw / 2);
        chev.style.top = px(t.base - t.length - zy - 90 - (k + 1) * cw * 0.62);
        chev.style.width = px(cw);
        chev.style.height = px(cw);
        chev.style.animationDelay = `${(2 - k) * 0.18}s`;
        chev.innerHTML = upArrow("#dfe6ff");
        zone.append(chev);
      }
      layer.append(zone);
    }
    const tube = document.createElement("div");
    tube.className = "fw-tube";
    tube.style.left = px(t.x - t.width / 2);
    tube.style.top = px(t.base - t.length);
    tube.style.width = px(t.width);
    tube.style.height = px(t.length);
    const mouth = document.createElement("div");
    mouth.className = "fw-mouth";
    const mw = t.width * 2.2;
    mouth.style.left = px(-(mw - t.width) / 2);
    mouth.style.top = px(-mw / 2);
    mouth.style.width = px(mw);
    mouth.style.height = px(mw);
    tube.append(mouth);
    const arrow = document.createElement("div");
    arrow.className = "fw-arrow";
    const aw = t.width * 1.6;
    arrow.style.left = px(t.x - aw / 2);
    arrow.style.top = px(t.base - t.length - aw * 1.25);
    arrow.style.width = px(aw);
    arrow.style.height = px(aw);
    arrow.innerHTML = upArrow("#ffffff");
    layer.append(tube, arrow);
    return {
      tube,
      mouth,
      arrow,
      color: button(p.color, "rgba(230,236,255,0.55)"),
      shape: button(p.shape, "rgba(230,236,255,0.55)"),
      size: button(p.size, "rgba(230,236,255,0.55)"),
      knob,
      zone,
      uid: `${uid}-${i}`,
      last: {
        color: -1,
        shape: -1,
        size: -1,
        angle: Number.NaN,
        ready: false,
        attract: false,
        refusedAt: 0,
        launchedAt: 0,
        charge: null,
      },
    };
  });

  const icon = (el: HTMLElement | null, html: string) => {
    const box = el?.firstElementChild as HTMLElement | null;
    if (box) box.innerHTML = html;
  };

  const pops = new Map<HTMLElement, number>();

  return {
    update(looks) {
      looks.forEach((look, i) => {
        const p = parts[i];
        const layout = pads[i];
        if (!p || !layout) return;
        const L = p.last;
        const r = look.recipe;
        const tint = hexOf(r.color);
        if (r.color !== L.color) {
          icon(p.color, colorIcon(r.color));
          p.tube.innerHTML = tubeSvg(tint, p.uid);
          p.tube.append(p.mouth);
          p.mouth.style.background = `radial-gradient(circle, ${tint} 0%, ${tint}88 30%, transparent 70%)`;
          if (p.color) p.color.style.boxShadow = `0 0 ${(40 * unit).toFixed(1)}px ${tint}66`;
        }
        if (r.shape !== L.shape || r.color !== L.color) icon(p.shape, shapeIcon(r.shape, tint));
        if (r.size !== L.size || r.color !== L.color) icon(p.size, sizeIcon(r.size, tint));
        if (look.angle !== L.angle) {
          p.tube.style.transform = `rotate(${look.angle}rad)`;
          if (p.knob && layout.aim) {
            const k = aimKnob(layout.aim, look.angle);
            p.knob.setAttribute("cx", String(k.x));
            p.knob.setAttribute("cy", String(k.y));
          }
        }
        if (look.ready !== L.ready) p.tube.classList.toggle("fw-wait", !look.ready);
        const pulse = look.attract && look.ready;
        if (pulse !== L.attract) {
          p.mouth.classList.toggle("fw-on", pulse);
          p.arrow.classList.toggle("fw-on", pulse && !p.zone);
          p.zone?.classList.toggle("fw-on", pulse);
        }
        if (look.refusedAt !== L.refusedAt && look.refusedAt > 0) {
          p.tube.classList.remove("fw-shake");
          void p.tube.offsetWidth;
          p.tube.classList.add("fw-shake");
        }
        if (look.launchedAt !== L.launchedAt && look.launchedAt > 0) {
          p.mouth.classList.remove("fw-fire");
          void p.mouth.offsetWidth;
          p.mouth.classList.add("fw-fire");
        }
        if (look.charge !== L.charge) {
          if (look.charge === null) {
            p.mouth.style.opacity = "";
            p.mouth.style.transform = "";
          } else {
            p.mouth.style.opacity = String(0.4 + 0.6 * look.charge);
            p.mouth.style.transform = `scale(${(0.7 + 0.9 * look.charge).toFixed(3)})`;
          }
        }
        p.last = {
          color: r.color,
          shape: r.shape,
          size: r.size,
          angle: look.angle,
          ready: look.ready,
          attract: pulse,
          refusedAt: look.refusedAt,
          launchedAt: look.launchedAt,
          charge: look.charge,
        };
      });
    },
    pop(pad, which) {
      const el = parts[pad]?.[which];
      if (!el) return;
      el.classList.add("fw-pop");
      clearTimeout(pops.get(el));
      pops.set(
        el,
        window.setTimeout(() => el.classList.remove("fw-pop"), 160),
      );
    },
    dispose() {
      for (const t of pops.values()) clearTimeout(t);
      pops.clear();
      layer.remove();
    },
  };
};
