import { thumbPreviews } from "../../core/thumbs";
import type { AppManifest, FrameKind, SetupSupport } from "../../core/types";
import { appArt, kindGlyph } from "./art";
import { KIND_ORDER, KIND_TITLE } from "./config";
import { escapeHtml } from "./controls";
import { createCycler, type Cycler } from "./cycle";
import { h } from "./dom";

type Category = AppManifest["category"];

export const CATEGORY_TITLE: Record<Category, string> = {
  game: "Game",
  visual: "Visual",
  tool: "Tool",
};

const FILTERS: readonly { id: Category | "all"; title: string }[] = [
  { id: "all", title: "All" },
  { id: "game", title: "Games" },
  { id: "visual", title: "Visuals" },
  { id: "tool", title: "Tools" },
];

/** The gallery's filters, remembered per browser. */
const FILTER_KEY = "hc:gallery";

export interface GalleryFilters {
  category: Category | "all";
  kind: FrameKind | "all";
}

/** Filters from loose values (a saved object, a page address), ignoring anything unknown. */
export const cleanFilters = (raw: { category?: unknown; kind?: unknown }): GalleryFilters => ({
  category: FILTERS.some((f) => f.id === raw.category)
    ? (raw.category as GalleryFilters["category"])
    : "all",
  kind: (KIND_ORDER as readonly unknown[]).includes(raw.kind) ? (raw.kind as FrameKind) : "all",
});

const loadFilters = (): GalleryFilters => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(FILTER_KEY) ?? "null");
    if (typeof raw === "object" && raw !== null) return cleanFilters(raw);
  } catch {
    // Missing or blocked storage, or an old value: start unfiltered.
  }
  return { category: "all", kind: "all" };
};

const saveFilters = (state: GalleryFilters): void => {
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify(state));
  } catch {
    // Private mode or a full quota: the filters still work, they just aren't remembered.
  }
};

/** Every frame kind an app runs on, in any setup. */
export const appKinds = (app: AppManifest): FrameKind[] =>
  KIND_ORDER.filter((k) => app.setups.some((s) => s.kinds.includes(k)));

const SETUP_TITLE: Record<SetupSupport["setup"], string> = {
  solo: "Solo",
  bank: "Bank",
  corner: "Corner",
  versus: "Versus",
};

export const thumbUrl = (id: string): string => `./thumbs/${encodeURIComponent(id)}.png`;

/**
 * Names of the screenshots in `public/thumbs/`: app ids, and `<id>.<look>` for further looks.
 * Reading only the glob's keys makes Vite inline the file names without importing anything, so
 * missing thumbnails are never requested.
 */
export const THUMBS: ReadonlySet<string> = new Set(
  Object.keys(import.meta.glob("../../../public/thumbs/*.png")).map((path) =>
    (path.split("/").at(-1) ?? "").replace(/\.png$/, ""),
  ),
);

/** Card art: the generated picture, with the real screenshot laid over it once it loads. */
export const artElement = (app: AppManifest, thumbs: ReadonlySet<string> = THUMBS): HTMLElement => {
  const art = h("div", { class: "art", html: appArt(app.id, app.category) });
  if (thumbs.has(app.id)) {
    const img = h("img", { alt: "", loading: "lazy", decoding: "async", draggable: "false" });
    img.addEventListener("load", () => img.classList.add("is-loaded"), { once: true });
    img.addEventListener("error", () => img.remove(), { once: true });
    img.src = thumbUrl(app.id);
    art.append(img);
  }
  return art;
};

/** The app's further looks with a screenshot, when its first one has one too. */
export const lookStems = (app: AppManifest, thumbs: ReadonlySet<string> = THUMBS): string[] =>
  thumbs.has(app.id)
    ? thumbPreviews(app)
        .slice(1)
        .map((p) => p.stem)
        .filter((stem) => thumbs.has(stem))
    : [];

const setupChips = (app: AppManifest): HTMLElement =>
  h(
    "ul",
    { class: "chips" },
    app.setups.map((s) => {
      const kinds = KIND_ORDER.filter((k) => s.kinds.includes(k));
      return h(
        "li",
        { class: "chip", title: `${SETUP_TITLE[s.setup]}: ${kinds.join(", ")}` },
        SETUP_TITLE[s.setup],
        h("span", { class: "chip-kinds", html: kinds.map((k) => kindGlyph(k)).join("") }),
        h("span", { class: "visually-hidden" }, `: ${kinds.join(", ")}`),
      );
    }),
  );

const card = (
  app: AppManifest,
  thumbs: ReadonlySet<string>,
  cycler: Cycler,
  index: number,
): HTMLElement => {
  const art = artElement(app, thumbs);
  cycler.add(art, lookStems(app, thumbs).map(thumbUrl), index);
  return h(
    "li",
    { "data-category": app.category, "data-kinds": appKinds(app).join(" ") },
    h(
      "a",
      { class: "card", href: `#/${encodeURIComponent(app.id)}`, "data-app": app.id },
      art,
      h(
        "div",
        { class: "card-body" },
        h(
          "div",
          { class: "card-title-row" },
          h("h2", { class: "card-title" }, app.title),
          h("span", { class: `tag tag-${app.category}` }, CATEGORY_TITLE[app.category]),
        ),
        h("p", { class: "card-blurb" }, app.blurb),
        setupChips(app),
      ),
    ),
  );
};

