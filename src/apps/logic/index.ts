/**
 * Logic Lab. Workbenches of chunky switches, lamps and logic gates whose output posts run a
 * machine on the upper wall. Standalone on every frame.
 *
 * - circuit.ts   the circuit as plain data: pieces, sockets, wires, limits and the tick
 * - goals.ts     goal cards, the row checker and a planner towards known solutions
 * - layout.ts    where sockets, trays, posts, machines and cards go on each kind of frame
 * - geometry.ts  ports and wire routes; bench.ts one bench's touches, time and card
 * - machines.ts  the machines; art.ts and render.ts the drawing; bots.ts bots and attract
 */
import type { AppContext, AppInstance, FrameInfo, Pointer } from "../../core/types";
import { createBench, type Bench } from "./bench";
import { type BenchBot, createBenchBot } from "./bots";
import { KINDS, pieceCount, powered } from "./circuit";
import {
  BENCH_IDLE_MS,
  BOT_YIELD_MS,
  gateKinds,
  ATTRACT_REFRESH_MS,
  GHOST_RETURN_MS,
  type MachineKind,
  MACHINES,
  readConfig,
  RESET_HOLD_MS,
} from "./config";
import { portsOf } from "./geometry";
import { CARDS } from "./goals";
import { benchAt, type Layout, layoutFor, type LayoutInput, type Point } from "./layout";
import { createMachine, MACHINE_INPUTS, type Machine } from "./machines";
import { createRenderer } from "./render";

