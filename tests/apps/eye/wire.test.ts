import { describe, expect, it } from "vitest";
import {
  createInbox,
  createWatch,
  sendBeacon,
  sendEye,
  STALE_MS,
} from "../../../src/apps/eye/link";
import { defaultState } from "../../../src/apps/eye/model";
import {
  decodeBeacon,
  decodeEye,
  encodeEye,
  sameEye,
  stateOf,
  TOPIC,
} from "../../../src/apps/eye/wire";
import type { Channel, PeerInfo } from "../../../src/core/types";

const peer = (frame: string, pos: number, screen = false): PeerInfo => ({
  frame,
  app: "eye",
  group: "main",
  kind: screen ? "screen" : "panel",
  role: screen ? "screen" : "station",
  pos,
  side: 0,
});

/** Channels on an in-memory bus: messages arrive at once, copied as JSON. */
const bus = () => {
  const peers: PeerInfo[] = [];
  const handlers = new Map<string, Map<string, Set<(d: unknown, from: string) => void>>>();
  return {
    peers,
    channel(info: PeerInfo): Channel {
      peers.push(info);
      const mine = new Map<string, Set<(d: unknown, from: string) => void>>();
      handlers.set(info.frame, mine);
      return {
        online: true,
        self: info.frame,
        peers: () => peers,
        leader: () => null,
        send(topic, data, to) {
          const copy = JSON.parse(JSON.stringify(data)) as unknown;
          for (const [frame, hs] of handlers) {
            if (frame === info.frame || (to && frame !== to)) continue;
            for (const h of hs.get(topic) ?? []) h(copy, info.frame);
          }
        },
        on(topic, cb) {
          let set = mine.get(topic);
          if (!set) mine.set(topic, (set = new Set()));
          set.add(cb);
          return () => set.delete(cb);
        },
        onPeers: () => () => {},
      };
    },
  };
};

describe("eye messages", () => {
  it("round-trip an eye state to within its quantisation", () => {
    for (const c of ["myopia", "astigmatism", "cvd", "keratoconus"] as const) {
      const s = {
        ...defaultState(c),
        correction: c === "keratoconus" ? ("hardLens" as const) : ("none" as const),
      };
      const m = decodeEye(JSON.parse(JSON.stringify(encodeEye(s, 3, 1))));
      expect(m).not.toBeNull();
      const back = stateOf(m!);
      expect(back.condition).toBe(s.condition);
      expect(back.length).toBeCloseTo(s.length, 2);
      expect(back.radius).toBeCloseTo(s.radius, 2);
      expect(back.light).toBeCloseTo(s.light, 2);
      expect(back.correction).toBe(s.correction);
      expect(back.looking).toBe(s.looking);
      expect(sameEye(m!, encodeEye(back, 3, 0))).toBe(true);
    }
  });

  it("clamp what they send", () => {
    const m = encodeEye({ ...defaultState("typical"), length: 99, age: -4, light: 7 }, 900, 9);
    expect(m.L).toBe(2700);
    expect(m.a).toBe(5);
    expect(m.l).toBe(100);
    expect(m.p).toBe(63);
    expect(m.f).toBe(3);
  });

  it("drop anything malformed", () => {
    const good = encodeEye(defaultState("glaucoma"), 2, 0);
    expect(decodeEye(good)).toEqual(good);
    const bad: unknown[] = [
      null,
      42,
      "eye",
      [good],
      { ...good, c: 11 },
      { ...good, c: -1 },
      { ...good, L: 2700.5 },
      { ...good, L: 3000 },
      { ...good, r: "780" },
      { ...good, x: 6 },
      { ...good, t: 2 },
      { ...good, s: 101 },
      (() => {
        const { a: _a, ...rest } = good;
        return rest;
      })(),
    ];
    for (const b of bad) expect(decodeEye(b), JSON.stringify(b)).toBeNull();
    expect(decodeBeacon({ s: 1 })).toEqual({ s: 1 });
    expect(decodeBeacon({ s: 2 })).toBeNull();
    expect(decodeBeacon("x")).toBeNull();
  });
});

describe("the bank's link", () => {
  it("lets a frame hear its screen and the screen hear the frame", () => {
    const b = bus();
    let t = 0;
    const now = () => t;
    const screen = b.channel(peer("s", 0, true));
    const panel = b.channel(peer("p3", 3));
    const watch = createWatch(panel, 0, now);
    const inbox = createInbox(screen, { side: 0, frame: "s" }, now);
    expect(watch.screen()).toBeNull();
    sendBeacon(screen, 0);
    expect(watch.screen()).toBe("s");
    const m = encodeEye(defaultState("cataract"), 3, 1);
    expect(sendEye(panel, "s", m)).toBe(true);
    expect(inbox.get("p3")?.msg).toEqual(m);
    expect(inbox.get("p3")?.pos).toBe(3);
    // The screen goes quiet: after the grace period the frame stops sending.
    t = 3500;
    expect(watch.screen()).toBeNull();
    t = 3500 + STALE_MS + 1;
    expect(inbox.fresh()).toEqual([]);
    watch.dispose();
    inbox.dispose();
  });

  it("ignores eyes from frames that aren't touch frames on its side, and beacons from non-screens", () => {
    const b = bus();
    const now = () => 0;
    const screen = b.channel(peer("s", 0, true));
    const other = b.channel({ ...peer("q", 1), side: 1 });
    const fake = b.channel(peer("f", 2));
    const inbox = createInbox(screen, { side: 0, frame: "s" }, now);
    const watch = createWatch(other, 1, now);
    other.send(TOPIC.eye, encodeEye(defaultState("myopia"), 1, 0), "s");
    expect(inbox.get("q")).toBeUndefined();
    fake.send(TOPIC.beacon, { s: 1 });
    expect(watch.screen()).toBeNull();
  });
});
