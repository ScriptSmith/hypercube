/**
 * Where everything goes, in venue px (origin top left). Each bench has a row of child sockets
 * low down for switches, buttons, lamps, fans and bells, a row (or two, on a kiosk) of gate
 * sockets above it, fixed output posts above the gates, trays of pieces at the ends, a
 * hold-to-reset control out of children's reach, and its machine on the upper wall, fed by
 * power lines from the posts. Sockets are numbered child first, then gates, then posts.
 */
import type { FrameKind } from "../../core/types";
import type { Band, PieceKind } from "./circuit";
import { CHILD_KINDS } from "./circuit";

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SocketSpot {
  x: number;
  y: number;
  band: Band;
}

export interface TraySpot {
  kind: PieceKind;
  x: number;
  y: number;
  size: number;
}

export interface Tray {
  band: "child" | "adult";
  box: Box;
  items: TraySpot[];
}

export interface PostSpot {
  socket: number;
  /** The post's input port and the way it faces, out of the post. */
  port: Point;
  dir: Point;
  body: Box;
  /** The power line from the post to its terminal on the machine. */
  line: Point[];
}

export interface BenchLayout {
  index: number;
  /** The bench's whole share of the frame; touches inside it belong to this bench. */
  slot: Box;
  /** Board panels drawn under the sockets and trays. */
  boards: Box[];
  sockets: SocketSpot[];
  posts: PostSpot[];
  /** Side of a child piece. */
  child: number;
  gateW: number;
  gateH: number;
  trays: Tray[];
  machine: Box;
  card: Box | null;
  reset: Box;
  /** Radius of a port's touch area. */
  hit: number;
  /** A dragged wire end snaps to a port this close. */
  snap: number;
  /** Wire width. */
  wire: number;
  /** Where the starting circuit goes. */
  starter: { a: number; b: number; lamp: number; and: number; or: number };
  /** Child sockets for a goal card's inputs, in order. */
  goalSockets: number[];
  /** Gate sockets, left to right then top to bottom. */
  gateSockets: number[];
}

export interface Layout {
  kind: FrameKind;
  W: number;
  H: number;
  benches: BenchLayout[];
  /** Where the runtime's Home control can sit. */
  home: Box;
  seams: number[];
  /** y of the top of child reach and of adult reach. */
  childTop: number;
  adultTop: number;
}

export interface LayoutInput {
  kind: FrameKind;
  width: number;
  height: number;
  reachTop: { adult: number; child: number };
  seams: readonly number[];
  benches: number;
  /** Posts on each bench: its machine's inputs. */
  posts: readonly number[];
  goals: boolean;
  gates: readonly PieceKind[];
}

/** Space kept clear either side of a seam. */
export const SEAM_KEEP = 120;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const box = (x: number, y: number, width: number, height: number): Box => ({
  x,
  y,
  width,
  height,
});

/** `n` centres spread over [x0, x1] at most `max` apart, centred in the span. */
export const centres = (x0: number, x1: number, n: number, max = Infinity): number[] => {
  if (n <= 0) return [];
  const pitch = Math.min((x1 - x0) / n, max);
  const start = (x0 + x1) / 2 - (pitch * n) / 2 + pitch / 2;
  return Array.from({ length: n }, (_, i) => Math.round(start + i * pitch));
};

const trayOf = (
  band: "child" | "adult",
  kinds: readonly PieceKind[],
  at: Box,
  cols: number,
  cell: number,
): Tray => {
  const rows = Math.max(1, Math.ceil(kinds.length / cols));
  const pad = 10;
  const b = box(at.x, at.y, cols * cell + 2 * pad, rows * cell + 2 * pad);
  const items = kinds.map((kind, i) => ({
    kind,
    x: b.x + pad + ((i % cols) + 0.5) * cell,
    y: b.y + pad + (Math.floor(i / cols) + 0.5) * cell,
    size: cell - 12,
  }));
  return { band, box: b, items };
};

