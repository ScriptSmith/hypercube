import { expect, type Page, test } from "@playwright/test";
import { playPath, viewportFor, waitForRunning, watchPage } from "../scripts/lib/play.mjs";
import { BLANK_STDDEV, decodePng, pixelStats } from "../scripts/lib/png.mjs";

const FEED = { width: 4096, height: 2048 };

interface TickerLine {
  kind: string;
  text: string;
}

interface TickerRing {
  role: string;
  top: number;
  bottom: number;
  letterM: number;
  printed: number;
  tiles: number;
  printer: number;
  lines: TickerLine[];
  recent: TickerLine[];
}

interface TickerState {
  t: number;
  ready: boolean;
  style: string;
  list: string;
  operator: number;
  feed: { width: number; height: number };
  rings: TickerRing[];
}

declare global {
  interface Window {
    __ticker?: { state(): TickerState; skip(seconds: number): void };
  }
}

const open = async (page: Page, params: Record<string, string> = {}) => {
  const problems = watchPage(page);
  await page.setViewportSize(viewportFor(FEED));
  await page.goto(
    playPath({
      app: "ticker",
      kind: "sphere",
      size: FEED,
      bots: 0,
      params: { debug: "1", ...params },
    }),
  );
  const started = await waitForRunning(page);
  expect(started.phase, started.errors.join("; ")).toBe("running");
  await page.waitForFunction(() => window.__ticker?.state().ready === true, undefined, {
    timeout: 20_000,
  });
  return problems;
};

const state = (page: Page) => page.evaluate(() => window.__ticker!.state());
const skip = (page: Page, seconds: number) =>
  page.evaluate((s) => window.__ticker!.skip(s), seconds);

/** Spread of luminance in a box of the page, so a blank area reads near 0. */
const spread = async (page: Page, clip: { x: number; y: number; width: number; height: number }) =>
  pixelStats(decodePng(await page.screenshot({ clip }))).stddev;

/**
 * Leave an admin override for a frame, as a signed `set` command does, so the frame mounts with
 * these options when it next loads in this tab. Text options only ever arrive this way.
 */
const leaveOverride = (page: Page, room: string, frame: string, options: Record<string, unknown>) =>
  page.evaluate(([key, opts]) => sessionStorage.setItem(key, JSON.stringify({ options: opts })), [
    `hc:override:${room}:${frame}`,
    options,
  ] as const);

