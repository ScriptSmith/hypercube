import type { RuntimeState } from "../../core/runtime";
import type { ScreenRect } from "./layout";
import type { SimFrame } from "./presets";

/** What the badge shows, read from the frame's `window.__hypercube`. */
export interface FrameStatus {
  loaded: boolean;
  phase: RuntimeState["phase"] | "loading" | "unloaded";
  app: string | null;
  room: RuntimeState["room"];
  hub: boolean;
  errors: number;
  lastError: string | null;
}

export interface FrameView {
  readonly frame: SimFrame;
  readonly el: HTMLElement;
  readonly iframe: HTMLIFrameElement;
  /** The URL now loaded, or null when unloaded. */
  readonly url: string | null;
  /** Position the frame, and its badge just outside it, above or below, so it covers nothing. */
  place(rect: ScreenRect, bezelPx: number, badgeAt: "above" | "below"): void;
  /** Load a URL, or unload with null and show `note`. Does nothing when unchanged. */
  load(url: string | null, note?: string): void;
  status(): FrameStatus;
  showStatus(s: FrameStatus): void;
  dispose(): void;
}

export interface FrameViewHandlers {
  focus(): void;
  qr(): void;
  /** Escape pressed inside the frame, where the sim page's own key listener can't hear it. */
  escape(): void;
}

/** Frame widths (page px) wide enough for the badge's detail text without crowding. */
const ROOMY_BELOW = 150;
const ROOMY_ABOVE = 520;

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export const readStatus = (iframe: HTMLIFrameElement, loaded: boolean): FrameStatus => {
  const empty: FrameStatus = {
    loaded,
    phase: loaded ? "loading" : "unloaded",
    app: null,
    room: "none",
    hub: false,
    errors: 0,
    lastError: null,
  };
  if (!loaded) return empty;
  try {
    const s = iframe.contentWindow?.__hypercube;
    if (!s) return empty;
    return {
      loaded,
      phase: s.phase,
      app: s.app,
      room: s.room,
      hub: s.net?.isHub ?? false,
      errors: s.errors.length,
      lastError: s.errors.at(-1) ?? null,
    };
  } catch {
    return empty;
  }
};

export const describeStatus = (s: FrameStatus): string => {
  if (!s.loaded) return "unloaded";
  const parts = [s.app ?? "?", s.phase, s.room === "none" ? "no room" : s.room];
  if (s.hub) parts.push("hub");
  if (s.errors > 0) parts.push(`${s.errors} error${s.errors === 1 ? "" : "s"}`);
  return parts.join(" · ");
};

const phaseTone = (s: FrameStatus): string =>
  s.phase === "running"
    ? "good"
    : s.phase === "error"
      ? "bad"
      : s.phase === "unloaded"
        ? "off"
        : "wait";

const roomTone = (s: FrameStatus): string =>
  s.room === "online" ? "good" : s.room === "connecting" ? "wait" : "off";

export const createFrameView = (
  frame: SimFrame,
  parent: HTMLElement,
  handlers: FrameViewHandlers,
  signal: AbortSignal,
): FrameView => {
  const root = el("div", "sim-frame");
  root.dataset.frame = frame.id;
  root.dataset.kind = frame.kind;

  const iframe = el("iframe", "");
  iframe.width = String(frame.width);
  iframe.height = String(frame.height);
  iframe.style.width = `${frame.width}px`;
  iframe.style.height = `${frame.height}px`;
  // The host embeds frames with this sandbox, so the sim does too.
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
  iframe.title = frame.name;

  const overlays: HTMLElement[] = [];
  for (let i = 1; i < frame.span; i++) {
    const seam = el("div", "sim-seam");
    seam.style.left = `${(i / frame.span) * 100}%`;
    overlays.push(seam);
  }
  const reach = frame.reach;
  if (reach) {
    for (const who of ["adult", "child"] as const) {
      const line = el("div", `sim-reach sim-reach-${who}`);
      line.style.top = `${(1 - reach[who]) * 100}%`;
      line.append(el("span", "", who));
      overlays.push(line);
    }
  }

  const note = el("div", "sim-note");
  note.hidden = true;

  const badge = el("div", "sim-badge");
  badge.dataset.frame = frame.id;
  const main = el("button", "sim-badge-main");
  main.type = "button";
  main.title = `Focus ${frame.name}`;
  const label = el("b", "", frame.short);
  const phaseDot = el("i", "sim-dot");
  const roomDot = el("i", "sim-dot");
  const hub = el("span", "sim-hub", "hub");
  hub.hidden = true;
  const errs = el("span", "sim-errs");
  errs.hidden = true;
  const detail = el("span", "sim-detail");
  main.append(label, phaseDot, roomDot, hub, errs, detail);
  const qr = el("button", "sim-badge-qr", "QR");
  qr.type = "button";
  qr.title = `Open ${frame.name} on a phone`;
  badge.append(main, qr);

  root.append(iframe, ...overlays, note);
  parent.append(root, badge);

  main.addEventListener("click", () => handlers.focus(), { signal });
  qr.addEventListener("click", () => handlers.qr(), { signal });
  iframe.addEventListener(
    "load",
    () => {
      try {
        iframe.contentWindow?.addEventListener("keydown", (e) => {
          if (e.key === "Escape") handlers.escape();
        });
      } catch {
        // Only a cross-origin page would refuse this; the back button still works then.
      }
    },
    { signal },
  );

  let url: string | null = null;
  let lastText = "";

  return {
    frame,
    el: root,
    iframe,
    get url() {
      return url;
    },
    place(rect, bezelPx, badgeAt) {
      root.style.left = `${rect.left}px`;
      root.style.top = `${rect.top}px`;
      root.style.width = `${rect.width}px`;
      root.style.height = `${rect.height}px`;
      root.style.setProperty("--bezel", `${bezelPx}px`);
      iframe.style.transform = `scale(${rect.scale})`;
      badge.dataset.at = badgeAt;
      // An above badge is anchored by its right edge, so it can't run out of room to the right.
      if (badgeAt === "above") {
        badge.style.left = "auto";
        badge.style.right = `${parent.clientWidth - rect.left - rect.width}px`;
        badge.style.top = `${rect.top - 3}px`;
      } else {
        badge.style.left = `${rect.left}px`;
        badge.style.right = "auto";
        badge.style.top = `${rect.top + rect.height + 3}px`;
      }
      badge.style.maxWidth = `${Math.max(56, rect.width)}px`;
      const roomy = rect.width >= (badgeAt === "above" ? ROOMY_ABOVE : ROOMY_BELOW);
      badge.classList.toggle("is-roomy", roomy);
    },
    load(next, text = "Unloaded") {
      note.hidden = next !== null;
      note.textContent = text;
      if (next === url) return;
      url = next;
      iframe.src = next ?? "about:blank";
      lastText = "";
    },
    status: () => readStatus(iframe, url !== null),
    showStatus(s) {
      const text = describeStatus(s);
      if (text === lastText) return;
      lastText = text;
      phaseDot.dataset.tone = phaseTone(s);
      roomDot.dataset.tone = roomTone(s);
      hub.hidden = !s.hub;
      errs.hidden = s.errors === 0;
      errs.textContent = `${s.errors}!`;
      detail.textContent = s.loaded ? `${s.app ?? "?"} · ${s.phase} · ${s.room}` : "unloaded";
      main.title = `${frame.name}: ${text}${s.lastError ? `\nLast error: ${s.lastError}` : ""}`;
    },
    dispose() {
      url = null;
      root.remove();
      badge.remove();
    },
  };
};
