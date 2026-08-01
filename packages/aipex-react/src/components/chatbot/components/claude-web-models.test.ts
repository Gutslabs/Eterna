import { describe, expect, it } from "vitest";
import {
  CLAUDE_WEB_EFFORT_LEVELS,
  CLAUDE_WEB_MODEL_FAMILIES,
  createClaudeWebModelEntries,
  normalizeClaudeWebModelValue,
} from "./claude-web-models";

describe("createClaudeWebModelEntries", () => {
  it("shows exactly three Claude web model families with every live effort", () => {
    const entries = createClaudeWebModelEntries();

    expect(new Set(entries.map((entry) => entry.group))).toEqual(
      new Set(["Fable 5", "Opus 5", "Sonnet 5"]),
    );
    expect(entries).toHaveLength(
      CLAUDE_WEB_MODEL_FAMILIES.length * CLAUDE_WEB_EFFORT_LEVELS.length,
    );

    for (const family of CLAUDE_WEB_MODEL_FAMILIES) {
      const familyEntries = entries.filter((entry) => entry.group === family);
      expect(familyEntries.map((entry) => entry.optionName)).toEqual(
        CLAUDE_WEB_EFFORT_LEVELS,
      );
      expect(familyEntries.map((entry) => entry.value)).toEqual(
        CLAUDE_WEB_EFFORT_LEVELS.map(
          (effort) => `claude-browser::${family}|${effort}`,
        ),
      );
    }
  });

  it("uses the live Claude descriptions and marks High as the default effort", () => {
    const entries = createClaudeWebModelEntries();
    const fable = entries.find(
      (entry) => entry.value === "claude-browser::Fable 5|High",
    );
    const opus = entries.find(
      (entry) => entry.value === "claude-browser::Opus 5|Max",
    );

    expect(fable?.groupDescription).toBe("For your toughest challenges");
    expect(fable?.optionDescription).toBe("Default");
    expect(opus?.groupDescription).toBe("For complex tasks");
    expect(opus?.optionDescription).toBeUndefined();
  });
});

describe("normalizeClaudeWebModelValue", () => {
  it("migrates the bare gateway and retired model families", () => {
    expect(normalizeClaudeWebModelValue("claude-browser")).toBe(
      "claude-browser::Opus 5|High",
    );
    expect(normalizeClaudeWebModelValue("claude-browser::Opus 4.8|Max")).toBe(
      "claude-browser::Opus 5|Max",
    );
    expect(normalizeClaudeWebModelValue("claude-browser::Sonnet 4.6")).toBe(
      "claude-browser::Sonnet 5|High",
    );
    expect(normalizeClaudeWebModelValue("claude-browser::Haiku 4.5|Low")).toBe(
      "claude-browser::Sonnet 5|Low",
    );
  });

  it("normalizes xhigh to Claude web's visible Extra label", () => {
    expect(normalizeClaudeWebModelValue("claude-browser::Fable 5|xhigh")).toBe(
      "claude-browser::Fable 5|Extra",
    );
  });

  it("does not touch non-web Claude models", () => {
    expect(normalizeClaudeWebModelValue("claude-opus-4-8")).toBe(
      "claude-opus-4-8",
    );
  });
});
