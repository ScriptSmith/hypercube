/**
 * Own signalling server addresses, shared by the landing page and the simulator. A `peer`
 * value is "public" or a server address whose `key` query parameter is the shared secret.
 * Pages store the address with their settings and the secret apart (see `credentials.ts`), so
 * the two are joined only when a frame URL is built.
 */

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Hosts only this machine can reach, so a phone can't use a server there. */
export const isLoopback = (hostname: string): boolean => LOOPBACK.has(hostname);

export interface PeerRules {
  /** Accept `ws://` on this machine, for a server run locally such as `wrangler dev`. */
  loopbackWs?: boolean;
}

/** The site is served over HTTPS, so a custom signalling server must be wss://. */
export const validatePeer = (value: string, rules: PeerRules = {}): string | null => {
  const text = value.trim();
  if (text === "") return "Enter the signalling server address.";
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return "Signalling address is not a valid URL.";
  }
  const loopbackWs = rules.loopbackWs === true && url.protocol === "ws:";
  if (url.protocol !== "wss:" && !loopbackWs) {
    return rules.loopbackWs
      ? "Use wss://, or ws:// on localhost."
      : "Signalling address must start with wss://.";
  }
  if (!url.hostname) return "Signalling address needs a host name.";
  if (loopbackWs && !isLoopback(url.hostname)) return "Use wss://, or ws:// on localhost.";
  // The address is saved with the settings and the secret apart, so it must stay out of the address.
  if (url.searchParams.has("key"))
    return "Put the secret in the shared secret field, not the address.";
  return null;
};

/**
 * The address with the shared secret as its `key` query parameter, which the runtime passes
 * to PeerJS. The secret is encoded inside the address here, and the whole value is encoded
 * again when it goes into a frame's URL.
 */
export const withPeerKey = (address: string, secret: string): string => {
  const text = address.trim();
  if (!secret) return text;
  try {
    const url = new URL(text);
    url.searchParams.set("key", secret);
    return url.href;
  } catch {
    return text;
  }
};

/** Split a `peer` value into the address to keep and the secret to hold apart. */
export const splitPeer = (value: string): { address: string; secret: string } => {
  const text = value.trim();
  try {
    const url = new URL(text);
    const secret = url.searchParams.get("key") ?? "";
    if (!url.searchParams.has("key")) return { address: text, secret };
    url.searchParams.delete("key");
    return { address: url.href, secret };
  } catch {
    return { address: text, secret: "" };
  }
};
