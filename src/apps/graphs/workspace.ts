import { iconSvg } from "./icons";
import { arrange, place, placeFixed, type Direction } from "./layout";
import type { LayoutChoice } from "./layouts";
import type { GraphDef } from "./types";

type Cell = string | number | null;
type Column = { name: string; type: "text" | "number" | "bool" };

const text = (...names: string[]): Column[] => names.map((name) => ({ name, type: "text" }));

/**
 * A graph as Network Graph Viewer's workspace JSON (its `.ngv.json` format), sent to the
 * embedded viewer with a `load` message. Nodes wear their icon and the colour of their role,
 * and every node is pinned where `place` put it, so the picture is a food chain from bottom to
 * top (or left to right) rather than a force layout that moves.
 */
export interface WorkspaceRegion {
  /** The viewer's size in its own CSS px. */
  width: number;
  height: number;
  direction: Direction;
}

export function buildWorkspace(
  def: GraphDef,
  region: WorkspaceRegion,
  choice?: LayoutChoice,
): string {
  const { points, radius } =
    def.layout === "fixed"
      ? placeFixed(new Map(def.nodes.map((n) => [n.id, n.pos ?? { x: 0, y: 0 }])), region)
      : place(
          arrange(
            def.nodes.map((n) => n.id),
            def.edges,
          ),
          region,
          region.direction,
        );
  const color = new Map(def.roles.map((r) => [r.id, r.color]));
  const roleTitle = new Map(def.roles.map((r) => [r.id, r.title]));
  const nodeRows = def.nodes.map((n) => {
    const c = color.get(n.role) ?? "#888888";
    return {
      Id: n.id,
      Name: n.name,
      Role: roleTitle.get(n.role) ?? n.role,
      Colour: c,
      Icon: iconSvg(def.icons[n.icon] ?? (() => ""), c),
      Size: Math.round(radius),
    } satisfies Record<string, Cell>;
  });
  const edgeRows = def.edges.map(([From, To]) => ({ From, To }));
  const positions: Record<string, { x: number; y: number }> = {};
  for (const [id, p] of points) positions[id] = { x: Math.round(p.x), y: Math.round(p.y) };

  const workspace = {
    format: "network-graph-viewer",
    version: 1,
    doc: {
      name: def.title,
      edges: { name: "Links", columns: text("From", "To"), rows: edgeRows },
      nodes: {
        name: "Nodes",
        columns: [
          ...text("Id", "Name", "Role", "Colour", "Icon"),
          { name: "Size", type: "number" },
        ],
        rows: nodeRows,
      },
      nodeIdColumn: "Id",
      mapping: { source: "From", target: "To", attrs: [], nodeAttrs: ["Role"] },
      nodesDeclared: true,
    },
    style: {
      nodeColor: "cell:Colour",
      nodeSize: "cell:Size",
      nodeImage: "column:Icon",
      nodeLabel: "column:Name",
      edgeWidth: "uniform",
      edgeColor: "uniform",
      arrows: def.directed !== false,
      spacing: 1,
    },
    chain: [],
    layout: choice?.viewer ?? "force",
    layoutParams: {},
    showIsolated: true,
    preventOverlap: false,
    // Saved positions would be taken as the finished picture, so an algorithm gets none.
    positions: choice?.viewer ? {} : positions,
    // Pinned nodes stay where they are whatever the layout, so only the original picture pins.
    ...(choice?.viewer ? {} : { pinned: def.nodes.map((n) => n.id) }),
  };
  return JSON.stringify(workspace);
}
