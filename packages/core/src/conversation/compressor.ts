import type { AgentInputItem } from "@openai/agents";
import { Agent, run } from "@openai/agents";
import type { AiSdkModel, CompressionConfig } from "../types.js";

/** Trim a string to `max`, marking the cut. */
function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * Keep the head AND tail of a long value, gutting the middle. User messages put
 * the auto-attached page block first and the user's actual question last, so a
 * front-only truncation would drop the question — keep both ends.
 */
function truncateMiddle(value: string, head: number, tail: number): string {
  if (value.length <= head + tail + 20) return value;
  return `${value.slice(0, head)} …[trimmed]… ${value.slice(-tail)}`;
}

export class ConversationCompressor {
  private config: Required<
    Omit<CompressionConfig, "tokenWatermark" | "protectRecentMessages">
  > & {
    tokenWatermark?: number;
    protectRecentMessages?: number;
  };
  private agent: Agent;

  constructor(model: AiSdkModel, config: CompressionConfig = {}) {
    this.config = {
      summarizeAfterItems: config.summarizeAfterItems ?? 20,
      keepRecentItems: config.keepRecentItems ?? 10,
      maxSummaryLength: config.maxSummaryLength ?? 2000,
      tokenWatermark: config.tokenWatermark,
      protectRecentMessages: config.protectRecentMessages,
    };
    this.agent = new Agent({
      name: "Summarizer",
      instructions: `You compress the earlier part of a browser-agent conversation so it can be dropped from context without losing what matters. Produce a tight briefing that preserves:
- the user's goal(s) and any explicit preferences or constraints;
- decisions made and conclusions reached;
- pages and resources visited — keep their URLs/titles verbatim so they can be reopened, but DROP the raw page/article/screenshot text bodies;
- what has been done so far and what is still pending (unresolved sub-tasks);
- the last few tool errors or blockers, stated concretely.
Write terse notes, not prose; do not address the user. Keep it under ${this.config.maxSummaryLength} characters.`,
      model,
    });
  }

  async compressItems(items: AgentInputItem[]): Promise<{
    summary: string;
    compressedItems: AgentInputItem[];
  }> {
    if (items.length <= this.config.summarizeAfterItems) {
      return { summary: "", compressedItems: items };
    }

    let itemsToSummarize: AgentInputItem[];
    let recentItems: AgentInputItem[];

    // Use protectRecentMessages if configured
    if (this.config.protectRecentMessages !== undefined) {
      const protectIndex = this.findProtectedTailStartIndex(
        items,
        this.config.protectRecentMessages,
      );
      itemsToSummarize = items.slice(0, protectIndex);
      recentItems = items.slice(protectIndex);
    } else {
      // Fallback to keepRecentItems logic
      itemsToSummarize = items.slice(
        0,
        items.length - this.config.keepRecentItems,
      );
      recentItems = items.slice(-this.config.keepRecentItems);
    }

    const summary = await this.generateSummary(itemsToSummarize);

    return {
      summary,
      compressedItems: recentItems,
    };
  }

  private async generateSummary(items: AgentInputItem[]): Promise<string> {
    const conversationText = items
      .map((item) => this.renderItemForSummary(item))
      .filter((line) => line.length > 0)
      .join("\n");

    const result = await run(
      this.agent,
      `Summarize the conversation so far:\n\n${conversationText}`,
    );

    return (result.finalOutput ?? "").trim();
  }

  /**
   * Render one history item as a single briefing line. Unlike the old
   * message-only filter, this keeps the tool trail (which pages were read, what
   * errored) — the high-signal content for a browsing agent — while trimming the
   * bulky bodies so the summarizer input stays bounded.
   */
  private renderItemForSummary(item: AgentInputItem): string {
    const type = item.type;
    if (type === "message" || type === undefined) {
      const role = "role" in item ? item.role : "unknown";
      const content = truncateMiddle(this.extractContent(item), 200, 500);
      return content ? `${role}: ${content}` : "";
    }
    if (type === "function_call") {
      const call = item as { name?: string; arguments?: unknown };
      const name = call.name ?? "tool";
      const args =
        typeof call.arguments === "string"
          ? call.arguments
          : JSON.stringify(call.arguments ?? {});
      return `→ called ${name}(${truncate(args, 200)})`;
    }
    if (type === "function_call_result") {
      const res = item as { name?: string; output?: unknown };
      const name = res.name ?? "tool";
      return `← ${name} → ${truncate(this.extractToolResultText(res.output), 400)}`;
    }
    return "";
  }

  /** Best-effort flatten of a tool result's output to text for the summary. */
  private extractToolResultText(output: unknown): string {
    if (output == null) return "";
    if (typeof output === "string") return output;
    if (typeof output === "object") {
      const obj = output as Record<string, unknown>;
      if (typeof obj.text === "string") return obj.text;
      try {
        return JSON.stringify(obj);
      } catch {
        return String(output);
      }
    }
    return String(output);
  }

