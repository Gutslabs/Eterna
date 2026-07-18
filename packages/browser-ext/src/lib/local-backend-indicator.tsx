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
  const probeGenerationRef = useRef(0);

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
    };
  }, [backend, check]);

  if (!backend) return null;

  const label =
    state === "checking"
      ? `${backend.label} checking`
      : `${backend.label} ${state}`;

  return (
    <button
      type="button"
      onClick={() => void check(true)}
      aria-label={`${label}. Click to retry.`}
      title={`${label} — click to retry`}
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
          state === "checking" && "animate-pulse bg-muted-foreground",
        )}
      />
      <span>{state === "offline" ? "Offline" : backend.label}</span>
    </button>
  );
}
