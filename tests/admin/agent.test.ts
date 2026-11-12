import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startAdmin } from "../../src/core/admin";
import type { FrameState } from "../../src/core/admin/agent";
import { cleanConfig, mergeConfig, OVERRIDE_KEY, readOverride } from "../../src/core/admin/config";
import type { AdminDeps } from "../../src/core/admin/deps";
import { createLink } from "../../src/core/admin/link";
import { LOG_REPLY, type LogReply, readLogReply } from "../../src/core/admin/logwire";
import {
  canonical,
  importAdminKey,
  MAX_ENVELOPE_BYTES,
  newNonce,
  signEnvelope,
  verifySignature,
} from "../../src/core/admin/sign";
import type { Target } from "../../src/core/admin/target";
import { generateAdminKey } from "../../src/core/adminkey";
import { createLogBuffer } from "../../src/core/logs";
import { createWorld, type World } from "../net/helpers";
import {
  AK,
  memoryStorage,
  settle,
  startConsole,
  startFrame,
  type TestConsole,
  type TestFrame,
  TOKEN,
  useNetClock,
} from "./helpers";

let world: World;

beforeEach(() => {
  useNetClock();
  world = createWorld(TOKEN);
});

afterEach(() => {
  world.closeAll();
  vi.clearAllTimers();
  vi.useRealTimers();
});

const send = async (c: TestConsole, target: Target, cmd: string, args?: unknown) => {
  const env = await c.link.send(target, cmd, args);
  if (!env) throw new Error("not sent");
  await settle(500);
  return env;
};

const answersTo = (c: TestConsole, id: string) =>
  c.states
    .filter((s) => s.state.ref === id)
    .map((s) => s.from)
    .sort();

const boot = async (names: string[], zones: Record<string, string> = {}) => {
  const frames = names.map((n) => startFrame(world, n, { zone: zones[n] }));
  const c = startConsole(world);
  await settle(6000, 60);
  for (const f of frames) expect(f.room.status).toBe("online");
  expect(c.room.status).toBe("online");
  return { frames, c };
};

const byName = (frames: TestFrame[]) => Object.fromEntries(frames.map((f) => [f.name, f]));

describe("commands", () => {
  it("run only on the frames they target, which answer with their state", async () => {
    const { frames, c } = await boot(["a", "b", "c"]);
    const { a, b, c: fc } = byName(frames);
    const env = await send(c, { k: "frames", ids: ["a", "c"] }, "identify", { ms: 5000 });
    expect(a?.calls.identify).toEqual([5000]);
    expect(fc?.calls.identify).toEqual([5000]);
    expect(b?.calls.identify).toEqual([]);
    expect(answersTo(c, env.id)).toEqual(["a", "c"]);
    const answer = c.states.find((s) => s.from === "a" && s.state.ref === env.id)?.state;
    expect(answer).toMatchObject({ cmd: "identify", ok: true, name: "Frame a", app: "idle" });
  });

  it("match groups, zones, sides and apps", async () => {
    const { frames, c } = await boot(["a", "b"], { a: "A", b: "B" });
    const { a, b } = byName(frames);
    await send(c, { k: "frames", ids: ["b"] }, "set", { config: { group: "bank", side: 1 } });
    expect(b?.override()).toEqual({ group: "bank", side: 1 });

    await send(c, { k: "group", group: "bank" }, "identify", { ms: 1000 });
    await send(c, { k: "zone", zone: "A" }, "identify", { ms: 2000 });
    await send(c, { k: "side", side: 1, group: "bank" }, "identify", { ms: 3000 });
    await send(c, { k: "app", app: "idle" }, "identify", { ms: 4000 });
    await send(c, { k: "all" }, "identify", { ms: 5000 });
    expect(a?.calls.identify).toEqual([2000, 4000, 5000]);
    expect(b?.calls.identify).toEqual([1000, 3000, 4000, 5000]);
  });

  it("cover notice, reset, reload, app commands, ping and unknown names", async () => {
    const { frames, c } = await boot(["a"]);
    const a = frames[0] as TestFrame;
    const all: Target = { k: "all" };
    await send(c, all, "notice", { text: "  Back in a few minutes  ", ms: 30_000 });
    await send(c, all, "notice", { text: "x".repeat(121) });
    await send(c, all, "reset");
    await send(c, all, "app", { name: "round", args: { n: 2 } });
    const ping = await send(c, all, "ping");
    const odd = await send(c, all, "explode");
    await send(c, all, "reload");
    expect(a.calls.notices).toEqual([["Back in a few minutes", 30_000]]);
    expect(a.calls.resets).toBe(1);
    expect(a.appCommands).toEqual([["round", { n: 2 }]]);
    expect(a.calls.reloads).toBe(1);
    expect(answersTo(c, ping.id)).toEqual(["a"]);
    expect(c.states.find((s) => s.state.ref === odd.id)?.state).toMatchObject({
      ok: false,
      error: "unknown command explode",
    });
    expect(c.states.some((s) => s.state.cmd === "notice" && s.state.ok === false)).toBe(true);
  });

  it("reach the sender's own frame too", async () => {
    const { frames } = await boot(["a", "b"]);
    const { a, b } = byName(frames);
    await a?.link.send({ k: "all" }, "identify", { ms: 1500 });
    await settle(500);
    expect(a?.calls.identify).toEqual([1500]);
    expect(b?.calls.identify).toEqual([1500]);
  });
});

