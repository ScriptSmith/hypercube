import type { OptionValues, Palette, Rect } from "../../core/types";
import { iconSvg, withAlpha } from "../../core/ui";
import type { Offer } from "./catalog";
import {
  canStep,
  controlFor,
  launchArgs,
  mergeOptions,
  shownKeys,
  startVariant,
  stepValue,
  valueLabel,
  variantChoices,
  visitorOptions,
} from "./choices";
import { type ControlShape, layoutChoose } from "./chooselayout";
import { div, fitLabel, place, px, shrink } from "./dom";
import type { MenuFrame } from "./layout";

/** What the visitor has picked so far. */
export interface ChooseState {
  variant: string | undefined;
  changes: OptionValues;
}

export interface ChooseHandle {
  readonly el: HTMLElement;
  /** Index of the control at a point, or -1. */
  hit(x: number, y: number): number;
  activate(index: number): void;
  showArmed(armed: ReadonlySet<number>): void;
  state(): ChooseState;
}

export interface ChooseOptions {
  frame: MenuFrame;
  offer: Offer;
  palette: Palette;
  anchorX?: number;
  initial?: ChooseState;
  onPlay(args: { variant?: string; options: OptionValues }): void;
  onBack(): void;
  /** A choice showed or hid other options; rebuild the step from this state. */
  onReshape?(state: ChooseState): void;
}

const svgLine = (d: string) =>
  `<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true"><path d="${d}" ` +
  'fill="none" stroke="currentColor" stroke-width="12" stroke-linecap="round" ' +
  'stroke-linejoin="round"/></svg>';
const MINUS = svgLine("M24 50H76");
const PLUS = svgLine("M24 50H76M50 24V76");
const BACK = svgLine("M60 20L30 50L60 80");

export const chooseCss = (p: Palette): string => `
.mn-choose{position:absolute;inset:0;animation:mn-fade 0.3s ease-out both;}
.mn-head{position:absolute;transform:translate(-50%,-50%);text-align:center;font-weight:800;
line-height:1.08;text-wrap:balance;pointer-events:none;text-shadow:0 0 0.4em rgba(0,0,0,0.6);}
.mn-head-sub{display:block;font-size:0.62em;color:${p.accent};margin-top:0.15em;}
.mn-t{position:absolute;box-sizing:border-box;transition:transform 0.12s ease-out,
background 0.2s,border-color 0.2s,color 0.2s;}
.mn-t.is-pressed{transform:scale(0.96);}
.mn-opt{display:flex;flex-direction:column;justify-content:center;overflow:hidden;
background:#0d1220;border-style:solid;border-color:${withAlpha(p.foreground, 0.16)};}
.mn-opt.is-on{border-color:${p.accent};background:#1c1a10;}
.mn-opt-title{font-weight:800;line-height:1.1;overflow:hidden;white-space:nowrap;
flex:none;}
.mn-opt-blurb{font-weight:500;line-height:1.22;color:${withAlpha(p.foreground, 0.78)};
overflow:hidden;overflow-wrap:normal;}
.mn-check{position:absolute;color:${p.accent};opacity:0;transition:opacity 0.2s;}
.mn-opt.is-on .mn-check{opacity:1;}
.mn-olabel{position:absolute;box-sizing:border-box;display:flex;align-items:center;
font-weight:700;line-height:1.1;color:${withAlpha(p.foreground, 0.88)};overflow:hidden;
overflow-wrap:normal;}
.mn-seg{display:flex;align-items:center;justify-content:center;overflow:hidden;
white-space:nowrap;font-weight:800;text-align:center;line-height:1.05;overflow-wrap:normal;background:#0d1220;border-style:solid;
border-color:${withAlpha(p.foreground, 0.24)};}
.mn-seg.is-on{background:${p.accent};border-color:${p.accent};color:${p.background};}
.mn-seg.is-off{opacity:0.3;}
.mn-val{position:absolute;display:flex;align-items:center;justify-content:center;
font-weight:800;white-space:nowrap;overflow:hidden;pointer-events:none;}
.mn-toggle{background:#0d1220;border-style:solid;border-color:${withAlpha(p.foreground, 0.24)};}
.mn-toggle.is-on{background:${p.accent};border-color:${p.accent};}
.mn-knob{position:absolute;border-radius:50%;background:${p.foreground};
transition:left 0.2s ease-out;}
.mn-toggle.is-on .mn-knob{background:${p.background};}
.mn-act{display:flex;align-items:center;justify-content:center;font-weight:800;
white-space:nowrap;border-style:solid;}
.mn-act span{display:inline-flex;}
.mn-play{background:${p.accent};border-color:${p.accent};color:${p.background};
box-shadow:0 0 0.6em ${withAlpha(p.accent, 0.4)};}
.mn-play.is-chosen{transform:scale(1.05);box-shadow:0 0 1.2em ${withAlpha(p.accent, 0.7)};}
.mn-back{background:${withAlpha(p.background, 0.7)};border-color:${withAlpha(p.foreground, 0.45)};
color:${p.foreground};}
@keyframes mn-fade{from{opacity:0;}to{opacity:1;}}
`;

