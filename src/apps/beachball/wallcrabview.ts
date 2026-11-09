/**
 * The crab drawn in 3D, facing the people: a rounded blue shell on eight lavender legs, two
 * pale claws (the right one bigger, as a ghost crab's), and dark eyes on stalks with lids that
 * come down into a scowl when it is cross. It is lit like the toys and tipped towards the people
 * the same way, so its face, claws and legs show.
 */
import {
  CapsuleGeometry,
  Color,
  ConeGeometry,
  Group,
  type Material,
  Mesh,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";
import { type Crab, CRAB_SIZE } from "./wallcrab";
import { mesh, paint, TILT } from "./wallpropview";

/** Paint for the crab, sRGB: a soldier crab's blues and lavender, and no red or yellow. */
export const CRAB_PAINT = {
  shell: "#4f95d6",
  shellTop: "#7db6ea",
  belly: "#e6edf2",
  leg: "#8a6fcf",
  joint: "#c9b9ec",
  claw: "#a8cdee",
  tip: "#f0f4f7",
  eye: "#15171d",
} as const;

/** A limb along +x from its joint: a capsule `length` long. */
const limb = (length: number, radius: number, m: Material) => {
  const g = new CapsuleGeometry(radius, Math.max(0.001, length - 2 * radius), 4, 10);
  g.rotateZ(-Math.PI / 2);
  g.translate(length / 2, 0, 0);
  return new Mesh(g, m);
};

/** A tapering claw finger along +x. */
const finger = (length: number, radius: number, m: Material) => {
  const g = new ConeGeometry(radius, length, 10);
  g.rotateZ(-Math.PI / 2);
  g.translate(length / 2, 0, 0);
  return new Mesh(g, m);
};

interface Leg {
  hip: Group;
  knee: Group;
  side: number;
  /** Which half of the gait it steps in. */
  phase: number;
  /** Fanned forwards or back. */
  spread: number;
}

interface Claw {
  shoulder: Group;
  elbow: Group;
  wrist: Group;
  hinge: Group;
  side: number;
}

interface Eye {
  stalk: Group;
  lid: Group;
  glint: Mesh;
  side: number;
}

export interface CrabView {
  readonly root: Group;
  /** Pose and place it, at `scale` stage px a metre. */
  update(c: Crab, scale: number): void;
}

export const createCrabView = (): CrabView => {
  const root = new Group();
  const body = new Group();
  root.add(body);
  const shell = paint({ color: new Color(CRAB_PAINT.shell), roughness: 0.42 });
  const shellTop = paint({ color: new Color(CRAB_PAINT.shellTop), roughness: 0.38 });
  const belly = paint({ color: new Color(CRAB_PAINT.belly), roughness: 0.6 });
  const legPaint = paint({ color: new Color(CRAB_PAINT.leg), roughness: 0.5 });
  const jointPaint = paint({ color: new Color(CRAB_PAINT.joint), roughness: 0.5 });
  const clawPaint = paint({ color: new Color(CRAB_PAINT.claw), roughness: 0.4 });
  const tipPaint = paint({ color: new Color(CRAB_PAINT.tip), roughness: 0.4 });
  const eyePaint = paint({ color: new Color(CRAB_PAINT.eye), roughness: 0.15 });
  const glintPaint = paint({
    color: new Color("#ffffff"),
    roughness: 0.3,
    emissive: new Color(0.6, 0.6, 0.6),
  });

  const carapace = mesh(new SphereGeometry(1, 28, 18), shell);
  carapace.scale.set(0.12, 0.052, 0.088);
  body.add(carapace);
  // A paler, rounder top, and a white underside.
  const crown = mesh(new SphereGeometry(1, 24, 14), shellTop, [0, 0.016, -0.004]);
  crown.scale.set(0.094, 0.042, 0.068);
  body.add(crown);
  const under = mesh(new SphereGeometry(1, 20, 12), belly, [0, -0.02, 0.006]);
  under.scale.set(0.103, 0.034, 0.074);
  body.add(under);

  const legs: Leg[] = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const hip = new Group();
      hip.position.set(side * 0.1, -0.012, 0.04 - i * 0.027);
      const spread = (i - 1.5) * 0.36;
      const knee = new Group();
      knee.position.set(0.1, 0, 0);
      hip.add(limb(0.105, 0.017, legPaint));
      hip.add(mesh(new SphereGeometry(0.019, 10, 8), jointPaint, [0.1, 0, 0]));
      const tibia = limb(0.17, 0.0135, legPaint);
      knee.add(tibia);
      knee.add(mesh(new ConeGeometry(0.008, 0.03, 8), jointPaint, [0.17, 0, 0]));
      hip.add(knee);
      // The left side is the right one turned about the vertical.
      const mount = new Group();
      mount.rotation.y = side < 0 ? Math.PI : 0;
      mount.position.copy(hip.position);
      hip.position.set(0, 0, 0);
      mount.add(hip);
      body.add(mount);
      legs.push({
        hip,
        knee,
        side,
        phase: (i + (side < 0 ? 1 : 0)) % 2 === 0 ? 0 : Math.PI,
        spread: side * spread,
      });
    }
  }

  const claws: Claw[] = [];
  for (const side of [-1, 1]) {
    const big = side > 0 ? 1.25 : 1;
    const shoulder = new Group();
    const mount = new Group();
    mount.position.set(side * 0.085, -0.004, 0.06);
    mount.scale.set(side * big, big, big);
    mount.add(shoulder);
    shoulder.add(limb(0.07, 0.015, clawPaint));
    const elbow = new Group();
    elbow.position.set(0.07, 0, 0);
    shoulder.add(elbow);
    elbow.add(mesh(new SphereGeometry(0.018, 10, 8), clawPaint));
    elbow.add(limb(0.06, 0.014, clawPaint));
    const wrist = new Group();
    wrist.position.set(0.06, 0, 0);
    elbow.add(wrist);
    const palm = mesh(new SphereGeometry(1, 16, 12), clawPaint, [0.036, 0, 0]);
    palm.scale.set(0.042, 0.03, 0.024);
    wrist.add(palm);
    const fixed = finger(0.055, 0.013, tipPaint);
    fixed.position.set(0.068, -0.01, 0);
    fixed.rotation.z = 0.12;
    wrist.add(fixed);
    const hinge = new Group();
    hinge.position.set(0.064, 0.012, 0);
    hinge.add(finger(0.05, 0.011, tipPaint));
    wrist.add(hinge);
    body.add(mount);
    claws.push({ shoulder, elbow, wrist, hinge, side });
  }

  const eyes: Eye[] = [];
  for (const side of [-1, 1]) {
    const stalk = new Group();
    stalk.position.set(side * 0.04, 0.03, 0.062);
    const s = limb(0.075, 0.008, shellTop);
    s.rotation.z = Math.PI / 2;
    stalk.add(s);
    const ball = mesh(new SphereGeometry(1, 16, 12), eyePaint, [0, 0.085, 0]);
    ball.scale.set(0.02, 0.028, 0.02);
    stalk.add(ball);
    const glint = mesh(new SphereGeometry(0.0065, 8, 6), glintPaint, [0, 0.094, 0.016]);
    stalk.add(glint);
    // The lid: a cap over the eye's top that comes down slanted into a scowl.
    const lid = new Group();
    lid.position.set(0, 0.085, 0);
    const cap = mesh(new SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), shell);
    cap.scale.set(0.0225, 0.031, 0.0225);
    lid.add(cap);
    stalk.add(lid);
    body.add(stalk);
    eyes.push({ stalk, lid, glint, side });
  }

  root.traverse((m) => {
    m.renderOrder = 2;
    m.frustumCulled = false;
  });
  const tilt = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), TILT);
  const roll = new Quaternion();
  const zAxis = new Vector3(0, 0, 1);
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;

  return {
    root,
    update(c, scale) {
      root.position.set(c.x * scale, (c.y + c.hop) * scale, 0);
      root.scale.setScalar(scale * CRAB_SIZE);
      roll.setFromAxisAngle(zAxis, c.lean);
      root.quaternion.copy(tilt).multiply(roll);
      body.position.y = 0.004 * Math.sin(c.gait * 2);

      for (const l of legs) {
        const p = c.gait + l.phase;
        const swing = Math.cos(p);
        const lift = Math.max(0, Math.sin(p));
        l.hip.rotation.y = l.spread + 0.12 * swing * l.side;
        l.hip.rotation.z = 0.45 + 0.28 * lift + 0.08 * swing;
        l.knee.rotation.z = -1.55 + 0.25 * swing - 0.2 * lift;
      }

      for (const k of claws) {
        const r = c.claws;
        const waved = c.waveSide === k.side ? c.wave : 0;
        const up = Math.max(r, waved);
        // Aim the raised claws at what it faces: towards it on its side, less on the far one.
        const aim = Math.atan2(c.lookY, c.lookX * k.side) - Math.PI / 4;
        // The claw on the side of what it pushes thrusts straight out at it.
        const out = c.thrust * Math.max(0, Math.sign(c.lookX) * k.side);
        k.shoulder.rotation.z = mix(
          mix(-0.55, 1.05, up) + 0.15 * r * Math.sin(c.open * 3),
          0.25 + 0.5 * c.lookY,
          out,
        );
        k.shoulder.rotation.y = mix(mix(-1.15, -0.45, up), -0.15, out);
        k.elbow.rotation.y = mix(mix(-1.75, -0.35, up), -0.05, out);
        k.elbow.rotation.z = mix(mix(0.25, 0.55, up), 0.05, out);
        k.wrist.rotation.z = mix(0.35, 0.2 + 0.4 * aim * r, up) + 0.3 * waved * Math.sin(c.t * 9);
        k.hinge.rotation.z = 0.08 + c.open * 0.75;
      }

      for (const e of eyes) {
        const up = c.eyes;
        e.stalk.rotation.x = mix(1.35, 0.12, up);
        e.stalk.rotation.z =
          -c.lookX * 0.25 + e.side * 0.08 * (1 - c.cross) - e.side * 0.1 * c.cross;
        e.glint.position.set(c.lookX * 0.008, 0.094 + c.lookY * 0.002, 0.016);
        // Lids come down over the top of the eye and slant in towards the middle.
        e.lid.rotation.x = mix(-1.25, 0.15, c.cross);
        e.lid.rotation.z = e.side * 0.55 * c.cross;
        e.lid.visible = c.cross > 0.05;
      }
    },
  };
};
