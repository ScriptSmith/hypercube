/**
 * The screen above a bank (Canvas2D, so a full bank adds no WebGL context): the park along
 * the top, the plant with its chimneys and a truck that now and then tips in a load, and a
 * cascade of chutes down to a drop tube above each inlet of the frames below. Items slide down
 * the chutes, fall out of the tubes and on through the screen's bottom edge into the frame below,
 * timed on the shared clock (plant.ts). Full bins rise up out of the frames into the plant, and
 * what they become flies up into the park.
 *
 * Two layers: the background (redrawn when the columns change or on resize) and everything that
 * moves, drawn at up to 30 frames a second.
 */
import type { AppContext, AppInstance, FrameInfo, PeerInfo } from "../../core/types";
import { activeVenue } from "../../core/venue";
import { readConfig } from "./config";
import { BIN_LOOK, ITEMS } from "./items";
import { createLagged } from "./lag";
import { createDownlink } from "./link";
import { makePath, type Path, pointAt, tracePath } from "./paths";
import { drawBinPicture, drawItem, drawThing } from "./pictures";
import { fallAt } from "./physics";
import {
  CHUTE_D,
  type ColumnInfo,
  createPlant,
  FALL_FROM,
  FLIGHT_S,
  type Inlet,
  MAX_RISING,
  SWALLOW_S,
} from "./plant";
import type { ThingKind } from "./park";

const TAU = Math.PI * 2;
const RENDER_MS = 1000 / 30;
const COLUMNS_MS = 500;
const MAX_SPARKS = 220;
/** Clouds drifting across the sky: place across, height and size as shares of the screen. */
const CLOUDS = [
  { x: 0.1, y: 0.07, r: 0.022, speed: 1 },
  { x: 0.45, y: 0.13, r: 0.016, speed: 0.7 },
  { x: 0.72, y: 0.05, r: 0.02, speed: 1.2 },
  { x: 0.95, y: 0.17, r: 0.014, speed: 0.8 },
];

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  smoke: boolean;
}

interface Geo {
  W: number;
  H: number;
  /** Screen venue px per bank unit. */
  S: number;
  ground: number;
  plant: { x: number; y: number; width: number; height: number };
  manifold: number;
  lip: number;
  mouth: number;
  thing: number;
}

const geoFor = (W: number, H: number, columns: number, fw: number): Geo => ({
  W,
  H,
  S: W / (Math.max(1, columns) * fw),
  ground: H * 0.3,
  plant: { x: W * 0.08, y: H * 0.36, width: W * 0.84, height: H * 0.2 },
  manifold: H * 0.6,
  lip: 0,
  mouth: 0,
  thing: H * 0.088,
});

