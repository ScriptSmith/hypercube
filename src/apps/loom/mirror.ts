/**
 * What a following frame knows of the frame in charge: the last beacon, carried forward between
 * beacons by the same easing the conductor uses, so an auto harmonic's thread moves smoothly
 * and stays where the screen draws it rather than stepping four times a second. Also the
 * beacon a conductor sends.
 */
import { type Conductor, easeTerm, INTRO_S, type Mode } from "./conductor";
import { MAX_H, type Variant } from "./config";
import { phaseDelta, type Target, targetFor, type Term, wrapPhase } from "./series";
import { BEACON_FLAG, type BeaconMsg, quantAmp, quantPhase, termOf } from "./wire";

const MODES: Mode[] = ["play", "weave", "rest"];
/** In `free`, followers ease towards the beacon's values over about this long. */
const FREE_S = 0.25;

export const beaconFrom = (c: Conductor, side: number, screen: boolean): BeaconMsg => ({
  s: side,
  c: screen ? 1 : 0,
  r: c.round,
  g: c.targetIndex >= 0 ? c.targetIndex : 255,
  m: MODES.indexOf(c.mode),
  t: Math.min(65535, Math.round(c.modeT * 100)),
  f: Math.round(c.fill * 100),
  w: c.cloth.woven % 65536,
  p: c.people ? 1 : 0,
  v: c.values.map((v, i) => [
    quantAmp(v.amp),
    quantPhase(v.phase),
    (c.live[i] ? BEACON_FLAG.live : 0) | (c.ok[i] ? BEACON_FLAG.ok : 0),
  ]),
});

export interface Mirror {
  readonly n: number;
  readonly values: readonly Term[];
  readonly live: readonly boolean[];
  readonly ok: readonly boolean[];
  readonly round: number;
  readonly targetIndex: number;
  target(): Target | null;
  readonly mode: Mode;
  readonly modeT: number;
  readonly fill: number;
  readonly woven: number;
  readonly people: boolean;
  /** Whether any beacon has been taken. */
  readonly heard: boolean;
  apply(m: BeaconMsg): void;
  step(dt: number): void;
}

export const createMirror = (variant: Variant): Mirror => {
  let values: Term[] = [];
  let goal: Term[] = [];
  let live: boolean[] = [];
  let ok: boolean[] = [];
  let round = 0;
  let targetIndex = -1;
  let mode: Mode = "play";
  let modeT = 0;
  let fill = 0;
  let woven = 0;
  let people = false;
  let heard = false;
  const target = () => (targetIndex >= 0 ? targetFor(targetIndex, values.length) : null);
  return {
    get n() {
      return values.length;
    },
    get values() {
      return values;
    },
    get live() {
      return live;
    },
    get ok() {
      return ok;
    },
    get round() {
      return round;
    },
    get targetIndex() {
      return targetIndex;
    },
    target,
    get mode() {
      return mode;
    },
    get modeT() {
      return modeT;
    },
    get fill() {
      return fill;
    },
    get woven() {
      return woven;
    },
    get people() {
      return people;
    },
    get heard() {
      return heard;
    },
    apply(m) {
      const n = Math.min(MAX_H, m.v.length);
      const incoming = m.v.slice(0, n).map(([a, ph]) => termOf(a, ph));
      if (variant === "free" && values.length === n) goal = incoming;
      else {
        values = incoming;
        goal = incoming.map((t) => ({ ...t }));
      }
      live = m.v.slice(0, n).map(([, , fl]) => (fl & BEACON_FLAG.live) !== 0);
      ok = m.v.slice(0, n).map(([, , fl]) => (fl & BEACON_FLAG.ok) !== 0);
      round = m.r;
      targetIndex = m.g === 255 ? -1 : m.g;
      mode = MODES[m.m] ?? "play";
      modeT = m.t / 100;
      fill = m.f / 100;
      woven = m.w;
      people = m.p === 1;
      heard = true;
    },
    step(dt) {
      if (!heard) return;
      modeT += dt;
      if (variant === "free") {
        const k = 1 - Math.exp(-dt / FREE_S);
        values = values.map((v, i) => {
          const g = goal[i] ?? v;
          return {
            amp: v.amp + (g.amp - v.amp) * k,
            phase: wrapPhase(v.phase + phaseDelta(v.phase, g.phase) * k),
          };
        });
        return;
      }
      const t = target();
      if (!t) return;
      if (mode === "play" && modeT < INTRO_S) return;
      for (let i = 0; i < values.length; i++) {
        if (live[i]) continue;
        const goalTerm = t.terms[i];
        if (goalTerm) values[i] = easeTerm(values[i]!, goalTerm, dt, !people);
      }
    },
  };
};
