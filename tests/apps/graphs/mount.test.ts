// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mount } from "../../../src/apps/graphs";
import { GRAPHS } from "../../../src/apps/graphs/graphs";
import { LAYOUT_CHOICES } from "../../../src/apps/graphs/layouts";
import { createRng } from "../../../src/core/rng";
import type { AppContext, AppInstance } from "../../../src/core/types";

interface Harness {
  ctx: AppContext;
  app: AppInstance;
  viewer: HTMLIFrameElement;
  posted: { type: string; [k: string]: unknown }[];
  pokes: () => number;
  buttons: () => number;
  /** Presses the nth button made since the last layout. */
  press: (n: number) => void;
  toasts: string[];
  say: (data: Record<string, unknown>) => void;
}

const harness = (
  options: Record<string, string | number | boolean> = {},
  kind = "panel",
  bots = 0,
): Harness => {
  const root = document.createElement("div");
  document.body.append(root);
  let pokes = 0;
  const made: { onPress(): void }[] = [];
  const toasts: string[] = [];
  const ctx = {
    root,
    variant: GRAPHS[0]!.id,
    options: { level: "auto", tour: false, ...options },
    frame: {
      kind,
      width: 1080,
      height: 1920,
      unit: 1,
      touch: true,
      reachTop: { adult: 0, child: 960 },
      seams: [],
    },
    ui: {
      palette: { background: "#111", foreground: "#eee", muted: "#888" },
      button: (opts: { onPress(): void }) => {
        made.push(opts);
        return document.createElement("div");
      },
      toast: (text: string) => toasts.push(text),
    },
    idle: { poke: () => pokes++ },
    bots,
    input: { inject: { down: () => 1, move: () => {}, up: () => {} } },
    rng: (seed?: string) => createRng(seed ?? "x"),
    onResize: () => () => {},
    log: () => {},
  } as unknown as AppContext;
  const app = mount(ctx) as AppInstance;
  const viewer = root.querySelector("iframe")!;
  const posted: Harness["posted"] = [];
  vi.spyOn(viewer.contentWindow!, "postMessage").mockImplementation((m: unknown) => {
    posted.push(m as Harness["posted"][number]);
  });
  const say = (data: Record<string, unknown>) =>
    window.dispatchEvent(
      new MessageEvent("message", { data: { ngv: 1, ...data }, source: viewer.contentWindow }),
    );
  return {
    ctx,
    app,
    viewer,
    posted,
    pokes: () => pokes,
    buttons: () => made.length,
    press: (n) => made.at(-2 + n)?.onPress(),
    toasts,
    say,
  };
};

let h: Harness;
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  h.app.dispose();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const loads = (x: Harness) => x.posted.filter((m) => m.type === "load");
const graphOf = (x: Harness) => (x.app.status!() as { graph: string }).graph;
const selectedOf = (x: Harness) => (x.app.status!() as { selected: string }).selected;

test("it waits for the viewer, then sends the graph, and again on reset", () => {
  h = harness();
  expect(loads(h)).toHaveLength(0);
  h.say({ type: "ready" });
  expect(loads(h)).toHaveLength(1);
  const ws = JSON.parse(loads(h)[0]!.workspace as string);
  expect(ws.doc.name).toBe(GRAPHS[0]!.title);
  h.app.reset();
  expect(loads(h)).toHaveLength(2);
});

test("a message from anywhere but the viewer is ignored", () => {
  h = harness();
  window.dispatchEvent(
    new MessageEvent("message", { data: { ngv: 1, type: "ready" }, source: window }),
  );
  expect(loads(h)).toHaveLength(0);
});

test("a pick shows its card, activity counts as busy, and reset clears the card", () => {
  h = harness();
  h.say({ type: "ready" });
  const node = GRAPHS[0]!.nodes[0]!;
  h.say({ type: "select", id: node.id });
  expect(document.body.textContent).toContain(node.note);
  expect(selectedOf(h)).toBe(node.id);
  h.say({ type: "activity" });
  expect(h.pokes()).toBe(1);
  h.app.reset();
  expect(document.body.textContent).not.toContain(node.note);
  expect(selectedOf(h)).toBe("");
});

test("admin commands switch graph, step on and pick a node", () => {
  h = harness();
  h.say({ type: "ready" });
  h.app.command?.("graph", GRAPHS[2]!.id);
  expect(graphOf(h)).toBe(GRAPHS[2]!.id);
  expect(JSON.parse(loads(h).at(-1)!.workspace as string).doc.name).toBe(GRAPHS[2]!.title);
  h.app.command?.("next", null);
  expect(graphOf(h)).toBe(GRAPHS[3]!.id);
  h.app.command?.("select", "x");
  expect(h.posted.at(-1)).toMatchObject({ type: "select", id: "x" });
  h.app.command?.("graph", "no-such-graph");
  expect(graphOf(h)).toBe(GRAPHS[0]!.id);
  h.app.command?.("nonsense", 4);
});

