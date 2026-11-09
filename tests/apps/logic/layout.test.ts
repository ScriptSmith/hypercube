import { describe, expect, it } from "vitest";
import { ALL_GATES, BASIC_GATES } from "../../../src/apps/logic/circuit";
import { portsAt } from "../../../src/apps/logic/geometry";
import {
  benchAt,
  type BenchLayout,
  type Box,
  centres,
  type Layout,
  SEAM_KEEP,
} from "../../../src/apps/logic/layout";
import { layoutOf } from "./helpers";

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const inside = (b: Box, l: Layout) =>
  b.x >= 0 && b.y >= 0 && b.x + b.width <= l.W + 0.5 && b.y + b.height <= l.H + 0.5;

const pieceBox = (bl: BenchLayout, i: number): Box => {
  const s = bl.sockets[i]!;
  const w = s.band === "child" ? bl.child : bl.gateW;
  const h = s.band === "child" ? bl.child : bl.gateH;
  return { x: s.x - w / 2, y: s.y - h / 2, width: w, height: h };
};

/** Every touchable thing on a bench, with a name for messages. */
const controls = (bl: BenchLayout): [string, Box][] => [
  ...bl.sockets.flatMap((s, i): [string, Box][] =>
    s.band === "post" ? [] : [[`socket ${i}`, pieceBox(bl, i)]],
  ),
  ...bl.trays.map((t, i): [string, Box] => [`tray ${i}`, t.box]),
  ...bl.posts.map((p, i): [string, Box] => [`post ${i}`, p.body]),
  ["reset", bl.reset],
];

interface Case {
  name: string;
  layout: Layout;
}

const cases: Case[] = [];
for (const goals of [false, true]) {
  for (const posts of [2, 3]) {
    for (const gates of [ALL_GATES, BASIC_GATES]) {
      const tag = `${goals ? "goals" : "bench"}, ${posts} posts, ${gates.length} gates`;
      for (const n of [1, 2, 3]) {
        cases.push({
          name: `wall with ${n} benches (${tag})`,
          layout: layoutOf("wall", { benches: n, goals, gates, posts: Array(n).fill(posts) }),
        });
      }
      cases.push({
        name: `pair (${tag})`,
        layout: layoutOf("pair", { goals, gates, posts: [posts] }),
      });
      cases.push({
        name: `kiosk (${tag})`,
        layout: layoutOf("kiosk", { goals, gates, posts: [posts] }),
      });
    }
  }
}

