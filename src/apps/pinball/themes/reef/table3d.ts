/**
 * Reef's toys on a table, in 3D: three pufferfish that swell with their spines out and watch the
 * nearest ball, the giant clam whose lid lifts and snaps shut over its pearl, the clear turtle
 * ramp with a sea turtle that leads balls down it, starfish on the targets, and the water itself:
 * caustics over the sand, streaks in the current, bubbles, and kelp in the corners. Sizes match
 * the physics in index.ts; positions come from the table's (mirrored) middle.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  ExtrudeGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshPhongMaterial,
  Object3D,
  Quaternion,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { BALL_R, TABLE_H } from "../../config";
import { along3, length3, type P3 } from "../../devices";
import type { TableLayout } from "../../layout";
import type { Table } from "../../table";
import { dirty, instances } from "../../view3d/deckparts3d";
import { at, type Kit, railsGeometry, tubeGeometry } from "../../view3d/kit";
import type { TableModel } from "../../view3d/look";
import type { ReefMiddle, ReefToys } from ".";
import { paintPuffer, paintTurtleShell } from "./art";
import { createBubbles, createCaustics, createKelp, createMotes, type Strand } from "./water";

/** The clam's outline radius and its rim's height, table px, and how far its lid opens. */
const CLAM_R = 68;
const RIM_Z = 11;
const LID_OPEN = 1.32;

/** The clam's outline at angle `th` round its middle (hinge at +x): a fan, scalloped. */
const outline = (th: number) =>
  CLAM_R * (1 - 0.2 * Math.max(0, Math.cos(th)) ** 3) * (1 + 0.035 * Math.cos(16 * th));

const lerp3 = (a: Color, b: Color, k: number, out: Color) => out.copy(a).lerp(b, k);

/**
 * A surface over the clam's outline, rings out from the middle: height and colour by (rho, th).
 * `side` -1 builds the mirror image (hinge at -x); `down` faces it towards the field.
 */
