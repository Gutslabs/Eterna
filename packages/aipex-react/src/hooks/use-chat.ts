import type {
  AgentEvent,
  AgentMetrics,
  AIPex,
  Context,
  ImageInput,
} from "@aipexstudio/aipex-core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatAdapter } from "../adapters/chat-adapter";
import type {
  ChatbotEventHandlers,
  ChatConfig,
  ChatStatus,
  ContextItem,
  MessageAttachment,
  UIMessage,
} from "../types";

// Max rate at which streaming message updates are committed to React state.
// ~20 commits/sec matches the typewriter reveal cadence in StreamingResponse;
// anything faster burns main-thread time without visible benefit.
const MESSAGE_PUBLISH_THROTTLE_MS = 50;

function isAdapterBusy(adapter: ChatAdapter): boolean {
  const status = adapter.getStatus();
  return (
    status === "submitted" ||
    status === "streaming" ||
    status === "executing_tools"
  );
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => resolve("");
    reader.readAsDataURL(blob);
  });
}

/**
 * Convert image attachments into the vision inputs the agent forwards to the
 * model. Non-image files are skipped (the model can't read them). Already-
 * processed parts carry a self-contained (data:) URL; raw File/Blob objects are
 * read into one.
 */
async function attachmentsToImageInputs(
  files: MessageAttachment[],
): Promise<ImageInput[]> {
  const images: ImageInput[] = [];
  for (const file of files) {
    if (file instanceof Blob) {
      if (file.type.startsWith("image/")) {
        const dataUrl = await blobToDataUrl(file);
        if (dataUrl) images.push({ image: dataUrl });
      }
    } else if (file?.mediaType?.startsWith("image/") && file.url) {
      images.push({ image: file.url });
    }
  }
  return images;
}

export interface UseChatOptions {
  /** Chat configuration */
  config?: ChatConfig;
  /** Event handlers */
  handlers?: ChatbotEventHandlers;
}

export interface UseChatReturn {
  /** Current messages */
  messages: UIMessage[];
  /** Current chat status */
  status: ChatStatus;
  /** Current session ID */
  sessionId: string | null;
  /** Latest token metrics from the most recent execution */
  metrics: AgentMetrics | null;
  /** Send a new message */
  sendMessage: (
    text: string,
    files?: MessageAttachment[],
    contexts?: ContextItem[],
  ) => Promise<void>;
  /** Continue the conversation */
  continueConversation: (text: string) => Promise<void>;
  /** Interrupt current operation */
  interrupt: () => Promise<void>;
  /** Reset the chat */
  reset: () => void;
  /** Regenerate last response */
  regenerate: () => Promise<void>;
  /** Set messages directly */
  setMessages: (messages: UIMessage[]) => void;
  /**
   * Attach an externally produced AgentEvent stream as the current turn —
   * used to re-join a run that kept executing elsewhere (e.g. a background
   * service worker) after this UI was torn down and recreated.
   */
  attachExternalTurn: (
    events: AsyncGenerator<AgentEvent>,
    options?: { userText?: string },
  ) => Promise<void>;
}

/**
 * useChat - A headless hook for managing chat state with an AIPex agent
 *
 * This hook provides all the state and actions needed to build a chat UI,
 * without any rendering logic. It uses the ChatAdapter to convert
 * AgentEvents into UIMessages.
 *
 * @example
 * ```tsx
 * const agent = AIPex.create({ model, tools });
 *
 * function MyChatUI() {
 *   const {
 *     messages,
 *     status,
 *     sendMessage,
 *     interrupt,
 *     reset
 *   } = useChat(agent);
 *
 *   return (
 *     <div>
 *       {messages.map(m => <Message key={m.id} message={m} />)}
 *       <Input onSubmit={sendMessage} />
 *     </div>
 *   );
 * }
 * ```
 */
