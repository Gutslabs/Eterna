import { tool } from "@eterna/core";
import { z } from "zod";

/**
 * Codex-style visible task plan. The tool holds no state of its own — each
 * call carries the complete list, and the chat UI renders the plan straight
 * from the call's arguments as an animated todo list in the activity rail.
 */
export const updatePlanTool = tool({
  name: "update_plan",
  description:
    "Maintain your visible task plan for multi-step work. Call it when you " +
    "start a task with 3+ distinct steps, and again whenever a step's status " +
    "changes. ALWAYS send the complete list of steps, not a delta. Keep " +
    "exactly one step in_progress at a time. Skip the plan entirely for " +
    "trivial or single-step requests.",
  parameters: z.object({
    items: z
      .array(
        z.object({
          text: z.string().min(1).describe("Short imperative step label"),
          status: z.enum(["pending", "in_progress", "completed"]),
        }),
      )
      .min(1)
      .describe("The full plan, in execution order"),
  }),
  execute: async ({ items }) => {
    const completed = items.filter(
      (item) => item.status === "completed",
    ).length;
    return `Plan updated: ${completed}/${items.length} steps completed.`;
  },
});
