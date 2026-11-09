import { optionDefault, optionShown } from "../../core/options";
import type {
  AppManifest,
  FrameKind,
  OptionDef,
  OptionValue,
  OptionValues,
  VariantDef,
} from "../../core/types";
import type { Offer } from "./catalog";

/** An option a visitor may set. App lists and operator text are never offered to visitors. */
export type VisitorOption = Exclude<OptionDef, { type: "apps" | "text" }>;

/** How an option is shown: a row of segments, a minus and plus stepper, or a toggle. */
export type Control =
  | { kind: "segments"; values: { value: OptionValue; label: string }[] }
  | { kind: "stepper" }
  | { kind: "toggle" };

/** More choices than this become a stepper instead of segments. */
const MAX_SEGMENTS = 5;

export const visitorVariants = (app: AppManifest): VariantDef[] =>
  (app.variants ?? []).filter((v) => v.visitor !== false);

/**
 * Options a visitor may set on this kind of frame (all kinds when `kind` is omitted). With
 * `values`, only those shown for them: an option whose `when` condition fails is left out.
 */
export const visitorOptions = (
  app: AppManifest,
  kind?: FrameKind,
  values?: OptionValues,
): VisitorOption[] =>
  (app.options ?? []).filter(
    (o): o is VisitorOption =>
      o.visitor === true &&
      o.type !== "apps" &&
      o.type !== "text" &&
      (values === undefined
        ? kind === undefined || !o.kinds || o.kinds.includes(kind)
        : optionShown(o, app.options, values, kind)),
  );

/** The keys of the options shown to a visitor for these values, to tell when the set changes. */
export const shownKeys = (app: AppManifest, kind: FrameKind, values: OptionValues): string =>
  visitorOptions(app, kind, values)
    .map((o) => o.key)
    .join(",");

/** Variants the visitor picks between: none when a preset fixes it or there is only one. */
export const variantChoices = (offer: Offer): VariantDef[] => {
  if (offer.variant) return [];
  const list = visitorVariants(offer.app);
  return list.length > 1 ? list : [];
};

/** Whether tapping this tile opens the choose step rather than starting the app. */
export const needsChoice = (offer: Offer, kind: FrameKind): boolean =>
  variantChoices(offer).length > 0 ||
  visitorOptions(offer.app, kind, defaultOptions(offer.app)).length > 0;

/** The variant to start with: the preset, else the first one offered to visitors. */
export const startVariant = (offer: Offer): string | undefined =>
  offer.variant?.id ?? (visitorVariants(offer.app)[0] ?? offer.app.variants?.[0])?.id;

const numberValues = (def: Extract<VisitorOption, { type: "number" }>): number[] => {
  const n = def.step > 0 ? Math.floor((def.max - def.min) / def.step + 1e-9) + 1 : 1;
  if (n > MAX_SEGMENTS) return [];
  return Array.from({ length: n }, (_, i) => snap(def.min + i * def.step));
};

const snap = (n: number): number => Math.round(n * 1e6) / 1e6;

export const controlFor = (def: VisitorOption): Control => {
  if (def.type === "boolean") return { kind: "toggle" };
  if (def.type === "enum") {
    return def.values.length <= MAX_SEGMENTS
      ? { kind: "segments", values: def.values.map((v) => ({ value: v.id, label: v.title })) }
      : { kind: "stepper" };
  }
  const values = numberValues(def);
  return values.length > 0
    ? { kind: "segments", values: values.map((v) => ({ value: v, label: String(v) })) }
    : { kind: "stepper" };
};

export const isValid = (def: OptionDef, value: OptionValue): boolean => {
  switch (def.type) {
    case "boolean":
      return typeof value === "boolean";
    case "enum":
      return def.values.some((v) => v.id === value);
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return false;
      if (value < def.min - 1e-9 || value > def.max + 1e-9) return false;
      if (def.step <= 0) return true;
      const k = (value - def.min) / def.step;
      return Math.abs(k - Math.round(k)) < 1e-6;
    }
    case "apps":
      return typeof value === "string";
    case "text":
      return false;
  }
};

/** Every option at its default, as the runtime would coerce an empty URL. */
export const defaultOptions = (app: AppManifest): OptionValues => {
  const out: OptionValues = {};
  for (const def of app.options ?? []) out[def.key] = optionDefault(def);
  return out;
};

/**
 * The full option set to launch with: defaults, overlaid with the visitor's valid changes to
 * the visitor options offered on this kind of frame. Anything else in `changes` is ignored.
 */
export const mergeOptions = (
  app: AppManifest,
  changes: OptionValues,
  kind?: FrameKind,
): OptionValues => {
  const out = defaultOptions(app);
  for (const def of visitorOptions(app, kind)) {
    const value = changes[def.key];
    if (value !== undefined && isValid(def, value)) out[def.key] = value;
  }
  return out;
};

/** The value one step along from `value` (enum steps through its list), clamped to the ends. */
export const stepValue = (def: VisitorOption, value: OptionValue, dir: -1 | 1): OptionValue => {
  if (def.type === "boolean") return !value;
  if (def.type === "enum") {
    const i = Math.max(
      0,
      def.values.findIndex((v) => v.id === value),
    );
    const next = Math.min(def.values.length - 1, Math.max(0, i + dir));
    return def.values[next]?.id ?? def.default;
  }
  const n = typeof value === "number" ? value : def.default;
  return snap(Math.min(def.max, Math.max(def.min, n + dir * def.step)));
};

/** Whether a stepper can move further in `dir`. */
export const canStep = (def: VisitorOption, value: OptionValue, dir: -1 | 1): boolean =>
  stepValue(def, value, dir) !== value;

/** A value as the visitor sees it. */
export const valueLabel = (def: VisitorOption, value: OptionValue): string => {
  if (def.type === "enum") return def.values.find((v) => v.id === value)?.title ?? "";
  if (def.type === "boolean") return value ? "On" : "Off";
  return String(value);
};

/** What to pass to `launch`: the chosen variant (or the start one) and the full option set. */
export const launchArgs = (
  offer: Offer,
  variant: string | undefined,
  changes: OptionValues,
  kind?: FrameKind,
): { variant?: string; options: OptionValues } => {
  const allowed = offer.variant ? [offer.variant] : visitorVariants(offer.app);
  const chosen = allowed.some((v) => v.id === variant) ? variant : startVariant(offer);
  const options = mergeOptions(offer.app, changes, kind);
  return chosen === undefined ? { options } : { variant: chosen, options };
};
