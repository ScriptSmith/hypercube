import { describe, expect, it } from "vitest";
import { generateAdminKey } from "../../src/core/adminkey";
import {
  canonical,
  createVerifier,
  type Envelope,
  importAdminKey,
  MAX_SKEW_MS,
  newNonce,
  readEnvelope,
  signEnvelope,
  type Unsigned,
  verifySignature,
} from "../../src/core/admin/sign";

const AK = generateAdminKey();
const OTHER = generateAdminKey();

const key = async (ak = AK) => {
  const k = await importAdminKey(ak);
  if (!k) throw new Error("bad key");
  return k;
};

const unsigned = (over: Partial<Unsigned> = {}): Unsigned => ({
  v: 1,
  id: newNonce(),
  ts: 1_000_000,
  from: "panel-1",
  target: { k: "frames", ids: ["panel-2", "panel-3"] },
  cmd: "set",
  args: { config: { app: "diag", options: { speed: 2, fast: true } }, merge: true },
  ...over,
});

/** As it arrives from the network: a JSON round trip with keys in another order. */
const wire = (env: Envelope): Record<string, unknown> => {
  const parsed = JSON.parse(JSON.stringify(env)) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(parsed).reverse());
};

describe("canonical", () => {
  it("sorts keys at every level and ignores insertion order", () => {
    const a = { b: 1, a: { d: [1, { y: 2, x: 1 }], c: "s" } };
    const b = { a: { c: "s", d: [1, { x: 1, y: 2 }] }, b: 1 };
    expect(canonical(a)).toBe(canonical(b));
    expect(canonical(a)).toBe('{"a":{"c":"s","d":[1,{"x":1,"y":2}]},"b":1}');
  });

  it("drops undefined fields but keeps nulls, and writes undefined array items as null", () => {
    expect(canonical({ a: undefined, b: null, c: [undefined] })).toBe('{"b":null,"c":[null]}');
  });

  it("escapes strings as JSON does", () => {
    expect(canonical({ 'q"k': 'line\n"quoted"' })).toBe('{"q\\"k":"line\\n\\"quoted\\""}');
  });

  it("refuses values JSON can't carry faithfully", () => {
    expect(() => canonical({ n: Number.NaN })).toThrow();
    expect(() => canonical({ n: Infinity })).toThrow();
    expect(() => canonical({ f: () => 1 })).toThrow();
    expect(() => canonical(10n)).toThrow();
  });

  it("matches across a JSON round trip", () => {
    const value = { z: [0.1, -0, 1e21, "é"], a: { nested: true } };
    expect(canonical(JSON.parse(JSON.stringify(value)))).toBe(canonical(value));
  });
});

describe("signing", () => {
  it("verifies its own signature after a trip over the wire", async () => {
    const k = await key();
    const env = await signEnvelope(k, unsigned());
    expect(env.sig).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await verifySignature(k, wire(env))).toBe(true);
  });

  it("rejects a different key", async () => {
    const env = await signEnvelope(await key(), unsigned());
    expect(await verifySignature(await key(OTHER), wire(env))).toBe(false);
  });

  it("rejects any change to a signed field", async () => {
    const k = await key();
    const env = await signEnvelope(k, unsigned());
    const tampered: Record<string, unknown>[] = [
      { ...wire(env), cmd: "reload" },
      { ...wire(env), ts: env.ts + 1 },
      { ...wire(env), from: "panel-9" },
      { ...wire(env), id: newNonce() },
      { ...wire(env), target: { k: "all" } },
      { ...wire(env), args: { config: { app: "idle" }, merge: true } },
      { ...wire(env), extra: 1 },
    ];
    const { args: _drop, ...noArgs } = wire(env);
    tampered.push(noArgs);
    for (const t of tampered) expect(await verifySignature(k, t)).toBe(false);
  });

  it("rejects unsigned, truncated and garbage signatures", async () => {
    const k = await key();
    const env = await signEnvelope(k, unsigned());
    const { sig: _sig, ...bare } = wire(env);
    expect(await verifySignature(k, bare)).toBe(false);
    expect(await verifySignature(k, { ...wire(env), sig: env.sig.slice(0, 20) })).toBe(false);
    expect(await verifySignature(k, { ...wire(env), sig: "!!!" })).toBe(false);
    expect(await verifySignature(k, null)).toBe(false);
  });

  it("refuses keys that are not keys", async () => {
    expect(await importAdminKey("")).toBeNull();
    expect(await importAdminKey("abc")).toBeNull();
    expect(await importAdminKey("not base64 at all!")).toBeNull();
  });
});

