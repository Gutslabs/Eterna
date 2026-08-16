import {
  CameraIcon,
  CopyIcon,
  PaperclipIcon,
  RefreshCcwIcon,
} from "lucide-react";
import { Fragment, memo, useMemo, useState } from "react";
import { transformScreenshotPlaceholders } from "../../../lib/screenshot-utils";
import { cn } from "../../../lib/utils";
import type {
  MessageItemProps,
  UIContextPart,
  UIFilePart,
  UISourceUrlPart,
} from "../../../types";
import { Action, Actions } from "../../ai-elements/actions";
import {
  ImageLightbox,
  isTextAttachment,
  readAttachmentText,
  TextPreviewOverlay,
} from "../../ai-elements/attachment-preview";
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
import { StreamingResponse as BeuiStreamingResponse } from "../../beui/agents/streaming-response";
import { useComponentsContext } from "../context";
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
  const [preview, setPreview] = useState<{
    title: string;
    text: string;
  } | null>(null);

  const openTextPreview = (title: string, load: () => Promise<string>) => {
    void load()
      .then((text) => setPreview({ title, text: text || "(empty)" }))
      .catch(() =>
        setPreview({
          title,
          text: "Content is no longer available (it did not survive the reload).",
        }),
      );
  };

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
        {isTextAttachment(part.mediaType, part.filename) ? (
          <button
            type="button"
            onClick={() =>
              openTextPreview(part.filename || "Attachment", () =>
                readAttachmentText(part.url),
              )
            }
            title="Click to view content"
            className="flex min-w-0 flex-col text-left leading-tight"
          >
            <span className="truncate text-foreground text-sm underline-offset-2 hover:underline">
              {part.filename || "Attachment"}
            </span>
            <span className="truncate text-muted-foreground text-xs">
              {typeLabel}
            </span>
          </button>
        ) : (
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-foreground text-sm">
              {part.filename || "Attachment"}
            </span>
            <span className="truncate text-muted-foreground text-xs">
              {typeLabel}
            </span>
          </div>
        )}
        {preview && (
          <TextPreviewOverlay
            title={preview.title}
            text={preview.text}
            onClose={() => setPreview(null)}
          />
        )}
        {isImage && zoomed && (
          <ImageLightbox
            src={part.url}
            alt={part.filename || "attachment"}
            onClose={() => setZoomed(false)}
          />
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

  // A viewport screenshot attached to the page chip (auto-screenshot feature):
  // show it as the card thumbnail with a camera badge so the user can see the
  // screen was captured and sent. Click to enlarge.
  const screenshot =
    typeof part.metadata?.screenshot === "string" &&
    part.metadata.screenshot.startsWith("data:image/")
      ? part.metadata.screenshot
      : undefined;

  return (
    <div className={cardClass}>
      {screenshot ? (
        <button
          type="button"
          onClick={() => setZoomed(true)}
          className={cn(boxClass, "relative cursor-zoom-in p-0")}
          title="Gönderilen ekran görüntüsü — büyütmek için tıkla"
        >
          <img src={screenshot} alt="" className="size-full object-cover" />
          <span className="absolute right-0 bottom-0 flex items-center justify-center rounded-tl-md bg-black/65 p-0.5">
            <CameraIcon className="size-2.5 text-white" />
          </span>
        </button>
      ) : (
        <div className={boxClass}>
          {favIconUrl ? (
            <img src={favIconUrl} alt="" className="size-5 object-contain" />
          ) : (
            <span className="text-base">
              {getContextIcon(part.contextType)}
            </span>
          )}
        </div>
      )}
      {part.value ? (
        <button
          type="button"
          onClick={() => openTextPreview(part.label, async () => part.value)}
          title="Click to view content"
          className="flex min-w-0 flex-col text-left leading-tight"
        >
          <span className="truncate text-foreground text-sm underline-offset-2 hover:underline">
            {part.label}
          </span>
          {subtitle && (
            <span className="truncate text-muted-foreground text-xs">
              {subtitle}
            </span>
          )}
        </button>
      ) : (
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-foreground text-sm">{part.label}</span>
          {subtitle && (
            <span className="truncate text-muted-foreground text-xs">
              {subtitle}
            </span>
          )}
        </div>
      )}
      {preview && (
        <TextPreviewOverlay
          title={preview.title}
          text={preview.text}
          onClose={() => setPreview(null)}
        />
      )}
      {screenshot && zoomed && (
        <ImageLightbox
          src={screenshot}
          alt="Sent screenshot"
          onClose={() => setZoomed(false)}
        />
      )}
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

  // Screenshot placeholder substitution splices multi-MB base64 data URLs
  // into the markdown source, so it must not run in the render body — memoize
  // per parts identity and look results up by part index.
  const processedTextByIndex = useMemo(() => {
    if (screenshotUidList.length === 0) return null;
    const byIndex = new Map<number, string>();
    message.parts.forEach((part, index) => {
      if (part.type !== "text") return;
      let processed = transformScreenshotPlaceholders(
        part.text,
        screenshotUidList,
      );
      for (const [uid, data] of screenshotDataMap) {
        const placeholder = `https://eterna-screenshot.invalid/${uid}`;
        processed = processed.split(placeholder).join(data);
      }
      byIndex.set(index, processed);
    });
    return byIndex;
  }, [message.parts, screenshotUidList, screenshotDataMap]);

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
            const processedText = processedTextByIndex?.get(i) ?? part.text;
            const isAssistant = message.role === "assistant";
            const isLive = isAssistant && isLast && isStreaming;
            return (
              <Fragment key={key}>
                <Message from={message.role as "user" | "assistant" | "system"}>
                  <MessageContent>
                    {isAssistant ? (
                      // beui's shell carries the streaming state (data-state,
                      // aria-busy) around the app's markdown renderer. Its prose
                      // layer is off — Streamdown already styles the content,
                      // and beui's descendant rules would outrank the code
                      // block's own wrapping and copy-button padding. Its action
                      // row is off too; the platform supplies richer ones below.
                      <BeuiStreamingResponse
                        status={isLive ? "streaming" : "complete"}
                        prose={false}
                        showActions={false}
                        announce={false}
                      >
                        <StreamingResponse animate={isLive}>
                          {processedText}
                        </StreamingResponse>
                      </BeuiStreamingResponse>
                    ) : (
                      <StreamingResponse animate={isLive}>
                        {processedText}
                      </StreamingResponse>
                    )}
                  </MessageContent>
                </Message>
                {/* Actions for the last assistant message. Held back until the
                    answer lands so the buttons don't jitter under growing text. */}
                {isAssistant &&
                  isLast &&
                  !isStreaming &&
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
