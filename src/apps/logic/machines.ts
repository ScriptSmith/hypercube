/**
 * The machines on the upper wall. Each one is drawn in a nominal 1000 x 800 box (ground at
 * y = 740), scaled to fit its bench's machine area and anchored at the bottom centre. Static parts go
 * on the back layer once; moving parts are drawn every frame from a few smoothed values, so
 * nothing here keeps lists that grow. Inputs come from the bench's posts, left to right.
 *
 * - lighthouse: lamp, turn; both send a beam sweeping across the wall
 * - fountain: left, middle and right jets; all three light the water and make a rainbow
 * - windmill: sails, window light; both send sacks of flour down the chute
 * - crossing: barrier, warning lights; both bring a train through
 * - rocket: fuel, ignition; it climbs only while both are on
 */
import type { MachineKind } from "./config";
import type { Box } from "./layout";

type G = CanvasRenderingContext2D;

export const MACHINE_INPUTS: Readonly<Record<MachineKind, number>> = {
  lighthouse: 2,
  fountain: 3,
  windmill: 2,
  crossing: 2,
  rocket: 2,
};

export interface Machine {
  readonly kind: MachineKind;
  readonly inputs: number;
  /** Smoothed input levels, 0 to 1. */
  readonly levels: readonly number[];
  /** True while the machine is doing its full trick (all inputs that matter are on). */
  readonly busy: boolean;
  update(dt: number, ins: readonly boolean[], trick: boolean): void;
  drawBack(g: G, box: Box): void;
  draw(g: G, box: Box, t: number, trick: number): void;
}

const TAU = Math.PI * 2;
const GROUND = 740;

/**
 * The machine's transform inside its box. The middle 700 units must fit across, so a narrow
 * box (a kiosk's column) crops the scenery at the sides rather than shrinking the machine.
 */
const frameOf = (box: Box) => {
  const s = Math.min(box.width / 700, box.height / 800);
  return { s, ox: box.x + box.width / 2 - 500 * s, oy: box.y + box.height - 800 * s };
};

const roundRect = (g: G, x: number, y: number, w: number, h: number, r: number) => {
  g.beginPath();
  g.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
};

/** Sky, a few stars and the ground strip, across the whole box. */
const backdrop = (g: G, box: Box, ground: string, seed: number) => {
  const { s, oy } = frameOf(box);
  const groundY = oy + GROUND * s;
  g.save();
  roundRect(g, box.x, box.y, box.width, box.height, 24 * s);
  g.clip();
  const sky = g.createLinearGradient(0, box.y, 0, groundY);
  sky.addColorStop(0, "#060a1c");
  sky.addColorStop(1, "#16204a");
  g.fillStyle = sky;
  g.fillRect(box.x, box.y, box.width, box.height);
  let r = seed;
  const rand = () => {
    r = (r * 1103515245 + 12345) & 0x7fffffff;
    return r / 0x7fffffff;
  };
  g.fillStyle = "rgba(220,230,255,0.55)";
  const stars = Math.min(120, Math.round((box.width * box.height) / (60_000 * s * s)) + 20);
  for (let i = 0; i < stars; i++) {
    const x = box.x + rand() * box.width;
    const y = box.y + rand() * (groundY - box.y) * 0.8;
    g.beginPath();
    g.arc(x, y, (1.5 + rand() * 2.5) * s, 0, TAU);
    g.fill();
  }
  g.fillStyle = ground;
  g.fillRect(box.x, groundY, box.width, box.y + box.height - groundY);
  g.restore();
};

/** Moves a level towards on or off over about a fifth of a second. */
const approach = (v: number, on: boolean, dt: number, rate = 5) =>
  on ? Math.min(1, v + dt * rate) : Math.max(0, v - dt * rate);

