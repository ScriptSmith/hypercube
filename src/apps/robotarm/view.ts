/**
 * The 3D view, with three.js through its public API. One WebGL renderer for the frame draws
 * each arm's scene into that arm's lane, with the camera framed so the bench and the arm's reach
 * fill the lane's focus rectangle (the part clear of the controls).
 *
 * The arm is a node per joint, each rotated about one local axis exactly as kinematics.ts
 * defines, so the drawing and the simulation agree. Materials are few and simple (Phong, basic
 * and points) to keep shader compiles short; programs compile in the background before the
 * first draw. Shadows are soft blobs under each piece and under the gripper.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  HemisphereLight,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  RepeatWrapping,
  RingGeometry,
  Scene,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  type Texture,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { FrameInfo, Rect } from "../../core/types";
import { BALL, BENCH_BACK, BENCH_DEPTH, BENCH_R, BLOCK, type Lift } from "./bench";
import { BEAM_R, type BeamExit, beamExit, frameCamera } from "./camera";
import { type Cell, type CellEvent, drawnJoints } from "./cell";
import { ARM, forward, GRIP, JOINT_COUNT } from "./kinematics";
import type { CellLayout, Layout } from "./layout";
import { matFromQuat, slerp } from "./math";
import { lowestOffset } from "./pieces";
import { ORBIT } from "./orbit";
import { BEAM, JOINT_COLORS, PIECE_COLORS } from "./palette";

export interface View {
  /** Size the renderer and frame each arm's camera. */
  setup(frame: FrameInfo, layout: Layout): void;
  /** `held[cell][joint]` is true while that joint's dial has a finger on it. */
  draw(
    cells: readonly Cell[],
    alpha: number,
    dt: number,
    held: readonly (readonly boolean[])[],
  ): void;
  event(cell: number, e: CellEvent): void;
  /**
   * Where a cell's lift beam leaves the frame's top edge and its width (shares of the frame's
   * width), and its length in world units; null without a lift.
   */
  beam(cell: number): { u: number; w: number; visible: boolean; length: number } | null;
  /** Turn a cell's camera to these orbit angles, degrees. */
  setOrbit(cell: number, azimuth: number, elevation: number): void;
  /** True once the shaders have compiled and the first frame is drawn. */
  readonly ready: boolean;
  readonly particles: number;
  dispose(): void;
}

/** Key light from the front left, a cool rim from behind and a warm fill, for the usual view. */
const LIGHTS = [
  { color: 0xffffff, intensity: 2.3, x: -5, y: 8, z: 6 },
  { color: 0x9ab8ff, intensity: 2.2, x: 4, y: 5, z: -7 },
  { color: 0xffe6cc, intensity: 0.6, x: 6, y: 2, z: 4 },
] as const;
const MAX_PARTICLES = 220;
const RINGS = 4;

const ARM_BODY = "#c3cad8";
const ARM_DARK = "#2b3344";
const ARM_TRIM = "#59647a";

// ---- Textures -------------------------------------------------------------------------------

const canvasTexture = (
  size: number,
  draw: (g: CanvasRenderingContext2D, s: number) => void,
): CanvasTexture => {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
  if (g) draw(g, size);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
};

