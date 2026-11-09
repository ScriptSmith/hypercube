/**
 * Every theme's table, looped over all of them, so a new theme gets these checks for free:
 * registration, a middle that leaves the shared skeleton clear, no tunnelling and containment at
 * full speed with the toys moving, bots still reaching the deck lane, and sane ball counts.
 */
import { describe, expect, it } from "vitest";
import { applyIntent, createBot } from "../../../src/apps/pinball/bot";
import {
  BALL_R,
  MAX_IN_PLAY,
  readConfig,
  SUBSTEPS,
  TABLE_H,
  TABLE_W,
  THEMES,
  type ThemeId,
  VARIANTS,
  VMAX,
} from "../../../src/apps/pinball/config";
import { HOLD_LIMIT_S } from "../../../src/apps/pinball/devices";
import { buildTable, EXIT_U, RETURN_U, type TableLayout } from "../../../src/apps/pinball/layout";
import manifest from "../../../src/apps/pinball/manifest";
import { makeBall, makeWorld, type Shape, stepWorld } from "../../../src/apps/pinball/physics";
import { THEME_RULES, tableFor } from "../../../src/apps/pinball/themes";
import { DT, rig, seeded } from "./helpers";

const ARCH = { x: 540, y: 640, r: 516 };

/** The middle's shapes: everything a classic skeleton built with an empty middle doesn't have. */
const middleShapes = (layout: TableLayout): Shape[] => {
  const bare = buildTable({ mirror: layout.mirror, middle: () => null });
  return layout.shapes.slice(bare.shapes.length - 3, layout.shapes.length - 3);
};

/** Distance from (x, y) to segment a-b. */
const toSeg = (x: number, y: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
  return Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
};

/** Distance from (x, y) to an arc's centreline, its open ends included. */
const toArc = (x: number, y: number, s: Extract<Shape, { kind: "arc" }>) => {
  let rel = (Math.atan2(y - s.cy, x - s.cx) - s.a0) % (Math.PI * 2);
  if (rel < 0) rel += Math.PI * 2;
  if (rel <= s.a1 - s.a0) return Math.abs(Math.hypot(x - s.cx, y - s.cy) - s.rad);
  return Math.min(
    ...[s.a0, s.a1].map((a) =>
      Math.hypot(x - s.cx - Math.cos(a) * s.rad, y - s.cy - Math.sin(a) * s.rad),
    ),
  );
};

/** Points along a shape's centreline, with its half thickness. */
const outline = (s: Shape): { x: number; y: number; r: number }[] => {
  if (s.kind === "circle") {
    return Array.from({ length: 16 }, (_, i) => ({
      x: s.x + Math.cos((i * Math.PI) / 8) * s.r,
      y: s.y + Math.sin((i * Math.PI) / 8) * s.r,
      r: 0,
    }));
  }
  if (s.kind === "seg") {
    return Array.from({ length: 9 }, (_, i) => ({
      x: s.ax + ((s.bx - s.ax) * i) / 8,
      y: s.ay + ((s.by - s.ay) * i) / 8,
      r: s.r,
    }));
  }
  return Array.from({ length: 17 }, (_, i) => {
    const a = s.a0 + ((s.a1 - s.a0) * i) / 16;
    return { x: s.cx + Math.cos(a) * s.rad, y: s.cy + Math.sin(a) * s.rad, r: s.r };
  });
};

/** What a middle must leave clear, in table px of the table as built (X mirrors). */
const clearance = (layout: TableLayout, shapes: Shape[]): string[] => {
  const X = (x: number) => (layout.mirror ? TABLE_W - x : x);
  const dl = layout.deckLane;
  // The shot from the upper left flipper's tip into the deck lane and up its exit.
  const shot = [{ x: X(150), y: 790 }, dl.mouth, dl.end, { x: X(EXIT_U * TABLE_W), y: 0 }];
  const problems: string[] = [];
  for (const s of shapes) {
    if (!s.on) continue;
    const name = `${s.tag}:${s.index}`;
    for (const p of outline(s)) {
      const r = p.r;
      // Balls launched from the plunger ride round the arch.
      if (p.y < ARCH.y && Math.hypot(p.x - ARCH.x, p.y - ARCH.y) + r > ARCH.r - 7 - 2 * BALL_R - 4)
        problems.push(`${name} blocks the arch at ${p.x.toFixed(0)},${p.y.toFixed(0)}`);
      for (let i = 1; i < shot.length; i++) {
        const a = shot[i - 1]!;
        const b = shot[i]!;
        if (toSeg(p.x, p.y, a.x, a.y, b.x, b.y) < BALL_R + r + 4)
          problems.push(
            `${name} is in the deck lane's shot at ${p.x.toFixed(0)},${p.y.toFixed(0)}`,
          );
      }
      for (const f of layout.flippers.slice(2)) {
        if (Math.hypot(p.x - f.px, p.y - f.py) < f.len + f.r0 + 2 * BALL_R + r)
          problems.push(`${name} is in the ${f.name} flipper's way`);
      }
      const inner = layout.mirror ? TABLE_W - 976 : 976;
      if (layout.mirror ? p.x - r < inner + 7 : p.x + r > inner - 7)
        problems.push(`${name} is in the plunger lane`);
      const rx = X(RETURN_U * TABLE_W);
      if (p.y < 260 && Math.abs(p.x - rx) < BALL_R + r + 7)
        problems.push(`${name} is in the return tube's way`);
      if (p.y + r > 1265 || p.y - r < 128)
        problems.push(`${name} is outside the middle (y ${p.y})`);
    }
  }
  return [...new Set(problems)];
};

