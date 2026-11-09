// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { computeFrame, inferKind, kindReach, spanOf, venueSize } from "../src/core/frame";
import { parseParams } from "../src/core/params";
import { sphereInfo, WHOLE_SPHERE } from "../src/core/sphere";
import type { Identity } from "../src/core/types";
import {
  activeVenue,
  DEFAULT_VENUE,
  displayFor,
  encodeVenue,
  mergeVenue,
  parseVenue,
  reachFor,
  setActiveVenue,
  venueFromParam,
} from "../src/core/venue";

afterEach(() => setActiveVenue(DEFAULT_VENUE));

describe("venue profile", () => {
  it("merges panels side by side", () => {
    const three = displayFor("pair", 3);
    expect(three.width).toBe(DEFAULT_VENUE.panel.width * 3);
    expect(three.height).toBe(DEFAULT_VENUE.panel.height);
    expect(three.widthM).toBeCloseTo(DEFAULT_VENUE.panel.widthM * 3 + DEFAULT_VENUE.bezelM * 2);
  });

  it("derives reach from mounting height", () => {
    const panel = reachFor(DEFAULT_VENUE.panel);
    expect(panel.adult).toBe(1);
    expect(panel.child).toBeGreaterThan(0.3);
    expect(panel.child).toBeLessThan(0.6);
    const wall = reachFor(DEFAULT_VENUE.wall);
    expect(wall.adult).toBeGreaterThan(0.33);
    expect(wall.adult).toBeLessThan(0.5);
    expect(reachFor(DEFAULT_VENUE.screen)).toEqual({ adult: 0, child: 0 });
  });

  it("puts the screen's pixels and metres in the same proportion", () => {
    const { screen, wall, panel } = DEFAULT_VENUE;
    expect(screen.width / screen.height).toBeCloseTo(screen.widthM / screen.heightM, 3);
    expect(wall.width / wall.height).toBeCloseTo(wall.widthM / wall.heightM, 3);
    expect(panel.width / panel.height).toBeCloseTo(panel.widthM / panel.heightM, 3);
  });
});

describe("the venue param", () => {
  it("reads any subset of the profile", () => {
    const { patch, ignored } = parseVenue(
      "panel:720x1280:0.5x0.9:1.1,bank:8,merge:3,bezel:0.005,screen:3840x2160," +
        "wall::16x6,kiosk:::1.2:0,sphere:2048x1024:3:2.5,cover:60:-90,view:-80:30,gallery:1",
    );
    expect(ignored).toEqual([]);
    expect(patch).toEqual({
      panel: { width: 720, height: 1280, widthM: 0.5, heightM: 0.9, bottomM: 1.1 },
      bankCount: 8,
      maxMerge: 3,
      bezelM: 0.005,
      screen: { width: 3840, height: 2160 },
      wall: { widthM: 16, heightM: 6 },
      kiosk: { bottomM: 1.2, touch: false },
      sphere: {
        width: 2048,
        height: 1024,
        diameterM: 3,
        bottomM: 2.5,
        coverTop: 60,
        coverBottom: -90,
        view: { top: 30, bottom: -80 },
        gallery: true,
      },
    });
  });

  it("ignores what it can't read and lists it, never half-applying an entry", () => {
    const { patch, ignored } = parseVenue(
      "wall:5760x2160:12xfoo,panel:1080,bank:many,nope:1,cover:10:10,view:1,gallery:yes," +
        "screen:1e4x900,kiosk:1x2x3,merge:2:3,panel:::,sphere:4096x2048:4:3:9,,bezel:0.01",
    );
    expect(patch).toEqual({ bezelM: 0.01 });
    expect(ignored).toEqual([
      "wall:5760x2160:12xfoo",
      "panel:1080",
      "bank:many",
      "nope:1",
      "cover:10:10",
      "view:1",
      "gallery:yes",
      "screen:1e4x900",
      "kiosk:1x2x3",
      "merge:2:3",
      "panel:::",
      "sphere:4096x2048:4:3:9",
    ]);
  });

  it("clamps numbers into sensible ranges", () => {
    const { patch } = parseVenue(
      "wall:99999x10:0.001x900:-3,bank:0,merge:40,bezel:5,sphere::0:999,view:120:-120",
    );
    expect(patch.wall).toEqual({
      width: 32768,
      height: 100,
      widthM: 0.05,
      heightM: 200,
      bottomM: 0,
    });
    expect(patch.bankCount).toBe(1);
    expect(patch.maxMerge).toBe(8);
    expect(patch.bezelM).toBe(1);
    expect(patch.sphere).toEqual({ diameterM: 0.05, bottomM: 200, view: { top: 90, bottom: -90 } });
    expect(parseVenue("bank:6.6").patch.bankCount).toBe(7);
  });

  it("takes nothing from empty, huge or hostile input", () => {
    expect(parseVenue(null)).toEqual({ patch: {}, ignored: [] });
    expect(parseVenue("")).toEqual({ patch: {}, ignored: [] });
    expect(parseVenue("__proto__:1,constructor:2").patch).toEqual({});
    const many = Array.from({ length: 40 }, () => "bank:3").join(",");
    const read = parseVenue(many);
    expect(read.patch).toEqual({ bankCount: 3 });
    expect(read.ignored).toHaveLength(8);
    expect(parseVenue(`bank:4,${"x".repeat(5000)}`).patch).toEqual({ bankCount: 4 });
    expect(({} as Record<string, unknown>).width).toBeUndefined();
  });

  it("merges over a base without touching it", () => {
    const merged = mergeVenue(DEFAULT_VENUE, parseVenue("wall:7680x2880,bank:8").patch);
    expect(merged.wall).toEqual({ ...DEFAULT_VENUE.wall, width: 7680, height: 2880 });
    expect(merged.bankCount).toBe(8);
    expect(merged.panel).toEqual(DEFAULT_VENUE.panel);
    expect(DEFAULT_VENUE.wall.width).not.toBe(7680);
    expect(mergeVenue(DEFAULT_VENUE, null)).toBe(DEFAULT_VENUE);
  });

  it("writes only what differs, and reads back what it writes", () => {
    expect(encodeVenue(DEFAULT_VENUE)).toBe("");
    const venue = venueFromParam("sphere::5,bank:8,kiosk:::1.2:0,view:40:-90,gallery:1");
    const text = encodeVenue(venue);
    const { sphere: s, kiosk: k } = DEFAULT_VENUE;
    expect(text).toBe(
      `bank:8,kiosk:${k.width}x${k.height}:${k.widthM}x${k.heightM}:1.2:0,` +
        `sphere:${s.width}x${s.height}:5:${s.bottomM},view:40:-90,gallery:1`,
    );
    expect(venueFromParam(text)).toEqual(venue);
    const full = encodeVenue(venue, null);
    expect(full.split(",").map((e) => e.split(":")[0])).toEqual([
      "panel",
      "bank",
      "merge",
      "bezel",
      "screen",
      "wall",
      "kiosk",
      "sphere",
      "cover",
      "view",
      "gallery",
    ]);
    expect(venueFromParam(full)).toEqual(venue);
  });

  it("comes through the URL as the `venue` param", () => {
    expect(parseParams("?app=diag").venue).toBeNull();
    expect(parseParams("?venue={venue}").venue).toBeNull();
    expect(parseParams("?venue=bank%3A4%2Cwall%3A7680x2880").venue).toEqual({
      bankCount: 4,
      wall: { width: 7680, height: 2880 },
    });
  });
});

