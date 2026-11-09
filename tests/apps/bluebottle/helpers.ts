import { type Board, freshSpec, makeBoard, type Spec } from "../../../src/apps/bluebottle/board";
import { type Config, readConfig } from "../../../src/apps/bluebottle/config";
import type { Density } from "../../../src/apps/bluebottle/config";
import { leaderOf } from "../../../src/core/net/channel";
import { createRng } from "../../../src/core/rng";
import type { Channel, FrameKind, PeerInfo, Rng, Role } from "../../../src/core/types";

export const rngOf = (seed: string | number): Rng => createRng(seed);

/** Frame geometries the app uses: panel, pair, wall, and banks of panels or pairs. */
export const SIZES: readonly { name: string; cols: number; rows: number; kid: number }[] = [
  { name: "panel", cols: 8, rows: 11, kid: 7 },
  { name: "pair", cols: 16, rows: 11, kid: 7 },
  { name: "wall", cols: 42, rows: 6, kid: 5 },
  { name: "bank3", cols: 24, rows: 11, kid: 7 },
  { name: "bank6", cols: 48, rows: 11, kid: 7 },
];

export const DENSITIES: readonly Density[] = ["easy", "normal", "hard"];

export const specOf = (
  cols: number,
  rows: number,
  kid: number,
  dens: Density,
  n = 1,
  b = 7,
): Spec => ({ ...freshSpec({ b, cols, rows, kid, dens, start: 0 }), n });

export const config = (over: Record<string, string | number | boolean> = {}): Config =>
  readConfig(over);

/** A board from a picture: `*` bluebottle, `o` opening, `.` sand. */
export const boardOf = (rows: readonly string[]): Board => {
  const cols = rows[0]!.length;
  const bottle = new Uint8Array(cols * rows.length);
  const openings: number[] = [];
  rows.forEach((line, r) => {
    for (let c = 0; c < cols; c++) {
      const ch = line[c];
      if (ch === "*") bottle[r * cols + c] = 1;
      if (ch === "o") openings.push(r * cols + c);
    }
  });
  return makeBoard(cols, rows.length, bottle, openings);
};

/** A random board of the given size with `k` bluebottles. */
export const randomBoard = (rng: Rng, cols: number, rows: number, k: number): Board => {
  const bottle = new Uint8Array(cols * rows);
  let placed = 0;
  while (placed < k) {
    const i = rng.int(cols * rows);
    if (!bottle[i]) {
      bottle[i] = 1;
      placed++;
    }
  }
  return makeBoard(cols, rows, bottle, []);
};

export interface BusFrame {
  info: PeerInfo;
  channel: Channel;
}

/**
 * An in-memory group for controller tests. Messages are queued and delivered by `flush()`,
 * optionally shuffled, so tests can reorder and delay them.
 */
export interface Bus {
  join(frame: string, role: Role, pos: number, kind?: FrameKind): Channel;
  leave(frame: string): void;
  /** Deliver everything queued (and anything sent while delivering), up to `rounds` passes. */
  flush(rounds?: number): void;
  /** Drop everything queued between two frames, both ways. */
  cut(a: string, b: string): void;
  heal(a: string, b: string): void;
  shuffle: Rng | null;
  sent: { topic: string; from: string; to: string | undefined }[];
}

export const createBus = (): Bus => {
  const peers = new Map<string, PeerInfo>();
  const handlers = new Map<string, Map<string, Set<(data: unknown, from: string) => void>>>();
  const cuts = new Set<string>();
  let queue: { to: string; topic: string; data: string; from: string }[] = [];
  const pair = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const bus: Bus = {
    shuffle: null,
    sent: [],
    join(frame, role, pos, kind) {
      peers.set(frame, {
        frame,
        app: "bluebottle",
        group: "main",
        kind: kind ?? (role === "screen" ? "screen" : "panel"),
        role,
        pos,
      });
      handlers.set(frame, new Map());
      const channel: Channel = {
        get online() {
          return peers.has(frame);
        },
        self: frame,
        peers: () => (peers.has(frame) ? [...peers.values()] : []),
        leader: () => leaderOf([...peers.values()]),
        send(topic, data, to) {
          if (!peers.has(frame)) return;
          bus.sent.push({ topic, from: frame, to });
          if (bus.sent.length > 5000) bus.sent.splice(0, 2500);
          const text = JSON.stringify(data);
          const targets = to !== undefined ? [to] : [...peers.keys()].filter((p) => p !== frame);
          for (const t of targets) {
            if (!peers.has(t) || cuts.has(pair(frame, t))) continue;
            queue.push({ to: t, topic, data: text, from: frame });
          }
        },
        on(topic, cb) {
          const map = handlers.get(frame);
          if (!map) return () => {};
          let set = map.get(topic);
          if (!set) {
            set = new Set();
            map.set(topic, set);
          }
          set.add(cb);
          return () => set.delete(cb);
        },
        onPeers: () => () => {},
      };
      return channel;
    },
    leave(frame) {
      peers.delete(frame);
      handlers.delete(frame);
      queue = queue.filter((m) => m.to !== frame && m.from !== frame);
    },
    flush(rounds = 50) {
      for (let r = 0; r < rounds && queue.length > 0; r++) {
        const batch = queue;
        queue = [];
        if (bus.shuffle) {
          for (let i = batch.length - 1; i > 0; i--) {
            const j = bus.shuffle.int(i + 1);
            [batch[i], batch[j]] = [batch[j]!, batch[i]!];
          }
        }
        for (const m of batch) {
          if (cuts.has(pair(m.from, m.to))) continue;
          for (const cb of handlers.get(m.to)?.get(m.topic) ?? []) cb(JSON.parse(m.data), m.from);
        }
      }
    },
    cut(a, b) {
      cuts.add(pair(a, b));
      queue = queue.filter((m) => pair(m.from, m.to) !== pair(a, b));
    },
    heal(a, b) {
      cuts.delete(pair(a, b));
    },
  };
  return bus;
};
