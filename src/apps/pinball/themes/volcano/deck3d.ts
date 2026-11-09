/**
 * Volcano's skin for the upper deck: dark basalt with lava cracks, pop bumpers as cracked boulders,
 * the big bumper as a volcano that glows hotter by level and erupts when it bursts, the cluster as
 * glowing lava bombs, the shuttle as a little three-horned dinosaur running to and fro, mushrooms
 * as cycads, star rollovers as dinosaur footprints, magnets as lava whirlpools, saucers and the
 * scoop as craters, the lock in a cave of boulders, eggs in the nest, and gift bubbles of steam.
 */
import {
  type BufferGeometry,
  Color,
  DoubleSide,
  Group,
  type InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  Quaternion,
  Shape,
  ShapeGeometry,
  Vector3,
} from "three";
import { withAlpha } from "../../../../core/ui/palette";
import type { DeckColors, DeckSkin } from "../../view3d/deckparts3d";
import { dirty, instances, place, plainDeck } from "../../view3d/deckparts3d";
import { at, extrudeGeometry, type Kit, railsGeometry } from "../../view3d/kit";
import {
  fernSilhouette,
  lavaLine,
  paintCone,
  paintCrater,
  paintEgg,
  paintLava,
  paintMagma,
  paintRock,
  paintWhirl,
  stream,
  wander,
} from "./art";
import {
  boulderGeometry,
  coneGeometry,
  createParticles,
  eggHalfGeometry,
  fernGeometry,
  type Particles,
  trikeGeometry,
} from "./models";

export const VOLCANO_DECK_COLORS: Partial<DeckColors> = {
  pop: "#ff7a2a",
  big: ["#ff8a3d", "#ff4a1a", "#ffe07a"],
  cluster: "#ff6a1a",
  shuttle: "#4fc2c0",
  mushroom: "#7ad06a",
  sling: "#ff6a3d",
  magnet: "#ff6a1a",
  saucer: "#ffb347",
  scoop: "#ff8a3d",
  lock: "#ffb347",
  nest: "#a8743e",
  glass: "#ffc890",
  rail: "#c8b8aa",
  star: "#ffd8a8",
};

const LAVA = "#ff7a1a";

interface Assets {
  boulder: BufferGeometry;
  magma: MeshPhongMaterial;
  bomb: MeshPhongMaterial;
  cone: BufferGeometry;
  coneMat: MeshPhongMaterial;
  pool: MeshBasicMaterial;
  trike: BufferGeometry;
  painted: MeshPhongMaterial;
  fern: BufferGeometry;
  fernMat: MeshPhongMaterial;
  footprint: BufferGeometry;
  whirl: MeshBasicMaterial;
  crater: (glow: string) => MeshBasicMaterial;
  eggs: BufferGeometry[];
  eggMat: MeshPhongMaterial;
}

const cache = new WeakMap<Kit, Assets>();
const tmp = new Color();
const m4 = new Matrix4();
const q = new Quaternion();
const pos = new Vector3();
const size = new Vector3();
const Z = new Vector3(0, 0, 1);
const WHITE = new Color("#ffffff");

/** The cone's shape at a rim of 1: its base, rim, top and lava, as shares of the bumper's radius. */
const CONE = { base: 1.95, rim: 0.66, top: 1.6, lava: 1.28 };

const footprintShapes = () => {
  const pad = new Shape();
  pad.absellipse(0, -0.25, 0.42, 0.5, 0, Math.PI * 2, false, 0);
  const toes = [-0.55, 0, 0.55].map((a) => {
    const t = new Shape();
    t.absellipse(Math.sin(a) * 0.62, Math.cos(a) * 0.45, 0.17, 0.42, 0, Math.PI * 2, false, a);
    return t;
  });
  return [pad, ...toes];
};

