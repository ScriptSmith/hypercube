/**
 * The cut-away eye in three.js, through its public API. The eye is cut along the horizontal
 * plane through its axis: the lower half is solid, its cut faces show the layers like a
 * textbook section, and the upper half is a faint ghost so the whole ball still reads. Light
 * comes in from the left; the rays from the looked-at layer bend at each surface of the
 * schematic eye (paraxial, so a bundle meets at the computed focus) and their focus and blur on
 * the retina are marked.
 *
 * Units are mm, x along the axis from the corneal apex, y up, z towards the viewer. Shapes that
 * change (the lens with focus, the pupil with light, the cornea with astigmatism or a cone, the
 * globe's length) rebuild their vertices in place, so no program ever changes after the first
 * compile. Materials are basic and Lambert only, one set per part so a part can light up while
 * the rest fades back.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  FrontSide,
  NormalBlending,
  Group,
  HemisphereLight,
  Matrix4,
  LineBasicMaterial,
  LineSegments,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Raycaster,
  Scene,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  type Texture,
  CanvasTexture,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from "three";
import type { Renderer3D } from "../../core/renderer3d";
import {
  CORNEA_RADIUS,
  corneaSag,
  DISC_RADIUS,
  FOVEA_RADIUS,
  type Globe,
  globe,
  lensProfile,
  MACULA_RADIUS,
  NERVE_RADIUS,
  type P,
} from "./anatomy";
import type { PartId } from "./captions";
import type { Rect } from "./layout";
import type { Derived, EyeState } from "./model";
import { LAYERS, VERTEX_M } from "./model";
import { LE_GRAND, navarro, traceRay } from "./optics";

export interface EyeLook {
  state: EyeState;
  derived: Derived;
  part: PartId | null;
  /** Shown larger than real: the cone and the cup. */
  exaggerate: boolean;
  /** Cut away to show the inside (always, in the diagram). */
  open: boolean;
  /** Show only the chosen part, inside a faint outline of the eyeball. */
  isolate: boolean;
}

export interface EyeView {
  /** Viewport in stage CSS px. */
  setViewport(rect: Rect): void;
  setOrbit(azimuth: number, elevation: number): void;
  update(look: EyeLook, time: number): void;
  /** Draw into the viewport; the caller has set the renderer's target and scissor test. */
  draw(frameH: number): void;
  /** Every part a ray through stage point (x, y) meets, nearest first, for debugging. */
  hits(x: number, y: number): string[];
  /** The part under stage point (x, y), or null. */
  pick(x: number, y: number): PartId | null;
  /** The parts under stage point (x, y): what `pick` gives, then the ones behind it, in order. */
  pickList(x: number, y: number): PartId[];
  /** Where a part shows on the stage, CSS px, for the ghost hand. */
  where(part: PartId): { x: number; y: number } | null;
  /** 0 whole, 1 cut open; it eases between them. */
  readonly openness: number;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  dispose(): void;
}

// ---- Geometry helpers ------------------------------------------------------------------------

/** Lower half: φ from 0 (on +z) through the bottom to π (on -z). Upper ghost: π to 2π. */
const LOWER: [number, number] = [0, Math.PI];
const UPPER: [number, number] = [Math.PI, 2 * Math.PI];
const FULL: [number, number] = [0, 2 * Math.PI];

const pointAt = (x: number, rho: number, phi: number): [number, number, number] => [
  x,
  -rho * Math.sin(phi),
  rho * Math.cos(phi),
];

/** A surface of revolution about the x axis from a profile, written into `geo` (or a new one). */
const revolve = (
  profile: readonly P[],
  phis: [number, number],
  segs: number,
  geo?: BufferGeometry,
  /** Extra radius at a profile row and angle (the ciliary processes' folds). */
  ripple?: (row: number, phi: number) => number,
): BufferGeometry => {
  const rows = profile.length;
  const cols = segs + 1;
  const g = geo ?? new BufferGeometry();
  let pos = g.getAttribute("position") as BufferAttribute | undefined;
  if (!pos || pos.count !== rows * cols) {
    // A new size: free the old buffers on the GPU first (replacing attributes doesn't).
    if (pos) g.dispose();
    pos = new BufferAttribute(new Float32Array(rows * cols * 3), 3);
    g.setAttribute("position", pos);
    // u goes round the axis (0 to 1 for a full turn), v along the profile.
    const uv = new Float32Array(rows * cols * 2);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const phi = phis[0] + ((phis[1] - phis[0]) * c) / segs;
        uv[(r * cols + c) * 2] = phi / (2 * Math.PI);
        uv[(r * cols + c) * 2 + 1] = rows > 1 ? r / (rows - 1) : 0;
      }
    }
    g.setAttribute("uv", new BufferAttribute(uv, 2));
    const idx: number[] = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < segs; c++) {
        const a = r * cols + c;
        const b = a + cols;
        // Wound so normals face outwards for a profile running front to back.
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    g.setIndex(idx);
  }
  const arr = pos.array as Float32Array;
  for (let r = 0; r < rows; r++) {
    const [x, rho] = profile[r]!;
    for (let c = 0; c < cols; c++) {
      const phi = phis[0] + ((phis[1] - phis[0]) * c) / segs;
      const p = pointAt(x, rho + (ripple ? ripple(r, phi) : 0), phi);
      const i = (r * cols + c) * 3;
      arr[i] = p[0];
      arr[i + 1] = p[1];
      arr[i + 2] = p[2];
    }
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
};

/** A flat face in the cut plane (y = 0), from outlines given as [x, z] points. */
const section = (outlines: readonly (readonly P[])[], lift = 0): BufferGeometry => {
  const geos: BufferGeometry[] = [];
  const positions: number[] = [];
  for (const o of outlines) {
    if (o.length < 3) continue;
    const shape = new Shape(o.map(([x, z]) => new Vector2(x, -z)));
    const g = new ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    geos.push(g);
    const p = g.getAttribute("position") as BufferAttribute;
    const idx = g.getIndex();
    if (idx) {
      for (let i = 0; i < idx.count; i++) {
        const k = idx.getX(i);
        positions.push(p.getX(k), p.getY(k) + lift, p.getZ(k));
      }
    }
  }
  for (const g of geos) g.dispose();
  const out = new BufferGeometry();
  out.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  out.computeVertexNormals();
  out.computeBoundingSphere();
  return out;
};

/** A shell's cut faces: the band between two profiles, on both sides of the axis. */
const bandOutlines = (outer: readonly P[], inner: readonly P[]): P[][] => {
  const side = (s: number): P[] => [
    ...outer.map(([x, r]) => [x, s * r] as P),
    ...[...inner].reverse().map(([x, r]) => [x, s * r] as P),
  ];
  return [side(1), side(-1)];
};

/** A region between a profile and the axis, mirrored: a full section through a solid. */
const solidOutline = (profile: readonly P[]): P[][] => [
  [
    ...profile.map(([x, r]) => [x, r] as P),
    ...[...profile].reverse().map(([x, r]) => [x, -r] as P),
  ],
];

const replace = (mesh: Mesh, geo: BufferGeometry) => {
  mesh.geometry.dispose();
  mesh.geometry = geo;
};

// ---- Parts and materials ---------------------------------------------------------------------

interface Paint {
  mat:
    | MeshLambertMaterial
    | MeshStandardMaterial
    | MeshPhongMaterial
    | MeshBasicMaterial
    | LineBasicMaterial
    | PointsMaterial;
  color: Color;
  opacity: number;
}

const COLOURS = {
  sclera: "#ece6dc",
  scleraCut: "#f6f1ea",
  choroid: "#6a4256",
  retina: "#d99878",
  retinaCut: "#e6a98a",
  macula: "#e3bf55",
  fovea: "#b37a3a",
  disc: "#f4e2c2",
  cup: "#fffaf0",
  vessel: "#9b5866",
  cornea: "#bfe6ff",
  tear: "#8fd8ff",
  conjunctiva: "#f8dede",
  aqueous: "#9fe6ff",
  vitreous: "#a9c6ff",
  iris: "#7a5a3c",
  irisCut: "#8a6a4a",
  ciliary: "#8c5a52",
  zonule: "#efe6cf",
  lens: "#eef4ff",
  lensCut: "#e6eefa",
  angle: "#caa66c",
  nerve: "#e7ddcd",
  nerveCut: "#f2ebde",
  muscle: "#b88a80",
  ray: "#ffd23a",
  rayV: "#7fe3ff",
  focus: "#ffffff",
  glasses: "#cfe9ff",
  contact: "#9fe0ff",
  nucleus: "#b8862e",
  spoke: "#ffffff",
  drusen: "#f2e08a",
  atrophy: "#f0d8b8",
  exudate: "#f6e27a",
  dot: "#7c3d48",
  iol: "#e8f6ff",
} as const;

/**
 * The realistic look's colours: an eye as seen in a mirror and in a textbook section. Blood
 * vessels and the choroid stay muted and brown, never blood-red.
 */
const REAL_COLOURS: Partial<Record<keyof typeof COLOURS, string>> = {
  sclera: "#f2ede5",
  scleraCut: "#f7f3ec",
  choroid: "#4e3229",
  retina: "#d9967a",
  retinaCut: "#e7b29a",
  macula: "#d2a84a",
  fovea: "#94572e",
  disc: "#f2dbbd",
  cup: "#fff4e2",
  vessel: "#a7666d",
  cornea: "#eef8ff",
  iris: "#8a6a44",
  irisCut: "#6e5236",
  ciliary: "#5a3a2e",
  lens: "#f7f2e2",
  lensCut: "#f1ead6",
  nerve: "#efe6d6",
  nerveCut: "#f5eee2",
  muscle: "#b9877c",
};

export type Look = "real" | "diagram";

/** A profile moved inwards (towards the axis side of the wall) by t mm along its normals. */
const inset = (profile: readonly P[], t: number): P[] =>
  profile.map((p, i) => {
    const a = profile[Math.max(0, i - 1)]!;
    const b = profile[Math.min(profile.length - 1, i + 1)]!;
    const tx = b[0] - a[0];
    const tr = b[1] - a[1];
    const l = Math.hypot(tx, tr) || 1;
    // The wall runs from front to back; its inside is to the right of that direction.
    return [p[0] - (tr / l) * t, p[1] + (tx / l) * t] as P;
  });

/** A small seeded random stream, so textures are the same every time. */
const stream = (seed: number) => {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 100000) / 100000;
  };
};

const canvasTexture = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (g) draw(g);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  // Rows run top to bottom with the texture's v, as the drawings are laid out.
  t.flipY = false;
  return t;
};

/**
 * The iris front, unwrapped: across is the angle round the pupil, down is from the pupil's edge
 * (top) to the iris root (bottom). Radial fibres run down, the collarette is a wavy ridge about
 * a third of the way out, crypts are small dark hollows, and the rim darkens into the limbal
 * ring. A hazel-brown iris; our own drawing.
 */
