/**
 * Drawing a build: the theme's scenery (drawn once to a back layer), its fixed structure, the
 * slots and parts, parts and helpers on their way in, the sun that shows time left, the trophy
 * row, and what each theme does while it is alive. Everything is in the caller's venue px; the
 * build itself is fitted into an area with `fitBuild`.
 */
import { withAlpha } from "../../core/ui";
import { drawHelper, drawIcon, drawPart, drawTrophy } from "./art";
import type { Build, BuildSlot } from "./build";
import { ALIVE_MS, type ThemeId } from "./config";
import { createRng } from "../../core/rng";
import type { Box } from "./layout";
import {
  branchY,
  LIGHTHOUSE,
  ROBOT,
  ROCKET,
  SANDCASTLE,
  THEMES,
  towerCentres,
  towerHalf,
  TREEHOUSE,
} from "./themes";
import { circle, roundRect, TAU } from "./tasks/common";

type G = CanvasRenderingContext2D;

/** Build units to px: x = ox + u * s. */
export interface Fit {
  s: number;
  ox: number;
  oy: number;
  /** Px y of the ground line. */
  ground: number;
}

/** Where the ground is in each theme, in build units. */
const GROUND: Record<ThemeId, number> = {
  rocket: 0.97,
  treehouse: 0.985,
  lighthouse: 0.94,
  robot: 0.975,
  sandcastle: SANDCASTLE.ground,
};

/** Fit a theme's build in `area`: `height` of the area tall at most, its ground `bottom` down. */
export const fitBuild = (
  area: Box,
  theme: ThemeId,
  opts: { height?: number; bottom?: number; width?: number } = {},
): Fit => {
  const aspect = THEMES[theme].aspect;
  const bottom = opts.bottom ?? 0.95;
  let s = area.h * (opts.height ?? 0.8);
  s = Math.min(s, (area.w * (opts.width ?? 0.92)) / aspect);
  const ox = area.x + (area.w - aspect * s) / 2;
  const ground = area.y + area.h * bottom;
  const oy = ground - GROUND[theme] * s;
  return { s, ox, oy, ground };
};

export const slotBox = (f: Fit, s: { x: number; y: number; w: number; h: number }) => ({
  x: f.ox + s.x * f.s,
  y: f.oy + s.y * f.s,
  w: s.w * f.s,
  h: s.h * f.s,
});

export const slotCentre = (f: Fit, s: { x: number; y: number; w: number; h: number }) => ({
  x: f.ox + (s.x + s.w / 2) * f.s,
  y: f.oy + (s.y + s.h / 2) * f.s,
});

// ---- Scenery (static) --------------------------------------------------------------------

const SKY: Record<ThemeId, [string, string, string]> = {
  rocket: ["#040816", "#0f1a3d", "#26305e"],
  treehouse: ["#2f7fc0", "#68b4e2", "#bfe3f3"],
  lighthouse: ["#141f45", "#3d3f78", "#e8916a"],
  robot: ["#1a1f2c", "#262c3d", "#323a50"],
  sandcastle: ["#3f9fd8", "#86cdf0", "#d6f0fa"],
};

