/**
 * A touch frame: a wall with one to three benches, a pair, panel or kiosk with one, or one frame
 * of a bank. Solo benches run their own ramp of puzzles; a bank frame plays its part of the
 * bank's round, takes light in from its neighbours (or a faint guide where none arrives) and
 * sends its own on.
 */
import { bankFraction } from "../../core/layout";
import type { AppContext, AppInstance, FrameInfo, OptionValue } from "../../core/types";
import { type Bench, createBench } from "./bench";
import { type Hand, createHand } from "./bots";
import { bankBench, bankChain, bankRamp } from "./chain";
import {
  BOT_REST,
  BOT_WRONG,
  BOT_YIELD_MS,
  CELEBRATE_MS,
  type Config,
  GHOST_REST,
  RESET_HOLD_MS,
} from "./config";
import { generate } from "./generate";
import { type BenchLayout, type FrameLayout, frameLayout } from "./layout";
import { createEdgeLink, type EdgeLink } from "./link";
import { type LevelId, NEED, type Puzzle, rampOf, startIndex } from "./puzzle";
import { type Rounds, createRounds } from "./rounds";
import { EDGE_LEFT, EDGE_RIGHT, EDGE_TOP, type Source } from "./trace";
import { type BenchLook, createTouchView } from "./view";
import { type EdgeBeam, MAX_BEAMS, type SkyBeam, hopOn } from "./wire";

interface Slot {
  bench: Bench;
  layout: BenchLayout;
  serial: number;
  /** Index into the ramp. */
  level: number;
  arrived: number;
  cheer: number;
  /** Local ms the next puzzle is due (solo), or Infinity. */
  nextAt: number;
  wasSolved: boolean;
  lastHuman: number;
  ghost: boolean;
  hand: Hand;
  bot: boolean;
  guideAt: { x: number; y: number }[];
  /** Crystals are still brightening or fading. */
  easing: boolean;
}

/** Light from a neighbour this close to where it is expected counts as arriving there. */
const MATCH_ANGLE = (4 * Math.PI) / 180;

