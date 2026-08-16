import {
  CheckCircle,
  ExternalLink,
  Eye,
  EyeOff,
  Github,
  Globe,
  Info,
  Mail,
  MessageCircle,
  Mic,
  Palette,
  Twitter,
  Users,
} from "lucide-react";
import type { Language, TranslationKey } from "../../i18n/types";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { TabsContent } from "../ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import type { SaveStatus, STTConfigAdapter } from "./types";

interface SettingsGeneralTabProps {
  t: (key: TranslationKey) => string;
  language: Language;
  changeLanguage: (language: Language) => void;
  theme: string;
  changeTheme: (theme: "light" | "dark" | "system") => void;
  dataSharingEnabled: boolean;
  handleDataSharingChange: (value: string) => void;
  setSaveStatus: (status: SaveStatus) => void;
  sttConfig?: STTConfigAdapter;
  sttApiKey: string;
  setSttApiKey: (value: string) => void;
  sttModelId: string;
  setSttModelId: (value: string) => void;
  showSttKey: boolean;
  setShowSttKey: (value: boolean) => void;
  isSavingStt: boolean;
  handleSaveStt: () => void;
}

export function SettingsGeneralTab({
  t,
  language,
  changeLanguage,
  theme,
  changeTheme,
  dataSharingEnabled,
  handleDataSharingChange,
  setSaveStatus,
  sttConfig,
  sttApiKey,
  setSttApiKey,
  sttModelId,
  setSttModelId,
  showSttKey,
  setShowSttKey,
  isSavingStt,
  handleSaveStt,
}: SettingsGeneralTabProps) {
  return (
    <>
      {/* General Tab */}
      <TabsContent value="general" className="space-y-6">
        {/* Language Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              {t("settings.language")}
            </CardTitle>
            <CardDescription>
              {language === "zh"
                ? "选择您的首选语言"
                : "Choose your preferred language"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {(["en", "tr", "zh"] as const).map((lang) => (
                <Button
                  key={lang}
                  variant={language === lang ? "default" : "outline"}
                  onClick={() => changeLanguage(lang)}
                  className="h-auto p-4 flex flex-col items-center gap-2"
                >
                  <span className="text-lg">{lang === "en" ? "🇺🇸" : "🇨🇳"}</span>
                  <span className="font-medium">{t(`language.${lang}`)}</span>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Theme Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="h-5 w-5" />
              {t("settings.theme")}
            </CardTitle>
            <CardDescription>
              {language === "zh"
                ? "选择您喜欢的主题"
                : "Choose your preferred theme"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3">
              {(["light", "dark", "system"] as const).map((themeOption) => (
                <Button
                  key={themeOption}
                  variant={theme === themeOption ? "default" : "outline"}
                  onClick={() => changeTheme(themeOption)}
                  className="h-auto p-4 flex flex-col items-center gap-2"
                >
                  <span className="text-2xl">
                    {themeOption === "light" && "☀️"}
                    {themeOption === "dark" && "🌙"}
                    {themeOption === "system" && "💻"}
                  </span>
                  <span className="text-sm font-medium">
                    {t(`theme.${themeOption}`)}
                  </span>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Privacy Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Info className="h-5 w-5" />
              {t("settings.privacy")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="p-4 bg-muted/50 rounded-lg">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex items-center justify-center w-5 h-5 rounded border border-foreground/20">
                      {dataSharingEnabled && (
                        <CheckCircle className="w-3 h-3 text-foreground" />
                      )}
                    </div>
                    <span className="font-medium text-sm">
                      {dataSharingEnabled
                        ? t("settings.dataSharingEnabled")
                        : t("settings.dataSharingDisabled")}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {dataSharingEnabled
                      ? t("settings.dataSharingDescription")
                      : t("settings.privacyModeDescription")}
                  </p>
                </div>
                <Select
                  value={dataSharingEnabled ? "share" : "privacy"}
                  onValueChange={handleDataSharingChange}
                >
                  <SelectTrigger className="w-32 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="share">
                      {language === "zh" ? "共享数据" : "Share Data"}
                    </SelectItem>
                    <SelectItem value="privacy">
                      {language === "zh" ? "隐私模式" : "Privacy Mode"}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ElevenLabs STT Configuration (shown when adapter provided) */}
        {sttConfig && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mic className="h-5 w-5" />
                {language === "zh"
                  ? "ElevenLabs 语音转文本"
                  : "ElevenLabs Speech-to-Text"}
              </CardTitle>
              <CardDescription>
                {language === "zh"
                  ? "配置 ElevenLabs API 密钥以启用语音注释功能"
                  : "Configure ElevenLabs API key to enable voice annotation feature"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="sttApiKey">
                  {language === "zh" ? "API 密钥" : "API Key"}
                  <span className="text-destructive ml-1">*</span>
                </Label>
                <div className="relative">
                  <Input
                    id="sttApiKey"
                    type={showSttKey ? "text" : "password"}
                    value={sttApiKey}
                    onChange={(e) => setSttApiKey(e.target.value)}
                    placeholder="xi-..."
                    className="pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowSttKey(!showSttKey)}
                    className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                  >
                    {showSttKey ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {language === "zh"
                    ? "在 ElevenLabs 获取 API 密钥："
                    : "Get your API key from ElevenLabs:"}{" "}
                  <a
                    href="https://elevenlabs.io/app/developers/api-keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1"
                  >
                    elevenlabs.io
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="sttModelId">
                  {language === "zh"
                    ? "模型 ID（可选）"
                    : "Model ID (Optional)"}
                </Label>
                <Input
                  id="sttModelId"
                  type="text"
                  value={sttModelId}
                  onChange={(e) => setSttModelId(e.target.value)}
                  placeholder={
                    language === "zh"
                      ? "留空使用默认模型"
                      : "Leave blank to use default model"
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {language === "zh"
                    ? "默认使用通用多语言模型。如需指定特定模型，请输入模型 ID。"
                    : "Default uses the general multilingual model. Specify a model ID if needed."}
                </p>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={handleSaveStt}
                  disabled={isSavingStt}
                  size="sm"
                >
                  {isSavingStt ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2" />
                      {language === "zh" ? "保存中..." : "Saving..."}
                    </>
                  ) : language === "zh" ? (
                    "保存配置"
                  ) : (
                    "Save Configuration"
                  )}
                </Button>
                {sttApiKey && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSttApiKey("");
                      setSaveStatus({
                        type: "info",
                        message:
                          language === "zh"
                            ? "已清空，点击保存以生效"
                            : "Cleared. Click Save to apply.",
                      });
                    }}
                  >
                    {language === "zh" ? "清空" : "Clear"}
                  </Button>
                )}
              </div>

              {sttApiKey && (
                <Alert>
                  <AlertDescription className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <span className="text-sm">
                      {language === "zh"
                        ? "API 密钥已配置"
                        : "API key is configured"}
                    </span>
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        )}

        {/* About Us Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              {t("settings.aboutUs")}
            </CardTitle>
            <CardDescription>{t("settings.aboutDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button asChild size="icon" variant="default">
                  <a
                    href="https://github.com/EternaStudio/Eterna"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Github className="h-4 w-4" />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t("settings.starOnGithub")}</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button asChild size="icon" variant="outline">
                  <a
                    href="https://discord.gg/sfZC3G5qfe"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <MessageCircle className="h-4 w-4" />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t("settings.joinDiscord")}</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button asChild size="icon" variant="outline">
                  <a href="mailto:eternaassistant@gmail.com">
                    <Mail className="h-4 w-4" />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t("settings.sendEmail")}</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button asChild size="icon" variant="outline">
                  <a
                    href="https://x.com/weikangzhang3"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Twitter className="h-4 w-4" />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t("settings.followTwitter")}</p>
              </TooltipContent>
            </Tooltip>
          </CardContent>
        </Card>
      </TabsContent>
    </>
  );
}
