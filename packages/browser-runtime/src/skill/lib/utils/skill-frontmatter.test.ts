import { describe, expect, it } from "vitest";
import basitAnlatimMarkdown from "../../built-in/basit-anlatim/SKILL.md?raw";
import diagramDesignMarkdown from "../../built-in/diagram-design/SKILL.md?raw";
import grammarCorrectMarkdown from "../../built-in/grammar-correct/SKILL.md?raw";
import skillCreatorMarkdown from "../../built-in/skill-creator-browser/SKILL.md?raw";
import uxAuditMarkdown from "../../built-in/ux-audit-walkthrough/SKILL.md?raw";
import wcagMarkdown from "../../built-in/wcag22-a11y-audit/SKILL.md?raw";
import { parseSkillMetadata } from "./zip-utils";

describe("parseSkillMetadata", () => {
  // Regression: diagram-design shipped with its vendoring note ABOVE the
  // frontmatter, so every wake logged "No YAML frontmatter found in SKILL.md"
  // and the skill never registered.
  it.each([
    ["diagram-design", diagramDesignMarkdown],
    ["basit-anlatim", basitAnlatimMarkdown],
    ["grammar-correct", grammarCorrectMarkdown],
    // Directory is skill-creator-browser; the registered name is the shorter
    // one the manager uses (skill-manager.ts).
    ["skill-creator", skillCreatorMarkdown],
    ["ux-audit-walkthrough", uxAuditMarkdown],
    ["wcag22-a11y-audit", wcagMarkdown],
  ])("parses the shipped %s skill", (name, markdown) => {
    const parsed = parseSkillMetadata(markdown);
    expect(parsed.name).toBe(name);
    expect(parsed.description.length).toBeGreaterThan(20);
  });

  it("accepts CRLF, a BOM and leading blank lines", () => {
    const parsed = parseSkillMetadata(
      "﻿\n\r\n---\r\nname: windows-skill\r\ndescription: Zipped on Windows.\r\n---\r\n\r\n# Body\r\n",
    );
    expect(parsed.name).toBe("windows-skill");
    expect(parsed.description).toBe("Zipped on Windows.");
  });

  it("rejects content whose frontmatter does not open the file", () => {
    expect(() =>
      parseSkillMetadata("Some prose first.\n\n---\nname: late\n---\n"),
    ).toThrow(/No YAML frontmatter/);
  });

  it("falls back to defaults for missing fields", () => {
    const parsed = parseSkillMetadata("---\nname: bare\n---\n\n# Body\n");
    expect(parsed.name).toBe("bare");
    expect(parsed.description).toBe("No description provided");
    expect(parsed.version).toBe("1.0.0");
  });
});
