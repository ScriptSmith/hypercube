/**
 * Our own flat pictures, drawn with Canvas2D on a 100-unit box centred on the origin (y down):
 * the items, the bins' front pictures and the park's things. No brands, logos or words; each
 * item has a clear silhouette and a dark outline so it reads on any background.
 */
import type { BinKind, ItemId } from "./items";
import type { ThingKind } from "./park";

type G = CanvasRenderingContext2D;

const INK = "#1b2130";
const LINE = 3.6;

const rr = (g: G, x: number, y: number, w: number, h: number, r: number) => {
  const k = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + k, y);
  g.arcTo(x + w, y, x + w, y + h, k);
  g.arcTo(x + w, y + h, x, y + h, k);
  g.arcTo(x, y + h, x, y, k);
  g.arcTo(x, y, x + w, y, k);
  g.closePath();
};

const paint = (g: G, fill: string | CanvasGradient, line = LINE) => {
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = line;
  g.strokeStyle = INK;
  g.lineJoin = "round";
  g.lineCap = "round";
  g.stroke();
};

const shine = (g: G, x: number, y: number, w: number, h: number, a = 0.45) => {
  g.save();
  g.globalAlpha = a;
  g.fillStyle = "#ffffff";
  rr(g, x, y, w, h, Math.min(w, h) / 2);
  g.fill();
  g.restore();
};

const strokeOnly = (g: G, color: string, width: number) => {
  g.lineWidth = width;
  g.strokeStyle = color;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.stroke();
};

const vgrad = (g: G, x0: number, x1: number, stops: [number, string][]) => {
  const gr = g.createLinearGradient(x0, 0, x1, 0);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  return gr;
};

// ---- Items --------------------------------------------------------------------------------

const can = (g: G) => {
  rr(g, -21, -38, 42, 78, 7);
  paint(
    g,
    vgrad(g, -21, 21, [
      [0, "#9aa6b4"],
      [0.35, "#eef2f6"],
      [0.6, "#c9d1da"],
      [1, "#8792a0"],
    ]),
  );
  g.beginPath();
  g.rect(-19, -12, 38, 26);
  g.fillStyle = "#23b39f";
  g.fill();
  g.beginPath();
  g.moveTo(-19, 2);
  g.bezierCurveTo(-8, -8, 6, 10, 19, -2);
  strokeOnly(g, "#ffffff", 4);
  g.beginPath();
  g.ellipse(0, -36, 18, 5, 0, 0, Math.PI * 2);
  paint(g, "#b9c2cc", 3);
  rr(g, -6, -41, 12, 6, 3);
  paint(g, "#dfe5eb", 2.4);
};

const tin = (g: G) => {
  rr(g, -29, -30, 58, 64, 6);
  paint(
    g,
    vgrad(g, -29, 29, [
      [0, "#8d97a3"],
      [0.4, "#e3e8ee"],
      [1, "#7c8693"],
    ]),
  );
  for (const y of [-14, 2, 18]) {
    g.beginPath();
    g.moveTo(-27, y);
    g.lineTo(27, y);
    strokeOnly(g, "rgba(40,50,64,0.55)", 2.6);
  }
  g.beginPath();
  g.ellipse(0, -30, 28, 7, 0, 0, Math.PI * 2);
  paint(g, "#c5cdd6", 3);
  g.beginPath();
  g.ellipse(0, -30, 20, 4.5, 0, 0, Math.PI * 2);
  strokeOnly(g, "rgba(40,50,64,0.5)", 2);
};

const jar = (g: G) => {
  rr(g, -18, -42, 36, 14, 4);
  paint(g, "rgba(178,226,240,0.9)");
  for (const y of [-38, -33]) {
    g.beginPath();
    g.moveTo(-16, y);
    g.lineTo(16, y);
    strokeOnly(g, "rgba(40,80,100,0.6)", 2);
  }
  rr(g, -28, -30, 56, 72, 14);
  paint(g, "rgba(160,215,235,0.92)");
  shine(g, -20, -22, 8, 46, 0.6);
  shine(g, 10, 14, 6, 14, 0.35);
};

const glassBottle = (g: G) => {
  g.beginPath();
  g.moveTo(-7, -46);
  g.lineTo(7, -46);
  g.lineTo(7, -22);
  g.bezierCurveTo(7, -14, 19, -10, 19, 2);
  g.lineTo(19, 40);
  g.quadraticCurveTo(19, 46, 13, 46);
  g.lineTo(-13, 46);
  g.quadraticCurveTo(-19, 46, -19, 40);
  g.lineTo(-19, 2);
  g.bezierCurveTo(-19, -10, -7, -14, -7, -22);
  g.closePath();
  paint(
    g,
    vgrad(g, -19, 19, [
      [0, "#1e7a45"],
      [0.4, "#3fbd73"],
      [1, "#1a6b3c"],
    ]),
  );
  rr(g, -9, -48, 18, 7, 3);
  paint(g, "#2c9a5a", 3);
  shine(g, -14, -2, 6, 38, 0.5);
};

