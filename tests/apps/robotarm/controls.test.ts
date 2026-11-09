import { describe, expect, it } from "vitest";
import { createControls } from "../../../src/apps/robotarm/controls";
import { cellOf, layoutOf } from "./helpers";

const setup = (kind: "panel" | "wall" = "panel") => {
  const layout = layoutOf(kind, kind === "wall" ? 2 : 1);
  const cells = layout.cells.map((_, i) => cellOf("tidy", `c${i}`));
  const controls = createControls(cells, layout);
  return { layout, cells, controls };
};

/** A finger round a dial from its top by `turn` radians in small steps. */
const sweep = (
  controls: ReturnType<typeof createControls>,
  d: { x: number; y: number; r: number },
  turn: number,
  id = 1,
  kind: "person" | "bot" | "ghost" = "person",
  start = -Math.PI / 2,
) => {
  const at = (a: number) => ({
    x: d.x + Math.cos(a) * d.r * 0.6,
    y: d.y + Math.sin(a) * d.r * 0.6,
  });
  const p0 = at(start);
  const ok = controls.down(id, p0.x, p0.y, kind, 0);
  const n = 30;
  for (let i = 1; i <= n; i++) {
    const p = at(start + (turn * i) / n);
    controls.move(id, p.x, p.y, i);
  }
  controls.up(id);
  return ok;
};

describe("robotarm controls", () => {
  it("turn a joint's target one to one with the finger's turn round the dial, clockwise positive", () => {
    const { layout, cells, controls } = setup();
    const c = cells[0]!;
    const d = layout.cells[0]!.dials[0]!;
    const before = c.target[0];
    sweep(controls, d, Math.PI / 2);
    expect(c.target[0] - before).toBeCloseTo(Math.PI / 2, 9);
    sweep(controls, d, -Math.PI / 4, 2, "person", 0.3);
    expect(c.target[0] - before).toBeCloseTo(Math.PI / 4, 9);
  });

  it("only count the change, so a dial can be taken anywhere on it", () => {
    const { layout, cells, controls } = setup();
    const c = cells[0]!;
    const d = layout.cells[0]!.dials[2]!;
    const before = c.target[2];
    controls.down(1, d.x + d.r * 0.7, d.y, "person", 0);
    expect(c.target[2]).toBe(before);
  });

  it("ignore a finger in the dead centre", () => {
    const { layout, cells, controls } = setup();
    const c = cells[0]!;
    const d = layout.cells[0]!.dials[4]!;
    const before = c.target[4];
    controls.down(1, d.x, d.y, "person", 0);
    controls.move(1, d.x + 3, d.y + 2, 1);
    controls.move(1, d.x - 2, d.y + 3, 2);
    expect(c.target[4]).toBe(before);
  });

  it("let a second finger take a dial over", () => {
    const { layout, controls } = setup();
    const d = layout.cells[0]!.dials[1]!;
    controls.down(1, d.x, d.y - d.r * 0.6, "person", 0);
    controls.down(2, d.x + d.r * 0.6, d.y, "person", 0);
    expect(controls.holder(0, 1)).toBe(2);
    expect(controls.holds.has(1)).toBe(false);
  });

  it("toggle the grip on touch", () => {
    const { layout, cells, controls } = setup();
    const g = layout.cells[0]!.grip;
    expect(cells[0]!.grip.closed).toBe(false);
    controls.down(1, g.x, g.y, "person", 0);
    expect(cells[0]!.grip.closed).toBe(true);
    controls.up(1);
    controls.down(2, g.x + g.r * 0.5, g.y, "person", 0);
    expect(cells[0]!.grip.closed).toBe(false);
  });

  it("take an arm off its demonstration at the first touch, a person's or a bot's", () => {
    const { layout, cells, controls } = setup("wall");
    expect(cells.every((c) => c.mode === "demo")).toBe(true);
    const d = layout.cells[1]!.dials[3]!;
    controls.down(1, d.x, d.y - d.r * 0.5, "person", 1234);
    expect(cells[1]!.mode).toBe("people");
    expect(cells[1]!.lastHuman).toBe(1234);
    expect(cells[0]!.mode).toBe("demo");
    const g = layout.cells[0]!.grip;
    controls.down(2, g.x, g.y, "bot", 2000);
    expect(cells[0]!.mode).toBe("people");
    expect(cells[0]!.lastTouch).toBe(2000);
    expect(cells[0]!.lastHuman).toBe(Number.NEGATIVE_INFINITY);
  });

  it("keep ghost fingers to arms in their demonstration", () => {
    const { layout, cells, controls } = setup();
    const c = cells[0]!;
    const d = layout.cells[0]!.dials[0]!;
    const before = c.target[0];
    expect(sweep(controls, d, 0.5, 1, "ghost")).toBe(true);
    expect(c.mode).toBe("demo");
    expect(c.target[0] - before).toBeCloseTo(0.5, 9);
    // A person takes over mid-turn: the ghost's next move is dropped.
    const at = (a: number) => ({
      x: d.x + Math.cos(a) * d.r * 0.6,
      y: d.y + Math.sin(a) * d.r * 0.6,
    });
    const g0 = at(0);
    controls.down(9, g0.x, g0.y, "ghost", 0);
    controls.down(3, layout.cells[0]!.dials[2]!.x, layout.cells[0]!.dials[2]!.y - 50, "person", 0);
    const t = c.target[0];
    const g1 = at(0.4);
    controls.move(9, g1.x, g1.y, 1);
    expect(c.target[0]).toBe(t);
    expect(controls.down(10, g0.x, g0.y, "ghost", 2)).toBe(false);
  });

  it("forget every finger when the layout changes", () => {
    const { layout, controls } = setup();
    const d = layout.cells[0]!.dials[1]!;
    controls.down(1, d.x, d.y - d.r * 0.5, "person", 0);
    controls.setLayout(layout);
    expect(controls.holds.size).toBe(0);
  });
});
