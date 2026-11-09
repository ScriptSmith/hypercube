import {
  ADMIN_APP,
  checkPin,
  createLink,
  createPanel,
  createPinLock,
  createPinPad,
  ensureAdminStyles,
  importAdminKey,
} from "../../core/admin";
import { connectRoom } from "../../core/net";
import { listApps } from "../../core/registry";
import type { Room } from "../../core/types";
import {
  type AdminTarget,
  createConnectForm,
  draftFromTarget,
  initialDraft,
  rememberTarget,
} from "./connect";

/** The /admin/ page URL: `?room=&ak=&pv=&peer=&transport=`. */
export interface AdminPageParams {
  room: string | null;
  ak: string | null;
  /** PIN verifier; the page can't be unlocked without it. */
  pv: string | null;
  peer: string;
  transport: "peer" | "local";
}

const SAFE = /^[A-Za-z0-9_-]{1,64}$/;

export const parseAdminUrl = (search: string): AdminPageParams => {
  const q = new URLSearchParams(search);
  const room = q.get("room");
  const ak = q.get("ak");
  const pv = q.get("pv");
  return {
    room: room && SAFE.test(room) ? room : null,
    ak: ak && SAFE.test(ak) ? ak : null,
    pv: pv && SAFE.test(pv) ? pv : null,
    peer: q.get("peer") || "public",
    transport: q.get("transport") === "local" ? "local" : "peer",
  };
};

/** A frame id for this console, unique enough that two operators' pages never collide. */
export const consoleId = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `admin-${Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("")}`;
};

/** Read by browser checks. */
export interface AdminPageDebug {
  readonly room: Room | null;
  readonly unlocked: boolean;
}

declare global {
  interface Window {
    __hypercubeAdmin?: AdminPageDebug;
  }
}

const make = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text?: string,
): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};

const CONFIG_LINK = "../#/diag";

export const startAdminPage = (host: HTMLElement): AdminPageDebug => {
  ensureAdminStyles();
  const params = parseAdminUrl(location.search);
  host.classList.add("adm");

  const top = make("header", "adm-top");
  const brand = make("a", "adm-brand", "Hypercube admin");
  brand.href = "../";
  const roomEl = make("span", "adm-room");
  const conn = make("span", "adm-conn");
  const change = make("button", "btn-quiet adm-change", "Change room");
  change.type = "button";
  change.hidden = true;
  top.append(brand, roomEl, conn, change);
  const main = make("main", "adm-main");
  host.append(top, main);

  let room: Room | null = null;
  let unlocked = false;
  /** Leaves the current room: its panel or PIN pad, the link and the connection. */
  let leave: (() => void) | null = null;
  let current: AdminTarget | null = null;
  const debug: AdminPageDebug = {
    get room() {
      return room;
    },
    get unlocked() {
      return unlocked;
    },
  };
  window.__hypercubeAdmin = debug;

  const explain = (title: string, ...lines: (string | HTMLElement)[]) => {
    const card = make("section", "adm-card");
    card.append(make("h1", "", title));
    for (const line of lines) {
      const p = make("p");
      p.append(line);
      card.append(p);
    }
    main.replaceChildren(card);
  };

  const configLink = () => {
    const a = make("a", "btn btn-primary", "Open the configuration panel");
    a.href = CONFIG_LINK;
    return a;
  };

  if (!globalThis.crypto?.subtle) {
    explain(
      "This page needs a secure connection",
      "Signing admin commands needs HTTPS or localhost. Open this page over HTTPS.",
    );
    return debug;
  }

  /** The connect form, filled in with the room being left or else what this browser remembers. */
  const showForm = (from: AdminTarget | null) => {
    leave?.();
    leave = null;
    current = null;
    // The address bar keeps no keys once the form is in use; a reload brings the form back.
    const local = params.transport === "local" ? "?transport=local" : "";
    history.replaceState(null, "", location.pathname + local);
    roomEl.replaceChildren();
    conn.hidden = true;
    change.hidden = true;
    main.replaceChildren(
      createConnectForm(from ? draftFromTarget(from) : initialDraft(), (target) =>
        join(target, params.transport, true),
      ),
    );
  };

  /** Join a room. `unlockedNow` skips the PIN pad because the PIN was just typed in the form. */
  const join = (target: AdminTarget, transport: "peer" | "local", unlockedNow: boolean) => {
    leave?.();
    current = target;
    const { ak, pv } = target;
    roomEl.replaceChildren("Room ", make("code", "", target.room));
    conn.hidden = false;
    change.hidden = false;
    const key = importAdminKey(ak);
    const r = connectRoom({
      room: target.room,
      self: {
        frame: consoleId(),
        app: ADMIN_APP,
        group: "admin",
        kind: "kiosk",
        role: "solo",
        pos: 0,
      },
      signalling: target.peer,
      transport,
      hubEligible: false,
    });
    room = r;
    const showConn = () => {
      conn.textContent =
        r.status === "online" ? "Online" : r.status === "offline" ? "Offline" : "Connecting";
      conn.dataset.tone = r.status === "online" ? "good" : r.status === "offline" ? "bad" : "wait";
    };
    showConn();
    const offStatus = r.onStatus(showConn);
    const link = createLink(r, key);
    const lock = createPinLock();
    let dispose: (() => void) | null = null;
    let left = false;

    const showPad = () => {
      dispose?.();
      unlocked = false;
      const wrap = make("section", "adm-pad-wrap");
      wrap.append(make("p", "adm-lead", "Enter the admin PIN for this room."));
      const pad = createPinPad({
        lock,
        check: (pin) => checkPin(pin, ak, pv),
        onUnlock: () => {
          if (transport === "peer") rememberTarget(target);
          showPanel();
        },
        onClose: () => {},
        idleMs: 0,
        keyboard: true,
        closable: false,
      });
      wrap.append(pad.el);
      main.replaceChildren(wrap);
      dispose = () => pad.dispose();
    };

    const showPanel = () => {
      dispose?.();
      unlocked = true;
      const wrap = make("section", "adm-panel-wrap");
      const panel = createPanel({ mode: "page", room: r, link, apps: listApps(), onLock: showPad });
      wrap.append(panel.el);
      main.replaceChildren(wrap);
      dispose = () => panel.dispose();
    };

    void key.then((k) => {
      if (left) return;
      if (!k) {
        explain(
          "The admin key is not valid",
          "The key is damaged or incomplete. Copy it from the configuration panel again.",
          configLink(),
        );
        return;
      }
      if (unlockedNow) showPanel();
      else showPad();
    });

    leave = () => {
      left = true;
      unlocked = false;
      dispose?.();
      offStatus();
      link.dispose();
      r.close();
      if (room === r) room = null;
    };
  };

  change.addEventListener("click", () => showForm(current));
  window.addEventListener("pagehide", () => {
    leave?.();
    leave = null;
  });

  if (params.room && params.ak && params.pv) {
    join(
      { room: params.room, ak: params.ak, pv: params.pv, peer: params.peer },
      params.transport,
      false,
    );
  } else {
    showForm(null);
  }
  return debug;
};
