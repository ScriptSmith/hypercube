/**
 * The upper deck's pieces in 3D, plain, and the skin a theme uses to replace them. Each factory
 * builds one piece from the deck's layout (deckgeo.ts, bandgeo.ts) in deck px and returns a
 * `DeckPart`: its root, and a `sync` that moves and lights it each frame from the deck's state.
 * A theme's `DeckSkin` gives its own factory for any piece and the plain one is used for the rest
 * (in the skin's `colors`, when it gives them).
 *
 * The plain pieces follow the 2D deck's colours: blue pop bumpers, a big bumper blue, violet then
 * orange by level, violet magnets, amber saucers, a cyan scoop, a green lock, an orange nest.
 */
import {
  type BufferGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  type Material,
  type MeshBasicMaterial,
  MeshPhongMaterial,
  type Object3D,
  Quaternion,
  Shape,
  ShapeGeometry,
  Vector3,
} from "three";
import { LOCK_SIZE, MAGNET_MS, SAUCER_MS, VUK_MS } from "../deckparts";
import type { Deck, DeckGeometry, Slot } from "../deck";
import type { MagnetSpec, Playfield, Rail, SaucerSpec } from "../deckgeo";
import type { Gift } from "../config";
import type { Circle, Gate, Rollover, Seg } from "../physics";
import { at, extrudeGeometry, type Kit, railsGeometry, tubeGeometry } from "./kit";

/** What a part sees each frame. */
export interface DeckFrame {
  deck: Deck;
  /** Seconds, for animation that needs no state. */
  time: number;
  alpha: number;
  /** The deck's clock at its last update, ms (devices' `since` are on it). */
  now: number;
  /** 1 just after (tag, index) last flashed, falling to 0 over `s` seconds. */
  flash(tag: string, index: number, s?: number): number;
  palette: readonly string[];
}

export interface DeckPart {
  readonly root: Object3D;
  sync?(f: DeckFrame): void;
  dispose?(): void;
}

/** Colours for the plain pieces. */
export interface DeckColors {
  pop: string;
  big: readonly [string, string, string];
  cluster: string;
  shuttle: string;
  mushroom: string;
  sling: string;
  magnet: string;
  saucer: string;
  scoop: string;
  lock: string;
  nest: string;
  glass: string;
  rail: string;
  star: string;
  target: string;
}

export const PLAIN_COLORS: DeckColors = {
  pop: "#6fa4fc",
  big: ["#4f8dff", "#a46bff", "#ff8a3d"],
  cluster: "#6fa4fc",
  shuttle: "#ff6f91",
  mushroom: "#4ff0d2",
  sling: "#ff6f91",
  magnet: "#c86bff",
  saucer: "#ffcc33",
  scoop: "#5ee0ff",
  lock: "#6cf7a0",
  nest: "#ffb36b",
  glass: "#7fd7ff",
  rail: "#cfe6ff",
  star: "#ffffff",
  target: "#ffcc33",
};

type Lock = Playfield["lock"];
type Nest = Playfield["nest"];
type Captive = Playfield["captive"];
type Vuk = Playfield["vuk"];
type Sling = Playfield["slings"][number];

