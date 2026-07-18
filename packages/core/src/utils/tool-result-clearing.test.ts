import type { AgentInputItem } from "@openai/agents";
import { describe, expect, it } from "vitest";
import { clearStaleReadResults } from "./tool-result-clearing.js";

function readPair(
  callId: string,
  name: string,
  url: string | null,
  body: string,
): AgentInputItem[] {
  return [
    {
      type: "function_call",
      callId,
      name,
      arguments: url ? JSON.stringify({ url }) : "{}",
    } as AgentInputItem,
    {
      type: "function_call_result",
      callId,
      name,
      output: body,
    } as AgentInputItem,
  ];
}

function buildReads(count: number): AgentInputItem[] {
  const items: AgentInputItem[] = [];
  for (let i = 0; i < count; i++) {
    items.push(
      ...readPair(
        `c${i}`,
        "read_url",
        `https://example.com/${i}`,
        `BODY-${i} ${"x".repeat(2000)}`,
      ),
    );
  }
  return items;
}

const outputs = (items: AgentInputItem[]): string[] =>
  items
    .filter((i) => i.type === "function_call_result")
    .map((i) => (i as { output?: unknown }).output as string);

describe("clearStaleReadResults", () => {
  it("leaves everything intact at or below the keep-recent threshold", () => {
    const items = buildReads(6);
    expect(clearStaleReadResults(items)).toEqual(items);
  });

  it("stubs the oldest read results past the threshold, keeping a re-fetch URL", () => {
    const items = buildReads(8);
    const result = clearStaleReadResults(items);
    const out = outputs(result);
    // Oldest 2 stubbed with their URL; newest 6 untouched.
    expect(out[0]).toContain("[cleared to save context");
    expect(out[0]).toContain("https://example.com/0");
    expect(out[1]).toContain("https://example.com/1");
    expect(out[2]).toBe(`BODY-2 ${"x".repeat(2000)}`);
    expect(out[7]).toContain("BODY-7");
    // No large body survives in the stubbed entries.
    expect(out[0]).not.toContain("x".repeat(100));
  });

  it("never breaks tool-call/result pairing (items and callIds preserved)", () => {
    const items = buildReads(8);
    const result = clearStaleReadResults(items);
    expect(result.length).toBe(items.length);
    expect(result.map((i) => i.type)).toEqual(items.map((i) => i.type));
    expect(
      result
        .filter((i) => i.type === "function_call_result")
        .map((i) => (i as { callId?: string }).callId),
    ).toEqual(
      items
        .filter((i) => i.type === "function_call_result")
        .map((i) => (i as { callId?: string }).callId),
    );
  });

  it("is idempotent — re-running does not re-stub or change output", () => {
    const once = clearStaleReadResults(buildReads(9));
    const twice = clearStaleReadResults(once);
    expect(twice).toEqual(once);
  });

  it("ignores non-read tools (e.g. click) entirely", () => {
    const items: AgentInputItem[] = [];
    for (let i = 0; i < 10; i++) {
      items.push(...readPair(`k${i}`, "click", null, `clicked ${i}`));
    }
    expect(clearStaleReadResults(items)).toEqual(items);
  });

  it("falls back to a generic stub when the call has no URL (e.g. read_page)", () => {
    const items: AgentInputItem[] = [];
    for (let i = 0; i < 8; i++) {
      items.push(...readPair(`p${i}`, "read_page", null, `PAGE-${i}`));
    }
    const out = outputs(clearStaleReadResults(items));
    expect(out[0]).toContain("re-run read_page if you need this content again");
    expect(out[0]).not.toContain("http");
  });
});
