import type { AppManifest } from "../../core/types";
import { setActiveVenue } from "../../core/venue";
import { loadVenueText, readVenueText } from "../venueprofile";
import { h } from "./dom";
import { createMark } from "./mark";
import { cleanFilters, createGallery, type GalleryFilters } from "./gallery";
import { createPanel, type OutputTab } from "./panel";
import { kindChoices, supportFor } from "./config";
import { createGuide } from "./guide";
import { loadSaved } from "./storage";
import { createTour } from "./tour";

/** `#/<app>` or `#/<app>/sim`: the app to configure and the output tab to show. */
const parseHash = (hash: string): { app: string; tab: OutputTab } => {
  let text = "";
  try {
    text = decodeURIComponent(hash.replace(/^#\/?/, ""));
  } catch {
    text = "";
  }
  const [app = "", view] = text.split("/");
  return { app, tab: view === "sim" ? "sim" : "urls" };
};

const hashFor = (app: string, tab: OutputTab): string =>
  `#/${encodeURIComponent(app)}${tab === "sim" ? "/sim" : ""}`;

/** `?category=<id>&kind=<kind>` filters the gallery, so a link can share a filtered view. */
const filtersFromSearch = (search: string): GalleryFilters | null => {
  const q = new URLSearchParams(search);
  if (!q.has("category") && !q.has("kind")) return null;
  return cleanFilters({ category: q.get("category"), kind: q.get("kind") });
};

/** Keep the address's filters in step with the gallery's, leaving the rest of it alone. */
const writeFilters = (f: GalleryFilters): void => {
  const q = new URLSearchParams(location.search);
  if (f.category === "all") q.delete("category");
  else q.set("category", f.category);
  if (f.kind === "all") q.delete("kind");
  else q.set("kind", f.kind);
  const search = q.toString();
  const next = `${location.pathname}${search ? `?${search}` : ""}${location.hash}`;
  if (next !== `${location.pathname}${location.search}${location.hash}`) {
    history.replaceState(history.state, "", next);
  }
};

/**
 * The landing page: a gallery of apps and the configuration panel. `#/<app>` opens the
 * panel for that app, so the browser's back button returns to the gallery, and
 * `#/<app>/sim` opens it on the Simulator tab. `?category=` and `?kind=` filter the gallery
 * and follow its filters. Guide in the top bar walks through the page, and a first visit
 * (nothing saved yet) starts it by itself.
 */
export const mountLanding = (root: HTMLElement, apps: readonly AppManifest[]): void => {
  // The operator's own display sizes, if they gave them, before anything draws or sizes frames.
  setActiveVenue(readVenueText(loadVenueText()).profile);
  if (apps.length === 0) {
    root.append(h("main", { class: "page" }, h("p", {}, "No apps are registered.")));
    return;
  }

  const guideButton = h(
    "button",
    { type: "button", class: "nav-link", "data-tour": "guide-nav", onclick: () => tour.start() },
    "Guide",
  );
  const configure = h("a", { class: "nav-link", href: "#" }, "Configure");
  const nav = h(
    "nav",
    { class: "nav", "aria-label": "Pages" },
    guideButton,
    configure,
    h("a", { class: "nav-link", href: "./sim/" }, "Simulator"),
    h("a", { class: "nav-link", href: "./admin/", "data-tour": "admin-nav" }, "Admin"),
  );
  const brand = h(
    "a",
    { class: "brand", href: "#" },
    h("span", { class: "brand-mark" }, createMark()),
    h("span", { class: "brand-name" }, "Hypercube"),
  );
  const topbar = h("header", { class: "topbar" }, h("div", { class: "topbar-inner" }, brand, nav));

  // Read before the panel saves its first configuration, which every later visit then finds.
  const saved = loadSaved();
  const start = parseHash(location.hash);
  const panel = createPanel(apps, saved, {
    initialApp: start.app,
    initialTab: start.tab,
    onAppChange(id) {
      history.replaceState(null, "", hashFor(id, panel.tab));
      sync();
    },
    onTabChange(tab) {
      history.replaceState(null, "", hashFor(panel.app, tab));
      sync();
    },
  });
  const gallery = createGallery(apps, {
    configureHref: () => `#/${encodeURIComponent(panel.app)}`,
    filters: filtersFromSearch(location.search),
    onFilter: writeFilters,
  });
  const guide = createGuide({
    app: () => panel.app,
    tryOut(patch) {
      const app = apps.find((a) => a.id === patch.app);
      const support = app && patch.setup ? supportFor(app, patch.setup) : undefined;
      if (!support || !patch.kind || !kindChoices(support).includes(patch.kind)) return false;
      panel.apply(patch);
      return true;
    },
    snapshot: () => panel.snapshot(),
    restore: (cfg) => panel.apply(cfg),
  });
  const tour = createTour(guide.steps, { onStop: guide.onStop });
  const main = h("main", { class: "page" }, gallery.el, panel.el);
  const footer = h(
    "footer",
    { class: "site-foot" },
    h("a", { href: "https://github.com/ScriptSmith/hypercube" }, "Source code"),
    h("a", { href: "./third-party-licenses.txt" }, "Third-party licences"),
  );
  root.append(topbar, main, footer);

  let galleryScroll = 0;
  const sync = () => {
    configure.setAttribute("href", hashFor(panel.app, panel.tab));
    gallery.setSelected(panel.app);
    const app = apps.find((a) => a.id === panel.app);
    if (!panel.el.hidden && app) document.title = `${app.title} · Hypercube`;
  };

  const route = () => {
    const { app: id, tab } = parseHash(location.hash);
    const app = apps.find((a) => a.id === id);
    if (app) {
      if (!gallery.el.hidden) galleryScroll = window.scrollY;
      gallery.el.hidden = true;
      panel.el.hidden = false;
      panel.setTab(tab);
      panel.open(app.id);
      panel.setActive(true);
      configure.setAttribute("aria-current", "page");
      window.scrollTo(0, 0);
    } else {
      panel.setActive(false);
      panel.el.hidden = true;
      gallery.el.hidden = false;
      configure.removeAttribute("aria-current");
      document.title = "Hypercube";
      window.scrollTo(0, galleryScroll);
    }
    sync();
  };

  window.addEventListener("hashchange", route);
  route();
  if (saved === null && !start.app) tour.start();
};