const irisTexture = () =>
  canvasTexture(1024, 256, (g) => {
    const W = 1024;
    const H = 256;
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#3a2414");
    grad.addColorStop(0.06, "#5a3a20");
    grad.addColorStop(0.3, "#7a5530");
    grad.addColorStop(0.36, "#a07c48");
    grad.addColorStop(0.7, "#8a7146");
    grad.addColorStop(0.9, "#6a5636");
    grad.addColorStop(1, "#2e241c");
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    const rnd = stream(31);
    // Radial fibres.
    for (let i = 0; i < 700; i++) {
      const x = rnd() * W;
      const light = rnd() < 0.5;
      g.strokeStyle = light
        ? `rgba(220,190,130,${0.08 + rnd() * 0.12})`
        : `rgba(40,25,12,${0.1 + rnd() * 0.15})`;
      g.lineWidth = 1 + rnd() * 2;
      g.beginPath();
      const y0 = rnd() * H * 0.3;
      g.moveTo(x, y0);
      g.bezierCurveTo(
        x + (rnd() - 0.5) * 8,
        H * 0.5,
        x + (rnd() - 0.5) * 10,
        H * 0.7,
        x + (rnd() - 0.5) * 6,
        H * (0.85 + rnd() * 0.15),
      );
      g.stroke();
    }
    // The collarette: a wavy, lighter ridge.
    g.strokeStyle = "rgba(200,165,105,0.75)";
    g.lineWidth = 5;
    g.beginPath();
    for (let x = 0; x <= W; x += 4) {
      const y = H * 0.33 + Math.sin(x * 0.09) * 5 + Math.sin(x * 0.023) * 6;
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    // Crypts.
    for (let i = 0; i < 46; i++) {
      const x = rnd() * W;
      const y = H * (0.38 + rnd() * 0.35);
      g.fillStyle = `rgba(35,22,12,${0.35 + rnd() * 0.3})`;
      g.beginPath();
      g.ellipse(x, y, 3 + rnd() * 5, 7 + rnd() * 12, 0, 0, Math.PI * 2);
      g.fill();
    }
    // A pigment ruff at the pupil's edge.
    g.fillStyle = "rgba(25,15,8,0.9)";
    g.fillRect(0, 0, W, 5);
  });

/**
 * An eye muscle, unwrapped: across is round the bundle, down is along it from the insertion.
 * The top fifth is pale, glistening tendon; below, the muscle's fibres run lengthwise in a muted
 * rose-brown (never blood-red).
 */
const muscleTexture = () =>
  canvasTexture(256, 512, (g) => {
    const W = 256;
    const H = 512;
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#efe7d8");
    grad.addColorStop(0.16, "#e2d2c0");
    grad.addColorStop(0.24, "#b47a6c");
    grad.addColorStop(0.7, "#a9705f");
    grad.addColorStop(1, "#9c6658");
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    const rnd = stream(53);
    for (let i = 0; i < 260; i++) {
      const x = rnd() * W;
      const tendon = rnd() < 0.25;
      const y0 = tendon ? rnd() * H * 0.18 : H * (0.2 + rnd() * 0.3);
      const y1 = tendon ? y0 + H * 0.05 : y0 + H * (0.2 + rnd() * 0.5);
      g.strokeStyle = tendon
        ? `rgba(255,255,255,${0.2 + rnd() * 0.3})`
        : rnd() < 0.5
          ? `rgba(80,40,35,${0.12 + rnd() * 0.15})`
          : `rgba(220,170,150,${0.1 + rnd() * 0.12})`;
      g.lineWidth = 1 + rnd() * 2;
      g.beginPath();
      g.moveTo(x, y0);
      g.lineTo(x + (rnd() - 0.5) * 4, y1);
      g.stroke();
    }
  });

/** The optic nerve's sheath, unwrapped: pale, with fine lengthwise fibres. */
const nerveTexture = () =>
  canvasTexture(256, 128, (g) => {
    g.fillStyle = "#eee5d4";
    g.fillRect(0, 0, 256, 128);
    const rnd = stream(91);
    for (let i = 0; i < 120; i++) {
      const x = rnd() * 256;
      g.strokeStyle = rnd() < 0.5 ? "rgba(200,185,160,0.35)" : "rgba(255,252,245,0.4)";
      g.lineWidth = 1 + rnd();
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + (rnd() - 0.5) * 6, 128);
      g.stroke();
    }
  });

/**
 * The sclera's outside, unwrapped: across is round the axis, down from the limbus (top) to the
 * back. Soft white with a faint grey ring at the limbus and a few faint, muted vessels near the
 * front, never blood-red.
 */
const scleraTexture = () =>
  canvasTexture(1024, 256, (g) => {
    const W = 1024;
    const H = 256;
    g.fillStyle = "#f3eee6";
    g.fillRect(0, 0, W, H);
    const ring = g.createLinearGradient(0, 0, 0, 14);
    ring.addColorStop(0, "rgba(120,128,145,0.55)");
    ring.addColorStop(1, "rgba(120,128,145,0)");
    g.fillStyle = ring;
    g.fillRect(0, 0, W, 14);
    const rnd = stream(77);
    for (let i = 0; i < 26; i++) {
      let x = rnd() * W;
      let y = H * (0.18 + rnd() * 0.12);
      g.strokeStyle = `rgba(176,104,108,${0.12 + rnd() * 0.1})`;
      g.lineWidth = 1 + rnd() * 1.5;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += (rnd() - 0.5) * 18;
        y -= 4 + rnd() * 7;
        g.lineTo(x, Math.max(6, y));
      }
      g.stroke();
    }
    // A slight warmth towards the back.
    const back = g.createLinearGradient(0, H * 0.4, 0, H);
    back.addColorStop(0, "rgba(230,215,195,0)");
    back.addColorStop(1, "rgba(230,215,195,0.5)");
    g.fillStyle = back;
    g.fillRect(0, 0, W, H);
  });

/** The layer the chosen part and the outline go on, so "Only this part" draws just them. */
const ISOLATE_LAYER = 1;
const ACCENT = new Color("#ffd23a");

const RAY_MAX = 24;
const RAY_SEG = 12;
const FLOW = 70;