export const mount = (ctx: AppContext): AppInstance => {
  const cfg = readConfig(ctx.variant, ctx.options);
  const gates = gateKinds(cfg);
  let frame: FrameInfo = ctx.frame;
  const count = frame.kind === "wall" ? cfg.benches : 1;
  const now = () => performance.now();

  let rotation = ctx.rng("logic:machines").int(MACHINES.length);
  const pickMachines = (): MachineKind[] =>
    Array.from({ length: count }, (_, i) =>
      cfg.machine === "rotate" ? MACHINES[(rotation + i) % MACHINES.length]! : cfg.machine,
    ) as MachineKind[];
  let machines: Machine[] = pickMachines().map(createMachine);

  const inputOf = (f: FrameInfo): LayoutInput => {
    const u = f.unit;
    return {
      kind: f.kind,
      width: f.width / u,
      height: f.height / u,
      reachTop: { adult: f.reachTop.adult / u, child: f.reachTop.child / u },
      seams: f.seams.map((s) => s / u),
      benches: count,
      posts: machines.map((m) => MACHINE_INPUTS[m.kind]),
      goals: cfg.variant === "goals",
      gates,
    };
  };
  let layout: Layout = layoutFor(inputOf(frame));
  const benches: Bench[] = layout.benches.map((bl) =>
    createBench({ layout: bl, variant: cfg.variant, gates, now }),
  );
  const renderer = createRenderer(ctx.root);
  renderer.setup(frame, layout);

  // ---- Bots and the attract ghost ------------------------------------------------------------

  const ghostOn = benches.map(() => true);
  const touchedSinceReset = benches.map(() => false);
  const refreshAt: (number | undefined)[] = benches.map(() => undefined);
  const botsFor = Math.max(0, Math.min(count, ctx.bots));
  const bots: BenchBot[] = benches.map((_, i) =>
    createBenchBot({
      input: ctx.input,
      rng: ctx.rng(`logic:bot:${i}`),
      mode: i < botsFor ? "bot" : "attract",
      bench: () => benches[i]!,
      unit: () => frame.unit,
      gates,
      recipe: () => {
        const card = benches[i]!.card;
        return card ? card.solutions[cfg.gates] : null;
      },
    }),
  );

  // ---- Reset controls ------------------------------------------------------------------------

  let resetButtons: HTMLElement[] = [];
  const placeButtons = () => {
    for (const b of resetButtons) b.remove();
    const u = frame.unit;
    resetButtons = layout.benches.map((bl, i) =>
      ctx.ui.button({
        icon: "reset",
        rect: {
          x: bl.reset.x * u,
          y: bl.reset.y * u,
          width: bl.reset.width * u,
          height: bl.reset.height * u,
        },
        hold: RESET_HOLD_MS,
        look: "ghost",
        color: "#c9d3ea",
        onPress: () => {
          bots[i]?.release();
          benches[i]?.starter();
        },
      }),
    );
  };
  placeButtons();

  // ---- Input ---------------------------------------------------------------------------------

  /** Which bench each finger started on; it stays with that bench until it lifts. */
  const owner = new Map<number, number>();
  const venueOf = (p: Pointer) => ({ x: p.x / frame.unit, y: p.y / frame.unit });
  const offInput = [
    ctx.input.on("down", (p) => {
      const v = venueOf(p);
      const i = benchAt(layout, v.x);
      const bench = benches[i];
      if (!bench) return;
      if (owner.size > 64) owner.clear();
      owner.set(p.id, i);
      if (!p.synthetic) {
        ghostOn[i] = false;
        touchedSinceReset[i] = true;
        bots[i]?.release();
      }
      bench.down(p.id, v.x, v.y, !p.synthetic);
    }),
    ctx.input.on("move", (p) => {
      const i = owner.get(p.id);
      if (i === undefined) return;
      const v = venueOf(p);
      benches[i]?.move(p.id, v.x, v.y);
    }),
    ctx.input.on("up", (p) => {
      const i = owner.get(p.id);
      owner.delete(p.id);
      if (i === undefined) return;
      const v = venueOf(p);
      benches[i]?.up(p.id, v.x, v.y);
    }),
    ctx.input.on("cancel", (p) => {
      const i = owner.get(p.id);
      owner.delete(p.id);
      if (i !== undefined) benches[i]?.cancel(p.id);
    }),
  ];

  // ---- Machines and resets -------------------------------------------------------------------

  const relayout = () => {
    layout = layoutFor(inputOf(frame));
    layout.benches.forEach((bl, i) => benches[i]?.setLayout(bl));
    renderer.setup(frame, layout);
  };

  const resetBench = (i: number) => {
    bots[i]?.release();
    benches[i]?.reset();
    touchedSinceReset[i] = false;
    ghostOn[i] = true;
  };

  const resetAll = () => {
    owner.clear();
    if (cfg.machine === "rotate") {
      rotation = (rotation + count) % MACHINES.length;
      const before = machines.map((m) => MACHINE_INPUTS[m.kind]).join();
      machines = pickMachines().map(createMachine);
      if (machines.map((m) => MACHINE_INPUTS[m.kind]).join() !== before) {
        relayout();
        placeButtons();
      }
    }
    benches.forEach((_, i) => resetBench(i));
  };

  // ---- Loop ----------------------------------------------------------------------------------

  const hands: Point[] = [];
  let lastRender = now();
  let disposed = false;
  const loop = ctx.loop({
    hz: 60,
    update(dt) {
      if (disposed) return;
      const t = now();
      benches.forEach((b, i) => {
        b.update(dt * 1000);
        const trick = b.doneAt > Number.NEGATIVE_INFINITY;
        machines[i]?.update(dt, b.posts(), trick);
        const quiet = t - b.lastHuman;
        if (!ghostOn[i] && quiet > GHOST_RETURN_MS) ghostOn[i] = true;
        if (touchedSinceReset[i] && quiet > BENCH_IDLE_MS && !ctx.idle.idle) resetBench(i);
        const bot = bots[i];
        if (!bot) return;
        // The ghost's rewiring drifts; an untouched bench gets its starting circuit back now and then.
        if (bot.mode === "attract" && ghostOn[i] && cfg.variant === "bench") {
          if (t >= (refreshAt[i] ?? 0)) {
            if (refreshAt[i] !== undefined) {
              bot.release();
              b.starter();
            }
            refreshAt[i] = t + ATTRACT_REFRESH_MS;
          }
        } else refreshAt[i] = t + ATTRACT_REFRESH_MS;
        bot.update(dt, bot.mode === "bot" ? quiet > BOT_YIELD_MS : ghostOn[i]!);
      });
    },
    render() {
      if (disposed) return;
      const t = now();
      const dt = Math.min(0.1, (t - lastRender) / 1000);
      lastRender = t;
      hands.length = 0;
      for (const p of ctx.input.pointers.values()) {
        if (p.synthetic && hands.length < 16) hands.push(venueOf(p));
      }
      renderer.draw(
        benches.map((bench, i) => ({ bench, machine: machines[i]! })),
        t,
        dt,
        hands,
      );
    },
  });
  loop.start();

  // ---- Resize --------------------------------------------------------------------------------

  let resizeTimer = 0;
  const offResize = ctx.onResize((f) => {
    frame = f;
    relayout();
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (!disposed) placeButtons();
    }, 150);
  });

  // ---- Admin, status and tests ---------------------------------------------------------------

  const command = (name: string) => {
    if (name === "clear") {
      for (const b of bots) b.release();
      for (const b of benches) b.clear();
    } else if (name === "starter") {
      for (const b of bots) b.release();
      for (const b of benches) b.starter();
    }
  };

  const debugKey = "__logic";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => ({
          unit: frame.unit,
          kind: layout.kind,
          home: layout.home,
          benches: benches.map((b, i) => ({
            slot: b.layout.slot,
            reset: b.layout.reset,
            snap: b.layout.snap,
            hit: b.layout.hit,
            machine: machines[i]?.kind ?? null,
            levels: [...(machines[i]?.levels ?? [])],
            posts: b.posts(),
            sockets: b.layout.sockets.map((s, k) => ({
              ...s,
              piece: b.circuit.pieces.find((p) => p.socket === k)?.id ?? null,
            })),
            trays: b.layout.trays.map((t) => ({ band: t.band, box: t.box, items: t.items })),
            pieces: b.circuit.pieces.map((p) => ({
              id: p.id,
              kind: p.kind,
              socket: p.socket,
              on: p.on,
              out: p.out,
              pinned: p.pinned,
              live: KINDS[p.kind].inputs > 0 && powered(b.circuit, p),
              ports: portsOf(b.layout, p).map((q) => ({ pin: q.pin, x: q.x, y: q.y })),
            })),
            wires: b.circuit.wires.map((w) => ({ ...w })),
            card: b.card?.id ?? null,
            cardIndex: b.cardIndex,
            rows: [...b.rows],
            done: b.doneAt > Number.NEGATIVE_INFINITY,
            completed: b.completed,
            solved: b.solved,
            gestures: b.gestures.size,
            ghost: ghostOn[i] ?? false,
          })),
        }),
        command,
        setCard: (bench: number, card: number) => benches[bench]?.setCard(card),
        cards: CARDS.map((c) => c.id),
      },
    });
  }

  return {
    reset() {
      resetAll();
    },
    attract() {
      ghostOn.fill(true);
    },
    status() {
      const pieces = benches.reduce((n, b) => n + pieceCount(b.circuit), 0);
      const wires = benches.reduce((n, b) => n + b.circuit.wires.length, 0);
      return {
        benches: benches.length,
        pieces,
        wires,
        machine: machines.map((m) => m.kind).join(","),
        goals: benches.reduce((n, b) => n + b.completed, 0),
        solved: benches.reduce((n, b) => n + b.solved, 0),
      };
    },
    command(name) {
      command(name);
    },
    homeSpot() {
      const h = layout.home;
      return { x: h.x * frame.unit, y: h.y * frame.unit };
    },
    dispose() {
      disposed = true;
      loop.stop();
      clearTimeout(resizeTimer);
      offResize();
      for (const off of offInput) off();
      for (const b of bots) b.dispose();
      for (const b of resetButtons) b.remove();
      renderer.dispose();
      owner.clear();
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
