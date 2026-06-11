/**
 * ModelPicker
 *
 * The model selector shown in the composer toolbar. Instead of one long
 * provider-grouped list, the panel puts the providers in a segmented control
 * at the top and shows only the active provider's models below — a short,
 * ~230px panel that fits ~5 rows before scrolling. The selected model is marked
 * with a check. Opening the panel jumps to the tab that holds the current
 * selection.
 */

import {
  CheckIcon,
  ChevronDownIcon,
  KeyRoundIcon,
  SparklesIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "../../../lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";

/**
 * Provider glyphs for the tab strip. Distinct monochrome marks (currentColor)
 * so the tabs read at a glance instead of truncating to "Ope…" / "Cla…". Each
 * tab still carries the provider name as a tooltip / active-tab label, so the
 * mark only needs to be a recognizable anchor, not a pixel-perfect logo.
 */
function ProviderIcon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const svg = (children: ReactNode, props?: ComponentProps<"svg">) => (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );

  switch (name.toLowerCase()) {
    case "openai":
      // Hexagon — a nod to OpenAI's six-fold mark.
      return svg(
        <path
          d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />,
      );
    case "claude":
    case "anthropic":
      // Radial burst — Anthropic's sunburst.
      return svg(
        <path
          d="M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9L4.9 19.1"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />,
      );
    case "gemini":
    case "google":
      // Four-point spark — Gemini's star.
      return svg(
        <path
          d="M12 1c.5 5.8 4.7 10 10.5 11C16.7 13 12.5 17.2 12 23c-.5-5.8-4.7-10-10.5-11C7.3 11 11.5 6.8 12 1z"
          fill="currentColor"
        />,
      );
    case "grok":
    case "xai":
      // Angular X — xAI / Grok.
      return svg(
        <path d="M2 2h5l15 20h-5zM17 2h5L7 22H2z" fill="currentColor" />,
      );
    case "byok":
      return <KeyRoundIcon className={className} aria-hidden="true" />;
    default:
      return <SparklesIcon className={className} aria-hidden="true" />;
  }
}

export interface ModelEntry {
  name: string;
  value: string;
}

export interface ModelTab {
  key: string;
  label: string;
  models: ModelEntry[];
}

interface ModelPickerProps {
  value: string;
  onChange: (value: string) => void;
  tabs: ModelTab[];
  disabled?: boolean;
  loading?: boolean;
}

// Roughly five default DropdownMenuItem rows (~32px each) before the list
// scrolls — enough to keep the panel short while hinting at more below.
const LIST_MAX_HEIGHT = 168;

export function ModelPicker({
  value,
  onChange,
  tabs,
  disabled,
  loading,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);

  const tabOfValue = useMemo(
    () =>
      tabs.find((tab) => tab.models.some((m) => m.value === value))?.key ??
      tabs[0]?.key ??
      "",
    [tabs, value],
  );
  const [activeKey, setActiveKey] = useState(tabOfValue);

  // Jump to the tab holding the current selection each time the panel opens.
  useEffect(() => {
    if (open) setActiveKey(tabOfValue);
  }, [open, tabOfValue]);

  const currentLabel = useMemo(() => {
    for (const tab of tabs) {
      const match = tab.models.find((m) => m.value === value);
      if (match) return match.name;
    }
    return value || "Model";
  }, [tabs, value]);

  const activeTab = tabs.find((tab) => tab.key === activeKey) ?? tabs[0];

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        disabled={disabled || loading}
        className={cn(
          "flex w-fit cursor-pointer items-center gap-1 rounded-md bg-transparent px-2 py-1 font-medium text-muted-foreground text-sm outline-hidden transition-colors",
          "hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground",
          "disabled:pointer-events-none disabled:opacity-50",
        )}
      >
        <span className="max-w-[160px] truncate">
          {loading ? "Loading…" : currentLabel}
        </span>
        <ChevronDownIcon className="size-3.5 shrink-0 opacity-50" />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={6}
        className="w-[230px] p-1.5"
      >
        {tabs.length > 1 && (
          <div className="mb-1 flex gap-0.5 rounded-lg bg-muted/60 p-0.5">
            {tabs.map((tab) => {
              const active = tab.key === activeKey;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveKey(tab.key)}
                  title={tab.label}
                  aria-label={tab.label}
                  aria-pressed={active}
                  // The active tab expands to show its name; the rest stay as
                  // compact icon buttons. This never truncates and scales as
                  // more providers are added.
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-md py-1 font-medium text-xs outline-hidden transition-colors",
                    active
                      ? "flex-1 bg-background px-2 text-foreground shadow-sm"
                      : "shrink-0 px-2 text-muted-foreground hover:text-foreground",
                  )}
                >
                  <ProviderIcon name={tab.key} className="size-3.5 shrink-0" />
                  {active && <span className="truncate">{tab.label}</span>}
                </button>
              );
            })}
          </div>
        )}

        <div className="overflow-y-auto" style={{ maxHeight: LIST_MAX_HEIGHT }}>
          {activeTab?.models.map((model) => (
            <DropdownMenuItem
              key={model.value}
              onSelect={() => onChange(model.value)}
              className="justify-between gap-2"
            >
              <span className="truncate">{model.name}</span>
              {model.value === value && (
                <CheckIcon className="size-4 shrink-0 opacity-80" />
              )}
            </DropdownMenuItem>
          ))}
          {!activeTab?.models.length && (
            <div className="px-2 py-1.5 text-muted-foreground text-sm">
              No models
            </div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
