import type { ToolSchema } from "./types.js";

export const browserToolSchemas: ToolSchema[] = [
  {
    name: "update_plan",
    description:
      "Maintain your visible task plan for multi-step work. Call it when you start a task with 3+ distinct steps, and again whenever a step's status changes. ALWAYS send the complete list of steps, not a delta. Keep exactly one step in_progress at a time. Skip the plan entirely for trivial or single-step requests.",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed"],
              },
            },
            required: ["text", "status"],
          },
        },
      },
      required: ["items"],
    },
  },
  {
    name: "render_diagram",
    description:
      "Draw a diagram the user will see rendered as a real picture. This is the ONLY way to draw — never sketch diagrams, timelines, trees or charts out of text characters in a reply; that art does not render. Use it when the shape of the answer IS the answer: a flow, sequence, hierarchy, state machine, timeline, comparison or architecture. The diagram appears in a narrow sidebar, so prefer top-down layouts, keep labels to a few words, and stay under roughly a dozen nodes. Skip it when a sentence or list already answers the question.",
    inputSchema: {
      type: "object",
      properties: {
        mermaid: { type: "string" },
        title: { type: "string" },
      },
      required: ["mermaid"],
    },
  },
  // ===== Browser Tools =====
  {
    name: "get_all_tabs",
    description:
      "Get all open tabs across all windows with their IDs, titles, and URLs",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_current_tab",
    description: "Get information about the currently active tab",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "switch_to_tab",
    description: "Switch to a specific tab by ID or URL pattern",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "number",
          description: "The ID of the tab to switch to",
        },
      },
      required: ["tabId"],
    },
  },
  {
    name: "create_new_tab",
    description: "Create a new tab with the specified URL",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to open in the new tab" },
      },
      required: ["url"],
    },
  },
  {
    name: "get_tab_info",
    description: "Get detailed information about a specific tab",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "The ID of the tab" },
      },
      required: ["tabId"],
    },
  },
  {
    name: "close_tab",
    description: "Close a specific tab or the current tab",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "The ID of the tab to close" },
      },
      required: ["tabId"],
    },
  },
  {
    name: "ungroup_tabs",
    description: "Remove all tab groups in the current window",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];
