import { expect, type Page, test } from "@playwright/test";
import { derivePinVerifier } from "../src/core/adminkey";

const ROOM = "e2eadminroom";
const AK = "c-yMpewyWDZTXfFaZYlImA";

test("admin connects from its form and remembers the room", async ({ context }) => {
  const frame = await context.newPage();
  await frame.goto(`play/?app=diag&room=${ROOM}&frame=e2e-diag&transport=local`);
  await frame.waitForFunction(() => window.__hypercube?.phase === "running");

  const admin = await context.newPage();
  const errors: string[] = [];
  admin.on("pageerror", (e) => errors.push(String(e)));
  await admin.goto("admin/?transport=local");
  await admin.fill('input[data-focus="room"]', ROOM);
  await admin.fill('input[data-focus="ak"]', AK);
  await admin.fill('input[data-focus="pin"]', "4821");
  await admin.click('button[type="submit"]');
  await admin.waitForFunction(() => window.__hypercubeAdmin?.unlocked === true);
  await expect(admin.locator(".hca-row").first()).toBeVisible({ timeout: 30_000 });
  expect(await admin.evaluate(() => location.search)).toBe("?transport=local");

  // A reload brings the form back, filled in, and Connect goes straight in.
  await admin.reload();
  await expect(admin.locator('input[data-focus="room"]')).toHaveValue(ROOM);
  await expect(admin.locator('input[data-focus="ak"]')).toHaveValue(AK);
  await expect(admin.locator('input[data-focus="pin"]')).toHaveValue("4821");
  await admin.click('button[type="submit"]');
  await admin.waitForFunction(() => window.__hypercubeAdmin?.unlocked === true);

  // Change room leaves it and shows the form again.
  await admin.click(".adm-change");
  await expect(admin.locator(".adm-connect")).toBeVisible();
  expect(await admin.evaluate(() => window.__hypercubeAdmin?.room ?? null)).toBeNull();
  expect(errors).toEqual([]);
});

