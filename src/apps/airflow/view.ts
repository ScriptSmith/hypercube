/**
 * Everything drawn over the flow, as one SVG in venue px: consoles and vents, each sting (rod,
 * shape, force arrows, angle knob, size buttons, handle), the shape tiles, wind sliders, view
 * switches and rings under fingers that block the stream. Rods, shapes and arrows lie under
 * every control, so a shape grown large passes beneath them. It only draws; touches are
 * handled in index.ts.
 *
 * Controls explain themselves with pictures: the handle shows four arrows, the knob two
 * turning arrows and a mark that turns with the shape, the size buttons a small disc with
 * arrows pointing in and a large one with arrows pointing out, the slider a fan that spins with
 * the wind between a breeze and a gale, each view button a small picture of that view.
 */
import { PALETTE, withAlpha } from "../../core/ui";
import type { View as ViewName } from "./config";
import { type Box, type Layout, sizeButtonsAt } from "./layout";
import { outlinePath, SHAPES, type ShapeId } from "./shapes";

const NS = "http://www.w3.org/2000/svg";

const el = <K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  parent?: Element,
): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.append(e);
  return e;
};

const COLORS = {
  shape: "#e6edf8",
  shapeEdge: "#9dbbe6",
  detail: "#27324a",
  rod: "#7d879c",
  handle: PALETTE.accent,
  handleIcon: "#1a1606",
  knob: "#6cf7f8",
  knobIcon: "#06292b",
  drag: "#fb5c99",
  lift: "#89da9b",
  panel: "rgba(9,13,22,0.88)",
  panelEdge: "#26304a",
  tile: "rgba(18,26,42,0.92)",
  tileEdge: "#3a4868",
  finger: "#ffffff",
} as const;

/** Four arrows, for dragging, on a 100-unit box centred on 0. */
const MOVE_ICON =
  "M0 -38L-12 -24M0 -38L12 -24M0 -38V38M0 38L-12 24M0 38L12 24" +
  "M-38 0L-24 -12M-38 0L-24 12M-38 0H38M38 0L24 -12M38 0L24 12";
/** Two arrows turning round, for the angle knob. */
const TURN_ICON =
  "M-28.2 -10.3A30 30 0 0 1 26 -15M27.2 -28.9L26 -15L13.4 -20.9" +
  "M28.2 10.3A30 30 0 0 1 -26 15M-27.2 28.9L-26 15L-13.4 20.9";
/** A three-bladed fan. */
const FAN =
  "M0 0C-6 -14 -2 -30 10 -34C16 -22 10 -8 0 0Z" +
  "M0 0C15 -2 28 8 27 21C14 23 4 12 0 0Z" +
  "M0 0C-9 12 -26 14 -36 6C-30 -6 -14 -8 0 0Z";

const wave = (x0: number, x1: number, y: number, amp: number) => {
  let d = `M${x0} ${y}`;
  const n = 4;
  const step = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const xa = x0 + step * (i + 0.5);
    const xb = x0 + step * (i + 1);
    d += `Q${xa} ${y + (i % 2 ? amp : -amp)} ${xb} ${y}`;
  }
  return d;
};

export interface StingDraw {
  hx: number;
  hy: number;
  sx: number;
  sy: number;
  kx: number;
  ky: number;
  /** Shape angle, degrees anticlockwise as drawn. */
  angle: number;
  /** Shape size as a share of its full size (a new shape pops up). */
  scale: number;
  held: boolean;
  turning: boolean;
}

export interface View {
  setShape(sting: number, id: ShapeId): void;
  sting(sting: number, d: StingDraw): void;
  /** Force arrows from the shape's centre, venue px, or null to hide; heads and lines are drawn for a shape `scale` times its usual size. */
  arrows(
    sting: number,
    drag: { x: number; y: number } | null,
    lift: { x: number; y: number } | null,
    scale?: number,
  ): void;
  tiles(sting: number, ids: readonly ShapeId[]): void;
  flashTile(sting: number, tile: number): void;
  /** Dim a size button that can go no further. */
  sizeLimits(sting: number, smaller: boolean, bigger: boolean): void;
  flashSize(sting: number, which: "smaller" | "bigger"): void;
  slider(zone: number, value: number, held: boolean, spin: number): void;
  view(zone: number, view: ViewName): void;
  fingers(points: readonly { x: number; y: number; r: number }[]): void;
  /** Pulse the handles to invite a first touch. */
  invite(on: boolean): void;
  dispose(): void;
}

