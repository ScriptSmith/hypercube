import { FONT, iconElement, PALETTE, withAlpha } from "../../core/ui";
import type { Ui } from "../../core/types";
import type { Box } from "./dish";
import { presetIcon, stampIcon, stampTint } from "./icons";
import { detentAngles, type DialSpec, type Labelled, type Layout, sliceMarks } from "./layout";
import { type Family, presetCount, presetLabel } from "./stamps";

/**
 * The controls as plain DOM over the canvas: swatch tiles, dials, pipettes and ghost hands. None
 * of it takes touches (the app hit-tests its own input, so a finger can land anywhere and the
 * culture shows through), except the hold-to-reset buttons from the UI kit, which swallow theirs.
 */
export interface View {
  select(side: number, stamp: string): void;
  press(side: number, stamp: string): void;
  setDial(index: number, value: number): void;
  /** While a finger turns a dial: where its pointer is, in radians from straight up. */
  turnDial(index: number, angle: number | null): void;
  pipette(side: number, color: string, fill: number): void;
  flash(side: number): void;
  ghost(id: number, at: { x: number; y: number } | null): void;
  /** Screen only: the condition of each slice, drawn under the dish at venue x. */
  slices(marks: readonly { x: number; value: number }[], family: Family): void;
  dispose(): void;
}

export const MAX_GHOSTS = 6;

const STYLE_ID = "petri-style";
const CSS = `
.pt-tile { position:absolute; box-sizing:border-box; pointer-events:none; overflow:hidden;
  transition:transform 0.14s ease-out, box-shadow 0.25s, border-color 0.25s; }
.pt-tile.pt-pressed { transform:scale(0.9); }
.pt-dial, .pt-knob, .pt-pointer, .pt-detent, .pt-pipe, .pt-ghost, .pt-slice, .pt-part { position:absolute; pointer-events:none; box-sizing:border-box; }
.pt-label { display:flex; align-items:center; justify-content:center; white-space:nowrap; line-height:1; transition:color 0.25s; }
.pt-plate { left:0; right:0; bottom:0; transition:opacity 0.25s; }
.pt-knob { transition:transform 0.18s ease-out; }
.pt-knob.pt-live { transition:none; }
.pt-detent { overflow:hidden; transition:opacity 0.25s, box-shadow 0.25s, border-color 0.25s; }
.pt-pipe.pt-flash .pt-bead { animation:pt-flash 0.7s ease-out; }
.pt-hint { animation:pt-bob 1.8s ease-in-out infinite; }
@keyframes pt-flash { 0% { filter:brightness(2.2); transform:scale(1.35); } 100% { filter:none; transform:none; } }
@keyframes pt-bob { 0%,100% { transform:translateY(10%); opacity:0.55; } 50% { transform:translateY(-12%); opacity:1; } }
@media (prefers-reduced-motion: reduce) { .pt-hint { animation:none; } }
`;

const ensureCss = () => {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
};

const place = (el: HTMLElement, b: Box, unit: number) => {
  el.style.left = `${b.x * unit}px`;
  el.style.top = `${b.y * unit}px`;
  el.style.width = `${b.width * unit}px`;
  el.style.height = `${b.height * unit}px`;
};

const PIPE_SVG = (glass: string) =>
  `<svg viewBox="0 0 100 300" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true" style="display:block;overflow:visible">` +
  `<rect x="30" y="70" width="40" height="190" rx="18" fill="${withAlpha(glass, 0.08)}" stroke="${withAlpha(glass, 0.55)}" stroke-width="5"/>` +
  `<path d="M38 260L50 292L62 260Z" fill="${withAlpha(glass, 0.35)}"/>` +
  `<ellipse cx="50" cy="44" rx="34" ry="40" fill="${withAlpha(glass, 0.12)}" stroke="${withAlpha(glass, 0.5)}" stroke-width="5"/>` +
  `</svg>`;

export interface ViewOptions {
  root: HTMLElement;
  layout: Layout;
  unit: number;
  family: Family;
  ui: Ui;
  onReset(side: number): void;
}

let measurer: CanvasRenderingContext2D | null = null;

