"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import {
  Children,
  type ComponentProps,
  isValidElement,
  lazy,
  memo,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ExtraProps, Streamdown as StreamdownComponent } from "streamdown";
import { cn } from "../../lib/utils";

// Streamdown pulls the full remark/rehype markdown pipeline (~230KB). The
// welcome screen renders no markdown, so loading it lazily keeps it out of the
// sidepanel's first-paint bundle; it loads when the first message renders.
const Streamdown = lazy(() =>
  import("streamdown").then((m) => ({ default: m.Streamdown })),
);

type ResponseProps = ComponentProps<typeof StreamdownComponent>;

/** Language of the fence, read from the inner code element's class. */
function fenceLanguage(children: ComponentProps<"pre">["children"]) {
  const child = Children.toArray(children)[0];
  if (!isValidElement(child)) return undefined;
  const className = (child.props as { className?: string }).className ?? "";
  return /language-([\w-]+)/.exec(className)?.[1];
}

const PROSE_FENCE_LANGUAGES = ["text", "plain", "txt", "md", "markdown"];

/**
 * Fenced blocks with a copy button (streamdown ships none). Prose fences
 * (```text — e.g. the grammar-correct skill's tweet-ready corrections) render
 * as a clean draft card in the UI font; real code keeps its mono look.
 */
// Typed as bare ExtraProps because streamdown's Components type intersects a
// per-tag mapped type with a string index signature — ExtraProps is the only
// props shape assignable to both halves; the cast recovers the real DOM props.
function CopyablePre(props: ExtraProps) {
  const {
    node: _node,
    children,
    ...rest
  } = props as ComponentProps<"pre"> & ExtraProps;
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const language = fenceLanguage(children);
  const isProse = !language || PROSE_FENCE_LANGUAGES.includes(language);

  const handleCopy = () => {
    const text = preRef.current?.textContent ?? "";
    if (!text) return;
    void navigator.clipboard.writeText(text.trim()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="group relative">
      <pre
        ref={preRef}
        {...rest}
        className={cn(
          rest.className,
          // Chat context: fenced content must WRAP, never clip; keep clear of
          // the copy button.
          "whitespace-pre-wrap break-words pr-16 [&_code]:whitespace-pre-wrap [&_code]:break-words",
          isProse &&
            // Draft card: reads as text the user will paste somewhere, not as
            // terminal output.
            "rounded-xl border border-border bg-muted/30 px-4 py-3.5 font-sans text-[13.5px] text-foreground leading-relaxed [&_code]:bg-transparent [&_code]:p-0 [&_code]:font-sans [&_code]:text-[13.5px] [&_code]:leading-relaxed",
        )}
      >
        {children}
      </pre>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? "Copied" : "Copy block"}
        title={copied ? "Copied" : "Copy"}
        className="absolute right-2.5 bottom-2.5 flex size-7 items-center justify-center rounded-md border border-border bg-background/90 text-muted-foreground opacity-60 shadow-sm transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
      >
        {copied ? (
          <CheckIcon className="size-3.5" />
        ) : (
          <CopyIcon className="size-3.5" />
        )}
      </button>
    </div>
  );
}

/**
 * Quoted sections (the grammar skill's Turkish meaning, quoted sources): calm
 * left-rule block, upright type — the default italic gray read badly.
 */
function QuietBlockquote(props: ExtraProps) {
  const {
    node: _node,
    children,
    ...rest
  } = props as ComponentProps<"blockquote"> & ExtraProps;
  return (
    <blockquote
      {...rest}
      className={cn(
        rest.className,
        "my-3 border-border border-l-2 pl-3.5 text-[13px] text-muted-foreground not-italic leading-relaxed [&_p]:my-1.5",
      )}
    >
      {children}
    </blockquote>
  );
}

export const Response = memo(
  ({ className, components, ...props }: ResponseProps) => (
    <Suspense fallback={null}>
      <Streamdown
        className={cn(
          "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
          className,
        )}
        components={{
          pre: CopyablePre,
          blockquote: QuietBlockquote,
          ...components,
        }}
        {...props}
      />
    </Suspense>
  ),
  (prevProps, nextProps) => prevProps.children === nextProps.children,
);

Response.displayName = "Response";

// Typewriter reveal speed in characters per second. Tuned for a steady,
// human-readable pace rather than an instant dump — raise it to type faster,
// lower it to type slower.
const TYPEWRITER_CHARS_PER_SECOND = 240;

// Min ms between committed reveals. Each commit re-renders Streamdown, which
// re-parses the (growing) markdown — so committing every animation frame is far
// too expensive for long answers. ~20 commits/sec stays smooth but cheap.
const TYPEWRITER_COMMIT_INTERVAL_MS = 50;

function useTypewriter(text: string, animate: boolean): string {
  const [count, setCount] = useState(() => (animate ? 0 : text.length));
  const hasAnimatedRef = useRef(animate);
  if (animate) {
    hasAnimatedRef.current = true;
  }
  // Track the latest committed count without adding it to the effect deps, so
  // the reveal resumes from where it is when streaming grows the text.
  const countRef = useRef(count);
  countRef.current = count;

  useEffect(() => {
    if (!hasAnimatedRef.current) {
      setCount(text.length);
      return;
    }
    // Steady, time-based reveal (framerate-independent), throttled so Streamdown
    // re-parses at most ~20×/sec instead of once per frame.
    let raf = 0;
    let last = performance.now();
    let lastCommit = 0;
    let shown = countRef.current;
    const step = (now: number) => {
      shown = Math.min(
        text.length,
        shown + ((now - last) / 1000) * TYPEWRITER_CHARS_PER_SECOND,
      );
      last = now;
      if (
        now - lastCommit >= TYPEWRITER_COMMIT_INTERVAL_MS ||
        shown >= text.length
      ) {
        lastCommit = now;
        setCount(Math.floor(shown));
      }
      if (shown < text.length) {
        raf = requestAnimationFrame(step);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [text]);

  return hasAnimatedRef.current ? text.slice(0, count) : text;
}

export type StreamingResponseProps = ResponseProps & {
  /** When true, reveal the text with a typewriter animation. */
  animate?: boolean;
};

/**
 * Response variant that types its text out progressively. Used for the
 * assistant's latest message so non-streaming providers (which return the
 * whole answer at once) still appear to stream in.
 */
export const StreamingResponse = ({
  animate = false,
  children,
  ...props
}: StreamingResponseProps) => {
  const source = typeof children === "string" ? children : "";
  const displayed = useTypewriter(source, animate);
  return (
    <Response {...props}>
      {typeof children === "string" ? displayed : children}
    </Response>
  );
};

StreamingResponse.displayName = "StreamingResponse";