describe("overrides", () => {
  it("last the session by default, come back after a reload and are removed by clear", async () => {
    const { frames, c } = await boot(["a", "b"]);
    const a = frames[0] as TestFrame;
    const env = await send(c, { k: "frames", ids: ["a"] }, "set", {
      config: { app: "diag", variant: "fast", options: { speed: 2 } },
    });
    expect(a.override()).toEqual({ app: "diag", variant: "fast", options: { speed: 2 } });
    expect(a.applied).toHaveLength(1);
    expect(readOverride(a.storage, OVERRIDE_KEY(TOKEN, "a"))?.app).toBe("diag");
    expect(c.states.find((s) => s.state.ref === env.id)?.state.keep).toBe("session");

    // The same config again changes nothing, so the app isn't remounted.
    await send(c, { k: "frames", ids: ["a"] }, "set", {
      config: { app: "diag", variant: "fast", options: { speed: 2 } },
    });
    expect(a.applied).toHaveLength(1);

    // A reload in the same session reads the same storage.
    a.close();
    const again = startFrame(world, "a", { storage: a.storage });
    expect(again.override()?.app).toBe("diag");
    await settle(6000, 60);

    await send(c, { k: "frames", ids: ["a"] }, "clear");
    expect(again.override()).toBeNull();
    expect(again.applied).toEqual([null]);
    expect(again.storage.data.has(OVERRIDE_KEY(TOKEN, "a"))).toBe(false);
  });

  it("kept until the next reload are never saved, and replace a saved one", async () => {
    const { frames, c } = await boot(["a"]);
    const a = frames[0] as TestFrame;
    const to: Target = { k: "frames", ids: ["a"] };
    await send(c, to, "set", { config: { app: "diag" } });
    expect(a.storage.data.has(OVERRIDE_KEY(TOKEN, "a"))).toBe(true);
    const env = await send(c, to, "set", {
      config: { variant: "fast" },
      merge: true,
      keep: "once",
    });
    expect(a.override()).toEqual({ app: "diag", variant: "fast" });
    expect(c.states.find((s) => s.state.ref === env.id)?.state.keep).toBe("once");
    expect(a.storage.data.has(OVERRIDE_KEY(TOKEN, "a"))).toBe(false);

    a.close();
    const again = startFrame(world, "a", { storage: a.storage });
    expect(again.override()).toBeNull();
    await settle(6000, 60);
    expect(again.override()).toBeNull();
    expect(again.applied).toEqual([]);
  });

  it("don't come back from the hub when a frame loads in a new session", async () => {
    startFrame(world, "top", { info: { role: "screen", kind: "screen" } });
    const { frames, c } = await boot(["a"]);
    const a = frames[0] as TestFrame;
    await send(c, { k: "frames", ids: ["a"] }, "set", { config: { app: "diag" } });
    a.close();
    await settle(2000, 20);
    const fresh = startFrame(world, "a", { storage: memoryStorage() });
    await settle(8000, 80);
    expect(fresh.override()).toBeNull();
    expect(fresh.applied).toEqual([]);
  });

  it("ignore an older hub sending back an override it remembered, without answering", async () => {
    const { frames, c } = await boot(["a"]);
    const a = frames[0] as TestFrame;
    const env = await send(c, { k: "frames", ids: ["a"] }, "set", {
      config: { app: "diag" },
      at: Date.now(),
      restore: true,
    });
    expect(a.override()).toBeNull();
    expect(a.applied).toEqual([]);
    expect(answersTo(c, env.id)).toEqual([]);
  });

  it("merge onto the current override when asked", async () => {
    const { frames, c } = await boot(["a"]);
    const a = frames[0] as TestFrame;
    const to: Target = { k: "frames", ids: ["a"] };
    await send(c, to, "set", { config: { group: "bank", pos: 2 }, merge: true });
    await send(c, to, "set", { config: { app: "diag", variant: "fast" }, merge: true });
    expect(a.override()).toEqual({ group: "bank", pos: 2, app: "diag", variant: "fast" });
    await send(c, to, "set", { config: { app: "idle" } });
    expect(a.override()).toEqual({ app: "idle" });
  });

  it("keep a long set of app ids but cap the options' total size", async () => {
    const { frames, c } = await boot(["a"]);
    const a = frames[0] as TestFrame;
    const pool = Array.from({ length: 30 }, (_, i) => `app-number-${i}`).join(",");
    await send(c, { k: "frames", ids: ["a"] }, "set", {
      config: {
        app: "medley",
        options: { pool, huge: "x".repeat(5000), one: "y".repeat(800), two: "z".repeat(800) },
      },
    });
    expect(Object.keys(a.override()?.options ?? {})).toEqual(["pool", "one"]);
    expect(a.override()?.options?.pool).toBe(pool);
  });

  it("drop invalid fields and refuse configs that aren't objects", async () => {
    const { frames, c } = await boot(["a"]);
    const a = frames[0] as TestFrame;
    const to: Target = { k: "frames", ids: ["a"] };
    await send(c, to, "set", { config: { app: "bad app!", pos: 99, side: 1, role: "boss" } });
    expect(a.override()).toEqual({ side: 1 });
    const env = await send(c, to, "set", { config: "diag" });
    expect(c.states.find((s) => s.state.ref === env.id)?.state).toMatchObject({ ok: false });
  });

  it("mergeConfig drops the old app's variant and options", () => {
    expect(
      mergeConfig({ app: "a", variant: "v", options: { x: 1 }, group: "g" }, { app: "b" }),
    ).toEqual({ app: "b", group: "g" });
    expect(mergeConfig({ app: "a", variant: "v" }, { pos: 3 })).toEqual({
      app: "a",
      variant: "v",
      pos: 3,
    });
    expect(mergeConfig(null, { app: "a" })).toEqual({ app: "a" });
  });

  it("keeps options for launched apps across an app change, one app at a time", () => {
    const base = {
      app: "a",
      options: { x: 1 },
      launch: { glass: { hour: 9 }, tape: { on: true } },
    };
    expect(mergeConfig(base, { app: "b" })).toEqual({ app: "b", launch: base.launch });
    expect(mergeConfig(base, { launch: { glass: { message: "Bye" } } })).toEqual({
      ...base,
      launch: { glass: { message: "Bye" }, tape: { on: true } },
    });
    expect(mergeConfig({ app: "a" }, { launch: { glass: { hour: 1 } } })).toEqual({
      app: "a",
      launch: { glass: { hour: 1 } },
    });
  });

  it("cleanConfig checks options for launched apps", () => {
    const launch: Record<string, unknown> = {
      glass: { hour: 9, message: "Bye", bad: { nested: true }, "no dots.": 1 },
      "Bad App": { hour: 1 },
      __proto__x: { hour: 1 },
      tape: "nope",
    };
    expect(cleanConfig({ launch })).toEqual({ launch: { glass: { hour: 9, message: "Bye" } } });
    expect(cleanConfig({ launch: {} })).toEqual({});
    expect(cleanConfig(JSON.parse('{"launch":{"__proto__":{"hour":1}}}'))).toEqual({});
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`app${i}`, { n: i }]));
    expect(Object.keys(cleanConfig({ launch: many })?.launch ?? {})).toHaveLength(8);
    const big = Object.fromEntries(
      Array.from({ length: 8 }, (_, i) => [`app${i}`, { text: "x".repeat(700) }]),
    );
    expect(JSON.stringify(cleanConfig({ launch: big })?.launch).length).toBeLessThan(2100);
  });
});

