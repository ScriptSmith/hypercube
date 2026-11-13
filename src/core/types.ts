/**
 * Contracts shared by the runtime, the platform modules and every app.
 */

/**
 * `pair` means panels merged into one surface: two by default, `FrameInfo.span` in general.
 * `sphere` is one display wrapped round a ball, fed an equirectangular picture (see `sphere.ts`).
 */
export type FrameKind = "panel" | "pair" | "wall" | "screen" | "kiosk" | "sphere";
export type SetupName = "solo" | "bank" | "corner" | "versus";
export type Role = "solo" | "station" | "screen";
export type HostRole = "TOUCHSCREEN" | "KIOSK" | "PRESENTATION" | "STANDARD";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Who this frame is. `frame` is null when nothing identified it, which forces preview mode. */
export interface Identity {
  frame: string | null;
  event?: string;
  zone?: string;
  display?: string;
  displays?: string[];
  name?: string;
  hostRole?: HostRole;
  /** Where the identity came from: the host's postMessage, URL params, or nothing. */
  source: "host" | "params" | "none";
  /** Preview frames (host thumbnails, unfilled placeholders) never join a room. */
  mode: "show" | "preview";
  /**
   * Frames in the same zone showing the same page, this one included, when the host sent them.
   * Other content on the zone's displays isn't listed.
   */
  siblings: HostFrame[];
}

/** One frame as described by the host's `frame-context` message. */
export interface HostFrame {
  frame: string;
  /** The displays the frame spans, lead first. */
  displays: { id: string; name: string }[];
  role: HostRole;
  /** 0-based position, left to right, among the frames with this role showing the same page. */
  index: number;
  /** Number of those frames. */
  count: number;
  /** Size in display pixels. */
  width: number;
  height: number;
}

/** Reach as fractions of frame height measured up from the bottom edge. */
export interface Reach {
  adult: number;
  child: number;
}

export interface FrameInfo {
  kind: FrameKind;
  /** Panels merged into this frame: 2 or more for a `pair` (merged panels). Absent means 1. */
  span?: number;
  /** Nominal venue size of this kind, e.g. 1080 x 1920 for a panel. */
  venueWidth: number;
  venueHeight: number;
  /** Stage size in CSS px. */
  width: number;
  height: number;
  /** CSS px per venue px. Size things as `venuePx * unit` so they look the same at any scale. */
  unit: number;
  /** Suggested canvas backing-store ratio: devicePixelRatio (capped) times `res`. */
  pixelRatio: number;
  touch: boolean;
  reach: Reach;
  /** Stage y (CSS px) of the top of adult and child reach. Larger y is lower. */
  reachTop: { adult: number; child: number };
  /** Stage x (CSS px) of physical seams, e.g. the join in a merged pair. */
  seams: number[];
  /** Present only on a `sphere`. */
  sphere?: SphereInfo;
}

/**
 * Where a sphere hangs and which part of it the stage covers. Angles are radians. Latitude is
 * +π/2 at the top pole and -π/2 at the bottom one. The stage's columns run once round the
 * sphere, longitude -π at its left edge to +π at its right, so a picture drawn left to right
 * reads left to right from outside. `src/core/sphere.ts` maps between the two.
 */
export interface SphereInfo {
  /** Metres. */
  radius: number;
  /** Height of the centre above the floor, metres. */
  centreY: number;
  /** Latitudes of the stage's top and bottom edges: the whole sphere unless it is a partial one. */
  cover: { top: number; bottom: number };
  /**
   * Latitudes people on the floor can see well. Above `view.top` is a cap nobody sees, so it
   * gets nothing that matters; near `view.bottom` is seen only from underneath.
   */
  view: { top: number; bottom: number };
  /** People also watch from a gallery round the room, about level with the ball. */
  gallery?: boolean;
}

export interface SetupInfo {
  name: SetupName;
  role: Role;
  /** 0-based position of this frame among the setup's touch frames, left to right. */
  pos: number;
  count: number;
  /** App instances in one room are separated by group. */
  group: string;
  /**
   * Which side of a two-sided setup (corner, versus) this frame is on: 0 or 1. Both sides
   * share one group; `pos` and `count` are per side.
   */
  side: number;
}

export type OptionValue = string | number | boolean;
export type OptionValues = Record<string, OptionValue>;

/** Fields every option has. */
interface OptionBase {
  key: string;
  title: string;
  /**
   * True when a visitor may change this in the app picker before playing (speeds, counts,
   * modes). Operator settings such as resolution or layout stay false.
   */
  visitor?: boolean;
  /** Frame kinds this option applies to. Absent means every kind. Pickers and panels hide it elsewhere. */
  kinds?: FrameKind[];
  /**
   * Show this option only while option `key` has one of the values in `is` (and is shown
   * itself). The app still receives its value either way.
   */
  when?: { key: string; is: readonly OptionValue[] };
}

