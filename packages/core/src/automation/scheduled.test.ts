import { describe, expect, it } from "vitest";
import {
  computeNextAutomationRun,
  validateScheduledAutomationSchedule,
} from "./scheduled.js";

describe("scheduled automations", () => {
  it("computes the next interval from a stable anchor", () => {
    const next = computeNextAutomationRun(
      {
        type: "interval",
        everyMinutes: 15,
        startAt: "2026-08-01T10:00:00.000Z",
      },
      Date.parse("2026-08-01T10:31:00.000Z"),
    );
    expect(next).toBe(Date.parse("2026-08-01T10:45:00.000Z"));
  });

  it("does not reschedule an expired one-time automation", () => {
    expect(
      computeNextAutomationRun(
        { type: "once", runAt: "2026-08-01T10:00:00.000Z" },
        Date.parse("2026-08-01T10:00:00.000Z"),
      ),
    ).toBeNull();
  });

  it("validates minimum intervals and daily time", () => {
    expect(
      validateScheduledAutomationSchedule({
        type: "interval",
        everyMinutes: 0,
      }),
    ).not.toBeNull();
    expect(
      validateScheduledAutomationSchedule({ type: "daily", time: "23:59" }),
    ).toBeNull();
    expect(
      validateScheduledAutomationSchedule({
        type: "interval",
        everyMinutes: 5,
        startAt: "not-a-date",
      }),
    ).not.toBeNull();
  });
});
