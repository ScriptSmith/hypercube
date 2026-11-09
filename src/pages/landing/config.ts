import { generateAdminKey } from "../../core/adminkey";
import { optionDefault } from "../../core/options";
import { activeVenue, displayFor, reachFor } from "../../core/venue";
import type {
  AppManifest,
  FrameKind,
  OptionDef,
  OptionValue,
  OptionValues,
  Reach,
  Role,
  SetupName,
  SetupSupport,
} from "../../core/types";
import { validatePeer, withPeerKey } from "../signalling";

export { validatePeer };

export type IdentityMode = "placeholders" | "manual";

/** Everything the configuration panel controls except the PIN and secret, which are kept apart. */
export interface LandingConfig {
  app: string;
  variant: string | null;
  options: OptionValues;
  setup: SetupName;
  /** Kind of the touch frames, or of the single frame in a solo setup. */
  kind: FrameKind;
  /** Touch frames per bank or side. Manual identity writes one URL per frame. */
  count: number;
  /** Panels merged into each `pair` frame, from 2 to the venue's `maxMerge`. */
  span: number;
  /** Include the screen above where the setup supports one. Kept as a preference across setups. */
  screen: boolean;
  identity: IdentityMode;
  standalone: boolean;
  room: string;
  /**
   * Random admin key, made with the room and saved with it so the URLs stay the same from
   * one day to the next. It goes in the URLs only when a PIN is set.
   */
  ak: string;
  signalling: "public" | "custom";
  customPeer: string;
  reachOverride: boolean;
  reach: Reach;
  idle: number;
  res: number;
  debug: boolean;
}

export const IDLE_DEFAULT = 60;
export const IDLE_RANGE = { min: 5, max: 3600 } as const;
export const RES_RANGE = { min: 0.25, max: 2, step: 0.25 } as const;

const SETUP_NAMES: readonly SetupName[] = ["solo", "bank", "corner", "versus"];
export const KIND_ORDER: readonly FrameKind[] = [
  "panel",
  "pair",
  "wall",
  "kiosk",
  "screen",
  "sphere",
];

export const KIND_TITLE: Record<FrameKind, string> = {
  panel: "Panel",
  pair: "Pair",
  wall: "Wall",
  kiosk: "Kiosk",
  screen: "Screen",
  sphere: "Sphere",
};

/** Most touch frames in one bank or on one side. */
export const COUNT_MAX = 20;

/** Panels per merged frame: 2 up to what one machine in the venue can merge. */
export const spanRange = (): { min: number; max: number } => ({
  min: 2,
  max: Math.max(2, activeVenue().maxMerge),
});

/** Panels in a frame of this kind: `span` for merged frames, 1 otherwise. */
export const spanFor = (kind: FrameKind, span: number): number => (kind === "pair" ? span : 1);

/** Reach for a kind when the operator hasn't overridden it, from the display's mounting. */
export const defaultReach = (kind: FrameKind, span: number): Reach =>
  reachFor(displayFor(kind, spanFor(kind, span)));

/**
 * What the app supports in a setup. A manifest can list a setup more than once (one entry per
 * group of kinds, each with its own note), so the entries are merged; the note is the one for
 * `kind` when given.
 */
export const supportFor = (
  manifest: AppManifest,
  setup: SetupName,
  kind?: FrameKind,
): SetupSupport | undefined => {
  const entries = manifest.setups.filter((s) => s.setup === setup);
  const first = entries[0];
  if (!first || entries.length === 1) return first;
  const merged: SetupSupport = {
    setup,
    kinds: [...new Set(entries.flatMap((s) => s.kinds))],
  };
  if (entries.every((s) => s.roles)) merged.roles = [...new Set(entries.flatMap((s) => s.roles!))];
  const note = kind
    ? entries.find((s) => s.kinds.includes(kind))?.note
    : entries.find((s) => s.note)?.note;
  if (note) merged.note = note;
  return merged;
};

/** In the manifest's order, which puts the app's main setup first. */
export const supportedSetups = (manifest: AppManifest): SetupName[] => [
  ...new Set(manifest.setups.map((s) => s.setup).filter((name) => SETUP_NAMES.includes(name))),
];

const allows = (support: SetupSupport, role: Role): boolean =>
  !support.roles || support.roles.includes(role);

/**
 * Kinds the operator can pick for a setup: every kind for solo, touch kinds otherwise. A sphere
 * is an installation of its own, so it only ever runs solo.
 */