/** Power line from a post up (or across) into the machine. */
const lineTo = (from: Point, to: Point, vertical: boolean): Point[] => {
  if (vertical) {
    const mid = (from.y + to.y) / 2;
    return Math.abs(from.x - to.x) < 2
      ? [from, to]
      : [from, { x: from.x, y: mid }, { x: to.x, y: mid }, to];
  }
  const mid = (from.x + to.x) / 2;
  return Math.abs(from.y - to.y) < 2
    ? [from, to]
    : [from, { x: mid, y: from.y }, { x: mid, y: to.y }, to];
};

/** Terminals spread along the bottom middle of a machine box. */
const bottomTerminals = (m: Box, k: number): Point[] => {
  const spread = Math.min(m.width * 0.5, m.height * 0.7);
  return centres(m.x + m.width / 2 - spread / 2, m.x + m.width / 2 + spread / 2, k).map((x) => ({
    x,
    y: m.y + m.height,
  }));
};

interface Draft {
  child: Point[];
  gates: Point[];
  posts: { x: number; y: number; body: Box; dir: Point }[];
}

/** Turn drafted positions into sockets and the indices the bench needs. */
const finish = (
  index: number,
  d: Draft,
  rest: Omit<
    BenchLayout,
    "index" | "sockets" | "posts" | "starter" | "goalSockets" | "gateSockets"
  > & { terminals: Point[]; vertical: boolean },
): BenchLayout => {
  const sockets: SocketSpot[] = [
    ...d.child.map((p) => ({ ...p, band: "child" as const })),
    ...d.gates.map((p) => ({ ...p, band: "adult" as const })),
    ...d.posts.map((p) => ({ x: p.x, y: p.y, band: "post" as const })),
  ];
  const nc = d.child.length;
  const ng = d.gates.length;
  const byX = (ids: number[]) =>
    ids.sort((a, b) => sockets[a]!.x - sockets[b]!.x || sockets[a]!.y - sockets[b]!.y);
  const childIds = byX(d.child.map((_, i) => i));
  const gateIds = byX(d.gates.map((_, i) => nc + i));
  const rowsFirst = (ids: number[]) =>
    [...ids].sort((a, b) => sockets[a]!.y - sockets[b]!.y || sockets[a]!.x - sockets[b]!.x);
  const posts = d.posts.map((p, i) => {
    const t = rest.terminals[i] ?? rest.terminals[rest.terminals.length - 1]!;
    const from = rest.vertical
      ? { x: p.x, y: p.body.y }
      : { x: p.body.x + p.body.width, y: p.body.y + p.body.height / 2 };
    return {
      socket: nc + ng + i,
      port: { x: p.x, y: p.y },
      dir: p.dir,
      body: p.body,
      line: lineTo(from, t, rest.vertical),
    };
  });
  // The starting circuit: two switches on the left, a lamp further right, AND between them.
  const upper = rowsFirst(childIds);
  const topRow = upper.filter((i) => Math.abs(sockets[i]!.y - sockets[upper[0]!]!.y) < 1);
  const a = topRow[0] ?? childIds[0]!;
  const b = topRow[1] ?? childIds[1]!;
  const lampPick = topRow.length >= 4 ? topRow[topRow.length - 2]! : topRow[topRow.length - 1]!;
  const lamp = lampPick !== a && lampPick !== b ? lampPick : childIds[childIds.length - 1]!;
  const gateRow = rowsFirst(gateIds);
  const gateTop = gateRow.filter((i) => Math.abs(sockets[i]!.y - sockets[gateRow[0]!]!.y) < 1);
  const and = gateTop[Math.floor((gateTop.length - 1) * 0.3)] ?? gateIds[0]!;
  const or = gateTop[Math.ceil((gateTop.length - 1) * 0.75)] ?? gateIds[gateIds.length - 1]!;
  const { terminals: _t, vertical: _v, ...keep } = rest;
  return {
    index,
    ...keep,
    sockets,
    posts,
    starter: { a, b, lamp, and, or: or === and ? (gateIds.find((g) => g !== and) ?? or) : or },
    goalSockets: upper.slice(0, 3),
    gateSockets: gateRow,
  };
};

