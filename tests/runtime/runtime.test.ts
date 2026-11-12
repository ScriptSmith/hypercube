// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Params } from "../../src/core/params";
import type { HostFrame, Identity, SetupInfo } from "../../src/core/types";

type Deferred<T> = { promise: Promise<T>; resolve(v: T): void; reject(e: unknown): void };
const deferred = <T>(): Deferred<T> => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const h = vi.hoisted(() => ({
  loaders: new Map<string, () => Promise<unknown>>(),
  admin: null as null | { applyOverride(c: unknown): void },
  hostUpdate: null as null | ((identity: Identity) => void),
  stored: null as null | Record<string, unknown>,
}));

// jsdom isn't an iframe, so no host ever answers; tests deliver a late `frame-context` by hand.
vi.mock("../../src/core/identity", async (importActual) => {
  const actual = await importActual<typeof import("../../src/core/identity")>();
  return {
    ...actual,
    resolveIdentity: (params: Params, onUpdate: (identity: Identity) => void) => {
      h.hostUpdate = onUpdate;
      return actual.resolveIdentity(params, () => {});
    },
  };
});

vi.mock("../../src/core/registry", () => ({
  getManifest: (id: string) =>
    id === "poll"
      ? {
          id,
          title: id,
          setups: ["solo"],
          options: [
            { type: "text", key: "ask", title: "Question", maxLength: 12, default: "" },
            { type: "number", key: "n", title: "N", min: 1, max: 5, step: 1, default: 2 },
            {
              type: "enum",
              key: "mode",
              title: "Mode",
              values: [{ id: "a", title: "A" }],
              default: "a",
            },
          ],
        }
      : ["a", "b", "idle"].includes(id)
        ? { id, title: id, setups: ["solo"] }
        : undefined,
  listApps: () => [],
  loadApp: (id: string) => {
    const l = h.loaders.get(id);
    if (!l) throw new Error(`no loader ${id}`);
    return l();
  },
}));

vi.mock("../../src/core/admin", () => ({
  loadOverride: () => h.stored,
  startAdmin: (deps: { applyOverride(c: unknown): void }) => {
    h.admin = deps;
    return { dispose() {} };
  },
}));

const simpleApp = (counter?: { resets: number }) => ({
  mount: () => ({
    reset() {
      if (counter) counter.resets++;
    },
    dispose() {},
  }),
});

beforeEach(() => {
  vi.resetModules();
  h.loaders.clear();
  h.admin = null;
  h.hostUpdate = null;
  h.stored = null;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  window.history.replaceState({}, "", "/play/?app=a");
  let raf = 0;
  const frames = new Map<number, ReturnType<typeof setTimeout>>();
  (window as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = (
    cb: (t: number) => void,
  ) => {
    const id = ++raf;
    frames.set(
      id,
      setTimeout(() => cb(performance.now()), 16),
    );
    return id;
  };
  (window as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame = (id: number) => {
    clearTimeout(frames.get(id));
    frames.delete(id);
  };
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame =
    window.requestAnimationFrame;
  (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame =
    window.cancelAnimationFrame;
  document.body.replaceChildren();
});
afterEach(() => {
  vi.useRealTimers();
});

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

test("a load failure for a superseded mount leaves the newer app running", async () => {
  const loadA = deferred<unknown>();
  h.loaders.set("a", () => loadA.promise);
  h.loaders.set("b", async () => simpleApp());
  h.loaders.set("idle", async () => simpleApp());
  const { boot } = await import("../../src/core/runtime");
  void boot(document.body);
  await flush();
  // Operator switches to b while a's chunk is still loading.
  h.admin!.applyOverride({ app: "b" });
  await flush();
  expect(window.__hypercube!.app).toBe("b");
  // a's chunk then fails (network blip, or a redeploy removed the old hashed chunk).
  loadA.reject(new Error("Failed to fetch dynamically imported module"));
  await flush();
  await flush();
  expect(window.__hypercube!.app).toBe("b");
});

test("an async mount superseded mid-flight can't leak loops or dispose callbacks", async () => {
  const gate = deferred<void>();
  let ticks = 0;
  let onDisposeRan = false;
  let instanceDisposed = false;
  h.loaders.set("a", async () => ({
    mount: async (ctx: {
      loop(s: { update(dt: number): void }): { start(): void };
      onDispose(cb: () => void): void;
    }) => {
      await gate.promise; // e.g. loading textures or compiling shaders
      ctx.loop({ update: () => ticks++ }).start();
      ctx.onDispose(() => {
        onDisposeRan = true;
      });
      return {
        reset() {},
        dispose() {
          instanceDisposed = true;
        },
      };
    },
  }));
  h.loaders.set("b", async () => simpleApp());
  const { boot } = await import("../../src/core/runtime");
  void boot(document.body);
  await flush();
  h.admin!.applyOverride({ app: "b" });
  await flush();
  gate.resolve();
  await flush();
  expect(instanceDisposed).toBe(true);
  const before = ticks;
  await new Promise((r) => setTimeout(r, 300));
  expect(ticks).toBe(before);
  expect(onDisposeRan).toBe(true);
});

test("a frame nobody touches still reloads after its uptime limit", async () => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"],
  });
  const w = window as unknown as Record<string, unknown>;
  const g = globalThis as unknown as Record<string, unknown>;
  for (const k of ["setTimeout", "clearTimeout", "setInterval", "clearInterval"]) w[k] = g[k];
  h.loaders.set("a", async () => simpleApp());
  // jsdom reports location.reload() as an unimplemented navigation through console.error.
  const errors: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
  const spyErr = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
    errors.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);
  const { boot } = await import("../../src/core/runtime");
  void boot(document.body);
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(11 * 60 * 60 * 1000);
  const early = errors.filter((e) => /navigation/i.test(e)).length;
  await vi.advanceTimersByTimeAsync(2.5 * 60 * 60 * 1000);
  const late = errors.filter((e) => /navigation/i.test(e)).length;
  spy.mockRestore();
  spyErr.mockRestore();
  expect(early).toBe(0);
  expect(late).toBeGreaterThan(0);
}, 60_000);

