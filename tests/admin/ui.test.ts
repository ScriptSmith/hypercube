// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FrameState } from "../../src/core/admin/agent";
import type { AdminDeps } from "../../src/core/admin/deps";
import type { AdminLink } from "../../src/core/admin/link";
import { PANEL_IDLE_MS, startFrameUi } from "../../src/core/admin/overlay";
import { createPanel, type PanelHandle } from "../../src/core/admin/panel";
import { ensureAdminStyles } from "../../src/core/admin/style";
import type { Envelope } from "../../src/core/admin/sign";
import type { Target } from "../../src/core/admin/target";
import { derivePinVerifier, generateAdminKey } from "../../src/core/adminkey";
import { listApps } from "../../src/core/registry";
import type {
  AppManifest,
  FrameInfo,
  FrameKind,
  OptionDef,
  Room,
  RosterEntry,
} from "../../src/core/types";
import { firePointer, panelFrame } from "../input/dom";

const AK = generateAdminKey();
const PV = await derivePinVerifier("4821", AK);
const realTimeout = setTimeout;

// jsdom has no ResizeObserver; the overlay only uses it to follow stage resizes.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const entry = (frame: string, over: Partial<RosterEntry> = {}): RosterEntry => ({
  frame,
  app: "idle",
  group: "bank",
  kind: "panel",
  role: "station",
  pos: 0,
  joinedAt: 1,
  ...over,
});

const fakeRoom = (self: string, roster: RosterEntry[]) => {
  const rosterCbs = new Set<(r: readonly RosterEntry[]) => void>();
  const room = {
    status: "online",
    isHub: false,
    self,
    clock: { now: () => Date.now(), synced: true, onSync: () => () => {} },
    roster: () => roster,
    onRoster(cb: (r: readonly RosterEntry[]) => void) {
      rosterCbs.add(cb);
      return () => rosterCbs.delete(cb);
    },
    onStatus: () => () => {},
    stats: async () => ({ hub: "p1", connections: 1, candidates: [], bytesIn: 0, bytesOut: 0 }),
  } as unknown as Room;
  return room;
};

interface Sent {
  target: Target;
  cmd: string;
  args: unknown;
  id: string;
}

const fakeLink = (self: string) => {
  const sent: Sent[] = [];
  const listeners = new Set<(env: Envelope) => void>();
  const link: AdminLink = {
    self,
    async send(target, cmd, args) {
      const id = `cmd-${sent.length + 1}-xxxxxxxx`;
      sent.push({ target, cmd, args, id });
      return { v: 1, id, ts: Date.now(), from: self, target, cmd, args, sig: "" };
    },
    on(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    rejected: { malformed: 0, sender: 0, signature: 0, stale: 0, replay: 0, overflow: 0 },
    dispose() {},
  };
  const reply = (from: string, state: Partial<FrameState>) => {
    const args: FrameState = {
      setup: "bank",
      role: "station",
      group: "bank",
      side: 0,
      pos: 0,
      count: 3,
      app: "idle",
      variant: null,
      override: null,
      ...state,
    };
    const env: Envelope = {
      v: 1,
      id: `state-${Math.random()}`,
      ts: Date.now(),
      from,
      target: { k: "all" },
      cmd: "state",
      args,
      sig: "",
    };
    for (const cb of listeners) cb(env);
  };
  const emit = (from: string, cmd: string, args: unknown) => {
    const env: Envelope = {
      v: 1,
      id: `e-${Math.random()}`,
      ts: Date.now(),
      from,
      target: { k: "all" },
      cmd,
      args,
      sig: "",
    };
    for (const cb of listeners) cb(env);
  };
  return { link, sent, reply, emit };
};

const buttonByText = (root: ParentNode, text: string): HTMLButtonElement => {
  const b = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (x) => x.textContent?.trim() === text,
  );
  if (!b) throw new Error(`no button "${text}"`);
  return b;
};

