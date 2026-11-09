/**
 * The foreman runs builds one after another: sizes each from the slots people and bots used in
 * the last minute, hands out orders, takes delivered parts, sends slow helpers for columns nobody
 * works, sends every remaining helper in the last stretch so a build always completes, brings the
 * finished build alive, then starts the next theme. The screen runs one for its bank; a frame on
 * its own (or a bank panel that lost its screen) runs its own. Time is passed in, so tests can
 * drive it without a clock.
 */
import {
  ALIVE_MS,
  FINISH_MS,
  HELPER_FLY_MS,
  HELPER_SHARE,
  MAX_CARRY,
  MAX_PARTS,
  MAX_TROPHIES,
  MIN_PARTS,
  PARTS_PER_SLOT,
  THEME_IDS,
  type ThemeChoice,
  type ThemeId,
} from "./config";
import {
  assignOrders,
  type Build,
  isComplete,
  type Maker,
  needOf,
  newBuild,
  pickHelperSlot,
  pickSlot,
  settle,
} from "./build";

export interface Delivery {
  kind: number;
  maker: Exclude<Maker, "helper">;
  color: number;
  column: number;
  departAt: number;
  arriveAt: number;
  sx: number;
  sy: number;
}

/** What the foreman knows about the people working for it. */
export interface Cover {
  /** Columns there are now. */
  columns: number;
  /** True for columns where people or bots made a part lately. */
  working(column: number): boolean;
  /** Task slots that people or bots used in the last minute. */
  active: number;
}

export type ForemanEvent =
  | { type: "start"; id: number }
  | { type: "alive"; id: number; early: boolean }
  | { type: "filled"; slot: number };

export interface Totals {
  builds: number;
  early: number;
  person: number;
  bot: number;
  helper: number;
}

export interface Foreman {
  readonly build: Build;
  readonly orders: readonly number[];
  readonly trophies: number;
  readonly totals: Readonly<Totals>;
  /** Parts waiting for the next build. */
  readonly carried: number;
  update(now: number, cover: Cover): void;
  /** A finished part. Returns the slot it will fill, or -1 when it waits for the next build. */
  deliver(d: Delivery, now: number): number;
  /** Admin: finish the current build at once (or start the next one if it is alive). */
  finish(now: number): void;
  clearTrophies(): void;
  /** Events since the last call. */
  takeEvents(): ForemanEvent[];
  /** Restart the day's counts. */
  resetTotals(): void;
}

export interface ForemanOptions {
  /** Seconds per build. */
  round: number;
  theme: ThemeChoice;
  /** Which theme a rotation starts on. */
  first?: number;
  now: number;
  cover: Cover;
}

const MAX_EVENTS = 128;

export const partsFor = (active: number): number =>
  Math.min(MAX_PARTS, Math.max(MIN_PARTS, Math.round(PARTS_PER_SLOT * Math.max(0, active))));

/** Helper start points: alternately off the left and right edges, at varied heights. */
const helperFrom = (i: number) => ({
  sx: i % 2 === 0 ? -0.06 : 1.06,
  sy: 0.12 + ((i * 0.37) % 1) * 0.45,
});

