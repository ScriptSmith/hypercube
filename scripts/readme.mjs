#!/usr/bin/env node
// Builds the README's pictures and its tables of pieces from the app manifests.
//
//   pnpm readme
//
// Writes .github/readme/pieces.svg: every piece a visitor can choose, with its gallery thumbnail
// from public/thumbs/, its title, the start of its blurb and the gallery's setup chips, scrolling
// sideways in a loop. A piece with further looks (`thumb.looks`) cross-fades between them. The
// thumbnails are scaled down in Chromium and embedded as data URIs, because GitHub shows README
// images inside <img>, where an SVG can't load anything else.
// Writes public/social-preview.png, the picture for links to the site and the repository: the
// site's mark and name over every thumbnail. Writes .github/readme/logo.svg, the moving mark
// for the README's heading. It also rewrites the tables of pieces in README.md between the `pieces:start`
// and `pieces:end` comments, then formats README.md. Each row's picture is
// .github/readme/thumbs/<id>.svg, the piece's thumbnail cross-fading through its looks as in the strip.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { discoverApps, importTs, ROOT } from "./lib/apps.mjs";
import { launchChromium } from "./lib/browser.mjs";
import { appKinds, KIND_ORDER } from "./lib/play.mjs";

const SITE = "https://hypercube.adsm.dev/";
const OUT = join(ROOT, ".github/readme/pieces.svg");
const SOCIAL = join(ROOT, "public/social-preview.png");
const LOGO = join(ROOT, ".github/readme/logo.svg");
const CELLS = join(ROOT, ".github/readme/thumbs");
const README = join(ROOT, "README.md");
const START = "<!-- pieces:start -->";
const END = "<!-- pieces:end -->";

