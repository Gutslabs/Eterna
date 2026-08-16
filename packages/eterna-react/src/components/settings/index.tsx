import {
  AI_PROVIDERS,
  type AIProviderKey,
  type AppSettings,
  type CustomModelConfig,
  changedAppSettings,
  STORAGE_KEYS,
  updateAppSettings,
} from "@eterna/core";
import {
  Bot,
  CheckCircle,
  Info,
  Package,
  Plug,
  Settings,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "../../i18n/context";
import { cn } from "../../lib/utils";
import { useTheme } from "../../theme/context";
import { DEFAULT_MODELS } from "../chatbot/constants";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { SettingsAiTab } from "./ai-tab";
import { SettingsGeneralTab } from "./general-tab";
import {
  createEmptyCustomModel,
  createErrorMessage,
  DEFAULT_MODEL_AUTO_VALUE,
  generateId,
  mergeWithDefaultProviders,
  PROVIDER_KEY_TO_TYPE,
  resolveActiveModel,
  resolveProviderKey,
} from "./model-config";
import type { SaveStatus, SettingsPageProps, SettingsTab } from "./types";

export function SettingsPage({
  storageAdapter,
  storageKey = STORAGE_KEYS.SETTINGS,
  className,
  onSave,
  onTestConnection,
  skillsContent,
  connectionContent,
  sttConfig,
  initialTab,
  initialSkill: _initialSkill,
}: SettingsPageProps) {
  // initialSkill is reserved for future use (pre-select a skill when initialTab="skills")
  void _initialSkill;
  const { t, language, changeLanguage } = useTranslation();
  const { theme, changeTheme, effectiveTheme } = useTheme();

  useEffect(() => {
    const container = document.querySelector("#root");
    if (container) {
      if (effectiveTheme === "dark") {
        container.classList.add("dark");
      } else {
        container.classList.remove("dark");
      }
    }
  }, [effectiveTheme]);

  const [settings, setSettings] = useState<AppSettings>({});
  const settingsBaselineRef = useRef<AppSettings>({});
  const [customModels, setCustomModels] = useState<CustomModelConfig[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({
    type: "",
    message: "",
  });
  const [showToken, setShowToken] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    initialTab ?? "general",
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [dataSharingEnabled, setDataSharingEnabled] = useState(true);

  // ElevenLabs STT state (independent of main settings blob)
  const [sttApiKey, setSttApiKey] = useState("");
  const [sttModelId, setSttModelId] = useState("");
  const [showSttKey, setShowSttKey] = useState(false);
  const [isSavingStt, setIsSavingStt] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const result = await storageAdapter.load(storageKey);
        if (result) {
          const loadedSettings = result as AppSettings;
          let loadedCustomModels = loadedSettings.customModels ?? [];
          const resolvedProviderType =
            loadedSettings.providerType ??
            PROVIDER_KEY_TO_TYPE[loadedSettings.aiProvider as AIProviderKey] ??
            "openai";

          if (
            loadedSettings.byokEnabled &&
            loadedCustomModels.length === 0 &&
            (loadedSettings.aiHost ||
              loadedSettings.aiToken ||
              loadedSettings.aiModel)
          ) {
            loadedCustomModels = [
              {
                id: generateId(),
                name: loadedSettings.aiModel,
                providerType: resolvedProviderType,
                aiHost: loadedSettings.aiHost ?? "",
                aiToken: loadedSettings.aiToken ?? "",
                aiModel: loadedSettings.aiModel ?? "",
                enabled: true,
              },
            ];
          }

          const mergedCustomModels =
            mergeWithDefaultProviders(loadedCustomModels);

          setSettings({
            ...loadedSettings,
            customModels: mergedCustomModels,
            providerType: resolvedProviderType,
            providerEnabled: loadedSettings.providerEnabled ?? false,
          });
          settingsBaselineRef.current = loadedSettings;

          setCustomModels(mergedCustomModels);
          const initialSelection = loadedSettings.byokEnabled
            ? mergedCustomModels.find((model) => model.enabled)?.id ||
              mergedCustomModels[0]?.id ||
              null
            : null;
          setSelectedModelId(initialSelection);

          const loadedDataSharing =
            loadedSettings.dataSharingEnabled !== undefined
              ? loadedSettings.dataSharingEnabled
              : true;
          setDataSharingEnabled(loadedDataSharing);
        }
      } catch (error) {
        console.error("Failed to load settings:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadSettings();
  }, [storageAdapter, storageKey]);

  // Load ElevenLabs STT config when adapter is provided
  useEffect(() => {
    if (!sttConfig) return;
    sttConfig.load().then(({ apiKey, modelId }) => {
      setSttApiKey(apiKey);
      setSttModelId(modelId);
    });
  }, [sttConfig]);

  const updateSettingsFromModel = useCallback((model: CustomModelConfig) => {
    const providerKey = resolveProviderKey(model);
    setSettings((prev: AppSettings) => ({
      ...prev,
      aiHost: model.aiHost,
      aiToken: model.aiToken,
      aiModel: model.aiModel,
      aiProvider: providerKey,
      providerType: model.providerType,
      providerEnabled: (prev.byokEnabled ?? false) && model.enabled,
    }));
  }, []);

  useEffect(() => {
    setSettings((prev: AppSettings) => {
      const byok = prev.byokEnabled ?? false;
      const anyEnabled = byok && customModels.some((model) => model.enabled);
      return {
        ...prev,
        customModels,
        providerEnabled: anyEnabled,
      };
    });
  }, [customModels]);

  useEffect(() => {
    if (!selectedModelId) return;
    const selected = customModels.find((model) => model.id === selectedModelId);
    if (selected) {
      updateSettingsFromModel(selected);
    }
  }, [customModels, selectedModelId, updateSettingsFromModel]);

  const handleSelectModel = useCallback(
    (id: string) => {
      setSelectedModelId(id);
      const target = customModels.find((model) => model.id === id);
      if (target) {
        updateSettingsFromModel(target);
      }
    },
    [customModels, updateSettingsFromModel],
  );

  const handleModelFieldChange = useCallback(
    <K extends keyof CustomModelConfig>(
      key: K,
      value: CustomModelConfig[K],
    ) => {
      if (!selectedModelId) return;
      setCustomModels((prev) => {
        const next = prev.map((model) =>
          model.id === selectedModelId ? { ...model, [key]: value } : model,
        );
        const updated = next.find((model) => model.id === selectedModelId);
        if (updated) {
          updateSettingsFromModel(updated);
        }
        return next;
      });
    },
    [selectedModelId, updateSettingsFromModel],
  );

  const handleAddModel = useCallback(() => {
    const providerType = settings.providerType ?? "openai";
    const newModel = createEmptyCustomModel(providerType);
    setCustomModels((prev) => [...prev, newModel]);
    setSelectedModelId(newModel.id);
    updateSettingsFromModel(newModel);
  }, [settings.providerType, updateSettingsFromModel]);

  const handleDeleteModel = useCallback(
    (id: string) => {
      setCustomModels((prev) => {
        const remaining = prev.filter((model) => model.id !== id);
        const deletedModel = prev.find((model) => model.id === id);
        const nextSelected =
          selectedModelId === id ? (remaining[0]?.id ?? null) : selectedModelId;
        setSelectedModelId(nextSelected);
        if (nextSelected) {
          const nextModel = remaining.find(
            (model) => model.id === nextSelected,
          );
          if (nextModel) {
            updateSettingsFromModel(nextModel);
          }
        } else {
          setSettings((prevSettings: AppSettings) => ({
            ...prevSettings,
            aiHost: "",
            aiToken: "",
            aiModel: "",
            providerEnabled: false,
            defaultModel:
              prevSettings.defaultModel &&
              deletedModel &&
              prevSettings.defaultModel === deletedModel.aiModel
                ? undefined
                : prevSettings.defaultModel,
          }));
        }
        return remaining;
      });
    },
    [selectedModelId, updateSettingsFromModel],
  );

  const handleToggleByok = useCallback(
    (checked: boolean) => {
      setSettings((prev: AppSettings) => ({
        ...prev,
        byokEnabled: checked,
        providerEnabled:
          checked && (prev.customModels ?? customModels).some((m) => m.enabled),
      }));

      if (checked) {
        const seeded = mergeWithDefaultProviders(customModels);
        setCustomModels(seeded);
        if ((!selectedModelId || customModels.length === 0) && seeded[0]) {
          setSelectedModelId(seeded[0].id);
          updateSettingsFromModel(seeded[0]);
        }
      }

      if (!checked) {
        setSelectedModelId(null);
      }
    },
    [customModels, selectedModelId, updateSettingsFromModel],
  );

  const defaultModelOptions = useMemo(() => {
    const baseOptions = DEFAULT_MODELS.map(
      (model: { name: string; value: string }) => ({
        value: model.value,
        label: model.name,
      }),
    );

    const customOptions = customModels
      .filter((model) => model.enabled && model.aiModel.trim())
      .map((model) => ({
        value: model.aiModel,
        label:
          model.name?.trim() ||
          `${model.aiModel} (custom-${model.providerType})`,
      }));

    const seen = new Set<string>();
    const options = [...customOptions, ...baseOptions].filter((option) => {
      if (seen.has(option.value)) return false;
      seen.add(option.value);
      return true;
    });

    if (settings.defaultModel && !seen.has(settings.defaultModel)) {
      options.push({
        value: settings.defaultModel,
        label: settings.defaultModel,
      });
    }

    return options;
  }, [customModels, settings.defaultModel]);

  const handleDefaultModelChange = useCallback((value: string) => {
    setSettings((prev: AppSettings) => ({
      ...prev,
      defaultModel: value === DEFAULT_MODEL_AUTO_VALUE ? undefined : value,
    }));
  }, []);

  const handleSaveSettings = useCallback(async () => {
    setIsSaving(true);
    setSaveStatus({ type: "", message: "" });

    const enabledModels = settings.byokEnabled
      ? customModels.filter((model) => model.enabled)
      : [];

    const availableDefaultModels = new Set(
      defaultModelOptions.map((option) => option.value),
    );
    const resolvedDefaultModel =
      settings.defaultModel && availableDefaultModels.has(settings.defaultModel)
        ? settings.defaultModel
        : undefined;

    if (settings.byokEnabled) {
      const hasIncomplete = enabledModels.some(
        (model) => !model.aiToken || !model.aiModel,
      );
      if (hasIncomplete) {
        setSaveStatus({
          type: "error",
          message: createErrorMessage("fillRequired", language),
        });
        setIsSaving(false);
        return;
      }
    }

    try {
      const {
        activeModel,
        aiHost,
        aiToken,
        aiModel,
        providerType,
        providerKey,
      } = resolveActiveModel(settings, customModels, selectedModelId);

      const settingsToSave = {
        ...settings,
        aiHost,
        aiToken,
        aiModel,
        aiProvider: providerKey,
        providerType,
        providerEnabled:
          settings.byokEnabled && enabledModels.length > 0
            ? (activeModel?.enabled ?? false)
            : false,
        customModels,
        dataSharingEnabled,
        defaultModel: resolvedDefaultModel,
      };
      const savedSettings = await updateAppSettings(
        storageAdapter,
        storageKey,
        changedAppSettings(settingsBaselineRef.current, settingsToSave),
      );
      settingsBaselineRef.current = savedSettings;
      setSettings(savedSettings);
      onSave?.(savedSettings);
      setSaveStatus({
        type: "success",
        message: t("settings.saveSuccess"),
      });
      setTimeout(() => setSaveStatus({ type: "", message: "" }), 3000);
    } catch (error) {
      console.error("Error saving settings:", error);
      setSaveStatus({
        type: "error",
        message: t("settings.saveError"),
      });
    } finally {
      setIsSaving(false);
    }
  }, [
    settings,
    customModels,
    selectedModelId,
    dataSharingEnabled,
    storageAdapter,
    storageKey,
    onSave,
    language,
    t,
    defaultModelOptions,
  ]);

  const handleTestConnection = useCallback(async () => {
    setIsTesting(true);
    setSaveStatus({ type: "", message: "" });

    const { activeModel, aiHost, aiToken, aiModel, providerType, providerKey } =
      resolveActiveModel(settings, customModels, selectedModelId);

    if (settings.byokEnabled && !activeModel) {
      setSaveStatus({
        type: "error",
        message: createErrorMessage("enableOneModel", language),
      });
      setIsTesting(false);
      return;
    }

    if (!aiToken || !aiModel) {
      setSaveStatus({
        type: "error",
        message: createErrorMessage("fillRequired", language),
      });
      setIsTesting(false);
      return;
    }

    try {
      if (!onTestConnection) {
        setSaveStatus({
          type: "error",
          message: "Test connection handler not provided",
        });
        setIsTesting(false);
        return;
      }

      const success = await onTestConnection({
        ...settings,
        aiHost,
        aiToken,
        aiModel,
        aiProvider: providerKey,
        providerType,
        customModels,
      });

      if (success) {
        setSaveStatus({
          type: "success",
          message: t("settings.testSuccess"),
        });
      } else {
        setSaveStatus({
          type: "error",
          message: t("settings.testFailed"),
        });
      }
      setTimeout(() => setSaveStatus({ type: "", message: "" }), 5000);
    } catch (error) {
      console.error("Connection test error:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      setSaveStatus({
        type: "error",
        message: `${t("settings.testFailed")}: ${errorMessage}`,
      });
      setTimeout(() => setSaveStatus({ type: "", message: "" }), 8000);
    } finally {
      setIsTesting(false);
    }
  }, [settings, customModels, selectedModelId, onTestConnection, t, language]);

  const handleReset = useCallback(() => {
    if (confirm(t("settings.resetConfirm"))) {
      setCustomModels([]);
      setSettings({});
      setSelectedModelId(null);
      setSaveStatus({
        type: "info",
        message:
          language === "zh"
            ? "设置已重置，请记得保存"
            : language === "tr"
              ? "Ayarlar sıfırlandı; kaydetmeyi unutma"
              : "Settings reset, remember to save",
      });
    }
  }, [t, language]);

  const handleDataSharingChange = useCallback(
    async (value: string) => {
      const newValue = value === "share";
      setDataSharingEnabled(newValue);

      try {
        const savedSettings = await updateAppSettings(
          storageAdapter,
          storageKey,
          {
            dataSharingEnabled: newValue,
          },
        );
        settingsBaselineRef.current = savedSettings;
      } catch (error) {
        console.error("Error saving data sharing setting:", error);
      }
    },
    [storageAdapter, storageKey],
  );

  const handleSaveStt = useCallback(async () => {
    if (!sttConfig) return;
    setIsSavingStt(true);
    try {
      await sttConfig.save({ apiKey: sttApiKey, modelId: sttModelId });
      setSaveStatus({ type: "success", message: t("settings.saveSuccess") });
      setTimeout(() => setSaveStatus({ type: "", message: "" }), 3000);
    } catch (error) {
      console.error("Error saving STT settings:", error);
      setSaveStatus({ type: "error", message: t("settings.saveError") });
    } finally {
      setIsSavingStt(false);
    }
  }, [sttConfig, sttApiKey, sttModelId, t]);

  const filteredModels = useMemo(() => {
    const term = searchTerm.toLowerCase();
    if (!term) return customModels;
    return customModels.filter((model) => {
      const name = model.name?.toLowerCase() ?? "";
      const modelName = model.aiModel?.toLowerCase() ?? "";
      return name.includes(term) || modelName.includes(term);
    });
  }, [customModels, searchTerm]);

  const selectedModel = selectedModelId
    ? customModels.find((model) => model.id === selectedModelId)
    : undefined;

  const selectedProviderKey: AIProviderKey = selectedModel
    ? resolveProviderKey(selectedModel)
    : ("openai" as AIProviderKey);

  const selectedProviderMeta = AI_PROVIDERS[selectedProviderKey];
  const enabledCustomModelsForActions = customModels.filter(
    (model) => model.enabled,
  );
  const actionModel = selectedModel?.enabled
    ? selectedModel
    : enabledCustomModelsForActions[0];
  const canTest =
    !!actionModel &&
    actionModel.enabled &&
    Boolean(actionModel.aiToken) &&
    Boolean(actionModel.aiModel);
  const canSave =
    !settings.byokEnabled ||
    enabledCustomModelsForActions.length === 0 ||
    canTest;

  if (isLoading) {
    return (
      <div
        className={cn(
          "min-h-screen bg-background flex items-center justify-center",
          className,
        )}
      >
        <Card className="w-80">
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary border-t-transparent mx-auto" />
              <p className="text-muted-foreground">{t("common.processing")}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={cn("min-h-screen bg-background", className)}>
      <div className="max-w-6xl mx-auto py-8 px-4">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Settings className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold">{t("settings.title")}</h1>
          </div>
          <p className="text-muted-foreground">
            {language === "zh"
              ? "配置你的 Eterna 扩展"
              : "Configure your Eterna extension"}
          </p>
        </div>

        {/* Status Message */}
        {saveStatus.message && (
          <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 min-w-[300px] max-w-md">
            <Alert
              variant={saveStatus.type === "error" ? "destructive" : "default"}
              className="animate-in slide-in-from-top"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {saveStatus.type === "success" && (
                    <CheckCircle className="h-4 w-4" />
                  )}
                  {saveStatus.type === "error" && (
                    <XCircle className="h-4 w-4" />
                  )}
                  {saveStatus.type === "info" && <Info className="h-4 w-4" />}
                  <AlertDescription className="font-medium">
                    {saveStatus.message}
                  </AlertDescription>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSaveStatus({ type: "", message: "" })}
                  className="h-6 w-6 p-0"
                >
                  <XCircle className="h-4 w-4" />
                </Button>
              </div>
            </Alert>
          </div>
        )}

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={(value: string) => setActiveTab(value as SettingsTab)}
          className="w-full"
        >
          <TabsList
            className={cn(
              "grid w-full mb-6",
              skillsContent && connectionContent
                ? "grid-cols-4"
                : skillsContent || connectionContent
                  ? "grid-cols-3"
                  : "grid-cols-2",
            )}
          >
            <TabsTrigger value="general" className="flex items-center gap-2">
              <Settings className="h-4 w-4" />
              {t("settings.general")}
            </TabsTrigger>
            <TabsTrigger value="ai" className="flex items-center gap-2">
              <Bot className="h-4 w-4" />
              {t("settings.aiConfiguration")}
            </TabsTrigger>
            {skillsContent && (
              <TabsTrigger value="skills" className="flex items-center gap-2">
                <Package className="h-4 w-4" />
                {t("settings.skillsTab")}
              </TabsTrigger>
            )}
            {connectionContent && (
              <TabsTrigger
                value="connection"
                className="flex items-center gap-2"
              >
                <Plug className="h-4 w-4" />
                {language === "zh" ? "连接" : "Connection"}
              </TabsTrigger>
            )}
          </TabsList>

          <SettingsGeneralTab
            t={t}
            language={language}
            changeLanguage={changeLanguage}
            theme={theme}
            changeTheme={changeTheme}
            dataSharingEnabled={dataSharingEnabled}
            handleDataSharingChange={handleDataSharingChange}
            setSaveStatus={setSaveStatus}
            sttConfig={sttConfig}
            sttApiKey={sttApiKey}
            setSttApiKey={setSttApiKey}
            sttModelId={sttModelId}
            setSttModelId={setSttModelId}
            showSttKey={showSttKey}
            setShowSttKey={setShowSttKey}
            isSavingStt={isSavingStt}
            handleSaveStt={handleSaveStt}
          />

          <SettingsAiTab
            t={t}
            language={language}
            settings={settings}
            handleToggleByok={handleToggleByok}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            filteredModels={filteredModels}
            selectedModel={selectedModel}
            selectedModelId={selectedModelId}
            selectedProviderMeta={selectedProviderMeta}
            handleSelectModel={handleSelectModel}
            handleAddModel={handleAddModel}
            handleDeleteModel={handleDeleteModel}
            handleModelFieldChange={handleModelFieldChange}
            showToken={showToken}
            setShowToken={setShowToken}
            defaultModelOptions={defaultModelOptions}
            handleDefaultModelChange={handleDefaultModelChange}
            canSave={canSave}
            canTest={canTest}
            isSaving={isSaving}
            isTesting={isTesting}
            handleSaveSettings={handleSaveSettings}
            handleTestConnection={handleTestConnection}
            handleReset={handleReset}
          />

          {/* Skills Tab */}
          {skillsContent && (
            <TabsContent value="skills" className="space-y-6">
              {skillsContent}
            </TabsContent>
          )}

          {/* Connection Tab */}
          {connectionContent && (
            <TabsContent value="connection" className="space-y-6">
              {connectionContent}
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  );
}

export type { SettingsPageProps, STTConfigAdapter } from "./types";
