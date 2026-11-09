/**
 * What every scene gives the globe: its models (in design metres, in its own frame before it
 * turns), what the snow lands on, where its warm lights are, and how its moving parts move.
 */
import type { Group, Vector3 } from "three";
import type { Rng } from "../../core/types";
import type { Materials } from "./kit";
import type { SceneId } from "./show";
import type { Terrain } from "./terrain";

export interface BuiltScene {
  id: SceneId;
  group: Group;
  terrain: Terrain;
  /** Up to three warm lights: windows, lamps, a lighthouse's lamp. */
  lights: readonly Vector3[];
  /** Move the moving parts to time `t`, seconds. */
  update(t: number): void;
}

export type SceneMaker = (rng: Rng, materials: Materials) => BuiltScene;
