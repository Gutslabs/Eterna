import { memo, useMemo, useRef } from "react";
import { useTranslation } from "../../../i18n/context";
import { cn } from "../../../lib/utils";
import type { ChatStatus, MessageListProps, UIMessage } from "../../../types";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "../../ai-elements/conversation";
import { Citations } from "../../beui/agents/citations";
import { AgentProgress } from "../../beui/agents/loading-states/agent-progress";
import { useComponentsContext } from "../context";
import { ActivityRail } from "./activity-rail";
import { buildTurnBlocks } from "./activity-steps";
import { DiagramBlock } from "./diagram-block";
import { MessageItem } from "./message-item";
import { collectTurnCitations } from "./turn-citations";
import { WelcomeScreen } from "./welcome-screen";

/**
 * A conversation turn: one optional user message followed by one or more
 * assistant messages produced before the next user message.
 */
interface ConversationTurn {
  userMessage?: UIMessage;
  assistantMessages: UIMessage[];
}

/**
 * Group a flat message list into conversation turns so we can collapse
 * intermediate assistant messages (thinking / tool-call steps).
 */
function groupIntoTurns(messages: UIMessage[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  let current: ConversationTurn | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      if (current) turns.push(current);
      current = { userMessage: message, assistantMessages: [] };
    } else if (message.role === "assistant") {
      if (!current) {
        current = { assistantMessages: [] };
      }
      current.assistantMessages.push(message);
    }
  }
  if (current) turns.push(current);
  return turns;
}

/**
 * Shown while waiting for the assistant to start responding: beui's animated
 * grid plus a live elapsed timer, so a long model warm-up reads as progress
 * rather than a stall.
 */
function ThinkingIndicator() {
  const { t } = useTranslation();
  return (
    <div className="py-2">
      <AgentProgress label={t("common.thinking")} className="text-sm" />
    </div>
  );
}

/**
 * One turn's assistant side, laid out in order: text parts render as message
 * bubbles in place, and each consecutive run of tool/reasoning steps renders
 * as an activity rail between them. Only the turn's trailing rail can be
 * live; a bubble never reclassifies into the rail, so streamed text stays
 * exactly where the user is reading it.
 */
const TurnAssistantBlock = memo(function TurnAssistantBlock({
  assistantMessages,
  isLastTurn,
  status,
  onRegenerate,
  onCopy,
}: {
  assistantMessages: UIMessage[];
  isLastTurn: boolean;
  status: ChatStatus;
  onRegenerate?: () => void;
  onCopy?: (text: string) => void;
}) {
  const blocks = useMemo(
    () => buildTurnBlocks(assistantMessages),
    [assistantMessages],
  );

  const busy =
    status === "streaming" ||
    status === "executing_tools" ||
    status === "submitted";
  const live = isLastTurn && busy;
  const lastBlock = blocks[blocks.length - 1];
  const trailingActivityLive = live && lastBlock?.type === "activity";

  // Web pages this turn actually consulted, shown once the turn settles so
  // the list never reshuffles mid-stream. Not computed while live — the list
  // is hidden then, and it would JSON-parse every tool part per commit.
  const citations = useMemo(
    () => (live ? [] : collectTurnCitations(assistantMessages)),
    [assistantMessages, live],
  );
  const showCitations = citations.length > 0 && !live;

  return (
    <>
      {blocks.map((block, index) => {
        if (block.type === "activity") {
          const isTrailing = index === blocks.length - 1;
          return (
            <ActivityRail
              key={block.key}
              steps={block.steps}
              isLive={isTrailing && trailingActivityLive}
            />
          );
        }
        if (block.type === "diagram") {
          return <DiagramBlock key={block.key} part={block.part} />;
        }
        const isLastBubble = isLastTurn && index === blocks.length - 1;
        return (
          <MessageItem
            key={block.key}
            message={block.message}
            isLast={isLastBubble}
            isStreaming={status === "streaming"}
            onRegenerate={onRegenerate}
            onCopy={onCopy}
          />
        );
      })}
      {showCitations && <Citations citations={citations} className="mb-1" />}
    </>
  );
});

/**
 * Default MessageList component
 */