export type OptionDef =
  | (OptionBase & {
      type: "enum";
      values: { id: string; title: string }[];
      default: string;
    })
  | (OptionBase & {
      type: "number";
      min: number;
      max: number;
      step: number;
      default: number;
    })
  | (OptionBase & { type: "boolean"; default: boolean })
  | (OptionBase & {
      /** A set of app ids, chosen from the registry. Empty means "every suitable app". */
      type: "apps";
      default: string[];
    })
  | (OptionBase & {
      /**
       * Operator text, such as a poll question. It is set only through admin (signed commands
       * and the overrides they leave), never read from the URL, because anyone can load the
       * public site with any URL. Pickers never show it to visitors. Printable characters only,
       * cut to `maxLength`; empty means `default`.
       */
      type: "text";
      maxLength: number;
      default: string;
    });

export interface VariantDef {
  id: string;
  title: string;
  blurb?: string;
  /** Offered to visitors in the app picker. Default true. */
  visitor?: boolean;
}

export interface SetupSupport {
  setup: SetupName;
  kinds: FrameKind[];
  roles?: Role[];
  note?: string;
}

/** Small, eagerly loaded description of an app. Lives in `src/apps/<id>/manifest.ts`. */
export interface AppManifest {
  id: string;
  title: string;
  category: "game" | "visual" | "tool";
  /** One plain sentence for the landing page. */
  blurb: string;
  setups: SetupSupport[];
  /** The first variant is the default. */
  variants?: VariantDef[];
  options?: OptionDef[];
  network: "none" | "optional" | "required";
  /** True for games where visitors claim stations (calibration, confirm, reset). */
  stations?: boolean;
  /** Hidden from the landing page gallery (tools such as `idle`). */
  hidden?: boolean;
  /**
   * What `pnpm shots` renders for the gallery thumbnail, `public/thumbs/<id>.png`. By default it
   * is the declared kind closest to 16:10 in the default variant after 3 s. `looks` adds previews
   * that the gallery and the README strip cross-fade to, for a piece that looks clearly different
   * on another display or in another variant or option. A look takes what it leaves out from the
   * first preview and is written to `public/thumbs/<id>.<name>.png`, where the name joins its own
   * kind, variant and `<key>-<value>` options with dots, such as `pinball.reef` (`thumbs.ts`).
   */
  thumb?: ThumbShot & { looks?: ThumbShot[] };
}

/** One gallery preview: the frame kind, variant and options to shoot, and when. */
export interface ThumbShot {
  kind?: FrameKind;
  variant?: string;
  /** Set as `o.<key>` in the preview's URL. */
  options?: OptionValues;
  /** Seconds after the app starts. */
  seconds?: number;
}

/** What `src/apps/<id>/index.ts` exports. */
export interface AppModule {
  mount(ctx: AppContext): AppInstance | Promise<AppInstance>;
}

export interface AppInstance {
  /** Return to the starting state. Called on idle timeout and by admin. */
  reset(): void;
  /** Release everything: listeners, loops, GPU resources, DOM. Called before another app mounts. */
  dispose(): void;
  /** Called after `reset()` when the frame goes idle. */
  attract?(): void;
  /** Short facts for the admin roster. */
  status?(): Record<string, OptionValue>;
  /** App-specific admin commands. */
  command?(name: string, args: unknown): void;
  /**
   * Where the runtime's Home control (shown while a visitor-launched app runs) may sit
   * without covering anything that matters: the top-left of a free square of `size` stage px.
   * Return null to accept the default, the top-right corner of the reachable band.
   */
  homeSpot?(size: number): { x: number; y: number } | null;
}

export interface AppContext {
  manifest: AppManifest;
  /** The stage element. Append canvases and DOM here; the runtime empties it on dispose. */
  root: HTMLElement;
  frame: FrameInfo;
  setup: SetupInfo;
  identity: Identity;
  variant: string;
  options: OptionValues;
  seed: number;
  debug: boolean;
  /** Number of bot players requested (`bots` param), for attract and testing. */
  bots: number;
  /**
   * A seeded random stream. With no argument it follows the frame's seed (the `seed` param, or
   * else the app and group), so every frame of a group gets the same stream. With an argument
   * the stream depends on that value alone, on every frame and every run; mix in `seed`, or fork
   * `rng()`, for one that follows the frame's seed.
   */
  rng(seed?: number | string): Rng;
  clock: Clock;
  loop(spec: LoopSpec): Loop;
  input: Input;
  stations: Stations;
  /** App channel scoped to this app's group. Offline (no peers, sends dropped) when not networked. */
  net: Channel;
  ui: Ui;
  idle: IdleControl;
  onResize(cb: (frame: FrameInfo) => void): () => void;
  onDispose(cb: () => void): void;
  log(...args: unknown[]): void;
  /** For tool apps such as `diag` only. Games and visualisations must not use it. */
  system: SystemAccess;
}

