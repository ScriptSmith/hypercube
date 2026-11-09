import { defineConfig } from "@playwright/test";
import { launchOptions } from "./scripts/lib/browser.mjs";
import { BASE_URL, EXTERNAL, PORT } from "./scripts/lib/server.mjs";

const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "e2e",
  // Parallel sessions (each with its own HC_OUTDIR) must not share trace and result files.
  outputDir: process.env.HC_OUTDIR ? `test-results-${process.env.HC_OUTDIR}` : "test-results",
  fullyParallel: true,
  forbidOnly: CI,
  // Multi-frame sim tests on software WebGL can starve each other; a retry shows up as flaky.
  retries: 1,
  workers: CI ? 2 : 4,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    browserName: "chromium",
    launchOptions: launchOptions(),
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium" }],
  // The production build, because it catches base-path and bundling problems the dev server hides.
  webServer: EXTERNAL
    ? undefined
    : {
        command: `pnpm build && pnpm preview --port ${PORT} --strictPort`,
        url: `${BASE_URL}play/`,
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
