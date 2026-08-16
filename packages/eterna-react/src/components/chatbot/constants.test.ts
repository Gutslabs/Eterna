import { describe, expect, it } from "vitest";
import { buildSystemPrompt, SYSTEM_PROMPT } from "./constants";

describe("buildSystemPrompt", () => {
  it("includes the vision section only when the bundle has vision tools", () => {
    const withVision = buildSystemPrompt({ vision: true });
    expect(withVision).toContain("you can SEE the page");
    expect(withVision).toContain("IMAGE-BASED PAGES");
    expect(withVision).not.toContain("You cannot view images");

    const textOnly = buildSystemPrompt({ vision: false });
    expect(textOnly).not.toContain("you can SEE the page");
    expect(textOnly).not.toContain("IMAGE-BASED PAGES");
    expect(textOnly).toContain("You cannot view images");
  });

  it("carries no page-specific sections — YouTube feed describes itself in its context blocks", () => {
    for (const vision of [true, false]) {
      expect(buildSystemPrompt({ vision })).not.toContain("YOUTUBE TRANSCRIPT");
    }
  });

  it("keeps shared sections in both variants", () => {
    for (const vision of [true, false]) {
      const prompt = buildSystemPrompt({ vision });
      expect(prompt).toContain("Eterna browser assistant");
      expect(prompt).toContain("=== CONTEXT BLOCKS ===");
      expect(prompt).toContain(
        "You have NO tools for clipboard or window management",
      );
    }
  });

  it("routes drawing through render_diagram in both variants", () => {
    // Prompt-level "write mermaid, never ASCII" directives failed reproducibly
    // (the model drew pipe-and-dash art even with the ban as the entire system
    // prompt); the schema-forced tool is what actually works, so the prompt
    // only points at it. Drawing is a surface property, not a tool-bundle one —
    // the pointer must survive the text-only/background builds too.
    for (const vision of [true, false]) {
      const prompt = buildSystemPrompt({ vision });
      expect(prompt).toContain("render_diagram");
      expect(prompt).toContain("Never sketch diagrams");
    }
  });

  it("exports the full-capability prompt for backwards compatibility", () => {
    expect(SYSTEM_PROMPT).toBe(buildSystemPrompt({ vision: true }));
  });
});