export const createEyeView = (
  r3d: Renderer3D,
  startLength: number,
  look: Look = "diagram",
): EyeView => {
  const real = look === "real";
  const C: Record<keyof typeof COLOURS, string> = real ? { ...COLOURS, ...REAL_COLOURS } : COLOURS;
  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 1, 400);
  const root = new Group();
  scene.add(root);
  const hemi = new HemisphereLight(0xffffff, 0x3a4660, real ? 1.1 : 1.6);
  hemi.layers.enableAll();
  scene.add(hemi);
  const sun = new DirectionalLight(0xffffff, real ? 2.4 : 1.8);
  sun.position.set(-20, 40, 30);
  sun.layers.enableAll();
  scene.add(sun);
  const fill = new DirectionalLight(0xbfd4ff, 0.6);
  fill.position.set(30, 10, -20);
  fill.layers.enableAll();
  scene.add(fill);
  if (real) {
    // A window-like light in front and above, for the catchlight on the wet cornea.
    const catchlight = new DirectionalLight(0xffffff, 1.6);
    catchlight.position.set(-40, 22, -14);
    catchlight.layers.enableAll();
    scene.add(catchlight);
  }

  const parts = new Map<PartId, { objects: Object3D[]; paints: Paint[] }>();
  const owned: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(x: T): T => {
    owned.push(x);
    return x;
  };
  const addPart = (id: PartId, obj: Object3D, paint: Paint[]) => {
    let p = parts.get(id);
    if (!p) {
      p = { objects: [], paints: [] };
      parts.set(id, p);
    }
    obj.userData.part = id;
    p.objects.push(obj);
    p.paints.push(...paint);
  };
  /**
   * A lit surface: Lambert in the diagram; in the realistic look a standard (physically based)
   * material, matte for tissue and glossy where it is wet.
   */
  const lambert = (
    color: string,
    opts: {
      opacity?: number;
      side?: "double";
      roughness?: number;
      map?: Texture;
      fade?: boolean;
    } = {},
  ): Paint => {
    const transparent = opts.fade === true || (opts.opacity !== undefined && opts.opacity < 1);
    const common = {
      color,
      transparent,
      opacity: opts.opacity ?? 1,
      depthWrite: !transparent || opts.fade === true,
      side: opts.side === "double" || transparent ? DoubleSide : FrontSide,
      ...(opts.map ? { map: opts.map } : {}),
    };
    const mat = own(
      real
        ? new MeshStandardMaterial({ ...common, roughness: opts.roughness ?? 0.6, metalness: 0 })
        : new MeshLambertMaterial(common),
    );
    return { mat, color: new Color(color), opacity: opts.opacity ?? 1 };
  };
  const basic = (
    color: string,
    opacity = 1,
    extra: { additive?: boolean; depthTest?: boolean } = {},
  ): Paint => {
    const transparent = opacity < 1 || extra.additive === true;
    const mat = own(
      new MeshBasicMaterial({
        color,
        transparent,
        opacity,
        side: DoubleSide,
        depthWrite: !transparent,
        depthTest: extra.depthTest ?? true,
        blending: extra.additive ? AdditiveBlending : NormalBlending,
      }),
    );
    return { mat, color: new Color(color), opacity };
  };
  const mesh = (geo: BufferGeometry, paint: Paint, order = 0): Mesh => {
    const m = new Mesh(own(geo), paint.mat as Material);
    m.renderOrder = order;
    root.add(m);
    return m;
  };

  let g: Globe = globe(startLength);
  const irisTex = real ? own(irisTexture()) : null;
  const scleraTex = real ? own(scleraTexture()) : null;
  /** Things drawn only while the eye is cut open (cut faces), and the realistic upper half. */
  const cuts: Object3D[] = [];
  const uppers: { obj: Object3D; paint: Paint; ghost: number }[] = [];

  // ---- Globe shells: sclera, choroid, retina (lower half, cut faces, ghost upper) ----------
  const scleraPaint = real
    ? lambert("#ffffff", { roughness: 0.55, map: scleraTex! })
    : lambert(C.sclera);
  const scleraCutPaint = basic(C.scleraCut);
  // The upper half: a faint ghost in the diagram; in the realistic look solid while the eye is
  // whole, fading to a ghost as it opens.
  const ghostPaint = real
    ? lambert("#ffffff", { roughness: 0.55, map: scleraTex!, fade: true })
    : lambert(C.sclera, { opacity: 0.1 });
  const choroidPaint = lambert(C.choroid, { side: "double" });
  const choroidCutPaint = basic(C.choroid);
  const retinaPaint = lambert(C.retina, { side: "double" });
  const retinaCutPaint = basic(C.retinaCut);
  const scleraOuter = mesh(revolve(g.sclera.outer, LOWER, 48), scleraPaint);
  const scleraGhost = mesh(revolve(g.sclera.outer, UPPER, 48), ghostPaint, 5);
  const scleraCut = mesh(section(bandOutlines(g.sclera.outer, g.sclera.inner)), scleraCutPaint);
  const choroidIn = mesh(revolve(g.choroid.inner, LOWER, 48), choroidPaint);
  const choroidCut = mesh(
    section(bandOutlines(g.choroid.outer, g.choroid.inner), 0.002),
    choroidCutPaint,
  );
  const retinaIn = mesh(revolve(g.retina.inner, LOWER, 48), retinaPaint);
  const retinaCut = mesh(
    section(bandOutlines(g.retina.outer, g.retina.inner), 0.004),
    retinaCutPaint,
  );
  addPart("sclera", scleraOuter, [scleraPaint]);
  addPart("sclera", scleraGhost, [ghostPaint]);
  if (real) uppers.push({ obj: scleraGhost, paint: ghostPaint, ghost: 0.1 });
  else scleraGhost.userData.seeThrough = true;
  addPart("sclera", scleraCut, [scleraCutPaint]);
  addPart("choroid", choroidIn, [choroidPaint]);
  addPart("choroid", choroidCut, [choroidCutPaint]);
  addPart("retina", retinaIn, [retinaPaint]);
  addPart("retina", retinaCut, [retinaCutPaint]);
  cuts.push(scleraCut, choroidCut, retinaCut);
  // The realistic section also shows the pigment epithelium: a thin dark band outside the retina.
  // A light wire outline of the eyeball, seen only while one part shows on its own (layer 1).
  const outlineMat = own(
    new LineBasicMaterial({
      color: "#b8c8e8",
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    }),
  );
  const outlineGeo = own(new BufferGeometry());
  const outline = new LineSegments(outlineGeo, outlineMat);
  outline.renderOrder = 7;
  outline.layers.set(ISOLATE_LAYER);
  root.add(outline);
  const buildOutline = () => {
    const prof = g.sclera.outer;
    const pts: number[] = [];
    for (let k = 0; k < 12; k++) {
      const phi = (k / 12) * Math.PI * 2;
      for (let i = 0; i < prof.length - 1; i++) {
        pts.push(
          ...pointAt(prof[i]![0], prof[i]![1], phi),
          ...pointAt(prof[i + 1]![0], prof[i + 1]![1], phi),
        );
      }
    }
    for (let i = 4; i < prof.length - 2; i += 8) {
      const [x, r] = prof[i]!;
      for (let c = 0; c < 64; c++) {
        pts.push(
          ...pointAt(x, r, (c / 64) * Math.PI * 2),
          ...pointAt(x, r, ((c + 1) / 64) * Math.PI * 2),
        );
      }
    }
    outlineGeo.dispose();
    outlineGeo.setAttribute("position", new BufferAttribute(new Float32Array(pts), 3));
    outlineGeo.computeBoundingSphere();
  };
  buildOutline();
  const rpePaint = basic("#3a2419");
  const rpeCut = mesh(
    section(bandOutlines(g.retina.outer, inset(g.retina.outer, 0.06)), 0.006),
    rpePaint,
  );
  rpeCut.visible = real;
  if (real) {
    addPart("retina", rpeCut, [rpePaint]);
    cuts.push(rpeCut);
  }

  // ---- Back of the eye: macula, fovea, disc, vessels, and condition marks -------------------
  const back = new Group();
  root.add(back);
  /** A half disc lying on the inner retina at the pole or the disc, facing into the eye. */
  const patch = (radius: number, paint: Paint, lift: number, segs = 32): Mesh => {
    const geo = own(new CircleGeometry(radius, segs, 0, Math.PI));
    const m = new Mesh(geo, paint.mat as Material);
    m.userData.lift = lift;
    back.add(m);
    return m;
  };
  const maculaPaint = basic(C.macula, 0.75);
  const foveaPaint = basic(C.fovea, 0.9);
  const discPaint = basic(C.disc);
  const cupPaint = basic(C.cup);
  const atrophyPaint = basic(C.atrophy, 0.9);
  const macula = patch(MACULA_RADIUS, maculaPaint, 0.03);
  const atrophy = patch(1, atrophyPaint, 0.045);
  const fovea = patch(FOVEA_RADIUS, foveaPaint, 0.06);
  const disc = patch(DISC_RADIUS, discPaint, 0.03);
  const cup = patch(DISC_RADIUS, cupPaint, 0.05);
  addPart("macula", macula, [maculaPaint]);
  addPart("macula", atrophy, [atrophyPaint]);
  addPart("fovea", fovea, [foveaPaint]);
  addPart("disc", disc, [discPaint]);
  addPart("disc", cup, [cupPaint]);

  // Small spheres for drusen, leaky dots and flecks; a pool reused as conditions change.
  const dotGeo = own(new SphereGeometry(1, 8, 6));
  const drusenPaint = basic(C.drusen);
  const dotPaint = basic(C.dot);
  const exudatePaint = basic(C.exudate);
  const DOTS = 40;
  const dots: Mesh[] = [];
  for (let i = 0; i < DOTS; i++) {
    const m = new Mesh(dotGeo, drusenPaint.mat as Material);
    m.visible = false;
    back.add(m);
    dots.push(m);
  }
  addPart("macula", new Group(), [drusenPaint]);
  addPart("retina", new Group(), [dotPaint, exudatePaint]);

  // Retinal vessels: ribbons on the lower half of the inner retina, from the disc round the
  // macula, plus a tuft of fragile new vessels near the disc in diabetic retinopathy.
  const vesselPaint = basic(C.vessel, 0.95);
  const vesselGeo = own(new BufferGeometry());
  const vessels = new Mesh(vesselGeo, vesselPaint.mat as Material);
  root.add(vessels);
  addPart("retina", vessels, [vesselPaint]);

  // ---- Optic nerve ---------------------------------------------------------------------------
  const nervePaint = real
    ? lambert("#ffffff", { roughness: 0.6, map: own(nerveTexture()) })
    : lambert(C.nerve);
  // Realistic: the cut shows the nerve's core inside its paler sheath.
  const nerveCutPaint = basic(real ? "#d8d3cb" : C.nerveCut);
  const nerveGhostPaint = real
    ? lambert(C.nerve, { fade: true })
    : lambert(C.nerve, { opacity: 0.12 });
  const nerveGroup = new Group();
  root.add(nerveGroup);
  const NERVE_LEN = 9;
  const nerveProfile: P[] = [
    [0, NERVE_RADIUS * 0.85],
    [NERVE_LEN * 0.3, NERVE_RADIUS],
    [NERVE_LEN, NERVE_RADIUS],
  ];
  const nerveLower = new Mesh(own(revolve(nerveProfile, LOWER, 16)), nervePaint.mat as Material);
  const nerveUpper = new Mesh(
    own(revolve(nerveProfile, UPPER, 16)),
    nerveGhostPaint.mat as Material,
  );
  const nerveCut = new Mesh(
    own(section(solidOutline(nerveProfile), 0.01)),
    nerveCutPaint.mat as Material,
  );
  nerveUpper.renderOrder = 5;
  nerveGroup.add(nerveLower, nerveUpper, nerveCut);
  addPart("nerve", nerveLower, [nervePaint]);
  addPart("nerve", nerveUpper, [nerveGhostPaint]);
  if (real) uppers.push({ obj: nerveUpper, paint: nerveGhostPaint, ghost: 0.12 });
  else nerveUpper.userData.seeThrough = true;
  addPart("nerve", nerveCut, [nerveCutPaint]);
  cuts.push(nerveCut);
  if (real) {
    const corePaint = basic(C.nerveCut);
    const core = new Mesh(
      own(section(solidOutline(nerveProfile.map(([x, r]) => [x, r * 0.72] as P)), 0.02)),
      corePaint.mat as Material,
    );
    nerveGroup.add(core);
    addPart("nerve", core, [corePaint]);
    cuts.push(core);
  }

  // ---- Cornea, tear film, conjunctiva --------------------------------------------------------
  const CR = 10;
  const CA = 48;
  const corneaGrid = (geo: BufferGeometry | null, surf: (rho: number, phi: number) => number) => {
    const rows = CR + 1;
    const cols = CA + 1;
    const g2 = geo ?? new BufferGeometry();
    let pos = g2.getAttribute("position") as BufferAttribute | undefined;
    if (!pos) {
      pos = new BufferAttribute(new Float32Array(rows * cols * 3), 3);
      g2.setAttribute("position", pos);
      const idx: number[] = [];
      for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < CA; c++) {
          const a = r * cols + c;
          // Wound so the cornea's front faces forwards (towards -x).
          idx.push(a, a + 1, a + cols, a + cols, a + 1, a + cols + 1);
        }
      }
      g2.setIndex(idx);
    }
    const arr = pos.array as Float32Array;
    for (let r = 0; r < rows; r++) {
      const rho = (CORNEA_RADIUS * r) / CR;
      for (let c = 0; c < cols; c++) {
        const phi = (2 * Math.PI * c) / CA;
        const p = pointAt(surf(rho, phi), rho, phi);
        const i = (r * cols + c) * 3;
        arr[i] = p[0];
        arr[i + 1] = p[1];
        arr[i + 2] = p[2];
      }
    }
    pos.needsUpdate = true;
    g2.computeVertexNormals();
    g2.computeBoundingSphere();
    return g2;
  };
  // Realistic: a clear, wet cornea; its highlight comes from a gloss layer below.
  const corneaPaint = real
    ? lambert(C.cornea, { opacity: 0.1, roughness: 0.05 })
    : lambert(C.cornea, { opacity: 0.3 });
  const corneaCutPaint = basic(C.cornea, 0.75);
  const tearPaint = lambert(C.tear, { opacity: 0.08 });
  const conjPaint = lambert(C.conjunctiva, { opacity: 0.12 });
  const corneaFront = mesh(new BufferGeometry(), corneaPaint, 3);
  const corneaBack = mesh(new BufferGeometry(), corneaPaint, 3);
  const corneaCut = mesh(new BufferGeometry(), corneaCutPaint, 1);
  const tear = mesh(new BufferGeometry(), tearPaint, 4);
  addPart("cornea", corneaFront, [corneaPaint]);
  addPart("cornea", corneaBack, []);
  addPart("cornea", corneaCut, [corneaCutPaint]);
  addPart("tearFilm", tear, [tearPaint]);
  cuts.push(corneaCut);
  if (real) {
    // A gloss layer on the cornea's front: black, so it adds only its specular highlights.
    const gloss = new Mesh(
      corneaFront.geometry,
      own(
        new MeshPhongMaterial({
          color: 0x000000,
          specular: 0x9a9a9a,
          shininess: 700,
          transparent: true,
          blending: AdditiveBlending,
          depthWrite: false,
        }),
      ),
    );
    gloss.renderOrder = 6;
    root.add(gloss);
    addPart("cornea", gloss, []);
  }
  const conj = mesh(new BufferGeometry(), conjPaint, 4);
  addPart("conjunctiva", conj, [conjPaint]);

  // ---- Iris, pupil, angle, ciliary body, zonules, aqueous ------------------------------------
  const irisPaint = lambert(C.iris, { side: "double" });
  const irisCutPaint = basic(C.irisCut);
  const iris = mesh(new BufferGeometry(), irisPaint);
  const irisCut = mesh(new BufferGeometry(), irisCutPaint);
  addPart("iris", iris, [irisPaint]);
  addPart("iris", irisCut, [irisCutPaint]);
  cuts.push(irisCut);
  // Realistic: the iris's patterned front, round the whole disc while the eye is whole.
  const irisFacePaint = lambert("#ffffff", {
    side: "double",
    roughness: 0.7,
    ...(irisTex ? { map: irisTex } : {}),
  });
  const irisFace = mesh(new BufferGeometry(), irisFacePaint, 1);
  const irisFaceUp = mesh(new BufferGeometry(), irisFacePaint, 1);
  irisFace.visible = real;
  irisFaceUp.visible = real;
  if (real) {
    addPart("iris", irisFace, [irisFacePaint]);
    addPart("iris", irisFaceUp, []);
    irisFaceUp.userData.upper = true;
  }
  const pupilPaint = basic("#05070d", 0.0);
  const pupilRing = mesh(new BufferGeometry(), pupilPaint, 2);
  addPart("pupil", pupilRing, [pupilPaint]);
  // The pupil looks black because the inside of the eye soaks up the light; a black disc behind
  // it does that while the realistic eye is whole.
  const pupilDarkPaint = basic("#020203");
  const pupilDark = mesh(new BufferGeometry(), pupilDarkPaint, 1);
  pupilDark.visible = false;
  if (real) addPart("pupil", pupilDark, []);
  const anglePaint = lambert(C.angle, { side: "double" });
  const angle = mesh(new BufferGeometry(), anglePaint);
  addPart("angle", angle, [anglePaint]);
  const ciliaryPaint = lambert(C.ciliary, { side: "double" });
  const ciliaryCutPaint = basic(C.ciliary);
  const ciliary = mesh(new BufferGeometry(), ciliaryPaint);
  const ciliaryCut = mesh(new BufferGeometry(), ciliaryCutPaint);
  cuts.push(ciliaryCut);
  addPart("ciliary", ciliary, [ciliaryPaint]);
  addPart("ciliary", ciliaryCut, [ciliaryCutPaint]);
  const zonulePaint: Paint = {
    mat: own(new LineBasicMaterial({ color: C.zonule, transparent: true, opacity: 0.55 })),
    color: new Color(C.zonule),
    opacity: 0.55,
  };
  const ZONULES = 36;
  const zonuleGeo = own(new BufferGeometry());
  zonuleGeo.setAttribute("position", new BufferAttribute(new Float32Array(ZONULES * 4 * 3), 3));
  const zonules = new LineSegments(zonuleGeo, zonulePaint.mat as Material);
  root.add(zonules);
  addPart("zonules", zonules, [zonulePaint]);
  const aqueousPaint = basic(C.aqueous, 0.14);
  const aqueous = mesh(new BufferGeometry(), aqueousPaint, 2);
  cuts.push(aqueous);
  addPart("aqueous", aqueous, [aqueousPaint]);
  const flowPaint: Paint = {
    mat: own(
      new PointsMaterial({
        color: "#c8f4ff",
        size: 0.32,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
      }),
    ),
    color: new Color("#c8f4ff"),
    opacity: 0,
  };
  const flowGeo = own(new BufferGeometry());
  flowGeo.setAttribute("position", new BufferAttribute(new Float32Array(FLOW * 3), 3));
  const flow = new Points(flowGeo, flowPaint.mat as Material);
  flow.renderOrder = 6;
  root.add(flow);
  addPart("aqueous", flow, [flowPaint]);

  // ---- Lens, cataract, artificial lens -------------------------------------------------------
  const lensPaint = lambert(C.lens, { opacity: 0.32 });
  const lensCutPaint = basic(C.lensCut, 0.55);
  const lens = mesh(new BufferGeometry(), lensPaint, 2);
  const lensCut = mesh(new BufferGeometry(), lensCutPaint, 1);
  cuts.push(lensCut);
  addPart("lens", lens, [lensPaint]);
  addPart("lens", lensCut, [lensCutPaint]);
  const nucleusPaint = basic(C.nucleus, 0);
  const nucleus = mesh(new BufferGeometry(), nucleusPaint, 2);
  const spokePaint = basic(C.spoke, 0);
  const spokes = mesh(new BufferGeometry(), spokePaint, 2);
  const pscPaint = basic("#f1efe8", 0);
  const psc = mesh(own(new CircleGeometry(1, 24)), pscPaint, 2);
  psc.rotation.y = Math.PI / 2;
  addPart("lens", nucleus, [nucleusPaint]);
  addPart("lens", spokes, [spokePaint]);
  addPart("lens", psc, [pscPaint]);
  const iolPaint = lambert(C.iol, { opacity: 0.55 });
  const iol = mesh(new BufferGeometry(), iolPaint, 2);
  const hapticPaint: Paint = {
    mat: own(new LineBasicMaterial({ color: "#7fd0ff", transparent: true, opacity: 0.9 })),
    color: new Color("#7fd0ff"),
    opacity: 0.9,
  };
  const hapticGeo = own(new BufferGeometry());
  const haptics = new LineSegments(hapticGeo, hapticPaint.mat as Material);
  root.add(haptics);
  addPart("lens", iol, [iolPaint]);
  addPart("lens", haptics, [hapticPaint]);

  // ---- Vitreous face -------------------------------------------------------------------------
  const vitreousPaint = basic(C.vitreous, 0.1);
  const vitreous = mesh(new BufferGeometry(), vitreousPaint, 2);
  cuts.push(vitreous);
  addPart("vitreous", vitreous, [vitreousPaint]);

  // ---- Eye muscles ---------------------------------------------------------------------------
  const muscleTex = real ? own(muscleTexture()) : null;
  const musclePaint = real
    ? lambert("#ffffff", { side: "double", roughness: 0.45, map: muscleTex! })
    : lambert(C.muscle, { side: "double" });
  const muscleGhostPaint = lambert(C.muscle, { opacity: 0.14 });
  const muscleMeshes: { mesh: Mesh; spec: MuscleSpec }[] = [];
  interface MuscleSpec {
    /** Distance of the insertion behind the limbus along the wall, mm (EyeWiki). */
    insert: number;
    phi: number;
    width: number;
    /** An oblique band: how far round it turns along its length, radians. */
    twist: number;
    ghost: boolean;
    /**
     * Realistic look: where the muscle runs from (the tendon ring behind the eye for the four
     * recti; the trochlea and the orbit floor, at the front on the nose side, for the obliques),
     * how wide its belly is (half, mm) and how much of its length is tendon.
     */
    origin: [number, number, number];
    belly: number;
    tendon: number;
    /** An oblique wraps round the globe through this azimuth before leaving it. */
    via?: number;
    /** The superior oblique turns at its pulley and runs back towards the tendon ring. */
    turn?: boolean;
  }
  // The tendon ring sits behind the eye, a little to the nose side (EyeWiki).
  const RING: [number, number, number] = [startLength + 20, 0, -3];
  const MUSCLES: MuscleSpec[] = [
    {
      insert: 6.5,
      phi: Math.PI / 2,
      width: 0.8,
      twist: 0,
      ghost: false,
      origin: RING,
      belly: 4.6,
      tendon: 0.18,
    },
    {
      insert: 6.9,
      phi: 0.02,
      width: 0.8,
      twist: 0,
      ghost: false,
      origin: RING,
      belly: 4.6,
      tendon: 0.18,
    },
    {
      insert: 5.5,
      phi: Math.PI - 0.02,
      width: 0.8,
      twist: 0,
      ghost: false,
      origin: RING,
      belly: 4.8,
      tendon: 0.16,
    },
    {
      insert: 7.7,
      phi: (3 * Math.PI) / 2,
      width: 0.8,
      twist: 0,
      ghost: true,
      origin: RING,
      belly: 4.6,
      tendon: 0.18,
    },
    // Inferior oblique: from the orbit floor at the front on the nose side, under the eye.
    {
      insert: 14,
      phi: 0.35,
      width: 0.6,
      twist: 1.0,
      ghost: false,
      origin: [2.5, -11.5, -12.5],
      belly: 2.4,
      tendon: 0.12,
      via: Math.PI / 2 + 0.35,
    },
    // Superior oblique: its tendon runs forward over the eye to the trochlea, near the nose.
    {
      insert: 14,
      phi: 2 * Math.PI - 0.35,
      width: 0.6,
      twist: -1.0,
      ghost: true,
      origin: [1.5, 11.5, -12.5],
      belly: 1.6,
      tendon: 0.5,
      via: (3 * Math.PI) / 2 - 0.25,
      turn: true,
    },
  ];
  for (const spec of MUSCLES) {
    const paint = spec.ghost && !real ? muscleGhostPaint : musclePaint;
    const m = mesh(new BufferGeometry(), paint, spec.ghost && !real ? 5 : 0);
    muscleMeshes.push({ mesh: m, spec });
    addPart("muscles", m, []);
    if (spec.ghost) {
      if (real) m.userData.upper = true;
      else m.userData.seeThrough = true;
    }
  }
  parts.get("muscles")!.paints.push(musclePaint, muscleGhostPaint);

  // ---- Corrections in front of the eye -------------------------------------------------------
  const glassesPaint = lambert(C.glasses, { opacity: 0.32 });
  const glasses = mesh(new BufferGeometry(), glassesPaint, 4);
  const glassesCut = mesh(new BufferGeometry(), basic(C.glasses, 0.5), 4);
  cuts.push(glassesCut);
  const contactPaint = lambert(C.contact, { opacity: 0.45 });
  const contact = mesh(new BufferGeometry(), contactPaint, 4);

  // ---- Rays, focus marks ---------------------------------------------------------------------
  const rays = new Group();
  root.add(rays);
  const rayPaint = basic(C.ray, 0.9, { additive: true, depthTest: false });
  const rayVPaint = basic(C.rayV, 0.85, { additive: true, depthTest: false });
  const rayGhostPaint = basic(C.ray, 0.25, { additive: true, depthTest: false });
  const ribbon = (paint: Paint) => {
    const geo = own(new BufferGeometry());
    geo.setAttribute(
      "position",
      new BufferAttribute(new Float32Array(RAY_MAX * RAY_SEG * 6 * 3), 3),
    );
    const m = new Mesh(geo, paint.mat as Material);
    m.renderOrder = 10;
    m.frustumCulled = false;
    rays.add(m);
    return m;
  };
  const raysH = ribbon(rayPaint);
  const raysV = ribbon(rayVPaint);
  const raysGhost = ribbon(rayGhostPaint);
  const dotMark = (color: string, r: number) => {
    const paint = basic(color, 0.95, { depthTest: false });
    const m = new Mesh(own(new SphereGeometry(r, 16, 12)), paint.mat as Material);
    m.renderOrder = 11;
    rays.add(m);
    return m;
  };
  const focusH = dotMark(C.focus, 0.32);
  const focusV = dotMark(C.rayV, 0.28);
  const blurMark = ribbon(basic("#ffffff", 0.95, { additive: true, depthTest: false }));

  // Ray polylines (world points) waiting to become ribbons each frame.
  const lines: { pts: Vector3[]; which: 0 | 1 | 2 }[] = [];

  // ---- State-driven rebuilds -----------------------------------------------------------------

  let lastKey = "";
  let lastLength = startLength;
  let corneaKey = "";
  let lensKey = "";
  let irisKey = "";
  let condKey = "";
  let rect: Rect = { x: 0, y: 0, width: 1, height: 1 };
  let openness = real ? 0 : 1;
  let openTarget = openness;
  let lastT = 0;
  let azimuth = 0;
  let elevation = 50;
  let frontX = 0;
  let lensFront = LE_GRAND.t1 + LE_GRAND.t2;
  let lensEq: P = [6, 4.5];
  let pupilR = 1.5;

  const rebuildGlobe = (L: number) => {
    g = globe(L);
    revolve(g.sclera.outer, LOWER, 48, scleraOuter.geometry);
    revolve(g.sclera.outer, UPPER, 48, scleraGhost.geometry);
    replace(scleraCut, section(bandOutlines(g.sclera.outer, g.sclera.inner)));
    revolve(g.choroid.inner, LOWER, 48, choroidIn.geometry);
    replace(choroidCut, section(bandOutlines(g.choroid.outer, g.choroid.inner), 0.002));
    revolve(g.retina.inner, LOWER, 48, retinaIn.geometry);
    replace(retinaCut, section(bandOutlines(g.retina.outer, g.retina.inner), 0.004));
    replace(rpeCut, section(bandOutlines(g.retina.outer, inset(g.retina.outer, 0.06)), 0.006));
    buildOutline();
    // The nerve leaves at the disc, on the nose side (-z).
    const [nx, nr] = g.nerve.at;
    const [ax, ar] = g.nerve.normal;
    nerveGroup.position.set(nx, 0, -nr);
    const dir = new Vector3(ax, 0, -ar).normalize();
    nerveGroup.quaternion.setFromUnitVectors(new Vector3(1, 0, 0), dir);
    for (const m of muscleMeshes) buildMuscle(m.mesh, m.spec);
    placeBack();
  };

  /** Place a half disc on the inner retina at `at` (x, z) with inward normal (nx, nz). */
  const placeOn = (m: Mesh, at: [number, number], normal: [number, number], lift: number) => {
    const n = new Vector3(normal[0], 0, normal[1]).normalize();
    m.position.set(at[0] + n.x * lift, 0, at[1] + n.z * lift);
    // The circle lies in its XY plane facing +z; turn +z to the inward normal and keep its
    // straight edge (along x) in the cut plane, the half below it.
    const yAxis = new Vector3(0, -1, 0);
    const xAxis = new Vector3().crossVectors(yAxis, n).normalize();
    m.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(xAxis, yAxis, n));
  };

  const placeBack = () => {
    const pole: [number, number] = [g.L, 0];
    const inward: [number, number] = [-1, 0];
    placeOn(macula, pole, inward, macula.userData.lift as number);
    placeOn(atrophy, pole, inward, atrophy.userData.lift as number);
    placeOn(fovea, pole, inward, fovea.userData.lift as number);
    const d: [number, number] = [g.disc.at[0], -g.disc.at[1]];
    const dn: [number, number] = [g.disc.normal[0], -g.disc.normal[1]];
    placeOn(disc, d, dn, disc.userData.lift as number);
    placeOn(cup, d, dn, cup.userData.lift as number);
    buildVessels();
  };

  /** A point on the inner retina of the lower half, by angle from the pole and azimuth φ. */
  const onRetina = (fromPole: number, phi: number, lift = 0.05): Vector3 => {
    const inner = g.retina.inner;
    let i = inner.length - 1;
    let acc = 0;
    while (i > 0 && acc < fromPole) {
      const a = inner[i]!;
      const b = inner[i - 1]!;
      acc += Math.hypot(a[0] - b[0], a[1] - b[1]);
      i--;
    }
    const [x, rho] = inner[i]!;
    const p = pointAt(x - lift, Math.max(0, rho - lift), phi);
    return new Vector3(p[0], p[1], p[2]);
  };

  const vesselState = { dr: 0, newVessels: 0 };
  const buildVessels = () => {
    const pts: number[] = [];
    const strip = (path: Vector3[], width: number) => {
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i]!;
        const b = path[i + 1]!;
        const along = new Vector3().subVectors(b, a).normalize();
        const out = new Vector3(a.x - g.L * 0.6, a.y, a.z).normalize();
        const side = new Vector3()
          .crossVectors(along, out)
          .normalize()
          .multiplyScalar(width / 2);
        const a1 = a.clone().add(side);
        const a2 = a.clone().sub(side);
        const b1 = b.clone().add(side);
        const b2 = b.clone().sub(side);
        pts.push(a1.x, a1.y, a1.z, a2.x, a2.y, a2.z, b1.x, b1.y, b1.z);
        pts.push(a2.x, a2.y, a2.z, b2.x, b2.y, b2.z, b1.x, b1.y, b1.z);
      }
    };
    // Disc centre in (fromPole, φ): on the nose side, φ = π.
    const dPole = 4.3;
    // Lower arcades: from the disc, down and round the macula towards the far side.
    for (const [spread, w] of [
      [1, 0.16],
      [0.62, 0.11],
    ] as const) {
      const path: Vector3[] = [];
      for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        const from = dPole * (1 - t) + 3.6 * spread * Math.sin(t * Math.PI) + t * 2.5;
        const phi = Math.PI - t * (Math.PI * 0.55 * spread + 0.25);
        path.push(onRetina(Math.max(0.2, from), phi, 0.06));
      }
      strip(path, w);
    }
    // A branch straight down from the disc.
    const down: Vector3[] = [];
    for (let i = 0; i <= 12; i++)
      down.push(onRetina(dPole + i * 0.5, Math.PI - (i / 12) * 0.9, 0.06));
    strip(down, 0.12);
    if (vesselState.newVessels > 0) {
      // A tuft of fine, wandering new vessels beside the disc.
      for (let k = 0; k < 6; k++) {
        const path: Vector3[] = [];
        for (let i = 0; i <= 8; i++) {
          const t = i / 8;
          path.push(
            onRetina(
              dPole + 1.1 + 0.9 * t * Math.cos(k * 1.1) + 0.2 * Math.sin(t * 9 + k),
              Math.PI - 0.35 - 0.25 * t * Math.sin(k * 1.7) - 0.05 * k,
              0.07,
            ),
          );
        }
        strip(path, 0.05);
      }
    }
    vesselGeo.dispose();
    vesselGeo.setAttribute("position", new BufferAttribute(new Float32Array(pts), 3));
    vesselGeo.computeBoundingSphere();
  };

  /**
   * A realistic muscle: an oval bundle swept from its insertion along the globe and then off
   * towards where it starts, thin and pale where it is tendon, full where it is muscle.
   */
  const buildRealMuscle = (m: Mesh, spec: MuscleSpec) => {
    const outer = g.sclera.outer;
    let acc = 0;
    let start = 0;
    for (let i = 1; i < outer.length; i++) {
      const a = outer[i - 1]!;
      const b = outer[i]!;
      acc += Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (acc >= spec.insert) {
        start = i;
        break;
      }
    }
    const lift = (x: number, rho: number, phi: number, by: number) => {
      const p = pointAt(x, rho + by, phi);
      return new Vector3(p[0], p[1], p[2]);
    };
    const path: Vector3[] = [];
    if (spec.via === undefined) {
      // A rectus: back along the wall to behind the equator, then off to the tendon ring.
      let i = start;
      while (i < outer.length - 1 && outer[i]![0] < g.equator[0] + 3.5) {
        path.push(lift(outer[i]![0], outer[i]![1], spec.phi, 0.6));
        i += 2;
      }
    } else {
      // An oblique: round the globe from its insertion, then off to its origin at the front.
      const [x0] = outer[start]!;
      const x1 = g.equator[0] - 1;
      for (let k = 0; k <= 8; k++) {
        const t = k / 8;
        const x = x0 + (x1 - x0) * t;
        const rho = g.outerAt(x);
        path.push(lift(x, rho, spec.phi + (spec.via - spec.phi) * t, 0.5));
      }
    }
    const leave = path[path.length - 1]!;
    // The recti follow the eye's length back to the tendon ring.
    const to = spec.via === undefined ? new Vector3(g.L + 20, 0, -3) : new Vector3(...spec.origin);
    for (let k = 1; k <= 6; k++) path.push(leave.clone().lerp(to, k / 6));
    let tendon = spec.tendon;
    if (spec.turn) {
      // Through the trochlea, then back along the top of the orbit on the nose side.
      tendon = (path.length - 1) / (path.length + 7);
      const back = new Vector3(g.L + 17, 5, -7);
      for (let k = 1; k <= 8; k++) path.push(to.clone().lerp(back, k / 8));
    }
    const n = path.length;
    const ring = 12;
    const pos = new Float32Array(n * (ring + 1) * 3);
    const uv = new Float32Array(n * (ring + 1) * 2);
    const centre = new Vector3(g.equator[0], 0, 0);
    for (let i = 0; i < n; i++) {
      const p = path[i]!;
      const t = i / (n - 1);
      const tan = path[Math.min(n - 1, i + 1)]!.clone()
        .sub(path[Math.max(0, i - 1)]!)
        .normalize();
      const out = p.clone().sub(centre);
      out.addScaledVector(tan, -out.dot(tan)).normalize();
      const side = new Vector3().crossVectors(tan, out).normalize();
      // Thin, flat tendon at the insertion, a full belly, narrowing towards the origin.
      const inTendon = t < tendon;
      const k = inTendon ? t / tendon : 1;
      const rest = (t - tendon) / (1 - tendon);
      // The superior oblique's tendon stays slender all the way to its pulley.
      const tw = spec.turn ? 0.5 : 0.75 + 0.25 * k;
      const w = spec.belly * (inTendon ? tw : 1 - 0.55 * rest ** 1.5);
      const h = inTendon ? (spec.turn ? 0.35 : 0.25 + 0.6 * k) : 1.3 - 0.5 * rest;
      for (let j = 0; j <= ring; j++) {
        const a = (j / ring) * Math.PI * 2;
        const q = p
          .clone()
          .addScaledVector(side, Math.cos(a) * w)
          .addScaledVector(out, Math.sin(a) * h);
        pos.set([q.x, q.y, q.z], (i * (ring + 1) + j) * 3);
        // The texture keeps its top fifth for tendon, whatever share of this muscle it is.
        const v = inTendon ? 0.2 * k : 0.2 + (0.8 * (t - tendon)) / (1 - tendon);
        uv.set([j / ring, v], (i * (ring + 1) + j) * 2);
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < ring; j++) {
        const a = i * (ring + 1) + j;
        const b = a + ring + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(pos, 3));
    geo.setAttribute("uv", new BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    replace(m, geo);
  };

  const buildMuscle = (m: Mesh, spec: MuscleSpec) => {
    if (real) {
      buildRealMuscle(m, spec);
      return;
    }
    // Find where the insertion falls along the outer wall from the limbus.
    const outer = g.sclera.outer;
    let acc = 0;
    let start = 0;
    for (let i = 1; i < outer.length; i++) {
      const a = outer[i - 1]!;
      const b = outer[i]!;
      acc += Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (acc >= spec.insert) {
        start = i;
        break;
      }
    }
    const end = outer.length - 4;
    const rows = Math.max(2, end - start + 1);
    const cols = 6;
    const pos = new Float32Array(rows * cols * 3);
    for (let r = 0; r < rows; r++) {
      const [x, rho] = outer[Math.min(outer.length - 1, start + r)]!;
      const t = r / (rows - 1);
      for (let c = 0; c < cols; c++) {
        const across = (c / (cols - 1) - 0.5) * spec.width * (1 - 0.35 * t);
        const phi = spec.phi + across + spec.twist * t;
        const p = pointAt(x, rho + 0.35 + 0.5 * Math.sin(Math.PI * (c / (cols - 1))), phi);
        pos.set(p, (r * cols + c) * 3);
      }
    }
    const idx: number[] = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        idx.push(a, a + cols, a + 1, a + cols, a + cols + 1, a + 1);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    replace(m, geo);
  };

  const rebuildCornea = (rh: number, rv: number, cone: number) => {
    const key = `${rh.toFixed(3)}:${rv.toFixed(3)}:${cone.toFixed(3)}`;
    if (key === corneaKey) return;
    corneaKey = key;
    const bump = (rho: number, phi: number, h: number) => {
      if (h <= 0) return 0;
      const y = -rho * Math.sin(phi);
      const z = rho * Math.cos(phi);
      const d2 = (y + 1.6) ** 2 + z * z;
      return h * Math.exp(-d2 / (2 * 1.5 * 1.5));
    };
    const rOf = (phi: number) => 1 / (Math.cos(phi) ** 2 / rh + Math.sin(phi) ** 2 / rv);
    const front = (rho: number, phi: number) =>
      frontX + corneaSag(rho, rOf(phi)) - bump(rho, phi, cone);
    const backSurf = (rho: number, phi: number) => {
      const f = front(rho, phi) + bump(rho, phi, cone);
      const thick = LE_GRAND.t1 + 0.18 * (rho / CORNEA_RADIUS) ** 2;
      return f + thick - bump(rho, phi, cone * 1.35);
    };
    corneaGrid(corneaFront.geometry, front);
    corneaGrid(corneaBack.geometry, backSurf);
    corneaGrid(tear.geometry, (rho, phi) => front(rho, phi) - 0.06);
    // Cut faces in the horizontal meridian (φ = 0 and π).
    const prof = (phi: number, f: (r: number, p: number) => number): P[] =>
      Array.from({ length: CR + 1 }, (_, i) => {
        const rho = (CORNEA_RADIUS * i) / CR;
        return [f(rho, phi), rho] as P;
      });
    const sideFace = (phi: number, s: number): P[] => [
      ...prof(phi, front).map(([x, r]) => [x, s * r] as P),
      ...prof(phi, backSurf)
        .reverse()
        .map(([x, r]) => [x, s * r] as P),
    ];
    replace(corneaCut, section([sideFace(0, 1), sideFace(Math.PI, -1)], 0.006));
  };

  const rebuildLens = (param: number) => {
    const key = param.toFixed(3);
    if (key === lensKey) return;
    lensKey = key;
    const shape = navarro(param);
    lensFront = LE_GRAND.t1 + shape.acd;
    const lp = lensProfile(shape, lensFront);
    lensEq = lp.equator;
    const prof = [...lp.front, ...lp.back.slice(1)];
    revolve(prof, FULL, 40, lens.geometry);
    replace(lensCut, section(solidOutline(prof), 0.008));
    // The nucleus: the lens's own shape shrunk about its middle.
    const cx = (lp.frontX + lp.backX) / 2;
    const nuc = prof.map(([x, r]) => [cx + (x - cx) * 0.58, r * 0.55] as P);
    revolve(nuc, FULL, 32, nucleus.geometry);
    // Cortical spokes: thin wedges pointing in from the edge, more of them low on the nose side.
    const spokeTri: number[] = [];
    for (let i = 0; i < 9; i++) {
      const phi = 0.25 + i * 0.32 + (i > 4 ? 0.1 : 0);
      const tip = pointAt(lensEq[0], lensEq[1] * 0.45, phi);
      const a = pointAt(lensEq[0] - 0.55, lensEq[1] * 0.97, phi - 0.08);
      const b = pointAt(lensEq[0] + 0.55, lensEq[1] * 0.97, phi + 0.08);
      spokeTri.push(...tip, ...a, ...b);
    }
    const sg = new BufferGeometry();
    sg.setAttribute("position", new BufferAttribute(new Float32Array(spokeTri), 3));
    replace(spokes, sg);
    psc.position.set(lp.backX - 0.18, 0, 0);
    // The artificial lens: a thin optic and two curved haptics in the lens's place.
    const optic: P[] = [];
    for (let i = 0; i <= 12; i++)
      optic.push([cx - 0.5 + corneaSag((3 * i) / 12, 8) * 0.4, (3 * i) / 12]);
    for (let i = 12; i >= 0; i--)
      optic.push([cx + 0.5 - corneaSag((3 * i) / 12, 8) * 0.4, (3 * i) / 12]);
    revolve(optic, FULL, 32, iol.geometry);
    const hp: number[] = [];
    for (const s of [1, -1]) {
      for (let i = 0; i < 16; i++) {
        const a0 = (i / 16) * 1.9;
        const a1 = ((i + 1) / 16) * 1.9;
        const p0 = [cx, Math.sin(a0) * 4.4 * s, s * (3 - 0.2) * Math.cos(a0) + s * 0.2];
        const p1 = [cx, Math.sin(a1) * 4.4 * s, s * (3 - 0.2) * Math.cos(a1) + s * 0.2];
        hp.push(...p0, ...p1);
      }
    }
    hapticGeo.dispose();
    hapticGeo.setAttribute("position", new BufferAttribute(new Float32Array(hp), 3));
    rebuildAnterior();
  };

  const rebuildAnterior = () => {
    const key = `${lensKey}:${pupilR.toFixed(3)}:${g.L.toFixed(2)}`;
    if (key === irisKey) return;
    irisKey = key;
    const lim = g.limbus;
    // The iris lies on the lens front at the pupil and rises to its root at the angle.
    const rootX = lim[0] + 0.55;
    const rootR = lim[1] - 0.25;
    const marginX = lensFront + corneaSag(pupilR, 10) - 0.06;
    const irisFront: P[] = [];
    const irisBack: P[] = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const rho = pupilR + (rootR - pupilR) * t;
      const x = marginX + (rootX - marginX) * t - 0.25 * Math.sin(Math.PI * t);
      irisFront.push([x, rho]);
      irisBack.push([x + 0.38 - 0.12 * t, rho]);
    }
    revolve([...irisFront, ...[...irisBack].reverse()], LOWER, 40, iris.geometry);
    if (real) {
      // The patterned front, a hair in front of the iris, both halves; and the black disc
      // behind the pupil.
      const face = irisFront.map(([x, r]) => [x - 0.02, r] as P);
      revolve(face, LOWER, 64, irisFace.geometry);
      revolve(face, UPPER, 64, irisFaceUp.geometry);
      revolve(
        [
          [marginX - 0.04, 0],
          [marginX - 0.04, pupilR],
        ],
        FULL,
        48,
        pupilDark.geometry,
      );
    }
    replace(irisCut, section(bandOutlines(irisFront, irisBack), 0.01));
    // The pupil: a ring just inside the iris margin (seen when it lights up).
    revolve(
      [
        [marginX - 0.02, pupilR * 0.98],
        [marginX - 0.02, pupilR * 0.75],
      ],
      FULL,
      40,
      pupilRing.geometry,
    );
    // The drainage angle: a small wedge where the iris root meets the cornea.
    revolve(
      [
        [rootX - 0.6, rootR + 0.2],
        [rootX - 0.1, rootR - 0.25],
        [rootX + 0.25, rootR + 0.3],
        [rootX - 0.6, rootR + 0.2],
      ],
      LOWER,
      40,
      angle.geometry,
    );
    // The ciliary body: a wedge behind the iris root, its folds reaching towards the lens.
    const cil: P[] = [];
    const sIn = g.sclera.inner;
    const ora = g.ora[0];
    const wall = sIn.filter(([x]) => x >= rootX && x <= ora);
    const reach = 0.95 + 0.25 * accommodationShare;
    for (const [x, r] of wall) {
      const t = (x - rootX) / Math.max(0.1, ora - rootX);
      const thick =
        t < 0.25 ? 0.5 + reach * (t / 0.25) : 0.15 + (0.5 + reach - 0.15) * (1 - (t - 0.25) / 0.75);
      cil.push([x - 0.25 * accommodationShare * (1 - t), r - thick]);
    }
    if (wall.length >= 2) {
      if (real) {
        // About 70 folds, the ciliary processes, ridge its front part.
        const n = cil.length;
        revolve(cil, LOWER, 140, ciliary.geometry, (row, phi) => {
          const t = row / Math.max(1, n - 1);
          const w = t < 0.45 ? 1 - Math.abs(t - 0.18) / 0.27 : 0;
          return -0.28 * Math.max(0, w) * (0.5 + 0.5 * Math.cos(70 * phi));
        });
      } else revolve(cil, LOWER, 40, ciliary.geometry);
      replace(ciliaryCut, section(bandOutlines(wall, cil), 0.012));
    }
    // Zonules: from the ciliary folds to just in front of and behind the lens equator.
    const apex = cil.reduce((a, b) => (b[1] < a[1] ? b : a), cil[0] ?? [rootX + 1.5, 5]);
    const zp = zonuleGeo.getAttribute("position") as BufferAttribute;
    const za = zp.array as Float32Array;
    for (let i = 0; i < ZONULES; i++) {
      const phi = (Math.PI * (i + 0.5)) / ZONULES;
      const from = pointAt(apex[0] + 0.1, apex[1] - 0.05, phi);
      const toF = pointAt(lensEq[0] - 0.6, lensEq[1] - 0.15, phi);
      const toB = pointAt(lensEq[0] + 0.5, lensEq[1] - 0.15, phi);
      za.set([...from, ...toF, ...from, ...toB], i * 12);
    }
    zp.needsUpdate = true;
    zonuleGeo.computeBoundingSphere();
    // Aqueous: the cut face of the space between cornea, iris and lens.
    const corneaBackProf: P[] = [];
    for (let i = 0; i <= 10; i++) {
      const rho = (rootR * i) / 10;
      corneaBackProf.push([
        frontX + corneaSag(rho, 7.8) + LE_GRAND.t1 + 0.18 * (rho / CORNEA_RADIUS) ** 2,
        rho,
      ]);
    }
    const lensFrontProf: P[] = [];
    for (let i = 10; i >= 0; i--) {
      const rho = (pupilR * i) / 10;
      lensFrontProf.push([lensFront + corneaSag(rho, 10), rho]);
    }
    const aq: P[] = [...corneaBackProf, ...[...irisFront].reverse(), ...lensFrontProf];
    replace(aqueous, section(solidOutline(aq), 0.003));
    // Vitreous: behind the lens to the back of the eye.
    const lp = lensProfile(navarro(lastParam), lensFront);
    const ret = g.retina.inner;
    const vit: P[] = [...[...lp.back].reverse(), [apex[0] + 0.3, apex[1] - 0.1], ...ret];
    replace(vitreous, section(solidOutline(vit), -0.004));
    // The conjunctiva over the front of the sclera, into the folds behind the lids.
    const out = g.sclera.outer.filter(([x]) => x <= lim[0] + 9).map(([x, r]) => [x, r + 0.12] as P);
    revolve(out, FULL, 40, conj.geometry);
    buildFlowPath(rootX, rootR, marginX, apex);
  };

  let flowPath: P[] = [];
  const buildFlowPath = (rootX: number, rootR: number, marginX: number, apex: P) => {
    // From the ciliary folds, between iris and lens, out through the pupil, round the
    // chamber's front and down to the angle.
    flowPath = [
      [apex[0] + 0.2, apex[1] - 0.2],
      [lensFront + 0.45, pupilR + 1.2],
      [marginX + 0.1, pupilR + 0.1],
      [marginX - 0.6, pupilR * 0.7],
      [frontX + 1.4, 1.2],
      [frontX + 1.2, 3.2],
      [rootX - 0.4, rootR - 0.4],
      [rootX - 0.35, rootR + 0.05],
    ];
  };

  let accommodationShare = 0;
  let lastParam = 0;

  const rebuildConditions = (s: EyeState, exaggerate: boolean) => {
    const key = `${s.condition}:${s.strength.toFixed(2)}:${s.correction}:${exaggerate}:${g.L.toFixed(2)}`;
    if (key === condKey) return;
    condKey = key;
    const c = s.condition;
    const k = s.strength;
    // Cataract: an amber centre, white spokes, a plaque at the back.
    const cat = c === "cataract" && s.correction !== "newLens" ? k : 0;
    nucleusPaint.opacity = 0.12 + 0.6 * cat;
    spokePaint.opacity = cat > 0.35 ? (0.65 * (cat - 0.35)) / 0.65 : 0;
    pscPaint.opacity = cat > 0.6 ? (0.7 * (cat - 0.6)) / 0.4 : 0;
    nucleus.visible = cat > 0;
    spokes.visible = cat > 0.35;
    psc.visible = cat > 0.6;
    const swapped = c === "cataract" && s.correction === "newLens";
    lens.visible = !swapped;
    lensCut.visible = !swapped;
    lensCut.userData.hide = swapped;
    iol.visible = swapped;
    haptics.visible = swapped;
    // Glaucoma: the cup widens (and the disc is drawn twice its size, shown larger than real).
    const disc2 = exaggerate && c === "glaucoma" ? 2 : 1;
    disc.scale.setScalar(disc2);
    const cupRatio = c === "glaucoma" ? 0.35 + 0.5 * k : 0.3;
    cup.scale.setScalar(disc2 * cupRatio);
    // Macular degeneration: drusen, then a pale patch where the layer thins.
    atrophy.visible = c === "amd" && k > 0.45;
    atrophy.scale.setScalar(0.6 + 1.6 * Math.max(0, k - 0.45));
    // Dots: drusen at the macula, or leaky dots and flecks in diabetic retinopathy.
    let n = 0;
    const rnd = (() => {
      let x = 12345;
      return () => {
        x = (x * 1103515245 + 12345) & 0x7fffffff;
        return x / 0x7fffffff;
      };
    })();
    const place = (mat: Material, fromPole: number, phi: number, size: number) => {
      const m = dots[n++];
      if (!m) return;
      m.material = mat;
      m.position.copy(onRetina(fromPole, phi, 0.05));
      m.scale.setScalar(size);
      m.visible = true;
    };
    if (c === "amd") {
      const count = Math.round(8 + 22 * k);
      for (let i = 0; i < count; i++) {
        place(
          drusenPaint.mat as Material,
          rnd() * 2.6,
          0.15 + rnd() * (Math.PI - 0.3),
          0.06 + rnd() * 0.08,
        );
      }
    } else if (c === "diabetic") {
      const count = Math.round(6 + 18 * k);
      for (let i = 0; i < count; i++) {
        const ex = i % 3 === 0;
        place(
          (ex ? exudatePaint : dotPaint).mat as Material,
          0.8 + rnd() * 5,
          0.15 + rnd() * (Math.PI - 0.3),
          ex ? 0.07 + rnd() * 0.05 : 0.05 + rnd() * 0.04,
        );
      }
    }
    for (let i = n; i < DOTS; i++) dots[i]!.visible = false;
    // Diabetic macular swelling: the macula patch domes up a little.
    macula.scale.set(1, 1, 1);
    const swell = c === "diabetic" ? 1 + 0.25 * k : 1;
    macula.scale.setScalar(swell);
    const nv = c === "diabetic" && k > 0.6 ? 1 : 0;
    if (nv !== vesselState.newVessels) {
      vesselState.newVessels = nv;
      buildVessels();
    }
  };

  const rebuildCorrection = (d: Derived) => {
    const lensOn = d.lens;
    glasses.visible = false;
    glassesCut.visible = false;
    glassesCut.userData.hide = true;
    contact.visible = false;
    if (!lensOn) return;
    if (lensOn.kind === "glasses" || lensOn.kind === "reading") {
      const F = (lensOn.power.h + lensOn.power.v) / 2;
      const x0 = -VERTEX_M * 1000;
      const R = 12;
      // A thin lens drawn thicker at the edge for minus, at the centre for plus.
      const edge = 0.6 + Math.max(0, -F) * 0.35;
      const centre = 0.6 + Math.max(0, F) * 0.45;
      const prof: P[] = [];
      for (let i = 0; i <= 12; i++) {
        const r = (R * i) / 12;
        const t = centre + (edge - centre) * (r / R) ** 2;
        prof.push([x0 - t / 2, r]);
      }
      for (let i = 12; i >= 0; i--) {
        const r = (R * i) / 12;
        const t = centre + (edge - centre) * (r / R) ** 2;
        prof.push([x0 + t / 2, r]);
      }
      revolve(prof, FULL, 40, glasses.geometry);
      replace(glassesCut, section(solidOutline(prof), 0.02));
      glasses.visible = true;
      glassesCut.visible = true;
      glassesCut.userData.hide = false;
    } else {
      // A contact lens over the cornea; a hard lens is smaller.
      const size = lensOn.kind === "hardLens" ? 4.6 : CORNEA_RADIUS + 0.4;
      const prof: P[] = [];
      for (let i = 0; i <= 12; i++) {
        const r = (size * i) / 12;
        prof.push([frontX + corneaSag(r, 7.9) - 0.12, r]);
      }
      for (let i = 12; i >= 0; i--) {
        const r = (size * i) / 12;
        prof.push([frontX + corneaSag(r, 7.9) - 0.32, r]);
      }
      revolve(prof, FULL, 40, contact.geometry);
      contact.visible = true;
    }
  };

  // ---- Rays ----------------------------------------------------------------------------------

  const rebuildRays = (s: EyeState, d: Derived) => {
    lines.length = 0;
    const L = s.length;
    const a = d.param;
    const far = s.looking === "far";
    const zObj = far ? LAYERS.far : LAYERS.near;
    const x0 = -17;
    const xIris = lensFront;
    const extra = (power: number) =>
      d.lens
        ? d.lens.kind === "glasses" || d.lens.kind === "reading"
          ? [{ at: -VERTEX_M * 1000, power }]
          : [{ at: -0.05, power }]
        : [];
    // Object distance in front of the start plane, mm; far light arrives parallel.
    const reach = zObj * 1000 + x0;
    const traceFan = (
      rad: number,
      power: number,
      rCornea: number,
      which: 0 | 1,
      count: number,
      corneal: (h: number) => number,
    ) => {
      // Heights at the iris are linear in the start height (far) or the slope (near), so one
      // unit ray gives the scale that puts the bundle's edges at the pupil's edge.
      const unit = far
        ? traceRay(1, 0, x0, xIris, rCornea, a, extra(power))
        : traceRay(reach, 1, x0, xIris, rCornea, a, extra(power));
      const gain = unit.points[unit.points.length - 1]![1] || 1;
      const out: Vector3[][] = [];
      for (let i = 0; i < count; i++) {
        const h = count === 1 ? 0 : -1 + (2 * i) / (count - 1);
        const k = (h * rad) / gain;
        const path = far
          ? traceRay(k, 0, x0, L, rCornea, a, extra(power), corneal(h))
          : traceRay(k * reach, k, x0, L, rCornea, a, extra(power), corneal(h));
        out.push(
          path.points.map(([x, y]) =>
            which === 0 ? new Vector3(x, 0.05, y) : new Vector3(x, Math.abs(y) + 0.05, 0),
          ),
        );
      }
      return out;
    };
    const rad = d.pupil / 2;
    const rh = s.radius;
    const rv = d.radiusV;
    const coma =
      s.condition === "keratoconus"
        ? (d.coma >= 0 ? 1 : -1) * Math.min(4, Math.abs(d.coma) * 6)
        : 0;
    const hr = d.lens ? d.lens.power.h : 0;
    const vr = d.lens ? d.lens.power.v : 0;
    // Keratoconus: the vertical meridian carries the cone's cylinder and, along it, coma.
    const kc = s.condition === "keratoconus";
    const cyl = kc ? d.refraction.h - d.refraction.v : 0;
    const fanH = traceFan(rad, hr, rh, 0, 7, () => 0);
    const fanV = traceFan(rad, vr, kc ? rh : rv, 1, 5, (h) => cyl + coma * h);
    for (const p of fanH) lines.push({ pts: p, which: 0 });
    const astig = Math.abs(d.refraction.h - d.refraction.v) > 0.2 || coma !== 0;
    if (astig) for (const p of fanV) lines.push({ pts: p, which: 1 });
    // Where each meridian focuses, and the blur across the retina.
    const focusOf = (fan: Vector3[][], which: 0 | 1) => {
      // Two rays from opposite edges cross at the focus.
      const a1 = fan[0]!;
      const a2 = fan[fan.length - 1]!;
      const n = a1.length;
      const p1 = a1[n - 2]!;
      const q1 = a1[n - 1]!;
      const p2 = a2[n - 2]!;
      const q2 = a2[n - 1]!;
      const h = (v: Vector3) => (which === 0 ? v.z : v.y);
      const s1 = (h(q1) - h(p1)) / Math.max(1e-6, q1.x - p1.x);
      const s2 = (h(q2) - h(p2)) / Math.max(1e-6, q2.x - p2.x);
      if (Math.abs(s1 - s2) < 1e-9) return Number.POSITIVE_INFINITY;
      return p1.x + (h(p2) - h(p1)) / (s1 - s2);
    };
    const xh = focusOf(fanH, 0);
    const xv = astig ? focusOf(fanV, 1) : xh;
    focusH.visible = Number.isFinite(xh) && xh > 0 && xh < L + 9;
    focusH.position.set(Math.min(xh, L + 9), 0.05, 0);
    focusV.visible = astig && Number.isFinite(xv) && xv > 0 && xv < L + 9;
    focusV.position.set(Math.min(xv, L + 9), 0.6, 0);
    // Beyond the retina (long sight), the rays carry on faintly to their focus.
    if (Number.isFinite(xh) && xh > L && xh < L + 9) {
      for (const p of fanH) {
        const n = p.length;
        const a2 = p[n - 2]!;
        const b2 = p[n - 1]!;
        const slope = (b2.z - a2.z) / Math.max(1e-6, b2.x - a2.x);
        lines.push({ pts: [b2, new Vector3(xh, 0.05, b2.z + slope * (xh - b2.x))], which: 2 });
      }
    }
    // The blur on the retina: a bright bar across the spread of the rays there.
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of fanH) {
      const z = p[p.length - 1]!.z;
      lo = Math.min(lo, z);
      hi = Math.max(hi, z);
    }
    const half = Math.max(0.12, (hi - lo) / 2);
    blurLine = [new Vector3(L - 0.03, 0.08, -half), new Vector3(L - 0.03, 0.08, half)];
  };
  let blurLine: Vector3[] = [];

  const writeRibbons = () => {
    const camPos = camera.position.clone();
    root.worldToLocal(camPos);
    const fill = (m: Mesh, list: Vector3[][], width: number) => {
      const pos = m.geometry.getAttribute("position") as BufferAttribute;
      const arr = pos.array as Float32Array;
      let o = 0;
      const max = arr.length;
      for (const pts of list) {
        for (let i = 0; i < pts.length - 1 && o + 18 <= max; i++) {
          const a = pts[i]!;
          const b = pts[i + 1]!;
          const dir = new Vector3().subVectors(b, a);
          const view = new Vector3().subVectors(camPos, a);
          const side = new Vector3()
            .crossVectors(dir, view)
            .normalize()
            .multiplyScalar(width / 2);
          const a1 = a.clone().add(side);
          const a2 = a.clone().sub(side);
          const b1 = b.clone().add(side);
          const b2 = b.clone().sub(side);
          arr.set([a1.x, a1.y, a1.z, a2.x, a2.y, a2.z, b1.x, b1.y, b1.z], o);
          arr.set([a2.x, a2.y, a2.z, b2.x, b2.y, b2.z, b1.x, b1.y, b1.z], o + 9);
          o += 18;
        }
      }
      pos.needsUpdate = true;
      m.geometry.setDrawRange(0, o / 3);
    };
    const w = 0.11 * rayScale;
    fill(
      raysH,
      lines.filter((l) => l.which === 0).map((l) => l.pts),
      w,
    );
    fill(
      raysV,
      lines.filter((l) => l.which === 1).map((l) => l.pts),
      w,
    );
    fill(
      raysGhost,
      lines.filter((l) => l.which === 2).map((l) => l.pts),
      w * 0.8,
    );
    fill(blurMark, blurLine.length ? [blurLine] : [], 0.22 * rayScale);
  };
  let rayScale = 1;

  // ---- Highlighting --------------------------------------------------------------------------

  let shownPart: PartId | null | undefined;
  const dimColour = new Color("#2a3348");
  /** The chosen part's paints, which pulse for a moment so it stands out. */
  let chosen: Paint[] = [];
  let chosenAt = 0;
  let pulsing = false;
  const highlight = (part: PartId | null, t: number) => {
    if (part === shownPart) return;
    shownPart = part;
    chosen = [];
    chosenAt = t;
    pulsing = part !== null;
    for (const [id, p] of parts) {
      const on = part === null || id === part || (part === "photoreceptors" && id === "retina");
      const mine = part !== null && on;
      // Only the chosen part goes on the isolation layer.
      for (const o of p.objects) {
        if (mine) o.layers.enable(ISOLATE_LAYER);
        else o.layers.disable(ISOLATE_LAYER);
      }
      if (mine) chosen.push(...p.paints);
    }
    // The pooled marks (drusen, leaky dots) belong to the macula and retina.
    for (const d of dots) {
      if (part === "macula" || part === "retina") d.layers.enable(ISOLATE_LAYER);
      else d.layers.disable(ISOLATE_LAYER);
    }
    for (const [id, p] of parts) {
      const on = part === null || id === part || (part === "photoreceptors" && id === "retina");
      for (const paint of p.paints) {
        const c = paint.color.clone();
        if (!on) c.lerp(dimColour, 0.55);
        paint.mat.color.copy(c);
        if ("emissive" in paint.mat) {
          (paint.mat as MeshLambertMaterial).emissive.copy(
            part !== null && on ? paint.color : new Color(0),
          );
          (paint.mat as MeshLambertMaterial).emissiveIntensity = part !== null && on ? 0.25 : 0;
        }
        let op = paint.opacity;
        // Clear parts show themselves when chosen.
        if (part !== null && on && op < 0.5) op = Math.min(0.6, op * 3 + 0.12);
        if (!on && op < 1) op *= 0.5;
        paint.mat.opacity = op;
      }
    }
  };

  // ---- Camera --------------------------------------------------------------------------------

  const aim = () => {
    const aspect = rect.width / Math.max(1, rect.height);
    camera.aspect = aspect;
    const L = lastLength;
    // Cut open: fit the eye with the rays coming in from the left and the nerve behind it.
    // Whole: fit the ball itself, seen from the front.
    const x0 = -17;
    const x1 = L + 6;
    const k = openness;
    const target = new Vector3(g.equator[0] * (1 - k) + ((x0 + x1) / 2) * k, -1.5 * k, 0);
    const halfW = 13.5 * (1 - k) + ((x1 - x0) / 2) * k;
    const halfH = 13 * (1 - k) + 12.5 * k;
    const vfov = (camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const dist = Math.max(halfH / Math.tan(vfov / 2), halfW / Math.tan(hfov / 2)) + 10;
    const az = (azimuth * Math.PI) / 180;
    const el = (elevation * Math.PI) / 180;
    camera.position.set(
      target.x + dist * Math.sin(az) * Math.cos(el),
      target.y + dist * Math.sin(el),
      target.z + dist * Math.cos(az) * Math.cos(el),
    );
    camera.lookAt(target);
    camera.near = Math.max(1, dist - 60);
    camera.far = dist + 60;
    camera.updateProjectionMatrix();
    rayScale = Math.max(0.6, dist / 70);
  };

  // Start with everything built once, so the compile sees every material.
  rebuildGlobe(startLength);
  rebuildCornea(LE_GRAND.r1, LE_GRAND.r1, 0);
  rebuildLens(0);
  aim();
  r3d.prepare(scene, camera);

  const raycaster = new Raycaster();
  // Zonule fibres are lines: a tap must land close to one.
  raycaster.params.Line = { threshold: 0.2 };
  const PICK_PRIORITY: Partial<Record<PartId, number>> = {
    vitreous: 1,
    aqueous: 1,
    tearFilm: 0,
    conjunctiva: 0,
    macula: 3,
    fovea: 4,
    disc: 4,
  };

  return {
    scene,
    camera,
    get openness() {
      return openness;
    },
    setViewport(r) {
      rect = r;
      aim();
    },
    setOrbit(az, el) {
      if (az === azimuth && el === elevation) return;
      azimuth = az;
      elevation = el;
      aim();
    },
    update(look, t) {
      const dt = Math.min(0.1, Math.max(0, t - lastT));
      lastT = t;
      openTarget = real ? (look.open ? 1 : 0) : 1;
      if (openness !== openTarget) {
        openness += (openTarget - openness) * (1 - Math.exp(-dt / 0.35));
        if (Math.abs(openness - openTarget) < 0.004) openness = openTarget;
        aim();
      }
      if (real) {
        const k = openness;
        for (const u of uppers) {
          u.paint.opacity = 1 + (u.ghost - 1) * k;
          u.paint.mat.opacity = u.paint.opacity;
          (u.paint.mat as MeshStandardMaterial).depthWrite = k < 0.5;
        }
        for (const c of cuts) c.visible = k > 0.02 && c.userData.hide !== true;
        irisFaceUp.visible = k < 0.5;
        pupilDark.visible = k < 0.5;
        // Hidden behind the limbus in a real eye, and the flow is a picture of the inside.
        angle.visible = k > 0.5 || look.part === "angle";
        flow.visible = k > 0.5 && (look.part === "aqueous" || look.part === "angle");
        // A whole eye shows its muscles, as an eyeball on its own does; cut open, only on request.
        for (const m of muscleMeshes) m.mesh.visible = k < 0.5 || look.part === "muscles";
      }
      rays.visible = openness > 0.6;
      const s = look.state;
      const d = look.derived;
      if (Math.abs(s.length - lastLength) > 1e-4) {
        lastLength = s.length;
        rebuildGlobe(s.length);
        aim();
      }
      const coneH = s.condition === "keratoconus" ? (look.exaggerate ? 0.9 : 0.35) * s.strength : 0;
      rebuildCornea(s.radius, d.radiusV, coneH);
      accommodationShare = Math.min(1, d.accommodation / 7);
      lastParam = d.param;
      pupilR = d.pupil / 2;
      rebuildLens(d.param);
      rebuildAnterior();
      rebuildConditions(s, look.exaggerate);
      const key = JSON.stringify([s, d.param, d.pupil, d.lens]);
      if (key !== lastKey) {
        lastKey = key;
        rebuildCorrection(d);
        rebuildRays(s, d);
      }
      highlight(look.part, t);
      // The chosen part pulses in the accent colour for three seconds, then glows steadily.
      if (pulsing) {
        const age = t - chosenAt;
        const p = age < 3 ? (0.5 + 0.5 * Math.sin(age * 7)) * (1 - age / 3) : 0;
        for (const paint of chosen) {
          if ("emissive" in paint.mat) {
            const m = paint.mat as MeshLambertMaterial;
            m.emissive.copy(paint.color).lerp(ACCENT, p);
            m.emissiveIntensity = 0.25 + 0.9 * p;
          } else {
            paint.mat.color.copy(paint.color).lerp(ACCENT, 0.6 * p);
          }
        }
        if (age >= 3) pulsing = false;
      }
      // "Only this part": draw just the chosen part and the outline.
      const alone = look.isolate && look.part !== null;
      camera.layers.set(alone ? ISOLATE_LAYER : 0);
      raycaster.layers.set(alone ? ISOLATE_LAYER : 0);
      // Aqueous flows from the ciliary body to the angle; slowly in glaucoma.
      // The fluid's flow shows only with the parts whose captions describe it.
      const show = look.part === "aqueous" || look.part === "angle";
      flowPaint.mat.opacity = show ? 0.9 : 0;
      const speed = s.condition === "glaucoma" ? 0.25 : 1;
      const fp = flowGeo.getAttribute("position") as BufferAttribute;
      const fa = fp.array as Float32Array;
      const segs = flowPath.length - 1;
      for (let i = 0; i < FLOW; i++) {
        const u = ((i * 0.6180339 + t * 0.07 * speed) % 1) * segs;
        const j = Math.min(segs - 1, Math.floor(u));
        const f = u - j;
        const a = flowPath[j];
        const b = flowPath[j + 1];
        if (!a || !b) continue;
        const x = a[0] + (b[0] - a[0]) * f;
        const r = a[1] + (b[1] - a[1]) * f;
        const phi = ((i * 0.37) % 1) * Math.PI;
        fa.set(pointAt(x, r, phi), i * 3);
      }
      fp.needsUpdate = true;
      flowGeo.computeBoundingSphere();
      // The tear film shimmers when chosen, as if just blinked fresh.
      if (look.part === "tearFilm")
        tearPaint.mat.opacity = 0.25 + 0.2 * (0.5 + 0.5 * Math.sin(t * 2.2));
      // The eye muscles turn the eye when chosen.
      if (look.part === "muscles") {
        root.rotation.set(0, 0.22 * Math.sin(t * 0.9), 0.12 * Math.sin(t * 0.63));
      } else {
        root.rotation.y *= 0.9;
        root.rotation.z *= 0.9;
      }
    },
    draw(frameH) {
      if (!r3d.ready) return;
      writeRibbons();
      const renderer = r3d.renderer;
      const y = frameH - rect.y - rect.height;
      renderer.setViewport(rect.x, y, rect.width, rect.height);
      renderer.setScissor(rect.x, y, rect.width, rect.height);
      renderer.render(scene, camera);
    },
    hits(x, y) {
      const ndc = new Vector2(
        ((x - rect.x) / rect.width) * 2 - 1,
        -(((y - rect.y) / rect.height) * 2 - 1),
      );
      raycaster.setFromCamera(ndc, camera);
      const targets: Object3D[] = [];
      for (const p of parts.values()) {
        for (const o of p.objects) if (o.visible && !(o instanceof Points)) targets.push(o);
      }
      return raycaster
        .intersectObjects(targets, false)
        .map(
          (h) =>
            `${h.object.userData.part as string}${seeThrough(h.object, h.point) ? "*" : ""}@${h.distance.toFixed(1)}`,
        );
    },
    pickList(x, y) {
      const first = this.pick(x, y);
      if (!first) return [];
      const out: PartId[] = [first];
      const ndc = new Vector2(
        ((x - rect.x) / rect.width) * 2 - 1,
        -(((y - rect.y) / rect.height) * 2 - 1),
      );
      raycaster.setFromCamera(ndc, camera);
      const targets: Object3D[] = [];
      for (const p of parts.values()) {
        for (const o of p.objects) if (o.visible && !(o instanceof Points)) targets.push(o);
      }
      for (const h of raycaster.intersectObjects(targets, false)) {
        const id = h.object.userData.part as PartId | undefined;
        if (!id || seeThrough(h.object, h.point) || out.includes(id)) continue;
        if ((PICK_PRIORITY[id] ?? 2) === 0) continue;
        out.push(id);
        if (out.length >= 6) break;
      }
      return out;
    },
    pick(x, y) {
      if (x < rect.x || x > rect.x + rect.width || y < rect.y || y > rect.y + rect.height)
        return null;
      const ndc = new Vector2(
        ((x - rect.x) / rect.width) * 2 - 1,
        -(((y - rect.y) / rect.height) * 2 - 1),
      );
      raycaster.setFromCamera(ndc, camera);
      const targets: Object3D[] = [];
      for (const p of parts.values()) {
        for (const o of p.objects) if (o.visible && !(o instanceof Points)) targets.push(o);
      }
      const hits = raycaster.intersectObjects(targets, false);
      let first: PartId | null = null;
      let firstP = -1;
      for (const h of hits) {
        const id = h.object.userData.part as PartId | undefined;
        if (!id) continue;
        const pr = seeThrough(h.object, h.point) ? 0 : (PICK_PRIORITY[id] ?? 2);
        if (first === null) {
          if (pr === 0) {
            // See-through skins: take what lies under them if anything does.
            first = id;
            firstP = 0;
            continue;
          }
          return pickBehind(id, pr, hits, h.distance);
        }
        if (firstP === 0 && pr > 0) return pickBehind(id, pr, hits, h.distance);
      }
      return first;
    },
    where(part) {
      const p = parts.get(part);
      if (!p) return null;
      const anchor = ANCHOR[part]?.(g, lensEq, pupilR) ?? null;
      if (!anchor) return null;
      const v = new Vector3(anchor[0], anchor[1], anchor[2])
        .applyMatrix4(root.matrixWorld)
        .project(camera);
      return {
        x: rect.x + ((v.x + 1) / 2) * rect.width,
        y: rect.y + ((1 - v.y) / 2) * rect.height,
      };
    },
    dispose() {
      for (const x of owned) x.dispose();
      owned.length = 0;
      scene.traverse((o) => {
        const m = o as Mesh;
        if (m.geometry) m.geometry.dispose();
      });
    },
  };

  /** Ghost skins, and the realistic upper half once the eye is open, let taps through. */
  function seeThrough(o: Object3D, point?: Vector3): boolean {
    if (o.userData.seeThrough === true || (o.userData.upper === true && openness > 0.5))
      return true;
    // Cut open, whatever lies above the cut (the cornea's dome, the tear film) is cut away.
    if (point && openness > 0.5) return root.worldToLocal(point.clone()).y > 0.05;
    return false;
  }

  /** A ray that first meets the vitreous or aqueous face takes a small feature just behind. */
  function pickBehind(
    id: PartId,
    pr: number,
    hits: { object: Object3D; distance: number; point: Vector3 }[],
    dist: number,
  ): PartId {
    if (pr !== 1) return id;
    for (const h of hits) {
      if (h.distance <= dist) continue;
      const other = h.object.userData.part as PartId | undefined;
      if (!other || seeThrough(h.object, h.point)) continue;
      const p = PICK_PRIORITY[other] ?? 2;
      if (p >= 3) return other;
      if (p === 2) return id;
    }
    return id;
  }
};