export const createForeman = (opts: ForemanOptions): Foreman => {
  const roundMs = opts.round * 1000;
  let themeAt = Math.max(0, opts.first ?? 0) % THEME_IDS.length;
  const themeFor = (): ThemeId => {
    if (opts.theme !== "rotate") return opts.theme;
    const t = THEME_IDS[themeAt % THEME_IDS.length]!;
    themeAt++;
    return t;
  };
  let nextId = 1;
  let build = newBuild(nextId++, themeFor(), partsFor(opts.cover.active), opts.now, roundMs);
  let orders: number[] = [];
  let trophies = 0;
  let last = opts.now;
  let debt = 0;
  let helpers = 0;
  const carry: Delivery[] = [];
  let events: ForemanEvent[] = [{ type: "start", id: build.id }];
  const totals: Totals = { builds: 0, early: 0, person: 0, bot: 0, helper: 0 };
  const landed: number[] = [];

  const emit = (e: ForemanEvent) => {
    if (events.length < MAX_EVENTS) events.push(e);
  };

  const sendHelper = (i: number, departAt: number, arriveAt: number) => {
    const s = build.slots[i];
    if (!s) return;
    const from = helperFrom(helpers++);
    s.state = "coming";
    s.maker = "helper";
    s.color = -1;
    s.column = -1;
    s.departAt = departAt;
    s.arriveAt = arriveAt;
    s.sx = from.sx;
    s.sy = from.sy;
  };

  /** Every open slot gets a helper, landing evenly between `from` and `to`. */
  const rush = (now: number, from: number, to: number) => {
    const open: number[] = [];
    build.slots.forEach((s, i) => {
      if (s.state === "open") open.push(i);
    });
    open.sort((a, b) => build.slots[a]!.order - build.slots[b]!.order);
    const span = Math.max(0, to - from);
    open.forEach((i, k) => {
      const arrive = from + (span * (k + 0.5)) / open.length;
      sendHelper(i, Math.max(now, arrive - HELPER_FLY_MS), arrive);
    });
  };

  const place = (d: Delivery, now: number, i: number) => {
    const s = build.slots[i]!;
    s.state = "coming";
    s.maker = d.maker;
    s.color = d.maker === "person" ? d.color : -1;
    s.column = d.column;
    s.departAt = d.departAt;
    s.arriveAt = Math.max(d.arriveAt, now);
    s.sx = d.sx;
    s.sy = d.sy;
  };

  const start = (now: number, cover: Cover) => {
    build = newBuild(nextId++, themeFor(), partsFor(cover.active), now, roundMs);
    debt = 0;
    orders = assignOrders([], cover.columns, needOf(build));
    emit({ type: "start", id: build.id });
    const waiting = carry.splice(0, carry.length);
    waiting.forEach((d, k) => {
      const i = pickSlot(build, d.kind);
      if (i < 0) return;
      const at = now + 150 * k;
      place({ ...d, departAt: at, arriveAt: at }, now, i);
    });
  };

  const comeAlive = (now: number) => {
    build.phase = "alive";
    build.aliveAt = now;
    build.early = now < build.endAt - FINISH_MS;
    totals.builds++;
    if (build.early) {
      totals.early++;
      trophies = Math.min(MAX_TROPHIES, trophies + 1);
    }
    emit({ type: "alive", id: build.id, early: build.early });
  };

  const land = (now: number) => {
    landed.length = 0;
    settle(build, now, landed);
    for (const i of landed) {
      const s = build.slots[i]!;
      if (s.maker === "person") totals.person++;
      else if (s.maker === "bot") totals.bot++;
      else totals.helper++;
      emit({ type: "filled", slot: i });
    }
  };

  const busyKinds = (cover: Cover): Set<number> => {
    const busy = new Set<number>();
    for (let c = 0; c < cover.columns; c++) {
      const k = orders[c];
      if (k !== undefined && k >= 0 && cover.working(c)) busy.add(k);
    }
    return busy;
  };

  orders = assignOrders([], opts.cover.columns, needOf(build));

  return {
    get build() {
      return build;
    },
    get orders() {
      return orders;
    },
    get trophies() {
      return trophies;
    },
    get totals() {
      return totals;
    },
    get carried() {
      return carry.length;
    },
    update(now, cover) {
      const dt = Math.min(5000, Math.max(0, now - last));
      last = now;
      if (build.phase === "alive") {
        if (now - build.aliveAt >= ALIVE_MS) start(now, cover);
        else return;
      }
      land(now);
      if (build.phase === "building" && now >= build.endAt - FINISH_MS) {
        build.phase = "finishing";
        rush(now, now + Math.min(HELPER_FLY_MS * 0.6, FINISH_MS * 0.2), build.endAt - 300);
      }
      if (build.phase === "building") {
        let uncovered = 1;
        if (cover.columns > 0) {
          let idle = 0;
          for (let c = 0; c < cover.columns; c++) if (!cover.working(c)) idle++;
          uncovered = idle / cover.columns;
        }
        const span = Math.max(1, build.endAt - FINISH_MS - build.startAt) / 1000;
        debt += ((HELPER_SHARE * build.slots.length) / span) * uncovered * (dt / 1000);
        if (debt >= 1) {
          debt -= 1;
          const i = pickHelperSlot(build, busyKinds(cover));
          if (i >= 0) sendHelper(i, now, now + HELPER_FLY_MS);
        }
      }
      if (isComplete(build)) {
        comeAlive(now);
        return;
      }
      const need = needOf(build);
      if (orders.length !== cover.columns || orders.some((k) => k < 0 || need[k] === 0)) {
        orders = assignOrders(orders, cover.columns, need);
      }
    },
    deliver(d, now) {
      if (build.phase === "alive") {
        carry.push(d);
        while (carry.length > MAX_CARRY) carry.shift();
        return -1;
      }
      let i = pickSlot(build, d.kind);
      if (i < 0) {
        // Everything left is spoken for by helpers: a person's part takes over from the helper
        // that would land last.
        let latest = -1;
        build.slots.forEach((s, k) => {
          if (s.state !== "coming" || s.maker !== "helper") return;
          if (latest < 0 || s.arriveAt > build.slots[latest]!.arriveAt) latest = k;
        });
        i = latest;
      }
      if (i < 0) {
        carry.push(d);
        while (carry.length > MAX_CARRY) carry.shift();
        return -1;
      }
      place(d, now, i);
      return i;
    },
    finish(now) {
      if (build.phase === "alive") {
        build.aliveAt = now - ALIVE_MS;
        return;
      }
      build.phase = "finishing";
      build.endAt = Math.min(build.endAt, now + FINISH_MS);
      for (const s of build.slots) {
        if (s.state === "coming" && s.maker === "helper" && s.departAt > now) s.state = "open";
      }
      rush(now, now + 250, now + 1500);
    },
    clearTrophies() {
      trophies = 0;
    },
    takeEvents() {
      const out = events;
      events = [];
      return out;
    },
    resetTotals() {
      totals.builds = 0;
      totals.early = 0;
      totals.person = 0;
      totals.bot = 0;
      totals.helper = 0;
    },
  };
};
