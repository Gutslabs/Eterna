/**
 * Get the currently active tab.
 *
 * The agent runs in the background service worker, which has no "current
 * window". `chrome.tabs.query({ currentWindow: true })` is unreliable there —
 * it can return nothing when a side panel (or any non-tab surface) holds focus,
 * which made tools like capture_screenshot fail with "No active tab found".
 * Resolve the last-focused *normal* browser window's active tab instead, then
 * fall back to the older queries.
 *
 * @throws Error if no active tab is found
 */
export async function getActiveTab(): Promise<chrome.tabs.Tab> {
  let [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });

  if (!tab?.id) {
    try {
      const win = await chrome.windows.getLastFocused({
        windowTypes: ["normal"],
      });
      if (win.id !== undefined) {
        [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
      }
    } catch {
      // No normal window available — fall through to the legacy query.
    }
  }

  if (!tab?.id) {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  }

  if (!tab?.id) {
    throw new Error("No active tab found");
  }

  return tab;
}

/**
 * Execute a script in a specific tab
 */
export async function executeScriptInTab<T, Args extends any[]>(
  tabId: number,
  func: (...args: Args) => T,
  args: Args,
): Promise<T> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args,
  });

  return results[0]?.result as T;
}

/**
 * Execute a script in the active tab
 */
export async function executeScriptInActiveTab<T, Args extends any[]>(
  func: (...args: Args) => T,
  args: Args,
): Promise<T> {
  const tab = await getActiveTab();
  return await executeScriptInTab(tab.id!, func, args);
}
