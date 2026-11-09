/**
 * What a theme brings to a table's game: the middle of its playfield and its toys and rules. The
 * look (3D models, the deck's skin) is separate, in each theme's `look.ts`, so the rules load and
 * test without three.js.
 */
import type { ThemeId } from "../config";
import type { Middle } from "../layout";
import type { ToyHost, Toys } from "../toys";

export interface ThemeRules<M = unknown> {
  id: ThemeId;
  /** Builds the middle of the playfield through the builder, which mirrors it. */
  middle: Middle<M>;
  /** The toys and rules of one table, built with `middle`'s result. */
  toys(host: ToyHost, middle: M): Toys;
}
