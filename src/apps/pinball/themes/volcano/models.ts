/**
 * Volcano's 3D pieces, shared by the table and the deck: the volcano's cone, a lava channel along a
 * ride's path, the friendly dinosaur and its babies, eggs that split in two, ferns, boulders, and
 * pools of sparks and smoke. Geometry is built once per kit (or per table for pieces placed by the
 * layout) and pieces of different colours that move together are one mesh in vertex colours.
 *
 * Builders take scene coordinates unless they say field: x right, y up the table, z towards the
 * viewer. Field points (y down) go through `scene`.
 */
import {
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  type InstancedMesh,
  LatheGeometry,
  type Material,
  Matrix4,
  Quaternion,
  SphereGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from "three";
import type { P3 } from "../../devices";
import { dirty, instances } from "../../view3d/deckparts3d";
import { paintedGeometry } from "../../view3d/kit";
import { stream } from "./art";

export type Piece = { geometry: BufferGeometry; color: string; matrix?: Matrix4 };

const v3 = (x: number, y: number, z: number) => new Vector3(x, y, z);
/** A field point (y down) as a scene point. */
export const scene = (p: P3) => v3(p.x, -p.y, p.z);

const ease = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));

/** Translation, then a rotation about z, then a scale. */
export const trs = (x: number, y: number, z: number, turn = 0, sx = 1, sy = sx, sz = sx): Matrix4 =>
  new Matrix4().compose(
    v3(x, y, z),
    new Quaternion().setFromAxisAngle(v3(0, 0, 1), turn),
    v3(sx, sy, sz),
  );

/** One mesh's worth of pieces in vertex colours; the pieces' geometries are disposed. */
export const painted = (pieces: Piece[], keep: readonly BufferGeometry[] = []): BufferGeometry => {
  const g = paintedGeometry(pieces)!;
  for (const p of pieces) if (!keep.includes(p.geometry)) p.geometry.dispose();
  return g;
};

// ---- The volcano ------------------------------------------------------------------------------

/**
 * The cone round the z axis: a concave slope from `base` at the playfield up to the rim (`rim`
 * at `top`), and down inside to the crater's floor just under the lava (`lava`). Its uv's v runs
 * from the crater (0) to the base (1), u round it.
 */
export const coneGeometry = (base: number, rim: number, top: number, lava: number) => {
  const pts: Vector2[] = [];
  const n = 10;
  // The lip's shape scales with the rim: these are table px for a rim of 50.
  const u = rim / 50;
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    // A slope that steepens as it climbs.
    pts.push(new Vector2(rim + 4 * u + (base - rim - 4 * u) * (1 - k) ** 1.7, top * k));
  }
  pts.push(new Vector2(rim, top + u));
  pts.push(new Vector2(rim - 5 * u, top - 6 * u));
  pts.push(new Vector2(rim - 10 * u, lava + 4 * u));
  pts.push(new Vector2(rim - 18 * u, lava - 4 * u));
  pts.push(new Vector2(0.01, lava - 4 * u));
  const g = new LatheGeometry(pts, 40);
  g.rotateX(Math.PI / 2);
  const uv = g.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  return g;
};

// ---- Lava channels -----------------------------------------------------------------------------

export interface Channel {
  /** The lava the ball rides on, uv's v along it in units of `repeat` px. */
  floor: BufferGeometry;
  /** Rock walls either side, a trim along their tops and pillars under it, in vertex colours. */
  rock: BufferGeometry;
}

/**
 * A raised lava channel along a ride's path (field points, z the ball's centre): a floor of lava
 * under the ball, rock walls, and rock pillars down to the playfield where it is high.
 */
