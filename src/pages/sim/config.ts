import { optionShown } from "../../core/options";
import { coerceOptions } from "../../core/params";
import type { FrameKind, OptionDef } from "../../core/types";
import { encodeVenue, type VenueProfile, venueFromParam } from "../../core/venue";
import { splitPeer, withPeerKey } from "../signalling";
import { readVenueText } from "../venueprofile";
import { isPresetId, presetShortcuts, type PresetId, type SimFrame } from "./presets";
import {
  defaultVenue,
  parseVenueValue,
  profileOf,
  VENUE_FIELDS,
  type VenueKey,
  type VenueValues,
} from "./venue";

/**
 * How the frames reach each other: BroadcastChannel inside this tab, the public PeerJS
 * broker, or our own signalling server.
 */
export type SimNetwork = "local" | "public" | "own";

/** Everything the sim URL carries, plus the shared secret, which it never carries. */
export interface SimConfig {
  preset: PresetId;
  /** The venue profile the sim starts from, as the `venue` param carries it (empty: defaults). */
  profile: string;
  /** Bank shape and display sizes, on top of the profile. */
  venue: VenueValues;
  app: string;
  variant: string | null;
  /** Raw `o.<name>` values, passed to every frame running the sim's app. */
  options: Record<string, string>;
  network: SimNetwork;
  /** Own signalling server address, without its key. Kept while another network is chosen. */
  server: string;
  /** Shared secret for the own server. Frames get it; the sim's own URL never does. */
  secret: string;
  /** Null picks a res per frame from the scale it is drawn at. */
  res: number | null;
  room: string;
  bots: number;
  /** Per-frame app overrides (`fa.<frame>=<app>`), keyed by frame id. */
  apps: Record<string, string>;
  /** Runtime params passed straight through to every frame. */
  extra: Record<string, string>;
}

const PASS_THROUGH = ["seed", "debug", "idle", "ak", "pv"] as const;
const SAFE_TOKEN = /^[A-Za-z0-9_-]{1,64}$/;

export const DEFAULT_PRESET: PresetId = "bank";

/** Presets whose shape depends on `count` and `span`, which the URL then carries. */
const USES_COUNT: readonly PresetId[] = ["bank", "corner", "screen"];
const USES_SPAN: readonly PresetId[] = ["bank", "corner", "screen", "pair"];

/** An unguessable room token, so sim sessions on the public broker can't collide. */
export const newRoomToken = (): string => {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `sim${Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("")}`;
};

const parseRes = (value: string | null): number | null => {
  if (value === null || value === "auto") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0.1 && n <= 2 ? n : null;
};

export interface SimDefaults {
  /** The operator's remembered venue profile, for a URL without `venue`. */
  profile?: string;
  /** Display sizes remembered from the sim's Venue controls, for a URL without `venue`. */
  sizes?: Partial<VenueValues>;
}

/** The profile a config starts from. */
export const baseProfile = (c: Pick<SimConfig, "profile">): VenueProfile =>
  venueFromParam(c.profile);

/** The profile the sim's frames get: its base with the sim's own values applied. */
export const simProfile = (c: Pick<SimConfig, "profile" | "venue">): VenueProfile =>
  profileOf(c.venue, baseProfile(c));

/**
 * Venue values start from the `venue` param, or failing that from what the operator
 * remembered. A shortcut preset such as `bank-pairs` sets `count` and `span`; explicit URL
 * values win over both.
 */
