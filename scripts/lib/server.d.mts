export const PORT: number;
export const BASE_URL: string;
export const EXTERNAL: boolean;

export interface Server {
  url: string;
  started: boolean;
  stop(): void;
}

export function ensureServer(log?: (msg: string) => void): Promise<Server>;