const plasticBottle = (g: G) => {
  g.beginPath();
  g.moveTo(-8, -42);
  g.lineTo(8, -42);
  g.lineTo(8, -32);
  g.bezierCurveTo(8, -26, 18, -24, 18, -14);
  g.lineTo(18, -4);
  g.quadraticCurveTo(13, 2, 18, 8);
  g.lineTo(18, 40);
  g.quadraticCurveTo(18, 46, 12, 46);
  g.lineTo(-12, 46);
  g.quadraticCurveTo(-18, 46, -18, 40);
  g.lineTo(-18, 8);
  g.quadraticCurveTo(-13, 2, -18, -4);
  g.lineTo(-18, -14);
  g.bezierCurveTo(-18, -24, -8, -26, -8, -32);
  g.closePath();
  paint(g, "rgba(140,205,255,0.85)");
  rr(g, -11, -46, 22, 6, 3);
  paint(g, "#bfe4ff", 3);
  for (const y of [18, 30]) {
    g.beginPath();
    g.moveTo(-16, y);
    g.lineTo(16, y);
    strokeOnly(g, "rgba(40,90,140,0.5)", 2);
  }
  shine(g, -13, -16, 5, 18, 0.65);
  shine(g, -13, 12, 5, 26, 0.5);
};

const milk = (g: G) => {
  g.beginPath();
  g.moveTo(-9, -44);
  g.lineTo(9, -44);
  g.lineTo(9, -32);
  g.lineTo(26, -14);
  g.lineTo(26, 38);
  g.quadraticCurveTo(26, 46, 18, 46);
  g.lineTo(-18, 46);
  g.quadraticCurveTo(-26, 46, -26, 38);
  g.lineTo(-26, -14);
  g.lineTo(-9, -32);
  g.closePath();
  paint(
    g,
    vgrad(g, -26, 26, [
      [0, "#d8dde4"],
      [0.4, "#ffffff"],
      [1, "#cfd5dd"],
    ]),
  );
  // The handle: a window through the jug's shoulder.
  rr(g, 6, -16, 14, 24, 6);
  paint(g, "#0f1522", 3);
  rr(g, -11, -48, 22, 7, 3);
  paint(g, "#3b8fe0", 3);
  g.beginPath();
  g.rect(-24, 22, 48, 8);
  g.fillStyle = "#3b8fe0";
  g.fill();
};

const newspaper = (g: G) => {
  g.save();
  g.rotate(-0.08);
  rr(g, -38, -30, 76, 62, 3);
  paint(g, "#efede4");
  g.beginPath();
  g.moveTo(0, -30);
  g.lineTo(0, 32);
  strokeOnly(g, "rgba(60,60,60,0.35)", 2);
  rr(g, -32, -24, 28, 7, 2);
  g.fillStyle = "#5a5f6a";
  g.fill();
  rr(g, -32, -12, 28, 18, 2);
  g.fillStyle = "#8fa9c4";
  g.fill();
  for (let i = 0; i < 6; i++) {
    const y = -22 + i * 8;
    g.beginPath();
    g.moveTo(5, y);
    g.lineTo(32, y);
    strokeOnly(g, "#a5a8b0", 2.4);
  }
  for (let i = 0; i < 3; i++) {
    const y = 12 + i * 7;
    g.beginPath();
    g.moveTo(-32, y);
    g.lineTo(-5, y);
    strokeOnly(g, "#a5a8b0", 2.4);
  }
  g.restore();
};

const box = (g: G) => {
  rr(g, -40, -28, 80, 58, 3);
  paint(g, "#c98f52");
  g.beginPath();
  g.moveTo(-40, -8);
  g.lineTo(40, -8);
  g.moveTo(-14, -28);
  g.lineTo(-14, 30);
  g.moveTo(14, -28);
  g.lineTo(14, 30);
  strokeOnly(g, "rgba(90,52,20,0.55)", 2.4);
  g.beginPath();
  g.rect(-40, -15, 80, 11);
  g.fillStyle = "#e6c58c";
  g.fill();
  g.beginPath();
  g.rect(-40, -28, 80, 58);
  strokeOnly(g, INK, LINE);
};

