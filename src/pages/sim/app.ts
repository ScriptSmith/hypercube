import { derivePinVerifier, generateAdminKey } from "../../core/adminkey";
import { optionShown } from "../../core/options";
import { coerceOptions } from "../../core/params";
import { getManifest, listApps } from "../../core/registry";
import { setActiveVenue } from "../../core/venue";
import { loadPin, loadSecret, savePin, saveSecret } from "../credentials";
import { validatePeer } from "../signalling";
import { loadVenueText } from "../venueprofile";
import {
  baseProfile,
  dropTextOptions,
  frameUrl,
  newRoomToken,
  parseSimUrl,
  phoneUrl,
  type SimConfig,
  type SimNetwork,
  simProfile,
  simSearch,
} from "./config";
import { checkbox, labelled, make, optionControl, selectOf } from "./controls";
import { createFrameView, describeStatus, type FrameView } from "./frameview";
import { autoRes, focusRect, layoutCompact, layoutPhysical, type ScreenRect } from "./layout";
import {
  buildPreset,
  PRESET_IDS,
  PRESET_TITLES,
  presetShortcuts,
  type PresetId,
  type SimPreset,
} from "./presets";
import { renderQr } from "./qr";
import { drawScene } from "./scene";
import {
  defaultVenue,
  DISPLAY_KEYS,
  parseVenueValue,
  VENUE_FIELDS,
  type VenueKey,
  type VenueValues,
} from "./venue";

interface ViewPrefs {
  bezels: boolean;
  reach: boolean;
  people: boolean;
  badges: boolean;
  compact: boolean;
  focusedOnly: boolean;
  /** Sphere frames show as a 3D ball to turn rather than the flat picture they are fed. */
  globe: boolean;
  /** The header shows only its title row, so the stage gets the room. */
  collapsed: boolean;
}

type ViewToggle = Exclude<keyof ViewPrefs, "collapsed">;

const PREFS_KEY = "hc:sim:view";
const VENUE_KEY = "hc:sim:venue";
const SERVER_KEY = "hc:sim:server";
const DEFAULT_PREFS: ViewPrefs = {
  bezels: true,
  reach: true,
  people: true,
  badges: true,
  compact: false,
  focusedOnly: false,
  globe: true,
  collapsed: false,
};
const NETWORKS: readonly { value: SimNetwork; text: string }[] = [
  { value: "local", text: "This tab" },
  { value: "public", text: "Public broker" },
  { value: "own", text: "Own server" },
];
/** The sim usually runs on localhost, where a server under `wrangler dev` is plain ws://. */
const PEER_RULES = { loopbackWs: true };
const RES_CHOICES = [0.1, 0.15, 0.2, 0.25, 0.35, 0.5, 0.75, 1];
const POLL_MS = 500;
/** Reload a focused frame sharper only when it gains this much detail, to avoid churn. */
const SHARPEN_RATIO = 1.5;

/** Read by Playwright checks. */
export interface SimDebug {
  readonly config: SimConfig;
  readonly focused: string | null;
  frames(): { id: string; url: string | null; status: ReturnType<FrameView["status"]> }[];
  focus(id: string | null): void;
}

declare global {
  interface Window {
    __hypercubeSim?: SimDebug;
  }
}

const loadPrefs = (): ViewPrefs => {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<ViewPrefs>) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
};

const savePrefs = (prefs: ViewPrefs) => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage can be unavailable; prefs then last for this page only.
  }
};

/** Display sizes the operator customised in the sim, on top of the venue profile. */
const loadSizes = (): Partial<VenueValues> => {
  const sizes: Partial<VenueValues> = {};
  try {
    const raw = JSON.parse(localStorage.getItem(VENUE_KEY) ?? "{}") as Record<string, unknown>;
    for (const key of DISPLAY_KEYS) {
      const value = parseVenueValue(key, raw[key] === undefined ? null : String(raw[key]));
      if (value !== null) sizes[key] = value;
    }
  } catch {
    // Unreadable storage means the profile's sizes.
  }
  return sizes;
};

const saveSizes = (config: SimConfig) => {
  const { venue } = config;
  const defaults = defaultVenue(baseProfile(config));
  const custom: Partial<Record<VenueKey, number>> = {};
  for (const key of DISPLAY_KEYS) if (venue[key] !== defaults[key]) custom[key] = venue[key];
  try {
    if (Object.keys(custom).length) localStorage.setItem(VENUE_KEY, JSON.stringify(custom));
    else localStorage.removeItem(VENUE_KEY);
  } catch {
    // Storage can be unavailable; the values still apply to this page.
  }
};

