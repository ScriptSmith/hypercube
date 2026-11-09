/**
 * What a theme brings to the 3D views: its colours, its playfield art, its toys as 3D models on
 * each table, and its skin for the upper deck. Everything not given falls back to the kit's plain
 * parts in the theme's colours (deckparts3d.ts, tableview3d.ts), so a new theme can start from
 * `plainLook` and replace one piece at a time.
 */
import { Group, type Object3D } from "three";
import type { ThemeId } from "../config";
import type { Lamp, TableLayout } from "../layout";
import type { Table } from "../table";
import type { DeckSkin } from "./deckparts3d";
import type { Kit, LookPalette } from "./kit";

/** A theme's middle on one table, in field coordinates (the layout is already mirrored). */
export interface TableModel {
  readonly root: Object3D;
  /**
   * Shape tags it draws itself. The view draws every other shape tagged "bumper" (a pop bumper),
   * "target" (a stand-up target) and "wall" (a rail); anything else is invisible unless a model
   * draws it.
   */
  readonly owns?: readonly string[];
  /** Each frame: move and light the toys from the table and its toys' state. */
  sync(t: Table, time: number, alpha: number): void;
  /** How lit a lamp is (0 to 1) and in what colour, or undefined for the view's own rule. */
  lamp?(l: Lamp, t: Table, time: number): { k: number; color?: string } | undefined;
  dispose?(): void;
}

export interface ThemeLook {
  id: ThemeId;
  palette: LookPalette;
  /**
   * Paints the playfield's art in table px, inside the playfield's outline (already clipped and
   * filled with the palette's field colours): stars, sand, rock, stripes, and the flat marks under
   * the toys. Mirrored layouts give mirrored positions; paint from them.
   */
  playfield?(g: CanvasRenderingContext2D, layout: TableLayout, color: string): void;
  /** The theme's middle on one table. */
  table(kit: Kit, layout: TableLayout, color: string): TableModel;
  /** The upper deck's skin. */
  deck: DeckSkin;
}

/** A look with nothing of its own: plain parts in the palette's colours (a new theme's start). */
export const plainLook = (id: ThemeId, palette: LookPalette, deck: DeckSkin = {}): ThemeLook => ({
  id,
  palette,
  table: () => ({ root: new Group(), sync() {} }),
  deck,
});
