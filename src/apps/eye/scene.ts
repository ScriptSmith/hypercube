/**
 * The scene every simulated view shows, drawn once per size with Canvas2D in three depth layers:
 * a view out of a window at about 60 m, a room at about 2.5 m, and an open picture book on a
 * table at 30 cm, with no words anywhere. Each layer is blurred by its own defocus.
 *
 * Positions are in degrees from the middle of the view (x right, y up), so the picture keeps
 * its real angular size at any aspect: a wide view shows less above and below, a tall one more.
 * The window's bars, the bookshelf and the striped tower give strong verticals and horizontals
 * (for astigmatism); reds and greens recur (for colour vision); the night picture has lamps,
 * whose light spreads into discs when out of focus. Lamps are listed separately so the view can
 * give them more light than a picture can hold.
 */

export interface Lamp {
  /** Canvas px from the top left. */
  x: number;
  y: number;
  /** Canvas px. */
  r: number;
  /** Linear light added at the centre, in units of white. */
  intensity: number;
  rgb: readonly [number, number, number];
}

export interface Layer {
  canvas: HTMLCanvasElement;
  lamps: Lamp[];
}

export interface SceneArt {
  far: Layer;
  mid: Layer;
  near: Layer;
  /** Where the eye looks, as fractions of width and height from the top left. */
  fix: { near: [number, number]; far: [number, number] };
}

export const MAX_LAMPS = 8;

/** The window opening in the room, degrees. */
export const WINDOW = { left: -6, right: 14, bottom: 0.5, top: 12 } as const;
/** The table's far edge and the book's top edge, degrees. */
export const TABLE_TOP = -3.2;
export const BOOK = { left: -12, right: 10, top: -4.2, spine: -1 } as const;

type G = CanvasRenderingContext2D;

const mk = (w: number, h: number): [HTMLCanvasElement, G | null] => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return [c, c.getContext("2d")];
};

/** A small seeded random stream, so the picture is the same every time. */
const stream = (seed: number) => {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
};