test("options from an override are checked against the app's schema before it mounts", async () => {
  window.history.replaceState({}, "", "/play/?app=poll&o.ask=From%20the%20URL&o.n=4");
  const seen: unknown[] = [];
  h.loaders.set("poll", async () => ({
    mount: (ctx: { options: unknown }) => {
      seen.push(ctx.options);
      return { reset() {}, dispose() {} };
    },
  }));
  const { boot } = await import("../../src/core/runtime");
  void boot(document.body);
  await flush();
  // URL text is ignored; other URL options still apply.
  expect(seen[0]).toEqual({ ask: "", n: 4, mode: "a" });
  h.admin!.applyOverride({
    app: "poll",
    options: { ask: "Which\npet is best?", n: 99, mode: "zzz", extra: true },
  });
  await flush();
  expect(seen[1]).toEqual({ ask: "Which pet is", n: 5, mode: "a" });
  expect(window.__hypercube!.options).toEqual(seen[1]);
});

test("a preview ignores an override stored for its room and frame", async () => {
  window.history.replaceState({}, "", "/play/?app=a&frame=wall&room=r1&preview=1");
  // Left by an earlier frame with the same room and frame id, which admin set to b.
  h.stored = { app: "b" };
  h.loaders.set("a", async () => simpleApp());
  h.loaders.set("b", async () => simpleApp());
  const { boot } = await import("../../src/core/runtime");
  void boot(document.body);
  await flush();
  expect(window.__hypercube!.app).toBe("a");
});

const hostFrame = (
  n: number,
  role: HostFrame["role"],
  index: number,
  count: number,
): HostFrame => ({
  frame: `za:d${n}:r0`,
  displays: [{ id: String(n), name: `D-${n}` }],
  role,
  index,
  count,
  width: role === "PRESENTATION" ? 4000 : 1080,
  height: role === "PRESENTATION" ? 3600 : 1920,
});

const zone = [
  hostFrame(1, "PRESENTATION", 0, 1),
  hostFrame(2, "TOUCHSCREEN", 0, 3),
  hostFrame(3, "TOUCHSCREEN", 1, 3),
  hostFrame(4, "TOUCHSCREEN", 2, 3),
];

const recordMounts = () => {
  const mounts: { setup: SetupInfo; ctx: { identity: Identity } }[] = [];
  h.loaders.set("a", async () => ({
    mount: (ctx: { setup: SetupInfo; identity: Identity }) => {
      mounts.push({ setup: ctx.setup, ctx });
      return { reset() {}, dispose() {} };
    },
  }));
  return mounts;
};

