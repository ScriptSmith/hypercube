import type { AppManifest } from "../../core/types";

const manifest: AppManifest = {
  id: "idle",
  title: "Idle",
  category: "tool",
  blurb: "A quiet holding screen.",
  setups: [{ setup: "solo", kinds: ["panel", "pair", "wall", "screen", "kiosk", "sphere"] }],
  network: "none",
  hidden: true,
};

export default manifest;