/** A theme's deck. Every member is optional; the plain piece stands in for any not given. */
export interface DeckSkin {
  colors?: Partial<DeckColors>;
  /**
   * The flat art behind everything, in deck px on a canvas already scaled to the deck: the
   * backdrop, and marks under the pieces. The slot lanes' tints and the rail under the floor are
   * painted after it.
   */
  background?(g: CanvasRenderingContext2D, geo: DeckGeometry): void;
  /**
   * Every pop bumper as one part (instance them: a band has a dozen or more). A pop's index is its
   * index in the list, which its flash uses (`f.flash("bumper", i)`).
   */
  pops?(kit: Kit, cs: readonly Circle[], colors: DeckColors): DeckPart;
  big?(kit: Kit, geo: DeckGeometry, colors: DeckColors): DeckPart;
  cluster?(kit: Kit, c: Circle, i: number, colors: DeckColors): DeckPart;
  shuttle?(kit: Kit, geo: DeckGeometry, colors: DeckColors): DeckPart;
  /** Every mushroom as one part (flash "mushroom", i). */
  mushrooms?(kit: Kit, cs: readonly Circle[], colors: DeckColors): DeckPart;
  sling?(kit: Kit, s: Sling, i: number, colors: DeckColors): DeckPart;
  /** Every star rollover as one part, lit in the colour of the last ball over it. */
  stars?(kit: Kit, rs: readonly Rollover[], colors: DeckColors): DeckPart;
  magnet?(kit: Kit, m: MagnetSpec, i: number, colors: DeckColors): DeckPart;
  saucer?(kit: Kit, s: SaucerSpec, i: number, colors: DeckColors): DeckPart;
  scoop?(kit: Kit, v: Vuk, colors: DeckColors): DeckPart;
  lock?(kit: Kit, l: Lock, U: number, colors: DeckColors): DeckPart;
  captive?(kit: Kit, c: Captive, U: number, colors: DeckColors): DeckPart;
  nest?(kit: Kit, n: Nest, U: number, colors: DeckColors): DeckPart;
  rail?(kit: Kit, r: Rail, U: number, colors: DeckColors): DeckPart;
  spinner?(kit: Kit, g: Gate, i: number, U: number, colors: DeckColors): DeckPart;
  /** Every fixed wall: the frame, gutters, housings, the floor over the holes. */
  walls?(
    kit: Kit,
    walls: readonly Seg[],
    posts: readonly Circle[],
    U: number,
    colors: DeckColors,
  ): DeckPart;
  /** Above each table: its chute, its hole and its target. */
  chute?(kit: Kit, s: Slot, pillar: Seg, geo: DeckGeometry, color: string): DeckPart;
  hole?(kit: Kit, s: Slot, geo: DeckGeometry, color: string): DeckPart;
  target?(kit: Kit, t: Seg, i: number, geo: DeckGeometry, color: string): DeckPart;
  /**
   * A gift bubble rising through the deck, radius 1 (the view scales and moves it), with the
   * gift's icon as a material for a quad facing the viewer.
   */
  bubble?(kit: Kit, kind: Gift, icon: MeshBasicMaterial): Object3D;
}

const m4 = new Matrix4();
const q = new Quaternion();
const v = new Vector3();
const s3 = new Vector3();

const ease = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const tmp = new Color();

/** `n` instances of a mesh, every one coloured white to start (so its colours are in use). */
export const instances = (geo: BufferGeometry, mat: Material, n: number): InstancedMesh => {
  const m = new InstancedMesh(geo, mat, n);
  m.frustumCulled = false;
  for (let i = 0; i < n; i++) m.setColorAt(i, tmp.set("#ffffff"));
  return m;
};

/** Put instance `i` at deck (x, y), height z, scaled (sx, sy, sz). */
export const place = (
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
  q.identity();
  if (turn !== 0) q.setFromAxisAngle(v.set(0, 0, 1), turn);
  m.setMatrixAt(i, m4.compose(v.set(x, -y, z), q, s3.set(sx, sy, sz)));
  m.instanceMatrix.needsUpdate = true;
};

/** Upload instance colours that changed this frame. */
export const dirty = (...ms: InstancedMesh[]) => {
  for (const m of ms) if (m.instanceColor) m.instanceColor.needsUpdate = true;
};

/** A plain pop bumper: dark base, coloured skirt, lit cap that flashes white. */
export const bumperPart = (
  kit: Kit,
  c: Circle,
  color: string,
  height: number,
  flash: (f: DeckFrame) => number,
  moving = false,
): DeckPart => {
  const root = new Group();
  const cap = kit.keep(
    new MeshPhongMaterial({ color: "#f7f9ff", emissive: color, shininess: 100 }),
  );
  const base = new Mesh(kit.geo.cylinder, kit.mat.dark);
  base.scale.set(c.r, c.r, height * 0.4);
  const skirt = new Mesh(kit.geo.cylinder, kit.phong(color, { shininess: 80 }));
  skirt.scale.set(c.r * 1.08, c.r * 1.08, height * 0.18);
  skirt.position.z = height * 0.4;
  const top = new Mesh(kit.geo.cylinder, cap);
  top.scale.set(c.r * 0.7, c.r * 0.7, height * 0.42);
  top.position.z = height * 0.58;
  const halo = new Mesh(kit.geo.quad, kit.glow(color));
  halo.scale.set(c.r * 4, c.r * 4, 1);
  halo.position.z = 1;
  root.add(halo, base, skirt, top);
  at(root, c.x, c.y, 0);
  // Standing still, all but the lit cap can be merged with the other bumpers'.
  if (!moving) for (const m of [halo, base, skirt]) m.userData.static = true;
  return {
    root,
    sync(f) {
      if (moving) at(root, c.x, c.y, 0);
      const k = flash(f);
      cap.emissive.set(k > 0 ? "#ffffff" : color).multiplyScalar(0.45 + 0.55 * k);
    },
  };
};

