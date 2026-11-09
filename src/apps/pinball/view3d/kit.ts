/**
 * The shared kit every 3D pinball view builds from: a theme's palette, the few geometries and
 * materials everything reuses, the room the chrome balls reflect, and helpers for rails,
 * tubes, extruded shapes, lamps, balls and canvas-painted planes. Materials are Phong or basic
 * only, cached by colour, so shader programs stay few (see core/renderer3d.ts).
 *
 * Scene coordinates follow camera.ts: field px with y flipped (scene y = -field y), z up off the
 * field towards the viewer. `at` places an object by field coordinates.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BoxGeometry,
  type BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  CubeTexture,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  MixOperation,
  type Object3D,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  type Texture,
  TubeGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { P3 } from "../devices";
import type { Arc, Seg } from "../physics";

export interface Pt {
  x: number;
  y: number;
}

/** A theme's colours for the shared parts. */
export interface LookPalette {
  /** Behind and round the playfield. */
  cabinet: string;
  /** The default playfield art: top and bottom. */
  fieldTop: string;
  fieldLow: string;
  /** Metal rails and guides. */
  rail: string;
  /** Lamps lit and unlit, unless a part says otherwise. */
  lamp: string;
  lampOff: string;
  /** Glass tubes. */
  glass: string;
  /** Flippers and other white plastic. */
  plastic: string;
  /** What the chrome balls reflect: the room in front, the field behind them, and lights. */
  envRoom: string;
  envField: string;
  envLight: string;
}

export interface Kit {
  readonly palette: LookPalette;
  readonly geo: {
    /** Radius 1 at the origin. */
    sphere: SphereGeometry;
    /** Radius 1, standing from z 0 to z 1. */
    cylinder: CylinderGeometry;
    /** Radius 1, facing the viewer. */
    disc: CircleGeometry;
    ring: RingGeometry;
    /** 1 x 1, facing the viewer. */
    quad: PlaneGeometry;
    /** 1 x 1 x 1, from z 0 to z 1. */
    box: BoxGeometry;
  };
  readonly tex: { glow: Texture; blob: Texture; insert: Texture };
  /** The room the chrome reflects. */
  readonly env: CubeTexture;
  readonly mat: {
    chrome: MeshPhongMaterial;
    metal: MeshPhongMaterial;
    dark: MeshPhongMaterial;
    white: MeshPhongMaterial;
    glass: MeshPhongMaterial;
    shadow: MeshBasicMaterial;
  };
  /** A lit, shiny material of a colour (cached). */
  phong(
    color: string,
    o?: { shininess?: number; emissive?: string; opacity?: number },
  ): MeshPhongMaterial;
  /** An unlit material of a colour (cached), optionally additive. */
  basic(
    color: string,
    o?: { additive?: boolean; opacity?: number; map?: Texture },
  ): MeshBasicMaterial;
  /** An additive soft glow of a colour (cached): use on `geo.quad` scaled to the glow's size. */
  glow(color: string): MeshBasicMaterial;
  /** A texture painted once on a canvas `w` x `h`. */
  paint(w: number, h: number, fn: (g: CanvasRenderingContext2D) => void): CanvasTexture;
  /** Dispose `x` with the kit. */
  keep<T extends { dispose(): void }>(x: T): T;
  /** A mark in what the kit keeps, and disposing of everything kept since one (cached
   * materials stay): for parts rebuilt now and then, such as the deck's slots. */
  mark(): number;
  releaseSince(mark: number): void;
  dispose(): void;
}

/** Put `o` at field (x, y) and height z. */
export const at = (o: Object3D, x: number, y: number, z = 0) => {
  o.position.set(x, -y, z);
  return o;
};

const canvas = (w: number, h: number) => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};

