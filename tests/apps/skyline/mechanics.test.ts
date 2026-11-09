import { describe, expect, it } from "vitest";
import {
  stepServo,
  stepSwing,
  swingAmplitude,
  swingPeriod,
  type Swing,
} from "../../../src/apps/skyline/mechanics";

const DT = 1 / 60;

/** Time between successive upward zero crossings of the swing. */
const measurePeriod = (length: number, gravity: number, start = 0.05) => {
  const s: Swing = { theta: start, omega: 0 };
  const crossings: number[] = [];
  let prev = s.theta;
  for (let i = 1; i < 60 / DT && crossings.length < 6; i++) {
    stepSwing(
      s,
      { length, lengthRate: 0, accel: 0, push: 0, damping: 0, gravity, maxAngle: 1.2 },
      DT,
    );
    if (prev < 0 && s.theta >= 0) crossings.push(i * DT);
    prev = s.theta;
  }
  return (crossings[crossings.length - 1]! - crossings[0]!) / (crossings.length - 1);
};

describe("skyline swing", () => {
  it("has the textbook period for small swings", () => {
    for (const L of [0.6, 1.5, 3, 6, 12]) {
      const measured = measurePeriod(L, 16);
      expect(measured, `L=${L}`).toBeCloseTo(swingPeriod(L, 16), 1);
      expect(Math.abs(measured / swingPeriod(L, 16) - 1), `L=${L}`).toBeLessThan(0.02);
    }
  });

  it("dies away with damping, and more with more damping", () => {
    const run = (damping: number) => {
      const s: Swing = { theta: 0.4, omega: 0 };
      for (let i = 0; i < 10 / DT; i++) {
        stepSwing(
          s,
          { length: 3, lengthRate: 0, accel: 0, push: 0, damping, gravity: 16, maxAngle: 1.2 },
          DT,
        );
      }
      return swingAmplitude(s, 3, 16);
    };
    const free = run(0);
    const light = run(0.1);
    const heavy = run(1.6);
    expect(free).toBeGreaterThan(0.38);
    expect(light).toBeLessThan(0.4 * 0.7);
    expect(heavy).toBeLessThan(0.01);
  });

  it("swings back when the trolley accelerates, as a pendulum lags its pivot", () => {
    const s: Swing = { theta: 0, omega: 0 };
    for (let i = 0; i < 6; i++) {
      stepSwing(
        s,
        { length: 3, lengthRate: 0, accel: 4, push: 0, damping: 0, gravity: 16, maxAngle: 1.2 },
        DT,
      );
    }
    expect(s.theta).toBeLessThan(0);
  });

  it("never blows up at the cable's limits, whatever it is put through", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    const s: Swing = { theta: 0, omega: 0 };
    for (let i = 0; i < 20_000; i++) {
      stepSwing(
        s,
        {
          length: 0.05 + Math.abs(rand()) * 0.4,
          lengthRate: rand() * 8,
          accel: rand() * 40,
          push: rand() * 5,
          damping: 0,
          gravity: 16,
          maxAngle: 1.15,
        },
        DT,
      );
      expect(Number.isFinite(s.theta) && Number.isFinite(s.omega)).toBe(true);
      expect(Math.abs(s.theta)).toBeLessThanOrEqual(1.15 + 1e-9);
    }
  });

  it("grows when the cable is reeled in and calms when paid out", () => {
    const run = (rate: number) => {
      const s: Swing = { theta: 0.2, omega: 0 };
      let L = 3;
      for (let i = 0; i < 1 / DT; i++) {
        stepSwing(
          s,
          {
            length: L,
            lengthRate: rate,
            accel: 0,
            push: 0,
            damping: 0,
            gravity: 16,
            maxAngle: 1.2,
          },
          DT,
        );
        L += rate * DT;
      }
      return Math.abs(s.theta) + Math.abs(s.omega) * Math.sqrt(L / 16);
    };
    expect(run(-1.5)).toBeGreaterThan(run(0));
    expect(run(1.5)).toBeLessThan(run(0));
  });
});

describe("skyline servo", () => {
  it("reaches its target without overshoot, within its speed and acceleration", () => {
    for (const target of [0.3, -2, 7.5]) {
      const s = { x: 0, v: 0 };
      let maxV = 0;
      let maxA = 0;
      let overshoot = 0;
      for (let i = 0; i < 10 / DT; i++) {
        const a = stepServo(s, target, 3, 4, DT);
        maxV = Math.max(maxV, Math.abs(s.v));
        maxA = Math.max(maxA, Math.abs(a));
        overshoot = Math.max(overshoot, Math.sign(target) * (s.x - target));
      }
      expect(s.x).toBeCloseTo(target, 6);
      expect(s.v).toBe(0);
      expect(maxV).toBeLessThanOrEqual(3 + 1e-9);
      expect(maxA).toBeLessThanOrEqual(4 * 1.0001 + 3 / DT / 1000);
      expect(overshoot).toBeLessThan(1e-6);
    }
  });

  it("takes about the time a trapezoid move should", () => {
    const s = { x: 0, v: 0 };
    let t = 0;
    while (Math.abs(s.x - 9) > 1e-6 && t < 20) {
      stepServo(s, 9, 3, 4, DT);
      t += DT;
    }
    // 0.75 s up to speed, 0.75 s down, 2.25 s at 3: 3.75 s.
    expect(t).toBeGreaterThan(3.7);
    expect(t).toBeLessThan(4.3);
  });

  it("brakes and turns when the target jumps behind it", () => {
    const s = { x: 0, v: 3 };
    let minX = 0;
    let maxX = 0;
    for (let i = 0; i < 6 / DT; i++) {
      stepServo(s, -1, 3, 4, DT);
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
    }
    expect(maxX).toBeGreaterThan(1);
    expect(maxX).toBeLessThan(1.2);
    expect(s.x).toBeCloseTo(-1, 6);
    expect(minX).toBeGreaterThan(-1 - 1e-6);
  });
});