const apple = (g: G) => {
  // Skin at the top and bottom, a bitten core between.
  g.beginPath();
  g.moveTo(-22, -30);
  g.bezierCurveTo(-24, -42, 24, -42, 22, -30);
  g.bezierCurveTo(10, -24, 8, -14, 9, -4);
  g.bezierCurveTo(10, 8, 12, 18, 22, 26);
  g.bezierCurveTo(24, 40, -24, 40, -22, 26);
  g.bezierCurveTo(-12, 18, -10, 8, -9, -4);
  g.bezierCurveTo(-8, -14, -10, -24, -22, -30);
  g.closePath();
  paint(g, "#f6e6b4");
  g.beginPath();
  g.moveTo(-22, -30);
  g.bezierCurveTo(-24, -42, 24, -42, 22, -30);
  g.bezierCurveTo(10, -27, -10, -27, -22, -30);
  paint(g, "#e5413b", 3);
  g.beginPath();
  g.moveTo(-22, 26);
  g.bezierCurveTo(-24, 40, 24, 40, 22, 26);
  g.bezierCurveTo(10, 29, -10, 29, -22, 26);
  paint(g, "#e5413b", 3);
  for (const [x, y] of [
    [-3, -2],
    [3, 4],
  ]) {
    g.beginPath();
    g.ellipse(x!, y!, 2.6, 4.2, 0.3, 0, Math.PI * 2);
    g.fillStyle = "#5b3418";
    g.fill();
  }
  g.beginPath();
  g.moveTo(0, -38);
  g.quadraticCurveTo(2, -46, 6, -48);
  strokeOnly(g, "#5b3418", 4);
  g.beginPath();
  g.ellipse(9, -44, 7, 3.5, -0.5, 0, Math.PI * 2);
  paint(g, "#5fc24a", 2.4);
};

const banana = (g: G) => {
  const flap = (rot: number, color: string) => {
    g.save();
    g.rotate(rot);
    g.beginPath();
    g.moveTo(-6, -16);
    g.bezierCurveTo(-18, 0, -16, 22, -6, 40);
    g.quadraticCurveTo(-1, 44, 2, 38);
    g.bezierCurveTo(6, 20, 8, 2, 6, -16);
    g.closePath();
    paint(g, color);
    g.beginPath();
    g.moveTo(-6, 36);
    g.quadraticCurveTo(-1, 44, 2, 38);
    strokeOnly(g, "#6b4a12", 5);
    g.restore();
  };
  flap(0.9, "#f2c62e");
  flap(-0.9, "#f2c62e");
  flap(0.15, "#f9da4a");
  g.beginPath();
  g.moveTo(-6, -16);
  g.lineTo(6, -16);
  g.lineTo(4, -36);
  g.lineTo(-4, -36);
  g.closePath();
  paint(g, "#c9a12a", 3);
  rr(g, -4, -42, 8, 7, 2);
  paint(g, "#6b4a12", 2.4);
};

const leaf = (g: G, x: number, y: number, rot: number, color: string, size = 1) => {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.scale(size, size);
  g.beginPath();
  g.moveTo(0, 0);
  g.bezierCurveTo(10, -10, 30, -8, 36, 0);
  g.bezierCurveTo(30, 8, 10, 10, 0, 0);
  g.closePath();
  paint(g, color, 3);
  g.beginPath();
  g.moveTo(2, 0);
  g.lineTo(32, 0);
  strokeOnly(g, "rgba(60,30,10,0.45)", 2);
  g.restore();
};

const leaves = (g: G) => {
  g.beginPath();
  g.moveTo(-34, 30);
  g.quadraticCurveTo(-4, 10, 30, -34);
  strokeOnly(g, INK, 9);
  g.beginPath();
  g.moveTo(-34, 30);
  g.quadraticCurveTo(-4, 10, 30, -34);
  strokeOnly(g, "#7a4a24", 5);
  leaf(g, -18, 18, -1.9, "#f08a24", 1.05);
  leaf(g, 2, 2, -0.2, "#c8452f", 1.1);
  leaf(g, 16, -18, -2.2, "#c9c23a", 1);
  leaf(g, 22, -26, 0.2, "#e2a02a", 0.8);
};

const bread = (g: G) => {
  g.beginPath();
  g.moveTo(-40, 18);
  g.bezierCurveTo(-42, -30, 42, -30, 40, 18);
  g.lineTo(30, 22);
  g.bezierCurveTo(30, -14, -30, -14, -30, 22);
  g.closePath();
  paint(g, "#b8692a");
  g.beginPath();
  g.moveTo(-30, 22);
  g.bezierCurveTo(-30, -14, 30, -14, 30, 22);
  strokeOnly(g, "#f0cf8e", 4);
  for (const [x, y] of [
    [-22, -6],
    [0, -16],
    [22, -6],
  ]) {
    g.beginPath();
    g.ellipse(x!, y!, 3, 1.6, 0, 0, Math.PI * 2);
    g.fillStyle = "#e8b878";
    g.fill();
  }
};