/** Sparkles bursting from a point for the first seconds of a trick. Analytic, no particles. */
const sparkles = (g: G, x: number, y: number, s: number, age: number) => {
  if (age < 0 || age > 3) return;
  const colors = ["#ffcc33", "#6cf7f8", "#fb5c99", "#89da9b", "#6fa4fc"];
  g.save();
  g.globalAlpha = Math.max(0, 1 - age / 3);
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * TAU + i * 0.37;
    const v = 260 + ((i * 53) % 140);
    const px = x + Math.cos(a) * v * age * s;
    const py = y + Math.sin(a) * v * age * s + 90 * age * age * s;
    g.fillStyle = colors[i % colors.length]!;
    g.beginPath();
    g.arc(px, py, 9 * s, 0, TAU);
    g.fill();
  }
  g.restore();
};

// ---- Lighthouse --------------------------------------------------------------------------------

const lighthouse = (): Machine => {
  const levels = [0, 0];
  let phase = 0;
  let spin = 0;
  let beam = 0;
  return {
    kind: "lighthouse",
    inputs: 2,
    levels,
    get busy() {
      return beam > 0.5;
    },
    update(dt, ins, trick) {
      levels[0] = approach(levels[0]!, trick || !!ins[0], dt);
      levels[1] = approach(levels[1]!, trick || !!ins[1], dt, 1.5);
      spin += dt * levels[1]! * 0.22 * TAU;
      phase += dt;
      beam = approach(beam, levels[0]! > 0.5 && levels[1]! > 0.5, dt, 1.2);
    },
    drawBack(g, box) {
      backdrop(g, box, "#1d2a3c", 7);
      const { s, ox, oy } = frameOf(box);
      g.save();
      g.translate(ox, oy);
      g.scale(s, s);
      // Sea to the right, rocks under the tower.
      g.fillStyle = "#0d2a4a";
      g.fillRect(560, 690, 440, 50);
      g.fillStyle = "#2b3442";
      g.beginPath();
      g.moveTo(300, GROUND);
      g.quadraticCurveTo(340, 660, 420, 670);
      g.quadraticCurveTo(500, 640, 600, 668);
      g.quadraticCurveTo(680, 680, 720, GROUND);
      g.fill();
      // Tower: tapered, with stripes.
      g.save();
      g.beginPath();
      g.moveTo(430, 300);
      g.lineTo(570, 300);
      g.lineTo(600, 680);
      g.lineTo(400, 680);
      g.closePath();
      g.clip();
      g.fillStyle = "#e9edf5";
      g.fillRect(380, 290, 240, 400);
      g.fillStyle = "#c8434f";
      for (let y = 360; y < 680; y += 120) g.fillRect(380, y, 240, 60);
      g.restore();
      g.strokeStyle = "#0b1020";
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(430, 300);
      g.lineTo(570, 300);
      g.lineTo(600, 680);
      g.lineTo(400, 680);
      g.closePath();
      g.stroke();
      // Door and windows.
      g.fillStyle = "#3a2a20";
      roundRect(g, 478, 600, 44, 80, 20);
      g.fill();
      // Gallery, lantern room and dome.
      g.fillStyle = "#39414f";
      g.fillRect(410, 286, 180, 22);
      g.fillStyle = "#1a2030";
      g.fillRect(440, 190, 120, 96);
      g.fillStyle = "#c8434f";
      g.beginPath();
      g.moveTo(430, 192);
      g.quadraticCurveTo(500, 110, 570, 192);
      g.closePath();
      g.fill();
      g.fillStyle = "#e9edf5";
      g.beginPath();
      g.arc(500, 128, 10, 0, TAU);
      g.fill();
      g.restore();
    },
    draw(g, box, t, trick) {
      const { s, ox, oy } = frameOf(box);
      g.save();
      g.translate(ox, oy);
      g.scale(s, s);
      // Waves.
      g.strokeStyle = "rgba(120,180,255,0.35)";
      g.lineWidth = 5;
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        for (let x = 560; x <= 1000; x += 20) {
          const y = 700 + k * 14 + Math.sin(x * 0.03 + t * 1.6 + k) * 5;
          if (x === 560) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      }
      const lamp = levels[0]!;
      // Beam: a wedge from the lantern, pointing left or right as the lamp turns.
      if (beam > 0.01) {
        const d = Math.cos(spin);
        const len = 1800 * Math.abs(d);
        const side = d >= 0 ? 1 : -1;
        const grad = g.createLinearGradient(500, 238, 500 + side * len, 238);
        grad.addColorStop(0, `rgba(255,236,150,${0.55 * beam * Math.abs(d)})`);
        grad.addColorStop(1, "rgba(255,236,150,0)");
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(500, 230);
        g.lineTo(500 + side * len, 238 - 140 * Math.abs(d));
        g.lineTo(500 + side * len, 238 + 140 * Math.abs(d));
        g.closePath();
        g.fill();
      }
      // Lantern: glow when the lamp is on; shutters slide past when it turns.
      g.fillStyle = `rgba(255,220,120,${0.15 + 0.85 * lamp})`;
      g.fillRect(446, 196, 108, 84);
      if (lamp > 0.01) {
        const glow = g.createRadialGradient(500, 238, 10, 500, 238, 200);
        glow.addColorStop(0, `rgba(255,230,140,${0.6 * lamp})`);
        glow.addColorStop(1, "rgba(255,230,140,0)");
        g.fillStyle = glow;
        g.beginPath();
        g.arc(500, 238, 200, 0, TAU);
        g.fill();
      }
      g.save();
      g.beginPath();
      g.rect(446, 196, 108, 84);
      g.clip();
      g.fillStyle = "rgba(20,26,40,0.85)";
      for (let k = 0; k < 4; k++) {
        const u = (((spin / TAU) * 4 + k / 4) % 1) * 1.0;
        const x = 446 + u * 140 - 16;
        g.fillRect(x, 196, 14, 84);
      }
      g.restore();
      g.restore();
      sparkles(g, ox + 500 * s, oy + 160 * s, s, trick);
    },
  };
};

