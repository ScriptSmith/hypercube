import type { FrameKind, Reach, Role, SetupName } from "../../core/types";
import {
  DEFAULT_VENUE,
  type DisplaySpec,
  displayFor,
  reachFor,
  type VenueProfile,
} from "../../core/venue";
import { FACING_GAP, PERSON, SPHERE_HANG } from "./physical";
import { defaultVenue, profileOf, type VenueValues } from "./venue";

export const PRESET_IDS = [
  "panel",
  "pair",
  "wall",
  "kiosk",
  "screen",
  "bank",
  "corner",
  "versus",
  "sphere",
] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export const PRESET_TITLES: Record<PresetId, string> = {
  panel: "Panel",
  pair: "Merged panels",
  wall: "Wall",
  kiosk: "Kiosk",
  screen: "Screen",
  bank: "Bank and screen",
  corner: "Corner: two banks",
  versus: "Versus: two walls",
  sphere: "Sphere",
};

export interface PresetShortcut {
  preset: PresetId;
  title: string;
  count: number;
  span: number;
}

/** Banks of the venue's usual size, as panels or as merged pairs. */
export const presetShortcuts = (bankCount: number): Record<string, PresetShortcut> => ({
  "bank-panels": { preset: "bank", title: "Bank of panels", count: bankCount, span: 1 },
  "bank-pairs": {
    preset: "bank",
    title: "Bank of pairs",
    count: Math.max(1, Math.floor(bankCount / 2)),
    span: 2,
  },
});

export const isPresetId = (value: string | null): value is PresetId =>
  value !== null && (PRESET_IDS as readonly string[]).includes(value);

/** Metres. `x` runs left to right across the unfolded room; `y` is the bottom edge above the floor. */
export interface PhysRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SimFrame {
  /** The `frame` identity param, unique within the sim. */
  id: string;
  zone: string;
  zoneLabel: string;
  display: string;
  name: string;
  /** A few characters for the status badge. */
  short: string;
  kind: FrameKind;
  /** Panels merged into this frame; 1 unless it is a `pair`. */
  span: number;
  setup: SetupName;
  role: Role;
  /** Per side in two-sided setups. */
  pos: number;
  count: number;
  group: string;
  /** Which side of a corner or versus setup, which share one group; null elsewhere. */
  side: "a" | "b" | null;
  /** True pixel size of the iframe. */
  width: number;
  height: number;
  /** Reach from the display's mounting height, or null for a screen. */
  reach: Reach | null;
  /** Physical display area. The content is fitted inside it, so a merged frame keeps its aspect. */
  phys: PhysRect;
}

export interface SimZone {
  id: string;
  label: string;
  x0: number;
  x1: number;
  note?: string;
}

export interface Person {
  x: number;
  height: number;
  kind: "adult" | "child";
}

export interface SimPreset {
  id: PresetId;
  title: string;
  frames: SimFrame[];
  zones: SimZone[];
  /** x positions where two walls meet at a right angle, drawn unfolded. */
  corners: number[];
  people: Person[];
  /** Height of a ceiling line to draw, metres, for frames that hang from it. */
  ceiling?: number;
}

interface ZoneSpec {
  id: "a" | "b";
  label: string;
}

const ZONE_A: ZoneSpec = { id: "a", label: "Zone A" };
const ZONE_B: ZoneSpec = { id: "b", label: "Zone B" };

interface SetupSpec {
  setup: SetupName;
  /** Touch frames on one side, which is the whole setup unless it has two sides. */
  count: number;
  group: string;
  twoSided: boolean;
}

const SOLO: SetupSpec = { setup: "solo", count: 1, group: "main", twoSided: false };

