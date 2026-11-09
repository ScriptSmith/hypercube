/**
 * The autopilot: works out a pad command that rolls the ball along the way to the goal. It
 * follows the maze's next-cell field (so from anywhere, even a dead end, it knows the way), keeps
 * the ball on the corridor's centre line (or beside a hole, on its clear lane) and slows down
 * before every turn. Speed is held with a little feed-forward against the damping.
 *
 * It drives the demonstration (directly, with a ghost hand), the bots (through injected touches
 * on the pad) and, in together mode, the lever nobody is holding. Now and then, when asked, it
 * makes a mistake (a wobble, or a wander into a side passage) and then recovers.
 */
import type { Rng } from "../../core/types";
import type { Board } from "./board";
import { cellAt, cellCentre, E, N, S, W } from "./maze";
import { G } from "./physics";

export interface PilotOptions {
  rng: Rng;
  /** Speed it aims for along straight corridors, m/s. */
  speed: number;
  /** Acceleration at a full command, m/s^2. */
  aMax: number;
  /** Damping of the board's handling, per second, for the feed-forward. */
  damping: number;
  mistakes: boolean;
}

export interface Pilot {
  /** The pad command (unit disc, +x right, +y towards the viewer) for the board as it is now. */
  update(dt: number, board: Board): { x: number; y: number };
  readonly stats: { mistakes: number };
  reset(): void;
}

const GAIN = 3.2;
const LATERAL = 4;
const BRAKE = 0.45;
/** A mistake starts on average this often, per second, while rolling. */
const MISTAKE_RATE = 1 / 16;
const STUCK_S = 10;

const DIR_OF: Record<number, { dx: number; dz: number }> = {
  [N]: { dx: 0, dz: -1 },
  [E]: { dx: 1, dz: 0 },
  [S]: { dx: 0, dz: 1 },
  [W]: { dx: -1, dz: 0 },
};

export const createPilot = (o: PilotOptions): Pilot => {
  const out = { x: 0, y: 0 };
  const stats = { mistakes: 0 };
  let mistake: { kind: "wobble" | "wander"; t: number; x: number; y: number; cell: number } | null =
    null;
  let best = Number.POSITIVE_INFINITY;
  let since = 0;
  let mazeSeen: unknown = null;

  const drive = (vx: number, vz: number, board: Board) => {
    const b = board.ball;
    const ax = o.damping * vx + GAIN * (vx - b.vx);
    const az = o.damping * vz + GAIN * (vz - b.vz);
    let x = ax / o.aMax;
    let y = az / o.aMax;
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    out.x = x;
    out.y = y;
  };

  return {
    stats,
    reset() {
      mistake = null;
      best = Number.POSITIVE_INFINITY;
      since = 0;
      out.x = out.y = 0;
    },
    update(dt, board) {
      const m = board.maze;
      if (mazeSeen !== m) {
        mazeSeen = m;
        best = Number.POSITIVE_INFINITY;
        since = 0;
        mistake = null;
      }
      if (board.phase !== "roll") {
        out.x = out.y = 0;
        return out;
      }
      const b = board.ball;
      const c = cellAt(m, b.x, b.z);
      const dist = m.dist[c] ?? 0;
      if (dist < best) {
        best = dist;
        since = 0;
      } else since += dt;

      if (mistake) {
        mistake.t -= dt;
        if (mistake.t <= 0) mistake = null;
      } else if ((o.mistakes && o.rng.next() < MISTAKE_RATE * dt && dist > 1) || since > STUCK_S) {
        since = 0;
        const branches = [N, E, S, W].filter((bit) => {
          if (!((m.open[c] ?? 0) & bit)) return false;
          const d = DIR_OF[bit]!;
          const nb = c + d.dx + d.dz * m.cols;
          return nb !== m.next[c];
        });
        if (branches.length > 0 && o.rng.next() < 0.45) {
          const d = DIR_OF[o.rng.pick(branches)]!;
          mistake = {
            kind: "wander",
            t: 1 + o.rng.next(),
            x: 0,
            y: 0,
            cell: c + d.dx + d.dz * m.cols,
          };
        } else {
          const a = o.rng.next() * Math.PI * 2;
          mistake = {
            kind: "wobble",
            t: 0.5 + o.rng.next() * 0.5,
            x: Math.cos(a),
            y: Math.sin(a),
            cell: -1,
          };
        }
        stats.mistakes++;
      }
      if (mistake?.kind === "wobble") {
        out.x = mistake.x * 0.7;
        out.y = mistake.y * 0.7;
        return out;
      }

      const r = m.r;
      const s = Math.min(m.sx, m.sz);
      const vMax = o.speed;
      if (mistake?.kind === "wander" || c === m.goal) {
        const t = cellCentre(m, mistake?.kind === "wander" ? mistake.cell : m.goal);
        const dx = t.x - b.x;
        const dz = t.z - b.z;
        const k = c === m.goal ? 2.2 : 3;
        let vx = dx * k;
        let vz = dz * k;
        const l = Math.hypot(vx, vz);
        const cap = c === m.goal ? Math.min(vMax, 0.12) : vMax * 0.8;
        if (l > cap) {
          vx *= cap / l;
          vz *= cap / l;
        }
        drive(vx, vz, board);
        return out;
      }

      const n1 = m.next[c] ?? -1;
      if (n1 < 0) {
        out.x = out.y = 0;
        return out;
      }
      const c0 = cellCentre(m, c);
      const c1 = cellCentre(m, n1);
      const dx = Math.sign(Math.round((c1.x - c0.x) / m.sx));
      const dz = Math.sign(Math.round((c1.z - c0.z) / m.sz));
      // Across the way: +z when travelling along x, +x when travelling along z (the lane's axes).
      const ax = dx === 0 ? 1 : 0;
      const az = dx === 0 ? 0 : 1;
      const lane = (m.lane[c] ?? 0) !== 0 ? (m.lane[c] ?? 0) : (m.lane[n1] ?? 0);
      const e = (b.x - c0.x) * ax + (b.z - c0.z) * az - lane;
      // How far the way runs straight on from here, and whether it ends at the goal.
      let run = (c1.x - b.x) * dx + (c1.z - b.z) * dz;
      let cell = n1;
      for (let k = 0; k < 3; k++) {
        const nx = m.next[cell] ?? -1;
        if (nx < 0 || nx - cell !== n1 - c) break;
        run += dx !== 0 ? m.sx : m.sz;
        cell = nx;
      }
      const aBrake = BRAKE * o.aMax;
      // Past a hole, slowly and on its lane; elsewhere, lined up with the opening.
      const careful = lane !== 0;
      const top = careful ? vMax * 0.5 : vMax;
      let along = Math.min(top, Math.sqrt(2 * aBrake * Math.max(0, run - 0.1 * s)) + 0.03);
      const room = careful
        ? Math.max(r * 0.3, (s - m.wall) / 2 - 1.75 * r)
        : Math.max(r * 0.5, (s - m.wall) / 2 - r);
      along *= Math.min(1, Math.max(careful ? 0.08 : 0.15, 1 - Math.abs(e) / (room * 1.6)));
      let across = -(careful ? LATERAL * 1.5 : LATERAL) * e;
      if (Math.abs(across) > vMax) across = Math.sign(across) * vMax;
      drive(dx * along + ax * across, dz * along + az * across, board);
      return out;
    },
  };
};

/** Acceleration along the board at a full command, for a largest tilt. */
export const fullAccel = (maxTilt: number) => (5 / 7) * G * Math.sin(maxTilt);
