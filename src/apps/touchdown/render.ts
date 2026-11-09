/**
 * Canvas2D drawing. Two stacked canvases: `back` holds the sky, the stars and every lane's
 * terrain with its landing pads, and is redrawn only when terrain or size changes; `front` is
 * cleared and drawn every frame (crafts, ghosts, flames, dust, wind and celebrations). All
 * drawing is in venue px through one transform.
 */
import type { FrameInfo } from "../../core/types";
import { createRng } from "../../core/rng";
import { withAlpha } from "../../core/ui";
import { drawCraft, drawFlames, drawGhost, type Flames, roundRect, star, TAU } from "./art";
import { ENGINE, FOOT, MAIN, toWorld } from "./craft";
import type { Crew, CrewEvent } from "./crew";
import { FLAG, type Pose, poseAt } from "./ghost";
import type { Layout } from "./layout";
import { createParticles } from "./particles";
import { heightAt } from "./terrain";

export interface Renderer {
  setup(frame: FrameInfo, layout: Layout): void;
  /** Redraw the sky and terrain. */
  terrain(crews: readonly Crew[]): void;
  event(e: CrewEvent, crews: readonly Crew[]): void;
  /** `alpha` interpolates between the last two steps; `time` is seconds; `dt` real seconds. */
  draw(crews: readonly Crew[], alpha: number, time: number, dt: number): void;
  clear(): void;
  readonly particles: number;
  dispose(): void;
}

const MOTES = 26;

