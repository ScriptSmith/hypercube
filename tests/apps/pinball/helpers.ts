import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";
import { applyIntent, createBot } from "../../../src/apps/pinball/bot";
import { type Config, readConfig } from "../../../src/apps/pinball/config";
import { tableFor } from "../../../src/apps/pinball/themes";
import { createTable, type Table, type UpShot } from "../../../src/apps/pinball/table";
import { exitU } from "../../../src/apps/pinball/layout";
import { createDeck, type Deck, type Slot, slotInfos } from "../../../src/apps/pinball/deck";
import type { DownMsg, GiftMsg, UpMsg } from "../../../src/apps/pinball/wire";
import {
  deckScale,
  WALL_FRAME,
  type WallLayout,
  wallLayout,
} from "../../../src/apps/pinball/wallgeo";
import type { Channel, PeerInfo } from "../../../src/core/types";

export const DT = 1 / 120;

/** A seeded stream for tests: the same every run. */
export const seeded = (seed = 7) => {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
};

export interface Rig {
  table: Table;
  cfg: Config;
  ups: UpShot[];
  /** Clock ms. */
  now: number;
  step(seconds: number, each?: () => void): void;
}

export const rig = (
  o: {
    variant?: string;
    options?: Record<string, string | number | boolean>;
    mirror?: boolean;
    deck?: boolean;
    sendable?: boolean;
    config?: Partial<Config>;
  } = {},
): Rig => {
  const cfg = { ...readConfig(o.variant ?? "classic", o.options ?? {}), ...o.config };
  const ups: UpShot[] = [];
  const random = seeded(3);
  const themed = tableFor(cfg.theme, o.mirror ?? false);
  const table = createTable({
    layout: themed.layout,
    toys: themed.toys,
    cfg,
    color: 0,
    random,
    deck: () => o.deck ?? false,
    onUp(shot) {
      ups.push(shot);
      return o.sendable ?? true;
    },
  });
  const r: Rig = {
    table,
    cfg,
    ups,
    now: 1_000_000,
    step(seconds, each) {
      const n = Math.round(seconds / DT);
      for (let i = 0; i < n; i++) {
        each?.();
        table.update(DT, r.now);
        r.now += DT * 1000;
      }
    },
  };
  return r;
};

/** A table with a person's game and no balls: tests place their own. */
export const emptyTable = (o: Parameters<typeof rig>[0] = {}): Rig => {
  const r = rig(o);
  r.table.start("human");
  r.table.world.balls.length = 0;
  return r;
};

/** Play a bot game until it ends or `limit` seconds pass. */
export const botGame = (r: Rig, seed = 5, limit = 900, upper = true) => {
  const bot = createBot(seeded(seed), 0.9);
  const was = { plunger: false };
  let t = 0;
  while (r.table.mode === "play" && t < limit) {
    bot.update(r.table);
    if (!upper) {
      bot.intent.flippers.upLeft = false;
      bot.intent.flippers.upRight = false;
    }
    applyIntent(r.table, bot.intent, was);
    r.step(DT);
    t += DT;
  }
  return t;
};

/** A room in miniature: channels on one bus see each other's peers and messages at once. */
export interface Bus {
  join(info: Partial<PeerInfo> & { frame: string }): Channel & { leave(): void };
  readonly log: { topic: string; from: string; to?: string; data: unknown }[];
  online: boolean;
}

export const createBus = (): Bus => {
  const members = new Map<
    string,
    { info: PeerInfo; handlers: Map<string, Set<(d: unknown, f: string) => void>> }
  >();
  const log: Bus["log"] = [];
  const bus: Bus = {
    log,
    online: true,
    join(partial) {
      const info: PeerInfo = {
        app: "pinball",
        group: "g",
        kind: "panel",
        role: "station",
        pos: 0,
        ...partial,
      };
      const handlers = new Map<string, Set<(d: unknown, f: string) => void>>();
      members.set(info.frame, { info, handlers });
      return {
        get online() {
          return bus.online;
        },
        self: info.frame,
        peers: () => [...members.values()].map((m) => m.info),
        leader: () => null,
        send(topic, data, to) {
          if (!bus.online) return;
          log.push({ topic, from: info.frame, to, data });
          for (const [frame, m] of members) {
            if (frame === info.frame || (to !== undefined && to !== frame)) continue;
            for (const cb of m.handlers.get(topic) ?? []) cb(structuredClone(data), info.frame);
          }
        },
        on(topic, cb) {
          let set = handlers.get(topic);
          if (!set) handlers.set(topic, (set = new Set()));
          set.add(cb);
          return () => set.delete(cb);
        },
        onPeers: () => () => {},
        leave() {
          members.delete(info.frame);
        },
      };
    },
  };
  return bus;
};

export const DECK_W = VENUE_SIZE.screen.width;
export const DECK_H = VENUE_SIZE.screen.height;

export const panels = (count: number) =>
  Array.from({ length: count }, (_, pos) => ({ frame: `p${pos}`, pos, kind: "panel" }));

