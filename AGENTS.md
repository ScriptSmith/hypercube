# AGENTS.md

Guidance for AI agents and contributors working in this repository.

Hypercube is a static web arcade of games, visualisations and interactive learning pieces for large multi-touch installations: rows of portrait touch panels under a large screen, wide touch walls, kiosks and a display wrapped round a hanging ball. Every display loads one page in an iframe. Pages that play together coordinate peer-to-peer over WebRTC using PeerJS. The site is published to Cloudflare Pages and, as a copy, to a Cloudflare Worker with static assets.

## Commands

- `pnpm install`
- `pnpm dev` serves on http://localhost:5173. `pnpm dev:lan` serves over HTTPS on the LAN for phones and other touch devices (Web Crypto needs a secure context).
- `pnpm build`, `pnpm preview`
- `pnpm typecheck`, `pnpm lint` (oxlint), `pnpm fmt` / `pnpm fmt:check` (oxfmt), `pnpm test` (vitest), `pnpm e2e` (Playwright)
- `pnpm check` runs typecheck, lint, format check and unit tests.
- A push to `main` runs `pnpm check` and deploys the build to Cloudflare Pages, to the Worker in `wrangler.jsonc` (the main site, https://hypercube.adsm.dev/) and, while the repo is public, to GitHub Pages (`.github/workflows/deploy.yml`). Links, the README and the page's metadata name only the main site. Other branches can be deployed as previews from the Actions tab: a Pages preview and a Worker version with its own preview URL.
- `pnpm e2e` builds, serves the build on port 4173 (parallel sessions set their own `HC_PORT` and `HC_OUTDIR`, for example `HC_PORT=4191 HC_OUTDIR=dist-hockey`) and runs the Playwright smoke and simulator tests. It uses `/usr/bin/chromium` or `CHROMIUM_PATH`.
- `pnpm shots [--only=<id>]` writes screenshots and a contact sheet to `shots/index.html`, plus `public/thumbs/<id>.png` and `public/thumbs/<id>.<look>.png` for each of the manifest's `thumb.looks`, which the gallery and the README strip cross-fade through (`--no-thumbs` skips them, `--thumbs-only` makes only them).
- `pnpm readme` rebuilds the README's scrolling strip (`.github/readme/pieces.svg`), its tables of pieces with a picture per piece (`.github/readme/thumbs/<id>.svg`) and the social preview (`public/social-preview.png`) from the manifests and thumbnails. Run it after changing an app's title, blurb, setups or thumbnail. Like `pnpm shots`, it needs Chromium.
- `pnpm soak <id> [minutes] [kind]` runs an app with bots and fails on heap or DOM growth; `--quick` runs it for 2 minutes, and `--param=o.<name>=<value>` (repeatable) sets an option or any other URL parameter.
- Tests rely on `window.__hypercube`, `window.__hypercubeSim`, `.hc-stage` and `.sim-frame[data-frame]`, so keep those stable.

## Layout

- `index.html` landing page: the gallery and the URL configuration panel, which can also run its setup in the simulator (`#/<app>/sim`), plus a guide that points out each part of the page in turn; `play/` the player runtime every display loads; `sim/` the venue simulator; `admin/` the standalone admin page. The landing, sim and admin pages remember the operator's PIN and own-server secrets in the browser (`src/pages/credentials.ts`), never in a URL.
- `src/core/` shared runtime. `types.ts` holds the contracts. The other modules are params, identity, frame metrics, stage, input, stations, ui, idle, loop, rng, net and admin, plus `view3d` and `renderer3d` for 3D apps, and `sphere`, `sphere3d` and `globe` for sphere frames.
- `src/apps/<id>/manifest.ts` describes an app and is loaded eagerly. `src/apps/<id>/index.ts` exports `mount(ctx)` and is loaded on demand. Apps are found by `import.meta.glob`, so adding an app touches no shared file.
- `src/pages/` entry code for the landing, sim and admin pages.
- `tests/` unit tests; `e2e/` Playwright tests.

## Frames, setups and roles

A frame is one page in one iframe. Its kind is `panel` (a portrait touch panel), `pair` (panels merged side by side, two by default, with a seam between each), `wall` (a wide touch wall), `screen` (the screen above a bank, not touchable), `kiosk` (a landscape touch display) or `sphere` (one display wrapped round a ball, fed an equirectangular picture, not touchable). Their pixel sizes, physical sizes and mounting heights come from the venue profile: `DEFAULT_VENUE` in `src/core/venue.ts` (a panel of 1080 × 1920, a bank of six panels under a 4000 × 3600 screen, a 5760 × 2160 wall, a 1920 × 1080 kiosk and a 4 m ball fed 4096 × 2048), with any part replaced by the `venue` URL parameter. A setup combines frames into one app instance: `solo`, `bank` (a row of touch frames with an optional screen above), `corner` (two banks meeting at a corner) or `versus` (two frames or banks playing each other). A frame's role is `solo`, `station` or `screen`.

## URL parameters

| Param                                                                        | Meaning                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `app`, `variant`, `o.<name>`                                                 | App id, rule variant, app options (enum, number, boolean or app-list values; never text)                                                                                                                                             |
| `setup`, `role`, `pos`, `count`, `group`, `side`                             | Setup, this frame's role, its position left to right and the number of touch frames, the instance group within the room, and `a` or `b` for the two sides of a corner or versus setup (one shared group, `pos` and `count` per side) |
| `frame`, `zone`, `display`, `displays`, `name`, `hostrole`, `w`, `h`, `mode` | Identity, normally filled in by the host from `{placeholder}` tokens                                                                                                                                                                 |
| `kind`, `reach`                                                              | Frame kind override; reach as `adult,child` fractions of height from the bottom                                                                                                                                                      |
| `venue`                                                                      | The installation's own sizes where they differ from the defaults (see below)                                                                                                                                                         |
| `sphere`, `cover`, `view`, `look`                                            | A sphere's `diameter,bottom` in metres; the latitudes its feed covers and the latitudes people see well, each `top,bottom` in degrees; `look=globe` previews it as a 3D ball in a room                                               |
| `room`, `peer`, `transport`                                                  | Room token (omit for standalone); `public` PeerJS broker or a `wss://` PeerServer URL; `peer` or `local` (BroadcastChannel, simulator only)                                                                                          |
| `ak`                                                                         | Admin key derived from the operator's PIN                                                                                                                                                                                            |
| `fit`, `res`                                                                 | Letterbox to a size such as `1080x1920` for device testing; render-resolution multiplier                                                                                                                                             |
| `bots`, `seed`, `debug`, `idle`, `preview`                                   | Bot players, fixed seed, debug output, idle timeout in seconds, force preview mode                                                                                                                                                   |

A frame with no identity, with unfilled placeholders, or with `preview=1` never joins a room. A sphere's feed looks like any wide frame, so its URL must say `kind=sphere`.

`venue` holds comma-separated entries of colon-separated parts. An empty part keeps its default, numbers are clamped to sensible ranges, and an entry that doesn't parse is ignored.

- `panel`, `screen`, `wall`, `kiosk`: `<w>x<h>:<w m>x<h m>:<bottom m>[:<touch 1|0>]`, the pixel size, the physical size in metres and the bottom edge's height above the floor
- `bank:<panels>` panels in a bank by default; `merge:<panels>` most panels one machine merges; `bezel:<m>` gap between panels
- `sphere:<w>x<h>:<diameter m>:<bottom m>`; `cover:<top>:<bottom>` and `view:<top>:<bottom>` in degrees, as the frame parameters of the same names; `gallery:1` when people also watch from a gallery about level with the ball

For example, `venue=wall:7680x2880:16x6:0.1,bank:8` or `venue=sphere::3:2.5`. Every page sets its profile from this parameter at boot (`activeVenue()` in `src/core/venue.ts`). The landing panel's Advanced section takes the operator's profile, remembers it in the browser (`src/pages/venueprofile.ts`) and adds it to every URL it builds, including the simulator's, which passes it to its frames.

Text options (`type: "text"`, such as an operator's own poll question) are set only through admin, because anyone can load the public site with any URL: frames ignore them in a URL, signed admin commands carry them, and the runtime cleans them against the app's schema before mounting. Pickers never show them to visitors. An option's `when` shows it only while another option has one of the listed values.

## Writing an app

1. Create `src/apps/<id>/manifest.ts` (default export `AppManifest`) and `src/apps/<id>/index.ts` (export `mount(ctx: AppContext): AppInstance`). Copy `src/apps/idle/` as a starting point.
2. Draw into `ctx.root`. Size things in venue pixels times `ctx.frame.unit`. Size canvas backing stores with `ctx.frame.pixelRatio`, and handle `ctx.onResize`. Never write a display's size into an app: read it from the frame, or from the venue profile (`displayFor` and `activeVenue()` in `src/core/venue.ts`, `venueSize` and `kindReach` in `src/core/frame.ts`).
3. Use `src/core/layout.ts` to map positions between a bank of touch frames and the screen above it. Use `ctx.loop` for fixed-step updates, `ctx.rng` for anything that must match across frames, `ctx.clock` for shared time, `ctx.net` for messages within the app's group, and `ctx.stations` for games where visitors claim a station. A confirmed station's `band` (or `commonBand` from `src/core/stations`, for players who share one area) is the height range the player can reach, and apps can treat it as their playing canvas. 3D apps can draw with `src/core/renderer3d.ts`, which compiles shaders in the background and survives a lost context, and use `src/core/view3d.ts` to render one scene through several frames as through windows, lined up across bezels, into the screen and round a corner.
   On a sphere, `ctx.frame.sphere` says where the ball hangs and which latitudes people see well (`view`; above it is a cap nobody sees). Place things by latitude and longitude with `src/core/sphere.ts` (`stageMap`, `sphereMap` for a canvas's backing store, `wrapOffsets` across the seam, `stretch` so small things look round), or draw a flat 2D scene on a `Strip`, which wraps a band of the ball undistorted. With `src/core/sphere3d.ts`, a `SurfacePass` paints the ball itself from a shader of direction (spin it with a matrix), and `SectorViews` shows a 3D scene inside the glass to people standing round it and underneath. Draw only into canvases: `look=globe` copies them onto its model, and DOM can't be wrapped. `spheretest` is a small working example of both helpers.
4. `reset()` returns to the starting state. It is called on idle timeout and by admin. `dispose()` must release everything (listeners, loops, WebGL contexts, workers).
5. Keep an app's work inside its own folder. A change to `src/core/` is a task of its own, so note what the app needs rather than editing core from an app task.

Rules for every app:

- Write our own code. Don't read, copy or port source from other games or simulations, whatever their licence. General-purpose libraries (such as PeerJS, three.js, planck.js and MapLibre GL, which the project already uses) are fine through their public APIs.
- No trademarked game names, characters or art.
- Visitors never type and never leave persistent freehand marks. A finger may pour a medium that immediately falls, flows, diffuses or evolves. Anything that stays put is placed as a pre-made piece, and pieces are large and few so they can't be arranged into letters. Players are colours and positions, never names.
- Everything works muted. Content is suitable for children.
- Pages run unattended for days. Bound every array, pool and queue, return to attract after idle, and keep working when peers disappear.
- Touch targets are at least 120 venue px. Children's controls go in the lowest band. Never put two players' controls on either side of a seam.
- A sphere has no left, right or front: what matters drifts round it or repeats round it, inside its visible band.
- Provide an attract mode and bots (`ctx.bots`) so the app can run with nobody touching it.

## Conventions

- TypeScript strict, ESM only. Format with oxfmt, lint with oxlint.
- Comments explain why or record constraints; keep them sparse. No em-dashes in code, comments or prose.
- User-facing text is short, plain and in sentence case.
- Wrap storage access in try/catch.
- The maintainer makes all commits. Leave changes uncommitted unless asked.
