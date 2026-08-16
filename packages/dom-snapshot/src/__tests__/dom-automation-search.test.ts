import { describe, expect, it } from "vitest";
import { searchAndFormat, searchSnapshotText } from "../query";
import type { DomSnapshotNode, SerializedDomSnapshot } from "../types";

describe("searchSnapshotText", () => {
  const sampleSnapshotText = `→uid=root RootWebArea "Test Page" <body>
 uid=btn1 button "Submit Form" <button>
 uid=btn2 button "Cancel" <button>
 uid=input1 textbox "Email" <input> desc="Enter your email"
 uid=link1 link "Learn More" <a>
  StaticText "Welcome to our site"
 uid=btn3 button "Login" <button>
 uid=btn4 button "Sign In" <button>`;

  it("finds simple text matches", () => {
    const result = searchSnapshotText(sampleSnapshotText, "Submit");

    expect(result.totalMatches).toBe(1);
    expect(result.matchedLines.length).toBe(1);
  });

  it("finds multiple matches with | separator", () => {
    const result = searchSnapshotText(sampleSnapshotText, "Login | Sign In");

    expect(result.totalMatches).toBe(2);
    expect(result.matchedLines.length).toBe(2);
  });

  it("performs case-insensitive search by default", () => {
    const result = searchSnapshotText(sampleSnapshotText, "submit");

    expect(result.totalMatches).toBe(1);
  });

  it("performs case-sensitive search when option is set", () => {
    const result = searchSnapshotText(sampleSnapshotText, "submit", {
      caseSensitive: true,
    });

    expect(result.totalMatches).toBe(0);
  });

  it("returns empty result for no matches", () => {
    const result = searchSnapshotText(sampleSnapshotText, "NonExistent");

    expect(result.totalMatches).toBe(0);
    expect(result.matchedLines).toEqual([]);
    expect(result.contextLines).toEqual([]);
  });

  it("returns empty result for empty query", () => {
    const result = searchSnapshotText(sampleSnapshotText, "");

    expect(result.totalMatches).toBe(0);
  });

  it("includes context lines around matches", () => {
    const result = searchSnapshotText(sampleSnapshotText, "Email", {
      contextLevels: 1,
    });

    expect(result.totalMatches).toBe(1);
    expect(result.contextLines.length).toBeGreaterThan(1);
  });

  it("supports glob pattern with asterisk", () => {
    const result = searchSnapshotText(sampleSnapshotText, "button*", {
      useGlob: true,
    });

    expect(result.totalMatches).toBeGreaterThan(0);
  });

  it("supports glob pattern matching anywhere in line", () => {
    const result = searchSnapshotText(sampleSnapshotText, "*Form*", {
      useGlob: true,
    });

    expect(result.totalMatches).toBe(1);
  });

  it("auto-detects glob patterns", () => {
    const result = searchSnapshotText(sampleSnapshotText, "*Cancel*");

    expect(result.totalMatches).toBe(1);
  });

  it("handles multiple search terms with mixed glob patterns", () => {
    const result = searchSnapshotText(
      sampleSnapshotText,
      "Submit | *Cancel* | Login",
    );

    expect(result.totalMatches).toBe(3);
  });

  it("supports question mark glob pattern", () => {
    const text = "line1 test\nline2 text\nline3 tent";
    const result = searchSnapshotText(text, "*te?t*", { useGlob: true });

    expect(result.totalMatches).toBe(3);
  });

  it("supports brace expansion in glob patterns", () => {
    const result = searchSnapshotText(sampleSnapshotText, "*{Login,Cancel}*", {
      useGlob: true,
    });

    expect(result.totalMatches).toBe(2);
  });
});

describe("searchAndFormat", () => {
  const createMockSnapshot = (): SerializedDomSnapshot => {
    const button1: DomSnapshotNode = {
      id: "btn1",
      role: "button",
      name: "Submit Form",
      children: [],
      tagName: "button",
    };

    const button2: DomSnapshotNode = {
      id: "btn2",
      role: "button",
      name: "Cancel",
      children: [],
      tagName: "button",
    };

    const input: DomSnapshotNode = {
      id: "input1",
      role: "textbox",
      name: "Email",
      children: [],
      tagName: "input",
      placeholder: "Enter your email",
    };

    const root: DomSnapshotNode = {
      id: "root",
      role: "RootWebArea",
      name: "Test Page",
      children: [button1, button2, input],
      tagName: "body",
    };

    return {
      root,
      idToNode: { root, btn1: button1, btn2: button2, input1: input },
      totalNodes: 4,
      timestamp: Date.now(),
      metadata: {
        title: "Test",
        url: "https://test.com",
        collectedAt: new Date().toISOString(),
        options: {},
      },
    };
  };

  it("returns formatted results with matches", () => {
    const snapshot = createMockSnapshot();
    const result = searchAndFormat(snapshot, "Submit");

    expect(result).not.toBeNull();
    expect(result).toContain("Submit");
  });

  it("returns no matches message when query not found", () => {
    const snapshot = createMockSnapshot();
    const result = searchAndFormat(snapshot, "NonExistent");

    expect(result).toContain("No matches found");
  });

  it("returns null for null snapshot", () => {
    const result = searchAndFormat(
      null as unknown as SerializedDomSnapshot,
      "test",
    );

    expect(result).toBeNull();
  });

  it("respects contextLevels parameter", () => {
    const snapshot = createMockSnapshot();
    const result = searchAndFormat(snapshot, "Email", 2);

    expect(result).not.toBeNull();
    expect(result).toContain("Email");
  });

  it("passes search options through", () => {
    const snapshot = createMockSnapshot();
    const result = searchAndFormat(snapshot, "submit", 1, {
      caseSensitive: true,
    });

    expect(result).toContain("No matches found");
  });

  it("marks matched lines with checkmark", () => {
    const snapshot = createMockSnapshot();
    const result = searchAndFormat(snapshot, "Cancel");

    expect(result).not.toBeNull();
    expect(result).toContain("✓");
  });

  it("handles multiple search terms", () => {
    const snapshot = createMockSnapshot();
    const result = searchAndFormat(snapshot, "Submit | Cancel");

    expect(result).not.toBeNull();
    expect(result).toContain("Submit");
    expect(result).toContain("Cancel");
  });
});
