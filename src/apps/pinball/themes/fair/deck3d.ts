/**
 * Fun fair's skin for the upper deck: a night sky over the fair's tents with strings of lights,
 * paper lanterns for pop bumpers, a turning carousel top for the big bumper, teacups for the
 * cluster, a dodgem car for the shuttle, candy floss for mushrooms, lollipops for magnets,
 * striped tubs round the saucers and the scoop, a ticket booth round the lock, a striped canopy
 * over the nest, roller-coaster track for the rails and balloons carrying the gifts.
 */
import {
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
} from "three";
import type { Gift } from "../../config";
import { GIFT_COLOR } from "../../gifticon";
import type { DeckColors, DeckSkin } from "../../view3d/deckparts3d";
import { dirty, instances, place, plainDeck } from "../../view3d/deckparts3d";
import { at, type Kit, paintedGeometry, tubeGeometry } from "../../view3d/kit";
import { FAIR, paintFairNight, paintSwirl, stream } from "./art";

export const FAIR_DECK_COLORS: Partial<DeckColors> = {
  pop: "#ff6a7a",
  big: ["#5aa0ff", "#ff6fa8", "#ffb347"],
  cluster: "#ff8fb2",
  shuttle: "#3a7be0",
  mushroom: "#ff9fd0",
  sling: "#c8283c",
  magnet: "#ff5a9a",
  saucer: "#ffd98a",
  scoop: "#7fe0d0",
  lock: "#9fe08a",
  nest: "#f4e6c8",
  glass: "#ffe2c0",
  rail: "#e9dcc0",
  star: "#fff1c4",
  target: "#ffd98a",
};

const LANTERNS = ["#ff5a6e", "#ffb347", "#ff8fb2", "#7fb8ff", "#9fe08a", "#c79bff"];
const CUPS = ["#ff9fc0", "#8fd0ff", "#a8eec0", "#ffd0a0"];

type Piece = { geometry: BufferGeometry; color: string; matrix?: Matrix4 };
const M = () => new Matrix4();
const T = (x: number, y: number, z: number) => M().makeTranslation(x, y, z);
const tmp = new Color();

interface Assets {
  painted: MeshPhongMaterial;
  paper: MeshBasicMaterial;
  caps: BufferGeometry;
  cup: BufferGeometry;
  car: BufferGeometry;
  floss: IcosahedronGeometry;
  stick: CylinderGeometry;
  swirl: MeshBasicMaterial;
  balloon: SphereGeometry;
  knot: ConeGeometry;
  canopyCream: BufferGeometry;
  canopyColour: BufferGeometry;
}

const cache = new WeakMap<Kit, Assets>();

