/**
 * Chapter 3, what a crystal is.
 *
 * - Watch view (a canvas, so the screen can draw it too): a zoom from a grain you could hold
 *   down to its atoms repeating, one cell outlined; with a family of planes shown it turns to look
 *   along the layers edge on, the gap d marked between them.
 * - Figure: the same block of atoms in 3D, turned by dragging, the layers slicing through it as
 *   sheets (the atoms shrink meanwhile); a tap on it shows the next family of layers.
 * - Children: the crystal tiles; a picked crystal shows its first family once the zoom ends, so a
 *   child's tap reaches the So line. Adults: one Layers button that steps through the families,
 *   its pictogram showing which way they slice, and the drag to turn.
 * - Linked formula d = a / √(h² + k² + l²): d between the layers, a on the outlined cell, (h k l)
 *   on the family's name, which shows only while the Maths is open.
 * - Key move: showing a family of layers.
 */
import { withAlpha } from "../../../../core/ui/palette";
import { TEXT } from "../../captions";
import type {
  Chapter,
  ChapterDef,
  ChapterEnv,
  ChapterState,
  DemoStep,
  MachineDrive,
} from "../../chapter";
import { COLOR } from "../../config";
import { CRYSTALS, type Vec3 } from "../../crystals";
import { button, type Button, type Control, pad, type Pad } from "../../controls";
import { beam, bracket, label, well } from "../../draw";
import { presence } from "../../formula";
import type { View3D } from "../../layer3d";
import { type CardLayout, centre, inset, type Rect } from "../../layout";
import { layersIcon } from "./icon";
import { blockOf, cubicD, familyOf, isCubic, TILES, type Tile } from "./model";
import { createCrystalScene, type CrystalScene } from "./scene";
import { TileRow } from "./tiles";
import { type CrystalView, drawCrystal, type Spot } from "./watch";

const T = TEXT.crystal;
const L = T.labels;

export const PARTS = { d: COLOR.real, a: COLOR.angle, hkl: COLOR.accent } as const;

/** A picked crystal shows its first family this long after its zoom ends, s. */
export const AUTO_LAYERS_S = 0.6;

/** Seconds the zoom from a grain to atoms takes. */
export const ZOOM_S = 3.6;
/** Seconds to turn to the layers edge on. */
export const EDGE_S = 0.9;
export const PITCH = [-70, 80] as const;
/** Degrees a drag across one venue px turns the crystal. */
const DRAG_RATE = 0.32;
const SLOP = 14;

export interface CrystalState {
  tile: number;
  family: number;
  yaw: number;
  pitch: number;
  zoom: number;
  edge: number;
}

export const START: CrystalState = { tile: 0, family: 0, yaw: 30, pitch: 18, zoom: 1, edge: 0 };

export const STATE_RANGES = [
  [0, TILES.length - 1],
  [0, 3],
  [-180, 180],
  [PITCH[0], PITCH[1]],
  [0, 20],
  [0, 20],
] as const;

const wrap180 = (a: number) => {
  let r = a % 360;
  if (r <= -180) r += 360;
  else if (r > 180) r -= 360;
  return r;
};

export const encode = (s: CrystalState): number[] => [
  s.tile,
  s.family,
  Math.round(wrap180(s.yaw)),
  Math.round(Math.max(PITCH[0], Math.min(PITCH[1], s.pitch))),
  Math.round(s.zoom * 20),
  Math.round(s.edge * 20),
];

export const decode = (v: readonly number[]): CrystalState => ({
  tile: Math.max(0, Math.min(TILES.length - 1, v[0] ?? 0)),
  family: Math.max(0, Math.min(3, v[1] ?? 0)),
  yaw: v[2] ?? START.yaw,
  pitch: v[3] ?? START.pitch,
  zoom: (v[4] ?? 20) / 20,
  edge: (v[5] ?? 0) / 20,
});

const viewOf = (s: CrystalState): CrystalView => ({
  tile: TILES[s.tile]!,
  family: s.family,
  yaw: s.yaw,
  pitch: s.pitch,
  zoom: s.zoom,
  edge: s.edge,
});

const hklText = (tile: Tile, family: number) =>
  family > 0 && tile.families[family - 1] ? `(${tile.families[family - 1]!.join(" ")})` : "";