/** The own server's address is remembered for next time, and its secret in `../credentials`. */
const loadServer = (): string => {
  try {
    return localStorage.getItem(SERVER_KEY) ?? "";
  } catch {
    return "";
  }
};

const saveServer = (address: string) => {
  try {
    localStorage.setItem(SERVER_KEY, address);
  } catch {
    // Storage can be unavailable; the address then lasts for this page only.
  }
};

export const startSim = (host: HTMLElement): SimDebug => {
  const playBase = new URL("../play/", location.href).href;
  // Inside the configuration panel's Simulator tab, which sets everything the controls would.
  const embedded = new URLSearchParams(location.search).get("embed") === "1";
  const config = parseSimUrl(location.search, newRoomToken, {
    profile: loadVenueText(),
    sizes: loadSizes(),
  });
  dropTextOptions(config, getManifest(config.app)?.options);
  let prefs = loadPrefs();
  // A secret that came in the URL moves to storage, and writeUrl drops it.
  if (config.secret) saveSecret(config.server, config.secret);
  else config.secret = loadSecret(config.server || loadServer());
  if (config.network === "own" && !validatePeer(config.server, PEER_RULES)) {
    saveServer(config.server);
  }
  /** What the Network controls show, which frames use only once the address is valid. */
  let netChoice: SimNetwork = config.network;
  let serverDraft = config.server || loadServer();
  let secretDraft = config.secret;

  const root = make("div", "sim");
  root.classList.toggle("is-embedded", embedded);
  const bar = make("header", "sim-bar");
  const stage = make("main", "sim-stage");
  const scene = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  scene.classList.add("sim-scene");
  stage.append(scene);
  const backdrop = make("div", "sim-backdrop");
  const focusBar = make("div", "sim-focusbar");
  const qrLayer = make("div", "sim-qr-layer");
  root.append(bar, stage, backdrop, focusBar, qrLayer);
  host.append(root);

  setActiveVenue(simProfile(config));
  let preset: SimPreset = buildPreset(config.preset, config.venue, baseProfile(config));
  let views: FrameView[] = [];
  /** Per-frame res picked when the frames were built, so window resizes never reload them. */
  const baseRes = new Map<string, number>();
  let build = new AbortController();
  let barControls = new AbortController();
  let focusControls = new AbortController();
  let qrControls = new AbortController();
  let focused: FrameView | null = null;
  let lastFocused: string | null = null;
  const paused = new Set<string>();
  let qrFor: string | null = null;
  let summary: HTMLElement = make("span");
  let focusStatus: HTMLElement = make("span");

  const applyPrefs = () => {
    root.classList.toggle("hide-bezels", !prefs.bezels);
    root.classList.toggle("hide-reach", !prefs.reach);
    root.classList.toggle("hide-people", !prefs.people || prefs.compact);
    root.classList.toggle("hide-badges", !prefs.badges);
  };

  const writeUrl = () => {
    const search =
      simSearch(config) +
      (embedded ? "&embed=1" : "") +
      (focused ? `&focus=${focused.frame.id}` : "");
    history.replaceState(null, "", search);
  };

  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

  const focusArea = () => {
    const top = focusBar.offsetHeight;
    const { width, height } = viewport();
    return { top, width, height: Math.max(1, height - top) };
  };

  const focusedRect = (v: FrameView): ScreenRect => {
    const area = focusArea();
    const r = focusRect(v.frame, area);
    return { ...r, top: r.top + area.top };
  };

  const urlFor = (v: FrameView): string | null => {
    const id = v.frame.id;
    if (paused.has(id)) return null;
    const isFocus = focused === v;
    if (prefs.focusedOnly && !isFocus && lastFocused !== id) return null;
    let res = baseRes.get(id) ?? 1;
    if (isFocus && config.res === null) {
      const sharp = autoRes(focusedRect(v).scale);
      if (sharp >= res * SHARPEN_RATIO) res = sharp;
    }
    return frameUrl(playBase, v.frame, config, {
      res,
      optionDefs: getManifest(config.app)?.options,
      look: prefs.globe ? "globe" : "flat",
    });
  };

  const syncLoads = () => {
    for (const v of views) {
      const note = paused.has(v.frame.id) ? "On a phone" : "Unloaded (focused only)";
      v.load(urlFor(v), note);
    }
  };

  const layout = (): Map<string, ScreenRect> => {
    const view = { width: stage.clientWidth, height: stage.clientHeight };
    let rects: Map<string, ScreenRect>;
    let bezelPx = 1;
    if (prefs.compact) {
      rects = layoutCompact(preset.frames, view);
      scene.replaceChildren();
    } else {
      const physical = layoutPhysical(preset, view);
      rects = physical.frames;
      bezelPx = Math.max(1, (simProfile(config).bezelM / 2) * physical.pxPerM);
      drawScene(scene, preset, physical, view);
    }
    for (const v of views) {
      const rect = v === focused ? focusedRect(v) : rects.get(v.frame.id);
      // Badges go below frames with floor space under them; screens and walls get theirs above.
      const f = v.frame;
      const above = !prefs.compact && (f.kind === "screen" || f.phys.y < 0.5);
      if (rect) v.place(rect, bezelPx, above ? "above" : "below");
    }
    return rects;
  };

  const renderFocusBar = () => {
    focusControls.abort();
    focusControls = new AbortController();
    const signal = focusControls.signal;
    focusBar.replaceChildren();
    if (!focused) return;
    const v = focused;
    const f = v.frame;
    const back = make("button", "sim-back", "Back");
    back.type = "button";
    back.title = "Return to the overview (Esc)";
    back.addEventListener("click", () => focus(null), { signal });

    const title = make("strong", "", f.name);
    const facts = make("span", "sim-muted", `${f.kind} · ${f.role} · ${f.width} × ${f.height}`);
    focusStatus = make("span", "sim-focus-status");

    const appChoices = [
      { value: "", text: `Sim app (${config.app})` },
      ...listApps().map((m) => ({ value: m.id, text: m.title })),
    ];
    const override = selectOf(
      appChoices,
      config.apps[f.id] ?? "",
      (value) => {
        if (value && value !== config.app) config.apps[f.id] = value;
        else delete config.apps[f.id];
        syncLoads();
        writeUrl();
      },
      signal,
    );

    const reload = make("button", "", "Reload frame");
    reload.type = "button";
    reload.addEventListener(
      "click",
      () => {
        v.load(null);
        v.load(urlFor(v));
      },
      { signal },
    );
    const qr = make("button", "", "Phone QR");
    qr.type = "button";
    qr.addEventListener("click", () => openQr(f.id), { signal });

    focusBar.append(
      back,
      title,
      facts,
      focusStatus,
      labelled("This frame", override, "Run a different app on this frame only"),
      reload,
      qr,
    );
  };

  const focus = (v: FrameView | null) => {
    if (focused === v) return;
    focused?.el.classList.remove("is-focused");
    focused = v;
    if (v) {
      lastFocused = v.frame.id;
      v.el.classList.add("is-focused");
    }
    root.classList.toggle("is-focusing", v !== null);
    renderFocusBar();
    layout();
    syncLoads();
    writeUrl();
  };

  const renderQrLayer = () => {
    qrControls.abort();
    qrControls = new AbortController();
    const v = views.find((x) => x.frame.id === qrFor);
    qrLayer.hidden = !v;
    if (!v) {
      qrLayer.replaceChildren();
      return;
    }
    const id = v.frame.id;
    renderQr(
      qrLayer,
      {
        frame: v.frame,
        url: phoneUrl(playBase, v.frame, config, getManifest(config.app)?.options),
        network: config.network,
        server: config.server,
        paused: paused.has(id),
        usePublic: () => {
          config.network = "public";
          netChoice = "public";
          rebuild();
        },
        togglePause: () => {
          if (paused.has(id)) paused.delete(id);
          else paused.add(id);
          syncLoads();
          renderQrLayer();
        },
        close: () => openQr(null),
      },
      qrControls.signal,
    );
  };

  const openQr = (id: string | null) => {
    qrFor = id;
    renderQrLayer();
  };

  /**
   * PIN entry for admin testing. Set makes a fresh random key and a verifier of the PIN, and
   * only those reach the frames' URLs. The PIN is remembered with the landing page's.
   */
  const adminControl = (signal: AbortSignal): HTMLElement => {
    const wrap = make("span", "sim-field");
    wrap.title = "Gives every frame a fresh admin key and a verifier for this PIN";
    wrap.append(make("span", "", "Admin"));
    if (config.extra.ak) {
      const clear = make("button", "", "Clear key");
      clear.type = "button";
      clear.addEventListener(
        "click",
        () => {
          delete config.extra.ak;
          delete config.extra.pv;
          rebuild();
        },
        { signal },
      );
      wrap.append(make("span", "sim-value", "key set"), clear);
      return wrap;
    }
    const form = make("form", "sim-inline");
    const pin = make("input", "sim-pin");
    pin.type = "password";
    pin.inputMode = "numeric";
    pin.autocomplete = "off";
    pin.placeholder = "PIN";
    pin.value = loadPin();
    pin.setAttribute("aria-label", "Admin PIN");
    const set = make("button", "", "Set");
    set.type = "submit";
    const note = make("span", "sim-message");
    form.append(pin, set, note);
    form.addEventListener(
      "submit",
      (e) => {
        e.preventDefault();
        const value = pin.value.trim();
        if (!/^\d{4,8}$/.test(value)) {
          note.textContent = "4 to 8 digits";
          return;
        }
        savePin(value);
        if (!crypto.subtle) {
          note.textContent = "needs HTTPS or localhost";
          return;
        }
        note.textContent = "deriving";
        const ak = generateAdminKey();
        derivePinVerifier(value, ak)
          .then((pv) => {
            config.extra.ak = ak;
            config.extra.pv = pv;
            rebuild();
          })
          .catch(() => {
            note.textContent = "failed";
          });
      },
      { signal },
    );
    wrap.append(form);
    return wrap;
  };

  let venueOpen = false;

  /** A number field for one venue value. Display sizes are remembered for next time. */
  const venueInput = (key: VenueKey, signal: AbortSignal): HTMLInputElement => {
    const field = VENUE_FIELDS.find((f) => f.key === key)!;
    const input = make("input");
    input.type = "number";
    input.min = String(field.min);
    input.max = String(field.max);
    input.step = String(field.step);
    input.value = String(config.venue[key]);
    input.title = field.title;
    input.setAttribute("aria-label", field.title);
    input.dataset.focusKey = `venue-${key}`;
    input.addEventListener(
      "change",
      () => {
        const n = Number(input.value);
        const clamped = Math.min(field.max, Math.max(field.min, n));
        const value = parseVenueValue(key, String(clamped));
        if (value === null || value === config.venue[key]) {
          input.value = String(config.venue[key]);
          return;
        }
        config.venue[key] = value;
        if (DISPLAY_KEYS.includes(key)) saveSizes(config);
        rebuild();
      },
      { signal },
    );
    return input;
  };

  /** One labelled cluster of venue sizes, such as "Screen 4000 × 3600 px". */
  const sizeField = (
    title: string,
    parts: readonly (readonly [VenueKey, VenueKey, string] | readonly [VenueKey, string])[],
    signal: AbortSignal,
  ): HTMLElement => {
    const wrap = make("span", "sim-field sim-size");
    wrap.append(make("span", "", title));
    for (const part of parts) {
      const [a, b, unit] = part.length === 3 ? part : [part[0], null, part[1]];
      wrap.append(venueInput(a, signal));
      if (b) wrap.append(make("span", "sim-times", "×"), venueInput(b, signal));
      wrap.append(make("span", "sim-unit", unit));
    }
    return wrap;
  };

  /** A labelled block of the header. Its controls wrap inside it. */
  const group = (name: string, key: string, items: readonly (HTMLElement | null)[]) => {
    const el = make("section", `sim-group sim-group-${key}`);
    el.setAttribute("aria-label", name);
    const body = make("div", "sim-group-body");
    for (const item of items) if (item) body.append(item);
    el.append(make("h2", "sim-group-label", name), body);
    return el;
  };

  const setupGroup = (signal: AbortSignal): HTMLElement => {
    const shortcuts = presetShortcuts(baseProfile(config).bankCount);
    const presets = selectOf(
      [
        ...PRESET_IDS.map((id) => ({ value: id, text: PRESET_TITLES[id] })),
        ...Object.entries(shortcuts).map(([id, s]) => ({ value: id, text: s.title })),
      ],
      config.preset,
      (value) => {
        const shortcut = shortcuts[value];
        if (shortcut) {
          config.preset = shortcut.preset;
          config.venue.count = shortcut.count;
          config.venue.span = shortcut.span;
        } else {
          config.preset = value as PresetId;
        }
        config.apps = {};
        rebuild();
      },
      signal,
    );
    presets.setAttribute("aria-label", "Preset");
    presets.dataset.focusKey = "preset";
    const shape: Partial<Record<PresetId, VenueKey[]>> = {
      bank: ["count", "span"],
      corner: ["count", "span"],
      screen: ["count", "span"],
      pair: ["span"],
    };
    const short: Partial<Record<VenueKey, string>> = { count: "Frames", span: "Span" };
    const fields = (shape[config.preset] ?? []).map((key) => {
      const input = venueInput(key, signal);
      return labelled(short[key] ?? key, input, input.title);
    });
    return group("Setup", "setup", [presets, ...fields]);
  };

  const appGroup = (signal: AbortSignal): HTMLElement => {
    const manifest = getManifest(config.app);
    const items: HTMLElement[] = [];
    const apps = listApps().map((m) => ({
      value: m.id,
      text: m.hidden ? `${m.title} (hidden)` : m.title,
    }));
    if (!manifest) apps.unshift({ value: config.app, text: `${config.app} (unknown)` });
    const appSelect = selectOf(
      apps,
      config.app,
      (value) => {
        config.app = value;
        config.variant = null;
        config.options = {};
        rebuild();
      },
      signal,
    );
    appSelect.setAttribute("aria-label", "App");
    appSelect.dataset.focusKey = "app";
    items.push(appSelect);

    const variants = manifest?.variants ?? [];
    if (variants.length > 0) {
      const variant = selectOf(
        variants.map((v) => ({ value: v.id, text: v.title })),
        config.variant ?? variants[0]?.id ?? "",
        (value) => {
          config.variant = value === variants[0]?.id ? null : value;
          rebuild();
        },
        signal,
      );
      variant.dataset.focusKey = "variant";
      items.push(labelled("Variant", variant));
    }

    const bots = make("input");
    bots.type = "number";
    bots.min = "0";
    bots.max = "16";
    bots.value = String(config.bots);
    bots.dataset.focusKey = "bots";
    bots.addEventListener(
      "change",
      () => {
        const n = Math.round(Number(bots.value));
        config.bots = Number.isFinite(n) ? Math.min(16, Math.max(0, n)) : 0;
        rebuild();
      },
      { signal },
    );
    items.push(labelled("Bots", bots, "Bot players in every frame"));

    // Only options that some frame in this preset would use, given the values chosen.
    const kinds = [...new Set(preset.frames.map((f) => f.kind))];
    const all = manifest?.options ?? [];
    const values = coerceOptions(config.options, all);
    const defs = all.filter((d) => optionShown(d, all, values, kinds));
    for (const def of defs) {
      const fallback = def.type === "apps" ? def.default.join(",") : def.default;
      const control = optionControl(
        def,
        values[def.key] ?? fallback,
        (value) => {
          if (value === fallback) delete config.options[def.key];
          else config.options[def.key] = String(value);
          rebuild();
        },
        signal,
      );
      control
        .querySelector<HTMLElement>("input, select")
        ?.setAttribute("data-focus-key", `o.${def.key}`);
      items.push(control);
    }
    return group("App", "app", items);
  };

  /** The own server's address, which frames use only once it is valid, and its secret. */
  const serverFields = (signal: AbortSignal): HTMLElement => {
    const form = make("form", "sim-inline sim-server");
    const address = make("input", "sim-address");
    address.type = "text";
    address.inputMode = "url";
    address.spellcheck = false;
    address.autocomplete = "off";
    address.placeholder = "wss://signal.example.org/hc";
    address.value = serverDraft;
    address.dataset.focusKey = "server";
    const secret = make("input", "sim-secret");
    secret.type = "password";
    secret.autocomplete = "off";
    secret.placeholder = "optional";
    secret.value = secretDraft;
    secret.dataset.focusKey = "secret";
    const message = make("span", "sim-message");
    message.setAttribute("aria-live", "polite");

    const update = () => {
      const text = serverDraft.trim();
      const error = text ? validatePeer(text, PEER_RULES) : null;
      const applied =
        config.network === "own" && config.server === text && config.secret === secretDraft;
      address.setAttribute("aria-invalid", String(error !== null));
      message.classList.toggle("is-error", error !== null);
      message.textContent =
        error ?? (text === "" ? "Enter an address to switch" : applied ? "" : "Enter applies");
    };
    update();
    const apply = () => {
      update();
      applyServer();
    };
    address.addEventListener(
      "input",
      () => {
        serverDraft = address.value;
        update();
      },
      { signal },
    );
    secret.addEventListener(
      "input",
      () => {
        secretDraft = secret.value;
        update();
      },
      { signal },
    );
    for (const input of [address, secret]) input.addEventListener("change", apply, { signal });
    // Two text fields and no submit button means Enter never submits, so it applies here.
    form.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          apply();
        }
      },
      { signal },
    );
    form.addEventListener("submit", (e) => e.preventDefault(), { signal });
    form.append(
      labelled("Server", address, "Server address: wss://, or ws:// for a server on localhost"),
      labelled(
        "Secret",
        secret,
        "Shared secret, if the server has one. Remembered in this browser for this address.",
      ),
      message,
    );
    return form;
  };

  const networkGroup = (signal: AbortSignal): HTMLElement => {
    const choice = selectOf(
      NETWORKS,
      netChoice,
      (value) => {
        netChoice = NETWORKS.find((n) => n.value === value)?.value ?? "local";
        if (netChoice !== "own") {
          config.network = netChoice;
          rebuild();
        } else if (!applyServer()) {
          // Frames keep their network until the address is valid.
          focusAfterRender = "server";
          renderBar();
        }
      },
      signal,
    );
    choice.setAttribute("aria-label", "Network");
    choice.dataset.focusKey = "network";
    choice.title =
      "This tab links the frames with BroadcastChannel. The public broker and your own " +
      "signalling server use PeerJS, so phones can join too.";

    const room = make("span", "sim-field");
    room.title = `Every frame in this sim shares this room token: ${config.room}`;
    room.append(make("span", "", "Room"), make("code", "sim-room", config.room));
    return group("Network", "network", [
      choice,
      netChoice === "own" ? serverFields(signal) : null,
      room,
      adminControl(signal),
    ]);
  };

  const viewGroup = (signal: AbortSignal): HTMLElement => {
    const resChoices = [
      { value: "auto", text: "auto" },
      ...RES_CHOICES.map((r) => ({ value: String(r), text: String(r) })),
    ];
    if (config.res !== null && !RES_CHOICES.includes(config.res)) {
      resChoices.push({ value: String(config.res), text: String(config.res) });
    }
    const res = selectOf(
      resChoices,
      config.res === null ? "auto" : String(config.res),
      (value) => {
        config.res = value === "auto" ? null : Number(value);
        rebuild();
      },
      signal,
    );
    res.dataset.focusKey = "res";
    const toggle = (key: ViewToggle, text: string, title: string, relayout = false) => {
      const el = checkbox(
        text,
        prefs[key],
        (checked) => {
          prefs = { ...prefs, [key]: checked };
          savePrefs(prefs);
          applyPrefs();
          if (relayout) layout();
          if (key === "focusedOnly" || key === "globe") syncLoads();
        },
        signal,
      );
      el.title = title;
      return el;
    };
    return group("View", "view", [
      labelled(
        "Res",
        res,
        "Render resolution. Auto picks one per frame from the size it is drawn at, " +
          "and reloads a focused frame sharper.",
      ),
      toggle("bezels", "Bezels", "Bezels and seams between panels"),
      toggle("reach", "Reach", "Adult and child reach lines"),
      toggle("people", "People", "People drawn to scale"),
      toggle("badges", "Badges", "Frame badges with status and QR buttons"),
      toggle("compact", "Compact", "Frames packed side by side, without the room", true),
      toggle("focusedOnly", "Focused only", "Load only the focused frame"),
      preset.frames.some((f) => f.kind === "sphere")
        ? toggle(
            "globe",
            "Globe",
            "Show spheres as a ball in the room that you can turn. Off shows the flat picture they are fed.",
          )
        : null,
    ]);
  };

  /** Display sizes, which the Venue button shows. */
  const venueGroup = (signal: AbortSignal): HTMLElement => {
    const reset = make("button", "", "Default sizes");
    reset.type = "button";
    reset.addEventListener(
      "click",
      () => {
        const defaults = defaultVenue(baseProfile(config));
        for (const key of DISPLAY_KEYS) config.venue[key] = defaults[key];
        saveSizes(config);
        rebuild();
      },
      { signal },
    );
    return group("Venue", "venue", [
      sizeField("Screen", [["sw", "sh", "px"]], signal),
      sizeField(
        "Panel",
        [
          ["pw", "ph", "px"],
          ["pwm", "phm", "m"],
        ],
        signal,
      ),
      sizeField("Panel bottom", [["pb", "m"]], signal),
      sizeField(
        "Wall",
        [
          ["ww", "wh", "px"],
          ["wwm", "whm", "m"],
        ],
        signal,
      ),
      sizeField(
        "Sphere",
        [
          ["spw", "sph", "px"],
          ["spd", "m"],
        ],
        signal,
      ),
      sizeField("Sphere bottom", [["spb", "m"]], signal),
      reset,
    ]);
  };

  const actionButton = (text: string, title: string, onClick: () => void, signal: AbortSignal) => {
    const button = make("button", "", text);
    button.type = "button";
    button.title = title;
    button.addEventListener("click", onClick, { signal });
    return button;
  };

  /** Focus to put back on the same control after the bar is rebuilt. */
  let focusAfterRender: string | null = null;

  const renderBar = () => {
    const active = document.activeElement;
    const focusKey =
      focusAfterRender ??
      (active instanceof HTMLElement && bar.contains(active) ? active.dataset.focusKey : null);
    focusAfterRender = null;
    barControls.abort();
    barControls = new AbortController();
    const signal = barControls.signal;
    bar.replaceChildren();

    const top = make("div", "sim-top");
    summary = make("span", "sim-summary");
    const actions = make("div", "sim-actions");
    const reload = actionButton(
      "Reload frames",
      "Rebuild every frame, picking auto res again for the current layout",
      () => rebuild(),
      signal,
    );
    if (embedded) {
      // Only the view: the configuration panel around this frame sets everything else.
      actions.append(reload);
      top.append(summary, make("span", "sim-hint", "Tap a badge to focus a frame."), actions);
      const view = make("div", "sim-line");
      view.append(viewGroup(signal));
      bar.append(top, view);
      poll();
      return;
    }
    const venue = actionButton(
      "Venue",
      "Display sizes in pixels and metres",
      () => {
        venueOpen = !venueOpen;
        if (venueOpen && prefs.collapsed) setCollapsed(false);
        else renderBar();
        layout();
      },
      signal,
    );
    venue.setAttribute("aria-pressed", String(venueOpen));
    venue.dataset.focusKey = "venue";
    const fold = actionButton(
      "",
      prefs.collapsed ? "Show controls" : "Hide controls",
      () => setCollapsed(!prefs.collapsed),
      signal,
    );
    fold.className = "sim-fold";
    fold.setAttribute("aria-label", fold.title);
    fold.setAttribute("aria-expanded", String(!prefs.collapsed));
    fold.dataset.focusKey = "fold";
    // A fixed chevron; nothing user-supplied reaches the markup.
    fold.innerHTML =
      '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' +
      '<path d="M3.5 10l4.5-4.5 4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" stroke-linejoin="round"/></svg>';
    actions.append(
      reload,
      actionButton(
        "New room",
        "Move every frame to a fresh room token",
        () => {
          config.room = newRoomToken();
          rebuild();
        },
        signal,
      ),
      venue,
      fold,
    );
    top.append(
      make("h1", "sim-title", "Simulator"),
      summary,
      make("span", "sim-hint", "Tap a badge to focus a frame. Esc returns."),
      actions,
    );
    bar.append(top);

    if (!prefs.collapsed) {
      const line = (...items: HTMLElement[]) => {
        const el = make("div", "sim-line");
        el.append(...items);
        return el;
      };
      const groups = make("div", "sim-groups");
      groups.append(
        line(setupGroup(signal), appGroup(signal)),
        line(networkGroup(signal), viewGroup(signal)),
      );
      if (venueOpen) groups.append(line(venueGroup(signal)));
      bar.append(groups);
    }
    poll();

    if (focusKey) {
      const target = bar.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`);
      target?.focus();
      if (target instanceof HTMLInputElement && target.type !== "number") {
        const end = target.value.length;
        target.setSelectionRange(end, end);
      }
    }
  };

  const setCollapsed = (collapsed: boolean) => {
    prefs = { ...prefs, collapsed };
    savePrefs(prefs);
    renderBar();
  };

  let rebuildTimer = 0;

  /**
   * Use the own server once its address is valid. Returns false, changing nothing, when it
   * isn't. The rebuild waits a tick so a click that moved focus to the next field lands first,
   * and the rebuilt bar puts focus back there.
   */
  const applyServer = (): boolean => {
    const address = serverDraft.trim();
    if (validatePeer(address, PEER_RULES)) return false;
    netChoice = "own";
    const changed =
      config.network !== "own" || config.server !== address || config.secret !== secretDraft;
    config.network = "own";
    config.server = address;
    config.secret = secretDraft;
    saveServer(address);
    saveSecret(address, secretDraft);
    if (changed) {
      window.clearTimeout(rebuildTimer);
      rebuildTimer = window.setTimeout(rebuild, 0);
    }
    return true;
  };

  const rebuild = () => {
    const keepFocus = focused?.frame.id ?? null;
    build.abort();
    build = new AbortController();
    for (const v of views) v.dispose();
    views = [];
    focused = null;
    root.classList.remove("is-focusing");
    baseRes.clear();

    setActiveVenue(simProfile(config));
    preset = buildPreset(config.preset, config.venue, baseProfile(config));
    const ids = new Set(preset.frames.map((f) => f.id));
    for (const id of paused) if (!ids.has(id)) paused.delete(id);
    for (const id of Object.keys(config.apps)) if (!ids.has(id)) delete config.apps[id];
    if (lastFocused && !ids.has(lastFocused)) lastFocused = null;
    if (qrFor && !ids.has(qrFor)) qrFor = null;

    for (const f of preset.frames) {
      const v: FrameView = createFrameView(
        f,
        stage,
        {
          focus: () => focus(v),
          qr: () => openQr(f.id),
          escape: () => focus(null),
        },
        build.signal,
      );
      views.push(v);
    }
    renderBar();
    const rects = layout();
    for (const f of preset.frames) {
      const scale = rects.get(f.id)?.scale ?? 1;
      baseRes.set(f.id, config.res ?? autoRes(scale));
    }
    const refocus = views.find((v) => v.frame.id === keepFocus) ?? null;
    if (refocus) focus(refocus);
    else renderFocusBar();
    syncLoads();
    renderQrLayer();
    writeUrl();
    poll();
  };

  const poll = () => {
    let running = 0;
    let loading = 0;
    let unloaded = 0;
    let errors = 0;
    let online = 0;
    const hubs: string[] = [];
    for (const v of views) {
      const s = v.status();
      v.showStatus(s);
      if (!s.loaded) unloaded++;
      else if (s.phase === "running") running++;
      else loading++;
      errors += s.errors;
      if (s.room === "online") online++;
      if (s.hub) hubs.push(v.frame.short);
      if (v === focused) focusStatus.textContent = describeStatus(s);
    }
    const parts = [`${views.length} frame${views.length === 1 ? "" : "s"}`, `${running} running`];
    if (loading) parts.push(`${loading} starting`);
    if (unloaded) parts.push(`${unloaded} unloaded`);
    parts.push(`${online} online`);
    parts.push(hubs.length ? `hub ${hubs.join(", ")}` : "no hub");
    parts.push(`${errors} error${errors === 1 ? "" : "s"}`);
    summary.textContent = parts.join(" · ");
    summary.classList.toggle("has-errors", errors > 0);
    const res = [...new Set(baseRes.values())].sort((a, b) => a - b);
    if (res.length) {
      const range = res.length > 1 ? `${res[0]} to ${res.at(-1)}` : String(res[0]);
      summary.textContent += ` · res ${config.res === null ? `auto ${range}` : range}`;
    }
    // The title row truncates the summary when narrow.
    summary.title = summary.textContent;
  };

  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (qrFor) openQr(null);
    else focus(null);
  });
  // The stage fills the window, so this also catches resizes that move a focused frame.
  new ResizeObserver(() => layout()).observe(stage);
  window.setInterval(poll, POLL_MS);

  // Read before rebuild rewrites the address.
  const initialFocus = new URLSearchParams(location.search).get("focus");
  applyPrefs();
  rebuild();
  const initial = views.find((v) => v.frame.id === initialFocus);
  if (initial) focus(initial);

  const debug: SimDebug = {
    get config() {
      return config;
    },
    get focused() {
      return focused?.frame.id ?? null;
    },
    frames: () => views.map((v) => ({ id: v.frame.id, url: v.url, status: v.status() })),
    focus: (id) => focus(views.find((v) => v.frame.id === id) ?? null),
  };
  window.__hypercubeSim = debug;
  return debug;
};
