// Chromium settings shared by playwright.config.ts, shots and soak.
import { existsSync } from "node:fs";

const SYSTEM_CHROMIUM = "/usr/bin/chromium";

/** CHROMIUM_PATH, else the system Chromium, else undefined so Playwright uses its own download. */
export const chromiumPath = () =>
  process.env.CHROMIUM_PATH || (existsSync(SYSTEM_CHROMIUM) ? SYSTEM_CHROMIUM : undefined);

export const CHROMIUM_ARGS = [
  // Unquantised performance.memory for the soak.
  "--enable-precise-memory-info",
  // WebGL on machines without a GPU, as on CI. Newer Chromium wants this to be explicit.
  "--enable-unsafe-swiftshader",
  // Several pages and iframes run at once; none of them may be throttled as a background tab.
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  ...(process.env.CHROMIUM_ARGS ?? "").split(/\s+/).filter(Boolean),
];

export const launchOptions = () => ({ executablePath: chromiumPath(), args: CHROMIUM_ARGS });

export const launchChromium = async () => {
  const { chromium } = await import("@playwright/test");
  return chromium.launch(launchOptions());
};
