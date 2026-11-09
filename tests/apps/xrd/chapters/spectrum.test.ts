import { describe, expect, it } from "vitest";
import spectrum from "../../../../src/apps/xrd/chapters/spectrum";
import {
  angstromsAt,
  BANDS,
  bandAt,
  decode,
  encode,
  energyKeV,
  formatEnergy,
  formatLength,
  isXray,
  LONG,
  posOf,
  SHORT,
  START,
  STATE_RANGES,
  THINGS,
  thingAt,
  tubeAt,
  tubePos,
  VIEW_FILL,
  viewAt,
  viewHeightAt,
  WORLD,
} from "../../../../src/apps/xrd/chapters/spectrum/physics";
import type { ChapterEnv } from "../../../../src/apps/xrd/chapter";
import { readConfig, TUBE_IDS, TUBES } from "../../../../src/apps/xrd/config";
import type { Slider, Touch } from "../../../../src/apps/xrd/controls";
import { createLink } from "../../../../src/apps/xrd/formula";
import { layoutFrame, withSplit } from "../../../../src/apps/xrd/layout";
import type { Rng } from "../../../../src/core/types";
import { VENUE_SIZE } from "../../../../src/core/frame";

const rng = (): Rng => {
  const r: Rng = {
    next: () => 0.5,
    int: (n) => Math.floor(n / 2),
    range: (lo, hi) => (lo + hi) / 2,
    pick: (items) => items[0]!,
    fork: () => r,
  };
  return r;
};

const envWith = (onEarn: () => void): ChapterEnv => ({
  id: "spectrum",
  kind: "panel",
  config: readConfig({}),
  rng: rng(),
  engine: () => {
    throw new Error("no engine here");
  },
  layer3d: () => {
    throw new Error("no 3D here");
  },
  maps: { canvas: () => null, ready: () => false, draw: () => null, dispose() {} },
  link: createLink(),
  earn: onEarn,
  now: () => 0,
});

const panelCard = () => {
  const frame = layoutFrame({
    kind: "panel",
    width: 1080,
    height: 1920,
    reachTop: { adult: 0, child: 960 },
    cards: [{ bottom: "tabs", tabs: 11 }],
    maths: true,
  });
  return withSplit(frame.cards[0]!, spectrum.split ?? 0.5);
};

const touch = (x: number, y: number, time = 0): Touch => ({ id: 1, x, y, synthetic: false, time });

