import { describe, expect, it } from "vitest";
import { decodeFeed, FeedError, MAX_ENTITIES } from "../../../src/apps/transit/pbf";
import { buildFeed, pb } from "./helpers";

const bus = {
  id: "VU-1",
  trip: "123-ABC",
  route: "199-5146",
  lat: -27.47,
  lon: 153.02,
  timestamp: 1_792_675_000,
  label: "a name",
};

describe("realtime feed reader", () => {
  it("reads the header time and each vehicle's fields", () => {
    const feed = decodeFeed(
      buildFeed(1_792_675_020, [
        bus,
        { ...bus, id: "VU-2", direction: 1, bearing: 90, speed: 8.5 },
      ]),
    );
    expect(feed.timestamp).toBe(1_792_675_020);
    expect(feed.vehicles).toHaveLength(2);
    const [a, b] = feed.vehicles;
    expect(a).toMatchObject({
      id: "VU-1",
      tripId: "123-ABC",
      routeId: "199-5146",
      direction: -1,
      bearing: -1,
      speed: -1,
      timestamp: 1_792_675_000,
    });
    expect(a!.lat).toBeCloseTo(-27.47, 5);
    expect(a!.lon).toBeCloseTo(153.02, 4);
    expect(b).toMatchObject({ id: "VU-2", direction: 1, bearing: 90, speed: 8.5 });
  });

  it("skips fields it doesn't know, of every wire type, at every level", () => {
    const unknown = [pb.varint(99, 7), pb.double(98, 1.5), pb.string(97, "x"), pb.float(96, 2)];
    const entity = pb.message(
      2,
      ...unknown,
      pb.string(1, "VU-9"),
      pb.message(
        4,
        ...unknown,
        pb.message(1, ...unknown, pb.string(5, "60-1"), pb.string(2, "08:00:00")),
        pb.message(2, ...unknown, pb.float(1, -27.5), pb.float(2, 153), pb.double(4, 1234.5)),
        pb.varint(3, 12),
        pb.varint(4, 2),
        pb.string(7, "stop"),
      ),
      pb.message(3, pb.string(1, "a trip update")),
    );
    const feed = decodeFeed(
      pb.concat([pb.message(1, ...unknown, pb.varint(3, 5)), entity, ...unknown]),
    );
    expect(feed.timestamp).toBe(5);
    expect(feed.vehicles).toHaveLength(1);
    expect(feed.vehicles[0]).toMatchObject({ id: "VU-9", routeId: "60-1" });
  });

  it("throws on truncated input wherever it is cut", () => {
    const whole = buildFeed(1, [bus, bus]);
    let threw = 0;
    for (let cut = 1; cut < whole.length; cut++) {
      try {
        decodeFeed(whole.subarray(0, cut));
      } catch (err) {
        expect(err).toBeInstanceOf(FeedError);
        threw++;
      }
    }
    // A cut exactly between two top-level fields is a shorter valid feed; anything else throws.
    expect(threw).toBeGreaterThan(whole.length - 4);
  });

  it("rejects groups and field number zero", () => {
    expect(() => decodeFeed(Uint8Array.from([0x0b, 0x0c]))).toThrow(FeedError);
    expect(() => decodeFeed(Uint8Array.from([0x00, 0x01]))).toThrow(FeedError);
  });

  it("leaves out deleted entities and vehicles without a usable position", () => {
    const noPos = pb.message(
      2,
      pb.string(1, "x"),
      pb.message(4, pb.message(1, pb.string(5, "1-1"))),
    );
    const deleted = pb.message(
      2,
      pb.string(1, "d"),
      pb.varint(2, 1),
      pb.message(4, pb.message(2, pb.float(1, -27), pb.float(2, 153))),
    );
    const nan = pb.message(
      2,
      pb.string(1, "n"),
      pb.message(4, pb.message(2, pb.float(1, Number.NaN), pb.float(2, 153))),
    );
    const feed = decodeFeed(pb.concat([noPos, deleted, nan]));
    expect(feed.vehicles).toHaveLength(0);
  });

  it("ignores bearings and speeds out of range", () => {
    const feed = decodeFeed(buildFeed(1, [{ ...bus, bearing: 400, speed: -3 }]));
    expect(feed.vehicles[0]).toMatchObject({ bearing: -1, speed: -1 });
  });

  it("stops collecting vehicles past MAX_ENTITIES", () => {
    const one = pb.message(
      2,
      pb.string(1, "v"),
      pb.message(4, pb.message(2, pb.float(1, 1), pb.float(2, 1))),
    );
    const many = pb.concat(Array.from({ length: MAX_ENTITIES + 5 }, () => one));
    expect(decodeFeed(many).vehicles).toHaveLength(MAX_ENTITIES);
  });

  it("reads 64-bit timestamps past 2^32 exactly", () => {
    const feed = decodeFeed(buildFeed(2 ** 40 + 3, []));
    expect(feed.timestamp).toBe(2 ** 40 + 3);
  });
});
