import { expect, type Page, test } from "@playwright/test";
import { watchPage } from "../scripts/lib/play.mjs";
import { LIMIT } from "../src/apps/ballpit/config";

/**
 * Ball Pit Poll across frames in the simulator (local transport) and on its own: balls riding
 * from a panel's riser into the screen's pipes with extra delay on the votes, panels drawing
 * their own tubes when the screen goes, bots that press buttons but never vote, totals surviving
 * a reload, one ball per button at a time, and admin commands.
 */

interface Spot {
  answer: number;
  x: number;
  y: number;
  w: number;
  h: number;
}
interface BpState {
  mode: string;
  modeAt: number;
  questions: string[];
  counts: number[][];
  tally: number[][];
  blocks: { slot: number; cell: number; question: string; buttons: Spot[]; tubes: unknown[] }[];
  bodies: number;
  transit: number;
  ghosts: number;
  ghostsSent: number;
  pipes: number;
  inlets: number;
  rings: number;
  leader: string | null;
  screen: string | null;
  arrivals: { q: string; a: number; lead: number }[];
  custom: string | null;
  customWhy: string | null;
  wordless: boolean;
  pics: (string | null)[][];
  follows: string | null;
  texts: string[];
  labels: string[][];
  exits: { q: string; a: number; t: number }[];
  swapping: boolean;
  persist: boolean;
}

declare global {
  interface Window {
    __ballpit?: {
      state(): BpState;
      setLag(ms: number): void;
      command(name: string): void;
    };
  }
}

const SETTLE_MS = 90_000;

const openSim = async (page: Page, bots = 0) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(
    `sim/?preset=bank-panels&app=ballpit&transport=local&seed=e2e&debug=1&res=0.25&bots=${bots}`,
  );
  await page.waitForFunction(() => window.__hypercubeSim !== undefined);
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const frames = [...document.querySelectorAll<HTMLElement>(".sim-frame[data-frame]")];
          const states = frames.map((el) => el.querySelector("iframe")?.contentWindow?.__hypercube);
          const hubs = states.filter((s) => s?.net?.isHub);
          return (
            states.every((s) => s?.phase === "running" && s.room === "online") &&
            hubs.length === 1 &&
            hubs[0]?.net?.roster().length === frames.length
          );
        }),
      { timeout: SETTLE_MS, intervals: [500] },
    )
    .toBe(true);
};

/** Evaluate in one sim frame, or in the page itself when `id` is null. */
const inFrame = <T, A>(page: Page, id: string | null, fn: (arg: A) => T, arg?: A): Promise<T> =>
  page.evaluate(
    ([frameId, src, a]) => {
      const w = (
        frameId === null
          ? window
          : document.querySelector<HTMLIFrameElement>(`.sim-frame[data-frame="${frameId}"] iframe`)
              ?.contentWindow
      ) as (Window & typeof globalThis) | null;
      if (!w) throw new Error(`no frame ${frameId}`);
      return new w.Function("arg", `return (${src})(arg)`)(a) as T;
    },
    [id, fn.toString(), arg] as const,
  );

const state = (page: Page, id: string | null) => inFrame(page, id, () => window.__ballpit!.state());

/** A finger tapping (x, y) venue px on a frame, as real pointer events. */
const tap = (page: Page, id: string | null, x: number, y: number) =>
  inFrame(
    page,
    id,
    async ({ x: vx, y: vy }) => {
      const stage = document.querySelector<HTMLElement>(".hc-stage")!;
      const r = stage.getBoundingClientRect();
      const scale = (window.__hypercube?.frame?.unit ?? 1) * (r.width / stage.offsetWidth);
      const c = { clientX: r.left + vx * scale, clientY: r.top + vy * scale };
      const pointerId = 7000 + Math.floor(Math.random() * 1000);
      const fire = (type: string) =>
        (document.elementFromPoint(c.clientX, c.clientY) ?? stage).dispatchEvent(
          new PointerEvent(type, {
            ...c,
            pointerId,
            pointerType: "touch",
            bubbles: true,
            isPrimary: true,
          }),
        );
      fire("pointerdown");
      await new Promise((res) => setTimeout(res, 60));
      fire("pointerup");
    },
    { x, y },
  );

