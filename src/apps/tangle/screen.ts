/**
 * The screen above a bank: it holds the arena and runs it at HZ for every panel below. Panels
 * send who is seated and how they steer (in `grid`, their presses); turns apply as they arrive,
 * with no rollback. A
 * station not heard from for SEAT_LOST_MS is handed to a bot. With no panels at all the screen
 * keeps running bot rounds.
 */
import type { AppContext, AppInstance, FrameKind } from "../../core/types";
import { arenaParams, createArena } from "./arena";
import { type Config, HZ } from "./config";
import { createMatch, type SeatKind } from "./match";
import {
  decodeAim,
  decodeSeat,
  decodeTurn,
  encodeRound,
  MAX_KEY,
  packHeading,
  TOPIC_AIM,
  TOPIC_ALIVE,
  TOPIC_ROUND,
  TOPIC_SEAT,
  TOPIC_TURN,
} from "./protocol";
import { bankSlots, insetFor } from "./slots";
import { createArenaView } from "./view";

/** A seated station whose panel has been quiet this long is played by a bot. */
export const SEAT_LOST_MS = 1500;
const ROUND_EVERY_MS = 1000;
const REPORT_MS = 500;
const ALIVE_EVERY_MS = 250;
const POKE_EVERY_MS = 1000;

/** Presses waiting at one station; an older one makes way for a newer. */
const PRESS_QUEUE = 2;

interface Remote {
  on: boolean;
  bot: boolean;
  dir: number;
  q: number;
  heard: number;
  /** Grid: the panel's press count last heard (-1 until the first message), and presses waiting. */
  n: number;
  queue: Int8Array;
  queued: number;
}

