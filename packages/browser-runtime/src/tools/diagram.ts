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
 *
 * Two inputs, one picture: `mermaid` for quick structural diagrams, `svg` for
 * editorial quality authored under the diagram-design skill's rules. The svg
 * is sanitized before rendering (scripts, handlers and js-urls stripped), so
 * page-injected instructions cannot smuggle anything executable through it.
 */
export const renderDiagramTool = tool({
  name: "render_diagram",
  description:
    "Draw a diagram the user will see rendered as a real picture. This is " +
    "the ONLY way to draw — never sketch diagrams, timelines, trees or " +
    "charts out of text characters in a reply; that art does not render. " +
    "Use it when the shape of the answer IS the answer: a flow, sequence, " +
    "hierarchy, state machine, timeline, comparison or architecture. " +
    "Provide exactly ONE of: `mermaid` (quick structural diagrams) or `svg` " +
    "(a single self-contained inline <svg> — the editorial path; load the " +
    "diagram-design skill first and follow its type reference). The diagram " +
    "appears in a narrow sidebar and can be opened full-page, so prefer " +
    "top-down layouts and short labels. Skip it when a sentence or list " +
    "already answers the question.",
  parameters: z.object({
    mermaid: z
      .string()
      .optional()
      .describe(
        "Valid mermaid source. Pick the type that fits: flowchart TD, " +
          "sequenceDiagram, stateDiagram-v2, erDiagram, timeline, mindmap, " +
          "gantt, pie, quadrantChart.",
      ),
    svg: z
      .string()
      .optional()
      .describe(
        "One complete inline <svg> element with a viewBox, styles inline or " +
          "in a <style> inside the svg, no external resources and no " +
          "scripts. Author it under the diagram-design skill's rules.",
      ),
    title: z
      .string()
      .optional()
      .describe("Short caption shown above the diagram"),
  }),
  execute: async ({ mermaid, svg }) => {
    if (!mermaid?.trim() && !svg?.trim()) {
      return "Nothing rendered: provide exactly one of `mermaid` or `svg`.";
    }
    const kind = mermaid
      ? (mermaid.trim().split(/\s/, 1)[0] ?? "diagram")
      : "svg";
    return `Diagram rendered for the user (${kind}). Do not repeat its contents as text.`;
  },
});
