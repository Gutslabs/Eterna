import { describe, expect, it } from "vitest";
import { migrateLegacyModelValue } from "./legacy-models";

describe("migrateLegacyModelValue", () => {
  it("maps every ChatGPT web sub-model onto the proxy Codex default", () => {
    expect(migrateLegacyModelValue("catgpt-browser")).toBe("gpt-5.6-sol");
    expect(migrateLegacyModelValue("catgpt-browser::GPT-5.6 Sol|Medium")).toBe(
      "gpt-5.6-sol",
    );
    // Pre-family encoding kept the level directly after the base id.
    expect(migrateLegacyModelValue("catgpt-browser::High")).toBe("gpt-5.6-sol");
  });

  it("maps Claude web families onto their proxy equivalent", () => {
    expect(migrateLegacyModelValue("claude-browser::Fable 5|Max")).toBe(
      "claude-fable-5",
    );
    expect(migrateLegacyModelValue("claude-browser::Opus 5|High")).toBe(
      "claude-opus-5",
    );
    expect(migrateLegacyModelValue("claude-browser::Sonnet 5|Low")).toBe(
      "claude-sonnet-5",
    );
  });

  it("maps retired families onto a model the proxy still serves", () => {
    expect(migrateLegacyModelValue("claude-browser::Opus 4.8|High")).toBe(
      "claude-opus-4-8",
    );
    expect(migrateLegacyModelValue("claude-browser::Sonnet 4.6|High")).toBe(
      "claude-sonnet-5",
    );
    expect(migrateLegacyModelValue("claude-browser::Haiku 4.5|Low")).toBe(
      "claude-sonnet-5",
    );
  });

  it("falls back to the Claude default for bare or unknown families", () => {
    expect(migrateLegacyModelValue("claude-browser")).toBe("claude-opus-5");
    expect(migrateLegacyModelValue("claude-browser::Nonesuch|High")).toBe(
      "claude-opus-5",
    );
  });

  it("leaves live and third-party model ids untouched", () => {
    for (const id of [
      "claude-opus-5",
      "claude-opus-5::xhigh",
      "gpt-5.6-sol",
      "gemini-3.7-flash-high",
      "grok-4.6",
      "anthropic/claude-3.5-sonnet",
      "claude-browser-lookalike",
    ]) {
      expect(migrateLegacyModelValue(id)).toBe(id);
    }
  });

  it("replaces ids the picker no longer offers", () => {
    expect(migrateLegacyModelValue("grok-4.3")).toBe("grok-4.6");
    expect(migrateLegacyModelValue("grok-4.5")).toBe("grok-4.6");
    expect(migrateLegacyModelValue("grok-composer-2.5-fast")).toBe("grok-4.6");
    expect(migrateLegacyModelValue("gemini-3-flash")).toBe(
      "gemini-3.7-flash-high",
    );
    expect(migrateLegacyModelValue("gemini-3.1-pro-low")).toBe(
      "gemini-3.7-flash-high",
    );
    expect(migrateLegacyModelValue("gpt-5.5")).toBe("gpt-5.6-sol");
    expect(migrateLegacyModelValue("gpt-5.4-mini")).toBe("gpt-5.6-sol");
    expect(migrateLegacyModelValue("claude-haiku-4-5-20251001")).toBe(
      "claude-sonnet-5",
    );
  });

  it("replaces a retired id that still carries a reasoning suffix", () => {
    expect(migrateLegacyModelValue("gpt-5.5::xhigh")).toBe("gpt-5.6-sol");
  });
});
