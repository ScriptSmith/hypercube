/**
 * The three.js side: the textures an egg needs (its shell's colour, baked on the GPU a strip at
 * a time; its cracks, veins and pieces from `raster.ts`), the chick's down, the captions, and
 * the surface pass whose uniforms `draw` fills from the moment's state.
 */
import {
  Color,
  DataTexture,
  LinearFilter,
  Matrix3,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  RedFormat,
  RepeatWrapping,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
  WebGLRenderTarget,
} from "three";
import type { Renderer3D } from "../../core/renderer3d";
import { DEG, direction, type Mat3, type Vec3, WHOLE_SPHERE } from "../../core/sphere";
import { createSurfacePass, toMatrix3 } from "../../core/sphere3d";
import type { FrameInfo } from "../../core/types";
import { DOWN_BAKE, SHELL_BAKE } from "./bakes";
import { BAKE_VERTEX } from "./glsl";
import type { CandleState } from "./candling";
import type { HatchState } from "./motion";
import { FACE_LAT } from "./motion";
import type { EggData } from "./raster";
import { DOWNS, GLOW, GLOW_AIR, type ShellLook } from "./looks";
import { MAX_PIECES, SURFACE } from "./surface";
import { BAND, createCaptions } from "./text";
import { tangents } from "./veins";

export const DATA_W = 2048;
export const DATA_H = 1024;
const SHELL_W = 2048;
const SHELL_H = 1024;
const DOWN_W = 2048;
const DOWN_H = 1024;
/** Rows of a bake drawn per frame, so a slow GPU never stalls the page for long. */
const BAKE_ROWS = 64;

/** Where the chick's face parts sit, in its own frame (face towards +z). */
const EYE_LAT = FACE_LAT + 8 * DEG;
const EYE_LON = 28 * DEG;
const EYE_R = 0.14;
const BEAK_LAT = FACE_LAT - 5 * DEG;
const BEAK_SIZE: [number, number] = [0.1, 0.13];
const WING_LAT = -8 * DEG;
const WING_LON = 90 * DEG;
const CROWN: Vec3 = direction(72 * DEG, 0);
export const PIP_HOLE = 0.095;

export interface DrawState {
  /** Room to egg frame. */
  egg: Mat3;
  /** Room to chick frame. */
  chick: Mat3;
  bright: number;
  crack: number;
  /** 0 whole shell, 1 pieces coming away, 2 the chick alone. */
  mode: 0 | 1 | 2;
  pip: { dir: Vec3; e: Vec3; n: Vec3 };
  hole: number;
  beakOff: [number, number];
  hatch: HatchState | null;
  dry: number;
  lids: number;
  beak: number;
  wings: number;
  down: number;
  candle: number;
  day: number;
  cs: CandleState | null;
  /** Embryo frame in the egg, for the candling shadows. */
  embryo: { dir: Vec3; e: Vec3; n: Vec3 };
  yolk: Vec3;
  airN: Vec3;
  pipInC: Vec3;
  caption: { day: string; line: string; on: number };
}

interface Bake {
  target: WebGLRenderTarget;
  scene: Scene;
  camera: OrthographicCamera;
  row: number;
}

const linear = (hex: string) => new Color(hex);
const lum = (c: Color) => 0.3 * c.r + 0.55 * c.g + 0.15 * c.b;

export interface Painter {
  /** Compiled, and the chick's down is baked. */
  readonly ready: boolean;
  /** The shell of the egg the textures hold is baked too. */
  readonly shellReady: boolean;
  /** The egg whose data and shell the textures hold, or -1. */
  readonly holds: number;
  /** Load an egg's data and start baking its shell. */
  loadEgg(index: number, data: EggData, look: ShellLook, seed: number): void;
  /** Bake a little more of anything pending; `all` finishes it now. */
  bake(all?: boolean): void;
  draw(s: DrawState): void;
  resize(frame: FrameInfo): void;
  dispose(): void;
}

