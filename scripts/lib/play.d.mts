import type { Page } from "@playwright/test";
import type { RuntimeState } from "../../src/core/runtime";
import type { AppManifest, FrameKind } from "../../src/core/types";

export interface Size {
  width: number;
  height: number;
}

export interface PlayCase {
  app: string;
  kind: FrameKind;
  variant: string | null;
}

export interface PlayState {
  phase: RuntimeState["phase"] | "missing";
  app: string | null;
  variant: string | null;
  kind: FrameKind | null;
  room: RuntimeState["room"];
  errors: string[];
  /** Animation frames since load, when `installFrameCounter` ran. */
  frames: number;
  /** performance.now() in the page, ms. */
  time: number;
}

export const KIND_ORDER: FrameKind[];
export function appKinds(app: AppManifest): FrameKind[];
export function playCases(apps: AppManifest[]): PlayCase[];
export function caseName(c: PlayCase): string;
export function viewportFor(size: Size, max?: Size): Size;
export function playPath(opts: {
  app: string;
  kind: FrameKind;
  variant?: string | null;
  size: Size;
  bots?: number;
  seed?: string;
  params?: Record<string, string | number>;
}): string;
export function watchPage(page: Page): string[];
export function installFrameCounter(page: Page): Promise<void>;
export function readState(page: Page): Promise<PlayState>;
export function waitForRunning(page: Page, timeout?: number): Promise<PlayState>;
export function shootStage(page: Page): Promise<Buffer>;
