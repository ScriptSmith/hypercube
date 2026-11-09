import { describe, expect, it } from "vitest";
import { parseParams } from "../../src/core/params";
import { brokerFor } from "../../src/core/net/signalling";
import {
  frameUrl,
  parseSimUrl,
  phoneUrl,
  type SimConfig,
  simSearch,
} from "../../src/pages/sim/config";
import { buildPreset } from "../../src/pages/sim/presets";
import { splitPeer, validatePeer, withPeerKey } from "../../src/pages/signalling";

const PLAY = "http://localhost:5173/play/";
const fixedRoom = () => "room123";
const SERVER = "wss://signal.example.org/hc";
const SECRET = "s3cret & key=1+2 %ok é";
const panel = buildPreset("bank").frames.find((f) => f.id === "a-p4")!;
const frames = buildPreset("bank").frames;

const withKey = `${SERVER}?key=${encodeURIComponent(SECRET)}`;
const ownUrl = `?preset=bank&app=hockey&transport=peer&peer=${encodeURIComponent(withKey)}`;
const frameParams = (c: SimConfig) =>
  frames.map((f) => new URL(frameUrl(PLAY, f, c, { res: 1 })).searchParams);

describe("sim network choice", () => {
  it("reads this tab, the public broker and an own server from the URL", () => {
    expect(parseSimUrl("?transport=local", fixedRoom).network).toBe("local");
    expect(parseSimUrl("", fixedRoom).network).toBe("local");
    expect(parseSimUrl("?transport=peer", fixedRoom).network).toBe("public");
    expect(parseSimUrl("?transport=peer&peer=public", fixedRoom)).toMatchObject({
      network: "public",
      server: "",
      secret: "",
    });
    expect(
      parseSimUrl(`?transport=peer&peer=${encodeURIComponent(SERVER)}`, fixedRoom),
    ).toMatchObject({ network: "own", server: SERVER, secret: "" });
  });

  it("splits a key in the peer URL into the address and the secret", () => {
    const c = parseSimUrl(ownUrl, fixedRoom);
    expect(c).toMatchObject({ network: "own", server: SERVER, secret: SECRET });
    expect(c.extra).toEqual({});
  });

  it("keeps an address given with the local transport without using it", () => {
    const c = parseSimUrl(`?transport=local&peer=${encodeURIComponent(SERVER)}`, fixedRoom);
    expect(c).toMatchObject({ network: "local", server: SERVER });
    const q = new URLSearchParams(simSearch(c));
    expect([q.get("transport"), q.get("peer")]).toEqual(["local", null]);
  });

  it("writes each choice back to the sim URL", () => {
    const write = (search: string) =>
      new URLSearchParams(simSearch(parseSimUrl(search, fixedRoom)));
    const local = write("?transport=local");
    expect([local.get("transport"), local.get("peer")]).toEqual(["local", null]);
    const pub = write("?transport=peer&peer=public");
    expect([pub.get("transport"), pub.get("peer")]).toEqual(["peer", null]);
    const own = write(ownUrl);
    expect([own.get("transport"), own.get("peer")]).toEqual(["peer", SERVER]);
    for (const search of ["?transport=local", "?transport=peer", ownUrl]) {
      const c = parseSimUrl(search, fixedRoom);
      expect(parseSimUrl(simSearch(c), fixedRoom)).toEqual({ ...c, secret: "" });
    }
  });

  it("never puts the secret in the sim URL", () => {
    const c = parseSimUrl(ownUrl, fixedRoom);
    const search = simSearch(c);
    expect(new URL(new URLSearchParams(search).get("peer")!).searchParams.has("key")).toBe(false);
    expect(search).not.toContain("key%3D");
    expect(search).not.toContain("s3cret");
    expect(search).not.toContain(encodeURIComponent("s3cret"));
    // Even an address that somehow kept its key loses it.
    const leaky = simSearch({ ...c, server: withKey });
    expect(leaky).not.toContain("s3cret");
    expect(new URLSearchParams(leaky).get("peer")).toBe(SERVER);
  });

  it("gives every frame the own server's address with the key", () => {
    const c = parseSimUrl(ownUrl, fixedRoom);
    for (const q of frameParams(c)) {
      expect(q.get("transport")).toBe("peer");
      const peer = new URL(q.get("peer")!);
      expect(`${peer.origin}${peer.pathname}`).toBe(SERVER);
      expect(peer.searchParams.get("key")).toBe(SECRET);
    }
    // The runtime reads it back as the same address and key.
    const p = parseParams(new URL(frameUrl(PLAY, panel, c, { res: 1 })).search);
    expect(brokerFor(p.peer).options).toMatchObject({
      host: "signal.example.org",
      path: "/hc/",
      secure: true,
      key: SECRET,
    });
  });

  it("gives phones the key too, since they must join the same server", () => {
    const c = parseSimUrl(ownUrl, fixedRoom);
    const q = new URL(phoneUrl(PLAY, panel, c)).searchParams;
    expect(q.get("transport")).toBe("peer");
    expect(new URL(q.get("peer")!).searchParams.get("key")).toBe(SECRET);
  });

  it("leaves the key off without a secret, and peer off for this tab and the public broker", () => {
    const own = parseSimUrl(`?transport=peer&peer=${encodeURIComponent(SERVER)}`, fixedRoom);
    for (const q of frameParams(own)) expect(q.get("peer")).toBe(SERVER);
    for (const search of ["?transport=local", "?transport=peer&peer=public"]) {
      const c = { ...parseSimUrl(search, fixedRoom), server: SERVER, secret: SECRET };
      for (const q of frameParams(c)) expect(q.has("peer")).toBe(false);
    }
    // A phone of a sim on this tab uses the public broker, never the remembered server.
    const local = { ...parseSimUrl("?transport=local", fixedRoom), server: SERVER, secret: SECRET };
    const phone = new URL(phoneUrl(PLAY, panel, local)).searchParams;
    expect([phone.get("transport"), phone.has("peer")]).toEqual(["peer", false]);
  });
});

describe("signalling addresses", () => {
  it("splits and joins an address and its key", () => {
    expect(splitPeer(withKey)).toEqual({ address: SERVER, secret: SECRET });
    expect(splitPeer(`${SERVER}?x=1&key=abc`)).toEqual({ address: `${SERVER}?x=1`, secret: "abc" });
    expect(splitPeer(SERVER)).toEqual({ address: SERVER, secret: "" });
    expect(splitPeer("not a url")).toEqual({ address: "not a url", secret: "" });
    expect(splitPeer(withPeerKey(SERVER, SECRET))).toEqual({ address: SERVER, secret: SECRET });
    expect(withPeerKey(` ${SERVER} `, "")).toBe(SERVER);
  });

  it("lets the sim use ws:// on localhost only", () => {
    const sim = { loopbackWs: true };
    expect(validatePeer(SERVER, sim)).toBeNull();
    expect(validatePeer("ws://localhost:8787/", sim)).toBeNull();
    expect(validatePeer("ws://127.0.0.1:8787", sim)).toBeNull();
    expect(validatePeer("ws://signal.example.org", sim)).toMatch(/wss:\/\/.*localhost/);
    expect(validatePeer("https://signal.example.org", sim)).toMatch(/wss:\/\//);
    expect(validatePeer("not a url", sim)).toMatch(/not a valid URL/);
    expect(validatePeer("", sim)).toMatch(/Enter/);
    expect(validatePeer(withKey, sim)).toMatch(/shared secret field/);
    // The landing page's rules are unchanged.
    expect(validatePeer("ws://localhost:8787/")).toMatch(/must start with wss:\/\//);
  });
});
