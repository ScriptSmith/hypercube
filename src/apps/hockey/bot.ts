/**
 * Bot players. A bot looks at the lane every so often (its reaction time), picks a plan, and
 * moves its mallet's target; the mallet then chases the target under the bot's speed cap.
 * Aim and prediction carry a random error, so bots miss sometimes and children can beat them.
 */
import type { Rng } from "../../core/types";
import type { LaneParams, Mallet, Puck } from "./physics";

export interface Skill {
  /** Seconds between looks at the lane, min and max. */
  think: readonly [number, number];
  /** Spread of position errors, as a fraction of the lane width. */
  error: number;
  /** Speed cap as a fraction of the lane's mallet cap. */
  cap: number;
  /** Rally bots aim at the other player instead of the goal and hit softly. */
  rally: boolean;
}

export const SKILLS = {
  /** Attract mode: a slow, friendly rally. */
  attract: { think: [0.35, 0.6], error: 0.05, cap: 0.2, rally: true },
  /** Fills a side in a match. Beatable by a child. */
  match: { think: [0.2, 0.38], error: 0.11, cap: 0.38, rally: false },
  /** One of several bots sharing a long versus lane; each is weaker so pucks get through. */
  zone: { think: [0.26, 0.45], error: 0.17, cap: 0.3, rally: false },
} as const satisfies Record<string, Skill>;

export type SkillName = keyof typeof SKILLS;

export interface Bot {
  rng: Rng;
  skill: Skill;
  /** Lane time of the next look. */
  next: number;
  /** Error for this plan, in px. */
  ex: number;
  ey: number;
  /** Where on the far goal (−1..1 of the mouth) this bot is aiming. */
  aim: number;
}

export const createBot = (rng: Rng, skill: Skill = SKILLS.match): Bot => ({
  rng,
  skill,
  next: 0,
  ex: 0,
  ey: 0,
  aim: 0,
});

export const setSkill = (bot: Bot, skill: Skill, mallet: Mallet, lane: LaneParams): void => {
  bot.skill = skill;
  bot.next = 0;
  mallet.cap = lane.maxMallet * skill.cap;
};

/** Roughly normal, mean 0, sd about 0.4. */
const wobble = (rng: Rng) => rng.next() + rng.next() - 1;

/** Fold a coordinate into [lo, hi] as if it bounced between walls there. */
export const reflect = (v: number, lo: number, hi: number): number => {
  const span = hi - lo;
  if (span <= 0) return lo;
  let t = (v - lo) % (2 * span);
  if (t < 0) t += 2 * span;
  return lo + (t <= span ? t : 2 * span - t);
};

/** How far a puck has to go to reach this player's goal, and its speed towards it. */
const towardsGoal = (lane: LaneParams, m: Mallet, p: Puck) =>
  m.goalEnd === 0 ? { u: p.x, vu: -p.vx } : { u: lane.length - p.x, vu: p.vx };

const fromU = (lane: LaneParams, m: Mallet, u: number) => (m.goalEnd === 0 ? u : lane.length - u);

/**
 * Update a bot's plan if it is time to look again, and point its mallet. `time` is lane time
 * in seconds; `tempo` is the lane's current speed scale.
 */
export const driveBot = (
  bot: Bot,
  lane: LaneParams,
  m: Mallet,
  pucks: readonly Puck[],
  time: number,
  aims?: readonly { x: number; y: number }[],
): void => {
  if (time < bot.next) return;
  const { think, error } = bot.skill;
  bot.next = time + bot.rng.range(think[0], think[1]);
  bot.ex = wobble(bot.rng) * error * lane.width;
  bot.ey = wobble(bot.rng) * error * lane.width;
  if (lane.variant === "paddles") paddlePlan(bot, lane, m, pucks);
  else malletPlan(bot, lane, m, pucks, aims);
};

const paddlePlan = (bot: Bot, lane: LaneParams, m: Mallet, pucks: readonly Puck[]) => {
  const lineU = m.goalEnd === 0 ? m.x : lane.length - m.x;
  let best: Puck | null = null;
  let soonest = Infinity;
  for (const p of pucks) {
    if (!p.live) continue;
    const { u, vu } = towardsGoal(lane, m, p);
    if (vu <= 0 || u < lineU) continue;
    const t = (u - lineU) / vu;
    if (t < soonest) {
      soonest = t;
      best = p;
    }
  }
  if (!best) {
    m.ty = lane.width / 2 + bot.ey;
    return;
  }
  const y = reflect(best.y + best.vy * soonest, lane.puckR, lane.width - lane.puckR);
  // Meet the ball off-centre now and then to send it back at an angle.
  if (bot.rng.next() < 0.5) bot.aim = bot.rng.range(-0.55, 0.55);
  m.ty = y - bot.aim * lane.paddleHalf + bot.ey * 0.6;
};