export function useChat(
  agent: AIPex | undefined,
  options: UseChatOptions = {},
): UseChatReturn {
  const { config, handlers } = options;

  // State
  const [messages, setMessages] = useState<UIMessage[]>(
    config?.initialMessages ?? [],
  );
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<AgentMetrics | null>(null);

  // Refs for stable callbacks
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const configRef = useRef(config);
  configRef.current = config;

  const activeGeneratorRef = useRef<AsyncGenerator<AgentEvent> | null>(null);
  // Bumped by interrupt/reset; runs captured before an await compare against
  // it afterwards so a stopped run can't start its generator anyway.
  const runEpochRef = useRef(0);
  const prevAgentRef = useRef<AIPex | undefined>(agent);

  // When the agent instance changes (e.g. model switch), reset the sessionId
  // so subsequent messages create a fresh session on the new agent, but
  // preserve existing UI messages so the conversation history stays visible.
  useEffect(() => {
    if (agent && prevAgentRef.current && agent !== prevAgentRef.current) {
      setSessionId(null);
      setMetrics(null);
    }
    prevAgentRef.current = agent;
  }, [agent]);

  // Streaming can emit many message updates per second (one per agent event).
  // Re-rendering the chat for every token wastes main-thread time, so updates
  // are throttled: the first lands immediately, bursts coalesce to the latest
  // snapshot, and a status change flushes so completion is never delayed.
  const publishStateRef = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    pending: UIMessage[] | null;
    lastPublishAt: number;
  }>({ timer: null, pending: null, lastPublishAt: 0 });

  // Create adapter with callbacks
  const adapter = useMemo(() => {
    const publish = (newMessages: UIMessage[]) => {
      const state = publishStateRef.current;
      state.pending = null;
      state.lastPublishAt = Date.now();
      setMessages(newMessages);
      // Find the last assistant message for the callback
      const lastAssistant = newMessages
        .filter((m) => m.role === "assistant")
        .pop();
      if (lastAssistant) {
        handlersRef.current?.onResponseReceived?.(lastAssistant);
      }
    };

    const flushPending = () => {
      const state = publishStateRef.current;
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
      if (state.pending) {
        publish(state.pending);
      }
    };

    return new ChatAdapter({
      onMessagesUpdate: (newMessages) => {
        const state = publishStateRef.current;
        const elapsed = Date.now() - state.lastPublishAt;
        if (elapsed >= MESSAGE_PUBLISH_THROTTLE_MS) {
          if (state.timer) {
            clearTimeout(state.timer);
            state.timer = null;
          }
          publish(newMessages);
          return;
        }
        state.pending = newMessages;
        if (!state.timer) {
          state.timer = setTimeout(() => {
            state.timer = null;
            if (state.pending) {
              publish(state.pending);
            }
          }, MESSAGE_PUBLISH_THROTTLE_MS - elapsed);
        }
      },
      onStatusChange: (newStatus) => {
        flushPending();
        setStatus(newStatus);
        handlersRef.current?.onStatusChange?.(newStatus);
      },
    });
  }, []);

  // Drop any pending publish timer on unmount.
  useEffect(() => {
    return () => {
      const state = publishStateRef.current;
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
    };
  }, []);

  // Initialize adapter with initial messages
  useEffect(() => {
    if (config?.initialMessages) {
      adapter.setMessages(config.initialMessages);
    }
  }, [adapter, config?.initialMessages]);

  // Process agent events
  const processAgentEvents = useCallback(
    async (eventGenerator: AsyncGenerator<AgentEvent>) => {
      activeGeneratorRef.current = eventGenerator;
      try {
        for await (const event of eventGenerator) {
          // Handle session creation
          if (
            event.type === "session_created" ||
            event.type === "session_resumed"
          ) {
            setSessionId(event.sessionId);
          }

          if (event.type === "tool_call_start") {
            handlersRef.current?.onToolExecute?.(event.toolName, event.params);
          }

          if (event.type === "tool_call_complete") {
            handlersRef.current?.onToolComplete?.(event.toolName, event.result);
          }

          if (event.type === "tool_call_error" || event.type === "error") {
            handlersRef.current?.onError?.(event.error);
          }

          // Handle metrics update – show latest completion metrics (not cumulative)
          if (event.type === "metrics_update") {
            setMetrics(event.metrics);
            handlersRef.current?.onMetricsUpdate?.(
              event.metrics,
              event.sessionId,
            );
          }

          // Process the event through adapter
          adapter.processEvent(event);
        }
      } catch (error) {
        handlersRef.current?.onError?.(error as Error);
        adapter.appendErrorNotice(error);
        adapter.setStatus("error");
      } finally {
        if (activeGeneratorRef.current === eventGenerator) {
          activeGeneratorRef.current = null;
        }
      }
    },
    [adapter],
  );

  // Send a new message
  const sendMessage = useCallback(
    async (
      text: string,
      files?: MessageAttachment[],
      contexts?: ContextItem[],
    ): Promise<void> => {
      if (!agent) {
        console.warn("useChat: agent is not initialized");
        return;
      }

      // One in-flight response at a time: concurrent sends would stream two
      // generators into the same adapter and interleave/corrupt messages.
      if (isAdapterBusy(adapter)) {
        return;
      }

      if (!text.trim() && !files?.length && !contexts?.length) {
        return;
      }

      // Add user message to adapter
      const userMessage = adapter.addUserMessage(text, files, contexts);
      handlersRef.current?.onMessageSent?.(userMessage);
      adapter.setStatus("submitted");
      const epoch = runEpochRef.current;

      // Convert ContextItem to core Context type
      const coreContexts: Context[] | undefined = contexts?.map((ctx) => ({
        id: ctx.id,
        type: ctx.type as Context["type"],
        providerId: "ui-selected",
        label: ctx.label,
        value: ctx.value,
        metadata: ctx.metadata,
        timestamp: Date.now(),
      }));

      const images =
        files && files.length > 0
          ? await attachmentsToImageInputs(files)
          : undefined;

      // Stop pressed during the attachment conversion above — don't start
      // the generator the user already cancelled.
      if (epoch !== runEpochRef.current) {
        return;
      }

      const events = agent.chat(text, {
        sessionId: sessionId ?? undefined,
        contexts: coreContexts,
        images: images && images.length > 0 ? images : undefined,
      });
      await processAgentEvents(events);
    },
    [adapter, agent, sessionId, processAgentEvents],
  );

  // Continue conversation (for multi-turn without creating new user message)
  const continueConversation = useCallback(
    async (text: string): Promise<void> => {
      if (!agent) {
        console.warn("useChat: agent is not initialized");
        return;
      }

      if (isAdapterBusy(adapter)) {
        return;
      }

      if (!sessionId) {
        // No session, start new
        await sendMessage(text);
        return;
      }

      // Add user message
      const userMessage = adapter.addUserMessage(text);
      handlersRef.current?.onMessageSent?.(userMessage);

      adapter.setStatus("submitted");

      // Continue conversation
      const events = agent.chat(text, { sessionId });
      await processAgentEvents(events);
    },
    [adapter, agent, sessionId, processAgentEvents, sendMessage],
  );

  // Interrupt current operation
  const interrupt = useCallback(async (): Promise<void> => {
    // Invalidate runs that are still in a pre-generator await (attachment
    // conversion, session rollback) — they check the epoch before starting.
    runEpochRef.current += 1;
    const generator = activeGeneratorRef.current;
    if (generator && typeof generator.return === "function") {
      await generator.return(undefined);
    }
    activeGeneratorRef.current = null;
    // The aborted run never emits execution_complete — drop its turn tracking
    // so the next response can't stream into the interrupted bubble.
    adapter.abortTurn();
    adapter.setStatus("idle");
  }, [adapter]);

  // Reset chat
  const reset = useCallback((): void => {
    // Stop any in-flight run first — otherwise its generator keeps streaming
    // into the freshly cleared adapter and the old response "resurrects" as
    // an orphan bubble in the new chat.
    runEpochRef.current += 1;
    const generator = activeGeneratorRef.current;
    if (generator && typeof generator.return === "function") {
      void generator.return(undefined);
    }
    activeGeneratorRef.current = null;
    if (sessionId && agent) {
      void agent.getConversationManager()?.deleteSession(sessionId);
    }
    setSessionId(null);
    setMetrics(null);
    adapter.reset(configRef.current?.initialMessages ?? []);
  }, [adapter, agent, sessionId]);

  // Regenerate last response
  const regenerate = useCallback(async (): Promise<void> => {
    if (!agent) {
      console.warn("useChat: agent is not initialized");
      return;
    }

    if (isAdapterBusy(adapter)) {
      return;
    }

    // Validate everything BEFORE any destructive step: a missing session
    // (model switch, failed first send) or a text-less user message used to
    // delete the answer and then silently do nothing.
    const lastUserMessage = adapter
      .getMessages()
      .filter((m) => m.role === "user")
      .pop();
    const textPart = lastUserMessage?.parts.find((p) => p.type === "text");
    const text = textPart?.type === "text" ? textPart.text : "";
    if (!sessionId || !text) {
      return;
    }

    // Close the gate synchronously so a double-click can't pass it twice
    // during the rollback await below.
    adapter.setStatus("submitted");
    const epoch = runEpochRef.current;

    // Remove the WHOLE trailing assistant turn — the agent-side rollback pops
    // everything after the last user item, and leaving the turn's earlier
    // tool messages in the UI duplicated their steps on the activity rail.
    if (!adapter.removeLastAssistantTurn()) {
      adapter.setStatus("idle");
      return;
    }

    try {
      // Roll back the session so the agent doesn't see the old assistant turn
      await agent.rollbackLastAssistantTurn(sessionId);
    } catch (error) {
      adapter.appendErrorNotice(error);
      adapter.setStatus("error");
      return;
    }
    if (epoch !== runEpochRef.current) {
      return;
    }

    const events = agent.chat(text, { sessionId });
    await processAgentEvents(events);
  }, [adapter, agent, sessionId, processAgentEvents]);

  // Set messages directly
  const setMessagesDirectly = useCallback(
    (newMessages: UIMessage[]): void => {
      adapter.setMessages(newMessages);
    },
    [adapter],
  );

  // Attach an external event stream (e.g. a background run that survived a
  // page reload) as the current turn.
  const attachExternalTurn = useCallback(
    async (
      events: AsyncGenerator<AgentEvent>,
      options?: { userText?: string },
    ): Promise<void> => {
      if (isAdapterBusy(adapter)) {
        await events.return?.(undefined);
        return;
      }
      if (options?.userText) {
        adapter.addUserMessage(options.userText);
      }
      adapter.setStatus("submitted");
      await processAgentEvents(events);
      // Replayed streams of an already-finished run end without an
      // execution_complete-driven status change — settle back to idle.
      if (isAdapterBusy(adapter)) {
        adapter.abortTurn();
        adapter.setStatus("idle");
      }
    },
    [adapter, processAgentEvents],
  );

  return {
    messages,
    status,
    sessionId,
    metrics,
    sendMessage,
    continueConversation,
    interrupt,
    reset,
    regenerate,
    setMessages: setMessagesDirectly,
    attachExternalTurn,
  };
}
