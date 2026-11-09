import { describe, expect, it } from "vitest";
import { leaderOf } from "../../src/core/net/channel";
import { createSyncClock } from "../../src/core/net/clock";
import { hubId, isValidPeerId, memberId, roomNamespace } from "../../src/core/net/ids";
import {
  cleanInfo,
  cleanStatus,
  MAX_STATUS_BYTES,
  readFromHub,
  readToHub,
} from "../../src/core/net/protocol";
import { brokerFor, OWN_ICE, peerOptions } from "../../src/core/net/signalling";
import { info } from "./helpers";

describe("ids", () => {
  it("derives valid, distinct PeerJS ids from any room token", () => {
    const tokens = ["abc", "a b:c/d", "", "--__--", "ümlaut", "x".repeat(500)];
    const seen = new Set<string>();
    for (const token of tokens) {
      const ns = roomNamespace(token);
      expect(isValidPeerId(ns)).toBe(true);
      expect(isValidPeerId(hubId(ns, 3))).toBe(true);
      expect(isValidPeerId(memberId(ns, Math.random))).toBe(true);
      seen.add(ns);
    }
    expect(seen.size).toBe(tokens.length);
    expect(roomNamespace("abc")).toBe(roomNamespace("abc"));
  });

  it("matches PeerJS id rules", () => {
    expect(isValidPeerId("a-b_c")).toBe(true);
    expect(isValidPeerId("a--b")).toBe(false);
    expect(isValidPeerId("-a")).toBe(false);
    expect(isValidPeerId("a:b")).toBe(false);
  });
});

describe("signalling", () => {
  it("uses PeerJS defaults for the public broker", () => {
    expect(peerOptions("public")).toEqual({ debug: 0 });
  });

  it("parses a PeerServer URL", () => {
    expect(peerOptions("wss://signal.example:9443/rtc")).toEqual({
      debug: 0,
      host: "signal.example",
      port: 9443,
      path: "/rtc/",
      secure: true,
      config: { iceServers: OWN_ICE },
    });
    expect(peerOptions("wss://signal.example")).toMatchObject({ port: 443, path: "/" });
    expect(peerOptions("ws://localhost:9000/")).toMatchObject({ port: 9000, secure: false });
  });

  it("passes a key query parameter as the PeerJS key", () => {
    expect(peerOptions("wss://signal.example/rtc?key=s3cret")).toMatchObject({
      path: "/rtc/",
      key: "s3cret",
    });
    expect(peerOptions("wss://signal.example/rtc")).not.toHaveProperty("key");
  });

  it("rejects unusable URLs", () => {
    expect(peerOptions("https://signal.example")).toBeNull();
    expect(peerOptions("not a url")).toBeNull();
  });

  it("treats the public broker's ids as stale and keeps its slow rejoins and ICE defaults", () => {
    const broker = brokerFor("public");
    expect(broker.stale).toBe(true);
    expect(broker.timing).toEqual({});
    expect(broker.options).not.toHaveProperty("config");
    expect(brokerFor("").stale).toBe(true);
  });

  it("trusts our own server's ids, rejoins quickly and uses STUN only", () => {
    const broker = brokerFor("wss://signal.example/rtc?key=k");
    expect(broker.stale).toBe(false);
    expect(broker.timing.followDelay).toEqual([300, 1000]);
    const servers = broker.options?.config?.iceServers as RTCIceServer[];
    expect(servers.length).toBeGreaterThan(0);
    for (const s of servers) {
      for (const u of [s.urls].flat()) expect(u).toMatch(/^stun:/);
    }
    const custom = [{ urls: "stun:stun.example:3478" }];
    expect(brokerFor("wss://signal.example", custom).options?.config).toEqual({
      iceServers: custom,
    });
    expect(brokerFor("ws://localhost:9000/").stale).toBe(false);
  });
});

