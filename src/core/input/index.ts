import type { Input, Pointer, PointerPhase } from "../types";
import { createTouchEmulator } from "./emulator";

export { type BotHand, type BotTouch, createBotHand } from "./bot";

/**
 * A real touch with no events for this long is presumed stuck: touch frames sometimes lose
 * the lift. Long enough that a finger held still on a control is not cut off.
 */
export const STALE_TOUCH_MS = 20_000;
/** Injected pointer ids start here, well above the ids browsers give real pointers. */
export const SYNTHETIC_ID_BASE = 1_000_000;
/** Upper bound on tracked pointers; the least recently updated one is dropped beyond it. */
const MAX_POINTERS = 40;
/** Time constant of the velocity smoothing. */
const VELOCITY_TAU_MS = 40;
/** Moves closer together than this are folded into the next velocity sample. */
const MIN_SAMPLE_MS = 6;
const STALE_CHECK_MS = 1000;
/** A touch the browser no longer lists is dropped only if it has also been quiet this long. */
const RECONCILE_QUIET_MS = 500;
const RECT_CACHE_MS = 100;

export interface InputOptions {
  /** Turns on the mouse touch emulator. Never set outside `debug=1`. */
  debug?: boolean;
  /** Override for STALE_TOUCH_MS. */
  staleMs?: number;
}

export interface InputHandle extends Input {
  /** Fires on any person's touch in the page, including presses that controls swallow. */
  onActivity(cb: () => void): () => void;
  /** Client (viewport) coordinates to stage px, allowing for CSS scaling of the stage. */
  toStage(clientX: number, clientY: number): { x: number; y: number };
  /** True when the pointer was injected by a bot or test. */
  isSynthetic(id: number): boolean;
  /** Whether the debug touch emulator is running. */
  readonly emulating: boolean;
  dispose(): void;
}

interface Track {
  /** Real touches can be checked against the browser's touch list; injected ones cannot. */
  touch: boolean;
  injected: boolean;
  lastEvent: number;
  sampleX: number;
  sampleY: number;
  sampleTime: number;
}

interface Injected {
  x: number;
  y: number;
  target: Element;
  synthetic: boolean;
  time: number;
}

