import { describe, expect, it } from "vitest";
import {
  adjustBand,
  initialStation,
  reachBand,
  sanitizeBand,
  STATION_TIMEOUTS,
  STEP_DEBOUNCE_MS,
  type StationEvent,
  type StationGeometry,
  type StationModel,
  stepStation,
} from "../../src/core/stations/machine";

const rect = { x: 0, y: 0, width: 1080, height: 1920 };
const geo: StationGeometry = { rect, calibrate: true, minBand: 400, reachTop: 0 };
const T = STATION_TIMEOUTS;

/** Runs events in order, each at the given time, collecting what the station emitted. */
const run = (
  steps: [number, StationEvent][],
  g: StationGeometry = geo,
  start: StationModel = initialStation(0),
) => {
  let model = start;
  const emits: string[] = [];
  for (const [t, ev] of steps) {
    const out = stepStation(model, ev, t, g);
    model = out.model;
    emits.push(...out.emits);
  }
  return { model, emits };
};

const press = (y: number, human = true): StationEvent => ({ type: "press", y, human });
const drag = (edge: "top" | "bottom", y: number, human = true): StationEvent => ({
  type: "adjust",
  edge,
  y,
  human,
});

/** Both touches done: the station is in the adjust step at t = 2000. */
const adjusting = (top = 300, bottom = 1500, g = geo) =>
  run(
    [
      [0, press(900)],
      [1000, press(top)],
      [2000, press(bottom)],
    ],
    g,
  ).model;

/** Confirmed at t = 3000. */
const ready = () => run([[3000, { type: "confirm" }]], geo, adjusting()).model;

const playing = (g = geo) =>
  run(
    [
      [3000, { type: "confirm" }],
      [3000, { type: "start" }],
    ],
    g,
    adjusting(300, 1500, g),
  ).model;

describe("calibration", () => {
  it("asks for the top, then the bottom, then shows the band to adjust", () => {
    const { model, emits } = run([[0, press(900)]]);
    expect(model).toMatchObject({ state: "calibrating", step: "top" });

    const top = stepStation(model, press(300), 1000, geo).model;
    expect(top).toMatchObject({ step: "bottom", mark: 300 });

    const adjust = stepStation(top, press(1500), 2000, geo).model;
    expect(adjust).toMatchObject({ state: "calibrating", step: "adjust", mark: null });
    expect(adjust.band).toEqual({ top: 300, bottom: 1500 });
    expect(adjust.deadline).toBe(2000 + T.confirm);
    expect(emits).toEqual([]);
  });

  it("ignores a second press that lands too soon after a step begins", () => {
    const { model } = run([
      [0, press(900)],
      [STEP_DEBOUNCE_MS - 1, press(300)],
    ]);
    expect(model.step).toBe("top");
  });

  it("moves to ready only on Confirm", () => {
    const adjust = adjusting();
    const pressed = run([[2500, press(900)]], geo, adjust);
    expect(pressed.model.step).toBe("adjust");
    expect(pressed.model.deadline).toBe(2500 + T.confirm);
    expect(run([[2500, { type: "start" }]], geo, adjust).model).toBe(adjust);

    const done = run([[3000, { type: "confirm" }]], geo, adjust);
    expect(done.emits).toEqual(["ready"]);
    expect(done.model).toMatchObject({ state: "ready", step: null });
    expect(done.model.band).toEqual({ top: 300, bottom: 1500 });
    expect(done.model.deadline).toBe(3000 + T.lobby);
  });

  it("starts the touches again on Redo", () => {
    const redone = run([[2500, { type: "redo" }]], geo, adjusting());
    expect(redone.model).toMatchObject({ state: "calibrating", step: "top", band: null });
    expect(redone.emits).toEqual([]);
    const again = run(
      [
        [3000, press(500)],
        [4000, press(1700)],
      ],
      geo,
      redone.model,
    );
    expect(again.model.band).toEqual({ top: 500, bottom: 1700 });
  });

  it("moves band edges with the handles, clamped to the rect and the minimum height", () => {
    const steps: [StationEvent, { top: number; bottom: number }][] = [
      [drag("top", 100), { top: 100, bottom: 1500 }],
      [drag("top", 1400), { top: 1100, bottom: 1500 }],
      [drag("top", -50), { top: 0, bottom: 1500 }],
      [drag("bottom", 2500), { top: 0, bottom: 1920 }],
      [drag("bottom", 100), { top: 0, bottom: 400 }],
    ];
    let model = adjusting();
    let t = 2000;
    for (const [ev, band] of steps) {
      t += 100;
      model = stepStation(model, ev, t, geo).model;
      expect(model.band).toEqual(band);
      // Dragging counts as activity.
      expect(model.deadline).toBe(t + T.confirm);
    }
  });

  it("emits ready, start and end over a whole game", () => {
    const { model, emits } = run(
      [
        [3000, { type: "confirm" }],
        [3100, { type: "start" }],
        [4000, { type: "reset" }],
      ],
      geo,
      adjusting(),
    );
    expect(emits).toEqual(["ready", "start", "end"]);
    expect(model.state).toBe("idle");
    expect(model.band).toBeNull();
  });

  it("does not emit end for a station the app never heard about", () => {
    expect(run([[2500, { type: "reset" }]], geo, adjusting()).emits).toEqual([]);
  });

  it("skips calibration when asked, using the reachable part of the rect", () => {
    const wall: StationGeometry = {
      rect: { x: 0, y: 1150, width: 1000, height: 1010 },
      calibrate: false,
      minBand: 400,
      reachTop: 1200,
    };
    const { model, emits } = run([[0, press(2000)]], wall);
    expect(model.state).toBe("ready");
    expect(emits).toEqual(["ready"]);
    expect(model.band).toEqual({ top: 1200, bottom: 2160 });
    expect(reachBand(wall)).toEqual({ top: 1200, bottom: 2160 });
  });
});

