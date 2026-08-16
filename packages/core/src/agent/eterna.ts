import {
  type AgentInputItem,
  Agent as OpenAIAgent,
  type RunItemStreamEvent,
  run,
} from "@openai/agents";
import type { ContextManager } from "../context/manager.js";
import type { Context } from "../context/types.js";
import {
  dropUnchangedContexts,
  formatContextsForPrompt,
  resolveContexts,
} from "../context/utils.js";
import { ConversationCompressor } from "../conversation/compressor.js";
import { EphemeralSession } from "../conversation/ephemeral-session.js";
import { ConversationManager } from "../conversation/manager.js";
import type { Session } from "../conversation/session.js";
import { SessionStorage } from "../conversation/storage.js";
import { InMemoryStorage } from "../storage/memory.js";
import type {
  AfterResponsePayload,
  AgentEvent,
  AgentMetrics,
  AgentPlugin,
  AgentPluginContext,
  BeforeChatPayload,
  ChatOptions,
  EternaOptions,
  MetricsPayload,
  SessionStorageAdapter,
  ToolEventPayload,
} from "../types.js";
import {
  appendAmbientScreenshot,
  shapeScreenshotItems,
  stripImageInputs,
} from "../utils/screenshot-shaping.js";
import { clearStaleReadResults } from "../utils/tool-result-clearing.js";
import {
  applyUsageMetrics,
  extractToolArguments,
  extractToolFailureMessage,
  extractToolName,
  extractToolOutput,
  FAILURE_GUARD_ITEM,
  FAILURE_NUDGE_THRESHOLD,
  getToolStatus,
  LEAKED_THOUGHT_DECIDE_AT,
  LEAKED_THOUGHT_MARKER,
  normalizeError,
} from "./eterna-internals.js";

/** Stands in for the prompt when a turn carries only attachments. */
const ATTACHMENT_ONLY_PROMPT = "Take a look at the attached file.";

/** Bucket for the opening turn, before a session id exists. */
const NEW_CONVERSATION_KEY = "__new__";

export class Eterna {
  private agent: OpenAIAgent;
  private conversationManager?: ConversationManager;
  private contextManager?: ContextManager;
  private maxTurns: number;
  private plugins: AgentPlugin[];
  private pluginContext: AgentPluginContext;
  private supportsVision: boolean;
  /**
   * Context bodies already delivered, per conversation. A pinned context (the
   * current page) is re-attached every turn; this is what stops its full text
   * from being prepended to — and paid for in — every single message.
   */
  private sentContextFingerprints = new Map<string, Set<string>>();

  private constructor(
    agent: OpenAIAgent,
    conversationManager?: ConversationManager,
    contextManager?: ContextManager,
    maxTurns?: number,
    plugins: AgentPlugin[] = [],
    supportsVision = true,
  ) {
    this.agent = agent;
    this.conversationManager = conversationManager;
    this.contextManager = contextManager;
    this.maxTurns = maxTurns ?? 2000;
    this.plugins = plugins;
    this.supportsVision = supportsVision;
    this.pluginContext = { agent: this };
    this.initializePlugins();
  }

  static create(options: EternaOptions): Eterna {
    const agent = new OpenAIAgent({
      name: options.name ?? "Assistant",
      instructions: options.instructions,
      model: options.model,
      tools: options.tools ?? [],
    });

    const conversationManager = Eterna.buildConversationManager(options);
    return new Eterna(
      agent,
      conversationManager,
      options.contextManager,
      options.maxTurns,
      options.plugins ?? [],
      options.supportsVision ?? true,
    );
  }

  private static buildConversationManager(
    options: EternaOptions,
  ): ConversationManager | undefined {
    // If conversationManager is provided, use it directly
    if (options.conversationManager) {
      return options.conversationManager;
    }

    // If conversation is explicitly disabled
    if (options.conversation === false) {
      return undefined;
    }

    // Build storage (default to in-memory storage)
    const storage: SessionStorageAdapter =
      options.storage ?? new SessionStorage(new InMemoryStorage());

    // Build compressor if compression config is provided
    const compressor = options.compression
      ? new ConversationCompressor(options.compression.model, {
          summarizeAfterItems: options.compression.summarizeAfterItems,
          keepRecentItems: options.compression.keepRecentItems,
          maxSummaryLength: options.compression.maxSummaryLength,
          tokenWatermark: options.compression.tokenWatermark,
          protectRecentMessages: options.compression.protectRecentMessages,
        })
      : undefined;

    return new ConversationManager(storage, { compressor });
  }

