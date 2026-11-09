/**
 * The three.js scenes, through its public API, with simple materials (basic and Lambert) so
 * programs compile quickly, and every material in place before the first compile.
 *
 * - A 4D stage: the shadow as glowing edges, warm and bright near along w and cool and dim far,
 *   and each slice as a lit, see-through solid at its place inside the shadow (scaled as the
 *   shadow is at its depth, so its corners sit on the shadow's edges). Without the shadow, the
 *   same scene shows slices at their true size, as a bank's frames do.
 * - A 3D stage: the shape as a see-through solid with glowing edges; the flat world, a sheet it
 *   passes through, with the slice bright on it; a lamp above and the shape's shadow on a lit
 *   floor below. The parts of the shape under the sheet are drawn before it, and the parts above
 *   after, by clipping planes, so the sheet dims what is under it. Without the solid, the sheet
 *   and slices alone.
 */
import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  DynamicDrawUsage,
  FrontSide,
  HemisphereLight,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NormalBlending,
  type PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  type Texture,
  Vector3,
} from "three";
import { FAR_COLOR, NEAR_COLOR, SHADOW_INK, SHEET_COLOR } from "./config";
import { hull2, hull3, hullEdges, type Vec3 } from "./hull";
import {
  createDots,
  createRibbons,
  dotTexture,
  type Dots,
  glowMaterial,
  type Ribbons,
  stripTexture,
} from "./ribbons";
import type { Mat4, Vec4 } from "./rot";
import type { Shape } from "./shapes";
import { depthScale, project, shadowRadius, slice3, slice4, turned } from "./slice";

export const LAMP_Y = 1.9;
export const FLOOR_Y = -1.3;
export const SHEET_HALF = 1.22;

/** How slices look: quieter when many share one view (a bank's screen). */
export interface SliceStyle {
  front: number;
  back: number;
  /** Outline width (world units) and how far its colour goes towards white. */
  outline: number;
  lighten: number;
}

export const SOLO_STYLE: SliceStyle = { front: 0.5, back: 0.42, outline: 0.018, lighten: 0.55 };
export const MANY_STYLE: SliceStyle = { front: 0.2, back: 0.14, outline: 0.011, lighten: 0.12 };

export interface SliceSlot {
  cut: number;
  color: Color;
  on: boolean;
}

export interface Kit {
  strip: Texture;
  dot: Texture;
  floor: Texture;
  sheet: Texture;
  dispose(): void;
}

const canvasTexture = (
  size: number,
  draw: (g: CanvasRenderingContext2D, s: number) => void,
): Texture => {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
  if (g) draw(g, size);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
};

export const createKit = (): Kit => {
  const strip = stripTexture();
  const dot = dotTexture();
  const floor = canvasTexture(256, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, "rgba(255,226,170,0.55)");
    grad.addColorStop(0.55, "rgba(190,170,150,0.28)");
    grad.addColorStop(1, "rgba(120,120,150,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
  const sheet = canvasTexture(256, (g, s) => {
    g.fillStyle = "rgba(127,180,255,0.16)";
    g.fillRect(0, 0, s, s);
    g.strokeStyle = "rgba(170,205,255,0.22)";
    g.lineWidth = 2;
    for (let i = 1; i < 8; i++) {
      const x = (i / 8) * s;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, s);
      g.moveTo(0, x);
      g.lineTo(s, x);
      g.stroke();
    }
    g.strokeStyle = "rgba(190,220,255,0.75)";
    g.lineWidth = 6;
    g.strokeRect(3, 3, s - 6, s - 6);
  });
  return {
    strip,
    dot,
    floor,
    sheet,
    dispose() {
      strip.dispose();
      dot.dispose();
      floor.dispose();
      sheet.dispose();
    },
  };
};

