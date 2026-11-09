/**
 * The beach umbrella drawn in 3D: a white pole with a navy joint, planted in a little mound of
 * sand, under a striped canopy of eight gores that sag a little between their ribs, with a
 * scalloped valance round the rim and a finial on top. It is lit like the toys. The canopy folds
 * with the same ribs as its outline (`ribPoint`), the cloth gathering into pleats round the pole.
 *
 * The canopy is drawn after the balls, so a ball that bounces up underneath it goes behind its
 * front, as it would under a real one; a ball on top sits on the outline it is drawn with.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  type Mesh,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";
import { mesh, paint, sandTexture } from "./wallpropview";
import { ribPoint, UMBRELLA_PAINT, type UmbrellaLayout, VALANCE } from "./wallumbrella";

/** How far the umbrella is tipped towards the people, radians: nearly edge on, at eye level. */
const TIP = (6 * Math.PI) / 180;
const GORES = 8;
const ROWS = 10;
const COLUMNS = 8;
/** How far the cloth between two ribs sags in from the rim and down, metres at the rim. */
const SAG_IN = 0.045;
const SAG_DOWN = 0.03;
/** How far the furled cloth bulges out between the ribs, metres at the rim. */
const PLEAT = 0.04;

interface Cloth {
  readonly geometry: BufferGeometry;
  /** Lay the cloth out for a canopy folded `fold`. */
  fold(fold: number): void;
}

