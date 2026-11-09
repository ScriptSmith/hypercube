/**
 * Castles and heaps of the bucket's damp sand, drawn in 3D among the toys. Each mound is one
 * lathe whose profile morphs from a castle (the bucket's sand turned out, a ring from its mould
 * round the middle) to a rounded heap as it crumbles, scaled down as it settles flat and faded
 * out into the beach at the end.
 */
import {
  BufferAttribute,
  Group,
  Mesh,
  type MeshStandardMaterial,
  Quaternion,
  Vector3,
} from "three";
import { lathe, paint, sandTexture, TILT } from "./wallpropview";
import { CASTLE, HEAP, type Mound } from "./wallsand";

const POINTS = 12;

/** The castle's outline, radius and height from its foot, metres. */
export const castleProfile = (): (readonly [number, number])[] => {
  const r0 = CASTLE.radius;
  const r1 = CASTLE.top;
  const h = CASTLE.height;
  const at = (y: number) => r0 + ((r1 - r0) * y) / h;
  return [
    [r0 + 0.006, 0],
    [at(0.02) + 0.002, 0.02],
    [at(0.2 * h), 0.2 * h],
    [at(0.4 * h), 0.4 * h],
    [at(0.45 * h) - 0.012, 0.45 * h],
    [at(0.5 * h), 0.5 * h],
    [at(0.75 * h), 0.75 * h],
    [at(h - 0.025) + 0.002, h - 0.025],
    [r1 - 0.012, h - 0.003],
    [r1 * 0.66, h],
    [r1 * 0.33, h + 0.002],
    [0, h + 0.003],
  ];
};

/** A heap's outline, point for point with the castle's so one morphs into the other. */
export const heapProfile = (): (readonly [number, number])[] =>
  Array.from({ length: POINTS }, (_, i) => {
    const s = i / (POINTS - 1);
    const r = HEAP.radius * (1 - s) ** 0.85;
    const u = r / HEAP.radius;
    return [r * (i === 0 ? 1.05 : 1), HEAP.height * Math.max(0, 1 - u * u) ** 1.4] as const;
  });

export interface MoundViews {
  readonly root: Group;
  /** Show the mounds on the sand at `floor`, metres, at `scale` stage px a metre. */
  update(mounds: readonly Mound[], floor: number, scale: number): void;
}

export const createMoundViews = (count: number): MoundViews => {
  const root = new Group();
  const castle = lathe(castleProfile(), 40);
  const heap = lathe(heapProfile(), 40);
  heap.computeVertexNormals();
  castle.computeVertexNormals();
  castle.morphAttributes.position = [
    new BufferAttribute(new Float32Array(heap.getAttribute("position").array), 3),
  ];
  castle.morphAttributes.normal = [
    new BufferAttribute(new Float32Array(heap.getAttribute("normal").array), 3),
  ];
  heap.dispose();
  const map = sandTexture();
  // Repeated finely, so the texture's specks read as grains on something this big.
  map.repeat.set(12, 5);
  const meshes = Array.from({ length: count }, () => {
    const m = new Mesh(
      castle,
      paint({ map, roughness: 1, transparent: true, opacity: 1, depthWrite: true }),
    );
    m.morphTargetInfluences = [0];
    m.renderOrder = 2;
    m.frustumCulled = false;
    m.visible = false;
    root.add(m);
    return m;
  });
  const tilt = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), TILT);
  const turn = new Quaternion();
  const yAxis = new Vector3(0, 1, 0);
  return {
    root,
    update(mounds, floor, scale) {
      meshes.forEach((mesh, i) => {
        const m = mounds[i];
        if (!m || !m.active || m.hidden || m.opacity <= 0.01) {
          mesh.visible = false;
          return;
        }
        mesh.visible = true;
        mesh.position.set(m.x * scale, floor * scale, 0);
        const h = Math.max(0.02, m.level * m.grow);
        mesh.scale.set(m.size * scale, h * scale, m.size * scale);
        turn.setFromAxisAngle(yAxis, m.turn);
        mesh.quaternion.copy(tilt).multiply(turn);
        mesh.morphTargetInfluences![0] = 1 - m.shape;
        (mesh.material as MeshStandardMaterial).opacity = m.opacity;
      });
    },
  };
};
