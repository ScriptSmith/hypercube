import { afterEach, describe, expect, it } from "vitest";
import { coerceOptions, parseParams } from "../../src/core/params";
import {
  DEFAULT_VENUE,
  displayFor,
  mergeVenue,
  reachFor,
  setActiveVenue,
  venueFromParam,
} from "../../src/core/venue";
import { COUNT_MAX, defaultReach, spanRange } from "../../src/pages/landing/config";
import { buildUrls, simUrl } from "../../src/pages/landing/urls";
import { config, PLAY, pickerApp, puckGame, sparkVisual } from "./fixtures";

const inputs = { playBase: PLAY, ak: null };
const search = (url: string) => url.slice(url.indexOf("?"));

describe("venue profile", () => {
  it("sizes a bank from the venue's row of panels", () => {
    expect(config(sparkVisual, { setup: "bank" }).count).toBe(DEFAULT_VENUE.bankCount);
    const pairs = config(sparkVisual, { setup: "bank", kind: "pair" });
    expect(pairs.count).toBe(Math.floor(DEFAULT_VENUE.bankCount / pairs.span));
  });

  it("allows 1 to 20 touch frames per bank or side", () => {
    expect(COUNT_MAX).toBe(20);
    const big = config(sparkVisual, { setup: "bank", identity: "manual", count: 99 });
    expect(big.count).toBe(20);
    expect(buildUrls(big, sparkVisual, inputs).filter((e) => e.role === "station")).toHaveLength(
      20,
    );
    expect(config(sparkVisual, { setup: "bank", count: 0 }).count).toBe(1);
  });

  it("writes span on merged frames, kept within what the venue can merge", () => {
    const max = spanRange().max;
    expect(max).toBe(Math.max(2, DEFAULT_VENUE.maxMerge));
    const cfg = config(sparkVisual, { setup: "bank", kind: "pair", span: 99 });
    expect(cfg.span).toBe(max);
    const [station] = buildUrls(cfg, sparkVisual, inputs);
    expect(station?.url).toContain(`&kind=pair&span=${max}&`);
    expect(parseParams(search(station?.url ?? "")).span).toBe(max);
    const panels = buildUrls(config(sparkVisual, { setup: "bank" }), sparkVisual, inputs);
    expect(panels.every((e) => !e.url.includes("span="))).toBe(true);
  });

  it("takes default reach from the display's mounting", () => {
    const wall = config(sparkVisual, { setup: "solo", kind: "wall" });
    expect(wall.reach).toEqual(reachFor(displayFor("wall")));
    const pair = config(sparkVisual, { setup: "bank", kind: "pair" });
    expect(pair.reach).toEqual(reachFor(displayFor("pair", pair.span)));
  });

  it("passes the bank size and span to the simulator", () => {
    const cfg = config(sparkVisual, { setup: "bank", kind: "pair", count: 3 });
    const url = simUrl(cfg, sparkVisual, "https://example.org/sim/");
    expect(url).toBe(`https://example.org/sim/?preset=bank&count=3&span=${cfg.span}&app=sparks`);
    const corner = config(sparkVisual, { setup: "corner", count: 7 });
    expect(simUrl(corner, sparkVisual, "https://example.org/sim/")).toContain(
      "?preset=corner&count=7&span=1&app=sparks",
    );
  });
});

describe("the operator's venue profile", () => {
  afterEach(() => setActiveVenue(DEFAULT_VENUE));

  const VENUE = "bank:4,merge:3,wall:7680x2880:16x6:0.1";

  it("goes into every frame URL readably, and frames read it back", () => {
    const cfg = config(sparkVisual, { setup: "bank" });
    const entries = buildUrls(cfg, sparkVisual, { ...inputs, venue: VENUE });
    expect(entries).toHaveLength(2);
    for (const e of entries) {
      expect(e.url).toContain(`&venue=${VENUE}&room=`);
      const p = parseParams(search(e.url));
      expect(mergeVenue(DEFAULT_VENUE, p.venue)).toEqual(venueFromParam(VENUE));
    }
    expect(buildUrls(cfg, sparkVisual, inputs)[0]?.url).not.toContain("venue=");
  });

  it("goes into the simulator link", () => {
    const cfg = config(sparkVisual, { setup: "bank", kind: "pair", count: 2 });
    expect(simUrl(cfg, sparkVisual, "https://example.org/sim/", null, VENUE)).toBe(
      `https://example.org/sim/?preset=bank&venue=${VENUE}&count=2&span=2&app=sparks`,
    );
  });

  it("sets the bank, merges and reach the panel starts from", () => {
    setActiveVenue(venueFromParam(VENUE));
    expect(config(sparkVisual, { setup: "bank" }).count).toBe(4);
    expect(config(sparkVisual, { setup: "bank", kind: "pair" }).count).toBe(2);
    expect(spanRange()).toEqual({ min: 2, max: 3 });
    expect(config(sparkVisual, { setup: "bank", kind: "pair", span: 9 }).span).toBe(3);
    const wall = defaultReach("wall", 1);
    expect(wall.adult).toBeCloseTo((2.2 - 0.1) / 6);
    expect(displayFor("wall")).toMatchObject({ width: 7680, height: 2880, widthM: 16 });
  });
});

describe("apps option", () => {
  it("starts empty, meaning every suitable app", () => {
    const cfg = config(pickerApp);
    expect(cfg.options.apps).toBe("");
    const [entry] = buildUrls(cfg, pickerApp, inputs);
    expect(entry?.url).toContain("&o.apps=&");
  });

  it("writes ids and variant presets as a comma list that the runtime reads back", () => {
    const raw = "pucks,pucks:paddles,sparks,pucks,Bad Id,x:,a:b:c,x";
    const cfg = config(pickerApp, { options: { apps: raw } });
    expect(cfg.options.apps).toBe("pucks,pucks:paddles,sparks,x");
    const [entry] = buildUrls(cfg, pickerApp, inputs);
    expect(entry?.url).toContain("&o.apps=pucks,pucks:paddles,sparks,x&");
    const p = parseParams(search(entry?.url ?? ""));
    expect(coerceOptions(p.options, pickerApp.options)).toEqual({
      apps: "pucks,pucks:paddles,sparks,x",
    });
  });

  it("does not disturb apps without it", () => {
    expect(buildUrls(config(puckGame), puckGame, inputs)[0]?.url).not.toContain("o.apps");
  });
});
