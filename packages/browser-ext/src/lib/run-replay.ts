import type { UIMessage } from "@aipexstudio/aipex-react/types";

export interface RunReplayIdentity {
  userMessageId: string | null;
  userText: string;
}

export interface RunReplaySeed {
  messages: UIMessage[];
  userText?: string;
  userMessageId?: string;
}

export function prepareRunReplay(
  storedMessages: readonly UIMessage[],
  run: RunReplayIdentity,
): RunReplaySeed {
  const currentUserIndex = run.userMessageId
    ? storedMessages.findIndex(
        (message) =>
          message.role === "user" && message.id === run.userMessageId,
      )
    : -1;

  if (currentUserIndex >= 0) {
    return {
      messages: storedMessages.slice(0, currentUserIndex + 1),
    };
  }

  return {
    messages: [...storedMessages],
    userText: run.userText,
    userMessageId: run.userMessageId ?? undefined,
  };
}
