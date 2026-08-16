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

  it.each([
    "bunu basitçe anlatsana",
    "basitce anlatır mısın",
    "basit anlat şunu",
    "basit bir şekilde açıkla",
    "basit bir sekilde anlatir misin",
    "basit anlatım kullanarak anlatır mısın",
    "aptala anlatır gibi anlat",
    "5 yaşındaymışım gibi anlat",
    "beş yaşında birine anlatır gibi",
    "sade bir dille anlat",
    "olabildiğince basite indirge",
    "eli5 this thread",
    "explain this to me simply",
    "explain it like i'm 5",
    "put it in layman's terms",
  ])("routes %j to basit-anlatim", (text) => {
    expect(matchSkillTriggers(text)).toEqual(["basit-anlatim"]);
  });

  it.each([
    "diyagram kullanarak anlatır mısın",
    "bu makaleyi özetle",
    "explain this error",
    "what is a simple moving average?",
    "basit bir soru soracağım",
  ])("does not route %j to basit-anlatim", (text) => {
    expect(matchSkillTriggers(text)).toEqual([]);
  });
});
