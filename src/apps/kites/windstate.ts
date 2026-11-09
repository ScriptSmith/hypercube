/**
 * The wind a frame flies in: the preset from the options, or today's real wind once the leader
 * has it (breezy until then, or if fetching fails), plus admin gusts shared with the group.
 */
import type { AppContext } from "../../core/types";
import type { Config } from "./config";
import { ATTRIBUTION, createLiveWind, type LiveWind } from "./live";
import {
  addGust,
  createWindField,
  liveParams,
  pruneGusts,
  WIND_PRESETS,
  windDir,
  type WindField,
} from "./wind";
import { decodeGust, decodeWind, encodeGust, encodeWind, TOPIC, type WindMsg } from "./wire";

/** The leader repeats the live wind this often, for frames that joined since. */
const REPEAT_MS = 20_000;
/** Gusts start this long after the command, so every frame hears of it first. */
const GUST_LEAD_MS = 400;

export interface WindState {
  readonly field: WindField;
  dir(t: number): number;
  /** `now` local ms, `t` shared seconds. */
  tick(now: number, t: number): void;
  /** The attribution to show, while live wind is in use. */
  readonly attribution: string | null;
  status(): { source: string; speed: number };
  commandGust(): void;
  dispose(): void;
}

export const createWindState = (ctx: AppContext, config: Config, preview: boolean): WindState => {
  const net = ctx.net;
  const fallback = WIND_PRESETS.breezy;
  const preset = config.wind === "live" ? fallback : WIND_PRESETS[config.wind];
  const field = createWindField(ctx.seed, preset);
  let current: WindMsg | null = null;
  let fetched = false;
  let repeatAt = 0;

  const apply = (w: WindMsg) => {
    current = w;
    field.params = liveParams(w.speed, w.gusts, w.from);
  };

  const live: LiveWind | null =
    config.wind === "live" && !preview
      ? createLiveWind({
          lat: config.lat,
          lon: config.lon,
          onFetched(w) {
            apply(w);
            fetched = true;
            if (net.online) net.send(TOPIC.wind, encodeWind(w));
          },
        })
      : null;

  const offs =
    config.wind === "live"
      ? [
          net.on(TOPIC.wind, (data, from) => {
            if (from !== net.leader()) return;
            const w = decodeWind(data);
            if (!w) return;
            live?.heard(w, performance.now());
            apply(w);
          }),
        ]
      : [];
  offs.push(
    net.on(TOPIC.gust, (data) => {
      const m = decodeGust(data);
      if (m) addGust(field, m.t / 1000, m.dir);
    }),
  );

  const leads = () => !net.online || net.leader() === net.self;

  return {
    field,
    dir: (t) => windDir(field, t),
    tick(now, t) {
      pruneGusts(field, t);
      if (!live) return;
      live.tick(now, leads());
      if (fetched && current && leads() && net.online && now >= repeatAt) {
        repeatAt = now + REPEAT_MS;
        net.send(TOPIC.wind, encodeWind(current));
      }
    },
    get attribution() {
      return current ? ATTRIBUTION : null;
    },
    status() {
      if (config.wind !== "live") return { source: config.wind, speed: field.params.mean };
      if (!current) return { source: "live (breezy until fetched)", speed: field.params.mean };
      return { source: "live", speed: (current as WindMsg).speed };
    },
    commandGust() {
      const t0 = ctx.clock.now() + GUST_LEAD_MS;
      const dir = windDir(field, ctx.clock.now() / 1000) >= 0 ? 1 : -1;
      addGust(field, t0 / 1000, dir);
      if (net.online) net.send(TOPIC.gust, encodeGust({ t: t0, dir }));
    },
    dispose() {
      for (const off of offs) off();
      live?.dispose();
    },
  };
};
