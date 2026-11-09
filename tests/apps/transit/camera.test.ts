import { describe, expect, it } from "vitest";
import {
  createDirector,
  FLY_MS,
  FOLLOW_MS,
  HOG_MS,
  MANUAL_MS,
  RANDOM_EVERY,
  RETURN_MS,
  STRETCH_GAP_MS,
} from "../../../src/apps/transit/camera";
import { createHighlights, LINE_MS, MODE_MS, PICK_MS } from "../../../src/apps/transit/highlight";
import { TOUR } from "../../../src/apps/transit/views";

const alive = () => true;
const none = () => null;

describe("camera director", () => {
  it("tours the views, one every `tour` seconds", () => {
    const d = createDirector({ tour: 60, fixed: null, random: false }, 0);
    expect(d.view).toBe(TOUR[0]);
    expect(d.tick(59_999, alive, none)).toBeNull();
    expect(d.tick(60_000, alive, none)).toEqual({ kind: "view", view: TOUR[1], duration: FLY_MS });
    const seen: string[] = [d.view];
    for (let i = 2; i <= TOUR.length; i++)
      seen.push((d.tick(i * 60_000, alive, none) as { view: string }).view);
    expect(seen).toEqual([...TOUR.slice(1), TOUR[0]]);
  });

  it("stays on a fixed view", () => {
    const d = createDirector({ tour: 30, fixed: "river", random: false }, 0);
    expect(d.view).toBe("river");
    for (let t = 0; t < 600_000; t += 10_000) expect(d.tick(t, alive, none)).toBeNull();
  });

  it("follows a vehicle for FOLLOW_MS, then flies back to the view it left", () => {
    const d = createDirector({ tour: 60, fixed: null, random: false }, 0);
    expect(d.follow(42, 1000)).toBe(true);
    expect(d.mode).toBe("follow");
    expect(d.following).toBe(42);
    expect(d.tick(1000 + FOLLOW_MS - 1, alive, none)).toBeNull();
    expect(d.tick(1000 + FOLLOW_MS, alive, none)).toEqual({
      kind: "view",
      view: TOUR[0],
      duration: RETURN_MS,
    });
    expect(d.mode).toBe("tour");
    expect(d.following).toBeNull();
  });

  it("returns early when the followed vehicle goes", () => {
    const d = createDirector({ tour: 60, fixed: null, random: false }, 0);
    d.follow(42, 0);
    expect(d.tick(5000, (k) => k !== 42, none)).toMatchObject({ kind: "view" });
  });

  it("lets nobody hold the camera for more than HOG_MS", () => {
    const d = createDirector({ tour: 60, fixed: null, random: false }, 0);
    let t = 0;
    expect(d.follow(1, t)).toBe(true);
    t += 20_000;
    expect(d.follow(2, t)).toBe(true);
    t += 20_000;
    expect(d.look(t)).toBe(true);
    // The stretch ends at HOG_MS whatever the follow time.
    expect(d.followUntil).toBe(HOG_MS);
    expect(d.tick(HOG_MS, alive, none)).toMatchObject({ kind: "view" });
    // A press soon after counts as the same stretch, and is refused.
    expect(d.follow(3, HOG_MS + 1000)).toBe(false);
    expect(d.mode).toBe("tour");
    // After a pause the camera can be taken again.
    expect(d.follow(3, HOG_MS + STRETCH_GAP_MS + 1)).toBe(true);
  });

  it("holds a look at a line for the follow time", () => {
    const d = createDirector({ tour: 60, fixed: "city", random: false }, 0);
    expect(d.look(0)).toBe(true);
    expect(d.mode).toBe("look");
    expect(d.tick(FOLLOW_MS, alive, none)).toEqual({
      kind: "view",
      view: "city",
      duration: RETURN_MS,
    });
  });

  it("follows a random vehicle now and then on a screen, even on a fixed view", () => {
    const d = createDirector({ tour: 20, fixed: "city", random: true }, 0);
    const cmds = [];
    for (let i = 1; i <= RANDOM_EVERY + 1; i++) cmds.push(d.tick(i * 20_000, alive, () => 7));
    expect(cmds.slice(0, RANDOM_EVERY)).toEqual(Array(RANDOM_EVERY).fill(null));
    expect(cmds[RANDOM_EVERY]).toEqual({ kind: "follow", key: 7 });
  });

  it("holds a map a visitor moved until MANUAL_MS after their last touch, then tours on", () => {
    const d = createDirector({ tour: 20, fixed: null, random: false }, 0);
    d.manual(10_000);
    expect(d.mode).toBe("manual");
    // The tour waits while the map is in a visitor's hands.
    expect(d.tick(10_000 + MANUAL_MS - 1, alive, none)).toBeNull();
    d.manual(35_000);
    expect(d.tick(35_000 + MANUAL_MS - 1, alive, none)).toBeNull();
    expect(d.tick(35_000 + MANUAL_MS, alive, none)).toEqual({
      kind: "view",
      view: TOUR[0],
      duration: RETURN_MS,
    });
    expect(d.mode).toBe("tour");
    expect(d.tick(35_000 + MANUAL_MS + 20_000, alive, none)).toMatchObject({ view: TOUR[1] });
  });

  it("a drag ends a follow, and a route press can follow from a moved map", () => {
    const d = createDirector({ tour: 60, fixed: null, random: false }, 0);
    d.follow(1, 0);
    d.manual(5000);
    expect(d.mode).toBe("manual");
    expect(d.following).toBeNull();
    expect(d.follow(2, 8000)).toBe(true);
    expect(d.mode).toBe("follow");
    // Still one stretch with the follow before it: it can't outlast HOG_MS from the first press.
    expect(d.followUntil).toBe(8000 + FOLLOW_MS);
    d.manual(35_000);
    expect(d.follow(3, 35_000 + STRETCH_GAP_MS - 1)).toBe(true);
    expect(d.followUntil).toBe(HOG_MS);
  });

  it("moving the map never uses up anyone's follow time", () => {
    const d = createDirector({ tour: 60, fixed: null, random: false }, 0);
    for (let t = 0; t < 200_000; t += 10_000) d.manual(t);
    expect(d.tick(200_000 + MANUAL_MS, alive, none)).toMatchObject({ kind: "view" });
    expect(d.follow(1, 200_000 + MANUAL_MS + 1000)).toBe(true);
    expect(d.followUntil).toBe(200_000 + MANUAL_MS + 1000 + FOLLOW_MS);
  });

  it("releases on request", () => {
    const d = createDirector({ tour: 60, fixed: null, random: false }, 0);
    d.follow(1, 0);
    expect(d.release(10)).toMatchObject({ kind: "view", view: TOUR[0] });
    expect(d.mode).toBe("tour");
  });
});