/** The theme's sky, ground and distant things, filling `area`. */
export const drawScene = (g: G, theme: ThemeId, area: Box, f: Fit, seed: string): void => {
  const rng = createRng(`${seed}:${theme}:scene`);
  const [a, b, c] = SKY[theme];
  const ground = f.ground;
  const sky = g.createLinearGradient(0, area.y, 0, ground);
  sky.addColorStop(0, a);
  sky.addColorStop(0.6, b);
  sky.addColorStop(1, c);
  g.fillStyle = sky;
  g.fillRect(area.x, area.y, area.w, Math.max(0, ground - area.y));
  const bottom = area.y + area.h;
  const S = f.s;
  switch (theme) {
    case "rocket": {
      const n = Math.min(900, Math.round((area.w * (ground - area.y)) / 9000));
      for (let i = 0; i < n; i++) {
        g.fillStyle = `rgba(255,255,255,${rng.range(0.25, 0.9)})`;
        circle(
          g,
          area.x + rng.next() * area.w,
          area.y + rng.next() * (ground - area.y),
          rng.range(0.6, 2.2) * Math.max(1, S / 900),
        );
        g.fill();
      }
      g.fillStyle = "#2a3040";
      g.fillRect(area.x, ground, area.w, bottom - ground);
      g.fillStyle = "#3a4252";
      g.fillRect(f.ox - S * 0.1, ground - S * 0.035, S * (ROCKET.aspect + 0.2), S * 0.035);
      // A gantry tower beside the pad.
      g.strokeStyle = "#566078";
      g.lineWidth = Math.max(2, S * 0.008);
      const gx = f.ox + S * (ROCKET.aspect + 0.05);
      const top = f.oy + S * 0.18;
      g.beginPath();
      g.moveTo(gx, ground - S * 0.035);
      g.lineTo(gx, top);
      g.moveTo(gx + S * 0.07, ground - S * 0.035);
      g.lineTo(gx + S * 0.07, top);
      for (let y = top; y < ground - S * 0.05; y += S * 0.06) {
        g.moveTo(gx, y);
        g.lineTo(gx + S * 0.07, y + S * 0.06);
        g.moveTo(gx + S * 0.07, y);
        g.lineTo(gx, y + S * 0.06);
      }
      g.stroke();
      return;
    }
    case "treehouse": {
      for (let i = 0; i < 6; i++) {
        const cx = area.x + rng.next() * area.w;
        const cy = area.y + (ground - area.y) * rng.range(0.08, 0.4);
        const r = S * rng.range(0.04, 0.08);
        g.fillStyle = "rgba(255,255,255,0.75)";
        for (let k = 0; k < 4; k++) {
          circle(g, cx + (k - 1.5) * r * 0.9, cy + (k % 2) * r * 0.25, r);
          g.fill();
        }
      }
      g.fillStyle = "#4f9a48";
      g.fillRect(area.x, ground, area.w, bottom - ground);
      g.fillStyle = "#5fae55";
      for (let x = area.x; x < area.x + area.w; x += S * 0.05) {
        circle(g, x, ground, S * 0.035);
        g.fill();
      }
      return;
    }
    case "lighthouse": {
      g.fillStyle = "#fbe2a8";
      circle(g, area.x + area.w * 0.82, ground - S * 0.04, S * 0.06);
      g.fill();
      g.fillStyle = "#1c4e7a";
      g.fillRect(area.x, ground, area.w, bottom - ground);
      g.strokeStyle = "rgba(160,200,240,0.35)";
      g.lineWidth = Math.max(2, S * 0.005);
      for (let i = 0; i < 40; i++) {
        const x = area.x + rng.next() * area.w;
        const y = ground + rng.next() * (bottom - ground);
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + S * rng.range(0.03, 0.08), y);
        g.stroke();
      }
      return;
    }
    case "robot": {
      g.fillStyle = "rgba(255,255,255,0.05)";
      const step = Math.max(12, S * 0.05);
      for (let y = area.y + step / 2; y < ground; y += step) {
        for (let x = area.x + step / 2; x < area.x + area.w; x += step) {
          circle(g, x, y, step * 0.08);
          g.fill();
        }
      }
      g.fillStyle = "#3a3f4f";
      g.fillRect(area.x, ground, area.w, bottom - ground);
      g.fillStyle = "#4a5165";
      g.fillRect(area.x, ground, area.w, Math.min(bottom - ground, S * 0.012));
      return;
    }
    case "sandcastle": {
      g.fillStyle = "#2f8fc8";
      g.fillRect(area.x, ground - S * 0.1, area.w, S * 0.1);
      g.fillStyle = "rgba(255,255,255,0.5)";
      for (let x = area.x; x < area.x + area.w; x += S * 0.08) {
        g.fillRect(x, ground - S * 0.1 + S * 0.02 * ((x / S) % 2), S * 0.04, S * 0.006);
      }
      g.fillStyle = "#e9cd8f";
      g.fillRect(area.x, ground, area.w, bottom - ground);
      g.fillStyle = "rgba(190,150,90,0.5)";
      for (let i = 0; i < 200; i++) {
        circle(
          g,
          area.x + rng.next() * area.w,
          ground + rng.next() * (bottom - ground),
          Math.max(1, S * 0.003),
        );
        g.fill();
      }
    }
  }
};

// ---- Structure (drawn under the parts) ---------------------------------------------------

