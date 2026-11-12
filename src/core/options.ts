import type { FrameKind, OptionDef, OptionValue, OptionValues } from "./types";

/** An app id, optionally with one ":variant" suffix (a picker preset). */
const APP_TOKEN = /^[a-z0-9-]{1,32}(:[a-z0-9-]{1,32})?$/;

/**
 * The id-shaped tokens of an `apps` value, trimmed, in order and without repeats, comma-joined.
 * Ids are checked against the registry by whoever reads them.
 */
export const appTokens = (value: string): string => {
  const ids = value
    .split(",")
    .map((t) => t.trim())
    .filter((t) => APP_TOKEN.test(t));
  return [...new Set(ids)].join(",");
};

/** Control characters become spaces, then the ends are trimmed. */
export const printable = (text: string): string => text.replace(/\p{Cc}/gu, " ").trim();

/** Printable text cut to `max` UTF-16 units, without leaving half a surrogate pair at the end. */
export const cutText = (text: string, max: number): string => {
  let out = printable(text).slice(0, Math.max(0, max));
  if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1);
  return out.trimEnd();
};

/** An option's default as the value an app receives (an `apps` set is comma-joined). */
export const optionDefault = (def: OptionDef): OptionValue =>
  def.type === "apps" ? def.default.join(",") : def.default;

const decimals = (step: number): number => {
  const text = String(step);
  if (text.includes("e-")) return Number(text.split("e-")[1]);
  return text.split(".")[1]?.length ?? 0;
};

/** Clamp to the range, snap to the step counted from `min`, and drop float noise. */
export const snap = (value: number, min: number, max: number, step: number): number => {
  const clamped = Math.min(max, Math.max(min, value));
  if (!(step > 0)) return clamped;
  let k = Math.round((clamped - min) / step);
  if (min + k * step > max + 1e-9) k--;
  return Number(Math.max(min, min + k * step).toFixed(Math.min(20, decimals(step))));
};

const cleanValue = (def: OptionDef, value: unknown): OptionValue => {
  switch (def.type) {
    case "boolean":
      return typeof value === "boolean" ? value : def.default;
    case "enum":
      return typeof value === "string" && def.values.some((v) => v.id === value)
        ? value
        : def.default;
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? snap(value, def.min, def.max, def.step)
        : def.default;
    case "apps":
      return typeof value === "string" ? appTokens(value) : optionDefault(def);
    case "text": {
      const text = typeof value === "string" ? cutText(value, def.maxLength) : "";
      return text || def.default;
    }
  }
};

/**
 * Option values checked against an app's schema, for values that don't come from the URL (admin
 * overrides, picker launches). Each option in `defs` gets a valid value: enums one of theirs,
 * numbers clamped and snapped to their step, booleans and `apps` sets as `coerceOptions` gives
 * them, text printable and cut to `maxLength`. A missing or wrong value, or empty text, gets the
 * default. Keys the schema doesn't have are dropped.
 */
export const cleanOptionValues = (
  values: Readonly<Record<string, unknown>> | null | undefined,
  defs: readonly OptionDef[] | undefined,
): OptionValues => {
  const out: OptionValues = {};
  for (const def of defs ?? []) {
    const value = values && Object.hasOwn(values, def.key) ? values[def.key] : undefined;
    out[def.key] = cleanValue(def, value);
  }
  return out;
};

/**
 * Whether a panel or picker lists `def`, given the values chosen so far (missing ones count as
 * their defaults) and the kinds of frame it would reach. An option is hidden when its `kinds`
 * share none of `kinds`, or when its `when` option holds another value or is hidden itself.
 * With no kinds given, `kinds` hides nothing.
 */
export const optionShown = (
  def: OptionDef,
  defs: readonly OptionDef[] | undefined,
  values: Readonly<Record<string, OptionValue | undefined>>,
  kinds?: FrameKind | readonly FrameKind[] | null,
): boolean => {
  const list: readonly FrameKind[] =
    kinds === undefined || kinds === null ? [] : typeof kinds === "string" ? [kinds] : kinds;
  const seen = new Set<string>();
  let d: OptionDef | undefined = def;
  while (d) {
    // A loop of `when` references can never be satisfied.
    if (seen.has(d.key)) return false;
    seen.add(d.key);
    const only = d.kinds;
    if (only && list.length > 0 && !list.some((k) => only.includes(k))) return false;
    const when: OptionDef["when"] = d.when;
    if (!when) return true;
    const ref: OptionDef | undefined = defs?.find((o) => o.key === when.key);
    const value = values[when.key] ?? (ref ? optionDefault(ref) : undefined);
    if (value === undefined || !when.is.includes(value)) return false;
    d = ref;
  }
  return true;
};
