import { describe, expect, it } from "vitest";
import { matchSkillTriggers, renderSkillIndex } from "./skill";

describe("renderSkillIndex", () => {
  it("is empty when no skills are enabled", () => {
    expect(renderSkillIndex([])).toBe("");
    expect(
      renderSkillIndex([{ name: "x", description: "y", enabled: false }]),
    ).toBe("");
  });

  it("renders one routing line per enabled skill, triggers included", () => {
    const block = renderSkillIndex([
      {
        name: "grammar-correct",
        description:
          "Correct the user's casual English into natural, native-sounding text while keeping their tone and exact meaning, then explain the meaning in Turkish. Use when the user asks to correct grammar.",
        enabled: true,
      },
      { name: "disabled-skill", description: "Nope.", enabled: false },
    ]);
    expect(block).toContain("=== SKILLS (load on demand) ===");
    expect(block).toContain("MUST call load_skill");
    expect(block).toContain(
      "- grammar-correct: Correct the user's casual English",
    );
    expect(block).toContain("Use when the user asks to correct grammar");
    expect(block).not.toContain("disabled-skill");
  });
});

describe("matchSkillTriggers", () => {
  it.each([
    "correct grammar",
    "Correct my grammar please",
    "fix the english here",
    "can you check my English",
    "grammar check",
    "grammar correction",
    "is this correct?",
    "ingilizcemi düzelt",
    "[page: X] long page text …\n\ncorrect grammar",
  ])("routes %j to grammar-correct", (text) => {
    expect(matchSkillTriggers(text)).toEqual(["grammar-correct"]);
  });

  it.each([
    "summarize this page",
    "correct the record on this claim",
    "what is grammar?",
    "fix this bug in my code",
  ])("does not route %j", (text) => {
    expect(matchSkillTriggers(text)).toEqual([]);
  });
});