const drawStructure = (g: G, b: Build, f: Fit, lit: number, t: number) => {
  const S = f.s;
  const X = (u: number) => f.ox + u * S;
  const Y = (u: number) => f.oy + u * S;
  const done = b.phase === "alive";
  switch (b.theme) {
    case "rocket": {
      const { body, noseTop, bell, cx } = ROCKET;
      g.fillStyle = done ? "#f07d5a" : "rgba(200,215,240,0.18)";
      g.beginPath();
      g.moveTo(X(body.x0), Y(body.y0));
      g.quadraticCurveTo(X(body.x0), Y(noseTop + 0.05), X(cx), Y(noseTop));
      g.quadraticCurveTo(X(body.x1), Y(noseTop + 0.05), X(body.x1), Y(body.y0));
      g.closePath();
      g.fill();
      g.fillStyle = "#7a8496";
      g.beginPath();
      g.moveTo(X(cx - 0.05), Y(body.y1));
      g.lineTo(X(cx + 0.05), Y(body.y1));
      g.lineTo(X(cx + 0.075), Y(bell));
      g.lineTo(X(cx - 0.075), Y(bell));
      g.closePath();
      g.fill();
      return;
    }
    case "treehouse": {
      const T = TREEHOUSE;
      // Canopy behind everything, then trunk and branches.
      g.fillStyle = "#3f8f4a";
      for (const [u, v, r] of [
        [0.2, 0.2, 0.17],
        [0.5, 0.1, 0.2],
        [0.8, 0.2, 0.17],
        [0.1, 0.36, 0.12],
        [0.9, 0.34, 0.12],
      ] as const) {
        circle(g, X(u), Y(v), r * S);
        g.fill();
      }
      g.fillStyle = "#7a4e2d";
      g.beginPath();
      g.moveTo(X(T.trunk.x0 - 0.03), Y(1));
      g.lineTo(X(T.trunk.x0), Y(0.3));
      g.lineTo(X(T.trunk.x1), Y(0.3));
      g.lineTo(X(T.trunk.x1 + 0.03), Y(1));
      g.closePath();
      g.fill();
      g.strokeStyle = "#7a4e2d";
      g.lineCap = "round";
      g.lineWidth = S * 0.03;
      for (const br of T.branches) {
        g.beginPath();
        g.moveTo(X(br.x0), Y(br.y0));
        g.lineTo(X(br.x1), Y(br.y1));
        g.stroke();
      }
      g.strokeStyle = "#8b5a2b";
      g.lineWidth = S * 0.012;
      g.beginPath();
      g.moveTo(X(T.ladder.x0 + 0.01), Y(T.ladder.y0));
      g.lineTo(X(T.ladder.x0 + 0.01), Y(T.ladder.y1));
      g.moveTo(X(T.ladder.x1 - 0.01), Y(T.ladder.y0));
      g.lineTo(X(T.ladder.x1 - 0.01), Y(T.ladder.y1));
      g.stroke();
      if (lit > 0) {
        // Fireflies round the canopy.
        for (let i = 0; i < 14; i++) {
          const a = t * (0.4 + (i % 3) * 0.15) + i * 1.7;
          const x = X(0.5 + Math.cos(a) * (0.35 + (i % 4) * 0.03));
          const y = Y(0.28 + Math.sin(a * 1.3) * 0.15);
          g.fillStyle = `rgba(255,240,150,${lit * (0.5 + 0.5 * Math.sin(t * 5 + i))})`;
          circle(g, x, y, S * 0.008);
          g.fill();
        }
      }
      return;
    }
    case "lighthouse": {
      const L = LIGHTHOUSE;
      g.fillStyle = "#4b4f5c";
      g.beginPath();
      g.moveTo(X(L.cx - 0.29), Y(1.02));
      g.lineTo(X(L.cx - 0.22), Y(0.9));
      g.lineTo(X(L.cx + 0.2), Y(0.88));
      g.lineTo(X(L.cx + 0.3), Y(1.02));
      g.closePath();
      g.fill();
      g.fillStyle = "rgba(200,215,240,0.12)";
      g.beginPath();
      g.moveTo(X(L.cx - towerHalf(L.tower.top)), Y(L.tower.top));
      g.lineTo(X(L.cx + towerHalf(L.tower.top)), Y(L.tower.top));
      g.lineTo(X(L.cx + towerHalf(L.tower.bottom)), Y(L.tower.bottom));
      g.lineTo(X(L.cx - towerHalf(L.tower.bottom)), Y(L.tower.bottom));
      g.closePath();
      g.fill();
      g.fillStyle = "#2d3542";
      g.fillRect(
        X(L.cx - L.gallery.half - 0.01),
        Y(L.gallery.y1 - 0.008),
        (L.gallery.half * 2 + 0.02) * S,
        0.016 * S,
      );
      g.beginPath();
      g.moveTo(X(L.cx - L.lamp.half - 0.01), Y(L.lamp.y0));
      g.quadraticCurveTo(X(L.cx), Y(L.dome - 0.03), X(L.cx + L.lamp.half + 0.01), Y(L.lamp.y0));
      g.closePath();
      g.fill();
      return;
    }
    case "robot": {
      const R = ROBOT;
      g.fillStyle = "#7d889f";
      for (const dx of [-0.08, 0.08]) {
        roundRect(
          g,
          X(R.cx + dx - 0.045),
          Y(R.legs.y0),
          0.09 * S,
          (R.legs.y1 - R.legs.y0) * S,
          0.02 * S,
        );
        g.fill();
      }
      g.fillStyle = "#5d6a85";
      for (const dx of [-0.08, 0.08]) {
        roundRect(g, X(R.cx + dx - 0.07), Y(R.legs.y1 - 0.01), 0.14 * S, 0.05 * S, 0.02 * S);
        g.fill();
      }
      g.fillStyle = "rgba(200,215,240,0.14)";
      roundRect(
        g,
        X(R.cx - R.torso.half),
        Y(R.torso.y0),
        R.torso.half * 2 * S,
        (R.torso.y1 - R.torso.y0) * S,
        0.02 * S,
      );
      g.fill();
      g.fillStyle = "#9aa6bf";
      roundRect(
        g,
        X(R.cx - R.head.half),
        Y(R.head.y0),
        R.head.half * 2 * S,
        (R.head.y1 - R.head.y0) * S,
        0.04 * S,
      );
      g.fill();
      g.fillStyle = "#5d6a85";
      g.fillRect(X(R.cx - 0.04), Y(R.head.y1), 0.08 * S, (R.torso.y0 - R.head.y1) * S);
      g.strokeStyle = "#5d6a85";
      g.lineWidth = Math.max(1, S * 0.01);
      g.beginPath();
      g.moveTo(X(R.cx), Y(R.head.y0));
      g.lineTo(X(R.cx), Y(0.06));
      g.stroke();
      // A mouth that smiles when the robot is finished.
      g.strokeStyle = "#3a4b70";
      g.lineWidth = Math.max(1, S * 0.012);
      g.beginPath();
      if (done) g.arc(X(R.cx), Y(0.215), 0.045 * S, 0.15 * Math.PI, 0.85 * Math.PI);
      else {
        g.moveTo(X(R.cx - 0.04), Y(0.235));
        g.lineTo(X(R.cx + 0.04), Y(0.235));
      }
      g.stroke();
      return;
    }
    case "sandcastle": {
      g.fillStyle = "#e3c27f";
      g.beginPath();
      g.ellipse(
        X(SANDCASTLE.aspect / 2),
        Y(SANDCASTLE.ground + 0.01),
        0.72 * S,
        0.035 * S,
        0,
        0,
        TAU,
      );
      g.fill();
      return;
    }
  }
};

