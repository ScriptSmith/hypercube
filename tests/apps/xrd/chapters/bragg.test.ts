import { describe, expect, it } from "vitest";
import bragg, { wavesText } from "../../../../src/apps/xrd/chapters/bragg";
import { TEXT } from "../../../../src/apps/xrd/captions";
import { layoutFrame } from "../../../../src/apps/xrd/layout";
import {
  braggAngle,
  decode,
  encode,
  flashing,
  intensity,
  pathInWaves,
  SNAP_WAVES,
  snapTheta,
  START,
  STATE_RANGES,
  wholeWaves,
} from "../../../../src/apps/xrd/chapters/bragg/physics";

const CU = 1.5406;

describe("chapter 4's physics", () => {
  it("flashes where a whole number of waves fits the extra path", () => {
    const d = 2.338;
    const t1 = braggAngle(1, d, CU)!;
    expect(2 * t1).toBeCloseTo(38.47, 1);
    expect(intensity(t1, d, CU, 4)).toBeCloseTo(1, 6);
    expect(flashing(t1, d, CU, 4)).toBe(true);
    expect(flashing(t1 + 4, d, CU, 4)).toBe(false);
    const t2 = braggAngle(2, d, CU)!;
    expect(flashing(t2, d, CU, 8)).toBe(true);
    expect(braggAngle(1, 0.5, CU)).toBeNull();
  });

  it("makes sharper flashes with more layers", () => {
    const d = 2.338;
    const t1 = braggAngle(1, d, CU)!;
    const near = (n: number) => intensity(t1 + 1, d, CU, n);
    expect(near(8)).toBeLessThan(near(4));
    expect(near(4)).toBeLessThan(near(2));
  });

  it("packs its state for the screen within its ranges", () => {
    const v = encode({ ...START, theta: 19.2, layers: 8, tube: "molybdenum" });
    v.forEach((x, i) => {
      expect(x).toBeGreaterThanOrEqual(STATE_RANGES[i]![0]);
      expect(x).toBeLessThanOrEqual(STATE_RANGES[i]![1]);
    });
    expect(decode(v)).toMatchObject({ theta: 19.2, layers: 8, tube: "molybdenum", d: 2.34 });
  });

  it("counts the extra distance 2d sin θ in waves", () => {
    const d = 2.338;
    // The extra distance is d sin θ in and d sin θ back out.
    expect(pathInWaves(30, d, CU)).toBeCloseTo((2 * d * 0.5) / CU, 9);
    expect(pathInWaves(braggAngle(1, d, CU)!, d, CU)).toBeCloseTo(1, 9);
    expect(pathInWaves(braggAngle(2, d, CU)!, d, CU)).toBeCloseTo(2, 9);
    // At the start (8°) it is well short of one wave: the review's 0.42 λ.
    expect(pathInWaves(8, d, CU)).toBeCloseTo(0.42, 2);
  });

  it("settles the wheel on a whole number of waves, and only near one", () => {
    const d = 2.338;
    const t1 = braggAngle(1, d, CU)!;
    expect(snapTheta(t1 + 0.4, d, CU)).toBeCloseTo(t1, 9);
    expect(snapTheta(t1 - 0.4, d, CU)).toBeCloseTo(t1, 9);
    expect(wholeWaves(snapTheta(t1 + 0.4, d, CU), d, CU)).toBe(1);
    // Outside the notch the wheel's angle stands.
    const far = t1 + 3;
    expect(Math.abs(pathInWaves(far, d, CU) - 1)).toBeGreaterThan(SNAP_WAVES);
    expect(snapTheta(far, d, CU)).toBe(far);
    expect(wholeWaves(far, d, CU)).toBeNull();
    // Zero waves is no flash: small angles never snap to it.
    expect(snapTheta(2, d, CU)).toBe(2);
    expect(wholeWaves(2, d, CU)).toBeNull();
    // The second whole number, under molybdenum's shorter waves too.
    const MO = 0.7093;
    const t2 = braggAngle(2, d, MO)!;
    expect(wholeWaves(snapTheta(t2 + 0.2, d, MO), d, MO)).toBe(2);
  });

  it("writes the count as the figure shows it", () => {
    expect(wavesText(1.41, null)).toBe("1.41 waves");
    expect(wavesText(0.42, null)).toBe("0.42 waves");
    expect(wavesText(1, 1)).toBe("1 wave");
    expect(wavesText(2, 2)).toBe("2 waves");
  });

  it("earns its So line only once the wheel lands on a whole number of waves", () => {
    let earned = 0;
    const said: (string | null)[] = [];
    const c = bragg.create({
      id: "bragg",
      kind: "panel",
      config: { maths: "button", chapter: null, set: "highlights", maps: true, tube: "copper" },
      rng: { next: () => 0.5 } as never,
      engine: () => null as never,
      layer3d: () => null as never,
      maps: null as never,
      link: { touch() {}, level: () => 0, active: () => null, reset() {} },
      earn: () => {
        earned++;
      },
      say: (l) => said.push(l.caption?.text ?? null),
      now: () => 0,
    });
    const card = layoutFrame({
      kind: "panel",
      width: 1080,
      height: 1920,
      reachTop: { adult: 0, child: 960 },
      cards: [{ bottom: "tabs", tabs: 11 }],
      maths: true,
    }).cards[0]!;
    c.layout(card);
    c.update(1 / 60, 0);
    expect(earned).toBe(0);
    expect(c.status().inStep).toBe(false);
    // Turn the wheel as a finger would, to just short of the first whole number of waves.
    const wheel = c.controls.find((k) => k.id === "wheel")!;
    const t1 = braggAngle(1, 2.338, CU)!;
    const turn = (to: number) => {
      const g = wheel.gesture(to)!;
      g.path.forEach((p, i) => {
        const t = { id: 1, x: p.x, y: p.y, synthetic: true, time: i };
        if (i === 0) wheel.begin(t);
        else wheel.move(t);
      });
      wheel.end({ id: 1, x: 0, y: 0, synthetic: true, time: 99 }, false);
    };
    turn(t1 - 3);
    c.update(1 / 60, 0);
    expect(earned).toBe(0);
    expect(c.status().flash).toBe(false);
    // Into the notch: the angle settles on the whole number, the detector flashes, and it earns.
    turn(t1 - 0.3);
    expect(decode(c.state()).theta).toBeCloseTo(Math.round(t1 * 10) / 10, 5);
    expect(c.status().inStep).toBe(true);
    expect(c.status().flash).toBe(true);
    expect(earned).toBeGreaterThan(0);
    // Moving the gap puts up the line about the gap as the caption.
    const gap = c.controls.find((k) => k.id === "gap")!;
    const g2 = gap.gesture(3)!;
    gap.begin({ id: 2, ...g2.path[0]!, synthetic: false, time: 0 });
    gap.move({ id: 2, ...g2.path[g2.path.length - 1]!, synthetic: false, time: 5 });
    gap.end({ id: 2, x: 0, y: 0, synthetic: false, time: 6 }, false);
    expect(said).toEqual([TEXT.bragg.more!.gap!.text]);
    c.reset();
    expect(said[said.length - 1]).toBeNull();
  });
});

describe("chapter 4 on a screen with nobody turning", () => {
  it("rests on the first two whole numbers of waves, as the screen's state carries them", () => {
    const at = (t: number) => decode(bragg.play!(t));
    const w = (t: number) => {
      const s = at(t);
      return wholeWaves(s.theta, s.d, CU);
    };
    expect(w(8)).toBe(1);
    expect(w(18)).toBe(2);
    expect(w(3)).toBeNull();
    for (let t = 0; t < 60; t += 0.7) {
      const s = at(t);
      expect(s.theta).toBeGreaterThanOrEqual(STATE_RANGES[0]![0] / 10);
      expect(s.theta).toBeLessThanOrEqual(STATE_RANGES[0]![1] / 10);
    }
  });
});