export const mountTouch = (ctx: AppContext, cfg: Config): AppInstance => {
  let frame: FrameInfo = ctx.frame;
  const isBank = ctx.setup.name === "bank" && ctx.setup.role === "station";
  const venue = { width: frame.venueWidth, height: frame.venueHeight };
  const span = frame.span ?? 1;
  const layout: FrameLayout = isBank
    ? {
        W: venue.width,
        H: venue.height,
        kind: frame.kind,
        benches: [bankBench(frame.kind, span, venue)],
      }
    : frameLayout(frame.kind, venue, frame.reach, { benches: cfg.benches, span });
  const now = () => performance.now();
  const ramp: readonly LevelId[] = isBank ? bankRamp(cfg.colour) : rampOf(cfg.colour);
  const start = Math.min(ramp.length - 1, startIndex(cfg.start));
  const count = Math.max(1, ctx.setup.count);
  const pos = Math.max(0, Math.min(count - 1, ctx.setup.pos));
  let disposed = false;

  const view = createTouchView(ctx.root, layout, frame);
  const backdrop = document.createElement("div");
  backdrop.style.cssText = "position:absolute;inset:0;z-index:-1;background:#03050b;";
  ctx.root.append(backdrop);

  // ---- Benches -----------------------------------------------------------------------------

  const solo = (L: BenchLayout, serial: number, level: number): Puzzle =>
    generate({
      bench: L,
      level: ramp[level] ?? "m1",
      seed: `optics:${ctx.seed}:${frame.kind}:${L.index}:${layout.benches.length}:${serial}`,
      colour: cfg.colour,
      bank: null,
    });

  const sandboxPuzzle = (L: BenchLayout): Puzzle => {
    // Lamps at two spots on opposite sides; crystals of every colour scattered about.
    const rng = ctx.rng(`optics:sandbox:${L.index}`);
    const left = L.lampSpots.filter((s) => s.side === "l");
    const right = L.lampSpots.filter((s) => s.side === "r");
    // A low lamp on one side and a high one on the other, so their beams cross the bench apart.
    const inset = left.length > 3 ? 1 : 0;
    const a = left[Math.max(0, left.length - 1 - inset)] ?? L.lampSpots[0];
    const b = right[Math.min(right.length - 1, inset)] ?? L.lampSpots[1];
    const lamps: Puzzle["lamps"] = [];
    if (a) lamps.push({ kind: "white", x: a.x, y: a.y, angle: 0, spot: L.lampSpots.indexOf(a) });
    if (b)
      lamps.push({ kind: "wide", x: b.x, y: b.y, angle: Math.PI, spot: L.lampSpots.indexOf(b) });
    const bands = cfg.colour
      ? (["w", "r", "g", "b", "w", "r", "g", "b"] as const)
      : (["w", "w", "w", "w"] as const);
    const crystals: Puzzle["crystals"] = [];
    const R = L.sizes.piece;
    const rc = L.sizes.crystal;
    for (const band of bands) {
      for (let tries = 0; tries < 60; tries++) {
        const x = L.box.x + rng.range(R, L.box.width - R);
        const y = rng.range(Math.max(L.box.y + 200, L.reachTop * 0.4), L.box.y + L.box.height - R);
        const ok =
          L.sockets.every((s) => Math.hypot(s.x - x, s.y - y) > R + rc) &&
          crystals.every((c) => Math.hypot(c.x - x, c.y - y) > rc * 4) &&
          // Off the lamps' straight beams, so nothing glows until a piece sends light there.
          lamps.every((l) => Math.abs(l.y - y) > rc + L.sizes.bundle * 2.6) &&
          !L.keepOut.some(
            (k) =>
              x > k.x - rc && x < k.x + k.width + rc && y > k.y - rc && y < k.y + k.height + rc,
          );
        if (!ok) continue;
        crystals.push({ x, y, r: rc, band, need: NEED });
        break;
      }
    }
    return {
      level: "m1",
      lamps,
      crystals,
      fixed: [],
      pieces: [],
      solution: [],
      start: [],
      entry: [],
      exits: [],
      sky: [],
      fallback: false,
    };
  };

  const slots: Slot[] = layout.benches.map((L, i) => {
    const bench = createBench({ layout: L, sandbox: cfg.sandbox, colour: cfg.colour, now });
    const bot = ctx.bots > i;
    const slot: Slot = {
      bench,
      layout: L,
      serial: 0,
      level: start,
      arrived: now(),
      cheer: -Infinity,
      nextAt: Infinity,
      wasSolved: false,
      lastHuman: -Infinity,
      ghost: !bot,
      bot,
      guideAt: [],
      easing: false,
      hand: createHand({
        input: ctx.input,
        rng: ctx.rng(`optics:hand:${i}`),
        bench: () => bench,
        unit: () => frame.unit,
        rest: bot ? BOT_REST : GHOST_REST,
        wrong: bot ? BOT_WRONG : 0,
        pace: bot ? 1 : 1.6,
      }),
    };
    return slot;
  });

  const loadSolo = (s: Slot) => {
    s.bench.load(cfg.sandbox ? sandboxPuzzle(s.layout) : solo(s.layout, s.serial, s.level));
    s.arrived = now();
    s.nextAt = Infinity;
    s.wasSolved = s.bench.solved;
  };

  // ---- Bank ----------------------------------------------------------------------------------

  let link: EdgeLink | null = null;
  let warm: { serial: number; level: number; k: number } | null = null;
  let rounds: Rounds | null = null;
  let extraKey = "";

  const bankLoad = (serial: number, level: number) => {
    const s = slots[0]!;
    const chain = bankChain(
      {
        seed: ctx.seed,
        bench: s.layout,
        serial,
        level: ramp[level] ?? "m1",
        colour: cfg.colour,
        count,
      },
      pos,
    );
    const p = chain[pos];
    if (!p) return;
    s.serial = serial;
    s.level = level;
    if (cfg.sandbox) s.bench.load(sandboxPuzzle(s.layout));
    else s.bench.load(p);
    s.arrived = now();
    extraKey = "";
    outVersion = -1;
    updateExtra();
  };

  /** Sources for light coming in, matched against where the puzzle expects it. */
  const updateExtra = () => {
    if (!link) return;
    const s = slots[0]!;
    const W = layout.W;
    const H = layout.H;
    const R = s.layout.sizes.piece;
    const inc = link.incoming();
    const left = hopOn(inc.left);
    const right = hopOn(inc.right);
    const sources: Source[] = [];
    const used = new Set<EdgeBeam>();
    const guides: { x: number; y: number }[] = [];
    for (const e of s.bench.puzzle.entry) {
      const ea = Math.atan2(e.dy, e.dx);
      const m = left.find(
        (b) =>
          !used.has(b) &&
          b.bits === e.bits &&
          Math.abs(b.y * H - e.y) <= 0.3 * R &&
          Math.abs(Math.atan2(Math.sin(b.a - ea), Math.cos(b.a - ea))) <= MATCH_ANGLE,
      );
      if (m) {
        used.add(m);
        sources.push({ ...e, guide: false, hops: m.hops });
      } else {
        sources.push({ ...e, guide: true, hops: 0 });
        guides.push({ x: e.x, y: e.y });
      }
    }
    for (const b of left) {
      if (used.has(b) || Math.cos(b.a) <= 0.01) continue;
      sources.push({
        x: 0.5,
        y: b.y * H,
        dx: Math.cos(b.a),
        dy: Math.sin(b.a),
        bits: b.bits,
        level: b.level,
        guide: false,
        hops: b.hops,
      });
    }
    for (const b of right) {
      if (Math.cos(b.a) >= -0.01) continue;
      sources.push({
        x: W - 0.5,
        y: b.y * H,
        dx: Math.cos(b.a),
        dy: Math.sin(b.a),
        bits: b.bits,
        level: b.level,
        guide: false,
        hops: b.hops,
      });
    }
    s.guideAt = guides;
    const key = JSON.stringify(
      sources.map((x) => [x.x, x.y, x.dx, x.dy, x.bits, x.level, x.guide, x.hops]),
    );
    if (key === extraKey) return;
    extraKey = key;
    s.bench.setExtra(sources);
  };

  let outVersion = -1;
  const updateOut = () => {
    if (!link) return;
    const s = slots[0]!;
    if (outVersion === s.bench.traceVersion) return;
    outVersion = s.bench.traceVersion;
    const W = layout.W;
    const H = layout.H;
    const left: EdgeBeam[] = [];
    const right: EdgeBeam[] = [];
    const sky: SkyBeam[] = [];
    for (const e of s.bench.result.exits) {
      const a = Math.atan2(e.dy, e.dx);
      if (e.edge === EDGE_TOP) {
        sky.push({
          x: bankFraction(pos, e.x / W, count),
          a,
          bits: e.bits,
          level: e.level,
          guide: e.guide,
        });
        continue;
      }
      // Guide light is only a hint; it never crosses into a neighbour.
      if (e.guide) continue;
      const beam = {
        y: Math.min(1, Math.max(0, e.y / H)),
        a,
        bits: e.bits,
        level: e.level,
        hops: e.hops,
      };
      if (e.edge === EDGE_LEFT) left.push(beam);
      else if (e.edge === EDGE_RIGHT) right.push(beam);
    }
    const top = <T extends { level: number }>(xs: T[]) =>
      xs.sort((p, q) => q.level - p.level).slice(0, MAX_BEAMS);
    link.setOut(top(left), top(right), top(sky), s.serial);
  };

  if (isBank) {
    link = createEdgeLink(ctx.net, { pos, side: ctx.setup.side, now });
    link.onChange(() => updateExtra());
  }
  // Free play on a bank has no rounds: nothing to solve, and a new round would clear the pieces.
  if (isBank && !cfg.sandbox) {
    rounds = createRounds({
      net: ctx.net,
      now,
      side: ctx.setup.side,
      count,
      rampLength: ramp.length,
      start,
      pos,
      own: () => {
        const b = slots[0]!.bench;
        return { solved: b.solved, real: b.realSolved, idle: ctx.idle.idle };
      },
      onRound: (r) => bankLoad(r.serial, r.level),
      onCheer: () => {
        slots[0]!.cheer = now();
        // Build the next round's puzzles a little at a time while the bank celebrates.
        const r = rounds?.round;
        if (r) {
          const level = r.level + 1 >= ramp.length ? start : r.level + 1;
          warm = { serial: r.serial + 1, level, k: 0 };
        }
      },
    });
  }
  if (isBank) {
    bankLoad(0, start);
  } else {
    for (const s of slots) loadSolo(s);
  }

  // ---- Reset controls ------------------------------------------------------------------------

  let resetButtons: HTMLElement[] = [];
  const placeResets = () => {
    for (const b of resetButtons) b.remove();
    const u = frame.unit;
    resetButtons = slots.map((s) => {
      const r = s.layout.reset;
      return ctx.ui.button({
        icon: "reset",
        rect: { x: r.x * u, y: r.y * u, width: r.width * u, height: r.height * u },
        hold: RESET_HOLD_MS,
        look: "ghost",
        color: "#cfe0ff",
        onPress: () => {
          s.lastHuman = now();
          s.ghost = false;
          s.hand.release();
          s.bench.restart();
        },
      });
    });
  };
  placeResets();

  // ---- Input -----------------------------------------------------------------------------------

  const owner = new Map<number, Slot>();
  const slotAt = (x: number, y: number) =>
    slots.find((s) => {
      const b = s.layout.box;
      return x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height;
    }) ?? null;
  const hands = new Map<number, { x: number; y: number }>();

  const offInput = [
    ctx.input.on("down", (p) => {
      const x = p.x / frame.unit;
      const y = p.y / frame.unit;
      if (p.synthetic) hands.set(p.id, { x, y });
      const s = slotAt(x, y);
      if (!s) return;
      if (!p.synthetic) {
        s.lastHuman = now();
        if (s.ghost) {
          s.ghost = false;
          s.hand.release();
        }
        if (s.bot) s.hand.release();
      }
      if (now() - s.arrived < 300) return;
      if (s.bench.down(p.id, x, y, p.synthetic)) owner.set(p.id, s);
    }),
    ctx.input.on("move", (p) => {
      const x = p.x / frame.unit;
      const y = p.y / frame.unit;
      if (p.synthetic) hands.set(p.id, { x, y });
      owner.get(p.id)?.bench.move(p.id, x, y);
    }),
    ctx.input.on("up", (p) => {
      hands.delete(p.id);
      const s = owner.get(p.id);
      owner.delete(p.id);
      s?.bench.up(p.id, p.x / frame.unit, p.y / frame.unit);
    }),
    ctx.input.on("cancel", (p) => {
      hands.delete(p.id);
      const s = owner.get(p.id);
      owner.delete(p.id);
      s?.bench.cancel(p.id);
    }),
  ];

  // ---- Loop ------------------------------------------------------------------------------------

  const progressOf = (s: Slot): BenchLook["progress"] => {
    if (rounds) {
      const r = rounds;
      return {
        n: count,
        on: (i) => ((r.realMask >> i) & 1 ? 1 : (r.solvedMask >> i) & 1 ? 0.45 : 0),
        current: -1,
      };
    }
    if (cfg.sandbox) return { n: 0, on: () => 0, current: -1 };
    return { n: ramp.length, on: (i) => (i < s.level ? 1 : 0), current: s.level };
  };

  const looks = (): BenchLook[] =>
    slots.map((s) => ({
      bench: s.bench,
      arrived: s.arrived,
      cheer: s.cheer,
      progress: progressOf(s),
      guideAt: s.guideAt,
    }));

  let drawnAt = -Infinity;
  const CALM_MS = 50;
  const loop = ctx.loop({
    hz: 30,
    update(dt) {
      if (disposed) return;
      const t = now();
      if (link) {
        link.tick();
        updateExtra();
      }
      rounds?.tick();
      if (warm) {
        bankChain(
          {
            seed: ctx.seed,
            bench: slots[0]!.layout,
            serial: warm.serial,
            level: ramp[warm.level] ?? "m1",
            colour: cfg.colour,
            count,
          },
          warm.k,
        );
        warm.k++;
        if (warm.k > pos) warm = null;
      }
      for (const s of slots) {
        s.easing = s.bench.tick(dt);
        const solved = s.bench.solved;
        if (!rounds && solved && !s.wasSolved && s.bench.puzzle.crystals.length > 0) {
          s.cheer = t;
          if (!cfg.sandbox && !isBank) s.nextAt = t + CELEBRATE_MS;
        }
        s.wasSolved = solved;
        if (!rounds && !isBank && t >= s.nextAt) {
          s.serial++;
          s.level = s.level + 1 >= ramp.length ? start : s.level + 1;
          loadSolo(s);
        }
        const yielded = t - s.lastHuman < BOT_YIELD_MS;
        const busy = t - s.arrived < 1200 || Number.isFinite(s.nextAt) || t < s.cheer + 2500;
        s.hand.update(dt, (s.bot ? !yielded : s.ghost) && !busy);
      }
      updateOut();
    },
    render() {
      if (disposed) return;
      const t = now();
      // Full rate while anything moves; otherwise the slow shimmer and pulses need far less.
      const lively =
        hands.size > 0 ||
        slots.some(
          (s) => s.bench.grabs.size > 0 || s.easing || t - s.arrived < 1200 || t - s.cheer < 4000,
        );
      if (lively || t - drawnAt >= CALM_MS) {
        drawnAt = t;
        view.draw(t, looks(), [...hands.values()]);
      }
      publish(t);
    },
  });
  loop.start();

  // ---- State for tests and admin ---------------------------------------------------------------

  const benchState = (s: Slot) => {
    const b = s.bench;
    return {
      serial: s.serial,
      level: ramp[s.level] ?? "m1",
      index: s.level,
      lit: b.lit,
      crystals: b.puzzle.crystals.length,
      solved: b.solved,
      real: b.realSolved,
      placed: b.items.filter((it) => it.place.socket !== null).length,
      pieces: b.items.length,
      segs: b.result.segs.length,
      fallback: b.puzzle.fallback,
    };
  };

  let publishedAt = -Infinity;
  const publish = (t: number) => {
    if (t - publishedAt < 400) return;
    publishedAt = t;
    const n = link?.neighbours();
    const inc = link?.incoming();
    ctx.root.dataset.optics = JSON.stringify({
      benches: slots.map(benchState),
      bank: rounds
        ? {
            serial: rounds.round.serial,
            level: rounds.round.level,
            leading: rounds.leading,
            solvedMask: rounds.solvedMask,
            realMask: rounds.realMask,
            left: n?.left ?? null,
            right: n?.right ?? null,
            screen: n?.screen ?? null,
            inLeft: inc?.left.length ?? 0,
            inRight: inc?.right.length ?? 0,
            guides: slots[0]!.guideAt.length,
            exitsRight: slots[0]!.bench.result.exits.filter(
              (e) => e.edge === EDGE_RIGHT && !e.guide,
            ).length,
          }
        : null,
    });
  };

  const debugKey = "__optics";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        layout: () => layout,
        bench: (i = 0) => {
          const s = slots[i];
          if (!s) return null;
          const b = s.bench;
          return {
            sockets: s.layout.sockets,
            trays: s.layout.trays,
            sizes: s.layout.sizes,
            box: s.layout.box,
            items: b.items.map((it, k) => ({ ...it, at: b.where(k) })),
            solution: b.puzzle.solution,
            crystals: b.puzzle.crystals,
            glows: [...b.glows],
            segs: b.result.segs.length,
            entry: b.puzzle.entry,
            exits: b.result.exits,
          };
        },
        solve: (i = 0) => slots[i]?.bench.solve(),
        /** Load a bank round directly. */
        round: (serial: number, level: number) => (isBank ? bankLoad(serial, level) : undefined),
        puzzle: (i = 0) => slots[i]?.bench.puzzle,
      },
    });
  }

  // ---- Resize ----------------------------------------------------------------------------------

  const offResize = ctx.onResize((f) => {
    frame = f;
    view.resize(f);
    placeResets();
  });

  return {
    reset() {
      for (const s of slots) {
        s.hand.release();
        if (isBank) {
          s.bench.restart();
        } else {
          s.serial++;
          s.level = start;
          loadSolo(s);
        }
        s.cheer = -Infinity;
      }
    },
    attract() {
      for (const s of slots) {
        s.ghost = !s.bot;
        s.lastHuman = -Infinity;
      }
    },
    status() {
      const b = slots.map(benchState);
      const st: Record<string, OptionValue> = {
        puzzle: (b[0]?.serial ?? 0) + 1,
        level: b.map((x) => x.level).join(","),
        lit: b.reduce((n, x) => n + x.lit, 0),
        crystals: b.reduce((n, x) => n + x.crystals, 0),
        placed: b.reduce((n, x) => n + x.placed, 0),
        segments: b.reduce((n, x) => n + x.segs, 0),
      };
      if (rounds) st.leader = rounds.leading;
      return st;
    },
    command(name) {
      if (name === "next") {
        if (rounds) rounds.skip();
        else if (!isBank)
          for (const s of slots) {
            s.serial++;
            s.level = s.level + 1 >= ramp.length ? start : s.level + 1;
            loadSolo(s);
          }
      } else if (name === "solve") {
        for (const s of slots) s.bench.solve();
      }
    },
    homeSpot(size) {
      const last = layout.benches[layout.benches.length - 1];
      if (!last?.home) return null;
      const u = frame.unit;
      const h = last.home;
      return {
        x: Math.round((h.x + h.width / 2) * u - size / 2),
        y: Math.round((h.y + h.height / 2) * u - size / 2),
      };
    },
    dispose() {
      disposed = true;
      loop.stop();
      offResize();
      for (const off of offInput) off();
      for (const s of slots) {
        s.hand.dispose();
        s.bench.release();
      }
      link?.dispose();
      rounds?.dispose();
      for (const b of resetButtons) b.remove();
      resetButtons = [];
      view.dispose();
      backdrop.remove();
      owner.clear();
      hands.clear();
      delete ctx.root.dataset.optics;
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