// ---- Parts --------------------------------------------------------------------------------

export interface Colors {
  players: readonly string[];
}

const BOT = "#ffffff";

const colorOf = (s: BuildSlot, c: Colors) =>
  s.maker === "person"
    ? (c.players[s.color % c.players.length] ?? BOT)
    : s.maker === "bot"
      ? BOT
      : null;

/** Offsets for groups that move while alive. */
const groupMotion = (theme: ThemeId, group: number, t: number, f: Fit) => {
  const S = f.s;
  if (theme === "rocket") {
    const lift = t > 1.6 ? 0.07 * (t - 1.6) ** 2 : 0;
    return { dx: 0, dy: -lift * S, rot: 0, px: 0, py: 0 };
  }
  if (theme === "robot" && group === 1) {
    const ramp = Math.min(1, t / 0.7);
    const rot = ramp * (-2.3 + 0.35 * Math.sin(t * 7));
    const px = f.ox + (ROBOT.cx + (ROBOT.arms.inner + ROBOT.arms.outer) / 2) * S;
    const py = f.oy + ROBOT.arms.y0 * S;
    return { dx: 0, dy: 0, rot, px, py };
  }
  if (theme === "sandcastle" && group === 1) {
    return { dx: Math.sin(t * 6) * S * 0.008, dy: 0, rot: 0, px: 0, py: 0 };
  }
  return null;
};

/** Seconds since the build came alive, or -1. */
const aliveFor = (b: Build, now: number) =>
  b.phase === "alive" ? Math.max(0, (now - b.aliveAt) / 1000) : -1;

export interface DrawOpts {
  colors: Colors;
  /** Seconds, for idle motion. */
  time: number;
  /** Outline open slots. */
  blueprint?: boolean;
}

