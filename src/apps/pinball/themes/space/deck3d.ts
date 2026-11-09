/**
 * Space's skin for the upper deck: a starfield, pop bumpers as small planets, the big bumper as a
 * star that changes colour by level and flares when it bursts, the cluster as moons, the shuttle
 * as a comet, mushrooms as asteroids, magnets as black holes, saucers and the scoop as craters,
 * the lock in a rocket gantry, the nest as a docking ring and gift bubbles as capsules. Rails stay
 * glass tubes, as on the plain deck.
 */
import {
  CapsuleGeometry,
  Color,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  Matrix4,
  MeshPhongMaterial,
  Quaternion,
  TorusGeometry,
  Vector3,
} from "three";
import { withAlpha } from "../../../../core/ui/palette";
import type { DeckColors, DeckPart, DeckSkin } from "../../view3d/deckparts3d";
import { dirty, instances, place, plainDeck } from "../../view3d/deckparts3d";
import { at, type Kit } from "../../view3d/kit";
import {
  neonRing,
  paintCrater,
  paintMoon,
  paintPlanet,
  paintSpace,
  paintSwirl,
  stream,
} from "./art";

export const SPACE_DECK_COLORS: Partial<DeckColors> = {
  pop: "#8fb8ff",
  big: ["#9fd0ff", "#fff1a8", "#ff9a5a"],
  cluster: "#b8c0d0",
  shuttle: "#9fe8ff",
  mushroom: "#a08a78",
  sling: "#6f8bff",
  magnet: "#b06bff",
  nest: "#cfe6ff",
  rail: "#c9d6ea",
};

const PLANET_HUES = [
  ["#5a8dd6", "#9cc3f0", "#2f5fa8", "#d8e8ff"],
  ["#c96f9e", "#f0b0d0", "#8a3f6b", "#ffe0ee"],
  ["#6fc4a0", "#b8f0d8", "#3a8a6b", "#e8fff4"],
  ["#d6a35a", "#f0d09c", "#a8742f", "#fff0d8"],
];

interface Assets {
  planets: MeshPhongMaterial[];
  moon: MeshPhongMaterial;
  rock: IcosahedronGeometry;
  rockMat: MeshPhongMaterial;
  swirl: MeshBasicMaterial;
  crater: (glow: string) => MeshBasicMaterial;
  torus: TorusGeometry;
  capsule: CapsuleGeometry;
}

const cache = new WeakMap<Kit, Assets>();
const tmp = new Color();

const assets = (kit: Kit): Assets => {
  const have = cache.get(kit);
  if (have) return have;
  const rock = kit.keep(new IcosahedronGeometry(1, 1));
  const pos = rock.getAttribute("position");
  const rnd = stream(29);
  const bumps = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let k = bumps.get(key);
    if (k === undefined) {
      k = 0.75 + rnd() * 0.45;
      bumps.set(key, k);
    }
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
  }
  rock.computeVertexNormals();
  const craters = new Map<string, MeshBasicMaterial>();
  const a: Assets = {
    planets: PLANET_HUES.map((h, i) =>
      kit.keep(
        new MeshPhongMaterial({
          map: kit.paint(256, 128, (g) => paintPlanet(g, 256, 128, h, 40 + i)),
          shininess: 20,
          emissive: "#000000",
        }),
      ),
    ),
    moon: kit.keep(
      new MeshPhongMaterial({
        map: kit.paint(128, 64, (g) => paintMoon(g, 128, 64, 11)),
        shininess: 8,
        emissive: "#000000",
      }),
    ),
    rock,
    rockMat: kit.keep(
      new MeshPhongMaterial({
        color: "#8a7a6c",
        flatShading: true,
        shininess: 6,
        emissive: "#000000",
      }),
    ),
    swirl: kit.keep(
      new MeshBasicMaterial({
        map: kit.paint(256, 256, (g) => paintSwirl(g, 256, "#e0b0ff", "#5a2bd6")),
        transparent: true,
        depthWrite: false,
      }),
    ),
    crater(glow) {
      let c = craters.get(glow);
      if (!c) {
        c = kit.keep(
          new MeshBasicMaterial({
            map: kit.paint(128, 128, (g) => paintCrater(g, 128, glow)),
            transparent: true,
            depthWrite: false,
          }),
        );
        craters.set(glow, c);
      }
      return c;
    },
    torus: kit.keep(new TorusGeometry(1, 0.08, 10, 64)),
    capsule: kit.keep(new CapsuleGeometry(0.55, 0.8, 6, 16)),
  };
  cache.set(kit, a);
  return a;
};

