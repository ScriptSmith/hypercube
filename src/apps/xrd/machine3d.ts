/**
 * The diffractometer in 3D: the X-ray tube and its beam, the sample on its stage (the ω ring, the
 * χ ring riding on it and the φ platter riding on that), the arm swinging the detector (a curved
 * strip or a flat plate), flashes on the detector's face with a fading trail, and, for the Maths,
 * the sample's reciprocal lattice with the Ewald sphere. One module draws it everywhere, from the
 * geometry in machine.ts, so chapter 5's dials, the screen's machine and the wall's agree.
 *
 * Two placements:
 * - `close`: true proportions (millimetres) seen through a perspective camera that orbits the
 *   sample, for chapter 5.
 * - `band`: stretched along a band (the screen's lower part, the wall's banner) so each part
 *   hangs over the chapters that explain it, seen through a fixed orthographic camera, with the
 *   computer, a fibre and fingerprint cards beyond the detector. One scene unit is one venue px.
 *
 * Inside the machine's group everything is in millimetres: the lab frame of machine.ts, x along
 * the beam, y up, z towards the room. The group's scale turns millimetres into scene units.
 */
import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  LineLoop,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector3,
} from "three";
import { COLOR } from "./config";
import { CRYSTALS, type CrystalId, powderRings, type Vec3 } from "./crystals";

export { FLAT } from "./machine";
import type { MachineLook } from "./drive";
import {
  apply,
  type Detector,
  DIAL_RANGE,
  FLAT,
  detectorFor,
  detectorHit,
  detectorHeight,
  detectorWidth,
  type LatticePoint,
  latticePoints,
  leavesSurface,
  type Machine,
  mul,
  orientFor,
  SHELL,
  sphereGap,
  stageMatrix,
  type StageAngles,
} from "./machine";
import type { PartId } from "./parts";

const DEG = Math.PI / 180;

export const MAX_SPOTS = 48;
const MAX_RAYS = 10;
const MAX_RINGS = 12;
const RING_SAMPLES = 96;
const MAX_LATTICE = 400;
/** A spot is bright this long, then fades over the rest. */
const FLASH_MS = 500;
const TRAIL_MS = 4500;

export interface Spot {
  /** Across and up the detector's face, -0.5 to 0.5. */
  fu: number;
  fv: number;
  /** performance.now() when it flashed. */
  at: number;
  hkl: string;
}

/** A powder ring's trace on the detector face: runs of (fu, fv) points. */
export interface FaceRing {
  twoTheta: number;
  height: number;
  runs: { fu: number; fv: number }[][];
}

export type Glow = Partial<Record<"omega" | "chi" | "phi" | "arm" | "distance", number>>;

export interface Look3D extends MachineLook {
  /** 0 to 1 per axis: it lights while its dial turns. */
  glow?: Glow;
  /** Show the reciprocal lattice and the Ewald sphere. */
  maths?: boolean;
}

/** Spot brightness at age `ms`: a flash, then a faint trail. */
export const spotLevel = (ms: number): number =>
  ms < 0
    ? 0
    : ms < FLASH_MS
      ? 1
      : ms < TRAIL_MS
        ? 0.35 * (1 - (ms - FLASH_MS) / (TRAIL_MS - FLASH_MS))
        : 0;

export interface BandSpots {
  /** Fractions across the band. */
  tube: number;
  sample: number;
  detector: number;
  computer: number | null;
  fibre: number | null;
  cards: number | null;
}

export interface Machine3D {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera | OrthographicCamera;
  /** Close placement: orbit the sample, degrees. */
  setOrbit(azimuth: number, elevation: number): void;
  /** Band placement: the band's size (venue px) and where each part hangs along it. */
  setBand(width: number, height: number, at: BandSpots): void;
  update(look: Look3D, now: number): void;
  readonly spots: readonly Spot[];
  readonly rings: readonly FaceRing[];
  /** The detector now (its kind and distance). */
  readonly detector: Detector;
  /** Where a part's anchor shows in the view, venue px from the view's top-left. */
  anchor(part: PartId): { x: number; y: number } | null;
  /**
   * Close placement: where to write the tube's, the sample's and the detector's names, as shares
   * of the view from its top-left (just below the tube and the stage, just past the detector).
   */
  names(): Record<"tube" | "sample" | "detector", { x: number; y: number }>;
  /** Flashes counted since the machine was made, for status and tests. */
  readonly flashes: number;
  /** Sample to detector as drawn, mm, and the scene units per mm (for checks). */
  readonly arm: { mm: number; k: number; above: number; below: number; max: number };
  /** Forget the trail and the last setting, so a jump (a reset, a preset) flashes nothing. */
  clear(): void;
  dispose(): void;
}

const glowTexture = (): CanvasTexture => {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,240,210,0.9)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
};

/** Points (u, v) on a circle in a plane, for line loops. */
const circle = (r: number, n: number, plane: "xy" | "yz" | "xz"): Float32Array => {
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const u = Math.cos(a) * r;
    const v = Math.sin(a) * r;
    const p = plane === "xy" ? [u, v, 0] : plane === "yz" ? [0, u, v] : [u, 0, v];
    out.set(p, i * 3);
  }
  return out;
};