export const kindChoices = (support: SetupSupport): FrameKind[] => {
  const kinds = KIND_ORDER.filter((k) => support.kinds.includes(k));
  if (support.setup === "solo") return kinds;
  return allows(support, "station") ? kinds.filter((k) => k !== "screen" && k !== "sphere") : [];
};

/** Whether visitors can touch a frame of this kind, so reach applies to it. */
export const touchKind = (kind: FrameKind): boolean => displayFor(kind).touch;

export const screenSupported = (support: SetupSupport): boolean =>
  support.setup !== "solo" && support.kinds.includes("screen") && allows(support, "screen");

/** A bank fills the venue's usual row of panels; anything else starts with one frame. */
export const defaultCount = (setup: SetupName, kind: FrameKind, span: number): number => {
  if (setup !== "bank" && setup !== "corner") return 1;
  if (kind !== "panel" && kind !== "pair") return 1;
  return Math.max(1, Math.floor(activeVenue().bankCount / spanFor(kind, span)));
};

/**
 * Entries of an `apps` option from a stored value: app ids, or `id:variant` presets that
 * launch one variant. Well-formed, de-duplicated, in order. Matches `coerceOptions`.
 */
export const appEntries = (value: unknown): string[] => {
  const tokens = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const entries = tokens
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim())
    .filter((t) => /^[a-z0-9-]{1,32}(:[a-z0-9-]{1,32})?$/.test(t));
  return [...new Set(entries)];
};

/** Frame kinds in the chosen setup: the touch kind, plus the screen when one is included. */
export const setupKinds = (cfg: LandingConfig, manifest: AppManifest): FrameKind[] => {
  const support = supportFor(manifest, cfg.setup);
  const screen = cfg.kind !== "screen" && cfg.screen && support && screenSupported(support);
  return screen ? [cfg.kind, "screen"] : [cfg.kind];
};

export { optionDefault };

export const defaultOptions = (defs: readonly OptionDef[] | undefined): OptionValues => {
  const out: OptionValues = {};
  for (const def of defs ?? []) out[def.key] = optionDefault(def);
  return out;
};

const decimalsOf = (step: number): number => {
  const text = String(step);
  if (text.includes("e-")) return Number(text.split("e-")[1]);
  return text.split(".")[1]?.length ?? 0;
};

/** Snap to the option's step from its minimum, clamp, and drop float noise. */
export const snapNumber = (value: number, min: number, max: number, step: number): number => {
  const clamped = Math.min(max, Math.max(min, value));
  const snapped = step > 0 ? min + Math.round((clamped - min) / step) * step : clamped;
  return Number(Math.min(max, snapped).toFixed(decimalsOf(step)));
};

/** App sets are kept as a comma list, as they appear in URLs; empty means every suitable app. */
export const coerceOption = (def: OptionDef, value: unknown): OptionValue => {
  // Operator text is never kept here: it would end up in URLs. Admin sets it.
  if (def.type === "text") return def.default;
  if (def.type === "boolean") return typeof value === "boolean" ? value : def.default;
  if (def.type === "apps") {
    return value === undefined ? optionDefault(def) : appEntries(value).join(",");
  }
  if (def.type === "number") {
    return typeof value === "number" && Number.isFinite(value)
      ? snapNumber(value, def.min, def.max, def.step)
      : def.default;
  }
  return typeof value === "string" && def.values.some((v) => v.id === value) ? value : def.default;
};

const clamp = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Make any saved or partial configuration valid for this app: unknown variants, options,
 * setups and kinds fall back to the manifest's first choice.
 */