const addLights = (scene: Scene) => {
  scene.add(new HemisphereLight(0xc8d8ff, 0x262a48, 1.6));
  const key = new DirectionalLight(0xffffff, 1.7);
  key.position.set(-3, 5, 4);
  scene.add(key);
  const rim = new DirectionalLight(0x9fb4ff, 0.8);
  rim.position.set(3, -2, -4);
  scene.add(rim);
};

const lerpColor = (a: Color, b: Color, t: number, out: Color) =>
  out.copy(a).lerp(b, Math.min(1, Math.max(0, t)));

const NEAR = new Color(NEAR_COLOR);
const FAR = new Color(FAR_COLOR);
const WHITE = new Color(1, 1, 1);
const EDGE_3D = new Color("#d6e4ff");
const INK = new Color(SHADOW_INK);

/** A triangle buffer refilled each frame; flat normals. */
const triBuffer = (maxTris: number) => {
  const geo = new BufferGeometry();
  const pos = new Float32Array(maxTris * 9);
  const nrm = new Float32Array(maxTris * 9);
  const pa = new BufferAttribute(pos, 3);
  const na = new BufferAttribute(nrm, 3);
  pa.setUsage(DynamicDrawUsage);
  na.setUsage(DynamicDrawUsage);
  geo.setAttribute("position", pa);
  geo.setAttribute("normal", na);
  geo.setDrawRange(0, 0);
  let n = 0;
  return {
    geo,
    begin() {
      n = 0;
    },
    tri(a: Vec3, b: Vec3, c: Vec3, nx: number, ny: number, nz: number) {
      if (n >= maxTris) return;
      const o = n * 9;
      pos.set([a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]], o);
      nrm.set([nx, ny, nz, nx, ny, nz, nx, ny, nz], o);
      n++;
    },
    end() {
      geo.setDrawRange(0, n * 3);
      pa.needsUpdate = true;
      na.needsUpdate = true;
    },
    get count() {
      return n;
    },
  };
};

type TriBuffer = ReturnType<typeof triBuffer>;

const material = <T extends Material>(m: T, own: Material[]): T => {
  own.push(m);
  return m;
};

// ---- 4D ---------------------------------------------------------------------------------------

interface Slice4Meshes {
  tris: TriBuffer;
  front: Mesh;
  back: Mesh;
  ballFront: Mesh;
  ballBack: Mesh;
  outline: Ribbons;
  dots: Dots;
  frontMat: MeshLambertMaterial;
  backMat: MeshLambertMaterial;
  outlineColor: Color;
  outlineMesh: Mesh;
  dotMesh: Mesh;
  /** What the last update would show, before `only` picks a slot. */
  shown: { front: boolean; ball: boolean; outline: boolean; dots: boolean };
}

export interface Stage4 {
  readonly scene: Scene;
  update(shape: Shape, rot: Mat4, slots: readonly SliceSlot[], cam: PerspectiveCamera): void;
  /** Show only slot `i` (for the screen's row of slices), or every slot with -1. */
  only(i: number): void;
  /** Turned 4D points of the last update, for tests and the debug hook. */
  readonly last: { verts: number; sliceKind: string[]; sliceSize: number[]; sliceFaces: number[] };
  dispose(): void;
}

