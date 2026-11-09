import { describe, expect, it } from "vitest";
import {
  BEACON_MS,
  MAX_QUEUE,
  SCREEN_GRACE_MS,
  TOTALS_EVERY_MS,
} from "../../../src/apps/ballpit/config";
import {
  createLink,
  decodeTotals,
  decodeVotes,
  type Link,
  TOPIC,
  type VoteMsg,
} from "../../../src/apps/ballpit/link";
import { readConfig } from "../../../src/apps/ballpit/config";
import manifest from "../../../src/apps/ballpit/manifest";
import type { PlanMsg } from "../../../src/apps/ballpit/plan";
import { PLAN_EVERY_MS, planOf } from "../../../src/apps/ballpit/plan";
import { slotAt } from "../../../src/apps/ballpit/schedule";
import { cleanOptionValues } from "../../../src/core/options";
import { createTally, type Tally } from "../../../src/apps/ballpit/tally";
import { createBus } from "./helpers";

const DAY = "2026-10-18";
const Q = "season";

interface Node {
  link: Link;
  tally: Tally;
  self: string;
  /** Announcements heard, and what this frame would announce. */
  plans: { msg: PlanMsg; from: string }[];
  mine: PlanMsg;
}

const setup = () => {
  const bus = createBus();
  let now = 0;
  const nodes = new Map<string, Node>();
  const add = (
    frame: string,
    info: { role?: "screen" | "station"; pos?: number; kind?: "screen" | "panel" },
  ) => {
    const net = bus.join({ frame, ...info });
    const tally = createTally(DAY);
    const node: Node = {
      link: null as unknown as Link,
      tally,
      self: frame,
      plans: [],
      mine: { q: ["season"], e: 0 },
    };
    node.link = createLink({
      net,
      isScreen: info.role === "screen",
      now: () => now,
      day: () => DAY,
      totals: () => ({
        d: DAY,
        q: Object.fromEntries(
          [Q, ...tally.questions()].map((id) => [id, tally.snapshot(id) ?? { g: 0, r: {} }]),
        ),
      }),
      onVotes(votes, from) {
        for (const v of votes) tally.apply(v.q, v.g, from, v.a, v.n);
      },
      plan: () => node.mine,
      onPlan(msg, from) {
        node.plans.push({ msg, from });
      },
      onTotals(msg) {
        let ahead = false;
        for (const [qid, snap] of Object.entries(msg.q)) {
          tally.merge(qid, snap);
          if (tally.ahead(qid, snap)) ahead = true;
        }
        return ahead;
      },
    });
    nodes.set(frame, node);
    return { node, net };
  };
  const vote = (frame: string, a: number) => {
    const n = nodes.get(frame)!;
    const r = n.tally.vote(Q, frame, a)!;
    const msg: VoteMsg = { q: Q, g: r.g, a, n: r.n, t: now + 500, u: 0.5, p: 0 };
    n.link.vote(msg);
  };
  const tick = (ms = 100) => {
    now += ms;
    for (const n of nodes.values()) n.link.tick();
  };
  return { bus, nodes, add, vote, tick, setNow: (t: number) => (now = t) };
};

