import { checkPin } from "../../core/admin";
import { derivePinVerifier } from "../../core/adminkey";
import { loadPin, loadSecret, savePin, saveSecret } from "../credentials";
import { validateAdminKey, validatePin, validateRoom } from "../landing/config";
import { choiceField, textField } from "../landing/controls";
import { h } from "../landing/dom";
import { splitPeer, validatePeer, withPeerKey } from "../signalling";

/** A room this console can join: `peer` is "public" or a server address carrying its secret. */
export interface AdminTarget {
  room: string;
  ak: string;
  pv: string;
  peer: string;
}

/** What the form edits. `pv` is known only from a pasted admin link, and only for its key. */
export interface ConnectDraft {
  room: string;
  ak: string;
  pv: string | null;
  signalling: "public" | "custom";
  address: string;
  secret: string;
  pin: string;
}

const LAST_KEY = "hc:admin:last";
const LANDING_KEY = "hc:landing";

const SAFE = /^[A-Za-z0-9_-]{1,64}$/;

const readJson = (key: string): Record<string, unknown> | null => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    return typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const text = (value: unknown, max = 300): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/**
 * The form's starting values: the room this console last joined, or else the landing page's
 * saved room, with the PIN and secret this browser remembers.
 */
export const initialDraft = (): ConnectDraft => {
  const saved = readJson(LAST_KEY) ?? readJson(LANDING_KEY) ?? {};
  const address = text(saved.customPeer ?? saved.address);
  const signalling = saved.signalling === "custom" ? "custom" : "public";
  return {
    room: text(saved.room, 64),
    ak: text(saved.ak, 64),
    pv: null,
    signalling,
    address,
    secret: signalling === "custom" ? loadSecret(address) : "",
    pin: loadPin(),
  };
};

/** The form for a room this console is leaving, so changing one detail is quick. */
export const draftFromTarget = (target: AdminTarget): ConnectDraft => {
  const { address, secret } =
    target.peer === "public" ? { address: "", secret: "" } : splitPeer(target.peer);
  return {
    room: target.room,
    ak: target.ak,
    pv: target.pv,
    signalling: address ? "custom" : "public",
    address,
    secret,
    pin: loadPin(),
  };
};

/** Remember a room this console joined, without its secret (that is kept with the PIN). */
export const rememberTarget = (target: AdminTarget): void => {
  const { address, secret } =
    target.peer === "public" ? { address: "", secret: "" } : splitPeer(target.peer);
  try {
    localStorage.setItem(
      LAST_KEY,
      JSON.stringify({
        room: target.room,
        ak: target.ak,
        signalling: address ? "custom" : "public",
        address,
      }),
    );
  } catch {
    // Storage can be unavailable; the form then starts from the landing page's room.
  }
  if (address) saveSecret(address, secret);
};

/**
 * Values from a pasted admin link or frame URL, or null if it has neither a room nor a key.
 * A frame URL's `{placeholders}` and unknown parameters are ignored.
 */
export const draftFromLink = (link: string, base: ConnectDraft): ConnectDraft | null => {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  const q = url.searchParams;
  const room = q.get("room") ?? "";
  const ak = q.get("ak") ?? "";
  if (!SAFE.test(room) && !SAFE.test(ak)) return null;
  const next = { ...base };
  if (SAFE.test(room)) next.room = room;
  if (SAFE.test(ak)) {
    next.ak = ak;
    const pv = q.get("pv") ?? "";
    next.pv = SAFE.test(pv) ? pv : null;
  }
  const peer = q.get("peer");
  if (peer === "public") {
    next.signalling = "public";
  } else if (peer) {
    const { address, secret } = splitPeer(peer);
    next.signalling = "custom";
    next.address = address;
    next.secret = secret || loadSecret(address);
  }
  return next;
};

export const draftErrors = (d: ConnectDraft): string[] =>
  [
    validateRoom(d.room),
    validateAdminKey(d.ak),
    d.signalling === "custom" ? validatePeer(d.address) : null,
    d.pin ? validatePin(d.pin) : "Enter the PIN.",
  ].filter((e): e is string => e !== null);

/**
 * The verifier for the typed PIN. A pasted admin link's own check must match it; otherwise the
 * PIN typed here becomes this console's lock. Null when it doesn't match.
 */
export const verifierFor = async (d: ConnectDraft): Promise<string | null> => {
  if (d.pv) return (await checkPin(d.pin, d.ak, d.pv)) ? d.pv : null;
  return derivePinVerifier(d.pin, d.ak);
};

/**
 * The form shown when the address has no room: paste a link or type the room, key and PIN.
 * The PIN typed here unlocks the console straight away.
 */
