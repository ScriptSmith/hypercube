/**
 * The eye's look, the same on the sphere and the wall: the iris, vessel, back and mottle textures,
 * the iris colours, and the uniforms the surface shader reads, with how to set them each frame
 * from the motion model.
 */
import {
  CanvasTexture,
  Color,
  DataTexture,
  type IUniform,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix3,
  RepeatWrapping,
  RGBAFormat,
} from "three";
import type { Renderer3D } from "../../core/renderer3d";
import type { Vec3 } from "../../core/sphere";
import { toMatrix3 } from "../../core/sphere3d";
import type { AppContext, Rng } from "../../core/types";
import { BACK, growBack, paintBack } from "./back";
import {
  type ColourSchedule,
  createColourSchedule,
  IRIS_OPTIONS,
  type IrisColour,
  type IrisOption,
  LOOKS,
} from "./colours";
import { eyeFrame, type Primary } from "./geom";
import { createIrisTextures, type IrisTextures, REST_PUPIL } from "./irisgen";
import type { Pace } from "./motion";
import { MOTTLE, makeMottle } from "./mottle";
import { CORNEA_CENTRE, EYE_MM, IRIS_ANGLE, LIMBUS_BAND, pupilOffset } from "./physiology";
import { growVessels, paintVessels } from "./vessels";

const VEINS = { width: 4096, height: 1536 };
/** How much darker the whole eye looks with the lamps off. */
const DIMMED = 0.14;

export const irisOption = (v: unknown): IrisOption =>
  IRIS_OPTIONS.includes(v as IrisOption) ? (v as IrisOption) : "changes";
export const paceOption = (v: unknown): Pace => (v === "calm" ? "calm" : "furtive");

/** Each preset's colours, linear. */
const linearLooks = () => {
  const out = {} as Record<IrisColour, { colours: Color[]; look: number[] }>;
  for (const [name, l] of Object.entries(LOOKS) as [IrisColour, (typeof LOOKS)[IrisColour]][]) {
    out[name] = {
      colours: [l.base, l.fibre, l.centre, l.deep, l.ring].map((c) => new Color(c)),
      look: [l.contrast, l.crypts, l.freckles, 0],
    };
  }
  return out;
};

export interface EyePose {
  gaze: Vec3;
  twist: number;
  /** Pupil diameter, mm. */
  pupil: number;
  /** The room's lamps and daylight, shares of full. */
  lamps: number;
  day: number;
}

export interface EyeLook {
  /** For the surface shader. */
  readonly uniforms: Record<string, IUniform>;
  readonly iris: IrisTextures;
  readonly colours: ColourSchedule;
  /** Whether the reflections and the iris's depth are on. */
  readonly shine: boolean;
  readonly depth: boolean;
  /** Follow the options (reflections, depth). */
  setSurface(): void;
  /** Set the uniforms for one frame. */
  pose(p: EyePose, primary?: Primary): void;
  dispose(): void;
}

