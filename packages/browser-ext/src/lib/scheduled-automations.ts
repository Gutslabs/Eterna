import {
  computeNextAutomationRun,
  type KeyValueStorage,
  type ScheduledAutomation,
  type ScheduledAutomationSchedule,
  STORAGE_KEYS,
  validateScheduledAutomationSchedule,
} from "@eterna/core";

export const SCHEDULED_AUTOMATION_ALARM_PREFIX = "eterna-scheduled:";

export interface ScheduledAutomationDraft {
  id?: string;
  name: string;
  prompt: string;
  schedule: ScheduledAutomationSchedule;
  enabled?: boolean;
}

export type ScheduledAutomationRequest =
  | { request: "scheduled-automation-list" }
  | {
      request: "scheduled-automation-save";
      automation: ScheduledAutomationDraft;
    }
  | { request: "scheduled-automation-delete"; id: string }
  | { request: "scheduled-automation-toggle"; id: string; enabled: boolean }
  | { request: "scheduled-automation-run"; id: string };

interface AlarmAdapter {
  create(
    name: string,
    info: { when: number; periodInMinutes?: number },
  ): void | Promise<void>;
  clear(name: string): boolean | Promise<boolean>;
}

interface RunResult {
  sessionId?: string;
}

interface SchedulerDeps {
  storage: KeyValueStorage<unknown>;
  alarms: AlarmAdapter;
  runPrompt(automation: ScheduledAutomation): Promise<RunResult | undefined>;
  now?: () => number;
  createId?: () => string;
}

export interface ScheduledAutomationManager {
  initialize(): Promise<void>;
  list(): Promise<ScheduledAutomation[]>;
  save(draft: ScheduledAutomationDraft): Promise<ScheduledAutomation>;
  remove(id: string): Promise<void>;
  toggle(id: string, enabled: boolean): Promise<ScheduledAutomation>;
  runNow(id: string): Promise<ScheduledAutomation>;
  handleAlarm(name: string): Promise<boolean>;
  handleRequest(request: ScheduledAutomationRequest): Promise<unknown>;
}

function isAutomationList(value: unknown): value is ScheduledAutomation[] {
  return Array.isArray(value);
}

export function isScheduledAutomationRequest(
  value: unknown,
): value is ScheduledAutomationRequest {
  if (!value || typeof value !== "object") return false;
  const request = (value as { request?: unknown }).request;
  return (
    typeof request === "string" &&
    [
      "scheduled-automation-list",
      "scheduled-automation-save",
      "scheduled-automation-delete",
      "scheduled-automation-toggle",
      "scheduled-automation-run",
    ].includes(request)
  );
}

