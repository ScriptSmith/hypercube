import { describe, expect, it } from "vitest";
import { computeSetup } from "../../src/core/frame";
import { peerOptions } from "../../src/core/net/signalling";
import { coerceOptions, parseParams } from "../../src/core/params";
import type { HostFrame, HostRole, Identity } from "../../src/core/types";
import { displayFor } from "../../src/core/venue";
import {
  adminUrl,
  buildQuery,
  buildUrls,
  PLACEHOLDERS,
  previewUrl,
  simPreset,
  simUrl,
  urlListText,
} from "../../src/pages/landing/urls";
import { config, PLAY, puckGame, ROOM, sparkVisual, stationTool } from "./fixtures";

const AK = "c-yMpewyWDZTXfFaZYlImA";
const PV = "Q2xhc3NpY1B1Y2tzMTIzNA";
const inputs = { playBase: PLAY, ak: null };
const search = (url: string) => url.slice(url.indexOf("?"));
const PLACEHOLDER_TAIL =
  "frame={frame}&zone={zone}&display={display}&displays={displays}&name={name}" +
  "&hostrole={role}&pos={index}&count={count}&w={w}&h={h}&mode={mode}";

describe("host placeholders", () => {
  it("adds every identity token literally, so the host can replace them", () => {
    const [entry] = buildUrls(config(puckGame), puckGame, inputs);
    expect(entry?.url.endsWith(PLACEHOLDER_TAIL)).toBe(true);
    expect(entry?.url).not.toContain("%7B");
    expect(PLACEHOLDERS).toHaveLength(11);
  });

  it("gives a solo frame one URL that boots in preview until the host fills it in", () => {
    const entries = buildUrls(config(puckGame, { kind: "wall" }), puckGame, inputs);
    expect(entries).toHaveLength(1);
    const p = parseParams(search(entries[0]?.url ?? ""));
    expect(p).toMatchObject({
      app: "pucks",
      setup: "solo",
      role: "solo",
      kind: "wall",
      room: ROOM,
    });
    expect(p.unfilled).toBe(true);
    expect(p.frame).toBeNull();
  });

  it("gives a bank one station URL for every touch frame and one for the screen", () => {
    const entries = buildUrls(config(sparkVisual, { setup: "bank" }), sparkVisual, inputs);
    expect(entries.map((e) => [e.label, e.note])).toEqual([
      ["Touch panels", "every touch panel in the bank"],
      ["Screen", "the screen above"],
    ]);
    expect(entries[0]?.frames).toHaveLength(6);
    expect(parseParams(search(entries[0]?.url ?? ""))).toMatchObject({
      setup: "bank",
      role: "station",
      kind: "panel",
      group: null,
    });
    expect(parseParams(search(entries[1]?.url ?? ""))).toMatchObject({
      role: "screen",
      kind: "screen",
    });
  });

  it("leaves out the screen when the setup does not allow one, or the operator turns it off", () => {
    expect(buildUrls(config(stationTool), stationTool, inputs)).toHaveLength(1);
    const off = config(sparkVisual, { setup: "bank", screen: false });
    expect(buildUrls(off, sparkVisual, inputs).map((e) => e.role)).toEqual(["station"]);
  });

  it("puts both banks of a corner in one group, one URL per side", () => {
    const entries = buildUrls(config(sparkVisual, { setup: "corner" }), sparkVisual, inputs);
    expect(entries.map((e) => `${e.label}: ${e.note}`)).toEqual([
      "Left touch panels: every touch panel in the left bank",
      "Right touch panels: every touch panel in the right bank",
      "Left screen: the screen above the left bank",
      "Right screen: the screen above the right bank",
    ]);
    expect(entries[0]?.frames).toHaveLength(6);
    const params = entries.map((e) => parseParams(search(e.url)));
    expect(params.map((p) => p.group)).toEqual(["corner", "corner", "corner", "corner"]);
    expect(params.map((p) => p.side)).toEqual([0, 1, 0, 1]);
  });

  it("puts both sides of a versus setup in one group, told apart by side", () => {
    const cfg = config(puckGame, { setup: "versus" });
    const entries = buildUrls(cfg, puckGame, inputs);
    expect(entries.map((e) => `${e.label}: ${e.note}`)).toEqual([
      "Side A wall: the wall on side A",
      "Side B wall: the wall on side B",
      "Side A screen: the screen above side A",
      "Side B screen: the screen above side B",
    ]);
    expect(entries[0]?.url).toContain("&group=match&side=a&");
    expect(entries[1]?.url).toContain("&group=match&side=b&");
    const params = entries.map((e) => parseParams(search(e.url)));
    expect(params.map((p) => p.side)).toEqual([0, 1, 0, 1]);
  });

  it("leaves pos and count tokens off screen URLs and writes the bank's size instead", () => {
    const entries = buildUrls(config(sparkVisual, { setup: "bank" }), sparkVisual, inputs);
    const station = entries.find((e) => e.role === "station")?.url ?? "";
    const screen = entries.find((e) => e.role === "screen")?.url ?? "";
    expect(station).toContain("&pos={index}&count={count}&");
    expect(screen).not.toMatch(/[?&]pos=/);
    expect(screen).not.toContain("{count}");
    expect(parseParams(search(screen)).count).toBe(6);
    expect(screen).toContain("&hostrole={role}&w={w}&h={h}&mode={mode}");
  });

  it("gives a screen its bank's size whether or not the host lists the touch frames", () => {
    const cfg = config(sparkVisual, { setup: "bank", count: 5 });
    const screenUrl = buildUrls(cfg, sparkVisual, inputs).find((e) => e.role === "screen")?.url;
    const params = parseParams(search(screenUrl ?? ""));
    const host = (role: HostRole, index: number, count: number): HostFrame => ({
      frame: `za:d${role}${index}:r0`,
      displays: [{ id: String(index), name: role }],
      role,
      index,
      count,
      width: 1080,
      height: 1920,
    });
    const screen = host("PRESENTATION", 0, 1);
    const identity = (siblings: HostFrame[]): Identity => ({
      frame: screen.frame,
      hostRole: "PRESENTATION",
      source: "host",
      mode: "show",
      siblings,
    });
    // The host lists only frames showing the same URL, and the panels have their own.
    expect(computeSetup(params, identity([screen]), "screen").count).toBe(5);
    expect(computeSetup(params, identity([]), "screen").count).toBe(5);
    // One URL for every display: the host's list is the truth.
    const touch = [0, 1, 2].map((i) => host("TOUCHSCREEN", i, 3));
    expect(computeSetup(params, identity([screen, ...touch]), "screen").count).toBe(3);
  });

  it("writes no count on a solo screen", () => {
    const cfg = config(sparkVisual, { setup: "solo", kind: "screen" });
    const entries = buildUrls(cfg, sparkVisual, inputs);
    expect(entries.map((e) => e.role)).toEqual(["screen"]);
    for (const e of entries) {
      expect(e.url).not.toMatch(/[?&]count=\d/);
    }
  });

  it("writes no side or group on one-sided setups", () => {
    for (const cfg of [config(puckGame), config(sparkVisual, { setup: "bank" })]) {
      const manifest = cfg.app === "pucks" ? puckGame : sparkVisual;
      for (const e of buildUrls(cfg, manifest, inputs)) {
        expect(e.url).not.toMatch(/[?&](side|group)=/);
      }
    }
  });
});

