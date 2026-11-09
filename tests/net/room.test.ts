import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hubId, roomNamespace } from "../../src/core/net/ids";
import { MAX_MEMBERS, RELAY_BURST } from "../../src/core/net/protocol";
import { brokerFor } from "../../src/core/net/signalling";
import { createRng } from "../../src/core/rng";
import type { Room } from "../../src/core/types";
import { advance, createWorld, frames, type World } from "./helpers";

let world: World;

beforeEach(() => {
  vi.useFakeTimers();
  world = createWorld();
});

afterEach(() => {
  world.closeAll();
  vi.clearAllTimers();
  vi.useRealTimers();
});

const startMany = (names: string[]) => names.map((n) => world.join(n));

describe("election", () => {
  it("elects exactly one hub among many frames", async () => {
    const rooms = startMany(["a", "b", "c", "d", "e", "f"]);
    await advance(5000);
    expect(world.hubs()).toHaveLength(1);
    const hubFrame = world.hubs()[0];
    for (const r of rooms) {
      expect(r.status).toBe("online");
      expect(frames(r)).toEqual(["a", "b", "c", "d", "e", "f"]);
      expect((await r.stats()).hub).toBe(hubFrame);
    }
    expect(world.net.held().filter((id) => id.includes("-hub"))).toHaveLength(1);
  });

  it("prefers a screen as hub", async () => {
    startMany(["s1", "s2", "s3"]);
    world.join("top", { role: "screen", kind: "screen" });
    await advance(5000);
    expect(world.hubs()).toEqual(["top"]);
  });

  it("fails over when the hub closes", async () => {
    startMany(["a", "b", "c", "d"]);
    await advance(5000);
    const [old] = world.hubs();
    world.room(old!).close();
    await advance(3000);
    const rest = ["a", "b", "c", "d"].filter((n) => n !== old);
    expect(world.hubs()).toHaveLength(1);
    expect(rest).toContain(world.hubs()[0]);
    for (const n of rest) {
      expect(world.room(n).status).toBe("online");
      expect(frames(world.room(n))).toEqual(rest);
    }
  });

  it("moves to the next slot when a crashed hub's id is still held, then back", async () => {
    world.join("top", { role: "screen" });
    startMany(["a", "b", "c"]);
    await advance(5000);
    expect(world.hubs()).toEqual(["top"]);

    // The hub's machine dies; the broker keeps its id.
    world.net.crash("top");
    world.room("top").close();
    await advance(20_000);
    expect(world.hubs()).toHaveLength(1);
    expect(world.net.held().some((id) => id.endsWith("-hub1"))).toBe(true);
    for (const n of ["a", "b", "c"]) {
      expect(world.room(n).status).toBe("online");
      expect(frames(world.room(n))).toEqual(["a", "b", "c"]);
    }

    // The broker frees the dead id and a new screen takes slot 0. The slot 1 hub finds it and
    // steps down, so the room ends with one hub again.
    world.net.expire("top");
    world.join("top2", { role: "screen" });
    await advance(30_000);
    expect(world.hubs()).toEqual(["top2"]);
    expect(world.net.held().filter((id) => id.includes("-hub"))).toHaveLength(1);
    for (const n of ["a", "b", "c", "top2"]) {
      expect(frames(world.room(n))).toEqual(["a", "b", "c", "top2"]);
    }
  });

  it("resolves two hubs on one slot when the broker loses the hub's id", async () => {
    startMany(["a", "b", "c"]);
    await advance(5000);
    const [old] = world.hubs();
    const slot0 = world.net.held().find((id) => id.endsWith("-hub0"))!;
    world.net.evict(slot0);
    world.join("top", { role: "screen" });
    await advance(10_000);
    expect(world.hubs()).toEqual(["top"]);
    expect(world.room(old!).isHub).toBe(false);
    for (const n of ["a", "b", "c", "top"]) {
      expect(world.room(n).status).toBe("online");
      expect(frames(world.room(n))).toEqual(["a", "b", "c", "top"]);
    }
  });

  it("drops a member whose heartbeats stop", async () => {
    world.join("top", { role: "screen" });
    startMany(["a", "b"]);
    await advance(5000);
    world.net.crash("b");
    await advance(10_000);
    expect(frames(world.room("top"))).toEqual(["a", "top"]);
    expect(frames(world.room("a"))).toEqual(["a", "top"]);
  });

  it("detects a silent hub and re-elects", async () => {
    world.join("top", { role: "screen" });
    startMany(["a", "b"]);
    await advance(5000);
    // A network partition: links stay open but nothing gets through.
    world.net.block("top", "a");
    world.net.block("top", "b");
    await advance(20_000);
    const hubs = world.hubs();
    expect(hubs).toContain("top");
    expect(hubs.filter((h) => h !== "top")).toHaveLength(1);
    expect(frames(world.room("a"))).toEqual(["a", "b"]);
  });
});

