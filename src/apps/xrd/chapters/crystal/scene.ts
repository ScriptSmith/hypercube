/**
 * Chapter 3's figure in 3D: the tile's block of atoms, its bonds, one cell outlined and a family
 * of planes, turned by the visitor's drag. Every mesh and material is made once, sized for the
 * largest crystal, so changing crystal or family only rewrites buffers and nothing compiles
 * again; the scene is released whole on dispose.
 */
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SphereGeometry,
  Vector3,
} from "three";
import { COLOR } from "../../config";
import type { Species, Vec3 } from "../../crystals";
import { blockOf, familyOf, lookOf, MAX_PLANES, type Tile, TILES, turnOf } from "./model";

const FOV = 26;
const BOND_R = 0.11;
/** With layers shown, atoms shrink to this share and bonds fade, so the layers read as sheets. */
const LAYER_ATOMS = 0.5;
const EDGE_R = 0.09;
const MAX_POLY = 6;

export interface CrystalScene {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  setTile(tile: Tile): void;
  /** 0 hides the planes; otherwise 1 + the tile's family index. */
  setFamily(family: number): void;
  setTurn(yaw: number, pitch: number): void;
  /** Fit the camera to a view `width` by `height` px whose beam runs `beamDy` px below its middle. */
  fit(width: number, height: number, beamDy: number): void;
  /** A world point (Å) to view px from the view's top left. */
  project(p: Vec3, width: number, height: number): { x: number; y: number };
  /** World vectors that are the screen's right and up now. */
  axes(): { right: Vec3; up: Vec3 };
}