describe("chapter 1's spectrum", () => {
  it("runs its bands without gaps from radio waves to gamma rays", () => {
    expect(BANDS[0]!.from).toBe(LONG);
    expect(BANDS[BANDS.length - 1]!.to).toBe(SHORT);
    for (let i = 1; i < BANDS.length; i++) expect(BANDS[i]!.from).toBe(BANDS[i - 1]!.to);
    expect(bandAt(posOf(530e-9)).id).toBe("visible");
    expect(bandAt(posOf(1e-3 * 5)).id).toBe("microwave");
    expect(bandAt(posOf(1e-12)).id).toBe("gamma");
  });

  it("puts every tube's line among the X-rays, with its energy from E = 12.398 keV·Å / λ", () => {
    for (const id of TUBE_IDS) {
      expect(isXray(tubePos(id))).toBe(true);
      expect(tubeAt(tubePos(id))).toBe(id);
      expect(angstromsAt(tubePos(id))).toBeCloseTo(TUBES[id].lambda, 9);
    }
    // NIST X-ray transition energies: copper Kα1 8.0478 keV, cobalt 6.9304, molybdenum 17.4794.
    expect(energyKeV(1.5406)).toBeCloseTo(8.048, 2);
    expect(energyKeV(1.789)).toBeCloseTo(6.93, 2);
    expect(energyKeV(0.7093)).toBeCloseTo(17.48, 1);
    expect(isXray(posOf(530e-9))).toBe(false);
  });

  it("says lengths and energies as a person would", () => {
    expect(formatLength(530e-9)).toBe("530 nm");
    expect(formatLength(1.5406e-10)).toBe("1.54 Å");
    expect(formatLength(0.015)).toBe("1.50 cm");
    expect(formatLength(1e-12)).toBe("1.00 pm");
    expect(formatEnergy(energyKeV(1.5406))).toBe("8.05 keV");
    expect(formatEnergy(energyKeV(5300))).toBe("2.34 eV");
  });

  it("rests the view on each thing, full size, with the wave the thing's own length", () => {
    for (const t of THINGS) {
      const p = posOf(t.size);
      const v = viewAt(p);
      expect(10 ** v.h * VIEW_FILL).toBeCloseTo(t.size, 12);
      expect(v.cx).toBeCloseTo(WORLD[t.id][0], 12);
      expect(v.cy).toBeCloseTo(WORLD[t.id][1], 12);
      expect(thingAt(p).id).toBe(t.id);
      // The view holds still there: a small change in wavelength barely moves it.
      expect(Math.abs(viewHeightAt(p + 0.01) - viewHeightAt(p))).toBeLessThan(1e-4);
    }
    // Between two things the view keeps the next one in sight.
    for (let i = 0; i + 1 < THINGS.length; i++) {
      const a = posOf(THINGS[i]!.size);
      const b = posOf(THINGS[i + 1]!.size);
      for (let k = 1; k < 10; k++) {
        const v = viewAt(a + ((b - a) * k) / 10);
        const next = WORLD[THINGS[i + 1]!.id];
        const H = 10 ** v.h;
        expect(Math.abs(next[0] - v.cx) / H).toBeLessThan(1.5);
        expect(Math.abs(next[1] - v.cy) / H).toBeLessThan(1.5);
      }
    }
  });

  it("drives the tube's wavelength only with X-rays, leaving the detector dark otherwise", () => {
    const cu = spectrum.drive!(encode(tubePos("copper")));
    expect(cu.lambda).toBeCloseTo(1.5406, 3);
    expect(spectrum.drive!(encode(START)).lambda).toBeNull();
    expect(spectrum.drive!(encode(posOf(1e-12))).lambda).toBeNull();
    expect(spectrum.drive!(encode(posOf(0.1))).lambda).toBeNull();
  });

  it("packs its state for the screen within its ranges", () => {
    for (const p of [LONG, START, tubePos("molybdenum"), SHORT]) {
      const v = encode(p);
      expect(v[0]).toBeGreaterThanOrEqual(STATE_RANGES[0][0]);
      expect(v[0]).toBeLessThanOrEqual(STATE_RANGES[0][1]);
      expect(decode(v)).toBeCloseTo(p, 3);
    }
    expect(spectrum.start).toEqual(encode(START));
  });

  it("shows its So line once the slider reaches X-rays, and not before", () => {
    let earned = 0;
    const ch = spectrum.create(envWith(() => earned++));
    ch.layout(panelCard());
    const wave = ch.controls.find((c) => c.id === "wave") as Slider;
    ch.update(1 / 60, 0);
    expect(earned).toBe(0);
    // Slide to visible light's far end: still no X-rays.
    const y = wave.track().y;
    wave.begin(touch(wave.xOf(LONG - posOf(400e-9)), y));
    ch.update(1 / 60, 16);
    expect(earned).toBe(0);
    wave.move(touch(wave.xOf(LONG - tubePos("copper")), y, 32));
    wave.end(touch(wave.xOf(LONG - tubePos("copper")), y, 48), false);
    ch.update(1 / 60, 48);
    expect(earned).toBeGreaterThan(0);
    expect(ch.status().xray).toBe(true);
    ch.reset();
    expect(ch.state()).toEqual(encode(START));
  });

  it("dims its So line while the wave is longer than visible light, telling the card only on a change", () => {
    const told: boolean[] = [];
    const ch = spectrum.create({ ...envWith(() => {}), away: (a) => told.push(a) });
    ch.layout(panelCard());
    const wave = ch.controls.find((c) => c.id === "wave") as Slider;
    const y = wave.track().y;
    const go = (p: number, t: number) => {
      wave.begin(touch(wave.xOf(LONG - p), y, t));
      wave.end(touch(wave.xOf(LONG - p), y, t), false);
      ch.update(1 / 60, t);
      ch.update(1 / 60, t + 16);
    };
    // Green light: the line's own subject, so not away.
    ch.update(1 / 60, 0);
    expect(told).toEqual([false]);
    go(tubePos("copper"), 100);
    expect(told).toEqual([false]);
    go(posOf(0.015), 200);
    expect(told).toEqual([false, true]);
    go(posOf(500e-9), 300);
    expect(told).toEqual([false, true, false]);
    // Reset clears the card's dimming, so the chapter tells it again.
    ch.reset();
    ch.update(1 / 60, 400);
    expect(told).toEqual([false, true, false, false]);
  });

  it("names its tube buttons, above them where the row has room and beside them on the kiosk", () => {
    for (const kind of ["panel", "pair", "wall", "kiosk"] as const) {
      const size = {
        panel: [1080, 1920],
        pair: [2160, 1920],
        wall: [VENUE_SIZE.wall.width, VENUE_SIZE.wall.height],
        kiosk: [1920, 1080],
      }[kind];
      const frame = layoutFrame({
        kind,
        width: size[0]!,
        height: size[1]!,
        reachTop: { adult: kind === "wall" ? 1400 : 0, child: kind === "wall" ? 1900 : 960 },
        cards: [{ bottom: kind === "wall" ? "none" : "tabs", tabs: 11 }],
        maths: true,
      });
      const card = withSplit(frame.cards[0]!, spectrum.split ?? 0.5);
      const ch = spectrum.create({ ...envWith(() => {}), kind });
      ch.layout(card);
      const tube = ch.controls.find((c) => c.id === "tube")!;
      const a = card.adult;
      expect(tube.rect.height, kind).toBeGreaterThanOrEqual(card.target);
      expect(tube.rect.y + tube.rect.height, kind).toBeLessThanOrEqual(a.y + a.height + 0.5);
      if (kind === "kiosk") {
        // The words go to the buttons' left, and three buttons still fit.
        expect(tube.rect.x, kind).toBeGreaterThan(a.x + 100);
        expect(tube.rect.width, kind).toBeGreaterThanOrEqual(3 * card.target + 28);
      } else {
        expect(tube.rect.y - a.y, kind).toBeGreaterThanOrEqual(card.type.small * 0.9 * 1.3 - 0.5);
      }
    }
  });

  it("jumps to a tube's line from the adults' tube buttons", () => {
    const ch = spectrum.create(envWith(() => {}));
    ch.layout(panelCard());
    const tube = ch.controls.find((c) => c.id === "tube")!;
    const g = tube.gesture(2)!;
    tube.begin(touch(g.path[0]!.x, g.path[0]!.y));
    for (let i = 0; i < 240; i++) ch.update(1 / 60, i * 16);
    expect(decode(ch.state())).toBeCloseTo(tubePos("molybdenum"), 2);
  });
});
