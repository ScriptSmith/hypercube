import { describe, expect, it } from "vitest";
import { operatorMessages } from "../../../src/apps/ticker/index";
import manifest, { MESSAGE_MAX } from "../../../src/apps/ticker/manifest";
import { ballFacts, dateLine, FACTS, GREETINGS, timeLine } from "../../../src/apps/ticker/messages";
import { sphereInfo } from "../../../src/core/sphere";

/** En and em dashes. */
const DASHES = new Set([0x2013, 0x2014]);
const ALL = [...GREETINGS, ...FACTS, ...ballFacts(sphereInfo(), 0.32)];

describe("ticker messages", () => {
  it("are short, plain and in sentence case", () => {
    for (const line of ALL) {
      expect(line, line).toMatch(/^[A-Z]/);
      expect(line.length, line).toBeLessThanOrEqual(60);
      expect(
        [...line].some((ch) => DASHES.has(ch.charCodeAt(0))),
        line,
      ).toBe(false);
      expect(line, line).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(line, line).not.toMatch(/[.!]$/);
    }
    expect(new Set(ALL).size).toBe(ALL.length);
  });

  it("say true things about the default ball", () => {
    expect(ballFacts(sphereInfo(), 0.32)).toEqual([
      "This ball is 4 metres across",
      "It is about 13 metres round its middle",
      "Its top is about 7 metres above the floor",
      "Its lowest point is 3 metres above the floor",
      "These words move about 30 centimetres every second",
    ]);
    const low = ballFacts(sphereInfo(undefined, { diameter: 3, bottom: 0.2 }), 0.3);
    expect(low).toContain("This ball is 3 metres across");
    expect(low.some((l) => l.startsWith("Its lowest point"))).toBe(false);
  });

  it("tell the time and the date plainly", () => {
    expect(timeLine(new Date(2026, 10, 2, 15, 5).getTime())).toBe("The time is 3:05 pm");
    expect(timeLine(new Date(2026, 10, 2, 0, 30).getTime())).toBe("The time is 12:30 am");
    expect(timeLine(new Date(2026, 10, 2, 12, 0).getTime())).toBe("The time is 12:00 pm");
    expect(dateLine(new Date(2026, 10, 2, 9).getTime())).toBe("Today is Monday 2 November");
  });

  it("take the operator's messages only from text options, cleaned", () => {
    expect(
      operatorMessages({ message1: "  Hello\tthere ", message2: "", message3: "x".repeat(300) }),
    ).toEqual(["Hello there", "x".repeat(MESSAGE_MAX)]);
    expect(operatorMessages({ message1: 3, rings: "2" })).toEqual([]);
    const texts = (manifest.options ?? []).filter((o) => o.type === "text");
    expect(texts.map((o) => o.key)).toEqual(["message1", "message2", "message3"]);
    for (const o of texts) {
      expect(o.type === "text" && o.maxLength).toBe(MESSAGE_MAX);
      expect(o.type === "text" && o.default).toBe("");
    }
  });
});