// ---- Fountain ----------------------------------------------------------------------------------

const fountain = (): Machine => {
  const levels = [0, 0, 0];
  let hue = 0;
  let lights = 0;
  return {
    kind: "fountain",
    inputs: 3,
    levels,
    get busy() {
      return lights > 0.5;
    },
    update(dt, ins, trick) {
      for (let i = 0; i < 3; i++) levels[i] = approach(levels[i]!, trick || !!ins[i], dt, 1.6);
      lights = approach(
        lights,
        levels.every((v) => v > 0.6),
        dt,
        1.5,
      );
      hue = (hue + dt * 24) % 360;
    },
    drawBack(g, box) {
      backdrop(g, box, "#1e3324", 11);
      const { s, ox, oy } = frameOf(box);
      g.save();
      g.translate(ox, oy);
      g.scale(s, s);
      // Hedges, pedestal and basin.
      g.fillStyle = "#24452e";
      for (const x of [60, 840]) {
        roundRect(g, x, 640, 120, 100, 40);
        g.fill();
      }
      g.fillStyle = "#5c6474";
      g.beginPath();
      g.ellipse(500, 700, 330, 46, 0, 0, TAU);
      g.fill();
      g.fillStyle = "#1a3a5a";
      g.beginPath();
      g.ellipse(500, 690, 300, 32, 0, 0, TAU);
      g.fill();
      g.fillStyle = "#717a8c";
      g.fillRect(470, 600, 60, 90);
      g.beginPath();
      g.ellipse(500, 600, 110, 22, 0, 0, TAU);
      g.fill();
      for (const x of [290, 710]) {
        g.fillRect(x - 18, 640, 36, 50);
      }
      g.restore();
    },
    draw(g, box, t, trick) {
      const { s, ox, oy } = frameOf(box);
      g.save();
      g.translate(ox, oy);
      g.scale(s, s);
      const nozzles = [
        { x: 290, y: 640, vx: 90, vy: 520, h: 0 },
        { x: 500, y: 590, vx: 0, vy: 700, h: 120 },
        { x: 710, y: 640, vx: -90, vy: 520, h: 240 },
      ];
      const grav = 900;
      nozzles.forEach((n, i) => {
        const lv = levels[i]!;
        if (lv < 0.02) return;
        const vy = n.vy * (0.55 + 0.45 * lv);
        const flight = (2 * vy) / grav;
        const color =
          lights > 0.05
            ? `hsla(${(hue + n.h) % 360},90%,${70 - 10 * lights}%,${0.85 * lv})`
            : `rgba(170,215,255,${0.8 * lv})`;
        g.fillStyle = color;
        for (let k = 0; k < 34; k++) {
          const u = (t * 0.9 + k / 34) % 1;
          const tt = u * flight;
          const sideways = n.vx === 0 ? Math.sin(k * 2.1) * 26 * u : n.vx;
          const x = n.x + sideways * tt;
          const y = n.y - vy * tt + 0.5 * grav * tt * tt;
          if (y > 700) continue;
          g.beginPath();
          g.arc(x, y, 9 - 3 * u, 0, TAU);
          g.fill();
        }
      });
      // Ripples in the basin.
      g.strokeStyle = `rgba(170,215,255,${0.2 + 0.2 * Math.max(...levels)})`;
      g.lineWidth = 4;
      for (let k = 0; k < 3; k++) {
        const r = ((t * 40 + k * 70) % 210) + 40;
        g.beginPath();
        g.ellipse(500, 690, r, r * 0.1, 0, 0, TAU);
        g.stroke();
      }
      if (lights > 0.02) {
        g.globalAlpha = 0.35 * lights;
        const bands = ["#ff5a4f", "#f29b1d", "#f0e82a", "#89da9b", "#6fa4fc", "#ad83d1"];
        bands.forEach((c, i) => {
          g.strokeStyle = c;
          g.lineWidth = 14;
          g.beginPath();
          g.arc(500, 700, 420 - i * 14, Math.PI * 1.08, Math.PI * 1.92);
          g.stroke();
        });
        g.globalAlpha = 1;
      }
      g.restore();
      sparkles(g, ox + 500 * s, oy + 300 * s, s, trick);
    },
  };
};

