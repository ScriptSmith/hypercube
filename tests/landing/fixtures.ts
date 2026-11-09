import type { AppManifest } from "../../src/core/types";
import { applyChange, type LandingConfig, normalizeConfig } from "../../src/pages/landing/config";

export const ROOM = "k3j9x2mq7a";
export const PLAY = "https://example.org/hypercube/play/";

/** A connected game with every option type, solo and versus setups. */
export const puckGame: AppManifest = {
  id: "pucks",
  title: "Puck Table",
  category: "game",
  blurb: "Flick pucks into the far goal.",
  setups: [
    { setup: "solo", kinds: ["pair", "wall", "kiosk"] },
    { setup: "versus", kinds: ["wall", "screen"] },
  ],
  variants: [
    { id: "classic", title: "Classic" },
    { id: "paddles", title: "Paddles" },
  ],
  options: [
    {
      type: "enum",
      key: "pucks",
      title: "Pucks",
      values: [
        { id: "1", title: "One" },
        { id: "2", title: "Two" },
        { id: "many", title: "Lots & lots" },
      ],
      default: "2",
    },
    { type: "number", key: "speed", title: "Speed", min: 0.5, max: 2, step: 0.1, default: 1 },
    { type: "boolean", key: "kids", title: "Slow for children", default: true },
  ],
  network: "optional",
  stations: true,
};

/** A standalone visual with banks, corners and a screen. */
export const sparkVisual: AppManifest = {
  id: "sparks",
  title: "Sparks",
  category: "visual",
  blurb: "Launch sparks that burst above.",
  setups: [
    { setup: "bank", kinds: ["panel", "pair", "screen"] },
    { setup: "corner", kinds: ["panel", "screen"] },
    { setup: "solo", kinds: ["wall", "screen"] },
  ],
  network: "none",
};

/** A tool that only allows stations in a bank, so no screen URL. */
export const stationTool: AppManifest = {
  id: "checks",
  title: "Checks",
  category: "tool",
  blurb: "Bring-up checks.",
  setups: [{ setup: "bank", kinds: ["panel", "screen"], roles: ["station"] }],
  network: "required",
  hidden: true,
};

/** An app picker: its `apps` option lists the apps visitors may choose. */
export const pickerApp: AppManifest = {
  id: "picker",
  title: "Picker",
  category: "tool",
  blurb: "Choose an app.",
  setups: [{ setup: "solo", kinds: ["panel", "pair", "wall", "kiosk"] }],
  options: [{ type: "apps", key: "apps", title: "Apps to offer", default: [] }],
  network: "optional",
};

/** A fresh configuration for `manifest`, with `patch` applied the way the panel applies it. */
export const config = (
  manifest: AppManifest,
  patch: Partial<LandingConfig> = {},
): LandingConfig => {
  const base = normalizeConfig({ app: manifest.id, room: ROOM }, manifest, () => "unused-room");
  return applyChange(base, patch, manifest, () => "unused-room");
};
