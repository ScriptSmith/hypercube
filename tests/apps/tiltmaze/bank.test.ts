import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { BANK_RB } from "../../../src/apps/tiltmaze/frame";
import {
  bankEdge,
  bankTubes,
  type Column,
  createGlass,
  Z_TUBE,
} from "../../../src/apps/tiltmaze/glass";
import { nominalLayout } from "../../../src/apps/tiltmaze/layout";
import {
  BEACON_GRACE_MS,
  createDownlink,
  createUplink,
  DROP_RATE,
} from "../../../src/apps/tiltmaze/link";
import {
  decodeBeacon,
  decodeDrop,
  decodeLevel,
  encodeBeacon,
  encodeDrop,
  encodeLevel,
  TOPIC,
} from "../../../src/apps/tiltmaze/wire";
import type { Channel, FrameInfo, FrameKind, PeerInfo, SetupInfo } from "../../../src/core/types";
import { DEFAULT_VENUE, displayFor, reachFor } from "../../../src/core/venue";

/** A frame of `kind` at its venue size, `scale` CSS px per venue px. */
const frameOf = (kind: FrameKind, scale = 0.25): FrameInfo => {
  const d = displayFor(kind, 2, DEFAULT_VENUE);
  const reach = reachFor(d);
  const w = d.width * scale;
  const h = d.height * scale;
  return {
    kind,
    ...(kind === "pair" ? { span: 2 } : {}),
    venueWidth: d.width,
    venueHeight: d.height,
    width: w,
    height: h,
    unit: scale,
    pixelRatio: 1,
    touch: kind !== "screen",
    reach,
    reachTop: { adult: h * (1 - reach.adult), child: h * (1 - reach.child) },
    seams: kind === "pair" ? [w / 2] : [],
  };
};

const setupOf = (over: Partial<SetupInfo>): SetupInfo => ({
  name: "bank",
  role: "station",
  pos: 0,
  count: 6,
  group: "main",
  side: 0,
  ...over,
});

describe("tiltmaze tubes across the bezel", () => {
  for (const [kind, count, span] of [
    ["panel", 6, 1],
    ["pair", 3, 2],
  ] as const) {
    for (const together of kind === "pair" ? [false, true] : [false]) {
      it(`meet at a ${kind} bank's top edge and the screen's bottom edge within a pixel${together ? " (together)" : ""}`, () => {
        const screenFrame = frameOf("screen", 0.2);
        const screenSetup = setupOf({ role: "screen", count });
        const screen = createGlass(screenFrame, screenSetup, { span });
        const columns: Column[] = Array.from({ length: count }, (_, pos) => ({
          pos,
          kind,
          boards: kind === "pair" && together ? 1 : kind === "pair" ? 2 : 1,
        }));
        const fromScreen = bankTubes(columns, count, span);
        const screenPx = screen.surface.width / screenFrame.width;
        const w0 = new Vector3();
        const w1 = new Vector3();
        let checked = 0;
        for (let pos = 0; pos < count; pos++) {
          const f = frameOf(kind, 0.4);
          const setup = setupOf({ pos, count });
          const glass = createGlass(f, setup);
          // Both see one eye.
          expect(glass.eye).toEqual(screen.eye);
          const layout = nominalLayout(kind, { together });
          layout.boards.forEach((slot, b) => {
            const own = glass.toGlass(slot.tube.x, slot.tube.y);
            const theirs = fromScreen.find((t) => t.pos === pos && t.board === b)!;
            expect(own.x).toBeCloseTo(theirs.x, 9);
            // The tube in venue space, through each frame's own window: the same place on the
            // wall, and the same width, at the frame's top edge and the screen's bottom edge.
            const r = BANK_RB * 1.28 * glass.scaleAt(Z_TUBE);
            const at = (g: typeof glass, y: number, dx: number, out: Vector3) => {
              g.world(own.x, y, Z_TUBE, out);
              out.x += dx;
              const st = g.view.toStage([out.x, out.y, out.z])!;
              return (
                g.surface.origin[0] +
                (st.x / (g === glass ? f.width : screenFrame.width)) * g.surface.width
              );
            };
            const top = glass.top;
            const bottom = screen.toGlass(0, screenFrame.height / screenFrame.unit).y;
            expect(top).toBeCloseTo(bankEdge(), 9);
            expect(bottom).toBeGreaterThan(top);
            const framePx = glass.surface.width / f.width;
            for (const dx of [-r, 0, r]) {
              const a = at(glass, top, dx, w0);
              const c = at(screen, bottom, dx, w1);
              expect(Math.abs(a - c)).toBeLessThan(Math.min(framePx, screenPx));
            }
            checked++;
          });
        }
        expect(checked).toBe(fromScreen.length);
      });
    }
  }

  it("keep a screen that guesses its bank's panels from its count in step", () => {
    const pairs = createGlass(frameOf("screen"), setupOf({ role: "screen", count: 3 }));
    const told = createGlass(frameOf("screen"), setupOf({ role: "screen", count: 3 }), { span: 2 });
    expect(pairs.eye).toEqual(told.eye);
    expect(pairs.surface.width).toBeCloseTo(told.surface.width, 9);
  });
});

