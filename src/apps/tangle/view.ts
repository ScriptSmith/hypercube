/**
 * One arena on screen: the WebGL picture (trails, bodies, heads, food, sparks) and a 2D layer
 * over it for start markers, the out-order strip, the time bar, countdowns and placings.
 * Used by every frame that shows an arena: a wall, a panel or pair playing alone, and a screen.
 *
 * On a wrapping arena anything near an edge is drawn again past the opposite edge, clipped to
 * the arena, so it shows on both sides; and a head running at an edge shows a faint copy where
 * it will come back in.
 */
import type { Palette, Rect } from "../../core/types";
import { FONT, withAlpha } from "../../core/ui";
import type { Arena, Line } from "./arena";
import {
  type Config,
  FLOOD_MS,
  FOOD_SIZE,
  HEAD_SIZE,
  HZ,
  MAX_LINES,
  snakeRules,
  snakeSize,
  WIPE_MS,
} from "./config";
import { createGlView, createSprites, type GlView, SPRITE } from "./glview";
import type { Match, SeatKind } from "./match";
import { createParticles } from "./particles";
import { wrapInto } from "./wrap";

export interface Placement {
  /** The view's area, in venue px of the frame. */
  rect: Rect;
  /** The arena inside it: the top inset holds the out-order strip. */
  inset: { left: number; top: number; right: number; bottom: number };
  /** Stage px per venue px, and device px per stage px. */
  unit: number;
  pixelRatio: number;
}

export interface Scene {
  match: Match;
  cfg: Config;
  /** Clock ms. */
  now: number;
  /** Seconds since the last draw. */
  dt: number;
  seat(key: number): SeatKind | null;
}

export interface ArenaView {
  place(p: Placement): void;
  /** Arena size in units (venue px) for the current placement. */
  readonly units: { width: number; height: number };
  draw(s: Scene): void;
  setVisible(on: boolean): void;
  dispose(): void;
}

