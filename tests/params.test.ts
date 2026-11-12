import { describe, expect, it } from "vitest";
import { coerceOptions, parseParams, presetOptions } from "../src/core/params";
import type { OptionDef } from "../src/core/types";

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

describe("text options a link may set", () => {
  const defs: OptionDef[] = [
    { type: "text", key: "note", title: "Note", maxLength: 12, default: "", url: true },
    { type: "text", key: "ask", title: "Question", maxLength: 12, default: "" },
  ];

  it("take printable text from the URL, cut to length, and only where the option allows", () => {
    const p = parseParams("?app=x&o.note=See%20you%0Asoon%20everyone&o.ask=Click&o.x.note=Bye");
    expect(coerceOptions(p.options, defs)).toEqual({ note: "See you soon", ask: "" });
    expect(coerceOptions({ note: "  " }, defs)).toEqual({ note: "", ask: "" });
    // And for an app a picker starts.
    expect(presetOptions("x", p.options, undefined, defs)).toEqual({ note: "Bye" });
    expect(presetOptions("x", { "x.ask": "Click" }, undefined, defs)).toEqual({});
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

describe("presetOptions", () => {
  const defs: OptionDef[] = [
    { type: "number", key: "hour", title: "Hour", min: 0, max: 23, step: 1, default: 17 },
    { type: "boolean", key: "show", title: "Show", default: true },
    { type: "text", key: "message", title: "Message", maxLength: 10, default: "" },
  ];

  it("reads only the options set for that app, and never text, from the URL", () => {
    const p = parseParams("?app=menu&o.cycle=1&o.glass.hour=21&o.glass.message=Hi&o.other.hour=3");
    expect(presetOptions("glass", p.options, undefined, defs)).toEqual({ hour: 21 });
    expect(presetOptions("other", p.options, undefined, defs)).toEqual({ hour: 3 });
    expect(presetOptions("none", p.options, undefined, defs)).toEqual({});
    // The picker's own options aren't an app's.
    expect(presetOptions("cycle", p.options, undefined, defs)).toEqual({});
  });

  it("lets admin's values, text included, win over the URL's", () => {
    const p = parseParams("?app=menu&o.glass.hour=9&o.glass.show=0");
    const admin = { hour: 12.4, message: "Goodbye for now", stray: true };
    expect(presetOptions("glass", p.options, admin, defs)).toEqual({
      hour: 12,
      show: false,
      message: "Goodbye fo",
    });
  });
});
