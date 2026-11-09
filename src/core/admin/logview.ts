import { LOG_CAPACITY, LOG_LEVELS, type LogLevel } from "../logs";
import { type IconName, iconElement } from "../ui";
import type { AdminLink } from "./link";
import {
  LOG_REPLY,
  LOG_SELECTION_TOTAL,
  type LogRequest,
  type LogSince,
  readLogReply,
  type WireLog,
} from "./logwire";

const AUTO_EVERY_MS = 3000;
const RENDER_EVERY_MS = 250;
/** Lines drawn at most, newest kept, when several frames are merged. */
const MAX_LINES = 600;

export interface LogViewOptions {
  link: AdminLink;
  /** Frames to fetch from, with their labels. */
  frames: readonly { frame: string; label: string }[];
  /** The /admin/ page, which can copy to the clipboard. */
  page: boolean;
  onBack(): void;
}

export interface LogView {
  readonly el: HTMLElement;
  dispose(): void;
}

interface FrameLogs {
  label: string;
  boot: string | null;
  entries: WireLog[];
  errors: number;
  answeredAt: number;
}

const make = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text?: string,
): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};

const button = (label: string, onClick: () => void, className = "", icon?: IconName) => {
  const b = make("button", `hca-btn ${className}`.trim());
  b.type = "button";
  if (icon) {
    const i = iconElement(icon, "100%");
    i.classList.add("hca-ico");
    b.append(i);
  }
  if (label) b.append(make("span", "", label));
  b.addEventListener("click", onClick);
  return b;
};

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (t: number) => {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/** Recent console output from one or more frames, newest last. */
export const createLogView = (opts: LogViewOptions): LogView => {
  const { link } = opts;
  const many = opts.frames.length > 1;
  const frames = new Map<string, FrameLogs>(
    opts.frames.map((f) => [
      f.frame,
      { label: f.label, boot: null, entries: [], errors: 0, answeredAt: 0 },
    ]),
  );
  const levels = new Set<LogLevel>(LOG_LEVELS);
  let only: string | null = null;
  let auto = false;
  let autoTimer: ReturnType<typeof setInterval> | undefined;
  let renderTimer: ReturnType<typeof setTimeout> | undefined;
  let askedAt = 0;
  let disposed = false;
  const cleanups: (() => void)[] = [];

  const el = make("div", "hca-logview");
  const head = make("div", "hca-sheet-head");
  const title =
    opts.frames.length === 1
      ? `Logs: ${opts.frames[0]?.label}`
      : `Logs: ${opts.frames.length} frames`;
  head.append(
    button("Back", () => opts.onBack(), "hca-back", "up"),
    make("span", "hca-sheet-title", title),
  );
  const bar = make("div", "hca-logbar");
  const list = make("div", "hca-logs");
  list.setAttribute("role", "log");
  const foot = make("div", "hca-foot");
  const status = make("div", "hca-count");
  status.setAttribute("aria-live", "polite");
  foot.append(status);
  el.append(head, bar, list, foot);

  const visible = (): { frame: string; e: WireLog }[] => {
    const out: { frame: string; e: WireLog }[] = [];
    for (const [frame, f] of frames) {
      if (only !== null && only !== frame) continue;
      for (const e of f.entries) if (levels.has(e.l)) out.push({ frame, e });
    }
    out.sort((a, b) => a.e.t - b.e.t || a.e.s - b.e.s);
    return out.slice(-MAX_LINES);
  };

  const renderList = () => {
    renderTimer = undefined;
    if (disposed) return;
    // Follow new lines only when the reader is already at the bottom.
    const follow = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    const rows = visible();
    const nodes: HTMLElement[] = rows.map(({ frame, e }) => {
      const row = make("div", "hca-log");
      row.dataset.level = e.l;
      const meta = make("div", "hca-log-meta");
      meta.append(make("span", "hca-log-time", clock(e.t)));
      if (many) meta.append(make("span", "hca-log-frame", frames.get(frame)?.label ?? frame));
      meta.append(make("span", "hca-log-lvl", e.l));
      row.append(meta, make("div", "hca-log-msg", e.m));
      return row;
    });
    if (nodes.length === 0) {
      const answered = [...frames.values()].some((f) => f.answeredAt > 0);
      nodes.push(
        make("div", "hca-empty", answered ? "Nothing logged at these levels." : "Asking for logs."),
      );
    }
    list.replaceChildren(...nodes);
    if (follow) list.scrollTop = list.scrollHeight;
    renderStatus(rows.length);
  };

  const renderStatus = (shown = visible().length) => {
    const all = [...frames.values()];
    const answered = all.filter((f) => f.answeredAt >= askedAt && askedAt > 0).length;
    const errors = all.reduce((n, f) => n + f.errors, 0);
    const parts = [`${shown} ${shown === 1 ? "line" : "lines"}`];
    parts.push(`${answered} of ${all.length} ${all.length === 1 ? "frame" : "frames"} answered`);
    if (errors > 0) parts.push(`${errors} ${errors === 1 ? "error" : "errors"} since load`);
    if (auto) parts.push("refreshing every 3 s");
    status.textContent = parts.join(" · ");
  };

  const scheduleRender = () => {
    if (renderTimer === undefined && !disposed)
      renderTimer = setTimeout(renderList, RENDER_EVERY_MS);
  };

  const request = async () => {
    const ids = [...frames.keys()];
    const since: Record<string, { b: string; s: number }> = {};
    for (const [frame, f] of frames) {
      const last = f.entries.at(-1);
      if (f.boot && last) since[frame] = { b: f.boot, s: last.s };
    }
    const args: LogRequest = {
      limit:
        ids.length === 1
          ? LOG_CAPACITY
          : Math.max(30, Math.floor(LOG_SELECTION_TOTAL / ids.length)),
    };
    if (Object.keys(since).length > 0) args.since = since satisfies LogSince;
    askedAt = Date.now();
    renderStatus();
    await link.send({ k: "frames", ids }, "logs", args);
  };

  cleanups.push(
    link.on((env) => {
      if (env.cmd !== LOG_REPLY) return;
      const f = frames.get(env.from);
      const reply = readLogReply(env.args);
      if (!f || !reply) return;
      if (f.boot !== reply.boot) {
        f.boot = reply.boot;
        f.entries = [];
      }
      const last = f.entries.at(-1)?.s ?? 0;
      const fresh = reply.entries.filter((e) => e.s > last);
      if (fresh.length < reply.entries.length) {
        // Parts can overlap what we have after a reload or a lost answer; merge by seq.
        const bySeq = new Map(f.entries.map((e) => [e.s, e]));
        for (const e of reply.entries) bySeq.set(e.s, e);
        f.entries = [...bySeq.values()].sort((a, b) => a.s - b.s);
      } else {
        f.entries.push(...fresh);
      }
      if (f.entries.length > LOG_CAPACITY) f.entries.splice(0, f.entries.length - LOG_CAPACITY);
      f.errors = reply.errors;
      if (reply.part === reply.parts - 1) f.answeredAt = Date.now();
      scheduleRender();
    }),
  );

  const renderBar = () => {
    bar.replaceChildren();
    const chips = make("div", "hca-choices");
    for (const level of LOG_LEVELS) {
      const b = button(
        level,
        () => {
          if (levels.has(level)) levels.delete(level);
          else levels.add(level);
          renderBar();
          renderList();
        },
        "hca-chip hca-level",
      );
      b.dataset.level = level;
      b.classList.toggle("is-on", levels.has(level));
      b.setAttribute("aria-pressed", String(levels.has(level)));
      chips.append(b);
    }
    const actions = make("div", "hca-choices");
    actions.append(button("Refresh", () => void request(), "", "reset"));
    const autoBtn = button(auto ? "Auto on" : "Auto off", () => {
      auto = !auto;
      clearInterval(autoTimer);
      autoTimer = auto ? setInterval(() => void request(), AUTO_EVERY_MS) : undefined;
      renderBar();
      renderStatus();
    });
    autoBtn.classList.toggle("is-on", auto);
    autoBtn.setAttribute("aria-pressed", String(auto));
    actions.append(autoBtn);
    if (opts.page) {
      const copy = button("Copy", () => {
        const text = visible()
          .map(({ frame, e }) => {
            const who = many ? ` ${frames.get(frame)?.label ?? frame}` : "";
            return `${new Date(e.t).toISOString()}${who} ${e.l} ${e.m}`;
          })
          .join("\n");
        const label = copy.querySelector("span");
        const say = (text: string) => {
          if (label) label.textContent = text;
          setTimeout(() => {
            if (label) label.textContent = "Copy";
          }, 1500);
        };
        if (!navigator.clipboard) {
          say("Copy failed");
          return;
        }
        navigator.clipboard.writeText(text).then(
          () => say("Copied"),
          () => say("Copy failed"),
        );
      });
      actions.append(copy);
    }
    bar.append(chips, actions);
    if (many) {
      const who = make("div", "hca-choices hca-logframes");
      const pick = (label: string, frame: string | null) => {
        const b = button(
          label,
          () => {
            only = frame;
            renderBar();
            renderList();
          },
          "hca-chip",
        );
        b.classList.toggle("is-on", only === frame);
        who.append(b);
      };
      pick("All frames", null);
      for (const [frame, f] of frames) pick(f.label, frame);
      bar.append(who);
    }
  };

  renderBar();
  renderList();
  void request();

  return {
    el,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearInterval(autoTimer);
      clearTimeout(renderTimer);
      for (const fn of cleanups.splice(0)) fn();
      el.remove();
    },
  };
};