const MAX_RINGS = 16;

export const createView = (root: HTMLElement, layout: Layout): View => {
  const { width: W, height: H } = layout.venue;
  const svg = el("svg", {
    viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: "xMinYMin meet",
    class: "af-view",
  });
  svg.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:hidden;";
  el("style", {}, svg).textContent =
    ".af-invite .af-halo{animation:af-pulse 2.4s ease-in-out infinite;}" +
    "@keyframes af-pulse{0%,100%{opacity:0.15}50%{opacity:0.75}}" +
    ".af-flash{animation:af-flash 0.5s ease-out;}" +
    "@keyframes af-flash{0%{opacity:1}100%{opacity:0}}";
  root.append(svg);

  // Consoles and vents behind everything else.
  for (const z of layout.zones) {
    if (!z.console) continue;
    const c = z.console;
    el("rect", { ...rectAttrs(c), fill: COLORS.panel }, svg);
    const edge = z.side === "left" ? c.x + c.width : c.x;
    el(
      "line",
      { x1: edge, y1: 0, x2: edge, y2: H, stroke: COLORS.panelEdge, "stroke-width": 4 },
      svg,
    );
  }
  for (const v of layout.vents) {
    const g = el("g", {}, svg);
    el("rect", { ...rectAttrs(v), fill: "#1a2236" }, g);
    for (let x = v.x + 12; x < v.x + v.width - 6; x += 24) {
      el(
        "line",
        { x1: x, y1: v.y + 4, x2: x, y2: v.y + v.height, stroke: "#3c4865", "stroke-width": 6 },
        g,
      );
    }
  }

  const shapeLayer = el("g", {}, svg);
  const rodLayer = el("g", {}, shapeLayer);
  const bodyLayer = el("g", {}, shapeLayer);
  const arrowLayer = el("g", {}, shapeLayer);

  // Sliders and view switches.
  const sliders = layout.zones.map((z) => {
    const s = z.slider;
    if (!s) return null;
    const g = el("g", {}, svg);
    const vertical = Math.abs(s.to.y - s.from.y) > Math.abs(s.to.x - s.from.x);
    // A track that widens from breeze to gale.
    const nx = vertical ? 1 : 0;
    const ny = vertical ? 0 : 1;
    const w0 = 10;
    const w1 = 34;
    el(
      "path",
      {
        d:
          `M${s.from.x - nx * w0} ${s.from.y - ny * w0}L${s.to.x - nx * w1} ${s.to.y - ny * w1}` +
          `L${s.to.x + nx * w1} ${s.to.y + ny * w1}L${s.from.x + nx * w0} ${s.from.y + ny * w0}Z`,
        fill: withAlpha(PALETTE.foreground, 0.18),
      },
      g,
    );
    // Wind lines beside each end: one short at the gentle end, three long at the strong end.
    const side = s.thumb / 2 + 26;
    const endMark = (p: { x: number; y: number }, lines: number, len: number) => {
      const dirx = vertical ? 0 : s.to.x > s.from.x ? 1 : -1;
      const diry = vertical ? (s.to.y > s.from.y ? 1 : -1) : 0;
      const cx = p.x + dirx * side;
      const cy = p.y + diry * side;
      for (let i = 0; i < lines; i++) {
        const off = (i - (lines - 1) / 2) * 16;
        const d = vertical
          ? wave(cx - len / 2, cx + len / 2, cy + off, 5)
          : wave(cx - len / 2 + dirx * 12, cx + len / 2 + dirx * 12, cy + off, 5);
        el(
          "path",
          {
            d,
            fill: "none",
            stroke: PALETTE.foreground,
            "stroke-width": 6,
            "stroke-linecap": "round",
            opacity: 0.8,
          },
          g,
        );
      }
    };
    endMark(s.from, 1, 34);
    endMark(s.to, 3, 64);
    const thumb = el("g", {}, g);
    el("circle", { r: s.thumb / 2, fill: "#d8e4f6", stroke: "#ffffff", "stroke-width": 0 }, thumb);
    const fan = el("path", { d: FAN, fill: "#1b2740" }, thumb);
    el("circle", { r: 6, fill: "#d8e4f6" }, thumb);
    return { thumb, fan, s, angle: 0 };
  });

  const viewSets = layout.zones.map((z) =>
    z.views.map((b) => {
      const g = el("g", { transform: `translate(${b.box.x} ${b.box.y})` }, svg);
      const r = el(
        "rect",
        {
          width: b.box.width,
          height: b.box.height,
          rx: b.box.width * 0.18,
          fill: COLORS.tile,
          stroke: COLORS.tileEdge,
          "stroke-width": 5,
        },
        g,
      );
      const inner = el(
        "g",
        {
          transform: `translate(${b.box.width / 2} ${b.box.height / 2}) scale(${b.box.width / 140})`,
        },
        g,
      );
      viewIcon(inner, b.view);
      return { view: b.view, rect: r };
    }),
  );

  // Stings.
  interface StingEls {
    rod: SVGLineElement;
    shape: SVGGElement;
    outline: SVGPathElement;
    details: SVGPathElement;
    drag: SVGPathElement;
    lift: SVGPathElement;
    knob: SVGGElement;
    knobRing: SVGCircleElement;
    pointer: SVGGElement;
    handle: SVGGElement;
    halo: SVGCircleElement;
    body: SVGCircleElement;
    tiles: { g: SVGGElement; pic: SVGGElement; flash: SVGRectElement }[];
    sizes: Record<"smaller" | "bigger", { g: SVGGElement; flash: SVGRectElement }>;
    size: number;
    arrowScale: number;
    /** The shape's centre as last drawn. */
    at: { x: number; y: number };
  }
  const stingLayer = el("g", {}, svg);
  const tileLayer = el("g", {}, svg);
  const stings: StingEls[] = layout.stings.map((s) => {
    const rod = el(
      "line",
      {
        stroke: COLORS.rod,
        "stroke-width": Math.max(8, s.size * 0.028),
        "stroke-linecap": "round",
      },
      rodLayer,
    );
    const shape = el("g", {}, bodyLayer);
    const outline = el(
      "path",
      {
        fill: COLORS.shape,
        stroke: COLORS.shapeEdge,
        "stroke-width": 1.4,
        "stroke-linejoin": "round",
      },
      shape,
    );
    const details = el("path", { fill: COLORS.detail }, shape);
    const arrowAttrs = { "stroke-linecap": "round", "stroke-linejoin": "round", fill: "none" };
    const drag = el(
      "path",
      { ...arrowAttrs, stroke: COLORS.drag, "stroke-width": Math.max(8, s.size * 0.035) },
      arrowLayer,
    );
    const lift = el(
      "path",
      { ...arrowAttrs, stroke: COLORS.lift, "stroke-width": Math.max(8, s.size * 0.035) },
      arrowLayer,
    );
    const knob = el("g", {}, stingLayer);
    const knobRing = el(
      "circle",
      { r: s.knob / 2, fill: withAlpha(COLORS.knob, 0.92), stroke: "#ffffff", "stroke-width": 0 },
      knob,
    );
    el(
      "path",
      {
        d: TURN_ICON,
        fill: "none",
        stroke: COLORS.knobIcon,
        "stroke-width": 9,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        transform: `scale(${s.knob / 120})`,
      },
      knob,
    );
    const pointer = el("g", {}, knob);
    el("circle", { cx: s.knob / 2 - 14, cy: 0, r: 9, fill: COLORS.knobIcon }, pointer);
    const sizeButton = (bigger: boolean) => {
      const w = s.sizeButton;
      const g = el("g", { style: "transition:opacity 0.25s" }, stingLayer);
      el(
        "rect",
        {
          width: w,
          height: w,
          rx: w * 0.16,
          fill: COLORS.tile,
          stroke: COLORS.tileEdge,
          "stroke-width": 5,
        },
        g,
      );
      const pic = el("g", { transform: `translate(${w / 2} ${w / 2}) scale(${w / 112})` }, g);
      sizeIcon(pic, bigger);
      const flash = el(
        "rect",
        { width: w, height: w, rx: w * 0.16, fill: "#ffffff", opacity: 0 },
        g,
      );
      return { g, flash };
    };
    const sizes = { smaller: sizeButton(false), bigger: sizeButton(true) };
    const handle = el("g", { class: "af-handle" }, stingLayer);
    const halo = el(
      "circle",
      {
        r: s.handle / 2 + 26,
        fill: "none",
        stroke: COLORS.handle,
        "stroke-width": 12,
        class: "af-halo",
        opacity: 0,
      },
      handle,
    );
    const body = el(
      "circle",
      { r: s.handle / 2, fill: COLORS.handle, stroke: "#ffffff", "stroke-width": 0 },
      handle,
    );
    el(
      "path",
      {
        d: MOVE_ICON,
        fill: "none",
        stroke: COLORS.handleIcon,
        "stroke-width": 9,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        transform: `scale(${s.handle / 115})`,
      },
      handle,
    );
    const tiles = s.tiles.map((t) => {
      const g = el("g", { transform: `translate(${t.x} ${t.y})` }, tileLayer);
      el(
        "rect",
        {
          width: t.width,
          height: t.height,
          rx: t.width * 0.16,
          fill: COLORS.tile,
          stroke: COLORS.tileEdge,
          "stroke-width": 5,
        },
        g,
      );
      const pic = el("g", { transform: `translate(${t.width / 2} ${t.height / 2})` }, g);
      const flash = el(
        "rect",
        { width: t.width, height: t.height, rx: t.width * 0.16, fill: "#ffffff", opacity: 0 },
        g,
      );
      return { g, pic, flash };
    });
    return {
      rod,
      shape,
      outline,
      details,
      drag,
      lift,
      knob,
      knobRing,
      pointer,
      handle,
      halo,
      body,
      tiles,
      sizes,
      size: s.size,
      arrowScale: 1,
      at: { x: 0, y: 0 },
    };
  });

  const rings: SVGCircleElement[] = [];
  const ringLayer = el("g", {}, svg);
  for (let i = 0; i < MAX_RINGS; i++) {
    rings.push(
      el(
        "circle",
        {
          r: 10,
          fill: withAlpha(COLORS.finger, 0.3),
          stroke: withAlpha(COLORS.finger, 0.85),
          "stroke-width": 8,
          visibility: "hidden",
        },
        ringLayer,
      ),
    );
  }

  const arrowPath = (x: number, y: number, v: { x: number; y: number } | null, size: number) => {
    if (!v) return "";
    const len = Math.hypot(v.x, v.y);
    if (len < size * 0.08) return "";
    const ux = v.x / len;
    const uy = v.y / len;
    const tx = x + v.x;
    const ty = y + v.y;
    const head = Math.min(len * 0.45, size * 0.14);
    const bx = tx - ux * head;
    const by = ty - uy * head;
    const px = -uy * head * 0.6;
    const py = ux * head * 0.6;
    return `M${x} ${y}L${tx} ${ty}M${bx + px} ${by + py}L${tx} ${ty}L${bx - px} ${by - py}`;
  };

  const view: View = {
    setShape(i, id) {
      const s = stings[i];
      if (!s) return;
      const def = SHAPES[id];
      s.outline.setAttribute("d", outlinePath(def.outline));
      s.details.setAttribute("d", def.details);
    },
    sting(i, d) {
      const s = stings[i];
      if (!s) return;
      s.at = { x: d.sx, y: d.sy };
      s.rod.setAttribute("x1", d.hx.toFixed(1));
      s.rod.setAttribute("y1", d.hy.toFixed(1));
      s.rod.setAttribute("x2", d.sx.toFixed(1));
      s.rod.setAttribute("y2", d.sy.toFixed(1));
      s.shape.setAttribute(
        "transform",
        `translate(${d.sx.toFixed(1)} ${d.sy.toFixed(1)}) rotate(${(-d.angle).toFixed(2)}) scale(${((s.size / 100) * d.scale).toFixed(4)})`,
      );
      s.knob.setAttribute("transform", `translate(${d.kx.toFixed(1)} ${d.ky.toFixed(1)})`);
      s.pointer.setAttribute("transform", `rotate(${(-d.angle).toFixed(2)})`);
      s.knobRing.setAttribute("stroke-width", d.turning ? "10" : "0");
      s.handle.setAttribute("transform", `translate(${d.hx.toFixed(1)} ${d.hy.toFixed(1)})`);
      s.body.setAttribute("stroke-width", d.held ? "10" : "0");
      const spec = layout.stings[i];
      if (spec) {
        const b = sizeButtonsAt(spec, d.hx, d.hy);
        for (const which of ["smaller", "bigger"] as const) {
          const at = b[which];
          s.sizes[which].g.setAttribute(
            "transform",
            `translate(${at.x.toFixed(1)} ${at.y.toFixed(1)})`,
          );
        }
      }
    },
    arrows(i, drag, lift, scale = 1) {
      const s = stings[i];
      if (!s) return;
      const size = s.size * scale;
      s.drag.setAttribute("d", arrowPath(s.at.x, s.at.y, drag, size));
      s.lift.setAttribute("d", arrowPath(s.at.x, s.at.y, lift, size));
      if (Math.abs(scale - s.arrowScale) > 0.01) {
        s.arrowScale = scale;
        const w = Math.max(8, size * 0.035).toFixed(1);
        s.drag.setAttribute("stroke-width", w);
        s.lift.setAttribute("stroke-width", w);
      }
    },
    tiles(i, ids) {
      const s = stings[i];
      const spec = layout.stings[i];
      if (!s || !spec) return;
      s.tiles.forEach((t, k) => {
        const id = ids[k];
        t.pic.replaceChildren();
        if (!id) {
          t.g.setAttribute("visibility", "hidden");
          return;
        }
        t.g.setAttribute("visibility", "visible");
        const box = spec.tiles[k]!;
        const def = SHAPES[id];
        const g = el("g", { transform: `scale(${(box.width * 0.72) / 100})` }, t.pic);
        el(
          "path",
          {
            d: outlinePath(def.outline),
            fill: COLORS.shape,
            stroke: COLORS.shapeEdge,
            "stroke-width": 2,
          },
          g,
        );
        el("path", { d: def.details, fill: COLORS.detail }, g);
      });
    },
    flashTile(i, k) {
      const t = stings[i]?.tiles[k];
      if (!t) return;
      t.flash.classList.remove("af-flash");
      // Restart the animation.
      void t.flash.getBoundingClientRect();
      t.flash.classList.add("af-flash");
    },
    sizeLimits(i, smaller, bigger) {
      const s = stings[i];
      if (!s) return;
      s.sizes.smaller.g.setAttribute("opacity", smaller ? "1" : "0.35");
      s.sizes.bigger.g.setAttribute("opacity", bigger ? "1" : "0.35");
    },
    flashSize(i, which) {
      const f = stings[i]?.sizes[which].flash;
      if (!f) return;
      f.classList.remove("af-flash");
      void f.getBoundingClientRect();
      f.classList.add("af-flash");
    },
    slider(z, value, held, spin) {
      const s = sliders[z];
      if (!s) return;
      const x = s.s.from.x + (s.s.to.x - s.s.from.x) * value;
      const y = s.s.from.y + (s.s.to.y - s.s.from.y) * value;
      s.angle = (s.angle + spin) % 360;
      s.thumb.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
      s.fan.setAttribute("transform", `rotate(${s.angle.toFixed(1)}) scale(${s.s.thumb / 95})`);
      s.thumb.firstElementChild?.setAttribute("stroke-width", held ? "10" : "0");
    },
    view(z, name) {
      for (const b of viewSets[z] ?? []) {
        const on = b.view === name;
        b.rect.setAttribute("stroke", on ? PALETTE.foreground : COLORS.tileEdge);
        b.rect.setAttribute("stroke-width", on ? "10" : "5");
      }
    },
    fingers(points) {
      rings.forEach((c, i) => {
        const p = points[i];
        if (!p) {
          c.setAttribute("visibility", "hidden");
          return;
        }
        c.setAttribute("visibility", "visible");
        c.setAttribute("cx", p.x.toFixed(1));
        c.setAttribute("cy", p.y.toFixed(1));
        c.setAttribute("r", p.r.toFixed(1));
      });
    },
    invite(on) {
      svg.classList.toggle("af-invite", on);
      for (const s of stings) s.halo.setAttribute("opacity", on ? "" : "0");
    },
    dispose() {
      svg.remove();
    },
  };
  return view;
};

