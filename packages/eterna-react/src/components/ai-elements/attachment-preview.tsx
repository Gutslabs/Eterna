"use client";

import { CheckIcon, CopyIcon, FileTextIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useExternalPreview } from "../preview/external-preview";

const TEXT_EXTENSIONS = ["txt", "md", "json", "csv", "log"];

/** Text-ish attachments are viewable in the text overlay. */
export function isTextAttachment(
  mediaType?: string,
  filename?: string,
): boolean {
  if (mediaType?.startsWith("text/")) return true;
  const ext = filename?.split(".").pop()?.toLowerCase();
  return TEXT_EXTENSIONS.includes(ext ?? "");
}

/**
 * Read a text attachment's content from its url. fetch() natively handles
 * data:, blob: and http(s): — the manual data-url decode is only the fallback
 * for surfaces where fetching data: is blocked.
 */
export async function readAttachmentText(url: string): Promise<string> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch (error) {
    const dataMatch = /^data:[^,]*?(;base64)?,(.*)$/s.exec(url);
    if (dataMatch) {
      const [, base64, payload = ""] = dataMatch;
      if (base64) {
        const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
        return new TextDecoder().decode(bytes);
      }
      return decodeURIComponent(payload);
    }
    throw error instanceof Error ? error : new Error(String(error));
  }
}

const OVERLAY_Z = "z-[2147483647]";

/**
 * Full-screen text viewer for attachments (pasted text, .txt/.md files, page
 * context). Click outside or Escape closes; the content stays selectable and
 * the header offers one-click copy.
 */
export function TextPreviewOverlay({
  title,
  text,
  onClose,
}: {
  title: string;
  text: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleCopy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismissal, Escape handled globally
    <div
      role="presentation"
      onClick={onClose}
      className={`fixed inset-0 ${OVERLAY_Z} flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm`}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: stops backdrop dismissal, not an interactive control */}
      <div
        role="presentation"
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
      >
        <div className="flex items-center gap-2.5 border-border border-b px-4 py-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
            <FileTextIcon className="size-4 text-muted-foreground" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate font-medium text-foreground text-sm">
              {title}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {text.length.toLocaleString()} characters
            </span>
          </div>
          <button
            type="button"
            onClick={handleCopy}
            aria-label="Copy content"
            className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {copied ? (
              <CheckIcon className="size-3.5" />
            ) : (
              <CopyIcon className="size-3.5" />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          <pre className="select-text whitespace-pre-wrap break-words font-sans text-[13.5px] text-foreground leading-relaxed">
            {text}
          </pre>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Image viewer that goes NATIVE fullscreen — the whole screen, not the panel.
 * A Chrome side panel cannot draw over the page, so requestFullscreen is the
 * only way out of the panel bounds; when the surface denies it (e.g. an
 * iframe without allowfullscreen) it gracefully stays an in-panel overlay.
 * Escape and click both close (the browser exits fullscreen on Escape itself;
 * the fullscreenchange listener turns that into a close).
 */
export function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt?: string;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const openExternal = useExternalPreview();
  // "pending" while the host tries to project the image onto the page — the
  // in-panel overlay must not flash open behind a preview that is about to
  // appear at full page size.
  const [mode, setMode] = useState<"pending" | "internal">(
    openExternal ? "pending" : "internal",
  );

  useEffect(() => {
    if (!openExternal) return;
    let cancelled = false;
    openExternal({ src, title: alt })
      .then((handled) => {
        if (cancelled) return;
        if (handled) onClose();
        else setMode("internal");
      })
      .catch(() => {
        if (!cancelled) setMode("internal");
      });
    return () => {
      cancelled = true;
    };
  }, [openExternal, src, alt, onClose]);

  useEffect(() => {
    if (mode !== "internal") return;
    rootRef.current?.requestFullscreen?.().catch(() => {
      /* surface denied fullscreen — in-panel overlay is the fallback */
    });
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("keydown", onKey);
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => {});
      }
    };
  }, [onClose, mode]);

  if (mode === "pending") return null;

  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismissal, Escape handled globally
    <div
      ref={rootRef}
      role="presentation"
      onClick={onClose}
      className={`fixed inset-0 ${OVERLAY_Z} flex cursor-zoom-out items-center justify-center bg-black/95 p-6`}
    >
      <img
        src={src}
        alt={alt || "attachment"}
        className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
      />
      <button
        type="button"
        onClick={onClose}
        aria-label="Close image"
        className="absolute top-4 right-4 flex size-9 items-center justify-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
      >
        <XIcon className="size-5" />
      </button>
    </div>,
    document.body,
  );
}
