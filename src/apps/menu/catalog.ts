import type {
  AppManifest,
  FrameKind,
  OptionDef,
  OptionValue,
  OptionValues,
  VariantDef,
} from "../../core/types";

const CATEGORY_ORDER: Record<AppManifest["category"], number> = { game: 0, visual: 1, tool: 2 };
const ENTRY = /^([a-z0-9-]+)(?::([a-z0-9-]+))?$/;

/** One entry of the `apps` option: an app, or an operator preset of one of its variants. */
export interface Entry {
  id: string;
  variant: string | null;
}

/** One tile: an app, with its variant fixed when the operator listed a preset. */
export interface Offer {
  app: AppManifest;
  variant: VariantDef | null;
  /** `id` or `id:variant`, unique among the offers. */
  key: string;
}

/** The `apps` option as entries (`id` or `id:variant`), in the operator's order, without repeats. */
export const parseEntries = (value: OptionValue | undefined): Entry[] => {
  if (typeof value !== "string") return [];
  const seen = new Set<string>();
  const out: Entry[] = [];
  for (const token of value.split(",").map((t) => t.trim())) {
    const m = ENTRY.exec(token);
    if (!m?.[1] || seen.has(token)) continue;
    seen.add(token);
    out.push({ id: m[1], variant: m[2] ?? null });
  }
  return out;
};

const withDefault = (def: OptionDef, value: OptionValue | undefined): OptionDef => {
  switch (def.type) {
    case "boolean":
      return typeof value === "boolean" ? { ...def, default: value } : def;
    case "number":
      return typeof value === "number" ? { ...def, default: value } : def;
    case "apps":
      return typeof value === "string"
        ? { ...def, default: value.split(",").filter((t) => t !== "") }
        : def;
    default:
      return typeof value === "string" ? { ...def, default: value } : def;
  }
};

/**
 * `app` with the operator's presets as its options' defaults, so tiles, the choose step and a
 * launch all start from them. The values are already checked against the app's schema.
 */
export const withPresets = (app: AppManifest, presets: OptionValues): AppManifest => {
  if (!app.options || Object.keys(presets).length === 0) return app;
  return { ...app, options: app.options.map((def) => withDefault(def, presets[def.key])) };
};

/** Whether a visitor can run `app` on its own on a frame of this kind. */
export const runsSolo = (app: AppManifest, kind: FrameKind): boolean =>
  app.network !== "required" &&
  app.setups.some(
    (s) => s.setup === "solo" && s.kinds.includes(kind) && (!s.roles || s.roles.includes("solo")),
  );

/**
 * The tiles to offer on a frame of `kind`. An explicit list keeps its order and may name hidden
 * apps and any of an app's variants; unknown apps or variants and apps that can't run solo here
 * are dropped. When that leaves nothing, or the list is empty, every visible app that runs solo
 * here is offered, games first, and tools too unless `tools` is false.
 */
export const offers = (
  all: readonly AppManifest[],
  kind: FrameKind,
  entries: readonly Entry[],
  self: string,
  tools = true,
): Offer[] => {
  const usable = (a: AppManifest) => a.id !== self && runsSolo(a, kind);
  const byId = new Map(all.map((a) => [a.id, a]));
  const chosen: Offer[] = [];
  const keys = new Set<string>();
  for (const e of entries) {
    const app = byId.get(e.id);
    if (!app || !usable(app)) continue;
    const variant = e.variant ? (app.variants?.find((v) => v.id === e.variant) ?? null) : null;
    if (e.variant && !variant) continue;
    const key = variant ? `${app.id}:${variant.id}` : app.id;
    if (keys.has(key)) continue;
    keys.add(key);
    chosen.push({ app, variant, key });
  }
  if (chosen.length > 0) return chosen;
  return all
    .filter((a) => !a.hidden && usable(a) && (tools || a.category !== "tool"))
    .sort(
      (a, b) =>
        CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category] || a.title.localeCompare(b.title),
    )
    .map((app) => ({ app, variant: null, key: app.id }));
};
