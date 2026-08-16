/**
 * Full-page media preview, projected into the host page.
 *
 * The chat lives in a ~400px column (side panel or overlay), so a lightbox
 * inside it can never make a diagram readable. This renders the preview into
 * the page itself: plain DOM in a closed shadow root (host page CSS cannot
 * reach in, ours cannot leak out), no React and no assets so it works on
 * CSP-strict sites.
 *
 * The payload crosses from the panel through the background relay, so it is
 * sanitized before touching the page. SVG is parsed with the HTML parser, not
 * the XML one: real mermaid output carries HTML labels and entities that are
 * invalid XML, and a strict parse would reject every real diagram. The lenient
 * parse keeps mermaid's foreignObject labels (their positioning depends on
 * them) while the walk below strips everything executable.
 */

import { sanitizeSvgMarkup } from "../../lib/sanitize-svg";

export interface PagePreviewPayload {
  title?: string;
  src?: string;
  svg?: string;
}

const HOST_ID = "eterna-page-preview";

export { sanitizeSvgMarkup } from "../../lib/sanitize-svg";

function isSafeImageSrc(src: string): boolean {
  return /^(data:image\/|blob:|https:)/.test(src);
}

export function closePagePreview(): void {
  document.getElementById(HOST_ID)?.remove();
}

