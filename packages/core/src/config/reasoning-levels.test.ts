import { describe, expect, it } from "vitest";
import {
  defaultReasoningLevelFor,
  normalizeModelSelection,
  reasoningLevelsFor,
  splitModelSelection,
  supportsReasoningLevels,
} from "./reasoning-levels.js";

describe("reasoningLevelsFor", () => {
  it("keeps each model's own vocabulary rather than its family's", () => {
    // gpt-5.6-* accepts max; the 5.5/5.4 generation stops at xhigh.
    expect(reasoningLevelsFor("gpt-5.6-luna")).toContain("max");
    expect(reasoningLevelsFor("gpt-5.5")).not.toContain("max");
    // 3.6 Flash accepts minimal; 3.7 advertises it but Google rejects it.
    expect(reasoningLevelsFor("gemini-3.6-flash-high")).toContain("minimal");
    expect(reasoningLevelsFor("gemini-3.7-flash-high")).not.toContain(
      "minimal",
    );
    expect(reasoningLevelsFor("gemini-3.1-pro-low")).not.toContain("minimal");
    // Grok 4.6 gained xhigh; 4.5 did not.
    expect(reasoningLevelsFor("grok-4.6")).toContain("xhigh");
    expect(reasoningLevelsFor("grok-4.5")).not.toContain("xhigh");
  });

  it("reads through an existing selection suffix", () => {
    expect(reasoningLevelsFor("claude-opus-5::xhigh")).toEqual(
      reasoningLevelsFor("claude-opus-5"),
    );
  });

  it("reports no levels for models that do not reason", () => {
    expect(supportsReasoningLevels("grok-composer-2.5-fast")).toBe(false);
    expect(supportsReasoningLevels("some-byok-model")).toBe(false);
    expect(supportsReasoningLevels(undefined)).toBe(false);
  });
});

describe("defaultReasoningLevelFor", () => {
  it("defaults Gemini low so thoughts stay out of the visible channel", () => {
    expect(defaultReasoningLevelFor("gemini-3.7-flash-high")).toBe("low");
  });

  it("defaults the rest to a middle setting", () => {
    expect(defaultReasoningLevelFor("claude-opus-5")).toBe("medium");
    expect(defaultReasoningLevelFor("gpt-5.4")).toBe("medium");
    expect(defaultReasoningLevelFor("grok-4.6")).toBe("medium");
  });

  it("is undefined when the model does no reasoning", () => {
    expect(defaultReasoningLevelFor("grok-composer-2.5-fast")).toBeUndefined();
  });
});

describe("splitModelSelection", () => {
  it("splits a valid selection", () => {
    expect(splitModelSelection("gpt-5.6-luna::max")).toEqual({
      model: "gpt-5.6-luna",
      reasoningLevel: "max",
    });
  });

  it("drops a level the model does not accept", () => {
    // max is valid for gpt-5.6-*, but not for gpt-5.5.
    expect(splitModelSelection("gpt-5.5::max")).toEqual({ model: "gpt-5.5" });
    expect(splitModelSelection("grok-4.5::xhigh")).toEqual({
      model: "grok-4.5",
    });
    expect(splitModelSelection("grok-composer-2.5-fast::high")).toEqual({
      model: "grok-composer-2.5-fast",
    });
  });

  it("passes a bare model id through", () => {
    expect(splitModelSelection("claude-opus-5")).toEqual({
      model: "claude-opus-5",
    });
  });
});

describe("normalizeModelSelection", () => {
  it("adds the model's default level when none was chosen", () => {
    expect(normalizeModelSelection("claude-opus-5")).toBe(
      "claude-opus-5::medium",
    );
    expect(normalizeModelSelection("gemini-3.1-pro-low")).toBe(
      "gemini-3.1-pro-low::low",
    );
  });

  it("keeps a level the model still accepts", () => {
    expect(normalizeModelSelection("claude-opus-5::max")).toBe(
      "claude-opus-5::max",
    );
  });

  it("falls back to the default when the stored level went away", () => {
    expect(normalizeModelSelection("gpt-5.5::max")).toBe("gpt-5.5::medium");
  });

  it("strips any suffix from a model that does no reasoning", () => {
    expect(normalizeModelSelection("grok-composer-2.5-fast::high")).toBe(
      "grok-composer-2.5-fast",
    );
    expect(normalizeModelSelection("some-byok-model")).toBe("some-byok-model");
  });

  it("leaves an empty value alone", () => {
    expect(normalizeModelSelection("")).toBe("");
    expect(normalizeModelSelection("   ")).toBe("");
  });
});
