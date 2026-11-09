import type { LandingConfig } from "./config";
import type { OutputTab } from "./panel";
import type { TourStep } from "./tour";

/** The first match that isn't inside something hidden. */
const shown = (selector: string): Element | null =>
  [...document.querySelectorAll(selector)].find((el) => !el.closest("[hidden]")) ?? null;

const appHash = (app: string, tab: OutputTab = "urls"): string =>
  `#/${encodeURIComponent(app)}${tab === "sim" ? "/sim" : ""}`;

/** What the guide needs from the page. */
export interface GuidePage {
  /** The app the panel has open, which a picked card changes. */
  app(): string;
  /** Show another app or setup in the panel and simulator; false if this site can't. */
  tryOut(patch: Partial<LandingConfig>): boolean;
  snapshot(): LandingConfig;
  restore(cfg: LandingConfig): void;
}

/** Other apps and setups the guide shows in the simulator, each with what to look for. */
const SHOWCASE: readonly { patch: Partial<LandingConfig>; title: string; text: string }[] = [
  {
    patch: { app: "fireworks", setup: "bank", kind: "panel", screen: true, count: 6 },
    title: "A row of panels",
    text: "The guide has switched the settings to Fireworks on six panels with the screen above. A shell built on a panel bursts on the screen over it.",
  },
  {
    patch: { app: "robotarm", setup: "bank", kind: "pair", span: 2, screen: true, count: 3 },
    title: "Merged pairs",
    text: "Robot Arm on three pairs of merged panels. Each pair works its own arm, and pieces sent up its lift fill one big picture on the screen together.",
  },
  {
    patch: { app: "tinyworld", setup: "solo", kind: "wall" },
    title: "A touch wall",
    text: "Tiny World on one wide wall. Only the lower part is in reach, so the controls sit there and the rest is for watching.",
  },
  {
    patch: { app: "hockey", setup: "versus", kind: "wall", screen: false, count: 1 },
    title: "Two walls",
    text: "Table Hockey with two walls playing each other. Each wall holds one end of the table, and pucks slide from one to the other.",
  },
];

/**
 * The landing page's guide: from the gallery through the configuration panel to the URLs and
 * the simulator, a few other apps and setups running there, then admin. The showcase changes
 * the operator's settings, so they are kept when it starts and put back when it ends or the
 * guide is closed (`onStop`). Steps that wait for the operator read the address, which each
 * step sets as it opens, so going back never finds an earlier step already done.
 */
export const createGuide = (page: GuidePage): { steps: TourStep[]; onStop(): void } => {
  let own: LandingConfig | null = null;
  const putBack = () => {
    if (own) page.restore(own);
    own = null;
  };
  const showcase: TourStep[] = SHOWCASE.map((s) => ({
    enter: () => {
      own ??= page.snapshot();
      return page.tryOut(s.patch);
    },
    hash: () => appHash(page.app(), "sim"),
    target: () => shown('[data-tour="sim"]'),
    title: s.title,
    text: s.text,
  }));
  const steps = guideSteps(page);
  const at = steps.findIndex((s) => s.title === "The simulator") + 1;
  steps.splice(at, 0, ...showcase, {
    enter: () => {
      putBack();
    },
    hash: () => appHash(page.app(), "sim"),
    target: () => shown('[data-tour="sim"]'),
    title: "Your settings again",
    text: "Your own app and setup are back. Change anything on the left and the simulator follows.",
  });
  return { steps, onStop: putBack };
};

const guideSteps = (page: Pick<GuidePage, "app">): TourStep[] => [
  {
    hash: () => "#",
    target: () => shown("a.card"),
    title: "Pick an app",
    text: "Each card is a game, visual or tool for the displays. Pick any card to set it up, and the guide carries on there.",
    doneWhen: () => /^#\/[a-z0-9-]+/.test(location.hash),
    next: () => {
      location.hash = appHash(page.app());
    },
  },
  {
    hash: () => appHash(page.app()),
    target: () => shown('[data-tour="app"]'),
    title: "The app",
    text: "This is the app you're setting up, and its rule variant. You can switch to another app here at any time.",
  },
  {
    hash: () => appHash(page.app()),
    target: () => shown('[data-tour="options"]'),
    title: "Options",
    text: "Options change how it plays. When the picker launches an app, visitors can change some of these themselves.",
  },
  {
    hash: () => appHash(page.app()),
    target: () => shown('[data-tour="setup"]'),
    title: "Where it runs",
    text: "Solo is one display. Bank is a row of panels, usually with a screen above. Corner joins two banks at a corner, and versus sets two sides against each other. Each app offers the setups it supports.",
  },
  {
    hash: () => appHash(page.app()),
    target: () => shown('[data-tour="diagram"]'),
    title: "The frames",
    text: "The frames this setup uses, as they hang. The shading is what children can reach and the line is adults' reach. Point at a URL below to light up its frames.",
  },
  {
    hash: () => appHash(page.app()),
    target: () => shown('[data-tour="room"]'),
    title: "The room",
    text: "Frames with the same room token find each other, and admin reaches them through it. Keep it private. If you run your own signalling server, choose it here.",
  },
  {
    hash: () => appHash(page.app()),
    target: () => shown('[data-tour="admin"]'),
    title: "Admin PIN",
    text: "Set a 4 to 8 digit PIN to turn admin on. On a frame, tap its bottom-left corner five times within three seconds, hold the sixth tap, then type the PIN. This browser remembers it.",
  },
  {
    hash: () => appHash(page.app()),
    target: () => shown('[data-tour="urls"]'),
    title: "The URLs",
    text: "Paste these into your host, one URL for each kind of frame. The host fills in each display's identity. Copy all copies every one.",
  },
  {
    hash: () => appHash(page.app()),
    target: () => shown("#out-tab-sim"),
    title: "Try it first",
    text: "The Simulator tab runs every frame of this setup here in the page, before anything goes on the real displays.",
    doneWhen: () => location.hash.endsWith("/sim"),
    next: () => {
      location.hash = appHash(page.app(), "sim");
    },
  },
  {
    hash: () => appHash(page.app(), "sim"),
    target: () => shown('[data-tour="sim"]'),
    title: "The simulator",
    text: "Each frame runs as it will on the displays, in a room of its own. Tap a frame's badge to focus it, then try it with the mouse or by touch. It follows your settings as you change them.",
  },
  {
    target: () => shown('[data-tour="admin-nav"]'),
    title: "Admin",
    text: "The admin page runs a live room from a phone or laptop: change what frames show, reload them or put up a notice. Once a PIN is set, Open admin under the URLs fills in the room for you.",
  },
  {
    target: () => shown('[data-tour="guide-nav"]'),
    title: "That's it",
    text: "Start this guide again from here whenever you need it.",
  },
];
