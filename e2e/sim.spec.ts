import { expect, type Page, test } from "@playwright/test";
import { discoverApps } from "../scripts/lib/apps.mjs";
import { watchPage } from "../scripts/lib/play.mjs";
import type { RuntimeState } from "../src/core/runtime";
import type { AppManifest } from "../src/core/types";

/** Election, joins and clock sync can take a while with a corner's frames sharing one CPU. */
const SETTLE_MS = 120_000;
/** Everything must hold this long, so a brief second hub during election can't pass. */
const STABLE_MS = 5_000;

/** Platform checks that run whatever the app's setups say. */
const PLATFORM: Record<string, string[]> = {
  idle: ["bank-panels", "bank-pairs", "corner", "versus"],
};

/**
 * The picker on a sphere hands it straight to another app, so the sim never finds the picker
 * running there; the smoke test and `menu.spec.ts` cover it.
 */
const HANDS_OFF: Record<string, string[]> = { menu: ["sphere"] };

/** The sim presets that exercise an app's multi-frame setups with the kinds it declares. */
const presetsFor = (app: AppManifest): string[] => {
  const out = new Set(PLATFORM[app.id] ?? []);
  for (const s of app.setups) {
    if (s.setup === "bank" && s.kinds.includes("panel")) out.add("bank-panels");
    if (s.setup === "bank" && s.kinds.includes("pair")) out.add("bank-pairs");
    if (s.setup === "corner" && s.kinds.includes("panel")) out.add("corner");
    if (s.setup === "versus" && s.kinds.includes("wall")) out.add("versus");
    if (s.setup === "solo" && s.kinds.includes("sphere")) out.add("sphere");
  }
  for (const preset of HANDS_OFF[app.id] ?? []) out.delete(preset);
  return [...out];
};

interface FrameSnap {
  id: string;
  phase: RuntimeState["phase"] | "loading";
  app: string | null;
  room: RuntimeState["room"];
  hub: boolean;
  roster: number;
  errors: string[];
}

const snapshot = (page: Page): Promise<FrameSnap[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".sim-frame[data-frame]")].map((el) => {
      const s = el.querySelector("iframe")?.contentWindow?.__hypercube;
      let roster = 0;
      try {
        roster = s?.net?.roster().length ?? 0;
      } catch {
        // Mid-reconnect; the next poll reads it again.
      }
      return {
        id: el.dataset.frame ?? "?",
        phase: s?.phase ?? "loading",
        app: s?.app ?? null,
        room: s?.room ?? "none",
        hub: s?.net?.isHub ?? false,
        roster,
        errors: s ? [...s.errors] : [],
      };
    }),
  );

const issuesWith = (frames: FrameSnap[], app: string, expected: number): string[] => {
  const issues: string[] = [];
  if (frames.length !== expected) issues.push(`${frames.length} of ${expected} frames present`);
  for (const f of frames) {
    if (f.phase !== "running" || f.app !== app) issues.push(`${f.id}: ${f.app ?? "-"} ${f.phase}`);
    // Every sim frame has an identity and the room token, so each one should be networked.
    if (f.room !== "online") issues.push(`${f.id}: room ${f.room}`);
  }
  const hubs = frames.filter((f) => f.hub);
  if (hubs.length !== 1) {
    issues.push(`${hubs.length} hubs: ${hubs.map((f) => f.id).join(", ") || "none"}`);
  } else if (hubs[0] && hubs[0].roster !== frames.length) {
    issues.push(`hub ${hubs[0].id} lists ${hubs[0].roster} of ${frames.length} frames`);
  }
  return issues;
};

const apps = await discoverApps();

for (const app of apps) {
  for (const preset of presetsFor(app)) {
    test(`sim runs ${app.id} in ${preset}`, async ({ page }) => {
      test.setTimeout(SETTLE_MS + 60_000);
      const problems = watchPage(page);
      await page.setViewportSize({ width: 1600, height: 1000 });
      await page.goto(`sim/?preset=${preset}&app=${app.id}&transport=local&bots=2&seed=test`);
      await page.waitForFunction(() => window.__hypercubeSim !== undefined);
      const expected = await page.evaluate(() => window.__hypercubeSim?.frames().length ?? 0);
      expect(expected, "frames in the preset").toBeGreaterThan(0);

      const start = Date.now();
      let frames: FrameSnap[] = [];
      let issues = ["never checked"];
      let stableSince = 0;
      while (Date.now() - start < SETTLE_MS) {
        frames = await snapshot(page);
        issues = issuesWith(frames, app.id, expected);
        if (issues.length > 0) {
          stableSince = 0;
        } else {
          stableSince ||= Date.now();
          if (Date.now() - stableSince >= STABLE_MS) break;
        }
        await page.waitForTimeout(500);
      }
      const settled = ((stableSince || Date.now()) - start) / 1000;
      test.info().annotations.push({ type: "settled", description: `${settled.toFixed(1)} s` });

      expect(issues, `frame states after ${settled.toFixed(0)} s`).toEqual([]);
      const errors = frames.flatMap((f) => f.errors.map((e) => `${f.id}: ${e}`));
      expect.soft(errors, "__hypercube.errors in frames").toEqual([]);
      expect.soft(problems, "page and console errors").toEqual([]);
    });
  }
}

