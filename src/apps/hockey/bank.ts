/**
 * A touch frame in a bank: it plays its own table and keeps the screen above informed.
 *
 * - Every frame streams a small view of its table to the screen about 12 times a second, so
 *   the screen can show every game below it.
 * - In defence the top of the rink opens onto the screen's deck while a round is on: pucks
 *   that leave the top are handed up, and pucks the deck drops come in at the top. The deck
 *   counts the team's waves and sends the count back. With no screen the top stays shut.
 */
import type { Channel, Clock, FrameKind } from "../../core/types";
import { apply, invert } from "./layout";
import { mergeTheirs } from "./match";
import type { Table } from "./table";
import {
  decodeHandoff,
  encodeHandoff,
  encodeView,
  TOPIC_DECK,
  TOPIC_DOWN,
  TOPIC_UP,
  TOPIC_VIEW,
} from "./view";

/** Views go out this often (about 12 a second). */
export const VIEW_MS = 80;
/** A puck dropping from the deck appears this long after it leaves it. */
export const DROP_MS = 220;

export interface BankDeps {
  net: Channel;
  clock: Clock;
  table: Table;
  /** Frame size in venue px and kind. */
  frame: () => { width: number; height: number; kind: FrameKind };
  pos: number;
  count: number;
}

export interface BankLink {
  /** A screen is live in the group. */
  screen(): boolean;
  tick(now: number, local: number): void;
  dispose(): void;
}

export const createBankLink = (deps: BankDeps): BankLink => {
  const { net, table, pos, count } = deps;
  /** Exchanges since the last goal: hits by alternating sides. */
  let rally = 0;
  let lastHitter = -1;
  let lastView = -Infinity;
  /** The deck's wave count, and what it was when this frame's round began. */
  let deckWaves = 0;
  let wavesAtStart = 0;
  let lastPhase = table.match.phase;

  const screenId = () => net.peers().find((p) => p.role === "screen")?.frame ?? null;

  const offTable = table.on((e) => {
    if (e.type === "hit") {
      if (e.side !== lastHitter) rally++;
      lastHitter = e.side;
    } else if (e.type === "goal" || e.type === "lost") {
      rally = 0;
      lastHitter = -1;
    } else if (e.type === "exit" && table.rules === "defence") {
      const lane = e.lane;
      const params = lane.spec.params;
      const to = screenId();
      if (!to) {
        // The screen has gone: the open top acts as a wall and the puck drops straight back.
        table.arrive(lane, {
          id: -1,
          end: 1,
          y: e.puck.y,
          vx: -Math.abs(e.puck.vx),
          vy: e.puck.vy,
          spin: e.puck.spin,
          sent: deps.clock.now(),
          at: deps.clock.now(),
        });
        return;
      }
      const at = apply(lane.spec.toVenue, e.puck.x, e.puck.y);
      net.send(
        TOPIC_UP,
        encodeHandoff({
          pos,
          u: at.x / deps.frame().width,
          vx: e.puck.vx / params.maxPuck,
          vy: e.puck.vy / params.maxPuck,
        }),
        to,
      );
    }
  });

  const offs = [
    net.on(TOPIC_DOWN, (data) => {
      const h = decodeHandoff(data);
      const lane = table.lanes[0];
      if (!h || h.pos !== pos || !lane) return;
      const params = lane.spec.params;
      const top = lane.spec.rect.y;
      const y = apply(invert(lane.spec.toVenue), h.u * deps.frame().width, top).y;
      const now = deps.clock.now();
      const ok = table.arrive(lane, {
        id: -1,
        end: 1,
        y: Math.min(params.width - params.puckR, Math.max(params.puckR, y)),
        vx: -Math.max(0.1, h.vx) * params.maxPuck,
        vy: h.vy * params.maxPuck,
        spin: 0,
        sent: now,
        at: now + DROP_MS,
      });
      const to = screenId();
      // No room on this rink: send it straight back up.
      if (!ok && to) net.send(TOPIC_UP, encodeHandoff({ ...h, pos }), to);
    }),
    net.on(TOPIC_DECK, (data) => {
      const w = (data as { w?: unknown } | null)?.w;
      if (typeof w === "number" && Number.isInteger(w) && w >= 0 && w < 100_000) deckWaves = w;
    }),
  ];

  return {
    screen: () => screenId() !== null,
    tick(now, local) {
      const m = table.match;
      if (m.phase !== lastPhase) {
        if (m.phase === "play") wavesAtStart = deckWaves;
        if (m.phase === "attract") {
          rally = 0;
          lastHitter = -1;
        }
        lastPhase = m.phase;
      }
      // Waves the team clears on the deck count for this frame's round.
      if (table.rules === "defence" && m.phase === "play" && screenId()) {
        mergeTheirs(m, [Math.max(0, deckWaves - wavesAtStart), 0]);
      }
      if (local - lastView < VIEW_MS) return;
      lastView = local;
      const to = screenId();
      if (to) net.send(TOPIC_VIEW, encodeView(table, deps.frame(), pos, count, rally, now), to);
    },
    dispose() {
      offTable();
      for (const off of offs) off();
    },
  };
};
