/**
 * Everything on the 2D canvas over the 3D views: the caption, labels on the views (the date,
 * day length, the Sun's noon height, the season, the Moon's phase), and the controls drawn by
 * hand (the wheel, the dial and the sliders), plus ghost hands in the tour. Venue px.
 */
import type { Rect } from "../../core/types";
import { drawHand, drawMoon, fitLines, fitSize, text } from "./art";
import {
  MONTHS,
  PHASE_NAMES,
  phaseOf,
  timeOf,
  dateOf,
  yearFraction,
  EARTH_TILT,
  type Season,
} from "./astro";
import { INK, MUTED, rgba, SUMMER, SUN, WINTER } from "./config";
import { dialAngle, latU, tiltU } from "./controls";
import type { Circle, Layout, Slider } from "./layout";
import { sliderX } from "./layout";
import { dayText, latText, type Local, noonText } from "./sky";

const TAU = Math.PI * 2;

export interface PlaceLook {
  name: string | null;
  lat: number;
  colour: string;
  local: Local;
}

export interface Look {
  layout: Layout;
  labels: boolean;
  caption: string | null;
  captionAlpha: number;
  /** The date shown. */
  day: number;
  hour: number;
  tilt: number;
  baseTilt: number;
  distanceKm: number;
  /** Moon variant. */
  moon: { elong: number; lit: number; eclipse: boolean } | null;
  /** The space view's rectangle when it shows, its projected labels in venue px. */
  space: {
    rect: Rect;
    months: { text: string; x: number; y: number }[];
    north: { x: number; y: number } | null;
    shadow: { x: number; y: number } | null;
  } | null;
  grounds: { rect: Rect; place: PlaceLook; compass: { text: string; x: number; y: number }[] }[];
  /** Each slider's place, for the place sliders. */
  places: PlaceLook[];
  /** Marks on the place sliders (Brisbane, the compare place). */
  marks: { lat: number; colour: string; name: string }[][];
  active: { wheel: boolean; dial: boolean; tilt: boolean; places: boolean[] };
  hand: { kind: "wheel" | "tilt" | "dial"; alpha: number } | null;
  strip: string | null;
  bankStrip: { u: number; colour: string; lat: number; hours: number }[] | null;
  time: number;
}

const seasonText = (s: Season | null): string | null =>
  s === null ? null : s[0]!.toUpperCase() + s.slice(1);
const seasonColour = (s: Season | null): string =>
  s === "summer" ? SUMMER : s === "winter" ? WINTER : s === "spring" ? "#9be58a" : "#e8b07a";

/** A month name and day, "21 December". */
const dateLabel = (t: number): string => {
  const d = dateOf(t);
  return `${d.day} ${MONTHS[d.month]}`;
};

const clockLabel = (h: number): string => {
  const m = Math.floor((((h % 24) + 24) % 24) * 60 + 0.5) % 1440;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
};

const disc = (
  g: CanvasRenderingContext2D,
  c: Circle,
  fill: string,
  stroke: string,
  line: number,
) => {
  g.beginPath();
  g.arc(c.x, c.y, c.r, 0, TAU);
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = line;
  g.strokeStyle = stroke;
  g.stroke();
};

const pointer = (g: CanvasRenderingContext2D, c: Circle, colour: string) => {
  const s = c.r * 0.16;
  g.beginPath();
  g.moveTo(c.x, c.y - c.r + s * 1.1);
  g.lineTo(c.x - s * 0.8, c.y - c.r - s * 0.5);
  g.lineTo(c.x + s * 0.8, c.y - c.r - s * 0.5);
  g.closePath();
  g.fillStyle = colour;
  g.fill();
  g.lineWidth = s * 0.18;
  g.strokeStyle = "rgba(4,6,12,0.9)";
  g.stroke();
};

/** Where on the wheel a month starts, as a canvas angle, with the date `t` under the pointer. */
const wheelAngle = (frac: number, now: number) => -Math.PI / 2 + TAU * (frac - now);