/** A point to aim the ghost hand at for each part, in the eye's own frame. */
const ANCHOR: Partial<
  Record<PartId, (g: Globe, lensEq: P, pupilR: number) => [number, number, number]>
> = {
  whole: (g) => [g.equator[0], -g.equator[1] * 0.7, 0],
  cornea: () => [0.4, -2.5, 0],
  tearFilm: () => [0.2, -1, 0],
  conjunctiva: (g) => [g.limbus[0] + 2, -g.limbus[1] - 1, 0],
  sclera: (g) => [g.equator[0], 0.02, g.equator[1] - 0.25],
  aqueous: () => [2, 0, 1.5],
  angle: (g) => [g.limbus[0] + 0.5, 0, g.limbus[1] - 0.4],
  iris: (_g, _l, p) => [3.4, 0, p + 2],
  pupil: (_g, _l, p) => [3.5, 0, p * 0.5],
  ciliary: (g) => [g.limbus[0] + 2.5, 0, g.limbus[1] - 0.8],
  zonules: (_g, l) => [l[0], 0, l[1] + 0.4],
  lens: (_g, l) => [l[0], 0, 1.5],
  vitreous: (g) => [g.equator[0] + 2, 0, 3],
  retina: (g) => [g.L - 2.5, -4, 0],
  macula: (g) => [g.L - 0.1, -1.5, 0],
  fovea: (g) => [g.L, -0.4, 0],
  disc: (g) => [g.disc.at[0], -0.4, -g.disc.at[1]],
  nerve: (g) => [g.nerve.at[0] + 3, 0, -g.nerve.at[1] - 2],
  choroid: (g) => [g.L + 0.15, 0, 3],
  muscles: (g) => [g.equator[0] + 2, -g.equator[1] - 0.5, 0],
  photoreceptors: (g) => [g.L - 0.5, -3, 0],
};
