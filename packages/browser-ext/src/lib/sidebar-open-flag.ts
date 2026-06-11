/**
 * Per-tab sidebar open flag
 *
 * The docked sidebar's open/closed state lives in the page's `sessionStorage`,
 * which is scoped to a single tab and survives same-origin navigation. Unlike a
 * global `chrome.storage` flag, opening the panel in one tab never opens it in
 * the others, and there is no cross-tab change event to fan out — so every tab
 * is opened independently, on demand.
 */

const OPEN_FLAG_KEY = "__aipex_sidebar_open";

export function readSidebarOpen(): boolean {
  try {
    return sessionStorage.getItem(OPEN_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSidebarOpen(open: boolean): void {
  try {
    if (open) {
      sessionStorage.setItem(OPEN_FLAG_KEY, "1");
    } else {
      sessionStorage.removeItem(OPEN_FLAG_KEY);
    }
  } catch {
    // sessionStorage can be unavailable on sandboxed/blocked pages — ignore.
  }
}
