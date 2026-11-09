import { expect, type Page, test } from "@playwright/test";
import { waitForRunning, watchPage } from "../scripts/lib/play.mjs";

/**
 * Bluebottle Beach: touches on a panel, and a small bank in the simulator whose frames must end
 * up with the same beach however their digs cross.
 */

interface Cells {
  cols: number;
  rows: number;
  c0: number;
  dug: number[];
  flag: number[];
  found: number[];
  bottle: number[];
  count: number[];
}

interface Data {
  mode: string;
  key: string | null;
  cols: number;
  c0?: number;
  shared: boolean;
  events: number;
  hash: number;
  playing: boolean;
  cell?: number;
  top?: number;
}

declare global {
  interface Window {
    __bluebottle?: {
      cells(): Cells | null;
      layout(): { cell: number; top: number; left: number };
    };
  }
}

// ---- A panel on its own --------------------------------------------------------------------------

/** A pen touch on the page's stage at venue px. */
const pen = (page: Page, type: string, vx: number, vy: number, pointerId: number) =>
  page.evaluate(
    ({ type, vx, vy, pointerId }) => {
      const stage = document.querySelector<HTMLElement>(".hc-stage")!;
      const r = stage.getBoundingClientRect();
      const unit = window.__hypercube!.frame!.unit;
      const x = r.left + vx * unit * (r.width / stage.offsetWidth);
      const y = r.top + vy * unit * (r.height / stage.offsetHeight);
      const target = type === "pointerdown" ? document.elementFromPoint(x, y) : window;
      target?.dispatchEvent(
        new PointerEvent(type, {
          pointerId,
          clientX: x,
          clientY: y,
          bubbles: true,
          pointerType: "pen",
          buttons: type === "pointerup" ? 0 : 1,
        }),
      );
    },
    { type, vx, vy, pointerId },
  );

const cells = (page: Page) => page.evaluate(() => window.__bluebottle?.cells() ?? null);

test("bluebottle: a tap digs, a hold plants a flag and a drag digs nothing", async ({ page }) => {
  const problems = watchPage(page);
  await page.setViewportSize({ width: 405, height: 720 });
  await page.goto("play/?app=bluebottle&kind=panel&fit=1080x1920&bots=0&seed=e2e&debug=1");
  expect((await waitForRunning(page)).phase).toBe("running");
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            JSON.parse(
              document.querySelector<HTMLElement>("[data-bluebottle]")?.dataset.bluebottle ?? "{}",
            ).playing,
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
  // A visitor's touch on the sky stops the attract digger.
  await pen(page, "pointerdown", 600, 60, 9);
  await pen(page, "pointerup", 600, 60, 9);
  await page.waitForTimeout(1500);

  const { cell, top } = await page.evaluate(() => window.__bluebottle!.layout());
  const at = (c: Cells, i: number) => ({
    x: ((i % c.cols) - c.c0 + 0.5) * cell,
    y: top + (Math.floor(i / c.cols) + 0.5) * cell,
  });
  const nearDug = (c: Cells, i: number) => {
    const col = i % c.cols;
    const row = Math.floor(i / c.cols);
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const r = row + dr;
        const k = col + dc;
        if ((dr || dc) && r >= 0 && r < c.rows && k >= 0 && k < c.cols && c.dug[r * c.cols + k])
          return true;
      }
    return false;
  };

  let c = (await cells(page))!;
  const covered = (i: number) => !c.dug[i] && !c.flag[i] && !c.found[i];
  const safe = [...c.dug.keys()].filter((i) => covered(i) && !c.bottle[i] && c.count[i]! > 0);
  const drag = safe[0]!;
  const tap = safe[1]!;
  const bottle = [...c.dug.keys()].find((i) => covered(i) && c.bottle[i] && nearDug(c, i))!;
  expect(drag).toBeDefined();
  expect(bottle).toBeDefined();

  // A drag of more than 40 % of a cell digs nothing.
  const d = at(c, drag);
  await pen(page, "pointerdown", d.x, d.y, 1);
  await pen(page, "pointermove", d.x + cell * 0.3, d.y, 1);
  await pen(page, "pointermove", d.x + cell * 0.7, d.y, 1);
  await pen(page, "pointerup", d.x + cell * 0.7, d.y, 1);
  await page.waitForTimeout(300);
  expect((await cells(page))!.dug[drag]).toBe(0);

  // A tap digs.
  const p = at(c, tap);
  await pen(page, "pointerdown", p.x, p.y, 2);
  await page.waitForTimeout(80);
  await pen(page, "pointerup", p.x, p.y, 2);
  await expect.poll(async () => (await cells(page))!.dug[tap]).toBe(1);

  // A hold plants a flag; a tap on the flag lifts it and digs nothing.
  const b = at(c, bottle);
  await pen(page, "pointerdown", b.x, b.y, 3);
  await page.waitForTimeout(900);
  await pen(page, "pointerup", b.x, b.y, 3);
  await expect.poll(async () => (await cells(page))!.flag[bottle]).toBe(1);
  await pen(page, "pointerdown", b.x, b.y, 4);
  await page.waitForTimeout(80);
  await pen(page, "pointerup", b.x, b.y, 4);
  await expect.poll(async () => (await cells(page))!.flag[bottle]).toBe(0);
  c = (await cells(page))!;
  expect(c.found[bottle]).toBe(0);
  expect(c.dug[bottle]).toBe(0);
  expect(problems).toEqual([]);
});

