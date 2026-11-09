/**
 * The operator's PIN and own-server secrets, remembered in this browser so the landing page,
 * simulator and admin page don't ask for them after every reload. Neither goes into a URL
 * from here: the PIN only ever becomes a verifier, and a secret is handed out only for the
 * server address it was entered with, so it never reaches a different server.
 */

const KEY = "hc:credentials";
/** Secrets for this many server addresses, most recent first. */
const MAX_SERVERS = 8;

interface Stored {
  pin: string;
  secrets: [string, string][];
}

const EMPTY: Stored = { pin: "", secrets: [] };

/** One spelling per server, so `wss://host` and `wss://host/` share a secret. */
const addressKey = (address: string): string => {
  const text = address.trim();
  try {
    return new URL(text).href;
  } catch {
    return text;
  }
};

const read = (): Stored => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (typeof raw !== "object" || raw === null) return EMPTY;
    const r = raw as Record<string, unknown>;
    const pin = typeof r.pin === "string" && /^\d{0,8}$/.test(r.pin) ? r.pin : "";
    const secrets = Array.isArray(r.secrets)
      ? r.secrets
          .filter(
            (e): e is [string, string] =>
              Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "string",
          )
          .slice(0, MAX_SERVERS)
      : [];
    return { pin, secrets };
  } catch {
    return EMPTY;
  }
};

const write = (stored: Stored) => {
  try {
    if (!stored.pin && stored.secrets.length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    // Private mode or a full quota: the value then lasts for this page only.
  }
};

export const loadPin = (): string => read().pin;

/** An empty PIN forgets it. */
export const savePin = (pin: string): void => {
  write({ ...read(), pin: /^\d{0,8}$/.test(pin) ? pin : "" });
};

export const loadSecret = (address: string): string => {
  const key = addressKey(address);
  if (!key) return "";
  return read().secrets.find(([a]) => a === key)?.[1] ?? "";
};

/** Remember the secret for this address, or forget it when empty. */
export const saveSecret = (address: string, secret: string): void => {
  const key = addressKey(address);
  if (!key) return;
  const stored = read();
  const others = stored.secrets.filter(([a]) => a !== key);
  const secrets: [string, string][] = secret ? [[key, secret], ...others] : others;
  write({ ...stored, secrets: secrets.slice(0, MAX_SERVERS) });
};

/** Forget the PIN and every secret. */
export const forgetCredentials = (): void => write(EMPTY);