/** A themed table whose toys have been run for `s` seconds. */
const themed = (theme: ThemeId | null, mirror: boolean) => {
  const r = rig({ variant: theme ?? "classic", mirror });
  r.table.start("human");
  r.table.world.balls.length = 0;
  return r;
};

describe("pinball themes", () => {
  it("has a variant, a manifest entry and rules for every theme, classic first", () => {
    expect(VARIANTS[0]).toBe("classic");
    expect(manifest.variants?.map((v) => v.id)).toEqual([...VARIANTS]);
    for (const t of THEMES) {
      expect(THEME_RULES[t].id).toBe(t);
      expect(readConfig(t, {}).theme).toBe(t);
      expect(readConfig(t, {}).variant).toBe(t);
      const { layout, toys } = tableFor(t, false);
      expect(layout.theme).toBe(t);
      expect(toys).toBeTypeOf("function");
    }
    expect(readConfig("classic", {}).theme).toBeNull();
    expect(tableFor(null, false).toys).toBeUndefined();
  });

  for (const theme of THEMES) {
    for (const mirror of [false, true]) {
      const label = `${theme}${mirror ? " mirrored" : ""}`;

      it(`${label}: keeps the skeleton and the lamps the score needs`, () => {
        const { layout } = tableFor(theme, mirror);
        const classic = buildTable({ mirror });
        // The skeleton's shapes are the classic table's, at the start and the end.
        const same = (a: Shape, b: Shape) =>
          JSON.stringify({ ...a, id: 0 }) === JSON.stringify({ ...b, id: 0 });
        for (let i = 0; i < 17; i++) expect(same(layout.shapes[i]!, classic.shapes[i]!)).toBe(true);
        for (let k = 1; k <= 3; k++)
          expect(same(layout.shapes.at(-k)!, classic.shapes.at(-k)!)).toBe(true);
        expect(layout.flippers.map((f) => [f.name, f.px, f.py])).toEqual(
          classic.flippers.map((f) => [f.name, f.px, f.py]),
        );
        expect([layout.exitU, layout.returnU]).toEqual([classic.exitU, classic.returnU]);
        expect(layout.gates[0]!.tag).toBe("deck");
        for (const tag of ["mult", "save", "deck"]) {
          expect(layout.lamps.filter((l) => l.tag === tag).length).toBeGreaterThan(0);
        }
        for (const tag of ["inlane", "outlane"])
          expect(layout.rollovers.filter((r) => r.tag === tag)).toHaveLength(2);
      });

      it(`${label}: leaves the arch, the deck lane's shot, the upper flippers and the tubes clear`, () => {
        const r = themed(theme, mirror);
        const shapes = middleShapes(r.table.layout);
        // Moving things are checked wherever they go: a minute of the toys running.
        const seen = new Set<string>();
        for (let i = 0; i < 120 * 60; i += 12) {
          for (let k = 0; k < 12 * SUBSTEPS; k++) r.table.world.tick?.(DT / SUBSTEPS);
          for (const p of clearance(r.table.layout, shapes)) seen.add(p);
        }
        expect([...seen]).toEqual([]);
      });

      it(`${label}: never lets a full-speed ball through any part of its middle`, () => {
        const { layout } = tableFor(theme, mirror);
        const rnd = seeded(5);
        let checked = 0;
        for (const s of middleShapes(layout)) {
          for (let n = 0; n < 24; n++) {
            const w = makeWorld({
              gravity: 0,
              vmax: VMAX,
              damping: 0,
              bounds: { x0: -5000, y0: -5000, x1: 5000, y1: 5000 },
            });
            w.shapes = [s];
            const o = outline(s);
            const aim = o[Math.floor(rnd() * o.length)]!;
            const a = rnd() * Math.PI * 2;
            const b = makeBall(1, aim.x - Math.cos(a) * 300, aim.y - Math.sin(a) * 300, BALL_R);
            b.vx = Math.cos(a) * VMAX;
            b.vy = Math.sin(a) * VMAX;
            w.balls.push(b);
            for (let i = 0; i < 24; i++) {
              stepWorld(w, DT, SUBSTEPS);
              const d =
                s.kind === "circle"
                  ? Math.hypot(b.x - s.x, b.y - s.y) - s.r
                  : s.kind === "seg"
                    ? toSeg(b.x, b.y, s.ax, s.ay, s.bx, s.by) - s.r
                    : toArc(b.x, b.y, s) - s.r;
              expect(d, `${s.tag}:${s.index}`).toBeGreaterThan(BALL_R - 3);
              checked++;
            }
          }
        }
        expect(checked).toBeGreaterThan(100);
      });

      it(`${label}: keeps full-speed balls inside the table, with its toys at work`, () => {
        const rnd = seeded(theme.length + (mirror ? 1 : 0));
        for (let n = 0; n < 60; n++) {
          const r = themed(theme, mirror);
          const t = r.table;
          for (const f of t.world.flippers) f.held = rnd() < 0.5;
          const b = t.place(200 + rnd() * 600, 650 + rnd() * 500, 0, 0);
          const a = rnd() * Math.PI * 2;
          b.vx = Math.cos(a) * VMAX;
          b.vy = Math.sin(a) * VMAX;
          for (let i = 0; i < 300; i++) {
            if (i % 30 === 0) for (const f of t.world.flippers) f.held = rnd() < 0.5;
            r.step(DT);
            for (const x of t.world.balls) {
              expect(x.x, `${label} run ${n}`).toBeGreaterThan(24 + 7 - 1);
              expect(x.x, `${label} run ${n}`).toBeLessThan(1058 - 7 + 1);
              if (x.y < 640)
                expect(Math.hypot(x.x - 540, x.y - 640)).toBeLessThan(516 - 7 - BALL_R + 1);
            }
          }
        }
      });
    }

    it(`${theme}: bots still reach the deck lane, on both hands of table`, () => {
      let lanes = 0;
      for (const mirror of [false, true]) {
        const r = rig({ variant: theme, mirror, config: { balls: 1_000_000 } });
        r.table.start("bot");
        const bot = createBot(seeded(11), 0.9);
        const was = { plunger: false };
        for (let i = 0; i < 6 * 60 * 120; i++) {
          bot.update(r.table);
          applyIntent(r.table, bot.intent, was);
          r.step(DT);
        }
        lanes += r.table.stats.orbit;
      }
      expect(lanes).toBeGreaterThanOrEqual(5);
    });

    it(`${theme}: a bot game keeps its ball counts in bounds and never holds a ball too long`, () => {
      const r = rig({ variant: theme, config: { balls: 5 } });
      r.table.start("bot");
      const bot = createBot(seeded(3), 0.9);
      const was = { plunger: false };
      const since = new Map<number, number>();
      let longest = 0;
      for (let i = 0; i < 4 * 60 * 120 && r.table.mode === "play"; i++) {
        bot.update(r.table);
        applyIntent(r.table, bot.intent, was);
        r.step(DT);
        const t = r.table;
        expect(t.inPlay()).toBeLessThanOrEqual(MAX_IN_PLAY);
        // A game that is on always has something in play.
        if (t.mode === "play") expect(t.inPlay()).toBeGreaterThan(0);
        const now = t.world.t;
        const held = new Set(t.toys.held().map((h) => h.ball.id));
        for (const id of held) if (!since.has(id)) since.set(id, now);
        for (const [id, at] of since) {
          if (held.has(id)) longest = Math.max(longest, now - at);
          else since.delete(id);
        }
        for (const h of t.toys.held()) {
          expect(h.x).toBeGreaterThan(-BALL_R * 4);
          expect(h.x).toBeLessThan(TABLE_W + BALL_R * 4);
          expect(h.y).toBeLessThan(TABLE_H);
        }
      }
      expect(longest).toBeLessThanOrEqual(HOLD_LIMIT_S + 0.1);
    });
  }
});
