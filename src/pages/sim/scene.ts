import type { PhysicalLayout, Viewport } from "./layout";
import type { Person, SimFrame, SimPreset } from "./presets";

const SVG = "http://www.w3.org/2000/svg";

const node = <K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  text?: string,
): SVGElementTagNameMap[K] => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (text !== undefined) n.textContent = text;
  return n;
};

/** A plain standing figure, feet at (x, floor), `h` px tall. */
const silhouette = (x: number, floor: number, h: number): SVGGElement => {
  const g = node("g", { class: "sim-person" });
  const r = h * 0.06;
  const torsoTop = floor - h * 0.87;
  const torsoBottom = floor - h * 0.55;
  g.append(node("circle", { cx: x, cy: floor - h + r, r }));
  g.append(
    node("rect", {
      x: x - h * 0.11,
      y: torsoTop,
      width: h * 0.22,
      height: torsoBottom - torsoTop,
      rx: h * 0.04,
    }),
  );
  for (const ax of [x - h * 0.16, x + h * 0.12]) {
    g.append(
      node("rect", {
        x: ax,
        y: torsoTop + h * 0.01,
        width: h * 0.04,
        height: h * 0.33,
        rx: h * 0.02,
      }),
    );
  }
  for (const lx of [x - h * 0.09, x + h * 0.015]) {
    g.append(
      node("rect", {
        x: lx,
        y: torsoBottom - h * 0.02,
        width: h * 0.075,
        height: floor - torsoBottom + h * 0.02,
        rx: h * 0.02,
      }),
    );
  }
  return g;
};

const person = (p: Person, layout: PhysicalLayout): SVGGElement => {
  const g = node("g", { class: "sim-people" });
  const x = layout.x(p.x);
  const floor = layout.y(0);
  const h = p.height * layout.pxPerM;
  g.append(silhouette(x, floor, h));
  g.append(
    node(
      "text",
      { x, y: floor - h - 4, class: "sim-person-label", "text-anchor": "middle" },
      `${p.kind} ${p.height} m`,
    ),
  );
  return g;
};

/**
 * A sphere's outline with a few latitudes and meridians, seen from a little below, and the
 * line it hangs from. Its picture sits inside the outline.
 */
const ball = (f: SimFrame, layout: PhysicalLayout, ceiling: number | undefined): SVGGElement => {
  const g = node("g", { class: "sim-ball" });
  const r = (f.phys.w / 2) * layout.pxPerM;
  const cx = layout.x(f.phys.x + f.phys.w / 2);
  const cy = layout.y(f.phys.y + f.phys.h / 2);
  if (ceiling !== undefined) {
    g.append(
      node("line", { x1: cx, x2: cx, y1: layout.y(ceiling), y2: cy - r, class: "sim-hang" }),
    );
  }
  g.append(node("circle", { cx, cy, r, class: "sim-ball-outline" }));
  for (const lat of [-60, -30, 0, 30, 60]) {
    const a = (lat * Math.PI) / 180;
    const rx = r * Math.cos(a);
    g.append(node("ellipse", { cx, cy: cy - r * Math.sin(a), rx, ry: rx * 0.2 }));
  }
  for (const lon of [30, 60]) {
    g.append(node("ellipse", { cx, cy, rx: r * Math.sin((lon * Math.PI) / 180), ry: r }));
  }
  g.append(node("line", { x1: cx, x2: cx, y1: cy - r, y2: cy + r }));
  return g;
};

/** Floor, ceiling, height ruler, zone labels, corner markers, spheres and people, in page px. */
export const drawScene = (
  svg: SVGSVGElement,
  preset: SimPreset,
  layout: PhysicalLayout,
  view: Viewport,
): void => {
  svg.replaceChildren();
  svg.setAttribute("viewBox", `0 0 ${view.width} ${view.height}`);
  const floor = layout.y(0);
  const top = Math.max(...preset.frames.map((f) => f.phys.y + f.phys.h), preset.ceiling ?? 0);

  svg.append(node("line", { x1: 0, x2: view.width, y1: floor, y2: floor, class: "sim-floor" }));
  svg.append(node("text", { x: 6, y: floor + 15, class: "sim-scene-text" }, "floor"));
  if (preset.ceiling !== undefined) {
    const y = layout.y(preset.ceiling);
    svg.append(node("line", { x1: 0, x2: view.width, y1: y, y2: y, class: "sim-floor" }));
    svg.append(
      node(
        "text",
        { x: view.width - 6, y: y - 5, class: "sim-scene-text", "text-anchor": "end" },
        "ceiling",
      ),
    );
  }

  // Ruler ticks every metre, or every two when they would crowd.
  const step = layout.pxPerM < 18 ? 2 : 1;
  for (let m = step; m <= top; m += step) {
    const y = layout.y(m);
    svg.append(node("line", { x1: 0, x2: 8, y1: y, y2: y, class: "sim-tick" }));
    svg.append(node("text", { x: 11, y: y + 4, class: "sim-scene-text" }, `${m} m`));
  }

  for (const zone of preset.zones) {
    const frames = preset.frames.filter((f) => f.zone === zone.id);
    const zoneTop = Math.max(...frames.map((f) => f.phys.y + f.phys.h));
    const x0 = Math.min(...frames.map((f) => f.phys.x));
    // Left-aligned so the screen's or wall's badge can sit at the right above the frame.
    const label = node("text", {
      x: layout.x(x0) + 4,
      y: layout.y(zoneTop) - 10,
      class: "sim-zone-label",
    });
    label.append(zone.label);
    if (zone.note) {
      label.append(node("tspan", { class: "sim-zone-note", dx: 8 }, zone.note));
    }
    svg.append(label);
  }

  for (const c of preset.corners) {
    const x = layout.x(c);
    svg.append(
      node("line", { x1: x, x2: x, y1: floor, y2: layout.y(top) - 4, class: "sim-corner" }),
    );
    svg.append(
      node(
        "text",
        { x: x, y: floor + 15, class: "sim-scene-text", "text-anchor": "middle" },
        "corner (90°, unfolded)",
      ),
    );
  }

  for (const f of preset.frames) {
    if (f.kind === "sphere") svg.append(ball(f, layout, preset.ceiling));
  }

  for (const p of preset.people) svg.append(person(p, layout));
};