export const channelGeometry = (
  path: readonly P3[],
  ballR: number,
  o: { width?: number; repeat?: number; wall?: string; pillar?: string; trim?: string } = {},
): Channel => {
  const half = o.width ?? ballR + 5;
  const repeat = o.repeat ?? 140;
  const curve = new CatmullRomCurve3(
    path.map((p) => v3(p.x, -p.y, Math.max(1, p.z - ballR))),
    false,
    "centripetal",
  );
  const len = curve.getLength();
  const n = Math.max(8, Math.round(len / 14));
  const pos: number[] = [];
  const nor: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const left: Vector3[] = [];
  const right: Vector3[] = [];
  const t = new Vector3();
  const side = new Vector3();
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const p = curve.getPointAt(u);
    curve.getTangentAt(u, t);
    side.set(-t.y, t.x, 0).normalize();
    const a = p.clone().addScaledVector(side, -half);
    const b = p.clone().addScaledVector(side, half);
    left.push(a);
    right.push(b);
    pos.push(a.x, a.y, a.z + 0.5, b.x, b.y, b.z + 0.5);
    nor.push(0, 0, 1, 0, 0, 1);
    const v = (u * len) / repeat;
    uvs.push(0, v, 1, v);
    if (i > 0) {
      const k = i * 2;
      idx.push(k - 2, k, k - 1, k - 1, k, k + 1);
    }
  }
  const floor = new BufferGeometry();
  floor.setIndex(idx);
  floor.setAttribute("position", new Float32BufferAttribute(pos, 3));
  floor.setAttribute("normal", new Float32BufferAttribute(nor, 3));
  floor.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  const wallR = 10;
  const wall = o.wall ?? "#5a463c";
  const rock: Piece[] = [];
  for (const edge of [left, right]) {
    const lifted = edge.map((p) => v3(p.x, p.y, p.z + wallR - 2));
    const c = new CatmullRomCurve3(lifted, false, "centripetal");
    rock.push({ geometry: new TubeGeometry(c, n, wallR, 7, false), color: wall });
    const top = new CatmullRomCurve3(
      edge.map((p) => v3(p.x, p.y, p.z + wallR * 2 - 1)),
      false,
      "centripetal",
    );
    rock.push({ geometry: new TubeGeometry(top, n, 2.4, 5, false), color: o.trim ?? wall });
    // A rounded end on each wall.
    for (const p of [lifted[0]!, lifted.at(-1)!]) {
      rock.push({
        geometry: new SphereGeometry(wallR, 8, 6),
        color: wall,
        matrix: trs(p.x, p.y, p.z),
      });
    }
  }
  // Pillars under the high parts.
  const rnd = stream(Math.round(len));
  for (let s = 60; s < len - 30; s += 120) {
    const p = curve.getPointAt(s / len);
    if (p.z < 34) continue;
    const r = 11 + rnd() * 4;
    // Stopping short of the floor, so they never show through the lava.
    const top = p.z - 4 - r;
    const g = new CylinderGeometry(r * 0.85, r * 1.15, top, 7);
    g.rotateX(Math.PI / 2);
    rock.push({
      geometry: g,
      color: o.pillar ?? "#3a2a22",
      matrix: trs(p.x, p.y, top / 2, rnd() * 3),
    });
  }
  return { floor, rock: painted(rock) };
};

// ---- A tapered tube ----------------------------------------------------------------------------

/** A tube along scene points whose radius goes from r0 to r1, closed at neither end. */
export const taperTube = (
  pts: readonly Vector3[],
  r0: number,
  r1: number,
  radial = 12,
  segments = 16,
): BufferGeometry => {
  const curve = new CatmullRomCurve3([...pts], false, "centripetal");
  const tube = new TubeGeometry(curve, segments, 1, radial, false);
  const p = tube.getAttribute("position");
  const nrm = tube.getAttribute("normal");
  // Each ring's vertices sit `radius` along their normal from the curve: rescale them.
  for (let i = 0; i <= segments; i++) {
    const r = r0 + (r1 - r0) * (i / segments);
    const c = curve.getPointAt(i / segments);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      p.setXYZ(k, c.x + nrm.getX(k) * r, c.y + nrm.getY(k) * r, c.z + nrm.getZ(k) * r);
    }
  }
  tube.computeVertexNormals();
  return tube;
};

