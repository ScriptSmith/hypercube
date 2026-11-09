import { optionDefault, optionShown } from "../options";
import type { AppManifest, FrameKind, OptionDef, OptionValue, Room } from "../types";
import { type IconName, iconElement } from "../ui";
import { type FrameState, IDENTIFY_MS, NOTICE_MAX, readState } from "./agent";
import { type FrameConfig, type Keep, plainText, ROLES, SETUPS } from "./config";
import type { AdminLink } from "./link";
import { createLogView, type LogView } from "./logview";
import {
  buildRows,
  buildSelectors,
  describeRow,
  formatAgo,
  type FrameRow,
  rowFacts,
  type RosterView,
  rowsFor,
  type Selector,
} from "./model";
import { ensureAdminStyles } from "./style";
import { describeTarget, sideName, type Target } from "./target";

/** Notices an operator can show from a frame, where nobody can type. */
export const PRESET_NOTICES = [
  "Back in a few minutes",
  "Please wait",
  "Thanks for visiting",
  "Closing soon",
  "Starting soon",
] as const;

const NOTICE_TIMES = [
  { ms: 10_000, label: "10 s" },
  { ms: 30_000, label: "30 s" },
  { ms: 60_000, label: "1 min" },
  { ms: 300_000, label: "5 min" },
];
const RENDER_EVERY_MS = 1000;
const HUB_POLL_MS = 5000;
const PING_EVERY_MS = 3000;
const GROUP_CHOICES = ["main", "g1", "g2", "g3", "g4"];
const KEEP_CHOICES: readonly { value: Keep; label: string }[] = [
  { value: "session", label: "Until the browser closes" },
  { value: "once", label: "Until the next reload" },
];

export interface PanelOptions {
  /** "frame" inside a venue frame (no free text); "page" on the /admin/ page. */
  mode: "frame" | "page";
  room: Room;
  link: AdminLink;
  apps: readonly AppManifest[];
  onLock(): void;
}

export interface PanelHandle {
  readonly el: HTMLElement;
  dispose(): void;
}

type Confirmable = "reset" | "reload" | "clear";
type View =
  | { k: "list" }
  | { k: "confirm"; cmd: Confirmable }
  | { k: "app" | "setup" | "notice" }
  | { k: "logs"; frames: { frame: string; label: string }[] };

interface Answer {
  cmd: string;
  ok: boolean;
  error?: string;
  at: number;
}

const CONFIRM: Record<Confirmable, { ask: string; go: string }> = {
  reset: { ask: "Reset the app on", go: "Reset" },
  reload: { ask: "Reload", go: "Reload" },
  clear: { ask: "Clear the override on", go: "Clear" },
};

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

const icon = (name: IconName): HTMLElement => {
  const el = iconElement(name, "100%");
  el.classList.add("hca-ico");
  return el;
};

const button = (
  label: string,
  onClick: () => void,
  className = "",
  iconName?: IconName,
): HTMLButtonElement => {
  const b = make("button", `hca-btn ${className}`.trim());
  b.type = "button";
  if (iconName) b.append(icon(iconName));
  if (label) b.append(make("span", "", label));
  b.addEventListener("click", onClick);
  return b;
};

