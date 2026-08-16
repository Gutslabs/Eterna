import type {
  ScheduledAutomation,
  ScheduledAutomationSchedule,
} from "@eterna/core";
import { useTranslation } from "@eterna/react/i18n/context";
import {
  CalendarClockIcon,
  CheckIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ScheduledAutomationDraft,
  ScheduledAutomationRequest,
} from "./scheduled-automations";

type ScheduleType = ScheduledAutomationSchedule["type"];

interface SchedulerResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

const DEFAULT_INTERVAL = "60";

function defaultOnceValue(): string {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function sendSchedulerRequest<T>(
  request: ScheduledAutomationRequest,
): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(request, (response: SchedulerResponse<T>) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      if (!response?.success) {
        reject(new Error(response?.error ?? "Automation request failed"));
        return;
      }
      resolve(response.data as T);
    });
  });
}

function displaySchedule(schedule: ScheduledAutomationSchedule): string {
  if (schedule.type === "interval") {
    return `Every ${schedule.everyMinutes} min`;
  }
  if (schedule.type === "daily") return `Daily at ${schedule.time}`;
  return new Date(schedule.runAt).toLocaleString();
}

export function ScheduledAutomationsPanel() {
  const { language } = useTranslation();
  const tr = String(language) === "tr";
  const labels = useMemo(
    () =>
      tr
        ? {
            title: "Zamanlanmış Otomasyonlar",
            description:
              "Bir istemi belirlediğin zamanda arka planda çalıştır.",
            add: "Otomasyon ekle",
            name: "Ad",
            namePlaceholder: "Günlük özet",
            prompt: "İstem",
            promptPlaceholder: "Açık sekmelerimi özetle...",
            once: "Bir kez",
            interval: "Aralıklı",
            daily: "Her gün",
            save: "Kaydet",
            cancel: "İptal",
            empty: "Henüz zamanlanmış otomasyon yok.",
            run: "Şimdi çalıştır",
            edit: "Düzenle",
            remove: "Sil",
            enabled: "Açık",
            disabled: "Kapalı",
          }
        : {
            title: "Scheduled automations",
            description: "Run a prompt in the background on your schedule.",
            add: "Add automation",
            name: "Name",
            namePlaceholder: "Daily brief",
            prompt: "Prompt",
            promptPlaceholder: "Summarize my open tabs...",
            once: "Once",
            interval: "Interval",
            daily: "Daily",
            save: "Save",
            cancel: "Cancel",
            empty: "No scheduled automations yet.",
            run: "Run now",
            edit: "Edit",
            remove: "Delete",
            enabled: "On",
            disabled: "Off",
          },
    [tr],
  );
  const [automations, setAutomations] = useState<ScheduledAutomation[]>([]);
  const [editing, setEditing] = useState<ScheduledAutomation | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [scheduleType, setScheduleType] = useState<ScheduleType>("daily");
  const [scheduleValue, setScheduleValue] = useState("09:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setAutomations(
        await sendSchedulerRequest<ScheduledAutomation[]>({
          request: "scheduled-automation-list",
        }),
      );
      setError(null);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const resetForm = () => {
    setEditing(null);
    setShowForm(false);
    setName("");
    setPrompt("");
    setScheduleType("daily");
    setScheduleValue("09:00");
    setError(null);
  };

  const openEdit = (automation: ScheduledAutomation) => {
    setEditing(automation);
    setName(automation.name);
    setPrompt(automation.prompt);
    setScheduleType(automation.schedule.type);
    if (automation.schedule.type === "once") {
      const date = new Date(automation.schedule.runAt);
      const local = new Date(
        date.getTime() - date.getTimezoneOffset() * 60_000,
      );
      setScheduleValue(local.toISOString().slice(0, 16));
    } else if (automation.schedule.type === "interval") {
      setScheduleValue(String(automation.schedule.everyMinutes));
    } else {
      setScheduleValue(automation.schedule.time);
    }
    setShowForm(true);
  };

  const handleScheduleType = (next: ScheduleType) => {
    setScheduleType(next);
    setScheduleValue(
      next === "once"
        ? defaultOnceValue()
        : next === "interval"
          ? DEFAULT_INTERVAL
          : "09:00",
    );
  };

  const handleSave = async () => {
    setBusy(true);
    try {
      let schedule: ScheduledAutomationSchedule;
      if (scheduleType === "once") {
        schedule = {
          type: "once",
          runAt: new Date(scheduleValue).toISOString(),
        };
      } else if (scheduleType === "interval") {
        schedule = { type: "interval", everyMinutes: Number(scheduleValue) };
      } else {
        schedule = { type: "daily", time: scheduleValue };
      }
      const draft: ScheduledAutomationDraft = {
        id: editing?.id,
        name,
        prompt,
        schedule,
        enabled: editing?.enabled ?? true,
      };
      await sendSchedulerRequest<ScheduledAutomation>({
        request: "scheduled-automation-save",
        automation: draft,
      });
      resetForm();
      await refresh();
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      setBusy(false);
    }
  };

  const act = async (request: ScheduledAutomationRequest) => {
    setBusy(true);
    try {
      await sendSchedulerRequest(request);
      await refresh();
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 px-3 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 font-semibold text-[13px]">
            <CalendarClockIcon className="size-3.5" />
            {labels.title}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {labels.description}
          </p>
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={() => {
              setScheduleValue("09:00");
              setShowForm(true);
            }}
            className="flex shrink-0 items-center gap-1 rounded-[8px] bg-foreground px-2 py-1.5 font-semibold text-[11px] text-background"
          >
            <PlusIcon className="size-3" />
            {labels.add}
          </button>
        )}
      </div>

      {showForm && (
        <div className="space-y-2 rounded-[10px] border border-border bg-muted/20 p-2.5">
          <label className="block text-[10.5px] text-muted-foreground">
            {labels.name}
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={labels.namePlaceholder}
              className="mt-1 w-full rounded-[8px] border border-border bg-background px-2.5 py-2 text-[12px] text-foreground outline-none"
            />
          </label>
          <label className="block text-[10.5px] text-muted-foreground">
            {labels.prompt}
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={labels.promptPlaceholder}
              rows={3}
              className="mt-1 w-full resize-none rounded-[8px] border border-border bg-background px-2.5 py-2 text-[12px] text-foreground outline-none"
            />
          </label>
          <div className="grid grid-cols-3 gap-1 rounded-[8px] bg-muted p-1">
            {(["once", "interval", "daily"] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => handleScheduleType(type)}
                className={`rounded-[6px] py-1.5 text-[10.5px] ${
                  scheduleType === type
                    ? "bg-background font-semibold shadow-sm"
                    : "text-muted-foreground"
                }`}
              >
                {labels[type]}
              </button>
            ))}
          </div>
          <input
            type={
              scheduleType === "once"
                ? "datetime-local"
                : scheduleType === "daily"
                  ? "time"
                  : "number"
            }
            min={scheduleType === "interval" ? "1" : undefined}
            value={scheduleValue}
            onChange={(event) => setScheduleValue(event.target.value)}
            className="w-full rounded-[8px] border border-border bg-background px-2.5 py-2 text-[12px] text-foreground outline-none"
          />
          <div className="flex justify-end gap-1.5 pt-1">
            <button
              type="button"
              onClick={resetForm}
              className="flex items-center gap-1 rounded-[7px] px-2 py-1.5 text-[11px] text-muted-foreground"
            >
              <XIcon className="size-3" /> {labels.cancel}
            </button>
            <button
              type="button"
              disabled={
                busy || !name.trim() || !prompt.trim() || !scheduleValue
              }
              onClick={() => void handleSave()}
              className="flex items-center gap-1 rounded-[7px] bg-foreground px-2.5 py-1.5 font-semibold text-[11px] text-background disabled:opacity-40"
            >
              <CheckIcon className="size-3" /> {labels.save}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-[8px] border border-red-500/25 bg-red-500/10 px-2.5 py-2 text-[11px] text-red-400">
          {error}
        </div>
      )}

      {!showForm && automations.length === 0 && (
        <div className="rounded-[10px] border border-border border-dashed py-8 text-center text-[11.5px] text-muted-foreground">
          {labels.empty}
        </div>
      )}

      <div className="space-y-2">
        {automations.map((automation) => (
          <div
            key={automation.id}
            className="rounded-[10px] border border-border bg-muted/15 p-2.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-semibold text-[12px]">
                  {automation.name}
                </div>
                <div className="mt-0.5 text-[10.5px] text-muted-foreground">
                  {displaySchedule(automation.schedule)}
                </div>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void act({
                    request: "scheduled-automation-toggle",
                    id: automation.id,
                    enabled: !automation.enabled,
                  })
                }
                className={`rounded-full px-2 py-1 font-semibold text-[9.5px] ${
                  automation.enabled
                    ? "bg-emerald-500/15 text-emerald-500"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {automation.enabled ? labels.enabled : labels.disabled}
              </button>
            </div>
            <p className="mt-2 line-clamp-2 text-[11px] text-foreground/75">
              {automation.prompt}
            </p>
            {automation.lastStatus && (
              <div className="mt-1.5 text-[10px] text-muted-foreground">
                {automation.lastStatus}
                {automation.lastError ? ` · ${automation.lastError}` : ""}
              </div>
            )}
            <div className="mt-2 flex justify-end gap-1">
              <button
                type="button"
                title={labels.run}
                disabled={busy}
                onClick={() =>
                  void act({
                    request: "scheduled-automation-run",
                    id: automation.id,
                  })
                }
                className="rounded-[6px] p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <PlayIcon className="size-3" />
              </button>
              <button
                type="button"
                title={labels.edit}
                disabled={busy}
                onClick={() => openEdit(automation)}
                className="rounded-[6px] p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <PencilIcon className="size-3" />
              </button>
              <button
                type="button"
                title={labels.remove}
                disabled={busy}
                onClick={() =>
                  window.confirm(`${labels.remove}: ${automation.name}?`) &&
                  void act({
                    request: "scheduled-automation-delete",
                    id: automation.id,
                  })
                }
                className="rounded-[6px] p-1.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
              >
                <Trash2Icon className="size-3" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