export const createMachine3D = (mode: "close" | "band"): Machine3D => {
  const scene = new Scene();
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };
  scene.add(new AmbientLight(0xffffff, 0.75));
  const sun = new DirectionalLight(0xffffff, 1.6);
  sun.position.set(0.4, 1, 0.8);
  scene.add(sun);

  const camera: PerspectiveCamera | OrthographicCamera =
    mode === "close"
      ? new PerspectiveCamera(32, 1, 0.01, 200)
      : new OrthographicCamera(-1, 1, 1, -1, -1e5, 1e5);

  const real = new Color(COLOR.real);
  const hardware = keep(
    new MeshLambertMaterial({ color: real.clone().multiplyScalar(0.8), emissive: 0x000000 }),
  );
  const metal = keep(new MeshLambertMaterial({ color: new Color(0x8a94a8) }));
  const glowTex = keep(glowTexture());

  // Everything inside `root` is in millimetres.
  const root = new Group();
  scene.add(root);

  // ---- Tube and beam ---------------------------------------------------------------------------
  const tube = new Group();
  root.add(tube);
  const tubeBody = new Mesh(keep(new BoxGeometry(70, 46, 46)), hardware);
  tubeBody.position.x = -35;
  tube.add(tubeBody);
  const window_ = new Mesh(
    keep(new CylinderGeometry(6, 6, 4, 16)),
    keep(new MeshBasicMaterial({ color: COLOR.beam })),
  );
  window_.rotation.z = Math.PI / 2;
  window_.position.x = 1;
  tube.add(window_);
  const beamMat = keep(new MeshBasicMaterial({ color: COLOR.beam }));
  const beamIn = new Mesh(keep(new CylinderGeometry(1.6, 1.6, 1, 10)), beamMat);
  beamIn.rotation.z = Math.PI / 2;
  root.add(beamIn);
  const beamOutMat = keep(
    new MeshBasicMaterial({ color: COLOR.beam, transparent: true, opacity: 0.3 }),
  );
  const beamOut = new Mesh(keep(new CylinderGeometry(1.2, 1.2, 1, 8)), beamOutMat);
  beamOut.rotation.z = Math.PI / 2;
  root.add(beamOut);

  // ---- The stage: ω about z, χ about the beam (riding on ω), φ on the sample's normal ----------
  const ringMat = (c: string) =>
    keep(new MeshLambertMaterial({ color: new Color(c).multiplyScalar(0.9), emissive: 0x000000 }));
  const omegaMat = ringMat(COLOR.real);
  const chiMat = ringMat(COLOR.real);
  const phiMat = ringMat(COLOR.real);
  const omegaGroup = new Group();
  root.add(omegaGroup);
  const omegaRing = new Mesh(keep(new TorusGeometry(72, 4.5, 10, 64)), omegaMat);
  omegaGroup.add(omegaRing);
  const chiGroup = new Group();
  omegaGroup.add(chiGroup);
  const chiRing = new Mesh(keep(new TorusGeometry(54, 3.5, 10, 56)), chiMat);
  chiRing.rotation.y = Math.PI / 2;
  omegaGroup.add(chiRing);
  const phiGroup = new Group();
  chiGroup.add(phiGroup);
  const platter = new Mesh(keep(new CylinderGeometry(26, 26, 4, 40)), phiMat);
  platter.position.y = -4;
  phiGroup.add(platter);
  const tick = new Mesh(keep(new BoxGeometry(4, 5, 14)), metal);
  tick.position.set(0, -3, 22);
  phiGroup.add(tick);
  // The samples, one shown at a time.
  const sampleMat = keep(
    new MeshLambertMaterial({ color: real, emissive: real.clone().multiplyScalar(0.15) }),
  );
  const samples = {
    single: new Mesh(keep(new BoxGeometry(22, 5, 22)), sampleMat),
    powder: new Mesh(
      keep(new CylinderGeometry(13, 13, 4, 28)),
      keep(new MeshLambertMaterial({ color: new Color(0xd8f0de) })),
    ),
    foil: new Mesh(
      keep(new BoxGeometry(26, 0.8, 26)),
      keep(new MeshLambertMaterial({ color: new Color(0xc9d4dc) })),
    ),
    fibre: new Mesh(keep(new CylinderGeometry(2.5, 2.5, 26, 10)), sampleMat),
  };
  samples.fibre.rotation.z = Math.PI / 2;
  for (const m of Object.values(samples)) {
    m.position.y = 0.5;
    phiGroup.add(m);
  }

  // ---- Arm and detector -------------------------------------------------------------------------
  const armGroup = new Group();
  root.add(armGroup);
  const armBar = new Mesh(keep(new BoxGeometry(1, 6, 6)), metal);
  armGroup.add(armBar);
  const armMat = keep(new MeshLambertMaterial({ color: new Color(0x8a94a8), emissive: 0x000000 }));
  armBar.material = armMat;
  const detectorMat = keep(
    new MeshLambertMaterial({
      color: real.clone().multiplyScalar(0.6),
      emissive: real.clone().multiplyScalar(0.12),
      side: DoubleSide,
    }),
  );
  let detectorMesh: Mesh | null = null;
  let detectorKey = "";

  // ---- Flashes: spots on the face, rays from the sample ----------------------------------------
  const spotGroup = new Group();
  root.add(spotGroup);
  const spotSprites: Sprite[] = [];
  for (let i = 0; i < MAX_SPOTS; i++) {
    const m = keep(
      new SpriteMaterial({
        map: glowTex,
        color: COLOR.recip,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    const s = new Sprite(m);
    s.visible = false;
    spotGroup.add(s);
    spotSprites.push(s);
  }
  const centreFlash = new Sprite(
    keep(
      new SpriteMaterial({
        map: glowTex,
        color: COLOR.recip,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    ),
  );
  centreFlash.visible = false;
  root.add(centreFlash);
  // Scattered beams: a magenta rod from the sample to each flash, fading.
  const rayGeo = keep(new CylinderGeometry(1, 1, 1, 10));
  const rays: Mesh[] = [];
  for (let i = 0; i < MAX_RAYS; i++) {
    const r = new Mesh(
      rayGeo,
      keep(
        new MeshBasicMaterial({
          color: COLOR.scattered,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      ),
    );
    r.visible = false;
    root.add(r);
    rays.push(r);
  }
  // A burst at the sample when it scatters.
  const sampleFlash = new Sprite(
    keep(
      new SpriteMaterial({
        map: glowTex,
        color: COLOR.scattered,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    ),
  );
  sampleFlash.visible = false;
  root.add(sampleFlash);
  let lastFlashAt = Number.NEGATIVE_INFINITY;
  const rayAt: number[] = Array.from({ length: MAX_RAYS }, () => Number.NEGATIVE_INFINITY);
  let nextRay = 0;

  // Powder rings traced on the face.
  const ringLines: Line[] = [];
  for (let i = 0; i < MAX_RINGS; i++) {
    const geo = keep(new BufferGeometry());
    geo.setAttribute("position", new Float32BufferAttribute(new Float32Array(RING_SAMPLES * 3), 3));
    const l = new Line(
      geo,
      keep(new LineBasicMaterial({ color: COLOR.recip, transparent: true, opacity: 0.9 })),
    );
    l.visible = false;
    root.add(l);
    ringLines.push(l);
  }

  // ---- Reciprocal lattice and the Ewald sphere (the Maths) -------------------------------------
  const mathsGroup = new Group();
  root.add(mathsGroup);
  const latticeMesh = new InstancedMesh(
    keep(new SphereGeometry(1, 8, 6)),
    keep(new MeshBasicMaterial({ color: 0xffffff })),
    MAX_LATTICE,
  );
  // Colour every instance once now, so the program with instance colours compiles up front.
  latticeMesh.setColorAt(0, new Color(COLOR.recip));
  latticeMesh.count = 0;
  mathsGroup.add(latticeMesh);
  const sphereMat = keep(
    new LineBasicMaterial({ color: COLOR.recip, transparent: true, opacity: 0.5 }),
  );
  const sphereLines: LineLoop[] = (["xy", "yz", "xz"] as const).map((p) => {
    const geo = keep(new BufferGeometry());
    geo.setAttribute("position", new Float32BufferAttribute(circle(1, 72, p), 3));
    const l = new LineLoop(geo, sphereMat);
    mathsGroup.add(l);
    return l;
  });
  const sphereShell = new Mesh(
    keep(new SphereGeometry(1, 32, 20)),
    keep(
      new MeshBasicMaterial({
        color: COLOR.recip,
        transparent: true,
        opacity: 0.05,
        depthWrite: false,
      }),
    ),
  );
  mathsGroup.add(sphereShell);
  mathsGroup.visible = false;

  // ---- Band extras: computer, fibre, cards ------------------------------------------------------
  const extras = new Group();
  root.add(extras);
  const computer = new Group();
  const screenCanvas = document.createElement("canvas");
  screenCanvas.width = 128;
  screenCanvas.height = 96;
  const screenTex = keep(new CanvasTexture(screenCanvas));
  const monitor = new Mesh(keep(new BoxGeometry(120, 86, 8)), metal);
  const screenFace = new Mesh(
    keep(new PlaneGeometry(108, 74)),
    keep(new MeshBasicMaterial({ map: screenTex })),
  );
  screenFace.position.z = 4.2;
  const stand = new Mesh(keep(new BoxGeometry(10, 40, 10)), metal);
  stand.position.y = -60;
  computer.add(monitor, screenFace, stand);
  extras.add(computer);
  const fibre = new Group();
  const fibreRod = new Mesh(keep(new CylinderGeometry(4, 4, 90, 12)), sampleMat);
  const helixGeo = keep(new BufferGeometry());
  {
    const pts: number[] = [];
    for (let i = 0; i <= 160; i++) {
      const t = (i / 160) * Math.PI * 2 * 5;
      pts.push(Math.cos(t) * 12, -45 + (i / 160) * 90, Math.sin(t) * 12);
    }
    helixGeo.setAttribute("position", new Float32BufferAttribute(pts, 3));
  }
  const helixLine = new Line(helixGeo, keep(new LineBasicMaterial({ color: COLOR.real })));
  fibre.add(fibreRod, helixLine);
  extras.add(fibre);
  const cards = new Group();
  const cardCanvas = document.createElement("canvas");
  cardCanvas.width = 64;
  cardCanvas.height = 96;
  {
    const g = cardCanvas.getContext("2d")!;
    g.fillStyle = "#0b1222";
    g.fillRect(0, 0, 64, 96);
    g.strokeStyle = COLOR.recip;
    g.lineWidth = 3;
    for (const r of [10, 16, 25, 30, 38]) {
      g.beginPath();
      g.arc(32, 48, r, 0, Math.PI * 2);
      g.stroke();
    }
  }
  const cardTex = keep(new CanvasTexture(cardCanvas));
  const cardMat = keep(new MeshBasicMaterial({ map: cardTex, side: DoubleSide }));
  for (let i = 0; i < 3; i++) {
    const c = new Mesh(keep(new PlaneGeometry(56, 84)), cardMat);
    c.position.set((i - 1) * 34, 0, i * 2);
    c.rotation.z = (i - 1) * 0.18;
    cards.add(c);
  }
  extras.add(cards);
  extras.visible = mode === "band";

  // ---- Placement -------------------------------------------------------------------------------
  /** Scene units per mm, and the arm's length and the tube's place, mm. */
  let k = mode === "close" ? 0.01 : 3;
  let armMm = 280;
  let tubeMm = -180;
  let bandW = 1;
  let bandH = 1;
  let orbit = { az: -28, el: 20 };

  /** Close placement: frame the tube, the stage and the whole detector, from the orbit's angle. */
  const placeCloseCamera = () => {
    const cam = camera as PerspectiveCamera;
    // The machine's extent in its own plane, mm: the tube, the stage, the detector's ends.
    const xs = [tubeMm - 70, -80, 80];
    const ys = [-90, 80];
    const span = det.kind === "strip" ? detectorWidth(det) : 0;
    for (let i = 0; i <= 8; i++) {
      const a = (armAngle + (i / 8 - 0.5) * span) * DEG;
      xs.push(armMm * Math.cos(a));
      ys.push(armMm * Math.sin(a));
    }
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    const target = new Vector3(((x0 + x1) / 2) * k, ((y0 + y1) / 2) * k, 0);
    const half = Math.tan(((cam.fov / 2) * Math.PI) / 180);
    const w = (x1 - x0) * k;
    const h = (y1 - y0) * k;
    const dist = Math.max(h / 2 / half, w / 2 / (half * Math.max(0.3, cam.aspect))) * 1.08 + 40 * k;
    const az = orbit.az * DEG;
    const el = orbit.el * DEG;
    cam.position.set(
      target.x + dist * Math.sin(az) * Math.cos(el),
      target.y + dist * Math.sin(el),
      target.z + dist * Math.cos(az) * Math.cos(el),
    );
    cam.lookAt(target);
    cam.updateMatrixWorld();
  };

  // Seen a little from the right, so the beam rises gently towards the tube on a long band.
  const BAND_VIEW = { az: 16, el: 16 };
  /** The band's floor (where the beam runs), as a share of its height from the top. */
  const floorShare = (w: number, h: number) => (w / h > 6 ? 0.6 : 0.68);
  const placeBandCamera = () => {
    const cam = camera as OrthographicCamera;
    cam.left = -bandW / 2;
    cam.right = bandW / 2;
    cam.top = bandH / 2;
    cam.bottom = -bandH / 2;
    const az = BAND_VIEW.az * DEG;
    const el = BAND_VIEW.el * DEG;
    const d = 5000;
    cam.position.set(
      d * Math.sin(az) * Math.cos(el),
      d * Math.sin(el),
      d * Math.cos(az) * Math.cos(el),
    );
    cam.up.set(0, 1, 0);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  };

  /** The world point on the plane z = 0 seen at band px (x, y). */
  const bandToWorld = (x: number, y: number): Vector3 => {
    const ndc = new Vector3((x / bandW) * 2 - 1, 1 - (y / bandH) * 2, -1);
    const p = ndc.unproject(camera);
    const dir = new Vector3();
    camera.getWorldDirection(dir);
    const t = -p.z / dir.z;
    return p.addScaledVector(dir, t);
  };

  const project = (world: Vector3): { x: number; y: number } => {
    const v = world.clone().project(camera);
    if (mode === "close") return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
    return { x: ((v.x + 1) / 2) * bandW, y: ((1 - v.y) / 2) * bandH };
  };

  let bandSpots: BandSpots | null = null;

  const applyPlacement = () => {
    root.scale.setScalar(k);
    tube.position.x = tubeMm;
    beamIn.position.x = tubeMm / 2;
    beamIn.scale.y = Math.abs(tubeMm);
    // A beam you can see across the room on a band.
    const thick = mode === "band" ? 2.4 : 1;
    beamIn.scale.x = thick;
    beamIn.scale.z = thick;
    const past = mode === "close" ? armMm * 1.3 : armMm * 0.6;
    beamOut.position.x = past / 2;
    beamOut.scale.y = past;
    beamOut.scale.x = thick;
    beamOut.scale.z = thick;
  };

  /** Band: the longest arm (mm) and the room above and below the floor (mm) for the detector. */
  let armMaxMm = 280;
  let roomAboveMm = 300;
  let roomBelowMm = 100;
  /**
   * Band: the longest arm that keeps the whole detector inside the band at every angle the arm
   * can take, so the detector swings at one distance, as a real one does.
   */
  const fitArm = (): number => {
    const tilt = Math.sin(BAND_VIEW.el * DEG);
    // The detector's own size: its half width in the plane, its height (which the camera's
    // downward look turns partly into height on the band), and the plate's depth.
    const halfH =
      (det.kind === "plate" ? detectorWidth(det) / 2 : 0) +
      (Math.max(24, detectorHeight(det)) / 2) * tilt +
      6;
    const depth = det.kind === "plate" ? 24 : 0;
    const span = det.kind === "strip" ? detectorWidth(det) : 0;
    let hi = 0;
    let lo = 0;
    for (let arm = DIAL_RANGE.armTwoTheta[0]; arm <= DIAL_RANGE.armTwoTheta[1]; arm += 5) {
      for (let i = 0; i <= 8; i++) {
        const v = Math.sin((arm + (i / 8 - 0.5) * span) * DEG);
        hi = Math.max(hi, v);
        lo = Math.min(lo, v);
      }
    }
    let limit = armMaxMm;
    if (hi > 0) limit = Math.min(limit, (roomAboveMm - halfH) / hi - depth);
    if (lo < 0) limit = Math.min(limit, (roomBelowMm - halfH) / -lo);
    return Math.max(90, limit);
  };

  // ---- Physics state ---------------------------------------------------------------------------
  const spots: Spot[] = [];
  let rings: FaceRing[] = [];
  let ringKey = "";
  let det: Detector = detectorFor("strip", 280);
  let prevStage: StageAngles | null = null;
  let prevLambda = 0;
  let prevCrystal: CrystalId | null = null;
  const pointCache = new Map<string, LatticePoint[]>();
  let flashCount = 0;
  let rebuiltShown = -1;
  let disposed = false;

  const pointsFor = (c: CrystalId, lambda: number): LatticePoint[] => {
    const maxS = Math.min(2.2, 2 / lambda);
    const key = `${c}:${maxS.toFixed(2)}`;
    let p = pointCache.get(key);
    if (!p) {
      if (pointCache.size > 12) pointCache.clear();
      p = latticePoints(CRYSTALS[c], maxS, 600);
      pointCache.set(key, p);
    }
    return p;
  };

  /** A point on the detector's face (fu, fv) in the machine's millimetres, at arm angle `arm`. */
  const facePoint = (fu: number, fv: number, arm: number): Vec3 => {
    const v = fv * detectorHeight(det);
    if (det.kind === "strip") {
      const psi = (arm + fu * detectorWidth(det)) * DEG;
      return [armMm * Math.cos(psi), armMm * Math.sin(psi), v];
    }
    const a = arm * DEG;
    const u = fu * detectorWidth(det);
    return [armMm * Math.cos(a) - u * Math.sin(a), armMm * Math.sin(a) + u * Math.cos(a), v];
  };

  const buildDetector = () => {
    const key = `${det.kind}:${armMm.toFixed(1)}:${det.distance}`;
    if (key === detectorKey) return;
    detectorKey = key;
    if (detectorMesh) {
      armGroup.remove(detectorMesh);
      detectorMesh.geometry.dispose();
    }
    const H = Math.max(detectorHeight(det), mode === "band" ? 24 : 6);
    if (det.kind === "strip") {
      const span = detectorWidth(det) * DEG;
      const geo = new CylinderGeometry(armMm, armMm, H, 96, 1, true, 0, span);
      // The cylinder's axis is y and its arc starts at +z towards +x: turned so the axis is z,
      // the arc runs from -90° to span - 90° in the x-y plane, then round to centre on the arm.
      geo.rotateX(Math.PI / 2);
      geo.rotateZ(Math.PI / 2 - span / 2);
      detectorMesh = new Mesh(geo, detectorMat);
    } else {
      const depth = mode === "band" ? 24 : 4;
      const geo = new BoxGeometry(depth, detectorWidth(det), H);
      geo.translate(armMm + depth / 2, 0, 0);
      detectorMesh = new Mesh(geo, detectorMat);
    }
    armGroup.add(detectorMesh);
    armBar.scale.x = armMm * (det.kind === "strip" ? 0.96 : 1);
    armBar.position.x = (armMm * (det.kind === "strip" ? 0.96 : 1)) / 2;
  };

  const traceRings = (look: Look3D, m: Machine) => {
    const form = look.sample.form;
    const key = [
      form,
      look.sample.crystal,
      look.state.lambda.toFixed(4),
      look.state.armTwoTheta.toFixed(1),
      det.kind,
      det.distance,
      look.sample.spread.toFixed(0),
      look.state.omega.toFixed(1),
      look.state.chi.toFixed(1),
      look.state.phi.toFixed(1),
      look.dark,
    ].join("|");
    if (key === ringKey) return;
    ringKey = key;
    rings = [];
    if (form === "single" || look.dark) return;
    const list = powderRings(CRYSTALS[look.sample.crystal], look.state.lambda, {
      maxTwoTheta: 170,
    }).slice(0, MAX_RINGS);
    const normal = apply(stageMatrix(m.stage), [0, 1, 0]);
    const spread = form === "powder" ? 180 : Math.max(4, look.sample.spread);
    const k0 = 1 / look.state.lambda;
    for (const ring of list) {
      const tt = ring.twoTheta * DEG;
      const runs: { fu: number; fv: number }[][] = [];
      let run: { fu: number; fv: number }[] = [];
      for (let i = 0; i <= RING_SAMPLES; i++) {
        const eta = (i / RING_SAMPLES) * Math.PI * 2;
        const dir: Vec3 = [
          Math.cos(tt),
          Math.sin(tt) * Math.cos(eta),
          Math.sin(tt) * Math.sin(eta),
        ];
        // Grains that mostly face one way only send light where S is near their normal.
        const S: Vec3 = [dir[0] * k0 - k0, dir[1] * k0, dir[2] * k0];
        const sl = Math.hypot(S[0], S[1], S[2]) || 1;
        const cos = (S[0] * normal[0] + S[1] * normal[1] + S[2] * normal[2]) / sl;
        const ok = spread >= 180 || Math.acos(Math.min(1, Math.abs(cos))) / DEG <= spread;
        const hit = ok ? detectorHit(det, look.state.armTwoTheta, dir) : null;
        if (hit) run.push({ fu: hit.fu, fv: hit.fv });
        else if (run.length) {
          runs.push(run);
          run = [];
        }
      }
      if (run.length) runs.push(run);
      if (runs.length) rings.push({ twoTheta: ring.twoTheta, height: ring.height, runs });
    }
  };

  const drawRings3D = (arm: number) => {
    let used = 0;
    for (const ring of rings) {
      for (const run of ring.runs) {
        if (used >= MAX_RINGS || run.length < 2) continue;
        const line = ringLines[used++]!;
        const attr = line.geometry.getAttribute("position") as Float32BufferAttribute;
        const arr = attr.array as Float32Array;
        const n = Math.min(run.length, RING_SAMPLES);
        for (let i = 0; i < n; i++) {
          // Lift the trace just off the face, towards the sample.
          const p = facePoint(run[i]!.fu, run[i]!.fv, arm);
          const s = 0.985;
          arr[i * 3] = p[0] * s;
          arr[i * 3 + 1] = p[1] * s;
          arr[i * 3 + 2] = p[2];
        }
        attr.needsUpdate = true;
        line.geometry.setDrawRange(0, n);
        (line.material as LineBasicMaterial).opacity = 0.35 + 0.6 * Math.min(1, ring.height / 60);
        line.visible = true;
      }
    }
    for (let i = used; i < MAX_RINGS; i++) ringLines[i]!.visible = false;
  };

  const addSpot = (s: Spot, now: number, arm: number) => {
    spots.push(s);
    if (spots.length > MAX_SPOTS) spots.shift();
    // A ray from the sample to where it landed.
    const ray = rays[nextRay]!;
    rayAt[nextRay] = now;
    nextRay = (nextRay + 1) % MAX_RAYS;
    lastFlashAt = now;
    const end = new Vector3(...facePoint(s.fu, s.fv, arm));
    const len = end.length();
    const r = mode === "band" ? 3.2 : 1.2;
    ray.position.copy(end).multiplyScalar(0.5);
    ray.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), end.clone().normalize());
    ray.scale.set(r, len, r);
  };

  const drawComputer = (rebuilt: number) => {
    if (Math.abs(rebuilt - rebuiltShown) < 0.02) return;
    rebuiltShown = rebuilt;
    const g = screenCanvas.getContext("2d");
    if (!g) return;
    g.fillStyle = "#06101a";
    g.fillRect(0, 0, 128, 96);
    // Blurs that sharpen into a little lattice of atoms as more spots are added.
    const sharp = 0.15 + 0.85 * rebuilt;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 3; j++) {
        const x = 20 + i * 30;
        const y = 18 + j * 30;
        const r = 14 - 9 * sharp;
        const grad = g.createRadialGradient(x, y, 0, x, y, r * 1.8);
        grad.addColorStop(0, `rgba(137,218,155,${0.4 + 0.6 * sharp})`);
        grad.addColorStop(1, "rgba(137,218,155,0)");
        g.fillStyle = grad;
        g.fillRect(x - r * 2, y - r * 2, r * 4, r * 4);
      }
    }
    screenTex.needsUpdate = true;
  };

  const matrix = new Matrix4();
  const tmpColor = new Color();
  const drawLattice = (look: Look3D, m: Machine, points: readonly LatticePoint[]) => {
    const kr = armMm * 0.55 * look.state.lambda;
    const R = mul(stageMatrix(m.stage), m.orient);
    const k0 = 1 / look.state.lambda;
    let n = 0;
    const strongest = points.reduce((s, p) => Math.max(s, p.F2), 1e-9);
    for (const p of points) {
      if (n >= MAX_LATTICE) break;
      const g = apply(R, p.g);
      const gap = Math.abs(sphereGap(g, look.state.lambda));
      const lit = gap < SHELL * k0 * 4 ? 1 - gap / (SHELL * k0 * 4) : 0;
      const size = (2.2 + 2.5 * Math.sqrt(p.F2 / strongest)) * (1 + 1.5 * lit);
      matrix.makeScale(size, size, size);
      matrix.setPosition(g[0] * kr, g[1] * kr, g[2] * kr);
      latticeMesh.setMatrixAt(n, matrix);
      tmpColor.set(COLOR.recip).multiplyScalar(0.45 + 0.55 * lit);
      if (lit > 0.5) tmpColor.lerp(new Color(0xffffff), 0.5);
      latticeMesh.setColorAt(n, tmpColor);
      n++;
    }
    latticeMesh.count = n;
    latticeMesh.instanceMatrix.needsUpdate = true;
    if (latticeMesh.instanceColor) latticeMesh.instanceColor.needsUpdate = true;
    // The sphere: radius 1/λ, centred at -s_in from the lattice's origin (the sample).
    const r = k0 * kr;
    for (const l of sphereLines) {
      l.scale.setScalar(r);
      l.position.set(-r, 0, 0);
    }
    sphereShell.scale.setScalar(r);
    sphereShell.position.set(-r, 0, 0);
  };

  const anchors = (): Record<PartId, Vec3 | null> => ({
    tube: [tubeMm - 35, -30, 0],
    sample: [0, -90, 0],
    stage: [78, 40, 0],
    detector: (() => {
      const p = facePoint(0, 0, armAngle);
      return [p[0], p[1] - detectorWidth(det) * (det.kind === "plate" ? 0.5 : 0), p[2]];
    })(),
    computer:
      bandSpots?.computer != null ? [computer.position.x, computer.position.y - 80, 0] : null,
    fibre: bandSpots?.fibre != null ? [fibre.position.x, fibre.position.y - 50, 0] : null,
    cards: bandSpots?.cards != null ? [cards.position.x, cards.position.y - 50, 0] : null,
  });
  let armAngle = 0;

  if (mode === "close") {
    placeCloseCamera();
    applyPlacement();
  }

  return {
    scene,
    camera,
    get spots() {
      return spots;
    },
    get rings() {
      return rings;
    },
    get detector() {
      return det;
    },
    get flashes() {
      return flashCount;
    },
    get arm() {
      return { mm: armMm, k, above: roomAboveMm, below: roomBelowMm, max: armMaxMm };
    },
    setOrbit(az, el) {
      orbit = { az, el };
      if (mode === "close") placeCloseCamera();
    },
    setBand(width, height, at) {
      bandW = Math.max(1, width);
      bandH = Math.max(1, height);
      bandSpots = at;
      placeBandCamera();
      // Parts stand on a floor in the band's lower part; the arm swings up from the sample.
      const floor = bandH * floorShare(bandW, bandH);
      // A long, low band (the wall's banner) takes its parts as large as its height allows.
      k = Math.max(0.4, bandW / bandH > 6 ? bandH / 235 : bandH / 300);
      const margin = Math.max(bandW * 0.015, 30);
      // Keep the tube's body and the props inside the band, with a margin.
      const tubeX = Math.max(at.tube * bandW, 100 * k + margin);
      const sample = bandToWorld(at.sample * bandW, floor);
      const tubeAt = bandToWorld(tubeX, floor);
      const detAt = bandToWorld(at.detector * bandW, floor);
      root.position.set(sample.x, sample.y, 0);
      // The tube's middle over its chapters (its window half a body further on), clear of the
      // stage's ring, and never past the band's left edge.
      const left = bandToWorld(margin, floor);
      tubeMm = Math.min(-90, (tubeAt.x - sample.x) / k + 35);
      // The body's depth shows on the left at this angle, so keep a little more room there.
      tubeMm = Math.min(-90, Math.max(tubeMm, (left.x - sample.x) / k + 100));
      // Long enough to reach over the detector's chapters at a middling angle.
      const scaleY = Math.cos(BAND_VIEW.el * DEG);
      armMaxMm = Math.max(140, (detAt.x - sample.x) / 0.82 / k);
      roomAboveMm = (floor - bandH * 0.07) / scaleY / k;
      roomBelowMm = (bandH - floor - bandH * 0.05) / scaleY / k;
      armMm = fitArm();
      const place = (g: Group, f: number | null, lift: number) => {
        g.visible = f !== null;
        if (f === null) return;
        const x = Math.min(bandW - 70 * k - margin, Math.max(70 * k + margin, f * bandW));
        const w = bandToWorld(x, floor);
        g.position.set((w.x - sample.x) / k, (w.y - sample.y) / k + lift, 0);
      };
      // Each prop stands on the floor.
      place(computer, at.computer, 80);
      place(fibre, at.fibre, 45);
      place(cards, at.cards, 42);
      detectorKey = "";
      applyPlacement();
    },
    update(look, now) {
      if (disposed) return;
      const st = look.state;
      omegaGroup.rotation.z = st.omega * DEG;
      chiGroup.rotation.x = st.chi * DEG;
      chiRing.rotation.x = st.chi * DEG;
      phiGroup.rotation.y = st.phi * DEG;
      armGroup.rotation.z = st.armTwoTheta * DEG;
      armAngle = st.armTwoTheta;
      if (mode === "close") {
        const want = Math.max(80, st.distance);
        if (Math.abs(want - armMm) > 0.01) {
          armMm = want;
          applyPlacement();
        }
      }
      det = detectorFor(st.detector, st.distance);
      if (mode === "band") {
        // A new kind of detector needs its own arm length to stay inside the band.
        const fit = fitArm();
        if (Math.abs(fit - armMm) > 0.5) {
          armMm = fit;
          applyPlacement();
        }
      }
      buildDetector();
      if (mode === "close") placeCloseCamera();
      for (const [form, m] of Object.entries(samples)) m.visible = form === look.sample.form;

      const glow = look.glow ?? {};
      const accent = new Color(COLOR.accent);
      omegaMat.emissive.copy(accent).multiplyScalar(0.8 * (glow.omega ?? 0));
      chiMat.emissive.copy(accent).multiplyScalar(0.8 * (glow.chi ?? 0));
      phiMat.emissive.copy(accent).multiplyScalar(0.8 * (glow.phi ?? 0));
      armMat.emissive
        .copy(accent)
        .multiplyScalar(0.8 * Math.max(glow.arm ?? 0, glow.distance ?? 0));
      beamMat.color.set(look.dark ? COLOR.muted : COLOR.beam);

      // Flashes: points that crossed the sphere since the last step, from the stage or λ.
      const crystal = look.sample.crystal;
      const m: Machine = {
        crystal: CRYSTALS[crystal],
        orient: orientFor(CRYSTALS[crystal], FLAT[crystal]),
        stage: { omega: st.omega, chi: st.chi, phi: st.phi },
        armTwoTheta: st.armTwoTheta,
        lambda: st.lambda,
        detector: det,
      };
      const points = pointsFor(crystal, st.lambda);
      if (look.sample.form === "single" && !look.dark && prevStage && prevCrystal === crystal) {
        const R0 = mul(stageMatrix(prevStage), m.orient);
        const R1 = mul(stageMatrix(m.stage), m.orient);
        const k0 = 1 / st.lambda;
        for (const p of points) {
          const a = sphereGap(apply(R0, p.g), prevLambda);
          const g1 = apply(R1, p.g);
          const b = sphereGap(g1, st.lambda);
          if (a > 0 === b > 0) continue;
          const sOut: Vec3 = [g1[0] + k0, g1[1], g1[2]];
          // A ray heading down into the crystal is absorbed: no flash.
          if (!leavesSurface(m.stage, sOut)) continue;
          const hit = detectorHit(det, st.armTwoTheta, sOut);
          flashCount++;
          if (hit)
            addSpot({ fu: hit.fu, fv: hit.fv, at: now, hkl: p.hkl.join(" ") }, now, st.armTwoTheta);
        }
      }
      if (look.sample.form !== "single") spots.length = 0;
      prevStage = { ...m.stage };
      prevLambda = st.lambda;
      prevCrystal = crystal;
      traceRings(look, m);
      drawRings3D(st.armTwoTheta);

      // Spots fade into a trail; their sprites sit on the face.
      while (spots.length && now - spots[0]!.at > TRAIL_MS) spots.shift();
      // On a band a flash is the brightest thing in the room.
      const size = mode === "close" ? 26 : 70;
      spotSprites.forEach((s, i) => {
        const sp = spots[i];
        if (!sp) {
          s.visible = false;
          return;
        }
        const lvl = spotLevel(now - sp.at);
        const p = facePoint(sp.fu, sp.fv, st.armTwoTheta);
        s.position.set(p[0] * 0.99, p[1] * 0.99, p[2]);
        s.scale.setScalar(size * (0.6 + 0.8 * lvl));
        (s.material as SpriteMaterial).opacity = Math.min(1, lvl * 1.2);
        s.visible = lvl > 0.01;
      });
      rays.forEach((r, i) => {
        const age = now - rayAt[i]!;
        const a = age < 900 ? 1 - age / 900 : 0;
        (r.material as MeshBasicMaterial).opacity = a;
        r.visible = a > 0.01;
      });
      const burst = Math.max(0, 1 - (now - lastFlashAt) / 600);
      sampleFlash.visible = burst > 0.01;
      if (sampleFlash.visible) {
        sampleFlash.scale.setScalar(size * 1.2 * (0.6 + burst));
        (sampleFlash.material as SpriteMaterial).opacity = burst;
      }
      // The detector's face lights with its freshest flash.
      let fresh = look.dark ? 0 : look.flash;
      for (const sp of spots)
        fresh = Math.max(fresh, now - sp.at < FLASH_MS ? 1 - (now - sp.at) / FLASH_MS : 0);
      detectorMat.emissive
        .set(COLOR.real)
        .multiplyScalar(0.12)
        .lerp(new Color(COLOR.recip), Math.min(1, fresh) * 0.8);
      const forced = look.dark ? 0 : look.flash;
      if (forced > 0.02) {
        const p = facePoint(0, 0, st.armTwoTheta);
        centreFlash.position.set(p[0] * 0.98, p[1] * 0.98, p[2]);
        centreFlash.scale.setScalar(size * 2.2 * forced);
        (centreFlash.material as SpriteMaterial).opacity = forced;
        centreFlash.visible = true;
      } else centreFlash.visible = false;

      mathsGroup.visible = look.maths === true && !look.dark;
      if (mathsGroup.visible) drawLattice(look, m, points);
      if (mode === "band" && computer.visible) drawComputer(look.rebuilt);
    },
    clear() {
      spots.length = 0;
      prevStage = null;
    },
    names() {
      const at = (p: Vec3) =>
        project(new Vector3(p[0], p[1], p[2]).multiplyScalar(k).add(root.position));
      const face = facePoint(0, 0, armAngle);
      const a = armAngle * DEG;
      const out = det.kind === "plate" ? 40 : 34;
      return {
        tube: at([tubeMm - 35, -46, 0]),
        sample: at([0, -100, 0]),
        detector: at([face[0] + out * Math.cos(a), face[1] + out * Math.sin(a), 0]),
      };
    },
    anchor(part) {
      const a = anchors()[part];
      if (!a) return null;
      const world = new Vector3(a[0], a[1], a[2]).multiplyScalar(k).add(root.position);
      return project(world);
    },
    dispose() {
      disposed = true;
      if (detectorMesh) detectorMesh.geometry.dispose();
      for (const d of disposables) d.dispose();
      disposables.length = 0;
      spots.length = 0;
      pointCache.clear();
    },
  };
};
