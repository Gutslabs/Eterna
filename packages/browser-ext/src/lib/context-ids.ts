/**
 * Shared context-item ids. Standalone so light modules (e.g. the transcript
 * feed and its tests) can reference them without pulling the context
 * loader's heavy import chain (tabs sync → browser-runtime barrel).
 */
export const CURRENT_PAGE_CONTEXT_ID = "aipex-current-page";
