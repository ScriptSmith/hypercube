/**
 * Reef's skin for the upper deck, seen like the glass side of a big tank: open water with light
 * from above and caustics sliding over it, pop bumpers as brain corals, mushrooms as anemones,
 * the big bumper as a big pufferfish that swells by level and puffs right up when it bursts, the
 * cluster as fish swimming round, the shuttle as a crab scuttling to and fro, magnets as
 * whirlpools, saucers in scallop shells, the scoop in a ring of rocks, the lock above a treasure
 * chest that opens for a multiball, the nest as a big shell, reef rock for walls, and gift
 * bubbles that look like air. Rails stay glass tubes.
 */
import {
  BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  Quaternion,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { withAlpha } from "../../../../core/ui/palette";
import type { DeckColors, DeckSkin } from "../../view3d/deckparts3d";
import { dirty, instances, place, plainDeck } from "../../view3d/deckparts3d";
import { at, extrudeGeometry, type Kit, paintedGeometry, railsGeometry } from "../../view3d/kit";
import { paintBrainCoral, paintOpenWater, paintPuffer, paintWhirl, scallop } from "./art";
import { reefAssets } from "./table3d";
import { createBubbles, createCaustics } from "./water";

export const REEF_DECK_COLORS: Partial<DeckColors> = {
  pop: "#ff8fa3",
  big: ["#ffe08a", "#ffb35c", "#ff9ccf"],
  cluster: "#7fd8ff",
  shuttle: "#ff9a5c",
  mushroom: "#c58cff",
  sling: "#ff9e8a",
  magnet: "#5fd6ff",
  saucer: "#e6c8ff",
  scoop: "#7fe6d8",
  lock: "#ffd27a",
  nest: "#ffcfa8",
  glass: "#9fe8ff",
  rail: "#cfe9e6",
  star: "#ffb37a",
  target: "#ffd27a",
};

const CORALS = [
  ["#ff9fb1", "#a34a66"],
  ["#ffb46a", "#a3602a"],
  ["#c09cff", "#6a4aa8"],
  ["#6fdccb", "#2a7a70"],
] as const;
const ANEMONES = ["#ff7fd0", "#b8ff7a", "#ffa65c", "#c58cff", "#7fe6ff"];
const FISH = ["#5fc8ff", "#ffd166", "#b98aff"];

interface DeckAssets {
  corals: MeshPhongMaterial[];
  anemone: BufferGeometry;
  anemoneMat: MeshPhongMaterial;
  bigSkin: MeshPhongMaterial;
  whirl: MeshBasicMaterial;
  foam: TorusGeometry;
  fish: BufferGeometry;
  crab: BufferGeometry;
  claws: BufferGeometry;
  painted: MeshPhongMaterial;
  rock: MeshPhongMaterial;
  coralKnob: MeshPhongMaterial;
  shell: MeshPhongMaterial;
  gold: MeshPhongMaterial;
  wood: MeshPhongMaterial;
}

const cache = new WeakMap<Kit, DeckAssets>();
const tmp = new Color();
const m4 = new Matrix4();
const q = new Quaternion();
const q2 = new Quaternion();
const v = new Vector3();
const v2 = new Vector3();
const s3 = new Vector3();
const Z = new Vector3(0, 0, 1);
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const SIDES = [-1, 1] as const;
const BIG_BEADS = ["#ffad6a", "#ffad6a", "#ffffff", "#ffffff", "#16202a", "#16202a"].map(
  (c) => new Color(c),
);

const ease = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));