export const createEyeLook = (
  ctx: AppContext,
  r3d: Renderer3D,
  rng: Rng,
  irisSize: { width: number; height: number },
  extra: Record<string, IUniform> = {},
): EyeLook => {
  const seed = Math.floor(rng.next() * 2 ** 31);
  const iris = r3d.keep(createIrisTextures(r3d, seed, irisSize));

  const veinCanvas = document.createElement("canvas");
  veinCanvas.width = VEINS.width;
  veinCanvas.height = VEINS.height;
  // Scratch layers for painting, released once the vessels are in the texture's canvas.
  const sharpCanvas = document.createElement("canvas");
  sharpCanvas.width = VEINS.width;
  sharpCanvas.height = VEINS.height;
  const softCanvas = document.createElement("canvas");
  softCanvas.width = VEINS.width / 4;
  softCanvas.height = VEINS.height / 4;
  const g = veinCanvas.getContext("2d");
  const gSharp = sharpCanvas.getContext("2d");
  const gSoft = softCanvas.getContext("2d");
  if (g && gSharp && gSoft) {
    const segments = growVessels(rng.fork("vessels"), { iris: IRIS_ANGLE });
    paintVessels(g, gSharp, gSoft, VEINS, segments, IRIS_ANGLE);
  }
  sharpCanvas.width = 0;
  softCanvas.width = 0;
  const veins = r3d.keep(new CanvasTexture(veinCanvas));
  veins.flipY = false;
  veins.wrapS = RepeatWrapping;
  veins.minFilter = LinearMipmapLinearFilter;
  veins.magFilter = LinearFilter;
  veins.anisotropy = 4;

  const backCanvas = document.createElement("canvas");
  backCanvas.width = BACK.width;
  backCanvas.height = BACK.height;
  const backScratch = document.createElement("canvas");
  backScratch.width = BACK.width;
  backScratch.height = BACK.height;
  const gBack = backCanvas.getContext("2d");
  const gBackScratch = backScratch.getContext("2d");
  if (gBack && gBackScratch) {
    paintBack(gBack, gBackScratch, BACK, growBack(rng.fork("back")), IRIS_ANGLE);
  }
  backScratch.width = 0;
  const back = r3d.keep(new CanvasTexture(backCanvas));
  back.flipY = false;
  back.wrapS = RepeatWrapping;
  back.minFilter = LinearMipmapLinearFilter;
  back.magFilter = LinearFilter;

  const mottle = r3d.keep(
    new DataTexture(makeMottle(rng.fork("mottle")), MOTTLE.width, MOTTLE.height, RGBAFormat),
  );
  mottle.wrapS = RepeatWrapping;
  mottle.magFilter = LinearFilter;
  mottle.minFilter = LinearFilter;
  mottle.needsUpdate = true;

  const looks = linearLooks();
  const colourUniforms = [0, 1, 2, 3, 4].map(() => ({ value: new Color() }));
  const look = { value: [0, 0, 0, 0] };
  const toEye = { value: new Matrix3() };
  const bright = { value: 1 };
  const pupil = { value: 0.35 };
  const pupilAt = { value: [0, 0] };
  const shine = { value: 1 };
  const lamps = { value: 1 };
  const day = { value: 1 };
  const depth = { value: 1 };
  const setSurface = () => {
    shine.value = ctx.options.reflections === false ? 0 : 1;
    depth.value = ctx.options.depth === false ? 0 : 1;
  };
  setSurface();
  const colours = createColourSchedule(rng.fork("colour"), irisOption(ctx.options.iris));

  const uniforms: Record<string, IUniform> = {
    uToEye: toEye,
    uIrisA: { value: iris.a.texture },
    uIrisB: { value: iris.b.texture },
    uVeins: { value: veins },
    uMottle: { value: mottle },
    uHeight: { value: iris.height.texture },
    uDepth: depth,
    uPupil: pupil,
    uPupilAt: pupilAt,
    uRest: { value: REST_PUPIL },
    uSinIris: { value: Math.sin(IRIS_ANGLE) },
    uLimbusBand: { value: LIMBUS_BAND },
    uIrisAngle: { value: IRIS_ANGLE },
    uBase: colourUniforms[0]!,
    uFibre: colourUniforms[1]!,
    uCentre: colourUniforms[2]!,
    uDeep: colourUniforms[3]!,
    uRing: colourUniforms[4]!,
    uLook: look,
    uCornea: { value: [CORNEA_CENTRE / EYE_MM.radius, EYE_MM.corneaRadius / EYE_MM.radius] },
    uBright: bright,
    uRelief: { value: 3 },
    uShine: shine,
    uLamps: lamps,
    uDay: day,
    uBack: { value: back },
    ...extra,
  };

  const setColours = () => {
    const a = looks[colours.from];
    const b = looks[colours.to];
    const m = colours.mix;
    colourUniforms.forEach((u, i) => u.value.copy(a.colours[i]!).lerp(b.colours[i]!, m));
    for (let i = 0; i < 4; i++) look.value[i] = a.look[i]! + (b.look[i]! - a.look[i]!) * m;
  };

  return {
    uniforms,
    iris,
    colours,
    get shine() {
      return shine.value > 0;
    },
    get depth() {
      return depth.value > 0;
    },
    setSurface,
    pose(p, primary) {
      toMatrix3(eyeFrame(p.gaze, p.twist, primary), toEye.value);
      pupil.value = p.pupil / 2 / EYE_MM.limbus;
      const at = pupilOffset(p.pupil);
      pupilAt.value[0] = at[0] / EYE_MM.limbus;
      pupilAt.value[1] = at[1] / EYE_MM.limbus;
      lamps.value = p.lamps;
      day.value = p.day;
      // A real eye is a little darker in a dimmed room; the white stays bright enough to read.
      bright.value = 1 - DIMMED * (1 - p.lamps);
      setColours();
    },
    dispose() {
      veinCanvas.width = 0;
    },
  };
};
