import { expect, type Page, test } from "@playwright/test";
import { viewportFor, watchPage } from "../scripts/lib/play.mjs";

const URL =
  "play/?app=menu&kind=panel&fit=1080x1920&idle=5" +
  "&o.apps=idle,diag&o.cycle=1&o.every=1&o.wait=1";

const app = (page: Page) => page.evaluate(() => window.__hypercube?.app ?? null);
const next = (page: Page) =>
  page.evaluate(() => String(window.__hypercube?.appStatus().next ?? ""));

/** A person's tap (or hold) at the middle of an element, as real touch pointer events. */
const press = (page: Page, selector: string, holdMs = 0) =>
  page.evaluate(
    async ({ selector, holdMs }) => {
      const el = document.querySelector(selector)!;
      const r = el.getBoundingClientRect();
      const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
      const fire = (type: string) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            ...at,
            pointerId: 7,
            pointerType: "touch",
            bubbles: true,
            isPrimary: true,
            buttons: type === "pointerup" ? 0 : 1,
          }),
        );
      fire("pointerdown");
      await new Promise((res) => setTimeout(res, holdMs));
      fire("pointerup");
    },
    { selector, holdMs },
  );

test("the picker changes app by itself and waits for a visitor who comes back to it", async ({
  page,
}) => {
  const problems = watchPage(page);
  await page.setViewportSize(viewportFor({ width: 1080, height: 1920 }));
  await page.clock.install();
  await page.goto(URL);

  // It lights the app it is about to start, then starts it.
  await expect.poll(() => next(page)).not.toBe("");
  await expect(page.locator(".mn-tile.is-lit")).toHaveCount(1);
  await expect.poll(() => app(page)).not.toBe("menu");
  const first = await app(page);
  expect(["idle", "diag"]).toContain(first);

  // Nobody is touching when the minute is up, so the other app starts.
  await page.clock.fastForward(61_000);
  await expect.poll(() => app(page)).toBe(first === "idle" ? "diag" : "idle");

  // A visitor holding Home gets the picker, which waits for them.
  await press(page, ".hc-button", 1000);
  await expect.poll(() => app(page)).toBe("menu");
  await page.waitForTimeout(3000);
  expect(await app(page)).toBe("menu");
  expect(await next(page)).toBe("");

  // Left alone until idle, it carries on.
  await expect.poll(() => app(page), { timeout: 15_000 }).not.toBe("menu");

  // A touch while the next app glows keeps the picker for the visitor.
  await page.clock.fastForward(61_000);
  await expect.poll(() => next(page)).not.toBe("");
  await press(page, ".mn-title");
  expect(await next(page)).toBe("");
  await page.waitForTimeout(3000);
  expect(await app(page)).toBe("menu");

  expect(problems).toEqual([]);
});

const mounts = (page: Page) => page.evaluate(() => window.__hypercube?.mounts ?? 0);

test("a picker that is never shown starts an app with no Home button and keeps it", async ({
  page,
}) => {
  const problems = watchPage(page);
  await page.setViewportSize(viewportFor({ width: 1080, height: 1920 }));
  await page.clock.install();
  await page.goto("play/?app=menu&kind=panel&fit=1080x1920&idle=5&o.apps=idle&o.nopicker=1");
  await expect.poll(() => app(page)).toBe("idle");
  await expect(page.locator(".mn")).toHaveCount(0);
  await expect(page.locator(".hc-button")).toHaveCount(0);
  const before = await mounts(page);
  await page.clock.fastForward(2 * 60 * 60_000);
  await page.waitForTimeout(500);
  expect(await app(page)).toBe("idle");
  expect(await mounts(page)).toBe(before);
  expect(problems).toEqual([]);
});

test("a sphere's picker is never seen and changes app every few minutes", async ({ page }) => {
  const problems = watchPage(page);
  await page.setViewportSize(viewportFor({ width: 4096, height: 2048 }));
  await page.clock.install();
  await page.goto(
    "play/?app=menu&kind=sphere&fit=4096x2048&idle=5&o.apps=beachball,ticker&o.cycle=1&o.every=1",
  );
  await expect.poll(() => app(page)).not.toBe("menu");
  const first = await app(page);
  expect(["beachball", "ticker"]).toContain(first);
  await expect(page.locator(".mn")).toHaveCount(0);
  await expect(page.locator(".hc-button")).toHaveCount(0);
  await page.clock.fastForward(61_000);
  await expect.poll(() => app(page)).toBe(first === "beachball" ? "ticker" : "beachball");
  expect(problems).toEqual([]);
});

test("a picker starts an app with the options its URL gives for that app", async ({ page }) => {
  const problems = watchPage(page);
  await page.setViewportSize(viewportFor({ width: 4096, height: 2048 }));
  await page.goto(
    "play/?app=menu&kind=sphere&fit=4096x2048&o.apps=ticker&o.ticker.rings=3&o.ticker.style=white&o.ticker.message1=Typed",
  );
  await expect.poll(() => app(page)).toBe("ticker");
  const options = await page.evaluate(() => window.__hypercube?.options);
  // Operator text never comes from a URL, for a launched app either.
  expect(options).toMatchObject({ rings: "3", style: "white", speed: "normal", message1: "" });
  expect(problems).toEqual([]);
});

test("a picker can start apps without a Home button", async ({ page }) => {
  const problems = watchPage(page);
  await page.setViewportSize(viewportFor({ width: 1080, height: 1920 }));
  await page.goto("play/?app=menu&kind=panel&fit=1080x1920&o.apps=idle&o.nohome=1");
  await expect(page.locator(".mn-tile")).toHaveCount(1);
  await press(page, ".mn-tile");
  await expect.poll(() => app(page)).toBe("idle");
  await page.waitForTimeout(500);
  await expect(page.locator(".hc-button")).toHaveCount(0);
  expect(problems).toEqual([]);
});