const shellSurface = (
  side: number,
  z: (rho: number, th: number) => number,
  color: (rho: number, th: number, out: Color) => void,
  down: boolean,
  rhoMax = 1,
) => {
  const NT = 64;
  const NR = 10;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const c = new Color();
  for (let i = 0; i <= NR; i++) {
    const rho = Math.max(0.002, (i / NR) * rhoMax);
    for (let j = 0; j < NT; j++) {
      const th = (j / NT) * Math.PI * 2;
      const R = outline(th) * rho;
      pos.push(side * R * Math.cos(th), R * Math.sin(th), z(rho, th));
      color(rho, th, c);
      col.push(c.r, c.g, c.b);
    }
  }
  // Mirroring x turns the triangles over, and so does facing down: flip once for each.
  const flip = side < 0 !== down;
  for (let i = 0; i < NR; i++) {
    for (let j = 0; j < NT; j++) {
      const a = i * NT + j;
      const b = i * NT + ((j + 1) % NT);
      const cc = (i + 1) * NT + j;
      const d = (i + 1) * NT + ((j + 1) % NT);
      if (flip) idx.push(a, b, cc, b, d, cc);
      else idx.push(a, cc, b, b, cc, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
};

const NACRE = [new Color("#fff4f7"), new Color("#d9c4f2"), new Color("#a9dcf0")];
const nacre = (rho: number, th: number, out: Color) => {
  lerp3(NACRE[0]!, NACRE[1]!, rho ** 1.5, out);
  out.lerp(NACRE[2]!, 0.35 * (0.5 + 0.5 * Math.sin(th * 3 + rho * 5)));
};
const SHELL = [new Color("#6f4f9a"), new Color("#e2d2f4"), new Color("#9a78c4")];
const shellOut = (rho: number, th: number, out: Color) => {
  const rib = (0.5 + 0.5 * Math.cos(16 * th)) ** 3;
  lerp3(SHELL[0]!, SHELL[1]!, rib * 0.7, out);
  if (Math.sin(rho * 24) > 0.75) out.multiplyScalar(0.82);
  return out.lerp(SHELL[2]!, Math.max(0, 0.4 - rho));
};

interface ClamGeo {
  bottom: BufferGeometry;
  lid: BufferGeometry;
}

/** The clam's two shells for one side: the bottom (inside and skirt), and the lid about its hinge. */
const clamGeometry = (side: number): ClamGeo => {
  const inside = shellSurface(side, (r) => 2 + (RIM_Z - 2) * r * r, nacre, false);
  const skirt = shellSurface(
    side,
    (r) => (r <= 1 ? RIM_Z : RIM_Z * Math.max(0, 1 - (r - 1) / 0.07)),
    (_r, th, out) => void shellOut(1, th, out).multiplyScalar(0.8),
    false,
    1.07,
  );
  // Only the skirt's outer ring is wanted: drop the rings inside the rim.
  const ring = new BufferGeometry();
  const sp = skirt.getAttribute("position");
  const sc = skirt.getAttribute("color");
  const keepPos: number[] = [];
  const keepCol: number[] = [];
  for (let i = 0; i < sp.count; i += 3) {
    let outer = true;
    for (let k = 0; k < 3; k++) {
      if (
        sp.getZ(i + k) >= RIM_Z - 1e-3 &&
        Math.hypot(sp.getX(i + k), sp.getY(i + k)) < CLAM_R * 0.8
      )
        outer = false;
    }
    if (!outer) continue;
    for (let k = 0; k < 3; k++) {
      keepPos.push(sp.getX(i + k), sp.getY(i + k), sp.getZ(i + k));
      keepCol.push(sc.getX(i + k), sc.getY(i + k), sc.getZ(i + k));
    }
  }
  ring.setAttribute("position", new BufferAttribute(new Float32Array(keepPos), 3));
  ring.setAttribute("color", new BufferAttribute(new Float32Array(keepCol), 3));
  ring.computeVertexNormals();
  skirt.dispose();
  const bottom = mergeGeometries([inside, ring])!;
  inside.dispose();
  ring.dispose();
  const H = 30;
  const outer = shellSurface(
    side,
    (r, th) => RIM_Z + H * (1 - r * r) ** 0.75 + 2.2 * r * Math.cos(16 * th),
    shellOut,
    false,
  );
  const under = shellSurface(side, (r) => RIM_Z + 7 * (1 - r * r), nacre, true);
  const lid = mergeGeometries([outer, under])!;
  outer.dispose();
  under.dispose();
  // About the hinge: at the outline's narrow end, on the rim.
  lid.translate(-side * outline(0), 0, -RIM_Z);
  return { bottom, lid };
};

/** Points on a sphere, spread evenly (a Fibonacci spiral), on the side facing the viewer. */
const spinePoints = (n: number) => {
  const out: Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const a = i * 2.39996;
    const p = new Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
    if (p.z > -0.25) out.push(p);
  }
  return out;
};

/** A flat strip `half` wide either side of a path with heights, facing up. */
const ribbonGeometry = (pts: readonly P3[], half: number) => {
  const pos: number[] = [];
  const idx: number[] = [];
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(pts.length - 1, i + 1)]!;
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / l;
    const ny = (b.x - a.x) / l;
    pos.push(p.x + nx * half, -(p.y + ny * half), p.z, p.x - nx * half, -(p.y - ny * half), p.z);
    if (i > 0) {
      const o = (i - 1) * 2;
      idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
    }
  });
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
};

const starShape = () => {
  const s = new Shape();
  for (let i = 0; i < 5; i++) {
    const a = Math.PI / 2 + (i * Math.PI * 2) / 5;
    const b = a + Math.PI / 5;
    const tip = { x: Math.cos(a), y: Math.sin(a) };
    const dip = { x: Math.cos(b) * 0.46, y: Math.sin(b) * 0.46 };
    if (i === 0) s.moveTo(tip.x, tip.y);
    else s.lineTo(tip.x, tip.y);
    s.quadraticCurveTo(Math.cos(a + 0.35) * 0.62, Math.sin(a + 0.35) * 0.62, dip.x, dip.y);
  }
  s.closePath();
  return s;
};