interface Mote {
  x: number;
  y: number;
  phase: number;
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

export const createRenderer = (
  root: HTMLElement,
  colors: readonly string[],
  seed: string,
): Renderer => {
  const make = (z: number) => {
    const c = document.createElement("canvas");
    c.style.cssText = `position:absolute;inset:0;width:100%;height:100%;z-index:${z};`;
    root.append(c);
    return c;
  };
  const backCanvas = make(0);
  const frontCanvas = make(1);
  const back = backCanvas.getContext("2d");
  const g = frontCanvas.getContext("2d");
  let layout: Layout | null = null;
  let k = 1;
  let particles = createParticles(240);
  let motes: Mote[][] = [];
  const pose: Pose = { x: 0, y: 0, a: 0, flags: 0 };
  const flames: Flames = {
    left: false,
    right: false,
    main: false,
    turnLeft: false,
    turnRight: false,
    flicker: 1,
    faintLeft: false,
    faintRight: false,
  };
  const emitAt = new Float32Array(32);
  const colorOf = (i: number) => colors[i % colors.length] ?? "#6fa4fc";

  const seedMotes = (l: Layout) => {
    const rng = createRng(`${seed}:motes`);
    motes = l.crews.map((c) =>
      Array.from({ length: MOTES }, () => ({
        x: rng.range(c.lane.x0, c.lane.x1),
        y: rng.range(l.spawnY + l.drop * 0.3, l.ground.bottom),
        phase: rng.range(0, TAU),
      })),
    );
  };

  // ---- Static layer -----------------------------------------------------------------------

  const drawBack = (crews: readonly Crew[]) => {
    const l = layout;
    if (!back || !l) return;
    const W = l.width;
    const H = l.height;
    const S = l.craft;
    back.setTransform(1, 0, 0, 1, 0, 0);
    back.clearRect(0, 0, backCanvas.width, backCanvas.height);
    back.setTransform(k, 0, 0, k, 0, 0);
    const sky = back.createLinearGradient(0, 0, 0, l.ground.bottom);
    sky.addColorStop(0, "#03050d");
    sky.addColorStop(0.55, "#0b1030");
    sky.addColorStop(1, "#2a1d55");
    back.fillStyle = sky;
    back.fillRect(0, 0, W, H);

    const rng = createRng(`${seed}:sky`);
    // A ringed planet low in the sky, faint so it never competes with the craft.
    const pr = Math.min(W, H) * 0.075;
    const px = W * rng.range(0.62, 0.86);
    const py = l.spawnY + l.drop * rng.range(0.25, 0.42);
    const pg = back.createRadialGradient(px - pr * 0.4, py - pr * 0.4, pr * 0.1, px, py, pr);
    pg.addColorStop(0, "#5a4c9c");
    pg.addColorStop(1, "#231b4a");
    back.fillStyle = pg;
    back.beginPath();
    back.arc(px, py, pr, 0, TAU);
    back.fill();
    back.strokeStyle = "rgba(170,150,230,0.35)";
    back.lineWidth = pr * 0.08;
    back.beginPath();
    back.ellipse(px, py, pr * 1.7, pr * 0.42, -0.25, 0, TAU);
    back.stroke();

    const stars = Math.min(2400, Math.round((W * l.ground.top) / 7000));
    for (let i = 0; i < stars; i++) {
      const x = rng.range(0, W);
      const y = rng.range(0, l.ground.top);
      const big = rng.next() < 0.06;
      const r = big ? rng.range(2.4, 3.6) : rng.range(0.9, 2);
      back.globalAlpha = rng.range(0.35, big ? 1 : 0.8);
      back.fillStyle = rng.next() < 0.2 ? "#ffe9c2" : "#dfe8ff";
      back.beginPath();
      back.arc(x, y, r * (H / 1920 + 0.5) * 0.8, 0, TAU);
      back.fill();
    }
    back.globalAlpha = 1;

    // Ground outside every lane (kiosk consoles) is a flat plateau at the top of the band.
    const top = l.ground.top;
    const ground = back.createLinearGradient(0, top, 0, H);
    ground.addColorStop(0, "#5d4b93");
    ground.addColorStop(0.35, "#3a2d68");
    ground.addColorStop(1, "#150f2c");
    back.fillStyle = ground;
    const lanes = [...crews].map((c) => c.spec.lane).sort((a, b) => a.x0 - b.x0);
    let x = 0;
    for (const lane of lanes) {
      if (lane.x0 > x) back.fillRect(x, top, lane.x0 - x, H - top);
      x = Math.max(x, lane.x1);
    }
    if (x < W) back.fillRect(x, top, W - x, H - top);

    for (const crew of crews) {
      const t = crew.terrain;
      const n = t.xs.length;
      if (n < 2) continue;
      const lane = crew.spec.lane;
      back.fillStyle = ground;
      back.beginPath();
      back.moveTo(lane.x0, H);
      for (let i = 0; i < n; i++) back.lineTo(t.xs[i]!, t.ys[i]!);
      back.lineTo(lane.x1, H);
      back.closePath();
      back.fill();
      // Faint strata under the surface.
      back.save();
      back.clip();
      back.strokeStyle = "rgba(20,12,40,0.35)";
      for (const [off, w] of [
        [0.38, 0.05],
        [0.85, 0.04],
        [1.5, 0.035],
      ] as const) {
        back.lineWidth = w * S;
        back.beginPath();
        for (let i = 0; i < n; i++) {
          const y = t.ys[i]! + off * S;
          if (i === 0) back.moveTo(t.xs[i]!, y);
          else back.lineTo(t.xs[i]!, y);
        }
        back.stroke();
      }
      back.restore();
      back.strokeStyle = "#a998ea";
      back.lineWidth = 0.035 * S;
      back.lineJoin = "round";
      back.beginPath();
      for (let i = 0; i < n; i++) {
        if (i === 0) back.moveTo(t.xs[i]!, t.ys[i]!);
        else back.lineTo(t.xs[i]!, t.ys[i]!);
      }
      back.stroke();

      // Landing pads: a platform on a block, with its stars on the front.
      for (const p of t.pads) {
        const w = p.x1 - p.x0;
        back.fillStyle = "#2b2252";
        back.strokeStyle = "#7d6cc4";
        back.lineWidth = 0.02 * S;
        roundRect(back, p.x0 + 0.04 * S, p.y, w - 0.08 * S, 0.4 * S, 0.04 * S);
        back.fill();
        back.stroke();
        back.fillStyle = "#e9eef7";
        roundRect(back, p.x0, p.y - 0.02 * S, w, 0.08 * S, 0.03 * S);
        back.fill();
        back.fillStyle = withAlpha(colorOf(crew.spec.index), 0.95);
        back.fillRect(p.x0 + 0.02 * S, p.y + 0.035 * S, w - 0.04 * S, 0.025 * S);
        const r = 0.1 * S;
        const gap = 0.26 * S;
        for (let i = 0; i < p.stars; i++) {
          const sx = (p.x0 + p.x1) / 2 + (i - (p.stars - 1) / 2) * gap;
          back.fillStyle = "#ffcc33";
          back.strokeStyle = "#3a2a00";
          back.lineWidth = 0.015 * S;
          star(back, sx, p.y + 0.24 * S, r);
          back.fill();
          back.stroke();
        }
      }
    }
  };

  // ---- Dynamic layer ----------------------------------------------------------------------

  const setFlames = (flags: number, faintL: boolean, faintR: boolean, flicker: number) => {
    flames.left = (flags & FLAG.left) !== 0;
    flames.right = (flags & FLAG.right) !== 0;
    flames.main = (flags & FLAG.main) !== 0;
    flames.turnLeft = (flags & FLAG.turnLeft) !== 0;
    flames.turnRight = (flags & FLAG.turnRight) !== 0;
    flames.faintLeft = faintL;
    flames.faintRight = faintR;
    flames.flicker = flicker;
  };

  const flagsOf = (c: Crew): number => {
    const th = c.thrust;
    if (c.phase !== "flying" || th.power <= 0) return 0;
    return (
      (th.left ? FLAG.left : 0) |
      (th.right ? FLAG.right : 0) |
      (th.main ? FLAG.main : 0) |
      (th.turnLeft ? FLAG.turnLeft : 0) |
      (th.turnRight ? FLAG.turnRight : 0)
    );
  };

  /** Exhaust smoke at the nozzles and dust where the flames reach the ground. */
  const exhaust = (c: Crew, flags: number, dt: number) => {
    const i = c.spec.index;
    const S = c.physics.S;
    emitAt[i] = (emitAt[i] ?? 0) + dt;
    const sputter = c.sputtering;
    if (!flags && !sputter) return;
    const every = sputter ? 0.12 : 0.05;
    if (emitAt[i]! < every) return;
    emitAt[i] = 0;
    const craft = c.craft;
    const nozzles: [number, number][] = [];
    const duo = c.physics.variant === "duo";
    if (sputter) {
      if (duo) nozzles.push([-ENGINE.x, ENGINE.y + 0.1], [ENGINE.x, ENGINE.y + 0.1]);
      else nozzles.push([MAIN.x, MAIN.y + 0.1]);
    } else {
      if (flags & FLAG.left) nozzles.push([-ENGINE.x, ENGINE.y + 0.35]);
      if (flags & FLAG.right) nozzles.push([ENGINE.x, ENGINE.y + 0.35]);
      if (flags & FLAG.main) nozzles.push([MAIN.x, MAIN.y + 0.45]);
    }
    const down = { x: -Math.sin(craft.a), y: Math.cos(craft.a) };
    for (const [lx, ly] of nozzles) {
      const p = toWorld(craft, S, lx, ly);
      const v = sputter ? 0.25 * S : 0.9 * S;
      particles.spawn(
        "smoke",
        p.x,
        p.y,
        craft.vx + down.x * v + (Math.random() - 0.5) * 0.3 * S,
        craft.vy + down.y * v,
        sputter ? 0.7 : 0.55,
        (sputter ? 0.07 : 0.05) * S,
      );
      if (sputter) continue;
      const ground = heightAt(c.terrain, p.x);
      const gap = ground - p.y;
      if (gap > 0 && gap < 1.4 * S) {
        const strength = 1 - gap / (1.4 * S);
        for (const s of [-1, 1]) {
          particles.spawn(
            "dust",
            p.x,
            ground - 0.03 * S,
            s * (0.6 + strength) * S,
            -0.1 * S,
            0.8,
            0.07 * S * (0.6 + strength),
          );
        }
      }
    }
  };

  const drawMotes = (crews: readonly Crew[], dt: number, time: number) => {
    if (!g || !layout) return;
    const l = layout;
    const S = l.craft;
    g.strokeStyle = "#d9cdf5";
    g.lineCap = "round";
    g.lineWidth = 0.045 * S;
    for (const c of crews) {
      const list = motes[c.spec.index];
      if (!list) continue;
      const w = c.wind;
      if (Math.abs(w) < 0.5) continue;
      const { x0, x1 } = c.spec.lane;
      for (const m of list) {
        m.x += (w * 1.6 + Math.sin(time * 0.7 + m.phase) * 4) * dt;
        if (m.x < x0) m.x += x1 - x0;
        if (m.x > x1) m.x -= x1 - x0;
        const y = m.y + Math.sin(time * 1.3 + m.phase) * 0.12 * S;
        g.globalAlpha = 0.34 + 0.16 * Math.sin(time + m.phase);
        g.beginPath();
        g.moveTo(m.x, y);
        g.lineTo(m.x - w * 1.6, y);
        g.stroke();
      }
    }
    g.globalAlpha = 1;
  };

  const drawPadLights = (c: Crew, time: number) => {
    if (!g) return;
    const S = c.physics.S;
    const landedOn = c.phase === "landed" ? c.outcome?.pad : null;
    for (const p of c.terrain.pads) {
      const on =
        landedOn === p ? 0.5 + 0.5 * Math.sin(time * 9) : 0.5 + 0.5 * Math.sin(time * 4 + p.x0);
      for (const x of [p.x0 + 0.05 * S, p.x1 - 0.05 * S]) {
        g.globalAlpha = 0.35 + 0.65 * on;
        g.fillStyle = landedOn === p ? "#9dffb0" : "#ffcc33";
        g.beginPath();
        g.arc(x, p.y - 0.06 * S, 0.035 * S, 0, TAU);
        g.fill();
      }
    }
    g.globalAlpha = 1;
  };

  const drawCelebration = (c: Crew, x: number, y: number) => {
    if (!g) return;
    const o = c.outcome;
    if (!o) return;
    const S = c.physics.S;
    const t = c.phaseT;
    if (o.kind === "land") {
      for (let i = 0; i < o.stars; i++) {
        const local = t - 0.2 - i * 0.18;
        if (local <= 0) continue;
        const pop = local < 0.35 ? (local / 0.35) * 1.2 : 1.2 - Math.min(0.2, (local - 0.35) * 0.8);
        const fade = t > 3.2 ? Math.max(0, 1 - (t - 3.2) / 0.6) : 1;
        const sx = x + (i - (o.stars - 1) / 2) * 0.5 * S;
        const sy = y - 0.95 * S - Math.sin(Math.min(1, local / 0.5) * Math.PI) * 0.12 * S;
        g.globalAlpha = fade;
        g.fillStyle = "#ffcc33";
        g.strokeStyle = "#ffffff";
        g.lineWidth = 0.03 * S;
        star(g, sx, sy, 0.2 * S * pop);
        g.fill();
        g.stroke();
      }
      g.globalAlpha = 1;
      return;
    }
    // A bump: a few small stars circle over the tipped craft for a moment.
    if (t < 0.9 || t > 3.9) return;
    const fade = Math.min(1, (t - 0.9) / 0.3) * Math.min(1, (3.9 - t) / 0.4);
    for (let i = 0; i < 3; i++) {
      const a = t * 3.2 + (i * TAU) / 3;
      g.globalAlpha = fade * (0.6 + 0.4 * Math.sin(a));
      g.fillStyle = "#ffe07a";
      star(g, x + Math.cos(a) * 0.32 * S, y - 0.45 * S + Math.sin(a) * 0.1 * S, 0.07 * S);
      g.fill();
    }
    g.globalAlpha = 1;
  };

  const drawCrew = (c: Crew, alpha: number, time: number, dt: number) => {
    if (!g) return;
    const S = c.physics.S;
    const color = colorOf(c.spec.index);
    const duo = c.physics.variant === "duo";
    drawPadLights(c, time);
    // Ghost first, behind the craft.
    if (c.ghost && c.ghostAlpha > 0 && poseAt(c.ghost, c.runT, pose)) {
      g.save();
      g.translate(pose.x, pose.y);
      g.rotate(pose.a);
      g.scale(S, S);
      g.globalAlpha = 0.5 * c.ghostAlpha;
      setFlames(pose.flags, false, false, 0.5);
      drawFlames(g, flames, duo, true, time);
      g.globalAlpha = 0.55 * c.ghostAlpha;
      drawGhost(g, color);
      g.restore();
    }
    const p = c.prev;
    const n = c.craft;
    const x = lerp(p.x, n.x, alpha);
    const y = lerp(p.y, n.y, alpha);
    const a = lerp(p.a, n.a, alpha);
    const flags = flagsOf(c);
    exhaust(c, flags, dt);
    g.save();
    g.translate(x, y);
    g.rotate(a);
    g.scale(S, S);
    const helping = c.helping;
    setFlames(flags, helping === 0, helping === 1, 1);
    if (c.sputtering && Math.sin(time * 23 + c.spec.index) > 0.82) {
      // A stutter of flame as the empty engines cough.
      setFlames(duo ? FLAG.left | FLAG.right : FLAG.main, false, false, 0.3);
      g.globalAlpha = 0.5;
      g.scale(1, 0.4);
      drawFlames(g, flames, duo, false, time);
      g.scale(1, 2.5);
      g.globalAlpha = 1;
    } else drawFlames(g, flames, duo, false, time);
    drawCraft(g, color, duo);
    g.restore();
    drawCelebration(c, x, y);
  };

  return {
    setup(frame, l) {
      layout = l;
      k = frame.unit * frame.pixelRatio;
      const w = Math.max(1, Math.round(frame.width * frame.pixelRatio));
      const h = Math.max(1, Math.round(frame.height * frame.pixelRatio));
      for (const c of [backCanvas, frontCanvas]) {
        c.width = w;
        c.height = h;
      }
      const cap = Math.min(520, 200 + 120 * l.crews.length);
      particles = createParticles(cap);
      seedMotes(l);
    },
    terrain(crews) {
      drawBack(crews);
    },
    event(e, crews) {
      const c = crews[e.crew];
      if (!c) return;
      const S = c.physics.S;
      if (e.kind === "bump" || e.kind === "tipped") {
        const count = e.kind === "bump" ? 16 : 10;
        for (let i = 0; i < count; i++) {
          const a = Math.PI + (i / (count - 1)) * Math.PI;
          const v = (0.5 + Math.random() * 0.7) * S;
          particles.spawn(
            "dust",
            e.x,
            e.y,
            Math.cos(a) * v,
            Math.sin(a) * v * 0.5,
            1.2 + Math.random() * 0.6,
            0.12 * S,
          );
        }
      } else if (e.kind === "land") {
        for (let i = 0; i < 10; i++) {
          const s = i % 2 ? 1 : -1;
          particles.spawn(
            "dust",
            e.x + s * 0.3 * S,
            e.y - 0.02 * S,
            s * (0.4 + Math.random() * 0.6) * S,
            -0.08 * S,
            0.9,
            0.08 * S,
          );
        }
        for (let i = 0; i < 6 + 6 * e.stars; i++) {
          const a = -Math.PI * Math.random();
          const v = (0.6 + Math.random()) * S;
          particles.spawn(
            "spark",
            e.x,
            e.y - 0.5 * S,
            Math.cos(a) * v,
            Math.sin(a) * v - 0.4 * S,
            1 + Math.random() * 0.5,
            0.06 * S,
          );
        }
      }
    },
    draw(crews, alpha, time, dt) {
      if (!g || !layout) return;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, frontCanvas.width, frontCanvas.height);
      g.setTransform(k, 0, 0, k, 0, 0);
      drawMotes(crews, dt, time);
      particles.update(dt);
      for (const c of crews) drawCrew(c, alpha, time, dt);
      particles.draw(g);
    },
    clear() {
      particles.clear();
    },
    get particles() {
      return particles.live;
    },
    dispose() {
      backCanvas.remove();
      frontCanvas.remove();
    },
  };
};

/** Where the craft's feet are, for tests and the debug hook. */
export const feetOf = (c: Crew) => ({
  left: toWorld(c.craft, c.physics.S, -FOOT.x, FOOT.y),
  right: toWorld(c.craft, c.physics.S, FOOT.x, FOOT.y),
});
