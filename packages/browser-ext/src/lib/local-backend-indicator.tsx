import { useConfigContext } from "@aipexstudio/aipex-react/components/chatbot";
import { cn } from "@aipexstudio/aipex-react/lib/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  localBackendForModel,
  probeLocalBackend,
} from "./local-backend-status";

type ProbeState = "checking" | "online" | "offline";

export function LocalBackendIndicator() {
  const { settings } = useConfigContext();
  const backend = useMemo(
    () => localBackendForModel(settings.aiModel),
    [settings.aiModel],
  );
  const [state, setState] = useState<ProbeState>("checking");
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string>();
  const probeGenerationRef = useRef(0);
  const retryTimerRef = useRef<number | undefined>(undefined);

  const check = useCallback(
    async (force = false) => {
      if (!backend) return;
      const generation = ++probeGenerationRef.current;
      setState("checking");
      const reachable = await probeLocalBackend(settings.aiModel, { force });
      if (generation === probeGenerationRef.current) {
        setState(reachable ? "online" : "offline");
      }
    },
    [backend, settings.aiModel],
  );

  useEffect(() => {
    if (!backend) return;
    void check();
    const timer = window.setInterval(() => void check(true), 15_000);
    return () => {
      probeGenerationRef.current += 1;
      window.clearInterval(timer);
      if (retryTimerRef.current !== undefined) {
        window.clearTimeout(retryTimerRef.current);
      }
    };
  }, [backend, check]);

  if (!backend) return null;

  const launch = async () => {
    setLaunching(true);
    setLaunchError(undefined);
    try {
      const result = (await chrome.runtime.sendMessage({
        request: "launch-eterna-terminal",
      })) as { success?: boolean; error?: string; setupCommand?: string };
      if (!result?.success) {
        const setup = result?.setupCommand
          ? ` Setup: ${result.setupCommand}`
          : "";
        setLaunchError(
          `${result?.error ?? "Could not open Terminal."}${setup}`,
        );
        return;
      }
      retryTimerRef.current = window.setTimeout(() => void check(true), 3000);
    } catch (error) {
      setLaunchError(error instanceof Error ? error.message : String(error));
    } finally {
      setLaunching(false);
    }
  };

  const label = launching
    ? "Starting Eterna"
    : state === "checking"
      ? `${backend.label} checking`
      : `${backend.label} ${state}`;

  return (
    <button
      type="button"
      onClick={() => (state === "offline" ? void launch() : void check(true))}
      disabled={launching}
      aria-label={
        state === "offline"
          ? `${label}. Click to open Terminal and run Eterna.`
          : `${label}. Click to retry.`
      }
      title={
        launchError ??
        (state === "offline"
          ? "Open Terminal and run eterna"
          : `${label} — click to retry`)
      }
      className={cn(
        "inline-flex min-h-7 items-center gap-1.5 rounded-full border border-border px-2 text-xs transition-colors hover:bg-accent/50",
        state === "offline" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full",
          state === "online" && "bg-success",
          state === "offline" && "bg-destructive",
          (state === "checking" || launching) &&
            "animate-pulse bg-muted-foreground",
        )}
      />
      <span>
        {launching
          ? "Starting…"
          : state === "offline"
            ? "Start Eterna"
            : backend.label}
      </span>
    </button>
  );
}
