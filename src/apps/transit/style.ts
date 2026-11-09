/**
 * Our own dark, high-contrast basemap style for big displays, over OpenFreeMap's vector tiles
 * (the OpenMapTiles schema): water, parks and major roads, river and suburb labels, everything
 * else quiet. TileJSON and glyphs go through the `hcnet` protocol (see map.ts); tiles load
 * directly in MapLibre's own workers.
 */
import type { StyleSpecification } from "maplibre-gl";

export const PROTOCOL = "hcnet";
export const TILES_HOST = "tiles.openfreemap.org";
export const TILEJSON_URL = `${PROTOCOL}://${TILES_HOST}/planet`;
export const GLYPHS_URL = `${PROTOCOL}://${TILES_HOST}/fonts/{fontstack}/{range}.pbf`;
export const ATTRIBUTION = [
  "© OpenStreetMap contributors · OpenMapTiles · OpenFreeMap",
  "Transit data: Translink, CC BY 4.0",
];

export const COLORS = {
  land: "#0a0f1a",
  water: "#12304c",
  park: "#0e1d18",
  wood: "#0c1916",
  building: "#121a28",
  minor: "#182234",
  major: "#222f46",
  motorway: "#2c3b56",
  rail: "#2f3549",
  waterLabel: "#6e9cc9",
  placeLabel: "#8a95ad",
  halo: "#05070d",
} as const;

/**
 * `text` and `line` scale label sizes and line widths: a wall or screen is seen from metres
 * away, a kiosk from arm's length. Both already include the frame's unit.
 */
export const buildStyle = (text: number, line: number): StyleSpecification => {
  const w = (z0: number, v0: number, z1: number, v1: number) =>
    [
      "interpolate",
      ["exponential", 1.5],
      ["zoom"],
      z0,
      v0 * line,
      z1,
      v1 * line,
    ] as unknown as number;
  const ts = (z0: number, v0: number, z1: number, v1: number) =>
    ["interpolate", ["linear"], ["zoom"], z0, v0 * text, z1, v1 * text] as unknown as number;
  const name = ["coalesce", ["get", "name:en"], ["get", "name"]] as unknown as string;
  return {
    version: 8,
    glyphs: GLYPHS_URL,
    sources: { omt: { type: "vector", url: TILEJSON_URL } },
    layers: [
      { id: "land", type: "background", paint: { "background-color": COLORS.land } },
      {
        id: "wood",
        type: "fill",
        source: "omt",
        "source-layer": "landcover",
        filter: ["in", ["get", "class"], ["literal", ["wood", "grass"]]],
        paint: { "fill-color": COLORS.wood },
      },
      {
        id: "park",
        type: "fill",
        source: "omt",
        "source-layer": "park",
        paint: { "fill-color": COLORS.park },
      },
      {
        id: "water",
        type: "fill",
        source: "omt",
        "source-layer": "water",
        paint: { "fill-color": COLORS.water },
      },
      {
        id: "river",
        type: "line",
        source: "omt",
        "source-layer": "waterway",
        filter: ["==", ["get", "class"], "river"],
        paint: { "line-color": COLORS.water, "line-width": w(8, 1, 15, 6) },
      },
      {
        id: "building",
        type: "fill",
        source: "omt",
        "source-layer": "building",
        minzoom: 14.5,
        paint: { "fill-color": COLORS.building },
      },
      {
        id: "road-minor",
        type: "line",
        source: "omt",
        "source-layer": "transportation",
        minzoom: 12.5,
        filter: ["in", ["get", "class"], ["literal", ["minor", "service", "tertiary"]]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": COLORS.minor, "line-width": w(12.5, 0.4, 17, 5) },
      },
      {
        id: "road-major",
        type: "line",
        source: "omt",
        "source-layer": "transportation",
        filter: ["in", ["get", "class"], ["literal", ["primary", "secondary"]]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": COLORS.major, "line-width": w(9, 0.4, 17, 9) },
      },
      {
        id: "road-motorway",
        type: "line",
        source: "omt",
        "source-layer": "transportation",
        filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk"]]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": COLORS.motorway, "line-width": w(8, 0.6, 17, 12) },
      },
      {
        id: "rail",
        type: "line",
        source: "omt",
        "source-layer": "transportation",
        filter: ["in", ["get", "class"], ["literal", ["rail", "transit"]]],
        paint: {
          "line-color": COLORS.rail,
          "line-width": w(10, 0.6, 17, 3),
          "line-dasharray": [3, 2],
        },
      },
      {
        id: "river-name",
        type: "symbol",
        source: "omt",
        "source-layer": "waterway",
        minzoom: 11,
        filter: ["==", ["get", "class"], "river"],
        layout: {
          "symbol-placement": "line",
          "text-field": name,
          "text-font": ["Noto Sans Italic"],
          "text-size": ts(11, 13, 16, 20),
          "text-letter-spacing": 0.15,
          "symbol-spacing": 700,
        },
        paint: {
          "text-color": COLORS.waterLabel,
          "text-halo-color": COLORS.halo,
          "text-halo-width": 1.5 * text,
        },
      },
      {
        id: "water-name",
        type: "symbol",
        source: "omt",
        "source-layer": "water_name",
        layout: {
          "text-field": name,
          "text-font": ["Noto Sans Italic"],
          "text-size": ts(9, 13, 15, 18),
          "text-letter-spacing": 0.15,
        },
        paint: {
          "text-color": COLORS.waterLabel,
          "text-halo-color": COLORS.halo,
          "text-halo-width": 1.5 * text,
        },
      },
      {
        id: "suburb",
        type: "symbol",
        source: "omt",
        "source-layer": "place",
        minzoom: 11,
        filter: ["in", ["get", "class"], ["literal", ["suburb", "neighbourhood", "quarter"]]],
        layout: {
          "text-field": name,
          "text-font": ["Noto Sans Regular"],
          "text-size": ts(11, 12, 16, 17),
          "text-padding": 12 * text,
        },
        paint: {
          "text-color": COLORS.placeLabel,
          "text-halo-color": COLORS.halo,
          "text-halo-width": 1.5 * text,
        },
      },
      {
        id: "city",
        type: "symbol",
        source: "omt",
        "source-layer": "place",
        maxzoom: 12,
        filter: ["in", ["get", "class"], ["literal", ["city", "town"]]],
        layout: {
          "text-field": name,
          "text-font": ["Noto Sans Bold"],
          "text-size": ts(8, 13, 12, 18),
        },
        paint: {
          "text-color": COLORS.placeLabel,
          "text-halo-color": COLORS.halo,
          "text-halo-width": 1.5 * text,
        },
      },
    ],
  };
};