export const createInput = (root: HTMLElement, opts: InputOptions = {}): InputHandle => {
  const staleMs = opts.staleMs ?? STALE_TOUCH_MS;
  const pointers = new Map<number, Pointer>();
  const tracks = new Map<number, Track>();
  const injected = new Map<number, Injected>();
  const listeners: Record<PointerPhase, Set<(p: Pointer) => void>> = {
    down: new Set(),
    move: new Set(),
    up: new Set(),
    cancel: new Set(),
  };
  const activity = new Set<() => void>();
  let nextSyntheticId = SYNTHETIC_ID_BASE;
  let staleTimer = 0;
  let disposed = false;

  let cache: { t: number; left: number; top: number; sx: number; sy: number } | null = null;
  const mapping = () => {
    const now = performance.now();
    if (!cache || now - cache.t > RECT_CACHE_MS) {
      const r = root.getBoundingClientRect();
      const w = root.offsetWidth;
      const h = root.offsetHeight;
      cache = {
        t: now,
        left: r.left,
        top: r.top,
        sx: r.width > 0 && w > 0 ? w / r.width : 1,
        sy: r.height > 0 && h > 0 ? h / r.height : 1,
      };
    }
    return cache;
  };
  const toStage = (clientX: number, clientY: number) => {
    const m = mapping();
    return { x: (clientX - m.left) * m.sx, y: (clientY - m.top) * m.sy };
  };
  const toClient = (x: number, y: number) => {
    const m = mapping();
    return { x: m.left + x / m.sx, y: m.top + y / m.sy };
  };
  const invalidate = () => {
    cache = null;
  };

  const emit = (phase: PointerPhase, p: Pointer) => {
    for (const cb of listeners[phase]) {
      try {
        cb(p);
      } catch (err) {
        console.error("[input] listener failed", err);
      }
    }
  };

  const sample = (p: Pointer, t: Track, x: number, y: number, now: number) => {
    const dt = now - t.sampleTime;
    if (dt < MIN_SAMPLE_MS) return;
    const k = 1 - Math.exp(-dt / VELOCITY_TAU_MS);
    p.vx += (((x - t.sampleX) / dt) * 1000 - p.vx) * k;
    p.vy += (((y - t.sampleY) / dt) * 1000 - p.vy) * k;
    t.sampleX = x;
    t.sampleY = y;
    t.sampleTime = now;
  };

  const end = (id: number, phase: "up" | "cancel", at?: { x: number; y: number }) => {
    const p = pointers.get(id);
    const t = tracks.get(id);
    if (!p || !t) return;
    const now = performance.now();
    if (at) {
      sample(p, t, at.x, at.y, now);
      p.x = at.x;
      p.y = at.y;
    }
    // A finger that stopped before lifting should not report its last swipe speed.
    const quiet = now - t.sampleTime;
    if (quiet > MIN_SAMPLE_MS) {
      const decay = Math.exp(-quiet / VELOCITY_TAU_MS);
      p.vx *= decay;
      p.vy *= decay;
    }
    p.time = now;
    pointers.delete(id);
    tracks.delete(id);
    emit(phase, p);
    if (pointers.size === 0) stopStaleTimer();
  };

  const checkStale = () => {
    const now = performance.now();
    for (const [id, t] of tracks) {
      if (!t.injected && now - t.lastEvent > staleMs) end(id, "cancel");
    }
  };
  const startStaleTimer = () => {
    if (!staleTimer) staleTimer = window.setInterval(checkStale, STALE_CHECK_MS);
  };
  const stopStaleTimer = () => {
    clearInterval(staleTimer);
    staleTimer = 0;
  };

  // Bots keep playing for days; only people (and the debug emulator) hold off idle.
  const pokeActivity = (e: PointerEvent) => {
    if (injected.get(e.pointerId)?.synthetic) return;
    for (const cb of activity) cb();
  };

  const onDown = (e: PointerEvent) => {
    if (pointers.has(e.pointerId)) end(e.pointerId, "cancel");
    const { x, y } = toStage(e.clientX, e.clientY);
    const now = performance.now();
    const p: Pointer = {
      id: e.pointerId,
      x,
      y,
      startX: x,
      startY: y,
      startTime: now,
      time: now,
      vx: 0,
      vy: 0,
      synthetic: injected.get(e.pointerId)?.synthetic ?? false,
    };
    pointers.set(e.pointerId, p);
    const inj = injected.has(e.pointerId);
    tracks.set(e.pointerId, {
      touch: e.pointerType === "touch" && !inj,
      injected: inj,
      lastEvent: now,
      sampleX: x,
      sampleY: y,
      sampleTime: now,
    });
    if (pointers.size > MAX_POINTERS) {
      let oldest: number | null = null;
      let oldestTime = Infinity;
      for (const [id, t] of tracks) {
        if (t.lastEvent < oldestTime && id !== e.pointerId) {
          oldest = id;
          oldestTime = t.lastEvent;
        }
      }
      if (oldest !== null) end(oldest, "cancel");
    }
    startStaleTimer();
    emit("down", p);
  };

  const onMove = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId);
    const t = tracks.get(e.pointerId);
    if (!p || !t) return;
    // A mouse released outside the page never sends its up.
    if (e.pointerType === "mouse" && e.buttons === 0) {
      end(e.pointerId, "up");
      return;
    }
    const { x, y } = toStage(e.clientX, e.clientY);
    const now = performance.now();
    t.lastEvent = now;
    sample(p, t, x, y, now);
    p.x = x;
    p.y = y;
    p.time = now;
    emit("move", p);
  };

  const onUp = (e: PointerEvent) => end(e.pointerId, "up", toStage(e.clientX, e.clientY));
  const onCancel = (e: PointerEvent) => end(e.pointerId, "cancel");

  // Touches we track that the browser no longer lists lost their pointerup somewhere.
  const onTouchList = (e: TouchEvent) => {
    const now = performance.now();
    const real: [number, Track][] = [];
    for (const [id, t] of tracks) {
      if (t.touch) real.push([id, t]);
    }
    let excess = real.length - e.touches.length;
    if (excess <= 0) return;
    real.sort((a, b) => a[1].lastEvent - b[1].lastEvent);
    for (const [id, t] of real) {
      if (excess <= 0 || now - t.lastEvent < RECONCILE_QUIET_MS) break;
      end(id, "cancel");
      excess--;
    }
  };

  const onHidden = () => {
    if (document.visibilityState !== "hidden") return;
    for (const [id, t] of tracks) {
      if (!t.injected) end(id, "cancel");
    }
  };

  root.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  window.addEventListener("pointerdown", pokeActivity, true);
  window.addEventListener("pointermove", pokeActivity, true);
  window.addEventListener("touchstart", onTouchList, { passive: true });
  window.addEventListener("touchend", onTouchList, { passive: true });
  window.addEventListener("touchcancel", onTouchList, { passive: true });
  window.addEventListener("resize", invalidate);
  document.addEventListener("visibilitychange", onHidden);

  const fire = (type: string, id: number, x: number, y: number, target: Element) => {
    const c = toClient(x, y);
    const down = type !== "pointerup";
    target.dispatchEvent(
      new PointerEvent(type, {
        pointerId: id,
        pointerType: "touch",
        isPrimary: false,
        clientX: c.x,
        clientY: c.y,
        screenX: c.x,
        screenY: c.y,
        width: 20,
        height: 20,
        pressure: down ? 0.5 : 0,
        button: type === "pointermove" ? -1 : 0,
        buttons: down ? 1 : 0,
        bubbles: true,
        cancelable: true,
        composed: true,
      }),
    );
  };

  const hitTest = (x: number, y: number): Element => {
    const c = toClient(x, y);
    const el =
      typeof document.elementFromPoint === "function" ? document.elementFromPoint(c.x, c.y) : null;
    return el ?? root;
  };

  const injectDown = (x: number, y: number, synthetic: boolean): number => {
    if (disposed) return -1;
    const id = nextSyntheticId;
    nextSyntheticId = nextSyntheticId >= 2_000_000_000 ? SYNTHETIC_ID_BASE : nextSyntheticId + 1;
    const target = hitTest(x, y);
    injected.set(id, { x, y, target, synthetic, time: performance.now() });
    if (injected.size > MAX_POINTERS) {
      const [oldest] = [...injected.entries()].sort((a, b) => a[1].time - b[1].time);
      if (oldest && oldest[0] !== id) injectUp(oldest[0]);
    }
    fire("pointerdown", id, x, y, target);
    return id;
  };

  const injectMove = (id: number, x: number, y: number) => {
    const rec = injected.get(id);
    if (!rec || disposed) return;
    rec.x = x;
    rec.y = y;
    rec.time = performance.now();
    // Touches stay with the element they started on, as real ones do.
    if (!rec.target.isConnected) rec.target = hitTest(x, y);
    fire("pointermove", id, x, y, rec.target);
  };

  const injectUp = (id: number) => {
    const rec = injected.get(id);
    if (!rec) return;
    injected.delete(id);
    if (disposed) return;
    const target = rec.target.isConnected ? rec.target : hitTest(rec.x, rec.y);
    fire("pointerup", id, rec.x, rec.y, target);
  };

  const emulator = opts.debug
    ? createTouchEmulator(root, {
        down: (x, y) => injectDown(x, y, false),
        move: injectMove,
        up: injectUp,
        toStage,
      })
    : null;

  return {
    on(phase, cb) {
      listeners[phase].add(cb);
      return () => listeners[phase].delete(cb);
    },
    pointers,
    inject: {
      down: (x, y) => injectDown(x, y, true),
      move: injectMove,
      up: injectUp,
    },
    onActivity(cb) {
      activity.add(cb);
      return () => activity.delete(cb);
    },
    toStage,
    isSynthetic: (id) => injected.get(id)?.synthetic ?? pointers.get(id)?.synthetic ?? false,
    get emulating() {
      return emulator !== null;
    },
    dispose() {
      if (disposed) return;
      emulator?.dispose();
      disposed = true;
      stopStaleTimer();
      root.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("pointerdown", pokeActivity, true);
      window.removeEventListener("pointermove", pokeActivity, true);
      window.removeEventListener("touchstart", onTouchList);
      window.removeEventListener("touchend", onTouchList);
      window.removeEventListener("touchcancel", onTouchList);
      window.removeEventListener("resize", invalidate);
      document.removeEventListener("visibilitychange", onHidden);
      for (const set of Object.values(listeners)) set.clear();
      activity.clear();
      pointers.clear();
      tracks.clear();
      injected.clear();
    },
  };
};
