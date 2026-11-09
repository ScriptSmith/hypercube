/**
 * A touch frame's picture: Canvas2D in two layers over the sky (sky.ts).
 *
 * - The slow layer (redrawn when a building or the light changes): stars, a hazy distant city,
 *   the ground, each crane's frame and buildings, the consoles, lift shafts and button faces.
 * - The fast layer (every frame): hooks and loads, the yard, loose blocks, blocks riding the
 *   lifts, flags, sparkles, the pads, button and release feedback, and ghost hands.
 *
 * On a bank the frame shows only the foot of its crane's mast and its lift, both carrying on out
 * of the top edge to the screen, where the crane itself stands.
 */
import type { FrameInfo, Rect } from "../../core/types";
import { BLOCK_COLORS, drawBlock, drawHand, drawReleaseIcon, type G, mix, rgba } from "./art";
import { BH, BLOCK_DRAW_W } from "./config";
import { drawBackdrop, makeBackdrop, type Backdrop } from "./backdrop";
import { padBox } from "./controls";
import type { Crane } from "./crane";
import type { CraneLayout, Layout } from "./layout";
import type { PadModel } from "./model";
import { createParticles, type Particles } from "./particles";
import { buildingsAnimating, buildingsKey, drawSiteDynamic, drawSiteStatic } from "./scene";
import { windowLight } from "./sky";

export interface Rider {
  id: number;
  kind: number;
  /** 0 at the button, 1 at the top of the lift. */
  t: number;
  /** Sent by a person (not a bot or the attract feed). */
  human?: boolean;
}

export interface FrameCrane {
  color: string;
  sim: Crane | null;
  pad: PadModel | null;
  /** Blocks on this frame's lift (on a bank; solo frames read the crane's own riders). */
  riders: readonly Rider[];
  /** A ghost finger on the pad (the autopilot), in the pad's box. */
  ghost: { x: number; y: number } | null;
  /** A ghost hand pressing a button: its kind and how far through the press (0..1). */
  ghostPress: { kind: number; t: number } | null;
  /** On a bank: where the screen's mast stands, as shares of the lane's width. */
  mast: { u: number; w: number } | null;
  held: boolean;
}

export interface FrameDraw {
  mode: "solo" | "bank";
  cranes: readonly FrameCrane[];
  /** Seconds, for pulses. */
  t: number;
  dt: number;
  night: number;
  assist: boolean;
  /** Button presses (ms) by `crane:kind`, and release presses by crane, and now. */
  pressed: ReadonlyMap<string, number>;
  released: ReadonlyMap<number, number>;
  now: number;
}

export interface FrameView {
  setup(frame: FrameInfo, layout: Layout): void;
  draw(d: FrameDraw): void;
  readonly particles: Particles;
  /** Venue px point of a rider on a crane's lift, for tests. */
  riderAt(crane: number, kind: number, t: number, bank: boolean): { x: number; y: number } | null;
  dispose(): void;
}

const CONSOLE = "#0c1220";
const GROUND = "#1a2131";