/** A sea anemone, radius 1 and about as tall: a short stem with a crown of tentacles. */
const anemoneGeometry = () => {
  const parts: BufferGeometry[] = [];
  const stem = new CylinderGeometry(0.42, 0.5, 0.5, 14);
  stem.rotateX(Math.PI / 2);
  stem.translate(0, 0, 0.25);
  parts.push(stem);
  for (let ring = 0; ring < 2; ring++) {
    const n = ring === 0 ? 12 : 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + ring * 0.3;
      const t = new CapsuleGeometry(0.07, ring === 0 ? 0.55 : 0.42, 3, 6);
      // Lean outwards from the crown's middle.
      t.rotateX(Math.PI / 2);
      t.translate(0, 0, 0.3);
      t.applyQuaternion(
        new Quaternion().setFromAxisAngle(
          new Vector3(-Math.sin(a), Math.cos(a), 0),
          ring === 0 ? 0.9 : 0.45,
        ),
      );
      t.translate(
        Math.cos(a) * (ring === 0 ? 0.38 : 0.2),
        Math.sin(a) * (ring === 0 ? 0.38 : 0.2),
        0.45,
      );
      parts.push(t);
    }
  }
  const nonIndexed = parts.map((p) => {
    const g = p.index ? p.toNonIndexed() : p;
    if (g !== p) p.dispose();
    g.deleteAttribute("uv");
    return g;
  });
  const merged = mergeGeometries(nonIndexed)!;
  for (const p of nonIndexed) p.dispose();
  return merged;
};

/** A fish in profile, nose to +x, about 2 long: body, tail, fins and an eye, in vertex colours. */
const fishGeometry = () => {
  const body = new SphereGeometry(1, 20, 12);
  body.scale(1, 0.62, 0.32);
  const tail = new Shape();
  tail.moveTo(-0.85, 0);
  tail.lineTo(-1.55, 0.55);
  tail.quadraticCurveTo(-1.35, 0, -1.55, -0.55);
  tail.closePath();
  const tailG = new ShapeGeometry(tail);
  const fin = new Shape();
  fin.moveTo(-0.4, 0.45);
  fin.quadraticCurveTo(0, 1.0, 0.35, 0.5);
  fin.closePath();
  const finG = new ShapeGeometry(fin);
  // An eye on each side, since a fish swimming left is seen from its other side.
  const eyes = [1, -1].flatMap((s) => {
    const eye = new SphereGeometry(0.16, 10, 8);
    eye.translate(0.55, 0.15, 0.24 * s);
    const pupil = new SphereGeometry(0.09, 8, 6);
    pupil.translate(0.6, 0.15, 0.33 * s);
    return [
      { geometry: eye, color: "#ffffff" },
      { geometry: pupil, color: "#111111" },
    ];
  });
  const stripe = new SphereGeometry(1.01, 20, 12, Math.PI * 0.42, Math.PI * 0.16);
  stripe.scale(1, 0.62, 0.32);
  return paintedGeometry([
    { geometry: body, color: "#ffffff" },
    { geometry: stripe, color: "#e8f0ff" },
    { geometry: tailG, color: "#ffffff" },
    { geometry: finG, color: "#ffffff" },
    ...eyes,
  ])!;
};

/** A crab seen from in front, about 2 wide: shell, legs and stalked eyes (claws are apart). */
const crabGeometry = () => {
  const shell = new SphereGeometry(1, 20, 12);
  shell.scale(1, 0.62, 0.55);
  const pieces: { geometry: BufferGeometry; color: string; matrix?: Matrix4 }[] = [
    { geometry: shell, color: "#ffffff" },
  ];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const leg = new CapsuleGeometry(0.09, 0.7, 3, 6);
      leg.rotateZ(s * (0.9 + i * 0.25));
      leg.translate(s * (0.95 + i * 0.12), -0.35 - i * 0.12, 0);
      pieces.push({ geometry: leg, color: "#f2f2f2" });
    }
    const stalk = new CapsuleGeometry(0.06, 0.35, 3, 6);
    stalk.translate(s * 0.3, 0.75, 0.25);
    pieces.push({ geometry: stalk, color: "#ffffff" });
    const eye = new SphereGeometry(0.17, 10, 8);
    eye.translate(s * 0.3, 1.02, 0.3);
    pieces.push({ geometry: eye, color: "#ffffff" });
    const pupil = new SphereGeometry(0.1, 8, 6);
    pupil.translate(s * 0.3, 1.02, 0.44);
    pieces.push({ geometry: pupil, color: "#111111" });
  }
  const smile = new TorusGeometry(0.28, 0.05, 5, 12, Math.PI);
  smile.rotateZ(Math.PI);
  smile.translate(0, 0.05, 0.53);
  pieces.push({ geometry: smile, color: "#5a2a2a" });
  return paintedGeometry(pieces)!;
};

