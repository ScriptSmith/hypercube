/**
 * A touch frame in a bank sends its craft to the screen above it. The frame never waits for or
 * hears back from the screen: with no screen in the roster it sends nothing and plays on.
 */
import type { Channel } from "../../core/types";
import type { Crew } from "./crew";
import { FLAG, type Pose, poseAt } from "./ghost";
import { encodeShip, SHIP_FLAG, SHIP_HZ, type Ship, type ShipGeometry, TOPIC_SHIP } from "./wire";

/** Screens a frame sends to at most (one is usual). */
const MAX_SCREENS = 2;

export interface ShipMeta {
  pos: number;
  count: number;
  seed: number;
  geo: ShipGeometry;
}

const pose: Pose = { x: 0, y: 0, a: 0, flags: 0 };

/** Engine bits as drawn: nothing while landed, bumped or out of fuel. */
export const shipFlags = (c: Crew): number => {
  if (c.phase !== "flying") return 0;
  const th = c.thrust;
  let f = 0;
  if (th.power > 0) {
    f =
      (th.left ? FLAG.left : 0) |
      (th.right ? FLAG.right : 0) |
      (th.main ? FLAG.main : 0) |
      (th.turnLeft ? FLAG.turnLeft : 0) |
      (th.turnRight ? FLAG.turnRight : 0);
  }
  if (c.helping === 0) f |= SHIP_FLAG.faintLeft;
  if (c.helping === 1) f |= SHIP_FLAG.faintRight;
  if (c.sputtering) f |= SHIP_FLAG.sputter;
  return f;
};

/** One crew's state as a `ship` message. `t` is the sender's ms. */
export const shipOf = (c: Crew, meta: ShipMeta, t: number): Ship => {
  const ghost =
    c.ghost && c.ghostAlpha > 0 && poseAt(c.ghost, c.runT, pose)
      ? { x: pose.x, y: pose.y, a: pose.a, flags: pose.flags, alpha: c.ghostAlpha }
      : null;
  return {
    t,
    pos: meta.pos,
    count: meta.count,
    seed: meta.seed,
    terrain: c.terrainKey,
    geo: meta.geo,
    x: c.craft.x,
    y: c.craft.y,
    a: c.craft.a,
    vx: c.craft.vx,
    vy: c.craft.vy,
    flags: shipFlags(c),
    phase: c.phase,
    phaseT: c.phaseT,
    stars: c.phase === "landed" ? (c.outcome?.stars ?? 0) : 0,
    attract: c.mode === "auto",
    run: c.run,
    wind: c.wind,
    ghost,
  };
};

export interface Uplink {
  /** Send the crew's state if one is due. Returns how many screens it went to. */
  tick(now: number, crew: Crew): number;
  readonly sent: number;
}

export const createUplink = (net: Channel, side: number, meta: () => ShipMeta): Uplink => {
  const every = 1000 / SHIP_HZ;
  let at = Number.NEGATIVE_INFINITY;
  let sent = 0;
  return {
    tick(now, crew) {
      // A little early rather than late, so a 60 Hz loop still sends 15 a second.
      if (now - at < every - 4 || !net.online) return 0;
      at = now;
      let n = 0;
      let msg: unknown = null;
      for (const p of net.peers()) {
        if (p.role !== "screen" || (p.side ?? 0) !== side || p.frame === net.self) continue;
        msg ??= encodeShip(shipOf(crew, meta(), Math.round(now)));
        net.send(TOPIC_SHIP, msg, p.frame);
        sent++;
        if (++n >= MAX_SCREENS) break;
      }
      return n;
    },
    get sent() {
      return sent;
    },
  };
};
