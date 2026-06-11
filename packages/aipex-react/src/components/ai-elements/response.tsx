"use client";

import {
  type ComponentProps,
  lazy,
  memo,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Streamdown as StreamdownComponent } from "streamdown";
import { cn } from "../../lib/utils";

// Streamdown pulls the full remark/rehype markdown pipeline (~230KB). The
// welcome screen renders no markdown, so loading it lazily keeps it out of the
// sidepanel's first-paint bundle; it loads when the first message renders.
const Streamdown = lazy(() =>
  import("streamdown").then((m) => ({ default: m.Streamdown })),
);

type ResponseProps = ComponentProps<typeof StreamdownComponent>;

export const Response = memo(
  ({ className, ...props }: ResponseProps) => (
    <Suspense fallback={null}>
      <Streamdown
        className={cn(
          "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
          className,
        )}
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