  private extractContent(item: AgentInputItem): string {
    if (!("content" in item)) return "";
    const content = item.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .filter((c) => c.type === "input_text" || c.type === "output_text")
        .map((c) => ("text" in c ? c.text : ""))
        .join(" ");
    }
    return "";
  }

  shouldCompress(itemCount: number, lastPromptTokens?: number): boolean {
    // Prefer the token watermark when we actually have a usage reading. Some
    // gateways don't report usage (lastPromptTokens stays 0); treat that as
    // "unknown" and fall back to item count so a long session still compacts
    // instead of growing forever.
    const tokensKnown =
      typeof lastPromptTokens === "number" && lastPromptTokens > 0;
    if (this.config.tokenWatermark !== undefined && tokensKnown) {
      return lastPromptTokens > this.config.tokenWatermark;
    }
    // Fallback to item count based compression
    return itemCount > this.config.summarizeAfterItems;
  }

  /**
   * Find the start index for the protected tail based on protectRecentMessages count.
   * This method:
   * 1. Counts backwards N message items (type="message")
   * 2. Expands to include all non-message items between protected messages
   * 3. Ensures tool call/result pairs stay together (callId closure)
   * 4. Includes the assistant message preceding any tool calls in the protected region
   */
  private findProtectedTailStartIndex(
    items: AgentInputItem[],
    protectRecentMessages: number,
  ): number {
    if (protectRecentMessages <= 0 || items.length === 0) {
      return items.length;
    }

    // Count backwards to find N message items and track the earliest one
    let messageCount = 0;
    let startIndex = items.length;

    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i]?.type === "message") {
        messageCount++;
        if (messageCount === protectRecentMessages) {
          startIndex = i;
          break;
        }
      }
    }

    // If we didn't find enough messages, protect everything
    if (messageCount < protectRecentMessages) {
      return 0;
    }

    // Expand backwards to include all non-message items (tool calls/results)
    // that appear between the earliest protected message and the next message
    while (startIndex > 0 && items[startIndex - 1]?.type !== "message") {
      startIndex--;
    }

    // Now expand the protected region to ensure tool call/result pairs are complete
    startIndex = this.expandForToolCallClosure(items, startIndex);

    // Include the assistant message preceding any tool calls at the boundary
    startIndex = this.includePrecedingAssistantMessage(items, startIndex);

    return startIndex;
  }

  /**
   * Expand the protected region to ensure tool call/result pairs are not split.
   * Collects all callIds in the protected region and ensures both call and result are included.
   */
  private expandForToolCallClosure(
    items: AgentInputItem[],
    startIndex: number,
  ): number {
    const protectedCallIds = new Set<string>();

    // Collect callIds from the initially protected region
    for (let i = startIndex; i < items.length; i++) {
      const callId = this.extractCallId(items[i]);
      if (callId) {
        protectedCallIds.add(callId);
      }
    }

    // If no tool calls in protected region, no expansion needed
    if (protectedCallIds.size === 0) {
      return startIndex;
    }

    // Scan backwards to include any missing call/result items with these callIds
    let expandedStart = startIndex;
    for (let i = startIndex - 1; i >= 0; i--) {
      const callId = this.extractCallId(items[i]);
      if (callId && protectedCallIds.has(callId)) {
        expandedStart = i;
      }
    }

    return expandedStart;
  }

  /**
   * If the protected region starts with a tool call/result, include the preceding
   * assistant message that initiated the tool calls.
   */
  private includePrecedingAssistantMessage(
    items: AgentInputItem[],
    startIndex: number,
  ): number {
    if (startIndex === 0) {
      return startIndex;
    }

    // Check if the first item in protected region is a tool-related item
    const firstProtectedItem = items[startIndex];
    if (!firstProtectedItem || !this.isToolRelatedItem(firstProtectedItem)) {
      return startIndex;
    }

    // Look backwards for the preceding assistant message
    for (let i = startIndex - 1; i >= 0; i--) {
      const item = items[i];
      if (item?.type === "message" && item.role === "assistant") {
        return i;
      }
      // Stop if we hit a user or system message
      if (
        item?.type === "message" &&
        (item.role === "user" || item.role === "system")
      ) {
        break;
      }
    }

    return startIndex;
  }

  /**
   * Extract callId from tool call or result items.
   */
  private extractCallId(item: AgentInputItem | undefined): string | undefined {
    if (!item) return undefined;

    // Check for callId in various tool item formats
    const itemWithCallId = item as { callId?: string };
    if (typeof itemWithCallId.callId === "string") {
      return itemWithCallId.callId;
    }

    return undefined;
  }

  /**
   * Check if an item is tool-related (call or result).
   */
  private isToolRelatedItem(item: AgentInputItem): boolean {
    const type = item.type;
    return (
      type === "function_call" ||
      type === "function_call_result" ||
      type === "hosted_tool_call" ||
      type === "computer_call" ||
      type === "shell_call" ||
      type === "apply_patch_call" ||
      type === "computer_call_result" ||
      type === "shell_call_output" ||
      type === "apply_patch_call_output"
    );
  }
}