export const createConnectForm = (
  start: ConnectDraft,
  onConnect: (target: AdminTarget) => void,
): HTMLElement => {
  let draft = { ...start };
  let busy = false;
  const card = h("section", { class: "adm-card adm-connect" });
  const errorsEl = h("div", { class: "adm-errors", role: "alert" });

  const render = () => {
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.focus;
    const paste = textField({
      name: "link",
      label: "Admin link or frame URL",
      value: "",
      type: "url",
      placeholder: "https://…/admin/?room=…",
      hint: "Paste one to fill in the fields below.",
      onInput: (v) => {
        const next = draftFromLink(v, draft);
        paste.setError(v.trim() && !next ? "That link has no room or admin key." : null);
        if (!next) return;
        draft = next;
        render();
      },
    });
    const room = textField({
      name: "room",
      label: "Room token",
      value: draft.room,
      maxlength: 64,
      onInput: (v) => {
        draft.room = v.trim();
      },
    });
    room.input.classList.add("mono");
    const key = textField({
      name: "ak",
      label: "Admin key",
      value: draft.ak,
      maxlength: 64,
      hint: "From the configuration panel's Admin section.",
      onInput: (v) => {
        draft.ak = v.trim();
        draft.pv = null;
      },
    });
    key.input.classList.add("mono");
    const signalling = choiceField<ConnectDraft["signalling"]>({
      name: "signalling",
      label: "Signalling",
      value: draft.signalling,
      choices: [
        { id: "public", title: "Public broker" },
        { id: "custom", title: "Custom server" },
      ],
      onChange: (v) => {
        draft.signalling = v;
        if (v === "custom" && !draft.secret) draft.secret = loadSecret(draft.address);
        render();
      },
    });
    const server =
      draft.signalling === "custom"
        ? (() => {
            const address = textField({
              name: "address",
              label: "Server address",
              value: draft.address,
              type: "url",
              placeholder: "wss://signal.example.org/hc",
              onInput: (v) => {
                draft.address = v.trim();
                const stored = loadSecret(draft.address);
                if (stored) {
                  draft.secret = stored;
                  secret.input.value = stored;
                }
              },
            });
            address.input.classList.add("mono");
            const secret = textField({
              name: "secret",
              label: "Shared secret",
              value: draft.secret,
              type: "password",
              maxlength: 200,
              hint: "Leave it empty if the server has none.",
              onInput: (v) => {
                draft.secret = v;
              },
            });
            secret.input.classList.add("mono");
            return [address.el, secret.el];
          })()
        : [];
    const pin = textField({
      name: "pin",
      label: "PIN",
      value: draft.pin,
      type: "password",
      inputmode: "numeric",
      maxlength: 8,
      hint: draft.pv
        ? "The PIN the link was made with."
        : "The room's admin PIN. Lock asks for it again.",
      onInput: (v, input) => {
        const digits = v.replace(/\D/g, "").slice(0, 8);
        if (digits !== v) input.value = digits;
        draft.pin = digits;
      },
    });
    pin.input.classList.add("pin");
    pin.input.setAttribute("pattern", "[0-9]*");

    const connect = h(
      "button",
      { type: "submit", class: "btn-primary", disabled: busy },
      "Connect",
    );
    const form = h(
      "form",
      {
        class: "adm-form",
        onsubmit: (e: Event) => {
          e.preventDefault();
          void submit();
        },
      },
      room.el,
      key.el,
      signalling,
      ...server,
      pin.el,
      errorsEl,
      h("div", { class: "adm-actions" }, connect),
    );
    card.replaceChildren(
      h("h1", {}, "Connect to a room"),
      h(
        "p",
        {},
        "Admin works on one room at a time, with that room's admin key. This browser remembers what you enter here.",
      ),
      paste.el,
      form,
    );
    if (focused) {
      card.querySelector<HTMLElement>(`[data-focus="${CSS.escape(focused)}"]`)?.focus();
    }
  };

  const showErrors = (errors: string[]) => {
    errorsEl.replaceChildren(...errors.map((e) => h("p", {}, e)));
    errorsEl.hidden = errors.length === 0;
  };

  const submit = async () => {
    if (busy) return;
    const errors = draftErrors(draft);
    showErrors(errors);
    if (errors.length) return;
    busy = true;
    render();
    showErrors([]);
    const d = { ...draft };
    let pv: string | null = null;
    try {
      pv = await verifierFor(d);
    } catch {
      pv = null;
    }
    busy = false;
    if (!pv) {
      render();
      showErrors([
        d.pv
          ? "That PIN doesn't match the one the link was made with."
          : "The PIN check couldn't be made on this page.",
      ]);
      return;
    }
    savePin(d.pin);
    const target: AdminTarget = {
      room: d.room,
      ak: d.ak,
      pv,
      peer: d.signalling === "custom" ? withPeerKey(d.address, d.secret) : "public",
    };
    rememberTarget(target);
    onConnect(target);
  };

  render();
  showErrors([]);
  return card;
};