/** The crab's two claws, raised. */
const clawGeometry = () => {
  const parts: BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const arm = new CapsuleGeometry(0.11, 0.5, 3, 6);
    arm.rotateZ(s * 0.6);
    arm.translate(s * 1.05, 0.25, 0.1);
    const pincer = new SphereGeometry(0.34, 12, 8);
    pincer.scale(1, 1.2, 0.7);
    pincer.translate(s * 1.3, 0.72, 0.15);
    const nip = new CapsuleGeometry(0.08, 0.3, 3, 6);
    nip.rotateZ(-s * 0.4);
    nip.translate(s * 1.12, 1.02, 0.15);
    parts.push(arm, pincer, nip);
  }
  return paintedGeometry(parts.map((geometry) => ({ geometry, color: "#ffffff" })))!;
};

const deckAssets = (kit: Kit): DeckAssets => {
  const have = cache.get(kit);
  if (have) return have;
  const a: DeckAssets = {
    corals: CORALS.map(([base, groove], i) =>
      kit.keep(
        new MeshPhongMaterial({
          map: kit.paint(192, 96, (g) => paintBrainCoral(g, 192, 96, base, groove, 11 + i)),
          shininess: 18,
        }),
      ),
    ),
    anemone: kit.keep(anemoneGeometry()),
    anemoneMat: kit.keep(new MeshPhongMaterial({ color: "#ffffff", shininess: 50 })),
    bigSkin: kit.keep(
      new MeshPhongMaterial({
        map: kit.paint(256, 128, (g) => paintPuffer(g, 256, 128, 8, "#fff6dc", "#9a8a70")),
        shininess: 40,
        specular: "#666666",
      }),
    ),
    whirl: kit.keep(
      new MeshBasicMaterial({
        map: kit.paint(256, 256, (g) => paintWhirl(g, 256)),
        transparent: true,
        depthWrite: false,
      }),
    ),
    foam: kit.keep(new TorusGeometry(1, 0.07, 8, 48)),
    fish: kit.keep(fishGeometry()),
    crab: kit.keep(crabGeometry()),
    claws: kit.keep(clawGeometry()),
    painted: kit.keep(
      new MeshPhongMaterial({ vertexColors: true, shininess: 70, specular: "#999999" }),
    ),
    rock: kit.keep(new MeshPhongMaterial({ color: "#a08276", shininess: 6, flatShading: true })),
    coralKnob: kit.keep(new MeshPhongMaterial({ color: "#ff9fb1", shininess: 20 })),
    shell: kit.keep(
      new MeshPhongMaterial({ color: "#f1d6f2", shininess: 60, specular: "#888888" }),
    ),
    gold: kit.keep(
      new MeshPhongMaterial({
        color: "#ffcf4a",
        specular: "#fff3c0",
        shininess: 110,
        envMap: kit.env,
        reflectivity: 0.4,
      }),
    ),
    wood: kit.keep(new MeshPhongMaterial({ color: "#7a4a2a", shininess: 10 })),
  };
  cache.set(kit, a);
  return a;
};

