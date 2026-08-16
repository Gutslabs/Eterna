/**
 * Page-context opt-out.
 *
 * While the conversation is empty the composer hides the page chip — the
 * welcome card stands in for it — so the card's X is the only way to decline
 * sending the current page. The choice is keyed by URL, so navigating
 * elsewhere re-arms the context for the new page instead of silently keeping
 * the next page out of the first message too.
 */

type OptOutListener = () => void;

let dismissedUrl: string | null = null;
const optOutListeners = new Set<OptOutListener>();

function publishOptOut(next: string | null): void {
  if (dismissedUrl === next) return;
  dismissedUrl = next;
  for (const listener of optOutListeners) listener();
}

export function getDismissedPageUrl(): string | null {
  return dismissedUrl;
}

export function subscribePageContextOptOut(
  listener: OptOutListener,
): () => void {
  optOutListeners.add(listener);
  return () => optOutListeners.delete(listener);
}

/** Takes the raw context metadata value, which is typed `unknown`. */
export function isPageContextDismissed(url: unknown): boolean {
  return typeof url === "string" && dismissedUrl === url;
}

export function dismissPageContext(url: string): void {
  publishOptOut(url);
}

export function restorePageContext(): void {
  publishOptOut(null);
}
