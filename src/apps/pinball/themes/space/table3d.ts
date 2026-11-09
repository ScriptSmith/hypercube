/**
 * Space's toys on a table, in 3D: the planet and its moons, the rocket on its launch pad (lifting
 * off with flame and smoke on a multiball, and a new one rising after), the black hole's swirling
 * disc and the asteroid drop targets sinking into the playfield. Sizes match the physics in
 * index.ts; positions come from the table's (mirrored) middle.
 */
import {
  AdditiveBlending,
  Color,
  type BufferGeometry,
  ConeGeometry,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  Object3D,
  Shape,
  TorusGeometry,
  Vector2,
} from "three";
import { BALL_R } from "../../config";
import type { TableLayout } from "../../layout";
import type { Table } from "../../table";
import { dirty, instances } from "../../view3d/deckparts3d";
import { at, type Kit, paintedGeometry, railsGeometry } from "../../view3d/kit";
import type { TableModel } from "../../view3d/look";
import type { SpaceMiddle, SpaceToys } from ".";
import { paintMoon, paintPlanet, paintSwirl, stream } from "./art";

/** Shared per kit: textures and geometries every table reuses. */
interface Assets {
  planet: MeshPhongMaterial;
  moon: MeshPhongMaterial;
  rocket: LatheGeometry;
  nose: LatheGeometry;
  fins: BufferGeometry[];
  painted: MeshPhongMaterial;
  swirl: MeshBasicMaterial;
  rock: IcosahedronGeometry;
  rockMat: MeshPhongMaterial;
  flame: ConeGeometry;
  ring: TorusGeometry;
  porthole: TorusGeometry;
  orbit: TorusGeometry;
}

const cache = new WeakMap<Kit, Assets>();

const assets = (kit: Kit): Assets => {
  const have = cache.get(kit);
  if (have) return have;
  const planet = kit.keep(
    new MeshPhongMaterial({
      map: kit.paint(256, 128, (g) =>
        paintPlanet(g, 256, 128, ["#c9814f", "#e8b98a", "#a35a3a", "#f2d8b8", "#8c4a32"], 3),
      ),
      shininess: 18,
      emissive: "#000000",
    }),
  );
  const moon = kit.keep(
    new MeshPhongMaterial({
      map: kit.paint(128, 64, (g) => paintMoon(g, 128, 64, 9)),
      shininess: 8,
      emissive: "#000000",
    }),
  );
  // The rocket's profile, base at y 0 and nose at its length, radius out from the axis.
  const L = 138;
  const R = 38;
  const prof = [
    [0.01, -16],
    [20, -16],
    [15, -2],
    [R - 4, 0],
    [R, 14],
    [R, 86],
  ].map(([r, y]) => new Vector2(r, y));
  const rocket = kit.keep(new LatheGeometry(prof, 32));
  const noseProf: Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    noseProf.push(
      new Vector2(
        Math.max(0.01, R * Math.cos((t * Math.PI) / 2)),
        86 + (L - 86) * Math.sin((t * Math.PI) / 2),
      ),
    );
  }
  const nose = kit.keep(new LatheGeometry(noseProf, 32));
  // Two swept fins either side of the base, seen face on.
  const fins = [-1, 1].map((side) => {
    const sh = new Shape();
    sh.moveTo(side * (R - 4), 46);
    sh.lineTo(side * (R + 30), -4);
    sh.lineTo(side * (R + 30), -22);
    sh.lineTo(side * (R - 4), 2);
    sh.closePath();
    const g = kit.keep(new ExtrudeGeometry(sh, { depth: 6, bevelEnabled: false }));
    g.translate(0, 0, -3);
    return g;
  });
  const rock = kit.keep(new IcosahedronGeometry(1, 1));
  const pos = rock.getAttribute("position");
  const rnd = stream(17);
  // Lumpy: every vertex in or out a little (shared vertices move together by position).
  const bumps = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let k = bumps.get(key);
    if (k === undefined) {
      k = 0.78 + rnd() * 0.4;
      bumps.set(key, k);
    }
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
  }
  rock.computeVertexNormals();
  const a: Assets = {
    planet,
    moon,
    rocket,
    nose,
    fins,
    painted: kit.keep(
      new MeshPhongMaterial({ vertexColors: true, shininess: 90, specular: "#999999" }),
    ),
    swirl: kit.keep(
      new MeshBasicMaterial({
        map: kit.paint(256, 256, (g) => paintSwirl(g, 256, "#ffd08a", "#7a3cff")),
        transparent: true,
        depthWrite: false,
      }),
    ),
    rock,
    rockMat: kit.keep(
      new MeshPhongMaterial({
        color: "#7d6f63",
        shininess: 6,
        flatShading: true,
      }),
    ),
    flame: kit.keep(new ConeGeometry(1, 1, 16, 1, true)),
    ring: kit.keep(new TorusGeometry(1, 0.06, 8, 48)),
    porthole: kit.keep(new TorusGeometry(13.5, 2.6, 8, 28)),
    orbit: kit.keep(new TorusGeometry(1, 0.012, 6, 96)),
  };
  cache.set(kit, a);
  return a;
};