describe("the page's venue", () => {
  const identity: Identity = { frame: "f", source: "params", mode: "show", siblings: [] };

  it("sizes frames, reach and spheres from the profile set at boot", () => {
    expect(activeVenue()).toBe(DEFAULT_VENUE);
    setActiveVenue(venueFromParam("wall:7680x2880:16x6:0.1,sphere:2048x1024:3:2,gallery:1"));
    expect(venueSize("wall")).toEqual({ width: 7680, height: 2880 });
    expect(kindReach("wall").adult).toBeCloseTo(2.1 / 6);
    const params = parseParams("?kind=wall");
    const wall = computeFrame("wall", { width: 1920, height: 720 }, params);
    expect([wall.venueWidth, wall.venueHeight]).toEqual([7680, 2880]);
    expect(wall.reach.adult).toBeCloseTo(2.1 / 6);
    const ball = computeFrame("sphere", { width: 1024, height: 512 }, parseParams("?kind=sphere"));
    expect(ball.sphere).toMatchObject({ radius: 1.5, centreY: 3.5, gallery: true });
    expect(sphereInfo().gallery).toBe(true);
    expect(WHOLE_SPHERE.gallery).toBeUndefined();
  });

  it("takes a sphere's view band from the profile unless the frame's URL gives one", () => {
    setActiveVenue(venueFromParam("view:30:-90"));
    expect(sphereInfo().view.top).toBeCloseTo((30 * Math.PI) / 180);
    expect(sphereInfo(undefined, { view: { top: 10, bottom: -90 } }).view.top).toBeCloseTo(
      (10 * Math.PI) / 180,
    );
  });

  it("knows a frame's kind and span from the profile's exact sizes", () => {
    setActiveVenue(venueFromParam("wall:3840x2160,kiosk:1280x800,panel:768x1366,merge:3"));
    const kindOf = (w: number, h: number) =>
      inferKind(
        parseParams(`?w=${w}&h=${h}`),
        { ...identity, hostRole: "TOUCHSCREEN" },
        {
          width: 10,
          height: 10,
        },
      );
    expect(kindOf(3840, 2160)).toBe("wall");
    expect(kindOf(1280, 800)).toBe("kiosk");
    expect(kindOf(768, 1366)).toBe("panel");
    expect(kindOf(2304, 1366)).toBe("pair");
    expect(spanOf(parseParams("?w=2304&h=1366"), identity, "pair")).toBe(3);
    // Sizes the profile doesn't know fall back to the frame's shape.
    expect(kindOf(1920, 1080)).toBe("kiosk");
    expect(kindOf(5000, 1000)).toBe("wall");
  });
});
