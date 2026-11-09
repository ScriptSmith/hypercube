import type { FrameInfo, Identity, Room, SetupInfo } from "../types";
import type { FrameConfig } from "./config";

export interface AdminDeps {
  /** Element above the stage for the unlock gesture, PIN pad and admin panel. */
  overlay: HTMLElement;
  room: Room | null;
  roomToken: string | null;
  /** Admin key from the URL; admin is disabled without it. */
  ak: string | null;
  /**
   * PIN verifier from the URL (`pv`). Without it the PIN pad can't unlock this frame, though
   * signed commands from consoles still work.
   */
  pinVerifier: string | null;
  identity: () => Identity;
  frame: () => FrameInfo;
  setup: () => SetupInfo;
  /** Effective config now (URL plus override). */
  config: () => FrameConfig & { app: string };
  /** Apply an override (null clears it) and remount the app. */
  applyOverride(override: FrameConfig | null): void;
  resetApp(): void;
  /** Forward an app-specific admin command to the running app's `command()`. */
  appCommand(name: string, args: unknown): void;
  reload(): void;
  showNotice(text: string, ms: number): void;
  identify(ms: number): void;
}

export interface AdminHandle {
  dispose(): void;
}