/** The build's structure, open slots and landed parts, and its alive effects. */
export const drawBuild = (g: G, b: Build, f: Fit, now: number, o: DrawOpts): void => {
  const alive = aliveFor(b, now);
  const lit = alive < 0 ? 0 : Math.min(1, alive / 0.5);
  const t = o.time;
  const theme = b.theme;
  const rocketGone = theme === "rocket" && alive >= 0;
  if (rocketGone) {
    const m = groupMotion(theme, 0, alive, f)!;
    g.save();
    g.translate(0, m.dy);
    drawRocketFlame(g, f, alive, t);
  }
  drawStructure(g, b, f, lit, t);
  if (o.blueprint !== false) {
    g.setLineDash([Math.max(3, f.s * 0.008), Math.max(3, f.s * 0.008)]);
    g.lineWidth = Math.max(1.5, f.s * 0.003);
    for (const s of b.slots) {
      if (s.state === "filled") continue;
      const r = slotBox(f, s);
      g.strokeStyle = s.state === "coming" ? "rgba(255,255,255,0.6)" : "rgba(200,220,255,0.32)";
      roundRect(g, r.x, r.y, r.w, r.h, Math.min(r.w, r.h) * 0.15);
      g.stroke();
    }
    g.setLineDash([]);
  }
  for (let pass = 0; pass < 2; pass++) {
    for (const s of b.slots) {
      if (s.state !== "filled" || s.group !== pass) continue;
      const m = alive >= 0 && !rocketGone ? groupMotion(theme, s.group, alive, f) : null;
      if (m) {
        g.save();
        if (m.rot) {
          g.translate(m.px, m.py);
          g.rotate(m.rot);
          g.translate(-m.px, -m.py);
        }
        g.translate(m.dx, m.dy);
      }
      const r = slotBox(f, s);
      const c = colorOf(s, o.colors);
      if (c) {
        const pulse = alive >= 0 ? 0.65 + 0.35 * Math.sin(t * 6 + s.order) : 0.55;
        const k = Math.min(r.w, r.h);
        g.strokeStyle = withAlpha(c, (alive >= 0 ? 0.45 : 0.22) * pulse);
        g.lineWidth = Math.max(4, k * (alive >= 0 ? 0.32 : 0.18));
        roundRect(g, r.x, r.y, r.w, r.h, k * 0.2);
        g.stroke();
      }
      drawPart(g, theme, s.kind, r.x, r.y, r.w, r.h, s.v, lit, t);
      if (c) {
        g.strokeStyle = withAlpha(c, alive >= 0 ? 0.95 : 0.7);
        g.lineWidth = Math.max(2, Math.min(r.w, r.h) * 0.07);
        roundRect(g, r.x, r.y, r.w, r.h, Math.min(r.w, r.h) * 0.2);
        g.stroke();
      }
      if (m) g.restore();
    }
  }
  if (rocketGone) g.restore();
  if (alive >= 0) drawAlive(g, b, f, alive, t);
};

const drawRocketFlame = (g: G, f: Fit, alive: number, t: number) => {
  const S = f.s;
  const x = f.ox + ROCKET.cx * S;
  const y = f.oy + ROCKET.bell * S;
  const k = Math.min(1, alive / 0.8);
  const len = S * (0.08 + 0.12 * k + 0.02 * Math.sin(t * 40));
  g.fillStyle = "rgba(255,160,80,0.9)";
  g.beginPath();
  g.moveTo(x - S * 0.06, y);
  g.quadraticCurveTo(x, y + len * 1.4, x + S * 0.06, y);
  g.closePath();
  g.fill();
  g.fillStyle = "rgba(255,245,210,0.95)";
  g.beginPath();
  g.moveTo(x - S * 0.03, y);
  g.quadraticCurveTo(x, y + len * 0.8, x + S * 0.03, y);
  g.closePath();
  g.fill();
};

