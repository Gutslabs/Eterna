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

import {
  AI_PROVIDERS,
  type AIProviderKey,
  type AppSettings,
  type CustomModelConfig,
  detectProviderFromHost,
  type ProviderType,
  STORAGE_KEYS,
} from "@aipexstudio/aipex-core";
import { useTranslation } from "@aipexstudio/aipex-react/i18n/context";
import type { Language } from "@aipexstudio/aipex-react/i18n/types";
import { cn } from "@aipexstudio/aipex-react/lib/utils";
import { useTheme } from "@aipexstudio/aipex-react/theme/context";
import type { FileTreeNode } from "@aipexstudio/browser-runtime";
import { zenfs } from "@aipexstudio/browser-runtime";
import type { LanguageModel } from "ai";
import { generateText } from "ai";
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EyeIcon,
  EyeOffIcon,
  FileIcon,
  FolderIcon,
  PlusIcon,
  SearchIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import {
  type ChangeEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SkillMetadata } from "../components/skill/types";
import { chromeStorageAdapter } from "../hooks";
import { CHATGPT_MODELS, createAIProvider } from "./ai-provider";
import { skillClientAdapter } from "./skill-client-adapter";

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

type TabKey = "general" | "ai" | "skills" | "bridge";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "general", label: "General" },
  { key: "ai", label: "AI" },
  { key: "skills", label: "Skills" },
  { key: "bridge", label: "Bridge" },
];

const PROVIDER_TYPE_LABELS: Record<ProviderType, string> = {
  openai: "OpenAI-compatible",
  claude: "Anthropic",
  google: "Google",
};

const PROVIDER_TYPE_TO_KEY: Record<ProviderType, AIProviderKey> = {
  openai: "openai",
  google: "google",
  claude: "anthropic",
};

/** Provider presets offered in the Available list, in mock order. */
const AVAILABLE_PRESETS: AIProviderKey[] = [
  "anthropic",
  "google",
  "openai",
  "openrouter",
  "deepseek",
  "groq",
  "together",
  "mistral",
  "cohere",
  "perplexity",
  "fireworks",
  "replicate",
  "azure",
];

const loadSettings = async (): Promise<AppSettings> =>
  ((await chromeStorageAdapter.load(STORAGE_KEYS.SETTINGS)) as
    | AppSettings
    | undefined) ?? {};

const saveSettings = async (settings: AppSettings): Promise<void> => {
  await chromeStorageAdapter.save(STORAGE_KEYS.SETTINGS, settings);
};

