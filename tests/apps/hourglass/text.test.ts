import { describe, expect, it } from "vitest";
import manifest, { SANDS, TEXT_MAX } from "../../../src/apps/hourglass/manifest";
import { COLLAR_LAT } from "../../../src/apps/hourglass/levels";
import { INLAY_HALF, layoutRings } from "../../../src/apps/hourglass/rings";
import { cleanLine, fitRing, linesOf, timeLine, TIMES_UP } from "../../../src/apps/hourglass/text";
import { DEG, sphereInfo } from "../../../src/core/sphere";

/** En and em dashes. */
const DASHES = [0x2013, 0x2014];

describe("hourglass lettering", () => {
  it("declares its lines as operator text, never as something a link can carry", () => {
    const texts = (manifest.options ?? []).filter((o) => o.type === "text");
    expect(texts.map((o) => o.key)).toEqual(["message", "ending"]);
    for (const o of texts) {
      expect(o.type === "text" && o.maxLength).toBe(TEXT_MAX);
      expect(o.type === "text" && o.default).toBe("");
      expect(o.visitor).toBeUndefined();
    }
    expect(TEXT_MAX).toBe(120);
    const sand = (manifest.options ?? []).find((o) => o.key === "sand");
    expect(sand?.visitor).toBe(true);
    expect(sand?.type === "enum" && sand.values.map((v) => v.id)).toEqual([...SANDS]);
    expect(sand?.type === "enum" && sand.default).toBe("golden");
    expect(manifest.setups).toEqual([
      expect.objectContaining({ setup: "solo", kinds: ["sphere"] }),
    ]);
  });

  it("keeps the built-in line and every title short and plain", () => {
    const words = [
      TIMES_UP,
      manifest.title,
      manifest.blurb,
      ...manifest.options!.map((o) => o.title),
    ];
    for (const line of words) {
      expect(line).toMatch(/^[A-Z]/);
      expect([...line].some((ch) => DASHES.includes(ch.charCodeAt(0)))).toBe(false);
    }
    expect(TIMES_UP.length).toBeLessThan(12);
    expect(cleanLine(TIMES_UP)).toBe(TIMES_UP);
  });

  it("draws only characters the lettering has, and drops the rest", () => {
    expect(cleanLine("  Hello\tthere \n")).toBe("Hello there");
    expect(cleanLine("Open till 5 pm: see you soon!")).toBe("Open till 5 pm: see you soon!");
    expect(cleanLine("Café à la crème, 100 %")).toBe("Café à la crème, 100 %");
    const party = String.fromCodePoint(0x1f389);
    const heart = String.fromCodePoint(0x2764, 0xfe0f);
    expect(cleanLine(`Thanks ${party}${party} everyone ${heart}`)).toBe("Thanks everyone");
    // Curly quotes, an en dash, an apostrophe and an ellipsis are kept.
    const at = (...codes: number[]) => String.fromCodePoint(...codes);
    const fancy = `${at(0x201c)}Quoted${at(0x201d)} ${at(0x2013)} it${at(0x2019)}s fine${at(0x2026)}`;
    expect(cleanLine(fancy)).toBe(fancy);
    expect(cleanLine(`a ${at(0x2014)} b`)).toBe(`a ${at(0x2014)} b`);
    expect(cleanLine(`${at(0x65e5, 0x672c, 0x8a9e)} text`)).toBe("text");
    expect(cleanLine("x".repeat(300))).toBe("x".repeat(TEXT_MAX));
    expect(cleanLine("a".repeat(119) + " b")).toBe("a".repeat(119));
    for (const junk of [undefined, null, 5, true, {}, ["a"]]) expect(cleanLine(junk)).toBe("");
  });

  it("reads the operator's lines from the options", () => {
    expect(linesOf({})).toEqual({ message: "", ending: "", countdown: true });
    expect(linesOf({ message: " Goodbye  for now ", ending: "The end", countdown: false })).toEqual(
      {
        message: "Goodbye for now",
        ending: "The end",
        countdown: false,
      },
    );
  });

  it("shows the time left through the run and a closing line after it", () => {
    const plain = linesOf({});
    expect(timeLine(plain, true, "3 h 4 min")).toBe("3 h 4 min");
    expect(timeLine(plain, false, "1")).toBe(TIMES_UP);
    const own = linesOf({ ending: "See you tomorrow" });
    expect(timeLine(own, true, "12:07")).toBe("12:07");
    expect(timeLine(own, false, "1")).toBe("See you tomorrow");
    // With the countdown off, only a line the operator wrote appears.
    const quiet = linesOf({ countdown: false });
    expect(timeLine(quiet, true, "12:07")).toBe("");
    expect(timeLine(quiet, false, "1")).toBe("");
    expect(timeLine(linesOf({ countdown: false, ending: "Closed" }), false, "1")).toBe("Closed");
  });

  it("repeats a short line round a ring and crawls a long one", () => {
    // Seven copies with room between: a sign that stands still.
    const sign = fitRing(0.6, 6.28, 0.25, true);
    expect(sign).toEqual({ repeats: 7, period: 6.28 / 7, seam: false, crawl: false });
    // The same line on a ring that always moves.
    expect(fitRing(0.6, 6.28, 0.25, false).crawl).toBe(true);
    // Too few copies for everyone to face one, so it goes round.
    const two = fitRing(2.5, 6.28, 0.25, true);
    expect(two).toEqual({ repeats: 2, period: 3.14, seam: false, crawl: true });
    // Longer than the ring: it has to start and end somewhere.
    const long = fitRing(9, 6.28, 0.25, true);
    expect(long).toEqual({ repeats: 0, period: 9.25, seam: true, crawl: true });
    // Copies always close exactly round the ring.
    for (const length of [0.1, 0.33, 1.7, 3, 6]) {
      const fit = fitRing(length, 6.28, 0.2, true);
      expect(fit.repeats * fit.period).toBeCloseTo(6.28, 9);
      expect(fit.period).toBeGreaterThanOrEqual(length + 0.2 - 1e-9);
    }
  });

  it("puts the time on the collar, the message below it and a ring round the pole", () => {
    const rings = layoutRings(sphereInfo());
    expect(rings.map((r) => r.role)).toEqual(["collar", "message", "pole"]);
    const [collar, message, pole] = rings as [
      (typeof rings)[0],
      (typeof rings)[0],
      (typeof rings)[0],
    ];
    expect(collar.lat).toBe(0);
    expect(collar.half).toBe(INLAY_HALF);
    expect(collar.half).toBeLessThan(COLLAR_LAT - DEG);
    expect(message.lat + message.half).toBeLessThan(-COLLAR_LAT);
    expect(message.lat - message.half).toBeGreaterThan(pole.lat + pole.half);
    expect(pole.lat - pole.half).toBeGreaterThan(-80 * DEG);
    for (const r of rings) {
      expect(r.half).toBeGreaterThan(3 * DEG);
      expect(r.speed).toBeGreaterThan(0);
    }
  });

  it("fits the rings to a ball seen only from the side, or cut short", () => {
    const side = layoutRings(sphereInfo(undefined, { view: { top: 60, bottom: -40 } }));
    expect(side.map((r) => r.role)).toEqual(["collar", "message"]);
    const message = side[1]!;
    expect(message.lat - message.half).toBeGreaterThanOrEqual(-40 * DEG);
    expect(message.lat + message.half).toBeLessThan(-COLLAR_LAT);
    // Little room below the collar: a smaller band, slower to match.
    const tight = layoutRings(sphereInfo(undefined, { view: { top: 60, bottom: -22 } }));
    expect(tight[1]!.half).toBeLessThan(message.half);
    expect(tight[1]!.speed).toBeLessThan(message.speed);
    // None at all: only the collar.
    const none = layoutRings(sphereInfo(undefined, { cover: { top: 90, bottom: -12 } }));
    expect(none.map((r) => r.role)).toEqual(["collar"]);
  });
});