export const mountScreen = (ctx: AppContext): AppInstance => {
  const config = readConfig(ctx.variant, ctx.options);
  let frame: FrameInfo = ctx.frame;
  const make = (z: number) => {
    const c = document.createElement("canvas");
    c.style.cssText = `position:absolute;inset:0;width:100%;height:100%;z-index:${z};`;
    ctx.root.append(c);
    return c;
  };
  const backCanvas = make(0);
  const frontCanvas = make(1);
  const back = backCanvas.getContext("2d");
  const g = frontCanvas.getContext("2d");
  ctx.root.style.background = "#0b1120";
  const lagged = ctx.debug ? createLagged(ctx.net) : null;
  const net = lagged?.net ?? ctx.net;
  const side = ctx.setup.side ?? 0;
  const rng = ctx.rng().fork("recycling-screen");
  const now = () => performance.now();

  // A screen on its own (no bank) still shows a bank's worth of columns.
  const baseCount = () =>
    ctx.setup.name === "bank" ? Math.max(1, ctx.setup.count) : activeVenue().bankCount;
  const vw = () => frame.width / frame.unit;
  const vh = () => frame.height / frame.unit;
  let geo = geoFor(vw(), vh(), baseCount(), 1080);
  const chutes = new Map<string, Path>();
  const keyOf = (i: Inlet) => `${i.column}:${i.index}`;

  const chutePoints = (inlet: Inlet, perColumn: number) => {
    const X = inlet.x * geo.S;
    const colW = plant.fw * geo.S;
    const A = (colW / (2 * Math.max(1, perColumn))) * 0.42;
    const m = geo.manifold;
    const lip = geo.lip;
    return [
      { x: X - A, y: m + geo.H * 0.01 },
      { x: X + A, y: m + (lip - m) * 0.36 },
      { x: X - A, y: m + (lip - m) * 0.7 },
      { x: X, y: lip - geo.H * 0.01 },
      { x: X, y: lip },
    ];
  };

  const plant = createPlant({
    variant: config.variant,
    rng,
    chuteLength: (inlet) => {
      const p = chutes.get(keyOf(inlet));
      return p ? p.length / geo.S : 3000;
    },
  });

  const rebuildGeo = () => {
    geo = geoFor(vw(), vh(), plant.columns.length || baseCount(), plant.fw);
    geo.lip = geo.H - FALL_FROM * geo.S;
    geo.mouth = geo.H - 600 * geo.S;
    plant.plantY = (geo.plant.y + geo.plant.height - geo.H) / geo.S;
    chutes.clear();
    const perColumn = new Map<number, number>();
    for (const i of plant.inlets) perColumn.set(i.column, (perColumn.get(i.column) ?? 0) + 1);
    for (const i of plant.inlets) {
      chutes.set(keyOf(i), makePath(chutePoints(i, perColumn.get(i.column) ?? 1)));
    }
  };

  const link = createDownlink(
    net,
    { side, count: baseCount, now },
    {
      load: (m, column) => plant.load(column, m, now()),
      sorted: (m) => plant.sorted(m),
      full: (m, column) => plant.full(column, m),
    },
  );

  const columnsFrom = (stations: readonly PeerInfo[]): ColumnInfo[] => {
    const count = Math.max(baseCount(), ...stations.map((p) => p.pos + 1));
    const pairs = stations.filter((p) => p.kind === "pair").length;
    const fallback = pairs > stations.length / 2 ? "pair" : "panel";
    return Array.from({ length: Math.min(64, count) }, (_, pos) => {
      const st = stations.find((p) => p.pos === pos);
      return {
        pos,
        kind: st ? (st.kind === "pair" ? "pair" : "panel") : fallback,
        frame: st?.frame ?? null,
      };
    });
  };

  // ---- Sprites ------------------------------------------------------------------------------

  let k = 1;
  let itemSprites: HTMLCanvasElement[] = [];
  const thingSprites = new Map<ThingKind, HTMLCanvasElement>();
  const binSprites = new Map<string, HTMLCanvasElement>();
  const sprite = (w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) => {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    const cg = c.getContext("2d");
    if (cg) draw(cg);
    return c;
  };
  const buildSprites = () => {
    const d = plant.d * geo.S;
    const px = d * 1.2 * k;
    itemSprites = ITEMS.map((it) =>
      sprite(px, px, (c) => {
        c.translate(px / 2, px / 2);
        drawItem(c, it.id, 0, 0, d * k);
      }),
    );
    thingSprites.clear();
    binSprites.clear();
  };
  const thingSprite = (kind: ThingKind) => {
    let s = thingSprites.get(kind);
    if (!s) {
      const size = geo.thing * k;
      const px = size * 1.15;
      s = sprite(px, px, (c) => {
        c.translate(px / 2, px / 2);
        drawThing(c, kind, 0, size / 2, size);
      });
      thingSprites.set(kind, s);
    }
    return s;
  };

  // ---- Background ---------------------------------------------------------------------------

  const drawBack = () => {
    if (!back) return;
    const { W, H } = geo;
    back.setTransform(1, 0, 0, 1, 0, 0);
    back.clearRect(0, 0, backCanvas.width, backCanvas.height);
    back.setTransform(k, 0, 0, k, 0, 0);
    const sky = back.createLinearGradient(0, 0, 0, H * 0.62);
    sky.addColorStop(0, "#14305a");
    sky.addColorStop(1, "#3f6ea6");
    back.fillStyle = sky;
    back.fillRect(0, 0, W, H * 0.62);
    const sun = back.createRadialGradient(W * 0.86, H * 0.08, 0, W * 0.86, H * 0.08, H * 0.09);
    sun.addColorStop(0, "rgba(255,230,140,1)");
    sun.addColorStop(0.45, "rgba(255,214,110,0.95)");
    sun.addColorStop(1, "rgba(255,214,110,0)");
    back.fillStyle = sun;
    back.fillRect(W * 0.86 - H * 0.09, 0, H * 0.18, H * 0.18);
    const low = back.createLinearGradient(0, H * 0.55, 0, H);
    low.addColorStop(0, "#152036");
    low.addColorStop(1, "#0a0f1c");
    back.fillStyle = low;
    back.fillRect(0, H * 0.55, W, H * 0.45);
    // Distant hills and the park's lawn.
    back.fillStyle = "#2f6e48";
    back.beginPath();
    back.moveTo(0, geo.ground);
    for (let x = 0; x <= W; x += W / 24) {
      back.lineTo(x, geo.ground - H * 0.03 - Math.sin(x / (W * 0.08)) * H * 0.012);
    }
    back.lineTo(W, geo.ground + H * 0.04);
    back.lineTo(0, geo.ground + H * 0.04);
    back.closePath();
    back.fill();
    back.fillStyle = "#4fa857";
    back.fillRect(0, geo.ground - H * 0.004, W, H * 0.012);
    // The lawn runs down behind the plant to the yard below it.
    const lawn = back.createLinearGradient(0, geo.ground, 0, geo.plant.y + geo.plant.height);
    lawn.addColorStop(0, "#3b8a45");
    lawn.addColorStop(1, "#24563a");
    back.fillStyle = lawn;
    back.fillRect(0, geo.ground + H * 0.008, W, geo.plant.y + geo.plant.height - geo.ground);
    // The plant.
    const p = geo.plant;
    const roofH = p.height * 0.24;
    const teeth = 9;
    const tw = p.width / teeth;
    back.beginPath();
    back.moveTo(p.x, p.y + p.height);
    back.lineTo(p.x, p.y + roofH);
    for (let i = 0; i < teeth; i++) {
      back.lineTo(p.x + tw * i + tw * 0.7, p.y);
      back.lineTo(p.x + tw * (i + 1), p.y + roofH);
    }
    back.lineTo(p.x + p.width, p.y + p.height);
    back.closePath();
    back.fillStyle = "#4a5a78";
    back.fill();
    back.lineWidth = H * 0.004;
    back.strokeStyle = "#151b29";
    back.stroke();
    const ww = p.width / 30;
    for (let x = p.x + ww; x < p.x + p.width - ww; x += ww * 1.8) {
      back.beginPath();
      back.roundRect(x, p.y + roofH + p.height * 0.12, ww, p.height * 0.24, ww * 0.15);
      back.fillStyle = "#ffd977";
      back.fill();
    }
    // A long window where sorted things roll by.
    back.beginPath();
    back.roundRect(
      p.x + p.width * 0.04,
      p.y + p.height * 0.62,
      p.width * 0.92,
      p.height * 0.24,
      H * 0.01,
    );
    back.fillStyle = "#0f1626";
    back.fill();
    for (const f of [0.15, 0.5, 0.85]) {
      const x = p.x + p.width * f;
      back.fillStyle = "#6b7896";
      back.fillRect(x, p.y - roofH * 1.4, p.width * 0.035, roofH * 1.8);
      back.fillStyle = "#e2382f";
      back.fillRect(x, p.y - roofH * 1.2, p.width * 0.035, roofH * 0.2);
    }
    // The truck's road and the intake.
    back.fillStyle = "#2a3242";
    back.fillRect(0, p.y + roofH * 0.15, p.x + p.width * 0.08, H * 0.012);
    back.fillStyle = "#3b465e";
    back.beginPath();
    back.moveTo(p.x + p.width * 0.03, p.y - H * 0.005);
    back.lineTo(p.x + p.width * 0.11, p.y - H * 0.005);
    back.lineTo(p.x + p.width * 0.09, p.y + roofH);
    back.lineTo(p.x + p.width * 0.05, p.y + roofH);
    back.closePath();
    back.fill();
    // The manifold and the chutes.
    const d = plant.d * geo.S;
    const xs = plant.inlets.map((i) => i.x * geo.S);
    if (xs.length > 0) {
      back.lineCap = "round";
      back.lineWidth = d * 1.2;
      back.strokeStyle = "#151b29";
      back.beginPath();
      back.moveTo(Math.min(...xs) - d, geo.manifold - d * 0.2);
      back.lineTo(Math.max(...xs) + d, geo.manifold - d * 0.2);
      back.stroke();
      back.lineWidth = d;
      back.strokeStyle = "#56617a";
      back.stroke();
      // Feeds up into the plant.
      for (const f of [0.25, 0.5, 0.75]) {
        back.fillStyle = "#3b465e";
        back.fillRect(W * f - d * 0.4, p.y + p.height, d * 0.8, geo.manifold - p.y - p.height);
      }
    }
    for (const inlet of plant.inlets) {
      const path = chutes.get(keyOf(inlet));
      if (!path) continue;
      back.beginPath();
      tracePath(back, [...path.pts], d * 0.5);
      back.lineCap = "round";
      back.lineJoin = "round";
      back.lineWidth = d * 1.1;
      back.strokeStyle = "#151b29";
      back.stroke();
      back.lineWidth = d * 0.92;
      back.strokeStyle = "#3b465e";
      back.stroke();
      // The drop tube, glass, from the lip down to its mouth.
      const X = inlet.x * geo.S;
      back.fillStyle = "rgba(150,195,255,0.12)";
      back.fillRect(X - d * 0.62, geo.lip, d * 1.24, geo.mouth - geo.lip);
      back.strokeStyle = "rgba(150,195,255,0.45)";
      back.lineWidth = d * 0.06;
      back.strokeRect(X - d * 0.62, geo.lip, d * 1.24, geo.mouth - geo.lip);
      back.fillStyle = "#56617a";
      back.fillRect(X - d * 0.72, geo.mouth - d * 0.1, d * 1.44, d * 0.16);
    }
  };

  const size = () => {
    const ratio = Math.min(frame.pixelRatio, 2);
    for (const c of [backCanvas, frontCanvas]) {
      c.width = Math.max(1, Math.round(frame.width * ratio));
      c.height = Math.max(1, Math.round(frame.height * ratio));
    }
    k = frame.unit * ratio;
    rebuildGeo();
    buildSprites();
    drawBack();
  };

  const updateColumns = () => {
    const cols = columnsFrom(link.stations());
    if (plant.setColumns(cols)) {
      rebuildGeo();
      buildSprites();
      drawBack();
    }
  };
  updateColumns();
  size();

  // ---- Motion -------------------------------------------------------------------------------

  const sparks: Spark[] = [];
  const addSpark = (s: Spark) => {
    if (sparks.length >= MAX_SPARKS) sparks.shift();
    sparks.push(s);
  };
  let truck = { t: 0, next: 12, phase: "away" as "away" | "in" | "tip" | "out" };
  let smokeAt = 0;
  let windowShift = 0;
  let cloudShift = 0;
  const scratch = { x: 0, y: 0, vx: 0, vy: 0 };
  const pt = { x: 0, y: 0, angle: 0 };

  const parkX = (slot: number) => (geo.W * (slot + 0.5)) / Math.max(1, plant.park.capacity);

  const drawTruck = (gg: CanvasRenderingContext2D, dt: number) => {
    const p = geo.plant;
    const roofH = p.height * 0.24;
    const road = p.y + roofH * 0.15;
    const tw = geo.W * 0.07;
    const th = tw * 0.42;
    const stop = p.x + p.width * 0.03 - tw * 0.5;
    truck.t += dt;
    let x = -tw * 1.5;
    let tilt = 0;
    if (truck.phase === "away") {
      if (truck.t >= truck.next) {
        truck.phase = "in";
        truck.t = 0;
      }
      return;
    }
    if (truck.phase === "in") {
      const f = Math.min(1, truck.t / 4);
      x = -tw * 1.5 + (stop + tw * 1.5) * (1 - (1 - f) * (1 - f));
      if (f >= 1) {
        truck.phase = "tip";
        truck.t = 0;
      }
    } else if (truck.phase === "tip") {
      x = stop;
      const f = Math.min(1, truck.t / 3);
      tilt = Math.sin(f * Math.PI) * 0.8;
      if (truck.t > 0.6 && truck.t < 2.2 && Math.random() < dt * 14) {
        addSpark({
          x: stop + tw * 0.45,
          y: road - th * 1.2,
          vx: tw * 0.5,
          vy: -th * 0.5,
          life: 0,
          max: 0.8,
          size: geo.H * 0.008,
          color: ["#f4cf1f", "#8fd43a", "#c98f52", "#9fd8ff"][Math.floor(Math.random() * 4)]!,
          smoke: false,
        });
      }
      if (f >= 1) {
        truck.phase = "out";
        truck.t = 0;
      }
    } else {
      const f = Math.min(1, truck.t / 4);
      x = stop - (stop + tw * 1.5) * f * f;
      if (f >= 1) {
        truck = { t: 0, next: plant.busy(now()) ? 25 : 45, phase: "away" };
      }
    }
    // Cab, tipper tray and wheels.
    gg.save();
    gg.translate(x, road);
    gg.fillStyle = "#1fb5a8";
    gg.strokeStyle = "#151b29";
    gg.lineWidth = th * 0.06;
    gg.beginPath();
    gg.roundRect(tw * 0.62, -th * 1.05, tw * 0.36, th * 0.85, th * 0.12);
    gg.fill();
    gg.stroke();
    gg.fillStyle = "#9fd8ff";
    gg.fillRect(tw * 0.7, -th * 0.95, tw * 0.2, th * 0.32);
    gg.save();
    gg.translate(tw * 0.58, -th * 0.25);
    gg.rotate(-tilt);
    gg.fillStyle = "#f29b1d";
    gg.beginPath();
    gg.roundRect(-tw * 0.58, -th * 0.85, tw * 0.58, th * 0.78, th * 0.08);
    gg.fill();
    gg.stroke();
    gg.restore();
    gg.fillStyle = "#11151f";
    for (const wx of [tw * 0.15, tw * 0.45, tw * 0.82]) {
      gg.beginPath();
      gg.arc(wx, -th * 0.12, th * 0.2, 0, TAU);
      gg.fill();
    }
    gg.restore();
  };

  const drawItemAt = (
    gg: CanvasRenderingContext2D,
    kind: number,
    x: number,
    y: number,
    a: number,
    scale = 1,
  ) => {
    const s = itemSprites[kind];
    if (!s) return;
    const d = plant.d * geo.S * scale;
    gg.save();
    gg.translate(x, y);
    gg.rotate(a);
    gg.drawImage(s, -d * 0.6, -d * 0.6, d * 1.2, d * 1.2);
    gg.restore();
  };

  const drawRisingBin = (
    gg: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    kind: keyof typeof BIN_LOOK,
    f: number,
  ) => {
    const look = BIN_LOOK[kind];
    let s = binSprites.get(`${kind}:${Math.round(w)}`);
    if (!s) {
      const pw = w * k;
      const ph = h * k;
      s = sprite(pw, ph, (c) => {
        c.scale(k, k);
        c.fillStyle = look.body;
        c.strokeStyle = "#0b0f18";
        c.lineWidth = Math.max(1, w * 0.02);
        c.beginPath();
        c.moveTo(0, 0);
        c.lineTo(w, 0);
        c.lineTo(w * 0.95, h);
        c.lineTo(w * 0.05, h);
        c.closePath();
        c.fill();
        c.stroke();
        c.fillStyle = look.lid;
        c.fillRect(0, h * 0.07, w, h * 0.06);
        c.fillStyle = "#eef2f7";
        const ps = Math.min(w * 0.7, h * 0.5);
        c.beginPath();
        c.roundRect(w / 2 - ps / 2, h * 0.42 - ps / 2, ps, ps * 0.92, ps * 0.12);
        c.fill();
        drawBinPicture(c, kind, w / 2, h * 0.42 - ps * 0.04, ps * 0.9);
      });
      // Widths come from frames' messages, so the cache is kept small whatever they send.
      if (binSprites.size >= 24) binSprites.clear();
      binSprites.set(`${kind}:${Math.round(w)}`, s);
    }
    const sw = w * f;
    const sh = h * f;
    gg.fillStyle = look.lid;
    gg.fillRect(x - sw * 0.49, y - sh / 2 - sw * 0.07, sw * 0.98, sw * 0.08);
    gg.drawImage(s, x - sw / 2, y - sh / 2, sw, sh);
    gg.strokeStyle = "rgba(220,226,240,0.55)";
    gg.lineWidth = geo.H * 0.002;
    gg.beginPath();
    gg.moveTo(x, y - sh / 2 - sw * 0.07);
    gg.lineTo(x, geo.plant.y + geo.plant.height);
    gg.stroke();
  };

  let lastRender = 0;
  let lastStep = now();
  let columnsAt = 0;
  let disposed = false;

  const draw = (clockMs: number, dt: number) => {
    if (!g) return;
    const { W, H, S } = geo;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, frontCanvas.width, frontCanvas.height);
    g.setTransform(k, 0, 0, k, 0, 0);
    const d = plant.d * S;
    const p = geo.plant;

    // Chimney smoke and the plant's moving window.
    smokeAt -= dt;
    if (smokeAt <= 0) {
      smokeAt = 0.45;
      const roofH = p.height * 0.24;
      for (const f of [0.15, 0.5, 0.85]) {
        addSpark({
          x: p.x + p.width * f + p.width * 0.0175,
          y: p.y - roofH * 1.4,
          vx: W * 0.004,
          vy: -H * 0.012,
          life: 0,
          max: 4,
          size: H * 0.012,
          color: "rgba(214,222,236,0.5)",
          smoke: true,
        });
      }
    }
    cloudShift += dt * W * 0.006;
    g.fillStyle = "rgba(236,242,252,0.85)";
    for (let i = 0; i < CLOUDS.length; i++) {
      const c = CLOUDS[i]!;
      const span = W * 1.3;
      const x = ((c.x * W + cloudShift * c.speed) % span) - W * 0.15;
      const y = c.y * H;
      const r = c.r * H;
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.arc(x + r * 1.1, y + r * 0.2, r * 0.8, 0, TAU);
      g.arc(x - r * 1.05, y + r * 0.25, r * 0.7, 0, TAU);
      g.arc(x + r * 0.2, y - r * 0.5, r * 0.75, 0, TAU);
      g.fill();
    }
    windowShift += dt * W * 0.03 * (1 + plant.pace.value);
    g.save();
    g.beginPath();
    g.rect(p.x + p.width * 0.04, p.y + p.height * 0.62, p.width * 0.92, p.height * 0.24);
    g.clip();
    const step = p.width * 0.06;
    for (let x = p.x + (windowShift % step) - step; x < p.x + p.width; x += step) {
      const kind = Math.abs(Math.floor((x - windowShift) / step)) % ITEMS.length;
      drawItemAt(g, kind, x, p.y + p.height * 0.74, (x / step) * 0.7, 1.2);
    }
    g.restore();
    drawTruck(g, dt);

    // Park.
    for (const t of plant.park.things) {
      const s = thingSprite(t.kind);
      const pop = Math.min(1, t.age / 0.5);
      const sc = pop < 1 ? 0.4 + 0.66 * (1 - (1 - pop) * (1 - pop)) : 1;
      const px = geo.thing * 1.15 * sc;
      g.drawImage(s, parkX(t.shown) - px / 2, geo.ground - geo.thing / 2 - px / 2, px, px);
    }
    for (const t of plant.park.leavers) {
      const s = thingSprite(t.kind);
      const f = Math.min(1, (t.leaving ?? 0) / 1.6);
      g.globalAlpha = 1 - f;
      const px = geo.thing * 1.15;
      g.drawImage(
        s,
        parkX(0) - f * geo.thing * 1.6 - px / 2,
        geo.ground - geo.thing / 2 - px / 2,
        px,
        px,
      );
      g.globalAlpha = 1;
    }

    // Items in the chutes, then falling out of the tubes.
    for (const j of plant.jobs) {
      if (j.fall === null) {
        const path = chutes.get(keyOf(j.inlet));
        if (!path) continue;
        const along = j.t * CHUTE_D * plant.d * S;
        pointAt(path, along, pt);
        // Larger high up so they read from the floor; true size by the time they fall out.
        const big = 1 + 0.6 * Math.max(0, 1 - along / Math.max(1, path.length));
        drawItemAt(g, j.kind, pt.x, pt.y - d * 0.35 * big, j.a, big);
      } else {
        fallAt(j.fall, (clockMs - j.fall.t0) / 1000, scratch);
        drawItemAt(g, j.kind, scratch.x * S, H + scratch.y * S, j.a);
      }
    }
    // Glass over the drop tubes.
    g.fillStyle = "rgba(170,210,255,0.1)";
    for (const inlet of plant.inlets) {
      g.fillRect(inlet.x * S - d * 0.62, geo.lip, d * 1.24, geo.mouth - geo.lip);
    }

    // Full bins rising into the plant.
    for (const r of plant.rising) {
      const yB = -((clockMs - r.t) / 1000) * r.v;
      const y = H + yB * S;
      const f =
        r.arrived === null ? 1 : Math.max(0.05, 1 - (clockMs - r.arrived) / (SWALLOW_S * 1000));
      if (y - (r.h * S) / 2 > H) continue;
      drawRisingBin(
        g,
        r.x * S,
        Math.max(p.y + p.height - (r.h * S) / 2, y),
        r.w * S,
        r.h * S,
        r.kind,
        f,
      );
    }
    // New things flying up to the park.
    for (const fl of plant.flights) {
      const f = Math.min(1, fl.age / FLIGHT_S);
      const slot = Math.min(plant.park.capacity - 1, plant.park.things.length);
      const x0 = fl.x * S;
      const y0 = p.y;
      const x1 = parkX(slot);
      const y1 = geo.ground - geo.thing / 2;
      const x = x0 + (x1 - x0) * f;
      const y = y0 + (y1 - y0) * f - Math.sin(f * Math.PI) * H * 0.12;
      const s = thingSprite(fl.kind);
      const px = geo.thing * (0.5 + 0.5 * f) * 1.15;
      g.drawImage(s, x - px / 2, y - px / 2, px, px);
      if (Math.random() < dt * 30) {
        addSpark({
          x,
          y,
          vx: (Math.random() - 0.5) * W * 0.01,
          vy: (Math.random() - 0.5) * H * 0.01,
          life: 0,
          max: 0.7,
          size: H * 0.005,
          color: "#ffe766",
          smoke: false,
        });
      }
    }

    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i]!;
      s.life += dt;
      if (s.life >= s.max) {
        sparks.splice(i, 1);
        continue;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (!s.smoke) s.vy += H * 0.2 * dt;
      const f = s.life / s.max;
      g.globalAlpha = (1 - f) * (s.smoke ? 0.8 : 1);
      g.fillStyle = s.color;
      g.beginPath();
      g.arc(s.x, s.y, s.size * (s.smoke ? 1 + f * 2 : 1), 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
  };

  const loop = ctx.loop({
    hz: 60,
    update(dt) {
      if (disposed) return;
      const t = now();
      if (t - columnsAt >= COLUMNS_MS) {
        columnsAt = t;
        updateColumns();
      }
      plant.step(dt, ctx.clock.now(), (to, m) => link.drop(to, m));
      link.tick({
        p: plant.pace.value * 1000,
        n: plant.park.things.length,
        q: plant.busy(t) ? 0 : 1,
      });
    },
    render() {
      if (disposed) return;
      const t = now();
      if (t - lastRender < RENDER_MS) return;
      lastRender = t;
      const dt = Math.min(0.1, (t - lastStep) / 1000);
      lastStep = t;
      draw(ctx.clock.now(), dt);
    },
  });
  loop.start();

  const offResize = ctx.onResize((f) => {
    frame = f;
    size();
  });

  const debugKey = "__recycling";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => {
          const c = ctx.clock.now();
          return {
            screen: true,
            clock: c,
            columns: plant.columns.map((x) => ({ ...x })),
            fw: plant.fw,
            S: geo.S,
            width: geo.W,
            height: geo.H,
            inlets: plant.inlets.map((i) => ({ column: i.column, index: i.index, u: i.u, x: i.x })),
            recent: plant.recent.map((r) => ({ ...r })),
            falling: plant.jobs
              .filter((j) => j.fall)
              .map((j) => {
                fallAt(j.fall!, (c - j.fall!.t0) / 1000, scratch);
                return { id: j.id, x: scratch.x, y: scratch.y };
              }),
            jobs: plant.jobs.length,
            rising: plant.rising.length,
            flights: plant.flights.length,
            park: plant.park.things.map((t) => t.kind),
            pace: plant.pace.value,
            counts: { ...plant.counts },
            busy: plant.busy(now()),
            alone: plant.alone(now()),
            sparks: sparks.length,
            maxRising: MAX_RISING,
          };
        },
        setLag: (ms: number) => {
          if (lagged) lagged.lag = ms;
        },
        command: (name: string) => {
          if (name === "clear") plant.clearPark();
        },
      },
    });
  }

  return {
    reset() {
      sparks.length = 0;
    },
    attract() {},
    status() {
      return {
        columns: plant.columns.length,
        frames: plant.columns.filter((c) => c.frame).length,
        drops: plant.counts.drops,
        right: plant.counts.right,
        wrong: plant.counts.wrong,
        park: plant.park.things.length,
        pace: Math.round(plant.pace.value * 100) / 100,
      };
    },
    command(name) {
      if (name === "clear") plant.clearPark();
    },
    dispose() {
      disposed = true;
      loop.stop();
      offResize();
      link.dispose();
      lagged?.dispose();
      backCanvas.remove();
      frontCanvas.remove();
      itemSprites = [];
      thingSprites.clear();
      binSprites.clear();
      sparks.length = 0;
      ctx.root.style.background = "";
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
