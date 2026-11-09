/**
 * A touch frame: a wall, a panel or a pair. On its own it plays its own arena above its
 * stations. In a bank it is a steering pad for the screen above and shows each station's status;
 * if the screen goes quiet for SCREEN_LOST_MS it plays a local round instead, and once the
 * screen is back (and no local round with people is under way) it rejoins the screen's next lobby.
 */
import type { AppContext, AppInstance } from "../../core/types";
import { dirOf, speedUp } from "./arena";
import { type Config, COUNTDOWN_MS, HZ, LOBBY_MS, OVER_MS, SPEED_FACTOR } from "./config";
import { createDeck, type Deck, type StationStatus } from "./deck";
import { createLocalGame, type LocalGame } from "./game";
import { type FrameLayout, frameLayout } from "./layout";
import { createPanelLink, type PanelLink, SCREEN_LOST_MS } from "./link";
import type { Match, Phase } from "./match";
import { stationKey, unpackHeading } from "./protocol";
import { createSeating, type Seating } from "./seating";
import { lookOf } from "./slots";

/** Least time between switching to local play and back, so a flickering link can't thrash. */
const SWITCH_MS = 2000;
const POKE_EVERY_MS = 1000;
const REPORT_MS = 500;
/** Turning rate of a full-size line at normal speed (320 per second on a 100 radius). */
const SCREEN_TURN = 3.2;

interface Parts {
  layout: FrameLayout;
  seating: Seating;
  deck: Deck;
  link: PanelLink | null;
  keys: number[];
  status: StationStatus[];
  shown: Float64Array;
}

const wrap = (a: number) => {
  let v = a % (Math.PI * 2);
  if (v > Math.PI) v -= Math.PI * 2;
  if (v < -Math.PI) v += Math.PI * 2;
  return v;
};

/** Seconds until the round after this one starts, roughly. */
const nextRoundIn = (phase: Phase, until: number, now: number): number => {
  const left = Math.max(0, until - now);
  if (phase === "play") return (left + OVER_MS + LOBBY_MS + COUNTDOWN_MS) / 1000;
  if (phase === "over") return (left + LOBBY_MS + COUNTDOWN_MS) / 1000;
  return 0;
};