describe("highlights", () => {
  it("lights a mode, then a line instead, each for its time", () => {
    const h = createHighlights();
    h.mode("ferry", 0);
    expect(h.litBy("F1", "ferry")).toEqual({ focus: true, pick: null });
    expect(h.litBy("60", "bus").focus).toBe(false);
    const line = h.line("rail-ne", 1000)!;
    expect(line.mode).toBe("train");
    expect(h.focus).toMatchObject({ kind: "line", until: 1000 + LINE_MS });
    expect(h.litBy("SHCL", "train").focus).toBe(true);
    expect(h.litBy("BRSH", "train").focus).toBe(true);
    expect(h.litBy("FGBN", "train").focus).toBe(false);
    expect(h.expire(1000 + LINE_MS)).toBe(true);
    expect(h.focus).toBeNull();
    h.mode("bus", 0);
    expect(h.expire(MODE_MS - 1)).toBe(false);
    expect(h.expire(MODE_MS)).toBe(true);
    expect(h.line("nope", 0)).toBeNull();
  });

  it("keeps kiosk picks for PICK_MS, one per kiosk, at most four", () => {
    const h = createHighlights();
    h.pick("k1", "199", 5, 0);
    h.pick("k1", "f1", 5, 10);
    expect([...h.picks.values()].map((p) => p.line.id)).toEqual(["f1"]);
    for (let i = 2; i <= 6; i++) h.pick(`k${i}`, "60", 6, i * 100);
    expect(h.picks.size).toBe(4);
    expect(h.litBy("F1", "ferry").pick).toBeNull();
    expect(h.litBy("60", "bus").pick?.color).toBe(6);
    h.expire(600 + PICK_MS);
    expect(h.picks.size).toBe(0);
  });

  it("counts every change in its version", () => {
    const h = createHighlights();
    const v0 = h.version;
    h.mode("bus", 0);
    h.clear();
    expect(h.version).toBe(v0 + 2);
    h.clear();
    expect(h.version).toBe(v0 + 2);
  });
});
