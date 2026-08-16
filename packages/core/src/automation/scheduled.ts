export type ScheduledAutomationSchedule =
  | { type: "once"; runAt: string }
  | { type: "interval"; everyMinutes: number; startAt?: string }
  | { type: "daily"; time: string };

export type ScheduledAutomationStatus =
  | "idle"
  | "running"
  | "succeeded"
  | "failed";

export interface ScheduledAutomation {
  id: string;
  name: string;
  prompt: string;
  schedule: ScheduledAutomationSchedule;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  nextRunAt?: string;
  lastRunAt?: string;
  lastStatus?: ScheduledAutomationStatus;
  lastError?: string;
  sessionId?: string;
}

const MINUTE_MS = 60_000;

export function validateScheduledAutomationSchedule(
  schedule: ScheduledAutomationSchedule,
): string | null {
  if (schedule.type === "once") {
    return Number.isFinite(Date.parse(schedule.runAt))
      ? null
      : "Run time must be a valid date";
  }
  if (schedule.type === "interval") {
    if (schedule.startAt && !Number.isFinite(Date.parse(schedule.startAt))) {
      return "Interval start time must be a valid date";
    }
    return Number.isFinite(schedule.everyMinutes) && schedule.everyMinutes >= 1
      ? null
      : "Interval must be at least one minute";
  }
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time)
    ? null
    : "Daily time must use HH:mm";
}

export function computeNextAutomationRun(
  schedule: ScheduledAutomationSchedule,
  after = Date.now(),
): number | null {
  if (validateScheduledAutomationSchedule(schedule)) return null;
  if (schedule.type === "once") {
    const runAt = Date.parse(schedule.runAt);
    return runAt > after ? runAt : null;
  }
  if (schedule.type === "interval") {
    const period = schedule.everyMinutes * MINUTE_MS;
    const anchor = schedule.startAt ? Date.parse(schedule.startAt) : after;
    if (anchor > after) return anchor;
    return anchor + (Math.floor((after - anchor) / period) + 1) * period;
  }

  const [hours, minutes] = schedule.time.split(":").map(Number);
  const next = new Date(after);
  next.setHours(hours ?? 0, minutes ?? 0, 0, 0);
  if (next.getTime() <= after) next.setDate(next.getDate() + 1);
  return next.getTime();
}