/** The font size at which `text` fits `width` px, at most `font`. */
const fitFont = (text: string, font: number, width: number): number => {
  measurer ??= document.createElement("canvas").getContext("2d");
  if (!measurer) return font;
  measurer.font = `800 ${font}px ${FONT}`;
  const w = measurer.measureText(text).width;
  return w > width ? Math.max(1, Math.floor((font * width) / w)) : font;
};

interface Parts {
  el: HTMLElement;
  plate: HTMLElement;
  label: HTMLElement;
  icon: HTMLElement;
}

export const createView = (opts: ViewOptions): View => {
  ensureCss();
  const { layout, unit, family } = opts;
  const layer = document.createElement("div");
  layer.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:2;";
  opts.root.append(layer);
  const u = (v: number) => `${v * unit}px`;

  /** An icon over a label inside `parts.box`, with a nameplate behind the label for selection. */
  const labelled = (
    parts: Labelled,
    text: string,
    iconSvg: string,
    className: string,
    border: number,
  ): Parts => {
    const el = document.createElement("div");
    el.className = className;
    place(el, parts.box, unit);
    el.style.borderWidth = `${border}px`;
    el.style.borderStyle = "solid";
    const inner = (b: Box): Box => ({
      x: b.x - parts.box.x - border / unit,
      y: b.y - parts.box.y - border / unit,
      width: b.width,
      height: b.height,
    });
    const icon = document.createElement("div");
    icon.className = "pt-part";
    place(icon, inner(parts.icon), unit);
    icon.innerHTML = iconSvg;
    const plate = document.createElement("div");
    plate.className = "pt-part pt-plate";
    plate.style.top = u(inner(parts.label).y - parts.font * 0.12);
    plate.style.opacity = "0";
    const label = document.createElement("div");
    label.className = "pt-part pt-label";
    place(label, inner(parts.label), unit);
    const px = fitFont(text, parts.font * unit, parts.label.width * unit);
    label.style.font = `800 ${px}px ${FONT}`;
    label.textContent = text;
    el.append(plate, icon, label);
    return { el, plate, label, icon };
  };

  const LABEL = "rgba(226,238,244,0.92)";
  const INK = "#07121a";

  const tiles = layout.pads.map((p) => {
    const map = new Map<string, Parts>();
    for (const s of p.swatches) {
      const tint = stampTint(s.stamp);
      const t = labelled(s, s.stamp.label, stampIcon(s.stamp), "pt-tile", Math.max(1, 4 * unit));
      t.el.style.borderRadius = u(s.box.width * 0.2);
      t.el.style.borderColor = withAlpha(tint, 0.3);
      t.el.style.background = `radial-gradient(circle at 35% 30%, rgba(40,58,74,0.82), rgba(10,15,24,0.86))`;
      t.el.style.color = tint;
      t.plate.style.background = tint;
      t.label.style.color = LABEL;
      layer.append(t.el);
      map.set(s.stamp.id, t);
    }
    return map;
  });

  const resets = layout.pads.map((p) =>
    opts.ui.button({
      icon: "reset",
      rect: {
        x: p.reset.x * unit,
        y: p.reset.y * unit,
        width: p.reset.width * unit,
        height: p.reset.height * unit,
      },
      hold: 1500,
      look: "ghost",
      color: PALETTE.muted,
      onPress: () => opts.onReset(p.side),
    }),
  );

  interface DialDom {
    spec: DialSpec;
    knob: HTMLElement;
    detents: Parts[];
    value: number;
  }
  const n = presetCount(family);
  const dials: DialDom[] = layout.dials.map((spec) => {
    const wrap = document.createElement("div");
    wrap.className = "pt-dial";
    layer.append(wrap);
    const detents = spec.chips.map((chip, i) => {
      const d = labelled(
        chip,
        presetLabel(family, i),
        presetIcon(family, i),
        "pt-detent",
        Math.max(1, 3 * unit),
      );
      d.el.style.borderRadius = u(Math.min(chip.box.width, chip.box.height) * 0.26);
      d.el.style.background = "rgba(8,12,20,0.72)";
      d.plate.style.background = "#dff4fa";
      wrap.append(d.el);
      return d;
    });
    const knob = document.createElement("div");
    knob.className = "pt-knob";
    place(
      knob,
      { x: spec.cx - spec.r, y: spec.cy - spec.r, width: spec.r * 2, height: spec.r * 2 },
      unit,
    );
    knob.style.borderRadius = "50%";
    knob.style.background =
      "radial-gradient(circle at 50% 50%, rgba(10,16,24,0.15) 0 52%, rgba(52,76,92,0.78) 54%, rgba(18,26,38,0.86) 78%, rgba(120,170,190,0.45) 80%, rgba(12,18,28,0.82) 83%)";
    knob.style.boxShadow = `0 0 ${u(40)} rgba(80,160,190,0.25)`;
    const pointer = document.createElement("div");
    pointer.className = "pt-pointer";
    const pw = spec.r * 0.2;
    place(
      pointer,
      { x: spec.r - pw / 2, y: spec.r * 0.06, width: pw, height: spec.r * 0.42 },
      unit,
    );
    pointer.style.borderRadius = u(pw / 2);
    pointer.style.background = "#e8f6fa";
    pointer.style.boxShadow = `0 0 ${u(24)} rgba(160,230,255,0.8)`;
    knob.append(pointer);
    wrap.append(knob);
    return { spec, knob, detents, value: -1 };
  });

  const showDial = (d: DialDom, angle: number, live: boolean) => {
    d.knob.classList.toggle("pt-live", live);
    d.knob.style.transform = `rotate(${angle}rad)`;
  };

  const pipes = layout.pads.map((p) => {
    if (!p.pipette) return null;
    const el = document.createElement("div");
    el.className = "pt-pipe";
    place(el, p.pipette, unit);
    el.innerHTML = PIPE_SVG("#cfe8f0");
    const bead = document.createElement("div");
    bead.className = "pt-bead";
    const size = p.pipette.width * 0.42;
    bead.style.cssText =
      `position:absolute;left:${u((p.pipette.width - size) / 2)};top:${u(p.pipette.height * 0.08)};` +
      `width:${u(size)};height:${u(size)};border-radius:50%;transition:opacity 0.3s,transform 0.3s;`;
    const level = document.createElement("div");
    level.style.cssText =
      `position:absolute;left:${u(p.pipette.width * 0.32)};width:${u(p.pipette.width * 0.36)};` +
      `bottom:${u(p.pipette.height * 0.14)};border-radius:${u(14)};transition:height 0.2s linear;`;
    const hint = iconElement("up", "100%", "#dff3f8");
    hint.className = "pt-hint";
    const hs = p.pipette.width * 0.7;
    hint.style.cssText += `position:absolute;left:${u((p.pipette.width - hs) / 2)};top:${u(-hs * 1.25)};width:${u(hs)};height:${u(hs)};`;
    el.append(level, bead, hint);
    layer.append(el);
    return { el, bead, level, hint, height: p.pipette.height, flashTimer: 0, key: "" };
  });

  const ghosts: HTMLElement[] = [];
  const ghostIds: number[] = [];
  const ghostEl = () => {
    const el = iconElement("hand", "100%", "rgba(235,245,250,0.85)");
    el.className = "pt-ghost";
    const s = 150;
    el.style.width = u(s);
    el.style.height = u(s);
    el.style.marginLeft = u(-s * 0.36);
    el.style.marginTop = u(-s * 0.02);
    el.style.filter = `drop-shadow(0 0 ${u(16)} rgba(120,210,240,0.6))`;
    el.style.display = "none";
    layer.append(el);
    return el;
  };

  const sliceLayer = document.createElement("div");
  sliceLayer.style.cssText = "position:absolute;inset:0;pointer-events:none;";
  layer.append(sliceLayer);
  let sliceKey = "";

  return {
    select(side, stamp) {
      for (const [id, t] of tiles[side] ?? []) {
        const on = id === stamp;
        const tint = t.el.style.color;
        t.el.style.borderColor = on ? tint : withAlpha(PALETTE.foreground, 0.12);
        t.el.style.boxShadow = on
          ? `0 0 ${u(36)} ${tint}, inset 0 0 ${u(30)} rgba(255,255,255,0.08)`
          : "none";
        t.plate.style.opacity = on ? "1" : "0";
        t.label.style.color = on ? INK : LABEL;
      }
    },
    press(side, stamp) {
      const el = tiles[side]?.get(stamp)?.el;
      if (!el) return;
      el.classList.add("pt-pressed");
      window.setTimeout(() => el.classList.remove("pt-pressed"), 160);
    },
    setDial(index, value) {
      const d = dials[index];
      if (!d) return;
      d.value = value;
      const angles = detentAngles(n, d.spec.spread);
      showDial(d, angles[value] ?? 0, false);
      d.detents.forEach((p, i) => {
        const on = i === value;
        p.el.style.borderColor = on ? "rgba(200,240,255,0.95)" : "rgba(200,225,235,0.28)";
        p.el.style.boxShadow = on ? `0 0 ${u(30)} rgba(140,220,255,0.55)` : "none";
        p.icon.style.opacity = on ? "1" : "0.6";
        p.plate.style.opacity = on ? "1" : "0";
        p.label.style.color = on ? INK : LABEL;
      });
    },
    turnDial(index, angle) {
      const d = dials[index];
      if (!d) return;
      if (angle === null) {
        const angles = detentAngles(n, d.spec.spread);
        showDial(d, angles[d.value] ?? 0, false);
      } else showDial(d, angle, true);
    },
    pipette(side, color, fill) {
      const p = pipes[side];
      if (!p) return;
      // Called every tick: touch the styles only when something visible changes.
      const key = `${color}:${Math.round(fill * 40)}`;
      if (key === p.key) return;
      p.key = key;
      const full = fill >= 1;
      p.bead.style.background = `radial-gradient(circle at 35% 30%, #ffffff, ${color} 55%, ${withAlpha(color, 0.6)})`;
      p.bead.style.boxShadow = full ? `0 0 ${u(40)} ${color}` : "none";
      p.bead.style.opacity = full ? "1" : "0.15";
      p.bead.style.transform = full ? "scale(1)" : "scale(0.6)";
      p.level.style.background = withAlpha(color, 0.55);
      p.level.style.height = u(p.height * 0.62 * Math.max(0.05, fill));
      p.hint.style.visibility = full ? "visible" : "hidden";
    },
    flash(side) {
      const p = pipes[side];
      if (!p) return;
      p.el.classList.remove("pt-flash");
      void p.el.offsetWidth;
      p.el.classList.add("pt-flash");
      clearTimeout(p.flashTimer);
      p.flashTimer = window.setTimeout(() => p.el.classList.remove("pt-flash"), 800);
    },
    ghost(id, at) {
      let i = ghostIds.indexOf(id);
      if (!at) {
        if (i >= 0) {
          ghosts[i]!.style.display = "none";
          ghostIds[i] = -1;
        }
        return;
      }
      if (i < 0) {
        i = ghostIds.indexOf(-1);
        if (i < 0 && ghosts.length < MAX_GHOSTS) {
          ghosts.push(ghostEl());
          ghostIds.push(-1);
          i = ghosts.length - 1;
        }
        if (i < 0) return;
        ghostIds[i] = id;
      }
      const el = ghosts[i]!;
      el.style.display = "block";
      el.style.left = u(at.x);
      el.style.top = u(at.y);
    },
    slices(marks, fam) {
      const key = `${fam}:${marks.map((m) => `${Math.round(m.x)}=${m.value}`).join(",")}`;
      if (key === sliceKey) return;
      sliceKey = key;
      sliceLayer.replaceChildren();
      if (fam === "life") return;
      const labels = marks.map((m) => presetLabel(fam, m.value));
      const spots = sliceMarks(
        layout.venue,
        marks.map((m) => m.x),
        Array.from({ length: presetCount(fam) }, (_, i) => presetLabel(fam, i)),
      );
      spots.forEach((spot, i) => {
        const el = document.createElement("div");
        el.className = "pt-slice";
        place(el, spot.icon, unit);
        el.style.opacity = "0.75";
        el.innerHTML = presetIcon(fam, marks[i]!.value, "#bcd9e2");
        const label = document.createElement("div");
        label.className = "pt-slice pt-label";
        place(label, spot.label, unit);
        const text = labels[i]!;
        label.style.font = `800 ${fitFont(text, spot.font * unit, spot.label.width * unit)}px ${FONT}`;
        label.style.color = "rgba(200,224,232,0.85)";
        label.textContent = text;
        sliceLayer.append(el, label);
      });
    },
    dispose() {
      for (const p of pipes) if (p) clearTimeout(p.flashTimer);
      for (const r of resets) r.remove();
      layer.remove();
    },
  };
};
