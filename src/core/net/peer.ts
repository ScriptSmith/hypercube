import { type DataConnection, Peer, type PeerError } from "peerjs";
import { brokerFor } from "./signalling";
import { type Endpoint, type Link, netError, type Transport } from "./transport";

/** How long the broker gets to accept an id. */
const OPEN_TIMEOUT_MS = 10_000;
/** A link with more than this queued is treated as stalled and further messages are dropped. */
const MAX_BUFFERED = 1 << 20;
const EARLY_LIMIT = 64;
/** Broker reconnects back off from 2 s to 5 minutes with jitter. The public broker answers
 * bursts of new connections from one address with HTTP 429 and blocks it for up to an hour, and
 * the browser can't tell that apart from a network error, so every failure backs off. */
const RECONNECT_MIN_MS = 2000;
const RECONNECT_MAX_MS = 300_000;

/** Errors that mean the broker connection is down but the peer can reconnect with its id. */
const BROKER_ERRORS: ReadonlySet<string> = new Set([
  "network",
  "server-error",
  "socket-error",
  "socket-closed",
]);

/** "host/srflx" and so on for the candidate pair the connection is using. */
const candidatePair = async (pc: RTCPeerConnection | undefined): Promise<string | null> => {
  if (!pc) return null;
  const report = await pc.getStats();
  let pairId: string | undefined;
  report.forEach((s: { type: string; selectedCandidatePairId?: string }) => {
    if (s.type === "transport" && s.selectedCandidatePairId) pairId = s.selectedCandidatePairId;
  });
  let pair: { localCandidateId?: string; remoteCandidateId?: string } | undefined;
  if (pairId) pair = report.get(pairId);
  if (!pair) {
    report.forEach(
      (s: {
        type: string;
        state?: string;
        nominated?: boolean;
        selected?: boolean;
        localCandidateId?: string;
        remoteCandidateId?: string;
      }) => {
        if (s.type !== "candidate-pair" || pair) return;
        if (s.selected || (s.nominated && s.state === "succeeded")) pair = s;
      },
    );
  }
  if (!pair?.localCandidateId || !pair.remoteCandidateId) return null;
  const localType = (report.get(pair.localCandidateId) as { candidateType?: string } | undefined)
    ?.candidateType;
  const remoteType = (report.get(pair.remoteCandidateId) as { candidateType?: string } | undefined)
    ?.candidateType;
  return localType && remoteType ? `${localType}/${remoteType}` : null;
};

const wrapConnection = (conn: DataConnection): Link => {
  let handler: ((text: string) => void) | null = null;
  const early: string[] = [];
  let onClose: (() => void) | null = null;
  let closed = false;

  const finish = () => {
    if (closed) return;
    closed = true;
    onClose?.();
  };
  conn.on("data", (data) => {
    if (closed || typeof data !== "string") return;
    if (handler) handler(data);
    else if (early.length < EARLY_LIMIT) early.push(data);
  });
  conn.on("close", finish);
  conn.on("error", () => {
    if (!conn.open) finish();
  });
  conn.on("iceStateChanged", (state) => {
    if (state !== "failed" && state !== "closed") return;
    finish();
    conn.close();
  });

  return {
    remote: conn.peer,
    send(text) {
      if (closed || !conn.open) return false;
      const buffered =
        (conn.dataChannel?.bufferedAmount ?? 0) +
        ((conn as { bufferSize?: number }).bufferSize ?? 0);
      if (buffered > MAX_BUFFERED) return false;
      try {
        const sent = conn.send(text);
        if (sent instanceof Promise) sent.catch(() => {});
        return true;
      } catch {
        return false;
      }
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        conn.close();
      } catch {
        // Already closing.
      }
    },
    onMessage(cb) {
      handler = cb;
      for (const text of early.splice(0)) cb(text);
    },
    onClose(cb) {
      onClose = cb;
    },
    candidates: () => candidatePair(conn.peerConnection),
  };
};

