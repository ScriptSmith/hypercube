import { FONT } from "../ui/style";

/** What the emulator needs from the input module. Coordinates are stage px. */
export interface EmulatorDeps {
  down(x: number, y: number): number;
  move(id: number, x: number, y: number): void;
  up(id: number): void;
  toStage(clientX: number, clientY: number): { x: number; y: number };
}

export interface TouchEmulator {
  /** Pinned touches by injected pointer id, in stage px. */
  readonly pins: ReadonlyMap<number, { x: number; y: number }>;
  releaseAll(): void;
  dispose(): void;
}

/** Marker radius in CSS px: the emulator is for a mouse on a laptop, not for venue scale. */
const PIN_RADIUS = 22;
/** Mouse travel (CSS px) below which a press on a pin counts as a click, which lifts it. */
const CLICK_SLOP = 4;
const MAX_PINS = 10;

interface Pin {
  id: number;
  x: number;
  y: number;
  el: HTMLElement;
}

/**
 * Debug only: lets a mouse hold several touches at once. Shift-click pins a touch that stays
 * down, dragging a pin moves it, clicking a pin lifts it, and Escape lifts them all. A plain
 * drag is an ordinary single touch. Pins are injected through the same path as bot touches,
 * but are flagged as human.
 */
export const createTouchEmulator = (root: HTMLElement, deps: EmulatorDeps): TouchEmulator => {
  const layer = document.createElement("div");
  layer.className = "hc-touch-emulator";
  layer.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:4;";
  root.append(layer);

  const legend = document.createElement("div");
  legend.textContent =
    "Debug touch: shift-click pins a touch, drag moves it, click lifts it, Esc lifts all";
  legend.style.cssText =
    "position:absolute;left:8px;bottom:8px;padding:4px 8px;border-radius:6px;" +
    `background:rgba(0,0,0,0.7);color:#fff;font:600 12px ${FONT};opacity:0.85;` +
    "transition:opacity 1s;";
  layer.append(legend);
  const legendTimer = window.setTimeout(() => {
    legend.style.opacity = "0";
  }, 8000);

  const pins = new Map<number, Pin>();
  let drag: { pin: Pin; startX: number; startY: number; moved: boolean; fresh: boolean } | null =
    null;
  let mouseId: number | null = null;

  const place = (pin: Pin) => {
    pin.el.style.left = `${pin.x - PIN_RADIUS}px`;
    pin.el.style.top = `${pin.y - PIN_RADIUS}px`;
  };

  const addPin = (x: number, y: number): Pin | null => {
    if (pins.size >= MAX_PINS) return null;
    const id = deps.down(x, y);
    if (id < 0) return null;
    const el = document.createElement("div");
    el.style.cssText =
      `position:absolute;width:${PIN_RADIUS * 2}px;height:${PIN_RADIUS * 2}px;` +
      "box-sizing:border-box;border-radius:50%;border:3px solid #fff;" +
      "background:rgba(255,255,255,0.25);box-shadow:0 0 0 2px rgba(0,0,0,0.6);" +
      `display:flex;align-items:center;justify-content:center;color:#fff;font:700 13px ${FONT};`;
    el.textContent = String(pins.size + 1);
    const pin = { id, x, y, el };
    place(pin);
    layer.append(el);
    pins.set(id, pin);
    return pin;
  };

  const removePin = (pin: Pin) => {
    pins.delete(pin.id);
    pin.el.remove();
    deps.up(pin.id);
  };

  const pinAt = (x: number, y: number): Pin | null => {
    let best: Pin | null = null;
    let bestD = PIN_RADIUS * 1.2;
    for (const pin of pins.values()) {
      const d = Math.hypot(pin.x - x, pin.y - y);
      if (d <= bestD) {
        best = pin;
        bestD = d;
      }
    }
    return best;
  };

  const swallow = (e: Event) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    const p = deps.toStage(e.clientX, e.clientY);
    const hit = pinAt(p.x, p.y);
    if (hit) {
      swallow(e);
      drag = { pin: hit, startX: e.clientX, startY: e.clientY, moved: false, fresh: false };
      mouseId = e.pointerId;
      return;
    }
    if (!e.shiftKey) return;
    swallow(e);
    const pin = addPin(p.x, p.y);
    if (!pin) return;
    drag = { pin, startX: e.clientX, startY: e.clientY, moved: false, fresh: true };
    mouseId = e.pointerId;
  };

  const onMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== mouseId) return;
    swallow(e);
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > CLICK_SLOP) {
      drag.moved = true;
    }
    if (!drag.moved) return;
    const p = deps.toStage(e.clientX, e.clientY);
    drag.pin.x = p.x;
    drag.pin.y = p.y;
    place(drag.pin);
    deps.move(drag.pin.id, p.x, p.y);
  };

  const onUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== mouseId) return;
    swallow(e);
    if (!drag.moved && !drag.fresh && pins.has(drag.pin.id)) removePin(drag.pin);
    drag = null;
    mouseId = null;
  };

  const releaseAll = () => {
    for (const pin of pins.values()) removePin(pin);
    drag = null;
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") releaseAll();
  };

  window.addEventListener("pointerdown", onDown, true);
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onUp, true);
  window.addEventListener("keydown", onKey);

  return {
    pins,
    releaseAll,
    dispose() {
      releaseAll();
      clearTimeout(legendTimer);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      window.removeEventListener("keydown", onKey);
      layer.remove();
    },
  };
};