const FONT = `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
const VIEW = { width: 880, pad: 18 };
const CARD = { width: 256, gap: 20, radius: 10, inset: 14, bar: 4 };
const THUMB = { width: 256, height: 160 };
/** Embedded pictures are twice the size they are drawn, so they stay sharp on dense screens. */
const IMAGE = {
  width: THUMB.width * 2,
  height: THUMB.height * 2,
  type: "image/webp",
  quality: 0.8,
};
/** The tables' pictures, at the thumbnails' own size; the README draws them 384 px wide. */
const CELL = { width: 640, height: 400, type: "image/webp", quality: 0.8 };
/** Further looks are encoded at lower qualities, in turn, until the strip fits its budget. */
const LOOK_QUALITIES = [0.8, 0.7, 0.6, 0.5];
const BUDGET = 1.5 * 1024 * 1024;
/** Seconds each look of a card shows, and how long a cross-fade between two takes. */
const HOLD = 4;
const FADE = 1;
const GOLDEN = 0.618033988749895;
const TITLE = { size: 16, gap: 25 };
const TEXT = { size: 13, line: 17.5, lines: 3, gap: 21 };
/** The gallery card's setup chips, from `.chip` in src/pages/landing/landing.css. */
const CHIP = { size: 11.5, height: 23, pad: 6, gap: 6, kindGap: 3, between: 4, top: 14 };
/** Units per second. */
const SPEED = 80;

const COLOURS = {
  background: "#0b0e16",
  card: "#121725",
  line: "#262e40",
  ink: "#eef1f7",
  muted: "#8d97ab",
  faint: "#626c80",
  accent: "#ffcc33",
};

/** The brand is narrow enough to keep 40 px clear inside a square crop of the middle. */
const PREVIEW = { width: 1280, height: 640, margin: 40, side: 16, gap: 8, radius: 6, font: 76 };

/** As the landing gallery groups pieces, by category whatever displays they run on. */
const GROUPS = [
  { id: "game", title: "Games" },
  { id: "visual", title: "Visualisations and learning pieces" },
];

const escapeXml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const escapeMd = (s) => s.replace(/\|/g, "\\|");

const round = (n) => Math.round(n * 10) / 10;

/**
 * Runs in the page. Scales thumbnails down to data URIs, each with the share of it that is close
 * to black.
 */
const encode = async ({ pngs, image, quality }) => {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingQuality = "high";
  const out = [];
  for (const png of pngs) {
    const img = new Image();
    img.src = `data:image/png;base64,${png}`;
    await img.decode();
    g.drawImage(img, 0, 0, image.width, image.height);
    const px = g.getImageData(0, 0, image.width, image.height).data;
    let black = 0;
    for (let i = 0; i < px.length; i += 16) {
      if (px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722 < 16) black++;
    }
    out.push({ data: canvas.toDataURL(image.type, quality), dark: black / (px.length / 16) });
  }
  return out;
};

/**
 * Runs in the page. Fits each blurb into a few lines: the first sentence when it fits, or else the
 * longest part of it that ends at a colon or semicolon, then at a comma, and as a last resort a cut
 * with an ellipsis. Widths come from this machine's system font, which may be a little wider or
 * narrower than a reader's.
 */
const prepare = async ({ items, font, title, text, chip }) => {
  const canvas = document.createElement("canvas");
  const g = canvas.getContext("2d");
  const measure = (s, css) => {
    g.font = css;
    return g.measureText(s).width;
  };
  const textFont = `${text.size}px ${font}`;
  const wrap = (s) => {
    const lines = [];
    let line = "";
    for (const word of s.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next, textFont) > text.width) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };
  const fits = (s) => wrap(s).length <= text.lines;
  const sentence = (s) => s.trim().match(/^.*?[.!?](?=\s|$)/)?.[0] ?? s.trim();
  const prefixes = (s, re, min) =>
    [...s.matchAll(re)]
      .map((m) => s.slice(0, m.index).trim())
      .filter((p) => p.length >= min && fits(`${p}.`));
  const shorten = (blurb) => {
    const first = sentence(blurb);
    if (fits(first)) return { text: first, cut: false };
    // A short part before a comma is often the start of a list ("Fling rocks, planets").
    for (const [re, min] of [
      [/[:;](?=\s)/g, 12],
      [/,(?=\s)/g, 40],
    ]) {
      const best = prefixes(first, re, min).at(-1);
      if (best) return { text: `${best}.`, cut: false };
    }
    const words = first.split(/\s+/);
    while (words.length > 1 && !fits(`${words.join(" ")}…`)) words.pop();
    return { text: `${words.join(" ").replace(/[,;:]$/, "")}…`, cut: true };
  };
  const titleFont = (size) => `700 ${size}px ${font}`;

  const out = [];
  for (const item of items) {
    let titleSize = title.size;
    while (titleSize > 11 && measure(item.title, titleFont(titleSize)) > text.width)
      titleSize -= 0.5;
    const short = shorten(item.blurb);
    out.push({ id: item.id, titleSize, lines: wrap(short.text), cut: short.cut });
  }
  const labels = Object.fromEntries(
    chip.labels.map((l) => [l, measure(l, `550 ${chip.size}px ${font}`)]),
  );
  return { items: out, labels };
};

const setupTitle = (setup) => setup[0].toUpperCase() + setup.slice(1);

/** The site's kind glyphs as symbols, so each card only refers to them. */
const glyphSymbols = (kindGlyph) =>
  Object.fromEntries(
    KIND_ORDER.map((kind) => {
      const m = kindGlyph(kind).match(
        /width="([\d.]+)" height="([\d.]+)" viewBox="([^"]+)"[^>]*>(.*)<\/svg>$/,
      );
      if (!m) throw new Error(`unexpected glyph for ${kind}`);
      const [, width, height, viewBox, inner] = m;
      return [
        kind,
        {
          width: Number(width),
          height: Number(height),
          symbol: `<symbol id="k-${kind}" viewBox="${viewBox}">${inner}</symbol>`,
        },
      ];
    }),
  );

/** A card's setup chips as the gallery shows them, wrapped into rows of the text's width. */
const layoutChips = (app, labels, glyphs, width) => {
  const rows = [[]];
  let x = 0;
  for (const s of app.setups) {
    const label = setupTitle(s.setup);
    const kinds = KIND_ORDER.filter((k) => s.kinds.includes(k));
    const kindsWidth =
      kinds.reduce((sum, k) => sum + glyphs[k].width, 0) + CHIP.kindGap * (kinds.length - 1);
    const w = Math.ceil(2 + CHIP.pad * 2 + labels[label] + CHIP.gap + kindsWidth);
    if (x > 0 && x + w > width) {
      rows.push([]);
      x = 0;
    }
    rows.at(-1).push({ x, w, label, labelWidth: labels[label], kinds });
    x += w + CHIP.between;
  }
  return rows;
};

const chipSvg = (chip, y, glyphs) => {
  let gx = 1 + CHIP.pad + chip.labelWidth + CHIP.gap;
  const kinds = chip.kinds
    .map((k) => {
      const { width, height } = glyphs[k];
      const use = `<use href="#k-${k}" x="${round(gx)}" y="${round((CHIP.height - height) / 2)}" width="${width}" height="${height}"/>`;
      gx += width + CHIP.kindGap;
      return use;
    })
    .join("");
  return (
    `<g transform="translate(${chip.x} ${y})">` +
    `<rect class="chip" x="0.5" y="0.5" width="${chip.w - 1}" height="${CHIP.height - 1}" rx="3"/>` +
    `<text class="c" x="${1 + CHIP.pad}" y="${CHIP.height / 2}">${chip.label}</text>` +
    `<g class="k">${kinds}</g></g>`
  );
};

const titleY = THUMB.height + CARD.bar + TITLE.gap;
const chipsY = titleY + TEXT.gap + (TEXT.lines - 1) * TEXT.line + CHIP.top;

const cardHeight = (chipRows) =>
  chipsY + chipRows * CHIP.height + (chipRows - 1) * CHIP.between + CARD.inset;

/** Keyframes for look `k` of `n`: it fades in over the look before and stays until the next is in. */
const lookKeyframes = (n, k) => {
  const cycle = n * HOLD;
  const pct = (t) => `${Math.round((t / cycle) * 1e4) / 100}%`;
  const stops = [
    [0, 0],
    [k * HOLD - FADE, 0],
    [k * HOLD, 1],
    ...(k < n - 1
      ? [
          [(k + 1) * HOLD, 1],
          [(k + 1) * HOLD + 0.01, 0],
        ]
      : [[cycle - FADE, 1]]),
    [cycle, 0],
  ];
  return `@keyframes f${n}-${k}{${stops.map(([t, o]) => `${pct(t)}{opacity:${o};}`).join("")}}`;
};

/** Each look after the first fades in and out on its own animation, all `delay` seconds along. */
const fadeCss = (n, delay = 0) =>
  Array.from({ length: n - 1 }, (_, i) => {
    const k = i + 1;
    const start = delay ? ` -${delay}s` : "";
    return `.f${n}-${k}{animation:f${n}-${k} ${n * HOLD}s ease-in-out${start} infinite;}\n${lookKeyframes(n, k)}`;
  }).join("\n");

/** How far along its turns piece `i` of `n` looks starts, so neighbours change at different moments. */
const delayOf = (i, n) => Math.round(((i * GOLDEN) % 1) * n * HOLD * 10) / 10;

/** A table row's picture: the thumbnail, cross-fading through its looks like a card in the strip. */
const cellSvg = (app, looks, index) => {
  const n = looks.length;
  const { width, height } = CELL;
  const style =
    n > 1
      ? `<style>\n.x{opacity:0;}\n${fadeCss(n, delayOf(index, n))}\n@media (prefers-reduced-motion:reduce){.x{animation:none;}}\n</style>\n`
      : "";
  const images = looks
    .map(
      (data, k) =>
        `<image${k ? ` class="x f${n}-${k}"` : ""} width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" href="${data}"/>`,
    )
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title">
<title id="title">${escapeXml(app.title)}</title>
${style}${images}
</svg>
`;
};

/** A card's looks, stacked on its first picture, each showing in turn. */
const thumbSvg = (app, looks) => {
  const n = looks.length;
  const uses = looks
    .map((_, k) =>
      k === 0
        ? `<use href="#i-${app.id}-0"/>`
        : `<use class="x f${n}-${k}" href="#i-${app.id}-${k}"/>`,
    )
    .join("");
  return `<g class="c-${app.id}" clip-path="url(#thumb)">${uses}</g>`;
};

/** Each card starts its turns at its own point, so cards side by side change at different moments. */
const lookDelays = (apps, prepared) =>
  apps
    .map((app, i) => [app, prepared.get(app.id).looks.length, i])
    .filter(([, n]) => n > 1)
    .map(([app, n, i]) => `.c-${app.id} .x{animation-delay:-${delayOf(i, n)}s;}`)
    .join("\n");

const card = (app, prepared, chipRows, glyphs, x, y, colour, height) => {
  const textX = CARD.inset;
  const lines = prepared.lines
    .map(
      (line, i) =>
        `<text class="d" x="${textX}" y="${round(titleY + TEXT.gap + i * TEXT.line)}">${escapeXml(line)}</text>`,
    )
    .join("");
  const titleStyle = prepared.titleSize === TITLE.size ? "" : ` font-size="${prepared.titleSize}"`;
  return (
    `<g transform="translate(${x} ${y})">` +
    `<rect class="card" width="${CARD.width}" height="${height}" rx="${CARD.radius}"/>` +
    thumbSvg(app, prepared.looks) +
    `<rect y="${THUMB.height}" width="${CARD.width}" height="${CARD.bar}" fill="${colour}"/>` +
    `<text class="t" x="${textX}" y="${titleY}"${titleStyle}>${escapeXml(app.title)}</text>` +
    lines +
    // Chips sit at the foot of the card, so single rows line up along the strip.
    `<g transform="translate(${textX} ${height - cardHeight(chipRows.length) + chipsY})">` +
    chipRows
      .flatMap((row, r) =>
        row.map((chip) => chipSvg(chip, r * (CHIP.height + CHIP.between), glyphs)),
      )
      .join("") +
    `</g></g>`
  );
};

const buildSvg = (apps, prepared, chips, glyphs, colourOf) => {
  const pitch = CARD.width + CARD.gap;
  const loop = apps.length * pitch;
  // Every card is as tall as the one with the most rows of chips.
  const inner = cardHeight(Math.max(...apps.map((a) => chips.get(a.id).length)));
  const height = Math.ceil(inner + VIEW.pad * 2);
  const y = VIEW.pad;
  const x0 = CARD.gap;
  const cardAt = (app, x) =>
    card(app, prepared.get(app.id), chips.get(app.id), glyphs, x, y, colourOf(app.id), inner);
  const cards = apps.map((app, i) => cardAt(app, x0 + i * pitch)).join("\n");
  // Copies of the first cards follow the last, so the strip shows no gap when it starts over.
  // They are whole cards rather than <use> copies, so their cross-fades run in step with the
  // originals in every browser; the pictures themselves are only referred to.
  const copies = Math.ceil(VIEW.width / pitch) + 1;
  const clones = apps
    .slice(0, copies)
    .map((app, i) => cardAt(app, loop + x0 + i * pitch))
    .join("\n");
  const images = apps
    .flatMap((app) =>
      prepared
        .get(app.id)
        .looks.map(
          (data, k) =>
            `<image id="i-${app.id}-${k}" width="${THUMB.width}" height="${THUMB.height}" preserveAspectRatio="xMidYMid slice" href="${data}"/>`,
        ),
    )
    .join("\n");
  const counts = [...new Set(apps.map((a) => prepared.get(a.id).looks.length))].filter(
    (n) => n > 1,
  );
  const fades = counts.map((n) => fadeCss(n)).join("\n");
  const r = CARD.radius;
  const fade = 36;
  const seconds = Math.round(loop / SPEED);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${VIEW.width}" height="${height}" viewBox="0 0 ${VIEW.width} ${height}" role="img" aria-labelledby="title">
<title id="title">Hypercube pieces: ${escapeXml(apps.map((a) => a.title).join(", "))}</title>
<style>
text{font-family:${FONT};}
.t{font-size:${TITLE.size}px;font-weight:700;fill:${COLOURS.ink};}
.d{font-size:${TEXT.size}px;fill:${COLOURS.muted};}
.card{fill:${COLOURS.card};stroke:${COLOURS.line};stroke-width:1;}
.chip{fill:${COLOURS.background};stroke:${COLOURS.line};stroke-width:1;}
.c{font-size:${CHIP.size}px;font-weight:550;fill:${COLOURS.muted};dominant-baseline:central;}
.k{color:${COLOURS.faint};}
.track{animation:scroll ${seconds}s linear infinite;}
@keyframes scroll{from{transform:translateX(0);}to{transform:translateX(-${loop}px);}}
.x{opacity:0;}
${fades}
${lookDelays(apps, prepared)}
@media (prefers-reduced-motion:reduce){.track,.x{animation:none;}}
</style>
<defs>
${KIND_ORDER.map((k) => glyphs[k].symbol).join("\n")}
${images}
<clipPath id="view"><rect width="${VIEW.width}" height="${height}" rx="12"/></clipPath>
<clipPath id="thumb"><path d="M0 ${THUMB.height}V${r}A${r} ${r} 0 0 1 ${r} 0H${THUMB.width - r}A${r} ${r} 0 0 1 ${THUMB.width} ${r}V${THUMB.height}Z"/></clipPath>
<linearGradient id="fade-l"><stop offset="0" stop-color="${COLOURS.background}"/><stop offset="1" stop-color="${COLOURS.background}" stop-opacity="0"/></linearGradient>
<linearGradient id="fade-r"><stop offset="0" stop-color="${COLOURS.background}" stop-opacity="0"/><stop offset="1" stop-color="${COLOURS.background}"/></linearGradient>
</defs>
<g clip-path="url(#view)">
<rect width="${VIEW.width}" height="${height}" fill="${COLOURS.background}"/>
<g class="track">
${cards}
${clones}
</g>
<rect width="${fade}" height="${height}" fill="url(#fade-l)"/>
<rect x="${VIEW.width - fade}" width="${fade}" height="${height}" fill="url(#fade-r)"/>
</g>
</svg>
`;
};

