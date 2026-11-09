import { expect, type Page, test } from "@playwright/test";
import { waitForRunning, watchPage } from "../scripts/lib/play.mjs";
import {
  createGrid,
  GLIDER,
  hash3,
  LWSS,
  place,
  R_PENTOMINO,
  setCell,
  sinceOf,
  step,
} from "../src/apps/petri/life";

interface PetriDebug {
  state(): {
    mode: string;
    connected: boolean;
    slices: { from: number; to: number; value: number }[] | null;
    landed: { pos: number; u: number; x: number; y: number }[];
    regions: number[];
    selections: string[];
  };
  lifeCheck(w: number, h: number, cells: [number, number, number][], gens: number): number[] | null;
  flick(side: number, u: number, strength: number): boolean;
  setDial(region: number, value: number): void;
}

declare global {
  interface Window {
    __petri?: PetriDebug;
  }
}

test("petri runs Life on the GPU exactly as the CPU reference does", async ({ page }) => {
  const problems = watchPage(page);
  await page.setViewportSize({ width: 270, height: 480 });
  await page.goto("play/?app=petri&kind=panel&fit=1080x1920&bots=0&seed=t&debug=1");
  expect((await waitForRunning(page)).phase).toBe("running");

  const W = 96;
  const H = 80;
  const g = createGrid(W, H);
  place(g, R_PENTOMINO, 30, 30, 1);
  place(g, GLIDER, 70, 12, 2, { rot: 1, mirror: true });
  place(g, LWSS, 70, 60, 3, { rot: 2, mirror: false });
  // A soup of mixed colours, so births have to pick between parents.
  for (let y = 50; y < 70; y++) {
    for (let x = 8; x < 28; x++) {
      const h = hash3(x, y, 99);
      if (h % 100 < 45) setCell(g, x, y, h % 5);
    }
  }
  const cells: [number, number, number][] = [];
  for (let i = 0; i < W * H; i++)
    if (g.alive[i]) cells.push([i % W, Math.floor(i / W), g.color[i]!]);

  const gens = 160;
  const gpu = await page.evaluate(
    ({ W, H, cells, gens }) => window.__petri?.lifeCheck(W, H, cells, gens) ?? null,
    { W, H, cells, gens },
  );
  expect(gpu, "GPU result").not.toBeNull();
  for (let i = 0; i < gens; i++) step(g);

  const mismatches: string[] = [];
  for (let i = 0; i < W * H && mismatches.length < 10; i++) {
    const [flags, color, persist, since] = [
      gpu![i * 4]!,
      gpu![i * 4 + 1]!,
      gpu![i * 4 + 2]!,
      gpu![i * 4 + 3]!,
    ];
    const alive = flags & 1;
    const want = [g.alive[i]!, g.color[i]!, g.persist[i]!, sinceOf(g, i)];
    if (
      alive !== want[0] ||
      persist !== want[2] ||
      since !== want[3] ||
      (alive && color !== want[1])
    ) {
      mismatches.push(
        `(${i % W},${Math.floor(i / W)}) gpu ${[alive, color, persist, since]} cpu ${want}`,
      );
    }
  }
  expect(mismatches).toEqual([]);
  expect(problems).toEqual([]);
});

test("petri labels every swatch and detent, and marks the chosen ones", async ({ page }) => {
  const problems = watchPage(page);
  await page.setViewportSize({ width: 540, height: 960 });
  await page.goto("play/?app=petri&kind=panel&variant=turing&fit=1080x1920&bots=0&seed=t&debug=1");
  expect((await waitForRunning(page)).phase).toBe("running");
  await page.waitForSelector(".pt-detent .pt-label");

  const labels = (selector: string) =>
    page.$$eval(selector, (els) =>
      els.map((el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          text: el.textContent ?? "",
          // Venue px: the panel is 1080 wide.
          font: (parseFloat(s.fontSize) * 1080) / window.innerWidth,
          clipped: el.scrollWidth > el.clientWidth + 1,
          color: s.color,
          x: r.x + r.width / 2,
          y: r.y + r.height / 2,
        };
      }),
    );
  const tiles = await labels(".pt-tile .pt-label");
  const chips = await labels(".pt-detent .pt-label");
  expect(tiles.map((t) => t.text)).toEqual(["Drop", "Small", "Big", "Wash"]);
  expect(chips.map((t) => t.text)).toEqual(["Spots", "Coral", "Worms", "Maze"]);
  for (const l of [...tiles, ...chips]) {
    expect(l.clipped, l.text).toBe(false);
    expect(l.font, l.text).toBeGreaterThanOrEqual(36);
  }
  // The chosen swatch and detent have dark text on a lit nameplate.
  const ink = "rgb(7, 18, 26)";
  const chosen = async (selector: string) =>
    (await labels(selector)).filter((l) => l.color === ink).map((l) => l.text);
  await expect.poll(() => chosen(".pt-tile .pt-label")).toEqual(["Drop"]);
  await expect.poll(() => chosen(".pt-detent .pt-label")).toEqual(["Spots"]);

  const coral = chips.find((c) => c.text === "Coral")!;
  await page.mouse.click(coral.x, coral.y);
  const small = tiles.find((t) => t.text === "Small")!;
  await page.mouse.click(small.x, small.y);
  await expect.poll(() => page.evaluate(() => window.__petri?.state().regions[0])).toBe(1);
  await expect.poll(() => chosen(".pt-detent .pt-label")).toEqual(["Coral"]);
  await expect.poll(() => chosen(".pt-tile .pt-label")).toEqual(["Small"]);
  expect(problems).toEqual([]);
});

