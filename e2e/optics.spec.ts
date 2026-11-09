import { expect, type Page, test } from "@playwright/test";
import { waitForRunning, watchPage } from "../scripts/lib/play.mjs";

/**
 * Light Bench: touches on a panel (drag a piece out of its tray, tap it, turn it by its ring,
 * solve the puzzle and see the next one come), and a small bank in the simulator where light
 * crosses from one panel to the next and the guide beam comes back when the neighbour goes.
 */

interface Item {
  kind: string;
  place: { socket: number | null; turn: number };
  at: { x: number; y: number } | null;
}

interface BenchDebug {
  sockets: { x: number; y: number }[];
  sizes: { piece: number; ring: number; knob: number };
  items: Item[];
  solution: { socket: number; turn: number }[];
  crystals: unknown[];
  glows: number[];
  segs: number;
  exits: { edge: number; x: number; y: number }[];
}

interface BenchState {
  serial: number;
  level: string;
  lit: number;
  crystals: number;
  solved: boolean;
  placed: number;
  segs: number;
}

interface BankState {
  inLeft: number;
  guides: number;
  exitsRight: number;
  left: string | null;
}

declare global {
  interface Window {
    __optics?: { bench(i?: number): BenchDebug | null; solve(i?: number): void };
  }
}

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

let nextId = 10;
const tap = async (page: Page, x: number, y: number) => {
  const id = nextId++;
  await pen(page, "pointerdown", x, y, id);
  await page.waitForTimeout(60);
  await pen(page, "pointerup", x, y, id);
  await page.waitForTimeout(60);
};

const drag = async (page: Page, pts: { x: number; y: number }[]) => {
  const id = nextId++;
  await pen(page, "pointerdown", pts[0]!.x, pts[0]!.y, id);
  for (const p of pts.slice(1)) {
    await page.waitForTimeout(30);
    await pen(page, "pointermove", p.x, p.y, id);
  }
  const last = pts[pts.length - 1]!;
  await pen(page, "pointerup", last.x, last.y, id);
  await page.waitForTimeout(80);
};

const line = (a: { x: number; y: number }, b: { x: number; y: number }, n = 8) =>
  Array.from({ length: n + 1 }, (_, i) => ({
    x: a.x + ((b.x - a.x) * i) / n,
    y: a.y + ((b.y - a.y) * i) / n,
  }));

const bench = (page: Page) => page.evaluate(() => window.__optics!.bench(0)!);
const state = (page: Page) =>
  page.evaluate(
    () =>
      (
        JSON.parse(
          document.querySelector<HTMLElement>("[data-optics]")?.dataset.optics ?? "{}",
        ) as {
          benches?: BenchState[];
        }
      ).benches?.[0] ?? null,
  );

const symmetry = (kind: string) => (kind === "mirror" ? 24 : kind === "prism" ? 8 : 12);

test("optics: pieces move from the tray, tap and ring turns steer the beam, a solved puzzle advances", async ({
  page,
}) => {
  const problems = watchPage(page);
  await page.setViewportSize({ width: 405, height: 720 });
  await page.goto("play/?app=optics&kind=panel&fit=1080x1920&bots=0&seed=e2e&debug=1&idle=600");
  expect((await waitForRunning(page)).phase).toBe("running");
  await expect.poll(() => state(page)).not.toBeNull();
  // A visitor's touch on the bench stops the attract hand.
  await tap(page, 540, 60);
  await page.waitForTimeout(1500);

  let b = await bench(page);
  const s0 = (await state(page))!;
  expect(s0.level).toBe("m1");
  expect(s0.solved).toBe(false);
  const target = b.solution[0]!;
  const socket = b.sockets[target.socket]!;
  // Into its solution socket, from the tray or wherever it is.
  const it = b.items[0]!;
  if (it.place.socket !== target.socket) {
    await drag(page, line(it.at!, socket, 12));
    b = await bench(page);
    expect(b.items[0]!.place.socket).toBe(target.socket);
  }

  // A tap turns it one detent clockwise, and the light changes.
  const before = b.items[0]!.place.turn;
  const exitsBefore = JSON.stringify(b.exits);
  await tap(page, socket.x + 30, socket.y + 20);
  b = await bench(page);
  expect(b.items[0]!.place.turn).toBe((before + 1) % 24);

  // Dragging round the ring turns it further: a quarter turn is six detents.
  const R = b.sizes.ring;
  const turned = b.items[0]!.place.turn;
  const free = [0, 90, 180, 270].map((d) => (d * Math.PI) / 180);
  const a0 = free.find((a) => {
    const x = socket.x + Math.cos(a) * R;
    const y = socket.y + Math.sin(a) * R;
    return x > 40 && x < 1040 && y > 400 && y < 1680;
  })!;
  const arc = Array.from({ length: 13 }, (_, k) => {
    const a = a0 + ((Math.PI / 2) * k) / 12;
    return { x: socket.x + Math.cos(a) * R, y: socket.y + Math.sin(a) * R };
  });
  await drag(page, arc);
  b = await bench(page);
  expect(b.items[0]!.place.turn).toBe((turned + 6) % 24);
  expect(JSON.stringify(b.exits)).not.toBe(exitsBefore);

  // Tap round to the solution: every crystal lights and the next puzzle comes.
  const sym = symmetry(b.items[0]!.kind);
  for (let k = 0; k < 24; k++) {
    const t = (await bench(page)).items[0]!.place.turn;
    if ((((t - target.turn) % sym) + sym) % sym === 0) break;
    await tap(page, socket.x + 30, socket.y + 20);
  }
  await expect.poll(async () => (await state(page))!.solved).toBe(true);
  await expect.poll(async () => (await state(page))!.serial, { timeout: 8000 }).toBe(1);
  const s1 = (await state(page))!;
  expect(s1.level).toBe("m2");
  expect(s1.solved).toBe(false);
  expect(problems).toEqual([]);
});