const blobTexture = () =>
  canvasTexture(128, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, "rgba(0,0,0,0.85)");
    grad.addColorStop(0.45, "rgba(0,0,0,0.45)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });

const glowTexture = () =>
  canvasTexture(128, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.3, "rgba(255,255,255,0.6)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });

/** Bright along the middle and fading to the edges; from the foot (bottom) to the top edge. */
const beamTexture = () => {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 128;
  const g = c.getContext("2d");
  if (g) {
    const img = g.createImageData(64, 128);
    const across = (x: number) => {
      const pts = BEAM.across;
      for (let i = 1; i < pts.length; i++) {
        const [x1, a1] = pts[i]!;
        const [x0, a0] = pts[i - 1]!;
        if (x <= x1) return a0 + ((a1 - a0) * (x - x0)) / (x1 - x0);
      }
      return 0;
    };
    for (let y = 0; y < 128; y++) {
      const v = 1 - y / 127;
      const along = BEAM.foot + (BEAM.top - BEAM.foot) * Math.pow(v, 0.6);
      for (let x = 0; x < 64; x++) {
        const i = (y * 64 + x) * 4;
        img.data[i] = 255;
        img.data[i + 1] = 255;
        img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(255 * along * across(x / 63));
      }
    }
    g.putImageData(img, 0, 0);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
};

const gridTexture = () => {
  const t = canvasTexture(256, (g, s) => {
    g.fillStyle = "#1a2236";
    g.fillRect(0, 0, s, s);
    g.strokeStyle = "rgba(140,170,230,0.22)";
    g.lineWidth = 3;
    g.strokeRect(0, 0, s, s);
    g.strokeStyle = "rgba(140,170,230,0.08)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(s / 2, 0);
    g.lineTo(s / 2, s);
    g.moveTo(0, s / 2);
    g.lineTo(s, s / 2);
    g.stroke();
  });
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  // One texture tile per 0.72 world units: two block widths.
  t.repeat.set(1 / 0.72, 1 / 0.72);
  t.anisotropy = 4;
  return t;
};

// ---- Shared resources -----------------------------------------------------------------------

interface Shared {
  geo: {
    block: BufferGeometry;
    ball: BufferGeometry;
    band: BufferGeometry;
    blob: BufferGeometry;
    unitCyl: BufferGeometry;
    ring: BufferGeometry;
    burst: BufferGeometry;
    cone: BufferGeometry;
  };
  mat: {
    body: MeshPhongMaterial;
    dark: MeshPhongMaterial;
    trim: MeshPhongMaterial;
    finger: MeshPhongMaterial;
    band: MeshPhongMaterial;
    blob: MeshBasicMaterial;
    line: MeshBasicMaterial;
  };
  tex: { blob: Texture; glow: Texture; grid: Texture; beam: Texture };
  disposables: { dispose(): void }[];
}

const createShared = (): Shared => {
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };
  const tex = {
    blob: keep(blobTexture()),
    glow: keep(glowTexture()),
    grid: keep(gridTexture()),
    beam: keep(beamTexture()),
  };
  const unitCyl = keep(new CylinderGeometry(1, 1, 1, 10, 1, true));
  unitCyl.translate(0, 0.5, 0);
  const blob = keep(new PlaneGeometry(1, 1));
  blob.rotateX(-Math.PI / 2);
  const ring = keep(new RingGeometry(0.15, 0.2, 40));
  ring.rotateX(-Math.PI / 2);
  const burst = keep(new RingGeometry(0.42, 0.5, 48));
  burst.rotateX(-Math.PI / 2);
  return {
    geo: {
      block: keep(new RoundedBoxGeometry(BLOCK, BLOCK, BLOCK, 3, 0.045)),
      ball: keep(new SphereGeometry(BALL, 28, 18)),
      band: keep(new TorusGeometry(BALL * 0.985, 0.028, 8, 40)),
      blob,
      unitCyl,
      ring,
      burst,
      cone: keep(new ConeGeometry(0.06, 0.14, 12)),
    },
    mat: {
      body: keep(new MeshPhongMaterial({ color: ARM_BODY, shininess: 70, specular: 0x667088 })),
      dark: keep(new MeshPhongMaterial({ color: ARM_DARK, shininess: 40, specular: 0x334055 })),
      trim: keep(new MeshPhongMaterial({ color: ARM_TRIM, shininess: 60, specular: 0x55607a })),
      finger: keep(new MeshPhongMaterial({ color: "#e9edf5", shininess: 50, specular: 0x556070 })),
      band: keep(new MeshPhongMaterial({ color: "#ffffff", shininess: 30, specular: 0x333333 })),
      blob: keep(
        new MeshBasicMaterial({
          map: tex.blob,
          transparent: true,
          depthWrite: false,
          color: 0x000000,
        }),
      ),
      line: keep(
        new MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.45,
          depthWrite: false,
        }),
      ),
    },
    tex,
    disposables,
  };
};

// ---- One arm's scene ------------------------------------------------------------------------

interface JointRing {
  ring: Mesh;
  mat: MeshBasicMaterial;
  arrow: Group;
  /** Rotation axis of the arrow sweep in the ring's own frame. */
  spin: number;
}

interface PieceMesh {
  mesh: Mesh;
  mat: MeshPhongMaterial;
  band: Mesh | null;
  blob: Mesh;
  kind: "block" | "ball";
}

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  r: number;
  g: number;
  b: number;
}

interface BurstRing {
  mesh: Mesh;
  mat: MeshBasicMaterial;
  t: number;
  max: number;
  size: number;
}

interface CellScene {
  scene: Scene;
  camera: PerspectiveCamera;
  lights: DirectionalLight[];
  lane: Rect;
  focus: Rect;
  /** Orbit angles, degrees. */
  azimuth: number;
  elevation: number;
  nodes: Object3D[];
  fingers: [Mesh, Mesh];
  rings: JointRing[];
  pieces: Map<number, PieceMesh>;
  gripBlob: Mesh;
  dropLine: Mesh;
  target: Mesh;
  targetMat: MeshBasicMaterial;
  points: Points;
  pointsGeo: BufferGeometry;
  particles: Particle[];
  bursts: BurstRing[];
  hoopMat: MeshBasicMaterial | null;
  lift: {
    group: Group;
    rings: MeshBasicMaterial[];
    beamMesh: Mesh;
    exit: BeamExit | null;
  } | null;
  celebrate: number;
  own: { dispose(): void }[];
}

const box = (w: number, h: number, d: number) => new BoxGeometry(w, h, d);

/** A cylinder along x (a joint housing whose axis is the lateral pitch axis). */
const xCylinder = (r: number, len: number, seg = 24) => {
  const g = new CylinderGeometry(r, r, len, seg);
  g.rotateZ(Math.PI / 2);
  return g;
};