describe("tiltmaze messages", () => {
  it("round-trip and drop malformed ones whole", () => {
    const drop = { b: 1, n: 2, c: 5, t: 1_700_000_000_123, v: 2610, h: 1 };
    expect(decodeDrop(JSON.parse(JSON.stringify(encodeDrop(drop))))).toEqual(drop);
    expect(decodeDrop(encodeDrop({ ...drop, v: 99_999, c: 12.4 }))).toEqual({
      ...drop,
      v: 20_000,
      c: 7,
    });
    for (const bad of [
      null,
      [],
      "x",
      { ...drop, b: 2 },
      { ...drop, b: -1 },
      { ...drop, n: 5 },
      { ...drop, c: 8 },
      { ...drop, c: 1.5 },
      { ...drop, t: Number.NaN },
      { ...drop, v: 50 },
      { ...drop, h: 2 },
      { b: 0, n: 1, c: 0, t: 1, v: 200 },
    ]) {
      expect(decodeDrop(bad)).toBeNull();
    }
    const beacon = { s: 1, j: 12, cap: 20, p: 2, e: 7 };
    expect(decodeBeacon(encodeBeacon(beacon))).toEqual(beacon);
    for (const bad of [
      { ...beacon, p: 4 },
      { ...beacon, j: -1 },
      { ...beacon, s: 2 },
      { ...beacon, e: "1" },
    ]) {
      expect(decodeBeacon(bad)).toBeNull();
    }
    expect(decodeLevel(encodeLevel({ s: 0, e: 3 }))).toEqual({ s: 0, e: 3 });
    expect(decodeLevel({ s: 0, e: -3 })).toBeNull();
  });
});

/** Channels that deliver to each other at once, as JSON would, with a shared roster. */
const fakeNet = () => {
  const peers: PeerInfo[] = [];
  const handlers = new Map<string, Map<string, Set<(data: unknown, from: string) => void>>>();
  const channel = (info: PeerInfo): Channel => {
    peers.push(info);
    handlers.set(info.frame, new Map());
    return {
      online: true,
      self: info.frame,
      peers: () => peers,
      leader: () => null,
      send(topic, data, to) {
        for (const [frame, topics] of handlers) {
          if (frame === info.frame || (to !== undefined && to !== frame)) continue;
          for (const cb of topics.get(topic) ?? [])
            cb(JSON.parse(JSON.stringify(data)), info.frame);
        }
      },
      on(topic, cb) {
        const topics = handlers.get(info.frame)!;
        let set = topics.get(topic);
        if (!set) topics.set(topic, (set = new Set()));
        set.add(cb);
        return () => set.delete(cb);
      },
      onPeers: () => () => {},
    };
  };
  return { channel, peers };
};

