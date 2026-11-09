/**
 * The player-station state machine, kept free of the DOM so it can be tested in node.
 *
 * idle -> calibrating (touch the top of your reach, then the bottom, then adjust the band and
 * press Confirm; Redo starts the touches again) -> ready (the set emits "ready") -> playing
 * (the app called startReady, emits "start") -> idle (reset, end() or a timeout; emits "end"
 * if "ready" was emitted).
 */
import type { Rect, StationState } from "../types";

export interface StationTimeouts {
  /** Each of the two calibration touches. */
  calibrateStep: number;
  /** Adjusting the band and pressing Confirm. Dragging a handle restarts it. */
  confirm: number;
  /** After Confirm, waiting for the app to begin play. A touch in the station restarts it. */
  lobby: number;
  /** Playing with no touch inside the station's rect. */
  playing: number;
}

export const STATION_TIMEOUTS: Readonly<StationTimeouts> = {
  calibrateStep: 15_000,
  confirm: 20_000,
  lobby: 45_000,
  playing: 30_000,
};

/** Smallest band a calibration can produce, in venue px. */
export const MIN_BAND_VENUE_PX = 400;

/** Presses this soon after a calibration step begins are ignored, so one tap can't fill two. */
export const STEP_DEBOUNCE_MS = 350;

export interface Band {
  top: number;
  bottom: number;
}

export type CalibrationStep = "top" | "bottom" | "adjust";

export interface StationModel {
  readonly state: StationState;
  /** The calibration step being asked for, while calibrating. */
  readonly step: CalibrationStep | null;
  /** The top the player touched, while waiting for the bottom. */
  readonly mark: number | null;
  /** The band being adjusted (step "adjust"), or the confirmed band (ready, playing). */
  readonly band: Band | null;
  readonly bot: boolean;
  /** When the current state or step began. */
  readonly since: number;
  /** When the station times out, or null for never. */
  readonly deadline: number | null;
}

export interface StationGeometry {
  rect: Rect;
  calibrate: boolean;
  /** Minimum band height in stage px. */
  minBand: number;
  /** Stage y of the top of adult reach, for uncalibrated and bot bands. */
  reachTop: number;
  /** Overrides the playing timeout for this station; 0 or less never times out. */
  playTimeout?: number;
}

export type StationEvent =
  /** A press the station's overlay took (idle, calibrating, ready). `y` is stage px. */
  | { type: "press"; y: number; human: boolean }
  /** A touch inside the rect that went to the app (playing). */
  | { type: "activity"; human: boolean; down: boolean }
  /** A band handle dragged to `y` during the adjust step. */
  | { type: "adjust"; edge: "top" | "bottom"; y: number; human: boolean }
  | { type: "confirm" }
  | { type: "redo" }
  | { type: "start" }
  | { type: "reset" }
  | { type: "bot" }
  | { type: "tick" };

export type StationEmit = "ready" | "start" | "end";

