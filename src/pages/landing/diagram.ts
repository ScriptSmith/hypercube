import { activeVenue, displayFor } from "../../core/venue";
import { PERSON, SPHERE_HANG } from "../sim/physical";
import { defaultReach, type LandingConfig } from "./config";
import type { Plan, PlanFrame, PlanSide, UrlEntry } from "./urls";

const MAX_W = 560;
const MAX_H = 210;
const LABEL_H = 22;
/** Gaps drawn at least this wide, in diagram px, so thin bezels stay visible. */
const MIN_GAP = 2;
const MIN_SCREEN_GAP = 4;

/** The bezel and the gap below the screen in venue px, scaled by the panel's px per metre. */
const venueGaps = (): Gaps => {
  const { panel, screen, bezelM } = activeVenue();
  const pxPerM = panel.width / panel.widthM;
  return {
    bezel: bezelM * pxPerM,
    screen: Math.max(0, screen.bottomM - (panel.bottomM + panel.heightM)) * pxPerM,
  };
};

const escape = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const r1 = (n: number): string => String(Math.round(n * 10) / 10);

interface Box {
  frame: PlanFrame;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Gaps {
  bezel: number;
  screen: number;
}

/** Venue-px layout of one side: its touch frames in a row with the screen above them. */
const layoutSide = (
  side: PlanSide,
  gaps: Gaps,
): { boxes: Box[]; width: number; height: number } => {
  const boxes: Box[] = [];
  const first = side.stations[0];
  const size = first ? displayFor(first.kind, first.span) : null;
  const n = side.stations.length;
  const rowW = size ? n * size.width + (n - 1) * gaps.bezel : 0;
  const rowH = size?.height ?? 0;

  let screenH = 0;
  let width = rowW;
  if (side.screen) {
    // The screen sits exactly above its bank, at the bank's width. Its height is not to
    // scale: a screen above a bank is usually tall enough to dwarf the panels.
    const screen = displayFor("screen");
    const w = rowW || screen.width;
    screenH = rowW ? Math.max(rowH * 0.85, rowW * 0.18) : screen.height;
    boxes.push({ frame: side.screen, x: 0, y: 0, w, h: screenH });
    width = w;
  }
  const top = side.screen && rowW ? screenH + gaps.screen : 0;
  side.stations.forEach((frame, i) => {
    if (!size) return;
    boxes.push({ frame, x: i * (size.width + gaps.bezel), y: top, w: size.width, h: size.height });
  });
  return { boxes, width, height: top + rowH || screenH };
};

const SIDE_LABEL: Record<string, string> = {
  left: "Left bank",
  right: "Right bank",
  a: "Side A",
  b: "Side B",
};

const svgOf = (w: number, h: number, body: string): string =>
  `<svg class="diagram" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Layout of the frames">${body}</svg>`;

/** A standing figure, feet at (x, floor), `h` px tall. */
const person = (x: number, floor: number, h: number): string => {
  const head = h * 0.075;
  const w = h * 0.24;
  const top = floor - h + head * 2.2;
  return (
    `<g class="person"><circle cx="${r1(x)}" cy="${r1(floor - h + head)}" r="${r1(head)}"/>` +
    `<rect x="${r1(x - w / 2)}" y="${r1(top)}" width="${r1(w)}" height="${r1(floor - top)}" rx="${r1(w * 0.35)}"/></g>`
  );
};

/**
 * A sphere to scale from the side: the ball hanging from the ceiling on a short line, with
 * the floor below and an adult standing underneath it.
 */
const sphereDiagram = (entry: UrlEntry | undefined): string => {
  const { diameterM, bottomM } = activeVenue().sphere;
  const ceilingM = bottomM + diameterM + SPHERE_HANG;
  const side = Math.max(1.5, diameterM * 0.3);
  const scale = Math.min(MAX_H / ceilingM, MAX_W / (diameterM + 2 * side));
  const w = Math.ceil((diameterM + 2 * side) * scale);
  const h = Math.ceil(ceilingM * scale) + 1;
  const floor = h - 0.5;
  const ceiling = 0.5;
  const r = (diameterM / 2) * scale;
  const cx = w / 2;
  const cy = floor - (bottomM + diameterM / 2) * scale;

  let ball = `<line class="f-hang" x1="${r1(cx)}" y1="${r1(ceiling)}" x2="${r1(cx)}" y2="${r1(cy - r)}"/>`;
  ball += `<circle class="f-body" cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r)}"/>`;
  // Seen from a little below: latitudes are flat ellipses, meridians narrow ones.
  for (const lat of [-45, 0, 45]) {
    const a = (lat * Math.PI) / 180;
    const rx = r * Math.cos(a);
    ball += `<ellipse class="f-grid" cx="${r1(cx)}" cy="${r1(cy - r * Math.sin(a))}" rx="${r1(rx)}" ry="${r1(rx * 0.22)}"/>`;
  }
  ball += `<ellipse class="f-grid" cx="${r1(cx)}" cy="${r1(cy)}" rx="${r1(r * 0.5)}" ry="${r1(r)}"/>`;
  ball += `<line class="f-grid" x1="${r1(cx)}" y1="${r1(cy - r)}" x2="${r1(cx)}" y2="${r1(cy + r)}"/>`;

  const tone = entry?.tone ?? 0;
  const key = entry ? ` data-key="${escape(entry.key)}"` : "";
  const body =
    `<line class="room" x1="0" y1="${r1(ceiling)}" x2="${w}" y2="${r1(ceiling)}"/>` +
    `<line class="room" x1="0" y1="${r1(floor)}" x2="${w}" y2="${r1(floor)}"/>` +
    person(cx - r * 0.35, floor, PERSON.adult * scale) +
    `<g class="f tone-${tone}"${key}>${ball}</g>`;
  return svgOf(w, h, body);
};

/**
 * A schematic of the installation for the chosen setup. Each frame carries the key of the
 * URL that goes to it, so hovering a URL can light up its frames.
 */
export const diagramSvg = (
  plan: Plan,
  entries: readonly UrlEntry[],
  cfg: LandingConfig,
): string => {
  // Frame ids are unique within a plan, and the entries may come from a separate planSetup call.
  const keyOf = new Map<string, UrlEntry>();
  for (const e of entries) for (const f of e.frames) keyOf.set(f.id, e);

  const only = plan.sides.length === 1 ? plan.sides[0]?.stations : undefined;
  if (only?.length === 1 && only[0]?.kind === "sphere") {
    return sphereDiagram(keyOf.get(only[0].id));
  }

  const between = plan.setup === "versus" ? 0.5 : plan.setup === "corner" ? 0.12 : 0;
  const measure = (gaps: Gaps) => {
    const sides = plan.sides.map((side) => layoutSide(side, gaps));
    const widest = Math.max(...sides.map((s) => s.width));
    const gap = widest * between;
    const totalW = sides.reduce((sum, s) => sum + s.width, 0) + gap * (sides.length - 1);
    const totalH = Math.max(...sides.map((s) => s.height));
    return { sides, gap, totalW, totalH, scale: Math.min(MAX_W / totalW, MAX_H / totalH) };
  };
  // Lay out at true bezel size, then widen gaps that would vanish at the drawing's scale.
  const real = venueGaps();
  const rough = measure(real);
  const { sides, gap, totalW, totalH, scale } = measure({
    bezel: Math.max(real.bezel, MIN_GAP / rough.scale),
    screen: Math.max(real.screen, MIN_SCREEN_GAP / rough.scale),
  });
  const labelled = sides.length > 1;
  const vbW = Math.ceil(totalW * scale);
  const vbH = Math.ceil(totalH * scale) + (labelled ? LABEL_H : 0);

  let out = "";
  let x0 = 0;
  plan.sides.forEach((side, s) => {
    const layout = sides[s];
    if (!layout) return;
    const dy = totalH - layout.height;
    for (const box of layout.boxes) {
      const entry = keyOf.get(box.frame.id);
      const x = (x0 + box.x) * scale;
      const y = (dy + box.y) * scale;
      const w = box.w * scale;
      const h = box.h * scale;
      const screen = box.frame.kind === "screen";
      let inner = `<rect class="f-body" x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="2"${screen ? ` stroke-dasharray="5 4"` : ""}/>`;
      if (!screen) {
        const reach = cfg.reachOverride ? cfg.reach : defaultReach(box.frame.kind, box.frame.span);
        const childH = h * Math.min(1, reach.child);
        inner += `<rect class="f-reach" x="${r1(x)}" y="${r1(y + h - childH)}" width="${r1(w)}" height="${r1(childH)}" rx="2"/>`;
        if (reach.adult < 1) {
          const ay = y + h - h * reach.adult;
          inner += `<line class="f-adult" x1="${r1(x)}" y1="${r1(ay)}" x2="${r1(x + w)}" y2="${r1(ay)}"/>`;
        }
        for (let i = 1; i < box.frame.span; i++) {
          const sx = x + (w * i) / box.frame.span;
          inner += `<line class="f-seam" x1="${r1(sx)}" y1="${r1(y)}" x2="${r1(sx)}" y2="${r1(y + h)}"/>`;
        }
        if (w >= 14 && box.frame.count > 1) {
          const size = Math.min(12, w * 0.55);
          inner += `<text x="${r1(x + w / 2)}" y="${r1(y + h * 0.35)}" font-size="${r1(size)}">${box.frame.pos + 1}</text>`;
        }
      } else {
        inner += `<text x="${r1(x + w / 2)}" y="${r1(y + h / 2 + 4)}" font-size="11">screen</text>`;
      }
      const tone = entry?.tone ?? 0;
      const key = entry ? ` data-key="${escape(entry.key)}"` : "";
      out += `<g class="f tone-${tone}"${key}>${inner}</g>`;
    }
    if (labelled) {
      const label = SIDE_LABEL[side.side] ?? "";
      out += `<text class="side" x="${r1((x0 + layout.width / 2) * scale)}" y="${vbH - 6}" font-size="11">${escape(label)}</text>`;
    }
    x0 += layout.width + gap;
  });

  if (plan.setup === "corner" && sides[0]) {
    const cx = (sides[0].width + gap / 2) * scale;
    out += `<line class="fold" x1="${r1(cx)}" y1="0" x2="${r1(cx)}" y2="${r1(totalH * scale)}"/>`;
  }
  if (plan.setup === "versus" && sides[0]) {
    const cx = (sides[0].width + gap / 2) * scale;
    out += `<text class="vs" x="${r1(cx)}" y="${r1((totalH * scale) / 2 + 5)}" font-size="13">vs</text>`;
  }

  return svgOf(vbW, vbH, out);
};
