import { useConfigContext } from "@eterna/react/components/chatbot";
import { cn } from "@eterna/react/lib/utils";
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
    // Skip ticks while the document is hidden — an invisible indicator does
    // not need a fresh localhost probe every 15s; the visibility flip
    // re-probes immediately so the state is current when it can be seen.
    const timer = window.setInterval(() => {
      if (!document.hidden) void check(true);
    }, 15_000);
    const onVisible = () => {
      if (!document.hidden) void check(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      probeGenerationRef.current += 1;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
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

  // A healthy backend is not news AT ALL: render nothing. Only an error
  // state (offline, or mid-launch recovery) earns composer space — as a red
  // dot with the action. The probe keeps running while hidden.
  const actionable = launching || state === "offline";
  if (!actionable) return null;
  const label = launching
    ? "Starting Eterna"
    : state === "checking"
      ? "Local backend checking"
      : `Local backend ${state}`;

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
        "inline-flex min-h-7 items-center gap-1.5 rounded-full border border-border text-xs transition-colors hover:bg-accent/50",
        actionable ? "px-2" : "px-1.5",
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
      {actionable ? (
        <span>{launching ? "Starting…" : "Start Eterna"}</span>
      ) : null}
    </button>
  );
}