const shellHalf = (g: G, flip: number) => {
  g.save();
  g.scale(flip, 1);
  g.beginPath();
  g.moveTo(-26, -2);
  g.lineTo(-18, -10);
  g.lineTo(-10, -2);
  g.lineTo(-2, -12);
  g.lineTo(6, -3);
  g.lineTo(14, -11);
  g.lineTo(22, -2);
  g.bezierCurveTo(26, 22, -30, 22, -26, -2);
  g.closePath();
  paint(g, "#f6ecdc");
  g.beginPath();
  g.moveTo(-20, 2);
  g.bezierCurveTo(-18, 12, 14, 14, 18, 2);
  strokeOnly(g, "rgba(170,140,100,0.45)", 3);
  g.restore();
};

const eggshell = (g: G) => {
  g.save();
  g.translate(-12, 8);
  g.rotate(-0.35);
  shellHalf(g, 1);
  g.restore();
  g.save();
  g.translate(14, -14);
  g.rotate(0.5);
  g.scale(0.85, 0.85);
  shellHalf(g, -1);
  g.restore();
};

const crisp = (g: G, x: number, y: number, rot: number, s = 1) => {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.scale(s, s);
  g.beginPath();
  g.moveTo(-13, 0);
  g.bezierCurveTo(-12, -11, 12, -11, 13, 0);
  g.bezierCurveTo(12, 11, -12, 11, -13, 0);
  g.closePath();
  paint(g, "#f8d35a", 2.6);
  g.beginPath();
  g.moveTo(-8, -1);
  g.quadraticCurveTo(-3, 4, 1, -1);
  g.quadraticCurveTo(5, -5, 9, 0);
  strokeOnly(g, "rgba(196,132,28,0.8)", 2);
  g.restore();
};

const chips = (g: G) => {
  // An opened, puffy packet with chips showing at the top. Flat colour with creases rather
  // than a can's round shading, and crimped seals, so it can't read as a can.
  g.beginPath();
  g.ellipse(0, -18, 34, 9, 0, 0, Math.PI * 2);
  paint(g, "#9aa3b2", 2.6);
  crisp(g, -15, -29, -0.5);
  crisp(g, 15, -27, 0.7);
  crisp(g, 1, -34, 0.15);
  g.beginPath();
  g.ellipse(0, -18, 34, 9, 0, Math.PI, 0, true);
  g.bezierCurveTo(39, 0, 39, 16, 36, 30);
  g.lineTo(-36, 30);
  g.bezierCurveTo(-39, 16, -39, 0, -34, -18);
  g.closePath();
  paint(g, "#9a45c8");
  g.beginPath();
  g.moveTo(-34, 30);
  g.lineTo(-26, 20);
  g.moveTo(34, 30);
  g.lineTo(26, 20);
  g.moveTo(-28, -6);
  g.lineTo(-20, 2);
  g.moveTo(24, -4);
  g.lineTo(30, 6);
  strokeOnly(g, "rgba(60,16,84,0.6)", 2);
  // Crimped bottom seal.
  rr(g, -38, 28, 76, 12, 2);
  paint(g, "#c58ae6", 2.6);
  g.beginPath();
  for (let i = 1; i < 12; i++) {
    g.moveTo(-38 + i * 6.33, 30);
    g.lineTo(-38 + i * 6.33, 38);
  }
  strokeOnly(g, "rgba(90,33,120,0.55)", 1.6);
  // The picture on the front: one big chip.
  crisp(g, 0, 8, -0.2, 1.4);
  shine(g, -30, -4, 5, 20, 0.3);
};