describe("leaderOf", () => {
  it("prefers a screen, then the lowest pos, then the lowest frame id", () => {
    expect(leaderOf([])).toBeNull();
    expect(leaderOf([info("b", { pos: 1 }), info("c", { pos: 0 })])).toBe("c");
    expect(leaderOf([info("b"), info("a"), info("c")])).toBe("a");
    expect(
      leaderOf([info("a", { pos: 0 }), info("z", { role: "screen", pos: 3 }), info("b")]),
    ).toBe("z");
    expect(
      leaderOf([info("y", { role: "screen", pos: 1 }), info("x", { role: "screen", pos: 1 })]),
    ).toBe("x");
  });
});

describe("protocol", () => {
  it("rejects malformed messages", () => {
    expect(readToHub("not json")).toBeNull();
    expect(readToHub('{"t":"m","c":1}')).toBeNull();
    expect(readToHub('{"t":"nope"}')).toBeNull();
    expect(readFromHub('{"t":"wel","k":"1"}')).toBeNull();
    expect(readToHub('{"t":"m","c":"c","k":"k","d":{"a":1},"to":"f"}')).toEqual({
      t: "m",
      c: "c",
      k: "k",
      d: { a: 1 },
      to: "f",
    });
  });

  it("bounds status payloads", () => {
    const big = Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [`k${i}`, "v".repeat(200)]),
    );
    const clean = cleanStatus(big)!;
    expect(JSON.stringify(clean).length).toBeLessThanOrEqual(MAX_STATUS_BYTES);
    expect(Object.values(clean).every((v) => typeof v === "string" && v.length <= 120)).toBe(true);
    expect(cleanStatus({ ok: true, n: 1, nan: Number.NaN, obj: {} })).toEqual({ ok: true, n: 1 });
  });

  it("keeps a merged frame's span within bounds", () => {
    const base = { frame: "f", app: "a", group: "g", kind: "pair", role: "station", pos: 0 };
    expect(cleanInfo({ ...base, span: 3 })?.span).toBe(3);
    expect(cleanInfo({ ...base, span: 99 })?.span).toBe(16);
    expect(cleanInfo({ ...base, span: 1 })?.span).toBeUndefined();
    expect(cleanInfo({ ...base, span: "3" })?.span).toBeUndefined();
  });
});

describe("createSyncClock", () => {
  const fixture = () => {
    let t = 1000;
    const clock = createSyncClock(() => t);
    return {
      clock,
      tick: (ms: number) => {
        t += ms;
      },
    };
  };

  it("syncs after a few samples using the lowest-RTT ones", () => {
    const { clock, tick } = fixture();
    clock.sample(500, 200);
    clock.sample(480, 150);
    expect(clock.synced).toBe(false);
    clock.sample(100, 10);
    expect(clock.synced).toBe(true);
    clock.sample(102, 12);
    clock.sample(98, 8);
    clock.sample(101, 11);
    tick(10_000);
    expect(clock.offset()).toBeCloseTo(100.5, 5);
    expect(clock.now()).toBeCloseTo(11_000 + 100.5, 0);
  });

  it("slews small corrections and holds still through large backward ones", () => {
    const { clock, tick } = fixture();
    for (let i = 0; i < 3; i++) clock.sample(1000, 5);
    const start = clock.now();
    expect(start).toBe(2000);
    for (let i = 0; i < 4; i++) clock.sample(1050, 1);
    tick(100);
    // At most 5 % of 100 ms of the 50 ms correction gets applied.
    expect(clock.now()).toBeCloseTo(2000 + 100 + 5, 5);
    tick(2000);
    expect(clock.now()).toBeCloseTo(3100 + 1050, 5);

    const before = clock.now();
    for (let i = 0; i < 8; i++) clock.sample(-1000, 0.5);
    expect(clock.now()).toBe(before);
    tick(1000);
    expect(clock.now()).toBe(before);
    tick(1500);
    expect(clock.now()).toBeGreaterThan(before);
    expect(clock.now()).toBeCloseTo(5600 - 1000, 5);
  });
});