test("optics: the hold control restores a puzzle's start", async ({ page }) => {
  const problems = watchPage(page);
  await page.setViewportSize({ width: 405, height: 720 });
  await page.goto("play/?app=optics&kind=panel&fit=1080x1920&bots=0&seed=e2e&debug=1&idle=600");
  expect((await waitForRunning(page)).phase).toBe("running");
  await expect.poll(() => state(page)).not.toBeNull();
  await tap(page, 540, 60);
  await page.waitForTimeout(1200);
  let b = await bench(page);
  const start = JSON.stringify(b.items.map((i) => i.place));
  await page.evaluate(() => window.__optics!.solve(0));
  // Solved by admin: wait for the next puzzle, then move a piece and reset.
  await expect.poll(async () => (await state(page))!.serial, { timeout: 8000 }).toBe(1);
  await tap(page, 540, 60);
  b = await bench(page);
  const fresh = JSON.stringify(b.items.map((i) => i.place));
  const first = b.items[0]!;
  if (first.place.socket === null) {
    await drag(page, line(first.at!, b.sockets[b.solution[0]!.socket]!, 10));
  } else {
    await tap(page, first.at!.x + 30, first.at!.y + 20);
  }
  expect(JSON.stringify((await bench(page)).items.map((i) => i.place))).not.toBe(fresh);
  const id = nextId++;
  await pen(page, "pointerdown", 95, 79, id);
  await page.waitForTimeout(1900);
  await pen(page, "pointerup", 95, 79, id);
  await expect
    .poll(async () => JSON.stringify((await bench(page)).items.map((i) => i.place)))
    .toBe(fresh);
  expect(fresh).not.toBe(start);
  expect(problems).toEqual([]);
});

// ---- A bank in the simulator -------------------------------------------------------------------

interface Snap {
  id: string;
  role: string | null;
  pos: number | null;
  bank: BankState | null;
  screen: { crystals: number; heard: number } | null;
  errors: string[];
}

const snapshot = (page: Page): Promise<Snap[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".sim-frame[data-frame]")].map((el) => {
      const w = el.querySelector("iframe")?.contentWindow;
      const s = w?.__hypercube;
      let bank = null;
      let screen = null;
      try {
        const raw = w?.document.querySelector<HTMLElement>("[data-optics]")?.dataset.optics;
        const d = raw ? JSON.parse(raw) : null;
        bank = d?.bank ?? null;
        screen = d?.screen ?? null;
      } catch {
        bank = null;
      }
      return {
        id: el.dataset.frame ?? "?",
        role: s?.setup?.role ?? null,
        pos: s?.setup?.pos ?? null,
        bank,
        screen,
        errors: s ? [...s.errors] : [],
      };
    }),
  );

/** A pen tap in a sim frame, at venue px. */
const frameTap = (page: Page, frame: string, vx: number, vy: number) =>
  page.evaluate(
    ({ frame, vx, vy }) => {
      const w = document.querySelector<HTMLIFrameElement>(
        `.sim-frame[data-frame="${frame}"] iframe`,
      )?.contentWindow as (Window & typeof globalThis) | null;
      if (!w?.__hypercube?.frame) throw new Error(`no frame ${frame}`);
      const stage = w.document.querySelector<HTMLElement>(".hc-stage")!;
      const r = stage.getBoundingClientRect();
      const unit = w.__hypercube.frame.unit;
      const x = r.left + vx * unit * (r.width / stage.offsetWidth);
      const y = r.top + vy * unit * (r.height / stage.offsetHeight);
      for (const type of ["pointerdown", "pointerup"]) {
        const target = type === "pointerdown" ? w.document.elementFromPoint(x, y) : w;
        target?.dispatchEvent(
          new w.PointerEvent(type, {
            pointerId: 77,
            clientX: x,
            clientY: y,
            bubbles: true,
            pointerType: "pen",
            buttons: type === "pointerup" ? 0 : 1,
          }),
        );
      }
    },
    { frame, vx, vy },
  );

