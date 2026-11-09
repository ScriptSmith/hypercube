/**
 * Fingers on the controls, in venue px. Pure: people's fingers and bots' injected touches both
 * come through here; index code tells them apart by `who`.
 *
 * - The lever jumps to the finger and follows it one to one; let go moving and it coasts.
 * - A dial turns with the finger's angle round its centre, one to one; only the change counts,
 *   so a finger can take a dial anywhere on it. A clockwise drag turns it the positive way.
 * - A button acts as the finger lands.
 * - Anywhere else on a view turns that view's camera.
 */
import { hitAt, type Hit, type Layout, leverAt } from "./layout";

export type Who = "person" | "bot";

export interface ControlHandlers {
  lever(stage: number, t: number, who: Who): void;
  /** Let go; `vt` is the lever's speed in its own units (2 is end to end) per second. */
  leverUp(stage: number, vt: number, who: Who): void;
  turn(stage: number, dial: number, delta: number, who: Who): void;
  orient(stage: number, k: number, who: Who): void;
  shape(stage: number, family: number, who: Who): void;
  viewDown(stage: number, view: number, id: number, x: number, y: number, who: Who): void;
  viewMove(stage: number, id: number, x: number, y: number): void;
  viewUp(stage: number, id: number, vx: number, tap: boolean): void;
}

interface Finger {
  hit: Hit;
  who: Who;
  /** Last angle round a dial's centre, or null inside its dead centre. */
  last: number | null;
}

/** A finger nearer a dial's centre than this share of its radius gives no reliable angle. */
const DEAD_CENTRE = 0.16;
const MAX_FINGERS = 40;

const wrap = (a: number) => {
  let r = (a + Math.PI) % (Math.PI * 2);
  if (r < 0) r += Math.PI * 2;
  return r - Math.PI;
};

export interface Controls {
  /** Returns what the finger landed on, or null for nothing. */
  down(id: number, x: number, y: number, who: Who): Hit | null;
  move(id: number, x: number, y: number): void;
  /** `vx` is the finger's speed across, venue px per second. */
  up(id: number, vx: number, cancelled?: boolean): void;
  /** The finger holding a control, if any. */
  holder(stage: number, kind: "lever" | "dial", index?: number): number | null;
  readonly fingers: ReadonlyMap<number, Finger>;
  setLayout(layout: Layout): void;
  clear(): void;
}

export const createControls = (initial: Layout, h: ControlHandlers): Controls => {
  let layout = initial;
  const fingers = new Map<number, Finger>();

  const dialOf = (hit: Hit) =>
    hit.kind === "dial" ? (layout.stages[hit.stage]?.dials[hit.index] ?? null) : null;
  const leverOf = (hit: Hit) =>
    hit.kind === "lever" ? (layout.stages[hit.stage]?.lever ?? null) : null;

  const drop = (id: number) => {
    fingers.delete(id);
  };

  return {
    fingers,
    down(id, x, y, who) {
      const hit = hitAt(layout, x, y);
      if (!hit) return null;
      if (fingers.size >= MAX_FINGERS) {
        const oldest = fingers.keys().next().value;
        if (oldest !== undefined) drop(oldest);
      }
      switch (hit.kind) {
        case "lever": {
          // A second finger on a lever takes it over.
          for (const [fid, f] of fingers) {
            if (f.hit.kind === "lever" && f.hit.stage === hit.stage) drop(fid);
          }
          fingers.set(id, { hit, who, last: null });
          const l = leverOf(hit);
          if (l) h.lever(hit.stage, leverAt(l, x), who);
          break;
        }
        case "dial": {
          for (const [fid, f] of fingers) {
            if (f.hit.kind === "dial" && f.hit.stage === hit.stage && f.hit.index === hit.index)
              drop(fid);
          }
          const d = dialOf(hit);
          let last: number | null = null;
          if (d && Math.hypot(x - d.x, y - d.y) >= d.r * DEAD_CENTRE)
            last = Math.atan2(y - d.y, x - d.x);
          fingers.set(id, { hit, who, last });
          // Touching a dial counts as using it, before it turns.
          h.turn(hit.stage, hit.index, 0, who);
          break;
        }
        case "orient":
          fingers.set(id, { hit, who, last: null });
          h.orient(hit.stage, hit.k, who);
          break;
        case "shape":
          fingers.set(id, { hit, who, last: null });
          h.shape(hit.stage, hit.family, who);
          break;
        case "view":
          fingers.set(id, { hit, who, last: null });
          h.viewDown(hit.stage, hit.view, id, x, y, who);
          break;
      }
      return hit;
    },
    move(id, x, y) {
      const f = fingers.get(id);
      if (!f) return;
      const hit = f.hit;
      if (hit.kind === "lever") {
        const l = leverOf(hit);
        if (l) h.lever(hit.stage, leverAt(l, x), f.who);
      } else if (hit.kind === "dial") {
        const d = dialOf(hit);
        if (!d) return;
        if (Math.hypot(x - d.x, y - d.y) < d.r * DEAD_CENTRE) {
          f.last = null;
          return;
        }
        const a = Math.atan2(y - d.y, x - d.x);
        if (f.last !== null) {
          const delta = wrap(a - f.last);
          if (delta !== 0) h.turn(hit.stage, hit.index, delta, f.who);
        }
        f.last = a;
      } else if (hit.kind === "view") {
        h.viewMove(hit.stage, id, x, y);
      }
    },
    up(id, vx, cancelled = false) {
      const f = fingers.get(id);
      if (!f) return;
      drop(id);
      const hit = f.hit;
      if (hit.kind === "lever") {
        const l = leverOf(hit);
        const half = l ? Math.max(1, (l.x1 - l.x0) / 2) : 1;
        h.leverUp(hit.stage, cancelled ? 0 : vx / half, f.who);
      } else if (hit.kind === "view") {
        h.viewUp(hit.stage, id, cancelled ? 0 : vx, !cancelled);
      }
    },
    holder(stage, kind, index = 0) {
      for (const [id, f] of fingers) {
        if (f.hit.stage !== stage) continue;
        if (kind === "lever" && f.hit.kind === "lever") return id;
        if (kind === "dial" && f.hit.kind === "dial" && f.hit.index === index) return id;
      }
      return null;
    },
    setLayout(next) {
      layout = next;
      fingers.clear();
    },
    clear() {
      fingers.clear();
    },
  };
};

// ---- The lever's coast ------------------------------------------------------------------------

export interface LeverState {
  t: number;
  /** Coasting speed, lever units per second. */
  v: number;
}

const COAST_TAU = 0.4;
const MIN_FLICK = 0.4;

/** Start a coast from a release speed (too slow a release just stops). */
export const releaseLever = (s: LeverState, vt: number): void => {
  s.v = Math.abs(vt) >= MIN_FLICK ? Math.max(-6, Math.min(6, vt)) : 0;
};

/** Advance a coasting lever; it stops at its ends. Returns true while it moves. */
export const coastLever = (s: LeverState, dt: number): boolean => {
  if (s.v === 0) return false;
  s.t += s.v * dt;
  s.v *= Math.exp(-dt / COAST_TAU);
  if (s.t <= -1 || s.t >= 1) {
    s.t = Math.max(-1, Math.min(1, s.t));
    s.v = 0;
  }
  if (Math.abs(s.v) < 0.05) s.v = 0;
  return true;
};