export interface LaunchOptions {
  variant?: string;
  options?: OptionValues;
  /**
   * Run the app as the frame's content for a while rather than as one visitor's visit: going
   * idle resets it as usual, and the runtime returns to the calling app at the first idle
   * moment after `ms`, or `graceMs` after that at the latest, so a player can finish. An `ms`
   * of Infinity keeps it for good.
   */
  stay?: { ms: number; graceMs: number };
  /** False leaves out the Home control, so a visitor can't go back to the calling app. */
  homeControl?: boolean;
}

/** Why the runtime came back to an app from one it launched. */
export type Returned = "home" | "idle" | "time" | "error";

export interface SystemAccess {
  /**
   * Start another app on this frame (the app picker). The runtime returns to the calling app
   * when the launched one goes idle (or its `stay` runs out) or the visitor holds Home.
   */
  launch(app: string, opts?: LaunchOptions): void;
  /**
   * Set when the runtime came back to this app from one it launched: a visitor held Home, the
   * launched app went idle, its `stay` ran out, or it failed to start. Null otherwise.
   */
  returned: Returned | null;
  /**
   * The option values the operator set for an app this frame may launch, from the URL's
   * `o.<app>.<name>` parameters and from admin, checked against that app's schema. Only the
   * options the operator set; empty for an unknown app. A launch starts from these wherever it
   * passes no value of its own.
   */
  presets(app: string): OptionValues;
  room: Room | null;
  /** The page's raw query string. */
  search: string;
  errors(): readonly string[];
}

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Integer in [0, n). */
  int(n: number): number;
  range(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** Independent stream derived from this one, stable for the same label. */
  fork(label: string): Rng;
}

export interface Clock {
  /** Milliseconds on the room's shared timeline (the hub's clock), or local time when offline. */
  now(): number;
  readonly synced: boolean;
  onSync(cb: () => void): () => void;
}

export interface LoopSpec {
  /** Fixed simulation rate. Default 60. */
  hz?: number;
  update?(dt: number): void;
  /** `alpha` is how far between the last two updates the render falls, for interpolation. */
  render?(alpha: number): void;
}

export interface Loop {
  start(): void;
  stop(): void;
  readonly running: boolean;
}

export interface Pointer {
  id: number;
  /** Stage CSS px. */
  x: number;
  y: number;
  startX: number;
  startY: number;
  startTime: number;
  time: number;
  /** CSS px per second, smoothed. */
  vx: number;
  vy: number;
  /** True when injected by a bot or test. */
  synthetic: boolean;
}

export type PointerPhase = "down" | "move" | "up" | "cancel";

export interface Input {
  on(phase: PointerPhase, cb: (p: Pointer) => void): () => void;
  readonly pointers: ReadonlyMap<number, Pointer>;
  /** Synthetic touches, dispatched as real pointer events at the element under (x, y). */
  inject: {
    down(x: number, y: number): number;
    move(id: number, x: number, y: number): void;
    up(id: number): void;
  };
}

export type StationState = "idle" | "calibrating" | "ready" | "playing";

export interface StationSpec {
  id: string;
  rect: Rect;
  /** Default true. */
  calibrate?: boolean;
  color?: string;
  /**
   * Which corner of the band the hold-to-reset control sits in while playing.
   * Default: the top corner on the side away from the frame's centre (keeps it off a pair's seam).
   */
  resetCorner?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  /**
   * Ms without a touch in the station before a playing station ends. 0 never times out
   * (the app ends it). Default about 30 s.
   */
  playTimeout?: number;
}

export interface Station {
  readonly id: string;
  readonly rect: Rect;
  readonly color: string;
  readonly state: StationState;
  /** The player's comfortable reach inside `rect`, in stage px, once calibrated. */
  readonly band: { top: number; bottom: number } | null;
  readonly bot: boolean;
  /** End play and return the station to idle. */
  end(): void;
  /** Let a bot take this station, skipping calibration. */
  claimForBot(): void;
}

