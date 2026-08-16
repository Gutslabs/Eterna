import type { ToolSchema } from "./types.js";

// ===== Memory Tools =====
export const memoryToolSchemas: ToolSchema[] = [
  {
    name: "remember",
    description:
      "Save a durable fact about the user or their preferences to long-term memory so you recall it in future conversations. Use it when the user shares a lasting preference or fact, or asks you to remember something (e.g. 'I'm a Solidity dev', 'always answer in Turkish', 'my main repo is X'). Do NOT save transient or conversation-specific details. Keep each memory to one concise sentence.",
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The fact to remember, as one concise sentence.",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "forget",
    description:
      "Remove a fact from long-term memory by its id (ids are shown in the MEMORY section of your instructions). Use when a saved memory is wrong, outdated, or the user asks you to forget it.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The id of the memory to remove (e.g. 'mem-...').",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "recall",
    description:
      "Search the user's long-term memory for facts, preferences and past context beyond what your instructions already show. Use it when the user references something from before ('that repo I mentioned', 'my usual setup', 'like last time') or when personal context would change your answer. Returns matching memories; backed by the local Supermemory server when configured, otherwise the locally saved facts.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "What to look for, e.g. 'preferred language', 'main repo'.",
        },
      },
      required: ["query"],
    },
  },
];