export interface StationStep {
  model: StationModel;
  emits: StationEmit[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const playDeadline = (now: number, geo: StationGeometry, t: StationTimeouts) => {
  const ms = geo.playTimeout ?? t.playing;
  return ms > 0 ? now + ms : null;
};

/**
 * Turns two calibration touches into a band: clamped to the rect, ordered, and at least
 * `minBand` tall (grown about its middle, then shifted back inside the rect).
 */
export const sanitizeBand = (a: number, b: number, rect: Rect, minBand: number): Band => {
  const lo = rect.y;
  const hi = rect.y + rect.height;
  let top = clamp(Math.min(a, b), lo, hi);
  let bottom = clamp(Math.max(a, b), lo, hi);
  const min = Math.min(Math.max(0, minBand), hi - lo);
  if (bottom - top < min) {
    const mid = (top + bottom) / 2;
    top = mid - min / 2;
    bottom = mid + min / 2;
    if (top < lo) {
      top = lo;
      bottom = lo + min;
    }
    if (bottom > hi) {
      bottom = hi;
      top = hi - min;
    }
  }
  return { top, bottom };
};

/** Moves one edge of a band to `y`, keeping it inside the rect and at least `minBand` tall. */
export const adjustBand = (
  band: Band,
  edge: "top" | "bottom",
  y: number,
  rect: Rect,
  minBand: number,
): Band => {
  const lo = rect.y;
  const hi = rect.y + rect.height;
  const min = Math.min(Math.max(0, minBand), hi - lo);
  if (edge === "top") return { top: clamp(y, lo, band.bottom - min), bottom: band.bottom };
  return { top: band.top, bottom: clamp(y, band.top + min, hi) };
};

/** The reachable part of the rect: from adult reach (or the rect top) to the rect bottom. */
export const reachBand = (geo: StationGeometry): Band =>
  sanitizeBand(
    Math.max(geo.rect.y, geo.reachTop),
    geo.rect.y + geo.rect.height,
    geo.rect,
    geo.minBand,
  );

export const initialStation = (now: number): StationModel => ({
  state: "idle",
  step: null,
  mark: null,
  band: null,
  bot: false,
  since: now,
  deadline: null,
});

const toIdle = (m: StationModel, now: number): StationStep => ({
  model: initialStation(now),
  emits: m.state === "ready" || m.state === "playing" ? ["end"] : [],
});

const firstTouch = (now: number, t: StationTimeouts): StationModel => ({
  ...initialStation(now),
  state: "calibrating",
  step: "top",
  deadline: now + t.calibrateStep,
});

/** A person takes the station: calibration, or straight to ready when calibration is off. */
const begin = (now: number, geo: StationGeometry, t: StationTimeouts): StationStep =>
  geo.calibrate
    ? { model: firstTouch(now, t), emits: [] }
    : {
        model: {
          ...initialStation(now),
          state: "ready",
          band: reachBand(geo),
          deadline: now + t.lobby,
        },
        emits: ["ready"],
      };

export const stepStation = (
  m: StationModel,
  ev: StationEvent,
  now: number,
  geo: StationGeometry,
  t: StationTimeouts = STATION_TIMEOUTS,
): StationStep => {
  const same: StationStep = { model: m, emits: [] };

  if (ev.type === "reset") return m.state === "idle" ? same : toIdle(m, now);
  if (ev.type === "tick") {
    return m.deadline !== null && now >= m.deadline ? toIdle(m, now) : same;
  }
  // A bot finger that strays onto a station must not start, calibrate or keep it alive.
  if ((ev.type === "press" || ev.type === "activity" || ev.type === "adjust") && !ev.human) {
    return same;
  }

  switch (m.state) {
    case "idle":
      if (ev.type === "press") return begin(now, geo, t);
      if (ev.type === "bot") {
        return {
          model: { ...initialStation(now), state: "ready", band: reachBand(geo), bot: true },
          emits: ["ready"],
        };
      }
      return same;

    case "calibrating":
      if (ev.type === "redo") return { model: firstTouch(now, t), emits: [] };
      if (m.step === "adjust") {
        if (!m.band) return same;
        if (ev.type === "adjust") {
          const band = adjustBand(m.band, ev.edge, ev.y, geo.rect, geo.minBand);
          return { model: { ...m, band, deadline: now + t.confirm }, emits: [] };
        }
        if (ev.type === "press") return { model: { ...m, deadline: now + t.confirm }, emits: [] };
        if (ev.type === "confirm") {
          return {
            model: { ...m, state: "ready", step: null, since: now, deadline: now + t.lobby },
            emits: ["ready"],
          };
        }
        return same;
      }
      if (ev.type !== "press" || now - m.since < STEP_DEBOUNCE_MS) return same;
      if (m.step === "top") {
        return {
          model: { ...m, step: "bottom", mark: ev.y, since: now, deadline: now + t.calibrateStep },
          emits: [],
        };
      }
      return {
        model: {
          ...m,
          step: "adjust",
          mark: null,
          band: sanitizeBand(m.mark ?? ev.y, ev.y, geo.rect, geo.minBand),
          since: now,
          deadline: now + t.confirm,
        },
        emits: [],
      };

    case "ready":
      if (ev.type === "press") {
        if (!m.bot) return { model: { ...m, deadline: now + t.lobby }, emits: [] };
        const next = begin(now, geo, t);
        return { model: next.model, emits: ["end", ...next.emits] };
      }
      if (ev.type === "start") {
        return {
          model: {
            ...m,
            state: "playing",
            since: now,
            deadline: m.bot ? null : playDeadline(now, geo, t),
          },
          emits: ["start"],
        };
      }
      return same;

    case "playing":
      if (ev.type === "activity") {
        if (m.bot) {
          if (!ev.down) return same;
          const next = begin(now, geo, t);
          return { model: next.model, emits: ["end", ...next.emits] };
        }
        return { model: { ...m, deadline: playDeadline(now, geo, t) }, emits: [] };
      }
      return same;
  }
};
