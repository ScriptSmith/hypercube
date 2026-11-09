/**
 * X-Ray Diffraction: the bank's screen and the wall's banner (the machine, its leader lines, the
 * chapter that drives it), the lone screen, and the frames carrying on without the screen.
 * Chapter behaviour has its own specs (xrd-waves, xrd-atoms and the reference chapters below).
 */
import { expect, type Page, test } from "@playwright/test";
import { playPath, viewportFor, waitForRunning, watchPage } from "../scripts/lib/play.mjs";

interface Leader {
  part: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  x0: number;
  x1: number;
  numbers: number[];
}

interface ScreenState {
  screen: true;
  showing: { kind: string; id?: string };
  slots: number;
  leaders: Leader[];
  look: { state: { omega: number; armTwoTheta: number }; active: Record<string, string> };
  heard: { slot: number; chapter: number }[];
  flashes: number;
  layout: { band: { x: number; y: number; width: number; height: number } };
}

interface FrameCard {
  chapter: string;
  chapters: string[];
  state: number[];
}

interface FrameState {
  screen: false;
  pos: number;
  count: number;
  hearsScreen: boolean;
  cards: FrameCard[];
  leaders: Leader[];
  banner: { x: number; y: number; width: number; height: number } | null;
}

/** Evaluate in one sim frame. */
const inFrame = <T, A>(page: Page, id: string, fn: (arg: A) => T, arg?: A): Promise<T> =>
  page.evaluate(
    ([frameId, src, a]) => {
      const w = document.querySelector<HTMLIFrameElement>(
        `.sim-frame[data-frame="${frameId}"] iframe`,
      )?.contentWindow as (Window & typeof globalThis) | null;
      if (!w) throw new Error(`no frame ${frameId}`);
      return new w.Function("arg", `return (${src})(arg)`)(a) as T;
    },
    [id, fn.toString(), arg] as const,
  );

const frames = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".sim-frame[data-frame]")]
      .filter((el) => el.dataset.frame !== "a-screen")
      .map((el) => {
        const w = el.querySelector("iframe")?.contentWindow as
          | (Window & { __xrd?: { state(): unknown } })
          | null;
        return {
          id: el.dataset.frame ?? "?",
          phase: (w as { __hypercube?: { phase: string } } | null)?.__hypercube?.phase ?? "loading",
          errors: [
            ...((w as { __hypercube?: { errors: string[] } } | null)?.__hypercube?.errors ?? []),
          ],
          st: (w?.__xrd?.state() as FrameState | undefined) ?? null,
        };
      }),
  );

const screenState = (page: Page) =>
  inFrame(page, "a-screen", () =>
    (window as unknown as { __xrd: { state(): unknown } }).__xrd.state(),
  ) as Promise<ScreenState>;

/**
 * Leader lines that miss their frames by more than 3 venue px: each part's bracket must span the
 * frames (or pair halves) showing its chapters, and its line must end at their middle on the
 * screen's bottom edge. Frame edges are bank fractions of the screen's width, as the screen spans
 * the bank exactly.
 */
const misplacedLeaders = (
  scr: ScreenState,
  fs: { st: FrameState | null }[],
  partChapters: Record<string, string[]>,
) => {
  const out: string[] = [];
  const W = scr.layout.band.width;
  const bottom = scr.layout.band.y + scr.layout.band.height;
  const perFrame = Math.max(1, ...fs.map((f) => f.st?.cards.length ?? 1));
  const count = Math.max(...fs.map((f) => (f.st?.pos ?? 0) + 1));
  const slots = count * perFrame;
  for (const l of scr.leaders) {
    const hits: number[] = [];
    for (const f of fs) {
      f.st?.cards.forEach((c, i) => {
        if (c.chapters.some((id) => partChapters[l.part]!.includes(id)))
          hits.push(f.st!.pos * perFrame + i);
      });
    }
    if (hits.length === 0) {
      out.push(`${l.part}: no frame shows its chapters`);
      continue;
    }
    const left = (Math.min(...hits) / slots) * W;
    const right = ((Math.max(...hits) + 1) / slots) * W;
    if (Math.abs(l.x0 - left) > 3 || Math.abs(l.x1 - right) > 3)
      out.push(
        `${l.part}: bracket ${l.x0.toFixed(1)}..${l.x1.toFixed(1)}, frames ${left.toFixed(1)}..${right.toFixed(1)}`,
      );
    if (Math.abs(l.to.x - (left + right) / 2) > 3 || Math.abs(l.to.y - bottom) > 3)
      out.push(`${l.part}: ends at ${l.to.x.toFixed(1)},${l.to.y.toFixed(1)}`);
  }
  return out;
};

