/**
 * Connects a table to the platform's player stations: one station per seat that people can
 * take, one StationSet per table (so starting one table's match never starts another's).
 *
 * The flow: a person calibrates and presses Start, the table counts down, and when play begins
 * every empty seat gets a bot so the person has a full game. A person who leaves is replaced by
 * a bot while anyone else is still playing; when nobody is, the table goes back to its attract
 * rally. Touching a bot's seat takes it over through the usual calibration. In defence nobody
 * fills an empty seat: its slot seals instead.
 *
 * The players' calibrated bands are the playing canvas: when a match starts (and when someone
 * joins one) each lane is fitted inside the band its people share.
 */
import { commonBand } from "../../core/stations";
import type { Station, StationSet, Stations } from "../../core/types";
import { BOT_COUNTDOWN_MS, COUNTDOWN_MS, OVER_MS } from "./config";
import type { Band } from "./layout";
import type { Player, Table } from "./table";

/** A seat a person left is given to a bot after this long, if the match goes on. */
export const REFILL_MS = 3000;
/** Bots kept for testing (`bots=`) wait this long after a seat empties before taking it. */
export const TEST_RECLAIM_MS = 8000;
/**
 * Seats without the platform's play timeout (versus) end after this long untouched while a
 * puck is on this frame. Time with every puck on the other frame doesn't count: a goalie may
 * rightly wait that out.
 */
export const QUIET_MS = 30_000;

export interface Seat {
  station: Station;
  player: Player;
  /** Claimed for testing (`bots=`) rather than to fill in for a missing person. */
  test: boolean;
  /** Local ms when the station last went idle. */
  idleSince: number;
  /** Local ms of the last touch steering this seat (set by the controls). */
  touched: number;
  /** Ms untouched while a puck was in play here, for seats the app times out itself. */
  quiet: number;
}

export interface LobbyOptions {
  table: Table;
  stations: Stations;
  /** Stage px per venue px. */
  unit: number;
  /** A player's colour by palette index (`PlayerSpec.hue`). */
  colorOf(hue: number): string;
  /** Seats this table keeps filled with bots for testing. */
  testBots: number;
  /** A fresh match id and start time. Versus routes this through the link. */
  newMatch(now: number, botsOnly: boolean): { id: string; startAt: number };
  /** Versus: whether the other frame has people or test bots in the match. */
  remoteKeeps?(): boolean;
  /** Passed to every station; 0 means this lobby ends idle players itself (QUIET_MS). */
  playTimeout?: number;
  /** Bots take empty seats once a match with people starts. Off in defence. Default true. */
  fill?: boolean;
  /**
   * Fit the table's lanes inside these bands (venue px, by lane id), or back to the full
   * reach when null. Called when a match starts and when someone joins one.
   */
  fit?(bands: Readonly<Record<string, Band>> | null): void;
}

export interface Lobby {
  readonly seats: readonly Seat[];
  /** People at this table's seats (calibrating, waiting or playing). */
  humans(): number;
  /** Whether this frame wants the current match kept going. */
  keeps(): boolean;
  /** `now` is shared clock ms, `local` is performance.now(). */
  tick(now: number, local: number): void;
  reset(now: number): void;
  dispose(): void;
}

const isIdle = (s: Station) => s.state === "idle";