const rectAttrs = (b: Box) => ({ x: b.x, y: b.y, width: b.width, height: b.height });

/**
 * A size button's picture on a 112-unit box centred on 0: a small disc with four arrows
 * pointing in at it, or a large one with four pointing out from it.
 */
const sizeIcon = (g: SVGGElement, bigger: boolean) => {
  el("circle", { r: bigger ? 21 : 10, fill: COLORS.shape }, g);
  const [from, to] = bigger ? [28, 50] : [50, 19];
  let d = "";
  for (const [sx, sy] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const) {
    const ux = sx * Math.SQRT1_2;
    const uy = sy * Math.SQRT1_2;
    const dir = Math.sign(to - from);
    const tx = ux * to;
    const ty = uy * to;
    // The head's two barbs, back along the shaft and out to each side.
    const bx = tx - ux * dir * 11;
    const by = ty - uy * dir * 11;
    d += `M${(ux * from).toFixed(1)} ${(uy * from).toFixed(1)}L${tx.toFixed(1)} ${ty.toFixed(1)}`;
    d += `M${(bx - uy * 10).toFixed(1)} ${(by + ux * 10).toFixed(1)}L${tx.toFixed(1)} ${ty.toFixed(1)}`;
    d += `L${(bx + uy * 10).toFixed(1)} ${(by - ux * 10).toFixed(1)}`;
  }
  el(
    "path",
    {
      d,
      fill: "none",
      stroke: COLORS.knob,
      "stroke-width": 8,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    },
    g,
  );
};