// ---- A bank in the simulator -------------------------------------------------------------------

interface Snap {
  id: string;
  role: string | null;
  pos: number | null;
  phase: string | null;
  room: string | null;
  data: Data | null;
  errors: string[];
}

const snapshot = (page: Page): Promise<Snap[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".sim-frame[data-frame]")].map((el) => {
      const w = el.querySelector("iframe")?.contentWindow;
      const s = w?.__hypercube;
      let data: Data | null = null;
      try {
        const raw = w?.document.querySelector<HTMLElement>("[data-bluebottle]")?.dataset.bluebottle;
        data = raw ? (JSON.parse(raw) as Data) : null;
      } catch {
        data = null;
      }
      return {
        id: el.dataset.frame ?? "?",
        role: s?.setup?.role ?? null,
        pos: s?.setup?.pos ?? null,
        phase: s?.phase ?? null,
        room: s?.room ?? null,
        data,
        errors: s ? [...s.errors] : [],
      };
    }),
  );

/** Pen touches in several sim frames in the same task, so they happen at the same moment. */
const touchAll = (
  page: Page,
  type: string,
  points: { frame: string; vx: number; vy: number; id: number }[],
) =>
  page.evaluate(
    ({ type, points }) => {
      for (const { frame, vx, vy, id } of points) {
        const w = document.querySelector<HTMLIFrameElement>(
          `.sim-frame[data-frame="${frame}"] iframe`,
        )?.contentWindow as (Window & typeof globalThis) | null;
        if (!w?.__hypercube?.frame) throw new Error(`no frame ${frame}`);
        const stage = w.document.querySelector<HTMLElement>(".hc-stage")!;
        const r = stage.getBoundingClientRect();
        const unit = w.__hypercube.frame.unit;
        const x = r.left + vx * unit * (r.width / stage.offsetWidth);
        const y = r.top + vy * unit * (r.height / stage.offsetHeight);
        const target = type === "pointerdown" ? w.document.elementFromPoint(x, y) : w;
        target?.dispatchEvent(
          new w.PointerEvent(type, {
            pointerId: id,
            clientX: x,
            clientY: y,
            bubbles: true,
            pointerType: "pen",
            buttons: type === "pointerup" ? 0 : 1,
          }),
        );
      }
    },
    { type, points },
  );

const agreed = (frames: Snap[], n: number) => {
  const shared = frames.filter((f) => f.data?.mode === "shared" && f.data.key);
  if (shared.length !== n) return false;
  const k = shared[0]!.data!.key;
  const h = shared[0]!.data!.hash;
  return shared.every((f) => f.data!.key === k && f.data!.hash === h);
};

