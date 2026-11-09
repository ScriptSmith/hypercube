import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chunkEntries,
  LOG_CHUNK_CHARS,
  readLogReply,
  readLogRequest,
} from "../../src/core/admin/logwire";
import { canonical } from "../../src/core/admin/sign";
import {
  createLogBuffer,
  describe as describeArg,
  formatArgs,
  installCapture,
  LOG_CAPACITY,
  LOG_ENTRY_CHARS,
  type LogEntry,
  redact,
} from "../../src/core/logs";

describe("log buffer", () => {
  it("keeps the newest LOG_CAPACITY entries, oldest first, with rising seq", () => {
    let t = 1000;
    const buf = createLogBuffer(LOG_CAPACITY, () => t++);
    for (let i = 1; i <= 1000; i++) buf.add(i % 7 === 0 ? "error" : "log", [`line ${i}`]);
    expect(buf.size).toBe(LOG_CAPACITY);
    const all = buf.entries();
    expect(all).toHaveLength(LOG_CAPACITY);
    expect(all[0]).toMatchObject({ seq: 701, msg: "line 701", t: 1700 });
    expect(all.at(-1)).toMatchObject({ seq: 1000, msg: "line 1000" });
    // Errors are counted since load, evicted ones included.
    expect(buf.errorCount).toBe(Math.floor(1000 / 7));
  });

  it("filters by limit, level and seq", () => {
    const buf = createLogBuffer(10);
    for (const level of ["log", "warn", "error", "info", "error", "uncaught"] as const) {
      buf.add(level, [level]);
    }
    expect(buf.entries({ limit: 2 }).map((e) => e.seq)).toEqual([5, 6]);
    expect(buf.entries({ levels: ["error", "uncaught"] }).map((e) => e.seq)).toEqual([3, 5, 6]);
    expect(buf.entries({ since: 4 }).map((e) => e.seq)).toEqual([5, 6]);
    expect(buf.entries({ since: 4, levels: ["error"], limit: 5 }).map((e) => e.seq)).toEqual([5]);
    expect(buf.entries({ levels: [] })).toHaveLength(6);
  });

  it("caps each entry", () => {
    const buf = createLogBuffer(5);
    buf.add("log", ["x".repeat(5000), "y".repeat(5000)]);
    const [e] = buf.entries();
    expect(e?.msg).toHaveLength(LOG_ENTRY_CHARS);
    expect(e?.msg.endsWith("…")).toBe(true);
  });

  it("can leave an error out of the count", () => {
    const buf = createLogBuffer(5);
    buf.add("error", ["echo"], false);
    expect(buf.errorCount).toBe(0);
    expect(buf.size).toBe(1);
  });
});

describe("redaction", () => {
  it("hides ak, key and room values in URLs and text", () => {
    expect(
      redact("GET https://host/play/?app=diag&room=k3j9x2mq7a&ak=Zv3_jbJ-i5yYPNQ&frame=p1"),
    ).toBe("GET https://host/play/?app=diag&room=[redacted]&ak=[redacted]&frame=p1");
    expect(redact("key=abc123 and AK=XYZ, Room=r1")).toBe(
      "key=[redacted] and AK=[redacted], Room=[redacted]",
    );
    expect(redact("monkey=banana room:main")).toBe("monkey=banana room:main");
  });

  it("applies to every formatted entry, objects included", () => {
    const buf = createLogBuffer(5);
    buf.add("error", ["failed", { url: "/admin/?room=abc&ak=secret" }]);
    expect(buf.entries()[0]?.msg).toBe('failed {"url":"/admin/?room=[redacted]&ak=[redacted]"}');
  });
});