interface Target {
  rect: Rect;
  el: HTMLElement;
  act(): void;
}

/** The step between tapping a tile and playing: variants, visitor options, Play and Back. */
export const createChoose = (opts: ChooseOptions): ChooseHandle => {
  const { frame: f, offer } = opts;
  const app = offer.app;
  const u = f.unit;
  const variants = variantChoices(offer);
  const state: ChooseState = {
    variant: opts.initial?.variant ?? startVariant(offer),
    changes: { ...opts.initial?.changes },
  };
  const current = () => mergeOptions(app, state.changes, f.kind);
  const defs = visitorOptions(app, f.kind, current());
  const shown = shownKeys(app, f.kind, current());
  const controls = defs.map(controlFor);
  const shapes: ControlShape[] = controls.map((c) =>
    c.kind === "segments" ? { kind: "segments", count: c.values.length } : c,
  );
  const layout = layoutChoose(f, {
    variants: variants.length,
    controls: shapes,
    anchorX: opts.anchorX,
  });
  const border = px(Math.max(2, 5 * u));
  const targets: Target[] = [];
  const updates: (() => void)[] = [];
  const el = div("mn-choose");

  const target = (className: string, rect: Rect, act: () => void, radius = layout.radius) => {
    const t = div(`mn-t ${className}`);
    place(t, rect);
    t.style.borderRadius = px(radius);
    t.style.borderWidth = border;
    el.append(t);
    targets.push({ rect, el: t, act });
    return t;
  };

  const head = div("mn-head", app.title);
  head.style.left = px(layout.header.x);
  // A preset adds its variant on a second line; lift the pair so it clears the controls.
  head.style.top = px(layout.header.y - (offer.variant ? layout.header.size * 0.4 : 0));
  head.style.maxWidth = px(layout.header.width);
  head.style.width = "max-content";
  head.style.fontSize = px(layout.header.size);
  if (offer.variant) head.append(div("mn-head-sub", offer.variant.title));
  el.append(head);

  const text = layout.text;
  const pad = text.variantTitle * 0.55;
  variants.forEach((v, i) => {
    const r = layout.variants[i];
    if (!r) return;
    const t = target("mn-opt", r, () => {
      state.variant = v.id;
      update();
    });
    const check = div("mn-check");
    const c = Math.min(r.height * 0.4, text.variantTitle * 1.2);
    place(check, { x: r.width - pad * 0.6 - c, y: (r.height - c) / 2, width: c, height: c });
    check.innerHTML = iconSvg("check");
    t.style.padding = `${px(pad * 0.5)} ${px(pad * 1.2 + c)} ${px(pad * 0.5)} ${px(pad)}`;
    const title = div("mn-opt-title", v.title);
    title.style.fontSize = px(text.variantTitle);
    t.append(title, check);
    if (v.blurb) {
      const blurb = div("mn-opt-blurb", v.blurb);
      blurb.style.fontSize = px(text.blurb);
      blurb.style.maxHeight = px(Math.max(0, r.height - pad - text.variantTitle * 1.2));
      t.append(blurb);
    }
    updates.push(() => t.classList.toggle("is-on", state.variant === v.id));
  });

  const set = (key: string, value: OptionValues[string]) => {
    state.changes[key] = value;
    // An option that shows or hides others needs a new layout.
    if (opts.onReshape && shownKeys(app, f.kind, current()) !== shown)
      opts.onReshape(choiceState());
    else update();
  };

  defs.forEach((def, i) => {
    const spot = layout.controls[i];
    const control = controls[i];
    if (!spot || !control) return;
    const label = div("mn-olabel", def.title);
    place(label, spot.label);
    label.style.fontSize = px(text.label);
    label.style.paddingRight = px(text.label * 0.3);
    el.append(label);
    if (control.kind === "segments") {
      control.values.forEach((v, j) => {
        const r = spot.parts[j];
        if (!r) return;
        const seg = target(
          "mn-seg",
          r,
          () => set(def.key, v.value),
          Math.min(r.height, r.width) / 2,
        );
        seg.textContent = v.label;
        seg.dataset.row = String(i);
        seg.style.fontSize = px(text.control);
        seg.style.padding = `0 ${px(text.control * 0.15)}`;
        updates.push(() => seg.classList.toggle("is-on", current()[def.key] === v.value));
      });
    } else if (control.kind === "stepper") {
      const [minusR, valueR, plusR] = spot.parts;
      if (!minusR || !valueR || !plusR) return;
      const step = (dir: -1 | 1) => () =>
        set(def.key, stepValue(def, current()[def.key] ?? def.default, dir));
      const minus = target("mn-seg", minusR, step(-1), minusR.height / 2);
      const plus = target("mn-seg", plusR, step(1), plusR.height / 2);
      for (const [b, icon] of [
        [minus, MINUS],
        [plus, PLUS],
      ] as const) {
        const span = document.createElement("span");
        span.style.cssText = `display:inline-flex;width:${px(minusR.height * 0.5)};height:${px(minusR.height * 0.5)};`;
        span.innerHTML = icon;
        b.append(span);
      }
      const value = div("mn-val");
      place(value, valueR);
      value.style.fontSize = px(text.control * 1.15);
      el.append(value);
      updates.push(() => {
        const now = current()[def.key] ?? def.default;
        value.textContent = valueLabel(def, now);
        minus.classList.toggle("is-off", !canStep(def, now, -1));
        plus.classList.toggle("is-off", !canStep(def, now, 1));
      });
    } else {
      const r = spot.parts[0];
      if (!r) return;
      const toggle = target("mn-toggle", r, () => set(def.key, !current()[def.key]), r.height / 2);
      const inset = r.height * 0.12;
      const knob = div("mn-knob");
      const k = r.height - 2 * inset - 2 * Math.max(2, 5 * u);
      knob.style.width = px(k);
      knob.style.height = px(k);
      knob.style.top = px(inset);
      toggle.append(knob);
      updates.push(() => {
        const on = current()[def.key] === true;
        toggle.classList.toggle("is-on", on);
        knob.style.left = px(on ? r.width - k - inset - 2 * Math.max(2, 5 * u) : inset);
      });
    }
  });

  const action = (className: string, r: Rect, icon: string, word: string, act: () => void) => {
    const t = target(`mn-act ${className}`, r, act, Math.min(r.height, r.width) / 2);
    const size = Math.min(r.height * 0.42, text.control * 1.2);
    t.style.fontSize = px(size);
    t.style.gap = px(size * 0.35);
    const span = document.createElement("span");
    span.style.cssText = `width:${px(size)};height:${px(size)};`;
    span.innerHTML = icon;
    const word_ = document.createElement("span");
    word_.textContent = word;
    t.append(span, word_);
    return t;
  };
  action("mn-back", layout.back, BACK, "Back", () => opts.onBack());
  const play = action("mn-play", layout.play, iconSvg("play"), "Play", () => {
    play.classList.add("is-chosen");
    opts.onPlay(launchArgs(offer, state.variant, state.changes, f.kind));
  });

  function update() {
    for (const fn of updates) fn();
  }
  update();

  function choiceState(): ChooseState {
    return { variant: state.variant, changes: { ...state.changes } };
  }

  return {
    el,
    hit(x, y) {
      return targets.findIndex(
        (t) =>
          x >= t.rect.x &&
          x <= t.rect.x + t.rect.width &&
          y >= t.rect.y &&
          y <= t.rect.y + t.rect.height,
      );
    },
    activate(index) {
      targets[index]?.act();
    },
    showArmed(armed) {
      targets.forEach((t, i) => t.el.classList.toggle("is-pressed", armed.has(i)));
    },
    state: choiceState,
  };
};