export const createCrystalScene = (): CrystalScene => {
  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.5, 400);
  scene.add(new AmbientLight(0xffffff, 0.55));
  const sun = new DirectionalLight(0xffffff, 1.6);
  sun.position.set(-0.5, 0.8, 1);
  scene.add(sun);
  const turned = new Group();
  scene.add(turned);

  // Sized for the largest crystal: atoms of each kind, bonds, planes.
  const species = new Map<Species, number>();
  let maxBonds = 1;
  for (const t of TILES) {
    const b = blockOf(t);
    const counts = new Map<Species, number>();
    for (const a of b.atoms) counts.set(a.sp, (counts.get(a.sp) ?? 0) + 1);
    for (const [sp, n] of counts) species.set(sp, Math.max(species.get(sp) ?? 0, n));
    maxBonds = Math.max(maxBonds, b.bonds.length);
  }
  const ball = new SphereGeometry(1, 18, 12);
  const atomMeshes = new Map<Species, InstancedMesh>();
  for (const [sp, n] of species) {
    const look = lookOf(sp);
    const mesh = new InstancedMesh(
      ball,
      new MeshLambertMaterial({ color: new Color(look.colour) }),
      n,
    );
    mesh.frustumCulled = false;
    atomMeshes.set(sp, mesh);
    turned.add(mesh);
  }
  const stick = new CylinderGeometry(1, 1, 1, 8, 1, true);
  const bondMat = new MeshLambertMaterial({
    color: new Color(COLOR.real).multiplyScalar(0.7),
    transparent: true,
    opacity: 1,
  });
  const bonds = new InstancedMesh(stick, bondMat, maxBonds);
  bonds.frustumCulled = false;
  turned.add(bonds);
  const edges = new InstancedMesh(
    stick,
    new MeshBasicMaterial({ color: new Color(COLOR.angle) }),
    12,
  );
  edges.frustumCulled = false;
  turned.add(edges);
  const planeGeo = new BufferGeometry();
  const planePos = new Float32Array(MAX_PLANES * (MAX_POLY - 2) * 9);
  planeGeo.setAttribute("position", new BufferAttribute(planePos, 3));
  const planes = new Mesh(
    planeGeo,
    new MeshBasicMaterial({
      color: new Color(COLOR.real),
      transparent: true,
      opacity: 0.4,
      side: DoubleSide,
      depthWrite: false,
    }),
  );
  planes.frustumCulled = false;
  planes.renderOrder = 2;
  turned.add(planes);
  const rimGeo = new BufferGeometry();
  const rimPos = new Float32Array(MAX_PLANES * MAX_POLY * 6);
  rimGeo.setAttribute("position", new BufferAttribute(rimPos, 3));
  const rims = new LineSegments(rimGeo, new LineBasicMaterial({ color: new Color("#d6f5df") }));
  rims.frustumCulled = false;
  turned.add(rims);
  // The beam, fixed to the view rather than the crystal: it runs across at the card's beam.
  const beam = new Mesh(
    new CylinderGeometry(0.16, 0.16, 400, 8, 1, true),
    new MeshBasicMaterial({ color: new Color(COLOR.beam) }),
  );
  beam.rotation.z = Math.PI / 2;
  scene.add(beam);

  const m4 = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const v = new Vector3();
  const scl = new Vector3();
  const pos = new Vector3();
  const stickBetween = (mesh: InstancedMesh, i: number, a: Vec3, b: Vec3, r: number) => {
    v.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = v.length();
    q.setFromUnitVectors(up, v.normalize());
    pos.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    scl.set(r, len, r);
    m4.compose(pos, q, scl);
    mesh.setMatrixAt(i, m4);
  };

  let tile: Tile = TILES[0]!;
  let family = 0;
  let radius = 10;
  let atomScale = 1;

  const placeAtoms = () => {
    const b = blockOf(tile);
    const counts = new Map<Species, number>();
    for (const a of b.atoms) {
      const mesh = atomMeshes.get(a.sp);
      if (!mesh) continue;
      const i = counts.get(a.sp) ?? 0;
      if (i >= (species.get(a.sp) ?? 0)) continue;
      const r = lookOf(a.sp).r * atomScale;
      m4.makeScale(r, r, r);
      m4.setPosition(a.p[0], a.p[1], a.p[2]);
      mesh.setMatrixAt(i, m4);
      counts.set(a.sp, i + 1);
    }
    for (const [sp, mesh] of atomMeshes) {
      mesh.count = counts.get(sp) ?? 0;
      mesh.visible = mesh.count > 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
  };

  const setTile = (t: Tile) => {
    tile = t;
    const b = blockOf(t);
    radius = b.radius + 1;
    placeAtoms();
    // Each crystal fills the view: its own block sets the camera's distance.
    if (lastFit) fit(lastFit.width, lastFit.height, lastFit.beamDy);
    let n = 0;
    for (const [i, j] of b.bonds) {
      if (n >= maxBonds) break;
      stickBetween(bonds, n++, b.atoms[i]!.p, b.atoms[j]!.p, BOND_R);
    }
    bonds.count = n;
    bonds.visible = n > 0;
    bonds.instanceMatrix.needsUpdate = true;
    b.cell.forEach(([p0, p1], i) => stickBetween(edges, i, p0, p1, EDGE_R));
    edges.instanceMatrix.needsUpdate = true;
    setFamily(family);
  };

  const setFamily = (f: number) => {
    family = f;
    const on = f > 0 && tile.families[f - 1] !== undefined;
    const scale = on ? LAYER_ATOMS : 1;
    if (scale !== atomScale) {
      atomScale = scale;
      placeAtoms();
    }
    bondMat.opacity = on ? 0.35 : 1;
    if (!on) {
      planes.visible = false;
      rims.visible = false;
      return;
    }
    const fam = familyOf(tile, tile.families[f - 1]!);
    let t = 0;
    let e = 0;
    for (const poly of fam.planes) {
      const n = Math.min(poly.length, MAX_POLY);
      for (let k = 1; k + 1 < n; k++) {
        for (const p of [poly[0]!, poly[k]!, poly[k + 1]!]) planePos.set(p, t++ * 3);
      }
      for (let k = 0; k < n; k++) {
        rimPos.set(poly[k]!, e++ * 3);
        rimPos.set(poly[(k + 1) % n]!, e++ * 3);
      }
    }
    planeGeo.setDrawRange(0, t);
    planeGeo.attributes.position!.needsUpdate = true;
    rimGeo.setDrawRange(0, e);
    rimGeo.attributes.position!.needsUpdate = true;
    planes.visible = true;
    rims.visible = true;
  };

  let turn = turnOf(30, 18);
  const setTurn = (yaw: number, pitch: number) => {
    turn = turnOf(yaw, pitch);
    // The matrix's rows are the screen's axes in world; the group turns world into view.
    m4.set(
      turn[0],
      turn[1],
      turn[2],
      0,
      turn[3],
      turn[4],
      turn[5],
      0,
      turn[6],
      turn[7],
      turn[8],
      0,
      0,
      0,
      0,
      1,
    );
    turned.quaternion.setFromRotationMatrix(m4);
  };

  let dist = 60;
  let lastFit: { width: number; height: number; beamDy: number } | null = null;
  function fit(width: number, height: number, beamDy: number) {
    lastFit = { width, height, beamDy };
    const aspect = Math.max(0.1, width / Math.max(1, height));
    const half = Math.tan(((FOV / 2) * Math.PI) / 180);
    // Fit the block's height, and its width on narrow views; its corners may touch the edge.
    const sinH = Math.sin(((FOV / 2) * Math.PI) / 180);
    const sinW = Math.sin(Math.atan(half * aspect));
    dist = (radius / Math.min(sinH, sinW)) * 0.86;
    camera.aspect = aspect;
    camera.position.set(0, 0, dist);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    // At depth zero one px is 2·dist·tan(fov/2)/height Å.
    beam.position.y = -beamDy * ((2 * dist * half) / Math.max(1, height));
  }

  setTile(tile);
  setFamily(0);
  setTurn(30, 18);
  // Every material in place and visible for the first compile.
  planes.visible = true;
  rims.visible = true;
  for (const mesh of atomMeshes.values()) mesh.visible = true;
  bonds.visible = true;

  return {
    scene,
    camera,
    setTile,
    setFamily,
    setTurn,
    fit,
    project(p, width, height) {
      v.set(p[0], p[1], p[2]).applyQuaternion(turned.quaternion).project(camera);
      return { x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height };
    },
    axes() {
      return { right: [turn[0], turn[1], turn[2]], up: [turn[3], turn[4], turn[5]] };
    },
  };
};
