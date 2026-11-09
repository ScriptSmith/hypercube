/**
 * Where a pack view of the race looks: the stretch of course holding the most gliders (people
 * weigh more), zoomed out to half size at most, with the leaders a little right of centre so the
 * course ahead shows. Before a bank race it waits on the start line.
 */
export interface PackCam {
  /** Course x at the left edge. */
  x: number;
  /** 1 at the view's natural scale, down to 0.5. */
  zoom: number;
}

export interface PackGlider {
  /** Distance along the course, course px. */
  d: number;
  weight: number;
}

const MARGIN = 700;
export const MIN_ZOOM = 0.5;

/**
 * Ease `cam` towards the view of `list`. `viewW1` is the view's width in course px at zoom 1;
 * `start` holds it on the start line.
 */
export const stepPackCam = (
  cam: PackCam,
  list: readonly PackGlider[],
  viewW1: number,
  start: boolean,
  dt: number,
): void => {
  const maxW = viewW1 / MIN_ZOOM;
  let lo = -600;
  let hi = 600;
  if (list.length > 0 && !start) {
    const sorted = [...list].sort((a, b) => a.d - b.d);
    let best = -1;
    let j = 0;
    let sum = 0;
    for (let i = 0; i < sorted.length; i++) {
      sum += sorted[i]!.weight;
      while (sorted[i]!.d - sorted[j]!.d > maxW - MARGIN * 2) {
        sum -= sorted[j]!.weight;
        j++;
      }
      // Prefer the window further along on ties, where the leaders are.
      if (sum >= best) {
        best = sum;
        lo = sorted[j]!.d;
        hi = sorted[i]!.d;
      }
    }
  }
  const span = hi - lo + MARGIN * 2;
  const zoom = start ? 1 : Math.min(1, Math.max(MIN_ZOOM, viewW1 / span));
  const visible = viewW1 / zoom;
  const x = start ? -visible * 0.2 : (lo + hi) / 2 - visible * 0.48;
  const ease = Math.min(1, dt * 2.5);
  cam.zoom += (zoom - cam.zoom) * ease;
  cam.x += (x - cam.x) * ease;
  if (Math.abs(x - cam.x) > visible * 2) cam.x = x;
};