export const normalizeConfig = (
  raw: unknown,
  manifest: AppManifest,
  newRoom: () => string,
  newKey: () => string = generateAdminKey,
): LandingConfig => {
  const r = isObject(raw) ? raw : {};
  const sameApp = r.app === manifest.id;

  const variants = manifest.variants ?? [];
  const variant =
    sameApp && variants.some((v) => v.id === r.variant)
      ? (r.variant as string)
      : (variants[0]?.id ?? null);

  const savedOptions = sameApp && isObject(r.options) ? r.options : {};
  const options: OptionValues = {};
  for (const def of manifest.options ?? [])
    options[def.key] = coerceOption(def, savedOptions[def.key]);

  const setups = supportedSetups(manifest);
  const setup = setups.includes(r.setup as SetupName)
    ? (r.setup as SetupName)
    : (setups[0] ?? "solo");
  const support = supportFor(manifest, setup);
  const kinds = support ? kindChoices(support) : [];
  const kind = kinds.includes(r.kind as FrameKind)
    ? (r.kind as FrameKind)
    : (kinds[0] ?? support?.kinds[0] ?? "panel");

  const spans = spanRange();
  const span = Math.round(clamp(r.span, spans.min, spans.max, spans.min));
  const count =
    setup === "solo"
      ? 1
      : Math.round(clamp(r.count, 1, COUNT_MAX, defaultCount(setup, kind, span)));

  const reachRaw = isObject(r.reach) ? r.reach : {};
  const reachDefault = defaultReach(kind, span);
  const reach = {
    adult: clamp(reachRaw.adult, 0.05, 1, reachDefault.adult),
    child: clamp(reachRaw.child, 0.05, 1, reachDefault.child),
  };
  if (reach.child > reach.adult) reach.child = reach.adult;

  // Keep a token the operator is still typing; the panel reports it if it is invalid.
  const room = typeof r.room === "string" ? r.room.trim().slice(0, 64) : newRoom();
  const ak = typeof r.ak === "string" ? r.ak.trim().slice(0, 64) : newKey();

  return {
    app: manifest.id,
    variant,
    options,
    setup,
    kind,
    count,
    span,
    screen: r.screen !== false,
    identity: r.identity === "manual" ? "manual" : "placeholders",
    // Every frame shares a room by default: it also carries admin and remote control.
    standalone: manifest.network !== "required" && r.standalone === true,
    room,
    ak,
    signalling: r.signalling === "custom" ? "custom" : "public",
    customPeer: typeof r.customPeer === "string" ? r.customPeer.slice(0, 300) : "",
    reachOverride: r.reachOverride === true,
    reach,
    idle: Math.round(clamp(r.idle, IDLE_RANGE.min, IDLE_RANGE.max, IDLE_DEFAULT)),
    res: snapNumber(
      clamp(r.res, RES_RANGE.min, RES_RANGE.max, 1),
      RES_RANGE.min,
      RES_RANGE.max,
      RES_RANGE.step,
    ),
    debug: r.debug === true,
  };
};

/**
 * Apply one change from the panel. A new setup, kind or span starts from its usual frame
 * count, and from that display's default reach unless the operator overrode reach.
 */
export const applyChange = (
  cfg: LandingConfig,
  patch: Partial<LandingConfig>,
  manifest: AppManifest,
  newRoom: () => string,
  newKey: () => string = generateAdminKey,
): LandingConfig => {
  const next = normalizeConfig({ ...cfg, ...patch }, manifest, newRoom, newKey);
  if (next.setup === cfg.setup && next.kind === cfg.kind && next.span === cfg.span) return next;
  return {
    ...next,
    count: "count" in patch ? next.count : defaultCount(next.setup, next.kind, next.span),
    reach: next.reachOverride ? next.reach : defaultReach(next.kind, next.span),
  };
};

/** Pasted tokens must be as hard to guess as generated ones: 10 or more of [a-z0-9]. */
export const validateRoom = (token: string): string | null => {
  if (!/^[a-z0-9]*$/.test(token)) return "Room token uses lowercase letters and digits only.";
  if (token.length < 10) return "Room token needs at least 10 characters.";
  if (token.length > 64) return "Room token is longer than 64 characters.";
  return null;
};

/** 128 random bits in base64url, as `generateAdminKey` makes them. */
export const validateAdminKey = (key: string): string | null =>
  /^[A-Za-z0-9_-]{22}$/.test(key) ? null : "Admin key is 22 letters, digits, - or _.";

export const validatePin = (pin: string): string | null => {
  if (pin === "") return null;
  if (!/^\d+$/.test(pin)) return "PIN uses digits only.";
  if (pin.length < 4 || pin.length > 8) return "PIN needs 4 to 8 digits.";
  return null;
};

/** The `peer` value: "public", or the server address with the shared secret as its `key`. */
export const peerValue = (cfg: LandingConfig, secret = ""): string =>
  cfg.signalling === "custom" ? withPeerKey(cfg.customPeer, secret) : "public";

/** Problems that stop the URLs from being usable, in the order the controls appear. */
export const configErrors = (cfg: LandingConfig, pin: string): string[] => {
  const errors: string[] = [];
  if (!cfg.standalone) {
    const room = validateRoom(cfg.room);
    if (room) errors.push(room);
    if (cfg.signalling === "custom") {
      const peer = validatePeer(cfg.customPeer);
      if (peer) errors.push(peer);
    }
    const pinError = validatePin(pin);
    if (pinError) errors.push(pinError);
    const keyError = pin ? validateAdminKey(cfg.ak) : null;
    if (keyError) errors.push(keyError);
  }
  return errors;
};
