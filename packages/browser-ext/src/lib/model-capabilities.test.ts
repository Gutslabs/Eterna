import { describe, expect, it } from "vitest";
import { modelSupportsVision } from "./model-capabilities";

describe("modelSupportsVision", () => {
  it.each([
    "gpt-5.5",
    "openai/gpt-4o",
    "gpt-4-turbo",
    "claude-sonnet-4-6",
    "gemini-3-flash",
    "grok-4.3",
    "qwen2.5-vl",
  ])("recognizes vision model %s", (model) => {
    expect(modelSupportsVision(model)).toBe(true);
  });

  it.each([
    undefined,
    "deepseek-chat",
    "gpt-3.5-turbo",
    "command-r",
  ])("falls back to text for %s", (model) => {
    expect(modelSupportsVision(model)).toBe(false);
  });
});
