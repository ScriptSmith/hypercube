/**
 * Building blocks for the scenes: simple shapes placed and coloured, merged into a few meshes
 * (one per kind of surface) so each scene draws in a handful of calls, and the pieces every
 * scene uses, such as pines and lamp posts. Design metres; y up; a piece's yaw turns it about y
 * as three.js does.
 */
import {
  type BufferGeometry,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Rng } from "../../core/types";
import type { Collider } from "./terrain";

/**
 * One scene's materials. Every scene has its own, so each can dissolve on its own while the
 * blizzard hides a change of scene, but all scenes share the same three shader programs.
 */
export interface Materials {
  /** Painted, matt surfaces, coloured per vertex. */
  solid: MeshLambertMaterial;
  /** Lit windows and bulbs: their own light, scaled by the time of day. */
  glow: MeshBasicMaterial;
  /** Ice and glossy paint. */
  gloss: MeshPhongMaterial;
  /** How much of the scene has dissolved into snow, 0 to 1. */
  dissolve: { value: number };
}

/**
 * Discards a growing share of the surface in small cubes of space, so a scene crumbles into the
 * snow or gathers out of it.
 */
const dissolving = (material: Material, amount: { value: number }) => {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDissolve = amount;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vDissolve;")
      .replace(
        "#include <project_vertex>",
        "#include <project_vertex>\nvDissolve = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        [
          "#include <common>",
          "uniform float uDissolve;",
          "varying vec3 vDissolve;",
          "float dissolveHash(vec3 p) {",
          "  p = fract(p * 0.3183099 + 0.1) * 17.0;",
          "  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));",
          "}",
        ].join("\n"),
      )
      .replace(
        "void main() {",
        "void main() {\n  if (uDissolve > 0.0 && dissolveHash(floor(vDissolve * 30.0)) < uDissolve) discard;",
      );
  };
  material.customProgramCacheKey = () => "snowglobe-dissolve";
};

export const createMaterials = (): Materials => {
  const dissolve = { value: 0 };
  const m: Materials = {
    solid: new MeshLambertMaterial({ vertexColors: true }),
    glow: new MeshBasicMaterial({ vertexColors: true }),
    gloss: new MeshPhongMaterial({
      vertexColors: true,
      specular: new Color(0.55, 0.6, 0.7),
      shininess: 70,
      side: DoubleSide,
    }),
    dissolve,
  };
  dissolving(m.solid, dissolve);
  dissolving(m.glow, dissolve);
  dissolving(m.gloss, dissolve);
  return m;
};

export type Layer = Exclude<keyof Materials, "dissolve">;

const tmpColor = new Color();

/** Shapes collected for one scene, merged into one mesh per layer. */
export class Parts {
  private readonly layers: Record<Layer, BufferGeometry[]> = { solid: [], glow: [], gloss: [] };
  readonly colliders: Collider[] = [];

  constructor(private readonly rng: Rng) {}

  /**
   * Add a shape, already placed, in one colour. `vary` shades each vertex a little lighter or
   * darker, so painted surfaces look hand-made.
   */
  add(geo: BufferGeometry, color: string | number, layer: Layer = "solid", vary = 0.05): this {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    for (const name of Object.keys(g.attributes)) {
      if (name !== "position" && name !== "normal") g.deleteAttribute(name);
    }
    const count = g.attributes.position!.count;
    const colors = new Float32Array(count * 3);
    tmpColor.set(color);
    // One shade per triangle, so faces read as painted pieces rather than noise.
    for (let i = 0; i < count; i += 3) {
      const k = 1 + (vary ? this.rng.range(-vary, vary) : 0);
      for (let j = 0; j < 3 && i + j < count; j++) {
        colors[(i + j) * 3] = tmpColor.r * k;
        colors[(i + j) * 3 + 1] = tmpColor.g * k;
        colors[(i + j) * 3 + 2] = tmpColor.b * k;
      }
    }
    g.setAttribute("color", new Float32BufferAttribute(colors, 3));
    this.layers[layer].push(g);
    return this;
  }

  /** Add a geometry that already has per-vertex colours. */
  addColored(geo: BufferGeometry, layer: Layer = "solid"): this {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    for (const name of Object.keys(g.attributes)) {
      if (name !== "position" && name !== "normal" && name !== "color") g.deleteAttribute(name);
    }
    this.layers[layer].push(g);
    return this;
  }

  /** Everything added so far as one geometry, coloured per vertex, for a moving piece. */
  merged(): BufferGeometry {
    const list = [...this.layers.solid];
    this.layers.solid.length = 0;
    const g = mergeGeometries(list, false);
    for (const x of list) x.dispose();
    return g;
  }