describe("formatting odd arguments", () => {
  it("never throws and says something useful", () => {
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;
    const hostile = {
      get boom() {
        throw new Error("getter");
      },
    };
    const proxy = new Proxy(
      {},
      {
        get() {
          throw new Error("trap");
        },
        ownKeys() {
          throw new Error("trap");
        },
        getPrototypeOf() {
          throw new Error("trap");
        },
      },
    );
    const badJson = {
      toJSON() {
        throw new Error("nope");
      },
    };
    const odd: unknown[] = [
      circular,
      Symbol("tag"),
      10n,
      () => 1,
      function named() {},
      undefined,
      null,
      Number.NaN,
      hostile,
      proxy,
      badJson,
      Object.create(null),
      new Map([[1, 2]]),
      new Set([1]),
      new Uint8Array(4),
      { big: 1n, sym: Symbol.iterator, fn: Math.max, nested: { deeper: [1, 2, 3] } },
      Array.from({ length: 100_000 }, (_, i) => i),
      new Error("plain"),
    ];
    const buf = createLogBuffer(50);
    for (const v of odd) expect(() => buf.add("log", [v])).not.toThrow();
    expect(() => buf.add("log", odd)).not.toThrow();
    const msgs = buf.entries().map((e) => e.msg);
    expect(msgs[0]).toBe('{"name":"loop","self":"[circular]"}');
    expect(msgs[1]).toBe("Symbol(tag)");
    expect(msgs[2]).toBe("10");
    expect(msgs[3]).toMatch(/^\[function/);
    expect(msgs[4]).toBe("[function named]");
    expect(msgs[5]).toBe("undefined");
    expect(msgs[8]).toBe("[object Object]");
    expect(msgs[10]).toBe("[object Object]");
    expect(msgs[12]).toBe('"[Map of 1]"');
    expect(msgs[15]).toBe(
      '{"big":"1n","sym":"Symbol(Symbol.iterator)","fn":"[function max]","nested":{"deeper":[1,2,3]}}',
    );
    expect(msgs[16]).toContain("99950 more");
    expect(msgs[17]).toContain("Error: plain");
  });

  it("reads errors from another realm, as an iframe's would be", () => {
    const foreign: unknown = runInNewContext('new TypeError("from elsewhere")');
    expect(foreign instanceof Error).toBe(false);
    expect(formatArgs(["Unhandled rejection:", foreign])).toMatch(
      /^Unhandled rejection: TypeError: from elsewhere/,
    );
  });

  it("describes one argument within a budget", () => {
    expect(describeArg("abcdef", 3)).toBe("abc");
    expect(formatArgs(["a", 1, true, null])).toBe("a 1 true null");
  });
});

describe("console capture", () => {
  const fakeWindow = () => {
    const events = new EventTarget();
    const calls: [string, unknown[]][] = [];
    const con = {
      log: (...a: unknown[]) => void calls.push(["log", a]),
      info: (...a: unknown[]) => void calls.push(["info", a]),
      warn: (...a: unknown[]) => void calls.push(["warn", a]),
      error: (...a: unknown[]) => void calls.push(["error", a]),
      debug: (..._a: unknown[]) => {
        throw new Error("broken console");
      },
    };
    const win = Object.assign(events, {
      console: con,
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    }) as unknown as Window & typeof globalThis;
    return { win, con, calls, events };
  };

  afterEach(() => vi.useRealTimers());

  it("records every level, keeps calling the originals and undoes itself", () => {
    const { win, con, calls } = fakeWindow();
    const original = con.log;
    const buf = createLogBuffer(20);
    const stop = installCapture(buf, win);
    con.log("hello", 1);
    con.info("info");
    con.warn("warn");
    con.error("error");
    expect(() => con.debug("debug")).not.toThrow();
    expect(calls.map((c) => c[0])).toEqual(["log", "info", "warn", "error"]);
    expect(calls[0]?.[1]).toEqual(["hello", 1]);
    expect(buf.entries().map((e) => [e.level, e.msg])).toEqual([
      ["log", "hello 1"],
      ["info", "info"],
      ["warn", "warn"],
      ["error", "error"],
      ["log", "debug"],
    ]);
    stop();
    expect(con.log).toBe(original);
    con.log("after");
    expect(buf.size).toBe(5);
  });

  it("doesn't record logging done while formatting an argument", () => {
    const { win, con, calls } = fakeWindow();
    const buf = createLogBuffer(20);
    installCapture(buf, win);
    const sneaky = {
      toJSON() {
        con.log("inside");
        return "sneaky";
      },
    };
    con.log(sneaky);
    expect(buf.entries().map((e) => e.msg)).toEqual(['"sneaky"']);
    expect(calls.map((c) => c[1][0])).toEqual(["inside", sneaky]);
  });

  it("records uncaught errors and rejections, counting the runtime's echo once", () => {
    vi.useFakeTimers();
    const { win, con, events } = fakeWindow();
    const buf = createLogBuffer(20);
    installCapture(buf, win);
    const err = new Error("kaboom");
    const ev = Object.assign(new Event("error"), {
      message: "Uncaught Error: kaboom",
      filename: "https://host/play/app.js?room=abc",
      lineno: 3,
      colno: 9,
      error: err,
    });
    events.dispatchEvent(ev);
    // The runtime's own listener reports the same error in the same task.
    con.error("[hypercube]", "Uncaught Error: kaboom");
    vi.advanceTimersByTime(1);
    events.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: "nope" }));
    vi.advanceTimersByTime(1);
    con.error("later");
    const entries = buf.entries();
    expect(entries.map((e) => e.level)).toEqual(["uncaught", "error", "uncaught", "error"]);
    expect(entries[0]?.msg).toMatch(/^Uncaught Error: kaboom \(app\.js:3:9\)\nError: kaboom/);
    expect(entries[2]?.msg).toBe("Unhandled rejection: nope");
    expect(buf.errorCount).toBe(3);
  });
});

