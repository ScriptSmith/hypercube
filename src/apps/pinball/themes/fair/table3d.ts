/**
 * Fun fair's toys on a table, in 3D: the Ferris wheel leaning back over its station (gondolas
 * that carry balls up and over), the carousel's turning floor with horses rising and falling
 * round its striped column, hanging bells that swing when rung, the high striker's tower with
 * its puck and bell, the cannon at the foot of the outlane with a burst of confetti, bunting
 * over the lanes and bulbs chasing round the arch.
 *
 * Draw calls are kept down: every bulb on the table is one instanced mesh and every glow
 * another; the bells, gondolas, horses and brass posts are one instanced mesh each; and
 * everything that stands still is painted in vertex colours and merged.
 */
import {
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  MixOperation,
  Quaternion,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from "three";
import { BALL_R } from "../../config";
import type { TableLayout } from "../../layout";
import type { Table } from "../../table";
import { dirty, instances } from "../../view3d/deckparts3d";
import { at, type Kit, paintedGeometry, railsGeometry, tubeGeometry } from "../../view3d/kit";
import type { TableModel } from "../../view3d/look";
import { type FairMiddle, type FairToys, MARKS, MUZZLE_Z } from ".";
import { FAIR, paintCarouselFloor } from "./art";

type Piece = { geometry: BufferGeometry; color: string; matrix?: Matrix4 };

const M = () => new Matrix4();
const T = (x: number, y: number, z: number) => M().makeTranslation(x, y, z);

/** A bell's profile, mouth down, crown up, about 92 tall and 92 across at the lip. */
const bellProfile = () =>
  [
    [38, -44],
    [46, -46],
    [45, -40],
    [37, -26],
    [31, -8],
    [29, 10],
    [26, 26],
    [18, 36],
    [7, 40],
    [0.01, 41],
  ].map(([r, y]) => new Vector2(r!, y!));
/** From a bell's centre up to the pivot it swings from. */
const BELL_HANG = 50;
const BELL_R = 42;

/** A carousel horse in profile, facing +x, about 1 wide; y up. */
const horseOutline = (): [number, number][] => [
  [-0.42, 0.12],
  [-0.3, 0.1],
  [-0.1, 0.14],
  [0.12, 0.13],
  [0.22, 0.3],
  [0.3, 0.4],
  [0.33, 0.47],
  [0.37, 0.39],
  [0.48, 0.28],
  [0.5, 0.21],
  [0.42, 0.19],
  [0.3, 0.21],
  [0.25, 0.07],
  [0.31, -0.01],
  [0.39, -0.07],
  [0.35, -0.12],
  [0.25, -0.06],
  [0.18, -0.05],
  [0.17, -0.31],
  [0.11, -0.31],
  [0.1, -0.08],
  [-0.18, -0.08],
  [-0.21, -0.29],
  [-0.27, -0.3],
  [-0.27, -0.07],
  [-0.33, -0.1],
  [-0.4, -0.21],
  [-0.45, -0.18],
  [-0.36, -0.01],
  [-0.37, 0.04],
  [-0.47, -0.06],
  [-0.51, -0.01],
];
const HORSE_W = 88;
/** Height of a horse's middle over the playfield, and how far it rises and falls. */
const HORSE_Z = 76;
const BOB = 9;
/** The horses' stands, where balls hit them, stop below the lowest a horse goes. */
const STAND_Z = 54;

const GONDOLA_COLORS = [
  "#e8364c",
  "#f4e6c8",
  "#3a7be0",
  "#2fb59a",
  "#ef7a3c",
  "#9a62e0",
  "#ff8fb2",
  "#8ccf5a",
];
const BUNTING = ["#e8364c", "#f4e6c8", "#3a7be0", "#2fb59a", "#f4e6c8", "#9a62e0", "#ff8fb2"];

interface Assets {
  painted: MeshPhongMaterial;
  /** Brass, reflecting the room, with vertex colours (bells and clappers). */
  brass: MeshPhongMaterial;
  bell: BufferGeometry;
  gondola: BufferGeometry;
  horse: BufferGeometry;
  wheel: BufferGeometry;
  top: BufferGeometry;
  barrel: BufferGeometry;
  bulb: SphereGeometry;
  floor: MeshBasicMaterial;
  /** Plain brass, for the kit's geometries (no vertex colours). */
  posts: MeshPhongMaterial;
  /** The horses, a little brighter than paint. */
  horses: MeshPhongMaterial;
}

const cache = new WeakMap<Kit, Assets>();

/** Alternate coloured wedges of a cone or open cylinder (axis y), for stripes. */
const striped = (
  make: (start: number, len: number) => BufferGeometry,
  n: number,
  colors: readonly string[],
  matrix?: Matrix4,
): Piece[] =>
  Array.from({ length: n }, (_, i) => ({
    geometry: make((i * Math.PI * 2) / n, (Math.PI * 2) / n),
    color: colors[i % colors.length]!,
    matrix,
  }));

const assets = (kit: Kit, m: FairMiddle): Assets => {
  const have = cache.get(kit);
  if (have) return have;
  const made: BufferGeometry[] = [];
  const tmp = <G extends BufferGeometry>(g: G) => {
    made.push(g);
    return g;
  };
  // The bell and its clapper as one piece, swung about its pivot.
  const bell = kit.keep(
    paintedGeometry([
      { geometry: tmp(new LatheGeometry(bellProfile(), 28)), color: "#ffffff" },
      { geometry: tmp(new SphereGeometry(9, 12, 8)), color: "#5a4a3a", matrix: T(0, -46, 0) },
      {
        geometry: tmp(new TorusGeometry(8, 3, 6, 14)),
        color: "#ffffff",
        matrix: T(0, 46, 0),
      },
    ])!,
  );
  // A gondola: a cup the ball sits in, a hanger rod up to its pivot and a striped canopy.
  // Shallow, so most of the ball shows above the rim.
  const cup = [
    [0.01, -31],
    [17, -30],
    [27, -21],
    [31, -11],
    [31.5, -7],
    [28, -7],
    [27, -12],
    [23, -20],
    [15, -26.5],
    [0.01, -27],
  ].map(([r, y]) => new Vector2(r!, y!));
  const hang = m.wheel.hang;
  const gondola = kit.keep(
    paintedGeometry([
      { geometry: tmp(new LatheGeometry(cup, 20)), color: "#ffffff" },
      {
        geometry: tmp(new TorusGeometry(30, 2.4, 6, 24)),
        color: FAIR.gold,
        matrix: T(0, -7, 0).multiply(M().makeRotationX(Math.PI / 2)),
      },
      {
        geometry: tmp(new CylinderGeometry(2.2, 2.2, hang + 4, 6)),
        color: "#d8d0c0",
        matrix: T(0, hang / 2 + 6, 0),
      },
      ...striped(
        (s, l) => tmp(new ConeGeometry(25, 13, 4, 1, false, s, l)),
        8,
        ["#ffffff", "#f4e6c8"],
        T(0, hang + 10, 0),
      ),
    ])!,
  );
  // A horse in profile with a saddle and mane, on a brass pole.
  const shape = new Shape();
  horseOutline().forEach(([x, y], i) =>
    i === 0 ? shape.moveTo(x * HORSE_W, y * HORSE_W) : shape.lineTo(x * HORSE_W, y * HORSE_W),
  );
  const body = tmp(
    new ExtrudeGeometry(shape, {
      depth: 9,
      bevelEnabled: true,
      bevelSize: 1.5,
      bevelThickness: 1.5,
      bevelSegments: 1,
    }),
  );
  body.translate(0, 0, -4.5);
  const saddle = new Shape();
  saddle.moveTo(-0.12 * HORSE_W, 0.12 * HORSE_W);
  saddle.quadraticCurveTo(0, 0.05 * HORSE_W, 0.1 * HORSE_W, 0.135 * HORSE_W);
  saddle.lineTo(0.08 * HORSE_W, -0.02 * HORSE_W);
  saddle.lineTo(-0.1 * HORSE_W, -0.02 * HORSE_W);
  saddle.closePath();
  const mane = new Shape();
  mane.moveTo(0.12 * HORSE_W, 0.14 * HORSE_W);
  mane.lineTo(0.3 * HORSE_W, 0.42 * HORSE_W);
  mane.lineTo(0.25 * HORSE_W, 0.4 * HORSE_W);
  mane.lineTo(0.08 * HORSE_W, 0.18 * HORSE_W);
  mane.closePath();
  const horse = kit.keep(
    paintedGeometry([
      { geometry: body, color: "#fbf4e6" },
      { geometry: tmp(new ShapeGeometry(saddle)), color: "#d42f45", matrix: T(0, 0, 6.5) },
      {
        geometry: tmp(new ShapeGeometry(saddle)),
        color: "#d42f45",
        matrix: T(0, 0, -6.5).multiply(M().makeRotationY(Math.PI)),
      },
      { geometry: tmp(new ShapeGeometry(mane)), color: FAIR.gold, matrix: T(0, 0, 6.6) },
      {
        geometry: tmp(new ShapeGeometry(mane)),
        color: FAIR.gold,
        matrix: T(0, 0, -6.6)
          .multiply(M().makeRotationY(Math.PI))
          .multiply(M().makeScale(-1, 1, 1)),
      },
      {
        geometry: tmp(new CylinderGeometry(2.6, 2.6, HORSE_W * 1.15, 8)),
        color: "#f2c45a",
        matrix: T(0, HORSE_W * 0.12, 6),
      },
      {
        geometry: tmp(new SphereGeometry(4.2, 8, 6)),
        color: "#f2c45a",
        matrix: T(0, HORSE_W * 0.7, 6),
      },
    ])!,
  );
  // The wheel: an outer and inner rim, spokes and a lattice, a hub with a star cap.
  const R = m.wheel.R;
  const spokes: Piece[] = [];
  const n = m.wheel.gondolas;
  for (let i = 0; i < n * 2; i++) {
    const a = (i * Math.PI) / n;
    const len = i % 2 === 0 ? R : R * 0.62;
    spokes.push({
      geometry: tmp(new CylinderGeometry(1.6, 1.6, len, 5)),
      color: "#f6efe0",
      matrix: M()
        .makeRotationZ(a - Math.PI / 2)
        .multiply(T(0, len / 2, 0)),
    });
  }
  for (let i = 0; i < n; i++) {
    // Cross braces between the rims.
    const a0 = (i * Math.PI * 2) / n;
    const a1 = ((i + 1) * Math.PI * 2) / n;
    const p = new Vector3(Math.cos(a0) * R * 0.62, Math.sin(a0) * R * 0.62, 0);
    const q = new Vector3(Math.cos((a0 + a1) / 2) * R, Math.sin((a0 + a1) / 2) * R, 0);
    for (const e of [p, new Vector3(Math.cos(a1) * R * 0.62, Math.sin(a1) * R * 0.62, 0)]) {
      const d = q.clone().sub(e);
      const g = tmp(new CylinderGeometry(1.2, 1.2, d.length(), 4));
      const mm = M()
        .makeTranslation((q.x + e.x) / 2, (q.y + e.y) / 2, 0)
        .multiply(M().makeRotationZ(Math.atan2(d.y, d.x) - Math.PI / 2));
      spokes.push({ geometry: g, color: "#e8364c", matrix: mm });
    }
  }
  const hubStar = new Shape();
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8;
    const r = i % 2 === 0 ? 20 : 9;
    if (i === 0) hubStar.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else hubStar.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  hubStar.closePath();
  const wheel = kit.keep(
    paintedGeometry([
      { geometry: tmp(new TorusGeometry(R, 3.6, 6, 72)), color: "#f6efe0" },
      { geometry: tmp(new TorusGeometry(R * 0.62, 2.4, 6, 48)), color: "#f6efe0" },
      ...spokes,
      {
        geometry: tmp(new CylinderGeometry(9, 9, 26, 12)),
        color: "#c9b48a",
        matrix: M().makeRotationX(Math.PI / 2),
      },
      { geometry: tmp(new ShapeGeometry(hubStar)), color: FAIR.gold, matrix: T(0, 0, 13.5) },
    ])!,
  );
  // The carousel's column and canopy, striped, with a valance and a finial.
  const rx = M().makeRotationX(Math.PI / 2);
  const top = kit.keep(
    paintedGeometry([
      ...striped(
        (s, l) => tmp(new CylinderGeometry(22, 22, 50, 2, 1, true, s, l)),
        12,
        ["#f4e6c8", "#c8283c"],
        T(0, 0, 25).multiply(rx),
      ),
      ...striped(
        (s, l) => tmp(new ConeGeometry(36, 30, 2, 1, false, s, l)),
        16,
        ["#c8283c", "#f4e6c8"],
        T(0, 0, 65).multiply(rx),
      ),
      {
        geometry: tmp(new CylinderGeometry(36.5, 36.5, 8, 24, 1, true)),
        color: FAIR.gold,
        matrix: T(0, 0, 49).multiply(rx),
      },
      { geometry: tmp(new SphereGeometry(6, 10, 8)), color: FAIR.gold, matrix: T(0, 0, 83) },
      {
        geometry: tmp(new CylinderGeometry(26, 26, 4, 24)),
        color: FAIR.gold,
        matrix: T(0, 0, 2).multiply(rx),
      },
    ])!,
  );
  // A cannon's barrel along +y: breech knob, body tapering to a ringed muzzle, open at the end.
  const barrelProfile = [
    [0.01, -BARREL.breech - 2],
    [8, -BARREL.breech - 1],
    [9, -BARREL.breech + 4],
    [24, -10],
    [28, 0],
    [25, 8],
    [24, BARREL.length - 16],
    [30, BARREL.length - 10],
    [30, BARREL.length],
    [22.5, BARREL.length],
    [22, BARREL.length - 26],
  ].map(([r, y]) => new Vector2(r!, y!));
  const barrel = kit.keep(
    paintedGeometry([
      { geometry: tmp(new LatheGeometry(barrelProfile, 20)), color: "#3a3d4a" },
      {
        geometry: tmp(new TorusGeometry(25, 2.6, 6, 24)),
        color: FAIR.gold,
        matrix: T(0, 24, 0).multiply(M().makeRotationX(Math.PI / 2)),
      },
      {
        geometry: tmp(new TorusGeometry(30.5, 2.4, 6, 24)),
        color: FAIR.gold,
        matrix: T(0, BARREL.length - 5, 0).multiply(M().makeRotationX(Math.PI / 2)),
      },
    ])!,
  );
  for (const g of made) g.dispose();
  const a: Assets = {
    painted: kit.keep(
      new MeshPhongMaterial({ vertexColors: true, shininess: 60, specular: "#777777" }),
    ),
    brass: kit.keep(
      new MeshPhongMaterial({
        color: "#e9b949",
        vertexColors: true,
        specular: "#fff1c0",
        shininess: 110,
        envMap: kit.env,
        combine: MixOperation,
        reflectivity: 0.42,
      }),
    ),
    bell,
    gondola,
    horse,
    wheel,
    top,
    barrel,
    posts: kit.keep(
      new MeshPhongMaterial({
        color: "#e9b949",
        specular: "#fff1c0",
        shininess: 110,
        envMap: kit.env,
        combine: MixOperation,
        reflectivity: 0.42,
      }),
    ),
    horses: kit.keep(
      new MeshPhongMaterial({
        vertexColors: true,
        shininess: 80,
        specular: "#999999",
        emissive: "#6a5c4a",
      }),
    ),
    bulb: kit.keep(new SphereGeometry(1, 10, 6)),
    floor: kit.keep(
      new MeshBasicMaterial({ map: kit.paint(256, 256, (g) => paintCarouselFloor(g, 256)) }),
    ),
  };
  cache.set(kit, a);
  return a;
};

const ease = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const flashOf = (t: Table, tag: string, i: number, s = 0.25) => {
  const age = t.flashAge(tag, i);
  return age < s ? 1 - age / s : 0;
};
const m4 = new Matrix4();
const qq = new Quaternion();
const vv = new Vector3();
const ss = new Vector3();
const ZAXIS = new Vector3(0, 0, 1);
const YAXIS = new Vector3(0, 1, 0);
const tmpc = new Color();

/** Instance `i` of `m` at field (x, y), height z, scaled, turned `turn` about the view axis. */
const put = (
  m: InstancedMesh,
  i: number,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  turn = 0,
) => {
  if (turn === 0) qq.identity();
  else qq.setFromAxisAngle(ZAXIS, turn);
  m.setMatrixAt(i, m4.compose(vv.set(x, -y, z), qq, ss.set(sx, sy, sz)));
};

/** The cannon's barrel along its axis: from the muzzle back to the trunnions and the breech. */
const BARREL = { length: 86, breech: 18, scale: 1.1 };
/** The barrel's tilt out of the playfield. */
const BARREL_LIFT = 0.36;

const CONFETTI = 36;
const CONFETTI_COLORS = ["#e8364c", "#f4e6c8", "#3a7be0", "#2fb59a", "#9a62e0", "#ff8fb2"];

export const fairTable = (kit: Kit, layout: TableLayout, color: string): TableModel => {
  const m = layout.middle as FairMiddle;
  const A = assets(kit, m);
  const root = new Group();
  const own: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => {
    own.push(x);
    return x;
  };
  const side = m.side;
  const w = m.wheel;
  const zHub = w.low + w.R * Math.sin(w.tilt);

  // ---- Bulbs and glows: every one on the table in two instanced meshes. ----
  const arch: { x: number; y: number }[] = [];
  for (let i = 0; i < 46; i++) {
    const a = Math.PI + 0.06 + ((Math.PI - 0.2) * i) / 45;
    arch.push({ x: 540 + Math.cos(a) * 516, y: 640 + Math.sin(a) * 516 });
  }
  const WHEEL_BULBS = 16;
  const RIDE_BULBS = 16;
  const station: { x: number; y: number }[] = [];
  const sw = w.station.wall;
  for (let i = 0; i <= 8; i++) {
    const a = sw.a0 + ((sw.a1 - sw.a0) * i) / 8;
    station.push({ x: sw.cx + Math.cos(a) * sw.rad, y: sw.cy + Math.sin(a) * sw.rad });
  }
  const B = {
    arch: 0,
    wheel: arch.length,
    ride: arch.length + WHEEL_BULBS,
    tower: arch.length + WHEEL_BULBS + RIDE_BULBS,
    station: arch.length + WHEEL_BULBS + RIDE_BULBS + MARKS,
  };
  const nBulbs = B.station + station.length;
  const bulbs = instances(A.bulb, kit.basic("#ffffff"), nBulbs);
  // Halos for the bulbs, then for the bells, the muzzle, the striker's pad, the station's lift
  // and the carousel's column.
  const G = {
    bells: nBulbs,
    muzzle: nBulbs + 4,
    pad: nBulbs + 5,
    lift: nBulbs + 6,
    column: nBulbs + 7,
  };
  const nGlows = nBulbs + 8;
  const glows = instances(kit.geo.quad, kit.glow("#ffffff"), nGlows);
  glows.renderOrder = 3;
  root.add(bulbs, glows);
  arch.forEach((p, i) => put(bulbs, B.arch + i, p.x, p.y, 40, 6.5, 6.5, 6.5));
  station.forEach((p, i) => put(bulbs, B.station + i, p.x, p.y, 44, 5, 5, 5));
  const towerY = (k: number) =>
    m.striker.pad.ay - 30 - (m.striker.pad.ay - 30 - (m.striker.top + 30)) * k;
  for (let i = 0; i < MARKS; i++)
    put(bulbs, B.tower + i, m.striker.x, towerY((i + 0.5) / MARKS), 40, 4.5, 4.5, 4.5);
  const glowAt = (i: number, x: number, y: number, z: number, r: number, c: Color) => {
    put(glows, i, x, y, z, r, r, 1);
    glows.setColorAt(i, c);
  };

  // ---- Static pieces, painted in vertex colours and merged by the view. ----
  const stat: Piece[] = [];
  const statMesh = (pieces: Piece[]) => {
    const g = paintedGeometry(pieces);
    if (!g) return;
    const mesh = new Mesh(keep(g), A.painted);
    mesh.userData.static = true;
    root.add(mesh);
  };
  // Yokes the bells hang from, high enough for balls to pass under.
  for (const b of m.bells) {
    stat.push({
      geometry: kit.geo.box,
      color: "#6a3e24",
      matrix: T(b.x, -(b.y - BELL_HANG), 58).multiply(M().makeScale(64, 9, 10)),
    });
  }
  // The wheel's station: a rail round the pocket in red with a cream cap.
  const rail = railsGeometry([w.station.wall], 40);
  if (rail) {
    stat.push({ geometry: rail, color: "#b8243a" });
    const cap = railsGeometry([{ ...w.station.wall, r: w.station.wall.r + 1.5 }], 4);
    if (cap) stat.push({ geometry: cap, color: FAIR.cream, matrix: T(0, 0, 40) });
  }
  // Its A-frame: legs from the hub's axle down onto the station's rail.
  const feet = [210, 330].map((deg) => {
    const a = layout.mirror ? Math.PI - (deg * Math.PI) / 180 : (deg * Math.PI) / 180;
    return { x: sw.cx + Math.cos(a) * sw.rad, y: sw.cy + Math.sin(a) * sw.rad };
  });
  // The axle runs along the wheel's normal: legs on both faces of the wheel.
  const nY = Math.sin(w.tilt);
  const nZ = Math.cos(w.tilt);
  for (const f of feet) {
    for (const d of [-15, 15]) {
      stat.push({
        geometry: tubeGeometry(
          [
            { x: w.hub.x, y: w.hub.y + d * nY, z: zHub + d * nZ },
            { x: f.x, y: f.y, z: 42 },
          ],
          3.2,
          6,
        ),
        color: "#e9e1d0",
      });
    }
  }
  // The high striker's tower in red and cream bands, its pad, and a brass strip for the puck.
  const sk = m.striker;
  const tTop = sk.top + 22;
  const tBase = sk.pad.ay - 12;
  const bands = 8;
  for (let i = 0; i < bands; i++) {
    const y0 = tBase - ((tBase - tTop) * i) / bands;
    const y1 = tBase - ((tBase - tTop) * (i + 1)) / bands;
    stat.push({
      geometry: kit.geo.box,
      color: i % 2 === 0 ? "#c8283c" : FAIR.cream,
      matrix: T(sk.x, -(y0 + y1) / 2, 0).multiply(M().makeScale(26, y0 - y1, 34)),
    });
  }
  stat.push({
    geometry: kit.geo.box,
    color: "#8a6a2a",
    matrix: T(sk.x, -(tBase + tTop) / 2, 34).multiply(M().makeScale(8, tBase - tTop, 3)),
  });
  const pw = Math.abs(sk.pad.bx - sk.pad.ax) + 2 * sk.pad.r;
  stat.push(
    {
      geometry: kit.geo.box,
      color: "#2a2228",
      matrix: T(sk.x, -sk.pad.ay, 0).multiply(M().makeScale(pw, 2 * sk.pad.r, 26)),
    },
    {
      geometry: kit.geo.box,
      color: "#e8364c",
      matrix: T(sk.x, -(sk.pad.ay + 4), 26).multiply(M().makeScale(pw - 10, 2 * sk.pad.r - 8, 4)),
    },
  );
  // The cannon's carriage under its barrel: a wooden trail and a big spoked wheel to one side.
  const cn = m.cannon;
  const ax = cn.landing.x - cn.mouth.x;
  const ay = cn.landing.y - cn.mouth.y;
  const al = Math.hypot(ax, ay) || 1;
  const ux = ax / al;
  const uy = ay / al;
  const trail = { x: cn.mouth.x - ux * 70, y: cn.mouth.y - uy * 70 };
  const hub = { x: trail.x + side * 30, y: trail.y - 6 };
  stat.push(
    {
      geometry: kit.geo.box,
      color: "#6a3e24",
      matrix: T(trail.x, -trail.y, 0)
        .multiply(M().makeRotationZ(Math.atan2(-uy, ux)))
        .multiply(M().makeScale(120, 34, 22)),
    },
    {
      geometry: new CylinderGeometry(34, 34, 8, 24),
      color: "#7a4a2a",
      matrix: T(hub.x, -hub.y, 40).multiply(M().makeRotationX(Math.PI / 2)),
    },
    {
      geometry: new TorusGeometry(34, 3.6, 6, 24),
      color: FAIR.gold,
      matrix: T(hub.x, -hub.y, 44.5),
    },
  );
  for (let i = 0; i < 6; i++) {
    stat.push({
      geometry: kit.geo.box,
      color: "#d9b27a",
      matrix: T(hub.x, -hub.y, 44.6)
        .multiply(M().makeRotationZ((i * Math.PI) / 6))
        .multiply(M().makeScale(62, 4, 1)),
    });
  }
  // Bunting over the lanes: two swags of flags from the arch.
  const swags = [
    { a: { x: 175, y: 300 }, b: { x: 540, y: 150 }, sag: 36 },
    { a: { x: 540, y: 150 }, b: { x: 905, y: 300 }, sag: 36 },
  ];
  let flag = 0;
  for (const s of swags) {
    const pts: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      pts.push({
        x: s.a.x + (s.b.x - s.a.x) * t,
        y: s.a.y + (s.b.y - s.a.y) * t + Math.sin(Math.PI * t) * s.sag,
        z: 96,
      });
    }
    stat.push({ geometry: tubeGeometry(pts, 1.4, 4), color: "#e9e1d0" });
    for (let i = 0; i < 10; i++) {
      const t = (i + 0.75) / 10.5;
      const x = s.a.x + (s.b.x - s.a.x) * t;
      const y = s.a.y + (s.b.y - s.a.y) * t + Math.sin(Math.PI * t) * s.sag;
      const tri = new Shape();
      tri.moveTo(-11, 0);
      tri.lineTo(11, 0);
      tri.lineTo(0, -24);
      tri.closePath();
      stat.push({
        geometry: new ShapeGeometry(tri),
        color: BUNTING[flag++ % BUNTING.length]!,
        matrix: T(x, -y, 96.5),
      });
    }
  }
  statMesh(stat);
  for (const p of stat) if (p.geometry !== kit.geo.box) p.geometry.dispose();

  // ---- Bells: three bumpers and the striker's, swinging from their pivots. ----
  const bellSpots = [
    ...m.bells.map((b) => ({ x: b.x, y: b.y, s: b.r / BELL_R })),
    { x: sk.bell.x, y: sk.bell.y, s: sk.bell.r / BELL_R },
  ];
  const bells = instances(A.bell, A.brass, bellSpots.length);
  root.add(bells);

  // ---- The Ferris wheel. ----
  const lean = new Group();
  at(lean, w.hub.x, w.hub.y, zHub);
  lean.rotation.x = w.tilt;
  const spin = new Group();
  spin.add(new Mesh(A.wheel, A.painted));
  lean.add(spin);
  root.add(lean);
  // Balls up on the wheel, full size (the view draws them small, see wheel.ts), and guests
  // riding to a multiball, whom the view doesn't know about until they land.
  const aboard = instances(kit.geo.sphere, kit.mat.chrome, 5);
  aboard.count = 0;
  root.add(aboard);
  const gondolas = instances(A.gondola, A.painted, w.gondolas);
  for (let k = 0; k < w.gondolas; k++)
    gondolas.setColorAt(k, tmpc.set(GONDOLA_COLORS[k % GONDOLA_COLORS.length]!));
  root.add(gondolas);

  // ---- The carousel. ----
  const c = m.carousel;
  const floor = new Mesh(kit.geo.cylinder, A.floor);
  floor.scale.set(c.r, c.r, 5);
  at(floor, c.x, c.y, 0);
  const topMat = keep(A.painted.clone());
  const top = new Mesh(A.top, topMat);
  at(top, c.x, c.y, 0);
  root.add(floor, top);
  const horses = instances(A.horse, A.horses, c.horses.length);
  root.add(horses);
  // Brass: the horses' stands (where they collide), the lift's plate and the striker's puck.
  const POSTS = { stands: 0, lift: c.horses.length, puck: c.horses.length + 1 };
  const brass = instances(kit.geo.cylinder, A.posts, c.horses.length + 2);
  root.add(brass);

  // ---- The cannon. ----
  const barrelRoot = new Group();
  const barrel = new Mesh(A.barrel, A.painted);
  barrel.scale.setScalar(BARREL.scale);
  barrelRoot.add(barrel);
  const aim = new Vector3(cn.landing.x - cn.mouth.x, -(cn.landing.y - cn.mouth.y), 0).normalize();
  // Pointing along the flight, tipped up out of the playfield.
  const dir = new Vector3(aim.x, aim.y, BARREL_LIFT).normalize();
  barrelRoot.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir);
  root.add(barrelRoot);
  const muzzle = { x: cn.mouth.x, y: cn.mouth.y, z: MUZZLE_Z };
  const confettiMat = keep(new MeshBasicMaterial({ color: "#ffffff", side: DoubleSide }));
  const confetti = instances(kit.geo.quad, confettiMat, CONFETTI);
  CONFETTI_COLORS.forEach((cc, i) => {
    for (let k = i; k < CONFETTI; k += CONFETTI_COLORS.length) confetti.setColorAt(k, tmpc.set(cc));
  });
  confetti.count = 0;
  root.add(confetti);
  const bits = Array.from({ length: CONFETTI }, (_, i) => {
    const a = (i * 2.399) % (Math.PI * 2);
    const s = 0.5 + ((i * 0.618) % 1);
    return {
      vx: Math.cos(a) * 240 * s + aim.x * 420,
      vy: Math.sin(a) * 240 * s - aim.y * 420,
      vz: 260 + 260 * s,
      spin: (i % 2 ? 1 : -1) * (4 + s * 6),
    };
  });

  const bulbOn = new Color(FAIR.bulb);
  const bulbOff = new Color("#5a3a2a");
  const lit = new Color();
  const white = new Color("#ffffff");
  const hot = new Color("#fff4d0").multiplyScalar(1.7);
  const golden = new Color("#ffd27a").multiplyScalar(1.15);
  const bounce = (age: number) => (age < 2.5 ? Math.sin(age * 9) * Math.exp(-age * 2.2) : 0);

  return {
    root,
    owns: ["bell", "station", "column", "horse", "tower", "striker", "topbell"],
    sync(t: Table, time: number) {
      const toys = t.toys as FairToys;
      const now = t.world.t;
      const show = toys.lit || now - toys.bigAt < 3;
      const chase = Math.floor(time * (show ? 14 : 6));

      // Bulbs round the arch chase; they all flash for the big wheel and a ringing bell.
      const party = Math.max(
        flashOf(t, "bigwheel", 0, 2),
        flashOf(t, "ring", 0, 1.2),
        flashOf(t, "round", 0, 0.8),
      );
      arch.forEach((p, i) => {
        const on = party > 0 ? Math.sin(time * 30) > 0 : (i + chase) % 3 === 0;
        const k = on ? 1 : 0.18;
        bulbs.setColorAt(B.arch + i, lit.copy(bulbOff).lerp(bulbOn, k));
        glowAt(
          B.arch + i,
          p.x,
          p.y,
          41,
          on ? 26 : 0.01,
          lit.copy(bulbOn).multiplyScalar(on ? 0.4 : 0),
        );
      });

      // The wheel: turn it, hang the gondolas, light its rim.
      const wh = toys.wheel;
      const th = wh.angle;
      spin.rotation.z = side * th;
      const st = Math.sin(w.tilt);
      const ct = Math.cos(w.tilt);
      for (let k = 0; k < w.gondolas; k++) {
        const a = wh.gondolaAngle(k);
        const cp = wh.cup(a);
        const sway = 0.06 * Math.sin(time * 1.7 + k);
        put(gondolas, k, cp.x, cp.y, cp.z, 1, 1, 1, sway);
      }
      gondolas.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < WHEEL_BULBS; i++) {
        const la = (i * Math.PI * 2) / WHEEL_BULBS + Math.PI / WHEEL_BULBS + side * th;
        const lx = Math.cos(la) * (w.R + 1);
        const ly = Math.sin(la) * (w.R + 1);
        const x = w.hub.x + lx;
        const y = w.hub.y - ly * ct;
        const z = zHub + ly * st + 4;
        put(bulbs, B.wheel + i, x, y, z, 4.5, 4.5, 4.5);
        const on = show ? (i + chase) % 2 === 0 : (i + chase) % 4 === 0 || wh.riders.length > 0;
        const hue = show ? GONDOLA_COLORS[(i + chase) % GONDOLA_COLORS.length]! : FAIR.bulb;
        bulbs.setColorAt(B.wheel + i, on ? lit.set(hue) : bulbOff);
        glowAt(
          B.wheel + i,
          x,
          y,
          z + 1,
          on ? 22 : 0.01,
          lit.set(hue).multiplyScalar(on ? 0.45 : 0),
        );
      }
      // The lift's plate rises under a ball going up to the platform.
      const lifting = wh.riders.find((r) => r.phase === "lift" && r.ball);
      const lz = lifting ? Math.max(0, lifting.z - BALL_R) : 0;
      const lx = lifting ? lifting.x : w.station.x;
      const ly = lifting ? lifting.y : w.station.y;
      put(brass, POSTS.lift, lx, ly, lz + 0.6, 22, 22, 3);
      let g = 0;
      for (const r of wh.riders) {
        if (r.phase === "pending" || (r.ball && r.phase === "lift") || g >= 5) continue;
        const sc = BALL_R * r.scale;
        put(aboard, g++, r.x, r.y, r.z, sc, sc, sc);
      }
      aboard.count = g;
      if (g > 0) aboard.instanceMatrix.needsUpdate = true;
      const ride = flashOf(t, "wheel", 0, 0.6);
      glowAt(
        G.lift,
        w.station.x,
        w.station.y,
        2,
        90 + ride * 60,
        lit.set(color).multiplyScalar(0.25 + ride * 0.6),
      );
      station.forEach((p, i) => {
        const on = (i + chase) % 3 === 0 || ride > 0;
        bulbs.setColorAt(B.station + i, on ? bulbOn : bulbOff);
        glowAt(
          B.station + i,
          p.x,
          p.y,
          45,
          on ? 18 : 0.01,
          lit.copy(bulbOn).multiplyScalar(on ? 0.35 : 0),
        );
      });

      // The carousel turns; its horses rise and fall and turn to face the way they go.
      const turn = toys.carouselAngle();
      floor.rotation.z = -turn;
      top.rotation.z = -turn;
      const hit = flashOf(t, "column", 0, 0.3);
      topMat.emissive.set("#ffcf8a").multiplyScalar(hit * 0.5);
      glowAt(
        G.column,
        c.x,
        c.y,
        3,
        130 + hit * 60,
        lit.set("#ffcf8a").multiplyScalar(0.12 + hit * 0.5),
      );
      const round = flashOf(t, "round", 0, 1);
      c.horses.forEach((h, i) => {
        // Facing the way it goes across the view, turning round at the sides.
        const dy = h.y - c.y;
        const face = Math.max(
          -1,
          Math.min(1, (-c.omega * dy * 2.5) / (Math.abs(c.omega) * c.ring)),
        );
        const bob = Math.sin(turn * 3 + i * Math.PI * 0.5);
        qq.setFromAxisAngle(YAXIS, Math.acos(face));
        horses.setMatrixAt(
          i,
          m4.compose(vv.set(h.x, -(h.y - 6 + bob * BOB), HORSE_Z + bob * BOB), qq, ss.set(1, 1, 1)),
        );
        const f = flashOf(t, "horse", i, 0.3);
        const base = toys.horses[i] || round > 0 ? golden : white;
        horses.setColorAt(i, lit.copy(base).lerp(hot, f));
        put(brass, POSTS.stands + i, h.x, h.y, 0, h.r, h.r, STAND_Z);
      });
      for (let i = 0; i < RIDE_BULBS; i++) {
        const a = turn + (i * Math.PI * 2) / RIDE_BULBS;
        const x = c.x + Math.cos(a) * (c.r - 7);
        const y = c.y + Math.sin(a) * (c.r - 7);
        put(bulbs, B.ride + i, x, y, 7, 4, 4, 4);
        const on = round > 0 ? Math.sin(time * 26) > 0 : (i + chase) % 2 === 0;
        bulbs.setColorAt(B.ride + i, on ? bulbOn : bulbOff);
        glowAt(B.ride + i, x, y, 8, on ? 18 : 0.01, lit.copy(bulbOn).multiplyScalar(on ? 0.3 : 0));
      }
      horses.instanceMatrix.needsUpdate = true;

      // Bells swing when rung; the striker's when its puck reaches it.
      bellSpots.forEach((b, i) => {
        const tag = i < 3 ? "bell" : "ring";
        const idx = i < 3 ? i : 0;
        const age = t.flashAge(tag, idx);
        const amp = i < 3 ? 0.42 : 0.6;
        const phi = amp * bounce(age) * (i % 2 ? -1 : 1);
        const L = BELL_HANG * b.s;
        const x = b.x + Math.sin(phi) * L;
        const y = b.y - L + Math.cos(phi) * L;
        put(bells, i, x, y, 46 * b.s, b.s, b.s, b.s, phi);
        const f = flashOf(t, tag, idx, 0.35);
        const fuse = i < 3 && toys.bells[i];
        bells.setColorAt(i, lit.copy(white).lerp(hot, Math.max(f, fuse ? 0.25 : 0)));
        glowAt(
          G.bells + i,
          b.x,
          b.y,
          2,
          130 * b.s * (0.6 + f),
          lit.set("#ffd27a").multiplyScalar(0.12 + 0.6 * f + (fuse ? 0.15 : 0)),
        );
      });
      bells.instanceMatrix.needsUpdate = true;

      // The high striker: the puck flies up to its height, rests and drops back.
      const s = toys.striker;
      const since = now - s.at;
      let k = 0;
      if (since >= 0 && since < s.rise) k = s.level * (1 - (1 - since / s.rise) ** 2);
      else if (since >= s.rise && since < s.rise + 0.25) k = s.level;
      else if (since >= s.rise + 0.25 && since < s.rise + 0.85)
        k = s.level * (1 - ease((since - s.rise - 0.25) / 0.6));
      put(brass, POSTS.puck, sk.x, towerY(k), 34, 15, 15, 9);
      for (let i = 0; i < MARKS; i++) {
        const on = k * MARKS > i + 0.2;
        bulbs.setColorAt(
          B.tower + i,
          on ? lit.set(i >= MARKS - 1 ? "#ff5a6e" : FAIR.bulb) : bulbOff,
        );
        glowAt(
          B.tower + i,
          sk.x,
          towerY((i + 0.5) / MARKS),
          41,
          on ? 22 : 0.01,
          lit.set(FAIR.bulb).multiplyScalar(on ? 0.5 : 0),
        );
      }
      const pad = flashOf(t, "striker", 0, 0.3);
      glowAt(
        G.pad,
        sk.x,
        sk.pad.ay,
        30,
        150 * pad + 0.01,
        lit.set("#ff8a9a").multiplyScalar(pad * 0.7),
      );

      // The cannon: lit while armed, recoils and bursts confetti when it fires.
      const fired = now - toys.firedAt;
      const recoil = fired >= 0 && fired < 0.45 ? Math.sin((fired / 0.45) * Math.PI) * 16 : 0;
      const back = (BARREL.length - 10) * BARREL.scale + recoil;
      barrelRoot.position.set(
        muzzle.x - dir.x * back,
        -muzzle.y - dir.y * back,
        muzzle.z - dir.z * back,
      );
      const armed = toys.cannon.armed;
      const boom = fired >= 0 && fired < 0.3 ? 1 - fired / 0.3 : 0;
      glowAt(
        G.muzzle,
        muzzle.x,
        muzzle.y,
        60,
        60 + 220 * boom,
        lit
          .set("#ffe2a0")
          .multiplyScalar(armed ? 0.35 + 0.15 * Math.sin(time * 6) : 0)
          .add(tmpc.set("#ffffff").multiplyScalar(boom)),
      );
      if (fired >= 0 && fired < 1.6) {
        confetti.count = CONFETTI;
        bits.forEach((b, i) => {
          const x = muzzle.x + b.vx * fired * 0.7;
          const y = muzzle.y + b.vy * fired * 0.7 + 380 * fired * fired;
          const z = muzzle.z + 20 + b.vz * fired - 300 * fired * fired;
          const sc = 16 * (1 - fired / 1.6);
          const flip = sc * 0.6 * Math.abs(Math.cos(b.spin * fired * 1.3)) + 0.5;
          put(confetti, i, x, y, Math.max(2, z), sc, flip, 1, b.spin * fired + i);
        });
        confetti.instanceMatrix.needsUpdate = true;
      } else {
        confetti.count = 0;
      }

      bulbs.instanceMatrix.needsUpdate = true;
      brass.instanceMatrix.needsUpdate = true;
      glows.instanceMatrix.needsUpdate = true;
      dirty(bulbs, glows, horses, bells);
    },
    lamp(l, t, time) {
      const toys = t.toys as FairToys;
      const blink = Math.sin(time * Math.PI * 2 * 2.5) > 0;
      if (l.tag === "wheel") {
        if (toys.lit) return { k: blink ? 1 : 0.3, color: "#ff8fb2" };
        return { k: toys.rides > l.index ? 1 : flashOf(t, "wheel", 0, 0.4), color: "#ff8fb2" };
      }
      if (l.tag === "bell") {
        return { k: toys.bells[l.index] ? 1 : flashOf(t, "fuse", l.index, 0.5), color: "#ffb347" };
      }
      if (l.tag === "cannon") {
        const armed = toys.cannon.armed;
        return { k: armed ? (blink ? 1 : 0.55) : flashOf(t, "cannon", 0, 0.5), color: "#ff6a5a" };
      }
      return undefined;
    },
    dispose() {
      for (const x of own) x.dispose();
    },
  };
};
