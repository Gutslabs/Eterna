/**
 * Swallow the benign console noise an extension page / content script emits when
 * the extension is reloaded or updated: the old code keeps running for a moment
 * with a dead `chrome.*` context, throwing "Extension context invalidated" — and
 * generic null-refs as the chrome APIs vanish (e.g. reading 'onChanged' off an
 * undefined `chrome.storage`). These are harmless teardown errors.
 *
 * We suppress them, but conservatively: the explicit "context invalidated"
 * message is always stale, while a generic null-ref is only suppressed when the
 * extension context is actually gone — so real bugs in a live context still
 * surface in the console.
 */
export function suppressStaleContextErrors(): void {
  const contextDead = (): boolean => {
    try {
      return !chrome?.runtime?.id;
    } catch {
      return true;
    }
  };

  const isStaleError = (message: unknown): boolean => {
    if (typeof message !== "string") return false;
    if (message.includes("Extension context invalidated")) return true;
    return (
      contextDead() &&
      /Cannot read properties of undefined \(reading '(onChanged|getURL|onMessage|sendMessage|local|connect|query|id)'\)/.test(
        message,
      )
    );
  };

  window.addEventListener(
    "error",
    (event) => {
      if (isStaleError(event.message)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );

  window.addEventListener("unhandledrejection", (event) => {
    const message =
      (event.reason as { message?: string } | undefined)?.message ??
      String(event.reason);
    if (isStaleError(message)) {
      event.preventDefault();
    }
  });
}
