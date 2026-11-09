/**
 * Linked formulas: each part of a chapter's formula is coloured like its counterpart in the
 * figure, and touching either makes both pulse.
 *
 * `createLink` is the pure part: which part was touched and how strongly it pulses now. The
 * chapter's figure asks `link.level(part)` while drawing and calls `link.touch(part)` when a
 * finger lands on a linked element. The fold's DOM (`createFold`) does the same for the formula
 * and reports where each part sits, so the card can hit-test it.
 */
import { FONT } from "../../core/ui/style";
import { withAlpha } from "../../core/ui/palette";
import type { FormulaRun, MathsText } from "./captions";
import { COLOR } from "./config";
import type { Rect, TypeScale } from "./layout";

/** How long one touch pulses, ms. */
export const PULSE_MS = 2400;

export interface Link {
  touch(part: string, now: number): void;
  /** 0 when idle; rises to 1 and beats while the part pulses. */
  level(part: string, now: number): number;
  /** The part pulsing now, if any. */
  active(now: number): string | null;
  reset(): void;
}

export const createLink = (): Link => {
  let part: string | null = null;
  let at = Number.NEGATIVE_INFINITY;
  return {
    touch(p, now) {
      part = p;
      at = now;
    },
    level(p, now) {
      if (p !== part) return 0;
      const t = now - at;
      if (t < 0 || t > PULSE_MS) return 0;
      const fade = t > PULSE_MS - 500 ? (PULSE_MS - t) / 500 : 1;
      // Three beats over the pulse.
      return fade * (0.55 + 0.45 * Math.cos((t / PULSE_MS) * Math.PI * 6) ** 2);
    },
    active(now) {
      return part !== null && now - at <= PULSE_MS ? part : null;
    },
    reset() {
      part = null;
      at = Number.NEGATIVE_INFINITY;
    },
  };
};

/** Line width or glow multiplier for a linked element: 1 normally, up to 1 + extra when pulsing. */
export const emphasis = (link: Link, part: string, now: number, extra = 1.4): number =>
  1 + extra * link.level(part, now);

/**
 * Alpha for a linked element: full when it or nothing pulses, dimmed while another part pulses,
 * so the counterpart stands out.
 */
export const presence = (link: Link, part: string, now: number): number => {
  const a = link.active(now);
  return a === null || a === part ? 1 : 0.35;
};

const isVariable = (r: FormulaRun) => r.italic ?? /^[A-Za-zα-ωΑ-Ω]$/.test(r.t.trim());

export interface Fold {
  readonly el: HTMLElement;
  /** Where each formula part and symbol chip sits, venue px, frame coordinates. */
  parts(): { part: string; rect: Rect }[];
  setNumbers(lines: readonly string[]): void;
  /** Style the parts for the link's pulses. */
  update(link: Link, now: number): void;
  show(open: boolean): void;
  dispose(): void;
}

/**
 * The fold: the formula large, a line per symbol with a colour chip, a note or two, and live
 * numbers, on an opaque panel over `rect` (the watch view and text). Positions are venue px;
 * `unit` turns them into stage px.
 */
