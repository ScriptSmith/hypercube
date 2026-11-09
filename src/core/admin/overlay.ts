import { listApps } from "../registry";
import type { Room } from "../types";
import { ensureStyles } from "../ui";
import type { AdminDeps } from "./deps";
import { createUnlockGesture, inCorner } from "./gesture";
import type { AdminLink } from "./link";
import { createPanel, type PanelHandle } from "./panel";
import { checkPin, createPinLock, createPinPad, type PinPad } from "./pin";
import { ensureAdminStyles } from "./style";

/** The unlocked panel locks itself after this long without a touch. */
export const PANEL_IDLE_MS = 60_000;

/** Venue px. */
const MARGIN = 30;
const FONT = 30;
const TARGET = 120;
const KEY_MIN = 140;
const KEY_MAX = 190;
/** A PIN pad is about this many keys tall, chrome included. */
const PAD_KEYS_TALL = 6.3;
const PANEL_MAX_WIDTH = 2200;
/** Wider than this, the pad and panel sit by the corner instead of in the middle. */
const CENTRE_BELOW = 1500;

export interface FrameUi {
  /** "idle", "pin" or "panel", for tests. */
  readonly mode: "idle" | "pin" | "panel";
  dispose(): void;
}

/**
 * Watches the stage for the unlock gesture without touching the app's input: capture-phase,
 * passive listeners that never stop or cancel anything. Then shows the PIN pad and the panel
 * inside the frame's reachable band.
 */
export const startFrameUi = (
  deps: AdminDeps,
  room: Room,
  link: AdminLink,
  ak: string,
  pv: string | null,
): FrameUi => {
  ensureStyles();
  ensureAdminStyles();
  const stage = deps.overlay.parentElement ?? deps.overlay;
  const gesture = createUnlockGesture();
  const lock = createPinLock();

  const box = document.createElement("div");
  box.className = "hca-box";
  box.style.cssText = "position:absolute;pointer-events:auto;display:none;";
  deps.overlay.append(box);

  let mode: FrameUi["mode"] = "idle";
  let pad: PinPad | null = null;
  let panel: PanelHandle | null = null;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  let idleTimer: ReturnType<typeof setInterval> | undefined;
  let activeAt = 0;
  let disposed = false;

  const toStage = (e: PointerEvent) => {
    const r = stage.getBoundingClientRect();
    const sx = r.width > 0 ? stage.offsetWidth / r.width : 1;
    const sy = r.height > 0 ? stage.offsetHeight / r.height : 1;
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  };

  const layout = () => {
    const f = deps.frame();
    const u = f.unit;
    const top = Math.min(Math.max(0, f.reachTop.adult), f.height);
    // On a pair, stay on the corner's side of the seam.
    const right = f.seams[0] ?? f.width;
    const region = {
      x: MARGIN * u,
      y: top + MARGIN * u,
      w: Math.max(0, right - 2 * MARGIN * u),
      h: Math.max(0, f.height - top - 2 * MARGIN * u),
    };
    const centre = region.w < CENTRE_BELOW * u;
    box.style.setProperty("--hca-font", `${FONT * u}px`);
    box.style.setProperty("--hca-target", `${TARGET * u}px`);
    if (mode === "pin") {
      const key = Math.min(KEY_MAX * u, Math.max(KEY_MIN * u, region.h / PAD_KEYS_TALL));
      box.style.setProperty("--hca-key", `${key}px`);
      const w = key * 3.5;
      const h = key * PAD_KEYS_TALL;
      const x = centre ? region.x + (region.w - w) / 2 : region.x;
      // Centred in the band, but never below the frame if the band is short.
      const y = Math.max(0, Math.min(region.y + (region.h - h) / 2, f.height - h - MARGIN * u));
      Object.assign(box.style, { left: `${x}px`, top: `${y}px`, width: "", height: "" });
    } else if (mode === "panel") {
      const w = Math.min(region.w, PANEL_MAX_WIDTH * u);
      const x = centre ? region.x + (region.w - w) / 2 : region.x;
      Object.assign(box.style, {
        left: `${x}px`,
        top: `${region.y}px`,
        width: `${w}px`,
        height: `${region.h}px`,
      });
    }
  };

  const close = () => {
    pad?.dispose();
    pad = null;
    panel?.dispose();
    panel = null;
    clearInterval(idleTimer);
    mode = "idle";
    box.style.display = "none";
    box.replaceChildren();
    gesture.reset();
  };

  const openPanel = () => {
    pad?.dispose();
    pad = null;
    mode = "panel";
    panel = createPanel({ mode: "frame", room, link, apps: listApps(), onLock: close });
    box.replaceChildren(panel.el);
    layout();
    activeAt = performance.now();
    idleTimer = setInterval(() => {
      if (performance.now() - activeAt > PANEL_IDLE_MS) close();
    }, 1000);
  };

  const openPad = () => {
    mode = "pin";
    pad = createPinPad({
      lock,
      check: (pin) => (pv ? checkPin(pin, ak, pv) : Promise.resolve(false)),
      onUnlock: openPanel,
      onClose: close,
      ...(pv
        ? {}
        : { unavailable: "This frame's address has no PIN check (pv). Use the admin page." }),
    });
    box.replaceChildren(pad.el);
    box.style.display = "block";
    layout();
  };

  const checkHold = () => {
    if (!disposed && mode === "idle" && gesture.check(performance.now())) openPad();
  };

  const onDown = (e: PointerEvent) => {
    if (mode !== "idle") return;
    const f = deps.frame();
    if (!f.touch) return;
    const p = toStage(e);
    gesture.down(e.pointerId, performance.now(), inCorner(p.x, p.y, f));
    const deadline = gesture.deadline();
    if (deadline === null) return;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(checkHold, Math.max(0, deadline - performance.now()) + 20);
  };

  const onMove = (e: PointerEvent) => {
    if (mode !== "idle" || gesture.deadline() === null) return;
    const p = toStage(e);
    if (!inCorner(p.x, p.y, deps.frame())) gesture.cancel(e.pointerId);
  };

  const onUp = (e: PointerEvent) => {
    if (mode !== "idle") return;
    gesture.up(e.pointerId, performance.now());
    if (gesture.deadline() === null) clearTimeout(holdTimer);
  };

  const onCancel = (e: PointerEvent) => {
    gesture.cancel(e.pointerId);
    if (gesture.deadline() === null) clearTimeout(holdTimer);
  };

  const onActivity = () => {
    activeAt = performance.now();
  };

  const listen = { capture: true, passive: true } as const;
  stage.addEventListener("pointerdown", onDown, listen);
  stage.addEventListener("pointermove", onMove, listen);
  stage.addEventListener("pointerup", onUp, listen);
  stage.addEventListener("pointercancel", onCancel, listen);
  box.addEventListener("pointerdown", onActivity, listen);
  box.addEventListener("wheel", onActivity, listen);
  box.addEventListener("scroll", onActivity, listen);
  const resize = new ResizeObserver(() => layout());
  resize.observe(stage);

  return {
    get mode() {
      return mode;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      close();
      clearTimeout(holdTimer);
      stage.removeEventListener("pointerdown", onDown, listen);
      stage.removeEventListener("pointermove", onMove, listen);
      stage.removeEventListener("pointerup", onUp, listen);
      stage.removeEventListener("pointercancel", onCancel, listen);
      resize.disconnect();
      box.remove();
    },
  };
};
