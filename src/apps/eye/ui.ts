/**
 * The frame's DOM: the caption card and More, the view caption and labels, sliders, condition
 * tiles, buttons, part chips, the magnified mosaic and the ghost hand. None of it takes pointer
 * events: frame.ts hit-tests touches against the layout itself (controls.ts), so fingers and
 * bots go through one path and a person's press can be told from a bot's. Elements change only
 * when what they show changes.
 */
import { FONT } from "../../core/ui";
import type { ConditionId, PartId } from "./captions";
import { CONDITIONS, PARTS } from "./captions";
import { ACCENT, EDGE, INK, MUTED, PANEL } from "./config";
import { fitElement } from "./fit";
import { CONDITION_ICONS, ICONS } from "./icons";
import type { ButtonId, Layout, Rect, SliderId } from "./layout";
import { CONDITION_ORDER } from "./model";
import { drawMosaic, type MosaicMode } from "./mosaic";
import type { CvdType } from "./colour";

export interface SliderLook {
  id: SliderId;
  label: string;
  /** 0 to 1 along the track. */
  value: number;
  text: string | null;
  held: boolean;
}

export interface ToggleLook {
  label: string;
  on: boolean;
  icon?: string;
}

export interface UiLook {
  condition: ConditionId;
  sliders: SliderLook[];
  looking: "near" | "far";
  corrA: ToggleLook | null;
  corrB: ToggleLook | null;
  card: { title: string; text: string; page: number; pages: number };
  viewCaption: string | null;
  viewTags: (string | null)[];
  part: PartId | null;
  /** Only the chosen part shows. */
  isolate: boolean;
  inset: {
    mode: MosaicMode;
    title: string;
    cvd: { type: CvdType; strength: number } | null;
  } | null;
  readout: string | null;
  exaggerated: string | null;
  /** Venue px. */
  hand: { x: number; y: number; press: number } | null;
}

export interface Ui {
  update(look: UiLook): void;
  dispose(): void;
}

const MAX_INSET_PX = 720;

/**
 * Shrink `el`'s font from `max` until its text fits across and down inside `box`, not below
 * `min`. The text goes in an inner span, whose own width shows overflow exactly, centred or not.
 * Returns false when it still overflows at `min`.
 */
const fitLabel = (
  el: HTMLElement,
  box: HTMLElement,
  max: number,
  min: number,
  pad: number,
): boolean => {
  let span = el.firstElementChild as HTMLElement | null;
  if (!span || span.tagName !== "SPAN") {
    span = document.createElement("span");
    span.textContent = el.textContent;
    el.textContent = "";
    el.append(span);
  }
  const inner = span;
  const fits = () =>
    inner.getBoundingClientRect().width <= el.getBoundingClientRect().width + 0.5 &&
    el.scrollHeight <= box.clientHeight - pad;
  let size = max;
  el.style.fontSize = `${size}px`;
  while (!fits() && size > min) {
    size = Math.max(min, size * 0.93);
    el.style.fontSize = `${size}px`;
  }
  return fits();
};