  private initMetrics(
    startTime: number,
    session: Session | null,
  ): AgentMetrics {
    return {
      tokensUsed: 0,
      promptTokens: 0,
      completionTokens: 0,
      itemCount: session?.getItemCount() ?? 0,
      maxTurns: this.maxTurns,
      duration: 0,
      startTime,
    };
  }

  private async *runExecution(
    input: string | AgentInputItem[],
    session: Session | null,
    ambientImage?: string,
  ): AsyncGenerator<AgentEvent> {
    const startTime = Date.now();
    const metrics = this.initMetrics(startTime, session);

    // Always provide a session to the runner so that screenshot shaping
    // (strip base64 imageData, inject transient user image message) runs
    // even in stateless mode.  The EphemeralSession is in-memory only and
    // never persisted.
    const runSession: Session | EphemeralSession =
      session ?? new EphemeralSession();

    // Track tool-call argument streaming during a single model response.
    // This is best-effort and provider-dependent (e.g. OpenAI ChatCompletions tool_calls deltas).
    const toolArgsStreamByIndex = new Map<
      number,
      { toolName: string; startEmitted: boolean }
    >();

    // Persist the session exactly once, whatever ends the run. The success and
    // error paths call this at their normal point; the finally below covers the
    // interrupt path (useChat.interrupt -> generator.return() exits at a yield
    // without entering success or catch), which previously dropped every
    // completed turn from storage. Guarded so a persistence failure can't mask
    // the run's real outcome.
    let persisted = false;
    const persistSession = async (): Promise<void> => {
      if (persisted || !session || !this.conversationManager) return;
      persisted = true;
      try {
        if (metrics.duration === 0) {
          metrics.duration = Date.now() - startTime;
        }
        session.addMetrics(metrics);
        session.setMetadata("lastPromptTokens", metrics.promptTokens);
        await this.conversationManager.saveSession(session);
      } catch (error) {
        console.warn("[Eterna] Failed to persist session:", error);
      }
    };

    // Circuit breaker: count tool failures with no success in between. Once it
    // crosses the threshold, callModelInputFilter injects FAILURE_GUARD_ITEM so
    // the model stops retrying a stuck action and explains the blocker instead.
    // A later success resets it; maxTurns stays as the hard backstop.
    let consecutiveToolFailures = 0;

    try {
      const result = await run(this.agent, input, {
        maxTurns: this.maxTurns,
        session: runSession,
        stream: true,
        // Before every model call: (1) shape screenshot tool results — strip
        // base64 imageData and inject it as a transient user image message;
        // (2) stub out old re-fetchable read bodies to cap context growth;
        // (3) append the user's current viewport screenshot (if auto-attach is
        // on) so the model always sees what's on screen; and (4) inject the
        // failure-guard nudge after repeated tool failures. All transient —
        // they affect only the model input, never the persisted session.
        callModelInputFilter: async ({ modelData }) => {
          const visualInput = appendAmbientScreenshot(
            clearStaleReadResults(shapeScreenshotItems(modelData.input)),
            ambientImage,
          );
          const shaped = this.supportsVision
            ? visualInput
            : stripImageInputs(visualInput);
          return {
            input:
              consecutiveToolFailures >= FAILURE_NUDGE_THRESHOLD
                ? [...shaped, FAILURE_GUARD_ITEM]
                : shaped,
            instructions: modelData.instructions,
          };
        },
      });

      let streamedOutput = "";
      let toolCallsDetectedInRaw = 0;
      let toolCallsEmittedByRunner = 0;

      // Leaked-thought guard, per model response: hold the first few text
      // deltas until LEAKED_THOUGHT_MARKER is decidable. A marker-opened
      // response is rerouted to reasoning_delta (rail) instead of
      // content_delta (chat bubble), and excluded from streamedOutput.
      let leakGuardTripped = false;
      let turnBuffer = "";
      let turnDecided = false;
      let turnIsLeakedThought = false;

      // Returns text that was still buffered when the response ended before
      // the marker check became decidable (short answers like "Done.").
      const flushUndecidedText = (): string | null => {
        if (turnDecided || turnBuffer.length === 0) {
          return null;
        }
        turnDecided = true;
        const pending = turnBuffer;
        turnBuffer = "";
        streamedOutput += pending;
        return pending;
      };

      for await (const streamEvent of result) {
        if (streamEvent.type === "raw_model_stream_event") {
          // New response boundary: reset per-response tool args tracking
          // and the leaked-thought guard.
          if (
            (streamEvent.data as unknown as { type?: string })?.type ===
            "response_started"
          ) {
            const pendingText = flushUndecidedText();
            if (pendingText !== null) {
              yield { type: "content_delta", delta: pendingText };
            }
            turnBuffer = "";
            turnDecided = false;
            turnIsLeakedThought = false;
            toolArgsStreamByIndex.clear();
            continue;
          }

          // Log response_done events for debugging tool call assembly
          if (
            (streamEvent.data as unknown as { type?: string })?.type ===
            "response_done"
          ) {
            const pendingText = flushUndecidedText();
            if (pendingText !== null) {
              yield { type: "content_delta", delta: pendingText };
            }
            const response = (
              streamEvent.data as unknown as {
                response?: { output?: unknown[] };
              }
            )?.response;
            const outputItems = response?.output;
            if (Array.isArray(outputItems)) {
              const functionCalls = outputItems.filter(
                (item: any) => item?.type === "function_call",
              );
              if (functionCalls.length > 0) {
                console.log(
                  `[Eterna] response_done contains ${functionCalls.length} function_call(s):`,
                  functionCalls.map((fc: any) => fc.name),
                );
              }
            }
          }

          // Best-effort: detect tool call argument streaming from raw provider events.
          // For OpenAI ChatCompletions streaming, the raw chunk is available under
          // streamEvent.data.type === "model" with a shape like:
          //   event.choices[0].delta.tool_calls[].function.{name,arguments}
          if (
            (streamEvent.data as unknown as { type?: string })?.type === "model"
          ) {
            const raw = (streamEvent.data as unknown as { event?: unknown })
              ?.event as unknown;

            // AI SDK models (via the aisdk wrapper) pass every stream part
            // through as a "model" event. reasoning-delta carries the model's
            // thinking (reasoning_content on OpenAI-compatible gateways,
            // extended thinking on Anthropic) — surface it for the rail.
            if ((raw as { type?: string })?.type === "reasoning-delta") {
              const reasoningDelta = (raw as { delta?: unknown }).delta;
              if (
                typeof reasoningDelta === "string" &&
                reasoningDelta.length > 0
              ) {
                yield { type: "reasoning_delta", delta: reasoningDelta };
              }
            }

            const choices = (raw as any)?.choices;
            const delta = Array.isArray(choices) ? choices?.[0]?.delta : null;
            const toolCalls = delta?.tool_calls;
            if (Array.isArray(toolCalls)) {
              toolCallsDetectedInRaw++;
              for (const tcDelta of toolCalls) {
                const index = tcDelta?.index;
                if (typeof index !== "number") continue;

                const state = toolArgsStreamByIndex.get(index) ?? {
                  toolName: "",
                  startEmitted: false,
                };

                const nameDelta = tcDelta?.function?.name;
                if (typeof nameDelta === "string" && nameDelta.length > 0) {
                  state.toolName += nameDelta;
                }

                // If we can identify the tool name, emit args streaming start once.
                if (!state.startEmitted && state.toolName.length > 0) {
                  state.startEmitted = true;
                  await this.emitToolEventHooks({
                    event: {
                      type: "tool_call_args_streaming_start",
                      toolName: state.toolName,
                    },
                  });
                  yield {
                    type: "tool_call_args_streaming_start",
                    toolName: state.toolName,
                  };
                }

                toolArgsStreamByIndex.set(index, state);
              }
            }
          }

          if (streamEvent.data.type === "output_text_delta") {
            const delta = streamEvent.data.delta;
            if (turnDecided) {
              if (turnIsLeakedThought) {
                yield { type: "reasoning_delta", delta };
              } else {
                streamedOutput += delta;
                yield { type: "content_delta", delta };
              }
            } else {
              turnBuffer += delta;
              if (
                turnBuffer.includes("\n") ||
                turnBuffer.length >= LEAKED_THOUGHT_DECIDE_AT
              ) {
                turnDecided = true;
                const marker = LEAKED_THOUGHT_MARKER.exec(turnBuffer);
                const rest = marker
                  ? turnBuffer.slice(marker[0].length)
                  : turnBuffer;
                turnBuffer = "";
                if (marker) {
                  turnIsLeakedThought = true;
                  leakGuardTripped = true;
                  if (rest) {
                    yield { type: "reasoning_delta", delta: rest };
                  }
                } else {
                  streamedOutput += rest;
                  yield { type: "content_delta", delta: rest };
                }
              }
            }
          }
          continue;
        }

        if (streamEvent.type === "run_item_stream_event") {
          // Emit tool args "complete" right before the tool call starts, so UIs can
          // show a "parameters ready" transition even if they couldn't observe args streaming.
          if (streamEvent.name === "tool_called") {
            toolCallsEmittedByRunner++;
            const toolName = extractToolName(streamEvent.item);
            const params = extractToolArguments(streamEvent.item);
            const argsCompleteEvent: AgentEvent = {
              type: "tool_call_args_streaming_complete",
              toolName,
              params,
            };
            await this.emitToolEventHooks({ event: argsCompleteEvent });
            yield argsCompleteEvent;
          }

          const toolEvent = this.transformToolEvent(streamEvent);
          if (toolEvent) {
            if (toolEvent.type === "tool_call_error") {
              consecutiveToolFailures++;
            } else if (toolEvent.type === "tool_call_complete") {
              consecutiveToolFailures = 0;
            }
            await this.emitToolEventHooks({ event: toolEvent });
            yield toolEvent;
          }
        }
      }

      const trailingText = flushUndecidedText();
      if (trailingText !== null) {
        yield { type: "content_delta", delta: trailingText };
      }

      if (toolCallsDetectedInRaw > 0 || toolCallsEmittedByRunner > 0) {
        console.log(
          `[Eterna] Stream complete: ${toolCallsDetectedInRaw} raw tool_call chunks, ` +
            `${toolCallsEmittedByRunner} runner tool_called events`,
        );
      }

      // When the leak guard rerouted a response, result.finalOutput still
      // contains the leaked thought text — fall back to the clean stream.
      const finalOutput =
        !leakGuardTripped &&
        typeof result.finalOutput === "string" &&
        result.finalOutput.length > 0
          ? result.finalOutput
          : streamedOutput;

      metrics.itemCount = session?.getItemCount() ?? 0;
      metrics.duration = Date.now() - startTime;
      applyUsageMetrics(metrics, result);

      const metricsSnapshot = { ...metrics };
      await this.emitMetricsHooks({
        metrics: metricsSnapshot,
        sessionId: session?.id ?? undefined,
      });
      yield {
        type: "metrics_update",
        metrics: metricsSnapshot,
        sessionId: session?.id,
      };

      await persistSession();

      await this.runAfterResponseHooks({
        input,
        finalOutput,
        metrics: { ...metrics },
        sessionId: session?.id ?? undefined,
      });

      yield {
        type: "execution_complete",
        finalOutput,
        metrics,
      };
    } catch (error) {
      const agentError = normalizeError(error);
      metrics.duration = Date.now() - startTime;
      const metricsSnapshot = { ...metrics };
      await this.emitMetricsHooks({
        metrics: metricsSnapshot,
        sessionId: session?.id ?? undefined,
      });
      yield {
        type: "metrics_update",
        metrics: { ...metrics },
        sessionId: session?.id,
      };
      yield { type: "error", error: agentError };
      await persistSession();
      return;
    } finally {
      // Interrupt path: generator.return() unwinds here without running the
      // success or catch save. persistSession() is a no-op if already saved.
      await persistSession();
    }
  }