/** Dots round a ring, lit up to a share: a device's charge or hold. */
const dotRing = (kit: Kit, x: number, y: number, r: number, size: number, n = 24) => {
  const dots = new InstancedMesh(kit.geo.disc, kit.basic("#ffffff"), n);
  dots.frustumCulled = false;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / n;
    q.identity();
    dots.setMatrixAt(
      i,
      m4.compose(v.set(x + Math.cos(a) * r, -(y + Math.sin(a) * r), 1.2), q, s3.set(size, size, 1)),
    );
    dots.setColorAt(i, kit.mat.dark.color);
  }
  const lit = new Color();
  const off = kit.mat.dark.color.clone();
  let shown = -1;
  return {
    mesh: dots,
    set(k: number, color: string) {
      const m = Math.round(Math.max(0, Math.min(1, k)) * n);
      if (m === shown) return;
      shown = m;
      lit.set(color);
      for (let i = 0; i < n; i++) dots.setColorAt(i, i < m ? lit : off);
      if (dots.instanceColor) dots.instanceColor.needsUpdate = true;
    },
  };
};

/** A hole in the deck: a dark pit with a rim. */
const pit = (kit: Kit, x: number, y: number, r: number, color: string) => {
  const g = new Group();
  const d = new Mesh(kit.geo.disc, kit.basic("#000000"));
  d.scale.set(r, r, 1);
  d.position.z = 0.5;
  const rim = new Mesh(kit.geo.ring, kit.phong(color, { emissive: color }));
  rim.scale.set(r * 1.12, r * 1.12, 1);
  rim.position.z = 0.8;
  g.add(d, rim);
  at(g, x, y, 0);
  return g;
};

const starShape = (r: number) => {
  const s = new Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const k = i % 2 === 0 ? r : r * 0.45;
    if (i === 0) s.moveTo(Math.cos(a) * k, Math.sin(a) * k);
    else s.lineTo(Math.cos(a) * k, Math.sin(a) * k);
  }
  s.closePath();
  return s;
};

