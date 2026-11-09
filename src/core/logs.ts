/**
 * Recent console output and uncaught errors, kept in memory so admin can fetch them from a frame
 * at the venue, where nobody can open developer tools. Bounded: LOG_CAPACITY entries of at most
 * LOG_ENTRY_CHARS characters. Nothing here may throw into the page, whatever gets logged.
 */
export const LOG_CAPACITY = 300;
export const LOG_ENTRY_CHARS = 500;
export const LOG_LEVELS = ["log", "info", "warn", "error", "uncaught"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface LogEntry {
  /** Increases by one per entry since the page loaded, so callers can ask for what's new. */
  seq: number;
  /** Date.now() on the frame. */
  t: number;
  level: LogLevel;
  msg: string;
}

export interface LogQuery {
  /** The newest this many. */
  limit?: number;
  levels?: readonly LogLevel[] | null;
  /** Only entries with a larger seq. */
  since?: number;
}

export interface LogBuffer {
  /** Random per page load; a new value means the frame reloaded and seq started again. */
  readonly boot: string;
  readonly size: number;
  /** Errors and uncaught errors since the page loaded, including entries since evicted. */
  readonly errorCount: number;
  add(level: LogLevel, args: readonly unknown[], counted?: boolean): void;
  /** Oldest first. */
  entries(query?: LogQuery): LogEntry[];
}

export const isLogLevel = (v: unknown): v is LogLevel =>
  typeof v === "string" && (LOG_LEVELS as readonly string[]).includes(v);

const REDACT = /\b(ak|key|room)=([^&\s"'<>#,;()]+)/gi;

/** Hides the values of `ak=`, `key=` and `room=` URL parameters. */
export const redact = (text: string): string => text.replace(REDACT, "$1=[redacted]");

const MAX_ITEMS = 50;
const MAX_NODES = 300;

/** Also true for errors made in another frame's realm, which fail `instanceof Error`. */
const isError = (v: object): v is Error =>
  v instanceof Error || Object.prototype.toString.call(v) === "[object Error]";

const errorText = (err: Error): string => {
  const head = `${err.name}: ${err.message}`;
  const stack = typeof err.stack === "string" ? err.stack : "";
  return stack.includes(err.message) ? stack : stack ? `${head}\n${stack}` : head;
};

const isNode = (v: object): v is Node => typeof Node === "function" && v instanceof Node;

/** JSON-like text for an object, safe against cycles, huge collections and hostile getters. */
const objectText = (v: object, budget: number): string => {
  if (isError(v)) return errorText(v);
  if (isNode(v)) return `<${v.nodeName.toLowerCase()}>`;
  const seen = new WeakSet<object>();
  let nodes = 0;
  const text = JSON.stringify(v, (_key, value: unknown) => {
    if (++nodes > MAX_NODES) return "…";
    switch (typeof value) {
      case "bigint":
        return `${value}n`;
      case "symbol":
        return value.toString();
      case "function":
        return `[function ${value.name || "anonymous"}]`;
      case "undefined":
        return "undefined";
      default:
        break;
    }
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    if (isError(value)) return errorText(value);
    if (isNode(value)) return `<${value.nodeName.toLowerCase()}>`;
    if (value instanceof Map || value instanceof Set) {
      return `[${value.constructor.name} of ${value.size}]`;
    }
    if (ArrayBuffer.isView(value)) return `[${value.constructor.name}]`;
    if (Array.isArray(value)) {
      return value.length > MAX_ITEMS
        ? [...value.slice(0, MAX_ITEMS), `… ${value.length - MAX_ITEMS} more`]
        : value;
    }
    const keys = Object.keys(value);
    if (keys.length <= MAX_ITEMS) return value;
    const out: Record<string, unknown> = {};
    for (const k of keys.slice(0, MAX_ITEMS)) out[k] = (value as Record<string, unknown>)[k];
    out["…"] = `${keys.length - MAX_ITEMS} more`;
    return out;
  });
  return (text ?? String(text)).slice(0, budget);
};

/** One console argument as text. Never throws. */
export const describe = (v: unknown, budget = LOG_ENTRY_CHARS * 2): string => {
  try {
    switch (typeof v) {
      case "string":
        return v.slice(0, budget);
      case "symbol":
        return v.toString();
      case "function":
        return `[function ${v.name || "anonymous"}]`;
      case "object":
        return v === null ? "null" : objectText(v, budget);
      default:
        return String(v);
    }
  } catch {
    try {
      return Object.prototype.toString.call(v);
    } catch {
      return "[unprintable]";
    }
  }
};

/** Console arguments as one capped, redacted line. Never throws. */
export const formatArgs = (args: readonly unknown[]): string => {
  let text = "";
  for (const arg of args) {
    if (text.length >= LOG_ENTRY_CHARS * 2) break;
    text += (text ? " " : "") + describe(arg);
  }
  text = redact(text);
  return text.length > LOG_ENTRY_CHARS ? `${text.slice(0, LOG_ENTRY_CHARS - 1)}…` : text;
};

export const createLogBuffer = (
  capacity = LOG_CAPACITY,
  now: () => number = Date.now,
): LogBuffer => {
  const ring: (LogEntry | undefined)[] = Array.from({ length: capacity });
  let start = 0;
  let size = 0;
  let seq = 0;
  let errorCount = 0;
  const boot = Math.random().toString(36).slice(2, 10);

  return {
    boot,
    get size() {
      return size;
    },
    get errorCount() {
      return errorCount;
    },
    add(level, args, counted = true) {
      let msg: string;
      try {
        msg = formatArgs(args);
      } catch {
        msg = "[unprintable]";
      }
      const entry: LogEntry = { seq: ++seq, t: now(), level, msg };
      if (counted && (level === "error" || level === "uncaught")) errorCount++;
      if (size < capacity) {
        ring[(start + size) % capacity] = entry;
        size++;
      } else {
        ring[start] = entry;
        start = (start + 1) % capacity;
      }
    },
    entries(query = {}) {
      const levels = query.levels && query.levels.length > 0 ? new Set(query.levels) : null;
      const out: LogEntry[] = [];
      for (let i = 0; i < size; i++) {
        const e = ring[(start + i) % capacity];
        if (!e) continue;
        if (query.since !== undefined && e.seq <= query.since) continue;
        if (levels && !levels.has(e.level)) continue;
        out.push(e);
      }
      const limit = query.limit;
      return limit !== undefined && limit >= 0 && out.length > limit
        ? out.slice(out.length - limit)
        : out;
    },
  };
};

type ConsoleMethod = "log" | "info" | "warn" | "error" | "debug";
const METHODS: Record<ConsoleMethod, LogLevel> = {
  log: "log",
  info: "info",
  warn: "warn",
  error: "error",
  // Debug output is ordinary log output here; the five levels are enough at the venue.
  debug: "log",
};

let shared: LogBuffer | null = null;
let uninstall: (() => void) | null = null;

/** The page's buffer, whether or not capture has started. */
export const pageLogs = (): LogBuffer => (shared ??= createLogBuffer());

/**
 * Starts recording console output and uncaught errors into the page's buffer. Safe to call more
 * than once; returns the buffer.
 */
export const captureLogs = (target: Window & typeof globalThis = window): LogBuffer => {
  const buffer = pageLogs();
  if (uninstall) return buffer;
  uninstall = installCapture(buffer, target);
  return buffer;
};

/** Stops capture started by captureLogs (tests). */
export const stopCapture = (): void => {
  uninstall?.();
  uninstall = null;
};

/** Wraps the console methods and listens for uncaught errors. Returns a function that undoes it. */
export const installCapture = (
  buffer: LogBuffer,
  target: Window & typeof globalThis = window,
): (() => void) => {
  const con = target.console;
  const originals = new Map<ConsoleMethod, (...args: unknown[]) => void>();
  let busy = false;
  // The runtime also reports each uncaught error with console.error in the same task; that echo
  // is kept but not counted again.
  let inUncaught = false;

  const record = (level: LogLevel, args: readonly unknown[], counted = true) => {
    // Formatting can run app code (toJSON, getters) that logs; don't record that recursively.
    if (busy) return;
    busy = true;
    try {
      buffer.add(level, args, counted);
    } catch {
      // Capture must never break the page.
    } finally {
      busy = false;
    }
  };

  for (const [name, level] of Object.entries(METHODS) as [ConsoleMethod, LogLevel][]) {
    const original = con[name] as (...args: unknown[]) => void;
    if (typeof original !== "function") continue;
    originals.set(name, original);
    con[name] = (...args: unknown[]) => {
      record(level, args, !(level === "error" && inUncaught));
      try {
        original.apply(con, args);
      } catch {
        // A broken console must not break the caller either.
      }
    };
  }

  const markUncaught = () => {
    inUncaught = true;
    target.setTimeout(() => {
      inUncaught = false;
    }, 0);
  };

  const onError = (e: ErrorEvent) => {
    let where = "";
    try {
      const file = e.filename ? e.filename.split("/").pop()?.split("?")[0] : "";
      where = file ? ` (${file}:${e.lineno}:${e.colno})` : "";
    } catch {
      where = "";
    }
    const stack =
      e.error instanceof Error && typeof e.error.stack === "string" ? `\n${e.error.stack}` : "";
    record("uncaught", [`${e.message}${where}${stack}`]);
    markUncaught();
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    record("uncaught", ["Unhandled rejection:", e.reason]);
    markUncaught();
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);

  return () => {
    for (const [name, original] of originals) con[name] = original;
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
};
