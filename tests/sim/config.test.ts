import { describe, expect, it } from "vitest";
import { parseParams } from "../../src/core/params";
import type { OptionDef } from "../../src/core/types";
import { DEFAULT_VENUE, mergeVenue, venueFromParam } from "../../src/core/venue";
import {
  dropTextOptions,
  frameUrl,
  newRoomToken,
  optionApplies,
  parseSimUrl,
  phoneUrl,
  simSearch,
} from "../../src/pages/sim/config";
import { buildPreset, type SimFrame } from "../../src/pages/sim/presets";
import { defaultVenue } from "../../src/pages/sim/venue";

const PLAY = "http://localhost:5173/play/";
const fixedRoom = () => "room123";

describe("parseSimUrl", () => {
  it("defaults to the default venue's bank on the local transport with a fresh room", () => {
    const c = parseSimUrl("", fixedRoom);
    expect(c).toMatchObject({
      preset: "bank",
      profile: "",
      venue: defaultVenue(),
      app: "idle",
      variant: null,
      options: {},
      network: "local",
      server: "",
      secret: "",
      res: null,
      room: "room123",
      bots: 0,
    });
  });

  it("reads the whole URL contract", () => {
    const c = parseSimUrl(
      "?preset=corner&count=8&span=2&sw=3840&sh=2160&app=hockey&variant=paddles&o.pucks=3" +
        "&o.slow=1&transport=peer&res=0.35&room=abc_DEF-9&bots=2&fa.a-p3=diag&seed=7",
      fixedRoom,
    );
    expect(c).toEqual({
      preset: "corner",
      profile: "",
      venue: { ...defaultVenue(), count: 8, span: 2, sw: 3840, sh: 2160 },
      app: "hockey",
      variant: "paddles",
      options: { pucks: "3", slow: "1" },
      network: "public",
      server: "",
      secret: "",
      res: 0.35,
      room: "abc_DEF-9",
      bots: 2,
      apps: { "a-p3": "diag" },
      extra: { seed: "7" },
    });
  });

  it("falls back on bad values", () => {
    const c = parseSimUrl("?preset=nope&res=9&room=bad%20room&bots=-1&transport=x", fixedRoom);
    expect(c.preset).toBe("bank");
    expect(c.res).toBeNull();
    expect(c.room).toBe("room123");
    expect(c.bots).toBe(0);
    expect(c.network).toBe("local");
  });

  it("expands the bank shortcuts into the venue's bank of panels or of pairs", () => {
    expect(parseSimUrl("?preset=bank-panels", fixedRoom)).toMatchObject({
      preset: "bank",
      venue: { count: DEFAULT_VENUE.bankCount, span: 1 },
    });
    expect(parseSimUrl("?preset=bank-pairs", fixedRoom)).toMatchObject({
      preset: "bank",
      venue: { count: DEFAULT_VENUE.bankCount / 2, span: 2 },
    });
    expect(parseSimUrl("?preset=bank-pairs&count=2", fixedRoom).venue).toMatchObject({
      count: 2,
      span: 2,
    });
    expect(parseSimUrl("?preset=bank-panels&venue=bank:8", fixedRoom).venue.count).toBe(8);
  });

  it("starts from remembered venue values, with the URL winning", () => {
    const sizes = { sw: 1920, sh: 1080, pb: 1.2 };
    const c = parseSimUrl("?preset=bank&pb=0.8&count=50", fixedRoom, { sizes });
    expect(c.venue).toMatchObject({ sw: 1920, sh: 1080, pb: 0.8, count: DEFAULT_VENUE.bankCount });
  });

  it("starts from the venue param, or else the operator's remembered profile", () => {
    const sizes = { sw: 1920, sh: 1080 };
    const remembered = parseSimUrl("?preset=bank", fixedRoom, { profile: "bank:4", sizes });
    expect(remembered).toMatchObject({ profile: "bank:4", venue: { count: 4, sw: 1920 } });
    const given = parseSimUrl("?preset=bank&venue=screen:3000x2000,bank:5", fixedRoom, {
      profile: "bank:4",
      sizes,
    });
    expect(given.profile).toBe("bank:5,screen:3000x2000:5x4.5:2.3");
    expect(given.venue).toMatchObject({ count: 5, sw: 3000, sh: 2000 });
    expect(new URLSearchParams(simSearch(given)).get("venue")).toBe(given.profile);
    expect(parseSimUrl(simSearch(given), fixedRoom)).toEqual(given);
  });

  it("writes only the venue values that matter or differ from the defaults", () => {
    const search = simSearch(parseSimUrl("?preset=bank&count=6&span=1&ww=7680", fixedRoom));
    const q = new URLSearchParams(search);
    expect([q.get("count"), q.get("span"), q.get("ww"), q.get("sw")]).toEqual([
      "6",
      "1",
      "7680",
      null,
    ]);
    expect(
      new URLSearchParams(simSearch(parseSimUrl("?preset=versus", fixedRoom))).has("count"),
    ).toBe(false);
  });

  it("reads and writes the sphere's sizes like the other displays", () => {
    const c = parseSimUrl("?preset=sphere&spw=8192&sph=4096&spd=6.5&spb=3.5", fixedRoom);
    expect(c.preset).toBe("sphere");
    expect(c.venue).toMatchObject({ spw: 8192, sph: 4096, spd: 6.5, spb: 3.5 });
    const q = new URLSearchParams(simSearch(c));
    expect([q.get("spw"), q.get("sph"), q.get("spd"), q.get("spb")]).toEqual([
      "8192",
      "4096",
      "6.5",
      "3.5",
    ]);
    expect(q.has("count")).toBe(false);
    expect(q.has("span")).toBe(false);
    const plain = new URLSearchParams(simSearch(parseSimUrl("?preset=sphere", fixedRoom)));
    expect(["spw", "sph", "spd", "spb"].filter((k) => plain.has(k))).toEqual([]);
    expect(parseSimUrl("?spd=0&spb=-1&spw=50", fixedRoom).venue).toMatchObject({
      spd: defaultVenue().spd,
      spb: defaultVenue().spb,
      spw: defaultVenue().spw,
    });
  });

  it("round-trips through simSearch", () => {
    const c = parseSimUrl(
      "?preset=versus&app=diag&o.x=1&transport=peer&res=0.5&room=r1&bots=3&fa.b-wall=idle&debug=1",
      fixedRoom,
    );
    expect(parseSimUrl(simSearch(c), fixedRoom)).toEqual(c);
  });
});