describe("bank link", () => {
  it("shares votes between every frame, with a screen leading", () => {
    const s = setup();
    s.add("scr", { role: "screen", kind: "screen" });
    for (let i = 0; i < 4; i++) s.add(`p${i}`, { pos: i });
    for (let i = 0; i < 4; i++) for (let k = 0; k <= i; k++) s.vote(`p${i}`, i % 4);
    s.tick();
    for (const n of s.nodes.values()) {
      expect(n.tally.sums(Q)).toEqual([1, 2, 3, 4]);
      expect(n.link.isLeader()).toBe(n.self === "scr");
    }
  });

  it("has the leader announce its questions, and heeds only the leader's", () => {
    const s = setup();
    s.add("scr", { role: "screen", kind: "screen" });
    s.add("p0", { pos: 0 });
    s.add("p1", { pos: 1 });
    s.nodes.get("scr")!.mine = { q: ["pet"], e: 123_000 };
    s.nodes.get("p0")!.mine = { q: ["float"], e: 0 };
    s.tick();
    for (const id of ["p0", "p1"]) {
      expect(s.nodes.get(id)!.plans).toEqual([{ msg: { q: ["pet"], e: 123_000 }, from: "scr" }]);
    }
    // Panels never announce while the screen leads.
    expect(s.bus.log.filter((m) => m.topic === TOPIC.plan && m.from !== "scr")).toEqual([]);
    expect(s.nodes.get("scr")!.plans).toEqual([]);
    // Again at once on a change, otherwise every PLAN_EVERY_MS.
    s.nodes.get("scr")!.mine = { q: ["meet"], e: 0 };
    s.tick();
    expect(s.nodes.get("p1")!.plans.at(-1)!.msg.q).toEqual(["meet"]);
    const before = s.bus.log.filter((m) => m.topic === TOPIC.plan).length;
    for (let t = 0; t < PLAN_EVERY_MS * 2; t += 100) s.tick();
    const sent = s.bus.log.filter((m) => m.topic === TOPIC.plan).length - before;
    expect(sent).toBeGreaterThanOrEqual(2);
    expect(sent).toBeLessThanOrEqual(3);
  });

  it("never puts a custom question's words on the wire", () => {
    const words = {
      ask: "Which snack is best?",
      a1: "Apples",
      a2: "Popcorn",
      a3: "Carrots",
    };
    const cfg = readConfig(
      "one",
      cleanOptionValues({ question: "custom", ...words, p1: "apple" }, manifest.options),
    );
    const own = cfg.custom!;
    const s = setup();
    const scr = s.add("scr", { role: "screen", kind: "screen" }).node;
    s.add("p0", { pos: 0 });
    s.add("p1", { pos: 1 });
    scr.mine = planOf(slotAt(Date.UTC(2026, 9, 18), cfg));
    for (const n of s.nodes.values()) {
      for (let a = 0; a < 3; a++) {
        const r = n.tally.vote(own.id, n.self, a)!;
        n.link.vote({ q: own.id, g: r.g, a, n: r.n, t: 1, u: 0.5, p: 0 });
      }
    }
    for (let i = 0; i < 80; i++) s.tick();
    // Everyone heard the plan and counted every vote for the question, by its id alone.
    expect(s.nodes.get("p1")!.plans.at(-1)!.msg.q).toEqual([own.id]);
    for (const n of s.nodes.values()) expect(n.tally.sums(own.id)).toEqual([3, 3, 3]);
    expect(
      s.bus.log.some((m) => m.topic === TOPIC.totals && JSON.stringify(m.data).includes(own.id)),
    ).toBe(true);
    for (const m of s.bus.log) {
      const text = JSON.stringify(m.data);
      for (const w of Object.values(words)) expect(text, m.topic).not.toContain(w);
    }
  });

  it("batches a tick's votes into one message", () => {
    const s = setup();
    s.add("p0", { pos: 0 });
    s.add("p1", { pos: 1 });
    for (let k = 0; k < 10; k++) s.vote("p0", 1);
    s.tick();
    expect(s.bus.log.filter((m) => m.topic === TOPIC.votes && m.from === "p0").length).toBe(1);
    expect(s.nodes.get("p1")!.tally.sums(Q)).toEqual([0, 10, 0, 0]);
  });

  it("queues votes while the room is down and sends them when it is back", () => {
    const s = setup();
    s.add("p0", { pos: 0 });
    s.add("p1", { pos: 1 });
    s.bus.online = false;
    for (let k = 0; k < MAX_QUEUE + 30; k++) {
      s.vote("p0", 2);
      s.tick();
    }
    // Bounded.
    expect(s.nodes.get("p0")!.link.queued).toBe(MAX_QUEUE);
    s.bus.online = true;
    for (let i = 0; i < 4; i++) s.tick();
    expect(s.nodes.get("p0")!.link.queued).toBe(0);
    // The newest votes carry the highest counts, so nothing is lost even though old ones were dropped.
    expect(s.nodes.get("p1")!.tally.sums(Q)).toEqual([0, 0, MAX_QUEUE + 30, 0]);
  });

  it("catches up a frame that joins late, and a returning leader that missed votes", () => {
    const s = setup();
    s.add("scr", { role: "screen", kind: "screen" });
    s.add("p0", { pos: 0 });
    for (let k = 0; k < 5; k++) s.vote("p0", 0);
    s.tick();
    // A late frame hears the totals within the leader's next announcement.
    s.add("p1", { pos: 1 });
    for (let i = 0; i < TOTALS_EVERY_MS / 100 + 2; i++) s.tick();
    expect(s.nodes.get("p1")!.tally.sums(Q)).toEqual([5, 0, 0, 0]);

    // The screen reloads with nothing stored; the panels bring it back up to date.
    const fresh = createTally(DAY);
    s.nodes.get("scr")!.tally.reset(DAY);
    expect(fresh.total(Q)).toBe(0);
    for (let i = 0; i < 40; i++) s.tick();
    expect(s.nodes.get("scr")!.tally.sums(Q)).toEqual([5, 0, 0, 0]);
  });

  it("notices a screen that goes quiet within the grace period", () => {
    const s = setup();
    const { net } = s.add("scr", { role: "screen", kind: "screen" });
    s.add("p0", { pos: 0 });
    for (let i = 0; i < 20; i++) s.tick();
    expect(s.nodes.get("p0")!.link.screen()).toBe("scr");
    // The screen vanishes without a word: no more beacons.
    (net as unknown as { leave(): void }).leave();
    s.nodes.get("scr")!.link.dispose();
    let gone = -1;
    for (let t = 0; t < 10_000; t += 100) {
      s.tick();
      if (s.nodes.get("p0")!.link.screen() === null) {
        gone = t;
        break;
      }
    }
    expect(gone).toBeGreaterThan(SCREEN_GRACE_MS - BEACON_MS - 200);
    expect(gone).toBeLessThanOrEqual(SCREEN_GRACE_MS);
  });

  it("drops messages that are out of range, and anything marked as a bot's", () => {
    const ok = { q: Q, g: 0, a: 1, n: 1, t: 1, u: 0.5, p: 0 };
    expect(decodeVotes({ d: DAY, v: [{ ...ok, a: 9 }] })!.v).toEqual([]);
    expect(decodeVotes({ d: DAY, v: [{ ...ok, q: "nope" }] })!.v).toEqual([]);
    expect(decodeVotes({ d: "today", v: [] })).toBeNull();
    expect(decodeVotes({ d: DAY, v: [ok] })!.v).toEqual([ok]);
    // Older pages marked bots' presses and sent them with no count: never a vote now.
    expect(decodeVotes({ d: DAY, v: [{ ...ok, b: 1 }] })!.v).toEqual([]);
    expect(decodeVotes({ d: DAY, v: [{ ...ok, n: 0 }] })!.v).toEqual([]);
    expect(
      decodeVotes({
        d: DAY,
        v: Array.from({ length: 100 }, () => ok),
      })!.v.length,
    ).toBeLessThanOrEqual(32);
    expect(decodeTotals({ d: DAY, q: { [Q]: { g: 0, r: { a: [1, 2] } } } })!.q).toEqual({});
    expect(
      decodeTotals({ d: DAY, q: { [Q]: { g: 0, r: { a: [1, 2, 3, 4] } } }, k: { k: 5, n: 1 } }),
    ).toEqual({
      d: DAY,
      q: { [Q]: { g: 0, r: { a: [1, 2, 3, 4] } } },
      k: { k: 5, n: 1 },
    });
    expect(decodeTotals("nope")).toBeNull();
  });
});
