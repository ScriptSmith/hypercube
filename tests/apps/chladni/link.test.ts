import { describe, expect, it } from "vitest";
import { REMOTE_TTL_MS } from "../../../src/apps/chladni/drive";
import { createDownlink, createUplink } from "../../../src/apps/chladni/link";
import { KNOB_GRACE_MS, KNOB_TTL_MS } from "../../../src/apps/chladni/knobs";
import {
  decodeGlide,
  decodeKnob,
  decodeNote,
  decodePlate,
  encodePlate,
  GLIDE_HZ,
  HEARTBEAT_MS,
  type PlateMsg,
  TOPIC_GLIDE,
  TOPIC_KNOB,
  TOPIC_NOTE,
  TOPIC_PLATE,
} from "../../../src/apps/chladni/wire";

const KNOBS = { stretch: 0.25, damping: 0.5, at: { u: -0.2, v: 0.6 }, wide: true };
const PLATE: PlateMsg = { m: [], f: -1, a: true, s: 0, d: 200, p: [-200, 600], w: true };
import type { Channel, PeerInfo } from "../../../src/core/types";

/** A room in miniature: channels on one bus see each other's peers and messages at once. */
const createBus = () => {
  const members = new Map<
    string,
    {
      info: PeerInfo;
      handlers: Map<string, Set<(d: unknown, f: string) => void>>;
      peerCbs: Set<(p: readonly PeerInfo[]) => void>;
    }
  >();
  const log: { topic: string; from: string; to?: string; data: unknown }[] = [];
  const peers = () => [...members.values()].map((m) => m.info);
  const announce = () => {
    for (const m of members.values()) for (const cb of m.peerCbs) cb(peers());
  };
  return {
    log,
    join(partial: Partial<PeerInfo> & { frame: string }): Channel & { leave(): void } {
      const info: PeerInfo = {
        app: "chladni",
        group: "g",
        kind: "panel",
        role: "station",
        pos: 0,
        side: 0,
        ...partial,
      };
      const handlers = new Map<string, Set<(d: unknown, f: string) => void>>();
      const peerCbs = new Set<(p: readonly PeerInfo[]) => void>();
      members.set(info.frame, { info, handlers, peerCbs });
      announce();
      return {
        online: true,
        self: info.frame,
        peers,
        leader: () => null,
        send(topic, data, to) {
          log.push({ topic, from: info.frame, to, data });
          for (const [frame, m] of members) {
            if (frame === info.frame || (to !== undefined && to !== frame)) continue;
            for (const cb of m.handlers.get(topic) ?? []) cb(structuredClone(data), info.frame);
          }
        },
        on(topic, cb) {
          let set = handlers.get(topic);
          if (!set) handlers.set(topic, (set = new Set()));
          set.add(cb);
          return () => set.delete(cb);
        },
        onPeers(cb) {
          peerCbs.add(cb);
          return () => peerCbs.delete(cb);
        },
        leave() {
          members.delete(info.frame);
          announce();
        },
      };
    },
  };
};