const toy = (g: G) => {
  // A toy car with a wheel come off.
  g.beginPath();
  g.moveTo(-38, 10);
  g.lineTo(-38, -4);
  g.lineTo(-24, -6);
  g.lineTo(-14, -24);
  g.lineTo(14, -24);
  g.lineTo(26, -6);
  g.lineTo(38, -2);
  g.lineTo(38, 10);
  g.closePath();
  paint(g, "#e8483c");
  g.beginPath();
  g.moveTo(-10, -19);
  g.lineTo(-4, -19);
  g.lineTo(-4, -7);
  g.lineTo(-18, -7);
  g.closePath();
  paint(g, "#9fd8ff", 2.6);
  g.beginPath();
  g.moveTo(2, -19);
  g.lineTo(11, -19);
  g.lineTo(19, -7);
  g.lineTo(2, -7);
  g.closePath();
  paint(g, "#9fd8ff", 2.6);
  // Crack.
  g.beginPath();
  g.moveTo(-30, -2);
  g.lineTo(-24, 3);
  g.lineTo(-28, 8);
  strokeOnly(g, INK, 2.4);
  g.beginPath();
  g.arc(-20, 12, 10, 0, Math.PI * 2);
  paint(g, "#2a2f3a");
  g.beginPath();
  g.arc(-20, 12, 4, 0, Math.PI * 2);
  g.fillStyle = "#c8ced8";
  g.fill();
  // The loose wheel, rolled away.
  g.beginPath();
  g.arc(26, 32, 10, 0, Math.PI * 2);
  paint(g, "#2a2f3a");
  g.beginPath();
  g.arc(26, 32, 4, 0, Math.PI * 2);
  g.fillStyle = "#c8ced8";
  g.fill();
};

/** A closed polygon with its corners rounded by `r`. */
const roundQuad = (g: G, pts: number[], r: number) => {
  const n = pts.length / 2;
  const at = (i: number) => [pts[(i % n) * 2]!, pts[(i % n) * 2 + 1]!] as const;
  const [x0, y0] = at(0);
  const [x1, y1] = at(1);
  g.beginPath();
  g.moveTo((x0 + x1) / 2, (y0 + y1) / 2);
  for (let i = 1; i <= n; i++) {
    const [cx, cy] = at(i);
    const [nx, ny] = at(i + 1);
    g.arcTo(cx, cy, nx, ny, r);
  }
  g.closePath();
};

const foam = (g: G) => {
  // An empty foam takeaway box, open, seen from above: the lid stands up at the back with its
  // latch tab, and the tray's shadowed floor shows it is a container. Beady dots for
  // polystyrene, rounded corners so it can't pass for a laptop.
  roundQuad(g, [-32, -4, -27, -36, 27, -36, 32, -4], 9);
  paint(g, "#e9edf1");
  rr(g, -7, -45, 14, 11, 3);
  paint(g, "#e9edf1", 2.6);
  roundQuad(g, [-25, -8, -21, -30, 21, -30, 25, -8], 7);
  paint(g, "#d3d9e0", 2.2);
  roundQuad(g, [-42, 14, -34, -4, 34, -4, 42, 14], 7);
  paint(g, "#f5f7f9");
  roundQuad(g, [-33, 10, -27, 0, 27, 0, 33, 10], 5);
  paint(g, "#b3bcc8", 2.2);
  roundQuad(g, [-42, 14, 42, 14, 36, 40, -36, 40], 8);
  paint(g, "#e3e7ec");
  g.beginPath();
  g.moveTo(-6, 18);
  g.lineTo(6, 18);
  strokeOnly(g, INK, 3);
  g.fillStyle = "rgba(120,130,145,0.5)";
  for (const [x, y] of [
    [-12, -22],
    [0, -25],
    [12, -22],
    [-7, -13],
    [7, -13],
    [-26, 24],
    [-10, 30],
    [10, 30],
    [26, 24],
  ]) {
    g.beginPath();
    g.arc(x!, y!, 2, 0, Math.PI * 2);
    g.fill();
  }
};

const mug = (g: G) => {
  g.beginPath();
  g.arc(24, 2, 13, -Math.PI / 2, Math.PI / 2);
  strokeOnly(g, INK, 11);
  g.beginPath();
  g.arc(24, 2, 13, -Math.PI / 2, Math.PI / 2);
  strokeOnly(g, "#3d7dd8", 6);
  // The body with a piece broken out of the rim.
  g.beginPath();
  g.moveTo(-26, -24);
  g.lineTo(-8, -24);
  g.lineTo(-2, -14);
  g.lineTo(5, -20);
  g.lineTo(9, -24);
  g.lineTo(24, -24);
  g.lineTo(24, 28);
  g.quadraticCurveTo(24, 34, 18, 34);
  g.lineTo(-20, 34);
  g.quadraticCurveTo(-26, 34, -26, 28);
  g.closePath();
  paint(g, "#3d7dd8");
  g.beginPath();
  g.moveTo(-2, -14);
  g.lineTo(-6, -2);
  g.lineTo(0, 8);
  strokeOnly(g, INK, 2.4);
  shine(g, -20, -16, 5, 36, 0.35);
  // The broken-off piece.
  g.beginPath();
  g.moveTo(-34, 40);
  g.lineTo(-26, 34);
  g.lineTo(-20, 41);
  g.lineTo(-27, 46);
  g.closePath();
  paint(g, "#3d7dd8", 3);
};