const labels = (zone: ZoneSpec, kind: FrameKind, index: number, span: number) => {
  const letter = zone.id.toUpperCase();
  const n = index + 1;
  const first = index * span + 1;
  const last = first + span - 1;
  switch (kind) {
    case "panel":
      return { slot: `p${n}`, short: `${letter}${n}`, name: `panel ${n}` };
    case "pair":
      return {
        slot: `pair${n}`,
        short: span === 2 ? `${letter}${first}+${last}` : `${letter}${first}-${last}`,
        name: span === 2 ? `pair ${n}` : `panels ${first} to ${last}`,
      };
    case "wall":
      return { slot: "wall", short: `${letter} wall`, name: "wall" };
    case "kiosk":
      return { slot: "kiosk", short: `${letter} kiosk`, name: "kiosk" };
    case "screen":
      return { slot: "screen", short: `${letter} scr`, name: "screen" };
    case "sphere":
      return { slot: "sphere", short: `${letter} sphere`, name: "sphere" };
  }
};

const makeFrame = (
  zone: ZoneSpec,
  kind: FrameKind,
  index: number,
  pos: number,
  setup: SetupSpec,
  x: number,
  display: DisplaySpec,
  span = 1,
): SimFrame => {
  const l = labels(zone, kind, index, span);
  const id = `${zone.id}-${l.slot}`;
  return {
    id,
    zone: zone.id,
    zoneLabel: zone.label,
    display: id,
    name: `${zone.label} ${l.name}`,
    short: l.short,
    kind,
    span: kind === "pair" ? span : 1,
    setup: setup.setup,
    role: kind === "screen" ? "screen" : setup.setup === "solo" ? "solo" : "station",
    pos,
    count: setup.count,
    group: setup.group,
    side: setup.twoSided ? zone.id : null,
    width: display.width,
    height: display.height,
    reach: display.touch ? reachFor(display) : null,
    phys: { x, y: display.bottomM, w: display.widthM, h: display.heightM },
  };
};

/** The touch frames of a bank: `span` panels each, so a bank of one-panel frames is panels. */
const bankDisplay = (venue: VenueValues, profile: VenueProfile) => {
  const kind: FrameKind = venue.span > 1 ? "pair" : "panel";
  return { kind, display: displayFor(kind, venue.span, profile) };
};

const rowWidth = (venue: VenueValues, profile: VenueProfile): number => {
  const { display } = bankDisplay(venue, profile);
  return venue.count * display.widthM + (venue.count - 1) * profile.bezelM;
};

const touchRow = (
  zone: ZoneSpec,
  x0: number,
  setup: SetupSpec,
  venue: VenueValues,
  profile: VenueProfile,
): SimFrame[] => {
  const { kind, display } = bankDisplay(venue, profile);
  const pitch = display.widthM + profile.bezelM;
  return Array.from({ length: venue.count }, (_, i) =>
    makeFrame(zone, kind, i, i, setup, x0 + i * pitch, display, venue.span),
  );
};

/** The screen above a bank spans it exactly; its height follows its pixel aspect. */
const screenOver = (
  zone: ZoneSpec,
  x: number,
  width: number,
  setup: SetupSpec,
  profile: VenueProfile,
): SimFrame => {
  const s = profile.screen;
  const display: DisplaySpec = { ...s, widthM: width, heightM: (width * s.height) / s.width };
  return makeFrame(zone, "screen", 0, 0, setup, x, display);
};

const peopleLeftOf = (x: number): Person[] => [
  { x: x - 1.15, height: PERSON.adult, kind: "adult" },
  { x: x - 0.5, height: PERSON.child, kind: "child" },
];

const peopleRightOf = (x: number): Person[] => [
  { x: x + 0.5, height: PERSON.child, kind: "child" },
  { x: x + 1.15, height: PERSON.adult, kind: "adult" },
];

const single = (id: PresetId, frame: SimFrame): SimPreset => ({
  id,
  title: PRESET_TITLES[id],
  frames: [frame],
  zones: [{ ...ZONE_A, x0: 0, x1: frame.phys.w }],
  corners: [],
  people: peopleLeftOf(0),
});

const bank = (venue: VenueValues, profile: VenueProfile): SimPreset => {
  const setup: SetupSpec = { setup: "bank", count: venue.count, group: "main", twoSided: false };
  const width = rowWidth(venue, profile);
  return {
    id: "bank",
    title: PRESET_TITLES.bank,
    frames: [
      screenOver(ZONE_A, 0, width, setup, profile),
      ...touchRow(ZONE_A, 0, setup, venue, profile),
    ],
    zones: [{ ...ZONE_A, x0: 0, x1: width }],
    corners: [],
    people: peopleLeftOf(0),
  };
};

