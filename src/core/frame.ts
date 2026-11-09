import type { Params } from "./params";
import { sphereInfo } from "./sphere";
import type { FrameInfo, FrameKind, Identity, Reach, Role, SetupInfo, SetupName } from "./types";
import { activeVenue, DEFAULT_VENUE, displayFor, reachFor } from "./venue";

/**
 * How many panels a frame spans: the `span` param, the host's display list, or the frame's
 * width in panels when its height is one panel's.
 */
export const spanOf = (params: Params, identity: Identity, kind: FrameKind): number => {
  if (kind !== "pair") return 1;
  if (params.span) return params.span;
  if (identity.displays && identity.displays.length > 1) return identity.displays.length;
  const panel = activeVenue().panel;
  if (params.w && params.h === panel.height) return Math.max(2, Math.round(params.w / panel.width));
  return 2;
};

/**
 * Pixel size of a frame kind in this page's venue (a merged frame is two panels unless `span`
 * says otherwise).
 */
export const venueSize = (kind: FrameKind, span = 2): { width: number; height: number } => {
  const d = displayFor(kind, span);
  return { width: d.width, height: d.height };
};

/** Reach of a frame kind in this page's venue, from the display's physical mounting. */
export const kindReach = (kind: FrameKind, span = 2): Reach => reachFor(displayFor(kind, span));

const KINDS: readonly FrameKind[] = ["panel", "pair", "wall", "screen", "kiosk", "sphere"];

const perKind = <T>(f: (kind: FrameKind) => T): Record<FrameKind, T> =>
  Object.fromEntries(KINDS.map((k) => [k, f(k)])) as Record<FrameKind, T>;

/** Pixel size of each frame kind in the default venue, for tests and scripts. */
export const VENUE_SIZE: Record<FrameKind, { width: number; height: number }> = perKind((k) => {
  const d = displayFor(k, 2, DEFAULT_VENUE);
  return { width: d.width, height: d.height };
});

/** Reach of each frame kind in the default venue, for tests and scripts. */
export const DEFAULT_REACH: Record<FrameKind, Reach> = perKind((k) =>
  reachFor(displayFor(k, 2, DEFAULT_VENUE)),
);

const kindFromAspect = (width: number, height: number, touch: boolean): FrameKind => {
  const aspect = width / height;
  if (aspect < 0.75) return "panel";
  if (aspect > 2.2) return "wall";
  if (aspect > 1.4) return "kiosk";
  return touch ? "pair" : "screen";
};

/** The kind whose display in this venue has exactly this size, preferring one that matches `touch`. */
const kindFromSize = (width: number, height: number, touch: boolean): FrameKind | null => {
  const venue = activeVenue();
  const matches: FrameKind[] = (["panel", "wall", "kiosk", "screen"] as const).filter((k) => {
    const d = displayFor(k, 1, venue);
    return d.width === width && d.height === height;
  });
  for (let n = 2; n <= Math.max(2, venue.maxMerge); n++) {
    const d = displayFor("pair", n, venue);
    if (d.width === width && d.height === height) matches.push("pair");
  }
  return matches.find((k) => displayFor(k, 2, venue).touch === touch) ?? matches[0] ?? null;
};

/**
 * Kind from, in order: the `kind` param, the host's display role, then the frame's size in the
 * venue profile, then its shape. A
 * sphere's feed looks like any wide frame, so only the `kind` param makes one.
 */
export const inferKind = (
  params: Params,
  identity: Identity,
  viewport: { width: number; height: number },
): FrameKind => {
  if (params.kind) return params.kind;
  if (identity.hostRole === "PRESENTATION") return "screen";
  if (identity.hostRole === "KIOSK") return "kiosk";
  if (identity.displays && identity.displays.length > 1) return "pair";
  const size = params.fit ?? (params.w && params.h ? { width: params.w, height: params.h } : null);
  const { width, height } = size ?? viewport;
  const touch = identity.hostRole ? identity.hostRole !== "STANDARD" : navigator.maxTouchPoints > 0;
  return kindFromSize(width, height, touch) ?? kindFromAspect(width, height, touch);
};

export const computeFrame = (
  kind: FrameKind,
  stage: { width: number; height: number },
  params: Params,
  span = 1,
): FrameInfo => {
  // Prefer the pixel size the host reports; fall back to the kind's default display.
  const display = displayFor(kind, span);
  const venueWidth = params.w ?? display.width;
  const venueHeight = params.h ?? display.height;
  const reach = params.reach ?? reachFor(display);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const seams: number[] = [];
  if (kind === "pair") {
    for (let i = 1; i < span; i++) seams.push((stage.width * i) / span);
  }
  return {
    kind,
    span: kind === "pair" ? span : 1,
    venueWidth,
    venueHeight,
    width: stage.width,
    height: stage.height,
    unit: Math.min(stage.width / venueWidth, stage.height / venueHeight),
    pixelRatio: dpr * params.res,
    touch: display.touch,
    reach,
    reachTop: {
      adult: stage.height * (1 - reach.adult),
      child: stage.height * (1 - reach.child),
    },
    seams,
    ...(kind === "sphere"
      ? {
          sphere: sphereInfo(undefined, {
            diameter: params.sphere?.diameter,
            bottom: params.sphere?.bottom ?? undefined,
            cover: params.cover ?? undefined,
            view: params.view ?? undefined,
          }),
        }
      : {}),
  };
};

export const computeSetup = (params: Params, identity: Identity, kind: FrameKind): SetupInfo => {
  const name: SetupName = params.setup ?? "solo";
  const role: Role =
    params.role ?? (kind === "screen" ? "screen" : name === "solo" ? "solo" : "station");
  const me = identity.siblings.find((s) => s.frame === identity.frame);
  // A screen's count is the number of touch frames it serves. The host lists only frames showing
  // the same URL, so a screen with its own URL (as the landing panel makes) sees no touch
  // siblings and relies on the `count` written into its URL. The host's `{count}` token counts
  // screens, so the landing panel never puts it on a screen.
  const touchFrames = identity.siblings.filter(
    (s) => s.role === "TOUCHSCREEN" || s.role === "KIOSK",
  ).length;
  const count =
    role === "screen" ? touchFrames || params.count || 1 : (params.count ?? me?.count ?? 1);
  return {
    name,
    role,
    pos: params.pos ?? me?.index ?? 0,
    count,
    group: params.group ?? identity.zone ?? "main",
    side: params.side ?? 0,
  };
};
