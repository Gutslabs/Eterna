/**
 * BrowserMessageActions
 * Custom message actions for the browser extension.
 * Renders Retry, Copy, and Save as Skill inline with each last
 * assistant message.
 */

import { Action, Actions } from "@eterna/react/components/ai-elements/actions";
import { useChatContext } from "@eterna/react/components/chatbot";
import type { MessageActionsSlotProps } from "@eterna/react/types";
import { CopyIcon, PuzzleIcon, RefreshCcwIcon } from "lucide-react";
import { useCallback } from "react";

export function BrowserMessageActions({
  message,
  onRegenerate,
  onCopy,
}: MessageActionsSlotProps) {
  const { sendMessage } = useChatContext();

  const textContent = message.parts
    .filter((p) => p.type === "text")
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("\n");

  const handleSaveAsSkill = useCallback(() => {
    sendMessage("use skill-creator skill to save the conversation");
  }, [sendMessage]);

  return (
    <Actions className="mt-2">
      {onCopy && textContent && (
        <Action onClick={() => onCopy(textContent)} tooltip="Copy">
          <CopyIcon className="size-3" />
        </Action>
      )}
      <Action onClick={handleSaveAsSkill} tooltip="Save as Skill">
        <PuzzleIcon className="size-3" />
      </Action>
      {onRegenerate && (
        <Action onClick={onRegenerate} tooltip="Retry">
          <RefreshCcwIcon className="size-3" />
        </Action>
      )}
    </Actions>
  );
}