describe("messages", () => {
  it("decode what they should and refuse everything else", () => {
    expect(decodeNote({ k: 3, m: 2, on: true, t: 5, a: false })).toEqual({
      k: 3,
      m: 2,
      on: true,
      t: 5,
      a: false,
    });
    for (const bad of [
      null,
      1,
      [],
      { k: -1, m: 2, on: true, t: 5, a: false },
      { k: 3, m: 99, on: true, t: 5, a: false },
      { k: 3, m: 2, on: 1, t: 5, a: false },
      { k: 3, m: 2, on: true, t: Number.NaN, a: false },
      { k: 3, m: 2, on: true, t: 5 },
    ]) {
      expect(decodeNote(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(decodeGlide({ g: 1, f: 2.5, on: false, t: 9, a: true })).toEqual({
      g: 1,
      f: 2.5,
      on: false,
      t: 9,
      a: true,
    });
    for (const bad of [
      { g: 1, f: 0, on: true, t: 1, a: false },
      { g: 1, f: 1e6, on: true, t: 1, a: false },
      { g: 99, f: 2, on: true, t: 1, a: false },
    ]) {
      expect(decodeGlide(bad)).toBeNull();
    }
    const plate = { m: [[3, 100, -20]], f: -1, a: false, s: 500, d: 0, p: [10, -990], w: false };
    expect(decodePlate(plate)).toEqual(plate);
    for (const bad of [
      { ...plate, m: [[3, 100]] },
      { ...plate, m: Array(9).fill([1, 1, 0]) },
      { ...plate, f: -2 },
      { ...plate, m: [[3, 900, 0]] },
      { ...plate, s: 1001 },
      { ...plate, d: -1 },
      { ...plate, p: [0, 2000] },
      { ...plate, p: [0] },
      { ...plate, w: 1 },
      { m: [], f: -1, a: false },
    ]) {
      expect(decodePlate(bad)).toBeNull();
    }
    const knob = { c: 2, x: -0.2, y: 0.6, on: true, s: 90, t: 100, a: false };
    expect(decodeKnob(knob)).toEqual(knob);
    for (const bad of [
      { ...knob, c: 3 },
      { ...knob, x: 1.5 },
      { ...knob, y: Number.NaN },
      { ...knob, on: 1 },
      { ...knob, s: 5000 },
      { ...knob, a: "no" },
    ]) {
      expect(decodeKnob(bad)).toBeNull();
    }
  });

  it("report the plate briefly, with its phase and its knobs", () => {
    const re = [0, 0.5, 1.2, 0, 0.004];
    const im = [0, -0.25, 0, 0, 0];
    const msg = encodePlate(re, im, [2, 1, 4], 3.14159, true, KNOBS);
    expect(msg).toEqual({
      m: [
        [2, 120, 0],
        [1, 50, -25],
      ],
      f: 3.142,
      a: true,
      s: 250,
      d: 500,
      p: [-200, 600],
      w: true,
    });
    expect(decodePlate(msg)).toEqual(msg);
    const ones = Array.from({ length: 20 }, () => 1);
    expect(
      JSON.stringify(
        encodePlate(
          ones,
          ones,
          Array.from({ length: 20 }, (_, i) => i),
          null,
          false,
          KNOBS,
        ),
      ).length,
    ).toBeLessThan(260);
  });
});

describe("a touch frame telling its screen", () => {
  it("sends a note at once, repeats it as a heartbeat and switches it off", () => {
    const bus = createBus();
    const screen = bus.join({ frame: "s", role: "screen", kind: "screen" });
    const panel = bus.join({ frame: "p", pos: 1 });
    const got: unknown[] = [];
    screen.on(TOPIC_NOTE, (d) => got.push(d));
    const up = createUplink(panel, 0, () => {});
    expect(up.screen()).toBe("s");
    up.tick(0, 100, [{ key: 3, mode: 3 }], [], false);
    expect(got).toEqual([{ k: 3, m: 3, on: true, t: 100, a: false }]);
    up.tick(HEARTBEAT_MS - 10, 100, [{ key: 3, mode: 3 }], [], false);
    expect(got).toHaveLength(1);
    up.tick(HEARTBEAT_MS, 600, [{ key: 3, mode: 3 }], [], false);
    expect(got).toHaveLength(2);
    up.tick(HEARTBEAT_MS + 20, 620, [], [], false);
    expect(got[2]).toEqual({ k: 3, m: 3, on: false, t: 620, a: false });
    up.tick(5000, 5000, [], [], false);
    expect(got).toHaveLength(3);
  });

  it("sends a held glide at most 15 times a second, and nothing without a screen", () => {
    const bus = createBus();
    const panel = bus.join({ frame: "p" });
    const up = createUplink(panel, 0, () => {});
    expect(up.tick(0, 0, [{ key: 0, mode: 0 }], [{ strip: 0, freq: 2 }], false)).toBe(0);
    const screen = bus.join({ frame: "s", role: "screen", kind: "screen" });
    const got: unknown[] = [];
    screen.on(TOPIC_GLIDE, (d) => got.push(d));
    for (let t = 0; t < 1000; t += 1000 / 60)
      up.tick(t, t, [], [{ strip: 2, freq: 2 + t / 1000 }], false);
    expect(got.length).toBeLessThanOrEqual(GLIDE_HZ + 1);
    expect(got.length).toBeGreaterThan(GLIDE_HZ - 3);
  });

  it("only listens to the screen on its own side", () => {
    const bus = createBus();
    const panel = bus.join({ frame: "p", side: 1 });
    const mine = bus.join({ frame: "s1", role: "screen", kind: "screen", side: 1 });
    const other = bus.join({ frame: "s0", role: "screen", kind: "screen", side: 0 });
    const plates: string[] = [];
    const up = createUplink(panel, 1, (_m, from) => plates.push(from));
    expect(up.screen()).toBe("s1");
    other.send(TOPIC_PLATE, PLATE);
    mine.send(TOPIC_PLATE, PLATE);
    expect(plates).toEqual(["s1"]);
  });
});

describe("a touch frame turning a knob", () => {
  it("sends moves at most 15 times a second, a heartbeat while held and the release once", () => {
    const bus = createBus();
    const screen = bus.join({ frame: "s", role: "screen", kind: "screen" });
    const panel = bus.join({ frame: "p" });
    const got: { c: number; x: number; on: boolean; s: number }[] = [];
    screen.on(TOPIC_KNOB, (d) => got.push(d as never));
    const up = createUplink(panel, 0, () => {});
    for (let t = 0; t < 1000; t += 1000 / 60) {
      up.knob(0, t / 1000, 0, true, 0);
      up.tick(t, t, [], [], false);
    }
    expect(got.length).toBeLessThanOrEqual(GLIDE_HZ + 1);
    expect(got.length).toBeGreaterThan(GLIDE_HZ - 3);
    expect(got.every((m) => m.c === 0 && m.on && m.s === 0)).toBe(true);
    // Held still: only the heartbeat.
    got.length = 0;
    for (let t = 1000; t < 3000; t += 1000 / 60) up.tick(t, t, [], [], false);
    expect(got.length).toBeGreaterThanOrEqual(3);
    expect(got.length).toBeLessThanOrEqual(5);
    // Let go: one message, then quiet.
    got.length = 0;
    up.knob(0, 0.9, 0, false, 0);
    for (let t = 3000; t < 5000; t += 1000 / 60) up.tick(t, t, [], [], false);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ c: 0, x: 0.9, on: false });
  });
});

describe("the screen hearing its touch frames", () => {
  const setup = () => {
    const bus = createBus();
    const screen = bus.join({ frame: "s", role: "screen", kind: "screen" });
    let t = 0;
    let visitors = 0;
    let sprinkles = 0;
    const down = createDownlink(screen, {
      side: 0,
      modeCount: 16,
      now: () => t,
      clock: () => t,
      every: 500,
      onVisitor: () => visitors++,
      onSprinkle: () => sprinkles++,
    });
    return {
      bus,
      screen,
      down,
      at: (v: number) => (t = v),
      visitors: () => visitors,
      sprinkles: () => sprinkles,
    };
  };

  it("drops a drive that stops arriving after 1.5 s, so a vanished panel never leaves it ringing", () => {
    const s = setup();
    const panel = s.bus.join({ frame: "p" });
    const up = createUplink(panel, 0, () => {});
    up.tick(0, 0, [{ key: 2, mode: 2 }], [], false);
    expect(s.down.remote.size(0)).toBe(1);
    expect(s.visitors()).toBe(1);
    expect(s.down.notes).toBe(1);
    s.at(REMOTE_TTL_MS - 1);
    expect(s.down.remote.size(REMOTE_TTL_MS - 1)).toBe(1);
    expect(s.down.remote.size(REMOTE_TTL_MS + 1)).toBe(0);
  });

  it("drops a frame's drives as soon as it leaves the roster", () => {
    const s = setup();
    const panel = s.bus.join({ frame: "p" });
    createUplink(panel, 0, () => {}).tick(
      0,
      0,
      [{ key: 1, mode: 1 }],
      [{ strip: 0, freq: 3 }],
      true,
    );
    expect(s.down.remote.size(0)).toBe(2);
    expect(s.visitors()).toBe(0);
    panel.leave();
    expect(s.down.remote.size(0)).toBe(0);
  });

  it("ignores frames that are not below it, stale messages and unknown modes", () => {
    const s = setup();
    const stranger = s.bus.join({ frame: "x", role: "screen", kind: "screen" });
    stranger.send(TOPIC_NOTE, { k: 0, m: 0, on: true, t: 0, a: false }, "s");
    const panel = s.bus.join({ frame: "p" });
    panel.send(TOPIC_NOTE, { k: 0, m: 0, on: true, t: 60_000, a: false }, "s");
    panel.send(TOPIC_NOTE, { k: 0, m: 40, on: true, t: 0, a: false }, "s");
    expect(s.down.remote.size(0)).toBe(0);
  });

  it("reports its plate twice a second and sprinkles at most every eight seconds on request", () => {
    const s = setup();
    const panel = s.bus.join({ frame: "p" });
    const got: PlateMsg[] = [];
    createUplink(panel, 0, (m) => got.push(m));
    const msg = (): PlateMsg => ({ ...PLATE, m: [[1, 80, 0]], a: false });
    for (let t = 0; t <= 2000; t += 100) s.down.report(t, msg);
    expect(got).toHaveLength(5);
    const up = createUplink(panel, 0, () => {});
    up.sprinkle();
    s.at(3000);
    up.sprinkle();
    s.at(9000);
    up.sprinkle();
    expect(s.sprinkles()).toBe(2);
  });
});

describe("the screen's knobs along a bank", () => {
  const setup = () => {
    const bus = createBus();
    const screen = bus.join({ frame: "s", role: "screen", kind: "screen" });
    let t = 0;
    const down = createDownlink(screen, {
      side: 0,
      modeCount: 16,
      now: () => t,
      clock: () => t,
      every: 500,
      onVisitor: () => {},
      onSprinkle: () => {},
    });
    const panel = (frame: string) => {
      const ch = bus.join({ frame });
      return {
        ch,
        knob: (c: number, x: number, on: boolean, since: number, auto = false) =>
          ch.send(TOPIC_KNOB, { c, x, y: 0, on, s: since, t, a: auto }, "s"),
      };
    };
    return { down, panel, at: (v: number) => (t = v) };
  };

  it("follows the panel touched last while it is held and a few seconds after", () => {
    const s = setup();
    const a = s.panel("a");
    const b = s.panel("b");
    a.knob(0, 0.2, true, 0);
    expect(s.down.knobs.winner("stretch", 0)?.x).toBe(0.2);
    s.at(100);
    b.knob(0, 0.8, true, 100);
    expect(s.down.knobs.winner("stretch", 100)?.x).toBe(0.8);
    // A keeps sending its older hold; B still wins.
    s.at(400);
    a.knob(0, 0.3, true, 0);
    expect(s.down.knobs.winner("stretch", 400)?.from).toBe("b");
    // B lets go and keeps its say for the grace period, then A's hold takes over.
    s.at(500);
    b.knob(0, 0.85, false, 100);
    s.at(1000);
    a.knob(0, 0.3, true, 0);
    expect(s.down.knobs.winner("stretch", 1000)?.x).toBe(0.85);
    s.at(500 + KNOB_GRACE_MS + 10);
    a.knob(0, 0.3, true, 0);
    expect(s.down.knobs.winner("stretch", 500 + KNOB_GRACE_MS + 10)?.from).toBe("a");
    // Each knob has its own owner.
    expect(s.down.knobs.winner("damping", 4000)).toBeNull();
  });

  it("lets a vanished panel's hold run out, and drops a panel that leaves at once", () => {
    const s = setup();
    const a = s.panel("a");
    a.knob(2, 0.4, true, 0);
    expect(s.down.knobs.winner("at", KNOB_TTL_MS - 10)).not.toBeNull();
    expect(s.down.knobs.winner("at", KNOB_TTL_MS + KNOB_GRACE_MS + 10)).toBeNull();
    s.at(10_000);
    const b = s.panel("b");
    b.knob(2, -0.4, true, 10_000);
    expect(s.down.knobs.busy(10_000)).toBe(true);
    b.ch.leave();
    expect(s.down.knobs.busy(10_000)).toBe(false);
  });

  it("puts a person ahead of a bot", () => {
    const s = setup();
    const person = s.panel("a");
    const bot = s.panel("b");
    person.knob(1, 0.1, true, 0);
    s.at(50);
    bot.knob(1, 0.9, true, 50, true);
    expect(s.down.knobs.winner("damping", 50)?.x).toBe(0.1);
  });
});
