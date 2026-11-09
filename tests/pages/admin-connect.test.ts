// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { derivePinVerifier } from "../../src/core/adminkey";
import {
  type ConnectDraft,
  createConnectForm,
  draftErrors,
  draftFromLink,
  initialDraft,
  rememberTarget,
  verifierFor,
} from "../../src/pages/admin/connect";
import { loadPin, loadSecret, savePin, saveSecret } from "../../src/pages/credentials";

const ROOM = "k3j9x2mq7a";
const AK = "AAAAAAAAAAAAAAAAAAAAAA";
const SERVER = "wss://signal.example.org/hc";

const blank: ConnectDraft = {
  room: "",
  ak: "",
  pv: null,
  signalling: "public",
  address: "",
  secret: "",
  pin: "",
};

beforeEach(() => {
  localStorage.clear();
  document.body.replaceChildren();
});

describe("admin connect form", () => {
  it("starts from the landing page's room with the remembered PIN and secret", () => {
    localStorage.setItem(
      "hc:landing",
      JSON.stringify({ room: ROOM, ak: AK, signalling: "custom", customPeer: SERVER }),
    );
    savePin("4821");
    saveSecret(SERVER, "hush");
    expect(initialDraft()).toEqual({
      room: ROOM,
      ak: AK,
      pv: null,
      signalling: "custom",
      address: SERVER,
      secret: "hush",
      pin: "4821",
    });
  });

  it("prefers the room this console joined last, and keeps its secret apart", () => {
    localStorage.setItem("hc:landing", JSON.stringify({ room: "aaaaaaaaaa", ak: AK }));
    rememberTarget({ room: ROOM, ak: AK, pv: "pv", peer: `${SERVER}?key=hush` });
    expect(localStorage.getItem("hc:admin:last")).not.toContain("hush");
    expect(loadSecret(SERVER)).toBe("hush");
    expect(initialDraft()).toMatchObject({ room: ROOM, signalling: "custom", secret: "hush" });
  });

  it("fills the fields from a pasted admin link or frame URL", () => {
    const admin = `https://example.org/admin/?room=${ROOM}&ak=${AK}&pv=PVPVPV&peer=${encodeURIComponent(`${SERVER}?key=hush`)}`;
    expect(draftFromLink(admin, blank)).toEqual({
      ...blank,
      room: ROOM,
      ak: AK,
      pv: "PVPVPV",
      signalling: "custom",
      address: SERVER,
      secret: "hush",
    });
    const frame = `https://example.org/play/?app=hockey&room=${ROOM}&frame={frame}&pos={index}`;
    expect(draftFromLink(frame, { ...blank, ak: AK })).toMatchObject({ room: ROOM, ak: AK });
    expect(draftFromLink("https://example.org/play/?app=hockey", blank)).toBeNull();
    expect(draftFromLink("not a link", blank)).toBeNull();
  });

  it("asks for a room, key and PIN", () => {
    expect(draftErrors(blank)).toHaveLength(3);
    const good = { ...blank, room: ROOM, ak: AK, pin: "4821" };
    expect(draftErrors(good)).toEqual([]);
    expect(draftErrors({ ...good, signalling: "custom", address: "ws://far.example.org" })).toEqual(
      ["Signalling address must start with wss://."],
    );
  });

  it("checks the PIN against a pasted link's check, and makes one otherwise", async () => {
    const pv = await derivePinVerifier("4821", AK);
    const draft = { ...blank, room: ROOM, ak: AK, pin: "4821" };
    expect(await verifierFor({ ...draft, pv })).toBe(pv);
    expect(await verifierFor({ ...draft, pv, pin: "1111" })).toBeNull();
    expect(await verifierFor(draft)).toBe(pv);
  });

  it("connects with the typed values and remembers them", async () => {
    let joined: unknown = null;
    const form = createConnectForm({ ...blank, room: ROOM, ak: AK }, (t) => {
      joined = t;
    });
    document.body.append(form);
    const pin = form.querySelector<HTMLInputElement>('input[data-focus="pin"]')!;
    pin.value = "48x21";
    pin.dispatchEvent(new Event("input"));
    expect(pin.value).toBe("4821");
    form.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    const start = Date.now();
    while (!joined && Date.now() - start < 5000) await new Promise((r) => setTimeout(r, 20));
    expect(joined).toMatchObject({ room: ROOM, ak: AK, peer: "public" });
    expect(loadPin()).toBe("4821");
    expect(localStorage.getItem("hc:admin:last")).toContain(ROOM);
  });

  it("shows what is missing instead of connecting", () => {
    let joined = false;
    const form = createConnectForm(blank, () => {
      joined = true;
    });
    document.body.append(form);
    form.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(joined).toBe(false);
    expect(form.querySelector<HTMLElement>(".adm-errors")?.textContent).toContain("Enter the PIN.");
  });
});
