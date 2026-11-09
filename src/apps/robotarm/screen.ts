/**
 * The screen above a bank: one big picture that every arm below builds together (build.ts).
 * Each piece a lift sends up rises out of the bottom of the screen in its own frame's column,
 * where its beam left that frame, and arcs into the next empty square of its colour. Empty
 * squares show faintly, so everyone can see which colours are still wanted. People's pieces
 * trail brightly; demonstrations' and bots' pieces trail faintly. A finished picture
 * celebrates, leaves (the rocket launches, the boat sails off) and the next one comes in.
 *
 * The screen is authoritative: it alone picks squares, and it tells the frames what it still
 * wants about once a second (link.ts). With no frames below it, it builds slowly by itself.
 *
 * Canvas2D, in two layers: the background (redrawn only on resize) and everything that moves.
 */
import { bankFraction } from "../../core/layout";
import type { AppContext, AppInstance, FrameInfo } from "../../core/types";
import { ARC_S, type Build, createBuild, type Flight, RISE_S } from "./build";
import { createDownlink, createExits } from "./link";
import { BEAM, PIECE_COLORS } from "./palette";
import type { Picture } from "./pictures";

const TAU = Math.PI * 2;
const MAX_PARTICLES = 420;
/** With no frames below for this long, the screen feeds itself. */
const ALONE_MS = 6000;
const SELF_FEED_MS = 2600;
const RENDER_MS = 1000 / 40;
/** The beams fade out over this share of the screen's height, from the bottom. */
const BEAM_RISE = 0.5;

const rgba = (hex: string, a: number) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
}

interface Geometry {
  W: number;
  H: number;
  /** Square size and the picture's top-left, venue px. */
  s: number;
  x0: number;
  y0: number;
  /** Where waiting pieces hover. */
  hopperY: number;
}

const shade = (hex: string, k: number): string => {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = (v: number) =>
    Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k))));
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
};

const geometryFor = (W: number, H: number, pic: Picture): Geometry => {
  const areaW = W * 0.74;
  const areaH = H * 0.62;
  const s = Math.min(areaW / pic.w, areaH / pic.h);
  const x0 = (W - s * pic.w) / 2;
  const y0 = H * 0.07 + (areaH - s * pic.h) / 2;
  return { W, H, s, x0, y0, hopperY: H * 0.82 };
};

const easeOut = (f: number) => 1 - (1 - f) * (1 - f);
const easeInOut = (f: number) => f * f * (3 - 2 * f);

