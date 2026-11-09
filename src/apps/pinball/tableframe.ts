/**
 * A touch frame: one table per panel (two on a merged pair, a row of them on a wall), each with
 * its own station, pads, bots and game. In a bank it finds the screen above by its beacon and
 * sends deck shots up; on a wall the deck is in the same frame (wall.ts); without either, the
 * deck lane is the orbit ramp.
 *
 * Who plays a table: while its station is idle, a faded attract bot (driving the table directly,
 * since the station's tap hint covers the table); a bot kept for testing (`bots=`), which claims
 * the station and touches the pads like a person; or a person, from the first touch until the
 * game ends or they stop touching for LEAVE_MS.
 *
 * A person's touch near a ball picks it up instead of working the pad under it (grab.ts); the
 * ball follows that finger until it lifts.
 */
import { type BotHand, type BotTouch, createBotHand } from "../../core/input";
import type { Renderer3D } from "../../core/renderer3d";
import type {
  AppContext,
  AppInstance,
  FrameInfo,
  OptionValue,
  Pointer,
  StationSet,
} from "../../core/types";
import { applyIntent, type Bot, createBot } from "./bot";
import { type Config, GIFTS, HZ, LEAVE_MS, MAX_IN_PLAY, TABLE_W } from "./config";
import { touchDown } from "./grab";
import { type FlipperName, mirroredAt } from "./layout";
import { createUplink, type Uplink } from "./link";
import { centreOf, type Control, padsFor, type TablePads, tablesIn } from "./pads";
import { createTable, type Table } from "./table";
import { createTableView, type TableScene } from "./tableview";
import { tableFor } from "./themes";
import { THEME_LOOKS } from "./themes/looks";
import { createTableView3D } from "./view3d/tableview3d";
import type { Place, WallLayout } from "./wallgeo";
import type { DownMsg, GiftMsg, PtsMsg, ScoreMsg } from "./wire";

/** Where messages from the deck go on a frame's tables. */
export interface DeckHandlers {
  down(m: DownMsg): void;
  pts(m: PtsMsg): void;
  gift(m: GiftMsg): void;
}

/** What a wall adds to its tables: where they stand, and the deck above them in the same frame. */
export interface WallHost {
  layout: WallLayout;
  /** The frame's WebGL renderer, shared with the deck's band (themed tables only). */
  renderer?: Renderer3D;
  /** The link to the deck, sending what comes down from it to `on`; null without a deck. */
  link(on: DeckHandlers): Uplink | null;
  /** Called after the tables each update, and after they draw. */
  update(dt: number): void;
  render(alpha: number): void;
  resize(frame: FrameInfo): void;
  reset(): void;
  status(): Record<string, OptionValue>;
  /** True when it handled an admin command. */
  command(name: string): boolean;
  /** The deck's state for the debug hook, null without a deck. */
  debug(): Record<string, unknown> | null;
  /** Test hooks on the deck, added to the debug hook. */
  api: Record<string, (...args: never[]) => unknown>;
  dispose(): void;
}

/** Bots kept for testing take an idle station back after this long. */
const TEST_RECLAIM_MS = 8000;
const SCORE_MS = 500;
const SCORE_KEEPALIVE_MS = 3000;
const HOOK_MS = 400;

interface Seat {
  h: number;
  table: Table;
  /** Where the table sits in the frame; touches map through it into table px. */
  place: Place;
  /** In frame venue px on a panel or pair (offset by `ox`), table px on a wall. */
  pads: TablePads;
  color: string;
  colorIndex: number;
  bot: Bot;
  was: { plunger: boolean };
  /** Pointers on each control. */
  holds: Map<Control, Set<number>>;
  /** The test bot's fingers. */
  hand: BotHand;
  fingers: Map<Control, BotTouch>;
  test: boolean;
  idleSince: number;
  /** Local ms of the last person's touch on this table. */
  touched: number;
  best: number;
  bestSaved: number;
  sentScore: string;
  sentAt: number;
  ended: boolean;
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

const bestKey = (frame: string, h: number) => `hypercube.pinball.best.${frame}.${h}`;

const loadBest = (key: string): number => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return 0;
    const v = JSON.parse(raw) as { day?: unknown; score?: unknown };
    return v.day === today() && typeof v.score === "number" && Number.isFinite(v.score)
      ? v.score
      : 0;
  } catch {
    return 0;
  }
};