const assets = (kit: Kit): Assets => {
  const have = cache.get(kit);
  if (have) return have;
  const craters = new Map<string, MeshBasicMaterial>();
  const a: Assets = {
    boulder: kit.keep(boulderGeometry(13, 1, 0.4)),
    magma: kit.keep(
      new MeshPhongMaterial({
        map: kit.paint(256, 128, (g) => paintMagma(g, 256, 128, 4, false)),
        emissiveMap: kit.paint(256, 128, (g) => paintMagma(g, 256, 128, 4, true)),
        emissive: "#ff8a2a",
        emissiveIntensity: 0.9,
        shininess: 10,
        flatShading: true,
      }),
    ),
    bomb: (() => {
      // Molten all over, with dark crust: the lava itself glowing.
      const lava = kit.paint(128, 128, (g) => paintLava(g, 128, 128, 15));
      return kit.keep(
        new MeshPhongMaterial({
          color: "#ffffff",
          map: lava,
          emissiveMap: lava,
          emissive: "#ff9a4a",
          emissiveIntensity: 0.9,
          shininess: 30,
          flatShading: true,
        }),
      );
    })(),
    cone: kit.keep(coneGeometry(CONE.base, CONE.rim, CONE.top, CONE.lava)),
    coneMat: kit.keep(
      new MeshPhongMaterial({
        map: kit.paint(512, 256, (g) => paintCone(g, 512, 256, 33, false)),
        emissiveMap: kit.paint(512, 256, (g) => paintCone(g, 512, 256, 33, true)),
        emissive: "#ff8a2a",
        emissiveIntensity: 0.8,
        shininess: 14,
        specular: "#4a3a30",
      }),
    ),
    pool: kit.keep(
      new MeshBasicMaterial({ map: kit.paint(128, 128, (g) => paintLava(g, 128, 128, 12)) }),
    ),
    trike: kit.keep(trikeGeometry("#4fc2c0", "#ff9a5a")),
    painted: kit.keep(
      new MeshPhongMaterial({ vertexColors: true, shininess: 40, specular: "#666666" }),
    ),
    fern: kit.keep(fernGeometry(19, 1 / 60)),
    fernMat: kit.keep(
      new MeshPhongMaterial({ vertexColors: true, shininess: 20, side: DoubleSide }),
    ),
    footprint: kit.keep(new ShapeGeometry(footprintShapes(), 10)),
    whirl: kit.keep(
      new MeshBasicMaterial({
        map: kit.paint(256, 256, (g) => paintWhirl(g, 256)),
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
    eggs: [kit.keep(eggHalfGeometry(1.4, 0.48, 1)), kit.keep(eggHalfGeometry(1.4, 0.48, -1))],
    eggMat: kit.keep(
      new MeshPhongMaterial({
        map: kit.paint(128, 64, (g) => paintEgg(g, 128, 64, 6)),
        shininess: 22,
        side: DoubleSide,
      }),
    ),
  };
  cache.set(kit, a);
  return a;
};

/** Sparks and smoke for the big volcano, in deck px scaled to the deck's unit: one pool. */
const pools = (kit: Kit, U: number): { sparks: Emitter; smoke: Emitter; fx: Particles } => {
  const k = U / 36;
  const fx = createParticles(kit.geo.quad, kit.glow("#ffffff"), 84, [
    { gravity: 2400 * k, drag: 0.5, grow: -0.6, fade: 1 },
    { gravity: -60 * k, drag: 0.8, grow: 2, fade: 1.4 },
  ]);
  return {
    fx,
    sparks: { emit: (...a) => fx.emit(0, ...a) },
    smoke: { emit: (...a) => fx.emit(1, ...a) },
  };
};

type Emitter = {
  emit(
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
};

const SPARK = new Color("#ffb347");
const EMBER = new Color("#ff5a1a");
const ASH = new Color("#a07060");

export const volcanoDeck: DeckSkin = {
  colors: VOLCANO_DECK_COLORS,
  background(g, geo) {
    const U = geo.U;
    const rnd = stream(77);
    paintRock(g, geo.W, geo.H, 9, { scale: U / 12 });
    // Lava cracks across the rock, and a warm glow round the volcano.
    for (let i = 0; i < 10; i++) {
      const a = { x: rnd() * geo.W, y: geo.ceiling + rnd() * (geo.edgeY - geo.ceiling) * 0.85 };
      const ang = rnd() * Math.PI * 2;
      const len = U * (6 + rnd() * 12);
      const b = { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
      lavaLine(g, wander(a, b, 12, U * 0.8, rnd), U * (0.08 + rnd() * 0.1));
    }
    const c = geo.big;
    const glow = g.createRadialGradient(c.x, c.y, c.r, c.x, c.y, c.r * 6);
    glow.addColorStop(0, withAlpha("#ff5a1a", 0.35));
    glow.addColorStop(1, withAlpha("#ff5a1a", 0));
    g.fillStyle = glow;
    g.fillRect(c.x - c.r * 6, c.y - c.r * 6, c.r * 12, c.r * 12);
    // Ferns along the side walls.
    for (let i = 0; i < 8; i++) {
      const left = i % 2 === 0;
      const y = geo.ceiling + (geo.edgeY - geo.ceiling) * (0.2 + 0.6 * rnd());
      fernSilhouette(
        g,
        left ? U * 1.2 : geo.W - U * 1.2,
        y,
        (left ? 0 : Math.PI) + (rnd() - 0.5) * 1.2,
        U * (3 + rnd() * 2),
        withAlpha("#1e4a26", 0.7),
      );
    }
  },
  pops(kit, cs) {
    // Cracked boulders, instanced, with a glow under each that flares when hit.
    const A = assets(kit);
    const n = Math.max(1, cs.length);
    const rocks = instances(A.boulder, A.magma, n);
    const halo = instances(kit.geo.quad, kit.glow("#ffffff"), n);
    cs.forEach((c, i) => {
      m4.compose(
        pos.set(c.x, -c.y, c.r * 0.72),
        q.setFromAxisAngle(Z, i * 1.9),
        size.set(c.r * 1.08, c.r * 1.0, c.r * 0.82),
      );
      rocks.setMatrixAt(i, m4);
      place(halo, i, c.x, c.y, 1, c.r * 3.4, c.r * 3.4, 1);
    });
    rocks.count = halo.count = cs.length;
    const root = new Group();
    root.add(halo, rocks);
    const lava = new Color(LAVA);
    const hot = new Color("#ffd27a").multiplyScalar(1.6);
    const base = new Color("#ffffff");
    return {
      root,
      sync(f) {
        cs.forEach((_, i) => {
          const k = f.flash("bumper", i);
          rocks.setColorAt(i, tmp.copy(base).lerp(hot, k));
          halo.setColorAt(i, tmp.copy(lava).multiplyScalar(0.2 + 0.7 * k));
        });
        dirty(rocks, halo);
      },
      dispose() {
        rocks.dispose();
        halo.dispose();
      },
    };
  },
  big(kit, geo, col) {
    // A volcano: hotter by level, rumbling when hit, erupting in sparks and ash when it bursts.
    const A = assets(kit);
    const c = geo.big;
    const U = geo.U;
    const root = new Group();
    const body = new Group();
    const coneMat = kit.keep(A.coneMat.clone());
    const cone = new Mesh(A.cone, coneMat);
    const poolMat = kit.keep(A.pool.clone());
    const pool = new Mesh(kit.geo.disc, poolMat);
    const glowMat = kit.keep(kit.glow("#ffffff").clone());
    const glow = new Mesh(kit.geo.quad, glowMat);
    body.add(cone, pool, glow);
    // Six stones round its foot light up with the hits towards the next level.
    const stones = instances(A.boulder, kit.phong("#ffffff", { emissive: "#000000" }), 6);
    const { sparks, smoke, fx } = pools(kit, U);
    fx.mesh.renderOrder = 5;
    root.add(body, stones, fx.mesh);
    const rnd = stream(5);
    const lit = new Color();
    const off = new Color("#4a3a32");
    let lastBurst = Infinity;
    let lastHit = Infinity;
    let last = 0;
    let puffAt = 0;
    const burst = (r: number, n: number, speed: number, puffs: number, big: number) => {
      const top = r * CONE.lava + U * 0.2;
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2;
        const s = rnd() * speed * 0.5;
        sparks.emit(
          c.x + Math.cos(a) * r * 0.3,
          c.y + Math.sin(a) * r * 0.3,
          top,
          Math.cos(a) * s,
          Math.sin(a) * s,
          speed * (0.6 + rnd() * 0.6),
          0.7 + rnd() * 0.8,
          U * (0.55 + rnd() * 0.65) * big,
          rnd() > 0.4 ? SPARK : EMBER,
        );
      }
      for (let i = 0; i < puffs; i++) {
        smoke.emit(
          c.x + (rnd() - 0.5) * r,
          c.y + (rnd() - 0.5) * r,
          top + U,
          (rnd() - 0.5) * U * 2,
          -U * (0.5 + rnd()),
          U * (2 + rnd() * 3),
          1.8 + rnd() * 1.2,
          U * (1.6 + rnd()) * big,
          tmp.copy(ASH).multiplyScalar(0.55),
        );
      }
    };
    return {
      root,
      sync(f) {
        const dt = Math.max(0, Math.min(0.1, f.time - last));
        last = f.time;
        const big = f.deck.parts.big;
        const color = col.big[big.level] ?? col.big[0];
        const r = c.r;
        const hit = f.flash("big", 0, 0.3);
        const bursting = f.flash("burst", 0, 1.2);
        const shake = U * 0.12 * (hit + 2 * bursting);
        at(body, c.x + Math.sin(f.time * 61) * shake, c.y + Math.cos(f.time * 47) * shake, 0);
        cone.scale.setScalar(r);
        pool.scale.set(r * (CONE.rim - 0.08), r * (CONE.rim - 0.08), 1);
        pool.position.z = r * CONE.lava;
        pool.rotation.z = f.time * 0.2;
        const heat = (big.hits % 6) / 6;
        coneMat.emissiveIntensity = 0.5 + 0.5 * heat + 0.6 * hit + bursting;
        poolMat.color.set(color).lerp(WHITE, 0.35 + 0.4 * hit);
        glow.position.z = r * CONE.lava + 1;
        const gr = r * (2.2 + heat + 2.5 * bursting);
        glow.scale.set(gr, gr, 1);
        glowMat.color.set(color).multiplyScalar(0.35 + 0.4 * heat + 0.5 * hit + bursting);
        for (let i = 0; i < 6; i++) {
          const a = -Math.PI / 2 + (i * Math.PI * 2) / 6;
          m4.compose(
            pos.set(c.x + Math.cos(a) * r * 1.55, -(c.y + Math.sin(a) * r * 1.55), U * 0.25),
            q.setFromAxisAngle(Z, i),
            size.set(U * 0.42, U * 0.36, U * 0.3),
          );
          stones.setMatrixAt(i, m4);
          stones.setColorAt(i, i < big.hits % 6 ? lit.set(color).multiplyScalar(1.4) : off);
        }
        stones.instanceMatrix.needsUpdate = true;
        dirty(stones);
        // A new burst erupts; a hit throws a few sparks; it smokes gently all the time.
        const burstAge = f.deck.flashAge("burst", 0);
        if (burstAge < lastBurst) burst(r, 48, U * 26, 10, 1.4);
        lastBurst = burstAge;
        const hitAge = f.deck.flashAge("big", 0);
        if (hitAge < lastHit) burst(r, 5, U * 14, 0, 0.8);
        lastHit = hitAge;
        if (f.time >= puffAt) {
          puffAt = f.time + 1.1;
          burst(r, 0, 0, 1, 0.8);
        }
        fx.update(dt);
      },
      dispose() {
        stones.dispose();
        fx.mesh.dispose();
      },
    };
  },
  cluster(kit, c, i) {
    // A glowing lava bomb, tumbling as it goes round.
    const A = assets(kit);
    const root = new Group();
    const rock = new Mesh(A.boulder, A.bomb);
    rock.position.z = c.r * 0.8;
    const haloMat = kit.keep(kit.glow(LAVA).clone());
    const halo = new Mesh(kit.geo.quad, haloMat);
    halo.position.z = 1;
    root.add(halo, rock);
    return {
      root,
      sync(f) {
        at(root, c.x, c.y, 0);
        rock.scale.setScalar(c.r * 1.05);
        rock.rotation.set(f.time * 0.9 + i, f.time * 0.6, i);
        const k = f.flash("cluster", i, 0.25);
        const hr = c.r * (3.6 + 1.5 * k);
        halo.scale.set(hr, hr, 1);
        haloMat.color.set(LAVA).multiplyScalar(0.7 + 0.6 * k);
      },
    };
  },
  shuttle(kit, geo) {
    // A little three-horned dinosaur trotting to and fro along its track.
    const A = assets(kit);
    const c = geo.shuttle.bumper;
    const root = new Group();
    const mat = kit.keep(A.painted.clone());
    const dino = new Mesh(A.trike, mat);
    const shadow = new Mesh(kit.geo.quad, kit.mat.shadow);
    root.add(shadow, dino);
    let lastX = c.x;
    let facing = 1;
    return {
      root,
      sync(f) {
        const v = c.x - lastX;
        lastX = c.x;
        if (Math.abs(v) > 0.01) facing = v > 0 ? 1 : -1;
        at(root, c.x, c.y, 0);
        const trot = Math.abs(Math.sin(f.time * 9)) * c.r * 0.12;
        dino.scale.set(c.r * facing, c.r, c.r);
        dino.position.set(0, 0, trot);
        shadow.scale.set(c.r * 3.4, c.r * 2.4, 1);
        shadow.position.z = 0.5;
        const k = f.flash("shuttle", 0, 0.25);
        mat.emissive.set("#ffffff").multiplyScalar(0.35 * k);
      },
    };
  },
  mushrooms(kit, cs) {
    // Cycads: a stout trunk under a crown of fronds that brightens when hit.
    const A = assets(kit);
    const n = Math.max(1, cs.length);
    const trunks = instances(kit.geo.cylinder, kit.phong("#6a4a2e", { shininess: 10 }), n);
    const crowns = instances(A.fern, A.fernMat, n);
    cs.forEach((c, i) => {
      place(trunks, i, c.x, c.y, 0, c.r * 0.5, c.r * 0.5, c.r * 0.7);
      m4.compose(
        pos.set(c.x, -c.y, c.r * 0.55),
        q.setFromAxisAngle(Z, i * 0.8),
        size.set(c.r * 1.8, c.r * 1.8, c.r * 1.3),
      );
      crowns.setMatrixAt(i, m4);
    });
    trunks.count = crowns.count = cs.length;
    trunks.userData.static = true;
    const root = new Group();
    root.add(trunks, crowns);
    const base = new Color("#ffffff");
    const hot = new Color("#ffffa0").multiplyScalar(1.5);
    return {
      root,
      sync(f) {
        cs.forEach((_, i) =>
          crowns.setColorAt(i, tmp.copy(base).lerp(hot, f.flash("mushroom", i))),
        );
        dirty(crowns);
      },
      dispose() {
        trunks.dispose();
        crowns.dispose();
      },
    };
  },
  sling(kit, s, i) {
    // A slab of rock with a lava face that flares when it kicks.
    const root = new Group();
    const body = new Mesh(
      kit.keep(extrudeGeometry(s.pts, s.face.r * 6, 2)),
      kit.phong("#4a3a32", { shininess: 10 }),
    );
    body.userData.static = true;
    root.add(body);
    const mat = kit.keep(new MeshPhongMaterial({ color: "#5a2a14", emissive: "#000000" }));
    const face = railsGeometry([s.face], s.face.r * 7, 1);
    if (face) root.add(new Mesh(kit.keep(face), mat));
    return {
      root,
      sync(f) {
        mat.emissive.set(LAVA).multiplyScalar(0.45 + 0.8 * f.flash("sling", i));
      },
    };
  },
  stars(kit, rs, col) {
    // Footprints, lit in the colour of the last ball over them.
    const A = assets(kit);
    const n = Math.max(1, rs.length);
    const mesh = instances(A.footprint, kit.basic("#ffffff"), n);
    rs.forEach((r, i) =>
      place(mesh, i, r.x, r.y, 0.6, r.r * 0.9, r.r * 0.9, 1, i % 2 ? 0.25 : -0.25),
    );
    mesh.count = rs.length;
    const base = new Color("#5a463c");
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
      dispose() {
        mesh.dispose();
      },
    };
  },
  magnet(kit, spec, i, col) {
    // A lava whirlpool in a ring of stones: it turns faster and glows as it charges.
    const A = assets(kit);
    const root = new Group();
    const disc = new Mesh(kit.geo.quad, A.whirl);
    disc.scale.set(spec.r * 2.5, spec.r * 2.5, 1);
    disc.position.z = 1;
    const glowMat = kit.keep(kit.glow(col.magnet).clone());
    const glow = new Mesh(kit.geo.quad, glowMat);
    glow.scale.set(spec.r * 3.6, spec.r * 3.6, 1);
    glow.position.z = 1.5;
    const ring = new Group();
    ring.userData.static = true;
    const stone = kit.phong("#5a463c", { shininess: 8 });
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      const m = new Mesh(A.boulder, stone);
      m.scale.set(spec.r * 0.22, spec.r * 0.18, spec.r * 0.16);
      m.position.set(Math.cos(a) * spec.r * 1.3, Math.sin(a) * spec.r * 1.3, spec.r * 0.08);
      m.rotation.z = a;
      ring.add(m);
    }
    root.add(ring, disc, glow);
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
        spin = (spin + (0.8 + charge * 6) * dt) % (Math.PI * 2);
        disc.rotation.z = -spin;
        glowMat.color
          .set(col.magnet)
          .multiplyScalar(0.25 + 0.8 * charge + 0.5 * f.flash(`magnet${i}`, 0, 0.5));
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
    // The lock's tube in a cave: boulders piled either side and across the top.
    const A = assets(kit);
    const base = plainDeck.lock(kit, l, U, col);
    const root = new Group();
    root.add(base.root);
    const cave = new Group();
    cave.userData.static = true;
    root.add(cave);
    const stone = kit.phong("#5a463c", { shininess: 8 });
    const rnd = stream(3);
    for (const side of [-1, 1]) {
      for (let y = l.top - U * 0.6; y < l.bottom + U * 0.6; y += U * 1.3) {
        const m = new Mesh(A.boulder, stone);
        const r = U * (0.75 + rnd() * 0.35);
        m.scale.set(r, r * 0.9, r * 0.8);
        m.rotation.z = rnd() * 3;
        at(m, l.x + side * U * (2.1 + rnd() * 0.3), y, r * 0.5);
        cave.add(m);
      }
    }
    for (let k = -1; k <= 1; k++) {
      const m = new Mesh(A.boulder, stone);
      m.scale.set(U * 1.1, U * 0.8, U * 0.7);
      m.rotation.z = k;
      at(m, l.x + k * U * 1.2, l.top - U * 0.9, U * 0.6);
      cave.add(m);
    }
    return { root, sync: base.sync };
  },
  nest(kit, n, U, col) {
    // The plain nest in twig brown, with an egg resting at each end of its rim.
    const A = assets(kit);
    const base = plainDeck.nest(kit, n, U, col);
    const hang = new Group();
    const eggs: InstancedMesh[] = A.eggs.map((g) => instances(g, A.eggMat, 2));
    const shells = ["#c4f2d6", "#e2d2ff"].map((c) => new Color(c));
    for (const m of eggs) {
      shells.forEach((s, i) => m.setColorAt(i, s));
      hang.add(m);
    }
    const root = new Group();
    root.add(base.root, hang);
    return {
      root,
      sync(f) {
        base.sync?.(f);
        const nest = f.deck.parts.nest;
        at(hang, nest.x, n.y, 0);
        hang.rotation.z = -nest.tilt(f.now) * 1.1;
        const w = nest.width;
        for (const m of eggs) {
          for (let i = 0; i < 2; i++) {
            const side = i === 0 ? -1 : 1;
            m4.compose(
              pos.set(side * (w / 2 + U * 0.55), -U * 0.1, U * 0.5),
              q.setFromAxisAngle(Z, side * 1.2),
              size.setScalar(U * 1.1),
            );
            m.setMatrixAt(i, m4);
          }
          m.instanceMatrix.needsUpdate = true;
        }
      },
      dispose() {
        base.dispose?.();
        for (const m of eggs) m.dispose();
      },
    };
  },
  bubble(kit, _kind, icon) {
    // A bubble of steam with the gift inside.
    const g = new Group();
    const shell = new Mesh(kit.geo.sphere, kit.phong("#f4f0ec", { opacity: 0.3, shininess: 120 }));
    const wisp = new Mesh(kit.geo.quad, kit.glow("#d8d0c8"));
    wisp.scale.set(2.6, 2.6, 1);
    wisp.position.z = -0.2;
    const face = new Mesh(kit.geo.quad, icon);
    face.scale.set(1.1, 1.1, 1);
    face.position.z = 1.02;
    g.add(wisp, shell, face);
    return g;
  },
};