export const createFold = (
  parent: HTMLElement,
  text: MathsText,
  colours: Readonly<Record<string, string>>,
  rect: Rect,
  unit: number,
  type: TypeScale,
): Fold => {
  const px = (v: number) => `${Math.round(v * unit * 100) / 100}px`;
  // Everything inside is sized in em of the fold's own font size, so one number shrinks it to fit.
  const base = type.small * unit;
  const el = document.createElement("div");
  el.style.cssText =
    `position:absolute;left:${px(rect.x)};top:${px(rect.y)};width:${px(rect.width)};` +
    `height:${px(rect.height)};box-sizing:border-box;padding:1.1em 1.25em;z-index:4;` +
    `background:#0b1222;border:${px(4)} solid ${withAlpha(COLOR.accent, 0.55)};` +
    `border-radius:${px(34)};color:${COLOR.ink};font-family:${FONT};pointer-events:none;` +
    `font-size:${base}px;display:none;flex-direction:column;gap:0.55em;overflow:hidden;`;

  const formula = document.createElement("div");
  formula.style.cssText =
    `font:600 ${(type.maths / type.small).toFixed(3)}em Georgia,"Times New Roman",serif;line-height:1.2;` +
    "white-space:nowrap;display:flex;flex-wrap:wrap;align-items:baseline;flex:none;";
  const spans = new Map<string, HTMLElement[]>();
  for (const r of text.formula) {
    const s = document.createElement("span");
    s.textContent = r.t;
    s.style.cssText =
      `display:inline-block;white-space:pre;transition:transform 0.08s;` +
      (isVariable(r) ? "font-style:italic;" : "") +
      // The runs are flex items, which ignore vertical-align, so sub and sup are shifted instead.
      (r.sub ? `font-size:0.55em;position:relative;top:0.45em;` : "") +
      (r.sup ? `font-size:0.55em;position:relative;top:-1.1em;` : "");
    s.style.color = r.part ? (colours[r.part] ?? COLOR.ink) : withAlpha(COLOR.ink, 0.85);
    if (r.part) {
      const list = spans.get(r.part) ?? [];
      list.push(s);
      spans.set(r.part, list);
    }
    formula.append(s);
  }
  el.append(formula);

  const numbers = document.createElement("div");
  numbers.style.cssText =
    `font:700 1.12em ${FONT};color:${COLOR.accent};flex:none;` +
    "line-height:1.3;font-variant-numeric:tabular-nums;white-space:pre-line;";
  el.append(numbers);

  const chips = new Map<string, HTMLElement[]>();
  const symbols = document.createElement("div");
  symbols.style.cssText = `display:flex;flex-direction:column;gap:0.3em;font:500 1.05em ${FONT};line-height:1.2;flex:none;`;
  for (const s of text.symbols) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:baseline;gap:0.5em;";
    const chip = document.createElement("span");
    chip.textContent = s.sym;
    chip.style.cssText =
      "flex:none;min-width:2em;text-align:center;padding:0.1em 0.4em;" +
      "border-radius:0.5em;font:italic 700 1.08em Georgia,serif;";
    const c = s.part ? (colours[s.part] ?? COLOR.ink) : COLOR.ink;
    chip.style.color = c;
    chip.style.border = `${px(3)} solid ${withAlpha(c, 0.6)}`;
    if (s.part) {
      const list = chips.get(s.part) ?? [];
      list.push(chip);
      chips.set(s.part, list);
    }
    const what = document.createElement("span");
    what.textContent = s.text;
    what.style.color = withAlpha(COLOR.ink, 0.88);
    row.append(chip, what);
    symbols.append(row);
  }
  el.append(symbols);

  if (text.notes?.length) {
    const notes = document.createElement("div");
    notes.style.cssText = `font:500 0.95em ${FONT};color:${COLOR.muted};line-height:1.25;flex:none;`;
    notes.textContent = text.notes.map((n) => n.text).join(" ");
    el.append(notes);
  }
  parent.append(el);

  /** Shrink the fold's type until everything fits its box. */
  const fit = () => {
    if (el.style.display === "none") return;
    let size = base;
    el.style.fontSize = `${size}px`;
    while (el.scrollHeight > el.clientHeight + 1 && size > base * 0.55) {
      size *= 0.93;
      el.style.fontSize = `${size}px`;
    }
  };

  let shownNumbers = "";
  let open = false;
  const styled = new Map<HTMLElement, string>();

  const rectOf = (node: HTMLElement): Rect => {
    // Offsets are in stage px relative to the fold, whatever CSS scaling the stage has.
    let x = 0;
    let y = 0;
    let n: HTMLElement | null = node;
    while (n && n !== el) {
      x += n.offsetLeft;
      y += n.offsetTop;
      n = n.offsetParent as HTMLElement | null;
    }
    return {
      x: rect.x + x / unit,
      y: rect.y + y / unit,
      width: node.offsetWidth / unit,
      height: node.offsetHeight / unit,
    };
  };

  return {
    el,
    parts() {
      if (!open) return [];
      const out: { part: string; rect: Rect }[] = [];
      for (const [part, list] of spans) for (const s of list) out.push({ part, rect: rectOf(s) });
      for (const [part, list] of chips) for (const s of list) out.push({ part, rect: rectOf(s) });
      return out;
    },
    setNumbers(lines) {
      const t = lines.join("\n");
      if (t === shownNumbers) return;
      const refit = t.split("\n").length !== shownNumbers.split("\n").length;
      shownNumbers = t;
      numbers.textContent = t;
      if (refit) fit();
    },
    update(link, now) {
      if (!open) return;
      const active = link.active(now);
      const apply = (part: string, node: HTMLElement) => {
        const k = link.level(part, now);
        const c = colours[part] ?? COLOR.ink;
        const style =
          k > 0
            ? `scale(${(1 + 0.12 * k).toFixed(3)})|0 0 ${(18 * k).toFixed(1)}px ${c}`
            : active
              ? "scale(1)|dim"
              : "scale(1)|";
        if (styled.get(node) === style) return;
        styled.set(node, style);
        const [tr, glow] = style.split("|");
        node.style.transform = tr!;
        node.style.textShadow = glow && glow !== "dim" ? glow : "none";
        node.style.opacity = glow === "dim" ? "0.45" : "1";
      };
      for (const [part, list] of spans) for (const s of list) apply(part, s);
      for (const [part, list] of chips) for (const s of list) apply(part, s);
    },
    show(o) {
      open = o;
      el.style.display = o ? "flex" : "none";
      if (o) fit();
    },
    dispose() {
      el.remove();
      spans.clear();
      chips.clear();
      styled.clear();
    },
  };
};
