import {
  CameraIcon,
  FileTextIcon,
  LayersIcon,
  ScanSearchIcon,
  SearchIcon,
} from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "../../../i18n/context";
import { cn } from "../../../lib/utils";
import type { WelcomeScreenProps, WelcomeSuggestion } from "../../../types";
import { Suggestion, Suggestions } from "../../ai-elements/suggestion";
import { useComponentsContext } from "../context";

/**
 * Build i18n-driven default suggestions matching legacy AIPex layout.
 */
function useDefaultSuggestions(): WelcomeSuggestion[] {
  const { t } = useTranslation();

  return useMemo(
    () => [
      {
        icon: FileTextIcon,
        text: t("welcome.analyzePage"),
        iconColor: "text-green-600",
        bgColor: "bg-green-100",
      },
      {
        icon: LayersIcon,
        text: t("welcome.organizeTabs"),
        iconColor: "text-blue-600",
        bgColor: "bg-blue-100",
      },
      {
        icon: SearchIcon,
        text: t("welcome.research"),
        iconColor: "text-purple-600",
        bgColor: "bg-purple-100",
      },
      {
        icon: CameraIcon,
        text: t("welcome.screenRecording"),
        iconColor: "text-orange-600",
        bgColor: "bg-orange-100",
      },
      {
        icon: ScanSearchIcon,
        text: t("welcome.uxAuditGoal"),
        iconColor: "text-cyan-600",
        bgColor: "bg-cyan-100",
        isUxAudit: true,
      },
    ],
    [t],
  );
}

/**
 * Default WelcomeScreen component
 */
export function DefaultWelcomeScreen({
  onSuggestionClick,
  onUxAuditClick,
  suggestions,
  className,
  ...props
}: WelcomeScreenProps) {
  const { t } = useTranslation();
  const defaultSuggestions = useDefaultSuggestions();
  const effectiveSuggestions = suggestions ?? defaultSuggestions;

  return (
    <div
      className={cn(
        "flex h-full flex-col items-center justify-center p-6",
        className,
      )}
      {...props}
    >
      <div className="mb-6 text-center">
        <h3 className="mb-1 font-semibold text-base text-foreground">
          {t("welcome.title")}
        </h3>
        <p className="text-muted-foreground text-sm">{t("welcome.subtitle")}</p>
      </div>

      <div className="w-full max-w-md">
        <Suggestions className="flex w-full flex-col gap-2">
          {effectiveSuggestions.map((suggestion) => {
            const Icon = suggestion.icon;
            // For UX audit suggestion, use the special handler if available
            const handleClick =
              suggestion.isUxAudit && onUxAuditClick
                ? () => onUxAuditClick()
                : onSuggestionClick;
            return (
              <Suggestion
                key={suggestion.text}
                suggestion={suggestion.text}
                onClick={handleClick}
                variant="ghost"
                size="lg"
                className={cn(
                  "h-auto w-full items-center justify-start gap-3 rounded-xl p-3 text-left",
                  "transition-colors duration-200 hover:bg-accent",
                )}
              >
                {Icon && (
                  <Icon className="size-4 flex-shrink-0 text-muted-foreground" />
                )}
                <span className="flex-1 whitespace-normal break-words text-foreground/90 text-sm">
                  {suggestion.text}
                </span>
              </Suggestion>
            );
          })}
        </Suggestions>
      </div>
    </div>
  );
}

/**
 * WelcomeScreen - Renders either custom or default welcome screen
 */
export function WelcomeScreen(props: WelcomeScreenProps) {
  const { components, slots } = useComponentsContext();

  // Check for slot override first
  if (slots.emptyState) {
    return <>{slots.emptyState(props)}</>;
  }

  // Check for component override
  const CustomComponent = components.WelcomeScreen;
  if (CustomComponent) {
    return <CustomComponent {...props} />;
  }

  // Use default
  return <DefaultWelcomeScreen {...props} />;
}