const saveBest = (key: string, score: number) => {
  try {
    localStorage.setItem(key, JSON.stringify({ day: today(), score }));
  } catch {
    // Storage can be unavailable; the best score then lasts until the page reloads.
  }
};

export const mountTables = (ctx: AppContext, cfg: Config, wall?: WallHost): AppInstance => {
  const palette = ctx.ui.palette.players;
  const banked = ctx.setup.name === "bank";
  const pos = banked ? ctx.setup.pos : 0;
  const local = () => performance.now();
  const clock = () => ctx.clock.now();
  const fx = ctx.rng(`pinball:${ctx.seed}:${ctx.identity.frame ?? "local"}`);
  const random = () => fx.next();
  let frame: FrameInfo = ctx.frame;
  const spots = wall?.layout.tables;
  const n = spots ? spots.length : tablesIn(frame.kind, frame.span);
  const frameKey = ctx.identity.frame ?? "local";
  let deckActive = false;
  let upCount = 0;
  let downCount = 0;
  let giftCount = 0;
  const gifts: { h: number; kind: string; t: number }[] = [];
  const ups: { id: number; h: number; t: number; at: number; sent: boolean }[] = [];
  const downs: { id: number; h: number; t: number; at: number; ok: boolean }[] = [];

  const handlers: DeckHandlers = {
    down(m) {
      const seat = seats[m.h];
      if (!seat) return;
      const ok = seat.table.addDown({ id: m.i, color: m.c, t: m.t }, clock());
      downCount++;
      downs.push({ id: m.i, h: m.h, t: m.t, at: clock(), ok });
      if (downs.length > 16) downs.shift();
    },
    pts(m) {
      for (const [h, p] of m.p) seats[h]?.table.addPoints(p);
    },
    gift(m) {
      const seat = seats[m.h];
      const kind = GIFTS[m.k];
      if (!seat || !kind) return;
      if (seat.table.gift(kind, m.t, clock())) {
        giftCount++;
        gifts.push({ h: m.h, kind, t: m.t });
        if (gifts.length > 16) gifts.shift();
      }
    },
  };
  const uplink: Uplink | null = wall
    ? wall.link(handlers)
    : banked
      ? createUplink(ctx.net, local, handlers)
      : null;

  const view = cfg.theme
    ? createTableView3D(ctx.root, palette, THEME_LOOKS[cfg.theme], frame, wall?.renderer)
    : createTableView(ctx.root, palette);
  view.resize(frame, wall?.layout.floor);

  const seats: Seat[] = Array.from({ length: n }, (_, h) => {
    const spot = spots?.[h];
    const mirror = spot ? spot.mirror : mirroredAt(h, n);
    const { layout, toys } = tableFor(cfg.theme, mirror);
    const colorIndex = (pos * n + h) % palette.length;
    const color = palette[colorIndex] ?? ctx.ui.palette.accent;
    const seamLeft = h > 0;
    const seamRight = h < n - 1;
    const table = createTable({
      layout,
      toys,
      cfg,
      color: colorIndex,
      random,
      deck: () => deckActive,
      onUp(shot) {
        if (!uplink) return false;
        // Unique on this frame: each table counts its own balls.
        const id = ((shot.id * 8 + h) % 2 ** 30) + 1;
        const ok = uplink.up({
          i: id,
          p: pos,
          h,
          n,
          u: shot.u,
          vx: shot.vx,
          vy: shot.vy,
          c: shot.color,
          t: shot.t,
        });
        if (ok) upCount++;
        ups.push({ id, h, t: shot.t, at: clock(), sent: ok });
        if (ups.length > 16) ups.shift();
        return ok;
      },
    });
    const key = bestKey(frameKey, h);
    const best = loadBest(key);
    return {
      h,
      table,
      place: spot ? spot.place : { x: h * TABLE_W, y: 0, k: 1 },
      pads: spot ? spot.pads : padsFor(h * TABLE_W, mirror, { left: seamLeft, right: seamRight }),
      color,
      colorIndex,
      bot: createBot(() => fx.next(), 0.9),
      was: { plunger: false },
      holds: new Map(),
      hand: createBotHand(ctx.input),
      fingers: new Map(),
      test: false,
      idleSince: -Infinity,
      touched: -Infinity,
      best,
      bestSaved: best,
      sentScore: "",
      sentAt: -Infinity,
      ended: false,
    };
  });

  // ---- Stations -------------------------------------------------------------------------------

  let set: StationSet | null = null;
  const sideOf = (h: number) => (n === 1 ? "right" : h < n / 2 ? "left" : "right");

  const releaseFingers = (seat: Seat) => {
    seat.hand.release();
    seat.fingers.clear();
  };

  const defineStations = () => {
    set?.dispose();
    const u = frame.unit;
    set = ctx.stations.define(
      seats.map((seat) => {
        const cell = spots?.[seat.h]?.cell;
        return {
          id: `table-${seat.h}`,
          rect: cell
            ? { x: cell.x * u, y: cell.y * u, width: cell.w * u, height: cell.h * u }
            : { x: seat.pads.ox * u, y: 0, width: TABLE_W * u, height: frame.height },
          calibrate: false,
          color: seat.color,
          playTimeout: 0,
          resetCorner: sideOf(seat.h) === "left" ? "top-left" : "top-right",
        } as const;
      }),
    );
    const list = set.list;
    set.on("ready", () => set?.startReady());
    set.on("start", (s) => {
      const seat = seats[list.indexOf(s)];
      if (!seat) return;
      releaseFingers(seat);
      dropSynthetic(seat);
      seat.ended = false;
      seat.touched = local();
      seat.bot.reset();
      seat.table.start(s.bot ? "bot" : "human");
      // A finger already on a pad when the game starts works it straight away.
      for (const c of seat.holds.keys()) apply(seat, c);
    });
    set.on("end", (s) => {
      const seat = seats[list.indexOf(s)];
      if (!seat) return;
      seat.test = false;
      seat.idleSince = local();
      releaseFingers(seat);
      seat.holds.clear();
      for (const [id, g] of grabs) if (g === seat) grabs.delete(id);
      seat.bot.reset();
      seat.table.start("attract");
    });
  };
  defineStations();

  const stationOf = (seat: Seat) => set?.list[seat.h] ?? null;

  const claimTestBots = () => {
    if (!set) return;
    let have = seats.filter((s) => s.test && stationOf(s)?.state !== "idle").length;
    const t = local();
    for (const seat of seats) {
      if (have >= ctx.bots) break;
      const st = stationOf(seat);
      if (!st || st.state !== "idle" || t - seat.idleSince < TEST_RECLAIM_MS) continue;
      seat.test = true;
      st.claimForBot();
      have++;
    }
  };

  // ---- Input ----------------------------------------------------------------------------------

  const owner = new Map<number, { seat: Seat; control: Control; synthetic: boolean }>();
  /** Fingers holding a ball, and whose table it is on. */
  const grabs = new Map<number, Seat>();

  /** Forget a bot's fingers on a table, keeping any person's. */
  const dropSynthetic = (seat: Seat) => {
    for (const [id, o] of owner) {
      if (o.seat !== seat || !o.synthetic) continue;
      owner.delete(id);
      seat.holds.get(o.control)?.delete(id);
    }
  };

  const apply = (seat: Seat, control: Control) => {
    const t = seat.table;
    if (t.ctrl === "attract") return;
    const held = (seat.holds.get(control)?.size ?? 0) > 0;
    if (control === "plunger") {
      if (held) t.pressPlunger();
      else t.releasePlunger();
    } else {
      t.setFlipper(control as FlipperName, held);
    }
  };

  /** The table under frame venue px (x, y), and the point in its pads' terms. */
  const seatAt = (x: number, y: number) => {
    if (!wall) {
      const seat = seats[Math.floor(x / TABLE_W)];
      return seat ? { seat, x, y } : null;
    }
    for (const seat of seats) {
      const { place: q } = seat;
      const tx = (x - q.x) / q.k;
      if (tx < 0 || tx >= TABLE_W) continue;
      return { seat, x: tx + seat.pads.ox, y: (y - q.y) / q.k };
    }
    return null;
  };

  const onDown = (p: Pointer) => {
    const u = frame.unit;
    const at = seatAt(p.x / u, p.y / u);
    if (!at) return;
    const { seat, x, y } = at;
    if (!p.synthetic) seat.touched = local();
    const control = touchDown(seat.table, seat.pads, p.id, x, y, !p.synthetic);
    if (control === "grab") {
      grabs.set(p.id, seat);
      if (grabs.size > 40) {
        const [id, g] = grabs.entries().next().value!;
        grabs.delete(id);
        g.table.drop(id, 0, 0);
      }
      return;
    }
    if (!control) return;
    owner.set(p.id, { seat, control, synthetic: p.synthetic });
    let s = seat.holds.get(control);
    if (!s) {
      s = new Set();
      seat.holds.set(control, s);
    }
    s.add(p.id);
    if (owner.size > 40) owner.delete(owner.keys().next().value!);
    apply(seat, control);
  };

  const onUp = (p: Pointer, thrown: boolean) => {
    const g = grabs.get(p.id);
    if (g) {
      grabs.delete(p.id);
      const k = frame.unit * g.place.k;
      g.table.drop(p.id, thrown ? p.vx / k : 0, thrown ? p.vy / k : 0);
      return;
    }
    const o = owner.get(p.id);
    if (!o) return;
    owner.delete(p.id);
    o.seat.holds.get(o.control)?.delete(p.id);
    apply(o.seat, o.control);
  };

  const offs = [
    ctx.input.on("down", onDown),
    ctx.input.on("move", (p) => {
      if (p.synthetic) return;
      const u = frame.unit;
      const g = grabs.get(p.id);
      if (g)
        g.table.drag(p.id, (p.x / u - g.place.x) / g.place.k, (p.y / u - g.place.y) / g.place.k);
      const at = seatAt(p.x / u, p.y / u);
      if (at) at.seat.touched = local();
    }),
    ctx.input.on("up", (p) => onUp(p, true)),
    ctx.input.on("cancel", (p) => onUp(p, false)),
  ];

  // Test bots start at once.
  claimTestBots();

  // ---- Bots -----------------------------------------------------------------------------------

  /** Turn a test bot's intent into fingers on the pads. */
  const drive = (seat: Seat) => {
    const want: Record<Control, boolean> = {
      ...seat.bot.intent.flippers,
      plunger: seat.bot.intent.plunger,
    };
    const u = frame.unit;
    for (const c of Object.keys(want) as Control[]) {
      const f = seat.fingers.get(c);
      if (want[c] && !f) {
        if (c === "plunger" && !seat.table.waiting()) continue;
        const at = centreOf(seat.pads, c);
        const q = seat.place;
        const x = wall ? q.x + at.x * q.k : at.x;
        const y = wall ? q.y + at.y * q.k : at.y;
        seat.fingers.set(c, seat.hand.press(x * u, y * u));
      } else if (!want[c] && f) {
        f.up();
        seat.fingers.delete(c);
      }
    }
  };

  // ---- Network --------------------------------------------------------------------------------

  let screenSeen = -Infinity;
  const watchScreen = () => {
    const on = cfg.deck && uplink !== null && uplink.screen() !== null;
    const was = deckActive;
    if (on) {
      screenSeen = Math.min(screenSeen, local());
      // Back to the deck once the screen has been heard for a moment.
      deckActive = local() - screenSeen > 400;
    } else {
      screenSeen = Infinity;
      deckActive = false;
    }
    if (deckActive !== was) {
      view.invalidate();
      modeAt = Date.now();
    }
  };
  let modeAt = Date.now();

  const report = (seat: Seat) => {
    if (!uplink) return;
    const t = seat.table;
    const m: ScoreMsg = {
      h: seat.h,
      n,
      s: Math.min(1e10, Math.floor(t.score)),
      b: Math.max(0, Math.min(99, t.left)),
      g: t.ctrl !== "attract" && t.mode !== "over" ? 1 : 0,
      q: Math.min(99, t.inPlay()),
      c: seat.colorIndex,
      a: t.mode === "play" ? 1 : 0,
    };
    const key = `${m.s}|${m.b}|${m.g}|${m.q}|${m.a}`;
    const now = local();
    if (
      key === seat.sentScore ? now - seat.sentAt < SCORE_KEEPALIVE_MS : now - seat.sentAt < SCORE_MS
    )
      return;
    seat.sentScore = key;
    seat.sentAt = now;
    uplink.score(m);
  };

  // ---- Loop -----------------------------------------------------------------------------------

  let lastHook = 0;
  let renderTime = 0;
  const loop = ctx.loop({
    hz: HZ,
    update(dt) {
      const now = clock();
      watchScreen();
      for (const seat of seats) {
        const t = seat.table;
        if (t.ctrl === "attract") {
          seat.bot.update(t);
          applyIntent(t, seat.bot.intent, seat.was);
        } else if (t.ctrl === "bot") {
          seat.bot.update(t);
          drive(seat);
        }
        t.update(dt, now);
        if (t.ctrl === "human" && t.mode === "play" && local() - seat.touched > LEAVE_MS) t.leave();
        if (
          t.ctrl !== "attract" &&
          t.mode === "over" &&
          t.score > seat.best &&
          t.ctrl === "human"
        ) {
          seat.best = t.score;
        }
        if (t.ctrl !== "attract" && t.finished() && !seat.ended) {
          seat.ended = true;
          if (seat.best > seat.bestSaved) {
            seat.bestSaved = seat.best;
            saveBest(bestKey(frameKey, seat.h), seat.best);
          }
          stationOf(seat)?.end();
        }
        report(seat);
      }
      wall?.update(dt);
      const l = local();
      if (l - lastClaim > 250) {
        lastClaim = l;
        claimTestBots();
      }
      if (ctx.debug && l - lastHook > HOOK_MS) {
        lastHook = l;
        hook();
      }
    },
    render(alpha) {
      renderTime = local() / 1000;
      const scenes: TableScene[] = seats.map((seat) => ({
        table: seat.table,
        place: seat.place,
        cell: spots?.[seat.h]?.cell,
        pads: seat.pads,
        color: seat.color,
        deck: deckActive,
        attract: seat.table.ctrl === "attract",
        bot: seat.table.ctrl === "bot",
        pressed: new Set([...seat.holds.entries()].filter(([, s]) => s.size > 0).map(([c]) => c)),
        best: seat.best,
      }));
      view.draw(scenes, alpha, renderTime);
      wall?.render(alpha);
    },
  });
  let lastClaim = 0;
  loop.start();

  const offResize = ctx.onResize((f) => {
    frame = f;
    view.resize(f, wall?.layout.floor);
    wall?.resize(f);
    defineStations();
  });

  // ---- Test hook ------------------------------------------------------------------------------

  const debugKey = "__pinball";
  const hook = () => {
    ctx.root.dataset.pinball = JSON.stringify({
      kind: "table",
      deck: deckActive,
      screen: uplink?.screen() ?? null,
      tables: seats.map((s) => ({
        ctrl: s.table.ctrl,
        mode: s.table.mode,
        score: s.table.score,
        left: s.table.left,
        inPlay: s.table.inPlay(),
        station: stationOf(s)?.state ?? "idle",
      })),
    });
  };
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        ...wall?.api,
        state: () => ({
          kind: wall ? "wall" : "table",
          view: cfg.theme ? "3d" : "2d",
          deck: deckActive,
          ...(wall ? { band: wall.debug() } : {}),
          modeAt,
          screen: uplink?.screen() ?? null,
          clock: clock(),
          ups: [...ups],
          downs: [...downs],
          upCount,
          downCount,
          giftCount,
          gifts: [...gifts],
          tables: seats.map((s) => {
            const t = s.table;
            return {
              h: s.h,
              ctrl: t.ctrl,
              mode: t.mode,
              score: t.score,
              left: t.left,
              inPlay: t.inPlay(),
              waiting: t.waiting(),
              station: stationOf(s)?.state ?? "idle",
              pads: s.pads,
              place: s.place,
              exitU: t.layout.exitU,
              returnU: t.layout.returnU,
              mirror: t.layout.mirror,
              balls: t.world.balls.map((b) => ({
                id: b.id,
                x: b.x,
                y: b.y,
                vx: b.vx,
                vy: b.vy,
                bonus: b.bonus,
                held: b.hold !== null,
              })),
              tubes: t.tubes.map((b) => ({
                id: b.id,
                kind: b.kind,
                x: b.x,
                y: b.y,
                start: b.start,
              })),
              flippers: t.world.flippers.map((f) => ({
                name: f.name,
                angle: f.angle,
                held: f.held,
              })),
              stats: { ...t.stats, byFlipper: [...t.stats.byFlipper] },
              active: t.gifts.map((g) => g.kind),
              held: t.toys.held().length,
              shakeAt: t.shake.at,
            };
          }),
        }),
        setLag(ms: number) {
          if (uplink) uplink.lag = Math.max(0, Math.min(2000, ms));
        },
        /** Put a ball on table `h` at (x, y) table px, moving (vx, vy). */
        place(h: number, x: number, y: number, vx = 0, vy = 0) {
          const t = seats[h]?.table;
          if (!t || t.mode !== "play") return false;
          t.place(x, y, vx, vy);
          return true;
        },
        /** Where a themed table's toys are, for tests: the theme's middle data. */
        middle: (h = 0) => seats[h]?.table.layout.middle ?? null,
        /** Put a ball into a table's deck lane, heading up it. */
        shoot(h = 0) {
          const t = seats[h]?.table;
          if (!t) return false;
          const dl = t.layout.deckLane;
          t.place(
            dl.mouth.x + dl.dir.x * 30,
            dl.mouth.y + dl.dir.y * 30,
            dl.dir.x * 2200,
            dl.dir.y * 2200,
          );
          return true;
        },
      },
    });
  }

  return {
    reset() {
      for (const seat of seats) {
        const st = stationOf(seat);
        if (st && st.state !== "idle" && !st.bot) st.end();
      }
      wall?.reset();
    },
    attract() {},
    status() {
      const t = seats[0]?.table;
      return {
        score: seats.map((s) => s.table.score).join("/"),
        balls: seats.map((s) => s.table.left).join("/"),
        inPlay: seats.reduce((a, s) => a + s.table.inPlay(), 0),
        players: seats.filter((s) => s.table.ctrl === "human").length,
        deck: deckActive ? "screen" : "orbit",
        ups: upCount,
        downs: downCount,
        gifts: giftCount,
        ...(t ? { mode: t.mode } : {}),
        ...wall?.status(),
      };
    },
    command(name) {
      if (wall?.command(name)) return;
      if (name !== "rain") return;
      const now = clock();
      for (const seat of seats) {
        const t = seat.table;
        if (t.ctrl !== "attract" && t.mode === "play" && t.inPlay() < MAX_IN_PLAY) {
          t.addDown({ id: 0, color: seat.colorIndex, t: now }, now);
        }
      }
    },
    homeSpot(size) {
      const u = frame.unit;
      // On a wall, in the middle gap, which has no reset control: those sit in the gaps on the
      // outer side of each table.
      const r = seats.findIndex((s) => sideOf(s.h) === "right");
      const a = seats[r - 1];
      const b = seats[r];
      if (wall && a && b) {
        const end = a.place.x + TABLE_W * a.place.k;
        const x = ((end + b.place.x) / 2) * u - size / 2;
        return { x, y: Math.max(0, frame.reachTop.adult) + 40 * u };
      }
      // A top corner outside the arch, away from the first table's reset control.
      const left = sideOf(0) === "right";
      return { x: left ? 40 * u : (TABLE_W - 40) * u - size, y: 40 * u };
    },
    dispose() {
      loop.stop();
      offResize();
      for (const off of offs) off();
      set?.dispose();
      set = null;
      for (const seat of seats) {
        releaseFingers(seat);
        seat.hand.dispose();
      }
      owner.clear();
      grabs.clear();
      uplink?.dispose();
      view.dispose();
      wall?.dispose();
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
