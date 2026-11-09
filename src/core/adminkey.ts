/**
 * Admin uses two values, both carried only in operator-made URLs:
 *
 * - `ak`, a random 128-bit key that signs and verifies admin commands. Signed messages travel
 *   through the room, so the signing key must be high-entropy: a key derived from a short
 *   PIN could be brute-forced offline from one captured envelope.
 * - `pv`, a PBKDF2 verifier of the operator's PIN, salted with `ak`. Frames check a typed PIN
 *   against it locally to unlock the admin UI. It never goes over the network.
 *
 * The PIN itself never appears in a URL. Only the operator's own pages remember it, in their
 * browser's storage (`src/pages/credentials.ts`).
 */
const ITERATIONS = 150_000;

export const toBase64Url = (bytes: Uint8Array): string => {
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const fromBase64Url = (text: string): Uint8Array => {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export const generateAdminKey = (): string =>
  toBase64Url(crypto.getRandomValues(new Uint8Array(16)));

export const derivePinVerifier = (pin: string, ak: string): Promise<string> =>
  pbkdf2(pin, `hypercube-pin:${ak}`);

const pbkdf2 = async (pin: string, salt: string): Promise<string> => {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: enc.encode(salt),
      iterations: ITERATIONS,
    },
    base,
    128,
  );
  return toBase64Url(new Uint8Array(bits));
};

/** Unguessable room token: 10 characters of lowercase base32. */
export const generateRoomToken = (): string => {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
};