/** Small pictures of each view on a 140-unit box centred on 0. */
const viewIcon = (g: SVGGElement, view: ViewName) => {
  if (view === "smoke") {
    for (const [y, c] of [
      [-30, "#f2f6ff"],
      [0, "#7fe6ff"],
      [30, "#ff9bd6"],
    ] as const) {
      el(
        "path",
        {
          d: wave(-48, 48, y, 10),
          fill: "none",
          stroke: c,
          "stroke-width": 9,
          "stroke-linecap": "round",
        },
        g,
      );
    }
    return;
  }
  if (view === "speed") {
    const colors = ["#1a549e", "#1fb3a8", "#9ee56b", "#fbf7cc"];
    colors.forEach((c, i) => {
      el("rect", { x: -48 + i * 24, y: -40, width: 24, height: 80, fill: c }, g);
    });
    el(
      "path",
      {
        d: "M-40 0H34M34 0L20 -12M34 0L20 12",
        fill: "none",
        stroke: "#0b1222",
        "stroke-width": 8,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      },
      g,
    );
    return;
  }
  const spiral = (cx: number, dir: number, color: string) => {
    let d = "";
    for (let i = 0; i <= 28; i++) {
      const a = (i / 28) * Math.PI * 3.2;
      const r = 4 + i * 0.85;
      const x = cx + Math.cos(a * dir) * r;
      const y = Math.sin(a * dir) * r;
      d += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    el("path", { d, fill: "none", stroke: color, "stroke-width": 8, "stroke-linecap": "round" }, g);
  };
  spiral(-24, -1, "#33d9f2");
  spiral(26, 1, "#fa5cb3");
};
