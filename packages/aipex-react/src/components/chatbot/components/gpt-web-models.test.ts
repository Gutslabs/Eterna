import { describe, expect, it } from "vitest";
import {
  createGptWebModelEntries,
  GPT_WEB_INTELLIGENCE_LEVELS,
  GPT_WEB_MODEL_FAMILIES,
  normalizeGptWebModelValue,
} from "./gpt-web-models";

describe("createGptWebModelEntries", () => {
  it("exposes only the current ChatGPT web family at every intelligence level", () => {
    const entries = createGptWebModelEntries();

    expect(new Set(entries.map((entry) => entry.group))).toEqual(
      new Set(["GPT-5.6 Sol"]),
    );
    expect(entries).toHaveLength(
      GPT_WEB_MODEL_FAMILIES.length * GPT_WEB_INTELLIGENCE_LEVELS.length,
    );
    expect(new Set(entries.map((entry) => entry.value)).size).toBe(
      entries.length,
    );

    for (const family of GPT_WEB_MODEL_FAMILIES) {
      const familyEntries = entries.filter((entry) => entry.group === family);
      expect(familyEntries.map((entry) => entry.optionName)).toEqual(
        GPT_WEB_INTELLIGENCE_LEVELS,
      );
      expect(familyEntries.map((entry) => entry.value)).toEqual(
        GPT_WEB_INTELLIGENCE_LEVELS.map(
          (intelligence) => `catgpt-browser::${family}|${intelligence}`,
        ),
      );
    }
  });

  it("migrates legacy mode-only values to the current default family", () => {
    expect(normalizeGptWebModelValue("catgpt-browser::High")).toBe(
      "catgpt-browser::GPT-5.6 Sol|High",
    );
    expect(normalizeGptWebModelValue("catgpt-browser")).toBe(
      "catgpt-browser::GPT-5.6 Sol|Instant",
    );
  });

  it("migrates retired families while keeping the chosen intelligence", () => {
    expect(normalizeGptWebModelValue("catgpt-browser::GPT-5.3|Medium")).toBe(
      "catgpt-browser::GPT-5.6 Sol|Medium",
    );
    expect(normalizeGptWebModelValue("catgpt-browser::GPT-5.5|High")).toBe(
      "catgpt-browser::GPT-5.6 Sol|High",
    );
    expect(normalizeGptWebModelValue("catgpt-browser::o3|High")).toBe(
      "catgpt-browser::GPT-5.6 Sol|High",
    );
  });

  it("leaves models from other providers untouched", () => {
    expect(normalizeGptWebModelValue("claude-browser::Opus 5|High")).toBe(
      "claude-browser::Opus 5|High",
    );
    expect(normalizeGptWebModelValue("gpt-5.5")).toBe("gpt-5.5");
  });

  it("marks the default intelligence level", () => {
    const entries = createGptWebModelEntries();
    const instant = entries.find(
      (entry) => entry.value === "catgpt-browser::GPT-5.6 Sol|Instant",
    );
    const high = entries.find(
      (entry) => entry.value === "catgpt-browser::GPT-5.6 Sol|High",
    );

    expect(instant?.optionDescription).toBe("Default");
    expect(instant?.groupDescription).toBe("ChatGPT web");
    expect(high?.optionDescription).toBeUndefined();
  });
});
