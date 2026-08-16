import { describe, expect, it } from "vitest";
import type { UIMessage } from "../../../types";
import { collectTurnCitations } from "./turn-citations";

function toolMessage(
  toolName: string,
  output: unknown,
  overrides: Record<string, unknown> = {},
): UIMessage {
  return {
    id: `m-${toolName}`,
    role: "assistant",
    parts: [
      {
        type: "tool",
        toolName,
        toolCallId: `call-${toolName}`,
        input: {},
        output,
        state: "completed",
        ...overrides,
      },
    ],
  } as UIMessage;
}

describe("collectTurnCitations", () => {
  it("collects read_url pages with titles and domains", () => {
    const citations = collectTurnCitations([
      toolMessage("read_url", {
        success: true,
        url: "https://developer.mozilla.org/fetch",
        title: "MDN fetch()",
      }),
    ]);
    expect(citations).toEqual([
      {
        id: "citation-0",
        title: "MDN fetch()",
        url: "https://developer.mozilla.org/fetch",
        domain: "developer.mozilla.org",
      },
    ]);
  });

  it("parses JSON-string outputs (the wire format of stored runs)", () => {
    const citations = collectTurnCitations([
      toolMessage(
        "read_url",
        JSON.stringify({
          success: true,
          url: "https://example.com/post",
          title: "Example Post",
        }),
      ),
    ]);
    expect(citations).toEqual([
      {
        id: "citation-0",
        title: "Example Post",
        url: "https://example.com/post",
        domain: "example.com",
      },
    ]);
  });

  it("dedupes the same url across calls and keeps the first title", () => {
    const citations = collectTurnCitations([
      toolMessage("read_url", {
        success: true,
        url: "https://example.com/a",
        title: "First",
      }),
      toolMessage("read_url", {
        success: true,
        url: "https://example.com/a",
        title: "Second",
      }),
    ]);
    expect(citations).toHaveLength(1);
    expect(citations[0]?.title).toBe("First");
  });

  it("skips failed fetches, non-web tools and incomplete calls", () => {
    const citations = collectTurnCitations([
      toolMessage("read_url", {
        success: false,
        url: "https://down.example.com",
      }),
      toolMessage("click", { success: true, url: "https://ignored.example" }),
      toolMessage(
        "read_url",
        { success: true, url: "https://pending.example" },
        { state: "executing" },
      ),
    ]);
    expect(citations).toEqual([]);
  });

  it("falls back to the domain when a page has no title", () => {
    const citations = collectTurnCitations([
      toolMessage("read_url", {
        success: true,
        url: "https://news.ycombinator.com/item?id=1",
      }),
    ]);
    expect(citations[0]?.title).toBe("news.ycombinator.com");
  });

  it("ignores non-http urls", () => {
    const citations = collectTurnCitations([
      toolMessage("read_url", { success: true, url: "javascript:alert(1)" }),
    ]);
    expect(citations).toEqual([]);
  });
});