const radial = (size: number, stops: [number, string][]) => {
  const c = canvas(size, size);
  const g = c.getContext("2d");
  if (g) {
    const r = size / 2;
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    for (const [k, col] of stops) grad.addColorStop(k, col);
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  return c;
};

/**
 * Six faces of the room for the chrome: px, nx, py, ny, pz, nz. +z is the room in front of the
 * field (dark, with soft lights), -z the field itself, the sides between the two.
 */
const envFaces = (p: LookPalette): HTMLCanvasElement[] => {
  const S = 128;
  /** The room: bright overhead, darker low down, with soft light panels. */
  const room = (panels: readonly (readonly [number, number, number, number, number])[]) => {
    const c = canvas(S, S);
    const g = c.getContext("2d");
    if (g) {
      const grad = g.createLinearGradient(0, 0, 0, S);
      grad.addColorStop(0, p.envRoom);
      grad.addColorStop(1, p.envField);
      g.fillStyle = grad;
      g.fillRect(0, 0, S, S);
      g.fillStyle = p.envLight;
      for (const [x, y, w, h, a] of panels) {
        g.globalAlpha = a;
        g.beginPath();
        g.roundRect(x * S, y * S, w * S, h * S, 8);
        g.fill();
      }
    }
    return c;
  };
  /** A side: the room towards the viewer, the field behind the balls. */
  const side = (flip: boolean) => {
    const c = canvas(S, S);
    const g = c.getContext("2d");
    if (g) {
      const grad = g.createLinearGradient(flip ? S : 0, 0, flip ? 0 : S, 0);
      grad.addColorStop(0, p.envRoom);
      grad.addColorStop(0.5, p.envRoom);
      grad.addColorStop(1, p.envField);
      g.fillStyle = grad;
      g.fillRect(0, 0, S, S);
      g.fillStyle = p.envLight;
      g.globalAlpha = 0.7;
      g.fillRect(S * (flip ? 0.6 : 0.15), S * 0.15, S * 0.25, S * 0.12);
    }
    return c;
  };
  const field = canvas(S, S);
  const gf = field.getContext("2d");
  if (gf) {
    gf.fillStyle = p.envField;
    gf.fillRect(0, 0, S, S);
  }
  return [
    side(false),
    side(true),
    room([[0.2, 0.3, 0.6, 0.25, 0.9]]),
    room([]),
    room([
      [0.15, 0.08, 0.7, 0.16, 1],
      [0.08, 0.55, 0.22, 0.2, 0.55],
      [0.7, 0.55, 0.22, 0.2, 0.55],
    ]),
    field,
  ];
};

export const createKit = (palette: LookPalette): Kit => {
  const own: { dispose(): void }[] = [];
  const cached: { dispose(): void }[] = [];
  const cache = <T extends { dispose(): void }>(x: T): T => {
    cached.push(x);
    return x;
  };
  const keep = <T extends { dispose(): void }>(x: T): T => {
    own.push(x);
    return x;
  };
  const tex = (c: HTMLCanvasElement) => {
    const t = keep(new CanvasTexture(c));
    t.colorSpace = SRGBColorSpace;
    return t;
  };
  const cylinder = keep(new CylinderGeometry(1, 1, 1, 28, 1));
  cylinder.rotateX(Math.PI / 2);
  cylinder.translate(0, 0, 0.5);
  const box = keep(new BoxGeometry(1, 1, 1));
  box.translate(0, 0, 0.5);
  const env = keep(new CubeTexture(envFaces(palette)));
  env.colorSpace = SRGBColorSpace;
  env.needsUpdate = true;
  const glowTex = tex(
    radial(128, [
      [0, "rgba(255,255,255,1)"],
      [0.3, "rgba(255,255,255,0.55)"],
      [1, "rgba(255,255,255,0)"],
    ]),
  );
  const blob = tex(
    radial(64, [
      [0, "rgba(0,0,0,0.7)"],
      [0.55, "rgba(0,0,0,0.3)"],
      [1, "rgba(0,0,0,0)"],
    ]),
  );
  // A lamp insert: a bright face with a rim, white so instance colours tint it.
  const insert = tex(
    radial(64, [
      [0, "rgba(255,255,255,1)"],
      [0.62, "rgba(235,235,235,1)"],
      [0.8, "rgba(160,160,160,1)"],
      [0.92, "rgba(255,255,255,1)"],
      [1, "rgba(255,255,255,0)"],
    ]),
  );
  const phongs = new Map<string, MeshPhongMaterial>();
  const basics = new Map<string, MeshBasicMaterial>();
  const kit: Kit = {
    palette,
    geo: {
      sphere: keep(new SphereGeometry(1, 28, 18)),
      cylinder,
      disc: keep(new CircleGeometry(1, 40)),
      ring: keep(new RingGeometry(0.78, 1, 40)),
      quad: keep(new PlaneGeometry(1, 1)),
      box,
    },
    tex: { glow: glowTex, blob, insert },
    env,
    mat: {
      chrome: keep(
        new MeshPhongMaterial({
          color: "#ffffff",
          specular: "#ffffff",
          shininess: 140,
          envMap: env,
          combine: MixOperation,
          reflectivity: 0.82,
        }),
      ),
      metal: keep(
        new MeshPhongMaterial({
          color: palette.rail,
          specular: "#ffffff",
          shininess: 90,
          envMap: env,
          combine: MixOperation,
          reflectivity: 0.35,
        }),
      ),
      dark: keep(new MeshPhongMaterial({ color: palette.cabinet, shininess: 20 })),
      white: keep(
        new MeshPhongMaterial({ color: palette.plastic, shininess: 70, specular: "#888888" }),
      ),
      glass: keep(
        new MeshPhongMaterial({
          color: palette.glass,
          transparent: true,
          opacity: 0.16,
          shininess: 150,
          specular: "#ffffff",
          depthWrite: false,
          side: DoubleSide,
        }),
      ),
      shadow: keep(
        new MeshBasicMaterial({
          map: blob,
          transparent: true,
          depthWrite: false,
          color: "#000000",
        }),
      ),
    },
    phong(color, o = {}) {
      const key = `${color}|${o.shininess ?? 60}|${o.emissive ?? ""}|${o.opacity ?? 1}`;
      let m = phongs.get(key);
      if (!m) {
        m = cache(
          new MeshPhongMaterial({
            color,
            shininess: o.shininess ?? 60,
            specular: "#999999",
            emissive: o.emissive ?? "#000000",
            transparent: (o.opacity ?? 1) < 1,
            opacity: o.opacity ?? 1,
          }),
        );
        phongs.set(key, m);
      }
      return m;
    },
    basic(color, o = {}) {
      const key = `${color}|${o.additive ?? false}|${o.opacity ?? 1}|${o.map?.uuid ?? ""}`;
      let m = basics.get(key);
      if (!m) {
        const see = o.additive || (o.opacity ?? 1) < 1 || o.map !== undefined;
        m = cache(
          new MeshBasicMaterial({
            color,
            map: o.map ?? null,
            transparent: see,
            opacity: o.opacity ?? 1,
            depthWrite: !see,
            ...(o.additive ? { blending: AdditiveBlending } : {}),
          }),
        );
        basics.set(key, m);
      }
      return m;
    },
    glow: (color) => kit.basic(color, { additive: true, map: glowTex }),
    paint(w, h, fn) {
      const c = canvas(w, h);
      const g = c.getContext("2d");
      if (g) fn(g);
      return tex(c);
    },
    keep,
    mark: () => own.length,
    releaseSince(mark) {
      for (const x of own.splice(mark)) x.dispose();
    },
    dispose() {
      for (const x of cached) x.dispose();
      cached.length = 0;
      for (const x of own) x.dispose();
      own.length = 0;
      phongs.clear();
      basics.clear();
    },
  };
  return kit;
};

// ---- Geometry helpers -------------------------------------------------------------------------

const UP = new Vector3(0, 0, 1);

/**
 * Raised rails along segments and arcs (field px, thick as the shape), `height` px tall, merged
 * into one geometry: a box per straight piece and a round post at each joint.
 */
export const railsGeometry = (
  shapes: readonly (Seg | Arc)[],
  height: number,
  extra = 0,
): BufferGeometry | null => {
  const parts: BufferGeometry[] = [];
  const piece = (ax: number, ay: number, bx: number, by: number, r: number) => {
    const l = Math.hypot(bx - ax, by - ay);
    if (l > 0.5) {
      const b = new BoxGeometry(l, 2 * r, height);
      b.translate(0, 0, height / 2);
      b.rotateZ(-Math.atan2(by - ay, bx - ax));
      b.translate((ax + bx) / 2, -(ay + by) / 2, 0);
      parts.push(b);
    }
    for (const [x, y] of [
      [ax, ay],
      [bx, by],
    ] as const) {
      const c = new CylinderGeometry(r + extra, r + extra, height, 14);
      c.rotateX(Math.PI / 2);
      c.translate(x, -y, height / 2);
      parts.push(c);
    }
  };
  for (const s of shapes) {
    if (s.kind === "seg") {
      piece(s.ax, s.ay, s.bx, s.by, s.r);
    } else {
      const n = Math.max(2, Math.ceil(((s.a1 - s.a0) * s.rad) / 40));
      for (let i = 0; i < n; i++) {
        const a = s.a0 + ((s.a1 - s.a0) * i) / n;
        const b = s.a0 + ((s.a1 - s.a0) * (i + 1)) / n;
        piece(
          s.cx + Math.cos(a) * s.rad,
          s.cy + Math.sin(a) * s.rad,
          s.cx + Math.cos(b) * s.rad,
          s.cy + Math.sin(b) * s.rad,
          s.r,
        );
      }
    }
  }
  if (parts.length === 0) return null;
  const nonIndexed = parts.map((p) => {
    const q = p.index ? p.toNonIndexed() : p;
    if (q !== p) p.dispose();
    q.deleteAttribute("uv");
    return q;
  });
  const merged = mergeGeometries(nonIndexed);
  for (const p of nonIndexed) p.dispose();
  return merged;
};

/** A tube of `radius` along field points with heights, smoothed. */
export const tubeGeometry = (pts: readonly P3[], radius: number, radial = 12): BufferGeometry => {
  const curve = new CatmullRomCurve3(
    pts.map((p) => new Vector3(p.x, -p.y, p.z)),
    false,
    "centripetal",
  );
  const n = Math.max(8, Math.round(curve.getLength() / 24));
  return new TubeGeometry(curve, n, radius, radial, false);
};

/** A flat outline (field px) extruded `depth` up from the field, with a small rounded edge. */
export const extrudeGeometry = (
  outline: readonly Pt[],
  depth: number,
  bevel = 0,
): BufferGeometry => {
  const s = new Shape();
  outline.forEach((p, i) => (i === 0 ? s.moveTo(p.x, -p.y) : s.lineTo(p.x, -p.y)));
  s.closePath();
  const g = new ExtrudeGeometry(s, {
    depth: Math.max(0.1, depth - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 12,
  });
  g.translate(0, 0, bevel);
  return g;
};

/** A flipper: a tapered capsule from a pivot circle (r0) to a tip circle (r1) `len` along +x. */
export const flipperGeometry = (len: number, r0: number, r1: number, depth: number) => {
  const s = new Shape();
  const a = Math.asin((r0 - r1) / len);
  s.absarc(0, 0, r0, Math.PI / 2 + a, Math.PI * 1.5 - a, false);
  s.absarc(len, 0, r1, -Math.PI / 2 - a, Math.PI / 2 + a, false);
  s.closePath();
  const g = new ExtrudeGeometry(s, {
    depth: depth - 6,
    bevelEnabled: true,
    bevelThickness: 3,
    bevelSize: 3,
    bevelSegments: 2,
    curveSegments: 16,
  });
  g.translate(0, 0, 3);
  return g;
};

// ---- Layers: balls and lamps -------------------------------------------------------------------

const m4 = new Matrix4();
const q = new Quaternion();
const v = new Vector3();
const s3 = new Vector3();
const col = new Color();

export interface BallLayer {
  readonly root: Object3D[];
  begin(): void;
  /** A ball at field (x, y), centre height z, radius r, its halo in `color` (null for none). */
  add(x: number, y: number, z: number, r: number, color: string | null, material?: 0 | 1): void;
  end(): void;
}

/**
 * Up to `max` chrome balls, each with a coloured halo on the field under it and a soft shadow
 * falling a little down the field (the light is above the top edge). `alt` is a second ball
 * material (a gold captive ball).
 */
export const createBallLayer = (kit: Kit, max: number, alt?: MeshPhongMaterial): BallLayer => {
  const goldMax = Math.max(1, Math.ceil(max / 8));
  const balls = new InstancedMesh(kit.geo.sphere, kit.mat.chrome, max);
  const gold = alt ? new InstancedMesh(kit.geo.sphere, alt, goldMax) : null;
  const halos = new InstancedMesh(kit.geo.quad, kit.glow("#ffffff"), max);
  const shadows = new InstancedMesh(kit.geo.quad, kit.mat.shadow, max);
  for (const m of [balls, gold, halos, shadows]) {
    if (!m) continue;
    m.frustumCulled = false;
    m.count = 0;
  }
  for (let i = 0; i < max; i++) halos.setColorAt(i, col.set("#000000"));
  halos.renderOrder = 2;
  shadows.renderOrder = 1;
  let n = 0;
  let nb = 0;
  let ng = 0;
  return {
    root: [shadows, halos, balls, ...(gold ? [gold] : [])],
    begin() {
      n = 0;
      nb = 0;
      ng = 0;
    },
    add(x, y, z, r, color, material = 0) {
      if (n >= max) return;
      q.identity();
      m4.compose(v.set(x, -y, z), q, s3.set(r, r, r));
      if (material === 1 && gold && ng < goldMax) gold.setMatrixAt(ng++, m4);
      else balls.setMatrixAt(nb++, m4);
      // The shadow is longer and softer the higher the ball.
      const lift = Math.max(0, z - r);
      const sr = r * (2.3 + lift / 60);
      shadows.setMatrixAt(
        n,
        m4.compose(v.set(x, -(y + r * 0.35 + lift * 0.4), 0.4), q, s3.set(sr, sr, 1)),
      );
      const hr = color ? r * 3.1 : 0.001;
      halos.setMatrixAt(n, m4.compose(v.set(x, -y, 0.6), q, s3.set(hr, hr, 1)));
      halos.setColorAt(n, col.set(color ?? "#000000").multiplyScalar(color ? 0.55 : 0));
      n++;
    },
    end() {
      balls.count = nb;
      shadows.count = n;
      halos.count = n;
      if (gold) gold.count = ng;
      balls.instanceMatrix.needsUpdate = true;
      shadows.instanceMatrix.needsUpdate = true;
      halos.instanceMatrix.needsUpdate = true;
      if (halos.instanceColor) halos.instanceColor.needsUpdate = true;
      if (gold) gold.instanceMatrix.needsUpdate = true;
    },
  };
};

export interface LampSpot {
  x: number;
  y: number;
  r: number;
  /** Colour when lit. */
  color: string;
}

export interface LampLayer {
  readonly root: Object3D[];
  /** How lit lamp `i` is, 0 to 1, in its own colour or `color`. */
  set(i: number, k: number, color?: string): void;
  commit(): void;
}

/** Lamp inserts in the field, dim when off, each with an additive halo when lit. */
export const createLampLayer = (kit: Kit, lamps: readonly LampSpot[], z = 0.8): LampLayer => {
  const n = Math.max(1, lamps.length);
  const faces = new InstancedMesh(kit.geo.disc, kit.basic("#ffffff", { map: kit.tex.insert }), n);
  const halos = new InstancedMesh(kit.geo.quad, kit.glow("#ffffff"), n);
  faces.frustumCulled = false;
  halos.frustumCulled = false;
  halos.renderOrder = 3;
  const off = new Color(kit.palette.lampOff);
  lamps.forEach((l, i) => {
    q.identity();
    faces.setMatrixAt(i, m4.compose(v.set(l.x, -l.y, z), q, s3.set(l.r, l.r, 1)));
    halos.setMatrixAt(i, m4.compose(v.set(l.x, -l.y, z + 0.3), q, s3.set(l.r * 4.2, l.r * 4.2, 1)));
    faces.setColorAt(i, off);
    halos.setColorAt(i, col.set("#000000"));
  });
  faces.count = lamps.length;
  halos.count = lamps.length;
  if (lamps.length === 0) {
    faces.setColorAt(0, off);
    halos.setColorAt(0, col.set("#000000"));
  }
  const on = new Color();
  return {
    root: [faces, halos],
    set(i, k, color) {
      const l = lamps[i];
      if (!l) return;
      const kk = Math.max(0, Math.min(1, k));
      on.set(color ?? l.color);
      faces.setColorAt(i, col.copy(off).lerp(on, kk));
      halos.setColorAt(i, col.copy(on).multiplyScalar(kk * 0.75));
    },
    commit() {
      if (faces.instanceColor) faces.instanceColor.needsUpdate = true;
      if (halos.instanceColor) halos.instanceColor.needsUpdate = true;
    },
  };
};

export interface TextPlane {
  readonly mesh: Mesh;
  /** Repaint: the canvas is `w` x `h` field px scaled by its resolution. */
  draw(fn: (g: CanvasRenderingContext2D) => void): void;
  dispose(): void;
}

/**
 * A plane at field (x, y, z) of `w` x `h` field px showing a canvas painted on demand (scores,
 * totals), with `res` canvas px per field px.
 */
export const createTextPlane = (
  kit: Kit,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  res: number,
): TextPlane => {
  const c = canvas(w * res, h * res);
  const g = c.getContext("2d");
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  const mat = new MeshBasicMaterial({ map: t, transparent: true, depthWrite: false });
  const mesh = new Mesh(kit.geo.quad, mat);
  mesh.scale.set(w, h, 1);
  at(mesh, x, y, z);
  mesh.renderOrder = 4;
  return {
    mesh,
    draw(fn) {
      if (!g) return;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, c.width, c.height);
      g.setTransform(res, 0, 0, res, 0, 0);
      fn(g);
      t.needsUpdate = true;
    },
    dispose() {
      t.dispose();
      mat.dispose();
      c.width = 0;
    },
  };
};

/** Turn `o` so its +x axis points along field direction (dx, dy), lying in the field. */
export const along = (o: Object3D, dx: number, dy: number) => {
  o.quaternion.setFromAxisAngle(UP, Math.atan2(-dy, dx));
  return o;
};

// ---- Merging static meshes ---------------------------------------------------------------------

const rel = new Matrix4();

/**
 * Merge meshes that never move and share a material into one mesh per material under `into`,
 * so a table or deck costs a few draw calls rather than one per piece. A mesh is merged when it
 * is under a source that `whole` says is static throughout, or when it or an ancestor below the
 * source has `userData.static` set. The merged geometries are returned for disposal; the
 * originals leave the scene (their geometries are shared or kept elsewhere).
 */
export const mergeStatic = (
  into: Object3D,
  sources: readonly { root: Object3D; whole: boolean }[],
): BufferGeometry[] => {
  into.updateMatrixWorld(true);
  const inv = into.matrixWorld.clone().invert();
  const groups = new Map<string, { material: Mesh["material"]; meshes: Mesh[] }>();
  const marked = (o: Object3D, top: Object3D) => {
    for (let p: Object3D | null = o; p && p !== top.parent; p = p.parent) {
      if (p.userData.static === true) return true;
    }
    return false;
  };
  for (const src of sources) {
    src.root.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || (m as unknown as InstancedMesh).isInstancedMesh) return;
      if (Array.isArray(m.material) || !m.visible) return;
      if (!src.whole && !marked(m, src.root)) return;
      const attrs = Object.keys(m.geometry.attributes).sort().join(",");
      const key = `${m.material.uuid}|${attrs}|${m.renderOrder}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { material: m.material, meshes: [] }));
      g.meshes.push(m);
    });
  }
  const made: BufferGeometry[] = [];
  for (const g of groups.values()) {
    if (g.meshes.length < 2) continue;
    const parts = g.meshes.map((m) => {
      const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      geo.applyMatrix4(rel.multiplyMatrices(inv, m.matrixWorld));
      return geo;
    });
    const merged = mergeGeometries(parts);
    for (const p of parts) p.dispose();
    if (!merged) continue;
    const mesh = new Mesh(merged, g.material);
    mesh.renderOrder = g.meshes[0]!.renderOrder;
    mesh.userData.merged = true;
    into.add(mesh);
    made.push(merged);
    for (const m of g.meshes) m.removeFromParent();
  }
  return made;
};

/**
 * Pieces of different colours as one mesh with vertex colours, for one draw call: a flipper's
 * body, rubber and pin, a rocket's body, nose and fins.
 */
export const paintedGeometry = (
  pieces: readonly { geometry: BufferGeometry; color: string; matrix?: Matrix4 }[],
): BufferGeometry | null => {
  const c = new Color();
  const parts = pieces.map((p) => {
    const g = p.geometry.index ? p.geometry.toNonIndexed() : p.geometry.clone();
    if (p.matrix) g.applyMatrix4(p.matrix);
    for (const k of Object.keys(g.attributes))
      if (k !== "position" && k !== "normal") g.deleteAttribute(k);
    c.set(p.color);
    const n = g.getAttribute("position").count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    g.setAttribute("color", new BufferAttribute(arr, 3));
    return g;
  });
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return merged;
};