export interface Gallery {
  el: HTMLElement;
  setSelected(id: string | null): void;
}

export interface GalleryOptions {
  configureHref(): string;
  thumbs?: ReadonlySet<string>;
  /** Filters to start with, such as a shared link's; otherwise the ones this browser remembers. */
  filters?: GalleryFilters | null;
  /** Called with the filters in effect, once at the start and on every change. */
  onFilter?(filters: GalleryFilters): void;
}

export const createGallery = (apps: readonly AppManifest[], opts: GalleryOptions): Gallery => {
  const visible = apps.filter((a) => !a.hidden);
  const counts = new Map<string, number>([["all", visible.length]]);
  for (const a of visible) counts.set(a.category, (counts.get(a.category) ?? 0) + 1);
  const kindCounts = new Map<FrameKind, number>();
  for (const a of visible)
    for (const k of appKinds(a)) kindCounts.set(k, (kindCounts.get(k) ?? 0) + 1);

  const thumbs = opts.thumbs ?? THUMBS;
  const cycler = createCycler();
  const list = h(
    "ul",
    { class: "cards" },
    visible.map((app, i) => card(app, thumbs, cycler, i)),
  );
  const nothing = h(
    "p",
    { class: "hint filter-empty", hidden: true },
    "No apps match both filters.",
  );

  const filters = FILTERS.filter((f) => (counts.get(f.id) ?? 0) > 0);
  const kinds = KIND_ORDER.filter((k) => (kindCounts.get(k) ?? 0) > 0);
  const state = { ...(opts.filters ?? loadFilters()) };
  if (!filters.some((f) => f.id === state.category)) state.category = "all";
  if (state.kind !== "all" && !kinds.includes(state.kind)) state.kind = "all";

  const apply = () => {
    let shown = 0;
    for (const li of list.children) {
      const el = li as HTMLElement;
      const kindsOf = (el.dataset.kinds ?? "").split(" ");
      el.hidden =
        (state.category !== "all" && el.dataset.category !== state.category) ||
        (state.kind !== "all" && !kindsOf.includes(state.kind));
      if (!el.hidden) shown++;
    }
    nothing.hidden = shown > 0 || visible.length === 0;
  };

  const radio = (
    group: "category" | "kind",
    id: string,
    label: string,
    onPick: () => void,
  ): HTMLElement =>
    h(
      "label",
      {},
      h("input", {
        type: "radio",
        name: group,
        value: id,
        checked: (group === "category" ? state.category : state.kind) === id,
        onchange: () => {
          onPick();
          saveFilters(state);
          apply();
          opts.onFilter?.({ ...state });
        },
      }),
      h("span", { html: label }),
    );

  const countHtml = (n: number) => ` <span class="count">${n}</span>`;
  const categoryBar =
    filters.length > 2
      ? h(
          "div",
          { class: "seg filter", role: "radiogroup", "aria-label": "Category" },
          filters.map((f) =>
            radio(
              "category",
              f.id,
              `${escapeHtml(f.title)}${countHtml(counts.get(f.id) ?? 0)}`,
              () => {
                state.category = f.id;
              },
            ),
          ),
        )
      : null;
  const kindBar =
    kinds.length > 1
      ? h(
          "div",
          { class: "seg filter filter-kind", role: "radiogroup", "aria-label": "Display" },
          radio("kind", "all", `Any display${countHtml(visible.length)}`, () => {
            state.kind = "all";
          }),
          kinds.map((k) =>
            radio(
              "kind",
              k,
              `${kindGlyph(k, 12)}${escapeHtml(KIND_TITLE[k])}${countHtml(kindCounts.get(k) ?? 0)}`,
              () => {
                state.kind = k;
              },
            ),
          ),
        )
      : null;
  apply();
  opts.onFilter?.({ ...state });

  const empty = h(
    "div",
    { class: "empty" },
    h("p", {}, "No apps in the gallery yet."),
    h(
      "p",
      { class: "hint" },
      "Hidden tools, such as the idle screen, are still available in the configurator.",
    ),
    h("a", { class: "btn btn-primary", href: opts.configureHref() }, "Open the configurator"),
  );

  const el = h(
    "section",
    { class: "gallery", "aria-labelledby": "gallery-title" },
    h(
      "div",
      { class: "gallery-head" },
      h(
        "div",
        {},
        h("h1", { id: "gallery-title" }, "Apps"),
        h(
          "p",
          { class: "lede" },
          "Games, visuals and tools for touch panels, walls, kiosks and spheres. Pick one to set up the URL for each display.",
        ),
      ),
      categoryBar || kindBar ? h("div", { class: "filters" }, categoryBar, kindBar) : null,
    ),
    visible.length ? list : empty,
    nothing,
  );

  return {
    el,
    setSelected(id) {
      for (const a of list.querySelectorAll<HTMLAnchorElement>("a.card")) {
        if (a.dataset.app === id) a.setAttribute("aria-current", "true");
        else a.removeAttribute("aria-current");
      }
    },
  };
};
