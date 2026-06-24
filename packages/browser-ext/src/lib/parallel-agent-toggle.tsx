/**
 * Parallel-agent toggle — a single pill next to the model selector. When on,
 * the orchestrator may fan a research request out to parallel background
 * subagents (run_subagent); when off, it never does. Off by default.
 *
 * Only shown for models that can actually issue parallel requests
 * (gemini/grok/codex); on the single-thread web gateways it renders nothing.
 */

import { STORAGE_KEYS } from "@aipexstudio/aipex-core";
import { useConfigContext } from "@aipexstudio/aipex-react/components/chatbot";
import { cn } from "@aipexstudio/aipex-react/lib/utils";
import { useStorage } from "@aipexstudio/browser-runtime/hooks";
import { supportsParallelSubagents } from "./ai-provider";

function ParallelIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 21v-9" />
      <path d="M12 12 7 6" />
      <path d="M12 12l5-6" />
      <circle cx="7" cy="4" r="1.6" />
      <circle cx="17" cy="4" r="1.6" />
    </svg>
  );
}

export function ParallelAgentToggle() {
  const { settings } = useConfigContext();
  const [enabled, setEnabled] = useStorage<boolean>(
    STORAGE_KEYS.PARALLEL_AGENT,
    false,
  );

  // Hidden on models that can't run parallel requests — the toggle would do
  // nothing there.
  if (!supportsParallelSubagents(settings.aiModel)) {
    return null;
  }

  const active = enabled === true;

  return (
    <button
      type="button"
      onClick={() => void setEnabled(!active)}
      aria-pressed={active}
      title={
        active
          ? "Parallel agent açık — araştırma parallel arka plan agent'larına dağıtılır"
          : "Parallel agent kapalı — tek model yanıtlar"
      }
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors",
        active
          ? "border border-border bg-accent font-medium text-foreground"
          : "border border-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      <ParallelIcon />
      Parallel agent
    </button>
  );
}