const KIND_PLURAL: Record<FrameKind, string> = {
  panel: "panels",
  pair: "pairs",
  wall: "walls",
  screen: "screens",
  kiosk: "kiosks",
  sphere: "spheres",
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const since = (ms: number): string =>
  ms < 60_000 ? `${Math.max(0, Math.round(ms / 1000))} s ago` : formatAgo(ms);

const decimals = (step: number): number => {
  const s = String(step);
  const dot = s.indexOf(".");
  return dot < 0 ? 0 : s.length - dot - 1;
};

/** The admin panel: the roster, selection and commands. Used in frames and on /admin/. */
export const createPanel = (opts: PanelOptions): PanelHandle => {
  ensureAdminStyles();
  const { room, link, mode } = opts;
  const page = mode === "page";

  const el = make("div", "hca hca-panel");
  el.dataset.mode = mode;
  const head = make("div", "hca-head");
  const summary = make("div", "hca-summary");
  head.append(make("div", "hca-title", "Admin"), summary);
  head.append(button("Lock", () => opts.onLock(), "", "close"));
  const statusEl = make("div", "hca-status");
  statusEl.setAttribute("aria-live", "polite");
  statusEl.hidden = true;
  const body = make("div", "hca-body");
  el.append(head, statusEl, body);

  let view: View = { k: "list" };
  const selected = new Set<string>();
  let origin: Selector | null = null;
  const states = new Map<string, FrameState>();
  const answers = new Map<string, Answer>();
  let last: {
    id: string;
    label: string;
    target: Target;
    expected: number;
    replies: Set<string>;
    failed: string[];
  } | null = null;
  let hubFrame: string | null = room.hub;
  let rv: RosterView = { zones: [], rows: [], consoles: [] };
  let pressing = false;
  let renderQueued = false;
  let renderTimer: ReturnType<typeof setTimeout> | undefined;
  let lastRender = 0;
  let shell: { chips: HTMLElement; list: HTMLElement; foot: HTMLElement } | null = null;
  let logView: LogView | null = null;
  let scrolledAt = 0;
  let disposed = false;
  const cleanups: (() => void)[] = [];

  let appDraft: {
    app: string | null;
    variant: string | null;
    options: Record<string, OptionValue>;
  } = { app: null, variant: null, options: {} };
  /** `apps` tokens this console doesn't know, seen while the app sheet is open. */
  const strayTokens = new Set<string>();
  let setupDraft: FrameConfig = {};
  let keepDraft: Keep = "session";
  let noticeDraft = { text: PRESET_NOTICES[0] as string, ms: 30_000, custom: "" };

  const target = (): Target => origin?.target ?? { k: "frames", ids: [...selected] };
  const targetRows = (): FrameRow[] => rowsFor(target(), rv.rows);

  const refreshRoster = () => {
    rv = buildRows(room.roster(), states, { hub: hubFrame, self: room.self, now: Date.now() });
    const present = new Set(rv.rows.map((r) => r.frame));
    if (origin) {
      selected.clear();
      for (const r of rowsFor(origin.target, rv.rows)) selected.add(r.frame);
    } else {
      for (const id of selected) if (!present.has(id)) selected.delete(id);
    }
    for (const id of states.keys()) if (!present.has(id)) states.delete(id);
    for (const id of answers.keys()) if (!present.has(id)) answers.delete(id);
  };

  const renderSummary = () => {
    const parts: (string | HTMLElement)[] = [];
    const conn = make("span", "", room.status);
    conn.dataset.tone = room.status === "online" ? "good" : "bad";
    parts.push(conn, ` · ${plural(rv.rows.length, "frame")}`);
    const hub = rv.rows.find((r) => r.hub);
    if (hub) parts.push(` · hub ${hub.label}`);
    if (rv.consoles.length > 0) parts.push(` · ${plural(rv.consoles.length, "console")}`);
    summary.replaceChildren(...parts);
  };

  const renderStatus = () => {
    if (!last) {
      statusEl.hidden = true;
      return;
    }
    statusEl.hidden = false;
    const n = last.replies.size;
    let text = `${last.label}: sent to ${describeTarget(last.target)}. ${n} of ${last.expected} answered.`;
    if (last.failed.length > 0) text += ` Failed on ${last.failed.slice(0, 4).join(", ")}.`;
    statusEl.textContent = text;
    statusEl.dataset.tone = last.failed.length > 0 ? "bad" : n >= last.expected ? "good" : "plain";
  };

  const send = async (cmd: string, args: unknown, label: string) => {
    const t = target();
    const expected = rowsFor(t, rv.rows).length;
    const env = await link.send(t, cmd, args);
    if (disposed) return;
    if (!env) {
      last = null;
      statusEl.hidden = false;
      statusEl.textContent = "Not sent: the admin key in the address is not usable.";
      statusEl.dataset.tone = "bad";
      return;
    }
    last = { id: env.id, label, target: t, expected, replies: new Set(), failed: [] };
    renderStatus();
  };

  // List view

  const renderRow = (r: FrameRow): HTMLElement => {
    const row = make("button", "hca-row");
    row.type = "button";
    row.dataset.frame = r.frame;
    const on = selected.has(r.frame);
    row.classList.toggle("is-selected", on);
    row.setAttribute("aria-pressed", String(on));
    const check = make("span", "hca-check");
    if (on) check.append(icon("check"));
    const main = make("div", "hca-row-main");
    const top = make("div", "hca-row-top");
    top.append(make("span", "hca-label", r.label));
    const variant = r.variant && r.variant !== "default" ? r.variant : "";
    top.append(make("span", "hca-app", variant ? `${r.app} · ${variant}` : r.app));
    const tag = (text: string, kind: string) => top.append(make("span", `hca-tag ${kind}`, text));
    if (r.hub) tag("hub", "is-hub");
    if (r.self) tag(page ? "this console" : "this frame", "is-self");
    // A frame's answer is newer than the status it sends every few seconds.
    const st = states.get(r.frame);
    if (st ? st.override !== null : r.override) {
      tag(st?.keep === "once" ? "override until reload" : "override", "is-override");
    }
    if (r.duplicate) tag("duplicate id", "is-warn");
    if (r.errors > 0) tag(plural(r.errors, "error"), "is-warn");
    main.append(top, make("div", "hca-sub", describeRow(r)));
    const facts = make("div", "hca-facts");
    for (const f of rowFacts(r)) facts.append(make("span", "", f));
    const a = answers.get(r.frame);
    if (a) {
      const s = make(
        "span",
        "",
        `${a.cmd} ${a.ok ? "done" : `failed${a.error ? ` (${a.error})` : ""}`} ${since(Date.now() - a.at)}`,
      );
      s.dataset.tone = a.ok ? "good" : "bad";
      facts.append(s);
    }
    main.append(facts);
    if (r.errors > 0 && r.lastError) main.append(make("div", "hca-err", r.lastError));
    row.append(check, main);
    row.addEventListener("click", () => {
      origin = null;
      if (selected.has(r.frame)) selected.delete(r.frame);
      else selected.add(r.frame);
      if (view.k === "confirm") view = { k: "list" };
      render();
    });
    return row;
  };

  const renderList = (list: HTMLElement) => {
    const scroll = list.scrollTop;
    const nodes: HTMLElement[] = [];
    if (rv.rows.length === 0) {
      nodes.push(
        make(
          "div",
          "hca-empty",
          room.status === "online" ? "No frames in this room yet." : "Connecting to the room.",
        ),
      );
    }
    for (const z of rv.zones) {
      nodes.push(make("div", "hca-zone", z.zone === null ? "No zone" : `Zone ${z.zone}`));
      for (const s of z.sides) {
        if (s.side !== null) nodes.push(make("div", "hca-side", `Side ${sideName(s.side)}`));
        for (const r of s.rows) nodes.push(renderRow(r));
      }
    }
    if (rv.consoles.length > 0) {
      const box = make("div", "hca-consoles");
      box.append(make("b", "", "Admin consoles: "));
      box.append(
        rv.consoles
          .map((c) => {
            const facts = [c.frame === room.self ? "this one" : "", c.rtt ? `${c.rtt} ms` : ""];
            const extra = facts.filter(Boolean).join(", ");
            return extra ? `${c.frame} (${extra})` : c.frame;
          })
          .join(", "),
      );
      nodes.push(box);
    }
    list.replaceChildren(...nodes);
    // Writing scrollTop stops a fling, so only when the swap moved it.
    if (list.scrollTop !== scroll) list.scrollTop = scroll;
  };

  const renderChips = (chips: HTMLElement) => {
    const scroll = chips.scrollLeft;
    chips.replaceChildren();
    const none = button(
      "None",
      () => {
        origin = null;
        selected.clear();
        view = { k: "list" };
        render();
      },
      "hca-chip",
    );
    for (const s of buildSelectors(rv.rows)) {
      const chip = button(
        s.label,
        () => {
          origin = s;
          selected.clear();
          for (const r of rowsFor(s.target, rv.rows)) selected.add(r.frame);
          view = { k: "list" };
          render();
        },
        "hca-chip",
      );
      if (origin?.id === s.id) chip.classList.add("is-on");
      chips.append(chip);
      if (s.id === "all") chips.append(none);
    }
    if (chips.scrollLeft !== scroll) chips.scrollLeft = scroll;
  };

  const renderFoot = (foot: HTMLElement) => {
    foot.replaceChildren();
    const count = targetRows().length;
    const none = count === 0 && !origin;
    if (view.k === "confirm") {
      const { ask, go } = CONFIRM[view.cmd];
      const cmd = view.cmd;
      const box = make("div", "hca-confirm");
      box.append(make("span", "", `${ask} ${plural(count, "frame")}?`));
      box.append(
        button("Cancel", () => {
          view = { k: "list" };
          render();
        }),
        button(
          go,
          () => {
            view = { k: "list" };
            void send(cmd, undefined, go);
            render();
          },
          "is-primary",
        ),
      );
      foot.append(box);
      return;
    }
    const label = make("div", "hca-count");
    if (origin) label.append(make("b", "", origin.label), `: ${plural(count, "frame")}`);
    else label.append(none ? "Tap frames to select them" : `${plural(count, "frame")} selected`);
    const actions = make("div", "hca-actions");
    const act = (text: string, fn: () => void, iconName?: IconName, cls = "") => {
      const b = button(text, fn, cls, iconName);
      b.disabled = none;
      actions.append(b);
    };
    act("Identify", () => void send("identify", { ms: IDENTIFY_MS }, "Identify"), "touch");
    act("App", () => openSheet("app"), "play");
    act("Setup", () => openSheet("setup"));
    act("Notice", () => openSheet("notice"));
    act("Logs", () => openLogs());
    act("Reset", () => confirm("reset"), "reset");
    act("Reload", () => confirm("reload"), "reset", "is-danger");
    act("Clear override", () => confirm("clear"), "close", "is-danger");
    foot.append(label, actions);
  };

  const confirm = (cmd: Confirmable) => {
    view = { k: "confirm", cmd };
    render();
  };

  // Sheets

  const field = (label: string, ...content: (HTMLElement | string)[]): HTMLElement => {
    const f = make("div", "hca-field");
    f.append(make("div", "hca-field-label", label), ...content);
    return f;
  };

  const choices = <T>(
    items: readonly { value: T; label: string }[],
    current: T,
    onPick: (value: T) => void,
  ): HTMLElement => {
    const row = make("div", "hca-choices");
    for (const item of items) {
      const b = button(item.label, () => onPick(item.value));
      if (Object.is(item.value, current)) b.classList.add("is-on");
      b.setAttribute("aria-pressed", String(Object.is(item.value, current)));
      row.append(b);
    }
    return row;
  };

  const stepper = (
    value: number | null,
    min: number,
    max: number,
    step: number,
    show: (v: number) => string,
    onChange: (v: number) => void,
  ): HTMLElement => {
    const wrap = make("div", "hca-stepper");
    const places = decimals(step);
    const set = (v: number) => onChange(Number(Math.min(max, Math.max(min, v)).toFixed(places)));
    const minus = button("", () => set((value ?? min + step) - step), "hca-icon-btn", "down");
    minus.setAttribute("aria-label", "Less");
    const plus = button("", () => set((value ?? min - step) + step), "hca-icon-btn", "up");
    plus.setAttribute("aria-label", "More");
    minus.disabled = value !== null && value <= min;
    plus.disabled = value !== null && value >= max;
    wrap.append(
      minus,
      make("span", "hca-stepper-value", value === null ? "keep" : show(value)),
      plus,
    );
    return wrap;
  };

  /**
   * Ticks for an `apps` option: each registered app, and under it each of its variants as an
   * `app:variant` preset. Sent as comma-joined tokens in registry order. Tokens this console
   * doesn't know (an app or variant from another build) are kept and listed so they can be
   * unticked.
   */
  const appSet = (value: OptionValue, onChange: (v: OptionValue) => void): HTMLElement => {
    const current = String(value)
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const chosen = new Set(current);
    const known: string[] = [];
    for (const app of opts.apps) {
      known.push(app.id);
      for (const v of app.variants ?? []) known.push(`${app.id}:${v.id}`);
    }
    // Remembered for the sheet's lifetime, so an unticked one stays on screen to tick again.
    for (const t of current) if (!known.includes(t)) strayTokens.add(t);
    const unknown = [...strayTokens];
    const toggle = (token: string) => {
      const next = new Set(chosen);
      if (next.has(token)) next.delete(token);
      else next.add(token);
      onChange([...known, ...unknown].filter((t) => next.has(t)).join(","));
    };
    const tile = (token: string, label: string, preset: boolean) => {
      const on = chosen.has(token);
      const b = make("button", `hca-btn hca-checkitem${preset ? " is-preset" : ""}`);
      b.type = "button";
      b.dataset.token = token;
      b.setAttribute("role", "checkbox");
      b.setAttribute("aria-checked", String(on));
      b.classList.toggle("is-on", on);
      const tick = make("span", "hca-check");
      if (on) tick.append(icon("check"));
      b.append(tick, make("span", "", label));
      b.addEventListener("click", () => toggle(token));
      return b;
    };
    const box = make("div", "hca-checks");
    for (const app of opts.apps) {
      const group = make("div", "hca-checkgroup");
      group.append(tile(app.id, app.hidden ? `${app.title} (tool)` : app.title, false));
      // A single variant is the app itself, so only real choices become presets.
      if ((app.variants?.length ?? 0) > 1) {
        for (const v of app.variants ?? []) group.append(tile(`${app.id}:${v.id}`, v.title, true));
      }
      box.append(group);
    }
    if (unknown.length > 0) {
      const group = make("div", "hca-checkgroup");
      group.append(make("div", "hca-field-note", "Not in this version"));
      for (const t of unknown) group.append(tile(t, t, true));
      box.append(group);
    }
    const wrap = make("div");
    wrap.append(
      box,
      make("div", "hca-field-note", "Each tick is a tile. None ticked means every suitable app."),
    );
    return wrap;
  };

  /**
   * A text field for operator text. Typing updates the draft without redrawing the sheet, which
   * would drop focus; `onCommit` runs when the field loses focus. Frames have no keyboard, so
   * there it only shows the text, which Run sends on unchanged.
   */
  const textInput = (
    def: Extract<OptionDef, { type: "text" }>,
    value: OptionValue,
    onInput: (v: string) => void,
    onCommit: () => void,
  ): HTMLElement => {
    const input = make("input", "hca-input");
    input.type = "text";
    input.maxLength = def.maxLength;
    input.autocomplete = "off";
    input.dataset.option = def.key;
    input.value = String(value).slice(0, def.maxLength);
    input.disabled = !page;
    if (def.default) input.placeholder = def.default;
    input.addEventListener("input", () => onInput(input.value.slice(0, def.maxLength)));
    input.addEventListener("change", onCommit);
    const note = page
      ? `Up to ${def.maxLength} characters.${def.default ? " Empty uses the default." : ""}`
      : "Type this on the admin page.";
    const wrap = make("div");
    wrap.append(input, make("div", "hca-field-note", note));
    return wrap;
  };

  const optionControl = (
    def: Exclude<OptionDef, { type: "text" }>,
    value: OptionValue,
    onChange: (v: OptionValue) => void,
  ) => {
    if (def.type === "apps") return appSet(value, onChange);
    if (def.type === "enum") {
      return choices(
        def.values.map((v) => ({ value: v.id as OptionValue, label: v.title })),
        value,
        onChange,
      );
    }
    if (def.type === "boolean") {
      return choices(
        [
          { value: true as OptionValue, label: "On" },
          { value: false as OptionValue, label: "Off" },
        ],
        value,
        onChange,
      );
    }
    const n = typeof value === "number" ? value : def.default;
    return stepper(n, def.min, def.max, def.step, (v) => v.toFixed(decimals(def.step)), onChange);
  };

  const appSheet = (): { content: HTMLElement[]; go: HTMLButtonElement } => {
    const content: HTMLElement[] = [];
    const apps = [...opts.apps].sort((a, b) => Number(!!a.hidden) - Number(!!b.hidden));
    content.push(
      field(
        "App",
        choices(
          apps.map((m) => ({
            value: m.id as string | null,
            label: m.hidden ? `${m.title} (tool)` : m.title,
          })),
          appDraft.app,
          (id) => {
            appDraft = draftFor(id);
            render();
          },
        ),
      ),
    );
    const m = opts.apps.find((x) => x.id === appDraft.app);
    if (m?.variants && m.variants.length > 1) {
      content.push(
        field(
          "Variant",
          choices(
            m.variants.map((v) => ({ value: v.id as string | null, label: v.title })),
            appDraft.variant,
            (id) => {
              appDraft = { ...appDraft, variant: id };
              render();
            },
          ),
        ),
      );
    }
    // Options for other kinds of frame, or that another option's value hides, are left out;
    // with a mixed selection, say where one applies.
    const kinds = [...new Set(targetRows().map((r) => r.kind as FrameKind))];
    const defs = m?.options ?? [];
    const shownKeys = () =>
      defs
        .filter((d) => optionShown(d, defs, appDraft.options, kinds))
        .map((d) => d.key)
        .join(",");
    const shown = shownKeys();
    for (const def of defs) {
      if (!optionShown(def, defs, appDraft.options, kinds)) continue;
      const only = def.kinds;
      const partial = only && kinds.some((k) => !only.includes(k));
      const setDraft = (v: OptionValue) => {
        appDraft = { ...appDraft, options: { ...appDraft.options, [def.key]: v } };
      };
      const value = appDraft.options[def.key] ?? optionDefault(def);
      content.push(
        field(
          partial
            ? `${def.title} (${only.map((k) => KIND_PLURAL[k]).join(" and ")} only)`
            : def.title,
          def.type === "text"
            ? textInput(def, value, setDraft, () => {
                // Redrawing drops focus and can swallow a tap on Run, so only when it matters.
                if (shownKeys() !== shown) render();
              })
            : optionControl(def, value, (v) => {
                setDraft(v);
                render();
              }),
        ),
      );
    }
    const go = button(
      m ? `Run ${m.title}` : "Pick an app",
      () => {
        if (!m) return;
        const variants = m.variants ?? [];
        const config: FrameConfig = {
          app: m.id,
          variant:
            appDraft.variant && appDraft.variant !== variants[0]?.id ? appDraft.variant : null,
          options: appDraft.options,
        };
        view = { k: "list" };
        void send("set", { config, merge: true, keep: keepDraft }, `Run ${m.title}`);
        render();
      },
      "is-primary",
    );
    go.disabled = !m;
    return { content, go };
  };

  const setupSheet = (): { content: HTMLElement[]; go: HTMLButtonElement } => {
    const keep = { value: undefined, label: "Keep" };
    const update = (patch: FrameConfig) => {
      setupDraft = { ...setupDraft, ...patch };
      for (const k of Object.keys(setupDraft) as (keyof FrameConfig)[]) {
        if (setupDraft[k] === undefined) delete setupDraft[k];
      }
      render();
    };
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    const groups = [...new Set([...rv.rows.map((r) => r.group), ...GROUP_CHOICES])];
    const content = [
      field(
        "Setup",
        choices<FrameConfig["setup"]>(
          [keep, ...SETUPS.map((s) => ({ value: s, label: cap(s) }))],
          setupDraft.setup,
          (setup) => update({ setup }),
        ),
      ),
      field(
        "Role",
        choices<FrameConfig["role"]>(
          [keep, ...ROLES.map((r) => ({ value: r, label: cap(r) }))],
          setupDraft.role,
          (role) => update({ role }),
        ),
      ),
      field(
        "Group",
        choices<string | undefined>(
          [keep, ...groups.map((g) => ({ value: g, label: g }))],
          setupDraft.group,
          (group) => update({ group }),
        ),
      ),
      field(
        "Side",
        choices<number | undefined>(
          [keep, { value: 0, label: "A" }, { value: 1, label: "B" }],
          setupDraft.side,
          (side) => update({ side }),
        ),
      ),
      field(
        "Position, counting from the left",
        stepper(
          setupDraft.pos ?? null,
          0,
          63,
          1,
          (v) => String(v + 1),
          (pos) => update({ pos }),
        ),
        button("Keep", () => update({ pos: undefined }), "hca-chip"),
      ),
      field(
        "Touch frames in the setup",
        stepper(setupDraft.count ?? null, 1, 64, 1, String, (count) => update({ count })),
        button("Keep", () => update({ count: undefined }), "hca-chip"),
      ),
    ];
    if (page) {
      const input = make("input", "hca-input");
      input.type = "text";
      input.maxLength = 64;
      input.placeholder = "Other group";
      input.value = setupDraft.group && !groups.includes(setupDraft.group) ? setupDraft.group : "";
      input.addEventListener("change", () =>
        update({ group: plainText(input.value, 64) ?? undefined }),
      );
      content[2]?.append(input);
    }
    const go = button(
      "Apply setup",
      () => {
        view = { k: "list" };
        void send("set", { config: setupDraft, merge: true, keep: keepDraft }, "Setup");
        render();
      },
      "is-primary",
    );
    go.disabled = Object.keys(setupDraft).length === 0;
    return { content, go };
  };

  const noticeSheet = (): { content: HTMLElement[]; go: HTMLButtonElement } => {
    const content = [
      field(
        "Message",
        choices(
          PRESET_NOTICES.map((t) => ({ value: t as string, label: t })),
          noticeDraft.custom ? "" : noticeDraft.text,
          (text) => {
            noticeDraft = { ...noticeDraft, text, custom: "" };
            render();
          },
        ),
      ),
    ];
    if (page) {
      const input = make("input", "hca-input");
      input.type = "text";
      input.maxLength = NOTICE_MAX;
      input.placeholder = `Or type a message (up to ${NOTICE_MAX} characters)`;
      input.value = noticeDraft.custom;
      input.addEventListener("input", () => {
        noticeDraft = { ...noticeDraft, custom: input.value.slice(0, NOTICE_MAX) };
        for (const b of content[0]?.querySelectorAll(".hca-choices .hca-btn") ?? []) {
          b.classList.toggle("is-on", !noticeDraft.custom && b.textContent === noticeDraft.text);
        }
      });
      content[0]?.append(input);
    }
    content.push(
      field(
        "Show for",
        choices(
          NOTICE_TIMES.map((t) => ({ value: t.ms, label: t.label })),
          noticeDraft.ms,
          (ms) => {
            noticeDraft = { ...noticeDraft, ms };
            render();
          },
        ),
      ),
    );
    const go = button(
      "Show notice",
      () => {
        const text = plainText(noticeDraft.custom, NOTICE_MAX) ?? noticeDraft.text;
        view = { k: "list" };
        void send("notice", { text, ms: noticeDraft.ms }, "Notice");
        render();
      },
      "is-primary",
    );
    return { content, go };
  };

  /**
   * The app sheet's starting point for `app`: its defaults, overlaid with the variant and options
   * the selected frames already run when they all share one override of that app, so editing
   * keeps what is there (presets in an `apps` option included).
   */
  const draftFor = (app: string | null): typeof appDraft => {
    strayTokens.clear();
    const m = opts.apps.find((x) => x.id === app);
    const options: Record<string, OptionValue> = {};
    for (const d of m?.options ?? []) options[d.key] = optionDefault(d);
    let variant = m?.variants?.[0]?.id ?? null;
    const overrides = targetRows().map((r) => states.get(r.frame)?.override ?? null);
    const first = overrides[0];
    const shared =
      first?.app === app && overrides.every((o) => JSON.stringify(o) === JSON.stringify(first));
    if (m && first && shared) {
      if (first.variant && m.variants?.some((v) => v.id === first.variant)) variant = first.variant;
      for (const d of m.options ?? []) {
        const v = first.options?.[d.key];
        if (v !== undefined) options[d.key] = v;
      }
    }
    return { app, variant, options };
  };

  const openSheet = (k: "app" | "setup" | "notice") => {
    keepDraft = "session";
    if (k === "setup") setupDraft = {};
    if (k === "app") {
      // Start from what the selected frames run when they all agree.
      const apps = new Set(targetRows().map((r) => states.get(r.frame)?.override?.app ?? r.app));
      const only = apps.size === 1 ? [...apps][0] : undefined;
      appDraft = draftFor(only && opts.apps.some((a) => a.id === only) ? only : null);
    }
    view = { k };
    render();
  };

  const renderSheet = (k: "app" | "setup" | "notice") => {
    const titles = { app: "Run an app", setup: "Change setup", notice: "Show a notice" };
    const sheet = k === "app" ? appSheet() : k === "setup" ? setupSheet() : noticeSheet();
    const sheetHead = make("div", "hca-sheet-head");
    sheetHead.append(
      button(
        "Back",
        () => {
          view = { k: "list" };
          render();
        },
        "hca-back",
        "up",
      ),
      make("span", "hca-sheet-title", titles[k]),
    );
    const prevBody = body.querySelector(".hca-sheet-body");
    const scroll = prevBody?.scrollTop ?? 0;
    const sheetBody = make("div", "hca-sheet-body");
    sheetBody.append(...sheet.content);
    const foot = make("div", "hca-foot");
    const n = targetRows().length;
    const label = make("div", "hca-count");
    label.append(
      origin ? `${origin.label}: ${plural(n, "frame")}` : `${plural(n, "frame")} selected`,
    );
    foot.append(label);
    if (k !== "notice") {
      const lasts = field(
        "Lasts",
        choices(KEEP_CHOICES, keepDraft, (keep) => {
          keepDraft = keep;
          render();
        }),
      );
      if (keepDraft === "once") {
        lasts.append(
          make("div", "hca-field-note", "Frames reload by themselves about every 12 hours."),
        );
      }
      foot.append(lasts);
    }
    foot.append(sheet.go);
    body.replaceChildren(sheetHead, sheetBody, foot);
    body.classList.remove("is-list");
    sheetBody.scrollTop = scroll;
    shell = null;
  };

  const listShell = () => {
    if (shell && shell.list.parentElement === body) return shell;
    const next = {
      chips: make("div", "hca-chips"),
      list: make("div", "hca-list"),
      foot: make("div", "hca-foot"),
    };
    next.list.addEventListener("scroll", () => {
      scrolledAt = Date.now();
    });
    body.replaceChildren(next.chips, next.list, next.foot);
    body.classList.add("is-list");
    shell = next;
    return next;
  };

  const openLogs = () => {
    const frames = targetRows().map((r) => ({ frame: r.frame, label: r.label }));
    if (frames.length === 0) return;
    view = { k: "logs", frames };
    render();
  };

  const render = () => {
    if (disposed) return;
    renderQueued = false;
    lastRender = Date.now();
    refreshRoster();
    renderSummary();
    renderStatus();
    if (view.k !== "logs" && logView) {
      logView.dispose();
      logView = null;
    }
    if (view.k === "logs") {
      if (!logView) {
        logView = createLogView({
          link,
          frames: view.frames,
          page,
          onBack: () => {
            view = { k: "list" };
            render();
          },
        });
        body.replaceChildren(logView.el);
        body.classList.remove("is-list");
        shell = null;
      }
      return;
    }
    if (view.k === "app" || view.k === "setup" || view.k === "notice") {
      renderSheet(view.k);
      return;
    }
    const { chips, list, foot } = listShell();
    renderChips(chips);
    renderList(list);
    renderFoot(foot);
  };

  /** Roster and status changes re-render at most once a second, and never mid-press. */
  const scheduleRender = (delay?: number) => {
    if (renderQueued || disposed) return;
    renderQueued = true;
    const wait = delay ?? Math.max(0, lastRender + RENDER_EVERY_MS - Date.now());
    renderTimer = setTimeout(() => {
      renderQueued = false;
      if (view.k === "app" || view.k === "setup" || view.k === "notice" || view.k === "logs") {
        // Keep a sheet still while the operator works in it; only the header follows the room.
        refreshRoster();
        renderSummary();
        return;
      }
      if (pressing || Date.now() - scrolledAt < 800) {
        scheduleRender(300);
        return;
      }
      render();
    }, wait);
  };

  const refreshHub = () => {
    if (room.hub === hubFrame) return;
    hubFrame = room.hub;
    scheduleRender();
  };

  let pingAt = 0;
  const pingMissing = () => {
    const now = Date.now();
    if (now - pingAt < PING_EVERY_MS || room.status !== "online") return;
    const missing = rv.rows.filter((r) => !states.has(r.frame)).map((r) => r.frame);
    if (missing.length === 0) return;
    pingAt = now;
    void link.send({ k: "frames", ids: [...new Set(missing)].slice(0, 128) }, "ping");
  };

  const onPress = () => {
    pressing = true;
  };
  const onRelease = () => {
    if (!pressing) return;
    pressing = false;
  };
  el.addEventListener("pointerdown", onPress, true);
  window.addEventListener("pointerup", onRelease, true);
  window.addEventListener("pointercancel", onRelease, true);
  cleanups.push(() => {
    window.removeEventListener("pointerup", onRelease, true);
    window.removeEventListener("pointercancel", onRelease, true);
  });

  cleanups.push(
    link.on((env) => {
      if (env.cmd !== "state") return;
      const s = readState(env.args);
      if (!s) return;
      states.set(env.from, s);
      if (s.ref && s.cmd && s.cmd !== "ping") {
        const a: Answer = { cmd: s.cmd, ok: s.ok !== false, at: Date.now() };
        if (s.error) a.error = s.error;
        answers.set(env.from, a);
      }
      if (last && s.ref === last.id && !last.replies.has(env.from)) {
        last.replies.add(env.from);
        if (s.ok === false) {
          last.failed.push(rv.rows.find((r) => r.frame === env.from)?.label ?? env.from);
        }
        renderStatus();
      }
      scheduleRender();
    }),
    room.onRoster(() => {
      refreshHub();
      scheduleRender();
      pingMissing();
    }),
    room.onStatus(() => {
      scheduleRender();
      if (room.status === "online") void link.send({ k: "all" }, "ping");
    }),
  );
  const tick = setInterval(() => {
    refreshHub();
    pingMissing();
    // Keeps "x s ago" and the connection state current.
    scheduleRender();
  }, HUB_POLL_MS);
  cleanups.push(() => clearInterval(tick));

  render();
  refreshHub();
  if (room.status === "online") {
    pingAt = Date.now();
    void link.send({ k: "all" }, "ping");
  }

  return {
    el,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(renderTimer);
      logView?.dispose();
      for (const fn of cleanups.splice(0)) fn();
      el.remove();
    },
  };
};