// ---- Wall: one to three benches side by side along the reachable band ---------------------

const wallLayout = (inp: LayoutInput): Layout => {
  const W = inp.width;
  const H = inp.height;
  const n = clamp(Math.round(inp.benches), 1, 3);
  const A = clamp(inp.reachTop.adult, H * 0.25, H - 760);
  const C = clamp(inp.reachTop.child, A + 300, H - 430);
  const slotW = W / n;
  const m = 50;
  const TI = 130;
  const S = 230;
  const benches: BenchLayout[] = [];
  let home = box(0, 0, 160, 160);
  for (let i = 0; i < n; i++) {
    const slot = box(i * slotW, 0, slotW, H);
    const workW = Math.min(slotW - 2 * m, 3600);
    const x0 = slot.x + (slotW - workW) / 2;
    const x1 = x0 + workW;
    const reset = box(x0, A + 12, 150, 150);
    if (i === 0) home = box(x0 - 5, A + 175, 160, 160);
    const gateTray = trayOf("adult", inp.gates, box(0, A + 16, 0, 0), 3, TI);
    gateTray.box.x = x1 - gateTray.box.width;
    for (const it of gateTray.items) it.x += gateTray.box.x;
    const gx0 = reset.x + reset.width + 50;
    const gx1 = gateTray.box.x - 50;
    const ng = clamp(Math.floor((gx1 - gx0) / 270), 4, 6);
    const gPitch = Math.min((gx1 - gx0) / ng, 480);
    const gateW = Math.min(250, Math.round(gPitch - 60));
    const gateH = Math.round(Math.min(200, C - A - 140, gateW * 0.8));
    const gateY = Math.round(Math.min(A + 130 + gateH / 2, C - 10 - gateH / 2));
    const gates = centres(gx0, gx1, ng, 480).map((x) => ({ x, y: gateY }));

    const childY = Math.round(Math.min(C + 250, H - S / 2 - 70));
    const childTray = trayOf("child", CHILD_KINDS, box(x0, 0, 0, 0), 2, TI + 10);
    childTray.box.y = childY - childTray.box.height / 2;
    for (const it of childTray.items) it.y += childTray.box.y;
    const cx0 = childTray.box.x + childTray.box.width + 50;
    const nc = clamp(Math.floor((x1 - cx0) / 280), 3, 8);
    const child = centres(cx0, x1, nc, 480).map((x) => ({ x, y: childY }));

    const machine0 = box(slot.x + m, 40, slotW - 2 * m, A - 30 - 60 - 40);
    let card: Box | null = null;
    let machine = machine0;
    if (inp.goals) {
      const cw = Math.round(Math.min(680, machine0.width * 0.34));
      const ch = Math.round(Math.min(600, machine0.height * 0.6));
      card = box(machine0.x, machine0.y + machine0.height - ch, cw, ch);
      machine = box(machine0.x + cw + 40, machine0.y, machine0.width - cw - 40, machine0.height);
    }
    const k = inp.posts[i] ?? 2;
    const portY = A + 72;
    const posts = centres(gx0, gx1, k).map((x) => ({
      x,
      y: portY,
      body: box(x - 48, A - 30, 96, 84),
      dir: { x: 0, y: 1 },
    }));
    const boards = [
      box(x0 - 20, A - 4, workW + 40, C - A + 8),
      box(x0 - 20, childY - S / 2 - 70, workW + 40, S + 140),
    ];
    benches.push(
      finish(
        i,
        { child, gates, posts },
        {
          slot,
          boards,
          child: S,
          gateW,
          gateH,
          trays: [childTray, gateTray],
          machine,
          card,
          reset,
          hit: 70,
          snap: 140,
          wire: 16,
          terminals: bottomTerminals(machine, k),
          vertical: true,
        },
      ),
    );
  }
  return { kind: "wall", W, H, benches, home, seams: [], childTop: C, adultTop: A };
};

