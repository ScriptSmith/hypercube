import type { AppManifest, FrameKind } from "../../src/core/types";

export type VenueSizes = Record<FrameKind, { width: number; height: number }>;

export const ROOT: string;
export function importTs(file: string): Promise<Record<string, unknown>>;
export function discoverApps(root?: string): Promise<AppManifest[]>;
export function loadVenueSizes(root?: string): Promise<VenueSizes>;
