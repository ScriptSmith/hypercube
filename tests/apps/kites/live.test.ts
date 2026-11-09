import { afterEach, describe, expect, it, vi } from "vitest";
import { readConfig } from "../../../src/apps/kites/config";
import {
  ATTRIBUTION,
  createLiveWind,
  FETCH_EVERY_MS,
  type Fetcher,
  fetchWind,
  forecastUrl,
  parseForecast,
  RETRY_MS,
} from "../../../src/apps/kites/live";
import { WIND_PRESETS } from "../../../src/apps/kites/wind";
import { createWindState } from "../../../src/apps/kites/windstate";
import { TOPIC } from "../../../src/apps/kites/wire";
import type { AppContext } from "../../../src/core/types";
import { fakeNet, peer } from "./helpers";

const body = { current: { wind_speed_10m: 6.2, wind_gusts_10m: 11.5, wind_direction_10m: 250 } };
const ok = (data: unknown = body) =>
  ({ ok: true, json: () => Promise.resolve(data) }) as unknown as Response;
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("live wind", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("asks Open-Meteo for the current wind at 10 m", () => {
    const url = new URL(forecastUrl(-27.47, 153.03));
    expect(url.hostname).toBe("api.open-meteo.com");
    expect(url.searchParams.get("latitude")).toBe("-27.47");
    expect(url.searchParams.get("longitude")).toBe("153.03");
    expect(url.searchParams.get("current")).toContain("wind_speed_10m");
    expect(url.searchParams.get("wind_speed_unit")).toBe("ms");
  });

  it("reads a forecast and rejects nonsense", () => {
    expect(parseForecast(body)).toEqual({ speed: 6.2, gusts: 11.5, from: 250 });
    expect(parseForecast({ current: { wind_speed_10m: 3, wind_direction_10m: 10 } })).toEqual({
      speed: 3,
      gusts: 3,
      from: 10,
    });
    for (const bad of [
      null,
      {},
      { current: {} },
      { current: { wind_speed_10m: -1, wind_direction_10m: 0 } },
    ]) {
      expect(parseForecast(bad)).toBeNull();
    }
  });

  it("returns null on any failure", async () => {
    const fails: Fetcher[] = [
      () => Promise.reject(new Error("offline")),
      () =>
        Promise.resolve({ ok: false, json: () => Promise.resolve(body) } as unknown as Response),
      () =>
        Promise.resolve({
          ok: true,
          json: () => Promise.reject(new Error("bad json")),
        } as unknown as Response),
      () => Promise.resolve(ok({ nope: 1 })),
    ];
    for (const f of fails) expect(await fetchWind(0, 0, f)).toBeNull();
    expect(await fetchWind(0, 0, () => Promise.resolve(ok()))).toEqual(parseForecast(body));
  });

  it("gives up after its timeout", async () => {
    vi.useFakeTimers();
    const hang: Fetcher = (_u, init) =>
      new Promise((_res, rej) =>
        init.signal.addEventListener("abort", () => rej(new Error("abort"))),
      );
    const p = fetchWind(0, 0, hang, 5000);
    await vi.advanceTimersByTimeAsync(5001);
    expect(await p).toBeNull();
  });

  it("fetches only while leading, at most every ten minutes, sooner after a failure", async () => {
    const calls: string[] = [];
    let fail = false;
    const got: unknown[] = [];
    const live = createLiveWind({
      lat: 1,
      lon: 2,
      onFetched: (w) => got.push(w),
      fetcher: (u) => {
        calls.push(u);
        return fail ? Promise.reject(new Error("x")) : Promise.resolve(ok());
      },
    });
    live.tick(0, false);
    expect(calls).toHaveLength(0);
    live.tick(0, true);
    await flush();
    expect(calls).toHaveLength(1);
    expect(got).toHaveLength(1);
    live.tick(FETCH_EVERY_MS - 1, true);
    await flush();
    expect(calls).toHaveLength(1);
    fail = true;
    live.tick(FETCH_EVERY_MS, true);
    await flush();
    expect(calls).toHaveLength(2);
    expect(live.failures).toBe(1);
    expect(live.wind).not.toBeNull();
    live.tick(FETCH_EVERY_MS + RETRY_MS - 1, true);
    await flush();
    expect(calls).toHaveLength(2);
    live.tick(FETCH_EVERY_MS + RETRY_MS, true);
    await flush();
    expect(calls).toHaveLength(3);
    live.dispose();
  });

  const ctxFor = (wind: string, channel: ReturnType<ReturnType<typeof fakeNet>["channel"]>) =>
    ({
      seed: 42,
      net: channel,
      clock: { now: () => 1_760_000_000_000, synced: true, onSync: () => () => {} },
      options: { wind },
    }) as unknown as AppContext;

  it("falls back to breezy without attribution when the fetch fails", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    const net = fakeNet();
    const ch = net.channel(peer("scr", "screen"));
    const ws = createWindState(ctxFor("live", ch), readConfig("duo", { wind: "live" }), false);
    ws.tick(0, 1_760_000_000);
    await flush();
    await flush();
    expect(ws.field.params).toEqual(WIND_PRESETS.breezy);
    expect(ws.attribution).toBeNull();
    expect(ws.status().source).toContain("breezy");
    ws.dispose();
  });

  it("uses and shares real wind with the attribution once fetched", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(ok()));
    const net = fakeNet();
    const screen = net.channel(peer("scr", "screen"));
    const panel = net.channel(peer("p1", "station", 0));
    const cfg = readConfig("duo", { wind: "live" });
    const ws = createWindState(ctxFor("live", screen), cfg, false);
    const wp = createWindState(ctxFor("live", panel), cfg, false);
    ws.tick(0, 1_760_000_000);
    wp.tick(0, 1_760_000_000);
    await flush();
    await flush();
    expect(ws.attribution).toBe(ATTRIBUTION);
    expect(ws.field.params.dir).toBe(1);
    expect(ws.status()).toEqual({ source: "live", speed: 6.2 });
    // The panel never fetched; it heard the screen.
    expect(net.sent.filter((m) => m.topic === TOPIC.wind && m.from === "scr")).toHaveLength(1);
    expect(wp.attribution).toBe(ATTRIBUTION);
    expect(wp.field.params).toEqual(ws.field.params);
    ws.dispose();
    wp.dispose();
  });

  it("never fetches for synthetic wind or in preview", () => {
    const spy = vi.fn(() => Promise.resolve(ok()));
    vi.stubGlobal("fetch", spy);
    const net = fakeNet();
    const ch = net.channel(peer("p", "solo"));
    const a = createWindState(ctxFor("breezy", ch), readConfig("duo", {}), false);
    const b = createWindState(ctxFor("live", ch), readConfig("duo", { wind: "live" }), true);
    a.tick(0, 1);
    b.tick(0, 1);
    expect(spy).not.toHaveBeenCalled();
    expect(a.attribution).toBeNull();
    a.dispose();
    b.dispose();
  });

  it("shares admin gusts with the group", () => {
    const net = fakeNet();
    const one = net.channel(peer("p1", "station", 0));
    const two = net.channel(peer("p2", "station", 1));
    const a = createWindState(ctxFor("breezy", one), readConfig("duo", {}), false);
    const b = createWindState(ctxFor("breezy", two), readConfig("duo", {}), false);
    a.commandGust();
    expect(a.field.commanded).toHaveLength(1);
    expect(b.field.commanded).toEqual(a.field.commanded);
    a.dispose();
    b.dispose();
  });
});