export const plainDeck: Required<Omit<DeckSkin, "colors" | "background" | "bubble">> = {
  pops(kit, cs, col) {
    // Base, skirt, cap and glow each one instanced mesh for every pop; caps and glows flash.
    const n = Math.max(1, cs.length);
    const base = instances(kit.geo.cylinder, kit.mat.dark, n);
    const skirt = instances(kit.geo.cylinder, kit.phong(col.pop, { shininess: 80 }), n);
    const cap = instances(kit.geo.cylinder, kit.basic("#ffffff"), n);
    const halo = instances(kit.geo.quad, kit.glow("#ffffff"), n);
    cs.forEach((c, i) => {
      const h = c.r * 1.3;
      place(base, i, c.x, c.y, 0, c.r, c.r, h * 0.4);
      place(skirt, i, c.x, c.y, h * 0.4, c.r * 1.08, c.r * 1.08, h * 0.18);
      place(cap, i, c.x, c.y, h * 0.58, c.r * 0.7, c.r * 0.7, h * 0.42);
      place(halo, i, c.x, c.y, 1, c.r * 4, c.r * 4, 1);
    });
    for (const m of [base, skirt, cap, halo]) m.count = cs.length;
    const root = new Group();
    root.add(halo, base, skirt, cap);
    const lit = new Color(col.pop);
    const white = new Color("#ffffff");
    return {
      root,
      sync(f) {
        cs.forEach((_, i) => {
          const k = f.flash("bumper", i);
          cap.setColorAt(i, tmp.copy(lit).lerp(white, 0.35 + 0.65 * k));
          halo.setColorAt(i, tmp.copy(lit).multiplyScalar(0.25 + 0.5 * k));
        });
        dirty(cap, halo);
      },
    };
  },
  cluster: (kit, c, i, col) =>
    bumperPart(kit, c, col.cluster, c.r * 1.3, (f) => f.flash("cluster", i, 0.2), true),
  shuttle: (kit, geo, col) =>
    bumperPart(
      kit,
      geo.shuttle.bumper,
      col.shuttle,
      geo.shuttle.bumper.r * 1.3,
      (f) => f.flash("shuttle", 0, 0.2),
      true,
    ),
  big(kit, geo, col) {
    const c = geo.big;
    const root = new Group();
    const cap = kit.keep(
      new MeshPhongMaterial({ color: "#f7f9ff", emissive: col.big[0], shininess: 100 }),
    );
    const skirtMat = kit.keep(new MeshPhongMaterial({ color: col.big[0], shininess: 80 }));
    const haloMat = kit.keep(kit.glow("#ffffff").clone());
    const halo = new Mesh(kit.geo.quad, haloMat);
    halo.position.z = 1;
    const base = new Mesh(kit.geo.cylinder, kit.mat.dark);
    const skirt = new Mesh(kit.geo.cylinder, skirtMat);
    const top = new Mesh(kit.geo.cylinder, cap);
    const lamps = new InstancedMesh(
      kit.geo.sphere,
      kit.phong("#ffffff", { emissive: "#ffffff" }),
      6,
    );
    lamps.frustumCulled = false;
    for (let i = 0; i < 6; i++) lamps.setColorAt(i, kit.mat.dark.color);
    root.add(halo, base, skirt, top, lamps);
    at(root, c.x, c.y, 0);
    const U = geo.U;
    const on = new Color("#ffffff");
    const off = new Color("#3a4060");
    return {
      root,
      sync(f) {
        const big = f.deck.parts.big;
        const color = col.big[big.level] ?? col.big[0];
        const r = c.r;
        const h = U * 1.6;
        base.scale.set(r, r, h * 0.4);
        skirt.scale.set(r * 1.08, r * 1.08, h * 0.18);
        skirt.position.z = h * 0.4;
        top.scale.set(r * 0.72, r * 0.72, h * 0.42);
        top.position.z = h * 0.58;
        skirtMat.color.set(color);
        const hit = f.flash("big", 0, 0.2);
        const burst = f.flash("burst", 0, 0.8);
        cap.emissive.set(hit > 0 ? "#ffffff" : color).multiplyScalar(0.5 + 0.5 * hit);
        const hr = r * (3.2 + burst * 3);
        halo.scale.set(hr, hr, 1);
        haloMat.color.set(color).multiplyScalar(0.5 + burst);
        const lit = big.hits % 6;
        for (let i = 0; i < 6; i++) {
          const a = -Math.PI / 2 + (i * Math.PI * 2) / 6;
          q.identity();
          lamps.setMatrixAt(
            i,
            m4.compose(
              v.set(Math.cos(a) * r * 0.86, -Math.sin(a) * r * 0.86, h + 2),
              q,
              s3.set(U * 0.24, U * 0.24, U * 0.24),
            ),
          );
          lamps.setColorAt(i, i < lit ? on : off);
        }
        lamps.instanceMatrix.needsUpdate = true;
        if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
      },
    };
  },
  mushrooms(kit, cs, col) {
    const n = Math.max(1, cs.length);
    const stem = instances(kit.geo.cylinder, kit.mat.dark, n);
    const cap = instances(kit.geo.cylinder, kit.phong("#ffffff", { shininess: 60 }), n);
    cs.forEach((c, i) => {
      place(stem, i, c.x, c.y, 0, c.r * 0.45, c.r * 0.45, c.r * 0.6);
      place(cap, i, c.x, c.y, c.r * 0.6, c.r, c.r, c.r * 0.4);
    });
    stem.count = cap.count = cs.length;
    const root = new Group();
    root.add(stem, cap);
    const base = new Color(col.mushroom);
    const white = new Color("#ffffff");
    return {
      root,
      sync(f) {
        cs.forEach((_, i) =>
          cap.setColorAt(i, tmp.copy(base).lerp(white, f.flash("mushroom", i) * 0.8)),
        );
        dirty(cap);
      },
    };
  },
  sling(kit, s, i, col) {
    const root = new Group();
    const body = new Mesh(
      kit.keep(extrudeGeometry(s.pts, s.face.r * 6, 2)),
      kit.phong(col.sling, { opacity: 0.7 }),
    );
    body.userData.static = true;
    root.add(body);
    const mat = kit.keep(new MeshPhongMaterial({ color: "#f2f5fa", emissive: "#000000" }));
    const face = railsGeometry([s.face], s.face.r * 7, 1);
    if (face) root.add(new Mesh(kit.keep(face), mat));
    return {
      root,
      sync(f) {
        mat.emissive.set(col.sling).multiplyScalar(0.3 + 0.7 * f.flash("sling", i));
      },
    };
  },
  stars(kit, rs, col) {
    const n = Math.max(1, rs.length);
    const size = rs[0]?.r ?? 1;
    const geo = kit.keep(new ShapeGeometry(starShape(size * 0.8)));
    const mesh = instances(geo, kit.basic("#ffffff"), n);
    rs.forEach((r, i) => place(mesh, i, r.x, r.y, 0.6, r.r / size, r.r / size, 1));
    mesh.count = rs.length;
    const base = new Color("#2a3150");
    const lit = new Color();
    return {
      root: mesh,
      sync(f) {
        rs.forEach((_, i) => {
          const s = f.deck.parts.stars[i];
          const age = s ? f.deck.world.t - s.at : Infinity;
          const k = age < 1.5 ? 0.25 + 0.75 * (1 - age / 1.5) : 0;
          lit.set(s ? (f.palette[s.color % f.palette.length] ?? col.star) : col.star);
          mesh.setColorAt(i, tmp.copy(base).lerp(lit, k));
        });
        dirty(mesh);
      },
    };
  },
  magnet(kit, m, i, col) {
    const root = new Group();
    const disc = new Mesh(kit.geo.disc, kit.basic("#120a24"));
    disc.scale.set(m.r * 0.55, m.r * 0.55, 1);
    disc.position.z = 0.5;
    root.add(disc);
    for (let k = 1; k <= 3; k++) {
      const ring = new Mesh(kit.geo.ring, kit.phong(col.magnet, { emissive: "#2a1040" }));
      const rr = (m.r * k) / 3;
      ring.scale.set(rr, rr, 1);
      ring.position.z = 0.7;
      root.add(ring);
    }
    const glowMat = kit.keep(kit.glow(col.magnet).clone());
    const glow = new Mesh(kit.geo.quad, glowMat);
    glow.scale.set(m.r * 3, m.r * 3, 1);
    glow.position.z = 1;
    root.add(glow);
    at(root, m.x, m.y, 0);
    root.userData.static = true;
    const dots = dotRing(kit, m.x, m.y, m.r * 1.08, m.r * 0.06);
    const out = new Group();
    out.add(root, dots.mesh);
    return {
      root: out,
      sync(f) {
        const mg = f.deck.parts.magnets[i];
        const holding = (mg?.held.length ?? 0) > 0;
        const charge = holding && mg ? Math.min(1, (f.now - mg.since) / MAGNET_MS) : 0;
        const thrown = f.flash(`magnet${i}`, 0, 0.5);
        glowMat.color.set(col.magnet).multiplyScalar(0.15 + 0.6 * charge + 0.4 * thrown);
        dots.set(charge, col.magnet);
      },
    };
  },
  saucer(kit, s, i, col) {
    const g = new Group();
    g.add(pit(kit, s.x, s.y, s.r * 0.9, col.saucer));
    g.children[0]!.userData.static = true;
    const dots = dotRing(kit, s.x, s.y, s.r * 1.1, s.r * 0.07);
    g.add(dots.mesh);
    return {
      root: g,
      sync(f) {
        const sc = f.deck.parts.saucers[i];
        const k = sc && sc.held.length > 0 ? Math.min(1, (f.now - sc.since) / SAUCER_MS) : 0;
        dots.set(k, col.saucer);
      },
    };
  },
  scoop(kit, vk, col) {
    const g = new Group();
    g.add(pit(kit, vk.x, vk.y, vk.r * 0.85, col.scoop));
    g.children[0]!.userData.static = true;
    const dots = dotRing(kit, vk.x, vk.y, vk.r * 1.05, vk.r * 0.07);
    g.add(dots.mesh);
    return {
      root: g,
      sync(f) {
        const u = f.deck.parts.vuk;
        dots.set(u.held.length > 0 ? Math.min(1, (f.now - u.since) / VUK_MS) : 0, col.scoop);
      },
    };
  },
  lock(kit, l, U, col) {
    const g = new Group();
    const tube = new Mesh(kit.geo.box, kit.mat.glass);
    tube.scale.set(U * 2.5, l.bottom - l.top + U * 0.3, U * 2.2);
    at(tube, l.x, (l.top + l.bottom) / 2, 0);
    tube.userData.static = true;
    g.add(tube);
    const lampMats = Array.from({ length: LOCK_SIZE }, (_, i) => {
      const mat = kit.keep(new MeshPhongMaterial({ color: "#1d2a22", emissive: "#000000" }));
      const m = new Mesh(kit.geo.sphere, mat);
      m.scale.setScalar(U * 0.45);
      at(m, l.x - U * 2.3, l.stack[i]!.y, U * 0.4);
      g.add(m);
      return mat;
    });
    return {
      root: g,
      sync(f) {
        const multi = f.flash("multiball", 0, 1.2);
        const n = f.deck.parts.lock.held.length;
        lampMats.forEach((m, i) => m.emissive.set(i < n || multi > 0 ? col.lock : "#000000"));
      },
    };
  },
  captive(kit, c, U) {
    const g = new Group();
    const back = new Mesh(kit.geo.quad, kit.basic("#ffcc33", { opacity: 0.08 }));
    back.scale.set(c.box.x1 - c.box.x0, c.box.y1 - c.box.y0, 1);
    at(back, (c.box.x0 + c.box.x1) / 2, (c.box.y0 + c.box.y1) / 2, 0.4);
    back.userData.static = true;
    const mat = kit.keep(new MeshPhongMaterial({ color: "#ffcc33", emissive: "#000000" }));
    const tg = railsGeometry([c.target], U * 0.8);
    if (tg) g.add(new Mesh(kit.keep(tg), mat));
    g.add(back);
    return {
      root: g,
      sync(f) {
        mat.emissive.set("#ffffff").multiplyScalar(f.flash("captive", 0, 0.5));
      },
    };
  },
  nest(kit, n, U, col) {
    const g = new Group();
    const hang = new Group();
    const track = new Mesh(kit.geo.box, kit.mat.metal);
    track.scale.set(n.maxX - n.minX + U * 16, U * 0.3, U * 0.3);
    at(track, (n.minX + n.maxX) / 2, n.y - n.depth - U * 1.6, U * 0.4);
    g.add(track, hang);
    const mat = kit.phong(col.nest, { opacity: 0.85, shininess: 50 });
    let built = "";
    let basket: Mesh | null = null;
    return {
      root: g,
      sync(f) {
        const nest = f.deck.parts.nest;
        const w = nest.width;
        const key = `${w.toFixed(1)}|${nest.cups}`;
        if (key !== built) {
          built = key;
          if (basket) {
            hang.remove(basket);
            basket.geometry.dispose();
          }
          // A basket open at the top, as an outline extruded towards the viewer.
          const pts: { x: number; y: number }[] = [];
          for (let i = 0; i <= 16; i++) {
            const a = Math.PI - (i * Math.PI) / 16;
            pts.push({ x: (Math.cos(a) * w) / 2, y: U * 0.9 * Math.sin(a) });
          }
          for (let i = 16; i >= 0; i--) {
            const a = Math.PI - (i * Math.PI) / 16;
            pts.push({ x: Math.cos(a) * (w / 2 - U * 0.35), y: U * 0.9 * Math.sin(a) - U * 0.35 });
          }
          basket = new Mesh(extrudeGeometry(pts, U * 1.4, 1), mat);
          hang.add(basket);
        }
        const tilt = nest.tilt(f.now) * 1.1;
        at(hang, nest.x, n.y, 0);
        hang.rotation.z = -tilt;
      },
      dispose() {
        basket?.geometry.dispose();
      },
    };
  },
  rail(kit, r, U, col) {
    const g = new Group();
    const lift = U * 1.3;
    const a = r.pts[0]!;
    const b = r.pts.at(-1)!;
    const pts = r.pts.map((p) => ({
      ...p,
      z:
        U +
        lift *
          Math.min(
            1,
            Math.hypot(p.x - a.x, p.y - a.y) / (3 * U),
            Math.hypot(p.x - b.x, p.y - b.y) / (3 * U),
          ),
    }));
    g.add(new Mesh(kit.keep(tubeGeometry(pts, U * 1.25)), kit.mat.glass));
    const wire = kit.phong(col.glass, { emissive: "#163a52", shininess: 90 });
    for (const side of [-1, 1]) {
      const off = pts.map((p, i) => {
        const p0 = pts[Math.max(0, i - 1)]!;
        const p1 = pts[Math.min(pts.length - 1, i + 1)]!;
        const l = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
        return {
          x: p.x + (-(p1.y - p0.y) / l) * U * 1.15 * side,
          y: p.y + ((p1.x - p0.x) / l) * U * 1.15 * side,
          z: p.z,
        };
      });
      g.add(new Mesh(kit.keep(tubeGeometry(off, U * 0.12, 6)), wire));
    }
    return { root: g };
  },
  spinner(kit, gate, i, U) {
    const pivot = new Group();
    const plate = new Mesh(kit.geo.box, kit.phong("#ffcc33", { emissive: "#3a2a00" }));
    const half = Math.hypot(gate.bx - gate.ax, gate.by - gate.ay) / 2;
    plate.scale.set(half * 2, U * 0.2, U * 1.4);
    plate.position.z = -U * 0.7;
    pivot.add(plate);
    at(pivot, (gate.ax + gate.bx) / 2, gate.ay, U * 0.8);
    return {
      root: pivot,
      sync(f) {
        pivot.rotation.x = f.deck.spinners[i]?.angle ?? 0;
      },
    };
  },
  walls(kit, walls, posts, U) {
    const g = new Group();
    const rg = railsGeometry(walls, U * 0.9);
    if (rg) g.add(new Mesh(kit.keep(rg), kit.mat.metal));
    for (const p of posts) {
      const m = new Mesh(kit.geo.cylinder, kit.mat.metal);
      m.scale.set(p.r, p.r, U);
      at(m, p.x, p.y, 0);
      g.add(m);
    }
    return { root: g };
  },
  chute(kit, s, p, geo, color) {
    const g = new Group();
    const top = p.by;
    const h = geo.H - top + p.r;
    const glass = new Mesh(kit.geo.box, kit.mat.glass);
    glass.scale.set(p.r * 2, h, p.r * 1.6);
    at(glass, p.ax, top + h / 2, 0);
    g.add(glass);
    const rail = kit.phong(color, { emissive: color });
    for (const side of [-1, 1]) {
      const m = new Mesh(kit.geo.box, rail);
      m.scale.set(Math.max(3, geo.R * 0.18), h, p.r * 1.7);
      at(m, p.ax + side * p.r, top + h / 2, 0);
      g.add(m);
    }
    void s;
    return { root: g };
  },
  hole(kit, s, geo, color) {
    const g = new Group();
    const d = new Mesh(kit.geo.disc, kit.basic("#010208"));
    d.scale.set(geo.R * 1.5, geo.R * 0.75, 1);
    at(d, s.holeX, geo.holeY + geo.R * 0.6, 0.5);
    const rim = new Mesh(kit.geo.ring, kit.phong(color, { emissive: color }));
    rim.scale.set(geo.R * 1.6, geo.R * 0.85, 1);
    at(rim, s.holeX, geo.holeY + geo.R * 0.6, 0.8);
    g.add(d, rim);
    return { root: g };
  },
  target(kit, t, i, geo, color) {
    const mat = kit.keep(new MeshPhongMaterial({ color: "#8a6a1a", emissive: "#000000" }));
    const tg = railsGeometry([t], geo.R * 1.2);
    const m = new Mesh(kit.keep(tg!), mat);
    const lit = new Color(color);
    const white = new Color("#ffffff");
    return {
      root: m,
      sync(f) {
        const on = f.deck.lit[i] ?? false;
        const k = f.flash("target", i, 0.3);
        mat.color.set(on ? color : "#8a6a1a");
        mat.emissive
          .copy(lit)
          .multiplyScalar(on ? 0.6 : 0)
          .lerp(white, k);
      },
    };
  },
};

export { ease };
