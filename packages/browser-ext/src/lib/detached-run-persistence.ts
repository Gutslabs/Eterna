import { ChatAdapter } from "@aipexstudio/aipex-react/adapters/chat-adapter";
import type {
  ConversationData,
  UIMessage as StoredMessage,
} from "@aipexstudio/browser-runtime";
import type { RunSnapshot } from "./chat-port-protocol";
import { deserializeAgentEvent } from "./chat-port-protocol";
import { fromStorageFormat, toStorageFormat } from "./message-adapter";

interface ConversationPersistence {
  getConversation(conversationId: string): Promise<ConversationData | null>;
  updateConversation(
    conversationId: string,
    messages: StoredMessage[],
  ): Promise<void>;
}

export async function persistDetachedRun(
  run: RunSnapshot,
  storage: ConversationPersistence,
): Promise<void> {
  if (!run.conversationId || !run.completedDetached) {
    return;
  }

  const conversation = await storage.getConversation(run.conversationId);
  if (!conversation) {
    return;
  }

  const restored = fromStorageFormat(conversation.messages);
  const currentUserIndex = run.userMessageId
    ? restored.findIndex(
        (message) =>
          message.role === "user" && message.id === run.userMessageId,
      )
    : -1;
  const storedCurrentUser = currentUserIndex >= 0;
  const nextUserIndex = storedCurrentUser
    ? restored.findIndex(
        (message, index) => index > currentUserIndex && message.role === "user",
      )
    : -1;
  const preservedSuffix =
    nextUserIndex >= 0 ? restored.slice(nextUserIndex) : [];

  const adapter = new ChatAdapter();
  adapter.setMessages(
    storedCurrentUser ? restored.slice(0, currentUserIndex + 1) : restored,
  );
  if (!storedCurrentUser) {
    adapter.addUserMessage(
      run.userText,
      undefined,
      undefined,
      run.userMessageId ?? undefined,
    );
  }

  for (const event of run.events) {
    adapter.processEvent(deserializeAgentEvent(event));
  }
  if (run.interrupted && adapter.getStatus() !== "idle") {
    adapter.abortTurn();
    adapter.setStatus("idle");
  }

  await storage.updateConversation(
    run.conversationId,
    toStorageFormat([...adapter.getMessages(), ...preservedSuffix]),
  );
}

export function createSerializedDetachedRunPersistence(
  storage: ConversationPersistence,
): (run: RunSnapshot) => Promise<void> {
  const conversationTails = new Map<string, Promise<void>>();

  return (run: RunSnapshot): Promise<void> => {
    const conversationId = run.conversationId;
    if (!conversationId) {
      return persistDetachedRun(run, storage);
    }

    const priorTail =
      conversationTails.get(conversationId) ?? Promise.resolve();
    const operation = priorTail
      .catch(() => undefined)
      .then(() => persistDetachedRun(run, storage));
    const settledTail = operation.catch(() => undefined);
    conversationTails.set(conversationId, settledTail);
    void settledTail.then(() => {
      if (conversationTails.get(conversationId) === settledTail) {
        conversationTails.delete(conversationId);
      }
    });
    return operation;
  };
}