/** A deck ball near (x, y), for eyes to watch. */
const nearestBall = (
  balls: readonly { x: number; y: number }[],
  x: number,
  y: number,
  reach: number,
) => {
  let best: { x: number; y: number } | null = null;
  let bd = reach;
  for (const b of balls) {
    const d = Math.hypot(b.x - x, b.y - y);
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
};

export const reefDeck: DeckSkin = {
  colors: REEF_DECK_COLORS,
  background(g, geo) {
    const U = geo.U;
    paintOpenWater(g, geo.W, geo.H, 9, U);
    // A ring of little bubbles round the fish's swim, and crab tracks along the shuttle's run.
    const cl = geo.cluster;
    g.strokeStyle = withAlpha("#c8f6ff", 0.3);
    g.lineWidth = U * 0.1;
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      g.beginPath();
      g.arc(
        cl.x + Math.cos(a) * cl.radius,
        cl.y + Math.sin(a) * cl.radius,
        U * (0.18 + (i % 3) * 0.08),
        0,
        Math.PI * 2,
      );
      g.stroke();
    }
    const sh = geo.shuttle;
    g.fillStyle = withAlpha("#ffe7c4", 0.18);
    for (let x = sh.x0; x <= sh.x1; x += U * 0.9) {
      for (const dy of [-0.5, 0.5]) {
        g.beginPath();
        g.ellipse(
          x,
          sh.y + sh.bumper.r * 1.1 + dy * U * 0.5,
          U * 0.14,
          U * 0.08,
          0.4,
          0,
          Math.PI * 2,
        );
        g.fill();
      }
    }
    // A scallop under each saucer, so the shells sit in a hollow.
    for (const s of geo.saucers)
      scallop(
        g,
        s.x,
        s.y + s.r * 0.2,
        s.r * 1.7,
        "rgba(255,236,214,0.12)",
        "rgba(255,236,214,0.25)",
      );
  },
  pops(kit, cs) {
    // Brain corals, instanced by colour, each with a glow under it that flashes when hit.
    const A = deckAssets(kit);
    const hues = A.corals.map((mat, h) => {
      const mine = cs.map((c, i) => ({ c, i })).filter((x) => x.i % A.corals.length === h);
      const m = instances(kit.geo.sphere, mat, Math.max(1, mine.length));
      mine.forEach(({ c }, k) => {
        q.setFromAxisAngle(Z, c.x * 0.01);
        m.setMatrixAt(
          k,
          m4.compose(v.set(c.x, -c.y, 0), q, s3.set(c.r * 1.05, c.r * 1.05, c.r * 0.85)),
        );
      });
      m.count = mine.length;
      return m;
    });
    const glow = instances(kit.geo.quad, kit.glow("#ffffff"), Math.max(1, cs.length));
    cs.forEach((c, i) => place(glow, i, c.x, c.y, 1, c.r * 3.4, c.r * 3.4, 1));
    glow.count = cs.length;
    const root = new Group();
    root.add(glow, ...hues);
    const base = cs.map((_, i) => new Color(CORALS[i % CORALS.length]![0]));
    return {
      root,
      sync(f) {
        cs.forEach((_, i) =>
          glow.setColorAt(i, tmp.copy(base[i]!).multiplyScalar(0.18 + 0.75 * f.flash("bumper", i))),
        );
        dirty(glow);
      },
    };
  },
  mushrooms(kit, cs) {
    // Anemones, one instanced draw, swaying; a hit one flushes bright.
    const A = deckAssets(kit);
    const m = instances(A.anemone, A.anemoneMat, Math.max(1, cs.length));
    m.count = cs.length;
    const base = cs.map((_, i) => new Color(ANEMONES[i % ANEMONES.length]!));
    return {
      root: m,
      sync(f) {
        cs.forEach((c, i) => {
          const sway = Math.sin(f.time * 1.3 + i * 1.7) * 0.18;
          q.setFromAxisAngle(Z, f.time * 0.15 + i);
          q2.setFromAxisAngle(X, sway);
          q.premultiply(q2);
          const hit = f.flash("mushroom", i);
          const s = c.r * (1.6 + hit * 0.2);
          m.setMatrixAt(i, m4.compose(v.set(c.x, -c.y, 0), q, s3.set(s, s, s * 1.1)));
          m.setColorAt(i, tmp.copy(base[i]!).multiplyScalar(0.85 + hit * 0.9));
        });
        m.instanceMatrix.needsUpdate = true;
        dirty(m);
      },
    };
  },
  big(kit, geo, col) {
    // A big pufferfish: its colour by level, bigger with each, and right up with its spines out
    // when it bursts. Pearls round it count the hits. Also the deck's water: caustics and bubbles.
    const A = deckAssets(kit);
    const T = reefAssets(kit);
    const c = geo.big;
    const U = geo.U;
    const root = new Group();
    const fish = new Group();
    const skin = kit.keep(A.bigSkin.clone());
    const body = new Mesh(kit.geo.sphere, skin);
    const spines = new Mesh(T.spines, T.spineMat);
    // Fins, eyes, pupils and the pearls round it are beads: one instanced draw.
    const beads = instances(kit.geo.sphere, T.beads, 12);
    for (let i = 0; i < 6; i++) beads.setColorAt(i, BIG_BEADS[i]!);
    fish.add(body, spines);
    root.add(fish, beads);
    // The water over the whole deck.
    const sea = new Shape();
    sea.moveTo(0, 0);
    sea.lineTo(geo.W, 0);
    sea.lineTo(geo.W, -geo.H);
    sea.lineTo(0, -geo.H);
    sea.closePath();
    const seaGeo = kit.keep(new ShapeGeometry(sea));
    const caustics = createCaustics(kit, seaGeo, { tile: U * 8, tint: "#1a4c5e", z: 0.5 });
    const bubbles = createBubbles(kit, 36);
    root.add(caustics.mesh, bubbles.mesh);
    const lit = new Color();
    const dark = new Color("#3a4a5a");
    let last = 0;
    let burstSeen = Infinity;
    let rise = 0;
    let seed = 1;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    return {
      root,
      sync(f) {
        const dt = Math.max(0, Math.min(0.1, f.time - last));
        last = f.time;
        const big = f.deck.parts.big;
        const color = col.big[big.level] ?? col.big[0];
        const hit = f.flash("big", 0, 0.25);
        const burst = f.flash("burst", 0, 1.4);
        const puff = Math.max(
          burst > 0 ? ease(Math.min(1, (1 - burst) * 6)) * Math.min(1, burst * 2.5) : 0,
          hit * 0.35,
        );
        const r = c.r * (1 + 0.45 * puff);
        const z = r * 0.85;
        at(fish, c.x, c.y, 0);
        q.setFromAxisAngle(Z, Math.sin(f.time * 1.2) * 0.1 * (1 - puff));
        body.quaternion.copy(q);
        body.scale.set(r * 1.04, r * 0.97, r * 0.92);
        body.position.set(0, 0, z);
        skin.color.set(color).lerp(tmp.set("#ffffff"), 0.25 + hit * 0.5);
        const ss = r * (0.8 + 0.32 * puff);
        spines.quaternion.copy(q);
        spines.position.set(0, 0, z);
        spines.scale.set(ss, ss, ss);
        for (const s of SIDES) {
          const i = s > 0 ? 1 : 0;
          const flap = Math.sin(f.time * (8 + 8 * puff) + i) * 0.5;
          q2.setFromAxisAngle(Y, -s * (0.35 + flap));
          beads.setMatrixAt(
            i,
            m4.compose(
              v.set(c.x + s * r * 0.98, -c.y - r * 0.12, z),
              q2,
              s3.set(r * 0.5, r * 0.32, r * 0.09),
            ),
          );
          const er = r * 0.25 * (1 + 0.3 * puff);
          v2.set(s * 0.42, 0.3, 0.86)
            .normalize()
            .applyQuaternion(q);
          v.set(c.x, -c.y, z).addScaledVector(v2, r * 0.93);
          q2.identity();
          beads.setMatrixAt(2 + i, m4.compose(v, q2, s3.set(er, er, er * 0.8)));
          const ball = nearestBall(f.deck.balls, c.x, c.y, U * 30);
          const look = v2.set(0, 0, 1);
          if (ball) {
            const dx = ball.x - c.x;
            const dy = -(ball.y - c.y);
            const l = Math.hypot(dx, dy) || 1;
            look.set((dx / l) * 0.8, (dy / l) * 0.8, 0.6).normalize();
          }
          const pr = er * (0.55 - 0.2 * puff);
          v.addScaledVector(look, er * 0.62);
          beads.setMatrixAt(4 + i, m4.compose(v, q2, s3.set(pr, pr, pr * 0.7)));
        }
        // Pearls round it, one lit for each hit towards the next level.
        const n = big.hits % 6;
        lit.set(color);
        for (let i = 0; i < 6; i++) {
          const a = -Math.PI / 2 + (i * Math.PI * 2) / 6 + f.time * 0.3;
          place(
            beads,
            6 + i,
            c.x + Math.cos(a) * r * 1.55,
            c.y + Math.sin(a) * r * 1.55,
            U * 0.6,
            U * 0.32,
            U * 0.32,
            U * 0.32,
          );
          beads.setColorAt(6 + i, i < n ? lit : dark);
        }
        beads.instanceMatrix.needsUpdate = true;
        dirty(beads);
        // Water: caustics, bubbles rising from the floor now and then, a cloud when it bursts.
        caustics.sync(f.time);
        rise += dt;
        if (rise > 0.35) {
          rise = 0;
          bubbles.spawn(
            rnd() * geo.W,
            geo.H * (0.75 + rnd() * 0.2),
            U,
            U * (0.25 + rnd() * 0.3),
            0,
            -U * (3 + rnd() * 3),
            0,
            4 + rnd() * 3,
          );
        }
        const burstAt = f.deck.world.t - f.deck.flashAge("burst", 0);
        if (burst > 0 && burstAt !== burstSeen) {
          burstSeen = burstAt;
          for (let i = 0; i < 16; i++) {
            const a = (i / 16) * Math.PI * 2;
            bubbles.spawn(
              c.x + Math.cos(a) * r,
              c.y + Math.sin(a) * r,
              U * 2,
              U * (0.3 + (i % 3) * 0.15),
              Math.cos(a) * U * 6,
              Math.sin(a) * U * 6 - U * 3,
              0,
              2.2,
            );
          }
        }
        bubbles.update(dt);
      },
    };
  },
  cluster(kit, c, i) {
    // A fish swimming round with the others, nose first, never upside down.
    const A = deckAssets(kit);
    const mat = kit.keep(A.painted.clone());
    mat.color.set(FISH[i % FISH.length]!);
    // Its tail and fins are flat: seen from either side.
    mat.side = DoubleSide;
    const fish = new Mesh(A.fish, mat);
    const root = new Group();
    root.add(fish);
    let lx = c.x;
    let ly = c.y;
    let head = 0;
    return {
      root,
      sync(f) {
        const dx = c.x - lx;
        const dy = -(c.y - ly);
        lx = c.x;
        ly = c.y;
        if (Math.hypot(dx, dy) > 1e-3) head = Math.atan2(dy, dx);
        at(root, c.x, c.y, c.r * 0.6);
        fish.rotation.set(Math.cos(head) < 0 ? Math.PI : 0, 0, 0);
        root.rotation.z = head;
        const k = c.r * 1.5 * (1 + 0.2 * f.flash("cluster", i, 0.2));
        fish.scale.set(k, k, k);
        mat.emissive
          .set(FISH[i % FISH.length]!)
          .multiplyScalar(0.15 + 0.6 * f.flash("cluster", i, 0.3));
      },
    };
  },
  shuttle(kit, geo) {
    // A crab scuttling to and fro, claws up; a hit makes it snap them.
    const A = deckAssets(kit);
    const c = geo.shuttle.bumper;
    const mat = kit.keep(A.painted.clone());
    mat.color.set("#ff9a5c");
    const root = new Group();
    const body = new Mesh(A.crab, mat);
    const claws = new Mesh(A.claws, mat);
    root.add(body, claws);
    let lastX = c.x;
    return {
      root,
      sync(f) {
        const moving = Math.abs(c.x - lastX);
        lastX = c.x;
        const hit = f.flash("shuttle", 0, 0.35);
        const step = Math.abs(Math.sin(f.time * 14)) * Math.min(1, moving * 0.5);
        at(root, c.x, c.y - step * c.r * 0.15, c.r * 0.5);
        root.rotation.z = Math.sin(f.time * 14) * 0.06 * Math.min(1, moving * 0.5);
        const k = c.r * 1.05;
        body.scale.set(k, k, k);
        claws.scale.set(k, k * (1 + 0.25 * Math.sin(hit * Math.PI * 4)), k);
        mat.emissive.set("#ff9a5c").multiplyScalar(0.1 + 0.5 * hit);
      },
    };
  },
  walls(kit, walls, posts, U) {
    // Reef rock instead of metal rails, with coral knobs for posts.
    const A = deckAssets(kit);
    const g = new Group();
    const rg = railsGeometry(walls, U * 0.9);
    if (rg) g.add(new Mesh(kit.keep(rg), A.rock));
    for (const p of posts) {
      const m = new Mesh(kit.geo.sphere, A.coralKnob);
      m.scale.set(p.r * 1.1, p.r * 1.1, U * 0.8);
      at(m, p.x, p.y, 0);
      g.add(m);
    }
    return { root: g };
  },
  magnet(kit, spec, i, col) {
    // A whirlpool: foam spiralling into a dark middle, faster and brighter as it charges.
    const A = deckAssets(kit);
    const root = new Group();
    const disc = new Mesh(kit.geo.quad, A.whirl);
    disc.scale.set(spec.r * 2.8, spec.r * 2.8, 1);
    disc.position.z = 1;
    const foamMat = kit.keep(kit.basic(col.magnet, { additive: true }).clone());
    const foam = new Mesh(A.foam, foamMat);
    foam.scale.setScalar(spec.r * 1.15);
    foam.position.z = 2;
    root.add(disc, foam);
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
        spin = (spin + (1.2 + charge * 6) * dt) % (Math.PI * 2);
        disc.rotation.z = spin;
        foamMat.color
          .set(col.magnet)
          .multiplyScalar(0.2 + 0.8 * charge + f.flash(`magnet${i}`, 0, 0.5));
        foam.scale.setScalar(spec.r * (1.15 - 0.15 * charge));
      },
    };
  },
  saucer(kit, s, i, col) {
    // The plain saucer in a scallop shell standing open behind it.
    const A = deckAssets(kit);
    const base = plainDeck.saucer(kit, s, i, col);
    const fan = new Shape();
    const n = 9;
    const R = s.r * 1.55;
    fan.moveTo(-R * 0.22, 0);
    for (let k = 0; k <= n; k++) {
      const a = Math.PI * 0.08 + (k / n) * Math.PI * 0.84;
      const x = Math.cos(a) * R;
      const y = Math.sin(a) * R;
      if (k > 0) {
        const pa = Math.PI * 0.08 + ((k - 0.5) / n) * Math.PI * 0.84;
        fan.quadraticCurveTo(Math.cos(pa) * R * 1.1, Math.sin(pa) * R * 1.1, x, y);
      } else fan.lineTo(x, y);
    }
    fan.lineTo(R * 0.22, 0);
    fan.closePath();
    const pts = fan.getPoints(6).map((p) => ({ x: s.x + p.x, y: s.y - p.y + s.r * 0.4 }));
    const shell = new Mesh(kit.keep(extrudeGeometry(pts, s.r * 0.25, 1)), A.shell);
    shell.userData.static = true;
    const root = new Group();
    root.add(shell, base.root);
    return { root, sync: base.sync };
  },
  scoop(kit, vk, col) {
    // The plain scoop in a ring of rocks.
    const A = deckAssets(kit);
    const base = plainDeck.scoop(kit, vk, col);
    const ring = new Group();
    ring.userData.static = true;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + 0.3;
      const rock = new Mesh(kit.geo.sphere, A.rock);
      rock.scale.set(vk.r * 0.32, vk.r * 0.26, vk.r * 0.22);
      rock.rotation.z = a;
      at(rock, vk.x + Math.cos(a) * vk.r * 1.25, vk.y + Math.sin(a) * vk.r * 1.25, 0);
      ring.add(rock);
    }
    const root = new Group();
    root.add(ring, base.root);
    return { root, sync: base.sync };
  },
  lock(kit, l, U, col) {
    // The lock's tube over a treasure chest, whose lid flies open for a multiball.
    const A = deckAssets(kit);
    const base = plainDeck.lock(kit, l, U, col);
    const root = new Group();
    root.add(base.root);
    const w = U * 3.6;
    const h = U * 2;
    const chest = new Group();
    const box = new Mesh(kit.geo.box, A.wood);
    box.scale.set(w, h, U * 2.2);
    const band = new Mesh(kit.geo.box, A.gold);
    band.scale.set(w * 1.04, U * 0.3, U * 2.3);
    band.position.y = h * 0.15;
    const lock = new Mesh(kit.geo.box, A.gold);
    lock.scale.set(U * 0.6, U * 0.7, U * 0.3);
    lock.position.set(0, h * 0.3, U * 2.2);
    chest.add(box, band, lock);
    chest.userData.static = true;
    at(chest, l.x, l.bottom + h * 0.5 + U * 0.4, 0);
    const lidPivot = new Group();
    const lidGeo = kit.keep(new CylinderGeometry(U * 1.1, U * 1.1, w, 16, 1, false, 0, Math.PI));
    lidGeo.rotateZ(Math.PI / 2);
    const lid = new Mesh(lidGeo, A.wood);
    lid.position.set(0, 0, 0);
    const lidBand = new Mesh(kit.geo.box, A.gold);
    lidBand.scale.set(U * 0.35, U * 0.25, U * 1.2);
    lidBand.position.set(0, U * 0.9, 0);
    lidPivot.add(lid, lidBand);
    at(lidPivot, l.x, l.bottom + U * 0.4, U * 1.1);
    const glowMat = kit.keep(kit.glow("#ffd27a").clone());
    const glow = new Mesh(kit.geo.quad, glowMat);
    glow.scale.set(w * 1.8, w * 1.2, 1);
    at(glow, l.x, l.bottom + U * 0.2, U * 2.4);
    root.add(chest, lidPivot, glow);
    return {
      root,
      sync(f) {
        base.sync?.(f);
        const multi = f.flash("multiball", 0, 2);
        const open = multi > 0 ? Math.min(1, (1 - multi) * 8, multi * 3) : 0;
        lidPivot.rotation.x = -open * 1.6;
        glowMat.color
          .set("#ffd27a")
          .multiplyScalar(open * 0.9 + 0.12 * f.deck.parts.lock.held.length);
      },
      dispose: base.dispose,
    };
  },
  nest(kit, n, U, col) {
    // The nest as a big shell, hung from its track: the plain basket inside a scalloped rim.
    const base = plainDeck.nest(kit, n, U, col);
    const A = deckAssets(kit);
    const rim = new Group();
    const shells: Mesh[] = [];
    for (let k = 0; k < 9; k++) {
      const m = new Mesh(kit.geo.sphere, A.shell);
      rim.add(m);
      shells.push(m);
    }
    const root = new Group();
    root.add(base.root, rim);
    return {
      root,
      sync(f) {
        base.sync?.(f);
        const nest = f.deck.parts.nest;
        const w = nest.width;
        at(rim, nest.x, n.y, 0);
        rim.rotation.z = -nest.tilt(f.now) * 1.1;
        shells.forEach((m, k) => {
          const a = Math.PI - (k / (shells.length - 1)) * Math.PI;
          m.position.set((Math.cos(a) * w) / 2, -U * 0.9 * Math.sin(a) - U * 0.2, U * 0.7);
          m.scale.set(U * 0.42, U * 0.32, U * 0.3);
        });
      },
      dispose: base.dispose,
    };
  },
  bubble(kit, _kind, icon) {
    // An air bubble with the gift inside it.
    const g = new Group();
    const shell = new Mesh(kit.geo.sphere, kit.phong("#dff8ff", { opacity: 0.22, shininess: 150 }));
    const face = new Mesh(kit.geo.quad, icon);
    face.scale.set(1.15, 1.15, 1);
    face.position.z = 1.02;
    const glint = new Mesh(kit.geo.quad, kit.glow("#ffffff"));
    glint.scale.set(0.5, 0.32, 1);
    glint.position.set(-0.38, 0.42, 1.05);
    g.add(shell, face, glint);
    return g;
  },
};
