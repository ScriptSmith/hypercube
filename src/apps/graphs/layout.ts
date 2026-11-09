export interface Point {
  x: number;
  y: number;
}

export type Direction = "up" | "right";

/**
 * Levels from the sources up: a node sits one level above its highest source. Edges are
 * `[from, to]`, and a cycle (which a food web should not have) would leave its members low.
 */
export function levels(ids: readonly string[], edges: readonly (readonly [string, string])[]) {
  const level = new Map(ids.map((id) => [id, 0]));
  for (let pass = 0; pass < ids.length; pass++) {
    let changed = false;
    for (const [from, to] of edges) {
      const next = (level.get(from) ?? 0) + 1;
      if (next > (level.get(to) ?? 0) && next <= ids.length) {
        level.set(to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return level;
}

/**
 * Rows of ids by level, sources first. Order within a row comes from a few barycentre sweeps,
 * which keeps most links short without a solver.
 */
export function arrange(
  ids: readonly string[],
  edges: readonly (readonly [string, string])[],
): string[][] {
  const level = levels(ids, edges);
  const top = Math.max(0, ...level.values());
  const rows: string[][] = Array.from({ length: top + 1 }, () => []);
  for (const id of ids) rows[level.get(id) ?? 0]!.push(id);

  const order = new Map<string, number>();
  const place = () => rows.forEach((row) => row.forEach((id, i) => order.set(id, i / row.length)));
  place();
  const near = (id: string, down: boolean) => {
    const links = edges
      .filter(([a, b]) => (down ? b === id : a === id))
      .map(([a, b]) => order.get(down ? a : b) ?? 0);
    return links.length ? links.reduce((s, v) => s + v, 0) / links.length : (order.get(id) ?? 0);
  };
  for (let sweep = 0; sweep < 6; sweep++) {
    const down = sweep % 2 === 0;
    const sequence = down ? rows.slice(1) : rows.slice(0, -1).reverse();
    for (const row of sequence) {
      row.sort((a, b) => near(a, down) - near(b, down));
      row.forEach((id, i) => order.set(id, i / row.length));
    }
  }
  return rows;
}

export interface Placement {
  points: Map<string, Point>;
  /** Node radius that keeps neighbours apart, in the same units as the points. */
  radius: number;
}

/**
 * Spread rows over a `width` by `height` region. "up" puts sources at the bottom and the last
 * eaters at the top; "right" puts sources on the left, for wide regions. Margins leave room
 * for the label under each node.
 */
export function place(
  rows: readonly (readonly string[])[],
  region: { width: number; height: number },
  direction: Direction,
): Placement {
  const { width: W, height: H } = region;
  const L = rows.length;
  const widest = Math.max(1, ...rows.map((r) => r.length));
  const points = new Map<string, Point>();
  let across: number;
  let along: number;
  if (direction === "up") {
    across = (W * 0.9) / widest;
    along = L > 1 ? (H * 0.76) / (L - 1) : 0;
    rows.forEach((row, l) =>
      row.forEach((id, i) =>
        points.set(id, {
          x: W / 2 + (i - (row.length - 1) / 2) * across,
          y: H * 0.88 - l * along,
        }),
      ),
    );
  } else {
    across = (H * 0.76) / widest;
    // A wide region would otherwise stretch every link across the wall.
    along = L > 1 ? Math.min((W * 0.84) / (L - 1), across * 3.4) : 0;
    rows.forEach((row, l) =>
      row.forEach((id, i) =>
        points.set(id, {
          x: W / 2 + (l - (L - 1) / 2) * along,
          y: H * 0.46 + (i - (row.length - 1) / 2) * across,
        }),
      ),
    );
  }
  const room = Math.min(across, along > 0 ? along : across);
  return { points, radius: Math.max(12, Math.min(64, room * 0.34)) };
}

/**
 * Scale given positions (y growing upwards, as on a map) into a region, aspect kept, with a
 * margin for labels. The radius keeps the two closest nodes apart.
 */
export function placeFixed(
  given: ReadonlyMap<string, Point>,
  region: { width: number; height: number },
): Placement {
  const pts = [...given.entries()];
  const xs = pts.map(([, p]) => p.x);
  const ys = pts.map(([, p]) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(1e-9, Math.max(...xs) - minX);
  const spanY = Math.max(1e-9, Math.max(...ys) - minY);
  const mx = region.width * 0.06;
  const my = region.height * 0.1;
  const k = Math.min((region.width - 2 * mx) / spanX, (region.height - 2 * my) / spanY);
  const ox = (region.width - spanX * k) / 2;
  const oy = (region.height - spanY * k) / 2;
  const points = new Map<string, Point>();
  for (const [id, p] of pts)
    points.set(id, { x: ox + (p.x - minX) * k, y: oy + (spanY - (p.y - minY)) * k });
  let nearest = Infinity;
  const all = [...points.values()];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      nearest = Math.min(nearest, Math.hypot(all[i]!.x - all[j]!.x, all[i]!.y - all[j]!.y));
    }
  }
  return { points, radius: Math.max(10, Math.min(64, nearest * 0.4)) };
}