export const drawScene = (w: number, h: number, fovDeg: number, night: boolean): SceneArt => {
  const k = w / fovDeg;
  const X = (deg: number) => w / 2 + deg * k;
  const Y = (deg: number) => h / 2 - deg * k;
  const D = (deg: number) => deg * k;
  const lw = (deg: number) => Math.max(1, D(deg));

  // ---- Far: sky, hills, houses, a striped tower, trees ---------------------------------------
  const [farC, f] = mk(w, h);
  const farLamps: Lamp[] = [];
  if (f) {
    const horizon = Y(1.6);
    const sky = f.createLinearGradient(0, 0, 0, horizon);
    if (night) {
      sky.addColorStop(0, "#070b1c");
      sky.addColorStop(1, "#1b2547");
    } else {
      sky.addColorStop(0, "#5f9fdc");
      sky.addColorStop(1, "#cfe4f4");
    }
    f.fillStyle = sky;
    f.fillRect(0, 0, w, horizon + 2);
    const rnd = stream(7);
    if (night) {
      f.fillStyle = "#dfe6ff";
      for (let i = 0; i < 60; i++) {
        const sx = rnd() * w;
        const sy = rnd() * horizon * 0.95;
        f.globalAlpha = 0.35 + rnd() * 0.5;
        f.fillRect(sx, sy, lw(0.04), lw(0.04));
      }
      f.globalAlpha = 1;
      // The moon.
      f.fillStyle = "#f3f0de";
      f.beginPath();
      f.arc(X(9.5), Y(9.6), D(0.55), 0, Math.PI * 2);
      f.fill();
    } else {
      // Clouds: soft overlapping puffs.
      for (const [cx, cy, s] of [
        [-3, 9.5, 1.3],
        [5, 10.8, 1],
        [11.5, 8.6, 1.2],
      ] as const) {
        f.fillStyle = "rgba(255,255,255,0.88)";
        for (let i = 0; i < 5; i++) {
          f.beginPath();
          f.arc(X(cx + (i - 2) * 0.7 * s), Y(cy + (i % 2) * 0.3 * s), D(0.6 * s), 0, Math.PI * 2);
          f.fill();
        }
      }
    }
    // Two ranges of hills.
    const hills = (base: number, amp: number, col: string, seed: number) => {
      const r = stream(seed);
      const ph = r() * 6;
      f.fillStyle = col;
      f.beginPath();
      f.moveTo(0, h);
      for (let x = 0; x <= w; x += Math.max(2, w / 160)) {
        const deg = (x - w / 2) / k;
        const yy =
          base + amp * (0.55 + 0.45 * Math.sin(deg * 0.21 + ph) * Math.cos(deg * 0.09 + ph));
        f.lineTo(x, Y(yy));
      }
      f.lineTo(w, h);
      f.closePath();
      f.fill();
    };
    hills(1.6, 2.4, night ? "#1a2a3a" : "#8fb0c4", 3);
    hills(1.4, 1.2, night ? "#16261f" : "#6f9f6a", 5);
    f.fillStyle = night ? "#121d18" : "#7fae63";
    f.fillRect(0, Y(1.5), w, h - Y(1.5));
    // Fields: horizontal strips.
    for (let i = 0; i < 6; i++) {
      f.fillStyle = night ? "rgba(30,48,36,0.6)" : i % 2 ? "#8cba6c" : "#9fc777";
      f.fillRect(0, Y(1.2 - i * 0.45), w, D(0.22));
    }
    // A striped tower: strong verticals and horizontals far away.
    const tx = 2.2;
    f.fillStyle = night ? "#3b4252" : "#f4f1ea";
    f.fillRect(X(tx - 0.28), Y(9.2), D(0.56), D(9.2 - 1.4));
    f.fillStyle = night ? "#55303a" : "#c8473f";
    for (let i = 0; i < 6; i++) f.fillRect(X(tx - 0.28), Y(9.2 - i * 1.3), D(0.56), D(0.55));
    f.fillStyle = night ? "#2a3040" : "#4b5566";
    f.fillRect(X(tx - 0.5), Y(9.6), D(1), D(0.42));
    if (night)
      farLamps.push({ x: X(tx), y: Y(9.82), r: D(0.12), intensity: 14, rgb: [1, 0.35, 0.3] });
    // Houses along the horizon.
    const roofs = ["#b2533f", "#8a5a44", "#5b6f8a", "#a8613a", "#6d7f4e"];
    const walls = ["#f1e6d2", "#e7dccb", "#f6efe1", "#ded3bf"];
    for (let i = 0; i < 9; i++) {
      const hx = -5.4 + i * 2.1 + (rnd() - 0.5) * 0.6;
      if (Math.abs(hx - tx) < 0.8) continue;
      const hw = 0.9 + rnd() * 0.6;
      const hh = 0.6 + rnd() * 0.4;
      const base = 1.35;
      f.fillStyle = night ? "#20263a" : walls[i % walls.length]!;
      f.fillRect(X(hx - hw / 2), Y(base + hh), D(hw), D(hh));
      f.fillStyle = night ? "#161a2a" : roofs[i % roofs.length]!;
      f.beginPath();
      f.moveTo(X(hx - hw / 2 - 0.1), Y(base + hh));
      f.lineTo(X(hx), Y(base + hh + 0.5));
      f.lineTo(X(hx + hw / 2 + 0.1), Y(base + hh));
      f.closePath();
      f.fill();
      // Windows, lit at night.
      f.fillStyle = night ? "#ffd27a" : "#5b7590";
      for (let j = 0; j < 2; j++) {
        f.fillRect(X(hx - hw / 4 + j * hw * 0.32 - 0.08), Y(base + hh * 0.72), D(0.16), D(0.2));
      }
      if (night && i % 3 === 1) {
        farLamps.push({
          x: X(hx + hw / 2 + 0.25),
          y: Y(base + 0.62),
          r: D(0.09),
          intensity: 10,
          rgb: [1, 0.82, 0.55],
        });
        f.fillStyle = "#2a2f3a";
        f.fillRect(X(hx + hw / 2 + 0.23), Y(base + 0.6), lw(0.04), D(0.6));
      }
    }
    // Round trees in front of the houses.
    for (let i = 0; i < 12; i++) {
      const cx = -6 + i * 1.75 + (rnd() - 0.5);
      const r = 0.35 + rnd() * 0.3;
      f.fillStyle = night ? "#0f1f17" : i % 2 ? "#3f7f45" : "#4f8f4a";
      f.beginPath();
      f.arc(X(cx), Y(1.25 + r * 0.6), D(r), 0, Math.PI * 2);
      f.fill();
    }
    if (night && farLamps.length > MAX_LAMPS) farLamps.length = MAX_LAMPS;
  }

  // ---- Mid: the room, its window, a bookshelf, a lamp ----------------------------------------
  const [midC, m] = mk(w, h);
  const midLamps: Lamp[] = [];
  if (m) {
    m.fillStyle = night ? "#2a2e3e" : "#d9cfbf";
    m.fillRect(0, 0, w, h);
    // The ceiling line and a skirting board.
    m.fillStyle = night ? "#30354a" : "#ece6da";
    m.fillRect(0, 0, w, Y(16));
    m.fillStyle = night ? "#1f2230" : "#b9ab95";
    m.fillRect(0, Y(-2.6), w, D(0.5));
    // The window opening shows the far layer.
    const wl = X(WINDOW.left);
    const wr = X(WINDOW.right);
    const wt = Y(WINDOW.top);
    const wb = Y(WINDOW.bottom);
    m.clearRect(wl, wt, wr - wl, wb - wt);
    const frame = night ? "#c9ccd6" : "#fbfaf6";
    m.fillStyle = frame;
    const fw = D(0.45);
    m.fillRect(wl - fw, wt - fw, wr - wl + 2 * fw, fw);
    m.fillRect(wl - fw, wb, wr - wl + 2 * fw, fw * 1.6);
    m.fillRect(wl - fw, wt, fw, wb - wt);
    m.fillRect(wr, wt, fw, wb - wt);
    // The bars: one upright, one across.
    const bar = D(0.22);
    m.fillRect(X(4) - bar / 2, wt, bar, wb - wt);
    m.fillRect(wl, Y(6.25) - bar / 2, wr - wl, bar);
    // A curtain at the left of the window, in soft vertical folds.
    for (let i = 0; i < 5; i++) {
      m.fillStyle = i % 2 ? (night ? "#3b4f53" : "#5f9d94") : night ? "#33454a" : "#548b83";
      m.fillRect(
        X(WINDOW.left - 2.4 + i * 0.4),
        Y(WINDOW.top + 0.6),
        D(0.42),
        D(WINDOW.top - WINDOW.bottom + 1.8),
      );
    }
    // A bookshelf: shelves and spines.
    const sl = -20;
    const sr = -9.4;
    m.fillStyle = night ? "#3a2f2a" : "#8a6446";
    m.fillRect(X(sl), Y(11.5), D(sr - sl), D(11.5 + 3));
    const spines = [
      "#c2453b",
      "#3f8a4f",
      "#e1a43a",
      "#3d6fa8",
      "#7c4f9e",
      "#2f9b8f",
      "#d8d1bd",
      "#b4572e",
    ];
    const rnd = stream(11);
    for (let s = 0; s < 4; s++) {
      const top = 11 - s * 3.4;
      m.fillStyle = night ? "#241c18" : "#5d412c";
      m.fillRect(X(sl + 0.3), Y(top), D(sr - sl - 0.6), D(3.0));
      let x = sl + 0.4;
      while (x < sr - 0.8) {
        const bw = 0.32 + rnd() * 0.4;
        const bh = 1.8 + rnd() * 1.0;
        const col = spines[Math.floor(rnd() * spines.length)]!;
        m.fillStyle = night ? shade(col, 0.45) : col;
        m.fillRect(X(x), Y(top - 3.0 + bh), D(bw - 0.04), D(bh));
        m.fillStyle = night ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.35)";
        m.fillRect(X(x), Y(top - 3.0 + bh * 0.8), D(bw - 0.04), D(0.12));
        x += bw;
      }
      m.fillStyle = night ? "#2c231f" : "#6f4f37";
      m.fillRect(X(sl), Y(top - 3.0), D(sr - sl), D(0.4));
    }
    // A clock: a face with twelve ticks, no numbers.
    const cx = X(-3.6);
    const cy = Y(14.2);
    m.fillStyle = night ? "#cfd2db" : "#fdfcf8";
    m.beginPath();
    m.arc(cx, cy, D(1), 0, Math.PI * 2);
    m.fill();
    m.strokeStyle = night ? "#444a5a" : "#3a3a3a";
    m.lineWidth = lw(0.08);
    m.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      m.beginPath();
      m.moveTo(cx + Math.cos(a) * D(0.75), cy + Math.sin(a) * D(0.75));
      m.lineTo(cx + Math.cos(a) * D(0.9), cy + Math.sin(a) * D(0.9));
      m.stroke();
    }
    m.lineWidth = lw(0.1);
    m.beginPath();
    m.moveTo(cx, cy);
    m.lineTo(cx + D(0.45), cy - D(0.3));
    m.moveTo(cx, cy);
    m.lineTo(cx - D(0.1), cy - D(0.7));
    m.stroke();
    // A side table with a lamp and a plant, right of the window.
    m.fillStyle = night ? "#3b302a" : "#9a7553";
    m.fillRect(X(15.4), Y(-0.4), D(4.6), D(0.4));
    m.fillRect(X(15.8), Y(-0.4), D(0.3), D(3));
    m.fillRect(X(19.3), Y(-0.4), D(0.3), D(3));
    m.fillStyle = night ? "#5a5248" : "#6a6157";
    m.fillRect(X(16.6) - D(0.08), Y(2.2), D(0.16), D(2.6));
    m.fillStyle = night ? "#f6dfa6" : "#efe4cc";
    m.beginPath();
    m.moveTo(X(15.9), Y(2.0));
    m.lineTo(X(17.3), Y(2.0));
    m.lineTo(X(16.95), Y(3.3));
    m.lineTo(X(16.25), Y(3.3));
    m.closePath();
    m.fill();
    if (night)
      midLamps.push({ x: X(16.6), y: Y(2.4), r: D(0.42), intensity: 7, rgb: [1, 0.86, 0.62] });
    // A pot with long leaves.
    m.fillStyle = night ? "#5a3a32" : "#b8653f";
    m.fillRect(X(18.2), Y(0.9), D(1.2), D(0.9));
    m.strokeStyle = night ? "#29452f" : "#3f8a4f";
    m.lineWidth = lw(0.16);
    m.lineCap = "round";
    for (let i = 0; i < 7; i++) {
      const a = -0.9 + i * 0.3;
      m.beginPath();
      m.moveTo(X(18.8), Y(0.9));
      m.quadraticCurveTo(
        X(18.8 + Math.sin(a) * 1.1),
        Y(2.4),
        X(18.8 + Math.sin(a) * 1.8),
        Y(2.6 + Math.cos(a) * 1.2),
      );
      m.stroke();
    }
    // A framed picture of a sailing boat above the table.
    m.fillStyle = night ? "#8c8f99" : "#f8f5ee";
    m.fillRect(X(15.6), Y(10.2), D(4.4), D(3.4));
    m.fillStyle = night ? "#2b3f5a" : "#7fb6dd";
    m.fillRect(X(15.9), Y(9.9), D(3.8), D(2.0));
    m.fillStyle = night ? "#1f3550" : "#3d7eb8";
    m.fillRect(X(15.9), Y(7.9), D(3.8), D(0.8));
    m.fillStyle = night ? "#a39d90" : "#fdfdf8";
    m.beginPath();
    m.moveTo(X(17.8), Y(9.5));
    m.lineTo(X(17.8), Y(8.0));
    m.lineTo(X(19.0), Y(8.0));
    m.closePath();
    m.fill();
    m.fillStyle = night ? "#5c2f2c" : "#c2453b";
    m.fillRect(X(17.0), Y(8.0), D(2.2), D(0.3));
  }

  // ---- Near: a table and an open picture book ------------------------------------------------
  const [nearC, n] = mk(w, h);
  const nearLamps: Lamp[] = [];
  if (n) {
    const top = Y(TABLE_TOP);
    const wood = n.createLinearGradient(0, top, 0, h);
    wood.addColorStop(0, night ? "#3d2c22" : "#b98a5f");
    wood.addColorStop(1, night ? "#2b1f18" : "#9c7148");
    n.fillStyle = wood;
    n.fillRect(0, top, w, h - top);
    n.strokeStyle = night ? "rgba(0,0,0,0.25)" : "rgba(90,55,30,0.28)";
    n.lineWidth = lw(0.05);
    const rnd = stream(19);
    for (let i = 0; i < 18; i++) {
      const y0 = top + (i + rnd()) * D(0.55);
      n.beginPath();
      n.moveTo(0, y0);
      for (let x = 0; x <= w; x += w / 12) n.lineTo(x, y0 + Math.sin(x / D(3) + i) * D(0.08));
      n.stroke();
    }
    n.fillStyle = night ? "#6a4a36" : "#d7ab7c";
    n.fillRect(0, top, w, D(0.18));
    // The book: two pages and a soft spine shadow.
    const bl = X(BOOK.left);
    const br = X(BOOK.right);
    const bt = Y(BOOK.top);
    const page = night ? "#c9c3b2" : "#fbf8ef";
    n.fillStyle = night ? "#1a1410" : "rgba(60,40,20,0.35)";
    n.fillRect(bl + D(0.2), bt + D(0.25), br - bl, h - bt);
    n.fillStyle = page;
    n.fillRect(bl, bt, br - bl, h - bt);
    const spine = X(BOOK.spine);
    const sh = n.createLinearGradient(spine - D(0.8), 0, spine + D(0.8), 0);
    sh.addColorStop(0, "rgba(0,0,0,0)");
    sh.addColorStop(0.5, night ? "rgba(0,0,0,0.35)" : "rgba(90,70,40,0.28)");
    sh.addColorStop(1, "rgba(0,0,0,0)");
    n.fillStyle = sh;
    n.fillRect(spine - D(0.8), bt, D(1.6), h - bt);
    const dim = (c: string) => (night ? shade(c, 0.7) : c);
    // Left page: a red bird on a leafy branch.
    const bx = X(-7);
    const by = Y(-6.4);
    n.strokeStyle = dim("#6b4a2f");
    n.lineWidth = lw(0.18);
    n.beginPath();
    n.moveTo(X(-11), Y(-7.6));
    n.quadraticCurveTo(X(-7), Y(-7.9), X(-2.4), Y(-7.2));
    n.stroke();
    for (let i = 0; i < 6; i++) {
      const lx = X(-10.4 + i * 1.5);
      const ly = Y(-7.5 - (i % 2) * 0.35);
      n.fillStyle = dim(i % 2 ? "#3f8a4f" : "#5aa35a");
      n.beginPath();
      n.ellipse(lx, ly, D(0.55), D(0.24), (i % 2 ? 0.5 : -0.5) + 0.2, 0, Math.PI * 2);
      n.fill();
    }
    n.fillStyle = dim("#c8393a");
    n.beginPath();
    n.ellipse(bx, by, D(1.2), D(0.85), -0.15, 0, Math.PI * 2);
    n.fill();
    n.beginPath();
    n.arc(bx + D(1.0), by - D(0.65), D(0.55), 0, Math.PI * 2);
    n.fill();
    n.beginPath();
    n.moveTo(bx - D(1.0), by + D(0.1));
    n.lineTo(bx - D(2.0), by + D(0.6));
    n.lineTo(bx - D(1.9), by - D(0.2));
    n.closePath();
    n.fill();
    n.fillStyle = dim("#f0a630");
    n.beginPath();
    n.moveTo(bx + D(1.5), by - D(0.7));
    n.lineTo(bx + D(2.0), by - D(0.55));
    n.lineTo(bx + D(1.5), by - D(0.45));
    n.closePath();
    n.fill();
    n.fillStyle = "#1c1c1c";
    n.beginPath();
    n.arc(bx + D(1.15), by - D(0.75), D(0.1), 0, Math.PI * 2);
    n.fill();
    n.fillStyle = dim("#9d2c2e");
    n.beginPath();
    n.ellipse(bx - D(0.2), by + D(0.05), D(0.7), D(0.4), 0.3, 0, Math.PI * 2);
    n.fill();
    // Fruit in a row under it.
    const fruit = ["#d23b30", "#7fb24a", "#f08a24", "#6c3f8f", "#f2cf3a"];
    fruit.forEach((c, i) => {
      n.fillStyle = dim(c);
      n.beginPath();
      n.arc(X(-10.6 + i * 1.75), Y(-9.3), D(0.55), 0, Math.PI * 2);
      n.fill();
      n.fillStyle = dim("#3f8a4f");
      n.beginPath();
      n.ellipse(X(-10.6 + i * 1.75 + 0.25), Y(-8.75), D(0.24), D(0.1), -0.6, 0, Math.PI * 2);
      n.fill();
    });
    // Right page: a sun of fine rays (astigmatism shows in which rays stay sharp).
    const sx = X(4.4);
    const sy = Y(-6.5);
    n.strokeStyle = dim("#e79a1d");
    n.lineWidth = lw(0.09);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      n.beginPath();
      n.moveTo(sx + Math.cos(a) * D(0.85), sy + Math.sin(a) * D(0.85));
      n.lineTo(sx + Math.cos(a) * D(2.0), sy + Math.sin(a) * D(2.0));
      n.stroke();
    }
    n.fillStyle = dim("#f6c03a");
    n.beginPath();
    n.arc(sx, sy, D(0.75), 0, Math.PI * 2);
    n.fill();
    // Rows of small shapes in place of print: fine detail without words.
    const shapes = ["#3d6fa8", "#c2453b", "#3f8a4f", "#7c4f9e"];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 16; col++) {
        const px = 0.2 + col * 0.58;
        const py = -9.0 - row * 0.62;
        n.fillStyle = dim(shapes[(row + col) % shapes.length]!);
        const kind = (row * 3 + col) % 3;
        const s = 0.18;
        if (kind === 0) n.fillRect(X(px - s), Y(py + s), D(2 * s), D(2 * s));
        else if (kind === 1) {
          n.beginPath();
          n.arc(X(px), Y(py), D(s), 0, Math.PI * 2);
          n.fill();
        } else {
          n.beginPath();
          n.moveTo(X(px), Y(py + s));
          n.lineTo(X(px + s), Y(py - s));
          n.lineTo(X(px - s), Y(py - s));
          n.closePath();
          n.fill();
        }
      }
    }
    // A pencil beside the book, and a mug.
    n.save();
    n.translate(X(13.4), Y(-6.4));
    n.rotate(-0.5);
    n.fillStyle = dim("#f2b53a");
    n.fillRect(-D(2.4), -D(0.22), D(4.2), D(0.44));
    n.fillStyle = dim("#e9cfa3");
    n.beginPath();
    n.moveTo(D(1.8), -D(0.22));
    n.lineTo(D(2.5), 0);
    n.lineTo(D(1.8), D(0.22));
    n.closePath();
    n.fill();
    n.fillStyle = dim("#e07b8a");
    n.fillRect(-D(2.75), -D(0.22), D(0.35), D(0.44));
    n.restore();
    n.fillStyle = dim("#3d6fa8");
    n.fillRect(X(-17.2), Y(-3.6), D(2.4), D(2.8));
    n.strokeStyle = dim("#3d6fa8");
    n.lineWidth = lw(0.3);
    n.beginPath();
    n.arc(X(-14.6), Y(-5.0), D(0.7), -1.2, 1.2);
    n.stroke();
    n.fillStyle = dim("#f6f1e6");
    n.fillRect(X(-17.2), Y(-3.6), D(2.4), D(0.35));
  }

  return {
    far: { canvas: farC, lamps: farLamps },
    mid: { canvas: midC, lamps: midLamps },
    near: { canvas: nearC, lamps: nearLamps },
    fix: {
      near: [X(-1.5) / w, Y(-6.6) / h],
      far: [X(4) / w, Y(4) / h],
    },
  };
};

/** A colour mixed towards black by `k` (0 black, 1 unchanged). */
export const shade = (hex: string, k: number): string => {
  const v = Number.parseInt(hex.replace("#", ""), 16);
  const r = Math.round(((v >> 16) & 255) * k);
  const g = Math.round(((v >> 8) & 255) * k);
  const b = Math.round((v & 255) * k);
  return `rgb(${r},${g},${b})`;
};

/** Fixation for a view, as fractions from the top left, clamped inside it. */
export const fixation = (art: SceneArt, looking: "near" | "far"): [number, number] => {
  const p = art.fix[looking];
  return [Math.min(0.92, Math.max(0.08, p[0])), Math.min(0.9, Math.max(0.1, p[1]))];
};
