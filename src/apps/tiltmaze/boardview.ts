/**
 * One board's 3D scene: the wooden tray tipping with the board's tilt, its walls (sinking and
 * rising when the maze changes), holes, the glowing goal, the ball with its soft shadow, and the
 * collector behind the far rim that takes the ball up the tube. Drawn by its own fixed camera
 * (boardcam.ts) into its lane.
 */
import {
  BoxGeometry,
  CircleGeometry,
  Group,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Scene,
} from "three";
import type { Rect } from "../../core/types";
import { type Board, ENTER_S, GOAL_S, SINK_S } from "./board";
import {
  BOARD_THICK,
  COLLECTOR,
  collectorTop,
  type Fit,
  fitBoardCamera,
  pxPerMetre,
  RIM_H,
} from "./boardcam";
import type { BoardSlot } from "./layout";
import { addLights, type Look } from "./look";
import { BOARD, type Maze, RIM } from "./maze";

const MAX_WALLS = 220;
const MAX_HOLES = 6;

export interface BoardView {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  /** The lane in stage px. */
  readonly lane: Rect;
  /** Fit the camera to a slot (venue px) at `unit` stage px per venue px; size the collector. */
  setSlot(slot: BoardSlot, unit: number, tubeWidthPx: number): void;
  sync(board: Board, alpha: number, time: number): void;
  dispose(): void;
}

