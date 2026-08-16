/**
 * Chat input toolbar
 *
 * Renders the trailing controls of the prompt input: a token-usage indicator
 * and the submit/stop button.
 */

import type { InputToolbarSlotProps } from "@eterna/react";
import { TokenUsageIndicator } from "@eterna/react/components/chatbot";
import { Loader2Icon, SendIcon, SquareIcon, XIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button } from "@/components/motion/button";
import { SPRING_SWAP } from "@/lib/ease";

export function ChatInputToolbar({
  status,
  onStop,
  onSubmit,
}: InputToolbarSlotProps) {
  const reduce = useReducedMotion() ?? false;
  let submitIcon = <SendIcon className="size-4" />;
  let submitLabel = "Send";

  if (status === "submitted") {
    submitIcon = <Loader2Icon className="size-4 animate-spin" />;
    submitLabel = "Sending...";
  } else if (status === "streaming") {
    submitIcon = <SquareIcon className="size-4 fill-current" />;
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
        className="size-8 rounded-full"
        size="icon"
        type={status === "streaming" ? "button" : "submit"}
        variant="primary"
        onClick={status === "streaming" ? handleSubmitClick : undefined}
      >
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={status ?? "idle"}
            initial={reduce ? { opacity: 1 } : { opacity: 0, y: 3, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -3, scale: 0.8 }}
            transition={reduce ? { duration: 0 } : SPRING_SWAP}
            className="grid place-items-center"
          >
            {submitIcon}
          </motion.span>
        </AnimatePresence>
      </Button>
    </div>
  );
}