const blank = (page: Page, id: string) =>
  page.evaluate((id) => {
    const f = document.querySelector<HTMLIFrameElement>(`.sim-frame[data-frame="${id}"] iframe`)!;
    const was = f.src;
    f.src = "about:blank";
    return was;
  }, id);

const restore = (page: Page, id: string, src: string) =>
  page.evaluate(
    ({ id, src }) => {
      document.querySelector<HTMLIFrameElement>(`.sim-frame[data-frame="${id}"] iframe`)!.src = src;
    },
    { id, src },
  );

test.describe("bluebottle bank", () => {
  test.describe.configure({ timeout: 240_000 });

  test("two frames digging at once beside their shared edge end up with the same beach", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await page.goto("sim/?preset=bank&count=2&span=1&app=bluebottle&transport=local&res=0.25");
    await expect
      .poll(async () => agreed(await snapshot(page), 3), { timeout: 90_000, intervals: [500] })
      .toBe(true);
    await expect
      .poll(async () => (await snapshot(page)).every((f) => f.data?.playing), { timeout: 15_000 })
      .toBe(true);
    const frames = await snapshot(page);
    const left = frames.find((f) => f.role === "station" && f.pos === 0)!;
    const right = frames.find((f) => f.role === "station" && f.pos === 1)!;
    expect(right.data!.c0).toBe(8);
    const cell = left.data!.cell!;
    const top = left.data!.top!;
    const before = left.data!.events;
    // Column 7 of the left panel and column 0 of the right one, row by row, at the same moment.
    for (let row = 0; row < 11; row++) {
      const y = top + (row + 0.5) * cell;
      const pts = [
        { frame: left.id, vx: 7.5 * cell, vy: y, id: 20 + row },
        { frame: right.id, vx: 0.5 * cell, vy: y, id: 40 + row },
      ];
      await touchAll(page, "pointerdown", pts);
      await touchAll(page, "pointerup", pts);
      await page.waitForTimeout(120);
    }
    await expect
      .poll(async () => agreed(await snapshot(page), 3), { timeout: 15_000, intervals: [300] })
      .toBe(true);
    const after = await snapshot(page);
    expect(after[0]!.data!.events).toBeGreaterThan(before);
    for (const f of after) expect(f.errors, f.id).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("the bank carries on without its screen, and a frame left alone plays its own beach", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await page.goto("sim/?preset=bank&count=2&span=1&app=bluebottle&transport=local&res=0.25");
    await expect
      .poll(async () => agreed(await snapshot(page), 3), { timeout: 90_000, intervals: [500] })
      .toBe(true);
    const frames = await snapshot(page);
    const screen = frames.find((f) => f.role === "screen")!;
    const left = frames.find((f) => f.role === "station" && f.pos === 0)!;
    const right = frames.find((f) => f.role === "station" && f.pos === 1)!;
    const key = left.data!.key;

    const screenSrc = await blank(page, screen.id);
    await page.waitForTimeout(6000);
    const two = (await snapshot(page)).filter((f) => f.data);
    expect(two.length).toBe(2);
    for (const f of two) {
      expect(f.data!.mode, f.id).toBe("shared");
      expect(f.data!.key, f.id).toBe(key);
    }

    const rightSrc = await blank(page, right.id);
    await expect
      .poll(async () => (await snapshot(page)).find((f) => f.id === left.id)?.data?.mode, {
        timeout: 15_000,
        intervals: [250],
      })
      .toBe("local");
    const alone = (await snapshot(page)).find((f) => f.id === left.id)!.data!;
    expect(alone.cols).toBe(8);
    expect(alone.shared).toBe(false);

    await restore(page, right.id, rightSrc);
    await restore(page, screen.id, screenSrc);
    await expect
      .poll(async () => agreed(await snapshot(page), 3), { timeout: 120_000, intervals: [500] })
      .toBe(true);
    for (const f of await snapshot(page)) expect(f.errors, f.id).toEqual([]);
    expect(problems).toEqual([]);
  });
});
