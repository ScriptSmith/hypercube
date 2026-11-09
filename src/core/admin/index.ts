import { createAgent } from "./agent";
import { type FrameConfig, OVERRIDE_KEY, readOverride } from "./config";
import type { AdminDeps, AdminHandle } from "./deps";
import { createLink } from "./link";
import { loadSeen, SEEN_KEY, sessionStore } from "./nonces";
import { type FrameUi, startFrameUi } from "./overlay";
import { importAdminKey } from "./sign";

export { type FrameConfig, OVERRIDE_KEY } from "./config";
export type { AdminDeps, AdminHandle } from "./deps";
export { type AdminLink, createLink } from "./link";
export { createPanel, type PanelHandle } from "./panel";
export { checkPin, createPinLock, createPinPad } from "./pin";
export { importAdminKey } from "./sign";
export { ensureAdminStyles } from "./style";
export { ADMIN_APP } from "./model";

export const loadOverride = (room: string | null, frame: string | null): FrameConfig | null => {
  if (!room || !frame) return null;
  return readOverride(sessionStore(), OVERRIDE_KEY(room, frame));
};

/**
 * Admin on a frame. It needs a room and the admin key from the URL; without either it does
 * nothing at all, so a frame without `ak` ignores every command and never shows the PIN pad.
 */
export const startAdmin = (deps: AdminDeps): AdminHandle => {
  const { room, ak, roomToken } = deps;
  if (!room || !ak || !roomToken) return { dispose() {} };
  if (!globalThis.isSecureContext || !globalThis.crypto?.subtle) {
    console.warn("[admin] admin needs HTTPS or localhost to check signatures, so it is off here");
    return { dispose() {} };
  }
  const key = importAdminKey(ak);
  const seen = { storage: sessionStore(), key: SEEN_KEY(roomToken, room.self) };
  const link = createLink(room, key, { seen: loadSeen(seen.storage, seen.key) });
  const agent = createAgent(deps, room, link, {
    storageKey: OVERRIDE_KEY(roomToken, room.self),
    seen,
  });
  let ui: FrameUi | null = null;
  let disposed = false;
  void key.then((k) => {
    if (disposed) return;
    if (!k) {
      console.warn("[admin] the admin key in the URL is not valid, so admin is off");
      return;
    }
    ui = startFrameUi(deps, room, link, ak, deps.pinVerifier);
  });
  return {
    dispose() {
      disposed = true;
      ui?.dispose();
      agent.dispose();
      link.dispose();
    },
  };
};