const drawYearWheel = (g: CanvasRenderingContext2D, c: Circle, t: number, active: boolean) => {
  const now = yearFraction(t);
  const year = dateOf(t).year;
  const span = timeOf(year + 1, 0, 1) - timeOf(year, 0, 1);
  disc(g, c, "rgba(10,14,28,0.92)", active ? SUN : "rgba(242,245,250,0.45)", c.r * 0.035);
  for (let m = 0; m < 12; m++) {
    const f0 = (timeOf(year, m, 1) - timeOf(year, 0, 1)) / span;
    const f1 = (timeOf(year, m + 1, 1) - timeOf(year, 0, 1)) / span;
    const a0 = wheelAngle(f0, now);
    const a1 = wheelAngle(f1, now);
    // Brisbane's summer warm, its winter cool.
    const tint = m === 11 || m <= 1 ? SUMMER : m >= 5 && m <= 7 ? WINTER : null;
    g.beginPath();
    g.moveTo(c.x, c.y);
    g.arc(c.x, c.y, c.r * 0.96, a0, a1);
    g.closePath();
    g.fillStyle = tint
      ? rgba(tint, 0.22)
      : m % 2
        ? "rgba(242,245,250,0.05)"
        : "rgba(242,245,250,0.1)";
    g.fill();
    g.beginPath();
    g.moveTo(c.x + Math.cos(a0) * c.r * 0.55, c.y + Math.sin(a0) * c.r * 0.55);
    g.lineTo(c.x + Math.cos(a0) * c.r * 0.96, c.y + Math.sin(a0) * c.r * 0.96);
    g.lineWidth = c.r * 0.012;
    g.strokeStyle = "rgba(242,245,250,0.35)";
    g.stroke();
    const mid = (a0 + a1) / 2;
    const name = c.r >= 200 ? MONTHS[m]!.slice(0, 3) : MONTHS[m]![0]!;
    const rr = c.r * 0.77;
    g.save();
    g.translate(c.x + Math.cos(mid) * rr, c.y + Math.sin(mid) * rr);
    g.rotate(mid + Math.PI / 2);
    text(g, name, 0, 0, c.r * (c.r >= 200 ? 0.14 : 0.17), tint ?? INK);
    g.restore();
  }
  // The Sun in the middle.
  g.beginPath();
  g.arc(c.x, c.y, c.r * 0.16, 0, TAU);
  g.fillStyle = SUN;
  g.fill();
  pointer(g, c, INK);
};

const drawMoonWheel = (
  g: CanvasRenderingContext2D,
  c: Circle,
  elong: number,
  south: boolean,
  active: boolean,
) => {
  disc(g, c, "rgba(10,14,28,0.92)", active ? INK : "rgba(242,245,250,0.45)", c.r * 0.035);
  for (let i = 0; i < 8; i++) {
    const e = i * 45;
    const a = -Math.PI / 2 + ((e - elong) * Math.PI) / 180;
    const rr = c.r * 0.7;
    const lit = (1 - Math.cos((e * Math.PI) / 180)) / 2;
    // As seen from the ground: from the south a growing Moon is lit on its left.
    const waxing = e > 0 && e < 180;
    const side = waxing === south ? 180 : 0;
    drawMoon(g, c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr, c.r * 0.15, lit, side);
  }
  // The Earth in the middle.
  g.beginPath();
  g.arc(c.x, c.y, c.r * 0.2, 0, TAU);
  g.fillStyle = "#2a64b8";
  g.fill();
  pointer(g, c, INK);
};