describe("security", () => {
  it("ignores unsigned, wrongly signed, stale and replayed commands", async () => {
    const { frames, c } = await boot(["a"]);
    const a = frames[0] as TestFrame;
    const rogue = world.join("rogue");
    await settle(4000, 40);
    const raw = rogue.channel("admin");
    raw.send("env", {
      v: 1,
      id: newNonce(),
      ts: Date.now(),
      from: "rogue",
      target: { k: "all" },
      cmd: "reload",
    });
    raw.send("env", { cmd: "reload" });
    const wrongKey = createLink(rogue, importAdminKey(generateAdminKey()));
    await wrongKey.send({ k: "all" }, "reload");
    await settle(500);

    // Signed with the right key but from a minute ago.
    const k = await importAdminKey(AK);
    if (!k) throw new Error("key");
    const old = await signEnvelope(k, {
      v: 1,
      id: newNonce(),
      ts: c.room.clock.now() - 60_000,
      from: c.room.self,
      target: { k: "all" },
      cmd: "reload",
    });
    const consoleChannel = c.room.channel("admin");
    consoleChannel.send("env", old);

    // A good command, then the same envelope again.
    const good = await send(c, { k: "all" }, "identify", { ms: 1000 });
    consoleChannel.send("env", good);
    await settle(500);

    expect(a.calls.reloads).toBe(0);
    expect(a.calls.identify).toEqual([1000]);
    expect(a.link.rejected.signature).toBe(1);
    expect(a.link.rejected.malformed).toBe(2);
    expect(a.link.rejected.stale).toBe(1);
    expect(a.link.rejected.replay).toBe(1);
  });

  it("doesn't run a command again when it is replayed at a reloaded frame", async () => {
    const session = memoryStorage();
    const a = startFrame(world, "a", { session });
    const c = startConsole(world);
    await settle(6000, 60);
    const env = await send(c, { k: "all" }, "reload");
    await settle(100);
    expect(a.calls.reloads).toBe(1);
    a.close();
    await settle(1000, 10);

    // The page comes back with the same sessionStorage; someone replays the captured command.
    const again = startFrame(world, "a", { session, storage: a.storage });
    await settle(6000, 60);
    c.room.channel("admin").send("env", env);
    await settle(500);
    expect(again.calls.reloads).toBe(0);
    expect(again.link.rejected.replay).toBe(1);
  });

  it("ignores commands sent before the page loaded, once its clock has synced", async () => {
    const a = startFrame(world, "a");
    const c = startConsole(world);
    await settle(6000, 60);
    const env = await send(c, { k: "all" }, "identify", { ms: 1000 });
    expect(a.calls.identify).toEqual([1000]);
    a.close();
    await settle(1000, 10);
    // No session storage this time, but the page knows when it loaded.
    const again = startFrame(world, "a", { age: 3000 });
    await settle(6000, 60);
    expect(again.room.clock.synced).toBe(true);
    c.room.channel("admin").send("env", env);
    await settle(500);
    expect(again.calls.identify).toEqual([]);
    expect(again.agent.early).toBe(1);
    // Fresh commands still work.
    await send(c, { k: "all" }, "identify", { ms: 2000 });
    expect(again.calls.identify).toEqual([2000]);
  });

  it("does nothing on a frame without an admin key", () => {
    const room = world.join("a");
    const spy = vi.spyOn(room, "channel");
    const deps = { room, roomToken: TOKEN, ak: null } as unknown as AdminDeps;
    const handle = startAdmin(deps);
    expect(spy).not.toHaveBeenCalled();
    handle.dispose();
  });
});

