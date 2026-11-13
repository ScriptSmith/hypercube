import { appTokens, cleanOptionValues } from "./options";
import type { FrameKind, HostRole, OptionDef, OptionValues, Reach, Role, SetupName } from "./types";
import { parseVenue, type VenuePatch } from "./venue";

/** Every URL parameter the runtime understands. See AGENTS.md for meanings. */
export interface Params {
  app: string;
  variant: string | null;
  /**
   * Raw `o.<name>` values; the app's option schema coerces them. `o.<app>.<name>` values are for
   * an app this frame launches (see `presetOptions`).
   */
  options: Record<string, string>;
  setup: SetupName | null;
  role: Role | null;
  pos: number | null;
  count: number | null;
  group: string | null;
  side: number | null;
  frame: string | null;
  event: string | null;
  zone: string | null;
  display: string | null;
  displays: string[] | null;
  name: string | null;
  hostRole: HostRole | null;
  w: number | null;
  h: number | null;
  mode: "show" | "preview" | null;
  kind: FrameKind | null;
  /** Panels merged into this frame (for `pair`). */
  span: number | null;
  reach: Reach | null;
  /** A sphere's diameter and the height of its lowest point, metres. */
  sphere: { diameter: number; bottom: number | null } | null;
  /** Degrees of latitude a sphere's feed covers, top row and bottom row. */
  cover: { top: number; bottom: number } | null;
  /** Degrees of latitude people see well on a sphere, top and bottom. */
  view: { top: number; bottom: number } | null;
  /** `globe` shows a sphere frame as a turnable 3D model of the ball, for previews. */
  look: "flat" | "globe";
  /** The installation's sizes where they differ from the defaults (see `parseVenue`). */
  venue: VenuePatch | null;
  room: string | null;
  peer: string;
  transport: "peer" | "local";
  ak: string | null;
  /** PIN verifier for unlocking admin on this frame (see adminkey.ts). */
  pv: string | null;
  fit: { width: number; height: number } | null;
  res: number;
  bots: number;
  seed: string | null;
  debug: boolean;
  /** Seconds without touch before the app resets to attract. */
  idle: number;
  preview: boolean;
  /** True when the host left `{token}` placeholders unfilled (e.g. designer thumbnails). */
  unfilled: boolean;
}

const KINDS: readonly FrameKind[] = ["panel", "pair", "wall", "screen", "kiosk", "sphere"];
const SETUPS: readonly SetupName[] = ["solo", "bank", "corner", "versus"];
const ROLES: readonly Role[] = ["solo", "station", "screen"];
const HOST_ROLES: readonly HostRole[] = ["TOUCHSCREEN", "KIOSK", "PRESENTATION", "STANDARD"];

const PLACEHOLDER = /^\{[a-zA-Z]+\}$/;

const oneOf = <T extends string>(value: string | null, allowed: readonly T[]): T | null =>
  value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : null;