describe("manual identity", () => {
  it("writes one URL per frame with frame, pos and count", () => {
    const cfg = config(sparkVisual, { setup: "bank", identity: "manual" });
    const entries = buildUrls(cfg, sparkVisual, inputs);
    expect(entries).toHaveLength(7);
    const stations = entries
      .filter((e) => e.role === "station")
      .map((e) => parseParams(search(e.url)));
    expect(stations.map((p) => p.pos)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(stations.every((p) => p.count === 6 && !p.unfilled)).toBe(true);
    expect(new Set(entries.map((e) => parseParams(search(e.url)).frame)).size).toBe(7);
    expect(entries[2]).toMatchObject({ label: "Panel 3", note: "3 of 6 from the left" });
    expect(entries.every((e) => !e.url.includes("{"))).toBe(true);
  });

  it("follows the chosen count and kind", () => {
    const cfg = config(sparkVisual, { setup: "bank", kind: "pair", identity: "manual" });
    expect(cfg.count).toBe(3);
    const small = { ...cfg, count: 3, screen: false };
    const entries = buildUrls(small, sparkVisual, inputs);
    expect(entries.map((e) => parseParams(search(e.url)).frame)).toEqual([
      "pair-1",
      "pair-2",
      "pair-3",
    ]);
    expect(entries.map((e) => e.label)).toEqual(["Pair 1", "Pair 2", "Pair 3"]);
  });

  it("numbers each side of a corner from 0, with the side in the URL", () => {
    const cfg = config(sparkVisual, { setup: "corner", identity: "manual" });
    const entries = buildUrls(cfg, sparkVisual, inputs);
    expect(entries).toHaveLength(14);
    const right3 = entries.find((e) => e.key === "right-panel-3");
    expect(right3).toMatchObject({
      label: "Right panel 3",
      note: "3 of 6 from the left, in the right bank",
    });
    expect(parseParams(search(right3?.url ?? ""))).toMatchObject({
      frame: "right-panel-3",
      pos: 2,
      count: 6,
      side: 1,
      group: "corner",
    });
    const stations = entries.filter((e) => e.role === "station");
    expect(stations.map((e) => parseParams(search(e.url)).pos)).toEqual([
      0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5,
    ]);
  });

  it("gives a manual screen its touch-frame count and no position", () => {
    const cfg = config(sparkVisual, { setup: "corner", identity: "manual" });
    const screens = buildUrls(cfg, sparkVisual, inputs).filter((e) => e.role === "screen");
    expect(screens.map((e) => e.label)).toEqual(["Left screen", "Right screen"]);
    for (const e of screens) {
      expect(e.url).not.toMatch(/[?&]pos=/);
      expect(parseParams(search(e.url))).toMatchObject({ count: 6, role: "screen" });
    }
    expect(parseParams(search(screens[1]?.url ?? "")).frame).toBe("right-screen");
  });

  it("names single frames per side without a number", () => {
    const cfg = config(puckGame, { setup: "versus", identity: "manual", screen: false });
    const entries = buildUrls(cfg, puckGame, inputs);
    expect(entries.map((e) => [e.label, e.note, parseParams(search(e.url)).frame])).toEqual([
      ["Side A wall", "the wall on side A", "a-wall"],
      ["Side B wall", "the wall on side B", "b-wall"],
    ]);
    const p = parseParams(search(entries[1]?.url ?? ""));
    expect(p).toMatchObject({ side: 1, pos: 0, count: 1, group: "match" });
  });
});

describe("options and variant", () => {
  it("writes every option in full and round-trips through the runtime's coercion", () => {
    const cfg = config(puckGame, {
      variant: "paddles",
      options: { pucks: "many", speed: 1.3, kids: false },
    });
    const [entry] = buildUrls(cfg, puckGame, inputs);
    expect(entry?.url).toContain("variant=paddles&o.pucks=many&o.speed=1.3&o.kids=0");
    const p = parseParams(search(entry?.url ?? ""));
    expect(coerceOptions(p.options, puckGame.options)).toEqual(cfg.options);
  });

  it("snaps numbers to the option's step without float noise", () => {
    const cfg = config(puckGame, { options: { pucks: "1", speed: 0.1 + 0.2 + 0.4, kids: true } });
    expect(cfg.options.speed).toBe(0.7);
    const big = config(puckGame, { options: { speed: 9 } });
    expect(big.options.speed).toBe(2);
  });

  it("drops unknown options and bad enum values", () => {
    const cfg = config(puckGame, { options: { pucks: "nope", extra: 4 } });
    expect(cfg.options).toEqual({ pucks: "2", speed: 1, kids: true });
  });

  it("encodes reserved characters but keeps wss:// and reach readable", () => {
    expect(buildQuery([["a", "x&y=z #"]])).toBe("a=x%26y%3Dz%20%23");
    const cfg = config(puckGame, {
      signalling: "custom",
      customPeer: "wss://signal.example.org:9000/hc",
      reachOverride: true,
      reach: { adult: 0.4, child: 0.2 },
    });
    const [entry] = buildUrls(cfg, puckGame, inputs);
    expect(entry?.url).toContain("peer=wss://signal.example.org:9000/hc");
    expect(entry?.url).toContain("reach=0.4,0.2");
    const p = parseParams(search(entry?.url ?? ""));
    expect(p.peer).toBe("wss://signal.example.org:9000/hc");
    expect(p.reach).toEqual({ adult: 0.4, child: 0.2 });
  });

  it("puts the shared secret in the signalling address, encoded twice over", () => {
    const secret = "s3cret & key=1+2 %ok é";
    const cfg = config(puckGame, { signalling: "custom", customPeer: "wss://sig.example.org/hc" });
    const [entry] = buildUrls(cfg, puckGame, { playBase: PLAY, ak: null, secret });
    const url = entry?.url ?? "";
    expect(url).not.toContain("s3cret &");
    expect(url).toMatch(/&peer=wss:\/\/sig\.example\.org\/hc%3Fkey%3D[^&]+&/);
    const p = parseParams(search(url));
    expect(p.room).toBe(ROOM);
    expect(p.peer.startsWith("wss://sig.example.org/hc?key=")).toBe(true);
    expect(new URL(p.peer).searchParams.get("key")).toBe(secret);
    expect(peerOptions(p.peer)).toMatchObject({
      host: "sig.example.org",
      path: "/hc/",
      key: secret,
    });
  });

  it("leaves the key off when there is no secret, and ignores it for the public broker", () => {
    const custom = config(puckGame, {
      signalling: "custom",
      customPeer: "wss://sig.example.org/hc",
    });
    expect(buildUrls(custom, puckGame, inputs)[0]?.url).toContain(
      "&peer=wss://sig.example.org/hc&",
    );
    const pub = config(puckGame, { customPeer: "wss://sig.example.org/hc" });
    const url = buildUrls(pub, puckGame, { ...inputs, secret: "abc" })[0]?.url ?? "";
    expect(url).not.toMatch(/[?&]peer=/);
  });

  it("writes advanced settings only when they differ from the runtime defaults", () => {
    const plain = buildUrls(config(puckGame), puckGame, inputs)[0]?.url ?? "";
    expect(plain).not.toMatch(/[?&](idle|res|debug|reach|peer)=/);
    const cfg = config(puckGame, { idle: 120, res: 0.5, debug: true });
    const p = parseParams(search(buildUrls(cfg, puckGame, inputs)[0]?.url ?? ""));
    expect(p).toMatchObject({ idle: 120, res: 0.5, debug: true });
  });

  it("never writes reach on a screen", () => {
    const cfg = config(sparkVisual, { setup: "bank", reachOverride: true });
    const screen = buildUrls(cfg, sparkVisual, inputs).find((e) => e.role === "screen");
    expect(screen?.url).not.toContain("reach=");
  });
});

describe("room and admin key", () => {
  it("adds ak and pv after the room when admin is on", () => {
    const [entry] = buildUrls(config(puckGame), puckGame, { playBase: PLAY, ak: AK, pv: PV });
    expect(entry?.url).toContain(`&room=${ROOM}&ak=${AK}&pv=${PV}&`);
    expect(parseParams(search(entry?.url ?? ""))).toMatchObject({ room: ROOM, ak: AK, pv: PV });
  });

  it("leaves out both ak and pv unless it has both", () => {
    for (const admin of [{ ak: AK }, { ak: null, pv: PV }, { ak: AK, pv: null }]) {
      const [entry] = buildUrls(config(puckGame), puckGame, { playBase: PLAY, ...admin });
      expect(entry?.url).not.toMatch(/[?&](ak|pv)=/);
    }
  });

  it("leaves out room, peer, ak and pv when standalone", () => {
    const cfg = config(sparkVisual, { setup: "bank", standalone: true, signalling: "custom" });
    for (const e of buildUrls(cfg, sparkVisual, { playBase: PLAY, ak: AK, pv: PV })) {
      expect(e.url).not.toMatch(/[?&](room|peer|ak|pv)=/);
    }
  });

  it("uses a room by default and allows standalone unless the app needs a network", () => {
    expect(config(sparkVisual).standalone).toBe(false);
    expect(config(sparkVisual, { standalone: true }).standalone).toBe(true);
    expect(config(puckGame, { standalone: true }).standalone).toBe(true);
    expect(config(stationTool, { standalone: true }).standalone).toBe(false);
  });

  it("builds the admin link with room, key, verifier and signalling", () => {
    const url = adminUrl(
      config(puckGame),
      { ak: AK, pv: PV },
      "https://example.org/hypercube/admin/",
    );
    expect(url).toBe(
      `https://example.org/hypercube/admin/?room=${ROOM}&ak=${AK}&pv=${PV}&peer=public`,
    );
  });

  it("carries the signalling secret into the admin link", () => {
    const cfg = config(puckGame, { signalling: "custom", customPeer: "wss://sig.example.org/hc" });
    const url = adminUrl(cfg, { ak: AK, pv: PV }, "https://example.org/hypercube/admin/", "a&b");
    const peer = new URLSearchParams(url.slice(url.indexOf("?"))).get("peer") ?? "";
    expect(new URL(peer).searchParams.get("key")).toBe("a&b");
    expect(url).not.toContain("a&b");
  });
});

describe("simulator and preview links", () => {
  it("maps setups and kinds to presets", () => {
    expect(simPreset("solo", "panel")).toBe("panel");
    expect(simPreset("solo", "pair")).toBe("pair");
    expect(simPreset("solo", "wall")).toBe("wall");
    expect(simPreset("solo", "kiosk")).toBe("kiosk");
    expect(simPreset("solo", "screen")).toBe("screen");
    expect(simPreset("bank", "panel")).toBe("bank");
    expect(simPreset("bank", "pair")).toBe("bank");
    expect(simPreset("corner", "panel")).toBe("corner");
    expect(simPreset("versus", "wall")).toBe("versus");
  });

  it("carries the app, variant, options and bank size to the simulator", () => {
    const cfg = config(puckGame, { setup: "versus", variant: "paddles" });
    expect(simUrl(cfg, puckGame, "https://example.org/hypercube/sim/")).toBe(
      "https://example.org/hypercube/sim/?preset=versus&count=1&app=pucks&variant=paddles&o.pucks=2&o.speed=1&o.kids=1",
    );
    const solo = config(puckGame, { kind: "wall" });
    expect(simUrl(solo, puckGame, "https://x.org/sim/")).toBe(
      "https://x.org/sim/?preset=wall&app=pucks&variant=classic&o.pucks=2&o.speed=1&o.kids=1",
    );
  });

  it("previews the touch URL letterboxed to its kind, in preview mode", () => {
    const cfg = config(sparkVisual, { setup: "bank", identity: "manual" });
    const url = previewUrl(buildUrls(cfg, sparkVisual, inputs)) ?? "";
    const p = parseParams(search(url));
    const panel = displayFor("panel");
    expect(p).toMatchObject({
      preview: true,
      fit: { width: panel.width, height: panel.height },
      frame: "panel-1",
    });
  });

  it("previews the screen when there is nothing else", () => {
    const cfg = config(sparkVisual, { setup: "solo", kind: "screen" });
    const url = previewUrl(buildUrls(cfg, sparkVisual, inputs)) ?? "";
    expect(parseParams(search(url))).toMatchObject({ kind: "screen", role: "screen" });
    const screen = displayFor("screen");
    expect(url).toContain(`fit=${screen.width}x${screen.height}`);
  });

  it("uses the given player base, whatever path the site lives under", () => {
    const local = { playBase: "http://localhost:5173/play/", ak: null };
    expect(buildUrls(config(puckGame), puckGame, local)[0]?.url).toMatch(
      /^http:\/\/localhost:5173\/play\/\?app=pucks&/,
    );
  });

  it("lists every URL with its label for copying", () => {
    const entries = buildUrls(config(sparkVisual, { setup: "bank" }), sparkVisual, inputs);
    const text = urlListText(entries);
    expect(text.split("\n\n")).toHaveLength(2);
    expect(text.startsWith("Touch panels (every touch panel in the bank)\nhttps://")).toBe(true);
  });
});
