import { vi } from "vitest";
import { type Agent, createAgent, type FrameState, readState } from "../../src/core/admin/agent";
import {
  type FrameConfig,
  OVERRIDE_KEY,
  readOverride,
  type StorageLike,
} from "../../src/core/admin/config";
import type { AdminDeps } from "../../src/core/admin/deps";
import { type AdminLink, createLink } from "../../src/core/admin/link";
import { importAdminKey } from "../../src/core/admin/sign";
import { loadSeen, SEEN_KEY } from "../../src/core/admin/nonces";
import { generateAdminKey } from "../../src/core/adminkey";
import { createLogBuffer, type LogBuffer } from "../../src/core/logs";
import type { PeerInfo, Room, SetupInfo } from "../../src/core/types";
import type { World } from "../net/helpers";

export const TOKEN = "test-room";
export const AK = generateAdminKey();

// Taken before any test fakes timers: WebCrypto answers on the real event loop, from a thread
// pool, so each fake step also waits a real millisecond for it.
const realTimeout = setTimeout;
const pause = () => new Promise<void>((resolve) => realTimeout(resolve, 1));

/** Fake timers for the network; WebCrypto still runs for real. */
export const useNetClock = () =>
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"],
  });

/** Advance fake time in small steps, letting real crypto work finish between them. */
export const settle = async (ms = 500, steps = 25) => {
  for (let i = 0; i < steps; i++) {
    await vi.advanceTimersByTimeAsync(ms / steps);
    await pause();
  }
};

export const memoryStorage = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
};

export interface TestFrame {
  name: string;
  room: Room;
  link: AdminLink;
  agent: Agent;
  storage: ReturnType<typeof memoryStorage>;
  override: () => FrameConfig | null;
  applied: (FrameConfig | null)[];
  calls: { identify: number[]; notices: [string, number][]; resets: number; reloads: number };
  appCommands: [string, unknown][];
  close(): void;
}

/** A frame with admin, on a fake room. Its app and setup follow its override as the runtime's do. */
export const startFrame = (
  world: World,
  name: string,
  opts: {
    info?: Partial<PeerInfo>;
    zone?: string;
    storage?: ReturnType<typeof memoryStorage>;
    ak?: string;
    logs?: LogBuffer;
    /** sessionStorage for remembered command nonces. */
    session?: ReturnType<typeof memoryStorage>;
    /** Ms since the page loaded; long ago by default, so only the nonce checks apply. */
    age?: number;
  } = {},
): TestFrame => {
  const room = world.join(name, opts.info ?? {});
  const storage = opts.storage ?? memoryStorage();
  const key = OVERRIDE_KEY(TOKEN, name);
  let override = readOverride(storage, key);
  const applied: (FrameConfig | null)[] = [];
  const calls = {
    identify: [] as number[],
    notices: [] as [string, number][],
    resets: 0,
    reloads: 0,
  };
  const appCommands: [string, unknown][] = [];
  const setup = (): SetupInfo => ({
    name: override?.setup ?? "solo",
    role: override?.role ?? "solo",
    pos: override?.pos ?? opts.info?.pos ?? 0,
    count: override?.count ?? 1,
    group: override?.group ?? opts.info?.group ?? "g",
    side: override?.side ?? 0,
  });
  const deps: AdminDeps = {
    overlay: null as unknown as HTMLElement,
    room,
    roomToken: TOKEN,
    ak: opts.ak ?? AK,
    pinVerifier: null,
    identity: () => ({
      frame: name,
      zone: opts.zone,
      name: `Frame ${name}`,
      source: "params",
      mode: "show",
      siblings: [],
    }),
    frame: () => {
      throw new Error("not used");
    },
    setup,
    config: () => ({ ...override, app: override?.app ?? "idle" }),
    applyOverride(next) {
      override = next;
      applied.push(next);
    },
    resetApp: () => void calls.resets++,
    appCommand: (n, a) => void appCommands.push([n, a]),
    reload: () => void calls.reloads++,
    showNotice: (t, ms) => void calls.notices.push([t, ms]),
    identify: (ms) => void calls.identify.push(ms),
  };
  const seenKey = SEEN_KEY(TOKEN, name);
  const link = createLink(room, importAdminKey(opts.ak ?? AK), {
    seen: loadSeen(opts.session ?? null, seenKey),
  });
  const agent = createAgent(deps, room, link, {
    seen: opts.session ? { storage: opts.session, key: seenKey } : undefined,
    age: () => opts.age ?? 1e9,
    storageKey: key,
    storage,
    random: () => 0.5,
    reloadDelay: 10,
    logs: opts.logs ?? createLogBuffer(),
  });
  return {
    name,
    room,
    link,
    agent,
    storage,
    override: () => override,
    applied,
    calls,
    appCommands,
    close() {
      agent.dispose();
      link.dispose();
      room.close();
    },
  };
};

export interface TestConsole {
  room: Room;
  link: AdminLink;
  /** Every state envelope seen, newest last. */
  states: { from: string; state: FrameState }[];
}

/** The /admin/ page's side: a member that never becomes the hub and only sends. */
export const startConsole = (world: World, name = "admin-test", ak = AK): TestConsole => {
  const room = world.join(name, { app: "admin", group: "admin", kind: "kiosk" }, 0, false);
  const link = createLink(room, importAdminKey(ak));
  const states: TestConsole["states"] = [];
  link.on((env) => {
    if (env.cmd !== "state") return;
    const state = readState(env.args);
    if (state) states.push({ from: env.from, state });
  });
  return { room, link, states };
};
