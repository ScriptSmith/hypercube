import { describe, expect, it } from "vitest";
import {
  derivePinVerifier,
  generateAdminKey,
  fromBase64Url,
  generateRoomToken,
  toBase64Url,
} from "../src/core/adminkey";

describe("admin keys", () => {
  it("makes random 128-bit signing keys", () => {
    const a = generateAdminKey();
    expect(fromBase64Url(a)).toHaveLength(16);
    expect(generateAdminKey()).not.toBe(a);
  });

  it("derives a stable PIN verifier salted by the key", async () => {
    const ak = generateAdminKey();
    const pv = await derivePinVerifier("4821", ak);
    expect(pv).toBe(await derivePinVerifier("4821", ak));
    expect(pv).not.toBe(await derivePinVerifier("4822", ak));
    expect(pv).not.toBe(await derivePinVerifier("4821", generateAdminKey()));
  });
});

describe("base64url", () => {
  it("round-trips", () => {
    const bytes = Uint8Array.from([0, 1, 250, 255, 62, 63]);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
  });
});

describe("generateRoomToken", () => {
  it("makes 10 safe characters", () => {
    expect(generateRoomToken()).toMatch(/^[a-z2-9]{10}$/);
  });
});
