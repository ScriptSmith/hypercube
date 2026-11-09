/** Which frames an admin command is for. Each frame decides for itself whether it matches. */
export type Target =
  | { k: "all" }
  | { k: "frames"; ids: string[] }
  | { k: "group"; group: string }
  | { k: "zone"; zone: string }
  | { k: "side"; side: number; group?: string }
  | { k: "app"; app: string };

/** What a frame knows about itself when matching a target. */
export interface FrameFacts {
  frame: string;
  group: string;
  zone?: string;
  side: number;
  app: string;
}

const MAX_IDS = 128;

const str = (v: unknown, max = 128): string | null =>
  typeof v === "string" && v.length > 0 && v.length <= max ? v : null;

export const matchTarget = (t: Target, f: FrameFacts): boolean => {
  switch (t.k) {
    case "all":
      return true;
    case "frames":
      return t.ids.includes(f.frame);
    case "group":
      return t.group === f.group;
    case "zone":
      return f.zone !== undefined && t.zone === f.zone;
    case "side":
      return t.side === f.side && (t.group === undefined || t.group === f.group);
    case "app":
      return t.app === f.app;
  }
};

/** A target from the wire, with every field checked, or null. */
export const readTarget = (v: unknown): Target | null => {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  switch (o.k) {
    case "all":
      return { k: "all" };
    case "frames": {
      if (!Array.isArray(o.ids) || o.ids.length > MAX_IDS) return null;
      const ids: string[] = [];
      for (const id of o.ids) {
        const s = str(id);
        if (s === null) return null;
        ids.push(s);
      }
      return { k: "frames", ids };
    }
    case "group": {
      const group = str(o.group, 64);
      return group === null ? null : { k: "group", group };
    }
    case "zone": {
      const zone = str(o.zone, 64);
      return zone === null ? null : { k: "zone", zone };
    }
    case "side": {
      if (o.side !== 0 && o.side !== 1) return null;
      if (o.group === undefined) return { k: "side", side: o.side };
      const group = str(o.group, 64);
      return group === null ? null : { k: "side", side: o.side, group };
    }
    case "app": {
      const app = str(o.app, 64);
      return app === null ? null : { k: "app", app };
    }
    default:
      return null;
  }
};

export const sideName = (side: number): string => (side === 1 ? "B" : "A");

export const describeTarget = (t: Target): string => {
  switch (t.k) {
    case "all":
      return "all frames";
    case "frames":
      return t.ids.length === 1 ? "1 frame" : `${t.ids.length} frames`;
    case "group":
      return `group ${t.group}`;
    case "zone":
      return `zone ${t.zone}`;
    case "side":
      return t.group === undefined
        ? `side ${sideName(t.side)}`
        : `side ${sideName(t.side)} of ${t.group}`;
    case "app":
      return `frames running ${t.app}`;
  }
};
