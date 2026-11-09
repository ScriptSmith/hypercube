import { hashSeed } from "../rng";
import { randomToken } from "./util";

/** Hub ids tried in order. See the comment at the top of hub.ts. */
export const HUB_SLOTS = 4;

/** PeerJS ids: alphanumerics, with single `-` or `_` allowed between them. */
const PEER_ID = /^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/;

export const isValidPeerId = (id: string): boolean => PEER_ID.test(id);

/**
 * Room tokens may hold any characters, so ids are built from a hash of the token rather than
 * the token itself. 96 bits keeps rooms on the public broker apart.
 */
export const roomNamespace = (token: string): string =>
  "hc" +
  ["a", "b", "c"]
    .map((salt) => hashSeed(`hypercube-room:${salt}:${token}`).toString(36).padStart(7, "0"))
    .join("");

export const hubId = (ns: string, slot: number): string => `${ns}-hub${slot}`;

export const memberId = (ns: string, random: () => number): string =>
  `${ns}-${randomToken(random, 12)}`;