const assets = (kit: Kit): Assets => {
  const have = cache.get(kit);
  if (have) return have;
  const made: BufferGeometry[] = [];
  const t = <G extends BufferGeometry>(g: G) => {
    made.push(g);
    return g;
  };
  // A teacup in profile, radius about 1: a bowl open at the top, a handle and a saucer.
  const bowl = [
    [0.01, -0.62],
    [0.55, -0.62],
    [0.86, -0.32],
    [1, 0.18],
    [1.02, 0.4],
    [0.92, 0.4],
    [0.88, 0.18],
    [0.76, -0.3],
    [0.5, -0.5],
    [0.01, -0.5],
  ].map(([r, y]) => new Vector2(r!, y!));
  const cup = kit.keep(
    paintedGeometry([
      { geometry: t(new LatheGeometry(bowl, 24)), color: "#ffffff" },
      {
        geometry: t(new TorusGeometry(0.3, 0.07, 6, 14, Math.PI * 1.3)),
        color: "#ffffff",
        matrix: T(1.0, -0.05, 0).multiply(M().makeRotationZ(-Math.PI * 0.65)),
      },
      {
        geometry: t(new CylinderGeometry(1.15, 0.9, 0.12, 24)),
        color: "#f4e6c8",
        matrix: T(0, -0.68, 0),
      },
      {
        geometry: t(new TorusGeometry(1.0, 0.05, 4, 24)),
        color: FAIR.gold,
        matrix: T(0, 0.41, 0).multiply(M().makeRotationX(Math.PI / 2)),
      },
    ])!,
  );
  // A dodgem car in profile, facing +x, about 2.4 long: body, bumper, seat back, pole and spark.
  const body = new Shape();
  body.moveTo(-1.15, -0.45);
  body.lineTo(1.15, -0.45);
  body.quadraticCurveTo(1.3, -0.45, 1.25, -0.15);
  body.quadraticCurveTo(1.1, 0.25, 0.4, 0.2);
  body.lineTo(-0.3, 0.2);
  body.lineTo(-0.55, 0.62);
  body.lineTo(-1.05, 0.62);
  body.quadraticCurveTo(-1.25, 0.2, -1.15, -0.45);
  const bodyGeo = t(
    new ExtrudeGeometry(body, {
      depth: 1.2,
      bevelEnabled: true,
      bevelSize: 0.08,
      bevelThickness: 0.08,
      bevelSegments: 2,
    }),
  );
  bodyGeo.translate(0, 0, -0.6);
  const car = kit.keep(
    paintedGeometry([
      { geometry: bodyGeo, color: "#ffffff" },
      {
        geometry: t(new CylinderGeometry(0.16, 0.16, 2.6, 10)),
        color: "#2a2a30",
        matrix: T(0, -0.5, 0)
          .multiply(M().makeRotationZ(Math.PI / 2))
          .multiply(M().makeScale(1, 1, 4.2)),
      },
      {
        geometry: t(new CylinderGeometry(0.05, 0.05, 1.6, 6)),
        color: "#cfd3dc",
        matrix: T(-0.9, 1.4, 0),
      },
      { geometry: t(new SphereGeometry(0.12, 8, 6)), color: FAIR.gold, matrix: T(-0.9, 2.2, 0) },
      {
        geometry: t(new TorusGeometry(0.3, 0.06, 6, 16)),
        color: "#2a2a30",
        matrix: T(0.55, 0.32, 0.1)
          .multiply(M().makeRotationY(Math.PI / 2))
          .multiply(M().makeRotationX(0.6)),
      },
    ])!,
  );
  // Candy floss: a lumpy cloud.
  const floss = kit.keep(new IcosahedronGeometry(1, 2));
  const pos = floss.getAttribute("position");
  const rnd = stream(31);
  const bumps = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let k = bumps.get(key);
    if (k === undefined) {
      k = 0.85 + rnd() * 0.25;
      bumps.set(key, k);
    }
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.9, pos.getZ(i) * k);
  }
  floss.computeVertexNormals();
  // The big bumper's canopy, a striped cone (axis y), in two meshes: cream, and the level's colour.
  const wedges = (odd: boolean) => {
    const n = 14;
    const parts: Piece[] = [];
    for (let i = odd ? 1 : 0; i < n; i += 2) {
      parts.push({
        geometry: t(
          new ConeGeometry(1, 0.62, 3, 1, false, (i * Math.PI * 2) / n, (Math.PI * 2) / n),
        ),
        color: "#ffffff",
      });
      parts.push({
        geometry: t(
          new CylinderGeometry(
            1.02,
            1.02,
            0.16,
            3,
            1,
            true,
            (i * Math.PI * 2) / n,
            (Math.PI * 2) / n,
          ),
        ),
        color: "#ffffff",
        matrix: T(0, -0.36, 0),
      });
    }
    return kit.keep(paintedGeometry(parts)!);
  };
  const canopyCream = wedges(false);
  const canopyColour = wedges(true);
  for (const g of made) g.dispose();
  const a: Assets = {
    painted: kit.keep(
      new MeshPhongMaterial({ vertexColors: true, shininess: 70, specular: "#888888" }),
    ),
    paper: kit.keep(
      new MeshBasicMaterial({
        map: kit.paint(64, 64, (g) => {
          g.fillStyle = "#ffffff";
          g.fillRect(0, 0, 64, 64);
          g.fillStyle = "rgba(0,0,0,0.22)";
          for (let y = 4; y < 64; y += 8) g.fillRect(0, y, 64, 2);
          const shade = g.createLinearGradient(0, 0, 64, 0);
          shade.addColorStop(0, "rgba(0,0,0,0.25)");
          shade.addColorStop(0.5, "rgba(255,255,255,0.1)");
          shade.addColorStop(1, "rgba(0,0,0,0.25)");
          g.fillStyle = shade;
          g.fillRect(0, 0, 64, 64);
        }),
      }),
    ),
    caps: kit.keep(
      paintedGeometry([
        {
          geometry: new CylinderGeometry(0.42, 0.5, 0.14, 14),
          color: "#2a1a1a",
          matrix: T(0, 0.9, 0),
        },
        {
          geometry: new CylinderGeometry(0.5, 0.42, 0.14, 14),
          color: "#2a1a1a",
          matrix: T(0, -0.9, 0),
        },
        {
          geometry: new CylinderGeometry(0.04, 0.04, 0.6, 5),
          color: "#2a1a1a",
          matrix: T(0, 1.2, 0),
        },
        {
          geometry: new CylinderGeometry(0.1, 0.02, 0.4, 6),
          color: "#ffb347",
          matrix: T(0, -1.15, 0),
        },
      ])!,
    ),
    cup,
    car,
    floss,
    stick: kit.keep(new CylinderGeometry(0.06, 0.06, 1, 6)),
    swirl: kit.keep(
      new MeshBasicMaterial({
        map: kit.paint(256, 256, (g) => paintSwirl(g, 256, "#ff4f8a")),
        transparent: true,
        depthWrite: false,
      }),
    ),
    balloon: kit.keep(new SphereGeometry(1, 20, 14)),
    knot: kit.keep(new ConeGeometry(0.16, 0.22, 8)),
    canopyCream,
    canopyColour,
  };
  cache.set(kit, a);
  return a;
};