export interface StationSet {
  readonly list: readonly Station[];
  /**
   * "ready" when a player presses Start, "start" when `startReady()` begins their play,
   * "end" when a station that was ready or playing returns to idle (reset, timeout, `end()`).
   */
  on(event: "ready" | "start" | "end", cb: (s: Station) => void): () => void;
  /** Move every ready station to playing, e.g. when a lobby countdown ends. */
  startReady(): void;
  dispose(): void;
}

export interface Stations {
  define(specs: StationSpec[]): StationSet;
}

export interface PeerInfo {
  frame: string;
  app: string;
  group: string;
  kind: FrameKind;
  role: Role;
  pos: number;
  /** See `SetupInfo.side`. */
  side?: number;
  /** Panels merged into a `pair` (see `FrameInfo.span`). Absent on other kinds. */
  span?: number;
  zone?: string;
  display?: string;
  /** Round trip to the hub in ms, when known. */
  rtt?: number;
}

export interface Channel {
  readonly online: boolean;
  /** This frame's id (a random preview id when offline). */
  readonly self: string;
  /** Frames in this channel's scope, this one included. */
  peers(): readonly PeerInfo[];
  /** Deterministic authority for the group: a screen if present, else the lowest pos, else the lowest frame id. */
  leader(): string | null;
  /** `to` is a frame id; omit to send to every other frame in scope. */
  send(topic: string, data: unknown, to?: string): void;
  on(topic: string, cb: (data: unknown, from: string) => void): () => void;
  onPeers(cb: (peers: readonly PeerInfo[]) => void): () => void;
  /** Drop this channel's handlers. The runtime calls it when the app unmounts. */
  close?(): void;
}

/** A frame as the room's roster sees it. */
export interface RosterEntry extends PeerInfo {
  joinedAt: number;
  /** Another live frame claimed the same frame id. */
  duplicate?: boolean;
  /** Latest `Room.setStatus` payload from that frame. */
  status?: Record<string, OptionValue>;
}

export interface RoomOptions {
  /** Room token from the URL. Every frame in a scenario shares one. */
  room: string;
  self: PeerInfo;
  /** "public" for the public PeerJS broker, or a wss:// URL for our own PeerServer. */
  signalling: string;
  transport: "peer" | "local";
  /** False for members that must never become the hub, such as the standalone admin page. */
  hubEligible?: boolean;
}

export interface NetStats {
  hub: string | null;
  connections: number;
  /** ICE candidate pair types in use, e.g. "host/host", "srflx/host", "relay/relay". */
  candidates: string[];
  bytesIn: number;
  bytesOut: number;
}

/** One frame's membership of a room. Created by `connectRoom` in `src/core/net/`. */
export interface Room {
  readonly status: "connecting" | "online" | "offline";
  readonly isHub: boolean;
  /** Frame id of the current hub, or null when there is none. */
  readonly hub: string | null;
  readonly self: string;
  readonly clock: Clock;
  roster(): readonly RosterEntry[];
  /**
   * A named message scope. `filter` picks which roster entries count as its peers
   * (and so its leader); messages are delivered only to frames that opened the same name.
   */
  channel(name: string, filter?: (p: PeerInfo) => boolean): Channel;
  /** Change this frame's advertised info, e.g. after admin switches its app. */
  update(info: Partial<PeerInfo>): void;
  setStatus(status: Record<string, OptionValue>): void;
  onStatus(cb: (status: Room["status"]) => void): () => void;
  onRoster(cb: (roster: readonly RosterEntry[]) => void): () => void;
  stats(): Promise<NetStats>;
  close(): void;
}

export interface Ui {
  readonly palette: Palette;
  /** Large touch button. `hold` makes it require a press of that many ms, with a fill ring. */
  button(opts: {
    label?: string;
    icon?: string;
    rect: Rect;
    hold?: number;
    color?: string;
    /** "ghost" is outlined and quiet, for controls such as reset that shouldn't draw the eye. */
    look?: "solid" | "ghost";
    onPress(): void;
  }): HTMLElement;
  /** A short fixed string, sized in venue px. */
  label(text: string, opts: { x: number; y: number; size: number; color?: string }): HTMLElement;
  toast(text: string, ms?: number): void;
  /** Big 3, 2, 1 numbers, centred in `rect` (default the whole frame). */
  countdown(seconds: number, opts?: { rect?: Rect; color?: string }): Promise<void>;
}

export interface Palette {
  background: string;
  foreground: string;
  muted: string;
  accent: string;
  danger: string;
  /** Distinct, colour-blind-aware player colours. */
  players: readonly string[];
}

export interface IdleControl {
  readonly idle: boolean;
  /** Count as activity, e.g. a network game still in progress. */
  poke(): void;
  /** Prevent idle until the returned function is called. */
  hold(): () => void;
  on(cb: (idle: boolean) => void): () => void;
}
