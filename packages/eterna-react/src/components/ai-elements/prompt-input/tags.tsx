"use client";

import { PuzzleIcon, XIcon } from "lucide-react";
import {
  Fragment,
  type HTMLAttributes,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cn } from "../../../lib/utils";
import { Button } from "../../ui/button";
import { PromptInputAttachment } from "./attachments";
import {
  CONTEXT_ICONS,
  type ContextItem,
  type SkillItem,
  usePromptInputAttachments,
  usePromptInputContexts,
  usePromptInputSkills,
} from "./context";

// ============ Context Items Components ============

export type PromptInputContextTagProps = HTMLAttributes<HTMLDivElement> & {
  data: ContextItem;
  className?: string;
};

export function PromptInputContextTag({
  data,
  className,
  ...props
}: PromptInputContextTagProps) {
  const contexts = usePromptInputContexts();

  return (
    <div
      className={cn(
        "group inline-flex items-center gap-1.5 px-2 py-1 text-sm rounded-md",
        "bg-muted/50 hover:bg-muted transition-colors",
        "border border-border",
        className,
      )}
      {...props}
    >
      <span className="text-muted-foreground">
        {data.icon || CONTEXT_ICONS[data.type]}
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="max-w-[200px] truncate">{data.label}</span>
        {typeof data.metadata?.domain === "string" && (
          <span className="max-w-[200px] truncate text-[11px] text-muted-foreground/70">
            {data.metadata.domain}
          </span>
        )}
      </span>
      <Button
        aria-label="Remove context"
        className="h-4 w-4 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={() => contexts.remove(data.id)}
        size="icon"
        type="button"
        variant="ghost"
      >
        <XIcon className="h-3 w-3" />
      </Button>
    </div>
  );
}

export type PromptInputContextTagsProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> & {
  children?: (item: ContextItem) => ReactNode;
};

export function PromptInputContextTags({
  className,
  children,
  ...props
}: PromptInputContextTagsProps) {
  const contexts = usePromptInputContexts();
  const [height, setHeight] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) {
      return;
    }
    const ro = new ResizeObserver(() => {
      setHeight(el.getBoundingClientRect().height);
    });
    ro.observe(el);
    setHeight(el.getBoundingClientRect().height);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      aria-live="polite"
      className={cn(
        "overflow-hidden transition-[height] duration-200 ease-out",
        className,
      )}
      style={{ height: contexts.items.length ? height : 0 }}
      {...props}
    >
      <div className="flex flex-wrap gap-2 p-3 pb-0" ref={contentRef}>
        {contexts.items.map((item) => (
          <Fragment key={item.id}>
            {children ? children(item) : <PromptInputContextTag data={item} />}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

export type PromptInputChipsProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
>;

/**
 * Renders selected context items and file attachments together in one wrapping
 * row at the top of the input, so an attached image sits beside the page/link
 * chip (like a native browser AI sidebar) rather than on a separate row.
 */
export function PromptInputChips({
  className,
  ...props
}: PromptInputChipsProps) {
  const contexts = usePromptInputContexts();
  const attachments = usePromptInputAttachments();
  const [height, setHeight] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);

  const hasItems = contexts.items.length > 0 || attachments.files.length > 0;

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) {
      return;
    }
    const ro = new ResizeObserver(() => {
      setHeight(el.getBoundingClientRect().height);
    });
    ro.observe(el);
    setHeight(el.getBoundingClientRect().height);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      aria-live="polite"
      className={cn(
        "overflow-hidden transition-[height] duration-200 ease-out",
        className,
      )}
      style={{ height: hasItems ? height : 0 }}
      {...props}
    >
      <div className="flex flex-wrap gap-2 p-3 pb-0" ref={contentRef}>
        {contexts.items.map((item) => (
          <PromptInputContextTag data={item} key={item.id} />
        ))}
        {attachments.files.map((file) => (
          <PromptInputAttachment data={file} key={file.id} />
        ))}
      </div>
    </div>
  );
}

// ============ Skill Items Components ============

export type PromptInputSkillTagProps = HTMLAttributes<HTMLDivElement> & {
  data: SkillItem;
  className?: string;
};

export function PromptInputSkillTag({
  data,
  className,
  ...props
}: PromptInputSkillTagProps) {
  const skills = usePromptInputSkills();

  const handleLabelClick = () => {
    // Open options page with skills tab
    if (typeof chrome !== "undefined" && chrome.tabs?.create) {
      const skillParam = encodeURIComponent(data.name.slice(0, 200));
      chrome.tabs.create({
        url: chrome.runtime.getURL(
          `src/pages/options/index.html?tab=skills&skill=${skillParam}`,
        ),
      });
    }
  };

  return (
    <div
      className={cn(
        "group inline-flex items-center gap-1.5 px-2 py-1 text-sm rounded-md",
        "bg-primary/10 hover:bg-primary/20 transition-colors",
        "border border-primary/30",
        className,
      )}
      {...props}
    >
      <span className="text-primary">
        <PuzzleIcon className="size-4" />
      </span>
      <button
        type="button"
        className="max-w-[200px] truncate cursor-pointer hover:underline text-primary bg-transparent border-none p-0 font-inherit text-left"
        onClick={handleLabelClick}
        title="Click to open skill settings"
      >
        {data.name}
      </button>
      <Button
        aria-label="Remove skill"
        className="h-4 w-4 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={() => skills.remove(data.id)}
        size="icon"
        type="button"
        variant="ghost"
      >
        <XIcon className="h-3 w-3" />
      </Button>
    </div>
  );
}

export type PromptInputSkillTagsProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> & {
  children?: (item: SkillItem) => ReactNode;
};

export function PromptInputSkillTags({
  className,
  children,
  ...props
}: PromptInputSkillTagsProps) {
  const skills = usePromptInputSkills();
  const [height, setHeight] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) {
      return;
    }
    const ro = new ResizeObserver(() => {
      setHeight(el.getBoundingClientRect().height);
    });
    ro.observe(el);
    setHeight(el.getBoundingClientRect().height);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      aria-live="polite"
      className={cn(
        "overflow-hidden transition-[height] duration-200 ease-out",
        className,
      )}
      style={{ height: skills.items.length ? height : 0 }}
      {...props}
    >
      <div className="flex flex-wrap gap-2 p-3 pb-0" ref={contentRef}>
        {skills.items.map((item) => (
          <Fragment key={item.id}>
            {children ? children(item) : <PromptInputSkillTag data={item} />}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
