/**
 * One cabinet's physics: the play area behind the glass, seen from the front, in cabinet units
 * (u, about 25 cm of a real machine, y up, the floor at y = 0 and the left wall at x = 0).
 *
 * The claw hangs from a trolley on the rail: a short swinging hanger, a cable whose length a motor
 * sets, and the head with two fingers. The cable motor lowers the claw until something stops it,
 * then lets it settle under its own weight; the fingers are driven by motors whose torque is the
 * grip, so a grab holds or slips by itself.
 */
import {
  Box,
  Circle,
  Edge,
  Polygon,
  PrismaticJoint,
  RevoluteJoint,
  Vec2,
  World,
  type Body,
  type Contact,
} from "planck";
import { type DesignId, DESIGNS } from "./designs";

/** Gravity at 25 cm a unit, so things fall as fast as in a real machine. */
export const GRAVITY = 39;

export const HEAD = { hw: 0.15, hh: 0.11 } as const;
/** Finger hinges, from the head's centre. */
export const HINGE = { x: 0.1, y: -0.09 } as const;
/** The right finger from its hinge, closed: down and out, then a tip turning in. */
export const FINGER = {
  knee: [0.08, -0.29] as const,
  tip: [-0.06, -0.46] as const,
  thick: 0.035,
} as const;
/** Finger angles: closed a little past straight, open about 50°. */
export const CLOSED = -0.08;
export const OPEN = 0.85;
/** The head's centre below the rail when the cable is all the way up, u. */
export const HANG = 0.28;
/** The hanger swings at most this far either way, radians. */
const SWING = 0.08;
const SWING_FRICTION = 0.6;
/** Width of the chute's hole, the guard's height and thickness, u. */
export const CHUTE = { width: 1.02, guard: 0.7, wall: 0.06 } as const;
/** The padded slopes in the floor's corners, u. */
export const FILLET = { w: 0.42, h: 0.5 } as const;
/** Below this the prize has gone down the chute. */
const GONE_Y = -0.45;

const CLAW_GROUP = -1;
const PRIZE_DENSITY = 1.3;
/**
 * Plush squashes, so each prize collides as a slightly smaller copy of its drawing: drawn prizes
 * overlap a little, as in a real heap, and fingertips can slip in between them.
 */
export const SQUASH = 0.85;
const FINGER_SPEED = 3;

export interface CabinetSpec {
  /** Inside of the glass, u. */
  width: number;
  height: number;
  /** Hidden space above the glass, where prizes are dropped in from. */
  canopy: number;
  /** The chute's side: -1 left, 1 right. */
  chute: -1 | 1;
}

export interface Prize {
  id: number;
  design: DesignId;
  colour: number;
  body: Body;
}

export interface StepResult {
  /** Prizes that went down the chute this step, already removed. */
  won: Prize[];
  /** Prizes that got out some other way (never expected), already removed. */
  lost: Prize[];
}

export interface CabinetWorld {
  readonly spec: CabinetSpec;
  readonly world: World;
  readonly prizes: readonly Prize[];
  readonly trolley: Body;
  readonly hanger: Body;
  readonly head: Body;
  readonly fingers: readonly [Body, Body];
  /** Rail height and the trolley's range, u. */
  readonly railY: number;
  readonly minX: number;
  readonly maxX: number;
  /** How far the cable lets the claw down, u. */
  readonly maxDepth: number;
  /** The chute: hole from x0 to x1, guard wall at the hole's inner edge. */
  readonly hole: { x0: number; x1: number; centre: number; guardX: number };
  /** Where the claw rests and lets go: over the hole, as near its middle as the rail allows. */
  readonly home: number;
  addPrize(design: DesignId, colour: number, x: number, y: number, angle?: number): Prize;
  removePrize(p: Prize): void;
  trolleyX(): number;
  setTrolleyVelocity(v: number): void;
  /** How far the cable has let the claw down, u, and how fast it is going down. */
  depth(): number;
  depthSpeed(): number;
  /**
   * Drive the cable at `speed` (positive lowers) with up to `force`; force 0 lets the claw settle
   * under its own weight, no lower than `floor` u down.
   */
  setCable(speed: number, force: number, floor?: number): void;
  /** Drive the fingers open (1) or closed (-1) with `torque`. */
  setGrip(dir: 1 | -1, torque: number): void;
  /** How open the fingers are, 0 closed to 1 open, averaged. */
  openness(): number;
  /** Prizes touching a finger now. */
  touching(): Prize[];
  /** Prizes lying on top of the claw's head. */
  onHead(): Prize[];
  step(dt: number): StepResult;
  dispose(): void;
}

/** A thick segment from a to b as a convex quad. */
const bar = (a: readonly [number, number], b: readonly [number, number], t: number) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * t;
  const ny = (dx / len) * t;
  return [
    Vec2(a[0] + nx, a[1] + ny),
    Vec2(b[0] + nx, b[1] + ny),
    Vec2(b[0] - nx, b[1] - ny),
    Vec2(a[0] - nx, a[1] - ny),
  ];
};