test("sim shows a sphere as a globe or its flat feed, and focuses it", async ({ page }) => {
  const problems = watchPage(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("sim/?preset=sphere&app=diag&transport=local");
  await page.waitForFunction(() => window.__hypercubeSim !== undefined);
  const frameParams = () =>
    page.evaluate(() => {
      const url = window.__hypercubeSim?.frames()[0]?.url;
      return url ? Object.fromEntries(new URL(url).searchParams) : null;
    });
  expect(await frameParams()).toMatchObject({
    kind: "sphere",
    setup: "solo",
    role: "solo",
    w: "4096",
    h: "2048",
    sphere: "4,3",
    look: "globe",
  });
  await expect
    .poll(() => page.evaluate(() => window.__hypercubeSim?.frames()[0]?.status.phase), {
      timeout: 30_000,
    })
    .toBe("running");
  await expect(page.locator(".sim-ball-outline")).toHaveCount(1);
  await expect(page.locator(".sim-hang")).toHaveCount(1);
  await expect(page.locator(".sim-person")).toHaveCount(4);

  // The view choice reloads only the sphere's URL, and is remembered.
  const globe = page.getByRole("checkbox", { name: "Globe" });
  await globe.uncheck();
  expect((await frameParams())?.look).toBeUndefined();
  await page.reload();
  await page.waitForFunction(() => window.__hypercubeSim !== undefined);
  await expect(page.getByRole("checkbox", { name: "Globe" })).not.toBeChecked();
  expect((await frameParams())?.look).toBeUndefined();
  await page.getByRole("checkbox", { name: "Globe" }).check();
  expect((await frameParams())?.look).toBe("globe");

  // Focused, the sphere fills the window and takes the pointer, for dragging round the globe.
  await page.click('.sim-badge[data-frame="a-sphere"] .sim-badge-main');
  expect(await page.evaluate(() => window.__hypercubeSim?.focused)).toBe("a-sphere");
  const box = await page.locator('.sim-frame[data-frame="a-sphere"]').boundingBox();
  expect(box?.width).toBeGreaterThan(1200);
  const hit = await page.evaluate(
    ({ x, y }) =>
      document.elementFromPoint(x, y)?.closest(".sim-frame")?.getAttribute("data-frame"),
    { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 },
  );
  expect(hit).toBe("a-sphere");
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => window.__hypercubeSim?.focused)).toBeNull();
  expect(problems).toEqual([]);
});

test("sim gives its frames the venue profile, and they size themselves from it", async ({
  page,
}) => {
  const problems = watchPage(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(
    "sim/?preset=bank&count=2&app=diag&transport=local&venue=panel:768x1366:0.6x1.07:0.9,bank:4",
  );
  await page.waitForFunction(() => window.__hypercubeSim !== undefined);
  const params = await page.evaluate(() =>
    window
      .__hypercubeSim!.frames()
      .map((f) => Object.fromEntries(new URL(f.url ?? "").searchParams)),
  );
  expect(params.map((p) => p.frame)).toEqual(["a-screen", "a-p1", "a-p2"]);
  for (const p of params) expect(p.venue).toBe("panel:768x1366:0.6x1.07:0.9,bank:2");
  expect(params[1]).toMatchObject({ w: "768", h: "1366" });
  const venueSizeOf = (id: string) =>
    page.evaluate((frame) => {
      const el = document.querySelector<HTMLIFrameElement>(
        `.sim-frame[data-frame="${frame}"] iframe`,
      );
      const f = el?.contentWindow?.__hypercube?.frame;
      return f ? [f.venueWidth, f.venueHeight, Number(f.reach.child.toFixed(3))] : null;
    }, id);
  await expect.poll(() => venueSizeOf("a-p2"), { timeout: 30_000 }).toEqual([768, 1366, 0.561]);
  expect(problems).toEqual([]);
});
