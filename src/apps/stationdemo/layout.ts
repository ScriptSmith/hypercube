import type { FrameInfo, StationSpec } from "../../core/types";

/**
 * Stations for each frame kind, in stage px. On a pair each player keeps a tenth of the
 * width clear of the seam, so two hands are never within a fifth of the width across it.
 */
export const demoStations = (frame: FrameInfo, wallCount = 6): StationSpec[] => {
  const { width: w, height: h, unit } = frame;
  switch (frame.kind) {
    case "panel":
      return [{ id: "solo", rect: { x: 0, y: 0, width: w, height: h } }];
    case "pair": {
      const seam = frame.seams[0] ?? w / 2;
      const clear = w * 0.1;
      return [
        { id: "left", rect: { x: 0, y: 0, width: seam - clear, height: h } },
        { id: "right", rect: { x: seam + clear, y: 0, width: w - seam - clear, height: h } },
      ];
    }
    case "wall": {
      const n = Math.min(6, Math.max(4, Math.round(wallCount)));
      const top = Math.min(h - 400 * unit, Math.max(0, frame.reachTop.adult));
      const pad = 24 * unit;
      const each = w / n;
      return Array.from({ length: n }, (_, i) => ({
        id: `s${i + 1}`,
        rect: { x: i * each + pad, y: top, width: each - 2 * pad, height: h - top },
      }));
    }
    case "kiosk": {
      const gap = 60 * unit;
      return [
        { id: "left", rect: { x: 0, y: 0, width: w / 2 - gap, height: h } },
        { id: "right", rect: { x: w / 2 + gap, y: 0, width: w / 2 - gap, height: h } },
      ];
    }
    case "screen":
    case "sphere":
      return [];
  }
};