describe("bots", () => {
  it("lets a bot claim an idle station and a person take it back", () => {
    const claimed = run([[0, { type: "bot" }]]);
    expect(claimed.emits).toEqual(["ready"]);
    expect(claimed.model).toMatchObject({ state: "ready", bot: true });
    expect(claimed.model.deadline).toBeNull();

    const game = stepStation(claimed.model, { type: "start" }, 100, geo).model;
    expect(game.state).toBe("playing");
    // Bot fingers and a person's finger sliding in do not take over; a person's press does.
    expect(stepStation(game, { type: "activity", human: false, down: true }, 200, geo).model).toBe(
      game,
    );
    expect(stepStation(game, { type: "activity", human: true, down: false }, 200, geo).model).toBe(
      game,
    );
    const taken = stepStation(game, { type: "activity", human: true, down: true }, 300, geo);
    expect(taken.emits).toEqual(["end"]);
    expect(taken.model).toMatchObject({ state: "calibrating", step: "top", bot: false });
  });

  it("ignores bot touches on a station nobody is using or a person holds", () => {
    expect(run([[0, press(900, false)]]).model.state).toBe("idle");

    const top = run([[0, press(900)]]).model;
    expect(
      run(
        [
          [1000, press(300, false)],
          [2000, press(1500, false)],
        ],
        geo,
        top,
      ).model,
    ).toBe(top);

    const adjust = adjusting();
    expect(run([[2500, drag("top", 100, false)]], geo, adjust).model).toBe(adjust);

    const waiting = ready();
    expect(run([[10_000, press(900, false)]], geo, waiting).model.deadline).toBe(waiting.deadline);

    const game = playing();
    const stray = run([[20_000, { type: "activity", human: false, down: true }]], geo, game);
    expect(stray.model.deadline).toBe(game.deadline);
    expect(run([[3000 + T.playing, { type: "tick" }]], geo, stray.model).model.state).toBe("idle");
  });

  it("ignores a bot claim on a station a person is using", () => {
    const { model, emits } = run([
      [0, press(900)],
      [10, { type: "bot" }],
    ]);
    expect(model.state).toBe("calibrating");
    expect(emits).toEqual([]);
  });

  it("never times out a bot station", () => {
    const bot = run([
      [0, { type: "bot" }],
      [1, { type: "start" }],
      [10 * 60_000, { type: "tick" }],
    ]);
    expect(bot.model.state).toBe("playing");
  });
});

