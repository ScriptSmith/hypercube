/**
 * Pinball on a wall: a row of tables along the bottom, each its own station, and the upper deck as
 * a band across the top, above reach. The deck runs in this frame with the same rules as a bank's
 * screen (deck.ts): the tables' deck shots go up to it, and its balls, points and gifts come back
 * down as the same messages a bank sends over the network, handed over directly. Without the deck
 * the tables are as big as the wall allows and their deck lanes are orbit ramps.
 */
import { createRenderer3D } from "../../core/renderer3d";
import type { AppContext, AppInstance, FrameInfo } from "../../core/types";
import { type Config, GIFTS } from "./config";
import { createDeck, type Deck } from "./deck";
import { createDeckView } from "./deckview";
import type { Uplink } from "./link";
import { THEME_LOOKS } from "./themes/looks";
import { type DeckHandlers, mountTables, type WallHost } from "./tableframe";
import { createDeckView3D } from "./view3d/deckview3d";
import { deckScale, WALL_FRAME, type WallLayout, wallLayout } from "./wallgeo";
import type { UpMsg } from "./wire";

/** The wall's layout for a frame, from its size and reach. */
export const layoutFor = (frame: FrameInfo, cfg: Config): WallLayout => {
  const u = frame.unit;
  const adultPx = (frame.height - frame.reachTop.adult) / u;
  return wallLayout(frame.width / u, frame.height / u, adultPx, cfg.tables, cfg.deck);
};

const deckState = (deck: Deck, layout: WallLayout, resets: number) => ({
  resets,
  W: layout.deckW,
  H: layout.deckH,
  f: layout.f,
  R: deck.geo.R,
  launchY: deck.geo.launchY,
  total: deck.total,
  stats: { ...deck.stats },
  giftLog: [...deck.gifts],
  arrivals: [...deck.arrivals],
  sent: [...deck.sent],
  devices: {
    lock: deck.parts.lock.held.length,
    magnets: deck.parts.magnets.map((m) => m.held.length),
    saucers: deck.parts.saucers.map((m) => m.held.length),
    nest: deck.parts.nest.held.length,
  },
  balls: deck.balls.map((b) => ({
    id: b.id,
    from: b.from,
    ref: b.ref,
    phase: b.phase,
    x: b.x,
    y: b.y,
    r: b.r,
    owner: b.owner,
  })),
  slots: deck.geo.slots.map((s) => ({
    h: s.h,
    x0: s.x0,
    x1: s.x1,
    chuteX: s.chuteX,
    holeX: s.holeX,
    playing: s.playing,
    score: s.score,
    inPlay: s.inPlay,
  })),
});

export const mountWall = (ctx: AppContext, cfg: Config): AppInstance => {
  const layout = layoutFor(ctx.frame, cfg);
  const band = layout.band;
  if (!band) {
    return mountTables(ctx, cfg, {
      layout,
      link: () => null,
      update() {},
      render() {},
      resize() {},
      reset() {},
      status: () => ({}),
      command: () => false,
      debug: () => null,
      api: {},
      dispose() {},
    });
  }

  const local = () => performance.now();
  const clock = () => ctx.clock.now();
  const fx = ctx.rng(`pinball:deck:${ctx.seed}`);
  let on: DeckHandlers | null = null;
  let resets = 0;
  const deck = createDeck({
    W: layout.deckW,
    H: layout.deckH,
    count: 1,
    rain: cfg.rain,
    random: () => fx.next(),
    band: { scale: deckScale() },
    slots: layout.slots,
    onDown: (_slot, m) => on?.down(m),
    onPoints: (_frame, list) => on?.pts({ p: list }),
    onGift: (_slot, m) => on?.gift(m),
  });
  deck.setSlots(layout.slots, new Set([WALL_FRAME]));
  // Themed tables and the band share one WebGL context.
  const renderer = cfg.theme
    ? createRenderer3D(ctx.root, ctx.frame, { antialias: true })
    : undefined;
  const view =
    cfg.theme && renderer
      ? createDeckView3D(
          ctx.root,
          ctx.ui.palette.players,
          THEME_LOOKS[cfg.theme],
          ctx.frame,
          renderer,
        )
      : createDeckView(ctx.root, ctx.ui.palette.players);
  view.resize(ctx.frame, band, layout.f);

  const link = (handlers: DeckHandlers): Uplink => {
    on = handlers;
    return {
      screen: () => WALL_FRAME,
      up(m) {
        deck.up(m, WALL_FRAME, clock(), local());
        return true;
      },
      score(m) {
        deck.score(m, WALL_FRAME, local());
      },
      lag: 0,
      dispose() {
        on = null;
      },
    };
  };

  const host: WallHost = {
    layout,
    renderer,
    link,
    update(dt) {
      deck.update(dt, clock(), local());
    },
    render(alpha) {
      view.draw(deck, alpha, local() / 1000);
    },
    resize(f) {
      renderer?.resize(f);
      view.resize(f, band, layout.f);
    },
    reset() {
      resets++;
      deck.reset();
    },
    status: () => ({
      deckBalls: deck.balls.length,
      total: deck.total,
      multiballs: deck.stats.multiball ?? 0,
    }),
    command(name) {
      if (name !== "rain") return false;
      deck.rain(clock());
      return true;
    },
    debug: () => deckState(deck, layout, resets),
    api: {
      rain: () => deck.rain(clock()),
      /** Send gift `k` to table `i` as if one of its balls had popped a bubble mid-band. */
      gift: (i: number, k = 0) => {
        const slot = deck.geo.slots[i];
        const kind = GIFTS[k];
        if (!slot || !kind) return false;
        return deck.giveGift(slot, kind, layout.deckW / 2, layout.deckH * 0.4, clock());
      },
      /** Send `count` balls up the chutes at once, as if every table shot the deck. */
      burst: (count: number) => {
        const t = clock() - 300;
        const n = layout.tables.length;
        for (let i = 0; i < Math.min(48, count); i++) {
          const h = i % n;
          const m: UpMsg = { i: 900_000 + i, p: 0, h, n, u: 0.3, vx: 0, vy: -2000, c: h, t };
          deck.up(m, WALL_FRAME, clock(), local());
        }
      },
    },
    dispose() {
      view.dispose();
      renderer?.dispose();
    },
  };
  return mountTables(ctx, cfg, host);
};