const def: ChapterDef = {
  id: "crystal",
  state: STATE_RANGES,
  start: encode(START),
  play(t) {
    // Each crystal in turn: the zoom, a slow turn, then its first family edge on.
    const k = Math.floor(t / 10);
    const u = t - k * 10;
    return encode({
      tile: k % TILES.length,
      family: u > 5 ? 1 : 0,
      yaw: 30 + u * 6,
      pitch: 18,
      zoom: Math.min(1, u / ZOOM_S),
      edge: Math.max(0, Math.min(1, (u - 5) / EDGE_S)),
    });
  },
  parts: PARTS,
  split: 0.5,
  watch(g, rect, state, look) {
    drawCrystal(g, rect, viewOf(decode(state)), {
      now: look.now,
      size: Math.max(22, Math.min(rect.height * 0.06, rect.width * 0.032, 90)),
    });
  },
  drive(state): MachineDrive {
    const s = decode(state);
    return { sample: { crystal: TILES[s.tile]!.crystal, form: "single" } };
  },
  create(env: ChapterEnv): Chapter {
    let s: CrystalState = { ...START };
    let card: CardLayout | null = null;
    let controls: Control[] = [];
    let tiles: TileRow | null = null;
    let fams: Button | null = null;
    /** A crystal was picked: show its first family once the zoom is done (s after it ends). */
    let autoLayers: number | null = null;
    let wasAway: boolean | null = null;
    let turnPad: Pad | null = null;
    let shown = false;
    let cs: CrystalScene | null = null;
    let view3d: View3D | null = null;
    let spots: Spot[] = [];
    let drag: {
      id: number;
      x: number;
      y: number;
      x0: number;
      y0: number;
      t0: number;
      moved: boolean;
    } | null = null;

    const tile = () => TILES[s.tile]!;
    const names = TILES.map((t) => L[t.id] ?? t.id);

    const pickTile = (i: number) => {
      s = { ...s, tile: i, family: 0, zoom: 0, edge: 0 };
      autoLayers = 0;
      cs?.setTile(tile());
      cs?.setFamily(0);
      refreshFamilies();
    };
    const setFamily = (f: number) => {
      s = { ...s, family: f };
      cs?.setFamily(f);
      refreshFamilies();
    };
    const nextFamily = () => {
      autoLayers = null;
      setFamily((s.family + 1) % (tile().families.length + 1));
    };

    /** The pictograms for the tile's families, made when the tile changes. */
    let iconTile = -1;
    let icons: ReturnType<typeof layersIcon>[] = [];
    const refreshFamilies = () => {
      if (!fams) return;
      if (iconTile !== s.tile) {
        iconTile = s.tile;
        const t = tile();
        icons = [layersIcon(null), ...t.families.map((hkl) => layersIcon(familyOf(t, hkl).normal))];
      }
      // Off, it shows the first family's slices, as what a press brings.
      fams.icon = icons[s.family > 0 ? s.family : 1] ?? icons[0];
      fams.on = s.family > 0;
    };

    const make = (l: CardLayout) => {
      const c = l.child;
      const a = l.adult;
      const f = l.figure;
      tiles = new TileRow(
        {
          id: "tiles",
          rect: { ...c },
          band: "child",
          value: s.tile,
          target: l.target,
          size: l.type.label * 0.78,
        },
        names,
        (i) => pickTile(i),
      );
      tiles.reveal(s.tile);
      const fh = Math.max(l.target, Math.min(a.height, l.target * 1.15));
      const fw = Math.min(a.width, Math.max(l.target * 3, 560));
      // On a pair's right half the adults' row starts at the seam side: keep the button outward.
      const fx = l.outer === "right" ? a.x + a.width - fw : a.x;
      const fr: Rect = { x: fx, y: a.y + a.height - fh, width: fw, height: fh };
      iconTile = -1;
      fams = button({
        id: "layers",
        rect: fr,
        band: "adult",
        label: L.layers!,
        color: COLOR.real,
        size: l.type.label * 1.1,
        onPress: () => nextFamily(),
      });
      refreshFamilies();
      const fx0 = Math.max(f.x, l.safe.x);
      const fx1 = Math.min(f.x + f.width, l.safe.x + l.safe.width);
      turnPad = pad({
        id: "turn",
        rect: { ...f, x: fx0, width: fx1 - fx0 },
        band: "adult",
        onDown: (t) => {
          drag = { id: t.id, x: t.x, y: t.y, x0: t.x, y0: t.y, t0: t.time, moved: false };
        },
        onMove: (t) => {
          if (!drag || drag.id !== t.id) return;
          if (!drag.moved && Math.hypot(t.x - drag.x0, t.y - drag.y0) >= SLOP) {
            drag.moved = true;
            drag.x = drag.x0;
            drag.y = drag.y0;
          }
          if (!drag.moved) return;
          s = {
            ...s,
            yaw: wrap180(s.yaw + (t.x - drag.x) * DRAG_RATE),
            pitch: Math.max(PITCH[0], Math.min(PITCH[1], s.pitch + (t.y - drag.y) * DRAG_RATE)),
          };
          drag.x = t.x;
          drag.y = t.y;
        },
        onUp: (t, cancelled) => {
          // A short touch without a drag shows the next family of planes.
          if (drag && drag.id === t.id && !drag.moved && !cancelled && t.time - drag.t0 < 450)
            nextFamily();
          drag = null;
        },
        botGesture: (rand, to) => {
          const cx = f.x + f.width / 2;
          const cy = f.y + f.height / 2;
          const dx = (to ?? rand() * 2 - 1) * f.width * 0.3;
          return {
            path: Array.from({ length: 12 }, (_, i) => ({
              x: cx - dx / 2 + (dx * i) / 11,
              y: cy + Math.sin(i / 3) * 12,
            })),
            ms: 1100,
          };
        },
      });
      controls = [turnPad, fams, tiles];
      place3d();
    };

    /** The 3D view: the figure, or on a pair's half the part of it in reach. */
    const figureRect = (): Rect | null => {
      if (!card) return null;
      const f = inset(card.figure, 4);
      const safe = card.safe;
      const x0 = Math.max(f.x, safe.x);
      const x1 = Math.min(f.x + f.width, safe.x + safe.width);
      return { ...f, x: x0, width: Math.max(1, x1 - x0) };
    };

    const ensure3d = () => {
      if (view3d || !card) return;
      cs = createCrystalScene();
      view3d = env.layer3d().view(cs.scene, cs.camera);
      cs.setTile(tile());
      cs.setFamily(s.family);
      cs.setTurn(s.yaw, s.pitch);
      place3d();
    };

    const place3d = () => {
      if (!view3d || !cs || !card) return;
      const r = figureRect()!;
      view3d.rect = shown ? r : null;
      cs.fit(r.width, r.height, card.beamY - (r.y + r.height / 2));
    };

    const syncControls = () => {
      if (tiles) tiles.value = s.tile;
      if (fams) fams.on = s.family > 0;
    };

    /** Labels over the 3D view: the family's name, d between two layers, a on the cell. */
    const drawOverlay = (g: CanvasRenderingContext2D, l: CardLayout, now: number) => {
      const r = figureRect();
      if (!r || !cs) return;
      const link = env.link;
      // An outline only: the 3D view shows through the card's canvas here.
      g.save();
      g.lineWidth = 3;
      g.strokeStyle = COLOR.edge;
      g.beginPath();
      g.roundRect(l.figure.x, l.figure.y, l.figure.width, l.figure.height, 28);
      g.stroke();
      g.restore();
      // The 3D view draws the beam through the crystal; the canvas carries it the rest of the way.
      const f = l.figure;
      if (r.x > f.x + 1) beam(g, f.x, l.beamY, r.x, l.beamY, { alpha: 0.9 });
      if (r.x + r.width < f.x + f.width - 1)
        beam(g, r.x + r.width, l.beamY, f.x + f.width, l.beamY, { alpha: 0.9 });
      const t = tile();
      if (s.family > 0) {
        const fam = familyOf(t, t.families[s.family - 1]!);
        // The family's name is the Maths' business: it shows only with the fold open.
        if (env.mathsOpen?.() === true)
          label(g, hklText(t, s.family), r.x + r.width - 20, r.y + 20 + l.type.label * 0.6, {
            size: l.type.label * (1.1 + 0.2 * link.level("hkl", now)),
            align: "right",
            color: COLOR.accent,
            weight: 800,
            alpha: presence(link, "hkl", now),
          });
        const lv = fam.levels;
        let k = 0;
        for (let i = 1; i < lv.length; i++) if (Math.abs(lv[i]!) < Math.abs(lv[k]!)) k = i;
        const k2 = k + 1 < lv.length ? k + 1 : k - 1;
        if (k2 >= 0 && k2 !== k) {
          const { right } = cs.axes();
          let out = 0;
          for (const c of blockOf(t).corners)
            out = Math.max(out, c[0] * right[0] + c[1] * right[1] + c[2] * right[2]);
          out += 1.5;
          const at = (v: number): Vec3 => [
            right[0] * out + fam.normal[0] * v,
            right[1] * out + fam.normal[1] * v,
            right[2] * out + fam.normal[2] * v,
          ];
          const p0 = cs.project(at(lv[k]!), r.width, r.height);
          const p1 = cs.project(at(lv[k2]!), r.width, r.height);
          if (Math.hypot(p1.x - p0.x, p1.y - p0.y) > 16) {
            g.save();
            g.globalAlpha = presence(link, "d", now);
            bracket(g, r.x + p0.x + 16, r.y + p0.y, r.x + p1.x + 16, r.y + p1.y, {
              label: "d",
              color: COLOR.real,
              width: 5 * (1 + 1.4 * link.level("d", now)),
              size: l.type.label,
              side: -1,
            });
            g.restore();
          }
        }
      }
    };

    return {
      layout(l) {
        card = l;
        make(l);
      },
      get controls() {
        return controls;
      },
      update(dt) {
        if (s.zoom < 1) s = { ...s, zoom: Math.min(1, s.zoom + dt / ZOOM_S) };
        else if (autoLayers !== null) {
          autoLayers += dt;
          if (autoLayers >= AUTO_LAYERS_S) {
            autoLayers = null;
            if (s.family === 0) setFamily(1);
          }
        }
        const wantEdge = s.family > 0 ? 1 : 0;
        if (s.edge !== wantEdge) {
          const step = dt / EDGE_S;
          s = {
            ...s,
            edge: wantEdge > s.edge ? Math.min(1, s.edge + step) : Math.max(0, s.edge - step),
          };
        }
        cs?.setTurn(s.yaw, s.pitch);
        syncControls();
        if (s.family > 0) env.earn();
        // With no layers drawn, the So line about layers dims until they come back.
        const away = s.family === 0;
        if (away !== wasAway) {
          wasAway = away;
          env.away?.(away);
        }
      },
      draw(g, now) {
        if (!card) return;
        if (shown) ensure3d();
        const link = env.link;
        spots = drawCrystal(g, card.watch, viewOf(s), {
          now,
          size: card.type.label,
          level: (p) => link.level(p, now),
          alpha: (p) => presence(link, p, now),
        });
        if (!view3d) well(g, card.figure, { fill: withAlpha(COLOR.well, 0.6) });
        drawOverlay(g, card, now);
      },
      partAt(x, y) {
        for (const sp of spots) if (Math.hypot(x - sp.x, y - sp.y) < 72) return sp.part;
        return null;
      },
      numbers() {
        const t = tile();
        const cell = CRYSTALS[t.crystal].cell;
        const lines = [
          isCubic(t)
            ? `${L[t.id] ?? t.id}: a = ${cell.a.toFixed(2)} Å`
            : `${L[t.id] ?? t.id}: a = ${cell.a.toFixed(2)} Å, c = ${cell.c.toFixed(2)} Å`,
        ];
        if (s.family > 0) {
          const hkl = t.families[s.family - 1]!;
          const sum = hkl[0] ** 2 + hkl[1] ** 2 + hkl[2] ** 2;
          lines.push(
            isCubic(t)
              ? `(${hkl.join(" ")}): d = ${cell.a.toFixed(2)} / √${sum} = ${cubicD(cell.a, hkl).toFixed(3)} Å`
              : `(${hkl.join(" ")}): d = ${familyOf(t, hkl).d.toFixed(3)} Å`,
          );
        }
        return lines;
      },
      state: (): ChapterState => encode(s),
      demo(): DemoStep[] {
        // A child's move: pick a crystal, and its layers come up after the zoom. Then the
        // adults' moves: turn it to see them as slices, and step to the next family.
        return [
          { control: "tiles", to: 0 },
          { wait: (ZOOM_S + AUTO_LAYERS_S) * 1000 + 1200 },
          { control: "turn", to: 0.25, ms: 1400 },
          { wait: 600 },
          { control: "layers" },
          { wait: 2600 },
        ];
      },
      hint() {
        return tiles ? centre(tiles.cells()[0]!.rect) : null;
      },
      status() {
        return {
          crystal: tile().id,
          family: hklText(tile(), s.family) || "none",
          yaw: Math.round(s.yaw),
          pitch: Math.round(s.pitch),
          zoom: Math.round(s.zoom * 100) / 100,
        };
      },
      reset() {
        s = { ...START };
        drag = null;
        autoLayers = null;
        wasAway = null;
        cs?.setTile(tile());
        cs?.setFamily(0);
        cs?.setTurn(s.yaw, s.pitch);
        refreshFamilies();
        tiles?.reveal(0);
      },
      show(on) {
        shown = on;
        if (view3d) view3d.rect = on ? figureRect() : null;
      },
      dispose() {
        view3d?.dispose();
        view3d = null;
        cs = null;
        controls = [];
      },
    };
  },
};

export default def;