// ---- The dinosaur ------------------------------------------------------------------------------

export const DINO_GREEN = "#6fc46a";
const DINO_DARK = "#4c9a50";
const DINO_LEG = "#5aae58";
const CHEEK = "#ff9fb4";

export interface DinoGeometry {
  /** The body, legs and tail, which move together. */
  body: BufferGeometry;
  /** The neck and head, which turn about `neckBase` (scene, from the body's middle). */
  neck: BufferGeometry;
  neckBase: Vector3;
}

/**
 * A friendly long-necked dinosaur as built (unmirrored), from its body's middle on the playfield:
 * the neck rises up the table to `head` (scene, relative), the tail runs down to `tip`. Big eyes
 * on top of its head look up at whoever stands in front.
 */
/** The dinosaur's body lies along this angle (scene, radians), from its tail up to its neck. */
export const DINO_AXIS = Math.atan2(1, -0.82);

export const dinoGeometry = (head: Vector3, tip: Vector3, tipR: number): DinoGeometry => {
  const axis = DINO_AXIS;
  const along = v3(Math.cos(axis), Math.sin(axis), 0);
  const across = v3(-along.y, along.x, 0);
  const A = 70;
  const B = 52;
  const C = 40;
  const Z = 36;
  const body: Piece[] = [];
  const sphere = new SphereGeometry(1, 24, 16);
  const ell = (c: Vector3, sx: number, sy: number, sz: number, turn: number) =>
    trs(c.x, c.y, c.z, turn, sx, sy, sz);
  body.push({
    geometry: sphere.clone(),
    color: DINO_GREEN,
    matrix: ell(v3(0, 0, Z), A, B, C, axis),
  });
  const surface = (u: number, w: number) => {
    const k = 1 - (u / A) ** 2 - (w / B) ** 2;
    return Z + C * Math.sqrt(Math.max(0, k));
  };
  const at = (u: number, w: number) =>
    v3(along.x * u + across.x * w, along.y * u + across.y * w, surface(u, w));
  // Spots on its back.
  for (const [u, w, r] of [
    [-30, 14, 13],
    [-6, -18, 11],
    [18, 10, 14],
    [36, -10, 9],
    [-44, -6, 8],
    [4, 26, 8],
  ] as const) {
    const c = at(u, w);
    body.push({
      geometry: sphere.clone(),
      color: DINO_DARK,
      matrix: ell(v3(c.x, c.y, c.z - 2.5), r, r * 0.8, 4, axis + u * 0.02),
    });
  }
  // Four stumpy legs at the edge of the body.
  for (const [u, w] of [
    [36, 34],
    [36, -34],
    [-36, 34],
    [-36, -34],
  ] as const) {
    const c = at(u, w);
    const leg = new CylinderGeometry(13, 15, 40, 12);
    leg.rotateX(Math.PI / 2);
    body.push({ geometry: leg, color: DINO_LEG, matrix: trs(c.x, c.y, 20) });
    body.push({
      geometry: sphere.clone(),
      color: "#f4f0e0",
      matrix: ell(
        v3(c.x + across.x * Math.sign(w) * 9, c.y + across.y * Math.sign(w) * 9, 3),
        5,
        5,
        3,
        0,
      ),
    });
  }
  // The neck rises from the front of the body, curving up the table to the head.
  const neckBase = at(42, 0);
  neckBase.z -= 8;
  const neckPts = [
    neckBase,
    v3(neckBase.x - 6, neckBase.y + 30, neckBase.z + 36),
    v3(
      (neckBase.x + head.x) / 2 - 8,
      (neckBase.y + head.y) / 2 + 10,
      (neckBase.z + head.z) / 2 + 18,
    ),
    v3(head.x - 4, head.y - 20, head.z - 10),
    v3(head.x, head.y - 4, head.z - 2),
  ];
  const neck: Piece[] = [
    { geometry: taperTube(neckPts, 25, 16, 14, 20), color: DINO_GREEN },
    { geometry: sphere.clone(), color: DINO_GREEN, matrix: ell(neckBase, 25, 25, 25, 0) },
  ];
  // The head: long and round, pointing up the table, with big eyes and pink cheeks.
  const H = head;
  neck.push({ geometry: sphere.clone(), color: DINO_GREEN, matrix: ell(H, 26, 36, 22, 0) });
  neck.push({
    geometry: sphere.clone(),
    color: DINO_GREEN,
    matrix: ell(v3(H.x, H.y + 22, H.z - 3), 21, 20, 17, 0),
  });
  for (const s of [-1, 1]) {
    neck.push({
      geometry: sphere.clone(),
      color: "#ffffff",
      matrix: ell(v3(H.x + s * 13, H.y - 2, H.z + 14), 10, 10, 9, 0),
    });
    neck.push({
      geometry: sphere.clone(),
      color: "#1a1410",
      matrix: ell(v3(H.x + s * 12.5, H.y + 1, H.z + 21), 5.2, 5.6, 3, 0),
    });
    neck.push({
      geometry: sphere.clone(),
      color: "#ffffff",
      matrix: ell(v3(H.x + s * 11, H.y + 3.5, H.z + 23.5), 1.7, 1.7, 1, 0),
    });
    neck.push({
      geometry: sphere.clone(),
      color: CHEEK,
      matrix: ell(v3(H.x + s * 20, H.y + 12, H.z + 4), 7, 6, 4, 0),
    });
    neck.push({
      geometry: sphere.clone(),
      color: "#2a4a2a",
      matrix: ell(v3(H.x + s * 7, H.y + 38, H.z + 6), 2.4, 2.4, 2, 0),
    });
  }
  // The tail sweeps down from the back of the body to a round tip that lights up.
  const tailBase = at(-44, 0);
  tailBase.z -= 6;
  const tailPts = [
    tailBase,
    v3(tailBase.x + (tip.x - tailBase.x) * 0.35, tailBase.y + (tip.y - tailBase.y) * 0.3, 32),
    v3(tailBase.x + (tip.x - tailBase.x) * 0.7, tailBase.y + (tip.y - tailBase.y) * 0.72, 26),
    v3(tip.x, tip.y, tipR * 0.9),
  ];
  const tail: Piece[] = [
    { geometry: taperTube(tailPts, 26, 15, 12, 18), color: DINO_GREEN },
    {
      geometry: sphere.clone(),
      color: DINO_GREEN,
      matrix: ell(v3(tip.x, tip.y, tipR * 0.9), tipR, tipR, tipR * 0.9, 0),
    },
  ];
  for (const k of [0.3, 0.55, 0.78]) {
    const p = tailPts[0]!.clone().lerp(tailPts.at(-1)!, k);
    tail.push({
      geometry: sphere.clone(),
      color: DINO_DARK,
      matrix: ell(v3(p.x, p.y, 44 - k * 22), 9 - k * 3, 7 - k * 2, 3, 0),
    });
  }
  sphere.dispose();
  return { body: painted([...body, ...tail]), neck: painted(neck), neckBase };
};