/** Several fingers pressing (x, y) venue px on a frame at the same moment, then lifting. */
const press = (page: Page, id: string | null, points: number[][]) =>
  inFrame(
    page,
    id,
    async (pts) => {
      const stage = document.querySelector<HTMLElement>(".hc-stage")!;
      const r = stage.getBoundingClientRect();
      const scale = (window.__hypercube?.frame?.unit ?? 1) * (r.width / stage.offsetWidth);
      const fingers = pts.map(([vx, vy], i) => ({
        c: { clientX: r.left + vx! * scale, clientY: r.top + vy! * scale },
        pointerId: 8000 + i,
      }));
      const fire = (type: string) => {
        for (const f of fingers)
          (document.elementFromPoint(f.c.clientX, f.c.clientY) ?? stage).dispatchEvent(
            new PointerEvent(type, {
              ...f.c,
              pointerId: f.pointerId,
              pointerType: "touch",
              bubbles: true,
              isPrimary: f.pointerId === 8000,
            }),
          );
      };
      fire("pointerdown");
      await new Promise((res) => setTimeout(res, 60));
      fire("pointerup");
    },
    points,
  );

/** Corners of a button, to spread taps over it. */
const CORNERS = [
  [0.12, 0.15],
  [0.88, 0.85],
  [0.88, 0.15],
  [0.12, 0.85],
] as const;

/** Tap answer `a` of slot 0 near corner `k` of its button. */
const tapAnswer = async (page: Page, id: string | null, a: number, k = 0) => {
  const s = await state(page, id);
  const b = s.blocks.find((x) => x.slot === 0)!.buttons.find((x) => x.answer === a)!;
  const [fx, fy] = CORNERS[k % CORNERS.length]!;
  await tap(page, id, b.x + b.w * fx, b.y + b.h * fy);
};

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

/** The operator's own question, as admin leaves it: answer 2 left empty, two without pictures. */
const OWN = {
  question: "custom",
  ask: "Which snack is best?",
  a1: "Apples",
  p1: "apple",
  a3: "Popcorn",
  a4: "Carrots",
};

/**
 * Leave an admin override for a frame, as a signed `set` command does, so the frame mounts with
 * these options when it next loads in this tab. Text options only ever arrive this way.
 */
const leaveOverride = (page: Page, room: string, frame: string, options: Record<string, unknown>) =>
  page.evaluate(([key, opts]) => sessionStorage.setItem(key, JSON.stringify({ options: opts })), [
    `hc:override:${room}:${frame}`,
    options,
  ] as const);

