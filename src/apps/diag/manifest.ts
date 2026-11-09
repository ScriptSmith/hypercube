import type { AppManifest } from "../../core/types";

const ALL_TOUCH = ["panel", "pair", "wall", "kiosk"] as const;

const manifest: AppManifest = {
  id: "diag",
  title: "Diagnostics",
  category: "tool",
  blurb: "Bring-up checks for a display: identity, screen, GPU, frame rate, touch and network.",
  setups: [
    { setup: "solo", kinds: [...ALL_TOUCH, "screen", "sphere"] },
    { setup: "bank", kinds: ["panel", "pair", "screen"] },
    { setup: "corner", kinds: ["panel", "pair", "screen"] },
    { setup: "versus", kinds: [...ALL_TOUCH] },
  ],
  network: "optional",
};

export default manifest;
