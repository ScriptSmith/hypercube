import type { OptionValue, RosterEntry } from "../types";
import type { FrameState } from "./agent";
import { sideName, type Target } from "./target";

/** Roster members running this app are admin consoles (the /admin/ page), not frames. */
export const ADMIN_APP = "admin";

export interface FrameRow {
  /** Unique per roster entry, even when two frames claim one id. */
  key: string;
  frame: string;
  label: string;
  kind: string;
  role: string;
  app: string;
  variant: string;
  zone: string | null;
  group: string;
  /** Side of a two-sided setup, or null when the frame is not in one. */
  side: number | null;
  pos: number;
  count: number | null;
  rtt: number | null;
  duplicate: boolean;
  hub: boolean;
  self: boolean;
  override: boolean;
  errors: number;
  lastError: string;
  fps: number | null;
  uptime: number | null;
  /** Ms since the last touch, -1 for never, null when unknown. */
  touchAgo: number | null;
}

export interface SideGroup {
  side: number | null;
  rows: FrameRow[];
}

export interface ZoneGroup {
  zone: string | null;
  sides: SideGroup[];
}

export interface RosterView {
  zones: ZoneGroup[];
  /** Every frame row in display order. */
  rows: FrameRow[];
  consoles: RosterEntry[];
}

export interface Selector {
  id: string;
  label: string;
  target: Target;
}

const num = (v: OptionValue | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const text = (v: OptionValue | undefined): string => (typeof v === "string" ? v : "");

const twoSided = (setup: string | undefined) => setup === "corner" || setup === "versus";

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

const byZone = (a: string | null, b: string | null): number =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : collator.compare(a, b);

export const buildRows = (
  roster: readonly RosterEntry[],
  states: ReadonlyMap<string, FrameState>,
  opts: { hub: string | null; self: string; now: number },
): RosterView => {
  const rows: FrameRow[] = [];
  const consoles: RosterEntry[] = [];
  for (const e of roster) {
    if (e.app === ADMIN_APP) {
      consoles.push(e);
      continue;
    }
    const st = states.get(e.frame);
    const s = e.status ?? {};
    const lastTouch = num(s.lastTouch);
    const side =
      st && twoSided(st.setup)
        ? st.side
        : !st && e.side !== undefined && e.side > 0
          ? e.side
          : null;
    rows.push({
      key: `${e.frame}@${e.joinedAt}`,
      frame: e.frame,
      label: st?.name || e.display || e.frame,
      kind: e.kind,
      role: e.role,
      app: text(s.app) || e.app,
      variant: text(s.variant),
      zone: e.zone ?? null,
      group: e.group,
      side,
      pos: e.pos,
      count: st?.count ?? null,
      rtt: e.rtt ?? null,
      duplicate: e.duplicate === true,
      hub: opts.hub === e.frame,
      self: opts.self === e.frame,
      override: s.override === true,
      // Console errors as well as uncaught ones, when the frame reports them.
      errors: num(s.logErrors) ?? num(s.errors) ?? 0,
      lastError: text(s.lastError),
      fps: num(s.fps),
      uptime: num(s.uptime),
      touchAgo:
        lastTouch === null ? null : lastTouch === 0 ? -1 : Math.max(0, opts.now - lastTouch),
    });
  }
  rows.sort(
    (a, b) =>
      byZone(a.zone, b.zone) ||
      (a.side ?? -1) - (b.side ?? -1) ||
      collator.compare(a.group, b.group) ||
      Number(a.role !== "screen") - Number(b.role !== "screen") ||
      a.pos - b.pos ||
      collator.compare(a.label, b.label) ||
      collator.compare(a.key, b.key),
  );

  const zones: ZoneGroup[] = [];
  for (const row of rows) {
    let zone = zones.at(-1);
    if (!zone || zone.zone !== row.zone) {
      zone = { zone: row.zone, sides: [] };
      zones.push(zone);
    }
    let side = zone.sides.at(-1);
    if (!side || side.side !== row.side) {
      side = { side: row.side, rows: [] };
      zone.sides.push(side);
    }
    side.rows.push(row);
  }
  return { zones, rows, consoles };
};

/** Quick selections: all frames, then each group, zone, side and app in the roster. */
export const buildSelectors = (rows: readonly FrameRow[]): Selector[] => {
  const out: Selector[] = [{ id: "all", label: "All", target: { k: "all" } }];
  const seen = new Set<string>();
  const add = (s: Selector) => {
    if (seen.has(s.id)) return;
    seen.add(s.id);
    out.push(s);
  };
  const sorted = (values: Iterable<string>) => [...new Set(values)].sort(collator.compare);
  for (const g of sorted(rows.map((r) => r.group))) {
    add({ id: `group:${g}`, label: `Group ${g}`, target: { k: "group", group: g } });
  }
  for (const z of sorted(rows.flatMap((r) => (r.zone === null ? [] : [r.zone])))) {
    add({ id: `zone:${z}`, label: `Zone ${z}`, target: { k: "zone", zone: z } });
  }
  for (const r of rows) {
    if (r.side === null) continue;
    for (const side of [0, 1]) {
      add({
        id: `side:${r.group}:${side}`,
        label: `${r.group} side ${sideName(side)}`,
        target: { k: "side", side, group: r.group },
      });
    }
  }
  for (const a of sorted(rows.map((r) => r.app))) {
    add({ id: `app:${a}`, label: `Running ${a}`, target: { k: "app", app: a } });
  }
  return out;
};

/** Which rows a quick selection picks, using what the panel knows about each frame. */
export const rowsFor = (target: Target, rows: readonly FrameRow[]): FrameRow[] =>
  rows.filter((r) => {
    switch (target.k) {
      case "all":
        return true;
      case "frames":
        return target.ids.includes(r.frame);
      case "group":
        return r.group === target.group;
      case "zone":
        return r.zone === target.zone;
      case "side":
        return (
          (r.side ?? 0) === target.side && (target.group === undefined || r.group === target.group)
        );
      case "app":
        return r.app === target.app;
    }
  });

export const formatDuration = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
};

export const formatAgo = (ms: number): string => {
  if (ms < 60_000) return "under a minute ago";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
};

/** Short status facts for a row, in reading order. */
export const rowFacts = (r: FrameRow): string[] => {
  const facts: string[] = [];
  if (r.fps !== null) facts.push(`${r.fps} fps`);
  if (r.uptime !== null) facts.push(`up ${formatDuration(r.uptime)}`);
  if (r.touchAgo === -1) facts.push("no touches yet");
  else if (r.touchAgo !== null) facts.push(`touched ${formatAgo(r.touchAgo)}`);
  if (r.rtt !== null && !r.hub) facts.push(`${Math.round(r.rtt)} ms`);
  return facts;
};

export const describeRow = (r: FrameRow): string => {
  const parts = r.kind === r.role ? [r.kind] : [r.kind, r.role];
  if (r.role === "screen") {
    if (r.count) parts.push(`serves ${r.count}`);
  } else if (r.role !== "solo" || (r.count ?? 1) > 1) {
    parts.push(r.count ? `${r.pos + 1} of ${r.count}` : `pos ${r.pos + 1}`);
  }
  if (r.side !== null) parts.push(`side ${sideName(r.side)}`);
  parts.push(`group ${r.group}`);
  return parts.join(" · ");
};