/** Fit the step's text once its element is in the document. */
export const fitChoose = (handle: ChooseHandle): void => {
  const root = handle.el;
  for (const t of root.querySelectorAll<HTMLElement>(".mn-opt-title, .mn-seg, .mn-olabel")) {
    const size = Number.parseFloat(t.style.fontSize || getComputedStyle(t).fontSize);
    // Option labels and segments may wrap onto two lines; variant titles stay on one.
    if (t.classList.contains("mn-opt-title")) shrink(t, size, size * 0.6, true);
    else fitLabel(t, size);
  }
  // Segments in a row share the size of the one that had to shrink most.
  const rows = new Map<string, HTMLElement[]>();
  for (const t of root.querySelectorAll<HTMLElement>(".mn-seg[data-row]")) {
    const key = t.dataset.row ?? "";
    rows.set(key, [...(rows.get(key) ?? []), t]);
  }
  for (const segs of rows.values()) {
    const size = Math.min(...segs.map((t) => Number.parseFloat(t.style.fontSize)));
    for (const t of segs) t.style.fontSize = px(size);
  }
  // Blurbs share the size of the one that had to shrink most, so the tiles look alike.
  const blurbs = [...root.querySelectorAll<HTMLElement>(".mn-opt-blurb")];
  let smallest = Number.POSITIVE_INFINITY;
  for (const t of blurbs) {
    const size = Number.parseFloat(getComputedStyle(t).fontSize);
    t.style.height = t.style.maxHeight;
    shrink(t, size, size * 0.6);
    t.style.height = "";
    smallest = Math.min(smallest, Number.parseFloat(t.style.fontSize));
  }
  for (const t of blurbs) t.style.fontSize = px(smallest);
};