test("petri runs Life instead of reaction-diffusion without float render targets", async ({
  page,
}) => {
  const warnings: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "warning" && m.text().startsWith("petri:")) warnings.push(m.text());
  });
  const problems = watchPage(page);
  await page.addInitScript(() => {
    const proto = WebGL2RenderingContext.prototype as unknown as {
      getExtension(name: string): unknown;
    };
    const get = proto.getExtension;
    proto.getExtension = function (this: unknown, name: string) {
      return name === "EXT_color_buffer_float" ? null : get.call(this, name);
    };
  });
  await page.setViewportSize({ width: 270, height: 480 });
  await page.goto("play/?app=petri&kind=panel&variant=turing&fit=1080x1920&bots=1&seed=t");
  expect((await waitForRunning(page)).phase).toBe("running");
  await expect.poll(() => page.evaluate(() => window.__hypercube?.appStatus().family)).toBe("life");
  expect(warnings.length).toBe(1);
  expect(problems).toEqual([]);
});

const simStates = (page: Page) =>
  page.evaluate(() => {
    const out: Record<string, ReturnType<PetriDebug["state"]> | null> = {};
    for (const el of document.querySelectorAll<HTMLElement>(".sim-frame[data-frame]")) {
      const w = el.querySelector("iframe")?.contentWindow as
        | (Window & { __petri?: PetriDebug })
        | null;
      try {
        out[el.dataset.frame ?? "?"] = w?.__petri?.state() ?? null;
      } catch {
        out[el.dataset.frame ?? "?"] = null;
      }
    }
    return out;
  });

const inFrame = async <T>(page: Page, id: string, fn: (p: PetriDebug) => T): Promise<void> => {
  const el = await page.$(`.sim-frame[data-frame="${id}"] iframe`);
  const frame = await el?.contentFrame();
  await frame?.evaluate(fn as (p: unknown) => T, undefined as never);
};

test("petri bank drops into the dish above each panel and copes without the screen", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const problems = watchPage(page);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(
    "sim/?preset=bank-panels&app=petri&variant=slime&transport=local&bots=0&seed=test&debug=1&res=0.25",
  );
  await page.waitForFunction(() => window.__hypercubeSim !== undefined);
  const panels = Array.from({ length: 6 }, (_, i) => `a-p${i + 1}`);

  await expect
    .poll(
      async () => {
        const s = await simStates(page);
        return panels.filter((id) => s[id]?.connected).length;
      },
      { timeout: 150_000, intervals: [1000] },
    )
    .toBe(6);

  // A flick from the middle of the fourth panel lands above it.
  await inFrame(page, "a-p4", () => window.__petri?.flick(0, 0.5, 0.5));
  await expect
    .poll(
      async () => {
        const s = await simStates(page);
        const hit = s["a-screen"]?.landed.find((l) => l.pos === 3 && Math.abs(l.u - 0.5) < 0.01);
        return hit ? Math.round(hit.x) : null;
      },
      { timeout: 20_000 },
    )
    .toBe(Math.round((3.5 / 6) * 4000));

  // The fifth panel's dial sets the slice of dish above it.
  await inFrame(page, "a-p5", () => window.__petri?.setDial(0, 3));
  await expect
    .poll(
      async () => {
        const s = await simStates(page);
        return s["a-screen"]?.slices?.map((x) => x.value).join(",");
      },
      { timeout: 20_000 },
    )
    .toBe("1,1,1,1,3,1");

  // Without the screen, panels become local cultures within six seconds.
  await page.evaluate(() => {
    const f = document.querySelector<HTMLIFrameElement>('.sim-frame[data-frame="a-screen"] iframe');
    if (!f) return;
    f.dataset.src = f.src;
    f.src = "about:blank";
  });
  const gone = Date.now();
  await expect
    .poll(
      async () => {
        const s = await simStates(page);
        return panels.filter((id) => s[id]?.connected === false).length;
      },
      { timeout: 6000, intervals: [250] },
    )
    .toBe(6);
  expect(Date.now() - gone).toBeLessThan(6500);

  // And they drop into the dish again when it comes back.
  await page.evaluate(() => {
    const f = document.querySelector<HTMLIFrameElement>('.sim-frame[data-frame="a-screen"] iframe');
    if (f?.dataset.src) f.src = f.dataset.src;
  });
  await expect
    .poll(
      async () => {
        const s = await simStates(page);
        return panels.filter((id) => s[id]?.connected).length;
      },
      { timeout: 90_000, intervals: [1000] },
    )
    .toBe(6);
  expect(problems).toEqual([]);
});
