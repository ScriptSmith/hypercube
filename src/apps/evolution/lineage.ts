/**
 * The family tree: every living fish and those of its ancestors still worth drawing. A fish that
 * dies with no living descendants leaves the tree at once (its line vanishes). Ancestors whose
 * last child hatched longer ago than the horizon are dropped too, so their descendants' lines
 * simply run off the top; and if the tree still holds more than its cap, the oldest dead
 * ancestors go first. So the tree stays bounded however long the pond runs.
 *
 * `parent` 0 means a founder (no parent at all). A parent id the tree doesn't hold means
 * unknown or forgotten ancestry, drawn as a line running off the top.
 */
import { type Genes, lineColor } from "./genes";

export interface NodeRec {
  id: number;
  parent: number;
  /** Shared-clock ms. */
  born: number;
  genes: Genes;
}

export interface TreeNode extends NodeRec {
  /** Shared-clock ms of death, or null while alive. */
  died: number | null;
  color: string;
  /** Kept children, oldest first; rebuilt by `prune`. */
  kids: TreeNode[];
  /** Latest birth among kept children (alive: now), shared-clock ms; set by `prune`. */
  last: number;
  /** Living descendants, itself included; set by `layoutTree`. */
  leaves: number;
  /** Column and order of a living fish's tip, set by the owner before layout. */
  col: number;
  order: number;
  /** Laid-out x (target) and drawn x (eased towards it), in the drawing's units. */
  tx: number;
  x: number;
  /** False until the node has been drawn once (its x then starts at its parent's). */
  placed: boolean;
  mark: number;
}

export interface Lineage {
  readonly size: number;
  get(id: number): TreeNode | undefined;
  has(id: number): boolean;
  /**
   * Add a fish (alive) or an ancestor (dead). The same id with the same parent and a birth within
   * a second is the same fish (kept, and marked alive if `alive`); otherwise it is replaced.
   */
  add(rec: NodeRec, alive: boolean): TreeNode;
  /** A fish died at `t`. It stays while it has living descendants. */
  kill(id: number, t: number): void;
  /** A fish known dead turns out to be alive (a migrant claimed by another frame). */
  revive(id: number): void;
  nodes(): IterableIterator<TreeNode>;
  /**
   * Drop dead lines with no living descendants (returned, for fading out), then ancestors whose
   * last child is older than `horizon` ms, then the oldest dead ancestors over `cap`. Rebuilds
   * `kids` and `last`.
   */
  prune(now: number, horizon: number, cap: number): TreeNode[];
  delete(id: number): void;
  clear(): void;
}

const SAME_BIRTH_MS = 1000;

export const createLineage = (): Lineage => {
  const nodes = new Map<number, TreeNode>();
  let pass = 0;
  const removed: TreeNode[] = [];
  const old: TreeNode[] = [];

  const make = (rec: NodeRec, alive: boolean): TreeNode => ({
    id: rec.id,
    parent: rec.parent,
    born: rec.born,
    genes: rec.genes,
    died: alive ? null : rec.born,
    color: lineColor(rec.genes),
    kids: [],
    last: rec.born,
    leaves: 0,
    col: 0,
    order: 0,
    tx: 0,
    x: 0,
    placed: false,
    mark: 0,
  });

  return {
    get size() {
      return nodes.size;
    },
    get: (id) => nodes.get(id),
    has: (id) => nodes.has(id),
    add(rec, alive) {
      const had = nodes.get(rec.id);
      // Births travel as ages rounded to a tenth of a second, so the same fish can arrive with a
      // slightly different birth time; only a real difference means another fish.
      if (had && had.parent === rec.parent && Math.abs(had.born - rec.born) < SAME_BIRTH_MS) {
        if (alive) had.died = null;
        return had;
      }
      const n = make(rec, alive);
      nodes.set(rec.id, n);
      return n;
    },
    kill(id, t) {
      const n = nodes.get(id);
      if (n && n.died === null) n.died = Math.max(n.born, t);
    },
    revive(id) {
      const n = nodes.get(id);
      if (n) n.died = null;
    },
    nodes: () => nodes.values(),
    prune(now, horizon, cap) {
      pass++;
      for (const n of nodes.values()) {
        if (n.died !== null) continue;
        let at: TreeNode | undefined = n;
        while (at && at.mark !== pass) {
          at.mark = pass;
          at = at.parent > 0 ? nodes.get(at.parent) : undefined;
        }
      }
      removed.length = 0;
      for (const n of nodes.values()) if (n.mark !== pass) removed.push(n);
      for (const n of removed) nodes.delete(n.id);

      for (const n of nodes.values()) n.last = n.died === null ? now : n.born;
      for (const n of nodes.values()) {
        const p = n.parent > 0 ? nodes.get(n.parent) : undefined;
        if (p && p.died !== null && n.born > p.last) p.last = n.born;
      }
      const limit = now - horizon;
      old.length = 0;
      for (const n of nodes.values()) {
        if (n.died === null) continue;
        if (n.last < limit) nodes.delete(n.id);
        else old.push(n);
      }
      if (nodes.size > cap) {
        old.sort((a, b) => a.last - b.last);
        for (const n of old) {
          if (nodes.size <= cap) break;
          nodes.delete(n.id);
        }
      }

      for (const n of nodes.values()) n.kids.length = 0;
      for (const n of nodes.values()) {
        const p = n.parent > 0 ? nodes.get(n.parent) : undefined;
        if (p) p.kids.push(n);
      }
      // Cutting old ancestors can leave a dead line whose children were all cut: drop it too.
      old.length = 0;
      for (const n of nodes.values()) if (n.died !== null && n.kids.length === 0) old.push(n);
      while (old.length > 0) {
        const n = old.pop()!;
        nodes.delete(n.id);
        const p = n.parent > 0 ? nodes.get(n.parent) : undefined;
        if (!p) continue;
        const i = p.kids.indexOf(n);
        if (i >= 0) p.kids.splice(i, 1);
        if (p.died !== null && p.kids.length === 0) old.push(p);
      }
      for (const n of nodes.values()) {
        if (n.kids.length > 1) n.kids.sort((a, b) => a.born - b.born || a.id - b.id);
      }
      return removed;
    },
    delete(id) {
      nodes.delete(id);
    },
    clear() {
      nodes.clear();
      removed.length = 0;
      old.length = 0;
    },
  };
};