const benchGeometry = () => {
  const s = new Shape();
  // Shape y is world -z: the strip behind the base is y > 0, the half disc in front y < 0.
  s.moveTo(-BENCH_R, BENCH_BACK);
  s.lineTo(BENCH_R, BENCH_BACK);
  s.lineTo(BENCH_R, 0);
  s.absarc(0, 0, BENCH_R, 0, -Math.PI, true);
  s.lineTo(-BENCH_R, BENCH_BACK);
  const g = new ExtrudeGeometry(s, {
    depth: BENCH_DEPTH,
    bevelEnabled: true,
    bevelSize: 0.05,
    bevelThickness: 0.05,
    bevelSegments: 2,
    curveSegments: 48,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -BENCH_DEPTH - 0.05, 0);
  return g;
};

const buildCell = (shared: Shared, cell: Cell, guides: boolean): CellScene => {
  const own: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T): T => {
    own.push(x);
    return x;
  };
  const { geo, mat } = shared;
  const scene = new Scene();
  scene.add(new HemisphereLight(0xc8d8ff, 0x1a1426, 1.35));
  const lights = LIGHTS.map((l) => {
    const d = new DirectionalLight(l.color, l.intensity);
    d.position.set(l.x, l.y, l.z);
    scene.add(d);
    return d;
  });

  // Floor glow and the bench.
  const glowMat = keep(
    new MeshBasicMaterial({
      map: shared.tex.glow,
      color: 0x3a5aa8,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      blending: AdditiveBlending,
    }),
  );
  const glow = new Mesh(geo.blob, glowMat);
  glow.scale.set(10, 1, 8);
  glow.position.set(0, -BENCH_DEPTH - 0.6, 0.9);
  scene.add(glow);
  const benchTop = keep(
    new MeshPhongMaterial({ map: shared.tex.grid, shininess: 12, specular: 0x222a3a }),
  );
  const benchSide = keep(
    new MeshPhongMaterial({ color: "#232c42", shininess: 30, specular: 0x2a3550 }),
  );
  const bench = new Mesh(keep(benchGeometry()), [benchTop, benchSide]);
  scene.add(bench);
  const edgeMat = keep(
    new MeshBasicMaterial({ color: 0x5d7fc4, transparent: true, opacity: 0.55 }),
  );
  const edge = new Mesh(keep(new TorusGeometry(BENCH_R + 0.05, 0.018, 6, 96, Math.PI)), edgeMat);
  // The torus's half turn runs through its local +y, which this turns to the front (+z).
  edge.rotation.x = Math.PI / 2;
  edge.position.y = 0.002;
  scene.add(edge);

  // Bins.
  for (const b of cell.bench.bins) {
    const color = new Color(PIECE_COLORS[b.color] ?? "#ffffff");
    const wallMat = keep(
      new MeshPhongMaterial({
        color: color.clone().multiplyScalar(0.42),
        shininess: 40,
        specular: 0x333344,
      }),
    );
    const rimMat = keep(new MeshBasicMaterial({ color }));
    const floorMat = keep(
      new MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    const g = new Group();
    g.position.set(b.x, 0, b.z);
    g.rotation.y = b.yaw;
    const inner = b.half - b.wall;
    const wallH = b.rim;
    const sides: [number, number, number, number][] = [
      [0, b.half - b.wall / 2, 2 * b.half, b.wall],
      [0, -(b.half - b.wall / 2), 2 * b.half, b.wall],
      [b.half - b.wall / 2, 0, b.wall, 2 * inner],
      [-(b.half - b.wall / 2), 0, b.wall, 2 * inner],
    ];
    for (const [x, z, w, d] of sides) {
      const wall = new Mesh(keep(box(w, wallH, d)), wallMat);
      wall.position.set(x, wallH / 2, z);
      g.add(wall);
      const top = new Mesh(keep(box(w + 0.004, 0.03, d + 0.004)), rimMat);
      top.position.set(x, wallH, z);
      g.add(top);
    }
    const floor = new Mesh(keep(new PlaneGeometry(2 * inner, 2 * inner)), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = b.floor + 0.002;
    g.add(floor);
    scene.add(g);
  }

  // Pad and hoop.
  let hoopMat: MeshBasicMaterial | null = null;
  if (cell.bench.pad && cell.bench.hoop) {
    const pad = cell.bench.pad;
    const hoop = cell.bench.hoop;
    const padMesh = new Mesh(
      keep(new CylinderGeometry(pad.r, pad.r * 1.04, pad.top, 40)),
      keep(new MeshPhongMaterial({ color: "#3a4560", shininess: 50 })),
    );
    padMesh.position.set(pad.x, pad.top / 2, pad.z);
    scene.add(padMesh);
    const padRing = new Mesh(
      keep(new RingGeometry(pad.r * 0.82, pad.r * 0.92, 48)),
      keep(new MeshBasicMaterial({ color: 0xffcc33 })),
    );
    padRing.rotation.x = -Math.PI / 2;
    padRing.position.set(pad.x, pad.top + 0.003, pad.z);
    scene.add(padRing);
    hoopMat = keep(new MeshBasicMaterial({ color: 0xffcc33, transparent: true, opacity: 0.9 }));
    const ring = new Mesh(keep(new TorusGeometry(hoop.r, 0.03, 10, 64)), hoopMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(hoop.x, hoop.y, hoop.z);
    scene.add(ring);
    const postMat = keep(new MeshPhongMaterial({ color: "#6a7898", shininess: 60 }));
    for (const side of [-1, 1]) {
      const post = new Mesh(keep(new CylinderGeometry(0.025, 0.025, hoop.y, 8)), postMat);
      post.position.set(hoop.x + side * (hoop.r + 0.03), hoop.y / 2, hoop.z);
      scene.add(post);
    }
  }

  // A bank's lift: a flush platform, a beam of light up out of the view, and a ring in each
  // piece colour that glows while the screen wants that colour.
  let lift: CellScene["lift"] = null;
  if (cell.bench.lift) {
    const l = cell.bench.lift;
    const group = new Group();
    group.position.set(l.x, 0, l.z);
    const plate = new Mesh(
      keep(new CylinderGeometry(l.r, l.r * 1.03, l.top, 40)),
      keep(new MeshPhongMaterial({ color: "#33415f", shininess: 60 })),
    );
    plate.position.y = l.top / 2;
    group.add(plate);
    const rim = new Mesh(
      keep(new RingGeometry(l.r * 0.84, l.r * 0.98, 48)),
      keep(new MeshBasicMaterial({ color: 0xbfe6ff })),
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = l.top + 0.003;
    group.add(rim);
    // The beam faces the camera and is placed by `aim` (camera.ts), in world space so the arm
    // in front of it hides it.
    const beamMesh = new Mesh(
      keep(new PlaneGeometry(1, 1)),
      keep(
        new MeshBasicMaterial({
          map: shared.tex.beam,
          color: BEAM.color,
          transparent: true,
          opacity: BEAM.opacity,
          depthWrite: false,
          blending: AdditiveBlending,
          side: DoubleSide,
        }),
      ),
    );
    beamMesh.visible = false;
    scene.add(beamMesh);
    const rings: MeshBasicMaterial[] = [];
    for (let c = 0; c < 3; c++) {
      const m = keep(
        new MeshBasicMaterial({
          color: PIECE_COLORS[c] ?? "#ffffff",
          transparent: true,
          opacity: 0.2,
        }),
      );
      const ring = new Mesh(keep(new TorusGeometry(l.r * 0.95, 0.03, 8, 40)), m);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.75 + c * 0.32;
      group.add(ring);
      rings.push(m);
    }
    group.visible = false;
    scene.add(group);
    lift = { group, rings, beamMesh, exit: null };
  }

  // The arm: a node per joint, built along local y as in kinematics.ts.
  const nodes: Object3D[] = [];
  const plinth = new Mesh(keep(new CylinderGeometry(0.62, 0.68, 0.2, 40)), mat.dark);
  plinth.position.y = 0.1;
  scene.add(plinth);
  const n1 = new Object3D();
  scene.add(n1);
  const turret = new Mesh(keep(new CylinderGeometry(0.44, 0.5, ARM.d1 - 0.38, 36)), mat.body);
  turret.position.y = 0.2 + (ARM.d1 - 0.38) / 2;
  n1.add(turret);
  const collar = new Mesh(keep(new CylinderGeometry(0.47, 0.47, 0.06, 36)), mat.trim);
  collar.position.y = 0.24;
  n1.add(collar);
  const shoulderBox = new Mesh(keep(new RoundedBoxGeometry(0.64, 0.5, 0.62, 3, 0.1)), mat.body);
  shoulderBox.position.y = ARM.d1 - 0.12;
  n1.add(shoulderBox);
  const n2 = new Object3D();
  n2.position.y = ARM.d1;
  n1.add(n2);
  const shoulder = new Mesh(keep(xCylinder(0.3, 0.74)), mat.dark);
  n2.add(shoulder);
  const upper = new Mesh(keep(new CapsuleGeometry(0.19, ARM.a2 - 0.2, 6, 20)), mat.body);
  upper.position.y = ARM.a2 / 2;
  n2.add(upper);
  const n3 = new Object3D();
  n3.position.y = ARM.a2;
  n2.add(n3);
  const elbow = new Mesh(keep(xCylinder(0.24, 0.58)), mat.dark);
  n3.add(elbow);
  const fore1 = new Mesh(keep(new CylinderGeometry(0.17, 0.18, 0.42, 24)), mat.body);
  fore1.position.y = 0.26;
  n3.add(fore1);
  const n4 = new Object3D();
  n3.add(n4);
  const rollCollar = new Mesh(keep(new CylinderGeometry(0.18, 0.18, 0.05, 24)), mat.trim);
  rollCollar.position.y = 0.5;
  n4.add(rollCollar);
  const fore2 = new Mesh(keep(new CapsuleGeometry(0.145, ARM.d4 - 0.85, 6, 20)), mat.body);
  fore2.position.y = 0.52 + (ARM.d4 - 0.85) / 2 + 0.1;
  n4.add(fore2);
  for (const side of [-1, 1]) {
    const fork = new Mesh(keep(new RoundedBoxGeometry(0.07, 0.36, 0.26, 2, 0.03)), mat.body);
    fork.position.set(side * 0.2, ARM.d4 - 0.12, 0);
    n4.add(fork);
  }
  const n5 = new Object3D();
  n5.position.y = ARM.d4;
  n4.add(n5);
  const wrist = new Mesh(keep(xCylinder(0.15, 0.34)), mat.dark);
  n5.add(wrist);
  const neck = new Mesh(keep(new CylinderGeometry(0.11, 0.13, 0.16, 20)), mat.body);
  neck.position.y = 0.08;
  n5.add(neck);
  const n6 = new Object3D();
  n5.add(n6);
  const flange = new Mesh(keep(new CylinderGeometry(0.15, 0.15, 0.06, 24)), mat.trim);
  flange.position.y = 0.15;
  n6.add(flange);
  const palm = new Mesh(
    keep(
      new RoundedBoxGeometry(
        2 * GRIP.palmHalf.c,
        2 * GRIP.palmHalf.t,
        2 * GRIP.palmHalf.b,
        2,
        0.03,
      ),
    ),
    mat.dark,
  );
  palm.position.y = GRIP.palmAt;
  n6.add(palm);
  const fingerLen = GRIP.fingerTo - GRIP.fingerFrom;
  const fingerGeo = keep(
    new RoundedBoxGeometry(2 * GRIP.fingerHalfC, fingerLen, 2 * GRIP.fingerHalfB, 2, 0.02),
  );
  const fingers: [Mesh, Mesh] = [new Mesh(fingerGeo, mat.finger), new Mesh(fingerGeo, mat.finger)];
  for (const f of fingers) {
    f.position.y = GRIP.fingerFrom + fingerLen / 2;
    n6.add(f);
  }
  nodes.push(n1, n2, n3, n4, n5, n6);

  // Joint rings in their dials' colours, each with an arrow shown while its dial is held.
  const rings: JointRing[] = [];
  const ringSpecs: { node: Object3D; r: number; axis: "x" | "y"; at: [number, number, number] }[] =
    [
      { node: n1, r: 0.56, axis: "y", at: [0, 0.42, 0] },
      { node: n2, r: 0.34, axis: "x", at: [0.39, 0, 0] },
      { node: n3, r: 0.28, axis: "x", at: [0.31, 0, 0] },
      { node: n4, r: 0.22, axis: "y", at: [0, 0.5, 0] },
      { node: n5, r: 0.19, axis: "x", at: [0.19, 0, 0] },
      { node: n6, r: 0.2, axis: "y", at: [0, 0.15, 0] },
    ];
  ringSpecs.forEach((spec, j) => {
    const color = new Color(JOINT_COLORS[j] ?? "#ffffff");
    const m = keep(new MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }));
    const ring = new Mesh(keep(new TorusGeometry(spec.r, 0.035, 8, 48)), m);
    const holder = new Group();
    holder.position.set(...spec.at);
    if (spec.axis === "y") holder.rotation.x = Math.PI / 2;
    else holder.rotation.y = Math.PI / 2;
    holder.add(ring);
    // The arrow: an arc and a cone, in the ring's plane, swept round while the joint turns.
    const arrow = new Group();
    const arc = new Mesh(keep(new TorusGeometry(spec.r + 0.11, 0.028, 6, 32, Math.PI * 0.9)), m);
    arrow.add(arc);
    const cone = new Mesh(geo.cone, m);
    const end = Math.PI * 0.9;
    cone.position.set(Math.cos(end) * (spec.r + 0.11), Math.sin(end) * (spec.r + 0.11), 0);
    cone.rotation.z = end;
    arrow.add(cone);
    arrow.visible = false;
    holder.add(arrow);
    spec.node.add(holder);
    rings.push({ ring, mat: m, arrow, spin: 0 });
    if (!guides) ring.visible = false;
  });

  // Guides: the line straight down from the grip point, and a ring where it meets the floor.
  const dropLine = new Mesh(geo.unitCyl, mat.line);
  dropLine.visible = guides;
  scene.add(dropLine);
  const targetMat = keep(
    new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      side: DoubleSide,
    }),
  );
  const target = new Mesh(geo.ring, targetMat);
  target.visible = guides;
  scene.add(target);
  const gripBlob = new Mesh(geo.blob, mat.blob);
  scene.add(gripBlob);

  // Particles and burst rings.
  const pointsGeo = keep(new BufferGeometry());
  pointsGeo.setAttribute("position", new BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3));
  pointsGeo.setAttribute("color", new BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3));
  pointsGeo.setDrawRange(0, 0);
  const pointsMat = keep(
    new PointsMaterial({
      size: 0.12,
      map: shared.tex.glow,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      sizeAttenuation: true,
    }),
  );
  const points = new Points(pointsGeo, pointsMat);
  points.frustumCulled = false;
  scene.add(points);
  const bursts: BurstRing[] = [];
  for (let i = 0; i < RINGS; i++) {
    const m = keep(
      new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    const mesh = new Mesh(geo.burst, m);
    mesh.visible = false;
    scene.add(mesh);
    bursts.push({ mesh, mat: m, t: 1, max: 1, size: 1 });
  }

  return {
    scene,
    camera: new PerspectiveCamera(30, 1, 0.5, 80),
    lights,
    lane: { x: 0, y: 0, width: 1, height: 1 },
    focus: { x: 0, y: 0, width: 1, height: 1 },
    azimuth: ORBIT.azimuth,
    elevation: ORBIT.elevation,
    nodes,
    fingers,
    rings,
    pieces: new Map(),
    gripBlob,
    dropLine,
    target,
    targetMat,
    points,
    pointsGeo,
    particles: [],
    bursts,
    hoopMat,
    lift,
    celebrate: 0,
    own,
  };
};

