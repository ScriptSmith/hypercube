import { printable } from "../options";
import type { OptionValue, OptionValues, Role, SetupInfo, SetupName } from "../types";
import { canonical } from "./sign";

/** What admin can change on a frame. Unset fields fall back to the URL. */
export interface FrameConfig {
  app?: string;
  variant?: string | null;
  options?: OptionValues;
  /** Options for apps this frame launches (an app picker), by app id. */
  launch?: Record<string, OptionValues>;
  setup?: SetupInfo["name"];
  role?: SetupInfo["role"];
  pos?: number;
  count?: number;
  group?: string;
  side?: number;
}

/**
 * How long an override lasts: until the browser closes (kept in sessionStorage, so the frame's
 * own reloads keep it) or until the frame next loads.
 */
export type Keep = "session" | "once";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const OVERRIDE_KEY = (room: string, frame: string) => `hc:override:${room}:${frame}`;

export const SETUPS: readonly SetupName[] = ["solo", "bank", "corner", "versus"];
export const ROLES: readonly Role[] = ["solo", "station", "screen"];

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_OPTIONS = 32;
/** A string option can be a comma-joined set of app ids, or operator text. */
const MAX_OPTION_TEXT = 800;
/**
 * All options together, counted as JSON so quotes and escapes count too, so a config still fits
 * in one signed envelope with room for the rest of a frame's state.
 */
const MAX_OPTIONS_TEXT = 2000;

/** An app id as a key of `launch`. No underscores, so never `__proto__`. */
const APP_ID = /^[a-z0-9-]{1,32}$/;
const MAX_LAUNCH_APPS = 8;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): v is T =>
  typeof v === "string" && (allowed as readonly string[]).includes(v);

const int = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;

/** Printable text up to `max` characters, or null. */
export const plainText = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const text = printable(v);
  return text.length > 0 && text.length <= max ? text : null;
};

const cleanOptions = (v: unknown): OptionValues | null => {
  if (!isRecord(v)) return null;
  const out: OptionValues = {};
  let n = 0;
  let size = 0;
  for (const [key, value] of Object.entries(v)) {
    if (n >= MAX_OPTIONS || !ID.test(key)) continue;
    let clean: OptionValue | null = null;
    if (typeof value === "boolean") clean = value;
    else if (typeof value === "number" && Number.isFinite(value)) clean = value;
    else if (typeof value === "string" && value.length <= MAX_OPTION_TEXT) clean = value;
    if (clean === null) continue;
    size += JSON.stringify(key).length + JSON.stringify(clean).length + 2;
    if (size > MAX_OPTIONS_TEXT) break;
    out[key] = clean;
    n++;
  }
  return out;
};

/** Options by launched app, all together within the size one `options` may have. */
const cleanLaunch = (v: unknown): Record<string, OptionValues> | null => {
  if (!isRecord(v)) return null;
  const out: Record<string, OptionValues> = {};
  let n = 0;
  let size = 0;
  for (const [app, values] of Object.entries(v)) {
    if (n >= MAX_LAUNCH_APPS || !APP_ID.test(app)) continue;
    const options = cleanOptions(values);
    if (!options) continue;
    size += JSON.stringify(app).length + JSON.stringify(options).length + 2;
    if (size > MAX_OPTIONS_TEXT) break;
    out[app] = options;
    n++;
  }
  return n > 0 ? out : null;
};

/** A FrameConfig with every field checked; unknown or invalid fields are dropped. */
export const cleanConfig = (v: unknown): FrameConfig | null => {
  if (!isRecord(v)) return null;
  const out: FrameConfig = {};
  if (typeof v.app === "string" && ID.test(v.app)) out.app = v.app;
  if (v.variant === null) out.variant = null;
  else if (typeof v.variant === "string" && ID.test(v.variant)) out.variant = v.variant;
  const options = cleanOptions(v.options);
  if (options) out.options = options;
  const launch = cleanLaunch(v.launch);
  if (launch) out.launch = launch;
  if (oneOf(v.setup, SETUPS)) out.setup = v.setup;
  if (oneOf(v.role, ROLES)) out.role = v.role;
  const pos = int(v.pos, 0, 63);
  if (pos !== null) out.pos = pos;
  const count = int(v.count, 1, 64);
  if (count !== null) out.count = count;
  const group = plainText(v.group, 64);
  if (group !== null) out.group = group;
  if (v.side === 0 || v.side === 1) out.side = v.side;
  return out;
};

/**
 * `patch` over `base`. A new app drops the old app's variant and options. Options for launched
 * apps are kept, and replaced one app at a time.
 */
export const mergeConfig = (base: FrameConfig | null, patch: FrameConfig): FrameConfig => {
  const out: FrameConfig = { ...base };
  if (patch.app !== undefined && patch.app !== base?.app) {
    delete out.variant;
    delete out.options;
  }
  const merged: FrameConfig = { ...out, ...patch };
  if (base?.launch && patch.launch) merged.launch = { ...base.launch, ...patch.launch };
  return merged;
};

export const sameConfig = (a: FrameConfig | null, b: FrameConfig | null): boolean =>
  canonical(a) === canonical(b);

/** The override saved for this browser session, if any. */
export const readOverride = (storage: StorageLike | null, key: string): FrameConfig | null => {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw ? cleanConfig(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
};

/** Saves an override for this browser session; null removes it. */
export const writeOverride = (
  storage: StorageLike | null,
  key: string,
  config: FrameConfig | null,
): void => {
  if (!storage) return;
  try {
    if (config) storage.setItem(key, JSON.stringify(config));
    else storage.removeItem(key);
  } catch {
    // The override still applies until the page reloads.
  }
};