test.describe("ballpit in the simulator", () => {
  test.describe.configure({ timeout: 180_000 });

  test("ballpit: a vote flies from a panel into the screen, with 300 ms of extra delay", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await openSim(page);
    const panels = Array.from({ length: 6 }, (_, i) => `a-p${i + 1}`);
    for (const id of panels)
      await inFrame(page, id, (ms: number) => window.__ballpit!.setLag(ms), 300);
    await expect
      .poll(async () => (await state(page, "a-p4")).mode, { timeout: 20_000 })
      .toBe("feeder");
    await expect.poll(async () => (await state(page, "a-p4")).swapping).toBe(false);
    // Under a screen a panel is only buttons; the screen has a riser from every panel.
    const panel = await state(page, "a-p4");
    expect(panel.blocks.every((b) => b.tubes.length === 0)).toBe(true);
    expect((await state(page, "a-screen")).inlets).toBe(6);

    const before = await state(page, "a-screen");
    const q = before.questions[0]!;
    await tapAnswer(page, "a-p4", 1);
    // The ball rides the panel's riser off its top edge...
    expect((await state(page, "a-p4")).transit).toBeGreaterThan(0);
    let arrival: BpState["arrivals"][number] | undefined;
    await expect
      .poll(async () => {
        const s = await state(page, "a-screen");
        arrival = s.arrivals.find((x) => x.q === q && x.a === 1);
        return arrival !== undefined;
      })
      .toBe(true);
    test.info().annotations.push({
      type: "arrival",
      description: `the vote reached the screen ${arrival!.lead.toFixed(0)} ms before its ball was due at the screen's edge`,
    });
    // The ball leaves the panel 560 ms after the touch; with 300 ms added the vote still gets there
    // first, so the screen's ball starts at the edge rather than partway along. Soft: the sim runs
    // every frame on one thread and its timers run late under load.
    expect.soft(arrival!.lead, "vote arrived before the ball was due").toBeGreaterThan(0);
    // ...and on through the screen's pipes into its tube.
    await expect.poll(async () => (await state(page, "a-screen")).bodies).toBeGreaterThan(0);

    // Every frame counts it, as a real vote.
    for (const id of ["a-screen", "a-p1", "a-p6"]) {
      await expect
        .poll(async () => (await state(page, id)).tally[0]![1])
        .toBe(before.tally[0]![1]! + 1);
    }
    expect.soft(problems).toEqual([]);
  });

  test("ballpit: panels draw their own tubes when the screen goes, and keep sharing votes", async ({
    page,
  }) => {
    await openSim(page);
    await expect
      .poll(async () => (await state(page, "a-p1")).mode, { timeout: 20_000 })
      .toBe("feeder");
    const removed = await page.evaluate(() => {
      const t = Date.now();
      document.querySelector('.sim-frame[data-frame="a-screen"] iframe')?.remove();
      return t;
    });
    const watch = ["a-p1", "a-p5", "a-p6"];
    for (const id of watch) {
      await expect
        .poll(async () => (await state(page, id)).mode, { timeout: 15_000 })
        .toBe("local");
    }
    const took = await Promise.all(
      watch.map(async (id) => (await state(page, id)).modeAt - removed),
    );
    test.info().annotations.push({ type: "fallback", description: `${took.join(", ")} ms` });
    for (const ms of took) expect(ms).toBeLessThan(6000);
    for (const id of watch) {
      await expect
        .poll(async () => (await state(page, id)).blocks.every((b) => b.tubes.length > 0))
        .toBe(true);
    }
    await expect
      .poll(async () => (await state(page, "a-p5")).leader, { timeout: 15_000 })
      .toBe("a-p1");

    // A vote on one panel drops into the tubes of the others: the bank shares one chart.
    await expect.poll(async () => (await state(page, "a-p5")).swapping).toBe(false);
    const before = await state(page, "a-p6");
    await tapAnswer(page, "a-p5", 0);
    await tapAnswer(page, "a-p5", 1);
    for (const id of ["a-p1", "a-p6"]) {
      await expect
        .poll(async () => sum((await state(page, id)).tally[0]!))
        .toBe(sum(before.tally[0]!) + 2);
    }
    await expect.poll(async () => (await state(page, "a-p6")).bodies).toBeGreaterThan(0);
  });
});

