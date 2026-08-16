import { describe, expect, it } from "vitest";
import { updatePlanTool } from "./plan";

type Invocable = { invoke: (ctx: unknown, input: string) => Promise<unknown> };

describe("update_plan tool", () => {
  it("acknowledges with completion progress", async () => {
    const result = await (updatePlanTool as unknown as Invocable).invoke(
      {},
      JSON.stringify({
        items: [
          { text: "Open the pricing page", status: "completed" },
          { text: "Extract the tiers", status: "in_progress" },
          { text: "Summarize differences", status: "pending" },
        ],
      }),
    );
    expect(String(result)).toContain("1/3");
  });

  it("rejects an empty plan", async () => {
    const result = await (updatePlanTool as unknown as Invocable).invoke(
      {},
      JSON.stringify({ items: [] }),
    );
    // Zod validation failure surfaces as an error result, not a crash.
    expect(String(result)).not.toContain("0/0");
  });
});