describe("frameUrl", () => {
  const preset = buildPreset("bank");
  const panel = preset.frames.find((f) => f.id === "a-p4")!;
  const screen = preset.frames.find((f) => f.kind === "screen")!;
  const config = parseSimUrl("?preset=bank-panels&app=hockey&variant=paddles&o.pucks=3", fixedRoom);

  it("gives each frame its identity, setup, room, transport and res", () => {
    const url = new URL(frameUrl(PLAY, panel, config, { res: 0.15 }));
    expect(url.pathname).toBe("/play/");
    const p = parseParams(url.search);
    expect(p).toMatchObject({
      app: "hockey",
      variant: "paddles",
      options: { pucks: "3" },
      setup: "bank",
      role: "station",
      pos: 3,
      count: 6,
      group: "main",
      frame: "a-p4",
      zone: "a",
      display: "a-p4",
      name: "Zone A panel 4",
      kind: "panel",
      room: "room123",
      transport: "local",
      res: 0.15,
      bots: 0,
      fit: null,
    });
    expect(url.searchParams.has("bots")).toBe(false);
    expect(url.searchParams.has("side")).toBe(false);
    expect(p).toMatchObject({ w: 1080, h: 1920, span: null });
    expect(p.reach?.adult).toBeCloseTo(panel.reach!.adult, 3);
    expect(p.reach?.child).toBeCloseTo(panel.reach!.child, 3);
  });

  it("gives merged frames their span and full pixel size", () => {
    const merged = buildPreset("bank", { ...defaultVenue(), count: 4, span: 3 }).frames[1]!;
    const p = parseParams(new URL(frameUrl(PLAY, merged, config, { res: 1 })).search);
    expect(p).toMatchObject({ kind: "pair", span: 3, w: 3240, h: 1920 });
    const phone = parseParams(new URL(phoneUrl(PLAY, merged, config)).search);
    expect(phone.fit).toEqual({ width: 3240, height: 1920 });
  });

  it("puts both sides of a corner in one group with per-side positions", () => {
    const corner = buildPreset("corner");
    const c = parseSimUrl("?preset=corner&app=diag", fixedRoom);
    const params = (id: string) =>
      parseParams(
        new URL(
          frameUrl(
            PLAY,
            corner.frames.find((f) => f.id === id)!,
            c,
            { res: 1 },
          ),
        ).search,
      );
    expect(params("a-p3")).toMatchObject({ group: "corner", side: 0, pos: 2, count: 6 });
    expect(params("b-p3")).toMatchObject({ group: "corner", side: 1, pos: 2, count: 6 });
    expect(params("b-screen")).toMatchObject({ role: "screen", side: 1, pos: 0, count: 6 });
    const versus = buildPreset("versus").frames[1]!;
    const v = parseParams(new URL(frameUrl(PLAY, versus, c, { res: 1 })).search);
    expect(v).toMatchObject({ setup: "versus", group: "versus", side: 1, pos: 0, count: 1 });
  });

  it("marks the screen as a screen", () => {
    const p = parseParams(new URL(frameUrl(PLAY, screen, config, { res: 0.3 })).search);
    expect(p).toMatchObject({ kind: "screen", role: "screen", pos: 0, count: 6 });
  });

  it("drops the sim's variant and options for a frame running another app", () => {
    const c = { ...config, apps: { "a-p4": "diag" } };
    const p = parseParams(new URL(frameUrl(PLAY, panel, c, { res: 0.2 })).search);
    expect(p.app).toBe("diag");
    expect(p.variant).toBeNull();
    expect(p.options).toEqual({});
    const other = parseParams(new URL(frameUrl(PLAY, screen, c, { res: 0.2 })).search);
    expect(other.app).toBe("hockey");
  });

  it("passes an option only to the frame kinds it applies to", () => {
    const defs: OptionDef[] = [
      { type: "number", key: "pucks", title: "Pucks", min: 1, max: 5, step: 1, default: 2 },
      { type: "boolean", key: "slow", title: "Slow", default: false, kinds: ["wall"] },
      { type: "boolean", key: "shown", title: "Shown", default: false, kinds: ["screen"] },
    ];
    const c = parseSimUrl("?app=hockey&o.pucks=3&o.slow=1&o.shown=1&o.other=x", fixedRoom);
    const opts = (f: SimFrame) =>
      parseParams(new URL(frameUrl(PLAY, f, c, { res: 1, optionDefs: defs })).search).options;
    expect(opts(panel)).toEqual({ pucks: "3", other: "x" });
    expect(opts(screen)).toEqual({ pucks: "3", shown: "1", other: "x" });
    const wall = buildPreset("wall").frames[0]!;
    expect(opts(wall)).toEqual({ pucks: "3", slow: "1", other: "x" });
    expect(parseParams(new URL(phoneUrl(PLAY, panel, c, defs)).search).options).toEqual({
      pucks: "3",
      other: "x",
    });
    expect(optionApplies(defs[0], "kiosk")).toBe(true);
    expect(optionApplies(defs[1], "kiosk")).toBe(false);
  });

  it("never passes text on, and skips options their condition hides", () => {
    const defs: OptionDef[] = [
      {
        type: "enum",
        key: "question",
        title: "Question",
        values: [
          { id: "pets", title: "Pets" },
          { id: "custom", title: "Your own" },
        ],
        default: "pets",
      },
      { type: "text", key: "ask", title: "Question text", maxLength: 80, default: "" },
      {
        type: "number",
        key: "answers",
        title: "Answers",
        min: 2,
        max: 4,
        step: 1,
        default: 2,
        when: { key: "question", is: ["custom"] },
      },
    ];
    const opts = (search: string) => {
      const c = parseSimUrl(search, fixedRoom);
      const url = frameUrl(PLAY, panel, c, { res: 1, optionDefs: defs });
      return { url, options: parseParams(new URL(url).search).options };
    };
    const pets = opts("?app=poll&o.ask=Click%20here&o.answers=3");
    expect(pets.options).toEqual({});
    expect(pets.url).not.toContain("Click");
    expect(opts("?app=poll&o.question=custom&o.ask=Hi&o.answers=3").options).toEqual({
      question: "custom",
      answers: "3",
    });

    const c = parseSimUrl("?app=poll&o.ask=Hi&o.answers=3", fixedRoom);
    dropTextOptions(c, defs);
    expect(simSearch(c)).not.toContain("o.ask");
    expect(simSearch(c)).toContain("o.answers=3");
  });

  it("gives frames the venue they are drawn in, only where it differs from the defaults", () => {
    const venueOf = (search: string, id = "a-p2") => {
      const c = parseSimUrl(search, fixedRoom);
      const f = buildPreset(c.preset, c.venue, venueFromParam(c.profile)).frames.find(
        (x) => x.id === id,
      )!;
      const p = parseParams(new URL(frameUrl(PLAY, f, c, { res: 1 })).search);
      return { raw: new URL(frameUrl(PLAY, f, c, { res: 1 })).searchParams.get("venue"), p };
    };
    expect(venueOf("?preset=bank").raw).toBeNull();
    expect(venueOf("?preset=bank-pairs", "a-pair2").raw).toBeNull();
    expect(venueOf("?preset=bank&venue=bank:4").raw).toBe("bank:4");
    const tall = venueOf("?preset=bank&count=4&pw=1200&pb=1");
    expect(tall.raw).toBe("panel:1200x1920:0.81x1.44:1,bank:4,screen:4000x3600:5x4.5:2.55");
    const venue = mergeVenue(DEFAULT_VENUE, tall.p.venue);
    expect(venue.panel).toMatchObject({ width: 1200, bottomM: 1 });
    expect(venue.screen.bottomM).toBeCloseTo(2.55);
  });

  it("passes bots and extra params through", () => {
    const c = parseSimUrl("?app=diag&bots=4&seed=abc&idle=30&ak=k3y_-Z&pv=v3r_-X", fixedRoom);
    const p = parseParams(new URL(frameUrl(PLAY, panel, c, { res: 1 })).search);
    expect(p.bots).toBe(4);
    expect(p.seed).toBe("abc");
    expect(p.idle).toBe(30);
    expect(p.ak).toBe("k3y_-Z");
    expect(p.pv).toBe("v3r_-X");
    const phone = parseParams(new URL(phoneUrl(PLAY, panel, c)).search);
    expect([phone.ak, phone.pv]).toEqual(["k3y_-Z", "v3r_-X"]);
  });

  it("tells a sphere its kind, feed size and where it hangs, and shows it as a globe if asked", () => {
    const venue = { ...defaultVenue(), spw: 6000, sph: 3000, spd: 4, spb: 3.5 };
    const ball = buildPreset("sphere", venue).frames[0]!;
    const c = parseSimUrl("?preset=sphere&app=diag", fixedRoom);
    const url = new URL(frameUrl(PLAY, ball, c, { res: 0.1, look: "globe" }));
    const p = parseParams(url.search);
    expect(p).toMatchObject({
      kind: "sphere",
      setup: "solo",
      role: "solo",
      w: 6000,
      h: 3000,
      sphere: { diameter: 4, bottom: 3.5 },
      look: "globe",
      reach: null,
    });
    expect(url.searchParams.get("sphere")).toBe("4,3.5");
    const flat = new URL(frameUrl(PLAY, ball, c, { res: 0.1, look: "flat" })).searchParams;
    expect(flat.has("look")).toBe(false);
    expect(new URL(frameUrl(PLAY, ball, c, { res: 0.1 })).searchParams.has("look")).toBe(false);
    // The phone takes the sphere's place, so it gets the flat feed.
    expect(parseParams(new URL(phoneUrl(PLAY, ball, c)).search)).toMatchObject({
      look: "flat",
      fit: { width: 6000, height: 3000 },
    });
  });

  it("gives look and sphere only to spheres", () => {
    const q = new URL(frameUrl(PLAY, panel, config, { res: 1, look: "globe" })).searchParams;
    expect(q.has("look")).toBe(false);
    expect(q.has("sphere")).toBe(false);
  });

  it("builds phone URLs that letterbox and use PeerJS", () => {
    const p = parseParams(new URL(phoneUrl(PLAY, panel, config)).search);
    expect(p.fit).toEqual({ width: 1080, height: 1920 });
    expect(p.transport).toBe("peer");
    expect(p.res).toBe(1);
    expect(p.frame).toBe("a-p4");
    expect(p.room).toBe("room123");
    const wall = buildPreset("wall").frames[0]!;
    expect(parseParams(new URL(phoneUrl(PLAY, wall, config)).search).fit).toEqual({
      width: DEFAULT_VENUE.wall.width,
      height: DEFAULT_VENUE.wall.height,
    });
  });
});

describe("newRoomToken", () => {
  it("makes distinct tokens that are safe in peer ids", () => {
    const a = newRoomToken();
    const b = newRoomToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[a-z0-9]{20,}$/);
  });
});
