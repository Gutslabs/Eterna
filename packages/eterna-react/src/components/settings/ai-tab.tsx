import type {
  AIProviderKey,
  AppSettings,
  CustomModelConfig,
  ProviderType,
} from "@eterna/core";
import { AI_PROVIDERS } from "@eterna/core";
import { ExternalLink, Eye, EyeOff, Plus, Search, Trash2 } from "lucide-react";
import type { Language, TranslationKey } from "../../i18n/types";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Switch } from "../ui/switch";
import { TabsContent } from "../ui/tabs";
import { DEFAULT_MODEL_AUTO_VALUE, resolveProviderKey } from "./model-config";

interface SettingsAiTabProps {
  t: (key: TranslationKey) => string;
  language: Language;
  settings: AppSettings;
  handleToggleByok: (enabled: boolean) => void;
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  filteredModels: CustomModelConfig[];
  selectedModel: CustomModelConfig | undefined;
  selectedModelId: string | null;
  selectedProviderMeta: (typeof AI_PROVIDERS)[AIProviderKey];
  handleSelectModel: (id: string) => void;
  handleAddModel: () => void;
  handleDeleteModel: (id: string) => void;
  handleModelFieldChange: (
    field: keyof CustomModelConfig,
    value: string | boolean | ProviderType,
  ) => void;
  showToken: boolean;
  setShowToken: (value: boolean) => void;
  defaultModelOptions: Array<{ value: string; label: string }>;
  handleDefaultModelChange: (value: string) => void;
  canSave: boolean;
  canTest: boolean;
  isSaving: boolean;
  isTesting: boolean;
  handleSaveSettings: () => void;
  handleTestConnection: () => void;
  handleReset: () => void;
}

