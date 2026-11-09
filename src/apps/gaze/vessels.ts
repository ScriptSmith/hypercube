/**
 * The white of the eye's blood vessels, grown as branching trees and painted once into a
 * texture in the eye's own frame. Rows run from the limbus (top) to the back of the eye
 * (bottom); columns run once round the line of sight, as `atan(y, x)` of a direction in the
 * eye's frame goes from -π to π.
 *
 * Conjunctival vessels start well back, run roughly radially towards the iris, wander, branch
 * and thin, and mostly stop 1 to 3 mm short of the limbus; fine twigs sprout
 * off them, more of them near the limbus. As in close-up photographs, the finer ones meander and
 * kink rather than curving smoothly, and a mesh of fine vessels between them joins up into loops,
 * as the deeper layer's network does. There are more along the eye's horizontal meridian, the
 * strip a real eye's lids leave open. Each tree is an artery or a vein and lies at its own
 * depth under the clear conjunctiva, and its depth drifts along its length, so a vessel sharpens
 * and fades as it dips in and out of focus. Wider, deeper episcleral vessels show only as soft
 * shadows. They are sparse and pale, as in a healthy eye: never a red eye.
 *
 * The texture holds optical depth, which the shader turns into colour by absorption: red holds
 * arteries, blue veins, green the deep blurred layer.
 */
import type { Rng } from "../../core/types";

export interface VesselSegment {
  /** Angle round the line of sight, radians, -π to π. */
  phi0: number;
  phi1: number;
  /** Angle from the line of sight, radians. */
  th0: number;
  th1: number;
  /** Width, radians of arc on the eye. */
  width: number;
  /** Episcleral: deep, wide and soft. */
  deep: boolean;
  vein: boolean;
  /** How far under the surface, 0 to 1: deeper is fainter and softer. */
  depth: number;
  /** Steps from the root of its tree, so trunks fade in from the back rather than start. */
  age: number;
  /** Part of the fine mesh between the trees. */
  mesh: boolean;
}

export interface VesselOptions {
  /** Half-angle of the iris, where the sclera starts. */
  iris: number;
  /** Most segments to grow, so nothing can grow without bound. */
  max?: number;
}

export const MAX_SEGMENTS = 40000;

