/**
 * SettingsOverlay
 *
 * In-sidebar settings, built to the "Sidebar Settings Panel" mock: the history
 * page's shell (back + title + close) with a 4-tab segmented nav underneath —
 * General / AI / Skills / Bridge. Every desktop card is collapsed to a single
 * row; the AI tab is a connector list (ChatGPT subscription + BYOK providers)
 * that drills into a per-provider form with Test/Save pinned at the bottom.
 *
 * Loaded lazily (React.lazy) from the header — the provider forms, skill
 * manager and file tree are not part of the chat's first paint.
 */

import { cn } from "@eterna/react/lib/utils";
import { ArrowLeftIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { ScheduledAutomationsPanel } from "./scheduled-automations-panel";
import { type AiDetail, AiTab } from "./settings-overlay/ai-tab";
import { BridgeTab } from "./settings-overlay/bridge-tab";
import { GeneralTab } from "./settings-overlay/general-tab";
import { SkillsTab } from "./settings-overlay/skills-tab";

type TabKey = "general" | "ai" | "automations" | "skills" | "bridge";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "general", label: "General" },
  { key: "ai", label: "AI" },
  { key: "automations", label: "Automations" },
  { key: "skills", label: "Skills" },
  { key: "bridge", label: "Bridge" },
];

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

interface SettingsOverlayProps {
  onClose: () => void;
}

export default function SettingsOverlay({ onClose }: SettingsOverlayProps) {
  const [tab, setTab] = useState<TabKey>("general");
  const [aiDetail, setAiDetail] = useState<AiDetail | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (aiDetail) setAiDetail(null);
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [aiDetail, onClose]);

  const inDetail = tab === "ai" && aiDetail !== null;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-background text-foreground">
      {!inDetail && (
        <>
          <div className="flex shrink-0 items-center justify-between border-border/60 border-b px-2.5 py-[9px]">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onClose}
                aria-label="Back"
                className="flex size-7 items-center justify-center rounded-[7px] text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <ArrowLeftIcon className="size-[15px]" />
              </button>
              <span className="font-semibold text-[13px] text-foreground">
                Settings
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex size-7 items-center justify-center rounded-[7px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <XIcon className="size-3.5" />
            </button>
          </div>

          <div className="mx-3 mt-2.5 mb-1 flex shrink-0 gap-[2px] rounded-[9px] bg-muted/60 p-[3px]">
            {TABS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setTab(key);
                  setAiDetail(null);
                }}
                className={cn(
                  "flex-1 rounded-md py-[5px] text-center text-[11.5px] transition-colors",
                  tab === key
                    ? "bg-background font-semibold text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {tab === "general" && <GeneralTab />}
        {tab === "ai" && <AiTab detail={aiDetail} setDetail={setAiDetail} />}
        {tab === "automations" && <ScheduledAutomationsPanel />}
        {tab === "skills" && <SkillsTab />}
        {tab === "bridge" && <BridgeTab />}
      </div>
    </div>
  );
}
