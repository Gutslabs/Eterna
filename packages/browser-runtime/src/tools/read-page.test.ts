import { describe, expect, it } from "vitest";
import { buildOutline, chunkPage } from "./read-page";

const DOC = [
  "# Title",
  "intro line",
  `## Section A\n${"a".repeat(50)}`,
  `## Section B\n${"b".repeat(50)}`,
  `### Section B.1\n${"c".repeat(50)}`,
  `## Section C\n${"d".repeat(50)}`,
].join("\n");

describe("chunkPage", () => {
  it("returns the whole document untouched when it fits the limit", () => {
    const chunk = chunkPage(DOC, { limit: 100000 });
    expect(chunk.content).toBe(DOC);
    expect(chunk.outline).toBeUndefined();
    expect(chunk.nextOffset).toBeUndefined();
  });

  it("returns the first chunk plus an outline and nextOffset for long docs", () => {
    const chunk = chunkPage(DOC, { limit: 40 });
    expect(chunk.content).toBe(DOC.slice(0, 40));
    expect(chunk.outline).toContain("- Title");
    expect(chunk.nextOffset).toBe(40);
  });

  it("continues from a byte offset", () => {
    const chunk = chunkPage(DOC, { limit: 30, offset: 10 });
    expect(chunk.content).toBe(DOC.slice(10, 40));
    expect(chunk.nextOffset).toBe(40);
  });

  it("jumps to a requested section and stops at the next same-or-higher heading", () => {
    const chunk = chunkPage(DOC, { limit: 200, section: "Section B" });
    expect(chunk.section).toBe("Section B");
    expect(chunk.content.startsWith("## Section B")).toBe(true);
    // Includes the nested B.1 subsection...
    expect(chunk.content).toContain("Section B.1");
    expect(chunk.content).toContain("c".repeat(50));
    // ...but stops before the sibling Section C.
    expect(chunk.content).not.toContain("Section C");
    expect(chunk.content).not.toContain("d".repeat(50));
    expect(chunk.nextOffset).toBeDefined();
  });

  it("falls back to the first chunk when the section is not found", () => {
    const chunk = chunkPage(DOC, { limit: 40, section: "Nonexistent" });
    expect(chunk.section).toBeUndefined();
    expect(chunk.content).toBe(DOC.slice(0, 40));
  });
});

describe("buildOutline", () => {
  it("renders headings as a nested bullet list by level", () => {
    const outline = buildOutline(DOC);
    expect(outline).toContain("- Title");
    expect(outline).toContain("  - Section A");
    expect(outline).toContain("  - Section B");
    expect(outline).toContain("    - Section B.1");
  });

  it("returns an empty string when there are no headings", () => {
    expect(buildOutline("just text, no headings")).toBe("");
  });
});