/** Ancestors of a node, nearest first, at most `max`. */
export const ancestorsOf = (lin: Lineage, id: number, max: number): TreeNode[] => {
  const out: TreeNode[] = [];
  let p = lin.get(id);
  while (p && p.parent > 0 && out.length < max) {
    p = lin.get(p.parent);
    if (p) out.push(p);
  }
  return out;
};

/** Roots: nodes whose parent the tree doesn't hold, oldest first. Valid after `prune`. */
const rootsOf = (lin: Lineage, out: TreeNode[]): TreeNode[] => {
  out.length = 0;
  for (const n of lin.nodes()) if (!(n.parent > 0 && lin.has(n.parent))) out.push(n);
  out.sort((a, b) => a.born - b.born || a.id - b.id);
  return out;
};

/**
 * Tip order for living fish: a walk of the tree that keeps each family's tips together, with a
 * living parent's own tip among its children's. Sets `order` on every living node (0, 1, 2 ...
 * over the whole tree; the caller spreads each column's tips in this order). Valid after `prune`.
 */
export const orderTips = (lin: Lineage): void => {
  const roots = rootsOf(lin, []);
  let next = 0;
  const visit = (n: TreeNode) => {
    const alive = n.died === null;
    const mid = Math.floor(n.kids.length / 2);
    for (let i = 0; i < n.kids.length; i++) {
      if (alive && i === mid) n.order = next++;
      visit(n.kids[i]!);
    }
    if (alive && mid >= n.kids.length) n.order = next++;
  };
  for (const r of roots) visit(r);
};

export interface Columns {
  /** Left and right of each column's tip range, in drawing units. */
  x0: readonly number[];
  x1: readonly number[];
}

/**
 * Lay out the tree: each column's living tips spread evenly in `order`, a living fish's line at
 * its tip, and a dead ancestor's line at the mean of its kept children's lines. Sets `tx` and
 * `leaves`. Valid after `prune`.
 */
export const layoutTree = (lin: Lineage, cols: Columns): void => {
  const byCol: TreeNode[][] = cols.x0.map(() => []);
  for (const n of lin.nodes()) {
    n.leaves = 0;
    if (n.died !== null) continue;
    const c = Math.min(byCol.length - 1, Math.max(0, n.col));
    byCol[c]?.push(n);
  }
  byCol.forEach((list, c) => {
    list.sort((a, b) => a.order - b.order || a.id - b.id);
    const x0 = cols.x0[c] ?? 0;
    const x1 = cols.x1[c] ?? x0;
    const n = list.length;
    list.forEach((node, i) => {
      node.tx = x0 + ((i + 0.5) / n) * (x1 - x0);
    });
  });
  const roots = rootsOf(lin, []);
  const post = (n: TreeNode): void => {
    let sum = 0;
    let leaves = n.died === null ? 1 : 0;
    for (const k of n.kids) {
      post(k);
      sum += k.tx;
      leaves += k.leaves;
    }
    n.leaves = leaves;
    if (n.died !== null && n.kids.length > 0) n.tx = sum / n.kids.length;
  };
  for (const r of roots) post(r);
};
