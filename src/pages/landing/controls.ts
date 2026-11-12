import { snap } from "../../core/options";
import { h, nextId } from "./dom";

export interface Choice<T extends string> {
  id: T;
  title: string;
  /** Extra markup inside the segment, such as a kind glyph. Internal strings only. */
  icon?: string;
  disabled?: boolean;
}

/** A label that repeats its section title can be hidden; screen readers still get it. */
const labelClass = (hidden: boolean | undefined): string =>
  hidden ? "label visually-hidden" : "label";

const field = (
  label: string,
  labelFor: string | null,
  hideLabel: boolean | undefined,
  ...body: (Node | null)[]
): HTMLElement =>
  h(
    "div",
    { class: "field" },
    labelFor
      ? h("label", { class: labelClass(hideLabel), for: labelFor }, label)
      : h("div", { class: labelClass(hideLabel) }, label),
    ...body,
  );

const hintEl = (hint: string | undefined): HTMLElement | null =>
  hint ? h("p", { class: "hint" }, hint) : null;

/**
 * Segmented buttons for a few short choices, a select for many or long ones.
 * `name` is also the key used to restore focus after the form re-renders.
 */
export const choiceField = <T extends string>(opts: {
  name: string;
  label: string;
  hideLabel?: boolean;
  /** Keep segments even for many choices, e.g. when icons carry meaning. They wrap if needed. */
  segmented?: boolean;
  value: T;
  choices: readonly Choice<T>[];
  hint?: string;
  onChange(value: T): void;
}): HTMLElement => {
  const long =
    !opts.segmented &&
    (opts.choices.length > 4 || opts.choices.reduce((n, c) => n + c.title.length, 0) > 34);
  if (long) {
    const id = nextId(opts.name);
    const select = h(
      "select",
      {
        id,
        "data-focus": opts.name,
        onchange: () => opts.onChange(select.value as T),
      },
      opts.choices.map((c) =>
        h("option", { value: c.id, selected: c.id === opts.value, disabled: c.disabled }, c.title),
      ),
    );
    return field(opts.label, id, opts.hideLabel, select, hintEl(opts.hint));
  }
  const labelId = nextId(`${opts.name}-label`);
  const groupName = nextId(opts.name);
  const group = h(
    "div",
    { class: "seg", role: "radiogroup", "aria-labelledby": labelId },
    opts.choices.map((c) =>
      h(
        "label",
        {},
        h("input", {
          type: "radio",
          name: groupName,
          value: c.id,
          checked: c.id === opts.value,
          disabled: c.disabled,
          "data-focus": `${opts.name}:${c.id}`,
          onchange: () => opts.onChange(c.id),
        }),
        h("span", { html: (c.icon ?? "") + escapeHtml(c.title) }),
      ),
    ),
  );
  return h(
    "div",
    { class: "field" },
    h("div", { class: labelClass(opts.hideLabel), id: labelId }, opts.label),
    group,
    hintEl(opts.hint),
  );
};

export const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const switchField = (opts: {
  name: string;
  label: string;
  value: boolean;
  hint?: string;
  disabled?: boolean;
  onChange(value: boolean): void;
}): HTMLElement => {
  const id = nextId(opts.name);
  const input = h("input", {
    id,
    type: "checkbox",
    role: "switch",
    class: "switch",
    checked: opts.value,
    disabled: opts.disabled,
    "data-focus": opts.name,
    onchange: () => opts.onChange(input.checked),
  });
  return h(
    "div",
    { class: "field field-switch" },
    h("label", { class: "switch-row", for: id }, h("span", {}, opts.label), input),
    hintEl(opts.hint),
  );
};

/**
 * A slider with its value beside it. `onInput` fires while dragging and must not re-render
 * the form, or the drag would be lost.
 */
export const sliderField = (opts: {
  name: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  hint?: string;
  format?(value: number): string;
  onInput(value: number): void;
}): HTMLElement => {
  const id = nextId(opts.name);
  const format = opts.format ?? String;
  const out = h("output", { class: "slider-value mono", for: id }, format(opts.value));
  const input = h("input", {
    id,
    type: "range",
    min: opts.min,
    max: opts.max,
    step: opts.step,
    value: opts.value,
    "data-focus": opts.name,
    oninput: () => {
      const v = Number(input.value);
      out.textContent = format(v);
      opts.onInput(v);
    },
  });
  input.value = String(opts.value);
  return field(opts.label, id, false, h("div", { class: "slider" }, input, out), hintEl(opts.hint));
};

/**
 * A box for a number. `onInput` fires for each valid value typed and must not re-render the
 * form, or the box would lose focus. Leaving the box puts the value in range and on its step.
 */
export const numberField = (opts: {
  name: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  hint?: string;
  onInput(value: number): void;
}): HTMLElement => {
  const id = nextId(opts.name);
  let current = opts.value;
  const input = h("input", {
    id,
    type: "number",
    class: "number",
    min: opts.min,
    max: opts.max,
    step: opts.step,
    inputmode: Number.isInteger(opts.step) && opts.min >= 0 ? "numeric" : "decimal",
    autocomplete: "off",
    "data-focus": opts.name,
    oninput: () => {
      const n = Number(input.value);
      if (input.value.trim() === "" || !Number.isFinite(n)) return;
      current = snap(n, opts.min, opts.max, opts.step);
      opts.onInput(current);
    },
    onchange: () => {
      input.value = String(current);
    },
  });
  input.value = String(opts.value);
  const range = `${opts.min} to ${opts.max}`;
  return field(opts.label, id, false, input, hintEl(opts.hint ?? range));
};

export const textField = (opts: {
  name: string;
  label: string;
  value: string;
  type?: "text" | "password" | "url";
  placeholder?: string;
  inputmode?: string;
  maxlength?: number;
  hint?: string;
  error?: string | null;
  action?: HTMLElement;
  onInput(value: string, input: HTMLInputElement): void;
}): { el: HTMLElement; input: HTMLInputElement; setError(msg: string | null): void } => {
  const id = nextId(opts.name);
  const errorId = `${id}-error`;
  const input = h("input", {
    id,
    type: opts.type ?? "text",
    value: opts.value,
    placeholder: opts.placeholder,
    inputmode: opts.inputmode,
    maxlength: opts.maxlength,
    autocomplete: "off",
    autocapitalize: "off",
    spellcheck: "false",
    "data-focus": opts.name,
    "aria-describedby": errorId,
    oninput: () => opts.onInput(input.value, input),
  });
  input.value = opts.value;
  const error = h("p", { class: "field-error", id: errorId, role: "status" });
  const setError = (msg: string | null) => {
    error.textContent = msg ?? "";
    error.hidden = !msg;
    if (msg) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  };
  setError(opts.error ?? null);
  const row = opts.action ? h("div", { class: "input-row" }, input, opts.action) : input;
  return { el: field(opts.label, id, false, row, error, hintEl(opts.hint)), input, setError };
};

export const section = (title: string, ...children: (Node | null)[]): HTMLElement =>
  h("section", { class: "sec" }, h("h3", { class: "sec-title" }, title), ...children);
