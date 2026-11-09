/**
 * The screen above a bank: the upper deck. It answers deck shots from the tables below, sends
 * balls back down, batches deck points to their owners and shows every table's score. On its own
 * (no tables, or a solo screen) it drops balls in from the top as an attract.
 */
import { activeVenue } from "../../core/venue";
import type { AppContext, AppInstance, FrameInfo } from "../../core/types";
import { type Config, GIFTS, HZ } from "./config";
import { createDeck, slotInfos } from "./deck";
import { createDeckView } from "./deckview";
import { createDownlink } from "./link";
import { THEME_LOOKS } from "./themes/looks";
import { createDeckView3D } from "./view3d/deckview3d";

const HOOK_MS = 400;

export const mountScreen = (ctx: AppContext, cfg: Config): AppInstance => {
  const banked = ctx.setup.name === "bank";
  // A screen that isn't part of a bank shows a table under each panel of the venue's usual bank.
  const count = banked ? Math.max(1, ctx.setup.count) : activeVenue().bankCount;
  const local = () => performance.now();
  const clock = () => ctx.clock.now();
  const fx = ctx.rng(`pinball:deck:${ctx.seed}`);
  let frame: FrameInfo = ctx.frame;
  const W = frame.width / frame.unit;
  const H = frame.height / frame.unit;
  let downs = 0;
  let ups = 0;
  let gifts = 0;

  const deck = createDeck({
    W,
    H,
    count,
    rain: cfg.rain,
    random: () => fx.next(),
    onDown(slot, m) {
      if (!slot.frame) return;
      downs++;
      downlink.down(slot.frame, m);
    },
    onPoints(to, list) {
      downlink.pts(to, { p: list });
    },
    onGift(slot, m) {
      if (!slot.frame) return;
      gifts++;
      downlink.gift(slot.frame, m);
    },
  });

  const downlink = createDownlink(
    ctx.net,
    { now: local, clock },
    {
      up(m, from) {
        if (!cfg.deck) return;
        ups++;
        ctx.idle.poke();
        deck.up(m, from.frame, clock(), local());
      },
      score(m, from) {
        deck.score(m, from.frame, local());
      },
    },
  );

  const syncSlots = () => {
    const stations = banked ? downlink.stations() : [];
    deck.setSlots(slotInfos(count, stations), new Set(stations.map((p) => p.frame)));
  };
  syncSlots();
  const offPeers = ctx.net.onPeers(syncSlots);

  const view = cfg.theme
    ? createDeckView3D(ctx.root, ctx.ui.palette.players, THEME_LOOKS[cfg.theme], frame)
    : createDeckView(ctx.root, ctx.ui.palette.players);
  view.resize(frame);

  let lastHook = 0;
  let lastSync = 0;
  let lastPoke = 0;
  /** Ms spent simulating and drawing, for the debug hook. */
  const cost = { update: 0, render: 0, frames: 0 };
  const loop = ctx.loop({
    hz: HZ,
    update(dt) {
      const l = local();
      downlink.tick();
      // Peers can change without a roster event reaching this channel (a frame switching apps).
      if (l - lastSync > 1000) {
        lastSync = l;
        syncSlots();
      }
      const t0 = performance.now();
      deck.update(dt, clock(), l);
      cost.update += performance.now() - t0;
      // People playing below keep the deck from resetting.
      if (deck.playing() && l - lastPoke > 1000) {
        lastPoke = l;
        ctx.idle.poke();
      }
      if (ctx.debug && l - lastHook > HOOK_MS) {
        lastHook = l;
        ctx.root.dataset.pinball = JSON.stringify({
          kind: "screen",
          balls: deck.balls.length,
          total: deck.total,
          slots: deck.geo.slots.length,
        });
      }
    },
    render(alpha) {
      const t0 = performance.now();
      view.draw(deck, alpha, local() / 1000);
      cost.render += performance.now() - t0;
      cost.frames++;
    },
  });
  loop.start();

  const offResize = ctx.onResize((f) => {
    frame = f;
    view.resize(f);
  });

  const debugKey = "__pinball";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => ({
          kind: "screen",
          view: cfg.theme ? "3d" : "2d",
          clock: clock(),
          cost: { ...cost },
          total: deck.total,
          W,
          H,
          R: deck.geo.R,
          count,
          ups,
          downs,
          gifts,
          stats: { ...deck.stats },
          giftLog: [...deck.gifts],
          devices: {
            nest: {
              x: deck.parts.nest.x,
              cups: deck.parts.nest.cups,
              held: deck.parts.nest.held.length,
            },
            lock: deck.parts.lock.held.length,
            magnets: deck.parts.magnets.map((m) => m.held.length),
            saucers: deck.parts.saucers.map((m) => m.held.length),
            vuk: deck.parts.vuk.held.length,
            bubbles: deck.parts.bubbles.list.map((b) => ({ x: b.x, y: b.y, kind: b.kind })),
            big: { ...deck.parts.big },
          },
          arrivals: [...deck.arrivals],
          sent: [...deck.sent],
          balls: deck.balls.map((b) => ({
            id: b.id,
            from: b.from,
            ref: b.ref,
            phase: b.phase,
            x: b.x,
            y: b.y,
            r: b.r,
            start: b.start,
            owner: b.owner,
          })),
          slots: deck.geo.slots.map((s) => ({
            key: s.key,
            frame: s.frame,
            pos: s.pos,
            h: s.h,
            n: s.n,
            x0: s.x0,
            x1: s.x1,
            chuteX: s.chuteX,
            holeX: s.holeX,
            playing: s.playing,
            score: s.score,
            inPlay: s.inPlay,
          })),
        }),
        rain: () => deck.rain(clock()),
        /** Send gift `k` to slot `i`'s table as if its ball had popped a bubble mid-deck. */
        gift(i: number, k = 0) {
          const slot = deck.geo.slots[i];
          const kind = GIFTS[k];
          if (!slot || !kind) return false;
          return deck.giveGift(slot, kind, W / 2, H * 0.4, clock());
        },
        /** Send `n` balls up the chutes at once, as if every table shot the deck. */
        burst(n: number) {
          const t = clock() - 300;
          for (let i = 0; i < Math.min(48, n); i++) {
            const p = i % count;
            const m = { i: 900_000 + i, p, h: 0, n: 1, u: 0.3, vx: 0, vy: -2000, c: p % 8, t };
            deck.up(m, "test", clock(), local());
          }
        },
      },
    });
  }

  return {
    reset() {
      deck.reset();
    },
    attract() {},
    status() {
      return {
        deckBalls: deck.balls.length,
        total: deck.total,
        playing: deck.geo.slots.filter((s) => s.playing).length,
        ups,
        downs,
        gifts,
        multiballs: deck.stats.multiball ?? 0,
      };
    },
    command(name) {
      if (name === "rain") deck.rain(clock());
    },
    dispose() {
      loop.stop();
      offPeers();
      offResize();
      downlink.dispose();
      view.dispose();
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