/** The site's mark at rest, drawn as `createMark` in src/pages/landing/mark.ts draws it. */
const markSvg = (corners, size) => {
  const lines = [];
  corners.forEach((p, i) => {
    for (let axis = 0; axis < 4; axis++) {
      const q = corners[i ^ (1 << axis)];
      if ((i ^ (1 << axis)) < i) continue;
      const depth = (p.w + q.w) / (4 * Math.SQRT2) + 0.5;
      lines.push(
        `<line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" stroke-opacity="${0.55 + 0.45 * depth}"/>`,
      );
    }
  });
  return (
    `<svg viewBox="0 0 20 20" width="${size}" height="${size}">` +
    `<g fill="none" stroke="${COLOURS.accent}" stroke-width="1.6" stroke-linecap="round">` +
    `${lines.join("")}</g></svg>`
  );
};

/**
 * The landing page's moving mark on the site's dark tile, so it reads on light pages too. Scripts
 * don't run in README images, so its turns are sampled into SMIL keyframes: a rest, then a
 * quarter turn through each plane in turn, as `createMark` plays them. A quarter turn maps the
 * tesseract onto itself, so each line jumps back to its starting place unseen after each pass.
 */
const logoSvg = ({ projectTesseract, EDGES, PLANES, PASS_MS, REST_MS, ease }) => {
  const STEPS = 12;
  const cycle = PLANES.length * (REST_MS + PASS_MS);
  const jump = 1;
  const frames = [{ ms: 0, plane: PLANES[0], angle: 0 }];
  PLANES.forEach((plane, i) => {
    const start = i * (REST_MS + PASS_MS) + REST_MS;
    if (i > 0) frames.push({ ms: start - REST_MS + jump, plane, angle: 0 });
    frames.push({ ms: start, plane, angle: 0 });
    for (let k = 1; k <= STEPS; k++) {
      frames.push({
        ms: start + (PASS_MS * k) / STEPS,
        plane,
        angle: (ease(k / STEPS) * Math.PI) / 2,
      });
    }
  });
  const r2 = (n) => String(Math.round(n * 100) / 100);
  const keyTimes = frames.map((f) => String(Math.round((f.ms / cycle) * 1e5) / 1e5)).join(";");
  const shots = frames.map((f) => projectTesseract(f.plane, f.angle));
  const depth = (p, q) => 0.55 + 0.45 * ((p.w + q.w) / (4 * Math.SQRT2) + 0.5);
  const attrs = {
    x1: (p) => p.x,
    y1: (p) => p.y,
    x2: (_, q) => q.x,
    y2: (_, q) => q.y,
    "stroke-opacity": depth,
  };
  const lines = EDGES.map(([i, j]) => {
    const at = (s) => [s[i], s[j]];
    const still = Object.entries(attrs)
      .map(([name, f]) => `${name}="${r2(f(...at(shots[0])))}"`)
      .join(" ");
    const moves = Object.entries(attrs)
      .map(
        ([name, f]) =>
          `<animate attributeName="${name}" dur="${cycle / 1000}s" repeatCount="indefinite" ` +
          `keyTimes="${keyTimes}" values="${shots.map((s) => r2(f(...at(s)))).join(";")}"/>`,
      )
      .join("");
    return `<line ${still}>${moves}</line>`;
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1.5 -1.5 23 23" width="64" height="64">` +
    `<rect x="-1.5" y="-1.5" width="23" height="23" rx="4.5" fill="${COLOURS.background}"/>` +
    `<g fill="none" stroke="${COLOURS.accent}" stroke-width="1.6" stroke-linecap="round">` +
    `${lines.join("")}</g></svg>\n`
  );
};

/** Rows that widen to the middle and narrow again, such as 8, 9, 10, 9, 8 for 44. */
const hexRows = (n) => {
  const m = Math.ceil((n + 6) / 5);
  const rows = [m - 2, m - 1, m, m - 1, m - 2];
  let extra = rows.reduce((a, b) => a + b) - n;
  for (let i = 0; extra > 0; i++, extra--) rows[i % 2 ? 4 : 0]--;
  return rows;
};

/** Thumbnails that are mostly black are spread out rather than bunched. */
const spread = (apps, darkShare) => {
  const dark = apps.filter((a) => darkShare.get(a.id) > 0.5);
  const out = apps.filter((a) => !dark.includes(a));
  dark.forEach((a, k) => out.splice(Math.round(((k + 0.5) * apps.length) / dark.length), 0, a));
  return out;
};

/** The social preview: the mark and name as in the landing page's top bar, over the pieces. */
const previewHtml = (apps, mark, png, darkShare) => {
  const P = PREVIEW;
  const rows = hexRows(apps.length);
  const widest = Math.max(...rows);
  const w = (P.width - 2 * P.side - (widest - 1) * P.gap) / widest;
  const h = (w * THUMB.height) / THUMB.width;
  const top = P.height - P.margin - rows.length * h - (rows.length - 1) * P.gap;
  const order = spread(apps, darkShare);
  let i = 0;
  const tiles = rows.flatMap((n, r) => {
    const x0 = (P.width - n * w - (n - 1) * P.gap) / 2;
    return Array.from({ length: n }, (_, c) => {
      const app = order[i++];
      return (
        `<img src="data:image/png;base64,${png.get(app.id)}" style="left:${x0 + c * (w + P.gap)}px;` +
        `top:${top + r * (h + P.gap)}px;width:${w}px;height:${h}px">`
      );
    });
  });
  // The top bar draws the 20 px mark 9 px before 15 px type.
  return `<!doctype html><html><head><style>
body{margin:0;width:${P.width}px;height:${P.height}px;position:relative;overflow:hidden;background:${COLOURS.background};}
img{position:absolute;object-fit:cover;border-radius:${P.radius}px;outline:1px solid ${COLOURS.line};}
.brand{position:absolute;left:0;right:0;top:0;height:${top}px;display:flex;align-items:center;justify-content:center;gap:${(P.font * 9) / 15}px;}
.name{font:700 ${P.font}px/1 ${FONT};letter-spacing:0.01em;color:${COLOURS.ink};}
</style></head><body>
${tiles.join("\n")}
<div class="brand">${markSvg(mark, (P.font * 20) / 15)}<span class="name">Hypercube</span></div>
</body></html>`;
};

const buildIndex = (apps, cells) => {
  const sections = GROUPS.map((group) => {
    const rows = apps
      .filter((a) => a.category === group.id)
      .map((a) => {
        const url = `${SITE}#/${encodeURIComponent(a.id)}`;
        const alt = a.title.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
        const src = cells.has(a.id)
          ? `.github/readme/thumbs/${a.id}.svg`
          : `public/thumbs/${a.id}.png`;
        const shot = `[<img src="${src}" width="384" alt="${alt}">](${url})`;
        const link = `[${escapeMd(a.title)}](${url})`;
        return `| ${shot} | ${link} | ${escapeMd(a.blurb)} | ${appKinds(a).join(", ")} |`;
      });
    return [
      `### ${group.title}`,
      "",
      "| | Piece | What it does | Runs on |",
      "| --- | --- | --- | --- |",
      ...rows,
    ].join("\n");
  });
  return sections.join("\n\n");
};

const writeIndex = (apps, cells) => {
  const text = readFileSync(README, "utf8");
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (start < 0 || end < start) {
    throw new Error(`README.md needs the markers ${START} and ${END}`);
  }
  const next = `${text.slice(0, start + START.length)}\n\n${buildIndex(apps, cells)}\n\n${text.slice(end)}`;
  writeFileSync(README, next);
  execFileSync(join(ROOT, "node_modules/.bin/oxfmt"), [README], {
    stdio: ["ignore", "ignore", "inherit"],
  });
};

const main = async () => {
  const all = await discoverApps();
  // The picker's tools (diagnostics, the picker itself) and hidden apps aren't pieces to show.
  const pieces = all
    .filter((a) => !a.hidden && a.category !== "tool")
    .sort((a, b) => a.title.localeCompare(b.title));
  const thumb = (stem) => join(ROOT, "public/thumbs", `${stem}.png`);
  const apps = pieces.filter((a) => existsSync(thumb(a.id)));
  const { thumbPreviews } = await importTs(join(ROOT, "src/core/thumbs.ts"));
  // Each piece's looks that have a thumbnail, its first one first.
  const stems = new Map(
    apps.map((a) => [
      a.id,
      thumbPreviews(a)
        .map((p) => p.stem)
        .filter((stem) => existsSync(thumb(stem))),
    ]),
  );
  const lookStems = apps.flatMap((a) => stems.get(a.id).slice(1));
  const { PALETTE } = await importTs(join(ROOT, "src/core/ui/palette.ts"));
  // The same colour as the bar under each tile in the picker.
  const byTitle = [...all].sort((a, b) => a.title.localeCompare(b.title));
  const colourOf = (id) =>
    PALETTE.players[
      Math.max(
        0,
        byTitle.findIndex((a) => a.id === id),
      ) % PALETTE.players.length
    ];

  const base64 = (stem) => readFileSync(thumb(stem)).toString("base64");
  const items = apps.map((a) => ({ id: a.id, title: a.title, blurb: a.blurb }));
  const firstPngs = apps.map((a) => base64(a.id));
  const lookPngs = lookStems.map(base64);
  const { kindGlyph } = await importTs(join(ROOT, "src/pages/landing/art.ts"));
  const mark = await importTs(join(ROOT, "src/pages/landing/mark.ts"));
  const { projectTesseract } = mark;
  const glyphs = glyphSymbols(kindGlyph);
  const textWidth = CARD.width - CARD.inset * 2;
  const labels = [...new Set(apps.flatMap((a) => a.setups.map((s) => setupTitle(s.setup))))];

  mkdirSync(join(OUT, ".."), { recursive: true });
  const browser = await launchChromium();
  let text;
  let svg;
  let lookQuality;
  let cells;
  try {
    const page = await browser.newPage();
    text = await page.evaluate(prepare, {
      items,
      font: FONT,
      title: { size: TITLE.size },
      text: { size: TEXT.size, lines: TEXT.lines, width: textWidth },
      chip: { size: CHIP.size, labels },
    });
    const firsts = await page.evaluate(encode, {
      pngs: firstPngs,
      image: IMAGE,
      quality: IMAGE.quality,
    });
    const chips = new Map(apps.map((a) => [a.id, layoutChips(a, text.labels, glyphs, textWidth)]));
    for (const quality of LOOK_QUALITIES) {
      const looks = lookPngs.length
        ? await page.evaluate(encode, { pngs: lookPngs, image: IMAGE, quality })
        : [];
      const lookData = new Map(lookStems.map((stem, i) => [stem, looks[i].data]));
      const prepared = new Map(
        text.items.map((p, i) => [
          p.id,
          {
            ...p,
            looks: [
              firsts[i].data,
              ...stems
                .get(p.id)
                .slice(1)
                .map((s) => lookData.get(s)),
            ],
          },
        ]),
      );
      svg = buildSvg(apps, prepared, chips, glyphs, colourOf);
      lookQuality = quality;
      if (Buffer.byteLength(svg) <= BUDGET) break;
    }
    const cellData = await page.evaluate(encode, {
      pngs: apps.flatMap((a) => stems.get(a.id).map(base64)),
      image: CELL,
      quality: CELL.quality,
    });
    let at = 0;
    cells = new Map(
      apps.map((a, i) => {
        const n = stems.get(a.id).length;
        const looks = cellData.slice(at, (at += n)).map((c) => c.data);
        return [a.id, cellSvg(a, looks, i)];
      }),
    );

    const preview = await browser.newPage({
      viewport: { width: PREVIEW.width, height: PREVIEW.height },
    });
    const png = new Map(apps.map((a, i) => [a.id, firstPngs[i]]));
    const darkShare = new Map(apps.map((a, i) => [a.id, firsts[i].dark]));
    await preview.setContent(previewHtml(apps, projectTesseract([0, 3], 0), png, darkShare));
    writeFileSync(LOGO, logoSvg(mark));
    await preview.evaluate(() => Promise.all([...document.images].map((img) => img.decode())));
    await preview.screenshot({ path: SOCIAL });
  } finally {
    await browser.close();
  }
  writeFileSync(OUT, svg);
  mkdirSync(CELLS, { recursive: true });
  for (const file of readdirSync(CELLS)) {
    if (file.endsWith(".svg") && !cells.has(file.slice(0, -4))) rmSync(join(CELLS, file));
  }
  for (const [id, cell] of cells) writeFileSync(join(CELLS, `${id}.svg`), cell);
  writeIndex(pieces, new Set(cells.keys()));

  const kib = (bytes) => `${(bytes / 1024).toFixed(0)} KiB`;
  const size = Buffer.byteLength(svg);
  const cycling = apps.filter((a) => stems.get(a.id).length > 1).length;
  console.log(
    `${OUT}: ${apps.length} pieces, ${cycling} with ${lookStems.length} further looks at quality ${lookQuality}, ${kib(size)}`,
  );
  if (size > BUDGET) console.log(`Over the budget of ${kib(BUDGET)}; drop some looks`);
  const cellBytes = [...cells.values()].map((c) => Buffer.byteLength(c));
  console.log(
    `${CELLS}: ${cells.size} pictures for the tables, ${kib(cellBytes.reduce((a, b) => a + b, 0))}, the largest ${kib(Math.max(...cellBytes))}`,
  );
  console.log(`${SOCIAL}: ${kib(readFileSync(SOCIAL).length)}`);
  const missing = pieces.filter((a) => !apps.includes(a)).map((a) => a.id);
  if (missing.length) {
    console.log(
      `No thumbnail, so not in the strip (pnpm shots --only=<id>): ${missing.join(", ")}`,
    );
  }
  const unshot = pieces
    .flatMap((a) => thumbPreviews(a).slice(1))
    .map((p) => p.stem)
    .filter((stem) => !existsSync(thumb(stem)));
  if (unshot.length) {
    console.log(`Looks with no thumbnail yet (pnpm shots --thumbs-only): ${unshot.join(", ")}`);
  }
  const cut = text.items.filter((p) => p.cut).map((p) => p.id);
  if (cut.length) console.log(`Blurbs cut short with an ellipsis: ${cut.join(", ")}`);
};

await main();
