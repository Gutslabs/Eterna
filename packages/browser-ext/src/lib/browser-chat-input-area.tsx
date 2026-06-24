/**
 * BrowserChatInputArea
 * Renders VoiceInput when inputMode is "voice", otherwise the default text InputArea.
 *
 * VoiceInput pulls in three.js (particle visualization) and the VAD stack, so
 * it is loaded lazily — text-mode chats never pay for it.
 *
 * Every submit passes through withYoutubeTranscriptChunk: when a YouTube video
 * is attached as context, the next 10-minute transcript window rides along
 * with the message.
 */

import type { ContextItem } from "@aipexstudio/aipex-react/components/ai-elements/prompt-input";
import { useChatContext } from "@aipexstudio/aipex-react/components/chatbot";
import {
  DefaultInputArea,
  type ExtendedInputAreaProps,
} from "@aipexstudio/aipex-react/components/chatbot/components";
import type {
  InputAreaProps,
  MessageAttachment,
} from "@aipexstudio/aipex-react/types";
import { lazy, Suspense, useCallback, useRef } from "react";
import {
  CURRENT_PAGE_CONTEXT_ID,
  readActivePageContext,
} from "./browser-context-loader";
import { useInputMode } from "./input-mode-context";
import { withYoutubeTranscriptChunk } from "./youtube-transcript-feed";

const VoiceInput = lazy(() =>
  import("@aipexstudio/aipex-react/components/voice").then((module) => ({
    default: module.VoiceInput,
  })),
);

export function BrowserChatInputArea(props: InputAreaProps) {
  const { inputMode, setInputMode } = useInputMode();
  const { messages } = useChatContext();
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const onSubmitRef = useRef(props.onSubmit);
  onSubmitRef.current = props.onSubmit;

  const handleSubmit = useCallback(
    async (
      text: string,
      files?: MessageAttachment[],
      contexts?: ContextItem[],
    ) => {
      // The composer hides the page chip on an EMPTY conversation (the
      // welcome page-card represents it) — guarantee the page context rides
      // along for that first send. Must run before the transcript chunk
      // step, which finds the YouTube video through this context's url
      // metadata. Once the conversation has messages the chip is
      // user-controlled: a missing chip means the user removed it with X,
      // and silently re-attaching the page would override that choice.
      let withPage = contexts;
      const conversationEmpty = !messagesRef.current.some(
        (m) => m.role !== "system",
      );
      if (
        conversationEmpty &&
        !contexts?.some((item) => item.id === CURRENT_PAGE_CONTEXT_ID)
      ) {
        const page = await readActivePageContext().catch(() => null);
        if (page) {
          withPage = [page, ...(contexts ?? [])];
        }
      }
      const enriched = await withYoutubeTranscriptChunk(
        withPage,
        messagesRef.current,
      );
      onSubmitRef.current(text, files, enriched);
    },
    [],
  );

  const handleTranscript = useCallback(
    (text: string) => {
      // Send the transcribed text as a message
      void handleSubmit(text);
    },
    [handleSubmit],
  );

  const handleSwitchToText = useCallback(() => {
    setInputMode("text");
  }, [setInputMode]);

  if (inputMode === "voice") {
    const isStreaming =
      props.status === "streaming" || props.status === "submitted";

    return (
      <div className="flex-1 overflow-hidden">
        <Suspense fallback={<div className="h-full" />}>
          <VoiceInput
            onTranscript={handleTranscript}
            isPaused={isStreaming}
            onSwitchToText={handleSwitchToText}
          />
        </Suspense>
      </div>
    );
  }

  // Text mode: render the default input area, forwarding all props
  return (
    <DefaultInputArea
      {...(props as ExtendedInputAreaProps)}
      onSubmit={handleSubmit}
    />
  );
}
