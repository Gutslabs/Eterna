/**
 * Shared contract for the "auto-send this text to the chat" hand-off.
 *
 * Producers (the in-page "Ask Eterna" selection bar, the right-click context
 * menu in the background worker) write the payload to chrome.storage.local;
 * the visible chat panel consumes and submits it via SelectionAutoSend.
 */

export const PENDING_AUTOSEND_KEY = "eterna-pending-autosend";

export interface PendingAutosendPayload {
  text: string;
  ts: number;
}

export async function writePendingAutosend(text: string): Promise<void> {
  const payload: PendingAutosendPayload = { text, ts: Date.now() };
  await chrome.storage.local.set({ [PENDING_AUTOSEND_KEY]: payload });
}
