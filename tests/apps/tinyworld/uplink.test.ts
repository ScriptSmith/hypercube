import { describe, expect, it } from "vitest";
import { E } from "../../../src/apps/tinyworld/elements";
import {
  createInbox,
  createLanding,
  createUplink,
  MAX_BATCH,
  MIN_INTERVAL_MS,
  packOutlet,
  TOPIC_UP,
  unpackBatch,
} from "../../../src/apps/tinyworld/uplink";
import type { Channel, PeerInfo } from "../../../src/core/types";

const capture = (width: number, rows: number, cells: [number, number, number][]) => {
  const ids = new Uint8Array(width * rows * 4);
  for (const [x, r, id] of cells) ids[(r * width + x) * 4] = id;
  return ids;
};

describe("tinyworld bank link", () => {
  it("maps a cell leaving the top of a frame to the matching place across the screen", () => {
    // Third frame of five, middle of its width: 50 % across the bank.
    const packed = packOutlet(capture(100, 2, [[50, 0, E.SAND]]), 100, 2, 2, 5);
    const [a] = unpackBatch({ c: packed })!;
    expect(a!.element).toBe(E.SAND);
    expect(a!.f).toBeCloseTo(0.505, 2);
  });

  it("sends only flowing media and caps the batch", () => {
    const cells: [number, number, number][] = [];
    for (let x = 0; x < 400; x++) cells.push([x, x % 3, x % 2 ? E.WATER : E.STONE]);
    const packed = packOutlet(capture(400, 3, cells), 400, 3, 0, 1);
    expect(packed.length).toBeLessThanOrEqual(MAX_BATCH);
    for (const a of unpackBatch({ c: packed })!) expect(a.element).toBe(E.WATER);
  });

  it("rejects anything that isn't a batch", () => {
    for (const junk of [
      null,
      5,
      "x",
      { c: "no" },
      { c: [1.5] },
      { c: [-1] },
      { c: [1e9] },
      { c: Array(MAX_BATCH + 1).fill(3) },
    ]) {
      expect(unpackBatch(junk)).toBeNull();
    }
    // Unknown or solid elements in an otherwise good batch are skipped.
    expect(unpackBatch({ c: [10 * 32 + E.STONE, 10 * 32 + 31] })).toEqual([]);
  });

  it("sends to the screen at most a few times a second, and not at all alone", () => {
    const sent: unknown[] = [];
    let peers: PeerInfo[] = [];
    const net = {
      online: true,
      self: "a",
      peers: () => peers,
      leader: () => null,
      send: (topic: string, data: unknown, to?: string) => sent.push({ topic, data, to }),
      on: () => () => {},
      onPeers: () => () => {},
    } satisfies Channel;
    const up = createUplink(net, 0, 2);
    const ids = capture(10, 1, [[3, 0, E.WATER]]);
    expect(up.connected).toBe(false);
    expect(up.send(ids, 10, 1, 0)).toBe(false);
    peers = [
      { frame: "screen-1", app: "tinyworld", group: "g", kind: "screen", role: "screen", pos: 0 },
    ];
    expect(up.connected).toBe(true);
    expect(up.send(ids, 10, 1, 1000)).toBe(true);
    expect(up.send(ids, 10, 1, 1000 + MIN_INTERVAL_MS / 2)).toBe(false);
    expect(up.send(ids, 10, 1, 1000 + MIN_INTERVAL_MS)).toBe(true);
    expect(sent[0]).toMatchObject({ topic: TOPIC_UP, to: "screen-1" });
  });

  it("queues arrivals on the screen in a bounded inbox and lands them through a few jets", () => {
    const inbox = createInbox(100);
    inbox.push(Array.from({ length: 250 }, (_, i) => ({ f: (i % 50) / 50, element: E.SAND })));
    expect(inbox.size).toBe(100);
    const landing = createLanding(1000, 8);
    const emitted: number[] = [];
    landing.land(inbox.take(80), 0, (_x, _el, n) => emitted.push(n));
    expect(emitted.reduce((a, b) => a + b, 0)).toBe(80);
    expect(landing.jets.length).toBeLessThanOrEqual(8);
    landing.expire(10_000);
    expect(landing.jets).toHaveLength(0);
  });
});