const wrapPeer = (peer: Peer): Endpoint => {
  let onLink: ((link: Link) => void) | null = null;
  const earlyLinks: Link[] = [];
  let onLost: ((reason: "taken" | "offline") => void) | null = null;
  /** connect() calls waiting on each target, failed early by a peer-unavailable error. */
  const waiting = new Map<string, Set<(err: Error) => void>>();
  const incoming = new Set<ReturnType<typeof setTimeout>>();
  let closed = false;
  let retries = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const shutdown = () => {
    closed = true;
    if (retryTimer !== null) clearTimeout(retryTimer);
    for (const t of incoming) clearTimeout(t);
    incoming.clear();
    for (const rejects of waiting.values()) for (const r of rejects) r(netError("offline"));
    waiting.clear();
    peer.destroy();
  };

  const lose = (reason: "taken" | "offline") => {
    if (closed) return;
    shutdown();
    onLost?.(reason);
  };

  const reconnectLater = () => {
    if (closed || peer.destroyed || retryTimer !== null) return;
    const base = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** Math.min(retries++, 8));
    const delay = base * (0.5 + Math.random());
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (!closed && !peer.destroyed && peer.disconnected) peer.reconnect();
    }, delay);
  };

  peer.on("connection", (conn) => {
    if (closed) {
      conn.close();
      return;
    }
    const timer = setTimeout(() => {
      incoming.delete(timer);
      conn.close();
    }, OPEN_TIMEOUT_MS);
    incoming.add(timer);
    const settle = () => {
      clearTimeout(timer);
      incoming.delete(timer);
    };
    conn.on("close", settle);
    conn.on("open", () => {
      settle();
      if (closed) {
        conn.close();
        return;
      }
      const link = wrapConnection(conn);
      if (onLink) onLink(link);
      else if (earlyLinks.length < 16) earlyLinks.push(link);
      else link.close();
    });
  });
  peer.on("open", () => {
    retries = 0;
  });
  peer.on("disconnected", reconnectLater);
  peer.on("close", () => lose("offline"));
  peer.on("error", (err: PeerError<string>) => {
    if (err.type === "peer-unavailable") {
      const words = new Set(err.message.split(/\s+/));
      for (const [target, rejects] of waiting) {
        if (!words.has(target)) continue;
        for (const r of rejects) r(netError("unavailable", err.message));
      }
    } else if (err.type === "unavailable-id") {
      // A reconnect found our id claimed by someone else.
      lose("taken");
    } else if (BROKER_ERRORS.has(err.type)) {
      reconnectLater();
    }
  });

  return {
    id: peer.id,
    onLink(cb) {
      onLink = cb;
      for (const link of earlyLinks.splice(0)) cb(link);
    },
    connect(target, timeoutMs) {
      return new Promise((resolve, reject) => {
        if (closed || peer.disconnected) {
          reject(netError("offline"));
          return;
        }
        let conn: DataConnection | undefined;
        try {
          conn = peer.connect(target, { reliable: true, serialization: "raw" });
        } catch {
          conn = undefined;
        }
        if (!conn) {
          reject(netError("offline"));
          return;
        }
        const pending = conn;
        let done = false;
        const settle = (err: Error | null) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          const set = waiting.get(target);
          set?.delete(fail);
          if (set?.size === 0) waiting.delete(target);
          if (err) {
            pending.close();
            reject(err);
          } else {
            resolve(wrapConnection(pending));
          }
        };
        const fail = (err: Error) => settle(err);
        const timer = setTimeout(() => settle(netError("timeout")), timeoutMs);
        const set = waiting.get(target) ?? new Set();
        set.add(fail);
        waiting.set(target, set);
        pending.on("open", () => settle(null));
        pending.on("error", (e) => settle(netError("unavailable", String(e))));
        pending.on("close", () => settle(netError("unavailable", "closed")));
      });
    },
    onLost(cb) {
      onLost = cb;
    },
    close() {
      if (!closed) shutdown();
    },
  };
};

export const peerTransport = (signalling: string): Transport => {
  const { options, stale } = brokerFor(signalling);
  return {
    stale,
    open(id) {
      return new Promise((resolve, reject) => {
        if (!options) {
          reject(netError("offline", "unusable signalling URL"));
          return;
        }
        let peer: Peer;
        try {
          peer = new Peer(id, options);
        } catch (err) {
          reject(netError("invalid", String(err)));
          return;
        }
        let settled = false;
        const settle = (err: Error | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          peer.off("open", onOpen);
          peer.off("error", onError);
          if (err) {
            peer.destroy();
            reject(err);
          } else {
            resolve(wrapPeer(peer));
          }
        };
        const onOpen = () => settle(null);
        const onError = (err: PeerError<string>) =>
          settle(
            netError(
              err.type === "unavailable-id"
                ? "taken"
                : err.type === "invalid-id"
                  ? "invalid"
                  : "offline",
              err.message,
            ),
          );
        const timer = setTimeout(
          () => settle(netError("offline", "broker timeout")),
          OPEN_TIMEOUT_MS,
        );
        peer.on("open", onOpen);
        peer.on("error", onError);
      });
    },
    close() {},
  };
};