  async *chat(
    input: string,
    options?: ChatOptions,
  ): AsyncGenerator<AgentEvent> {
    let finalTextInput = input;
    let chatOptions = options;
    let resolvedContexts: Context[] | undefined;

    // Handle contexts if provided
    if (chatOptions?.contexts && chatOptions.contexts.length > 0) {
      try {
        // Resolve context IDs to Context objects if needed
        const contextObjs =
          this.contextManager &&
          chatOptions.contexts.some((c) => typeof c === "string")
            ? await resolveContexts(
                chatOptions.contexts,
                this.contextManager.getContext.bind(this.contextManager),
              )
            : (chatOptions.contexts.filter(
                (c) => typeof c !== "string",
              ) as Context[]);

        if (contextObjs.length > 0) {
          resolvedContexts = contextObjs;

          // Send each context's body once per conversation; later turns get a
          // pointer to it instead of the whole thing again.
          const conversationKey =
            chatOptions?.sessionId ?? NEW_CONVERSATION_KEY;
          const alreadySent =
            this.sentContextFingerprints.get(conversationKey) ??
            new Set<string>();
          const { contexts: toSend, fingerprints } = dropUnchangedContexts(
            contextObjs,
            alreadySent,
          );
          for (const fingerprint of fingerprints) alreadySent.add(fingerprint);
          // Fingerprints are ~50 bytes each but nothing ever removes a
          // conversation's set; cap per conversation (drop oldest — worst
          // case a re-sent page body, not a correctness issue) and cap the
          // conversation count so the agent instance never grows unbounded.
          while (alreadySent.size > 200) {
            const oldest = alreadySent.values().next().value;
            if (oldest === undefined) break;
            alreadySent.delete(oldest);
          }
          if (
            !this.sentContextFingerprints.has(conversationKey) &&
            this.sentContextFingerprints.size >= 100
          ) {
            const oldestKey = this.sentContextFingerprints.keys().next().value;
            if (oldestKey !== undefined) {
              this.sentContextFingerprints.delete(oldestKey);
            }
          }
          this.sentContextFingerprints.set(conversationKey, alreadySent);

          const contextText = formatContextsForPrompt(toSend);
          finalTextInput = `${contextText}\n\n${input}`;

          // The UI still shows the full context — only the prompt is trimmed.
          yield { type: "contexts_attached", contexts: contextObjs };
        }
      } catch (error) {
        // Emit context error but continue with original input
        yield {
          type: "context_error",
          providerId: "unknown",
          error: error instanceof Error ? error : new Error(String(error)),
        };
      }
    }

    const beforeChat = await this.runBeforeChatHooks({
      input: finalTextInput,
      options: chatOptions,
      contexts: resolvedContexts,
    });
    let finalInput: string | AgentInputItem[] = beforeChat.input;
    if (beforeChat.options) {
      chatOptions = { ...(chatOptions ?? {}), ...beforeChat.options };
    }
    if (beforeChat.contexts) {
      resolvedContexts = beforeChat.contexts;
      chatOptions = { ...(chatOptions ?? {}), contexts: beforeChat.contexts };
    }

    // When images are provided, build a multimodal UserMessageItem
    const images = chatOptions?.images;
    if (images && images.length > 0 && typeof finalInput === "string") {
      const contentParts: Array<
        | { type: "input_text"; text: string }
        | { type: "input_image"; image: string; detail?: string }
      > = [];

      // An attachment-only turn carries no prompt. Providers reject empty text
      // blocks ("text content blocks must be non-empty"), so only include the
      // text part when there is something in it.
      if (finalInput.trim()) {
        contentParts.push({ type: "input_text", text: finalInput });
      }

      for (const img of images) {
        contentParts.push({
          type: "input_image",
          image: img.image,
          detail: img.detail ?? "auto",
        });
      }

      finalInput = [
        { type: "message", role: "user", content: contentParts },
      ] as AgentInputItem[];
    }

    // A text-file attachment travels as a context rather than an image, so the
    // branch above never runs and the turn would reach the provider as an empty
    // user message — rejected for the same reason. Attachments are the message
    // in that case, so stand in a neutral prompt instead of inventing intent.
    if (typeof finalInput === "string" && !finalInput.trim()) {
      finalInput = ATTACHMENT_ONLY_PROMPT;
    }

    // If sessionId is provided, continue existing conversation
    if (chatOptions?.sessionId) {
      if (!this.conversationManager) {
        throw new Error(
          "ConversationManager is required for continuing conversations",
        );
      }

      const session = await this.conversationManager.getSession(
        chatOptions.sessionId,
      );
      if (!session) {
        throw new Error(`Session ${chatOptions.sessionId} not found`);
      }

      yield {
        type: "session_resumed",
        sessionId: chatOptions.sessionId,
        itemCount: session.getItemCount(),
      };

      yield* this.runExecution(finalInput, session, chatOptions?.ambientImage);
      return;
    }

    // Start new conversation
    let session: Session | null = null;

    if (this.conversationManager) {
      session = await this.conversationManager.createSession();
      // The opening turn recorded its contexts before a session existed. Carry
      // them onto the real id, or turn two would re-send the whole page.
      const pending = this.sentContextFingerprints.get(NEW_CONVERSATION_KEY);
      if (pending) {
        this.sentContextFingerprints.set(session.id, pending);
        this.sentContextFingerprints.delete(NEW_CONVERSATION_KEY);
      }
      yield { type: "session_created", sessionId: session.id };
    }

    yield* this.runExecution(finalInput, session, chatOptions?.ambientImage);
  }

