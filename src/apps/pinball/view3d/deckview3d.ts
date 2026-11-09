/**
 * The upper deck in 3D (themed variants), behind the same `DeckView` interface as the 2D view:
 * on a bank's screen, or as the band across the top of a wall, where it shares the tables' WebGL
 * context. A camera straight in front of the deck maps the deck's plane one to one onto its
 * region, so every chute and hole stays exactly above its table, and the pieces stand up off it.
 *
 * The pieces come from the theme's skin, or the plain ones (deckparts3d.ts). Each table's chute,
 * hole and target are rebuilt when the tables below change; everything else is built once. The
 * shared total and the tables' scores are planes painted only when they change.
 */
import {
  type BufferGeometry,
  CanvasTexture,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  type Object3D,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
} from "three";
import { createRenderer3D, type Renderer3D } from "../../../core/renderer3d";
import { withAlpha } from "../../../core/ui/palette";
import { FONT } from "../../../core/ui/style";
import type { FrameInfo } from "../../../core/types";
import { DECK_MAX, GIFTS, type Gift, RAIN_STEP } from "../config";
import type { Deck, DeckGeometry, Slot } from "../deck";
import { MAX_BUBBLES } from "../deckparts";
import type { DeckView } from "../deckview";
import { drawGiftIcon, GIFT_COLOR } from "../gifticon";
import { formatScore } from "../tablehud";
import type { Region } from "../wallgeo";
import { fitStraight } from "./camera";
import {
  type DeckColors,
  type DeckFrame,
  type DeckPart,
  type DeckSkin,
  PLAIN_COLORS,
  plainDeck,
} from "./deckparts3d";
import {
  at,
  createBallLayer,
  createKit,
  createTextPlane,
  type Kit,
  mergeStatic,
  type TextPlane,
} from "./kit";
import type { ThemeLook } from "./look";

const MAX_TOKENS = 8;
const AMBER = "#ffcc33";

/** A deck ball's height: on the deck, down to the plane at the bottom edge (chutes and holes). */
const ballHeight = (geo: DeckGeometry, y: number, r: number, phase: string) => {
  const low = Math.max(0, Math.min(1, (geo.H - y) / (4 * geo.R)));
  return phase === "rail" ? r + geo.U * 1.3 : r * low;
};

/** The rest of a skin's members filled in with the plain pieces. */
const withPlain = (skin: DeckSkin) => ({ ...plainDeck, ...skin });

