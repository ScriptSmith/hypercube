/**
 * Canvas drawing for a touch frame. Two stacked canvases: `board` holds everything that only
 * changes with the layout (surfaces, markings, rims, goal slots) and is redrawn only when a
 * table is refitted; `play` is cleared and drawn every frame (pucks, mallets, targets, scores,
 * effects). Glows and big digits come from pre-drawn sprites, so a frame is mostly cheap image
 * copies even on a wall thousands of px wide.
 *
 * Lane contents are drawn in lane coordinates through the lane's transform; scores and HUD
 * in frame venue px.
 */
import type { FrameInfo, Palette, Rect } from "../../core/types";
import { withAlpha } from "../../core/ui";
import { OVER_MS, type Side } from "./config";
import type { Controls, Steering } from "./control";
import { apply, type TableSpec } from "./layout";
import { scoreOf, timeLeft } from "./match";
import {
  BOARD,
  clamp,
  digits,
  drawLaneBoard,
  ease,
  glow,
  hueOf,
  type Ink,
  inLane,
  malletBody,
  paddleBody,
  puckBody,
  rounded,
  splitterBody,
  star,
  TAU,
  targetBody,
  venue,
} from "./paint";
import { createParticles } from "./particles";
import { CROSS_SPEED, glide, type Puck } from "./physics";
import { createSprites } from "./sprites";
import { type Lane, type Player, SPLITTER_ID, type Table, type TableEvent } from "./table";
import { litMs, type Target } from "./waves";

export interface Scene {
  frame: FrameInfo;
  tables: readonly Table[];
  steering: readonly Steering[];
  controls: Controls;
  /** Goals that win (defence shows them as pips). */
  target: number;
  /** Defence on a bank: whether the open top leads to a live deck on the screen; else null. */
  linked: boolean | null;
}

export interface Renderer {
  /** Size the canvases for a frame. */
  setup(frame: FrameInfo): void;
  /** Redraw the static board for the tables' current layouts. */
  board(tables: readonly TableSpec[]): void;
  event(e: TableEvent, table: Table): void;
  /**
   * `now` is shared clock ms of the moment drawn, which the pucks' interpolation shows (a step
   * behind the clock); `dt` real seconds since the last draw.
   */
  draw(scene: Scene, alpha: number, now: number, dt: number): void;
  dispose(): void;
}

const TRAIL = 10;
/** At most this many pucks are drawn sliding off an open end at once, each for at most GHOST_S. */
const MAX_GHOSTS = 8;
const GHOST_S = 1.5;
/** Particle colours by index: sides 0 and 1, white, gold, then the player hues from 4. */
const HUE_BASE = 4;

interface Trail {
  xs: Float32Array;
  ys: Float32Array;
  n: number;
  head: number;
  age: number;
}

/**
 * A puck handed over to the other frame as its leading edge reached the open end, drawn sliding
 * on until it is wholly off this frame. `puck` is a copy at the handover, with its own trail.
 */
interface Ghost {
  lane: Lane;
  puck: Puck;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  /** Clock ms at the handover. */
  at: number;
}