test.describe("optics bank", () => {
  test.describe.configure({ timeout: 240_000 });

  test("light crosses from one panel to the next, and the guide comes back when the neighbour goes", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await page.goto(
      "sim/?preset=bank&count=2&span=1&app=optics&transport=local&res=0.25&seed=e2e&debug=1&idle=600",
    );
    await expect
      .poll(
        async () => {
          const f = await snapshot(page);
          return (
            f.filter((x) => x.bank?.left !== undefined).length === 2 && f.some((x) => x.screen)
          );
        },
        { timeout: 90_000, intervals: [500] },
      )
      .toBe(true);
    let frames = await snapshot(page);
    const first = frames.find((f) => f.role === "station" && f.pos === 0)!;
    const second = frames.find((f) => f.role === "station" && f.pos === 1)!;
    // Visitors' touches stop both attract hands.
    await frameTap(page, first.id, 540, 60);
    await frameTap(page, second.id, 540, 60);
    await expect
      .poll(async () => (await snapshot(page)).find((f) => f.id === second.id)?.bank?.left, {
        timeout: 30_000,
      })
      .toBe(first.id);
    // Until the first panel is solved, the second shows a guide where its light should come in.
    frames = await snapshot(page);
    expect(frames.find((f) => f.id === second.id)!.bank!.guides).toBe(1);

    await page.evaluate((id) => {
      const w = document.querySelector<HTMLIFrameElement>(`.sim-frame[data-frame="${id}"] iframe`)!
        .contentWindow as Window;
      w.__optics!.solve(0);
    }, first.id);
    await expect
      .poll(async () => (await snapshot(page)).find((f) => f.id === first.id)?.bank?.exitsRight, {
        timeout: 10_000,
      })
      .toBeGreaterThan(0);
    // The light arrives where the second panel expects it, so its guide goes.
    await expect
      .poll(
        async () => {
          const b = (await snapshot(page)).find((f) => f.id === second.id)?.bank;
          return b ? `${b.inLeft > 0} ${b.guides}` : "none";
        },
        { timeout: 15_000, intervals: [250] },
      )
      .toBe("true 0");

    // The first panel goes: within a couple of seconds the guide is back.
    await page.evaluate((id) => {
      document.querySelector<HTMLIFrameElement>(`.sim-frame[data-frame="${id}"] iframe`)!.src =
        "about:blank";
    }, first.id);
    await expect
      .poll(
        async () => {
          const b = (await snapshot(page)).find((f) => f.id === second.id)?.bank;
          return b ? `${b.inLeft} ${b.guides}` : "none";
        },
        { timeout: 6000, intervals: [200] },
      )
      .toBe("0 1");
    for (const f of await snapshot(page)) expect(f.errors, f.id).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("a bank whose light gets all the way through plays the screen's finale and moves on once", async ({
    page,
  }) => {
    const problems = watchPage(page);
    await page.goto(
      "sim/?preset=bank&count=3&span=1&app=optics&transport=local&res=0.25&seed=fin&debug=1&idle=600",
    );
    const screenState = async () =>
      (await snapshot(page)).find((f) => f.role === "screen")?.screen as
        | { serial: number; bright: number; crystals: number; finale: boolean }
        | null
        | undefined;
    await expect
      .poll(
        async () => {
          const f = await snapshot(page);
          return (
            f.filter((x) => x.bank?.left !== undefined).length === 3 && Boolean(await screenState())
          );
        },
        { timeout: 90_000, intervals: [500] },
      )
      .toBe(true);
    // Visitors at every panel: the attract hands stop.
    for (const f of await snapshot(page))
      if (f.role === "station") await frameTap(page, f.id, 540, 60);
    await page.waitForTimeout(4000);
    await page.evaluate(() => {
      for (const el of document.querySelectorAll<HTMLElement>(".sim-frame[data-frame]")) {
        (el.querySelector("iframe")?.contentWindow as Window | null)?.__optics?.solve(0);
      }
    });
    await expect
      .poll(async () => (await screenState())?.finale, { timeout: 15_000, intervals: [250] })
      .toBe(true);
    const s = (await screenState())!;
    expect(s.bright).toBe(s.crystals);
    // After the celebration the bank moves on to the next puzzle, and stays there.
    await expect
      .poll(async () => (await screenState())?.serial, { timeout: 15_000, intervals: [250] })
      .toBe(1);
    await page.waitForTimeout(6000);
    expect((await screenState())!.serial).toBe(1);
    for (const f of await snapshot(page)) expect(f.errors, f.id).toEqual([]);
    expect(problems).toEqual([]);
  });
});