test.describe("ballpit own question in the simulator", () => {
  test.describe.configure({ timeout: 180_000 });

  test("ballpit: panels follow the screen's own question by id, and its words never travel", async ({
    page,
  }) => {
    await openSim(page);
    await expect
      .poll(async () => (await state(page, "a-p3")).mode, { timeout: 20_000 })
      .toBe("feeder");
    const { room, frame } = await inFrame(page, "a-screen", () => ({
      room: new URLSearchParams(location.search).get("room") ?? "",
      frame: window.__hypercube?.identity?.frame ?? "",
    }));
    expect(room).not.toBe("");
    // Only the screen is given the question, as admin would set it on that one frame.
    await leaveOverride(page, room, frame, OWN);
    await page.evaluate(() =>
      document
        .querySelector<HTMLIFrameElement>('.sim-frame[data-frame="a-screen"] iframe')
        ?.contentWindow?.location.reload(),
    );
    let own = "";
    await expect
      .poll(
        async () => {
          own = (await state(page, "a-screen").catch(() => null))?.custom ?? "";
          return own;
        },
        { timeout: 30_000 },
      )
      .toMatch(/^custom-/);
    const screen = await state(page, "a-screen");
    expect(screen.texts).toEqual(["Which snack is best?"]);
    expect(screen.labels[0]).toEqual(["Apples", "Popcorn", "Carrots"]);

    // Watch everything every frame sends from now on, for the question's words.
    const words = [OWN.ask, OWN.a1, OWN.a3, OWN.a4];
    const ids = ["a-screen", ...Array.from({ length: 6 }, (_, i) => `a-p${i + 1}`)];
    for (const id of ids) {
      await inFrame(
        page,
        id,
        (words: string[]) => {
          const w = window as unknown as {
            __wire?: { sent: number; found: string[]; ids: number };
          };
          if (w.__wire) return;
          const wire = { sent: 0, found: [] as string[], ids: 0 };
          w.__wire = wire;
          const post = BroadcastChannel.prototype.postMessage;
          BroadcastChannel.prototype.postMessage = function (this: BroadcastChannel, m: unknown) {
            const text = JSON.stringify(m) ?? "";
            wire.sent++;
            if (text.includes("custom-")) wire.ids++;
            for (const word of words)
              if (text.includes(word) && wire.found.length < 8) wire.found.push(word);
            return post.call(this, m);
          };
        },
        words,
      );
    }

    // The panels follow it by id, drawing pictures and colours but no words.
    for (const id of ["a-p1", "a-p3", "a-p6"]) {
      await expect
        .poll(async () => (await state(page, id)).questions[0], { timeout: 30_000 })
        .toBe(own);
      const s = await state(page, id);
      expect(s.custom, id).toBeNull();
      expect(s.follows, id).toBe(frame);
      expect(s.wordless, id).toBe(true);
      expect(s.texts, id).toEqual([""]);
      expect(s.labels[0], id).toEqual(["", "", ""]);
      expect(s.pics[0], id).toEqual(["apple", null, null]);
      const shown = await inFrame(page, id, () => ({
        text: [...document.querySelectorAll(".bp-btn")].map((b) => b.textContent).join(""),
        pictures: document.querySelectorAll(".bp-btn .bp-pic").length,
        buttons: document.querySelectorAll(".bp-btn").length,
        status: window.__hypercube?.appStatus()?.custom,
      }));
      expect(shown, id).toEqual({
        text: "",
        pictures: 1,
        buttons: 3,
        status: "custom text missing here: set the question for the whole group in admin",
      });
    }
    // A panel's vote lands on the screen's chart for that question.
    await expect.poll(async () => (await state(page, "a-p3")).swapping).toBe(false);
    await expect.poll(async () => (await state(page, "a-p3")).mode).toBe("feeder");
    await tapAnswer(page, "a-p3", 2);
    await expect.poll(async () => (await state(page, "a-screen")).tally[0]).toEqual([0, 0, 1]);
    // Several announcements later, nothing any frame sent held the words, though the id went out.
    await page.waitForTimeout(6000);
    const wire = await Promise.all(
      ids.map((id) =>
        inFrame(
          page,
          id,
          () =>
            (window as unknown as { __wire: { sent: number; found: string[]; ids: number } })
              .__wire,
        ),
      ),
    );
    expect(wire.reduce((n, w) => n + w.sent, 0)).toBeGreaterThan(50);
    expect(wire.reduce((n, w) => n + w.ids, 0)).toBeGreaterThan(5);
    expect(wire.flatMap((w) => w.found)).toEqual([]);
  });
});

test.describe("ballpit bots in the simulator", () => {
  test.describe.configure({ timeout: 180_000 });

  test("ballpit: bots on a bank send no votes to the screen", async ({ page }) => {
    await openSim(page, 2);
    await expect
      .poll(async () => (await state(page, "a-p3")).ghostsSent, { timeout: 30_000 })
      .toBeGreaterThan(2);
    await page.waitForTimeout(3000);
    for (const id of ["a-screen", "a-p1", "a-p3", "a-p6"]) {
      const s = await state(page, id);
      expect(sum(s.tally[0]!), id).toBe(0);
      expect(sum(s.counts[0]!), id).toBe(0);
    }
    expect((await state(page, "a-screen")).arrivals).toEqual([]);
  });
});

