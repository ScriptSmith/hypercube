/**
 * The beach toys drawn in 3D: each one a few three.js meshes built from lathes, extrusions and
 * simple solids in its model frame (metres, y up from its base, z towards the people), under the
 * same beach light as the balls: the sun, the sky above, the sunlit sand below and the beach
 * behind the people, with the sky and sand in their reflections and the same soft shoulder on
 * the brightest light. Each toy is tipped a little towards the people so its top shows, as
 * things on the sand do from standing height.
 */
import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  HemisphereLight,
  LatheGeometry,
  LinearMipmapLinearFilter,
  type Material,
  Mesh,
  MeshStandardMaterial,
  type MeshStandardMaterialParameters,
  Path,
  Quaternion,
  RepeatWrapping,
  RGBAFormat,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
} from "three";
import { PROP_PAINT, PROP_SCALE, PROP_SPECS, type ToyKind } from "./wallprops";
import { TONE_GLSL } from "./wallshade";
import { LOOKS, type Look } from "./wallsky";

/** How far each toy is tipped towards the people, radians. */
export const TILT = (18 * Math.PI) / 180;
const TAU = Math.PI * 2;

/** The sky and beach as the toys reflect them, as the balls do. */
const ENV_GLSL = /* glsl */ `
uniform vec3 uEnvTop;
uniform vec3 uEnvHorizon;
uniform vec3 uEnvGround;
uniform vec3 uEnvFar;
vec3 propEnv(vec3 r) {
  if (r.y >= 0.0) return mix(uEnvHorizon, uEnvTop, pow(r.y, 0.6));
  float far = exp(r.y * 6.0);
  return mix(uEnvGround, uEnvFar, far * 0.6);
}
`;

const v3 = (c: readonly number[]) => ({ value: new Vector3(c[0], c[1], c[2]) });

/**
 * What every toy reflects, shared by all their materials and set from the time of day each
 * frame (`setPaintEnv`).
 */
const PAINT_ENV = {
  uEnvTop: v3(LOOKS.day.envTop),
  uEnvHorizon: v3(LOOKS.day.envHorizon),
  uEnvGround: v3(LOOKS.day.envGround),
  uEnvFar: v3(LOOKS.day.envFar),
};

export const setPaintEnv = (l: Look) => {
  PAINT_ENV.uEnvTop.value.set(...l.envTop);
  PAINT_ENV.uEnvHorizon.value.set(...l.envHorizon);
  PAINT_ENV.uEnvGround.value.set(...l.envGround);
  PAINT_ENV.uEnvFar.value.set(...l.envFar);
};

