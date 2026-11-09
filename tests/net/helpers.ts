import { vi } from "vitest";
import { createFakeNet, type FakeNet } from "../../src/core/net/fake";
import type { Timing } from "../../src/core/net/hub";
import { createRoom } from "../../src/core/net/room";
import { createRng } from "../../src/core/rng";
import type { PeerInfo, Room } from "../../src/core/types";

export const info = (frame: string, extra: Partial<PeerInfo> = {}): PeerInfo => ({
  frame,
  app: "idle",
  group: "g",
  kind: "panel",
  role: "station",
  pos: 0,
  ...extra,
});

export interface World {
  net: FakeNet;
  rooms: Map<string, Room>;
  /** Start a frame named `name`. Its local clock runs `skew` ms ahead of real time. */
  join(name: string, extra?: Partial<PeerInfo>, skew?: number, hubEligible?: boolean): Room;
  room(name: string): Room;
  /** Rooms that are still open and are the hub. */
  hubs(): string[];
  /** Close every open room. */
  closeAll(): void;
}

export const createWorld = (token = "test-room", timing: Partial<Timing> = {}): World => {
  const net = createFakeNet();
  const rooms = new Map<string, Room>();
  const closed = new Set<string>();
  const world: World = {
    net,
    rooms,
    join(name, extra = {}, skew = 0, hubEligible = true) {
      const room = createRoom(
        {
          room: token,
          self: info(name, extra),
          signalling: "public",
          transport: "peer",
          hubEligible,
        },
        {
          transport: net.transport(name),
          now: () => Date.now() + skew,
          random: createRng(`${token}:${name}`).next,
          timing,
        },
      );
      const close = room.close.bind(room);
      room.close = () => {
        closed.add(name);
        close();
      };
      rooms.set(name, room);
      return room;
    },
    room(name) {
      const r = rooms.get(name);
      if (!r) throw new Error(`no room ${name}`);
      return r;
    },
    hubs: () => [...rooms].filter(([n, r]) => !closed.has(n) && r.isHub).map(([n]) => n),
    closeAll() {
      for (const [name, room] of rooms) if (!closed.has(name)) room.close();
    },
  };
  return world;
};

export const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

export const frames = (room: Room): string[] => room.roster().map((e) => e.frame);
