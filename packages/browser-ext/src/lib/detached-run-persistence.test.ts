import type {
  ConversationData,
  UIMessage as StoredMessage,
} from "@eterna/browser-runtime";
import { describe, expect, it, vi } from "vitest";
import type { RunSnapshot } from "./chat-port-protocol";
import {
  createSerializedDetachedRunPersistence,
  persistDetachedRun,
} from "./detached-run-persistence";

const metrics = {
  tokensUsed: 0,
  promptTokens: 0,
  completionTokens: 0,
  itemCount: 0,
  maxTurns: 10,
  duration: 0,
  startTime: 0,
};

function conversation(messages: StoredMessage[]): ConversationData {
  return {
    id: "conv_1",
    title: "question",
    messages,
    createdAt: 1,
    updatedAt: 1,
  };
}

function run(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    runId: "run_1",
    userText: "question",
    userMessageId: "user_1",
    conversationId: "conv_1",
    sessionId: "session_1",
    done: true,
    interrupted: false,
    completedDetached: true,
    error: null,
    events: [],
    truncated: false,
    ...overrides,
  };
}

function storageWith(value: ConversationData | null) {
  return {
    getConversation: vi.fn(async (_conversationId: string) => value),
    updateConversation: vi.fn(
      async (_conversationId: string, _messages: StoredMessage[]) => undefined,
    ),
  };
}

const userMessage: StoredMessage = {
  id: "user_1",
  role: "user",
  parts: [{ type: "text", text: "question" }],
  timestamp: 1,
};

describe("persistDetachedRun", () => {
  it("replaces the stored partial assistant tail with the completed replay", async () => {
    const storage = storageWith(
      conversation([
        userMessage,
        {
          id: "assistant_partial",
          role: "assistant",
          parts: [{ type: "text", text: "partial" }],
          timestamp: 2,
        },
      ]),
    );

    await persistDetachedRun(
      run({
        events: [
          { type: "content_delta", delta: "complete answer" },
          {
            type: "execution_complete",
            finalOutput: "complete answer",
            metrics,
          },
        ],
      }),
      storage,
    );

    expect(storage.updateConversation).toHaveBeenCalledTimes(1);
    const persisted = storage.updateConversation.mock.calls[0]?.[1] ?? [];
    expect(persisted).toHaveLength(2);
    expect(persisted[1]).toMatchObject({
      role: "assistant",
      parts: [{ type: "text", text: "complete answer" }],
    });
    expect(JSON.stringify(persisted)).not.toContain("partial");
  });

  it("persists an interrupted run's latest buffered text", async () => {
    const storage = storageWith(conversation([userMessage]));

    await persistDetachedRun(
      run({
        interrupted: true,
        events: [{ type: "content_delta", delta: "latest partial answer" }],
      }),
      storage,
    );

    const persisted = storage.updateConversation.mock.calls[0]?.[1] ?? [];
    expect(persisted[1]).toMatchObject({
      role: "assistant",
      parts: [{ type: "text", text: "latest partial answer" }],
    });
  });

  it("keeps the prior assistant turn when the current user was not persisted", async () => {
    const storage = storageWith(
      conversation([
        {
          id: "prior_user",
          role: "user",
          parts: [{ type: "text", text: "question" }],
        },
        {
          id: "prior_assistant",
          role: "assistant",
          parts: [{ type: "text", text: "prior answer" }],
        },
      ]),
    );

    await persistDetachedRun(
      run({
        events: [{ type: "content_delta", delta: "current answer" }],
      }),
      storage,
    );

    const persisted = storage.updateConversation.mock.calls[0]?.[1] ?? [];
    expect(JSON.stringify(persisted)).toContain("prior answer");
    expect(JSON.stringify(persisted)).toContain("question");
    expect(JSON.stringify(persisted)).toContain("current answer");
    expect(persisted.filter((message) => message.id === "user_1")).toHaveLength(
      1,
    );
  });

  it("replaces only the exact older turn and preserves later same-prompt turns", async () => {
    const storage = storageWith(
      conversation([
        {
          id: "older_user",
          role: "user",
          parts: [{ type: "text", text: "question" }],
        },
        {
          id: "older_partial",
          role: "assistant",
          parts: [{ type: "text", text: "older partial" }],
        },
        {
          id: "newer_user",
          role: "user",
          parts: [{ type: "text", text: "question" }],
        },
        {
          id: "newer_assistant",
          role: "assistant",
          parts: [{ type: "text", text: "newer final" }],
        },
      ]),
    );

    await persistDetachedRun(
      run({
        runId: "older_run",
        userMessageId: "older_user",
        events: [{ type: "content_delta", delta: "older final" }],
      }),
      storage,
    );

    const persisted = storage.updateConversation.mock.calls[0]?.[1] ?? [];
    expect(persisted).toHaveLength(4);
    expect(persisted[0]?.id).toBe("older_user");
    expect(persisted[1]).toMatchObject({
      role: "assistant",
      parts: [{ type: "text", text: "older final" }],
    });
    expect(persisted[2]?.id).toBe("newer_user");
    expect(persisted[3]).toMatchObject({
      id: "newer_assistant",
      parts: [{ type: "text", text: "newer final" }],
    });
    expect(JSON.stringify(persisted)).not.toContain("older partial");
  });

  it("serializes writes per conversation and continues after a failed write", async () => {
    const storage = storageWith(conversation([userMessage]));
    let rejectFirstWrite!: (reason?: unknown) => void;
    const firstWrite = new Promise<undefined>((_resolve, reject) => {
      rejectFirstWrite = reject;
    });
    storage.updateConversation
      .mockImplementationOnce(() => firstWrite)
      .mockResolvedValueOnce(undefined);
    const persist = createSerializedDetachedRunPersistence(storage);

    const firstResult = persist(run({ runId: "run_1" })).then(
      () => null,
      (error: unknown) => error,
    );
    await vi.waitFor(() => {
      expect(storage.updateConversation).toHaveBeenCalledTimes(1);
    });

    const secondResult = persist(run({ runId: "run_2" }));
    await Promise.resolve();
    expect(storage.getConversation).toHaveBeenCalledTimes(1);

    rejectFirstWrite(new Error("first write failed"));
    await expect(firstResult).resolves.toBeInstanceOf(Error);
    await expect(secondResult).resolves.toBeUndefined();
    expect(storage.getConversation).toHaveBeenCalledTimes(2);
    expect(storage.updateConversation).toHaveBeenCalledTimes(2);
  });

  it("does nothing without a bound or existing conversation", async () => {
    const noIdStorage = storageWith(conversation([userMessage]));
    await persistDetachedRun(run({ conversationId: null }), noIdStorage);
    expect(noIdStorage.getConversation).not.toHaveBeenCalled();
    expect(noIdStorage.updateConversation).not.toHaveBeenCalled();

    const missingStorage = storageWith(null);
    await persistDetachedRun(run(), missingStorage);
    expect(missingStorage.getConversation).toHaveBeenCalledWith("conv_1");
    expect(missingStorage.updateConversation).not.toHaveBeenCalled();
  });
});