export const createRenderer = (
  root: HTMLElement,
  palette: Palette,
  rand: () => number,
): Renderer => {
  const make = (z: number) => {
    const c = document.createElement("canvas");
    c.style.cssText = `position:absolute;inset:0;width:100%;height:100%;z-index:${z};`;
    root.append(c);
    return c;
  };
  const boardCanvas = make(0);
  const playCanvas = make(1);
  const boardCtx = boardCanvas.getContext("2d");
  const g = playCanvas.getContext("2d");
  const sprites = createSprites();
  const particles = createParticles(rand);
  const trails = new WeakMap<Puck, Trail>();
  const ghosts: Ghost[] = [];
  /** When each table's score last changed, by side, for the pop. */
  const pops = new WeakMap<Table, { score: [number, number]; at: [number, number] }>();
  /** When each table last cleared a wave, for its flash. */
  const waveAt = new WeakMap<Table, number>();
  const hue = (h: number) => hueOf(palette, h);
  const sideColor = (s: Side | -1) => hue(s === 1 ? 1 : 0);
  particles.colors = [
    sideColor(0),
    sideColor(1),
    palette.foreground,
    palette.accent,
    ...palette.players,
  ];
  let frame: FrameInfo | null = null;
  /** Device px per venue px. */
  let k = 1;
  let clock = 0;
  /** Shared clock ms at the last draw; events between draws are stamped with it. */
  let clockNow = 0;
  const ink = (): Ink | null => (g ? { g, k, sprites, palette } : null);

  // ---- Static board ------------------------------------------------------------------------

  const drawBoard = (tables: readonly TableSpec[]) => {
    if (!boardCtx || !frame) return;
    boardCtx.setTransform(1, 0, 0, 1, 0, 0);
    boardCtx.fillStyle = palette.background;
    boardCtx.fillRect(0, 0, boardCanvas.width, boardCanvas.height);
    boardCtx.setTransform(k, 0, 0, k, 0, 0);
    for (const t of tables) {
      if (!t.hud) continue;
      const h = t.hud;
      const grad = boardCtx.createLinearGradient(0, h.y, 0, h.y + h.height);
      grad.addColorStop(0, withAlpha("#0a1224", 0));
      grad.addColorStop(1, withAlpha("#0a1224", 0.9));
      boardCtx.fillStyle = grad;
      // Versus runs it to the frame edges, so the two frames join without a dark stripe.
      const inset = t.lanes[0]?.params.ends[1].kind === "open" ? 0 : 30;
      boardCtx.fillRect(h.x + inset, h.y, h.width - 2 * inset, h.height);
    }
    for (const t of tables) {
      for (const lane of t.lanes) {
        const team = lane.params.variant === "defence";
        drawLaneBoard(boardCtx, k, lane, palette, (end, m) =>
          team ? hue(m.slot) : sideColor(lane.params.ends[end].side),
        );
      }
    }
  };

  // ---- Pieces ------------------------------------------------------------------------------

  const trailOf = (p: Puck) => {
    let t = trails.get(p);
    if (!t) {
      t = { xs: new Float32Array(TRAIL), ys: new Float32Array(TRAIL), n: 0, head: 0, age: 0 };
      trails.set(p, t);
    }
    return t;
  };

  const drawPuck = (ik: Ink, lane: Lane, p: Puck, alpha: number) => {
    const params = lane.spec.params;
    const r = params.puckR;
    const x = p.px + (p.x - p.px) * alpha;
    const y = p.py + (p.y - p.py) * alpha;
    const tr = trailOf(p);
    if (p.age < tr.age) tr.n = 0;
    tr.age = p.age;
    const last = (tr.head + TRAIL - 1) % TRAIL;
    if (tr.n === 0 || Math.hypot(tr.xs[last]! - x, tr.ys[last]! - y) > r * 0.2) {
      tr.xs[tr.head] = x;
      tr.ys[tr.head] = y;
      tr.head = (tr.head + 1) % TRAIL;
      tr.n = Math.min(TRAIL, tr.n + 1);
    }
    const speed = Math.hypot(p.vx, p.vy) / params.maxPuck;
    ik.g.globalCompositeOperation = "lighter";
    for (let i = 0; i < tr.n - 1; i++) {
      const idx = (tr.head - tr.n + i + TRAIL * 2) % TRAIL;
      const f = (i + 1) / tr.n;
      const a = f * 0.35 * clamp(speed * 1.6, 0.15, 1);
      glow(ik, BOARD.puckGlow, tr.xs[idx]!, tr.ys[idx]!, r * (0.6 + f * 0.9), a);
    }
    const drop = p.slidIn || p.age >= 0.3 ? 1 : ease(p.age / 0.3);
    puckBody(ik, x, y, r * (1.5 - 0.5 * drop), p.angle, drop);
  };

  /** Pucks on this lane still sliding off its open end, moving as the other frame has them. */
  const drawGhosts = (ik: Ink, lane: Lane, now: number) => {
    const params = lane.spec.params;
    for (let i = ghosts.length - 1; i >= 0; i--) {
      const gh = ghosts[i]!;
      if (gh.lane !== lane) continue;
      const t = Math.max(0, (now - gh.at) / 1000);
      const x = gh.x + gh.vx * t;
      if (x - params.puckR >= params.length || t > GHOST_S) {
        ghosts.splice(i, 1);
        continue;
      }
      const p = gh.puck;
      p.x = p.px = x;
      p.y = p.py = glide(params, gh.y, gh.vy, t).y;
      p.angle = gh.angle + p.spin * t;
      drawPuck(ik, lane, p, 1);
    }
  };

  const drawMallet = (ik: Ink, lane: Lane, pl: Player, alpha: number) => {
    const params = lane.spec.params;
    const m = pl.mallet;
    const color = hue(pl.spec.hue);
    const x = m.px + (m.x - m.px) * alpha;
    const y = m.py + (m.y - m.py) * alpha;
    // A sealed defence slot's mallet waits faintly; bots look a touch quieter than people.
    const sealedSlot =
      params.variant === "defence" && params.mouths[0][lane.players.indexOf(pl)]?.open === false;
    const a = sealedSlot ? 0.25 : pl.human ? 1 : 0.88;
    if (params.variant === "paddles")
      paddleBody(ik, x, y, params.paddleHalf, params.paddleR, color, a);
    else malletBody(ik, x, y, params.malletR, color, a);
  };

  const drawObstacles = (ik: Ink, table: Table, lane: Lane, now: number) => {
    const span =
      table.waves && table.spec.defence
        ? litMs(table.waves.cleared, table.spec.defence, table.waves.pace)
        : 1;
    for (const o of lane.obstacles) {
      if (o.id >= SPLITTER_ID) {
        splitterBody(ik, o.x, o.y, o.r, clock);
        continue;
      }
      const lit = clamp(((o as Target).litUntil - now) / span, 0, 1);
      targetBody(ik, o.x, o.y, o.r, lit, clock);
    }
  };

  /** Sealed slots: a bar across the mouth, so nobody wonders why pucks bounce off it. */
  const drawSeals = (ik: Ink, lane: Lane, now: number) => {
    const p = lane.spec.params;
    const { g } = ik;
    const rim = clamp(p.width * 0.014, 6, 14);
    p.mouths[0].forEach((m, i) => {
      const color = hue(m.slot);
      const t = (now - (lane.slotFlash[i] ?? -Infinity)) / 900;
      if (t >= 0 && t < 1) {
        g.globalCompositeOperation = "lighter";
        glow(ik, palette.danger, 0, (m.y0 + m.y1) / 2, (m.y1 - m.y0) * 1.2, (1 - t) * 0.9);
        g.globalCompositeOperation = "source-over";
      }
      if (m.open) return;
      g.globalAlpha = 1;
      g.strokeStyle = withAlpha(color, 0.75);
      g.lineWidth = rim * 2.2;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(rim * 1.2, m.y0 + rim);
      g.lineTo(rim * 1.2, m.y1 - rim);
      g.stroke();
      g.strokeStyle = withAlpha(palette.background, 0.7);
      g.lineWidth = rim * 0.6;
      g.setLineDash([rim * 1.2, rim * 1.6]);
      g.beginPath();
      g.moveTo(rim * 1.2, m.y0 + rim * 2);
      g.lineTo(rim * 1.2, m.y1 - rim * 2);
      g.stroke();
      g.setLineDash([]);
    });
  };

  /**
   * Defence on a bank: the open top, with chevrons running up to the screen's deck and markers
   * for pucks due down from it. (A versus open end is plain: the other frame carries on the
   * table, and its board draws half the centre markings.)
   */
  const drawOpenEnd = (ik: Ink, scene: Scene, lane: Lane, now: number) => {
    const p = lane.spec.params;
    const { length: L, width: W } = p;
    const { g } = ik;
    const color = scene.linked ? palette.accent : palette.muted;
    const size = Math.min(W * 0.07, 120);
    const gap = size * 1.6;
    g.lineWidth = size * 0.28;
    g.lineCap = "round";
    g.lineJoin = "round";
    const rows = [0.2, 0.4, 0.6, 0.8];
    for (let i = 0; i < 4; i++) {
      const x = L - size * 0.6 - ((i * gap + ((clock * size * 1.2) % gap)) % (gap * 4));
      // Brightest at the edge, so they read as running out of the frame.
      g.strokeStyle = withAlpha(color, 0.6 * (1 - clamp((L - x) / (gap * 4), 0, 1)));
      for (const row of rows) {
        const cy = W * row;
        g.beginPath();
        g.moveTo(x - size * 0.5, cy - size);
        g.lineTo(x + size * 0.5, cy);
        g.lineTo(x - size * 0.5, cy + size);
        g.stroke();
      }
    }
    for (const a of lane.arrivals) {
      const f = clamp((now - a.sent) / Math.max(1, a.at - a.sent), 0, 1);
      const r = p.puckR;
      g.globalCompositeOperation = "lighter";
      glow(ik, color, L, a.y, r * (1.5 + 3 * f), 0.25 + 0.6 * f);
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
      g.strokeStyle = withAlpha(palette.foreground, 0.35 + 0.5 * f);
      g.lineWidth = r * 0.25;
      g.beginPath();
      g.arc(L, a.y, r * (3.2 - 2 * f), Math.PI / 2, Math.PI / 2 + Math.PI * f * 2);
      g.stroke();
    }
  };

  const drawLaneLive = (
    ik: Ink,
    scene: Scene,
    table: Table,
    lane: Lane,
    alpha: number,
    now: number,
  ) => {
    const { g } = ik;
    const p = lane.spec.params;
    const { length: L, width: W } = p;
    inLane(ik, lane.spec.toVenue);
    if (p.variant !== "defence") {
      g.globalCompositeOperation = "lighter";
      for (const end of [0, 1] as const) {
        const e = p.ends[end];
        if (e.kind !== "goal") continue;
        const x = end === 0 ? 0 : L;
        const half = Math.min(p.goalHalf, W / 2);
        const t = (now - lane.flash[end]) / 900;
        if (t >= 0 && t < 1)
          glow(ik, sideColor(e.side === 0 ? 1 : 0), x, W / 2, half * 2.6, (1 - t) * 0.95);
        // A slow breathing glow keeps each goal visible from far away.
        glow(ik, sideColor(e.side), x, W / 2, half * 1.2, 0.16 + 0.06 * Math.sin(clock * 2));
      }
      g.globalCompositeOperation = "source-over";
    } else {
      drawSeals(ik, lane, now);
      // A cleared wave lights the whole upper rink.
      const t = (now - (waveAt.get(table) ?? -Infinity)) / 1200;
      if (t >= 0 && t < 1) {
        g.globalCompositeOperation = "lighter";
        glow(ik, palette.accent, L * 0.8, W / 2, Math.max(L, W) * 0.6, (1 - t) * 0.5);
        g.globalCompositeOperation = "source-over";
      }
    }
    if (p.ends[1].kind === "open" && p.variant === "defence") drawOpenEnd(ik, scene, lane, now);
    drawObstacles(ik, table, lane, now);
    for (const pl of lane.players) drawMallet(ik, lane, pl, alpha);
    drawGhosts(ik, lane, now);
    for (const puck of lane.pucks) if (puck.live) drawPuck(ik, lane, puck, alpha);
  };

  /** Faint control strips for stretched controls, and a hint on seats a bot is holding. */
  const drawSeats = (ik: Ink, scene: Scene) => {
    const { g } = ik;
    venue(ik);
    const u = scene.frame.unit;
    for (const s of scene.steering) {
      const st = s.seat.station;
      const color = hue(s.seat.player.spec.hue);
      const map = scene.controls.mapOf(s);
      if (map?.strip) {
        const r = map.strip;
        g.globalAlpha = 1;
        g.fillStyle = withAlpha(color, 0.06);
        g.strokeStyle = withAlpha(color, 0.32);
        g.lineWidth = 4;
        g.setLineDash([22, 16]);
        rounded(g, r.x / u + 8, r.y / u, r.width / u - 16, r.height / u, 28);
        g.fill();
        g.stroke();
        g.setLineDash([]);
        const f = scene.controls.fingerOf(s);
        if (f) {
          g.strokeStyle = withAlpha(color, 0.5);
          g.lineWidth = 6;
          g.beginPath();
          g.arc(f.x / u, f.y / u, 46, 0, TAU);
          g.stroke();
        }
      }
      if (st.bot && st.state === "playing" && s.table.match.phase !== "over") {
        // "You can play here": pulsing rings low in the bot's station.
        const rect: Rect = st.rect;
        const cx = (rect.x + rect.width / 2) / u;
        const cy = (rect.y + rect.height * 0.86) / u;
        const pulse = (clock * 0.6 + cx * 0.001) % 1;
        g.globalAlpha = 1;
        g.strokeStyle = withAlpha(color, 0.35 * (1 - pulse));
        g.lineWidth = 6;
        g.beginPath();
        g.arc(cx, cy, 30 + 60 * pulse, 0, TAU);
        g.stroke();
        g.fillStyle = withAlpha(color, 0.3);
        g.beginPath();
        g.arc(cx, cy, 16, 0, TAU);
        g.fill();
      }
    }
  };

  // ---- Scores and HUD ----------------------------------------------------------------------

  const popOf = (table: Table, score: [number, number], now: number) => {
    let pop = pops.get(table);
    if (!pop) {
      pop = { score: [...score], at: [-Infinity, -Infinity] };
      pops.set(table, pop);
    }
    for (const s of [0, 1] as const) {
      if (score[s] === pop.score[s]) continue;
      if (score[s] > pop.score[s]) pop.at[s] = now;
      pop.score[s] = score[s];
    }
    return pop;
  };

  const drawScores = (ik: Ink, scene: Scene, table: Table, now: number) => {
    const { g } = ik;
    venue(ik);
    const spec = table.spec;
    const m = table.match;
    const score = scoreOf(m);
    const pop = popOf(table, score, now);
    const showing = m.phase === "play" || m.phase === "over" || m.phase === "countdown";
    const team = table.rules !== "match";
    for (const spot of spec.scores) {
      const color = team ? palette.accent : sideColor(spot.side);
      if (!showing) {
        if (!spot.faint && spec.hud) drawAttractCue(ik, spec, spot.side, color);
        continue;
      }
      const t = (now - pop.at[spot.side]) / 450;
      const bump = t >= 0 && t < 1 ? 1 + 0.35 * (1 - ease(t)) : 1;
      const won = m.phase === "over" && (m.winner === spot.side || (!team && m.winner === -1));
      if (won) {
        const r = spot.size * (m.winner === -1 ? 0.6 : 0.85) * (1 + 0.05 * Math.sin(clock * 5));
        g.globalCompositeOperation = "lighter";
        glow(ik, color, spot.x, spot.y, r * 2.2, spot.faint ? 0.35 : 0.6);
        g.globalCompositeOperation = "source-over";
        g.globalAlpha = 1;
        g.fillStyle = withAlpha(color, spot.faint ? 0.14 : 0.3);
        star(g, spot.x, spot.y, r);
        g.fill();
        g.strokeStyle = withAlpha(color, spot.faint ? 0.7 : 0.9);
        g.lineWidth = spot.size * 0.04;
        g.lineJoin = "round";
        g.stroke();
      }
      const a = spot.faint ? (won ? 0.95 : 0.7) : 1;
      if (!spot.faint && bump > 1) {
        g.globalCompositeOperation = "lighter";
        glow(ik, color, spot.x, spot.y, spot.size * 1.3 * bump, (bump - 1) * 1.6);
        g.globalCompositeOperation = "source-over";
      }
      digits(ik, String(score[spot.side]), color, spot.x, spot.y, spot.size, a, spot.faint, bump);
      if (team)
        drawPips(ik, spot.x, spot.y + spot.size * 0.8, spot.size * 0.12, score[0], scene.target);
    }
    g.globalAlpha = 1;
    drawTimer(ik, table, now);
  };

  /** Defence: one pip per wave needed to win, filled as waves are cleared. */
  const drawPips = (ik: Ink, cx: number, cy: number, r: number, done: number, total: number) => {
    const { g } = ik;
    const gap = r * 3;
    for (let i = 0; i < total; i++) {
      const x = cx + (i - (total - 1) / 2) * gap;
      g.globalAlpha = 1;
      g.strokeStyle = withAlpha(palette.accent, 0.8);
      g.lineWidth = r * 0.35;
      g.beginPath();
      g.arc(x, cy, r, 0, TAU);
      g.stroke();
      if (i < done) {
        g.fillStyle = palette.accent;
        g.fill();
      }
    }
  };

  /** In attract a wall's scoreboard points people down to the stations. */
  const drawAttractCue = (ik: Ink, spec: TableSpec, side: Side, color: string) => {
    if (!spec.hud) return;
    const { g } = ik;
    const pl = spec.lanes[0]?.players.find((p) => p.side === side);
    if (!pl?.station) return;
    const cx = pl.station.x + pl.station.width / 2;
    const base = spec.hud.y + spec.hud.height * 0.62;
    const size = Math.min(spec.hud.height * 0.09, 90);
    g.lineWidth = size * 0.3;
    g.lineCap = "round";
    g.lineJoin = "round";
    for (let i = 0; i < 3; i++) {
      const phase = (clock * 0.9 - i * 0.22) % 1;
      g.globalAlpha = 1;
      g.strokeStyle = withAlpha(color, Math.max(0, Math.sin(phase * Math.PI)) * 0.7);
      const y = base + i * size * 1.1;
      g.beginPath();
      g.moveTo(cx - size, y - size * 0.5);
      g.lineTo(cx, y + size * 0.5);
      g.lineTo(cx + size, y - size * 0.5);
      g.stroke();
    }
  };

  const drawTimer = (ik: Ink, table: Table, now: number) => {
    const { g } = ik;
    const m = table.match;
    if (m.phase !== "play") return;
    const total = Math.max(1, (m.endAt - m.startAt) / 1000);
    const left = timeLeft(m, now);
    const f = clamp(left / total, 0, 1);
    const urgent = left < 20;
    const color = urgent ? palette.accent : palette.foreground;
    const timer = table.spec.timer;
    g.globalAlpha = 1;
    if (timer.kind === "bar") {
      venue(ik);
      const r = timer.rect;
      g.fillStyle = withAlpha(palette.muted, 0.2);
      rounded(g, r.x, r.y, r.width, r.height, r.height / 2);
      g.fill();
      g.fillStyle = withAlpha(color, urgent ? 0.9 : 0.6);
      rounded(g, r.x + (r.width * (1 - f)) / 2, r.y, r.width * f, r.height, r.height / 2);
      g.fill();
      return;
    }
    const lane = table.lanes[0];
    if (!lane) return;
    const p = lane.spec.params;
    inLane(ik, lane.spec.toVenue);
    g.strokeStyle = withAlpha(color, urgent ? 0.8 : 0.45);
    g.lineWidth = clamp(p.width * 0.014, 6, 14) * 1.2;
    g.lineCap = "round";
    g.beginPath();
    g.arc(
      p.length / 2,
      p.width / 2,
      Math.min(p.width, p.length) * 0.16,
      -Math.PI / 2,
      -Math.PI / 2 + TAU * f,
    );
    g.stroke();
  };

  const drawCountdown = (ik: Ink, table: Table, now: number) => {
    if (table.match.phase !== "countdown") return;
    const lane = table.lanes[0];
    if (!lane) return;
    const left = (table.match.startAt - now) / 1000;
    if (left <= 0) return;
    const { g } = ik;
    const n = Math.ceil(left);
    const f = n - left;
    const p = lane.spec.params;
    const c = apply(lane.spec.toVenue, p.length / 2, p.width / 2);
    const size = Math.min(p.width * 0.62, p.length * 0.62, 560);
    venue(ik);
    const pop = f < 0.2 ? 0.7 + 1.5 * f : 1;
    const a = 1 - Math.max(0, f - 0.75) * 3;
    g.globalAlpha = a;
    g.fillStyle = withAlpha(palette.background, 0.8);
    g.beginPath();
    g.arc(c.x, c.y, (size / 2) * pop, 0, TAU);
    g.fill();
    g.strokeStyle = palette.accent;
    g.lineWidth = size * 0.035;
    g.beginPath();
    g.arc(c.x, c.y, (size / 2) * pop * 0.94, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - f));
    g.stroke();
    digits(ik, String(n), palette.accent, c.x, c.y, size * 0.62, a, false, pop);
    g.globalAlpha = 1;
  };

  const drawCelebration = (ik: Ink, table: Table, now: number, dt: number) => {
    const m = table.match;
    if (m.phase !== "over" || m.winner === null) return;
    const t = (now - m.since) / OVER_MS;
    if (t > 1) return;
    const team = table.rules !== "match";
    // Defence celebrates only a win; a match that ran out of time just ends.
    if (team && m.winner !== 0) return;
    const sides: Side[] = m.winner === -1 ? [0, 1] : [m.winner];
    const { g } = ik;
    g.globalCompositeOperation = "lighter";
    for (const lane of table.lanes) {
      inLane(ik, lane.spec.toVenue);
      const W = lane.spec.params.width;
      for (const pl of lane.players) {
        if (!sides.includes(pl.spec.side)) continue;
        const a = (0.22 + 0.1 * Math.sin(clock * 6)) * (1 - t * 0.7);
        const area = pl.spec.area;
        const cx = (area.x0 + area.x1) / 2;
        const cy = (area.y0 + area.y1) / 2;
        const r = Math.max(area.y1 - area.y0, area.x1 - area.x0, team ? 0 : W) * 0.75;
        glow(ik, hue(team ? pl.spec.hue : pl.spec.side), cx, cy, r, a);
      }
    }
    g.globalCompositeOperation = "source-over";
    if (t >= 0.7) return;
    for (const side of sides) {
      const spot = table.spec.scores.find((s) => s.side === side);
      if (!spot) continue;
      const rate = 40 * dt * (spot.faint ? 0.6 : 1.4);
      const n = Math.floor(rate) + (rand() < rate % 1 ? 1 : 0);
      if (n <= 0) continue;
      const y = spot.y - spot.size * 0.4;
      particles.confetti(spot.x, y, n, team ? 3 : side, spot.size * 1.4, spot.size * 0.06);
      particles.confetti(
        spot.x,
        y,
        Math.ceil(n / 3),
        team ? HUE_BASE + 2 : 3,
        spot.size * 1.4,
        spot.size * 0.05,
      );
    }
  };

  const drawParticles = (ik: Ink) => {
    const { g } = ik;
    venue(ik);
    particles.each((x, y, size, a, c, flat) => {
      const color = particles.colors[c] ?? palette.foreground;
      if (flat) {
        g.globalCompositeOperation = "source-over";
        g.globalAlpha = a;
        g.fillStyle = color;
        const w = size * (0.4 + 0.6 * Math.abs(Math.sin(x * 0.05 + clock * 8)));
        g.fillRect(x - w / 2, y - size * 0.3, w, size * 0.6);
      } else {
        g.globalCompositeOperation = "lighter";
        glow(ik, color, x, y, size, a);
      }
    });
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
  };

  return {
    setup(f) {
      frame = f;
      k = f.unit * f.pixelRatio;
      const w = Math.max(1, Math.round(f.width * f.pixelRatio));
      const h = Math.max(1, Math.round(f.height * f.pixelRatio));
      for (const c of [boardCanvas, playCanvas]) {
        c.width = w;
        c.height = h;
      }
      sprites.clear();
      particles.clear();
      ghosts.length = 0;
    },
    board(tables) {
      drawBoard(tables);
    },
    event(e, table) {
      if (e.type === "over" || e.type === "enter") return;
      if (e.type === "wave") {
        waveAt.set(table, clockNow);
        for (const spot of table.spec.scores) {
          particles.confetti(spot.x, spot.y, 40, 3, spot.size * 1.6, spot.size * 0.07);
        }
        return;
      }
      if (e.type === "exit") {
        const p = e.puck;
        const params = e.lane.spec.params;
        // Handed over before it was off the lane (versus): it slides on off this frame.
        if (p.x - params.puckR >= params.length) return;
        const puck: Puck = { ...p };
        const trail = trails.get(p);
        if (trail) trails.set(puck, { ...trail, xs: trail.xs.slice(), ys: trail.ys.slice() });
        if (ghosts.length >= MAX_GHOSTS) ghosts.shift();
        ghosts.push({
          lane: e.lane,
          puck,
          x: p.x,
          y: p.y,
          vx: Math.max(Math.abs(p.vx), CROSS_SPEED * params.maxPuck),
          vy: p.vy,
          angle: p.angle,
          at: e.at,
        });
        return;
      }
      const params = e.lane.spec.params;
      const toVenue = e.lane.spec.toVenue;
      const r = params.puckR;
      const fast = params.maxPuck;
      if (e.type === "goal") {
        const mouth = apply(toVenue, e.end === 0 ? 0 : params.length, params.width / 2);
        particles.burst(mouth.x, mouth.y, 36, e.scorer, fast * 0.45, r * 1.4);
        particles.burst(mouth.x, mouth.y, 12, 2, fast * 0.3, r);
        return;
      }
      const at = apply(toVenue, e.x, e.y);
      if (e.type === "lost") {
        const m = params.mouths[0][e.slot];
        const mouth = m ? apply(toVenue, 0, (m.y0 + m.y1) / 2) : at;
        particles.burst(mouth.x, mouth.y, 18, HUE_BASE + 7, fast * 0.3, r);
      } else if (e.type === "bump") {
        particles.burst(at.x, at.y, 10, 3, fast * 0.3, r * 0.9);
      } else if (e.type === "split") {
        particles.burst(at.x, at.y, 14, 2, fast * 0.35, r * 0.9);
      } else if (e.type === "hit" && e.speed > fast * 0.3) {
        particles.burst(at.x, at.y, 6, HUE_BASE + e.hue, fast * 0.25, r * 0.8);
      } else if (e.type === "bounce" && e.speed > fast * 0.45) {
        particles.burst(at.x, at.y, 3, 2, fast * 0.15, r * 0.6);
      }
    },
    draw(scene, alpha, now, dt) {
      clockNow = now;
      const ik = ink();
      if (!ik || !frame) return;
      clock += dt;
      particles.step(dt);
      const { g: ctx } = ik;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, playCanvas.width, playCanvas.height);
      for (const table of scene.tables) {
        drawScores(ik, scene, table, now);
        drawCelebration(ik, table, now, dt);
      }
      drawSeats(ik, scene);
      for (const table of scene.tables) {
        for (const lane of table.lanes) drawLaneLive(ik, scene, table, lane, alpha, now);
      }
      drawParticles(ik);
      for (const table of scene.tables) drawCountdown(ik, table, now);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    },
    dispose() {
      sprites.clear();
      particles.clear();
      boardCanvas.remove();
      playCanvas.remove();
    },
  };
};