export function showPagePreview(payload: PagePreviewPayload): boolean {
  let media: Element | null = null;
  let kind: "svg" | "image" = "image";

  if (payload.svg) {
    const svg = sanitizeSvgMarkup(payload.svg);
    if (svg) {
      media = document.importNode(svg, true);
      kind = "svg";
    }
  } else if (payload.src && isSafeImageSrc(payload.src)) {
    media = Object.assign(document.createElement("img"), {
      src: payload.src,
      alt: payload.title ?? "",
    });
  }
  if (!media) return false;

  closePagePreview();

  const host = document.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = `
    @keyframes eterna-preview-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes eterna-preview-pop {
      from { opacity: 0; transform: translateY(10px) scale(0.975); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .backdrop {
      position: fixed; inset: 0; z-index: 2147483646;
      display: flex; align-items: center; justify-content: center;
      background: rgba(8, 9, 12, 0.72);
      backdrop-filter: blur(10px) saturate(0.9);
      -webkit-backdrop-filter: blur(10px) saturate(0.9);
      cursor: zoom-out; padding: 28px;
      animation: eterna-preview-in 160ms ease-out;
    }
    .frame {
      cursor: default; display: flex; flex-direction: column;
      max-width: min(1480px, 95vw); max-height: 92vh;
      animation: eterna-preview-pop 220ms cubic-bezier(0.2, 0.9, 0.3, 1);
    }
    .bar {
      display: flex; align-items: center; gap: 12px;
      padding: 0 4px 10px 6px;
    }
    .title {
      flex: 1; min-width: 0;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      color: rgba(255, 255, 255, 0.92);
      font: 500 13.5px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
      letter-spacing: 0.01em;
      text-shadow: 0 1px 8px rgba(0, 0, 0, 0.6);
    }
    .close {
      flex-shrink: 0; width: 30px; height: 30px;
      display: grid; place-items: center;
      border-radius: 999px; border: 1px solid rgba(255, 255, 255, 0.14);
      background: rgba(255, 255, 255, 0.1); color: rgba(255, 255, 255, 0.85);
      cursor: pointer; padding: 0;
      transition: background 120ms ease, color 120ms ease;
    }
    .close:hover { background: rgba(255, 255, 255, 0.22); color: #fff; }
    .close svg { width: 14px; height: 14px; display: block; }
    .zoom {
      flex-shrink: 0; display: flex; align-items: center; gap: 2px;
      border: 1px solid rgba(255, 255, 255, 0.14);
      background: rgba(255, 255, 255, 0.1); border-radius: 999px;
      padding: 2px;
    }
    .zoom button {
      width: 26px; height: 26px; display: grid; place-items: center;
      border: none; border-radius: 999px; background: transparent;
      color: rgba(255, 255, 255, 0.85); cursor: pointer; padding: 0;
      font: 600 15px/1 system-ui, sans-serif;
    }
    .zoom button:hover { background: rgba(255, 255, 255, 0.18); color: #fff; }
    .zoom .pct {
      min-width: 44px; text-align: center;
      color: rgba(255, 255, 255, 0.75);
      font: 500 11.5px/1 system-ui, sans-serif;
      font-variant-numeric: tabular-nums; cursor: pointer;
    }
    .media {
      overflow: auto; border-radius: 16px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      box-shadow: 0 32px 90px rgba(0, 0, 0, 0.55);
    }
    .media.plate {
      background: #ffffff; padding: 26px;
    }
    @media (prefers-color-scheme: dark) {
      .media.plate { background: #16171b; }
    }
    .media.bare {
      background: rgba(12, 13, 16, 0.6); display: flex;
    }
    .media svg { display: block; margin: 0 auto; }
    .media img { display: block; margin: 0 auto; border-radius: 15px; }
  `;

  const backdrop = document.createElement("div");
  backdrop.className = "backdrop";
  const frame = document.createElement("div");
  frame.className = "frame";

  const bar = document.createElement("div");
  bar.className = "bar";
  const title = document.createElement("div");
  title.className = "title";
  title.textContent = payload.title ?? "";
  const close = document.createElement("button");
  close.className = "close";
  close.type = "button";
  close.setAttribute("aria-label", "Close preview");
  close.innerHTML =
    '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2 2l10 10M12 2L2 12"/></svg>';

  const mediaBox = document.createElement("div");
  // Diagrams need a plate behind them (mermaid SVG is transparent); photos
  // read best borderless on the dimmed page.
  mediaBox.className = kind === "svg" ? "media plate" : "media bare";
  mediaBox.append(media);

  // ---- Zoom ----
  // The SVG arrives sized for the ~400px panel it was rendered in; shown as-is
  // it stays panel-small. Vector content upscales losslessly, so size it to
  // fill the modal and let the user push further (buttons, ctrl+wheel; the
  // percentage chip resets). Panning is the media box's native scroll.
  let zoom = 1;
  let baseWidth = 0;
  let baseHeight = 0;

  const readBase = () => {
    if (kind === "svg") {
      const viewBox = (media as SVGSVGElement).viewBox?.baseVal;
      if (viewBox?.width && viewBox?.height) {
        baseWidth = viewBox.width;
        baseHeight = viewBox.height;
      }
    } else {
      const img = media as HTMLImageElement;
      baseWidth = img.naturalWidth;
      baseHeight = img.naturalHeight;
    }
  };

  const fitScale = () => {
    const padding = kind === "svg" ? 52 : 0;
    const availWidth = Math.min(window.innerWidth * 0.95, 1480) - 56 - padding;
    const availHeight = window.innerHeight * 0.92 - 50 - padding;
    return Math.min(availWidth / baseWidth, availHeight / baseHeight);
  };

  const pct = document.createElement("button");
  pct.className = "pct";
  pct.type = "button";
  pct.title = "Reset zoom";

  const applyZoom = () => {
    if (!baseWidth || !baseHeight) return;
    const scale = fitScale() * zoom;
    const target = media as unknown as HTMLElement;
    // Replaces mermaid's inline max-width cap, which would refuse to grow.
    target.setAttribute(
      "style",
      `width:${Math.round(baseWidth * scale)}px;height:auto;max-width:none;`,
    );
    pct.textContent = `${Math.round(scale * 100)}%`;
  };

  const setZoom = (next: number) => {
    zoom = Math.min(6, Math.max(0.3, next));
    applyZoom();
  };

  const zoomWrap = document.createElement("div");
  zoomWrap.className = "zoom";
  const zoomOut = document.createElement("button");
  zoomOut.type = "button";
  zoomOut.setAttribute("aria-label", "Zoom out");
  zoomOut.textContent = "−";
  zoomOut.addEventListener("click", () => setZoom(zoom / 1.25));
  const zoomIn = document.createElement("button");
  zoomIn.type = "button";
  zoomIn.setAttribute("aria-label", "Zoom in");
  zoomIn.textContent = "+";
  zoomIn.addEventListener("click", () => setZoom(zoom * 1.25));
  pct.addEventListener("click", () => setZoom(1));
  zoomWrap.append(zoomOut, pct, zoomIn);
  bar.append(title, zoomWrap, close);

  mediaBox.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom(zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12));
    },
    { passive: false },
  );

  if (kind === "svg") {
    readBase();
    applyZoom();
  } else {
    (media as HTMLImageElement).addEventListener("load", () => {
      readBase();
      applyZoom();
    });
  }

  const onResize = () => applyZoom();
  window.addEventListener("resize", onResize);

  const dispose = () => {
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", onResize);
    host.remove();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      dispose();
    }
  };
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) dispose();
  });
  close.addEventListener("click", dispose);
  document.addEventListener("keydown", onKey, true);

  frame.append(bar, mediaBox);
  backdrop.append(frame);
  shadow.append(style, backdrop);
  document.documentElement.append(host);
  return true;
}
