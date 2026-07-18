/**
 * Auto-screenshot toggle — a small status pill in the composer next to the
 * model selector / parallel-agent toggle.
 *
 * When ON, a compressed screenshot of the user's current viewport
 * is attached to every message, so the model always sees exactly what's on
 * screen — great for "what does this say", manga/comics, dashboards, designs.
 * The screenshot is transient (never persisted to history). Turn it off to save
 * tokens or for privacy. State is shown by the eye / eye-off icon and label;
 * the tooltip explains the exact behavior.
 */

import { STORAGE_KEYS } from "@aipexstudio/aipex-core";
import { cn } from "@aipexstudio/aipex-react/lib/utils";
import { useStorage } from "@aipexstudio/browser-runtime/hooks";
import { EyeIcon, EyeOffIcon } from "lucide-react";

export function AutoScreenshotToggle() {
  const [enabled, setEnabled] = useStorage<boolean>(
    STORAGE_KEYS.AUTO_ATTACH_SCREENSHOT,
    false,
  );

  // Privacy-first: screen sharing starts only after the user enables it.
  const active = enabled === true;

  return (
    <button
      type="button"
      onClick={() => void setEnabled(!active)}
      aria-pressed={active}
      aria-label="Screen context"
      title={
        active
          ? "Screen context is on — the visible page is sent with each message"
          : "Screen context is off — the model receives page text only"
      }
      className={cn(
        "inline-flex min-h-7 items-center justify-center gap-1.5 rounded-full px-2 text-xs transition-colors",
        active
          ? "border border-border bg-accent text-foreground"
          : "border border-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      {active ? (
        <EyeIcon className="size-4" />
      ) : (
        <EyeOffIcon className="size-4" />
      )}
      <span>Screen</span>
    </button>
  );
}