export const createFrameView = (root: HTMLElement, rand: () => number): FrameView => {
  const make = (z: number) => {
    const c = document.createElement("canvas");
    c.style.cssText = `position:absolute;inset:0;width:100%;height:100%;z-index:${z};pointer-events:none;`;
    root.append(c);
    return c;
  };
  const backCanvas = make(1);
  const frontCanvas = make(2);
  const back = backCanvas.getContext("2d");
  const g = frontCanvas.getContext("2d");
  const particles = createParticles();
  let layout: Layout | null = null;
  let k = 1;
  let ratio = 1;
  let backKey = "";
  let backdrop: Backdrop | null = null;

  const setup = (frame: FrameInfo, l: Layout) => {
    layout = l;
    ratio = Math.min(frame.pixelRatio, 2);
    for (const c of [backCanvas, frontCanvas]) {
      c.width = Math.max(1, Math.round(frame.width * ratio));
      c.height = Math.max(1, Math.round(frame.height * ratio));
    }
    k = frame.unit * ratio;
    backdrop = makeBackdrop(l.width, l.ground, 0.24, 1, rand);
    backKey = "";
  };

  // ---- Pieces -----------------------------------------------------------------------------

  const blockSize = (c: CraneLayout) => ({ w: BLOCK_DRAW_W * c.scene.s, h: BH * c.scene.s * 0.96 });

  const riderAt = (c: CraneLayout, kind: number, t: number, bank: boolean) => {
    const b = c.buttons.find((x) => x.kind === kind) ?? c.buttons[0];
    const { h } = blockSize(c);
    const start = b
      ? { x: b.rect.x + b.rect.width / 2, y: b.rect.y - h * 0.2 }
      : { x: c.lift.x, y: c.lift.bottom };
    const foot = { x: c.lift.x, y: c.lift.bottom - h / 2 - 6 };
    const top = bank ? { x: c.lift.x, y: -h / 2 - 4 } : { x: c.lift.x, y: c.lift.top - h / 2 };
    const A = 0.16;
    if (t < A) {
      const f = t / A;
      const e = f * f * (3 - 2 * f);
      return {
        x: start.x + (foot.x - start.x) * e,
        y: start.y + (foot.y - start.y) * e - Math.sin(Math.PI * f) * h * 0.6,
      };
    }
    const f = (t - A) / (1 - A);
    const e = f < 0.5 ? 2 * f * f : 1 - 2 * (1 - f) * (1 - f);
    return { x: foot.x, y: foot.y + (top.y - foot.y) * e };
  };

  const drawShaft = (ctx: G, c: CraneLayout, bank: boolean, color: string) => {
    const x = c.lift.x;
    const hw = c.lift.width / 2;
    const top = bank ? 0 : c.lift.top - 0.1 * c.scene.s;
    const bottom = c.lift.bottom;
    ctx.fillStyle = "rgba(10,16,30,0.55)";
    ctx.fillRect(x - hw, top, 2 * hw, bottom - top);
    ctx.strokeStyle = mix("#59627a", color, 0.35);
    ctx.lineWidth = Math.max(2, c.scene.s * 0.04);
    ctx.beginPath();
    ctx.moveTo(x - hw, top);
    ctx.lineTo(x - hw, bottom);
    ctx.moveTo(x + hw, top);
    ctx.lineTo(x + hw, bottom);
    const step = Math.max(40, c.scene.s * 0.45);
    for (let y = bottom; y > top; y -= step) {
      ctx.moveTo(x - hw, y);
      ctx.lineTo(x + hw, Math.max(top, y - step));
    }
    ctx.stroke();
    // The loading platform at the foot.
    ctx.fillStyle = mix("#3a4256", color, 0.3);
    ctx.fillRect(x - hw - 8, bottom - 6, 2 * hw + 16, 12);
  };

  const drawButtonFace = (ctx: G, r: Rect, kind: number, color: string) => {
    const rad = r.width * 0.16;
    ctx.fillStyle = "#141c2e";
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.width, r.height, rad);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(3, r.width * 0.035);
    ctx.stroke();
    const bw = r.width * 0.66;
    const bh = bw * 0.72;
    drawBlock(
      ctx,
      r.x + (r.width - bw) / 2,
      r.y + (r.height - bh) / 2 + r.height * 0.04,
      bw,
      bh,
      kind,
      {
        lit: 0.15,
        seed: kind,
      },
    );
    // An arrow up: this sends a block up.
    ctx.fillStyle = rgba("#ffffff", 0.7);
    const ax = r.x + r.width / 2;
    const ay = r.y + r.height * 0.13;
    const s = r.width * 0.07;
    ctx.beginPath();
    ctx.moveTo(ax, ay - s);
    ctx.lineTo(ax + s * 1.2, ay + s * 0.4);
    ctx.lineTo(ax - s * 1.2, ay + s * 0.4);
    ctx.closePath();
    ctx.fill();
  };

  const drawReleaseFace = (ctx: G, c: CraneLayout, color: string) => {
    const r = c.release;
    ctx.fillStyle = "#141c2e";
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(3, r.r * 0.07);
    ctx.stroke();
    drawReleaseIcon(ctx, r.x, r.y, r.r * 0.75, "#eef2f8");
  };

  // ---- Slow layer --------------------------------------------------------------------------

  const drawBack = (d: FrameDraw) => {
    if (!back || !layout) return;
    const l = layout;
    back.setTransform(1, 0, 0, 1, 0, 0);
    back.clearRect(0, 0, backCanvas.width, backCanvas.height);
    back.setTransform(k, 0, 0, k, 0, 0);
    if (d.mode === "bank") {
      // Below the screen's yard deck: a dark site hoarding, not sky.
      const hg = back.createLinearGradient(0, 0, 0, l.ground);
      hg.addColorStop(0, "#0e1424");
      hg.addColorStop(1, "#18203a");
      back.fillStyle = hg;
      back.fillRect(0, 0, l.width, l.ground);
      back.fillStyle = "rgba(255,255,255,0.035)";
      for (let x = 0; x < l.width; x += 120) back.fillRect(x, 0, 6, l.ground);
    } else if (backdrop) drawBackdrop(back, backdrop, d.night, 1);
    // Ground and consoles.
    back.fillStyle = GROUND;
    back.fillRect(0, l.ground - 6, l.width, 14);
    for (const c of l.cranes) {
      const cg = back.createLinearGradient(0, c.console.y, 0, c.console.y + c.console.height);
      cg.addColorStop(0, "#111a2c");
      cg.addColorStop(1, CONSOLE);
      back.fillStyle = cg;
      back.fillRect(c.console.x, c.console.y + 8, c.console.width, c.console.height);
    }
    d.cranes.forEach((fc, i) => {
      const c = l.cranes[i];
      if (!c) return;
      if (d.mode === "bank") {
        // Just the mast's foot, carrying on up to the screen's crane, and a site hoarding.
        const sc = c.scene;
        const mx = fc.mast ? c.lane.x + fc.mast.u * c.lane.width : sc.ox + c.world.mastX * sc.s;
        const mastW = fc.mast ? fc.mast.w * c.lane.width : 0.42 * sc.s;
        const lw = Math.max(1.5, 0.045 * sc.s);
        back.strokeStyle = fc.color;
        back.lineWidth = lw;
        back.beginPath();
        back.moveTo(mx - mastW / 2, l.ground);
        back.lineTo(mx - mastW / 2, 0);
        back.moveTo(mx + mastW / 2, l.ground);
        back.lineTo(mx + mastW / 2, 0);
        const n = Math.max(2, Math.round(l.ground / mastW));
        for (let j = 0; j < n; j++) {
          const y0 = l.ground - (l.ground * j) / n;
          const y1 = l.ground - (l.ground * (j + 1)) / n;
          const sgn = j % 2 === 0 ? 1 : -1;
          back.moveTo(mx - (sgn * mastW) / 2, y0);
          back.lineTo(mx + (sgn * mastW) / 2, y1);
        }
        back.stroke();
        back.fillStyle = "#3a4256";
        back.fillRect(mx - mastW * 1.1, l.ground - 0.1 * sc.s, mastW * 2.2, 0.16 * sc.s);
        // Hoarding panels along the site.
        const hh = 0.55 * sc.s;
        for (let x = c.lane.x + 10; x < c.lane.x + c.lane.width - 10; x += 0.9 * sc.s) {
          back.fillStyle = mix("#222b40", fc.color, 0.18);
          back.fillRect(x, l.ground - hh, 0.86 * sc.s, hh);
        }
        drawShaft(back, c, true, fc.color);
      } else if (fc.sim) {
        drawSiteStatic(back, c.scene, fc.sim, {
          color: fc.color,
          light: windowLight(d.night),
          assist: d.assist,
          t: d.t,
        });
        drawShaft(back, c, false, fc.color);
      }
      for (const b of c.buttons) drawButtonFace(back, b.rect, b.kind, fc.color);
      drawReleaseFace(back, c, fc.color);
    });
  };

  // ---- Fast layer --------------------------------------------------------------------------

  const drawPad = (ctx: G, c: CraneLayout, fc: FrameCrane, d: FrameDraw) => {
    const r = c.pad;
    const m = fc.pad;
    ctx.fillStyle = "rgba(6,10,20,0.9)";
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.width, r.height, 22);
    ctx.fill();
    ctx.strokeStyle = fc.held ? mix(fc.color, "#ffffff", 0.35) : fc.color;
    ctx.lineWidth = fc.held ? 6 : 4;
    ctx.stroke();
    if (!m) return;
    const b = padBox(r);
    const X = (x: number) => b.x + x * b.width;
    const Y = (y: number) => b.y + (1 - y) * b.height;
    ctx.save();
    ctx.beginPath();
    ctx.rect(b.x - 14, b.y - 18, b.width + 28, b.height + 30);
    ctx.clip();
    // Ground and jib.
    ctx.fillStyle = "rgba(120,140,180,0.25)";
    ctx.fillRect(b.x - 14, Y(0), b.width + 28, 4);
    ctx.strokeStyle = rgba(fc.color, 0.8);
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(b.x - 10, b.y - 12);
    ctx.lineTo(b.x + b.width + 10, b.y - 12);
    ctx.stroke();
    const bw = m.bw * b.width;
    const bh = m.bh * b.height;
    for (const s of m.slots) {
      const x = X(s.x) + (bw * (1 - 0.94)) / 2;
      const y = Y(s.y) - bh;
      if (s.kind < 0) {
        ctx.strokeStyle = s.next
          ? rgba(fc.color, 0.6 + 0.35 * Math.sin(d.t * 5))
          : "rgba(230,238,255,0.3)";
        ctx.lineWidth = s.next ? 3 : 2;
        ctx.strokeRect(x + 1, y + 1, bw * 0.94 - 2, bh - 2);
      } else {
        ctx.fillStyle = BLOCK_COLORS[s.kind]?.body ?? "#cccccc";
        ctx.fillRect(x, y + 1, bw * 0.94, bh - 2);
      }
    }
    for (const yd of m.yard) {
      const x = X(yd.x) - (bw * 0.94) / 2;
      if (yd.kind < 0) {
        ctx.fillStyle = "rgba(230,238,255,0.12)";
        ctx.fillRect(x, Y(0) - 4, bw * 0.94, 4);
      } else {
        ctx.fillStyle = BLOCK_COLORS[yd.kind]?.body ?? "#cccccc";
        ctx.fillRect(x, Y(0) - bh, bw * 0.94, bh - 2);
      }
    }
    // Trolley, cable, hook and load.
    const tx = X(m.trolley);
    ctx.fillStyle = fc.color;
    ctx.fillRect(tx - 14, b.y - 20, 28, 14);
    const hx = X(m.hook.x);
    const hy = Y(m.hook.y);
    ctx.strokeStyle = "rgba(230,236,245,0.9)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(tx, b.y - 8);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    if (m.load && m.carrying >= 0) {
      const lx = X(m.load.x);
      const ly = Y(m.load.y);
      ctx.fillStyle = BLOCK_COLORS[m.carrying]?.body ?? "#cccccc";
      ctx.fillRect(lx - (bw * 0.94) / 2, ly - bh / 2, bw * 0.94, bh);
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 2;
      ctx.strokeRect(lx - (bw * 0.94) / 2, ly - bh / 2, bw * 0.94, bh);
      if (m.guide) {
        ctx.strokeStyle = rgba(fc.color, 0.9);
        ctx.lineWidth = 3;
        ctx.setLineDash([10, 8]);
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(X(m.guide.x), Y(m.guide.y));
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.fillStyle = "#f2c94c";
    ctx.beginPath();
    ctx.arc(hx, hy, 7, 0, Math.PI * 2);
    ctx.fill();
    // Where the hook is heading.
    const gx = X(m.target.x);
    const gy = Y(m.target.y);
    ctx.strokeStyle = fc.color;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(gx, gy, 24, 0, Math.PI * 2);
    ctx.stroke();
    if (fc.held) {
      ctx.fillStyle = rgba(fc.color, 0.45);
      ctx.fill();
    }
    ctx.restore();
    if (fc.ghost) {
      drawHand(ctx, X(fc.ghost.x), Y(fc.ghost.y), Math.min(120, b.height * 0.28), 0.5);
    } else if (m.driver === "auto" && !fc.held) {
      // Nobody drives: a hand invites a drag.
      const a = 0.35 + 0.25 * Math.sin(d.t * 2.4);
      drawHand(ctx, gx, gy, Math.min(120, b.height * 0.28), a);
    }
  };

  const drawFront = (d: FrameDraw) => {
    if (!g || !layout) return;
    const l = layout;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, frontCanvas.width, frontCanvas.height);
    g.setTransform(k, 0, 0, k, 0, 0);
    d.cranes.forEach((fc, i) => {
      const c = l.cranes[i];
      if (!c) return;
      if (d.mode === "solo" && fc.sim) {
        drawSiteDynamic(g, c.scene, fc.sim, {
          color: fc.color,
          light: windowLight(d.night),
          assist: d.assist,
          t: d.t,
        });
      }
      const { w, h } = blockSize(c);
      const riders = d.mode === "solo" && fc.sim ? fc.sim.riders : fc.riders;
      for (const r of riders) {
        const p = riderAt(c, r.kind, Math.min(1, r.t), d.mode === "bank");
        g.fillStyle = mix("#3a4256", fc.color, 0.4);
        g.fillRect(c.lift.x - c.lift.width / 2 + 4, p.y + h / 2, c.lift.width - 8, 8);
        drawBlock(g, p.x - w / 2, p.y - h / 2, w, h, r.kind, { lit: 0, seed: r.id });
      }
      if (d.mode === "bank") {
        // Chevrons drifting up the shaft: blocks go up to the screen.
        g.fillStyle = rgba(fc.color, 0.35);
        const step = 140;
        const off = (d.t * 90) % step;
        for (let y = c.lift.bottom - 120 - off; y > 20; y -= step) {
          const s = c.lift.width * 0.18;
          g.beginPath();
          g.moveTo(c.lift.x, y - s);
          g.lineTo(c.lift.x + s * 1.4, y + s * 0.5);
          g.lineTo(c.lift.x - s * 1.4, y + s * 0.5);
          g.closePath();
          g.fill();
        }
      }
      drawPad(g, c, fc, d);
      // Buttons: a flash when pressed, dimmed while the yard is full.
      const room = fc.pad?.room ?? 1;
      for (const b of c.buttons) {
        const at = d.pressed.get(`${i}:${b.kind}`);
        const r = b.rect;
        if (room <= 0) {
          g.fillStyle = "rgba(4,6,12,0.55)";
          g.beginPath();
          g.roundRect(r.x, r.y, r.width, r.height, r.width * 0.16);
          g.fill();
        }
        if (at !== undefined && d.now - at < 300) {
          g.fillStyle = rgba("#ffffff", 0.35 * (1 - (d.now - at) / 300));
          g.beginPath();
          g.roundRect(r.x, r.y, r.width, r.height, r.width * 0.16);
          g.fill();
        }
        if (fc.ghostPress && fc.ghostPress.kind === b.kind) {
          const press = Math.sin(Math.PI * Math.min(1, fc.ghostPress.t));
          drawHand(
            g,
            r.x + r.width * 0.55,
            r.y + r.height * (0.45 + 0.1 * press),
            r.width * 0.55,
            0.55,
          );
        }
      }
      const rel = c.release;
      const carrying = (fc.pad?.carrying ?? -1) >= 0;
      if (carrying) {
        const strong = !!fc.pad?.guide;
        g.strokeStyle = rgba(fc.color, strong ? 0.6 + 0.35 * Math.sin(d.t * 6) : 0.4);
        g.lineWidth = strong ? 10 : 5;
        g.beginPath();
        g.arc(rel.x, rel.y, rel.r + 10, 0, Math.PI * 2);
        g.stroke();
      }
      const ra = d.released.get(i);
      if (ra !== undefined && d.now - ra < 300) {
        g.fillStyle = rgba("#ffffff", 0.35 * (1 - (d.now - ra) / 300));
        g.beginPath();
        g.arc(rel.x, rel.y, rel.r, 0, Math.PI * 2);
        g.fill();
      }
    });
    particles.step(d.dt);
    particles.draw(g);
  };

  let lastNight = -1;
  return {
    setup,
    particles,
    draw(d) {
      if (!layout) return;
      const night = Math.round(d.night * 40);
      let key = `${d.mode}:${night}`;
      let animating = false;
      for (const c of d.cranes) {
        if (d.mode === "solo" && c.sim) {
          key += `:${buildingsKey(c.sim)}`;
          if (buildingsAnimating(c.sim)) animating = true;
        }
        if (c.mast) key += `:${c.mast.u.toFixed(3)},${c.mast.w.toFixed(3)}`;
      }
      if (animating || key !== backKey || night !== lastNight) {
        backKey = key;
        lastNight = night;
        drawBack(d);
      }
      drawFront(d);
    },
    riderAt(crane, kind, t, bank) {
      const c = layout?.cranes[crane];
      return c ? riderAt(c, kind, t, bank) : null;
    },
    dispose() {
      particles.clear();
      backCanvas.remove();
      frontCanvas.remove();
    },
  };
};