export const mountScreen = (ctx: AppContext, cfg: Config): AppInstance => {
  const u = ctx.frame.unit;
  const frameW = ctx.frame.width / u;
  const frameH = ctx.frame.height / u;
  const rect = { x: 0, y: 0, width: frameW, height: frameH };
  const inset = insetFor(frameW, frameH);
  const view = createArenaView(ctx.root, ctx.ui.palette, "Touch a panel below to play");
  view.place({ rect, inset, unit: u, pixelRatio: ctx.frame.pixelRatio });
  const { width, height } = view.units;
  const params = arenaParams(width, height, cfg.variant);
  const arena = createArena({
    width,
    height,
    params,
    variant: cfg.variant,
    gaps: cfg.gaps,
    trail: cfg.trail,
    edges: cfg.edges,
    rng: ctx.rng("tangle:arena"),
  });
  const count = Math.max(1, Math.min(32, ctx.setup.count));
  const remote = new Map<number, Remote>();

  const kinds = (): FrameKind[] => {
    const peers = ctx.net.peers().filter((p) => p.role !== "screen");
    const pairs = peers.filter((p) => p.kind === "pair").length;
    const fallback: FrameKind = pairs > peers.length / 2 ? "pair" : "panel";
    return Array.from({ length: count }, (_, pos) => {
      const k = peers.find((p) => p.pos === pos)?.kind;
      return k === "pair" || k === "panel" ? k : fallback;
    });
  };
  let shape = kinds();
  /** Station keys the bank has now, or will have from the next round. */
  let valid = new Set<number>();
  const slotsFor = (list: FrameKind[]) => {
    const slots = bankSlots(
      count,
      (pos) => list[pos] ?? "panel",
      cfg.perFrame,
      cfg.variant === "grid" ? "aim" : "turn",
      frameW,
      inset.left,
      width,
      height,
      params,
    );
    valid = new Set(slots.filter((s) => !s.virtual).map((s) => s.key));
    return slots;
  };

  const seat = (key: number): SeatKind | null => {
    const r = remote.get(key);
    if (!r || !r.on || performance.now() - r.heard > SEAT_LOST_MS) return null;
    return r.bot ? "bot" : "human";
  };

  let lastRound = -Infinity;
  let lastAlive = -Infinity;
  let lastPoke = -Infinity;
  const sendRound = () => {
    lastRound = performance.now();
    ctx.net.send(
      TOPIC_ROUND,
      encodeRound({
        r: match.round,
        p: match.phase,
        s: match.since,
        e: match.until,
        a: match.attract,
        k: match.runners.map((r) => (r.slot.virtual ? -1 : r.key)),
        m: match.runners.map((r) => (r.mode === "human" ? 0 : r.mode === "seated" ? 1 : 2)),
      }),
    );
  };
  const sendAlive = () => {
    lastAlive = performance.now();
    ctx.net.send(TOPIC_ALIVE, {
      r: match.round,
      l: match.runners.map((r) => (r.line.alive ? 1 : 0)),
      h: match.runners.map((r) => packHeading(r.line.heading)),
      pl: match.places ? [...match.places] : [],
    });
  };

  const match = createMatch({
    cfg,
    arena,
    slots: slotsFor(shape),
    rng: ctx.rng("tangle:bots"),
    now: ctx.clock.now(),
    firstDelay: 300,
    host: {
      seat,
      dir: (key) => remote.get(key)?.dir ?? 0,
      press(key) {
        const r = remote.get(key);
        if (!r || r.queued === 0) return -1;
        const d = r.queue[0]!;
        r.queue[0] = r.queue[1]!;
        r.queued--;
        return d;
      },
      changed: sendRound,
    },
  });

  /** Accept a panel's message unless an earlier one overtook it. */
  const fresh = (key: number, q: number): Remote | null => {
    if (key > MAX_KEY || !valid.has(key)) return null;
    const local = performance.now();
    let r = remote.get(key);
    if (!r) {
      if (remote.size >= 4 * (MAX_KEY + 1)) return null;
      r = {
        on: false,
        bot: false,
        dir: 0,
        q: -1,
        heard: -Infinity,
        n: -1,
        queue: new Int8Array(PRESS_QUEUE),
        queued: 0,
      };
      remote.set(key, r);
    }
    // A reloaded panel starts counting again; anything after a pause is taken as new.
    if (q <= r.q && local - r.heard < SEAT_LOST_MS) return null;
    if (local - r.heard >= SEAT_LOST_MS) {
      // Presses from before a pause are stale, and the count starts again from what comes next.
      r.n = -1;
      r.queued = 0;
    }
    r.q = q;
    r.heard = local;
    return r;
  };

  const offs = [
    ctx.net.on(TOPIC_TURN, (data) => {
      const m = decodeTurn(data);
      const r = m && fresh(m.k, m.q);
      if (!m || !r) return;
      r.on = true;
      r.bot = m.b;
      r.dir = m.d;
    }),
    ctx.net.on(TOPIC_AIM, (data) => {
      const m = decodeAim(data);
      const r = m && fresh(m.k, m.q);
      if (!m || !r) return;
      r.on = true;
      r.bot = m.b;
      const pressed = r.n >= 0 && m.n !== r.n && m.g >= 0;
      r.n = m.n;
      if (!pressed) return;
      if (r.queued >= PRESS_QUEUE) {
        r.queue[0] = r.queue[1]!;
        r.queued--;
      }
      r.queue[r.queued++] = m.g;
    }),
    ctx.net.on(TOPIC_SEAT, (data) => {
      const m = decodeSeat(data);
      const r = m && fresh(m.k, m.q);
      if (!m || !r) return;
      r.on = m.on;
      r.bot = m.b;
      r.dir = 0;
    }),
    ctx.net.onPeers(() => {
      const next = kinds();
      if (next.join() === shape.join()) return;
      shape = next;
      match.setSlots(slotsFor(shape));
    }),
  ];

  let lastReport = -Infinity;
  const report = (local: number) => {
    if (local - lastReport < REPORT_MS) return;
    lastReport = local;
    // Read by tests.
    ctx.root.dataset.tangle = JSON.stringify({
      phase: match.phase,
      attract: match.attract,
      round: match.round,
      humans: match.humans,
      seats: [...remote]
        .filter(([k]) => seat(k) !== null)
        .map(([k, r]) => [k, r.bot ? 1 : 0, r.dir]),
      runners: match.runners.map((r) => [
        r.key,
        r.mode,
        r.line.alive ? 1 : 0,
        Math.round(r.line.heading * 1000) / 1000,
        Math.round(r.line.x),
        Math.round(r.line.y),
      ]),
    });
  };

  let lastDraw = performance.now();
  const loop = ctx.loop({
    hz: HZ,
    update() {
      const now = ctx.clock.now();
      const local = performance.now();
      match.tick(now);
      if (local - lastRound >= ROUND_EVERY_MS) sendRound();
      const every =
        match.phase === "play" ? ALIVE_EVERY_MS : match.phase === "over" ? 500 : Infinity;
      if (local - lastAlive >= every) sendAlive();
      // People are playing below: the screen mustn't go idle under them.
      if (match.humans > 0 && local - lastPoke >= POKE_EVERY_MS) {
        lastPoke = local;
        ctx.idle.poke();
      }
      report(local);
    },
    render() {
      const local = performance.now();
      const dt = Math.min(0.1, (local - lastDraw) / 1000);
      lastDraw = local;
      view.draw({ match, cfg, now: ctx.clock.now(), dt, seat });
    },
  });
  loop.start();

  return {
    reset() {
      match.reset(ctx.clock.now());
    },
    status() {
      return {
        phase: match.attract && match.phase === "play" ? "attract" : match.phase,
        humans: match.humans,
        bots: match.runners.filter((r) => r.mode !== "human").length,
        rounds: match.played,
        panels: ctx.net.peers().filter((p) => p.role !== "screen").length,
      };
    },
    dispose() {
      loop.stop();
      for (const off of offs) off();
      remote.clear();
      view.dispose();
    },
  };
};