test("an admin override lasts until the next reload or the browser session", async ({
  context,
}) => {
  const url = `play/?app=diag&room=${ROOM}&frame=e2e-keep&transport=local&ak=${AK}`;
  const app = (p: Page) => p.evaluate(() => window.__hypercube?.app ?? null);
  const frame = await context.newPage();
  await frame.goto(url);
  await frame.waitForFunction(() => window.__hypercube?.phase === "running");

  const admin = await context.newPage();
  await admin.goto("admin/?transport=local");
  await admin.fill('input[data-focus="room"]', ROOM);
  await admin.fill('input[data-focus="ak"]', AK);
  await admin.fill('input[data-focus="pin"]', "4821");
  await admin.click('button[type="submit"]');
  const row = admin.locator('.hca-row[data-frame="e2e-keep"]');
  await expect(row).toBeVisible({ timeout: 30_000 });
  const runIdle = async (lasts: string) => {
    // A reloading frame leaves the room for a moment, which drops it from the selection.
    await expect(async () => {
      if (!(await row.evaluate((r) => r.classList.contains("is-selected")))) await row.click();
      await expect(row).toHaveClass(/is-selected/, { timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await admin.getByRole("button", { name: "App", exact: true }).click();
    await admin.getByRole("button", { name: "Idle (tool)" }).click();
    await admin.getByRole("button", { name: lasts }).click();
    await admin.getByRole("button", { name: "Run Idle" }).click();
    await expect.poll(() => app(frame), { timeout: 15_000 }).toBe("idle");
  };

  await runIdle("Until the next reload");
  await expect(row.locator(".hca-tag")).toContainText(["override until reload"]);
  await frame.reload();
  await frame.waitForFunction(() => window.__hypercube?.phase === "running");
  expect(await app(frame)).toBe("diag");
  // Wait for the reloaded frame to rejoin and report, so its leaving can't drop the selection
  // after the next step has made it.
  await expect(row.locator(".hca-tag", { hasText: "override until reload" })).toHaveCount(0, {
    timeout: 15_000,
  });

  await runIdle("Until the browser closes");
  await frame.reload();
  await frame.waitForFunction(() => window.__hypercube?.phase === "running");
  expect(await app(frame)).toBe("idle");

  // A new tab is a new session, so it shows what its URL says.
  const other = await context.newPage();
  await other.goto(url);
  await other.waitForFunction(() => window.__hypercube?.phase === "running");
  expect(await app(other)).toBe("diag");
});

test("an admin link asks for the PIN, then Change room drops its keys", async ({ page }) => {
  const pv = await derivePinVerifier("4821", AK);
  await page.goto(`admin/?room=${ROOM}&ak=${AK}&pv=${pv}&transport=local`);
  await expect(page.locator(".adm-pad-wrap")).toBeVisible();
  await page.keyboard.type("4821");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__hypercubeAdmin?.unlocked === true);
  await page.click(".adm-change");
  await expect(page.locator('input[data-focus="room"]')).toHaveValue(ROOM);
  expect(await page.evaluate(() => location.search)).toBe("?transport=local");
});

test("the configure page runs its setup in the Simulator tab", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("#/diag");
  await expect(page.locator("#out-tab-urls")).toHaveAttribute("aria-selected", "true");
  await page.click("#out-tab-sim");
  expect(await page.evaluate(() => location.hash)).toBe("#/diag/sim");
  const sim = page.locator(".sim-box iframe");
  await expect(sim).toHaveAttribute("src", /\/sim\/\?preset=.*&app=diag.*&embed=1$/);
  const inner = page.frameLocator(".sim-box iframe");
  await expect(inner.locator(".sim-frame[data-frame]").first()).toBeVisible({ timeout: 30_000 });
  // Only the view controls in the embedded sim: the configure form sets everything else.
  await expect(inner.locator(".sim-groups")).toHaveCount(0);
  await expect(inner.locator("select").first()).toBeVisible();
  await expect(inner.getByText("Network")).toHaveCount(0);

  // Back on the URLs tab the simulator unloads.
  await page.click("#out-tab-urls");
  await expect(sim).toHaveAttribute("src", "about:blank");
  expect(errors).toEqual([]);
});

test("the configure page sets up a sphere and simulates it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("#/diag");
  await page.locator('label:has(input[data-focus="kind:sphere"])').click();
  const url = await page.locator(".url textarea").first().inputValue();
  const q = new URL(url).searchParams;
  expect([q.get("app"), q.get("setup"), q.get("role"), q.get("kind")]).toEqual([
    "diag",
    "solo",
    "solo",
    "sphere",
  ]);
  await expect(page.locator(".url textarea")).toHaveCount(1);
  await expect(page.locator(".diagram circle.f-body")).toBeVisible();
  await expect(page.locator(".preview-box iframe")).toHaveAttribute("src", /look=globe/);

  await page.click("#out-tab-sim");
  const sim = page.locator(".sim-box iframe");
  await expect(sim).toHaveAttribute("src", /\/sim\/\?preset=sphere&app=diag.*&embed=1$/);
  const inner = page.frameLocator(".sim-box iframe");
  await expect(inner.locator('.sim-frame[data-frame="a-sphere"]')).toBeVisible({
    timeout: 30_000,
  });
  await expect(inner.locator(".sim-ball-outline")).toHaveCount(1);
  await expect(inner.getByRole("checkbox", { name: "Globe" })).toBeChecked();
  expect(errors).toEqual([]);
});

test("a first visit starts the guide, which follows a picked card", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("./");
  await expect(page.locator(".tour-title")).toHaveText("Pick an app");
  await page.click('a.card[data-app="fireworks"]');
  await expect(page.locator(".tour-title")).toHaveText("The app");
  // The spotlight glides over, and the page may scroll, so wait for it to settle on the section.
  await expect
    .poll(async () => {
      const spot = await page.locator(".tour-spot").boundingBox();
      const section = await page.locator('[data-tour="app"]').boundingBox();
      return spot && section ? Math.abs(spot.y + 8 - section.y) : Infinity;
    })
    .toBeLessThan(2);
  await page.keyboard.press("Escape");
  await expect(page.locator(".tour-tip")).toHaveCount(0);
  expect(errors).toEqual([]);
});
