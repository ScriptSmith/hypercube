/**
 * Where everything goes on a wall: a row of tables standing on the bottom edge, each in the
 * middle of its share of the width, and above them the upper deck as a band across the whole
 * wall.
 *
 * A table is the panel's table scaled by `k` (venue px per table px). Its pads stack up from the
 * bottom edge as on a panel, the main flippers' low for children and the upper flippers' above
 * them, all under the top of adult reach with room above them for the station's hold-to-reset
 * control, which sits in the top corner of the reachable part of the table, beside it. The
 * tables are as big as that allows, and as the deck's band allows: the deck runs in its own deck
 * px, where its balls are DECK_GROW times as big as a table's (they grow up the chutes, as on a
 * bank's screen, so the band's pieces read from across the room), and its band is never shorter
 * than its layout needs (bandgeo.ts). Without the deck the tables are as big as the wall allows,
 * and their pads shrink to stay in reach.
 *
 * All positions here are venue px of the frame unless they say deck px.
 */
import { activeVenue } from "../../core/venue";
import { BALL_R, CHILD_BAND, TABLE_H, TABLE_W } from "./config";
import { bandHeight } from "./bandgeo";
import { type SlotInfo, unitFor } from "./deckgeo";
import { mirroredAt } from "./layout";
import { padsFor, type TablePads, UPPER_H } from "./pads";

/** The screen height a wall's deck moves like: the venue's screen (a screen's own height on a bank). */
export const deckScale = (): number => activeVenue().screen.height;
/**
 * A deck ball's size on a wall, as a share of a table ball's: at least DECK_GROW, and more, up to
 * MAX_GROW, when small tables leave a tall band, so the deck fills it at its usual spacing.
 */
export const DECK_GROW = 1.3;
export const MAX_GROW = 2.2;
/** The frame id a wall's deck knows its own tables by. */
export const WALL_FRAME = "wall";
/** Tables together take at most this share of the wall's width, leaving gaps between them. */
const WIDTH_SHARE = 0.96;
/** Smallest table scale, as a share of the scale that fills the wall's height. */
const MIN_K = 0.35;
/** Room above the upper pads for the station's reset control: its margin, size and a gap. */
export const RESET_CLEAR = 28 + 150 + 12;
/** The main and upper flipper pads' heights on a panel, table px. */
const MAIN_H = TABLE_H * CHILD_BAND;
const PADS_H = MAIN_H + UPPER_H;
/** Smallest pads, venue px. */
const MIN_PAD = 150;

export interface Place {
  /** Top left corner, and venue px per table px. */
  x: number;
  y: number;
  k: number;
}

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WallTable {
  place: Place;
  /**
   * The table's station: its share of the width, as tall as the table, so the hold-to-reset
   * control in the top corner of its reach sits beside the table rather than on it.
   */
  cell: Region;
  mirror: boolean;
  /** In table px (`ox` is 0). */
  pads: TablePads;
}

export interface WallLayout {
  k: number;
  tables: WallTable[];
  /** The tables' part of the wall. */
  floor: Region;
  /** The deck's band, or null when there is no deck. */
  band: Region | null;
  /** Venue px per deck px, the deck's size in deck px and its slots. */
  f: number;
  deckW: number;
  deckH: number;
  slots: SlotInfo[];
}

/**
 * Pads in table px for a table of scale `k` standing on the bottom edge, with adult reach
 * `adultPx` venue px above that edge: the main flipper pads at the bottom and the upper ones
 * straight above them, at a panel's heights when they fit under reach and the reset control,
 * and shrunk together when they don't.
 */
export const wallPads = (mirror: boolean, k: number, adultPx: number): TablePads => {
  const p = padsFor(0, mirror, { left: false, right: false });
  const room = Math.max(0, (adultPx - RESET_CLEAR) / k);
  const s = Math.min(1, room / PADS_H);
  const min = MIN_PAD / k;
  const ph = Math.max(p.plunger.h, min);
  const main = Math.max(ph, min, MAIN_H * s);
  const up = Math.max(min, Math.min(UPPER_H * s, room - main));
  const mainTop = TABLE_H - main;
  const upTop = mainTop - up;
  // The edge pads are no narrower than MIN_PAD either.
  const w = Math.max(p.upLeft.w, min);
  const pw = Math.max(p.plunger.w, min);
  const lower = (b: TablePads["left"]) => ({ ...b, y: mainTop, h: main });
  return {
    ...p,
    upLeft: { x: 0, y: upTop, w, h: up },
    upRight: { x: TABLE_W - w, y: upTop, w, h: up },
    plunger: { x: mirror ? 0 : TABLE_W - pw, y: TABLE_H - ph, w: pw, h: ph },
    left: lower(p.left),
    right: lower(p.right),
  };
};

/**
 * The table scale for a wall W x H with adult reach `adultPx` above its bottom edge: upper pads
 * in reach, room for the deck's band, and room across for `n` tables.
 */
export const wallScale = (W: number, H: number, adultPx: number, n: number, deck: boolean) => {
  const across = (W * WIDTH_SHARE) / (n * TABLE_W);
  const tall = H / TABLE_H;
  // Without the deck the pads shrink to fit reach, down to a plunger pad below an upper pad.
  const plunger = padsFor(0, false, { left: false, right: false }).plunger.h;
  if (!deck) {
    const fit = (adultPx - RESET_CLEAR - MIN_PAD) / plunger;
    return Math.max(MIN_K * tall, Math.min(tall, across, fit));
  }
  const U = unitFor(deckScale());
  // A band of bandHeight(U) deck px, where a ball of radius U is DECK_GROW table balls, in table px.
  const band = H / (TABLE_H + (bandHeight(U) * BALL_R * DECK_GROW) / U);
  const reach = (adultPx - RESET_CLEAR) / PADS_H;
  return Math.max(MIN_K * tall, Math.min(reach, band, across));
};

export const wallLayout = (
  W: number,
  H: number,
  adultPx: number,
  n: number,
  deck: boolean,
): WallLayout => {
  const k = wallScale(W, H, adultPx, n, deck);
  const tw = TABLE_W * k;
  const th = TABLE_H * k;
  const share = W / n;
  const tables: WallTable[] = Array.from({ length: n }, (_, h) => {
    const mirror = mirroredAt(h, n);
    return {
      place: { x: share * h + (share - tw) / 2, y: H - th, k },
      cell: { x: share * h, y: H - th, w: share, h: th },
      mirror,
      pads: wallPads(mirror, k, adultPx),
    };
  });
  const floor = { x: 0, y: H - th, w: W, h: th };
  const U = unitFor(deckScale());
  const band = deck ? { x: 0, y: 0, w: W, h: H - th } : null;
  // A deck ball (radius U deck px) is `grow` table balls (BALL_R table px).
  const least = (bandHeight(U) * BALL_R * k) / U;
  const grow = band ? Math.max(DECK_GROW, Math.min(MAX_GROW, band.h / least)) : DECK_GROW;
  const f = (BALL_R * k * grow) / U;
  const slots: SlotInfo[] = tables.map((t, h) => ({
    frame: WALL_FRAME,
    pos: 0,
    h,
    n,
    at: {
      x0: (share * h) / f,
      x1: (share * (h + 1)) / f,
      tx: t.place.x / f,
      tw: tw / f,
      mirror: t.mirror,
    },
  }));
  return {
    k,
    tables,
    floor,
    band,
    f,
    deckW: W / f,
    deckH: band ? band.h / f : 0,
    slots,
  };
};
