import type { PeerOptions } from "peerjs";
import type { Timing } from "./hub";

/**
 * ICE servers used with our own signalling server: public STUN only, so a pair that can't
 * connect directly fails rather than relaying through a third party's TURN server. Change it
 * here if a venue needs its own STUN or TURN.
 */
export const OWN_ICE: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

/** How the room should use one signalling setting. */
export interface Broker {
  /** PeerJS options, or null when the setting can't be used. */
  options: PeerOptions | null;
  /** Whether a taken id may still belong to a dead peer (Transport.stale). */
  stale: boolean;
  /** Room timing that differs from the defaults in hub.ts. */
  timing: Partial<Timing>;
}

/**
 * "public" (or empty) is the public PeerJS broker, used with PeerJS's defaults. Its ids outlive
 * dead peers, and it rate-limits new connections, so rejoins are spread out.
 *
 * A ws(s):// URL is our own PeerServer-compatible server. It frees an id within about a second
 * of its peer dying and answers at once for unknown ids, so ids are never stale and rejoins can
 * be quick. A `key` query parameter is passed as the PeerJS key, which the server checks as a
 * shared secret.
 */
export const brokerFor = (signalling: string, ice: RTCIceServer[] = OWN_ICE): Broker => {
  const base: PeerOptions = { debug: 0 };
  if (signalling === "" || signalling === "public") {
    return { options: base, stale: true, timing: {} };
  }
  const own: Broker = { options: null, stale: false, timing: { followDelay: [300, 1000] } };
  let url: URL;
  try {
    url = new URL(signalling);
  } catch {
    return own;
  }
  if (url.protocol !== "wss:" && url.protocol !== "ws:") return own;
  const secure = url.protocol === "wss:";
  const path = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  const key = url.searchParams.get("key");
  own.options = {
    ...base,
    host: url.hostname,
    port: url.port ? Number(url.port) : secure ? 443 : 80,
    path,
    secure,
    config: { iceServers: ice },
    ...(key ? { key } : {}),
  };
  return own;
};

/** PeerJS options for a signalling setting; null when it can't be used. */
export const peerOptions = (signalling: string): PeerOptions | null =>
  brokerFor(signalling).options;
