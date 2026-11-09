import type { FrameInfo, Rect, StationSpec } from "../types";
import { type ButtonHandle, createButton } from "../ui/button";
import { iconElement } from "../ui/icons";
import { PALETTE, withAlpha } from "../ui/palette";
import { ensureStyles, FONT } from "../ui/style";
import type { Band, StationModel } from "./machine";

export type ResetCorner = NonNullable<StationSpec["resetCorner"]>;

/** Hold time of the reset control. */
export const RESET_HOLD_MS = 1000;
/** Buttons ignore presses this soon after they appear, so the finger that summoned them can't. */
const ARM_MS = 450;
/** Band handle touch target, in venue px. */
const HANDLE_HEIGHT = 136;
const HANDLE_WIDTH = 440;
/** Redo is deliberately smaller than Confirm, but still a full touch target. */
const REDO_SIZE = 130;

export const PROMPT_HIGH = "Touch the highest point you can reach";
export const PROMPT_LOW = "Touch the lowest point you can reach";

export interface StationViewOptions {
  layer: HTMLElement;
  rect: Rect;
  color: string;
  frame: () => FrameInfo;
  /** Which corner of the band the reset control sits in while playing. Redo uses its side. */
  resetCorner: ResetCorner;
  toStage(clientX: number, clientY: number): { x: number; y: number };
  /** A press on the overlay outside its controls (idle, calibrating, ready). */
  onPress(e: PointerEvent): void;
  /** A band handle dragged so its edge should sit at stage `y`. */
  onAdjust(edge: "top" | "bottom", y: number, e: PointerEvent): void;
  onConfirm(): void;
  onRedo(): void;
  onReset(): void;
}

export interface StationView {
  readonly el: HTMLElement;
  render(model: StationModel): void;
  /** Rebuild at the current frame size. */
  refresh(): void;
  dispose(): void;
}

interface AdjustParts {
  band: Band;
  box: HTMLElement;
  handles: Record<"top" | "bottom", HTMLElement>;
  confirm: ButtonHandle | null;
  confirmSize: number;
  redo: ButtonHandle | null;
}

interface Drag {
  id: number;
  edge: "top" | "bottom";
  offset: number;
  grip: HTMLElement;
}