export function createScheduledAutomationManager(
  deps: SchedulerDeps,
): ScheduledAutomationManager {
  const runningIds = new Set<string>();
  const now = deps.now ?? Date.now;
  const createId =
    deps.createId ??
    (() =>
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `automation-${now()}-${Math.random().toString(36).slice(2)}`);

  const read = async (): Promise<ScheduledAutomation[]> => {
    const stored = await deps.storage.load(STORAGE_KEYS.SCHEDULED_AUTOMATIONS);
    return isAutomationList(stored) ? stored : [];
  };

  const mutate = async (
    updater: (current: ScheduledAutomation[]) => ScheduledAutomation[],
  ): Promise<ScheduledAutomation[]> => {
    if (deps.storage.update) {
      return (await deps.storage.update(
        STORAGE_KEYS.SCHEDULED_AUTOMATIONS,
        (stored) => updater(isAutomationList(stored) ? stored : []),
      )) as ScheduledAutomation[];
    }
    const next = updater(await read());
    await deps.storage.save(STORAGE_KEYS.SCHEDULED_AUTOMATIONS, next);
    return next;
  };

  const alarmName = (id: string) => `${SCHEDULED_AUTOMATION_ALARM_PREFIX}${id}`;

  const scheduleAlarm = async (
    automation: ScheduledAutomation,
  ): Promise<ScheduledAutomation> => {
    await deps.alarms.clear(alarmName(automation.id));
    if (!automation.enabled) return automation;

    let next = computeNextAutomationRun(automation.schedule, now());
    if (
      next === null &&
      automation.schedule.type === "once" &&
      !automation.lastRunAt
    ) {
      next = now() + 250;
    }
    if (next === null) return { ...automation, enabled: false };

    const periodInMinutes =
      automation.schedule.type === "interval"
        ? automation.schedule.everyMinutes
        : undefined;
    await deps.alarms.create(alarmName(automation.id), {
      when: next,
      ...(periodInMinutes ? { periodInMinutes } : {}),
    });
    return { ...automation, nextRunAt: new Date(next).toISOString() };
  };

  const replace = async (
    automation: ScheduledAutomation,
  ): Promise<ScheduledAutomation> => {
    await mutate((current) =>
      current.map((item) => (item.id === automation.id ? automation : item)),
    );
    return automation;
  };

  const execute = async (
    automation: ScheduledAutomation,
    preserveSchedule: boolean,
  ): Promise<ScheduledAutomation> => {
    if (runningIds.has(automation.id)) return automation;
    runningIds.add(automation.id);
    const startedAt = new Date(now()).toISOString();

    try {
      await replace({
        ...automation,
        lastRunAt: startedAt,
        lastStatus: "running",
        lastError: undefined,
      });
      const result = await deps.runPrompt(automation);
      let completed: ScheduledAutomation = {
        ...automation,
        lastRunAt: startedAt,
        lastStatus: "succeeded",
        lastError: undefined,
        ...(result?.sessionId ? { sessionId: result.sessionId } : {}),
      };
      if (!preserveSchedule) {
        if (automation.schedule.type === "once") {
          completed = { ...completed, enabled: false, nextRunAt: undefined };
          await deps.alarms.clear(alarmName(automation.id));
        } else if (automation.schedule.type === "daily") {
          completed = await scheduleAlarm(completed);
        } else {
          const next = computeNextAutomationRun(automation.schedule, now());
          completed = {
            ...completed,
            ...(next ? { nextRunAt: new Date(next).toISOString() } : {}),
          };
        }
      }
      return replace(completed);
    } catch (error) {
      let failed: ScheduledAutomation = {
        ...automation,
        lastRunAt: startedAt,
        lastStatus: "failed",
        lastError: error instanceof Error ? error.message : String(error),
      };
      if (!preserveSchedule && automation.schedule.type === "once") {
        failed = { ...failed, enabled: false, nextRunAt: undefined };
        await deps.alarms.clear(alarmName(automation.id));
      } else if (!preserveSchedule && automation.schedule.type === "daily") {
        failed = await scheduleAlarm(failed);
      } else if (!preserveSchedule && automation.schedule.type === "interval") {
        const next = computeNextAutomationRun(automation.schedule, now());
        failed = {
          ...failed,
          ...(next ? { nextRunAt: new Date(next).toISOString() } : {}),
        };
      }
      return replace(failed);
    } finally {
      runningIds.delete(automation.id);
    }
  };

  const manager: ScheduledAutomationManager = {
    async initialize() {
      const current = await read();
      // No automations (the common case) → nothing to reconcile; skip the
      // alarm churn and the storage write-back this would do on every
      // service-worker cold start.
      if (current.length === 0) return;
      const scheduled = await Promise.all(current.map(scheduleAlarm));
      const byId = new Map(scheduled.map((item) => [item.id, item]));
      await mutate((latest) => latest.map((item) => byId.get(item.id) ?? item));
    },

    list: read,

    async save(draft) {
      const name = draft.name.trim();
      const prompt = draft.prompt.trim();
      if (!name || !prompt) throw new Error("Name and prompt are required");
      const scheduleError = validateScheduledAutomationSchedule(draft.schedule);
      if (scheduleError) throw new Error(scheduleError);

      const existing = draft.id
        ? (await read()).find((item) => item.id === draft.id)
        : undefined;
      const timestamp = new Date(now()).toISOString();
      const candidate: ScheduledAutomation = {
        ...(existing ?? {}),
        id: existing?.id ?? createId(),
        name,
        prompt,
        schedule: draft.schedule,
        enabled: draft.enabled ?? existing?.enabled ?? true,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      const scheduled = await scheduleAlarm(candidate);
      await mutate((current) => {
        const without = current.filter((item) => item.id !== scheduled.id);
        return [...without, scheduled];
      });
      return scheduled;
    },

    async remove(id) {
      await deps.alarms.clear(alarmName(id));
      await mutate((current) => current.filter((item) => item.id !== id));
    },

    async toggle(id, enabled) {
      const automation = (await read()).find((item) => item.id === id);
      if (!automation) throw new Error("Automation not found");
      const scheduled = await scheduleAlarm({
        ...automation,
        enabled,
        updatedAt: new Date(now()).toISOString(),
      });
      return replace(scheduled);
    },

    async runNow(id) {
      const automation = (await read()).find((item) => item.id === id);
      if (!automation) throw new Error("Automation not found");
      return execute(automation, true);
    },

    async handleAlarm(name) {
      if (!name.startsWith(SCHEDULED_AUTOMATION_ALARM_PREFIX)) return false;
      const id = name.slice(SCHEDULED_AUTOMATION_ALARM_PREFIX.length);
      const automation = (await read()).find((item) => item.id === id);
      if (automation?.enabled) await execute(automation, false);
      return true;
    },

    async handleRequest(request) {
      switch (request.request) {
        case "scheduled-automation-list":
          return manager.list();
        case "scheduled-automation-save":
          return manager.save(request.automation);
        case "scheduled-automation-delete":
          await manager.remove(request.id);
          return { success: true };
        case "scheduled-automation-toggle":
          return manager.toggle(request.id, request.enabled);
        case "scheduled-automation-run":
          return manager.runNow(request.id);
      }
    },
  };

  return manager;
}