/** Wait for `n` animation frames: on a fresh browser a page's frames can start late. */
const animationFrames = (page: Page, n: number) =>
  page.evaluate(
    (k) =>
      new Promise<void>((done) => {
        let left = k;
        const tick = () => (--left <= 0 ? done() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    n,
  );

const PART_CHAPTERS: Record<string, string[]> = {
  tube: ["spectrum"],
  sample: ["crystal", "bragg"],
  stage: ["goniometer"],
  detector: ["patterns", "inverse", "absences"],
  computer: ["synthesis"],
  fibre: ["helix"],
  cards: ["mystery"],
};

for (const preset of ["bank-panels", "bank-pairs"] as const) {
  test.describe(`xrd in ${preset}`, () => {
    test.describe.configure({ timeout: 300_000 });

    test(`xrd: leader lines meet their frames, the screen follows chapter 5's dials, and the frames carry on without it (${preset})`, async ({
      page,
    }) => {
      const problems = watchPage(page);
      await page.setViewportSize({ width: 1600, height: 1000 });
      await page.goto(`sim/?preset=${preset}&app=xrd&transport=local&bots=0&seed=e2e&res=0.5`);
      const expected = preset === "bank-panels" ? 6 : 3;
      await expect
        .poll(async () => (await frames(page)).filter((f) => f.st?.hearsScreen).length, {
          timeout: 150_000,
          intervals: [1000],
        })
        .toBe(expected);
      await expect
        .poll(async () => (await screenState(page)).leaders.length, { timeout: 30_000 })
        .toBe(7);
      const fs = await frames(page);
      const scr = await screenState(page);
      // Six panels or three pairs' six halves.
      expect(scr.slots).toBe(6);
      expect(misplacedLeaders(scr, fs, PART_CHAPTERS)).toEqual([]);

      // Quiet every frame, then turn chapter 5's wheel: the screen's machine follows its dials.
      for (const f of fs)
        await inFrame(page, f.id, () =>
          (window as unknown as { __xrd: { stopAttract(): void } }).__xrd.stopAttract(),
        );
      const gonio = fs.find((f) => f.st?.cards.some((c) => c.chapters.includes("goniometer")))!;
      const card = gonio.st!.cards.findIndex((c) => c.chapters.includes("goniometer"));
      await inFrame(
        page,
        gonio.id,
        (c: number) =>
          (window as unknown as { __xrd: { show(c: number, id: string): void } }).__xrd.show(
            c,
            "goniometer",
          ),
        card,
      );
      await inFrame(
        page,
        gonio.id,
        (c: number) =>
          (
            window as unknown as {
              __xrd: { gesture(c: number, id: string, to: number, ms: number): Promise<void> };
            }
          ).__xrd.gesture(c, "wheel", 33, 900),
        card,
      );
      const omega =
        (await frames(page)).find((f) => f.id === gonio.id)!.st!.cards[card]!.state[0]! / 10;
      expect(omega).toBeGreaterThan(20);
      await expect
        .poll(
          async () => {
            const s = await screenState(page);
            return (
              s.look.active.stage === "goniometer" && Math.abs(s.look.state.omega - omega) < 0.2
            );
          },
          { timeout: 5_000 },
        )
        .toBe(true);
      // The big picture keeps a chapter at least 8 s once picked (pick.ts), so allow for a demo's.
      await expect
        .poll(async () => (await screenState(page)).showing.id, { timeout: 12_000 })
        .toBe("goniometer");

      // The screen goes: the frames stop hearing it and carry on.
      await page.evaluate(() =>
        document.querySelector('.sim-frame[data-frame="a-screen"] iframe')?.remove(),
      );
      await expect
        .poll(async () => (await frames(page)).every((f) => f.st?.hearsScreen === false), {
          timeout: 20_000,
        })
        .toBe(true);
      const after = await frames(page);
      expect(after.every((f) => f.phase === "running")).toBe(true);
      expect(after.flatMap((f) => f.errors)).toEqual([]);
      expect(problems).toEqual([]);
    });
  });
}

test("xrd: a lone screen runs the machine by itself", async ({ page }) => {
  const problems = watchPage(page);
  const size = { width: 4000, height: 3600 };
  await page.setViewportSize(viewportFor(size));
  await page.goto(playPath({ app: "xrd", kind: "screen", size, bots: 0 }));
  const started = await waitForRunning(page);
  expect(started.phase).toBe("running");
  await animationFrames(page, 3);
  await expect
    .poll(
      async () =>
        page.evaluate(
          () => (window as unknown as { __xrd: { state(): ScreenState } }).__xrd.state().flashes,
        ),
      {
        timeout: 60_000,
        intervals: [1000],
      },
    )
    .toBeGreaterThan(0);
  const s = await page.evaluate(() =>
    (window as unknown as { __xrd: { state(): ScreenState } }).__xrd.state(),
  );
  expect(s.leaders).toEqual([]);
  expect(Object.keys(s.look.active)).toEqual([]);
  expect(problems).toEqual([]);
});

test("xrd: the wall's banner hangs each part over its column", async ({ page }) => {
  const problems = watchPage(page);
  const size = { width: 5760, height: 2160 };
  await page.setViewportSize(viewportFor(size));
  await page.goto(
    playPath({ app: "xrd", kind: "wall", size, bots: 0, params: { "o.set": "first" } }),
  );
  await waitForRunning(page);
  await animationFrames(page, 3);
  await page.waitForTimeout(1500);
  const s = await page.evaluate(() =>
    (window as unknown as { __xrd: { state(): FrameState } }).__xrd.state(),
  );
  const cols = s.cards.map((c) => c.chapter);
  expect(cols).toEqual(["spectrum", "interference", "crystal", "bragg", "goniometer", "patterns"]);
  const parts = s.leaders.map((l) => l.part);
  expect(parts).toEqual(["tube", "sample", "stage", "detector"]);
  for (const l of s.leaders) {
    const idx = cols.flatMap((c, i) => (PART_CHAPTERS[l.part]!.includes(c) ? [i] : []));
    const cw = size.width / 6;
    const left = Math.min(...idx) * cw;
    const right = (Math.max(...idx) + 1) * cw;
    expect(Math.abs(l.x0 - left), l.part).toBeLessThan(3);
    expect(Math.abs(l.x1 - right), l.part).toBeLessThan(3);
    expect(Math.abs(l.to.y - s.banner!.height), l.part).toBeLessThan(3);
  }
  expect(problems).toEqual([]);
});

test("xrd: a So line stays hidden until its chapter's key move", async ({ page }) => {
  const problems = watchPage(page);
  const size = { width: 1080, height: 1920 };
  await page.setViewportSize(viewportFor(size));
  await page.goto(
    playPath({ app: "xrd", kind: "panel", size, bots: 0, params: { "o.chapter": "bragg" } }),
  );
  await waitForRunning(page);
  await animationFrames(page, 3);
  type Card = { chapter: string; so: boolean; soShown: boolean };
  const cards = () =>
    page.evaluate(
      () => (window as unknown as { __xrd: { state(): { cards: Card[] } } }).__xrd.state().cards,
    );
  // Quiet the card back to its start: nothing earned, nothing shown.
  await page.evaluate(() =>
    (window as unknown as { __xrd: { resetCard(c: number): void } }).__xrd.resetCard(0),
  );
  await animationFrames(page, 2);
  let c = (await cards())[0]!;
  expect(c.so).toBe(false);
  expect(c.soShown).toBe(false);
  // The attract demo turns the wheel to a flash: from then on the line shows, never before.
  for (let i = 0; i < 40 && !c.so; i++) {
    if (i === 0)
      await page.evaluate(() =>
        (
          window as unknown as {
            __xrd: { gesture(c: number, id: string, to: number, ms: number): Promise<void> };
          }
        ).__xrd.gesture(0, "wheel", 19.23, 1200),
      );
    c = (await cards())[0]!;
    expect(c.soShown, `step ${i}`).toBe(c.so);
    await page.waitForTimeout(100);
  }
  expect(c.so).toBe(true);
  expect((await cards())[0]!.soShown).toBe(true);
  expect(problems).toEqual([]);
});

/** A panel on one chapter, quiet: no demo, nothing earned. */
const openPanel = async (page: Page, chapter: string, params: Record<string, string> = {}) => {
  const size = { width: 1080, height: 1920 };
  await page.setViewportSize(viewportFor(size));
  await page.goto(
    playPath({
      app: "xrd",
      kind: "panel",
      size,
      bots: 0,
      params: { "o.chapter": chapter, ...params },
    }),
  );
  await waitForRunning(page);
  await animationFrames(page, 3);
  await page.evaluate(() =>
    (window as unknown as { __xrd: { resetCard(c: number): void } }).__xrd.resetCard(0),
  );
  await animationFrames(page, 2);
};

type PanelCard = {
  chapter: string;
  so: boolean;
  soShown: boolean;
  maths: boolean;
  linked: string | null;
  state: number[];
  status: Record<string, string | number | boolean>;
};
const panelCard = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as { __xrd: { state(): { cards: PanelCard[]; maps: string[] } } }
      ).__xrd.state().cards[0]!,
  );
const gesture = (page: Page, control: string, to?: number, ms = 900) =>
  page.evaluate(
    ([c, t, m]) =>
      (
        window as unknown as {
          __xrd: { gesture(i: number, id: string, to?: number, ms?: number): Promise<void> };
        }
      ).__xrd.gesture(0, c as string, t as number | undefined, m as number),
    [control, to, ms] as const,
  );

test("xrd: Bragg's wheel turned to the angle flashes, and the Maths links its formula", async ({
  page,
}) => {
  const problems = watchPage(page);
  await openPanel(page, "bragg");
  const before = await panelCard(page);
  await gesture(page, "wheel", 19.23, 1200);
  await expect.poll(async () => (await panelCard(page)).so, { timeout: 5000 }).toBe(true);
  const after = await panelCard(page);
  expect(after.state[0]).not.toBe(before.state[0]);
  expect(after.status.flash).toBe(true);
  // The Maths fold opens; touching its d pulses the figure's gap between layers.
  await gesture(page, "maths");
  await expect.poll(async () => (await panelCard(page)).maths).toBe(true);
  const r = await page.evaluate(() =>
    (
      window as unknown as {
        __xrd: {
          part(
            c: number,
            p: string,
          ): { x: number; y: number; width: number; height: number } | null;
        };
      }
    ).__xrd.part(0, "d"),
  );
  expect(r).not.toBeNull();
  const unit = await page.evaluate(
    () => (window as unknown as { __xrd: { state(): { unit: number } } }).__xrd.state().unit,
  );
  const box = await page.locator(".hc-stage").boundingBox();
  const sx = box!.width / (1080 * unit);
  await page.mouse.click(
    box!.x + (r!.x + r!.width / 2) * unit * sx,
    box!.y + (r!.y + r!.height / 2) * unit * sx,
  );
  await expect.poll(async () => (await panelCard(page)).linked, { timeout: 3000 }).toBe("d");
  expect(problems).toEqual([]);
});

test("xrd: chapter 5's wheel brings a flash onto its detector", async ({ page }) => {
  const problems = watchPage(page);
  await openPanel(page, "goniometer");
  await gesture(page, "wheel", 40, 3000);
  await expect
    .poll(async () => Number((await panelCard(page)).status.flashes), { timeout: 8000 })
    .toBeGreaterThan(0);
  await expect.poll(async () => (await panelCard(page)).so, { timeout: 8000 }).toBe(true);
  expect(problems).toEqual([]);
});

test("xrd: crushing the crystal makes rings, and Lifelike loads a simulated map", async ({
  page,
}) => {
  const problems = watchPage(page);
  await openPanel(page, "patterns");
  expect((await panelCard(page)).status.look).toBe("spots");
  for (let i = 0; i < 3; i++) await gesture(page, "crush", undefined, 120);
  await expect.poll(async () => (await panelCard(page)).status.look).toBe("rings");
  await expect.poll(async () => (await panelCard(page)).so, { timeout: 5000 }).toBe(true);
  await gesture(page, "map", undefined, 120);
  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            (window as unknown as { __xrd: { state(): { maps: string[] } } }).__xrd.state().maps,
        ),
      {
        timeout: 15_000,
      },
    )
    .toContain("corundum");
  expect((await panelCard(page)).status.map).toBe(true);
  expect(problems).toEqual([]);
});