// ---- Pair: one bench across the panels, nothing near a seam ----------------------------------

const pairLayout = (inp: LayoutInput): Layout => {
  const W = inp.width;
  const H = inp.height;
  const m = 36;
  const seams = [...inp.seams].filter((s) => s > 0 && s < W).sort((a, b) => a - b);
  const edges = [0, ...seams, W];
  const C = clamp(inp.reachTop.child, H * 0.35, H - 700);
  const trayW = 300;
  const segs = edges.slice(0, -1).map((e, j) => {
    const last = j === edges.length - 2;
    let x0 = e + (j === 0 ? m : SEAM_KEEP);
    let x1 = edges[j + 1]! - (last ? m : SEAM_KEEP);
    const trays: number[] = [];
    if (j === 0) {
      trays.push(x0);
      x0 += trayW + 30;
    }
    if (last && edges.length > 2) {
      trays.push(x1 - trayW);
      x1 -= trayW + 30;
    }
    return { x0, x1, trays };
  });
  const cols = segs.map((s) => Math.max(1, Math.floor((s.x1 - s.x0) / 290)));
  const pitch = Math.min(...segs.map((s, j) => (s.x1 - s.x0) / cols[j]!));
  const S = Math.round(Math.min(250, pitch - 40));
  const gateW = S;
  const gateH = Math.round(Math.min(200, gateW * 0.8));
  const gateY = Math.round(C - 40 - gateH / 2);
  const portY = gateY - gateH / 2 - 100;
  const postTop = portY - 110;
  const rowA = Math.round(C + (H - C) * 0.27);
  const rowB = Math.round(C + (H - C) * 0.72);
  const xs = segs.flatMap((s, j) => centres(s.x0, s.x1, cols[j]!, 360));
  const child = [...xs.map((x) => ({ x, y: rowA })), ...xs.map((x) => ({ x, y: rowB }))];
  const gates = xs.map((x) => ({ x, y: gateY }));

  const trays: Tray[] = [];
  const childMid = (rowA + rowB) / 2;
  for (const s of segs) {
    for (const tx of s.trays) {
      const gt = trayOf("adult", inp.gates, box(tx + 10, postTop, 0, 0), 2, 130);
      const ct = trayOf("child", CHILD_KINDS, box(tx, 0, 0, 0), 2, 140);
      ct.box.y = childMid - ct.box.height / 2;
      for (const it of ct.items) it.y += ct.box.y;
      trays.push(ct, gt);
    }
  }

  // Posts spread over the socket spans, kept clear of the seams.
  const k = inp.posts[0] ?? 2;
  const spans = segs.map((s) => [s.x0 + 60, s.x1 - 60] as const);
  const total = spans.reduce((t, [a, b]) => t + (b - a), 0);
  const postXs = Array.from({ length: k }, (_, i) => {
    let d = ((i + 0.5) / k) * total;
    for (const [a, b] of spans) {
      if (d <= b - a) return Math.round(a + d);
      d -= b - a;
    }
    return Math.round(spans[spans.length - 1]![1]);
  });
  const posts = postXs.map((x) => ({
    x,
    y: portY,
    body: box(x - 45, postTop, 90, 90),
    dir: { x: 0, y: 1 },
  }));

  const reset = box(m, postTop - 180, 120, 120);
  const home = box(W - m - 120, postTop - 180, 120, 120);
  const machine0 = box(m + 150, 30, W - 2 * m - 300, postTop - 50 - 30);
  let card: Box | null = null;
  let machine = machine0;
  if (inp.goals) {
    const cw = Math.round(Math.min(620, machine0.width * 0.34));
    card = box(machine0.x, machine0.y, cw, machine0.height);
    machine = box(machine0.x + cw + 30, machine0.y, machine0.width - cw - 30, machine0.height);
  }
  const boards = segs.map((_, j) => {
    const left = j === 0 ? m : edges[j]! + SEAM_KEEP;
    const right = j === segs.length - 1 ? W - m : edges[j + 1]! - SEAM_KEEP;
    return box(left - 12, postTop - 20, right - left + 24, H - postTop);
  });
  const bench = finish(
    0,
    { child, gates, posts },
    {
      slot: box(0, 0, W, H),
      boards,
      child: S,
      gateW,
      gateH,
      trays,
      machine,
      card,
      reset,
      hit: 62,
      snap: 120,
      wire: 14,
      terminals: bottomTerminals(machine, k),
      vertical: true,
    },
  );
  return { kind: "pair", W, H, benches: [bench], home, seams, childTop: C, adultTop: 0 };
};

