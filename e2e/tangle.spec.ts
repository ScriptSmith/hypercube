import { expect, type Page, test } from "@playwright/test";
import { watchPage } from "../scripts/lib/play.mjs";

/**
 * Tangle in a small bank under a screen, in the simulator: someone joins at a panel and
 * steers their line on the screen; the screen goes away and the panel plays on by itself; the
 * screen comes back and the panel rejoins it.
 */

interface Snap {
  id: string;
  role: string | null;
  pos: number | null;
  phase: string | null;
  room: string | null;
  data: Record<string, unknown> | null;
  errors: string[];
}

const snapshot = (page: Page): Promise<Snap[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".sim-frame[data-frame]")].map((el) => {
      const w = el.querySelector("iframe")?.contentWindow;
      const s = w?.__hypercube;
      let data: Record<string, unknown> | null = null;
      try {
        const raw = w?.document.querySelector<HTMLElement>("[data-tangle]")?.dataset.tangle;
        data = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
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

/** A pen touch inside a sim frame, at venue px. */
const touch = (
  page: Page,
  frame: string,
  type: string,
  vx: number,
  vy: number,
  pointerId: number,
) =>
  page.evaluate(
    ({ frame, type, vx, vy, pointerId }) => {
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
          pointerId,
          clientX: x,
          clientY: y,
          bubbles: true,
          pointerType: "pen",
          buttons: type === "pointerup" ? 0 : 1,
        }),
      );
    },
    { frame, type, vx, vy, pointerId },
  );

type Runner = [number, string, number, number, number, number];

test("tangle: a panel steers the screen, plays alone without it and rejoins", async ({ page }) => {
  test.setTimeout(240_000);
  const problems = watchPage(page);
  await page.goto("sim/?preset=bank&count=4&span=1&app=tangle&transport=local&res=0.25");

  const frames = () => snapshot(page);
  await expect
    .poll(
      async () =>
        (await frames()).filter((f) => f.phase === "running" && f.room === "online").length,
      {
        timeout: 90_000,
      },
    )
    .toBe(5);
  const all = await frames();
  const screen = all.find((f) => f.role === "screen")!.id;
  const panel = all.find((f) => f.role === "station" && f.pos === 1)!.id;
  const data = async (id: string) => (await frames()).find((f) => f.id === id)?.data ?? null;
  // Station 0 of the frame at pos 1.
  const key = 4;
  const runner = async () =>
    ((await data(screen))?.runners as Runner[] | undefined)?.find((r) => r[0] === key) ?? null;

  // Join: the pads of a panel's station sit around y = 1650, left near x = 270, right near 810.
  await touch(page, panel, "pointerdown", 540, 1650, 3);
  await touch(page, panel, "pointerup", 540, 1650, 3);
  await expect
    .poll(
      async () =>
        ((await data(screen))?.seats as number[][] | undefined)?.some((s) => s[0] === key),
      {
        timeout: 10_000,
      },
    )
    .toBe(true);
  await expect
    .poll(async () => (await data(screen))?.phase === "play" && (await runner())?.[1] === "human", {
      timeout: 30_000,
    })
    .toBe(true);

  // Hold the right pad: the line turns clockwise on the screen.
  const before = (await runner())![3];
  await touch(page, panel, "pointerdown", 810, 1650, 7);
  await page.waitForTimeout(1200);
  const after = (await runner())![3];
  await touch(page, panel, "pointerup", 810, 1650, 7);
  expect(after - before, `heading ${before} -> ${after}`).toBeGreaterThan(0.2);

  // The screen goes: the panel plays on by itself within 3 s.
  const src = await page.evaluate((id) => {
    const f = document.querySelector<HTMLIFrameElement>(`.sim-frame[data-frame="${id}"] iframe`)!;
    const was = f.src;
    f.src = "about:blank";
    return was;
  }, screen);
  const gone = Date.now();
  await expect
    .poll(async () => (await data(panel))?.mode, { timeout: 10_000, intervals: [100] })
    .toBe("local");
  // Measured in the panel, from the screen's last message; the harness itself adds lag.
  const lostAfter = (await data(panel))?.lostAfter as number;
  expect(lostAfter).toBeLessThan(3000);
  expect(Date.now() - gone).toBeLessThan(8000);
  await expect.poll(async () => (await data(panel))?.phase, { timeout: 10_000 }).toBe("play");

  // The screen comes back: the panel rejoins and the player is in a screen round again.
  await page.evaluate(
    ({ id, src }) => {
      document.querySelector<HTMLIFrameElement>(`.sim-frame[data-frame="${id}"] iframe`)!.src = src;
    },
    { id: screen, src },
  );
  await expect.poll(async () => (await data(panel))?.mode, { timeout: 90_000 }).toBe("linked");
  await expect
    .poll(async () => (await data(screen))?.phase === "play" && (await runner())?.[1] === "human", {
      timeout: 60_000,
    })
    .toBe(true);

  const errors = (await frames()).flatMap((f) => f.errors.map((e) => `${f.id}: ${e}`));
  expect.soft(errors).toEqual([]);
  expect.soft(problems).toEqual([]);
});

