import { describe, expect, it } from "vitest";
import { createRng } from "../../../src/core/rng";
import {
  createShow,
  FIRST_SHAKE,
  MOODS,
  RUN_SHAKES,
  SCENES,
  type SceneId,
  SHAKE_GAP,
  type Shake,
  type ShowOptions,
  SWAP_AFTER,
} from "../../../src/apps/snowglobe/show";

const CHANGES: ShowOptions = { scene: "changes", shake: "often" };

/** Every shake up to `until` seconds, read as the page would, step by step. */
const shakesUntil = (opts: ShowOptions, until: number, seed = "show") => {
  const show = createShow(createRng(seed), opts);
  const seen: Shake[] = [];
  let t = 0;
  while (t < until) {
    const s = show.next(t);
    seen.push(s);
    t = s.at;
  }
  return { show, seen };
};

describe("snowglobe show", () => {
  it("shakes first within half a minute or so, then every one to two minutes", () => {
    const { seen } = shakesUntil(CHANGES, 6 * 3600);
    expect(seen[0]!.at).toBeGreaterThanOrEqual(FIRST_SHAKE[0]);
    expect(seen[0]!.at).toBeLessThanOrEqual(FIRST_SHAKE[1]);
    for (let i = 1; i < seen.length; i++) {
      const gap = seen[i]!.at - seen[i - 1]!.at;
      expect(gap).toBeGreaterThanOrEqual(SHAKE_GAP.often[0]);
      expect(gap).toBeLessThanOrEqual(SHAKE_GAP.often[1]);
    }
  });

  it("shakes every three to five minutes when set to rarely", () => {
    const { seen } = shakesUntil({ scene: "changes", shake: "rarely" }, 6 * 3600);
    for (let i = 1; i < seen.length; i++) {
      const gap = seen[i]!.at - seen[i - 1]!.at;
      expect(gap).toBeGreaterThanOrEqual(SHAKE_GAP.rarely[0]);
      expect(gap).toBeLessThanOrEqual(SHAKE_GAP.rarely[1]);
    }
  });

  it("changes scene every three or four shakes, never to the same scene", () => {
    const { seen } = shakesUntil(CHANGES, 12 * 3600);
    let run = 0;
    let runs = 0;
    for (const s of seen) {
      run++;
      if (s.scene !== s.from.scene) {
        expect(s.swap).toBe(true);
        expect(run).toBeGreaterThanOrEqual(RUN_SHAKES[0]);
        expect(run).toBeLessThanOrEqual(RUN_SHAKES[1]);
        expect(s.strength).toBeGreaterThanOrEqual(1);
        run = 0;
        runs++;
      }
      expect(MOODS[s.scene]).toContain(s.mood);
    }
    expect(runs).toBeGreaterThan(50);
  });

  it("shows every scene in turn, each back within ten changes", () => {
    const { seen } = shakesUntil(CHANGES, 12 * 3600, "bag");
    const order: SceneId[] = [seen[0]!.from.scene];
    for (const s of seen) if (s.scene !== order[order.length - 1]) order.push(s.scene);
    expect(order.length).toBeGreaterThan(60);
    const last = new Map<SceneId, number>();
    order.forEach((scene, i) => {
      const before = last.get(scene);
      if (before !== undefined) expect(i - before).toBeLessThanOrEqual(10);
      last.set(scene, i);
    });
    expect(new Set(order)).toEqual(new Set(SCENES));
    // The first six are all different: the opening scene, then a full bag.
    expect(new Set(order.slice(0, SCENES.length)).size).toBe(SCENES.length);
  });

  it("changes the scene only at a shake's swap moment", () => {
    const show = createShow(createRng("moments"), CHANGES);
    const dt = 0.25;
    let prev = show.lookAt(0);
    let changes = 0;
    for (let t = dt; t < 4 * 3600; t += dt) {
      const look = show.lookAt(t);
      if (look.scene !== prev.scene || look.mood !== prev.mood) {
        const s = show.last(t)!;
        expect(s.swap).toBe(true);
        expect(t - s.at).toBeGreaterThanOrEqual(SWAP_AFTER - 1e-9);
        expect(t - s.at).toBeLessThan(SWAP_AFTER + dt + 1e-9);
        changes++;
      }
      prev = look;
    }
    expect(changes).toBeGreaterThan(10);
  });

  it("keeps a fixed scene, changing only its time of day", () => {
    const { seen } = shakesUntil({ scene: "lighthouse", shake: "often" }, 6 * 3600);
    const moods = new Set<string>();
    for (const s of seen) {
      expect(s.scene).toBe("lighthouse");
      expect(s.from.scene).toBe("lighthouse");
      moods.add(s.mood);
    }
    expect(moods.size).toBe(MOODS.lighthouse.length);
  });

  it("holds only a few shakes at a time, however long it runs", () => {
    const show = createShow(createRng("bounded"), CHANGES);
    let most = 0;
    for (let t = 0; t < 48 * 3600; t += 7) {
      show.lookAt(t);
      most = Math.max(most, show.held);
    }
    expect(most).toBeLessThanOrEqual(6);
  });

  it("plays the same show for the same seed", () => {
    const a = shakesUntil(CHANGES, 3600, "same").seen.map((s) => [s.at, s.scene, s.mood]);
    const b = shakesUntil(CHANGES, 3600, "same").seen.map((s) => [s.at, s.scene, s.mood]);
    expect(a).toEqual(b);
  });

  it("shakes now on request, into a chosen scene", () => {
    const show = createShow(createRng("now"), CHANGES);
    const start = show.lookAt(10).scene;
    const target = SCENES.find((s) => s !== start)!;
    const s = show.shakeNow(10, target);
    expect(s.at).toBe(10);
    expect(show.last(10)).toBe(s);
    expect(show.lookAt(10 + SWAP_AFTER / 2).scene).toBe(start);
    expect(show.lookAt(10 + SWAP_AFTER).scene).toBe(target);
    expect(show.next(10).at).toBeGreaterThanOrEqual(10 + SHAKE_GAP.often[0]);
    // A plain shake keeps the scene, unless its run of shakes is over.
    const again = show.shakeNow(200);
    expect(again.from.scene).toBe(target);
  });
});