describe("log replies on the wire", () => {
  const entry = (seq: number, msg: string): LogEntry => ({ seq, t: 1000 + seq, level: "log", msg });

  it("chunk under the budget without losing or reordering entries", () => {
    const entries = Array.from({ length: LOG_CAPACITY }, (_, i) =>
      entry(i + 1, `"quoted\\" ${"é\n".repeat(200)}`.slice(0, LOG_ENTRY_CHARS)),
    );
    const parts = chunkEntries(entries);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(canonical(p).length).toBeLessThanOrEqual(LOG_CHUNK_CHARS);
    expect(parts.flat().map((w) => w.s)).toEqual(entries.map((e) => e.seq));
    expect(chunkEntries([])).toEqual([]);
  });

  it("read requests with limits, levels and per-load since", () => {
    expect(readLogRequest({}, "p1", "boot1")).toEqual({ limit: 100 });
    expect(readLogRequest({ limit: 9999, levels: ["error", "bogus"] }, "p1", "b")).toEqual({
      limit: LOG_CAPACITY,
      levels: ["error"],
    });
    expect(readLogRequest({ since: 12 }, "p1", "b").since).toBe(12);
    const since = { p1: { b: "boot1", s: 40 }, p2: { b: "x", s: 9 } };
    expect(readLogRequest({ since }, "p1", "boot1").since).toBe(40);
    expect(readLogRequest({ since }, "p1", "boot2").since).toBeUndefined();
    expect(readLogRequest({ since }, "p3", "boot1").since).toBeUndefined();
  });

  it("read replies defensively", () => {
    expect(readLogReply({ ref: "r", part: 0, parts: 1, boot: "b", entries: "x" })).toBeNull();
    const reply = readLogReply({
      ref: "r",
      part: 0,
      parts: 1,
      boot: "b",
      size: 2,
      errors: 1,
      entries: [{ s: 1, t: 2, l: "error", m: "x" }, { s: 2, t: 3, l: "shout", m: "y" }, null],
    });
    expect(reply?.entries).toEqual([{ s: 1, t: 2, l: "error", m: "x" }]);
  });
});
