import { afterEach, describe, expect, it } from "vitest";
import { roomNamespace } from "../../src/core/net/ids";
import { localTransport } from "../../src/core/net/local";
import { createRoom } from "../../src/core/net/room";
import { failureOf, type Link, type Transport } from "../../src/core/net/transport";
import type { Room } from "../../src/core/types";
import { info } from "./helpers";

// Node's BroadcastChannel delivers between instances in one thread, which stands in for
// simulator iframes sharing a tab. These run on real timers.

const open: { close(): void }[] = [];
afterEach(() => {
  for (const o of open.splice(0)) o.close();
});

const transport = (ns: string): Transport => {
  const t = localTransport(ns);
  open.push(t);
  return t;
};

const until = async (check: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe("localTransport", () => {
  it("lets one frame claim an id and others link to it", async () => {
    const ns = `t${Math.random().toString(36).slice(2)}`;
    const a = transport(ns);
    const b = transport(ns);
    const hub = await a.open(`${ns}-hub0`);
    open.push(hub);
    await expect(b.open(`${ns}-hub0`)).rejects.toSatisfy((e) => failureOf(e) === "taken");

    const accepted: Link[] = [];
    hub.onLink((link) => accepted.push(link));
    const member = await b.open(`${ns}-m1`);
    open.push(member);
    const link = await member.connect(`${ns}-hub0`, 2000);
    await until(() => accepted.length === 1);
    const far = accepted[0]!;

    const got: string[] = [];
    far.onMessage((t) => got.push(`hub:${t}`));
    link.onMessage((t) => got.push(`member:${t}`));
    link.send("hello");
    far.send("welcome");
    await until(() => got.length === 2);
    expect(got.sort()).toEqual(["hub:hello", "member:welcome"]);

    let closed = false;
    far.onClose(() => {
      closed = true;
    });
    link.close();
    await until(() => closed);
    expect(far.send("late")).toBe(false);
  });

  it("gives a racing claim to exactly one frame", async () => {
    const ns = `t${Math.random().toString(36).slice(2)}`;
    const ts = [transport(ns), transport(ns), transport(ns)];
    const results = await Promise.allSettled(ts.map((t) => t.open(`${ns}-hub0`)));
    const won = results.filter((r) => r.status === "fulfilled");
    expect(won).toHaveLength(1);
    for (const r of won) open.push((r as PromiseFulfilledResult<{ close(): void }>).value);
  });

  it("knows at once when nobody holds an id, and waits a while without locks", async () => {
    const ns = `t${Math.random().toString(36).slice(2)}`;
    const ep = await transport(ns).open(`${ns}-m1`);
    open.push(ep);
    await expect(ep.connect(`${ns}-hub0`, 300)).rejects.toSatisfy(
      (e) => failureOf(e) === "unavailable",
    );
    const fallback = localTransport(ns, { locks: false });
    open.push(fallback);
    const slow = await fallback.open(`${ns}-m2`);
    open.push(slow);
    const started = Date.now();
    await expect(slow.connect(`${ns}-hub0`, 300)).rejects.toSatisfy(
      (e) => failureOf(e) === "unavailable",
    );
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
  });

  it("settles racing claims without locks, preferring the lower priority", async () => {
    const ns = `t${Math.random().toString(36).slice(2)}`;
    const ts = [0, 1, 2].map(() => {
      const t = localTransport(ns, { locks: false });
      open.push(t);
      return t;
    });
    const results = await Promise.allSettled([
      ts[0]!.open(`${ns}-hub0`, 1.5),
      ts[1]!.open(`${ns}-hub0`, 0.5),
      ts[2]!.open(`${ns}-hub0`, 1.2),
    ]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "fulfilled", "rejected"]);
    open.push((results[1] as PromiseFulfilledResult<{ close(): void }>).value);
    await expect(ts[2]!.open(`${ns}-hub0`, 0)).rejects.toSatisfy((e) => failureOf(e) === "taken");
  });
});

describe.each([
  ["locks", true],
  ["broadcast claims", false],
])("rooms over BroadcastChannel (%s)", (_label, locks) => {
  it("elects a hub, builds the roster and fails over", async () => {
    const token = `room-${Math.random().toString(36).slice(2)}`;
    const rooms = new Map<string, Room>();
    for (const [name, role] of [
      ["a", "station"],
      ["b", "station"],
      ["s", "screen"],
    ] as const) {
      const room = createRoom(
        { room: token, self: info(name, { role }), signalling: "public", transport: "local" },
        {
          transport: localTransport(roomNamespace(token), { locks }),
          timing: { memberDelay: [300, 600], followDelay: [300, 600] },
        },
      );
      rooms.set(name, room);
      open.push(room);
    }
    const all = [...rooms.values()];
    await until(() => all.every((r) => r.status === "online" && r.roster().length === 3));
    expect(all.filter((r) => r.isHub).map((r) => r.self)).toEqual(["s"]);

    rooms.get("s")!.close();
    const rest = [rooms.get("a")!, rooms.get("b")!];
    await until(() => rest.some((r) => r.isHub) && rest.every((r) => r.roster().length === 2));
    expect(rest.filter((r) => r.isHub)).toHaveLength(1);
    expect(rest.every((r) => r.status === "online")).toBe(true);
  }, 15_000);
});
