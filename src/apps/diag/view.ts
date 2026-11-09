import type { Palette } from "../../core/types";
import type { Tone } from "./probes";

export interface Field {
  set(text: string, tone?: Tone): void;
  chips(items: readonly { text: string; tone: Tone }[]): void;
}

export interface Section {
  row(label: string): Field;
  canvas(className: string): HTMLCanvasElement;
  table(headers: readonly string[]): Table;
}

export interface TableRow {
  cells: readonly string[];
  tone?: Tone;
  strong?: boolean;
}

export interface Table {
  setRows(rows: readonly TableRow[]): void;
}

export interface DiagView {
  readonly el: HTMLElement;
  section(title: string): Section;
  header(title: string, sub: string): void;
  /** The live touch count, beside the title so it never covers it. */
  touches(now: number, max: number): void;
  alert(text: string | null): void;
  /**
   * Set the largest font (venue px times `unit`) at which every section fits the frame,
   * and return that size in venue px.
   */
  fit(unit: number, venueWidth: number, gridPx: number): number;
  /** True when the text has outgrown the frame since the last fit. */
  overflowing(): boolean;
}

/** Text sizes in venue px. Each column is about this many ems wide. */
const MIN_SIZE = 14;
const MAX_SIZE = 120;
const FALLBACK_SIZE = 32;
const COLUMN_EM = 18;

const css = (p: Palette) => `
.dg{position:absolute;inset:0;overflow:hidden;color:${p.foreground};font-family:system-ui,sans-serif;}
.dg-cols{position:absolute;inset:0;padding:1.2em;column-gap:1.2em;line-height:1.32;
font-variant-numeric:tabular-nums;}
.dg-head{column-span:all;margin:0 0 0.5em;}
.dg-top{display:flex;flex-wrap:wrap;align-items:baseline;gap:0 0.8em;}
.dg-title{flex:1 1 auto;font-size:1.7em;font-weight:700;line-height:1.15;}
.dg-touches{font-size:1.3em;font-weight:700;white-space:nowrap;color:${p.muted};}
.dg-sub{color:${p.muted};}
.dg-alert{display:inline-block;margin-top:0.2em;padding:0 0.4em;border-radius:0.2em;
background:${p.danger};color:#000;font-weight:700;}
.dg-alert[hidden]{display:none;}
.dg section{break-inside:avoid;margin:0 0 0.7em;padding:0.3em 0.5em 0.4em;border-radius:0.3em;
background:rgba(21,26,38,0.78);}
.dg h2{margin:0 0 0.15em;font-size:0.82em;font-weight:700;color:${p.accent};}
.dg-dl{display:grid;grid-template-columns:auto 1fr;gap:0 0.6em;}
.dg-k{color:${p.muted};white-space:nowrap;}
.dg-v{overflow-wrap:anywhere;}
.dg [data-tone=good]{color:#38d39f;}
.dg [data-tone=warn]{color:${p.accent};}
.dg [data-tone=bad]{color:${p.danger};}
.dg-chip{display:inline-block;margin:0 0.3em 0.1em 0;padding:0 0.3em;border-radius:0.2em;
border:0.06em solid currentColor;}
.dg table{width:100%;margin-top:0.3em;border-collapse:collapse;font-size:0.78em;}
.dg th{text-align:left;color:${p.muted};font-weight:600;}
.dg td,.dg th{padding:0 0.5em 0 0;white-space:nowrap;}
.dg td.dg-strong{font-weight:700;}
.dg-spark{display:block;width:100%;height:2.4em;margin-top:0.25em;}
.dg-overlay{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;}
`;

const make = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text?: string,
): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};

const field = (value: HTMLElement): Field => {
  let last = "";
  return {
    set(text, tone = "plain") {
      const key = `${tone}|${text}`;
      if (key === last) return;
      last = key;
      value.textContent = text;
      value.dataset.tone = tone;
    },
    chips(items) {
      const key = `chips|${items.map((i) => `${i.tone}:${i.text}`).join(",")}`;
      if (key === last) return;
      last = key;
      value.dataset.tone = "plain";
      if (items.length === 0) {
        value.textContent = "none";
        return;
      }
      value.replaceChildren(
        ...items.map((i) => {
          const chip = make("span", "dg-chip", i.text);
          chip.dataset.tone = i.tone;
          return chip;
        }),
      );
    },
  };
};

