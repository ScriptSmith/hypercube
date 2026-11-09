// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  forgetCredentials,
  loadPin,
  loadSecret,
  savePin,
  saveSecret,
} from "../../src/pages/credentials";

beforeEach(() => localStorage.clear());

describe("remembered credentials", () => {
  it("keeps the PIN, and forgets it when cleared", () => {
    expect(loadPin()).toBe("");
    savePin("4821");
    expect(loadPin()).toBe("4821");
    savePin("");
    expect(loadPin()).toBe("");
    expect(localStorage.getItem("hc:credentials")).toBeNull();
  });

  it("never keeps a PIN that isn't digits", () => {
    savePin("12ab");
    expect(loadPin()).toBe("");
    localStorage.setItem("hc:credentials", JSON.stringify({ pin: "<b>", secrets: [] }));
    expect(loadPin()).toBe("");
  });

  it("gives a secret only to the address it was saved for", () => {
    saveSecret("wss://one.example.org/hc", "first");
    saveSecret("wss://two.example.org/", "second");
    expect(loadSecret("wss://one.example.org/hc")).toBe("first");
    expect(loadSecret(" wss://two.example.org ")).toBe("second");
    expect(loadSecret("wss://three.example.org/")).toBe("");
    expect(loadSecret("")).toBe("");
    saveSecret("wss://one.example.org/hc", "");
    expect(loadSecret("wss://one.example.org/hc")).toBe("");
    expect(loadSecret("wss://two.example.org/")).toBe("second");
  });

  it("keeps secrets for a bounded number of servers, newest first", () => {
    for (let i = 0; i < 12; i++) saveSecret(`wss://s${i}.example.org/`, `k${i}`);
    expect(loadSecret("wss://s11.example.org/")).toBe("k11");
    expect(loadSecret("wss://s4.example.org/")).toBe("k4");
    expect(loadSecret("wss://s3.example.org/")).toBe("");
  });

  it("forgets everything at once", () => {
    savePin("1234");
    saveSecret("wss://one.example.org/", "first");
    forgetCredentials();
    expect(loadPin()).toBe("");
    expect(loadSecret("wss://one.example.org/")).toBe("");
  });

  it("survives storage that throws or holds junk", () => {
    localStorage.setItem("hc:credentials", "{not json");
    expect(loadPin()).toBe("");
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
    try {
      expect(() => savePin("1234")).not.toThrow();
      expect(() => saveSecret("wss://one.example.org/", "x")).not.toThrow();
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});