const formatKb = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(1)} KB`;

function SectionLabel({
  children,
  trailing,
}: {
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-0.5 pt-1.5 pb-1.5">
      <span className="font-medium text-[10px] text-muted-foreground uppercase tracking-[0.07em]">
        {children}
      </span>
      {trailing}
    </div>
  );
}

function MiniToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex h-5 w-[34px] shrink-0 rounded-full p-[2px] transition-colors",
        checked ? "justify-end bg-foreground" : "justify-start bg-muted",
      )}
    >
      <span
        className={cn(
          "size-4 rounded-full",
          checked ? "bg-background" : "bg-muted-foreground/70",
        )}
      />
    </button>
  );
}

function TextField({
  label,
  required,
  hint,
  value,
  onChange,
  placeholder,
  mono,
  secret,
}: {
  label: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  mono?: boolean;
  secret?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex flex-col gap-[5px]">
      <div className="px-0.5 text-[11.5px] text-muted-foreground">
        {label}
        {required && <span className="text-red-400"> *</span>}
      </div>
      <div className="flex items-center gap-2 rounded-[9px] border border-border bg-muted/30 px-2.5 py-2 focus-within:border-muted-foreground/40">
        <input
          type={secret && !show ? "password" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={cn(
            "min-w-0 flex-1 bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground/70",
            mono && "font-mono text-[12px]",
          )}
        />
        {secret && (
          <button
            type="button"
            aria-label={show ? "Hide" : "Show"}
            onClick={() => setShow((s) => !s)}
            className="text-muted-foreground hover:text-foreground"
          >
            {show ? (
              <EyeOffIcon className="size-[13px]" />
            ) : (
              <EyeIcon className="size-[13px]" />
            )}
          </button>
        )}
      </div>
      {hint && (
        <div className="px-0.5 text-[10.5px] text-muted-foreground/80">
          {hint}
        </div>
      )}
    </div>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
  className,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-[9px] bg-foreground px-3.5 py-2 text-center font-semibold text-[12px] text-background transition-opacity hover:opacity-90 disabled:opacity-50",
        className,
      )}
    >
      {children}
    </button>
  );
}

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-[9px] border border-border bg-muted/30 px-2.5 py-[7px]">
      <SearchIcon className="size-[13px] shrink-0 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground/70"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// General tab
// ---------------------------------------------------------------------------

function GeneralTab() {
  const { language, changeLanguage } = useTranslation();
  const { theme, changeTheme } = useTheme();
  const [privacyMode, setPrivacyMode] = useState(false);
  const [sttKey, setSttKey] = useState("");
  const [sttModel, setSttModel] = useState("");
  const [sttSaved, setSttSaved] = useState(false);

  useEffect(() => {
    void loadSettings().then((s) => {
      setPrivacyMode(s.dataSharingEnabled === false);
    });
    void chrome.storage.local
      .get(["elevenlabsApiKey", "elevenlabsModelId"])
      .then((r) => {
        setSttKey((r.elevenlabsApiKey as string) || "");
        setSttModel((r.elevenlabsModelId as string) || "");
      });
  }, []);

  const handlePrivacy = useCallback(async (next: boolean) => {
    setPrivacyMode(next);
    const stored = await loadSettings();
    await saveSettings({ ...stored, dataSharingEnabled: !next });
  }, []);

  const handleSaveStt = useCallback(async () => {
    await chrome.storage.local.set({
      elevenlabsApiKey: sttKey,
      elevenlabsModelId: sttModel,
    });
    setSttSaved(true);
    setTimeout(() => setSttSaved(false), 2000);
  }, [sttKey, sttModel]);

  const themeOptions: Array<{ value: typeof theme; label: string }> = [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
    { value: "system", label: "System" },
  ];

  return (
    <div className="flex flex-col gap-4 px-3 pt-2 pb-4">
      <div className="flex flex-col gap-0.5">
        <SectionLabel>Appearance</SectionLabel>
        <div className="flex items-center justify-between gap-3 px-0.5 py-[9px]">
          <span className="text-[13px] text-foreground">Language</span>
          <div className="relative">
            <select
              value={language}
              onChange={(e) => changeLanguage(e.target.value as Language)}
              aria-label="Language"
              className="appearance-none rounded-lg border border-border bg-muted/40 py-[5px] pr-7 pl-2.5 text-[12px] text-foreground outline-none hover:border-muted-foreground/40"
            >
              <option value="en">English</option>
              <option value="zh">中文</option>
            </select>
            <ChevronDownIcon className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-2 size-3 text-muted-foreground" />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 px-0.5 py-[9px]">
          <span className="text-[13px] text-foreground">Theme</span>
          <div className="flex gap-[2px] rounded-lg border border-border bg-muted/40 p-[2px]">
            {themeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => changeTheme(option.value)}
                className={cn(
                  "rounded-md px-[11px] py-1 text-[11.5px] transition-colors",
                  theme === option.value
                    ? "bg-background font-semibold text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-0.5">
        <SectionLabel>Privacy</SectionLabel>
        <div className="flex items-start justify-between gap-3 px-0.5 py-[9px]">
          <div className="min-w-0 flex-1">
            <div className="mb-[3px] text-[13px] text-foreground">
              Privacy Mode
            </div>
            <div className="text-[11px] text-muted-foreground leading-[1.45]">
              Minimizes data collection and processing while you browse.
            </div>
          </div>
          <MiniToggle
            checked={privacyMode}
            onChange={(v) => void handlePrivacy(v)}
            label="Privacy Mode"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel
          trailing={
            <span className="rounded-full bg-muted/40 px-2 py-[2px] text-[10px] text-muted-foreground">
              Optional
            </span>
          }
        >
          ElevenLabs Speech-to-Text
        </SectionLabel>
        <div className="px-0.5 text-[11px] text-muted-foreground leading-[1.45]">
          Add an API key to enable voice annotation.
        </div>
        <TextField
          label="API key"
          value={sttKey}
          onChange={setSttKey}
          placeholder="xi-…"
          mono
          secret
          hint={
            <>
              Get a key at{" "}
              <a
                href="https://elevenlabs.io"
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                elevenlabs.io
              </a>
            </>
          }
        />
        <TextField
          label={
            <>
              Model ID{" "}
              <span className="text-muted-foreground/70">(optional)</span>
            </>
          }
          value={sttModel}
          onChange={setSttModel}
          placeholder="Leave blank for default"
        />
        <div className="flex justify-end pt-0.5">
          <PrimaryButton onClick={() => void handleSaveStt()}>
            {sttSaved ? "Saved" : "Save"}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI tab — connector list + drill-ins
// ---------------------------------------------------------------------------

interface ChatGptStatus {
  signedIn: boolean;
  accountId: string | null;
}

type AiDetail =
  | { kind: "chatgpt" }
  | { kind: "provider"; draft: CustomModelConfig; isNew: boolean };

function providerKeyFor(model: CustomModelConfig): AIProviderKey {
  if (model.id.startsWith("builtin-")) {
    const key = model.id.slice("builtin-".length) as AIProviderKey;
    if (AI_PROVIDERS[key]) return key;
  }
  const detected = model.aiHost ? detectProviderFromHost(model.aiHost) : null;
  if (detected && AI_PROVIDERS[detected]) return detected;
  return PROVIDER_TYPE_TO_KEY[model.providerType] ?? "openai";
}

function displayNameFor(model: CustomModelConfig): string {
  if (model.name?.trim()) return model.name.trim();
  return AI_PROVIDERS[providerKeyFor(model)]?.name ?? "Custom provider";
}

function ConnectorRow({
  letter,
  name,
  subtitle,
  trailing,
  onClick,
}: {
  letter: string;
  name: string;
  subtitle?: ReactNode;
  trailing: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-[9px] px-2 py-2 text-left transition-colors hover:bg-accent"
    >
      <span className="flex size-[26px] shrink-0 items-center justify-center rounded-lg bg-muted/60 font-semibold text-[11px] text-foreground/80">
        {letter}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-foreground">
          {name}
        </span>
        {subtitle && (
          <span className="flex items-center gap-[5px] text-[11px] text-muted-foreground">
            {subtitle}
          </span>
        )}
      </span>
      {trailing}
    </button>
  );
}

function StatusDot({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        "size-[5px] shrink-0 rounded-full",
        on ? "bg-emerald-400" : "bg-muted-foreground/60",
      )}
    />
  );
}

function AiTab({
  detail,
  setDetail,
}: {
  detail: AiDetail | null;
  setDetail: (next: AiDetail | null) => void;
}) {
  const [settings, setSettings] = useState<AppSettings>({});
  const [query, setQuery] = useState("");
  const [chatgpt, setChatgpt] = useState<ChatGptStatus>({
    signedIn: false,
    accountId: null,
  });

  const refresh = useCallback(() => {
    void loadSettings().then(setSettings);
    chrome.runtime.sendMessage({ request: "chatgpt-status" }, (result) => {
      setChatgpt(
        (result as ChatGptStatus) ?? { signedIn: false, accountId: null },
      );
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const customModels = useMemo(
    () => settings.customModels ?? [],
    [settings.customModels],
  );
  const configured = customModels.filter((m) => m.aiToken);
  const configuredKeys = new Set(
    configured.map((m) => `builtin-${providerKeyFor(m)}`),
  );

  const q = query.trim().toLowerCase();
  const matches = (name: string) => !q || name.toLowerCase().includes(q);

  const available = AVAILABLE_PRESETS.filter(
    (key) =>
      !configured.some((m) => m.id === `builtin-${key}`) &&
      !configuredKeys.has(`builtin-${key}`) &&
      matches(AI_PROVIDERS[key].name),
  );

  const handleToggleByok = useCallback(async (next: boolean) => {
    const stored = await loadSettings();
    const updated = { ...stored, byokEnabled: next };
    await saveSettings(updated);
    setSettings(updated);
  }, []);

  const openPreset = (key: AIProviderKey) => {
    const meta = AI_PROVIDERS[key];
    setDetail({
      kind: "provider",
      isNew: true,
      draft: {
        id: `builtin-${key}`,
        name: meta.name,
        providerType: (meta.providerType ?? "openai") as ProviderType,
        aiHost: "host" in meta ? (meta.host ?? "") : "",
        aiToken: "",
        aiModel: meta.models[0] ?? "",
        enabled: true,
      },
    });
  };

  const openCustom = () => {
    setDetail({
      kind: "provider",
      isNew: true,
      draft: {
        id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: "",
        providerType: "openai",
        aiHost: "",
        aiToken: "",
        aiModel: "",
        enabled: true,
      },
    });
  };

  if (detail?.kind === "chatgpt") {
    return (
      <ChatGptDetail
        status={chatgpt}
        onBack={() => {
          setDetail(null);
          refresh();
        }}
      />
    );
  }
  if (detail?.kind === "provider") {
    return (
      <ProviderDetail
        initial={detail.draft}
        isNew={detail.isNew}
        byokEnabled={settings.byokEnabled ?? false}
        onBack={() => {
          setDetail(null);
          refresh();
        }}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mx-3 mt-2 flex shrink-0 items-start justify-between gap-3 rounded-[11px] border border-border bg-muted/20 px-3 py-[11px]">
        <div className="min-w-0 flex-1">
          <div className="mb-[2px] font-medium text-[12.5px] text-foreground">
            Bring your own key
          </div>
          <div className="text-[11px] text-muted-foreground leading-[1.4]">
            Use your own API keys and providers.
          </div>
        </div>
        <MiniToggle
          checked={settings.byokEnabled ?? false}
          onChange={(v) => void handleToggleByok(v)}
          label="Bring your own key"
        />
      </div>

      <div className="shrink-0 px-3 pt-2.5 pb-1.5">
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Search providers…"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <SectionLabel>
          <span className="px-1.5">Connected</span>
        </SectionLabel>
        {matches("ChatGPT (Subscription)") && (
          <ConnectorRow
            letter="G"
            name="ChatGPT (Subscription)"
            subtitle={
              chatgpt.signedIn ? (
                <>
                  <StatusDot on />
                  Connected · ChatGPT plan
                </>
              ) : (
                <>
                  <StatusDot on={false} />
                  Not signed in
                </>
              )
            }
            trailing={
              chatgpt.signedIn ? (
                <ChevronRightIcon className="size-[13px] text-muted-foreground/70" />
              ) : (
                <span className="text-[11px] text-muted-foreground">
                  Set up
                </span>
              )
            }
            onClick={() => setDetail({ kind: "chatgpt" })}
          />
        )}
        {configured
          .filter((m) => matches(displayNameFor(m)))
          .map((model) => (
            <ConnectorRow
              key={model.id}
              letter={displayNameFor(model).charAt(0).toUpperCase()}
              name={displayNameFor(model)}
              subtitle={
                <>
                  <StatusDot on={Boolean(model.enabled)} />
                  {model.enabled ? "API key" : "Disabled"} · {model.aiModel}
                </>
              }
              trailing={
                <ChevronRightIcon className="size-[13px] text-muted-foreground/70" />
              }
              onClick={() =>
                setDetail({
                  kind: "provider",
                  draft: { ...model },
                  isNew: false,
                })
              }
            />
          ))}

        {available.length > 0 && (
          <SectionLabel>
            <span className="px-1.5">Available</span>
          </SectionLabel>
        )}
        {available.map((key) => (
          <ConnectorRow
            key={key}
            letter={AI_PROVIDERS[key].name.charAt(0).toUpperCase()}
            name={AI_PROVIDERS[key].name}
            trailing={
              <span className="text-[11px] text-muted-foreground">Set up</span>
            }
            onClick={() => openPreset(key)}
          />
        ))}

        <button
          type="button"
          onClick={openCustom}
          className="mx-2 mt-2.5 flex w-[calc(100%-16px)] items-center justify-center gap-2 rounded-[9px] border border-border border-dashed px-2.5 py-[9px] text-[12px] text-muted-foreground transition-colors hover:border-muted-foreground/50 hover:text-foreground"
        >
          <PlusIcon className="size-3" />
          Add custom provider
        </button>
      </div>
    </div>
  );
}

async function selectChatGpt(nextModel: string): Promise<void> {
  const stored = await loadSettings();
  await saveSettings({
    ...stored,
    aiProvider: "chatgpt",
    aiModel: nextModel,
  });
}

function ChatGptDetail({
  status,
  onBack,
}: {
  status: ChatGptStatus;
  onBack: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<string>(CHATGPT_MODELS[0] ?? "");
  const [signedIn, setSignedIn] = useState(status.signedIn);
  const modelRef = useRef(model);
  modelRef.current = model;

  useEffect(() => {
    void loadSettings().then((s) => {
      if (
        s.aiProvider === "chatgpt" &&
        s.aiModel &&
        (CHATGPT_MODELS as readonly string[]).includes(s.aiModel)
      ) {
        setModel(s.aiModel);
      }
    });
    const onMessage = (message: {
      request?: string;
      success?: boolean;
      error?: string;
    }) => {
      if (message?.request !== "chatgpt-login-result") return;
      setBusy(false);
      if (message.success) {
        setError(null);
        setSignedIn(true);
        void selectChatGpt(modelRef.current);
      } else {
        setError(message.error ?? "Login failed");
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  const handleSignIn = () => {
    setBusy(true);
    setError(null);
    chrome.runtime.sendMessage({ request: "chatgpt-login" }, (result) => {
      if (!(result as { started?: boolean })?.started) {
        setBusy(false);
        setError(
          (result as { error?: string })?.error ?? "Could not start login",
        );
      }
    });
  };

  const handleSignOut = () => {
    chrome.runtime.sendMessage({ request: "chatgpt-logout" }, () => {
      setSignedIn(false);
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between border-border/60 border-b px-2.5 py-[9px]">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="flex size-7 items-center justify-center rounded-[7px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeftIcon className="size-[15px]" />
          </button>
          <span className="font-semibold text-[13px] text-foreground">
            ChatGPT (Subscription)
          </span>
          <span className="ml-1 flex items-center gap-[5px] text-[11px] text-muted-foreground">
            <StatusDot on={signedIn} />
            {signedIn ? "Connected" : "Off"}
          </span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-[13px] overflow-y-auto px-3 pt-3.5 pb-4">
        <div className="text-[11.5px] text-muted-foreground leading-[1.5]">
          {signedIn
            ? "Signed in — model calls use your ChatGPT plan."
            : "Sign in with your ChatGPT account to use your Plus/Pro plan."}
        </div>

        {signedIn && (
          <div className="flex flex-col gap-[5px]">
            <div className="px-0.5 text-[11.5px] text-muted-foreground">
              Model
            </div>
            <div className="relative">
              <select
                value={model}
                onChange={(e) => {
                  setModel(e.target.value);
                  void selectChatGpt(e.target.value);
                }}
                aria-label="ChatGPT model"
                className="w-full appearance-none rounded-[9px] border border-border bg-muted/30 px-2.5 py-2 font-mono text-[12px] text-foreground outline-none"
              >
                {CHATGPT_MODELS.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
              <ChevronDownIcon className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-2.5 size-3 text-muted-foreground" />
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-[9px] border border-red-500/25 bg-red-500/10 px-2.5 py-2 text-[11.5px] text-red-400">
            {error}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-border/60 border-t p-3">
        {signedIn ? (
          <button
            type="button"
            onClick={handleSignOut}
            className="flex-1 rounded-[9px] border border-border py-2 text-center text-[12px] text-foreground/80 hover:border-muted-foreground/50 hover:text-foreground"
          >
            Sign out
          </button>
        ) : (
          <PrimaryButton
            onClick={handleSignIn}
            disabled={busy}
            className="flex-1"
          >
            {busy ? "Opening…" : "Sign in with ChatGPT"}
          </PrimaryButton>
        )}
      </div>
    </div>
  );
}

function ProviderDetail({
  initial,
  isNew,
  byokEnabled,
  onBack,
}: {
  initial: CustomModelConfig;
  isNew: boolean;
  byokEnabled: boolean;
  onBack: () => void;
}) {
  const [draft, setDraft] = useState<CustomModelConfig>(initial);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<
    { ok: true; ms: number } | { ok: false; message: string } | null
  >(null);

  const set = <K extends keyof CustomModelConfig>(
    key: K,
    value: CustomModelConfig[K],
  ) => setDraft((d) => ({ ...d, [key]: value }));

  const canSubmit = Boolean(draft.aiToken && draft.aiModel);

  const handleTest = async () => {
    setTesting(true);
    setResult(null);
    const started = performance.now();
    try {
      const key = providerKeyFor(draft);
      const provider = createAIProvider({
        byokEnabled: true,
        aiHost: draft.aiHost,
        aiToken: draft.aiToken,
        aiModel: draft.aiModel,
        aiProvider: key,
        providerType: draft.providerType,
      });
      await generateText({
        model: provider(draft.aiModel) as LanguageModel,
        prompt: "Hi",
      });
      setResult({ ok: true, ms: Math.round(performance.now() - started) });
    } catch (error) {
      setResult({
        ok: false,
        message: error instanceof Error ? error.message : "Connection failed",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!canSubmit) {
      setResult({
        ok: false,
        message: "API key and default model are required.",
      });
      return;
    }
    setSaving(true);
    try {
      const stored = await loadSettings();
      const models = [...(stored.customModels ?? [])];
      const index = models.findIndex((m) => m.id === draft.id);
      if (index >= 0) models[index] = draft;
      else models.push(draft);

      const enabledModels = models.filter((m) => m.enabled);
      const active = draft.enabled ? draft : enabledModels[0];
      const key = active
        ? providerKeyFor(active)
        : (stored.aiProvider ?? "openai");

      await saveSettings({
        ...stored,
        byokEnabled: stored.byokEnabled ?? true,
        customModels: models,
        ...(active
          ? {
              aiHost: active.aiHost,
              aiToken: active.aiToken,
              aiModel: active.aiModel,
              aiProvider: key,
              providerType: active.providerType,
              providerEnabled: true,
            }
          : { providerEnabled: false }),
      });
      onBack();
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    const stored = await loadSettings();
    await saveSettings({
      ...stored,
      customModels: (stored.customModels ?? []).filter(
        (m) => m.id !== draft.id,
      ),
    });
    onBack();
  };

  const title = displayNameFor(draft);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between border-border/60 border-b px-2.5 py-[9px]">
        <div className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeftIcon className="size-[15px]" />
          </button>
          <span className="truncate font-semibold text-[13px] text-foreground">
            {title}
          </span>
          <span className="ml-1 flex shrink-0 items-center gap-[5px] text-[11px] text-muted-foreground">
            <StatusDot on={Boolean(draft.enabled) && byokEnabled} />
            {draft.enabled ? "Enabled" : "Disabled"}
          </span>
        </div>
        <MiniToggle
          checked={Boolean(draft.enabled)}
          onChange={(v) => set("enabled", v)}
          label="Enabled"
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-[13px] overflow-y-auto px-3 pt-3.5 pb-4">
        <TextField
          label="Display name"
          value={draft.name ?? ""}
          onChange={(v) => set("name", v)}
          placeholder={title}
        />
        <div className="flex flex-col gap-[5px]">
          <div className="px-0.5 text-[11.5px] text-muted-foreground">
            Provider type <span className="text-red-400">*</span>
          </div>
          <div className="relative">
            <select
              value={draft.providerType}
              onChange={(e) =>
                set("providerType", e.target.value as ProviderType)
              }
              aria-label="Provider type"
              className="w-full appearance-none rounded-[9px] border border-border bg-muted/30 px-2.5 py-2 text-[12.5px] text-foreground outline-none"
            >
              {(Object.keys(PROVIDER_TYPE_LABELS) as ProviderType[]).map(
                (type) => (
                  <option key={type} value={type}>
                    {PROVIDER_TYPE_LABELS[type]}
                  </option>
                ),
              )}
            </select>
            <ChevronDownIcon className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-2.5 size-3 text-muted-foreground" />
          </div>
        </div>
        <TextField
          label="Host"
          value={draft.aiHost ?? ""}
          onChange={(v) => set("aiHost", v)}
          placeholder="https://api.example.com/v1"
          mono
        />
        <TextField
          label="API key"
          required
          value={draft.aiToken ?? ""}
          onChange={(v) => set("aiToken", v)}
          placeholder="sk-…"
          mono
          secret
        />
        <TextField
          label="Default model"
          required
          value={draft.aiModel ?? ""}
          onChange={(v) => set("aiModel", v)}
          placeholder="model-id"
          mono
          hint="Used when no model is picked in the composer."
        />

        {result &&
          (result.ok ? (
            <div className="flex items-center gap-[7px] rounded-[9px] border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-2 text-[11.5px] text-emerald-400">
              <CheckIcon className="size-3" />
              Connection OK · {result.ms} ms
            </div>
          ) : (
            <div className="rounded-[9px] border border-red-500/25 bg-red-500/10 px-2.5 py-2 text-[11.5px] text-red-400">
              {result.message}
            </div>
          ))}

        {!isNew && (
          <button
            type="button"
            onClick={() => void handleRemove()}
            className="self-center pt-1 text-[10.5px] text-muted-foreground/80 hover:text-red-400"
          >
            Remove provider
          </button>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-border/60 border-t p-3">
        <button
          type="button"
          onClick={() => void handleTest()}
          disabled={testing || !canSubmit}
          className="flex-1 rounded-[9px] border border-border py-2 text-center text-[12px] text-foreground/80 transition-colors hover:border-muted-foreground/50 hover:text-foreground disabled:opacity-50"
        >
          {testing ? "Testing…" : "Test connection"}
        </button>
        <PrimaryButton
          onClick={() => void handleSave()}
          disabled={saving}
          className="flex-1"
        >
          {saving ? "Saving…" : "Save"}
        </PrimaryButton>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skills tab — installed list + files tree
// ---------------------------------------------------------------------------

function SkillsTab() {
  const [subTab, setSubTab] = useState<"installed" | "files">("installed");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 gap-3.5 px-3.5 pt-2">
        {(["installed", "files"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setSubTab(tab)}
            className={cn(
              "border-b-2 px-0.5 py-1.5 text-[12px] capitalize transition-colors",
              subTab === tab
                ? "border-foreground font-semibold text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab}
          </button>
        ))}
      </div>
      {subTab === "installed" ? <SkillsInstalled /> : <SkillsFiles />}
    </div>
  );
}

function SkillsInstalled() {
  const [skills, setSkills] = useState<SkillMetadata[]>([]);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    await skillClientAdapter.initialize();
    setSkills([...skillClientAdapter.listSkills()]);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleUpload = async (file: File) => {
    setUploadError(null);
    let result = await skillClientAdapter.uploadSkill(file);
    if (!result.ok && result.type === "conflict") {
      if (confirm(`Skill "${result.skillName}" already exists. Replace it?`)) {
        result = await skillClientAdapter.uploadSkill(file, true);
      } else {
        return;
      }
    }
    if (!result.ok) {
      setUploadError(
        result.type === "error" ? result.message : "Upload failed",
      );
      return;
    }
    await refresh();
  };

  const onFilePicked = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void handleUpload(file);
    event.target.value = "";
  };

  const handleToggle = async (skill: SkillMetadata) => {
    if (skill.enabled) await skillClientAdapter.disableSkill(skill.id);
    else await skillClientAdapter.enableSkill(skill.id);
    await refresh();
  };

  const handleDelete = async (skill: SkillMetadata) => {
    if (!confirm(`Delete skill "${skill.name}"?`)) return;
    await skillClientAdapter.deleteSkill(skill.id);
    setExpanded(null);
    await refresh();
  };

  const q = query.trim().toLowerCase();
  const visible = q
    ? skills.filter((s) => s.name.toLowerCase().includes(q))
    : skills;
  const enabledCount = skills.filter((s) => s.enabled).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3 pt-2.5 pb-4">
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files?.[0];
          if (file) void handleUpload(file);
        }}
        className="flex w-full items-center gap-2.5 rounded-[11px] border border-border border-dashed p-3 text-left transition-colors hover:border-muted-foreground/50"
      >
        <span className="flex size-[30px] shrink-0 items-center justify-center rounded-[9px] bg-muted/50 text-muted-foreground">
          <UploadIcon className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] text-foreground">
            Drop a skill ZIP, or{" "}
            <span className="underline underline-offset-2">browse</span>
          </span>
          <span className="mt-[1px] block text-[10.5px] text-muted-foreground/80">
            ZIP with SKILL.md · max 10 MB
          </span>
        </span>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip"
        onChange={onFilePicked}
        className="hidden"
      />

      <SearchBox
        value={query}
        onChange={setQuery}
        placeholder="Search skills…"
      />

      {uploadError && (
        <div className="rounded-[9px] border border-red-500/25 bg-red-500/10 px-2.5 py-2 text-[11.5px] text-red-400">
          {uploadError}
        </div>
      )}

      <div className="px-0.5 text-[11px] text-muted-foreground">
        {skills.length} installed · {enabledCount} enabled
      </div>

      <div className="flex flex-col gap-[5px]">
        {visible.map((skill) => (
          <div
            key={skill.id}
            className="rounded-[11px] border border-border bg-muted/20 transition-colors hover:border-muted-foreground/30"
          >
            <div className="flex items-center gap-2.5 px-3 py-[11px]">
              <button
                type="button"
                onClick={() =>
                  setExpanded(expanded === skill.id ? null : skill.id)
                }
                className="min-w-0 flex-1 text-left"
              >
                <span className="mb-[2px] block truncate font-medium font-mono text-[13px] text-foreground">
                  {skill.name}
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  v{skill.version}
                  {skill.uploadedAt
                    ? ` · uploaded ${new Date(skill.uploadedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                    : ""}
                </span>
              </button>
              <MiniToggle
                checked={skill.enabled}
                onChange={() => void handleToggle(skill)}
                label={`Enable ${skill.name}`}
              />
            </div>
            {expanded === skill.id && (
              <div className="flex flex-col gap-2 border-border/60 border-t px-3 py-2.5">
                {skill.description && (
                  <div className="text-[11px] text-muted-foreground leading-[1.5]">
                    {skill.description}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => void handleDelete(skill)}
                  className="self-start text-[11px] text-muted-foreground hover:text-red-400"
                >
                  Delete skill
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="px-0.5 pt-0.5 text-[10.5px] text-muted-foreground/80 leading-[1.5]">
        Tap a skill for details and delete.
      </div>
    </div>
  );
}

function countFiles(node: FileTreeNode): number {
  if (node.type === "file") return 1;
  return (node.children ?? []).reduce(
    (sum, child) => sum + countFiles(child),
    0,
  );
}

function FilesRow({
  node,
  depth,
  expanded,
  onToggle,
}: {
  node: FileTreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
}) {
  const isDir = node.type === "directory";
  const isOpen = expanded.has(node.path);
  return (
    <>
      <button
        type="button"
        onClick={() => isDir && onToggle(node.path)}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg py-[6px] pr-1.5 text-left transition-colors hover:bg-accent",
          depth === 0 ? "pl-1.5" : "",
        )}
        style={depth > 0 ? { paddingLeft: 6 + depth * 24 } : undefined}
      >
        {isDir ? (
          <ChevronRightIcon
            className={cn(
              "size-[11px] shrink-0 text-muted-foreground transition-transform",
              isOpen && "rotate-90",
            )}
          />
        ) : (
          <span className="w-[11px] shrink-0" />
        )}
        {isDir ? (
          <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <FileIcon className="size-[13px] shrink-0 text-muted-foreground" />
        )}
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-mono text-[12.5px]",
            isDir ? "text-foreground" : "text-foreground/80",
          )}
        >
          {node.name}
        </span>
        {isDir && (
          <span className="shrink-0 text-[10.5px] text-muted-foreground/80">
            {countFiles(node)} files
          </span>
        )}
        <span className="w-[58px] shrink-0 text-right font-mono text-[10.5px] text-muted-foreground">
          {formatKb(node.size)}
        </span>
      </button>
      {isDir &&
        isOpen &&
        (node.children ?? []).map((child) => (
          <FilesRow
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
          />
        ))}
    </>
  );
}