// ---- Kiosk: a small bench with its machine beside it -----------------------------------------

const kioskLayout = (inp: LayoutInput): Layout => {
  const W = inp.width;
  const H = inp.height;
  const m = 28;
  const col = box(W - m - 440, m, 440, H - 2 * m);
  const postX = col.x - 60;
  const portX = postX - 40 - 22;
  const reset = box(postX - 60, m, 120, 120);
  const home = box(postX - 60, H - m - 120, 120, 120);
  const gateTray = trayOf("adult", inp.gates, box(m, m + 20, 0, 0), 2, 135);
  const childTray = trayOf("child", CHILD_KINDS, box(m, 0, 0, 0), 2, 135);
  childTray.box.y = H - m - 20 - childTray.box.height;
  for (const it of childTray.items) it.y += childTray.box.y;
  const x0 = m + gateTray.box.width + 30;
  const x1 = portX - 70;
  const gateW = 250;
  const gateH = 180;
  const S = 250;
  const xs = centres(x0, x1, 3);
  const gates = [...xs.map((x) => ({ x, y: 175 })), ...xs.map((x) => ({ x, y: 430 }))];
  const child = xs.map((x) => ({ x, y: 795 }));
  let card: Box | null = null;
  let machine = col;
  if (inp.goals) {
    card = box(col.x, col.y, col.width, 420);
    machine = box(col.x, col.y + 440, col.width, col.height - 440);
  }
  // Posts face the machine column, level with where their lines enter it.
  const k = inp.posts[0] ?? 2;
  const ys = centres(Math.max(m + 170, machine.y + 60), H - m - 170, k);
  const posts = ys.map((y) => ({
    x: portX,
    y,
    body: box(postX - 40, y - 45, 80, 90),
    dir: { x: -1, y: 0 },
  }));
  const terminals = ys.map((y) => ({ x: machine.x, y }));
  const bench = finish(
    0,
    { child, gates, posts },
    {
      slot: box(0, 0, W, H),
      boards: [box(m - 12, m - 12, col.x - m - 8, H - 2 * m + 24)],
      child: S,
      gateW,
      gateH,
      trays: [childTray, gateTray],
      machine,
      card,
      reset,
      hit: 62,
      snap: 120,
      wire: 13,
      terminals,
      vertical: false,
    },
  );
  return { kind: "kiosk", W, H, benches: [bench], home, seams: [], childTop: 0, adultTop: 0 };
};

export const layoutFor = (inp: LayoutInput): Layout => {
  if (inp.kind === "wall") return wallLayout(inp);
  if (inp.kind === "kiosk") return kioskLayout(inp);
  return pairLayout(inp);
};

export const inBox = (b: Box, x: number, y: number, pad = 0) =>
  x >= b.x - pad && x <= b.x + b.width + pad && y >= b.y - pad && y <= b.y + b.height + pad;

/** Which bench a venue point belongs to. */
export const benchAt = (l: Layout, x: number): number => {
  for (const b of l.benches) if (x >= b.slot.x && x < b.slot.x + b.slot.width) return b.index;
  return x < 0 ? 0 : l.benches.length - 1;
};
