/**
 * The three.js side: the cake's baked textures (its skin, its slope and, for a marbled glaze,
 * the glaze's colour, drawn a strip at a time over the first frames, so a slow GPU never stalls
 * the page), the glaze field, and the surface pass whose uniforms `draw` fills from the model.
 */
import {
  ClampToEdgeWrapping,
  Color,
  LinearFilter,
  Matrix3,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
} from "three";
import type { Renderer3D } from "../../core/renderer3d";
import { WHOLE_SPHERE } from "../../core/sphere";
import { createSurfacePass } from "../../core/sphere3d";
import type { FrameInfo } from "../../core/types";
import { BAKE_VERTEX, colourBake, slopeBake, TINT_BAKE } from "./bake";
import { createGlazeField } from "./field";
import { DROP_LIFE, type Glaze, glazeThickness, MAX_DROPS } from "./glaze";
import { type CakeLook, CHOCOLATE_SPRINKLES, RAINBOW_SPRINKLES, TOPPING } from "./looks";
import { SPRINKLE_COLOURS, SURFACE_GLSL } from "./surface";

interface Bake {
  target: WebGLRenderTarget;
  scene: Scene;
  material: ShaderMaterial;
  row: number;
}

export interface PainterOptions {
  look: CakeLook;
  exposure: number;
  /** A software renderer: smaller bakes in smaller strips. */
  software: boolean;
  seed: number;
}

export interface Painter {
  /** Compiled and baked: ready to draw. */
  readonly ready: boolean;
  readonly bakeSize: number;
  /** Draw a little more of the bakes; true once they are done. */
  bake(): boolean;
  /** Redraw the glaze field from the model. */
  updateField(g: Glaze): void;
  draw(g: Glaze): void;
  resize(frame: FrameInfo): void;
  dispose(): void;
}

const pow2AtLeast = (v: number, lo: number, hi: number) => {
  let n = lo;
  while (n < v && n < hi) n *= 2;
  return n;
};

const feedRows = (f: FrameInfo) => Math.max(1, Math.round(f.height * f.pixelRatio));