  /**
   * Roll back the session to the state just after the last user message,
   * removing any assistant/tool items that followed it.
   * Used by regenerate to avoid duplicate history when re-running.
   */
  async rollbackLastAssistantTurn(sessionId: string): Promise<boolean> {
    if (!this.conversationManager) return false;

    const session = await this.conversationManager.getSession(sessionId);
    if (!session) return false;

    const items = await session.getItems();
    if (items.length === 0) return false;

    let lastUserIndex = -1;
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i] as Record<string, unknown>;
      // AgentInputItem is a discriminated union; user messages have
      // type === "message" (or undefined) and role === "user".
      const isUserMessage =
        (item.type === "message" || item.type === undefined) &&
        item.role === "user";
      if (isUserMessage) {
        lastUserIndex = i;
        break;
      }
    }

    if (lastUserIndex === -1) return false;
    if (lastUserIndex === items.length - 1) return false;

    const itemsToRemove = items.length - 1 - lastUserIndex;
    for (let i = 0; i < itemsToRemove; i++) {
      await session.popItem();
    }

    await this.conversationManager.saveSession(session);
    return true;
  }

  getConversationManager(): ConversationManager | undefined {
    return this.conversationManager;
  }

  getContextManager(): ContextManager | undefined {
    return this.contextManager;
  }

  private transformToolEvent(
    event: RunItemStreamEvent,
  ): AgentEvent | undefined {
    if (event.name !== "tool_called" && event.name !== "tool_output") {
      return undefined;
    }

    if (event.name === "tool_called") {
      return {
        type: "tool_call_start",
        toolName: extractToolName(event.item),
        params: extractToolArguments(event.item),
      };
    }

    const status = getToolStatus(event.item);
    if (status !== "completed") {
      const toolName = extractToolName(event.item);
      const failureMessage = extractToolFailureMessage(event.item, status);
      return {
        type: "tool_call_error",
        toolName,
        error: new Error(failureMessage),
      };
    }

    return {
      type: "tool_call_complete",
      toolName: extractToolName(event.item),
      result: extractToolOutput(event.item),
    };
  }

  private initializePlugins(): void {
    for (const plugin of this.plugins) {
      try {
        void plugin.setup?.(this.pluginContext);
      } catch (error) {
        console.error(`[Eterna] Failed to setup plugin ${plugin.id}:`, error);
      }
    }
  }

  private async runBeforeChatHooks(
    payload: BeforeChatPayload,
  ): Promise<BeforeChatPayload> {
    let current = payload;
    for (const plugin of this.plugins) {
      const hook = plugin.hooks?.beforeChat;
      if (!hook) {
        continue;
      }
      try {
        const result = await hook(current, this.pluginContext);
        if (result) {
          current = {
            input: result.input ?? current.input,
            options: result.options ?? current.options,
            contexts: result.contexts ?? current.contexts,
          };
        }
      } catch (error) {
        console.error(`[Eterna] Plugin ${plugin.id} beforeChat failed`, error);
      }
    }
    return current;
  }

  private async runAfterResponseHooks(
    payload: AfterResponsePayload,
  ): Promise<void> {
    for (const plugin of this.plugins) {
      const hook = plugin.hooks?.afterResponse;
      if (!hook) continue;
      try {
        await hook(payload, this.pluginContext);
      } catch (error) {
        console.error(
          `[Eterna] Plugin ${plugin.id} afterResponse failed`,
          error,
        );
      }
    }
  }

  private async emitToolEventHooks(payload: ToolEventPayload): Promise<void> {
    for (const plugin of this.plugins) {
      const hook = plugin.hooks?.onToolEvent;
      if (!hook) continue;
      try {
        await hook(payload, this.pluginContext);
      } catch (error) {
        console.error(`[Eterna] Plugin ${plugin.id} onToolEvent failed`, error);
      }
    }
  }

  private async emitMetricsHooks(payload: MetricsPayload): Promise<void> {
    for (const plugin of this.plugins) {
      const hook = plugin.hooks?.onMetrics;
      if (!hook) continue;
      try {
        await hook(payload, this.pluginContext);
      } catch (error) {
        console.error(`[Eterna] Plugin ${plugin.id} onMetrics failed`, error);
      }
    }
  }
}