export interface Assets {
  puffer: MeshPhongMaterial;
  spines: BufferGeometry;
  spineMat: MeshPhongMaterial;
  /** Small round parts in instance colours, many to a draw: fins, eyes, pupils, a pearl. */
  beads: MeshPhongMaterial;
  painted: MeshPhongMaterial;
  clam: Map<number, ClamGeo>;
  shell: BufferGeometry;
  shellMat: MeshPhongMaterial;
  star: BufferGeometry;
  starMat: MeshPhongMaterial;
}

const cache = new WeakMap<Kit, Assets>();

export const reefAssets = (kit: Kit): Assets => {
  const have = cache.get(kit);
  if (have) return have;
  const pts = spinePoints(70);
  const cones = pts.map((p) => {
    const c = new ConeGeometry(0.075, 0.38, 5);
    // Standing out from the surface: the cone's axis along the point's direction.
    c.translate(0, 0.19 + 0.8, 0);
    c.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), p));
    return c;
  });
  const spines = kit.keep(mergeGeometries(cones)!);
  for (const c of cones) c.dispose();
  const shell = kit.keep(new SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2));
  shell.rotateX(Math.PI / 2);
  // Seen from above: a planar map, the head towards +x.
  const sp = shell.getAttribute("position");
  const uv = new Float32Array(sp.count * 2);
  for (let i = 0; i < sp.count; i++) {
    uv[i * 2] = sp.getX(i) * 0.5 + 0.5;
    uv[i * 2 + 1] = sp.getY(i) * 0.5 + 0.5;
  }
  shell.setAttribute("uv", new BufferAttribute(uv, 2));
  const star = kit.keep(
    new ExtrudeGeometry(starShape(), {
      depth: 0.22,
      bevelEnabled: true,
      bevelThickness: 0.1,
      bevelSize: 0.08,
      bevelSegments: 2,
      curveSegments: 6,
    }),
  );
  const a: Assets = {
    puffer: kit.keep(
      new MeshPhongMaterial({
        map: kit.paint(256, 128, (g) => paintPuffer(g, 256, 128, 3, "#f3cf5a", "#8a6420")),
        shininess: 40,
        specular: "#666666",
      }),
    ),
    spines,
    spineMat: kit.keep(new MeshPhongMaterial({ color: "#efe0a6", shininess: 30 })),
    beads: kit.keep(
      new MeshPhongMaterial({ color: "#ffffff", shininess: 100, specular: "#999999" }),
    ),
    painted: kit.keep(
      new MeshPhongMaterial({ vertexColors: true, shininess: 90, specular: "#aaaaaa" }),
    ),
    clam: new Map(),
    shell,
    shellMat: kit.keep(
      new MeshPhongMaterial({
        map: kit.paint(256, 256, (g) => paintTurtleShell(g, 256)),
        shininess: 50,
        specular: "#777777",
      }),
    ),
    star,
    starMat: kit.keep(
      new MeshPhongMaterial({ color: "#ffffff", shininess: 25, emissive: "#000000" }),
    ),
  };
  cache.set(kit, a);
  return a;
};

const clamFor = (kit: Kit, A: Assets, side: number) => {
  let c = A.clam.get(side);
  if (!c) {
    c = clamGeometry(side);
    kit.keep(c.bottom);
    kit.keep(c.lid);
    A.clam.set(side, c);
  }
  return c;
};

const ease = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const flashOf = (t: Table, tag: string, i: number, s = 0.25) => {
  const age = t.flashAge(tag, i);
  return age < s ? 1 - age / s : 0;
};

const dummy = new Object3D();
const tmp = new Color();
const m4 = new Matrix4();
const q = new Quaternion();
const q2 = new Quaternion();
const v = new Vector3();
const v2 = new Vector3();
const s3 = new Vector3();
const Z = new Vector3(0, 0, 1);
const Y = new Vector3(0, 1, 0);