export const createStage4 = (
  kit: Kit,
  slots: number,
  shadow: boolean,
  style: SliceStyle = SOLO_STYLE,
): Stage4 => {
  const scene = new Scene();
  addLights(scene);
  const own: Material[] = [];
  const sphereGeo = new SphereGeometry(1, 40, 28);
  const geos: { dispose(): void }[] = [sphereGeo];
  const edges = createRibbons(520);
  const nodes = createDots(20);
  geos.push(edges, nodes);
  const edgeMesh = edges.mesh(material(glowMaterial(kit.strip), own));
  const nodeMesh = nodes.mesh(material(glowMaterial(kit.dot), own));
  edgeMesh.renderOrder = 5;
  nodeMesh.renderOrder = 6;
  const shellMat = material(
    new MeshBasicMaterial({
      color: 0x6a7cff,
      transparent: true,
      opacity: 0.08,
      side: BackSide,
      depthWrite: false,
    }),
    own,
  );
  const shell = new Mesh(sphereGeo, shellMat);
  shell.renderOrder = 1;
  shell.scale.setScalar(shadowRadius());
  if (shadow) scene.add(edgeMesh, nodeMesh, shell);

  const meshes: Slice4Meshes[] = [];
  for (let i = 0; i < slots; i++) {
    const tris = triBuffer(160);
    geos.push(tris.geo);
    const mk = (side: typeof FrontSide | typeof BackSide, opacity: number) =>
      material(
        new MeshLambertMaterial({
          color: 0xffffff,
          transparent: true,
          opacity,
          side,
          depthWrite: false,
        }),
        own,
      );
    const frontMat = mk(FrontSide, style.front);
    const backMat = mk(BackSide, style.back);
    const front = new Mesh(tris.geo, frontMat);
    const back = new Mesh(tris.geo, backMat);
    const ballFront = new Mesh(sphereGeo, frontMat);
    const ballBack = new Mesh(sphereGeo, backMat);
    for (const m of [front, back, ballFront, ballBack]) m.frustumCulled = false;
    back.renderOrder = 2;
    ballBack.renderOrder = 2;
    front.renderOrder = 3;
    ballFront.renderOrder = 3;
    const outline = createRibbons(80);
    const dots = createDots(4);
    geos.push(outline, dots);
    const om = outline.mesh(material(glowMaterial(kit.strip), own));
    const dm = dots.mesh(material(glowMaterial(kit.dot), own));
    om.renderOrder = 7;
    dm.renderOrder = 8;
    scene.add(back, front, ballBack, ballFront, om, dm);
    meshes.push({
      tris,
      front,
      back,
      ballFront,
      ballBack,
      outline,
      dots,
      frontMat,
      backMat,
      outlineColor: new Color(),
      outlineMesh: om,
      dotMesh: dm,
      shown: { front: false, ball: false, outline: false, dots: false },
    });
  }

  const pts: Vec4[] = [];
  const pa: Vec3 = [0, 0, 0];
  const pb: Vec3 = [0, 0, 0];
  const c0 = new Color();
  const c1 = new Color();
  const right = new Vector3();
  const up = new Vector3();
  const last = {
    verts: 0,
    sliceKind: [] as string[],
    sliceSize: [] as number[],
    sliceFaces: [] as number[],
  };

  const hideSlot = (m: Slice4Meshes) => {
    m.tris.begin();
    m.tris.end();
    m.front.visible = false;
    m.back.visible = false;
    m.ballFront.visible = false;
    m.ballBack.visible = false;
    m.outline.begin(right);
    m.outline.end();
    m.dots.begin(right, up);
    m.dots.end();
  };

  return {
    scene,
    get last() {
      return last;
    },
    only(i) {
      meshes.forEach((m, k) => {
        const on = i < 0 || k === i;
        m.front.visible = on && m.shown.front;
        m.back.visible = on && m.shown.front;
        m.ballFront.visible = on && m.shown.ball;
        m.ballBack.visible = on && m.shown.ball;
        m.outlineMesh.visible = on && m.shown.outline;
        m.dotMesh.visible = on && m.shown.dots;
      });
    },
    update(shape, rot, slotList, cam) {
      turned(shape, rot, pts);
      last.verts = pts.length;
      right.setFromMatrixColumn(cam.matrixWorld, 0).normalize();
      up.setFromMatrixColumn(cam.matrixWorld, 1).normalize();
      const eye = cam.position;
      if (shadow) {
        edges.begin(eye);
        const w = shape.round ? 0.016 : 0.026;
        for (const [i, j] of shape.edges) {
          const a = pts[i]!;
          const b = pts[j]!;
          project(a, pa);
          project(b, pb);
          lerpColor(FAR, NEAR, (a[3] + 1) / 2, c0).multiplyScalar(0.45 + 0.55 * ((a[3] + 1) / 2));
          lerpColor(FAR, NEAR, (b[3] + 1) / 2, c1).multiplyScalar(0.45 + 0.55 * ((b[3] + 1) / 2));
          edges.seg(
            pa[0],
            pa[1],
            pa[2],
            pb[0],
            pb[1],
            pb[2],
            w,
            c0.r,
            c0.g,
            c0.b,
            c1.r,
            c1.g,
            c1.b,
          );
        }
        edges.end();
        nodes.begin(right, up);
        if (!shape.round) {
          for (const a of pts) {
            project(a, pa);
            const t = (a[3] + 1) / 2;
            lerpColor(FAR, NEAR, t, c0).multiplyScalar(0.5 + 0.6 * t);
            nodes.dot(pa[0], pa[1], pa[2], 0.085 * Math.sqrt(depthScale(a[3])), c0.r, c0.g, c0.b);
          }
        }
        nodes.end();
        shell.visible = shape.round;
      }
      last.sliceKind.length = 0;
      last.sliceSize.length = 0;
      last.sliceFaces.length = 0;
      meshes.forEach((m, k) => {
        const slot = slotList[k];
        if (!slot || !slot.on) {
          hideSlot(m);
          m.shown.front = false;
          m.shown.ball = false;
          m.shown.outline = false;
          m.shown.dots = false;
          last.sliceKind.push("off");
          last.sliceSize.push(0);
          last.sliceFaces.push(0);
          return;
        }
        m.frontMat.color.copy(slot.color);
        m.backMat.color.copy(slot.color);
        m.outlineColor.copy(slot.color).lerp(WHITE, style.lighten);
        const oc = m.outlineColor;
        const s = shadow ? depthScale(slot.cut) : 1;
        const sl = slice4(shape, pts, slot.cut);
        m.tris.begin();
        m.outline.begin(eye);
        m.dots.begin(right, up);
        m.front.visible = false;
        m.back.visible = false;
        m.ballFront.visible = false;
        m.ballBack.visible = false;
        let size = 0;
        if (sl.kind === "ball") {
          size = sl.r;
          if (sl.r * s > 0.025) {
            for (const b of [m.ballFront, m.ballBack]) {
              b.visible = true;
              b.scale.setScalar(sl.r * s);
            }
          } else m.dots.dot(0, 0, 0, 0.09, oc.r, oc.g, oc.b);
        } else if (sl.kind === "hull") {
          const h = sl.hull;
          const P = h.points.map((p) => [p[0] * s, p[1] * s, p[2] * s] as Vec3);
          for (const p of P) size = Math.max(size, Math.hypot(p[0], p[1], p[2]) / s);
          if (h.kind === "point") {
            const p = P[0]!;
            m.dots.dot(p[0], p[1], p[2], 0.11, oc.r, oc.g, oc.b);
          } else {
            h.faces.forEach((f, fi) => {
              const n = h.normals[fi]!;
              for (let i = 1; i + 1 < f.length; i++)
                m.tris.tri(P[f[0]!]!, P[f[i]!]!, P[f[i + 1]!]!, n[0], n[1], n[2]);
            });
            for (const [i, j] of hullEdges(h)) {
              const a = P[i]!;
              const b = P[j]!;
              m.outline.seg(a[0], a[1], a[2], b[0], b[1], b[2], style.outline, oc.r, oc.g, oc.b);
            }
            if (h.kind === "segment")
              for (const p of P) m.dots.dot(p[0], p[1], p[2], 0.07, oc.r, oc.g, oc.b);
            m.front.visible = m.tris.count > 0;
            m.back.visible = m.tris.count > 0;
          }
        }
        m.tris.end();
        m.outline.end();
        m.dots.end();
        m.shown.front = m.front.visible;
        m.shown.ball = m.ballFront.visible;
        m.shown.outline = m.outline.count > 0;
        m.shown.dots = m.dotMesh.visible;
        last.sliceKind.push(sl.kind === "hull" ? sl.hull.kind : sl.kind);
        last.sliceSize.push(size);
        last.sliceFaces.push(sl.kind === "hull" ? sl.hull.faces.length : 0);
      });
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of own) m.dispose();
    },
  };
};