/** A small planet as a pop bumper: it turns, and its air flares when hit. */
const planetPart = (
  kit: Kit,
  x: number,
  y: number,
  r: number,
  mat: MeshPhongMaterial,
  hit: (f: Parameters<NonNullable<DeckPart["sync"]>>[0]) => number,
  moving?: { x: number; y: number },
): DeckPart => {
  const root = new Group();
  const m = mat.clone();
  kit.keep(m);
  const ball = new Mesh(kit.geo.sphere, m);
  ball.scale.setScalar(r);
  ball.position.z = r * 0.8;
  ball.rotation.x = 0.45;
  const airMat = kit.keep(kit.glow("#9fc4ff").clone());
  const air = new Mesh(kit.geo.quad, airMat);
  air.scale.set(r * 3.2, r * 3.2, 1);
  air.position.z = 1;
  root.add(air, ball);
  at(root, x, y, 0);
  return {
    root,
    sync(f) {
      if (moving) at(root, moving.x, moving.y, 0);
      ball.rotation.y = f.time * 0.3;
      const k = hit(f);
      m.emissive.set("#ffffff").multiplyScalar(k * 0.5);
      airMat.color.set("#7fb2ff").multiplyScalar(0.3 + k);
    },
  };
};

export const spaceDeck: DeckSkin = {
  colors: SPACE_DECK_COLORS,
  background(g, geo) {
    const U = geo.U;
    paintSpace(g, geo.W, geo.H, 7, {
      scale: U / 14,
      stars: Math.round((geo.W * geo.H) / (U * U * 2.4)),
    });
    // Neon marks under the pieces: the moons' orbit round the star, the comet's track.
    const cl = geo.cluster;
    neonRing(g, cl.x, cl.y, cl.radius, "#5fd4ff", U * 0.12, U * 0.7);
    const sh = geo.shuttle;
    g.strokeStyle = withAlpha("#9fe8ff", 0.35);
    g.lineWidth = U * 0.18;
    g.setLineDash([U * 0.5, U * 0.9]);
    g.beginPath();
    g.moveTo(sh.x0, sh.y);
    g.lineTo(sh.x1, sh.y);
    g.stroke();
    g.setLineDash([]);
  },
  pops(kit, cs) {
    // Small planets, instanced by their colouring, turning; their air flares when hit.
    const A = assets(kit);
    const hues = A.planets.map((mat, h) => {
      const mine = cs.map((c, i) => ({ c, i })).filter((x) => x.i % A.planets.length === h);
      const m = instances(kit.geo.sphere, mat, Math.max(1, mine.length));
      m.count = mine.length;
      return { m, mine };
    });
    const air = instances(kit.geo.quad, kit.glow("#ffffff"), Math.max(1, cs.length));
    cs.forEach((c, i) => place(air, i, c.x, c.y, 1, c.r * 3.2, c.r * 3.2, 1));
    air.count = cs.length;
    const root = new Group();
    root.add(air, ...hues.map((x) => x.m));
    const blue = new Color("#7fb2ff");
    const tilt = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.45);
    const spin = new Quaternion();
    const y = new Vector3(0, 1, 0);
    const m4 = new Matrix4();
    const pos = new Vector3();
    const size = new Vector3();
    return {
      root,
      sync(f) {
        spin.setFromAxisAngle(y, f.time * 0.3).premultiply(tilt);
        for (const { m, mine } of hues) {
          mine.forEach(({ c }, k) => {
            m.setMatrixAt(
              k,
              m4.compose(pos.set(c.x, -c.y, c.r * 0.8), spin, size.set(c.r, c.r, c.r)),
            );
          });
          m.instanceMatrix.needsUpdate = true;
        }
        cs.forEach((_, i) =>
          air.setColorAt(i, tmp.copy(blue).multiplyScalar(0.3 + f.flash("bumper", i))),
        );
        dirty(air);
      },
    };
  },
  cluster: (kit, c, i) =>
    planetPart(kit, c.x, c.y, c.r, assets(kit).moon, (f) => f.flash("cluster", i, 0.2), c),
  shuttle(kit, geo) {
    // A comet: an icy head with a tail streaming away from where it is going.
    const c = geo.shuttle.bumper;
    const root = new Group();
    const head = new Mesh(
      kit.geo.sphere,
      kit.phong("#e8f6ff", { emissive: "#3a6a8a", shininess: 120 }),
    );
    head.scale.setScalar(c.r);
    head.position.z = c.r * 0.8;
    const tailMat = kit.keep(kit.glow("#9fe8ff").clone());
    const tail = new Mesh(kit.geo.quad, tailMat);
    const coma = new Mesh(kit.geo.quad, kit.glow("#cff4ff"));
    coma.scale.set(c.r * 4, c.r * 4, 1);
    coma.position.z = 1;
    root.add(tail, coma, head);
    let lastX = c.x;
    return {
      root,
      sync(f) {
        at(root, c.x, c.y, 0);
        const v = c.x - lastX;
        lastX = c.x;
        const len = c.r * (5 + Math.min(6, Math.abs(v) * 0.6));
        tail.scale.set(len, c.r * 1.8, 1);
        tail.position.set((v >= 0 ? -1 : 1) * len * 0.42, 0, 0.8);
        const k = f.flash("shuttle", 0, 0.2);
        tailMat.color.set("#9fe8ff").multiplyScalar(0.6 + 0.6 * k);
      },
    };
  },
  big(kit, geo, col) {
    // A star: its colour by level, a corona that breathes, a flare when it bursts.
    const c = geo.big;
    const U = geo.U;
    const root = new Group();
    const coreMat = kit.keep(new MeshBasicMaterial({ color: col.big[0] }));
    const core = new Mesh(kit.geo.sphere, coreMat);
    const coronaMat = kit.keep(kit.glow("#ffffff").clone());
    const corona = new Mesh(kit.geo.quad, coronaMat);
    const flareMat = kit.keep(kit.glow("#ffffff").clone());
    const flare = new Mesh(kit.geo.quad, flareMat);
    const rays = new Group();
    for (let i = 0; i < 4; i++) {
      const ray = new Mesh(kit.geo.quad, flareMat);
      ray.scale.set(1, 0.08, 1);
      ray.rotation.z = (i * Math.PI) / 4;
      rays.add(ray);
    }
    const lamps = Array.from({ length: 6 }, (_, i) => {
      const mat = kit.keep(new MeshBasicMaterial({ color: "#3a4060" }));
      const m = new Mesh(kit.geo.sphere, mat);
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 6;
      m.userData.a = a;
      root.add(m);
      return { m, mat };
    });
    root.add(corona, flare, rays, core);
    at(root, c.x, c.y, 0);
    return {
      root,
      sync(f) {
        const big = f.deck.parts.big;
        const color = col.big[big.level] ?? col.big[0];
        const r = c.r;
        core.scale.setScalar(r);
        core.position.z = r * 0.8;
        const hit = f.flash("big", 0, 0.2);
        const burst = f.flash("burst", 0, 0.9);
        coreMat.color.set(hit > 0 ? "#ffffff" : color);
        const breathe = 1 + 0.06 * Math.sin(f.time * 2.2);
        const cr = r * (3.4 + burst * 4) * breathe;
        corona.scale.set(cr, cr, 1);
        corona.position.z = 1;
        coronaMat.color.set(color).multiplyScalar(0.7 + 0.5 * hit + burst);
        flare.visible = burst > 0;
        rays.visible = burst > 0;
        const fr = r * (2 + 10 * (1 - burst));
        flare.scale.set(fr, fr, 1);
        rays.scale.set(fr * 2.2, fr * 2.2, 1);
        rays.position.z = r * 2;
        flare.position.z = r * 2;
        flareMat.color.set("#ffffff").multiplyScalar(burst);
        const lit = big.hits % 6;
        lamps.forEach(({ m, mat }, i) => {
          const a = (m.userData.a as number) + f.time * 0.4;
          m.position.set(Math.cos(a) * r * 1.5, -Math.sin(a) * r * 1.5, r * 0.6);
          m.scale.setScalar(U * 0.26);
          mat.color.set(i < lit ? color : "#2a3050");
        });
      },
    };
  },
  mushrooms(kit, cs) {
    // Asteroids, instanced, tumbling slowly; one glows when hit.
    const A = assets(kit);
    const rocks = instances(A.rock, A.rockMat, Math.max(1, cs.length));
    rocks.count = cs.length;
    const grey = new Color("#ffffff");
    const hot = new Color("#ffd2a0");
    const q = new Quaternion();
    const z = new Vector3(0, 0, 1);
    const m4 = new Matrix4();
    const pos = new Vector3();
    const size = new Vector3();
    return {
      root: rocks,
      sync(f) {
        cs.forEach((c, i) => {
          q.setFromAxisAngle(z, f.time * 0.2 + i);
          rocks.setMatrixAt(
            i,
            m4.compose(pos.set(c.x, -c.y, c.r * 0.5), q, size.set(c.r * 1.1, c.r, c.r * 0.8)),
          );
          rocks.setColorAt(i, tmp.copy(grey).lerp(hot, f.flash("mushroom", i)));
        });
        rocks.instanceMatrix.needsUpdate = true;
        dirty(rocks);
      },
    };
  },
  magnet(kit, spec, i, col) {
    // A black hole: a turning disc of light round a dark middle, brighter as it charges.
    const A = assets(kit);
    const root = new Group();
    const disc = new Mesh(kit.geo.quad, A.swirl);
    disc.scale.set(spec.r * 2.8, spec.r * 2.8, 1);
    disc.position.z = 1;
    const lensMat = kit.keep(kit.basic(col.magnet, { additive: true }).clone());
    const lens = new Mesh(A.torus, lensMat);
    lens.scale.setScalar(spec.r * 0.5);
    lens.position.z = 2;
    root.add(disc, lens);
    at(root, spec.x, spec.y, 0);
    let spin = 0;
    let last = 0;
    return {
      root,
      sync(f) {
        const mg = f.deck.parts.magnets[i];
        const holding = (mg?.held.length ?? 0) > 0;
        const charge = holding && mg ? Math.min(1, (f.now - mg.since) / 1100) : 0;
        const dt = Math.max(0, Math.min(0.1, f.time - last));
        last = f.time;
        spin = (spin + (1 + charge * 5) * dt) % (Math.PI * 2);
        disc.rotation.z = -spin;
        lensMat.color
          .set(col.magnet)
          .multiplyScalar(0.3 + 0.9 * charge + f.flash(`magnet${i}`, 0, 0.5));
      },
    };
  },
  saucer(kit, s, i, col) {
    const A = assets(kit);
    const base = plainDeck.saucer(kit, s, i, col);
    const crater = new Mesh(kit.geo.quad, A.crater(col.saucer));
    crater.scale.set(s.r * 2.6, s.r * 2.6, 1);
    at(crater, s.x, s.y, 1.2);
    crater.userData.static = true;
    const root = new Group();
    root.add(base.root, crater);
    return { root, sync: base.sync };
  },
  scoop(kit, v, col) {
    const A = assets(kit);
    const base = plainDeck.scoop(kit, v, col);
    const crater = new Mesh(kit.geo.quad, A.crater(col.scoop));
    crater.scale.set(v.r * 2.6, v.r * 2.6, 1);
    at(crater, v.x, v.y, 1.2);
    crater.userData.static = true;
    const root = new Group();
    root.add(base.root, crater);
    return { root, sync: base.sync };
  },
  lock(kit, l, U, col) {
    // The lock's tube inside a launch gantry: two lattice towers either side.
    const base = plainDeck.lock(kit, l, U, col);
    const root = new Group();
    root.add(base.root);
    const gantry = new Group();
    gantry.userData.static = true;
    root.add(gantry);
    const h = l.bottom - l.top + U * 2;
    for (const side of [-1, 1]) {
      const x = l.x + side * U * 1.8;
      const post = new Mesh(kit.geo.box, kit.mat.metal);
      post.scale.set(U * 0.25, h, U * 0.25);
      at(post, x, (l.top + l.bottom) / 2, U * 1.2);
      gantry.add(post);
      for (let y = l.top; y < l.bottom; y += U * 1.2) {
        const brace = new Mesh(kit.geo.box, kit.mat.metal);
        brace.scale.set(U * 0.12, U * 1.4, U * 0.12);
        brace.rotation.z = side * 0.6;
        at(brace, x + side * U * 0.2, y + U * 0.6, U * 1.4);
        gantry.add(brace);
      }
    }
    return { root, sync: base.sync };
  },
  nest(kit, n, U, col) {
    // A docking ring over the nest, turning, with lights round it.
    const base = plainDeck.nest(kit, n, U, col);
    const A = assets(kit);
    const ring = new Mesh(A.torus, kit.phong("#cfe6ff", { emissive: "#1a2a40", shininess: 120 }));
    const lights = new Mesh(A.torus, kit.basic("#6cf7ff", { additive: true }));
    const root = new Group();
    root.add(base.root, ring, lights);
    return {
      root,
      sync(f) {
        base.sync?.(f);
        const nest = f.deck.parts.nest;
        const r = nest.width * 0.55;
        ring.scale.set(r, r * 0.3, r * 0.3);
        lights.scale.set(r * 1.03, r * 0.31, r * 0.3);
        at(ring, nest.x, n.y - n.depth * 0.4, U);
        at(lights, nest.x, n.y - n.depth * 0.4, U * 1.1);
        lights.visible = Math.sin(f.time * 3) > -0.3;
      },
      dispose: base.dispose,
    };
  },
  bubble(kit, _kind, icon) {
    // A capsule with the gift inside.
    const A = assets(kit);
    const g = new Group();
    const shell = new Mesh(A.capsule, kit.phong("#d8f0ff", { opacity: 0.35, shininess: 140 }));
    shell.rotation.z = Math.PI / 2;
    const face = new Mesh(kit.geo.quad, icon);
    face.scale.set(1.05, 1.05, 1);
    face.position.z = 0.6;
    g.add(shell, face);
    return g;
  },
};