/** The canopy's cloth and valance as one mesh with a colour per gore. */
const cloth = (radius: number, rim: number, top: number): Cloth => {
  const params: number[] = [];
  const col: number[] = [];
  const index: number[] = [];
  const colours = UMBRELLA_PAINT.stripes.map((c) => new Color(c));
  let n = 0;
  const vertex = (k: number, t: number, u: number, drop: number, c: Color, shade = 1) => {
    params.push(k, t, u, drop);
    col.push(c.r * shade, c.g * shade, c.b * shade);
    return n++;
  };
  for (let k = 0; k < GORES; k++) {
    const c = colours[k % colours.length]!;
    // The gore, from the top down to the rim.
    const base = n;
    for (let i = 0; i <= ROWS; i++) {
      for (let j = 0; j <= COLUMNS; j++) vertex(k, j / COLUMNS, i / ROWS, 0, c);
    }
    for (let i = 0; i < ROWS; i++) {
      for (let j = 0; j < COLUMNS; j++) {
        const a = base + i * (COLUMNS + 1) + j;
        const b = a + COLUMNS + 1;
        index.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    // The valance hanging from the rim, scalloped deeper between the ribs.
    const flap = n;
    for (let j = 0; j <= COLUMNS; j++) {
      const t = j / COLUMNS;
      vertex(k, t, 1, 0, c);
      vertex(k, t, 1, VALANCE * (0.5 + 0.5 * Math.sin(Math.PI * t)), c, 0.92);
    }
    for (let j = 0; j < COLUMNS; j++) {
      const a = flap + j * 2;
      index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
  }
  const pos = new Float32Array(n * 3);
  const geometry = new BufferGeometry();
  // A plain attribute keeps this array, so laying the cloth out again updates it in place.
  const attr = new BufferAttribute(pos, 3);
  geometry.setAttribute("position", attr);
  geometry.setAttribute("color", new Float32BufferAttribute(col, 3));
  geometry.setIndex(index);
  return {
    geometry,
    fold(f) {
      for (let v = 0; v < n; v++) {
        const k = params[v * 4]!;
        const t = params[v * 4 + 1]!;
        const u = params[v * 4 + 2]!;
        const drop = params[v * 4 + 3]!;
        const [rho, y] = ribPoint(radius, rim, top, u, f);
        const bulge = Math.sin(Math.PI * t) * u;
        const r = rho * (1 - (SAG_IN / radius) * bulge * (1 - f)) + PLEAT * bulge * f;
        const phi = ((k + t) / GORES) * Math.PI * 2;
        pos[v * 3] = r * Math.sin(phi);
        pos[v * 3 + 1] = y - SAG_DOWN * bulge * (1 - f) - drop * (1 - 0.6 * f);
        pos[v * 3 + 2] = r * Math.cos(phi);
      }
      attr.needsUpdate = true;
      geometry.computeVertexNormals();
    },
  };
};

export interface UmbrellaView {
  readonly root: Group;
  /**
   * Put it with its foot at (x, y) stage px (y up), turned `angle` in the wall's plane and `yaw`
   * on its pole, at `scale` stage px a metre. `planted` shows the little mound of sand round its
   * foot.
   */
  place(x: number, y: number, angle: number, yaw: number, scale: number, planted: boolean): void;
  /** Fold the canopy, 0 open to 1 furled. */
  setFold(fold: number): void;
}

export const createUmbrellaView = (u: UmbrellaLayout, floor: number): UmbrellaView => {
  const root = new Group();
  const turn = new Group();
  root.add(turn);
  const rim = u.rim - floor;
  const top = u.top - floor;
  const fabric = cloth(u.radius, rim, top);
  fabric.fold(0);
  const cover = mesh(
    fabric.geometry,
    paint({
      vertexColors: true,
      roughness: 0.62,
      side: DoubleSide,
      transparent: true,
      opacity: 1,
      depthWrite: true,
    }),
  );
  cover.renderOrder = 3.5;
  turn.add(cover);
  const metal = paint({ color: new Color(UMBRELLA_PAINT.pole), roughness: 0.3, metalness: 0.2 });
  const fit = paint({ color: new Color(UMBRELLA_PAINT.fittings), roughness: 0.4 });
  // The pole runs up into the canopy's hub and down to a point in the sand.
  turn.add(mesh(new CylinderGeometry(0.022, 0.022, top, 16), metal, [0, top / 2, 0]));
  turn.add(mesh(new ConeGeometry(0.022, 0.06, 16), metal, [0, -0.03, 0]));
  turn.children[turn.children.length - 1]!.rotation.x = Math.PI;
  turn.add(mesh(new CylinderGeometry(0.03, 0.03, 0.07, 16), fit, [0, 0.42 * top, 0]));
  turn.add(
    mesh(new CylinderGeometry(0.03, 0.045, 0.08, 16), fit, [0, rim + 0.55 * (top - rim), 0]),
  );
  const finial = mesh(new SphereGeometry(0.04, 16, 10), fit, [0, top + 0.04, 0]);
  finial.renderOrder = 3.5;
  turn.add(finial);
  const tips: Mesh[] = [];
  for (let k = 0; k < GORES; k++) {
    const tip = mesh(new SphereGeometry(0.014, 8, 6), fit);
    tip.renderOrder = 3.5;
    turn.add(tip);
    tips.push(tip);
  }
  const placeTips = (f: number) => {
    const [rho, y] = ribPoint(u.radius, rim, top, 1, f);
    tips.forEach((tip, k) => {
      const phi = (k / GORES) * Math.PI * 2;
      tip.position.set(rho * Math.sin(phi), y, rho * Math.cos(phi));
    });
  };
  placeTips(0);
  const sand = sandTexture();
  sand.repeat.set(2, 1);
  const mound = mesh(
    new ConeGeometry(0.16, 0.06, 24, 1, true),
    paint({ map: sand, roughness: 1 }),
    [0, 0.02, 0],
  );
  root.add(mound);
  root.traverse((m) => {
    m.frustumCulled = false;
    if (m.renderOrder === 0) m.renderOrder = 2;
  });
  const tip = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), TIP);
  const rock = new Quaternion();
  const zAxis = new Vector3(0, 0, 1);
  let folded = 0;
  return {
    root,
    place(x, y, angle, yaw, scale, planted) {
      root.position.set(x, y, 0);
      root.scale.setScalar(scale);
      rock.setFromAxisAngle(zAxis, angle);
      root.quaternion.copy(tip).multiply(rock);
      turn.rotation.y = yaw;
      mound.visible = planted;
    },
    setFold(f) {
      const v = Math.min(1, Math.max(0, f));
      if (Math.abs(v - folded) < 1e-4) return;
      folded = v;
      fabric.fold(v);
      placeTips(v);
    },
  };
};