describe("timeouts", () => {
  it("returns to idle when a calibration touch times out", () => {
    const { model } = run([
      [0, press(900)],
      [T.calibrateStep - 1, { type: "tick" }],
    ]);
    expect(model.state).toBe("calibrating");
    expect(stepStation(model, { type: "tick" }, T.calibrateStep, geo).model.state).toBe("idle");
  });

  it("restarts the timeout for the second touch", () => {
    const { model } = run([
      [0, press(900)],
      [10_000, press(300)],
      [10_000 + T.calibrateStep - 1, { type: "tick" }],
    ]);
    expect(model.step).toBe("bottom");
  });

  it("times out an unconfirmed band, and dragging keeps it open", () => {
    const adjust = adjusting();
    expect(run([[2000 + T.confirm, { type: "tick" }]], geo, adjust).model.state).toBe("idle");
    const dragged = run(
      [
        [2000 + T.confirm - 1000, drag("top", 200)],
        [2000 + T.confirm + 500, { type: "tick" }],
      ],
      geo,
      adjust,
    );
    expect(dragged.model.step).toBe("adjust");
  });

  it("ends a confirmed station the app never starts", () => {
    const { model, emits } = run([[3000 + T.lobby, { type: "tick" }]], geo, ready());
    expect(model.state).toBe("idle");
    expect(emits).toEqual(["end"]);
  });

  it("ends play after a quiet spell, and touches keep it going", () => {
    const game = playing();
    const busy = run(
      [
        [3000 + T.playing - 1000, { type: "activity", human: true, down: false }],
        [3000 + T.playing + 1, { type: "tick" }],
      ],
      geo,
      game,
    );
    expect(busy.model.state).toBe("playing");
    const quiet = run([[3000 + T.playing, { type: "tick" }]], geo, game);
    expect(quiet.model.state).toBe("idle");
    expect(quiet.emits).toEqual(["end"]);
  });

  it("uses a station's own play timeout, where 0 never times out", () => {
    const never = playing({ ...geo, playTimeout: 0 });
    expect(never.deadline).toBeNull();
    expect(run([[3_600_000, { type: "tick" }]], geo, never).model.state).toBe("playing");
    const touched = run(
      [[5000, { type: "activity", human: true, down: true }]],
      { ...geo, playTimeout: 0 },
      never,
    );
    expect(touched.model.deadline).toBeNull();

    const short = { ...geo, playTimeout: 5000 };
    const game = playing(short);
    expect(game.deadline).toBe(8000);
    const kept = run([[7000, { type: "activity", human: true, down: false }]], short, game);
    expect(kept.model.deadline).toBe(12_000);
    const ended = run([[12_000, { type: "tick" }]], short, kept.model);
    expect(ended.model.state).toBe("idle");
    expect(ended.emits).toEqual(["end"]);
  });
});

describe("band sanity", () => {
  it("swaps a reversed pair", () => {
    expect(sanitizeBand(1500, 300, rect, 400)).toEqual({ top: 300, bottom: 1500 });
  });

  it("clamps touches to the rect", () => {
    const r = { x: 0, y: 1000, width: 500, height: 800 };
    expect(sanitizeBand(500, 2500, r, 400)).toEqual({ top: 1000, bottom: 1800 });
  });

  it("grows a short band about its middle", () => {
    expect(sanitizeBand(1000, 1100, rect, 400)).toEqual({ top: 850, bottom: 1250 });
  });

  it("keeps a grown band inside the rect, so a band low on the panel stays low", () => {
    expect(sanitizeBand(1850, 1900, rect, 400)).toEqual({ top: 1520, bottom: 1920 });
    expect(sanitizeBand(10, 20, rect, 400)).toEqual({ top: 0, bottom: 400 });
  });

  it("uses the whole rect when it is shorter than the minimum", () => {
    const r = { x: 0, y: 100, width: 300, height: 250 };
    expect(sanitizeBand(150, 160, r, 400)).toEqual({ top: 100, bottom: 350 });
    expect(adjustBand({ top: 100, bottom: 350 }, "top", 200, r, 400)).toEqual({
      top: 100,
      bottom: 350,
    });
  });

  it("applies sanitising to real calibrations, reversed ones included", () => {
    expect(adjusting(1700, 1650).band).toEqual({ top: 1475, bottom: 1875 });
    expect(adjusting(1500, 300).band).toEqual({ top: 300, bottom: 1500 });
  });

  it("clamps handle drags in an offset rect", () => {
    const r = { x: 0, y: 1000, width: 500, height: 1000 };
    const band = { top: 1200, bottom: 1800 };
    expect(adjustBand(band, "top", 900, r, 400)).toEqual({ top: 1000, bottom: 1800 });
    expect(adjustBand(band, "top", 1500, r, 400)).toEqual({ top: 1400, bottom: 1800 });
    expect(adjustBand(band, "bottom", 2100, r, 400)).toEqual({ top: 1200, bottom: 2000 });
    expect(adjustBand(band, "bottom", 1300, r, 400)).toEqual({ top: 1200, bottom: 1600 });
  });
});
