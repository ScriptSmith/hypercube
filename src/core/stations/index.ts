import type { InputHandle } from "../input";
import type { FrameInfo, Pointer, Station, StationSet, Stations, StationSpec, Ui } from "../types";
import {
  initialStation,
  MIN_BAND_VENUE_PX,
  STATION_TIMEOUTS,
  type StationEmit,
  type StationEvent,
  type StationGeometry,
  type StationModel,
  type StationTimeouts,
  stepStation,
} from "./machine";
import { trackMinBand } from "./common";
import { createStationView, type StationView } from "./view";

export { commonBand } from "./common";
export {
  adjustBand,
  type Band,
  MIN_BAND_VENUE_PX,
  reachBand,
  sanitizeBand,
  STATION_TIMEOUTS,
  type StationTimeouts,
} from "./machine";

export interface StationsDeps {
  root: HTMLElement;
  frame: () => FrameInfo;
  input: InputHandle;
  ui: Ui;
  /** Overrides for STATION_TIMEOUTS, mainly for tests. */
  timeouts?: Partial<StationTimeouts>;
}

export interface StationsHandle extends Stations {
  dispose(): void;
}

interface Entry {
  spec: StationSpec;
  model: StationModel;
  view: StationView;
  station: Station;
}

const inside = (spec: StationSpec, x: number, y: number) =>
  x >= spec.rect.x &&
  x < spec.rect.x + spec.rect.width &&
  y >= spec.rect.y &&
  y < spec.rect.y + spec.rect.height;

export const createStations = (deps: StationsDeps): StationsHandle => {
  const sets = new Set<StationSet>();
  const timeouts: StationTimeouts = { ...STATION_TIMEOUTS, ...deps.timeouts };

  const define = (specs: StationSpec[]): StationSet => {
    const layer = document.createElement("div");
    layer.className = "hc-stations";
    layer.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:2;";
    deps.root.append(layer);

    const listeners: Record<StationEmit, Set<(s: Station) => void>> = {
      ready: new Set(),
      start: new Set(),
      end: new Set(),
    };
    let timer = 0;
    let timerAt = Infinity;
    let disposed = false;
    const now = () => performance.now();

    const geometry = (spec: StationSpec): StationGeometry => {
      const f = deps.frame();
      return {
        rect: spec.rect,
        calibrate: spec.calibrate !== false,
        minBand: MIN_BAND_VENUE_PX * f.unit,
        reachTop: f.reachTop.adult,
        playTimeout: spec.playTimeout,
      };
    };

    const emit = (event: StationEmit, s: Station) => {
      for (const cb of listeners[event]) {
        try {
          cb(s);
        } catch (err) {
          console.error(`[stations] ${event} listener failed`, err);
        }
      }
    };

    const tick = () => {
      timer = 0;
      timerAt = Infinity;
      for (const e of entries) send(e, { type: "tick" });
      schedule();
    };

    const schedule = () => {
      if (disposed) return;
      let next = Infinity;
      for (const e of entries) {
        if (e.model.deadline !== null) next = Math.min(next, e.model.deadline);
      }
      // A pending timer that fires sooner re-schedules itself, so only move it earlier.
      if (next >= timerAt) return;
      clearTimeout(timer);
      timerAt = next;
      if (next === Infinity) return;
      timer = window.setTimeout(tick, Math.max(0, next - now()) + 1);
    };

    const send = (e: Entry, ev: StationEvent) => {
      if (disposed) return;
      const step = stepStation(e.model, ev, now(), geometry(e.spec), timeouts);
      if (step.model === e.model) return;
      e.model = step.model;
      e.view.render(e.model);
      schedule();
      for (const name of step.emits) emit(name, e.station);
    };

    const entries: Entry[] = specs.map((spec, i) => {
      const players = deps.ui.palette.players;
      const color = spec.color ?? players[i % players.length] ?? deps.ui.palette.accent;
      const f = deps.frame();
      const entry = { spec, model: initialStation(now()) } as Entry;
      entry.view = createStationView({
        layer,
        rect: spec.rect,
        color,
        frame: deps.frame,
        // By default the top corner on the outer side, away from neighbours and any seam.
        resetCorner:
          spec.resetCorner ??
          (spec.rect.x + spec.rect.width / 2 < f.width / 2 ? "top-left" : "top-right"),
        toStage: deps.input.toStage,
        onPress(ev) {
          const y = deps.input.toStage(ev.clientX, ev.clientY).y;
          send(entry, { type: "press", y, human: !deps.input.isSynthetic(ev.pointerId) });
        },
        onAdjust(edge, y, ev) {
          send(entry, { type: "adjust", edge, y, human: !deps.input.isSynthetic(ev.pointerId) });
        },
        onConfirm: () => send(entry, { type: "confirm" }),
        onRedo: () => send(entry, { type: "redo" }),
        onReset: () => send(entry, { type: "reset" }),
      });
      entry.view.el.dataset.station = spec.id;
      entry.station = {
        id: spec.id,
        rect: spec.rect,
        color,
        get state() {
          return entry.model.state;
        },
        // Only a confirmed band is the player's; the one being adjusted is not yet.
        get band() {
          const { state, band } = entry.model;
          return band && (state === "ready" || state === "playing") ? { ...band } : null;
        },
        get bot() {
          return entry.model.bot;
        },
        end: () => send(entry, { type: "reset" }),
        claimForBot: () => send(entry, { type: "bot" }),
      };
      trackMinBand(entry.station, () => MIN_BAND_VENUE_PX * deps.frame().unit);
      entry.view.render(entry.model);
      return entry;
    });

    // While playing, the overlay lets touches through; watch them to keep the station alive.
    const onTouch = (down: boolean) => (p: Pointer) => {
      for (const e of entries) {
        if (e.model.state !== "playing" || !inside(e.spec, p.x, p.y)) continue;
        send(e, { type: "activity", human: !p.synthetic, down });
      }
    };
    const offDown = deps.input.on("down", onTouch(true));
    const offMove = deps.input.on("move", onTouch(false));
    const onResize = () => {
      for (const e of entries) e.view.refresh();
    };
    window.addEventListener("resize", onResize);

    const set: StationSet = {
      list: entries.map((e) => e.station),
      on(event, cb) {
        listeners[event].add(cb);
        return () => listeners[event].delete(cb);
      },
      startReady() {
        for (const e of entries) send(e, { type: "start" });
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        clearTimeout(timer);
        offDown();
        offMove();
        window.removeEventListener("resize", onResize);
        for (const e of entries) e.view.dispose();
        for (const l of Object.values(listeners)) l.clear();
        layer.remove();
        sets.delete(set);
      },
    };
    sets.add(set);
    return set;
  };

  return {
    define,
    dispose() {
      for (const set of sets) set.dispose();
    },
  };
};
