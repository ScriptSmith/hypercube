import { describe, expect, it } from "vitest";
import { derivePinVerifier, generateAdminKey } from "../../src/core/adminkey";
import { DEFAULT_REACH } from "../../src/core/frame";
import {
  applyChange,
  configErrors,
  normalizeConfig,
  validateAdminKey,
  validatePeer,
  validatePin,
  validateRoom,
} from "../../src/pages/landing/config";
import { buildUrls } from "../../src/pages/landing/urls";
import { config, PLAY, puckGame, ROOM, sparkVisual } from "./fixtures";

describe("normalizeConfig", () => {
  it("starts from the manifest's first choices and a new room", () => {
    const cfg = normalizeConfig(null, puckGame, () => "fresh12345");
    expect(cfg).toMatchObject({
      app: "pucks",
      variant: "classic",
      setup: "solo",
      kind: "pair",
      count: 1,
      identity: "placeholders",
      room: "fresh12345",
      signalling: "public",
      idle: 60,
      res: 1,
      debug: false,
    });
    expect(cfg.options).toEqual({ pucks: "2", speed: 1, kids: true });
  });

  it("repairs saved values the app no longer supports", () => {
    const cfg = normalizeConfig(
      { app: "pucks", variant: "gone", setup: "corner", kind: "panel", idle: 99999, res: 7 },
      puckGame,
      () => "x",
    );
    expect(cfg).toMatchObject({
      variant: "classic",
      setup: "solo",
      kind: "pair",
      idle: 3600,
      res: 2,
    });
  });

  it("keeps setup and kind when switching to an app that supports them", () => {
    const wall = config(puckGame, { kind: "wall" });
    const next = normalizeConfig({ ...wall, app: "sparks" }, sparkVisual, () => "x");
    expect(next).toMatchObject({ app: "sparks", setup: "solo", kind: "wall", room: ROOM });
    expect(next.options).toEqual({});
  });

  it("resets count and reach when the setup or kind changes", () => {
    const bank = config(sparkVisual, { setup: "bank" });
    expect(bank.count).toBe(6);
    const pairs = config(sparkVisual, { setup: "bank", kind: "pair" });
    expect(pairs.count).toBe(3);
    const wall = config(sparkVisual, { setup: "solo", kind: "wall" });
    expect(wall.reach).toEqual(DEFAULT_REACH.wall);
  });

  it("keeps the screen preference across setups that have no screen", () => {
    const solo = config(sparkVisual, { setup: "solo", kind: "wall" });
    const bank = normalizeConfig({ ...solo, setup: "bank" }, sparkVisual, () => "x");
    expect(bank.screen).toBe(true);
  });
});

describe("validation", () => {
  it("checks room tokens", () => {
    expect(validateRoom(ROOM)).toBeNull();
    expect(validateRoom("abc123")).toMatch(/at least 10/);
    expect(validateRoom("abcdefghi")).toMatch(/at least 10/);
    expect(validateRoom("abcdefghij")).toBeNull();
    expect(validateRoom("Abcdefghij")).toMatch(/lowercase letters and digits/);
    expect(validateRoom("abcde-ghij")).toMatch(/lowercase letters and digits/);
    expect(validateRoom("abcde ghij")).toMatch(/lowercase letters and digits/);
    expect(validateRoom("a".repeat(65))).toMatch(/longer than 64/);
  });

  it("accepts only wss:// signalling servers", () => {
    expect(validatePeer("wss://signal.example.org:9000/hc")).toBeNull();
    expect(validatePeer("ws://signal.example.org")).toMatch(/wss:\/\//);
    expect(validatePeer("https://signal.example.org")).toMatch(/wss:\/\//);
    expect(validatePeer("not a url")).toMatch(/not a valid URL/);
    expect(validatePeer("")).toMatch(/Enter/);
    expect(validatePeer("wss://sig.example.org/hc?key=abc")).toMatch(/shared secret field/);
  });

  it("accepts PINs of 4 to 8 digits, or none", () => {
    expect(validatePin("")).toBeNull();
    expect(validatePin("4821")).toBeNull();
    expect(validatePin("12345678")).toBeNull();
    expect(validatePin("123")).toMatch(/4 to 8/);
    expect(validatePin("123456789")).toMatch(/4 to 8/);
    expect(validatePin("12a4")).toMatch(/digits only/);
  });

  it("reports problems that make the URLs unusable", () => {
    expect(configErrors(config(puckGame), "")).toEqual([]);
    expect(configErrors(config(puckGame), "12")).toHaveLength(1);
    const bad = config(puckGame, { room: "x", signalling: "custom", customPeer: "ws://a" });
    expect(configErrors(bad, "")).toHaveLength(2);
    const standalone = config(sparkVisual, { standalone: true, room: "x" });
    expect(configErrors(standalone, "12")).toEqual([]);
  });
});

describe("admin key", () => {
  it("is made with the room, kept when the config is saved and loaded, and replaced on request", () => {
    const fresh = normalizeConfig(null, puckGame, () => ROOM);
    expect(validateAdminKey(fresh.ak)).toBeNull();
    const reloaded = normalizeConfig(JSON.parse(JSON.stringify(fresh)), puckGame, () => "x");
    expect(reloaded.ak).toBe(fresh.ak);
    expect(reloaded.room).toBe(ROOM);
    const next = applyChange(fresh, { ak: generateAdminKey() }, puckGame, () => "x");
    expect(next.ak).not.toBe(fresh.ak);
    expect(next.room).toBe(ROOM);
  });

  it("checks pasted keys", () => {
    expect(validateAdminKey(generateAdminKey())).toBeNull();
    expect(validateAdminKey("short")).toMatch(/22/);
    expect(validateAdminKey("c-yMpewyWDZTXfFaZYlIm+")).toMatch(/22/);
  });

  it("blocks the URLs when a PIN is set but the key is broken", () => {
    const cfg = config(puckGame, { ak: "broken" });
    expect(configErrors(cfg, "")).toEqual([]);
    expect(configErrors(cfg, "4821")).toEqual(["Admin key is 22 letters, digits, - or _."]);
  });

  it("puts the key and the PIN check in URLs, never the PIN, and the check follows the key", async () => {
    const pin = "4821";
    const cfg = config(puckGame);
    const pv = await derivePinVerifier(pin, cfg.ak);
    const [entry] = buildUrls(cfg, puckGame, { playBase: PLAY, ak: cfg.ak, pv });
    expect(entry?.url).toContain(`&ak=${cfg.ak}&pv=${pv}`);
    expect(entry?.url).not.toMatch(/=4821(&|$)/);
    expect(await derivePinVerifier(pin, generateAdminKey())).not.toBe(pv);
    expect(await derivePinVerifier("4822", cfg.ak)).not.toBe(pv);
  });
});
