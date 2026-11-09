import { describe, expect, it } from "vitest";
import {
  BIN_KINDS,
  BIN_LOOK,
  binsFor,
  ITEMS,
  itemsFor,
  LEFT_OUT,
} from "../../../src/apps/recycling/items";
import { createPicker, poolFor } from "../../../src/apps/recycling/picker";
import { createRng } from "../../../src/core/rng";

describe("recycling items", () => {
  it("are 16 to 20 pictures with unique ids and a one-line reason each", () => {
    expect(ITEMS.length).toBeGreaterThanOrEqual(16);
    expect(ITEMS.length).toBeLessThanOrEqual(20);
    expect(new Set(ITEMS.map((i) => i.id)).size).toBe(ITEMS.length);
    for (const it of ITEMS) {
      expect(it.reason.length, it.id).toBeGreaterThan(20);
      expect(it.reason, it.id).not.toMatch(/\n/);
      expect(it.reason, it.id).not.toMatch(/—/);
    }
  });

  it("every item has a bin and every bin has items, two of them obvious where children sort", () => {
    for (const it of ITEMS) expect(BIN_KINDS).toContain(it.bin);
    for (const bin of BIN_KINDS) {
      expect(ITEMS.filter((it) => it.bin === bin).length, bin).toBeGreaterThanOrEqual(2);
    }
    for (const bin of ["recycle", "compost", "rubbish"] as const) {
      expect(ITEMS.filter((it) => it.bin === bin && !it.tricky).length, bin).toBeGreaterThanOrEqual(
        1,
      );
    }
  });

  it("batteries and phones go to the drop-off and ride the adults' belt", () => {
    const drop = ITEMS.filter((it) => it.bin === "dropoff").map((it) => it.id);
    expect(drop.sort()).toEqual(["battery", "phone"]);
    for (const it of ITEMS.filter((i) => i.bin === "dropoff")) expect(it.tricky).toBe(true);
  });

  it("the two-bin variant uses only recycling and rubbish, and obvious things", () => {
    expect(binsFor("simple")).toEqual(["recycle", "rubbish"]);
    expect(binsFor("sort")).toEqual(["recycle", "compost", "rubbish", "dropoff"]);
    const simple = itemsFor("simple").map((i) => ITEMS[i]!);
    expect(simple.length).toBeGreaterThanOrEqual(6);
    for (const it of simple) expect(["recycle", "rubbish"]).toContain(it.bin);
    expect(simple.some((it) => it.bin === "recycle")).toBe(true);
    expect(simple.some((it) => it.bin === "rubbish")).toBe(true);
    expect(simple.map((it) => it.id)).not.toContain("mug");
  });

  it("leaves out the items councils disagree on", () => {
    const ids = ITEMS.map((i) => i.id as string);
    for (const banned of ["coffeeCup", "pizzaBox", "carton", "aerosol", "bag", "tissue"]) {
      expect(ids).not.toContain(banned);
    }
    expect(LEFT_OUT.length).toBeGreaterThanOrEqual(5);
  });

  it("each bin has its own lid colour", () => {
    expect(new Set(BIN_KINDS.map((b) => BIN_LOOK[b].lid)).size).toBe(4);
  });
});

describe("recycling picker", () => {
  it("draws each class only from its own items, and never the same item twice running", () => {
    const p = createPicker(createRng(7), "sort");
    for (const cls of ["tricky", "obvious", "any"] as const) {
      const pool = new Set(poolFor("sort", cls));
      let last = -1;
      for (let i = 0; i < 400; i++) {
        const k = p.pick(cls);
        expect(pool.has(k), cls).toBe(true);
        expect(k).not.toBe(last);
        last = k;
      }
    }
  });

  it("gives every bin a fair share", () => {
    const p = createPicker(createRng(3), "sort");
    const counts: Record<string, number> = {};
    for (let i = 0; i < 4000; i++) {
      const bin = ITEMS[p.pick(i % 2 === 0 ? "tricky" : "obvious")]!.bin;
      counts[bin] = (counts[bin] ?? 0) + 1;
    }
    for (const bin of BIN_KINDS) expect(counts[bin]! / 4000, bin).toBeGreaterThan(0.1);
    const simple = createPicker(createRng(3), "simple");
    for (let i = 0; i < 500; i++) {
      expect(["recycle", "rubbish"]).toContain(ITEMS[simple.pick("any")]!.bin);
    }
  });
});
