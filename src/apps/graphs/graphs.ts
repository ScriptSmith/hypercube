import type { GraphDef } from "./types";

// Every `data/<id>.ts` default-exports one graph; `*.icons.ts` hold their drawings.
const found = import.meta.glob(["./data/*.ts", "!./data/*.icons.ts"], { eager: true });

export const GRAPHS: readonly GraphDef[] = Object.values(found)
  .map((m) => (m as { default?: GraphDef }).default)
  .filter((g): g is GraphDef => g !== undefined && typeof g.id === "string")
  .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

export const graphById = (id: string): GraphDef => GRAPHS.find((g) => g.id === id) ?? GRAPHS[0]!;

/** The graph after `id`, wrapping round. */
export const nextGraph = (id: string): GraphDef => {
  const i = GRAPHS.findIndex((g) => g.id === id);
  return GRAPHS[(i + 1) % GRAPHS.length]!;
};
