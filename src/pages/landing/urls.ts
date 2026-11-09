import { optionShown } from "../../core/options";
import { displayFor } from "../../core/venue";
import type {
  AppManifest,
  FrameKind,
  OptionDef,
  OptionValue,
  Role,
  SetupName,
} from "../../core/types";
import {
  appEntries,
  IDLE_DEFAULT,
  type LandingConfig,
  optionDefault,
  peerValue,
  screenSupported,
  setupKinds,
  spanFor,
  supportFor,
  touchKind,
} from "./config";

type Pair = readonly [string, string];

/** Identity tokens the host replaces in each frame's URL. Keys are our params, values the host's tokens. */
export const PLACEHOLDERS: readonly Pair[] = [
  ["frame", "{frame}"],
  ["zone", "{zone}"],
  ["display", "{display}"],
  ["displays", "{displays}"],
  ["name", "{name}"],
  ["hostrole", "{role}"],
  ["pos", "{index}"],
  ["count", "{count}"],
  ["w", "{w}"],
  ["h", "{h}"],
  ["mode", "{mode}"],
];

const TOKEN = /^\{[a-zA-Z]+\}$/;

/**
 * Host tokens must stay literal so the host can find them. Everything else is encoded,
 * except ":", "/" and "," which are legal in a query and keep wss:// and reach readable.
 */
const encodeValue = (value: string): string =>
  TOKEN.test(value)
    ? value
    : encodeURIComponent(value).replace(/%3A/gi, ":").replace(/%2F/gi, "/").replace(/%2C/gi, ",");