export const createUi = (root: HTMLElement, layout: Layout, unit: number): Ui => {
  const u = unit;
  const px = (v: number) => `${v * u}px`;
  const layer = document.createElement("div");
  layer.style.cssText =
    `position:absolute;inset:0;pointer-events:none;z-index:2;font-family:${FONT};color:${INK};` +
    "user-select:none;-webkit-user-select:none;overflow:hidden;";
  root.append(layer);
  const place = (el: HTMLElement, r: Rect) => {
    el.style.position = "absolute";
    el.style.left = px(r.x);
    el.style.top = px(r.y);
    el.style.width = px(r.width);
    el.style.height = px(r.height);
    el.style.boxSizing = "border-box";
    return el;
  };
  const div = (r: Rect | null, css = "") => {
    const el = document.createElement("div");
    if (r) place(el, r);
    el.style.cssText += css;
    layer.append(el);
    return el;
  };
  const T = layout.text;
  const radius = (r: Rect) => `${Math.min(r.width, r.height) * 0.22 * u}px`;

  // ---- Caption card and More --------------------------------------------------------------
  const card = div(
    layout.card,
    `background:${PANEL};border:${Math.max(1, 3 * u)}px solid ${EDGE};border-radius:${radius(layout.card)};` +
      `padding:${px(T.caption * 0.55)} ${px(T.caption * 0.8)};overflow:hidden;line-height:1.24;`,
  );
  card.dataset.eye = "card";
  const cardTitle = document.createElement("div");
  cardTitle.style.cssText = `font-weight:800;color:${ACCENT};margin-bottom:0.3em;font-size:1.32em;`;
  const cardText = document.createElement("div");
  cardText.style.cssText = "font-weight:550;";
  card.append(cardTitle, cardText);
  const more = div(
    layout.more,
    `display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${px(8)};` +
      `border-radius:${radius(layout.more)};font-weight:800;font-size:${px(T.label)};`,
  );
  more.dataset.eye = "more";
  const moreLabel = document.createElement("div");
  moreLabel.textContent = "More";
  const dots = document.createElement("div");
  dots.style.cssText = `display:flex;gap:${px(8)};`;
  more.append(moreLabel, dots);

  // ---- Views: caption, tags, labels ------------------------------------------------------
  const viewCaption = layout.viewCaption
    ? div(
        layout.viewCaption,
        `display:flex;align-items:center;padding:0 ${px(T.view * 0.4)};font-weight:550;` +
          `line-height:1.24;color:${INK};overflow:hidden;`,
      )
    : null;
  if (viewCaption) viewCaption.dataset.eye = "view-caption";
  const viewTags = layout.views.map((v) => {
    const el = div(
      null,
      `position:absolute;left:${px(v.rect.x + 12)};top:${px(v.rect.y + 12)};padding:${px(6)} ${px(16)};` +
        `border-radius:${px(40)};background:rgba(8,12,22,0.72);font-weight:700;font-size:${px(T.label)};` +
        "display:none;white-space:nowrap;",
    );
    return el;
  });
  for (const v of layout.views) {
    if (!v.label) continue;
    const el = div(
      null,
      `position:absolute;left:${px(v.rect.x)};top:${px(v.rect.y - T.title * 1.35)};` +
        `font-weight:800;font-size:${px(T.title)};color:${v.typical ? MUTED : ACCENT};white-space:nowrap;`,
    );
    el.textContent = v.label;
  }
  for (const v of layout.views) {
    div(v.rect, `border:${Math.max(1, 3 * u)}px solid ${EDGE};border-radius:${px(10)};`);
  }

  // ---- Sliders ------------------------------------------------------------------------------
  const sliders = layout.sliderSlots.map((r) => {
    const box = div(r, "display:none;");
    const label = document.createElement("div");
    label.style.cssText =
      `position:absolute;left:${px(8)};top:0;font-weight:700;font-size:${px(T.label)};` +
      `white-space:nowrap;color:${INK};`;
    const value = document.createElement("div");
    value.style.cssText =
      `position:absolute;right:${px(8)};top:0;font-weight:600;font-size:${px(T.label)};` +
      `white-space:nowrap;color:${MUTED};font-variant-numeric:tabular-nums;`;
    const trackY = r.height * 0.68;
    const knobR = Math.min(r.height * 0.3, 40);
    const track = document.createElement("div");
    track.style.cssText =
      `position:absolute;left:${px(knobR)};right:${px(knobR)};top:${px(trackY - 7)};height:${px(14)};` +
      `border-radius:${px(7)};background:rgba(150,170,210,0.25);`;
    const fill = document.createElement("div");
    fill.style.cssText = `position:absolute;left:0;top:0;bottom:0;border-radius:${px(7)};background:${ACCENT};opacity:0.75;`;
    track.append(fill);
    const knob = document.createElement("div");
    knob.style.cssText =
      `position:absolute;top:${px(trackY - knobR)};width:${px(2 * knobR)};height:${px(2 * knobR)};` +
      `margin-left:${px(-knobR)};border-radius:50%;background:${INK};` +
      `box-shadow:0 0 ${px(18)} rgba(255,210,58,0.35);border:${px(5)} solid ${ACCENT};box-sizing:border-box;`;
    box.append(label, value, track, knob);
    return { box, label, value, fill, knob, knobR, width: r.width, last: "" };
  });

  // ---- Tiles --------------------------------------------------------------------------------
  const tiles = layout.tiles.map((r, i) => {
    const id = CONDITION_ORDER[i] ?? "typical";
    const c = CONDITIONS.find((x) => x.id === id)!;
    const el = div(
      r,
      `border-radius:${radius(r)};display:flex;flex-direction:column;align-items:center;` +
        `justify-content:center;gap:${px(4)};padding:${px(6)};text-align:center;`,
    );
    el.dataset.eye = `tile-${id}`;
    const icon = document.createElement("div");
    const iconSize = Math.min(r.height * 0.5, r.width * 0.55);
    icon.style.cssText = `width:${px(iconSize)};height:${px(iconSize)};flex:none;`;
    icon.innerHTML = CONDITION_ICONS[id];
    const label = document.createElement("div");
    label.textContent = c.tile;
    label.style.cssText =
      `font-weight:700;line-height:1.05;font-size:${px(T.tile)};max-width:100%;` +
      "overflow:hidden;overflow-wrap:normal;word-break:keep-all;";
    el.append(icon, label);
    return { el, id, label, iconSize, last: "" };
  });

  for (const t of tiles) {
    // The label gets what the icon leaves.
    t.label.style.maxHeight = px(layout.tiles[0]!.height - t.iconSize - 14);
    fitLabel(t.label, t.label, T.tile * u, T.min * 0.85 * u, 0);
  }

  // ---- Buttons ------------------------------------------------------------------------------
  const buttons = new Map<
    ButtonId,
    { el: HTMLElement; label: HTMLElement; icon: HTMLElement; last: string }
  >();
  for (const [id, r] of Object.entries(layout.buttons) as [ButtonId, Rect][]) {
    const el = div(
      r,
      `border-radius:${radius(r)};display:flex;align-items:center;justify-content:center;` +
        `gap:${px(10)};padding:0 ${px(10)};text-align:center;font-weight:800;line-height:1.05;`,
    );
    el.dataset.eye = `button-${id}`;
    const icon = document.createElement("div");
    const iconSize = Math.min(r.height * 0.42, 70);
    icon.style.cssText = `width:${px(iconSize)};height:${px(iconSize)};flex:none;`;
    const label = document.createElement("div");
    label.style.cssText =
      `font-size:${px(T.label)};flex:1 1 auto;min-width:0;max-height:100%;overflow:hidden;` +
      "word-break:keep-all;";
    el.style.overflow = "hidden";
    el.append(icon, label);
    buttons.set(id, { el, label, icon, last: "" });
  }
  const setButton = (id: ButtonId, look: ToggleLook | null, icon: string | null) => {
    const b = buttons.get(id);
    if (!b) return;
    const key = look ? `${look.label}|${look.on}|${icon}` : "hidden";
    if (key === b.last) return;
    b.last = key;
    if (!look) {
      b.el.style.display = "none";
      return;
    }
    b.el.style.display = "flex";
    b.label.textContent = look.label;
    b.icon.innerHTML = icon ?? "";
    b.icon.style.display = icon ? "block" : "none";
    // Long labels wrap and shrink; if one still overflows, it takes the icon's room.
    if (!fitLabel(b.label, b.el, T.label * u, T.min * u, 6 * u) && icon) {
      b.icon.style.display = "none";
      fitLabel(b.label, b.el, T.label * u, T.min * u, 6 * u);
    }
    b.el.style.background = look.on ? ACCENT : PANEL;
    b.el.style.color = look.on ? "#101418" : INK;
    b.el.style.border = `${Math.max(1, 4 * u)}px solid ${look.on ? ACCENT : EDGE}`;
    b.el.setAttribute("aria-pressed", look.on ? "true" : "false");
  };

  // ---- Part chips (wall) -------------------------------------------------------------------
  const chips = layout.chips.map((r, i) => {
    const p = PARTS[i]!;
    const el = div(
      r,
      `border-radius:${radius(r)};display:flex;align-items:center;justify-content:center;` +
        `text-align:center;font-weight:700;line-height:1.08;padding:0 ${px(12)};font-size:${px(T.tile)};`,
    );
    const label = document.createElement("div");
    label.textContent = p.name;
    label.style.cssText = "max-width:100%;overflow:hidden;word-break:keep-all;";
    el.append(label);
    el.dataset.eye = `chip-${p.id}`;
    el.style.overflow = "hidden";
    return { el, label, id: p.id, last: "" };
  });

  for (const c of chips) fitLabel(c.label, c.el, T.tile * u, T.min * 0.85 * u, 0);

  // ---- Eye labels, inset, hand -------------------------------------------------------------
  const readout = div(
    null,
    `position:absolute;left:${px(layout.eye.x + 24)};top:${px(layout.eye.y + 20)};` +
      `font-weight:700;font-size:${px(T.label)};color:${INK};white-space:nowrap;` +
      `text-shadow:0 0 ${px(8)} rgba(0,0,0,0.9);font-variant-numeric:tabular-nums;`,
  );
  readout.dataset.eye = "readout";
  const exaggerated = div(
    null,
    `position:absolute;left:${px(layout.eye.x + 24)};top:${px(layout.eye.y + 20 + T.label * 1.45)};` +
      `font-weight:600;font-size:${px(T.label * 0.85)};color:${MUTED};white-space:nowrap;display:none;`,
  );
  const inset = div(
    layout.inset,
    `border-radius:${px(16)};border:${Math.max(1, 3 * u)}px solid ${EDGE};background:${PANEL};` +
      "overflow:hidden;display:none;",
  );
  const insetTitle = document.createElement("div");
  insetTitle.style.cssText =
    `position:absolute;left:0;right:0;top:0;padding:${px(6)} ${px(12)};font-weight:700;` +
    `font-size:${px(T.label * 0.85)};background:rgba(8,12,22,0.8);z-index:1;white-space:nowrap;`;
  const insetCanvas = document.createElement("canvas");
  const insetPx = Math.min(
    MAX_INSET_PX,
    Math.round(layout.inset.width * u * Math.min(2, window.devicePixelRatio || 1)),
  );
  insetCanvas.width = insetPx;
  insetCanvas.height = insetPx;
  insetCanvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
  const legend = document.createElement("div");
  legend.style.cssText =
    `position:absolute;left:0;right:0;bottom:0;padding:${px(6)} ${px(12)};display:flex;gap:${px(18)};` +
    `font-weight:700;font-size:${px(T.label * 0.75)};background:rgba(8,12,22,0.8);z-index:1;`;
  const dot = (c: string) =>
    `<span style="display:inline-block;width:0.7em;height:0.7em;border-radius:50%;background:${c};margin-right:0.3em"></span>`;
  legend.innerHTML = `<span>${dot("#e0705a")}${dot("#6cbf6a")}${dot("#5a86e0")}Cones</span><span>${dot("#b9bfcc")}Rods</span>`;
  inset.append(insetCanvas, insetTitle, legend);
  const insetG = insetCanvas.getContext("2d");
  const hand = div(
    null,
    `position:absolute;width:${px(110)};height:${px(132)};display:none;z-index:4;` +
      "transform-origin:36% 6%;opacity:0.9;",
  );
  hand.innerHTML = ICONS.hand;

  // Fit labels again once the page has settled (sizes can still change on the first frames).
  const born = performance.now();
  let refitted = false;
  let last = {
    card: "",
    view: "",
    tags: "",
    readout: "",
    exaggerated: "",
    inset: "",
    pages: "",
  };

  return {
    update(look) {
      if (!refitted && performance.now() - born > 800) {
        refitted = true;
        for (const b of buttons.values()) b.last = "";
        for (const t of tiles) fitLabel(t.label, t.label, T.tile * u, T.min * 0.85 * u, 0);
        for (const c of chips) fitLabel(c.label, c.el, T.tile * u, T.min * 0.85 * u, 0);
      }
      // Card.
      const cardKey = `${look.card.title}|${look.card.text}`;
      if (cardKey !== last.card) {
        last.card = cardKey;
        cardTitle.textContent = look.card.title;
        cardText.textContent = look.card.text;
        fitElement(card, T.caption * u, T.min * u);
      }
      const pagesKey = `${look.card.page}/${look.card.pages}`;
      if (pagesKey !== last.pages) {
        last.pages = pagesKey;
        const show = look.card.pages > 1;
        more.style.display = show ? "flex" : "none";
        more.style.background = PANEL;
        more.style.border = `${Math.max(1, 4 * u)}px solid ${EDGE}`;
        dots.innerHTML = "";
        for (let i = 0; i < Math.min(8, look.card.pages); i++) {
          const d = document.createElement("span");
          d.style.cssText =
            `width:${px(12)};height:${px(12)};border-radius:50%;` +
            `background:${i === look.card.page ? ACCENT : "rgba(200,210,230,0.35)"};`;
          dots.append(d);
        }
      }
      // View caption and tags.
      if (viewCaption && (look.viewCaption ?? "") !== last.view) {
        last.view = look.viewCaption ?? "";
        viewCaption.textContent = last.view;
        fitElement(viewCaption, T.view * u, T.min * u);
      }
      const tagsKey = look.viewTags.join("|");
      if (tagsKey !== last.tags) {
        last.tags = tagsKey;
        viewTags.forEach((el, i) => {
          const t = look.viewTags[i] ?? null;
          el.style.display = t ? "block" : "none";
          el.textContent = t ?? "";
        });
      }
      // Sliders.
      sliders.forEach((s, i) => {
        const l = look.sliders[i];
        const key = l ? `${l.label}|${l.value.toFixed(4)}|${l.text}|${l.held}` : "hidden";
        if (key === s.last) return;
        s.last = key;
        if (!l) {
          s.box.style.display = "none";
          return;
        }
        s.box.style.display = "block";
        s.box.dataset.eye = `slider-${l.id}`;
        s.label.textContent = l.label;
        s.value.textContent = l.text ?? "";
        const v = Math.min(1, Math.max(0, l.value));
        const span = s.width - 2 * s.knobR;
        s.knob.style.left = px(s.knobR + v * span);
        s.fill.style.width = `${v * 100}%`;
        s.knob.style.transform = l.held ? "scale(1.12)" : "";
      });
      // Tiles.
      for (const t of tiles) {
        const on = t.id === look.condition;
        const key = on ? "on" : "off";
        if (key === t.last) continue;
        t.last = key;
        t.el.style.background = on ? ACCENT : PANEL;
        t.el.style.color = on ? "#101418" : INK;
        t.el.style.border = `${Math.max(1, 4 * u)}px solid ${on ? ACCENT : EDGE}`;
        t.el.setAttribute("aria-pressed", on ? "true" : "false");
      }
      setButton("near", { label: "Near", on: look.looking === "near" }, ICONS.near);
      setButton("far", { label: "Far", on: look.looking === "far" }, ICONS.far);
      setButton("corrA", look.corrA, look.corrA?.icon ?? null);
      setButton("corrB", look.corrB, look.corrB?.icon ?? null);
      setButton("next", { label: "Next part", on: false }, ICONS.next);
      setButton("prev", { label: "Previous part", on: false }, ICONS.prev);
      setButton(
        "only",
        look.part
          ? { label: look.isolate ? "Show all" : "Only this part", on: look.isolate }
          : null,
        null,
      );
      for (const c of chips) {
        const on = c.id === look.part;
        const key = on ? "on" : "off";
        if (key === c.last) continue;
        c.last = key;
        c.el.style.background = on ? ACCENT : PANEL;
        c.el.style.color = on ? "#101418" : INK;
        c.el.style.border = `${Math.max(1, 4 * u)}px solid ${on ? ACCENT : EDGE}`;
      }
      if ((look.readout ?? "") !== last.readout) {
        last.readout = look.readout ?? "";
        readout.textContent = last.readout;
      }
      if ((look.exaggerated ?? "") !== last.exaggerated) {
        last.exaggerated = look.exaggerated ?? "";
        exaggerated.textContent = last.exaggerated;
        exaggerated.style.display = look.exaggerated ? "block" : "none";
      }
      const insetKey = look.inset
        ? `${look.inset.mode}|${look.inset.title}|${look.inset.cvd?.type}|${look.inset.cvd?.strength.toFixed(2)}`
        : "";
      if (insetKey !== last.inset) {
        last.inset = insetKey;
        inset.style.display = look.inset ? "block" : "none";
        if (look.inset && insetG) {
          insetTitle.textContent = look.inset.title;
          drawMosaic(insetG, insetPx, look.inset.mode, look.inset.cvd);
        }
      }
      if (look.hand) {
        hand.style.display = "block";
        hand.style.left = px(look.hand.x - 110 * 0.36);
        hand.style.top = px(look.hand.y - 132 * 0.06);
        hand.style.transform = `scale(${1 - 0.12 * look.hand.press})`;
      } else hand.style.display = "none";
    },
    dispose() {
      layer.remove();
      last = { card: "", view: "", tags: "", readout: "", exaggerated: "", inset: "", pages: "" };
    },
  };
};
