import type { ToolSchema } from "./types.js";

// ===== Intervention Tools =====
export const interventionToolSchemas: ToolSchema[] = [
  {
    name: "list_interventions",
    description:
      "List all available human intervention types. Use this to discover what interventions the AI can request from the user.",
    inputSchema: {
      type: "object",
      properties: {
        enabledOnly: {
          type: "boolean",
          description: "If true, only return enabled interventions",
        },
      },
      required: [],
    },
  },
  {
    name: "get_intervention_info",
    description:
      "Get detailed information about a specific intervention type, including input/output schemas and examples.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description:
            'The type of intervention to get information about (e.g., "monitor-operation", "voice-input", "user-selection")',
        },
      },
      required: ["type"],
    },
  },
  {
    name: "request_intervention",
    description:
      "Request a human intervention. This will pause AI execution and wait for user input. Use this when you need the user to perform an action or provide information that cannot be obtained programmatically.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description:
            'The type of intervention to request (e.g., "monitor-operation", "voice-input", "user-selection")',
        },
        params: {
          description: "Type-specific parameters for the intervention",
        },
        timeout: {
          type: "number",
          description: "Timeout in seconds (default: 300)",
        },
        reason: {
          type: "string",
          description:
            "A clear explanation to the user about why you need their input",
        },
      },
      required: ["type"],
    },
  },
  {
    name: "cancel_intervention",
    description:
      "Cancel the currently active intervention. Use this if you realize the intervention is no longer needed.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description:
            "Optional intervention ID to cancel. If not provided, cancels the current active intervention.",
        },
      },
      required: [],
    },
  },
];
