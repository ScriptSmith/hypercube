/**
 * The marble run in 3D, through the frame's window view (src/core/view3d.ts): clear tubes behind,
 * twin-rod rails in front, the glass jar with its trapdoor, and the balls. Everything is laid out
 * in glass metres (runplan.ts) and placed along the eye's rays (glass.ts), so on a bank the
 * frames' tubes and the screen's are one object in the room and meet across the bezel.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  Scene,
  TorusGeometry,
  Vector3,
} from "three";
import { applyToCamera } from "../../core/view3d";
import { type Glass, Z_RAIL, Z_TUBE } from "./glass";
import { addLights, BALL_COLORS, type Look } from "./look";
import type { Run } from "./run";
import type { RunPlan } from "./runplan";

/** A tube to draw, glass metres: from its base up to its top, with a lip if its top shows. */
export interface TubeShape {
  x: number;
  y0: number;
  y1: number;
  lip: boolean;
  base: boolean;
}

export interface RunView {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  /** `tubeRb` is the balls' radius as they look in the tubes; `zRail` the rails' depth. */
  build(
    plan: RunPlan | null,
    glass: Glass,
    tubes: readonly TubeShape[],
    tubeRb: number,
    zRail?: number,
  ): void;
  sync(run: Run, time: number, dt: number): void;
  readonly particles: number;
  dispose(): void;
}

const MAX_BALLS = 100;
const MAX_SPARKS = 140;
const Y = new Vector3(0, 1, 0);