const int = (value: string | null, min: number, max: number): number | null => {
  if (value === null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

const num = (value: string | null, min: number, max: number): number | null => {
  if (value === null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

const bool = (value: string | null): boolean =>
  value !== null && value !== "0" && value.toLowerCase() !== "false";

export const parseParams = (search: string): Params => {
  const q = new URLSearchParams(search);
  let unfilled = false;
  const get = (key: string): string | null => {
    const value = q.get(key);
    if (value === null) return null;
    if (PLACEHOLDER.test(value)) {
      unfilled = true;
      return null;
    }
    return value;
  };

  const options: Record<string, string> = {};
  for (const [key, value] of q) {
    if (key.startsWith("o.") && key.length > 2) options[key.slice(2)] = value;
  }

  const reachParts = get("reach")?.split(",") ?? null;
  const adult = num(reachParts?.[0] ?? null, 0, 1);
  const child = num(reachParts?.[1] ?? null, 0, 1);
  const reach = adult !== null ? { adult, child: child ?? Math.min(adult, 0.5) } : null;

  const sphereParts = get("sphere")?.split(",") ?? null;
  const diameter = num(sphereParts?.[0] ?? null, 0.1, 1000);
  /** Two latitudes in degrees, either order. */
  const angles = (key: string) => {
    const parts = get(key)?.split(",") ?? null;
    const a = num(parts?.[0] ?? null, -90, 90);
    const b = num(parts?.[1] ?? null, -90, 90);
    return a !== null && b !== null && a !== b
      ? { top: Math.max(a, b), bottom: Math.min(a, b) }
      : null;
  };

  const fitMatch = /^(\d{2,5})x(\d{2,5})$/.exec(get("fit") ?? "");
  const fit = fitMatch ? { width: Number(fitMatch[1]), height: Number(fitMatch[2]) } : null;

  const transport = get("transport") === "local" ? "local" : "peer";
  const venueText = get("venue");
  const mode = oneOf(get("mode"), ["show", "preview"] as const);

  return {
    app: get("app") ?? "idle",
    variant: get("variant"),
    options,
    setup: oneOf(get("setup"), SETUPS),
    role: oneOf(get("role"), ROLES),
    pos: int(get("pos"), 0, 63),
    count: int(get("count"), 1, 64),
    group: get("group"),
    side: get("side") === "b" ? 1 : get("side") === "a" ? 0 : null,
    frame: get("frame"),
    event: get("event"),
    zone: get("zone"),
    display: get("display"),
    displays: get("displays")?.split(",").filter(Boolean) ?? null,
    name: get("name"),
    hostRole: oneOf(get("hostrole"), HOST_ROLES),
    w: int(get("w"), 1, 100000),
    h: int(get("h"), 1, 100000),
    mode,
    kind: oneOf(get("kind"), KINDS),
    span: int(get("span"), 1, 16),
    reach,
    sphere: diameter === null ? null : { diameter, bottom: num(sphereParts?.[1] ?? null, 0, 1000) },
    cover: angles("cover"),
    view: angles("view"),
    look: get("look") === "globe" ? "globe" : "flat",
    venue: venueText ? parseVenue(venueText).patch : null,
    room: get("room"),
    peer: get("peer") ?? "public",
    transport,
    ak: get("ak"),
    pv: get("pv"),
    fit,
    res: num(get("res"), 0.1, 2) ?? 1,
    bots: int(get("bots"), 0, 16) ?? 0,
    seed: get("seed"),
    debug: bool(get("debug")),
    idle: int(get("idle"), 5, 3600) ?? 60,
    preview: bool(get("preview")),
    unfilled,
  };
};

/**
 * Coerce raw option strings against an app's schema, falling back to defaults. Text options
 * always get their default: anyone can load the public site with any URL, so operator text
 * comes only through admin (see `cleanOptionValues`).
 */
export const coerceOptions = (
  raw: Record<string, string>,
  defs: readonly OptionDef[] | undefined,
): OptionValues => {
  const out: OptionValues = {};
  for (const def of defs ?? []) {
    const value = raw[def.key];
    if (def.type === "text") {
      out[def.key] = def.default;
    } else if (def.type === "boolean") {
      out[def.key] = value === undefined ? def.default : bool(value);
    } else if (def.type === "apps") {
      out[def.key] = appTokens(value ?? def.default.join(","));
    } else if (def.type === "number") {
      const n = value === undefined ? null : num(value, def.min, def.max);
      out[def.key] = n ?? def.default;
    } else {
      out[def.key] = def.values.some((v) => v.id === value) ? (value as string) : def.default;
    }
  }
  return out;
};

/**
 * The option values an operator set for `app` on a frame that launches it (an app picker): the
 * URL's `o.<app>.<name>` values, then `admin`'s over them, each checked against the app's schema.
 * Only options the operator set are returned, so a launch can tell them from defaults. Text comes
 * only from admin, as for any app.
 */
export const presetOptions = (
  app: string,
  raw: Record<string, string>,
  admin: OptionValues | undefined,
  defs: readonly OptionDef[] | undefined,
): OptionValues => {
  const prefix = `${app}.`;
  const own: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith(prefix)) own[key.slice(prefix.length)] = value;
  }
  const fromUrl = coerceOptions(own, defs);
  const fromAdmin = cleanOptionValues(admin, defs);
  const out: OptionValues = {};
  for (const def of defs ?? []) {
    const url = def.type !== "text" && Object.hasOwn(own, def.key) ? fromUrl[def.key] : undefined;
    const set = admin && Object.hasOwn(admin, def.key) ? fromAdmin[def.key] : url;
    if (set !== undefined) out[def.key] = set;
  }
  return out;
};