const SIDES = [-1, 1] as const;
const STAR_COLORS = ["#ff9f5a", "#b98aff", "#5fc8ff"];
/** Where each kind of bead starts in the table's one instanced mesh of them. */
const FIN = 0;
const EYE = 6;
const PUPIL = 12;
const TURTLE_AT = 18;
const PEARL_AT = 25;
const BEADS = 26;
const BEAD_COLOR = Array.from(
  { length: BEADS },
  (_, i) =>
    new Color(
      i < EYE
        ? "#ffad6a"
        : i < PUPIL
          ? "#ffffff"
          : i < TURTLE_AT
            ? "#16202a"
            : i < TURTLE_AT + 5
              ? "#8fb86c"
              : i < PEARL_AT
                ? "#1a1d22"
                : "#ffe3f0",
    ),
);
const PEARL = "#ffe3f0";
const TURTLE_LAMP = "#7dffb8";
/** The turtle: shell half-length, half-width and height. */
const TURTLE = { a: 46, b: 37, c: 17 };
/** Its head, flippers and eyes: x, y, z, and size along x, y and z. */
const PARTS: readonly (readonly [number, number, number, number, number, number])[] = [
  [TURTLE.a + 8, 0, 4, 15, 12, 9],
  [TURTLE.a * 0.4, TURTLE.b * 0.95, 0, 30, 10, 4],
  [TURTLE.a * 0.4, -TURTLE.b * 0.95, 0, 30, 10, 4],
  [-TURTLE.a * 0.75, TURTLE.b * 0.7, 0, 16, 8, 3],
  [-TURTLE.a * 0.75, -TURTLE.b * 0.7, 0, 16, 8, 3],
  [TURTLE.a + 13, 6.5, 8, 2.6, 2.6, 2.6],
  [TURTLE.a + 13, -6.5, 8, 2.6, 2.6, 2.6],
];
const TURN = PARTS.map(() => 0);

/** Kelp in the corners outside the arch, as built (unmirrored). */
const KELP: Strand[] = [
  { x: 16, y: 440, a: -1.45, len: 220, width: 9 },
  { x: 48, y: 330, a: -1.25, len: 190, width: 8 },
  { x: 112, y: 232, a: -1.75, len: 150, width: 7 },
  { x: 1066, y: 430, a: -1.68, len: 200, width: 9 },
  { x: 1032, y: 318, a: -1.92, len: 180, width: 8 },
  { x: 962, y: 210, a: -1.45, len: 140, width: 7 },
];

