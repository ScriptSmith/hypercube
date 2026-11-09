/**
 * The message protocol of the embedded Network Graph Viewer in kiosk mode: objects tagged
 * `{ ngv: 1, type, ... }` passed with postMessage. The viewer's side is in its repository
 * (`src/lib/hostBridge.ts`); only what this app uses is described here.
 */
export const BRIDGE_VERSION = 1;

/**
 * How much of the viewer is shown. See the viewer's README ("Kiosk mode"). Its fourth step,
 * `app`, opens the data table and other editors, where a visitor could type, so it is not used.
 */
export type KioskLevel = "display" | "touch" | "panels";

export type ViewerMessage =
  | { type: "ready" }
  | { type: "loaded"; nodes: number; edges: number }
  | { type: "select"; id: string | null }
  | { type: "activity" }
  | { type: "error"; message: string };

export function parseViewerMessage(data: unknown): ViewerMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const m = data as Record<string, unknown>;
  if (m.ngv !== BRIDGE_VERSION) return null;
  switch (m.type) {
    case "ready":
    case "activity":
      return { type: m.type };
    case "loaded":
      return typeof m.nodes === "number" && typeof m.edges === "number"
        ? { type: "loaded", nodes: m.nodes, edges: m.edges }
        : null;
    case "select":
      return m.id === null || typeof m.id === "string" ? { type: "select", id: m.id } : null;
    case "error":
      return { type: "error", message: typeof m.message === "string" ? m.message : "" };
    default:
      return null;
  }
}

/** The published viewer. */
export const HOSTED_VIEWER = "https://adamsm.com/network-graph-viewer/";

/** The viewer in kiosk mode. */
export function viewerUrl(
  opts: { level: KioskLevel; expand: boolean },
  root: string = HOSTED_VIEWER,
): string {
  const url = new URL(root);
  url.search = new URLSearchParams({
    kiosk: opts.level,
    theme: "dark",
    card: "0",
    expand: opts.expand ? "1" : "0",
  }).toString();
  return url.toString();
}