const ROSTER = [
  entry("p1", { zone: "A", pos: 0, display: "P1", status: { errors: 0, logErrors: 3 } }),
  entry("p2", { zone: "A", pos: 1, display: "P2" }),
  entry("p3", { zone: "B", pos: 0, display: "P3", group: "solo" }),
  entry("admin-1", { app: "admin", group: "admin", kind: "kiosk", role: "solo" }),
];

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("panel", () => {
  let panel: PanelHandle;
  afterEach(() => panel.dispose());

  const open = (mode: "frame" | "page") => {
    const room = fakeRoom("admin-1", ROSTER);
    const f = fakeLink("admin-1");
    const onLock = vi.fn();
    panel = createPanel({ mode, room, link: f.link, apps: listApps(), onLock });
    document.body.append(panel.el);
    return { ...f, onLock };
  };

  it("lists frames by zone, keeps consoles apart and asks frames for their state", () => {
    const { sent } = open("page");
    const rows = [...panel.el.querySelectorAll<HTMLElement>(".hca-row")];
    expect(rows.map((r) => r.dataset.frame)).toEqual(["p1", "p2", "p3"]);
    expect([...panel.el.querySelectorAll(".hca-zone")].map((z) => z.textContent)).toEqual([
      "Zone A",
      "Zone B",
    ]);
    expect(panel.el.querySelector(".hca-consoles")?.textContent).toContain("admin-1");
    expect(sent[0]).toMatchObject({ cmd: "ping", target: { k: "all" } });
  });

  it("sends commands to the selected frames and counts answers", async () => {
    const { sent, reply } = open("frame");
    expect(buttonByText(panel.el, "Identify").disabled).toBe(true);
    panel.el.querySelector<HTMLElement>('.hca-row[data-frame="p2"]')?.click();
    buttonByText(panel.el, "Identify").click();
    await Promise.resolve();
    expect(sent.at(-1)).toMatchObject({
      cmd: "identify",
      target: { k: "frames", ids: ["p2"] },
      args: { ms: 10_000 },
    });
    reply("p2", { ref: sent.at(-1)?.id, cmd: "identify", ok: true });
    expect(panel.el.querySelector(".hca-status")?.textContent).toBe(
      "Identify: sent to 1 frame. 1 of 1 answered.",
    );
  });

  it("selects by zone and confirms a reload before sending it", async () => {
    const { sent } = open("frame");
    buttonByText(panel.el, "Zone A").click();
    expect(panel.el.querySelectorAll(".hca-row.is-selected")).toHaveLength(2);
    buttonByText(panel.el, "Reload").click();
    expect(panel.el.querySelector(".hca-confirm")?.textContent).toContain("Reload 2 frames?");
    const before = sent.length;
    buttonByText(panel.el.querySelector(".hca-confirm") as HTMLElement, "Reload").click();
    await Promise.resolve();
    expect(sent.length).toBe(before + 1);
    expect(sent.at(-1)).toMatchObject({ cmd: "reload", target: { k: "zone", zone: "A" } });
  });

  it("sets an app with its default options, merging into the override", async () => {
    const { sent } = open("frame");
    buttonByText(panel.el, "All").click();
    buttonByText(panel.el, "App").click();
    buttonByText(panel.el, "Station demo (tool)").click();
    expect(panel.el.querySelector(".hca-stepper-value")?.textContent).toBe("6");
    buttonByText(panel.el, "Run Station demo").click();
    await Promise.resolve();
    expect(sent.at(-1)).toMatchObject({
      cmd: "set",
      target: { k: "all" },
      args: {
        config: { app: "stationdemo", variant: null, options: { count: 6 } },
        merge: true,
        keep: "session",
      },
    });
  });

  it("lets the operator keep an override only until the frame next reloads", async () => {
    const { sent, reply } = open("frame");
    panel.el.querySelector<HTMLElement>('.hca-row[data-frame="p2"]')?.click();
    buttonByText(panel.el, "App").click();
    buttonByText(panel.el, "Station demo (tool)").click();
    const lasts = () =>
      panel.el.querySelector(".hca-foot .hca-btn.is-on")?.textContent?.trim() ?? "";
    expect(lasts()).toBe("Until the browser closes");
    buttonByText(panel.el, "Until the next reload").click();
    expect(lasts()).toBe("Until the next reload");
    expect(panel.el.querySelector(".hca-foot .hca-field-note")?.textContent).toContain("12 hours");
    buttonByText(panel.el, "Run Station demo").click();
    await Promise.resolve();
    expect(sent.at(-1)).toMatchObject({ cmd: "set", args: { keep: "once" } });

    // The choice starts afresh with the next sheet.
    buttonByText(panel.el, "Setup").click();
    expect(lasts()).toBe("Until the browser closes");
    buttonByText(panel.el, "Back").click();

    reply("p2", { app: "stationdemo", override: { app: "stationdemo" }, keep: "once" });
    await vi.waitFor(() => {
      const tags = [...panel.el.querySelectorAll('.hca-row[data-frame="p2"] .hca-tag')];
      expect(tags.map((t) => t.textContent)).toContain("override until reload");
    }, 3000);
  });

  const medleyApps = (): AppManifest[] => [
    ...listApps(),
    {
      id: "medley",
      title: "Medley",
      category: "tool",
      blurb: "Rotates through other apps.",
      setups: [{ setup: "solo", kinds: ["panel"] }],
      network: "none",
      options: [
        { type: "apps", key: "pool", title: "Apps to rotate", default: ["diag", "duel:defence"] },
      ],
    },
    {
      id: "duel",
      title: "Duel",
      category: "game",
      blurb: "Two players.",
      setups: [{ setup: "solo", kinds: ["panel"] }],
      network: "none",
      variants: [
        { id: "classic", title: "Classic" },
        { id: "defence", title: "Defence" },
      ],
    },
  ];

  const openMedley = (mode: "frame" | "page" = "frame") => {
    const room = fakeRoom("admin-1", ROSTER);
    const f = fakeLink("admin-1");
    panel = createPanel({ mode, room, link: f.link, apps: medleyApps(), onLock: () => {} });
    document.body.append(panel.el);
    return f;
  };
  const tiles = () =>
    [...panel.el.querySelectorAll<HTMLElement>(".hca-checkitem")].map(
      (b) => `${b.dataset.token}:${b.getAttribute("aria-checked")}`,
    );
  const tick = (token: string) =>
    panel.el.querySelector<HTMLElement>(`.hca-checkitem[data-token="${token}"]`)?.click();

  it("ticks apps and their variant presets for an apps option, in registry order", async () => {
    const { sent } = openMedley();
    buttonByText(panel.el, "All").click();
    buttonByText(panel.el, "App").click();
    buttonByText(panel.el, "Medley").click();
    expect(tiles()).toEqual(
      expect.arrayContaining([
        "diag:true",
        "idle:false",
        "duel:false",
        "duel:classic:false",
        "duel:defence:true",
      ]),
    );
    // Apps without a choice of variants get no presets.
    expect(tiles().some((t) => t.startsWith("diag:") && t !== "diag:true")).toBe(false);
    expect(
      panel.el
        .querySelector('.hca-checkitem[data-token="duel:classic"]')
        ?.classList.contains("is-preset"),
    ).toBe(true);
    tick("duel:classic");
    tick("diag");
    tick("duel");
    buttonByText(panel.el, "Run Medley").click();
    await Promise.resolve();
    expect(sent.at(-1)).toMatchObject({
      cmd: "set",
      args: {
        config: { app: "medley", options: { pool: "duel,duel:classic,duel:defence" } },
        merge: true,
      },
    });
  });

  it("starts from a frame's current override and keeps presets it doesn't know", async () => {
    const { sent, reply } = openMedley("page");
    panel.el.querySelector<HTMLElement>('.hca-row[data-frame="p2"]')?.click();
    reply("p2", {
      app: "medley",
      override: { app: "medley", options: { pool: "diag,ghost:night,duel:defence" } },
    });
    buttonByText(panel.el, "App").click();
    expect(panel.el.querySelector(".hca-choices .hca-btn.is-on")?.textContent).toBe("Medley");
    expect(tiles()).toEqual(
      expect.arrayContaining(["diag:true", "duel:defence:true", "ghost:night:true"]),
    );
    tick("idle");
    buttonByText(panel.el, "Run Medley").click();
    await Promise.resolve();
    expect(sent.at(-1)).toMatchObject({
      target: { k: "frames", ids: ["p2"] },
      args: { config: { options: { pool: "diag,idle,duel:defence,ghost:night" } } },
    });
    // Unticking the unknown preset drops it.
    buttonByText(panel.el, "App").click();
    tick("ghost:night");
    expect(tiles()).toContain("ghost:night:false");
  });

  it("shows an option only for the selected kinds of frame, and marks it when they mix", () => {
    const roster = [
      entry("p1", { zone: "A", display: "P1" }),
      entry("w1", { zone: "A", display: "W1", kind: "wall", role: "solo", pos: 1 }),
    ];
    const room = fakeRoom("admin-1", roster);
    const f = fakeLink("admin-1");
    const knob = (key: string, kinds?: FrameKind[]): OptionDef => ({
      type: "boolean",
      key,
      title: key,
      default: false,
      ...(kinds ? { kinds } : {}),
    });
    const app: AppManifest = {
      id: "knobs",
      title: "Knobs",
      category: "tool",
      blurb: "Options per kind.",
      setups: [{ setup: "solo", kinds: ["panel", "wall"] }],
      network: "none",
      options: [knob("everywhere"), knob("tall", ["panel", "pair"]), knob("wide", ["wall"])],
    };
    panel = createPanel({ mode: "frame", room, link: f.link, apps: [app], onLock: () => {} });
    document.body.append(panel.el);
    const labels = () =>
      [...panel.el.querySelectorAll(".hca-sheet-body .hca-field-label")].map((l) => l.textContent);

    panel.el.querySelector<HTMLElement>('.hca-row[data-frame="p1"]')?.click();
    buttonByText(panel.el, "App").click();
    buttonByText(panel.el, "Knobs").click();
    expect(labels()).toEqual(["App", "everywhere", "tall"]);

    buttonByText(panel.el, "Back").click();
    buttonByText(panel.el, "All").click();
    buttonByText(panel.el, "App").click();
    buttonByText(panel.el, "Knobs").click();
    expect(labels()).toEqual([
      "App",
      "everywhere",
      "tall (panels and pairs only)",
      "wide (walls only)",
    ]);
  });

  it("offers preset notices only on a frame, and free text on the page", async () => {
    let s = open("frame");
    buttonByText(panel.el, "All").click();
    buttonByText(panel.el, "Notice").click();
    expect(panel.el.querySelector("input")).toBeNull();
    buttonByText(panel.el, "Please wait").click();
    buttonByText(panel.el, "Show notice").click();
    await Promise.resolve();
    expect(s.sent.at(-1)).toMatchObject({
      cmd: "notice",
      args: { text: "Please wait", ms: 30_000 },
    });
    panel.dispose();

    s = open("page");
    buttonByText(panel.el, "All").click();
    buttonByText(panel.el, "Notice").click();
    const input = panel.el.querySelector<HTMLInputElement>("input.hca-input");
    expect(input?.maxLength).toBe(120);
    if (!input) throw new Error("no input");
    input.value = "Doors open at ten";
    input.dispatchEvent(new Event("input"));
    buttonByText(panel.el, "Show notice").click();
    await Promise.resolve();
    expect(s.sent.at(-1)).toMatchObject({ cmd: "notice", args: { text: "Doors open at ten" } });
  });

  it("shows a frame's logs, newest last, filtered by level", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const { sent, emit } = open("frame");
    const row = panel.el.querySelector<HTMLElement>('.hca-row[data-frame="p1"]');
    expect(row?.querySelector(".hca-tag.is-warn")?.textContent).toBe("3 errors");
    row?.click();
    buttonByText(panel.el, "Logs").click();
    await vi.advanceTimersByTimeAsync(0);
    const ask = sent.at(-1);
    expect(ask).toMatchObject({
      cmd: "logs",
      target: { k: "frames", ids: ["p1"] },
      args: { limit: 300 },
    });
    const reply = (part: number, entries: unknown[]) =>
      emit("p1", "logs-reply", {
        ref: ask?.id,
        part,
        parts: 2,
        boot: "b1",
        size: 3,
        errors: 1,
        entries,
      });
    reply(0, [
      { s: 1, t: 1000, l: "info", m: "started" },
      { s: 2, t: 2000, l: "error", m: "boom" },
    ]);
    reply(1, [{ s: 3, t: 3000, l: "warn", m: "slow" }]);
    await vi.advanceTimersByTimeAsync(300);
    const lines = () =>
      [...panel.el.querySelectorAll<HTMLElement>(".hca-log")].map((l) => l.dataset.level);
    expect(lines()).toEqual(["info", "error", "warn"]);
    expect(panel.el.querySelector(".hca-logview .hca-count")?.textContent).toContain(
      "1 of 1 frame answered",
    );
    buttonByText(panel.el, "info").click();
    expect(lines()).toEqual(["error", "warn"]);
    expect(() => buttonByText(panel.el, "Copy")).toThrow();

    // Refresh asks only for what is new since the last entry of this page load.
    buttonByText(panel.el, "Refresh").click();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.at(-1)?.args).toMatchObject({ since: { p1: { b: "b1", s: 3 } } });
    buttonByText(panel.el, "Back").click();
    expect(panel.el.querySelector(".hca-logview")).toBeNull();
    expect(panel.el.querySelectorAll(".hca-row")).toHaveLength(3);
  });

  it("offers copying logs on the page and asks a selection for fewer lines each", async () => {
    const { sent } = open("page");
    buttonByText(panel.el, "All").click();
    buttonByText(panel.el, "Logs").click();
    await Promise.resolve();
    expect(sent.at(-1)).toMatchObject({
      cmd: "logs",
      target: { k: "frames", ids: ["p1", "p2", "p3"] },
      args: { limit: 400 },
    });
    expect(buttonByText(panel.el, "Copy")).toBeTruthy();
    expect(buttonByText(panel.el, "All frames")).toBeTruthy();
  });

  /** A poll whose own question shows only once "Your own" is picked. */
  const pollApp: AppManifest = {
    id: "poll",
    title: "Poll",
    category: "visual",
    blurb: "A question with picture answers.",
    setups: [{ setup: "solo", kinds: ["panel", "wall"] }],
    network: "none",
    options: [
      {
        type: "enum",
        key: "question",
        title: "Question",
        values: [
          { id: "pets", title: "Pets" },
          { id: "custom", title: "Your own" },
        ],
        default: "pets",
      },
      {
        type: "text",
        key: "ask",
        title: "Question text",
        maxLength: 60,
        default: "",
        when: { key: "question", is: ["custom"] },
      },
      {
        type: "text",
        key: "a1",
        title: "Answer 1",
        maxLength: 16,
        default: "Yes",
        when: { key: "question", is: ["custom"] },
      },
      {
        type: "boolean",
        key: "lane",
        title: "Child lane",
        default: false,
        kinds: ["wall"],
        when: { key: "question", is: ["custom"] },
      },
    ],
  };

  const openPoll = (mode: "frame" | "page", roster = ROSTER) => {
    const room = fakeRoom("admin-1", roster);
    const f = fakeLink("admin-1");
    panel = createPanel({ mode, room, link: f.link, apps: [pollApp], onLock: () => {} });
    document.body.append(panel.el);
    return f;
  };
  const sheetLabels = () =>
    [...panel.el.querySelectorAll(".hca-sheet-body .hca-field-label")].map((l) => l.textContent);
  const textField = (key: string) =>
    panel.el.querySelector<HTMLInputElement>(`input.hca-input[data-option="${key}"]`);

  it("types operator text on the page and sends it in a set", async () => {
    const { sent } = openPoll("page");
    panel.el.querySelector<HTMLElement>('.hca-row[data-frame="p1"]')?.click();
    buttonByText(panel.el, "App").click();
    buttonByText(panel.el, "Poll").click();
    expect(sheetLabels()).toEqual(["App", "Question"]);
    buttonByText(panel.el, "Your own").click();
    // The lane is wall-only, and p1 is a panel.
    expect(sheetLabels()).toEqual(["App", "Question", "Question text", "Answer 1"]);
    const ask = textField("ask");
    if (!ask) throw new Error("no text field");
    expect(ask.disabled).toBe(false);
    expect(ask.maxLength).toBe(60);
    expect(textField("a1")?.value).toBe("Yes");
    ask.focus();
    ask.value = "Which pet is best?";
    ask.dispatchEvent(new Event("input"));
    // Typing doesn't redraw the sheet, so the field keeps focus.
    expect(textField("ask")).toBe(ask);
    expect(document.activeElement).toBe(ask);
    ask.dispatchEvent(new Event("change"));
    expect(textField("ask")).toBe(ask);
    buttonByText(panel.el, "Run Poll").click();
    await Promise.resolve();
    expect(sent.at(-1)).toMatchObject({
      cmd: "set",
      target: { k: "frames", ids: ["p1"] },
      args: {
        config: {
          app: "poll",
          options: { question: "custom", ask: "Which pet is best?", a1: "Yes", lane: false },
        },
        merge: true,
      },
    });
  });

  it("starts from the text a frame runs, and only shows it on a frame", async () => {
    const { sent, reply } = openPoll("frame");
    panel.el.querySelector<HTMLElement>('.hca-row[data-frame="p2"]')?.click();
    const options = { question: "custom", ask: "Best snack?", a1: "Fruit", lane: false };
    reply("p2", { app: "poll", override: { app: "poll", options } });
    buttonByText(panel.el, "App").click();
    const ask = textField("ask");
    expect(ask?.value).toBe("Best snack?");
    expect(ask?.disabled).toBe(true);
    expect(panel.el.querySelector(".hca-sheet-body")?.textContent).toContain(
      "Type this on the admin page.",
    );
    buttonByText(panel.el, "Run Poll").click();
    await Promise.resolve();
    expect(sent.at(-1)).toMatchObject({ args: { config: { app: "poll", options } } });
  });

  it("keeps an app's options for when a frame's picker starts it", async () => {
    // A picker's roster entry names the app it is showing; its state names the picker.
    const roster = [entry("p1", { app: "duel" }), entry("p2"), ROSTER[3]!];
    const room = fakeRoom("admin-1", roster);
    const { sent, reply, link } = fakeLink("admin-1");
    panel = createPanel({
      mode: "page",
      room,
      link,
      apps: [...medleyApps(), pollApp],
      onLock: () => {},
    });
    document.body.append(panel.el);
    const also = "Use when the picker starts Poll";
    const has = (text: string) =>
      [...panel.el.querySelectorAll("button")].some((b) => b.textContent?.trim() === text);

    // Not on a frame that runs an ordinary app.
    panel.el.querySelector<HTMLElement>('.hca-row[data-frame="p2"]')?.click();
    buttonByText(panel.el, "App").click();
    buttonByText(panel.el, "Poll").click();
    expect(has(also)).toBe(false);
    buttonByText(panel.el, "Back").click();
    panel.el.querySelector<HTMLElement>('.hca-row[data-frame="p2"]')?.click();

    panel.el.querySelector<HTMLElement>('.hca-row[data-frame="p1"]')?.click();
    reply("p1", { app: "medley", override: null });
    buttonByText(panel.el, "App").click();
    // The sheet opens on the app the picker is showing.
    expect(has("Use when the picker starts Duel")).toBe(true);
    buttonByText(panel.el, "Medley").click();
    expect(has("Use when the picker starts Medley")).toBe(false);
    buttonByText(panel.el, "Poll").click();
    buttonByText(panel.el, "Your own").click();
    const ask = textField("ask");
    if (!ask) throw new Error("no text field");
    ask.value = "Thanks for coming";
    ask.dispatchEvent(new Event("input"));
    ask.dispatchEvent(new Event("change"));
    buttonByText(panel.el, also).click();
    await Promise.resolve();
    const options = { question: "custom", ask: "Thanks for coming", a1: "Yes", lane: false };
    const last = sent.at(-1);
    expect(last).toMatchObject({
      cmd: "set",
      target: { k: "frames", ids: ["p1"] },
      args: { config: { launch: { poll: options } }, merge: true },
    });
    const args = last?.args as { config: Record<string, unknown> } | undefined;
    expect(args?.config).not.toHaveProperty("app");

    // Opening the sheet again starts from what the picker holds.
    reply("p1", { app: "medley", override: { launch: { poll: options } } });
    buttonByText(panel.el, "App").click();
    buttonByText(panel.el, "Poll").click();
    expect(textField("ask")?.value).toBe("Thanks for coming");
  });

  it("types a number option in a box on the page, and steps it on a frame", async () => {
    const clock: AppManifest = {
      id: "clock",
      title: "Clock",
      category: "visual",
      blurb: "Counts to a time.",
      setups: [{ setup: "solo", kinds: ["panel"] }],
      network: "none",
      options: [
        { type: "number", key: "hour", title: "Hour", min: 0, max: 23, step: 1, default: 17 },
      ],
    };
    const openClock = (mode: "frame" | "page") => {
      const room = fakeRoom("admin-1", ROSTER);
      const f = fakeLink("admin-1");
      panel = createPanel({ mode, room, link: f.link, apps: [clock], onLock: () => {} });
      document.body.append(panel.el);
      panel.el.querySelector<HTMLElement>('.hca-row[data-frame="p1"]')?.click();
      buttonByText(panel.el, "App").click();
      buttonByText(panel.el, "Clock").click();
      return f;
    };
    const box = () => panel.el.querySelector<HTMLInputElement>('input[data-option="hour"]');

    const { sent } = openClock("page");
    const hour = box();
    if (!hour) throw new Error("no number box");
    expect(hour.type).toBe("number");
    expect(hour.value).toBe("17");
    expect(panel.el.querySelector(".hca-stepper")).toBeNull();
    hour.value = "9";
    hour.dispatchEvent(new Event("input"));
    // Typing doesn't redraw the sheet.
    expect(box()).toBe(hour);
    hour.value = "40";
    hour.dispatchEvent(new Event("input"));
    hour.dispatchEvent(new Event("change"));
    expect(hour.value).toBe("23");
    hour.value = "8";
    hour.dispatchEvent(new Event("input"));
    buttonByText(panel.el, "Run Clock").click();
    await Promise.resolve();
    expect(sent.at(-1)).toMatchObject({ args: { config: { app: "clock", options: { hour: 8 } } } });
    panel.dispose();
    document.body.replaceChildren();

    // A frame has no keyboard.
    openClock("frame");
    expect(box()).toBeNull();
    expect(panel.el.querySelector(".hca-stepper-value")?.textContent).toBe("17");
  });

  it("hides an option when its condition fails, whatever the kinds", () => {
    const roster = [
      entry("w1", { zone: "A", display: "W1", kind: "wall", role: "solo" }),
      entry("p1", { zone: "A", display: "P1", pos: 1 }),
    ];
    openPoll("page", roster);
    buttonByText(panel.el, "All").click();
    buttonByText(panel.el, "App").click();
    buttonByText(panel.el, "Poll").click();
    expect(sheetLabels()).toEqual(["App", "Question"]);
    buttonByText(panel.el, "Your own").click();
    expect(sheetLabels()).toEqual([
      "App",
      "Question",
      "Question text",
      "Answer 1",
      "Child lane (walls only)",
    ]);
    buttonByText(panel.el, "Pets").click();
    expect(sheetLabels()).toEqual(["App", "Question"]);
  });

  it("changes only the setup fields that were picked", async () => {
    const { sent } = open("frame");
    panel.el.querySelector<HTMLElement>('.hca-row[data-frame="p1"]')?.click();
    buttonByText(panel.el, "Setup").click();
    expect(buttonByText(panel.el, "Apply setup").disabled).toBe(true);
    buttonByText(panel.el, "Corner").click();
    buttonByText(panel.el, "B").click();
    buttonByText(panel.el, "Apply setup").click();
    await Promise.resolve();
    expect(sent.at(-1)).toMatchObject({
      cmd: "set",
      args: { config: { setup: "corner", side: 1 }, merge: true },
    });
  });
});

