import type { Rng } from "../../core/types";
import type { GraphDef } from "./types";

/**
 * The next node for the attract tour. In a directed graph it follows the links one at a time
 * and starts again from a source (a node with no incoming link) when it reaches a dead end; in
 * an undirected one it wanders to a random neighbour.
 */
export function nextOnTour(def: GraphDef, current: string | null, rng: Rng): string {
  if (def.directed === false) {
    const near = def.edges
      .filter(([a, b]) => a === current || b === current)
      .map(([a, b]) => (a === current ? b : a));
    return rng.pick(near.length > 0 ? near : def.nodes.map((n) => n.id));
  }
  const eaten = def.edges.filter(([from]) => from === current).map(([, to]) => to);
  if (current !== null && eaten.length > 0) return rng.pick(eaten);
  const targets = new Set(def.edges.map(([, to]) => to));
  const sources = def.nodes.filter((n) => !targets.has(n.id)).map((n) => n.id);
  return rng.pick(sources.length > 0 ? sources : def.nodes.map((n) => n.id));
}

/**
 * A picked node's neighbours as display names: what links into it (`inbound`) and what it
 * links to (`outbound`). Without direction every neighbour is in `outbound`.
 */
export function neighboursOf(def: GraphDef, id: string) {
  const name = new Map(def.nodes.map((n) => [n.id, n.name]));
  const label = (ids: string[]) => ids.map((i) => name.get(i) ?? i);
  const inbound = def.edges.filter(([, to]) => to === id).map(([from]) => from);
  const outbound = def.edges.filter(([from]) => from === id).map(([, to]) => to);
  return def.directed === false
    ? { inbound: [], outbound: label([...new Set([...inbound, ...outbound])]) }
    : { inbound: label(inbound), outbound: label(outbound) };
}
