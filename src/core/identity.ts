import type { Params } from "./params";
import type { HostFrame, HostRole, Identity } from "./types";

/** The host's `frame-context` message (version 1). */
interface FrameContextMessage {
  type: "frame-context";
  version: 1;
  mode?: "show" | "preview";
  event?: { id?: string };
  frame?: HostFrame;
  zone?: { tagId?: string; label?: string; frames?: HostFrame[] };
}

const inIframe = (): boolean => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
};

const isFrameContext = (data: unknown): data is FrameContextMessage =>
  typeof data === "object" &&
  data !== null &&
  (data as { type?: unknown }).type === "frame-context" &&
  (data as { version?: unknown }).version === 1;

const fromParams = (params: Params): Identity => ({
  frame: params.frame,
  event: params.event ?? undefined,
  zone: params.zone ?? undefined,
  display: params.display ?? undefined,
  displays: params.displays ?? undefined,
  name: params.name ?? undefined,
  hostRole: params.hostRole ?? undefined,
  source: params.frame ? "params" : "none",
  mode: "show",
  siblings: [],
});

const merge = (base: Identity, msg: FrameContextMessage): Identity => {
  const f = msg.frame;
  return {
    frame: f?.frame ?? base.frame,
    event: msg.event?.id ?? base.event,
    zone: msg.zone?.tagId ?? base.zone,
    display: f?.displays[0]?.id ?? base.display,
    displays: f?.displays.map((d) => d.id) ?? base.displays,
    name: f?.displays[0]?.name ?? base.name,
    hostRole: (f?.role as HostRole | undefined) ?? base.hostRole,
    source: f ? "host" : base.source,
    mode: msg.mode ?? base.mode,
    siblings: msg.zone?.frames ?? base.siblings,
  };
};

const finalise = (identity: Identity, params: Params): Identity => {
  const preview =
    params.preview || params.mode === "preview" || params.unfilled || identity.frame === null;
  return { ...identity, mode: preview || identity.mode === "preview" ? "preview" : "show" };
};

/** The last host context for this URL survives a reload, so a late reply never costs a boot. */
const CACHE_KEY = () => `hc:frame-context:${location.pathname}${location.search}`;

const readCached = (): FrameContextMessage | null => {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY());
    const data: unknown = raw ? JSON.parse(raw) : null;
    return isFrameContext(data) ? data : null;
  } catch {
    return null;
  }
};

const writeCached = (msg: FrameContextMessage) => {
  try {
    sessionStorage.setItem(CACHE_KEY(), JSON.stringify(msg));
  } catch {
    // Storage can be unavailable; the next boot waits for the host again.
  }
};

/** True when two identities differ in a way that needs a fresh boot (room membership, kind, keys). */
export const identityChanged = (a: Identity, b: Identity): boolean =>
  a.frame !== b.frame ||
  a.mode !== b.mode ||
  a.zone !== b.zone ||
  a.hostRole !== b.hostRole ||
  (a.displays ?? []).join(",") !== (b.displays ?? []).join(",");

/**
 * Work out who this frame is. URL params are used straight away when they name the frame;
 * otherwise we use the cached host context or wait briefly for the host's `frame-context`.
 * Later context messages (siblings, corrections) are passed to `onUpdate`.
 */
export const resolveIdentity = (
  params: Params,
  onUpdate: (identity: Identity) => void,
  waitMs = 2500,
): Promise<Identity> => {
  let current = finalise(fromParams(params), params);
  if (!inIframe()) return Promise.resolve(current);

  const cached = readCached();
  if (cached) current = finalise(merge(current, cached), params);

  return new Promise((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      resolve(current);
    };

    window.addEventListener("message", (event) => {
      if (event.source !== window.parent || !isFrameContext(event.data)) return;
      writeCached(event.data);
      current = finalise(merge(current, event.data), params);
      if (settled) onUpdate(current);
      else settle();
    });

    try {
      window.parent.postMessage({ type: "frame-context-request" }, "*");
    } catch {
      // A detached or cross-origin parent can throw; URL params still apply.
    }

    // Previews never network, so they needn't wait for an identity.
    const preview = params.preview || params.unfilled || params.mode === "preview";
    if (current.frame !== null || preview) settle();
    else setTimeout(settle, waitMs);
  });
};
