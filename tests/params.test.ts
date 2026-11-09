import { describe, expect, it } from "vitest";
import { coerceOptions, parseParams } from "../src/core/params";

describe("parseParams", () => {
  it("reads identity, setup and options", () => {
    const p = parseParams(
      "?app=hockey&variant=paddles&o.pucks=3&setup=bank&pos=4&count=6&frame=za:d10:r0&room=abc",
    );
    expect(p.app).toBe("hockey");
    expect(p.variant).toBe("paddles");
    expect(p.options).toEqual({ pucks: "3" });
    expect(p.setup).toBe("bank");
    expect(p.pos).toBe(4);
    expect(p.count).toBe(6);
    expect(p.frame).toBe("za:d10:r0");
    expect(p.unfilled).toBe(false);
  });

  it("treats unfilled host placeholders as missing and flags them", () => {
    const p = parseParams("?app=hockey&frame={frame}&pos={index}");
    expect(p.frame).toBeNull();
    expect(p.pos).toBeNull();
    expect(p.unfilled).toBe(true);
  });

  it("parses fit, reach and defaults", () => {
    const p = parseParams("?fit=1080x1920&reach=0.4,0.2");
    expect(p.fit).toEqual({ width: 1080, height: 1920 });
    expect(p.reach).toEqual({ adult: 0.4, child: 0.2 });
    expect(p.app).toBe("idle");
    expect(p.peer).toBe("public");
    expect(p.transport).toBe("peer");
  });
});

describe("coerceOptions", () => {
  it("falls back to defaults for bad values", () => {
    const out = coerceOptions({ speed: "99", mode: "nope", fast: "1" }, [
      { type: "number", key: "speed", title: "Speed", min: 1, max: 5, step: 1, default: 2 },
      {
        type: "enum",
        key: "mode",
        title: "Mode",
        values: [{ id: "a", title: "A" }],
        default: "a",
      },
      { type: "boolean", key: "fast", title: "Fast", default: false },
    ]);
    expect(out).toEqual({ speed: 2, mode: "a", fast: true });
  });
});

describe("text options", () => {
  it("never read operator text from the URL", () => {
    const p = parseParams("?app=ballpit&o.ask=Click%20here&o.a1=Yes");
    expect(p.options).toEqual({ ask: "Click here", a1: "Yes" });
    const out = coerceOptions(p.options, [
      { type: "text", key: "ask", title: "Question", maxLength: 80, default: "" },
      { type: "text", key: "a1", title: "Answer 1", maxLength: 20, default: "Cats" },
    ]);
    expect(out).toEqual({ ask: "", a1: "Cats" });
  });
});

describe("apps options", () => {
  it("keeps app ids and app:variant presets, dropping anything else", () => {
    const out = coerceOptions({ apps: "hockey,hockey:defence,Bad Id,tinyworld:,x:y:z,tinyworld" }, [
      { type: "apps", key: "apps", title: "Apps", default: [] },
    ]);
    expect(out.apps).toBe("hockey,hockey:defence,tinyworld");
  });
});