export const createLobby = (opts: LobbyOptions): Lobby => {
  const { table, unit } = opts;
  const fill = opts.fill !== false;
  const withStations = table.players.filter((p) => p.spec.station !== null);
  const set: StationSet | null =
    withStations.length > 0
      ? opts.stations.define(
          withStations.map((p) => {
            const r = p.spec.station!;
            return {
              id: p.spec.id,
              rect: {
                x: r.x * unit,
                y: r.y * unit,
                width: r.width * unit,
                height: r.height * unit,
              },
              color: opts.colorOf(p.spec.hue),
              resetCorner: p.spec.resetCorner,
              ...(opts.playTimeout === undefined ? {} : { playTimeout: opts.playTimeout }),
            };
          }),
        )
      : null;
  const seats: Seat[] = set
    ? set.list.map((station, i) => ({
        station,
        player: withStations[i]!,
        test: false,
        idleSince: -Infinity,
        touched: -Infinity,
        quiet: 0,
      }))
    : [];
  const seatOf = (s: Station) => seats.find((seat) => seat.station === s);
  /** Stations whose Start was pressed (or a bot claimed) and that are not playing yet. */
  const waiting = new Set<Station>();
  let local = 0;
  let lastLocal = 0;

  const humans = () => seats.filter((s) => !s.station.bot && !isIdle(s.station)).length;
  const testing = () => seats.some((s) => s.test && s.station.bot && !isIdle(s.station));
  const keeps = () => humans() > 0 || testing();
  const matchHasPeople = () => humans() > 0 || (opts.remoteKeeps?.() ?? false);

  const startCountdown = (now: number) => {
    const botsOnly = humans() === 0 && !(opts.remoteKeeps?.() ?? false);
    const m = opts.newMatch(now, botsOnly);
    table.countdown(now, m.id, m.startAt);
    refit();
  };

  const fillEmpty = (olderThan: number) => {
    for (const seat of seats) {
      if (isIdle(seat.station) && local - seat.idleSince >= olderThan) {
        seat.station.claimForBot();
      }
    }
  };

  const claimTestBots = () => {
    let have = seats.filter((s) => s.test && !isIdle(s.station)).length;
    for (const seat of seats) {
      if (have >= opts.testBots) break;
      if (isIdle(seat.station) && local - seat.idleSince >= TEST_RECLAIM_MS) {
        seat.test = true;
        seat.station.claimForBot();
        have++;
      }
    }
  };

  /** End people who have stopped playing (only for stations without the platform timeout). */
  const endQuiet = (dt: number) => {
    if (opts.playTimeout !== 0) return;
    const puckHere = table.lanes.some((l) => l.pucks.some((p) => p.live));
    for (const seat of seats) {
      const st = seat.station;
      if (st.state !== "playing" || st.bot || local - seat.touched < 500) {
        seat.quiet = 0;
        continue;
      }
      if (puckHere) seat.quiet += dt;
      if (seat.quiet >= QUIET_MS) {
        seat.quiet = 0;
        st.end();
      }
    }
  };

  /** The venue band each lane's people share, from the seats with a person's confirmed band. */
  const bands = (): Record<string, Band> | null => {
    const byLane = new Map<string, Station[]>();
    for (const seat of seats) {
      const st = seat.station;
      if (!st.band || st.bot || (st.state !== "ready" && st.state !== "playing")) continue;
      const id = seat.player.lane.spec.id;
      byLane.set(id, [...(byLane.get(id) ?? []), st]);
    }
    if (byLane.size === 0) return null;
    const out: Record<string, Band> = {};
    for (const [id, list] of byLane) {
      const shared = commonBand(list);
      if (shared) out[id] = { top: shared.top / unit, bottom: shared.bottom / unit };
    }
    return out;
  };

  // The app skips fits that change nothing, so these can be called freely.
  const refit = () => opts.fit?.(bands());
  const unfit = () => opts.fit?.(null);

  const endSeats = (which: (s: Seat) => boolean) => {
    for (const seat of seats) if (which(seat)) seat.station.end();
  };

  const offs = set
    ? [
        set.on("ready", (s) => {
          waiting.add(s);
          if (table.match.phase === "play") {
            set.startReady();
            if (!s.bot) refit();
          }
        }),
        set.on("start", (s) => {
          waiting.delete(s);
          const seat = seatOf(s);
          if (!seat) return;
          table.setHuman(seat.player, !s.bot);
          table.setManned(seat.player, true);
        }),
        set.on("end", (s) => {
          waiting.delete(s);
          const seat = seatOf(s);
          if (!seat) return;
          seat.test = false;
          seat.idleSince = local;
          table.setHuman(seat.player, false);
          table.setManned(seat.player, false);
        }),
      ]
    : [];

  return {
    seats,
    humans,
    keeps,
    tick(now, localNow) {
      const dt = lastLocal > 0 ? Math.min(1000, localNow - lastLocal) : 0;
      lastLocal = localNow;
      local = localNow;
      const m = table.match;
      switch (m.phase) {
        case "attract":
          if (opts.testBots > 0) claimTestBots();
          if (waiting.size > 0) startCountdown(now);
          break;
        case "countdown":
          // Everyone who started it has left again: back to the rally.
          if (!matchHasPeople() && !testing() && waiting.size === 0) {
            table.attract(now);
            unfit();
            break;
          }
          if (now < m.startAt) break;
          if (matchHasPeople() && fill) fillEmpty(0);
          set?.startReady();
          refit();
          table.play(now);
          break;
        case "play":
          if (opts.testBots > 0) claimTestBots();
          if (!matchHasPeople() && !testing()) {
            endSeats((s) => !isIdle(s.station));
            table.attract(now);
            unfit();
            break;
          }
          endQuiet(dt);
          if (matchHasPeople() && fill) fillEmpty(REFILL_MS);
          break;
        case "over":
          if (now - m.since < OVER_MS) break;
          // Back to the lobby: the players' turn is over. Anyone already waiting starts next.
          endSeats((s) => s.station.state === "playing");
          table.attract(now);
          unfit();
          if (waiting.size > 0) startCountdown(now);
          break;
      }
    },
    reset(now) {
      endSeats((s) => !isIdle(s.station));
      waiting.clear();
      for (const seat of seats) seat.idleSince = local;
      table.attract(now);
      unfit();
    },
    dispose() {
      for (const off of offs) off();
      set?.dispose();
    },
  };
};

/** Countdown length for a new match. */
export const countdownMs = (botsOnly: boolean): number =>
  botsOnly ? BOT_COUNTDOWN_MS : COUNTDOWN_MS;
