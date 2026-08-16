import type { UIMessage } from "@eterna/react/types";
import { describe, expect, it } from "vitest";
import { prepareRunReplay } from "./run-replay";

function message(id: string, role: UIMessage["role"], text: string): UIMessage {
  return {
    id,
    role,
    parts: [{ type: "text", text }],
  };
}

describe("prepareRunReplay", () => {
  it("cuts only after the exact current user and keeps the previous assistant", () => {
    const stored = [
      message("prior_user", "user", "same prompt"),
      message("prior_assistant", "assistant", "prior answer"),
      message("current_user", "user", "same prompt"),
      message("current_partial", "assistant", "partial answer"),
    ];

    const replay = prepareRunReplay(stored, {
      userMessageId: "current_user",
      userText: "same prompt",
    });

    expect(replay.messages.map(({ id }) => id)).toEqual([
      "prior_user",
      "prior_assistant",
      "current_user",
    ]);
    expect(replay.userText).toBeUndefined();
  });

  it("keeps all stored history and injects the current user when its id is absent", () => {
    const stored = [
      message("prior_user", "user", "same prompt"),
      message("prior_assistant", "assistant", "prior answer"),
    ];

    const replay = prepareRunReplay(stored, {
      userMessageId: "current_user",
      userText: "same prompt",
    });

    expect(replay.messages).toEqual(stored);
    expect(replay.userText).toBe("same prompt");
    expect(replay.userMessageId).toBe("current_user");
  });
});
