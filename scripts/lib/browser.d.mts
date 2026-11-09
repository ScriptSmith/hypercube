import type { Browser } from "@playwright/test";

export function chromiumPath(): string | undefined;
export const CHROMIUM_ARGS: string[];
export function launchOptions(): { executablePath: string | undefined; args: string[] };
export function launchChromium(): Promise<Browser>;