test.describe("ticker", () => {
  test("ticker: crawls two rings below the equator, full from the start", async ({ page }) => {
    const problems = await open(page);
    const s = await state(page);
    expect(s.rings.map((r) => r.role)).toEqual(["main", "lower"]);
    const view = await page.evaluate(() => window.__hypercube!.frame!.sphere!.view);
    for (const r of s.rings) {
      expect(r.top).toBeLessThanOrEqual(view.top);
      expect(r.bottom).toBeGreaterThanOrEqual(view.bottom);
      expect(r.lines.length).toBeGreaterThan(0);
    }
    expect(s.rings[0]!.top).toBeLessThan(0.1);
    // Both bands are drawn, and the picture isn't blank.
    const shot = await page.locator(".hc-stage").screenshot();
    expect(pixelStats(decodePng(shot)).stddev).toBeGreaterThan(BLANK_STDDEV);
    const box = (await page.locator(".hc-stage").boundingBox())!;
    for (const r of s.rings) {
      const y = box.y + ((Math.PI / 2 - (r.top + r.bottom) / 2) / Math.PI) * box.height;
      const band = { x: box.x, y: y - 6, width: box.width, height: 12 };
      expect(await spread(page, band), r.role).toBeGreaterThan(BLANK_STDDEV);
    }
    // The words move.
    const before = await state(page);
    await page.waitForTimeout(1500);
    const after = await state(page);
    expect(after.t).toBeGreaterThan(before.t + 1);
    expect(after.rings[0]!.printer).not.toBe(before.rings[0]!.printer);
    expect(problems).toEqual([]);
  });

  test("ticker: the show moves on, with the time now and then, and stays bounded", async ({
    page,
  }) => {
    const problems = await open(page);
    const first = await state(page);
    const seen = new Set<string>();
    const kinds = new Set<string>();
    for (let i = 0; i < 12; i++) {
      await skip(page, 60);
      const s = await state(page);
      for (const r of s.rings) {
        for (const l of r.recent) {
          seen.add(l.text);
          kinds.add(l.kind);
        }
        expect(r.tiles, r.role).toBeLessThan(80);
      }
    }
    const last = await state(page);
    expect(last.rings[0]!.printed).toBeGreaterThan(first.rings[0]!.printed + 10);
    expect(last.rings[0]!.lines).not.toEqual(first.rings[0]!.lines);
    expect(seen.size).toBeGreaterThan(20);
    for (const k of ["greet", "fact", "time", "date"]) expect(kinds, k).toContain(k);
    expect([...seen].some((t) => /^The time is \d{1,2}:\d\d (am|pm)$/.test(t))).toBe(true);
    expect(problems).toEqual([]);
  });

  test("ticker: an idle reset doesn't restart the show", async ({ page }) => {
    const problems = await open(page, { idle: "2" });
    const before = await state(page);
    await page.waitForTimeout(3500);
    const after = await state(page);
    expect(after.t).toBeGreaterThan(before.t);
    expect(after.rings[0]!.printed).toBeGreaterThanOrEqual(before.rings[0]!.printed);
    // The oldest words on the ring then are still there or have crawled on, not replaced.
    const stillThere = before.rings[0]!.lines.slice(-1)[0]!.text;
    expect(after.rings[0]!.lines.map((l) => l.text)).toContain(stillThere);
    expect(problems).toEqual([]);
  });

  test("ticker: an operator's messages come only through admin, and come often", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await page.setViewportSize(viewportFor(FEED));
    const room = "e2etickerown";
    const url = `play/?app=ticker&kind=sphere&fit=4096x2048&frame=e2e-ticker&room=${room}&transport=local&bots=0&debug=1&res=0.5`;
    // A URL can't carry the text.
    await page.goto(`${url}&o.message1=Hello%20from%20a%20link`);
    await page.waitForFunction(() => window.__ticker?.state().ready === true);
    expect((await state(page)).operator).toBe(0);

    const own = "Welcome to the open day";
    await leaveOverride(page, room, "e2e-ticker", { message1: own, message3: "Talks at two" });
    await page.reload();
    await page.waitForFunction(() => window.__ticker?.state().ready === true);
    expect((await state(page)).operator).toBe(2);
    expect(await page.evaluate(() => window.__hypercube?.appStatus())).toMatchObject({
      messages: 2,
    });
    await skip(page, 300);
    const s = await state(page);
    for (const r of s.rings) {
      const texts = r.recent.map((l) => l.text);
      const mine = texts.filter((t) => t === own || t === "Talks at two").length;
      expect(mine, r.role).toBeGreaterThan(texts.length * 0.3);
      expect(texts).not.toContain("Hello from a link");
    }

    // The operator list: their messages and the clock, nothing curated.
    await leaveOverride(page, room, "e2e-ticker", { list: "operator", message2: own });
    await page.reload();
    await page.waitForFunction(() => window.__ticker?.state().ready === true);
    await skip(page, 400);
    const kinds = new Set((await state(page)).rings.flatMap((r) => r.recent.map((l) => l.kind)));
    expect([...kinds].sort()).toEqual(["date", "operator", "time"]);
    expect(problems).toEqual([]);
  });

  test("ticker: three rings in colour, and the globe preview", async ({ page }) => {
    const problems = await open(page, {
      "o.rings": "3",
      "o.style": "colour",
      "o.list": "welcome",
      look: "globe",
    });
    const s = await state(page);
    expect(s.rings.map((r) => r.role)).toEqual(["main", "lower", "pole"]);
    expect(s.style).toBe("colour");
    await skip(page, 120);
    const kinds = new Set((await state(page)).rings.flatMap((r) => r.recent.map((l) => l.kind)));
    expect([...kinds]).toEqual(["greet"]);
    await expect(page.locator(".hc-globe")).toBeVisible();
    await page.waitForTimeout(2000);
    const size = page.viewportSize()!;
    const ball = { x: size.width / 2 - 80, y: size.height / 2 - 160, width: 160, height: 160 };
    expect(await spread(page, ball)).toBeGreaterThan(BLANK_STDDEV);
    for (const view of ["under", "far"]) {
      await page.click(`button[data-globe=${view}]`);
      await page.waitForTimeout(800);
      const all = { x: 0, y: 0, width: size.width, height: size.height };
      expect(await spread(page, all), view).toBeGreaterThan(BLANK_STDDEV);
    }
    expect(problems).toEqual([]);
  });

  test("ticker: follows a resize", async ({ page }) => {
    const problems = await open(page);
    const before = await state(page);
    await page.setViewportSize({ width: 900, height: 450 });
    await expect.poll(async () => (await state(page)).feed.width).not.toBe(before.feed.width);
    await page.waitForTimeout(500);
    const after = await state(page);
    expect(after.rings).toHaveLength(2);
    expect(after.rings[0]!.lines.length).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });
});
