import { createContext, type ReactNode, useContext } from "react";

/**
 * A request to show media large, outside the chat surface.
 *
 * The chat lives in a ~400px column, so an in-panel lightbox can never make a
 * diagram or screenshot readable. The host app (the extension) can do better —
 * it can project a modal onto the page itself — but that takes chrome.* APIs
 * this library must not know about. The library only announces "the user wants
 * this big"; the host decides where big is.
 */
export interface ExternalPreviewRequest {
  title?: string;
  /** Image source (data:, blob: or https:). */
  src?: string;
  /** Inline SVG markup (e.g. a rendered mermaid diagram). */
  svg?: string;
}

/** Returns true when the preview was shown somewhere; false falls back to the in-panel lightbox. */
export type ExternalPreviewOpener = (
  request: ExternalPreviewRequest,
) => Promise<boolean>;

const ExternalPreviewContext = createContext<ExternalPreviewOpener | null>(
  null,
);

export function ExternalPreviewProvider({
  opener,
  children,
}: {
  opener: ExternalPreviewOpener;
  children: ReactNode;
}) {
  return (
    <ExternalPreviewContext.Provider value={opener}>
      {children}
    </ExternalPreviewContext.Provider>
  );
}

export function useExternalPreview(): ExternalPreviewOpener | null {
  return useContext(ExternalPreviewContext);
}
