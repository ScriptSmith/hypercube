import type { FrameInfo, Palette, Pointer } from "../../core/types";

/** Radius of a drawn touch: half the 120 venue px minimum target, so targets can be judged. */
const TOUCH_RADIUS = 60;
const ADULT = "#5ce0e0";
const CHILD = "#ff8c1a";

export interface Overlay {
  readonly canvas: HTMLCanvasElement;
  resize(frame: FrameInfo): void;
  draw(frame: FrameInfo, pointers: ReadonlyMap<number, Pointer>, labelPx: number): void;
}

export const createOverlay = (host: HTMLElement, palette: Palette): Overlay => {
  const canvas = document.createElement("canvas");
  canvas.className = "dg-overlay";
  host.append(canvas);
  const g = canvas.getContext("2d");

  const label = (text: string, x: number, y: number, color: string, px: number) => {
    if (!g) return;
    g.save();
    g.setLineDash([]);
    g.font = `600 ${px}px system-ui, sans-serif`;
    g.lineWidth = Math.max(2, px * 0.18);
    g.strokeStyle = "rgba(0,0,0,0.85)";
    g.strokeText(text, x, y);
    g.fillStyle = color;
    g.fillText(text, x, y);
    g.restore();
  };

  return {
    canvas,
    resize(frame) {
      canvas.width = Math.max(1, Math.round(frame.width * frame.pixelRatio));
      canvas.height = Math.max(1, Math.round(frame.height * frame.pixelRatio));
    },
    draw(frame, pointers, labelPx) {
      if (!g) return;
      const { width: w, height: h, unit } = frame;
      g.setTransform(frame.pixelRatio, 0, 0, frame.pixelRatio, 0, 0);
      g.clearRect(0, 0, w, h);
      const line = Math.max(1, 4 * unit);

      if (frame.touch) {
        g.lineWidth = line;
        g.setLineDash([24 * unit, 14 * unit]);
        g.textBaseline = "top";
        g.textAlign = "right";
        const same = frame.reach.adult === frame.reach.child;
        for (const [who, color] of [
          ["adult", ADULT],
          ["child", CHILD],
        ] as const) {
          const y = Math.min(h - line, Math.max(line / 2, frame.reachTop[who]));
          g.strokeStyle = color;
          g.beginPath();
          g.moveTo(0, y);
          g.lineTo(w, y);
          g.stroke();
          if (same && who === "adult") continue;
          const pct = Math.round(frame.reach[who] * 100);
          const text = same ? `adult and child reach ${pct}%` : `${who} reach ${pct}%`;
          label(text, w - labelPx * 0.5, y + line * 2, color, labelPx * 0.8);
        }
        g.setLineDash([]);
      }

      g.strokeStyle = palette.danger;
      g.lineWidth = line;
      g.setLineDash([10 * unit, 10 * unit]);
      for (const x of frame.seams) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, h);
        g.stroke();
      }
      g.setLineDash([]);

      const r = TOUCH_RADIUS * unit;
      g.textAlign = "center";
      g.textBaseline = "bottom";
      for (const p of pointers.values()) {
        const color = palette.players[Math.abs(p.id) % palette.players.length] ?? "#fff";
        g.globalAlpha = 0.35;
        g.strokeStyle = color;
        g.lineWidth = Math.max(1, 2 * unit);
        g.beginPath();
        g.moveTo(0, p.y);
        g.lineTo(w, p.y);
        g.moveTo(p.x, 0);
        g.lineTo(p.x, h);
        g.stroke();
        g.globalAlpha = 0.3;
        g.fillStyle = color;
        g.beginPath();
        g.arc(p.x, p.y, r, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
        g.lineWidth = line;
        if (p.synthetic) g.setLineDash([12 * unit, 8 * unit]);
        g.stroke();
        g.setLineDash([]);
        const tag = p.synthetic ? "bot " : "";
        const text = `${tag}#${p.id}  ${Math.round(p.x)}, ${Math.round(p.y)}`;
        g.font = `600 ${labelPx}px system-ui, sans-serif`;
        const half = g.measureText(text).width / 2;
        const lx = Math.min(w - half, Math.max(half, p.x));
        const ly = Math.max(labelPx, p.y - r - line);
        label(text, lx, ly, color, labelPx);
      }
    },
  };
};