export const createStationView = (opts: StationViewOptions): StationView => {
  ensureStyles();
  const { rect, color } = opts;
  const el = document.createElement("div");
  el.className = "hc-station";
  el.style.cssText =
    `position:absolute;left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;` +
    `height:${rect.height}px;overflow:hidden;touch-action:none;font-family:${FONT};`;
  opts.layer.append(el);

  const W = rect.width;
  const H = rect.height;
  const buttons = new Set<ButtonHandle>();
  let model: StationModel | null = null;
  let key = "";
  let adjust: AdjustParts | null = null;
  let drag: Drag | null = null;

  el.addEventListener("pointerdown", (e) => {
    if (!model || model.state === "playing") return;
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
    opts.onPress(e);
  });

  const unit = () => opts.frame().unit;

  const div = (x: number, y: number, w: number, h: number, css = "", cls = "") => {
    const d = document.createElement("div");
    if (cls) d.className = cls;
    d.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;${css}`;
    el.append(d);
    return d;
  };

  const ring = (cx: number, cy: number, d: number, width: number, delay = 0) =>
    div(
      cx - d / 2,
      cy - d / 2,
      d,
      d,
      `box-sizing:border-box;border-radius:50%;border:${width}px solid ${color};` +
        `animation-delay:${delay}s;pointer-events:none;`,
      "hc-anim-ripple",
    );

  const glow = (edge: "top" | "bottom", h: number) => {
    const dir = edge === "top" ? "to bottom" : "to top";
    div(
      0,
      edge === "top" ? 0 : H - h,
      W,
      h,
      `background:linear-gradient(${dir},${withAlpha(color, 0.55)},${withAlpha(color, 0)});`,
      "hc-anim-glow",
    );
  };

  const button = (b: ButtonHandle, before: Element | null = null) => {
    el.insertBefore(b.el, before);
    buttons.add(b);
    return b;
  };
  const drop = (b: ButtonHandle | null) => {
    if (!b) return;
    buttons.delete(b);
    b.dispose();
  };

  const promptSizes = () => {
    const u = unit();
    const arrow = Math.min(240 * u, W * 0.4, H * 0.24);
    const font = Math.max(12, Math.min(92 * u, W * 0.09));
    const gap = 26 * u;
    // Two lines of text is the usual case; leave room for a third on narrow stations.
    return { arrow, font, gap, height: arrow + gap * 2 + font * 1.12 * 2.6 + 30 * u };
  };

  /** Arrow, wrapped words and step dots as one column centred on `cy`. */
  const prompt = (dir: "up" | "down", words: string, step: 1 | 2, cy: number) => {
    const u = unit();
    const { arrow, font, gap } = promptSizes();
    const block = document.createElement("div");
    block.className = "hc-anim-fade-in";
    block.style.cssText =
      `position:absolute;left:${W * 0.06}px;width:${W * 0.88}px;top:${cy}px;` +
      "transform:translateY(-50%);display:flex;flex-direction:column;align-items:center;" +
      `gap:${gap}px;pointer-events:none;`;
    const arrowEl = document.createElement("div");
    arrowEl.className = dir === "up" ? "hc-anim-bob-up" : "hc-anim-bob-down";
    arrowEl.style.cssText = `width:${arrow}px;height:${arrow}px;color:${color};`;
    arrowEl.append(iconElement(dir, arrow));
    const text = document.createElement("div");
    text.textContent = words;
    text.style.cssText =
      `color:${PALETTE.foreground};font:800 ${font}px/1.12 ${FONT};text-align:center;` +
      `text-wrap:balance;overflow-wrap:break-word;max-width:100%;` +
      `text-shadow:0 0 ${font * 0.25}px #000,0 0 ${font * 0.08}px #000;`;
    const dots = document.createElement("div");
    dots.style.cssText = `display:flex;gap:${28 * u}px;`;
    for (let i = 1; i <= 2; i++) {
      const dot = document.createElement("div");
      const size = 30 * u;
      dot.style.cssText =
        `width:${size}px;height:${size}px;box-sizing:border-box;border-radius:50%;` +
        `border:${5 * u}px solid ${color};` +
        (i <= step ? `background:${color};` : "");
      dots.append(dot);
    }
    // On the way down the arrow points at the line below the words.
    block.append(...(dir === "up" ? [arrowEl, text, dots] : [text, dots, arrowEl]));
    el.append(block);
  };

  const bandBox = (band: Band, reveal: boolean) => {
    const u = unit();
    return div(
      W * 0.05,
      band.top - rect.y,
      W * 0.9,
      band.bottom - band.top,
      `box-sizing:border-box;border-radius:${48 * u}px;background:${withAlpha(color, 0.14)};` +
        `border:${Math.max(2, 6 * u)}px solid ${withAlpha(color, 0.85)};transform-origin:50% 50%;` +
        "pointer-events:none;",
      reveal ? "hc-anim-reveal" : "",
    );
  };

  const endDrag = () => {
    if (!drag) return;
    drag.grip.classList.remove("hc-pressed");
    drag = null;
    window.removeEventListener("pointermove", onDragMove, true);
    window.removeEventListener("pointerup", onDragEnd, true);
    window.removeEventListener("pointercancel", onDragEnd, true);
  };

  function onDragMove(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    opts.onAdjust(drag.edge, opts.toStage(e.clientX, e.clientY).y + drag.offset, e);
  }

  function onDragEnd(e: PointerEvent) {
    if (drag && e.pointerId === drag.id) endDrag();
  }

  const handle = (edge: "top" | "bottom") => {
    const u = unit();
    const h = div(
      0,
      0,
      Math.min(HANDLE_WIDTH * u, W * 0.62),
      HANDLE_HEIGHT * u,
      "display:flex;align-items:center;justify-content:center;pointer-events:auto;" +
        "touch-action:none;cursor:ns-resize;",
      "hc-handle",
    );
    h.dataset.edge = edge;
    const grip = document.createElement("div");
    grip.className = "hc-grip";
    grip.style.cssText =
      `width:100%;height:72%;border-radius:${HANDLE_HEIGHT * u}px;background:${color};` +
      `color:${PALETTE.background};display:flex;align-items:center;justify-content:center;` +
      `box-shadow:0 0 ${30 * u}px ${withAlpha(color, 0.5)};transition:transform 0.12s;`;
    grip.append(iconElement("updown", HANDLE_HEIGHT * u * 0.55));
    h.append(grip);
    h.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
      if (drag || !adjust) return;
      const y = opts.toStage(e.clientX, e.clientY).y;
      drag = { id: e.pointerId, edge, offset: adjust.band[edge] - y, grip };
      grip.style.transform = "scale(1.06)";
      window.addEventListener("pointermove", onDragMove, true);
      window.addEventListener("pointerup", onDragEnd, true);
      window.addEventListener("pointercancel", onDragEnd, true);
    });
    return h;
  };

  /** Positions the adjust step's parts for `band`, without rebuilding them. */
  const layoutAdjust = (parts: AdjustParts, band: Band) => {
    const u = unit();
    parts.band = band;
    const top = band.top - rect.y;
    const bottom = band.bottom - rect.y;
    parts.box.style.top = `${top}px`;
    parts.box.style.height = `${bottom - top}px`;
    const hh = HANDLE_HEIGHT * u;
    const hw = Math.min(HANDLE_WIDTH * u, W * 0.62);
    // Keep each handle's whole touch target inside the station, even at the rect's edge.
    const topY = Math.min(H - hh, Math.max(0, top - hh / 2));
    const bottomY = Math.min(H - hh, Math.max(0, bottom - hh / 2));
    for (const [h, y] of [
      [parts.handles.top, topY],
      [parts.handles.bottom, bottomY],
    ] as const) {
      h.style.left = `${(W - hw) / 2}px`;
      h.style.top = `${y}px`;
    }

    const redo = REDO_SIZE * u;
    const freeTop = topY + hh;
    const freeBottom = bottomY;
    const room = Math.max(0, freeBottom - freeTop - 16 * u);
    const s = Math.max(120 * u, Math.min(room, 260 * u, W * 0.45, W * 0.9 - 2 * (redo + 24 * u)));
    const cy = room >= 120 * u ? (freeTop + freeBottom) / 2 : (top + bottom) / 2;
    if (!parts.confirm || Math.abs(s - parts.confirmSize) > 2) {
      // Resized while a handle moves: the new one is live at once.
      const armDelay = parts.confirm ? 0 : ARM_MS;
      drop(parts.confirm);
      parts.confirm = button(
        createButton(
          {
            rect: { x: 0, y: 0, width: s, height: s },
            icon: "check",
            color,
            armDelay,
            onPress: opts.onConfirm,
          },
          u,
        ),
        parts.redo?.el ?? null,
      );
      parts.confirmSize = s;
      const halo = document.createElement("div");
      halo.className = "hc-anim-ripple";
      halo.style.cssText =
        "position:absolute;inset:0;box-sizing:border-box;border-radius:50%;pointer-events:none;" +
        `border:${Math.max(2, 8 * u)}px solid ${color};`;
      parts.confirm.el.append(halo);
    }
    parts.confirm.el.style.left = `${W / 2 - s / 2}px`;
    parts.confirm.el.style.top = `${cy - s / 2}px`;

    if (!parts.redo) {
      parts.redo = button(
        createButton(
          {
            rect: { x: 0, y: 0, width: redo, height: redo },
            icon: "reset",
            color,
            look: "ghost",
            armDelay: ARM_MS,
            onPress: opts.onRedo,
          },
          u,
        ),
      );
    }
    const left = opts.resetCorner.endsWith("left");
    const cx = left ? (W * 0.05 + (W / 2 - s / 2)) / 2 : (W * 0.95 + (W / 2 + s / 2)) / 2;
    parts.redo.el.style.left = `${cx - redo / 2}px`;
    parts.redo.el.style.top = `${cy - redo / 2}px`;
  };

  const build = (m: StationModel) => {
    endDrag();
    for (const b of buttons) b.dispose();
    buttons.clear();
    adjust = null;
    el.replaceChildren();
    const f = opts.frame();
    const u = f.unit;
    const playing = m.state === "playing";
    el.style.pointerEvents = playing ? "none" : "auto";
    el.style.background = playing
      ? "none"
      : m.state === "idle"
        ? withAlpha(color, 0.04)
        : withAlpha(PALETTE.background, 0.6);
    el.style.borderRadius = `${36 * u}px`;
    el.style.boxShadow = playing
      ? "none"
      : `inset 0 0 0 ${Math.max(1, 4 * u)}px ${withAlpha(color, m.state === "idle" ? 0.3 : 0.5)}`;

    if (m.state === "idle") {
      const reachTop = Math.min(H, Math.max(0, f.reachTop.adult - rect.y));
      const hintY = (reachTop + H) / 2;
      const d = Math.min(320 * u, W * 0.6, H * 0.4);
      ring(W / 2, hintY, d, Math.max(2, 6 * u));
      ring(W / 2, hintY, d, Math.max(2, 6 * u), 1.2);
      const pad = div(
        W / 2 - d / 2,
        hintY - d / 2,
        d,
        d,
        `box-sizing:border-box;border-radius:50%;background:${withAlpha(color, 0.16)};` +
          `border:${Math.max(2, 6 * u)}px solid ${color};color:${color};` +
          "display:flex;align-items:center;justify-content:center;",
        "hc-anim-pulse",
      );
      pad.append(iconElement("hand", d * 0.6));
      return;
    }

    if (m.state === "calibrating" && m.step === "top") {
      glow("top", Math.min(H * 0.25, 360 * u));
      const { height } = promptSizes();
      prompt("up", PROMPT_HIGH, 1, Math.max(height / 2 + 20 * u, H * 0.42));
      return;
    }

    if (m.state === "calibrating" && m.step === "bottom") {
      const markY = Math.min(H, Math.max(0, (m.mark ?? 0) - rect.y));
      const line = Math.max(2, 8 * u);
      div(
        W * 0.08,
        markY - line / 2,
        W * 0.84,
        line,
        `border-radius:${line}px;background:${color};box-shadow:0 0 ${20 * u}px ${color};`,
        "hc-anim-fade-in",
      );
      glow("bottom", Math.min(H * 0.25, 360 * u));
      const { height } = promptSizes();
      const margin = 50 * u;
      // Below the line when there is room, else above it (a first touch low on the panel).
      const cy =
        H - markY >= height + margin * 2
          ? Math.min(
              H - height / 2 - margin,
              Math.max(markY + margin + height / 2, (markY + H) / 2),
            )
          : Math.max(height / 2, markY - margin - height / 2);
      prompt("down", PROMPT_LOW, 2, cy);
      return;
    }

    if (m.state === "calibrating" && m.step === "adjust" && m.band) {
      const parts: AdjustParts = {
        band: m.band,
        box: bandBox(m.band, true),
        handles: { top: handle("top"), bottom: handle("bottom") },
        confirm: null,
        confirmSize: 0,
        redo: null,
      };
      adjust = parts;
      layoutAdjust(parts, m.band);
      return;
    }

    if (m.state === "ready" && m.band) {
      const top = m.band.top - rect.y;
      const h = m.band.bottom - m.band.top;
      bandBox(m.band, true);
      const s = Math.min(240 * u, h * 0.6, W * 0.45);
      ring(W / 2, top + h / 2, s, Math.max(2, 6 * u));
      const done = div(
        W / 2 - s / 2,
        top + h / 2 - s / 2,
        s,
        s,
        `box-sizing:border-box;border-radius:50%;background:${withAlpha(PALETTE.background, 0.7)};` +
          `border:${Math.max(2, 8 * u)}px solid ${color};color:${color};` +
          "display:flex;align-items:center;justify-content:center;",
        "hc-anim-fade-in",
      );
      done.append(iconElement("check", s * 0.56));
      return;
    }

    if (!playing || !m.band) return;
    // Playing: only the reset control stays, in a corner of the band.
    const top = m.band.top - rect.y;
    const h = m.band.bottom - m.band.top;
    const r = Math.max(120 * u, Math.min(150 * u, h * 0.3));
    const margin = 28 * u;
    const x = opts.resetCorner.endsWith("left") ? W * 0.05 + margin : W * 0.95 - margin - r;
    const y = opts.resetCorner.startsWith("top") ? top + margin : top + h - margin - r;
    const reset = button(
      createButton(
        {
          rect: { x, y, width: r, height: r },
          icon: "reset",
          color,
          look: "ghost",
          hold: RESET_HOLD_MS,
          onPress: opts.onReset,
        },
        u,
      ),
    );
    reset.el.style.opacity = "0.8";
  };

  const adjusting = (m: StationModel) => m.state === "calibrating" && m.step === "adjust";
  const keyOf = (m: StationModel) =>
    [m.state, m.step, m.mark, m.bot, adjusting(m) ? "" : `${m.band?.top}|${m.band?.bottom}`].join(
      "|",
    );

  return {
    el,
    render(next) {
      model = next;
      // Exposed for tests and the debug overlay.
      el.dataset.state = next.state;
      el.dataset.step = next.step ?? "";
      el.dataset.bot = String(next.bot);
      const k = keyOf(next);
      if (k !== key) {
        key = k;
        build(next);
      } else if (adjust && next.band) {
        layoutAdjust(adjust, next.band);
      }
    },
    refresh() {
      if (model) build(model);
    },
    dispose() {
      endDrag();
      for (const b of buttons) b.dispose();
      buttons.clear();
      el.remove();
    },
  };
};