describe("broker load and busy event loops", () => {
  it("joins 30 frames with about one broker connection each", async () => {
    // A PeerServer takes about 5 s to say that nobody holds an id.
    world.net.expireDelay = 5000;
    world.join("s0", { role: "screen" });
    world.join("s1", { role: "screen" });
    const names = Array.from({ length: 28 }, (_, i) => `p${String(i).padStart(2, "0")}`);
    startMany(names);
    await advance(10_000);
    expect(world.hubs()).toHaveLength(1);
    for (const r of world.rooms.values()) expect(r.roster()).toHaveLength(30);
    // One member endpoint per non-hub frame, the hub's claim, and the second screen's claim.
    expect(world.net.claims).toBeLessThanOrEqual(32);

    const before = world.net.claims;
    const [old] = world.hubs();
    world.room(old!).close();
    await advance(10_000);
    expect(world.hubs()).toHaveLength(1);
    for (const [n, r] of world.rooms) if (n !== old) expect(r.roster()).toHaveLength(29);
    // Only the successor claims; everyone else rejoins over the connection it already has.
    expect(world.net.claims - before).toBeLessThanOrEqual(2);
  });

  it("retries a connect that the broker lost while the hub was claiming", async () => {
    world.net.expireDelay = 5000;
    const a = world.join("a");
    await advance(2100);
    world.join("s", { role: "screen" });
    for (let i = 0; i < 60; i++) {
      await advance(250);
      expect(world.hubs().filter((h) => h !== "s")).toEqual([]);
    }
    expect(a.status).toBe("online");
    expect(frames(a)).toEqual(["a", "s"]);
  });

  it("does not mistake a stalled event loop for a dead hub", async () => {
    world.join("top", { role: "screen" });
    startMany(["a", "b"]);
    await advance(5000);
    const events: string[] = [];
    for (const [n, r] of world.rooms) r.onStatus((s) => events.push(`${n}:${s}`));
    // Local clocks jump 9 s with no timers or messages run, as when every simulator frame's
    // shared main thread is blocked.
    vi.setSystemTime(Date.now() + 9000);
    await advance(10_000);
    expect(events).toEqual([]);
    expect(world.hubs()).toEqual(["top"]);
    expect(frames(world.room("top"))).toEqual(["a", "b", "top"]);
  });

  it("never makes a second hub when a hub with a live id is slow to answer", async () => {
    world.net.stale = false;
    world.join("top", { role: "screen" });
    await advance(1000);
    // Slower than the connect timeout, as on a badly overloaded shared event loop.
    world.net.latency = (from, to) => (from === "top" && (to === "a" || to === "s2") ? 9000 : 5);
    const a = world.join("a");
    const s2 = world.join("s2", { role: "screen" });
    for (let i = 0; i < 30; i++) {
      await advance(1000);
      expect(world.hubs()).toEqual(["top"]);
    }
    world.net.latency = () => 5;
    await advance(30_000);
    expect(a.status).toBe("online");
    expect(s2.status).toBe("online");
    expect(world.hubs()).toEqual(["top"]);
  });
});