const drawAlive = (g: G, b: Build, f: Fit, alive: number, t: number) => {
  const S = f.s;
  const X = (u: number) => f.ox + u * S;
  const Y = (u: number) => f.oy + u * S;
  const fade = Math.min(1, alive / 0.5) * Math.min(1, (ALIVE_MS / 1000 - alive) / 0.8);
  switch (b.theme) {
    case "rocket": {
      // Smoke billowing from the pad as it lifts.
      for (let i = 0; i < 9; i++) {
        const k = Math.min(1, alive / 3);
        const x = X(ROCKET.cx + (i - 4) * 0.06 * (0.5 + k));
        const y = f.ground - S * 0.03 - Math.abs(Math.sin(i * 1.3)) * S * 0.04;
        g.fillStyle = `rgba(220,225,235,${0.5 * fade})`;
        circle(g, x, y, S * (0.03 + 0.05 * k) * (0.7 + (i % 3) * 0.2));
        g.fill();
      }
      return;
    }
    case "lighthouse": {
      const L = LIGHTHOUSE;
      const lx = X(L.cx);
      const ly = Y((L.lamp.y0 + L.lamp.y1) / 2);
      const a = Math.cos(t * 1.4);
      const reach = S * 3;
      for (const side of [-1, 1]) {
        const strength = Math.max(0, a * side) * fade;
        if (strength <= 0) continue;
        const grad = g.createLinearGradient(lx, ly, lx + side * reach, ly);
        grad.addColorStop(0, `rgba(255,245,180,${0.55 * strength})`);
        grad.addColorStop(1, "rgba(255,245,180,0)");
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(lx, ly - S * 0.03);
        g.lineTo(lx + side * reach, ly - S * 0.25);
        g.lineTo(lx + side * reach, ly + S * 0.2);
        g.lineTo(lx, ly + S * 0.03);
        g.closePath();
        g.fill();
      }
      return;
    }
    case "robot": {
      // Little hearts float up from the chest.
      for (let i = 0; i < 4; i++) {
        const k = (alive * 0.4 + i * 0.25) % 1;
        const x = X(ROBOT.cx + Math.sin(i * 2.1 + t) * 0.06);
        const y = Y(0.45 - k * 0.45);
        const s = S * 0.02;
        g.fillStyle = `rgba(251,92,153,${(1 - k) * fade})`;
        g.beginPath();
        g.moveTo(x, y + s);
        g.bezierCurveTo(x - s * 2, y - s * 0.5, x - s * 0.5, y - s * 2, x, y - s * 0.6);
        g.bezierCurveTo(x + s * 0.5, y - s * 2, x + s * 2, y - s * 0.5, x, y + s);
        g.fill();
      }
      return;
    }
    case "sandcastle": {
      for (const x of towerCentres(b.slots.filter((s) => s.kind === 2).length)) {
        for (let i = 0; i < 3; i++) {
          const k = (alive * 0.6 + i / 3) % 1;
          g.fillStyle = `rgba(255,255,255,${(1 - k) * fade})`;
          circle(g, X(x + Math.sin(i * 2 + t) * 0.05), Y(SANDCASTLE.flag.y0 - k * 0.12), S * 0.008);
          g.fill();
        }
      }
      return;
    }
    case "treehouse": {
      const T = TREEHOUSE;
      for (const br of T.branches) {
        g.strokeStyle = `rgba(255,220,130,${0.35 * fade})`;
        g.lineWidth = S * 0.004;
        g.beginPath();
        for (let u = 0; u <= 1.001; u += 0.1) {
          const x = br.x0 + (br.x1 - br.x0) * u;
          g.lineTo(X(x), Y(branchY(br, x) + 0.012 + Math.sin(u * Math.PI) * 0.02));
        }
        g.stroke();
      }
    }
  }
};

// ---- Parts on their way ------------------------------------------------------------------

export interface FlightOpts {
  colors: Colors;
  time: number;
  /** Px size of a part when it sets off. */
  startSize: number;
  /** Px per second a part from below is rising at when it appears. */
  rise: number;
  /** Size of a helper robot. */
  helper: number;
}

const bez = (a: number, b: number, c: number, d: number, p: number) => {
  const q = 1 - p;
  return q * q * q * a + 3 * q * q * p * b + 3 * q * p * p * c + p * p * p * d;
};

