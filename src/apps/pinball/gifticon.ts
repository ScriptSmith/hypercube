/**
 * The four gift icons, drawn in a coloured disc: a shield (ball save), two posts holding a ball
 * (outlanes closed), 2x (double scoring) and a ball with a plus (extra ball). Shared by the
 * deck's bubbles and the table's gift lamps, so a gift looks the same on both.
 */
import { FONT } from "../../core/ui/style";
import type { Gift } from "./config";

const INK = "#f7f9ff";

export const drawGiftIcon = (
  g: CanvasRenderingContext2D,
  kind: Gift,
  x: number,
  y: number,
  r: number,
  color: string,
) => {
  g.save();
  g.translate(x, y);
  g.fillStyle = color;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = INK;
  g.strokeStyle = INK;
  g.lineCap = "round";
  g.lineJoin = "round";
  const k = r / 10;
  if (kind === "shield") {
    g.beginPath();
    g.moveTo(-5.2 * k, -5.5 * k);
    g.quadraticCurveTo(0, -7.4 * k, 5.2 * k, -5.5 * k);
    g.lineTo(5.2 * k, -0.5 * k);
    g.quadraticCurveTo(4.6 * k, 4.6 * k, 0, 7 * k);
    g.quadraticCurveTo(-4.6 * k, 4.6 * k, -5.2 * k, -0.5 * k);
    g.closePath();
    g.fill();
  } else if (kind === "posts") {
    // Two posts with a ball held between them.
    for (const sx of [-1, 1]) {
      g.beginPath();
      g.roundRect(sx * 5 * k - 1.3 * k, -6.4 * k, 2.6 * k, 12.4 * k, 1.3 * k);
      g.fill();
    }
    g.beginPath();
    g.arc(0, 2.2 * k, 3 * k, 0, Math.PI * 2);
    g.fill();
  } else if (kind === "double") {
    g.font = `800 ${11 * k}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("2x", 0, 0.6 * k);
  } else {
    g.beginPath();
    g.arc(-1.4 * k, 1.4 * k, 4.6 * k, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 1.8 * k;
    g.beginPath();
    g.moveTo(5.2 * k, -6.4 * k);
    g.lineTo(5.2 * k, -1.6 * k);
    g.moveTo(2.8 * k, -4 * k);
    g.lineTo(7.6 * k, -4 * k);
    g.stroke();
  }
  g.restore();
};

/** A colour for each gift's disc. */
export const GIFT_COLOR: Record<Gift, string> = {
  shield: "#2bb673",
  posts: "#3a8dff",
  double: "#f08a24",
  extra: "#c04ad8",
};