const rgb = (hex: string): [number, number, number] => {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

const ease = (t: number) => 1 - (1 - t) ** 3;

export const createArenaView = (host: HTMLElement, palette: Palette, hint: string): ArenaView => {
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:absolute;pointer-events:none;overflow:hidden;";
  host.append(wrap);
  const colors = new Float32Array(MAX_LINES * 3);
  const gl: GlView = createGlView(wrap, {
    colors,
    background: rgb(palette.background),
    edge: rgb("#2c4f9e"),
  });
  gl.canvas.style.inset = "0";
  gl.canvas.style.width = "100%";
  gl.canvas.style.height = "100%";
  const hud = document.createElement("canvas");
  hud.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;";
  wrap.append(hud);
  const g = hud.getContext("2d");
  const sprites = createSprites();
  const bodies = new Float32Array(MAX_LINES);
  const sparks = createParticles(Math.random, 1);
  const players = palette.players.map(rgb);
  const accent = rgb(palette.accent);
  const prevAlive = new Uint8Array(MAX_LINES);
  const prevFood = new Uint8Array(32);
  let prevGen = -1;
  let place: Placement | null = null;
  let units = { width: 1, height: 1 };
  let clock = 0;

  const colorOf = (index: number) => palette.players[index % palette.players.length]!;
  const rgbOf = (index: number) => players[index % players.length]!;

  /** Sparks when a line crashes or food is eaten, found by comparing with the last frame. */
  const watch = (arena: Arena, m: Match) => {
    const trail = arena.params.trail;
    if (arena.generation !== prevGen) {
      prevGen = arena.generation;
      prevAlive.fill(0);
      prevFood.fill(0);
      for (const l of arena.lines) prevAlive[l.id] = l.alive ? 1 : 0;
    }
    for (const l of arena.lines) {
      const was = prevAlive[l.id] === 1;
      if (was && !l.alive) {
        const r = m.runners[l.id];
        sparks.burst(l.x, l.y, 46, r ? r.slot.color : 0, arena.params.speed * 1.4, 1.1);
      }
      prevAlive[l.id] = l.alive ? 1 : 0;
    }
    arena.food.forEach((f, i) => {
      if (i >= prevFood.length) return;
      if (prevFood[i] === 1 && !f.live) sparks.burst(f.x, f.y, 14, 255, trail * 12, 0.6);
      prevFood[i] = f.live ? 1 : 0;
    });
  };

  let wrapW = 0;
  let wrapH = 0;
  /** A sprite, and on a wrapping arena its copies past the opposite edges when it is near one. */
  const put = (
    x: number,
    y: number,
    r: number,
    kind: number,
    cr: number,
    cg: number,
    cb: number,
    a: number,
  ) => {
    sprites.push(x, y, r, kind, cr, cg, cb, a);
    if (wrapW <= 0) return;
    const sx = x < r ? wrapW : x > wrapW - r ? -wrapW : 0;
    const sy = y < r ? wrapH : y > wrapH - r ? -wrapH : 0;
    if (sx !== 0) sprites.push(x + sx, y, r, kind, cr, cg, cb, a);
    if (sy !== 0) sprites.push(x, y + sy, r, kind, cr, cg, cb, a);
    if (sx !== 0 && sy !== 0) sprites.push(x + sx, y + sy, r, kind, cr, cg, cb, a);
  };

  const pushSparks = (trail: number) => {
    sparks.each((x, y, size, a, c) => {
      const col = c === 255 ? accent : rgbOf(c);
      const px = wrapW > 0 ? wrapInto(x, wrapW) : x;
      const py = wrapW > 0 ? wrapInto(y, wrapH) : y;
      put(px, py, trail * 1.5 * size, SPRITE.spark, col[0], col[1], col[2], a);
    });
  };

  /**
   * Where a head running at an edge will come back in: straight on to the edge, then just inside
   * the opposite one. Faint at first, brighter as it gets close.
   */
  const pushExit = (arena: Arena, l: Line, kind: number, c: readonly number[]) => {
    const { width: W, height: H } = arena;
    const near = arena.params.speed * 1.1;
    const cos = Math.cos(l.heading);
    const sin = Math.sin(l.heading);
    const tx = cos > 1e-3 ? (W - l.x) / cos : cos < -1e-3 ? -l.x / cos : Infinity;
    const ty = sin > 1e-3 ? (H - l.y) / sin : sin < -1e-3 ? -l.y / sin : Infinity;
    const t = Math.min(tx, ty);
    if (t >= near) return;
    const inside = arena.params.trail * 2.2;
    const x = wrapInto(l.x + cos * (t + inside), W);
    const y = wrapInto(l.y + sin * (t + inside), H);
    const a = 0.65 * (1 - t / near) ** 0.6;
    sprites.push(x, y, arena.params.trail * 3.6, kind, c[0]!, c[1]!, c[2]!, a);
  };

  const buildSprites = (s: Scene) => {
    const { match: m } = s;
    const arena = m.arena;
    const trail = arena.params.trail;
    sprites.count = 0;
    bodies.fill(0);
    wrapW = arena.wrap ? arena.width : 0;
    wrapH = arena.wrap ? arena.height : 0;
    const pulse = 0.5 + 0.5 * Math.sin(clock * 5);
    if (m.phase === "lobby" || m.phase === "countdown") {
      // Where seated players will start.
      for (const slot of m.slots) {
        if (slot.virtual || !s.seat(slot.key)) continue;
        const c = rgbOf(slot.color);
        const kind =
          slot.style === 1 ? SPRITE.hollow : slot.style === 2 ? SPRITE.ringed : SPRITE.head;
        sprites.push(
          slot.start.x,
          slot.start.y,
          trail * HEAD_SIZE,
          kind,
          c[0],
          c[1],
          c[2],
          0.45 + 0.5 * pulse,
        );
      }
    }
    for (const r of m.runners) {
      const l = r.line;
      const c = rgbOf(r.slot.color);
      colors[l.id * 3] = c[0];
      colors[l.id * 3 + 1] = c[1];
      colors[l.id * 3 + 2] = c[2];
      if (snakeRules(arena.variant)) {
        const sinceOut = (arena.tick - l.outTick) / HZ;
        const ghost = l.alive && arena.tick < l.ghostUntil;
        bodies[l.id] = l.alive ? (ghost ? 0.35 + 0.3 * pulse : 1) : Math.max(0, 1 - sinceOut / 0.6);
        if (!l.alive) continue;
      }
      const kind = !l.alive
        ? SPRITE.dead
        : r.slot.style === 1
          ? SPRITE.hollow
          : r.slot.style === 2
            ? SPRITE.ringed
            : SPRITE.head;
      const a = l.alive ? (arena.tick < l.ghostUntil ? 0.4 + 0.5 * pulse : 1) : 0.7;
      put(l.x, l.y, trail * (l.alive ? HEAD_SIZE : 3), kind, c[0], c[1], c[2], a);
      if (arena.wrap && l.alive) pushExit(arena, l, kind, c);
    }
    for (const f of arena.food) {
      if (!f.live) continue;
      const grow = Math.min(1, (arena.tick - f.born) / (0.3 * HZ));
      const throb = 1 + 0.12 * Math.sin(clock * 4 + f.x * 0.01);
      put(
        f.x,
        f.y,
        trail * FOOD_SIZE * grow * throb,
        SPRITE.food,
        accent[0],
        accent[1],
        accent[2],
        1,
      );
    }
    pushSparks(trail);
  };

  const flood = (s: Scene) => {
    const m = s.match;
    if (m.phase !== "over" || !m.places) return null;
    const t = (s.now - m.since) / FLOOD_MS;
    if (t < 0 || t >= 1) return null;
    const winners = m.runners.filter((_, i) => m.places![i] === 1);
    if (winners.length !== 1) return null;
    const w = winners[0]!;
    const c = rgbOf(w.slot.color);
    const reach = Math.hypot(units.width, units.height);
    return {
      r: c[0],
      g: c[1],
      b: c[2],
      a: (1 - t) ** 1.5,
      x: w.line.x,
      y: w.line.y,
      radius: reach * ease(Math.min(1, t * 1.2)),
    };
  };

  // ---- 2D overlay -------------------------------------------------------------------------

  const chevron = (x: number, y: number, size: number, color: string, fill: boolean) => {
    if (!g) return;
    g.beginPath();
    g.moveTo(x - size, y + size * 0.55);
    g.lineTo(x, y - size * 0.45);
    g.lineTo(x + size, y + size * 0.55);
    if (fill) {
      g.lineTo(x, y + size * 0.1);
      g.closePath();
      g.fillStyle = color;
      g.fill();
    } else {
      g.strokeStyle = color;
      g.lineWidth = size * 0.22;
      g.lineCap = "round";
      g.lineJoin = "round";
      g.stroke();
    }
  };

  const numeral = (
    text: string,
    x: number,
    y: number,
    size: number,
    color: string,
    glowA = 0.8,
  ) => {
    if (!g) return;
    g.font = `900 ${size}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.shadowColor = withAlpha(color, glowA);
    g.shadowBlur = size * 0.25;
    g.fillStyle = color;
    g.fillText(text, x, y);
    g.shadowBlur = 0;
  };

  const rounded = (x: number, y: number, w: number, h: number, r: number) => {
    if (!g) return;
    g.beginPath();
    g.roundRect(x, y, w, h, r);
  };

  const drawHud = (s: Scene, p: Placement) => {
    if (!g) return;
    const m = s.match;
    const arena = m.arena;
    const k = p.unit * p.pixelRatio;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, hud.width, hud.height);
    g.setTransform(k, 0, 0, k, p.inset.left * k, p.inset.top * k);
    const W = units.width;
    const H = units.height;
    const stations = m.slots.filter((sl) => !sl.virtual);
    const spacing = stations.length > 1 ? W / stations.length : Math.min(W, H) * 0.5;
    const markerSize = Math.min(spacing * 0.16, Math.max(26, arena.params.trail * 3));
    const pulse = 0.5 + 0.5 * Math.sin(clock * 4);
    const lobby = m.phase === "lobby" || m.phase === "countdown";
    const inviting = m.attract && m.phase === "play";

    for (const sl of stations) {
      const seat = s.seat(sl.key);
      const color = colorOf(sl.color);
      const x = sl.start.x;
      const y = H - markerSize * 0.75;
      if (lobby && seat) {
        g.globalAlpha = 1;
        g.shadowColor = color;
        g.shadowBlur = markerSize * (0.6 + 0.6 * pulse);
        chevron(x, y, markerSize, color, true);
        g.shadowBlur = 0;
      } else {
        g.globalAlpha = lobby || inviting ? 0.35 + (inviting ? 0.3 * pulse : 0) : 0.22;
        chevron(x, y, markerSize * 0.8, color, false);
      }
    }
    g.globalAlpha = 1;

    const strip = p.inset.top;
    const chipH = Math.max(10, strip * 0.42);
    const chipW = chipH * 1.7;
    const gap = chipH * 0.35;
    if (m.phase === "play" || m.phase === "over") {
      if (arena.variant === "trails") {
        // Who went out, in order.
        m.outs.forEach((id, i) => {
          const r = m.runners[id];
          if (!r) return;
          const x = i * (chipW + gap);
          if (x + chipW > W * 0.7) return;
          rounded(x, -strip * 0.5 - chipH / 2, chipW, chipH, chipH * 0.3);
          g.fillStyle = withAlpha(colorOf(r.slot.color), 0.85);
          g.fill();
        });
      } else {
        // Snakes by length.
        const order = m.runners
          .map((r, i) => i)
          .sort((a, b) => m.runners[b]!.line.len - m.runners[a]!.line.len);
        let x = 0;
        const max = snakeSize(arena.variant).max;
        for (const i of order) {
          const r = m.runners[i]!;
          const w = chipW * (0.6 + (2.4 * r.line.len) / max);
          if (x + w > W * 0.7) break;
          rounded(x, -strip * 0.5 - chipH / 2, w, chipH, chipH * 0.3);
          g.fillStyle = withAlpha(colorOf(r.slot.color), r.line.alive ? 0.9 : 0.4);
          g.fill();
          x += w + gap;
        }
      }
    }
    if (m.phase === "play" && !m.attract) {
      // Time left, along the right of the strip.
      const total = s.cfg.roundMs;
      const left = Math.max(0, Math.min(1, (m.until - s.now) / total));
      const bw = W * 0.25;
      const by = -strip * 0.5 - chipH * 0.18;
      rounded(W - bw, by, bw, chipH * 0.36, chipH * 0.18);
      g.fillStyle = withAlpha(palette.muted, 0.25);
      g.fill();
      rounded(W - bw * left, by, bw * left, chipH * 0.36, chipH * 0.18);
      g.fillStyle = withAlpha(left < 0.17 ? palette.accent : palette.foreground, 0.7);
      g.fill();
    }
    if (m.attract && m.phase !== "over") {
      g.font = `800 ${Math.max(12, strip * 0.56)}px ${FONT}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = withAlpha(palette.foreground, 0.55 + 0.35 * pulse);
      g.fillText(hint, W / 2, -strip * 0.5);
    }

    const big = Math.min(W, H);
    if (m.phase === "countdown") {
      const left = Math.max(0, m.until - s.now);
      const n = Math.ceil(left / 1000);
      const frac = left / 1000 - Math.floor(left / 1000);
      if (n > 0)
        numeral(
          String(n),
          W / 2,
          H * 0.45,
          big * 0.34 * (0.9 + 0.2 * ease(frac)),
          palette.foreground,
        );
    } else if (m.phase === "lobby" && m.humans > 0) {
      const left = Math.max(0, m.until - s.now) / 1000;
      const r = big * 0.11;
      g.lineWidth = r * 0.12;
      g.strokeStyle = withAlpha(palette.muted, 0.3);
      g.beginPath();
      g.arc(W / 2, H * 0.45, r, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = withAlpha(palette.foreground, 0.75);
      g.beginPath();
      const span = Math.max(1, (m.until - m.since) / 1000);
      g.arc(W / 2, H * 0.45, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (left / span));
      g.stroke();
      numeral(String(Math.ceil(left + 3)), W / 2, H * 0.45, r * 1.1, palette.foreground, 0.4);
    }

    if (m.phase === "over" && m.places) {
      const size = Math.min(spacing * 0.75, H * 0.2);
      const t = Math.min(1, (s.now - m.since) / 400);
      m.runners.forEach((r, i) => {
        const place = m.places![i]!;
        const color = place === 1 ? palette.accent : colorOf(r.slot.color);
        const x = r.slot.start.x;
        const y = r.slot.virtual ? r.slot.start.y + size * 0.9 : H - markerSize * 1.6 - size * 0.55;
        g.globalAlpha = t;
        numeral(
          String(place),
          x,
          y,
          size * (0.7 + 0.3 * ease(t)) * (place === 1 ? 1.15 : 1),
          color,
        );
        if (place !== 1) {
          // A colour bar under each numeral says whose it is.
          rounded(x - size * 0.3, y + size * 0.48, size * 0.6, size * 0.1, size * 0.05);
          g.fillStyle = colorOf(r.slot.color);
          g.fill();
        }
      });
      g.globalAlpha = 1;
    }
  };

  return {
    get units() {
      return units;
    },

    place(p) {
      place = p;
      const { rect, inset, unit, pixelRatio } = p;
      units = {
        width: rect.width - inset.left - inset.right,
        height: rect.height - inset.top - inset.bottom,
      };
      wrap.style.left = `${rect.x * unit}px`;
      wrap.style.top = `${rect.y * unit}px`;
      wrap.style.width = `${rect.width * unit}px`;
      wrap.style.height = `${rect.height * unit}px`;
      const k = unit * pixelRatio;
      const width = Math.max(1, Math.round(rect.width * k));
      const height = Math.max(1, Math.round(rect.height * k));
      hud.width = width;
      hud.height = height;
      gl.configure({
        width,
        height,
        domain: {
          x: inset.left * k,
          y: inset.top * k,
          width: units.width * k,
          height: units.height * k,
        },
        units,
      });
    },

    draw(s) {
      if (!place) return;
      clock += s.dt;
      const m = s.match;
      watch(m.arena, m);
      sparks.step(s.dt);
      buildSprites(s);
      const wipe =
        m.phase === "over" && m.until - s.now < WIPE_MS
          ? Math.min(1, 1 - (m.until - s.now) / WIPE_MS)
          : -1;
      gl.draw({
        arena: m.arena,
        bodies: snakeRules(m.arena.variant) ? bodies : null,
        sprites,
        wipe,
        flood: flood(s),
      });
      drawHud(s, place);
    },

    setVisible(on) {
      wrap.style.display = on ? "" : "none";
    },

    dispose() {
      gl.dispose();
      sparks.clear();
      wrap.remove();
    },
  };
};