const malletPlan = (
  bot: Bot,
  lane: LaneParams,
  m: Mallet,
  pucks: readonly Puck[],
  aims?: readonly { x: number; y: number }[],
) => {
  const { length: L, width: W, puckR: r, malletR: R } = lane;
  const zoneA = m.goalEnd === 0 ? m.zone.x0 : L - m.zone.x1;
  const zoneB = m.goalEnd === 0 ? m.zone.x1 : L - m.zone.x0;
  const span = Math.max(1, zoneB - zoneA);
  const defence = zoneA + Math.min(span * 0.12, R);
  const homeU = zoneA + span * 0.3;

  // Defend against the soonest puck heading for our line; otherwise attack a slow one nearby.
  let threat: Puck | null = null;
  let soonest = Infinity;
  let loose: Puck | null = null;
  let nearest = Infinity;
  for (const p of pucks) {
    if (!p.live) continue;
    const { u, vu } = towardsGoal(lane, m, p);
    const inReach = u > zoneA - R && u < zoneB + R + r;
    if (vu > lane.maxPuck * 0.08 && u > defence - R) {
      const t = (u - defence) / vu;
      if (t < soonest) {
        soonest = t;
        threat = p;
      }
    }
    if (inReach && vu < lane.maxPuck * 0.35) {
      const d = Math.hypot(p.x - m.x, p.y - m.y);
      if (d < nearest) {
        nearest = d;
        loose = p;
      }
    }
  }

  // Only the player guarding the goal reads far ahead; the others block at the last moment.
  const keeper = zoneA < R * 2;
  const horizon = keeper ? 1.2 : 0.45;
  if (threat && soonest < horizon && (!loose || soonest < 0.5)) {
    const y = reflect(threat.y + threat.vy * soonest, r, W - r);
    m.tx = fromU(lane, m, defence) + bot.ex * 0.3;
    // Reading further ahead is less accurate.
    m.ty = y + bot.ey * (1 + 1.5 * soonest);
    return;
  }

  // A puck tucked into a corner can't be hit out from behind; leave it for the table's air
  // to drift back into play rather than pinning it.
  if (loose && !cornered(lane, loose)) {
    strike(bot, lane, m, loose, aims);
    return;
  }

  m.tx = fromU(lane, m, homeU);
  m.ty = W / 2 + bot.ey;
};

const cornered = (lane: LaneParams, p: Puck) => {
  const reach = lane.malletR + lane.puckR;
  const nearSide = p.y < reach || p.y > lane.width - reach;
  const nearEnd = p.x < reach * 1.5 || p.x > lane.length - reach * 1.5;
  return nearSide && nearEnd;
};

/** Line up behind a puck and push through it towards the aim point. */
const strike = (
  bot: Bot,
  lane: LaneParams,
  m: Mallet,
  p: Puck,
  aims?: readonly { x: number; y: number }[],
) => {
  const { length: L, width: W, puckR: r, malletR: R } = lane;
  const farX = m.goalEnd === 0 ? L : 0;
  if (bot.rng.next() < 0.4) bot.aim = bot.rng.range(-1, 1);
  // Rallies aim for the middle of the other half; matches at the goal mouth; defence at a
  // target still to light.
  const target =
    aims && aims.length > 0
      ? aims[Math.floor(((bot.aim + 1) / 2) * aims.length) % aims.length]
      : null;
  const spread = bot.skill.rally ? W * 0.3 : lane.goalHalf * 0.8;
  const aimX = target ? target.x : bot.skill.rally ? (farX + L / 2) / 2 : farX;
  const aimY = target ? target.y + bot.ex : W / 2 + bot.aim * spread;
  let dx = aimX - p.x;
  let dy = aimY - p.y;
  const d = Math.hypot(dx, dy) || 1;
  dx /= d;
  dy /= d;
  const reach = R + r;
  const behindX = p.x - dx * (reach + r * 0.5);
  const behindY = p.y - dy * (reach + r * 0.5);
  // Ahead of the puck (between it and the aim): go round it rather than through it.
  const ahead = (m.x - p.x) * dx + (m.y - p.y) * dy;
  if (ahead > -reach * 0.3) {
    const side = (m.x - p.x) * -dy + (m.y - p.y) * dx >= 0 ? 1 : -1;
    m.tx = behindX - dy * side * reach;
    m.ty = behindY + dx * side * reach;
    return;
  }
  const lined = Math.hypot(m.x - behindX, m.y - behindY) < R * 0.8;
  const through = bot.skill.rally ? reach * 0.15 : reach * 0.6;
  m.tx = lined ? p.x + dx * through : behindX;
  m.ty = (lined ? p.y + dy * through : behindY) + bot.ey * 0.3;
};