export const parseSimUrl = (
  search: string,
  makeRoom: () => string = newRoomToken,
  defaults: SimDefaults = {},
): SimConfig => {
  const q = new URLSearchParams(search);
  const given = q.get("venue");
  const read = readVenueText(given ?? defaults.profile ?? "");
  const rawPreset = q.get("preset");
  const shortcut = rawPreset ? presetShortcuts(read.profile.bankCount)[rawPreset] : undefined;
  const preset = shortcut?.preset ?? (isPresetId(rawPreset) ? rawPreset : DEFAULT_PRESET);
  const venue: VenueValues = {
    ...defaultVenue(read.profile),
    ...(given === null ? defaults.sizes : {}),
  };
  if (shortcut) {
    venue.count = shortcut.count;
    venue.span = shortcut.span;
  }
  for (const field of VENUE_FIELDS) {
    const value = parseVenueValue(field.key, q.get(field.key));
    if (value !== null) venue[field.key] = value;
  }
  const room = q.get("room");
  const bots = Number(q.get("bots") ?? 0);
  const options: Record<string, string> = {};
  const apps: Record<string, string> = {};
  for (const [key, value] of q) {
    if (key.startsWith("o.") && key.length > 2) options[key.slice(2)] = value;
    if (key.startsWith("fa.") && key.length > 3 && SAFE_TOKEN.test(value)) {
      apps[key.slice(3)] = value;
    }
  }
  // A `peer` URL may carry the secret as `key`; it is split off so the address bar can drop it.
  const peer = q.get("peer");
  const own = peer && peer !== "public" ? splitPeer(peer) : { address: "", secret: "" };
  const network: SimNetwork =
    q.get("transport") === "peer" ? (own.address ? "own" : "public") : "local";
  const extra: Record<string, string> = {};
  for (const key of PASS_THROUGH) {
    const value = q.get(key);
    if (value !== null) extra[key] = value;
  }
  return {
    preset,
    profile: read.text,
    venue,
    app: q.get("app") || "idle",
    variant: q.get("variant") || null,
    options,
    network,
    server: own.address,
    secret: own.secret,
    res: parseRes(q.get("res")),
    room: room && SAFE_TOKEN.test(room) ? room : makeRoom(),
    bots: Number.isInteger(bots) && bots >= 0 && bots <= 16 ? bots : 0,
    apps,
    extra,
  };
};

/** The sim page query string for a config, in the order of the URL contract. */
export const simSearch = (c: SimConfig): string => {
  const q = new URLSearchParams();
  q.set("preset", c.preset);
  if (c.profile) q.set("venue", c.profile);
  const defaults = defaultVenue(baseProfile(c));
  for (const field of VENUE_FIELDS) {
    const key: VenueKey = field.key;
    const keep =
      key === "count"
        ? USES_COUNT.includes(c.preset)
        : key === "span"
          ? USES_SPAN.includes(c.preset)
          : c.venue[key] !== defaults[key];
    if (keep) q.set(key, String(c.venue[key]));
  }
  q.set("app", c.app);
  if (c.variant) q.set("variant", c.variant);
  for (const [k, v] of Object.entries(c.options)) q.set(`o.${k}`, v);
  q.set("transport", transportOf(c.network));
  // Only the address: the secret stays out of the address bar, history and shared links.
  if (c.network === "own" && c.server) q.set("peer", splitPeer(c.server).address);
  if (c.res !== null) q.set("res", String(c.res));
  q.set("room", c.room);
  if (c.bots > 0) q.set("bots", String(c.bots));
  for (const [k, v] of Object.entries(c.apps)) q.set(`fa.${k}`, v);
  for (const [k, v] of Object.entries(c.extra)) q.set(k, v);
  return `?${q.toString()}`;
};

const transportOf = (network: SimNetwork): "local" | "peer" =>
  network === "local" ? "local" : "peer";

/** The `peer` value for frames: the own server with its key, or null for the public broker. */
const framePeer = (c: SimConfig): string | null =>
  c.network === "own" && c.server ? withPeerKey(c.server, c.secret) : null;

/** An option without `kinds` applies to every frame kind. */
export const optionApplies = (def: Pick<OptionDef, "kinds"> | undefined, kind: FrameKind) =>
  !def?.kinds || def.kinds.includes(kind);

/**
 * The sim's options a frame of this kind gets in its URL: those shown for its kind, never text
 * (frames ignore text in a URL; admin sets it). Keys outside the schema pass through.
 */
