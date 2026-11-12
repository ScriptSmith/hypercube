import { derivePinVerifier, generateAdminKey, generateRoomToken } from "../../core/adminkey";
import { optionShown } from "../../core/options";
import { displayFor, setActiveVenue } from "../../core/venue";
import type { AppManifest, FrameKind, OptionDef, SetupName } from "../../core/types";
import { kindGlyph } from "./art";
import {
  applyChange,
  configErrors,
  IDLE_RANGE,
  kindChoices,
  KIND_TITLE,
  type LandingConfig,
  COUNT_MAX,
  defaultReach,
  appEntries,
  optionDefault,
  setupKinds,
  spanRange,
  normalizeConfig,
  RES_RANGE,
  screenSupported,
  supportedSetups,
  supportFor,
  touchKind,
  validateAdminKey,
  validatePeer,
  validatePin,
  validateRoom,
} from "./config";
import {
  type Choice,
  choiceField,
  numberField,
  section,
  sliderField,
  switchField,
  textField,
} from "./controls";
import { diagramSvg } from "./diagram";
import { copyText, h } from "./dom";
import { artElement, CATEGORY_TITLE } from "./gallery";
import { loadPin, loadSecret, savePin, saveSecret } from "../credentials";
import { loadVenueText, readVenueText, saveVenueText } from "../venueprofile";
import { save } from "./storage";
import {
  adminUrl,
  buildUrls,
  planSetup,
  previewUrl,
  simUrl,
  type UrlEntry,
  urlListText,
} from "./urls";

const SETUP_TITLE: Record<SetupName, string> = {
  solo: "Solo",
  bank: "Bank",
  corner: "Corner",
  versus: "Versus",
};

const SETUP_HINT: Record<SetupName, string> = {
  solo: "One display on its own.",
  bank: "A row of touch frames, with the screen above if the app uses one.",
  corner: "Two banks and their screens joined at the corner, running as one.",
  versus: "Two sides playing each other. Each side is its own group.",
};

const kindHint = (kind: FrameKind, span: number): string => {
  const d = displayFor(kind, span);
  const size = `${d.width} × ${d.height}`;
  switch (kind) {
    case "panel":
      return `Portrait touch panel, ${size}.`;
    case "pair":
      return `${span} panels merged into one surface, ${size}.`;
    case "wall":
      return `Wide touch wall, ${size}. Only the lower part is in reach.`;
    case "kiosk":
      return `Landscape touch kiosk, ${size}.`;
    case "screen":
      return `Screen above the touch frames, ${size}. No touch.`;
    case "sphere":
      return `Hanging ball wrapped in one display, ${size}, ${d.widthM} m across. No touch.`;
  }
};

/** Panels and merged panels share one choice; "panels per frame" then picks between them. */
type DisplayChoice = Exclude<FrameKind, "panel" | "pair"> | "panels";

const NETWORK_TITLE: Record<AppManifest["network"], string> = {
  none: "Runs on its own. No network needed.",
  optional: "Runs alone, or linked to other frames through a room.",
  required: "Needs a room to run.",
};

const CATEGORY_GROUP: Record<AppManifest["category"], string> = {
  game: "Games",
  visual: "Visuals",
  tool: "Tools",
};

const percent = (v: number): string => `${Math.round(v * 100)}%`;

const absolute = (path: string): string => new URL(path, location.href).href;

/** What the output column shows: the URLs to paste, or the setup running in the simulator. */
export type OutputTab = "urls" | "sim";

const TABS: readonly OutputTab[] = ["urls", "sim"];

export interface Panel {
  el: HTMLElement;
  readonly app: string;
  readonly tab: OutputTab;
  open(appId: string): void;
  setTab(tab: OutputTab): void;
  /** A copy of the current settings, to put back later with `apply`. */
  snapshot(): LandingConfig;
  /** Take settings from outside the form, as the guide does when it shows other setups. */
  apply(patch: Partial<LandingConfig>): void;
  /** Stop or restart the live preview and simulator when the panel is hidden or shown. */
  setActive(active: boolean): void;
}