/** A baby dinosaur facing +y, about 46 long: white, so an instance colour gives its colour. */
export const babyGeometry = (): BufferGeometry => {
  const s = new SphereGeometry(1, 16, 12);
  const ell = (x: number, y: number, z: number, a: number, b: number, c: number) =>
    trs(x, y, z, 0, a, b, c);
  const pieces: Piece[] = [
    { geometry: s.clone(), color: "#ffffff", matrix: ell(0, -2, 13, 13, 16, 12) },
    { geometry: s.clone(), color: "#ffffff", matrix: ell(0, 16, 24, 12, 12, 11) },
    { geometry: s.clone(), color: "#ffffff", matrix: ell(0, 25, 21, 8, 7, 6) },
    { geometry: s.clone(), color: "#ffffff", matrix: ell(0, -20, 8, 5, 10, 5) },
  ];
  for (const x of [-1, 1]) {
    pieces.push({ geometry: s.clone(), color: "#ffffff", matrix: ell(x * 10, 6, 5, 5, 5, 5) });
    pieces.push({ geometry: s.clone(), color: "#ffffff", matrix: ell(x * 10, -10, 5, 5, 5, 5) });
    pieces.push({ geometry: s.clone(), color: "#ffffff", matrix: ell(x * 6, 18, 33, 4, 4, 3.6) });
    pieces.push({
      geometry: s.clone(),
      color: "#141010",
      matrix: ell(x * 6, 19.5, 35.5, 2.4, 2.6, 1.6),
    });
    pieces.push({ geometry: s.clone(), color: "#ffd0dc", matrix: ell(x * 10, 22, 23, 3.2, 3, 2) });
  }
  s.dispose();
  return painted(pieces);
};

