import { renderSVG } from "uqr";
import { isLoopback } from "../signalling";
import type { SimNetwork } from "./config";
import type { SimFrame } from "./presets";

export interface QrState {
  frame: SimFrame;
  url: string;
  network: SimNetwork;
  /** The own server's address, when the network is "own". */
  server: string;
  /** The sim's own copy of the frame is unloaded so the phone takes its place. */
  paused: boolean;
  usePublic(): void;
  togglePause(): void;
  close(): void;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

const p = (text: string, className = ""): HTMLParagraphElement => {
  const el = document.createElement("p");
  el.textContent = text;
  if (className) el.className = className;
  return el;
};

const button = (text: string, onClick: () => void, signal: AbortSignal): HTMLButtonElement => {
  const el = document.createElement("button");
  el.type = "button";
  el.textContent = text;
  el.addEventListener("click", onClick, { signal });
  return el;
};

/** Fill `layer` with the phone dialog for one frame. */
export const renderQr = (layer: HTMLElement, s: QrState, signal: AbortSignal): void => {
  const box = document.createElement("div");
  box.className = "sim-qr";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", `Open ${s.frame.name} on a phone`);

  const title = document.createElement("h2");
  title.textContent = `Open ${s.frame.name} on a phone`;

  const code = document.createElement("div");
  code.className = "sim-qr-code";
  // uqr builds the SVG from the URL's bits; nothing user-supplied reaches the markup.
  code.innerHTML = renderSVG(s.url, { ecc: "M", border: 2, pixelSize: 6 });

  const link = document.createElement("a");
  link.className = "sim-qr-url";
  link.href = s.url;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = s.url;

  box.append(title, code, link);
  box.append(
    p(
      `The phone letterboxes to ${s.frame.width} × ${s.frame.height} and joins this room ` +
        (s.network === "own" ? "through your own signalling server." : "over PeerJS."),
    ),
  );

  if (s.network === "local") {
    const warn = document.createElement("div");
    warn.className = "sim-qr-warn";
    warn.append(
      p(
        "The sim uses BroadcastChannel, which only reaches frames in this browser tab. " +
          "Choose the public broker or your own server under Network so the phone can talk " +
          "to the other frames.",
      ),
      button("Use the public broker", s.usePublic, signal),
    );
    box.append(warn);
  }

  let serverHost = "";
  try {
    serverHost = new URL(s.server).hostname;
  } catch {
    // No usable address; the sim's own controls show why.
  }
  if (s.network === "own" && isLoopback(serverHost)) {
    box.append(
      p(
        "The signalling server is on localhost, which a phone can't reach. Use a server " +
          "address the phone can resolve.",
        "sim-qr-note",
      ),
    );
  }

  if (LOCAL_HOSTS.has(location.hostname)) {
    box.append(
      p(
        "This address only works on this computer. Run pnpm dev:lan and open the sim at its " +
          "LAN address so a phone can reach it.",
        "sim-qr-note",
      ),
    );
  }

  const actions = document.createElement("div");
  actions.className = "sim-qr-actions";
  actions.append(
    button(
      s.paused ? "Resume this frame in the sim" : "Pause this frame in the sim",
      s.togglePause,
      signal,
    ),
    button(
      "Copy link",
      () => {
        navigator.clipboard?.writeText(s.url).catch(() => {});
      },
      signal,
    ),
    button("Close", s.close, signal),
  );
  box.append(
    p(
      "Pause the sim's copy so the phone takes its place instead of joining as a duplicate.",
      "sim-qr-note",
    ),
    actions,
  );

  layer.replaceChildren(box);
};
