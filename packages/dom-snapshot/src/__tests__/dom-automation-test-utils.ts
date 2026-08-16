/**
 * Helper to set document.body.innerHTML from HTML string
 * Returns a query helper for selecting elements
 */
export function setHtml(html: string) {
  document.body.innerHTML = html;
  return {
    $: <T extends Element = Element>(selector: string) =>
      document.querySelector<T>(selector),
    $$: <T extends Element = Element>(selector: string) =>
      document.querySelectorAll<T>(selector),
  };
}