// ---- 3D ---------------------------------------------------------------------------------------

/** A flat fan refilled each frame. */
const fanBuffer = (maxPts: number) => {
  const geo = new BufferGeometry();
  const pos = new Float32Array((maxPts + 2) * 3 * 3);
  const pa = new BufferAttribute(pos, 3);
  pa.setUsage(DynamicDrawUsage);
  geo.setAttribute("position", pa);
  geo.setDrawRange(0, 0);
  return {
    geo,
    /** A convex loop of (x, z) points at height y. */
    set(loop: readonly (readonly [number, number])[], y: number) {
      let n = 0;
      const m = Math.min(loop.length, maxPts);
      for (let i = 1; i + 1 < m; i++) {
        const a = loop[0]!;
        const b = loop[i]!;
        const c = loop[i + 1]!;
        pos.set([a[0], y, a[1], b[0], y, b[1], c[0], y, c[1]], n * 9);
        n++;
      }
      geo.setDrawRange(0, n * 3);
      pa.needsUpdate = true;
    },
  };
};

interface PolyMeshes {
  fan: ReturnType<typeof fanBuffer>;
  fill: Mesh;
  fillMat: MeshBasicMaterial;
  outline: Ribbons;
  dots: Dots;
  outlineMesh: Mesh;
  dotMesh: Mesh;
  shown: { fill: boolean; outline: boolean; dots: boolean };
}