// ---- Windmill ----------------------------------------------------------------------------------

const windmill = (): Machine => {
  const levels = [0, 0];
  let angle = 0;
  let speed = 0;
  let flour = 0;
  return {
    kind: "windmill",
    inputs: 2,
    levels,
    get busy() {
      return flour > 0.5;
    },
    update(dt, ins, trick) {
      levels[0] = approach(levels[0]!, trick || !!ins[0], dt, 1.2);
      levels[1] = approach(levels[1]!, trick || !!ins[1], dt);
      speed += ((levels[0]! > 0.5 ? 1 : 0) * 0.35 * TAU - speed) * Math.min(1, dt * 0.8);
      angle = (angle + speed * dt) % TAU;
      flour = approach(flour, levels[0]! > 0.6 && levels[1]! > 0.6, dt, 1);
    },
    drawBack(g, box) {
      backdrop(g, box, "#2a3a22", 5);
      const { s, ox, oy } = frameOf(box);
      g.save();
      g.translate(ox, oy);
      g.scale(s, s);
      g.fillStyle = "#33502a";
      g.beginPath();
      g.moveTo(0, GROUND);
      g.quadraticCurveTo(500, 600, 1000, GROUND);
      g.fill();
      // Tower and cap.
      g.fillStyle = "#c9b48a";
      g.beginPath();
      g.moveTo(430, 330);
      g.lineTo(570, 330);
      g.lineTo(610, 690);
      g.lineTo(390, 690);
      g.closePath();
      g.fill();
      g.fillStyle = "#6b4a30";
      g.beginPath();
      g.moveTo(410, 336);
      g.quadraticCurveTo(500, 230, 590, 336);
      g.closePath();
      g.fill();
      g.fillStyle = "#4a3222";
      roundRect(g, 470, 600, 60, 90, 28);
      g.fill();
      g.fillStyle = "#2a2220";
      roundRect(g, 478, 440, 44, 56, 18);
      g.fill();
      // Chute and the cart at its foot.
      g.strokeStyle = "#7a5a3a";
      g.lineWidth = 16;
      g.beginPath();
      g.moveTo(590, 560);
      g.lineTo(740, 650);
      g.stroke();
      g.fillStyle = "#5a4030";
      roundRect(g, 720, 640, 150, 60, 10);
      g.fill();
      g.fillStyle = "#222";
      for (const x of [750, 840]) {
        g.beginPath();
        g.arc(x, 708, 18, 0, TAU);
        g.fill();
      }
      g.restore();
    },
    draw(g, box, t, trick) {
      const { s, ox, oy } = frameOf(box);
      g.save();
      g.translate(ox, oy);
      g.scale(s, s);
      // Window light.
      const lamp = levels[1]!;
      g.fillStyle = `rgba(255,214,120,${0.1 + 0.9 * lamp})`;
      roundRect(g, 484, 446, 32, 44, 14);
      g.fill();
      if (lamp > 0.02) {
        const glow = g.createRadialGradient(500, 468, 6, 500, 468, 120);
        glow.addColorStop(0, `rgba(255,214,120,${0.45 * lamp})`);
        glow.addColorStop(1, "rgba(255,214,120,0)");
        g.fillStyle = glow;
        g.beginPath();
        g.arc(500, 468, 120, 0, TAU);
        g.fill();
      }
      // Sacks sliding down the chute.
      if (flour > 0.02) {
        g.fillStyle = `rgba(236,224,196,${flour})`;
        for (let k = 0; k < 3; k++) {
          const u = (t * 0.4 + k / 3) % 1;
          const x = 590 + 150 * u;
          const y = 540 + 90 * u;
          roundRect(g, x - 20, y - 22, 40, 36, 12);
          g.fill();
        }
      }
      // Sails.
      g.save();
      g.translate(500, 340);
      g.rotate(angle);
      for (let k = 0; k < 4; k++) {
        g.rotate(TAU / 4);
        g.fillStyle = "#e8e0cc";
        g.fillRect(-6, -300, 12, 300);
        g.fillStyle = "rgba(232,224,204,0.75)";
        g.fillRect(8, -290, 56, 230);
        g.strokeStyle = "#8a7a5a";
        g.lineWidth = 3;
        g.strokeRect(8, -290, 56, 230);
      }
      g.fillStyle = "#4a3222";
      g.beginPath();
      g.arc(0, 0, 24, 0, TAU);
      g.fill();
      g.restore();
      g.restore();
      sparkles(g, ox + 500 * s, oy + 340 * s, s, trick);
    },
  };
};

