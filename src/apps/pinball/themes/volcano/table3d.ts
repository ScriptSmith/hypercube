/**
 * Volcano's toys on a table, in 3D: the volcano with lava in its crater (balls bob in it, it glows
 * brighter with each, rumbles through the countdown and erupts in sparks and smoke), the lava ramp
 * and the lava fall, the friendly dinosaur (it watches the nearest ball, nods when bumped and
 * stomps, and its babies ride on its back), the eggs in their nest (they wobble when cracked and
 * split open when they hatch), steam vents between the top lanes, and ferns in the corner. Sizes
 * match the physics in index.ts; positions come from the table's (mirrored) middle.
 */
import {
  type BufferGeometry,
  type CanvasTexture,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  Quaternion,
  RepeatWrapping,
  TubeGeometry,
  Vector3,
} from "three";
import type { TableLayout } from "../../layout";
import type { Table } from "../../table";
import { dirty, instances } from "../../view3d/deckparts3d";
import { at, type Kit, railsGeometry } from "../../view3d/kit";
import type { TableModel } from "../../view3d/look";
import { STOMP, type VolcanoMiddle, type VolcanoToys } from ".";
import { paintCone, paintEgg, paintLava, stream } from "./art";
import {
  babyGeometry,
  channelGeometry,
  coneGeometry,
  crackGeometry,
  createParticles,
  DINO_AXIS,
  type DinoGeometry,
  dinoGeometry,
  eggHalfGeometry,
  fernGeometry,
  painted,
  trs,
} from "./models";

/** Pastel eggshells, and the babies that hatch from them. */
export const EGG_COLORS = ["#c4f2d6", "#ffdcb8", "#e2d2ff"] as const;
export const BABY_COLORS = ["#6fd894", "#ffa860", "#ad92ff"] as const;
const LAVA = "#ff7a1a";
const ROCK = "#3a2a24";
const BASALT = "#2c2220";
const TWIG = "#8a5a2e";

/** Shared per kit: textures, materials and geometries every table reuses. */
interface Assets {
  cone: BufferGeometry;
  coneMat: MeshPhongMaterial;
  lavaTex: CanvasTexture;
  lava: MeshBasicMaterial;
  poolMat: MeshBasicMaterial;
  painted: MeshPhongMaterial;
  /** The babies' own: a material shared by instanced and plain meshes switches program each draw. */
  babyMat: MeshPhongMaterial;
  rock: MeshPhongMaterial;
  dino: DinoGeometry;
  baby: BufferGeometry;
  half: BufferGeometry;
  eggMat: MeshPhongMaterial;
  crack: BufferGeometry;
  fern: BufferGeometry;
  fernMat: MeshPhongMaterial;
  glowMat: MeshBasicMaterial;
}

const cache = new WeakMap<Kit, Assets>();

const EGG = { length: 72, radius: 24 };