export const frameOptions = (
  options: Readonly<Record<string, string>>,
  defs: readonly OptionDef[] | undefined,
  kind: FrameKind,
): [string, string][] => {
  const values = coerceOptions({ ...options }, defs);
  return Object.entries(options).filter(([k]) => {
    const def = defs?.find((d) => d.key === k);
    if (!def) return true;
    return def.type !== "text" && optionShown(def, defs, values, kind);
  });
};

/** Drop text options, which the sim never passes on, so its own address doesn't keep them. */
export const dropTextOptions = (c: SimConfig, defs: readonly OptionDef[] | undefined): void => {
  for (const def of defs ?? []) if (def.type === "text") delete c.options[def.key];
};

export interface FrameUrlOptions {
  /** The sim app's option schema, so options hidden on some frame kinds skip them. */
  optionDefs?: readonly OptionDef[];
  /** Render resolution, or null to leave the runtime default. */
  res: number | null;
  transport?: "local" | "peer";
  /** Letterbox size for device testing, e.g. on a phone. */
  fit?: { width: number; height: number };
  /** How sphere frames show: the flat feed, or a 3D ball to turn. Other kinds ignore it. */
  look?: "flat" | "globe";
}

/** The app a frame runs: its override if set, else the sim's app. */
export const frameApp = (c: SimConfig, f: SimFrame): string => c.apps[f.id] ?? c.app;

/** A `/play/` URL for one frame. `playBase` is the absolute URL of the play page. */
export const frameUrl = (
  playBase: string,
  f: SimFrame,
  c: SimConfig,
  opts: FrameUrlOptions,
): string => {
  const url = new URL(playBase);
  const q = url.searchParams;
  const app = frameApp(c, f);
  q.set("app", app);
  // Variant and options belong to the sim's app, so an overridden frame uses its own defaults.
  if (app === c.app) {
    if (c.variant) q.set("variant", c.variant);
    for (const [k, v] of frameOptions(c.options, opts.optionDefs, f.kind)) q.set(`o.${k}`, v);
  }
  q.set("setup", f.setup);
  q.set("role", f.role);
  q.set("pos", String(f.pos));
  q.set("count", String(f.count));
  q.set("group", f.group);
  if (f.side) q.set("side", f.side);
  q.set("frame", f.id);
  q.set("zone", f.zone);
  q.set("display", f.display);
  q.set("name", f.name);
  q.set("kind", f.kind);
  if (f.kind === "pair") q.set("span", String(f.span));
  q.set("w", String(f.width));
  q.set("h", String(f.height));
  const venue = encodeVenue(simProfile(c));
  if (venue) q.set("venue", venue);
  // A sphere's physical box is the ball: its width is the diameter, its bottom the lowest point.
  if (f.kind === "sphere") q.set("sphere", `${f.phys.w},${f.phys.y}`);
  if (f.kind === "sphere" && opts.look === "globe") q.set("look", "globe");
  if (f.reach) q.set("reach", `${f.reach.adult.toFixed(3)},${f.reach.child.toFixed(3)}`);
  q.set("room", c.room);
  const transport = opts.transport ?? transportOf(c.network);
  q.set("transport", transport);
  const peer = framePeer(c);
  if (transport === "peer" && peer) q.set("peer", peer);
  if (opts.res !== null) q.set("res", String(opts.res));
  if (opts.fit) q.set("fit", `${opts.fit.width}x${opts.fit.height}`);
  if (c.bots > 0) q.set("bots", String(c.bots));
  for (const [k, v] of Object.entries(c.extra)) q.set(k, v);
  return url.toString();
};

/**
 * The URL a phone opens to take a frame's place: letterboxed, over PeerJS, full res. It
 * carries the own server's key, because the phone needs it to join.
 */
export const phoneUrl = (
  playBase: string,
  f: SimFrame,
  c: SimConfig,
  optionDefs?: readonly OptionDef[],
): string =>
  frameUrl(playBase, f, c, {
    optionDefs,
    res: null,
    transport: "peer",
    fit: { width: f.width, height: f.height },
  });