/** [key, mode, alive, heading, x, y] */
type GridRunner = [number, string, number, number, number, number];

test("tangle: grid snake turns with a panel's direction pads and wraps on the screen", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const problems = watchPage(page);
  await page.goto(
    "sim/?preset=bank&count=4&span=1&app=tangle&variant=grid&transport=local&res=0.25",
  );
  const frames = () => snapshot(page);
  await expect
    .poll(
      async () =>
        (await frames()).filter((f) => f.phase === "running" && f.room === "online").length,
      { timeout: 90_000 },
    )
    .toBe(5);
  const all = await frames();
  const screen = all.find((f) => f.role === "screen")!.id;
  const panel = all.find((f) => f.role === "station" && f.pos === 1)!.id;
  const data = async (id: string) => (await frames()).find((f) => f.id === id)?.data ?? null;
  const key = 4;
  const runner = async () =>
    ((await data(screen))?.runners as GridRunner[] | undefined)?.find((r) => r[0] === key) ?? null;
  const heading = async () => (await runner())?.[3] ?? null;
  // The panel's direction pads (see layout.ts): up above a row of left, down and right.
  const pad = { up: [540, 1379], left: [190, 1725], down: [540, 1725] } as const;
  let id = 20;
  const tap = async ([x, y]: readonly [number, number]) => {
    const pointerId = id++;
    await touch(page, panel, "pointerdown", x, y, pointerId);
    await touch(page, panel, "pointerup", x, y, pointerId);
  };

  await tap([540, 1500]);
  await expect
    .poll(async () => (await data(screen))?.phase === "play" && (await runner())?.[1] === "human", {
      timeout: 40_000,
    })
    .toBe(true);
  const up = (3 * Math.PI) / 2;
  expect(await heading()).toBeCloseTo(up, 2);

  await tap(pad.left);
  await expect.poll(heading, { timeout: 5000 }).toBeCloseTo(Math.PI, 2);
  await tap(pad.up);
  await expect.poll(heading, { timeout: 5000 }).toBeCloseTo(up, 2);
  // Straight back down is ignored.
  await tap(pad.down);
  await page.waitForTimeout(800);
  expect(await heading()).toBeCloseTo(up, 2);

  // Heading up, the snake leaves by the top of the screen and comes back in at the bottom.
  let nearTop = false;
  let wrapped = false;
  const end = Date.now() + 90_000;
  while (!wrapped && Date.now() < end) {
    const r = await runner();
    if (!r || r[2] !== 1) nearTop = false;
    else if (r[5] < 600) nearTop = true;
    else if (nearTop && r[5] > 2400) wrapped = true;
    await page.waitForTimeout(100);
  }
  expect(wrapped, "the snake came back in at the bottom").toBe(true);

  const errors = (await frames()).flatMap((f) => f.errors.map((e) => `${f.id}: ${e}`));
  expect.soft(errors).toEqual([]);
  expect.soft(problems).toEqual([]);
});