/** Grow the vessel trees. */
export const growVessels = (rng: Rng, opts: VesselOptions): VesselSegment[] => {
  const out: VesselSegment[] = [];
  const max = Math.min(MAX_SEGMENTS, opts.max ?? MAX_SEGMENTS);
  const gauss = () => {
    const u = Math.max(1e-12, rng.next());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng.next());
  };

  // Denser in some sectors than others, as no two eyes match.
  const lumps = Array.from({ length: 5 }, () => ({
    at: rng.range(-Math.PI, Math.PI),
    w: rng.range(0.3, 0.9),
    k: rng.range(0.4, 1.4),
  }));
  // Most along the horizontal meridian, varied by the lumps; at most 2.2.
  const density = (phi: number) => {
    let lump = 0;
    for (const l of lumps) {
      const dp = Math.atan2(Math.sin(phi - l.at), Math.cos(phi - l.at));
      lump += l.k * Math.exp(-(dp * dp) / (2 * l.w * l.w));
    }
    return (0.45 + 0.85 * Math.cos(phi) ** 2) * (0.75 + 0.6 * Math.min(1, lump / 1.4));
  };

  interface Tip {
    phi: number;
    th: number;
    /** Heading on the surface: 0 runs towards the iris, ±π/2 round it. */
    heading: number;
    /** How fast the heading turns, radians a step, itself a slow random walk. */
    bend: number;
    width: number;
    /** Slow swelling and narrowing along the vessel, as a factor. */
    swell: number;
    depth: number;
    steps: number;
    age: number;
    /** How far short of the limbus it stops, radians. */
    stop: number;
    deep: boolean;
    vein: boolean;
    /** A short side twig or a turn along the limbus: it ends soon and doesn't branch. */
    short: boolean;
    /** Meander: the phase, its step and its size, radians. */
    wig: number;
    wigStep: number;
    wigSize: number;
  }
  const stack: Tip[] = [];
  const MAX_STEPS = 400;
  const meander = meanderOf(rng);

  const grow = (tip: Tip) => {
    const step = tip.deep ? 0.01 : 0.004;
    while (out.length < max) {
      if (tip.width < (tip.deep ? 0.004 : 0.0009) || tip.steps > MAX_STEPS) return;
      if (tip.th < opts.iris + tip.stop) {
        // Some end by turning along the limbus for a short way, as its arcades do.
        if (!tip.deep && !tip.short && rng.next() < 0.35) {
          tip.short = true;
          tip.heading = (rng.next() < 0.5 ? 1 : -1) * Math.PI * rng.range(0.4, 0.5);
          tip.steps = MAX_STEPS - Math.floor(rng.range(6, 20));
          tip.width = Math.min(tip.width, 0.0018);
        } else return;
      }
      const s = Math.sin(tip.th);
      const dth = -Math.cos(tip.heading) * step;
      const dphi = (Math.sin(tip.heading) * step) / Math.max(0.2, s);
      const th1 = Math.max(opts.iris + 0.004, tip.th + dth);
      const phi1 = tip.phi + dphi;
      out.push({
        phi0: wrap(tip.phi),
        phi1: wrap(tip.phi) + (phi1 - tip.phi),
        th0: tip.th,
        th1,
        width: tip.width * tip.swell,
        deep: tip.deep,
        vein: tip.vein,
        depth: tip.depth,
        age: tip.age,
        mesh: false,
      });
      tip.phi = phi1;
      tip.th = th1;
      tip.steps++;
      tip.age++;
      tip.width *= tip.deep ? 0.993 : tip.short ? 0.985 : 0.9965;
      tip.swell = Math.max(0.7, Math.min(1.3, tip.swell + gauss() * 0.03 + (1 - tip.swell) * 0.05));
      tip.depth = Math.max(0, Math.min(1, tip.depth + gauss() * 0.06));
      // Smooth bends, plus a fine kink that grows as vessels thin and that veins have more of;
      // the heading is pulled back towards the iris.
      const thin = Math.max(0, 1 - tip.width / 0.004);
      const fine = thin * (tip.vein ? 0.08 : 0.05);
      tip.bend = tip.bend * 0.88 + gauss() * (tip.deep ? 0.008 : 0.012);
      tip.heading += tip.bend + gauss() * fine;
      // Fine vessels meander, and now and then turn sharply.
      if (!tip.deep) {
        const size = tip.wigSize * (0.4 + 0.6 * thin);
        tip.heading += size * (Math.sin(tip.wig + tip.wigStep) - Math.sin(tip.wig));
        tip.wig += tip.wigStep;
        if (rng.next() < 0.004 + 0.01 * thin) {
          tip.heading += (rng.next() < 0.5 ? 1 : -1) * rng.range(0.3, 0.8);
        }
      }
      if (!tip.short) tip.heading *= 0.965;
      if (tip.short || tip.deep) continue;
      // Branch more often near the limbus, where vessels thin.
      const near = 1 - Math.min(1, (tip.th - opts.iris) / 0.6);
      if (rng.next() < 0.006 + 0.03 * near) {
        const side = rng.next() < 0.5 ? 1 : -1;
        const share = rng.range(0.5, 0.85);
        stack.push({
          ...tip,
          heading: tip.heading + side * rng.range(0.4, 1.0),
          bend: 0,
          width: tip.width * share,
          depth: Math.max(0, Math.min(1, tip.depth + rng.range(-0.15, 0.2))),
          stop: Math.max(0.05, tip.stop + rng.range(-0.03, 0.03)),
        });
        // Murray's law: the parent narrows so the cubes of the widths balance.
        tip.width *= Math.cbrt(Math.max(0.2, 1 - share ** 3));
        tip.heading -= side * rng.range(0.05, 0.2);
      } else if (rng.next() < 0.01 + 0.025 * near) {
        // A fine twig off to the side, short and faint.
        const side = rng.next() < 0.5 ? 1 : -1;
        stack.push({
          ...tip,
          heading: tip.heading + side * rng.range(0.7, 1.6),
          bend: 0,
          width: Math.min(tip.width * 0.6, rng.range(0.0011, 0.0019)),
          depth: Math.min(1, tip.depth + rng.range(0, 0.3)),
          steps: MAX_STEPS - Math.floor(rng.range(4, 24)),
          short: true,
        });
      }
    }
  };

  const roots = 26;
  for (let i = 0; i < roots; i++) {
    const phi = rng.range(-Math.PI, Math.PI);
    if (rng.next() * 1.6 > density(phi)) continue;
    const vein = rng.next() < 0.5;
    stack.push({
      phi,
      th: rng.range(1.0, 1.5),
      heading: gauss() * 0.25,
      bend: 0,
      // A few big trunks and more middling ones.
      width: (0.003 + 0.008 * rng.next() ** 2) * (vein ? 1.15 : 1),
      swell: 1,
      depth: rng.range(0, 0.6),
      steps: 0,
      age: 0,
      // Most stop 1 to 3 mm short of the limbus.
      stop: rng.range(0.07, 0.2),
      deep: false,
      vein,
      short: false,
      ...meander(),
    });
  }
  for (let i = 0; i < 10; i++) {
    stack.push({
      phi: rng.range(-Math.PI, Math.PI),
      th: rng.range(1.4, 1.9),
      heading: gauss() * 0.2,
      bend: 0,
      width: rng.range(0.009, 0.015),
      swell: 1,
      depth: 1,
      steps: 0,
      age: 0,
      stop: rng.range(0.3, 0.55),
      deep: true,
      vein: true,
      short: false,
      ...meander(),
    });
  }
  while (stack.length > 0 && out.length < max) grow(stack.pop()!);
  mesh(rng, opts.iris, density, out, max);
  return out;
};

