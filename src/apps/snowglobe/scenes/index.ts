import type { SceneMaker } from "../scene";
import type { SceneId } from "../show";
import { makeCabin } from "./cabin";
import { makeCarousel } from "./carousel";
import { makeHut } from "./hut";
import { makeLighthouse } from "./lighthouse";
import { makeSnowman } from "./snowman";
import { makeSquare } from "./square";

export const SCENE_MAKERS: Record<SceneId, SceneMaker> = {
  cabin: makeCabin,
  lighthouse: makeLighthouse,
  square: makeSquare,
  carousel: makeCarousel,
  snowman: makeSnowman,
  hut: makeHut,
};
