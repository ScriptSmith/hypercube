import type { Channel, PeerInfo } from "../../core/types";
import { createRemote, type Remote } from "./drive";
import { type Arbiter, createArbiter } from "./knobs";
import {
  decodeGlide,
  decodeKnob,
  decodeNote,
  decodePlate,
  fresh,
  GLIDE_HZ,
  HEARTBEAT_MS,
  KNOB_CODES,
  type PlateMsg,
  SPRINKLE_GAP_MS,
  TOPIC_GLIDE,
  TOPIC_KNOB,
  TOPIC_NOTE,
  TOPIC_PLATE,
  TOPIC_SPRINKLE,
} from "./wire";

/**
 * Who talks to whom on a bank. A touch frame sends its keys, glides and knobs to the screen on
 * its side (not the group's leader, which a corner would share) and nothing when there is none.
 * The screen keeps what it hears as drives that expire and knob claims where the last touch
 * wins, and reports its plate to the whole group.
 */
const sideOf = (p: PeerInfo) => p.side ?? 0;

export interface Uplink {
  /** The screen above this frame, if the roster lists one. */
  screen(): string | null;
  /**
   * Bring the screen up to date: `keys` ringing now (bank key and mode), `glides` held now (strip
   * and frequency). Changes go at once (glides at most GLIDE_HZ), and anything still on repeats
   * every HEARTBEAT_MS. `auto` marks bot play.
   */
  tick(
    now: number,
    clock: number,
    keys: readonly { key: number; mode: number }[],
    glides: readonly { strip: number; freq: number }[],
    auto: boolean,
  ): number;
  /**
   * A knob's state here (code from KNOB_CODES): its value, whether a finger holds it and when
   * that touch began on the shared clock. The next `tick` sends what changed: moves at most
   * GLIDE_HZ, a press or release at once, and a heartbeat every HEARTBEAT_MS while held.
   */
  knob(code: number, x: number, y: number, held: boolean, since: number): void;
  sprinkle(): void;
  /** Sent messages, for tests. */
  readonly sent: number;
  dispose(): void;
}

export const createUplink = (
  net: Channel,
  side: number,
  onPlate: (m: PlateMsg, from: string) => void,
): Uplink => {
  const keysSent = new Map<number, { mode: number; at: number }>();
  const glidesSent = new Map<number, { freq: number; at: number }>();
  interface KnobOut {
    x: number;
    y: number;
    held: boolean;
    since: number;
    sentX: number;
    sentY: number;
    sentHeld: boolean;
    sentAt: number;
  }
  const knobs = new Map<number, KnobOut>();
  let sent = 0;
  const screen = () =>
    net.peers().find((p) => p.role === "screen" && sideOf(p) === side && p.frame !== net.self)
      ?.frame ?? null;
  const off = net.on(TOPIC_PLATE, (data, from) => {
    if (from !== screen()) return;
    const m = decodePlate(data);
    if (m) onPlate(m, from);
  });
  return {
    screen,
    tick(now, clock, keys, glides, auto) {
      const to = screen();
      if (!to || !net.online) {
        keysSent.clear();
        glidesSent.clear();
        knobs.clear();
        return 0;
      }
      let n = 0;
      const send = (topic: string, data: unknown) => {
        net.send(topic, data, to);
        n++;
        sent++;
      };
      const t = Math.round(clock);
      for (const k of keys) {
        const prev = keysSent.get(k.key);
        if (!prev || prev.mode !== k.mode || now - prev.at >= HEARTBEAT_MS) {
          send(TOPIC_NOTE, { k: k.key, m: k.mode, on: true, t, a: auto });
          keysSent.set(k.key, { mode: k.mode, at: now });
        }
      }
      for (const [key, prev] of keysSent) {
        if (keys.some((k) => k.key === key)) continue;
        send(TOPIC_NOTE, { k: key, m: prev.mode, on: false, t, a: auto });
        keysSent.delete(key);
      }
      for (const g of glides) {
        const prev = glidesSent.get(g.strip);
        const moved =
          prev && Math.abs(prev.freq - g.freq) > 1e-4 && now - prev.at >= 1000 / GLIDE_HZ;
        if (!prev || moved || now - prev.at >= HEARTBEAT_MS) {
          send(TOPIC_GLIDE, {
            g: g.strip,
            f: Math.round(g.freq * 10000) / 10000,
            on: true,
            t,
            a: auto,
          });
          glidesSent.set(g.strip, { freq: g.freq, at: now });
        }
      }
      for (const [strip, prev] of glidesSent) {
        if (glides.some((g) => g.strip === strip)) continue;
        send(TOPIC_GLIDE, {
          g: strip,
          f: Math.round(prev.freq * 10000) / 10000,
          on: false,
          t,
          a: auto,
        });
        glidesSent.delete(strip);
      }
      for (const [c, k] of knobs) {
        const moved = k.x !== k.sentX || k.y !== k.sentY;
        const due =
          k.held !== k.sentHeld ||
          (moved && now - k.sentAt >= 1000 / GLIDE_HZ) ||
          (k.held && now - k.sentAt >= HEARTBEAT_MS);
        if (due) {
          const r = (v: number) => Math.round(v * 10000) / 10000;
          send(TOPIC_KNOB, {
            c,
            x: r(k.x),
            y: r(k.y),
            on: k.held,
            s: Math.min(t, Math.round(k.since)),
            t,
            a: auto,
          });
          k.sentX = k.x;
          k.sentY = k.y;
          k.sentHeld = k.held;
          k.sentAt = now;
        }
        if (!k.held && !k.sentHeld && k.x === k.sentX && k.y === k.sentY) knobs.delete(c);
      }
      return n;
    },
    knob(code, x, y, held, since) {
      if (!(code >= 0 && code < KNOB_CODES.length)) return;
      const k = knobs.get(code);
      if (k) {
        k.x = x;
        k.y = y;
        k.held = held;
        k.since = since;
      } else {
        knobs.set(code, {
          x,
          y,
          held,
          since,
          sentX: Number.NaN,
          sentY: Number.NaN,
          sentHeld: false,
          sentAt: Number.NEGATIVE_INFINITY,
        });
      }
    },
    sprinkle() {
      const to = screen();
      if (to && net.online) net.send(TOPIC_SPRINKLE, {}, to);
    },
    get sent() {
      return sent;
    },
    dispose() {
      off();
      keysSent.clear();
      glidesSent.clear();
      knobs.clear();
    },
  };
};

