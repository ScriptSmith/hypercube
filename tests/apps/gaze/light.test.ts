import { describe, expect, it } from "vitest";
import { fromAngles } from "../../../src/apps/gaze/geom";
import {
  createRoomLight,
  fieldLuminance,
  roomLuminance,
  WINDOWS,
} from "../../../src/apps/gaze/light";
import { lightPupil } from "../../../src/apps/gaze/physiology";
import { createRng } from "../../../src/core/rng";
import { DEG } from "../../../src/core/sphere";

describe("room light", () => {
  it("is brightest at the windows and darkest on the floor", () => {
    const window = roomLuminance(fromAngles(20 * DEG, WINDOWS[0]!), 1, 1);
    const wall = roomLuminance(fromAngles(10 * DEG, WINDOWS[0]! + Math.PI / 2), 1, 1);
    const floor = roomLuminance(fromAngles(-60 * DEG, 1), 1, 1);
    expect(window).toBeGreaterThan(wall * 50);
    expect(wall).toBeGreaterThan(floor);
    // Dimmed lamps and a grey sky darken the room.
    expect(roomLuminance(fromAngles(-60 * DEG, 1), 0.2, 1)).toBeLessThan(floor * 0.5);
    expect(roomLuminance(fromAngles(20 * DEG, WINDOWS[0]!), 1, 0.3)).toBeLessThan(window * 0.5);
  });

  it("narrows the pupil a lot looking out of a window and widens it looking down", () => {
    const out = fieldLuminance(fromAngles(15 * DEG, WINDOWS[1]!), 1, 1);
    const down = fieldLuminance(fromAngles(-50 * DEG, WINDOWS[1]! + Math.PI / 2), 1, 1);
    const dimmed = fieldLuminance(fromAngles(-50 * DEG, WINDOWS[1]! + Math.PI / 2), 0.15, 0.5);
    expect(lightPupil(down) - lightPupil(out)).toBeGreaterThan(1.2);
    expect(lightPupil(dimmed) - lightPupil(down)).toBeGreaterThan(0.6);
  });

  it("dims and brightens over minutes, within its range", () => {
    const light = createRoomLight(createRng("room"));
    let dims = 0;
    let wasDim = false;
    let lowDay = 1;
    let highDay = 0;
    for (let i = 0; i < 2 * 3600 * 10; i++) {
      light.step(0.1);
      expect(light.lamps).toBeGreaterThanOrEqual(0);
      expect(light.lamps).toBeLessThanOrEqual(1);
      const dim = light.lamps < 0.5;
      if (dim && !wasDim) dims++;
      wasDim = dim;
      lowDay = Math.min(lowDay, light.day);
      highDay = Math.max(highDay, light.day);
    }
    // A few dimmings an hour, and clouds come and go.
    expect(dims).toBeGreaterThan(2);
    expect(dims).toBeLessThan(40);
    expect(highDay - lowDay).toBeGreaterThan(0.4);
  });
});