export interface DeckRig {
  deck: Deck;
  downs: { slot: Slot; m: DownMsg }[];
  points: { frame: string; list: [number, number][] }[];
  gifts: { slot: Slot; m: GiftMsg }[];
  now: number;
  local: number;
  step(seconds: number): void;
  /** A table reports in: playing or not, balls in play, and whether it takes balls. */
  playing(pos: number, on?: boolean, q?: number, open?: boolean): void;
  /** A table an attract bot is playing: it takes balls but nobody is playing it. */
  attract(pos: number, q?: number): void;
  up(pos: number, i?: number, t?: number): UpMsg;
}

export const deckRig = (
  o: {
    count?: number;
    rain?: boolean;
    frames?: { frame: string; pos: number; kind: string; span?: number }[];
  } = {},
) => {
  const count = o.count ?? 8;
  const frames = o.frames ?? panels(count);
  const downs: { slot: Slot; m: DownMsg }[] = [];
  const points: { frame: string; list: [number, number][] }[] = [];
  const gifts: { slot: Slot; m: GiftMsg }[] = [];
  const deck = createDeck({
    W: DECK_W,
    H: DECK_H,
    count,
    rain: o.rain ?? true,
    random: seeded(4),
    onDown: (slot, m) => downs.push({ slot, m }),
    onPoints: (frame, list) => points.push({ frame, list }),
    onGift: (slot, m) => gifts.push({ slot, m }),
  });
  deck.setSlots(slotInfos(count, frames), new Set(frames.map((f) => f.frame)));
  const r: DeckRig = {
    deck,
    downs,
    points,
    gifts,
    now: 1_000_000,
    local: 5_000,
    step(seconds: number) {
      for (let i = 0; i < Math.round(seconds / DT); i++) {
        deck.update(DT, r.now, r.local);
        r.now += DT * 1000;
        r.local += DT * 1000;
      }
    },
    playing(pos: number, on = true, q = 1, open = on) {
      deck.score(
        {
          h: 0,
          n: 1,
          s: 1000,
          b: 3,
          g: on ? 1 : 0,
          q,
          c: pos,
          a: open ? 1 : 0,
        },
        `p${pos}`,
        r.local,
      );
    },
    attract: (pos: number, q = 1) => r.playing(pos, false, q, true),
    up(pos: number, i = 1, t = r.now): UpMsg {
      const m: UpMsg = { i, p: pos, h: 0, n: 1, u: exitU(false), vx: 300, vy: -2000, c: pos, t };
      deck.up(m, `p${pos}`, r.now, r.local);
      return m;
    },
  };
  return r;
};

/** The default wall in venue px, and the top of adult reach on it. */
export const WALL_W = VENUE_SIZE.wall.width;
export const WALL_H = VENUE_SIZE.wall.height;
export const WALL_ADULT = DEFAULT_REACH.wall.adult * WALL_H;

export interface BandRig extends DeckRig {
  layout: WallLayout;
  /** A table on the wall reports that it is playing (or not). */
  playing(h: number, on?: boolean, q?: number, open?: boolean): void;
  /** A deck shot from table `h`. */
  up(h: number, i?: number, t?: number): UpMsg;
}

/** A wall's deck with its tables, as wall.ts sets it up, without the frame. */
export const bandRig = (
  o: { tables?: number; rain?: boolean; W?: number; H?: number; adult?: number } = {},
): BandRig => {
  const n = o.tables ?? 5;
  const layout = wallLayout(o.W ?? WALL_W, o.H ?? WALL_H, o.adult ?? WALL_ADULT, n, true);
  const downs: { slot: Slot; m: DownMsg }[] = [];
  const points: { frame: string; list: [number, number][] }[] = [];
  const gifts: { slot: Slot; m: GiftMsg }[] = [];
  const deck = createDeck({
    W: layout.deckW,
    H: layout.deckH,
    count: 1,
    rain: o.rain ?? true,
    random: seeded(4),
    band: { scale: deckScale() },
    slots: layout.slots,
    onDown: (slot, m) => downs.push({ slot, m }),
    onPoints: (frame, list) => points.push({ frame, list }),
    onGift: (slot, m) => gifts.push({ slot, m }),
  });
  deck.setSlots(layout.slots, new Set([WALL_FRAME]));
  const r: BandRig = {
    layout,
    deck,
    downs,
    points,
    gifts,
    now: 1_000_000,
    local: 5_000,
    step(seconds: number) {
      for (let i = 0; i < Math.round(seconds / DT); i++) {
        deck.update(DT, r.now, r.local);
        r.now += DT * 1000;
        r.local += DT * 1000;
      }
    },
    playing(h: number, on = true, q = 1, open = on) {
      deck.score(
        { h, n, s: 1000, b: 3, g: on ? 1 : 0, q, c: h, a: open ? 1 : 0 },
        WALL_FRAME,
        r.local,
      );
    },
    attract: (h: number, q = 1) => r.playing(h, false, q, true),
    up(h: number, i = 1, t = r.now): UpMsg {
      const mirror = layout.tables[h]!.mirror;
      const m: UpMsg = { i, p: 0, h, n, u: exitU(mirror), vx: 300, vy: -2000, c: h, t };
      deck.up(m, WALL_FRAME, r.now, r.local);
      return m;
    },
  };
  return r;
};