test("a screen remounts when a late frame-context gives it the bank's size", async () => {
  window.history.replaceState(
    {},
    "",
    "/play/?app=a&setup=bank&frame=za:d1:r0&zone=a&display=1&hostrole=PRESENTATION&pos=0&count=1",
  );
  const mounts = recordMounts();
  const { boot } = await import("../../src/core/runtime");
  void boot(document.body);
  await flush();
  // The URL counts screens, so before the host's sibling list the screen thinks it serves one panel.
  expect(mounts.map((m) => m.setup.count)).toEqual([1]);
  h.hostUpdate!({ ...window.__hypercube!.identity!, source: "host", siblings: zone });
  await flush();
  expect(mounts.map((m) => m.setup.count)).toEqual([1, 3]);
  expect(mounts[1]!.ctx.identity.siblings).toHaveLength(4);
});

test("a late frame-context that leaves the setup alone updates the app's identity in place", async () => {
  window.history.replaceState(
    {},
    "",
    "/play/?app=a&setup=bank&frame=za:d3:r0&zone=a&display=3&hostrole=TOUCHSCREEN&pos=1&count=3",
  );
  const mounts = recordMounts();
  const { boot } = await import("../../src/core/runtime");
  void boot(document.body);
  await flush();
  h.hostUpdate!({ ...window.__hypercube!.identity!, source: "host", siblings: zone });
  await flush();
  expect(mounts).toHaveLength(1);
  expect(mounts[0]!.ctx.identity.source).toBe("host");
  expect(mounts[0]!.ctx.identity.siblings).toHaveLength(4);
});

type System = {
  launch(
    app: string,
    opts?: {
      stay?: { ms: number; graceMs: number };
      homeControl?: boolean;
      options?: Record<string, unknown>;
    },
  ): void;
  returned: string | null;
  presets(app: string): Record<string, unknown>;
};

/** App a is a picker: it keeps its system access and records why it came back each time. */
const pickerAndPlayer = () => {
  const picker: { system: System | null; returned: (string | null)[] } = {
    system: null,
    returned: [],
  };
  const player = { resets: 0, release: null as null | (() => void) };
  h.loaders.set("a", async () => ({
    mount: (ctx: { system: System }) => {
      picker.system = ctx.system;
      picker.returned.push(ctx.system.returned);
      return { reset() {}, dispose() {} };
    },
  }));
  h.loaders.set("b", async () => ({
    mount: (ctx: { idle: { hold(): () => void } }) => {
      player.release = ctx.idle.hold();
      return {
        reset() {
          player.resets++;
        },
        dispose() {},
      };
    },
  }));
  return { picker, player };
};

const fakeTimers = () => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"],
  });
  const w = window as unknown as Record<string, unknown>;
  const g = globalThis as unknown as Record<string, unknown>;
  for (const k of ["setTimeout", "clearTimeout", "setInterval", "clearInterval"]) w[k] = g[k];
};

const S = 1000;

test("a launched app with a stay is reset when idle and comes back once its time is up", async () => {
  fakeTimers();
  window.history.replaceState({}, "", "/play/?app=a&idle=10");
  const { picker, player } = pickerAndPlayer();
  const { boot } = await import("../../src/core/runtime");
  void boot(document.body);
  await vi.advanceTimersByTimeAsync(0);
  picker.system!.launch("b", { stay: { ms: 60 * S, graceMs: 60 * S } });
  await vi.advanceTimersByTimeAsync(0);
  player.release!();
  await vi.advanceTimersByTimeAsync(30 * S);
  // Idle before its time resets it in place rather than going back.
  expect(window.__hypercube!.app).toBe("b");
  expect(player.resets).toBe(1);
  await vi.advanceTimersByTimeAsync(31 * S);
  expect(window.__hypercube!.app).toBe("a");
  expect(picker.returned).toEqual([null, "time"]);
});

test("a stay waits for a player to finish, then goes at the next idle moment", async () => {
  fakeTimers();
  window.history.replaceState({}, "", "/play/?app=a&idle=10");
  const { picker, player } = pickerAndPlayer();
  const { boot } = await import("../../src/core/runtime");
  void boot(document.body);
  await vi.advanceTimersByTimeAsync(0);
  picker.system!.launch("b", { stay: { ms: 60 * S, graceMs: 60 * S } });
  await vi.advanceTimersByTimeAsync(90 * S);
  expect(window.__hypercube!.app).toBe("b");
  player.release!();
  await vi.advanceTimersByTimeAsync(9 * S);
  expect(window.__hypercube!.app).toBe("b");
  await vi.advanceTimersByTimeAsync(2 * S);
  expect(window.__hypercube!.app).toBe("a");
  expect(picker.returned).toEqual([null, "time"]);
});

