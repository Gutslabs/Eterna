import { describe, expect, it } from "vitest";
import { parseTasks } from "./dataset.js";

describe("parseTasks", () => {
  it("normalizes valid Online-Mind2Web tasks and skips invalid rows", () => {
    expect(
      parseTasks([
        {
          task_id: 42,
          confirmed_task: "Find the support page",
          website: "example.com",
          level: "easy",
          reference_length: 3,
        },
        { confirmed_task: "missing website" },
      ]),
    ).toEqual([
      {
        task_id: "42",
        confirmed_task: "Find the support page",
        website: "example.com",
        level: "easy",
        reference_length: 3,
      },
    ]);
  });

  it("rejects unusable datasets", () => {
    expect(() => parseTasks({})).toThrow("Dataset root is not an array");
    expect(() => parseTasks([{ nope: true }])).toThrow(
      "Dataset contained no usable tasks",
    );
  });
});