export const createPainter = (r3d: Renderer3D, frame: FrameInfo): Painter => {
  const quad = new PlaneGeometry(2, 2);
  const makeBake = (
    fragment: string,
    w: number,
    h: number,
    uniforms: Record<string, { value: unknown }>,
  ): Bake & { material: ShaderMaterial } => {
    const target = new WebGLRenderTarget(w, h, {
      depthBuffer: false,
      wrapS: RepeatWrapping,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      generateMipmaps: false,
    });
    const material = new ShaderMaterial({
      vertexShader: BAKE_VERTEX,
      fragmentShader: fragment,
      uniforms,
      depthTest: false,
      depthWrite: false,
    });
    const scene = new Scene();
    const mesh = new Mesh(quad, material);
    mesh.frustumCulled = false;
    scene.add(mesh);
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    r3d.prepare(scene, camera);
    return { target, scene, camera, row: h, material };
  };

  const shellU = {
    uBase: { value: new Color() },
    uMottle: { value: new Color() },
    uSpeck: { value: new Color() },
    uFleck: { value: new Color() },
    uMottleAmt: { value: 0 },
    uSpeckAmt: { value: 0 },
    uSpeckScale: { value: 20 },
    uSpeckSize: { value: 0.2 },
    uFleckAmt: { value: 0 },
    uCapBias: { value: 0 },
    uGrain: { value: 0 },
    uSeed: { value: new Vector3() },
  };
  const shellBake = makeBake(SHELL_BAKE, SHELL_W, SHELL_H, shellU);
  const downBake = makeBake(DOWN_BAKE, DOWN_W, DOWN_H, {
    uCrown: { value: new Vector3(...CROWN) },
  });
  downBake.row = 0;

  const data = new DataTexture(null, DATA_W, DATA_H, RGBAFormat, UnsignedByteType);
  const pieces = new DataTexture(null, DATA_W, DATA_H, RedFormat, UnsignedByteType);
  data.wrapS = RepeatWrapping;
  data.minFilter = LinearFilter;
  data.magFilter = LinearFilter;
  pieces.wrapS = RepeatWrapping;
  pieces.minFilter = NearestFilter;
  pieces.magFilter = NearestFilter;
  for (const t of [data, pieces]) t.generateMipmaps = false;
  const captions = createCaptions(frame.width * frame.pixelRatio);

  const m3 = () => ({ value: new Matrix3() });
  const v3 = () => ({ value: new Vector3() });
  const f = (v = 0) => ({ value: v });
  const eye = (side: number) => {
    const c = direction(EYE_LAT, side * EYE_LON);
    return { c, ...tangents(c) };
  };
  const wing = (side: number) => {
    const c = direction(WING_LAT, side * WING_LON);
    return { c, ...tangents(c) };
  };
  const eyes = [eye(-1), eye(1)];
  const wings = [wing(-1), wing(1)];
  const beakC = direction(BEAK_LAT, 0);
  const beakT = tangents(beakC);
  const vec = (v: Vec3) => new Vector3(v[0], v[1], v[2]);

  const u = {
    uEgg: m3(),
    uChick: m3(),
    uShell: { value: shellBake.target.texture },
    uData: { value: data },
    uPieces: { value: pieces },
    uDown: { value: downBake.target.texture },
    uText: { value: captions.texture },
    uPx: f(Math.PI / 2048),
    uBright: f(1),
    uCrack: f(0),
    uMode: { value: 0 },
    uPip: v3(),
    uPipE: v3(),
    uPipN: v3(),
    uHole: f(0),
    uHoleR: f(PIP_HOLE),
    uBeakOff: { value: new Vector2() },
    uCapInv: m3(),
    uCapScale: f(1),
    uCapAlpha: f(1),
    uCapLoose: f(0),
    uPieceInv: { value: Array.from({ length: MAX_PIECES }, () => new Matrix3()) },
    uPieceC: { value: Array.from({ length: MAX_PIECES }, () => new Vector3()) },
    uPieceScale: { value: Array.from({ length: MAX_PIECES }, () => 1) },
    uPieceAlpha: { value: Array.from({ length: MAX_PIECES }, () => 1) },
    uPieceLoose: { value: Array.from({ length: MAX_PIECES }, () => 0) },
    uPieceN: { value: 0 },
    uTear: f(0),
    uDry: f(1),
    uLids: f(0),
    uBeak: f(0),
    uWings: f(0),
    uDownDry: { value: new Color() },
    uDownWet: { value: new Color() },
    uUpChick: v3(),
    uEyeC: { value: eyes.map((e) => vec(e.c)) },
    uEyeE: { value: eyes.map((e) => vec(e.e)) },
    uEyeN: { value: eyes.map((e) => vec(e.n)) },
    uEyeR: f(EYE_R),
    uBeakC: { value: vec(beakC) },
    uBeakE: { value: vec(beakT.e) },
    uBeakN: { value: vec(beakT.n) },
    uBeakSize: { value: new Vector2(...BEAK_SIZE) },
    uWingC: { value: wings.map((e) => vec(e.c)) },
    uWingE: { value: wings.map((e) => vec(e.e)) },
    uWingN: { value: wings.map((e) => vec(e.n)) },
    uCandle: f(0),
    uDay: f(1),
    uGlow: { value: new Color() },
    uGlowAir: { value: new Color() },
    uShellLum: f(0.5),
    uAirN: v3(),
    uAirH: f(1),
    uYolk: { value: [0, 0, 1, 0.5] as number[] },
    uYolkK: f(0),
    uEmb: v3(),
    uEmbE: v3(),
    uEmbN: v3(),
    uEmbSize: f(0.1),
    uEmbK: f(0),
    uEmbAng: f(0),
    uEmbEye: f(0),
    uHeart: f(0),
    uDark: f(0),
    uDarkR: f(0),
    uSmallEnd: f(0),
    uDetail: f(1),
    uLip: { value: new Color() },
    uVein: f(0),
    uPipIn: f(0),
    uPipInC: v3(),
    uTextBand: { value: new Vector2(BAND.top, BAND.bottom) },
    uTextOn: f(0),
  };
  const pass = createSurfacePass(r3d, frame, { fragment: SURFACE, uniforms: u });

  let holds = -1;

  const bakeStep = (b: Bake, rows: number) => {
    const h = b.target.height;
    if (b.row >= h) return;
    const r = r3d.renderer;
    const n = Math.min(rows, h - b.row);
    b.target.scissor.set(0, b.row, b.target.width, n);
    b.target.scissorTest = true;
    r.setRenderTarget(b.target);
    r.render(b.scene, b.camera);
    r.setRenderTarget(null);
    b.target.scissorTest = false;
    b.row += n;
  };

  const restore = () => {
    downBake.row = 0;
    if (holds >= 0) shellBake.row = 0;
  };
  const offRestore = r3d.onRestore(restore);

  const set = (name: keyof typeof u, value: number) => {
    (u[name] as { value: number }).value = value;
  };
  const setV = (name: keyof typeof u, v: Vec3) => {
    (u[name] as { value: Vector3 }).value.set(v[0], v[1], v[2]);
  };

  return {
    get ready() {
      return r3d.ready && downBake.row >= DOWN_H;
    },
    get shellReady() {
      return holds >= 0 && shellBake.row >= SHELL_H;
    },
    get holds() {
      return holds;
    },
    loadEgg(index, eggData, shellLook, seed) {
      data.image = { data: eggData.data, width: eggData.w, height: eggData.h } as never;
      pieces.image = { data: eggData.pieces, width: eggData.w, height: eggData.h } as never;
      data.needsUpdate = true;
      pieces.needsUpdate = true;
      shellU.uBase.value.set(shellLook.base);
      shellU.uMottle.value.set(shellLook.mottle);
      shellU.uSpeck.value.set(shellLook.speck);
      shellU.uFleck.value.set(shellLook.fleck);
      shellU.uMottleAmt.value = shellLook.mottleAmt;
      shellU.uSpeckAmt.value = shellLook.speckAmt;
      shellU.uSpeckScale.value = shellLook.speckScale;
      shellU.uSpeckSize.value = shellLook.speckSize;
      shellU.uFleckAmt.value = shellLook.fleckAmt;
      shellU.uCapBias.value = shellLook.capBias;
      shellU.uGrain.value = shellLook.grain;
      shellU.uSeed.value.set(seed * 1.37, seed * 0.71, seed * 2.13);
      const base = linear(shellLook.base);
      set("uShellLum", lum(base));
      (u.uGlow.value as Color).set(GLOW).multiplyScalar(0.55 + 0.4 * shellLook.glow);
      (u.uGlowAir.value as Color).set(GLOW_AIR).multiplyScalar(0.62 + 0.3 * shellLook.glow);
      // Brown and speckled shells hide more of the inside, as candlers find.
      set("uDetail", 0.55 + 0.45 * shellLook.glow);
      // Brown pigment sits near the outside, so a broken edge is pale; blue runs right through.
      (u.uLip.value as Color).set(shellLook.lip);
      shellBake.row = 0;
      holds = index;
    },
    bake(all = false) {
      if (!r3d.ready) return;
      const rows = all ? Infinity : BAKE_ROWS;
      bakeStep(downBake, rows);
      if (holds >= 0) bakeStep(shellBake, rows);
    },
    draw(s) {
      toMatrix3(s.egg, u.uEgg.value);
      toMatrix3(s.chick, u.uChick.value);
      set("uBright", s.bright);
      set("uCrack", s.crack);
      (u.uMode as { value: number }).value = s.mode;
      setV("uPip", s.pip.dir);
      setV("uPipE", s.pip.e);
      setV("uPipN", s.pip.n);
      set("uHole", s.hole);
      u.uBeakOff.value.set(s.beakOff[0], s.beakOff[1]);
      const h = s.hatch;
      if (h) {
        toMatrix3(h.cap.inverse, u.uCapInv.value);
        set("uCapScale", h.cap.scale);
        set("uCapAlpha", h.cap.alpha);
        set("uCapLoose", h.cap.loose);
        const n = Math.min(MAX_PIECES, h.pieces.length);
        (u.uPieceN as { value: number }).value = n;
        for (let i = 0; i < n; i++) {
          const p = h.pieces[i]!;
          toMatrix3(p.inverse, u.uPieceInv.value[i]);
          u.uPieceC.value[i]!.set(p.centre[0], p.centre[1], p.centre[2]);
          u.uPieceScale.value[i] = p.scale;
          u.uPieceAlpha.value[i] = p.alpha;
          u.uPieceLoose.value[i] = p.loose;
        }
        set("uTear", h.tear);
      } else {
        set("uTear", 0);
      }
      set("uDry", s.dry);
      set("uLids", s.lids);
      set("uBeak", s.beak);
      set("uWings", s.wings);
      const down = DOWNS[s.down % DOWNS.length]!;
      (u.uDownDry.value as Color).set(down.dry).multiplyScalar(0.94);
      (u.uDownWet.value as Color).set(down.wet);
      const c = s.chick;
      setV("uUpChick", [c[1], c[4], c[7]]);
      set("uCandle", s.candle);
      set("uDay", s.day);
      const cs = s.cs;
      if (cs && s.candle > 0) {
        setV("uAirN", s.airN);
        set("uAirH", cs.air);
        const y = s.yolk;
        u.uYolk.value = [y[0], y[1], y[2], cs.yolkRadius];
        set("uYolkK", cs.yolk);
        setV("uEmb", s.embryo.dir);
        setV("uEmbE", s.embryo.e);
        setV("uEmbN", s.embryo.n);
        set("uEmbSize", cs.size);
        set("uEmbK", cs.embryo);
        set("uEmbAng", cs.turn);
        set("uEmbEye", cs.eye);
        set("uHeart", cs.heart);
        set("uDark", cs.dark);
        set("uDarkR", cs.darkReach);
        set("uSmallEnd", cs.smallEnd);
        set("uVein", cs.vein);
        set("uPipIn", cs.pipIn);
        setV("uPipInC", s.pipInC);
      }
      captions.set(s.caption.day, s.caption.line);
      set("uTextOn", s.caption.on);
      pass.render();
    },
    resize(f) {
      r3d.resize(f);
      pass.setSphere(f.sphere ?? WHOLE_SPHERE);
      const rows = Math.max(1, f.height * f.pixelRatio);
      set("uPx", Math.PI / rows);
    },
    dispose() {
      offRestore();
      for (const b of [shellBake, downBake]) {
        b.target.dispose();
        b.material.dispose();
      }
      quad.dispose();
      data.dispose();
      pieces.dispose();
      captions.dispose();
    },
  };
};