export const createDeckView3D = (
  root: HTMLElement,
  palette: readonly string[],
  look: ThemeLook,
  frame: FrameInfo,
  shared?: Renderer3D,
): DeckView => {
  const r3 = shared ?? createRenderer3D(root, frame, { antialias: true });
  const own = !shared;
  const kit: Kit = createKit(look.palette);
  const skin = withPlain(look.deck);
  const colors: DeckColors = { ...PLAIN_COLORS, ...look.deck.colors };
  const scene = new Scene();
  scene.add(new HemisphereLight("#ffffff", "#30344a", 1.1));
  const key = new DirectionalLight("#ffffff", 1.5);
  key.position.set(0, 1.2, 1.4);
  scene.add(key);
  const fill = new DirectionalLight("#9db8ff", 0.4);
  fill.position.set(0, -1, 0.8);
  scene.add(fill);
  const camera = new PerspectiveCamera();
  const fixed = new Group();
  const slotted = new Group();
  scene.add(fixed, slotted);
  let fr = frame;
  let region: Region | null = null;
  let f = 1;
  let built: DeckGeometry | null = null;
  let slotsOf: readonly Slot[] | null = null;
  let parts: DeckPart[] = [];
  let slotParts: DeckPart[] = [];
  /** Merged geometries of the slots' fixed pieces, replaced with the slots. */
  let slotMerged: BufferGeometry[] = [];
  /** What the kit kept before the slots were built, so a rebuild can let go of the old ones. */
  let slotMark = -1;
  let prepared = false;

  // The backdrop: painted per layout (it shows each table's lane).
  const bgMat = kit.keep(new MeshBasicMaterial({ color: "#ffffff" }));
  const bg = new Mesh(kit.geo.quad, bgMat);
  fixed.add(bg);
  const bgCanvas = document.createElement("canvas");
  let bgTex: CanvasTexture | null = null;

  const gold = kit.keep(
    new MeshPhongMaterial({
      color: "#ffcc33",
      specular: "#fff3c0",
      shininess: 120,
      envMap: kit.env,
      reflectivity: 0.5,
    }),
  );
  const balls = createBallLayer(kit, DECK_MAX + 10, gold);
  for (const m of balls.root) scene.add(m);

  // Gift icons, for bubbles and for tokens on their way down.
  const icons = Object.fromEntries(
    GIFTS.map((k) => [
      k,
      kit.basic("#ffffff", {
        map: kit.paint(128, 128, (g) => drawGiftIcon(g, k, 64, 64, 60, GIFT_COLOR[k])),
      }),
    ]),
  ) as Record<Gift, MeshBasicMaterial>;
  const bubbleModel = (k: Gift): Object3D => {
    if (look.deck.bubble) return look.deck.bubble(kit, k, icons[k]);
    const g = new Group();
    const shell = new Mesh(kit.geo.sphere, kit.phong("#bfe6ff", { opacity: 0.28, shininess: 140 }));
    const icon = new Mesh(kit.geo.quad, icons[k]);
    icon.scale.set(1.15, 1.15, 1);
    icon.position.z = 1.02;
    g.add(shell, icon);
    return g;
  };
  const bubbles = Array.from({ length: MAX_BUBBLES + 2 }, () => {
    const byKind = Object.fromEntries(GIFTS.map((k) => [k, bubbleModel(k)])) as Record<
      Gift,
      Object3D
    >;
    const g = new Group();
    for (const m of Object.values(byKind)) {
      m.visible = false;
      g.add(m);
    }
    const popMat = kit.keep(kit.basic("#ffffff", { additive: true }).clone());
    const ring = new Mesh(kit.geo.ring, popMat);
    ring.visible = false;
    g.add(ring);
    scene.add(g);
    return { g, byKind, ring, popMat };
  });
  const tokens = Array.from({ length: MAX_TOKENS }, () => {
    const m = new Mesh(kit.geo.quad, icons.double);
    m.visible = false;
    scene.add(m);
    return m;
  });

  // The board: the shared total, and each table's score over its slot.
  let total: TextPlane | null = null;
  let totalKey = "";
  const columns: { plane: TextPlane; key: string }[] = [];
  const beams: { mesh: Mesh; mat: MeshBasicMaterial }[] = [];

  const totalBox = (geo: DeckGeometry) => {
    const size = geo.totalSize ?? Math.min(geo.W * 0.06, geo.H * 0.07);
    const ty = geo.ceiling + geo.U * 2.6 + size * 0.75;
    return { size, ty, w: size * 7, h: size * 1.9 };
  };

  const paintBg = (geo: DeckGeometry) => {
    const k = Math.min(1, 2048 / geo.W, 2048 / geo.H, fr.unit * fr.pixelRatio * f);
    bgCanvas.width = Math.max(2, Math.round(geo.W * k));
    bgCanvas.height = Math.max(2, Math.round(geo.H * k));
    const g = bgCanvas.getContext("2d");
    if (g) {
      g.scale(bgCanvas.width / geo.W, bgCanvas.height / geo.H);
      if (look.deck.background) {
        look.deck.background(g, geo);
      } else {
        const grad = g.createLinearGradient(0, 0, 0, geo.H);
        grad.addColorStop(0, look.palette.fieldTop);
        grad.addColorStop(1, look.palette.fieldLow);
        g.fillStyle = grad;
        g.fillRect(0, 0, geo.W, geo.H);
      }
      // Each table's colour, faintly, over its own part of the floor.
      for (const s of geo.slots) {
        const c = palette[s.color % palette.length] ?? AMBER;
        const lane = g.createLinearGradient(0, geo.edgeY - geo.H * 0.2, 0, geo.H);
        lane.addColorStop(0, withAlpha(c, 0));
        lane.addColorStop(1, withAlpha(c, 0.16));
        g.fillStyle = lane;
        g.fillRect(s.x0, geo.edgeY - geo.H * 0.2, s.x1 - s.x0, geo.H);
      }
      g.strokeStyle = withAlpha("#cfe6ff", 0.18);
      g.lineWidth = Math.max(2, geo.R * 0.12);
      g.setLineDash([geo.R, geo.R * 0.8]);
      g.beginPath();
      g.moveTo(0, geo.railY);
      g.lineTo(geo.W, geo.railY);
      g.stroke();
    }
    bgTex?.dispose();
    bgTex = new CanvasTexture(bgCanvas);
    bgTex.colorSpace = SRGBColorSpace;
    bgMat.map = bgTex;
    bgMat.needsUpdate = true;
    bg.scale.set(geo.W, geo.H, 1);
    at(bg, geo.W / 2, geo.H / 2, 0);
  };

  const buildFixed = (geo: DeckGeometry) => {
    const U = geo.U;
    const add = (p: DeckPart) => {
      parts.push(p);
      fixed.add(p.root);
    };
    add(skin.walls(kit, geo.walls, [...geo.posts, ...geo.captive.posts], U, colors));
    add(skin.pops(kit, geo.pops, colors));
    add(skin.big(kit, geo, colors));
    geo.cluster.bumpers.forEach((c, i) => add(skin.cluster(kit, c, i, colors)));
    add(skin.shuttle(kit, geo, colors));
    add(skin.mushrooms(kit, geo.mushrooms, colors));
    geo.slings.forEach((s, i) => add(skin.sling(kit, s, i, colors)));
    add(skin.stars(kit, geo.stars, colors));
    geo.magnets.forEach((m, i) => add(skin.magnet(kit, m, i, colors)));
    geo.saucers.forEach((s, i) => add(skin.saucer(kit, s, i, colors)));
    add(skin.scoop(kit, geo.vuk, colors));
    add(skin.lock(kit, geo.lock, U, colors));
    add(skin.captive(kit, geo.captive, U, colors));
    add(skin.nest(kit, geo.nest, U, colors));
    geo.spinners.forEach((g, i) => add(skin.spinner(kit, g, i, U, colors)));
    geo.rails.forEach((r) => add(skin.rail(kit, r, U, colors)));
    for (const g of mergeStatic(
      fixed,
      parts.map((p) => ({ root: p.root, whole: !p.sync })),
    )) {
      kit.keep(g);
    }
    const tb = totalBox(geo);
    total = createTextPlane(
      kit,
      geo.W / 2,
      tb.ty + tb.size * 0.25,
      U * 2,
      tb.w,
      tb.h,
      Math.min(1, 1024 / tb.w),
    );
    fixed.add(total.mesh);
  };

  const buildSlots = (geo: DeckGeometry) => {
    for (const p of slotParts) {
      slotted.remove(p.root);
      p.dispose?.();
    }
    for (const g of slotMerged) g.dispose();
    slotMerged = [];
    if (slotMark >= 0) kit.releaseSince(slotMark);
    slotMark = kit.mark();
    // Merged meshes are the slotted group's own children.
    for (const c of slotted.children.filter((x) => x.userData.merged)) slotted.remove(c);
    slotParts = [];
    for (const c of columns) {
      slotted.remove(c.plane.mesh);
      c.plane.dispose();
    }
    columns.length = 0;
    for (const b of beams) slotted.remove(b.mesh);
    beams.length = 0;
    const add = (p: DeckPart) => {
      slotParts.push(p);
      slotted.add(p.root);
    };
    // The floor over the holes is a wall like the rest.
    add(plainDeck.walls(kit, geo.floor, [], geo.R * 1.1, colors));
    geo.slots.forEach((s, i) => {
      const c = palette[s.color % palette.length] ?? AMBER;
      const pillar = geo.pillars[i];
      if (pillar) add(skin.chute(kit, s, pillar, geo, c));
      add(skin.hole(kit, s, geo, c));
      const t = geo.targets[i];
      if (t) add(skin.target(kit, t, i, geo, c));
      const mat = kit.keep(kit.basic(c, { additive: true }).clone());
      const mesh = new Mesh(kit.geo.quad, mat);
      mesh.scale.set(geo.R * 3.2, geo.holeY - geo.ceiling, 1);
      at(mesh, s.holeX, (geo.holeY + geo.ceiling) / 2, geo.U * 3);
      mesh.visible = false;
      slotted.add(mesh);
      beams.push({ mesh, mat });
      if (geo.columns !== false) {
        const w = s.x1 - s.x0;
        const size = Math.min(w * 0.2, geo.R * 4.2);
        const base = geo.launchY - geo.R * 3;
        const plane = createTextPlane(
          kit,
          (s.x0 + s.x1) / 2,
          base - size * 0.3,
          geo.U,
          w,
          size * 1.6,
          Math.min(1, 512 / w),
        );
        slotted.add(plane.mesh);
        columns.push({ plane, key: "" });
      }
    });
    slotMerged = mergeStatic(
      slotted,
      slotParts.map((p) => ({ root: p.root, whole: !p.sync })),
    );
  };

  const paintTotal = (deck: Deck, time: number) => {
    const geo = deck.geo;
    const frac = (deck.total % RAIN_STEP) / RAIN_STEP;
    const blink = frac > 0.9 && Math.sin(time * 4) > 0;
    const k = `${deck.total}|${Math.round(frac * 200)}|${blink}`;
    if (k === totalKey || !total) return;
    totalKey = k;
    const tb = totalBox(geo);
    total.draw((g) => {
      const { size, w } = tb;
      const cy = size * 0.7;
      g.font = `800 ${size}px ${FONT}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = "rgba(0,0,0,0.5)";
      g.fillText(formatScore(deck.total), w / 2 + size * 0.04, cy + size * 0.04);
      g.fillStyle = "#f2f5fa";
      g.fillText(formatScore(deck.total), w / 2, cy);
      const bw = size * 5;
      const by = cy + size * 0.68;
      g.fillStyle = "rgba(242,245,250,0.15)";
      g.beginPath();
      g.roundRect(w / 2 - bw / 2, by, bw, size * 0.14, size * 0.07);
      g.fill();
      g.fillStyle = AMBER;
      g.beginPath();
      g.roundRect(w / 2 - bw / 2, by, Math.max(size * 0.14, bw * frac), size * 0.14, size * 0.07);
      g.fill();
      if (blink) {
        g.strokeStyle = AMBER;
        g.lineWidth = size * 0.04;
        g.stroke();
      }
    });
  };

  const paintColumns = (deck: Deck) => {
    const geo = deck.geo;
    geo.slots.forEach((s, i) => {
      const col = columns[i];
      if (!col) return;
      const k = s.frame ? `${s.score}|${s.playing}` : "";
      if (k === col.key) return;
      col.key = k;
      const w = s.x1 - s.x0;
      const size = Math.min(w * 0.2, geo.R * 4.2);
      const c = palette[s.color % palette.length] ?? AMBER;
      col.plane.draw((g) => {
        if (!s.frame) return;
        const text = formatScore(s.score);
        g.font = `800 ${size}px ${FONT}`;
        const fit = Math.min(1, (w * 0.9) / Math.max(1, g.measureText(text).width));
        if (fit < 1) g.font = `800 ${size * fit}px ${FONT}`;
        g.textAlign = "center";
        g.textBaseline = "alphabetic";
        g.fillStyle = s.playing ? c : withAlpha(c, 0.35);
        g.fillText(text, w / 2, size * 1.1);
      });
    });
  };

  const frameOf = (deck: Deck, alpha: number, time: number): DeckFrame => ({
    deck,
    alpha,
    time,
    now: deck.clock,
    palette,
    flash(tag, index, s = 0.3) {
      const a = deck.flashAge(tag, index);
      return a < s ? 1 - a / s : 0;
    },
  });

  const syncDynamic = (deck: Deck, fd: DeckFrame) => {
    const geo = deck.geo;
    const pal = (c: number) => palette[c % palette.length] ?? AMBER;
    balls.begin();
    const cap = deck.parts.captive;
    balls.add(
      cap.px + (cap.x - cap.px) * fd.alpha,
      cap.py + (cap.y - cap.py) * fd.alpha,
      cap.r,
      cap.r,
      null,
      1,
    );
    for (const b of deck.balls) {
      const x = b.phase === "free" ? b.px + (b.x - b.px) * fd.alpha : b.x;
      const y = b.phase === "free" ? b.py + (b.y - b.py) * fd.alpha : b.y;
      if (y - b.r > geo.H) continue;
      balls.add(x, y, ballHeight(geo, y, b.r, b.phase), b.r, pal(b.color));
    }
    balls.end();
    const br = geo.bubbles.r;
    const list = deck.parts.bubbles.list;
    bubbles.forEach((slot, i) => {
      const b = list[i];
      for (const k of GIFTS) slot.byKind[k].visible = false;
      slot.ring.visible = false;
      if (!b) return;
      if (b.popAt === Infinity) {
        const m = slot.byKind[b.kind];
        m.visible = true;
        m.scale.setScalar(br);
        at(m, b.x, b.y, br);
      } else {
        const k = Math.min(1, (fd.now - b.popAt) / 600);
        slot.ring.visible = true;
        slot.ring.scale.setScalar(br * (1 + k * 1.2));
        at(slot.ring, b.x, b.y, geo.U);
        slot.popMat.color.set(GIFT_COLOR[b.kind]).multiplyScalar(1 - k);
      }
    });
    tokens.forEach((m, i) => {
      const t = deck.parts.tokens[i];
      m.visible = t !== undefined && t.y - geo.U * 1.2 <= geo.H;
      if (!t || !m.visible) return;
      m.material = icons[t.kind];
      const r = geo.U * 1.1;
      m.scale.set(r * 2, r * 2, 1);
      at(m, t.x, t.y, geo.U * 1.5);
    });
    geo.slots.forEach((_, i) => {
      const b = beams[i];
      if (!b) return;
      const k = fd.flash("rain", i);
      b.mesh.visible = k > 0;
      b.mat.color.set(pal(geo.slots[i]!.color)).multiplyScalar(0.35 * k);
    });
  };

  const fit = () => {
    if (!built) return;
    const geo = built;
    const distance = 1.15 * Math.max(geo.W, geo.H);
    fitStraight(
      camera,
      geo.W / 2,
      geo.H / 2,
      distance,
      { x0: 0, y0: 0, x1: geo.W, y1: geo.H },
      {
        near: distance * 0.3,
        far: distance * 1.2,
      },
    );
  };

  return {
    resize(fm, reg, scale = 1) {
      fr = fm;
      region = reg ?? null;
      f = scale;
      if (own) r3.resize(fm);
      if (built) paintBg(built);
    },
    draw(deck, alpha, time) {
      const geo = deck.geo;
      if (!built) {
        built = geo;
        buildFixed(geo);
        fit();
      }
      if (slotsOf !== geo.slots) {
        slotsOf = geo.slots;
        buildSlots(geo);
        paintBg(geo);
      }
      const fd = frameOf(deck, alpha, time);
      for (const p of parts) p.sync?.(fd);
      for (const p of slotParts) p.sync?.(fd);
      syncDynamic(deck, fd);
      paintTotal(deck, time);
      paintColumns(deck);
      if (!prepared) {
        r3.prepare(scene, camera);
        prepared = true;
      }
      if (!r3.ready) return;
      const R = r3.renderer;
      const u = fr.unit;
      const v = region ?? { x: 0, y: 0, w: fr.width / u, h: fr.height / u };
      const x = v.x * u;
      const y = fr.height - (v.y + v.h) * u;
      R.autoClear = true;
      R.setClearColor(look.palette.cabinet, 1);
      R.setScissorTest(true);
      R.setViewport(x, y, v.w * u, v.h * u);
      R.setScissor(x, y, v.w * u, v.h * u);
      R.render(scene, camera);
      R.setScissorTest(false);
    },
    dispose() {
      for (const p of [...parts, ...slotParts]) p.dispose?.();
      total?.dispose();
      for (const c of columns) c.plane.dispose();
      bgTex?.dispose();
      bgCanvas.width = 0;
      kit.dispose();
      if (own) r3.dispose();
    },
  };
};
