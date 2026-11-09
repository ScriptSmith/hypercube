/**
 * A frame's tables in 3D (themed variants), behind the same `TableView` interface as the 2D view.
 *
 * One three.js scene holds every table of the frame, each in its own group set well apart, and
 * each table has its own camera straight in front of it (camera.ts) drawing into its own viewport:
 * the table's rectangle, or on a wall its share of the width, where its cabinet shows. So the
 * playfield plane lands exactly where the 2D table is, and a mirrored table looks like its twin.
 * One WebGL context per frame: on a wall the deck's band shares it (wall.ts passes it in).
 *
 * The shared skeleton is drawn here (playfield art, rails, slingshots, flippers, plunger, lamps,
 * tubes, posts, balls, the score in the playfield); the theme's toys come from its look
 * (themes/<id>/look.ts). A 2D canvas on top draws the pads, gifts, a held ball's ring, the
 * attract fade and game over with the 2D view's own code (tablehud.ts).
 */
import {
  type BufferGeometry,
  CanvasTexture,
  type Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
} from "three";
import { createRenderer3D, type Renderer3D } from "../../../core/renderer3d";
import { withAlpha } from "../../../core/ui/palette";
import { FONT } from "../../../core/ui/style";
import type { FrameInfo } from "../../../core/types";
import { BALL_R, TABLE_H, TABLE_W } from "../config";
import { drawGiftIcon, GIFT_COLOR } from "../gifticon";
import type { Lamp, TableLayout } from "../layout";
import type { Arc, Circle, Seg, Shape } from "../physics";
import type { Table } from "../table";
import {
  drawAttractFade,
  drawGifts,
  drawHud,
  drawPads,
  drawScore,
  flashOf,
  GIFT_R,
  heldMark,
  playfieldPath,
  type TableScene,
  type TableView,
} from "../tablehud";
import { fitStraight, seenAt } from "./camera";
import {
  along,
  at,
  createBallLayer,
  createKit,
  createLampLayer,
  createTextPlane,
  extrudeGeometry,
  flipperGeometry,
  type Kit,
  type LampLayer,
  type LookPalette,
  mergeStatic,
  paintedGeometry,
  railsGeometry,
  type TextPlane,
  tubeGeometry,
} from "./kit";
import type { TableModel, ThemeLook } from "./look";

/** The camera's distance in front of the playfield, table px (about 1 m before a panel). */
export const TABLE_DISTANCE = 1900;
/** Tables sit this far apart in the scene, so one camera never sees another's table. */
const SPACING = 8000;
const RAIL_H = 34;
/** How high glass tubes run over the playfield. */
export const TUBE_Z = 66;
const MAX_BALLS = 16;
const AMBER = "#ffcc33";
const SAVE = "#6cf7a0";
const GLASS = "#7fd7ff";
const SCORE = { y: 955, w: 900, h: 190 };

/**
 * Height of a ball's centre in a tube at (x, y): rising from the playfield near the tube's ends
 * inside the table, level over the middle, and down to the playfield's plane where the tube
 * crosses the top edge, so a ball crossing to the deck lines up with the chute above.
 */
export const tubeHeight = (pts: readonly { x: number; y: number }[], x: number, y: number) => {
  let z = TUBE_Z;
  for (const p of [pts[0], pts.at(-1)]) {
    if (!p || p.y < 0) continue;
    const d = Math.hypot(x - p.x, y - p.y);
    z = Math.min(z, BALL_R + (TUBE_Z - BALL_R) * Math.min(1, d / 90));
  }
  return Math.min(z, TUBE_Z * Math.max(0, Math.min(1, y / 60)));
};

const tubePoints = (pts: readonly { x: number; y: number }[]) => {
  const out: { x: number; y: number; z: number }[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 20));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const x = a.x + ((b.x - a.x) * k) / n;
      const y = a.y + ((b.y - a.y) * k) / n;
      out.push({ x, y, z: tubeHeight(pts, x, y) });
    }
  }
  return out;
};

interface Bumper {
  shape: Circle;
  cap: MeshPhongMaterial;
}

