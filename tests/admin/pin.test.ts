// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPinLock,
  createPinPad,
  LOCK_MS,
  MAX_ATTEMPTS,
  PIN_IDLE_MS,
  type PinPad,
} from "../../src/core/admin/pin";

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
});

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("PIN lock", () => {
  it("locks for a minute after five wrong PINs", () => {
    const lock = createPinLock();
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) lock.fail();
    expect(lock.remaining()).toBe(1);
    expect(lock.lockedFor()).toBe(0);
    lock.fail();
    expect(lock.remaining()).toBe(0);
    expect(lock.lockedFor()).toBe(LOCK_MS);
    vi.advanceTimersByTime(LOCK_MS - 1000);
    expect(lock.lockedFor()).toBe(1000);
    // Failing while locked does not extend the lock.
    lock.fail();
    expect(lock.lockedFor()).toBe(1000);
    vi.advanceTimersByTime(1000);
    expect(lock.lockedFor()).toBe(0);
    expect(lock.remaining()).toBe(MAX_ATTEMPTS);
  });

  it("forgets wrong tries after a right one", () => {
    const lock = createPinLock();
    lock.fail();
    lock.fail();
    lock.succeed();
    expect(lock.remaining()).toBe(MAX_ATTEMPTS);
  });
});

describe("PIN pad", () => {
  let pad: PinPad;

  const keyEl = (label: string) => {
    const el = pad.el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    if (!el) throw new Error(`no key ${label}`);
    return el;
  };
  const enter = async (pin: string) => {
    for (const d of pin) keyEl(d).click();
    keyEl("Enter").click();
    await vi.advanceTimersByTimeAsync(0);
  };

  const make = (over: Partial<Parameters<typeof createPinPad>[0]> = {}) => {
    const opts = {
      lock: createPinLock(),
      check: vi.fn(async (pin: string) => pin === "4821"),
      onUnlock: vi.fn(),
      onClose: vi.fn(),
      ...over,
    };
    pad = createPinPad(opts);
    document.body.append(pad.el);
    return opts;
  };

  afterEach(() => pad.dispose());

  it("has big digit keys, delete and enter", () => {
    make();
    const labels = [...pad.el.querySelectorAll(".hca-key")].map((k) =>
      k.getAttribute("aria-label"),
    );
    expect(labels).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "Delete", "0", "Enter"]);
  });

  it("unlocks with the right PIN, and Delete removes a digit", async () => {
    const opts = make();
    keyEl("9").click();
    keyEl("Delete").click();
    await enter("4821");
    expect(opts.check).toHaveBeenCalledWith("4821");
    expect(opts.onUnlock).toHaveBeenCalledTimes(1);
  });

  it("locks the keys after five wrong PINs and opens them a minute later", async () => {
    const opts = make();
    for (let i = 0; i < 4; i++) await enter("1111");
    expect(pad.el.querySelector(".hca-pad-msg")?.textContent).toBe("Wrong PIN. 1 try left.");
    await enter("1111");
    expect(keyEl("4").disabled).toBe(true);
    expect(pad.el.querySelector(".hca-pad-msg")?.textContent).toBe("Too many tries. Wait 60 s.");
    // Locked keys ignore presses, so even the right PIN isn't checked.
    await enter("4821");
    expect(opts.check).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(LOCK_MS / 2);
    expect(pad.el.querySelector(".hca-pad-msg")?.textContent).toBe("Too many tries. Wait 30 s.");
    await vi.advanceTimersByTimeAsync(LOCK_MS / 2);
    expect(keyEl("4").disabled).toBe(false);
    await enter("4821");
    expect(opts.onUnlock).toHaveBeenCalledTimes(1);
  });

  it("keeps the lock across pads that share it", async () => {
    const lock = createPinLock();
    make({ lock });
    for (let i = 0; i < 5; i++) await enter("1111");
    pad.dispose();
    make({ lock });
    expect(keyEl("1").disabled).toBe(true);
  });

  it("closes after 15 s without a key press", async () => {
    const opts = make();
    await vi.advanceTimersByTimeAsync(PIN_IDLE_MS - 1000);
    keyEl("1").click();
    await vi.advanceTimersByTimeAsync(PIN_IDLE_MS - 1);
    expect(opts.onClose).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(opts.onClose).toHaveBeenCalledTimes(1);
  });

  it("never closes by itself when idleMs is 0, and takes keyboard digits", async () => {
    const opts = make({ idleMs: 0, keyboard: true, closable: false });
    await vi.advanceTimersByTimeAsync(10 * PIN_IDLE_MS);
    expect(opts.onClose).not.toHaveBeenCalled();
    for (const key of ["4", "8", "2", "1", "Enter"]) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key }));
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(opts.onUnlock).toHaveBeenCalledTimes(1);
    expect(pad.el.querySelector('button[aria-label="Close"]')).toBeNull();
  });
});
