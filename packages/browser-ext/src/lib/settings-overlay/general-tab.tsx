import { STORAGE_KEYS } from "@eterna/core";
import { useTranslation } from "@eterna/react/i18n/context";
import type { Language } from "@eterna/react/i18n/types";
import { cn } from "@eterna/react/lib/utils";
import { useTheme } from "@eterna/react/theme/context";
import { ChevronDownIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  loadSettings,
  MiniToggle,
  PrimaryButton,
  SectionLabel,
  saveSettings,
  TextAreaField,
  TextField,
} from "./shared";

// ---------------------------------------------------------------------------
// General tab
// ---------------------------------------------------------------------------

export function GeneralTab() {
  const { language, changeLanguage } = useTranslation();
  const { theme, changeTheme } = useTheme();
  const [privacyMode, setPrivacyMode] = useState(false);
  const [sttKey, setSttKey] = useState("");
  const [sttModel, setSttModel] = useState("");
  const [sttSaved, setSttSaved] = useState(false);
  const [identity, setIdentity] = useState("");
  const [soul, setSoul] = useState("");
  const [personaSaved, setPersonaSaved] = useState(false);
  const [smUrl, setSmUrl] = useState("");
  const [smKey, setSmKey] = useState("");
  const [smSaved, setSmSaved] = useState(false);

  useEffect(() => {
    void loadSettings().then((s) => {
      setPrivacyMode(s.dataSharingEnabled === false);
    });
    void chrome.storage.local
      .get([
        "elevenlabsApiKey",
        "elevenlabsModelId",
        STORAGE_KEYS.IDENTITY,
        STORAGE_KEYS.SOUL,
        STORAGE_KEYS.SUPERMEMORY,
      ])
      .then((r) => {
        setSttKey((r.elevenlabsApiKey as string) || "");
        setSttModel((r.elevenlabsModelId as string) || "");
        setIdentity((r[STORAGE_KEYS.IDENTITY] as string) || "");
        setSoul((r[STORAGE_KEYS.SOUL] as string) || "");
        const sm = r[STORAGE_KEYS.SUPERMEMORY] as
          | { url?: string; apiKey?: string }
          | undefined;
        setSmUrl(sm?.url || "");
        setSmKey(sm?.apiKey || "");
      });
  }, []);

  const handlePrivacy = useCallback(async (next: boolean) => {
    setPrivacyMode(next);
    await saveSettings({ dataSharingEnabled: !next });
  }, []);

  const handleSaveStt = useCallback(async () => {
    await chrome.storage.local.set({
      elevenlabsApiKey: sttKey,
      elevenlabsModelId: sttModel,
    });
    setSttSaved(true);
    setTimeout(() => setSttSaved(false), 2000);
  }, [sttKey, sttModel]);

  const handleSavePersona = useCallback(async () => {
    await chrome.storage.local.set({
      [STORAGE_KEYS.IDENTITY]: identity.trim(),
      [STORAGE_KEYS.SOUL]: soul.trim(),
    });
    setPersonaSaved(true);
    setTimeout(() => setPersonaSaved(false), 2000);
  }, [identity, soul]);

  const handleSaveSupermemory = useCallback(async () => {
    await chrome.storage.local.set({
      [STORAGE_KEYS.SUPERMEMORY]: {
        url: smUrl.trim(),
        apiKey: smKey.trim(),
      },
    });
    setSmSaved(true);
    setTimeout(() => setSmSaved(false), 2000);
  }, [smUrl, smKey]);

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
              <option value="tr">Türkçe</option>
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
        <SectionLabel>Persona</SectionLabel>
        <div className="px-0.5 text-[11px] text-muted-foreground leading-[1.45]">
          Shape who the assistant is and how it behaves. Both are injected into
          its instructions verbatim.
        </div>
        <TextAreaField
          label="Identity — who it is (name, how it addresses you)"
          value={identity}
          onChange={setIdentity}
          placeholder={'e.g. "You are Eterna. Call me Can, keep it informal."'}
        />
        <TextAreaField
          label="Soul — how it behaves (tone, values, style)"
          value={soul}
          onChange={setSoul}
          placeholder={
            'e.g. "Direct and playful. No filler. Push back when I\'m wrong."'
          }
          rows={4}
        />
        <div className="flex justify-end pt-0.5">
          <PrimaryButton onClick={() => void handleSavePersona()}>
            {personaSaved ? "Saved" : "Save"}
          </PrimaryButton>
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
          Supermemory (local)
        </SectionLabel>
        <div className="px-0.5 text-[11px] text-muted-foreground leading-[1.45]">
          Long-term memory engine. Run{" "}
          <code className="rounded bg-muted/40 px-1 font-mono text-[10.5px]">
            npx supermemory local
          </code>{" "}
          and paste the URL and API key it prints. Memory falls back to local
          storage when the server is off.
        </div>
        <TextField
          label="Server URL"
          value={smUrl}
          onChange={setSmUrl}
          placeholder="http://localhost:6767"
          mono
        />
        <TextField
          label="API key"
          value={smKey}
          onChange={setSmKey}
          placeholder="sm_…"
          mono
          secret
        />
        <div className="flex justify-end pt-0.5">
          <PrimaryButton onClick={() => void handleSaveSupermemory()}>
            {smSaved ? "Saved" : "Save"}
          </PrimaryButton>
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
