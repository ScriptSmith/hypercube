/**
 * The ball's surface. For each point of the feed it finds the tile underneath (row from
 * latitude, tile from longitude within the row, as `tiles.ts` lays them out), reads the colour
 * the CPU worked out for that tile, and draws the mirror, the grout round it and the glints of
 * any bright neighbours. Its uniforms are filled in by `index.ts`.
 */
export const BALL = /* glsl */ `
uniform float uTheta;
uniform sampler2D uRowTex;
uniform sampler2D uTileTex;
uniform float uRows;
uniform float uTexWidth;
uniform float uPitch;
uniform float uTile;
uniform float uGrout;
uniform float uCapLat;
uniform float uPoleR;
uniform vec2 uPx;

const float TAU = 6.283185307179586;
const float HALF_PI = 1.5707963267948966;
const vec3 GROUT = vec3(0.010, 0.010, 0.012);
const vec3 PLATE = vec3(0.018, 0.019, 0.022);

vec4 rowAt(float r) {
  return texture2D(uRowTex, vec2((r + 0.5) / uRows, 0.5));
}

vec4 tileAt(float k, float r) {
  return texture2D(uTileTex, vec2((k + 0.5) / uTexWidth, (r + 0.5) / uRows));
}

// The tile of row r under a point, and the point's offset from that tile's centre along the
// surface (east, north), radians. On the pole the offset is the distance from the pole.
vec3 findTile(float r, vec4 row, float lat, float lon) {
  if (r < 0.5) return vec3(0.0, 0.0, lat + HALF_PI);
  float slot = TAU / row.x;
  float a = mod(lon - row.y, TAU);
  float k = min(floor(a / slot), row.x - 1.0);
  return vec3(k, (a - (k + 0.5) * slot) * max(cos(lat), 0.0), lat - row.z);
}

// A star glint round a tile's centre: a thin cross along the rows and a small soft halo. It
// fades out within the next tile, the farthest the shader looks for a bright neighbour.
float glint(vec2 d) {
  vec2 a = abs(d) / uPitch;
  float thin = 0.04;
  float fade = smoothstep(1.5, 0.7, max(a.x, a.y));
  float arms = exp(-2.2 * a.x - a.y * a.y / (thin * thin)) + exp(-2.2 * a.y - a.x * a.x / (thin * thin));
  return fade * (arms + 0.7 * exp(-dot(a, a) / 0.09));
}

vec3 tint(vec3 c) {
  return mix(c / max(max(c.r, c.g), max(c.b, 1e-3)), vec3(1.0), 0.4);
}

vec4 surface(vec3 dir) {
  vec2 ll = sphereLatLon(dir);
  float lat = ll.x;
  float lon = ll.y - uTheta;
  float cl = max(cos(lat), 1e-4);
  // Radians of surface per feed pixel, across and down.
  vec2 aa = vec2(uPx.x * cl, uPx.y);

  if (lat >= uCapLat) {
    float from = HALF_PI - lat;
    float rings = 0.85 + 0.15 * sin(from / uPitch * 9.0);
    float rim = smoothstep(uCapLat + 0.5 * uGrout + aa.y, uCapLat + 0.5 * uGrout, lat);
    vec3 plate = mix(PLATE * rings, GROUT, rim);
    return vec4(plate, 1.0);
  }

  float r = clamp(floor((lat + HALF_PI) / uPitch), 0.0, uRows - 1.0);
  vec4 row = rowAt(r);
  vec3 at = findTile(r, row, lat, lon);
  vec4 tile = tileAt(at.x, r);

  float inside;
  vec2 uv;
  float slot = TAU / max(row.x, 1.0);
  if (r < 0.5) {
    inside = smoothstep(uPoleR + 0.5 * aa.y, uPoleR - 0.5 * aa.y, at.z);
    uv = vec2(sin(lon), cos(lon)) * at.z / uPoleR;
  } else {
    float hw = 0.5 * min(slot * cl, slot * cos(row.z)) - 0.5 * uGrout;
    float hh = 0.5 * uTile;
    vec2 edge = vec2(hw, hh) - abs(at.yz);
    inside = smoothstep(-0.5 * aa.x, 0.5 * aa.x, edge.x) * smoothstep(-0.5 * aa.y, 0.5 * aa.y, edge.y);
    uv = at.yz / vec2(hw, hh);
  }

  // A flat mirror is one colour; a faint sheen across it and a darker bevelled edge show the glass.
  // Golden-ratio steps along and between rows give neighbouring tiles unrelated directions.
  float h = fract(at.x * 0.6180339887 + r * 0.7548776662 + at.x * r * 0.0131);
  float sheen = 1.0 + 0.16 * dot(uv, vec2(cos(h * TAU), sin(h * TAU)));
  float rim = r < 0.5 ? length(uv) : max(abs(uv.x), abs(uv.y));
  float bevel = mix(0.72, 1.0, smoothstep(1.0, 0.84, rim));
  vec3 col = mix(GROUT, tile.rgb * sheen * bevel, inside);

  vec3 glow = tile.a * glint(at.yz) * tint(tile.rgb);
  if (r > 0.5) {
    float n = row.x;
    vec4 left = tileAt(mod(at.x - 1.0 + n, n), r);
    vec4 right = tileAt(mod(at.x + 1.0, n), r);
    glow += left.a * glint(vec2(at.y + slot * cl, at.z)) * tint(left.rgb);
    glow += right.a * glint(vec2(at.y - slot * cl, at.z)) * tint(right.rgb);
  }
  for (int s = -1; s <= 1; s += 2) {
    float r2 = r + float(s);
    if (r2 < 0.0 || r2 > uRows - 1.0) continue;
    vec4 row2 = rowAt(r2);
    if (row2.x < 0.5) continue;
    vec3 at2 = findTile(r2, row2, lat, lon);
    vec4 other = tileAt(at2.x, r2);
    glow += other.a * glint(at2.yz) * tint(other.rgb);
  }

  // Bright light saturates without changing hue; only the brightest goes white-hot. light.ts
  // works out the same in shown().
  vec3 c = col + glow;
  float m = max(max(c.r, c.g), c.b);
  float level = 1.0 - exp(-m);
  float hot = 0.5 * smoothstep(2.0, 6.0, m);
  return vec4(c * (level / max(m, 1e-5)) * (1.0 - hot) + hot * level, 1.0);
}
`;
