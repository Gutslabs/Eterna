import {
  AI_PROVIDERS,
  type AIProviderKey,
  type AppSettings,
  type CustomModelConfig,
  detectProviderFromHost,
  type ProviderType,
} from "@eterna/core";
import { cn } from "@eterna/react/lib/utils";
import type { LanguageModel } from "ai";
import { generateText } from "ai";
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  PlusIcon,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CHATGPT_MODELS, createAIProvider } from "../ai-provider";
import {
  loadSettings,
  MiniToggle,
  PrimaryButton,
  SearchBox,
  SectionLabel,
  saveSettings,
  TextField,
} from "./shared";

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

// ---------------------------------------------------------------------------
// AI tab — connector list + drill-ins
// ---------------------------------------------------------------------------

interface ChatGptStatus {
  signedIn: boolean;
  accountId: string | null;
}

export type AiDetail =
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

export function AiTab({
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
    const updated = await saveSettings({ byokEnabled: next });
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
  await saveSettings({
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