export const createView = (host: HTMLElement, palette: Palette): DiagView => {
  const el = make("div", "dg");
  const style = make("style");
  style.textContent = css(palette);
  const cols = make("div", "dg-cols");
  const head = make("div", "dg-head");
  const title = make("div", "dg-title");
  const sub = make("div", "dg-sub");
  const alertEl = make("div", "dg-alert");
  alertEl.hidden = true;
  const touchEl = make("div", "dg-touches");
  const top = make("div", "dg-top");
  top.append(title, touchEl);
  head.append(top, sub, alertEl);
  cols.append(head);
  el.append(style, cols);
  host.append(el);

  // Overflowing columns spill sideways, so the text fits when nothing scrolls.
  const overflowing = () =>
    cols.scrollWidth > cols.clientWidth + 1 || cols.scrollHeight > cols.clientHeight + 1;

  return {
    el,
    section(heading) {
      const s = make("section");
      const dl = make("div", "dg-dl");
      s.append(make("h2", "", heading), dl);
      cols.append(s);
      return {
        row(label) {
          const value = make("span", "dg-v", "-");
          dl.append(make("span", "dg-k", label), value);
          return field(value);
        },
        canvas(className) {
          const c = make("canvas", className);
          s.append(c);
          return c;
        },
        table(headers) {
          const table = make("table");
          const headRow = make("tr");
          for (const h of headers) headRow.append(make("th", "", h));
          const thead = make("thead");
          thead.append(headRow);
          const tbody = make("tbody");
          table.append(thead, tbody);
          s.append(table);
          let last = "";
          return {
            setRows(rows) {
              const key = JSON.stringify(rows);
              if (key === last) return;
              last = key;
              tbody.replaceChildren(
                ...rows.map((r) => {
                  const tr = make("tr");
                  if (r.tone) tr.dataset.tone = r.tone;
                  for (const cell of r.cells) {
                    tr.append(make("td", r.strong ? "dg-strong" : "", cell));
                  }
                  return tr;
                }),
              );
            },
          };
        },
      };
    },
    header(t, s) {
      if (title.textContent !== t) title.textContent = t;
      if (sub.textContent !== s) sub.textContent = s;
    },
    touches(now, max) {
      const text = `${now} touching · max ${max}`;
      if (touchEl.textContent === text) return;
      touchEl.textContent = text;
      touchEl.dataset.tone = now > 0 ? "good" : "plain";
    },
    alert(text) {
      alertEl.hidden = text === null;
      if (text !== null && alertEl.textContent !== text) alertEl.textContent = text;
    },
    fit(unit, venueWidth, gridPx) {
      const apply = (size: number) => {
        cols.style.fontSize = `${size * unit}px`;
        const columns = Math.floor((venueWidth - 2.4 * size) / (size * COLUMN_EM));
        cols.style.columnCount = String(Math.max(1, columns));
      };
      let best = FALLBACK_SIZE;
      if (cols.clientWidth > 0) {
        let lo = MIN_SIZE;
        let hi = MAX_SIZE;
        best = MIN_SIZE;
        while (lo <= hi) {
          const mid = Math.floor((lo + hi) / 2);
          apply(mid);
          if (!overflowing()) {
            best = mid;
            lo = mid + 1;
          } else {
            hi = mid - 1;
          }
        }
      }
      apply(best);
      // A faint grid at the minimum touch target size, for judging targets by eye.
      el.style.backgroundImage =
        "linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px)," +
        "linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px)";
      el.style.backgroundSize = `${gridPx}px ${gridPx}px`;
      el.style.backgroundPosition = "0 100%";
      return best;
    },
    overflowing,
  };
};