describe("frame overlay", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"],
    });
  });

  const setup = (frame: FrameInfo = panelFrame(), pv: string | null = PV) => {
    const stage = document.createElement("div");
    const appLayer = document.createElement("div");
    const overlay = document.createElement("div");
    stage.append(appLayer, overlay);
    document.body.append(stage);
    const seen: PointerEvent[] = [];
    appLayer.addEventListener("pointerdown", (e) => seen.push(e));
    const room = fakeRoom("p1", ROSTER);
    const { link } = fakeLink("p1");
    const deps = { overlay, frame: () => frame } as unknown as AdminDeps;
    const ui = startFrameUi(deps, room, link, AK, pv);
    return { ui, appLayer, overlay, seen };
  };

  const tapCorner = async (el: HTMLElement, id: number, holdMs = 80) => {
    firePointer(el, "pointerdown", { pointerId: id, clientX: 60, clientY: 1860 });
    await vi.advanceTimersByTimeAsync(holdMs);
    firePointer(el, "pointerup", { pointerId: id, clientX: 60, clientY: 1860 });
    await vi.advanceTimersByTimeAsync(200);
  };

  const waitReal = async (ok: () => boolean) => {
    for (let i = 0; i < 400 && !ok(); i++) {
      await new Promise<void>((r) => realTimeout(r, 5));
      await vi.advanceTimersByTimeAsync(0);
    }
  };

  it("opens the PIN pad after the corner gesture without blocking the app", async () => {
    const { ui, appLayer, overlay, seen } = setup();
    for (let i = 1; i <= 5; i++) await tapCorner(appLayer, i);
    firePointer(appLayer, "pointerdown", { pointerId: 9, clientX: 60, clientY: 1860 });
    await vi.advanceTimersByTimeAsync(1900);
    expect(ui.mode).toBe("idle");
    await vi.advanceTimersByTimeAsync(200);
    expect(ui.mode).toBe("pin");
    expect(overlay.querySelector(".hca-pad")).not.toBeNull();
    expect(seen).toHaveLength(6);
    expect(seen.every((e) => !e.defaultPrevented)).toBe(true);
    ui.dispose();
  });

  it("ignores the same taps away from the corner", async () => {
    const { ui, appLayer } = setup();
    for (let i = 1; i <= 5; i++) {
      firePointer(appLayer, "pointerdown", { pointerId: i, clientX: 600, clientY: 1860 });
      firePointer(appLayer, "pointerup", { pointerId: i, clientX: 600, clientY: 1860 });
      await vi.advanceTimersByTimeAsync(300);
    }
    firePointer(appLayer, "pointerdown", { pointerId: 9, clientX: 600, clientY: 1860 });
    await vi.advanceTimersByTimeAsync(3000);
    expect(ui.mode).toBe("idle");
    ui.dispose();
  });

  it("unlocks with the PIN, then locks itself after a minute idle", async () => {
    const { ui, appLayer, overlay } = setup();
    for (let i = 1; i <= 5; i++) await tapCorner(appLayer, i);
    await tapCorner(appLayer, 9, 2100);
    expect(ui.mode).toBe("pin");
    const pad = overlay.querySelector(".hca-pad") as HTMLElement;
    for (const d of "4821") buttonByText(pad, d).click();
    pad.querySelector<HTMLButtonElement>('[aria-label="Enter"]')?.click();
    await waitReal(() => ui.mode === "panel");
    expect(ui.mode).toBe("panel");
    expect(overlay.querySelectorAll(".hca-row")).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(PANEL_IDLE_MS + 1500);
    expect(ui.mode).toBe("idle");
    expect(overlay.querySelector(".hca-panel")).toBeNull();
    ui.dispose();
  });

  it("says why it can't unlock when the URL has no PIN verifier", async () => {
    const { ui, appLayer, overlay } = setup(panelFrame(), null);
    for (let i = 1; i <= 5; i++) await tapCorner(appLayer, i);
    await tapCorner(appLayer, 9, 2100);
    expect(ui.mode).toBe("pin");
    const pad = overlay.querySelector(".hca-pad") as HTMLElement;
    expect(pad.querySelector(".hca-pad-msg")?.textContent).toContain("no PIN check (pv)");
    expect(buttonByText(pad, "4").disabled).toBe(true);
    ui.dispose();
  });

  it("puts the pad inside a wall's reachable band", async () => {
    const wall: FrameInfo = {
      ...panelFrame(),
      kind: "wall",
      venueWidth: 5760,
      venueHeight: 2160,
      width: 2880,
      height: 1080,
      unit: 0.5,
      reach: { adult: 0.45, child: 0.25 },
      reachTop: { adult: 1080 * 0.55, child: 1080 * 0.75 },
    };
    const { ui, appLayer, overlay } = setup(wall);
    const corner = async (id: number, ms: number) => {
      firePointer(appLayer, "pointerdown", { pointerId: id, clientX: 40, clientY: 1070 });
      await vi.advanceTimersByTimeAsync(ms);
      firePointer(appLayer, "pointerup", { pointerId: id, clientX: 40, clientY: 1070 });
      await vi.advanceTimersByTimeAsync(200);
    };
    for (let i = 1; i <= 5; i++) await corner(i, 80);
    await corner(9, 2100);
    expect(ui.mode).toBe("pin");
    const box = overlay.querySelector<HTMLElement>(".hca-box");
    const top = Number.parseFloat(box?.style.top ?? "0");
    const key = Number.parseFloat(box?.style.getPropertyValue("--hca-key") ?? "0");
    expect(top).toBeGreaterThanOrEqual(wall.reachTop.adult);
    expect(top + key * 6.3).toBeLessThanOrEqual(wall.height);
    expect(key).toBeGreaterThanOrEqual(140 * wall.unit);
    ui.dispose();
  });
});