  collide(c: Collider): this {
    this.colliders.push(c);
    return this;
  }

  /** Merge into meshes on `materials`; solid surfaces cast and take shadows. */
  build(materials: Materials): Group {
    const group = new Group();
    for (const layer of ["solid", "gloss", "glow"] as const) {
      const list = this.layers[layer];
      if (list.length === 0) continue;
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      list.length = 0;
      if (!merged) continue;
      const mesh = new Mesh(merged, materials[layer]);
      mesh.castShadow = layer !== "glow";
      mesh.receiveShadow = layer !== "glow";
      group.add(mesh);
    }
    return group;
  }
}

const m4 = new Matrix4();
const q = new Quaternion();
// Tilts in a piece's own frame first, then its yaw.
const e = new Euler(0, 0, 0, "YXZ");
const v = new Vector3();
const s = new Vector3();

/** Place a geometry: scale, then tilt about z and x, then turn about y, then move. */
export const put = (
  geo: BufferGeometry,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sy = 1,
  sz = 1,
): BufferGeometry => {
  q.setFromEuler(e.set(rx, ry, rz, "YXZ"));
  geo.applyMatrix4(m4.compose(v.set(x, y, z), q, s.set(sx, sy, sz)));
  return geo;
};

/** Turn a geometry about y by `yaw` round (cx, cz), after placing it in a piece's own frame. */
export const turnAbout = (geo: BufferGeometry, yaw: number, cx: number, cz: number) => {
  geo.applyMatrix4(m4.makeTranslation(-cx, 0, -cz));
  geo.applyMatrix4(m4.makeRotationY(yaw));
  geo.applyMatrix4(m4.makeTranslation(cx, 0, cz));
  return geo;
};

export const box = (w: number, h: number, d: number) => new BoxGeometry(w, h, d);
export const cyl = (rt: number, rb: number, h: number, seg = 12, open = false) =>
  new CylinderGeometry(rt, rb, h, seg, 1, open);
export const cone = (r: number, h: number, seg = 10) => new ConeGeometry(r, h, seg, 1);
export const ball = (r: number, ws = 12, hs = 8) => new SphereGeometry(r, ws, hs);
export const ring = (r: number, tube: number, seg = 24) => new TorusGeometry(r, tube, 6, seg);
/** A lumpy stone of radius about `r`. */
export const stone = (rng: Rng, r: number, detail = 1) => {
  const g = new IcosahedronGeometry(r, detail);
  const p = g.attributes.position!;
  const seen = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
    let k = seen.get(key);
    if (k === undefined) {
      k = rng.range(0.78, 1.12);
      seen.set(key, k);
    }
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.8, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
};

/** Points in a piece's own frame, turned by `yaw` and moved to (x, z). */
export const at = (x: number, z: number, yaw: number) => (u: number, w: number) => {
  const c = Math.cos(yaw);
  const sn = Math.sin(yaw);
  return [x + u * c + w * sn, z - u * sn + w * c] as const;
};

export const SNOW = "#f3f6fb";
export const SNOW_SHADE = "#dbe4f0";
const NEEDLES = ["#1f4a35", "#24523a", "#1b4231", "#2b5a40"];
const BARK = "#5a3f2c";

/**
 * A snowy pine standing on the ground at (x, y, z), `h` tall: tiers of needles, each with snow
 * on its upper side.
 */
export const pine = (parts: Parts, rng: Rng, x: number, y: number, z: number, h: number) => {
  const needles = rng.pick(NEEDLES);
  const trunk = h * 0.16;
  parts.add(put(cyl(h * 0.035, h * 0.05, trunk + 0.02, 7), x, y + trunk / 2 - 0.01, z), BARK);
  const tiers = h > 1 ? 4 : 3;
  const width = h * rng.range(0.3, 0.36);
  let base = y + trunk * 0.8;
  const tierH = ((h - trunk) / tiers) * 1.45;
  for (let i = 0; i < tiers; i++) {
    const f = 1 - i / (tiers + 0.6);
    const r = width * f;
    const yaw = rng.range(0, Math.PI);
    const cy = base + tierH / 2;
    parts.add(put(cone(r, tierH, 9), x, cy, z, 0, yaw, 0), needles, "solid", 0.08);
    // Snow sits on the upper part of each tier, a little proud of the needles.
    parts.add(
      put(cone(r * 0.72, tierH * 0.62, 9), x, cy + tierH * 0.2 + 0.006, z, 0, yaw + 0.2, 0),
      SNOW,
      "solid",
      0.03,
    );
    base += (h - trunk) / tiers;
  }
  parts.collide({ kind: "cone", x, z, r: width, base: y + trunk, apex: y + h, shed: true });
};

