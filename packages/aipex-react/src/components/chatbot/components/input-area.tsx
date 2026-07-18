import { AI_PROVIDERS } from "@aipexstudio/aipex-core";
import type { ChatStatus } from "ai";
import { ClockIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "../../../i18n/context";
import { fetchModelsForSelector, onModelListChange } from "../../../lib/models";
import { cn } from "../../../lib/utils";
import type { ContextItem, InputAreaProps } from "../../../types";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputChips,
  type PromptInputMessage,
  PromptInputSkillTag,
  PromptInputSkillTags,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from "../../ai-elements/prompt-input";
import { DEFAULT_MODELS } from "../constants";
import { useComponentsContext, useConfigContext } from "../context";
import {
  createGptWebModelEntries,
  normalizeGptWebModelValue,
} from "./gpt-web-models";
import { type ModelEntry, ModelPicker } from "./model-picker";

export interface ExtendedInputAreaProps extends InputAreaProps {
  /** Available models for selection (used as fallback if API fetch fails) */
  models?: Array<{ name: string; value: string }>;
  /** Placeholder texts for typing animation */
  placeholderTexts?: string[];
  /** Message queue count */
  queueCount?: number;
}

const PROVIDER_ORDER = ["OpenAI", "Claude", "Gemini", "Grok", "Other"] as const;
type ProviderName = (typeof PROVIDER_ORDER)[number];

/** Bucket a model id under its provider for grouped display in the selector. */
function providerOf(value: string): ProviderName {
  const v = value.toLowerCase();
  if (v.includes("claude") || v.startsWith("anthropic/")) return "Claude";
  if (v.includes("gemini") || v.startsWith("google/")) return "Gemini";
  if (v.includes("grok") || v.startsWith("x-ai/") || v.startsWith("xai/")) {
    return "Grok";
  }
  if (v.includes("gpt") || v.startsWith("openai/") || /^o\d/.test(v)) {
    return "OpenAI";
  }
  return "Other";
}

/**
 * Default InputArea component
 */
export function DefaultInputArea({
  value,
  onChange,
  onSubmit,
  onStop,
  status,
  placeholder,
  disabled = false,
  models = DEFAULT_MODELS,
  placeholderTexts,
  queueCount = 0,
  className,
  ...props
}: ExtendedInputAreaProps) {
  const { t } = useTranslation();
  const { slots } = useComponentsContext();
  const { settings, updateSettings } = useConfigContext();

  const effectivePlaceholder = placeholder ?? t("input.placeholder1");

  // Fetch model list from API on mount (self-contained, no prop dependency)
  const [fetchedModels, setFetchedModels] = useState<Array<{
    name: string;
    value: string;
  }> | null>(null);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingModels(true);
    fetchModelsForSelector()
      .then((serverModels) => {
        if (!cancelled && serverModels.length > 0) {
          setFetchedModels(serverModels);
        }
      })
      .catch(() => {
        // Fallback to prop-provided models (used via `models` below)
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingModels(false);
        }
      });

    // Subscribe to background model list updates (e.g. server returned newer data)
    const unsubscribe = onModelListChange((updatedModels) => {
      if (!cancelled) {
        setFetchedModels(
          updatedModels.map((m) => ({ name: m.name, value: m.id })),
        );
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const enabledCustomModels = useMemo(() => {
    // Always collect enabled BYOK models regardless of byokEnabled flag,
    // so they appear in the BYOK group even when proxy mode is active.
    return (settings.customModels ?? []).filter((model) => model.enabled);
  }, [settings.customModels]);

  // Server-side (AIPex) models: API-fetched or prop fallback
  const serverModels = fetchedModels ?? models;

  // BYOK model entries formatted for the selector
  const byokModelEntries = useMemo(
    () =>
      enabledCustomModels.map((model) => ({
        name:
          model.name?.trim() ||
          `${model.aiModel} (custom-${model.providerType})`,
        value: model.aiModel,
      })),
    [enabledCustomModels],
  );

  // Subscription models (Codex OAuth) and local-gateway web sessions are shown
  // as separate groups, but combined for default-model resolution / dedup.
  const subscriptionModelEntries = useMemo(
    () => AI_PROVIDERS.chatgpt.models.map((id) => ({ name: id, value: id })),
    [],
  );
  const gatewayModelEntries = useMemo(() => {
    const labels: Record<string, string> = {
      "catgpt-browser": "gpt-web",
      "claude-browser": "claude-web",
    };
    // Drop the bare "gpt-web" (catgpt-browser with no mode) — it's covered by
    // the gpt-web Instant/Medium/High entries below and does nothing on its own.
    // catgpt-browser stays a valid base in CATGPT_GATEWAY_MODELS, so the moded
    // values still route through the gateway.
    return AI_PROVIDERS.catgptGateway.models
      .filter((id) => id !== "catgpt-browser")
      .map((id) => ({
        name: labels[id] ?? id,
        value: id,
      }));
  }, []);
  // Gemini via the local CLIProxyAPI Antigravity OAuth proxy (OpenAI-compatible).
  const geminiGatewayEntries = useMemo(
    () => [
      { name: "Gemini 3.1 Pro", value: "gemini-3.1-pro-low" },
      { name: "Gemini 3 Flash", value: "gemini-3-flash" },
    ],
    [],
  );
  // Grok via the same local OAuth proxy (xAI / Grok Build account).
  const grokGatewayEntries = useMemo(
    () => [
      { name: "Grok 4.3", value: "grok-4.3" },
      { name: "Grok 4.20 (Reasoning)", value: "grok-4.20-0309-reasoning" },
      { name: "Grok Build 0.1", value: "grok-build-0.1" },
      { name: "Composer 2.5", value: "grok-composer-2.5-fast" },
    ],
    [],
  );
  // Claude via the same local CLIProxyAPI proxy (Claude Code OAuth). The real
  // API path — full tools, streaming and parallel subagents — distinct from the
  // web-UI-driven `claude-browser` entries below.
  const claudeGatewayEntries = useMemo(
    () => [
      { name: "Claude Opus 4.8", value: "claude-opus-4-8" },
      { name: "Claude Sonnet 4.6", value: "claude-sonnet-4-6" },
      { name: "Claude Haiku 4.5", value: "claude-haiku-4-5-20251001" },
    ],
    [],
  );
  // Claude web sub-models routed through the gateway. The value encodes the
  // gateway model switch as "claude-browser::<Model>|<Effort>".
  const claudeSubModelEntries = useMemo(
    () => [
      {
        name: "Claude Opus 4.8 (web · High)",
        value: "claude-browser::Opus 4.8|High",
      },
      {
        name: "Claude Opus 4.8 (web · Max)",
        value: "claude-browser::Opus 4.8|Max",
      },
      { name: "Claude Sonnet 4.6 (web)", value: "claude-browser::Sonnet 4.6" },
      { name: "Claude Haiku 4.5 (web)", value: "claude-browser::Haiku 4.5" },
    ],
    [],
  );
  // ChatGPT web now exposes model family and Intelligence as separate menus.
  // Encode both as "::<Family>|<Intelligence>" for the local gateway, while
  // the picker groups each family's three Intelligence levels in a submenu.
  const gptWebModelEntries = useMemo(() => createGptWebModelEntries(), []);

  useEffect(() => {
    const aiModel = settings.aiModel?.trim();
    const defaultModel = settings.defaultModel?.trim();
    const normalizedAiModel = aiModel
      ? normalizeGptWebModelValue(aiModel)
      : undefined;
    const normalizedDefaultModel = defaultModel
      ? normalizeGptWebModelValue(defaultModel)
      : undefined;
    const updates: { aiModel?: string; defaultModel?: string } = {};

    if (normalizedAiModel && normalizedAiModel !== settings.aiModel) {
      updates.aiModel = normalizedAiModel;
    }
    if (
      normalizedDefaultModel &&
      normalizedDefaultModel !== settings.defaultModel
    ) {
      updates.defaultModel = normalizedDefaultModel;
    }
    if (updates.aiModel || updates.defaultModel) {
      void updateSettings(updates);
    }
  }, [settings.aiModel, settings.defaultModel, updateSettings]);
  const chatgptModelEntries = useMemo(
    () => [
      ...subscriptionModelEntries,
      ...gatewayModelEntries,
      ...geminiGatewayEntries,
      ...grokGatewayEntries,
      ...claudeGatewayEntries,
      ...claudeSubModelEntries,
      ...gptWebModelEntries,
    ],
    [
      subscriptionModelEntries,
      gatewayModelEntries,
      geminiGatewayEntries,
      grokGatewayEntries,
      claudeGatewayEntries,
      claudeSubModelEntries,
      gptWebModelEntries,
    ],
  );

  // Group the curated, usable models (Codex subscription + local gateways +
  // Gemini proxy) by provider for the selector. Server/proxy models are
  // intentionally excluded — they require AIPex-proxy auth we don't have, so
  // showing them would just list models the user can't actually use.
  const providerGroups = useMemo(() => {
    const groups: Record<ProviderName, ModelEntry[]> = {
      OpenAI: [],
      Claude: [],
      Gemini: [],
      Grok: [],
      Other: [],
    };
    const seen = new Set<string>();
    for (const model of [
      ...subscriptionModelEntries,
      ...gatewayModelEntries,
      ...geminiGatewayEntries,
      ...grokGatewayEntries,
      ...claudeGatewayEntries,
      ...claudeSubModelEntries,
      ...gptWebModelEntries,
    ]) {
      if (seen.has(model.value)) continue;
      seen.add(model.value);
      groups[providerOf(model.value)].push(model);
    }
    return groups;
  }, [
    subscriptionModelEntries,
    gatewayModelEntries,
    geminiGatewayEntries,
    grokGatewayEntries,
    claudeGatewayEntries,
    claudeSubModelEntries,
    gptWebModelEntries,
  ]);

  // Provider segments for the model picker: one per provider that has models,
  // plus a BYOK segment when the user added their own keys.
  const modelTabs = useMemo(() => {
    const tabs = PROVIDER_ORDER.filter(
      (provider) => providerGroups[provider].length > 0,
    ).map((provider) => ({
      key: provider as string,
      label: provider as string,
      models: providerGroups[provider],
    }));
    if (byokModelEntries.length > 0) {
      tabs.push({ key: "BYOK", label: "BYOK", models: byokModelEntries });
    }
    return tabs;
  }, [providerGroups, byokModelEntries]);

  // Flat list of all models for resolvedDefaultModel and the slot API.
  // BYOK models first so the current BYOK selection resolves correctly.
  const effectiveModels = useMemo(() => {
    const reserved = new Set([
      ...chatgptModelEntries.map((m) => m.value),
      ...byokModelEntries.map((m) => m.value),
    ]);
    const dedupedServer = serverModels.filter((m) => !reserved.has(m.value));
    const combined = [
      ...chatgptModelEntries,
      ...byokModelEntries,
      ...dedupedServer,
    ];

    // If the user's current model is not in any group, prepend it as a custom entry
    const currentModel = normalizeGptWebModelValue(
      settings.aiModel?.trim() ?? "",
    );
    if (currentModel && !combined.some((m) => m.value === currentModel)) {
      return [
        { name: `${currentModel} (Custom)`, value: currentModel },
        ...combined,
      ];
    }

    return combined;
  }, [chatgptModelEntries, byokModelEntries, serverModels, settings.aiModel]);

  const resolvedDefaultModel = useMemo(() => {
    const candidates = [
      normalizeGptWebModelValue(settings.defaultModel?.trim() ?? ""),
      normalizeGptWebModelValue(settings.aiModel?.trim() ?? ""),
      effectiveModels[0]?.value,
    ].filter(Boolean) as string[];

    for (const candidate of candidates) {
      if (effectiveModels.some((model) => model.value === candidate)) {
        return candidate;
      }
    }

    return "";
  }, [effectiveModels, settings.aiModel, settings.defaultModel]);

  const [selectedModel, setSelectedModel] =
    useState<string>(resolvedDefaultModel);

  useEffect(() => {
    setSelectedModel(resolvedDefaultModel);
  }, [resolvedDefaultModel]);

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      // One message per response: while the assistant is working, Enter and
      // the submit button must not queue another send (the button already
      // acts as Stop; this also blocks the form's Enter path). The draft
      // stays in the input so nothing the user typed is lost.
      if (status !== "idle" && status !== "error") {
        return;
      }

      const hasText = Boolean(message.text);
      const hasAttachments = Boolean(message.files?.length);
      const hasContexts = Boolean(message.contexts?.length);

      if (!(hasText || hasAttachments || hasContexts)) {
        return;
      }

      // Attachments from PromptInput are already processed file parts that
      // carry their own (data:) URL, so they pass straight through.
      onSubmit(
        message.text || "",
        message.files,
        message.contexts as ContextItem[] | undefined,
      );
    },
    [onSubmit, status],
  );

  const handleModelChange = useCallback(
    (newModel: string) => {
      const trimmed = newModel?.trim();
      if (!trimmed) return;

      // Skip if unchanged
      if (trimmed === selectedModel) return;

      setSelectedModel(trimmed);

      // Check if the selected model belongs to the BYOK group
      const customConfig = enabledCustomModels.find(
        (m) => m.aiModel === trimmed,
      );

      if (customConfig) {
        // BYOK model selected → switch to BYOK mode with this config
        void updateSettings({
          aiModel: trimmed,
          aiToken: customConfig.aiToken,
          aiHost: customConfig.aiHost ?? "",
          providerType: customConfig.providerType,
          byokEnabled: true,
        });
        return;
      }

      // Server (AIPex) model selected → switch to proxy mode
      void updateSettings({ aiModel: trimmed, byokEnabled: false });
    },
    [selectedModel, enabledCustomModels, updateSettings],
  );

  // Map status to ChatStatus type
  const submitStatus: ChatStatus | undefined =
    status === "idle" ? undefined : (status as ChatStatus);

  return (
    <div className={cn("p-3", className)} {...props}>
      {slots.inputHeader?.()}
      <PromptInput
        onSubmit={handleSubmit}
        className="mt-0 divide-y-0 rounded-2xl border-border bg-card shadow-lg shadow-black/20"
        globalDrop
        multiple
      >
        <PromptInputBody>
          {/* Context items + file attachments share a single chip row */}
          <PromptInputChips />

          {/* Skill Tags */}
          <PromptInputSkillTags>
            {(skill) => <PromptInputSkillTag data={skill} />}
          </PromptInputSkillTags>

          {/* Platform-specific extras (e.g., context/skill data loaders) */}
          {slots.promptExtras?.()}

          {/* Textarea */}
          <PromptInputTextarea
            placeholder={effectivePlaceholder}
            enableTypingAnimation={Boolean(placeholderTexts?.length)}
            placeholderTexts={placeholderTexts}
            onChange={(e) => onChange(e.target.value)}
            value={value}
            disabled={disabled}
          />

          {/* Queue indicator */}
          {queueCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground bg-muted/50 rounded-md mt-2">
              <ClockIcon className="size-4" />
              <span>
                {queueCount} message{queueCount > 1 ? "s" : ""} queued
              </span>
            </div>
          )}
        </PromptInputBody>

        <PromptInputToolbar>
          <PromptInputTools>
            {/* Action Menu */}
            <PromptInputActionMenu>
              <PromptInputActionMenuTrigger />
              <PromptInputActionMenuContent>
                <PromptInputActionAddAttachments />
              </PromptInputActionMenuContent>
            </PromptInputActionMenu>

            {/* Model Selector */}
            {slots.modelSelector ? (
              slots.modelSelector({
                value: selectedModel,
                onChange: handleModelChange,
                models: effectiveModels,
              })
            ) : (
              <ModelPicker
                value={selectedModel}
                onChange={handleModelChange}
                tabs={modelTabs}
                loading={isLoadingModels}
              />
            )}

            {/* Extra composer controls (e.g. parallel-agent toggle) */}
            {slots.composerTools?.()}
          </PromptInputTools>

          {/* Submit/Stop Button */}
          {slots.inputToolbar ? (
            slots.inputToolbar({
              status,
              onStop,
              onSubmit: () => {
                /* handled by form */
              },
            })
          ) : (
            <PromptInputSubmit
              disabled={!value && !submitStatus}
              status={submitStatus}
              // PromptInputSubmit is type="submit", so for ANY non-idle status
              // (submitted, streaming, executing_tools, error) it must cancel
              // the form submit and Stop/interrupt instead. Otherwise clicking
              // it sends the draft — and since the page context is persistent,
              // even an empty draft submits a card-only message rather than
              // stopping. Only the idle state actually sends.
              onClick={
                status !== "idle"
                  ? (e) => {
                      e.preventDefault();
                      onStop?.();
                    }
                  : undefined
              }
            />
          )}
        </PromptInputToolbar>
      </PromptInput>
    </div>
  );
}

/**
 * InputArea - Renders either custom or default input area
 */
export function InputArea(props: ExtendedInputAreaProps) {
  const { components } = useComponentsContext();

  const CustomComponent = components.InputArea;
  if (CustomComponent) {
    return <CustomComponent {...props} />;
  }

  return <DefaultInputArea {...props} />;
}