const cell = (g: G, x: number, y: number, rot: number) => {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  rr(g, -11, -32, 22, 64, 6);
  paint(g, "#4c5260");
  g.beginPath();
  g.rect(-11, -32, 22, 20);
  g.fillStyle = "#39c46b";
  g.fill();
  rr(g, -11, -32, 22, 64, 6);
  strokeOnly(g, INK, LINE);
  rr(g, -5, -38, 10, 7, 2);
  paint(g, "#c9ced8", 2.4);
  g.beginPath();
  g.moveTo(-5, -22);
  g.lineTo(5, -22);
  g.moveTo(0, -27);
  g.lineTo(0, -17);
  strokeOnly(g, "#ffffff", 3);
  shine(g, -8, -6, 4, 32, 0.3);
  g.restore();
};

const battery = (g: G) => {
  cell(g, -13, 4, -0.18);
  cell(g, 14, 2, 0.14);
};

const phone = (g: G) => {
  g.save();
  g.rotate(0.12);
  rr(g, -22, -42, 44, 84, 9);
  paint(g, "#2c3242");
  rr(g, -17, -34, 34, 60, 3);
  g.fillStyle = "#3f6488";
  g.fill();
  g.beginPath();
  g.moveTo(-12, -30);
  g.lineTo(-2, -14);
  g.lineTo(-8, -4);
  g.lineTo(6, 10);
  g.moveTo(-2, -14);
  g.lineTo(12, -22);
  strokeOnly(g, "rgba(255,255,255,0.75)", 2);
  g.beginPath();
  g.arc(0, 34, 4.5, 0, Math.PI * 2);
  strokeOnly(g, "#8a93a6", 2.4);
  g.beginPath();
  g.arc(0, -38, 1.8, 0, Math.PI * 2);
  g.fillStyle = "#8a93a6";
  g.fill();
  g.restore();
};

const ITEM_DRAW: Record<ItemId, (g: G) => void> = {
  can,
  tin,
  jar,
  glassBottle,
  plasticBottle,
  milk,
  newspaper,
  box,
  apple,
  banana,
  leaves,
  bread,
  eggshell,
  chips,
  toy,
  foam,
  mug,
  battery,
  phone,
};

/** Draw an item centred at (x, y), `size` across. */
export const drawItem = (g: G, id: ItemId, x: number, y: number, size: number, angle = 0): void => {
  g.save();
  g.translate(x, y);
  if (angle) g.rotate(angle);
  g.scale(size / 100, size / 100);
  ITEM_DRAW[id](g);
  g.restore();
};

// ---- Bin pictures -------------------------------------------------------------------------

const bag = (g: G) => {
  g.beginPath();
  g.moveTo(-8, -30);
  g.bezierCurveTo(-30, -20, -36, 30, -20, 38);
  g.lineTo(20, 38);
  g.bezierCurveTo(36, 30, 30, -20, 8, -30);
  g.closePath();
  paint(g, "#3a404d");
  g.beginPath();
  g.moveTo(-8, -30);
  g.lineTo(-14, -42);
  g.moveTo(8, -30);
  g.lineTo(14, -42);
  strokeOnly(g, INK, 7);
  g.beginPath();
  g.moveTo(-8, -30);
  g.lineTo(-14, -42);
  g.moveTo(8, -30);
  g.lineTo(14, -42);
  strokeOnly(g, "#3a404d", 3.5);
  shine(g, -18, -6, 5, 28, 0.25);
};

/** The picture on a bin's front: two of the things that go in it. */
export const drawBinPicture = (g: G, kind: BinKind, x: number, y: number, size: number) => {
  const two = (a: ItemId, b: ItemId) => {
    drawItem(g, a, x - size * 0.24, y, size * 0.56, -0.12);
    drawItem(g, b, x + size * 0.24, y, size * 0.56, 0.12);
  };
  if (kind === "recycle") two("plasticBottle", "can");
  else if (kind === "compost") two("apple", "leaves");
  else if (kind === "dropoff") two("battery", "phone");
  else {
    g.save();
    g.translate(x, y);
    g.scale((size * 0.62) / 100, (size * 0.62) / 100);
    bag(g);
    g.restore();
  }
};

// ---- Park things ----------------------------------------------------------------------------

