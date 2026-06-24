import { CopyIcon, PaperclipIcon, RefreshCcwIcon } from "lucide-react";
import { Fragment, memo, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { transformScreenshotPlaceholders } from "../../../lib/screenshot-utils";
import { cn } from "../../../lib/utils";
import type {
  MessageItemProps,
  UIContextPart,
  UIFilePart,
  UISourceUrlPart,
} from "../../../types";
import { Action, Actions } from "../../ai-elements/actions";
import { Message, MessageContent } from "../../ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "../../ai-elements/reasoning";
import { StreamingResponse } from "../../ai-elements/response";
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "../../ai-elements/sources";
import { useComponentsContext } from "../context";
import { BuyTokenPrompt } from "./buy-token-prompt";
import { LoginPrompt } from "./login-prompt";
import { ModelChangePrompt } from "./model-change-prompt";
import { DefaultToolDisplay } from "./slots/tool-display";

/**
 * Get icon for context type
 */
function getContextIcon(contextType: string): string {
  const icons: Record<string, string> = {
    page: "🌐",
    tab: "📄",
    bookmark: "🔖",
    clipboard: "📋",
    screenshot: "📷",
  };
  return icons[contextType] || "📝";
}

/**
 * Renders an attached file or selected context as a compact card (icon/thumbnail
 * + title + subtitle), like a native browser AI sidebar.
 */
function AttachmentCard({ part }: { part: UIContextPart | UIFilePart }) {
  const cardClass =
    "flex w-full max-w-[280px] items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5";
  const boxClass =
    "flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted";

  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    if (!zoomed) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setZoomed(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [zoomed]);

  if (part.type === "file") {
    const isImage = Boolean(part.mediaType?.startsWith("image/") && part.url);
    const typeLabel =
      part.filename?.split(".").pop()?.toUpperCase() ||
      part.mediaType?.split("/").pop()?.toUpperCase() ||
      "FILE";
    return (
      <div className={cardClass}>
        {isImage ? (
          <button
            type="button"
            onClick={() => setZoomed(true)}
            className={cn(boxClass, "cursor-zoom-in p-0")}
            title="Click to enlarge"
          >
            <img
              src={part.url}
              alt={part.filename || "attachment"}
              className="size-full object-cover"
            />
          </button>
        ) : (
          <div className={boxClass}>
            <PaperclipIcon className="size-4 text-muted-foreground" />
          </div>
        )}
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-foreground text-sm">
            {part.filename || "Attachment"}
          </span>
          <span className="truncate text-muted-foreground text-xs">
            {typeLabel}
          </span>
        </div>
        {isImage &&
          zoomed &&
          createPortal(
            <button
              type="button"
              aria-label="Close image preview"
              onClick={() => setZoomed(false)}
              className="fixed inset-0 z-[2147483647] flex cursor-zoom-out items-center justify-center border-0 bg-black/80 p-6"
            >
              <img
                src={part.url}
                alt={part.filename || "attachment"}
                className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
              />
            </button>,
            document.body,
          )}
      </div>
    );
  }

  // Only render secure favicons — an http:// favicon (e.g. a localhost page)
  // triggers mixed-content warnings on the extension's https-context page.
  const rawFavIcon =
    typeof part.metadata?.favIconUrl === "string"
      ? part.metadata.favIconUrl
      : "";
  const favIconUrl = /^(https:|data:)/.test(rawFavIcon)
    ? rawFavIcon
    : undefined;
  const subtitle =
    (typeof part.metadata?.domain === "string" && part.metadata.domain) ||
    (typeof part.metadata?.url === "string" && part.metadata.url) ||
    undefined;

  return (
    <div className={cardClass}>
      <div className={boxClass}>
        {favIconUrl ? (
          <img src={favIconUrl} alt="" className="size-5 object-contain" />
        ) : (
          <span className="text-base">{getContextIcon(part.contextType)}</span>
        )}
      </div>
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-foreground text-sm">{part.label}</span>
        {subtitle && (
          <span className="truncate text-muted-foreground text-xs">
            {subtitle}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Default MessageItem component
 */
export function DefaultMessageItem({
  message,
  isLast = false,
  isStreaming = false,
  onRegenerate,
  onCopy,
  className,
  ...props
}: MessageItemProps) {
  const { slots } = useComponentsContext();

  // Collect screenshot data from tool parts for placeholder resolution
  const { screenshotUidList, screenshotDataMap } = useMemo(() => {
    const uids: string[] = [];
    const dataMap = new Map<string, string>();
    for (const p of message.parts) {
      if (p.type === "tool" && p.screenshotUid) {
        uids.push(p.screenshotUid);
        if (p.screenshot) {
          dataMap.set(p.screenshotUid, p.screenshot);
        }
      }
    }
    return { screenshotUidList: uids, screenshotDataMap: dataMap };
  }, [message.parts]);

  // Filter out system messages
  if (message.role === "system") {
    return null;
  }

  // Render sources if present
  const sourceUrls = message.parts.filter(
    (part): part is UISourceUrlPart => part.type === "source-url",
  );

  // Attached files and selected contexts are rendered together as cards above
  // the message text (like a native browser AI sidebar), not inline.
  const attachmentParts = message.parts.filter(
    (part): part is UIContextPart | UIFilePart =>
      part.type === "context" || part.type === "file",
  );

  return (
    <div className={className} {...props}>
      {/* Attachment / context cards, grouped above the text */}
      {attachmentParts.length > 0 && (
        <div
          className={cn(
            "flex flex-col gap-1.5 py-1",
            message.role === "user" ? "items-end" : "items-start",
          )}
        >
          {attachmentParts.map((part, i) => (
            <AttachmentCard key={`${message.id}-att-${i}`} part={part} />
          ))}
        </div>
      )}

      {/* Sources */}
      {message.role === "assistant" && sourceUrls.length > 0 && (
        <Sources>
          <SourcesTrigger count={sourceUrls.length} />
          {sourceUrls.map((part, i) => (
            <SourcesContent key={`${message.id}-source-${i}`}>
              <Source href={part.url} title={part.url} />
            </SourcesContent>
          ))}
        </Sources>
      )}

      {/* Message parts */}
      {message.parts.map((part, i) => {
        const key = `${message.id}-${i}`;

        switch (part.type) {
          case "text": {
            // Transform [[screenshot:...]] placeholders to markdown images.
            // First resolve to special URLs, then replace with actual
            // base64 data URLs when available for inline rendering.
            let processedText = part.text;
            if (screenshotUidList.length > 0) {
              processedText = transformScreenshotPlaceholders(
                processedText,
                screenshotUidList,
              );
              // Replace aipex-screenshot.invalid URLs with actual data
              for (const [uid, data] of screenshotDataMap) {
                const placeholder = `https://aipex-screenshot.invalid/${uid}`;
                processedText = processedText.split(placeholder).join(data);
              }
            }
            return (
              <Fragment key={key}>
                <Message from={message.role as "user" | "assistant" | "system"}>
                  <MessageContent>
                    <StreamingResponse
                      animate={
                        message.role === "assistant" && isLast && isStreaming
                      }
                    >
                      {processedText}
                    </StreamingResponse>
                  </MessageContent>
                </Message>
                {/* Actions for last assistant message */}
                {message.role === "assistant" &&
                  isLast &&
                  (slots.messageActions ? (
                    slots.messageActions({
                      message,
                      onRegenerate,
                      onCopy: () => onCopy?.(part.text),
                    })
                  ) : (
                    <Actions className="mt-2">
                      {onRegenerate && (
                        <Action onClick={onRegenerate} label="Retry">
                          <RefreshCcwIcon className="size-3" />
                        </Action>
                      )}
                      {onCopy && (
                        <Action onClick={() => onCopy(part.text)} label="Copy">
                          <CopyIcon className="size-3" />
                        </Action>
                      )}
                    </Actions>
                  ))}
              </Fragment>
            );
          }

          // Files and contexts are rendered as cards above the text
          // (see attachmentParts above), so skip them here.
          case "file":
            return null;

          case "tool":
            // Check for custom tool display slot
            if (slots.toolDisplay) {
              return (
                <Fragment key={key}>
                  {slots.toolDisplay({ tool: part })}
                </Fragment>
              );
            }

            return <DefaultToolDisplay key={key} tool={part} />;

          case "reasoning":
            return (
              <Reasoning
                key={key}
                className="w-full"
                isStreaming={isStreaming && isLast}
              >
                <ReasoningTrigger />
                <ReasoningContent>{part.text}</ReasoningContent>
              </Reasoning>
            );

          case "context":
            return null;

          case "source-url":
            // Already handled above
            return null;

          default:
            return null;
        }
      })}

      {/* Metadata-driven prompts for assistant error messages */}
      {message.role === "assistant" && message.metadata && (
        <>
          {message.metadata.needLogin && (
            <LoginPrompt
              showByokOption
              onLogin={slots.onLogin}
              onOpenSettings={() => chrome.runtime?.openOptionsPage?.()}
            />
          )}
          {message.metadata.needBuyToken && (
            <BuyTokenPrompt
              currentCredits={message.metadata.currentCredits}
              requiredCredits={message.metadata.requiredCredits}
            />
          )}
          {message.metadata.needChangeModel && (
            <ModelChangePrompt
              supportedModels={message.metadata.supportedModels || []}
              onModelChange={(modelId) => {
                chrome.storage?.local?.set?.({ aiModel: modelId });
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

/**
 * MessageItem - Renders either custom or default message item
 *
 * Memoized so streaming updates to the latest message don't re-render the
 * whole history: the adapter preserves object identity for untouched
 * messages, so shallow prop comparison skips them.
 */
export const MessageItem = memo(function MessageItem(props: MessageItemProps) {
  const { components } = useComponentsContext();

  const CustomComponent = components.MessageItem;
  if (CustomComponent) {
    return <CustomComponent {...props} />;
  }

  return <DefaultMessageItem {...props} />;
});
