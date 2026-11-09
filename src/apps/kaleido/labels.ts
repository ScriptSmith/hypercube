/** Small hour marks beside the day's layers, at the frame's left edge. */

export const hourLabel = (hour: number): string => {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve} ${h < 12 ? "am" : "pm"}`;
};

export interface HourMarks {
  /** Bands' hours and their top and bottom edges in venue px from the top. */
  show(
    marks: readonly { hour: number; top: number; bottom: number }[],
    unit: number,
    alpha: number,
  ): void;
  dispose(): void;
}

/** Bands thinner than this (venue px) get no mark, so text can't overlap. */
const MIN_BAND = 22;

export const createHourMarks = (root: HTMLElement, size: number): HourMarks => {
  const box = document.createElement("div");
  box.className = "kl-hours";
  box.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;";
  root.append(box);
  const pool: HTMLElement[] = [];
  let key = "";
  return {
    show(marks, unit, alpha) {
      const visible = alpha > 0.02 ? marks.filter((m) => m.bottom - m.top >= MIN_BAND) : [];
      const next = `${unit.toFixed(4)}|${alpha.toFixed(2)}|${visible.map((m) => `${m.hour}:${m.top.toFixed(0)}:${m.bottom.toFixed(0)}`).join(",")}`;
      if (next === key) return;
      key = next;
      while (pool.length < visible.length) {
        const el = document.createElement("div");
        el.style.cssText =
          "position:absolute;left:0;white-space:nowrap;color:rgba(255,255,255,0.7);font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-weight:600;letter-spacing:0.02em;text-shadow:0 0 0.25em rgba(0,0,0,0.9),0 0 0.6em rgba(0,0,0,0.6);transform:translateY(-50%);";
        box.append(el);
        pool.push(el);
      }
      // One size for every mark: as big as the thinnest labelled band allows.
      const thinnest = Math.min(...visible.map((m) => m.bottom - m.top));
      const fontPx = Math.max(4, Math.min(size, thinnest * 0.78) * unit);
      pool.forEach((el, i) => {
        const m = visible[i];
        if (!m) {
          el.style.display = "none";
          return;
        }
        el.style.display = "block";
        el.textContent = hourLabel(m.hour);
        el.style.fontSize = `${fontPx.toFixed(1)}px`;
        el.style.left = `${(size * 0.6 * unit).toFixed(1)}px`;
        el.style.top = `${(((m.top + m.bottom) / 2) * unit).toFixed(1)}px`;
        el.style.opacity = String(Math.min(1, alpha));
      });
    },
    dispose() {
      box.remove();
      pool.length = 0;
    },
  };
};
