/**
 * What is lit up. A mode press lights every vehicle of that mode and their lines for MODE_MS; a
 * line press lights one featured line for LINE_MS (and the camera follows one of its vehicles).
 * Either replaces the other. Picks are lines kiosks chose, shown on a wall in each kiosk's colour
 * for PICK_MS without touching its camera.
 */
import { type Line, lineById, type Mode } from "./routes";

export const MODE_MS = 20_000;
export const LINE_MS = 30_000;
export const PICK_MS = 60_000;
const MAX_PICKS = 4;

export type Focus =
  | { kind: "mode"; mode: Mode; until: number; since: number }
  | { kind: "line"; line: Line; until: number; since: number };

export interface Pick {
  line: Line;
  /** Palette index of the kiosk that chose it. */
  color: number;
  until: number;
}

export interface Highlights {
  readonly focus: Focus | null;
  readonly picks: ReadonlyMap<string, Pick>;
  mode(mode: Mode, now: number): void;
  line(id: string, now: number): Line | null;
  pick(from: string, id: string, color: number, now: number): void;
  /** Drop what has run out; true when anything changed. */
  expire(now: number): boolean;
  clear(): void;
  /** How a route base is lit: by the focus, by a pick, or not at all. */
  litBy(route: string, mode: Mode): { focus: boolean; pick: Pick | null };
  /** Changes every time something is lit or unlit, for redrawing lines only then. */
  readonly version: number;
  setTiming(t: { mode?: number; line?: number; pick?: number }): void;
}

export const createHighlights = (): Highlights => {
  let focus: Focus | null = null;
  const picks = new Map<string, Pick>();
  let version = 0;
  let modeMs = MODE_MS;
  let lineMs = LINE_MS;
  let pickMs = PICK_MS;
  return {
    get focus() {
      return focus;
    },
    picks,
    mode(mode, now) {
      focus = { kind: "mode", mode, until: now + modeMs, since: now };
      version++;
    },
    line(id, now) {
      const line = lineById(id);
      if (!line) return null;
      focus = { kind: "line", line, until: now + lineMs, since: now };
      version++;
      return line;
    },
    pick(from, id, color, now) {
      const line = lineById(id);
      if (!line) return;
      picks.delete(from);
      if (picks.size >= MAX_PICKS) {
        const oldest = [...picks.entries()].sort((a, b) => a[1].until - b[1].until)[0];
        if (oldest) picks.delete(oldest[0]);
      }
      picks.set(from, { line, color, until: now + pickMs });
      version++;
    },
    expire(now) {
      let changed = false;
      if (focus && now >= focus.until) {
        focus = null;
        changed = true;
      }
      for (const [k, p] of picks) {
        if (now >= p.until) {
          picks.delete(k);
          changed = true;
        }
      }
      if (changed) version++;
      return changed;
    },
    clear() {
      if (!focus && picks.size === 0) return;
      focus = null;
      picks.clear();
      version++;
    },
    litBy(route, mode) {
      const f = focus;
      const byFocus = !!f && (f.kind === "mode" ? f.mode === mode : f.line.has(route));
      let pick: Pick | null = null;
      for (const p of picks.values()) {
        if (p.line.has(route)) {
          pick = p;
          break;
        }
      }
      return { focus: byFocus, pick };
    },
    get version() {
      return version;
    },
    setTiming(t) {
      if (t.mode !== undefined) modeMs = t.mode;
      if (t.line !== undefined) lineMs = t.line;
      if (t.pick !== undefined) pickMs = t.pick;
    },
  };
};
