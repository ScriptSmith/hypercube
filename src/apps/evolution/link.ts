/**
 * A touch frame's side of a bank. It listens for its screen's beacon, sends each of its ponds to
 * that screen every 2 s (and, the first time it hears a screen, the ancestors it remembers), and
 * trades migrants with the frames either side of it. Nothing waits on the network: with no
 * screen the frame draws its own tree, and a migrant with nobody to receive it swims back.
 */
import type { Channel, PeerInfo } from "../../core/types";
import { POND_EVERY_MS, SCREEN_GRACE_MS } from "./config";
import type { NodeRec } from "./lineage";
import type { Layout } from "./layout";
import type { Migrant, World, WorldEvent } from "./world";
import {
  decodeBeacon,
  decodeMigrant,
  encodeHist,
  encodeMigrant,
  encodePond,
  HIST_CHUNK,
  type IslandMsg,
  TOPIC,
} from "./wire";

/** Deaths remembered per pond between messages. */
const MAX_DEAD = 120;

export interface LinkOpts {
  net: Channel;
  side: number;
  pos: number;
  count: number;
  world: World;
  layout(): Layout;
  /** Shared-clock ms. */
  clock(): number;
}

export interface Link {
  /** The screen above, while its beacons keep coming. `now` is local ms. */
  screen(now: number): string | null;
  /** Note the world's events (deaths to report). */
  note(events: readonly WorldEvent[]): void;
  tick(now: number): void;
  outside(pond: number, edge: -1 | 1): boolean;
  emigrate(pond: number, edge: -1 | 1, m: Migrant): boolean;
  readonly sent: number;
  readonly migrants: { out: number; in: number };
  dispose(): void;
}

const sideOf = (p: PeerInfo) => p.side ?? 0;

export const createLink = (o: LinkOpts): Link => {
  const { net, side, world } = o;
  const epoch = (Math.random() * 0xffffffff) >>> 0;
  const heard = new Map<string, number>();
  const dead: { id: number; t: number }[][] = world.ponds.map(() => []);
  let sentAt = Number.NEGATIVE_INFINITY;
  let sent = 0;
  let histTo: string | null = null;
  const migrants = { out: 0, in: 0 };

  const isScreen = (from: string) => {
    const p = net.peers().find((x) => x.frame === from);
    return !!p && p.role === "screen" && sideOf(p) === side;
  };

  const neighbour = (dpos: number): string | null => {
    const want = o.pos + dpos;
    if (want < 0) return null;
    for (const p of net.peers()) {
      if (p.frame === net.self || p.role === "screen" || sideOf(p) !== side) continue;
      if (p.pos === want) return p.frame;
    }
    return null;
  };

  const offs = [
    net.on(TOPIC.beacon, (data, from) => {
      const b = decodeBeacon(data);
      if (!b || b.side !== side || !isScreen(from)) return;
      heard.set(from, performance.now());
      if (heard.size > 4) heard.delete(heard.keys().next().value!);
    }),
    net.on(TOPIC.migrant, (data, from) => {
      const m = decodeMigrant(data);
      if (!m) return;
      const peer = net.peers().find((p) => p.frame === from);
      if (!peer || peer.role === "screen" || sideOf(peer) !== side) return;
      // From the left neighbour it comes in at our left edge, into our first pond.
      if (m.edge < 0 ? peer.pos !== o.pos - 1 : peer.pos !== o.pos + 1) return;
      const pond = m.edge < 0 ? 0 : world.ponds.length - 1;
      if (
        world.immigrate(pond, m.edge, {
          fish: m.fish,
          age: m.age,
          life: m.life,
          y: m.y,
          chain: m.chain,
        })
      ) {
        migrants.in++;
      }
    }),
  ];

  const screen = (now: number): string | null => {
    let best: string | null = null;
    let at = Number.NEGATIVE_INFINITY;
    for (const [frame, t] of heard) {
      if (now - t > SCREEN_GRACE_MS || t <= at) continue;
      best = frame;
      at = t;
    }
    return best;
  };

  const islandsNow = (): IslandMsg[] => {
    const l = o.layout();
    return world.ponds.map((p, i) => {
      const pl = l.ponds[i]!;
      const list = p.fish
        .filter((f) => f.state !== "dying")
        .map((f) => ({ f, order: world.lineage.get(f.id)?.order ?? 0 }))
        .sort((a, b) => a.order - b.order || a.f.id - b.f.id)
        .map(({ f }): NodeRec => ({ id: f.id, parent: f.parent, born: f.born, genes: f.genes }));
      const d = dead[i]!.splice(0);
      return {
        island: p.spec.island,
        floor: p.floor,
        u0: Math.max(0, pl.tips[0] / l.width),
        u1: Math.min(1, pl.tips[1] / l.width),
        fish: list,
        dead: d,
      };
    });
  };

  const sendHistory = (to: string) => {
    const t = o.clock();
    const nodes: NodeRec[] = [];
    for (const n of world.lineage.nodes()) {
      if (n.died !== null) nodes.push({ id: n.id, parent: n.parent, born: n.born, genes: n.genes });
    }
    nodes.sort((a, b) => a.born - b.born);
    for (let i = 0; i < nodes.length; i += HIST_CHUNK) {
      net.send(TOPIC.hist, encodeHist({ epoch, t, nodes: nodes.slice(i, i + HIST_CHUNK) }), to);
    }
  };

  return {
    screen,
    note(events) {
      for (const { pond, e } of events) {
        if (e.kind !== "catch" && e.kind !== "death") continue;
        const list = dead[pond];
        if (!list) continue;
        list.push({ id: e.fish.id, t: o.clock() });
        if (list.length > MAX_DEAD) list.shift();
      }
    },
    tick(now) {
      if (!net.online) return;
      const to = screen(now);
      if (!to) {
        histTo = null;
        // Deaths with nobody to tell are forgotten; the next screen starts from what lives.
        for (const d of dead) if (d.length > MAX_DEAD / 2) d.splice(0, d.length - MAX_DEAD / 2);
        return;
      }
      if (histTo !== to) {
        histTo = to;
        sentAt = Number.NEGATIVE_INFINITY;
        sendHistory(to);
      }
      if (now - sentAt < POND_EVERY_MS - 4) return;
      sentAt = now;
      const t = o.clock();
      const msg = encodePond({
        epoch,
        t,
        pos: o.pos,
        count: Math.max(o.count, o.pos + 1),
        ponds: world.ponds.length,
        islands: islandsNow(),
      });
      net.send(TOPIC.pond, msg, to);
      sent++;
    },
    outside(pond, edge) {
      if (!net.online) return false;
      if (edge < 0 && pond !== 0) return false;
      if (edge > 0 && pond !== world.ponds.length - 1) return false;
      return neighbour(edge) !== null;
    },
    emigrate(pond, edge, m) {
      if (!net.online) return false;
      const to = neighbour(edge);
      if (!to) return false;
      const island = world.ponds[pond]!.spec.island + edge;
      net.send(
        TOPIC.migrant,
        encodeMigrant({
          t: o.clock(),
          to: Math.max(0, island),
          edge: edge < 0 ? 1 : -1,
          y: m.y,
          age: m.age,
          life: m.life,
          fish: m.fish,
          chain: m.chain,
        }),
        to,
      );
      migrants.out++;
      return true;
    },
    get sent() {
      return sent;
    },
    migrants,
    dispose() {
      for (const off of offs) off();
      heard.clear();
    },
  };
};