const drawDial = (
  g: CanvasRenderingContext2D,
  c: Circle,
  hour: number,
  dayLen: number,
  active: boolean,
) => {
  disc(g, c, "rgba(8,12,26,0.94)", active ? SUN : "rgba(242,245,250,0.45)", c.r * 0.035);
  // Day and night round the face, for this place today.
  const rise = 12 - dayLen / 2;
  const set = 12 + dayLen / 2;
  const ang = (h: number) => -Math.PI / 2 + dialAngle(h);
  g.beginPath();
  g.arc(c.x, c.y, c.r * 0.9, 0, TAU);
  g.fillStyle = "rgba(20,28,60,0.9)";
  g.fill();
  if (dayLen > 0.01) {
    g.beginPath();
    g.moveTo(c.x, c.y);
    if (dayLen >= 23.99) g.arc(c.x, c.y, c.r * 0.9, 0, TAU);
    else g.arc(c.x, c.y, c.r * 0.9, ang(rise), ang(set));
    g.closePath();
    g.fillStyle = "rgba(255,206,92,0.42)";
    g.fill();
  }
  for (let h = 0; h < 24; h++) {
    const a = ang(h);
    const big = h % 6 === 0;
    g.beginPath();
    g.moveTo(
      c.x + Math.cos(a) * c.r * (big ? 0.72 : 0.8),
      c.y + Math.sin(a) * c.r * (big ? 0.72 : 0.8),
    );
    g.lineTo(c.x + Math.cos(a) * c.r * 0.9, c.y + Math.sin(a) * c.r * 0.9);
    g.lineWidth = c.r * (big ? 0.03 : 0.015);
    g.strokeStyle = "rgba(242,245,250,0.6)";
    g.stroke();
  }
  for (const [h, s] of [
    [12, "12"],
    [18, "18"],
    [0, "0"],
    [6, "6"],
  ] as const) {
    const a = ang(h);
    text(g, s, c.x + Math.cos(a) * c.r * 0.58, c.y + Math.sin(a) * c.r * 0.58, c.r * 0.16, MUTED);
  }
  const a = ang(hour);
  const up = hour > rise && hour < set ? dayLen > 0 : dayLen >= 23.99;
  g.beginPath();
  g.moveTo(c.x, c.y);
  g.lineTo(c.x + Math.cos(a) * c.r * 0.62, c.y + Math.sin(a) * c.r * 0.62);
  g.lineWidth = c.r * 0.05;
  g.lineCap = "round";
  g.strokeStyle = INK;
  g.stroke();
  const kx = c.x + Math.cos(a) * c.r * 0.7;
  const ky = c.y + Math.sin(a) * c.r * 0.7;
  if (up) {
    g.beginPath();
    g.arc(kx, ky, c.r * 0.16, 0, TAU);
    g.fillStyle = SUN;
    g.fill();
  } else drawMoon(g, kx, ky, c.r * 0.15, 0.75, 180);
  text(g, clockLabel(hour), c.x, c.y + c.r * 0.28, c.r * 0.15, INK);
};

const drawSlider = (
  g: CanvasRenderingContext2D,
  s: Slider,
  u: number,
  knobText: string,
  marks: { u: number; text: string; colour: string }[],
  colour: string,
  active: boolean,
) => {
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(s.x0, s.y);
  g.lineTo(s.x1, s.y);
  g.lineWidth = s.r * 0.32;
  g.strokeStyle = "rgba(242,245,250,0.18)";
  g.stroke();
  const dy = s.above ? -s.r * 1.25 : s.r * 1.25;
  for (const m of marks) {
    const x = sliderX(s, m.u);
    g.beginPath();
    g.moveTo(x, s.y - s.r * 0.42);
    g.lineTo(x, s.y + s.r * 0.42);
    g.lineWidth = s.r * 0.08;
    g.strokeStyle = m.colour;
    g.stroke();
    const align: CanvasTextAlign = m.u <= 0.02 ? "left" : m.u >= 0.98 ? "right" : "center";
    const tx = align === "left" ? x - s.r * 0.6 : align === "right" ? x + s.r * 0.6 : x;
    if (m.text) text(g, m.text, tx, s.y + dy, s.text, m.colour, align);
  }
  const x = sliderX(s, u);
  g.beginPath();
  g.arc(x, s.y, s.r, 0, TAU);
  g.fillStyle = active ? colour : "rgba(10,14,28,0.95)";
  g.fill();
  g.lineWidth = s.r * 0.1;
  g.strokeStyle = colour;
  g.stroke();
  const size = fitSize(g, knobText, s.r * 1.7, s.r * 0.56);
  g.font = `800 ${size}px system-ui`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = active ? "#05070d" : INK;
  g.fillText(knobText, x, s.y + s.r * 0.03);
};