/** Aim a cell's camera from its orbit angles, turn the lights with it, and stand its beam up. */
const aim = (cs: CellScene, frameWidth: number, lift: Lift | null) => {
  frameCamera(cs.camera, cs.lane, cs.focus, cs.azimuth, cs.elevation);
  // The lights turn with the camera, so whichever side is in view stays lit the same way.
  const turn = ((cs.azimuth - ORBIT.azimuth) * Math.PI) / 180;
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  LIGHTS.forEach((l, i) => cs.lights[i]?.position.set(l.x * c + l.z * s, l.y, -l.x * s + l.z * c));
  if (cs.lift && lift) {
    const e = beamExit(cs.camera, cs.lane, frameWidth, lift);
    cs.lift.exit = e;
    const beam = cs.lift.beamMesh;
    beam.position.copy(e.base).add(e.top).multiplyScalar(0.5);
    beam.quaternion.copy(cs.camera.quaternion);
    beam.scale.set(2 * BEAM_R, Math.max(0.01, e.length), 1);
    beam.visible = e.visible;
  }
};

// ---- The view -------------------------------------------------------------------------------

export const createView = (root: HTMLElement, cells: readonly Cell[], guides: boolean): View => {
  const canvas = document.createElement("canvas");
  canvas.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;z-index:0;display:block;";
  root.append(canvas);
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false;
  const shared = createShared();
  const scenes = cells.map((c) => buildCell(shared, c, guides));
  let frameH = 1;
  let frameW = 1;
  let ready = false;
  let compiling = false;
  let disposed = false;
  let liveParticles = 0;
  const tmpQ = new Quaternion();
  const skipOne = new Set<number>();
  const upDir = new Vector3();
  const skipGrip = new Set<number>();

  const compile = () => {
    if (compiling || ready) return;
    compiling = true;
    const first = scenes[0];
    if (!first) {
      ready = true;
      return;
    }
    // Compile every program in the background; draw nothing until they're ready.
    Promise.all(scenes.map((s) => renderer.compileAsync(s.scene, s.camera)))
      .catch(() => undefined)
      .then(() => {
        if (!disposed) ready = true;
      });
  };

  const pieceMesh = (
    cs: CellScene,
    id: number,
    kind: "block" | "ball",
    color: number,
  ): PieceMesh => {
    let pm = cs.pieces.get(id);
    if (pm && pm.kind === kind) {
      pm.mat.color.set(PIECE_COLORS[color] ?? "#ffffff");
      return pm;
    }
    if (pm) {
      cs.scene.remove(pm.mesh, pm.blob);
      pm.mat.dispose();
      (pm.blob.material as Material).dispose();
    }
    const m = new MeshPhongMaterial({
      color: PIECE_COLORS[color] ?? "#ffffff",
      shininess: kind === "ball" ? 90 : 55,
      specular: 0x444444,
      transparent: true,
    });
    const mesh = new Mesh(kind === "block" ? shared.geo.block : shared.geo.ball, m);
    let band: Mesh | null = null;
    if (kind === "ball") {
      band = new Mesh(shared.geo.band, shared.mat.band);
      mesh.add(band);
    }
    const blob = new Mesh(shared.geo.blob, shared.mat.blob.clone());
    cs.scene.add(mesh, blob);
    pm = { mesh, mat: m, band, blob, kind };
    cs.pieces.set(id, pm);
    return pm;
  };

  const spawnParticles = (
    cs: CellScene,
    x: number,
    y: number,
    z: number,
    color: string,
    n: number,
    speed: number,
  ) => {
    const c = new Color(color);
    for (let i = 0; i < n; i++) {
      if (cs.particles.length >= MAX_PARTICLES) cs.particles.shift();
      const a = Math.random() * Math.PI * 2;
      const up = 0.4 + Math.random() * 0.8;
      const s = speed * (0.4 + Math.random() * 0.8);
      const life = 0.6 + Math.random() * 0.7;
      cs.particles.push({
        x,
        y,
        z,
        vx: Math.cos(a) * s,
        vy: up * speed * 1.4,
        vz: Math.sin(a) * s,
        life,
        max: life,
        r: c.r,
        g: c.g,
        b: c.b,
      });
    }
  };

  const ringBurst = (
    cs: CellScene,
    x: number,
    y: number,
    z: number,
    color: string,
    size: number,
  ) => {
    let r = cs.bursts[0]!;
    for (const b of cs.bursts) if (b.t / b.max > r.t / r.max) r = b;
    r.t = 0;
    r.max = 0.7;
    r.size = size;
    r.mesh.position.set(x, y + 0.01, z);
    r.mat.color.set(color);
    r.mesh.visible = true;
  };

  const updateEffects = (cs: CellScene, dt: number) => {
    const pos = cs.pointsGeo.getAttribute("position") as BufferAttribute;
    const col = cs.pointsGeo.getAttribute("color") as BufferAttribute;
    let n = 0;
    for (let i = cs.particles.length - 1; i >= 0; i--) {
      const p = cs.particles[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        cs.particles.splice(i, 1);
        continue;
      }
      p.vy -= 3.5 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.02) {
        p.y = 0.02;
        p.vy *= -0.3;
      }
    }
    for (const p of cs.particles) {
      const f = Math.min(1, p.life / p.max) * 1.2;
      pos.setXYZ(n, p.x, p.y, p.z);
      col.setXYZ(n, p.r * f, p.g * f, p.b * f);
      n++;
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    cs.pointsGeo.setDrawRange(0, n);
    liveParticles += n;
    for (const b of cs.bursts) {
      if (!b.mesh.visible) continue;
      b.t += dt;
      const f = b.t / b.max;
      if (f >= 1) {
        b.mesh.visible = false;
        continue;
      }
      const s = b.size * (0.5 + 1.2 * f);
      b.mesh.scale.set(s, 1, s);
      b.mat.opacity = 0.9 * (1 - f);
    }
  };

  const drawCell = (
    cs: CellScene,
    cell: Cell,
    alpha: number,
    dt: number,
    held: readonly boolean[],
  ) => {
    const q = drawnJoints(cell, alpha);
    const n = cs.nodes;
    n[0]!.rotation.y = q[0];
    n[1]!.rotation.x = q[1];
    n[2]!.rotation.x = q[2];
    n[3]!.rotation.y = q[3];
    n[4]!.rotation.x = q[4];
    n[5]!.rotation.y = q[5];
    const gap = cell.grip.prevGap + (cell.grip.gap - cell.grip.prevGap) * alpha;
    cs.fingers[0].position.x = gap + GRIP.fingerHalfC;
    cs.fingers[1].position.x = -(gap + GRIP.fingerHalfC);

    for (let j = 0; j < JOINT_COUNT; j++) {
      const r = cs.rings[j]!;
      const on = held[j] === true;
      const moving = cell.target[j]! - cell.q[j]!;
      r.mat.opacity = on ? 1 : 0.7;
      r.ring.scale.setScalar(on ? 1.12 : 1);
      r.arrow.visible = on;
      if (on && Math.abs(moving) > 0.002) {
        r.spin += Math.sign(moving) * dt * 2.4;
      }
      r.arrow.rotation.z = r.spin;
    }

    // Pieces.
    const table = cell.table;
    const seen = new Set<number>();
    for (const p of table.pieces) {
      seen.add(p.id);
      const pm = pieceMesh(cs, p.id, p.kind, p.color);
      const visible = p.state !== "wait" && p.alpha > 0.01;
      pm.mesh.visible = visible;
      pm.blob.visible = visible;
      if (!visible) continue;
      const a = p.state === "held" ? 1 : alpha;
      let x = p.prevPos.x + (p.pos.x - p.prevPos.x) * a;
      let y = p.prevPos.y + (p.pos.y - p.prevPos.y) * a;
      let z = p.prevPos.z + (p.pos.z - p.prevPos.z) * a;
      const exit = cs.lift?.exit;
      const lf = cell.bench.lift;
      if (p.state === "up" && exit && lf) {
        // Up the beam, which stands upright on the frame rather than in the world.
        const along = y - (lf.top + p.half);
        upDir.copy(exit.top).sub(exit.base).normalize();
        x = lf.x + upDir.x * along;
        y = lf.top + p.half + upDir.y * along;
        z = lf.z + upDir.z * along;
      }
      const qq = slerp(p.prevQuat, p.quat, a);
      pm.mesh.position.set(x, y, z);
      pm.mesh.quaternion.copy(tmpQ.set(qq.x, qq.y, qq.z, qq.w));
      let s = 1;
      if (p.state === "gone") s = 1 + 0.5 * Math.min(1, p.timer / 0.25);
      else if (p.landed < 0.18) s = 1 - 0.06 * Math.sin((p.landed / 0.18) * Math.PI);
      pm.mesh.scale.setScalar(s);
      pm.mat.opacity = p.alpha;
      pm.mat.transparent = p.alpha < 0.999;
      pm.mat.depthWrite = p.alpha > 0.5;
      // Shadow on whatever is below.
      const lowest = lowestOffset(p, matFromQuat(p.quat));
      skipOne.clear();
      skipOne.add(p.id);
      const floor = table.floorAt(x, z, p.half * 0.9, true, skipOne);
      const h = Math.max(0, y - lowest - floor);
      const blobMat = pm.blob.material as MeshBasicMaterial;
      blobMat.opacity = Math.max(0, 0.7 - h * 0.3) * p.alpha;
      const bs = p.half * 2.8 * (1 + h * 0.4);
      pm.blob.scale.set(bs, 1, bs);
      pm.blob.position.set(x, floor + 0.004, z);
    }
    for (const [id, pm] of cs.pieces) {
      if (seen.has(id)) continue;
      cs.scene.remove(pm.mesh, pm.blob);
      pm.mat.dispose();
      (pm.blob.material as Material).dispose();
      cs.pieces.delete(id);
    }

    // Guides and the gripper's shadow.
    const pose = forward(q);
    const g = pose.grip;
    skipGrip.clear();
    const held2 = cell.heldPiece();
    if (held2) skipGrip.add(held2.id);
    const straddled = held2 ? [] : cell.straddled();
    for (const s of straddled) skipGrip.add(s.id);
    const floor = table.floorAt(g.x, g.z, 0.05, true, skipGrip);
    const top = held2
      ? held2.pos.y - lowestOffset(held2, matFromQuat(held2.quat))
      : g.y - (GRIP.fingerTo - ARM.d6);
    const gh = Math.max(0.001, top - floor);
    cs.dropLine.position.set(g.x, floor, g.z);
    cs.dropLine.scale.set(0.012, gh, 0.012);
    cs.target.position.set(g.x, floor + 0.006, g.z);
    const ready = straddled.length > 0;
    if (held2) cs.targetMat.color.set(PIECE_COLORS[held2.color] ?? "#ffffff");
    else cs.targetMat.color.set(0xffffff);
    const pulse = ready ? 1 + 0.25 * Math.sin(performance.now() / 120) : 1;
    cs.target.scale.setScalar(pulse * (held2 ? held2.half / 0.18 : 1));
    cs.targetMat.opacity = Math.max(0.25, 0.75 - gh * 0.12);
    const gb = cs.gripBlob.material as MeshBasicMaterial;
    gb.opacity = Math.max(0, 0.55 - gh * 0.18);
    const gs = 0.9 * (1 + gh * 0.35);
    cs.gripBlob.scale.set(gs, 1, gs * 0.6);
    cs.gripBlob.rotation.y = q[0];
    cs.gripBlob.position.set(g.x, floor + 0.003, g.z);

    if (cs.lift) {
      const lf = table.lift;
      cs.lift.group.visible = lf?.active === true;
      cs.lift.beamMesh.visible = lf?.active === true && cs.lift.exit?.visible === true;
      if (lf?.active) {
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 380);
        cs.lift.rings.forEach((m, c) => {
          m.opacity = (lf.needs[c] ?? 0) > 0 ? 0.75 + 0.25 * pulse : 0.14;
        });
      }
    }
    if (cs.hoopMat) {
      cs.celebrate = Math.max(0, cs.celebrate - dt);
      const tower = table.towerTop();
      const near = cell.bench.hoop ? tower / cell.bench.hoop.y : 0;
      const flash = cs.celebrate > 0 ? 0.5 + 0.5 * Math.sin(performance.now() / 70) : 0;
      cs.hoopMat.color.setHSL(0.13, 1, 0.55 + 0.25 * Math.max(flash, near > 0.99 ? 1 : 0));
      cs.hoopMat.opacity = 0.75 + 0.25 * flash;
    }
    updateEffects(cs, dt);
  };

  return {
    setup(frame, layout) {
      const u = frame.unit;
      frameH = frame.height;
      frameW = frame.width;
      renderer.setPixelRatio(frame.pixelRatio);
      renderer.setSize(frame.width, frame.height, false);
      layout.cells.forEach((cl: CellLayout, i) => {
        const cs = scenes[i];
        if (!cs) return;
        const lane = {
          x: cl.lane.x * u,
          y: cl.lane.y * u,
          width: cl.lane.width * u,
          height: cl.lane.height * u,
        };
        const focus = {
          x: cl.focus.x * u,
          y: cl.focus.y * u,
          width: cl.focus.width * u,
          height: cl.focus.height * u,
        };
        cs.lane = lane;
        cs.focus = focus;
        aim(cs, frameW, cells[i]?.bench.lift ?? null);
      });
      compile();
    },
    draw(list, alpha, dt, held) {
      if (disposed) return;
      liveParticles = 0;
      if (!ready) return;
      renderer.setScissorTest(false);
      renderer.clear();
      renderer.setScissorTest(true);
      scenes.forEach((cs, i) => {
        const cell = list[i];
        if (!cell) return;
        drawCell(cs, cell, alpha, dt, held[i] ?? []);
        const l = cs.lane;
        const y = frameH - l.y - l.height;
        renderer.setViewport(l.x, y, l.width, l.height);
        renderer.setScissor(l.x, y, l.width, l.height);
        renderer.render(cs.scene, cs.camera);
      });
    },
    event(i, e) {
      const cs = scenes[i];
      if (!cs) return;
      switch (e.type) {
        case "sorted": {
          const c = PIECE_COLORS[e.color] ?? "#ffffff";
          spawnParticles(cs, e.at.x, e.at.y + 0.2, e.at.z, c, 40, 1.4);
          ringBurst(cs, e.at.x, 0.31, e.at.z, c, 1);
          break;
        }
        case "tower": {
          cs.celebrate = 1.6;
          for (const c of PIECE_COLORS)
            spawnParticles(cs, e.at.x, e.at.y + 0.1, e.at.z, c, 22, 1.8);
          ringBurst(cs, e.at.x, e.at.y, e.at.z, "#ffcc33", 1.2);
          break;
        }
        case "land":
          if (e.speed > 1.2) ringBurst(cs, e.at.x, e.at.y - 0.17, e.at.z, "#c9d6f0", 0.5);
          break;
        case "grab": {
          const p = cells[i]?.table.pieces.find((q) => q.id === e.piece);
          if (p) spawnParticles(cs, p.pos.x, p.pos.y, p.pos.z, "#ffffff", 8, 0.6);
          break;
        }
        default:
          break;
      }
    },
    beam(i) {
      const e = scenes[i]?.lift?.exit;
      return e ? { u: e.u, w: e.w, visible: e.visible, length: e.length } : null;
    },
    setOrbit(i, azimuth, elevation) {
      const cs = scenes[i];
      if (!cs || (cs.azimuth === azimuth && cs.elevation === elevation)) return;
      cs.azimuth = azimuth;
      cs.elevation = elevation;
      aim(cs, frameW, cells[i]?.bench.lift ?? null);
    },
    get ready() {
      return ready;
    },
    get particles() {
      return liveParticles;
    },
    dispose() {
      disposed = true;
      for (const cs of scenes) {
        for (const pm of cs.pieces.values()) {
          pm.mat.dispose();
          (pm.blob.material as Material).dispose();
        }
        cs.pieces.clear();
        for (const d of cs.own) d.dispose();
      }
      for (const d of shared.disposables) d.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
};