test.describe("ballpit on its own", () => {
  test("ballpit: today's totals survive a reload", async ({ page }) => {
    const problems = watchPage(page);
    await page.setViewportSize({ width: 1280, height: 480 });
    const url =
      "play/?app=ballpit&kind=wall&fit=5760x2160&frame=e2e-wall&bots=0&debug=1&o.question=pet";
    await page.goto(url);
    await page.waitForFunction(() => window.__ballpit !== undefined);
    expect((await state(page, null)).persist).toBe(true);
    await inFrame(page, null, () => window.__ballpit!.command("clear"));
    for (let k = 0; k < 3; k++) {
      if (k > 0) await page.waitForTimeout(LIMIT.buttonMs + 100);
      await tapAnswer(page, null, 2, k);
    }
    await expect.poll(async () => (await state(page, null)).tally[0]).toEqual([0, 0, 3, 0]);
    // The app saves every couple of seconds and when the page goes away.
    await page.waitForTimeout(2500);
    await page.reload();
    await page.waitForFunction(() => window.__ballpit !== undefined);
    expect((await state(page, null)).tally[0]).toEqual([0, 0, 3, 0]);
    await expect.poll(async () => (await state(page, null)).counts[0]).toEqual([0, 0, 3, 0]);
    expect.soft(problems).toEqual([]);
  });

  test("ballpit: a whole hand of fingers gets one ball and wait rings", async ({ page }) => {
    await page.setViewportSize({ width: 540, height: 960 });
    await page.goto("play/?app=ballpit&kind=panel&fit=1080x1920&bots=0&debug=1&o.question=float");
    await page.waitForFunction(() => window.__ballpit !== undefined);
    const s = await state(page, null);
    const b = s.blocks[0]!.buttons[0]!;
    // Five fingers spread across the button land together. One ball rides the pipe up.
    await press(
      page,
      null,
      [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => [b.x + b.w * f, b.y + b.h * f]),
    );
    const after = await state(page, null);
    expect(after.tally[0]![0]).toBe(1);
    expect(after.transit).toBeGreaterThan(0);
    expect(after.rings).toBeGreaterThan(0);
    // Another button isn't held up, and once the wait is over the first takes a ball again.
    const other = s.blocks[0]!.buttons[1]!;
    await tap(page, null, other.x + other.w / 2, other.y + other.h / 2);
    expect((await state(page, null)).tally[0]![1]).toBe(1);
    await page.waitForTimeout(LIMIT.buttonMs + 100);
    await tap(page, null, b.x + b.w * 0.85, b.y + b.h * 0.85);
    expect((await state(page, null)).tally[0]![0]).toBe(2);
    await expect.poll(async () => (await state(page, null)).bodies).toBeGreaterThanOrEqual(3);
  });

  test("ballpit: bots press buttons but never vote or save anything", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 480 });
    await page.goto(
      "play/?app=ballpit&kind=wall&fit=5760x2160&frame=e2e-bots&bots=3&debug=1&o.question=season",
    );
    await page.waitForFunction(() => window.__ballpit !== undefined);
    expect((await state(page, null)).persist).toBe(true);
    await expect
      .poll(async () => (await state(page, null)).ghostsSent, { timeout: 15_000 })
      .toBeGreaterThan(5);
    await page.waitForTimeout(2500);
    const s = await state(page, null);
    expect(s.tally[0]).toEqual([0, 0, 0, 0]);
    expect(s.counts[0]).toEqual([0, 0, 0, 0]);
    // Their faded balls puff out of the outlets and never land.
    expect(s.bodies).toBe(0);
    const stored = await page.evaluate(() =>
      Object.keys(localStorage).filter(
        (k) => k.startsWith("hc.ballpit.") && k.includes("e2e-bots"),
      ),
    );
    expect(stored).toEqual([]);
    const status = await page.evaluate(() => window.__hypercube?.appStatus());
    expect(status).toMatchObject({ votes: 0 });
  });

  test("ballpit: an operator's own question set through admin shows, and counts by its wording", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await page.setViewportSize({ width: 1280, height: 480 });
    const room = "e2eownquestion";
    const url = `play/?app=ballpit&kind=wall&fit=5760x2160&frame=e2e-own&room=${room}&transport=local&bots=0&debug=1&o.question=pet`;
    await page.goto(url);
    await page.waitForFunction(() => window.__ballpit !== undefined);
    expect((await state(page, null)).custom).toBeNull();
    // A URL can't carry the text, even when it asks for a custom question.
    await page.goto(`${url}&o.question=custom&o.ask=Hello`);
    await page.waitForFunction(() => window.__ballpit !== undefined);
    expect((await state(page, null)).custom).toBeNull();

    await leaveOverride(page, room, "e2e-own", OWN);
    await page.reload();
    await page.waitForFunction(() => window.__ballpit !== undefined);
    await expect.poll(async () => (await state(page, null)).swapping).toBe(false);
    const s = await state(page, null);
    expect(s.custom).toMatch(/^custom-/);
    expect(s.questions).toEqual([s.custom]);
    expect(s.texts).toEqual(["Which snack is best?"]);
    expect(s.labels).toEqual([["Apples", "Popcorn", "Carrots"]]);
    await expect(page.locator(".bp-text")).toHaveText("Which snack is best?");
    const buttons = page.locator(".bp-btn");
    await expect(buttons).toHaveCount(3);
    // Apples has its picture; the other two show their words.
    await expect(buttons.nth(0).locator("svg")).toHaveCount(2);
    await expect(buttons.nth(1).locator(".bp-words")).toHaveText("Popcorn");
    await expect(buttons.nth(2).locator(".bp-words")).toHaveText("Carrots");
    expect(await page.evaluate(() => window.__hypercube?.appStatus())).toMatchObject({
      custom: "on",
    });

    // A vote is kept under the question's wording, across a reload...
    await tapAnswer(page, null, 1);
    await expect.poll(async () => (await state(page, null)).tally[0]).toEqual([0, 1, 0]);
    await page.waitForTimeout(2500);
    await page.reload();
    await page.waitForFunction(() => window.__ballpit !== undefined);
    await expect.poll(async () => (await state(page, null)).tally[0]).toEqual([0, 1, 0]);
    // ...and an edited question starts afresh.
    await leaveOverride(page, room, "e2e-own", { ...OWN, a4: "Carrot sticks" });
    await page.reload();
    await page.waitForFunction(() => window.__ballpit !== undefined);
    const edited = await state(page, null);
    expect(edited.custom).toMatch(/^custom-/);
    expect(edited.custom).not.toBe(s.custom);
    expect(edited.tally[0]).toEqual([0, 0, 0]);

    // Without its text the question is incomplete: the rotation shows, and admin is told why.
    await leaveOverride(page, room, "e2e-own", { ...OWN, ask: "" });
    await page.reload();
    await page.waitForFunction(() => window.__ballpit !== undefined);
    const gap = await state(page, null);
    expect(gap.custom).toBeNull();
    expect(gap.customWhy).toBe("no question text");
    expect(gap.questions[0]).not.toMatch(/^custom-/);
    expect(await page.evaluate(() => window.__hypercube?.appStatus())).toMatchObject({
      custom: "incomplete (no question text), showing the rotation",
    });
    expect.soft(problems).toEqual([]);
  });

  test("ballpit: admin moves to the next question and clears today's totals", async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 360 });
    await page.goto("play/?app=ballpit&kind=kiosk&fit=1920x1080&bots=0&debug=1&o.set=science");
    await page.waitForFunction(() => window.__ballpit !== undefined);
    const first = (await state(page, null)).questions[0];
    await tapAnswer(page, null, 0);
    await inFrame(page, null, () => window.__ballpit!.command("next"));
    await expect.poll(async () => (await state(page, null)).questions[0]).not.toBe(first);
    await expect.poll(async () => (await state(page, null)).swapping).toBe(false);
    await tapAnswer(page, null, 1);
    await expect.poll(async () => sum((await state(page, null)).tally[0]!)).toBe(1);
    await inFrame(page, null, () => window.__ballpit!.command("clear"));
    await expect.poll(async () => sum((await state(page, null)).tally[0]!)).toBe(0);
    const status = await page.evaluate(() => window.__hypercube?.appStatus());
    expect(status).toMatchObject({ votes: 0, mode: "solo" });
  });
});
