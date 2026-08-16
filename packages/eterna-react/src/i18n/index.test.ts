import { afterEach, describe, expect, it, vi } from "vitest";
import {
  detectBrowserLanguage,
  getTranslation,
  isValidLanguage,
} from "./index";
import en from "./locales/en.json";
import tr from "./locales/tr.json";

function leafKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object") return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    leafKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("Turkish translations", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("contains every English translation key", () => {
    expect(leafKeys(tr).sort()).toEqual(leafKeys(en).sort());
  });

  it("recognizes Turkish settings and browser locales", () => {
    vi.stubGlobal("navigator", { language: "tr-TR" });
    expect(isValidLanguage("tr")).toBe(true);
    expect(detectBrowserLanguage()).toBe("tr");
  });

  it("interpolates Turkish translations", () => {
    expect(getTranslation("tr", "activity.steps", { count: 4 })).toBe("4 adım");
  });
});
