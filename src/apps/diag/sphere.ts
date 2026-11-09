import { DEG, type SphereMap, sphereMap, wrapOffsets } from "../../core/sphere";
import type { FrameInfo, Palette } from "../../core/types";

/**
 * A test pattern for a sphere: latitude and longitude lines with their numbers, the seam where
 * the feed's edges meet, the poles, the cap nobody sees well, a tint for each quarter turn and
 * words that should read left to right from outside. Dots run round the equator and lower down,
 * across the seam, so a break in the wrap shows at once.
 */
export interface SpherePattern {
  resize(frame: FrameInfo): void;
  tick(seconds: number): void;
  dispose(): void;
}

const QUARTERS = ["rgba(80,140,255,0.16)", "rgba(80,220,140,0.16)", "rgba(230,90,220,0.16)"];
const SEAM = "#ff4fd8";
const DOT_PERIOD = 12;

export const createSpherePattern = (host: HTMLElement, palette: Palette): SpherePattern => {
  const base = document.createElement("canvas");
  const dots = document.createElement("canvas");
  for (const c of [base, dots]) {
    c.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;";
    host.prepend(c);
  }
  // `prepend` put the dots under the pattern; swap them back.
  host.insertBefore(base, dots);
  const g = base.getContext("2d");
  const d = dots.getContext("2d");
  let map: SphereMap | null = null;
  let last: { x: number; y: number; rx: number; ry: number }[] = [];

  /** Text that looks right on the ball at `lat`: squeezed up and stretched across. */
  const text = (s: string, lon: number, lat: number, size: number, color: string) => {
    if (!g || !map) return;
    const stretch = map.stretch(lat);
    g.save();
    g.font = `700 ${size}px system-ui, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const w = g.measureText(s).width * stretch;
    const x = map.x(lon);
    for (const dx of wrapOffsets(x - w / 2, x + w / 2, map.width)) {
      g.setTransform(stretch, 0, 0, 1, x + dx, map.y(lat));
      g.lineWidth = size * 0.16;
      g.strokeStyle = "rgba(0,0,0,0.8)";
      g.strokeText(s, 0, 0);
      g.fillStyle = color;
      g.fillText(s, 0, 0);
    }
    g.restore();
  };

  const hline = (lat: number, width: number, color: string) => {
    if (!g || !map) return;
    g.fillStyle = color;
    g.fillRect(0, map.y(lat) - width / 2, map.width, width);
  };

  const vline = (lon: number, width: number, color: string) => {
    if (!g || !map) return;
    g.fillStyle = color;
    const x = map.x(lon);
    for (const dx of wrapOffsets(x - width / 2, x + width / 2, map.width)) {
      g.fillRect(x + dx - width / 2, 0, width, map.height);
    }
  };

  const draw = (frame: FrameInfo) => {
    if (!g || !map || !frame.sphere) return;
    const s = frame.sphere;
    const W = map.width;
    const H = map.height;
    const u = map.pxPerLat * DEG;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = palette.background;
    g.fillRect(0, 0, W, H);
    QUARTERS.forEach((color, i) => {
      g.fillStyle = color;
      const x0 = map!.x(-Math.PI + (i * 2 * Math.PI) / 3);
      g.fillRect(x0, 0, W / 3, H);
    });
    const hidden = map.y(s.view.top);
    if (hidden > 0) {
      g.fillStyle = "rgba(0,0,0,0.55)";
      g.fillRect(0, 0, W, hidden);
    }
    const thin = Math.max(1, u * 0.12);
    for (let lat = -80; lat <= 80; lat += 10) {
      const major = lat % 30 === 0;
      hline(
        lat * DEG,
        lat === 0 ? thin * 4 : major ? thin * 2 : thin,
        major ? "#c9d2e4" : "#56627a",
      );
    }
    for (let lon = -165; lon <= 180; lon += 15) {
      const major = lon % 30 === 0;
      vline(lon * DEG, major ? thin * 2 : thin, major ? "#c9d2e4" : "#56627a");
    }
    vline(Math.PI, thin * 5, SEAM);
    hline(s.view.top, thin * 4, palette.accent);

    const label = u * 3.2;
    // Longitudes along two rows; latitudes between them, half a meridian away.
    for (let lon = -150; lon <= 180; lon += 30) {
      for (const lat of [0, -30]) {
        text(`${lon}°`, (lon - 4) * DEG, (lat + 3) * DEG, label, palette.foreground);
      }
    }
    for (const lon of [-165, -45, 75]) {
      for (const lat of [60, 30, -30, -60]) {
        text(`${lat > 0 ? "+" : ""}${lat}°`, lon * DEG, (lat + 3) * DEG, label, "#9fb0cc");
      }
    }
    for (const lon of [-90, 90, 180]) {
      text("Reads left to right", lon * DEG, -12 * DEG, u * 5, palette.foreground);
    }
    for (const lat of [15, -15, -45]) {
      text("seam", 175 * DEG, lat * DEG, label, SEAM);
      text("seam", -175 * DEG, lat * DEG, label, SEAM);
    }
    for (const lon of [-120, 0, 120]) {
      text(
        `Seen well below here (${Math.round(s.view.top / DEG)}°)`,
        lon * DEG,
        s.view.top - 4 * DEG,
        u * 3,
        palette.accent,
      );
      text("Bottom", lon * DEG, -84 * DEG, u * 2.4, palette.foreground);
    }
    if (s.cover.top > 84 * DEG) text("Top", 0, 86 * DEG, u * 2, palette.muted);
    hline(-85 * DEG, thin * 3, palette.foreground);
  };

  return {
    resize(frame) {
      if (!frame.sphere) return;
      const w = Math.max(1, Math.round(frame.width * frame.pixelRatio));
      const h = Math.max(1, Math.round(frame.height * frame.pixelRatio));
      for (const c of [base, dots]) {
        c.width = w;
        c.height = h;
      }
      map = sphereMap(frame.sphere, w, h);
      last = [];
      draw(frame);
    },
    tick(seconds) {
      if (!d || !map) return;
      for (const r of last) d.clearRect(r.x - r.rx - 2, r.y - r.ry - 2, 2 * r.rx + 4, 2 * r.ry + 4);
      last = [];
      const phase = ((seconds % DOT_PERIOD) / DOT_PERIOD) * 2 * Math.PI;
      const r = map.pxPerLat * 2.2 * DEG;
      for (const [lat, lon, color] of [
        [0, phase - Math.PI, palette.accent],
        [-45 * DEG, Math.PI - phase, "#38d39f"],
      ] as const) {
        const x = map.x(lon);
        const y = map.y(lat);
        const rx = r * map.stretch(lat);
        for (const dx of wrapOffsets(x - rx, x + rx, map.width)) {
          d.fillStyle = color;
          d.beginPath();
          d.ellipse(x + dx, y, rx, r, 0, 0, 2 * Math.PI);
          d.fill();
          last.push({ x: x + dx, y, rx, ry: r });
        }
      }
    },
    dispose() {
      base.remove();
      dots.remove();
    },
  };
};
