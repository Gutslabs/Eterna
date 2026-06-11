/**
 * Chat input toolbar
 *
 * Renders the trailing controls of the prompt input: a token-usage indicator
 * and the submit/stop button.
 */

import type { InputToolbarSlotProps } from "@aipexstudio/aipex-react";
import { TokenUsageIndicator } from "@aipexstudio/aipex-react/components/chatbot";
import { Button } from "@aipexstudio/aipex-react/components/ui/button";
import { Loader2Icon, SendIcon, SquareIcon, XIcon } from "lucide-react";

export function ChatInputToolbar({
  status,
  onStop,
  onSubmit,
}: InputToolbarSlotProps) {
  let submitIcon = <SendIcon className="size-4" />;
  let submitLabel = "Send";

  if (status === "submitted") {
    submitIcon = <Loader2Icon className="size-4 animate-spin" />;
    submitLabel = "Sending...";
  } else if (status === "streaming") {
    submitIcon = <SquareIcon className="size-4" />;
    submitLabel = "Stop";
  } else if (status === "error") {
    submitIcon = <XIcon className="size-4" />;
    submitLabel = "Error";
  }

  const handleSubmitClick = () => {
    if (status === "streaming") {
      onStop?.();
    } else {
      onSubmit?.();
    }
  };

  return (
    <div className="flex items-center gap-1">
      <TokenUsageIndicator compact />

      <Button
        aria-label={submitLabel}
        className="gap-1.5 rounded-lg"
        size="icon"
        type={status === "streaming" ? "button" : "submit"}
        variant="default"
        onClick={status === "streaming" ? handleSubmitClick : undefined}
      >
        {submitIcon}
      </Button>
    </div>
  );
}