describe("our own signalling server", () => {
  it("waits for a half-open hub's id instead of moving to another slot", async () => {
    // Our server's ids are never stale; it frees a dead peer's id at the latest after 12 s of
    // silence on a half-open socket.
    world = createWorld("own-room", brokerFor("wss://signal.example/").timing);
    world.net.stale = false;
    world.join("top", { role: "screen" });
    startMany(["a", "b", "c"]);
    await advance(5000);
    world.net.crash("top");
    world.room("top").close();
    let elapsed = 0;
    let recovered = 0;
    while (elapsed < 30_000) {
      await advance(250);
      elapsed += 250;
      if (elapsed === 12_000) world.net.expire("top");
      expect(world.net.held().some((id) => /-hub[1-9]$/.test(id))).toBe(false);
      const rest = ["a", "b", "c"].map((n) => world.room(n));
      if (!recovered && world.hubs().length === 1 && rest.every((r) => r.roster().length === 3)) {
        recovered = elapsed;
      }
    }
    expect(recovered).toBeGreaterThan(12_000);
    expect(recovered).toBeLessThan(22_000);
    expect(world.hubs()).toHaveLength(1);
  });
});

describe("hostile hub", () => {
  it("can't grow a member's roster without bound or churn it quickly", async () => {
    const claim = world.net.transport("evil").open(hubId(roomNamespace("test-room"), 0));
    await advance(20);
    const evil = await claim;
    let key = 100;
    const fake = (n: number) =>
      Array.from({ length: n }, () => {
        key++;
        return {
          k: String(key),
          i: { frame: `f${key}`, app: "x", group: "g", kind: "panel", role: "solo", pos: 0 },
          j: 0,
        };
      });
    evil.onLink((link) => {
      link.onMessage((text) => {
        if (!text.includes('"hello"')) return;
        link.send(JSON.stringify({ t: "wel", v: 1, k: "1", h: "evil", s: 0, r: [] }));
        let previous: string[] = [];
        for (let i = 0; i < 200; i++) {
          const u = fake(97);
          link.send(JSON.stringify({ t: "ro", u, x: previous }));
          previous = u.map((e) => e.k);
        }
      });
    });
    const a = world.join("a");
    const seen = new Set<string>();
    let largest = 0;
    a.onRoster((r) => {
      largest = Math.max(largest, r.length);
      for (const e of r) seen.add(e.frame);
    });
    await advance(5000);
    expect(a.status).toBe("online");
    expect(largest).toBeLessThanOrEqual(MAX_MEMBERS + 1);
    // 19,400 entries were offered. One full roster gets in, then about 10 a second.
    expect(seen.size).toBeLessThan(MAX_MEMBERS + 1 + 10 * 6);
    world.net.crash("evil");
    evil.close();
  });
});

describe("hubEligible false", () => {
  it("never claims the hub and waits for one to appear", async () => {
    const admin = world.join("admin", {}, 0, false);
    await advance(20_000);
    expect(admin.isHub).toBe(false);
    expect(admin.status).toBe("connecting");
    expect(world.net.held().some((id) => id.includes("-hub"))).toBe(false);

    world.join("a");
    await advance(20_000);
    expect(world.hubs()).toEqual(["a"]);
    expect(admin.status).toBe("online");
    expect(frames(admin)).toEqual(["a", "admin"]);
  });

  it("is never the failover successor and never takes over", async () => {
    world.join("top", { role: "screen" });
    // Sorts first by frame id and pos, so it would lead the roster if it were eligible.
    const admin = world.join("0admin", {}, 0, false);
    world.join("b", { pos: 3 });
    await advance(5000);
    world.room("top").close();
    await advance(10_000);
    expect(world.hubs()).toEqual(["b"]);
    expect(frames(admin)).toEqual(["0admin", "b"]);

    world.room("b").close();
    await advance(30_000);
    expect(admin.isHub).toBe(false);
    expect(admin.status).toBe("connecting");
    expect(frames(admin)).toEqual(["0admin"]);
  });
});