/** Thirteen options shaped like an operator-written poll, every text at its longest. */
const customPoll = () => {
  // Quotes and backslashes double in JSON, so they are the worst case for the envelope.
  const text = (n: number) => `\u{1F43E}"\\ ${"Which pet is best? ".repeat(10)}`.slice(0, n);
  return {
    app: "ballpit",
    variant: "one",
    options: {
      question: "custom",
      set: "animals",
      ask: text(100),
      answers: 4,
      a1: text(24),
      a2: text(24),
      a3: text(24),
      a4: text(24),
      p1: "cat",
      p2: "dog",
      p3: "fish",
      p4: "bird",
      yesterday: true,
    },
  };
};

describe("operator text", () => {
  it("fits a custom poll in one envelope and in the frame's answer", async () => {
    const { frames, c } = await boot(["a"]);
    const a = frames[0] as TestFrame;
    const config = customPoll();
    const env = await send(c, { k: "frames", ids: ["a"] }, "set", { config, merge: true });
    expect(canonical(env).length).toBeLessThan(MAX_ENVELOPE_BYTES / 4);
    expect(a.override()).toEqual(config);
    expect(c.states.find((s) => s.state.ref === env.id)?.state.override).toEqual(config);
  });

  it("keeps a frame's whole state inside one envelope even at the options' size cap", async () => {
    const options: Record<string, string> = {};
    // Control characters cost six bytes each in JSON, quotes two.
    for (let i = 0; i < 32; i++) options[`k${i}`] = '\u0001"'.repeat(30);
    const config = cleanConfig({
      app: "x".repeat(64),
      variant: "v".repeat(64),
      options,
      launch: { glass: options, tape: options },
    });
    const kept = JSON.stringify(config?.options ?? {}).length;
    expect(kept).toBeGreaterThan(1700);
    expect(kept).toBeLessThan(2100);
    const launched = JSON.stringify(config?.launch ?? {}).length;
    expect(launched).toBeGreaterThan(1700);
    expect(launched).toBeLessThan(2100);
    const state: FrameState = {
      ref: "r".repeat(64),
      cmd: "set",
      ok: false,
      error: '"'.repeat(120),
      name: '"'.repeat(64),
      setup: "versus",
      role: "station",
      group: '"'.repeat(64),
      side: 1,
      pos: 63,
      count: 64,
      app: '"'.repeat(64),
      variant: '"'.repeat(64),
      override: config,
      keep: "session",
    };
    const key = await importAdminKey(AK);
    if (!key) throw new Error("no key");
    const signed = await signEnvelope(key, {
      v: 1,
      id: newNonce(),
      ts: Date.now(),
      from: "f".repeat(128),
      target: { k: "all" },
      cmd: "state",
      args: state,
    });
    expect(canonical(signed).length).toBeLessThan(MAX_ENVELOPE_BYTES);
    expect(await verifySignature(key, signed)).toBe(true);
  });
});

