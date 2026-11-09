import type { AppManifest, FrameKind } from "../../core/types";

const TOUCH: FrameKind[] = ["panel", "pair", "wall", "kiosk"];

const manifest: AppManifest = {
  id: "menu",
  title: "Picker",
  category: "tool",
  blurb:
    "Visitors choose which app to run on this display, and it comes back here when they leave. It can also change app by itself every few minutes, as it does unseen on a sphere.",
  setups: [{ setup: "solo", kinds: [...TOUCH, "sphere"] }],
  options: [
    { type: "apps", key: "apps", title: "Apps to offer", default: [] },
    { type: "boolean", key: "cycle", title: "Change app by itself", default: false },
    {
      type: "number",
      key: "every",
      title: "Minutes per app",
      min: 1,
      max: 60,
      step: 1,
      default: 5,
      when: { key: "cycle", is: [true] },
    },
    {
      type: "number",
      key: "wait",
      title: "Minutes more for players to finish",
      min: 0,
      max: 30,
      step: 1,
      default: 5,
      kinds: TOUCH,
      when: { key: "cycle", is: [true] },
    },
    {
      type: "boolean",
      key: "nopicker",
      title: "Never show the picker",
      default: false,
      kinds: TOUCH,
    },
    {
      type: "boolean",
      key: "nohome",
      title: "Never show the Home button",
      default: false,
      kinds: TOUCH,
      when: { key: "nopicker", is: [false] },
    },
  ],
  network: "none",
};

export default manifest;
