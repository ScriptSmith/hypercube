import { derivePinVerifier } from "../adminkey";
import { iconElement } from "../ui";

export const MAX_ATTEMPTS = 5;
export const LOCK_MS = 60_000;
/** The PIN pad closes after this long without a key press. */
export const PIN_IDLE_MS = 15_000;
export const PIN_MAX_LENGTH = 8;

/** Counts wrong PINs and locks entry for LOCK_MS after MAX_ATTEMPTS in a row. */
export interface PinLock {
  /** Ms until entry opens again; 0 when it is open now. */
  lockedFor(): number;
  /** Wrong attempts left before the lock. */
  remaining(): number;
  fail(): void;
  succeed(): void;
}

export const createPinLock = (now: () => number = Date.now): PinLock => {
  let failures = 0;
  let until = 0;
  const lockedFor = () => {
    if (until === 0) return 0;
    const left = until - now();
    if (left > 0) return left;
    until = 0;
    failures = 0;
    return 0;
  };
  return {
    lockedFor,
    remaining: () => (lockedFor() > 0 ? 0 : MAX_ATTEMPTS - failures),
    fail() {
      if (lockedFor() > 0) return;
      failures++;
      if (failures >= MAX_ATTEMPTS) until = now() + LOCK_MS;
    },
    succeed() {
      failures = 0;
      until = 0;
    },
  };
};

/** True when `pin` matches the PIN verifier made for this admin key. */
export const checkPin = async (pin: string, ak: string, pv: string): Promise<boolean> => {
  try {
    return (await derivePinVerifier(pin, ak)) === pv;
  } catch {
    return false;
  }
};

const BACKSPACE =
  '<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true" style="display:block">' +
  '<path d="M36 22H84V78H36L12 50Z" fill="none" stroke="currentColor" stroke-width="8" ' +
  'stroke-linejoin="round"/><path d="M50 38L70 62M70 38L50 62" fill="none" ' +
  'stroke="currentColor" stroke-width="8" stroke-linecap="round"/></svg>';

export interface PinPadOptions {
  lock: PinLock;
  check(pin: string): Promise<boolean>;
  onUnlock(): void;
  onClose(): void;
  /** Close after this long without a key press; 0 never closes. Default PIN_IDLE_MS. */
  idleMs?: number;
  /** Also take digits, Backspace, Enter and Escape from a keyboard (the /admin/ page). */
  keyboard?: boolean;
  /** Offer a close button. */
  closable?: boolean;
  /** Why this pad can't unlock anything; shown instead of taking a PIN. */
  unavailable?: string;
}

export interface PinPad {
  readonly el: HTMLElement;
  dispose(): void;
}

const make = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};

/** Digit keys, backspace and enter. Styled by the admin stylesheet; sizes come from CSS variables. */
export const createPinPad = (opts: PinPadOptions): PinPad => {
  const idleMs = opts.idleMs ?? PIN_IDLE_MS;
  const el = make("div", "hca hca-pad");
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Admin PIN");

  const head = make("div", "hca-pad-head");
  head.append(make("span", "hca-pad-title", "Admin PIN"));
  if (opts.closable !== false) {
    const close = make("button", "hca-btn hca-icon-btn");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.append(iconElement("close", "1.1em"));
    close.addEventListener("click", () => opts.onClose());
    head.append(close);
  }
  const dots = make("div", "hca-pad-dots");
  dots.setAttribute("aria-live", "polite");
  const msg = make("div", "hca-pad-msg");
  const keys = make("div", "hca-pad-keys");
  el.append(head, dots, msg, keys);

  let pin = "";
  let busy = false;
  let disposed = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let lockTimer: ReturnType<typeof setInterval> | undefined;

  const keyButtons: HTMLButtonElement[] = [];
  const key = (label: string, onPress: () => void, extra = "", content?: HTMLElement) => {
    const b = make("button", `hca-key ${extra}`.trim());
    b.type = "button";
    b.setAttribute("aria-label", label);
    if (content) b.append(content);
    else b.textContent = label;
    b.addEventListener("click", () => {
      poke();
      onPress();
    });
    keyButtons.push(b);
    keys.append(b);
  };

  const renderDots = () => {
    dots.replaceChildren();
    for (let i = 0; i < Math.max(4, pin.length); i++) {
      dots.append(make("span", i < pin.length ? "hca-dot is-on" : "hca-dot"));
    }
    dots.setAttribute("aria-label", `${pin.length} digits entered`);
  };

  const setMessage = (text: string, tone: "plain" | "bad" = "plain") => {
    msg.textContent = text;
    msg.dataset.tone = tone;
  };

  const renderLock = () => {
    if (opts.unavailable) {
      for (const b of keyButtons) b.disabled = true;
      setMessage(opts.unavailable, "bad");
      return true;
    }
    const left = opts.lock.lockedFor();
    const locked = left > 0;
    for (const b of keyButtons) b.disabled = locked || busy;
    if (locked) {
      setMessage(`Too many tries. Wait ${Math.ceil(left / 1000)} s.`, "bad");
      if (lockTimer === undefined) lockTimer = setInterval(renderLock, 1000);
    } else if (lockTimer !== undefined) {
      clearInterval(lockTimer);
      lockTimer = undefined;
      setMessage("");
    }
    return locked;
  };

  const poke = () => {
    clearTimeout(idleTimer);
    if (!(idleMs > 0 && idleMs < 2 ** 31)) return;
    idleTimer = setTimeout(() => {
      if (!disposed) opts.onClose();
    }, idleMs);
  };

  const press = (digit: string) => {
    if (busy || renderLock() || pin.length >= PIN_MAX_LENGTH) return;
    pin += digit;
    if (msg.dataset.tone === "bad") setMessage("");
    renderDots();
  };

  const back = () => {
    if (busy) return;
    pin = pin.slice(0, -1);
    renderDots();
  };

  const submit = () => {
    if (busy || renderLock() || pin.length === 0) return;
    const attempt = pin;
    pin = "";
    busy = true;
    renderLock();
    setMessage("Checking");
    void opts.check(attempt).then((ok) => {
      if (disposed) return;
      busy = false;
      renderDots();
      if (ok) {
        opts.lock.succeed();
        opts.onUnlock();
        return;
      }
      opts.lock.fail();
      el.classList.remove("is-wrong");
      void el.offsetWidth;
      el.classList.add("is-wrong");
      if (!renderLock()) {
        const left = opts.lock.remaining();
        setMessage(`Wrong PIN. ${left} ${left === 1 ? "try" : "tries"} left.`, "bad");
      }
      renderLock();
    });
  };

  for (const d of ["1", "2", "3", "4", "5", "6", "7", "8", "9"]) key(d, () => press(d));
  const backIcon = make("span", "hca-key-icon");
  backIcon.innerHTML = BACKSPACE;
  key("Delete", back, "is-quiet", backIcon);
  key("0", () => press("0"));
  const enterIcon = make("span", "hca-key-icon");
  enterIcon.append(iconElement("check", "100%"));
  key("Enter", submit, "is-go", enterIcon);

  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === "Backspace") back();
    else if (e.key === "Enter") submit();
    else if (e.key === "Escape" && opts.closable !== false) opts.onClose();
    else return;
    poke();
    e.preventDefault();
  };
  if (opts.keyboard) window.addEventListener("keydown", onKey);

  renderDots();
  renderLock();
  poke();

  return {
    el,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(idleTimer);
      clearInterval(lockTimer);
      if (opts.keyboard) window.removeEventListener("keydown", onKey);
      el.remove();
    },
  };
};