describe("logs", () => {
  const collect = (link: TestConsole["link"] | TestFrame["link"]) => {
    const replies: { from: string; reply: LogReply }[] = [];
    link.on((env) => {
      if (env.cmd !== LOG_REPLY) return;
      const reply = readLogReply(env.args);
      if (reply) replies.push({ from: env.from, reply });
    });
    return (ref: string) => replies.filter((r) => r.reply.ref === ref);
  };

  it("are sent in signed parts to the asker alone, honouring levels and since", async () => {
    const logs = createLogBuffer();
    for (let i = 1; i <= 300; i++) {
      logs.add(i % 50 === 0 ? "error" : "log", [`entry ${i} ${"x".repeat(200)}`]);
    }
    startFrame(world, "a", { logs });
    const b = startFrame(world, "b");
    const c = startConsole(world);
    await settle(6000, 60);
    const repliesTo = collect(c.link);
    const seenByB: string[] = [];
    b.link.on((env) => seenByB.push(env.cmd));

    const env = await send(c, { k: "frames", ids: ["a"] }, "logs", { limit: 300 });
    await settle(1000);
    const parts = repliesTo(env.id);
    expect(parts.length).toBeGreaterThan(5);
    expect(parts.every((p) => p.from === "a" && p.reply.parts === parts.length)).toBe(true);
    expect(parts.map((p) => p.reply.part)).toEqual(parts.map((_, i) => i));
    const seqs = parts.flatMap((p) => p.reply.entries.map((e) => e.s));
    expect(seqs).toEqual(Array.from({ length: 300 }, (_, i) => i + 1));
    expect(parts[0]?.reply).toMatchObject({ boot: logs.boot, size: 300, errors: 6 });
    // Answered by the replies themselves: no state broadcast, and other frames see nothing.
    expect(c.states.some((s) => s.state.ref === env.id)).toBe(false);
    expect(seenByB).not.toContain(LOG_REPLY);
    expect(c.link.rejected.signature + c.link.rejected.overflow).toBe(0);

    const later = await send(c, { k: "frames", ids: ["a"] }, "logs", {
      levels: ["error"],
      since: { a: { b: logs.boot, s: 200 } },
    });
    await settle(500);
    const filtered = repliesTo(later.id).flatMap((p) => p.reply.entries);
    expect(filtered.map((e) => [e.s, e.l])).toEqual([
      [250, "error"],
      [300, "error"],
    ]);
  });

  it("come back as one empty part from a quiet frame, and a frame can ask itself", async () => {
    const logs = createLogBuffer();
    const { frames, c } = await boot(["a", "b"]);
    const b = frames[1] as TestFrame;
    const repliesTo = collect(c.link);
    const env = await send(c, { k: "frames", ids: ["b"] }, "logs");
    expect(repliesTo(env.id).map((p) => [p.from, p.reply.parts, p.reply.entries.length])).toEqual([
      ["b", 1, 0],
    ]);

    const own = startFrame(world, "self", { logs });
    logs.add("warn", ["low battery"]);
    await settle(6000, 60);
    const ownReplies = collect(own.link);
    const asked = await own.link.send({ k: "frames", ids: ["self"] }, "logs");
    await settle(500);
    expect(ownReplies(asked?.id ?? "").flatMap((p) => p.reply.entries.map((e) => e.m))).toEqual([
      "low battery",
    ]);
    // Its own reply must not be mistaken for a command it doesn't know.
    expect(c.states.some((s) => s.from === "self" && s.state.ok === false)).toBe(false);
    expect(b.calls.identify).toEqual([]);
  });
});
