/**
 * Captions for the candling variant: the day in large type and one line under it, drawn three
 * times round a band of the ball (a third of a turn apart) on a canvas that the surface shader
 * looks up by room direction. Each copy is stretched across by 1 / cos(latitude), so it reads
 * in proportion from outside.
 */
import { CanvasTexture, LinearFilter, RepeatWrapping } from "three";
import { DEG } from "../../core/sphere";

/** Latitudes of the band, radians: top, then bottom. */
export const BAND = { top: -6 * DEG, bottom: -32 * DEG };
const DAY_LAT = -13 * DEG;
const LINE_LAT = -24.5 * DEG;
const DAY_SIZE = 6.2 * DEG;
const LINE_SIZE = 4.2 * DEG;
const COPIES = 3;

export interface Captions {
  readonly texture: CanvasTexture;
  /** Show `day` and `line` (either may be empty); returns true when the picture changed. */
  set(day: string, line: string): boolean;
  dispose(): void;
}

export const createCaptions = (width: number): Captions => {
  const w = Math.max(512, Math.min(4096, Math.round(width)));
  const perRad = w / (2 * Math.PI);
  const h = Math.max(32, Math.round((BAND.top - BAND.bottom) * perRad));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  let shown = "";

  const y = (lat: number) => (BAND.top - lat) * perRad;
  const write = (text: string, lat: number, size: number, weight: number) => {
    if (!g || !text) return;
    const stretch = 1 / Math.cos(lat);
    const px = size * perRad;
    g.font = `${weight} ${Math.round(px)}px system-ui, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const tw = g.measureText(text).width * stretch;
    for (let k = 0; k < COPIES; k++) {
      const x = ((k + 0.5) / COPIES) * w;
      for (const dx of [-w, 0, w]) {
        if (x + dx + tw / 2 < 0 || x + dx - tw / 2 > w) continue;
        g.setTransform(stretch, 0, 0, 1, x + dx, y(lat));
        g.lineJoin = "round";
        g.lineWidth = px * 0.2;
        g.strokeStyle = "rgba(20,10,4,0.85)";
        g.strokeText(text, 0, 0);
        g.fillStyle = "#fff4e2";
        g.fillText(text, 0, 0);
      }
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  };

  return {
    texture,
    set(day, line) {
      const key = `${day}\n${line}`;
      if (key === shown) return false;
      shown = key;
      if (!g) return false;
      g.clearRect(0, 0, w, h);
      write(day, DAY_LAT, DAY_SIZE, 800);
      write(line, LINE_LAT, LINE_SIZE, 650);
      texture.needsUpdate = true;
      return true;
    },
    dispose() {
      texture.dispose();
      canvas.width = 1;
      canvas.height = 1;
    },
  };
};
