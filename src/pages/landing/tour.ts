import { h } from "./dom";

/**
 * A guided tour over the live page: it dims everything but one element, and a note beside it
 * says what that element is for. The page stays usable underneath, so the operator works the
 * real controls as the tour goes.
 */
export interface TourStep {
  /**
   * Runs as the step opens, before the tour goes to its address: the guide changes settings
   * here to show them off. Returning false skips the step.
   */
  enter?(): boolean | void;
  /** The address the step happens at, if it needs one; the tour goes there first. */
  hash?(): string;
  /** The element to point out. A step whose element never turns up is skipped. */
  target(): Element | null;
  title: string;
  text: string;
  /** The tour moves on by itself once this holds, as when the operator picks a card. */
  doneWhen?(): boolean;
  /** What Next does on this step instead of just moving on, such as opening a tab. */
  next?(): void;
}

export interface Tour {
  readonly open: boolean;
  start(): void;
  stop(): void;
}

const PAD = 8;
const GAP = 14;
const EDGE = 12;
/** Height of the sticky top bar, which the spotlight and note keep clear of. */
const TOP = 56;
/** How long to wait for a step's element after moving, for routes and re-renders. */
const FIND_MS = 1500;
const POLL_MS = 50;

const sameHash = (a: string, b: string): boolean =>
  a.replace(/^#\/?/, "") === b.replace(/^#\/?/, "");

const smooth = (): ScrollBehavior =>
  globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

export const createTour = (
  steps: readonly TourStep[],
  opts: { /** The tour ended, finished or not. */ onStop?(): void } = {},
): Tour => {
  let open = false;
  let index = 0;
  let current: Element | null = null;
  let seq = 0;
  let watch = 0;
  let frame = 0;

  const spot = h("div", { class: "tour-spot", "aria-hidden": "true" });
  const count = h("p", { class: "tour-count" });
  const title = h("h2", { class: "tour-title", id: "tour-title" });
  const text = h("p", { class: "tour-text" });
  const back = h("button", { type: "button", class: "btn-quiet", onclick: () => go(-1) }, "Back");
  const next = h(
    "button",
    { type: "button", class: "btn-primary", onclick: () => advance() },
    "Next",
  );
  const close = h(
    "button",
    { type: "button", class: "tour-close", "aria-label": "End the guide", onclick: () => stop() },
    "×",
  );
  const arrow = h("span", { class: "tour-arrow", "aria-hidden": "true" });
  const tip = h(
    "section",
    { class: "tour-tip", role: "dialog", "aria-labelledby": "tour-title", "aria-live": "polite" },
    arrow,
    h("header", { class: "tour-head" }, count, close),
    title,
    text,
    h("footer", { class: "tour-foot" }, back, h("span", { class: "tour-gap" }), next),
  );

  /** Put the spotlight round the element and the note beside it, inside the window. */
  const place = () => {
    frame = 0;
    if (!open) return;
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    if (!current || !current.isConnected) {
      spot.hidden = true;
      arrow.hidden = true;
      tip.style.left = `${Math.max(EDGE, (vw - tw) / 2)}px`;
      tip.style.top = `${Math.max(TOP, vh - th - EDGE)}px`;
      return;
    }
    const r = current.getBoundingClientRect();
    spot.hidden = false;
    spot.style.left = `${r.left - PAD}px`;
    spot.style.top = `${r.top - PAD}px`;
    spot.style.width = `${r.width + 2 * PAD}px`;
    spot.style.height = `${r.height + 2 * PAD}px`;

    const below = vh - (r.bottom + PAD + GAP);
    const above = r.top - PAD - GAP - TOP;
    const right = vw - (r.right + PAD + GAP);
    let left: number;
    let top: number;
    let side: "top" | "bottom" | "left" | "none";
    if (below >= th + EDGE) {
      side = "top";
      top = r.bottom + PAD + GAP;
      left = r.left;
    } else if (above >= th + EDGE) {
      side = "bottom";
      top = r.top - PAD - GAP - th;
      left = r.left;
    } else if (right >= tw + EDGE) {
      side = "left";
      left = r.right + PAD + GAP;
      top = Math.max(r.top, TOP + EDGE);
    } else {
      side = "none";
      left = vw - tw - EDGE;
      top = vh - th - EDGE;
    }
    left = Math.min(Math.max(EDGE, left), Math.max(EDGE, vw - tw - EDGE));
    top = Math.min(Math.max(TOP, top), Math.max(TOP, vh - th - EDGE));
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    arrow.hidden = side === "none";
    arrow.dataset.side = side;
    if (side === "left") {
      const y = Math.min(Math.max(r.top + Math.min(r.height / 2, 40) - top, 18), th - 18);
      arrow.style.left = "";
      arrow.style.top = `${y}px`;
    } else {
      const x = Math.min(Math.max(r.left + Math.min(r.width / 2, 60) - left, 18), tw - 18);
      arrow.style.top = "";
      arrow.style.left = `${x}px`;
    }
  };

  const schedule = () => {
    if (frame || !open) return;
    frame =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(place)
        : window.setTimeout(place, 0);
  };

  /** Bring the element into view below the top bar, keeping room for the note if it can. */
  const reveal = (el: Element) => {
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    if (r.top >= TOP + PAD && r.bottom <= vh - PAD) return;
    const room = vh - TOP;
    const offset = r.height + 2 * PAD > room ? TOP + PAD * 2 : TOP + (room - r.height) / 2;
    window.scrollTo({ top: window.scrollY + r.top - offset, behavior: smooth() });
  };

  const render = () => {
    const step = steps[index]!;
    count.textContent = `${index + 1} of ${steps.length}`;
    title.textContent = step.title;
    text.textContent = step.text;
    back.hidden = index === 0;
    next.textContent = index === steps.length - 1 ? "Done" : "Next";
  };

  /** Show step `i`, going to its address first and skipping it if its element never appears. */
  const show = (i: number, dir: 1 | -1) => {
    if (i < 0 || i >= steps.length) {
      stop();
      return;
    }
    const my = ++seq;
    index = i;
    const step = steps[i]!;
    if (step.enter?.() === false) {
      show(i + dir, dir);
      return;
    }
    const hash = step.hash?.();
    if (hash !== undefined && !sameHash(location.hash, hash)) location.hash = hash;
    render();
    const started = Date.now();
    const find = () => {
      if (my !== seq || !open) return;
      const el = step.target();
      if (el) {
        current = el;
        reveal(el);
        schedule();
        next.focus({ preventScroll: true });
        return;
      }
      if (Date.now() - started < FIND_MS) window.setTimeout(find, POLL_MS);
      else show(i + dir, dir);
    };
    current = null;
    find();
  };

  const go = (dir: 1 | -1) => show(index + dir, dir);

  const advance = () => {
    const step = steps[index]!;
    if (step.next) step.next();
    go(1);
  };

  /** Follow re-renders and the operator's own moves: a done step moves on by itself. */
  const tick = () => {
    if (!open) return;
    // Something took the tour off the page (a test, or a page that replaced its body).
    if (!tip.isConnected) {
      stop();
      return;
    }
    const step = steps[index]!;
    if (step.doneWhen?.()) {
      go(1);
      return;
    }
    const el = step.target();
    if (el && el !== current) current = el;
    schedule();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") stop();
  };

  const stop = () => {
    if (!open) return;
    open = false;
    seq++;
    window.clearInterval(watch);
    window.removeEventListener("scroll", schedule, true);
    window.removeEventListener("resize", schedule);
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("hashchange", tick);
    spot.remove();
    tip.remove();
    document.documentElement.classList.remove("is-touring");
    opts.onStop?.();
  };

  return {
    get open() {
      return open;
    },
    start() {
      if (!open) {
        open = true;
        document.body.append(spot, tip);
        document.documentElement.classList.add("is-touring");
        window.addEventListener("scroll", schedule, true);
        window.addEventListener("resize", schedule);
        window.addEventListener("keydown", onKey);
        window.addEventListener("hashchange", tick);
        watch = window.setInterval(tick, 250);
      }
      show(0, 1);
    },
    stop,
  };
};
