/**
 * Everything the shader needs that never changes: the spines and which of them can lie over
 * each part of the ball. Pure, so it can run in a worker or, failing that, on the page.
 */
import { createRng } from "../../core/rng";
import { makeSpines } from "./body";
import { buildLookup, packSpines } from "./lookup";
import { makeNoise } from "./noise";

/** The same echidna on every run and every frame. */
export const BODY_SEED = "echidna:body";

export interface Built {
  words: Uint32Array;
  width: number;
  height: number;
  spineData: Float32Array;
  spineWidth: number;
  spineHeight: number;
  /** Tiling 3D noise for fur, `NOISE_SIZE` a side. */
  noise: Uint8Array;
  spines: number;
  mean: number;
  max: number;
  dropped: number;
  ms: number;
}

export const buildBody = (seed = BODY_SEED): Built => {
  const t0 = performance.now();
  const spines = makeSpines(createRng(seed));
  const lookup = buildLookup(spines);
  const packed = packSpines(spines);
  const noise = makeNoise(createRng(`${seed}:noise`));
  return {
    noise,
    words: lookup.words,
    width: lookup.width,
    height: lookup.height,
    spineData: packed.data,
    spineWidth: packed.width,
    spineHeight: packed.height,
    spines: spines.length,
    mean: lookup.mean,
    max: lookup.max,
    dropped: lookup.dropped,
    ms: performance.now() - t0,
  };
};
