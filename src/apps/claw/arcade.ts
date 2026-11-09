/**
 * The whole arcade without any drawing: a machine and a bot player per cabinet, and the heap
 * their wins go to. It runs the same in tests and on the ball.
 */
import type { Rng, SphereInfo } from "../../core/types";
import { type Bot, createBot } from "./bot";
import { type DesignId, DESIGNS } from "./designs";
import { createHeap, type Door, type Heap, HEAP_MAX } from "./heap";
import { type ArcadeLayout, latAt, PART } from "./layout";
import { createMachine, type Machine, STEP } from "./machine";

/** Each cabinet's own mix of prizes. */
export const MIXES: readonly (readonly DesignId[])[] = [
  ["bear", "bunny", "frog", "star", "heart"],
  ["octopus", "whale", "star", "frog", "cactus"],
  ["dino", "cactus", "avocado", "heart", "bear"],
  ["bunny", "octopus", "dino", "whale", "cactus"],
];

/** Wins per round for each luck setting. */
export const RATES = { fair: 1 / 6, generous: 1 / 3 } as const;
export type Luck = keyof typeof RATES;

/** The prize door's middle, as a fraction of the cabinet's height. */
export const DOOR_ROW = 0.8;
/** Prizes on the heap when the show starts. */
const PREFILL = 20;
/** The heap's largest radius on the floor, metres; smaller balls scale it down. */
const HEAP_RADIUS = 0.8;

export interface Arcade {
  readonly layout: ArcadeLayout;
  readonly machines: readonly Machine[];
  readonly bots: readonly Bot[];
  readonly heap: Heap;
  /** Seconds since the arcade started. */
  readonly time: number;
  /** Total wins. */
  readonly wins: number;
  /** One fixed step of every machine, the bots and the heap. */
  step(): void;
  /** Where cabinet `i`'s prize door is on the ball. */
  door(i: number): Door;
  /** Drop a prize from cabinet `i`'s pile into its chute, for tests and e2e. */
  forceWin(i: number): boolean;
  dispose(): void;
}

export interface ArcadeOptions {
  layout: ArcadeLayout;
  sphere: SphereInfo;
  rng: Rng;
  luck: Luck;
  /** A heap and a clock to carry on with, when the cabinets are rebuilt for a different ball. */
  heap?: Heap;
  start?: number;
}

export const heapRadius = (s: SphereInfo): number => Math.min(HEAP_RADIUS, 0.32 * s.radius);

export const createArcade = (o: ArcadeOptions): Arcade => {
  const { layout, rng } = o;
  const rate = RATES[o.luck];
  // Rounds start a share of a typical round apart, so something is always happening round the ball.
  const cycle = 22;
  const machines = layout.cabinets.map((c, i) =>
    createMachine({
      spec: { ...layout.play, chute: c.chute },
      rng: rng.fork(`machine-${i}`),
      rate,
      mix: MIXES[i % MIXES.length]!,
      delay: 1 + (i * cycle) / layout.cabinets.length + rng.range(0, 2),
    }),
  );
  for (const m of machines) m.fill();
  const bots = machines.map((m, i) => createBot(m, rng.fork(`bot-${i}`)));
  const heap =
    o.heap ??
    createHeap({
      radius: o.sphere.radius,
      floor: layout.bottom,
      heap: heapRadius(o.sphere),
      rng: rng.fork("heap"),
    });
  if (!o.heap) {
    const heapRng = rng.fork("prefill");
    heap.prefill(
      Array.from({ length: Math.min(PREFILL, HEAP_MAX) }, (_, i) => {
        const mix = MIXES[i % MIXES.length]!;
        const design = heapRng.pick(mix);
        return { design, colour: heapRng.int(DESIGNS[design].colourways.length) };
      }),
      0,
    );
  }

  const doors = layout.cabinets.map((c, i): Door => {
    const m = machines[i]!;
    const cabTop = 1 - layout.cabinetH / layout.aspect;
    const lat = latAt(
      layout.top,
      layout.bottom,
      cabTop + DOOR_ROW * (layout.cabinetH / layout.aspect),
    );
    // Under the chute: its middle, from the body's middle.
    const pillar = PART.pillar * layout.cabinetH;
    const fromMid = pillar + m.world.hole.centre * layout.perU - layout.bodyW / 2;
    return { lat, lon: c.lon + fromMid * 2 * Math.PI };
  });

  let t = o.start ?? 0;
  let wins = 0;

  return {
    layout,
    machines,
    bots,
    heap,
    get time() {
      return t;
    },
    get wins() {
      return wins;
    },
    step() {
      t += STEP;
      for (let i = 0; i < machines.length; i++) {
        bots[i]!.update(STEP);
        for (const w of machines[i]!.step(STEP)) {
          wins++;
          heap.launch(
            { design: w.prize.design, colour: w.prize.colour, cabinet: i, door: doors[i]! },
            t,
          );
        }
      }
      heap.step(t);
    },
    door: (i) => doors[i]!,
    forceWin(i) {
      const m = machines[i];
      if (!m) return false;
      const w = m.world;
      const p = w.prizes.find((q) => q.body.getPosition().y < w.spec.height);
      if (!p) return false;
      p.body.setTransform({ x: w.hole.centre, y: 1.05 }, 0);
      p.body.setLinearVelocity({ x: 0, y: 0 });
      p.body.setAngularVelocity(0);
      p.body.setAwake(true);
      return true;
    },
    dispose() {
      for (const m of machines) m.dispose();
    },
  };
};