const ease = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const dummy = new Object3D();
const tmp = new Color();
const flashOf = (t: Table, tag: string, i: number, s = 0.25) => {
  const age = t.flashAge(tag, i);
  return age < s ? 1 - age / s : 0;
};

/** Height of the rocket's axis over the playfield. */
const AXIS_Z = 40;
const PUFFS = 10;

export const spaceTable = (kit: Kit, layout: TableLayout, color: string): TableModel => {
  const m = layout.middle as SpaceMiddle;
  const A = assets(kit);
  const root = new Group();
  const own: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => {
    own.push(x);
    return x;
  };

  // The planet, turning slowly, with a thin atmosphere that flares when hit.
  const p = m.planet;
  const planetMat = keep(A.planet.clone());
  const planet = new Mesh(kit.geo.sphere, planetMat);
  planet.scale.setScalar(p.r);
  planet.rotation.x = 0.5;
  at(planet, p.x, p.y, p.r * 0.75);
  const airMat = keep(kit.glow("#9fc4ff").clone());
  const air = new Mesh(kit.geo.quad, airMat);
  air.scale.set(p.r * 3.1, p.r * 3.1, 1);
  at(air, p.x, p.y, 1);
  const orbit = new Mesh(A.orbit, kit.basic("#5fd4ff", { additive: true, opacity: 0.5 }));
  orbit.scale.setScalar(m.orbit.radius);
  at(orbit, m.orbit.x, m.orbit.y, 2);
  orbit.userData.static = true;
  root.add(air, orbit, planet);
  // Repeated pieces are instanced, one draw each: the moons, the asteroids, the porthole lamps.
  const moons = instances(kit.geo.sphere, A.moon, m.moons.length);
  root.add(moons);

  // The rocket on its pad, pointing up the table, in the table's colour.
  const rocketRoot = new Group();
  const rocket = new Group();
  // One mesh in vertex colours: white body and fins, a nose and band in the table's colour, and
  // metal rings round the portholes, so the whole rocket is one draw.
  const parts: { geometry: BufferGeometry; color: string; matrix?: Matrix4 }[] = [
    { geometry: A.rocket, color: kit.palette.plastic },
    { geometry: A.nose, color },
    {
      geometry: kit.geo.cylinder,
      color,
      matrix: new Matrix4()
        .makeTranslation(0, 60, 0)
        .multiply(new Matrix4().makeRotationX(-Math.PI / 2))
        .multiply(new Matrix4().makeScale(38.6, 38.6, 10)),
    },
    ...A.fins.map((g) => ({ geometry: g, color: kit.palette.plastic })),
    ...m.slots.map((sl) => ({
      geometry: A.porthole,
      color: kit.palette.rail,
      matrix: new Matrix4().makeTranslation(0, m.rocket.base - sl.y, 34),
    })),
  ];
  const shell = keep(paintedGeometry(parts)!);
  rocket.add(new Mesh(shell, A.painted));
  // A lamp glows round each porthole, where a locked ball shows.
  const ports = instances(kit.geo.quad, kit.glow("#ffffff"), m.slots.length);
  m.slots.forEach((sl, i) => {
    dummy.position.set(0, m.rocket.base - sl.y, 37);
    dummy.scale.set(BALL_R * 1.9, BALL_R * 1.9, 1);
    dummy.updateMatrix();
    ports.setMatrixAt(i, dummy.matrix);
  });
  rocket.add(ports);
  const flameMat = keep(
    new MeshBasicMaterial({
      color: "#ffb347",
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  const flame = new Mesh(A.flame, flameMat);
  flame.rotation.x = Math.PI;
  rocket.add(flame);
  rocketRoot.add(rocket);
  at(rocketRoot, m.rocket.x, m.rocket.base, AXIS_Z);
  root.add(rocketRoot);
  // The pad's ring wall, lit in the table's colour.
  const padRing = railsGeometry([m.pad.wall], 20);
  if (padRing)
    root.add(new Mesh(keep(padRing), kit.phong(color, { emissive: color, shininess: 90 })));
  // Smoke at the pad: soft grey puffs.
  const puffs = Array.from({ length: PUFFS }, () => {
    const mat = keep(kit.glow("#c8ccd8").clone());
    const mesh = new Mesh(kit.geo.quad, mat);
    mesh.visible = false;
    root.add(mesh);
    return { mesh, mat };
  });

  // The black hole's disc, turning, with a lensing ring that brightens while it holds a ball.
  const h = m.hole;
  const swirl = new Mesh(kit.geo.quad, A.swirl);
  swirl.scale.set(h.disc * 2, h.disc * 2, 1);
  at(swirl, h.x, h.y, 1);
  const lensMat = keep(kit.basic("#ffd08a", { additive: true }).clone());
  const lens = new Mesh(A.ring, lensMat);
  lens.scale.setScalar(h.disc * 0.36);
  at(lens, h.x, h.y, 2);
  root.add(swirl, lens);

  // Asteroids standing over their targets, sinking into the playfield when hit.
  const rocks = instances(A.rock, A.rockMat, m.asteroids.length);
  root.add(rocks);
  const rockBase = new Color("#ffffff");
  const rockHot = new Color("#ffcf9a").multiplyScalar(1.6);
  const moonHot = new Color("#ffffff").multiplyScalar(1.8);
  const portOn = new Color();

  const side = m.mirror ? -1 : 1;
  let lastPhase = "open";
  let risingFrom = -Infinity;
  let lastTime = 0;
  let spin = 0;

  return {
    root,
    owns: ["planet", "moon", "rocket", "asteroid", "pad"],
    sync(t: Table, time: number) {
      const toys = t.toys as SpaceToys;
      const now = t.world.t;
      planet.rotation.y = time * 0.25 * side;
      const hit = flashOf(t, "planet", 0);
      planetMat.emissive.set("#ffd6a0").multiplyScalar(hit * 0.6);
      airMat.color.set("#7fb2ff").multiplyScalar(0.35 + hit * 0.8);
      m.moons.forEach((c, i) => {
        at(dummy, c.x, c.y, c.r * 0.8);
        dummy.rotation.set(0, time * 0.6 + i, 0);
        dummy.scale.setScalar(c.r);
        dummy.updateMatrix();
        moons.setMatrixAt(i, dummy.matrix);
        moons.setColorAt(i, tmp.copy(rockBase).lerp(moonHot, flashOf(t, "moon", i)));
      });
      moons.instanceMatrix.needsUpdate = true;
      dirty(moons);

      // The rocket: idle, rumbling through the countdown, lifting off, then a new one rising.
      const lock = toys.lock;
      if (lock.phase === "closed" && lastPhase !== "closed") risingFrom = lock.phaseAt;
      lastPhase = lock.phase;
      const lift = now - toys.liftoffAt;
      // Only a full lock lifts off; one let go at its time limit just drops its balls.
      const gone = lock.full && (lock.phase === "release" || lock.phase === "closed");
      let y = 0;
      let z = 0;
      let s = 1;
      let fire = 0;
      let shake = 0;
      if (lock.phase === "countdown") {
        const k = (now - lock.phaseAt) / 2;
        shake = 1.5 + k * 2.5;
        fire = 0.25 + 0.35 * k;
      } else if (gone && lift >= 0 && lift < 1.4) {
        y = -(160 * lift + 950 * lift * lift);
        z = 40 * lift + 380 * lift * lift;
        fire = 1;
        shake = 2;
      } else if (gone && lock.phase === "closed" && now - risingFrom > 0.9) {
        // A new rocket rises out of the pad.
        const k = ease((now - risingFrom - 0.9) / 1.3);
        z = -140 * (1 - k);
        s = 0.7 + 0.3 * k;
      } else if (gone && lock.phase === "closed") {
        z = -400;
      }
      rocket.position.set(Math.sin(time * 61) * shake, -y, z);
      rocket.scale.setScalar(s);
      rocketRoot.visible = z > -300;
      flame.visible = fire > 0;
      const flick = 0.85 + 0.15 * Math.sin(time * 47);
      flame.scale.set(14 * flick, (20 + 70 * fire) * flick, 14 * flick);
      flame.position.set(0, -14 - ((20 + 70 * fire) * flick) / 2, 0);
      flameMat.color.set("#ffb347").multiplyScalar(0.5 + 0.5 * fire);
      for (let i = 0; i < m.slots.length; i++) {
        const lit = lock.progress > i || (lock.phase === "countdown" && lock.count > i);
        const blink = lock.phase === "countdown" ? (Math.sin(time * 18) > 0 ? 1 : 0.4) : 1;
        portOn.set(color).multiplyScalar(lit ? 0.7 * blink : 0.06 + flashOf(t, "rocket", i));
        ports.setColorAt(i, portOn);
      }
      dirty(ports);
      // Smoke from the countdown into the first second of the flight.
      const smokeFrom = lock.phase === "countdown" ? lock.phaseAt : toys.liftoffAt;
      const st = now - smokeFrom;
      puffs.forEach((pf, i) => {
        const born = i * 0.16;
        const age = st - born;
        const on = (lock.phase === "countdown" || lift < 2.2) && age > 0 && age < 1.4 && st < 3.6;
        pf.mesh.visible = on;
        if (!on) return;
        const k = age / 1.4;
        const dir = ((i * 2.399) % 2) - 1;
        const r = 30 + 90 * k;
        pf.mesh.scale.set(r, r, 1);
        at(pf.mesh, m.rocket.x + dir * 70 * k, m.rocket.base + 30 + 40 * k, 4 + i * 0.2);
        pf.mat.color.set("#c8ccd8").multiplyScalar(0.55 * (1 - k));
      });

      // The black hole turns faster and brightens while it holds a ball.
      const holding = toys.hole.ball !== null;
      const dt = Math.max(0, Math.min(0.1, time - lastTime));
      lastTime = time;
      spin = (spin + (holding ? 5.4 : 1.5) * dt) % (Math.PI * 2);
      swirl.rotation.z = -h.spin * spin;
      const pulse = holding ? 0.6 + 0.4 * Math.sin(time * 12) : 0.25;
      lensMat.color.set("#ffd08a").multiplyScalar(pulse + flashOf(t, "hole", 0, 0.5));

      // Asteroids sink when hit and rise again.
      m.asteroids.forEach((s, i) => {
        const up = toys.bank.up[i] ?? true;
        const at0 = toys.bank.at[i] ?? 0;
        const k = up ? ease((now - at0) / 0.35) : 1 - ease((now - at0) / 0.18);
        const len = Math.hypot(s.bx - s.ax, s.by - s.ay);
        at(dummy, (s.ax + s.bx) / 2, (s.ay + s.by) / 2, -70 + 88 * k);
        dummy.rotation.set(i * 0.7 + time * 0.3, 0, -Math.atan2(s.by - s.ay, s.bx - s.ax));
        // Sunk out of sight, it is also shrunk to nothing.
        const sk = k > 0.02 ? 1 : 0;
        dummy.scale.set(len * 0.62 * sk, s.r * 1.9 * sk, 24 * sk);
        dummy.updateMatrix();
        rocks.setMatrixAt(i, dummy.matrix);
        rocks.setColorAt(i, tmp.copy(rockBase).lerp(rockHot, flashOf(t, "asteroid", i)));
      });
      rocks.instanceMatrix.needsUpdate = true;
      dirty(rocks);
    },
    lamp(l, t, time) {
      if (l.tag !== "rocket") return undefined;
      const lock = (t.toys as SpaceToys).lock;
      if (lock.phase === "countdown") {
        // Counting down: 3, 2, 1 lamps go out in turn.
        const left = 3 - Math.floor(((t.world.t - lock.phaseAt) / 2) * 3);
        return { k: l.index < left ? 1 : 0, color: "#ff7a3d" };
      }
      void time;
      return { k: lock.progress > l.index ? 1 : flashOf(t, "rocket", l.index), color };
    },
    dispose() {
      for (const x of own) x.dispose();
    },
  };
};