export const reefTable = (kit: Kit, layout: TableLayout): TableModel => {
  const m = layout.middle as ReefMiddle;
  const A = reefAssets(kit);
  const side = m.mirror ? -1 : 1;
  const X = (x: number) => (m.mirror ? 1080 - x : x);
  const root = new Group();
  const own: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => {
    own.push(x);
    return x;
  };
  const still = <T extends Object3D>(o: T) => {
    o.userData.static = true;
    return o;
  };

  // The water: caustics over the playfield, motes in the current, kelp in the corners, bubbles.
  const field = new Shape();
  field.moveTo(X(24), -TABLE_H);
  field.lineTo(X(24), -640);
  field.absarc(540, -640, 516, Math.PI, 0, true);
  field.lineTo(X(1058), -TABLE_H);
  field.closePath();
  const caustics = createCaustics(kit, keep(new ShapeGeometry(field, 24)), {
    tile: 230,
    tint: "#1f5864",
    z: 0.3,
  });
  root.add(caustics.mesh);
  const motes = createMotes(kit, 26, m.current.box, {
    color: "#d8fbff",
    size: 16,
    speed: 170,
    z: 3,
    seed: m.mirror ? 7 : 3,
  });
  root.add(motes.mesh);
  const kelp = createKelp(
    kit,
    KELP.map((s) => ({ ...s, x: X(s.x), a: m.mirror ? Math.PI - s.a : s.a })),
    { z: 2, seed: m.mirror ? 5 : 2 },
  );
  root.add(kelp.mesh);
  const bubbles = createBubbles(kit, 40);
  root.add(bubbles.mesh);

  // Pufferfish: bodies and spines, one instanced draw each for all three. Their fins, eyes and
  // pupils, the turtle's head, flippers and eyes, and the clam's pearl are all beads: one draw.
  const n = m.puffers.length;
  const bodies = instances(kit.geo.sphere, A.puffer, n);
  const spines = instances(A.spines, A.spineMat, n);
  const beads = instances(kit.geo.sphere, A.beads, BEADS);
  for (let i = 0; i < BEADS; i++) beads.setColorAt(i, BEAD_COLOR[i]!);
  root.add(bodies, spines, beads);
  for (const c of m.puffers) {
    const sh = still(new Mesh(kit.geo.quad, kit.mat.shadow));
    sh.scale.set(c.r * 2.6, c.r * 2.6, 1);
    at(sh, c.x, c.y + 10, 0.4);
    root.add(sh);
  }

  // The clam: the bottom shell stays, the lid turns about its hinge; the pearl inside glows.
  const cg = clamFor(kit, A, side);
  const clamRoot = new Group();
  at(clamRoot, m.clam.x, m.clam.y, 0);
  const bottom = still(new Mesh(cg.bottom, A.painted));
  const lidPivot = new Group();
  lidPivot.position.set(side * outline(0), 0, RIM_Z);
  const lid = new Mesh(cg.lid, A.painted);
  lidPivot.add(lid);
  const pearlGlowMat = keep(kit.glow(PEARL).clone());
  const pearlGlow = new Mesh(kit.geo.quad, pearlGlowMat);
  pearlGlow.scale.set(90, 90, 1);
  pearlGlow.position.set(-side * 8, 0, 4);
  const clamShadow = still(new Mesh(kit.geo.quad, kit.mat.shadow));
  clamShadow.scale.set(CLAM_R * 2.8, CLAM_R * 2.4, 1);
  clamShadow.position.set(0, -10, 0.4);
  clamRoot.add(clamShadow, bottom, pearlGlow, lidPivot);
  root.add(clamRoot);

  // The turtle ramp: guides round its mouth, then a clear floor with a rail along each side, up
  // and round into the inlane.
  const railMat = kit.phong("#7fe6d8", { emissive: "#0d3a40", shininess: 90 });
  const rg = railsGeometry(m.ramp.walls, 22);
  if (rg) root.add(still(new Mesh(keep(rg), railMat)));
  const start: P3 = {
    x: m.ramp.mouth.x + m.ramp.dir.x * 14,
    y: m.ramp.mouth.y + m.ramp.dir.y * 14,
    z: BALL_R,
  };
  const path = [start, ...m.ramp.path];
  const offset = (k: number, dz: number) =>
    path.map((p, i) => {
      const a = path[Math.max(0, i - 1)]!;
      const b = path[Math.min(path.length - 1, i + 1)]!;
      const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return {
        x: p.x + (-(b.y - a.y) / l) * k,
        y: p.y + ((b.x - a.x) / l) * k,
        z: Math.max(2, p.z + dz),
      };
    });
  for (const k of [BALL_R + 6, -(BALL_R + 6)]) {
    root.add(still(new Mesh(keep(tubeGeometry(offset(k, 2), 5.5, 8)), railMat)));
  }
  const floor = keep(ribbonGeometry(offset(0, -BALL_R + 1), BALL_R + 6));
  root.add(still(new Mesh(floor, kit.phong("#6fe0d6", { opacity: 0.5, shininess: 120 }))));
  for (const i of [3, 6, 9]) {
    const p = path[i];
    if (!p) continue;
    const post = still(new Mesh(kit.geo.cylinder, kit.mat.metal));
    post.scale.set(4, 4, Math.max(2, p.z - BALL_R - 3));
    at(post, p.x, p.y, 0);
    root.add(post);
  }

  // The sea turtle: a patterned shell (its head, flippers and eyes are beads).
  const turtle = new Group();
  const shellMesh = new Mesh(A.shell, A.shellMat);
  shellMesh.scale.set(TURTLE.a, TURTLE.b, TURTLE.c);
  turtle.add(shellMesh);
  root.add(turtle);

  // Starfish on the targets.
  const stars = instances(A.star, A.starMat, m.stars.length);
  root.add(stars);
  const starBase = STAR_COLORS.map((c) => new Color(c));

  const nearest = (x: number, y: number, balls: readonly { x: number; y: number }[]) => {
    let best: { x: number; y: number } | null = null;
    let bd = 520;
    for (const b of balls) {
      const d = Math.hypot(b.x - x, b.y - y);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  };

  /** When each watched flash was last seen: the puffers', the clam's snap and the jackpot's. */
  const seen = [-1, -1, -1, -1, -1];
  /** True once for each new flash of (tag, index), which `slot` remembers. */
  const fresh = (t: Table, tag: string, i: number, slot: number) => {
    const age = t.flashAge(tag, i);
    if (age > 0.2) return false;
    const when = t.world.t - age;
    if (seen[slot] === when) return false;
    seen[slot] = when;
    return true;
  };

  let lastTime = 0;
  let lastWorld = 0;
  const pathLen = length3(path);
  const idleS = length3(path.slice(0, 5));
  let ts = idleS;
  let aside = 0;
  let heading = 0;
  let trail = 0;
  let vent = 0;
  const vents = [
    { x: X(150), y: 1240 },
    { x: X(880), y: 1200 },
    { x: X(600), y: 760 },
  ];

  return {
    root,
    owns: ["puffer", "clam", "hinge", "reef", "target"],
    sync(t: Table, time: number) {
      const toys = t.toys as ReefToys;
      const now = t.world.t;
      const dt = Math.max(0, Math.min(0.1, time - lastTime));
      lastTime = time;
      // A new game or a reset clears what was in flight.
      if (now < lastWorld) bubbles.clear();
      lastWorld = now;
      const flow = toys.flow.dir;
      caustics.sync(time);
      motes.update(dt, time, flow);
      kelp.update(time, { x: flow.x * 0.6, y: flow.y * 0.6 });

      // Pufferfish.
      m.puffers.forEach((c, i) => {
        const p = toys.puffers[i]!;
        const k = p.k;
        const r = c.r;
        const hit = flashOf(t, "puffer", i, 0.3);
        if (fresh(t, "puffer", i, i)) {
          for (let b = 0; b < 4; b++) {
            const a = (b / 4) * Math.PI * 2 + time;
            bubbles.spawn(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, r, 5 + b, 0, 0, 160, 1.4);
          }
        }
        const bob = Math.sin(time * 2.1 + i * 1.7) * 3;
        const z = r * 0.85 + bob;
        q.setFromAxisAngle(Z, Math.sin(time * 1.3 + i) * 0.12 * (1 - k));
        q2.setFromAxisAngle(Y, Math.sin(time * 0.9 + i * 2) * 0.1);
        q.multiply(q2);
        bodies.setMatrixAt(
          i,
          m4.compose(v.set(c.x, -c.y, z), q, s3.set(r * 1.04, r * 0.97, r * 0.92)),
        );
        bodies.setColorAt(i, tmp.set("#ffffff").multiplyScalar(1 + 0.7 * hit));
        const ss = r * (0.8 + 0.32 * k);
        spines.setMatrixAt(i, m4.compose(v.set(c.x, -c.y, z), q, s3.set(ss, ss, ss)));
        // Fins either side, fanning.
        for (const s of SIDES) {
          const flap = Math.sin(time * (9 + 6 * k) + i * 1.3 + (s > 0 ? 0 : 1.1)) * 0.5;
          dummy.position.set(c.x + s * r * 0.98, -c.y - r * 0.12, z + r * 0.05);
          dummy.quaternion.copy(q).multiply(q2.setFromAxisAngle(Y, -s * (0.35 + flap)));
          dummy.scale.set(r * 0.5, r * 0.32, r * 0.09);
          dummy.updateMatrix();
          beads.setMatrixAt(FIN + i * 2 + (s > 0 ? 1 : 0), dummy.matrix);
        }
        // Eyes on the face, bulging when puffed, watching the nearest ball.
        const ball = nearest(c.x, c.y, t.world.balls);
        const er = r * 0.27 * (1 + 0.25 * k);
        for (const s of SIDES) {
          v2.set(s * 0.42, 0.3, 0.86)
            .normalize()
            .applyQuaternion(q);
          v.set(c.x, -c.y, z).addScaledVector(v2, r * 0.93);
          q2.identity();
          beads.setMatrixAt(
            EYE + i * 2 + (s > 0 ? 1 : 0),
            m4.compose(v, q2, s3.set(er, er, er * 0.8)),
          );
          const look = v2.set(0, 0, 1);
          if (ball) {
            const dx = ball.x - c.x;
            const dy = -(ball.y - c.y);
            const l = Math.hypot(dx, dy) || 1;
            look.set((dx / l) * 0.8, (dy / l) * 0.8, 0.6).normalize();
          }
          const pr = er * (0.55 - 0.18 * k);
          v.addScaledVector(look, er * 0.62);
          beads.setMatrixAt(
            PUPIL + i * 2 + (s > 0 ? 1 : 0),
            m4.compose(v, q2, s3.set(pr, pr, pr * 0.7)),
          );
        }
      });
      bodies.instanceMatrix.needsUpdate = true;
      spines.instanceMatrix.needsUpdate = true;
      dirty(bodies);

      // The clam: its lid by the toys' rhythm, a jolt when it snaps, the pearl by pearls lit.
      const lidK = toys.lid(now);
      const snap = flashOf(t, "snap", 0, 0.35);
      lidPivot.rotation.y = side * lidK * LID_OPEN;
      clamRoot.position.z = snap * Math.sin(time * 60) * 2;
      const jackpot = Math.max(0, 1 - (now - toys.jackpotAt) / 1.6);
      const glow =
        0.15 +
        0.2 * toys.pearls +
        jackpot * 1.2 +
        flashOf(t, "pearl", Math.max(0, toys.pearls - 1), 0.6) * 0.6;
      q2.identity();
      beads.setMatrixAt(
        PEARL_AT,
        m4.compose(
          v.set(m.clam.x - side * 8, -m.clam.y, 12 + clamRoot.position.z),
          q2,
          s3.set(14, 14, 14),
        ),
      );
      beads.setColorAt(PEARL_AT, tmp.set(PEARL).multiplyScalar(0.9 + Math.min(1, glow * 0.55)));
      // The pearl's halo only while a pearl has just lit or a jackpot is paid, so it costs nothing
      // the rest of the time.
      const halo =
        jackpot * 0.9 + flashOf(t, "pearl", Math.max(0, toys.pearls - 1), 2.6) * lidK * 0.7;
      pearlGlow.visible = halo > 0.01;
      pearlGlowMat.color.set(PEARL).multiplyScalar(halo);
      pearlGlow.scale.setScalar(90 + jackpot * 140);
      if (fresh(t, "snap", 0, 3)) {
        for (let b = 0; b < 8; b++) {
          bubbles.spawn(
            m.clam.x + (b - 3.5) * 14,
            m.clam.y - 20 + (b % 2) * 30,
            30,
            6 + (b % 3) * 3,
            0,
            -20,
            140 + b * 10,
            1.6,
          );
        }
      }
      if (fresh(t, "jackpot", 0, 4)) {
        for (let b = 0; b < 18; b++) {
          const a = (b / 18) * Math.PI * 2;
          bubbles.spawn(
            m.clam.x + Math.cos(a) * 40,
            m.clam.y + Math.sin(a) * 40,
            20,
            7 + (b % 4) * 3,
            Math.cos(a) * 90,
            Math.sin(a) * 90,
            180,
            2,
          );
        }
      }

      // The turtle lives on the ramp: it waits at the top of the hairpin, swims down ahead of a
      // ball riding it (follow me), then swims back up.
      const rider = toys.ride.riders[0];
      const cap = pathLen - 170;
      const target = rider ? Math.min(cap, Math.max(idleS, rider.k * pathLen + 130)) : idleS;
      // Near the bottom it moves over and lets the ball by.
      const by = rider ? Math.max(0, Math.min(1, (rider.k * pathLen - (cap - 130)) / 60)) : 0;
      aside += (by - aside) * Math.min(1, dt * 10);
      const step = (rider ? 900 : 240) * dt;
      const d = Math.max(-step, Math.min(step, target - ts));
      ts += d;
      const p = along3(path, ts);
      const going = Math.abs(d) > 0.5 * dt * 60;
      const back = going && d < 0;
      const face = Math.atan2(-p.dy, p.dx) + (back ? Math.PI : 0);
      let dh = face - heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      heading += dh * Math.min(1, dt * 6);
      const bob = Math.sin(time * 1.6) * 2.5;
      const sway = (going ? 0 : Math.sin(time * 0.6) * 5) - side * aside * 70;
      at(turtle, p.x - p.dy * sway, p.y + p.dx * sway, p.z - BALL_R + 5 + bob);
      turtle.rotation.z = heading;
      turtle.updateMatrix();
      const stroke = time * (going ? 9 : 2.2);
      const yaw = going ? 0 : Math.sin(time * 0.7) * 0.45;
      TURN[1] = 0.5 + Math.sin(stroke) * 0.55;
      TURN[2] = -TURN[1];
      TURN[3] = 2.4 + Math.sin(stroke + 1.4) * 0.3;
      TURN[4] = -TURN[3];
      PARTS.forEach(([x, y, z, sx, sy, sz], i) => {
        const turn = TURN[i]!;
        if (i === 0 || i >= 5) {
          // The head and eyes turn together about the neck.
          const r = x - TURTLE.a + 2;
          dummy.position.set(
            TURTLE.a - 2 + Math.cos(yaw) * r - Math.sin(yaw) * y,
            Math.sin(yaw) * r + Math.cos(yaw) * y,
            z,
          );
          dummy.rotation.set(0, 0, yaw);
        } else {
          // Flippers swing out from where they join the shell.
          dummy.position.set(x + Math.cos(turn) * sx * 0.6, y + Math.sin(turn) * sx * 0.6, z);
          dummy.rotation.set(0, 0, turn);
        }
        dummy.scale.set(sx, sy, sz);
        dummy.updateMatrix();
        beads.setMatrixAt(TURTLE_AT + i, m4.multiplyMatrices(turtle.matrix, dummy.matrix));
      });
      beads.instanceMatrix.needsUpdate = true;
      dirty(beads);
      trail += dt;
      if (going && trail > 0.12) {
        trail = 0;
        bubbles.spawn(p.x, p.y, p.z + 10, 5, 0, 0, 120, 1.1);
      }

      // Starfish: lit ones glow, a hit one spins.
      m.stars.forEach((s, i) => {
        const hit = flashOf(t, "target", i, 0.7);
        const lit = t.targets[i] ?? false;
        const spin = hit > 0 ? ease(1 - hit) * Math.PI * 2 : 0;
        const wig = Math.sin(time * 1.7 + i * 2) * 0.08;
        dummy.position.set((s.ax + s.bx) / 2, -(s.ay + s.by) / 2, 12);
        dummy.rotation.set(0, 0, i * 0.7 + spin + wig);
        dummy.scale.set(36, 36, 36);
        dummy.updateMatrix();
        stars.setMatrixAt(i, dummy.matrix);
        stars.setColorAt(
          i,
          tmp.copy(starBase[i % starBase.length]!).multiplyScalar(lit ? 1.45 : 0.85 + hit * 0.8),
        );
      });
      stars.instanceMatrix.needsUpdate = true;
      dirty(stars);

      // Now and then a few bubbles from the sand, and the bubbles drift with the current.
      vent += dt;
      if (vent > 1.6) {
        vent = 0;
        const s = vents[Math.floor(time * 7) % vents.length]!;
        for (let b = 0; b < 3; b++)
          bubbles.spawn(s.x + b * 6, s.y - b * 4, 4 + b * 10, 4 + b, 0, 0, 90, 2.2);
      }
      bubbles.update(dt, { x: flow.x * 40, y: flow.y * 40 });
    },
    lamp(l, t, time) {
      const toys = t.toys as ReefToys;
      if (l.tag === "pearl") {
        const jackpot = t.world.t - toys.jackpotAt < 1.6;
        if (jackpot) return { k: Math.sin(time * 20) > 0 ? 1 : 0.3, color: PEARL };
        return { k: toys.pearls > l.index ? 1 : flashOf(t, "pearl", l.index, 0.5), color: PEARL };
      }
      if (l.tag === "turtle") {
        if (flashOf(t, "turtles", 0, 1.4) > 0)
          return { k: Math.sin(time * 16) > 0 ? 1 : 0.2, color: TURTLE_LAMP };
        return {
          k: toys.rides % 3 > l.index ? 1 : flashOf(t, "turtle", l.index, 0.5),
          color: TURTLE_LAMP,
        };
      }
      return undefined;
    },
    dispose() {
      for (const x of own) x.dispose();
    },
  };
};
