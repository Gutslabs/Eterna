import type { ToolSchema } from "./types.js";

// ===== Screenshot Tools =====
export const screenshotToolSchemas: ToolSchema[] = [
  {
    name: "capture_screenshot",
    description: `[HIGH-COST FALLBACK] Capture screenshot of current visible tab.

TRY search_elements FIRST: For most interactions (clicking, filling, reading), use search_elements + UID-based tools. They are faster and don't send images to LLM.

USE THIS ONLY WHEN:
- search_elements cannot find the target after 2 query attempts
- You need to see visual layout, images, charts, or canvas content
- The page uses non-standard rendering that snapshots miss

When sendToLLM=true: Sends image to LLM (higher latency/cost, may capture sensitive on-screen data) and enables the computer tool for coordinate-based actions. NOTE: This tool requires focus mode.`,
    inputSchema: {
      type: "object",
      properties: {
        sendToLLM: {
          type: "boolean",
          description:
            "Whether to send the screenshot to LLM for visual analysis. When true, enables computer tool for coordinate actions. Use sparingly - adds latency and token cost.",
        },
      },
      required: [],
    },
  },
  {
    name: "capture_tab_screenshot",
    description: `[HIGH-COST FALLBACK] Capture screenshot of a specific tab by ID.

TRY search_elements FIRST: Visual verification is expensive. Use search_elements + UID-based tools for most interactions.

USE THIS ONLY WHEN:
- Visual verification is essential
- search_elements failed to find the target
- You need to see images, charts, or canvas content

When sendToLLM=true: Sends image to LLM (higher latency/cost) and enables coordinate-based actions. NOTE: This tool requires focus mode.`,
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "number",
          description: "The ID of the tab to capture",
        },
        sendToLLM: {
          type: "boolean",
          description:
            "Whether to send the screenshot to LLM for visual analysis. When true, enables computer tool. Use sparingly.",
        },
      },
      required: ["tabId"],
    },
  },

  {
    name: "capture_screenshot_with_highlight",
    description: `[HIGH-COST] Capture screenshot of the current visible tab, optionally highlighting and cropping to a specific element identified by CSS selector. The screenshot is always sent to the LLM for visual analysis.

PREFER search_elements for finding/interacting with elements. Use this only when you need to visually verify element appearance or layout. NOTE: This tool requires focus mode.`,
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector of element to highlight/focus on",
        },
        cropToElement: {
          type: "boolean",
          description:
            "Whether to crop the screenshot to the element region (plus padding)",
        },
        padding: {
          type: "number",
          description:
            "Padding around element in pixels when cropping (default: 50)",
        },
        sendToLLM: {
          type: "boolean",
          description:
            "Whether to send the screenshot to LLM for visual analysis. Defaults to true.",
        },
      },
      required: [],
    },
  },
];
