/**
 * Chapter 3's crystal tiles: one tile per crystal, its grain drawn above its name. Where six
 * tiles at least a target wide don't fit (a pair's half), three show at a time with a fourth cell
 * that turns to the other three.
 */
import { withAlpha } from "../../../../core/ui/palette";
import { COLOR } from "../../config";
import {
  type Band,
  type Control,
  fitText,
  type Gesture,
  roundRect,
  type Touch,
} from "../../controls";
import { ICON } from "../../draw";
import { inRect, type Rect, splitRow } from "../../layout";
import { type Mat3, TILES, turnOf } from "./model";
import { drawSolid } from "./watch";

const ICON_TURN: Mat3 = turnOf(32, 22);
const GAP = 14;

export class TileRow implements Control {
  readonly kind = "choice";
  readonly id: string;
  rect: Rect;
  band: Band;
  label = "";
  visible = true;
  enabled = true;
  touchedAt = Number.NEGATIVE_INFINITY;
  byPerson = false;
  /** The tile shown, an index into TILES. */
  value: number;
  /** Which three show, when they page. */
  page = 0;
  private finger: number | null = null;
  private pressedAt = Number.NEGATIVE_INFINITY;
  constructor(
    o: { id: string; rect: Rect; band: Band; value: number; target: number; size: number },
    private readonly names: readonly string[],
    private readonly onPick: (i: number, person: boolean) => void,
  ) {
    this.id = o.id;
    this.rect = o.rect;
    this.band = o.band;
    this.value = o.value;
    this.target = o.target;
    this.size = o.size;
  }
  target: number;
  size: number;
  get held() {
    return this.finger !== null;
  }
  /** True when the tiles show three at a time. */
  get paged(): boolean {
    return (this.rect.width - GAP * (TILES.length - 1)) / TILES.length < this.target;
  }
  /** The cells a finger can aim at, with the tile each shows (-1 for the turn cell). */
  cells(): { rect: Rect; tile: number }[] {
    if (!this.paged)
      return splitRow(
        this.rect,
        TILES.map(() => 1),
        GAP,
      ).map((rect, tile) => ({ rect, tile }));
    const r = splitRow(this.rect, [1, 1, 1, 0.9], GAP);
    return [0, 1, 2]
      .map((k) => ({ rect: r[k]!, tile: this.page * 3 + k }))
      .concat({ rect: r[3]!, tile: -1 });
  }
  hit(x: number, y: number) {
    return this.visible && this.enabled && inRect(this.rect, x, y);
  }
  begin(t: Touch) {
    this.finger = t.id;
    this.touchedAt = t.time;
    this.byPerson = !t.synthetic;
    this.pressedAt = t.time;
    const c = this.cells().find((x) => inRect(x.rect, t.x, t.y));
    if (!c) return;
    if (c.tile < 0) this.page = 1 - this.page;
    else {
      this.value = c.tile;
      this.onPick(c.tile, !t.synthetic);
    }
  }
  move(t: Touch) {
    if (this.finger === t.id) this.touchedAt = t.time;
  }
  end(t: Touch) {
    if (this.finger === t.id) this.finger = null;
  }
  release() {
    this.finger = null;
  }
  /** Show the page holding tile `i`. */
  reveal(i: number) {
    if (this.paged) this.page = i >= 3 ? 1 : 0;
  }
  gesture(to?: number, rand: () => number = Math.random): Gesture | null {
    const cells = this.cells();
    const pick =
      to === undefined
        ? cells[Math.floor(rand() * cells.length)]
        : (cells.find((c) => c.tile === Math.round(to)) ?? cells.find((c) => c.tile < 0));
    if (!pick) return null;
    return {
      path: [{ x: pick.rect.x + pick.rect.width / 2, y: pick.rect.y + pick.rect.height / 2 }],
      ms: 120,
    };
  }
  draw(g: CanvasRenderingContext2D, now: number) {
    if (!this.visible) return;
    for (const c of this.cells()) {
      const r = c.rect;
      const on = c.tile === this.value;
      const pressed = this.held && now - this.pressedAt < 200;
      g.save();
      roundRect(g, r, Math.min(32, r.height * 0.2));
      g.fillStyle = on ? withAlpha(COLOR.real, 0.22) : withAlpha(COLOR.background, 0.78);
      g.fill();
      g.lineWidth = on ? 6 : 4;
      g.strokeStyle = withAlpha(COLOR.real, on ? 0.95 : 0.45);
      g.stroke();
      if (c.tile < 0) {
        const s = Math.min(r.width, r.height) * 0.5;
        const box = {
          x: r.x + (r.width - s) / 2,
          y: r.y + (r.height - s) / 2,
          width: s,
          height: s,
        };
        (this.page === 0 ? ICON.next : ICON.back)(g, box, COLOR.real);
        g.restore();
        continue;
      }
      const tile = TILES[c.tile]!;
      const iconS = Math.min(r.width * 0.62, r.height * 0.5);
      const scale = pressed && on ? 0.94 : 1;
      drawSolid(g, tile.grain, r.x + r.width / 2, r.y + r.height * 0.38, iconS * scale, ICON_TURN);
      g.fillStyle = on ? COLOR.ink : withAlpha(COLOR.ink, 0.8);
      g.textAlign = "center";
      g.textBaseline = "middle";
      fitText(
        g,
        this.names[c.tile] ?? tile.id,
        r.x + r.width / 2,
        r.y + r.height * 0.82,
        r.width - 16,
        this.size,
        800,
        0.55,
      );
      g.restore();
    }
  }
}