export interface Stage3 {
  readonly scene: Scene;
  update(shape: Shape, rot: Mat4, slots: readonly SliceSlot[], cam: PerspectiveCamera): void;
  only(i: number): void;
  readonly last: { sliceKind: string[]; sliceSize: number[]; sliceFaces?: number[] };
  dispose(): void;
}

export interface Stage3Opts {
  slots: number;
  /** The shape, its lamp and its shadow (false for a bank frame's slice alone). */
  solid: boolean;
  /** The flat world's sheet at the first slot's height. */
  sheet: boolean;
}

const CIRCLE: [number, number][] = Array.from({ length: 64 }, (_, i) => {
  const a = (i / 64) * Math.PI * 2;
  return [Math.cos(a), Math.sin(a)];
});

export const createStage3 = (kit: Kit, opts: Stage3Opts): Stage3 => {
  const scene = new Scene();
  addLights(scene);
  const own: Material[] = [];
  const sphereGeo = new SphereGeometry(1, 40, 28);
  const geos: { dispose(): void }[] = [sphereGeo];
  const below = new Plane(new Vector3(0, -1, 0), 0);
  const above = new Plane(new Vector3(0, 1, 0), 0);

  // The shape: four meshes on one geometry, the parts under and over the sheet, back and front.
  const solid = triBuffer(80);
  geos.push(solid.geo);
  const solidMat = (side: typeof FrontSide | typeof BackSide, plane: Plane) =>
    material(
      new MeshLambertMaterial({
        color: 0x9fb8ff,
        transparent: true,
        opacity: side === FrontSide ? 0.32 : 0.24,
        side,
        depthWrite: false,
        clippingPlanes: [plane],
      }),
      own,
    );
  const mats = {
    belowBack: solidMat(BackSide, below),
    belowFront: solidMat(FrontSide, below),
    aboveBack: solidMat(BackSide, above),
    aboveFront: solidMat(FrontSide, above),
  };
  const solidMeshes = {
    belowBack: new Mesh(solid.geo, mats.belowBack),
    belowFront: new Mesh(solid.geo, mats.belowFront),
    aboveBack: new Mesh(solid.geo, mats.aboveBack),
    aboveFront: new Mesh(solid.geo, mats.aboveFront),
  };
  const ballMeshes = {
    belowBack: new Mesh(sphereGeo, mats.belowBack),
    belowFront: new Mesh(sphereGeo, mats.belowFront),
    aboveBack: new Mesh(sphereGeo, mats.aboveBack),
    aboveFront: new Mesh(sphereGeo, mats.aboveFront),
  };
  for (const m of [...Object.values(solidMeshes), ...Object.values(ballMeshes)])
    m.frustumCulled = false;
  const edges = createRibbons(200);
  const nodes = createDots(16);
  geos.push(edges, nodes);
  const clippedGlow = (map: Texture, plane: Plane) => {
    const m = glowMaterial(map);
    m.clippingPlanes = [plane];
    return material(m, own);
  };
  const edgeBelow = edges.mesh(clippedGlow(kit.strip, below));
  const edgeAbove = edges.mesh(clippedGlow(kit.strip, above));
  const nodeBelow = nodes.mesh(clippedGlow(kit.dot, below));
  const nodeAbove = nodes.mesh(clippedGlow(kit.dot, above));

  // Lamp, floor and shadow.
  const lamp = createDots(2);
  geos.push(lamp);
  const lampMesh = lamp.mesh(material(glowMaterial(kit.dot), own));
  const floorGeo = new CircleGeometry(2.1, 64);
  geos.push(floorGeo);
  const floor = new Mesh(
    floorGeo,
    material(new MeshBasicMaterial({ map: kit.floor, transparent: true, depthWrite: false }), own),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  const shadowFan = fanBuffer(72);
  geos.push(shadowFan.geo);
  const shadowFill = new Mesh(
    shadowFan.geo,
    material(
      new MeshBasicMaterial({
        color: INK,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        side: DoubleSide,
      }),
      own,
    ),
  );
  shadowFill.frustumCulled = false;
  const shadowEdges = createRibbons(200);
  geos.push(shadowEdges);
  const shadowEdgeMesh = shadowEdges.mesh(
    material(glowMaterial(kit.strip, NormalBlending, 0.85), own),
  );

  // The sheet.
  const sheetGeo = new PlaneGeometry(SHEET_HALF * 2, SHEET_HALF * 2);
  geos.push(sheetGeo);
  const sheet = new Mesh(
    sheetGeo,
    material(
      new MeshBasicMaterial({
        map: kit.sheet,
        color: new Color(SHEET_COLOR),
        transparent: true,
        side: DoubleSide,
        depthWrite: false,
      }),
      own,
    ),
  );
  sheet.rotation.x = -Math.PI / 2;

  if (opts.solid) {
    scene.add(floor, shadowFill, shadowEdgeMesh, lampMesh);
    scene.add(
      ...Object.values(solidMeshes),
      ...Object.values(ballMeshes),
      edgeBelow,
      edgeAbove,
      nodeBelow,
      nodeAbove,
    );
  }
  if (opts.sheet) scene.add(sheet);

  const polys: PolyMeshes[] = [];
  for (let i = 0; i < opts.slots; i++) {
    const fan = fanBuffer(72);
    const fillMat = material(
      new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.78,
        side: DoubleSide,
        depthWrite: false,
      }),
      own,
    );
    const fill = new Mesh(fan.geo, fillMat);
    fill.frustumCulled = false;
    const outline = createRibbons(80);
    const dots = createDots(4);
    geos.push(fan.geo, outline, dots);
    const om = outline.mesh(material(glowMaterial(kit.strip), own));
    const dm = dots.mesh(material(glowMaterial(kit.dot), own));
    fill.renderOrder = 8;
    om.renderOrder = 9;
    dm.renderOrder = 9;
    scene.add(fill, om, dm);
    polys.push({
      fan,
      fill,
      fillMat,
      outline,
      dots,
      outlineMesh: om,
      dotMesh: dm,
      shown: { fill: false, outline: false, dots: false },
    });
  }

  const pts: Vec4[] = [];
  const right = new Vector3();
  const up = new Vector3();
  const c = new Color();
  const last = { sliceKind: [] as string[], sliceSize: [] as number[] };

  /** Where the lamp casts a point onto the floor. */
  const cast = (v: Vec4): [number, number] => {
    const t = (LAMP_Y - FLOOR_Y) / Math.max(0.05, LAMP_Y - v[1]);
    return [v[0] * t, v[2] * t];
  };

  const order = (cameraAbove: boolean) => {
    // Under the sheet first when the camera looks down on it, over it first from below.
    const first = cameraAbove ? "below" : "above";
    const second = cameraAbove ? "above" : "below";
    const set = (k: "below" | "above", base: number) => {
      (k === "below" ? solidMeshes.belowBack : solidMeshes.aboveBack).renderOrder = base;
      (k === "below" ? ballMeshes.belowBack : ballMeshes.aboveBack).renderOrder = base;
      (k === "below" ? solidMeshes.belowFront : solidMeshes.aboveFront).renderOrder = base + 1;
      (k === "below" ? ballMeshes.belowFront : ballMeshes.aboveFront).renderOrder = base + 1;
      (k === "below" ? edgeBelow : edgeAbove).renderOrder = base + 2;
      (k === "below" ? nodeBelow : nodeAbove).renderOrder = base + 3;
    };
    set(first, 3);
    set(second, 11);
    floor.renderOrder = 0;
    shadowFill.renderOrder = 1;
    shadowEdgeMesh.renderOrder = 2;
    sheet.renderOrder = 7;
    lampMesh.renderOrder = 16;
  };

  return {
    scene,
    get last() {
      return last;
    },
    only(i) {
      polys.forEach((p, k) => {
        const on = i < 0 || k === i;
        p.fill.visible = on && p.shown.fill;
        p.outlineMesh.visible = on && p.shown.outline;
        p.dotMesh.visible = on && p.shown.dots;
      });
    },
    update(shape, rot, slotList, cam) {
      turned(shape, rot, pts);
      right.setFromMatrixColumn(cam.matrixWorld, 0).normalize();
      up.setFromMatrixColumn(cam.matrixWorld, 1).normalize();
      const eye = cam.position;
      const first = slotList[0];
      // Alone (a bank frame's slice), the sheet and slice sit in the middle.
      const sheetY = !opts.sheet ? -10 : opts.solid ? (first?.cut ?? 0) : 0;
      below.constant = sheetY;
      above.constant = -sheetY;
      order(eye.y >= sheetY);
      if (opts.solid) {
        // The solid.
        solid.begin();
        const round = shape.round;
        if (!round) {
          const h = hull3(pts.map((p) => [p[0], p[1], p[2]] as Vec3));
          h.faces.forEach((f, fi) => {
            const n = h.normals[fi]!;
            for (let i = 1; i + 1 < f.length; i++)
              solid.tri(h.points[f[0]!]!, h.points[f[i]!]!, h.points[f[i + 1]!]!, n[0], n[1], n[2]);
          });
        }
        solid.end();
        for (const m of Object.values(solidMeshes)) m.visible = !round;
        for (const m of Object.values(ballMeshes)) m.visible = round;
        edges.begin(eye);
        nodes.begin(right, up);
        const w = round ? 0.014 : 0.024;
        for (const [i, j] of shape.edges) {
          const a = pts[i]!;
          const b = pts[j]!;
          edges.seg(
            a[0],
            a[1],
            a[2],
            b[0],
            b[1],
            b[2],
            w,
            EDGE_3D.r * 0.8,
            EDGE_3D.g * 0.8,
            EDGE_3D.b * 0.8,
          );
        }
        if (!round) for (const a of pts) nodes.dot(a[0], a[1], a[2], 0.075, 0.9, 0.95, 1);
        edges.end();
        nodes.end();
        // Lamp and shadow.
        lamp.begin(right, up);
        lamp.dot(0, LAMP_Y, 0, 0.42, 1, 0.82, 0.5);
        lamp.dot(0, LAMP_Y, 0, 0.16, 1, 1, 1);
        lamp.end();
        const fy = FLOOR_Y + 0.004;
        if (round) {
          const r = (LAMP_Y - FLOOR_Y) / Math.sqrt(LAMP_Y * LAMP_Y - 1);
          shadowFan.set(
            CIRCLE.map(([x, z]) => [x * r, z * r] as [number, number]),
            fy,
          );
        } else {
          const flat = pts.map(cast);
          shadowFan.set(
            hull2(flat).map((i) => flat[i]!),
            fy,
          );
        }
        shadowEdges.begin(eye);
        for (const [i, j] of shape.edges) {
          const a = cast(pts[i]!);
          const b = cast(pts[j]!);
          shadowEdges.seg(
            a[0],
            fy + 0.002,
            a[1],
            b[0],
            fy + 0.002,
            b[1],
            round ? 0.016 : 0.028,
            INK.r,
            INK.g,
            INK.b,
          );
        }
        shadowEdges.end();
      }
      if (opts.sheet) {
        sheet.position.y = sheetY;
        sheet.visible = !!first?.on;
      }
      last.sliceKind.length = 0;
      last.sliceSize.length = 0;
      polys.forEach((p, k) => {
        const slot = slotList[k];
        p.outline.begin(eye);
        p.dots.begin(right, up);
        if (!slot || !slot.on) {
          p.fan.set([], 0);
          p.outline.end();
          p.dots.end();
          p.fill.visible = false;
          p.shown.fill = false;
          p.shown.outline = false;
          p.shown.dots = false;
          last.sliceKind.push("off");
          last.sliceSize.push(0);
          return;
        }
        // On a bank frame's slice alone, the slice lies on a sheet at the middle.
        const y = (opts.solid ? slot.cut : 0) + 0.006;
        const sl = slice3(shape, pts, slot.cut);
        p.fillMat.color.copy(slot.color);
        c.copy(slot.color).lerp(WHITE, 0.5);
        let loop: [number, number][] = [];
        let size = 0;
        if (sl.kind === "circle") loop = CIRCLE.map(([x, z]) => [x * sl.r, z * sl.r]);
        else if (sl.kind === "poly") loop = sl.points.map((q) => [q[0], q[1]]);
        for (const q of loop) size = Math.max(size, Math.hypot(q[0], q[1]));
        p.fan.set(loop, y);
        p.fill.visible = loop.length >= 3;
        if (loop.length === 1 || (sl.kind === "circle" && sl.r < 0.02)) {
          const q = loop[0] ?? [0, 0];
          p.dots.dot(q[0], y, q[1], 0.09, c.r, c.g, c.b);
        } else if (loop.length === 2) {
          const [a, b] = loop as [[number, number], [number, number]];
          p.outline.seg(a[0], y, a[1], b[0], y, b[1], 0.026, c.r, c.g, c.b);
        } else {
          for (let i = 0; i < loop.length; i++) {
            const a = loop[i]!;
            const b = loop[(i + 1) % loop.length]!;
            p.outline.seg(a[0], y, a[1], b[0], y, b[1], 0.026, c.r, c.g, c.b);
          }
        }
        p.outline.end();
        p.dots.end();
        p.shown.fill = p.fill.visible;
        p.shown.outline = p.outline.count > 0;
        p.shown.dots = p.dotMesh.visible;
        last.sliceKind.push(
          sl.kind === "none"
            ? "none"
            : loop.length >= 3
              ? "polygon"
              : loop.length === 2
                ? "segment"
                : "point",
        );
        last.sliceSize.push(size);
      });
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of own) m.dispose();
    },
  };
};