/** A standard material lit like the balls: sky and sand in its reflections, the same tone. */
export const paint = (o: MeshStandardMaterialParameters): MeshStandardMaterial => {
  const m = new MeshStandardMaterial(o);
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, PAINT_ENV);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${TONE_GLSL}\n${ENV_GLSL}`)
      .replace(
        "#include <lights_fragment_maps>",
        "#include <lights_fragment_maps>\n\tradiance += propEnv(reflect(-geometryViewDir, geometryNormal));",
      )
      .replace("#include <tonemapping_fragment>", "gl_FragColor.rgb = tone(gl_FragColor.rgb);");
  };
  m.customProgramCacheKey = () => "beach-toy";
  return m;
};

/** A small hash, so the textures are the same every time. */
export const hash = (x: number, y: number, salt: number) => {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export const rgbOf = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
};

export const texture = (
  size: readonly [number, number],
  pixel: (x: number, y: number) => readonly [number, number, number],
): DataTexture => {
  const [w, h] = size;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = pixel(x, y);
      const i = (y * w + x) * 4;
      data[i] = Math.max(0, Math.min(255, Math.round(c[0])));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(c[1])));
      data[i + 2] = Math.max(0, Math.min(255, Math.round(c[2])));
      data[i + 3] = 255;
    }
  }
  const t = new DataTexture(data, w, h, RGBAFormat);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
};

/** Woven straw: strands over and under each other, each its own shade. */
const strawTexture = () => {
  const base = rgbOf(PROP_PAINT.straw);
  const strand = 8;
  return texture([64, 64], (x, y) => {
    const cx = Math.floor(x / strand);
    const cy = Math.floor(y / strand);
    const across = (cx + cy) % 2 === 0;
    const f = across ? (y % strand) / strand : (x % strand) / strand;
    const id = across ? cy : cx;
    const round = 0.78 + 0.22 * Math.sin(Math.PI * (f * 0.9 + 0.05));
    const tone = 0.92 + 0.14 * hash(id, across ? 1 : 2, 3);
    const gap = f < 0.08 || f > 0.94 ? 0.72 : 1;
    const k = round * tone * gap * (0.97 + 0.06 * hash(x, y, 4));
    return [base[0] * k, base[1] * k, base[2] * k];
  });
};

/** Damp sand packed in the bucket, a little darker than the dry beach. */
export const sandTexture = () =>
  texture([64, 64], (x, y) => {
    const k = 0.84 * (0.92 + 0.14 * hash(x, y, 7)) * (hash(x >> 2, y >> 2, 8) < 0.06 ? 0.8 : 1);
    return [218 * k, 203 * k, 176 * k];
  });

/** The bottle's print: white with a band of waves round its middle, and no words. */
const labelTexture = () => {
  const white = rgbOf(PROP_PAINT.bottle);
  const band = rgbOf(PROP_PAINT.band);
  const wave = rgbOf(PROP_PAINT.wave);
  const w = 128;
  const h = 64;
  return texture([w, h], (x, y) => {
    const u = x / w;
    const v = y / h;
    const top = 0.6 + 0.025 * Math.sin(u * TAU * 4);
    const crest = 0.47 + 0.03 * Math.sin(u * TAU * 4 + 1.2);
    if (v > 0.3 && v < top) return v > crest - 0.035 && v < crest ? wave : band;
    return white;
  });
};

/** A lathe with its seam at the back and its texture spread by length along the profile. */
export const lathe = (points: readonly (readonly [number, number])[], segments = 48) => {
  const g = new LatheGeometry(
    points.map(([x, y]) => new Vector2(x, y)),
    segments,
    Math.PI,
  );
  const arc = [0];
  for (let j = 1; j < points.length; j++) {
    const [x0, y0] = points[j - 1]!;
    const [x1, y1] = points[j]!;
    arc.push(arc[j - 1]! + Math.hypot(x1 - x0, y1 - y0));
  }
  const uv = g.getAttribute("uv");
  const total = arc[arc.length - 1]! || 1;
  for (let i = 0; i <= segments; i++) {
    for (let j = 0; j < points.length; j++) uv.setY(i * points.length + j, arc[j]! / total);
  }
  uv.needsUpdate = true;
  return g;
};

export const mesh = (
  g: ConstructorParameters<typeof Mesh>[0],
  m: Material,
  at?: readonly number[],
) => {
  const o = new Mesh(g, m);
  if (at) o.position.set(at[0] ?? 0, at[1] ?? 0, at[2] ?? 0);
  return o;
};

const hat = (): Group => {
  const g = new Group();
  const straw = strawTexture();
  straw.repeat.set(40, 10);
  const strawPaint = paint({ map: straw, roughness: 0.85, side: DoubleSide });
  const ribbon = paint({ color: new Color(PROP_PAINT.ribbon), roughness: 0.55 });
  g.add(
    mesh(
      lathe([
        [0.402, 0.0],
        [0.4, -0.01],
        [0.36, -0.004],
        [0.3, 0.004],
        [0.24, 0.011],
        [0.19, 0.016],
        [0.176, 0.022],
        [0.177, 0.05],
        [0.176, 0.09],
        [0.172, 0.13],
        [0.162, 0.165],
        [0.143, 0.193],
        [0.115, 0.213],
        [0.08, 0.226],
        [0.04, 0.232],
        [0, 0.234],
      ]),
      strawPaint,
    ),
  );
  g.add(
    mesh(
      lathe([
        [0.181, 0.022],
        [0.183, 0.045],
        [0.181, 0.07],
      ]),
      ribbon,
    ),
  );
  // A bow on the band, towards the front on the left.
  const bow = new Group();
  const phi = -0.75;
  bow.position.set(0.184 * Math.sin(phi), 0.046, 0.184 * Math.cos(phi));
  bow.rotation.y = phi;
  const knot = mesh(new SphereGeometry(0.018, 12, 8), ribbon);
  knot.scale.set(1, 1.25, 0.55);
  bow.add(knot);
  for (const side of [-1, 1]) {
    const loop = mesh(new TorusGeometry(0.02, 0.008, 6, 16), ribbon, [side * 0.03, 0.004, 0]);
    loop.scale.set(1.35, 0.85, 0.45);
    bow.add(loop);
    const tail = mesh(new BoxGeometry(0.014, 0.055, 0.004), ribbon, [side * 0.012, -0.03, 0.002]);
    tail.rotation.z = side * 0.35;
    bow.add(tail);
  }
  g.add(bow);
  return g;
};

/** The packed sand's top inside the bucket, built about its own rim and moved to its level. */
const SAND_TOP = 0.35;
const SAND_BOTTOM = 0.024;
const INNER = { top: 0.184, bottom: 0.15 };

/** The bucket's inside radius at height y. */
const innerAt = (y: number) =>
  INNER.bottom + ((INNER.top - INNER.bottom) * (y - SAND_BOTTOM)) / (SAND_TOP - SAND_BOTTOM);

const bucket = (): Group => {
  const g = new Group();
  const body = paint({ color: new Color(PROP_PAINT.bucket), roughness: 0.38 });
  // The inside is in its own shade, out of most of the sky's light.
  const inside = paint({
    color: new Color(PROP_PAINT.bucket).multiplyScalar(0.62),
    roughness: 0.45,
    side: DoubleSide,
  });
  const sand = sandTexture();
  sand.repeat.set(6, 2);
  g.add(
    mesh(
      lathe([
        [0, 0],
        [0.13, 0],
        [0.145, 0.003],
        [0.151, 0.012],
        [0.183, 0.27],
        [0.188, 0.275],
        [0.19, 0.305],
        [0.187, 0.31],
        [0.192, 0.355],
        [0.205, 0.362],
        [0.209, 0.385],
        [0.204, 0.398],
        [0.196, 0.399],
        [0.19, 0.385],
        [0.184, 0.35],
      ]),
      body,
    ),
  );
  g.add(
    mesh(
      lathe([
        [0.184, 0.35],
        [0.17, 0.25],
        [0.156, 0.07],
        [0.15, 0.032],
        [0.135, 0.022],
        [0, 0.02],
      ]),
      inside,
    ),
  );
  const top = mesh(
    lathe([
      [0.185, 0],
      [0.15, 0.008],
      [0.1, 0.018],
      [0.05, 0.025],
      [0, 0.027],
    ]),
    paint({ map: sand, roughness: 1 }),
    [0, SAND_TOP, 0],
  );
  top.name = "sand";
  g.add(top);
  const handlePaint = paint({ color: new Color(PROP_PAINT.handle), roughness: 0.45 });
  const handle = mesh(new TorusGeometry(0.199, 0.007, 8, 40, Math.PI), handlePaint, [0, 0.345, 0]);
  // It leans back from the people, so the sand stays in view.
  handle.rotation.x = -1;
  g.add(handle);
  for (const side of [-1, 1]) {
    const lug = mesh(new CylinderGeometry(0.014, 0.014, 0.022, 12), body, [side * 0.2, 0.345, 0]);
    lug.rotation.z = Math.PI / 2;
    g.add(lug);
  }
  return g;
};

/** One lens's outline about its centre, a little wider at the top. */
const lensOutline = (grow: number): Vector2[] => {
  const out: Vector2[] = [];
  for (let i = 0; i < 48; i++) {
    const t = (i / 48) * TAU;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const x = Math.sign(c) * Math.abs(c) ** 0.75 * (0.075 + grow) * (1 + 0.08 * s);
    const y = Math.sign(s) * Math.abs(s) ** (s > 0 ? 0.6 : 0.9) * (0.06 + grow);
    out.push(new Vector2(x, y));
  }
  return out;
};

const sunnies = (): Group => {
  const g = new Group();
  const frame = paint({ color: new Color(PROP_PAINT.frame), roughness: 0.3 });
  const glass = paint({ color: new Color("#24334d"), metalness: 0.55, roughness: 0.08 });
  const rim = {
    depth: 0.012,
    bevelEnabled: true,
    bevelThickness: 0.003,
    bevelSize: 0.003,
    bevelSegments: 2,
    curveSegments: 1,
  };
  for (const side of [-1, 1]) {
    const ring = new Shape(lensOutline(0.016));
    ring.holes.push(new Path(lensOutline(0)));
    const r = mesh(new ExtrudeGeometry(ring, rim), frame, [side * 0.088, 0.062, -0.006]);
    g.add(r);
    const lens = mesh(
      new ExtrudeGeometry(new Shape(lensOutline(0.002)), { depth: 0.004, bevelEnabled: false }),
      glass,
      [side * 0.088, 0.062, -0.002],
    );
    g.add(lens);
    const hinge = mesh(new BoxGeometry(0.022, 0.026, 0.022), frame, [side * 0.172, 0.104, -0.006]);
    g.add(hinge);
    // The arms are folded in behind the lenses, one over the other, their tips bent down.
    const back = side < 0 ? -0.024 : -0.04;
    const arm = mesh(new BoxGeometry(0.29, 0.013, 0.009), frame, [side * 0.035, 0.104, back]);
    g.add(arm);
    const ear = mesh(new BoxGeometry(0.06, 0.013, 0.009), frame, [-side * 0.125, 0.085, back]);
    ear.rotation.z = side * 0.55;
    g.add(ear);
  }
  const bridge = new Shape();
  bridge.moveTo(-0.034, 0.088);
  bridge.quadraticCurveTo(0, 0.116, 0.034, 0.088);
  bridge.lineTo(0.034, 0.104);
  bridge.quadraticCurveTo(0, 0.13, -0.034, 0.104);
  bridge.closePath();
  g.add(mesh(new ExtrudeGeometry(bridge, rim), frame, [0, 0, -0.006]));
  return g;
};

const spade = (): Group => {
  const g = new Group();
  const bladePaint = paint({ color: new Color(PROP_PAINT.blade), roughness: 0.35 });
  const shaftPaint = paint({ color: new Color(PROP_PAINT.shaft), roughness: 0.4 });
  const blade = new Shape();
  blade.moveTo(0, 0);
  blade.quadraticCurveTo(0.1, 0.02, 0.1, 0.12);
  blade.lineTo(0.1, 0.225);
  blade.quadraticCurveTo(0.1, 0.24, 0.085, 0.24);
  blade.lineTo(0.03, 0.245);
  blade.lineTo(-0.03, 0.245);
  blade.lineTo(-0.085, 0.24);
  blade.quadraticCurveTo(-0.1, 0.24, -0.1, 0.225);
  blade.lineTo(-0.1, 0.12);
  blade.quadraticCurveTo(-0.1, 0.02, 0, 0);
  const plate = {
    depth: 0.012,
    bevelEnabled: true,
    bevelThickness: 0.004,
    bevelSize: 0.004,
    bevelSegments: 2,
    curveSegments: 10,
  };
  g.add(mesh(new ExtrudeGeometry(blade, plate), bladePaint, [0, 0, -0.006]));
  // The ridge down the middle of the blade that stiffens it.
  g.add(mesh(new BoxGeometry(0.022, 0.17, 0.01), bladePaint, [0, 0.155, 0.008]));
  // A spadeful of damp sand on the blade, shown while it holds one.
  const sand = sandTexture();
  sand.repeat.set(2, 2);
  const load = mesh(
    new SphereGeometry(1, 18, 12),
    paint({ map: sand, roughness: 1 }),
    [0, 0.1, 0.022],
  );
  load.scale.set(0.075, 0.07, 0.032);
  load.name = "load";
  load.visible = false;
  g.add(load);
  g.add(mesh(new CylinderGeometry(0.026, 0.034, 0.05, 16), bladePaint, [0, 0.265, 0]));
  g.add(mesh(new CylinderGeometry(0.022, 0.022, 0.4, 16), shaftPaint, [0, 0.46, 0]));
  const grip = mesh(new CapsuleGeometry(0.027, 0.1, 6, 12), shaftPaint, [0, 0.69, 0]);
  grip.rotation.z = Math.PI / 2;
  g.add(grip);
  return g;
};

const bottle = (): Group => {
  const g = new Group();
  const label = labelTexture();
  const body = lathe([
    [0, 0],
    [0.068, 0],
    [0.08, 0.006],
    [0.085, 0.02],
    [0.085, 0.1],
    [0.085, 0.2],
    [0.085, 0.3],
    [0.081, 0.325],
    [0.068, 0.348],
    [0.05, 0.362],
    [0.04, 0.37],
    [0.038, 0.38],
  ]);
  // The print wraps round by angle and runs up by height.
  const pos = body.getAttribute("position");
  const uv = body.getAttribute("uv");
  for (let i = 0; i < pos.count; i++) uv.setY(i, pos.getY(i) / 0.38);
  uv.needsUpdate = true;
  const shell = mesh(body, paint({ map: label, roughness: 0.32 }));
  shell.scale.z = 0.62;
  g.add(shell);
  const capPaint = paint({ color: new Color(PROP_PAINT.cap), roughness: 0.35 });
  const cap = mesh(new CylinderGeometry(0.044, 0.047, 0.065, 32), capPaint, [0, 0.405, 0]);
  cap.scale.z = 0.75;
  g.add(cap);
  g.add(mesh(new BoxGeometry(0.03, 0.012, 0.02), capPaint, [0, 0.432, 0.03]));
  return g;
};

const BUILD: Record<ToyKind, () => Group> = { hat, bucket, sunnies, spade, bottle };

export interface BeachLights {
  readonly root: Group;
  /** Set the sun, sky, sand and the beach behind the people from the time of day. */
  set(l: Look): void;
}

/**
 * The light the toys, the umbrella, the crab and the sand are lit by, at the ball shader's
 * strengths: a directional sun, a hemisphere of sky over sunlit sand, and one for the beach
 * behind the people.
 */
export const createBeachLights = (): BeachLights => {
  const root = new Group();
  const sun = new DirectionalLight(new Color(), Math.PI);
  root.add(sun);
  const sky = new HemisphereLight(new Color(), new Color(), Math.PI);
  sky.position.set(0, 1, 0);
  root.add(sky);
  const behind = new HemisphereLight(new Color(), new Color(0, 0, 0), Math.PI);
  behind.position.set(0, 0, 1);
  root.add(behind);
  const set = (l: Look) => {
    sun.color.setRGB(...l.sunLight);
    sun.position.set(...l.sun);
    sky.color.setRGB(...l.skyLight);
    sky.groundColor.setRGB(...l.sandLight);
    behind.color.setRGB(...l.behindLight);
  };
  set(LOOKS.day);
  return { root, set };
};

export interface PropViews {
  /** Everything to add to the scene: the toys. */
  readonly root: Group;
  /**
   * Put toy `i` with its centre of mass at (x, y) stage px (y up), turned `a` in the wall's
   * plane and `yaw` about its own upright axis, at `scale` stage px a metre.
   */
  place(i: number, x: number, y: number, a: number, yaw: number, scale: number): void;
  /** Where toy `i`'s model base is from its centre of mass, metres, when that moves. */
  setOrigin(i: number, origin: { readonly x: number; readonly y: number }): void;
  /** How full toy `i` is with sand, 0 to 1, for a toy that holds any. */
  setFill(i: number, fill: number): void;
  /** How much sand toy `i`'s blade holds, 0 to 1, for a toy that carries any. */
  setLoad(i: number, load: number): void;
}

export const createPropViews = (kinds: readonly ToyKind[]): PropViews => {
  const root = new Group();
  const models: Group[] = [];
  const sands: (Mesh | null)[] = [];
  const loads: (Mesh | null)[] = [];
  const items = kinds.map((kind) => {
    const outer = new Group();
    const model = BUILD[kind]();
    const o = PROP_SPECS[kind].origin;
    model.position.set(o.x, o.y, 0);
    model.scale.setScalar(PROP_SCALE);
    outer.add(model);
    outer.traverse((m) => {
      m.renderOrder = 2;
      m.frustumCulled = false;
    });
    root.add(outer);
    models.push(model);
    sands.push((model.getObjectByName("sand") as Mesh | undefined) ?? null);
    loads.push((model.getObjectByName("load") as Mesh | undefined) ?? null);
    return outer;
  });
  const tilt = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), TILT);
  const qa = new Quaternion();
  const qy = new Quaternion();
  const zAxis = new Vector3(0, 0, 1);
  const yAxis = new Vector3(0, 1, 0);
  return {
    root,
    place(i, x, y, a, yaw, scale) {
      const o = items[i];
      if (!o) return;
      o.position.set(x, y, 0);
      o.scale.setScalar(scale);
      qa.setFromAxisAngle(zAxis, a);
      qy.setFromAxisAngle(yAxis, yaw);
      o.quaternion.copy(tilt).multiply(qa).multiply(qy);
    },
    setOrigin(i, origin) {
      models[i]?.position.set(origin.x, origin.y, 0);
    },
    setFill(i, fill) {
      const sand = sands[i];
      if (!sand) return;
      // The sand's top sinks with the fill, and empty leaves a thin layer on the bottom.
      const f = Math.min(1, Math.max(0, fill));
      const y = SAND_BOTTOM + (SAND_TOP - SAND_BOTTOM) * f;
      const r = innerAt(y) / 0.185;
      sand.position.y = y;
      sand.scale.set(r, f > 0.05 ? 1 : 0.35, r);
    },
    setLoad(i, load) {
      const m = loads[i];
      if (m) m.visible = load > 0.05;
    },
  };
};