const peer = (frame: string, over: Partial<PeerInfo>): PeerInfo => ({
  frame,
  app: "tiltmaze",
  group: "g",
  kind: "panel",
  role: "station",
  pos: 0,
  side: 0,
  ...over,
});

describe("tiltmaze bank links", () => {
  it("follow the screen's beacons, send drops to it, and step up on each new level epoch", () => {
    const net = fakeNet();
    let t = 1000;
    const screenNet = net.channel(peer("scr", { kind: "screen", role: "screen" }));
    const frameNet = net.channel(peer("p3", { pos: 3 }));
    const epochs: number[] = [];
    const up = createUplink(
      frameNet,
      0,
      () => t,
      (e) => epochs.push(e),
    );
    const drops: { column: number; b: number }[] = [];
    const down = createDownlink(
      screenNet,
      { side: 0, count: () => 10, now: () => t },
      (m, column) => drops.push({ column, b: m.b }),
    );
    expect(up.screen()).toBeNull();
    expect(up.drop({ b: 0, n: 1, c: 1, t: 5, v: 2600, h: 0 })).toBe(false);
    down.tick({ j: 3, cap: 20, p: 0, e: 2 });
    expect(up.screen()).toBe("scr");
    expect(up.beacon()?.j).toBe(3);
    expect(up.drop({ b: 0, n: 1, c: 1, t: 5, v: 2600, h: 0 })).toBe(true);
    expect(drops).toEqual([{ column: 3, b: 0 }]);
    down.level(3);
    expect(epochs).toEqual([2, 3]);
    // Silence: the screen has gone.
    t += BEACON_GRACE_MS + 1;
    expect(up.screen()).toBeNull();
    up.dispose();
    down.dispose();
  });

  it("ignore beacons from a frame posing as a screen, and from the other side", () => {
    const net = fakeNet();
    const liar = net.channel(peer("p1", { pos: 1 }));
    const other = net.channel(peer("scrB", { kind: "screen", role: "screen", side: 1 }));
    const frameNet = net.channel(peer("p3", { pos: 3 }));
    const up = createUplink(
      frameNet,
      0,
      () => 0,
      () => {},
    );
    liar.send(TOPIC.beacon, encodeBeacon({ s: 0, j: 1, cap: 20, p: 0, e: 0 }));
    other.send(TOPIC.beacon, encodeBeacon({ s: 1, j: 1, cap: 20, p: 0, e: 0 }));
    expect(up.screen()).toBeNull();
  });

  it("take drops only from touch frames below, at a bounded rate", () => {
    const net = fakeNet();
    let t = 0;
    const screenNet = net.channel(peer("scr", { kind: "screen", role: "screen" }));
    const frameNet = net.channel(peer("p2", { pos: 2 }));
    const otherScreen = net.channel(peer("scr2", { kind: "screen", role: "screen" }));
    const farSide = net.channel(peer("q1", { pos: 1, side: 1 }));
    let got = 0;
    const down = createDownlink(screenNet, { side: 0, count: () => 10, now: () => t }, () => got++);
    const drop = encodeDrop({ b: 0, n: 1, c: 0, t: 1, v: 2600, h: 0 });
    for (let i = 0; i < 10; i++) frameNet.send(TOPIC.drop, drop, "scr");
    expect(got).toBe(DROP_RATE);
    t += 1001;
    frameNet.send(TOPIC.drop, drop, "scr");
    expect(got).toBe(DROP_RATE + 1);
    otherScreen.send(TOPIC.drop, drop, "scr");
    farSide.send(TOPIC.drop, drop, "scr");
    frameNet.send(TOPIC.drop, { ...drop, b: 3 }, "scr");
    expect(got).toBe(DROP_RATE + 1);
    down.dispose();
  });
});
