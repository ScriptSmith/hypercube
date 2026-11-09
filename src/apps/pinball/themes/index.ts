/**
 * Every theme, by variant id. A theme is a folder here (rules in `index.ts`, look in `look.ts`),
 * listed in this file and looks.ts.
 */
import { buildTable, type TableLayout } from "../layout";
import type { ThemeId } from "../config";
import type { ToyHost, Toys } from "../toys";
import fair from "./fair";
import reef from "./reef";
import space from "./space";
import type { ThemeRules } from "./types";
import volcano from "./volcano";

export const THEME_RULES: Record<ThemeId, ThemeRules> = {
  space: space as ThemeRules,
  reef: reef as ThemeRules,
  volcano: volcano as ThemeRules,
  fair: fair as ThemeRules,
};

/** A table's layout for a theme (classic when null), and the factory for its toys. */
export const tableFor = (
  theme: ThemeId | null,
  mirror: boolean,
): { layout: TableLayout; toys?: (host: ToyHost) => Toys } => {
  const rules = theme ? THEME_RULES[theme] : null;
  if (!rules) return { layout: buildTable({ mirror }) };
  const layout = buildTable({ mirror, middle: rules.middle, theme: rules.id });
  return { layout, toys: (host) => rules.toys(host, layout.middle) };
};