/** The right finger's outline from its hinge; the left is its mirror image. */
export const fingerOutline = (side: -1 | 1) => {
  const m = (p: readonly [number, number]) => [p[0] * side, p[1]] as const;
  return {
    upper: bar(m([0, 0]), m(FINGER.knee), FINGER.thick),
    tip: bar(m(FINGER.knee), m(FINGER.tip), FINGER.thick),
  };
};

export const createCabinetWorld = (spec: CabinetSpec): CabinetWorld => {
  const world = new World({ gravity: Vec2(0, -GRAVITY) });
  const { width: W, height: H, canopy } = spec;
  const top = H + canopy;

  const holeX0 = spec.chute > 0 ? W - CHUTE.width : 0;
  const holeX1 = spec.chute > 0 ? W : CHUTE.width;
  const guardX = spec.chute > 0 ? holeX0 : holeX1 - CHUTE.wall;
  const hole = {
    x0: spec.chute > 0 ? holeX0 + CHUTE.wall : holeX0,
    x1: spec.chute > 0 ? holeX1 : holeX1 - CHUTE.wall,
    centre: 0,
    guardX,
  };
  hole.centre = (hole.x0 + hole.x1) / 2;

  const ground = world.createBody();
  const wall = { friction: 0.5, restitution: 0.02 };
  ground.createFixture(new Edge(Vec2(0, -2), Vec2(0, top)), wall);
  ground.createFixture(new Edge(Vec2(W, -2), Vec2(W, top)), wall);
  ground.createFixture(new Edge(Vec2(0, top), Vec2(W, top)), wall);
  // The floor rises in padded slopes at the wall and the guard, so prizes slide back to where
  // the claw can reach them.
  const floor0 = spec.chute > 0 ? 0 : holeX1;
  const floor1 = spec.chute > 0 ? holeX0 : W;
  const floorFix = { friction: 0.9 };
  ground.createFixture(new Edge(Vec2(floor0, FILLET.h), Vec2(floor0 + FILLET.w, 0)), floorFix);
  ground.createFixture(new Edge(Vec2(floor0 + FILLET.w, 0), Vec2(floor1 - FILLET.w, 0)), floorFix);
  ground.createFixture(new Edge(Vec2(floor1 - FILLET.w, 0), Vec2(floor1, FILLET.h)), floorFix);
  ground.createFixture(
    new Box(CHUTE.wall / 2, CHUTE.guard / 2, Vec2(guardX + CHUTE.wall / 2, CHUTE.guard / 2), 0),
    { friction: 0.4, restitution: 0.05 },
  );
  // The bottom of the chute, out of sight, so nothing falls for ever.
  ground.createFixture(new Edge(Vec2(holeX0, -1.8), Vec2(holeX1, -1.8)), wall);

  const railY = H - 0.1;
  // Half the open claw's span, and a little, so open fingers clear the walls.
  const reach = 0.5;
  const minX = reach;
  const maxX = W - reach;
  // Down to the floor with the fingers open, and no further.
  const maxDepth = Math.max(0.2, railY - HANG - 0.42);

  const home = Math.max(minX, Math.min(maxX, hole.centre));
  const trolley = world.createKinematicBody({ position: Vec2(home, railY) });
  const hanger = world.createDynamicBody({ position: Vec2(home, railY), angularDamping: 0.8 });
  hanger.createFixture(new Box(0.04, 0.04), { density: 3, filterMaskBits: 0 });
  const swing = world.createJoint(
    new RevoluteJoint(
      {
        enableLimit: true,
        lowerAngle: -SWING,
        upperAngle: SWING,
        enableMotor: true,
        maxMotorTorque: SWING_FRICTION,
        motorSpeed: 0,
      },
      trolley,
      hanger,
      Vec2(home, railY),
    ),
  )!;
  void swing;

  const headAt = Vec2(home, railY - HANG);
  const head = world.createDynamicBody({ position: headAt, linearDamping: 0.3 });
  const clawFix = { friction: 0.45, restitution: 0.02, filterGroupIndex: CLAW_GROUP };
  head.createFixture(new Box(HEAD.hw, HEAD.hh), { ...clawFix, density: 4 });
  const cable = world.createJoint(
    new PrismaticJoint(
      {
        enableLimit: true,
        lowerTranslation: 0,
        upperTranslation: maxDepth,
        enableMotor: true,
        maxMotorForce: 200,
        motorSpeed: 0,
      },
      hanger,
      head,
      headAt,
      Vec2(0, -1),
    ),
  )!;

  const makeFinger = (side: -1 | 1) => {
    const hinge = Vec2(headAt.x + HINGE.x * side, headAt.y + HINGE.y);
    const f = world.createDynamicBody({ position: hinge, angularDamping: 2 });
    const { upper, tip } = fingerOutline(side);
    f.createFixture(new Polygon(upper), { ...clawFix, density: 4 });
    f.createFixture(new Polygon(tip), { ...clawFix, density: 4 });
    // The right finger opens with a positive angle, the left with a negative one.
    const joint = world.createJoint(
      new RevoluteJoint(
        {
          enableLimit: true,
          lowerAngle: side > 0 ? CLOSED : -OPEN,
          upperAngle: side > 0 ? OPEN : -CLOSED,
          enableMotor: true,
          maxMotorTorque: 2,
          motorSpeed: FINGER_SPEED * side,
        },
        head,
        f,
        hinge,
      ),
    )!;
    return { body: f, joint, side };
  };
  const left = makeFinger(-1);
  const right = makeFinger(1);

  const prizes: Prize[] = [];
  let nextId = 1;

  const addPrize = (design: DesignId, colour: number, x: number, y: number, angle = 0): Prize => {
    const d = DESIGNS[design];
    const body = world.createDynamicBody({
      position: Vec2(x, y),
      angle,
      linearDamping: 0.15,
      angularDamping: 0.6,
    });
    for (const part of d.parts) {
      const k = SQUASH;
      const shape =
        part.kind === "circle"
          ? new Circle(Vec2(part.x * k, part.y * k), part.r * k)
          : new Polygon(part.points.map(([px, py]) => Vec2(px * k, py * k)));
      body.createFixture(shape, {
        density: PRIZE_DENSITY / (k * k),
        friction: 0.9,
        restitution: 0.04,
      });
    }
    const p: Prize = { id: nextId++, design, colour, body };
    body.setUserData(p);
    prizes.push(p);
    return p;
  };

  const removePrize = (p: Prize) => {
    const i = prizes.indexOf(p);
    if (i >= 0) prizes.splice(i, 1);
    world.destroyBody(p.body);
  };

  const touching = (): Prize[] => {
    const out = new Set<Prize>();
    for (const f of [left.body, right.body]) {
      for (let e = f.getContactList(); e; e = e.next ?? null) {
        const c: Contact = e.contact;
        if (!c.isTouching()) continue;
        const other = e.other?.getUserData() as Prize | undefined;
        if (other && prizes.includes(other)) out.add(other);
      }
    }
    return [...out];
  };

  const onHead = (): Prize[] => {
    const out: Prize[] = [];
    const hy = head.getPosition().y;
    for (let e = head.getContactList(); e; e = e.next ?? null) {
      if (!e.contact.isTouching()) continue;
      const other = e.other?.getUserData() as Prize | undefined;
      if (other && prizes.includes(other) && other.body.getPosition().y > hy + 0.05)
        out.push(other);
    }
    return out;
  };

  const wake = () => {
    for (const b of [hanger, head, left.body, right.body]) b.setAwake(true);
  };

  return {
    spec,
    world,
    prizes,
    trolley,
    hanger,
    head,
    fingers: [left.body, right.body],
    railY,
    minX,
    maxX,
    maxDepth,
    hole,
    home,
    addPrize,
    removePrize,
    trolleyX: () => trolley.getPosition().x,
    setTrolleyVelocity(v) {
      trolley.setLinearVelocity(Vec2(v, 0));
      if (v !== 0) wake();
    },
    depth: () => cable.getJointTranslation(),
    depthSpeed: () => cable.getJointSpeed(),
    setCable(speed, force, floor = maxDepth) {
      cable.setMotorSpeed(speed);
      cable.setMaxMotorForce(force);
      cable.setLimits(0, Math.max(0, Math.min(maxDepth, floor)));
      wake();
    },
    setGrip(dir, torque) {
      left.joint.setMotorSpeed(-FINGER_SPEED * dir);
      right.joint.setMotorSpeed(FINGER_SPEED * dir);
      left.joint.setMaxMotorTorque(torque);
      right.joint.setMaxMotorTorque(torque);
      wake();
    },
    openness: () => {
      const r = right.joint.getJointAngle();
      const l = -left.joint.getJointAngle();
      return Math.max(0, Math.min(1, ((r + l) / 2 - CLOSED) / (OPEN - CLOSED)));
    },
    touching,
    onHead,
    step(dt) {
      world.step(dt, 10, 6);
      const won: Prize[] = [];
      const lost: Prize[] = [];
      for (let i = prizes.length - 1; i >= 0; i--) {
        const p = prizes[i]!;
        const pos = p.body.getPosition();
        if (pos.y < GONE_Y && pos.x > hole.x0 - 0.1 && pos.x < hole.x1 + 0.1) {
          removePrize(p);
          won.push(p);
        } else if (
          !Number.isFinite(pos.x) ||
          !Number.isFinite(pos.y) ||
          pos.x < -0.5 ||
          pos.x > W + 0.5 ||
          pos.y < GONE_Y - 0.2 ||
          pos.y > top
        ) {
          removePrize(p);
          lost.push(p);
        }
      }
      return { won, lost };
    },
    dispose() {
      for (let b = world.getBodyList(); b;) {
        const next = b.getNext();
        world.destroyBody(b);
        b = next;
      }
      prizes.length = 0;
    },
  };
};