interface Target {
  shape: Seg;
  mat: MeshPhongMaterial;
}

interface Rig {
  table: Table;
  group: Group;
  camera: PerspectiveCamera;
  field: Mesh;
  fieldMat: MeshBasicMaterial;
  fieldCanvas: HTMLCanvasElement;
  fieldTex: CanvasTexture | null;
  fieldScale: number;
  color: string;
  deck: boolean | null;
  exit: Group;
  orbit: Group;
  flippers: Mesh[];
  plunger: Group;
  spring: Mesh;
  posts: Mesh[];
  slings: { shape: Seg; mat: MeshPhongMaterial }[];
  bumpers: Bumper[];
  targets: Target[];
  lamps: LampLayer;
  lampList: Lamp[];
  arrow: { mesh: Mesh; mat: MeshBasicMaterial } | null;
  balls: ReturnType<typeof createBallLayer>;
  model: TableModel;
  score: TextPlane;
  scoreKey: string;
  cabinet: Group;
  fixed: Group;
  own: { dispose(): void }[];
}

/** Paint the playfield: the cabinet, the field's colours, the theme's art and the fixed marks. */
const paintField = (
  g: CanvasRenderingContext2D,
  L: TableLayout,
  color: string,
  p: LookPalette,
  look: ThemeLook,
  cabinet: boolean,
) => {
  if (!cabinet) {
    g.fillStyle = p.cabinet;
    g.fillRect(0, 0, TABLE_W, TABLE_H);
  }
  g.save();
  if (L.mirror) {
    g.translate(TABLE_W, 0);
    g.scale(-1, 1);
  }
  playfieldPath(g);
  g.restore();
  g.save();
  g.clip();
  const grad = g.createLinearGradient(0, 120, 0, TABLE_H);
  grad.addColorStop(0, p.fieldTop);
  grad.addColorStop(1, p.fieldLow);
  g.fillStyle = grad;
  g.fillRect(0, 0, TABLE_W, TABLE_H);
  look.playfield?.(g, L, color);
  // A soft wash of the table's colour low on the playfield, as on the 2D table.
  const mid = L.mirror ? TABLE_W - 500 : 500;
  const wash = g.createRadialGradient(mid, 1500, 40, mid, 1500, 620);
  wash.addColorStop(0, withAlpha(color, 0.16));
  wash.addColorStop(1, withAlpha(color, 0));
  g.fillStyle = wash;
  g.fillRect(0, 0, TABLE_W, TABLE_H);
  g.restore();
  // Multiplier labels under their lamps, and the plunger's housing.
  g.font = `800 26px ${FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = withAlpha("#ffffff", 0.45);
  for (const l of L.lamps) if (l.tag === "mult") g.fillText(`${l.index + 2}x`, l.x, l.y + 1);
  const z = L.plunger.zone;
  g.fillStyle = "#06070f";
  g.fillRect(z.x0 + 8, L.plunger.tipY + 10, z.x1 - z.x0 - 16, TABLE_H - L.plunger.tipY);
};

/** The slingshot's third corner: the wall end that isn't on the face. */
const slingCorner = (L: TableLayout, face: Seg) =>
  L.shapes.find(
    (s) =>
      s.kind === "seg" &&
      s.tag === "wall" &&
      Math.abs(s.ax - face.ax) < 1 &&
      Math.abs(s.ay - face.ay) < 1,
  ) as Seg | undefined;

/** The deck lane's arrow: a chevron pointing up the lane. */
const arrowOutline = (L: TableLayout) => {
  const dl = L.deckLane;
  const cx = dl.mouth.x - dl.dir.x * 70;
  const cy = dl.mouth.y - dl.dir.y * 70;
  const ux = dl.dir.x;
  const uy = dl.dir.y;
  const px = -uy;
  const py = ux;
  const P = (a: number, b: number) => ({ x: cx + ux * a + px * b, y: cy + uy * a + py * b });
  return [P(34, 0), P(-17, 24), P(-5, 0), P(-17, -24)];
};

export const createTableView3D = (
  root: HTMLElement,
  palette: readonly string[],
  look: ThemeLook,
  frame: FrameInfo,
  shared?: Renderer3D,
): TableView => {
  const r3 = shared ?? createRenderer3D(root, frame, { antialias: true });
  const own = !shared;
  const kit: Kit = createKit(look.palette);
  const scene = new Scene();
  scene.add(new HemisphereLight("#ffffff", "#30344a", 1.1));
  // Lights straight above the top edge and in front, so a mirrored table is lit as its twin.
  const key = new DirectionalLight("#ffffff", 1.6);
  key.position.set(0, 1.2, 1.4);
  scene.add(key);
  const fill = new DirectionalLight("#9db8ff", 0.45);
  fill.position.set(0, -1, 0.8);
  scene.add(fill);

  const overlay = document.createElement("canvas");
  overlay.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;z-index:1;";
  root.append(overlay);
  const go = overlay.getContext("2d");
  let scale = 1;
  let ox = 0;
  let oy = 0;
  let rigs: Rig[] = [];
  let prepared = false;
  let fr = frame;

  const painted = kit.keep(
    new MeshPhongMaterial({ vertexColors: true, shininess: 70, specular: "#888888" }),
  );
  /** A flipper as one mesh: white body over coloured rubber, a metal pin on its pivot. */
  const flipperShapes = new Map<string, BufferGeometry>();
  const flipperGeo = (main: boolean, color: string) => {
    const key = `${main}|${color}`;
    let g = flipperShapes.get(key);
    if (g) return g;
    const len = main ? 150 : 120;
    const r0 = main ? 24 : 20;
    const r1 = main ? 12 : 10;
    const body = flipperGeometry(len, r0, r1, main ? 30 : 26);
    const rubber = flipperGeometry(len, r0 + 4, r1 + 4, 14);
    const pin = kit.geo.cylinder;
    g = kit.keep(
      paintedGeometry([
        { geometry: rubber, color, matrix: new Matrix4().makeTranslation(0, 0, 6) },
        { geometry: body, color: look.palette.plastic },
        {
          geometry: pin,
          color: look.palette.rail,
          matrix: new Matrix4().makeScale(r0 * 0.4, r0 * 0.4, 34),
        },
      ])!,
    );
    body.dispose();
    rubber.dispose();
    flipperShapes.set(key, g);
    return g;
  };

  const buildRig = (s: TableScene, h: number): Rig => {
    const t = s.table;
    const L = t.layout;
    const parts: { dispose(): void }[] = [];
    const keep = <T extends { dispose(): void }>(x: T) => {
      parts.push(x);
      return x;
    };
    const group = new Group();
    group.position.x = h * SPACING;
    scene.add(group);
    const camera = new PerspectiveCamera();
    const color = s.color;

    // The cabinet round a wall's table: its share of the wall washed in its colour, side rails.
    const cabinet = new Group();
    group.add(cabinet);

    // The playfield, painted when the view is sized.
    const fieldMat = keep(new MeshBasicMaterial({ color: "#ffffff" }));
    const field = new Mesh(kit.geo.quad, fieldMat);
    field.scale.set(TABLE_W, TABLE_H, 1);
    at(field, TABLE_W / 2, TABLE_H / 2, 0);
    group.add(field);

    const model = look.table(kit, L, color);
    const owns = new Set(model.owns ?? []);
    // Pieces that never move, merged by material once the table is built.
    const fixed = new Group();
    group.add(fixed);

    // Rails: every wall that is up, but the plunger's tip, which moves.
    const walls = L.shapes.filter(
      (x): x is Seg | Arc =>
        (x.kind === "seg" || x.kind === "arc") &&
        x.tag === "wall" &&
        x.on &&
        x !== L.plunger.tip &&
        !owns.has("wall"),
    );
    const rg = railsGeometry(walls, RAIL_H);
    if (rg) fixed.add(new Mesh(keep(rg), kit.mat.metal));

    // Slingshots: a coloured plastic body and a rubber face that flashes.
    const slings: Rig["slings"] = [];
    for (const sh of L.shapes) {
      if (sh.kind !== "seg" || sh.tag !== "sling") continue;
      const c = slingCorner(L, sh);
      if (c) {
        const body = keep(
          extrudeGeometry(
            [
              { x: sh.ax, y: sh.ay },
              { x: c.bx, y: c.by },
              { x: sh.bx, y: sh.by },
            ],
            24,
            3,
          ),
        );
        fixed.add(new Mesh(body, kit.phong(color, { opacity: 0.75, shininess: 90 })));
      }
      const mat = keep(new MeshPhongMaterial({ color: "#f2f5fa", shininess: 40 }));
      const face = railsGeometry([sh], 30, 1);
      if (face) group.add(new Mesh(keep(face), mat));
      slings.push({ shape: sh, mat });
    }

    // Plain parts for shapes the theme doesn't draw itself.
    const bumpers: Bumper[] = [];
    const targets: Target[] = [];
    for (const sh of L.shapes) {
      if (sh.kind === "circle" && sh.tag === "bumper" && !owns.has("bumper")) {
        const base = new Mesh(kit.geo.cylinder, kit.mat.dark);
        base.scale.set(sh.r, sh.r, 18);
        at(base, sh.x, sh.y, 0);
        const skirt = new Mesh(kit.geo.cylinder, kit.phong(color, { shininess: 80 }));
        skirt.scale.set(sh.r * 1.08, sh.r * 1.08, 8);
        at(skirt, sh.x, sh.y, 18);
        const cap = keep(
          new MeshPhongMaterial({ color: "#f7f9ff", emissive: color, shininess: 100 }),
        );
        const top = new Mesh(kit.geo.cylinder, cap);
        top.scale.set(sh.r * 0.7, sh.r * 0.7, 30);
        at(top, sh.x, sh.y, 26);
        group.add(base, skirt, top);
        bumpers.push({ shape: sh, cap });
      } else if (sh.kind === "seg" && sh.tag === "target" && !owns.has("target")) {
        const mat = keep(
          new MeshPhongMaterial({ color: AMBER, emissive: "#000000", shininess: 60 }),
        );
        const g = railsGeometry([sh], 40);
        if (g) group.add(new Mesh(keep(g), mat));
        targets.push({ shape: sh, mat });
      }
    }

    // Outlane posts, raised by a gift.
    const posts = L.posts.map((p) => {
      const g = railsGeometry([{ ...p, on: true }], 30);
      const m = new Mesh(keep(g!), kit.phong(SAVE, { emissive: "#1f6b40" }));
      m.visible = false;
      group.add(m);
      return m;
    });

    // Flippers: white bodies over coloured rubber, turning about their pivots.
    const flippers = t.world.flippers.map((f) => {
      const g = new Mesh(flipperGeo(f.len > 130, color), painted);
      at(g, f.px, f.py, 0);
      group.add(g);
      return g;
    });

    // The plunger: a rod that the pull draws down, over a spring.
    const z = L.plunger.zone;
    const plunger = new Group();
    const rod = new Mesh(kit.geo.box, kit.mat.metal);
    rod.scale.set(z.x1 - z.x0 - 28, 14, 22);
    at(rod, (z.x0 + z.x1) / 2, L.plunger.tipY + 7, 0);
    const shaft = new Mesh(kit.geo.box, kit.mat.metal);
    shaft.scale.set(12, TABLE_H - L.plunger.tipY, 12);
    at(shaft, (z.x0 + z.x1) / 2, (L.plunger.tipY + TABLE_H) / 2 + 7, 0);
    plunger.add(rod, shaft);
    group.add(plunger);
    const coil: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i <= 24; i++) {
      coil.push({ x: (z.x0 + z.x1) / 2 + (i % 2 ? 16 : -16), y: (i / 24) * 100, z: 12 });
    }
    const spring = new Mesh(keep(tubeGeometry(coil, 3, 6)), kit.mat.metal);
    group.add(spring);

    // Glass tubes: up off the top edge and back (with the deck), or the orbit ramp.
    const tube = (pts: readonly { x: number; y: number }[], c: string) => {
      const g = new Group();
      const path = tubePoints(pts);
      g.add(new Mesh(keep(tubeGeometry(path, BALL_R + 10)), kit.mat.glass));
      // Two rails along the tube's sides, lit in its colour.
      const rails = kit.phong(c, { emissive: c, shininess: 80 });
      for (const side of [-1, 1]) {
        const off = path.map((p, i) => {
          const a = path[Math.max(0, i - 1)]!;
          const b = path[Math.min(path.length - 1, i + 1)]!;
          const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          return {
            x: p.x + (-(b.y - a.y) / l) * (BALL_R + 9) * side,
            y: p.y + ((b.x - a.x) / l) * (BALL_R + 9) * side,
            z: p.z,
          };
        });
        g.add(new Mesh(keep(tubeGeometry(off, 3.5, 6)), rails));
      }
      group.add(g);
      return g;
    };
    const exit = new Group();
    exit.add(tube(L.exitTube, GLASS), tube(L.returnTube, GLASS));
    group.add(exit);
    const orbit = tube(L.orbitTube, color);
    for (const g of [exit, orbit])
      for (const geo of mergeStatic(g, [{ root: g, whole: true }])) keep(geo);

    // Lamps: inserts in the playfield, the deck lane's arrow on its own.
    const lampList = L.lamps.filter((l) => l.tag !== "deck" && l.tag !== "spinner");
    const lamps = createLampLayer(
      kit,
      lampList.map((l) => ({
        x: l.x,
        y: l.y,
        r: l.r,
        color:
          l.tag === "target"
            ? "#ff8a3d"
            : l.tag === "mult"
              ? color
              : l.tag === "save"
                ? SAVE
                : AMBER,
      })),
    );
    for (const m of lamps.root) group.add(m);
    let arrow: Rig["arrow"] = null;
    if (L.lamps.some((l) => l.tag === "deck")) {
      const mat = keep(kit.basic("#ffffff").clone());
      const mesh = new Mesh(keep(extrudeGeometry(arrowOutline(L), 2)), mat);
      mesh.position.z = 0.5;
      group.add(mesh);
      arrow = { mesh, mat };
    }

    group.add(model.root);
    const balls = createBallLayer(kit, MAX_BALLS);
    for (const m of balls.root) group.add(m);
    const sx = L.mirror ? TABLE_W - 500 : 500;
    const score = createTextPlane(kit, sx, SCORE.y, 1.5, SCORE.w, SCORE.h, 1);
    group.add(score.mesh);
    parts.push(score);

    return {
      table: t,
      group,
      camera,
      field,
      fieldMat,
      fieldCanvas: document.createElement("canvas"),
      fieldTex: null,
      fieldScale: 0,
      color,
      deck: null,
      exit,
      orbit,
      flippers,
      plunger,
      spring,
      posts,
      slings,
      bumpers,
      targets,
      lamps,
      lampList,
      arrow,
      balls,
      model,
      score,
      scoreKey: "",
      cabinet,
      fixed,
      own: parts,
    };
  };

  /** Merge a built table's fixed pieces, its cabinet's and its model's static ones. */
  const mergeRig = (rig: Rig) => {
    const made = mergeStatic(rig.group, [
      { root: rig.fixed, whole: true },
      { root: rig.cabinet, whole: true },
      { root: rig.model.root, whole: false },
    ]);
    rig.own.push(...made);
  };

  /** The table's own field painted at a resolution to suit its size in the frame. */
  const paint = (rig: Rig, s: TableScene) => {
    const k = Math.min(1, Math.max(0.3, s.place.k * fr.unit * fr.pixelRatio));
    if (rig.fieldTex && Math.abs(k - rig.fieldScale) < 0.08) return;
    const c = rig.fieldCanvas;
    c.width = Math.round(TABLE_W * k);
    c.height = Math.round(TABLE_H * k);
    const g = c.getContext("2d");
    if (g) {
      g.scale(c.width / TABLE_W, c.height / TABLE_H);
      paintField(g, rig.table.layout, rig.color, look.palette, look, s.cell !== undefined);
    }
    // A new texture for the new size; the material keeps its program, since it had a map before.
    rig.fieldTex?.dispose();
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    rig.fieldTex = tex;
    rig.fieldMat.map = tex;
    rig.fieldMat.needsUpdate = true;
    rig.fieldScale = k;
  };

  /** A wall table's cabinet: its cell washed in its colour, with side rails beside the table. */
  const buildCabinet = (rig: Rig, s: TableScene) => {
    rig.cabinet.clear();
    if (!s.cell) return;
    const q = s.place;
    const x0 = (s.cell.x - q.x) / q.k;
    const x1 = (s.cell.x + s.cell.w - q.x) / q.k;
    const tex = kit.paint(8, 256, (g) => {
      const grad = g.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, withAlpha(rig.color, 0));
      grad.addColorStop(1, withAlpha(rig.color, 0.16));
      g.fillStyle = look.palette.cabinet;
      g.fillRect(0, 0, 8, 256);
      g.fillStyle = grad;
      g.fillRect(0, 0, 8, 256);
    });
    const back = new Mesh(kit.geo.quad, kit.basic("#ffffff", { map: tex }));
    back.scale.set(x1 - x0, TABLE_H, 1);
    at(back, (x0 + x1) / 2, TABLE_H / 2, -2);
    rig.cabinet.add(back);
    for (const x of [-22, TABLE_W + 22]) {
      const side = new Mesh(kit.geo.box, kit.mat.metal);
      side.scale.set(28, TABLE_H, 54);
      at(side, x, TABLE_H / 2, 0);
      rig.cabinet.add(side);
    }
  };

  const fit = (rig: Rig, s: TableScene, time: number) => {
    const q = s.place;
    const view = s.cell
      ? {
          x0: (s.cell.x - q.x) / q.k,
          y0: (s.cell.y - q.y) / q.k,
          x1: (s.cell.x + s.cell.w - q.x) / q.k,
          y1: (s.cell.y + s.cell.h - q.y) / q.k,
        }
      : { x0: 0, y0: 0, x1: TABLE_W, y1: TABLE_H };
    const sh = rig.table.shake;
    const age = rig.table.world.t - sh.at;
    const amp = age >= 0 && age < 0.45 ? sh.amount * 12 * Math.exp(-age * 7) : 0;
    fitStraight(rig.camera, TABLE_W / 2, TABLE_H / 2, TABLE_DISTANCE, view, {
      offset: rig.group.position.x,
      near: 40,
      far: TABLE_DISTANCE + 900,
      shake: amp > 0 ? { x: Math.sin(time * 71) * amp, y: Math.cos(time * 57) * amp } : undefined,
    });
  };

  const lampState = (rig: Rig, l: Lamp, t: Table, time: number): { k: number; color?: string } => {
    const fromModel = rig.model.lamp?.(l, t, time);
    if (fromModel) return fromModel;
    const blink = (hz: number) => Math.sin(time * Math.PI * 2 * hz) > 0;
    if (l.tag === "lane")
      return { k: Math.max(t.lanes[l.index] ? 1 : 0, flashOf(t, "lane", l.index)) };
    if (l.tag === "target") return { k: t.targets[l.index] ? 1 : flashOf(t, "target", l.index) };
    if (l.tag === "mult") return { k: t.multiplier >= l.index + 2 ? 1 : 0 };
    if (l.tag === "save") {
      const left = t.saveLeft();
      return { k: left > 2 ? 1 : left > 0 ? (blink(4) ? 1 : 0) : 0 };
    }
    return { k: flashOf(t, l.tag, l.index) };
  };

  const sync = (rig: Rig, s: TableScene, alpha: number, time: number) => {
    const t = s.table;
    const L = t.layout;
    if (rig.deck !== s.deck) {
      rig.deck = s.deck;
      rig.exit.visible = s.deck;
      rig.orbit.visible = !s.deck;
    }
    t.world.flippers.forEach((f, i) => {
      const m = rig.flippers[i];
      if (m) m.rotation.z = -f.angle;
    });
    const pull = L.plunger.tip.ay - L.plunger.tipY;
    rig.plunger.position.y = -pull;
    rig.spring.scale.y = Math.max(0.2, (TABLE_H - L.plunger.tip.ay - 14) / 100);
    rig.spring.position.set(0, -(L.plunger.tip.ay + 14), 0);
    L.posts.forEach((p, i) => {
      const m = rig.posts[i];
      if (m) m.visible = p.on;
    });
    for (const sl of rig.slings) {
      const f = flashOf(t, "sling", sl.shape.index);
      sl.mat.emissive.set(s.color).multiplyScalar(0.25 + 0.75 * f);
    }
    for (const b of rig.bumpers) {
      const f = flashOf(t, "bumper", b.shape.index);
      (b.cap.emissive as Color).set(f > 0 ? "#ffffff" : s.color).multiplyScalar(0.45 + 0.55 * f);
    }
    for (const tg of rig.targets) {
      const f = flashOf(t, "target", tg.shape.index);
      tg.mat.emissive.set("#ffffff").multiplyScalar(f * 0.8);
    }
    rig.lampList.forEach((l, i) => {
      const st = lampState(rig, l, t, time);
      rig.lamps.set(i, st.k, st.color);
    });
    rig.lamps.commit();
    if (rig.arrow) {
      const blink = Math.sin(time * Math.PI * 2 * 1.2) > 0;
      const on = flashOf(t, "deck", 0) > 0 ? 1 : blink ? 0.9 : 0.25;
      rig.arrow.mat.color.set(s.deck ? GLASS : s.color).multiplyScalar(0.25 + 0.75 * on);
    }
    rig.model.sync(t, time, alpha);

    // Balls: on the table, in tubes, and held by the toys.
    const pal = (c: number) => palette[c % palette.length] ?? s.color;
    rig.balls.begin();
    for (const b of t.world.balls) {
      const x = b.px + (b.x - b.px) * alpha;
      const y = b.py + (b.y - b.py) * alpha;
      rig.balls.add(x, y, b.r, b.r, pal(b.color));
    }
    for (const tb of t.tubes) {
      if (tb.gift) continue;
      const pts = tb.kind === "orbit" ? L.orbitTube : tb.kind === "up" ? L.exitTube : L.returnTube;
      rig.balls.add(tb.x, tb.y, tubeHeight(pts, tb.x, tb.y), BALL_R, pal(tb.color));
    }
    for (const h of t.toys.held()) {
      if (h.scale <= 0.02) continue;
      rig.balls.add(h.x, h.y, h.z, BALL_R * h.scale, h.scale > 0.6 ? pal(h.ball.color) : null);
    }
    rig.balls.end();

    // The score in the playfield, repainted when it changes.
    const key = s.attract ? "" : `${Math.floor(t.score)}|${t.left}|${t.multiplier}|${t.mode}`;
    rig.score.mesh.visible = key !== "";
    if (key !== rig.scoreKey) {
      rig.scoreKey = key;
      const cx = L.mirror ? TABLE_W - 500 : 500;
      rig.score.draw((g) => {
        g.translate(-(cx - SCORE.w / 2), -(SCORE.y - SCORE.h / 2));
        drawScore(g, s);
      });
    }
  };

  const drawOverlay = (scenes: readonly TableScene[], time: number) => {
    if (!go) return;
    go.setTransform(1, 0, 0, 1, 0, 0);
    go.clearRect(0, 0, overlay.width, overlay.height);
    for (const s of scenes) {
      const p = s.place;
      go.setTransform(scale * p.k, 0, 0, scale * p.k, (p.x - ox) * scale, (p.y - oy) * scale);
      const t = s.table;
      drawGifts(go, s);
      // Gifts coming down the return tube, where the tube shows them.
      for (const tb of t.tubes) {
        if (!tb.gift) continue;
        const z = tubeHeight(t.layout.returnTube, tb.x, tb.y);
        const q = seenAt(tb.x, tb.y, z, TABLE_W / 2, TABLE_H / 2, TABLE_DISTANCE);
        drawGiftIcon(go, tb.gift, q.x, q.y, GIFT_R * q.k, GIFT_COLOR[tb.gift]);
      }
      for (const b of t.world.balls) {
        if (!b.hold) continue;
        const q = seenAt(b.x, b.y, b.r, TABLE_W / 2, TABLE_H / 2, TABLE_DISTANCE);
        heldMark(go, q.x, q.y, b.r * q.k, b.hold, s.color, s.cell === undefined);
      }
      drawPads(go, s, time);
      if (s.attract) drawAttractFade(go, s);
      drawHud(go, s);
    }
  };

  return {
    canvas: overlay,
    resize(f, reg) {
      fr = f;
      const u = f.unit;
      const w = Math.max(1, Math.round((reg ? reg.w * u : f.width) * f.pixelRatio));
      const h = Math.max(1, Math.round((reg ? reg.h * u : f.height) * f.pixelRatio));
      if (overlay.width !== w) overlay.width = w;
      if (overlay.height !== h) overlay.height = h;
      ox = reg?.x ?? 0;
      oy = reg?.y ?? 0;
      overlay.style.cssText = reg
        ? `position:absolute;left:${ox * u}px;top:${oy * u}px;width:${reg.w * u}px;height:${reg.h * u}px;z-index:1;`
        : "position:absolute;inset:0;z-index:1;";
      scale = f.unit * f.pixelRatio;
      if (own) r3.resize(f);
      for (const r of rigs) r.fieldScale = 0;
    },
    invalidate() {
      for (const r of rigs) r.deck = null;
    },
    draw(scenes, alpha, time) {
      if (rigs.length !== scenes.length || rigs.some((r, i) => r.table !== scenes[i]?.table)) {
        for (const r of rigs) dropRig(r);
        rigs = scenes.map((s, h) => buildRig(s, h));
        rigs.forEach((r, i) => {
          buildCabinet(r, scenes[i]!);
          mergeRig(r);
        });
        prepared = false;
      }
      scenes.forEach((s, i) => {
        const rig = rigs[i]!;
        paint(rig, s);
        fit(rig, s, time);
        sync(rig, s, alpha, time);
      });
      if (!prepared && rigs[0]) {
        r3.prepare(scene, rigs[0].camera);
        prepared = true;
      }
      drawOverlay(scenes, time);
      if (!r3.ready) return;
      const R = r3.renderer;
      R.autoClear = true;
      R.setClearColor(look.palette.cabinet, 1);
      R.setScissorTest(true);
      const u = fr.unit;
      const H = fr.height;
      scenes.forEach((s, i) => {
        const q = s.place;
        const v = s.cell
          ? { x: s.cell.x, y: s.cell.y, w: s.cell.w, h: s.cell.h }
          : { x: q.x, y: q.y, w: TABLE_W * q.k, h: TABLE_H * q.k };
        const x = v.x * u;
        const y = H - (v.y + v.h) * u;
        R.setViewport(x, y, v.w * u, v.h * u);
        R.setScissor(x, y, v.w * u, v.h * u);
        rigs.forEach((r, j) => (r.group.visible = i === j));
        R.render(scene, rigs[i]!.camera);
      });
      R.setScissorTest(false);
      for (const r of rigs) r.group.visible = true;
    },
    dispose() {
      for (const r of rigs) dropRig(r);
      rigs = [];
      overlay.remove();
      overlay.width = 0;
      kit.dispose();
      if (own) r3.dispose();
    },
  };

  function dropRig(r: Rig) {
    scene.remove(r.group);
    r.model.dispose?.();
    r.fieldTex?.dispose();
    r.fieldCanvas.width = 0;
    for (const x of r.own) x.dispose();
  }
};

/** Shapes of a layout a theme might want to draw: helpers for theme models. */
export const shapesTagged = <K extends Shape["kind"]>(
  L: TableLayout,
  tag: string,
  kind: K,
): Extract<Shape, { kind: K }>[] =>
  L.shapes.filter((s): s is Extract<Shape, { kind: K }> => s.kind === kind && s.tag === tag);

export { along };