export const createPanel = (
  apps: readonly AppManifest[],
  saved: unknown,
  opts: {
    initialApp?: string;
    initialTab?: OutputTab;
    onAppChange(id: string): void;
    /** The operator picked a tab. */
    onTabChange?(tab: OutputTab): void;
  },
): Panel => {
  const byId = new Map(apps.map((a) => [a.id, a]));
  const fallback = apps.find((a) => !a.hidden) ?? apps[0];
  if (!fallback) throw new Error("no apps registered");
  const savedApp = (saved as { app?: unknown } | null)?.app;
  // With nothing saved, start from the app being opened so it gets its own first setup.
  const startManifest =
    byId.get(typeof savedApp === "string" ? savedApp : (opts.initialApp ?? "")) ?? fallback;

  let cfg: LandingConfig = normalizeConfig(saved, startManifest, generateRoomToken);
  // Save straight away: a new room and admin key must survive a reload even if nothing changes.
  save(cfg);
  // The PIN and the signalling secret are remembered apart from the configuration.
  let pin = loadPin();
  let secret = loadSecret(cfg.customPeer);
  // The PIN verifier, made from the PIN and the admin key. It is never saved.
  let pv: string | null = null;
  let pvState: "off" | "pending" | "ready" | "error" = "off";
  let pvSeq = 0;
  let pvTimer = 0;
  // The operator's venue profile, remembered apart from any app's settings like the PIN.
  let venueText = loadVenueText();
  let venueIgnored: string[] = [];
  let advancedOpen = cfg.standalone || venueText !== "";
  let active = false;
  let tab: OutputTab = opts.initialTab ?? "urls";

  const manifest = (): AppManifest => byId.get(cfg.app) ?? fallback;

  const head = h("header", { class: "config-head" });
  const form = h("div", { class: "config-form" });
  const outHead = h("div", { class: "out-head" });
  const errorsEl = h("div", { class: "out-errors", role: "alert" });
  const diagramHost = h("figure", { class: "diagram-wrap", "data-tour": "diagram" });
  const urlList = h("ol", { class: "urls", "data-tour": "urls" });
  const linksEl = h("div", { class: "out-links" });

  const previewFrame = h("iframe", {
    title: "Live preview",
    loading: "lazy",
  });
  const previewBox = h("div", { class: "preview-box" }, previewFrame);
  previewFrame.addEventListener("load", () => previewBox.classList.remove("is-loading"));
  const previewCaption = h("p", { class: "hint" });
  const previewOpen = h(
    "a",
    { class: "btn btn-quiet", target: "_blank", rel: "noopener" },
    "Open in a tab",
  );
  const previewEl = h(
    "section",
    { class: "preview", "aria-label": "Preview" },
    h("div", { class: "preview-head" }, h("h3", { class: "sec-title" }, "Preview"), previewOpen),
    previewBox,
    previewCaption,
  );

  const tabButtons = {
    urls: h(
      "button",
      { type: "button", role: "tab", class: "out-tab", id: "out-tab-urls" },
      "URLs",
    ),
    sim: h(
      "button",
      { type: "button", role: "tab", class: "out-tab", id: "out-tab-sim" },
      "Simulator",
    ),
  } satisfies Record<OutputTab, HTMLButtonElement>;
  const tabBar = h(
    "div",
    {
      class: "out-tabs",
      role: "tablist",
      "aria-label": "Output",
      onkeydown: (e: KeyboardEvent) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        const next = TABS[(TABS.indexOf(tab) + (e.key === "ArrowRight" ? 1 : -1) + 2) % 2]!;
        pickTab(next);
        tabButtons[next].focus();
      },
    },
    tabButtons.urls,
    tabButtons.sim,
  );
  const urlsPane = h(
    "div",
    { class: "out-pane", role: "tabpanel", "aria-labelledby": "out-tab-urls" },
    outHead,
    errorsEl,
    diagramHost,
    urlList,
    linksEl,
    previewEl,
  );

  const simFrame = h("iframe", { title: "Simulator" });
  const simBox = h("div", { class: "sim-box", "data-tour": "sim" }, simFrame);
  simFrame.addEventListener("load", () => simBox.classList.remove("is-loading"));
  const simOpen = h(
    "a",
    { class: "btn btn-quiet", target: "_blank", rel: "noopener" },
    "Open in a tab",
  );
  const simPane = h(
    "div",
    { class: "out-pane", role: "tabpanel", "aria-labelledby": "out-tab-sim" },
    h(
      "div",
      { class: "preview-head" },
      h(
        "p",
        { class: "hint" },
        "Every frame of this setup, running in this tab with a room of its own. Tap a frame's badge to focus it.",
      ),
      simOpen,
    ),
    simBox,
  );

  const output = h("div", { class: "config-out" }, tabBar, urlsPane, simPane);
  const el = h("div", { class: "config" }, head, h("div", { class: "config-grid" }, form, output));

  // PIN verifier: derived off the main path and debounced, because PBKDF2 takes a moment.
  const refreshVerifier = (delay: number) => {
    const seq = ++pvSeq;
    window.clearTimeout(pvTimer);
    pv = null;
    if (cfg.standalone || pin === "" || validatePin(pin) || validateAdminKey(cfg.ak)) {
      pvState = "off";
      return;
    }
    if (!globalThis.crypto?.subtle) {
      pvState = "error";
      return;
    }
    pvState = "pending";
    const ak = cfg.ak;
    const value = pin;
    pvTimer = window.setTimeout(() => {
      derivePinVerifier(value, ak).then(
        (result) => {
          if (seq !== pvSeq) return;
          pv = result;
          pvState = "ready";
          renderOutput();
          renderPinStatus();
        },
        () => {
          if (seq !== pvSeq) return;
          pvState = "error";
          renderOutput();
          renderPinStatus();
        },
      );
    }, delay);
  };

  let pinStatus: HTMLElement | null = null;
  const renderPinStatus = () => {
    if (!pinStatus) return;
    const text =
      pin === ""
        ? "No PIN, so admin is off for these frames."
        : pvState === "pending"
          ? "Making the PIN check…"
          : pvState === "ready"
            ? "Admin on. The URLs carry the admin key and the PIN check."
            : pvState === "error"
              ? "This page can't make the PIN check. Open it over https or on localhost."
              : (validatePin(pin) ?? validateAdminKey(cfg.ak) ?? "");
    pinStatus.textContent = text;
    pinStatus.dataset.state = pin === "" ? "off" : pvState;
  };

  /** Apply a change. Structural changes rebuild the form; typing and dragging only refresh output. */
  const apply = (patch: Partial<LandingConfig>, structural = true) => {
    const prev = cfg;
    cfg = applyChange(cfg, patch, manifest(), generateRoomToken);
    save(cfg);
    if (prev.ak !== cfg.ak || prev.standalone !== cfg.standalone) refreshVerifier(250);
    if (structural) renderForm();
    renderOutput();
  };

  const renderHead = () => {
    const m = manifest();
    head.replaceChildren(
      h("a", { class: "back", href: "#" }, h("span", { "aria-hidden": "true" }, "‹"), " All apps"),
      h(
        "div",
        { class: "config-title" },
        artElement(m),
        h(
          "div",
          {},
          h(
            "div",
            { class: "card-title-row" },
            h("h1", {}, m.title),
            h("span", { class: `tag tag-${m.category}` }, CATEGORY_TITLE[m.category]),
            m.hidden ? h("span", { class: "tag" }, "Hidden") : null,
          ),
          h("p", { class: "lede" }, m.blurb),
          h("p", { class: "hint" }, NETWORK_TITLE[m.network]),
        ),
      ),
    );
  };

  const appSelect = (): HTMLElement => {
    const groups = new Map<string, AppManifest[]>();
    for (const a of apps) {
      const g = a.hidden ? "Hidden" : CATEGORY_GROUP[a.category];
      groups.set(g, [...(groups.get(g) ?? []), a]);
    }
    const order = ["Games", "Visuals", "Tools", "Hidden"];
    const select = h(
      "select",
      {
        id: "app-select",
        "data-focus": "app",
        onchange: () => switchApp(select.value),
      },
      order
        .filter((g) => groups.has(g))
        .map((g) =>
          h(
            "optgroup",
            { label: g },
            (groups.get(g) ?? []).map((a) =>
              h("option", { value: a.id, selected: a.id === cfg.app }, a.title),
            ),
          ),
        ),
    );
    return h(
      "div",
      { class: "field" },
      h("label", { class: "label visually-hidden", for: "app-select" }, "App"),
      select,
    );
  };

  /** Keys of the options listed for the current setup, which `when` conditions can change. */
  const shownOptionKeys = (): string => {
    const m = manifest();
    const kinds = setupKinds(cfg, m);
    return (m.options ?? [])
      .filter((def) => optionShown(def, m.options, cfg.options, kinds))
      .map((def) => def.key)
      .join(",");
  };

  const optionControl = (def: OptionDef): HTMLElement => {
    const value = cfg.options[def.key] ?? optionDefault(def);
    const setOption = (v: string | number | boolean, structural: boolean) => {
      const before = shownOptionKeys();
      apply({ options: { ...cfg.options, [def.key]: v } }, false);
      // Redraw while a slider drags only when it shows or hides another option.
      if (structural || shownOptionKeys() !== before) renderForm();
    };
    if (def.type === "text") {
      // URLs never carry operator text, so it can only be typed in admin.
      const { el, input } = textField({
        name: `o.${def.key}`,
        label: def.title,
        value: "",
        placeholder: "Set in admin",
        onInput: () => {},
      });
      input.disabled = true;
      return el;
    }
    if (def.type === "apps") {
      return appsField(def.key, def.title, appEntries(value), (ids) =>
        setOption(ids.join(","), true),
      );
    }
    if (def.type === "enum") {
      return choiceField({
        name: `o.${def.key}`,
        label: def.title,
        value: String(value),
        choices: def.values.map((v) => ({ id: v.id, title: v.title })),
        onChange: (v) => setOption(v, true),
      });
    }
    if (def.type === "number") {
      return numberField({
        name: `o.${def.key}`,
        label: def.title,
        value: Number(value),
        min: def.min,
        max: def.max,
        step: def.step,
        onInput: (v) => setOption(v, false),
      });
    }
    return switchField({
      name: `o.${def.key}`,
      label: def.title,
      value: Boolean(value),
      onChange: (v) => setOption(v, true),
    });
  };

  // Apps whose variant presets are shown in an `apps` checklist.
  const openVariants = new Set<string>();

  /**
   * A checklist of gallery apps for an `apps` option, such as the app picker's list. Apps that
   * can't run on the chosen kind of frame are greyed out; none ticked means every suitable app.
   * Under each app, its other variants can be added as presets (`id:variant`), each its own
   * tile. Entries are written in gallery order, each app's own entry before its presets.
   */
  const appsField = (
    key: string,
    title: string,
    chosen: string[],
    onChange: (entries: string[]) => void,
  ): HTMLElement => {
    const kind = cfg.kind;
    const listed = apps.filter((a) => !a.hidden && a.id !== cfg.app);
    const suits = (a: AppManifest) => a.setups.some((s) => s.kinds.includes(kind));
    const suitable = listed.filter(suits).length;
    const order = listed.flatMap((a) => [
      a.id,
      ...(a.variants ?? []).map((v) => `${a.id}:${v.id}`),
    ]);
    const picked = order.filter((e) => chosen.includes(e));
    const toggle = (entry: string, on: boolean) => {
      const next = new Set(picked);
      if (on) next.add(entry);
      else next.delete(entry);
      onChange(order.filter((e) => next.has(e)));
    };
    const summary =
      picked.length === 0
        ? `All suitable apps (${suitable}). Tick some to offer only those.`
        : `${picked.length} ${picked.length === 1 ? "tile" : "tiles"} from ${suitable} suitable ${suitable === 1 ? "app" : "apps"}.`;

    const check = (entry: string, label: string, fits: boolean, extra: Node | null) => {
      const on = picked.includes(entry);
      const input = h("input", {
        type: "checkbox",
        checked: on,
        disabled: !fits && !on,
        "data-focus": `o.${key}:${entry}`,
        onchange: () => toggle(entry, input.checked),
      });
      return h(
        "label",
        { class: `check${fits ? "" : " is-unsuitable"}` },
        input,
        h("span", {}, label),
        extra,
      );
    };

    const row = (a: AppManifest): HTMLElement => {
      const fits = suits(a);
      // The app's own entry launches its first variant, so presets cover the rest.
      const presets = (a.variants ?? []).slice(1);
      const ticked = presets.filter((v) => picked.includes(`${a.id}:${v.id}`)).length;
      if (ticked) openVariants.add(a.id);
      const open = openVariants.has(a.id);
      const unsuitable = fits
        ? null
        : h("span", { class: "hint" }, `not for a ${KIND_TITLE[kind].toLowerCase()}`);
      const toggleId = `variants-${key}-${a.id}`;
      const more =
        presets.length && (fits || ticked)
          ? h(
              "button",
              {
                type: "button",
                class: `variants-toggle${ticked ? " has-ticked" : ""}`,
                "aria-expanded": open ? "true" : "false",
                "aria-label": `${a.title} variants${ticked ? `, ${ticked} ticked` : ""}`,
                "aria-controls": toggleId,
                "data-focus": `o.${key}:${a.id}:variants`,
                onclick: () => {
                  if (open) openVariants.delete(a.id);
                  else openVariants.add(a.id);
                  renderForm();
                },
              },
              `${presets.length} ${presets.length === 1 ? "variant" : "variants"}`,
            )
          : null;
      return h(
        "li",
        {},
        h("div", { class: "check-row" }, check(a.id, a.title, fits, unsuitable), more),
        more && open
          ? h(
              "ul",
              { class: "variant-checks", id: toggleId, "aria-label": `${a.title} variants` },
              presets.map((v) => h("li", {}, check(`${a.id}:${v.id}`, v.title, fits, null))),
            )
          : null,
      );
    };

    return h(
      "div",
      { class: "field" },
      h("div", { class: "label" }, title),
      h(
        "div",
        { class: "apps-summary" },
        h("p", { class: "hint" }, summary),
        picked.length
          ? h(
              "button",
              { type: "button", class: "btn-quiet", onclick: () => onChange([]) },
              "Use all suitable",
            )
          : null,
      ),
      listed.length
        ? h("ul", { class: "app-checks" }, listed.map(row))
        : h("p", { class: "hint" }, "No other apps in the gallery yet."),
    );
  };

  const renderForm = () => {
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.focus;
    const m = manifest();
    const support = supportFor(m, cfg.setup, cfg.kind);
    const kinds = support ? kindChoices(support) : [];
    const multi = cfg.setup !== "solo";
    const hasTouch = touchKind(cfg.kind);

    const appSection = section(
      "App",
      appSelect(),
      m.variants && m.variants.length > 1
        ? choiceField({
            name: "variant",
            label: "Variant",
            value: cfg.variant ?? "",
            choices: m.variants.map((v) => ({ id: v.id, title: v.title })),
            hint: m.variants.find((v) => v.id === cfg.variant)?.blurb,
            onChange: (v) => apply({ variant: v }),
          })
        : null,
    );

    const kindsHere = setupKinds(cfg, m);
    const shownOptions = (m.options ?? []).filter((def) =>
      optionShown(def, m.options, cfg.options, kindsHere),
    );
    const optionsSection = shownOptions.length
      ? section("Options", ...shownOptions.map(optionControl))
      : null;

    const setupHint = [SETUP_HINT[cfg.setup], support?.note].filter(Boolean).join(" ");
    const countLabel =
      cfg.setup === "bank"
        ? "Touch frames in the bank"
        : cfg.setup === "corner"
          ? "Touch frames per bank"
          : "Touch frames per side";
    const panels = kinds.includes("panel") || kinds.includes("pair");
    const displayChoices: Choice<DisplayChoice>[] = [];
    for (const k of kinds) {
      if (k === "panel" || k === "pair") {
        if (!displayChoices.some((c) => c.id === "panels")) {
          displayChoices.push({ id: "panels", title: "Panels", icon: kindGlyph("panel", 12) });
        }
      } else {
        displayChoices.push({ id: k, title: KIND_TITLE[k], icon: kindGlyph(k, 12) });
      }
    }
    const onPanels = cfg.kind === "panel" || cfg.kind === "pair";
    const range = spanRange();
    const spans = [
      ...(kinds.includes("panel") ? [1] : []),
      ...(kinds.includes("pair")
        ? Array.from({ length: range.max - range.min + 1 }, (_, i) => range.min + i)
        : []),
    ];
    const perFrame = cfg.kind === "pair" ? cfg.span : 1;
    const setupSection = section(
      "Setup",
      choiceField<SetupName>({
        name: "setup",
        label: "Setup",
        hideLabel: true,
        value: cfg.setup,
        choices: supportedSetups(m).map((s) => ({ id: s, title: SETUP_TITLE[s] })),
        hint: setupHint,
        onChange: (v) => apply({ setup: v }),
      }),
      displayChoices.length
        ? choiceField<DisplayChoice>({
            name: "kind",
            segmented: true,
            label: multi ? "Touch frames" : "Display",
            value: onPanels ? "panels" : (cfg.kind as DisplayChoice),
            choices: displayChoices,
            hint: onPanels && spans.length > 1 ? undefined : kindHint(cfg.kind, cfg.span),
            onChange: (v) =>
              apply({ kind: v === "panels" ? (kinds.includes("panel") ? "panel" : "pair") : v }),
          })
        : null,
      panels && onPanels && spans.length > 1
        ? choiceField<string>({
            name: "span",
            segmented: true,
            label: "Panels per frame",
            value: String(perFrame),
            choices: spans.map((n) => ({
              id: String(n),
              title: String(n),
              icon: kindGlyph(n === 1 ? "panel" : "pair", 12, n),
            })),
            hint: kindHint(cfg.kind, cfg.span),
            onChange: (v) =>
              apply(Number(v) === 1 ? { kind: "panel" } : { kind: "pair", span: Number(v) }),
          })
        : null,
      support && screenSupported(support)
        ? switchField({
            name: "screen",
            label:
              cfg.setup === "versus" || cfg.setup === "corner" ? "Screens above" : "Screen above",
            value: cfg.screen,
            onChange: (v) => apply({ screen: v }),
          })
        : null,
      multi && hasTouch
        ? sliderField({
            name: "count",
            label: countLabel,
            value: cfg.count,
            min: 1,
            max: COUNT_MAX,
            step: 1,
            hint:
              cfg.identity === "manual"
                ? undefined
                : "The host numbers the frames. This sets the diagram and the simulator.",
            onInput: (v) => apply({ count: v }, false),
          })
        : null,
    );

    const identitySection = section(
      "Identity",
      choiceField<LandingConfig["identity"]>({
        name: "identity",
        label: "Identity",
        hideLabel: true,
        value: cfg.identity,
        choices: [
          { id: "placeholders", title: "Host placeholders" },
          { id: "manual", title: "Manual" },
        ],
        hint:
          cfg.identity === "placeholders"
            ? "The host fills in each display's identity, so one URL covers every frame of a kind."
            : "One URL per frame, with its position written in. Use this when the host can't fill in placeholders.",
        onChange: (v) => apply({ identity: v }),
      }),
    );

    const roomField = textField({
      name: "room",
      label: "Room token",
      value: cfg.room,
      maxlength: 64,
      error: validateRoom(cfg.room),
      hint: "Frames with the same token find each other. Keep it private. A new room also gets a new admin key.",
      action: h(
        "button",
        {
          type: "button",
          onclick: () => apply({ room: generateRoomToken(), ak: generateAdminKey() }),
        },
        "New room",
      ),
      onInput: (v) => {
        roomField.setError(validateRoom(v.trim()));
        apply({ room: v }, false);
      },
    });
    roomField.input.classList.add("mono");

    const peerField =
      cfg.signalling === "custom"
        ? textField({
            name: "peer",
            label: "Server address",
            value: cfg.customPeer,
            type: "url",
            placeholder: "wss://signal.example.org/hc",
            error: cfg.customPeer ? validatePeer(cfg.customPeer) : null,
            onInput: (v) => {
              peerField?.setError(validatePeer(v));
              apply({ customPeer: v }, false);
              if (validatePeer(cfg.customPeer)) return;
              // Each server keeps its own secret; a new address carries the typed one over.
              const stored = loadSecret(cfg.customPeer);
              if (stored && stored !== secret) {
                secret = stored;
                if (secretField) secretField.input.value = stored;
                renderOutput();
              } else if (!stored && secret) {
                saveSecret(cfg.customPeer, secret);
              }
            },
          })
        : null;
    peerField?.input.classList.add("mono");

    const secretField =
      cfg.signalling === "custom"
        ? textField({
            name: "secret",
            label: "Shared secret",
            value: secret,
            type: "password",
            maxlength: 200,
            hint: "Leave it empty if the server has none. Remembered in this browser for this address.",
            onInput: (v) => {
              secret = v;
              if (!validatePeer(cfg.customPeer)) saveSecret(cfg.customPeer, v);
              renderOutput();
            },
          })
        : null;
    secretField?.input.classList.add("mono");
    // Forms around password fields keep Chromium quiet and stop Enter from navigating.
    const serverFields =
      peerField && secretField
        ? h(
            "form",
            { class: "field-group", onsubmit: (e: Event) => e.preventDefault() },
            peerField.el,
            secretField.el,
          )
        : null;

    const roomSection = section(
      "Room",
      cfg.standalone
        ? h(
            "p",
            { class: "hint" },
            "Standalone: these frames join no room, so admin and remote control are off. Change it under Advanced.",
          )
        : null,
      cfg.standalone ? null : roomField.el,
      cfg.standalone
        ? null
        : choiceField<LandingConfig["signalling"]>({
            name: "signalling",
            label: "Signalling",
            value: cfg.signalling,
            choices: [
              { id: "public", title: "Public broker" },
              { id: "custom", title: "Custom server" },
            ],
            hint:
              cfg.signalling === "public"
                ? "The free public PeerJS broker. Frames need internet access."
                : "Your own PeerJS server. It must use wss://, since this site is served over https.",
            onChange: (v) => apply({ signalling: v }),
          }),
      cfg.standalone ? null : serverFields,
    );

    let adminSection: HTMLElement | null = null;
    if (!cfg.standalone) {
      const pinField = textField({
        name: "pin",
        label: "PIN",
        value: pin,
        type: "password",
        inputmode: "numeric",
        maxlength: 8,
        hint: "4 to 8 digits, typed on a frame to open admin. The URLs carry a check made from it, never the PIN itself. Remembered in this browser; clear it to forget.",
        onInput: (v, input) => {
          const digits = v.replace(/\D/g, "").slice(0, 8);
          if (digits !== v) input.value = digits;
          pin = digits;
          savePin(digits);
          refreshVerifier(300);
          renderPinStatus();
          renderOutput();
        },
      });
      pinField.input.setAttribute("pattern", "[0-9]*");
      pinField.input.classList.add("pin");
      pinStatus = h("p", { class: "pin-status", "aria-live": "polite" });
      const pinForm = h(
        "form",
        { class: "field", onsubmit: (e: Event) => e.preventDefault() },
        pinField.el,
        pinStatus,
      );
      const keyField = textField({
        name: "ak",
        label: "Admin key",
        value: cfg.ak,
        maxlength: 64,
        error: validateAdminKey(cfg.ak),
        hint: "Random, and saved with the room so the URLs stay the same. Paste one to match frames set up elsewhere. Anyone with it can sign admin commands.",
        action: h(
          "button",
          { type: "button", onclick: () => apply({ ak: generateAdminKey() }) },
          "New key",
        ),
        onInput: (v) => {
          keyField.setError(validateAdminKey(v.trim()));
          apply({ ak: v }, false);
        },
      });
      keyField.input.classList.add("mono");
      adminSection = section("Admin", pinForm, keyField.el);
    } else {
      pinStatus = null;
    }

    const venueField = textField({
      name: "venue",
      label: "Venue profile",
      value: venueText,
      maxlength: 1000,
      placeholder: "wall:7680x2880:16x6:0.1,bank:8",
      error: venueIgnored.length ? `Not understood: ${venueIgnored.join(", ")}` : null,
      hint: "Your installation's display sizes, added to every URL. Empty uses the defaults. Remembered in this browser.",
      onInput: (v) => {
        const read = readVenueText(v);
        venueIgnored = read.ignored;
        venueField.setError(
          read.ignored.length ? `Not understood: ${read.ignored.join(", ")}` : null,
        );
        venueText = read.text;
        saveVenueText(read.text);
        setActiveVenue(read.profile);
        renderOutput();
      },
    });
    venueField.input.classList.add("mono");
    // Once the operator is done, show the tidy form and the sizes it gives everywhere.
    venueField.input.addEventListener("change", () => apply({}));

    const advanced = h(
      "details",
      {
        class: "sec advanced",
        open: advancedOpen,
        ontoggle: () => {
          advancedOpen = advanced.open;
        },
      },
      h("summary", { class: "sec-title" }, "Advanced"),
      venueField.el,
      hasTouch
        ? switchField({
            name: "reachOverride",
            label: "Override reach",
            value: cfg.reachOverride,
            hint: "How high visitors can touch, measured up from the bottom of the frame.",
            onChange: (v) =>
              apply({ reachOverride: v, reach: v ? defaultReach(cfg.kind, cfg.span) : cfg.reach }),
          })
        : null,
      hasTouch && cfg.reachOverride
        ? h(
            "div",
            { class: "pair-fields" },
            sliderField({
              name: "reach.adult",
              label: "Adult reach",
              value: cfg.reach.adult,
              min: 0.05,
              max: 1,
              step: 0.05,
              format: percent,
              onInput: (v) =>
                apply({ reach: { adult: v, child: Math.min(cfg.reach.child, v) } }, false),
            }),
            sliderField({
              name: "reach.child",
              label: "Child reach",
              value: cfg.reach.child,
              min: 0.05,
              max: 1,
              step: 0.05,
              format: percent,
              onInput: (v) =>
                apply({ reach: { adult: Math.max(cfg.reach.adult, v), child: v } }, false),
            }),
          )
        : null,
      sliderField({
        name: "idle",
        label: "Idle timeout",
        value: cfg.idle,
        min: IDLE_RANGE.min,
        max: 600,
        step: 5,
        format: (v) => `${v} s`,
        hint: "Seconds without a touch before the app goes back to attract mode.",
        onInput: (v) => apply({ idle: v }, false),
      }),
      sliderField({
        name: "res",
        label: "Render resolution",
        value: cfg.res,
        min: RES_RANGE.min,
        max: RES_RANGE.max,
        step: RES_RANGE.step,
        format: (v) => `${v}×`,
        hint: "Below 1 draws fewer pixels, for slower machines.",
        onInput: (v) => apply({ res: v }, false),
      }),
      switchField({
        name: "debug",
        label: "Debug output",
        value: cfg.debug,
        onChange: (v) => apply({ debug: v }),
      }),
      m.network !== "required"
        ? switchField({
            name: "standalone",
            label: "Standalone (no room)",
            value: cfg.standalone,
            hint: "Each frame runs on its own. This turns off admin and remote control.",
            onChange: (v) => apply({ standalone: v }),
          })
        : null,
    );

    // The guided tour finds the sections by these names.
    appSection.dataset.tour = "app";
    if (optionsSection) optionsSection.dataset.tour = "options";
    setupSection.dataset.tour = "setup";
    roomSection.dataset.tour = "room";
    if (adminSection) adminSection.dataset.tour = "admin";
    form.replaceChildren(
      ...[
        appSection,
        optionsSection,
        setupSection,
        identitySection,
        roomSection,
        adminSection,
        advanced,
      ].filter((s): s is HTMLElement => s !== null),
    );
    renderPinStatus();

    if (focused) {
      const target = [...form.querySelectorAll<HTMLElement>("[data-focus]")].find(
        (e) => e.dataset.focus === focused,
      );
      target?.focus();
    }
  };

  const highlight = (key: string | null) => {
    for (const g of diagramHost.querySelectorAll<SVGGElement>("g.f")) {
      g.classList.toggle("is-hot", key !== null && g.dataset.key === key);
      g.classList.toggle("is-dim", key !== null && g.dataset.key !== key);
    }
  };

  const urlItem = (entry: UrlEntry, blocked: boolean): HTMLElement => {
    const area = h("textarea", {
      class: "url-text mono",
      readonly: true,
      rows: 2,
      spellcheck: "false",
      "aria-label": `URL for ${entry.label}`,
      onfocus: () => area.select(),
    });
    area.value = entry.url;
    const copy = h(
      "button",
      {
        type: "button",
        class: "btn-primary copy",
        disabled: blocked,
        onclick: async () => {
          area.select();
          const ok = await copyText(entry.url);
          copy.textContent = ok ? "Copied" : "Press Ctrl+C";
          window.setTimeout(() => {
            copy.textContent = "Copy";
          }, 1600);
        },
      },
      "Copy",
    );
    const frames = entry.frames.length;
    return h(
      "li",
      {
        class: `url tone-${entry.tone}`,
        "data-key": entry.key,
        onmouseenter: () => highlight(entry.key),
        onmouseleave: () => highlight(null),
        onfocusin: () => highlight(entry.key),
        onfocusout: () => highlight(null),
      },
      h(
        "div",
        { class: "url-head" },
        h("span", { class: "dot", "aria-hidden": "true" }),
        h(
          "div",
          { class: "url-what" },
          h("strong", {}, entry.label),
          h("span", { class: "url-note" }, entry.note),
        ),
        frames > 1 && cfg.identity === "manual"
          ? h("span", { class: "hint" }, `${frames} frames`)
          : null,
        h(
          "a",
          { class: "btn btn-quiet", href: entry.url, target: "_blank", rel: "noopener" },
          "Open",
        ),
        copy,
      ),
      area,
    );
  };

  let previewTimer = 0;
  let previewSrc = "";
  const unloadPreview = () => {
    window.clearTimeout(previewTimer);
    if (!previewSrc) return;
    previewSrc = "";
    previewFrame.src = "about:blank";
  };
  const updatePreview = (entries: readonly UrlEntry[]) => {
    const url = previewUrl(entries);
    const entry = entries.find((e) => e.role !== "screen") ?? entries[0];
    if (!url || !entry) {
      previewEl.hidden = true;
      return;
    }
    previewEl.hidden = false;
    previewOpen.setAttribute("href", url);
    previewCaption.textContent = `${entry.label}, in preview mode. It never joins the room.`;
    window.clearTimeout(previewTimer);
    if (!active || tab !== "urls") {
      unloadPreview();
      return;
    }
    previewTimer = window.setTimeout(() => {
      if (url === previewSrc) return;
      previewSrc = url;
      // Reshape the box with the new page, and hide the old one, so they never mismatch.
      const size = displayFor(entry.kind, entry.frames[0]?.span ?? 1);
      previewBox.style.setProperty("--ar", `${size.width} / ${size.height}`);
      previewBox.classList.add("is-loading");
      previewFrame.src = url;
    }, 500);
  };

  let simTimer = 0;
  let simSrc = "";
  const unloadSim = () => {
    window.clearTimeout(simTimer);
    if (!simSrc) return;
    simSrc = "";
    simFrame.src = "about:blank";
  };
  /** Reload the simulator once the settings rest: a bank of frames is slow to rebuild. */
  const updateSim = (href: string) => {
    simOpen.setAttribute("href", href);
    if (!active || tab !== "sim") {
      unloadSim();
      return;
    }
    const url = `${href}${href.includes("?") ? "&" : "?"}embed=1`;
    window.clearTimeout(simTimer);
    simTimer = window.setTimeout(
      () => {
        if (url === simSrc) return;
        simSrc = url;
        simBox.classList.add("is-loading");
        simFrame.src = url;
      },
      simSrc ? 700 : 0,
    );
  };

  const showTab = () => {
    for (const id of TABS) {
      tabButtons[id].setAttribute("aria-selected", String(id === tab));
      tabButtons[id].tabIndex = id === tab ? 0 : -1;
    }
    urlsPane.hidden = tab !== "urls";
    simPane.hidden = tab !== "sim";
    output.classList.toggle("is-sim", tab === "sim");
  };

  const setTab = (next: OutputTab) => {
    if (next === tab) return;
    tab = next;
    showTab();
    renderOutput();
  };

  const pickTab = (next: OutputTab) => {
    if (next === tab) return;
    setTab(next);
    opts.onTabChange?.(next);
  };
  for (const id of TABS) tabButtons[id].addEventListener("click", () => pickTab(id));

  const renderOutput = () => {
    const m = manifest();
    const errors = configErrors(cfg, pin);
    if (pvState === "error") {
      errors.push("The PIN check can't be made on this page. Open it over https or on localhost.");
    }
    const blocked = errors.length > 0 || pvState === "pending";
    const admin = pvState === "ready" && pv && !cfg.standalone ? { ak: cfg.ak, pv } : null;
    const entries = buildUrls(cfg, m, {
      playBase: absolute("./play/"),
      ak: admin?.ak ?? null,
      pv: admin?.pv ?? null,
      secret,
      venue: venueText,
    });

    const adminState = cfg.standalone ? "Standalone" : admin ? "Admin on" : "Admin off";
    const copyAll = h(
      "button",
      {
        type: "button",
        disabled: blocked,
        onclick: async () => {
          const ok = await copyText(urlListText(entries));
          copyAll.textContent = ok ? "Copied" : "Copy failed";
          window.setTimeout(() => {
            copyAll.textContent = "Copy all";
          }, 1600);
        },
      },
      "Copy all",
    );
    outHead.replaceChildren(
      h(
        "div",
        { class: "out-title" },
        h("h2", {}, entries.length === 1 ? "Display URL" : "Display URLs"),
        h(
          "span",
          { class: `badge ${admin ? "badge-on" : ""}`, title: "Whether these URLs accept admin" },
          adminState,
        ),
      ),
      entries.length > 1 ? copyAll : "",
    );

    errorsEl.replaceChildren(...errors.map((e) => h("p", {}, e)));
    errorsEl.hidden = errors.length === 0;

    diagramHost.innerHTML = diagramSvg(planSetup(cfg, m), entries, cfg);
    diagramHost.append(
      h(
        "figcaption",
        { class: "hint" },
        cfg.kind === "sphere"
          ? "To scale, with an adult underneath."
          : cfg.kind === "screen"
            ? "Dashed frames are screens."
            : "Shaded: child reach. Line: adult reach. Dashed frames are screens.",
      ),
    );

    urlList.replaceChildren(...entries.map((e) => urlItem(e, blocked)));
    urlList.classList.toggle("is-blocked", blocked);

    const simHref = simUrl(cfg, m, absolute("./sim/"), admin, venueText);
    const sim = h(
      "a",
      { class: "btn", href: simHref, target: "_blank", rel: "noopener" },
      "Open in simulator",
    );
    const adminLink = admin
      ? h(
          "a",
          {
            class: "btn",
            href: adminUrl(cfg, admin, absolute("./admin/"), secret),
            target: "_blank",
            rel: "noopener",
          },
          "Open admin",
        )
      : null;
    linksEl.replaceChildren(sim, adminLink ?? "");

    updatePreview(entries);
    updateSim(simHref);
  };

  const switchApp = (id: string) => {
    const m = byId.get(id);
    if (!m || id === cfg.app) return;
    cfg = applyChange(cfg, { app: id }, m, generateRoomToken);
    save(cfg);
    refreshVerifier(0);
    renderHead();
    renderForm();
    renderOutput();
    opts.onAppChange(id);
  };

  refreshVerifier(0);
  showTab();
  renderHead();
  renderForm();
  renderOutput();

  return {
    el,
    get app() {
      return cfg.app;
    },
    get tab() {
      return tab;
    },
    open(id) {
      switchApp(id);
    },
    setTab,
    snapshot: () => ({ ...cfg, options: { ...cfg.options }, reach: { ...cfg.reach } }),
    apply(patch) {
      const m = (patch.app ? byId.get(patch.app) : undefined) ?? manifest();
      const prev = cfg;
      cfg = applyChange(cfg, { ...patch, app: m.id }, m, generateRoomToken);
      save(cfg);
      if (prev.ak !== cfg.ak || prev.standalone !== cfg.standalone) refreshVerifier(0);
      renderHead();
      renderForm();
      renderOutput();
      if (prev.app !== cfg.app) opts.onAppChange(cfg.app);
    },
    setActive(next) {
      active = next;
      if (!next) {
        unloadPreview();
        unloadSim();
      } else {
        renderOutput();
      }
    },
  };
};
