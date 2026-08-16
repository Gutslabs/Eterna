import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import { sanitizeSvgOuterHtml } from "../../../lib/sanitize-svg";
import { useTheme } from "../../../theme/context";
import type { UIToolPart } from "../../../types";
import { useExternalPreview } from "../../preview/external-preview";

/**
 * A render_diagram call, drawn as the diagram itself.
 *
 * Renders mermaid directly instead of routing the fence through Response:
 * Streamdown's mermaid branch lives in its own `pre` component, and the chat
 * replaces `pre` with CopyablePre (copy button, wrapping, prose cards), which
 * devours that branch — a fence handed to Response can never become a picture
 * here. Direct rendering also keeps the ~400KB mermaid library out of the
 * eager bundle: it loads on the first diagram and is cached after.
 *
 * The source comes from the model's tool call and is rendered with mermaid's
 * strict security level (the plugin's default).
 *
 * Rendering is deliberately stingy — mermaid parse + layout is the single
 * most expensive thing this component can do, so each diagram pays it at most
 * once per theme:
 * - Rendered SVG lives in a module-level LRU that survives unmounts, so
 *   reopening the sidebar or switching conversations repaints history
 *   diagrams from the cache instead of re-laying them out.
 * - The plugin's getMermaid(config) re-initializes the global mermaid on
 *   every call; renderMermaid() below passes config only when the theme
 *   actually changed.
 * - Uncached diagrams wait for the viewport: a long scrollback renders only
 *   what the user approaches, not every diagram in history at mount.
 */

const SVG_CACHE_MAX = 32;
const svgCache = new Map<string, string>();

const cacheKey = (theme: string, source: string): string =>
  `${theme}:${source}`;

function cacheGet(key: string): string | null {
  const hit = svgCache.get(key);
  if (hit === undefined) return null;
  svgCache.delete(key);
  svgCache.set(key, hit);
  return hit;
}

function cachePut(key: string, svg: string): void {
  if (svgCache.size >= SVG_CACHE_MAX && !svgCache.has(key)) {
    const oldest = svgCache.keys().next().value;
    if (oldest !== undefined) svgCache.delete(oldest);
  }
  svgCache.set(key, svg);
}

let initializedTheme: string | null = null;

async function renderMermaid(
  theme: "dark" | "default",
  id: string,
  source: string,
): Promise<string> {
  const { mermaid } = await import("@streamdown/mermaid");
  const instance =
    initializedTheme === theme
      ? mermaid.getMermaid()
      : mermaid.getMermaid({ theme });
  initializedTheme = theme;
  const rendered = await instance.render(id, source);
  return rendered.svg;
}

export const DiagramBlock = memo(function DiagramBlock({
  part,
}: {
  part: UIToolPart;
}) {
  const input = part.input as {
    mermaid?: unknown;
    svg?: unknown;
    title?: unknown;
  } | null;
  const source = typeof input?.mermaid === "string" ? input.mermaid.trim() : "";
  const rawAuthored = typeof input?.svg === "string" ? input.svg.trim() : "";
  const title = typeof input?.title === "string" ? input.title : null;

  // The editorial path: SVG authored by the model under the diagram-design
  // skill. Sanitized with the same policy as the page modal — the source is
  // model output, and page content could have prompted something hostile into
  // it. Derived (not state) so streaming tool arguments never freeze a
  // half-received document.
  const authoredSvg = useMemo(
    () => (rawAuthored ? sanitizeSvgOuterHtml(rawAuthored) : null),
    [rawAuthored],
  );

  const { effectiveTheme } = useTheme();
  const themeName = effectiveTheme === "dark" ? "dark" : "default";
  const openExternal = useExternalPreview();
  const renderId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const containerRef = useRef<HTMLDivElement>(null);
  const [mermaidSvg, setMermaidSvg] = useState<string | null>(() =>
    source && !rawAuthored ? cacheGet(cacheKey(themeName, source)) : null,
  );
  // Environments without IntersectionObserver (jsdom) render immediately.
  const [nearViewport, setNearViewport] = useState(
    () => typeof IntersectionObserver === "undefined",
  );
  const [failed, setFailed] = useState(false);
  const svg = authoredSvg ?? mermaidSvg;

  useEffect(() => {
    if (svg || nearViewport || !source || rawAuthored) return;
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [svg, nearViewport, source, rawAuthored]);

  useEffect(() => {
    if (!source || rawAuthored) return;
    const key = cacheKey(themeName, source);
    const cached = cacheGet(key);
    if (cached) {
      setFailed(false);
      setMermaidSvg(cached);
      return;
    }
    if (!nearViewport) return;
    let cancelled = false;
    setFailed(false);
    renderMermaid(themeName, `eterna-${renderId}`, source)
      .then((rendered) => {
        cachePut(key, rendered);
        if (!cancelled) setMermaidSvg(rendered);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [source, rawAuthored, themeName, nearViewport, renderId]);

  if (!source && !rawAuthored) return null;

  return (
    <div ref={containerRef} className="w-full py-1">
      {title && (
        <div className="mb-1.5 px-0.5 font-medium text-[12.5px] text-foreground/80">
          {title}
        </div>
      )}
      {svg ? (
        openExternal ? (
          // The panel column is too narrow to read a real diagram — clicking
          // asks the host to project it onto the page at full size.
          <button
            type="button"
            onClick={() =>
              void openExternal({ svg, title: title ?? undefined })
            }
            title="Büyütmek için tıkla"
            className="block w-full cursor-zoom-in overflow-x-auto rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-muted-foreground/40 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid output, rendered under its strict security level
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <div
            className="overflow-x-auto rounded-xl border border-border bg-card p-3 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid output, rendered under its strict security level
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        )
      ) : failed || (rawAuthored && !authoredSvg) ? (
        // Invalid mermaid or unsanitizable SVG from the model: show the source
        // instead of nothing, so the answer is still salvageable.
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-xl border border-border bg-muted/30 p-3 font-mono text-[12px] text-muted-foreground">
          {source || rawAuthored}
        </pre>
      ) : (
        <div className="h-24 animate-pulse rounded-xl border border-border bg-muted/30" />
      )}
    </div>
  );
});

/** Test hook: empty the render cache and forget the initialized theme. */
export function resetDiagramRenderCacheForTests(): void {
  svgCache.clear();
  initializedTheme = null;
}
