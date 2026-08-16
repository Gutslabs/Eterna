import type { ToolSchema } from "./types.js";

// ===== History Tools =====
export const historyToolSchemas: ToolSchema[] = [
  {
    name: "get_recent_history",
    description: "Get recent browsing history (last 7 days)",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of history items to return",
        },
      },
      required: [],
    },
  },
  {
    name: "search_history",
    description: "Search browsing history",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Maximum number of results" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_most_visited_sites",
    description: "Get the most visited sites in the last 30 days",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of sites to return",
        },
      },
      required: [],
    },
  },
];