function SkillsFiles() {
  const [roots, setRoots] = useState<FileTreeNode[]>([]);
  const [usedBytes, setUsedBytes] = useState(0);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    void (async () => {
      try {
        await zenfs.initialize();
        const [fileTree, usage] = await Promise.all([
          zenfs.getFileTree("/skills"),
          zenfs.getDiskUsage("/skills"),
        ]);
        setRoots(fileTree);
        setUsedBytes(
          typeof usage === "number"
            ? usage
            : ((usage as { totalSize?: number })?.totalSize ?? 0),
        );
      } catch {
        setRoots([]);
      }
    })();
  }, []);

  const totalFiles = roots.reduce((sum, node) => sum + countFiles(node), 0);
  const totalFolders = roots.filter((n) => n.type === "directory").length;

  const q = query.trim().toLowerCase();
  const flatMatches = useMemo(() => {
    if (!q) return [];
    const out: FileTreeNode[] = [];
    const walk = (node: FileTreeNode) => {
      if (node.type === "file" && node.name.toLowerCase().includes(q)) {
        out.push(node);
      }
      for (const child of node.children ?? []) walk(child);
    };
    for (const root of roots) walk(root);
    return out;
  }, [q, roots]);

  const onToggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3 pt-2.5 pb-4">
      <div className="flex items-center justify-between rounded-[11px] border border-border bg-muted/20 px-3 py-2.5">
        <span className="text-[11px] text-muted-foreground">
          {totalFiles} files · {totalFolders} folders
        </span>
        <span className="font-mono text-[11.5px] text-foreground/80">
          {formatKb(usedBytes)} used
        </span>
      </div>

      <SearchBox
        value={query}
        onChange={setQuery}
        placeholder="Search files and folders…"
      />

      <div className="flex flex-col">
        {q
          ? flatMatches.map((node) => (
              <div
                key={node.path}
                className="flex items-center gap-2 rounded-lg px-1.5 py-[6px]"
              >
                <FileIcon className="size-[13px] shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[12.5px] text-foreground/90">
                    {node.name}
                  </span>
                  <span className="block truncate text-[10px] text-muted-foreground/70">
                    {node.path}
                  </span>
                </span>
                <span className="w-[58px] shrink-0 text-right font-mono text-[10.5px] text-muted-foreground">
                  {formatKb(node.size)}
                </span>
              </div>
            ))
          : roots.map((node) => (
              <FilesRow
                key={node.path}
                node={node}
                depth={0}
                expanded={expanded}
                onToggle={onToggle}
              />
            ))}
        {q && flatMatches.length === 0 && (
          <div className="px-1.5 py-4 text-center text-[11.5px] text-muted-foreground">
            No matching files
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bridge tab
// ---------------------------------------------------------------------------

type BridgeStatus = "disconnected" | "connecting" | "connected" | "error";

function BridgeTab() {
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
        {tab === "skills" && <SkillsTab />}
        {tab === "bridge" && <BridgeTab />}
      </div>
    </div>
  );
}
