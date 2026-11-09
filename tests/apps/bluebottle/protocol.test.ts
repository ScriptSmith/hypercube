import { describe, expect, it } from "vitest";
import { decodeSpec, encodeSpec } from "../../../src/apps/bluebottle/board";
import { CHUNK } from "../../../src/apps/bluebottle/config";
import type { Ev } from "../../../src/apps/bluebottle/patch";
import {
  decodeBeat,
  decodeEv,
  decodeLog,
  decodeSync,
  encodeBeat,
  encodeEv,
  encodeLog,
  encodeSync,
} from "../../../src/apps/bluebottle/protocol";
import { specOf } from "./helpers";

const wire = <T>(v: T): unknown => JSON.parse(JSON.stringify(v));

describe("protocol", () => {
  const spec = { ...specOf(80, 11, 6, "hard", 12, 4_000_000_000), start: 123456.7 };

  it("round-trips specs, rounding the start", () => {
    expect(decodeSpec(wire(encodeSpec(spec)))).toEqual({ ...spec, start: 123457 });
    expect(decodeSpec({ ...encodeSpec(spec), dens: "silly" })).toBeNull();
    expect(decodeSpec({ ...encodeSpec(spec), kid: 12 })).toBeNull();
    expect(decodeSpec(null)).toBeNull();
  });

  it("round-trips events and rejects bad ones", () => {
    const ev: Ev = { k: 1, c: 879, t: 1234.4, s: "frame-a", q: 1_700_000_000_123, h: true };
    const d = decodeEv(wire(encodeEv(spec.b, spec.n, ev)), "frame-a");
    expect(d).toEqual({ b: spec.b, n: spec.n, s: "frame-a", ev: { ...ev, t: 1234, s: undefined } });
    expect(decodeEv({ p: [1, 2], e: [9, 0, 0, 0, 0] }, "x")).toBeNull();
    expect(decodeEv({ p: [1, 2], e: [0, -1, 0, 0, 0] }, "x")).toBeNull();
    expect(decodeEv({ p: [1, 2], e: [0, 0, "t", 0, 0] }, "x")).toBeNull();
    expect(decodeEv({ p: [1, 2], e: [0, 0, 0, 0, 0] }, "")).toBeNull();
  });

  it("round-trips beats", () => {
    const beat = { m: "s" as const, g: { w: 8, r: 11, k: 6 }, p: spec, e: 40, x: 12345 };
    expect(decodeBeat(wire(encodeBeat(beat)))).toEqual({ ...beat, p: { ...spec, start: 123457 } });
    const joining = { m: "j" as const, g: null, p: null, e: 0, x: 0 };
    expect(decodeBeat(wire(encodeBeat(joining)))).toEqual(joining);
    expect(decodeBeat({ m: "q" })).toBeNull();
    expect(decodeBeat({ m: "j", g: [8, 11, 12] })).toBeNull();
  });

  it("round-trips sync requests", () => {
    expect(decodeSync(wire(encodeSync(spec)))).toEqual({ b: spec.b, n: spec.n });
    expect(decodeSync(wire(encodeSync(null)))).toBe("any");
    expect(decodeSync({ p: [1] })).toBeNull();
  });

  it("splits a log into chunks of at most CHUNK events and puts it back together", () => {
    const events: Ev[] = Array.from({ length: 850 }, (_, i) => ({
      k: (i % 4) as Ev["k"],
      c: (i * 7) % 880,
      t: 1000 + i,
      s: `frame-${i % 3}`,
      q: i,
      h: i % 2 === 0,
    }));
    const chunks = encodeLog(spec, events).map(wire);
    expect(chunks.length).toBe(Math.ceil(850 / CHUNK));
    const back = chunks.map((c) => decodeLog(c)!);
    for (const c of back) expect(c.events.length).toBeLessThanOrEqual(CHUNK);
    expect(back.flatMap((c) => c.events)).toEqual(events);
    expect(decodeLog({ ...(chunks[0] as object), i: 9 })).toBeNull();
    // Cells must fit the patch.
    const big = encodeLog({ ...spec, cols: 8, rows: 2 }, events.slice(0, 50)).map(wire);
    expect(decodeLog(big[0])).toBeNull();
  });

  it("sends an empty log as one chunk", () => {
    const chunks = encodeLog(spec, []).map(wire);
    expect(chunks.length).toBe(1);
    expect(decodeLog(chunks[0])?.events).toEqual([]);
  });
});
