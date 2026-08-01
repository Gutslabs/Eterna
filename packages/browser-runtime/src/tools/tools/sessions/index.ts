import { tool } from "@aipexstudio/aipex-core";
import { z } from "zod";

interface ClosedSessionEntry {
  sessionId: string;
  type: "tab" | "window";
  title?: string;
  url?: string;
  tabCount?: number;
  lastModified: number;
}

function toEntry(session: chrome.sessions.Session): ClosedSessionEntry | null {
  if (session.tab?.sessionId) {
    return {
      sessionId: session.tab.sessionId,
      type: "tab",
      title: session.tab.title ?? "",
      url: session.tab.url ?? "",
      lastModified: session.lastModified ?? 0,
    };
  }
  if (session.window?.sessionId) {
    const tabs = session.window.tabs ?? [];
    return {
      sessionId: session.window.sessionId,
      type: "window",
      title: tabs[0]?.title ?? "",
      tabCount: tabs.length,
      lastModified: session.lastModified ?? 0,
    };
  }
  return null;
}

export async function getRecentlyClosedSessions(maxResults?: number): Promise<{
  success: boolean;
  sessions?: ClosedSessionEntry[];
  error?: string;
}> {
  try {
    const sessions = await chrome.sessions.getRecentlyClosed(
      maxResults ? { maxResults } : undefined,
    );
    return {
      success: true,
      sessions: sessions
        .map(toEntry)
        .filter((entry): entry is ClosedSessionEntry => entry !== null),
    };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function restoreSession(sessionId?: string): Promise<{
  success: boolean;
  restored?: { type: "tab" | "window"; title?: string; tabCount?: number };
  error?: string;
}> {
  try {
    const session = await chrome.sessions.restore(sessionId);
    if (session.tab) {
      return {
        success: true,
        restored: { type: "tab", title: session.tab.title ?? "" },
      };
    }
    if (session.window) {
      const tabs = session.window.tabs ?? [];
      return {
        success: true,
        restored: {
          type: "window",
          title: tabs[0]?.title ?? "",
          tabCount: tabs.length,
        },
      };
    }
    return { success: true };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const getRecentlyClosedSessionsTool = tool({
  name: "get_recently_closed",
  description:
    "List recently closed tabs and windows with their session IDs, so a specific one can be restored with restore_session.",
  parameters: z.object({
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(25)
      .nullable()
      .optional()
      .describe("Maximum number of entries to return (default: all, max 25)"),
  }),
  execute: async ({ maxResults }) => {
    return await getRecentlyClosedSessions(maxResults ?? undefined);
  },
});

export const restoreSessionTool = tool({
  name: "restore_session",
  description:
    "Reopen a recently closed tab or window. Pass a session ID from get_recently_closed, or omit it to restore the most recently closed entry.",
  parameters: z.object({
    sessionId: z
      .string()
      .nullable()
      .optional()
      .describe(
        "Session ID from get_recently_closed. Omit to restore the most recently closed tab/window.",
      ),
  }),
  execute: async ({ sessionId }) => {
    return await restoreSession(sessionId ?? undefined);
  },
});