describe("relay", () => {
  const collect = (room: Room, name: string) => {
    const got: { topic: string; data: unknown; from: string }[] = [];
    const ch = room.channel(name);
    for (const topic of ["x", "y"]) ch.on(topic, (data, from) => got.push({ topic, data, from }));
    return { ch, got };
  };

  it("relays to all, to one frame, and only within a channel name", async () => {
    world.join("top", { role: "screen" });
    startMany(["a", "b"]);
    const top = collect(world.room("top"), "app:t:g");
    const a = collect(world.room("a"), "app:t:g");
    const b = collect(world.room("b"), "app:t:g");
    const aOther = collect(world.room("a"), "other");
    const bOther = collect(world.room("b"), "other");
    await advance(5000);
    expect(world.hubs()).toEqual(["top"]);

    top.ch.send("x", { n: 1 });
    a.ch.send("y", [1, 2]);
    b.ch.send("x", "to a", "a");
    bOther.ch.send("y", "elsewhere");
    await advance(200);

    expect(top.got).toEqual([{ topic: "y", data: [1, 2], from: "a" }]);
    expect(a.got).toEqual([
      { topic: "x", data: { n: 1 }, from: "top" },
      { topic: "x", data: "to a", from: "b" },
    ]);
    expect(b.got).toEqual([
      { topic: "x", data: { n: 1 }, from: "top" },
      { topic: "y", data: [1, 2], from: "a" },
    ]);
    expect(aOther.got).toEqual([{ topic: "y", data: "elsewhere", from: "b" }]);
    expect(bOther.got).toEqual([]);
  });

  it("stops delivering after a channel closes", async () => {
    world.join("top", { role: "screen" });
    world.join("a");
    const a = collect(world.room("a"), "c");
    const top = world.room("top").channel("c");
    await advance(5000);
    top.send("x", 1);
    await advance(100);
    (a.ch as typeof a.ch & { close(): void }).close();
    await advance(100);
    top.send("x", 2);
    await advance(100);
    expect(a.got.map((m) => m.data)).toEqual([1]);
  });

  it("keeps at most eight open handles per channel name", async () => {
    world.join("top", { role: "screen" });
    const a = world.join("a");
    const got: number[] = [];
    for (let i = 0; i < 10; i++) a.channel("c").on("x", () => got.push(i));
    const top = world.room("top").channel("c");
    await advance(5000);
    top.send("x", null);
    await advance(100);
    expect(got).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("drops oversized messages and rate-limits a flooding frame", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    world.join("top", { role: "screen" });
    world.join("a");
    const top = collect(world.room("top"), "c");
    const a = world.room("a").channel("c");
    await advance(5000);
    a.send("x", "z".repeat(20_000));
    for (let i = 0; i < 500; i++) a.send("y", i);
    await advance(500);
    expect(top.got.some((m) => m.topic === "x")).toBe(false);
    expect(top.got.length).toBe(RELAY_BURST);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("subscribes a channel opened while the welcome is on its way", async () => {
    world.net.latency = (from, to) => (from === "top" && to === "a" ? 3000 : 5);
    const top = world.join("top", { role: "screen" });
    const a = world.join("a");
    // Wait until the hub has a's hello but a hasn't had the welcome yet.
    for (let i = 0; i < 200; i++) {
      if (frames(top).includes("a") && a.status !== "online") break;
      await advance(50);
    }
    expect(a.status).not.toBe("online");
    const got: unknown[] = [];
    a.channel("late").on("x", (d) => got.push(d));
    await advance(8000);
    expect(a.status).toBe("online");
    top.channel("late").send("x", 1);
    await advance(4000);
    expect(got).toEqual([1]);
  });

  it("drops sends while not online", () => {
    const room = world.join("solo");
    const ch = room.channel("c");
    expect(ch.online).toBe(false);
    expect(ch.peers().map((p) => p.frame)).toEqual(["solo"]);
    expect(ch.leader()).toBe("solo");
    expect(() => ch.send("x", 1)).not.toThrow();
  });
});

describe("channels and roster", () => {
  it("filters peers, picks the leader and reports changes", async () => {
    world.join("w1", { pos: 2 });
    world.join("w0", { pos: 1 });
    world.join("other", { app: "else", pos: 0 });
    const room = world.room("w1");
    const ch = room.channel("app:idle:g", (p) => p.app === "idle" && p.group === "g");
    const seen: string[][] = [];
    ch.onPeers((peers) => seen.push(peers.map((p) => p.frame)));
    await advance(5000);
    expect(ch.peers().map((p) => p.frame)).toEqual(["w0", "w1"]);
    expect(ch.leader()).toBe("w0");

    world.join("screen", { role: "screen", pos: 5 });
    await advance(3000);
    expect(ch.leader()).toBe("screen");
    expect(seen.at(-1)).toEqual(["screen", "w0", "w1"]);

    world.room("screen").close();
    world.room("w0").update({ group: "h" });
    await advance(8000);
    expect(ch.peers().map((p) => p.frame)).toEqual(["w1"]);
    expect(ch.leader()).toBe("w1");
  });

  it("tracks updates, status and duplicate frame ids", async () => {
    world.join("top", { role: "screen" });
    const a = world.join("a");
    const top = world.room("top");
    let rosterEvents = 0;
    top.onRoster(() => rosterEvents++);
    await advance(5000);

    a.update({ app: "hockey", group: "left" });
    a.setStatus({ fps: 60, note: "ok", bad: { nested: true } as unknown as string });
    await advance(2000);
    const entry = top.roster().find((e) => e.frame === "a");
    expect(entry?.app).toBe("hockey");
    expect(entry?.group).toBe("left");
    expect(entry?.status).toEqual({ fps: 60, note: "ok" });
    expect(entry?.rtt).toBeGreaterThanOrEqual(0);
    expect(a.roster().find((e) => e.frame === "a")?.status).toEqual({ fps: 60, note: "ok" });

    top.setStatus({ hub: true });
    await advance(500);
    expect(a.roster().find((e) => e.frame === "top")?.status).toEqual({ hub: true });

    // A second live frame claiming the id "a".
    const twin = world.join("a-twin");
    twin.update({ frame: "a" });
    await advance(5000);
    const dups = top.roster().filter((e) => e.frame === "a");
    expect(dups).toHaveLength(2);
    expect(dups.every((e) => e.duplicate)).toBe(true);
    expect(a.roster().filter((e) => e.duplicate)).toHaveLength(2);

    twin.close();
    await advance(500);
    const single = top.roster().filter((e) => e.frame === "a");
    expect(single).toHaveLength(1);
    expect(single[0]?.duplicate).toBeUndefined();
    expect(rosterEvents).toBeGreaterThan(3);
  });

  it("coalesces rapid status updates", async () => {
    world.join("top", { role: "screen" });
    const a = world.join("a");
    await advance(5000);
    for (let i = 0; i < 50; i++) a.setStatus({ n: i });
    await advance(100);
    expect(
      world
        .room("top")
        .roster()
        .find((e) => e.frame === "a")?.status,
    ).toEqual({ n: 0 });
    await advance(1500);
    expect(
      world
        .room("top")
        .roster()
        .find((e) => e.frame === "a")?.status,
    ).toEqual({ n: 49 });
  });
});

describe("clock", () => {
  it("estimates the hub's clock under asymmetric, jittery latency", async () => {
    const rng = createRng("jitter");
    // Uplink 40 ms, downlink 10 ms, and half the messages delayed up to 80 ms more.
    world.net.latency = (from, to) => {
      const base = from === "c" && to === "h" ? 40 : from === "h" && to === "c" ? 10 : 5;
      return base + (rng.next() < 0.5 ? rng.next() * 80 : 0);
    };
    const hub = world.join("h", { role: "screen" }, 5000);
    const client = world.join("c", {}, 0);
    let syncs = 0;
    client.clock.onSync(() => syncs++);
    expect(client.clock.synced).toBe(false);
    await advance(30_000);
    expect(hub.isHub).toBe(true);
    expect(client.clock.synced).toBe(true);
    expect(syncs).toBeGreaterThan(0);
    // NTP can't see asymmetry: the best possible estimate is off by half of it (15 ms).
    const diff = client.clock.now() - hub.clock.now();
    expect(Math.abs(diff)).toBeLessThanOrEqual(17);
    expect(Math.abs(diff)).toBeGreaterThanOrEqual(10);
  });

  it("never runs backwards while syncing", async () => {
    world.join("h", { role: "screen" }, -3000);
    const client = world.join("c", {}, 0);
    let last = client.clock.now();
    for (let i = 0; i < 200; i++) {
      await advance(50);
      const t = client.clock.now();
      expect(t).toBeGreaterThanOrEqual(last);
      last = t;
    }
    expect(client.clock.synced).toBe(true);
  });

  it("keeps the shared timeline across hub failover", async () => {
    const first = world.join("h", { role: "screen" }, 10_000);
    const a = world.join("a", {}, 0);
    const b = world.join("b", {}, 300);
    await advance(10_000);
    first.close();
    await advance(15_000);
    expect(a.status).toBe("online");
    // The new hub is a or b, each of which was synced to the old hub's clock.
    expect(Math.abs(a.clock.now() - b.clock.now())).toBeLessThan(15);
    expect(Math.abs(a.clock.now() - (Date.now() + 10_000))).toBeLessThan(15);
  });
});

describe("status", () => {
  it("goes offline without a broker, keeps retrying, and comes online", async () => {
    world.net.brokerUp = false;
    const room = world.join("a");
    const seen: string[] = [];
    room.onStatus((s) => seen.push(s));
    expect(room.status).toBe("connecting");
    await advance(3000);
    expect(room.status).toBe("offline");
    expect(frames(room)).toEqual(["a"]);
    world.net.brokerUp = true;
    await advance(60_000);
    expect(room.status).toBe("online");
    expect(room.isHub).toBe(true);
    room.close();
    expect(room.status).toBe("offline");
    expect(seen).toEqual(["offline", "online", "offline"]);
  });

  it("reports connecting while re-electing", async () => {
    world.join("top", { role: "screen" });
    const a = world.join("a");
    await advance(5000);
    const seen: string[] = [];
    a.onStatus((s) => seen.push(s));
    world.room("top").close();
    await advance(5000);
    expect(seen).toEqual(["connecting", "online"]);
    expect(a.isHub).toBe(true);
  });
});

describe("close", () => {
  it("releases ids, links and timers", async () => {
    startMany(["a", "b", "c"]);
    world.join("s", { role: "screen" });
    for (const r of world.rooms.values()) r.channel("c").on("x", () => {});
    await advance(5000);
    expect(world.net.links()).toBeGreaterThan(0);
    world.closeAll();
    await advance(6000);
    expect(world.net.held()).toEqual([]);
    expect(world.net.links()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stats count traffic and name candidate pairs", async () => {
    world.join("top", { role: "screen" });
    const a = world.join("a");
    await advance(5000);
    const stats = await a.stats();
    expect(stats.hub).toBe("top");
    expect(stats.connections).toBe(1);
    expect(stats.candidates).toEqual(["host/host"]);
    expect(stats.bytesIn).toBeGreaterThan(0);
    expect(stats.bytesOut).toBeGreaterThan(0);
    expect((await world.room("top").stats()).connections).toBe(1);
  });
});