// ---- Level crossing ----------------------------------------------------------------------------

const crossing = (): Machine => {
  const levels = [0, 0];
  let arm = 0;
  let blink = 0;
  /** Train position along the track, 0 to 1 across, or -1 when none. */
  let train = -1;
  let wait = 0;
  return {
    kind: "crossing",
    inputs: 2,
    levels,
    get busy() {
      return train >= 0;
    },
    update(dt, ins, trick) {
      levels[0] = approach(levels[0]!, trick || !!ins[0], dt, 0.7);
      levels[1] = approach(levels[1]!, trick || !!ins[1], dt);
      arm = levels[0]!;
      blink += dt;
      const safe = arm > 0.95 && levels[1]! > 0.5;
      if (train >= 0) {
        train += dt * 0.28;
        if (train > 1) {
          train = -1;
          wait = 1.5;
        }
      } else if (safe) {
        wait -= dt;
        if (wait <= 0) train = 0;
      } else wait = 0.6;
    },
    drawBack(g, box) {
      backdrop(g, box, "#26262c", 3);
      const { s, ox, oy } = frameOf(box);
      g.save();
      g.translate(ox, oy);
      g.scale(s, s);
      // Track across the scene.
      g.fillStyle = "#3a3330";
      g.fillRect(-2000, 690, 5000, 20);
      g.fillStyle = "#8a8f99";
      g.fillRect(-2000, 676, 5000, 8);
      g.fillStyle = "#4a4038";
      for (let x = -2000; x < 3000; x += 60) g.fillRect(x, 684, 30, 26);
      // Signal post with two lamps and the barrier's pivot.
      g.fillStyle = "#c9ced8";
      g.fillRect(250, 420, 20, 300);
      g.fillStyle = "#1a1d26";
      roundRect(g, 190, 400, 140, 70, 30);
      g.fill();
      g.fillStyle = "#2e3240";
      g.fillRect(280, 560, 70, 70);
      g.restore();
    },
    draw(g, box, t, trick) {
      const { s, ox, oy } = frameOf(box);
      g.save();
      g.translate(ox, oy);
      g.scale(s, s);
      // Lamps take turns once a second.
      const lit = levels[1]!;
      const left = Math.sin(blink * Math.PI) >= 0;
      for (const [i, x] of [225, 295].entries()) {
        const on = lit * ((i === 0) === left ? 1 : 0.12);
        g.fillStyle = `rgba(255,70,60,${0.18 + 0.82 * on})`;
        g.beginPath();
        g.arc(x, 435, 24, 0, TAU);
        g.fill();
        if (on > 0.3) {
          const glow = g.createRadialGradient(x, 435, 4, x, 435, 90);
          glow.addColorStop(0, `rgba(255,90,70,${0.5 * on})`);
          glow.addColorStop(1, "rgba(255,90,70,0)");
          g.fillStyle = glow;
          g.beginPath();
          g.arc(x, 435, 90, 0, TAU);
          g.fill();
        }
      }
      // Barrier: up is vertical, down is level across the track.
      g.save();
      g.translate(315, 595);
      g.rotate(-Math.PI / 2 + (Math.PI / 2) * arm);
      for (let k = 0; k < 8; k++) {
        g.fillStyle = k % 2 === 0 ? "#f2f5fa" : "#c8434f";
        g.fillRect(k * 55, -12, 55, 24);
      }
      g.restore();
      g.fillStyle = "#3a3e4c";
      g.beginPath();
      g.arc(315, 595, 20, 0, TAU);
      g.fill();
      // The train: a locomotive and two carriages, right to left.
      if (train >= 0) {
        const x = 1250 - train * 2100;
        const cars = [
          { dx: 0, w: 230, c: "#3c6fd6" },
          { dx: 245, w: 230, c: "#e0a030" },
          { dx: 490, w: 230, c: "#3c9c6a" },
        ];
        for (const car of cars) {
          g.fillStyle = car.c;
          roundRect(g, x + car.dx, 560, car.w, 110, 22);
          g.fill();
          g.fillStyle = "rgba(220,240,255,0.85)";
          for (let k = 0; k < 3; k++) {
            roundRect(g, x + car.dx + 24 + k * 68, 580, 46, 40, 8);
            g.fill();
          }
          g.fillStyle = "#15171d";
          for (const wx of [40, car.w - 40]) {
            g.beginPath();
            g.arc(x + car.dx + wx, 674, 18, 0, TAU);
            g.fill();
          }
        }
        // Steam puffs over the locomotive.
        g.fillStyle = "rgba(220,225,235,0.45)";
        for (let k = 0; k < 4; k++) {
          const u = (t * 1.2 + k / 4) % 1;
          g.beginPath();
          g.arc(x + 40 + u * 120, 540 - u * 110, 16 + u * 26, 0, TAU);
          g.fill();
        }
      }
      g.restore();
      sparkles(g, ox + 500 * s, oy + 420 * s, s, trick);
    },
  };
};