/** A meander's phase, step and size, for a new vessel. */
const meanderOf = (rng: Rng) => () => ({
  wig: rng.range(0, 2 * Math.PI),
  wigStep: (2 * Math.PI) / rng.range(8, 16),
  wigSize: rng.range(0.25, 0.6),
});

/** How many fine vessels the mesh joins up, and how far apart they may be, radians. */
export const MESH = { nodes: 320, links: 2, reach: 0.13 };

/**
 * A mesh of fine vessels between the trees: points scattered over the visible white, each
 * joined to its nearest neighbours by a faint meandering vessel, so they close into loops.
 */
const mesh = (
  rng: Rng,
  iris: number,
  density: (phi: number) => number,
  out: VesselSegment[],
  max: number,
) => {
  interface Node {
    phi: number;
    th: number;
  }
  const nodes: Node[] = [];
  for (let tries = 0; nodes.length < MESH.nodes && tries < MESH.nodes * 8; tries++) {
    const phi = rng.range(-Math.PI, Math.PI);
    // Clear of the limbus, thinning out towards the back where the vessels fade.
    const th = iris + rng.range(0.12, 1.0);
    const keep = (density(phi) / 1.6) * (1 - 0.6 * ((th - iris - 0.12) / 0.88));
    if (rng.next() < keep) nodes.push({ phi, th });
  }
  const gap = (a: Node, b: Node) => {
    const dp = wrap(b.phi - a.phi) * Math.sin((a.th + b.th) / 2);
    return Math.hypot(dp, b.th - a.th);
  };
  const step = 0.004;
  const seen = new Set<string>();
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]!;
    const near = nodes
      .map((b, j) => ({ j, d: gap(a, b) }))
      .filter((n) => n.j !== i && n.d < MESH.reach)
      .sort((x, y) => x.d - y.d)
      .slice(0, MESH.links);
    for (const n of near) {
      const key = i < n.j ? `${i},${n.j}` : `${n.j},${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const b = nodes[n.j]!;
      const steps = Math.max(2, Math.ceil(n.d / step));
      const dphi = wrap(b.phi - a.phi);
      const dth = b.th - a.th;
      // Sideways, on the surface, for the meander.
      const len = Math.hypot(dphi * Math.sin(a.th), dth) || 1;
      const sideTh = (dphi * Math.sin(a.th)) / len;
      const sidePhi = -dth / len;
      const width = rng.range(0.0012, 0.0022);
      const depth = rng.range(0.1, 0.6);
      const vein = rng.next() < 0.5;
      const phase = rng.range(0, 2 * Math.PI);
      const turns = Math.max(1, Math.round(n.d / rng.range(0.025, 0.045)));
      const size = rng.range(0.004, 0.009);
      let prevPhi = a.phi;
      let prevTh = a.th;
      for (let k = 1; k <= steps; k++) {
        if (out.length >= max) return;
        const t = k / steps;
        const off = size * Math.sin(phase + t * turns * 2 * Math.PI) * Math.sin(Math.PI * t);
        const th = a.th + dth * t + sideTh * off;
        const phi = a.phi + dphi * t + (sidePhi * off) / Math.max(0.2, Math.sin(th));
        out.push({
          phi0: wrap(prevPhi),
          phi1: wrap(prevPhi) + (phi - prevPhi),
          th0: prevTh,
          th1: th,
          width,
          deep: false,
          vein,
          depth,
          age: 60,
          mesh: true,
        });
        prevPhi = phi;
        prevTh = th;
      }
    }
  }
};

const wrap = (phi: number) => Math.atan2(Math.sin(phi), Math.cos(phi));

export interface VesselCanvasSize {
  width: number;
  height: number;
}

/**
 * Paint the vessels' optical depth: arteries into red, veins into blue, sharp where they lie
 * near the surface; the deep share of each, and the episcleral vessels, into green, softened.
 * Each vessel is stroked as long runs of one path, and strokes combine by taking the brighter,
 * so joins never double up into beads. Rows run from the limbus at y = 0 to the back pole at
 * y = height. `sharp` and `soft` are scratch canvases: full size, and smaller (it is blurred by
 * scaling).
 */
export const paintVessels = (
  g: CanvasRenderingContext2D,
  sharp: CanvasRenderingContext2D,
  soft: CanvasRenderingContext2D,
  size: VesselCanvasSize,
  segments: readonly VesselSegment[],
  iris: number,
): void => {
  const { width: W, height: H } = size;
  const rows = H / (Math.PI - iris);
  const cols = W / (2 * Math.PI);
  const clear = (c: CanvasRenderingContext2D) => {
    c.globalCompositeOperation = "source-over";
    c.filter = "none";
    c.fillStyle = "#000";
    c.fillRect(0, 0, c.canvas.width, c.canvas.height);
    c.globalCompositeOperation = "lighten";
    c.lineCap = "round";
    c.lineJoin = "round";
  };
  clear(sharp);
  clear(soft);
  const sw = soft.canvas.width / W;
  const sh = soft.canvas.height / H;
  const level = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);

  interface Style {
    /** Core width in texels, and how strong the core, its halo and its soft share are. */
    width: number;
    near: number;
    under: number;
    deep: boolean;
    vein: boolean;
  }
  const styleOf = (s: VesselSegment): Style => {
    const th = (s.th0 + s.th1) / 2;
    // Width across a vessel running towards the iris is along the row, which shrinks by sin θ.
    const across = (s.width * cols) / Math.max(0.2, Math.sin(th));
    const fadeIn = Math.min(1, s.age / (s.deep ? 15 : 45));
    // Wider vessels hold far more blood, so fine ones are faint; thinner than a pixel is drawn a
    // pixel wide but fainter still.
    const blood = 0.08 + 0.9 * Math.min(1, s.width / 0.008) ** 1.5;
    const strength = fadeIn * blood * Math.min(1, across / 0.8);
    if (s.deep) return { width: across, near: 0, under: strength * 0.6, deep: true, vein: true };
    return {
      width: across,
      near: strength * (1 - s.depth) ** 1.5,
      under: strength * (0.25 + 0.6 * s.depth),
      deep: false,
      vein: s.vein,
    };
  };
  const close = (a: number, b: number) => Math.abs(a - b) <= 0.12 * Math.max(a, b) + 0.004;

  let run: { xs: number[]; ys: number[]; style: Style } | null = null;
  const flush = () => {
    if (!run || run.xs.length < 2) return;
    const { xs, ys, style } = run;
    const path = (
      ctx: CanvasRenderingContext2D,
      kx: number,
      ky: number,
      width: number,
      color: string,
    ) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      let lo = Infinity;
      let hi = -Infinity;
      for (const v of xs) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      // A run may cross the picture's left or right edge; draw it again a width over.
      for (const dx of [-W, 0, W]) {
        if (hi + dx < -width / kx || lo + dx > W + width / kx) continue;
        ctx.beginPath();
        ctx.moveTo((xs[0]! + dx) * kx, ys[0]! * ky);
        for (let i = 1; i < xs.length; i++) ctx.lineTo((xs[i]! + dx) * kx, ys[i]! * ky);
        ctx.stroke();
      }
    };
    if (style.deep) {
      path(soft, sw, sh, Math.max(0.8, style.width * sw), `rgb(0,${level(style.under)},0)`);
      return;
    }
    const w = Math.max(0.8, style.width);
    const rgb = (v: number) => (style.vein ? `rgb(0,0,${level(v)})` : `rgb(${level(v)},0,0)`);
    // A faint wider halo, then the core.
    path(sharp, 1, 1, w * 2.4, rgb(style.near * 0.18));
    path(sharp, 1, 1, w, rgb(style.near));
    if (style.under > 0.02) {
      // Every vessel also tints the conjunctiva round it a little, as a soft flush.
      path(soft, sw, sh, Math.max(0.8, style.width * 2.5 * sw), `rgb(0,${level(style.under)},0)`);
    }
  };

  let last: VesselSegment | null = null;
  for (const s of segments) {
    const style = styleOf(s);
    const joined =
      last !== null &&
      Math.abs(wrap(last.phi1) - s.phi0) < 1e-9 &&
      Math.abs(last.th1 - s.th0) < 1e-9 &&
      run !== null &&
      run.style.deep === style.deep &&
      run.style.vein === style.vein &&
      close(run.style.width, style.width) &&
      close(run.style.near, style.near) &&
      close(run.style.under, style.under);
    if (joined && run) {
      const px = run.xs[run.xs.length - 1]!;
      run.xs.push(px + (s.phi1 - s.phi0) * cols);
      run.ys.push((s.th1 - iris) * rows);
    } else {
      flush();
      // A new run starts where the last ended, if they join, so there is no gap.
      const x0 = (s.phi0 + Math.PI) * cols;
      run = {
        xs: [x0, x0 + (s.phi1 - s.phi0) * cols],
        ys: [(s.th0 - iris) * rows, (s.th1 - iris) * rows],
        style,
      };
    }
    last = s;
  }
  flush();

  clear(g);
  // Soften the sharp layer a touch, as if seen through the conjunctiva, and spread the soft one.
  g.filter = "blur(1.4px)";
  g.drawImage(sharp.canvas, 0, 0);
  g.filter = "none";
  g.imageSmoothingEnabled = true;
  g.drawImage(soft.canvas, 0, 0, W, H);
  g.globalCompositeOperation = "source-over";
};