const drawGround = (
  g: CanvasRenderingContext2D,
  r: Rect,
  p: PlaceLook,
  compass: { text: string; x: number; y: number }[],
  base: number,
  moon: Look["moon"],
  labels: boolean,
) => {
  const pad = base * 0.5;
  const big = Math.min(base * 1.25, r.height * 0.11);
  const mid = big * 0.68;
  for (const c of compass) {
    if (c.x < mid || c.x > r.width - mid || c.y < mid || c.y > r.height - mid * 0.6) continue;
    text(g, c.text, r.x + c.x, r.y + c.y, mid, "#f2f5fa");
  }
  // The place, its latitude and its season.
  const name = p.name ?? latText(p.lat);
  let y = r.y + pad + big * 0.6;
  text(g, name, r.x + pad, y, big, p.colour, "left");
  y += big * 0.95;
  if (p.name) {
    text(g, latText(p.lat), r.x + pad, y, mid, MUTED, "left");
    y += mid * 1.15;
  }
  const season = seasonText(p.local.season);
  if (season) text(g, season, r.x + pad, y, mid, seasonColour(p.local.season), "left");
  const rx = r.x + r.width - pad;
  if (moon) {
    // The Moon as it looks from here, and its phase.
    const mr = Math.min(r.height * 0.14, r.width * 0.09);
    const mx = rx - mr;
    const my = r.y + pad + mr;
    drawMoon(g, mx, my, mr, moon.lit, p.local.moon.limb, moon.eclipse);
    const phase = PHASE_NAMES[phaseOf(moon.elong)];
    if (labels || moon.eclipse) {
      text(g, moon.eclipse ? "Eclipse" : phase, rx, my + mr + mid * 0.9, mid, INK, "right");
    }
    if (p.local.moon.alt < 0) {
      text(g, "Below the horizon", rx, my + mr + mid * 2, mid * 0.75, MUTED, "right");
    }
    return;
  }
  text(g, `${dayText(p.local.dayLength)} day`, rx, r.y + pad + big * 0.6, big, SUN, "right");
  text(g, noonText(p.local.noonAlt), rx, r.y + pad + big * 1.55, mid, INK, "right");
  if (p.local.dayLength >= 23.99)
    text(g, "No sunset", rx, r.y + pad + big * 2.35, mid, SUMMER, "right");
  else if (p.local.dayLength <= 0.01)
    text(g, "No sunrise", rx, r.y + pad + big * 2.35, mid, WINTER, "right");
};