/** A lamp post with a glowing head at (x, y, z); returns where its light is. */
export const lampPost = (parts: Parts, x: number, y: number, z: number, h = 0.62) => {
  const iron = "#2c3138";
  parts.add(put(cyl(0.018, 0.024, h, 8), x, y + h / 2, z), iron);
  parts.add(put(cyl(0.04, 0.05, 0.04, 8), x, y + 0.02, z), iron);
  parts.add(put(box(0.075, 0.09, 0.075), x, y + h + 0.045, z), "#ffd890", "glow");
  parts.add(put(cone(0.07, 0.06, 4), x, y + h + 0.12, z, 0, Math.PI / 4, 0), iron);
  parts.add(put(cone(0.05, 0.02, 4), x, y + h + 0.15, z, 0, Math.PI / 4, 0), SNOW);
  parts.collide({ kind: "cone", x, z, r: 0.06, base: y + h + 0.09, apex: y + h + 0.16 });
  return new Vector3(x, y + h + 0.045, z);
};

/**
 * A row of windows on a wall facing out along the piece's local +w: glowing panes behind a dark
 * frame with a cross. `u` is the window's centre along the wall, `y` its middle.
 */
export const window4 = (
  parts: Parts,
  place: (u: number, w: number) => readonly [number, number],
  yaw: number,
  u: number,
  y: number,
  w: number,
  width = 0.14,
  height = 0.16,
  frame = "#3a2a20",
) => {
  const [x, z] = place(u, w);
  parts.add(put(box(width, height, 0.012), x, y, z, 0, yaw, 0), "#ffcf7a", "glow", 0.12);
  const [fx, fz] = place(u, w + 0.008);
  const t = 0.018;
  parts.add(put(box(width + t, t, 0.02), fx, y + height / 2, fz, 0, yaw, 0), frame);
  parts.add(put(box(width + t, t, 0.02), fx, y - height / 2, fz, 0, yaw, 0), frame);
  parts.add(put(box(t, height, 0.02), fx, y, fz, 0, yaw, 0), frame);
  parts.add(put(box(width, t * 0.6, 0.02), fx, y, fz, 0, yaw, 0), frame);
  const [lx, lz] = place(u - width / 2, w + 0.008);
  const [rx, rz] = place(u + width / 2, w + 0.008);
  parts.add(put(box(t, height, 0.02), lx, y, lz, 0, yaw, 0), frame);
  parts.add(put(box(t, height, 0.02), rx, y, rz, 0, yaw, 0), frame);
  // A ledge of snow under it.
  const [sx, sz] = place(u, w + 0.02);
  parts.add(put(box(width + 0.04, 0.025, 0.05), sx, y - height / 2 - 0.02, sz, 0, yaw, 0), SNOW);
};

/**
 * A pitched roof over a box `hw` by `hd` (half sizes along u and w) whose walls stop at `eave`:
 * two slabs meeting at a ridge along u, `rise` above the eaves, with snow on their upper part.
 */
export const gableRoof = (
  parts: Parts,
  place: (u: number, w: number) => readonly [number, number],
  yaw: number,
  hw: number,
  hd: number,
  eave: number,
  rise: number,
  color: string,
  over = 0.08,
  snow = 0.55,
) => {
  const pitch = Math.atan2(rise, hd);
  const ridge = eave + rise;
  const run = hd + over;
  const len = run / Math.cos(pitch);
  const thick = 0.035;
  const snowT = 0.03;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  for (const side of [-1, 1]) {
    // Along the slab from the ridge, then out along its normal.
    const slab = (along: number, out: number) => {
      const w = side * (along * cp + out * sp);
      const y = ridge - along * sp + out * cp;
      return [w, y] as const;
    };
    const [w0, y0] = slab(len / 2, thick / 2);
    const [x0, z0] = place(0, w0);
    parts.add(
      put(box(2 * (hw + over), thick, len), x0, y0, z0, side * pitch, yaw, 0),
      color,
      "solid",
      0.07,
    );
    const cover = len * snow;
    const [w1, y1] = slab(cover / 2, thick + snowT / 2);
    const [x1, z1] = place(0, w1);
    parts.add(
      put(box(2 * (hw + over) - 0.02, snowT, cover), x1, y1, z1, side * pitch, yaw, 0),
      SNOW,
      "solid",
      0.02,
    );
  }
  const [cx, cz] = place(0, 0);
  parts.collide({
    kind: "gable",
    x: cx,
    z: cz,
    hw: hw + over,
    hd: run,
    yaw,
    eave: ridge - run * Math.tan(pitch) + thick,
    ridge: ridge + thick,
    shed: true,
  });
  return ridge + thick;
};
