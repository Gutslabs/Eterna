"use client";

import type { FileUIPart } from "ai";
import { ImageIcon, PaperclipIcon, XIcon } from "lucide-react";
import React, {
  type ComponentProps,
  Fragment,
  type HTMLAttributes,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cn } from "../../../lib/utils";
import { Button } from "../../ui/button";
import { DropdownMenuItem } from "../../ui/dropdown-menu";
import {
  ImageLightbox,
  isTextAttachment,
  readAttachmentText,
  TextPreviewOverlay,
} from "../attachment-preview";
import { usePromptInputAttachments } from "./context";

export type PromptInputAttachmentProps = HTMLAttributes<HTMLDivElement> & {
  data: FileUIPart & { id: string };
  className?: string;
};

export function PromptInputAttachment({
  data,
  className,
  ...props
}: PromptInputAttachmentProps) {
  const attachments = usePromptInputAttachments();
  const isImage = Boolean(data.mediaType?.startsWith("image/") && data.url);
  const isText = isTextAttachment(data.mediaType, data.filename);
  const typeLabel =
    data.filename?.split(".").pop()?.toUpperCase() ||
    data.mediaType?.split("/").pop()?.toUpperCase();
  const [zoomed, setZoomed] = useState(false);
  const [preview, setPreview] = useState<{
    title: string;
    text: string;
  } | null>(null);

  const openPreview = () => {
    if (isImage) {
      setZoomed(true);
      return;
    }
    if (isText && data.url) {
      void readAttachmentText(data.url)
        .then((text) =>
          setPreview({
            title: data.filename || "attachment",
            text: text || "(empty)",
          }),
        )
        .catch(() => {});
    }
  };

  const clickable = isImage || (isText && Boolean(data.url));

  return (
    <div
      className={cn(
        "group inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm",
        "border border-border bg-muted/50 transition-colors hover:bg-muted",
        className,
      )}
      key={data.id}
      {...props}
    >
      {isImage ? (
        <button
          type="button"
          onClick={openPreview}
          title="Click to view fullscreen"
          className="shrink-0 cursor-zoom-in"
        >
          <img
            alt={data.filename || "attachment"}
            className="size-6 rounded object-cover"
            src={data.url}
          />
        </button>
      ) : (
        <span className="flex size-6 shrink-0 items-center justify-center text-muted-foreground">
          <PaperclipIcon className="size-4" />
        </span>
      )}
      {clickable ? (
        <button
          type="button"
          onClick={openPreview}
          title="Click to view"
          className="flex min-w-0 flex-col text-left leading-tight"
        >
          <span className="max-w-[140px] truncate underline-offset-2 hover:underline">
            {data.filename || "attachment"}
          </span>
          {typeLabel && (
            <span className="max-w-[140px] truncate text-[11px] text-muted-foreground/70">
              {typeLabel}
            </span>
          )}
        </button>
      ) : (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="max-w-[140px] truncate">
            {data.filename || "attachment"}
          </span>
          {typeLabel && (
            <span className="max-w-[140px] truncate text-[11px] text-muted-foreground/70">
              {typeLabel}
            </span>
          )}
        </span>
      )}
      {zoomed && data.url && (
        <ImageLightbox
          src={data.url}
          alt={data.filename || "attachment"}
          onClose={() => setZoomed(false)}
        />
      )}
      {preview && (
        <TextPreviewOverlay
          title={preview.title}
          text={preview.text}
          onClose={() => setPreview(null)}
        />
      )}
      <Button
        aria-label="Remove attachment"
        className="h-4 w-4 p-0 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={() => attachments.remove(data.id)}
        size="icon"
        type="button"
        variant="ghost"
      >
        <XIcon className="h-3 w-3" />
      </Button>
    </div>
  );
}

export type PromptInputAttachmentsProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> & {
  children: (attachment: FileUIPart & { id: string }) => React.ReactNode;
};

export function PromptInputAttachments({
  className,
  children,
  ...props
}: PromptInputAttachmentsProps) {
  const attachments = usePromptInputAttachments();
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
      style={{ height: attachments.files.length ? height : 0 }}
      {...props}
    >
      <div className="flex flex-wrap gap-2 p-3 pt-3" ref={contentRef}>
        {attachments.files.map((file) => (
          <Fragment key={file.id}>{children(file)}</Fragment>
        ))}
      </div>
    </div>
  );
}

export type PromptInputActionAddAttachmentsProps = ComponentProps<
  typeof DropdownMenuItem
> & {
  label?: string;
};

export const PromptInputActionAddAttachments = ({
  label = "Add photos or files",
  ...props
}: PromptInputActionAddAttachmentsProps) => {
  const attachments = usePromptInputAttachments();

  return (
    <DropdownMenuItem
      {...props}
      onSelect={(e) => {
        e.preventDefault();
        attachments.openFileDialog();
      }}
    >
      <ImageIcon className="mr-2 size-4" /> {label}
    </DropdownMenuItem>
  );
};