const bike = (g: G) => {
  for (const x of [-26, 26]) {
    g.beginPath();
    g.arc(x, 26, 20, 0, Math.PI * 2);
    strokeOnly(g, INK, 8);
    g.beginPath();
    g.arc(x, 26, 20, 0, Math.PI * 2);
    strokeOnly(g, "#3a404d", 4);
    g.beginPath();
    g.arc(x, 26, 3, 0, Math.PI * 2);
    g.fillStyle = "#c9ced8";
    g.fill();
  }
  g.beginPath();
  g.moveTo(-26, 26);
  g.lineTo(-6, -6);
  g.lineTo(18, -6);
  g.lineTo(26, 26);
  g.moveTo(-6, -6);
  g.lineTo(2, 26);
  g.lineTo(18, -6);
  g.moveTo(-26, 26);
  g.lineTo(2, 26);
  strokeOnly(g, INK, 8);
  g.beginPath();
  g.moveTo(-26, 26);
  g.lineTo(-6, -6);
  g.lineTo(18, -6);
  g.lineTo(26, 26);
  g.moveTo(-6, -6);
  g.lineTo(2, 26);
  g.lineTo(18, -6);
  g.moveTo(-26, 26);
  g.lineTo(2, 26);
  strokeOnly(g, "#1fb5a8", 4.5);
  g.beginPath();
  g.moveTo(-8, -6);
  g.lineTo(-12, -16);
  strokeOnly(g, INK, 5);
  rr(g, -22, -21, 18, 6, 3);
  paint(g, "#3a404d", 2.6);
  g.beginPath();
  g.moveTo(18, -6);
  g.lineTo(14, -20);
  g.lineTo(24, -22);
  strokeOnly(g, INK, 5);
};

const bench = (g: G) => {
  for (const x of [-30, 30]) {
    rr(g, x - 4, 4, 8, 42, 2);
    paint(g, "#3a404d", 3);
  }
  for (const y of [-26, -14]) {
    rr(g, -44, y, 88, 9, 3);
    paint(g, "#6fa4fc", 3);
  }
  rr(g, -46, 2, 92, 10, 3);
  paint(g, "#fb5c99", 3);
  for (const x of [-30, 30]) {
    rr(g, x - 3, -28, 6, 32, 2);
    paint(g, "#3a404d", 2.6);
  }
};

const jamJar = (g: G) => {
  rr(g, -30, -12, 60, 58, 12);
  paint(g, "rgba(170,220,240,0.9)");
  rr(g, -26, 0, 52, 42, 9);
  g.fillStyle = "#c2265a";
  g.fill();
  rr(g, -26, -22, 52, 12, 3);
  paint(g, "#e9b43a");
  g.beginPath();
  g.moveTo(-34, -20);
  g.lineTo(-26, -40);
  g.lineTo(-14, -30);
  g.lineTo(0, -42);
  g.lineTo(14, -30);
  g.lineTo(26, -40);
  g.lineTo(34, -20);
  g.closePath();
  paint(g, "#ff6f6f", 3);
  g.fillStyle = "#ffffff";
  for (const [x, y] of [
    [-18, -28],
    [0, -32],
    [18, -28],
  ]) {
    g.beginPath();
    g.arc(x!, y!, 3, 0, Math.PI * 2);
    g.fill();
  }
  shine(g, -22, 4, 6, 30, 0.45);
};

const book = (g: G) => {
  g.beginPath();
  g.moveTo(0, -18);
  g.bezierCurveTo(-16, -30, -36, -28, -46, -22);
  g.lineTo(-46, 36);
  g.bezierCurveTo(-36, 30, -16, 30, 0, 42);
  g.bezierCurveTo(16, 30, 36, 30, 46, 36);
  g.lineTo(46, -22);
  g.bezierCurveTo(36, -28, 16, -30, 0, -18);
  g.closePath();
  paint(g, "#3d7dd8");
  g.beginPath();
  g.moveTo(0, -14);
  g.bezierCurveTo(-14, -24, -32, -22, -40, -18);
  g.lineTo(-40, 30);
  g.bezierCurveTo(-30, 26, -14, 26, 0, 36);
  g.bezierCurveTo(14, 26, 30, 26, 40, 30);
  g.lineTo(40, -18);
  g.bezierCurveTo(32, -22, 14, -24, 0, -14);
  g.closePath();
  paint(g, "#fbf7ec", 3);
  for (let i = 0; i < 4; i++) {
    const y = -6 + i * 9;
    g.beginPath();
    g.moveTo(-32, y);
    g.lineTo(-8, y + 3);
    g.moveTo(8, y + 3);
    g.lineTo(32, y);
    strokeOnly(g, "#b9bcc6", 2.4);
  }
  g.beginPath();
  g.moveTo(0, -14);
  g.lineTo(0, 36);
  strokeOnly(g, INK, 2.4);
};