export const mountTouch = (ctx: AppContext, cfg: Config): AppInstance => {
  const bank = ctx.setup.name === "bank";
  const aim = cfg.variant === "grid";
  const palette = ctx.ui.palette;
  const mountedAt = performance.now();
  let mode: "linked" | "local" = bank ? "linked" : "local";
  let switchedAt = -Infinity;
  /** Ms from the screen's last message to switching to local play, for tests. */
  let lostAfter: number | null = null;
  let game: LocalGame | null = null;
  let parts: Parts | null = null;

  const midRound = (): boolean => {
    if (mode === "linked") {
      const s = parts?.link?.screen;
      return !!s && (s.phase === "play" || s.phase === "over") && !s.attract;
    }
    const m = game?.match;
    return !!m && (m.phase === "play" || m.phase === "over") && !m.attract;
  };

  const build = (): Parts => {
    const f = ctx.frame;
    const u = f.unit;
    const layout = frameLayout({
      kind: f.kind,
      width: f.width / u,
      height: f.height / u,
      seams: f.seams.map((s) => s / u),
      reachTop: f.reachTop.adult / u,
      wallStations: cfg.wallStations,
      perFrame: bank ? cfg.perFrame : 1,
      pads: aim ? "aim" : "turn",
    });
    const n = layout.stations.length;
    const base = bank ? ctx.setup.pos * n : 0;
    const colors = layout.stations.map((_, j) => lookOf(base + j).color);
    const seating = createSeating({ ctx, layout, colors, midRound, testBots: ctx.bots });
    const deck = createDeck(
      ctx.root,
      layout,
      colors.map((c) => palette.players[c % palette.players.length]!),
      palette,
      u,
      f.pixelRatio,
    );
    const keys = layout.stations.map((s) => stationKey(ctx.setup.pos, s.index));
    const link = bank ? createPanelLink({ net: ctx.net, seating, keys, aim }) : null;
    link?.setActive(mode === "linked");
    return {
      layout,
      seating,
      deck,
      link,
      keys,
      status: layout.stations.map(() => ({
        state: "idle",
        bot: false,
        held: 0,
        facing: -1,
        phase: "lobby",
        attract: true,
        inRound: false,
        alive: false,
        heading: null,
        place: null,
        nextIn: null,
        countdown: null,
      })),
      shown: new Float64Array(n).fill(-Math.PI / 2),
    };
  };

  const goLocal = (now: number, local: number) => {
    if (!parts) return;
    mode = "local";
    switchedAt = local;
    const heard = parts.link?.screen?.heard;
    lostAfter = heard === undefined ? null : Math.round(local - heard);
    parts.link?.setActive(false);
    game?.dispose();
    game = createLocalGame(ctx, cfg, parts.layout, parts.seating, 300);
    // People were mid-round on the screen: start them again without a lobby wait.
    game.hurry(now);
  };

  const goLinked = (local: number) => {
    mode = "linked";
    switchedAt = local;
    game?.dispose();
    game = null;
    parts?.link?.setActive(true);
  };

  const arrange = () => {
    game?.dispose();
    game = null;
    if (parts) {
      parts.link?.dispose();
      parts.deck.dispose();
      parts.seating.dispose();
    }
    parts = build();
    if (mode === "local") game = createLocalGame(ctx, cfg, parts.layout, parts.seating, 300);
  };
  arrange();
  const offResize = ctx.onResize(arrange);

  /** Whether a local round can be left for the screen's next lobby. */
  const canYield = (m: Match) => m.attract || m.phase !== "play";

  const localStatus = (p: Parts, m: Match, now: number) => {
    p.status.forEach((st, j) => {
      const idx = m.runners.findIndex((r) => r.key === j);
      const r = idx >= 0 ? m.runners[idx] : undefined;
      st.phase = m.phase;
      st.attract = m.attract;
      st.inRound = !!r && r.mode !== "bot";
      st.alive = !!r?.line.alive;
      st.heading = st.inRound && r ? r.line.heading : null;
      st.facing = aim && st.inRound && r?.line.alive ? r.line.aim : -1;
      st.place =
        m.phase === "over" && m.places && idx >= 0 && st.inRound ? (m.places[idx] ?? null) : null;
      st.nextIn = m.waiting(j) ? nextRoundIn(m.phase, m.until, now) : null;
      st.countdown = m.phase === "countdown" && p.seating.seat(j) ? (m.until - now) / 1000 : null;
    });
  };

  const linkedStatus = (p: Parts, now: number, local: number, dt: number) => {
    const s = p.link?.screen ?? null;
    p.status.forEach((st, j) => {
      const seated = p.seating.seat(j) !== null;
      if (!s) {
        st.phase = "lobby";
        st.attract = true;
        st.inRound = false;
        st.alive = false;
        st.heading = null;
        st.facing = -1;
        st.place = null;
        st.nextIn = null;
        st.countdown = null;
        return;
      }
      const idx = s.keys.indexOf(p.keys[j]!);
      st.phase = s.phase;
      st.attract = s.attract;
      st.inRound = idx >= 0 && s.modes[idx] !== 2;
      st.alive = idx >= 0 && s.alive[idx] === 1;
      st.facing = -1;
      if (st.inRound && st.alive) {
        // Between the screen's updates, turn the arrow the way the player is steering.
        const t = (now - s.since) / 1000;
        const rate = SCREEN_TURN * SPEED_FACTOR[cfg.speed] * speedUp(cfg.variant, t);
        const heading = unpackHeading(s.headings[idx] ?? 192);
        const target = aim
          ? heading
          : heading + p.seating.dir(j) * rate * ((local - s.aliveAt) / 1000);
        if (aim) st.facing = dirOf(heading);
        const shown = p.shown[j]!;
        p.shown[j] = shown + wrap(target - shown) * (1 - Math.exp(-dt * 14));
        st.heading = p.shown[j]!;
      } else {
        p.shown[j] = -Math.PI / 2;
        st.heading = null;
      }
      st.place = s.phase === "over" && st.inRound ? (s.places[idx] ?? null) : null;
      const waiting =
        seated && (s.phase === "play" || s.phase === "over") && (s.attract || !st.inRound);
      st.nextIn = waiting ? nextRoundIn(s.phase, s.until, now) : null;
      st.countdown = s.phase === "countdown" && seated ? (s.until - now) / 1000 : null;
    });
  };

  let lastPoke = -Infinity;
  let lastReport = -Infinity;
  const report = (p: Parts, local: number) => {
    if (local - lastReport < REPORT_MS) return;
    lastReport = local;
    const m = game?.match;
    const s = p.link?.screen;
    // Read by tests.
    ctx.root.dataset.tangle = JSON.stringify({
      mode,
      linked: p.link ? p.link.linked(local) : null,
      lostAfter,
      phase: m?.phase ?? s?.phase ?? null,
      attract: m?.attract ?? s?.attract ?? null,
      round: m?.round ?? s?.round ?? 0,
      seats: p.seating.list.map((st) => `${st.state}${st.bot ? "*" : ""}`),
      runners: m ? m.runners.map((r) => [r.key, r.mode, r.line.alive ? 1 : 0]) : null,
    });
  };

  let lastDraw = performance.now();
  const loop = ctx.loop({
    hz: HZ,
    update() {
      const p = parts;
      if (!p) return;
      const now = ctx.clock.now();
      const local = performance.now();
      p.seating.tick(local);
      if (p.link) {
        const linked = p.link.linked(local);
        if (local - switchedAt >= SWITCH_MS) {
          if (mode === "linked" && !linked && local - mountedAt >= SCREEN_LOST_MS)
            goLocal(now, local);
          else if (mode === "local" && linked && game && canYield(game.match)) goLinked(local);
        }
        p.link.tick(local);
      }
      game?.tick(now);
      const humans = p.seating.list.some(
        (s) => !s.bot && (s.state === "ready" || s.state === "playing"),
      );
      if (humans && local - lastPoke >= POKE_EVERY_MS) {
        lastPoke = local;
        ctx.idle.poke();
      }
      report(p, local);
    },
    render() {
      const p = parts;
      if (!p) return;
      const local = performance.now();
      const dt = Math.min(0.1, (local - lastDraw) / 1000);
      lastDraw = local;
      const now = ctx.clock.now();
      p.status.forEach((st, j) => {
        const s = p.seating.list[j]!;
        st.state = s.state;
        st.bot = s.bot;
        let held = 0;
        for (let k = 0; k < 4; k++) if (p.seating.pads.held(j, k)) held |= 1 << k;
        st.held = held;
      });
      if (mode === "local" && game) {
        localStatus(p, game.match, now);
        game.draw(now, dt);
      } else linkedStatus(p, now, local, dt);
      p.deck.draw(p.status, mode === "linked", dt);
    },
  });
  loop.start();

  return {
    reset() {
      parts?.seating.endAll();
      game?.match.reset(ctx.clock.now());
    },
    homeSpot(size) {
      const f = ctx.frame;
      const arena = parts?.layout.arena;
      const bottom = (arena ? arena.y + arena.height : f.height / f.unit) * f.unit;
      const margin = 28 * f.unit;
      return { x: f.width - size - margin, y: Math.max(0, bottom - size - margin) };
    },
    status() {
      const m = game?.match;
      const s = parts?.link?.screen;
      const seats = parts?.seating.list ?? [];
      return {
        phase: m
          ? m.attract && m.phase === "play"
            ? "attract"
            : m.phase
          : (s?.phase ?? "waiting"),
        humans: seats.filter((st) => !st.bot && st.state !== "idle").length,
        bots: m
          ? m.runners.filter((r) => r.mode !== "human").length
          : seats.filter((st) => st.bot).length,
        rounds: m?.played ?? 0,
        ...(bank ? { linked: mode === "linked" } : {}),
      };
    },
    dispose() {
      loop.stop();
      offResize();
      game?.dispose();
      game = null;
      if (parts) {
        parts.link?.dispose();
        parts.deck.dispose();
        parts.seating.dispose();
      }
      parts = null;
    },
  };
};
