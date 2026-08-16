import { cn } from "@eterna/react/lib/utils";
import { useCallback, useEffect, useState } from "react";
import { PrimaryButton } from "./shared";

// ---------------------------------------------------------------------------
// Bridge tab
// ---------------------------------------------------------------------------

type BridgeStatus = "disconnected" | "connecting" | "connected" | "error";

export function BridgeTab() {
  const [url, setUrl] = useState("ws://localhost:9223");
  const [status, setStatus] = useState<BridgeStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const state = await chrome.runtime.sendMessage({
        request: "ws-bridge-status",
      });
      if (state) {
        setStatus(state.status as BridgeStatus);
        setError(state.error ?? null);
        if (state.url) setUrl(state.url as string);
      }
    } catch {
      // Background may not be ready yet.
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    const interval = setInterval(() => void refreshStatus(), 3000);
    return () => clearInterval(interval);
  }, [refreshStatus]);

  const handleConnect = async () => {
    setError(null);
    try {
      const response = await chrome.runtime.sendMessage({
        request: "ws-bridge-connect",
        url,
      });
      if (!response?.success) setError(response?.error || "Connection failed");
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDisconnect = async () => {
    try {
      await chrome.runtime.sendMessage({ request: "ws-bridge-disconnect" });
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const pill: Record<BridgeStatus, { label: string; dot: string }> = {
    disconnected: { label: "Off", dot: "bg-muted-foreground/70" },
    connecting: { label: "Connecting", dot: "bg-amber-400 animate-pulse" },
    connected: { label: "On", dot: "bg-emerald-400" },
    error: { label: "Error", dot: "bg-red-400" },
  };

  return (
    <div className="flex flex-col gap-3 px-3 pt-3 pb-4">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/20 p-3.5">
        <div className="flex items-start justify-between gap-2.5">
          <div>
            <div className="mb-[3px] font-semibold text-[13px] text-foreground">
              MCP WebSocket Bridge
            </div>
            <div className="text-[11.5px] text-muted-foreground leading-[1.5]">
              Expose Eterna's browser tools to external MCP clients like Claude
              or Cursor.
            </div>
          </div>
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-muted/50 px-2.5 py-1">
            <span className={cn("size-1.5 rounded-full", pill[status].dot)} />
            <span className="text-[11px] text-muted-foreground">
              {pill[status].label}
            </span>
          </span>
        </div>

        <div className="flex flex-col gap-[5px]">
          <div className="text-[11.5px] text-muted-foreground">
            Bridge address
          </div>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={status === "connected" || status === "connecting"}
            placeholder="ws://localhost:9223"
            className="rounded-[9px] border border-border bg-muted/30 px-2.5 py-2 font-mono text-[12px] text-foreground outline-none placeholder:text-muted-foreground/70 disabled:opacity-60"
          />
        </div>

        {status === "connected" ? (
          <button
            type="button"
            onClick={() => void handleDisconnect()}
            className="rounded-[9px] border border-border py-[9px] text-center font-semibold text-[12.5px] text-foreground/80 hover:border-muted-foreground/50 hover:text-foreground"
          >
            Disconnect
          </button>
        ) : (
          <PrimaryButton
            onClick={() => void handleConnect()}
            disabled={status === "connecting" || !url.trim()}
            className="py-[9px] text-[12.5px]"
          >
            {status === "connecting" ? "Connecting…" : "Connect"}
          </PrimaryButton>
        )}

        {error && (
          <div className="rounded-[9px] border border-red-500/25 bg-red-500/10 px-2.5 py-2 text-[11.5px] text-red-400">
            {error}
          </div>
        )}
      </div>

      <div className="px-1 text-[10.5px] text-muted-foreground/80 leading-[1.6]">
        Exposes{" "}
        <span className="font-mono text-muted-foreground">tools/list</span> and{" "}
        <span className="font-mono text-muted-foreground">tools/call</span> over
        MCP. Only localhost connections (127.0.0.1, ::1) are allowed.
      </div>
    </div>
  );
}