export function SettingsAiTab({
  t,
  language,
  settings,
  handleToggleByok,
  searchTerm,
  setSearchTerm,
  filteredModels,
  selectedModel,
  selectedModelId,
  selectedProviderMeta,
  handleSelectModel,
  handleAddModel,
  handleDeleteModel,
  handleModelFieldChange,
  showToken,
  setShowToken,
  defaultModelOptions,
  handleDefaultModelChange,
  canSave,
  canTest,
  isSaving,
  isTesting,
  handleSaveSettings,
  handleTestConnection,
  handleReset,
}: SettingsAiTabProps) {
  return (
    <>
      {/* AI Configuration Tab */}
      <TabsContent value="ai" className="space-y-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <h3 className="text-lg font-semibold">
                  {language === "zh" ? "默认模型" : "Default model"}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {language === "zh"
                    ? "新建会话优先使用该模型；未选择时使用列表首个可用模型"
                    : "New chats start with this model; otherwise use the first available"}
                </p>
              </div>
              <Select
                value={settings.defaultModel || DEFAULT_MODEL_AUTO_VALUE}
                onValueChange={handleDefaultModelChange}
              >
                <SelectTrigger className="w-full sm:w-64">
                  <SelectValue
                    placeholder={
                      language === "zh"
                        ? "使用列表首个模型"
                        : "Use first available"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={DEFAULT_MODEL_AUTO_VALUE}>
                    {language === "zh"
                      ? "使用列表首个模型"
                      : "Use first available"}
                  </SelectItem>
                  {defaultModelOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* BYOK Toggle */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <h3 className="text-lg font-semibold mb-1">
                  {t("settings.byok")}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {t("settings.byokDescription")}
                </p>
              </div>
              <div className="ml-6">
                <Switch
                  checked={settings.byokEnabled || false}
                  onCheckedChange={handleToggleByok}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* AI Configuration - Only show when BYOK is enabled */}
        {settings.byokEnabled && (
          <Card className="overflow-hidden">
            <div className="flex" style={{ minHeight: "500px" }}>
              {/* Left Sidebar - Custom Model List */}
              <div className="w-72 border-r flex flex-col">
                {/* Search + Add */}
                <div className="p-3 border-b space-y-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="text"
                      value={searchTerm}
                      placeholder={t("settings.searchProviders")}
                      className="pl-9"
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={handleAddModel}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    {language === "zh" ? "新增模型" : "Add Model"}
                  </Button>
                </div>

                {/* Model List */}
                <div className="flex-1 overflow-y-auto">
                  {filteredModels.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground space-y-3">
                      <Search className="w-12 h-12 mx-auto text-muted-foreground" />
                      <p className="text-sm">
                        {t("settings.noProvidersFound")}
                      </p>
                      <Button size="sm" onClick={handleAddModel}>
                        {language === "zh" ? "创建模型" : "Create model"}
                      </Button>
                    </div>
                  ) : (
                    filteredModels.map((model) => {
                      const providerKey = resolveProviderKey(model);
                      const provider = AI_PROVIDERS[providerKey];
                      const isSelected = selectedModelId === model.id;
                      const displayName =
                        model.name?.trim() ||
                        model.aiModel ||
                        provider.name ||
                        t("settings.aiModel");

                      return (
                        <div
                          key={model.id}
                          className={cn(
                            "flex items-center group border-b border-border/40",
                            isSelected ? "bg-primary/5" : "",
                          )}
                        >
                          <Button
                            variant="ghost"
                            onClick={() => handleSelectModel(model.id)}
                            className={cn(
                              "w-full justify-start h-auto p-4 border-l-2 rounded-none text-left",
                              isSelected
                                ? "border-primary bg-primary/5"
                                : "border-transparent",
                            )}
                          >
                            <div className="flex items-center w-full gap-3">
                              <div
                                className={cn(
                                  "w-8 h-8 rounded-lg flex items-center justify-center text-lg",
                                  isSelected ? "bg-primary/10" : "bg-muted",
                                )}
                              >
                                {provider.icon}
                              </div>
                              <div className="flex-1">
                                <div className="text-sm font-medium">
                                  {displayName}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {provider.name}
                                </div>
                              </div>
                              {model.enabled && (
                                <Badge variant="default">
                                  {t("settings.current")}
                                </Badge>
                              )}
                            </div>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => handleDeleteModel(model.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Right Panel - Configuration Details */}
              <div className="flex-1 flex flex-col">
                {/* Header */}
                <div className="p-6 border-b">
                  <div className="flex items-center justify-between">
                    {selectedModel ? (
                      <>
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center text-3xl">
                            {selectedProviderMeta.icon}
                          </div>
                          <div>
                            <h3 className="text-xl font-semibold">
                              {selectedModel.name?.trim() ||
                                selectedModel.aiModel ||
                                t("settings.aiModel")}
                            </h3>
                            <p className="text-sm text-muted-foreground">
                              {selectedProviderMeta.name}
                            </p>
                            {selectedProviderMeta.docs && (
                              <Button
                                variant="link"
                                size="sm"
                                asChild
                                className="h-auto p-0"
                              >
                                <a
                                  href={selectedProviderMeta.docs}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1"
                                >
                                  {t("settings.getApiKey")}
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              </Button>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground">
                            {language === "zh" ? "启用" : "Enable"}
                          </span>
                          <Switch
                            checked={selectedModel.enabled}
                            onCheckedChange={(checked) =>
                              handleModelFieldChange("enabled", checked)
                            }
                          />
                        </div>
                      </>
                    ) : (
                      <div className="text-muted-foreground">
                        {language === "zh"
                          ? "选择或创建一个模型以开始配置"
                          : "Select or create a model to configure"}
                      </div>
                    )}
                  </div>
                </div>

                {/* Configuration Form */}
                <div className="flex-1 overflow-y-auto p-6 space-y-5">
                  {selectedModel ? (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="modelName">
                          {language === "zh" ? "展示名称" : "Display Name"}
                        </Label>
                        <Input
                          id="modelName"
                          type="text"
                          value={selectedModel.name || ""}
                          onChange={(e) =>
                            handleModelFieldChange("name", e.target.value)
                          }
                          placeholder={
                            language === "zh"
                              ? "可选，用于下拉展示"
                              : "Optional display name"
                          }
                        />
                      </div>

                      {/* Provider Type */}
                      <div className="space-y-2">
                        <Label>
                          {language === "zh"
                            ? "Provider 类型"
                            : "Provider Type"}
                          <span className="text-destructive ml-1">*</span>
                        </Label>
                        <Select
                          value={selectedModel.providerType}
                          onValueChange={(value: ProviderType) =>
                            handleModelFieldChange("providerType", value)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="openai">OpenAI</SelectItem>
                            <SelectItem value="claude">Claude</SelectItem>
                            <SelectItem value="google">Google</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* API Host */}
                      <div className="space-y-2">
                        <Label htmlFor="aiHost">{t("settings.aiHost")}</Label>
                        <Input
                          id="aiHost"
                          type="url"
                          value={selectedModel.aiHost || ""}
                          onChange={(e) =>
                            handleModelFieldChange("aiHost", e.target.value)
                          }
                          placeholder={
                            "host" in selectedProviderMeta
                              ? (selectedProviderMeta.host ?? "")
                              : ""
                          }
                        />
                      </div>

                      {/* API Token */}
                      <div className="space-y-2">
                        <Label htmlFor="aiToken">
                          {t("settings.aiToken")}
                          <span className="text-destructive ml-1">*</span>
                        </Label>
                        <div className="relative">
                          <Input
                            id="aiToken"
                            type={showToken ? "text" : "password"}
                            value={selectedModel.aiToken || ""}
                            onChange={(e) =>
                              handleModelFieldChange("aiToken", e.target.value)
                            }
                            placeholder={selectedProviderMeta.tokenPlaceholder}
                            className="pr-10"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setShowToken(!showToken)}
                            className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                          >
                            {showToken ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>

                      {/* Model Selection */}
                      <div className="space-y-2">
                        <Label htmlFor="aiModel">
                          {t("settings.aiModel")}
                          <span className="text-destructive ml-1">*</span>
                        </Label>
                        {selectedProviderMeta.models.length > 0 ? (
                          <Select
                            value={selectedModel.aiModel || ""}
                            onValueChange={(value: string) =>
                              handleModelFieldChange("aiModel", value)
                            }
                          >
                            <SelectTrigger>
                              <SelectValue
                                placeholder={t("settings.modelPlaceholder")}
                              />
                            </SelectTrigger>
                            <SelectContent>
                              {selectedProviderMeta.models.map(
                                (model: string) => (
                                  <SelectItem key={model} value={model}>
                                    {model}
                                  </SelectItem>
                                ),
                              )}
                              {/* Allow keeping a custom value that is not in the preset list */}
                              {selectedModel.aiModel &&
                                !selectedProviderMeta.models.includes(
                                  selectedModel.aiModel as never,
                                ) && (
                                  <SelectItem value={selectedModel.aiModel}>
                                    {selectedModel.aiModel}
                                  </SelectItem>
                                )}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            id="aiModel"
                            type="text"
                            value={selectedModel.aiModel || ""}
                            onChange={(e) =>
                              handleModelFieldChange("aiModel", e.target.value)
                            }
                            placeholder={t("settings.modelPlaceholder")}
                          />
                        )}
                        <p className="text-xs text-muted-foreground">
                          {language === "zh"
                            ? "提示: 选择适合你需求的模型。"
                            : "Tip: Choose a model that fits your needs."}
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="text-center text-muted-foreground py-12">
                      {language === "zh"
                        ? "左侧选择或创建模型以配置"
                        : "Select or create a model on the left to configure"}
                    </div>
                  )}
                </div>

                {/* Action Buttons - Footer */}
                <div className="p-6 border-t bg-muted/50">
                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      onClick={handleTestConnection}
                      disabled={isTesting || !canTest}
                      className="flex-1"
                    >
                      {isTesting ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent mr-2" />
                          {t("settings.testing")}
                        </>
                      ) : (
                        t("settings.testConnection")
                      )}
                    </Button>

                    <Button
                      onClick={handleSaveSettings}
                      disabled={isSaving || !canSave}
                      className="flex-1"
                    >
                      {isSaving ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2" />
                          {t("common.saving")}
                        </>
                      ) : (
                        t("common.save")
                      )}
                    </Button>

                    <Button
                      variant="outline"
                      onClick={handleReset}
                      disabled={isSaving}
                    >
                      {t("settings.reset")}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        )}
      </TabsContent>
    </>
  );
}
