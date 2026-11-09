// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_VENUE } from "../../src/core/venue";
import { loadVenueText, readVenueText, saveVenueText } from "../../src/pages/venueprofile";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("the operator's venue profile", () => {
  it("tidies pasted text: a whole parameter, percent-encoding, spaces and lines", () => {
    const tidy = "bank:4,wall:7680x2880:16x6:0.1";
    expect(readVenueText(tidy).text).toBe(tidy);
    expect(readVenueText(`venue=${encodeURIComponent(tidy)}`).text).toBe(tidy);
    expect(readVenueText(" wall:7680x2880:16x6:0.1,\n  bank:4 ").text).toBe(tidy);
    const read = readVenueText("bank:4,oops,wall:7680x2880:16x6:0.1");
    expect(read.text).toBe(tidy);
    expect(read.ignored).toEqual(["oops"]);
    expect(read.profile.bankCount).toBe(4);
    expect(readVenueText(`bank:${DEFAULT_VENUE.bankCount}`).text).toBe("");
  });

  it("is remembered in this browser, tidied, and forgotten when empty", () => {
    expect(loadVenueText()).toBe("");
    saveVenueText("bank:4");
    expect(loadVenueText()).toBe("bank:4");
    localStorage.setItem("hc:venue", "bank:4, nonsense");
    expect(loadVenueText()).toBe("bank:4");
    saveVenueText("");
    expect(localStorage.getItem("hc:venue")).toBeNull();
  });

  it("survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadVenueText()).toBe("");
    expect(() => saveVenueText("bank:4")).not.toThrow();
  });
});