describe("readEnvelope", () => {
  it("checks the shape", async () => {
    const env = await signEnvelope(await key(), unsigned());
    expect(readEnvelope(wire(env))).toEqual(env);
    expect(readEnvelope({ ...wire(env), v: 2 })).toBeNull();
    expect(readEnvelope({ ...wire(env), target: { k: "everyone" } })).toBeNull();
    expect(readEnvelope({ ...wire(env), ts: "now" })).toBeNull();
    expect(readEnvelope({ ...wire(env), id: "short" })).toBeNull();
    expect(readEnvelope("text")).toBeNull();
  });
});

describe("verifier", () => {
  const setup = async (now = { t: 1_000_000 }) => {
    const k = await key();
    return { k, now, v: createVerifier(k, () => now.t) };
  };

  it("accepts a fresh, signed envelope once", async () => {
    const { k, v } = await setup();
    const env = await signEnvelope(k, unsigned());
    const first = await v.check(wire(env), "panel-1");
    expect("env" in first && first.env.cmd).toBe("set");
    expect(await v.check(wire(env), "panel-1")).toEqual({ reason: "replay" });
  });

  it("rejects envelopes outside the skew window either way", async () => {
    const { k, v } = await setup();
    const at = (ts: number) => signEnvelope(k, unsigned({ ts }));
    expect("env" in (await v.check(wire(await at(1_000_000 - MAX_SKEW_MS + 1))))).toBe(true);
    expect("env" in (await v.check(wire(await at(1_000_000 + MAX_SKEW_MS - 1))))).toBe(true);
    expect(await v.check(wire(await at(1_000_000 - MAX_SKEW_MS - 1)))).toEqual({ reason: "stale" });
    expect(await v.check(wire(await at(1_000_000 + MAX_SKEW_MS + 1)))).toEqual({ reason: "stale" });
  });

  it("rejects a sender that doesn't match the network's", async () => {
    const { k, v } = await setup();
    const env = await signEnvelope(k, unsigned());
    expect(await v.check(wire(env), "panel-7")).toEqual({ reason: "sender" });
  });

  it("rejects bad signatures before remembering the nonce", async () => {
    const { k, v } = await setup();
    const env = await signEnvelope(k, unsigned());
    expect(await v.check({ ...wire(env), cmd: "reload" })).toEqual({ reason: "signature" });
    expect("env" in (await v.check(wire(env)))).toBe(true);
  });

  it("treats remembered nonces as seen", async () => {
    const { k, v } = await setup();
    const env = await signEnvelope(k, unsigned());
    v.remember(env.id, env.ts);
    expect(await v.check(wire(env))).toEqual({ reason: "replay" });
  });

  it("keeps a bounded nonce set", async () => {
    const now = { t: 1_000_000 };
    const k = await key();
    const v = createVerifier(k, () => now.t, 8);
    const first = await signEnvelope(k, unsigned());
    expect("env" in (await v.check(wire(first)))).toBe(true);
    for (let i = 0; i < 8; i++) v.remember(newNonce(), now.t);
    // The oldest nonce fell out of the set, so only the time window protects it now.
    expect("env" in (await v.check(wire(first)))).toBe(true);
  });

  it("forgets nonces that are too old to replay", async () => {
    const now = { t: 1_000_000 };
    const k = await key();
    const v = createVerifier(k, () => now.t, 8);
    const old = await signEnvelope(k, unsigned());
    expect("env" in (await v.check(wire(old)))).toBe(true);
    now.t += 3 * MAX_SKEW_MS;
    v.remember(newNonce(), now.t);
    expect(await v.check(wire(old))).toEqual({ reason: "stale" });
  });
});
