"use client";

import type { FileUIPart } from "ai";
import {
  BookmarkIcon,
  CameraIcon,
  ClipboardIcon,
  DatabaseIcon,
  FileIcon,
  FileTextIcon,
  GlobeIcon,
} from "lucide-react";
import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
} from "react";

// ============ Context Types ============

// Derive from the canonical union (core ContextType + UI extras) so the two
// ContextItem shapes in this package can never drift apart again.
export type { ContextItemType } from "../../../types/ui";

import type { ContextItemType } from "../../../types/ui";

export type ContextItem = {
  id: string;
  type: ContextItemType;
  label: string;
  value: string;
  icon?: ReactNode;
  metadata?: Record<string, any>;
  /**
   * Survives `clear()` on send so it stays attached to every message. Only an
   * explicit `remove()` (the chip's X) drops it. Used for the current-page
   * context, which should follow the whole conversation until dismissed.
   */
  persistent?: boolean;
};

// Context icons mapping
export const CONTEXT_ICONS: Record<ContextItemType, ReactNode> = {
  page: <GlobeIcon className="size-4" />,
  tab: <FileIcon className="size-4" />,
  bookmark: <BookmarkIcon className="size-4" />,
  clipboard: <ClipboardIcon className="size-4" />,
  screenshot: <CameraIcon className="size-4" />,
  file: <FileIcon className="size-4" />,
  database: <DatabaseIcon className="size-4" />,
  custom: <FileTextIcon className="size-4" />,
};

// ============ Contexts (Attachments + Context Items) ============

export type AttachmentsContext = {
  files: (FileUIPart & { id: string })[];
  add: (files: File[] | FileList) => void;
  remove: (id: string) => void;
  clear: () => void;
  openFileDialog: () => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
};

export const AttachmentsContext = createContext<AttachmentsContext | null>(
  null,
);

export const usePromptInputAttachments = () => {
  const context = useContext(AttachmentsContext);

  if (!context) {
    throw new Error(
      "usePromptInputAttachments must be used within a PromptInput",
    );
  }

  return context;
};

// Context Items Context
export type ContextItemsContext = {
  items: ContextItem[];
  add: (item: ContextItem) => void;
  remove: (id: string) => void;
  clear: () => void;
  availableContexts: ContextItem[];
  setAvailableContexts: (items: ContextItem[]) => void;
};

export const ContextItemsContext = createContext<ContextItemsContext | null>(
  null,
);

export const usePromptInputContexts = () => {
  const context = useContext(ContextItemsContext);

  if (!context) {
    throw new Error("usePromptInputContexts must be used within a PromptInput");
  }

  return context;
};

// ============ Skill Items Context ============

export type SkillItem = {
  id: string;
  name: string;
  description?: string;
};

export type SkillItemsContext = {
  items: SkillItem[];
  add: (item: SkillItem) => void;
  remove: (id: string) => void;
  clear: () => void;
  availableSkills: SkillItem[];
  setAvailableSkills: (items: SkillItem[]) => void;
};

export const SkillItemsContext = createContext<SkillItemsContext | null>(null);

export const usePromptInputSkills = () => {
  const context = useContext(SkillItemsContext);

  if (!context) {
    throw new Error("usePromptInputSkills must be used within a PromptInput");
  }

  return context;
};
