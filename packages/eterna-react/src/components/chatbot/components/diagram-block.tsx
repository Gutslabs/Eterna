import { memo, useEffect, useId, useState } from "react";
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
 */
export const DiagramBlock = memo(function DiagramBlock({
  part,
}: {
  part: UIToolPart;
}) {
  const input = part.input as { mermaid?: unknown; title?: unknown } | null;
  const source = typeof input?.mermaid === "string" ? input.mermaid.trim() : "";
  const title = typeof input?.title === "string" ? input.title : null;

  const { effectiveTheme } = useTheme();
  const openExternal = useExternalPreview();
  const renderId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    setFailed(false);
    import("@streamdown/mermaid")
      .then(async ({ mermaid }) => {
        const instance = mermaid.getMermaid({
          theme: effectiveTheme === "dark" ? "dark" : "default",
        });
        const rendered = await instance.render(`eterna-${renderId}`, source);
        if (!cancelled) setSvg(rendered.svg);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [source, effectiveTheme, renderId]);

  if (!source) return null;

  return (
    <div className="w-full py-1">
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
      ) : failed ? (
        // Invalid mermaid from the model: show the source instead of nothing,
        // so the answer is still salvageable.
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-xl border border-border bg-muted/30 p-3 font-mono text-[12px] text-muted-foreground">
          {source}
        </pre>
      ) : (
        <div className="h-24 animate-pulse rounded-xl border border-border bg-muted/30" />
      )}
    </div>
  );
});