const corner = (venue: VenueValues, profile: VenueProfile): SimPreset => {
  // Both sides share one group so their app channels reach each other; pos is per side.
  const setup: SetupSpec = {
    setup: "corner",
    count: venue.count,
    group: "corner",
    twoSided: true,
  };
  const width = rowWidth(venue, profile);
  // The rows meet at the corner, so the screens above them join there too.
  const bX0 = width;
  return {
    id: "corner",
    title: PRESET_TITLES.corner,
    frames: [
      screenOver(ZONE_A, 0, width, setup, profile),
      ...touchRow(ZONE_A, 0, setup, venue, profile),
      screenOver(ZONE_B, bX0, width, setup, profile),
      ...touchRow(ZONE_B, bX0, setup, venue, profile),
    ],
    zones: [
      { ...ZONE_A, x0: 0, x1: width },
      { ...ZONE_B, x0: bX0, x1: bX0 + width },
    ],
    corners: [bX0],
    people: [...peopleLeftOf(0), ...peopleRightOf(bX0 + width)],
  };
};

const versus = (profile: VenueProfile): SimPreset => {
  const setup: SetupSpec = { setup: "versus", count: 1, group: "versus", twoSided: true };
  const wall = displayFor("wall", 1, profile);
  const bX0 = wall.widthM + FACING_GAP;
  return {
    id: "versus",
    title: PRESET_TITLES.versus,
    frames: [
      makeFrame(ZONE_A, "wall", 0, 0, setup, 0, wall),
      makeFrame(ZONE_B, "wall", 0, 0, setup, bX0, wall),
    ],
    zones: [
      { ...ZONE_A, x0: 0, x1: wall.widthM },
      { ...ZONE_B, x0: bX0, x1: bX0 + wall.widthM },
    ],
    corners: [],
    people: [...peopleLeftOf(0), ...peopleRightOf(bX0 + wall.widthM)],
  };
};

/** A ball hung from the ceiling, with people beside it and walking underneath. */
const sphere = (profile: VenueProfile): SimPreset => {
  const display = displayFor("sphere", 1, profile);
  const d = display.widthM;
  return {
    id: "sphere",
    title: PRESET_TITLES.sphere,
    frames: [makeFrame(ZONE_A, "sphere", 0, 0, SOLO, 0, display)],
    zones: [{ ...ZONE_A, x0: 0, x1: d }],
    corners: [],
    people: [
      ...peopleLeftOf(0),
      { x: d / 2 - 0.6, height: PERSON.adult, kind: "adult" },
      { x: d / 2 + 0.6, height: PERSON.child, kind: "child" },
    ],
    ceiling: display.bottomM + d + SPHERE_HANG,
  };
};

/** `base` is the venue profile the sim's values were made from. */
export const buildPreset = (
  id: PresetId,
  venue: VenueValues = defaultVenue(),
  base: VenueProfile = DEFAULT_VENUE,
): SimPreset => {
  const profile = profileOf(venue, base);
  switch (id) {
    case "panel":
    case "wall":
    case "kiosk":
      return single(id, makeFrame(ZONE_A, id, 0, 0, SOLO, 0, displayFor(id, 1, profile)));
    case "pair": {
      const span = Math.max(2, venue.span);
      const display = displayFor("pair", span, profile);
      return single(id, makeFrame(ZONE_A, "pair", 0, 0, SOLO, 0, display, span));
    }
    case "screen":
      // On its own, the screen is drawn as wide as a bank would be.
      return single(id, screenOver(ZONE_A, 0, rowWidth(venue, profile), SOLO, profile));
    case "bank":
      return bank(venue, profile);
    case "corner":
      return corner(venue, profile);
    case "versus":
      return versus(profile);
    case "sphere":
      return sphere(profile);
  }
};
