import type { KeyValueStorage } from "@eterna/core";
import { describe, expect, it, vi } from "vitest";
import {
  createScheduledAutomationManager,
  SCHEDULED_AUTOMATION_ALARM_PREFIX,
} from "./scheduled-automations";

function createStorage(): KeyValueStorage<unknown> {
  let value: unknown = null;
  return {
    async save(_key, next) {
      value = next;
    },
    async load() {
      return value;
    },
    async update(_key, updater) {
      value = updater(value);
      return value;
    },
    async delete() {
      value = null;
    },
    async listAll() {
      return value === null ? [] : [value];
    },
    async query(predicate) {
      return value !== null && predicate(value) ? [value] : [];
    },
    watch() {
      return () => {};
    },
  };
}

describe("scheduled automation manager", () => {
  it("creates an alarm and completes a one-time prompt", async () => {
    const alarms = new Map<
      string,
      { when: number; periodInMinutes?: number }
    >();
    const runPrompt = vi.fn().mockResolvedValue({ sessionId: "session-1" });
    const manager = createScheduledAutomationManager({
      storage: createStorage(),
      alarms: {
        create(name, info) {
          alarms.set(name, info);
        },
        clear(name) {
          return alarms.delete(name);
        },
      },
      runPrompt,
      now: () => Date.parse("2026-08-01T10:00:00.000Z"),
      createId: () => "daily-brief",
    });

    const saved = await manager.save({
      name: "Brief",
      prompt: "Summarize my open tabs",
      schedule: { type: "once", runAt: "2026-08-01T11:00:00.000Z" },
    });
    expect(alarms.has(`${SCHEDULED_AUTOMATION_ALARM_PREFIX}${saved.id}`)).toBe(
      true,
    );

    await manager.handleAlarm(
      `${SCHEDULED_AUTOMATION_ALARM_PREFIX}${saved.id}`,
    );
    const [completed] = await manager.list();
    expect(runPrompt).toHaveBeenCalledWith(saved);
    expect(completed).toMatchObject({
      enabled: false,
      lastStatus: "succeeded",
      sessionId: "session-1",
    });
  });

  it("rejects incomplete drafts", async () => {
    const manager = createScheduledAutomationManager({
      storage: createStorage(),
      alarms: { create() {}, clear: () => false },
      runPrompt: vi.fn(),
    });
    await expect(
      manager.save({
        name: "",
        prompt: "Do it",
        schedule: { type: "interval", everyMinutes: 5 },
      }),
    ).rejects.toThrow("Name and prompt are required");
  });
});