describe("touch scrolling", () => {
  /**
   * Frames put the stage under `touch-action:none`, so each scrolling part of the panel must
   * allow its own pan and keep overscroll to itself; checked against real touches in the
   * browser, and pinned here so a style change can't quietly undo it.
   */
  const rule = (css: string, selector: string): string => {
    const start = css.indexOf(`${selector}{`);
    if (start < 0) throw new Error(`no rule for ${selector}`);
    return css.slice(start, css.indexOf("}", start));
  };

  it("lets the roster, logs and sheets pan vertically and keeps overscroll inside", () => {
    ensureAdminStyles();
    const css = document.getElementById("hc-admin-style")?.textContent ?? "";
    for (const selector of [".hca-list", ".hca-logs", ".hca-sheet-body"]) {
      const r = rule(css, selector);
      expect(r).toContain("overflow-y:auto");
      expect(r).toContain("touch-action:pan-y");
      expect(r).toContain("overscroll-behavior:contain");
    }
    expect(rule(css, ".hca-chips")).toContain("touch-action:pan-x");
    // Rows and buttons sit inside the scrollers and must not stop a pan that starts on them.
    expect(rule(css, ".hca-row")).toContain("touch-action:pan-y");
    expect(rule(css, ".hca-btn")).toContain("touch-action:manipulation");
    expect(css).not.toMatch(/touch-action:\s*none/);
  });
});