export const drawOverlay = (g: CanvasRenderingContext2D, look: Look): void => {
  const l = look.layout;
  const base = l.text;
  if (look.strip) {
    g.fillStyle = look.strip;
    g.fillRect(0, 0, l.width, l.strip?.height ?? 16);
  }
  // Ground views.
  for (const gv of look.grounds) {
    drawGround(g, gv.rect, gv.place, gv.compass, base, look.moon, look.labels);
  }
  // The space view's labels.
  if (look.space) {
    const r = look.space.rect;
    const pad = base * 0.5;
    if (look.labels) {
      for (const m of look.space.months) {
        if (m.x < r.x || m.x > r.x + r.width || m.y < r.y || m.y > r.y + r.height) continue;
        text(g, m.text, m.x, m.y, base * 0.62, "rgba(200,212,240,0.85)");
      }
    }
    const inside = (p: { x: number; y: number } | null, m: number): p is { x: number; y: number } =>
      p !== null && p.x > r.x + m && p.x < r.x + r.width - m && p.y > r.y && p.y < r.y + r.height;
    if (inside(look.space.north, base)) {
      text(g, "N", look.space.north.x, look.space.north.y, base * 0.6, INK);
    }
    if (inside(look.space.shadow, base * 2.2)) {
      text(g, "Shadow", look.space.shadow.x, look.space.shadow.y, base * 0.55, MUTED);
    }
    const dateY =
      l.kind === "screen" || l.kind === "wall"
        ? r.y + l.caption.height + pad * 3
        : r.y + pad + base * 0.6;
    const dateX = r.x + pad;
    text(g, dateLabel(look.day), dateX, dateY, base * 1.15, INK, "left");
    if (!look.moon) {
      const tiltLabel = `Tilt ${Math.round(look.tilt)}°`;
      text(g, tiltLabel, dateX, dateY + base * 1.1, base * 0.72, MUTED, "left");
    }
    const by = r.y + r.height - pad - base * 0.35;
    const corner = l.kind === "screen" && l.bankStrip ? l.bankStrip.y - pad - base * 0.35 : by;
    text(g, "Not to scale", r.x + pad, corner, base * 0.5, MUTED, "left");
    if (!look.moon) {
      const km = `${(look.distanceKm / 1e6).toFixed(1)} million km from the Sun`;
      text(g, km, r.x + r.width - pad, corner, base * 0.5, MUTED, "right");
    }
  }
  // Controls.
  const south = (look.places[0]?.lat ?? -27.5) < 0;
  if (l.wheel) {
    if (look.moon) drawMoonWheel(g, l.wheel, look.moon.elong, south, look.active.wheel);
    else drawYearWheel(g, l.wheel, look.day, look.active.wheel);
  }
  if (l.dial)
    drawDial(g, l.dial, look.hour, look.places[0]?.local.dayLength ?? 12, look.active.dial);
  if (l.tilt) {
    drawSlider(
      g,
      l.tilt,
      tiltU(look.tilt),
      `${Math.round(look.tilt)}°`,
      [
        { u: 0, text: "0°", colour: MUTED },
        { u: tiltU(EARTH_TILT), text: "Earth", colour: "#7fd6ff" },
        { u: 1, text: "On its side", colour: MUTED },
      ],
      "#7fd6ff",
      look.active.tilt,
    );
  }
  l.places.forEach((s, i) => {
    const p = look.places[i];
    if (!p) return;
    const named = (look.marks[i] ?? []).map((m) => ({
      u: latU(m.lat),
      text: m.name,
      colour: m.colour,
    }));
    // A named place close to a pole or the equator takes that mark's words.
    const plain = [
      { u: 0, text: "N pole", colour: MUTED },
      { u: 0.5, text: "Equator", colour: MUTED },
      { u: 1, text: "S pole", colour: MUTED },
    ].map((m) => (named.some((n) => Math.abs(n.u - m.u) < 0.2) ? { ...m, text: "" } : m));
    const marks = [...plain, ...named];
    drawSlider(
      g,
      s,
      latU(p.lat),
      latText(p.lat).replace("North Pole", "N").replace("South Pole", "S").replace("Equator", "0°"),
      marks,
      p.colour,
      look.active.places[i] ?? false,
    );
  });
  // The screen's labels over the bank: each frame's latitude and day length above it.
  if (look.bankStrip && l.bankStrip) {
    const r = l.bankStrip;
    const size = base * 0.62;
    for (const b of look.bankStrip) {
      const x = r.x + b.u * r.width;
      g.beginPath();
      g.arc(x, r.y + r.height * 0.3, size * 0.45, 0, TAU);
      g.fillStyle = b.colour;
      g.fill();
      text(g, latText(b.lat), x, r.y + r.height * 0.55, size, b.colour);
      text(g, dayText(b.hours), x, r.y + r.height * 0.8, size, INK);
    }
  }
  // Caption.
  if (look.caption && look.captionAlpha > 0.01) {
    const c = l.caption;
    const fit = fitLines(g, look.caption, c.width, c.size, c.lines);
    const pitch = fit.size * 1.15;
    const y0 = c.y + c.height / 2 - (pitch * (fit.lines.length - 1)) / 2;
    g.globalAlpha = look.captionAlpha;
    fit.lines.forEach((s, i) => text(g, s, c.x + c.width / 2, y0 + i * pitch, fit.size, INK));
    g.globalAlpha = 1;
  }
  // A ghost hand on the control the tour is working.
  if (look.hand && look.hand.alpha > 0.01) {
    const h = look.hand;
    let at: { x: number; y: number } | null = null;
    if (h.kind === "wheel" && l.wheel) {
      const a = -Math.PI / 2 - 0.9 + Math.sin(look.time * 0.5) * 0.05;
      at = {
        x: l.wheel.x + Math.cos(a) * l.wheel.r * 0.75,
        y: l.wheel.y + Math.sin(a) * l.wheel.r * 0.75,
      };
    } else if (h.kind === "dial" && l.dial) {
      const a = -Math.PI / 2 + dialAngle(look.hour);
      at = {
        x: l.dial.x + Math.cos(a) * l.dial.r * 0.7,
        y: l.dial.y + Math.sin(a) * l.dial.r * 0.7,
      };
    } else if (h.kind === "tilt" && l.tilt) {
      at = { x: sliderX(l.tilt, tiltU(look.tilt)), y: l.tilt.y };
    }
    if (at) drawHand(g, at.x + base * 0.2, at.y + base * 0.2, base * 3, h.alpha);
  }
};