// ---- Rocket -------------------------------------------------------------------------------------

const rocket = (): Machine => {
  const levels = [0, 0];
  let h = 0;
  let v = 0;
  /** Seconds the rocket has been out of sight above the box. */
  let away = 0;
  return {
    kind: "rocket",
    inputs: 2,
    levels,
    get busy() {
      return h > 2;
    },
    update(dt, ins, trick) {
      levels[0] = approach(levels[0]!, trick || !!ins[0], dt);
      levels[1] = approach(levels[1]!, trick || !!ins[1], dt);
      const go = levels[0]! > 0.6 && levels[1]! > 0.6;
      if (go && away < 2.5) {
        v = Math.min(900, v + 260 * dt);
        h += v * dt;
        if (h > 1200) {
          h = 1200;
          away += dt;
        }
      } else if (h > 0) {
        // Back down, slowing to a soft landing on the pad.
        away = go ? away : 0;
        const target = -Math.max(40, Math.min(420, h * 0.9));
        v += (target - v) * Math.min(1, dt * 2);
        h = Math.max(0, h + v * dt);
        if (h === 0) {
          v = 0;
          away = 0;
        }
      } else {
        v = 0;
        away = 0;
      }
    },
    drawBack(g, box) {
      backdrop(g, box, "#2c2a30", 13);
      const { s, ox, oy } = frameOf(box);
      g.save();
      g.translate(ox, oy);
      g.scale(s, s);
      g.fillStyle = "#4a4650";
      g.fillRect(330, 700, 340, 40);
      // Lattice tower beside the pad.
      g.strokeStyle = "#a8484c";
      g.lineWidth = 8;
      g.strokeRect(640, 260, 70, 440);
      g.lineWidth = 5;
      g.beginPath();
      for (let y = 260; y < 700; y += 70) {
        g.moveTo(640, y);
        g.lineTo(710, y + 70);
        g.moveTo(710, y);
        g.lineTo(640, y + 70);
      }
      g.stroke();
      g.restore();
    },
    draw(g, box, t, trick) {
      const { s, ox, oy } = frameOf(box);
      g.save();
      g.translate(ox, oy);
      g.scale(s, s);
      const fuel = levels[0]!;
      const fire = levels[1]!;
      // Vapour from the pad while fuelled.
      if (fuel > 0.02 && h < 60) {
        g.fillStyle = `rgba(225,230,240,${0.35 * fuel})`;
        for (let k = 0; k < 6; k++) {
          const u = (t * 0.5 + k / 6) % 1;
          const side = k % 2 === 0 ? -1 : 1;
          g.beginPath();
          g.arc(500 + side * (60 + u * 160), 690 - u * 40, 20 + u * 40, 0, TAU);
          g.fill();
        }
      }
      const y = 690 - h;
      // Flame.
      if (fire > 0.02 || v !== 0) {
        const len = 60 + 80 * fire + (h > 0 ? 80 : 0) + Math.sin(t * 18) * 6;
        const flame = g.createLinearGradient(0, y, 0, y + len);
        flame.addColorStop(0, `rgba(255,240,180,${0.95 * Math.max(fire, 0.4)})`);
        flame.addColorStop(1, "rgba(255,120,40,0)");
        g.fillStyle = flame;
        g.beginPath();
        g.moveTo(468, y);
        g.quadraticCurveTo(500, y + len * 1.2, 532, y);
        g.closePath();
        g.fill();
      }
      // Body, nose cone, fins and a porthole.
      g.fillStyle = "#e9edf5";
      roundRect(g, 455, y - 300, 90, 300, 30);
      g.fill();
      g.fillStyle = "#c8434f";
      g.beginPath();
      g.moveTo(455, y - 270);
      g.quadraticCurveTo(500, y - 400, 545, y - 270);
      g.closePath();
      g.fill();
      g.beginPath();
      g.moveTo(455, y - 90);
      g.lineTo(405, y);
      g.lineTo(455, y);
      g.closePath();
      g.fill();
      g.beginPath();
      g.moveTo(545, y - 90);
      g.lineTo(595, y);
      g.lineTo(545, y);
      g.closePath();
      g.fill();
      g.fillStyle = "#6fa4fc";
      g.beginPath();
      g.arc(500, y - 200, 22, 0, TAU);
      g.fill();
      g.restore();
      sparkles(g, ox + 500 * s, oy + 300 * s, s, trick);
    },
  };
};

export const createMachine = (kind: MachineKind): Machine => {
  switch (kind) {
    case "lighthouse":
      return lighthouse();
    case "fountain":
      return fountain();
    case "windmill":
      return windmill();
    case "crossing":
      return crossing();
    case "rocket":
      return rocket();
  }
};
