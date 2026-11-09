import type { StorageLike } from "./config";

/**
 * Nonces of commands this frame has run, kept in sessionStorage so a reload doesn't forget them.
 * Without this, a captured `reload` could be replayed at a frame as it rejoins, within the skew
 * window. Commands are rare, so a short list is plenty.
 */
export const SEEN_KEY = (room: string, frame: string) => `hc:admin-seen:${room}:${frame}`;
const MAX_SEEN = 128;

export const sessionStore = (): StorageLike | null => {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
};

export const loadSeen = (storage: StorageLike | null, key: string): [string, number][] => {
  if (!storage) return [];
  try {
    const value: unknown = JSON.parse(storage.getItem(key) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (v): v is [string, number] =>
          Array.isArray(v) && typeof v[0] === "string" && typeof v[1] === "number",
      )
      .slice(-MAX_SEEN);
  } catch {
    return [];
  }
};

export const saveSeen = (storage: StorageLike | null, key: string, id: string, ts: number) => {
  if (!storage) return;
  try {
    const list = loadSeen(storage, key);
    list.push([id, ts]);
    storage.setItem(key, JSON.stringify(list.slice(-MAX_SEEN)));
  } catch {
    // Without storage the in-memory nonce set still covers this page load.
  }
};
