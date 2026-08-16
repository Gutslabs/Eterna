import type { ExternalPreviewRequest } from "@eterna/react/components/preview/external-preview";
import { sanitizeSvgMarkup } from "./sanitize-svg";

/**
 * Opens a chat media preview OUTSIDE the panel.
 *
 * Primary: relay to the active tab's content script, which projects a modal
 * onto the page itself — the panel column is too narrow to read a diagram.
 * Fallback (restricted pages, detached panel windows, or a page that rejected
 * the payload): a new tab with the media. Returning false hands control back
 * to the in-panel lightbox as the last resort, so the click never dies
 * silently.
 */
export async function openPreviewOnPage(
  request: ExternalPreviewRequest,
): Promise<boolean> {
  const payload = { ...request };

  // Composer attachments arrive as blob: URLs minted in THIS document — the
  // host page lives on another origin and cannot resolve them (the preview
  // came up as a broken image). Inline the bytes before the payload crosses.
  if (payload.src && !payload.src.startsWith("data:")) {
    try {
      payload.src = await toDataUrl(payload.src);
    } catch {
      return false;
    }
  }

  try {
    const response = await chrome.runtime.sendMessage({
      request: "relay-to-active-tab",
      message: { request: "eterna-show-preview", payload },
    });
    if (response?.success) return true;
  } catch {
    // No relay (background asleep / restricted page) — fall through to a tab.
  }

  try {
    const blob = payload.svg
      ? svgDocumentBlob(payload.svg, payload.title)
      : payload.src
        ? await (await fetch(payload.src)).blob()
        : null;
    // Chrome refuses top-level data: navigation, so the tab gets a blob URL.
    if (!blob || !chrome.tabs?.create) return false;
    await chrome.tabs.create({ url: URL.createObjectURL(blob) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Raw mermaid output served as image/svg+xml hits the browser's strict XML
 * parser and dies on its HTML labels ("tag mismatch: br and p"). Serve a small
 * HTML document instead — parsed leniently like any page — with the sanitized
 * SVG inline, scaled up to use the tab (vectors upscale losslessly).
 */
function svgDocumentBlob(markup: string, title?: string): Blob | null {
  const svg = sanitizeSvgMarkup(markup);
  if (!svg) return null;
  const heading = title ? `<h1>${escapeHtml(title)}</h1>` : "";
  const html = `<!doctype html>
<meta charset="utf-8">
<title>${escapeHtml(title ?? "Diagram")}</title>
<style>
  body { margin: 0; min-height: 100vh; background: #0e0f13; color: #e7e8ea;
         display: flex; flex-direction: column; align-items: center;
         padding: 40px 24px; box-sizing: border-box;
         font: 500 15px/1.4 system-ui, sans-serif; }
  h1 { font-size: 15px; font-weight: 600; margin: 0 0 22px; opacity: 0.85; }
  main { background: #16171b; border: 1px solid rgba(255,255,255,0.08);
         border-radius: 16px; padding: 30px; overflow: auto; max-width: 100%; }
  main svg { display: block; width: min(1500px, 92vw) !important;
             height: auto !important; max-width: none !important; }
</style>
${heading}
<main>${svg.outerHTML}</main>`;
  return new Blob([html], { type: "text/html" });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function toDataUrl(src: string): Promise<string> {
  const blob = await (await fetch(src)).blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