/**
 * A friendly three-horned dinosaur of radius about 1, running along +x: a round body, a frill
 * behind its head, two brow horns and a nose horn, and eyes on top looking up at the viewer.
 */
export const trikeGeometry = (body: string, frill: string): BufferGeometry => {
  const s = new SphereGeometry(1, 18, 12);
  const ell = (x: number, y: number, z: number, a: number, b: number, c: number, turn = 0) =>
    trs(x, y, z, turn, a, b, c);
  const horn = (x: number, y: number, z: number, len: number, tilt: number, r: number) => {
    const c = new CylinderGeometry(0.01, r, len, 10);
    // Pointing along +y first, then forward (+x), then tipped up towards +z.
    c.translate(0, len / 2, 0);
    c.rotateZ(-Math.PI / 2);
    c.rotateY(-tilt);
    c.translate(x, y, z);
    return c;
  };
  const pieces: Piece[] = [
    { geometry: s.clone(), color: body, matrix: ell(-0.05, 0, 0.82, 1.3, 0.95, 0.72) },
    { geometry: s.clone(), color: body, matrix: ell(1.1, 0, 0.98, 0.7, 0.6, 0.55) },
    { geometry: s.clone(), color: body, matrix: ell(1.55, 0, 0.82, 0.3, 0.3, 0.28) },
    { geometry: s.clone(), color: frill, matrix: ell(0.6, 0, 1.3, 0.24, 1.25, 0.85) },
    { geometry: s.clone(), color: body, matrix: ell(-1.45, 0, 0.6, 0.6, 0.28, 0.25) },
    { geometry: horn(1.2, 0.26, 1.35, 0.7, 0.55, 0.11), color: "#fff2d6" },
    { geometry: horn(1.2, -0.26, 1.35, 0.7, 0.55, 0.11), color: "#fff2d6" },
    { geometry: horn(1.62, 0, 1.0, 0.42, 0.35, 0.09), color: "#fff2d6" },
  ];
  for (const y of [-1, 1]) {
    pieces.push({
      geometry: s.clone(),
      color: "#ffffff",
      matrix: ell(1.18, y * 0.27, 1.3, 0.15, 0.15, 0.13),
    });
    pieces.push({
      geometry: s.clone(),
      color: "#181210",
      matrix: ell(1.2, y * 0.27, 1.41, 0.08, 0.08, 0.05),
    });
    pieces.push({
      geometry: s.clone(),
      color: frill,
      matrix: ell(0.55, y * 0.7, 1.32, 0.09, 0.09, 0.05),
    });
    for (const x of [-0.6, 0.55]) {
      const leg = new CylinderGeometry(0.2, 0.24, 0.6, 10);
      leg.rotateX(Math.PI / 2);
      pieces.push({ geometry: leg, color: body, matrix: trs(x, y * 0.62, 0.3) });
    }
  }
  s.dispose();
  return painted(pieces);
};

// ---- Eggs --------------------------------------------------------------------------------------