const tree = (g: G) => {
  rr(g, -7, 0, 14, 48, 3);
  paint(g, "#7a4a24");
  for (const [x, y, rad, c] of [
    [-20, -8, 22, "#4fae4a"],
    [20, -10, 22, "#4fae4a"],
    [0, -28, 26, "#62c25a"],
    [0, -6, 22, "#58b851"],
  ] as const) {
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    paint(g, c);
  }
  g.fillStyle = "#e5413b";
  for (const [x, y] of [
    [-16, -14],
    [12, -26],
    [18, 0],
    [-4, -38],
  ]) {
    g.beginPath();
    g.arc(x!, y!, 4.5, 0, Math.PI * 2);
    g.fill();
  }
};

const flowers = (g: G) => {
  const one = (x: number, top: number, petal: string) => {
    g.beginPath();
    g.moveTo(x, 46);
    g.quadraticCurveTo(x - 4, top + 30, x, top);
    strokeOnly(g, "#2f8a3a", 4);
    leaf(g, x, top + 34, -0.6, "#4fae4a", 0.5);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.beginPath();
      g.ellipse(x + Math.cos(a) * 8, top + Math.sin(a) * 8, 7, 5, a, 0, Math.PI * 2);
      paint(g, petal, 2.4);
    }
    g.beginPath();
    g.arc(x, top, 5, 0, Math.PI * 2);
    paint(g, "#f8d35a", 2.4);
  };
  one(-26, -4, "#fb5c99");
  one(0, -22, "#ad83d1");
  one(26, -2, "#f29b1d");
  rr(g, -44, 36, 88, 12, 4);
  paint(g, "#7a4a24", 3);
};

const lamp = (g: G) => {
  const glow = g.createRadialGradient(0, -30, 0, 0, -30, 40);
  glow.addColorStop(0, "rgba(255,226,120,0.85)");
  glow.addColorStop(1, "rgba(255,226,120,0)");
  g.fillStyle = glow;
  g.beginPath();
  g.arc(0, -30, 40, 0, Math.PI * 2);
  g.fill();
  rr(g, -4, -24, 8, 70, 3);
  paint(g, "#3a404d");
  rr(g, -12, 40, 24, 8, 3);
  paint(g, "#3a404d", 3);
  g.beginPath();
  g.moveTo(-14, -26);
  g.lineTo(14, -26);
  g.lineTo(8, -40);
  g.lineTo(-8, -40);
  g.closePath();
  paint(g, "#ffe27a", 3);
  rr(g, -10, -46, 20, 7, 3);
  paint(g, "#3a404d", 3);
  // The battery that powers it, at its foot.
  cellSmall(g, 18, 38);
};

const cellSmall = (g: G, x: number, y: number) => {
  g.save();
  g.translate(x, y);
  g.rotate(Math.PI / 2);
  g.scale(0.4, 0.4);
  cell(g, 0, 0, 0);
  g.restore();
};

const THING_DRAW: Record<ThingKind, (g: G) => void> = {
  bike,
  bench,
  jar: jamJar,
  book,
  tree,
  flowers,
  lamp,
};

/** Draw a park thing standing on (x, groundY), `size` tall. */
export const drawThing = (
  g: G,
  kind: ThingKind,
  x: number,
  groundY: number,
  size: number,
  angle = 0,
): void => {
  g.save();
  g.translate(x, groundY - size / 2);
  if (angle) g.rotate(angle);
  g.scale(size / 100, size / 100);
  THING_DRAW[kind](g);
  g.restore();
};

/** A simple translucent hand, finger pointing up at (x, y), for the attract mode's ghost. */
export const drawHand = (g: G, x: number, y: number, size: number, alpha: number) => {
  g.save();
  g.globalAlpha = alpha;
  g.translate(x - size * 0.42, y - size * 0.03);
  g.scale(size / 100, size / 100);
  g.fillStyle = "#f2f5fa";
  g.strokeStyle = "rgba(10,14,24,0.6)";
  g.lineWidth = 4;
  const shape = new Path2D();
  shape.roundRect(33, 3, 17, 62, 8.5);
  shape.roundRect(53, 44, 14, 26, 7);
  shape.roundRect(70, 47, 13, 24, 6.5);
  shape.roundRect(86, 51, 11, 22, 5.5);
  shape.moveTo(31, 58);
  shape.lineTo(97, 58);
  shape.lineTo(97, 74);
  shape.bezierCurveTo(97, 87, 87, 97, 74, 97);
  shape.lineTo(53, 97);
  shape.bezierCurveTo(40, 97, 31, 88, 31, 76);
  shape.closePath();
  g.stroke(shape);
  g.fill(shape);
  g.restore();
};