export const mountScreen = (ctx: AppContext): AppInstance => {
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
  const rng = ctx.rng().fork("robotarm-screen");
  const build: Build = createBuild(rng.int(6));
  const side = ctx.setup.side ?? 0;
  const count = () => Math.max(1, ctx.setup.count);
  const particles: Particle[] = [];
  /** Where each column's beam left its frame, and how wide it was, as its frame reported. */
  const exits = createExits();
  let beamsDirty = true;
  /** When each square was filled, for a flash. */
  const flashAt = new Map<number, number>();
  let columns = count();
  let k = 1;
  let disposed = false;
  let lastRender = 0;
  let lastStep = performance.now();
  let lastFrameSeen = performance.now();
  let feedAt = 0;

  const link = createDownlink(
    ctx.net,
    { side, count, now: () => performance.now() },
    (m, column, cols) => {
      columns = cols;
      // Rise from where that frame's beam is now, as it reported.
      const u = exits.get(column, performance.now())?.u ?? m.u / 1000;
      build.arrive(m.c, m.k, column, u, m.h === 1);
      lastFrameSeen = performance.now();
    },
    (column, u, w) => {
      if (exits.set(column, u, w, performance.now())) beamsDirty = true;
    },
  );

  const vw = () => frame.width / frame.unit;
  const vh = () => frame.height / frame.unit;

  const size = () => {
    const ratio = Math.min(frame.pixelRatio, 2);
    for (const c of [backCanvas, frontCanvas]) {
      c.width = Math.max(1, Math.round(frame.width * ratio));
      c.height = Math.max(1, Math.round(frame.height * ratio));
    }
    k = frame.unit * ratio;
    drawBack();
  };

  const columnX = (pos: number, u: number) => bankFraction(pos, u, columns) * vw();

  const drawBack = () => {
    if (!back) return;
    const W = vw();
    const H = vh();
    back.setTransform(1, 0, 0, 1, 0, 0);
    back.clearRect(0, 0, backCanvas.width, backCanvas.height);
    back.setTransform(k, 0, 0, k, 0, 0);
    const sky = back.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, Math.max(W, H) * 0.75);
    sky.addColorStop(0, "#18213a");
    sky.addColorStop(0.55, "#0b1022");
    sky.addColorStop(1, "#05070d");
    back.fillStyle = sky;
    back.fillRect(0, 0, W, H);
    // A faint grid, like the benches below.
    back.strokeStyle = "rgba(140,170,230,0.06)";
    back.lineWidth = 3;
    const step = W / 24;
    back.beginPath();
    for (let x = step; x < W; x += step) {
      back.moveTo(x, 0);
      back.lineTo(x, H);
    }
    for (let y = step; y < H; y += step) {
      back.moveTo(0, y);
      back.lineTo(W, y);
    }
    back.stroke();
    // Each frame's lift beam carries straight on up from the bottom edge, at the place and the
    // width it left that frame, as bright as it was there, fading out higher up.
    back.globalCompositeOperation = "lighter";
    for (const b of beamsNow()) {
      const across = back.createLinearGradient(b.x - b.width / 2, 0, b.x + b.width / 2, 0);
      for (const [f, a] of BEAM.across) across.addColorStop(f, rgba(BEAM.color, a));
      back.fillStyle = across;
      const strips = 24;
      const top = H * (1 - BEAM_RISE);
      for (let i = 0; i < strips; i++) {
        const y0 = H - ((i + 1) / strips) * (H - top);
        const fade = 1 - (i + 0.5) / strips;
        back.globalAlpha = BEAM.top * BEAM.opacity * fade * fade;
        back.fillRect(b.x - b.width / 2, y0, b.width, (H - top) / strips + 1);
      }
    }
    back.globalAlpha = 1;
    back.globalCompositeOperation = "source-over";
  };

  /** Each live column's beam: centre and width, venue px of this screen. */
  const beamsNow = () =>
    exits
      .live(performance.now())
      .filter((e) => e.column < columns && e.exit.w > 0)
      .map((e) => ({
        column: e.column,
        x: columnX(e.column, e.exit.u),
        width: e.exit.w * (vw() / Math.max(1, columns)),
      }));

  // ---- Particles ---------------------------------------------------------------------------

  const burst = (x: number, y: number, color: string, n: number, speed: number, size: number) => {
    for (let i = 0; i < n; i++) {
      if (particles.length >= MAX_PARTICLES) particles.shift();
      const a = rng.range(0, TAU);
      const v = speed * rng.range(0.3, 1);
      const life = rng.range(0.6, 1.4);
      particles.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - speed * 0.4,
        life,
        max: life,
        color,
        size,
      });
    }
  };

  // ---- Flights -----------------------------------------------------------------------------

  /** Where a flight is, venue px, at time `t` of its own, and how big. */
  const flightAt = (
    f: Flight,
    t: number,
    geo: Geometry,
  ): { x: number; y: number; size: number } => {
    const x0 = columnX(f.pos, f.u);
    // A piece fills about half its beam on the frame below; it grows on its way up.
    const beamW = (exits.get(f.pos, performance.now())?.w ?? 0.1) * (geo.W / Math.max(1, columns));
    const start = Math.min(geo.s * 0.7, beamW * 0.5);
    const startY = geo.H + start / 2;
    if (t < RISE_S || f.arcAt === null || t < f.arcAt) {
      const r = easeOut(Math.min(1, t / RISE_S));
      const bob = f.waiting && t > RISE_S ? Math.sin(t * 3 + f.id) * geo.s * 0.08 : 0;
      return {
        x: x0,
        y: startY + (geo.hopperY - startY) * r + bob,
        size: start + (geo.s * 0.8 - start) * r,
      };
    }
    const cell = f.cell !== null ? build.picture.cells[f.cell] : undefined;
    if (!cell) return { x: x0, y: geo.hopperY, size: geo.s * 0.8 };
    const tx = geo.x0 + (cell.x + 0.5) * geo.s;
    const ty = geo.y0 + (cell.y + 0.5) * geo.s;
    const a = easeInOut(Math.min(1, (t - f.arcAt) / ARC_S));
    // A bezier that lifts up first, then comes down onto the square.
    const cx = (x0 + tx) / 2;
    const cy = Math.min(geo.hopperY, ty) - geo.s * 3;
    const u = 1 - a;
    return {
      x: u * u * x0 + 2 * u * a * cx + a * a * tx,
      y: u * u * geo.hopperY + 2 * u * a * cy + a * a * ty,
      size: geo.s * (0.8 + 0.2 * a),
    };
  };

  const drawSquare = (
    x: number,
    y: number,
    size: number,
    color: string,
    kind: number,
    alpha = 1,
  ) => {
    if (!g) return;
    const h = size / 2;
    g.globalAlpha = alpha;
    if (kind === 1) {
      const grad = g.createRadialGradient(x - h * 0.3, y - h * 0.35, h * 0.1, x, y, h);
      grad.addColorStop(0, shade(color, 0.45));
      grad.addColorStop(1, shade(color, -0.25));
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, h * 0.92, 0, TAU);
      g.fill();
    } else {
      const r = size * 0.14;
      const m = size * 0.04;
      g.fillStyle = shade(color, -0.3);
      g.beginPath();
      g.roundRect(x - h + m, y - h + m, size - 2 * m, size - 2 * m, r);
      g.fill();
      g.fillStyle = color;
      g.beginPath();
      g.roundRect(x - h + m, y - h + m, size - 2 * m - size * 0.07, size - 2 * m - size * 0.07, r);
      g.fill();
      g.fillStyle = shade(color, 0.35);
      g.beginPath();
      g.roundRect(
        x - h + m + size * 0.08,
        y - h + m + size * 0.08,
        size * 0.32,
        size * 0.12,
        size * 0.06,
      );
      g.fill();
    }
    g.globalAlpha = 1;
  };

  const drawTrail = (f: Flight, geo: Geometry) => {
    if (!g) return;
    const color = PIECE_COLORS[f.color] ?? "#ffffff";
    const span = f.human ? 0.45 : 0.3;
    const n = 10;
    g.lineCap = "round";
    g.lineJoin = "round";
    let prev: { x: number; y: number } | null = null;
    for (let i = n; i >= 0; i--) {
      const t = f.t - (span * i) / n;
      if (t < 0) continue;
      const p = flightAt(f, t, geo);
      if (prev) {
        const share = 1 - i / n;
        g.strokeStyle = color;
        g.globalAlpha = (f.human ? 0.85 : 0.28) * share;
        g.lineWidth = geo.s * (f.human ? 0.42 : 0.22) * share;
        g.beginPath();
        g.moveTo(prev.x, prev.y);
        g.lineTo(p.x, p.y);
        g.stroke();
      }
      prev = p;
    }
    g.globalAlpha = 1;
  };

  // ---- The picture -------------------------------------------------------------------------

  const drawPicture = (geo: Geometry, now: number) => {
    if (!g) return;
    const pic = build.picture;
    const phase = build.phase;
    const pt = build.phaseT;
    let dx = 0;
    let dy = 0;
    let alpha = 1;
    let scale = 1;
    if (phase === "leave") {
      const f = Math.min(1, pt / 2.4);
      const e = f * f;
      if (pic.exit === "up") dy = -e * geo.H * 1.1;
      else if (pic.exit === "left") dx = -e * geo.W * 1.1;
      else if (pic.exit === "right") dx = e * geo.W * 1.1;
      else {
        dy = -e * geo.H * 0.25;
        scale = 1 + 0.3 * e;
        alpha = 1 - f;
      }
    } else if (phase === "enter") {
      alpha = Math.min(1, pt / 1);
    }
    const cx = geo.x0 + (pic.w * geo.s) / 2;
    const cy = geo.y0 + (pic.h * geo.s) / 2;
    g.save();
    g.translate(cx + dx, cy + dy);
    g.scale(scale, scale);
    g.translate(-cx, -cy);
    const glow = phase === "done" ? 0.5 + 0.5 * Math.sin(pt * 9) : 0;
    pic.cells.forEach((c, i) => {
      const x = geo.x0 + (c.x + 0.5) * geo.s;
      const y = geo.y0 + (c.y + 0.5) * geo.s;
      const color = PIECE_COLORS[c.color] ?? "#ffffff";
      if (build.filled[i]) {
        drawSquare(x, y, geo.s, color, 0, alpha);
        const at = flashAt.get(i);
        if (at !== undefined && now - at < 450) {
          g.globalAlpha = alpha * 0.7 * (1 - (now - at) / 450);
          g.fillStyle = "#ffffff";
          g.fillRect(x - geo.s / 2, y - geo.s / 2, geo.s, geo.s);
          g.globalAlpha = 1;
        }
        if (glow > 0) {
          g.globalAlpha = 0.25 * glow * alpha;
          g.fillStyle = "#ffffff";
          g.fillRect(x - geo.s / 2, y - geo.s / 2, geo.s, geo.s);
          g.globalAlpha = 1;
        }
      } else {
        const h = geo.s / 2;
        const m = geo.s * 0.08;
        g.globalAlpha = 0.16 * alpha;
        g.fillStyle = color;
        g.fillRect(x - h + m, y - h + m, geo.s - 2 * m, geo.s - 2 * m);
        g.globalAlpha = 0.45 * alpha;
        g.strokeStyle = color;
        g.lineWidth = Math.max(2, geo.s * 0.04);
        g.strokeRect(x - h + m, y - h + m, geo.s - 2 * m, geo.s - 2 * m);
        g.globalAlpha = 1;
      }
    });
    g.restore();
    // The rocket's flame on its way up.
    if (phase === "leave" && pic.exit === "up" && rng.next() < 0.8) {
      const bx = cx + dx + rng.range(-1, 1) * geo.s;
      const by = geo.y0 + pic.h * geo.s + dy;
      burst(
        bx,
        by,
        rng.next() < 0.5 ? (PIECE_COLORS[1] ?? "#ffffff") : "#ffffff",
        2,
        geo.s * 2,
        geo.s * 0.18,
      );
    }
  };

  // ---- Loop --------------------------------------------------------------------------------

  const update = (dt: number) => {
    const t = performance.now();
    build.step(dt);
    const geo = geometryFor(vw(), vh(), build.picture);
    for (const e of build.events) {
      if (e.type === "placed") {
        flashAt.set(e.cell, t);
        if (flashAt.size > 128) {
          const first = flashAt.keys().next().value;
          if (first !== undefined) flashAt.delete(first);
        }
        const c = build.picture.cells[e.cell];
        if (c) {
          const x = geo.x0 + (c.x + 0.5) * geo.s;
          const y = geo.y0 + (c.y + 0.5) * geo.s;
          burst(
            x,
            y,
            PIECE_COLORS[e.color] ?? "#ffffff",
            e.human ? 14 : 6,
            geo.s * 2.2,
            geo.s * 0.12,
          );
        }
      } else if (e.type === "fizzle") {
        burst(
          columnX(e.pos, e.u),
          geo.hopperY,
          PIECE_COLORS[e.color] ?? "#ffffff",
          10,
          geo.s * 2,
          geo.s * 0.1,
        );
      } else if (e.type === "done") {
        for (let i = 0; i < 6; i++) {
          const x = geo.x0 + rng.range(0, build.picture.w) * geo.s;
          const y = geo.y0 + rng.range(0, build.picture.h) * geo.s;
          for (const c of PIECE_COLORS) burst(x, y, c, 12, geo.s * 6, geo.s * 0.16);
        }
      }
    }
    build.events.length = 0;
    // A screen with nobody below builds slowly on its own, so it never stands still.
    const stations = link.stations();
    if (stations.length > 0) {
      columns = Math.max(count(), ...stations.map((p) => p.pos + 1));
      lastFrameSeen = t;
    }
    if (t - lastFrameSeen > ALONE_MS && t >= feedAt) {
      feedAt = t + SELF_FEED_MS;
      const needs = build.needs();
      const wanted = [0, 1, 2].filter((c) => (needs[c] ?? 0) > 0);
      if (wanted.length > 0)
        build.arrive(rng.pick(wanted), rng.int(2), rng.int(columns), rng.range(0.3, 0.7), false);
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      p.vy += geo.s * 6 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    link.tick({ n: build.needs(), pic: build.index, f: Math.round(build.progress() * 100) });
  };

  const render = () => {
    if (!g) return;
    const W = vw();
    const H = vh();
    const now = performance.now();
    const geo = geometryFor(W, H, build.picture);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, frontCanvas.width, frontCanvas.height);
    g.setTransform(k, 0, 0, k, 0, 0);
    drawPicture(geo, now);
    for (const f of build.flights) {
      drawTrail(f, geo);
      const p = flightAt(f, f.t, geo);
      const color = PIECE_COLORS[f.color] ?? "#ffffff";
      if (f.human) {
        g.shadowColor = color;
        g.shadowBlur = geo.s * 0.6 * k;
      }
      drawSquare(
        p.x,
        p.y,
        p.size,
        color,
        f.cell === null && f.t > RISE_S ? 1 : f.kind,
        f.human ? 1 : 0.8,
      );
      g.shadowBlur = 0;
    }
    for (const p of particles) {
      g.globalAlpha = Math.min(1, (p.life / p.max) * 1.3);
      g.fillStyle = p.color;
      g.beginPath();
      g.arc(p.x, p.y, p.size, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
  };

  size();
  const offResize = ctx.onResize((f) => {
    frame = f;
    size();
  });

  // Columns may change as frames join; keep the background's beams in step.
  let drawnColumns = columns;
  let beamsCheckedAt = 0;
  let beamsShown = 0;
  const loop = ctx.loop({
    hz: 30,
    update(dt) {
      if (disposed) return;
      update(dt);
      if (columns !== drawnColumns || beamsDirty) {
        drawnColumns = columns;
        beamsDirty = false;
        drawBack();
      }
      // Beams of frames that went quiet fade from the list; check now and then.
      if (performance.now() - beamsCheckedAt > 1000) {
        beamsCheckedAt = performance.now();
        const n = exits.live(beamsCheckedAt).length;
        if (n !== beamsShown) {
          beamsShown = n;
          drawBack();
        }
      }
    },
    render() {
      if (disposed) return;
      const t = performance.now();
      if (t - lastRender < RENDER_MS) return;
      lastRender = t;
      lastStep = t;
      render();
    },
  });
  loop.start();

  const debugKey = "__robotarm";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => ({
          screen: true,
          columns,
          picture: build.picture.name,
          index: build.index,
          phase: build.phase,
          filled: build.filled.filter(Boolean).length,
          total: build.filled.length,
          needs: build.needs(),
          flights: build.flights.map((f) => ({
            pos: f.pos,
            color: f.color,
            human: f.human,
            cell: f.cell,
            waiting: f.waiting,
          })),
          counts: { ...build.counts },
          stations: link.stations().length,
          width: vw(),
          beams: beamsNow(),
          particles: particles.length,
          lastStep,
        }),
        command: (name: string) => {
          if (name === "clear") build.restart();
          else if (name === "next") build.skip();
        },
        /** For tests: a piece arriving as if from the frame at `pos`. */
        arrive: (color: number, pos: number, human: boolean) =>
          build.arrive(color, 0, pos, 0.5, human) !== null,
      },
    });
  }

  return {
    // The picture is everyone's: an idle timeout on the screen (it is never touched) must not
    // wipe it. Only the particles go.
    reset() {
      particles.length = 0;
    },
    attract() {},
    status() {
      return {
        picture: build.picture.name,
        filled: Math.round(build.progress() * 100),
        placed: build.counts.placed,
        pictures: build.counts.pictures,
        frames: link.stations().length,
      };
    },
    command(name) {
      if (name === "clear") build.restart();
      else if (name === "next") build.skip();
    },
    dispose() {
      disposed = true;
      loop.stop();
      offResize();
      link.dispose();
      particles.length = 0;
      backCanvas.remove();
      frontCanvas.remove();
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