/** Half an egg lying along x on the playfield, the half on one side of its long middle. */
export const eggHalfGeometry = (length: number, radius: number, side: 1 | -1) => {
  const pts: Vector2[] = [];
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const t = -1 + (2 * i) / n;
    const r = radius * Math.sqrt(Math.max(0, 1 - t * t)) * (1 + 0.14 * t);
    pts.push(new Vector2(Math.max(0.01, r), (t * length) / 2));
  }
  // The lathe's y is the egg's long axis; phi 0 to pi is the half at -y once laid down.
  const g = new LatheGeometry(pts, 14, side === 1 ? Math.PI : 0, Math.PI);
  g.rotateZ(-Math.PI / 2);
  g.translate(0, 0, radius);
  return g;
};

/** A zigzag crack along the top of an egg lying along x. */
export const crackGeometry = (length: number, radius: number) => {
  const pts: Vector3[] = [];
  const n = 9;
  for (let i = 0; i <= n; i++) {
    const t = -0.72 + (1.44 * i) / n;
    const y = (i % 2 === 0 ? -1 : 1) * radius * 0.16;
    const r = radius * Math.sqrt(Math.max(0, 1 - t * t)) * (1 + 0.14 * t);
    const z = radius + Math.sqrt(Math.max(0, r * r - y * y));
    pts.push(v3((t * length) / 2, y, z + 0.6));
  }
  const curve = new CatmullRomCurve3(pts, false, "catmullrom", 0.1);
  return new TubeGeometry(curve, 40, 1.9, 5, false);
};

// ---- Ferns, boulders, cycads -------------------------------------------------------------------

