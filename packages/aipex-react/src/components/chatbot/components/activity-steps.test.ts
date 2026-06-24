import { describe, expect, it } from "vitest";
import type { UIMessage, UIToolPart } from "../../../types";
import {
  buildTurnBlocks,
  formatActivityDuration,
  toolTargetText,
  totalToolDurationMs,
} from "./activity-steps";

function msg(id: string, parts: UIMessage["parts"]): UIMessage {
  return { id, role: "assistant", parts };
}

function text(value: string) {
  return { type: "text" as const, text: value };
}

function tool(
  name: string,
  state: UIToolPart["state"] = "completed",
  extra: Partial<UIToolPart> = {},
): UIToolPart {
  return {
    type: "tool",
    toolName: name,
    toolCallId: `call-${name}`,
    input: {},
    state,
    ...extra,
  };
}

describe("buildTurnBlocks", () => {
  it("renders a plain text reply as a single bubble", () => {
    const blocks = buildTurnBlocks([msg("m1", [text("Merhaba!")])]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "message" });
  });

  it("keeps a streamed bubble in place when tools follow it", () => {
    // The vanishing-message bug: text classified as the answer must NOT be
    // reclassified into the rail once a tool part lands after it.
    const before = buildTurnBlocks([msg("m1", [text("Bakıyorum")])]);
    expect(before.map((b) => b.type)).toEqual(["message"]);

    const after = buildTurnBlocks([
      msg("m1", [text("Bakıyorum"), tool("read_page", "executing")]),
    ]);
    expect(after.map((b) => b.type)).toEqual(["message", "activity"]);
    expect(after[0]).toMatchObject({ key: "m1-0" });
  });

  it("orders bubbles and rails positionally across messages", () => {
    const blocks = buildTurnBlocks([
      msg("m1", [text("Önce bakacağım"), tool("read_page")]),
      msg("m2", [tool("search")]),
      msg("m3", [text("Sonuç: hazır")]),
    ]);

    expect(blocks.map((b) => b.type)).toEqual([
      "message",
      "activity",
      "message",
    ]);
    const rail = blocks[1];
    expect(rail?.type === "activity" && rail.steps.map((s) => s.kind)).toEqual([
      "tool",
      "tool",
    ]);
  });

  it("merges consecutive tool runs across message boundaries into one rail", () => {
    const blocks = buildTurnBlocks([
      msg("m1", [tool("read_page")]),
      msg("m2", [tool("search"), tool("click")]),
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type === "activity" && blocks[0].steps.length).toBe(3);
  });

  it("includes reasoning parts as rail thought steps", () => {
    const blocks = buildTurnBlocks([
      msg("m1", [
        { type: "reasoning", text: "model düşünüyor" },
        tool("search"),
        text("Bitti"),
      ]),
    ]);

    expect(blocks.map((b) => b.type)).toEqual(["activity", "message"]);
    const rail = blocks[0];
    expect(rail?.type === "activity" && rail.steps.map((s) => s.kind)).toEqual([
      "thought",
      "tool",
    ]);
  });

  it("ignores empty text and whitespace-only reasoning", () => {
    const blocks = buildTurnBlocks([
      msg("m1", [{ type: "reasoning", text: "   " }, text(""), tool("click")]),
    ]);

    expect(blocks.map((b) => b.type)).toEqual(["activity"]);
    expect(
      blocks[0]?.type === "activity" && blocks[0].steps.map((s) => s.kind),
    ).toEqual(["tool"]);
  });

  it("keeps source-url parts with their bubble", () => {
    const blocks = buildTurnBlocks([
      msg("m1", [
        text("Kaynaklı cevap"),
        { type: "source-url", url: "https://example.com" },
      ]),
    ]);

    const bubble = blocks[0];
    expect(
      bubble?.type === "message" && bubble.message.parts.map((p) => p.type),
    ).toEqual(["text", "source-url"]);
  });
});

describe("toolTargetText", () => {
  it("prefers urls and compacts them", () => {
    expect(
      toolTargetText({ url: "https://www.youtube.com/watch", tabId: 3 }),
    ).toBe("youtube.com/watch");
  });

  it("falls back through known keys then any string", () => {
    expect(toolTargetText({ query: "eterna model" })).toBe("eterna model");
    expect(toolTargetText({ somethingElse: "değer" })).toBe("değer");
  });

  it("truncates long values and handles non-objects", () => {
    const long = "x".repeat(100);
    expect(toolTargetText({ text: long })?.length).toBe(44);
    expect(toolTargetText(null)).toBeNull();
    expect(toolTargetText({ count: 4 })).toBeNull();
  });
});

describe("durations", () => {
  it("sums only recorded tool durations", () => {
    const blocks = buildTurnBlocks([
      msg("m1", [
        tool("a", "completed", { duration: 400 }),
        tool("b", "completed", { duration: 1200 }),
        tool("c", "executing"),
      ]),
    ]);
    const steps = blocks[0]?.type === "activity" ? blocks[0].steps : [];

    expect(totalToolDurationMs(steps)).toBe(1600);
  });

  it("formats durations for the rail", () => {
    expect(formatActivityDuration(0)).toBe("");
    expect(formatActivityDuration(2840)).toBe("2.8s");
    expect(formatActivityDuration(12400)).toBe("12s");
    expect(formatActivityDuration(83000)).toBe("1m 23s");
  });

  it("never prints 60s at minute boundaries", () => {
    expect(formatActivityDuration(59700)).toBe("1m 0s");
    expect(formatActivityDuration(119700)).toBe("2m 0s");
  });
});
