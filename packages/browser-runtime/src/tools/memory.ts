import { STORAGE_KEYS, tool } from "@aipexstudio/aipex-core";
import { z } from "zod";

/**
 * Long-term user memory — durable facts the agent saves with the `remember`
 * tool and recalls in future conversations. Stored as a flat list in
 * chrome.storage.local and injected into the agent's instructions at build
 * time (see chat-host-init), so the agent always "knows" what it remembers.
 * Local and private; no external service.
 */

export interface MemoryEntry {
  id: string;
  text: string;
  createdAt: number;
}

/** Hard cap so the always-injected block can't grow unbounded. */
const MAX_MEMORIES = 200;

export async function loadMemories(): Promise<MemoryEntry[]> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.MEMORY);
    const value = result[STORAGE_KEYS.MEMORY];
    return Array.isArray(value) ? (value as MemoryEntry[]) : [];
  } catch {
    return [];
  }
}

async function persistMemories(entries: MemoryEntry[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.MEMORY]: entries });
}

function newMemoryId(): string {
  return `mem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Add a fact (deduped, case-insensitive). Returns the new or existing id. */
export async function addMemory(
  content: string,
): Promise<{ saved: boolean; id?: string }> {
  const text = content.trim();
  if (!text) {
    return { saved: false };
  }
  const entries = await loadMemories();
  const existing = entries.find(
    (entry) => entry.text.toLowerCase() === text.toLowerCase(),
  );
  if (existing) {
    return { saved: false, id: existing.id };
  }
  const entry: MemoryEntry = { id: newMemoryId(), text, createdAt: Date.now() };
  await persistMemories([...entries, entry].slice(-MAX_MEMORIES));
  return { saved: true, id: entry.id };
}

/** Remove a fact by id. Returns false when no entry matched. */
export async function removeMemory(id: string): Promise<boolean> {
  const entries = await loadMemories();
  const next = entries.filter((entry) => entry.id !== id);
  if (next.length === entries.length) {
    return false;
  }
  await persistMemories(next);
  return true;
}

/** Markdown block appended to the system prompt; empty when nothing is stored. */
export function renderMemoriesForPrompt(entries: MemoryEntry[]): string {
  if (entries.length === 0) {
    return "";
  }
  const lines = entries
    .map((entry) => `- (${entry.id}) ${entry.text}`)
    .join("\n");
  return [
    "=== MEMORY (what you remember about this user) ===",
    "Durable facts you saved earlier — use them to personalise your help. Call forget with an id to drop one that is wrong or outdated.",
    lines,
  ].join("\n");
}

export const rememberTool = tool({
  name: "remember",
  description:
    "Save a durable fact about the user or their preferences to long-term memory so you recall it in future conversations. Use it when the user shares a lasting preference or fact, or asks you to remember something (e.g. 'I'm a Solidity dev', 'always answer in Turkish', 'my main repo is X'). Do NOT save transient or conversation-specific details. Keep each memory to one concise sentence.",
  parameters: z.object({
    content: z
      .string()
      .describe("The fact to remember, as one concise sentence."),
  }),
  execute: async ({
    content,
  }): Promise<{ success: boolean; id?: string; error?: string }> => {
    const { id } = await addMemory(content);
    return id
      ? { success: true, id }
      : { success: false, error: "Nothing to remember." };
  },
});

export const forgetTool = tool({
  name: "forget",
  description:
    "Remove a fact from long-term memory by its id (ids are shown in the MEMORY section of your instructions). Use when a saved memory is wrong, outdated, or the user asks you to forget it.",
  parameters: z.object({
    id: z.string().describe("The id of the memory to remove (e.g. 'mem-...')."),
  }),
  execute: async ({ id }): Promise<{ success: boolean; error?: string }> => {
    return (await removeMemory(id))
      ? { success: true }
      : { success: false, error: `No memory found with id ${id}.` };
  },
});