/** A fern: fronds arching up and out from its middle, darker at the heart. */
export const fernGeometry = (seed: number, size = 1): BufferGeometry => {
  const rnd = stream(seed);
  const pos: number[] = [];
  const col: number[] = [];
  const dark = new Color("#1f5a2a");
  const light = new Color("#7ad06a");
  const c = new Color();
  const fronds = 8;
  const push = (p: Vector3, k: number) => {
    pos.push(p.x * size, p.y * size, p.z * size);
    c.copy(dark).lerp(light, k);
    col.push(c.r, c.g, c.b);
  };
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + rnd() * 0.4;
    const len = 60 + rnd() * 26;
    const dir = v3(Math.cos(a), Math.sin(a), 0);
    const perp = v3(-dir.y, dir.x, 0);
    const point = (k: number) =>
      v3(dir.x * len * k, dir.y * len * k, 30 * Math.sin(k * Math.PI * 0.9) + 2);
    const steps = 12;
    for (let i = 0; i < steps; i++) {
      const k0 = i / steps;
      const k1 = (i + 1) / steps;
      const p0 = point(k0);
      const p1 = point(k1);
      const w = 13 * (1 - k0 * 0.85);
      // A leaflet each side: a thin triangle from the stem out and forward.
      for (const s of [-1, 1]) {
        const tipP = v3(
          p0.x + perp.x * s * w + dir.x * w * 0.5,
          p0.y + perp.y * s * w + dir.y * w * 0.5,
          p0.z - 2,
        );
        // Counter-clockwise from above, so the leaflets face the viewer.
        if (s === 1) {
          push(p0, k0);
          push(p1, k1);
          push(tipP, k0 + 0.2);
        } else {
          push(p0, k0);
          push(tipP, k0 + 0.2);
          push(p1, k1);
        }
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
};

/** A lumpy rock of radius about 1: every vertex pushed in or out a little. */
export const boulderGeometry = (seed: number, detail = 1, rough = 0.42) => {
  const rock = new IcosahedronGeometry(1, detail);
  const pos = rock.getAttribute("position");
  const rnd = stream(seed);
  const bumps = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let k = bumps.get(key);
    if (k === undefined) {
      k = 1 - rough / 2 + rnd() * rough;
      bumps.set(key, k);
    }
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
  }
  rock.computeVertexNormals();
  return rock;
};

// ---- Sparks and smoke --------------------------------------------------------------------------

/** How one kind of particle moves: sparks fall and fade, smoke drifts up, grows and fades. */
export interface Behaviour {
  /** Towards the playfield, px/s^2 (negative rises). */
  gravity: number;
  /** Share of speed lost per second. */
  drag: number;
  /** How much bigger it ends than it starts (negative shrinks). */
  grow: number;
  /** How sharply it fades. */
  fade: number;
}

export interface Particles {
  readonly mesh: InstancedMesh;
  /** Start one of `kind` at field (x, y, z) moving (vx, vy, vz) px/s, for `life` s, `size` across. */
  emit(
    kind: number,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size: number,
    color: Color,
  ): void;
  /** Move them all on `dt` seconds. */
  update(dt: number): void;
  /** How many are alive. */
  readonly live: number;
  clear(): void;
}

/**
 * A fixed pool of glowing quads facing the viewer, of several kinds in one draw. A new one takes
 * the oldest slot when the pool is full.
 */
export const createParticles = (
  geo: BufferGeometry,
  mat: Material,
  max: number,
  kinds: readonly Behaviour[],
): Particles => {
  const mesh = instances(geo, mat, max);
  const px = new Float32Array(max);
  const py = new Float32Array(max);
  const pz = new Float32Array(max);
  const vx = new Float32Array(max);
  const vy = new Float32Array(max);
  const vz = new Float32Array(max);
  const age = new Float32Array(max);
  const life = new Float32Array(max).fill(0);
  const size = new Float32Array(max);
  const kindOf = new Uint8Array(max);
  const cols = Array.from({ length: max }, () => new Color());
  const tmp = new Color();
  const m4 = new Matrix4();
  const q = new Quaternion();
  const p = new Vector3();
  const s = new Vector3();
  const zero = new Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < max; i++) {
    mesh.setMatrixAt(i, zero);
    mesh.setColorAt(i, tmp.setRGB(0, 0, 0));
  }
  let next = 0;
  let live = 0;
  return {
    mesh,
    get live() {
      return live;
    },
    emit(kind, x, y, z, ux, uy, uz, l, sz, color) {
      const i = next;
      next = (next + 1) % max;
      kindOf[i] = Math.max(0, Math.min(kinds.length - 1, kind));
      px[i] = x;
      py[i] = y;
      pz[i] = z;
      vx[i] = ux;
      vy[i] = uy;
      vz[i] = uz;
      age[i] = 0;
      life[i] = l;
      size[i] = sz;
      cols[i]!.copy(color);
    },
    update(dt) {
      live = 0;
      for (let i = 0; i < max; i++) {
        if (life[i]! <= 0) continue;
        age[i]! += dt;
        if (age[i]! >= life[i]!) {
          life[i] = 0;
          mesh.setMatrixAt(i, zero);
          continue;
        }
        live++;
        const o = kinds[kindOf[i]!]!;
        const d = Math.exp(-o.drag * dt);
        vz[i]! -= o.gravity * dt;
        vx[i]! *= d;
        vy[i]! *= d;
        vz[i]! *= d;
        px[i]! += vx[i]! * dt;
        py[i]! += vy[i]! * dt;
        pz[i] = Math.max(1, pz[i]! + vz[i]! * dt);
        const k = age[i]! / life[i]!;
        const r = size[i]! * (1 + o.grow * k);
        mesh.setMatrixAt(i, m4.compose(p.set(px[i]!, -py[i]!, pz[i]!), q, s.set(r, r, 1)));
        mesh.setColorAt(i, tmp.copy(cols[i]!).multiplyScalar((1 - ease(k)) ** o.fade));
      }
      mesh.instanceMatrix.needsUpdate = true;
      dirty(mesh);
    },
    clear() {
      life.fill(0);
      for (let i = 0; i < max; i++) mesh.setMatrixAt(i, zero);
      mesh.instanceMatrix.needsUpdate = true;
      live = 0;
    },
  };
};