const assets = (kit: Kit, m: VolcanoMiddle): Assets => {
  const have = cache.get(kit);
  if (have) return have;
  const v = m.volcano;
  const side = m.dino.side;
  const b = m.dino.body;
  // The dinosaur as built (unmirrored); a mirrored table flips it.
  const head = new Vector3((m.dino.head.x - b.x) * side, -(m.dino.head.y - b.y), m.dino.head.z);
  const tip = new Vector3((m.dino.tail.x - b.x) * side, -(m.dino.tail.y - b.y), 0);
  const lavaTex = kit.paint(128, 256, (g) => paintLava(g, 128, 256, 5));
  lavaTex.wrapS = RepeatWrapping;
  lavaTex.wrapT = RepeatWrapping;
  const a: Assets = {
    cone: kit.keep(coneGeometry(v.base, v.rim, v.top, v.lava)),
    coneMat: kit.keep(
      new MeshPhongMaterial({
        map: kit.paint(512, 256, (g) => paintCone(g, 512, 256, 21, false)),
        emissiveMap: kit.paint(512, 256, (g) => paintCone(g, 512, 256, 21, true)),
        emissive: "#ff8a2a",
        emissiveIntensity: 0.7,
        shininess: 14,
        specular: "#4a3a30",
      }),
    ),
    lavaTex,
    lava: kit.keep(new MeshBasicMaterial({ map: lavaTex })),
    poolMat: kit.keep(
      new MeshBasicMaterial({ map: kit.paint(128, 128, (g) => paintLava(g, 128, 128, 9)) }),
    ),
    painted: kit.keep(
      new MeshPhongMaterial({ vertexColors: true, shininess: 30, specular: "#555555" }),
    ),
    babyMat: kit.keep(
      new MeshPhongMaterial({ vertexColors: true, shininess: 30, specular: "#555555" }),
    ),
    rock: kit.keep(
      new MeshPhongMaterial({
        vertexColors: true,
        shininess: 8,
        specular: "#2a2020",
        flatShading: true,
      }),
    ),
    dino: (() => {
      const d = dinoGeometry(head, tip, m.dino.tail.r);
      for (const g of [d.body, d.neck]) kit.keep(g);
      return d;
    })(),
    baby: kit.keep(babyGeometry()),
    half: kit.keep(eggHalfGeometry(EGG.length, EGG.radius, 1)),
    eggMat: kit.keep(
      new MeshPhongMaterial({
        map: kit.paint(128, 64, (g) => paintEgg(g, 128, 64, 3)),
        shininess: 22,
        specular: "#5a5a5a",
        side: DoubleSide,
      }),
    ),
    crack: kit.keep(crackGeometry(EGG.length, EGG.radius)),
    fern: kit.keep(fernGeometry(7)),
    fernMat: kit.keep(
      new MeshPhongMaterial({ vertexColors: true, shininess: 20, side: DoubleSide }),
    ),
    glowMat: kit.glow("#ffffff"),
  };
  cache.set(kit, a);
  return a;
};

const ease = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const clamp01 = (k: number) => Math.max(0, Math.min(1, k));
const dummy = new Matrix4();
const q = new Quaternion();
const q2 = new Quaternion();
const p3 = new Vector3();
const s3 = new Vector3();
const X = new Vector3(1, 0, 0);
const Z = new Vector3(0, 0, 1);
const tmp = new Color();
const WHITE = new Color("#ffffff");
const flashOf = (t: Table, tag: string, i: number, s = 0.25) => {
  const age = t.flashAge(tag, i);
  return age < s ? 1 - age / s : 0;
};

const SPARK = new Color("#ffb347").multiplyScalar(0.7);
const EMBER = new Color("#ff5a1a").multiplyScalar(0.8);
const STEAM = new Color("#d8d4d0");
const SMOKE = new Color("#8a807a");
const ASH = new Color("#c08a6a");