/** Parts and helpers flying in, and helpers leaving once they have dropped their part. */
export const drawIncoming = (g: G, b: Build, f: Fit, area: Box, now: number, o: FlightOpts) => {
  for (const s of b.slots) {
    const isHelper = s.maker === "helper";
    if (s.state === "filled") {
      // A helper rises away for a moment after dropping its part.
      const after = now - s.arriveAt;
      if (!isHelper || after < 0 || after > 700) continue;
      const end = slotCentre(f, s);
      const k = after / 700;
      g.globalAlpha = 1 - k;
      drawHelper(
        g,
        end.x + (s.sx < 0.5 ? -1 : 1) * k * o.helper * 2,
        end.y - o.helper * (0.7 + k * 2),
        o.helper,
        o.time,
      );
      g.globalAlpha = 1;
      continue;
    }
    if (s.state !== "coming" || now < s.departAt) continue;
    const span = Math.max(1, s.arriveAt - s.departAt);
    const p = Math.min(1, (now - s.departAt) / span);
    const end = slotCentre(f, s);
    const box = slotBox(f, s);
    const sx = area.x + s.sx * area.w;
    const sy = area.y + s.sy * area.h;
    const d = Math.hypot(end.x - sx, end.y - sy);
    let c1x: number;
    let c1y: number;
    let c2x: number;
    let c2y: number;
    if (isHelper) {
      c1x = sx + (end.x - sx) * 0.35;
      c1y = sy - d * 0.15;
      c2x = end.x;
      c2y = end.y - d * 0.35;
    } else {
      c1x = sx;
      c1y = sy - Math.min(d * 0.6, (o.rise * span) / 3000);
      c2x = end.x;
      c2y = end.y + d * 0.2;
    }
    const x = bez(sx, c1x, c2x, end.x, p);
    const y = bez(sy, c1y, c2y, end.y, p);
    const size = o.startSize + (Math.max(box.w, box.h) - o.startSize) * p * p;
    if (isHelper) {
      drawIcon(g, b.theme, s.kind, x, y + o.helper * 0.55, Math.min(size, o.helper * 1.1), o.time);
      drawHelper(g, x, y, o.helper, o.time, end.x >= sx ? 1 : -1);
      continue;
    }
    const color = colorOf(s, o.colors) ?? BOT;
    // A trail of fading dots behind it.
    for (let i = 1; i <= 5; i++) {
      const q = p - i * 0.035;
      if (q <= 0) break;
      g.fillStyle = withAlpha(color, 0.5 * (1 - i / 6));
      circle(
        g,
        bez(sx, c1x, c2x, end.x, q),
        bez(sy, c1y, c2y, end.y, q),
        size * 0.32 * (1 - i / 7),
      );
      g.fill();
    }
    g.fillStyle = withAlpha(color, 0.3);
    circle(g, x, y, size * 0.75);
    g.fill();
    drawIcon(g, b.theme, s.kind, x, y, size, o.time);
  }
};

/** Where a part is drawn mid-flight, for tests: null unless it is in the air. */
export const flightPoint = (
  s: BuildSlot,
  f: Fit,
  area: Box,
  now: number,
  rise: number,
): { x: number; y: number; p: number } | null => {
  if (s.state !== "coming" || now < s.departAt || s.maker === "helper") return null;
  const span = Math.max(1, s.arriveAt - s.departAt);
  const p = Math.min(1, (now - s.departAt) / span);
  const end = slotCentre(f, s);
  const sx = area.x + s.sx * area.w;
  const sy = area.y + s.sy * area.h;
  const d = Math.hypot(end.x - sx, end.y - sy);
  const c1y = sy - Math.min(d * 0.6, (rise * span) / 3000);
  return {
    x: bez(sx, sx, end.x, end.x, p),
    y: bez(sy, c1y, end.y + d * 0.2, end.y, p),
    p,
  };
};

// ---- Sun and trophies --------------------------------------------------------------------