test("a stay's grace ends it even while someone is still playing", async () => {
  fakeTimers();
  window.history.replaceState({}, "", "/play/?app=a&idle=10");
  const { picker } = pickerAndPlayer();
  const { boot } = await import("../../src/core/runtime");
  void boot(document.body);
  await vi.advanceTimersByTimeAsync(0);
  picker.system!.launch("b", { stay: { ms: 60 * S, graceMs: 30 * S } });
  await vi.advanceTimersByTimeAsync(89 * S);
  expect(window.__hypercube!.app).toBe("b");
  await vi.advanceTimersByTimeAsync(2 * S);
  expect(window.__hypercube!.app).toBe("a");
  expect(picker.returned).toEqual([null, "time"]);
});

test("without a stay a launched app goes back as soon as it is idle", async () => {
  fakeTimers();
  window.history.replaceState({}, "", "/play/?app=a&idle=10");
  const { picker, player } = pickerAndPlayer();
  const { boot } = await import("../../src/core/runtime");
  void boot(document.body);
  await vi.advanceTimersByTimeAsync(0);
  picker.system!.launch("b");
  await vi.advanceTimersByTimeAsync(0);
  player.release!();
  await vi.advanceTimersByTimeAsync(11 * S);
  expect(window.__hypercube!.app).toBe("a");
  expect(picker.returned).toEqual([null, "idle"]);
  expect(player.resets).toBe(0);
});

test("a launch can leave out the Home control and keep the app for good", async () => {
  fakeTimers();
  window.history.replaceState({}, "", "/play/?app=a&idle=10");
  const { picker, player } = pickerAndPlayer();
  const { boot } = await import("../../src/core/runtime");
  void boot(document.body);
  await vi.advanceTimersByTimeAsync(0);
  picker.system!.launch("b");
  await vi.advanceTimersByTimeAsync(0);
  expect(document.querySelectorAll(".hc-button")).toHaveLength(1);
  player.release!();
  await vi.advanceTimersByTimeAsync(11 * S);
  expect(window.__hypercube!.app).toBe("a");

  picker.system!.launch("b", { stay: { ms: Infinity, graceMs: 0 }, homeControl: false });
  await vi.advanceTimersByTimeAsync(0);
  expect(document.querySelectorAll(".hc-button")).toHaveLength(0);
  player.release!();
  await vi.advanceTimersByTimeAsync(3 * 60 * 60 * S);
  expect(window.__hypercube!.app).toBe("b");
  expect(player.resets).toBe(1);
});

test("a launched app starts from the operator's options for it, from the URL and from admin", async () => {
  window.history.replaceState({}, "", "/play/?app=a&o.n=5&o.poll.n=4&o.poll.ask=From%20the%20URL");
  const { picker } = pickerAndPlayer();
  const seen: unknown[] = [];
  h.loaders.set("poll", async () => ({
    mount: (ctx: { options: unknown }) => {
      seen.push(ctx.options);
      return { reset() {}, dispose() {} };
    },
  }));
  const { boot } = await import("../../src/core/runtime");
  void boot(document.body);
  await flush();
  // The picker's own options and URL text don't reach it.
  expect(picker.system!.presets("poll")).toEqual({ n: 4 });
  expect(picker.system!.presets("nope")).toEqual({});
  picker.system!.launch("poll");
  await flush();
  expect(seen[0]).toEqual({ ask: "", n: 4, mode: "a" });

  h.admin!.applyOverride({ launch: { poll: { ask: "Goodbye\nfor now", n: 3 } } });
  await flush();
  expect(window.__hypercube!.app).toBe("a");
  expect(picker.system!.presets("poll")).toEqual({ ask: "Goodbye for", n: 3 });
  picker.system!.launch("poll");
  await flush();
  expect(seen[1]).toEqual({ ask: "Goodbye for", n: 3, mode: "a" });
  // What the launcher passes wins over a preset.
  h.admin!.applyOverride({ launch: { poll: { ask: "Goodbye\nfor now", n: 3 } } });
  await flush();
  picker.system!.launch("poll", { options: { n: 1 } });
  await flush();
  expect(seen[2]).toEqual({ ask: "Goodbye for", n: 1, mode: "a" });
});