/** A ring of alternating coloured segments round (x, y), lying on the deck: a striped tub. */
const stripedRing = (
  kit: Kit,
  x: number,
  y: number,
  r: number,
  tube: number,
  colors: [string, string],
) => {
  const n = 12;
  const parts: Piece[] = [];
  for (let i = 0; i < n; i++) {
    parts.push({
      geometry: new TorusGeometry(r, tube, 6, 4, (Math.PI * 2) / n),
      color: colors[i % 2]!,
      matrix: M().makeRotationZ((i * Math.PI * 2) / n),
    });
  }
  const g = kit.keep(paintedGeometry(parts)!);
  for (const p of parts) p.geometry.dispose();
  const mesh = new Mesh(g, assets(kit).painted);
  at(mesh, x, y, tube);
  mesh.userData.static = true;
  return mesh;
};

export const fairDeck: DeckSkin = {
  colors: FAIR_DECK_COLORS,
  background(g, geo) {
    paintFairNight(g, geo.W, geo.H, geo.U, 5);
  },
  pops(kit, cs) {
    // Paper lanterns: a glowing ribbed body, dark caps with a tassel, and a halo.
    const A = assets(kit);
    const n = Math.max(1, cs.length);
    const body = instances(kit.geo.sphere, A.paper, n);
    const caps = instances(A.caps, A.painted, n);
    const halo = instances(kit.geo.quad, kit.glow("#ffffff"), n);
    cs.forEach((c, i) => {
      place(body, i, c.x, c.y, c.r, c.r * 0.98, c.r * 0.86, c.r * 0.98);
      place(caps, i, c.x, c.y, c.r, c.r, c.r, c.r);
      place(halo, i, c.x, c.y, 1, c.r * 4.2, c.r * 4.2, 1);
    });
    for (const m of [body, caps, halo]) m.count = cs.length;
    const root = new Group();
    root.add(halo, body, caps);
    const hues = cs.map((_, i) => new Color(LANTERNS[i % LANTERNS.length]!));
    const white = new Color("#ffffff");
    return {
      root,
      sync(f) {
        cs.forEach((_, i) => {
          const k = f.flash("bumper", i);
          const flick = 0.85 + 0.15 * Math.sin(f.time * 3 + i * 1.7);
          body.setColorAt(
            i,
            tmp
              .copy(hues[i]!)
              .multiplyScalar(flick)
              .lerp(white, 0.6 * k),
          );
          halo.setColorAt(i, tmp.copy(hues[i]!).multiplyScalar(0.3 + 0.6 * k));
        });
        dirty(body, halo);
      },
    };
  },
  big(kit, geo, col) {
    // A carousel's top: a striped canopy turning over a gold drum ringed with bulbs.
    const A = assets(kit);
    const c = geo.big;
    const U = geo.U;
    const r = c.r;
    const root = new Group();
    const turn = new Group();
    const cream = new Mesh(A.canopyCream, kit.phong("#f4e6c8", { shininess: 50 }));
    const colourMat = kit.keep(
      new MeshPhongMaterial({ color: col.big[0], emissive: "#000000", shininess: 50 }),
    );
    const coloured = new Mesh(A.canopyColour, colourMat);
    for (const m of [cream, coloured]) {
      m.scale.set(r * 1.25, r * 1.25, r * 1.25);
      m.position.set(0, r * 0.55, 0);
    }
    const drumMat = kit.keep(
      new MeshPhongMaterial({ color: FAIR.gold, emissive: "#000000", shininess: 90 }),
    );
    const drum = new Mesh(kit.geo.cylinder, drumMat);
    drum.rotation.x = -Math.PI / 2;
    drum.scale.set(r * 0.92, r * 0.92, r * 0.6);
    drum.position.set(0, -r * 0.55, 0);
    const finial = new Mesh(kit.geo.sphere, kit.phong(FAIR.gold, { shininess: 100 }));
    finial.scale.setScalar(U * 0.35);
    finial.position.set(0, r * 1.05, 0);
    turn.add(cream, coloured, drum, finial);
    turn.position.z = r;
    const haloMat = kit.keep(kit.glow("#ffffff").clone());
    const halo = new Mesh(kit.geo.quad, haloMat);
    halo.position.z = 1;
    const lamps = new InstancedMesh(kit.geo.sphere, kit.basic("#ffffff"), 6);
    lamps.frustumCulled = false;
    for (let i = 0; i < 6; i++) lamps.setColorAt(i, tmp.set("#3a2a20"));
    root.add(halo, turn, lamps);
    at(root, c.x, c.y, 0);
    const off = new Color("#4a3020");
    const white = new Color("#ffffff");
    let spin = 0;
    let last = 0;
    return {
      root,
      sync(f) {
        const big = f.deck.parts.big;
        const color = col.big[big.level] ?? col.big[0];
        const hit = f.flash("big", 0, 0.2);
        const burst = f.flash("burst", 0, 0.9);
        const dt = Math.max(0, Math.min(0.1, f.time - last));
        last = f.time;
        spin = (spin + (0.5 + burst * 4) * dt) % (Math.PI * 2);
        turn.rotation.y = spin;
        colourMat.color.set(color);
        colourMat.emissive.set(color).multiplyScalar(0.25 + 0.5 * hit + burst);
        drumMat.emissive.set("#ffcf8a").multiplyScalar(0.1 + 0.5 * hit);
        const hr = r * (3.4 + burst * 4);
        halo.scale.set(hr, hr, 1);
        haloMat.color.set(color).multiplyScalar(0.45 + 0.5 * hit + burst);
        // Bulbs along the front of the valance, lit by hits towards the next level.
        const lit = big.hits % 6;
        for (let i = 0; i < 6; i++) {
          const a = ((i + 0.5) / 6 - 0.5) * 2.1;
          const s = U * 0.26;
          place(lamps, i, Math.sin(a) * r * 1.27, -r * 0.02, r + Math.cos(a) * r * 1.27, s, s, s);
          lamps.setColorAt(i, i < lit || burst > 0 ? tmp.set(color).lerp(white, 0.4) : off);
        }
        if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
      },
    };
  },
  cluster(kit, c, i, col) {
    // A teacup going round with the others, spinning on its own.
    const A = assets(kit);
    const root = new Group();
    const tint = CUPS[i % CUPS.length]!;
    const cupMat = kit.keep(
      new MeshPhongMaterial({
        color: tint,
        vertexColors: true,
        emissive: "#000000",
        shininess: 90,
      }),
    );
    const cup = new Mesh(A.cup, cupMat);
    cup.scale.setScalar(c.r * 1.2);
    cup.position.z = c.r;
    const haloMat = kit.keep(kit.glow(col.cluster).clone());
    const halo = new Mesh(kit.geo.quad, haloMat);
    halo.scale.set(c.r * 3.4, c.r * 3.4, 1);
    halo.position.z = 1;
    root.add(halo, cup);
    const white = new Color("#ffffff");
    return {
      root,
      sync(f) {
        at(root, c.x, c.y, 0);
        cup.rotation.y = f.time * 1.6 + i * 2;
        const k = f.flash("cluster", i, 0.25);
        cupMat.emissive
          .set(tint)
          .multiplyScalar(0.3)
          .lerp(white, 0.35 * k);
        haloMat.color.set(col.cluster).multiplyScalar(0.15 + 0.6 * k);
      },
    };
  },
  shuttle(kit, geo, col) {
    // A dodgem car driving to and fro, turning to face the way it goes, a spark on its pole.
    const A = assets(kit);
    const c = geo.shuttle.bumper;
    const root = new Group();
    const carMat = kit.keep(
      new MeshPhongMaterial({
        color: col.shuttle,
        vertexColors: true,
        emissive: "#000000",
        shininess: 90,
      }),
    );
    const car = new Mesh(A.car, carMat);
    car.position.z = c.r;
    const sparkMat = kit.keep(kit.glow("#bfe6ff").clone());
    const spark = new Mesh(kit.geo.quad, sparkMat);
    root.add(car, spark);
    let lastX = c.x;
    let face = 1;
    return {
      root,
      sync(f) {
        at(root, c.x, c.y, 0);
        const v = c.x - lastX;
        lastX = c.x;
        if (Math.abs(v) > 0.05) face += (Math.sign(v) - face) * 0.25;
        const s = c.r * 0.95;
        car.scale.set(s * (Math.abs(face) < 0.15 ? 0.15 * Math.sign(face || 1) : face), s, s);
        spark.position.set(-0.9 * s * face, 2.25 * s, c.r + 2);
        const k = f.flash("shuttle", 0, 0.2);
        const fl = 0.5 + 0.5 * Math.abs(Math.sin(f.time * 17));
        spark.scale.setScalar(c.r * (1 + fl + k * 2));
        sparkMat.color.set("#bfe6ff").multiplyScalar(0.4 + 0.4 * fl + k);
        carMat.emissive.set("#ffffff").multiplyScalar(0.3 * k);
      },
    };
  },
  mushrooms(kit, cs) {
    // Candy floss on sticks: pink and blue clouds that brighten when hit.
    const A = assets(kit);
    const n = Math.max(1, cs.length);
    const clouds = instances(A.floss, kit.phong("#ffffff", { shininess: 10 }), n);
    const sticks = instances(A.stick, kit.phong("#f4e6c8", { shininess: 30 }), n);
    cs.forEach((c, i) => place(sticks, i, c.x, c.y + c.r * 1.05, c.r * 0.5, c.r, c.r * 1.3, c.r));
    clouds.count = sticks.count = cs.length;
    const hues = cs.map((_, i) => new Color(i % 2 ? "#a8d8ff" : "#ffb0d8"));
    const white = new Color("#ffffff");
    const root = new Group();
    root.add(sticks, clouds);
    return {
      root,
      sync(f) {
        cs.forEach((c, i) => {
          const wob = 1 + 0.04 * Math.sin(f.time * 2 + i);
          place(
            clouds,
            i,
            c.x,
            c.y,
            c.r * 0.8,
            c.r * 1.05 * wob,
            c.r * 0.95,
            c.r * 0.9,
            f.time * 0.15 + i,
          );
          clouds.setColorAt(i, tmp.copy(hues[i]!).lerp(white, f.flash("mushroom", i) * 0.8));
        });
        dirty(clouds);
      },
    };
  },
  magnet(kit, spec, i, col) {
    // A lollipop lying on the deck, spinning faster as it charges, over the plain rings.
    const A = assets(kit);
    const base = plainDeck.magnet(kit, spec, i, col);
    const pop = new Mesh(kit.geo.quad, A.swirl);
    pop.scale.set(spec.r * 1.5, spec.r * 1.5, 1);
    at(pop, spec.x, spec.y, 1.5);
    const stick = new Mesh(kit.geo.box, kit.phong("#f4e6c8", { shininess: 30 }));
    stick.scale.set(spec.r * 0.12, spec.r * 1.1, spec.r * 0.12);
    at(stick, spec.x, spec.y + spec.r * 1.15, 0.5);
    stick.userData.static = true;
    const root = new Group();
    root.add(base.root, stick, pop);
    let spin = 0;
    let last = 0;
    return {
      root,
      sync(f) {
        base.sync?.(f);
        const mg = f.deck.parts.magnets[i];
        const holding = (mg?.held.length ?? 0) > 0;
        const charge = holding && mg ? Math.min(1, (f.now - mg.since) / 1100) : 0;
        const dt = Math.max(0, Math.min(0.1, f.time - last));
        last = f.time;
        spin = (spin + (0.6 + charge * 7) * dt) % (Math.PI * 2);
        pop.rotation.z = -spin;
      },
    };
  },
  saucer(kit, s, i, col) {
    const base = plainDeck.saucer(kit, s, i, col);
    const root = new Group();
    root.add(base.root, stripedRing(kit, s.x, s.y, s.r * 1.05, s.r * 0.16, [FAIR.red, FAIR.cream]));
    return { root, sync: base.sync };
  },
  scoop(kit, v, col) {
    const base = plainDeck.scoop(kit, v, col);
    const root = new Group();
    root.add(base.root, stripedRing(kit, v.x, v.y, v.r * 1.0, v.r * 0.15, [FAIR.blue, FAIR.cream]));
    return { root, sync: base.sync };
  },
  lock(kit, l, U, col) {
    // The lock's tube inside a ticket booth: a striped roof, posts either side and a counter.
    const base = plainDeck.lock(kit, l, U, col);
    const root = new Group();
    root.add(base.root);
    const parts: Piece[] = [];
    const w = U * 3.6;
    const roof = new Shape();
    roof.moveTo(-w / 2 - U * 0.4, 0);
    roof.lineTo(w / 2 + U * 0.4, 0);
    roof.lineTo(0, U * 1.8);
    roof.closePath();
    const stripes = 6;
    for (let k = 0; k < stripes; k++) {
      const x0 = -w / 2 - U * 0.4 + ((w + U * 0.8) * k) / stripes;
      const x1 = x0 + (w + U * 0.8) / stripes;
      const s = new Shape();
      const yAt = (x: number) => U * 1.8 * (1 - Math.abs(x) / (w / 2 + U * 0.4));
      s.moveTo(x0, 0);
      s.lineTo(x1, 0);
      s.lineTo(x1, yAt(x1));
      if (x0 < 0 && x1 > 0) s.lineTo(0, U * 1.8);
      s.lineTo(x0, yAt(x0));
      s.closePath();
      parts.push({
        geometry: new ExtrudeGeometry(s, { depth: U * 0.5, bevelEnabled: false }),
        color: k % 2 ? FAIR.cream : FAIR.red,
        matrix: T(l.x, -(l.top - U * 0.3), U * 2.2),
      });
    }
    for (const sx of [-1, 1]) {
      parts.push({
        geometry: new CylinderGeometry(U * 0.16, U * 0.16, l.bottom - l.top + U * 0.6, 8),
        color: FAIR.gold,
        matrix: T(l.x + sx * w * 0.5, -(l.top + l.bottom) / 2, U * 2.4),
      });
    }
    parts.push(
      {
        geometry: kit.geo.box,
        color: "#7a4a2a",
        matrix: T(l.x, -(l.bottom + U * 0.5), 0).multiply(
          M().makeScale(w + U * 0.6, U * 0.8, U * 2.6),
        ),
      },
      {
        geometry: kit.geo.box,
        color: FAIR.cream,
        matrix: T(l.x, -(l.bottom + U * 0.5), U * 2.6).multiply(
          M().makeScale(w + U * 0.8, U * 0.3, U * 0.2),
        ),
      },
    );
    const g = kit.keep(paintedGeometry(parts)!);
    for (const p of parts) if (p.geometry !== kit.geo.box) p.geometry.dispose();
    const booth = new Mesh(g, assets(kit).painted);
    booth.userData.static = true;
    root.add(booth);
    return { root, sync: base.sync };
  },
  nest(kit, n, U, col) {
    // A striped canopy over the nest, travelling with it.
    const base = plainDeck.nest(kit, n, U, col);
    const A = assets(kit);
    const canopy = new Group();
    const cream = new Mesh(A.canopyCream, kit.phong("#f4e6c8", { shininess: 50 }));
    const red = new Mesh(A.canopyColour, kit.phong(FAIR.red, { shininess: 50 }));
    canopy.add(cream, red);
    const root = new Group();
    root.add(base.root, canopy);
    return {
      root,
      sync(f) {
        base.sync?.(f);
        const nest = f.deck.parts.nest;
        const r = nest.width * 0.42;
        canopy.scale.set(r, r * 0.8, r);
        at(canopy, nest.x, n.y - n.depth - U * 2.6, U * 1.2);
        canopy.rotation.z = -nest.tilt(f.now) * 0.6;
        canopy.rotation.y = f.time * 0.4;
      },
      dispose: base.dispose,
    };
  },
  rail(kit, r, U) {
    // Roller-coaster track: two red rails on white sleepers, lifting off the deck in between.
    const parts: Piece[] = [];
    const a = r.pts[0]!;
    const b = r.pts.at(-1)!;
    const lift = (p: { x: number; y: number }) =>
      U * 0.2 +
      U *
        1.1 *
        Math.min(
          1,
          Math.hypot(p.x - a.x, p.y - a.y) / (3 * U),
          Math.hypot(p.x - b.x, p.y - b.y) / (3 * U),
        );
    const pts = r.pts.map((p) => ({ ...p, z: lift(p) }));
    for (const s of [-1, 1]) {
      const off = pts.map((p, i) => {
        const p0 = pts[Math.max(0, i - 1)]!;
        const p1 = pts[Math.min(pts.length - 1, i + 1)]!;
        const l = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
        return {
          x: p.x + (-(p1.y - p0.y) / l) * U * 0.7 * s,
          y: p.y + ((p1.x - p0.x) / l) * U * 0.7 * s,
          z: p.z,
        };
      });
      parts.push({ geometry: tubeGeometry(off, U * 0.13, 6), color: FAIR.red });
    }
    let d = 0;
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1]!;
      const p1 = pts[i]!;
      const l = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const ang = Math.atan2(-(p1.y - p0.y), p1.x - p0.x);
      for (; d < l; d += U * 1.4) {
        const k = d / l;
        parts.push({
          geometry: kit.geo.box,
          color: "#f4e6c8",
          matrix: T(
            p0.x + (p1.x - p0.x) * k,
            -(p0.y + (p1.y - p0.y) * k),
            p0.z + (p1.z - p0.z) * k - U * 0.18,
          )
            .multiply(M().makeRotationZ(ang + Math.PI / 2))
            .multiply(M().makeScale(U * 1.8, U * 0.28, U * 0.12)),
        });
      }
      d -= l;
    }
    const g = kit.keep(paintedGeometry(parts)!);
    for (const p of parts) if (p.geometry !== kit.geo.box) p.geometry.dispose();
    return { root: new Mesh(g, assets(kit).painted) };
  },
  bubble(kit, kind: Gift, icon) {
    // A balloon on a string with the gift in front.
    const A = assets(kit);
    const g = new Group();
    const c = GIFT_COLOR[kind];
    const skin = new Mesh(A.balloon, kit.phong(c, { shininess: 120, emissive: "#000000" }));
    skin.scale.set(0.9, 1.05, 0.9);
    const knot = new Mesh(A.knot, kit.phong(c, { shininess: 60 }));
    knot.position.set(0, -1.12, 0);
    knot.rotation.z = Math.PI;
    const string = new Mesh(A.stick, kit.phong("#f4e6c8", { shininess: 20 }));
    string.scale.set(0.3, 1.2, 0.3);
    string.position.set(0, -1.8, 0);
    const face = new Mesh(kit.geo.quad, icon);
    face.scale.set(1.0, 1.0, 1);
    face.position.z = 0.95;
    g.add(skin, knot, string, face);
    return g;
  },
};