/** The sun crosses the top of `area` as the build's time runs out. */
export const drawSun = (g: G, b: Build, area: Box, now: number, size: number): void => {
  const span = Math.max(1, b.endAt - b.startAt);
  const p = b.phase === "alive" ? 1 : Math.min(1, Math.max(0, (now - b.startAt) / span));
  const x = area.x + area.w * (0.05 + 0.9 * p);
  const y = area.y + size * 1.4 + (1 - Math.sin(Math.PI * p)) * size * 1.6;
  const late = b.phase === "finishing" || p > 0.97;
  g.strokeStyle = "rgba(255,230,150,0.18)";
  g.lineWidth = Math.max(2, size * 0.08);
  g.setLineDash([size * 0.25, size * 0.35]);
  g.beginPath();
  for (let k = 0; k <= 20; k++) {
    const q = k / 20;
    const px = area.x + area.w * (0.05 + 0.9 * q);
    const py = area.y + size * 1.4 + (1 - Math.sin(Math.PI * q)) * size * 1.6;
    if (k === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.stroke();
  g.setLineDash([]);
  const color = late ? "#ff9d4a" : "#ffd84a";
  g.fillStyle = withAlpha(color, 0.25);
  circle(g, x, y, size * 1.45);
  g.fill();
  g.strokeStyle = color;
  g.lineWidth = Math.max(2, size * 0.12);
  g.lineCap = "round";
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + now / 4000;
    g.beginPath();
    g.moveTo(x + Math.cos(a) * size * 1.15, y + Math.sin(a) * size * 1.15);
    g.lineTo(x + Math.cos(a) * size * 1.5, y + Math.sin(a) * size * 1.5);
    g.stroke();
  }
  g.fillStyle = color;
  circle(g, x, y, size);
  g.fill();
};

/** A row of trophies along the top of `area`, one per build finished early. */
export const drawTrophies = (
  g: G,
  n: number,
  area: Box,
  size: number,
  align: "left" | "right" = "left",
) => {
  for (let i = 0; i < n; i++) {
    const x =
      align === "left" ? area.x + size * (0.8 + i * 1.1) : area.x + area.w - size * (0.8 + i * 1.1);
    drawTrophy(g, x, area.y + size * 0.75, size);
  }
};

// ---- Confetti ----------------------------------------------------------------------------

export interface Confetti {
  start(area: Box, count: number, seed: number, now: number): void;
  draw(g: G, now: number): void;
  readonly live: number;
}

const CONFETTI_MAX = 160;
const CONFETTI_COLORS = ["#6fa4fc", "#f0e82a", "#fb5c99", "#6cf7f8", "#89da9b", "#ad83d1"];

/** A fixed pool of confetti pieces, for a build's celebration. */
export const createConfetti = (): Confetti => {
  const xs = new Float32Array(CONFETTI_MAX);
  const ys = new Float32Array(CONFETTI_MAX);
  const vx = new Float32Array(CONFETTI_MAX);
  const vy = new Float32Array(CONFETTI_MAX);
  const spin = new Float32Array(CONFETTI_MAX);
  let n = 0;
  let t0 = 0;
  let size = 10;
  let gravity = 100;
  let floor = 0;
  return {
    start(area, count, seed, now) {
      const rng = createRng(seed);
      n = Math.min(CONFETTI_MAX, count);
      t0 = now;
      size = Math.max(4, Math.min(area.w, area.h) * 0.012);
      gravity = area.h * 0.35;
      floor = area.y + area.h;
      for (let i = 0; i < n; i++) {
        xs[i] = area.x + area.w * rng.range(0.1, 0.9);
        ys[i] = area.y + area.h * rng.range(0.3, 0.7);
        const a = rng.range(-Math.PI * 0.85, -Math.PI * 0.15);
        const v = area.h * rng.range(0.4, 0.9);
        vx[i] = Math.cos(a) * v;
        vy[i] = Math.sin(a) * v;
        spin[i] = rng.range(3, 9);
      }
    },
    draw(g, now) {
      if (n === 0) return;
      const t = (now - t0) / 1000;
      if (t > 6) {
        n = 0;
        return;
      }
      const fade = Math.min(1, (6 - t) / 1.5);
      for (let i = 0; i < n; i++) {
        const x = xs[i]! + vx[i]! * t;
        const y = ys[i]! + vy[i]! * t + 0.5 * gravity * t * t;
        if (y > floor) continue;
        g.save();
        g.translate(x, y);
        g.rotate(spin[i]! * t);
        g.globalAlpha = fade;
        g.fillStyle = CONFETTI_COLORS[i % CONFETTI_COLORS.length]!;
        g.fillRect(-size / 2, -size / 4, size, size / 2);
        g.restore();
      }
      g.globalAlpha = 1;
    },
    get live() {
      return n;
    },
  };
};

/** Time left in a build as 0 to 1 (1 just started). */
export const timeLeft = (b: Build, now: number): number =>
  b.phase === "alive"
    ? 0
    : Math.max(0, Math.min(1, (b.endAt - now) / Math.max(1, b.endAt - b.startAt)));

/**
 * Helpers with nothing to carry hover over the open slots, moving to another every few seconds,
 * so a build nobody is working on is never still. A pure function of time: no state to keep.
 */
export const drawIdleHelpers = (g: G, b: Build, f: Fit, time: number, n: number, size: number) => {
  if (b.phase === "alive") return;
  const open: number[] = [];
  b.slots.forEach((s, i) => {
    if (s.state === "open") open.push(i);
  });
  if (open.length === 0) return;
  const at = (k: number, step: number) => {
    const pick = Math.abs(Math.floor(step * 7.31 + k * 13.7)) % open.length;
    const s = b.slots[open[pick]!]!;
    const c = slotCentre(f, s);
    return { x: c.x + (k - (n - 1) / 2) * size * 0.4, y: c.y - size * 0.9 };
  };
  for (let k = 0; k < n; k++) {
    const period = 5 + k * 1.3;
    const phase = time / period + k * 0.37;
    const step = Math.floor(phase);
    const p = Math.min(1, (phase - step) * 3);
    const e = p * p * (3 - 2 * p);
    const a = at(k, step - 1);
    const z = at(k, step);
    const x = a.x + (z.x - a.x) * e + Math.sin(time * 1.7 + k) * size * 0.15;
    const y = a.y + (z.y - a.y) * e + Math.sin(time * 2.3 + k * 2) * size * 0.12;
    g.globalAlpha = 0.85;
    drawHelper(g, x, y, size, time, z.x >= a.x ? 1 : -1);
    g.globalAlpha = 1;
  }
};