export interface Downlink {
  readonly remote: Remote;
  /** Who holds each knob: the last touch wins. */
  readonly knobs: Arbiter;
  /** Touch frames on this screen's side. */
  stations(): PeerInfo[];
  /** Send the plate report when it is due: every `every` ms, or `busyEvery` while `busy`. */
  report(now: number, msg: () => PlateMsg, busy?: boolean): void;
  /** Notes that people (not bots) turned on, since mounting. */
  readonly notes: number;
  /** When a knob message last arrived (local ms), or -Infinity. */
  readonly knobAt: number;
  dispose(): void;
}

export const createDownlink = (
  net: Channel,
  opts: {
    side: number;
    modeCount: number;
    /** Local ms. */
    now: () => number;
    /** Shared clock ms. */
    clock: () => number;
    every: number;
    busyEvery?: number;
    /** A person (not a bot) is playing. */
    onVisitor(): void;
    onSprinkle(): void;
  },
): Downlink => {
  const remote = createRemote();
  const knobs = createArbiter();
  let reportAt = Number.NEGATIVE_INFINITY;
  let sprinkleAt = Number.NEGATIVE_INFINITY;
  let knobAt = Number.NEGATIVE_INFINITY;
  let notes = 0;
  let known = new Set(net.peers().map((p) => p.frame));
  const stations = () => net.peers().filter((p) => p.role !== "screen" && sideOf(p) === opts.side);
  const below = (from: string) => stations().some((p) => p.frame === from);
  const offs = [
    net.on(TOPIC_NOTE, (data, from) => {
      const m = decodeNote(data);
      if (!m || !below(from) || m.m >= opts.modeCount || !fresh(m.t, opts.clock())) return;
      remote.note(from, m.k, m.m, m.on, opts.now());
      if (!m.a) {
        opts.onVisitor();
        if (m.on) notes++;
      }
    }),
    net.on(TOPIC_GLIDE, (data, from) => {
      const m = decodeGlide(data);
      if (!m || !below(from) || !fresh(m.t, opts.clock())) return;
      remote.glide(from, m.g, m.f, m.on, opts.now());
      if (!m.a) opts.onVisitor();
    }),
    net.on(TOPIC_KNOB, (data, from) => {
      const m = decodeKnob(data);
      if (!m || !below(from) || !fresh(m.t, opts.clock())) return;
      knobAt = opts.now();
      knobs.hear(KNOB_CODES[m.c]!, {
        from,
        x: m.x,
        y: m.y,
        held: m.on,
        since: m.s,
        at: opts.now(),
        human: !m.a,
      });
      if (!m.a) opts.onVisitor();
    }),
    net.on(TOPIC_SPRINKLE, (_data, from) => {
      const t = opts.now();
      if (!below(from) || t - sprinkleAt < SPRINKLE_GAP_MS) return;
      sprinkleAt = t;
      opts.onSprinkle();
    }),
    net.onPeers((peers) => {
      // A frame that left can't switch its notes off, so they stop now.
      const here = new Set(peers.map((p) => p.frame));
      for (const p of known) {
        if (here.has(p)) continue;
        remote.forget(p);
        knobs.forget(p);
      }
      known = here;
    }),
  ];
  return {
    remote,
    knobs,
    stations,
    report(now, msg, busy = false) {
      const every = busy ? (opts.busyEvery ?? opts.every) : opts.every;
      if (now - reportAt < every || !net.online) return;
      reportAt = now;
      net.send(TOPIC_PLATE, msg());
    },
    get notes() {
      return notes;
    },
    get knobAt() {
      return knobAt;
    },
    dispose() {
      for (const off of offs) off();
      remote.clear();
      knobs.clear();
    },
  };
};