export const buildQuery = (pairs: readonly Pair[]): string =>
  pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeValue(v)}`).join("&");

const withQuery = (base: string, pairs: readonly Pair[]): string => {
  const url = base.split("#")[0]?.split("?")[0] ?? base;
  return pairs.length ? `${url}?${buildQuery(pairs)}` : url;
};

export const formatOption = (def: OptionDef, value: OptionValue): string => {
  if (def.type === "boolean") return value ? "1" : "0";
  if (def.type === "apps") return appEntries(value).join(",");
  return String(value);
};

const formatFraction = (n: number): string => String(Number(n.toFixed(2)));

/**
 * `app`, `variant` and every `o.<name>` shown for these frame kinds, written out in full so a
 * URL never depends on defaults. Text options never go in a URL: frames ignore them there, and
 * operator text travels only in signed admin commands.
 */
export const appPairs = (
  cfg: LandingConfig,
  manifest: AppManifest,
  kinds: readonly FrameKind[],
): Pair[] => {
  const pairs: Pair[] = [["app", manifest.id]];
  if (manifest.variants?.length && cfg.variant) pairs.push(["variant", cfg.variant]);
  for (const def of manifest.options ?? []) {
    if (def.type === "text" || !optionShown(def, manifest.options, cfg.options, kinds)) continue;
    const value = cfg.options[def.key] ?? optionDefault(def);
    pairs.push([`o.${def.key}`, formatOption(def, value)]);
  }
  return pairs;
};

export type Side = "" | "left" | "right" | "a" | "b";

/** One physical frame in the chosen setup. */
export interface PlanFrame {
  side: Side;
  /** 0 or 1 on two-sided setups (written as `side=a` or `side=b`), null otherwise. */
  sideIndex: number | null;
  role: Role;
  kind: FrameKind;
  /** Panels in this frame: more than 1 only for a merged `pair` frame. */
  span: number;
  /** 0-based position among its side's touch frames, left to right. 0 for screens. */
  pos: number;
  /** Touch frames on its side. For a screen, the touch frames it serves. */
  count: number;
  group: string | null;
  /** Stable id used for manual identity, e.g. `left-panel-3`. */
  id: string;
}

export interface PlanSide {
  side: Side;
  stations: PlanFrame[];
  screen: PlanFrame | null;
}

export interface Plan {
  setup: SetupName;
  sides: PlanSide[];
}

const frameId = (side: Side, kind: FrameKind, n: number | null): string =>
  [side, kind, n].filter((part) => part !== "" && part !== null).join("-");

/** Shared group for two-sided setups, so the app channel spans both sides. */
const TWO_SIDED_GROUP: Partial<Record<SetupName, string>> = { corner: "corner", versus: "match" };

/** Lay out the frames a setup needs. Positions are per side, as the host's `{index}` gives them. */
export const planSetup = (cfg: LandingConfig, manifest: AppManifest): Plan => {
  const support = supportFor(manifest, cfg.setup);
  if (cfg.setup === "solo" || !support) {
    const role: Role = cfg.kind === "screen" ? "screen" : "solo";
    const frame: PlanFrame = {
      side: "",
      sideIndex: null,
      role,
      kind: cfg.kind,
      span: spanFor(cfg.kind, cfg.span),
      pos: 0,
      count: 1,
      group: null,
      id: cfg.kind,
    };
    return { setup: "solo", sides: [{ side: "", stations: [frame], screen: null }] };
  }

  const hasStations = cfg.kind !== "screen";
  const hasScreen = cfg.screen && screenSupported(support);
  const sides: Side[] =
    cfg.setup === "corner" ? ["left", "right"] : cfg.setup === "versus" ? ["a", "b"] : [""];
  const group = TWO_SIDED_GROUP[cfg.setup] ?? null;
  const n = hasStations ? cfg.count : 0;

  return {
    setup: cfg.setup,
    sides: sides.map((side, s) => {
      const sideIndex = sides.length > 1 ? s : null;
      const stations = Array.from({ length: n }, (_, i) => ({
        side,
        sideIndex,
        role: "station" as const,
        kind: cfg.kind,
        span: spanFor(cfg.kind, cfg.span),
        pos: i,
        count: n,
        group,
        id: frameId(side, cfg.kind, n > 1 ? i + 1 : null),
      }));
      const screen: PlanFrame | null = hasScreen
        ? {
            side,
            sideIndex,
            role: "screen",
            kind: "screen",
            span: 1,
            pos: 0,
            count: Math.max(1, n),
            group,
            id: frameId(side, "screen", null),
          }
        : null;
      return { side, stations, screen };
    }),
  };
};

export const planFrames = (plan: Plan): PlanFrame[] =>
  plan.sides.flatMap((s) => (s.screen ? [...s.stations, s.screen] : s.stations));

export interface UrlEntry {
  key: string;
  label: string;
  /** Where the URL goes, in a few words. */
  note: string;
  role: Role;
  kind: FrameKind;
  url: string;
  frames: PlanFrame[];
  /** Colour slot shared with the layout diagram. */
  tone: number;
}

export interface UrlInputs {
  /** Absolute URL of the player page, e.g. `new URL("./play/", location.href)`. */
  playBase: string;
  /** Admin key and PIN verifier. Both or neither: without a PIN, admin is off. */
  ak: string | null;
  pv?: string | null;
  /** Shared secret for a custom signalling server, kept apart from the saved configuration. */
  secret?: string;
  /** The operator's venue profile as the `venue` param carries it; empty for the defaults. */
  venue?: string;
}

/** Singular and plural names. A merge of more than two panels is named by its size. */
const kindName = (kind: FrameKind, span: number): [string, string] =>
  kind === "pair" && span > 2 ? [`${span}-panel frame`, `${span}-panel frames`] : KIND_NAME[kind];

const KIND_NAME: Record<FrameKind, [string, string]> = {
  panel: ["panel", "panels"],
  pair: ["pair", "pairs"],
  wall: ["wall", "walls"],
  kiosk: ["kiosk", "kiosks"],
  screen: ["screen", "screens"],
  sphere: ["sphere", "spheres"],
};

const SIDE_NAME: Record<Side, string> = {
  "": "",
  left: "left",
  right: "right",
  a: "side A",
  b: "side B",
};

const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

export const toneFor = (frame: PlanFrame): number =>
  (frame.sideIndex === 1 ? 2 : 0) + (frame.role === "screen" ? 1 : 0);

const framePairs = (cfg: LandingConfig, frame: PlanFrame, manual: boolean): Pair[] => {
  const pairs: Pair[] = [
    ["setup", cfg.setup],
    ["role", frame.role],
    ["kind", frame.kind],
  ];
  if (frame.kind === "pair") pairs.push(["span", String(frame.span)]);
  if (frame.group) pairs.push(["group", frame.group]);
  if (frame.sideIndex !== null) pairs.push(["side", frame.sideIndex === 1 ? "b" : "a"]);
  if (manual) {
    pairs.push(["frame", frame.id]);
    // A screen has no position; its count is the touch frames it serves.
    if (frame.role !== "screen") pairs.push(["pos", String(frame.pos)]);
    pairs.push(["count", String(frame.count)]);
  } else if (frame.role === "screen" && cfg.setup !== "solo") {
    // The host lists only frames showing the same URL, so it can't tell this screen its bank's size.
    pairs.push(["count", String(frame.count)]);
  }
  return pairs;
};

/**
 * Screens get no `pos` or `count` tokens: the host's `{count}` counts screens, not the touch
 * frames below, so a screen's count is written into its URL instead.
 */
const placeholdersFor = (frame: PlanFrame): readonly Pair[] =>
  frame.role === "screen"
    ? PLACEHOLDERS.filter(([k]) => k !== "pos" && k !== "count")
    : PLACEHOLDERS;

const venuePairs = (venue: string | undefined): Pair[] => (venue ? [["venue", venue]] : []);

const networkPairs = (cfg: LandingConfig, inputs: UrlInputs): Pair[] => {
  if (cfg.standalone) return [];
  const pairs: Pair[] = [["room", cfg.room]];
  const peer = peerValue(cfg, inputs.secret);
  const { ak, pv } = inputs;
  if (peer !== "public") pairs.push(["peer", peer]);
  if (ak && pv) pairs.push(["ak", ak], ["pv", pv]);
  return pairs;
};

const advancedPairs = (cfg: LandingConfig, frame: PlanFrame): Pair[] => {
  const pairs: Pair[] = [];
  if (cfg.reachOverride && touchKind(frame.kind)) {
    pairs.push(["reach", `${formatFraction(cfg.reach.adult)},${formatFraction(cfg.reach.child)}`]);
  }
  if (cfg.idle !== IDLE_DEFAULT) pairs.push(["idle", String(cfg.idle)]);
  if (cfg.res !== 1) pairs.push(["res", String(cfg.res)]);
  if (cfg.debug) pairs.push(["debug", "1"]);
  return pairs;
};

export const frameUrl = (
  cfg: LandingConfig,
  manifest: AppManifest,
  frame: PlanFrame,
  inputs: UrlInputs,
): string => {
  const manual = cfg.identity === "manual";
  return withQuery(inputs.playBase, [
    ...appPairs(cfg, manifest, [frame.kind]),
    ...framePairs(cfg, frame, manual),
    ...venuePairs(inputs.venue),
    ...networkPairs(cfg, inputs),
    ...advancedPairs(cfg, frame),
    ...(manual ? [] : placeholdersFor(frame)),
  ]);
};

/** Where a side is, as a phrase: "in the left bank" or "on side A". */
const sidePlace = (side: Side): string =>
  side === "left" || side === "right" ? `in the ${side} bank` : side ? `on ${SIDE_NAME[side]}` : "";

const describeEntry = (cfg: LandingConfig, first: PlanFrame): { label: string; note: string } => {
  const [one, many] = kindName(first.kind, first.span);
  const side = SIDE_NAME[first.side];
  const place = sidePlace(first.side);
  const prefix = side ? `${capital(side)} ` : "";

  if (first.role === "solo" || (cfg.setup === "solo" && first.role === "screen")) {
    const what = first.kind === "pair" && first.span === 2 ? "merged pair of panels" : one;
    return { label: capital(one), note: `the one ${what} it runs on` };
  }

  if (first.role === "screen") {
    if (cfg.setup === "corner")
      return { label: `${prefix}screen`, note: `the screen above the ${side} bank` };
    if (side) return { label: `${prefix}screen`, note: `the screen above ${side}` };
    return { label: "Screen", note: "the screen above" };
  }

  // Manual identity: one frame per URL.
  if (cfg.identity === "manual") {
    if (cfg.count === 1) {
      return {
        label: `${prefix}${side ? one : capital(one)}`,
        note: `the ${one}${place ? ` ${place}` : ""}`,
      };
    }
    const n = first.pos + 1;
    const where = place ? `, ${place}` : "";
    return {
      label: `${prefix}${side ? one : capital(one)} ${n}`,
      note: `${n} of ${cfg.count} from the left${where}`,
    };
  }

  const merged = first.kind === "pair";
  const touch = merged ? (first.span === 2 ? "merged pair" : one) : `touch ${one}`;
  const touchMany = merged ? (first.span === 2 ? "merged pairs" : many) : `touch ${many}`;
  if (cfg.setup === "versus" && cfg.count === 1) {
    return { label: `${prefix}${one}`, note: `the ${one} ${place}` };
  }
  return {
    label: `${prefix}${side ? touchMany : capital(touchMany)}`,
    note: `every ${touch} ${place || "in the bank"}`,
  };
};

/**
 * Every URL the operator pastes into the host. Frames whose URLs come out identical (all
 * the panels of a bank under host placeholders) share one entry.
 */
export const buildUrls = (
  cfg: LandingConfig,
  manifest: AppManifest,
  inputs: UrlInputs,
): UrlEntry[] => {
  const plan = planSetup(cfg, manifest);
  const byUrl = new Map<string, PlanFrame[]>();
  // Stations first, then screens, so the list reads bottom-up like the installation.
  const ordered = [
    ...plan.sides.flatMap((s) => s.stations),
    ...plan.sides.flatMap((s) => (s.screen ? [s.screen] : [])),
  ];
  for (const frame of ordered) {
    const url = frameUrl(cfg, manifest, frame, inputs);
    const list = byUrl.get(url);
    if (list) list.push(frame);
    else byUrl.set(url, [frame]);
  }
  return [...byUrl].map(([url, frames]) => {
    const first = frames[0] as PlanFrame;
    const { label, note } = describeEntry(cfg, first);
    return {
      key: cfg.identity === "manual" ? first.id : `${first.side || "all"}-${first.role}`,
      label,
      note,
      role: first.role,
      kind: first.kind,
      url,
      frames,
      tone: toneFor(first),
    };
  });
};

/** Simulator preset that matches a setup and touch kind. */
export const simPreset = (setup: SetupName, kind: FrameKind): string =>
  setup === "solo" ? kind : setup;

/**
 * The sim link: the preset for the setup, plus the bank size and span when they apply, and the
 * venue profile. The idle timeout, debug output and admin carry over, so the sim's frames
 * behave like the real ones; the sim makes its own room.
 */
export const simUrl = (
  cfg: LandingConfig,
  manifest: AppManifest,
  simBase: string,
  admin: { ak: string; pv: string } | null = null,
  venue = "",
): string => {
  const pairs: Pair[] = [["preset", simPreset(cfg.setup, cfg.kind)], ...venuePairs(venue)];
  const banked = cfg.setup === "bank" || cfg.setup === "corner";
  if (cfg.setup !== "solo" && cfg.kind !== "screen") pairs.push(["count", String(cfg.count)]);
  if (cfg.kind === "pair" || banked) pairs.push(["span", String(spanFor(cfg.kind, cfg.span))]);
  const extra: Pair[] = [];
  if (cfg.idle !== IDLE_DEFAULT) extra.push(["idle", String(cfg.idle)]);
  if (cfg.debug) extra.push(["debug", "1"]);
  if (admin) extra.push(["ak", admin.ak], ["pv", admin.pv]);
  return withQuery(simBase, [
    ...pairs,
    ...appPairs(cfg, manifest, setupKinds(cfg, manifest)),
    ...extra,
  ]);
};

export const adminUrl = (
  cfg: LandingConfig,
  admin: { ak: string; pv: string },
  adminBase: string,
  secret = "",
): string =>
  withQuery(adminBase, [
    ["room", cfg.room],
    ["ak", admin.ak],
    ["pv", admin.pv],
    ["peer", peerValue(cfg, secret)],
  ]);

/**
 * The URL to preview: the first touch entry, letterboxed to its kind and forced into preview. A
 * sphere's flat feed is hard to read, so its preview shows the ball, which can flip to the feed.
 */
export const previewUrl = (entries: readonly UrlEntry[]): string | null => {
  const entry = entries.find((e) => e.role !== "screen") ?? entries[0];
  if (!entry) return null;
  const size = displayFor(entry.kind, entry.frames[0]?.span ?? 1);
  const look = entry.kind === "sphere" ? "&look=globe" : "";
  return `${entry.url}&preview=1&fit=${size.width}x${size.height}${look}`;
};

/** Plain text for "Copy all": one labelled block per URL. */
export const urlListText = (entries: readonly UrlEntry[]): string =>
  entries.map((e) => `${e.label} (${e.note})\n${e.url}`).join("\n\n") + "\n";
