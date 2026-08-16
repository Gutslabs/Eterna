import type { ToolSchema } from "./types.js";

// ===== Session Tools =====
export const sessionToolSchemas: ToolSchema[] = [
  {
    name: "get_recently_closed",
    description:
      "List recently closed tabs and windows with their session IDs, so a specific one can be restored with restore_session.",
    inputSchema: {
      type: "object",
      properties: {
        maxResults: {
          type: "number",
          description:
            "Maximum number of entries to return (default: all, max 25)",
        },
      },
      required: [],
    },
  },
  {
    name: "restore_session",
    description:
      "Reopen a recently closed tab or window. Pass a session ID from get_recently_closed, or omit it to restore the most recently closed entry.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description:
            "Session ID from get_recently_closed. Omit to restore the most recently closed tab/window.",
        },
      },
      required: [],
    },
  },
];
