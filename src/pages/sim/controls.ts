import { listApps } from "../../core/registry";
import type { OptionDef } from "../../core/types";

/** Small DOM builders for the simulator's control bar. */

export const make = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text?: string,
): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};

export const labelled = (text: string, control: HTMLElement, title?: string): HTMLLabelElement => {
  const label = make("label", "sim-field");
  label.append(make("span", "", text), control);
  if (title) label.title = title;
  return label;
};

export const selectOf = (
  choices: readonly { value: string; text: string }[],
  value: string,
  onChange: (value: string) => void,
  signal: AbortSignal,
): HTMLSelectElement => {
  const select = make("select");
  for (const c of choices) {
    const option = make("option", "", c.text);
    option.value = c.value;
    select.append(option);
  }
  select.value = value;
  select.addEventListener("change", () => onChange(select.value), { signal });
  return select;
};

export const checkbox = (
  text: string,
  checked: boolean,
  onChange: (checked: boolean) => void,
  signal: AbortSignal,
): HTMLLabelElement => {
  const input = make("input");
  input.type = "checkbox";
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked), { signal });
  const label = make("label", "sim-check");
  label.append(input, make("span", "", text));
  return label;
};

/**
 * A set of app ids as a compact dropdown of checkboxes. Ticks apply when the list closes,
 * so choosing several apps rebuilds the frames once.
 */
export const appsControl = (
  title: string,
  value: string,
  apps: readonly { id: string; title: string; hidden?: boolean }[],
  onChange: (value: string) => void,
  signal: AbortSignal,
): HTMLElement => {
  const chosen = new Set(value.split(",").filter(Boolean));
  const ids = apps
    .filter((m) => !m.hidden || chosen.has(m.id))
    .map((m) => ({ id: m.id, title: m.title }));
  for (const id of chosen) if (!ids.some((a) => a.id === id)) ids.push({ id, title: id });
  const details = make("details", "sim-apps");
  const summary = make("summary", "", `${title}: ${chosen.size ? chosen.size : "all"}`);
  const list = make("div", "sim-apps-list");
  for (const app of ids) {
    list.append(
      checkbox(
        app.title,
        chosen.has(app.id),
        (on) => {
          if (on) chosen.add(app.id);
          else chosen.delete(app.id);
          summary.textContent = `${title}: ${chosen.size ? chosen.size : "all"}`;
        },
        signal,
      ),
    );
  }
  list.append(make("span", "sim-muted", "None ticked means every suitable app."));
  details.append(summary, list);
  details.addEventListener(
    "toggle",
    () => {
      if (details.open) return;
      const next = ids
        .filter((a) => chosen.has(a.id))
        .map((a) => a.id)
        .join(",");
      if (next !== value) onChange(next);
    },
    { signal },
  );
  return details;
};

export const optionControl = (
  def: OptionDef,
  value: string | number | boolean,
  onChange: (value: string | number | boolean) => void,
  signal: AbortSignal,
): HTMLElement => {
  if (def.type === "text") {
    // Frames never read operator text from a URL, so the sim can't pass it on.
    const input = make("input");
    input.type = "text";
    input.disabled = true;
    input.placeholder = "Set in admin";
    input.size = 12;
    return labelled(def.title, input, "Operator text is set through admin, never in a URL");
  }
  if (def.type === "boolean") return checkbox(def.title, value === true, onChange, signal);
  if (def.type === "enum") {
    const choices = def.values.map((v) => ({ value: v.id, text: v.title }));
    return labelled(def.title, selectOf(choices, String(value), onChange, signal));
  }
  if (def.type === "apps") {
    return appsControl(def.title, String(value), listApps(), onChange, signal);
  }
  const input = make("input");
  input.type = "number";
  input.min = String(def.min);
  input.max = String(def.max);
  input.step = String(def.step);
  input.value = String(value);
  input.addEventListener(
    "change",
    () => {
      const n = Number(input.value);
      if (Number.isFinite(n)) onChange(Math.min(def.max, Math.max(def.min, n)));
    },
    { signal },
  );
  return labelled(def.title, input);
};
