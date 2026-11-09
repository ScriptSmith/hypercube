/**
 * The MapLibre map: our dark style, highlighted route lines as GeoJSON, the vehicle layer on top.
 * MapLibre's own handlers are off: the app moves the camera itself, from the tour and from
 * visitors' drags, pinches and zoom buttons (see gesture.ts). Errors (unreachable tiles, glyphs or
 * tile metadata) are counted, never logged: without tiles the map is a dark background with the
 * route lines and vehicles, which still works.
 */
import {
  addProtocol,
  type GeoJSONSource,
  Map as MapLibreMap,
  removeProtocol,
  type RequestParameters,
  setWorkerUrl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { toLat, toLon } from "./geo";
import type { TransitIO } from "./io";
import { LAYER_ID, type VehicleLayer } from "./layer";
import { buildStyle, PROTOCOL, TILES_HOST } from "./style";
import type { Camera } from "./views";

export const LINES_SOURCE = "tr-lines";
export const BASE_SOURCE = "tr-base";
const FETCH_TIMEOUT_MS = 15_000;
/** Tiles kept beyond those in view, per source: bounds memory as the tour and follows roam. */
const TILE_CACHE = 48;
/** Map pitch while following a vehicle. */
export const FOLLOW_PITCH = 40;

export interface LineFeature {
  type: "Feature";
  properties: { color: string };
  geometry: { type: "LineString"; coordinates: [number, number][] };
}
export interface LineFeatures {
  type: "FeatureCollection";
  features: LineFeature[];
}
type GeoData = Parameters<GeoJSONSource["setData"]>[0];

export interface MapHandle {
  readonly map: MapLibreMap;
  readonly loaded: boolean;
  readonly errors: number;
  readonly lastError: string;
  setLines(fc: LineFeatures): void;
  setBase(fc: LineFeatures): void;
  fly(cam: Camera, duration: number, pitch?: number): void;
  jump(lon: number, lat: number, zoom?: number, pitch?: number): void;
  /** Move the ground under the map by (dx, dy) map px, as a finger drags it. */
  pan(dx: number, dy: number): void;
  /** Zoom to `zoom`, keeping the ground at map px (x, y) where it is. */
  zoomAround(zoom: number, x: number, y: number, duration: number): void;
  /** Ease the centre to (lon, lat), slowing to a stop. */
  glide(lon: number, lat: number, duration: number): void;
  /** The ground at map px (x, y). */
  unproject(x: number, y: number): { lon: number; lat: number };
  /** Local metres to stage px (null if behind the camera). */
  project(x: number, y: number): { x: number; y: number } | null;
  center(): { lon: number; lat: number };
  zoom(): number;
  moving(): boolean;
  resize(pixelRatio: number): void;
  repaint(): void;
  dispose(): void;
}

let protocolUsers = 0;
let protocolIO: TransitIO | null = null;

/** Fetches for `hcnet://` URLs through the app's worker, so failures stay quiet. */
const loadThroughWorker = async (params: RequestParameters) => {
  const io = protocolIO;
  if (!io) throw new Error("transit map: no network");
  const url = new URL(params.url.replace(`${PROTOCOL}://`, "https://"));
  if (url.hostname !== TILES_HOST) throw new Error("transit map: unexpected host");
  const buf = await io.fetchBytes(url.href, FETCH_TIMEOUT_MS);
  if (params.type === "json") return { data: JSON.parse(new TextDecoder().decode(buf)) as object };
  if (params.type === "string") return { data: new TextDecoder().decode(buf) };
  return { data: buf };
};

const empty = (): LineFeatures => ({ type: "FeatureCollection", features: [] });
const easeOut = (t: number) => 1 - (1 - t) ** 3;

export const createMap = (opts: {
  container: HTMLElement;
  io: TransitIO;
  pixelRatio: number;
  /** Text and line scale for the style (unit already included). */
  text: number;
  line: number;
  start: Camera;
  layer: VehicleLayer;
  /** Stage px of the container's top-left, for `project`. */
  offset: () => { x: number; y: number };
}): MapHandle => {
  setWorkerUrl(workerUrl);
  protocolIO = opts.io;
  if (protocolUsers++ === 0) addProtocol(PROTOCOL, loadThroughWorker);

  const style = buildStyle(opts.text, opts.line);
  style.sources[LINES_SOURCE] = { type: "geojson", data: empty() as GeoData };
  style.sources[BASE_SOURCE] = { type: "geojson", data: empty() as GeoData };
  const labels = style.layers.findIndex((l) => l.type === "symbol");
  const w = opts.line;
  style.layers.splice(
    labels < 0 ? style.layers.length : labels,
    0,
    {
      id: "tr-base-line",
      type: "line",
      source: BASE_SOURCE,
      layout: { "line-cap": "round", "line-join": "round" },
      // Opaque, in colours already darkened: many routes share a track, and translucent lines
      // stacked on one would add up to full brightness.
      paint: { "line-color": ["get", "color"], "line-width": 1.8 * w },
    },
    {
      id: "tr-lines-glow",
      type: "line",
      source: LINES_SOURCE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-opacity": 0.4,
        "line-width": 16 * w,
        "line-blur": 12 * w,
      },
    },
    {
      id: "tr-lines-core",
      type: "line",
      source: LINES_SOURCE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ["get", "color"], "line-opacity": 0.95, "line-width": 3.6 * w },
    },
  );

  const map = new MapLibreMap({
    container: opts.container,
    style,
    interactive: false,
    attributionControl: false,
    maplibreLogo: false,
    pixelRatio: opts.pixelRatio,
    maxCanvasSize: [16384, 16384],
    maxTileCacheSize: TILE_CACHE,
    refreshExpiredTiles: false,
    reduceMotion: false,
    fadeDuration: 200,
    maxPitch: 60,
    center: [opts.start.lon, opts.start.lat],
    zoom: opts.start.zoom,
    canvasContextAttributes: { antialias: false },
  });

  let loaded = false;
  let errors = 0;
  let lastError = "";
  let lines: LineFeatures | null = null;
  let base: LineFeatures | null = null;
  let disposed = false;
  const source = (id: string) => map.getSource(id) as GeoJSONSource | undefined;

  map.on("error", (e) => {
    errors++;
    lastError = String(e.error?.message ?? "map error").slice(0, 160);
  });
  // A lost GL context takes the style with it; MapLibre loads the style again on restore, but
  // a custom layer has to be added back by hand. So every style load (re)adds it.
  map.on("webglcontextlost", () => {
    loaded = false;
    opts.layer.contextLost();
  });
  map.on("style.load", () => {
    if (disposed) return;
    loaded = true;
    try {
      if (!map.getLayer(LAYER_ID)) map.addLayer(opts.layer);
    } catch (err) {
      errors++;
      lastError = String(err).slice(0, 160);
    }
    if (lines) source(LINES_SOURCE)?.setData(lines as GeoData);
    if (base) source(BASE_SOURCE)?.setData(base as GeoData);
  });

  return {
    map,
    get loaded() {
      return loaded;
    },
    get errors() {
      return errors;
    },
    get lastError() {
      return lastError;
    },
    setLines(fc) {
      lines = fc;
      if (loaded) source(LINES_SOURCE)?.setData(fc as GeoData);
    },
    setBase(fc) {
      base = fc;
      if (loaded) source(BASE_SOURCE)?.setData(fc as GeoData);
    },
    fly(cam, duration, pitch = 0) {
      map.flyTo({
        center: [cam.lon, cam.lat],
        zoom: cam.zoom,
        bearing: 0,
        pitch,
        duration,
        curve: 1.3,
        essential: true,
      });
    },
    jump(lon, lat, zoom, pitch) {
      const cam: { center: [number, number]; zoom?: number; pitch?: number } = {
        center: [lon, lat],
      };
      if (zoom !== undefined) cam.zoom = zoom;
      if (pitch !== undefined) cam.pitch = pitch;
      map.jumpTo(cam);
    },
    pan(dx, dy) {
      const c = map.project(map.getCenter());
      map.jumpTo({ center: map.unproject([c.x - dx, c.y - dy]) });
    },
    zoomAround(zoom, x, y, duration) {
      map.easeTo({
        zoom,
        around: map.unproject([x, y]),
        duration,
        easing: easeOut,
        essential: true,
      });
    },
    glide(lon, lat, duration) {
      map.easeTo({ center: [lon, lat], duration, easing: easeOut, essential: true });
    },
    unproject(x, y) {
      const ll = map.unproject([x, y]);
      return { lon: ll.lng, lat: ll.lat };
    },
    project(x, y) {
      const p = map.project([toLon(x), toLat(y)]);
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
      const o = opts.offset();
      return { x: p.x + o.x, y: p.y + o.y };
    },
    center() {
      const c = map.getCenter();
      return { lon: c.lng, lat: c.lat };
    },
    zoom: () => map.getZoom(),
    moving: () => map.isMoving(),
    resize(pixelRatio) {
      map.setPixelRatio(pixelRatio);
      map.resize();
    },
    repaint() {
      map.triggerRepaint();
    },
    dispose() {
      disposed = true;
      try {
        if (loaded && map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      } catch {
        // The style may already be gone.
      }
      map.remove();
      if (--protocolUsers === 0) {
        removeProtocol(PROTOCOL);
        protocolIO = null;
      }
    },
  };
};