test("attract moves on to the next graph only when rotating", () => {
  h = harness();
  h.say({ type: "ready" });
  h.app.attract?.();
  expect(graphOf(h)).toBe(GRAPHS[0]!.id);
  h.app.dispose();
  h = harness({ rotate: true });
  h.say({ type: "ready" });
  h.app.reset();
  h.app.attract?.();
  expect(graphOf(h)).toBe(GRAPHS[1]!.id);
  h.app.reset();
  h.app.attract?.();
  expect(graphOf(h)).toBe(GRAPHS[2]!.id);
});

test("the walk picks a node every step, stops on touch, and starts again on attract", () => {
  h = harness({ tour: true, tourSeconds: 3 });
  h.say({ type: "ready" });
  h.say({ type: "loaded", nodes: 1, edges: 0 });
  vi.advanceTimersByTime(3100);
  expect(h.posted.filter((m) => m.type === "select")).toHaveLength(1);
  vi.advanceTimersByTime(3000);
  expect(h.posted.filter((m) => m.type === "select")).toHaveLength(2);
  h.say({ type: "activity" });
  vi.advanceTimersByTime(10_000);
  expect(h.posted.filter((m) => m.type === "select")).toHaveLength(2);
  h.app.attract?.();
  vi.advanceTimersByTime(3100);
  expect(h.posted.filter((m) => m.type === "select")).toHaveLength(3);
});

test("a viewer that never answers is asked for again", () => {
  h = harness();
  const first = h.viewer.src;
  const set = vi.spyOn(h.viewer, "src", "set");
  vi.advanceTimersByTime(20_100);
  expect(set).toHaveBeenCalledWith(first);
  h.say({ type: "ready" });
  set.mockClear();
  vi.advanceTimersByTime(60_000);
  expect(set).not.toHaveBeenCalled();
});

test("a panel has a reset button and a Home spot inside the frame; a look-only frame has no button", () => {
  h = harness();
  expect(h.buttons()).toBe(2);
  const spot = h.app.homeSpot?.(140);
  expect(spot).not.toBeNull();
  expect(spot!.x).toBeGreaterThanOrEqual(0);
  expect(spot!.y).toBeGreaterThan(1920 - 400);
  h.app.dispose();
  h = harness({ level: "display" });
  expect(h.buttons()).toBe(0);
});

test("dispose removes everything and stops the timers", () => {
  h = harness({ tour: true });
  h.say({ type: "ready" });
  h.say({ type: "loaded", nodes: 1, edges: 0 });
  h.app.dispose();
  expect(document.querySelector("iframe")).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
  const before = h.posted.length;
  vi.advanceTimersByTime(60_000);
  expect(h.posted.length).toBe(before);
});

const layoutOf = (m: Record<string, unknown> | undefined) =>
  JSON.parse(m!.workspace as string) as { layout: string; pinned?: string[] };

test("the layout button cycles the arrangements, unpinning the nodes for the algorithms", () => {
  h = harness();
  h.say({ type: "ready" });
  expect(layoutOf(loads(h).at(-1)).pinned).toHaveLength(GRAPHS[0]!.nodes.length);
  const seen: string[] = [];
  for (let i = 0; i < LAYOUT_CHOICES.length - 1; i++) {
    h.press(1);
    const ws = layoutOf(loads(h).at(-1));
    seen.push(ws.layout);
    expect(ws.pinned).toBeUndefined();
  }
  expect(new Set(seen).size).toBe(seen.length);
  expect(h.toasts).toEqual(LAYOUT_CHOICES.slice(1).map((l) => l.name));
  h.press(1);
  expect(layoutOf(loads(h).at(-1)).pinned).toHaveLength(GRAPHS[0]!.nodes.length);
  expect((h.app.status!() as { layout: string }).layout).toBe("original");
});

test("a reset, a new graph and the admin command put the arrangement back or set it", () => {
  h = harness();
  h.say({ type: "ready" });
  h.press(1);
  expect((h.app.status!() as { layout: string }).layout).not.toBe("original");
  h.app.reset();
  expect((h.app.status!() as { layout: string }).layout).toBe("original");
  h.app.command?.("layout", "circle");
  expect(layoutOf(loads(h).at(-1)).layout).toBe("circle");
  h.app.command?.("next", null);
  expect((h.app.status!() as { layout: string }).layout).toBe("original");
  h.app.command?.("layout", "nope");
  expect((h.app.status!() as { layout: string }).layout).toBe("original");
});

test("the layout button can be switched off and shows with the info panel", () => {
  h = harness({ layouts: false });
  expect(h.buttons()).toBe(1);
  h.app.dispose();
  h = harness({ level: "panels" });
  expect(h.buttons()).toBe(2);
});

test("bots walk the graph in place of the tour and stand back after a person touches", () => {
  h = harness({ tour: true, tourSeconds: 3 }, "panel", 1);
  const picks = () => h.posted.filter((m) => m.type === "select" && m.center === true).length;
  h.say({ type: "ready" });
  h.say({ type: "loaded", nodes: 3, edges: 2 });
  vi.advanceTimersByTime(30_000);
  expect(picks()).toBeGreaterThan(3);
  expect(h.posted.filter((m) => m.type === "select" && m.center === false)).toHaveLength(0);
  h.say({ type: "activity" });
  const before = picks();
  vi.advanceTimersByTime(19_000);
  expect(picks()).toBe(before);
  vi.advanceTimersByTime(10_000);
  expect(picks()).toBeGreaterThan(before);
});
