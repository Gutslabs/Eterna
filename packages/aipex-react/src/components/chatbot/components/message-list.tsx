import { useMemo } from "react";
import { useTranslation } from "../../../i18n/context";
import { cn } from "../../../lib/utils";
import type { ChatStatus, MessageListProps, UIMessage } from "../../../types";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "../../ai-elements/conversation";
import { useComponentsContext } from "../context";
import { ActivityRail } from "./activity-rail";
import { buildTurnBlocks } from "./activity-steps";
import { MessageItem } from "./message-item";
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
 * Shown while waiting for the assistant to start responding. A soft light
 * sweeps across the word (like Claude/ChatGPT) for a calmer, more polished feel
 * than a spinner.
 */
function ThinkingIndicator() {
  const { t } = useTranslation();
  return (
    <div className="py-2">
      <span className="aipex-thinking-shimmer font-medium text-sm">
        {t("common.thinking")}
      </span>
      <style>{`
        .aipex-thinking-shimmer {
          background: linear-gradient(
            100deg,
            var(--muted-foreground) 35%,
            var(--foreground) 50%,
            var(--muted-foreground) 65%
          );
          background-size: 200% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          animation: aipex-thinking-shimmer 1.4s ease-in-out infinite;
        }
        @keyframes aipex-thinking-shimmer {
          0% { background-position: 100% 0; }
          100% { background-position: -100% 0; }
        }
      `}</style>
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
function TurnAssistantBlock({
  assistantMessages,
  lastMessageId,
  status,
  onRegenerate,
  onCopy,
}: {
  assistantMessages: UIMessage[];
  lastMessageId: string | null;
  status: ChatStatus;
  onRegenerate?: () => void;
  onCopy?: (text: string) => void;
}) {
  const blocks = useMemo(
    () => buildTurnBlocks(assistantMessages),
    [assistantMessages],
  );

  const isLastTurn = assistantMessages.some(
    (message) => message.id === lastMessageId,
  );
  const busy =
    status === "streaming" ||
    status === "executing_tools" ||
    status === "submitted";
  const lastBlock = blocks[blocks.length - 1];
  const trailingActivityLive =
    isLastTurn && busy && lastBlock?.type === "activity";

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
    </>
  );
}

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
  // adapter actually publishes an update.
  const { displayMessages, turns } = useMemo(() => {
    const display = messages.filter((m) => m.role !== "system");
    return { displayMessages: display, turns: groupIntoTurns(display) };
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
              return (
                <div key={turnKey}>
                  {/* Render user message */}
                  {turn.userMessage && (
                    <MessageItem
                      key={turn.userMessage.id}
                      message={turn.userMessage}
                      isLast={turn.userMessage.id === lastMessageId}
                      isStreaming={status === "streaming"}
                      onRegenerate={onRegenerate}
                      onCopy={onCopy}
                    />
                  )}

                  {/* Assistant side: activity rail + final answer */}
                  {turn.assistantMessages.length > 0 && (
                    <TurnAssistantBlock
                      assistantMessages={turn.assistantMessages}
                      lastMessageId={lastMessageId}
                      status={status}
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