export const createPainter = (r3d: Renderer3D, frame: FrameInfo, opts: PainterOptions): Painter => {
  const bakeH = Math.min(opts.software ? 256 : 2048, pow2AtLeast(feedRows(frame) * 0.8, 256, 2048));
  const bakeW = 2 * bakeH;
  const rowsPerStep = opts.software ? 64 : 32;
  const quad = new PlaneGeometry(2, 2);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const seed = new Vector3(
    ((opts.seed % 1000) / 1000) * 37.1,
    ((opts.seed % 997) / 997) * 53.7,
    ((opts.seed % 991) / 991) * 19.3,
  );

  const makeBake = (fragment: string, w = bakeW, h = bakeH): Bake => {
    const target = new WebGLRenderTarget(w, h, {
      depthBuffer: false,
      wrapS: RepeatWrapping,
      wrapT: ClampToEdgeWrapping,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      generateMipmaps: false,
    });
    const material = new ShaderMaterial({
      vertexShader: BAKE_VERTEX,
      fragmentShader: fragment,
      uniforms: {
        uSeed: { value: seed },
        uStep: { value: Math.PI / bakeH },
      },
      depthTest: false,
      depthWrite: false,
    });
    const scene = new Scene();
    const mesh = new Mesh(quad, material);
    mesh.frustumCulled = false;
    scene.add(mesh);
    r3d.prepare(scene, camera);
    return { target, scene, material, row: 0 };
  };
  const colour = makeBake(colourBake(opts.look.body));
  const slope = makeBake(slopeBake(opts.look.body));
  // Only a marbled glaze needs its colour baked; the others get a stand-in of one row.
  const tint = opts.look.marble ? makeBake(TINT_BAKE) : makeBake(TINT_BAKE, 2, 1);
  const bakes = [colour, slope, tint];

  const look = opts.look;
  const thick = glazeThickness(look.kind);
  const field = createGlazeField(r3d, feedRows(frame), thick);
  const palette =
    look.topping === TOPPING.chocolate
      ? CHOCOLATE_SPRINKLES
      : look.topping === TOPPING.rainbow
        ? RAINBOW_SPRINKLES
        : [];
  const sprinkles = Array.from({ length: SPRINKLE_COLOURS }, (_, i) => {
    const c = palette[i % Math.max(1, palette.length)] ?? [0, 0, 0];
    return new Color().setRGB(c[0], c[1], c[2]);
  });

  const drops = Array.from({ length: MAX_DROPS }, () => new Vector4());
  const u = {
    uSpin: { value: new Matrix3() },
    uColour: { value: colour.target.texture },
    uSlope: { value: slope.target.texture },
    uField: { value: field.texture },
    uFieldSize: { value: field.size },
    uGlaze: { value: new Color().setRGB(look.glaze[0], look.glaze[1], look.glaze[2]) },
    uThin: { value: new Color().setRGB(look.thin[0], look.thin[1], look.thin[2]) },
    uOpacity: { value: new Vector2(look.opacity[0], look.opacity[1]) },
    uShine: { value: look.gloss },
    uPoke: { value: look.poke },
    uDrape: { value: look.drape },
    uRelief: { value: look.relief },
    uMarble: { value: look.marble ? 1 : 0 },
    uTint: { value: tint.target.texture },
    uTopping: { value: look.topping },
    uSprinkle: { value: sprinkles },
    uSprinkles: { value: Math.max(1, palette.length) },
    uHolly: { value: look.holly ? 1 : 0 },
    uDrop: { value: drops },
    uBottom: { value: new Vector3() },
    uCentreY: { value: 0 },
    uRadius: { value: 1 },
    uHidden: { value: 1 },
    uExposure: { value: opts.exposure },
  };
  const pass = createSurfacePass(r3d, frame, { fragment: SURFACE_GLSL, uniforms: u });

  const fit = (f: FrameInfo) => {
    const s = f.sphere ?? WHOLE_SPHERE;
    u.uCentreY.value = s.centreY;
    u.uRadius.value = s.radius;
    u.uHidden.value = Math.sin(Math.min(s.view.top, Math.PI / 2));
    pass.setSphere(s);
    field.resize(feedRows(f));
  };
  fit(frame);

  const offRestore = r3d.onRestore(() => {
    for (const b of bakes) b.row = 0;
  });

  const done = (b: Bake) => b.row >= b.target.height;
  const bakeStep = (b: Bake) => {
    if (done(b)) return;
    const n = Math.min(rowsPerStep, b.target.height - b.row);
    const r = r3d.renderer;
    b.target.scissor.set(0, b.row, b.target.width, n);
    b.target.scissorTest = true;
    r.setRenderTarget(b.target);
    r.render(b.scene, camera);
    r.setRenderTarget(null);
    b.target.scissorTest = false;
    b.row += n;
  };

  const baked = () => bakes.every(done);

  return {
    get ready() {
      return r3d.ready && baked();
    },
    bakeSize: bakeH,
    bake() {
      if (!r3d.ready) return false;
      const next = bakes.find((b) => !done(b));
      if (next) bakeStep(next);
      return baked();
    },
    updateField(g) {
      field.update(g);
    },
    draw(g) {
      const c = Math.cos(g.yaw);
      const s = Math.sin(g.yaw);
      // Room to pudding: the pudding's longitude is the room's less the yaw.
      u.uSpin.value.set(c, 0, -s, 0, 1, 0, s, 0, c);
      for (let i = 0; i < MAX_DROPS; i++) {
        const d = g.drops[i];
        if (!d) {
          drops[i]!.set(0, 0, 0, 0);
          continue;
        }
        const k = Math.min(1, d.age / DROP_LIFE);
        const lat = d.bottom ? d.lat : d.lat - 2 * k * k * d.r;
        const cl = Math.cos(lat);
        const shrink = d.bottom ? 1 - k ** 1.3 : 1 - k ** 1.6;
        drops[i]!.set(cl * Math.sin(d.lon), Math.sin(lat), cl * Math.cos(d.lon), d.r * shrink);
      }
      const b = g.bottom();
      u.uBottom.value.set(b.drop, b.neck, g.pool.fresh);
      pass.render();
    },
    resize(f) {
      fit(f);
    },
    dispose() {
      offRestore();
      for (const b of bakes) {
        b.target.dispose();
        b.material.dispose();
      }
      quad.dispose();
      field.dispose();
    },
  };
};