export const volcanoTable = (kit: Kit, layout: TableLayout, color: string): TableModel => {
  const m = layout.middle as VolcanoMiddle;
  const A = assets(kit, m);
  const root = new Group();
  const own: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => {
    own.push(x);
    return x;
  };
  const side = m.dino.side;
  const rnd = stream(m.mirror ? 31 : 17);

  // ---- Fixed rock: the ramp and the lava fall, the ramp's mouth, the vents, the nest ----------
  // The walls' trims in the table's colour.
  const ramp = channelGeometry(m.ramp.path, 26, { trim: color });
  const spill = channelGeometry(m.spill.path, 26, { width: 30, trim: color });
  for (const c of [ramp, spill]) {
    keep(c.floor);
    keep(c.rock);
    const floor = new Mesh(c.floor, A.lava);
    const rock = new Mesh(c.rock, A.rock);
    for (const x of [floor, rock]) x.userData.static = true;
    root.add(floor, rock);
  }
  const mouthRails = railsGeometry(m.ramp.walls, 40);
  const ventRails = railsGeometry(m.vents, 30);
  const rockPieces: { geometry: BufferGeometry; color: string; matrix?: Matrix4 }[] = [];
  if (mouthRails) rockPieces.push({ geometry: mouthRails, color: ROCK });
  if (ventRails) rockPieces.push({ geometry: ventRails, color: BASALT });
  // The nest: a ring of twigs round the eggs, and a few sticks across it.
  const n = m.nest;
  const nest: Vector3[] = [];
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const u = Math.cos(a) * 128;
    const w = Math.sin(a) * 52;
    nest.push(
      new Vector3(n.x + n.along.x * u - n.along.y * w, -(n.y + n.along.y * u + n.along.x * w), 8),
    );
  }
  rockPieces.push({
    geometry: new TubeGeometry(new CatmullRomCurve3(nest, true), 80, 10, 6, true),
    color: TWIG,
  });
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + rnd() * 0.3;
    const u = Math.cos(a) * 124;
    const w = Math.sin(a) * 50;
    const stick = new CylinderGeometry(3, 3, 54 + rnd() * 30, 5);
    stick.rotateZ(Math.PI / 2);
    rockPieces.push({
      geometry: stick,
      color: rnd() > 0.5 ? TWIG : "#6a4422",
      matrix: trs(
        n.x + n.along.x * u - n.along.y * w,
        -(n.y + n.along.y * u + n.along.x * w),
        12,
        a + 1.2 + rnd(),
        1,
      ),
    });
  }
  const fixedRock = new Mesh(keep(painted(rockPieces)), A.rock);
  fixedRock.userData.static = true;
  root.add(fixedRock);

  // ---- The volcano --------------------------------------------------------------------------
  const v = m.volcano;
  const volcano = new Group();
  at(volcano, v.x, v.y, 0);
  const coneMat = keep(A.coneMat.clone());
  const cone = new Mesh(A.cone, coneMat);
  const poolMat = keep(A.poolMat.clone());
  const pool = new Mesh(kit.geo.disc, poolMat);
  pool.scale.set(v.rim - 6, v.rim - 6, 1);
  pool.position.z = v.lava;
  const glowMat = keep(kit.glow(LAVA).clone());
  const glow = new Mesh(kit.geo.quad, glowMat);
  // Under the balls in the crater, so they show against it.
  glow.position.z = v.lava + 1;
  volcano.add(cone, pool, glow);
  root.add(volcano);

  // ---- The dinosaur and its babies ---------------------------------------------------------
  const db = m.dino.body;
  const dino = new Group();
  at(dino, db.x, db.y, 0);
  dino.scale.x = side;
  const body = new Mesh(A.dino.body, A.painted);
  const neck = new Group();
  neck.position.copy(A.dino.neckBase);
  const neckMesh = new Mesh(A.dino.neck, A.painted);
  neckMesh.position.copy(A.dino.neckBase).multiplyScalar(-1);
  neck.add(neckMesh);
  dino.add(body, neck);
  root.add(dino);
  dino.updateMatrix();
  const restInverse = dino.matrix.clone().invert();
  // A glow under the tail's tip when it is hit, and a ring of dust when the dinosaur stomps.
  const tailGlow = new Mesh(kit.geo.quad, kit.glow(color));
  at(tailGlow, m.dino.tail.x, m.dino.tail.y, 1);
  const dustMat = keep(
    new MeshBasicMaterial({ color: "#c8b8a0", transparent: true, depthWrite: false, opacity: 0 }),
  );
  const dust = new Mesh(kit.geo.ring, dustMat);
  at(dust, db.x, db.y, 1.2);
  root.add(tailGlow, dust);
  const babies = instances(A.baby, A.babyMat, 3);
  const babyColors = BABY_COLORS.map((c) => new Color(c));
  babies.count = 3;
  babyColors.forEach((c, i) => babies.setColorAt(i, c));
  root.add(babies);
  const seats = m.dino.seats.map((s) => new Vector3(s.x, -s.y, s.z));
  const seatNow = seats.map((s) => s.clone());
  // The body's long axis, for the stomp's pitch (as the table has it, mirrored or not).
  const pitchAxis = new Vector3(Math.sin(DINO_AXIS), -Math.cos(DINO_AXIS), 0);
  if (m.mirror) pitchAxis.x = -pitchAxis.x;
  const neckAt = {
    x: db.x + A.dino.neckBase.x * side,
    y: db.y - A.dino.neckBase.y,
  };

  // ---- Eggs ----------------------------------------------------------------------------------
  // Both halves of every egg in one mesh: egg i's halves are instances i and i + 3, the second
  // turned half round the egg's long middle.
  const halves = instances(A.half, A.eggMat, 6);
  const cracks = instances(A.crack, kit.basic("#3a2414"), 3);
  root.add(halves, cracks);
  const turnOver = new Matrix4()
    .makeTranslation(0, 0, EGG.radius)
    .multiply(new Matrix4().makeRotationX(Math.PI))
    .multiply(new Matrix4().makeTranslation(0, 0, -EGG.radius));
  const eggColors = EGG_COLORS.map((c) => new Color(c));
  const eggSpots = m.eggs.map((s) => ({
    x: (s.ax + s.bx) / 2,
    y: (s.ay + s.by) / 2,
    turn: -Math.atan2(s.by - s.ay, s.bx - s.ax),
  }));

  // ---- Ferns in the top corner, outside the arch --------------------------------------------
  const fernSpots = [
    { x: 66, y: 210, s: 1.1 },
    { x: 160, y: 96, s: 0.9 },
    { x: 34, y: 360, s: 0.7 },
    { x: 260, y: 40, s: 0.6 },
  ].map((f) => ({ ...f, x: m.mirror ? 1080 - f.x : f.x }));
  const ferns = instances(A.fern, A.fernMat, fernSpots.length);
  fernSpots.forEach((f, i) => {
    ferns.setMatrixAt(i, trs(f.x, -f.y, 0, i * 1.7, f.s));
    ferns.setColorAt(i, tmp.set("#ffffff").multiplyScalar(0.85 + 0.15 * (i % 2)));
  });
  root.add(ferns);

  // ---- Sparks and smoke ----------------------------------------------------------------------
  // Sparks fall and fade; smoke and steam rise, grow and fade. One pool, one draw.
  const fx = createParticles(kit.geo.quad, A.glowMat, 100, [
    { gravity: 900, drag: 0.6, grow: -0.6, fade: 1 },
    { gravity: -40, drag: 0.8, grow: 2.2, fade: 1.4 },
  ]);
  fx.mesh.renderOrder = 5;
  root.add(fx.mesh);
  type Emit = (
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size: number,
    color: Color,
  ) => void;
  const sparks: { emit: Emit } = { emit: (...a) => fx.emit(0, ...a) };
  const smoke: { emit: Emit } = { emit: (...a) => fx.emit(1, ...a) };

  const crater = { x: v.x, y: v.y, z: v.lava + 10 };
  const burst = (nSparks: number, speed: number, nSmoke: number, big = 1) => {
    for (let i = 0; i < nSparks; i++) {
      const a = rnd() * Math.PI * 2;
      const r = (0.25 + rnd() * 0.6) * speed;
      const k = rnd();
      sparks.emit(
        crater.x + Math.cos(a) * 26 * k,
        crater.y + Math.sin(a) * 26 * k,
        crater.z,
        Math.cos(a) * r,
        Math.sin(a) * r,
        speed * (0.4 + rnd() * 0.5),
        0.6 + rnd() * 0.6,
        (8 + rnd() * 9) * big,
        rnd() > 0.5 ? SPARK : EMBER,
      );
    }
    for (let i = 0; i < nSmoke; i++) {
      smoke.emit(
        crater.x + (rnd() - 0.5) * 30,
        crater.y + (rnd() - 0.5) * 30,
        crater.z + 10,
        (rnd() - 0.5) * 60,
        -20 - rnd() * 50,
        60 + rnd() * 120 * big,
        1.6 + rnd() * 1.4,
        (40 + rnd() * 30) * big,
        // Dim, since puffs pile up additively over the crater.
        tmp.copy(big > 1 ? ASH : SMOKE).multiplyScalar(big > 1 ? 0.22 : 0.4),
      );
    }
  };

  // What has been shown already, by the world time it happened.
  const seen = new Map<string, number>();
  const fresh = (t: Table, tag: string, i = 0) => {
    const when = t.world.t - t.flashAge(tag, i);
    const key = `${tag}:${i}`;
    const last = seen.get(key);
    seen.set(key, when);
    return last !== undefined && when > last + 1e-6;
  };

  let lastTime = 0;
  let lastWorld = 0;
  let yaw = 0;
  let puffAt = 0;
  let trailAt = 0;
  let fountain = 0;

  return {
    root,
    owns: ["volcano", "ramp", "vent", "dino", "dinotail", "tail", "egg"],
    sync(t: Table, time: number) {
      const toys = t.toys as VolcanoToys;
      const now = t.world.t;
      const dt = Math.max(0, Math.min(0.1, time - lastTime));
      lastTime = time;
      // A new game or a long pause: clear what was in the air.
      if (now < lastWorld - 0.5) {
        fx.clear();
        seen.clear();
      }
      lastWorld = now;

      // Lava flows down the ramp and the lava fall.
      A.lavaTex.offset.y = (time * 0.55) % 1;

      // ---- The volcano: glow by the balls in it, rumble in the countdown, erupt ----------------
      const lock = toys.lock;
      const progress = lock.progress;
      let heat = 0.35 + 0.22 * progress;
      let shake = 0;
      if (lock.phase === "countdown") {
        const k = clamp01((now - lock.phaseAt) / lock.spec.countdown);
        heat = 1.05 + 0.4 * k + 0.25 * Math.sin(time * 18);
        shake = 2 + 4 * k;
      }
      const sinceErupt = now - toys.eruptAt;
      if (sinceErupt >= 0 && sinceErupt < 3) {
        heat = Math.max(heat, 1.8 - 0.5 * sinceErupt);
        shake = Math.max(shake, sinceErupt < 0.8 ? 5 * (1 - sinceErupt / 0.8) : 0);
      } else if (lock.full && lock.phase === "closed") {
        // Cooling after an eruption: a dark crust that warms up again before it reopens.
        heat = 0.12 + 0.2 * clamp01((now - lock.phaseAt) / lock.spec.cool);
      }
      const took = flashOf(t, "crater", Math.max(0, lock.count - 1), 0.4);
      shake = Math.max(shake, took * 3);
      heat += 0.3 * took + 0.4 * flashOf(t, "volcano", 0, 0.4);
      volcano.position.x = v.x + Math.sin(time * 67) * shake;
      volcano.position.y = -v.y + Math.cos(time * 53) * shake * 0.7;
      coneMat.emissiveIntensity = 0.45 + 0.6 * heat;
      poolMat.color.setRGB(1, 1, 1).multiplyScalar(0.5 + 0.3 * Math.min(1.3, heat));
      pool.rotation.z = time * 0.15;
      const gr = v.rim * (2.6 + 1.6 * Math.min(1.6, heat));
      glow.scale.set(gr, gr, 1);
      glowMat.color.set(LAVA).multiplyScalar(0.15 + 0.25 * Math.min(1.5, heat));

      // Smoke all the time, more in the countdown; sparks when it fills, rumbles and erupts.
      if (time >= puffAt) {
        const busy = lock.phase === "countdown";
        smoke.emit(
          crater.x + (rnd() - 0.5) * 20,
          crater.y + (rnd() - 0.5) * 20,
          crater.z + 6,
          (rnd() - 0.5) * 30,
          -10 - rnd() * 20,
          50 + rnd() * 30,
          2.4,
          busy ? 46 : 34,
          tmp.copy(SMOKE).multiplyScalar(busy ? 0.55 : 0.35),
        );
        if (busy) burst(3, 520, 0, 0.8);
        puffAt = time + (busy ? 0.18 : 0.9);
      }
      if (fresh(t, "erupt")) {
        burst(20, 1150, 8, 1.6);
        fountain = 0;
      }
      // Then a fountain of sparks for most of a second.
      if (sinceErupt >= 0 && sinceErupt < 0.9) {
        fountain += dt * 34;
        const n = Math.floor(fountain);
        fountain -= n;
        if (n > 0) burst(n, 1050 * (1 - sinceErupt * 0.5), 0, 1.3);
      }
      if (fresh(t, "crater", 0) || fresh(t, "crater", 1) || fresh(t, "crater", 2)) burst(8, 520, 2);
      if (fresh(t, "volcano")) burst(4, 420, 1, 0.7);
      if (fresh(t, "ramp")) {
        const p = m.ramp.mouth;
        for (let i = 0; i < 6; i++) {
          sparks.emit(
            p.x + (rnd() - 0.5) * 60,
            p.y - 30,
            30,
            (rnd() - 0.5) * 200,
            -100 - rnd() * 200,
            200 + rnd() * 300,
            0.6,
            12,
            SPARK,
          );
        }
      }
      // Steam from a vent when a ball rolls its lane.
      for (let i = 0; i < m.lanes.length; i++) {
        if (!fresh(t, "lane", i)) continue;
        const l = m.lanes[i]!;
        for (let k = 0; k < 3; k++) {
          smoke.emit(
            l.x + (rnd() - 0.5) * 20,
            l.y + 10,
            20,
            (rnd() - 0.5) * 40,
            -30 - rnd() * 40,
            90 + rnd() * 60,
            1.2,
            26,
            STEAM,
          );
        }
      }
      // Balls flying out of an eruption trail sparks.
      if (time >= trailAt) {
        trailAt = time + 0.03;
        for (const h of t.toys.held()) {
          if (h.by !== "erupt" || !lock.full) continue;
          sparks.emit(h.x, h.y, h.z, (rnd() - 0.5) * 80, (rnd() - 0.5) * 80, 0, 0.45, 16, EMBER);
        }
      }
      fx.update(dt);

      // ---- The dinosaur ---------------------------------------------------------------------
      // It watches the nearest ball, swinging its head on its neck.
      let best = Infinity;
      let want = Math.sin(time * 0.5) * 0.25;
      const hx = m.dino.head.x;
      const hy = m.dino.head.y;
      for (const b of t.world.balls) {
        const d = Math.hypot(b.x - hx, b.y - hy);
        if (d > 760 || d >= best) continue;
        best = d;
        const ang = Math.atan2(-(b.y - neckAt.y), (b.x - neckAt.x) * side);
        // Straight up the table is the head's rest; turn towards the ball from there.
        want = Math.max(-0.65, Math.min(0.65, ang - Math.PI / 2));
      }
      yaw += (want - yaw) * Math.min(1, dt * 4);
      const nod = flashOf(t, "dino", 0, 0.5);
      neck.quaternion.setFromAxisAngle(Z, yaw);
      neck.quaternion.multiply(q2.setFromAxisAngle(X, -0.35 * Math.sin(nod * Math.PI)));
      // The stomp: the front rears up, comes down hard and settles.
      const s = now - toys.stompAt;
      let pitch = 0;
      let lift = 0;
      let squash = 1;
      if (s >= 0 && s < STOMP.length) {
        if (s < STOMP.slam) {
          const k = ease(s / STOMP.slam);
          pitch = 0.2 * k;
          lift = 16 * k;
        } else {
          const k = (s - STOMP.slam) / (STOMP.length - STOMP.slam);
          pitch = -0.04 * Math.sin(k * Math.PI) * (1 - k);
          lift = -3 * Math.sin(k * Math.PI * 3) * (1 - k);
          squash = 1 - 0.07 * Math.sin(Math.min(1, k * 4) * Math.PI);
        }
      }
      dino.quaternion.setFromAxisAngle(pitchAxis, pitch * side);
      dino.position.z = lift;
      dino.scale.set(side, 1, squash);
      const wag = flashOf(t, "tail", 0, 0.4);
      const tg = m.dino.tail.r * (2.6 + 2.2 * wag);
      tailGlow.scale.set(tg, tg, 1);
      tailGlow.visible = wag > 0;
      const ds = s - STOMP.slam;
      dust.visible = ds >= 0 && ds < 0.6;
      if (dust.visible) {
        const r = 70 + 260 * ease(ds / 0.6);
        dust.scale.set(r, r, 1);
        dustMat.opacity = 0.55 * (1 - ds / 0.6);
      }

      // Babies: pop out of the egg, hop onto the parent's back, ride there until new eggs come.
      dino.updateMatrix();
      const move = dummy.multiplyMatrices(dino.matrix, restInverse);
      seats.forEach((s0, i) => seatNow[i]!.copy(s0).applyMatrix4(move));
      for (let i = 0; i < 3; i++) {
        const born = toys.hatchAt[i] ?? -Infinity;
        const spot = eggSpots[i]!;
        const seat = seatNow[i]!;
        let scale = 0;
        let x = seat.x;
        let y = seat.y;
        let z = seat.z;
        let face = 0;
        const age = now - born;
        const back = toys.eggs.up[i] && (toys.eggs.at[i] ?? 0) > born;
        if (born > -Infinity && age >= 0) {
          if (back) {
            const l = now - (toys.eggs.at[i] ?? now);
            scale = 1 - ease(l / 0.5);
          } else if (age < 0.5) {
            // Climbing out between the open halves.
            const k = ease((age - 0.05) / 0.45);
            x = spot.x;
            y = -spot.y;
            z = 4 + 34 * k;
            scale = 0.3 + 0.7 * k;
          } else if (age < 1.65) {
            const k = (age - 0.5) / 1.15;
            x = spot.x + (seat.x - spot.x) * k;
            y = -spot.y + (seat.y + spot.y) * k;
            z = 38 + (seat.z - 38) * k + 50 * Math.abs(Math.sin(k * Math.PI * 3));
            scale = 1;
            face = Math.atan2(seat.y + spot.y, seat.x - spot.x) - Math.PI / 2;
          } else {
            scale = 1;
            z = seat.z + 2 * Math.sin(time * 3 + i * 2);
            face = Math.sin(time * 0.7 + i) * 0.4;
          }
        }
        babies.setMatrixAt(
          i,
          dummy.compose(p3.set(x, y, z), q.setFromAxisAngle(Z, face), s3.setScalar(scale * 1.1)),
        );
      }
      babies.instanceMatrix.needsUpdate = true;

      // Eggs: wobble when cracked, split open and sink when they hatch, rise when new.
      for (let i = 0; i < 3; i++) {
        const sp = eggSpots[i]!;
        const up = toys.eggs.up[i] ?? true;
        const at0 = toys.eggs.at[i] ?? 0;
        const cracked = toys.cracked[i] ?? false;
        let z = 0;
        let open = 0;
        let sc = 1;
        let roll = 0;
        if (up) {
          const k = at0 > 0 ? ease((now - at0) / 0.45) : 1;
          z = -60 * (1 - k);
          if (cracked) roll = 0.1 * Math.sin(time * 11 + i);
          // A slow idle rock now and then.
          roll += 0.05 * Math.max(0, Math.sin(time * 1.3 + i * 2.1)) ** 8;
        } else {
          // The halves fall open, wait for the baby to climb out, then sink away.
          const s1 = now - at0;
          open = 1.2 * ease(s1 / 0.3);
          z = -64 * ease((s1 - 0.9) / 0.5);
          if (s1 > 1.45) sc = 0;
        }
        const hit = flashOf(t, "crack", i, 0.3);
        tmp.copy(eggColors[i]!).lerp(WHITE, hit * 0.6);
        for (const [k, dir] of [
          [i, -1],
          [i + 3, 1],
        ] as const) {
          q.setFromAxisAngle(Z, sp.turn).multiply(q2.setFromAxisAngle(X, dir * open + roll));
          dummy.compose(p3.set(sp.x, -sp.y, z), q, s3.setScalar(sc));
          if (dir > 0) dummy.multiply(turnOver);
          halves.setMatrixAt(k, dummy);
          halves.setColorAt(k, tmp);
        }
        q.setFromAxisAngle(Z, sp.turn).multiply(q2.setFromAxisAngle(X, roll));
        cracks.setMatrixAt(
          i,
          dummy.compose(p3.set(sp.x, -sp.y, z), q, s3.setScalar(up && cracked ? 1 : 0)),
        );
      }
      for (const mesh of [halves, cracks]) mesh.instanceMatrix.needsUpdate = true;
      dirty(halves);
    },
    lamp(l, t, time) {
      const toys = t.toys as VolcanoToys;
      if (l.tag === "lock") {
        const lock = toys.lock;
        if (lock.phase === "countdown")
          return { k: Math.sin(time * 20) > 0 ? 1 : 0.2, color: LAVA };
        if (lock.phase === "closed" || lock.phase === "release") return { k: 0.08, color: LAVA };
        if (lock.progress > l.index) return { k: 1, color: LAVA };
        // A slow chase up the arrow, inviting a shot up the ramp.
        const chase = (time * 1.6 - l.index * 0.33) % 1;
        return { k: 0.12 + 0.35 * Math.max(0, 1 - chase * 3), color: LAVA };
      }
      if (l.tag === "egg") {
        const up = toys.eggs.up[l.index] ?? true;
        const c = BABY_COLORS[l.index % 3]!;
        if (!up) return { k: 1, color: c };
        if (toys.cracked[l.index]) return { k: Math.sin(time * 8) > 0 ? 0.9 : 0.25, color: c };
        return { k: 0.1 + flashOf(t, "crack", l.index), color: c };
      }
      return undefined;
    },
    dispose() {
      for (const x of own) x.dispose();
      // Instanced meshes hold their own buffers on the GPU.
      for (const x of [babies, halves, cracks, ferns, fx.mesh]) x.dispose();
    },
  };
};