export const createRunView = (look: Look): RunView => {
  const own: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T): T => {
    own.push(x);
    return x;
  };
  const scene = new Scene();
  addLights(scene);
  const camera = new PerspectiveCamera();
  const unitCyl = keep(new CylinderGeometry(1, 1, 1, 18, 1, true));
  const solidCyl = keep(new CylinderGeometry(1, 1, 1, 10, 1, false));
  const unitBox = keep(new BoxGeometry(1, 1, 1));
  const plane = keep(new PlaneGeometry(1, 1));
  const torus = keep(new TorusGeometry(1, 0.14, 8, 28));
  torus.rotateX(Math.PI / 2);
  let fixed = new Group();
  scene.add(fixed);
  const door = new Group();
  const halo = new Mesh(plane, look.mat.halo.clone());
  own.push(halo.material as { dispose(): void });
  (halo.material as typeof look.mat.halo).color.set("#ffe7a3");
  halo.visible = false;
  scene.add(halo);

  const balls: Mesh[] = [];
  const ballGroup = new Group();
  scene.add(ballGroup);
  const ballMesh = (i: number) => {
    let m = balls[i];
    if (!m) {
      m = new Mesh(look.ballGeo, look.balls[0]);
      balls.push(m);
      ballGroup.add(m);
    }
    return m;
  };

  // One ball from the start, so its material's program compiles with the rest.
  ballMesh(0).visible = false;

  const sparkGeo = keep(new BufferGeometry());
  const sparkPos = new Float32Array(MAX_SPARKS * 3);
  const sparkCol = new Float32Array(MAX_SPARKS * 3);
  sparkGeo.setAttribute("position", new BufferAttribute(sparkPos, 3));
  sparkGeo.setAttribute("color", new BufferAttribute(sparkCol, 3));
  const sparkMat = keep(
    new PointsMaterial({
      size: 0.05,
      map: look.tex.glow,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    }),
  );
  const sparks = new Points(sparkGeo, sparkMat);
  sparks.frustumCulled = false;
  scene.add(sparks);
  const sparkList: {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    life: number;
    max: number;
    c: number;
  }[] = [];

  let glass: Glass | null = null;
  let plan: RunPlan | null = null;
  /** The balls' radius in venue space: one size wherever they are, so nearer looks bigger. */
  let worldR = 0.02;
  let zRail = Z_RAIL;
  const v0 = new Vector3();
  const v1 = new Vector3();
  const v2 = new Vector3();
  const dir = new Vector3();
  const q = new Quaternion();
  let jarCentre = new Vector3();
  let jarSize = { w: 0, h: 0, s: 1 };
  let liveSparks = 0;
  let lastPhase = "fill";

  /** A rod (or post) between two venue-space points. */
  const rod = (a: Vector3, b: Vector3, r: number, material: Mesh["material"] = look.mat.metal) => {
    const m = new Mesh(solidCyl, material);
    const len = a.distanceTo(b);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    q.setFromUnitVectors(Y, dir.copy(b).sub(a).normalize());
    m.quaternion.copy(q);
    m.scale.set(r, Math.max(1e-4, len), r);
    fixed.add(m);
    return m;
  };

  const build = (
    p: RunPlan | null,
    g: Glass,
    tubes: readonly TubeShape[],
    rb: number,
    railZ = Z_RAIL,
  ) => {
    scene.remove(fixed);
    fixed = new Group();
    scene.add(fixed);
    glass = g;
    plan = p;
    zRail = railZ;
    worldR = rb * g.scaleAt(Z_TUBE);
    applyToCamera(g.view, camera, 0.2, 60);
    const sT = g.scaleAt(Z_TUBE);
    const sR = g.scaleAt(zRail);
    const tubeR = rb * 1.28;
    for (const t of tubes) {
      g.world(t.x, t.y0, Z_TUBE, v0);
      g.world(t.x, t.y1, Z_TUBE, v1);
      const m = new Mesh(unitCyl, look.mat.glass);
      m.position.copy(v0).add(v1).multiplyScalar(0.5);
      m.scale.set(tubeR * sT, Math.max(1e-4, v1.y - v0.y), tubeR * sT);
      fixed.add(m);
      // Glass shows by its edges: a bright line down each side as the eye sees it.
      const toEye = v2.set(g.eye[0] - m.position.x, 0, g.eye[2] - m.position.z).normalize();
      for (const side of [-1, 1]) {
        const ox = -toEye.z * side * tubeR * sT * 0.86;
        const oz = toEye.x * side * tubeR * sT * 0.86;
        rod(
          new Vector3(v0.x + ox, v0.y, v0.z + oz),
          new Vector3(v1.x + ox, v1.y, v1.z + oz),
          tubeR * sT * 0.07,
          look.mat.edge,
        );
      }
      if (t.lip) {
        const lip = new Mesh(torus, look.mat.metal);
        lip.position.copy(v1);
        lip.scale.setScalar(tubeR * sT);
        fixed.add(lip);
      }
      if (t.base) {
        const collar = new Mesh(solidCyl, look.mat.brass);
        collar.position.copy(v0);
        collar.position.y += tubeR * sT * 0.35;
        collar.scale.set(tubeR * sT * 1.12, tubeR * sT * 0.7, tubeR * sT * 1.12);
        fixed.add(collar);
      }
    }
    if (!p) return;
    const r = p.rb;
    const railR = p.railR * sR;
    const drop = r;
    const spread = 0.55 * r;
    for (const path of p.paths) {
      for (let i = 0; i < path.pts.length - 1; i++) {
        if (path.fall[i]) continue;
        const a = path.pts[i]!;
        const b = path.pts[i + 1]!;
        // Run each rail a little past its ends so the ball sits on it all the way.
        const dx = Math.sign(b.x - a.x) * r * 0.6;
        for (const side of [-1, 1]) {
          const z = zRail + side * spread;
          rod(
            g.world(a.x - dx, a.y - drop, z, new Vector3()),
            g.world(b.x + dx, b.y - drop, z, new Vector3()),
            railR,
          );
        }
        // Cross ties underneath, and a stopper at the outer end of the top rail.
        const ties = Math.max(2, Math.round(Math.abs(b.x - a.x) / (r * 6)));
        for (let k = 0; k <= ties; k++) {
          const f = k / ties;
          const x = a.x + (b.x - a.x) * f;
          const y = a.y + (b.y - a.y) * f - drop - p.railR * 1.6;
          rod(
            g.world(x, y, zRail - spread * 1.3, new Vector3()),
            g.world(x, y, zRail + spread * 1.3, new Vector3()),
            railR * 0.8,
            look.mat.brass,
          );
        }
        if (i === 0) {
          rod(
            g.world(a.x - dx * 1.2, a.y - drop, zRail, new Vector3()),
            g.world(a.x - dx * 1.2, a.y + r * 0.6, zRail, new Vector3()),
            railR * 1.6,
            look.mat.brass,
          );
        }
      }
    }
    // The jar: glass walls, a rim, the trapdoor and a stand down to the floor.
    const j = p.jar;
    const depth = 2.4 * r;
    g.world(j.cx, j.bottom + j.h / 2, zRail, jarCentre);
    jarCentre = jarCentre.clone();
    jarSize = { w: j.w * sR, h: j.h * sR, s: sR };
    const W = j.w * sR;
    const H = j.h * sR;
    const D = depth * sR;
    const wall = (x: number, z: number, sx: number, sz: number, ry: number) => {
      const m = new Mesh(plane, look.mat.glass);
      m.position.set(jarCentre.x + x, jarCentre.y, jarCentre.z + z);
      m.rotation.y = ry;
      m.scale.set(sx, H, sz);
      fixed.add(m);
    };
    wall(0, D / 2, W, 1, 0);
    wall(0, -D / 2, W, 1, 0);
    wall(-W / 2, 0, D, 1, Math.PI / 2);
    wall(W / 2, 0, D, 1, Math.PI / 2);
    const rimT = r * 0.22 * sR;
    for (const [sx, sz, x, z] of [
      [W + rimT * 2, rimT, 0, D / 2],
      [W + rimT * 2, rimT, 0, -D / 2],
      [rimT, D, -W / 2, 0],
      [rimT, D, W / 2, 0],
    ] as const) {
      const m = new Mesh(unitBox, look.mat.metal);
      m.position.set(jarCentre.x + x, jarCentre.y + H / 2, jarCentre.z + z);
      m.scale.set(sx, rimT * 1.5, sz);
      fixed.add(m);
      const foot = new Mesh(unitBox, look.mat.metal);
      foot.position.set(jarCentre.x + x, jarCentre.y - H / 2 - rimT, jarCentre.z + z);
      foot.scale.set(sx, rimT * 2, sz);
      fixed.add(foot);
    }
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = jarCentre.x + (sx * W) / 2;
        const z = jarCentre.z + (sz * D) / 2;
        rod(
          new Vector3(x, jarCentre.y - H / 2, z),
          new Vector3(x, jarCentre.y + H / 2, z),
          rimT * 0.5,
          sz > 0 ? look.mat.edge : look.mat.metal,
        );
      }
    }
    // The trapdoor hinges on the jar's left edge.
    door.clear();
    door.position.set(jarCentre.x - W / 2, jarCentre.y - H / 2, jarCentre.z);
    const plate = new Mesh(unitBox, look.mat.brass);
    plate.position.set(W / 2, -rimT * 0.5, 0);
    plate.scale.set(W, rimT, D);
    door.add(plate);
    fixed.add(door);
    const floorY = g.world(j.cx, p.floor, zRail, v0).y;
    const standTop = jarCentre.y - H / 2 - rimT * 2;
    if (standTop - floorY > r * sR * 1.5) {
      for (const side of [-1, 1]) {
        rod(
          new Vector3(jarCentre.x + side * W * 0.38, floorY, jarCentre.z),
          new Vector3(jarCentre.x + side * W * 0.38, standTop, jarCentre.z),
          r * 0.3 * sR,
        );
      }
      const foot = new Mesh(unitBox, look.mat.metal);
      foot.position.set(jarCentre.x, floorY + rimT, jarCentre.z);
      foot.scale.set(W * 1.1, rimT * 2, D * 1.2);
      fixed.add(foot);
    }
    halo.position.set(jarCentre.x, jarCentre.y, jarCentre.z - D);
    halo.scale.set(W * 2.6, H * 2, 1);
    sparkMat.size = r * sR * 0.9;
  };

  const spark = (x: number, y: number, z: number, c: number, speed: number) => {
    if (sparkList.length >= MAX_SPARKS) sparkList.shift();
    const a = Math.random() * Math.PI * 2;
    const life = 0.6 + Math.random() * 0.8;
    sparkList.push({
      x,
      y,
      z,
      vx: Math.cos(a) * speed * (0.3 + Math.random()),
      vy: Math.abs(Math.sin(a)) * speed * (0.6 + Math.random()),
      life,
      max: life,
      c,
    });
  };

  const colorOf = (c: number) => {
    const hex = BALL_COLORS[c % BALL_COLORS.length] ?? "#ffffff";
    const n = Number.parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] as const;
  };

  return {
    scene,
    camera,
    build,
    sync(run, time, dt) {
      const g = glass;
      if (!g) return;
      let n = 0;
      for (const b of run.balls) {
        if (n >= MAX_BALLS) break;
        if (b.alpha <= 0.01) continue;
        const z = Z_TUBE + (zRail - Z_TUBE) * b.depth;
        const m = ballMesh(n++);
        m.visible = true;
        g.world(b.x, b.y, z, m.position);
        const s = worldR * (b.state === "out" ? 0.6 + 0.4 * b.alpha : 1);
        m.scale.setScalar(s);
        m.rotation.set(0.5, 0, b.spin);
        m.material = look.balls[b.color % look.balls.length]!;
      }
      for (let i = n; i < balls.length; i++) balls[i]!.visible = false;

      // The jar: the trapdoor swings down, and a full jar glows and sparkles.
      door.rotation.z = -run.jar.door * 1.7;
      const phase = run.jar.phase;
      const full = phase === "full";
      halo.visible = full || phase === "open";
      if (halo.visible) {
        const hm = halo.material as typeof look.mat.halo;
        hm.opacity = full ? 0.35 + 0.3 * Math.sin(time * 9) : Math.max(0, 0.5 - run.jar.phaseT);
      }
      if (plan && (full || (phase === "open" && lastPhase !== "open"))) {
        const k = phase === "open" ? 40 : Math.random() < dt * 30 ? 1 : 0;
        for (let i = 0; i < k; i++) {
          spark(
            jarCentre.x + (Math.random() - 0.5) * jarSize.w,
            jarCentre.y + jarSize.h * (0.5 + Math.random() * 0.2),
            jarCentre.z,
            Math.floor(Math.random() * BALL_COLORS.length),
            plan.rb * jarSize.s * 14,
          );
        }
      }
      lastPhase = phase;
      let live = 0;
      const grav = (plan?.rb ?? 0.02) * jarSize.s * 60;
      for (let i = sparkList.length - 1; i >= 0; i--) {
        const p = sparkList[i]!;
        p.life -= dt;
        if (p.life <= 0) {
          sparkList.splice(i, 1);
          continue;
        }
        p.vy -= grav * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      for (const p of sparkList) {
        const f = Math.min(1, p.life / p.max) * 1.3;
        const [r, gg, bb] = colorOf(p.c);
        sparkPos[live * 3] = p.x;
        sparkPos[live * 3 + 1] = p.y;
        sparkPos[live * 3 + 2] = p.z;
        sparkCol[live * 3] = r * f;
        sparkCol[live * 3 + 1] = gg * f;
        sparkCol[live * 3 + 2] = bb * f;
        live++;
      }
      liveSparks = live;
      (sparkGeo.getAttribute("position") as BufferAttribute).needsUpdate = true;
      (sparkGeo.getAttribute("color") as BufferAttribute).needsUpdate = true;
      sparkGeo.setDrawRange(0, live);
    },
    get particles() {
      return liveSparks;
    },
    dispose() {
      for (const x of own) x.dispose();
      own.length = 0;
      balls.length = 0;
      sparkList.length = 0;
    },
  };
};
