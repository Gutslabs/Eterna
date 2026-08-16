import { tool } from "@eterna/core";
import { z } from "zod";

/**
 * The one sanctioned way to draw. Prompt-level "use mermaid, never ASCII"
 * directives failed reproducibly — asked in free text for a timeline, the
 * model reached for pipe-and-dash art even with the ban as the entire system
 * prompt, and that art collapses into gibberish in the narrow sidebar. Routed
 * through a schema the same model produced clean mermaid on the first try:
 * the string parameter leaves free-text habits no room. The tool holds no
 * state — the chat renders the diagram straight from the call's arguments,
 * like update_plan.
 */
export const renderDiagramTool = tool({
  name: "render_diagram",
  description:
    "Draw a diagram the user will see rendered as a real picture. This is " +
    "the ONLY way to draw — never sketch diagrams, timelines, trees or " +
    "charts out of text characters in a reply; that art does not render. " +
    "Use it when the shape of the answer IS the answer: a flow, sequence, " +
    "hierarchy, state machine, timeline, comparison or architecture. The " +
    "diagram appears in a narrow sidebar, so prefer top-down layouts, keep " +
    "labels to a few words, and stay under roughly a dozen nodes. Skip it " +
    "when a sentence or list already answers the question.",
  parameters: z.object({
    mermaid: z
      .string()
      .min(1)
      .describe(
        "Valid mermaid source. Pick the type that fits: flowchart TD, " +
          "sequenceDiagram, stateDiagram-v2, erDiagram, timeline, mindmap, " +
          "gantt, pie, quadrantChart.",
      ),
    title: z
      .string()
      .optional()
      .describe("Short caption shown above the diagram"),
  }),
  execute: async ({ mermaid }) => {
    const kind = mermaid.trim().split(/\s/, 1)[0] ?? "diagram";
    return `Diagram rendered for the user (${kind}). Do not repeat its contents as text.`;
  },
});