export function DefaultMessageList({
  messages,
  status,
  onRegenerate,
  onCopy,
  onSuggestionClick,
  onUxAuditClick,
  className,
  ...props
}: MessageListProps & {
  onSuggestionClick?: (text: string) => void;
  onUxAuditClick?: () => void;
}) {
  const { slots } = useComponentsContext();

  // Filter out system messages and group into conversation turns for folding.
  // Keyed off the messages array itself so this only recomputes when the
  // adapter actually publishes an update. Turns whose member messages are
  // identity-unchanged reuse the previous turn object, so downstream memos
  // (TurnAssistantBlock, buildTurnBlocks, citations) only re-run for the turn
  // that is actually streaming — not the whole scrollback on every commit.
  const stableTurnsRef = useRef(new Map<string, ConversationTurn>());
  const { displayMessages, turns } = useMemo(() => {
    const display = messages.filter((m) => m.role !== "system");
    const grouped = groupIntoTurns(display);
    const previous = stableTurnsRef.current;
    const next = new Map<string, ConversationTurn>();
    const stable = grouped.map((turn) => {
      const key = turn.userMessage
        ? turn.userMessage.id
        : (turn.assistantMessages[0]?.id ?? "");
      const prior = previous.get(key);
      const unchanged =
        prior !== undefined &&
        prior.userMessage === turn.userMessage &&
        prior.assistantMessages.length === turn.assistantMessages.length &&
        prior.assistantMessages.every(
          (message, i) => message === turn.assistantMessages[i],
        );
      const chosen = unchanged ? prior : turn;
      next.set(key, chosen);
      return chosen;
    });
    stableTurnsRef.current = next;
    return { displayMessages: display, turns: stable };
  }, [messages]);

  // Determine if a message is the very last display message
  const lastMessage = displayMessages[displayMessages.length - 1];
  const lastMessageId = lastMessage?.id ?? null;

  return (
    <div className={cn("flex-1 overflow-hidden", className)} {...props}>
      <Conversation className="h-full">
        <ConversationContent>
          {/* Before messages slot - for banners, announcements */}
          {slots.beforeMessages?.()}
          {displayMessages.length === 0 ? (
            <WelcomeScreen
              onSuggestionClick={(text) => {
                onSuggestionClick?.(text);
              }}
              onUxAuditClick={onUxAuditClick}
            />
          ) : (
            turns.map((turn) => {
              // Generate stable key from message IDs
              const turnKey = turn.userMessage
                ? turn.userMessage.id
                : (turn.assistantMessages[0]?.id ?? "");
              const isLastTurn = turn.assistantMessages.some(
                (message) => message.id === lastMessageId,
              );
              const userIsLast = turn.userMessage?.id === lastMessageId;
              return (
                <div key={turnKey}>
                  {/* Render user message */}
                  {turn.userMessage && (
                    <MessageItem
                      key={turn.userMessage.id}
                      message={turn.userMessage}
                      isLast={userIsLast}
                      isStreaming={userIsLast && status === "streaming"}
                      onRegenerate={onRegenerate}
                      onCopy={onCopy}
                    />
                  )}

                  {/* Assistant side: activity rail + final answer. Status is
                      normalized to "idle" for settled turns so status flips
                      don't re-render the whole scrollback. */}
                  {turn.assistantMessages.length > 0 && (
                    <TurnAssistantBlock
                      assistantMessages={turn.assistantMessages}
                      isLastTurn={isLastTurn}
                      status={isLastTurn ? status : "idle"}
                      onRegenerate={onRegenerate}
                      onCopy={onCopy}
                    />
                  )}
                </div>
              );
            })
          )}
          {/* Loading indicator */}
          {status === "submitted" &&
            (slots.loadingIndicator ? (
              slots.loadingIndicator()
            ) : (
              <ThinkingIndicator />
            ))}
          {/* After messages slot - for platform-specific content */}
          {slots.afterMessages?.()}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    </div>
  );
}

/**
 * MessageList - Renders either custom or default message list
 */
export function MessageList(
  props: MessageListProps & {
    onSuggestionClick?: (text: string) => void;
    onUxAuditClick?: () => void;
  },
) {
  const { components } = useComponentsContext();

  const CustomComponent = components.MessageList;
  if (CustomComponent) {
    return <CustomComponent {...props} />;
  }

  return <DefaultMessageList {...props} />;
}
