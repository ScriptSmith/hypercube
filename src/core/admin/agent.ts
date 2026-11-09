import { type LogBuffer, pageLogs } from "../logs";
import type { Role, Room, SetupName } from "../types";
import {
  cleanConfig,
  type FrameConfig,
  type Keep,
  mergeConfig,
  plainText,
  readOverride,
  ROLES,
  sameConfig,
  SETUPS,
  type StorageLike,
  writeOverride,
} from "./config";
import type { AdminDeps } from "./deps";
import type { AdminLink } from "./link";
import { saveSeen, sessionStore } from "./nonces";
import { chunkEntries, LOG_REPLY, type LogReply, readLogRequest } from "./logwire";
import type { Envelope } from "./sign";
import { type FrameFacts, matchTarget } from "./target";

/**
 * Commands a console can send to frames. Frames answer each with a "state" envelope, except
 * `logs`, which is answered with LOG_REPLY envelopes sent only to the asker.
 */
export const COMMANDS = [
  "identify",
  "set",
  "clear",
  "reset",
  "reload",
  "notice",
  "app",
  "ping",
  "logs",
] as const;
export type CommandName = (typeof COMMANDS)[number];

export const NOTICE_MAX = 120;
export const IDENTIFY_MS = 10_000;

/** What a frame reports about itself, after every command and whenever it joins the room. */
export interface FrameState {
  /** The command this answers; absent when the frame announces itself. */
  ref?: string;
  cmd?: string;
  ok?: boolean;
  error?: string;
  name?: string;
  setup: SetupName;
  role: Role;
  group: string;
  side: number;
  pos: number;
  count: number;
  app: string;
  variant: string | null;
  override: FrameConfig | null;
  /** How long the override lasts, when there is one. */
  keep?: Keep;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const clamp = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

export const readState = (v: unknown): FrameState | null => {
  if (!isRecord(v)) return null;
  if (!SETUPS.includes(v.setup as SetupName) || !ROLES.includes(v.role as Role)) return null;
  if (typeof v.group !== "string" || typeof v.app !== "string") return null;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  const s: FrameState = {
    setup: v.setup as SetupName,
    role: v.role as Role,
    group: v.group.slice(0, 64),
    side: v.side === 1 ? 1 : 0,
    pos: num(v.pos),
    count: num(v.count),
    app: v.app.slice(0, 64),
    variant: typeof v.variant === "string" ? v.variant.slice(0, 64) : null,
    override: v.override === null ? null : cleanConfig(v.override),
  };
  if (s.override && (v.keep === "session" || v.keep === "once")) s.keep = v.keep;
  if (typeof v.ref === "string") s.ref = v.ref.slice(0, 64);
  if (typeof v.cmd === "string") s.cmd = v.cmd.slice(0, 32);
  if (typeof v.ok === "boolean") s.ok = v.ok;
  if (typeof v.error === "string") s.error = v.error.slice(0, 120);
  if (typeof v.name === "string") s.name = v.name.slice(0, 64);
  return s;
};

export interface AgentOptions {
  /** Where a session override lives (OVERRIDE_KEY). */
  storageKey: string;
  storage?: StorageLike | null;
  /** Wait between acknowledging `reload` and reloading, so the answer gets out first. */
  reloadDelay?: number;
  random?: () => number;
  /** Where `logs` reads from; the page's captured console by default. */
  logs?: LogBuffer;
  /** Where to remember the nonces of commands run, across reloads (sessionStorage). */
  seen?: { storage: StorageLike | null; key: string };
  /** Ms since this page loaded; commands sent before then are replays. */
  age?: () => number;
}

export interface Agent {
  /** Commands ignored because they were sent before this page loaded. */
  readonly early: number;
  dispose(): void;
}

/**
 * The frame side of admin: runs commands addressed to this frame, keeps its override and answers
 * with its state. An override lasts until the browser closes or only until the frame next loads,
 * as the operator chose; either way it never outlives the browser session, so a frame shown in a
 * new window or at a later event starts from its URL.
 */
export const createAgent = (
  deps: AdminDeps,
  room: Room,
  link: AdminLink,
  opts: AgentOptions,
): Agent => {
  const storage = opts.storage === undefined ? sessionStore() : opts.storage;
  const random = opts.random ?? Math.random;
  const reloadDelay = opts.reloadDelay ?? 300;
  const logs = opts.logs ?? pageLogs();
  const age = opts.age ?? (() => performance.now());
  let early = 0;
  const frame = room.self;
  const saved = readOverride(storage, opts.storageKey);
  let current: { config: FrameConfig; keep: Keep } | null = saved
    ? { config: saved, keep: "session" }
    : null;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const cleanups: (() => void)[] = [];
  let disposed = false;

  const later = (ms: number, fn: () => void) => {
    const id = setTimeout(() => {
      timers.delete(id);
      if (!disposed) fn();
    }, ms);
    timers.add(id);
  };

  const facts = (): FrameFacts => {
    const s = deps.setup();
    return {
      frame,
      group: s.group,
      zone: deps.identity().zone,
      side: s.side,
      app: deps.config().app,
    };
  };

  const snapshot = (): FrameState => {
    const s = deps.setup();
    const c = deps.config();
    const state: FrameState = {
      setup: s.name,
      role: s.role,
      group: s.group,
      side: s.side,
      pos: s.pos,
      count: s.count,
      app: c.app,
      variant: c.variant ?? null,
      override: current?.config ?? null,
    };
    if (current) state.keep = current.keep;
    const name = deps.identity().name;
    if (name) state.name = name;
    return state;
  };

  const announce = (extra: Partial<FrameState> = {}) =>
    link.send({ k: "all" }, "state", { ...snapshot(), ...extra });

  /** Replaces the override and how long it lasts; one kept only until reload isn't saved. */
  const apply = (next: FrameConfig | null, keep: Keep) => {
    const prev = current?.config ?? null;
    current = next ? { config: next, keep } : null;
    writeOverride(storage, opts.storageKey, next && keep === "session" ? next : null);
    if (!sameConfig(prev, next)) deps.applyOverride(next);
  };

  /** Answers `logs` in parts, oldest first, to the asker alone. */
  const sendLogs = async (env: Envelope) => {
    const chunks = chunkEntries(logs.entries(readLogRequest(env.args, frame, logs.boot)));
    const parts = Math.max(1, chunks.length);
    for (let part = 0; part < parts && !disposed; part++) {
      const reply: LogReply = {
        ref: env.id,
        part,
        parts,
        boot: logs.boot,
        size: logs.size,
        errors: logs.errorCount,
        entries: chunks[part] ?? [],
      };
      await link.send({ k: "frames", ids: [env.from] }, LOG_REPLY, reply, env.from);
    }
  };

  /**
   * Runs a command. Returns an error message, or a step to take after answering; `quiet`
   * commands answer for themselves.
   */
  const execute = (env: Envelope): { error?: string; after?: () => void; quiet?: boolean } => {
    const args = isRecord(env.args) ? env.args : {};
    switch (env.cmd as CommandName) {
      case "identify":
        deps.identify(clamp(args.ms, 1000, 60_000, IDENTIFY_MS));
        return {};
      case "set": {
        // An older hub sending back an override it remembered, which would outlive the session.
        if (args.restore === true) return { quiet: true };
        const config = cleanConfig(args.config);
        if (!config) return { error: "bad config" };
        const next = args.merge === true ? mergeConfig(current?.config ?? null, config) : config;
        apply(next, args.keep === "once" ? "once" : "session");
        return {};
      }
      case "clear":
        apply(null, "session");
        return {};
      case "reset":
        deps.resetApp();
        return {};
      case "reload":
        return { after: () => later(reloadDelay, () => deps.reload()) };
      case "notice": {
        const text = plainText(args.text, NOTICE_MAX);
        if (!text) return { error: "bad notice" };
        deps.showNotice(text, clamp(args.ms, 2000, 600_000, 15_000));
        return {};
      }
      case "app": {
        const name = plainText(args.name, 32);
        if (!name) return { error: "bad app command" };
        deps.appCommand(name, args.args);
        return {};
      }
      case "ping":
        return {};
      case "logs":
        return { quiet: true, after: () => void sendLogs(env) };
      default:
        return { error: `unknown command ${env.cmd.slice(0, 32)}` };
    }
  };

  const handle = async (env: Envelope) => {
    if (env.cmd === "state" || env.cmd === LOG_REPLY || !matchTarget(env.target, facts())) return;
    // A replay of a command sent before this page loaded, e.g. a reload captured earlier.
    if (room.clock.synced && env.ts < room.clock.now() - age()) {
      early++;
      return;
    }
    if (opts.seen) saveSeen(opts.seen.storage, opts.seen.key, env.id, env.ts);
    let result: ReturnType<typeof execute>;
    try {
      result = execute(env);
    } catch (err) {
      result = { error: String(err).slice(0, 120) };
    }
    if (result.quiet && !result.error) {
      result.after?.();
      return;
    }
    const answer: Partial<FrameState> = { ref: env.id, cmd: env.cmd, ok: !result.error };
    if (result.error) answer.error = result.error;
    await announce(answer);
    result.after?.();
  };

  cleanups.push(link.on((env) => void handle(env)));

  // Announce on every (re)join, spread out so a whole room rejoining a new hub doesn't burst.
  const hello = () => later(200 + random() * 1000, () => void announce());
  cleanups.push(
    room.onStatus((s) => {
      if (s === "online") hello();
    }),
  );
  if (room.status === "online") hello();

  return {
    get early() {
      return early;
    },
    dispose() {
      disposed = true;
      for (const id of timers) clearTimeout(id);
      timers.clear();
      for (const fn of cleanups.splice(0)) fn();
    },
  };
};