describe("logic layout", () => {
  it("spreads centres evenly and caps their spacing", () => {
    expect(centres(0, 300, 3)).toEqual([50, 150, 250]);
    expect(centres(0, 1000, 2, 100)).toEqual([450, 550]);
    expect(centres(0, 10, 0)).toEqual([]);
  });

  for (const c of cases) {
    it(`keeps a ${c.name} on the frame, apart and big enough`, () => {
      const l = c.layout;
      const all: [string, Box][] = [];
      for (const bl of l.benches) {
        const list = controls(bl);
        for (const [name, b] of list) {
          expect(inside(b, l), `${name} inside`).toBe(true);
          all.push([`bench ${bl.index} ${name}`, b]);
        }
        expect(inside(bl.machine, l)).toBe(true);
        if (bl.card) {
          expect(inside(bl.card, l)).toBe(true);
          expect(overlaps(bl.card, bl.machine)).toBe(false);
        }
        // Touch sizes.
        expect(bl.hit * 2).toBeGreaterThanOrEqual(120);
        expect(bl.snap).toBeGreaterThanOrEqual(120);
        expect(Math.min(bl.reset.width, bl.reset.height)).toBeGreaterThanOrEqual(
          l.kind === "wall" ? 140 : 120,
        );
        for (const t of bl.trays) {
          for (const it of t.items) expect(it.size + 12).toBeGreaterThanOrEqual(120);
        }
        if (l.kind !== "wall") {
          expect(bl.child).toBeGreaterThanOrEqual(240);
          expect(bl.gateW).toBeGreaterThanOrEqual(240);
        } else {
          expect(bl.child).toBeGreaterThanOrEqual(200);
          expect(bl.gateW).toBeGreaterThanOrEqual(200);
        }
        // Enough room for the starting circuit and every card's solution.
        const child = bl.sockets.filter((s) => s.band === "child");
        const gates = bl.sockets.filter((s) => s.band === "adult");
        expect(child.length).toBeGreaterThanOrEqual(3);
        expect(gates.length).toBeGreaterThanOrEqual(4);
        expect(gates.length).toBeLessThanOrEqual(6);
        expect(child.length).toBeLessThanOrEqual(8);
        const st = bl.starter;
        expect(new Set([st.a, st.b, st.lamp]).size).toBe(3);
        for (const i of [st.a, st.b, st.lamp]) expect(bl.sockets[i]!.band).toBe("child");
        expect(st.and).not.toBe(st.or);
        for (const i of [st.and, st.or]) expect(bl.sockets[i]!.band).toBe("adult");
        expect(bl.goalSockets).toHaveLength(3);
        for (const i of bl.goalSockets) expect(bl.sockets[i]!.band).toBe("child");
        expect(bl.gateSockets).toHaveLength(gates.length);
        // Power lines run from each post to the machine's edge.
        for (const p of bl.posts) {
          const end = p.line[p.line.length - 1]!;
          const m = bl.machine;
          const onEdge = Math.abs(end.y - (m.y + m.height)) < 1 || Math.abs(end.x - m.x) < 1;
          expect(onEdge).toBe(true);
        }
      }
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          const [a, ab] = all[i]!;
          const [b, bb] = all[j]!;
          expect(overlaps(ab, bb), `${a} overlaps ${b}`).toBe(false);
        }
      }
      expect(inside(l.home, l)).toBe(true);
      for (const [name, b] of all) expect(overlaps(l.home, b), `home overlaps ${name}`).toBe(false);
    });
  }

  it("keeps everything on a pair clear of the seam", () => {
    for (const goals of [false, true]) {
      const l = layoutOf("pair", { goals, posts: [3] });
      const seam = l.seams[0]!;
      expect(seam).toBe(1080);
      for (const [name, b] of controls(l.benches[0]!)) {
        const clear = b.x + b.width <= seam - SEAM_KEEP || b.x >= seam + SEAM_KEEP;
        expect(clear, `${name} near the seam`).toBe(true);
      }
      expect(l.home.x >= seam + SEAM_KEEP || l.home.x + l.home.width <= seam - SEAM_KEEP).toBe(
        true,
      );
    }
  });

  it("puts children's pieces in the child band and gates above it", () => {
    for (const kind of ["wall", "pair"] as const) {
      for (const n of kind === "wall" ? [1, 2, 3] : [1]) {
        const l = layoutOf(kind, { benches: n });
        for (const bl of l.benches) {
          for (const [i, s] of bl.sockets.entries()) {
            const b = pieceBox(bl, i);
            if (s.band === "child") expect(b.y).toBeGreaterThanOrEqual(l.childTop);
            if (s.band === "adult") {
              expect(b.y + b.height).toBeLessThanOrEqual(l.childTop);
              expect(b.y).toBeGreaterThanOrEqual(l.adultTop);
            }
          }
          for (const p of bl.posts) {
            expect(p.port.y).toBeGreaterThan(l.adultTop);
            expect(p.port.y).toBeLessThan(l.childTop);
          }
          // The reset is out of children's reach but within adults'.
          expect(bl.reset.y + bl.reset.height).toBeLessThanOrEqual(l.childTop);
          expect(bl.reset.y).toBeGreaterThanOrEqual(l.adultTop);
          for (const t of bl.trays) {
            if (t.band === "child") expect(t.box.y).toBeGreaterThanOrEqual(l.childTop);
            else expect(t.box.y + t.box.height).toBeLessThanOrEqual(l.childTop);
          }
          // The machine is above the bench.
          const top = Math.min(...bl.posts.map((p) => p.body.y));
          expect(bl.machine.y + bl.machine.height).toBeLessThanOrEqual(top);
        }
      }
    }
  });

  it("gives each wall bench its own slot and machine, side by side", () => {
    for (const n of [1, 2, 3]) {
      const l = layoutOf("wall", { benches: n });
      expect(l.benches).toHaveLength(n);
      l.benches.forEach((bl, i) => {
        expect(bl.slot.x).toBeCloseTo((i * l.W) / n);
        expect(benchAt(l, bl.slot.x + bl.slot.width / 2)).toBe(i);
        expect(bl.machine.x).toBeGreaterThanOrEqual(bl.slot.x);
        expect(bl.machine.x + bl.machine.width).toBeLessThanOrEqual(bl.slot.x + bl.slot.width);
        for (const s of bl.sockets) {
          expect(s.x).toBeGreaterThan(bl.slot.x);
          expect(s.x).toBeLessThan(bl.slot.x + bl.slot.width);
        }
      });
    }
  });

  it("keeps ports of neighbouring sockets apart", () => {
    for (const l of cases.map((c) => c.layout)) {
      for (const bl of l.benches) {
        // Every port any piece could have in each socket: NOT has its input in the middle.
        const ports = bl.sockets.flatMap((s, i) =>
          s.band === "post"
            ? []
            : s.band === "child"
              ? portsAt(bl, "lamp", i, s.x, s.y)
              : [...portsAt(bl, "and", i, s.x, s.y), ...portsAt(bl, "not", i, s.x, s.y)],
        );
        const posts = bl.posts.map((p, i) => ({
          piece: 100 + i,
          pin: 0,
          x: p.port.x,
          y: p.port.y,
        }));
        const all = [...ports, ...posts];
        for (let i = 0; i < all.length; i++) {
          for (let j = i + 1; j < all.length; j++) {
            const a = all[i]!;
            const b = all[j]!;
            if (a.piece === b.piece) continue;
            expect(Math.hypot(a.x - b.x, a.y - b.y), `${l.kind} ports`).toBeGreaterThan(60);
          }
        }
      }
    }
  });
});
