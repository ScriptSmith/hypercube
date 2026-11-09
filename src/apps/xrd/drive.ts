/**
 * Who moves the shared machine (on the bank's screen and the wall's banner). Pure.
 *
 * The machine runs itself: the sample turns slowly with the arm following at twice the angle, so
 * aluminium's layers flash into the middle of the detector now and then. Touching a chapter
 * drives its part (`ChapterDef.drive`): for each thing a chapter can set, the latest touch wins
 * among the chapters still holding it, and a person always beats a bot or a demo. A person's
 * touch holds for 15 s after release, a bot's for a few seconds; then the machine's own run
 * takes over again.
 */
import type { CrystalId } from "./crystals";
import type { MachineDrive } from "./chapter";
import { TUBES } from "./config";
import type { ChapterId } from "./ids";
import type { MachineState } from "./machine";
import { type PartId, partOf } from "./parts";

export const HOLD_PERSON_MS = 15_000;
export const HOLD_BOT_MS = 4000;

export type SampleForm = "single" | "powder" | "foil" | "fibre";

export interface MachineLook {
  state: MachineState;
  sample: { crystal: CrystalId; form: SampleForm; spread: number };
  /** Light no crystal diffracts: the detector stays dark. */
  dark: boolean;
  /** A flash forced at the detector's middle (chapter 4's), 0 to 1. */
  flash: number;
  /** The computer's picture, as a share of the spots added, 0 to 1. */
  rebuilt: number;
  /** Which chapter drives each part now; parts running themselves are absent. */
  active: Partial<Record<PartId, ChapterId>>;
}

export interface Driver {
  chapter: ChapterId;
  drive: MachineDrive;
  /** Local ms of the latest touch on that chapter's controls, or -Infinity. */
  touchedAt: number;
  person: boolean;
  /** A finger is on a control now. */
  held: boolean;
}

/** The machine on its own, `t` seconds into its run. */
export const ownRun = (t: number): MachineLook => {
  const omega = 5 + 27.5 * (1 - Math.cos((2 * Math.PI * t) / 48));
  return {
    state: {
      omega,
      chi: 0,
      phi: (t * 4) % 360,
      armTwoTheta: 2 * omega,
      distance: 120,
      detector: "plate",
      lambda: TUBES.copper.lambda,
    },
    sample: { crystal: "aluminium", form: "single", spread: 0 },
    dark: false,
    flash: 0,
    rebuilt: 0,
    active: {},
  };
};

const holds = (d: Driver, now: number) =>
  d.held || now - d.touchedAt <= (d.person ? HOLD_PERSON_MS : HOLD_BOT_MS);

/** The machine as its drivers leave it: `base` with every holding driver applied, weakest first. */
export const compose = (
  base: MachineLook,
  drivers: readonly Driver[],
  now: number,
): MachineLook => {
  const live = drivers
    .filter((d) => holds(d, now))
    .sort((a, b) => (a.person === b.person ? a.touchedAt - b.touchedAt : a.person ? 1 : -1));
  const out: MachineLook = {
    ...base,
    state: { ...base.state },
    sample: { ...base.sample },
    active: { ...base.active },
  };
  for (const d of live) {
    const v = d.drive;
    let touched = false;
    if (v.lambda !== undefined) {
      touched = true;
      out.dark = v.lambda === null;
      if (v.lambda !== null) out.state.lambda = v.lambda;
    }
    if (v.sample) {
      touched = true;
      out.sample = {
        crystal: v.sample.crystal ?? out.sample.crystal,
        form: v.sample.form,
        spread: v.sample.spread ?? (v.sample.form === "fibre" ? 20 : 0),
      };
    }
    if (v.stage) {
      touched = true;
      if (v.stage.omega !== undefined) out.state.omega = v.stage.omega;
      if (v.stage.chi !== undefined) out.state.chi = v.stage.chi;
      if (v.stage.phi !== undefined) out.state.phi = v.stage.phi;
    }
    if (v.arm !== undefined) {
      touched = true;
      out.state.armTwoTheta = v.arm;
    }
    if (v.distance !== undefined) {
      touched = true;
      out.state.distance = v.distance;
    }
    if (v.detector !== undefined) {
      touched = true;
      out.state.detector = v.detector;
    }
    if (v.flash !== undefined) {
      touched = true;
      out.flash = v.flash;
    }
    if (v.rebuilt !== undefined) {
      touched = true;
      out.rebuilt = v.rebuilt;
    }
    const part = partOf(d.chapter);
    if (touched && part) out.active[part] = d.chapter;
  }
  return out;
};
