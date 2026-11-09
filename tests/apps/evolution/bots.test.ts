import { describe, expect, it } from "vitest";
import { createBots, pickFish } from "../../../src/apps/evolution/bots";
import { layoutFor } from "../../../src/apps/evolution/layout";
import { createRng } from "../../../src/core/rng";
import type { Input } from "../../../src/core/types";
import { testPond } from "./helpers";

describe("evolution bots", () => {
  it("pick the fish that catch the eye more often than chance", () => {
    const p = testPond({ seed: "eye", herons: "off" });
    const rng = createRng("bot");
    const sorted = p.pond.fish.map((f) => f.standout).sort((a, b) => b - a);
    let rank = 0;
    for (let i = 0; i < 400; i++) {
      const f = pickFish(p.pond, rng)!;
      rank += sorted.indexOf(f.standout) / (sorted.length - 1);
    }
    expect(rank / 400).toBeLessThan(0.3);
  });

  it("tap fish and now and then a floor tile, through injected touches", async () => {
    (globalThis as unknown as { window: unknown }).window ??= globalThis;
    const p = testPond({ seed: "taps", herons: "off" });
    const layout = layoutFor({
      kind: "panel",
      width: 1080,
      height: 1920,
      reachTop: { adult: 0, child: 960 },
      seams: [],
      ponds: 1,
    });
    p.pond.spec.box = { ...layout.ponds[0]!.box };
    const downs: { x: number; y: number }[] = [];
    let ups = 0;
    const input = {
      on: () => () => {},
      pointers: new Map(),
      inject: {
        down(x: number, y: number) {
          downs.push({ x, y });
          return downs.length;
        },
        move() {},
        up() {
          ups++;
        },
      },
    } as unknown as Input;
    const bots = createBots({
      input,
      count: 2,
      ponds: () => [p.pond],
      layout: () => layout,
      unit: () => 0.5,
      rng: createRng("bots"),
    });
    for (let t = 0; t < 600; t += 0.5) bots.update(t);
    expect(bots.taps).toBeGreaterThan(300);
    const tile = layout.ponds[0]!.tiles[0]!.box;
    const onTiles = downs.filter((d) => d.y / 0.5 < tile.y + tile.h + 5 && d.y / 0.5 > tile.y - 5);
    expect(onTiles.length).toBeGreaterThan(0);
    expect(onTiles.length).toBeLessThan(downs.length * 0.1);
    bots.dispose();
    await new Promise((r) => setTimeout(r, 120));
    expect(ups).toBeGreaterThan(0);
  });
});
