import type { AppContext, AppInstance } from "../../core/types";

/** Slow drifting glows. Also the fallback when another app fails to mount. */
export const mount = (ctx: AppContext): AppInstance => {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
  ctx.root.append(canvas);
  const g = canvas.getContext("2d");
  const rng = ctx.rng("idle");
  const blobs = ctx.ui.palette.players.slice(0, 5).map((color) => ({
    color,
    x: rng.next(),
    y: rng.next(),
    vx: rng.range(-0.02, 0.02),
    vy: rng.range(-0.02, 0.02),
    r: rng.range(0.25, 0.45),
  }));

  const size = () => {
    // Glows are soft, so a low-resolution backing store is enough.
    canvas.width = Math.max(1, Math.round(ctx.frame.width * 0.25));
    canvas.height = Math.max(1, Math.round(ctx.frame.height * 0.25));
  };
  size();
  ctx.onResize(size);

  const loop = ctx.loop({
    hz: 30,
    update(dt) {
      for (const b of blobs) {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.x < 0 || b.x > 1) b.vx = -b.vx;
        if (b.y < 0 || b.y > 1) b.vy = -b.vy;
      }
    },
    render() {
      if (!g) return;
      const { width: w, height: h } = canvas;
      g.globalCompositeOperation = "source-over";
      g.fillStyle = ctx.ui.palette.background;
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = "lighter";
      const scale = Math.max(w, h);
      for (const b of blobs) {
        const grad = g.createRadialGradient(b.x * w, b.y * h, 0, b.x * w, b.y * h, b.r * scale);
        grad.addColorStop(0, `${b.color}55`);
        grad.addColorStop(1, `${b.color}00`);
        g.fillStyle = grad;
        g.fillRect(0, 0, w, h);
      }
    },
  });
  loop.start();

  return {
    reset() {},
    dispose() {
      loop.stop();
      canvas.remove();
    },
  };
};