export const createBoardView = (look: Look, board: Board): BoardView => {
  const own: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T): T => {
    own.push(x);
    return x;
  };
  const { mat } = look;
  const { w, d } = BOARD[board.orient];
  const scene = new Scene();
  addLights(scene);
  const camera = new PerspectiveCamera(30, 1, 0.2, 5);
  const lane: Rect = { x: 0, y: 0, width: 1, height: 1 };
  let fit: Fit = { k: 1 };

  const tray = new Group();
  scene.add(tray);
  const floorGeo = keep(new PlaneGeometry(w, d));
  floorGeo.rotateX(-Math.PI / 2);
  // The grain runs along the board's long side, a texture tile per 25 cm.
  const uv = floorGeo.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / 0.25, (uv.getY(i) * d) / 0.25);
  const floor = new Mesh(floorGeo, mat.floor);
  tray.add(floor);
  const base = new Mesh(keep(new BoxGeometry(w + 2 * RIM, BOARD_THICK, d + 2 * RIM)), mat.base);
  base.position.y = -BOARD_THICK / 2 - 0.0004;
  tray.add(base);
  // The rim: four rails round the floor.
  const rimH = RIM_H;
  for (const [sx, sz, px, pz] of [
    [w + 2 * RIM, RIM, 0, -(d / 2 + RIM / 2)],
    [w + 2 * RIM, RIM, 0, d / 2 + RIM / 2],
    [RIM, d, -(w / 2 + RIM / 2), 0],
    [RIM, d, w / 2 + RIM / 2, 0],
  ] as const) {
    const m = new Mesh(keep(new BoxGeometry(sx, rimH, sz)), mat.rim);
    m.position.set(px, rimH / 2, pz);
    tray.add(m);
  }

  const unitBox = keep(new BoxGeometry(1, 1, 1));
  unitBox.translate(0, 0.5, 0);
  const walls: Mesh[] = [];
  const wallGroup = new Group();
  tray.add(wallGroup);
  const wallMesh = (i: number) => {
    let m = walls[i];
    if (!m) {
      m = new Mesh(unitBox, mat.wall);
      walls.push(m);
      wallGroup.add(m);
    }
    return m;
  };

  const disc = keep(new CircleGeometry(1, 40));
  disc.rotateX(-Math.PI / 2);
  const ring = keep(new RingGeometry(0.9, 1.1, 40));
  ring.rotateX(-Math.PI / 2);
  const thinRing = keep(new RingGeometry(0.82, 1, 40));
  thinRing.rotateX(-Math.PI / 2);
  const flat = keep(new PlaneGeometry(1, 1));
  flat.rotateX(-Math.PI / 2);

  const holes = Array.from({ length: MAX_HOLES }, () => {
    const pit = new Mesh(disc, mat.hole);
    const rim = new Mesh(ring, mat.brass);
    pit.visible = rim.visible = false;
    tray.add(pit, rim);
    return { pit, rim };
  });
  const goalPit = new Mesh(disc, mat.hole);
  const goalRing = new Mesh(ring, mat.goal);
  const goalHalo = new Mesh(flat, mat.halo);
  const start = new Mesh(thinRing, mat.start);
  tray.add(goalPit, goalRing, goalHalo, start);

  const ball = new Mesh(look.ballGeo, look.balls[0]);
  const shadow = new Mesh(flat, mat.blob);
  tray.add(ball, shadow);

  // The collector stands still behind the far rim; the tube rises from its top.
  const collector = new Group();
  const box = new Mesh(unitBox, mat.base);
  box.scale.set(COLLECTOR.w, COLLECTOR.h + BOARD_THICK, COLLECTOR.d);
  box.position.y = -BOARD_THICK;
  const mouth = new Mesh(disc, mat.hole);
  mouth.position.y = COLLECTOR.h + 0.0006;
  const lip = new Mesh(ring, mat.brass);
  lip.position.y = mouth.position.y + 0.0003;
  collector.add(box, mouth, lip);
  scene.add(collector);

  let shownMaze: Maze | null = null;
  let along = 0;
  const q = new Quaternion();
  const q0 = new Quaternion();

  const showMaze = (m: Maze) => {
    shownMaze = m;
    let n = 0;
    for (const b of m.boxes) {
      if (b.rim || n >= MAX_WALLS) continue;
      const wm = wallMesh(n++);
      wm.position.set((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2);
      wm.scale.set(b.x1 - b.x0, m.wallH, b.z1 - b.z0);
      wm.visible = true;
    }
    for (let i = n; i < walls.length; i++) walls[i]!.visible = false;
    holes.forEach((h, i) => {
      const hole = m.holes[i];
      h.pit.visible = h.rim.visible = !!hole;
      if (!hole) return;
      h.pit.position.set(hole.x, 0.0006, hole.z);
      h.pit.scale.setScalar(hole.r);
      h.rim.position.set(hole.x, 0.0009, hole.z);
      h.rim.scale.setScalar(hole.r);
    });
    const gx = -m.w / 2 + ((m.goal % m.cols) + 0.5) * m.sx;
    const gz = -m.d / 2 + (Math.floor(m.goal / m.cols) + 0.5) * m.sz;
    goalPit.position.set(gx, 0.0006, gz);
    goalPit.scale.setScalar(m.goalR);
    goalRing.position.set(gx, 0.001, gz);
    goalRing.scale.setScalar(m.goalR * 1.05);
    goalHalo.position.set(gx, 0.0012, gz);
    goalHalo.scale.set(m.goalR * 5, 1, m.goalR * 5);
    const sx = -m.w / 2 + ((m.start % m.cols) + 0.5) * m.sx;
    const sz = -m.d / 2 + (Math.floor(m.start / m.cols) + 0.5) * m.sz;
    start.position.set(sx, 0.0007, sz);
    start.scale.setScalar(m.r * 1.9);
  };
  showMaze(board.maze);

  return {
    scene,
    camera,
    lane,
    setSlot(slot, unit, tubeWidthPx) {
      lane.x = slot.lane.x * unit;
      lane.y = slot.lane.y * unit;
      lane.width = slot.lane.width * unit;
      lane.height = slot.lane.height * unit;
      const focus = {
        x: slot.focus.x * unit,
        y: slot.focus.y * unit,
        width: slot.focus.width * unit,
        height: slot.focus.height * unit,
      };
      along = slot.along;
      fit = fitBoardCamera(camera, lane, focus, board.orient, along);
      const t = collectorTop(board.orient, along);
      collector.position.set(t.x, 0, t.z);
      // As wide as the tube that rises from it looks, a little wider for a rim.
      const ppm = pxPerMetre(camera, fit, t);
      const width = Math.max(COLLECTOR.w * 0.6, (tubeWidthPx * 1.18) / Math.max(1e-6, ppm));
      box.scale.x = width;
      box.scale.z = Math.max(COLLECTOR.d, width * 0.8);
      mouth.scale.setScalar((tubeWidthPx * 0.5) / Math.max(1e-6, ppm));
      lip.scale.setScalar((tubeWidthPx * 0.52) / Math.max(1e-6, ppm));
    },
    sync(b, alpha, time) {
      const tx = b.prevTilt.x + (b.tilt.x - b.prevTilt.x) * alpha;
      const tz = b.prevTilt.z + (b.tilt.z - b.prevTilt.z) * alpha;
      tray.rotation.set(tz, 0, -tx);
      const rise = b.walls();
      const m = b.oldMaze ?? b.maze;
      if (m !== shownMaze) showMaze(m);
      wallGroup.scale.y = Math.max(0.001, rise);
      wallGroup.visible = rise > 0.002;
      const pulse = 0.5 + 0.5 * Math.sin(time * 3.2);
      mat.goal.opacity = 0.65 + 0.35 * pulse;
      mat.halo.opacity = 0.25 + 0.3 * pulse;
      const showGoal = b.phase !== "change" || b.oldMaze === null;
      goalRing.visible = goalHalo.visible = goalPit.visible = showGoal;

      const r = b.maze.r;
      const ball3 = b.ball;
      let x = ball3.px + (ball3.x - ball3.px) * alpha;
      let z = ball3.pz + (ball3.z - ball3.pz) * alpha;
      let y = r;
      let visible = true;
      let shade = 1;
      switch (b.phase) {
        case "enter": {
          const f = Math.min(1, b.phaseT / ENTER_S);
          const fall = 1 - f * f;
          const bounce = f > 0.8 ? Math.sin(((f - 0.8) / 0.2) * Math.PI) * 0.15 : 0;
          y = r + 0.12 * fall + r * bounce;
          shade = 0.35 + 0.65 * f;
          break;
        }
        case "sink":
        case "goal": {
          const f = Math.min(1, b.phaseT / (b.phase === "goal" ? GOAL_S : SINK_S));
          y = r - f * f * 2.3 * r;
          shade = 1 - f;
          break;
        }
        case "gone":
        case "change":
          visible = false;
          break;
        default:
          x = ball3.px + (ball3.x - ball3.px) * alpha;
          z = ball3.pz + (ball3.z - ball3.pz) * alpha;
      }
      ball.visible = visible;
      shadow.visible = visible;
      if (visible) {
        ball.material = look.balls[b.color % look.balls.length]!;
        ball.position.set(x, y, z);
        ball.scale.setScalar(r);
        q0.set(ball3.pq[0], ball3.pq[1], ball3.pq[2], ball3.pq[3]);
        q.set(ball3.q[0], ball3.q[1], ball3.q[2], ball3.q[3]);
        ball.quaternion.slerpQuaternions(q0, q, alpha);
        const h = Math.max(0, y - r);
        const s = r * 2.6 * (1 + h * 12);
        shadow.scale.set(s, 1, s);
        shadow.position.set(x + h * 0.25, 0.0015, z + h * 0.15);
        shadow.visible = shade > 0.05;
      }
      start.visible = b.phase === "enter" || b.phase === "roll";
    },
    dispose() {
      for (const x of own) x.dispose();
      own.length = 0;
      walls.length = 0;
    },
  };
};
