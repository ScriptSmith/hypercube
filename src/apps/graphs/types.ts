import type { Icon } from "./icons";

export interface GraphRole {
  id: string;
  title: string;
  /** #rrggbb, worn by the node's disc and ring. */
  color: string;
}

export interface GraphNodeDef {
  id: string;
  name: string;
  role: string;
  /** A key of the graph's `icons`. */
  icon: string;
  /** One plain, true sentence shown when the node is picked. */
  note: string;
  /**
   * Where the node sits when the graph's `layout` is "fixed": x and y in any units (a map
   * can use longitude and latitude, with y growing upwards). Scaled to fit, aspect kept.
   */
  pos?: { x: number; y: number };
}

/**
 * A graph shown by the `graphs` app. Each lives in `data/<id>.ts` (default export) and is found
 * by `graphs.ts`. Edges run `[from, to]`; what that means is `edgeMeaning`.
 */
export interface GraphDef {
  id: string;
  title: string;
  blurb: string;
  /** Where it falls in the list of variants and in the idle rotation; lower comes first. */
  order: number;
  /** Shown while nothing is picked. */
  caption: string;
  /** False when links have no direction (arrows off, and `edgeMeaning.out` names all neighbours). Default true. */
  directed?: boolean;
  /**
   * "layered" (default) puts what has no incoming links at the bottom and follows the links up
   * (left to right on a wall); it needs no cycles. "fixed" uses each node's `pos`.
   */
  layout?: "layered" | "fixed";
  /** How to read a link from a node's point of view: the words before the neighbours' names. */
  edgeMeaning: { out: string; in: string };
  /** Where the facts come from, for anyone checking them. Not shown to visitors. */
  sources: string[];
  roles: GraphRole[];
  /** Original icons, one drawing per kind of node. */
  icons: Record<string, Icon>;
  nodes: GraphNodeDef[];
  edges: [from: string, to: string][];
}
