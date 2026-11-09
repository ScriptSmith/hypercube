import type { Herons, Mutation } from "../../../src/apps/evolution/config";
import type { FloorId } from "../../../src/apps/evolution/genes";
import { createPond, type Pond, type PondDeps, stepPond } from "../../../src/apps/evolution/pond";
import { createRng } from "../../../src/core/rng";

export interface TestPond {
  pond: Pond;
  deps: PondDeps;
  /** Seconds simulated. */
  readonly t: number;
  /** Run `seconds` with steps of `dt`; `present` keeps the attract floor changes away. */
  run(
    seconds: number,
    opts?: { dt?: number; present?: boolean; swim?: boolean; each?(): void },
  ): void;
}

export const testPond = (opts: {
  seed: string;
  floor?: FloorId;
  herons?: Herons;
  mutation?: Mutation;
  target?: number;
}): TestPond => {
  let t = 0;
  let id = 1;
  const deps: PondDeps = {
    rng: createRng(opts.seed),
    stamp: () => 1_000_000 + t * 1000,
    nextId: () => id++,
  };
  const pond = createPond(
    {
      island: 0,
      box: { x: 0, y: 0, w: 1000, h: 760 },
      target: opts.target ?? 22,
      fish: 84,
      floor: opts.floor ?? "sand",
    },
    { mutation: opts.mutation ?? "small", herons: opts.herons ?? "few" },
    deps,
  );
  return {
    pond,
    deps,
    get t() {
      return t;
    },
    run(seconds, o = {}) {
      const dt = o.dt ?? 0.1;
      const steps = Math.round(seconds / dt);
      for (let i = 0; i < steps; i++) {
        t += dt;
        if (o.present !== false) pond.touchT = 0;
        stepPond(pond, dt, deps, { swim: o.swim ?? false });
        pond.events.length = 0;
        o.each?.();
      }
    },
  };
};

export const sdOf = (xs: readonly number[]): number => {
  const m = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length));
};
